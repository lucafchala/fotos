// Deixa o Node importar o `src/index.js` de verdade.
//
//   node --import ./scripts/node-com-workers.mjs scripts/verifica-painel.mjs
//
// O módulo de entrada do Worker importa `cloudflare:workers` (a classe base dos
// Durable Objects, em src/counters.js), que só existe dentro do workerd. Na
// suíte, o vitest troca esse import pelo dublê de `tests/stubs/` via
// `resolve.alias` (vitest.config.js). Fora do vitest — nos roteiros de
// navegador que sobem o Worker num servidor HTTP local (scripts/worker-local.mjs)
// — quem faz a troca é este gancho de resolução do Node, registrado ANTES do
// primeiro import pelo `--import`.
//
// É o mesmo dublê, de propósito: um lugar só decide o que `cloudflare:workers`
// é fora do workerd (regra "uma coisa escrita duas vezes é corrigida uma vez
// só", TODO.md).
import { register } from 'node:module';

const DUBLE = new URL('../tests/stubs/cloudflare-workers.js', import.meta.url).href;

// O gancho precisa ser um módulo; um `data:` evita um terceiro arquivo só para
// estas três linhas.
const gancho = `
export async function resolve(especificador, contexto, proximo) {
  if (especificador === 'cloudflare:workers') return { url: ${JSON.stringify(DUBLE)}, shortCircuit: true };
  return proximo(especificador, contexto);
}`;
register('data:text/javascript,' + encodeURIComponent(gancho));
