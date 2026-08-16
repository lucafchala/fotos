import { describe, it, expect, vi, afterEach } from 'vitest';
import worker, { handleHealthz, handleLogin } from '../src/index.js';
import { hashPassword } from '../src/utils.js';
import { aboutHTML } from '../src/ui/about.js';
import { gearHTML } from '../src/ui/gear.js';

// These tests exercise the operational surface that keeps the site's uptime
// story honest: the endpoint the deploy smoke test and status.lucafchala.com
// both depend on (/api/healthz), the cron that must never go silently dark,
// and the login gate the dashboard sits behind. Regressions here are exactly
// the kind that don't show up as a 500 to a visitor but do show up as an
// outage nobody was told about.

const SITE = 'https://fotos.lucafchala.com';

function fakeKV(initial = {}) {
  const store = new Map(Object.entries(initial));
  return {
    async get(k) { return store.has(k) ? store.get(k) : null; },
    async put(k, v) { store.set(k, v); },
    async delete(k) { store.delete(k); },
    async list({ prefix = '' } = {}) {
      return { keys: [...store.keys()].filter(k => k.startsWith(prefix)).map(name => ({ name })), list_complete: true, cursor: null };
    },
    _store: store,
  };
}

// ctx.waitUntil must actually settle here, mirroring the pattern already used
// in drive-gate.test.js — production fires and forgets, tests need to await.
function fakeCtx() {
  const pending = [];
  return { waitUntil: p => pending.push(p), settle: () => Promise.all(pending) };
}

afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });

describe('handleHealthz', () => {
  it('reports ok:true with a working KV and no D1 binding', async () => {
    const env = { FOTOS: fakeKV({ events: '[]' }) };
    const res = await handleHealthz(new Request(`${SITE}/api/healthz`), env);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(body.kv).toBe(true);
    expect(body.events).toBe(0);
    expect(typeof body.hashMs).toBe('number');
    expect(body.d1).toBe('absent');
  });

  it('flips ok:false and returns 503 when the KV read fails', async () => {
    const env = { FOTOS: { get: () => Promise.reject(new Error('kv down')) } };
    const res = await handleHealthz(new Request(`${SITE}/api/healthz`), env);
    expect(res.status).toBe(503);
    const body = await res.json();
    expect(body.ok).toBe(false);
    expect(body.kv).toBe(false);
  });

  it('reports d1:"down" (without flipping ok) when CONSENT_DB is bound but the query throws', async () => {
    const env = {
      FOTOS: fakeKV({ events: '[]' }),
      CONSENT_DB: { prepare: () => ({ first: () => Promise.reject(new Error('d1 down')) }) },
    };
    const body = await (await handleHealthz(new Request(`${SITE}/api/healthz`), env)).json();
    expect(body.d1).toBe('down');
    expect(body.ok).toBe(true); // D1 is optional/best-effort — deploy smoke test's contract
  });

  it('reports d1:"ok" when CONSENT_DB is bound and the query succeeds', async () => {
    const env = {
      FOTOS: fakeKV({ events: '[]' }),
      CONSENT_DB: { prepare: () => ({ first: () => Promise.resolve({ 1: 1 }) }) },
    };
    const body = await (await handleHealthz(new Request(`${SITE}/api/healthz`), env)).json();
    expect(body.d1).toBe('ok');
  });

  it('flags a stale cron heartbeat as stale and a recent one as fresh', async () => {
    const staleEnv = { FOTOS: fakeKV({ events: '[]', 'cron:last': new Date(Date.now() - 3 * 86400_000).toISOString() }) };
    const staleBody = await (await handleHealthz(new Request(`${SITE}/api/healthz`), staleEnv)).json();
    expect(staleBody.cron.stale).toBe(true);

    const freshEnv = { FOTOS: fakeKV({ events: '[]', 'cron:last': new Date().toISOString() }) };
    const freshBody = await (await handleHealthz(new Request(`${SITE}/api/healthz`), freshEnv)).json();
    expect(freshBody.cron.stale).toBe(false);
  });

  it('reflects which optional integrations are configured, without leaking their values', async () => {
    const env = { FOTOS: fakeKV({ events: '[]' }), RESEND_API_KEY: 'k', ADMIN_EMAIL: 'a@b.com' };
    const body = await (await handleHealthz(new Request(`${SITE}/api/healthz`), env)).json();
    expect(body.config).toEqual({ resend: true, turnstile: false, consentDb: false, adminEmail: true, signing: false });
  });

  it('surfaces auditSite problems for a live event with a broken Drive link', async () => {
    const events = [{ id: '1', slug: 'x', title: 'X', visible: true, comingSoon: false, driveUrl: '', accessType: 'public' }];
    const env = { FOTOS: fakeKV({ events: JSON.stringify(events) }) };
    const body = await (await handleHealthz(new Request(`${SITE}/api/healthz`), env)).json();
    expect(body.selftest.problems.some(p => p.includes('link do Drive ausente'))).toBe(true);
  });
});

describe('scheduled() — daily retention cron', () => {
  it('still writes the heartbeat and alerts when one prune task fails (fault isolation)', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('{}', { status: 200 })));

    const kv = fakeKV({});
    const originalGet = kv.get;
    // Simulate a KV outage that only affects the removal-requests read —
    // pruneOldConsent doesn't touch KV at all (no CONSENT_DB bound below), and
    // the heartbeat write uses .put, not .get.
    kv.get = async (k) => { if (k === 'removal_requests') throw new Error('kv down'); return originalGet(k); };

    const env = { FOTOS: kv, RESEND_API_KEY: 'k', ADMIN_EMAIL: 'admin@lucafchala.com' };
    const ctx = fakeCtx();

    await worker.scheduled({}, env, ctx);
    await ctx.settle();

    expect(await kv.get('cron:last')).not.toBeNull(); // heartbeat unaffected by the other task's failure
    expect(fetch).toHaveBeenCalledTimes(1); // sendErrorAlert fired for the failed prune task
  });

  it('never throws out of scheduled() itself even when every task fails', async () => {
    const env = {
      FOTOS: { get: () => Promise.reject(new Error('kv down')), put: () => Promise.reject(new Error('kv down')) },
    };
    const ctx = fakeCtx();
    await expect(worker.scheduled({}, env, ctx)).resolves.toBeUndefined();
    await expect(ctx.settle()).resolves.toBeDefined();
  });
});

describe('handleLogin', () => {
  function loginReq(password, ip = '9.9.9.9') {
    return new Request(`${SITE}/dashboard/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'CF-Connecting-IP': ip },
      body: `password=${encodeURIComponent(password)}`,
    });
  }

  it('redirects with error when no admin credential is configured', async () => {
    const env = { FOTOS: fakeKV() };
    const res = await handleLogin(loginReq('anything'), env);
    expect(res.status).toBe(302);
    expect(res.headers.get('Location')).toBe('/dashboard?error=1');
  });

  it('redirects with error on a wrong password, without setting a session cookie', async () => {
    const env = { FOTOS: fakeKV(), ADMIN_PASSWORD: 'correct-horse' };
    const res = await handleLogin(loginReq('wrong-password'), env);
    expect(res.status).toBe(302);
    expect(res.headers.get('Location')).toBe('/dashboard?error=1');
    expect(res.headers.get('Set-Cookie')).toBeNull();
  });

  it('sets an HttpOnly/Secure/SameSite=Strict session cookie and persists it in KV on success', async () => {
    const env = { FOTOS: fakeKV(), ADMIN_PASSWORD: 'correct-horse' };
    const res = await handleLogin(loginReq('correct-horse'), env);
    expect(res.status).toBe(302);
    expect(res.headers.get('Location')).toBe('/dashboard');
    const cookie = res.headers.get('Set-Cookie');
    expect(cookie).toMatch(/HttpOnly/);
    expect(cookie).toMatch(/Secure/);
    expect(cookie).toMatch(/SameSite=Strict/);
    // O prefixo __Host- é parte do contrato: o browser só grava um cookie com
    // esse nome se ele vier Secure, com Path=/ e SEM Domain — que é o que
    // impede outro host de lucafchala.com de plantar uma sessão aqui.
    expect(cookie).toMatch(/^__Host-session=/);
    expect(cookie).toMatch(/Path=\//);
    expect(cookie).not.toMatch(/Domain=/);
    const token = cookie.match(/session=([a-f0-9]{64})/)[1];
    // A sessão deixou de ser a string 'valid' e passou a carregar metadado
    // (criação, último uso, impressão do cliente) — é o que permite expirar por
    // inatividade e invalidar quando o cliente muda.
    const rec = JSON.parse(env.FOTOS._store.get(`admin_session:${token}`));
    expect(rec.v).toBe(1);
    expect(typeof rec.createdAt).toBe('number');
    expect(typeof rec.lastSeen).toBe('number');
    expect(typeof rec.fp).toBe('string');
  });

  it('blocks further attempts once the per-IP login rate limit is spent', async () => {
    const stored = await hashPassword('correct-horse');
    const env = { FOTOS: fakeKV({ admin_password: stored }) };
    for (let i = 0; i < 10; i++) {
      await handleLogin(loginReq('wrong-guess', '5.5.5.5'), env);
    }
    // The 11th attempt is refused by the rate limiter before the password is even checked.
    const res = await handleLogin(loginReq('correct-horse', '5.5.5.5'), env);
    expect(res.status).toBe(302);
    expect(res.headers.get('Location')).toBe('/dashboard?error=1');
    expect(res.headers.get('Set-Cookie')).toBeNull();
  });
});

// Lightweight regression net independent of the deploy-time curl smoke test:
// catches a broken template literal in these newer public pages before a
// deploy ever runs, since a stray backtick or `${` here corrupts silently
// (see the project's known template-literal footgun).
describe('public pages render without throwing', () => {
  it('aboutHTML() renders a complete document', () => {
    const html = aboutHTML();
    expect(html).toMatch(/^<!DOCTYPE html>/);
    expect(html.trim().endsWith('</html>')).toBe(true);
  });

  it('gearHTML() renders a complete document', () => {
    const html = gearHTML();
    expect(html).toMatch(/^<!DOCTYPE html>/);
    expect(html.trim().endsWith('</html>')).toBe(true);
  });
});
