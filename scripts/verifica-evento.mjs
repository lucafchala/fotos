// Roteiro de VÉSPERA DE EVENTO: o portão do Drive e as fotos da página de
// projeto num Chromium de verdade, nos formatos de tráfego que só um evento
// produz — o público inteiro no mesmo Wi-Fi (429 do balde de fichas), gente
// com VPN/bloqueador (Turnstile falhando → código por e-mail) e aparelhos
// diferentes (largura e formato das fotos).
//
//   npm run verifica:evento
//
// Não precisa de `wrangler dev`: renderiza a página com o eventHTML() de
// verdade e intercepta a rede — Turnstile simulado, /api/drive-link e
// /api/drive-code respondendo o que cada cenário pede, lh3 devolvendo um PNG
// de 1 px e registrando QUAL largura/formato foi pedido. O que ele prova é o
// comportamento do script da página; o do servidor está na suíte
// (tests/drive-gate.test.js e tests/workers/counters.workers.test.js).
//
// Nasceu da rodada de out/2026 (evento com ~750 pessoas): o portão repetia o
// pedido sozinho e sem teto a cada erro — 27 pedidos em 8 s por celular — e
// os celulares baixavam 3 fotos de 1600 px só para abrir a página.

// As funções passadas a addInitScript/evaluate rodam DENTRO do Chromium.
/* global navigator, MouseEvent, document */
import { existsSync, readdirSync } from 'node:fs';
import { chromium } from 'playwright-core';
import { eventHTML } from '../src/ui/event.js';

function chromiumLocal() {
  if (process.env.CHROMIUM_PATH) return process.env.CHROMIUM_PATH;
  const base = process.env.PLAYWRIGHT_BROWSERS_PATH || '/opt/pw-browsers';
  if (!existsSync(base)) return undefined;
  const dir = readdirSync(base).filter(d => /^chromium-\d+$/.test(d)).sort().pop();
  const exe = dir && `${base}/${dir}/chrome-linux/chrome`;
  return exe && existsSync(exe) ? exe : undefined;
}

/** @type {{ ok: boolean, nome: string, detalhe: string }[]} */
const resultados = [];
/** @param {boolean} ok @param {string} nome @param {unknown} [detalhe] */
const registra = (ok, nome, detalhe = '') => resultados.push({ ok, nome, detalhe: typeof detalhe === 'string' ? detalhe : JSON.stringify(detalhe) });

const FOTOS = Array.from({ length: 8 }, (_, i) => `https://lh3.googleusercontent.com/d/FOTO${i}`);
const EVENTO = {
  id: 'a1', slug: 'evento', title: 'Evento', status: 'entregue',
  driveUrl: 'https://drive.google.com/drive/folders/x', driveUrlInstagram: '', projectUrl: '',
  photos: FOTOS, thumbnailUrl: FOTOS[0], visible: true, comingSoon: false, accessType: 'public',
  category: 'Casamento', date: '2026-01-15', eventCredits: '', longDescription: 'x',
  photosAlert: { active: false, addedAt: null, expiresAfterHours: 24 },
};
const HTML = eventHTML(/** @type {any} */ (EVENTO), 2026, '', 'n0nce', 'drive-nonce', '');
// Álbum de família: sem o Turnstile, o portão pede o nome (#146).
const HTML_FAMILIA = eventHTML(/** @type {any} */ ({ ...EVENTO, slug: 'familia', title: 'Família', accessType: 'family' }), 2026, '', 'n0nce', 'drive-nonce', '');
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');

// Turnstile de mentira: `modo` 'ok' entrega ficha em 300 ms; 'erro' chama o
// error-callback (o que uma VPN sinalizada produz). 'bloqueado' nem chega
// aqui: o pedido do script é abortado, como um bloqueador faz.
/** @param {'ok'|'erro'} modo */
const turnstileFalso = modo => `window.turnstile = {
  render(sel, o) { window.__o = o; return 'w1'; },
  execute() { const o = window.__o; setTimeout(() => ${modo === 'ok' ? "o.callback('tok' + Math.random())" : "o['error-callback'] && o['error-callback']()"}, 300); },
  reset() {},
};`;

const browser = await chromium.launch({ executablePath: chromiumLocal() });

/**
 * @param {{ viewport?: { width: number, height: number }, dpr?: number, turnstile?: 'ok'|'erro'|'bloqueado', html?: string,
 *   driveLink?: (n: number, body: any) => { status: number, json: any },
 *   driveCode?: (body: any) => { status: number, json: any }, saveData?: boolean }} o
 */
async function abre(o = {}) {
  const ctx = await browser.newContext({ viewport: o.viewport || { width: 390, height: 844 }, deviceScaleFactor: o.dpr || 3 });
  const page = await ctx.newPage();
  if (o.saveData) {
    await page.addInitScript(() => {
      Object.defineProperty(navigator, 'connection', { value: { saveData: true, effectiveType: '4g' } });
    });
  }
  const estado = { fotos: /** @type {string[]} */ ([]), driveLink: 0, driveCode: 0, erros: /** @type {string[]} */ ([]), corpos: /** @type {any[]} */ ([]) };
  page.on('pageerror', e => estado.erros.push(String(e)));
  await page.route('**/*', async route => {
    const r = route.request();
    const u = new URL(r.url());
    if (u.host === 'challenges.cloudflare.com') {
      if (o.turnstile === 'bloqueado') return route.abort();
      return route.fulfill({ contentType: 'text/javascript', body: turnstileFalso(o.turnstile || 'ok') });
    }
    if (u.host === 'lh3.googleusercontent.com') { estado.fotos.push(u.pathname.replace('/d/', '')); return route.fulfill({ contentType: 'image/png', body: PNG }); }
    if (u.host !== 'fotos.test') return route.fulfill({ status: 204, body: '' });
    if (u.pathname === '/evento') return route.fulfill({ contentType: 'text/html', body: o.html || HTML });
    if (u.pathname === '/api/drive-link') {
      estado.driveLink++;
      const corpo = JSON.parse(r.postData() || '{}');
      estado.corpos.push(corpo);
      const resp = (o.driveLink || (() => ({ status: 200, json: { ok: true, driveUrl: EVENTO.driveUrl } })))(estado.driveLink, corpo);
      return route.fulfill({ status: resp.status, contentType: 'application/json', body: JSON.stringify(resp.json) });
    }
    if (u.pathname === '/api/drive-code') {
      estado.driveCode++;
      const resp = (o.driveCode || (() => ({ status: 200, json: { ok: true, token: 'tk', ttl: 900 } })))(JSON.parse(r.postData() || '{}'));
      return route.fulfill({ status: resp.status, contentType: 'application/json', body: JSON.stringify(resp.json) });
    }
    return route.fulfill({ status: 204, body: '' });
  });
  await page.goto('https://fotos.test/evento');
  await page.waitForTimeout(800);
  return { ctx, page, estado };
}

/** @param {import('playwright-core').Page} page */
async function aceita(page) {
  await page.locator('[data-action="openModal"]').first().click();
  await page.locator('#drive-consent').check();
}
/** @param {import('playwright-core').Page} page */
const pronto = page => page.locator('#drive-link').evaluate(a => a.getAttribute('href') !== '#');

// Uma exceção no meio de um cenário (um campo que não apareceu, um clique que
// esperou demais) derrubava o roteiro antes do relatório: as FALHAs já
// registradas sumiam junto, e o que sobrava era um stack trace. Agora ela vira
// uma FALHA a mais, com o erro, e o relatório sai do mesmo jeito.
try {
  // ---- 1. Fotos por aparelho ------------------------------------------------
  // Largura = a menor da escada (800/1200/1600) que cobre a tela em pixels
  // físicos; formato WebP para quem decodifica. Android e iPhone pelo mesmo
  // critério — nenhum recebe menos pixels do que a própria tela mostra.
  for (const [nome, viewport, dpr, w] of /** @type {const} */ ([
    ['iPhone 390@3', { width: 390, height: 844 }, 3, 1200],
    ['Android 360@2', { width: 360, height: 780 }, 2, 800],
    ['Android Pixel 412@2.625', { width: 412, height: 915 }, 2.625, 1200],
    ['Android Galaxy 384@3.75', { width: 384, height: 832 }, 3.75, 1600],
    ['Desktop 1440@1', { width: 1440, height: 900 }, 1, 1600],
  ])) {
    const { ctx, page, estado } = await abre({ viewport, dpr });
    await page.waitForTimeout(700);
    const fisico = Math.round(viewport.width * dpr);
    const primeira = estado.fotos[0] || '';
    const todasNaLargura = estado.fotos.every(f => f.endsWith(`=w${w}-rw`));
    registra(todasNaLargura && w >= Math.min(fisico, 1600), `${nome}: fotos em w${w} WebP (tela ${fisico} px)`, estado.fotos);
    const repetida = estado.fotos.filter(f => f.startsWith('FOTO0=')).length;
    registra(repetida === 1, `${nome}: a 1ª foto é baixada uma vez só`, primeira);
    await page.locator('.c-next').click();
    await page.waitForTimeout(400);
    const atual = await page.locator('#c-img').evaluate(i => /** @type {HTMLImageElement} */ (i).currentSrc);
    registra(atual.includes(`FOTO1=w${w}-rw`), `${nome}: ›› troca a foto`, atual.split('/d/')[1]);
    // Zoom no lightbox: mesma largura alta para todo aparelho.
    // dispatchEvent, não click(): o PNG de 1 px deixa a <img> minúscula demais
    // para o Playwright aceitar um clique "de verdade".
    await page.locator('#c-img').dispatchEvent('click');
    await page.waitForTimeout(200);
    await page.locator('#lb-img').evaluate(el => el.dispatchEvent(new MouseEvent('dblclick', { bubbles: true, clientX: 10, clientY: 10 })));
    await page.waitForTimeout(300);
    registra(estado.fotos.some(f => f === 'FOTO1=w2400-rw'), `${nome}: ampliar pede w2400`, estado.fotos.slice(-2));
    registra(estado.erros.length === 0, `${nome}: sem erro de JS`, estado.erros);
    await ctx.close();
  }

  // ---- 2. Economia de dados --------------------------------------------------
  {
    const { ctx, page, estado } = await abre({ viewport: { width: 360, height: 780 }, dpr: 2, saveData: true });
    await page.waitForTimeout(700);
    registra(estado.fotos.length === 1 && estado.fotos[0] === 'FOTO0=w800-rw', 'economia de dados: só a foto da vez, mesma qualidade', estado.fotos);
    await ctx.close();
  }

  // ---- 3. 429 (Wi-Fi do evento): espera o que o servidor manda e tenta sozinho --
  {
    const { ctx, page, estado } = await abre({
      driveLink: n => (n <= 2 ? { status: 429, json: { error: 'x', retryAfter: 1 } } : { status: 200, json: { ok: true, driveUrl: EVENTO.driveUrl } }),
    });
    await aceita(page);
    await page.waitForTimeout(1200);
    const contagem = await page.locator('#drive-wait').isVisible();
    await page.waitForTimeout(9000);
    registra(contagem, '429: mostra a contagem de espera');
    registra(await pronto(page) && estado.driveLink === 3, '429: espera e libera sozinho (3 pedidos)', { pedidos: estado.driveLink });
    await ctx.close();
  }
  {
    const { ctx, page, estado } = await abre({ driveLink: () => ({ status: 429, json: { error: 'x', retryAfter: 1 } }) });
    await aceita(page);
    await page.waitForTimeout(25000);
    registra(estado.driveLink === 6, '429 sem fim: 1 + 5 esperas, depois para (sem martelar)', { pedidos: estado.driveLink });
    registra(await page.locator('#drive-link-error').isVisible() && await page.locator('#drive-email-offer').isVisible(),
      '429 sem fim: oferece botão e código por e-mail');
    await ctx.close();
  }

  // ---- 4. Erro comum: uma tentativa automática, depois só pelo botão ---------
  {
    const { ctx, page, estado } = await abre({ driveLink: () => ({ status: 403, json: { error: 'x' } }) });
    await aceita(page);
    await page.waitForTimeout(6000);
    registra(estado.driveLink === 2, '403: uma tentativa automática e para', { pedidos: estado.driveLink });
    await ctx.close();
  }

  // O código por e-mail só aparece quando ele resolve: um 404 (projeto apagado
  // no meio da visita) não é bloqueio, e o código também seria recusado.
  {
    const { ctx, page } = await abre({ driveLink: () => ({ status: 404, json: { error: 'Projeto não encontrado.' } }) });
    await aceita(page);
    await page.waitForTimeout(3000);
    registra(await page.locator('#drive-link-error').isVisible() && !(await page.locator('#drive-email-offer').isVisible()),
      '404: erro sem oferta de código por e-mail (não é bloqueio)');
    await ctx.close();
  }

  // ---- 5. VPN/bloqueador: Turnstile falha → código por e-mail ----------------
  {
    const { ctx, page, estado } = await abre({
      turnstile: 'erro',
      driveLink: (_n, body) => (body.turnstileToken === 'email' && body.emailToken === 'tk' && body.emailCode === '123456'
        ? { status: 200, json: { ok: true, driveUrl: EVENTO.driveUrl } }
        : { status: 403, json: { error: 'Código incorreto. Confira o e-mail e tente de novo.' } }),
    });
    await aceita(page);
    await page.waitForTimeout(600);
    const oferta = page.locator('#drive-verify-error [data-action="showDriveEmail"]');
    registra(await oferta.isVisible(), 'Turnstile falhou: oferece o código por e-mail');
    await oferta.click();
    await page.locator('#drive-email-addr').fill('ana@exemplo.com');
    await page.locator('#drive-email-send').click();
    await page.waitForTimeout(400);
    registra(estado.driveCode === 1 && await page.locator('#drive-email-code').isVisible(), 'e-mail: pede o código e mostra o campo');
    await page.locator('#drive-email-code').fill('654321');
    await page.locator('#drive-email-ok').click();
    await page.waitForTimeout(400);
    const msg = await page.locator('#drive-email-msg').textContent();
    registra(/incorreto/.test(msg || '') && !(await pronto(page)), 'e-mail: código errado mostra a mensagem do servidor', msg);
    await page.locator('#drive-email-code').fill('123456');
    await page.locator('#drive-email-ok').click();
    await page.waitForTimeout(400);
    registra(await pronto(page), 'e-mail: código certo libera as fotos', { pedidos: estado.driveLink });
    registra(estado.erros.length === 0, 'e-mail: sem erro de JS', estado.erros);
    await ctx.close();
  }

  // ---- 6. Álbum restrito com o Turnstile bloqueado (#146) ---------------------
  // Sem o desafio, álbum de família ou privado pede o nome: o campo abre
  // sozinho, o pedido espera por ele e sai com o nome inteiro — não a cada
  // tecla, que gravaria "Jo" no lugar de "João".
  {
    const { ctx, page, estado } = await abre({ html: HTML_FAMILIA, turnstile: 'bloqueado' });
    await page.locator('[data-action="openModal"]').first().click();
    await page.waitForTimeout(300);
    const campo = page.locator('#drive-name');
    registra(await campo.isVisible() && (await campo.getAttribute('required')) !== null && await page.locator('#drive-name-nota').isVisible()
      && !(await page.locator('#drive-name-toggle').isVisible()),
    'família sem Turnstile: o campo do nome abre sozinho, obrigatório, com a nota do porquê');
    await page.locator('#drive-declaration').check();
    await page.locator('#drive-consent').check();
    await page.waitForTimeout(400);
    const dica = (await page.locator('#drive-gate-hint').textContent()) || '';
    registra(estado.driveLink === 0 && /nome/.test(dica) && await campo.evaluate(el => el === document.activeElement),
      'família sem Turnstile: aceite sem nome não pede o link; a dica diz o que falta e o foco vai ao campo', { pedidos: estado.driveLink, dica });
    await campo.pressSequentially('Ana Souza', { delay: 20 });
    await page.waitForTimeout(300);
    registra(estado.driveLink === 0, 'família sem Turnstile: digitar o nome não dispara pedido a cada tecla', { pedidos: estado.driveLink });
    await campo.press('Tab');
    await page.waitForTimeout(500);
    const corpo = estado.corpos[0] || {};
    registra(estado.driveLink === 1 && corpo.name === 'Ana Souza' && corpo.turnstileToken === 'noscript' && await pronto(page),
      'família sem Turnstile: ao sair do campo, o pedido leva o nome inteiro e libera', { pedidos: estado.driveLink, corpo });
    registra(estado.erros.length === 0, 'família sem Turnstile: sem erro de JS', estado.erros);
    await ctx.close();
  }
  // Passou do teto de álbuns restritos sem o Turnstile: o código por e-mail
  // abre pronto, com a frase do servidor, e o pedido não se repete sozinho.
  {
    const frase = 'Sem a verificação de segurança, cada conexão abre até 3 álbuns de família ou privados por dia. Para abrir este, receba um código por e-mail.';
    const { ctx, page, estado } = await abre({ html: HTML_FAMILIA, turnstile: 'bloqueado', driveLink: () => ({ status: 403, json: { error: frase, usarEmail: true } }) });
    await page.locator('[data-action="openModal"]').first().click();
    await page.waitForTimeout(300);
    await page.locator('#drive-name').fill('Ana Souza');
    await page.locator('#drive-declaration').check();
    await page.locator('#drive-consent').check();
    await page.waitForTimeout(2500);
    const msg = (await page.locator('#drive-email-msg').textContent()) || '';
    registra(await page.locator('#drive-email').isVisible() && msg === frase && estado.driveLink === 1 && !(await page.locator('#drive-link-error').isVisible()),
      'teto de álbuns restritos: abre o código por e-mail com a frase do servidor, sem repetir o pedido', { pedidos: estado.driveLink, msg });
    await ctx.close();
  }
  // Página aberta antes da mudança (não sabia que precisava do nome): o 400
  // do servidor com campo "nome" abre o campo, e o pedido seguinte leva o nome.
  {
    const { ctx, page, estado } = await abre({
      turnstile: 'bloqueado',
      driveLink: (_n, body) => (body.name
        ? { status: 200, json: { ok: true, driveUrl: EVENTO.driveUrl } }
        : { status: 400, json: { error: 'Sem a verificação de segurança, este álbum pede o seu nome.', campo: 'nome' } }),
    });
    await aceita(page);
    await page.waitForTimeout(500);
    const abriu = await page.locator('#drive-name').isVisible() && !(await page.locator('#drive-link-error').isVisible());
    registra(abriu, 'servidor pede o nome (400 campo "nome"): o campo abre, sem tela de erro', { pedidos: estado.driveLink });
    if (abriu) {
      await page.locator('#drive-name').fill('Bia');
      await page.locator('#drive-name').press('Tab');
      await page.waitForTimeout(500);
    }
    registra(abriu && estado.driveLink === 2 && (estado.corpos[1] || {}).name === 'Bia' && await pronto(page),
      'servidor pede o nome: o pedido seguinte leva o nome e libera', { abriu, pedidos: estado.driveLink });
    await ctx.close();
  }
  // Álbum público com o Turnstile bloqueado: nada muda — o nome segue opcional
  // e o link sai logo depois do aceite.
  {
    const { ctx, page, estado } = await abre({ turnstile: 'bloqueado' });
    await aceita(page);
    await page.waitForTimeout(500);
    registra(estado.driveLink === 1 && (estado.corpos[0] || {}).turnstileToken === 'noscript' && !(await page.locator('#drive-name').isVisible()) && await pronto(page),
      'público sem Turnstile: o nome segue opcional e o link sai depois do aceite', { pedidos: estado.driveLink });
    await ctx.close();
  }

} catch (e) {
  registra(false, 'o roteiro parou no meio de um cenário', String(e instanceof Error ? e.message : e).split('\n')[0].slice(0, 300));
} finally {
  await browser.close();
}

let falhas = 0;
for (const r of resultados) {
  if (!r.ok) falhas++;
  console.log(`${r.ok ? 'OK   ' : 'FALHA'} ${r.nome}${r.detalhe && !r.ok ? ` — ${r.detalhe}` : ''}`);
}
console.log(`\n${resultados.length - falhas} ok, ${falhas} falha(s)`);
process.exit(falhas ? 1 : 0);
