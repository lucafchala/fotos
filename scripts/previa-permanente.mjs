// Publica a prévia permanente (preview.fotos.lucafchala.com e
// preview.entrenos2026.com) — o Worker `fotos-previa-permanente`.
//
// Roda no Cloudflare Workers Builds do Worker `fotos-previa-permanente`
// (deploy command: `npm run previa:permanente`), a cada push no branch
// `previa-permanente`. Os segredos PREVIA_* vêm das variáveis do build, como
// na prévia de PR. O workflow .github/workflows/previa-permanente.yml é só o
// caminho manual de reserva. Passos, em ordem, e qualquer falha para tudo:
//
//   1. Acha pelo nome, ou cria, o KV `fotos-previa-permanente`, o D1
//      `fotos-consent-previa-permanente` e o R2 `fotos-previa-permanente`. Os ids são da conta, não do
//      repositório, e por isso não ficam escritos em lugar nenhum.
//   2. RECUSA se algum id for o de produção (wrangler.toml, topo). É a mesma
//      regra de tests/wrangler-ambientes.test.js (#166), conferida aqui também
//      porque estes ids só existem na hora do deploy.
//   3. Escreve uma cópia de wrangler.previa-permanente.toml com os ids, na
//      raiz do repositório (os caminhos `main` e `migrations_dir` são relativos
//      a ela), e a apaga no fim, com sucesso ou não.
//   4. Aplica as migrações do D1 da prévia.
//   5. `wrangler deploy` com os segredos PREVIA_* do ambiente (a mesma lista e
//      as mesmas regras da prévia de PR, scripts/previa-publica.mjs). Só nomes
//      vão para o log; o arquivo de segredos fica numa pasta temporária 0600.
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { segredosDoBuild } from './previa-publica.mjs';

export const KV_NOME = 'fotos-previa-permanente';
export const D1_NOME = 'fotos-consent-previa-permanente';
export const R2_NOME = 'fotos-previa-permanente';
/** O bucket de produção (wrangler.toml): a prévia nunca grava nele. */
export const R2_DE_PRODUCAO = 'fotos-album';
const MODELO = 'wrangler.previa-permanente.toml';
const CONFIG = '.wrangler-previa-permanente.toml';

/**
 * Os ids de KV e D1 do topo do wrangler.toml — os de produção.
 * @param {string} toml
 */
export function idsDeProducao(toml) {
  const ids = new Set();
  let secao = '';
  for (const linha of toml.split('\n')) {
    const cab = /^\s*\[\[?([^\]]+)\]\]?/.exec(linha);
    if (cab) { secao = cab[1].trim(); continue; }
    if (secao.startsWith('env.') || secao.startsWith('previews')) continue;
    const id = /^\s*(id|database_id)\s*=\s*"([^"]+)"/.exec(linha);
    if (id) ids.add(id[2]);
  }
  return ids;
}

/**
 * O modelo com os ids, ou um erro se faltar marcador ou se o id for de produção.
 * @param {string} modelo @param {string} kv @param {string} d1 @param {Set<string>} producao
 */
export function configComIds(modelo, kv, d1, producao) {
  for (const [nome, id] of [['KV', kv], ['D1', d1]]) {
    if (!/^[0-9a-f-]{32,36}$/i.test(id)) throw new Error(`id de ${nome} inválido`);
    if (producao.has(id)) throw new Error(`o ${nome} da prévia permanente é o de PRODUÇÃO — recusado (#166)`);
  }
  // A linha inteira, não só o marcador: o comentário do modelo também o cita.
  const kvLinha = 'id = "__KV_ID__"';
  const d1Linha = 'database_id = "__D1_ID__"';
  if (!modelo.includes(kvLinha) || !modelo.includes(d1Linha)) throw new Error('marcadores ausentes no modelo');
  return modelo.replace(kvLinha, `id = "${kv}"`).replace(d1Linha, `database_id = "${d1}"`);
}

/** @param {string[]} args @param {{ silencioso?: boolean }} [o] */
function wrangler(args, o = {}) {
  const r = spawnSync('npx', ['wrangler', ...args], { encoding: 'utf8', stdio: o.silencioso ? 'pipe' : ['ignore', 'pipe', 'inherit'] });
  if (r.error) throw r.error;
  if (r.status !== 0) {
    if (o.silencioso) process.stderr.write(r.stderr || '');
    throw new Error(`wrangler ${args.slice(0, 3).join(' ')} saiu com ${r.status}`);
  }
  return r.stdout || '';
}

/** O primeiro array JSON da saída (o wrangler às vezes põe aviso antes). @param {string} s */
function jsonDaSaida(s) {
  const i = s.indexOf('[');
  if (i < 0) throw new Error('saída sem JSON');
  return JSON.parse(s.slice(i));
}

function kvId() {
  const acha = () => jsonDaSaida(wrangler(['kv', 'namespace', 'list'])).find((/** @type {any} */ n) => n.title === KV_NOME);
  let ns = acha();
  if (!ns) {
    console.log(`[prévia permanente] criando o KV ${KV_NOME}.`);
    wrangler(['kv', 'namespace', 'create', KV_NOME]);
    ns = acha();
  }
  if (!ns) throw new Error('KV não encontrado depois de criado');
  return String(ns.id);
}

function d1Id() {
  const acha = () => jsonDaSaida(wrangler(['d1', 'list', '--json'])).find((/** @type {any} */ d) => d.name === D1_NOME);
  let db = acha();
  if (!db) {
    console.log(`[prévia permanente] criando o D1 ${D1_NOME}.`);
    wrangler(['d1', 'create', D1_NOME]);
    db = acha();
  }
  if (!db) throw new Error('D1 não encontrado depois de criado');
  return String(db.uuid);
}

function garanteR2() {
  if (R2_NOME === R2_DE_PRODUCAO) throw new Error('o R2 da prévia permanente é o de PRODUÇÃO — recusado');
  const lista = wrangler(['r2', 'bucket', 'list']);
  if (new RegExp(`^name:\\s+${R2_NOME}\\s*$`, 'm').test(lista)) return;
  console.log(`[prévia permanente] criando o R2 ${R2_NOME}.`);
  wrangler(['r2', 'bucket', 'create', R2_NOME]);
}

function main() {
  garanteR2();
  const kv = kvId();
  const d1 = d1Id();
  const config = configComIds(readFileSync(MODELO, 'utf8'), kv, d1, idsDeProducao(readFileSync('wrangler.toml', 'utf8')));
  console.log('[prévia permanente] KV e D1 próprios conferidos (nenhum é o de produção).');

  const { segredos, gerados, ausentes } = segredosDoBuild(process.env);
  const doBuild = Object.keys(segredos).filter((n) => !gerados.includes(n));
  console.log(`[prévia permanente] segredos que vão junto: ${doBuild.join(', ') || 'nenhum'}.`);
  if (gerados.length) console.log(`[prévia permanente] gerados neste deploy: ${gerados.join(', ')}.`);
  if (ausentes.length) console.log(`[prévia permanente] sem valor (fica o que já houver): ${ausentes.join(', ')}.`);

  const pasta = mkdtempSync(join(tmpdir(), 'previa-permanente-'));
  const arquivo = join(pasta, 'segredos.json');
  try {
    writeFileSync(CONFIG, config);
    writeFileSync(arquivo, JSON.stringify(segredos), { mode: 0o600 });
    wrangler(['d1', 'migrations', 'apply', D1_NOME, '--remote', '-c', CONFIG]);
    const r = spawnSync('npx', ['wrangler', 'deploy', '-c', CONFIG, '--secrets-file', arquivo], { stdio: 'inherit' });
    if (r.error) throw r.error;
    return r.status ?? 1;
  } finally {
    rmSync(pasta, { recursive: true, force: true });
    rmSync(CONFIG, { force: true });
  }
}

if (process.argv[1] && process.argv[1].endsWith('previa-permanente.mjs')) {
  try {
    process.exitCode = main();
  } catch (e) {
    console.error(`::error::[prévia permanente] ${e instanceof Error ? e.message : e}`);
    process.exitCode = 1;
  }
}
