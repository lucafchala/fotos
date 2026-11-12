// Degradações que sobrevivem à troca de isolate (v3.11.0). Antes, noteDegraded
// guardava só na memória do isolate: o /api/healthz (e o painel de status, que
// o lê a cada 10 min) quase nunca caía no isolate que tinha visto o defeito, e
// um problema de minutos passava invisível. Agora o que degradou vai, no fim
// do pedido, para a instância `degradacoes` do COUNTER, e o healthz junta as
// duas listas. O que estes testes prendem:
//  1. a cópia acontece no fim do pedido e o healthz de "outro isolate" a vê;
//  2. custo: sem nada novo, nenhuma chamada; o mesmo rótulo, no máximo uma
//     gravação a cada 5 min por isolate;
//  3. falha do objeto: nada lança, e a cópia é tentada de novo;
//  4. a janela (30 min) e o teto de rótulos guardados;
//  5. o mais recente de cada rótulo vence.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import worker from '../src/index.js';
import { noteDegraded, resetDegraded, guardaDegradacoes, degradacoesDeTodos, degradedHealth, saveEvents } from '../src/utils.js';
import { withDurableObjects, brokenDONamespace } from './helpers/do.js';
import { ctxColetor } from './helpers/ctx.js';

function fakeKV() {
  const store = new Map([['events', '[]']]);
  return {
    async get(/** @type {string} */ k) { return store.has(k) ? store.get(k) : null; },
    async put(/** @type {string} */ k, /** @type {string} */ v) { store.set(k, v); },
    async delete(/** @type {string} */ k) { store.delete(k); },
    async list() { return { keys: [], list_complete: true, cursor: null }; },
  };
}

/** @type {any} */
let env;
beforeEach(() => {
  resetDegraded();
  vi.spyOn(console, 'error').mockImplementation(() => {});
  env = withDurableObjects({ FOTOS: fakeKV() });
});
afterEach(() => { vi.restoreAllMocks(); resetDegraded(); });

/** Chamadas feitas à instância `degradacoes` do COUNTER. */
const chamadasAoObjeto = () => env.COUNTER._calls().filter((/** @type {string} */ m) => /egrada/.test(m));

describe('a cópia no Durable Object', () => {
  it('o que um isolate viu, o healthz de outro isolate vê', async () => {
    noteDegraded('KV: escrita recusada', 'cota do dia');
    await guardaDegradacoes(env);
    // "Outro isolate": a memória deste some, o objeto fica.
    resetDegraded();
    expect(degradedHealth()).toEqual([]);
    const todas = await degradacoesDeTodos(env);
    expect(todas).toEqual([{ label: 'KV: escrita recusada', detail: 'cota do dia', agoSecs: expect.any(Number) }]);
    expect(todas[0].agoSecs).toBeLessThan(5);
  });

  it('no fim de um pedido de verdade (waitUntil), e o /api/healthz mostra em selftest.problems', async () => {
    const ctx = ctxColetor();
    // Uma rota qualquer; a degradação foi registrada durante o pedido.
    noteDegraded('Turnstile não respondeu', 'formulários recusam');
    await worker.fetch(new Request('https://fotos.lucafchala.com/sobre'), env, ctx);
    await ctx.drena();
    resetDegraded();
    const res = await worker.fetch(new Request('https://fotos.lucafchala.com/api/healthz'), env, ctxColetor());
    const j = await res.json();
    expect(j.selftest.problems.some((/** @type {string} */ p) => p.startsWith('Turnstile não respondeu (há '))).toBe(true);
    expect(j.selftest.ok).toBe(false);
  });

  it('o cron também copia — mesmo o que degrada DENTRO de uma tarefa em waitUntil', async () => {
    // O caso real: a faxina do R2 roda em waitUntil e falha depois que o
    // `scheduled` já retornou. Antes da v3.11.0 final, a cópia corria no
    // `finally`, com a fila ainda vazia, e o objeto ficava sem nada.
    // saveEvents, não put: a lista fica também no cache do isolate.
    await saveEvents(env, /** @type {any} */ ([{ id: '1', slug: 'formatura', title: 'F', fotosOcultas: ['FOTO_AAAAAAAAAA'] }]));
    const quebra = () => { throw new Error('R2 fora'); };
    env.FOTOS_R2 = { list: quebra, delete: quebra, head: quebra, get: quebra, put: quebra };
    const ctx = ctxColetor();
    await worker.scheduled(/** @type {any} */ ({ cron: '0 3 * * *', scheduledTime: Date.UTC(2026, 10, 12, 3, 0) }), env, ctx);
    await ctx.drena();
    resetDegraded();
    expect((await degradacoesDeTodos(env)).map(d => d.label)).toContain('faxina das fotos ocultas no R2 falhou');
  });

  it('o que degrada depois da resposta de um pedido também chega ao objeto', async () => {
    const ctx = ctxColetor();
    const { coletaTarefas } = await import('../src/index.js');
    const { ctx: c, depoisDeTudo } = coletaTarefas(/** @type {any} */ (ctx));
    // Uma tarefa que, ao rodar, põe outra — e só a segunda degrada.
    c.waitUntil(Promise.resolve().then(() => { c.waitUntil(new Promise(r => setTimeout(r, 5)).then(() => noteDegraded('tarde', ''))); }));
    depoisDeTudo(() => guardaDegradacoes(env));
    await ctx.drena();
    resetDegraded();
    expect((await degradacoesDeTodos(env)).map(d => d.label)).toEqual(['tarde']);
  });
});

describe('custo', () => {
  it('sem nada novo, nenhuma chamada ao objeto', async () => {
    await guardaDegradacoes(env);
    const ctx = ctxColetor();
    await worker.fetch(new Request('https://fotos.lucafchala.com/sobre'), env, ctx);
    await ctx.drena();
    expect(chamadasAoObjeto()).toEqual([]);
  });

  it('o mesmo rótulo, no máximo uma gravação a cada 5 min por isolate', async () => {
    noteDegraded('KV: leitura recusada', 'a');
    await guardaDegradacoes(env);
    noteDegraded('KV: leitura recusada', 'b');
    await guardaDegradacoes(env);
    expect(chamadasAoObjeto()).toEqual(['registraDegradacoes']);
    const agora = Date.now();
    vi.spyOn(Date, 'now').mockReturnValue(agora + 5 * 60_000 + 1);
    noteDegraded('KV: leitura recusada', 'c');
    await guardaDegradacoes(env);
    expect(chamadasAoObjeto()).toEqual(['registraDegradacoes', 'registraDegradacoes']);
    // Vários rótulos novos vão numa chamada só.
    noteDegraded('um', ''); noteDegraded('dois', ''); noteDegraded('três', '');
    await guardaDegradacoes(env);
    expect(chamadasAoObjeto()).toHaveLength(3);
  });

  it('sem o binding COUNTER, nada é chamado e nada lança', async () => {
    noteDegraded('x', '');
    await expect(guardaDegradacoes({})).resolves.toBeUndefined();
    expect((await degradacoesDeTodos({})).map(d => d.label)).toEqual(['x']);
  });
});

describe('falha do objeto', () => {
  it('a cópia que falhou é tentada de novo no pedido seguinte, sem lançar', async () => {
    const bom = env.COUNTER;
    env.COUNTER = brokenDONamespace();
    noteDegraded('D1 fora', '');
    await expect(guardaDegradacoes(env)).resolves.toBeUndefined();
    env.COUNTER = bom;
    // Passada a espera depois da falha (30 s), a cópia é tentada de novo.
    const agora = Date.now();
    vi.spyOn(Date, 'now').mockReturnValue(agora + 30_001);
    await guardaDegradacoes(env);
    resetDegraded();
    expect((await degradacoesDeTodos(env)).map(d => d.label)).toEqual(['D1 fora']);
  });

  it('com o objeto fora, espera 30 s antes de tentar de novo (no pico, sem uma chamada à toa por pedido)', async () => {
    const bom = env.COUNTER;
    let chamadas = 0;
    env.COUNTER = { idFromName: () => 'x', get: () => ({ registraDegradacoes: async () => { chamadas++; throw new Error('fora'); } }) };
    noteDegraded('D1 fora', '');
    await guardaDegradacoes(env);
    await guardaDegradacoes(env);
    await guardaDegradacoes(env);
    expect(chamadas).toBe(1);
    const agora = Date.now();
    vi.spyOn(Date, 'now').mockReturnValue(agora + 30_001);
    env.COUNTER = bom;
    await guardaDegradacoes(env);
    resetDegraded();
    expect((await degradacoesDeTodos(env)).map(d => d.label)).toEqual(['D1 fora']);
  });

  it('leitura do objeto falhando: o healthz mostra só as deste isolate', async () => {
    noteDegraded('local', '');
    env.COUNTER = brokenDONamespace();
    expect((await degradacoesDeTodos(env)).map(d => d.label)).toEqual(['local']);
  });
});

describe('janela e teto', () => {
  it('passada a janela de 30 min, some (e a gravação seguinte poda)', async () => {
    noteDegraded('velha', '');
    await guardaDegradacoes(env);
    resetDegraded();
    const agora = Date.now();
    vi.spyOn(Date, 'now').mockReturnValue(agora + 31 * 60_000);
    expect(await degradacoesDeTodos(env)).toEqual([]);
    noteDegraded('nova', '');
    await guardaDegradacoes(env);
    const guardadas = await env.COUNTER.get('degradacoes').degradacoes(60 * 60_000);
    expect(guardadas.map((/** @type {any} */ d) => d.label)).toEqual(['nova']);
  });

  it('guarda no máximo 40 rótulos, os mais recentes', async () => {
    const agora = Date.now();
    const relogio = vi.spyOn(Date, 'now');
    for (let i = 0; i < 45; i++) {
      relogio.mockReturnValue(agora + i * 1000);
      noteDegraded(`r${i}`, '');
      await guardaDegradacoes(env);
    }
    const guardadas = await env.COUNTER.get('degradacoes').degradacoes(60 * 60_000);
    expect(guardadas).toHaveLength(40);
    expect(guardadas.map((/** @type {any} */ d) => d.label)).not.toContain('r0');
    expect(guardadas.map((/** @type {any} */ d) => d.label)).toContain('r44');
  });

  it('o objeto recusa lixo: sem rótulo, sem instante, rótulo e detalhe aparados', async () => {
    const o = env.COUNTER.get('degradacoes');
    await o.registraDegradacoes([{ label: '', at: Date.now(), detail: '' }, { label: 'x', at: NaN, detail: '' }, null, { label: 'L'.repeat(500), at: Date.now(), detail: 'D'.repeat(500) }], 60_000);
    const g = await o.degradacoes(60_000);
    expect(g).toHaveLength(1);
    expect(g[0].label).toHaveLength(160);
    expect(g[0].detail).toHaveLength(160);
  });
});

it('o mais recente de cada rótulo vence (o daqui ou o guardado)', async () => {
  noteDegraded('Drive', 'antiga');
  await guardaDegradacoes(env);
  const agora = Date.now();
  vi.spyOn(Date, 'now').mockReturnValue(agora + 60_000);
  noteDegraded('Drive', 'nova');
  const [d] = await degradacoesDeTodos(env);
  expect(d).toEqual({ label: 'Drive', detail: 'nova', agoSecs: 0 });
});
