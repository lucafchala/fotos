// IndexNow (v3.11.0, pedido do dono: "quero a galeria indexada em tudo"). O
// que estes testes prendem:
//  1. só a diferença vai ao IndexNow — o que entrou E o que saiu —, um pedido
//     por domínio, com a chave publicada naquele domínio;
//  2. sem mudança, zero gravação no KV (1.000/dia, dividido com a conta);
//  3. o que vale é por domínio: o aceito grava, o recusado fica com a lista de
//     antes e só ele vai de novo; lista desconhecida (Drive fora) não avisa;
//  4. a chave responde em /<chave>.txt nos dois domínios;
//  5. o cron só avisa com INDEXNOW = "ligado" e fora da prévia (mesmo que ela
//     herde a variável), e só a cada 15 min.
import { describe, it, expect, vi, afterEach } from 'vitest';
import worker from '../src/index.js';
import {
  INDEXNOW_CHAVE, INDEXNOW_CAMINHO, INDEXNOW_ENDPOINT, INDEXNOW_KV,
  diferenca, porDominio, avisaIndexNow, indexNowLigado, ehPassadaDoIndexNow,
} from '../src/indexnow.js';
import { withDurableObjects } from './helpers/do.js';

function fakeKV(inicial = {}) {
  const store = new Map(Object.entries(inicial));
  /** @type {string[]} */
  const puts = [];
  return {
    async get(/** @type {string} */ k) { return store.has(k) ? store.get(k) : null; },
    async put(/** @type {string} */ k, /** @type {string} */ v) { puts.push(k); store.set(k, v); },
    async delete(/** @type {string} */ k) { store.delete(k); },
    async list() { return { keys: [], list_complete: true, cursor: null }; },
    store, puts,
  };
}
const ok = (status = 200) => vi.fn(async () => new Response(null, { status }));
/** @param {any} f */
const corpos = f => f.mock.calls.map((/** @type {any[]} */ c) => JSON.parse(c[1].body));

afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });

describe('as peças', () => {
  it('diferenca: o que entrou e o que saiu, sem repetir', () => {
    expect(diferenca(['a', 'b'], ['b', 'c'])).toEqual(['a', 'c']);
    expect(diferenca(['a'], ['a'])).toEqual([]);
    expect(diferenca([], ['x', 'x'])).toEqual(['x']);
  });

  it('porDominio: um grupo por host; URL inválida fica de fora', () => {
    const m = porDominio(['https://fotos.lucafchala.com/a', 'https://entrenos2026.com/b', 'https://fotos.lucafchala.com/c', 'lixo']);
    expect([...m.keys()]).toEqual(['fotos.lucafchala.com', 'entrenos2026.com']);
    expect(m.get('fotos.lucafchala.com')).toEqual(['https://fotos.lucafchala.com/a', 'https://fotos.lucafchala.com/c']);
  });

  it('ligado só com INDEXNOW = "ligado"; passada a cada 15 min', () => {
    expect(indexNowLigado({ INDEXNOW: 'ligado' })).toBe(true);
    expect(indexNowLigado({ INDEXNOW: ' Ligado ' })).toBe(true);
    expect(indexNowLigado({})).toBe(false);
    expect(indexNowLigado({ INDEXNOW: 'sim' })).toBe(false);
    expect(indexNowLigado(null)).toBe(false);
    // A prévia é recusada pelo nome, mesmo se herdar a variável de produção.
    expect(indexNowLigado({ INDEXNOW: 'ligado', AMBIENTE: 'previa' })).toBe(false);
    expect(ehPassadaDoIndexNow(undefined)).toBe(true);
    expect(ehPassadaDoIndexNow({ scheduledTime: Date.UTC(2026, 10, 13, 9, 30) })).toBe(true);
    expect(ehPassadaDoIndexNow({ scheduledTime: Date.UTC(2026, 10, 13, 9, 46) })).toBe(true);
    expect(ehPassadaDoIndexNow({ scheduledTime: Date.UTC(2026, 10, 13, 9, 35) })).toBe(false);
    expect(ehPassadaDoIndexNow({ scheduledTime: Date.UTC(2026, 10, 13, 9, 50) })).toBe(false);
  });
});

describe('avisaIndexNow', () => {
  const A = 'https://fotos.lucafchala.com/a';
  const B = 'https://fotos.lucafchala.com/b';
  const E = 'https://entrenos2026.com/festa';

  it('primeira passada: avisa tudo, um pedido por domínio, com a chave do domínio; grava a lista', async () => {
    const kv = fakeKV();
    const f = ok();
    const r = await avisaIndexNow(/** @type {any} */ ({ FOTOS: kv }), [B, A, E], /** @type {any} */ (f));
    expect(r).toEqual({ avisadas: 3, falhas: [] });
    expect(f).toHaveBeenCalledTimes(2);
    for (const c of f.mock.calls) expect(/** @type {any} */ (c)[0]).toBe(INDEXNOW_ENDPOINT);
    const pedidos = corpos(f);
    const p1 = pedidos.find((/** @type {any} */ p) => p.host === 'fotos.lucafchala.com');
    const p2 = pedidos.find((/** @type {any} */ p) => p.host === 'entrenos2026.com');
    expect(p1).toEqual({ host: 'fotos.lucafchala.com', key: INDEXNOW_CHAVE, keyLocation: `https://fotos.lucafchala.com${INDEXNOW_CAMINHO}`, urlList: [A, B] });
    expect(p2).toEqual({ host: 'entrenos2026.com', key: INDEXNOW_CHAVE, keyLocation: `https://entrenos2026.com${INDEXNOW_CAMINHO}`, urlList: [E] });
    expect(JSON.parse(kv.store.get(INDEXNOW_KV))).toEqual([E, A, B].sort());
  });

  it('sem mudança: nenhum pedido e nenhuma gravação', async () => {
    const kv = fakeKV({ [INDEXNOW_KV]: JSON.stringify([A, B]) });
    const f = ok();
    expect(await avisaIndexNow(/** @type {any} */ ({ FOTOS: kv }), [B, A], /** @type {any} */ (f))).toEqual({ avisadas: 0, falhas: [] });
    expect(f).not.toHaveBeenCalled();
    expect(kv.puts).toEqual([]);
  });

  it('o que saiu também é avisado (o buscador relê e tira do índice)', async () => {
    const kv = fakeKV({ [INDEXNOW_KV]: JSON.stringify([A, B]) });
    const f = ok(202);
    expect((await avisaIndexNow(/** @type {any} */ ({ FOTOS: kv }), [A], /** @type {any} */ (f))).avisadas).toBe(1);
    expect(corpos(f)[0].urlList).toEqual([B]);
    expect(JSON.parse(kv.store.get(INDEXNOW_KV))).toEqual([A]);
  });

  it('aviso recusado ou rede fora: não grava; a próxima passada manda de novo', async () => {
    for (const f of [ok(429), ok(403), vi.fn(async () => { throw new Error('rede'); })]) {
      const kv = fakeKV({ [INDEXNOW_KV]: JSON.stringify([A]) });
      const r = await avisaIndexNow(/** @type {any} */ ({ FOTOS: kv }), [A, B], /** @type {any} */ (f));
      expect(r.avisadas).toBe(0);
      expect(r.falhas).toHaveLength(1);
      expect(r.falhas[0]).toContain('fotos.lucafchala.com');
      expect(kv.puts).toEqual([]);
    }
  });

  // Revisão final do #313: antes uma recusa travava a lista de TODOS, e um
  // domínio de álbum recusado para sempre (chave não verificada, 403/422)
  // fazia o fotos.lucafchala.com, já aceito, ser reavisado a cada 15 min.
  it('um domínio aceito e outro recusado: grava só o aceito; a próxima passada reavisa só o recusado', async () => {
    const kv = fakeKV();
    const recusa = vi.fn(async (/** @type {string} */ _u, /** @type {any} */ init) => new Response(null, { status: JSON.parse(init.body).host === 'entrenos2026.com' ? 403 : 200 }));
    const r = await avisaIndexNow(/** @type {any} */ ({ FOTOS: kv }), [A, E], /** @type {any} */ (recusa));
    expect(r.falhas).toEqual(['entrenos2026.com: HTTP 403']);
    expect(r.avisadas).toBe(1);
    expect(JSON.parse(kv.store.get(INDEXNOW_KV))).toEqual([A]);

    // Recusado de novo: o fotos não vai outra vez, e nada é gravado.
    const de_novo = vi.fn(async (/** @type {string} */ _u, /** @type {any} */ init) => new Response(null, { status: JSON.parse(init.body).host === 'entrenos2026.com' ? 403 : 200 }));
    await avisaIndexNow(/** @type {any} */ ({ FOTOS: kv }), [A, E], /** @type {any} */ (de_novo));
    expect(corpos(de_novo).map((/** @type {any} */ p) => p.host)).toEqual(['entrenos2026.com']);
    expect(kv.puts).toEqual([INDEXNOW_KV]);

    // Aceito agora: só o que faltava vai, e a lista fica completa.
    const f = ok();
    expect((await avisaIndexNow(/** @type {any} */ ({ FOTOS: kv }), [A, E], /** @type {any} */ (f))).avisadas).toBe(1);
    expect(corpos(f)).toHaveLength(1);
    expect(corpos(f)[0].urlList).toEqual([E]);
    expect(JSON.parse(kv.store.get(INDEXNOW_KV))).toEqual([E, A].sort());
  });

  it('domínio recusado não perde o que saiu dele: a saída continua pendente até ser aceita', async () => {
    const kv = fakeKV({ [INDEXNOW_KV]: JSON.stringify([A, E]) });
    const recusa = vi.fn(async () => new Response(null, { status: 422 }));
    await avisaIndexNow(/** @type {any} */ ({ FOTOS: kv }), [A], /** @type {any} */ (recusa));
    expect(JSON.parse(kv.store.get(INDEXNOW_KV))).toEqual([A, E]);
    expect(kv.puts).toEqual([]);
  });

  it('lista desconhecida (null, Drive fora): não avisa nem grava', async () => {
    const kv = fakeKV({ [INDEXNOW_KV]: JSON.stringify([A, B]) });
    const f = ok();
    expect(await avisaIndexNow(/** @type {any} */ ({ FOTOS: kv }), null, /** @type {any} */ (f))).toEqual({ avisadas: 0, falhas: [] });
    expect(f).not.toHaveBeenCalled();
    expect(kv.puts).toEqual([]);
  });

  it('lista guardada corrompida: trata como vazia e reavisa tudo uma vez', async () => {
    const kv = fakeKV({ [INDEXNOW_KV]: '{nao é json' });
    const f = ok();
    expect((await avisaIndexNow(/** @type {any} */ ({ FOTOS: kv }), [A], /** @type {any} */ (f))).avisadas).toBe(1);
  });
});

describe('o arquivo da chave', () => {
  it('responde /<chave>.txt no fotos e no domínio do álbum; outra chave não', async () => {
    const env = withDurableObjects({ FOTOS: fakeKV({ events: '[]' }) });
    const ctx = { waitUntil() {} };
    for (const host of ['fotos.lucafchala.com', 'entrenos2026.com']) {
      const r = await worker.fetch(new Request(`https://${host}${INDEXNOW_CAMINHO}`), env, ctx);
      expect(r.status, host).toBe(200);
      expect(r.headers.get('Content-Type')).toContain('text/plain');
      expect(await r.text()).toBe(INDEXNOW_CHAVE);
    }
    expect((await worker.fetch(new Request(`https://fotos.lucafchala.com/${'0'.repeat(32)}.txt`), env, ctx)).status).toBe(404);
  });
});

describe('no cron', () => {
  const EVENTO = { id: '1', slug: 'projeto-comum', title: 'Projeto Comum', accessType: 'public', visible: true, comingSoon: false, driveUrl: 'https://drive.google.com/drive/folders/OUTRA_PASTA_001' };
  /** @param {Record<string, any>} extra */
  async function roda(extra) {
    const kv = fakeKV({ events: JSON.stringify([EVENTO]) });
    const f = vi.fn(async () => new Response('{}', { status: 200 }));
    vi.stubGlobal('fetch', f);
    /** @type {Promise<any>[]} */
    const pend = [];
    const env = withDurableObjects({ FOTOS: kv, ...extra });
    await worker.scheduled(/** @type {any} */ ({ scheduledTime: Date.UTC(2026, 10, 13, 9, 15) }), env, /** @type {any} */ ({ waitUntil: (/** @type {Promise<any>} */ p) => pend.push(p), passThroughOnException() {} }));
    await Promise.allSettled(pend);
    await new Promise(r => setTimeout(r, 0));
    const avisos = f.mock.calls.filter((/** @type {any[]} */ c) => String(c[0]) === INDEXNOW_ENDPOINT);
    return { kv, avisos };
  }

  it('ligado: avisa a página do projeto e a galeria pública', async () => {
    const { kv, avisos } = await roda({ INDEXNOW: 'ligado' });
    expect(avisos).toHaveLength(1);
    const urls = JSON.parse(/** @type {any} */ (avisos[0])[1].body).urlList;
    expect(urls).toContain('https://fotos.lucafchala.com/projeto-comum');
    expect(urls).toContain('https://fotos.lucafchala.com/galeria/projeto-comum');
    expect(urls).toContain('https://fotos.lucafchala.com/');
    expect(kv.store.has(INDEXNOW_KV)).toBe(true);
  });

  it('sem a variável (teste, Worker local, prévia): não avisa ninguém', async () => {
    const { kv, avisos } = await roda({});
    expect(avisos).toHaveLength(0);
    expect(kv.store.has(INDEXNOW_KV)).toBe(false);
  });

  it('prévia com a variável herdada: não avisa ninguém', async () => {
    const { kv, avisos } = await roda({ INDEXNOW: 'ligado', AMBIENTE: 'previa' });
    expect(avisos).toHaveLength(0);
    expect(kv.store.has(INDEXNOW_KV)).toBe(false);
  });
});
