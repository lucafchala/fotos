// O deploy aplica os crons do wrangler.toml.
//
// O deploy.yml publica com `versions upload` + `versions deploy`, e nenhum dos
// dois aplica `[triggers] crons`: isso é configuração NÃO-versionada, que só
// `wrangler deploy` / `triggers deploy` escrevem (o mesmo caso do
// `preview_urls`, ver TODO.md, "O passo que garante o portão precisa garantir
// também o pré-requisito dele"). Resultado: o `*/5 * * * *` entrou no
// wrangler.toml em 18/10/2026 e nunca chegou à Cloudflare. O Worker seguiu só
// com o cron das 03:00, e tudo o que devia rodar a cada 5 minutos (batimento
// do Kuma, aquecimento do álbum, avisos, IndexNow, a pré-cópia para o R2 da
// 4.9.0) rodou uma vez por dia.
//
// Por que não `wrangler triggers deploy`: ele aplica TAMBÉM rotas,
// `workers_dev` e `preview_urls`, e o wrangler.toml não declara rotas nem
// `workers_dev` (os domínios foram ligados no painel). Mexer nisso a cada
// deploy é risco sem ganho. Aqui só os agendamentos mudam, pela API:
//   GET/PUT /accounts/{conta}/workers/scripts/{worker}/schedules
// e só quando o que está na Cloudflare difere do wrangler.toml. Depois do PUT,
// relê e confere; diferença ou erro da API reprovam o passo (o deploy já foi
// promovido, mas o vermelho avisa; os crons não podem divergir em silêncio).
//
// Uso (no deploy.yml): node scripts/aplica-crons.mjs
// Lê CLOUDFLARE_API_TOKEN, CLOUDFLARE_ACCOUNT_ID e WORKER_NAME do ambiente.

import { readFileSync, appendFileSync } from 'node:fs';

const API = 'https://api.cloudflare.com/client/v4';

/**
 * Os crons de `[triggers]` do topo do wrangler.toml (não os de um `[env.x]`).
 * O array de strings entre aspas duplas do TOML é JSON válido.
 * @param {string} toml
 * @returns {string[]}
 */
export function cronsDoToml(toml) {
  let secao = '';
  for (const linha of toml.split('\n')) {
    const t = linha.trim();
    const cab = /^\[+([^\]]+)\]+$/.exec(t);
    if (cab) { secao = cab[1].trim(); continue; }
    if (secao !== 'triggers') continue;
    const m = /^crons\s*=\s*(\[.*\])\s*(#.*)?$/.exec(t);
    if (!m) continue;
    const lista = JSON.parse(m[1]);
    if (!Array.isArray(lista) || !lista.every(c => typeof c === 'string' && c.trim())) {
      throw new Error(`crons inválidos no wrangler.toml: ${m[1]}`);
    }
    return lista.map(c => c.trim());
  }
  throw new Error('wrangler.toml sem `crons` em [triggers]');
}

/**
 * Os crons de uma resposta da API (`result.schedules[].cron`, ou um array).
 * @param {any} corpo
 * @returns {string[]}
 */
export function cronsDaApi(corpo) {
  const r = corpo && corpo.result;
  const lista = Array.isArray(r) ? r : (r && Array.isArray(r.schedules) ? r.schedules : null);
  if (!lista) throw new Error('resposta da API sem a lista de agendamentos');
  return lista.map(s => String(s && s.cron || '').trim()).filter(Boolean);
}

/**
 * Mesmo conjunto, ignorando ordem e repetição.
 * @param {string[]} a
 * @param {string[]} b
 */
export function mesmosCrons(a, b) {
  const x = [...new Set(a)].sort();
  const y = [...new Set(b)].sort();
  return x.length === y.length && x.every((c, i) => c === y[i]);
}

/**
 * Confere e, se preciso, aplica. `fetchFn` para os testes.
 * @param {{ conta: string, worker: string, token: string, desejados: string[], fetchFn?: typeof fetch, api?: string }} op
 * @returns {Promise<{ antes: string[], depois: string[], mudou: boolean }>}
 */
export async function aplicaCrons({ conta, worker, token, desejados, fetchFn = fetch, api = API }) {
  const url = `${api}/accounts/${encodeURIComponent(conta)}/workers/scripts/${encodeURIComponent(worker)}/schedules`;
  const cab = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };
  /** @param {Response} r */
  const le = async r => {
    const corpo = await r.json().catch(() => null);
    if (!r.ok || !corpo || corpo.success === false) {
      const erros = corpo && Array.isArray(corpo.errors) ? corpo.errors.map((/** @type {any} */ e) => `${e.code}: ${e.message}`).join('; ') : '';
      throw new Error(`API da Cloudflare respondeu ${r.status}${erros ? ` (${erros})` : ''}`);
    }
    return cronsDaApi(corpo);
  };
  const antes = await le(await fetchFn(url, { headers: cab }));
  if (mesmosCrons(antes, desejados)) return { antes, depois: antes, mudou: false };
  await le(await fetchFn(url, { method: 'PUT', headers: cab, body: JSON.stringify(desejados.map(cron => ({ cron }))) }));
  const depois = await le(await fetchFn(url, { headers: cab }));
  if (!mesmosCrons(depois, desejados)) {
    throw new Error(`depois do PUT a Cloudflare tem ${JSON.stringify(depois)}, e o wrangler.toml pede ${JSON.stringify(desejados)}`);
  }
  return { antes, depois, mudou: true };
}

// `import.meta.main` não existe em todo Node 22; comparar os caminhos, sim.
if (process.argv[1] && process.argv[1].endsWith('aplica-crons.mjs')) {
  const { CLOUDFLARE_API_TOKEN: token, CLOUDFLARE_ACCOUNT_ID: conta, WORKER_NAME: worker, GITHUB_STEP_SUMMARY: resumo } = process.env;
  const fala = (/** @type {string} */ s) => { console.log(s); if (resumo) appendFileSync(resumo, `${s}\n`); };
  try {
    if (!token || !conta || !worker) throw new Error('faltam CLOUDFLARE_API_TOKEN, CLOUDFLARE_ACCOUNT_ID ou WORKER_NAME');
    const desejados = cronsDoToml(readFileSync('wrangler.toml', 'utf8'));
    const r = await aplicaCrons({ conta, worker, token, desejados });
    fala(r.mudou
      ? `Crons do Worker atualizados: ${JSON.stringify(r.antes)} → ${JSON.stringify(r.depois)}`
      : `Crons do Worker já batem com o wrangler.toml: ${JSON.stringify(r.antes)}`);
  } catch (e) {
    console.log(`::error::Crons do Worker: ${e instanceof Error ? e.message : String(e)}`);
    process.exit(1);
  }
}
