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
//   3. indexa as fotos novas (miniatura de 1600 px) e apaga do índice os
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
// ROSTO_MAX_NOVAS (padrão 3000 por execução), ROSTO_SECO=1 (só mostra).

import { readFile, writeFile } from 'node:fs/promises';
import { rekognition, base64, ErroAws } from '../src/aws.js';
import { colecoes, idExterno, lerIdExterno } from '../src/rosto.js';
import { ROSTO_REGIAO_PADRAO } from '../src/config.js';

const UA = 'fotos-rosto-indexador/1.0 (bot; +https://github.com/lucafchala/fotos)';
const ID_RE = /^[A-Za-z0-9_-]{10,200}$/;

/** As fotos (não vídeos) do JSON g-dados de uma página. @param {string} html */
export function fotosDaPagina(html) {
  const m = html.match(/<script type="application\/json" id="g-dados"[^>]*>([\s\S]*?)<\/script>/);
  if (!m) return null;
  const dados = JSON.parse(m[1]);
  /** @type {string[]} */
  const ids = [];
  for (const sec of Array.isArray(dados.secoes) ? dados.secoes : []) {
    for (const f of Array.isArray(sec.fotos) ? sec.fotos : []) {
      // Formato da página (fotoDaPagina em src/ui/galeria.js): o "extra"
      // numérico na posição 9 é a duração de um vídeo.
      if (!Array.isArray(f) || typeof f[9] === 'number') continue;
      if (typeof f[0] === 'string' && ID_RE.test(f[0])) ids.push(f[0]);
    }
  }
  return { cap: typeof dados.cap === 'string' ? dados.cap : '', ids };
}

/** Os slugs dos capítulos no índice. @param {string} html @param {string} slug */
export function capitulosDoIndice(html, slug) {
  const re = new RegExp(`<a class="ix-card[^"]*" href="/galeria/${slug.replace(/[^a-z0-9-]/g, '')}/([a-z0-9][a-z0-9-]*)"`, 'g');
  return [...new Set([...html.matchAll(re)].map(x => x[1]))];
}

/** @param {string} url */
async function pagina(url) {
  const r = await fetch(url, { headers: { 'User-Agent': UA } });
  if (!r.ok) throw new Error(`${url}: HTTP ${r.status}`);
  return r.text();
}

/**
 * Todas as fotos visíveis do álbum, como ExternalImageId → id do Drive.
 * @param {string} site @param {string} slug
 * @returns {Promise<Map<string, string>>}
 */
async function fotosDoAlbum(site, slug) {
  const base = `${site}/galeria/${slug}`;
  const inicio = await pagina(base);
  /** @type {Map<string, string>} */
  const todas = new Map();
  const unica = fotosDaPagina(inicio);
  if (unica) {
    for (const id of unica.ids) todas.set(idExterno('', id), id);
    return todas;
  }
  for (const cap of capitulosDoIndice(inicio, slug)) {
    const p = fotosDaPagina(await pagina(`${base}/${cap}`));
    if (!p) continue;
    for (const id of p.ids) todas.set(idExterno(cap, id), id);
  }
  return todas;
}

const espera = (/** @type {number} */ ms) => new Promise(r => setTimeout(r, ms));

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
  if (!slugs.length) { console.log('ROSTO_SLUGS vazio: nada a fazer.'); return; }
  if (!seco && (!cred.chave || !cred.segredo)) throw new Error('Faltam AWS_ACCESS_KEY_ID e AWS_SECRET_ACCESS_KEY.');

  /** @type {Record<string, string[]>} fotos já processadas, por álbum (com ou sem rosto) */
  let estado;
  try { estado = JSON.parse(await readFile(arqEstado, 'utf8')); } catch { estado = {}; }

  for (const slug of slugs) {
    const col = colecoes(slug).principal;
    const fotos = await fotosDoAlbum(site, slug);
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

    const novas = [...fotos].filter(([k]) => !vistas.has(k)).slice(0, maxNovas);
    let rostos = 0; let falhas = 0;
    for (const [k, id] of novas) {
      try {
        const r = await fetch(`https://lh3.googleusercontent.com/d/${id}=w1600`, { headers: { 'User-Agent': UA } });
        if (!r.ok) throw new Error(`miniatura HTTP ${r.status}`);
        const bytes = new Uint8Array(await r.arrayBuffer());
        if (bytes.length > 5_000_000) throw new Error('miniatura acima de 5 MB');
        const res = await aws(cred, 'IndexFaces', { CollectionId: col, Image: { Bytes: base64(bytes) }, ExternalImageId: k, MaxFaces: 30, QualityFilter: 'AUTO', DetectionAttributes: [] });
        rostos += (res.FaceRecords || []).length;
        vistas.add(k);
      } catch (e) {
        falhas++;
        console.warn(`[${slug}] ${k}: ${e instanceof Error ? e.message : e}`);
      }
      // A cota padrão em São Paulo é 5 chamadas/s: 4/s deixa a busca respirar.
      await espera(250);
    }
    // Esquece o que saiu do álbum (se voltar, é indexado de novo).
    estado[slug] = [...vistas].filter(k => fotos.has(k));
    console.log(`[${slug}] ${novas.length} fotos novas processadas, ${rostos} rostos indexados, ${falhas} falhas.`);
  }
  await writeFile(arqEstado, JSON.stringify(estado));
}

if (import.meta.url === `file://${process.argv[1]}`) {
  principal().catch(e => { console.error(e instanceof Error ? e.message : e); process.exit(1); });
}
