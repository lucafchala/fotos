import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import worker from '../src/index.js';
import {
  saveEvents, bumpCounter, readCounter, readSerie, diaMenos, hojeEmSaoPaulo,
  degradedHealth, resetDegraded,
} from '../src/utils.js';
import { METRICAS_RETENCAO_DIAS, METRICAS_DIAS_MAX, GATE_METODOS } from '../src/config.js';
import { withDurableObjects, brokenDONamespace } from './helpers/do.js';

// Métricas v2 (#215): a série POR DIA ao lado de cada total do contador.
//
// O que estes testes prendem, em ordem de quanto custaria errar:
//   1. a série não custa chamada nenhuma a mais por visita — o balde do dia
//      vai na MESMA gravação do total (uma linha escrita a mais, nenhuma
//      subrequisição);
//   2. o painel lê a série inteira com UMA chamada ao objeto (chamada de DO é
//      subrequisição: 50 por invocação no plano gratuito);
//   3. o "dia" é o de São Paulo — 23h30 de sexta ainda é sexta;
//   4. a série não cresce para sempre (poda) e não deixa órfãos (remove).
//
// A atomicidade sob rajada no runtime de verdade está na suíte `workers`
// (tests/workers/counters.workers.test.js) — aqui o objeto roda sobre um
// dublê, e afirmar atomicidade contra ele seria testar o dublê.

const SITE = 'https://fotos.lucafchala.com';
const TOKEN = 'ab'.repeat(32); // hex: o leitor do cookie recusa outro formato
// Meio-dia em São Paulo (UTC−3, sem horário de verão desde 2019).
const HOJE = '2026-10-10';
const MEIO_DIA = new Date(`${HOJE}T15:00:00Z`);

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

const EVENTOS = [
  { id: '1', slug: 'formatura', title: 'Formatura', visible: true, driveUrl: 'https://drive.google.com/drive/folders/a' },
  { id: '2', slug: 'casamento', title: 'Casamento', visible: false, driveUrl: 'https://drive.google.com/drive/folders/b' },
];

/** O Map por trás do armazenamento do objeto único dos contadores. */
const armazenamento = env => {
  env.COUNTER.get('contadores');
  return env.COUNTER._instances.get('contadores').ctx.storage;
};
/** Leva o relógio para `dia` (meio-dia de São Paulo). */
const vaiPara = dia => vi.setSystemTime(new Date(`${dia}T15:00:00Z`));

let env;
beforeEach(async () => {
  resetDegraded();
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(MEIO_DIA);
  env = withDurableObjects({ FOTOS: fakeKV() });
  await saveEvents(env, structuredClone(EVENTOS));
});
afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); resetDegraded(); });

// ---------------------------------------------------------------------------
describe('diaMenos — aritmética de calendário, sem fuso', () => {
  it('volta e avança dias, atravessando mês, ano e 29 de fevereiro', () => {
    expect(diaMenos('2026-10-10', 1)).toBe('2026-10-09');
    expect(diaMenos('2026-10-10', 0)).toBe('2026-10-10');
    expect(diaMenos('2026-10-10', -1)).toBe('2026-10-11');
    expect(diaMenos('2026-03-01', 1)).toBe('2026-02-28');
    expect(diaMenos('2024-03-01', 1), 'ano bissexto').toBe('2024-02-29');
    expect(diaMenos('2026-01-01', 1)).toBe('2025-12-31');
    expect(diaMenos('2026-10-10', 400)).toBe('2025-09-05');
  });

  it('texto que não é dia vira vazio, não "Invalid Date" nem exceção', () => {
    for (const ruim of ['', 'ontem', '2026-13-40', '10/10/2026']) expect(diaMenos(ruim, 1)).toBe('');
  });
});

// ---------------------------------------------------------------------------
describe('Counter — balde por dia ao lado do total', () => {
  it('cada incremento soma no total e no balde do dia, numa gravação só', async () => {
    await bumpCounter(env, null, 'views:formatura'); // primeiro toque: assenta do KV
    const st = armazenamento(env);
    const put = vi.spyOn(st, 'put');

    await bumpCounter(env, null, 'views:formatura');

    // Uma chamada de `put` com as DUAS chaves: ou gravam juntas, ou nenhuma.
    // Duas chamadas seriam duas oportunidades de o total e a série divergirem.
    expect(put).toHaveBeenCalledTimes(1);
    expect(put.mock.calls[0][0]).toEqual({ 'views:formatura': 2, [`d:${HOJE}:views:formatura`]: 2 });
    expect(st._map.get(`d:${HOJE}:views:formatura`)).toBe(2);
  });

  it('não gasta chamada nenhuma a mais ao objeto por visita', async () => {
    // A série é de graça em subrequisição: o balde vai dentro da MESMA chamada
    // `increment`. Um `serie.increment` à parte dobraria o custo de cada
    // visita contada.
    env.COUNTER._resetCalls();
    await bumpCounter(env, null, 'views:formatura');
    expect(env.COUNTER._calls()).toEqual(['increment']);
  });

  it('o dia é o de São Paulo: 23h30 de sexta ainda é sexta, mesmo já sendo sábado em UTC', async () => {
    vi.setSystemTime(new Date('2026-10-10T02:30:00Z')); // 23h30 de 09/10 em São Paulo
    await bumpCounter(env, null, 'views:formatura');
    const st = armazenamento(env);
    expect(st._map.get('d:2026-10-09:views:formatura')).toBe(1);
    expect(st._map.has('d:2026-10-10:views:formatura')).toBe(false);
  });

  it('virada do dia: o balde novo começa do zero e o total segue somando', async () => {
    await bumpCounter(env, null, 'views:formatura');
    await bumpCounter(env, null, 'views:formatura');
    vaiPara('2026-10-11');
    await bumpCounter(env, null, 'views:formatura');

    const st = armazenamento(env);
    expect(st._map.get('d:2026-10-10:views:formatura')).toBe(2);
    expect(st._map.get('d:2026-10-11:views:formatura')).toBe(1);
    expect(await readCounter(env, 'views:formatura')).toBe(3);
  });

  it('a soma da série é o total desde que a série existe (o histórico do KV fica só no total)', async () => {
    // Contagem herdada do KV (pré-Durable Object) não tem dia: entra no total
    // e não inventa um balde. É por isso que o painel diz "contagem diária
    // desde…" em vez de fingir que a série cobre tudo.
    env.FOTOS._store.set('views:formatura', '742');
    await bumpCounter(env, null, 'views:formatura');
    expect(await readCounter(env, 'views:formatura')).toBe(743);
    expect(armazenamento(env)._map.get(`d:${HOJE}:views:formatura`)).toBe(1);
  });

  it('rajada de 100 no mesmo dia: o total e o balde sobem 100 cada', async () => {
    const pend = [];
    const ctx = { waitUntil: p => pend.push(p) };
    for (let i = 0; i < 100; i++) bumpCounter(env, ctx, 'views:formatura');
    await Promise.all(pend);
    expect(await readCounter(env, 'views:formatura')).toBe(100);
    expect(armazenamento(env)._map.get(`d:${HOJE}:views:formatura`)).toBe(100);
  });

  it('serie() devolve só desde o dia pedido, o dia mais antigo que existe e os totais pedidos', async () => {
    vaiPara('2026-10-01');
    await bumpCounter(env, null, 'views:formatura');
    vaiPara('2026-10-05');
    await bumpCounter(env, null, 'views:formatura', 2);
    vaiPara(HOJE);
    await bumpCounter(env, null, 'drive_clicks:formatura');
    await bumpCounter(env, null, 'gate:email');

    const r = await env.COUNTER.get('contadores').serie('2026-10-05', ['gate:email', 'gate:noscript']);
    expect(r.serie).toEqual({
      'd:2026-10-05:views:formatura': 2,
      [`d:${HOJE}:drive_clicks:formatura`]: 1,
      [`d:${HOJE}:gate:email`]: 1,
    });
    expect(r.primeiroDia, 'o mais antigo da série, mesmo fora do período pedido').toBe('2026-10-01');
    expect(r.totais).toEqual({ 'gate:email': 1, 'gate:noscript': 0 });
  });

  it('serie() de um objeto sem série: vazio, sem primeiro dia', async () => {
    const r = await env.COUNTER.get('contadores').serie('2000-01-01');
    expect(r).toEqual({ serie: {}, primeiroDia: '', totais: {} });
  });

  it('remove() apaga o total e a série dele — e não a do projeto de nome parecido', async () => {
    for (const dia of ['2026-10-08', '2026-10-09', HOJE]) {
      vaiPara(dia);
      await bumpCounter(env, null, 'views:a');
      await bumpCounter(env, null, 'drive_clicks:a');
      await bumpCounter(env, null, 'views:ab');
    }
    await env.COUNTER.get('contadores').remove(['views:a', 'drive_clicks:a']);

    const chaves = [...armazenamento(env)._map.keys()];
    expect(chaves.filter(k => /:(views|drive_clicks):a$/.test(k)), 'nenhum balde órfão').toEqual([]);
    expect(chaves.filter(k => k.endsWith(':views:ab')), '`views:ab` não é `views:a`').toHaveLength(3);
    expect(chaves).toContain('views:ab');
    // E o objeto em memória concorda com o disco: a série some do painel.
    const r = await env.COUNTER.get('contadores').serie('2000-01-01');
    expect(Object.keys(r.serie).every(k => k.endsWith(':views:ab'))).toBe(true);
  });

  it('remove() apaga em lotes de até 128 chaves (o limite da API)', async () => {
    const st = armazenamento(env);
    for (let i = 0; i < 300; i++) st._map.set(`d:${diaMenos(HOJE, i)}:views:a`, 1);
    env.COUNTER._evict('contadores'); // o construtor relê o armazenamento
    const del = vi.spyOn(st, 'delete');

    await env.COUNTER.get('contadores').remove(['views:a']);

    expect([...st._map.keys()].filter(k => k.endsWith(':views:a'))).toEqual([]);
    expect(del.mock.calls.every(([lote]) => Array.isArray(lote) && lote.length <= 128)).toBe(true);
    expect(del.mock.calls.length).toBe(3);
  });
});

// ---------------------------------------------------------------------------
describe('Counter — poda da série', () => {
  it(`apaga os baldes com mais de ${METRICAS_RETENCAO_DIAS} dias no primeiro incremento do dia`, async () => {
    const st = armazenamento(env);
    const velho = diaMenos(HOJE, METRICAS_RETENCAO_DIAS + 1);
    const limite = diaMenos(HOJE, METRICAS_RETENCAO_DIAS);
    st._map.set(`d:${velho}:views:formatura`, 5);
    st._map.set(`d:${limite}:views:formatura`, 6);
    st._map.set(`d:${diaMenos(HOJE, 10)}:views:formatura`, 7);
    env.COUNTER._evict('contadores');

    await bumpCounter(env, null, 'views:formatura');

    expect(st._map.has(`d:${velho}:views:formatura`), 'passou da retenção').toBe(false);
    expect(st._map.get(`d:${limite}:views:formatura`), 'no limite, fica').toBe(6);
    expect(st._map.get(`d:${diaMenos(HOJE, 10)}:views:formatura`)).toBe(7);
    // A memória concorda com o disco: o painel não mostra o que foi podado.
    const r = await env.COUNTER.get('contadores').serie('2000-01-01');
    expect(Object.keys(r.serie)).not.toContain(`d:${velho}:views:formatura`);
  });

  it('roda uma vez por dia, não a cada visita — e volta a rodar quando o dia vira', async () => {
    const stub = env.COUNTER.get('contadores');
    await bumpCounter(env, null, 'views:formatura'); // a poda de hoje já rodou

    // Um balde JÁ velho que aparece depois da poda de hoje (o `seed` o põe na
    // memória e no disco sem reiniciar o objeto) só sai na poda de amanhã: a
    // varredura de todas as chaves não roda a cada visita contada.
    const velho = `d:${diaMenos(HOJE, METRICAS_RETENCAO_DIAS + 1)}:views:formatura`;
    await stub.seed({ [velho]: 3 });
    await bumpCounter(env, null, 'views:formatura');
    expect(armazenamento(env)._map.get(velho), 'mesmo dia: sem nova varredura').toBe(3);

    vaiPara(diaMenos(HOJE, -1));
    await bumpCounter(env, null, 'views:formatura');
    expect(armazenamento(env)._map.has(velho), 'dia novo: podado').toBe(false);
  });

  it('não encosta nos totais nem no que não é balde de dia', async () => {
    const st = armazenamento(env);
    st._map.set('views:antigo', 99);
    st._map.set('gate:email', 4);
    env.COUNTER._evict('contadores');
    await bumpCounter(env, null, 'views:formatura');
    expect(st._map.get('views:antigo')).toBe(99);
    expect(st._map.get('gate:email')).toBe(4);
  });
});

// ---------------------------------------------------------------------------
describe('readSerie — nunca derruba o painel', () => {
  it('com o objeto fora, devolve vazio e registra a degradação', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const r = await readSerie({ ...env, COUNTER: brokenDONamespace() }, '2026-01-01');
    expect(r).toEqual({ serie: {}, primeiroDia: '', totais: {} });
    expect(degradedHealth().map(d => d.label)).toContain('série diária não lida');
  });
});

// ---------------------------------------------------------------------------
describe('GET /api/metrics/diario', () => {
  const ctx = { waitUntil() {} };
  // A sessão nasce no "agora" do relógio falso — depois das viagens no tempo
  // de cada teste, senão o teto de 24 h da sessão a recusaria.
  async function pede(qs = '', { logado = true } = {}) {
    if (logado) await env.FOTOS.put(`admin_session:${TOKEN}`, JSON.stringify({ createdAt: Date.now() }));
    return worker.fetch(new Request(`${SITE}/api/metrics/diario${qs}`, {
      headers: logado ? { Cookie: `__Host-session=${TOKEN}` } : {},
    }), env, ctx);
  }

  it('sem sessão: 401, sem ler o contador', async () => {
    const res = await pede('', { logado: false });
    expect(res.status).toBe(401);
    expect(env.COUNTER._instances.size).toBe(0);
  });

  it('por padrão, os 90 dias até hoje (de São Paulo), em ordem e sem buraco', async () => {
    const res = await pede();
    expect(res.status).toBe(200);
    const d = await res.json();
    expect(d.hoje).toBe(HOJE);
    expect(d.dias).toHaveLength(90);
    expect(d.dias.at(-1)).toBe(HOJE);
    expect(d.dias[0]).toBe(diaMenos(HOJE, 89));
    for (let i = 1; i < d.dias.length; i++) expect(diaMenos(d.dias[i], 1)).toBe(d.dias[i - 1]);
  });

  it('`dias` é limitado a 1..180, e lixo vira o padrão', async () => {
    const tamanho = async qs => (await (await pede(qs)).json()).dias.length;
    expect(await tamanho('?dias=7')).toBe(7);
    expect(await tamanho('?dias=0')).toBe(1);
    expect(await tamanho('?dias=-5')).toBe(1);
    expect(await tamanho('?dias=99999')).toBe(METRICAS_DIAS_MAX);
    expect(await tamanho('?dias=abc')).toBe(90);
  });

  it('vetores densos alinhados aos dias; projeto excluído e dia fora do período não entram', async () => {
    vaiPara(diaMenos(HOJE, 100));
    await bumpCounter(env, null, 'views:formatura', 50); // fora dos 90 dias
    vaiPara(diaMenos(HOJE, 1));
    await bumpCounter(env, null, 'views:formatura', 2);
    vaiPara(HOJE);
    await bumpCounter(env, null, 'views:formatura', 3);
    await bumpCounter(env, null, 'drive_clicks:formatura');
    await bumpCounter(env, null, 'views:projeto-apagado', 9);
    await bumpCounter(env, null, 'gate:turnstile', 4);
    await bumpCounter(env, null, 'gate:email');

    const d = await (await pede('?dias=30')).json();

    expect(Object.keys(d.projetos), 'só projetos que existem; sem acesso no período, ausente').toEqual(['formatura']);
    const f = d.projetos.formatura;
    expect(f.views).toHaveLength(30);
    expect(f.views.at(-1)).toBe(3);
    expect(f.views.at(-2)).toBe(2);
    expect(f.views.reduce((a, b) => a + b, 0), 'os 50 de 100 dias atrás ficam fora').toBe(5);
    expect(f.driveClicks.at(-1)).toBe(1);
    expect(Object.keys(d.gate)).toEqual([...GATE_METODOS]);
    expect(d.gate.turnstile.at(-1)).toBe(4);
    expect(d.gate.email.at(-1)).toBe(1);
    expect(d.gate.noscript.every(n => n === 0)).toBe(true);
    expect(d.gateTotal).toEqual({ noscript: 0, turnstile: 4, email: 1 });
    expect(d.primeiroDia, 'o painel diz desde quando há série').toBe(diaMenos(HOJE, 100));
  });

  it('projeto oculto também aparece — o painel é do dono', async () => {
    await bumpCounter(env, null, 'views:casamento');
    const d = await (await pede('?dias=7')).json();
    expect(d.projetos.casamento.views.at(-1)).toBe(1);
  });

  it('UMA chamada ao objeto, não importa quantos dias nem quantos projetos', async () => {
    const muitos = Array.from({ length: 60 }, (_, i) => ({ id: String(i), slug: `p${i}`, title: `P${i}`, visible: true }));
    await saveEvents(env, muitos);
    for (const p of muitos) await bumpCounter(env, null, `views:${p.slug}`);
    env.COUNTER._resetCalls();

    const res = await pede(`?dias=${METRICAS_DIAS_MAX}`);

    expect(res.status).toBe(200);
    expect(env.COUNTER._calls(), 'chamada de DO é subrequisição: 50 por invocação').toEqual(['serie']);
  });

  it('com o objeto fora: 200 com zeros, não 500', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    env.COUNTER = brokenDONamespace();
    const res = await pede('?dias=7');
    expect(res.status).toBe(200);
    const d = await res.json();
    expect(d.projetos).toEqual({});
    expect(d.gateTotal).toEqual({ noscript: 0, turnstile: 0, email: 0 });
    expect(d.primeiroDia).toBe('');
  });

  it('hoje é o dia de São Paulo também aqui', async () => {
    vi.setSystemTime(new Date('2026-10-11T02:59:00Z')); // 23h59 de 10/10 em São Paulo
    expect(hojeEmSaoPaulo()).toBe(HOJE);
    const d = await (await pede('?dias=1')).json();
    expect(d.dias).toEqual([HOJE]);
  });
});
