import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import worker, { handleRemovalRequest, pruneResolvedRemovalRequests } from '../src/index.js';
import {
  listaPedidos, lePedido, migraLegado, podaResolvidos, regravaPedido, chavePedido, CHAVE_LEGADA,
  LOTE_DE_LEITURA, JANELA_MESMA_CHAVE_MS,
} from '../src/pedidos.js';
import { resetDegraded, degradedHealth } from '../src/utils.js';
import { withDurableObjects } from './helpers/do.js';
import { pedidosGravados, relogioAdiantavel } from './helpers/pedidos.js';

// #198 — pedidos de remoção, um por chave.
//
// O defeito: a lista era UM array no KV, regravado inteiro por cinco
// caminhos. O primeiro teste abaixo reproduz o pior deles — dois pedidos ao
// mesmo tempo, e a segunda gravação de um (a que carimba o status dos e-mails)
// regravando o retrato de antes e apagando o outro do painel. Com uma chave
// por pedido, nada regrava o que não é seu.

const SITE = 'https://fotos.lucafchala.com';
const TOKEN = 'd'.repeat(64);

/** KV de mentira com os três limites do KV de verdade que este arquivo
 *  exercita:
 *   - `list` por prefixo e PAGINADO (2 por página) — a paginação é o que um
 *     painel com mais de 1000 pedidos exercita de verdade;
 *   - `get(chaves[])` em lote, até 100 chaves, devolvendo um `Map`;
 *   - UMA escrita por segundo na mesma chave: a segunda, dentro da janela,
 *     lança o erro do KV (`KV PUT failed: 429 Too Many Requests`). */
function fakeKV(initial = {}) {
  const store = new Map(Object.entries(initial));
  /** @type {Map<string, number>} */
  const ultimaEscrita = new Map();
  return {
    async get(k) {
      if (Array.isArray(k)) {
        if (k.length > 100) throw new Error('KV GET_BULK failed: more than 100 keys');
        return new Map(k.map(n => [n, store.has(n) ? store.get(n) : null]));
      }
      return store.has(k) ? store.get(k) : null;
    },
    async put(k, v) {
      const antes = ultimaEscrita.get(k);
      if (antes !== undefined && Date.now() - antes < 1000) throw new Error('KV PUT failed: 429 Too Many Requests');
      ultimaEscrita.set(k, Date.now());
      store.set(k, v);
    },
    async delete(k) { store.delete(k); },
    async list({ prefix = '', cursor } = {}) {
      const todas = [...store.keys()].filter(k => k.startsWith(prefix)).sort();
      const ini = cursor ? Number(cursor) : 0;
      const pagina = todas.slice(ini, ini + 2);
      const fim = ini + 2 >= todas.length;
      return { keys: pagina.map(name => ({ name })), list_complete: fim, cursor: fim ? undefined : String(ini + 2) };
    },
    _store: store,
  };
}

const pedido = (id, extra = {}) => ({
  id, eventSlug: 'formatura', eventTitle: 'Formatura', method: 'number', value: 'Foto 1',
  email: `${id}@exemplo.com`, phone: '11999990000', message: '', resolved: false,
  createdAt: '2026-10-01T12:00:00.000Z', ...extra,
});

let atrasoResend = 0;
/** @type {import('vitest').MockInstance} */
let dorme;
beforeEach(() => {
  resetDegraded();
  vi.spyOn(console, 'error').mockImplementation(() => {});
  dorme = relogioAdiantavel();
  atrasoResend = 0;
  vi.stubGlobal('fetch', vi.fn(async url => {
    const host = new URL(String(url)).host;
    if (host === 'challenges.cloudflare.com') return Response.json({ success: true });
    if (host === 'api.resend.com') {
      if (atrasoResend) await new Promise(r => setTimeout(r, atrasoResend));
      return Response.json({ id: 'msg' });
    }
    return new Response('fora do teste', { status: 599 });
  }));
});
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); resetDegraded(); });

const envCom = kv => withDurableObjects({
  FOTOS: kv, TURNSTILE_SECRET_KEY: 'secret', RESEND_API_KEY: 'k', ADMIN_EMAIL: 'dono@exemplo.com',
});
const envix = () => envCom(fakeKV());
const envLogado = (inicial = {}) => envCom(fakeKV({ ...inicial, [`admin_session:${TOKEN}`]: JSON.stringify({ createdAt: Date.now() }) }));
const ctx = { waitUntil() {} };
const pede = (env, path, o = {}) => worker.fetch(new Request(SITE + path, {
  ...o, headers: { Cookie: `__Host-session=${TOKEN}`, 'Content-Type': 'application/json', Origin: SITE, ...(o.headers || {}) },
}), env, ctx);
const envio = (email) => new Request(`${SITE}/api/removal-request`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json', 'CF-Connecting-IP': '1.2.3.4' },
  body: JSON.stringify({ eventSlug: 'formatura', method: 'number', value: 'Foto 1', email, phone: '11999990000', message: '', consent: true, turnstileToken: 't', company_website: '' }),
});

// ---------------------------------------------------------------------------
describe('a corrida do #198', () => {
  it('dois pedidos ao mesmo tempo: os dois ficam no painel, cada um com o seu carimbo de e-mail', async () => {
    // Os e-mails demoram: os dois envios se intercalam entre a primeira
    // gravação e a segunda (a do carimbo). Com o array único, a segunda
    // gravação de um regravava a lista de antes e apagava o outro.
    atrasoResend = 30;
    const env = envix();
    const [a, b] = await Promise.all([handleRemovalRequest(envio('a@exemplo.com'), env), handleRemovalRequest(envio('b@exemplo.com'), env)]);
    expect([a.status, b.status]).toEqual([200, 200]);
    const salvos = pedidosGravados(env.FOTOS._store);
    expect(salvos.map(p => p.email).sort()).toEqual(['a@exemplo.com', 'b@exemplo.com']);
    expect(salvos.every(p => p.emailStatus === 'sent' && p.confirmEmailStatus === 'sent')).toBe(true);
  });

  it('um pedido chegando enquanto outro é resolvido: nenhum dos dois some', async () => {
    atrasoResend = 30;
    const env = envLogado({ [chavePedido('a1')]: JSON.stringify(pedido('a1')) });
    const [resolveu, novo] = await Promise.all([
      pede(env, '/api/removal-requests/a1/resolve', { method: 'PUT' }),
      handleRemovalRequest(envio('novo@exemplo.com'), env),
    ]);
    expect([resolveu.status, novo.status]).toEqual([200, 200]);
    const salvos = pedidosGravados(env.FOTOS._store);
    expect(salvos.find(p => p.id === 'a1').resolved).toBe(true);
    expect(salvos.some(p => p.email === 'novo@exemplo.com')).toBe(true);
  });

  it('enviar um pedido não lê nem regrava a lista — só escreve a própria chave', async () => {
    const kv = fakeKV({ [CHAVE_LEGADA]: JSON.stringify([pedido('velho')]) });
    const lidas = [];
    const escritas = [];
    const get = kv.get.bind(kv), put = kv.put.bind(kv);
    kv.get = async k => { lidas.push(k); return get(k); };
    kv.put = async (k, v) => { escritas.push(k); return put(k, v); };
    expect((await handleRemovalRequest(envio('x@exemplo.com'), envCom(kv))).status).toBe(200);
    expect(lidas).not.toContain(CHAVE_LEGADA);
    expect(new Set(escritas).size, 'a mesma chave duas vezes: o pedido e o carimbo').toBe(1);
    expect(escritas[0]).toMatch(/^removal_request:[a-f0-9]+$/);
    expect(JSON.parse(kv._store.get(CHAVE_LEGADA))).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
describe('a troca sem perda: array antigo + uma chave por pedido', () => {
  it('a lista junta os dois, e o registro próprio vence o do array', async () => {
    const env = envLogado({
      [CHAVE_LEGADA]: JSON.stringify([pedido('a1'), pedido('b2')]),
      [chavePedido('b2')]: JSON.stringify(pedido('b2', { resolved: true, resolvedAt: '2026-10-02T00:00:00.000Z' })),
      [chavePedido('c3')]: JSON.stringify(pedido('c3')),
    });
    const lista = await listaPedidos(env);
    expect(lista.map(p => p.id).sort()).toEqual(['a1', 'b2', 'c3']);
    expect(lista.find(p => p.id === 'b2').resolved).toBe(true);
  });

  it('resolver um pedido que só existe no array grava o registro próprio — e o array fica como estava', async () => {
    const env = envLogado({ [CHAVE_LEGADA]: JSON.stringify([pedido('a1')]) });
    const res = await pede(env, '/api/removal-requests/a1/resolve', { method: 'PUT' });
    expect(res.status).toBe(200);
    expect(JSON.parse(env.FOTOS._store.get(chavePedido('a1'))).resolved).toBe(true);
    expect(JSON.parse(env.FOTOS._store.get(CHAVE_LEGADA))[0].resolved).toBe(false);
    const lista = await (await pede(env, '/api/removal-requests')).json();
    expect(lista.map(p => [p.id, p.resolved])).toEqual([['a1', true]]);
  });

  it('abrir o painel não escreve nada no KV (a migração é do cron)', async () => {
    const env = envLogado({ [CHAVE_LEGADA]: JSON.stringify([pedido('a1')]) });
    const escritas = [];
    const put = env.FOTOS.put.bind(env.FOTOS), del = env.FOTOS.delete.bind(env.FOTOS);
    env.FOTOS.put = async (k, v) => { escritas.push(k); return put(k, v); };
    env.FOTOS.delete = async k => { escritas.push('-' + k); return del(k); };
    await pede(env, '/api/removal-requests');
    expect(escritas.filter(k => !k.startsWith('admin_session:'))).toEqual([]);
  });

  it('id que não pode ser nome de chave nem chega ao KV', async () => {
    const env = envLogado();
    const lidas = [];
    const get = env.FOTOS.get.bind(env.FOTOS);
    env.FOTOS.get = async k => { lidas.push(k); return get(k); };
    expect(await lePedido(env, '../admin_password')).toBeNull();
    expect(lidas).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
describe('migração do array antigo (cron)', () => {
  it('copia o que falta, não sobrescreve registro próprio, e apaga o array', async () => {
    const env = envLogado({
      [CHAVE_LEGADA]: JSON.stringify([pedido('a1'), pedido('b2'), { eventSlug: 'sem-id' }]),
      [chavePedido('b2')]: JSON.stringify(pedido('b2', { resolved: true })),
    });
    const r = await migraLegado(env);
    expect(r).toEqual({ migrados: 2, apagouLegado: true });
    expect(env.FOTOS._store.has(CHAVE_LEGADA)).toBe(false);
    expect(JSON.parse(env.FOTOS._store.get(chavePedido('b2'))).resolved, 'o registro próprio é mais novo').toBe(true);
    const todos = pedidosGravados(env.FOTOS._store);
    expect(todos).toHaveLength(3);
    expect(todos.some(p => p.eventSlug === 'sem-id' && /^[a-f0-9]+$/.test(p.id)), 'registro sem id ganha um, não some').toBe(true);
    expect(await migraLegado(env), 'idempotente').toEqual({ migrados: 0, apagouLegado: false });
  });

  it('escrita recusada no meio: NÃO apaga o array, e a próxima rodada termina', async () => {
    const env = envLogado({ [CHAVE_LEGADA]: JSON.stringify([pedido('a1'), pedido('b2'), pedido('c3')]) });
    const put = env.FOTOS.put.bind(env.FOTOS);
    let n = 0;
    env.FOTOS.put = async (k, v) => { if (k.startsWith('removal_request:') && ++n === 2) throw new Error('KV PUT 429'); return put(k, v); };
    await expect(migraLegado(env)).rejects.toThrow('429');
    expect(env.FOTOS._store.has(CHAVE_LEGADA), 'o array continua — nada se perde').toBe(true);
    expect((await listaPedidos(env)).map(p => p.id).sort(), 'e o painel continua vendo os três').toEqual(['a1', 'b2', 'c3']);
    env.FOTOS.put = put;
    await migraLegado(env);
    expect(env.FOTOS._store.has(CHAVE_LEGADA)).toBe(false);
    expect(pedidosGravados(env.FOTOS._store).map(p => p.id).sort()).toEqual(['a1', 'b2', 'c3']);
  });

  it('migração recusada não impede a poda do dia — e o erro sobe depois dela', async () => {
    const velho = new Date(Date.now() - 200 * 86400000).toISOString();
    const env = envLogado({
      [CHAVE_LEGADA]: JSON.stringify([pedido('a1')]),
      [chavePedido('velho')]: JSON.stringify(pedido('velho', { resolved: true, resolvedAt: velho })),
    });
    const put = env.FOTOS.put.bind(env.FOTOS);
    env.FOTOS.put = async (k, v) => { if (k === chavePedido('a1')) throw new Error('KV PUT failed: 429 Too Many Requests'); return put(k, v); };
    await expect(pruneResolvedRemovalRequests(env)).rejects.toThrow('429');
    expect(env.FOTOS._store.has(chavePedido('velho')), 'a poda rodou').toBe(false);
    expect(env.FOTOS._store.has(CHAVE_LEGADA), 'e o array antigo ficou para a próxima rodada').toBe(true);
  });

  it('o cron migra e poda na mesma rodada', async () => {
    const velho = new Date(Date.now() - 200 * 86400000).toISOString();
    const env = envLogado({
      [CHAVE_LEGADA]: JSON.stringify([pedido('a1'), pedido('b2', { resolved: true, resolvedAt: velho })]),
    });
    await worker.scheduled({}, env, { waitUntil: p => p });
    await new Promise(r => setTimeout(r, 0));
    expect(env.FOTOS._store.has(CHAVE_LEGADA)).toBe(false);
    expect(pedidosGravados(env.FOTOS._store).map(p => p.id)).toEqual(['a1']);
  });
});

// ---------------------------------------------------------------------------
describe('poda dos resolvidos', () => {
  it('apaga só resolvido além do prazo; pendente e ilegível ficam', async () => {
    const agora = Date.now();
    const env = envLogado({
      [chavePedido('pendente')]: JSON.stringify(pedido('pendente', { createdAt: '2020-01-01T00:00:00.000Z' })),
      [chavePedido('velho')]: JSON.stringify(pedido('velho', { resolved: true, resolvedAt: new Date(agora - 200 * 86400000).toISOString() })),
      [chavePedido('recente')]: JSON.stringify(pedido('recente', { resolved: true, resolvedAt: new Date(agora - 10 * 86400000).toISOString() })),
      [chavePedido('ilegivel')]: '{nao e json',
    });
    expect(await podaResolvidos(env, agora - 180 * 86400000)).toBe(1);
    expect([...env.FOTOS._store.keys()].filter(k => k.startsWith('removal_request:')).sort())
      .toEqual(['removal_request:ilegivel', 'removal_request:pendente', 'removal_request:recente']);
  });
});

// ---------------------------------------------------------------------------
describe('restore com uma chave por pedido', () => {
  const restaura = (env, removalRequests) => pede(env, '/api/backup/restore', {
    method: 'POST', body: JSON.stringify({ events: [], removalRequests }),
  });
  const hex = n => n.toString(16).padStart(32, '0');

  it('grava cada pedido novo na sua chave e pula o que já existe', async () => {
    const env = envLogado({ [chavePedido(hex(1))]: JSON.stringify(pedido(hex(1))) });
    const res = await restaura(env, [pedido(hex(1)), pedido(hex(2)), pedido(hex(3))]);
    expect((await res.json()).removalRequestsAdded).toBe(2);
    expect(pedidosGravados(env.FOTOS._store).map(p => p.id).sort()).toEqual([hex(1), hex(2), hex(3)]);
  });

  it('teto de 500 por restore (a cota de escrita é da conta inteira), pendentes primeiro', async () => {
    const env = envLogado();
    const muitos = Array.from({ length: 520 }, (_, i) => pedido(hex(i + 1), { resolved: i < 30 }));
    const corpo = await (await restaura(env, muitos)).json();
    expect(corpo.removalRequestsAdded).toBe(500);
    const gravados = pedidosGravados(env.FOTOS._store);
    expect(gravados.filter(p => !p.resolved)).toHaveLength(490);
  });
});

// ---------------------------------------------------------------------------
describe('os limites do KV', () => {
  it('o carimbo dos e-mails espera a janela de 1 s da mesma chave — e chega ao registro', async () => {
    // O KV de teste recusa a segunda escrita na mesma chave dentro de um
    // segundo, como o de verdade. Sem a espera, o carimbo levava 429 no caso
    // NORMAL (os e-mails voltam em menos de um segundo) e o painel ficava sem
    // saber se o aviso saiu.
    const env = envix();
    expect((await handleRemovalRequest(envio('x@exemplo.com'), env)).status).toBe(200);
    const [salvo] = pedidosGravados(env.FOTOS._store);
    expect([salvo.emailStatus, salvo.confirmEmailStatus]).toEqual(['sent', 'sent']);
    expect(degradedHealth(), 'nenhuma degradação: o carimbo não falhou').toEqual([]);
    expect(dorme).toHaveBeenCalledTimes(1);
    const espera = dorme.mock.calls[0][0];
    expect(espera).toBeGreaterThan(1000);
    expect(espera).toBeLessThanOrEqual(JANELA_MESMA_CHAVE_MS);
  });

  it('se a janela já passou (e-mails lentos), regrava sem esperar', async () => {
    const env = envix();
    await regravaPedido(env, pedido('a1'), Date.now() - 5000);
    expect(dorme).not.toHaveBeenCalled();
    expect(pedidosGravados(env.FOTOS._store).map(p => p.id)).toEqual(['a1']);
  });

  it('a lista lê em lotes de até 100 chaves — uma operação do KV por lote, não uma por pedido', async () => {
    const hex = n => n.toString(16).padStart(32, '0');
    const inicial = {};
    for (let i = 1; i <= 250; i++) inicial[chavePedido(hex(i))] = JSON.stringify(pedido(hex(i)));
    const env = envLogado(inicial);
    const get = env.FOTOS.get.bind(env.FOTOS);
    const lotes = [];
    env.FOTOS.get = async k => { if (Array.isArray(k)) lotes.push(k.length); return get(k); };
    expect(await listaPedidos(env)).toHaveLength(250);
    expect(lotes).toEqual([LOTE_DE_LEITURA, LOTE_DE_LEITURA, 50]);
  });
});
