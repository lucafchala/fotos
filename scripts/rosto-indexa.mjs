#!/usr/bin/env node
// Indexador da busca pelo rosto (v3.2). Roda no GitHub Actions
// (.github/workflows/rosto.yml), nunca no Worker: indexar uma foto custa
// baixar a miniatura e uma chamada à AWS, e o plano grátis do Worker tem 10 ms
// de CPU e 50 subrequisições por invocação.
//
// O que ele faz, por álbum (ROSTO_SLUGS):
//   1. lê as páginas PÚBLICAS da galeria (o índice e cada capítulo) e tira a
//      lista de fotos do JSON `g-dados` — a mesma lista que o visitante vê,
//      já sem as fotos ocultas e sem vídeo;
//   2. cria a coleção `fotos-<slug>` na Rekognition, se faltar;
//   3. indexa as fotos novas (miniatura de 2400 px, até 100 rostos, filtro de
//      qualidade LOW para não perder rosto pequeno de foto de grupo) e apaga do índice os
//      rostos das fotos que saíram do álbum.
//
// O estado (quais fotos já foram vistas, inclusive as sem rosto, que a
// Rekognition não guarda) fica num JSON que o workflow preserva entre
// execuções (actions/cache). Sem ele, o pior caso é reprocessar o álbum:
// US$ 0,001 por foto.
//
// Variáveis: AWS_ACCESS_KEY_ID, AWS_SECRET_ACCESS_KEY, AWS_REGION (padrão
// sa-east-1), ROSTO_SLUGS (ex.: "entrenos2026"), ROSTO_SITE (padrão
// https://fotos.lucafchala.com), ROSTO_ESTADO (padrão .rosto-estado.json),
// ROSTO_MAX_NOVAS (padrão 3000 por execução), ROSTO_SECO=1 (só mostra),
// ROSTO_INDEXADOR_TOKEN (opcional: lê o álbum antes do lançamento).

import { readFile, writeFile } from 'node:fs/promises';
import { rekognition, base64, ErroAws } from '../src/aws.js';
import { colecoes, idExterno, lerIdExterno } from '../src/rosto.js';
import { ROSTO_REGIAO_PADRAO, BUSCA_LOTE_MAX } from '../src/config.js';
import { descreveFoto } from '../src/busca.js';

const UA = 'fotos-rosto-indexador/1.0 (bot; +https://github.com/lucafchala/fotos)';
const ID_RE = /^[A-Za-z0-9_-]{10,200}$/;

/** As fotos (não vídeos) do JSON g-dados de uma página, com o autor de cada uma. @param {string} html */
export function fotosDaPagina(html) {
  const m = html.match(/<script type="application\/json" id="g-dados"[^>]*>([\s\S]*?)<\/script>/);
  if (!m) return null;
  const dados = JSON.parse(m[1]);
  const nomes = Array.isArray(dados.autores) ? dados.autores.map(String) : [];
  /** @type {string[]} */
  const ids = [];
  /** @type {Map<string, string>} */
  const autores = new Map();
  for (const sec of Array.isArray(dados.secoes) ? dados.secoes : []) {
    for (const f of Array.isArray(sec.fotos) ? sec.fotos : []) {
      // Formato da página (fotoDaPagina em src/ui/galeria.js): o "extra"
      // numérico na posição 9 é a duração de um vídeo; o autor é o índice na
      // posição 7 (ausente = 0).
      if (!Array.isArray(f) || typeof f[9] === 'number') continue;
      if (typeof f[0] === 'string' && ID_RE.test(f[0])) {
        ids.push(f[0]);
        autores.set(f[0], nomes[typeof f[7] === 'number' ? f[7] : 0] || '');
      }
    }
  }
  return { cap: typeof dados.cap === 'string' ? dados.cap : '', ids, autores };
}

/** Os slugs dos capítulos no índice. @param {string} html @param {string} slug */
export function capitulosDoIndice(html, slug) {
  const re = new RegExp(`<a class="ix-card[^"]*" href="/galeria/${slug.replace(/[^a-z0-9-]/g, '')}/([a-z0-9][a-z0-9-]*)"`, 'g');
  return [...new Set([...html.matchAll(re)].map(x => x[1]))];
}

/** @param {string} url */
async function pagina(url) {
  // Com ROSTO_INDEXADOR_TOKEN, lê também o álbum ainda em "Em breve" (antes do
  // lançamento, para o dono testar a busca).
  const token = process.env.ROSTO_INDEXADOR_TOKEN || '';
  const r = await fetch(url, { headers: { 'User-Agent': UA, ...(token ? { 'X-Rosto-Indexador': token } : {}) } });
  if (!r.ok) throw new Error(`${url}: HTTP ${r.status}`);
  return r.text();
}

/**
 * Todas as fotos visíveis do álbum, como ExternalImageId → id do Drive, e o
 * capítulo e o autor de cada uma (para a busca nas fotos e a moderação).
 * @param {string} site @param {string} slug
 * @returns {Promise<{ todas: Map<string, string>, info: Map<string, { cap: string, autor: string }> }>}
 */
async function fotosDoAlbum(site, slug) {
  const base = `${site}/galeria/${slug}`;
  const inicio = await pagina(base);
  /** @type {Map<string, string>} */
  const todas = new Map();
  /** @type {Map<string, { cap: string, autor: string }>} */
  const info = new Map();
  const unica = fotosDaPagina(inicio);
  if (unica) {
    for (const id of unica.ids) { todas.set(idExterno('', id), id); info.set(id, { cap: '', autor: unica.autores.get(id) || '' }); }
    return { todas, info };
  }
  for (const cap of capitulosDoIndice(inicio, slug)) {
    const p = fotosDaPagina(await pagina(`${base}/${cap}`));
    if (!p) continue;
    for (const id of p.ids) { todas.set(idExterno(cap, id), id); info.set(id, { cap, autor: p.autores.get(id) || '' }); }
  }
  return { todas, info };
}

/**
 * Manda ao site o que a Rekognition leu (busca nas fotos e moderação) e as
 * fotos que saíram do álbum, em lotes. Precisa do ROSTO_INDEXADOR_TOKEN.
 * @param {string} site @param {string} slug
 * @param {any[]} itens @param {string[]} remover
 */
async function enviaBusca(site, slug, itens, remover) {
  const token = process.env.ROSTO_INDEXADOR_TOKEN || '';
  if (!token) return { marcadas: 0, escondidas: 0 };
  let marcadas = 0, escondidas = 0;
  for (let i = 0; i < Math.max(itens.length, remover.length); i += BUSCA_LOTE_MAX) {
    const r = await fetch(`${site}/api/busca/indexar`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'User-Agent': UA, 'X-Rosto-Indexador': token },
      body: JSON.stringify({ slug, itens: itens.slice(i, i + BUSCA_LOTE_MAX), remover: remover.slice(i, i + BUSCA_LOTE_MAX) }),
    });
    if (!r.ok) throw new Error(`/api/busca/indexar: HTTP ${r.status}`);
    const j = /** @type {any} */ (await r.json());
    marcadas += Number(j.marcadas) || 0;
    escondidas += Number(j.escondidas) || 0;
  }
  return { marcadas, escondidas };
}

const espera = (/** @type {number} */ ms) => new Promise(r => setTimeout(r, ms));

/**
 * A foto para indexar: 2400 px (rosto pequeno em foto de grupo ainda tem
 * pixels para a Rekognition); acima do teto de 5 MB da API, cai para 1600.
 * @param {string} id
 */
async function miniatura(id) {
  for (const w of [2400, 1600]) {
    const r = await fetch(`https://lh3.googleusercontent.com/d/${id}=w${w}`, { headers: { 'User-Agent': UA } });
    if (!r.ok) throw new Error(`miniatura HTTP ${r.status}`);
    const bytes = new Uint8Array(await r.arrayBuffer());
    if (bytes.length <= 5_000_000) return bytes;
  }
  throw new Error('miniatura acima de 5 MB');
}

/** Chamada com nova tentativa quando a AWS pede calma. @type {typeof rekognition} */
async function aws(cred, op, corpo) {
  for (let i = 0; ; i++) {
    try {
      return await rekognition(cred, op, corpo);
    } catch (e) {
      if (i < 5 && e instanceof ErroAws && /Throttling|ProvisionedThroughput/.test(e.tipo)) { await espera(1000 * 2 ** i); continue; }
      throw e;
    }
  }
}

/** Os rostos já no índice: ExternalImageId → FaceIds. */
async function rostosIndexados(cred, colecao) {
  /** @type {Map<string, string[]>} */
  const mapa = new Map();
  let NextToken;
  do {
    const r = await aws(cred, 'ListFaces', { CollectionId: colecao, MaxResults: 4096, ...(NextToken ? { NextToken } : {}) });
    for (const f of r.Faces || []) {
      const k = String(f.ExternalImageId || '');
      mapa.set(k, [...(mapa.get(k) || []), f.FaceId]);
    }
    NextToken = r.NextToken;
  } while (NextToken);
  return mapa;
}

async function principal() {
  const cred = {
    chave: process.env.AWS_ACCESS_KEY_ID || '',
    segredo: process.env.AWS_SECRET_ACCESS_KEY || '',
    regiao: process.env.AWS_REGION || ROSTO_REGIAO_PADRAO,
  };
  const slugs = String(process.env.ROSTO_SLUGS || '').split(',').map(s => s.trim()).filter(s => /^[a-z0-9][a-z0-9-]*$/.test(s));
  const site = (process.env.ROSTO_SITE || 'https://fotos.lucafchala.com').replace(/\/+$/, '');
  const arqEstado = process.env.ROSTO_ESTADO || '.rosto-estado.json';
  const maxNovas = Number(process.env.ROSTO_MAX_NOVAS) || 3000;
  const seco = process.env.ROSTO_SECO === '1';
  // Busca nas fotos (v3.7): texto, coisas e moderação, uma vez por foto.
  // ROSTO_DESCREVER=0 desliga (só rostos).
  const descrever = process.env.ROSTO_DESCREVER !== '0' && !!process.env.ROSTO_INDEXADOR_TOKEN;
  if (!slugs.length) { console.log('ROSTO_SLUGS vazio: nada a fazer.'); return; }
  if (!seco && (!cred.chave || !cred.segredo)) throw new Error('Faltam AWS_ACCESS_KEY_ID e AWS_SECRET_ACCESS_KEY.');

  /** @type {Record<string, string[]>} fotos já processadas, por álbum (com ou sem rosto); `<slug>#busca`: as já descritas (ids do Drive) */
  let estado;
  try { estado = JSON.parse(await readFile(arqEstado, 'utf8')); } catch { estado = {}; }

  for (const slug of slugs) {
    const col = colecoes(slug).principal;
    const { todas: fotos, info } = await fotosDoAlbum(site, slug);
    console.log(`[${slug}] ${fotos.size} fotos no álbum.`);
    if (seco) continue;
    try { await aws(cred, 'CreateCollection', { CollectionId: col }); console.log(`[${slug}] coleção ${col} criada.`); } catch (e) {
      if (!(e instanceof ErroAws && e.tipo === 'ResourceAlreadyExistsException')) throw e;
    }
    const indexados = await rostosIndexados(cred, col);
    const vistas = new Set(estado[slug] || []);
    for (const k of indexados.keys()) vistas.add(k);

    // Saíram do álbum (ocultas, apagadas, movidas de capítulo): apaga os rostos.
    const apagar = [...indexados].filter(([k]) => !fotos.has(k) && lerIdExterno(k)).flatMap(([, ids]) => ids);
    for (let i = 0; i < apagar.length; i += 4096) await aws(cred, 'DeleteFaces', { CollectionId: col, FaceIds: apagar.slice(i, i + 4096) });
    if (apagar.length) console.log(`[${slug}] ${apagar.length} rostos apagados (fotos que saíram do álbum).`);

    const chaveBusca = `${slug}#busca`;
    const descritas = new Set(estado[chaveBusca] || []);
    const idsNoAlbum = new Set(fotos.values());
    // Uma foto entra se falta o rosto OU (com a busca ligada) a descrição.
    const novas = [...fotos].filter(([k, id]) => !vistas.has(k) || (descrever && !descritas.has(id))).slice(0, maxNovas);
    let rostos = 0; let falhas = 0;
    /** @type {any[]} */
    let lote = [];
    let marcadas = 0, escondidas = 0;
    for (const [k, id] of novas) {
      try {
        const bytes = await miniatura(id);
        const imagem = { Bytes: base64(bytes) };
        // Cada operação tem a sua cota (5/s por padrão): as quatro juntas,
        // uma foto a cada 250 ms.
        const [res, texto, rotulos, moderacao] = await Promise.all([
          vistas.has(k) ? null : aws(cred, 'IndexFaces', { CollectionId: col, Image: imagem, ExternalImageId: k, MaxFaces: 100, QualityFilter: 'LOW', DetectionAttributes: [] }),
          descrever && !descritas.has(id) ? aws(cred, 'DetectText', { Image: imagem }) : null,
          descrever && !descritas.has(id) ? aws(cred, 'DetectLabels', { Image: imagem, MaxLabels: 30, MinConfidence: 70 }) : null,
          descrever && !descritas.has(id) ? aws(cred, 'DetectModerationLabels', { Image: imagem, MinConfidence: 70 }) : null,
        ]);
        if (res) { rostos += (res.FaceRecords || []).length; vistas.add(k); }
        if (texto || rotulos || moderacao) {
          const d = descreveFoto({ texto, rotulos, moderacao });
          const i = info.get(id) || { cap: '', autor: '' };
          lote.push({ foto: id, cap: i.cap, autor: i.autor, ...d });
          descritas.add(id);
        }
      } catch (e) {
        falhas++;
        console.warn(`[${slug}] ${k}: ${e instanceof Error ? e.message : e}`);
      }
      if (lote.length >= BUSCA_LOTE_MAX) {
        const r = await enviaBusca(site, slug, lote, []);
        marcadas += r.marcadas; escondidas += r.escondidas; lote = [];
      }
      await espera(250);
    }
    // O que sobrou do lote, e as fotos que saíram do álbum (a busca as esquece).
    const remover = descrever ? [...descritas].filter(id => !idsNoAlbum.has(id)) : [];
    if (lote.length || remover.length) {
      const r = await enviaBusca(site, slug, lote, remover);
      marcadas += r.marcadas; escondidas += r.escondidas;
    }
    // Esquece o que saiu do álbum (se voltar, é indexado de novo).
    estado[slug] = [...vistas].filter(k => fotos.has(k));
    if (descrever) estado[chaveBusca] = [...descritas].filter(id => idsNoAlbum.has(id));
    console.log(`[${slug}] ${novas.length} fotos processadas, ${rostos} rostos indexados, ${falhas} falhas.`);
    if (descrever) console.log(`[${slug}] busca nas fotos: ${marcadas} marcadas pela moderação, ${escondidas} escondidas (da turma).`);
  }
  await writeFile(arqEstado, JSON.stringify(estado));
}

if (import.meta.url === `file://${process.argv[1]}`) {
  principal().catch(e => { console.error(e instanceof Error ? e.message : e); process.exit(1); });
}
