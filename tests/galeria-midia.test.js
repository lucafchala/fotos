// Todas as mídias da pasta (v3.1, item 1f). O que estes testes prendem:
//  1. A listagem: vídeo vira item (com a duração); .MOV curto de mesmo nome,
//     seção e autor de uma foto é o "vídeo do Live Photo" dela; vídeo longo,
//     sem foto de mesmo nome ou de outro autor continua item; HEIC e RAW
//     (imagem de verdade) são listados.
//  2. A página: o vídeo chega como dado (sem iframe antes do toque), o CSP só
//     libera o player do Drive em página que tem vídeo, JSON-LD de vídeo e
//     og:image que nunca é um vídeo.
//  3. O download: bytes e nome exatos, em fluxo, do vídeo e do vídeo do Live;
//     ocultar a foto esconde o vídeo dela; o formato "redes" não existe para
//     vídeo.
//  4. O que sai do "sumiram": o vídeo absorvido pelo Live não é "sumido".

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import worker from '../src/index.js';
import { limpaCacheDrive, listaPasta, ehVideo, liveDe, temVideo, achaArquivo } from '../src/drive.js';
import { saveEvents } from '../src/utils.js';
import { withDurableObjects } from './helpers/do.js';

const SITE = 'https://fotos.lucafchala.com';
const RAIZ = 'MIDIA_PASTA_0001';
const MAG = 'MIDIA_MAG_00001';

const pasta = (id, name) => ({ id, name, mimeType: 'application/vnd.google-apps.folder' });
const img = (id, name, mimeType = 'image/jpeg', extra = {}) => ({ id, name, mimeType, size: '1000', imageMediaMetadata: { width: 4032, height: 3024 }, ...extra });
const vid = (id, name, segundos, extra = {}) => ({
  id, name, mimeType: name.toLowerCase().endsWith('.mp4') ? 'video/mp4' : 'video/quicktime', size: '9000000',
  ...(segundos === null ? {} : { videoMediaMetadata: { width: 1920, height: 1080, durationMillis: String(segundos * 1000) } }), ...extra,
});

let arvore;
let env;
let pend;
let ctx;

function fakeKV() {
  const store = new Map();
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
      return Response.json({ files: arvore[id] || [] });
    }
    if (url.pathname.startsWith('/drive/v3/files/')) {
      const id = url.pathname.split('/').pop();
      const f = Object.values(arvore).flat().find(x => x.id === id);
      return new Response('BYTES-' + id, { headers: { 'Content-Type': f ? f.mimeType : 'application/octet-stream', 'Content-Length': String(('BYTES-' + id).length) } });
    }
    return new Response('nao esperado', { status: 599 });
  }));
  env = withDurableObjects({ FOTOS: fakeKV(), GOOGLE_DRIVE_API_KEY: 'AIzaChaveDeTeste123', SIGNING_SECRET: 's'.repeat(48) });
});
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });

const evento = (extra = {}) => ({ id: '2', slug: 'midia', title: 'Mídia', accessType: 'public', driveUrl: `https://drive.google.com/drive/folders/${RAIZ}`, ...extra });
const get = async path => {
  const res = await worker.fetch(new Request(SITE + path, { headers: { 'CF-Connecting-IP': '203.0.113.9' } }), env, ctx);
  await Promise.all(pend.splice(0));
  await new Promise(r => setTimeout(r, 0));
  return res;
};
const dadosDaPagina = html => JSON.parse(html.match(/<script type="application\/json" id="g-dados"[^>]*>([\s\S]*?)<\/script>/)[1]);
const raiz = { id: RAIZ, resourceKey: '' };
const todas = l => l.secoes.flatMap(s => s.fotos);
const achaF = (l, id) => todas(l).find(f => f[0] === id);

describe('a listagem com vídeos', () => {
  beforeEach(() => {
    arvore = {
      [RAIZ]: [
        img('FOTO_A_000001', 'IMG_0100.HEIC', 'image/heic', { imageMediaMetadata: { width: 4032, height: 3024, time: '2026:03:14 10:00:00' } }),
        vid('VIDEO_A_00001', 'IMG_0100.MOV', 3),
        img('FOTO_B_000001', 'IMG_0200.HEIC', 'image/heic'),
        vid('VIDEO_B_00001', 'IMG_0200.MOV', 42),
        vid('VIDEO_C_00001', 'passeio.mp4', 75),
        vid('VIDEO_D_00001', 'sem-duracao.mov', null),
        img('FOTO_R_000001', 'DSC_0001.NEF', 'image/x-nikon-nef'),
        img('FOTO_J_000001', 'IMG_0300.jpg'),
        { id: 'DOC_PDF_000001', name: 'lista.pdf', mimeType: 'application/pdf', size: '10' },
      ],
    };
  });

  it('vídeo vira item com a duração em segundos; vídeo sem metadado vira item com duração 0', async () => {
    const l = await listaPasta(env, raiz);
    const v = achaF(l, 'VIDEO_C_00001');
    expect(ehVideo(v)).toBe(true);
    expect(v[7]).toBe(75);
    expect(v[1]).toBe(1920);
    expect(v[2]).toBe(1080);
    expect(achaF(l, 'VIDEO_D_00001')[7]).toBe(0);
    expect(temVideo(l)).toBe(true);
  });

  it('o .MOV curto de mesmo nome é o vídeo do Live da foto, e sai da lista', async () => {
    const l = await listaPasta(env, raiz);
    const f = achaF(l, 'FOTO_A_000001');
    expect(ehVideo(f)).toBe(false);
    expect(liveDe(f)).toEqual({ id: 'VIDEO_A_00001', nome: 'IMG_0100.MOV', bytes: 9000000 });
    expect(achaF(l, 'VIDEO_A_00001')).toBeUndefined();
  });

  it('o vídeo de mesmo nome mas longo (mais de 10 s) continua sendo um item', async () => {
    const l = await listaPasta(env, raiz);
    expect(liveDe(achaF(l, 'FOTO_B_000001'))).toBeNull();
    expect(ehVideo(achaF(l, 'VIDEO_B_00001'))).toBe(true);
  });

  it('contagem: o vídeo absorvido não conta; HEIC e RAW entram; o PDF é "outros"', async () => {
    const l = await listaPasta(env, raiz);
    // fotos: A, B, R, J (4) + vídeos item: B, C, D (3)
    expect(l.total).toBe(7);
    expect(l.videos).toBe(3);
    expect(l.outros).toBe(1);
    expect(achaF(l, 'FOTO_R_000001')).toBeDefined();
  });

  it('só pareia dentro da mesma seção e do mesmo autor', async () => {
    arvore = {
      [RAIZ]: [
        img('FOTO_A_000001', 'IMG_0100.HEIC', 'image/heic'),
        pasta(MAG, 'Mag'),
      ],
      [MAG]: [vid('VIDEO_M_00001', 'IMG_0100.MOV', 2)],
    };
    const l = await listaPasta(env, raiz, { creditos: 'mag = Mag' });
    expect(liveDe(achaF(l, 'FOTO_A_000001'))).toBeNull();
    expect(ehVideo(achaF(l, 'VIDEO_M_00001'))).toBe(true);
    expect(l.aut).toContain('Mag');
  });

  it('com a foto e o vídeo na pasta do mesmo autor, o par se forma', async () => {
    arvore = {
      [RAIZ]: [pasta(MAG, 'Mag')],
      [MAG]: [img('FOTO_M_000001', 'IMG_0100.HEIC', 'image/heic'), vid('VIDEO_M_00001', 'img_0100.mov', 2)],
    };
    const l = await listaPasta(env, raiz, { creditos: 'mag = Mag' });
    expect(liveDe(achaF(l, 'FOTO_M_000001'))).toMatchObject({ id: 'VIDEO_M_00001' });
    expect(l.total).toBe(1);
    expect(l.videos).toBe(0);
  });

  it('achaArquivo: o vídeo do Live resolve para o dono dele; o id solto não existe', async () => {
    const l = await listaPasta(env, raiz);
    const live = achaArquivo(l, 'VIDEO_A_00001');
    expect(live.foto[0]).toBe('FOTO_A_000001');
    expect(live.live).toBe(true);
    expect(live.arquivo[0]).toBe('VIDEO_A_00001');
    expect(achaArquivo(l, 'FOTO_J_000001').live).toBe(false);
    expect(achaArquivo(l, 'NAO_EXISTE_0001')).toBeNull();
  });
});

describe('a página da galeria com vídeos', () => {
  beforeEach(async () => {
    arvore = {
      [RAIZ]: [
        vid('VIDEO_C_00001', 'aaa-passeio.mp4', 75),
        img('FOTO_J_000001', 'zzz.jpg'),
      ],
    };
    await saveEvents(env, [evento()]);
  });

  it('o vídeo é um item da grade: dado com a duração, sem iframe nem player antes do toque', async () => {
    const res = await get('/galeria/midia');
    expect(res.status).toBe(200);
    const html = await res.text();
    const d = dadosDaPagina(html);
    const v = d.secoes.flatMap(s => s.fotos).find(f => f[0] === 'VIDEO_C_00001');
    expect(v[9]).toBe(75);
    // O iframe do player só é criado no navegador, depois do toque.
    expect(html).not.toMatch(/<iframe[^>]*drive\.google\.com/);
    expect(html).not.toMatch(/<video[\s>]/);
  });

  it('o CSP libera o player do Drive só em página que tem vídeo', async () => {
    const com = (await get('/galeria/midia')).headers.get('Content-Security-Policy');
    expect(com).toMatch(/frame-src [^;]*https:\/\/drive\.google\.com/);
    arvore[RAIZ] = [img('FOTO_J_000001', 'zzz.jpg')];
    limpaCacheDrive();
    const sem = (await get('/galeria/midia')).headers.get('Content-Security-Policy');
    expect(sem).toMatch(/frame-src /);
    expect(sem.match(/frame-src [^;]*/)[0]).not.toContain('drive.google.com');
  });

  it('JSON-LD tem VideoObject com a duração ISO-8601 e a página fala em fotos e vídeos', async () => {
    const html = await (await get('/galeria/midia')).text();
    expect(html).toContain('"@type":"VideoObject"');
    expect(html).toContain('"duration":"PT1M15S"');
    expect(html).toContain('1 foto e 1 vídeo');
  });

  it('o og:image nunca é um vídeo: usa a primeira foto', async () => {
    const html = await (await get('/galeria/midia')).text();
    const og = html.match(/<meta property="og:image" content="([^"]+)"/)?.[1] || '';
    expect(og).toContain('FOTO_J_000001');
    expect(og).not.toContain('VIDEO_C_00001');
  });

  it('o sitemap da galeria não lista vídeo', async () => {
    const xml = await (await get('/sitemap-galeria-midia.xml')).text();
    expect(xml).not.toContain('VIDEO_C_00001');
    expect(xml).toContain('FOTO_J_000001');
  });

  it('a página só de fotos não menciona vídeo no CSP nem no contador', async () => {
    arvore[RAIZ] = [img('FOTO_J_000001', 'zzz.jpg')];
    limpaCacheDrive();
    const res = await get('/galeria/midia');
    const html = await res.text();
    expect(html).not.toContain('"@type":"VideoObject"');
    expect(res.headers.get('Content-Security-Policy').match(/frame-src [^;]*/)[0]).not.toContain('drive.google.com');
  });
});

describe('o download de vídeo', () => {
  beforeEach(async () => {
    arvore = {
      [RAIZ]: [
        img('FOTO_A_000001', 'IMG_0100.HEIC', 'image/heic', { imageMediaMetadata: { width: 4032, height: 3024, time: '2026:03:14 10:00:00' } }),
        vid('VIDEO_A_00001', 'IMG_0100.MOV', 3),
        vid('VIDEO_C_00001', 'passeio.mp4', 75),
      ],
    };
    await saveEvents(env, [evento({ nomesAmigaveis: true })]);
  });

  it('vídeo avulso: 200, bytes exatos em fluxo, tipo original e nome com .mp4', async () => {
    const r = await get('/galeria/midia/baixar/VIDEO_C_00001?v=max');
    expect(r.status).toBe(200);
    expect(r.headers.get('Content-Type')).toBe('video/mp4');
    expect(await r.text()).toBe('BYTES-VIDEO_C_00001');
    expect(decodeURIComponent(r.headers.get('X-Nome-Arquivo'))).toBe('Mídia - Luca F. Chala - 002.mp4');
  });

  it('o vídeo do Live baixa com o nome da foto e a extensão .mov', async () => {
    const r = await get('/galeria/midia/baixar/VIDEO_A_00001?v=max');
    expect(r.status).toBe(200);
    expect(await r.text()).toBe('BYTES-VIDEO_A_00001');
    expect(decodeURIComponent(r.headers.get('X-Nome-Arquivo'))).toBe('Mídia - Luca F. Chala - 2026-03-14 10h00m00.mov');
  });

  it('sem nomes amigáveis o nome é o do Drive', async () => {
    await saveEvents(env, [evento()]);
    const r = await get('/galeria/midia/baixar/VIDEO_A_00001?v=max');
    expect(decodeURIComponent(r.headers.get('X-Nome-Arquivo'))).toBe('IMG_0100.MOV');
  });

  it('o formato "redes" (Instagram) não existe para vídeo nem para o vídeo do Live', async () => {
    expect((await get('/galeria/midia/baixar/VIDEO_C_00001?v=redes')).status).toBe(404);
    expect((await get('/galeria/midia/baixar/VIDEO_A_00001?v=redes')).status).toBe(404);
  });

  it('o sonda (?p=1) responde 204 sem baixar os bytes', async () => {
    const r = await get('/galeria/midia/baixar/VIDEO_C_00001?v=max&p=1');
    expect(r.status).toBe(204);
  });

  it('id que não está na listagem é 404', async () => {
    expect((await get('/galeria/midia/baixar/NAO_EXISTE_0001?v=max')).status).toBe(404);
  });

  it('ocultar a foto do Live esconde o vídeo dela; ocultar o vídeo avulso o esconde', async () => {
    await saveEvents(env, [evento({ nomesAmigaveis: true, fotosOcultas: ['FOTO_A_000001', 'VIDEO_C_00001'] })]);
    expect((await get('/galeria/midia/baixar/VIDEO_A_00001?v=max')).status).toBe(404);
    expect((await get('/galeria/midia/baixar/VIDEO_C_00001?v=max')).status).toBe(404);
  });
});

describe('vídeo e a detecção de sumiços', () => {
  it('o vídeo absorvido pelo Live Photo não é tratado como arquivo que sumiu', async () => {
    const { detectaSumidas } = await import('../src/sumiram.js');
    arvore = { [RAIZ]: [img('FOTO_A_000001', 'IMG_0100.HEIC', 'image/heic'), vid('VIDEO_A_00001', 'IMG_0100.MOV', 3)] };
    const nova = await listaPasta(env, raiz);
    // A leitura de antes, ainda sem o pareamento: o vídeo era um item solto.
    const anterior = JSON.parse(JSON.stringify(nova));
    anterior.secoes[0].fotos[0][7] = undefined;
    anterior.secoes[0].fotos.push(['VIDEO_A_00001', 1920, 1080, 'IMG_0100.MOV', 9000000, 0, 0, 3]);
    fetch.mockClear();
    await detectaSumidas(env, { evento: { slug: 'midia', title: 'Mídia' }, capitulo: '', maxChamadas: 40 }, anterior, nova);
    const consultados = fetch.mock.calls.map(c => String(typeof c[0] === 'string' ? c[0] : c[0].url));
    expect(consultados.some(u => u.includes('VIDEO_A_00001'))).toBe(false);
  });

  it('já um vídeo avulso que de fato sumiu é conferido como qualquer foto', async () => {
    const { detectaSumidas } = await import('../src/sumiram.js');
    arvore = { [RAIZ]: [img('FOTO_J_000001', 'a.jpg')] };
    const nova = await listaPasta(env, raiz);
    const anterior = JSON.parse(JSON.stringify(nova));
    anterior.secoes[0].fotos.push(['VIDEO_C_00001', 1920, 1080, 'passeio.mp4', 9000000, 0, 0, 75]);
    fetch.mockClear();
    await detectaSumidas(env, { evento: { slug: 'midia', title: 'Mídia' }, capitulo: '', maxChamadas: 40 }, anterior, nova);
    const consultados = fetch.mock.calls.map(c => String(typeof c[0] === 'string' ? c[0] : c[0].url));
    expect(consultados.some(u => u.includes('VIDEO_C_00001'))).toBe(true);
  });
});
