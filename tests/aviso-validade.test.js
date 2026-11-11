// Aviso de fotos novas (v3.8.9; revisão de nov/2026, achados 7 e 12).
//  1. a chave do site nasce UMA vez, mesmo com dois primeiros acessos ao mesmo
//     tempo e com o KV devolvendo "não existe" (ele demora a propagar);
//  2. a inscrição: o limite por IP é de escola (um IP só), e um pedido
//     malformado não o gasta;
//  3. o desfecho de cada envio: 404/410 apaga; 403 apaga na terceira recusa
//     seguida; entregue renova a validade, no máximo uma vez por mês.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { chaveVapid, esqueceChave, desfechoDoEnvio, enviaPendentes, marcaFotosNovas, b64url } from '../src/aviso.js';
import { AVISO_INSCRICAO_IP_BUCKET, AVISO_INSCRICAO_TTL_S, AVISO_RENOVA_DIAS, AVISO_RECUSAS_MAX, ROSTO_BUSCA_IP_BUCKET } from '../src/config.js';
import { withDurableObjects } from './helpers/do.js';

/** KV de mentira com metadados e validade. `atrasado`: as N primeiras leituras de uma chave dizem "não existe". */
function kv(atrasado = 0) {
  /** @type {Map<string, { v: string, m?: any, ttl?: number }>} */
  const m = new Map();
  /** @type {Map<string, number>} */
  const leituras = new Map();
  let gravacoes = 0;
  return {
    m,
    gravacoes: () => gravacoes,
    async get(/** @type {string} */ k) {
      const n = (leituras.get(k) || 0) + 1;
      leituras.set(k, n);
      if (n <= atrasado) return null;
      return m.has(k) ? /** @type {any} */ (m.get(k)).v : null;
    },
    async put(/** @type {string} */ k, /** @type {string} */ v, /** @type {any} */ o = {}) { gravacoes++; m.set(k, { v, m: o.metadata, ttl: o.expirationTtl }); },
    async delete(/** @type {string} */ k) { m.delete(k); },
    async list(/** @type {{ prefix?: string }} */ o = {}) {
      return { keys: [...m.keys()].filter(k => k.startsWith(o.prefix || '')).sort().map(name => ({ name, metadata: /** @type {any} */ (m.get(name)).m })), list_complete: true, cursor: null };
    },
  };
}
async function chavesDeNavegador() {
  const par = /** @type {CryptoKeyPair} */ (await crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits']));
  return { p256dh: b64url(/** @type {ArrayBuffer} */ (await crypto.subtle.exportKey('raw', par.publicKey))), auth: b64url(crypto.getRandomValues(new Uint8Array(16))) };
}

beforeEach(() => esqueceChave());
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });

describe('1. a chave do site nasce uma vez', () => {
  it('dois primeiros acessos ao mesmo tempo, de isolates diferentes, com o KV ainda vazio para os dois: a MESMA chave', async () => {
    // O KV diz "não existe" nas duas primeiras leituras (cada isolate lê uma vez).
    const env = /** @type {any} */ (withDurableObjects({ FOTOS: kv(2) }));
    const a = chaveVapid(env);
    esqueceChave(); // outro isolate: não divide a memória
    const b = chaveVapid(env);
    const [ca, cb] = await Promise.all([a, b]);
    expect(cb.publica).toBe(ca.publica);
    // E o que ficou no KV é ela.
    expect(JSON.parse(env.FOTOS.m.get('aviso:vapid').v).publica).toBe(ca.publica);
    // Um terceiro acesso, mais tarde, lê a mesma.
    esqueceChave();
    expect((await chaveVapid(env)).publica).toBe(ca.publica);
  });

  it('chave que já existe no KV (produção de hoje) é a que vale: nada é criado', async () => {
    const semDo = { FOTOS: kv() };
    const antiga = await chaveVapid(semDo);
    esqueceChave();
    const env = /** @type {any} */ (withDurableObjects({ FOTOS: semDo.FOTOS }));
    const n = semDo.FOTOS.gravacoes();
    expect((await chaveVapid(env)).publica).toBe(antiga.publica);
    expect(semDo.FOTOS.gravacoes()).toBe(n);
  });
});

describe('2. a inscrição pela rota', () => {
  const EV = { id: '1', slug: 'album', title: 'Álbum de teste', accessType: 'public', galeriaCapitulos: true, galeriaAbertura: 'Oi.', driveUrl: 'https://drive.google.com/drive/folders/RAIZ_PASTA_0001', comingSoon: false, visible: true };
  async function cenario() {
    const FOTOS = kv();
    await FOTOS.put('events', JSON.stringify([EV]));
    const env = withDurableObjects({ FOTOS, SIGNING_SECRET: 's'.repeat(48) });
    vi.resetModules();
    const w = (await import('../src/index.js')).default;
    const pede = (/** @type {any} */ corpo, ip = '203.0.113.7') => w.fetch(new Request('https://fotos.lucafchala.com/api/aviso/inscrever', { method: 'POST', headers: { 'Content-Type': 'application/json', 'CF-Connecting-IP': ip, Origin: 'https://fotos.lucafchala.com' }, body: JSON.stringify(corpo) }), env, /** @type {any} */ ({ waitUntil() {} }));
    return { FOTOS, pede };
  }

  it('o limite por IP é de escola: na ordem do da busca pelo rosto, não 20 por hora', () => {
    expect(AVISO_INSCRICAO_IP_BUCKET.capacity).toBeGreaterThanOrEqual(ROSTO_BUSCA_IP_BUCKET.capacity);
    expect(AVISO_INSCRICAO_IP_BUCKET.perHour).toBeGreaterThanOrEqual(ROSTO_BUSCA_IP_BUCKET.perHour);
  });

  it('pedido malformado não gasta o limite do IP: depois de uma enxurrada deles, a inscrição boa passa', async () => {
    const { FOTOS, pede } = await cenario();
    const chaves = await chavesDeNavegador();
    for (let i = 0; i < AVISO_INSCRICAO_IP_BUCKET.capacity + 20; i++) {
      const r = await pede({ slug: 'album', sub: { endpoint: 'https://evil.example/x', keys: chaves } });
      expect(r.status).toBe(400);
    }
    const boa = await pede({ slug: 'album', sub: { endpoint: 'https://fcm.googleapis.com/fcm/send/A', keys: chaves } });
    expect(boa.status).toBe(200);
    const [chave] = [...FOTOS.m.keys()].filter(k => k.startsWith('aviso:sub:'));
    expect(/** @type {any} */ (FOTOS.m.get(chave)).ttl).toBe(AVISO_INSCRICAO_TTL_S);
  }, 60_000);

  it('o limite existe: passado o balde, 429', async () => {
    const { pede } = await cenario();
    const chaves = await chavesDeNavegador();
    let recusadas = 0;
    for (let i = 0; i < AVISO_INSCRICAO_IP_BUCKET.capacity + 5; i++) {
      const r = await pede({ slug: 'album', sub: { endpoint: `https://fcm.googleapis.com/fcm/send/${i}`, keys: chaves } }, '198.51.100.9');
      if (r.status === 429) recusadas++;
    }
    expect(recusadas).toBeGreaterThanOrEqual(4);
  }, 60_000);
});

describe('3. o desfecho de cada envio', () => {
  const agora = Date.parse('2026-11-20T15:00:00Z');
  const DIA = 86400_000;
  const meta = (/** @type {Record<string, unknown>} */ extra = {}) => ({ e: 'https://fcm.googleapis.com/fcm/send/A', p: 'p', a: 'a', t: agora - DIA, ...extra });

  it('404 e 410: a inscrição não existe mais', () => {
    for (const st of [404, 410]) expect(desfechoDoEnvio(st, meta(), agora).acao).toBe('apaga');
  });

  it('403: conta; apaga só na recusa de número AVISO_RECUSAS_MAX seguida', () => {
    expect(AVISO_RECUSAS_MAX).toBeGreaterThanOrEqual(2);
    let m = /** @type {any} */ (meta());
    for (let i = 1; i < AVISO_RECUSAS_MAX; i++) {
      const d = desfechoDoEnvio(403, m, agora);
      expect(d).toMatchObject({ acao: 'grava', recusada: true, entregue: false });
      expect(/** @type {any} */ (d.meta).f).toBe(i);
      m = d.meta;
    }
    expect(desfechoDoEnvio(403, m, agora)).toMatchObject({ acao: 'apaga', recusada: true });
  });

  it('entregue depois de uma recusa: a contagem zera (as recusas têm de ser seguidas)', () => {
    const d = desfechoDoEnvio(201, meta({ f: AVISO_RECUSAS_MAX - 1 }), agora);
    expect(d).toMatchObject({ acao: 'grava', entregue: true });
    expect(/** @type {any} */ (d.meta).f).toBeUndefined();
  });

  it('entregue: renova a validade só se a inscrição não é renovada há AVISO_RENOVA_DIAS', () => {
    expect(desfechoDoEnvio(201, meta({ t: agora - (AVISO_RENOVA_DIAS - 1) * DIA }), agora)).toMatchObject({ acao: 'nada', entregue: true });
    const velha = desfechoDoEnvio(201, meta({ t: agora - (AVISO_RENOVA_DIAS + 1) * DIA }), agora);
    expect(velha).toMatchObject({ acao: 'grava', entregue: true });
    expect(/** @type {any} */ (velha.meta).t).toBe(agora);
    // Inscrição de antes desta versão, sem data: renova (e ganha validade).
    expect(desfechoDoEnvio(201, { e: 'x', p: 'p', a: 'a' }, agora).acao).toBe('grava');
  });

  it('429 e 5xx: fica como está, o próximo aviso tenta de novo', () => {
    for (const st of [429, 500, 503]) expect(desfechoDoEnvio(st, meta(), agora)).toEqual({ acao: 'nada', entregue: false, recusada: false });
  });

  it('no envio de verdade: três avisos recusados (403) e a inscrição sai; a renovada é gravada com validade', async () => {
    const env = { FOTOS: kv() };
    const chaves = await chavesDeNavegador();
    const album = { slug: 'album', titulo: 'Álbum', nomes: {}, link: () => 'https://site.test/' };
    await env.FOTOS.put('aviso:sub:album:recusada', '1', { metadata: { e: 'https://fcm.googleapis.com/fcm/send/R', p: chaves.p256dh, a: chaves.auth, t: agora } });
    await env.FOTOS.put('aviso:sub:album:antiga', '1', { metadata: { e: 'https://fcm.googleapis.com/fcm/send/V', p: chaves.p256dh, a: chaves.auth } });
    const f = vi.fn(async (/** @type {string} */ url) => new Response(null, { status: url.endsWith('/R') ? 403 : 201 }));
    for (let i = 0; i < AVISO_RECUSAS_MAX; i++) {
      expect(env.FOTOS.m.has('aviso:sub:album:recusada')).toBe(true);
      await marcaFotosNovas(env, 'album', ['x']);
      const r = await enviaPendentes(env, [album], agora + i * 4 * 3600_000, /** @type {any} */ (f));
      expect(r[0]).toMatchObject({ enviados: 1, recusados: 1 });
    }
    expect(env.FOTOS.m.has('aviso:sub:album:recusada')).toBe(false);
    const antiga = /** @type {any} */ (env.FOTOS.m.get('aviso:sub:album:antiga'));
    expect(antiga.ttl).toBe(AVISO_INSCRICAO_TTL_S);
    expect(antiga.m.t).toBe(agora);
  });
});
