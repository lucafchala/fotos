// Dois detalhes de lançamento da galeria (v3.1):
//  (a) capítulo vazio: com resumo dizendo 0 fotos some para o visitante, o dono
//      o vê marcado "vazio"; sem resumo aparece; índice todo vazio mostra
//      "As fotos estão chegando";
//  (b) HEIC/HEIF entram na galeria (miniatura e visualização pelo lh3, o Drive
//      gera a miniatura), o download tem a extensão e os bytes originais; vídeos
//      (Live Photo .MOV) ficam fora da galeria e só são contados.

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import worker from '../src/index.js';
import { limpaCacheDrive, listaPasta } from '../src/drive.js';
import { saveEvents } from '../src/utils.js';
import { withDurableObjects } from './helpers/do.js';

const SITE = 'https://fotos.lucafchala.com';
const TOKEN = 'e'.repeat(64);
const RAIZ = 'RAIZ_PASTA_0001';
const CAP_V = 'CAPV_PASTA_0001'; // vazio
const CAP_C = 'CAPC_PASTA_0001'; // cheio
const CAP_N = 'CAPN_PASTA_0001'; // ninguém abriu

const pasta = (id, nome) => ({ id, name: nome, mimeType: 'application/vnd.google-apps.folder' });
const img = (id, name, mimeType = 'image/jpeg', extra = {}) => ({ id, name, mimeType, size: '1000', imageMediaMetadata: { width: 4032, height: 3024 }, ...extra });

let arvore;
let env;
let pend;
let ctx;

function fakeKV(inicial = {}) {
  const store = new Map(Object.entries(inicial));
  return {
    async get(k) { return store.has(k) ? store.get(k) : null; },
    async put(k, v) { store.set(k, v); },
    async delete(k) { store.delete(k); },
    async list() { return { keys: [], list_complete: true, cursor: null }; },
  };
}

beforeEach(() => {
  limpaCacheDrive();
  pend = [];
  ctx = { waitUntil: p => { pend.push(p); } };
  arvore = {};
  vi.stubGlobal('fetch', vi.fn(async input => {
    const url = new URL(typeof input === 'string' ? input : input.url);
    if (url.pathname === '/drive/v3/files') {
      const q = url.searchParams.get('q') || '';
      const id = q.match(/^'([^']+)' in parents/)?.[1];
      const soPastas = q.includes("mimeType = 'application/vnd.google-apps.folder'");
      return Response.json({ files: (arvore[id] || []).filter(f => !soPastas || f.mimeType.endsWith('.folder')) });
    }
    if (url.pathname.startsWith('/drive/v3/files/')) {
      const id = url.pathname.split('/').pop();
      const f = Object.values(arvore).flat().find(x => x.id === id);
      return new Response('BYTES-' + id, { headers: { 'Content-Type': f ? f.mimeType : 'application/octet-stream' } });
    }
    return new Response('nao esperado', { status: 599 });
  }));
  env = withDurableObjects({
    FOTOS: fakeKV({ [`admin_session:${TOKEN}`]: JSON.stringify({ createdAt: Date.now() }) }),
    GOOGLE_DRIVE_API_KEY: 'AIzaChaveDeTeste123',
    SIGNING_SECRET: 's'.repeat(48),
  });
});
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });

const get = async (path, { dono = false } = {}) => {
  const headers = { 'CF-Connecting-IP': '203.0.113.9' };
  if (dono) headers.Cookie = `__Host-session=${TOKEN}`;
  const res = await worker.fetch(new Request(SITE + path, { headers }), env, ctx);
  await Promise.all(pend.splice(0));
  await new Promise(r => setTimeout(r, 0));
  return res;
};
const dadosDaPagina = html => JSON.parse(html.match(/<script type="application\/json" id="g-dados"[^>]*>([\s\S]*?)<\/script>/)[1]);
const nomes = h => [...h.matchAll(/class="ix-nome">([^<]*)</g)].map(m => m[1]);

describe('(a) capítulos vazios no índice', () => {
  beforeEach(async () => {
    arvore = {
      [RAIZ]: [pasta(CAP_V, '01 - Vazio'), pasta(CAP_C, '02 - Cheio'), pasta(CAP_N, '03 - Fechado')],
      [CAP_V]: [],
      [CAP_C]: [img('FOTO_C1_000001', 'c1.jpg')],
      [CAP_N]: [],
    };
    await saveEvents(env, [{ id: '1', slug: 'santa', title: 'Santa', accessType: 'public', galeriaCapitulos: true, driveUrl: `https://drive.google.com/drive/folders/${RAIZ}` }]);
  });

  it('sem resumo ainda, todos aparecem; depois de abrir o vazio, ele some para o visitante', async () => {
    expect(nomes(await (await get('/galeria/santa')).text())).toEqual(['Cheio', 'Fechado', 'Vazio']);
    await get('/galeria/santa/vazio');
    await get('/galeria/santa/cheio');
    // O capítulo "Fechado" ninguém abriu: continua aparecendo.
    const visita = await (await get('/galeria/santa')).text();
    expect(nomes(visita)).toEqual(['Cheio', 'Fechado']);
    expect(visita).toContain('1 foto');
    expect(visita).not.toContain('>vazio<');
  });

  it('o dono vê o capítulo vazio marcado "vazio"', async () => {
    await get('/galeria/santa/vazio');
    const dono = await (await get('/galeria/santa', { dono: true })).text();
    expect(nomes(dono)).toEqual(['Cheio', 'Fechado', 'Vazio']);
    expect(dono).toMatch(/ix-card ix-card-vazio"[^>]*>[\s\S]*?Vazio[\s\S]*?<span class="ix-sub">vazio</);
  });

  it('o capítulo vazio ainda abre pelo endereço direto (página, não erro)', async () => {
    const r = await get('/galeria/santa/vazio');
    expect(r.status).toBe(200);
  });

  it('todos vazios: o visitante lê "As fotos estão chegando"; o dono vê os cartões', async () => {
    arvore[CAP_C] = [];
    for (const s of ['vazio', 'cheio', 'fechado']) await get(`/galeria/santa/${s}`);
    const visita = await (await get('/galeria/santa')).text();
    expect(visita).toContain('As fotos estão chegando');
    expect(visita).not.toContain('class="ix-grade"');
    expect(visita).not.toMatch(/0 eventos/);
    const dono = await (await get('/galeria/santa', { dono: true })).text();
    expect(nomes(dono)).toEqual(['Cheio', 'Fechado', 'Vazio']);
  });
});

describe('(b) HEIC, HEIF e vídeos', () => {
  const RAIZ_H = 'HEIC_PASTA_0001';
  beforeEach(async () => {
    arvore = {
      [RAIZ_H]: [
        img('FOTO_H1_000001', 'IMG_0001.HEIC', 'image/heic', { imageMediaMetadata: { width: 4032, height: 3024, time: '2026:03:14 10:22:33' } }),
        img('FOTO_H2_000001', 'IMG_0002.heif', 'image/heif'),
        img('FOTO_J1_000001', 'IMG_0003.JPG'),
        { id: 'VIDEO_L1_00001', name: 'IMG_0001.MOV', mimeType: 'video/quicktime', size: '9000000' },
        { id: 'VIDEO_L2_00001', name: 'clip.mp4', mimeType: 'video/mp4', size: '9000000' },
      ],
    };
    await saveEvents(env, [{ id: '2', slug: 'iphone', title: 'iPhone', accessType: 'public', nomesAmigaveis: true, driveUrl: `https://drive.google.com/drive/folders/${RAIZ_H}` }]);
  });

  it('HEIC e HEIF entram na listagem; vídeo só é contado', async () => {
    const l = await listaPasta(env, { id: RAIZ_H, resourceKey: '' });
    const ids = l.secoes.flatMap(s => s.fotos.map(f => f[0]));
    expect(ids).toEqual(expect.arrayContaining(['FOTO_H1_000001', 'FOTO_H2_000001', 'FOTO_J1_000001']));
    expect(ids).not.toContain('VIDEO_L1_00001');
    expect(l.total).toBe(3);
    expect(l.videos).toBe(2);
  });

  it('a página leva os ids de HEIC (miniatura e visualização saem do lh3 pelo id) e nenhum vídeo', async () => {
    const html = await (await get('/galeria/iphone')).text();
    expect(html).toContain('lh3.googleusercontent.com');
    const d = dadosDaPagina(html);
    const ids = d.secoes.flatMap(s => s.fotos.map(f => f[0]));
    expect(ids).toContain('FOTO_H1_000001');
    expect(ids).toContain('FOTO_H2_000001');
    expect(ids).not.toContain('VIDEO_L1_00001');
    expect(html).not.toContain('IMG_0001.MOV');
  });

  it('download de HEIC: bytes originais, tipo original e extensão .heic no nome amigável', async () => {
    const r = await get('/galeria/iphone/baixar/FOTO_H1_000001?v=max');
    expect(r.status).toBe(200);
    expect(await r.text()).toBe('BYTES-FOTO_H1_000001');
    expect(r.headers.get('Content-Type')).toBe('image/heic');
    expect(decodeURIComponent(r.headers.get('X-Nome-Arquivo'))).toBe('iPhone - Luca F. Chala - 2026-03-14 10h22m33.heic');
    const r2 = await get('/galeria/iphone/baixar/FOTO_H2_000001?v=max');
    expect(decodeURIComponent(r2.headers.get('X-Nome-Arquivo'))).toMatch(/\.heif$/);
  });

  it('com nomes amigáveis desligados o HEIC mantém o nome exato do Drive', async () => {
    await saveEvents(env, [{ id: '2', slug: 'iphone', title: 'iPhone', accessType: 'public', driveUrl: `https://drive.google.com/drive/folders/${RAIZ_H}` }]);
    const r = await get('/galeria/iphone/baixar/FOTO_H1_000001?v=max');
    expect(decodeURIComponent(r.headers.get('X-Nome-Arquivo'))).toBe('IMG_0001.HEIC');
  });

  it('o vídeo não é baixável pela galeria (não está na listagem)', async () => {
    const r = await get('/galeria/iphone/baixar/VIDEO_L1_00001?v=max');
    expect(r.status).toBe(404);
  });
});
