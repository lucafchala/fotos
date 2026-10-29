// Acessibilidade automática (axe-core) para os roteiros de navegador.
//
// O axe-core é dependência SÓ DE DESENVOLVIMENTO: lido de node_modules por este
// arquivo e injetado na página que o Chromium do roteiro abriu. Nada disto vai
// para src/, para o bundle do Worker nem para o navegador de quem visita o site
// ("sem bibliotecas de terceiros" vale para o que o SITE entrega).
//
// Como injeta, com a CSP estrita no ar: `page.addScriptTag({ content })` cria
// um <script> inline sem nonce — a política BARRA (é exatamente o que o vigia de
// scripts/vigia-csp.mjs existe para provar). Em vez de relaxar a CSP do
// contexto (bypassCSP deixaria o vigia cego para a própria página), o código do
// axe entra por `page.evaluate`, que roda via CDP (Runtime.evaluate) e não é
// um carregamento de recurso da página: a CSP do app segue valendo, intacta,
// e qualquer violação que o app cometa continua aparecendo no vigia.
//
// Limite honesto: o axe acha só uma parte dos problemas de WCAG (a conta
// costuma ser citada em ~30-40%). Verde aqui NÃO é "acessível": é "nenhum dos
// defeitos que uma máquina enxerga", sem leitor de tela real.

/* global window, document */
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';

const exigir = createRequire(import.meta.url);
const CODIGO_DO_AXE = readFileSync(exigir.resolve('axe-core/axe.min.js'), 'utf8');

/** Conformidade WCAG 2.0/2.1 A e AA. `best-practice` fica de fora de propósito. */
export const TAGS_DO_AXE = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'];

/**
 * @typedef {{ regra: string, seletor: string, motivo: string }} IgnoradoDoAxe
 *   Uma exceção ESTREITA: uma regra, num seletor (o alvo exato que o axe
 *   reporta), com o motivo por escrito. Não existe "desligar a regra".
 */

/**
 * @typedef {{ id: string, impacto: string, seletores: string[], total: number, msg: string }} ViolacaoDoAxe
 */

/**
 * Roda o axe na página (como está agora: aberta, com o lightbox aberto, no
 * tema escuro...) e registra UM check: ok quando não há violação. Em caso de
 * falha, o detalhe lista cada regra com impacto e os 3 primeiros seletores.
 *
 * @param {import('playwright-core').Page} page
 * @param {(ok: boolean, nome: string, detalhe?: unknown) => void} registra
 * @param {string} nome o que está sendo olhado ("galeria: grade (claro)")
 * @param {{ ignorar?: IgnoradoDoAxe[], contexto?: string }} [opcoes]
 *   `contexto`: seletor CSS para restringir a análise (ex.: só o lightbox).
 * @returns {Promise<ViolacaoDoAxe[]>}
 */
export async function verificaAxe(page, registra, nome, opcoes = {}) {
  const ignorar = opcoes.ignorar || [];
  const injetado = await page.evaluate(() => typeof (/** @type {any} */ (window)).axe !== 'undefined');
  if (!injetado) await page.evaluate(CODIGO_DO_AXE);
  const bruto = await page.evaluate(async ({ tags, contexto }) => {
    const axe = /** @type {any} */ (window).axe;
    const alvo = contexto ? (document.querySelector(contexto) || document) : document;
    const r = await axe.run(alvo, { runOnly: { type: 'tag', values: tags }, resultTypes: ['violations'] });
    return /** @type {{ id: string, impact: string | null, nodes: { target: unknown[], any: { message?: string }[], all: { message?: string }[], none: { message?: string }[] }[] }[]} */ (r.violations)
      .map(v => ({
        id: v.id,
        impacto: v.impact || 'desconhecido',
        nos: v.nodes.map(n => n.target.map(String).join(' >> ')),
        // A mensagem do primeiro nó (no contraste traz as cores e a razão medida).
        msg: String((v.nodes[0].any[0] || v.nodes[0].all[0] || v.nodes[0].none[0] || {}).message || '').slice(0, 220),
      }));
  }, { tags: TAGS_DO_AXE, contexto: opcoes.contexto || '' });

  /** @type {ViolacaoDoAxe[]} */
  const violacoes = [];
  for (const v of bruto) {
    const nos = v.nos.filter(sel => !ignorar.some(i => i.regra === v.id && i.seletor === sel));
    if (nos.length) violacoes.push({ id: v.id, impacto: v.impacto, seletores: nos.slice(0, 3), total: nos.length, msg: v.msg });
  }
  registra(violacoes.length === 0, `axe (WCAG A/AA): ${nome}`,
    violacoes.map(v => `${v.id} [${v.impacto}] x${v.total}: ${v.seletores.join(' | ')} (${v.msg})`).join(' ;; '));
  return violacoes;
}
