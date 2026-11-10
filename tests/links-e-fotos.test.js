// Links curtos no domínio do álbum e fotos pelo próprio site (v3.8.3). O que
// estes testes prendem:
//  1. entrenos2026.com/<evento> serve o evento; o endereço longo leva ao curto;
//     páginas do site (privacidade...) e o baixar continuam onde estão;
//  2. as páginas no domínio montam os links curtos; no fotos, os de sempre;
//  3. /f/<id>/<largura>: largura arredondada para a lista, cache na frente,
//     R2 primeiro quando existir, Google depois; erro do Google não vira cache.
import { describe, it, expect, vi } from 'vitest';
import { rotaDoDominioDeAlbum } from '../src/index.js';
import { baseDaGaleria, enderecoDoEvento } from '../src/utils.js';
import { lerRotaFoto, respondeFoto, larguraServida, urlFoto } from '../src/foto-rota.js';
import { galeriaIndiceHTML } from '../src/ui/galeria-indice.js';

const ID = '1AbCdEfGhIjKlMnOpQrStUvWxYz012345';
const rota = (/** @type {string} */ p, metodo = 'GET') => {
  const url = new URL(`https://entrenos2026.com${p}`);
  return rotaDoDominioDeAlbum(url, p, /** @type {any} */ ({}), new Request(url, { method: metodo }));
};

describe('links curtos no domínio do álbum', () => {
  it('/<evento> serve o evento; o longo leva ao curto; o resto fica onde está', async () => {
    expect(await rota('/piauifut')).toEqual({ servir: '/galeria/entrenos2026/piauifut' });
    const r = /** @type {Response} */ (await rota('/galeria/entrenos2026/piauifut'));
    expect(r.status).toBe(301);
    expect(r.headers.get('Location')).toBe('/piauifut');
    expect(await rota('/privacidade')).toBeNull();
    expect(await rota('/galeria/entrenos2026/piauifut/baixar/X')).toBeNull();
    expect(await rota('/galeria/outro-album/piauifut')).toBeNull();
  });

  it('a base dos links: vazia no domínio do álbum, /galeria/<slug> no resto', () => {
    expect(baseDaGaleria('entrenos2026', 'entrenos2026.com')).toBe('');
    expect(baseDaGaleria('entrenos2026', 'www.entrenos2026.com')).toBe('');
    expect(baseDaGaleria('entrenos2026', 'fotos.lucafchala.com')).toBe('/galeria/entrenos2026');
    expect(baseDaGaleria('outro', 'entrenos2026.com')).toBe('/galeria/outro');
    expect(enderecoDoEvento('entrenos2026', 'piauifut')).toBe('https://entrenos2026.com/piauifut');
    expect(enderecoDoEvento('outro', 'x')).toBe('https://fotos.lucafchala.com/galeria/outro/x');
  });

  it('o índice no domínio leva aos links curtos; no fotos, aos longos', () => {
    const caps = { v: /** @type {1} */ (1), pasta: 'RAIZ_PASTA_0001', em: '', truncada: false, caps: [{ id: 'CAPITULO0000001', rk: '', bruto: 'PiauiFut', nome: 'PiauiFut', slug: 'piauifut' }] };
    const ev = /** @type {any} */ ({ slug: 'entrenos2026', title: 'Entre Nós', accessType: 'public', galeriaCapitulos: true, driveUrl: 'https://drive.google.com/drive/folders/RAIZ_PASTA_0001', galeriaAbertura: 'Oi.' });
    const resumo = { CAPITULO0000001: { n: 3, capas: [ID] } };
    const noDominio = galeriaIndiceHTML({ event: ev, caps, resumo, ocultas: [], dono: false, indexavel: false, host: 'entrenos2026.com' });
    expect(noDominio).toContain('href="/piauifut"');
    expect(noDominio).not.toContain('href="/galeria/entrenos2026/piauifut"');
    const noFotos = galeriaIndiceHTML({ event: ev, caps, resumo, ocultas: [], dono: false, indexavel: false, host: 'fotos.lucafchala.com' });
    expect(noFotos).toContain('href="/galeria/entrenos2026/piauifut"');
    // As capas pelo próprio site.
    expect(noFotos).toContain(`/f/${ID}/`);
    expect(noFotos).not.toMatch(/<img [^>]*src="https:\/\/lh3/);
  });
});

describe('fotos pelo próprio site (/f/)', () => {
  it('lê a rota, arredonda a largura para a lista e recusa o resto', () => {
    expect(lerRotaFoto(`/f/${ID}/350`)).toEqual({ id: ID, w: 360, jpeg: false });
    expect(lerRotaFoto(`/f/${ID}/400j`)).toEqual({ id: ID, w: 400, jpeg: true });
    expect(lerRotaFoto(`/f/${ID}/99999`)).toEqual({ id: ID, w: 6400, jpeg: false });
    expect(lerRotaFoto('/f/curto/400')).toBeNull();
    expect(lerRotaFoto(`/f/${ID}/abc`)).toBeNull();
    expect(lerRotaFoto(`/f/${ID}/0`)).toBeNull();
    expect(larguraServida(1)).toBe(160);
    expect(urlFoto(ID, 450)).toBe(`/f/${ID}/480`);
  });

  /** @param {{ cache?: Map<string, Response>, r2?: any, google?: Response | null }} o */
  function cenario(o) {
    const guardadas = o.cache || new Map();
    const cache = {
      async match(/** @type {Request} */ req) { const r = guardadas.get(req.url); return r ? r.clone() : undefined; },
      async put(/** @type {Request} */ req, /** @type {Response} */ res) { guardadas.set(req.url, res); },
    };
    const f = vi.fn(async () => o.google || new Response('x', { status: 500 }));
    /** @type {Promise<any>[]} */
    const pendentes = [];
    const ctx = { waitUntil(/** @type {Promise<any>} */ p) { pendentes.push(p); } };
    return { guardadas, cache, f, ctx, pendentes };
  }
  const pede = (/** @type {string} */ p) => new Request(`https://entrenos2026.com${p}`);

  it('primeira vez vai ao Google e guarda; a segunda sai do cache', async () => {
    const c = cenario({ google: new Response('IMG', { headers: { 'Content-Type': 'image/webp' } }) });
    const alvo = /** @type {any} */ (lerRotaFoto(`/f/${ID}/350`));
    const r1 = await respondeFoto(pede(`/f/${ID}/350`), {}, c.ctx, alvo, { fetch: /** @type {any} */ (c.f), cache: c.cache });
    expect(r1.status).toBe(200);
    expect(r1.headers.get('Content-Type')).toBe('image/webp');
    // v3.8.8: 4 h, sem `immutable` (eram 7 dias) — a remoção de uma foto vale em horas.
    expect(r1.headers.get('Cache-Control')).toBe('public, max-age=14400');
    expect(await r1.text()).toBe('IMG');
    expect(c.f).toHaveBeenCalledWith(`https://lh3.googleusercontent.com/d/${ID}=w360-rw`, expect.anything());
    await Promise.all(c.pendentes);
    expect([...c.guardadas.keys()]).toEqual([`https://entrenos2026.com/f/${ID}/360`]);
    const r2 = await respondeFoto(pede(`/f/${ID}/360`), {}, c.ctx, alvo, { fetch: /** @type {any} */ (c.f), cache: c.cache });
    expect(await r2.text()).toBe('IMG');
    expect(c.f).toHaveBeenCalledTimes(1);
  });

  it('com o R2, lê de lá primeiro (e não chama o Google)', async () => {
    const c = cenario({});
    const r2 = { get: vi.fn(async (/** @type {string} */ k) => (k === `w/${ID}/480.webp` ? { body: new Response('DO-R2').body } : null)) };
    const alvo = /** @type {any} */ (lerRotaFoto(`/f/${ID}/480`));
    const r = await respondeFoto(pede(`/f/${ID}/480`), { FOTOS_R2: r2 }, c.ctx, alvo, { fetch: /** @type {any} */ (c.f), cache: c.cache });
    expect(await r.text()).toBe('DO-R2');
    expect(r.headers.get('X-Foto-Origem')).toBe('r2');
    expect(c.f).not.toHaveBeenCalled();
  });

  it('foto que o Google não entrega: 404 sem cache; página de erro de lá não passa', async () => {
    const c = cenario({ google: new Response('não', { status: 404 }) });
    const alvo = /** @type {any} */ (lerRotaFoto(`/f/${ID}/480`));
    const r = await respondeFoto(pede(`/f/${ID}/480`), {}, c.ctx, alvo, { fetch: /** @type {any} */ (c.f), cache: c.cache });
    expect(r.status).toBe(404);
    expect(r.headers.get('Cache-Control')).toBe('no-store');
    expect(c.guardadas.size).toBe(0);
    const html = cenario({ google: new Response('<html>', { status: 200, headers: { 'Content-Type': 'text/html' } }) });
    const r2 = await respondeFoto(pede(`/f/${ID}/480`), {}, html.ctx, alvo, { fetch: /** @type {any} */ (html.f), cache: html.cache });
    expect(r2.status).toBe(502);
    expect(await r2.text()).not.toContain('<html>');
  });
});

describe('R2 (v3.8.3): cópia na primeira vez, leitura depois', () => {
  it('miniatura que veio do Google também vai para o R2', async () => {
    const put = vi.fn(async () => ({}));
    /** @type {Promise<any>[]} */
    const pendentes = [];
    const ctx = { waitUntil(/** @type {Promise<any>} */ p) { pendentes.push(p); } };
    const f = vi.fn(async () => new Response('IMG', { headers: { 'Content-Type': 'image/webp' } }));
    const alvo = /** @type {any} */ (lerRotaFoto(`/f/${ID}/480`));
    const r = await respondeFoto(new Request(`https://x.test/f/${ID}/480`), { FOTOS_R2: { get: async () => null, put } }, ctx, alvo, { fetch: /** @type {any} */ (f), cache: null });
    expect(await r.text()).toBe('IMG');
    await Promise.all(pendentes);
    expect(put).toHaveBeenCalledWith(`w/${ID}/480.webp`, expect.any(ArrayBuffer), { httpMetadata: { contentType: 'image/webp' } });
  });

  it('original: lê do R2 se houver; copia do Drive direto para o R2 (sem passar pela memória); vídeo enorme fica no Drive', async () => {
    const { originalDoR2, copiaOriginalParaR2, R2_ORIGINAL_MAX } = await import('../src/foto-rota.js');
    expect(await originalDoR2({}, ID)).toBeNull();
    const env = { FOTOS_R2: { get: vi.fn(async (/** @type {string} */ k) => (k === `o/${ID}` ? { body: 'B', size: 5, httpMetadata: { contentType: 'image/jpeg' } } : null)), put: vi.fn(async () => ({})) } };
    expect(await originalDoR2(env, ID)).toEqual({ body: 'B', size: 5, tipo: 'image/jpeg' });
    const corpo = new Response('ORIGINAL').body;
    const f = vi.fn(async () => new Response(corpo, { headers: { 'Content-Length': '8' } }));
    expect(await copiaOriginalParaR2(env, ID, 'https://drive/x', { A: '1' }, 8, 'image/jpeg', /** @type {any} */ (f))).toBe(true);
    expect(f).toHaveBeenCalledWith('https://drive/x', { headers: { A: '1' } });
    expect(env.FOTOS_R2.put).toHaveBeenCalledWith(`o/${ID}`, expect.anything(), { httpMetadata: { contentType: 'image/jpeg' } });
    expect(await copiaOriginalParaR2(env, ID, 'https://drive/x', {}, R2_ORIGINAL_MAX + 1, 'video/mp4', /** @type {any} */ (f))).toBe(false);
    expect(await copiaOriginalParaR2(env, ID, 'https://drive/x', {}, 0, 'image/jpeg', /** @type {any} */ (f))).toBe(false);
  });
});

describe('teto de e-mails do dia (v3.8.3)', () => {
  it('90 por dia no site inteiro; depois, não sai', async () => {
    const { withDurableObjects } = await import('./helpers/do.js');
    const { cotaDeEmail } = await import('../src/utils.js');
    const { EMAIL_COTA_DIA } = await import('../src/config.js');
    const env = withDurableObjects({});
    let sim = 0;
    for (let i = 0; i < EMAIL_COTA_DIA.capacity + 5; i++) if (await cotaDeEmail(/** @type {any} */ (env))) sim++;
    expect(sim).toBe(EMAIL_COTA_DIA.capacity);
    expect(EMAIL_COTA_DIA.capacity).toBeLessThan(100);
  });
});
