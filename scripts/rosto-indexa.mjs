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
// ROSTO_MAX_NOVAS (padrão 3000 por execução), ROSTO_MAX_MINUTOS (padrão 35:
// passou disso, para de pegar foto nova, envia o que tem e grava o estado — a
// próxima execução continua de onde parou), ROSTO_SECO=1 (só mostra),
// ROSTO_INDEXADOR_TOKEN (opcional: lê o álbum antes do lançamento).

import { readFile, writeFile } from 'node:fs/promises';
import { rekognition, base64, ErroAws } from '../src/aws.js';
import { colecoes, idExterno, lerIdExterno } from '../src/rosto.js';
import { ROSTO_REGIAO_PADRAO, BUSCA_LOTE_MAX } from '../src/config.js';

// Filtro de qualidade do IndexFaces. NONE (v3.7.3): todo rosto que a Amazon
// detecta entra, até o pequeno, de lado, tremido ou no escuro — melhor um
// rosto ruim no índice que uma foto da pessoa que a busca não acha. Trocar
// este valor reindexa os rostos uma vez (ver `#qualidade` no estado).
const QUALIDADE = 'NONE';
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
    // Diagnóstico (v3.8.0): quantas fotos o site mostra em cada evento, para
    // comparar com o Drive (docs/ALBUM.md, "Conferir se está tudo no site").
    console.log(`[${slug}] evento ${cap}: ${p.ids.length} itens`);
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
  const inicio = Date.now();
  const limiteMs = (Number(process.env.ROSTO_MAX_MINUTOS) || 35) * 60000;
  const acabouOTempo = () => Date.now() - inicio > limiteMs;
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
    let indexados = await rostosIndexados(cred, col);
    // Filtro de qualidade mudou (v3.7.3: LOW → NONE, "pegar todos os rostos,
    // mesmo na dúvida"): apaga os rostos uma vez e indexa de novo, só a parte
    // do rosto — texto, coisas e moderação já lidos não são lidos outra vez.
    // A marca é gravada logo depois de apagar: se a execução parar no meio, a
    // próxima continua sem apagar de novo.
    const chaveQualidade = `${slug}#qualidade`;
    if (estado[chaveQualidade] !== QUALIDADE) {
      const ids = [...indexados.values()].flat();
      for (let i = 0; i < ids.length; i += 4096) await aws(cred, 'DeleteFaces', { CollectionId: col, FaceIds: ids.slice(i, i + 4096) });
      if (ids.length) console.log(`[${slug}] filtro de qualidade novo (${QUALIDADE}): ${ids.length} rostos apagados para indexar de novo.`);
      indexados = new Map();
      estado[slug] = [];
      estado[chaveQualidade] = QUALIDADE;
      await writeFile(arqEstado, JSON.stringify(estado));
    }
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
    // Até PARALELAS fotos ao mesmo tempo, começando uma a cada 250 ms: cada
    // operação fica em no máximo 4 por segundo (a cota padrão é 5/s).
    const PARALELAS = 4;
    let parou = false;
    /** @param {string} k @param {string} id */
    const processa = async (k, id) => {
      try {
        const bytes = await miniatura(id);
        const imagem = { Bytes: base64(bytes) };
        const [res, texto, rotulos, moderacao] = await Promise.all([
          vistas.has(k) ? null : aws(cred, 'IndexFaces', { CollectionId: col, Image: imagem, ExternalImageId: k, MaxFaces: 100, QualityFilter: QUALIDADE, DetectionAttributes: [] }),
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
        const envio = lote; lote = [];
        const r = await enviaBusca(site, slug, envio, []);
        marcadas += r.marcadas; escondidas += r.escondidas;
        // Progresso gravado a cada lote: se o job cair, o que foi feito fica.
        estado[slug] = [...vistas];
        if (descrever) estado[chaveBusca] = [...descritas];
        await writeFile(arqEstado, JSON.stringify(estado));
      }
    };
    /** @type {Set<Promise<void>>} */
    const emCurso = new Set();
    let feitas = 0;
    for (const [k, id] of novas) {
      if (acabouOTempo()) { parou = true; break; }
      while (emCurso.size >= PARALELAS) await Promise.race(emCurso);
      const t = processa(k, id).finally(() => { emCurso.delete(t); });
      emCurso.add(t);
      feitas++;
      if (feitas % 100 === 0) console.log(`[${slug}] ${feitas} de ${novas.length}…`);
      await espera(250);
    }
    await Promise.all(emCurso);
    if (parou) console.log(`[${slug}] limite de tempo: ${feitas} de ${novas.length} nesta execução; a próxima continua.`);
    // O que sobrou do lote, e as fotos que saíram do álbum (a busca as esquece).
    const remover = descrever ? [...descritas].filter(id => !idsNoAlbum.has(id)) : [];
    if (lote.length || remover.length) {
      const r = await enviaBusca(site, slug, lote, remover);
      marcadas += r.marcadas; escondidas += r.escondidas;
    }
    // Esquece o que saiu do álbum (se voltar, é indexado de novo).
    estado[slug] = [...vistas].filter(k => fotos.has(k));
    if (descrever) estado[chaveBusca] = [...descritas].filter(id => idsNoAlbum.has(id));
    console.log(`[${slug}] ${feitas} fotos processadas, ${rostos} rostos indexados, ${falhas} falhas.`);
    if (descrever) console.log(`[${slug}] busca nas fotos: ${marcadas} marcadas pela moderação, ${escondidas} escondidas (da turma).`);
  }
  await writeFile(arqEstado, JSON.stringify(estado));
}

if (import.meta.url === `file://${process.argv[1]}`) {
  principal().catch(e => { console.error(e instanceof Error ? e.message : e); process.exit(1); });
}
