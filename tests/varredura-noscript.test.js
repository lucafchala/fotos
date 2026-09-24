// Alerta de varredura pelo caminho noscript do portão do Drive (#147).
//
// O fallback para quem tem o Turnstile bloqueado entrega o link sem desafio e
// grava a concessão com `turnstile_ok = 0`. Um script que já carregou a página
// percorre o catálogo por ele — e até aqui isso só aparecia numa auditoria
// manual do D1. Estes testes travam o limiar (5 projetos distintos do mesmo IP
// em 24 h), o que NÃO pode alertar (volume num projeto só, o caminho com
// Turnstile de verdade, linha fora da janela), o cooldown e o isolamento de
// falha: nada disto pode tocar a resposta que entrega as fotos.
//
// O D1 é SQLite de verdade com as migrações reais (tests/helpers/d1.js), então
// a consulta testada é a do código.

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { handleDriveLink } from '../src/index.js';
import { saveEvents, degradedHealth, resetDegraded, resetNoscriptSweepAlert } from '../src/utils.js';
import { withDurableObjects } from './helpers/do.js';
import { d1Sqlite } from './helpers/d1.js';

const SITE = 'https://fotos.lucafchala.com';

/** @param {Record<string, string>} inicial */
function fakeKV(inicial = {}) {
  const store = new Map(Object.entries(inicial));
  return {
    async get(/** @type {string} */ k) { return store.has(k) ? store.get(k) : null; },
    async put(/** @type {string} */ k, /** @type {string} */ v) { store.set(k, v); },
    async delete(/** @type {string} */ k) { store.delete(k); },
    async list() { return { keys: [], list_complete: true }; },
    _store: store,
  };
}

const evento = (/** @type {string} */ slug, accessType = 'public') =>
  ({ id: slug, slug, title: slug, accessType, driveUrl: `https://drive.google.com/drive/folders/${slug}`, driveUrlInstagram: '' });
const EVENTOS = [
  ...['a', 'b', 'c', 'd', 'e', 'f', 'g'].map(l => evento(`projeto-${l}`)),
  evento('familia-silva', 'family'),
  evento('turma-privada', 'private'),
];

let env;
/** @type {string[]} */
let emails;

function fakeCtx() {
  /** @type {Promise<unknown>[]} */
  const pendentes = [];
  return { waitUntil: (/** @type {Promise<unknown>} */ p) => pendentes.push(p), settle: () => Promise.all(pendentes) };
}

/** Uma liberação pelo portão; espera o `waitUntil` (INSERT + checagem). */
async function libera(/** @type {string} */ slug, { ip = '203.0.113.7', token = 'noscript' } = {}) {
  const ctx = fakeCtx();
  const body = { slug, turnstileToken: token, consent: true, declaration: true };
  const res = await handleDriveLink(new Request(`${SITE}/api/drive-link`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'CF-Connecting-IP': ip },
    body: JSON.stringify(body),
  }), env, /** @type {any} */ (ctx));
  await ctx.settle();
  return res;
}

beforeEach(async () => {
  resetDegraded();
  resetNoscriptSweepAlert();
  vi.spyOn(console, 'error').mockImplementation(() => {});
  emails = [];
  // Turnstile de verdade sempre aprova; a Resend guarda o corpo de cada envio.
  // Roteado pelo host resolvido, não por substring (regra do security.yml).
  vi.stubGlobal('fetch', async (/** @type {string | Request} */ entrada, /** @type {RequestInit} */ init) => {
    const url = typeof entrada === 'string' ? entrada : entrada.url;
    const host = new URL(url).host;
    if (host === 'api.resend.com') { emails.push(String(init?.body || '')); return new Response('{"id":"x"}'); }
    if (host === 'challenges.cloudflare.com') return new Response('{"success":true}');
    return new Response('{}');
  });
  env = withDurableObjects({
    FOTOS: fakeKV(), CONSENT_DB: d1Sqlite(), TURNSTILE_SECRET_KEY: 'segredo',
    RESEND_API_KEY: 're_teste', ADMIN_EMAIL: 'dono@example.com',
  });
  await saveEvents(env, structuredClone(EVENTOS));
});

afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); resetDegraded(); });

describe('alerta de varredura pelo caminho noscript (#147)', () => {
  it('o 5º projeto distinto do mesmo IP sem Turnstile manda UM alerta — e não antes', async () => {
    for (const l of ['a', 'b', 'c', 'd']) expect((await libera(`projeto-${l}`)).status).toBe(200);
    expect(emails, 'quatro projetos ainda é visita').toEqual([]);

    await libera('projeto-e');

    expect(emails).toHaveLength(1);
    expect(emails[0]).toContain('5 projetos diferentes');
    expect(emails[0]).toContain('203.0.113.7');
  });

  it('volume num projeto só não alerta (grupo atrás do mesmo IP com bloqueador)', async () => {
    for (let i = 0; i < 9; i++) expect((await libera('projeto-a')).status).toBe(200);
    expect(emails).toEqual([]);
  });

  it('o caminho com Turnstile de verdade não conta nem alerta', async () => {
    for (const l of ['a', 'b', 'c', 'd', 'e', 'f']) await libera(`projeto-${l}`, { token: 'token-real' });
    expect(emails).toEqual([]);
    const { n } = /** @type {any} */ (env.CONSENT_DB.sqlite.prepare('SELECT COUNT(*) AS n FROM image_use_consent WHERE turnstile_ok = 1').get());
    expect(n, 'as concessões foram gravadas normalmente').toBe(6);
  });

  it('diz quantos dos projetos são família ou privados', async () => {
    for (const s of ['projeto-a', 'projeto-b', 'projeto-c', 'familia-silva', 'turma-privada']) await libera(s);
    expect(emails).toHaveLength(1);
    expect(emails[0]).toMatch(/<strong>2<\/strong> deles família ou privados/);
  });

  it('linhas fora da janela de 24 h não contam', async () => {
    const velho = new Date(Date.now() - 25 * 3600 * 1000).toISOString();
    const semear = env.CONSENT_DB.sqlite.prepare(
      `INSERT INTO image_use_consent (id, created_at, event_slug, terms_version, turnstile_ok, ip)
       VALUES (?, ?, ?, 'v', 0, '203.0.113.7')`);
    for (const l of ['a', 'b', 'c', 'd']) semear.run(`velho-${l}`, velho, `projeto-${l}`);

    await libera('projeto-e');

    expect(emails).toEqual([]);
  });

  it('o cooldown segura o segundo alerta, mesmo de outro IP (é global, não por IP)', async () => {
    for (const l of ['a', 'b', 'c', 'd', 'e']) await libera(`projeto-${l}`);
    await libera('projeto-f');
    for (const l of ['a', 'b', 'c', 'd', 'e']) await libera(`projeto-${l}`, { ip: '198.51.100.9' });
    expect(emails).toHaveLength(1);
    expect(env.FOTOS._store.has('noscript-sweep-alert:cooldown')).toBe(true);
  });

  it('com o KV fora, a trava do isolate ainda segura o segundo e-mail', async () => {
    env.FOTOS.get = async () => { throw new Error('KV GET failed: 503'); };
    env.FOTOS.put = async () => { throw new Error('KV PUT failed: 503'); };
    // O KV de mentira só cai DEPOIS de os eventos estarem no cache do isolate.
    for (const l of ['a', 'b', 'c', 'd', 'e', 'f', 'g']) await libera(`projeto-${l}`);
    expect(emails).toHaveLength(1);
  });

  it('D1 falhando na contagem não toca a resposta nem vira 500', async () => {
    const real = env.CONSENT_DB;
    env.CONSENT_DB = {
      ...real,
      prepare(/** @type {string} */ sql) {
        if (/^\s*SELECT/i.test(sql)) return { bind: () => ({ first: async () => { throw new Error('D1_ERROR: timeout'); } }) };
        return real.prepare(sql);
      },
    };
    for (const l of ['a', 'b', 'c', 'd']) await libera(`projeto-${l}`);
    const res = await libera('projeto-e');

    expect(res.status).toBe(200);
    expect((await res.json()).driveUrl).toContain('projeto-e');
    expect(emails).toEqual([]);
    expect(degradedHealth().map(p => p.label)).toContain('checagem de varredura noscript falhou');
  });
});
