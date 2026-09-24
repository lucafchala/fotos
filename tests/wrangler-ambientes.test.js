// Ambiente do wrangler que reaproveita o KV ou o D1 de produção não é
// ambiente: é uma segunda porta para os dados reais (#166). O `[env.preview]`
// antigo declarava um Worker `fotos-preview` com o MESMO namespace KV e sem
// D1 — quem rodasse `--env preview` achando que estava isolado gravava em
// projetos, sessões e pedidos de remoção de verdade, sem registro de
// consentimento. Isolar exige recursos próprios; este teste recusa a cópia.

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';

const TOML = readFileSync(new URL('../wrangler.toml', import.meta.url), 'utf8');

/**
 * Os ids de recurso (`id` de KV, `database_id` de D1) por seção. Leitura por
 * linha basta: neste arquivo todo cabeçalho de seção é uma linha que começa
 * com `[`, e os ids são strings simples.
 * @param {string} texto
 */
function idsPorSecao(texto) {
  /** @type {{ secao: string, chave: string, valor: string }[]} */
  const ids = [];
  let secao = '';
  for (const linha of texto.split('\n')) {
    const cab = /^\s*\[\[?([^\]]+)\]\]?\s*(#.*)?$/.exec(linha);
    if (cab) { secao = cab[1].trim(); continue; }
    const id = /^\s*(id|database_id)\s*=\s*"([^"]+)"/.exec(linha);
    if (id) ids.push({ secao, chave: id[1], valor: id[2] });
  }
  return ids;
}

describe('ambientes do wrangler.toml', () => {
  const ids = idsPorSecao(TOML);
  const deAmbiente = ids.filter(i => i.secao.startsWith('env.'));
  const deProducao = ids.filter(i => !i.secao.startsWith('env.'));

  it('o leitor acha os recursos de produção (senão o teste abaixo passaria vazio)', () => {
    expect(deProducao.map(i => `${i.secao}.${i.chave}`).sort())
      .toEqual(['d1_databases.database_id', 'kv_namespaces.id']);
  });

  it('nenhum [env.*] reaproveita o KV ou o D1 de produção', () => {
    const producao = new Set(deProducao.map(i => i.valor));
    const copias = deAmbiente.filter(i => producao.has(i.valor)).map(i => `[${i.secao}] ${i.chave}`);
    expect(copias, 'ambiente apontando para dados de produção — crie KV/D1 próprios').toEqual([]);
  });
});
