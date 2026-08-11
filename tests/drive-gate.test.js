import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { handleDriveLink, handlePerfBeacon, toCount } from '../src/index.js';
import { saveEvents, ACCESS_DECLARATIONS } from '../src/utils.js';

// The Drive gate is the one endpoint that hands out the real Drive URLs. Every
// refusal below is a security control, not a UX nicety: a regression that turns
// any of these into a 200 leaks the links the whole gate exists to protect.

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

// Records what would have been INSERTed, so the audit assertions can check the
// bound values without a real D1.
function fakeD1() {
  const rows = [];
  return {
    rows,
    prepare(sql) {
      return { bind: (...vals) => ({ async run() { rows.push({ sql, vals }); return { success: true }; } }) };
    },
  };
}

// ctx.waitUntil must actually await here: the D1 insert is fire-and-forget in
// production, but a test that does not settle it would assert on an empty array.
function fakeCtx() {
  const pending = [];
  return { waitUntil: p => pending.push(p), settle: () => Promise.all(pending) };
}

const EVENTS = [
  { id: '1', slug: 'casamento-ana', title: 'Casamento Ana', accessType: 'public', driveUrl: 'https://drive.google.com/drive/folders/ok', driveUrlInstagram: '' },
  { id: '2', slug: 'familia-silva', title: 'Família Silva', accessType: 'family', driveUrl: 'https://drive.google.com/drive/folders/fam', driveUrlInstagram: '' },
  { id: '3', slug: 'em-breve', title: 'Em Breve', accessType: 'public', comingSoon: true, driveUrl: 'https://drive.google.com/drive/folders/soon', driveUrlInstagram: '' },
];

function req(body, { ip = '1.2.3.4', raw = null } = {}) {
  return new Request(`${SITE}/api/drive-link`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'CF-Connecting-IP': ip },
    body: raw ?? JSON.stringify(body),
  });
}

// Turnstile is a network call; stub siteverify so the tests never leave the box.
function stubTurnstile(success) {
  vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ success }), { status: 200 })));
}

let env;

beforeEach(async () => {
  env = { FOTOS: fakeKV(), TURNSTILE_SECRET_KEY: 'secret' };
  // Seeds KV *and* the isolate-local cache in src/utils.js, which would
  // otherwise leak the previous test's events into this one.
  await saveEvents(env, structuredClone(EVENTS));
});

afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });

describe('handleDriveLink — refusals', () => {
  it('rejects a malformed body before touching anything else', async () => {
    stubTurnstile(true);
    const res = await handleDriveLink(req(null, { raw: '{not json' }), env, fakeCtx());
    expect(res.status).toBe(400);
  });

  it('rejects an invalid slug shape', async () => {
    stubTurnstile(true);
    const res = await handleDriveLink(req({ slug: '../../etc/passwd', turnstileToken: 't', consent: true }), env, fakeCtx());
    expect(res.status).toBe(400);
  });

  it('404s an unknown slug without leaking whether it ever existed', async () => {
    stubTurnstile(true);
    const res = await handleDriveLink(req({ slug: 'nao-existe', turnstileToken: 't', consent: true }), env, fakeCtx());
    expect(res.status).toBe(404);
    expect(await res.json()).not.toHaveProperty('driveUrl');
  });

  it('refuses a coming-soon event even with a valid token and consent', async () => {
    stubTurnstile(true);
    const res = await handleDriveLink(req({ slug: 'em-breve', turnstileToken: 't', consent: true }), env, fakeCtx());
    expect(res.status).toBe(403);
    expect(await res.text()).not.toContain('drive.google.com');
  });

  it('403s and returns no link when Turnstile fails', async () => {
    stubTurnstile(false);
    const res = await handleDriveLink(req({ slug: 'casamento-ana', turnstileToken: 'bad', consent: true }), env, fakeCtx());
    expect(res.status).toBe(403);
    expect(await res.text()).not.toContain('drive.google.com');
  });

  it('fails closed when TURNSTILE_SECRET_KEY is missing (deploy error, not a bypass)', async () => {
    stubTurnstile(true); // siteverify would say yes — the missing secret must still refuse
    const res = await handleDriveLink(req({ slug: 'casamento-ana', turnstileToken: 't', consent: true }), { ...env, TURNSTILE_SECRET_KEY: undefined }, fakeCtx());
    expect(res.status).toBe(403);
  });

  it('fails closed when siteverify itself throws (network/timeout)', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('network down'); }));
    const res = await handleDriveLink(req({ slug: 'casamento-ana', turnstileToken: 't', consent: true }), env, fakeCtx());
    expect(res.status).toBe(403);
  });

  it('refuses when the Terms checkbox was not ticked', async () => {
    stubTurnstile(true);
    const res = await handleDriveLink(req({ slug: 'casamento-ana', turnstileToken: 't', consent: false }), env, fakeCtx());
    expect(res.status).toBe(400);
    expect(await res.text()).not.toContain('drive.google.com');
  });

  it('rejects a truthy-but-not-true consent value (no coercion)', async () => {
    stubTurnstile(true);
    for (const consent of ['true', 1, 'yes', {}]) {
      const res = await handleDriveLink(req({ slug: 'casamento-ana', turnstileToken: 't', consent }), env, fakeCtx());
      expect(res.status).toBe(400);
    }
  });

  it('requires the extra declaration on a family/private event', async () => {
    stubTurnstile(true);
    const res = await handleDriveLink(req({ slug: 'familia-silva', turnstileToken: 't', consent: true }), env, fakeCtx());
    expect(res.status).toBe(400);
    expect(await res.text()).not.toContain('drive.google.com');
  });

  it('429s once the per-IP rate limit is spent', async () => {
    stubTurnstile(true);
    const body = { slug: 'casamento-ana', turnstileToken: 't', consent: true };
    let last;
    for (let i = 0; i < 62; i++) last = await handleDriveLink(req(body), env, fakeCtx());
    expect(last.status).toBe(429);
  });

  it('rate-limits the noscript path far tighter than the verified one', async () => {
    const body = { slug: 'casamento-ana', turnstileToken: 'noscript', consent: true };
    const codes = [];
    for (let i = 0; i < 12; i++) codes.push((await handleDriveLink(req(body), env, fakeCtx())).status);
    expect(codes.filter(c => c === 200)).toHaveLength(10);
    expect(codes.at(-1)).toBe(429);
  });
});

describe('handleDriveLink — grants', () => {
  it('returns the link when Turnstile passes and the Terms are accepted', async () => {
    stubTurnstile(true);
    const res = await handleDriveLink(req({ slug: 'casamento-ana', turnstileToken: 't', consent: true }), env, fakeCtx());
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ ok: true, driveUrl: 'https://drive.google.com/drive/folders/ok' });
  });

  it('unlocks a family event once the declaration is also ticked', async () => {
    stubTurnstile(true);
    const res = await handleDriveLink(req({ slug: 'familia-silva', turnstileToken: 't', consent: true, declaration: true }), env, fakeCtx());
    expect(res.status).toBe(200);
    expect((await res.json()).driveUrl).toBe('https://drive.google.com/drive/folders/fam');
  });

  // Documented, deliberate weaker path for ad-blocked visitors (README/SECURITY).
  // Pinned so it stays a *conscious* hole: no captcha, but still consent-gated,
  // separately rate-limited, and audited as unverified.
  it('grants on the noscript path without ever calling siteverify', async () => {
    const spy = vi.fn();
    vi.stubGlobal('fetch', spy);
    const res = await handleDriveLink(req({ slug: 'casamento-ana', turnstileToken: 'noscript', consent: true }), env, fakeCtx());
    expect(res.status).toBe(200);
    expect(spy).not.toHaveBeenCalled();
  });

  it('still requires consent on the noscript path', async () => {
    vi.stubGlobal('fetch', vi.fn());
    const res = await handleDriveLink(req({ slug: 'casamento-ana', turnstileToken: 'noscript', consent: false }), env, fakeCtx());
    expect(res.status).toBe(400);
  });

  // safeUrl at the sink: a javascript: value that reached KV through a restored
  // backup must not survive into the client's href.
  it('strips a script-executing URL that reached KV', async () => {
    stubTurnstile(true);
    await saveEvents(env, [{ id: '9', slug: 'poison', title: 'P', accessType: 'public', driveUrl: 'javascript:alert(1)', driveUrlInstagram: 'data:text/html,<script>' }]);
    const res = await handleDriveLink(req({ slug: 'poison', turnstileToken: 't', consent: true }), env, fakeCtx());
    const body = await res.json();
    expect(body.driveUrl).toBe('');
    expect(body.driveUrlInstagram).toBe('');
  });
});

describe('handleDriveLink — consent audit', () => {
  it('writes the audit row with the server texts, ignoring client-supplied ones', async () => {
    stubTurnstile(true);
    const db = fakeD1();
    const ctx = fakeCtx();
    await handleDriveLink(
      req({ slug: 'familia-silva', turnstileToken: 't', consent: true, declaration: true, name: 'Ana', consent_text: 'EU MANDEI ISTO', terms_version: 'forjada' }),
      { ...env, CONSENT_DB: db }, ctx,
    );
    await ctx.settle();

    expect(db.rows).toHaveLength(1);
    const { vals } = db.rows[0];
    expect(vals).toContain(ACCESS_DECLARATIONS.family);
    expect(vals).not.toContain('EU MANDEI ISTO');
    expect(vals).not.toContain('forjada');
    expect(vals).toContain('Ana');
    expect(vals).toContain(1); // turnstile_ok
  });

  it('records the noscript grant as unverified', async () => {
    const db = fakeD1();
    const ctx = fakeCtx();
    vi.stubGlobal('fetch', vi.fn());
    await handleDriveLink(req({ slug: 'casamento-ana', turnstileToken: 'noscript', consent: true }), { ...env, CONSENT_DB: db }, ctx);
    await ctx.settle();
    expect(db.rows[0].vals).toContain(0); // turnstile_ok = 0
  });

  it('still releases the link when D1 is not provisioned (audit is best-effort)', async () => {
    stubTurnstile(true);
    const res = await handleDriveLink(req({ slug: 'casamento-ana', turnstileToken: 't', consent: true }), { ...env, CONSENT_DB: undefined }, fakeCtx());
    expect(res.status).toBe(200);
  });
});

describe('toCount', () => {
  it('reads back a well-formed counter', () => {
    expect(toCount('42')).toBe(42);
    expect(toCount('0')).toBe(0);
    expect(toCount(7)).toBe(7);
  });

  it('never returns NaN for the poison values KV can hold', () => {
    for (const v of ['NaN', 'abc', '', '   ', null, undefined, {}, [], NaN, Infinity, 'null']) {
      const n = toCount(v);
      expect(Number.isInteger(n)).toBe(true);
      expect(n).toBe(0);
    }
  });

  it('refuses partially-corrupted values instead of salvaging a prefix', () => {
    expect(toCount('12abc')).toBe(0);
    expect(toCount('3.9')).toBe(0);
    expect(toCount('-5')).toBe(0);
    expect(toCount('1e3')).toBe(0);
  });

  it('keeps an increment safe to write back as a string', () => {
    expect(String(toCount('NaN') + 1)).toBe('1');
    expect(String(toCount('99') + 1)).toBe('100');
  });
});

describe('handlePerfBeacon', () => {
  const beacon = (body, headers = {}) => new Request(`${SITE}/api/perf`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', ...headers },
    body: typeof body === 'string' ? body : JSON.stringify(body),
  });

  it('answers 204 with no body, as sendBeacon expects', async () => {
    const res = await handlePerfBeacon(beacon({ page: 'gallery', lcp: 1200 }), {});
    expect(res.status).toBe(204);
    expect(await res.text()).toBe('');
  });

  it('swallows garbage instead of erroring (fire-and-forget must never 500)', async () => {
    for (const b of ['{broken', '"a string"', 'null', '[]']) {
      expect((await handlePerfBeacon(beacon(b), {})).status).toBe(204);
    }
  });

  it('drops implausible numbers so one forged beacon cannot skew the average', async () => {
    const points = [];
    const env2 = { PERF: { writeDataPoint: d => points.push(d) } };
    await handlePerfBeacon(beacon({ page: 'event', lcp: 9e12, fcp: -1, imgCount: 'x', ttfb: 800 }), env2);
    expect(points).toHaveLength(1);
    // lcp/fcp rejected -> the -1 sentinel; nothing absurd reaches the dataset.
    expect(points[0].doubles[0]).toBe(-1);
    expect(points[0].doubles[1]).toBe(-1);
    expect(points[0].doubles.every(d => d >= -1 && d <= 300000)).toBe(true);
  });

  it('normalizes an unknown page label to gallery', async () => {
    const points = [];
    await handlePerfBeacon(beacon({ page: '<script>' }), { PERF: { writeDataPoint: d => points.push(d) } });
    expect(points[0].blobs[0]).toBe('gallery');
  });

  it('ignores a cross-origin beacon but still answers 204', async () => {
    const points = [];
    const env2 = { PERF: { writeDataPoint: d => points.push(d) } };
    const res = await handlePerfBeacon(beacon({ page: 'event', lcp: 900 }, { Origin: 'https://evil.example' }), env2);
    expect(res.status).toBe(204);
    expect(points).toHaveLength(0);
  });

  it('accepts a same-origin beacon and one with no Origin at all', async () => {
    const points = [];
    const env2 = { PERF: { writeDataPoint: d => points.push(d) } };
    await handlePerfBeacon(beacon({ page: 'event', lcp: 900 }, { Origin: SITE }), env2);
    await handlePerfBeacon(beacon({ page: 'event', lcp: 900 }), env2);
    expect(points).toHaveLength(2);
  });

  it('does not require the PERF binding to exist', async () => {
    expect((await handlePerfBeacon(beacon({ page: 'event' }), {})).status).toBe(204);
  });
});
