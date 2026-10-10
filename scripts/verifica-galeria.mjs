// Roteiro da GALERIA PRÓPRIA (#235) num Chromium de verdade.
//
//   npm run verifica:galeria
//   VERIFICA_PRINTS=/caminho npm run verifica:galeria   # salva capturas de tela
//
// Não precisa de `wrangler dev` nem da Drive API: renderiza a página com o
// galeriaHTML() de verdade, servida com os cabeçalhos de segurança reais do
// painel (CSP inclusive — script ou imagem bloqueada aparece aqui), e
// intercepta a rede: o lh3 devolve uma imagem gerada NA LARGURA PEDIDA (é
// assim que dá para conferir qual resolução a página escolheu), e o proxy de
// download devolve um arquivo com os cabeçalhos que o servidor manda.
//
// O que ele prova é o comportamento da PÁGINA: grade, resolução por aparelho,
// zoom que sobe a resolução, downloads, "Salvar na galeria", seleção, link
// direto e teclado. O do servidor (portão, proxy, Drive API) está em
// tests/galeria.test.js.

/* global document, window, navigator, getComputedStyle, history */
import { existsSync, readdirSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { chromium } from 'playwright-core';
import { galeriaHTML } from '../src/ui/galeria.js';
import { VENDOR } from '../src/content/vendor.js';
import { adminHtmlSecurityHeaders } from '../src/security.js';
import { GALERIA_LARGURAS, GALERIA_LARGURAS_GRADE } from '../src/config.js';

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

// ---- A pasta de mentira ----------------------------------------------------
// Raiz com proporções variadas (deitada, em pé, quadrada, panorâmica, uma sem
// dimensões, como um HEIC) e uma subpasta grande o bastante para a carga
// preguiçosa aparecer.
const FORMATOS = [[6000, 4000], [4000, 6000], [4000, 4000], [6000, 4000], [8000, 2000], [6000, 4000], [3000, 4500], [6000, 4000]];
const pid = (/** @type {string} */ p, /** @type {number} */ i) => `${p}_${String(i).padStart(6, '0')}`;
const raiz = Array.from({ length: 24 }, (_, i) => {
  const [w, h] = FORMATOS[i % FORMATOS.length];
  return /** @type {[string, number, number, string, number]} */ ([pid('RAIZFOTO', i), i === 5 ? 0 : w, i === 5 ? 0 : h, `${String(i + 1).padStart(3, '0')}.jpg`, 15_000_000 + i * 1000]);
});
const festa = Array.from({ length: 220 }, (_, i) => {
  const [w, h] = FORMATOS[(i + 3) % FORMATOS.length];
  return /** @type {[string, number, number, string, number]} */ ([pid('FESTAFOTO', i), w, h, `festa-${i + 1}.jpg`, 9_000_000]);
});
const TODAS = [...raiz, ...festa];
/** @type {Map<string, [string, number, number, string, number]>} */
const POR_ID = new Map(TODAS.map(f => [f[0], f]));
// A foto sem dimensões tem, de verdade, 3:2.
const PROPORCAO_REAL = (/** @type {string} */ id) => {
  const f = /** @type {[string, number, number, string, number]} */ (POR_ID.get(id));
  return f[1] && f[2] ? f[1] / f[2] : 1.5;
};
const LARGURA_REAL = (/** @type {string} */ id) => {
  const f = /** @type {[string, number, number, string, number]} */ (POR_ID.get(id));
  return f[1] || 6000;
};

const EVENTO = { slug: 'formatura', title: 'Formatura 2026', driveUrl: 'https://drive.google.com/drive/folders/RAIZ_PASTA_0001' };
const LISTAGEM = {
  v: /** @type {1} */ (1), pasta: 'RAIZ_PASTA_0001', em: '2026-10-10T12:00:00.000Z', truncada: false,
  total: TODAS.length, videos: 2, outros: 0, rk: {},
  secoes: [{ nome: '', caminho: '', fotos: raiz }, { nome: 'Festa', caminho: 'Festa', fotos: festa }],
};
const NONCE = 'nonceDeTeste123';
const PAGINA = galeriaHTML({ event: EVENTO, listagem: LISTAGEM, erro: null, nonce: NONCE });
const PAGINA_ERRO = galeriaHTML({ event: EVENTO, listagem: null, erro: { codigo: 'chave-ausente', mensagem: 'Falta a chave da Drive API (GOOGLE_DRIVE_API_KEY).' }, nonce: NONCE });

// ---- Imagens geradas na largura pedida -------------------------------------
/** @type {any} */
let sharp = null;
try { sharp = (await import('sharp')).default; } catch { sharp = null; }
const PNG_1PX = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');
/** @type {Map<string, Buffer>} */
const imagens = new Map();
/** @param {string} id @param {number} pedida @param {boolean} webp */
async function imagem(id, pedida, webp) {
  const w = Math.max(1, Math.min(pedida, LARGURA_REAL(id))); // o lh3 não amplia
  const h = Math.max(1, Math.round(w / PROPORCAO_REAL(id)));
  const chave = `${id}:${w}:${webp}`;
  const pronta = imagens.get(chave);
  if (pronta) return { corpo: pronta, tipo: webp ? 'image/webp' : 'image/jpeg' };
  if (!sharp) return { corpo: PNG_1PX, tipo: 'image/png' };
  let n = 0;
  for (const c of id) n = (n * 31 + c.charCodeAt(0)) >>> 0;
  const h1 = n % 360, h2 = (h1 + 40) % 360;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}"><defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="hsl(${h1},35%,38%)"/><stop offset="1" stop-color="hsl(${h2},45%,62%)"/></linearGradient></defs><rect width="100%" height="100%" fill="url(#g)"/><circle cx="${w * 0.62}" cy="${h * 0.42}" r="${Math.min(w, h) * 0.18}" fill="hsla(${h2},60%,85%,.55)"/></svg>`;
  let pipe = sharp(Buffer.from(svg));
  pipe = webp ? pipe.webp({ quality: 70 }) : pipe.jpeg({ quality: 75 });
  const corpo = await pipe.toBuffer();
  imagens.set(chave, corpo);
  return { corpo, tipo: webp ? 'image/webp' : 'image/jpeg' };
}

const browser = await chromium.launch({ executablePath: chromiumLocal() });

/**
 * @param {{ viewport?: { width: number, height: number }, dpr?: number, toque?: boolean, pagina?: string, url?: string, compartilhar?: boolean, escuro?: boolean }} o
 */
async function abre(o = {}) {
  const ctx = await browser.newContext({
    colorScheme: o.escuro ? 'dark' : 'light',
    viewport: o.viewport || { width: 1440, height: 900 },
    deviceScaleFactor: o.dpr || 1,
    hasTouch: !!o.toque,
    isMobile: !!o.toque,
    acceptDownloads: true,
  });
  const page = await ctx.newPage();
  if (o.compartilhar) {
    await page.addInitScript(() => {
      /** @type {any} */ (window).__compartilhados = [];
      Object.defineProperty(navigator, 'canShare', { value: (/** @type {any} */ d) => !!(d && d.files && d.files.length) });
      Object.defineProperty(navigator, 'share', {
        value: async (/** @type {any} */ d) => {
          /** @type {any} */ (window).__compartilhados.push(...d.files.map((/** @type {File} */ f) => ({ nome: f.name, tipo: f.type, bytes: f.size })));
        },
      });
    });
  }
  const estado = {
    lh3: /** @type {{ id: string, w: number, webp: boolean }[]} */ ([]),
    downloads: /** @type {string[]} */ ([]),
    erros: /** @type {string[]} */ ([]),
    csp: /** @type {string[]} */ ([]),
    cspRO: /** @type {string[]} */ ([]),
  };
  page.on('pageerror', e => estado.erros.push(String(e)));
  page.on('console', m => {
    const t = m.text();
    if (!/Content Security Policy/i.test(t)) return;
    if (/Report Only/i.test(t)) estado.cspRO.push(t.slice(0, 160)); else estado.csp.push(t.slice(0, 160));
  });
  await page.route('**/*', async route => {
    const r = route.request();
    const u = new URL(r.url());
    if (u.host === 'lh3.googleusercontent.com') {
      const m = u.pathname.match(/^\/d\/([A-Za-z0-9_-]+)=w(\d+)(-rw)?$/);
      if (!m) return route.fulfill({ status: 404, body: '' });
      estado.lh3.push({ id: m[1], w: Number(m[2]), webp: !!m[3] });
      const img = await imagem(m[1], Number(m[2]), !!m[3]);
      return route.fulfill({ contentType: img.tipo, body: img.corpo });
    }
    if (u.host !== 'fotos.test') return route.fulfill({ status: 204, body: '' });
    if (u.pathname === '/galeria/formatura') {
      return route.fulfill({ status: 200, headers: adminHtmlSecurityHeaders(NONCE), body: o.pagina || PAGINA });
    }
    const v = VENDOR.find(x => x.path === u.pathname);
    if (v) return route.fulfill({ status: 200, contentType: v.contentType, body: v.texto });
    const b = u.pathname.match(/^\/galeria\/formatura\/baixar\/([A-Za-z0-9_-]+)$/);
    if (b) {
      const f = POR_ID.get(b[1]);
      if (!f) return route.fulfill({ status: 404, contentType: 'application/json', body: '{"error":"x"}' });
      const variante = u.searchParams.get('v') === 'max' ? 'max' : 'redes';
      estado.downloads.push(`${b[1]}:${variante}`);
      const nome = `formatura-${f[3].replace(/\.[^.]+$/, '')}${variante === 'redes' ? '-redes' : ''}.jpg`;
      const img = await imagem(b[1], variante === 'redes' ? 2048 : LARGURA_REAL(b[1]), false);
      return route.fulfill({
        status: 200,
        headers: {
          'Content-Type': 'image/jpeg',
          'Content-Disposition': `attachment; filename="${nome}"`,
          'X-Nome-Arquivo': encodeURIComponent(nome),
        },
        body: img.corpo,
      });
    }
    return route.fulfill({ status: 204, body: '' });
  });
  await page.goto(o.url || 'https://fotos.test/galeria/formatura');
  await page.waitForTimeout(900);
  return { ctx, page, estado };
}

/** A menor largura da escada que cobre `px` — o que o navegador deve pedir. */
const degrau = (/** @type {number[]} */ escada, /** @type {number} */ px) => escada.find(x => x >= px) ?? escada[escada.length - 1];

/** @param {import('playwright-core').Page} page */
const larguraAtualDoVisualizador = page => page.evaluate(() => {
  const img = /** @type {HTMLImageElement | null} */ (document.querySelector('.pswp__item:not([aria-hidden="true"]) img.pswp__img:not(.pswp__img--placeholder)'));
  const m = img && img.currentSrc.match(/=w(\d+)/);
  return { w: m ? Number(m[1]) : 0, exibida: img ? img.getBoundingClientRect().width : 0, src: img ? img.currentSrc : '' };
});

/** @param {import('playwright-core').Page} page */
const espera = (page, ms = 700) => page.waitForTimeout(ms);

/**
 * Espera a imagem do slide atual ser a pedida com pelo menos `minimo` de
 * largura (a troca de resolução é assíncrona).
 * @param {import('playwright-core').Page} page
 */
async function esperaLargura(page, minimo, ms = 4000) {
  const fim = Date.now() + ms;
  let ult = await larguraAtualDoVisualizador(page);
  while (Date.now() < fim && ult.w < minimo) {
    await page.waitForTimeout(150);
    ult = await larguraAtualDoVisualizador(page);
  }
  return ult;
}

/**
 * Roda um cenário sem deixar uma exceção derrubar o roteiro: ela vira uma
 * FALHA registrada, e os cenários seguintes rodam do mesmo jeito — uma falha
 * não esconde as outras (a mesma lição do smoke.sh). Sem isto, um voltar que
 * saísse da página travava o clique seguinte e o roteiro morria sem resumo.
 * @param {string} nome
 * @param {() => Promise<void>} fn
 */
async function cenario(nome, fn) {
  try {
    await fn();
  } catch (e) {
    registra(false, `${nome}: o cenário quebrou no meio`, String(e instanceof Error ? e.message : e).split('\n')[0]);
  }
}

// ---- 1. Grade por aparelho -------------------------------------------------
for (const [nome, viewport, dpr, toque] of /** @type {const} */ ([
  ['Desktop 1440@1', { width: 1440, height: 900 }, 1, false],
  ['Notebook Retina 1440@2', { width: 1440, height: 900 }, 2, false],
  ['iPhone 390@3', { width: 390, height: 844 }, 3, true],
  ['Android 360@2', { width: 360, height: 780 }, 2, true],
  ['Android Pixel 412@2.625', { width: 412, height: 915 }, 2.625, true],
])) {
  await cenario(nome, async () => {
    const { ctx, page, estado } = await abre({ viewport, dpr, toque });
    await espera(page, 1200);
    const g = await page.evaluate(() => {
      const grade = /** @type {HTMLElement} */ (document.querySelector('.g-grade'));
      const cs = getComputedStyle(grade);
      const util = grade.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight);
      const linhas = [...document.querySelectorAll('.g-grade')].flatMap(gr => {
        const ls = [...gr.querySelectorAll('.g-linha')];
        return ls.slice(0, -1).map(l => {
          const filhos = [...l.children].map(c => c.getBoundingClientRect().width);
          const gap = parseFloat(getComputedStyle(l).columnGap || '0');
          return filhos.reduce((a, b) => a + b, 0) + gap * (filhos.length - 1);
        });
      });
      const desvio = linhas.length ? Math.max(...linhas.map(x => Math.abs(x - util))) : -1;
      const tiles = [...document.querySelectorAll('.g-t')].slice(0, 12).map(t => {
        const img = /** @type {HTMLImageElement} */ (t.querySelector('img'));
        const m = img.currentSrc.match(/=w(\d+)/);
        return { css: t.getBoundingClientRect().width, w: m ? Number(m[1]) : 0, ok: img.classList.contains('ok') };
      });
      const nan = [...document.querySelectorAll('.g-t')].some(t => !/^\d+px$/.test(/** @type {HTMLElement} */ (t).style.width));
      return { util, desvio, tiles, nan, total: document.querySelectorAll('.g-t').length, rolagemLateral: document.scrollingElement.scrollWidth > window.innerWidth };
  });
  registra(g.total === TODAS.length, `${nome}: todas as ${TODAS.length} fotos na grade`, g.total);
  registra(g.desvio >= 0 && g.desvio <= 2, `${nome}: linhas justificadas (cada linha fecha na largura, ±2 px)`, { desvio: g.desvio });
  registra(!g.nan && !g.rolagemLateral, `${nome}: nenhuma largura inválida, sem rolagem lateral`, { nan: g.nan, lateral: g.rolagemLateral });
  const fisicoOk = g.tiles.filter(t => t.ok).every(t => t.w >= Math.min(degrau(GALERIA_LARGURAS_GRADE, t.css * dpr), GALERIA_LARGURAS_GRADE.at(-1)));
  registra(fisicoOk && g.tiles.some(t => t.ok), `${nome}: miniatura com pixels suficientes para a tela (largura × DPR)`, g.tiles.slice(0, 4));
  const pedidas = new Set(estado.lh3.map(x => x.id)).size;
  registra(pedidas < TODAS.length, `${nome}: carga preguiçosa (pediu ${pedidas} de ${TODAS.length} miniaturas)`, pedidas);
  registra(estado.lh3.every(x => x.webp), `${nome}: WebP (o navegador decodifica)`, estado.lh3.slice(0, 2));
  registra(estado.erros.length === 0 && estado.csp.length === 0, `${nome}: sem erro de JS nem bloqueio de CSP`, [...estado.erros, ...estado.csp]);
  if (PRINTS) await page.screenshot({ path: join(PRINTS, `grade-${nome.replace(/[^a-z0-9]+/gi, '-')}.png`) });
  await ctx.close();
  });
}

// ---- 1b. Tema escuro (o padrão da maioria dos celulares à noite) ----------
await cenario('Tema escuro', async () => {
  const { ctx, page, estado } = await abre({ viewport: { width: 390, height: 844 }, dpr: 3, toque: true, escuro: true });
  await espera(page, 900);
  const cores = await page.evaluate(() => {
    const lum = (/** @type {string} */ c) => {
      const m = c.match(/\d+(\.\d+)?/g) || ['0', '0', '0'];
      return (0.2126 * Number(m[0]) + 0.7152 * Number(m[1]) + 0.0722 * Number(m[2])) / 255;
    };
    const fundo = getComputedStyle(document.body).backgroundColor;
    const titulo = getComputedStyle(/** @type {Element} */ (document.querySelector('h1'))).color;
    return { fundo: lum(fundo), titulo: lum(titulo) };
  });
  registra(cores.fundo < 0.2 && cores.titulo > 0.7, 'Tema escuro: fundo escuro, texto claro', cores);
  // TODO.md, "Decidido não fazer": nada de contagem de fotos na página.
  const titulos = await page.locator('.g-sec h2').allTextContents();
  registra(titulos.join('|') === 'Fotos|Festa', 'Seções sem contagem de fotos (decisão do dono)', titulos);
  registra(estado.erros.length === 0 && estado.csp.length === 0, 'Tema escuro: sem erro de JS nem CSP', [...estado.erros, ...estado.csp]);
  if (PRINTS) await page.screenshot({ path: join(PRINTS, 'grade-escuro-iphone.png') });
  await ctx.close();
});

// ---- 2. Visualizador: resolução da tela e zoom que sobe a resolução --------
await cenario('Visualizador no desktop', async () => {
  // Desktop: a foto 001 é 6000×4000; a tela tem 1440×900 em DPR 1.
  const { ctx, page, estado } = await abre({ viewport: { width: 1440, height: 900 }, dpr: 1 });
  await page.locator('.g-t').first().click();
  await page.waitForSelector('.pswp--open', { timeout: 5000 });
  await espera(page, 1200);
  const ini = await larguraAtualDoVisualizador(page);
  const esperado = degrau([...GALERIA_LARGURAS.filter(x => x < 6000), 6000], ini.exibida * 1);
  registra(ini.w === esperado, 'Desktop: abre na resolução da tela (menor degrau que cobre a foto exibida)', { pedida: ini.w, exibida: Math.round(ini.exibida), esperado });
  registra(/[#]foto=RAIZFOTO_000000$/.test(page.url()), 'Desktop: o endereço ganha o link direto da foto', page.url());
  // Zoom máximo com a roda: tem de chegar ao original.
  await page.mouse.move(720, 450);
  for (let k = 0; k < 14; k++) { await page.mouse.wheel(0, -400); await page.waitForTimeout(60); }
  const max = await esperaLargura(page, 6000, 6000);
  registra(max.w === 6000, 'Desktop: zoom máximo pede o ORIGINAL (6000 px)', { pedida: max.w });
  const pedidasDaFoto = estado.lh3.filter(x => x.id === 'RAIZFOTO_000000').map(x => x.w);
  registra(pedidasDaFoto.includes(6000) && Math.min(...pedidasDaFoto.filter(w => w > 1000)) < 6000, 'Desktop: a resolução sobe por degraus, não começa no original', pedidasDaFoto);
  // Teclado: → troca a foto e o link; Esc fecha e limpa o link.
  await page.keyboard.press('ArrowRight');
  await espera(page, 600);
  registra(/[#]foto=RAIZFOTO_000001$/.test(page.url()), 'Desktop: seta → vai para a próxima foto (link atualizado)', page.url());
  const legenda = await page.locator('.pswp__g-legenda').textContent();
  registra(legenda === '002', 'Desktop: legenda mostra o número da foto', legenda);
  await page.keyboard.press('Escape');
  await espera(page, 700);
  registra(!(await page.locator('.pswp--open').count()) && !page.url().includes('#foto='), 'Desktop: Esc fecha e limpa o link', page.url());
  // Voltar do navegador com a foto aberta fecha a FOTO e fica na galeria.
  await page.locator('.g-t').nth(3).click();
  await page.waitForSelector('.pswp--open');
  await espera(page, 700);
  await page.evaluate(() => history.back());
  await espera(page, 700);
  registra(!(await page.locator('.pswp--open').count()) && new URL(page.url()).pathname === '/galeria/formatura' && !page.url().includes('#foto='),
    'Desktop: voltar com a foto aberta fecha a foto e fica na galeria', page.url());
  registra(estado.erros.length === 0 && estado.csp.length === 0, 'Desktop: visualizador sem erro de JS nem CSP', [...estado.erros, ...estado.csp]);
  if (PRINTS) {
    await page.locator('.g-t').nth(1).click();
    await espera(page, 1200);
    await page.screenshot({ path: join(PRINTS, 'visualizador-desktop.png') });
  }
  await ctx.close();
});
await cenario('Visualizador no iPhone', async () => {
  // iPhone: foto deitada 6000×4000 numa tela de 390 px em DPR 3.
  const { ctx, page, estado } = await abre({ viewport: { width: 390, height: 844 }, dpr: 3, toque: true });
  await page.locator('.g-t').first().tap();
  await page.waitForSelector('.pswp--open', { timeout: 5000 });
  await espera(page, 1200);
  const ini = await larguraAtualDoVisualizador(page);
  const escada = [...GALERIA_LARGURAS.filter(x => x < 6000), 6000];
  registra(ini.w === degrau(escada, ini.exibida * 3), 'iPhone: abre com os pixels FÍSICOS da tela (largura exibida × 3)', { pedida: ini.w, exibida: Math.round(ini.exibida) });
  // Duplo toque amplia: a resolução tem de subir.
  const box = await page.locator('.pswp').boundingBox();
  const cx = (box?.width || 390) / 2, cy = (box?.height || 844) / 2;
  await page.touchscreen.tap(cx, cy);
  await page.waitForTimeout(90);
  await page.touchscreen.tap(cx, cy);
  const zoom = await esperaLargura(page, ini.w + 1, 6000);
  registra(zoom.w > ini.w, 'iPhone: duplo toque amplia e pede resolução maior', { antes: ini.w, depois: zoom.w });
  registra(estado.erros.length === 0, 'iPhone: sem erro de JS', estado.erros);
  if (PRINTS) await page.screenshot({ path: join(PRINTS, 'visualizador-iphone.png') });
  await ctx.close();
});

// ---- 3. Link direto --------------------------------------------------------
await cenario('Link direto', async () => {
  const { ctx, page, estado } = await abre({ url: 'https://fotos.test/galeria/formatura#foto=FESTAFOTO_000004' });
  await page.waitForSelector('.pswp--open', { timeout: 5000 });
  await espera(page, 800);
  const legenda = await page.locator('.pswp__g-legenda').textContent();
  registra(legenda === 'festa-5 · Festa', 'Link direto #foto= abre na foto certa, com a seção na legenda', legenda);
  await page.evaluate(() => history.back());
  await espera(page, 700);
  registra(!(await page.locator('.pswp--open').count()) && page.url() === 'https://fotos.test/galeria/formatura' && (await page.locator('.g-t').count()) === TODAS.length,
    'Link direto: voltar fecha a foto e fica na galeria (não sai do site)', page.url());
  registra(estado.erros.length === 0, 'Link direto: sem erro de JS', estado.erros);
  await ctx.close();
});

// ---- 4. Downloads no computador -------------------------------------------
await cenario('Downloads no computador', async () => {
  const { ctx, page, estado } = await abre({});
  await page.locator('.g-t').nth(2).click();
  await page.waitForSelector('.pswp--open');
  await espera(page, 800);
  await page.locator('.pswp__button--g-baixar').click();
  await page.waitForSelector('#g-folha:not([hidden])');
  const ops = await page.locator('.g-op strong').allTextContents();
  const detalhe = await page.locator('.g-op span').nth(1).textContent();
  registra(ops.join('|') === 'Para redes sociais|Tamanho máximo', 'Computador: a folha oferece "para redes" e "tamanho máximo"', ops);
  // 15.002.000 bytes = "15 MB", em unidades decimais como o celular mostra.
  registra(/4000 × 4000 px · 15 MB$/.test(detalhe || ''), 'Computador: "tamanho máximo" mostra dimensões e peso do original', detalhe);
  // No computador o download é um <a download> para o proxy. O Playwright não
  // intercepta essa navegação (ela vira download antes da rota), então aqui se
  // confere a URL pedida — foto e variante —, e o nome do arquivo, que é o
  // Content-Disposition do servidor, está em tests/galeria.test.js.
  const urlDe = (/** @type {import('playwright-core').Download} */ d) => { const u = new URL(d.url()); return u.pathname + u.search; };
  const [d1] = await Promise.all([page.waitForEvent('download'), page.locator('.g-op').first().click()]);
  registra(urlDe(d1) === '/galeria/formatura/baixar/RAIZFOTO_000002?v=redes', 'Computador: "para redes" baixa a foto aberta, pelo proxy', d1.url());
  await espera(page, 1200);
  await page.locator('.pswp__button--g-baixar').click();
  await page.waitForSelector('#g-folha:not([hidden])');
  const [d2] = await Promise.all([page.waitForEvent('download'), page.locator('.g-op').nth(1).click()]);
  registra(urlDe(d2) === '/galeria/formatura/baixar/RAIZFOTO_000002?v=max', 'Computador: "tamanho máximo" baixa o original, pelo proxy', d2.url());
  // Esc com a folha aberta fecha SÓ a folha.
  await espera(page, 1200);
  await page.locator('.pswp__button--g-baixar').click();
  await page.waitForSelector('#g-folha:not([hidden])');
  await page.keyboard.press('Escape');
  await espera(page, 400);
  registra(await page.locator('#g-folha').isHidden() && (await page.locator('.pswp--open').count()) === 1, 'Computador: Esc fecha a folha e mantém o visualizador', '');
  registra(estado.erros.length === 0, 'Computador: downloads sem erro de JS', estado.erros);
  await ctx.close();
});

// ---- 5. "Salvar na galeria" no celular (iPhone e Android pelo mesmo caminho) --
for (const [nome, viewport, dpr] of /** @type {const} */ ([
  ['iPhone 390@3', { width: 390, height: 844 }, 3],
  ['Android 360@2', { width: 360, height: 780 }, 2],
])) {
  await cenario(nome, async () => {
    const { ctx, page, estado } = await abre({ viewport, dpr, toque: true, compartilhar: true });
    await page.locator('.g-t').first().tap();
    await page.waitForSelector('.pswp--open');
    await espera(page, 900);
    await page.locator('.pswp__button--g-baixar').tap();
    await page.waitForSelector('#g-folha:not([hidden])');
    await page.locator('.g-op').first().tap();
    await page.waitForSelector('.g-op.g-pronto', { timeout: 8000 });
    const rotulo = await page.locator('.g-op.g-pronto strong').textContent();
    registra(rotulo === 'Salvar na galeria', `${nome}: prepara a foto e oferece "Salvar na galeria"`, rotulo);
    await page.locator('.g-op.g-pronto').tap();
    await espera(page, 500);
    const comp = await page.evaluate(() => /** @type {any} */ (window).__compartilhados);
    registra(comp.length === 1 && comp[0].nome === 'formatura-001-redes.jpg' && comp[0].tipo === 'image/jpeg' && comp[0].bytes > 0,
      `${nome}: o compartilhamento recebe o ARQUIVO (nome, tipo, bytes)`, comp);
    registra(estado.downloads.join(',') === 'RAIZFOTO_000000:redes', `${nome}: um único pedido ao proxy, da variante certa`, estado.downloads);
    // O botão voltar do sistema: com a folha aberta sobre a foto, o primeiro
    // voltar fecha só a folha; o segundo, a foto; e a pessoa continua na galeria.
    await page.locator('.pswp__button--g-baixar').tap();
    await page.waitForSelector('#g-folha:not([hidden])');
    if (PRINTS && nome.startsWith('iPhone')) {
      await espera(page, 400);
      await page.screenshot({ path: join(PRINTS, 'folha-iphone.png') });
    }
    await page.evaluate(() => history.back());
    await espera(page, 600);
    const depois1 = { folha: await page.locator('#g-folha').isHidden(), foto: (await page.locator('.pswp--open').count()) === 1 };
    await page.evaluate(() => history.back());
    await espera(page, 700);
    const depois2 = { foto: (await page.locator('.pswp--open').count()) === 1, url: page.url() };
    registra(depois1.folha && depois1.foto && !depois2.foto && depois2.url === 'https://fotos.test/galeria/formatura',
      `${nome}: voltar fecha a folha, depois a foto, e fica na galeria`, { depois1, depois2 });
    registra(estado.erros.length === 0, `${nome}: sem erro de JS`, estado.erros);
    await ctx.close();
  });
}

// ---- 6. Seleção ------------------------------------------------------------
await cenario('Seleção', async () => {
  const { ctx, page, estado } = await abre({});
  await page.locator('#g-sel').click();
  for (const i of [0, 3, 7]) await page.locator('.g-t').nth(i).click();
  registra((await page.locator('#g-barra-n').textContent()) === '3 selecionadas', 'Seleção: marca três fotos', await page.locator('#g-barra-n').textContent());
  const nomes = await page.locator('.g-t.sel').evaluateAll(els => els.map(e => e.getAttribute('aria-label')));
  registra(nomes.join('|') === 'Foto 001, selecionada|Foto 004, selecionada|Foto 008, selecionada', 'Seleção: o leitor de tela ouve "selecionada" no nome da foto', nomes);
  registra((await page.locator('.pswp--open').count()) === 0, 'Seleção: no modo seleção, tocar marca em vez de abrir', '');
  await page.reload();
  await espera(page, 900);
  registra((await page.locator('#g-barra-n').textContent()) === '3 selecionadas' && (await page.locator('.g-t.sel').count()) === 3, 'Seleção: sobrevive a recarregar a página', '');
  await page.locator('[data-acao="baixar-sel"]').click();
  await page.waitForSelector('#g-folha:not([hidden])');
  registra((await page.locator('#g-folha-t').textContent()) === 'Baixar 3 fotos', 'Seleção: a folha baixa as três', await page.locator('#g-folha-t').textContent());
  if (PRINTS) await page.screenshot({ path: join(PRINTS, 'selecao-desktop.png') });
  /** @type {string[]} */
  const pedidos = [];
  page.on('download', d => { const u = new URL(d.url()); pedidos.push(u.pathname.split('/').pop() + u.search); });
  await page.locator('.g-op').first().click();
  await espera(page, 3200);
  registra(pedidos.join(',') === 'RAIZFOTO_000000?v=redes,RAIZFOTO_000003?v=redes,RAIZFOTO_000007?v=redes',
    'Seleção: três downloads "para redes" no computador, um por foto marcada', pedidos);
  registra(estado.erros.length === 0, 'Seleção: sem erro de JS', estado.erros);
  await ctx.close();
});

// ---- 7. Página de erro (chave ausente) ------------------------------------
await cenario('Página de erro', async () => {
  const { ctx, page, estado } = await abre({ pagina: PAGINA_ERRO });
  const titulo = await page.locator('.g-erro h2').textContent();
  const passos = await page.locator('.g-erro li').count();
  registra(titulo === 'Falta conectar o site ao Google Drive' && passos === 5, 'Sem chave: a página mostra o passo a passo', { titulo, passos });
  registra(estado.erros.length === 0 && estado.csp.length === 0, 'Sem chave: sem erro de JS nem CSP', [...estado.erros, ...estado.csp]);
  await ctx.close();
});

await browser.close();

let falhas = 0;
for (const r of resultados) {
  if (!r.ok) falhas++;
  console.log(`${r.ok ? 'OK   ' : 'FALHA'} ${r.nome}${r.detalhe && !r.ok ? ` — ${r.detalhe}` : ''}`);
}
if (!sharp) console.log('\n(aviso: sem o sharp, as imagens de teste são de 1 px — a resolução escolhida é conferida pela URL mesmo assim)');
console.log(`\n${resultados.length - falhas} ok, ${falhas} falha(s)`);
process.exit(falhas ? 1 : 0);
