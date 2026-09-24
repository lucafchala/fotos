// Configuração do repositório que o GitHub lê por NOME, sem validar nada.
//
// A proteção da `main` (docs/BRANCHES.md) exige checks pelo nome do job. Se um
// job for renomeado, ou o workflow dele deixar de rodar em `pull_request`, o
// check exigido nunca chega e TODO merge trava — sem erro em lugar nenhum, só
// um "Expected — Waiting for status" eterno na página do PR. O mesmo vale para
// o grupo do Dependabot: um pacote da família do vitest fora do grupo volta a
// abrir PR sozinho, e PR sozinho dessa família quebra o `npm ci` (#156, #158).

import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';

const raiz = (/** @type {string} */ p) => new URL('../' + p, import.meta.url);
const ler = (/** @type {string} */ p) => readFileSync(raiz(p), 'utf8');

const RULESET = JSON.parse(ler('.github/rulesets/main-protegida.json'));
/** @param {string} tipo */
const regra = tipo => RULESET.rules.find((/** @type {{type: string}} */ r) => r.type === tipo);

// Leitor mínimo de workflow: só o que decide se um check chega a um PR — os
// gatilhos do `on:` e o nome publicado de cada job (`name:` do job ou, sem ele,
// o id). Não é um parser de YAML; é justo o formato destes arquivos, e o
// autoteste abaixo reprova se ele deixar de enxergá-lo.
/** @param {string} texto */
function lerWorkflow(texto) {
  const gatilhos = new Set();
  /** @type {Map<string, string>} */
  const jobs = new Map();
  let secao = '';
  let job = '';
  for (const linha of texto.split('\n')) {
    if (/^\s*(#|$)/.test(linha)) continue;
    const topo = /^([A-Za-z_]+):\s*(.*)$/.exec(linha);
    if (topo) {
      secao = topo[1];
      if (secao === 'on' && topo[2]) {
        for (const g of topo[2].replace(/[[\]]/g, '').split(',')) gatilhos.add(g.trim());
      }
      continue;
    }
    if (secao === 'on') {
      const g = /^ {2}([a-z_]+):/.exec(linha);
      if (g) gatilhos.add(g[1]);
    } else if (secao === 'jobs') {
      const id = /^ {2}([\w-]+):\s*$/.exec(linha);
      if (id) { job = id[1]; jobs.set(job, job); continue; }
      const nome = /^ {4}name:\s*(.+?)\s*$/.exec(linha);
      if (nome && job) jobs.set(job, nome[1].replace(/^(['"])(.*)\1$/, '$2'));
    }
  }
  return { gatilhos, checks: [...jobs.values()] };
}

const WORKFLOWS = readdirSync(raiz('.github/workflows')).filter(f => /\.ya?ml$/.test(f))
  .map(f => ({ arquivo: f, ...lerWorkflow(ler(`.github/workflows/${f}`)) }));

describe('proteção da main (.github/rulesets/main-protegida.json)', () => {
  it('o leitor de workflow enxerga gatilhos e nomes de job', () => {
    const w = lerWorkflow([
      'name: exemplo', 'on:', '  push:', '    branches: [main]', '  pull_request:', '',
      'jobs:', '  sem-nome:', '    runs-on: x', '    steps:', '      - name: passo, não job',
      '  com-nome:', "    name: 'Nome do Job'", '    runs-on: x',
    ].join('\n'));
    expect([...w.gatilhos]).toEqual(['push', 'pull_request']);
    expect(w.checks).toEqual(['sem-nome', 'Nome do Job']);
    expect([...lerWorkflow('on: [push, pull_request]\njobs:\n  a:\n').gatilhos]).toEqual(['push', 'pull_request']);
  });

  it.each(regra('required_status_checks').parameters.required_status_checks.map((/** @type {{context: string}} */ c) => c.context))(
    'o check exigido "%s" é publicado por um workflow que roda em pull_request',
    contexto => {
      const donos = WORKFLOWS.filter(w => w.checks.includes(contexto));
      expect(donos.map(w => w.arquivo), `nenhum job se chama "${contexto}" — renomeou? atualize o JSON e reimporte`).not.toEqual([]);
      expect(donos.some(w => w.gatilhos.has('pull_request')), `"${contexto}" não roda em PR: o check nunca chegaria`).toBe(true);
    },
  );

  it('protege a main de verdade: sem apagar, sem force-push, só por PR', () => {
    expect(RULESET.target).toBe('branch');
    expect(RULESET.enforcement).toBe('active');
    expect(RULESET.conditions.ref_name.include).toEqual(['~DEFAULT_BRANCH']);
    expect(regra('deletion')).toBeTruthy();
    expect(regra('non_fast_forward')).toBeTruthy();
    expect(regra('pull_request')).toBeTruthy();
    // Exceção só DENTRO de PR (emergência com CI fora do ar), nunca push direto.
    expect(RULESET.bypass_actors.every((/** @type {{bypass_mode: string}} */ b) => b.bypass_mode === 'pull_request')).toBe(true);
  });

  it('o método de merge exigido é o que o llms.md documenta', () => {
    expect(regra('pull_request').parameters.allowed_merge_methods).toEqual(['merge']);
    expect(ler('llms.md')).toMatch(/merge_method:\s*"merge"/);
  });
});

describe('Dependabot (.github/dependabot.yml)', () => {
  // Os padrões do grupo `vitest`, lidos do próprio arquivo.
  const yml = ler('.github/dependabot.yml');
  const bloco = /^ {6}vitest:\n {8}patterns:\n((?: {10}- .+\n)+)/m.exec(yml);
  const padroes = bloco ? [...bloco[1].matchAll(/- "([^"]+)"/g)].map(m => m[1]) : [];
  /** @param {string} pacote */
  const noGrupo = pacote => padroes.some(p => p.endsWith('/*') ? pacote.startsWith(p.slice(0, -1)) : p === pacote);

  it('o grupo existe e foi lido', () => {
    expect(padroes.length).toBeGreaterThan(0);
  });

  it('todo pacote da família do vitest no package.json sobe junto, no mesmo grupo', () => {
    const { devDependencies } = JSON.parse(ler('package.json'));
    const familia = Object.keys(devDependencies).filter(p => /vitest/.test(p));
    expect(familia.length).toBeGreaterThan(0);
    expect(familia.filter(p => !noGrupo(p)), 'fora do grupo: abriria PR sozinho e quebraria o npm ci').toEqual([]);
  });
});
