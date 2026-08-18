import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import {
  checkRateLimit, getEvents, saveEvents, getCategories, DEFAULT_CATEGORIES,
  kvWriteHealth, resetKvWriteHealth,
  bumpCounter, flushCounters, resetCounters, pendingCounters,
} from '../src/utils.js';

// Minimal in-memory stand-in for a Workers KV namespace. Ignores expirationTtl
// (the tests run inside a single rate-limit window, so TTL is irrelevant).
function fakeKV(initial = {}) {
  const store = new Map(Object.entries(initial));
  return {
    async get(k) { return store.has(k) ? store.get(k) : null; },
    async put(k, v) { store.set(k, v); },
    async delete(k) { store.delete(k); },
    async list({ prefix = '' } = {}) {
      const keys = [...store.keys()].filter(k => k.startsWith(prefix)).map(name => ({ name }));
      return { keys, list_complete: true, cursor: null };
    },
    _store: store,
  };
}

describe('checkRateLimit', () => {
  it('allows up to the limit then blocks within the same window', async () => {
    const env = { FOTOS: fakeKV() };
    const results = [];
    for (let i = 0; i < 5; i++) results.push(await checkRateLimit(env, '1.2.3.4', 'login', 3, 600));
    expect(results).toEqual([true, true, true, false, false]);
  });
  it('tracks each IP independently', async () => {
    const env = { FOTOS: fakeKV() };
    expect(await checkRateLimit(env, 'a', 'k', 1, 600)).toBe(true);
    expect(await checkRateLimit(env, 'a', 'k', 1, 600)).toBe(false);
    expect(await checkRateLimit(env, 'b', 'k', 1, 600)).toBe(true);
  });
});

// KV que atingiu a cota diária de escrita (1000/dia no plano free): leitura
// continua respondendo, escrita é RECUSADA — e a recusa vem como exceção. É o
// estado esperado num dia de lançamento com público grande.
function writeExhaustedKV(initial = {}) {
  const kv = fakeKV(initial);
  kv.put = async () => { throw new Error('KV PUT failed: 429 Too Many Requests'); };
  return kv;
}

describe('checkRateLimit quando o KV recusa escrita (cota estourada)', () => {
  beforeEach(() => { resetKvWriteHealth(); vi.spyOn(console, 'error').mockImplementation(() => {}); });
  afterEach(() => { vi.restoreAllMocks(); resetKvWriteHealth(); });

  it('não propaga a exceção — a rota que chama não pode virar 500', async () => {
    const env = { FOTOS: writeExhaustedKV() };
    await expect(checkRateLimit(env, '1.2.3.4', 'drive-link', 60, 3600)).resolves.toBe(true);
  });

  it('deixa passar quando só a contabilidade falhou: a verificação já tinha passado', async () => {
    const env = { FOTOS: writeExhaustedKV() };
    const results = [];
    for (let i = 0; i < 3; i++) results.push(await checkRateLimit(env, '1.2.3.4', 'drive-link', 1, 3600));
    expect(results).toEqual([true, true, true]);
  });

  it('continua barrando quando o contador JÁ passou do limite antes da cota estourar', async () => {
    // Escrita recusada não zera o que já estava gravado: a leitura ainda vale,
    // então quem já estourou o limite continua barrado.
    const window = Math.floor(Date.now() / (3600 * 1000));
    const env = { FOTOS: writeExhaustedKV({ [`ratelimit:drive-link:1.2.3.4:${window}`]: '60' }) };
    expect(await checkRateLimit(env, '1.2.3.4', 'drive-link', 60, 3600)).toBe(false);
  });

  it('deixa passar, sem lançar, quando nem a LEITURA responde', async () => {
    const env = { FOTOS: { async get() { throw new Error('KV GET failed'); }, async put() {} } };
    await expect(checkRateLimit(env, '1.2.3.4', 'drive-link', 60, 3600)).resolves.toBe(true);
  });

  it('registra a falha para o healthz — falhar aberto não pode ser silencioso', async () => {
    expect(kvWriteHealth().failing).toBe(false);
    const env = { FOTOS: writeExhaustedKV() };
    await checkRateLimit(env, '1.2.3.4', 'drive-link', 60, 3600);
    const health = kvWriteHealth();
    expect(health.failing).toBe(true);
    expect(health.reason).toContain('429');
  });

  it('o registro envelhece sozinho depois de 30 min sem nova recusa', async () => {
    const env = { FOTOS: writeExhaustedKV() };
    await checkRateLimit(env, '1.2.3.4', 'drive-link', 60, 3600);
    expect(kvWriteHealth(Date.now() + 29 * 60_000).failing).toBe(true);
    expect(kvWriteHealth(Date.now() + 31 * 60_000).failing).toBe(false);
  });
});

// O custo do site não pode crescer junto com o público: a cota é fixa (1000
// escritas/dia) e o movimento não. Agregar é o que troca "uma escrita por
// visitante" por "uma escrita por janela".
describe('contadores agregados', () => {
  beforeEach(() => { resetCounters(); resetKvWriteHealth(); vi.spyOn(console, 'error').mockImplementation(() => {}); });
  afterEach(() => { vi.restoreAllMocks(); resetCounters(); });

  it('cem incrementos no mesmo slug viram UMA escrita', async () => {
    const env = { FOTOS: fakeKV() };
    let escritas = 0;
    const put = env.FOTOS.put.bind(env.FOTOS);
    env.FOTOS.put = async (...a) => { escritas++; return put(...a); };
    for (let i = 0; i < 100; i++) bumpCounter(env, null, 'views:piauifut-2026');
    await flushCounters(env);
    expect(escritas).toBe(1);
    expect(env.FOTOS._store.get('views:piauifut-2026')).toBe('100');
  });

  it('não grava nada antes do flush', async () => {
    const env = { FOTOS: fakeKV() };
    bumpCounter(env, null, 'views:x');
    expect(env.FOTOS._store.size).toBe(0);
    expect(pendingCounters().get('views:x')).toBe(1);
  });

  it('soma sobre o valor já gravado e zera o pendente', async () => {
    const env = { FOTOS: fakeKV({ 'views:x': '7' }) };
    bumpCounter(env, null, 'views:x');
    bumpCounter(env, null, 'views:x');
    await flushCounters(env);
    expect(env.FOTOS._store.get('views:x')).toBe('9');
    expect(pendingCounters().size).toBe(0);
  });

  it('mantém slugs separados', async () => {
    const env = { FOTOS: fakeKV() };
    bumpCounter(env, null, 'views:a');
    bumpCounter(env, null, 'views:b');
    bumpCounter(env, null, 'views:a');
    await flushCounters(env);
    expect(env.FOTOS._store.get('views:a')).toBe('2');
    expect(env.FOTOS._store.get('views:b')).toBe('1');
  });

  it('não grava "NaN" quando o valor guardado está corrompido', async () => {
    const env = { FOTOS: fakeKV({ 'views:x': 'NaN' }) };
    bumpCounter(env, null, 'views:x');
    await flushCounters(env);
    expect(env.FOTOS._store.get('views:x')).toBe('1');
  });

  it('nunca lança para quem chamou — é caminho de resposta do visitante', () => {
    expect(() => bumpCounter(null, null, 'views:x')).not.toThrow();
    expect(() => bumpCounter({ FOTOS: null }, null, 'views:x')).not.toThrow();
  });

  it('com a cota estourada, descarta o delta em vez de acumular para sempre', async () => {
    const env = { FOTOS: writeExhaustedKV() };
    bumpCounter(env, null, 'views:x');
    await flushCounters(env);
    expect(pendingCounters().size, 'o delta não pode voltar para a fila').toBe(0);
    expect(kvWriteHealth().failing, 'e o healthz precisa saber').toBe(true);
  });

  it('dois flushes ao mesmo tempo não se atropelam', async () => {
    const env = { FOTOS: fakeKV({ 'views:x': '0' }) };
    for (let i = 0; i < 5; i++) bumpCounter(env, null, 'views:x');
    await Promise.all([flushCounters(env), flushCounters(env), flushCounters(env)]);
    expect(env.FOTOS._store.get('views:x')).toBe('5');
  });

  it('flush sem nada pendente não gasta escrita', async () => {
    const env = { FOTOS: fakeKV() };
    await flushCounters(env);
    expect(env.FOTOS._store.size).toBe(0);
  });
});

// Cache API de mentira: um Map com a mesma superfície que o `caches.default` do
// Workers. Existe para que a CÓPIA DE SOBREVIVÊNCIA seja exercitada de verdade
// — em vitest `caches` não existe, e sem isto o caminho que salva um isolate
// frio nunca rodaria em teste nenhum.
function fakeCaches() {
  const store = new Map();
  return {
    _store: store,
    default: {
      async put(key, res) { store.set(String(key), await res.text()); },
      async match(key) {
        const v = store.get(String(key));
        return v === undefined ? undefined : new Response(v);
      },
    },
  };
}

// Isolate novo: `_cache` e o espelho são estado de módulo, e é justamente ele
// que decide o resultado destes casos.
async function coldIsolate() {
  vi.resetModules();
  return import('../src/utils.js');
}

const EVENTS = [{ id: '1', slug: 'piauifut-2026', title: 'PiauiFut+ 2026', visible: true,
  driveUrl: 'https://drive.google.com/drive/folders/ok' }];

const kvDown = () => ({ FOTOS: {
  async get() { throw new Error('KV GET failed: 503'); },
  async put() { throw new Error('KV PUT failed: 503'); },
} });

// A promessa do site é entregar foto. O KV é a única dependência no caminho
// crítico: sem a lista de eventos não há slug, não há evento e não há link.
describe('getEvents com o KV de leitura fora', () => {
  beforeEach(() => { vi.spyOn(console, 'error').mockImplementation(() => {}); });
  afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); vi.useRealTimers(); });

  it('serve o cache do isolate mesmo VENCIDO em vez de derrubar a página', async () => {
    const utils = await coldIsolate();
    const env = { FOTOS: fakeKV() };
    await utils.saveEvents(env, structuredClone(EVENTS));
    vi.setSystemTime(Date.now() + 120_000);                 // muito além do TTL de 30 s
    const got = await utils.getEvents(kvDown());
    expect(got.map(e => e.slug)).toEqual(['piauifut-2026']);
  });

  it('serve da cópia na Cache API num isolate FRIO — o caso comum numa queda', async () => {
    const caches = fakeCaches();
    vi.stubGlobal('caches', caches);
    // Um isolate anterior leu do KV e deixou a cópia.
    {
      const utils = await coldIsolate();
      await utils.getEvents({ FOTOS: fakeKV({ events: JSON.stringify(EVENTS) }) }, true);
    }
    expect([...caches._store.keys()]).toHaveLength(1);
    // Agora um isolate novo pega o KV fora e nunca viu a lista.
    const utils = await coldIsolate();
    const got = await utils.getEvents(kvDown());
    expect(got.map(e => e.slug)).toEqual(['piauifut-2026']);
    expect(utils.eventsFallbackCount()).toBe(1);
  });

  it('valida a forma da cópia igual à do KV (uma cópia corrompida não derruba)', async () => {
    const caches = fakeCaches();
    vi.stubGlobal('caches', caches);
    await caches.default.put('https://fotos.invalid/__events', new Response('{não é json'));
    const utils = await coldIsolate();
    expect(await utils.getEvents(kvDown())).toEqual([]);
  });

  it('propaga a falha quando não há cache NEM cópia — 500 honesto', async () => {
    vi.stubGlobal('caches', fakeCaches());
    const utils = await coldIsolate();
    // Devolver [] aqui viraria "o site não tem projeto nenhum": 404 em tudo e
    // painel verde. Assumir a falha é melhor do que mentir sobre não ter dado.
    await expect(utils.getEvents(kvDown())).rejects.toThrow(/KV GET failed/);
  });

  it('só reescreve a cópia quando o valor muda', async () => {
    const caches = fakeCaches();
    let writes = 0;
    const put = caches.default.put.bind(caches.default);
    caches.default.put = async (...a) => { writes++; return put(...a); };
    vi.stubGlobal('caches', caches);
    const utils = await coldIsolate();
    const env = { FOTOS: fakeKV({ events: JSON.stringify(EVENTS) }) };
    for (let i = 0; i < 5; i++) await utils.getEvents(env, true);
    expect(writes).toBe(1);
  });

  it('a cópia não é gravada quando o KV recusa a escrita', async () => {
    const caches = fakeCaches();
    vi.stubGlobal('caches', caches);
    const utils = await coldIsolate();
    const env = { FOTOS: { async get() { return null; }, async put() { throw new Error('KV PUT failed: 429'); } } };
    await expect(utils.saveEvents(env, EVENTS)).rejects.toThrow();
    // Espelhar um valor que não chegou a ser gravado faria a cópia contradizer
    // a fonte — e o visitante veria uma edição que o dono não conseguiu salvar.
    expect(caches._store.size).toBe(0);
  });
});

describe('getCategories com o KV fora', () => {
  it('cai nos padrões em vez de derrubar a galeria pela legenda', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    expect(await getCategories(kvDown())).toEqual(DEFAULT_CATEGORIES);
    vi.restoreAllMocks();
  });
});

describe('getEvents / saveEvents', () => {
  it('round-trips events through KV (fresh read bypasses the cache)', async () => {
    const env = { FOTOS: fakeKV() };
    const events = [{ id: 'a', slug: 'x' }, { id: 'b', slug: 'y' }];
    await saveEvents(env, events);
    expect(await getEvents(env, true)).toEqual(events);
  });
  it('returns an empty array when the key is missing or corrupt', async () => {
    expect(await getEvents({ FOTOS: fakeKV() }, true)).toEqual([]);
    expect(await getEvents({ FOTOS: fakeKV({ events: 'not json' }) }, true)).toEqual([]);
  });
});

describe('getCategories', () => {
  it('returns the defaults when nothing is stored', async () => {
    expect(await getCategories({ FOTOS: fakeKV() })).toEqual(DEFAULT_CATEGORIES);
  });
  it('parses a stored array and filters non-strings', async () => {
    const env = { FOTOS: fakeKV({ categories: JSON.stringify(['Casamento', 42, 'Ensaio']) }) };
    expect(await getCategories(env)).toEqual(['Casamento', 'Ensaio']);
  });
  it('falls back to defaults on non-array or invalid JSON', async () => {
    expect(await getCategories({ FOTOS: fakeKV({ categories: '{}' }) })).toEqual(DEFAULT_CATEGORIES);
    expect(await getCategories({ FOTOS: fakeKV({ categories: 'broken' }) })).toEqual(DEFAULT_CATEGORIES);
  });
});

// ---------------------------------------------------------------------------
// Corrupted KV values must degrade safely, never take the public site down or
// silently switch protections off.
// ---------------------------------------------------------------------------
describe('resilience to corrupted KV values', () => {
  it('getEvents drops junk entries instead of throwing on e.visible', async () => {
    const env = { FOTOS: fakeKV({ events: JSON.stringify([null, 'nope', 7, { id: 'ok', slug: 'ok' }]) }) };
    const events = await getEvents(env, true);
    expect(events).toHaveLength(1);
    expect(events[0].id).toBe('ok');
    // This is the exact expression galleryHTML/handleEventPage run.
    expect(() => events.filter(e => e.visible !== false)).not.toThrow();
    expect(() => events.find(e => e.slug === 'ok')).not.toThrow();
  });

  it('getEvents returns [] when the stored value is not an array', async () => {
    const env = { FOTOS: fakeKV({ events: JSON.stringify({ oops: true }) }) };
    expect(await getEvents(env, true)).toEqual([]);
  });

  it('getEvents returns [] on malformed JSON', async () => {
    const env = { FOTOS: fakeKV({ events: '{not json' }) };
    expect(await getEvents(env, true)).toEqual([]);
  });

  it('checkRateLimit still counts when the stored counter is unparseable (fails closed)', async () => {
    // A poisoned counter used to make parseInt return NaN; NaN >= limit is
    // false, so the limit stopped applying entirely for that key.
    const env = { FOTOS: fakeKV() };
    const window = Math.floor(Date.now() / (600 * 1000));
    env.FOTOS._store.set(`ratelimit:login:1.2.3.4:${window}`, 'NaN');
    const results = [];
    for (let i = 0; i < 4; i++) results.push(await checkRateLimit(env, '1.2.3.4', 'login', 2, 600));
    expect(results).toEqual([true, true, false, false]);
  });
});
