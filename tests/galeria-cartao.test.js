// Cartão de link (Open Graph / Twitter) da galeria (v3.1, item i). O que estes
// testes prendem:
//  1. capítulo: título "<Capítulo> · <Projeto>", descrição com a contagem e os
//     créditos, og:url canônico do capítulo, capa = primeira foto DO CAPÍTULO
//     (1200x630, com largura e altura), sem as ocultas; sem foto, cai na capa do
//     projeto;
//  2. índice: título do projeto, og:url do índice, capa com dimensões, contagem
//     de eventos e de fotos (do resumo);
//  3. álbum família/privado: um robô (sem o passe) recebe 404, e MESMO quem tem
//     acesso recebe um cartão genérico — sem a capa e sem o nome do capítulo.

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import worker from '../src/index.js';
import { limpaCacheDrive } from '../src/drive.js';
import { saveEvents } from '../src/utils.js';
import { withDurableObjects } from './helpers/do.js';

const SITE = 'https://fotos.lucafchala.com';
const TOKEN = 'e'.repeat(64);
const RAIZ = 'RAIZ_PASTA_0001';
const CAP_A = 'CAPA_PASTA_0001';
const CAP_V = 'CAPV_PASTA_0001'; // sem fotos
const arq = (id, nome) => ({ id, name: nome, mimeType: 'image/jpeg', size: '1000', imageMediaMetadata: { width: 3000, height: 2000 } });
const pasta = (id, nome) => ({ id, name: nome, mimeType: 'application/vnd.google-apps.folder' });
const COVER = 'https://lh3.googleusercontent.com/d/CAPA_PROJETO_0001=s0';
let arvore;

function fakeKV(inicial = {}) {
  const store = new Map(Object.entries(inicial));
  return {
    async get(k) { return store.has(k) ? store.get(k) : null; },
    async put(k, v) { store.set(k, v); },
    async delete(k) { store.delete(k); },
    async list() { return { keys: [], list_complete: true, cursor: null }; },
  };
}

let env;
let pend;
let ctx;
const EVENTO = { id: '1', slug: 'formatura', title: 'Formatura 2026', accessType: 'public', galeriaCapitulos: true, driveUrl: `https://drive.google.com/drive/folders/${RAIZ}` };

beforeEach(async () => {
  limpaCacheDrive();
  pend = [];
  ctx = { waitUntil: p => { pend.push(p); } };
  arvore = {
    [RAIZ]: [pasta(CAP_A, '01 - Abertura'), pasta(CAP_V, '02 - Festa')],
    [CAP_A]: [arq('FOTO_A1_000001', 'a1.jpg'), arq('FOTO_A2_000001', 'a2.jpg')],
    [CAP_V]: [],
  };
  vi.stubGlobal('fetch', vi.fn(async input => {
    const url = new URL(typeof input === 'string' ? input : input.url);
    if (url.pathname === '/drive/v3/files') {
      const q = url.searchParams.get('q') || '';
      const id = q.match(/^'([^']+)' in parents/)?.[1];
      const soPastas = q.includes("mimeType = 'application/vnd.google-apps.folder'");
      return Response.json({ files: (arvore[id] || []).filter(f => !soPastas || f.mimeType.endsWith('.folder')) });
    }
    return new Response('nao esperado', { status: 599 });
  }));
  env = withDurableObjects({
    FOTOS: fakeKV({ [`admin_session:${TOKEN}`]: JSON.stringify({ createdAt: Date.now() }) }),
    GOOGLE_DRIVE_API_KEY: 'AIzaChaveDeTeste123',
    SIGNING_SECRET: 's'.repeat(48),
  });
  await saveEvents(env, [structuredClone(EVENTO)]);
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
const meta = (h, nome) => h.match(new RegExp(`<meta (?:property|name)="${nome}" content="([^"]*)"`))?.[1];
// `&amp;` por último: decodificado antes, `&amp;quot;` viraria `"` (duas vezes).
const decodifica = t => t.replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&amp;/g, '&');

describe('cartão de UMA foto (?foto=, v3.9.0)', () => {
  it('o link da foto mostra a própria foto no cartão, pelo ID inteiro ou pelo código curto', async () => {
    for (const cod of ['FOTO_A2_000001', 'FOTO_A2_00']) {
      const h = await (await get(`/galeria/formatura/abertura?foto=${cod}`)).text();
      expect(meta(h, 'og:image')).toBe('https://lh3.googleusercontent.com/d/FOTO_A2_000001=w1200-h630-c');
      expect(decodifica(meta(h, 'og:title'))).toBe('Uma foto de Abertura');
      expect(meta(h, 'og:url')).toBe(`${SITE}/galeria/formatura/abertura?foto=${cod}`);
      // O canônico continua a página do evento (a busca não indexa cada foto).
      expect(h).toContain(`<link rel="canonical" href="${SITE}/galeria/formatura/abertura">`);
    }
  });

  it('código que não é desta página, foto oculta ou lixo: o cartão normal do evento', async () => {
    await saveEvents(env, [{ ...EVENTO, fotosOcultas: ['FOTO_A2_000001'] }]);
    for (const cod of ['FOTO_A2_000001', 'NAO_EXISTE_0001', '"><script>', '']) {
      const h = await (await get(`/galeria/formatura/abertura?foto=${encodeURIComponent(cod)}`)).text();
      expect(meta(h, 'og:image')).toBe('https://lh3.googleusercontent.com/d/FOTO_A1_000001=w1200-h630-c');
      expect(decodifica(meta(h, 'og:title'))).toBe('Abertura · Formatura 2026');
      expect(meta(h, 'og:url')).toBe(`${SITE}/galeria/formatura/abertura`);
    }
  });

  it('a grade, o compartilhar e a barra de endereço usam ?foto=', async () => {
    const h = await (await get('/galeria/formatura/abertura')).text();
    expect(h).toContain("a.href = '?foto=' + codigoDe(f[0]);");
    expect(h).toContain("const link = location.origin + enderecoDaFoto(f.id);");
    expect(h).toContain("history.pushState({ g: 'foto' }, '', enderecoDaFoto(f.id));");
  });
});

describe('cartão do capítulo', () => {
  it('título "<Capítulo> · <Projeto>", url canônica e capa = primeira foto do capítulo em 1200x630', async () => {
    const h = await (await get('/galeria/formatura/abertura')).text();
    expect(decodifica(meta(h, 'og:title'))).toBe('Abertura · Formatura 2026');
    expect(decodifica(meta(h, 'twitter:title'))).toBe('Abertura · Formatura 2026');
    expect(meta(h, 'og:url')).toBe(`${SITE}/galeria/formatura/abertura`);
    expect(h).toContain(`<link rel="canonical" href="${SITE}/galeria/formatura/abertura">`);
    expect(meta(h, 'og:image')).toBe('https://lh3.googleusercontent.com/d/FOTO_A1_000001=w1200-h630-c');
    expect(meta(h, 'twitter:image')).toBe(meta(h, 'og:image'));
    expect(meta(h, 'og:image:width')).toBe('1200');
    expect(meta(h, 'og:image:height')).toBe('630');
    expect(meta(h, 'twitter:card')).toBe('summary_large_image');
  });

  it('a descrição traz a contagem; com mais de um autor, os créditos', async () => {
    let h = await (await get('/galeria/formatura/abertura')).text();
    expect(meta(h, 'og:description')).toMatch(/^2 fotos/);
    expect(meta(h, 'og:description')).not.toContain('Fotos: ');
    arvore[CAP_A].push(pasta('PASTA_MAG_00001', 'Mag'));
    arvore.PASTA_MAG_00001 = [arq('FOTO_M1_000001', 'm1.jpg')];
    await saveEvents(env, [{ ...EVENTO, galeriaCreditos: 'mag = Mag' }]);
    limpaCacheDrive();
    h = await (await get('/galeria/formatura/abertura')).text();
    expect(meta(h, 'og:description')).toMatch(/^3 fotos · Fotos: Luca F\. Chala e Mag/);
  });

  it('a capa do capítulo vence a capa do projeto; foto oculta nunca é a capa', async () => {
    await saveEvents(env, [{ ...EVENTO, thumbnailUrl: COVER, fotosOcultas: ['FOTO_A1_000001'] }]);
    const h = await (await get('/galeria/formatura/abertura')).text();
    expect(meta(h, 'og:image')).toBe('https://lh3.googleusercontent.com/d/FOTO_A2_000001=w1200-h630-c');
    expect(h).not.toContain('FOTO_A1_000001');
  });

  it('capítulo sem fotos cai na capa do projeto', async () => {
    await saveEvents(env, [{ ...EVENTO, thumbnailUrl: COVER }]);
    const h = await (await get('/galeria/formatura/festa')).text();
    expect(meta(h, 'og:image')).toBe('https://lh3.googleusercontent.com/d/CAPA_PROJETO_0001=w1200-h630-c');
    expect(decodifica(meta(h, 'og:title'))).toBe('Festa · Formatura 2026');
  });

  it('sem capítulos o cartão é o de sempre: capa do projeto primeiro', async () => {
    await saveEvents(env, [{ ...EVENTO, galeriaCapitulos: false, thumbnailUrl: COVER }]);
    arvore[RAIZ] = [arq('FOTO_R1_000001', 'r1.jpg')];
    const h = await (await get('/galeria/formatura')).text();
    expect(meta(h, 'og:image')).toBe('https://lh3.googleusercontent.com/d/CAPA_PROJETO_0001=w1200-h630-c');
    expect(decodifica(meta(h, 'og:title'))).toBe('Fotos de Formatura 2026');
  });
});

describe('cartão do índice', () => {
  it('título do projeto, url do índice, capa com dimensões e contagem de eventos e fotos', async () => {
    await get('/galeria/formatura/abertura'); // grava o resumo do capítulo
    const h = await (await get('/galeria/formatura')).text();
    expect(decodifica(meta(h, 'og:title'))).toBe('Fotos de Formatura 2026');
    expect(meta(h, 'og:url')).toBe(`${SITE}/galeria/formatura`);
    expect(meta(h, 'og:image')).toBe('https://lh3.googleusercontent.com/d/FOTO_A1_000001=w1200-h630-c');
    expect(meta(h, 'og:image:width')).toBe('1200');
    expect(meta(h, 'og:image:height')).toBe('630');
    expect(meta(h, 'og:description')).toMatch(/2 eventos · 2 fotos/);
  });

  it('a capa cadastrada do projeto vale no índice', async () => {
    await saveEvents(env, [{ ...EVENTO, thumbnailUrl: COVER }]);
    const h = await (await get('/galeria/formatura')).text();
    expect(meta(h, 'og:image')).toBe('https://lh3.googleusercontent.com/d/CAPA_PROJETO_0001=w1200-h630-c');
  });
});

describe('álbum família/privado não vaza capa nem capítulo no cartão', () => {
  beforeEach(async () => {
    await saveEvents(env, [{ ...EVENTO, accessType: 'family', thumbnailUrl: COVER }]);
  });

  it('um robô (sem o passe) recebe 404, sem nada do álbum', async () => {
    for (const caminho of ['/galeria/formatura', '/galeria/formatura/abertura']) {
      const res = await get(caminho);
      expect(res.status, caminho).toBe(404);
      const corpo = await res.text();
      expect(corpo, caminho).not.toContain('og:image');
      expect(corpo, caminho).not.toContain('Abertura');
      expect(corpo, caminho).not.toContain('FOTO_A1_000001');
      expect(corpo, caminho).not.toContain('CAPA_PROJETO_0001');
    }
  });

  it('quem tem acesso (o dono) recebe um cartão genérico: sem capa, sem capítulo, sem contagem', async () => {
    for (const caminho of ['/galeria/formatura', '/galeria/formatura/abertura']) {
      const h = await (await get(caminho, { dono: true })).text();
      const cartao = [...h.matchAll(/<meta (?:property|name)="(?:og|twitter):[^"]*" content="[^"]*"/g)].map(m => m[0]).join('\n');
      expect(cartao, caminho).not.toContain('Abertura');
      expect(cartao, caminho).not.toContain('FOTO_A1_000001');
      expect(cartao, caminho).not.toContain('CAPA_PROJETO_0001');
      expect(decodifica(meta(h, 'og:title')), caminho).toBe('Fotos de Formatura 2026');
      expect(meta(h, 'og:description'), caminho).not.toMatch(/\d+ fotos/);
      expect(h, caminho).toContain('noindex');
    }
  });
});
