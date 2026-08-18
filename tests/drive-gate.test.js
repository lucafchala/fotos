import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { handleDriveLink, handlePerfBeacon, handleTrackDrive, toCount, mintDriveNonce } from '../src/index.js';
import { signToken } from '../src/security.js';
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

// Dia de lançamento: a cota de escrita do KV (1000/dia, plano free) estoura no
// meio do público. Antes, a exceção da escrita recusada subia de checkRateLimit
// e virava 500 no portão do Drive — as fotos paravam de sair exatamente na hora
// de maior movimento, e nada no código dizia que era a cota.
describe('handleDriveLink — cota de escrita do KV estourada', () => {
  it('continua entregando o link (a escrita recusada não pode virar 500)', async () => {
    stubTurnstile(true);
    const events = await env.FOTOS.get('events');
    const broken = fakeKV({ events });
    broken.put = async () => { throw new Error('KV PUT failed: 429 Too Many Requests'); };
    const res = await handleDriveLink(
      req({ slug: 'casamento-ana', turnstileToken: 't', consent: true }),
      { ...env, FOTOS: broken },
      fakeCtx()
    );
    expect(res.status).toBe(200);
    expect((await res.json()).driveUrl).toBe('https://drive.google.com/drive/folders/ok');
  });

  it('e nenhuma das recusas do portão vira 200 por causa disso', async () => {
    // O fail-open é só do contador. Consentimento, Turnstile e "em breve"
    // continuam recusando, senão a cota estourada viraria um bypass.
    stubTurnstile(true);
    const events = await env.FOTOS.get('events');
    const broken = fakeKV({ events });
    broken.put = async () => { throw new Error('KV PUT failed: 429 Too Many Requests'); };
    const brokenEnv = { ...env, FOTOS: broken };
    const semConsentimento = await handleDriveLink(req({ slug: 'casamento-ana', turnstileToken: 't', consent: false }), brokenEnv, fakeCtx());
    expect(semConsentimento.status).toBe(400);
    const emBreve = await handleDriveLink(req({ slug: 'em-breve', turnstileToken: 't', consent: true }), brokenEnv, fakeCtx());
    expect(emBreve.status).toBe(403);
    stubTurnstile(false);
    const turnstileRuim = await handleDriveLink(req({ slug: 'casamento-ana', turnstileToken: 'bad', consent: true }), brokenEnv, fakeCtx());
    expect(turnstileRuim.status).toBe(403);
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

// ---------------------------------------------------------------------------
// Nonce de página (amarra a chamada a uma visita real da página do evento)
// ---------------------------------------------------------------------------
// O gate já falhava fechado no Turnstile, mas o token do Turnstile não diz PARA
// QUAL página foi emitido. Sem o nonce, um script com um token válido na mão
// pedia o link de um slug atrás do outro sem nunca abrir uma página. Estes
// testes fixam justamente isso: o link só sai para quem apresenta um nonce
// assinado por nós, para aquele slug, dentro do prazo.
// A cota de escrita do KV é o recurso que decide se o site aguenta um dia de
// lançamento. Este endpoint é público e aceita corpo qualquer, então gastar
// escrita antes de saber que há um clique real para contar é um ralo direto.
describe('handleTrackDrive — nenhuma escrita antes de haver o que contar', () => {
  const post = (body, ip = '9.9.9.9') => new Request(`${SITE}/api/track-drive`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'CF-Connecting-IP': ip },
    body: typeof body === 'string' ? body : JSON.stringify(body),
  });
  const writes = kv => { let n = 0; const orig = kv.put.bind(kv); kv.put = async (...a) => { n++; return orig(...a); }; return () => n; };

  it('não gasta escrita nenhuma com corpo inválido, slug inválido ou evento inexistente', async () => {
    const count = writes(env.FOTOS);
    for (const body of ['{nao json', {}, { slug: '../../etc/passwd' }, { slug: 'nao-existe' }]) {
      const res = await handleTrackDrive(post(body), env);
      expect(res.status).toBe(200);
    }
    expect(count()).toBe(0);
  });

  it('ignora um projeto "em breve" — a página dele nem desenha o botão do Drive', async () => {
    const count = writes(env.FOTOS);
    const res = await handleTrackDrive(post({ slug: 'em-breve' }), env);
    expect(res.status).toBe(200);
    expect(count()).toBe(0);
    expect(env.FOTOS._store.get('drive_clicks:em-breve')).toBeUndefined();
  });

  it('conta o clique de verdade (rate limit + contador)', async () => {
    const res = await handleTrackDrive(post({ slug: 'casamento-ana' }), env);
    expect(res.status).toBe(200);
    expect(env.FOTOS._store.get('drive_clicks:casamento-ana')).toBe('1');
  });

  it('não vira 500 quando a cota de escrita está estourada', async () => {
    const events = await env.FOTOS.get('events');
    const broken = fakeKV({ events });
    broken.put = async () => { throw new Error('KV PUT failed: 429 Too Many Requests'); };
    const res = await handleTrackDrive(post({ slug: 'casamento-ana' }), { ...env, FOTOS: broken });
    expect(res.status).toBe(200);
  });
});

describe('handleDriveLink — nonce de página', () => {
  let env, ctx;
  beforeEach(async () => {
    env = { FOTOS: fakeKV(), TURNSTILE_SECRET_KEY: 'secret', SIGNING_SECRET: 'assinatura-de-teste-longa-o-suficiente' };
    await saveEvents(env, EVENTS);
    ctx = fakeCtx();
    stubTurnstile(true);
  });
  afterEach(() => vi.unstubAllGlobals());

  it('hands out the link when the nonce matches the slug', async () => {
    const nonce = await mintDriveNonce(env, 'casamento-ana');
    const res = await handleDriveLink(
      req({ slug: 'casamento-ana', turnstileToken: 'ok', consent: true, driveNonce: nonce }), env, ctx);
    expect(res.status).toBe(200);
    expect((await res.json()).driveUrl).toBe('https://drive.google.com/drive/folders/ok');
  });

  it('refuses a request with no nonce at all', async () => {
    const res = await handleDriveLink(
      req({ slug: 'casamento-ana', turnstileToken: 'ok', consent: true }), env, ctx);
    expect(res.status).toBe(403);
    expect(await res.text()).not.toContain('drive.google.com');
  });

  it('refuses a nonce minted for a DIFFERENT event — the enumeration case', async () => {
    // Este é o ataque que o nonce existe para impedir: carregar uma página
    // qualquer, guardar o nonce e usá-lo para varrer os outros slugs.
    const nonce = await mintDriveNonce(env, 'familia-silva');
    const res = await handleDriveLink(
      req({ slug: 'casamento-ana', turnstileToken: 'ok', consent: true, driveNonce: nonce }), env, ctx);
    expect(res.status).toBe(403);
    expect(await res.text()).not.toContain('drive.google.com');
  });

  it('refuses a forged nonce', async () => {
    const res = await handleDriveLink(
      req({ slug: 'casamento-ana', turnstileToken: 'ok', consent: true, driveNonce: 'zzzz.forjado' }), env, ctx);
    expect(res.status).toBe(403);
  });

  it('answers 410 for an expired page, so the client can just reload', async () => {
    // Distinção deliberada: 410 faz o JS da página recarregar sozinho (aba
    // aberta desde ontem), 403 é tratado como tentativa de burlar. Trocar os
    // dois transforma um caso normal em tela de erro.
    const expired = await signToken(env.SIGNING_SECRET, { purpose: 'drive', scope: 'casamento-ana', ttlSecs: -60 });
    const res = await handleDriveLink(
      req({ slug: 'casamento-ana', turnstileToken: 'ok', consent: true, driveNonce: expired }), env, ctx);
    expect(res.status).toBe(410);
  });

  it('stays disabled — not fail-closed — when SIGNING_SECRET is absent', async () => {
    // Escolha consciente e documentada: um segredo ausente é erro de deploy, e
    // recusar tudo aqui derrubaria a entrega das fotos por causa de uma camada
    // ADICIONAL. As defesas de baixo (Turnstile fail-closed, rate limit,
    // consentimento) continuam valendo, e auditSite() acusa a falta.
    const envNoSecret = { FOTOS: fakeKV(), TURNSTILE_SECRET_KEY: 'secret' };
    await saveEvents(envNoSecret, EVENTS);
    const res = await handleDriveLink(
      req({ slug: 'casamento-ana', turnstileToken: 'ok', consent: true }), envNoSecret, fakeCtx());
    expect(res.status).toBe(200);
  });

  it('still refuses a bad Turnstile token even with a valid nonce', async () => {
    // O nonce soma, não substitui: as duas checagens têm que valer juntas.
    stubTurnstile(false);
    const nonce = await mintDriveNonce(env, 'casamento-ana');
    const res = await handleDriveLink(
      req({ slug: 'casamento-ana', turnstileToken: 'ruim', consent: true, driveNonce: nonce }), env, ctx);
    expect(res.status).toBe(403);
    expect(await res.text()).not.toContain('drive.google.com');
  });
});
