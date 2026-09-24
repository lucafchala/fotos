// Um push publica uma vez só (#186) — scripts/deploy-duplicado.mjs.
//
// O que precisa estar certo não é só "pula a duplicata". É também NUNCA pular
// o deploy legítimo: um filtro que a API ignore, uma resposta estranha ou uma
// API fora do ar não podem travar todo deploy da `main`. Por isso o script roda
// de verdade aqui, contra uma API falsa, e o workflow é conferido contra ele.

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createServer } from 'node:http';
import { mkdtempSync, readFileSync, existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawn } from 'node:child_process';
import { execPath, env as ambienteDoTeste } from 'node:process';
import { fileURLToPath } from 'node:url';
import { execucaoAnterior, WORKFLOW } from '../scripts/deploy-duplicado.mjs';

const SHA = '5c08675364ae571554db2aacef2558dab75e8897';
const OUTRO_SHA = '45338c5f1672d7fa9c33defd99b9423ebf6784ae';
/** @param {number} id @param {Record<string, unknown>} [extra] */
const run = (id, extra = {}) => ({
  id, run_number: id - 35980000000, head_sha: SHA, event: 'push', status: 'completed', conclusion: 'success',
  html_url: `https://github.com/lucafchala/fotos/actions/runs/${id}`, ...extra,
});

describe('execucaoAnterior', () => {
  it('a única execução do commit segue', () => {
    expect(execucaoAnterior({ workflow_runs: [run(35980286623)] }, 35980286623, SHA)).toBeNull();
  });

  it('a duplicata vê a execução mais antiga do mesmo commit — o caso 165/166', () => {
    const resposta = { workflow_runs: [run(35980385185), run(35980286623)] };
    expect(execucaoAnterior(resposta, 35980385185, SHA)?.id).toBe(35980286623);
    // …e a mais antiga, que se enxerga junto com a duplicata, segue: a
    // decisão não depende de quem consultou primeiro.
    expect(execucaoAnterior(resposta, 35980286623, SHA)).toBeNull();
  });

  it('de várias anteriores, aponta a mais antiga (a que publicou)', () => {
    const resposta = { workflow_runs: [run(30), run(10), run(20), run(40)] };
    expect(execucaoAnterior(resposta, 40, SHA)?.id).toBe(10);
  });

  it('o status da anterior não importa: reprovada ou cancelada também segura', () => {
    expect(execucaoAnterior({ workflow_runs: [run(10, { conclusion: 'failure' }), run(20)] }, 20, SHA)?.id).toBe(10);
    expect(execucaoAnterior({ workflow_runs: [run(10, { conclusion: 'cancelled' }), run(20)] }, 20, SHA)?.id).toBe(10);
  });

  it('execuções de OUTRO commit ou de outro evento não seguram nada — se a API ignorar o filtro, o deploy não trava', () => {
    const resposta = { workflow_runs: [
      run(10, { head_sha: OUTRO_SHA }),
      run(11, { event: 'workflow_dispatch' }),
      run(20),
    ] };
    expect(execucaoAnterior(resposta, 20, SHA)).toBeNull();
  });

  it.each([
    ['sem workflow_runs', {}],
    ['nulo', null],
    ['workflow_runs que não é lista', { workflow_runs: 'x' }],
  ])('resposta estranha (%s) é erro, não "segue" calado', (_nome, resposta) => {
    expect(() => execucaoAnterior(resposta, 20, SHA)).toThrow();
  });

  it('id de execução que não é número é erro', () => {
    expect(() => execucaoAnterior({ workflow_runs: [] }, Number('abc'), SHA)).toThrow(/id de execução/);
  });
});

// ---------------------------------------------------------------------------
// O script inteiro, contra uma API falsa
// ---------------------------------------------------------------------------
const SCRIPT = fileURLToPath(new URL('../scripts/deploy-duplicado.mjs', import.meta.url));

/** @type {{ status: number, corpo: unknown }} */
let proximaResposta = { status: 200, corpo: { workflow_runs: [] } };
/** @type {string[]} */
let pedidos = [];
/** @type {import('node:http').Server} */
let servidor;
/** @type {string} */
let api;
/** @type {string} */
let dir;

beforeAll(async () => {
  dir = mkdtempSync(join(tmpdir(), 'deploy-duplicado-'));
  servidor = createServer((req, res) => {
    pedidos.push(`${req.url} ${req.headers.authorization}`);
    res.writeHead(proximaResposta.status, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(proximaResposta.corpo));
  });
  await new Promise(ok => servidor.listen(0, '127.0.0.1', () => ok(undefined)));
  const endereco = /** @type {import('node:net').AddressInfo} */ (servidor.address());
  api = `http://127.0.0.1:${endereco.port}`;
});

afterAll(async () => {
  await new Promise(ok => servidor.close(() => ok(undefined)));
  rmSync(dir, { recursive: true, force: true });
});

/**
 * Roda o script como o Actions roda, e devolve o que ele escreveu.
 * @param {Record<string, string>} ambiente
 */
async function roda(ambiente) {
  pedidos = [];
  const saida = join(dir, `saida-${Math.random()}`);
  const resumo = join(dir, `resumo-${Math.random()}`);
  const filho = spawn(execPath, [SCRIPT], {
    env: {
      PATH: ambienteDoTeste.PATH ?? '',
      GITHUB_EVENT_NAME: 'push', GITHUB_SHA: SHA, GITHUB_RUN_ID: '35980385185',
      GITHUB_REPOSITORY: 'lucafchala/fotos', GITHUB_API_URL: api, GH_TOKEN: 'tok-teste',
      GITHUB_OUTPUT: saida, GITHUB_STEP_SUMMARY: resumo,
      ...ambiente,
    },
  });
  let log = '';
  filho.stdout.on('data', d => { log += d; });
  filho.stderr.on('data', d => { log += d; });
  const codigo = await new Promise(ok => filho.on('close', ok));
  const ler = (/** @type {string} */ f) => (existsSync(f) ? readFileSync(f, 'utf8') : '');
  return { codigo, log, saida: ler(saida), resumo: ler(resumo) };
}

describe('scripts/deploy-duplicado.mjs de ponta a ponta', () => {
  it('push repetido: pula, avisa no resumo e aponta a execução que publicou', async () => {
    proximaResposta = { status: 200, corpo: { workflow_runs: [run(35980385185), run(35980286623)] } };
    const r = await roda({});
    expect(r.codigo).toBe(0);
    expect(r.saida).toBe('pular=true\n');
    expect(r.resumo).toContain('Deploy pulado');
    expect(r.resumo).toContain('#286623');
    expect(r.log).toContain('::notice::');
    // A consulta pede o commit e o evento, e leva o token.
    expect(pedidos).toEqual([`/repos/lucafchala/fotos/actions/workflows/${WORKFLOW}/runs?head_sha=${SHA}&event=push&per_page=100 Bearer tok-teste`]);
  });

  it('primeiro push do commit: segue, sem resumo', async () => {
    proximaResposta = { status: 200, corpo: { workflow_runs: [run(35980385185)] } };
    const r = await roda({});
    expect([r.codigo, r.saida, r.resumo]).toEqual([0, 'pular=false\n', '']);
  });

  it('disparo manual: segue sem nem consultar a API — republicar à mão é de propósito', async () => {
    proximaResposta = { status: 200, corpo: { workflow_runs: [run(1)] } };
    const r = await roda({ GITHUB_EVENT_NAME: 'workflow_dispatch' });
    expect([r.codigo, r.saida]).toEqual([0, 'pular=false\n']);
    expect(pedidos).toEqual([]);
  });

  it.each([
    ['API fora (500)', { status: 500, corpo: { message: 'oops' } }],
    ['sem permissão (403)', { status: 403, corpo: { message: 'Resource not accessible by integration' } }],
    ['resposta estranha', { status: 200, corpo: { total_count: 0 } }],
  ])('%s: segue, com aviso no log e no resumo — nunca calado', async (_nome, resposta) => {
    proximaResposta = resposta;
    const r = await roda({});
    expect([r.codigo, r.saida]).toEqual([0, 'pular=false\n']);
    expect(r.log).toContain('::warning::');
    expect(r.resumo).toContain('o deploy seguiu');
  });

  it('SHA que não é de commit não vira parte da URL: segue, com aviso', async () => {
    const r = await roda({ GITHUB_SHA: 'abc&event=pull_request' });
    expect([r.codigo, r.saida]).toEqual([0, 'pular=false\n']);
    expect(r.log).toContain('GITHUB_SHA inválido');
    expect(pedidos).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// O workflow usa o script do jeito que ele foi escrito para ser usado
// ---------------------------------------------------------------------------
describe('deploy.yml e a conferência de push repetido', () => {
  const yml = readFileSync(new URL('../.github/workflows/deploy.yml', import.meta.url), 'utf8');
  const job = (/** @type {string} */ id) => {
    const m = yml.match(new RegExp(`^ {2}${id}:\\n([\\s\\S]*?)(?=^ {2}[\\w-]+:\\n|(?![\\s\\S]))`, 'm'));
    if (!m) throw new Error(`job ${id} sumiu do deploy.yml`);
    return m[1];
  };

  it('o arquivo que o script consulta é este workflow', () => {
    expect(existsSync(new URL(`../.github/workflows/${WORKFLOW}`, import.meta.url))).toBe(true);
  });

  it('o job de conferência roda o script, com permissão só de leitura, e publica a decisão', () => {
    const j = job('duplicado');
    expect(j).toContain('run: node scripts/deploy-duplicado.mjs');
    expect(j).toMatch(/permissions:\n\s+contents: read.*\n\s+actions: read/);
    expect(j).toContain('pular: ${{ steps.confere.outputs.pular }}');
    expect(j).toMatch(/id: confere/);
  });

  it('o deploy depende da conferência, só para com pular=true e segue se ela quebrar', () => {
    const j = job('deploy');
    expect(j).toMatch(/^ {4}needs: duplicado$/m);
    expect(j).toMatch(/^ {4}if: \$\{\{ !cancelled\(\) && needs\.duplicado\.outputs\.pular != 'true' \}\}$/m);
  });
});
