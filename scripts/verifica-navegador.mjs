#!/usr/bin/env node
// Roteiro de navegador de verdade (parte local do #135).
//
// `npm test` prova que as funções fazem o que as funções fazem; já conviveu com
// a interface inteira quebrada (CSP matando handlers, galeria ilegível sem JS —
// docs/VERIFICACAO.md). Este roteiro abre o site num Chromium de verdade e
// confere o que só um navegador enxerga. Ele NÃO semeia dados: rode contra um
// `wrangler dev` com projetos no KV local (VERIFICACAO §1–2).
//
//   npm run verifica:navegador                 # contra http://127.0.0.1:8787
//   npm run verifica:navegador -- <url-base>
//
// Chromium: CHROMIUM_PATH, ou o que estiver em PLAYWRIGHT_BROWSERS_PATH
// (/opt/pw-browsers nas sessões do Claude Code), ou o baixado por
// `npx playwright-core install chromium`.
//
// Sai com 1 se alguma checagem falhar, e só no fim — uma falha não esconde as
// outras (a mesma lição do smoke.sh).

import { existsSync, readdirSync } from 'node:fs';
import { chromium } from 'playwright-core';

// `document` só aparece dentro dos callbacks de `page.evaluate`, que o
// Playwright serializa e executa NO NAVEGADOR — não no Node deste script.
/* global document */

const BASE = (process.argv[2] || 'http://127.0.0.1:8787').replace(/\/+$/, '');
const SITE = 'https://fotos.lucafchala.com';

/** @type {{ ok: boolean, nome: string, detalhe: string }[]} */
const resultados = [];
/** @param {boolean} ok @param {string} nome @param {string} [detalhe] */
const registra = (ok, nome, detalhe = '') => resultados.push({ ok, nome, detalhe });

function chromiumLocal() {
  if (process.env.CHROMIUM_PATH) return process.env.CHROMIUM_PATH;
  const base = process.env.PLAYWRIGHT_BROWSERS_PATH || '/opt/pw-browsers';
  if (!existsSync(base)) return undefined;
  const dir = readdirSync(base).filter(d => /^chromium-\d+$/.test(d)).sort().pop();
  const exe = dir && `${base}/${dir}/chrome-linux/chrome`;
  return exe && existsSync(exe) ? exe : undefined;
}

// As páginas vêm do sitemap do próprio site: o roteiro acompanha os projetos
// semeados em vez de manter uma lista que envelhece. Mais o que o sitemap não
// lista de propósito (login do painel, suporte já está lá).
async function paginas() {
  const xml = await (await fetch(`${BASE}/sitemap.xml`)).text();
  const locs = [...xml.matchAll(/<loc>([^<]+)<\/loc>/g)].map(m => {
    const u = new URL(m[1]);
    return u.origin === SITE ? u.pathname : null;
  }).filter(p => p !== null);
  return [...new Set([...locs, '/dashboard'])];
}

/** Chromium com os vigias que valem para toda página. */
async function abre(/** @type {import('playwright-core').Browser} */ browser, opcoes = {}) {
  const ctx = await browser.newContext(opcoes);
  const page = await ctx.newPage();
  /** @type {string[]} */
  const erros = [];
  page.on('pageerror', e => erros.push(`pageerror: ${e.message}`));
  page.on('console', m => {
    const t = m.text();
    // Report-Only é ruído esperado: a política estrita existe para relatar.
    if (m.type() === 'error' && /Content Security Policy/i.test(t) && !/Report Only/i.test(t)) {
      erros.push(`CSP aplicada: ${t.slice(0, 160)}`);
    }
  });
  return { ctx, page, erros };
}

const browser = await chromium.launch({ executablePath: chromiumLocal() });

// 1. Toda página: responde, não lança, não viola a CSP aplicada, e o Inter
//    carrega (fonte que cai para a do sistema não dá erro nenhum sozinha).
const lista = await paginas();
for (const caminho of lista) {
  const { ctx, page, erros } = await abre(browser);
  const res = await page.goto(BASE + caminho, { waitUntil: 'load' }).catch(e => ({ status: () => 0, erro: e }));
  const status = res ? res.status() : 0;
  // Não `document.fonts.check()`: ele devolve true quando NENHUMA @font-face
  // corresponde (não há o que carregar), e aprovaria justamente a fonte que
  // sumiu. Exige uma face Inter efetivamente carregada.
  const fonte = status && status < 400
    ? await page.evaluate(async () => {
      await document.fonts.ready;
      return [...document.fonts].some(f => f.family.replace(/["']/g, '') === 'Inter' && f.status === 'loaded');
    }).catch(() => false)
    : false;
  const ok = status > 0 && status < 400 && erros.length === 0 && fonte;
  registra(ok, caminho, [
    `HTTP ${status}`,
    fonte ? 'Inter ok' : 'Inter NÃO carregou',
    ...erros,
  ].join(' · '));
  await ctx.close();
}

// 2. Galeria sem JavaScript: os cards ocupam espaço de verdade. Já colapsaram
//    para 4px e se empilharam no mesmo ponto (VERIFICACAO, "Sem JavaScript").
{
  const { ctx, page } = await abre(browser, { javaScriptEnabled: false });
  await page.goto(BASE + '/', { waitUntil: 'load' });
  const caixas = await page.$$eval('a.card[data-card]', cards =>
    cards.slice(0, 6).map(c => { const r = c.getBoundingClientRect(); return { w: r.width, h: r.height, x: r.left, y: r.top }; }));
  // Colapso = cards sem altura, ou todos no MESMO ponto da tela.
  const mesmoPonto = caixas.length > 1 && new Set(caixas.map(c => `${Math.round(c.x)},${Math.round(c.y)}`)).size === 1;
  const ok = caixas.length > 0 && caixas.every(c => c.w > 50 && c.h > 50) && !mesmoPonto;
  registra(ok, 'galeria sem JavaScript', caixas.length
    ? `${caixas.length} cards, o menor com ${Math.round(Math.min(...caixas.map(c => c.h)))}px de altura${mesmoPonto ? ' · EMPILHADOS no mesmo ponto' : ''}`
    : 'nenhum card encontrado (há projeto visível semeado?)');
  await ctx.close();
}

// 3. Página de projeto: o lightbox abre e fecha sem erro (o carrossel já morreu
//    em TDZ engolido por try/catch, sem nenhum teste acusar). Usa o primeiro
//    projeto do sitemap que tenha foto de capa.
{
  const fixas = new Set(['/', '/sobre', '/equipamentos', '/privacidade', '/termos', '/legal', '/suporte', '/dashboard']);
  const projetos = lista.filter(p => /^\/[a-z0-9-]+$/.test(p) && !fixas.has(p));
  let testado = false;
  for (const projeto of projetos) {
    const { ctx, page, erros } = await abre(browser);
    await page.goto(BASE + projeto, { waitUntil: 'load' });
    const alvo = page.locator('[data-action="openLightbox"]').first();
    if (await alvo.count() > 0) {
      await alvo.click({ force: true });
      const aberto = await page.evaluate(() => document.getElementById('lightbox')?.classList.contains('open'));
      await page.keyboard.press('Escape');
      const fechado = await page.evaluate(() => !document.getElementById('lightbox')?.classList.contains('open'));
      registra(Boolean(aberto && fechado && erros.length === 0), `lightbox (${projeto})`,
        [aberto ? 'abriu' : 'NÃO abriu', fechado ? 'fechou com Esc' : 'NÃO fechou', ...erros].join(' · '));
      testado = true;
    }
    await ctx.close();
    if (testado) break;
  }
  if (!testado) registra(false, 'lightbox da página de projeto', 'nenhum projeto com foto de capa no sitemap — semeie um no KV local');
}

// 4. Login do painel: senha errada mostra o aviso, sem erro de script.
{
  const { ctx, page, erros } = await abre(browser);
  await page.goto(BASE + '/dashboard?error=1', { waitUntil: 'load' });
  const aviso = await page.textContent('.error-msg').catch(() => null);
  const campo = await page.locator('#password').count();
  registra(Boolean(aviso && campo && erros.length === 0), 'login do painel', [aviso ? `aviso: ${aviso.trim().slice(0, 40)}` : 'sem aviso de erro', campo ? 'campo de senha presente' : 'SEM campo de senha', ...erros].join(' · '));
  await ctx.close();
}

await browser.close();

const falhas = resultados.filter(r => !r.ok);
for (const r of resultados) console.log(`${r.ok ? 'OK   ' : 'FALHA'} ${r.nome.padEnd(42)} ${r.detalhe}`);
console.log(`\n${resultados.length - falhas.length} ok, ${falhas.length} falha(s) — ${BASE}`);
process.exit(falhas.length ? 1 : 0);
