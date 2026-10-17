// Roteiro da PRÉVIA DE PR: a faixa "PRÉVIA" e o menu "Testes" num Chromium de
// verdade, contra o `src/index.js` de verdade com `AMBIENTE = "previa"` — a
// mesma camada (src/previa.js) que a Cloudflare roda em cada prévia.
//
//   npm run verifica:previa
//   VERIFICA_PRINTS=/tmp/prints npm run verifica:previa   # com capturas
//
// No celular (toque) e no computador:
//   - a faixa no topo, 44 px, sem nada vazando para o lado; o menu cabe na
//     tela e cada opção é um alvo de toque inteiro;
//   - "Portão do Drive → lotado": o SERVIDOR responde 429 e a página mostra a
//     espera ("muita gente acessando agora"); "Voltar tudo ao normal" e o
//     mesmo portão libera o link;
//   - "Banco → KV não lê": o painel cai no caminho de degradação dele, e a
//     faixa continua lá, com a saída ("Voltar tudo ao normal");
//   - no painel: "E-mail → tudo para o dono" + resolver um pedido = o e-mail
//     vai para o dono, com o destinatário no assunto; "Gerar métricas de
//     exemplo" enche o gráfico, "Apagar" esvazia, "Zerar os limites" avisa.
//
// O Turnstile é o de mentira do verifica:evento (entrega ficha); o servidor
// confere contra o fetch interceptado do worker-local, que aprova.

/* global document, window */
import { existsSync, readdirSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { chromium } from 'playwright-core';
import { sobeWorker, entraNoPainel } from './worker-local.mjs';

function chromiumLocal() {
  if (process.env.CHROMIUM_PATH) return process.env.CHROMIUM_PATH;
  const base = process.env.PLAYWRIGHT_BROWSERS_PATH || '/opt/pw-browsers';
  if (!existsSync(base)) return undefined;
  const dir = readdirSync(base).filter(d => /^chromium-\d+$/.test(d)).sort().pop();
  const exe = dir && `${base}/${dir}/chrome-linux/chrome`;
  return exe && existsSync(exe) ? exe : undefined;
}

const PRINTS = process.env.VERIFICA_PRINTS || '';
if (PRINTS) mkdirSync(PRINTS, { recursive: true });

/** @type {{ ok: boolean, nome: string, detalhe: string }[]} */
const resultados = [];
/** @param {boolean} ok @param {string} nome @param {unknown} [detalhe] */
const registra = (ok, nome, detalhe = '') => resultados.push({ ok, nome, detalhe: typeof detalhe === 'string' ? detalhe : JSON.stringify(detalhe) });

/** @param {string} nome @param {() => Promise<void>} fn */
async function cenario(nome, fn) {
  try {
    await fn();
  } catch (e) {
    registra(false, `${nome}: o cenário quebrou no meio`, String(e instanceof Error ? e.message : e).split('\n')[0]);
  }
}

// ---- A semente ---------------------------------------------------------------
const lh = (/** @type {string} */ id) => `https://lh3.googleusercontent.com/d/${id}`;
/** @param {number} i @param {Record<string, any>} o */
const ev = (i, o) => ({
  id: 'ev' + i, slug: o.slug, title: o.title, status: 'entregue',
  driveUrl: `https://drive.google.com/drive/folders/PASTA_${String(i).padStart(10, '0')}`,
  driveUrlInstagram: '', projectUrl: '', photos: [lh(`FOTO_${i}_AAAAAAAAAA`)], thumbnailUrl: lh(`FOTO_${i}_AAAAAAAAAA`),
  visible: true, comingSoon: false, pinned: false, accessType: 'public',
  category: 'Formatura', date: o.date, promisedDate: '', eventCredits: '',
  longDescription: 'Descrição.', photosAlert: { active: false, addedAt: null, expiresAfterHours: 24 },
});
const EVENTOS = [
  ev(1, { slug: 'formatura-medicina-2026', title: 'Formatura Medicina 2026', date: '2026-10-04' }),
  ev(2, { slug: 'piauifut-2026', title: 'PiauiFut+ 2026', date: '2026-09-14' }),
];
const PEDIDO = {
  id: 'a'.repeat(32), eventSlug: 'formatura-medicina-2026', eventTitle: 'Formatura Medicina 2026', method: 'number',
  value: 'Foto nº 12', email: 'pessoa@example.com', phone: '', message: '', fileName: null, fileBase64: null,
  resolved: false, createdAt: new Date(Date.now() - 3600e3).toISOString(), emailStatus: 'sent', confirmEmailStatus: 'sent',
};
const SEMENTE = {
  events: JSON.stringify(EVENTOS),
  categories: JSON.stringify(['Formatura']),
  [`removal_request:${PEDIDO.id}`]: JSON.stringify(PEDIDO),
};
const EVENTO = '/formatura-medicina-2026';
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');

// Turnstile de mentira (o mesmo do verifica:evento): entrega uma ficha em 300 ms.
const TURNSTILE_FALSO = `window.turnstile = {
  render(sel, o) { window.__o = o; return 'w1'; },
  execute() { const o = window.__o; setTimeout(() => o && o.callback && o.callback('tok' + Math.random()), 300); },
  reset() {}, remove() {}, getResponse() { return ''; },
};`;

const browser = await chromium.launch({ executablePath: chromiumLocal() });

/** Toque no celular, clique no computador. */
const aciona = async (/** @type {import('playwright-core').Locator} */ l, /** @type {boolean} */ toque) => (toque ? l.tap() : l.click());
const espera = (/** @type {import('playwright-core').Page} */ page, ms = 400) => page.waitForTimeout(ms);
/** @param {import('playwright-core').Page} page @param {string} nome */
const print = async (page, nome) => { if (PRINTS) await page.screenshot({ path: join(PRINTS, `previa-${nome}.png`), fullPage: false }); };

/**
 * Com o menu aberto: as opções que alguma coisa da página cobre (o aviso de
 * cookies, a barra de baixo do painel). Rola o menu até cada uma e pergunta ao
 * navegador o que está no centro dela.
 * @param {import('playwright-core').Page} page
 */
const opcoesCobertas = page => page.evaluate(() => {
  /** @type {string[]} */
  const out = [];
  for (const el of document.querySelectorAll('#previa-faixa .previa-op')) {
    el.scrollIntoView({ block: 'nearest' });
    const r = el.getBoundingClientRect();
    const alvo = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
    if (!alvo || !alvo.closest('#previa-faixa')) out.push((el.textContent || '').trim().slice(0, 30));
  }
  return out;
});

/**
 * Abre o menu "Testes" (se fechado) e aciona um item. Simulação e ação
 * recarregam a página; espera a navegação terminar.
 * @param {import('playwright-core').Page} page @param {string} seletor @param {boolean} toque
 */
async function noMenu(page, seletor, toque) {
  const aberto = await page.locator('#previa-faixa details').evaluate(d => /** @type {HTMLDetailsElement} */ (d).open);
  if (!aberto) await aciona(page.locator('#previa-faixa summary'), toque);
  await Promise.all([page.waitForLoadState('load'), page.waitForEvent('framenavigated'), aciona(page.locator(`#previa-faixa ${seletor}`), toque)]);
  await espera(page, 300);
}

for (const [rotulo, viewport, dpr, toque] of /** @type {const} */ ([
  ['iPhone 390@3', { width: 390, height: 844 }, 3, true],
  ['Computador 1440@1', { width: 1440, height: 900 }, 1, false],
])) {
  const id = rotulo.split(' ')[0].toLowerCase();
  await cenario(rotulo, async () => {
    // Com chave do Resend, para os e-mails saírem (para o fetch interceptado
    // do worker-local, que os anota em `w.emails`).
    const w = await sobeWorker({ kv: SEMENTE, env: { AMBIENTE: 'previa', RESEND_API_KEY: 're_teste' } });
    const ctx = await browser.newContext({ viewport, deviceScaleFactor: dpr, hasTouch: toque, isMobile: toque });
    const page = await ctx.newPage();
    const estado = { erros: /** @type {string[]} */ ([]), csp: /** @type {string[]} */ ([]) };
    page.on('pageerror', e => estado.erros.push(String(e)));
    page.on('console', m => {
      const t = m.text();
      if (/Content Security Policy/i.test(t) && !/Report Only/i.test(t)) estado.csp.push(t.slice(0, 160));
    });
    await page.route(/lh3\.googleusercontent\.com/, r => r.fulfill({ contentType: 'image/png', body: PNG }));
    await page.route(/challenges\.cloudflare\.com/, r => r.fulfill({ contentType: 'text/javascript', body: TURNSTILE_FALSO }));
    try {
      // ---- 1. A faixa e o menu -------------------------------------------
      await page.goto(w.url + EVENTO);
      await espera(page, 600);
      const faixa = await page.locator('#previa-faixa').boundingBox();
      registra(!!faixa && faixa.y === 0 && Math.round(faixa.height) === 44 && Math.round(faixa.width) === viewport.width,
        `${rotulo}: a faixa no topo, 44 px, de ponta a ponta`, faixa);
      const largura = await page.evaluate(() => ({ sw: document.scrollingElement ? document.scrollingElement.scrollWidth : 0, escala: window.visualViewport ? window.visualViewport.scale : 1 }));
      registra(largura.sw <= viewport.width && largura.escala >= 0.99, `${rotulo}: nada vaza para o lado (página na escala 1)`, largura);

      await aciona(page.locator('#previa-faixa summary'), toque);
      await espera(page, 200);
      const painel = await page.locator('#previa-faixa .previa-painel').boundingBox();
      registra(!!painel && painel.x >= 0 && painel.x + painel.width <= viewport.width + 0.5 && painel.y + painel.height <= viewport.height + 0.5,
        `${rotulo}: o menu cabe na tela (e rola por dentro)`, painel);
      const pequenos = await page.evaluate(() => [...document.querySelectorAll('#previa-faixa .previa-op')]
        .map(e => ({ t: (e.textContent || '').trim().slice(0, 30), h: Math.round(e.getBoundingClientRect().height) }))
        .filter(x => x.h < 44));
      registra(pequenos.length === 0, `${rotulo}: toda opção do menu tem pelo menos 44 px`, pequenos.slice(0, 4));
      const grupos = await page.locator('#previa-faixa .previa-grupo').count();
      registra(grupos === 8, `${rotulo}: seis simulações, as ações e "Esta prévia"`, grupos);
      await print(page, `${id}-menu`);
      const cobertas = await opcoesCobertas(page);
      registra(cobertas.length === 0, `${rotulo}: com o menu aberto, nada da página o cobre (o aviso de cookies)`, cobertas);

      // ---- 2. Portão lotado, de verdade no servidor -----------------------
      await noMenu(page, '[data-sim="portao"] [data-valor="lotado"]', toque);
      const resumo = toque
        ? (await page.locator('#previa-faixa .previa-conta').textContent()) || ''
        : (await page.locator('#previa-faixa .previa-ligados').textContent()) || '';
      registra(toque ? resumo.trim() === '1' : /Portão do Drive: lotado/.test(resumo), `${rotulo}: a faixa diz que há uma simulação ligada`, resumo);
      await aciona(page.locator('[data-action="openModal"]').first(), toque);
      await page.locator('#drive-consent').check();
      await page.waitForSelector('#drive-wait', { state: 'visible', timeout: 8000 }).catch(() => {});
      const esperaTxt = (await page.locator('#drive-wait').textContent().catch(() => '')) || '';
      const segundos = Number((await page.locator('#drive-wait-s').textContent().catch(() => '')) || 0);
      registra(/Muita gente acessando agora/.test(esperaTxt) && segundos >= 1 && segundos <= 8,
        `${rotulo}: lotado — o servidor diz 429 e a página mostra a espera`, { esperaTxt: esperaTxt.trim().slice(0, 60), segundos });
      await print(page, `${id}-lotado`);

      // ---- 3. Voltar tudo ao normal: o mesmo portão libera ----------------
      await page.goto(w.url + EVENTO);
      await noMenu(page, '[data-acao="normal"]', toque);
      registra(await page.locator('#previa-faixa .previa-conta').count() === 0, `${rotulo}: "Voltar tudo ao normal" desliga tudo`, '');
      await aciona(page.locator('[data-action="openModal"]').first(), toque);
      await page.locator('#drive-consent').check();
      await page.waitForFunction(() => { const a = document.getElementById('drive-link'); return !!a && a.getAttribute('href') !== '#'; }, null, { timeout: 8000 }).catch(() => {});
      const link = await page.locator('#drive-link').getAttribute('href');
      registra(!!link && link.startsWith('https://drive.google.com/'), `${rotulo}: no normal, o portão libera o link`, link);

      // ---- 4. Banco fora: a saída continua na faixa ------------------------
      await page.goto(w.url + EVENTO);
      await noMenu(page, '[data-sim="banco"] [data-valor="leitura"]', toque);
      await page.goto(w.url + '/dashboard');
      await espera(page, 400);
      const temSaida = await page.locator('#previa-faixa [data-acao="normal"]').count();
      const textoPagina = (await page.locator('body').innerText()).slice(0, 4000);
      registra(temSaida === 1, `${rotulo}: com o KV fora, a faixa segue lá com "Voltar tudo ao normal"`, textoPagina.slice(0, 120));
      await print(page, `${id}-kv-fora`);
      await noMenu(page, '[data-acao="normal"]', toque);

      // ---- 5. No painel: e-mail para o dono, métricas, limites -------------
      await page.unroute(/challenges\.cloudflare\.com/);
      await entraNoPainel(page, w.url);
      const noPainel = await page.locator('nav.nav').count();
      registra(noPainel === 1, `${rotulo}: entra no painel da prévia`, '');
      const faixaPainel = await page.locator('#previa-faixa').boundingBox();
      registra(!!faixaPainel && faixaPainel.y === 0, `${rotulo}: a faixa também no painel`, faixaPainel);
      await print(page, `${id}-painel`);
      await aciona(page.locator('#previa-faixa summary'), toque);
      const cobertasNoPainel = await opcoesCobertas(page);
      registra(cobertasNoPainel.length === 0, `${rotulo}: no painel, nada cobre o menu aberto (a barra de baixo)`, cobertasNoPainel);
      await aciona(page.locator('#previa-faixa summary'), toque);

      await noMenu(page, '[data-sim="email"] [data-valor="dono"]', toque);
      await page.evaluate(() => /** @type {HTMLElement} */ (document.querySelector('nav.nav [data-tab="requests"]')).click());
      await espera(page, 600);
      await aciona(page.locator('[data-action="resolveRequest"]').first(), toque);
      await espera(page, 1200);
      const desviado = w.emails.find(e => e.para === 'admin@example.com' && /^\[PRÉVIA → pessoa@example\.com\] /.test(String(e.assunto)));
      registra(!!desviado, `${rotulo}: "tudo para o dono" — o aviso de resolvido vai para o dono, com o destinatário no assunto`, w.emails);
      await noMenu(page, '[data-sim="email"] [data-valor="normal"]', toque);

      await noMenu(page, '[data-acao="metricas-exemplo"]', toque);
      const msg = (await page.locator('#previa-faixa .previa-msg').textContent().catch(() => '')) || '';
      const aberto = await page.locator('#previa-faixa details').evaluate(d => /** @type {HTMLDetailsElement} */ (d).open);
      registra(aberto && /Métricas de exemplo geradas/.test(msg), `${rotulo}: "Gerar métricas de exemplo" volta com o menu aberto e o aviso`, msg);
      await print(page, `${id}-aviso`);
      await aciona(page.locator('#previa-faixa summary'), toque);
      await page.evaluate(() => /** @type {HTMLElement} */ (document.querySelector('nav.nav [data-tab="metrics"]')).click());
      await page.waitForSelector('#grafico-acessos svg', { timeout: 8000 }).catch(() => {});
      await espera(page, 600);
      const pontos = await page.locator('#grafico-acessos svg path').count();
      const resumoMetricas = (await page.locator('#metrics-resumo').textContent().catch(() => '')) || '';
      registra(pontos >= 2 && /[1-9]/.test(resumoMetricas), `${rotulo}: o gráfico de acessos enche com a série de exemplo`, { pontos, resumo: resumoMetricas.trim().slice(0, 80) });
      await print(page, `${id}-metricas`);

      await noMenu(page, '[data-acao="metricas-apagar"]', toque);
      const apagou = (await page.locator('#previa-faixa .previa-msg').textContent().catch(() => '')) || '';
      registra(/apagadas/.test(apagou), `${rotulo}: "Apagar as métricas" avisa`, apagou);
      await noMenu(page, '[data-acao="zerar-limites"]', toque);
      const zerou = (await page.locator('#previa-faixa .previa-msg').textContent().catch(() => '')) || '';
      registra(/zerados/.test(zerou), `${rotulo}: "Zerar os limites deste aparelho" avisa`, zerou);

      if (!toque) {
        await page.goto(w.url + '/');
        await page.focus('#previa-faixa summary');
        await page.keyboard.press('Enter');
        const pelaTecla = await page.locator('#previa-faixa details').evaluate(d => /** @type {HTMLDetailsElement} */ (d).open);
        registra(pelaTecla, `${rotulo}: o menu abre pelo teclado (Enter)`, '');
      }

      registra(estado.erros.length === 0, `${rotulo}: nenhum erro de JS`, estado.erros);
      registra(estado.csp.length === 0, `${rotulo}: nenhuma violação da CSP aplicada`, estado.csp);
    } finally {
      await ctx.close();
      await w.fecha();
    }
  });
}

await browser.close();

let falhas = 0;
for (const r of resultados) {
  if (!r.ok) falhas++;
  console.log(`${r.ok ? 'OK   ' : 'FALHA'} ${r.nome}${r.detalhe && !r.ok ? ` — ${r.detalhe}` : ''}`);
}
console.log(`\n${resultados.length - falhas} ok, ${falhas} falha(s)`);
process.exit(falhas ? 1 : 0);
