// Turnstile no login do painel (#167 — o #20 que nunca chegou à main).
//
// Três propriedades, e cada uma já teve (ou teria) um jeito silencioso de
// quebrar:
//   1. Sem token válido não se entra, e a resposta é a MESMA com senha certa
//      ou errada — senão o formulário vira oráculo de senha para quem não
//      passa na verificação.
//   2. O PBKDF2 roda antes da verificação: o smoke do deploy posta sem token
//      para medir a CPU do hash, e checar o token primeiro calaria o canário.
//   3. Turnstile INDISPONÍVEL (siteverify fora, chave recusada) não tranca o
//      dono fora do painel: segue com senha e rate limit, e fica registrado.

import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import worker, { handleLogin } from '../src/index.js';
import { degradedHealth, resetDegraded, hashPassword } from '../src/utils.js';
import { loginHTML } from '../src/ui/dashboard.js';
import { TURNSTILE_SITE_KEY } from '../src/config.js';
import { withDurableObjects } from './helpers/do.js';

const SITE = 'https://fotos.lucafchala.com';
const SENHA = 'Senha-Forte-De-Teste-2026!';

function fakeKV() {
  const store = new Map();
  let escritas = 0;
  return {
    async get(/** @type {string} */ k) { return store.has(k) ? store.get(k) : null; },
    async put(/** @type {string} */ k, /** @type {string} */ v) { escritas++; store.set(k, v); },
    async delete(/** @type {string} */ k) { store.delete(k); },
    async list() { return { keys: [], list_complete: true, cursor: null }; },
    get escritas() { return escritas; },
    _store: store,
  };
}

/** @param {string} senha @param {string} [token] */
function loginReq(senha, token) {
  const corpo = new URLSearchParams({ password: senha });
  if (token !== undefined) corpo.set('cf-turnstile-response', token);
  return new Request(`${SITE}/dashboard/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'CF-Connecting-IP': '9.9.9.9' },
    body: corpo.toString(),
  });
}

/** @param {() => Response | Promise<Response>} resposta */
function siteverify(resposta) {
  const f = vi.fn(async () => resposta());
  vi.stubGlobal('fetch', f);
  return f;
}

const ctx = () => ({ waitUntil: (/** @type {Promise<unknown>} */ p) => p });
/** @param {Record<string, unknown>} [extra] */
const envCom = (extra = {}) => withDurableObjects({ FOTOS: fakeKV(), ADMIN_PASSWORD: SENHA, TURNSTILE_SECRET_KEY: 'segredo', ...extra });

beforeEach(() => resetDegraded());
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });

describe('login com Turnstile', () => {
  it('token aprovado + senha certa: entra, e o token vai para o siteverify', async () => {
    const f = siteverify(() => Response.json({ success: true }));
    const res = await handleLogin(loginReq(SENHA, 'tok-bom'), /** @type {any} */ (envCom()), /** @type {any} */ (ctx()));
    expect(res.headers.get('Location')).toBe('/dashboard');
    expect(res.headers.get('Set-Cookie')).toMatch(/^__Host-session=/);
    const corpo = /** @type {any} */ (f.mock.calls[0])?.[1]?.body;
    expect(String(corpo)).toContain('response=tok-bom');
  });

  it('token aprovado + senha errada: "senha incorreta", como antes', async () => {
    siteverify(() => Response.json({ success: true }));
    const res = await handleLogin(loginReq('errada', 'tok-bom'), /** @type {any} */ (envCom()), /** @type {any} */ (ctx()));
    expect(res.headers.get('Location')).toBe('/dashboard?error=1');
    expect(res.headers.get('Set-Cookie')).toBeNull();
  });

  it.each([
    ['sem token', undefined, () => Response.json({ success: true })],
    ['token recusado', 'tok-ruim', () => Response.json({ success: false, 'error-codes': ['invalid-input-response'] })],
    ['token repetido', 'tok-velho', () => Response.json({ success: false, 'error-codes': ['timeout-or-duplicate'] })],
  ])('%s: não entra, e a resposta é a MESMA com senha certa ou errada', async (_nome, token, resposta) => {
    siteverify(resposta);
    const env = envCom();
    const certa = await handleLogin(loginReq(SENHA, token), /** @type {any} */ (env), /** @type {any} */ (ctx()));
    const errada = await handleLogin(loginReq('errada', token), /** @type {any} */ (env), /** @type {any} */ (ctx()));
    expect(certa.headers.get('Location')).toBe('/dashboard?error=ts');
    expect(certa.headers.get('Set-Cookie')).toBeNull();
    expect([errada.status, errada.headers.get('Location'), errada.headers.get('Set-Cookie')])
      .toEqual([certa.status, certa.headers.get('Location'), certa.headers.get('Set-Cookie')]);
  });

  it('sem token não grava nada no KV (tentativa de robô não gasta a cota de escrita)', async () => {
    siteverify(() => Response.json({ success: true }));
    // Hash já gravado: sem isto, a 1ª leitura semeia o ADMIN_PASSWORD no KV —
    // uma escrita legítima que não tem nada a ver com a tentativa.
    const FOTOS = fakeKV();
    FOTOS._store.set('admin_password', await hashPassword(SENHA));
    const env = envCom({ FOTOS });
    for (let i = 0; i < 5; i++) await handleLogin(loginReq('errada'), /** @type {any} */ (env), /** @type {any} */ (ctx()));
    expect(FOTOS.escritas).toBe(0);
    // E o contraponto: com token aprovado, a senha errada É contabilizada
    // (noteFailedLogin) — o teste acima não passa por o KV estar mudo.
    siteverify(() => Response.json({ success: true }));
    /** @type {Promise<unknown>[]} */
    const pendentes = [];
    await handleLogin(loginReq('errada', 'tok-bom'), /** @type {any} */ (env), /** @type {any} */ ({ waitUntil: (/** @type {Promise<unknown>} */ p) => pendentes.push(p) }));
    await Promise.all(pendentes);
    expect(FOTOS.escritas).toBeGreaterThan(0);
  });

  it('o PBKDF2 roda mesmo sem token — é o canário de CPU do smoke', async () => {
    siteverify(() => Response.json({ success: true }));
    // Hash já no KV e espião criado DEPOIS: com o KV vazio, o getAdminHash
    // semeia o ADMIN_PASSWORD fazendo um PBKDF2 próprio, e esse chamado
    // aprovaria o teste mesmo com a verificação posta antes do hash (medido:
    // passou assim com o defeito dentro).
    const FOTOS = fakeKV();
    FOTOS._store.set('admin_password', await hashPassword(SENHA));
    const derive = vi.spyOn(crypto.subtle, 'deriveBits');
    const res = await handleLogin(loginReq('smoke-check-errada'), /** @type {any} */ (envCom({ FOTOS })), /** @type {any} */ (ctx()));
    expect(res.headers.get('Location')).toBe('/dashboard?error=ts');
    expect(derive).toHaveBeenCalled();
  });

  it.each([
    ['siteverify fora do ar', () => { throw new TypeError('network'); }, 'Turnstile não respondeu'],
    ['siteverify com 5xx', () => new Response('oops', { status: 503 }), 'Turnstile não respondeu'],
    ['a Cloudflare recusa a nossa chave', () => Response.json({ success: false, 'error-codes': ['invalid-input-secret'] }), 'Turnstile recusou a configuração'],
  ])('%s: o dono entra com a senha, e o healthz registra', async (_nome, resposta, rotulo) => {
    siteverify(resposta);
    const res = await handleLogin(loginReq(SENHA, 'tok-qualquer'), /** @type {any} */ (envCom()), /** @type {any} */ (ctx()));
    expect(res.headers.get('Location')).toBe('/dashboard');
    expect(degradedHealth().map(d => d.label)).toContain(rotulo);
  });

  it('indisponível não vira passe livre: senha errada continua recusada', async () => {
    siteverify(() => { throw new TypeError('network'); });
    const res = await handleLogin(loginReq('errada', 'tok-qualquer'), /** @type {any} */ (envCom()), /** @type {any} */ (ctx()));
    expect(res.headers.get('Location')).toBe('/dashboard?error=1');
  });
});

describe('página de login', () => {
  it('traz o widget com a chave pública, o script com nonce e o botão desabilitado até o token', () => {
    const html = loginHTML({}, 'NONCE');
    expect(html).toContain(`data-sitekey="${TURNSTILE_SITE_KEY}"`);
    expect(html).toContain('<script nonce="NONCE" src="https://challenges.cloudflare.com/turnstile/v0/api.js"');
    expect(html).toMatch(/<button type="submit" class="btn-primary" id="login-btn" disabled>/);
    expect(html).toContain('.btn-primary:disabled{');
  });

  it('?error=ts mostra o aviso da verificação, sem dizer nada sobre a senha', async () => {
    const env = { FOTOS: fakeKV(), ADMIN_PASSWORD: SENHA };
    const res = await worker.fetch(new Request(`${SITE}/dashboard?error=ts`), /** @type {any} */ (env), /** @type {any} */ (ctx()));
    const html = await res.text();
    expect(html).toContain('a verificação anti-robô não passou');
    expect(html).not.toContain('Senha incorreta');
  });
});
