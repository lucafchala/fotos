// Um push publica uma vez só (#186).
//
// Em 24/09, o merge do #184 gerou DUAS execuções do Deploy com evento `push`
// para o mesmo commit (165 e 166): o GitHub entregou o evento duas vezes. A
// `concurrency` do workflow segurou a segunda até a primeira terminar, e ela
// publicou de novo o mesmo código — versão nova, smoke, uma segunda tag e uma
// segunda release. Foi inofensivo porque a primeira passou. Se a primeira
// tivesse REPROVADO e revertido, a segunda publicaria o commit ruim outra vez:
// o smoke roda depois da promoção (#179), então seriam mais alguns segundos de
// clientes na versão ruim, até a segunda reversão.
//
// A regra: num `push`, se já existe OUTRA execução deste workflow para este
// mesmo commit, criada antes desta (id menor), esta não publica. A mais antiga
// é a que publica, então a decisão é a mesma mesmo que as duas se enxerguem. O
// status da anterior não importa: se ela reprovou e reverteu, republicar é
// justamente o que não se quer; se alguém a cancelou, foi de propósito. Para
// publicar de novo, o `workflow_dispatch` — que não passa por aqui.
//
// A tag `deploy-*-<sha>` NÃO serve de marca: ela só nasce depois de o smoke de
// produção passar, então faltaria justamente no caso ruim.
//
// Se a API não responder, publica, com aviso no log e no resumo. Travar todo
// deploy porque a listagem falhou trocaria um problema raro por um comum.
//
// Uso (no deploy.yml): node scripts/deploy-duplicado.mjs
// Lê o ambiente do Actions e escreve `pular=true|false` no $GITHUB_OUTPUT.

import { appendFileSync } from 'node:fs';

/** O arquivo do workflow cujas execuções são listadas. */
export const WORKFLOW = 'deploy.yml';

/**
 * A execução mais antiga do mesmo commit por `push`, fora esta; `null` se esta
 * é a primeira.
 *
 * Filtra por commit e evento de novo, mesmo a URL já pedindo os dois: se a API
 * um dia ignorar o filtro, toda execução mais antiga do repositório pareceria
 * "anterior" e NENHUM deploy rodaria mais.
 *
 * @param {unknown} resposta  corpo de GET …/actions/workflows/{arquivo}/runs
 * @param {number} estaExecucao  o GITHUB_RUN_ID desta execução
 * @param {string} sha  o commit desta execução
 * @returns {{ id: number, run_number: number, status?: string, conclusion?: string | null, html_url?: string } | null}
 */
export function execucaoAnterior(resposta, estaExecucao, sha) {
  const runs = /** @type {{ workflow_runs?: unknown }} */ (resposta ?? {}).workflow_runs;
  if (!Array.isArray(runs)) throw new Error('resposta da API sem workflow_runs');
  if (!Number.isSafeInteger(estaExecucao)) throw new Error(`id de execução inválido: ${estaExecucao}`);
  const anteriores = runs.filter(r =>
    r && Number.isSafeInteger(r.id) && r.id < estaExecucao && r.head_sha === sha && r.event === 'push');
  if (!anteriores.length) return null;
  return anteriores.reduce((a, b) => (b.id < a.id ? b : a));
}

async function main() {
  const env = process.env;
  const evento = env.GITHUB_EVENT_NAME ?? '';
  const sha = env.GITHUB_SHA ?? '';
  /** @param {string | undefined} arquivo @param {string} texto */
  const acrescenta = (arquivo, texto) => { if (arquivo) appendFileSync(arquivo, texto + '\n'); };
  /** @param {boolean} pular */
  const decide = pular => acrescenta(env.GITHUB_OUTPUT, `pular=${pular}`);

  if (evento !== 'push') {
    console.log(`Disparo "${evento}": publica sem conferir — republicar à mão é de propósito.`);
    decide(false);
    return;
  }

  let anterior;
  try {
    if (!/^[0-9a-f]{40}$/.test(sha)) throw new Error(`GITHUB_SHA inválido: "${sha}"`);
    const api = env.GITHUB_API_URL || 'https://api.github.com';
    const url = `${api}/repos/${env.GITHUB_REPOSITORY}/actions/workflows/${WORKFLOW}/runs?head_sha=${sha}&event=push&per_page=100`;
    const res = await fetch(url, {
      headers: {
        Authorization: `Bearer ${env.GH_TOKEN ?? ''}`,
        Accept: 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2022-11-28',
      },
    });
    if (!res.ok) throw new Error(`a API respondeu HTTP ${res.status}`);
    anterior = execucaoAnterior(await res.json(), Number(env.GITHUB_RUN_ID), sha);
  } catch (e) {
    const motivo = e instanceof Error ? e.message : String(e);
    console.log(`::warning::Não deu para conferir se o commit já foi publicado (${motivo}). O deploy segue.`);
    acrescenta(env.GITHUB_STEP_SUMMARY, `> ⚠️ Não deu para conferir execuções anteriores deste commit (${motivo}); o deploy seguiu (#186).`);
    decide(false);
    return;
  }

  if (!anterior) {
    console.log(`Primeira execução para ${sha.slice(0, 7)}: o deploy segue.`);
    decide(false);
    return;
  }
  const estado = [anterior.status, anterior.conclusion].filter(Boolean).join(' / ');
  console.log(`::notice::O commit ${sha.slice(0, 7)} já teve a execução #${anterior.run_number} deste workflow (${estado}). Este deploy não roda de novo (#186).`);
  acrescenta(env.GITHUB_STEP_SUMMARY, [
    '## Deploy pulado: este commit já foi publicado',
    '',
    `O commit \`${sha.slice(0, 7)}\` já teve a execução [#${anterior.run_number}](${anterior.html_url ?? ''}) deste workflow (${estado}).`,
    'Um push publica uma vez só (#186): esta execução veio de um evento de push repetido.',
    '',
    'Para publicar este commit de novo de propósito: **Actions → Deploy → Run workflow**.',
  ].join('\n'));
  decide(true);
}

// `import.meta.main` não existe em todo Node 22; comparar os caminhos, sim.
if (process.argv[1] && process.argv[1].endsWith('deploy-duplicado.mjs')) {
  await main();
}
