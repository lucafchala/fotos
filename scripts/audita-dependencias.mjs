#!/usr/bin/env node
// Gate de dependências do CI (job "Dependências" do security.yml).
//
// Substitui o `npm audit --audit-level=high` puro, que reprovava TODO PR por um
// aviso sem conserto publicado (GHSA-fc5q-39xc-vjpf, picomatch <= 4.0.7, nov/2026)
// numa ferramenta de teste. Com o gate vermelho por semanas, a saída seria
// silenciá-lo, e um gate silenciado não protege ninguém. A regra agora separa
// o que importa:
//
//   1. O que VAI AO AR (dependências de produção, `npm audit --omit=dev`):
//      qualquer aviso de severidade moderada ou acima reprova. Hoje o site não
//      tem nenhuma; se alguém acrescentar, a régua é esta.
//   2. Ferramentas de DESENVOLVIMENTO (wrangler, vitest, eslint...), alta ou
//      crítica: reprova quando o advisory TEM versão corrigida publicada, porque
//      aí o conserto é atualizar. Sem versão corrigida, não há o que atualizar:
//      vira aviso no resumo do job. Quando o conserto sair, o mesmo aviso passa
//      a reprovar sozinho, sem ninguém lembrar de tirar exceção nenhuma.
//
// Não há lista de exceções. O "tem conserto?" vem da base de advisories do
// GitHub (`first_patched_version`), não do `fixAvailable` do npm: o npm chama
// de conserto até um rebaixamento de major (vitest 4 → 3.1.4), que não é.
// Se a consulta ao GitHub falhar, o advisory conta como "tem conserto" e
// reprova (falha fechada): melhor rodar de novo do que deixar passar.
//
// O que vai ao ar só sai de `src/` e `vendor/`; `tests/security.test.js` prende
// que `src/` não importa pacote do npm, então uma ferramenta de dev não entra
// no bundle por engano.

import { execFileSync } from 'node:child_process';
import { appendFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

const NIVEL = { info: 0, low: 1, moderate: 2, high: 3, critical: 4 };

/**
 * Os advisories de um relatório `npm audit --json`, um por GHSA e pacote.
 * @param {any} relatorio
 * @returns {{ ghsa: string, pacote: string, severidade: string, titulo: string, faixa: string }[]}
 */
export function advisoriesDoRelatorio(relatorio) {
  const vistos = new Map();
  for (const v of Object.values(relatorio?.vulnerabilities || {})) {
    for (const via of /** @type {any} */ (v).via || []) {
      if (!via || typeof via !== 'object') continue; // string = vem de outro pacote
      const ghsa = String(via.url || '').match(/GHSA(-[0-9a-z]{4}){3}/i)?.[0] || `npm-${via.source}`;
      const chave = `${ghsa}|${via.name}`;
      if (!vistos.has(chave)) {
        vistos.set(chave, { ghsa, pacote: via.name, severidade: via.severity, titulo: via.title, faixa: via.range });
      }
    }
  }
  return [...vistos.values()];
}

/**
 * Decide o que reprova e o que é só aviso.
 * @param {{ prod: any, todos: any, temConserto: (ghsa: string, pacote: string) => boolean }} a
 */
export function decide({ prod, todos, temConserto }) {
  const reprova = [];
  const avisos = [];
  const deProducao = new Set();
  for (const ad of advisoriesDoRelatorio(prod)) {
    deProducao.add(`${ad.ghsa}|${ad.pacote}`);
    if ((NIVEL[ad.severidade] ?? 4) >= NIVEL.moderate) reprova.push({ ...ad, motivo: 'vai ao ar' });
  }
  for (const ad of advisoriesDoRelatorio(todos)) {
    if (deProducao.has(`${ad.ghsa}|${ad.pacote}`)) continue;
    if ((NIVEL[ad.severidade] ?? 4) < NIVEL.high) continue;
    if (temConserto(ad.ghsa, ad.pacote)) reprova.push({ ...ad, motivo: 'tem versão corrigida: atualize' });
    else avisos.push({ ...ad, motivo: 'sem versão corrigida publicada' });
  }
  return { reprova, avisos };
}

/**
 * `first_patched_version` do advisory no GitHub, para o pacote. Falha = true.
 * @param {string} ghsa @param {string} pacote
 */
export function consultaConserto(ghsa, pacote) {
  if (!/^GHSA-/i.test(ghsa)) return true;
  try {
    const args = ['api', `/advisories/${ghsa}`];
    const json = JSON.parse(execFileSync('gh', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }));
    const doPacote = (json.vulnerabilities || []).filter((/** @type {any} */ v) => v?.package?.name === pacote);
    if (!doPacote.length) return true;
    return doPacote.some((/** @type {any} */ v) => !!v.first_patched_version);
  } catch {
    return true;
  }
}

/** @param {string[]} extra */
function audit(extra) {
  try {
    return JSON.parse(execFileSync('npm', ['audit', '--json', ...extra], { encoding: 'utf8', maxBuffer: 64 << 20 }));
  } catch (e) {
    // `npm audit` sai com 1 quando acha algo; o JSON vem no stdout mesmo assim.
    const out = /** @type {any} */ (e).stdout;
    if (out) return JSON.parse(out);
    throw e;
  }
}

/** @param {{ ghsa: string, pacote: string, severidade: string, titulo: string, faixa: string, motivo: string }} a */
const linha = (a) => `- **${a.pacote}** ${a.faixa} (${a.severidade}): ${a.titulo}. https://github.com/advisories/${a.ghsa} (${a.motivo})`;

function main() {
  const { reprova, avisos } = decide({ prod: audit(['--omit=dev']), todos: audit([]), temConserto: consultaConserto });
  const partes = ['## Dependências'];
  if (reprova.length) partes.push('', '**Reprovado:**', ...reprova.map(linha));
  if (avisos.length) {
    partes.push('', '**Avisos (ferramentas de desenvolvimento, sem versão corrigida; voltam a reprovar quando o conserto sair):**', ...avisos.map(linha));
  }
  if (!reprova.length && !avisos.length) partes.push('', 'Nenhum aviso.');
  const texto = partes.join('\n');
  console.log(texto);
  for (const a of avisos) console.log(`::warning title=Dependência sem conserto::${a.pacote} ${a.ghsa}: ${a.titulo}`);
  if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, texto + '\n');
  if (reprova.length) process.exit(1);
}

if (import.meta.url === pathToFileURL(process.argv[1] || '').href) main();
