// Revogação de sessões do painel: "Sair dos outros aparelhos" e a troca de senha.
//
// O buraco que isto fecha: o KV é eventualmente consistente. Um apagamento só
// chega a outro local da Cloudflare quando o cache de lá vence (60 s por
// padrão), e nessa janela o aparelho revogado ainda é aceito — se a renovação
// do `lastSeen` (a cada 10 min) cair nela, o `put` do verifySession RESSUSCITA
// o registro apagado, por mais 24 h. A troca de senha já tinha esse buraco.
//
// A correção é um marcador (`admin_sessions_corte`): "tudo aberto antes de T
// morre, menos a sessão de quem pediu". O registro ressuscitado guarda o
// createdAt antigo, então o marcador o derruba assim que chega ao local.
//
// O último bloco reproduz o buraco INTEIRO, com um KV de dois locais e cache
// (não só o resultado dele): é o teste que mostra o problema, e que reprova se
// o marcador sair do verifySession.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createHash } from 'node:crypto';
import worker, { handleChangePassword, handleRevokeOtherSessions } from '../src/index.js';
import {
  verifySession, encerraOutrasSessoes, degradedHealth, resetDegraded,
  CORTE_DE_SESSOES_KEY, SESSION_TTL_SECS, clientFingerprint,
} from '../src/utils.js';

const DONO = 'a'.repeat(64);      // quem pede o corte
const LADRAO = 'b'.repeat(64);    // um aparelho que o dono quer fora
const OUTRO = 'c'.repeat(64);
const hash = (/** @type {string} */ t) => createHash('sha256').update(t).digest('hex');
const chave = (/** @type {string} */ t) => `admin_session:${t}`;
const UA = 'ua-de-teste';

const AGORA = Date.parse('2026-10-17T15:00:00Z');
const MIN = 60_000;

/** Registro de sessão como o login grava. */
const sessao = (/** @type {Record<string, unknown>} */ o = {}) => JSON.stringify({
  v: 1, createdAt: AGORA - 3600_000, lastSeen: AGORA - 60_000,
  fp: clientFingerprint(new Request('https://fotos.lucafchala.com/', { headers: { 'User-Agent': UA } })), ...o,
});
const corte = (/** @type {Record<string, unknown>} */ o = {}) => JSON.stringify({ antes: AGORA - 10 * MIN, exceto: hash(DONO), ...o });

/**
 * KV em memória que anota cada chamada, com `list` paginado de verdade
 * (`porPagina`): em ordem de chave, e o cursor é a última chave devolvida — como
 * o do KV, resiste a apagar entre uma página e outra (um cursor por posição
 * pularia chaves, porque a varredura apaga enquanto anda).
 * @param {Record<string, string>} inicial
 * @param {{ porPagina?: number }} [o]
 */
function kv(inicial = {}, { porPagina = 1000 } = {}) {
  const store = new Map(Object.entries(inicial));
  /** @type {{ op: string, k?: string, opts?: any }[]} */
  const log = [];
  return {
    async get(/** @type {string} */ k, /** @type {any} */ opts) { log.push({ op: 'get', k, opts }); return store.has(k) ? store.get(k) : null; },
    async put(/** @type {string} */ k, /** @type {string} */ v, /** @type {any} */ opts) { log.push({ op: 'put', k, opts }); store.set(k, v); },
    async delete(/** @type {string} */ k) { log.push({ op: 'delete', k }); store.delete(k); },
    async list(/** @type {{ prefix?: string, cursor?: string }} */ { prefix = '', cursor } = {}) {
      log.push({ op: 'list', opts: { prefix, cursor } });
      const restantes = [...store.keys()].filter(k => k.startsWith(prefix)).sort().filter(k => !cursor || k > cursor);
      const fatia = restantes.slice(0, porPagina);
      const completo = restantes.length <= porPagina;
      return { keys: fatia.map(name => ({ name })), list_complete: completo, cursor: completo ? undefined : fatia[fatia.length - 1] };
    },
    _store: store,
    _log: log,
  };
}

/** Pedido ao painel com o cookie de `token` (e a mesma impressão do cliente dos registros). */
const pedido = (/** @type {string} */ token, caminho = '/dashboard', init = {}) => new Request(`https://fotos.lucafchala.com${caminho}`, {
  ...init,
  headers: { Cookie: `__Host-session=${token}`, 'User-Agent': UA, 'Sec-Fetch-Site': 'same-origin', ...(/** @type {any} */ (init).headers || {}) },
});

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(AGORA);
  resetDegraded();
  vi.spyOn(console, 'error').mockImplementation(() => {});
});
afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); resetDegraded(); });

// ---------------------------------------------------------------------------
describe('verifySession e o marcador de corte', () => {
  it('derruba a sessão aberta antes do corte, menos a de quem pediu', async () => {
    const FOTOS = kv({
      [chave(DONO)]: sessao({ createdAt: AGORA - 3 * 3600_000 }),
      [chave(LADRAO)]: sessao({ createdAt: AGORA - 2 * 3600_000 }),
      [CORTE_DE_SESSOES_KEY]: corte(),
    });
    expect(await verifySession({ FOTOS }, pedido(LADRAO)), 'aberta antes do corte').toBe(false);
    expect(FOTOS._store.has(chave(LADRAO)), 'o registro recusado é apagado').toBe(false);
    expect(await verifySession({ FOTOS }, pedido(DONO)), 'a de quem pediu fica, mesmo sendo mais velha que o corte').toBe(true);
    expect(FOTOS._store.has(chave(DONO))).toBe(true);
  });

  it('a sessão aberta DEPOIS do corte passa', async () => {
    const FOTOS = kv({
      [chave(OUTRO)]: sessao({ createdAt: AGORA - 5 * MIN, lastSeen: AGORA - 5 * MIN }),
      [CORTE_DE_SESSOES_KEY]: corte(),
    });
    expect(await verifySession({ FOTOS }, pedido(OUTRO))).toBe(true);
  });

  it('no instante exato do corte a sessão passa (createdAt < antes é o que corta)', async () => {
    const FOTOS = kv({
      [chave(OUTRO)]: sessao({ createdAt: AGORA - 10 * MIN, lastSeen: AGORA - 60_000 }),
      [CORTE_DE_SESSOES_KEY]: corte({ antes: AGORA - 10 * MIN }),
    });
    expect(await verifySession({ FOTOS }, pedido(OUTRO))).toBe(true);
  });

  it('registro posto de volta depois do corte (ressurreição) continua recusado', async () => {
    const FOTOS = kv({
      [chave(DONO)]: sessao({ createdAt: AGORA - 3 * 3600_000 }),
      [CORTE_DE_SESSOES_KEY]: corte(),
    });
    // O que a renovação de outro local faz: reescreve o registro apagado, com o
    // createdAt de sempre e um lastSeen novo.
    FOTOS._store.set(chave(LADRAO), sessao({ createdAt: AGORA - 2 * 3600_000, lastSeen: AGORA - 1000 }));
    expect(await verifySession({ FOTOS }, pedido(LADRAO))).toBe(false);
    expect(FOTOS._store.has(chave(LADRAO)), 'e o registro ressuscitado some de novo').toBe(false);
  });

  it('a sessão cortada não é reescrita: o corte vem ANTES da renovação do lastSeen', async () => {
    // Renovação vencida (lastSeen de 9 min atrás, o limite é 10) — o `put`
    // dela é justamente o que ressuscitaria um registro revogado.
    const FOTOS = kv({
      [chave(LADRAO)]: sessao({ createdAt: AGORA - 2 * 3600_000, lastSeen: AGORA - 11 * MIN }),
      [CORTE_DE_SESSOES_KEY]: corte(),
    });
    expect(await verifySession({ FOTOS }, pedido(LADRAO))).toBe(false);
    expect(FOTOS._log.filter(c => c.op === 'put'), 'nenhuma escrita para uma sessão revogada').toEqual([]);
  });

  it('sem marcador, nada muda: a sessão válida passa e o que vence continua vencendo', async () => {
    const FOTOS = kv({ [chave(DONO)]: sessao() });
    expect(await verifySession({ FOTOS }, pedido(DONO))).toBe(true);
    const velha = kv({ [chave(DONO)]: sessao({ createdAt: AGORA - SESSION_TTL_SECS * 1000 - 1000 }) });
    expect(await verifySession({ FOTOS: velha }, pedido(DONO)), 'o teto de 24 h segue valendo').toBe(false);
    expect(degradedHealth(), 'ausência de marcador não é problema').toEqual([]);
  });

  it('lê o registro e o marcador juntos, os dois com cacheTtl de 30 s (o mínimo do KV)', async () => {
    const FOTOS = kv({ [chave(DONO)]: sessao() });
    await verifySession({ FOTOS }, pedido(DONO));
    const leituras = FOTOS._log.filter(c => c.op === 'get');
    expect(leituras.map(l => l.k).sort()).toEqual([CORTE_DE_SESSOES_KEY, chave(DONO)].sort());
    for (const l of leituras) expect(l.opts, `leitura de ${l.k}`).toEqual({ cacheTtl: 30 });
  });

  it('sem cookie de sessão não encosta no KV', async () => {
    const FOTOS = kv({ [CORTE_DE_SESSOES_KEY]: corte() });
    expect(await verifySession({ FOTOS }, new Request('https://fotos.lucafchala.com/dashboard'))).toBe(false);
    expect(FOTOS._log).toEqual([]);
  });

  it('o KV que não responde segue propagando, do registro ou do marcador (o painel falha FECHADO)', async () => {
    for (const quebrada of [chave(DONO), CORTE_DE_SESSOES_KEY]) {
      const FOTOS = kv({ [chave(DONO)]: sessao() });
      const real = FOTOS.get;
      FOTOS.get = (k, o) => (k === quebrada ? Promise.reject(new Error('KV GET failed: 503')) : real(k, o));
      await expect(verifySession({ FOTOS }, pedido(DONO)), `leitura de ${quebrada}`).rejects.toThrow(/KV GET failed/);
    }
  });

  describe('marcador ilegível é ignorado — não pode trancar o dono fora — e vira aviso', () => {
    it.each([
      ['não é JSON', 'isto nao e json'],
      ['JSON que não é objeto', '"corte"'],
      ['array', '[1,2]'],
      ['null', 'null'],
      ['antes não é número', JSON.stringify({ antes: 'ontem', exceto: hash(DONO) })],
      ['antes sem exceto', JSON.stringify({ antes: AGORA - MIN })],
      ['exceto que não é um SHA-256', JSON.stringify({ antes: AGORA - MIN, exceto: 'curto' })],
      ['exceto em maiúsculas', JSON.stringify({ antes: AGORA - MIN, exceto: hash(DONO).toUpperCase() })],
      // Lixo válido como JSON, mas que valeria contra a sessão que o dono abrir
      // depois: o login do futuro nasce "antes" desse corte.
      ['antes no futuro distante', JSON.stringify({ antes: AGORA + 400 * 86400_000, exceto: hash(OUTRO) })],
      ['vazio', ''],
    ])('%s', async (_nome, bruto) => {
      const FOTOS = kv({
        [chave(DONO)]: sessao({ createdAt: AGORA - 3 * 3600_000 }),
        [CORTE_DE_SESSOES_KEY]: bruto,
      });
      expect(await verifySession({ FOTOS }, pedido(DONO)), 'a sessão válida continua entrando').toBe(true);
      expect(degradedHealth().map(p => p.label)).toContain('marcador de revogação de sessões ilegível');
    });
  });
});

// ---------------------------------------------------------------------------
describe('encerraOutrasSessoes — a única implementação do corte', () => {
  it('grava o marcador (hora, hash do token que pediu, TTL de 25 h), apaga as outras e conta', async () => {
    const FOTOS = kv({
      [chave(DONO)]: sessao(), [chave(LADRAO)]: sessao(), [chave(OUTRO)]: sessao(),
      events: '[]',
    });
    const n = await encerraOutrasSessoes({ FOTOS }, DONO);

    expect(n).toBe(2);
    expect([...FOTOS._store.keys()].sort(), 'só a sessão atual e o que não é sessão').toEqual([CORTE_DE_SESSOES_KEY, chave(DONO), 'events'].sort());
    expect(JSON.parse(/** @type {string} */ (FOTOS._store.get(CORTE_DE_SESSOES_KEY)))).toEqual({ antes: AGORA, exceto: hash(DONO) });
    const gravacao = FOTOS._log.find(c => c.op === 'put');
    expect(gravacao?.k).toBe(CORTE_DE_SESSOES_KEY);
    expect(gravacao?.opts, '24 h do teto absoluto + 1 h').toEqual({ expirationTtl: SESSION_TTL_SECS + 3600 });
  });

  it('o marcador é gravado ANTES de qualquer apagamento', async () => {
    const FOTOS = kv({ [chave(DONO)]: sessao(), [chave(LADRAO)]: sessao() });
    await encerraOutrasSessoes({ FOTOS }, DONO);
    const ordem = FOTOS._log.filter(c => c.op !== 'get').map(c => c.op);
    expect(ordem).toEqual(['put', 'list', 'delete']);
  });

  it('a chave do marcador não casa com o prefixo das sessões (a varredura não a apaga)', async () => {
    expect(CORTE_DE_SESSOES_KEY.startsWith('admin_session:')).toBe(false);
    const FOTOS = kv({ [CORTE_DE_SESSOES_KEY]: corte({ antes: 1 }), [chave(DONO)]: sessao() });
    await encerraOutrasSessoes({ FOTOS }, DONO);
    expect(FOTOS._store.has(CORTE_DE_SESSOES_KEY)).toBe(true);
  });

  it('percorre todas as páginas do list', async () => {
    const outras = Object.fromEntries(Array.from({ length: 7 }, (_, i) => [chave(String(i).repeat(64)), sessao()]));
    const FOTOS = kv({ [chave(DONO)]: sessao(), ...outras }, { porPagina: 3 });
    const n = await encerraOutrasSessoes({ FOTOS }, DONO);
    expect(n).toBe(7);
    expect([...FOTOS._store.keys()].filter(k => k.startsWith('admin_session:'))).toEqual([chave(DONO)]);
    expect(FOTOS._log.filter(c => c.op === 'list').length).toBeGreaterThanOrEqual(3);
  });

  it('sem outras sessões devolve 0 — e ainda assim grava o corte (o registro pode estar noutro local)', async () => {
    const FOTOS = kv({ [chave(DONO)]: sessao() });
    expect(await encerraOutrasSessoes({ FOTOS }, DONO)).toBe(0);
    expect(FOTOS._store.has(CORTE_DE_SESSOES_KEY)).toBe(true);
  });

  it('se o marcador não puder ser gravado, lança e não apaga nada', async () => {
    const FOTOS = kv({ [chave(DONO)]: sessao(), [chave(LADRAO)]: sessao() });
    FOTOS.put = async () => { throw new Error('KV PUT failed: 429 Too Many Requests'); };
    await expect(encerraOutrasSessoes({ FOTOS }, DONO)).rejects.toThrow(/429/);
    expect(FOTOS._store.has(chave(LADRAO)), 'sem corte gravado, apagar só deixaria a janela aberta sem aviso').toBe(true);
  });
});

// ---------------------------------------------------------------------------
describe('POST /api/sessions/revoke-others', () => {
  const env = (/** @type {ReturnType<typeof kv>} */ FOTOS) => ({ FOTOS });
  const ctx = { waitUntil: () => {} };
  const post = (/** @type {ReturnType<typeof kv>} */ FOTOS, token = DONO, init = {}) =>
    worker.fetch(pedido(token, '/api/sessions/revoke-others', { method: 'POST', ...init }), /** @type {any} */ (env(FOTOS)), /** @type {any} */ (ctx));

  it('devolve a contagem e deixa só a sessão de quem pediu', async () => {
    const FOTOS = kv({ [chave(DONO)]: sessao(), [chave(LADRAO)]: sessao(), [chave(OUTRO)]: sessao() });
    const res = await post(FOTOS);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, encerradas: 2 });
    expect([...FOTOS._store.keys()].filter(k => k.startsWith('admin_session:'))).toEqual([chave(DONO)]);
    // E a sessão que ficou continua entrando, mesmo com o corte gravado depois dela.
    expect(await verifySession(env(FOTOS), pedido(DONO))).toBe(true);
  });

  it('sozinho no painel: 0, e o corte gravado do mesmo jeito', async () => {
    const FOTOS = kv({ [chave(DONO)]: sessao() });
    expect(await (await post(FOTOS)).json()).toEqual({ ok: true, encerradas: 0 });
    expect(FOTOS._store.has(CORTE_DE_SESSOES_KEY)).toBe(true);
  });

  it('sem sessão: 401 e nada gravado nem apagado', async () => {
    const FOTOS = kv({ [chave(LADRAO)]: sessao() });
    const res = await worker.fetch(new Request('https://fotos.lucafchala.com/api/sessions/revoke-others', {
      method: 'POST', headers: { 'Sec-Fetch-Site': 'same-origin' },
    }), /** @type {any} */ (env(FOTOS)), /** @type {any} */ (ctx));
    expect(res.status).toBe(401);
    expect(FOTOS._log.filter(c => c.op !== 'get')).toEqual([]);
  });

  it('sessão que não existe no KV: 401, nada gravado', async () => {
    const FOTOS = kv({ [chave(LADRAO)]: sessao() });
    expect((await post(FOTOS, OUTRO)).status).toBe(401);
    expect(FOTOS._log.filter(c => c.op !== 'get')).toEqual([]);
  });

  it('origem cruzada: 403 pelo portão do roteador, nada gravado', async () => {
    const FOTOS = kv({ [chave(DONO)]: sessao(), [chave(LADRAO)]: sessao() });
    const res = await post(FOTOS, DONO, { headers: { 'Sec-Fetch-Site': 'cross-site' } });
    expect(res.status).toBe(403);
    expect(FOTOS._log.filter(c => c.op !== 'get')).toEqual([]);
  });

  it('só POST: GET na mesma rota é 404, e nada é gravado', async () => {
    const FOTOS = kv({ [chave(DONO)]: sessao(), [chave(LADRAO)]: sessao() });
    const res = await worker.fetch(pedido(DONO, '/api/sessions/revoke-others'), /** @type {any} */ (env(FOTOS)), /** @type {any} */ (ctx));
    expect(res.status).toBe(404);
    expect(FOTOS._store.has(chave(LADRAO))).toBe(true);
  });

  it('o KV recusando a escrita: 503 que diz o que houve, aviso no healthz, nada apagado', async () => {
    const FOTOS = kv({ [chave(DONO)]: sessao(), [chave(LADRAO)]: sessao() });
    FOTOS.put = async () => { throw new Error('KV PUT failed: 429 Too Many Requests'); };
    const res = await post(FOTOS);
    expect(res.status).toBe(503);
    expect((await res.json()).error).toMatch(/banco de dados do site não respondeu/);
    expect(degradedHealth().map(p => p.label).join()).toMatch(/KV/);
    expect(FOTOS._store.has(chave(LADRAO))).toBe(true);
  });

  it('o handler exportado faz o mesmo que a rota', async () => {
    const FOTOS = kv({ [chave(DONO)]: sessao(), [chave(LADRAO)]: sessao() });
    const res = await handleRevokeOtherSessions(pedido(DONO, '/api/sessions/revoke-others', { method: 'POST' }), /** @type {any} */ (env(FOTOS)));
    expect(await res.json()).toEqual({ ok: true, encerradas: 1 });
  });
});

// ---------------------------------------------------------------------------
describe('troca de senha e o marcador', () => {
  const trocar = (/** @type {ReturnType<typeof kv>} */ FOTOS, token = DONO) => handleChangePassword(
    pedido(token, '/api/settings/password', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ password: 'uma frase longa de teste 2026' }),
    }),
    /** @type {any} */ ({ FOTOS }),
    /** @type {any} */ ({ waitUntil() {} }),
  );

  it('grava o marcador com o hash do token de quem trocou — e essa sessão continua entrando', async () => {
    const FOTOS = kv({ [chave(DONO)]: sessao({ createdAt: AGORA - 3 * 3600_000 }), [chave(LADRAO)]: sessao() });
    const res = await trocar(FOTOS);
    expect(res.status).toBe(200);

    expect(JSON.parse(/** @type {string} */ (FOTOS._store.get(CORTE_DE_SESSOES_KEY)))).toEqual({ antes: AGORA, exceto: hash(DONO) });
    expect(FOTOS._store.has('admin_password')).toBe(true);
    expect(FOTOS._store.has(chave(LADRAO)), 'a outra sessão foi apagada').toBe(false);
    // createdAt MAIS VELHO que o corte: só passa por ser a de quem trocou.
    expect(await verifySession({ FOTOS }, pedido(DONO))).toBe(true);
  });

  it('a sessão que o apagamento não alcançou (ressuscitada) cai pelo marcador', async () => {
    const FOTOS = kv({ [chave(DONO)]: sessao({ createdAt: AGORA - 3 * 3600_000 }) });
    await trocar(FOTOS);
    FOTOS._store.set(chave(LADRAO), sessao({ createdAt: AGORA - 2 * 3600_000, lastSeen: AGORA - 500 }));
    expect(await verifySession({ FOTOS }, pedido(LADRAO))).toBe(false);
  });

  it('a senha que não gravou não corta nada (o 503 de antes continua valendo)', async () => {
    const FOTOS = kv({ [chave(DONO)]: sessao(), [chave(LADRAO)]: sessao() });
    FOTOS.put = async () => { throw new Error('KV PUT failed: 429'); };
    expect((await trocar(FOTOS)).status).toBe(503);
    expect(FOTOS._store.has(CORTE_DE_SESSOES_KEY)).toBe(false);
    expect(FOTOS._store.has(chave(LADRAO))).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// O buraco inteiro, com a causa (cache por local) e não só o efeito.
//
// `kvCentral()` modela o que importa do KV da Cloudflare: uma verdade central,
// e um cache em cada local — a leitura fica guardada por `cacheTtl` (60 s se
// não disser), a escrita aparece na hora no local de quem escreve e só chega
// aos outros quando o cache deles vence.
describe('a janela de consistência do KV: dois locais, cache e a renovação que ressuscitava', () => {
  function kvCentral() {
    /** @type {Map<string, string>} */
    const central = new Map();
    const local = () => {
      /** @type {Map<string, { v: string|null, ate: number }>} */
      const cache = new Map();
      return {
        async get(/** @type {string} */ k, /** @type {{ cacheTtl?: number }} */ opts = {}) {
          const c = cache.get(k);
          if (c && c.ate > Date.now()) return c.v;
          const v = central.has(k) ? /** @type {string} */ (central.get(k)) : null;
          cache.set(k, { v, ate: Date.now() + (opts.cacheTtl ?? 60) * 1000 });
          return v;
        },
        async put(/** @type {string} */ k, /** @type {string} */ v) { central.set(k, v); cache.set(k, { v, ate: Date.now() + 60_000 }); },
        async delete(/** @type {string} */ k) { central.delete(k); cache.set(k, { v: null, ate: Date.now() + 60_000 }); },
        async list(/** @type {{ prefix?: string }} */ { prefix = '' } = {}) {
          return { keys: [...central.keys()].filter(k => k.startsWith(prefix)).map(name => ({ name })), list_complete: true };
        },
      };
    };
    return { central, local };
  }

  it('o aparelho revogado passa no máximo até o cache vencer; a renovação dentro da janela não o ressuscita', async () => {
    const { central, local } = kvCentral();
    // A sessão do ladrão: aberta há 2 h, com a renovação do lastSeen a 5 s de vencer.
    central.set(chave(LADRAO), sessao({ createdAt: AGORA - 2 * 3600_000, lastSeen: AGORA - 595_000 }));
    central.set(chave(DONO), sessao({ createdAt: AGORA - 3 * 3600_000 }));

    const emA = { FOTOS: local() };   // onde o dono pede o corte
    const emB = { FOTOS: local() };   // onde o cookie roubado é usado

    // 1 s antes do corte, B atende o ladrão: guarda em cache o registro e a
    // AUSÊNCIA do marcador. A renovação ainda não venceu (594 s).
    vi.setSystemTime(AGORA - 1000);
    expect(await verifySession(/** @type {any} */ (emB), pedido(LADRAO))).toBe(true);

    // O corte, em A.
    vi.setSystemTime(AGORA);
    expect(await encerraOutrasSessoes(/** @type {any} */ (emA), DONO)).toBe(1);
    expect(central.has(chave(LADRAO)), 'apagado na verdade central').toBe(false);

    // 10 s depois, B ainda tem o cache velho: aceita (a janela é de até 30 s —
    // é o que a tela promete), e agora a renovação venceu (605 s) e REESCREVE o
    // registro que acabou de ser apagado.
    vi.setSystemTime(AGORA + 10_000);
    expect(await verifySession(/** @type {any} */ (emB), pedido(LADRAO)), 'dentro da janela de cache').toBe(true);
    expect(central.has(chave(LADRAO)), 'ressuscitado pela renovação').toBe(true);

    // 40 s depois do corte o cache de B venceu: lê o registro ressuscitado E o
    // marcador. Sem o marcador, esta sessão valia mais 24 h.
    vi.setSystemTime(AGORA + 40_000);
    expect(await verifySession(/** @type {any} */ (emB), pedido(LADRAO)), 'o marcador chegou a B').toBe(false);
    expect(central.has(chave(LADRAO))).toBe(false);

    // Horas depois, continua fora; e o dono, em B, continua dentro.
    vi.setSystemTime(AGORA + 3 * 3600_000);
    central.set(chave(LADRAO), sessao({ createdAt: AGORA - 2 * 3600_000, lastSeen: AGORA + 3 * 3600_000 - 1000 }));
    expect(await verifySession(/** @type {any} */ ({ FOTOS: local() }), pedido(LADRAO)), 'ressuscitar de novo horas depois não adianta').toBe(false);
    central.set(chave(DONO), sessao({ createdAt: AGORA - 3 * 3600_000, lastSeen: AGORA + 3 * 3600_000 - 1000 }));
    expect(await verifySession(/** @type {any} */ ({ FOTOS: local() }), pedido(DONO))).toBe(true);
  });
});
