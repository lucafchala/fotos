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

// `[env.*]` e o bloco `[previews]` (Worker Previews, v2.0) seguem a MESMA
// regra: o que não é o topo do arquivo não é produção, e não pode apontar para
// os dados de produção.
const foraDeProducao = (/** @type {string} */ secao) => secao.startsWith('env.') || secao === 'previews' || secao.startsWith('previews.');

describe('ambientes do wrangler.toml', () => {
  const ids = idsPorSecao(TOML);
  const deAmbiente = ids.filter(i => foraDeProducao(i.secao));
  const deProducao = ids.filter(i => !foraDeProducao(i.secao));

  it('o leitor acha os recursos de produção (senão o teste abaixo passaria vazio)', () => {
    expect(deProducao.map(i => `${i.secao}.${i.chave}`).sort())
      .toEqual(['d1_databases.database_id', 'kv_namespaces.id']);
  });

  it('nenhum [env.*] nem [previews] reaproveita o KV ou o D1 de produção', () => {
    const producao = new Set(deProducao.map(i => i.valor));
    const copias = deAmbiente.filter(i => producao.has(i.valor)).map(i => `[${i.secao}] ${i.chave}`);
    expect(copias, 'ambiente apontando para dados de produção — crie KV/D1 próprios').toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// Prévia de PR (Worker Previews, v2.0)
// ---------------------------------------------------------------------------
// Uma prévia não herda nada de produção: binding que o código lê e que não
// está no bloco [previews] simplesmente não existe lá — e o Worker cai com
// erro 1101 na primeira requisição (documentação da Cloudflare). E a marca
// AMBIENTE = "previa" liga a camada de src/previa.js: em produção ela trocaria
// o Turnstile de verdade pelas chaves de teste. Por isso as duas checagens.
describe('bloco [previews] do wrangler.toml', () => {
  /** Linhas `chave = valor` por seção, na ordem em que aparecem. */
  function porSecao(texto) {
    /** @type {{ secao: string, linha: string }[]} */
    const out = [];
    let secao = '';
    for (const linha of texto.split('\n')) {
      if (/^\s*#/.test(linha) || !linha.trim()) continue;
      const cab = /^\s*\[\[?([^\]]+)\]\]?\s*(#.*)?$/.exec(linha);
      if (cab) { secao = cab[1].trim(); continue; }
      out.push({ secao, linha: linha.trim() });
    }
    return out;
  }
  const linhas = porSecao(TOML);
  const na = (/** @type {string} */ secao) => linhas.filter(l => l.secao === secao).map(l => l.linha);

  it('AMBIENTE = "previa" só existe em [previews.vars] — nunca no topo nem num [env.*]', () => {
    const marcas = linhas.filter(l => /^AMBIENTE\s*=/.test(l.linha));
    expect(marcas.map(l => `[${l.secao}] ${l.linha}`)).toEqual(['[previews.vars] AMBIENTE = "previa"']);
  });

  it('todo binding que o código lê está declarado para as prévias', () => {
    expect(na('previews.kv_namespaces')).toContain('binding = "FOTOS"');
    expect(na('previews.d1_databases')).toContain('binding = "CONSENT_DB"');
    const dos = na('previews.durable_objects.bindings').filter(l => l.startsWith('name ='));
    expect(dos.sort()).toEqual(['name = "COUNTER"', 'name = "RATELIMIT"']);
    expect(na('previews.version_metadata')).toContain('binding = "CF_VERSION_METADATA"');
  });
});
