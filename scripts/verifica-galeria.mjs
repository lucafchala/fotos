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
// zoom que sobe a resolução, downloads (arquivo exato; no iPhone, "Salvar no
// Fotos" com o arquivo), seleção, link direto e teclado. O do servidor (portão, proxy, Drive API) está em
// tests/galeria.test.js.

/* global document, window, navigator, getComputedStyle, history, localStorage, performance, Event */
import { existsSync, readdirSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { chromium } from 'playwright-core';
import { galeriaHTML } from '../src/ui/galeria.js';
import { VENDOR } from '../src/content/vendor.js';
import { adminHtmlSecurityHeaders } from '../src/security.js';
import { vigiaCsp, provaOVigia } from './vigia-csp.mjs';
import { verificaAxe } from './axe.mjs';
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

const EVENTO = { slug: 'formatura', title: 'Formatura 2026', driveUrl: 'https://drive.google.com/drive/folders/RAIZ_PASTA_0001', driveUrlInstagram: 'https://drive.google.com/drive/folders/IG_PASTA_000001' };
const LISTAGEM = {
  v: /** @type {1} */ (1), pasta: 'RAIZ_PASTA_0001', em: '2026-10-10T12:00:00.000Z', truncada: false,
  total: TODAS.length, videos: 2, outros: 0, rk: {},
  secoes: [{ nome: '', caminho: '', fotos: raiz }, { nome: 'Festa', caminho: 'Festa', fotos: festa }],
};
// A pasta do Instagram de mentira: as fotos da raiz de índice 2, 5, 8, ... NÃO
// têm par lá (nem a subpasta Festa inteira). Nas de índice par o arquivo tem
// outro nome (001.JPG, em maiúscula), para provar que o nome baixado é o do
// arquivo da pasta do Instagram e não o da galeria.
/** @type {Map<string, [string, number, number, string, number]>} */
const REDES = new Map();
raiz.forEach((f, i) => {
  if (i % 3 === 2) return;
  const base = f[3].replace(/\.[^.]+$/, '');
  REDES.set(f[0], [`IG${f[0]}`, 1080, 1350, i % 2 === 0 ? `${base}.JPG` : f[3], 6_000_000 + i * 100]);
});
const NONCE = 'nonceDeTeste123';
const PAGINA = galeriaHTML({ event: EVENTO, listagem: LISTAGEM, erro: null, nonce: NONCE, redes: REDES });
const PAGINA_ERRO = galeriaHTML({ event: EVENTO, listagem: null, erro: { codigo: 'chave-ausente', mensagem: 'Falta a chave da Drive API (GOOGLE_DRIVE_API_KEY).' }, nonce: NONCE });

// ---- Arquivos de download --------------------------------------------------
// Bytes de teste com os 256 valores possíveis + a identificação do arquivo:
// qualquer conversão, reencode ou truncamento no caminho muda o resultado.
/** @param {string} id @param {'max' | 'redes'} variante */
const conteudo = (id, variante) => Buffer.concat([Buffer.from(Array.from({ length: 256 }, (_, i) => i)), Buffer.from(`${variante}:${id}`)]);
/** O nome que o servidor manda: o do arquivo na pasta de onde ele vem. */
const nomeBaixado = (/** @type {string} */ id, /** @type {'max' | 'redes'} */ variante) => {
  if (variante === 'redes') { const r = REDES.get(id); return r ? r[3] : null; }
  const f = POR_ID.get(id);
  return f ? f[3] : null;
};
const UA_IPHONE = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1';
const UA_ANDROID = 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Mobile Safari/537.36';

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
// O vigia de CSP enxerga e a política barra o que não tem nonce (scripts/vigia-csp.mjs).
await provaOVigia(browser, registra);

/**
 * @param {{ viewport?: { width: number, height: number }, dpr?: number, toque?: boolean, pagina?: string, url?: string, compartilhar?: boolean, semCanShare?: boolean, ua?: string, ipad?: boolean, escuro?: boolean, ocultas?: string[], recusaShare?: boolean, limite429?: number }} o
 */
async function abre(o = {}) {
  const ctx = await browser.newContext({
    colorScheme: o.escuro ? 'dark' : 'light',
    viewport: o.viewport || { width: 1440, height: 900 },
    deviceScaleFactor: o.dpr || 1,
    hasTouch: !!o.toque,
    isMobile: !!o.toque,
    acceptDownloads: true,
    ...(o.ua ? { userAgent: o.ua } : {}),
  });
  const page = await ctx.newPage();
  if (o.ipad) {
    // O iPadOS se apresenta como um Mac (plataforma MacIntel), mas tem toque.
    await page.addInitScript(() => {
      Object.defineProperty(navigator, 'platform', { value: 'MacIntel' });
      Object.defineProperty(navigator, 'maxTouchPoints', { value: 5 });
    });
  }
  if (o.compartilhar) {
    // Web Share de arquivos de mentira: guarda nome, tipo, tamanho e os bytes
    // (em base64) do que a página entrega ao sistema. Com `semCanShare`, o
    // aparelho recusa arquivos (canShare falso).
    await page.addInitScript(([recusa, recusaShare]) => {
      /** @type {any} */ (window).__compartilhados = [];
      Object.defineProperty(navigator, 'canShare', { value: (/** @type {any} */ d) => !recusa && !!(d && d.files && d.files.length) });
      Object.defineProperty(navigator, 'share', {
        value: async (/** @type {any} */ d) => {
          // `recusaShare`: o sistema recusa entregar os arquivos (erro que não é
          // cancelamento nem falta de toque) — o caso do fallback para "Arquivos".
          if (recusaShare) { const e = new Error('recusou'); e.name = 'DataError'; throw e; }
          for (const f of (d.files || [])) {
            const b = new Uint8Array(await f.arrayBuffer());
            let bin = '';
            for (const x of b) bin += String.fromCharCode(x);
            /** @type {any} */ (window).__compartilhados.push({ nome: f.name, tipo: f.type, bytes: f.size, b64: globalThis.btoa(bin) });
          }
        },
      });
    }, [!!o.semCanShare, !!o.recusaShare]);
  }
  const estado = {
    lh3: /** @type {{ id: string, w: number, webp: boolean }[]} */ ([]),
    downloads: /** @type {string[]} */ ([]),
    // Todo pedido a /baixar/ (caminho + query), inclusive os recusados com 429.
    pedidos: /** @type {string[]} */ ([]),
    erros: /** @type {string[]} */ ([]),
    csp: /** @type {string[]} */ ([]),
    ocultar: /** @type {{ foto: string, oculta: boolean }[]} */ ([]),
  };
  /** @type {Set<string>} */
  const ocultasNoServidor = new Set(o.ocultas || []);
  page.on('pageerror', e => estado.erros.push(String(e)));
  vigiaCsp(page, estado.csp);
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
    if (u.pathname === '/api/galeria/ocultar' && r.method() === 'POST') {
      const corpo = JSON.parse(r.postData() || '{}');
      estado.ocultar.push({ foto: corpo.foto, oculta: corpo.oculta });
      if (corpo.oculta) ocultasNoServidor.add(corpo.foto); else ocultasNoServidor.delete(corpo.foto);
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ocultas: [...ocultasNoServidor] }) });
    }
    const v = VENDOR.find(x => x.path === u.pathname);
    if (v) return route.fulfill({ status: 200, contentType: v.contentType, body: v.texto });
    const b = u.pathname.match(/^\/galeria\/formatura\/baixar\/([A-Za-z0-9_-]+)$/);
    if (b) {
      const variante = u.searchParams.get('v') === 'redes' ? 'redes' : 'max';
      estado.pedidos.push(u.pathname.split('/').pop() + u.search);
      // Limite por IP esgotado (Wi-Fi de evento): o servidor manda esperar.
      if (o.limite429) {
        return route.fulfill({
          status: 429,
          headers: { 'Content-Type': 'application/json', 'Retry-After': String(o.limite429) },
          body: JSON.stringify({ error: 'Muita gente acessando agora. Tentando de novo em instantes.', retryAfter: o.limite429 }),
        });
      }
      const nome = nomeBaixado(b[1], variante);
      // Como o servidor: só devolve o que existe (foto sem par no Instagram: 404).
      if (!nome) return route.fulfill({ status: 404, contentType: 'application/json', body: '{"error":"x"}' });
      estado.downloads.push(`${b[1]}:${variante}`);
      return route.fulfill({
        status: 200,
        headers: {
          'Content-Type': 'image/jpeg',
          'Content-Disposition': `attachment; filename="${nome}"; filename*=UTF-8''${encodeURIComponent(nome)}`,
          'X-Nome-Arquivo': encodeURIComponent(nome),
        },
        body: conteudo(b[1], variante),
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
      const alts = [...document.querySelectorAll('.g-t img')].map(im => /** @type {HTMLImageElement} */ (im).alt);
      // Desempenho da carga: o que é "eager"/prioritário e onde está.
      const imgs = /** @type {HTMLImageElement[]} */ ([...document.querySelectorAll('.g-t img')]);
      const topoDe = (/** @type {HTMLElement} */ el) => el.getBoundingClientRect().top + window.scrollY;
      const primeiraLinha = /** @type {HTMLElement} */ (document.querySelector('.g-linha'));
      const altas = imgs.filter(im => im.getAttribute('fetchpriority') === 'high');
      const carga = {
        altasNaPrimeiraLinha: altas.length > 0 && altas.every(im => im.closest('.g-linha') === primeiraLinha) && altas.length === primeiraLinha.querySelectorAll('img').length,
        eagerLonge: imgs.filter(im => im.loading === 'eager' && topoDe(im) > window.innerHeight * 1.5).length,
        lazyNaTela: imgs.filter(im => im.loading !== 'eager' && topoDe(im) < window.innerHeight * 0.9).length,
        coracaoCss: getComputedStyle(/** @type {Element} */ (document.querySelector('.g-fav')), '::before').backgroundImage.includes('svg'),
        svgPorFoto: document.querySelectorAll('.g-t svg').length,
      };
      return { util, desvio, tiles, nan, alts, carga, total: document.querySelectorAll('.g-t').length, rolagemLateral: document.scrollingElement.scrollWidth > window.innerWidth };
  });
  // SEO e leitor de tela: o alt diz o evento e a posição, não o nome do arquivo.
  const altEsperado = (/** @type {number} */ i) => `Formatura 2026 — foto ${i + 1} de ${TODAS.length}`;
  // Carga: só a primeira linha (a do LCP) é prioritária, só a primeira tela é
  // "eager", o CSS do visualizador não bloqueia a pintura e o coração não é um
  // <svg> por miniatura.
  registra(g.carga.altasNaPrimeiraLinha, `${nome}: fetchpriority=high só na primeira linha (a do LCP)`, g.carga);
  registra(g.carga.eagerLonge === 0 && g.carga.lazyNaTela === 0, `${nome}: "eager" só na primeira tela; o resto preguiçoso`, g.carga);
  // No HTML servido, nada de <link rel=stylesheet> do PhotoSwipe (bloquearia a
  // pintura); depois da carga o aquecimento ocioso já pode tê-lo trazido.
  registra(!/<link rel="stylesheet"[^>]*photoswipe/.test(PAGINA), `${nome}: o CSS do visualizador não bloqueia a primeira pintura (fora do HTML servido)`, '');
  registra(g.carga.coracaoCss && g.carga.svgPorFoto === 0, `${nome}: coração da miniatura em CSS, sem <svg> por foto`, g.carga);
  const exato = g.tiles.filter(t => t.ok).every(t => t.w === degrau(GALERIA_LARGURAS_GRADE, t.css * dpr));
  registra(exato, `${nome}: miniatura no menor degrau que cobre (sem baixar a mais)`, g.tiles.slice(0, 4));
  // A pré-carga do LCP (celular até 430 px) pede o MESMO arquivo que a <img>:
  // uma requisição só da primeira foto, sem desperdício.
  if (viewport.width <= 430) {
    const daPrimeira = estado.lh3.filter(x => x.id === TODAS[0][0]);
    registra(daPrimeira.length === 1, `${nome}: pré-carga da primeira foto = a miniatura que a página usa (1 pedido só)`, daPrimeira);
  }
  registra(g.alts.length === TODAS.length && g.alts.every((a, i) => a === altEsperado(i)), `${nome}: alt das fotos é "<evento> — foto i de n"`, g.alts.slice(0, 2));
  registra(g.total === TODAS.length, `${nome}: todas as ${TODAS.length} fotos na grade`, g.total);
  registra(g.desvio >= 0 && g.desvio <= 2, `${nome}: linhas justificadas (cada linha fecha na largura, ±2 px)`, { desvio: g.desvio });
  registra(!g.nan && !g.rolagemLateral, `${nome}: nenhuma largura inválida, sem rolagem lateral`, { nan: g.nan, lateral: g.rolagemLateral });
  const fisicoOk = g.tiles.filter(t => t.ok).every(t => t.w >= Math.min(degrau(GALERIA_LARGURAS_GRADE, t.css * dpr), GALERIA_LARGURAS_GRADE.at(-1)));
  registra(fisicoOk && g.tiles.some(t => t.ok), `${nome}: miniatura com pixels suficientes para a tela (largura × DPR)`, g.tiles.slice(0, 4));
  const pedidas = new Set(estado.lh3.map(x => x.id)).size;
  registra(pedidas < TODAS.length, `${nome}: carga preguiçosa (pediu ${pedidas} de ${TODAS.length} miniaturas)`, pedidas);
  registra(estado.lh3.every(x => x.webp), `${nome}: WebP (o navegador decodifica)`, estado.lh3.slice(0, 2));
  // Acessibilidade automática (axe) da grade, em dois aparelhos: nome das fotos, contraste, alvos.
  if (/^(Desktop|iPhone)/.test(nome)) await verificaAxe(page, registra, `${nome}: grade (tema claro)`);
  registra(estado.erros.length === 0 && estado.csp.length === 0, `${nome}: sem erro de JS nem mensagem de CSP`, [...estado.erros, ...estado.csp]);
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
  await verificaAxe(page, registra, 'Tema escuro: grade');
  await page.locator('.g-t').first().click();
  await page.waitForSelector('.pswp--open', { timeout: 5000 });
  await espera(page, 900);
  await verificaAxe(page, registra, 'Tema escuro: visualizador aberto');
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
  await verificaAxe(page, registra, 'Desktop: visualizador aberto (tema claro)');
  const ini = await larguraAtualDoVisualizador(page);
  const esperado = degrau([...GALERIA_LARGURAS.filter(x => x < 6000), 6000], ini.exibida * 1);
  registra(ini.w === esperado, 'Desktop: abre na resolução da tela (menor degrau que cobre a foto exibida)', { pedida: ini.w, exibida: Math.round(ini.exibida), esperado });
  const cssLb = await page.evaluate(() => {
    const l = document.querySelector('link[rel="stylesheet"][href*="photoswipe"]');
    const pswp = document.querySelector('.pswp');
    return { link: !!l, antesDoStyle: !!l && !!l.nextElementSibling && l.nextElementSibling.tagName === 'STYLE', fixo: !!pswp && getComputedStyle(pswp).position === 'fixed' };
  });
  registra(cssLb.link && cssLb.antesDoStyle && cssLb.fixo, 'Desktop: o CSS do visualizador entra ao abrir, antes do <style> da página (mesma cascata)', cssLb);
  registra(/[#]foto=RAIZFOTO_000000$/.test(page.url()), 'Desktop: o endereço ganha o link direto da foto', page.url());
  // Zoom máximo com a roda: tem de chegar ao original.
  await page.mouse.move(720, 450);
  for (let k = 0; k < 14; k++) { await page.mouse.wheel(0, -400); await page.waitForTimeout(60); }
  const max = await esperaLargura(page, 6000, 6000);
  registra(max.w === 6000, 'Desktop: zoom máximo pede o ORIGINAL (6000 px)', { pedida: max.w, src: max.src.slice(-60), itens: await page.evaluate(() => [...document.querySelectorAll('.pswp__item')].map(it => `${it.getAttribute('aria-hidden')}:${[...it.querySelectorAll('img')].map(im => im.className + '/' + im.currentSrc.slice(-12)).join(',')}`)) });
  const pedidasDaFoto = estado.lh3.filter(x => x.id === 'RAIZFOTO_000000').map(x => x.w);
  registra(pedidasDaFoto.includes(6000) && Math.min(...pedidasDaFoto.filter(w => w > 1000)) < 6000, 'Desktop: a resolução sobe por degraus, não começa no original', pedidasDaFoto);
  // Teclado: → troca a foto e o link; Esc fecha e limpa o link.
  await page.keyboard.press('ArrowRight');
  await espera(page, 600);
  registra(/[#]foto=RAIZFOTO_000001$/.test(page.url()), 'Desktop: seta → vai para a próxima foto (link atualizado)', page.url());
  const legenda = await page.locator('.pswp__g-legenda').textContent();
  registra(legenda === '002', 'Desktop: legenda mostra o número da foto', legenda);
  const altAberta = await page.evaluate(() => [...document.querySelectorAll('.pswp__item[aria-hidden="false"] img')].map(im => /** @type {HTMLImageElement} */ (im).alt).find(Boolean) || '');
  registra(altAberta === `Formatura 2026 — foto 2 de ${TODAS.length}`, 'Desktop: a foto aberta no visualizador tem o mesmo alt da grade', altAberta);
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
  registra(estado.erros.length === 0 && estado.csp.length === 0, 'iPhone: sem erro de JS nem CSP', [...estado.erros, ...estado.csp]);
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
  registra(estado.erros.length === 0 && estado.csp.length === 0, 'Link direto: sem erro de JS nem CSP', [...estado.erros, ...estado.csp]);
  await ctx.close();
});

// ---- 4. Downloads no computador e no Android --------------------------------
// Download comum: um <a download> para o servidor, sem Web Share, sem folha do
// sistema. O Playwright não intercepta essa navegação (ela vira download antes
// da rota), então aqui se confere a URL pedida — foto e versão — e que a página
// NÃO deu nome ao arquivo nem chamou o compartilhamento; o nome e os bytes
// (Content-Disposition e passagem direta do Drive) estão em tests/galeria.test.js.
const urlDe = (/** @type {import('playwright-core').Download} */ d) => { const u = new URL(d.url()); return u.pathname + u.search; };
for (const [nome, opcoes] of /** @type {const} */ ([
  ['Computador', {}],
  ['Android', { viewport: { width: 360, height: 780 }, dpr: 2, toque: true, compartilhar: true, ua: UA_ANDROID }],
])) {
  await cenario(`Downloads: ${nome}`, async () => {
    const { ctx, page, estado } = await abre(opcoes);
    const clica = (/** @type {import('playwright-core').Locator} */ l) => (opcoes.toque ? l.tap() : l.click());
    // Foto 3 (índice 2): sem par na pasta do Instagram.
    await clica(page.locator('.g-t').nth(2));
    await page.waitForSelector('.pswp--open');
    await espera(page, 800);
    await clica(page.locator('.pswp__button--g-baixar'));
    await page.waitForSelector('#g-folha:not([hidden])');
    await verificaAxe(page, registra, `${nome}: folha de download aberta sobre o visualizador`);
    const opsSem = await page.locator('.g-op strong').allTextContents();
    registra(opsSem.join('|') === 'Tamanho máximo', `${nome}: foto SEM versão do Instagram não oferece "para redes"`, opsSem);
    const detalheMax = await page.locator('.g-op span').first().textContent();
    // 15.002.000 bytes = "15 MB", em unidades decimais como o celular mostra.
    registra(/^O arquivo original · 003\.jpg · 4000 × 4000 px · 15 MB$/.test(detalheMax || ''), `${nome}: "tamanho máximo" mostra o nome exato, as dimensões e o peso do original`, detalheMax);
    registra((await page.locator('.g-btn').filter({ hasText: /Salvar/ }).count()) === 0, `${nome}: sem botão "Salvar no Fotos" (isso é só do iPhone)`, '');
    await page.keyboard.press('Escape');
    await espera(page, 400);
    registra(await page.locator('#g-folha').isHidden() && (await page.locator('.pswp--open').count()) === 1, `${nome}: Esc fecha a folha e mantém o visualizador`, '');

    // Foto 2 (índice 1): tem as duas versões, com o mesmo nome nas duas.
    await page.evaluate(() => history.back());
    await espera(page, 700);
    await clica(page.locator('.g-t').nth(1));
    await page.waitForSelector('.pswp--open');
    await espera(page, 800);
    await clica(page.locator('.pswp__button--g-baixar'));
    await page.waitForSelector('#g-folha:not([hidden])');
    const ops = await page.locator('.g-op strong').allTextContents();
    registra(ops.join('|') === 'Para redes sociais|Tamanho máximo', `${nome}: a folha oferece "para redes" e "tamanho máximo"`, ops);
    const detalheRedes = await page.locator('.g-op span').first().textContent();
    registra(/^Da pasta do Instagram, sem alteração · 002\.jpg · 6 MB$/.test(detalheRedes || ''), `${nome}: "para redes" mostra o nome e o peso do arquivo da pasta do Instagram`, detalheRedes);
    const [d1] = await Promise.all([page.waitForEvent('download'), clica(page.locator('.g-op').first())]);
    registra(urlDe(d1) === '/galeria/formatura/baixar/RAIZFOTO_000001?v=redes', `${nome}: "para redes" baixa o arquivo do Instagram da foto aberta, pelo servidor`, d1.url());
    await espera(page, 1200);
    await clica(page.locator('.pswp__button--g-baixar'));
    await page.waitForSelector('#g-folha:not([hidden])');
    const [d2] = await Promise.all([page.waitForEvent('download'), clica(page.locator('.g-op').nth(1))]);
    registra(urlDe(d2) === '/galeria/formatura/baixar/RAIZFOTO_000001?v=max', `${nome}: "tamanho máximo" baixa o original, pelo servidor`, d2.url());
    // O <a> usa download="" (o nome vem do servidor): a página nunca renomeia.
    registra(await page.evaluate(() => document.querySelectorAll('a[download]:not([download=""])').length) === 0, `${nome}: a página não dá nome ao arquivo (o nome é o do servidor)`, '');
    const comp = await page.evaluate(() => /** @type {any} */ (window).__compartilhados || []);
    registra(comp.length === 0, `${nome}: nenhum Web Share — o arquivo baixa como arquivo`, comp);
    registra(estado.erros.length === 0 && estado.csp.length === 0, `${nome}: downloads sem erro de JS nem CSP`, [...estado.erros, ...estado.csp]);
    await ctx.close();
  });
}

// ---- 5. iPhone e iPad: "Salvar no Fotos" com o ARQUIVO ----------------------
// Safari e Chrome do iOS são WebKit: a página detecta o iOS (única checagem de
// plataforma) e oferece "Salvar no Fotos" (Web Share com File(s) exatos) e
// "Baixar arquivo". O share é falso: guarda o que recebeu.
const b64 = (/** @type {Buffer} */ b) => b.toString('base64');
await cenario('iPhone', async () => {
  const { ctx, page, estado } = await abre({ viewport: { width: 390, height: 844 }, dpr: 3, toque: true, compartilhar: true, ua: UA_IPHONE });
  await page.locator('.g-t').first().tap();
  await page.waitForSelector('.pswp--open');
  await espera(page, 900);
  await page.locator('.pswp__button--g-baixar').tap();
  await page.waitForSelector('#g-folha:not([hidden])');
  await verificaAxe(page, registra, 'iPhone: folha de download aberta sobre o visualizador');
  const blocos = await page.locator('.g-ver-t strong').allTextContents();
  registra(blocos.join('|') === 'Para redes sociais|Tamanho máximo', 'iPhone: a folha tem um bloco para "para redes" e outro para "tamanho máximo"', blocos);
  const botoes = await page.locator('.g-ver-a').first().locator('.g-btn').allTextContents();
  registra(botoes.join('|') === 'Salvar no Fotos|Baixar arquivo', 'iPhone: em cada versão, "Salvar no Fotos" (principal) e "Baixar arquivo"', botoes);
  registra(/Salvar imagem/.test((await page.locator('#g-folha-msg').textContent()) || ''), 'iPhone: a folha explica o "Salvar imagem" da janela do sistema', await page.locator('#g-folha-msg').textContent());
  const alturas = await page.locator('.g-ver-a .g-btn').evaluateAll(els => els.map(e => Math.round(e.getBoundingClientRect().height)));
  registra(alturas.length === 4 && alturas.every(h => h >= 44), 'iPhone: os botões da folha têm pelo menos 44 px de altura (alvo de toque)', alturas);
  if (PRINTS) { await espera(page, 400); await page.screenshot({ path: join(PRINTS, 'folha-iphone.png') }); }

  // "Salvar no Fotos" (para redes): o File tem o nome e os bytes do arquivo do Instagram.
  await page.locator('.g-ver-a').first().locator('.g-btn').first().tap();
  await page.waitForFunction(() => /** @type {any} */ (window).__compartilhados.length >= 1, null, { timeout: 8000 });
  const c1 = await page.evaluate(() => /** @type {any} */ (window).__compartilhados);
  const esperado = conteudo('RAIZFOTO_000000', 'redes');
  registra(c1.length === 1 && c1[0].nome === '001.JPG' && c1[0].tipo === 'image/jpeg' && c1[0].bytes === esperado.length && c1[0].b64 === b64(esperado),
    'iPhone: "Salvar no Fotos" entrega ao sistema o File com o nome EXATO e os bytes EXATOS do arquivo do Instagram', { nome: c1[0] && c1[0].nome, bytes: c1[0] && c1[0].bytes });
  registra(estado.downloads.join(',') === 'RAIZFOTO_000000:redes', 'iPhone: um único pedido ao servidor, da versão certa', estado.downloads);
  await espera(page, 600);
  registra(await page.locator('#g-folha').isHidden(), 'iPhone: a folha fecha depois de enviar ao sistema', '');

  // "Salvar no Fotos" (tamanho máximo): o original, nome exato da galeria.
  await page.locator('.pswp__button--g-baixar').tap();
  await page.waitForSelector('#g-folha:not([hidden])');
  await page.locator('.g-ver-a').nth(1).locator('.g-btn').first().tap();
  await page.waitForFunction(() => /** @type {any} */ (window).__compartilhados.length >= 2, null, { timeout: 8000 });
  const c2 = (await page.evaluate(() => /** @type {any} */ (window).__compartilhados))[1];
  const orig = conteudo('RAIZFOTO_000000', 'max');
  registra(c2.nome === '001.jpg' && c2.bytes === orig.length && c2.b64 === b64(orig), 'iPhone: "Salvar no Fotos" no tamanho máximo entrega o original, nome e bytes exatos', { nome: c2.nome, bytes: c2.bytes });

  // "Baixar arquivo": download comum (app Arquivos), sem share.
  await espera(page, 600);
  await page.locator('.pswp__button--g-baixar').tap();
  await page.waitForSelector('#g-folha:not([hidden])');
  const [d] = await Promise.all([page.waitForEvent('download'), page.locator('.g-ver-a').first().locator('.g-btn').nth(1).tap()]);
  registra(urlDe(d) === '/galeria/formatura/baixar/RAIZFOTO_000000?v=redes', 'iPhone: "Baixar arquivo" é um download comum do mesmo arquivo', d.url());
  registra((await page.evaluate(() => /** @type {any} */ (window).__compartilhados)).length === 2, 'iPhone: "Baixar arquivo" não chama o compartilhamento', '');

  // Foto sem par no Instagram: só "tamanho máximo".
  await espera(page, 1200);
  await page.evaluate(() => history.back());
  await espera(page, 600);
  if ((await page.locator('.pswp--open').count()) === 1) { await page.evaluate(() => history.back()); await espera(page, 600); }
  await page.locator('.g-t').nth(2).tap();
  await page.waitForSelector('.pswp--open');
  await espera(page, 800);
  await page.locator('.pswp__button--g-baixar').tap();
  await page.waitForSelector('#g-folha:not([hidden])');
  const semIg = await page.locator('.g-ver-t strong').allTextContents();
  registra(semIg.join('|') === 'Tamanho máximo', 'iPhone: foto sem versão do Instagram não oferece "para redes"', semIg);

  // O botão voltar do sistema: com a folha aberta sobre a foto, o primeiro
  // voltar fecha só a folha; o segundo, a foto; e a pessoa continua na galeria.
  await page.evaluate(() => history.back());
  await espera(page, 600);
  const depois1 = { folha: await page.locator('#g-folha').isHidden(), foto: (await page.locator('.pswp--open').count()) === 1 };
  await page.evaluate(() => history.back());
  await espera(page, 700);
  const depois2 = { foto: (await page.locator('.pswp--open').count()) === 1, url: page.url() };
  registra(depois1.folha && depois1.foto && !depois2.foto && depois2.url === 'https://fotos.test/galeria/formatura',
    'iPhone: voltar fecha a folha, depois a foto, e fica na galeria', { depois1, depois2 });
  registra(estado.erros.length === 0 && estado.csp.length === 0, 'iPhone: sem erro de JS nem CSP', [...estado.erros, ...estado.csp]);
  await ctx.close();
});

// iPhone sem Web Share de arquivos (iOS antigo ou recusa do sistema): só "Baixar arquivo".
await cenario('iPhone sem compartilhar arquivos', async () => {
  const { ctx, page, estado } = await abre({ viewport: { width: 390, height: 844 }, dpr: 3, toque: true, compartilhar: true, semCanShare: true, ua: UA_IPHONE });
  await page.locator('.g-t').first().tap();
  await page.waitForSelector('.pswp--open');
  await espera(page, 900);
  await page.locator('.pswp__button--g-baixar').tap();
  await page.waitForSelector('#g-folha:not([hidden])');
  const botoes = await page.locator('.g-ver-a .g-btn').allTextContents();
  registra(botoes.join('|') === 'Baixar arquivo|Baixar arquivo', 'iPhone sem Web Share de arquivo: só "Baixar arquivo", sem "Salvar no Fotos"', botoes);
  const [d] = await Promise.all([page.waitForEvent('download'), page.locator('.g-ver-a .g-btn').first().tap()]);
  registra(urlDe(d) === '/galeria/formatura/baixar/RAIZFOTO_000000?v=redes', 'iPhone sem Web Share: o download comum funciona', d.url());
  registra(estado.erros.length === 0 && estado.csp.length === 0, 'iPhone sem Web Share: sem erro de JS nem CSP', [...estado.erros, ...estado.csp]);
  await ctx.close();
});

// Compartilhar uma foto, no iPhone: o arquivo é buscado só para ler (c=0), sem
// somar em "Fotos baixadas".
await cenario('Compartilhar não conta como download', async () => {
  const { ctx, page, estado } = await abre({ viewport: { width: 390, height: 844 }, dpr: 3, toque: true, compartilhar: true, ua: UA_IPHONE });
  await page.locator('.g-t').first().tap();
  await page.waitForSelector('.pswp--open');
  await espera(page, 900);
  await page.locator('.pswp__button--g-compartilhar').tap();
  await page.waitForFunction(() => /** @type {any} */ (window).__compartilhados.length >= 1, null, { timeout: 8000 });
  registra(estado.pedidos.join(',') === 'RAIZFOTO_000000?v=redes&c=0', 'Compartilhar: lê o arquivo do Instagram com c=0 (o servidor não conta como download)', estado.pedidos);
  registra(estado.erros.length === 0 && estado.csp.length === 0, 'Compartilhar: sem erro de JS nem CSP', [...estado.erros, ...estado.csp]);
  await ctx.close();
});

// iPhone recusa "Salvar no Fotos": cai no download comum, sem contar de novo, e
// a mensagem fica na folha (antes ela fechava sozinha em ~900 ms).
await cenario('iPhone recusa o Salvar no Fotos', async () => {
  const { ctx, page, estado } = await abre({ viewport: { width: 390, height: 844 }, dpr: 3, toque: true, compartilhar: true, recusaShare: true, ua: UA_IPHONE });
  await page.locator('.g-t').first().tap();
  await page.waitForSelector('.pswp--open');
  await espera(page, 900);
  await page.locator('.pswp__button--g-baixar').tap();
  await page.waitForSelector('#g-folha:not([hidden])');
  /** @type {string[]} */
  const baixados = [];
  page.on('download', d => baixados.push(urlDe(d)));
  await page.locator('.g-ver-a').first().locator('.g-btn').first().tap();
  await page.waitForFunction(() => /O iPhone n.o aceitou/.test(document.getElementById('g-folha-msg')?.textContent || ''), null, { timeout: 8000 });
  await espera(page, 2200);
  registra(await page.locator('#g-folha').isVisible(), 'Fallback do iPhone: a folha continua aberta depois de 2 s (não fecha sozinha)', '');
  registra(/O iPhone não aceitou salvar direto no Fotos/.test((await page.locator('#g-folha-msg').textContent()) || ''), 'Fallback do iPhone: a mensagem explicando o download como arquivo continua visível', await page.locator('#g-folha-msg').textContent());
  // A busca do "Salvar no Fotos" é um fetch (conta, 1 vez); o mesmo arquivo
  // baixado de novo é um download do navegador, que sai com c=0.
  registra(estado.pedidos[0] === 'RAIZFOTO_000000?v=redes' && baixados.join(',') === '/galeria/formatura/baixar/RAIZFOTO_000000?v=redes&c=0',
    'Fallback do iPhone: a busca do Fotos conta uma vez; o mesmo arquivo baixado de novo sai com c=0', { pedidos: estado.pedidos, baixados });
  registra(estado.erros.length === 0 && estado.csp.length === 0, 'Fallback do iPhone: sem erro de JS nem CSP', [...estado.erros, ...estado.csp]);
  await ctx.close();
});

// 429 do limite por IP: a página mostra a espera e NÃO repete sozinha nem a cada toque.
await cenario('Limite por IP no download (429)', async () => {
  const { ctx, page, estado } = await abre({ viewport: { width: 390, height: 844 }, dpr: 3, toque: true, compartilhar: true, ua: UA_IPHONE, limite429: 30 });
  await page.locator('.g-t').first().tap();
  await page.waitForSelector('.pswp--open');
  await espera(page, 900);
  await page.locator('.pswp__button--g-compartilhar').tap();
  await page.waitForFunction(() => /Muita gente baixando/.test(document.getElementById('g-aviso-flut')?.textContent || ''), null, { timeout: 8000 });
  const aviso = (await page.locator('#g-aviso-flut').textContent()) || '';
  registra(/Muita gente baixando agora\. Tente de novo em \d+ s\./.test(aviso), 'Limite: o Compartilhar mostra a espera que o servidor mandou', aviso);
  await page.locator('.pswp__button--g-compartilhar').tap();
  await page.locator('.pswp__button--g-baixar').tap();
  await page.waitForSelector('#g-folha:not([hidden])');
  await page.locator('.g-ver-a').first().locator('.g-btn').first().tap();
  await espera(page, 800);
  const msg = (await page.locator('#g-folha-msg').textContent()) || '';
  registra(/Muita gente baixando agora\. Tente de novo em \d+ s\./.test(msg), 'Limite: "Salvar no Fotos" mostra a mesma espera na folha', msg);
  /** @type {string[]} */
  const baixados = [];
  page.on('download', d => baixados.push(urlDe(d)));
  await page.locator('.g-ver-a').first().locator('.g-btn').nth(1).tap();
  await espera(page, 2500);
  registra(estado.pedidos.length === 1 && baixados.length === 0, 'Limite: depois do 429 nenhum outro pedido sai durante a espera (nem laço, nem toque, nem "Baixar arquivo")', { pedidos: estado.pedidos, baixados });
  registra(await page.locator('#g-folha').isVisible(), 'Limite: a folha fica aberta com o aviso', '');
  registra(estado.erros.length === 0 && estado.csp.length === 0, 'Limite: sem erro de JS nem CSP', [...estado.erros, ...estado.csp]);
  await ctx.close();
});

// iPad: finge ser um Mac (UA e plataforma), mas tem toque — também é iOS.
await cenario('iPad', async () => {
  const UA_IPAD = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Safari/605.1.15';
  const { ctx, page, estado } = await abre({ viewport: { width: 820, height: 1180 }, dpr: 2, toque: true, compartilhar: true, ua: UA_IPAD, ipad: true });
  await page.locator('.g-t').first().tap();
  await page.waitForSelector('.pswp--open');
  await espera(page, 900);
  await page.locator('.pswp__button--g-baixar').tap();
  await page.waitForSelector('#g-folha:not([hidden])');
  const botoes = await page.locator('.g-ver-a').first().locator('.g-btn').allTextContents();
  registra(botoes.join('|') === 'Salvar no Fotos|Baixar arquivo', 'iPad (plataforma Mac com toque): também oferece "Salvar no Fotos"', botoes);
  registra(estado.erros.length === 0 && estado.csp.length === 0, 'iPad: sem erro de JS nem CSP', [...estado.erros, ...estado.csp]);
  await ctx.close();
});

// ---- 6. Seleção ------------------------------------------------------------
// Três fotos marcadas, UMA sem versão do Instagram (a 6ª, índice 5).
await cenario('Seleção', async () => {
  const { ctx, page, estado } = await abre({});
  await page.locator('#g-sel').click();
  for (const i of [0, 3, 5]) await page.locator('.g-t').nth(i).click();
  registra((await page.locator('#g-barra-n').textContent()) === '3 selecionadas', 'Seleção: marca três fotos', await page.locator('#g-barra-n').textContent());
  const nomes = await page.locator('.g-t.sel').evaluateAll(els => els.map(e => e.getAttribute('aria-label')));
  registra(nomes.join('|') === 'Foto 001, selecionada|Foto 004, selecionada|Foto 006, selecionada', 'Seleção: o leitor de tela ouve "selecionada" no nome da foto', nomes);
  registra((await page.locator('.pswp--open').count()) === 0, 'Seleção: no modo seleção, tocar marca em vez de abrir', '');
  await page.reload();
  await espera(page, 900);
  registra((await page.locator('#g-barra-n').textContent()) === '3 selecionadas' && (await page.locator('.g-t.sel').count()) === 3, 'Seleção: sobrevive a recarregar a página', '');
  await page.locator('[data-acao="baixar-sel"]').click();
  await page.waitForSelector('#g-folha:not([hidden])');
  registra((await page.locator('#g-folha-t').textContent()) === 'Baixar 3 fotos', 'Seleção: a folha baixa as três', await page.locator('#g-folha-t').textContent());
  const detalhes = await page.locator('.g-op span').allTextContents();
  registra(/^2 de 3 fotos têm esta versão \(as outras ficam de fora\)/.test(detalhes[0] || ''), 'Seleção: "para redes" diz quantas das fotos têm a versão', detalhes[0]);
  registra(/^Os arquivos originais, sem alteração/.test(detalhes[1] || ''), 'Seleção: "tamanho máximo" cobre as três', detalhes[1]);
  if (PRINTS) await page.screenshot({ path: join(PRINTS, 'selecao-desktop.png') });
  /** @type {string[]} */
  const pedidos = [];
  page.on('download', d => { const u = new URL(d.url()); pedidos.push(u.pathname.split('/').pop() + u.search); });
  await page.locator('.g-op').first().click();
  await espera(page, 3200);
  registra(pedidos.join(',') === 'RAIZFOTO_000000?v=redes,RAIZFOTO_000003?v=redes',
    'Seleção: "para redes" baixa só as duas fotos que têm a versão, uma a uma', pedidos);
  await page.locator('[data-acao="baixar-sel"]').click();
  await page.waitForSelector('#g-folha:not([hidden])');
  pedidos.length = 0;
  await page.locator('.g-op').nth(1).click();
  await espera(page, 3200);
  registra(pedidos.join(',') === 'RAIZFOTO_000000?v=max,RAIZFOTO_000003?v=max,RAIZFOTO_000005?v=max',
    'Seleção: "tamanho máximo" baixa as três, um download por foto', pedidos);
  registra(estado.erros.length === 0 && estado.csp.length === 0, 'Seleção: sem erro de JS nem CSP', [...estado.erros, ...estado.csp]);
  await ctx.close();
});

// Seleção no iPhone: "Salvar N fotos no Fotos" com os arquivos exatos de cada uma.
await cenario('Seleção no iPhone', async () => {
  const { ctx, page, estado } = await abre({ viewport: { width: 390, height: 844 }, dpr: 3, toque: true, compartilhar: true, ua: UA_IPHONE });
  await page.locator('#g-sel').tap();
  for (const i of [0, 1, 5]) await page.locator('.g-t').nth(i).tap();
  await page.locator('[data-acao="baixar-sel"]').tap();
  await page.waitForSelector('#g-folha:not([hidden])');
  const rotulos = await page.locator('.g-ver-a').first().locator('.g-btn').allTextContents();
  registra(rotulos.join('|') === 'Salvar 2 fotos no Fotos|Baixar arquivo', 'Seleção no iPhone: o botão diz quantas fotos vão para o Fotos (as que têm a versão)', rotulos);
  await page.locator('.g-ver-a').first().locator('.g-btn').first().tap();
  await page.waitForFunction(() => /** @type {any} */ (window).__compartilhados.length >= 2, null, { timeout: 8000 });
  const comp = await page.evaluate(() => /** @type {any} */ (window).__compartilhados);
  registra(comp.length === 2 && comp[0].nome === '001.JPG' && comp[1].nome === '002.jpg'
    && comp[0].b64 === b64(conteudo('RAIZFOTO_000000', 'redes')) && comp[1].b64 === b64(conteudo('RAIZFOTO_000001', 'redes')),
  'Seleção no iPhone: uma só folha do sistema, com os arquivos exatos (nome e bytes) das duas fotos', comp.map(( /** @type {any} */ c) => c.nome));
  registra(estado.downloads.join(',') === 'RAIZFOTO_000000:redes,RAIZFOTO_000001:redes', 'Seleção no iPhone: só as fotos com a versão são pedidas', estado.downloads);
  registra(estado.erros.length === 0 && estado.csp.length === 0, 'Seleção no iPhone: sem erro de JS nem CSP', [...estado.erros, ...estado.csp]);
  await ctx.close();
});

// ---- 6b. Cabeçalho, chips, favoritas, "Baixar tudo" e voltar ao topo ----------
await cenario('Cabeçalho e favoritas', async () => {
  const { ctx, page, estado } = await abre({});
  const chips = await page.locator('.g-chip[data-acao="ir-sec"]').allTextContents();
  registra(chips.join('|') === 'Fotos24|Festa220', 'Chips: uma por seção, com a contagem', chips);
  registra(await page.locator('.g-chip[aria-current="true"]').count() === 1, 'Chips: exatamente uma seção está marcada como atual', '');
  await page.locator('.g-chip[data-sec="1"]').click();
  await espera(page, 1200);
  const atual = await page.locator('.g-chip[aria-current="true"]').textContent();
  registra(/^Festa/.test(atual || ''), 'Chips: tocar numa seção leva até ela e a marca como atual', atual);

  // Favoritar pelo coração da miniatura (no desktop ele aparece ao passar o mouse).
  await page.locator('.g-chip[data-sec="0"]').click();
  await espera(page, 800);
  await page.locator('.g-t').nth(1).hover();
  await page.locator('.g-t').nth(1).locator('.g-fav').click();
  await page.locator('.g-t').nth(4).hover();
  await page.locator('.g-t').nth(4).locator('.g-fav').click();
  registra(await page.locator('.g-t.fav').count() === 2 && (await page.locator('.pswp--open').count()) === 0,
    'Favoritas: o coração marca sem abrir a foto', await page.locator('.g-t.fav').count());
  const chipFav = await page.locator('.g-chip[data-acao="filtro-fav"]').textContent();
  registra(chipFav === 'Favoritas2', 'Favoritas: aparece o chip com a contagem', chipFav);
  const guardado = await page.evaluate(() => localStorage.getItem('galeria:fav:formatura'));
  registra(!!guardado && guardado.includes('RAIZFOTO_000001') && guardado.includes('RAIZFOTO_000004'), 'Favoritas: ficam guardadas só neste aparelho (localStorage)', guardado || '');

  await page.locator('.g-chip[data-acao="filtro-fav"]').click();
  await espera(page, 600);
  registra(await page.locator('.g-t:visible').count() === 2 && (await page.locator('.g-chip[data-acao="ir-sec"]').count()) === 0,
    'Favoritas: o filtro mostra só as favoritas e esconde os chips de seção', await page.locator('.g-t:visible').count());
  await page.reload();
  await espera(page, 900);
  registra(await page.locator('.g-t.fav').count() === 2, 'Favoritas: sobrevivem a recarregar a página', '');

  // Fora do filtro: "Baixar tudo" oferece o Drive e as favoritas.
  const filtrando = await page.locator('.g-chip[aria-pressed="true"]').count();
  if (filtrando) await page.locator('.g-chip[data-acao="filtro-fav"]').click();
  await page.locator('[data-acao="baixar-tudo"]').click();
  await page.waitForSelector('#g-folha:not([hidden])');
  const titulo = await page.locator('#g-folha-t').textContent();
  const ops = await page.locator('.g-op strong').allTextContents();
  registra(titulo === 'Baixar tudo' && ops.some(t => /Google Drive/.test(t)) && ops.some(t => /favoritas \(2\)/.test(t)),
    '"Baixar tudo": oferece o Drive e as favoritas', { titulo, ops });
  await page.keyboard.press('Escape');
  await espera(page, 400);

  // Seleção: "Selecionar todas" por seção e Shift+clique para intervalo.
  await page.locator('#g-sel').click();
  await page.locator('[data-acao="sel-secao"][data-sec="0"]').click();
  registra(await page.locator('.g-t.sel').count() === 24, '"Selecionar todas" marca a seção inteira', await page.locator('.g-t.sel').count());
  await page.locator('[data-acao="limpar-sel"]').click();
  await page.locator('.g-t').nth(2).click();
  await page.locator('.g-t').nth(6).click({ modifiers: ['Shift'] });
  registra(await page.locator('.g-t.sel').count() === 5, 'Shift+clique seleciona o intervalo', await page.locator('.g-t.sel').count());
  await page.locator('[data-acao="fim-sel"]').click();

  // Voltar ao topo: some no topo, aparece rolando, volta e leva o foco ao título.
  registra(!(await page.locator('#g-topo').evaluate(e => e.classList.contains('on'))), 'Voltar ao topo: escondido no começo da página', '');
  await page.evaluate(() => window.scrollTo(0, 3000));
  await espera(page, 600);
  registra(await page.locator('#g-topo').evaluate(e => e.classList.contains('on')), 'Voltar ao topo: aparece depois de rolar', '');
  await page.locator('#g-topo').click();
  await espera(page, 1200);
  const volta = await page.evaluate(() => ({ y: window.scrollY, foco: document.activeElement && document.activeElement.id }));
  registra(volta.y === 0 && volta.foco === 'g-h1', 'Voltar ao topo: volta ao início e leva o foco ao título', volta);
  registra(estado.erros.length === 0 && estado.csp.length === 0, 'Cabeçalho e favoritas: sem erro de JS nem CSP', [...estado.erros, ...estado.csp]);
  await ctx.close();
});

// ---- 6c. Centenas de fotos: carga preguiçosa e custo do layout -------------
await cenario('Centenas de fotos', async () => {
  const N = 800;
  const muitas = Array.from({ length: N }, (_, i) => {
    const [w, h] = FORMATOS[i % FORMATOS.length];
    return /** @type {[string, number, number, string, number]} */ ([pid('MUITAFOTO', i), w, h, `m-${i + 1}.jpg`, 9_000_000]);
  });
  for (const f of muitas) POR_ID.set(f[0], f);
  const listagem = { ...LISTAGEM, total: N, secoes: [{ nome: '', caminho: '', fotos: muitas }] };
  const pagina = galeriaHTML({ event: EVENTO, listagem, erro: null, nonce: NONCE });
  const { ctx, page, estado } = await abre({ pagina, viewport: { width: 1440, height: 900 } });
  const miniaturas = await page.locator('.g-t').count();
  registra(miniaturas === N, `${N} fotos: todas as miniaturas existem na grade`, miniaturas);
  registra(estado.lh3.length <= 80, `${N} fotos: só as da tela (e um pouco mais) são pedidas ao carregar`, estado.lh3.length);
  const custo = await page.evaluate(() => {
    const t0 = performance.now();
    window.dispatchEvent(new Event('resize'));
    document.body.getBoundingClientRect();
    return performance.now() - t0;
  });
  registra(custo < 250, `${N} fotos: refazer a grade (resize) leva menos de 250 ms`, `${Math.round(custo)} ms`);
  for (let y = 0; y <= 12000; y += 3000) { await page.evaluate(v => window.scrollTo(0, v), y); await page.waitForTimeout(60); }
  await page.waitForTimeout(500);
  registra(estado.lh3.length < N * 0.5, `${N} fotos: rolar 12 mil px não baixa tudo (${estado.lh3.length} pedidos)`, estado.lh3.length);
  const tarefas = await page.evaluate(() => performance.getEntriesByType('longtask').length);
  registra(tarefas <= 8, `${N} fotos: poucas tarefas longas na rolagem`, tarefas);
  registra(estado.erros.length === 0 && estado.csp.length === 0, `${N} fotos: sem erro de JS nem CSP`, [...estado.erros, ...estado.csp]);
  await ctx.close();
});

// ---- 6d. Ocultar dos visitantes (só o dono) ---------------------------------
await cenario('Ocultar', async () => {
  const JA = pid('RAIZFOTO', 1);
  const ALVO = pid('RAIZFOTO', 0);
  const pagina = galeriaHTML({ event: EVENTO, listagem: LISTAGEM, erro: null, nonce: NONCE, dono: true, ocultas: [JA], redes: REDES });
  const { ctx, page, estado } = await abre({ pagina, ocultas: [JA] });
  const marcada = await page.evaluate(id => {
    const a = document.querySelector('.g-t[href="#foto=' + id + '"]');
    const selo = a && a.querySelector('.g-oc');
    return { classe: !!a && a.classList.contains('oculta'), selo: selo ? getComputedStyle(selo).display : '' };
  }, JA);
  registra(marcada.classe && marcada.selo === 'block', 'Dono: a foto já oculta aparece apagada, com o selo "Oculta"', marcada);
  registra((await page.locator('#g-n-ocultas').textContent()) === '1 oculta para os visitantes', 'Dono: a faixa diz quantas estão ocultas');
  await page.locator(`.g-t[href="#foto=${ALVO}"]`).click();
  await page.waitForSelector('.pswp--open', { timeout: 5000 });
  await espera(page, 500);
  const botao = page.locator('.pswp__button--g-ocultar');
  registra((await botao.count()) === 1 && (await botao.getAttribute('aria-pressed')) === 'false', 'Dono: o visualizador tem o botão de ocultar, desligado numa foto visível');
  await botao.click();
  await espera(page, 400);
  const depois = await page.evaluate(id => document.querySelector('.g-t[href="#foto=' + id + '"]')?.classList.contains('oculta'), ALVO);
  registra(estado.ocultar.length === 1 && estado.ocultar[0].foto === ALVO && estado.ocultar[0].oculta === true && depois === true
    && (await botao.getAttribute('aria-pressed')) === 'true', 'Dono: ocultar grava no servidor e marca a miniatura', estado.ocultar);
  registra((await page.locator('#g-aviso-flut').textContent() || '').startsWith('Oculta para os visitantes'), 'Dono: um aviso confirma que ocultou');
  registra((await page.locator('#g-n-ocultas').textContent()) === '2 ocultas para os visitantes', 'Dono: a contagem da faixa acompanha');
  await botao.click();
  await espera(page, 400);
  const voltou = await page.evaluate(id => document.querySelector('.g-t[href="#foto=' + id + '"]')?.classList.contains('oculta'), ALVO);
  registra(estado.ocultar.length === 2 && estado.ocultar[1].oculta === false && voltou === false, 'Dono: tocar de novo mostra a foto aos visitantes', estado.ocultar);
  if (PRINTS) await page.screenshot({ path: join(PRINTS, 'galeria-ocultar.png') });
  registra(estado.erros.length === 0 && estado.csp.length === 0, 'Ocultar: sem erro de JS nem CSP', [...estado.erros, ...estado.csp]);
  await ctx.close();

  // No celular, a barra do dono tem um botão a mais: todos cabem na tela.
  const cel = await abre({ pagina, ocultas: [JA], viewport: { width: 360, height: 780 }, dpr: 3, toque: true });
  await cel.page.locator('.g-t').first().click();
  await cel.page.waitForSelector('.pswp--open', { timeout: 5000 });
  await espera(cel.page, 500);
  const caixas = await cel.page.evaluate(() => [...document.querySelectorAll('.pswp__top-bar .pswp__button')]
    .filter(b => getComputedStyle(b).display !== 'none')
    .map(b => { const r = b.getBoundingClientRect(); return { n: b.className.replace(/.*pswp__button--/, ''), l: Math.round(r.left), r: Math.round(r.right) }; }));
  const cont = await cel.page.evaluate(() => { const c = document.querySelector('.pswp__counter'); const r = c ? c.getBoundingClientRect() : null; return r ? { dir: Math.round(r.right), alt: Math.round(r.height) } : { dir: 0, alt: 0 }; });
  registra(caixas.some(c => c.n === 'g-ocultar') && caixas.every(c => c.l >= 0 && c.r <= 360) && Math.min(...caixas.map(c => c.l)) >= cont.dir && cont.alt <= 40,
    'Dono no celular (360 px): a barra do visualizador cabe, com o contador numa linha só', { cont, caixas });
  if (PRINTS) await cel.page.screenshot({ path: join(PRINTS, 'galeria-ocultar-celular.png') });
  await cel.ctx.close();

  const visit = await abre({ pagina: galeriaHTML({ event: EVENTO, listagem: LISTAGEM, erro: null, nonce: NONCE, dono: false, redes: REDES }) });
  await visit.page.locator('.g-t').first().click();
  await visit.page.waitForSelector('.pswp--open', { timeout: 5000 });
  await espera(visit.page, 400);
  registra((await visit.page.locator('.pswp__button--g-ocultar').count()) === 0 && (await visit.page.locator('.g-oc').count()) === 0,
    'Visitante: nem botão de ocultar nem selo "Oculta"');
  await visit.ctx.close();
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
