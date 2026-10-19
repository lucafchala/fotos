import { vi } from 'vitest';
import { PREFIXO_PEDIDO, relogio } from '../../src/pedidos.js';

// Os pedidos de remoção gravados num KV de teste. Desde o #198 cada pedido
// mora na própria chave (`removal_request:<id>`, src/pedidos.js); os testes
// leem por aqui em vez de conhecer o formato de chave.
/** @param {Map<string, string>} store */
export function pedidosGravados(store) {
  return [...store.entries()]
    .filter(([k]) => k.startsWith(PREFIXO_PEDIDO))
    .map(([, v]) => JSON.parse(v));
}

// O envio de um pedido grava a chave dele duas vezes (o pedido, depois o
// carimbo dos e-mails), e o KV só aceita uma escrita por segundo na mesma
// chave — `regravaPedido` espera o resto da janela. Nos testes a espera vira
// RELÓGIO ADIANTADO: `relogio.dorme` não dorme, só soma o tempo a `Date.now`.
// Um KV de teste que cobra a janela continua vendo o segundo passar, e a
// suíte não ganha um segundo de verdade por pedido. Chamar num `beforeEach`;
// `vi.restoreAllMocks()` desfaz.
export function relogioAdiantavel() {
  const real = Date.now.bind(Date);
  let adiantado = 0;
  vi.spyOn(Date, 'now').mockImplementation(() => real() + adiantado);
  return vi.spyOn(relogio, 'dorme').mockImplementation(async ms => { adiantado += ms; });
}
