// 500 na galeria do FNUSC (19/11/2026): o Workers rejeita, no pedido B, a
// promessa que o pedido A criou e não viveu para resolver (flag
// handle_cross_request_promise_resolution). A leitura do Drive é compartilhada
// entre pedidos do mesmo isolate (`voos` e `decisoes` em src/drive.js); quem
// esperava a do outro tem de refazer no próprio pedido, não cair num 500.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { limpaCacheDrive, leComRenovacao } from '../src/drive.js';
import { ehPromessaDeOutroPedido } from '../src/utils.js';
import { withDurableObjects } from './helpers/do.js';
import { fakeCaches } from './helpers/caches.js';
import { d1Sqlite } from './helpers/d1.js';

const MSG = 'This promise was created by a request that has since ended, so it can never settle. With the handle_cross_request_promise_resolution compatibility flag, a promise can only settle in the request that created it, and settling it after that request ends is dropped.';

function fakeKV() {
  const store = new Map();
  return {
    async get(k) { return store.has(k) ? store.get(k) : null; },
    async put(k, v) { store.set(k, v); },
    async delete(k) { store.delete(k); },
    async list() { return { keys: [], list_complete: true, cursor: null }; },
  };
}

let env;
beforeEach(() => {
  limpaCacheDrive();
  vi.stubGlobal('caches', fakeCaches());
  env = withDurableObjects({ FOTOS: fakeKV(), GOOGLE_DRIVE_API_KEY: 'AIzaChaveDeTeste123', SIGNING_SECRET: 's'.repeat(48), CONSENT_DB: d1Sqlite() });
});
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });

describe('ehPromessaDeOutroPedido', () => {
  it('reconhece a mensagem do Workers e nada mais', () => {
    expect(ehPromessaDeOutroPedido(new Error(MSG))).toBe(true);
    expect(ehPromessaDeOutroPedido(new Error('Drive 403'))).toBe(false);
    expect(ehPromessaDeOutroPedido(null)).toBe(false);
  });
});

describe('leitura compartilhada que nasceu noutro pedido', () => {
  const dados = em => ({ em, fotos: ['FOTO_1'] });
  const base = (refaz, extra = {}) => ({
    kMem: 'k', leaseChave: 'lease:k', memo: new Map(), ttlMs: 60_000, atualizar: false,
    fonte: async () => null, refaz, ...extra,
  });

  it('voos: quem esperava a releitura do outro pedido relê no próprio', async () => {
    let n = 0;
    const refaz = vi.fn(async () => {
      n++;
      if (n === 1) { await new Promise(r => setTimeout(r, 20)); throw new Error(MSG); }
      return dados(new Date().toISOString());
    });
    const a = leComRenovacao(env, null, base(refaz, { atualizar: true })).catch(e => e);
    const b = leComRenovacao(env, null, base(refaz, { atualizar: true }));
    expect((await a).message).toBe(MSG);
    expect((await b).fotos).toEqual(['FOTO_1']);
    expect(refaz).toHaveBeenCalledTimes(2);
  });

  it('decisoes: quem esperava a decisão do outro pedido decide no próprio', async () => {
    let n = 0;
    const fonte = vi.fn(async () => {
      n++;
      if (n === 1) { await new Promise(r => setTimeout(r, 20)); throw new Error(MSG); }
      return { dados: dados(new Date().toISOString()), fresco: true };
    });
    const memo = new Map();
    const a = leComRenovacao(env, null, base(vi.fn(), { fonte, memo })).catch(e => e);
    const b = leComRenovacao(env, null, base(vi.fn(), { fonte, memo }));
    expect((await a).message).toBe(MSG);
    expect((await b).fotos).toEqual(['FOTO_1']);
  });

  it('outro erro qualquer continua sendo o erro (não relê à toa)', async () => {
    const refaz = vi.fn(async () => { await new Promise(r => setTimeout(r, 20)); throw new Error('Drive 403'); });
    const a = leComRenovacao(env, null, base(refaz, { atualizar: true })).catch(e => e);
    const b = leComRenovacao(env, null, base(refaz, { atualizar: true })).catch(e => e);
    expect((await a).message).toBe('Drive 403');
    expect((await b).message).toBe('Drive 403');
    expect(refaz).toHaveBeenCalledTimes(1);
  });
});
