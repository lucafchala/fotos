// O smoke (scripts/smoke.sh) é o único teste que roda contra a produção e,
// enquanto não houver portão de preview (#179), é ele que decide a reversão
// automática. Cada valor que ele compara com o Worker é uma segunda cópia de
// uma regra que mora no código — e uma cópia que diverge não reprova teste
// nenhum aqui: reprova o smoke logo depois da promoção e reverte a produção.
//
// Por isso este arquivo lê os valores do PRÓPRIO smoke.sh (não uma cópia
// deles) e confere cada um contra o Worker, pela mesma requisição que o smoke
// faz (#181). Renomear um destino, mudar a marcação do preload ou o cache da
// fonte reprova aqui, antes do merge.

import { describe, it, expect, vi, afterEach } from 'vitest';
import { readFileSync } from 'node:fs';
import worker from '../src/index.js';
import { fonteDoPreload } from '../scripts/fonte-do-preload.mjs';
import { withDurableObjects } from './helpers/do.js';

const SMOKE = readFileSync(new URL('../scripts/smoke.sh', import.meta.url), 'utf8');

/**
 * Valor de uma atribuição `NOME='…'` do smoke.sh.
 * @param {string} nome
 */
function doSmoke(nome) {
  const m = SMOKE.match(new RegExp(`^${nome}='([^']*)'$`, 'm'));
  if (!m) throw new Error(`${nome} sumiu do scripts/smoke.sh`);
  return m[1];
}

// O alvo do smoke de produção (deploy.yml): o workers.dev, não o domínio.
const ALVO = 'https://fotos.lucafchala.workers.dev';

function fakeKV() {
  const store = new Map([['events', '[]']]);
  return {
    async get(/** @type {string} */ k) { return store.has(k) ? store.get(k) : null; },
    async put(/** @type {string} */ k, /** @type {string} */ v) { store.set(k, v); },
    async delete(/** @type {string} */ k) { store.delete(k); },
    async list() { return { keys: [], list_complete: true, cursor: null }; },
  };
}

const ctx = { waitUntil: (/** @type {Promise<unknown>} */ p) => { p.catch(() => {}); } };
/** @param {Record<string, unknown>} env @param {Request} req */
const chama = (env, req) => worker.fetch(req, /** @type {any} */ (withDurableObjects({ FOTOS: fakeKV(), ...env })), /** @type {any} */ (ctx));

// A requisição do smoke, sem tirar nem pôr: sem token, e sem Origin nem
// Sec-Fetch-Site (o curl não manda nenhum dos dois).
const loginDoSmoke = () => new Request(`${ALVO}/dashboard/login`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
  body: doSmoke('LOGIN_CORPO'),
});

afterEach(() => { vi.unstubAllGlobals(); });

describe('login do smoke', () => {
  it('com o Turnstile ligado (produção), o destino é o LOGIN_SEM_TOKEN do smoke', async () => {
    const res = await chama({ ADMIN_PASSWORD: 'Senha-Do-Dono-2026!', TURNSTILE_SECRET_KEY: 'segredo' }, loginDoSmoke());
    expect(res.status).toBe(302);
    expect(res.headers.get('Location')).toBe(doSmoke('LOGIN_SEM_TOKEN'));
  });

  it('com o siteverify fora do ar, o destino continua o mesmo — e ele nem é consultado', async () => {
    // Sem token, o checkTurnstile recusa antes de chamar a Cloudflare. É isso
    // que impede uma queda DELA de deixar o smoke vermelho e reverter a
    // produção à toa: se o código passar a consultar o siteverify mesmo sem
    // token, a queda vira "indisponível", o login cai na senha (?error=1) e o
    // smoke reprova.
    const siteverify = vi.fn(async () => { throw new TypeError('network'); });
    vi.stubGlobal('fetch', siteverify);
    const res = await chama({ ADMIN_PASSWORD: 'Senha-Do-Dono-2026!', TURNSTILE_SECRET_KEY: 'segredo' }, loginDoSmoke());
    expect(res.headers.get('Location')).toBe(doSmoke('LOGIN_SEM_TOKEN'));
    expect(siteverify).not.toHaveBeenCalled();
  });

  it('sem secret nenhum (wrangler dev), o destino é o LOGIN_SENHA_ERRADA do smoke', async () => {
    const res = await chama({}, loginDoSmoke());
    expect(res.status).toBe(302);
    expect(res.headers.get('Location')).toBe(doSmoke('LOGIN_SENHA_ERRADA'));
  });

  it('os dois destinos são diferentes — senão o smoke não distingue um do outro', () => {
    expect(doSmoke('LOGIN_SEM_TOKEN')).not.toBe(doSmoke('LOGIN_SENHA_ERRADA'));
  });
});

describe('fonte do smoke', () => {
  it('o smoke usa este parser, e não uma cópia própria', () => {
    expect(SMOKE).toContain('node "$(dirname "$0")/fonte-do-preload.mjs"');
  });

  it('o preload que o smoke acha na home é uma rota de fonte com o tipo e o cache que ele exige', async () => {
    const html = await (await chama({}, new Request(`${ALVO}/`))).text();
    const caminho = fonteDoPreload(html);
    // O smoke só segue caminho da própria origem (nem URL absoluta, nem //host).
    expect(caminho).toMatch(/^\/[^/]/);
    const res = await chama({}, new Request(ALVO + caminho));
    expect(res.status).toBe(200);
    expect((res.headers.get('Content-Type') ?? '').split(';')[0].toLowerCase()).toBe(doSmoke('FONTE_TIPO'));
    expect((res.headers.get('Cache-Control') ?? '').replace(/ /g, '').split(',')).toContain(doSmoke('FONTE_CACHE'));
  });
});

describe('fonteDoPreload', () => {
  it.each([
    ['a marcação do fontPreloadHTML()', '<link rel="preload" href="/fonts/a.1.woff2" as="font" type="font/woff2" crossorigin>', '/fonts/a.1.woff2'],
    ['outra ordem e aspas simples', "<link as='font' crossorigin href='/fonts/b.woff2' rel='preload'>", '/fonts/b.woff2'],
    ['sem aspas e em maiúsculas', '<LINK REL=preload AS=FONT HREF=/fonts/c.woff2>', '/fonts/c.woff2'],
    ['preload de outra coisa antes do da fonte', '<link rel="preload" href="/capa.webp" as="image"><link rel="preload" href="/fonts/d.woff2" as="font">', '/fonts/d.woff2'],
    ['só preload de imagem', '<link rel="preload" href="/capa.webp" as="image">', ''],
    ['fonte sem preload (stylesheet)', '<link rel="stylesheet" href="/fonts/e.css" as="font">', ''],
    ['atributo que só contém o nome', '<link data-rel="preload" class="as" rel="preconnect" href="/x" data-as="font">', ''],
    ['página sem link', '<html><head></head></html>', ''],
  ])('%s', (_caso, html, esperado) => {
    expect(fonteDoPreload(html)).toBe(esperado);
  });
});
