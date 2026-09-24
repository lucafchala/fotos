// Dois caminhos do painel que a revisão de 23/09/2026 achou frágeis.
//
// Resolver um pedido de remoção manda um e-mail à pessoa ("Solicitação
// atendida"). Sem guarda, cada nova resolução do mesmo pedido mandava outro; e
// com o KV recusando a gravação, o 500 genérico não dizia se o e-mail já tinha
// saído — o dono tentava de novo e a pessoa recebia dois.
//
// Trocar a senha é a reação padrão a "acho que invadiram". Com o KV recusando a
// gravação, virava o mesmo 500 genérico, sem dizer que a senha antiga continua
// valendo.

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import worker from '../src/index.js';
import { degradedHealth, resetDegraded } from '../src/utils.js';

const TOKEN = 'a'.repeat(64);
const PEDIDO = {
  id: 'ab12cd34', eventId: 'e1', eventTitle: 'Formatura 2026', eventSlug: 'formatura-2026',
  email: 'pessoa@example.com', value: 'foto 12', resolved: false, createdAt: '2026-09-01T00:00:00Z',
};

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

// Conta os envios pela Resend pelo host resolvido, não por substring (mesma
// regra que o `security.yml` cobra do `src/`).
function contaEnvios() {
  let envios = 0;
  vi.stubGlobal('fetch', async (/** @type {string | Request} */ entrada) => {
    const url = typeof entrada === 'string' ? entrada : entrada.url;
    if (new URL(url).host === 'api.resend.com') { envios++; return new Response('{"id":"x"}', { status: 200 }); }
    return new Response('{}', { status: 200 });
  });
  return () => envios;
}

/** @param {any} env @param {string} caminho @param {string} metodo @param {unknown} [corpo] */
function chama(env, caminho, metodo, corpo) {
  const req = new Request('https://fotos.lucafchala.com' + caminho, {
    method: metodo,
    headers: { 'Content-Type': 'application/json', Cookie: `__Host-session=${TOKEN}` },
    body: corpo === undefined ? undefined : JSON.stringify(corpo),
  });
  return worker.fetch(req, env, /** @type {any} */ ({ waitUntil: () => {} }));
}

const envCom = (/** @type {ReturnType<typeof fakeKV>} */ kv) => ({ FOTOS: kv, RESEND_API_KEY: 're_teste' });

beforeEach(() => { resetDegraded(); vi.spyOn(console, 'error').mockImplementation(() => {}); });
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); resetDegraded(); });

describe('resolver pedido de remoção', () => {
  const kvComPedido = () => fakeKV({
    [`admin_session:${TOKEN}`]: 'valid',
    removal_requests: JSON.stringify([PEDIDO]),
  });

  it('resolver de novo não reenvia o e-mail', async () => {
    const envios = contaEnvios();
    const kv = kvComPedido();

    const r1 = await chama(envCom(kv), '/api/removal-requests/ab12cd34/resolve', 'PUT');
    const primeiro = await r1.json();
    const r2 = await chama(envCom(kv), '/api/removal-requests/ab12cd34/resolve', 'PUT');
    const segundo = await r2.json();

    expect(r1.status).toBe(200);
    expect(r2.status).toBe(200);
    expect(envios(), 'a pessoa recebe um e-mail só').toBe(1);
    expect(segundo.resolvedAt, 'devolve o que está gravado, sem resolver de novo').toBe(primeiro.resolvedAt);
    expect(segundo.resolvedEmailStatus).toBe('sent');
  });

  it('KV recusando a gravação depois do e-mail: 503 que diz que o e-mail já saiu', async () => {
    const envios = contaEnvios();
    const kv = kvComPedido();
    kv.put = async () => { throw new Error('KV PUT failed: 429 Too Many Requests'); };

    const res = await chama(envCom(kv), '/api/removal-requests/ab12cd34/resolve', 'PUT');
    const corpo = await res.json();

    expect(res.status).toBe(503);
    expect(envios()).toBe(1);
    expect(corpo.error).toMatch(/JÁ foi enviado/);
    expect(degradedHealth().map(p => p.label).join()).toMatch(/KV/);
  });

  it('sem e-mail configurado, o 503 diz que nenhum e-mail saiu', async () => {
    const kv = kvComPedido();
    kv.put = async () => { throw new Error('KV PUT failed: 503'); };

    const res = await chama({ FOTOS: kv }, '/api/removal-requests/ab12cd34/resolve', 'PUT');

    expect(res.status).toBe(503);
    expect((await res.json()).error).toMatch(/Nenhum e-mail/);
  });
});

describe('troca de senha com o KV recusando a gravação', () => {
  it('responde 503 dizendo que a senha antiga continua valendo, e não derruba sessões', async () => {
    const kv = fakeKV({
      [`admin_session:${TOKEN}`]: 'valid',
      'admin_session:outra': 'valid',
      admin_password: 'hash-antigo',
    });
    const apagadas = /** @type {string[]} */ ([]);
    kv.put = async () => { throw new Error('KV PUT failed: 429 Too Many Requests'); };
    kv.delete = async (/** @type {string} */ k) => { apagadas.push(k); };

    const res = await chama({ FOTOS: kv }, '/api/settings/password', 'PUT', { password: 'uma frase longa de teste 2026' });
    const corpo = await res.json();

    expect(res.status).toBe(503);
    expect(corpo.error).toMatch(/senha antiga continua valendo/);
    expect(kv._store.get('admin_password')).toBe('hash-antigo');
    expect(apagadas, 'sem senha nova, derrubar sessões só deslogaria o dono').toEqual([]);
    expect(degradedHealth().map(p => p.label).join()).toMatch(/KV/);
  });
});
