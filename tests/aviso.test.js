// Aviso de fotos novas no celular (v3.8.4, src/aviso.js). O que estes testes
// prendem:
//  1. a cifra segue a RFC 8291: o "celular" do teste decifra e lê o texto;
//  2. a assinatura VAPID confere com a chave pública que o site publica;
//  3. só serviços de entrega conhecidos;
//  4. o envio: junta fotos por evento, um aviso por álbum a cada 3 h, em lotes
//     com cursor, e apaga a inscrição que o serviço diz não valer mais (410).
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { cifra, b64url, deB64url, chaveVapid, autorizacaoVapid, endpointValido, inscreve, desinscreve, marcaFotosNovas, enviaPendentes, textoDoAviso, esqueceChave } from '../src/aviso.js';
import { AVISO_INTERVALO_MS } from '../src/config.js';

const enc = new TextEncoder();
/** @param {...Uint8Array} p */
const junta = (...p) => { const u = new Uint8Array(p.reduce((n, x) => n + x.length, 0)); let i = 0; for (const x of p) { u.set(x, i); i += x.length; } return u; };
/** @param {Uint8Array} salt @param {Uint8Array} ikm @param {Uint8Array} info @param {number} n */
async function hkdf(salt, ikm, info, n) {
  const k = await crypto.subtle.importKey('raw', ikm, 'HKDF', false, ['deriveBits']);
  return new Uint8Array(await crypto.subtle.deriveBits({ name: 'HKDF', hash: 'SHA-256', salt, info }, k, n * 8));
}

/** Um "navegador": o par de chaves e o auth, como o PushManager daria. */
async function navegador() {
  const par = /** @type {CryptoKeyPair} */ (await crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits']));
  const pub = new Uint8Array(/** @type {ArrayBuffer} */ (await crypto.subtle.exportKey('raw', par.publicKey)));
  const auth = crypto.getRandomValues(new Uint8Array(16));
  return { par, pub, auth, chaves: { p256dh: b64url(pub), auth: b64url(auth) } };
}

/** Decifra como o navegador faria (RFC 8291). @param {Awaited<ReturnType<typeof navegador>>} nav @param {Uint8Array} corpo */
async function decifra(nav, corpo) {
  const salt = corpo.slice(0, 16);
  const idlen = corpo[20];
  const asPub = corpo.slice(21, 21 + idlen);
  const dados = corpo.slice(21 + idlen);
  const asChave = await crypto.subtle.importKey('raw', asPub, { name: 'ECDH', namedCurve: 'P-256' }, false, []);
  const segredo = new Uint8Array(await crypto.subtle.deriveBits(/** @type {any} */ ({ name: 'ECDH', public: asChave }), nav.par.privateKey, 256));
  const ikm = await hkdf(nav.auth, segredo, junta(enc.encode('WebPush: info\0'), nav.pub, asPub), 32);
  const cek = await hkdf(salt, ikm, enc.encode('Content-Encoding: aes128gcm\0'), 16);
  const nonce = await hkdf(salt, ikm, enc.encode('Content-Encoding: nonce\0'), 12);
  const k = await crypto.subtle.importKey('raw', cek, 'AES-GCM', false, ['decrypt']);
  const claro = new Uint8Array(await crypto.subtle.decrypt({ name: 'AES-GCM', iv: nonce }, k, dados));
  expect(claro[claro.length - 1]).toBe(2);
  return new TextDecoder().decode(claro.slice(0, -1));
}

/** KV de mentira com metadados, list por prefixo e cursor. */
function kv() {
  /** @type {Map<string, { v: string, m?: any }>} */
  const m = new Map();
  return {
    m,
    async get(/** @type {string} */ k) { return m.has(k) ? /** @type {any} */ (m.get(k)).v : null; },
    async put(/** @type {string} */ k, /** @type {string} */ v, /** @type {any} */ o = {}) { m.set(k, { v, m: o.metadata }); },
    async delete(/** @type {string} */ k) { m.delete(k); },
    async list(/** @type {{ prefix: string, limit?: number, cursor?: string }} */ o) {
      const todas = [...m.keys()].filter(k => k.startsWith(o.prefix)).sort();
      const ini = o.cursor ? Number(o.cursor) : 0;
      const fim = ini + (o.limit || 1000);
      return { keys: todas.slice(ini, fim).map(name => ({ name, metadata: /** @type {any} */ (m.get(name)).m })), list_complete: fim >= todas.length, cursor: String(fim) };
    },
  };
}

beforeEach(() => esqueceChave());

describe('a cifra e a assinatura', () => {
  it('o navegador decifra o aviso (RFC 8291)', async () => {
    const nav = await navegador();
    const corpo = await cifra('{"t":"Entre Nós","b":"3 fotos novas"}', nav.chaves);
    expect(corpo.slice(16, 20)).toEqual(new Uint8Array([0, 0, 16, 0]));
    expect(corpo[20]).toBe(65);
    expect(await decifra(nav, corpo)).toBe('{"t":"Entre Nós","b":"3 fotos novas"}');
  });

  it('a chave do site nasce uma vez, fica no KV, e a assinatura VAPID confere', async () => {
    const env = { FOTOS: kv() };
    const c1 = await chaveVapid(env);
    esqueceChave();
    const c2 = await chaveVapid(env);
    expect(c2.publica).toBe(c1.publica);
    expect(deB64url(c1.publica).length).toBe(65);
    const cab = await autorizacaoVapid(c2, 'https://fcm.googleapis.com/fcm/send/abc');
    const m = /^vapid t=([^.]+)\.([^.]+)\.([^,]+), k=(.+)$/.exec(cab);
    expect(m && m[4]).toBe(c1.publica);
    const corpo = JSON.parse(new TextDecoder().decode(deB64url(/** @type {any} */ (m)[2])));
    expect(corpo.aud).toBe('https://fcm.googleapis.com');
    const pub = await crypto.subtle.importKey('raw', deB64url(c1.publica), { name: 'ECDSA', namedCurve: 'P-256' }, false, ['verify']);
    const ok = await crypto.subtle.verify({ name: 'ECDSA', hash: 'SHA-256' }, pub, deB64url(/** @type {any} */ (m)[3]), enc.encode(`${/** @type {any} */ (m)[1]}.${/** @type {any} */ (m)[2]}`));
    expect(ok).toBe(true);
  });

  it('só serviços de entrega conhecidos, por https', () => {
    expect(endpointValido('https://fcm.googleapis.com/fcm/send/x')).toBe(true);
    expect(endpointValido('https://web.push.apple.com/QF')).toBe(true);
    expect(endpointValido('https://updates.push.services.mozilla.com/wpush/v2/x')).toBe(true);
    expect(endpointValido('http://fcm.googleapis.com/x')).toBe(false);
    expect(endpointValido('https://evil.example/push')).toBe(false);
    expect(endpointValido('https://fcm.googleapis.com.evil.example/x')).toBe(false);
    expect(endpointValido(123)).toBe(false);
  });
});

describe('o envio', () => {
  const album = { slug: 'entrenos2026', titulo: 'Entre Nós', nomes: { piauifut: 'PiauiFut', gala: 'Gala' }, link: (/** @type {string} */ c) => (c ? `https://entrenos2026.com/${c}` : 'https://entrenos2026.com/') };

  it('o texto: quantas fotos e onde; um evento só leva direto a ele', () => {
    expect(textoDoAviso(album, { n: 3, caps: { piauifut: 3 } }, album.nomes, album.link)).toEqual({ t: 'Entre Nós', b: '3 fotos novas em PiauiFut. Toque para ver.', u: 'https://entrenos2026.com/piauifut', tag: 'fotos-novas-entrenos2026' });
    expect(textoDoAviso(album, { n: 1, caps: { gala: 1, piauifut: 0 } }, album.nomes, album.link).b).toBe('1 foto nova em Gala e PiauiFut. Toque para ver.');
  });

  it('junta por evento, manda uma vez a cada 3 h, apaga quem não vale mais e continua em lotes', async () => {
    const env = { FOTOS: kv() };
    const navs = await Promise.all([1, 2, 3].map(() => navegador()));
    await inscreve(env, 'entrenos2026', { endpoint: 'https://fcm.googleapis.com/fcm/send/A', keys: navs[0].chaves });
    await inscreve(env, 'entrenos2026', { endpoint: 'https://web.push.apple.com/B', keys: navs[1].chaves });
    await inscreve(env, 'entrenos2026', { endpoint: 'https://fcm.googleapis.com/fcm/send/C', keys: navs[2].chaves });
    await marcaFotosNovas(env, 'entrenos2026', ['piauifut', 'piauifut']);
    await marcaFotosNovas(env, 'entrenos2026', ['gala']);
    /** @type {{ url: string, corpo: Uint8Array, cab: any }[]} */
    const pedidos = [];
    const f = vi.fn(async (/** @type {string} */ url, /** @type {any} */ init) => {
      pedidos.push({ url, corpo: init.body, cab: init.headers });
      return new Response(null, { status: url.endsWith('/B') ? 410 : 201 });
    });
    const agora = Date.parse('2026-11-20T15:00:00Z');
    const r = await enviaPendentes(env, [album], agora, /** @type {any} */ (f));
    expect(r).toEqual([{ slug: 'entrenos2026', enviados: 2, removidos: 1, recusados: 0 }]);
    expect(pedidos.every(p => p.cab['Content-Encoding'] === 'aes128gcm' && /^vapid t=/.test(p.cab.Authorization) && p.cab.TTL === '86400')).toBe(true);
    // O aviso que chega ao navegador A.
    const a = /** @type {any} */ (pedidos.find(p => p.url.endsWith('/A')));
    expect(JSON.parse(await decifra(navs[0], a.corpo))).toEqual({ t: 'Entre Nós', b: '3 fotos novas em PiauiFut e Gala. Toque para ver.', u: 'https://entrenos2026.com/', tag: 'fotos-novas-entrenos2026' });
    // B (410) saiu da lista.
    expect([...env.FOTOS.m.keys()].filter(k => k.startsWith('aviso:sub:')).length).toBe(2);
    // Mais fotos 1 h depois: espera as 3 h.
    await marcaFotosNovas(env, 'entrenos2026', ['gala']);
    expect(await enviaPendentes(env, [album], agora + 3600_000, /** @type {any} */ (f))).toEqual([]);
    expect((await enviaPendentes(env, [album], agora + AVISO_INTERVALO_MS + 1, /** @type {any} */ (f)))[0].enviados).toBe(2);
    // Desinscrever tira da lista.
    await desinscreve(env, 'entrenos2026', 'https://fcm.googleapis.com/fcm/send/A');
    expect([...env.FOTOS.m.keys()].filter(k => k.startsWith('aviso:sub:')).length).toBe(1);
  });

  it('lote: com mais inscrições que o lote, continua de onde parou na execução seguinte', async () => {
    const config = await import('../src/config.js');
    const env = { FOTOS: kv() };
    const nav = await navegador();
    const total = config.AVISO_LOTE + 3;
    for (let i = 0; i < total; i++) await env.FOTOS.put(`aviso:sub:entrenos2026:${String(i).padStart(4, '0')}`, '1', { metadata: { e: `https://fcm.googleapis.com/fcm/send/${i}`, p: nav.chaves.p256dh, a: nav.chaves.auth } });
    await marcaFotosNovas(env, 'entrenos2026', ['gala']);
    const f = vi.fn(async () => new Response(null, { status: 201 }));
    const agora = Date.now();
    expect((await enviaPendentes(env, [album], agora, /** @type {any} */ (f)))[0].enviados).toBe(config.AVISO_LOTE);
    expect(env.FOTOS.m.has('aviso:envio:entrenos2026')).toBe(true);
    expect((await enviaPendentes(env, [album], agora + 300_000, /** @type {any} */ (f)))[0].enviados).toBe(3);
    expect(env.FOTOS.m.has('aviso:envio:entrenos2026')).toBe(false);
    expect(f).toHaveBeenCalledTimes(total);
  });
});

describe('as rotas (v3.8.4)', () => {
  const EV = { id: '1', slug: 'entrenos2026', title: 'Entre Nós', accessType: 'public', galeriaCapitulos: true, galeriaAbertura: 'Oi.', driveUrl: 'https://drive.google.com/drive/folders/RAIZ_PASTA_0001', comingSoon: false, visible: true };
  async function cenario(/** @type {any} */ ev = EV) {
    const { withDurableObjects } = await import('./helpers/do.js');
    const FOTOS = kv();
    await FOTOS.put('events', JSON.stringify([ev]));
    const env = withDurableObjects({ FOTOS, SIGNING_SECRET: 's'.repeat(48) });
    vi.resetModules();
    const w = (await import('../src/index.js')).default;
    const pede = (/** @type {string} */ url, /** @type {any} */ corpo) => w.fetch(new Request(url, corpo ? { method: 'POST', headers: { 'Content-Type': 'application/json', 'CF-Connecting-IP': '203.0.113.7', Origin: new URL(url).origin }, body: JSON.stringify(corpo) } : {}), env, { waitUntil() {} });
    return { env, FOTOS, pede };
  }

  it('inscrever e sair; endereço de fora e chaves estranhas são recusados', async () => {
    const { FOTOS, pede } = await cenario();
    const nav = await navegador();
    const sub = { endpoint: 'https://fcm.googleapis.com/fcm/send/XYZ', keys: nav.chaves };
    const r = await pede('https://entrenos2026.com/api/aviso/inscrever', { slug: 'entrenos2026', sub });
    expect(r.status).toBe(200);
    const subs = [...FOTOS.m.entries()].filter(([k]) => k.startsWith('aviso:sub:entrenos2026:'));
    expect(subs.length).toBe(1);
    expect(subs[0][1].m).toMatchObject({ e: sub.endpoint, p: nav.chaves.p256dh, a: nav.chaves.auth });
    expect((await pede('https://entrenos2026.com/api/aviso/inscrever', { slug: 'entrenos2026', sub: { ...sub, endpoint: 'https://evil.example/x' } })).status).toBe(400);
    expect((await pede('https://entrenos2026.com/api/aviso/inscrever', { slug: 'entrenos2026', sub: { ...sub, keys: { p256dh: 'x', auth: 'y' } } })).status).toBe(400);
    expect((await pede('https://entrenos2026.com/api/aviso/sair', { slug: 'entrenos2026', endpoint: sub.endpoint })).status).toBe(200);
    expect([...FOTOS.m.keys()].filter(k => k.startsWith('aviso:sub:')).length).toBe(0);
  });

  it('álbum que a pessoa não pode ver (em breve, sem passe): 404, nada guardado', async () => {
    const { FOTOS, pede } = await cenario({ ...EV, comingSoon: true, visible: false });
    const nav = await navegador();
    const r = await pede('https://entrenos2026.com/api/aviso/inscrever', { slug: 'entrenos2026', sub: { endpoint: 'https://fcm.googleapis.com/fcm/send/XYZ', keys: nav.chaves } });
    expect(r.status).toBe(404);
    expect([...FOTOS.m.keys()].filter(k => k.startsWith('aviso:sub:')).length).toBe(0);
  });

  it('a chave pública, o service worker e o manifesto do álbum', async () => {
    const { pede } = await cenario();
    const c = await (await pede('https://entrenos2026.com/api/aviso/chave')).json();
    expect(deB64url(c.chave).length).toBe(65);
    const sw = await pede('https://entrenos2026.com/sw.js');
    expect(sw.headers.get('Content-Type')).toMatch(/javascript/);
    expect(sw.headers.get('Service-Worker-Allowed')).toBe('/');
    const t = await sw.text();
    expect(t).toContain("addEventListener('push'");
    expect(t).not.toContain("addEventListener('fetch'");
    const m = await (await pede('https://entrenos2026.com/manifest-album.json')).json();
    expect(m).toMatchObject({ short_name: 'Entre Nós', start_url: '/', display: 'standalone' });
  });
});
