// Aviso de fotos novas no celular (v3.8.4): Web Push, sem serviço pago.
//
// - A chave do site (VAPID, ECDSA P-256) nasce sozinha no primeiro uso e fica
//   no KV (`aviso:vapid`). Ela só assina os avisos deste site: quem a tivesse
//   ainda precisaria dos endereços de entrega, que moram no mesmo KV.
// - Cada inscrição é uma chave do KV (`aviso:sub:<slug>:<hash>`) com o
//   endereço de entrega e as chaves do navegador nos METADADOS: o envio lista
//   as chaves e já tem tudo, sem uma leitura por pessoa.
// - O texto vai cifrado (RFC 8291, aes128gcm): o serviço de entrega (Google,
//   Apple, Mozilla) não o lê.
// - O disparo: o indexador manda fotos novas → `marcaFotosNovas` junta por
//   evento; o cron (a cada 5 min) manda no máximo um aviso por álbum a cada
//   AVISO_INTERVALO_MS, em lotes de AVISO_LOTE inscrições por execução.
import { AVISO_INTERVALO_MS, AVISO_LOTE, AVISO_HOSTS } from './config.js';

const enc = new TextEncoder();

/** @param {Uint8Array | ArrayBuffer} b */
export function b64url(b) {
  const u = b instanceof Uint8Array ? b : new Uint8Array(b);
  let s = '';
  for (let i = 0; i < u.length; i++) s += String.fromCharCode(u[i]);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/** @param {string} s */
export function deB64url(s) {
  const b = atob(String(s).replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((String(s).length + 3) % 4));
  const u = new Uint8Array(b.length);
  for (let i = 0; i < b.length; i++) u[i] = b.charCodeAt(i);
  return u;
}

/** @param {...Uint8Array} partes */
function junta(...partes) {
  const u = new Uint8Array(partes.reduce((n, p) => n + p.length, 0));
  let i = 0;
  for (const p of partes) { u.set(p, i); i += p.length; }
  return u;
}

/** @type {{ privada: CryptoKey, publica: string } | null} */
let chaveEmMemoria = null;

/**
 * A chave VAPID do site: lida do KV; criada (e guardada) na primeira vez.
 * @param {{ FOTOS: any }} env
 * @returns {Promise<{ privada: CryptoKey, publica: string }>}
 */
export async function chaveVapid(env) {
  if (chaveEmMemoria) return chaveEmMemoria;
  const guardada = await env.FOTOS.get('aviso:vapid');
  if (guardada) {
    const j = JSON.parse(guardada);
    const privada = await crypto.subtle.importKey('jwk', j.jwk, { name: 'ECDSA', namedCurve: 'P-256' }, false, ['sign']);
    chaveEmMemoria = { privada, publica: String(j.publica) };
    return chaveEmMemoria;
  }
  const par = /** @type {CryptoKeyPair} */ (await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify']));
  const jwk = await crypto.subtle.exportKey('jwk', par.privateKey);
  const publica = b64url(/** @type {ArrayBuffer} */ (await crypto.subtle.exportKey('raw', par.publicKey)));
  await env.FOTOS.put('aviso:vapid', JSON.stringify({ jwk, publica }));
  chaveEmMemoria = { privada: par.privateKey, publica };
  return chaveEmMemoria;
}

/** Só para os testes: esquece a chave do isolate. */
export function esqueceChave() { chaveEmMemoria = null; }

/**
 * O cabeçalho Authorization do VAPID (RFC 8292) para um serviço de entrega.
 * @param {{ privada: CryptoKey, publica: string }} chave
 * @param {string} endpoint
 */
export async function autorizacaoVapid(chave, endpoint) {
  const aud = new URL(endpoint).origin;
  const cab = b64url(enc.encode(JSON.stringify({ typ: 'JWT', alg: 'ES256' })));
  const corpo = b64url(enc.encode(JSON.stringify({ aud, exp: Math.floor(Date.now() / 1000) + 12 * 3600, sub: 'mailto:privacidade@lucafchala.com' })));
  const assinatura = await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, chave.privada, enc.encode(`${cab}.${corpo}`));
  return `vapid t=${cab}.${corpo}.${b64url(assinatura)}, k=${chave.publica}`;
}

/** @param {Uint8Array} salt @param {Uint8Array} ikm @param {Uint8Array} info @param {number} bytes */
async function hkdf(salt, ikm, info, bytes) {
  const k = await crypto.subtle.importKey('raw', ikm, 'HKDF', false, ['deriveBits']);
  return new Uint8Array(await crypto.subtle.deriveBits({ name: 'HKDF', hash: 'SHA-256', salt, info }, k, bytes * 8));
}

/**
 * Cifra o aviso para um navegador (RFC 8291, aes128gcm, um registro só).
 * @param {string} texto
 * @param {{ p256dh: string, auth: string }} chaves as do navegador
 * @param {{ par?: CryptoKeyPair, salt?: Uint8Array }} [fixo] só para os testes
 */
export async function cifra(texto, chaves, fixo = {}) {
  const uaPublica = deB64url(chaves.p256dh);
  const auth = deB64url(chaves.auth);
  const par = fixo.par || /** @type {CryptoKeyPair} */ (await crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits']));
  const asPublica = new Uint8Array(/** @type {ArrayBuffer} */ (await crypto.subtle.exportKey('raw', par.publicKey)));
  const uaChave = await crypto.subtle.importKey('raw', uaPublica, { name: 'ECDH', namedCurve: 'P-256' }, false, []);
  const segredo = new Uint8Array(await crypto.subtle.deriveBits(/** @type {any} */ ({ name: 'ECDH', public: uaChave }), par.privateKey, 256));
  const ikm = await hkdf(auth, segredo, junta(enc.encode('WebPush: info\0'), uaPublica, asPublica), 32);
  const salt = fixo.salt || crypto.getRandomValues(new Uint8Array(16));
  const cek = await hkdf(salt, ikm, enc.encode('Content-Encoding: aes128gcm\0'), 16);
  const nonce = await hkdf(salt, ikm, enc.encode('Content-Encoding: nonce\0'), 12);
  const chave = await crypto.subtle.importKey('raw', cek, 'AES-GCM', false, ['encrypt']);
  const cifrado = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv: nonce }, chave, junta(enc.encode(texto), new Uint8Array([2]))));
  const rs = new Uint8Array([0, 0, 16, 0]); // 4096
  return junta(salt, rs, new Uint8Array([asPublica.length]), asPublica, cifrado);
}

/**
 * Endereço de entrega aceito: https, num serviço de push conhecido. Evita que
 * o site vire um disparador de pedidos para qualquer endereço.
 * @param {unknown} endpoint
 */
export function endpointValido(endpoint) {
  if (typeof endpoint !== 'string' || endpoint.length > 1000) return false;
  let u;
  try { u = new URL(endpoint); } catch { return false; }
  if (u.protocol !== 'https:') return false;
  const h = u.hostname.toLowerCase();
  return AVISO_HOSTS.some(x => (x.startsWith('.') ? h.endsWith(x) : h === x));
}

/** @param {string} endpoint */
async function hashDe(endpoint) {
  return b64url(await crypto.subtle.digest('SHA-256', enc.encode(endpoint))).slice(0, 32);
}

/**
 * Guarda a inscrição (ou a troca, se o mesmo navegador se inscrever de novo).
 * @param {{ FOTOS: any }} env
 * @param {string} slug
 * @param {{ endpoint: string, keys: { p256dh: string, auth: string } }} sub
 */
export async function inscreve(env, slug, sub) {
  const meta = { e: sub.endpoint, p: sub.keys.p256dh, a: sub.keys.auth, t: Date.now() };
  if (JSON.stringify(meta).length > 1000) throw new Error('inscrição grande demais');
  await env.FOTOS.put(`aviso:sub:${slug}:${await hashDe(sub.endpoint)}`, '1', { metadata: meta });
}

/** @param {{ FOTOS: any }} env @param {string} slug @param {string} endpoint */
export async function desinscreve(env, slug, endpoint) {
  await env.FOTOS.delete(`aviso:sub:${slug}:${await hashDe(endpoint)}`);
}

/**
 * Fotos novas chegaram ao índice: junta por evento até o próximo envio.
 * @param {{ FOTOS: any }} env @param {string} slug @param {string[]} caps um por foto
 */
export async function marcaFotosNovas(env, slug, caps) {
  if (!caps.length) return;
  const chave = `aviso:pendente:${slug}`;
  /** @type {{ n: number, caps: Record<string, number>, desde: number }} */
  let p = { n: 0, caps: {}, desde: Date.now() };
  try { p = JSON.parse((await env.FOTOS.get(chave)) || 'null') || p; } catch { /* começa de novo */ }
  for (const c of caps) { p.n++; p.caps[c || ''] = (p.caps[c || ''] || 0) + 1; }
  await env.FOTOS.put(chave, JSON.stringify(p));
}

/**
 * O texto do aviso.
 * @param {{ titulo: string, slug: string }} album
 * @param {{ n: number, caps: Record<string, number> }} p
 * @param {Record<string, string>} nomes slug do evento → nome
 * @param {(cap: string) => string} link
 */
export function textoDoAviso(album, p, nomes, link) {
  const caps = Object.entries(p.caps).sort((a, b) => b[1] - a[1]).map(([c]) => c);
  const nomesEv = caps.map(c => nomes[c]).filter(Boolean);
  const onde = nomesEv.length === 1 ? ` em ${nomesEv[0]}` : nomesEv.length === 2 ? ` em ${nomesEv[0]} e ${nomesEv[1]}` : nomesEv.length > 2 ? ` em ${nomesEv[0]}, ${nomesEv[1]} e mais ${nomesEv.length - 2}` : '';
  return {
    t: album.titulo,
    b: `${p.n === 1 ? '1 foto nova' : `${p.n} fotos novas`}${onde}. Toque para ver.`,
    u: caps.length === 1 && caps[0] ? link(caps[0]) : link(''),
    tag: `fotos-novas-${album.slug}`,
  };
}

/**
 * Manda um aviso a um navegador. Devolve o status do serviço de entrega
 * (404/410 = inscrição que não vale mais).
 * @param {{ privada: CryptoKey, publica: string }} chave
 * @param {{ e: string, p: string, a: string }} meta
 * @param {object} aviso
 * @param {typeof fetch} [f]
 */
export async function mandaUm(chave, meta, aviso, f = fetch) {
  const corpo = await cifra(JSON.stringify(aviso), { p256dh: meta.p, auth: meta.a });
  const r = await f(meta.e, {
    method: 'POST',
    headers: { TTL: '86400', Urgency: 'normal', 'Content-Encoding': 'aes128gcm', 'Content-Type': 'application/octet-stream', Authorization: await autorizacaoVapid(chave, meta.e) },
    body: corpo,
  });
  return r.status;
}

/**
 * O envio no cron: para cada álbum com fotos novas pendentes e fora do
 * intervalo, manda em lotes (continua na execução seguinte pelo cursor).
 * @param {{ FOTOS: any }} env
 * @param {{ slug: string, titulo: string, nomes: Record<string, string>, link: (cap: string) => string }[]} albuns
 * @param {number} [agora]
 * @param {typeof fetch} [f]
 */
export async function enviaPendentes(env, albuns, agora = Date.now(), f = fetch) {
  /** @type {{ slug: string, enviados: number, removidos: number }[]} */
  const feitos = [];
  for (const a of albuns) {
    const kEnvio = `aviso:envio:${a.slug}`;
    /** @type {{ cursor?: string, aviso: any, em: number } | null} */
    let envio = null;
    try { envio = JSON.parse((await env.FOTOS.get(kEnvio)) || 'null'); } catch { envio = null; }
    if (!envio) {
      const pendente = await env.FOTOS.get(`aviso:pendente:${a.slug}`);
      if (!pendente) continue;
      const ultimo = Number(await env.FOTOS.get(`aviso:ultimo:${a.slug}`)) || 0;
      if (agora - ultimo < AVISO_INTERVALO_MS) continue;
      envio = { aviso: textoDoAviso(a, JSON.parse(pendente), a.nomes, a.link), em: agora };
      await env.FOTOS.delete(`aviso:pendente:${a.slug}`);
      await env.FOTOS.put(`aviso:ultimo:${a.slug}`, String(agora));
    }
    const lista = await env.FOTOS.list({ prefix: `aviso:sub:${a.slug}:`, limit: AVISO_LOTE, ...(envio.cursor ? { cursor: envio.cursor } : {}) });
    const chave = await chaveVapid(env);
    let enviados = 0, removidos = 0;
    await Promise.all(lista.keys.map(async (/** @type {{ name: string, metadata?: any }} */ k) => {
      const m = k.metadata;
      if (!m || !endpointValido(m.e)) { await env.FOTOS.delete(k.name); removidos++; return; }
      try {
        const st = await mandaUm(chave, m, envio.aviso, f);
        if (st === 404 || st === 410) { await env.FOTOS.delete(k.name); removidos++; } else if (st < 300) enviados++;
      } catch (e) {
        console.error('aviso: envio falhou', e);
      }
    }));
    if (lista.list_complete) await env.FOTOS.delete(kEnvio);
    else await env.FOTOS.put(kEnvio, JSON.stringify({ ...envio, cursor: lista.cursor }));
    feitos.push({ slug: a.slug, enviados, removidos });
  }
  return feitos;
}

/** O service worker do álbum: mostra o aviso e abre o link ao tocar. Não intercepta nada. */
export const SERVICE_WORKER = `self.addEventListener('push', function (e) {
  var d = {};
  try { d = e.data ? e.data.json() : {}; } catch (x) { d = {}; }
  e.waitUntil(self.registration.showNotification(d.t || 'Fotos novas', { body: d.b || 'Chegaram fotos novas no álbum.', icon: '/apple-touch-entrenos.png', badge: '/apple-touch-entrenos.png', tag: d.tag || 'fotos-novas', data: { u: d.u || '/' } }));
});
self.addEventListener('notificationclick', function (e) {
  e.notification.close();
  var u = (e.notification.data && e.notification.data.u) || '/';
  e.waitUntil(self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(function (l) {
    for (var i = 0; i < l.length; i++) if (l[i].url.indexOf(self.location.origin) === 0 && 'focus' in l[i]) { l[i].navigate(u); return l[i].focus(); }
    return self.clients.openWindow(u);
  }));
});
`;
