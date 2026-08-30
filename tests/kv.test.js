import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import {
  checkRateLimit, getEvents, saveEvents, getCategories, DEFAULT_CATEGORIES,
  MAX_CATEGORIES, MAX_CATEGORY_LEN,
  degradedHealth, resetDegraded, noteDegraded,
  bumpCounter, readCounter, readCounters, deleteCounters,
} from '../src/utils.js';
import { withDurableObjects, brokenDONamespace } from './helpers/do.js';

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
    const env = withDurableObjects({ FOTOS: fakeKV() });
    const results = [];
    for (let i = 0; i < 5; i++) results.push(await checkRateLimit(env, '1.2.3.4', 'login', 3, 600));
    expect(results).toEqual([true, true, true, false, false]);
  });
  it('tracks each IP independently', async () => {
    const env = withDurableObjects({ FOTOS: fakeKV() });
    expect(await checkRateLimit(env, 'a', 'k', 1, 600)).toBe(true);
    expect(await checkRateLimit(env, 'a', 'k', 1, 600)).toBe(false);
    expect(await checkRateLimit(env, 'b', 'k', 1, 600)).toBe(true);
  });
  it('separa chaves diferentes do mesmo IP', async () => {
    // `login` e `login-day` correm no mesmo IP e não podem dividir contagem:
    // era o que fazia uma tentativa barrada pela rajada gastar também o
    // orçamento diário.
    const env = withDurableObjects({ FOTOS: fakeKV() });
    expect(await checkRateLimit(env, 'a', 'login', 1, 600)).toBe(true);
    expect(await checkRateLimit(env, 'a', 'login', 1, 600)).toBe(false);
    expect(await checkRateLimit(env, 'a', 'login-day', 1, 86400)).toBe(true);
  });
});

describe('checkRateLimit quando o Durable Object não responde', () => {
  beforeEach(() => { resetDegraded(); vi.spyOn(console, 'error').mockImplementation(() => {}); });
  afterEach(() => { vi.restoreAllMocks(); resetDegraded(); });

  it('falha ABERTO — a rota que chama não pode virar 500', async () => {
    // Decisão de disponibilidade, não de cota: uma falha de contabilidade não
    // pode derrubar a entrega das fotos nem trancar o dono fora do painel.
    const env = { FOTOS: fakeKV(), RATELIMIT: brokenDONamespace() };
    await expect(checkRateLimit(env, '1.2.3.4', 'drive-link', 60, 3600)).resolves.toBe(true);
  });

  it('registra a falha para o healthz — falhar aberto não pode ser silencioso', async () => {
    expect(degradedHealth()).toEqual([]);
    const env = { FOTOS: fakeKV(), RATELIMIT: brokenDONamespace('sem DO') };
    await checkRateLimit(env, '1.2.3.4', 'drive-link', 60, 3600);
    const [d] = degradedHealth();
    expect(d.label).toMatch(/rate limit indisponível/);
    expect(d.detail).toContain('drive-link');
  });

  it('o registro envelhece sozinho depois de 30 min sem nova falha', async () => {
    const env = { FOTOS: fakeKV(), RATELIMIT: brokenDONamespace() };
    await checkRateLimit(env, '1.2.3.4', 'drive-link', 60, 3600);
    expect(degradedHealth(Date.now() + 29 * 60_000)).toHaveLength(1);
    expect(degradedHealth(Date.now() + 31 * 60_000)).toEqual([]);
  });

  it('um registro corrompido não desliga o limite (falha FECHADA)', async () => {
    // `contagem: NaN` passava em `NaN >= limit` e desligava o controle em
    // silêncio para aquele par chave/IP. Lixo tem de valer 0, não infinito.
    const env = withDurableObjects({ FOTOS: fakeKV() });
    const obj = env.RATELIMIT.get(env.RATELIMIT.idFromName('login:1.2.3.4'));
    await obj.check(2, 600);
    const st = env.RATELIMIT._instances.get('login:1.2.3.4').ctx.storage;
    st._map.set('w', { janela: Math.floor(Date.now() / (600 * 1000)), contagem: NaN });
    const results = [];
    for (let i = 0; i < 4; i++) results.push(await checkRateLimit(env, '1.2.3.4', 'login', 2, 600));
    expect(results).toEqual([true, true, false, false]);
  });
});

// O custo do site não pode crescer junto com o público: a cota é fixa (1000
// escritas/dia) e o movimento não. Agregar é o que troca "uma escrita por
// visitante" por "uma escrita por janela".
describe('registro de degradações', () => {
  beforeEach(() => { resetDegraded(); vi.spyOn(console, 'error').mockImplementation(() => {}); });
  afterEach(() => { vi.restoreAllMocks(); resetDegraded(); });

  it('não deixa quebra de linha forjar uma entrada de log', () => {
    // O `detail` carrega mensagem de erro de sistema externo (KV, D1, Resend) e
    // identificador de evento — nada disso vem de nós. Uma quebra de linha ali
    // escreve uma entrada de log inteira, que é como se apaga o rastro de um
    // incidente por dentro do próprio relato dele.
    noteDegraded('rotulo\ninjetado\r\n2026-01-01 ENTRADA FALSA', 'a\u0000b\u2028c');
    const [d] = degradedHealth();
    expect(d.label).toBe('rotulo injetado 2026-01-01 ENTRADA FALSA');
    expect(d.detail).toBe('a b c');
    // eslint-disable-next-line no-control-regex
    expect(/[\u0000-\u001f\u007f-\u009f\u2028\u2029]/.test(d.label + d.detail)).toBe(false);
  });

  it('limita o tamanho, para um erro enorme não virar o painel inteiro', () => {
    noteDegraded('x'.repeat(500), 'y'.repeat(500));
    const [d] = degradedHealth();
    expect(d.label.length).toBeLessThanOrEqual(160);
    expect(d.detail.length).toBeLessThanOrEqual(160);
  });

  it('a mesma degradação repetida não vira várias linhas', () => {
    noteDegraded('mesma coisa', 'primeira');
    noteDegraded('mesma coisa', 'segunda');
    expect(degradedHealth()).toHaveLength(1);
    expect(degradedHealth()[0].detail).toBe('segunda');
  });
});

describe('contadores', () => {
  beforeEach(() => { resetDegraded(); vi.spyOn(console, 'error').mockImplementation(() => {}); });
  afterEach(() => { vi.restoreAllMocks(); resetDegraded(); });

  const fakeCtx = () => { const p = []; return { waitUntil: x => p.push(Promise.resolve(x).catch(() => {})), settle: () => Promise.all(p) }; };

  it('conta, e o valor sai pela leitura', async () => {
    const env = withDurableObjects({ FOTOS: fakeKV() });
    await bumpCounter(env, null, 'views:piauifut-2026');
    expect(await readCounter(env, 'views:piauifut-2026')).toBe(1);
  });

  it('uma rajada na MESMA chave não perde nada — é o ponto da migração', async () => {
    // O caso que o KV não atendia: uma escrita por segundo na mesma chave, com
    // leitura-modificação-escrita não atômica entre isolates.
    const env = withDurableObjects({ FOTOS: fakeKV() });
    const ctx = fakeCtx();
    for (let i = 0; i < 100; i++) bumpCounter(env, ctx, 'views:piauifut-2026');
    await ctx.settle();
    expect(await readCounter(env, 'views:piauifut-2026')).toBe(100);
  });

  it('mantém slugs e métricas separados dentro do mesmo objeto', async () => {
    // Um objeto só guarda TODAS as contagens; misturar chaves seria o defeito
    // mais fácil de introduzir nessa forma.
    const env = withDurableObjects({ FOTOS: fakeKV() });
    const ctx = fakeCtx();
    bumpCounter(env, ctx, 'views:a');
    bumpCounter(env, ctx, 'views:b');
    bumpCounter(env, ctx, 'views:a');
    bumpCounter(env, ctx, 'drive_clicks:a');
    await ctx.settle();
    expect(await readCounter(env, 'views:a')).toBe(2);
    expect(await readCounter(env, 'views:b')).toBe(1);
    expect(await readCounter(env, 'drive_clicks:a')).toBe(1);
  });

  it('nunca lança para quem chamou — é caminho de resposta do visitante', () => {
    expect(() => bumpCounter(null, null, 'views:x')).not.toThrow();
    expect(() => bumpCounter({ COUNTER: null }, null, 'views:x')).not.toThrow();
  });

  it('com o Durable Object fora, registra a degradação em vez de falhar calado', async () => {
    const env = { FOTOS: fakeKV(), COUNTER: brokenDONamespace() };
    await bumpCounter(env, null, 'views:x');
    expect(degradedHealth().length, 'o healthz precisa saber').toBeGreaterThan(0);
    expect(degradedHealth()[0].label).toMatch(/contador não gravado/);
  });

  it('leitura devolve 0 em vez de derrubar o painel', async () => {
    const env = { FOTOS: fakeKV(), COUNTER: brokenDONamespace() };
    expect(await readCounter(env, 'views:x')).toBe(0);
    expect(degradedHealth().length).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------
// Leitura em lote — o que consertou o "Erro ao carregar métricas"
// ---------------------------------------------------------------------------
// Cada chamada a um Durable Object é uma subrequisição, e o plano gratuito
// permite 50 por invocação. Ler dois contadores por projeto estourava o teto a
// partir de ~24 projetos e derrubava a aba inteira do painel. Estes testes
// prendem as duas propriedades que consertam isso: UMA chamada para tudo, e o
// assentamento do histórico feito pelo Worker (não dentro do objeto, onde
// gastaria a cota dele).
describe('readCounters — leitura em lote', () => {
  beforeEach(() => { resetDegraded(); vi.spyOn(console, 'error').mockImplementation(() => {}); });
  afterEach(() => { vi.restoreAllMocks(); resetDegraded(); });

  it('devolve todas as chaves pedidas numa chamada só', async () => {
    const env = withDurableObjects({ FOTOS: fakeKV() });
    await bumpCounter(env, null, 'views:a');
    await bumpCounter(env, null, 'views:a');
    await bumpCounter(env, null, 'drive_clicks:a');

    const out = await readCounters(env, ['views:a', 'drive_clicks:a', 'views:b']);
    expect(out['views:a']).toBe(2);
    expect(out['drive_clicks:a']).toBe(1);
    expect(out['views:b'], 'chave nunca tocada vale 0').toBe(0);
  });

  it('NÃO cresce em chamadas ao objeto conforme o número de projetos', async () => {
    // A afirmação que impede a regressão: 50 projetos = 100 chaves, e ainda
    // assim um número FIXO de chamadas. Era isto que estourava o teto de
    // subrequisição.
    const env = withDurableObjects({ FOTOS: fakeKV() });
    const chaves = [];
    for (let i = 0; i < 50; i++) chaves.push(`views:p${i}`, `drive_clicks:p${i}`);

    env.COUNTER._resetCalls();
    await readCounters(env, chaves);

    expect(chaves).toHaveLength(100);
    expect(env.COUNTER._calls().length, 'uma leitura em lote, mais um assentamento')
      .toBeLessThanOrEqual(2);
  });

  it('assenta do KV o histórico anterior à migração, uma vez só', async () => {
    const env = withDurableObjects({ FOTOS: fakeKV({ 'views:x': '742' }) });

    expect((await readCounters(env, ['views:x']))['views:x']).toBe(742);

    // Mexer no KV velho depois não pode mover a contagem: o assentamento já
    // aconteceu e o valor passou a viver no objeto.
    await env.FOTOS.put('views:x', '999');
    expect((await readCounters(env, ['views:x']))['views:x']).toBe(742);

    await bumpCounter(env, null, 'views:x');
    expect(await readCounter(env, 'views:x')).toBe(743);
  });

  it('valor herdado corrompido vira 0, não NaN', async () => {
    const env = withDurableObjects({ FOTOS: fakeKV({ 'views:x': 'NaN' }) });
    expect((await readCounters(env, ['views:x']))['views:x']).toBe(0);
    await bumpCounter(env, null, 'views:x');
    expect(await readCounter(env, 'views:x')).toBe(1);
  });

  it('lista vazia não chama o objeto', async () => {
    const env = { FOTOS: fakeKV(), COUNTER: brokenDONamespace() };
    expect(await readCounters(env, [])).toEqual({});
    expect(degradedHealth(), 'nem degradação, porque nada foi chamado').toEqual([]);
  });

  it('com o objeto fora, devolve vazio e registra — o painel não pode virar 500', async () => {
    const env = { FOTOS: fakeKV(), COUNTER: brokenDONamespace() };
    expect(await readCounters(env, ['views:x'])).toEqual({});
    expect(degradedHealth().length).toBeGreaterThan(0);
  });

  it('apagar remove as chaves do lote', async () => {
    const env = withDurableObjects({ FOTOS: fakeKV() });
    await bumpCounter(env, null, 'views:x', 5);
    await bumpCounter(env, null, 'drive_clicks:x', 3);
    await deleteCounters(env, ['views:x', 'drive_clicks:x']);
    const out = await readCounters(env, ['views:x', 'drive_clicks:x']);
    expect(out['views:x']).toBe(0);
    expect(out['drive_clicks:x']).toBe(0);
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
    expect(utils.degradedHealth().some(d => /cópia/.test(d.label))).toBe(true);
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
  it('PROPAGA em vez de devolver os padrões — devolver seria perda de dados', async () => {
    // Todos os chamadores são rotas de admin, e duas delas GRAVAM a lista de
    // volta (criar categoria, restaurar backup). Devolver os padrões ali
    // apagaria para sempre as categorias do dono. A galeria pública não passa
    // por aqui: ela deriva os filtros dos próprios eventos.
    await expect(getCategories(kvDown())).rejects.toThrow(/KV GET failed/);
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

  // Os tetos da ESCRITA aplicados de novo na LEITURA. `handleCreateCategory`
  // valida o que grava, mas o valor pode ter chegado por restore de backup ou
  // por edição manual no painel da Cloudflare — os dois caminhos que não passam
  // por handler nenhum. Sem isto, a lista inteira vai para cada `<option>` do
  // painel, três vezes por página.
  it('aplica o teto de quantidade que a escrita já aplicava', async () => {
    const muitas = Array.from({ length: 500 }, (_, i) => `Categoria ${i}`);
    const env = { FOTOS: fakeKV({ categories: JSON.stringify(muitas) }) };
    const lidas = await getCategories(env);
    expect(lidas).toHaveLength(MAX_CATEGORIES);
    expect(lidas[0]).toBe('Categoria 0');
  });

  it('aplica o teto de tamanho de cada nome', async () => {
    const env = { FOTOS: fakeKV({ categories: JSON.stringify(['x'.repeat(5000)]) }) };
    const [nome] = await getCategories(env);
    expect(nome).toHaveLength(MAX_CATEGORY_LEN);
  });

  // Recorta, não recusa: categoria demais ainda é dado do dono, e cair para os
  // defaults apagaria as boas junto com as ruins.
  it('preserva as categorias válidas em vez de cair para os defaults', async () => {
    const env = { FOTOS: fakeKV({ categories: JSON.stringify(['Casamento', '', '   ', null, 'Ensaio']) }) };
    expect(await getCategories(env)).toEqual(['Casamento', 'Ensaio']);
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


});

// O logout apaga o registro da sessão no KV. Esse delete NÃO é limpeza: ele é a
// revogação. O cookie sai do browser de qualquer jeito, então quem clicou em
// "sair" vê a tela de login e acredita ter saído — mas se o KV recusou o
// delete, o token continua válido no servidor até o TTL de 24 h, e qualquer
// cópia dele feita antes continua abrindo o painel.
//
// Delete conta como escrita na cota do KV (1000/dia, conta inteira). Ou seja: o
// dia de tráfego grande, que é quando a cota estoura, é exatamente o dia em que
// sair do painel para de revogar. E o comentário do `Clear-Site-Data` no
// handler diz qual é o cenário que ele tem em mente — computador emprestado.
describe('logout quando o KV recusa o delete', () => {
  beforeEach(() => { resetDegraded(); vi.spyOn(console, 'error').mockImplementation(() => {}); });
  afterEach(() => { vi.restoreAllMocks(); resetDegraded(); });

  const TOKEN = 'a'.repeat(64);

  // `coldIsolate()` acima chama `vi.resetModules()`, então um `import` dinâmico
  // depois dele devolve um registro NOVO: o `index.js` recém-carregado enxerga
  // um `utils.js` recém-carregado, com outro mapa de degradações — e não o que
  // o import do topo deste arquivo leu. Os dois módulos têm que vir do mesmo
  // registro, senão o teste confere um mapa que ninguém escreveu e falha só
  // quando roda junto com o resto da suíte.
  async function carregar() {
    const index = await import('../src/index.js');
    const utils = await import('../src/utils.js');
    utils.resetDegraded();
    return { handleLogout: index.handleLogout, degradedHealth: utils.degradedHealth };
  }

  function logoutRequest() {
    return new Request('https://fotos.lucafchala.com/dashboard/logout', {
      method: 'POST',
      headers: { Cookie: `__Host-session=${TOKEN}` },
    });
  }

  it('registra a degradação: uma sessão que não foi revogada não pode passar em silêncio', async () => {
    const { handleLogout, degradedHealth: lidos } = await carregar();
    const kv = fakeKV({ [`admin_session:${TOKEN}`]: 'valid' });
    kv.delete = async () => { throw new Error('KV DELETE failed: 429 Too Many Requests'); };

    await handleLogout(logoutRequest(), { FOTOS: kv });

    const problemas = lidos();
    expect(problemas).toHaveLength(1);
    expect(problemas[0].label).toMatch(/logout/i);
  });

  it('mesmo assim limpa os cookies e redireciona: falhar aqui não pode prender o admin logado no browser', async () => {
    const kv = fakeKV({ [`admin_session:${TOKEN}`]: 'valid' });
    kv.delete = async () => { throw new Error('KV DELETE failed: 429 Too Many Requests'); };
    const { handleLogout } = await carregar();

    const res = await handleLogout(logoutRequest(), { FOTOS: kv });

    expect(res.status).toBe(302);
    expect(res.headers.get('Location')).toBe('/dashboard');
    const cookies = res.headers.getSetCookie().join(' | ');
    expect(cookies).toMatch(/__Host-session=;/);
    expect(cookies).toMatch(/(^|\| )session=;/);
  });

  it('no caminho normal não inventa degradação nenhuma', async () => {
    const { handleLogout, degradedHealth: lidos } = await carregar();
    const kv = fakeKV({ [`admin_session:${TOKEN}`]: 'valid' });

    await handleLogout(logoutRequest(), { FOTOS: kv });

    expect(kv._store.has(`admin_session:${TOKEN}`)).toBe(false);
    expect(lidos()).toEqual([]);
  });
});

// Diferente do pedido de remoção — que fica gravado no D1 —, a mensagem de
// /suporte só existe dentro do e-mail. Um envio que falha é uma mensagem
// perdida, sem cópia em lugar nenhum, e a tela de sucesso mandava o visitante
// embora achando que tinha chegado.
// Host exato, não pedaço de string: ver o comentário em mockFetch.
function hostDe(u) {
  try { return new URL(u).hostname; } catch { return ''; }
}

describe('formulário de suporte quando o envio falha', () => {
  const env = () => withDurableObjects({
    FOTOS: fakeKV(),
    TURNSTILE_SECRET_KEY: 'ts',
    RESEND_API_KEY: 'rs',
    ADMIN_EMAIL: 'dono@exemplo.com',
  });

  function pedido() {
    return new Request('https://fotos.lucafchala.com/api/suporte', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: 'Fulana',
        email: 'fulana@exemplo.com',
        message: 'quero as fotos do jogo de sábado',
        consent: '1',
        'cf-turnstile-response': 'token-ok',
      }),
    });
  }

  // Turnstile aprova; o Resend é quem cai.
  function mockFetch({ resendOk }) {
    vi.stubGlobal('fetch', vi.fn(async (url) => {
      const u = String(url);
      // Compara `hostname` em vez de `includes()`. Num mock isso parece
      // preciosismo, mas é a mesma regra que o SECURITY.md já exige do
      // resolveDocHref: `includes('api.resend.com')` casa também com
      // `api.resend.com.exemplo.com` e com `exemplo.com/?x=api.resend.com`. Um
      // mock que erra o destino faz o teste afirmar coisa sobre a requisição
      // errada — e o CodeQL marca o padrão onde quer que ele apareça, com razão:
      // a diferença entre teste e produção é quem copia o trecho depois.
      switch (hostDe(u)) {
        case 'challenges.cloudflare.com':
          return new Response(JSON.stringify({ success: true }), { status: 200 });
        case 'api.resend.com':
          if (!resendOk) throw new Error('Resend indisponível');
          return new Response(JSON.stringify({ id: 'msg_1' }), { status: 200 });
        default:
          throw new Error(`fetch inesperado: ${u}`);
      }
    }));
  }

  beforeEach(() => { resetDegraded(); vi.spyOn(console, 'error').mockImplementation(() => {}); });
  afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); resetDegraded(); });

  it('não mostra tela de sucesso para uma mensagem que não saiu', async () => {
    mockFetch({ resendOk: false });
    const { handleSupportRequest } = await import('../src/index.js');

    const res = await handleSupportRequest(pedido(), env(), 'nonce');
    const corpo = await res.text();

    expect(res.status).toBe(503);
    // E devolve o texto preenchido: reenviar não pode custar redigitar.
    expect(corpo).toContain('quero as fotos do jogo de sábado');
  });

  it('registra a degradação: o canal de contato estar mudo precisa aparecer no painel', async () => {
    mockFetch({ resendOk: false });
    const { handleSupportRequest } = await import('../src/index.js');
    const { degradedHealth: lidos, resetDegraded: limpa } = await import('../src/utils.js');
    limpa();

    await handleSupportRequest(pedido(), env(), 'nonce');

    const problemas = lidos();
    expect(problemas).toHaveLength(1);
    expect(problemas[0].label).toMatch(/suporte/i);
  });

  it('envio que deu certo continua sendo sucesso, sem degradação', async () => {
    mockFetch({ resendOk: true });
    const { handleSupportRequest } = await import('../src/index.js');
    const { degradedHealth: lidos, resetDegraded: limpa } = await import('../src/utils.js');
    limpa();

    const res = await handleSupportRequest(pedido(), env(), 'nonce');

    expect(res.status).toBe(200);
    expect(lidos()).toEqual([]);
  });
});

// Trocar a senha é o que se faz quando se desconfia que ela vazou. A varredura
// das outras sessões é o que expulsa quem já estava dentro — sem ela, a senha
// nova passa a valer e o intruso continua no painel por até 24 h, com o admin
// vendo "ok" e acreditando ter fechado a porta.
describe('troca de senha quando a varredura de sessões falha', () => {
  const TOKEN = 'b'.repeat(64);

  beforeEach(() => { resetDegraded(); vi.spyOn(console, 'error').mockImplementation(() => {}); });
  afterEach(() => { vi.restoreAllMocks(); resetDegraded(); });

  function kvComDeleteQuebrado() {
    const kv = fakeKV({
      [`admin_session:${TOKEN}`]: 'valid',
      'admin_session:cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc': 'valid',
    });
    kv.delete = async () => { throw new Error('KV DELETE failed: 429 Too Many Requests'); };
    return kv;
  }

  function pedido() {
    return new Request('https://fotos.lucafchala.com/api/settings/password', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', Cookie: `__Host-session=${TOKEN}` },
      body: JSON.stringify({ password: 'uma frase longa de teste 2026' }),
    });
  }

  it('registra a degradação em vez de só logar', async () => {
    const { handleChangePassword } = await import('../src/index.js');
    const { degradedHealth: lidos, resetDegraded: limpa } = await import('../src/utils.js');
    limpa();

    const res = await handleChangePassword(pedido(), { FOTOS: kvComDeleteQuebrado() });

    // A senha nova vale: a troca em si deu certo e não é desfeita.
    expect(res.status).toBe(200);
    const problemas = lidos();
    expect(problemas).toHaveLength(1);
    expect(problemas[0].label).toMatch(/sess/i);
  });
});
