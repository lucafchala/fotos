// O vídeo tocado no próprio site (v4.3.0, rota /galeria/<slug>/video/<id>).
// O que estes testes prendem:
//  1. Os cabeçalhos Range que a rota aceita (um trecho só; o resto é 416).
//  2. As mesmas portas do download: id fora da pasta, oculto, foto ou vídeo
//     do Live Photo, capítulo errado — tudo 404.
//  3. Range repassado ao Google montado por ESTE código (206 + Content-Range),
//     sem anexo, e o R2 servindo trechos quando já tem a cópia.
//  4. Só o play do começo copia para o R2; pular para o meio não copia.
//  5. (O balde de limite próprio está em galeria-video-limite.test.js.)
//  6. A CSP: media-src 'self' só em página com vídeo.

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import worker from '../src/index.js';
import { limpaCacheDrive } from '../src/drive.js';
import { intervaloPedido, fatiaDoTotal, videoDoR2 } from '../src/foto-rota.js';
import { saveEvents } from '../src/utils.js';
import { withDurableObjects } from './helpers/do.js';
import { r2Falso } from './helpers/r2.js';

const SITE = 'https://fotos.lucafchala.com';
const RAIZ = 'VIDEO_PASTA_001';
const CORPO = '0123456789abcdefghij'; // 20 bytes

const img = (id, name) => ({ id, name, mimeType: 'image/jpeg', size: '1000', imageMediaMetadata: { width: 4032, height: 3024 } });
const vid = (id, name, segundos) => ({
  id, name, mimeType: name.toLowerCase().endsWith('.mp4') ? 'video/mp4' : 'video/quicktime', size: String(CORPO.length),
  videoMediaMetadata: { width: 1080, height: 1920, durationMillis: String(segundos * 1000) },
});

let arvore;
let env;
let pend;
let ctx;
/** @type {string[]} */
let rangesNoGoogle;

function fakeKV() {
  const store = new Map();
  return {
    async get(k) { return store.has(k) ? store.get(k) : null; },
    async put(k, v) { store.set(k, v); },
    async delete(k) { store.delete(k); },
    async list() { return { keys: [], list_complete: true, cursor: null }; },
  };
}

/** O Google de mentira: devolve trechos de CORPO como o alt=media de verdade. */
function respostaDoGoogle(range, tipo) {
  if (!range) return new Response(CORPO, { headers: { 'Content-Type': tipo, 'Content-Length': String(CORPO.length) } });
  const m = /^bytes=(\d*)-(\d*)$/.exec(range);
  let a; let b;
  if (!m[1]) { a = Math.max(0, CORPO.length - Number(m[2])); b = CORPO.length - 1; } else { a = Number(m[1]); b = m[2] ? Math.min(Number(m[2]), CORPO.length - 1) : CORPO.length - 1; }
  if (a >= CORPO.length) return new Response('', { status: 416, headers: { 'Content-Range': `bytes */${CORPO.length}` } });
  const fatia = CORPO.slice(a, b + 1);
  return new Response(fatia, { status: 206, headers: { 'Content-Type': tipo, 'Content-Length': String(fatia.length), 'Content-Range': `bytes ${a}-${b}/${CORPO.length}` } });
}

beforeEach(() => {
  limpaCacheDrive();
  pend = [];
  rangesNoGoogle = [];
  ctx = { waitUntil: p => { pend.push(p); } };
  arvore = {
    [RAIZ]: [
      img('FOTO_A_000001', 'IMG_0100.HEIC'),
      vid('VIDEO_LIVE_001', 'IMG_0100.MOV', 3),
      vid('VIDEO_REEL_001', 'passeio.mp4', 30),
      img('FOTO_J_000001', 'zzz.jpg'),
    ],
  };
  vi.stubGlobal('fetch', vi.fn(async (input, init = {}) => {
    const url = new URL(typeof input === 'string' ? input : input.url);
    if (url.pathname === '/drive/v3/files') {
      const id = (url.searchParams.get('q') || '').match(/^'([^']+)' in parents/)?.[1];
      return Response.json({ files: arvore[id] || [] });
    }
    if (url.pathname.startsWith('/drive/v3/files/')) {
      const id = url.pathname.split('/').pop();
      const f = Object.values(arvore).flat().find(x => x.id === id);
      const range = new Headers(init.headers || {}).get('Range');
      rangesNoGoogle.push(range || '');
      return respostaDoGoogle(range, f ? f.mimeType : 'application/octet-stream');
    }
    return new Response('nao esperado', { status: 599 });
  }));
  env = withDurableObjects({ FOTOS: fakeKV(), GOOGLE_DRIVE_API_KEY: 'AIzaChaveDeTeste123', SIGNING_SECRET: 's'.repeat(48) });
});
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });

const evento = (extra = {}) => ({ id: '2', slug: 'reel', title: 'Reel', accessType: 'public', driveUrl: `https://drive.google.com/drive/folders/${RAIZ}`, ...extra });
const req = async (path, headers = {}, method = 'GET') => {
  const res = await worker.fetch(new Request(SITE + path, { method, headers: { 'CF-Connecting-IP': '203.0.113.9', ...headers } }), env, ctx);
  await Promise.all(pend.splice(0));
  await new Promise(r => setTimeout(r, 0));
  return res;
};
const V = '/galeria/reel/video/VIDEO_REEL_001';

describe('intervaloPedido', () => {
  it('sem cabeçalho é null (o arquivo inteiro)', () => {
    expect(intervaloPedido(null)).toBeNull();
    expect(intervaloPedido(undefined)).toBeNull();
  });
  it('lê início-fim, início- e -sufixo', () => {
    expect(intervaloPedido('bytes=0-')).toEqual({ offset: 0 });
    expect(intervaloPedido('bytes=5-9')).toEqual({ offset: 5, length: 5 });
    expect(intervaloPedido('bytes=-4')).toEqual({ suffix: 4 });
    expect(intervaloPedido(' bytes=7-7 ')).toEqual({ offset: 7, length: 1 });
  });
  it('o resto é inválido: vários trechos, fim antes do início, sufixo zero, unidade errada, lixo', () => {
    for (const ruim of ['bytes=0-1,4-5', 'bytes=9-5', 'bytes=-0', 'bytes=-', 'items=0-5', 'bytes=a-b', 'bytes=1234567890123456-', '']) {
      expect(intervaloPedido(ruim), ruim).toBe('invalido');
    }
  });
});

describe('fatiaDoTotal', () => {
  it('corta o fim no tamanho do arquivo e resolve o sufixo', () => {
    expect(fatiaDoTotal({ offset: 0 }, 20)).toEqual({ inicio: 0, fim: 19 });
    expect(fatiaDoTotal({ offset: 15, length: 100 }, 20)).toEqual({ inicio: 15, fim: 19 });
    expect(fatiaDoTotal({ suffix: 5 }, 20)).toEqual({ inicio: 15, fim: 19 });
    expect(fatiaDoTotal({ suffix: 50 }, 20)).toEqual({ inicio: 0, fim: 19 });
  });
  it('começo depois do fim, ou tamanho desconhecido, é null', () => {
    expect(fatiaDoTotal({ offset: 20 }, 20)).toBeNull();
    expect(fatiaDoTotal({ offset: 0 }, 0)).toBeNull();
  });
});

describe('videoDoR2', () => {
  it('sem R2 ou sem cópia é null; com cópia devolve o trecho certo', async () => {
    expect(await videoDoR2({}, 'X', null)).toBeNull();
    const r2 = r2Falso();
    expect(await videoDoR2({ FOTOS_R2: r2 }, 'VIDEO_REEL_001', { offset: 0 })).toBeNull();
    await r2.put('o/VIDEO_REEL_001', CORPO, { httpMetadata: { contentType: 'video/mp4' } });
    const inteiro = await videoDoR2({ FOTOS_R2: r2 }, 'VIDEO_REEL_001', null);
    expect(inteiro.fatia).toBeNull();
    expect(await new Response(inteiro.body).text()).toBe(CORPO);
    const trecho = await videoDoR2({ FOTOS_R2: r2 }, 'VIDEO_REEL_001', { offset: 2, length: 3 });
    expect(trecho.fatia).toEqual({ inicio: 2, fim: 4 });
    expect(trecho.total).toBe(20);
    expect(await new Response(trecho.body).text()).toBe('234');
    expect(await videoDoR2({ FOTOS_R2: r2 }, 'VIDEO_REEL_001', { offset: 99 })).toBe('fora');
  });
  it('R2 que lança vira null (o Drive assume)', async () => {
    const quebrado = { head: async () => { throw new Error('R2 fora'); }, get: async () => { throw new Error('R2 fora'); } };
    vi.spyOn(console, 'error').mockImplementation(() => {});
    expect(await videoDoR2({ FOTOS_R2: quebrado }, 'X', null)).toBeNull();
    expect(await videoDoR2({ FOTOS_R2: quebrado }, 'X', { offset: 0 })).toBeNull();
  });
});

describe('a rota de vídeo', () => {
  beforeEach(async () => { await saveEvents(env, [evento()]); });

  it('sem Range: 200, o arquivo inteiro, tipo do vídeo, aceita Range, sem anexo, noindex', async () => {
    const r = await req(V);
    expect(r.status).toBe(200);
    expect(await r.text()).toBe(CORPO);
    expect(r.headers.get('Content-Type')).toBe('video/mp4');
    expect(r.headers.get('Accept-Ranges')).toBe('bytes');
    expect(r.headers.get('Content-Disposition') || '').not.toMatch(/attachment/);
    expect(r.headers.get('X-Robots-Tag')).toMatch(/noindex/);
    expect(r.headers.get('X-Content-Type-Options')).toBe('nosniff');
    expect(r.headers.get('Cache-Control')).toMatch(/private/);
    expect(rangesNoGoogle).toEqual(['']);
  });

  it('com Range: 206, Content-Range e só o trecho', async () => {
    const r = await req(V, { Range: 'bytes=5-9' });
    expect(r.status).toBe(206);
    expect(r.headers.get('Content-Range')).toBe('bytes 5-9/20');
    expect(await r.text()).toBe('56789');
    expect(rangesNoGoogle).toEqual(['bytes=5-9']);
  });

  it('o Range que vai ao Google é remontado, não copiado do visitante', async () => {
    await req(V, { Range: 'bytes=0003-' });
    await req(V, { Range: 'bytes=-4' });
    expect(rangesNoGoogle).toEqual(['bytes=3-', 'bytes=-4']);
  });

  it('Range inválido é 416 sem ir ao Google', async () => {
    const r = await req(V, { Range: 'bytes=0-1,5-6' });
    expect(r.status).toBe(416);
    expect(rangesNoGoogle).toEqual([]);
  });

  it('Range depois do fim do arquivo é 416 com o tamanho', async () => {
    const r = await req(V, { Range: 'bytes=50-' });
    expect(r.status).toBe(416);
    expect(r.headers.get('Content-Range')).toBe('bytes */20');
  });

  it('HEAD responde os cabeçalhos sem corpo', async () => {
    const r = await req(V, {}, 'HEAD');
    expect(r.status).toBe(200);
    expect(r.headers.get('Accept-Ranges')).toBe('bytes');
    expect(await r.text()).toBe('');
  });

  it('POST não é rota', async () => {
    expect((await req(V, {}, 'POST')).status).not.toBe(200);
  });

  it('id fora da pasta, foto, vídeo do Live Photo e id malformado são 404', async () => {
    expect((await req('/galeria/reel/video/NAO_EXISTE_0001')).status).toBe(404);
    expect((await req('/galeria/reel/video/FOTO_J_000001')).status).toBe(404);
    expect((await req('/galeria/reel/video/VIDEO_LIVE_001')).status).toBe(404);
    expect((await req('/galeria/reel/video/curto')).status).toBe(404);
    expect((await req('/galeria/outro/video/VIDEO_REEL_001')).status).toBe(404);
  });

  it('vídeo oculto é 404 para o visitante', async () => {
    await saveEvents(env, [evento({ fotosOcultas: ['VIDEO_REEL_001'] })]);
    expect((await req(V)).status).toBe(404);
  });

  it('galeria com capítulos não aceita a rota sem capítulo (e vice-versa)', async () => {
    expect((await req('/galeria/reel/cap-1/video/VIDEO_REEL_001')).status).toBe(404);
    await saveEvents(env, [evento({ galeriaCapitulos: true })]);
    expect((await req(V)).status).toBe(404);
  });

  it('galeria privada (sem acesso) é 404', async () => {
    await saveEvents(env, [evento({ accessType: 'private' })]);
    expect((await req(V)).status).toBe(404);
  });
});

describe('o vídeo e o R2', () => {
  beforeEach(async () => {
    env.FOTOS_R2 = r2Falso();
    await saveEvents(env, [evento()]);
  });

  it('o play do começo (bytes=0-) copia para o R2; o seguinte sai de lá, sem o Google', async () => {
    const r = await req(V, { Range: 'bytes=0-' });
    expect(r.status).toBe(206);
    await r.text();
    expect(env.FOTOS_R2.gravadas).toEqual(['o/VIDEO_REEL_001']);
    rangesNoGoogle = [];
    const s = await req(V, { Range: 'bytes=10-14' });
    expect(s.status).toBe(206);
    expect(s.headers.get('Content-Range')).toBe('bytes 10-14/20');
    expect(s.headers.get('Content-Length')).toBe('5');
    expect(await s.text()).toBe('abcde');
    expect(rangesNoGoogle).toEqual([]);
    const fora = await req(V, { Range: 'bytes=20-' });
    expect(fora.status).toBe(416);
    expect(fora.headers.get('Content-Range')).toBe('bytes */20');
    const inteiro = await req(V);
    expect(inteiro.status).toBe(200);
    expect(await inteiro.text()).toBe(CORPO);
  });

  it('pular para o meio e a sonda de 2 bytes do Safari não copiam', async () => {
    await (await req(V, { Range: 'bytes=8-' })).text();
    await (await req(V, { Range: 'bytes=0-1' })).text();
    expect(env.FOTOS_R2.gravadas).toEqual([]);
  });

  it('vídeo oculto não sai do R2', async () => {
    await env.FOTOS_R2.put('o/VIDEO_REEL_001', CORPO, { httpMetadata: { contentType: 'video/mp4' } });
    await saveEvents(env, [evento({ fotosOcultas: ['VIDEO_REEL_001'] })]);
    expect((await req(V, { Range: 'bytes=0-' })).status).toBe(404);
  });
});

describe('a CSP da página com vídeo', () => {
  it("libera media-src 'self' só onde há vídeo", async () => {
    await saveEvents(env, [evento()]);
    const com = (await req('/galeria/reel')).headers.get('Content-Security-Policy');
    expect(com).toMatch(/media-src 'self'/);
    arvore[RAIZ] = [img('FOTO_J_000001', 'zzz.jpg')];
    limpaCacheDrive();
    const sem = (await req('/galeria/reel')).headers.get('Content-Security-Policy');
    expect(sem).toMatch(/media-src 'none'/);
  });
});
