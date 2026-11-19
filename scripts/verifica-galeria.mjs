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

/* global MutationObserver, document, window, navigator, getComputedStyle, history, localStorage, sessionStorage, performance, Event, HTMLAnchorElement, MediaRecorder, Blob, btoa, setInterval, clearInterval, location */
import { existsSync, readdirSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { chromium } from 'playwright-core';
import { galeriaHTML, GALERIA_JS } from '../src/ui/galeria.js';
import { galeriaIndiceHTML } from '../src/ui/galeria-indice.js';
import { nomeAmigavel } from '../src/nomes.js';
import { VENDOR } from '../src/content/vendor.js';
import { adminHtmlSecurityHeaders } from '../src/security.js';
import { assinadorDeFotos } from '../src/foto-rota.js';
import { vigiaCsp, provaOVigia } from './vigia-csp.mjs';
import { verificaAxe } from './axe.mjs';
import { GALERIA_LARGURAS, GALERIA_LARGURAS_GRADE, AQUECE_LARGURAS, EPOCA_CRIADA_MS, fatorMiniatura, MINIATURA_DPR_TETO } from '../src/config.js';

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
// A página como o servidor a monta (v3.8.8): com a assinatura do site no
// endereço de cada foto (`as` nos dados; src/foto-rota.js). O roteiro confere
// que TODO pedido de foto sai do navegador com o `k`.
const SEGREDO_DE_TESTE = 'x'.repeat(40);
/** @param {Parameters<typeof galeriaHTML>[0]} o */
async function paginaAssinada(o) {
  const ids = o.listagem ? o.listagem.secoes.flatMap(sec => sec.fotos.map(f => f[0])) : [];
  return galeriaHTML({ ...o, assina: await assinadorDeFotos(SEGREDO_DE_TESTE, String(o.event.slug), ids) });
}
const PAGINA = await paginaAssinada({ event: EVENTO, listagem: LISTAGEM, erro: null, nonce: NONCE, redes: REDES });
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

// O Turnstile de mentira: entrega um token logo depois do render() e outro a
// cada reset(), como o de verdade (que só vale uma vez). Os testes de servidor
// provam a verificação; aqui interessa QUANDO o script é pedido e o que a
// página faz com o token.
const TURNSTILE_FALSO = `(function(){
  var n = 0, o = null;
  function entrega() { setTimeout(function () { if (o) o.callback('tok-' + (++n)); }, 80); }
  window.turnstile = {
    render: function (sel, opcoes) { o = opcoes; entrega(); return 'w1'; },
    reset: function () { entrega(); },
  };
})();`;

const browser = await chromium.launch({ executablePath: chromiumLocal() });

// Um vídeo de verdade (WebM VP8, 2,5 s, retrato) gravado pelo próprio Chromium
// a partir de um canvas: o player é testado tocando, pausando e avançando um
// arquivo real, sem depender de ffmpeg nem de arquivo binário no repositório.
const VIDEO_WEBM = await (async () => {
  const p = await browser.newPage();
  try {
    const b64 = await p.evaluate(async () => {
      const c = document.createElement('canvas');
      c.width = 180; c.height = 320;
      const g = /** @type {CanvasRenderingContext2D} */ (c.getContext('2d'));
      let i = 0;
      const t = setInterval(() => { g.fillStyle = `hsl(${(i++ * 25) % 360},70%,50%)`; g.fillRect(0, 0, 180, 320); }, 50);
      const rec = new MediaRecorder(c.captureStream(20), { mimeType: 'video/webm;codecs=vp8' });
      /** @type {Blob[]} */
      const partes = [];
      rec.ondataavailable = e => partes.push(e.data);
      rec.start();
      await new Promise(r => setTimeout(r, 2500));
      rec.stop();
      await new Promise(r => { rec.onstop = r; });
      clearInterval(t);
      const bytes = new Uint8Array(await new Blob(partes).arrayBuffer());
      let bin = '';
      for (const x of bytes) bin += String.fromCharCode(x);
      return btoa(bin);
    });
    return Buffer.from(b64, 'base64');
  } catch {
    return null;
  } finally {
    await p.close();
  }
})();
// O vigia de CSP enxerga e a política barra o que não tem nonce (scripts/vigia-csp.mjs).
await provaOVigia(browser, registra);

/**
 * @param {{ viewport?: { width: number, height: number }, dpr?: number, toque?: boolean, pagina?: string, url?: string, semScript?: boolean, compartilhar?: boolean, semCanShare?: boolean, ua?: string, ipad?: boolean, escuro?: boolean, ocultas?: string[], recusaShare?: boolean, limite429?: number, limite429Vezes?: number, turnstile?: 'ok' | 'bloqueado', remocao?: (corpo: any) => { status: number, json: any }, driveFrame?: boolean }} o
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
  if (o.conexao) {
    // A rede que o Chrome anuncia (navigator.connection.effectiveType).
    await page.addInitScript(tipo => {
      Object.defineProperty(navigator, 'connection', { value: { effectiveType: tipo, addEventListener() {} } });
    }, o.conexao);
  }
  if (o.vigiaRede) {
    // O histórico do modo rede ruim (#g-main[data-rede]).
    await page.addInitScript(() => {
      /** @type {any} */ (window).__rede = [];
      document.addEventListener('DOMContentLoaded', () => {
        const m = document.getElementById('g-main');
        if (!m) return;
        /** @type {any} */ (window).__rede.push(m.dataset.rede || '');
        new MutationObserver(() => /** @type {any} */ (window).__rede.push(m.dataset.rede || '')).observe(m, { attributes: true, attributeFilter: ['data-rede'] });
      });
    });
  }
  if (o.semStorage) {
    await page.addInitScript(() => { Object.defineProperty(window, 'localStorage', { get() { throw new Error('bloqueado'); } }); });
  }
  if (o.storage) {
    // localStorage semeado antes da página rodar (só na primeira carga da aba,
    // para um recarregamento ver o que a própria página gravou).
    await page.addInitScript(entradas => {
      if (window.sessionStorage.getItem('__semeado')) return;
      window.sessionStorage.setItem('__semeado', '1');
      for (const [k, v] of entradas) localStorage.setItem(k, v);
    }, Object.entries(o.storage));
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
          if (d.url) /** @type {any} */ (window).__compartilhados.push({ url: d.url, files: (d.files || []).length });
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
    lh3: /** @type {{ id: string, w: number, webp: boolean, site: boolean, k: string }[]} */ ([]),
    downloads: /** @type {string[]} */ ([]),
    // Todo pedido a /baixar/ (caminho + query), inclusive os recusados com 429.
    pedidos: /** @type {string[]} */ ([]),
    erros: /** @type {string[]} */ ([]),
    csp: /** @type {string[]} */ ([]),
    ocultar: /** @type {{ foto: string, oculta: boolean }[]} */ ([]),
    // Quantas vezes o script do Turnstile foi pedido, e os corpos enviados a
    // /api/galeria/remocao ("Pedir remoção").
    turnstile: 0,
    // Pedidos ao player do Drive (item 1f): só depois do toque no play.
    drive: /** @type {string[]} */ ([]),
    // Pedidos à rota de vídeo do próprio site (v4.3.0), com o Range de cada um.
    video: /** @type {{ id: string, range: string }[]} */ ([]),
    remocao: /** @type {any[]} */ ([]),
  };
  /** @type {Set<string>} */
  const ocultasNoServidor = new Set(o.ocultas || []);
  page.on('pageerror', e => estado.erros.push(String(e)));
  vigiaCsp(page, estado.csp);
  await page.route('**/*', async route => {
    const r = route.request();
    const u = new URL(r.url());
    // As fotos pelo próprio site (v3.8.3): /f/<id>/<largura>[j]. O "j" pede JPEG.
    const fotoSite = u.host === 'fotos.test' ? u.pathname.match(/^\/f\/([A-Za-z0-9_-]+)\/(\d+)(j?)$/) : null;
    if (u.host === 'lh3.googleusercontent.com' || fotoSite) {
      const m = fotoSite ? [fotoSite[0], fotoSite[1], fotoSite[2], fotoSite[3] ? '' : '-rw'] : u.pathname.match(/^\/d\/([A-Za-z0-9_-]+)=w(\d+)(-rw)?$/);
      if (!m) return route.fulfill({ status: 404, body: '' });
      estado.lh3.push({ id: m[1], w: Number(m[2]), webp: !!m[3], site: !!fotoSite, k: u.searchParams.get('k') || '' });
      // `falhaFotos: N`: os N primeiros pedidos de foto falham (a rajada do lançamento).
      if (o.falhaFotos && estado.lh3.length <= o.falhaFotos) return route.fulfill({ status: 502, body: '' });
      // `atrasoFoto(n)`: espera (ms) antes de responder o n-ésimo pedido de foto (rede ruim).
      const atraso = o.atrasoFoto ? o.atrasoFoto(estado.lh3.length) : 0;
      if (atraso) await new Promise(r => setTimeout(r, atraso));
      const img = await imagem(m[1], Number(m[2]), !!m[3]);
      return route.fulfill({ contentType: img.tipo, body: img.corpo });
    }
    if (u.host === 'challenges.cloudflare.com') {
      estado.turnstile++;
      if (o.turnstile === 'bloqueado') return route.abort();
      return route.fulfill({ contentType: 'text/javascript', body: TURNSTILE_FALSO });
    }
    if (u.host === 'drive.google.com') estado.drive.push(u.pathname);
    if (u.host !== 'fotos.test') return route.fulfill({ status: 204, body: '' });
    if (u.pathname === '/api/galeria/remocao' && r.method() === 'POST') {
      const corpo = JSON.parse(r.postData() || '{}');
      estado.remocao.push(corpo);
      const resp = (o.remocao || (() => ({ status: 200, json: { ok: true } })))(corpo);
      return route.fulfill({ status: resp.status, contentType: 'application/json', body: JSON.stringify(resp.json) });
    }
    if (u.pathname === '/galeria/formatura' || u.pathname === '/galeria/formatura/cerimonia') {
      return route.fulfill({ status: 200, headers: adminHtmlSecurityHeaders(NONCE, o.driveFrame ? { driveFrame: true } : undefined), body: o.pagina || PAGINA });
    }
    if (u.pathname === '/api/galeria/ocultar' && r.method() === 'POST') {
      const corpo = JSON.parse(r.postData() || '{}');
      estado.ocultar.push({ foto: corpo.foto, oculta: corpo.oculta });
      if (corpo.oculta) ocultasNoServidor.add(corpo.foto); else ocultasNoServidor.delete(corpo.foto);
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ocultas: [...ocultasNoServidor] }) });
    }
    // O script da galeria é arquivo desde a v4.1.0 (#252).
    // `semScript`: a página como ela é ANTES de o script chegar (rede lenta).
    if (u.pathname === GALERIA_JS.path && o.semScript) return route.abort();
    if (u.pathname === GALERIA_JS.path) return route.fulfill({ status: 200, contentType: 'text/javascript', body: GALERIA_JS.texto });
    const v = VENDOR.find(x => x.path === u.pathname);
    if (v) return route.fulfill({ status: 200, contentType: v.contentType, body: v.texto });
    // O vídeo tocado no site (v4.3.0): um WebM de verdade, com Range como o
    // servidor. `videoFalha`: a rota responde 502 (o player cai no Drive).
    const vm = u.pathname.match(/^\/galeria\/formatura(?:\/cerimonia)?\/video\/([A-Za-z0-9_-]+)$/);
    if (vm) {
      const range = (await r.allHeaders()).range || '';
      estado.video.push({ id: vm[1], range });
      if (o.videoFalha || !VIDEO_WEBM) return route.fulfill({ status: 502, body: '' });
      const total = VIDEO_WEBM.length;
      const m = /^bytes=(\d+)-(\d*)$/.exec(range);
      if (!m) return route.fulfill({ status: 200, headers: { 'Content-Type': 'video/webm', 'Accept-Ranges': 'bytes', 'Content-Length': String(total) }, body: VIDEO_WEBM });
      const a = Number(m[1]);
      const z = m[2] ? Math.min(Number(m[2]), total - 1) : total - 1;
      if (a >= total) return route.fulfill({ status: 416, headers: { 'Content-Range': `bytes */${total}` }, body: '' });
      return route.fulfill({ status: 206, headers: { 'Content-Type': 'video/webm', 'Accept-Ranges': 'bytes', 'Content-Range': `bytes ${a}-${z}/${total}`, 'Content-Length': String(z - a + 1) }, body: VIDEO_WEBM.subarray(a, z + 1) });
    }
    const b = u.pathname.match(/^\/galeria\/formatura(?:\/cerimonia)?\/baixar\/([A-Za-z0-9_-]+)$/);
    if (b) {
      const variante = u.searchParams.get('v') === 'redes' ? 'redes' : 'max';
      estado.pedidos.push(u.pathname.split('/').pop() + u.search);
      // Limite por IP esgotado (Wi-Fi de evento): o servidor manda esperar.
      // limite429Vezes: só os N primeiros pedidos recebem 429 (depois libera).
      if (o.limite429 && (!o.limite429Vezes || estado.pedidos.length <= o.limite429Vezes)) {
        return route.fulfill({
          status: 429,
          headers: { 'Content-Type': 'application/json', 'Retry-After': String(o.limite429) },
          body: JSON.stringify({ error: 'Muita gente acessando agora. Tentando de novo em instantes.', retryAfter: o.limite429 }),
        });
      }
      const nome = nomeBaixado(b[1], variante);
      // Sonda "está pronto?" (?p=1): o servidor responde 204 sem corpo.
      if (u.searchParams.get('p') === '1') return route.fulfill({ status: nome ? 204 : 404, body: '' });
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
  if (o.cpu) {
    // Celular lento: o Chromium roda o JS `o.cpu` vezes mais devagar.
    const cdp = await ctx.newCDPSession(page);
    await cdp.send('Emulation.setCPUThrottlingRate', { rate: o.cpu });
    if (process.env.MEDE_PERFIL) {
      await cdp.send('Performance.enable');
      await cdp.send('Profiler.enable');
      await cdp.send('Profiler.setSamplingInterval', { interval: 200 });
      await cdp.send('Profiler.start');
      /** @type {any} */ (page).__cdp = cdp;
    }
  }
  if (o.medeTarefas) {
    await page.addInitScript(() => {
      /** @type {any} */ (window).__longas = [];
      new window.PerformanceObserver(l => { for (const e of l.getEntries()) /** @type {any} */ (window).__longas.push([Math.round(e.startTime), Math.round(e.duration)]); }).observe({ type: 'longtask', buffered: true });
    });
  }
  await page.goto(o.url || 'https://fotos.test/galeria/formatura');
  await page.waitForTimeout(o.esperaAbrir ?? 900);
  return { ctx, page, estado };
}

/** A menor largura da escada que cobre `px` — o que o navegador deve pedir. */
const degrau = (/** @type {number[]} */ escada, /** @type {number} */ px) => escada.find(x => x >= px) ?? escada[escada.length - 1];

/** @param {import('playwright-core').Page} page */
const larguraAtualDoVisualizador = page => page.evaluate(() => {
  const img = /** @type {HTMLImageElement | null} */ (document.querySelector('.pswp__item:not([aria-hidden="true"]) img.pswp__img:not(.pswp__img--placeholder)'));
  const m = img && img.currentSrc.match(/(?:=w|\/f\/[A-Za-z0-9_-]+\/)(\d+)/);
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
// SO_CENARIO=<trecho do nome>: roda só os cenários cujo nome tem o trecho.
const SO_CENARIO = process.env.SO_CENARIO || '';
async function cenario(nome, fn) {
  if (SO_CENARIO && !nome.includes(SO_CENARIO)) return;
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
        const m = img.currentSrc.match(/(?:=w|\/f\/[A-Za-z0-9_-]+\/)(\d+)/);
        return { css: t.getBoundingClientRect().width, w: m ? Number(m[1]) : 0, ok: img.classList.contains('ok') };
      });
      const nan = [...document.querySelectorAll('.g-t')].some(t => !/^\d+px$/.test(/** @type {HTMLElement} */ (t).style.width));
      // A grade é virtual (v4.3.0): só os blocos perto da tela têm miniaturas.
      const alts = [...document.querySelectorAll('.g-t')].map(t => [Number(/** @type {HTMLElement} */ (t).dataset.i), /** @type {HTMLImageElement} */ (t.querySelector('img')).alt]);
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
      return { util, desvio, tiles, nan, alts, carga, total: [...document.querySelectorAll('.g-bloco')].reduce((n, b) => n + Number(/** @type {HTMLElement} */ (b).dataset.n || 0), 0), naTela: document.querySelectorAll('.g-t').length, rolagemLateral: document.scrollingElement.scrollWidth > window.innerWidth, leve: document.getElementById('g-main')?.dataset.leve || '' };
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
  // v4.3.0: densidade cheia (o DPR real); o teto (MINIATURA_DPR_TETO) só
  // entra no modo leve, quando o aparelho trava (main[data-leve]).
  const dprEf = g.leve ? dpr * fatorMiniatura(dpr) : dpr;
  const exato = g.tiles.filter(t => t.ok).every(t => t.w === degrau(GALERIA_LARGURAS_GRADE, t.css * dprEf - 0.01));
  registra(exato, `${nome}: miniatura no menor degrau que cobre (sem baixar a mais; DPR efetivo ${dprEf.toFixed(2)})`, g.tiles.slice(0, 4));
  registra(!g.leve && dprEf === dpr, `${nome}: miniaturas na densidade cheia da tela (DPR ${dpr}), sem modo leve`, { dprEf, leve: g.leve, teto: MINIATURA_DPR_TETO });
  // A pré-carga do LCP (celular até 430 px) pede o MESMO arquivo que a <img>:
  // uma requisição só da primeira foto, sem desperdício.
  if (viewport.width <= 430) {
    const daPrimeira = estado.lh3.filter(x => x.id === TODAS[0][0]);
    registra(daPrimeira.length === 1, `${nome}: pré-carga da primeira foto = a miniatura que a página usa (1 pedido só)`, daPrimeira);
  }
  registra(g.alts.length > 0 && g.alts.every(([i, a]) => a === altEsperado(i)), `${nome}: alt das fotos é "<evento> — foto i de n"`, g.alts.slice(0, 2));
  registra(g.total === TODAS.length, `${nome}: todas as ${TODAS.length} fotos na grade`, g.total);
  registra(g.naTela > 0 && g.naTela < TODAS.length, `${nome}: grade virtual (só os blocos perto da tela têm miniaturas)`, g.naTela);
  registra(g.desvio >= 0 && g.desvio <= 2, `${nome}: linhas justificadas (cada linha fecha na largura, ±2 px)`, { desvio: g.desvio });
  registra(!g.nan && !g.rolagemLateral, `${nome}: nenhuma largura inválida, sem rolagem lateral`, { nan: g.nan, lateral: g.rolagemLateral });
  const fisicoOk = g.tiles.filter(t => t.ok).every(t => t.w >= Math.min(degrau(GALERIA_LARGURAS_GRADE, t.css * dprEf - 0.01), GALERIA_LARGURAS_GRADE.at(-1)));
  registra(fisicoOk && g.tiles.some(t => t.ok), `${nome}: miniatura com pixels suficientes para a tela (largura × DPR)`, g.tiles.slice(0, 4));
  const pedidas = new Set(estado.lh3.map(x => x.id)).size;
  registra(pedidas < TODAS.length, `${nome}: carga preguiçosa (pediu ${pedidas} de ${TODAS.length} miniaturas)`, pedidas);
  registra(estado.lh3.every(x => x.webp), `${nome}: WebP (o navegador decodifica)`, estado.lh3.slice(0, 2));
  // v3.8.8: a foto vem pelo site, com a assinatura no endereço (sem ela, 404).
  const semK = estado.lh3.filter(x => !x.site || !/^formatura\.[\w-]{8}$/.test(x.k));
  registra(estado.lh3.length > 0 && semK.length === 0, `${nome}: todo pedido de foto vai pelo site com a assinatura (k)`, semK.slice(0, 3));
  // Acessibilidade automática (axe) da grade, em dois aparelhos: nome das fotos, contraste, alvos.
  if (/^(Desktop|iPhone)/.test(nome)) await verificaAxe(page, registra, `${nome}: grade (tema claro)`);
  registra(estado.erros.length === 0 && estado.csp.length === 0, `${nome}: sem erro de JS nem mensagem de CSP`, [...estado.erros, ...estado.csp]);
  if (PRINTS) await page.screenshot({ path: join(PRINTS, `grade-${nome.replace(/[^a-z0-9]+/gi, '-')}.png`) });
  await ctx.close();
  });
}

// ---- 1b. Tema escuro (o padrão da maioria dos celulares à noite) ----------
await cenario('Miniatura que falha tenta de novo', async () => {
  const { ctx, page, estado } = await abre({ viewport: { width: 390, height: 844 }, dpr: 3, toque: true, falhaFotos: 4 });
  // A primeira nova tentativa sai entre 2 e 4 s depois da falha.
  await page.waitForFunction(() => [...document.querySelectorAll('.g-grade img')].filter(i => /** @type {HTMLImageElement} */ (i).currentSrc).every(i => /** @type {HTMLImageElement} */ (i).naturalWidth > 0), null, { timeout: 12000 }).catch(() => {});
  const r = await page.evaluate(() => {
    const imgs = /** @type {HTMLImageElement[]} */ ([...document.querySelectorAll('.g-grade img')]).filter(i => i.currentSrc);
    return { pedidas: imgs.length, carregadas: imgs.filter(i => i.naturalWidth > 0).length, vazias: document.querySelectorAll('.sem-mini').length, tentaram: imgs.filter(i => i.getAttribute('data-t')).length };
  });
  registra(estado.lh3.length > 4 && r.tentaram > 0, 'Nova tentativa: as miniaturas que falharam foram pedidas de novo', JSON.stringify(r));
  registra(r.pedidas > 0 && r.carregadas === r.pedidas && r.vazias === 0, 'Nova tentativa: nenhuma miniatura ficou vazia', JSON.stringify(r));
  // As larguras que o celular pede na grade são as que o indexador aquece no
  // R2 (AQUECE_LARGURAS): aquecer a largura errada é o mesmo que não aquecer.
  const pedidasNaGrade = [...new Set(estado.lh3.map(x => x.w))].sort((x, y) => x - y);
  registra(pedidasNaGrade.every(w => AQUECE_LARGURAS.includes(w)), 'iPhone: toda largura pedida na grade está entre as aquecidas no R2', { pedidas: pedidasNaGrade, aquecidas: AQUECE_LARGURAS });
  await ctx.close();
});

// ---- 1c. Rede muito ruim (v4.3.0) --------------------------------------------
// A tela aparece primeiro, com 1 pixel físico por pixel da tela; depois, com
// a tela pronta e o dedo parado, as da tela sobem para a densidade cheia.
/** As miniaturas da grade na tela: id, largura pedida agora e a do quadradinho. */
const miniaturasNaTela = (/** @type {import('playwright-core').Page} */ page) => page.evaluate(() => [...document.querySelectorAll('.g-grade .g-t img')].map(i => {
  const img = /** @type {HTMLImageElement} */ (i);
  const r = img.getBoundingClientRect();
  const m = img.currentSrc.match(/\/f\/([A-Za-z0-9_-]+)\/(\d+)/);
  return { id: m ? m[1] : '', w: m ? Number(m[2]) : 0, css: r.width, naTela: r.bottom > 0 && r.top < window.innerHeight && r.width > 0 };
}).filter(x => x.naTela && x.id));
await cenario('Rede muito ruim: 2G', async () => {
  const { ctx, page, estado } = await abre({ viewport: { width: 390, height: 844 }, dpr: 3, toque: true, conexao: '2g', atrasoFoto: () => 300 });
  await page.waitForFunction(() => [...document.querySelectorAll('.g-grade .g-t img')].filter(i => /** @type {HTMLImageElement} */ (i).getBoundingClientRect().top < window.innerHeight).every(i => i.classList.contains('ok')), null, { timeout: 15000 }).catch(() => {});
  const modo = await page.evaluate(() => document.getElementById('g-main')?.dataset.rede || '');
  registra(modo === 'conexao', '2G: a página entra no modo rede ruim', { modo });
  // A primeira largura pedida por foto (fora a pré-carga da primeira) é a de 1 pixel por pixel da tela.
  const tela = await miniaturasNaTela(page);
  const primeiro = new Map();
  for (const x of estado.lh3) if (!primeiro.has(x.id)) primeiro.set(x.id, x.w);
  const baixas = tela.slice(1).filter(x => primeiro.get(x.id) === degrau(GALERIA_LARGURAS_GRADE, x.css));
  registra(tela.length >= 3 && baixas.length === tela.length - 1, '2G: a tela pede primeiro a versão baixa (1 pixel por pixel da tela)', { tela: tela.length, baixas: baixas.length, exemplo: tela.slice(1, 3).map(x => ({ css: Math.round(x.css), pedida: primeiro.get(x.id) })) });
  // Com a tela pronta e o dedo parado, sobem para a densidade cheia (2 por vez).
  const cheia = (/** @type {{ w: number, css: number }} */ x) => x.w === degrau(GALERIA_LARGURAS_GRADE, x.css * 3);
  await page.waitForFunction(() => [...document.querySelectorAll('.g-grade .g-t img')].length > 0, null, { timeout: 2000 });
  const fim = Date.now() + 12000;
  let depois = await miniaturasNaTela(page);
  while (Date.now() < fim && !depois.every(cheia)) { await espera(page, 300); depois = await miniaturasNaTela(page); }
  registra(depois.length >= 3 && depois.every(cheia), '2G: depois de carregar, as da tela sobem para a densidade cheia', { subiram: depois.filter(cheia).length, de: depois.length });
  // Visualizador: abre baixo (1 pixel por pixel da tela) e sobe quando assenta.
  const antesDoToque = estado.lh3.length;
  const alvo = tela[1];
  await page.locator('.g-grade .g-t').nth(1).tap();
  await page.waitForSelector('.pswp--open', { timeout: 5000 });
  const escada = [...GALERIA_LARGURAS.filter(x => x < 6000), 6000];
  const subiu = await esperaLargura(page, 1600, 8000);
  const doSlide = estado.lh3.slice(antesDoToque).filter(x => x.id === alvo.id).map(x => x.w);
  registra(doSlide[0] === degrau(escada, 390), '2G: o visualizador abre com a versão baixa', { pedidas: doSlide });
  registra(subiu.w === degrau(escada, subiu.exibida * 3), '2G: e sobe para a resolução cheia com a foto assentada', { pedida: subiu.w, exibida: Math.round(subiu.exibida), pedidas: doSlide });
  const vizinhas = new Set(estado.lh3.slice(antesDoToque).filter(x => x.id !== alvo.id && GALERIA_LARGURAS.includes(x.w) && x.w > 480).map(x => x.id));
  registra(vizinhas.size === 0, '2G: as vizinhas não sobem (só a foto aberta)', [...vizinhas]);
  registra(estado.erros.length === 0 && estado.csp.length === 0, '2G: sem erro de JS nem CSP', [...estado.erros, ...estado.csp]);
  await ctx.close();
});
await cenario('Rede muito ruim: medida', async () => {
  // As 10 primeiras fotos levam 6,5 s; depois a rede melhora.
  const { ctx, page, estado } = await abre({ viewport: { width: 390, height: 844 }, dpr: 3, toque: true, vigiaRede: true, atrasoFoto: n => n <= 10 ? 6500 : 60 });
  await page.waitForFunction(() => /** @type {any} */ (window).__rede.includes('medida'), null, { timeout: 20000 }).catch(() => {});
  const entrou = await page.evaluate(() => /** @type {any} */ (window).__rede.slice());
  registra(entrou.includes('medida'), 'Medida: miniaturas da tela levando mais de 6 s ligam o modo rede ruim', entrou);
  // A próxima tela pede baixo; as subidas rápidas tiram a página do modo.
  await page.evaluate(() => window.scrollBy(0, window.innerHeight * 1.5));
  await page.waitForFunction(() => /** @type {any} */ (window).__rede.slice(-1)[0] === '', null, { timeout: 15000 }).catch(() => {});
  const hist = await page.evaluate(() => /** @type {any} */ (window).__rede.slice());
  const tela = await miniaturasNaTela(page);
  // A tela seguinte pode ter sido pedida (baixa) como margem, antes da rolagem.
  const primeiro = new Map();
  for (const x of estado.lh3) if (!primeiro.has(x.id)) primeiro.set(x.id, x.w);
  const baixa = tela.filter(x => primeiro.get(x.id) === degrau(GALERIA_LARGURAS_GRADE, x.css) && x.w > primeiro.get(x.id));
  registra(baixa.length > 0, 'Medida: a tela seguinte veio baixa e subiu depois', { baixasQueSubiram: baixa.length, tela: tela.length });
  registra(hist[hist.length - 1] === '', 'Medida: com a rede de volta (subidas rápidas), a página sai do modo', hist);
  registra(estado.erros.length === 0 && estado.csp.length === 0, 'Medida: sem erro de JS nem CSP', [...estado.erros, ...estado.csp]);
  await ctx.close();
});

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
  registra(/[?]foto=RAIZFOTO_000000$/.test(page.url()), 'Desktop: o endereço ganha o link direto da foto', page.url());
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
  registra(/[?]foto=RAIZFOTO_000001$/.test(page.url()), 'Desktop: seta → vai para a próxima foto (link atualizado)', page.url());
  // A legenda é o nome da foto e, abaixo, o crédito ("Foto: <autor>"; sem pasta
  // de autor, o padrão do site) — duas linhas, o nome primeiro.
  const legenda = await page.locator('.pswp__g-legenda').textContent();
  // v3.8.0: o crédito vem primeiro e em destaque ("Foto de …", .g-leg-autor).
  const credito = await page.locator('.pswp__g-legenda .g-leg-autor').textContent();
  registra(legenda === 'Foto de Luca F. Chala002' && credito === 'Foto de Luca F. Chala', 'Desktop: legenda mostra o número da foto e o crédito do autor padrão', legenda);
  const altAberta = await page.evaluate(() => [...document.querySelectorAll('.pswp__item[aria-hidden="false"] img')].map(im => /** @type {HTMLImageElement} */ (im).alt).find(Boolean) || '');
  registra(altAberta === `Formatura 2026 — foto 2 de ${TODAS.length}`, 'Desktop: a foto aberta no visualizador tem o mesmo alt da grade', altAberta);
  await page.keyboard.press('Escape');
  await espera(page, 700);
  registra(!(await page.locator('.pswp--open').count()) && !page.url().includes('foto='), 'Desktop: Esc fecha e limpa o link', page.url());
  // Voltar do navegador com a foto aberta fecha a FOTO e fica na galeria.
  await page.locator('.g-t').nth(3).click();
  await page.waitForSelector('.pswp--open');
  await espera(page, 700);
  await page.evaluate(() => history.back());
  await espera(page, 700);
  registra(!(await page.locator('.pswp--open').count()) && new URL(page.url()).pathname === '/galeria/formatura' && !page.url().includes('foto='),
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
  // v4.3.0: e a maior que a tela ampliada pede (pixels FÍSICOS), sem teto.
  await espera(page, 900);
  const ampliada = await esperaLargura(page, degrau(escada, (await larguraAtualDoVisualizador(page)).exibida * 3), 6000);
  registra(ampliada.w === degrau(escada, ampliada.exibida * 3), 'iPhone: no zoom, a resolução máxima que a tela ampliada pede', { pedida: ampliada.w, exibida: Math.round(ampliada.exibida) });
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
  registra(legenda === 'Foto de Luca F. Chalafesta-5 · Festa', 'Link direto #foto= abre na foto certa, com a seção e o crédito na legenda', legenda);
  await page.evaluate(() => history.back());
  await espera(page, 700);
  registra(!(await page.locator('.pswp--open').count()) && page.url() === 'https://fotos.test/galeria/formatura' && (await page.evaluate(() => [...document.querySelectorAll('.g-bloco')].reduce((n, b) => n + Number(/** @type {HTMLElement} */ (b).dataset.n || 0), 0))) === TODAS.length,
    'Link direto: voltar fecha a foto e fica na galeria (não sai do site)', page.url());
  registra(estado.erros.length === 0 && estado.csp.length === 0, 'Link direto: sem erro de JS nem CSP', [...estado.erros, ...estado.csp]);
  await ctx.close();
  // O formato de hoje (v3.9.0): ?foto=<código>. Abre a foto, a barra
  // mostra o link dela, e o voltar tira o ?foto= e fica na galeria.
  const b = await abre({ url: 'https://fotos.test/galeria/formatura?foto=FESTAFOTO_000004' });
  await b.page.waitForSelector('.pswp--open', { timeout: 5000 });
  await espera(b.page, 800);
  const leg2 = await b.page.locator('.pswp__g-legenda').textContent();
  registra(leg2 === 'Foto de Luca F. Chalafesta-5 · Festa', 'Link ?foto= abre na foto certa', leg2);
  registra(new URL(b.page.url()).searchParams.has('foto'), 'Com a foto aberta, a barra de endereço tem ?foto=', b.page.url());
  await b.page.evaluate(() => history.back());
  await espera(b.page, 700);
  registra(!(await b.page.locator('.pswp--open').count()) && b.page.url() === 'https://fotos.test/galeria/formatura',
    'Link ?foto=: voltar fecha a foto e tira o ?foto= da barra', b.page.url());
  registra(b.estado.erros.length === 0 && b.estado.csp.length === 0, 'Link ?foto=: sem erro de JS nem CSP', [...b.estado.erros, ...b.estado.csp]);
  await b.ctx.close();
});

// ---- 4. Downloads no computador e no Android --------------------------------
// Download comum: um <a download> para o servidor, sem Web Share, sem folha do
// sistema. O Playwright não intercepta essa navegação (ela vira download antes
// da rota), então aqui se confere a URL pedida — foto e versão — e que a página
// NÃO deu nome ao arquivo nem chamou o compartilhamento; o nome e os bytes
// (Content-Disposition e passagem direta do Drive) estão em tests/galeria.test.js.
// A folha entra com transição (opacidade e posição, 0,2 s): o axe medido no
// meio dela lê cores misturadas com o fundo (contraste 4,36 no CI, run
// 44073828414). Espera as animações da folha acabarem antes de medir.
const folhaAssentada = (/** @type {import('playwright-core').Page} */ page) => page.waitForFunction(() => {
  const f = document.getElementById('g-folha');
  return !!f && f.getAnimations({ subtree: true }).every(a => a.playState !== 'running');
}, null, { timeout: 3000 });
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
    await folhaAssentada(page);
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
  await folhaAssentada(page);
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

// Compartilhar uma foto (v4.3.0): manda o LINK da foto (?foto=), nunca o
// arquivo — nenhum pedido a /baixar/, nada conta como download. Sem o menu do
// sistema, o link vai para a área de transferência.
await cenario('Compartilhar manda o link, não a foto', async () => {
  const { ctx, page, estado } = await abre({ viewport: { width: 390, height: 844 }, dpr: 3, toque: true, compartilhar: true, ua: UA_IPHONE });
  await page.locator('.g-t').first().tap();
  await page.waitForSelector('.pswp--open');
  await espera(page, 900);
  const endereco = await page.evaluate(() => location.href);
  await page.locator('.pswp__button--g-compartilhar').tap();
  await page.waitForFunction(() => /** @type {any} */ (window).__compartilhados.length >= 1, null, { timeout: 8000 });
  const c = await page.evaluate(() => /** @type {any} */ (window).__compartilhados);
  registra(c.length === 1 && c[0].files === 0 && c[0].url === endereco && /[?]foto=/.test(c[0].url), 'Compartilhar: o menu do sistema recebe só o link da foto aberta (?foto=), sem arquivo', { c, endereco });
  registra(estado.pedidos.length === 0 && estado.downloads.length === 0, 'Compartilhar: nenhum pedido de download sai', estado.pedidos);
  registra(estado.erros.length === 0 && estado.csp.length === 0, 'Compartilhar: sem erro de JS nem CSP', [...estado.erros, ...estado.csp]);
  await ctx.close();
});
await cenario('Compartilhar sem menu do sistema copia o link', async () => {
  const { ctx, page, estado } = await abre({ viewport: { width: 1440, height: 900 } });
  await ctx.grantPermissions(['clipboard-read', 'clipboard-write'], { origin: 'https://fotos.test' });
  await page.evaluate(() => { Object.defineProperty(navigator, 'share', { value: undefined, configurable: true }); });
  await page.locator('.g-t').first().click();
  await page.waitForSelector('.pswp--open');
  await espera(page, 900);
  await page.locator('.pswp__button--g-compartilhar').click();
  await page.waitForFunction(() => /Link copiado/.test(document.getElementById('g-aviso-flut')?.textContent || ''), null, { timeout: 5000 }).catch(() => {});
  const r = await page.evaluate(async () => ({ aviso: document.getElementById('g-aviso-flut')?.textContent || '', copiado: await navigator.clipboard.readText(), aqui: location.href }));
  registra(/Link copiado/.test(r.aviso) && r.copiado === r.aqui && /[?]foto=/.test(r.copiado), 'Compartilhar no computador: copia o link da foto e avisa', r);
  registra(estado.pedidos.length === 0, 'Compartilhar no computador: nenhum download', estado.pedidos);
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

// 429 do limite por IP: Compartilhar (só o link) não é afetado;
// "Salvar no Fotos" entra na fila (contagem no botão, Cancelar) e só uma
// tentativa por vez sai desta aba.
await cenario('Limite por IP no download (429)', async () => {
  const { ctx, page, estado } = await abre({ viewport: { width: 390, height: 844 }, dpr: 3, toque: true, compartilhar: true, ua: UA_IPHONE, limite429: 30 });
  await page.locator('.g-t').first().tap();
  await page.waitForSelector('.pswp--open');
  await espera(page, 900);
  // Compartilhar manda só o link: funciona mesmo com o limite esgotado.
  await page.locator('.pswp__button--g-compartilhar').tap();
  await page.waitForFunction(() => /** @type {any} */ (window).__compartilhados.length >= 1, null, { timeout: 8000 });
  registra(estado.pedidos.length === 0, 'Limite: o Compartilhar (só o link) funciona com o limite esgotado, sem pedir nada', estado.pedidos);
  await page.locator('.pswp__button--g-baixar').tap();
  await page.waitForSelector('#g-folha:not([hidden])');
  const salvar = page.locator('.g-ver-a').first().locator('.g-btn').first();
  await salvar.tap();
  await espera(page, 1500);
  const msg = (await page.locator('#g-folha-msg').textContent()) || '';
  registra(/Você está na fila/.test(msg), 'Limite: "Salvar no Fotos" entra na fila e explica na folha', msg);
  registra(/Na fila… tentando de novo em \d+ s/.test((await salvar.textContent()) || ''), 'Limite: o botão mostra a contagem "Na fila… tentando de novo em N s"', await salvar.textContent());
  registra(await page.locator('[data-acao="cancela-fila"]').count() === 1, 'Limite: aparece o botão Cancelar (um só)', '');
  /** @type {string[]} */
  const baixados = [];
  page.on('download', d => baixados.push(urlDe(d)));
  await page.locator('.g-ver-a').first().locator('.g-btn').nth(1).tap();
  await espera(page, 1500);
  registra(/Já há downloads na fila/.test((await page.locator('#g-folha-msg').textContent()) || ''), 'Limite: com a fila andando, "Baixar arquivo" não abre outra tentativa', await page.locator('#g-folha-msg').textContent());
  registra(estado.pedidos.length === 1 && baixados.length === 0, 'Limite: só saiu a 1a tentativa da fila (nenhum laço, nenhum toque extra)', { pedidos: estado.pedidos, baixados });
  registra(await page.locator('#g-folha').isVisible(), 'Limite: a folha fica aberta com o aviso', '');
  await page.locator('[data-acao="cancela-fila"]').tap();
  await espera(page, 1500);
  registra(await page.locator('[data-acao="cancela-fila"]').count() === 0, 'Limite: Cancelar encerra a fila e some', '');
  registra(estado.pedidos.length === 1, 'Limite: depois de cancelar nada mais é pedido', estado.pedidos);
  registra(estado.erros.length === 0 && estado.csp.length === 0, 'Limite: sem erro de JS nem CSP', [...estado.erros, ...estado.csp]);
  await ctx.close();
});

// A fila sozinha: a sonda recebe 429 (Retry-After 2), o botão conta, depois
// libera e o download sai sem ninguém tocar de novo.
await cenario('Fila de download libera sozinha', async () => {
  const { ctx, page, estado } = await abre({ limite429: 2, limite429Vezes: 1 });
  /** @type {string[]} */
  const baixados = [];
  page.on('download', d => baixados.push(urlDe(d)));
  await page.locator('.g-t').first().click();
  await page.waitForSelector('.pswp--open');
  await espera(page, 900);
  await page.locator('.pswp__button--g-baixar').click();
  await page.waitForSelector('#g-folha:not([hidden])');
  const botao = page.locator('.g-op').first();
  await botao.click();
  await page.waitForFunction(() => /Na fila/.test(document.querySelector('.g-op')?.textContent || ''), null, { timeout: 5000 });
  registra(true, 'Fila: o botão vira "Na fila…" quando a sonda recebe 429', await botao.textContent());
  await page.waitForEvent('download', { timeout: 12000 }).catch(() => null);
  await espera(page, 300);
  registra(baixados.length === 1, 'Fila: depois da espera o download sai sozinho (1 arquivo)', baixados);
  // O download do <a download> é visto pelo evento 'download' (não passa pelo
  // route do script): os pedidos vistos são só as duas sondas, ambas leves.
  registra(estado.pedidos.length === 2 && estado.pedidos.every(p => /[?&]p=1/.test(p)) && baixados[0] === '/galeria/formatura/baixar/RAIZFOTO_000000?v=redes',
    'Fila: sonda 429, sonda 204 e então o download da foto (a espera usa só o endpoint leve)', { pedidos: estado.pedidos, baixados });
  registra(!/Na fila/.test((await botao.textContent()) || ''), 'Fila: o botão volta ao texto normal', await botao.textContent());
  registra(estado.erros.length === 0 && estado.csp.length === 0, 'Fila: sem erro de JS nem CSP', [...estado.erros, ...estado.csp]);
  await ctx.close();
});

// #271: fechar a folha com a fila esperando encerra a fila — e DIZ isso no
// aviso de baixo (antes a pessoa fechava achando que a foto ainda viria).
await cenario('Fechar a folha com a fila esperando avisa que parou', async () => {
  const { ctx, page, estado } = await abre({ limite429: 30, limite429Vezes: 5 });
  /** @type {string[]} */
  const baixados = [];
  page.on('download', d => baixados.push(urlDe(d)));
  await page.locator('.g-t').first().click();
  await page.waitForSelector('.pswp--open');
  await espera(page, 900);
  await page.locator('.pswp__button--g-baixar').click();
  await page.waitForSelector('#g-folha:not([hidden])');
  await page.locator('.g-op').first().click();
  await page.waitForFunction(() => /Na fila/.test(document.querySelector('.g-op')?.textContent || ''), null, { timeout: 5000 });
  await page.keyboard.press('Escape');
  await espera(page, 300);
  const aviso = (await page.locator('#g-aviso-flut').textContent().catch(() => '')) || '';
  registra(await page.locator('#g-folha').isHidden(), 'Fila + fechar: a folha fecha', '');
  registra(/Download cancelado ao fechar a janela/.test(aviso), 'Fila + fechar: o aviso diz que o download parou e como voltar', aviso);
  await espera(page, 1500);
  registra(baixados.length === 0 && estado.pedidos.length === 1, 'Fila + fechar: a fila parou de fato (só a primeira sonda, nenhum download)', { pedidos: estado.pedidos, baixados });
  registra(estado.erros.length === 0 && estado.csp.length === 0, 'Fila + fechar: sem erro de JS nem CSP', [...estado.erros, ...estado.csp]);
  await ctx.close();
});

// v3.7.2: nada de link para a pasta no Drive. "Baixar tudo" baixa pelo site
// (a mesma folha do "Baixar" da seleção) e, com filtro ligado, só o da tela.
// Seções que são anos ("2026", "2025") viram filtro no topo.
await cenario('Baixar tudo pelo site e filtro por ano', async () => {
  const { ctx, page, estado } = await abre({});
  registra(await page.locator('a[data-acao="pasta-drive"], #g-folha-drive').count() === 0, 'Sem Drive: nenhum link para a pasta', '');
  await page.locator('[data-acao="baixar-tudo"]').first().click();
  await espera(page, 400);
  const op = page.locator('#g-folha-ops .g-op').first();
  const t = (await op.textContent()) || '';
  registra(new RegExp('Baixar todas \\(' + TODAS.length + '\\)').test(t), '"Baixar tudo": oferece baixar todas pelo site, com a contagem', t);
  registra(await page.locator('#g-folha-ops a[href*="drive.google.com"]').count() === 0, '"Baixar tudo": sem "Pelo Google Drive"', '');
  await op.click();
  await espera(page, 400);
  const tit = (await page.locator('#g-folha-t').textContent()) || '';
  registra(/^Baixar \d+ (fotos|arquivos)$/.test(tit), '"Baixar tudo" leva à folha de versões de todas', tit);
  registra(estado.erros.length === 0 && estado.csp.length === 0, 'Baixar tudo: sem erro de JS nem CSP', [...estado.erros, ...estado.csp]);
  await ctx.close();

  const anos = { ...LISTAGEM, secoes: [{ nome: '2026', caminho: '2026', fotos: raiz }, { nome: '2025', caminho: '2025', fotos: festa }] };
  const pag = await paginaAssinada({ event: EVENTO, listagem: anos, erro: null, nonce: NONCE, redes: REDES });
  const p2 = await abre({ pagina: pag });
  const chipsAno = p2.page.locator('[data-acao="filtro-sec"]');
  registra(await chipsAno.count() === 3, 'Anos: "Todos os anos" + um chip por ano', await chipsAno.count());
  await p2.page.locator('[data-acao="filtro-sec"][data-sec="1"]').click();
  await espera(p2.page, 400);
  const visiveis = await p2.page.locator('.g-sec:not([hidden])').count();
  registra(visiveis === 1, 'Anos: tocar em 2025 mostra só 2025', visiveis);
  registra(await p2.page.locator('[data-acao="filtro-sec"][data-sec="1"]').getAttribute('aria-pressed') === 'true', 'Anos: o chip fica marcado', '');
  await p2.page.locator('[data-acao="baixar-tudo"]').first().click();
  await espera(p2.page, 400);
  const t2 = (await p2.page.locator('#g-folha-ops .g-op').first().textContent()) || '';
  registra(t2.includes('Baixar as ' + festa.length + ' da tela'), 'Anos: "Baixar tudo" com filtro baixa só o ano', t2);
  // v3.8.3: o ano escolhido fica lembrado ao voltar ao evento.
  await p2.page.keyboard.press('Escape');
  await p2.page.reload();
  await espera(p2.page, 600);
  registra(await p2.page.locator('[data-acao="filtro-sec"][data-sec="1"]').getAttribute('aria-pressed') === 'true' && await p2.page.locator('.g-sec:not([hidden])').count() === 1, 'Anos: voltar ao evento reabre no ano escolhido', '');
  registra(p2.estado.erros.length === 0 && p2.estado.csp.length === 0, 'Anos: sem erro de JS nem CSP', [...p2.estado.erros, ...p2.estado.csp]);
  await p2.ctx.close();
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

// ---- 6. Favoritas: a única marca (v4.3.0 juntou a antiga "Seleção") ----------
// Três fotos marcadas, UMA sem versão do Instagram (a 6ª, índice 5).
await cenario('Favoritas: baixar', async () => {
  const { ctx, page, estado } = await abre({});
  registra(await page.locator('#g-sel, #g-barra, .g-ck, [data-acao="sel-secao"]').count() === 0,
    'Favoritas: não há mais botão "Selecionar", barra de seleção nem ✓ na miniatura', '');
  for (const i of [0, 3, 5]) {
    await page.locator('.g-t').nth(i).hover();
    await page.locator('.g-t').nth(i).locator('.g-fav').click();
  }
  const nomes = await page.locator('.g-t.fav').evaluateAll(els => els.map(e => e.getAttribute('aria-label')));
  registra(nomes.join('|') === 'Foto 001, favorita|Foto 004, favorita|Foto 006, favorita', 'Favoritas: o leitor de tela ouve "favorita" no nome da foto', nomes);
  registra((await page.locator('.pswp--open').count()) === 0, 'Favoritas: o coração da miniatura marca sem abrir a foto', '');
  registra(await page.locator('[data-acao="baixar-fav"]').count() === 0, 'Favoritas: "Baixar" só aparece com o filtro de favoritas ligado', '');
  await page.reload();
  await espera(page, 900);
  await page.locator('.g-chip[data-acao="filtro-fav"]').click();
  await espera(page, 400);
  const acoes = await page.locator('.g-chip[data-acao="baixar-fav"], .g-chip[data-acao="compartilhar-fav"]').allTextContents();
  registra(acoes.join('|') === 'Baixar|Compartilhar', 'Favoritas: com o filtro ligado, o topo oferece Baixar e Compartilhar', acoes);
  await page.locator('[data-acao="baixar-fav"]').click();
  await page.waitForSelector('#g-folha:not([hidden])');
  registra((await page.locator('#g-folha-t').textContent()) === 'Baixar 3 fotos', 'Favoritas: a folha baixa as três', await page.locator('#g-folha-t').textContent());
  const detalhes = await page.locator('.g-op span').allTextContents();
  registra(/^2 de 3 fotos têm esta versão \(as outras ficam de fora\)/.test(detalhes[0] || ''), 'Favoritas: "para redes" diz quantas das fotos têm a versão', detalhes[0]);
  registra(/^Os arquivos originais, sem alteração/.test(detalhes[1] || ''), 'Favoritas: "tamanho máximo" cobre as três', detalhes[1]);
  if (PRINTS) await page.screenshot({ path: join(PRINTS, 'favoritas-desktop.png') });
  /** @type {string[]} */
  const pedidos = [];
  page.on('download', d => { const u = new URL(d.url()); pedidos.push(u.pathname.split('/').pop() + u.search); });
  await page.locator('.g-op').first().click();
  await espera(page, 3200);
  // Ordenados: o Chromium pode avisar os downloads fora da ordem em que a página
  // os pede (no #278, 06/11/2026, chegaram 0, 5, 3). O que vale é um por foto.
  registra([...pedidos].sort().join(',') === 'RAIZFOTO_000000?v=redes,RAIZFOTO_000003?v=redes',
    'Favoritas: "para redes" baixa só as duas fotos que têm a versão, uma a uma', pedidos);
  await page.locator('[data-acao="baixar-fav"]').click();
  await page.waitForSelector('#g-folha:not([hidden])');
  pedidos.length = 0;
  await page.locator('.g-op').nth(1).click();
  await espera(page, 3200);
  registra([...pedidos].sort().join(',') === 'RAIZFOTO_000000?v=max,RAIZFOTO_000003?v=max,RAIZFOTO_000005?v=max',
    'Favoritas: "tamanho máximo" baixa as três, um download por foto', pedidos);
  registra(estado.erros.length === 0 && estado.csp.length === 0, 'Favoritas: sem erro de JS nem CSP', [...estado.erros, ...estado.csp]);
  await ctx.close();
});

// Quem tinha fotos na seleção antiga (até a 4.1) as encontra nas favoritas.
await cenario('Seleção antiga vira favorita', async () => {
  const { ctx, page, estado } = await abre({});
  await page.evaluate(() => {
    localStorage.setItem('galeria:sel:formatura', JSON.stringify(['RAIZFOTO_000002', 'RAIZFOTO_000007']));
    localStorage.setItem('galeria:fav:formatura', JSON.stringify(['RAIZFOTO_000007', 'RAIZFOTO_000009']));
  });
  await page.reload();
  await espera(page, 900);
  const fav = await page.evaluate(() => JSON.parse(localStorage.getItem('galeria:fav:formatura') || '[]').sort().join(','));
  const sel = await page.evaluate(() => localStorage.getItem('galeria:sel:formatura'));
  registra(fav === 'RAIZFOTO_000002,RAIZFOTO_000007,RAIZFOTO_000009' && sel === null && (await page.locator('.g-t.fav').count()) === 3,
    'Seleção antiga: entra nas favoritas (sem repetir) e a chave antiga sai', { fav, sel });
  registra(estado.erros.length === 0 && estado.csp.length === 0, 'Seleção antiga: sem erro de JS nem CSP', [...estado.erros, ...estado.csp]);
  await ctx.close();
});

// Favoritas no iPhone: o coração da foto aberta, depois Favoritas → Baixar:
// "Salvar N fotos no Fotos" com os arquivos exatos de cada uma.
await cenario('Favoritas no iPhone', async () => {
  const { ctx, page, estado } = await abre({ viewport: { width: 390, height: 844 }, dpr: 3, toque: true, compartilhar: true, ua: UA_IPHONE });
  for (const i of [0, 1, 5]) {
    await page.locator('.g-t').nth(i).tap();
    await page.waitForSelector('.pswp--open');
    await espera(page, 500);
    await page.locator('.pswp__button--g-fav').tap();
    await page.locator('.pswp__button--close').tap();
    await page.waitForSelector('.pswp--open', { state: 'detached' });
    await espera(page, 300);
  }
  await page.locator('.g-chip[data-acao="filtro-fav"]').tap();
  await espera(page, 400);
  if (PRINTS) await page.screenshot({ path: join(PRINTS, 'favoritas-iphone.png') });
  await page.locator('[data-acao="baixar-fav"]').tap();
  await page.waitForSelector('#g-folha:not([hidden])');
  const rotulos = await page.locator('.g-ver-a').first().locator('.g-btn').allTextContents();
  registra(rotulos.join('|') === 'Salvar 2 fotos no Fotos|Baixar arquivo', 'Favoritas no iPhone: o botão diz quantas fotos vão para o Fotos (as que têm a versão)', rotulos);
  await page.locator('.g-ver-a').first().locator('.g-btn').first().tap();
  await page.waitForFunction(() => /** @type {any} */ (window).__compartilhados.length >= 2, null, { timeout: 8000 });
  const comp = await page.evaluate(() => /** @type {any} */ (window).__compartilhados);
  registra(comp.length === 2 && comp[0].nome === '001.JPG' && comp[1].nome === '002.jpg'
    && comp[0].b64 === b64(conteudo('RAIZFOTO_000000', 'redes')) && comp[1].b64 === b64(conteudo('RAIZFOTO_000001', 'redes')),
  'Favoritas no iPhone: uma só folha do sistema, com os arquivos exatos (nome e bytes) das duas fotos', comp.map(( /** @type {any} */ c) => c.nome));
  registra(estado.downloads.join(',') === 'RAIZFOTO_000000:redes,RAIZFOTO_000001:redes', 'Favoritas no iPhone: só as fotos com a versão são pedidas', estado.downloads);
  registra(estado.erros.length === 0 && estado.csp.length === 0, 'Favoritas no iPhone: sem erro de JS nem CSP', [...estado.erros, ...estado.csp]);
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

  // Fora do filtro: "Baixar tudo" oferece todas (pelo site) e as favoritas.
  const filtrando = await page.locator('.g-chip[aria-pressed="true"]').count();
  if (filtrando) await page.locator('.g-chip[data-acao="filtro-fav"]').click();
  await page.locator('[data-acao="baixar-tudo"]').click();
  await page.waitForSelector('#g-folha:not([hidden])');
  const titulo = await page.locator('#g-folha-t').textContent();
  const ops = await page.locator('.g-op strong').allTextContents();
  registra(titulo === 'Baixar tudo' && ops.some(t => /^Baixar todas \(\d+\)$/.test(t)) && !ops.some(t => /Google Drive/.test(t)) && ops.some(t => /favoritas \(2\)/.test(t)),
    '"Baixar tudo": oferece todas pelo site e as favoritas, sem Drive', { titulo, ops });
  await page.keyboard.press('Escape');
  await espera(page, 400);

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
  const pagina = await paginaAssinada({ event: EVENTO, listagem, erro: null, nonce: NONCE });
  const { ctx, page, estado } = await abre({ pagina, viewport: { width: 1440, height: 900 } });
  const miniaturas = await page.evaluate(() => [...document.querySelectorAll('.g-bloco')].reduce((n, b) => n + Number(/** @type {HTMLElement} */ (b).dataset.n || 0), 0));
  registra(miniaturas === N, `${N} fotos: todas as miniaturas existem na grade`, miniaturas);
  // Grade virtual: rolar até o fim traz a última foto, e o começo sai do DOM.
  const fimDaGrade = await page.evaluate(async () => {
    const noDom0 = document.querySelectorAll('.g-t').length;
    window.scrollTo(0, document.scrollingElement.scrollHeight);
    await new Promise(r => setTimeout(r, 400));
    await new Promise(r => window.requestAnimationFrame(() => window.requestAnimationFrame(r)));
    const is = [...document.querySelectorAll('.g-t')].map(t => Number(/** @type {HTMLElement} */ (t).dataset.i));
    window.scrollTo(0, 0);
    return { noDom0, noDomFim: is.length, ultima: Math.max(...is), primeira: Math.min(...is) };
  });
  registra(fimDaGrade.noDom0 < N / 2 && fimDaGrade.ultima === N - 1 && fimDaGrade.primeira > 0 && fimDaGrade.noDomFim < N / 2,
    `${N} fotos: grade virtual (no DOM só o que está perto; no fim, a última foto está lá)`, fimDaGrade);
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

// ---- 6c'. Medida (só com MEDE_GRADE=1): o custo da grade num celular lento --
// Não reprova nada: imprime o tempo até a grade existir, as tarefas longas e o
// número de elementos, para decidir otimizações com número na mão.
if (process.env.MEDE_GRADE) {
  for (const N of (process.env.MEDE_GRADE_N || '300,1300,3000').split(',').map(Number)) {
    await cenario(`Medida ${N}`, async () => {
      const muitas = Array.from({ length: N }, (_, i) => {
        const [w, h] = FORMATOS[i % FORMATOS.length];
        return /** @type {[string, number, number, string, number]} */ ([pid('MEDEFOTO', i), w, h, `m-${i + 1}.jpg`, 9_000_000]);
      });
      for (const f of muitas) POR_ID.set(f[0], f);
      const listagem = { ...LISTAGEM, total: N, secoes: [{ nome: '', caminho: '', fotos: muitas }] };
      const pagina = await paginaAssinada({ event: EVENTO, listagem, erro: null, nonce: NONCE });
      const { ctx, page } = await abre({ pagina, viewport: { width: 412, height: 915 }, dpr: 2.625, toque: true, ua: UA_IPHONE, cpu: 4, medeTarefas: true, esperaAbrir: 0, ...(process.env.MEDE_URL ? { url: process.env.MEDE_URL } : {}) });
      await page.waitForFunction(n => [...document.querySelectorAll('.g-bloco')].reduce((n, b) => n + Number(/** @type {HTMLElement} */ (b).dataset.n || 0), 0) === n, N, { timeout: 60000 });
      await page.waitForTimeout(2500);
      if (/** @type {any} */ (page).__cdp) {
        const { profile } = await /** @type {any} */ (page).__cdp.send('Profiler.stop');
        const self = new Map();
        const dt = profile.timeDeltas; const porNo = new Map(profile.nodes.map((/** @type {any} */ n) => [n.id, n]));
        profile.samples.forEach((/** @type {number} */ id, /** @type {number} */ i) => { const n = porNo.get(id); const k = (n.callFrame.functionName || '(anon)') + ':' + n.callFrame.lineNumber; self.set(k, (self.get(k) || 0) + (dt[i] || 0) / 1000); });
        const { metrics } = await /** @type {any} */ (page).__cdp.send('Performance.getMetrics');
        const m = Object.fromEntries(metrics.map((/** @type {any} */ x) => [x.name, x.value]));
        console.log(`METRICAS N=${N}`, ['TaskDuration', 'ScriptDuration', 'RecalcStyleDuration', 'LayoutDuration', 'RecalcStyleCount', 'LayoutCount', 'Nodes'].map(k => k + '=' + (k.endsWith('Duration') ? Math.round(m[k] * 1000) + 'ms' : m[k])).join('  '));
        console.log(`PERFIL N=${N}`, [...self].sort((x, y) => y[1] - x[1]).slice(0, 18).map(([k, v]) => k + '=' + Math.round(v)).join('  '));
      }
      console.log(`MARCAS N=${N}`, await page.evaluate(() => { const m = performance.getEntriesByType('mark'); const nav = /** @type {any} */ (performance.getEntriesByType('navigation')[0]); return 'html=' + Math.round(nav.responseEnd) + ' dcl=' + Math.round(nav.domContentLoadedEventStart) + ' ' + m.map((x, i) => x.name + '=' + Math.round(x.startTime) + (i ? '(+' + Math.round(x.startTime - m[i - 1].startTime) + ')' : '')).join(' '); }));
      const abrir = await page.evaluate(() => {
        const l = /** @type {any} */ (window).__longas;
        return { grade: Math.round(performance.now()), nos: document.getElementsByTagName('*').length, longas: l.length, somaLongas: l.reduce((/** @type {number} */ t, /** @type {number[]} */ x) => t + x[1], 0), maior: l.reduce((/** @type {number} */ t, /** @type {number[]} */ x) => Math.max(t, x[1]), 0), lista: l.slice(0, 8) };
      });
      await page.evaluate(() => { /** @type {any} */ (window).__longas = []; });
      for (let y = 0; y <= 20000; y += 1500) { await page.evaluate(v => window.scrollTo(0, v), y); await page.waitForTimeout(120); }
      await page.waitForTimeout(800);
      const rolar = await page.evaluate(() => { const l = /** @type {any} */ (window).__longas; return { longas: l.length, soma: l.reduce((/** @type {number} */ t, /** @type {number[]} */ x) => t + x[1], 0), maior: l.reduce((/** @type {number} */ t, /** @type {number[]} */ x) => Math.max(t, x[1]), 0) }; });
      const t0 = Date.now();
      await page.locator('.g-t').nth(2).tap();
      await page.waitForSelector('.pswp--open');
      const toque = Date.now() - t0;
      console.log(`MEDIDA N=${N}`, JSON.stringify({ abrir, rolar, toqueAteAbrirMs: toque }));
      await ctx.close();
    });
  }
}

// ---- 6d. Ocultar dos visitantes (só o dono) ---------------------------------
await cenario('Ocultar', async () => {
  const JA = pid('RAIZFOTO', 1);
  const ALVO = pid('RAIZFOTO', 0);
  const pagina = await paginaAssinada({ event: EVENTO, listagem: LISTAGEM, erro: null, nonce: NONCE, dono: true, ocultas: [JA], redes: REDES });
  const { ctx, page, estado } = await abre({ pagina, ocultas: [JA] });
  const marcada = await page.evaluate(id => {
    const a = document.querySelector('.g-t[href="?foto=' + id + '"]');
    const selo = a && a.querySelector('.g-oc');
    return { classe: !!a && a.classList.contains('oculta'), selo: selo ? getComputedStyle(selo).display : '' };
  }, JA);
  registra(marcada.classe && marcada.selo === 'block', 'Dono: a foto já oculta aparece apagada, com o selo "Oculta"', marcada);
  registra((await page.locator('#g-n-ocultas').textContent()) === '1 oculta para os visitantes', 'Dono: a faixa diz quantas estão ocultas');
  await page.locator(`.g-t[href="?foto=${ALVO}"]`).click();
  await page.waitForSelector('.pswp--open', { timeout: 5000 });
  await espera(page, 500);
  const botao = page.locator('.pswp__button--g-ocultar');
  registra((await botao.count()) === 1 && (await botao.getAttribute('aria-pressed')) === 'false', 'Dono: o visualizador tem o botão de ocultar, desligado numa foto visível');
  await botao.click();
  await espera(page, 400);
  const depois = await page.evaluate(id => document.querySelector('.g-t[href="?foto=' + id + '"]')?.classList.contains('oculta'), ALVO);
  registra(estado.ocultar.length === 1 && estado.ocultar[0].foto === ALVO && estado.ocultar[0].oculta === true && depois === true
    && (await botao.getAttribute('aria-pressed')) === 'true', 'Dono: ocultar grava no servidor e marca a miniatura', estado.ocultar);
  registra((await page.locator('#g-aviso-flut').textContent() || '').startsWith('Oculta para os visitantes'), 'Dono: um aviso confirma que ocultou');
  registra((await page.locator('#g-n-ocultas').textContent()) === '2 ocultas para os visitantes', 'Dono: a contagem da faixa acompanha');
  await botao.click();
  await espera(page, 400);
  const voltou = await page.evaluate(id => document.querySelector('.g-t[href="?foto=' + id + '"]')?.classList.contains('oculta'), ALVO);
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

  const visit = await abre({ pagina: await paginaAssinada({ event: EVENTO, listagem: LISTAGEM, erro: null, nonce: NONCE, dono: false, redes: REDES }) });
  await visit.page.locator('.g-t').first().click();
  await visit.page.waitForSelector('.pswp--open', { timeout: 5000 });
  await espera(visit.page, 400);
  registra((await visit.page.locator('.pswp__button--g-ocultar').count()) === 0 && (await visit.page.locator('.g-oc').count()) === 0,
    'Visitante: nem botão de ocultar nem selo "Oculta"');
  await visit.ctx.close();
});

// ---- 6e. Pedir remoção desta foto (só o visitante) --------------------------
await cenario('Pedir remoção', async () => {
  const PAG = await paginaAssinada({ event: EVENTO, listagem: LISTAGEM, erro: null, nonce: NONCE, dono: false, redes: REDES, formToken: 'token-de-teste' });
  const { ctx, page, estado } = await abre({ pagina: PAG });
  const total0 = await page.evaluate(() => [...document.querySelectorAll('.g-bloco')].reduce((n, b) => n + Number(/** @type {HTMLElement} */ (b).dataset.n || 0), 0));
  const ALVO = raiz[0][0];
  const SEGUINTE = raiz[1][0];
  await page.locator('.g-t').first().click();
  await page.waitForSelector('.pswp--open', { timeout: 5000 });
  await espera(page, 500);

  // O link: texto discreto sob a legenda, só para o visitante, com alvo de toque de 44 px.
  const link = page.locator('.g-rem-link');
  const caixa = await link.boundingBox();
  const estilo = await link.evaluate(el => { const cs = getComputedStyle(el); return { borda: cs.borderTopWidth, filhos: el.children.length, tamanho: cs.fontSize, cursor: cs.cursor }; });
  registra((await link.count()) === 1 && (await link.textContent()) === 'Pedir remoção', 'Pedir remoção: o visitante vê o link sob a legenda do visualizador');
  registra(!!caixa && caixa.height >= 44 && caixa.width >= 44, 'Pedir remoção: o alvo de toque tem pelo menos 44 px', caixa);
  registra(estilo.borda === '0px' && estilo.filhos === 0 && parseFloat(estilo.tamanho) <= 14, 'Pedir remoção: é texto pequeno, sem borda nem ícone', estilo);
  registra((await page.locator('.pswp__top-bar .g-rem-link').count()) === 0, 'Pedir remoção: não está na barra de ferramentas');
  registra(estado.turnstile === 0, 'Pedir remoção: o Turnstile só é pedido quando o formulário abre', estado.turnstile);

  // Teclado: o Tab chega ao link e o Enter abre o formulário, com o foco dentro.
  let chegou = false;
  for (let i = 0; i < 14 && !chegou; i++) {
    await page.keyboard.press('Tab');
    chegou = await page.evaluate(() => document.activeElement?.classList.contains('g-rem-link') === true);
  }
  registra(chegou, 'Pedir remoção: o Tab chega ao link');
  await page.keyboard.press('Enter');
  await espera(page, 500);
  const aberto = await page.evaluate(() => {
    const d = /** @type {HTMLDialogElement} */ (document.getElementById('g-rem'));
    const img = /** @type {HTMLImageElement} */ (document.getElementById('g-rem-img'));
    return { aberto: d.open, foco: document.activeElement?.id || '', miniatura: img.src, honeypot: !!document.getElementById('company_website') };
  });
  registra(aberto.aberto && aberto.foco === 'g-rem-motivo', 'Pedir remoção: o formulário abre com o foco no motivo', aberto);
  registra(aberto.miniatura.includes(ALVO), 'Pedir remoção: mostra a miniatura da foto aberta', aberto.miniatura);
  registra(estado.turnstile === 1 && aberto.honeypot, 'Pedir remoção: o Turnstile é pedido ao abrir, e há o campo-isca', { turnstile: estado.turnstile });
  registra((await page.locator('#g-rem-motivo option').allTextContents()).join('|') === 'Escolha um motivo|Sou eu na foto|Sou responsável por um menor na foto|Outro motivo',
    'Pedir remoção: os três motivos do pedido', await page.locator('#g-rem-motivo option').allTextContents());
  if (PRINTS) await page.screenshot({ path: join(PRINTS, 'galeria-pedir-remocao.png') });

  // Esc fecha só o formulário: o visualizador continua aberto e o foco volta ao link.
  await page.keyboard.press('Escape');
  await espera(page, 400);
  const fechado = await page.evaluate(() => ({ aberto: /** @type {HTMLDialogElement} */ (document.getElementById('g-rem')).open, pswp: !!document.querySelector('.pswp--open'), foco: document.activeElement?.className || '' }));
  registra(!fechado.aberto && fechado.pswp && fechado.foco.includes('g-rem-link'), 'Pedir remoção: Esc fecha o formulário, mantém o visualizador e devolve o foco ao link', fechado);
  registra(estado.remocao.length === 0, 'Pedir remoção: fechar sem enviar não manda nada');

  // Validação no navegador antes de enviar: sem motivo, sem e-mail.
  await link.click();
  await espera(page, 400);
  registra(estado.turnstile === 1, 'Pedir remoção: abrir de novo não pede o script outra vez', estado.turnstile);
  await page.locator('#g-rem-enviar').click();
  registra((await page.locator('#g-rem-erro').textContent() || '').includes('motivo') && estado.remocao.length === 0, 'Pedir remoção: sem motivo, avisa e não envia');
  await page.selectOption('#g-rem-motivo', 'menor');
  await page.locator('#g-rem-enviar').click();
  registra((await page.locator('#g-rem-erro').textContent() || '').includes('e-mail') && estado.remocao.length === 0, 'Pedir remoção: sem e-mail válido, avisa e não envia');

  // Enviar. O servidor de mentira só registra: o pedido nunca esconde a foto.
  await page.fill('#g-rem-email', 'Ana@Example.com ');
  await page.fill('#g-rem-msg', 'É a minha filha.');
  await page.locator('#g-rem-enviar').click();
  await espera(page, 700);
  const corpo = estado.remocao[0] || {};
  registra(estado.remocao.length === 1 && corpo.slug === 'formatura' && corpo.foto === ALVO && corpo.motivo === 'menor' && corpo.email === 'Ana@Example.com'
    && corpo.mensagem === 'É a minha filha.' && /^tok-/.test(corpo.turnstileToken) && corpo.form_token === 'token-de-teste' && corpo.company_website === '',
    'Pedir remoção: o corpo leva foto, motivo, e-mail, mensagem, token do Turnstile, token do formulário e a isca vazia', corpo);
  const ok = await page.evaluate(() => ({
    visivel: !(/** @type {HTMLElement} */ (document.getElementById('g-rem-ok'))).hidden,
    texto: document.getElementById('g-rem-ok-txt')?.textContent || '',
    form: (/** @type {HTMLElement} */ (document.getElementById('g-rem-f'))).hidden,
  }));
  registra(ok.visivel && ok.form && ok.texto.includes('Recebemos o pedido') && ok.texto.includes('O fotógrafo vai analisar') && ok.texto.includes('e-mail')
    && !/saiu|na hora|agora|minutos/i.test(ok.texto),
    'Pedir remoção: a confirmação diz só que o fotógrafo vai analisar e responder por e-mail (nada de "sai na hora")', ok);
  if (PRINTS) await page.screenshot({ path: join(PRINTS, 'galeria-pedir-remocao-ok.png') });

  // A foto CONTINUA na grade e no visualizador: quem decide é o fotógrafo.
  const aposEnvio = await page.evaluate(([a, b]) => ({
    alvoNaGrade: document.querySelectorAll('.g-t[href="?foto=' + a + '"]').length,
    seguinteNaGrade: document.querySelectorAll('.g-t[href="?foto=' + b + '"]').length,
    total: [...document.querySelectorAll('.g-bloco')].reduce((n, b) => n + Number(/** @type {HTMLElement} */ (b).dataset.n || 0), 0),
    indices: [...document.querySelectorAll('.g-t')].every((t, i) => /** @type {HTMLElement} */ (t).dataset.i === String(i)),
  }), [ALVO, SEGUINTE]);
  registra(aposEnvio.alvoNaGrade === 1 && aposEnvio.seguinteNaGrade === 1 && aposEnvio.total === total0 && aposEnvio.indices,
    'Pedir remoção: depois do envio a foto continua na grade (o pedido não esconde nada)', aposEnvio);
  await page.keyboard.press('Escape');
  await espera(page, 600);
  const viewer = await page.evaluate(() => ({
    pswp: !!document.querySelector('.pswp--open'),
    contador: document.querySelector('.pswp__counter')?.textContent || '',
    src: /** @type {HTMLImageElement | null} */ (document.querySelector('.pswp__item:not([aria-hidden="true"]) img.pswp__img:not(.pswp__img--placeholder)'))?.currentSrc || '',
  }));
  registra(viewer.pswp && viewer.contador === '1 de ' + total0 && viewer.src.includes(ALVO),
    'Pedir remoção: ao fechar a confirmação, o visualizador segue na mesma foto, com o contador intacto', viewer);
  registra(estado.erros.length === 0 && estado.csp.length === 0, 'Pedir remoção: sem erro de JS nem CSP', [...estado.erros, ...estado.csp]);
  await ctx.close();

  // O servidor recusa (Turnstile, limite…): a mensagem aparece, a foto fica e dá para tentar de novo.
  const rec = await abre({ pagina: PAG, remocao: () => ({ status: 403, json: { error: 'Verificação de segurança falhou. Recarregue e tente novamente.' } }) });
  await rec.page.locator('.g-t').first().click();
  await rec.page.waitForSelector('.pswp--open', { timeout: 5000 });
  await rec.page.locator('.g-rem-link').click();
  await espera(rec.page, 400);
  await rec.page.selectOption('#g-rem-motivo', 'eu');
  await rec.page.fill('#g-rem-email', 'ana@example.com');
  await rec.page.locator('#g-rem-enviar').click();
  await espera(rec.page, 600);
  const recusa = await rec.page.evaluate(() => ({
    erro: document.getElementById('g-rem-erro')?.textContent || '',
    formVisivel: !(/** @type {HTMLElement} */ (document.getElementById('g-rem-f'))).hidden,
    fotos: [...document.querySelectorAll('.g-bloco')].reduce((n, b) => n + Number(/** @type {HTMLElement} */ (b).dataset.n || 0), 0),
    habilitado: !(/** @type {HTMLButtonElement} */ (document.getElementById('g-rem-enviar'))).disabled,
  }));
  registra(recusa.erro.includes('Verificação') && recusa.formVisivel && recusa.fotos === total0 && recusa.habilitado,
    'Pedir remoção: servidor recusa — mostra o motivo, mantém a foto e deixa tentar de novo (com novo token)', recusa);
  registra(rec.estado.erros.length === 0 && rec.estado.csp.length === 0, 'Pedir remoção (recusa): sem erro de JS nem CSP', [...rec.estado.erros, ...rec.estado.csp]);
  await rec.ctx.close();

  // Acima do teto de pedidos por IP o servidor segue só por e-mail e responde o mesmo: a página não muda.
  const teto = await abre({ pagina: PAG, remocao: () => ({ status: 200, json: { ok: true } }) });
  await teto.page.locator('.g-t').first().click();
  await teto.page.waitForSelector('.pswp--open', { timeout: 5000 });
  await teto.page.locator('.g-rem-link').click();
  await espera(teto.page, 400);
  await teto.page.selectOption('#g-rem-motivo', 'outro');
  await teto.page.fill('#g-rem-email', 'ana@example.com');
  await teto.page.locator('#g-rem-enviar').click();
  await espera(teto.page, 600);
  const semOcultar = await teto.page.evaluate(() => ({ txt: document.getElementById('g-rem-ok-txt')?.textContent || '', fotos: [...document.querySelectorAll('.g-bloco')].reduce((n, b) => n + Number(/** @type {HTMLElement} */ (b).dataset.n || 0), 0) }));
  registra(semOcultar.fotos === total0 && !semOcultar.txt.includes('saiu da galeria') && semOcultar.txt.includes('analisar'),
    'Pedir remoção: a foto continua na galeria e o texto só diz que será analisado', semOcultar);
  await teto.ctx.close();

  // Bloqueador de anúncios: o Turnstile não carrega, o aviso aparece e o botão fica desligado.
  const bloq = await abre({ pagina: PAG, turnstile: 'bloqueado' });
  await bloq.page.locator('.g-t').first().click();
  await bloq.page.waitForSelector('.pswp--open', { timeout: 5000 });
  await bloq.page.locator('.g-rem-link').click();
  await espera(bloq.page, 600);
  const bl = await bloq.page.evaluate(() => ({ erro: document.getElementById('g-rem-erro')?.textContent || '', desligado: /** @type {HTMLButtonElement} */ (document.getElementById('g-rem-enviar')).disabled }));
  registra(bl.erro.includes('verificação de segurança') && bl.desligado, 'Pedir remoção: Turnstile bloqueado — avisa e não deixa enviar', bl);
  await bloq.ctx.close();

  // Galeria de uma foto só: depois do pedido ela continua lá e o visualizador não fecha sozinho.
  const UMA = { ...LISTAGEM, total: 1, secoes: [{ nome: '', caminho: '', fotos: [raiz[0]] }] };
  const solo = await abre({ pagina: await paginaAssinada({ event: EVENTO, listagem: UMA, erro: null, nonce: NONCE, dono: false, redes: REDES, formToken: 'token-de-teste' }) });
  await solo.page.locator('.g-t').first().click();
  await solo.page.waitForSelector('.pswp--open', { timeout: 5000 });
  await solo.page.locator('.g-rem-link').click();
  await espera(solo.page, 400);
  await solo.page.selectOption('#g-rem-motivo', 'eu');
  await solo.page.fill('#g-rem-email', 'ana@example.com');
  await solo.page.locator('#g-rem-enviar').click();
  await espera(solo.page, 600);
  await solo.page.keyboard.press('Escape');
  await espera(solo.page, 700);
  const vazio = await solo.page.evaluate(() => ({ pswp: !!document.querySelector('.pswp--open'), dialogo: /** @type {HTMLDialogElement} */ (document.getElementById('g-rem')).open, fotos: document.querySelectorAll('.g-t').length }));
  registra(vazio.pswp && !vazio.dialogo && vazio.fotos === 1, 'Pedir remoção: era a única foto — ela continua na grade e o visualizador segue aberto', vazio);
  registra(solo.estado.erros.length === 0 && solo.estado.csp.length === 0, 'Pedir remoção (única foto): sem erro de JS nem CSP', [...solo.estado.erros, ...solo.estado.csp]);
  await solo.ctx.close();

  // No celular: o link cabe na tela e o formulário não vaza para o lado.
  const cel = await abre({ pagina: PAG, viewport: { width: 360, height: 780 }, dpr: 3, toque: true });
  await cel.page.locator('.g-t').first().click();
  await cel.page.waitForSelector('.pswp--open', { timeout: 5000 });
  await espera(cel.page, 500);
  const cx = await cel.page.locator('.g-rem-link').boundingBox();
  registra(!!cx && cx.x >= 0 && cx.x + cx.width <= 360 && cx.height >= 44, 'Pedir remoção no celular (360 px): o link cabe na tela e tem 44 px de alvo', cx);
  if (PRINTS) await cel.page.screenshot({ path: join(PRINTS, 'galeria-pedir-remocao-celular.png') });
  await cel.page.locator('.g-rem-link').tap();
  await espera(cel.page, 500);
  const medidas = await cel.page.evaluate(() => {
    const d = document.getElementById('g-rem');
    const r = d ? d.getBoundingClientRect() : { left: 0, right: 0, top: 0, bottom: 0 };
    const alvos = [...document.querySelectorAll('#g-rem button, #g-rem select, #g-rem input:not(#company_website)')].filter(e => /** @type {HTMLElement} */ (e).offsetParent !== null).map(e => Math.round(e.getBoundingClientRect().height));
    return { l: Math.round(r.left), r: Math.round(r.right), b: Math.round(r.bottom), h: window.innerHeight, rolagemX: document.documentElement.scrollWidth > window.innerWidth, alvos };
  });
  registra(medidas.l >= 0 && medidas.r <= 360 && medidas.b <= medidas.h && !medidas.rolagemX && medidas.alvos.every(a => a >= 40), 'Pedir remoção no celular: o formulário cabe na tela e os campos têm alvo de toque', medidas);
  if (PRINTS) await cel.page.screenshot({ path: join(PRINTS, 'galeria-pedir-remocao-formulario-celular.png') });
  await cel.ctx.close();

  // Tema escuro: o link e o formulário continuam legíveis.
  const esc = await abre({ pagina: PAG, escuro: true });
  await esc.page.locator('.g-t').first().click();
  await esc.page.waitForSelector('.pswp--open', { timeout: 5000 });
  await esc.page.locator('.g-rem-link').click();
  await espera(esc.page, 500);
  if (PRINTS) await esc.page.screenshot({ path: join(PRINTS, 'galeria-pedir-remocao-escuro.png') });
  await esc.ctx.close();

  // O dono não tem o link nem o formulário (ele tem o "Ocultar").
  const donoPag = await paginaAssinada({ event: EVENTO, listagem: LISTAGEM, erro: null, nonce: NONCE, dono: true, ocultas: [], redes: REDES });
  const d = await abre({ pagina: donoPag });
  await d.page.locator('.g-t').first().click();
  await d.page.waitForSelector('.pswp--open', { timeout: 5000 });
  await espera(d.page, 400);
  registra((await d.page.locator('.g-rem-link').count()) === 0 && (await d.page.locator('#g-rem').count()) === 0, 'Pedir remoção: o dono não vê o link nem o formulário');
  await d.ctx.close();
});

// ---- 6f. Galeria por capítulos: créditos, nomes amigáveis, navegação -----------
// A página de UM capítulo (v3.1): vários fotógrafos na mesma pasta (linha
// "Fotos: A, B e C", filtro por fotógrafo, "Foto: X" na legenda), o nome do
// arquivo baixado com a data/hora da foto (a página junta o mesmo que o
// servidor manda no Content-Disposition), e a navegação para o capítulo
// anterior/seguinte e o índice. Em 390 e em 360 px, sem rolagem lateral.
const AUTORES_CAP = ['Luca F. Chala', 'Ana Souza', 'Bruno Lima'];
const NOME_LONGO = 'Festa de gala com um nome bem comprido para testar o corte no celular';
/** @param {typeof raiz} fotos @param {number} desde */
const comAutor = (fotos, desde) => fotos.map((f, i) => /** @type {import('../src/drive.js').FotoDrive} */ ([f[0], f[1], f[2], f[3], f[4], (desde + i) % 3, 20261105143000 + (desde + i) * 7]));
const LISTAGEM_CAP = {
  v: /** @type {2} */ (2), pasta: 'RAIZ_PASTA_0001', em: '2026-10-10T12:00:00.000Z', truncada: false,
  total: 12, videos: 0, outros: 0, rk: {}, aut: AUTORES_CAP,
  secoes: [{ nome: '', caminho: '', fotos: comAutor(raiz.slice(0, 6), 0) }, { nome: 'Brinde', caminho: 'Brinde', fotos: comAutor(festa.slice(0, 6), 6) }],
};
const EVENTO_CAP = { ...EVENTO, nomesAmigaveis: true, galeriaCapitulos: true };
const CAP_ATUAL = { slug: 'cerimonia', nome: 'Cerimônia', anterior: { slug: 'abertura', nome: 'Abertura' }, proximo: { slug: 'festa-de-gala', nome: NOME_LONGO } };
const PAGINA_CAP = await paginaAssinada({ event: /** @type {any} */ (EVENTO_CAP), listagem: LISTAGEM_CAP, listagemBruta: LISTAGEM_CAP, capituloNome: 'Cerimônia', capitulo: CAP_ATUAL, erro: null, nonce: NONCE, dono: false, formToken: '' });
for (const [nome, viewport, dpr] of /** @type {const} */ ([['iPhone 390', { width: 390, height: 844 }, 3], ['Android 360', { width: 360, height: 780 }, 2]])) {
  await cenario(`Capítulo: ${nome}`, async () => {
    const { ctx, page, estado } = await abre({ pagina: PAGINA_CAP, url: 'https://fotos.test/galeria/formatura/cerimonia', viewport, dpr, toque: true });
    await espera(page, 800);
    const topo = await page.evaluate(() => {
      const nav = /** @type {HTMLElement} */ (document.querySelector('.g-cap-topo'));
      const links = [...document.querySelectorAll('.g-cap-topo .g-cap-a, .g-cap-fim .g-cap-a')].map(a => {
        const r = a.getBoundingClientRect();
        return { href: a.getAttribute('href'), alt: Math.round(r.height), dir: Math.round(r.right), esq: Math.round(r.left) };
      });
      const chips = /** @type {HTMLElement} */ (document.getElementById('g-chips'));
      const cr = [...document.querySelectorAll('.g-chip')].map(c => Math.round(c.getBoundingClientRect().height));
      return {
        h1: (document.getElementById('g-h1') || {}).textContent,
        autores: (document.querySelector('.g-autores') || {}).textContent,
        title: document.title,
        navOverflow: nav.scrollWidth > nav.clientWidth + 1,
        links,
        chipsVisiveis: !chips.hidden,
        grupo: [...document.querySelectorAll('.g-chips-grupo [data-acao="filtro-autor"]')].map(b => (b.textContent || '').replace(/\s+/g, ' ').trim()),
        grupoRotulo: (document.querySelector('.g-chips-grupo') || document.body).getAttribute('aria-label'),
        chipsAlturas: cr,
        lateral: document.scrollingElement.scrollWidth > window.innerWidth,
      };
    });
    registra(topo.h1 === 'Formatura 2026 · Cerimônia' && /Cerimônia/.test(topo.title), `${nome}: o título diz o evento e o capítulo`, { h1: topo.h1, title: topo.title });
    registra(topo.autores === 'Fotos de Luca F. Chala, Ana Souza e Bruno Lima', `${nome}: a linha de créditos lista os três fotógrafos`, topo.autores);
    registra(topo.chipsVisiveis && topo.grupoRotulo === 'Fotógrafo' && topo.grupo.length === 4 && /^Todos/.test(topo.grupo[0]) && topo.grupo.slice(1).every((t, i) => t.startsWith(AUTORES_CAP[i])),
      `${nome}: filtro por fotógrafo (Todos + um por autor), em grupo rotulado`, topo.grupo);
    registra(topo.chipsAlturas.length > 0 && topo.chipsAlturas.every(h => h >= 44), `${nome}: todos os chips têm 44 px de alvo`, topo.chipsAlturas);
    const hrefs = topo.links.map(l => l.href);
    registra(hrefs.includes('/galeria/formatura/abertura') && hrefs.includes('/galeria/formatura/festa-de-gala') && hrefs.includes('/galeria/formatura'),
      `${nome}: navegação para o capítulo anterior, o seguinte e o índice`, hrefs);
    registra(topo.links.every(l => l.alt >= 44 && l.esq >= 0 && l.dir <= viewport.width), `${nome}: os links de capítulo têm 44 px e cabem na largura (nome longo cortado)`, topo.links);
    registra(!topo.navOverflow && !topo.lateral, `${nome}: a barra de capítulos e a página não rolam para o lado`, { nav: topo.navOverflow, pagina: topo.lateral });

    // Filtrar por Ana: só as fotos dela (índices 1, 4, 7, 10 → 4 fotos).
    const total = await page.locator('.g-t').count();
    await page.locator('.g-chips-grupo [data-acao="filtro-autor"]').nth(2).tap();
    await espera(page, 500);
    const filtrado = await page.evaluate(() => ({
      n: document.querySelectorAll('.g-t').length,
      marcado: [...document.querySelectorAll('.g-chips-grupo [aria-pressed="true"]')].map(b => (b.textContent || '').trim().split(/\s+/).slice(0, 2).join(' ')),
      lateral: document.scrollingElement.scrollWidth > window.innerWidth,
    }));
    registra(total === 12 && filtrado.n === 4 && filtrado.marcado.length === 1 && filtrado.marcado[0].startsWith('Ana') && !filtrado.lateral,
      `${nome}: filtrar por Ana mostra só as 4 fotos dela, com o chip marcado`, { total, ...filtrado });
    await page.locator('.g-chips-grupo [data-acao="filtro-autor"]').nth(2).tap();
    await espera(page, 400);
    registra(await page.locator('.g-t').count() === 12, `${nome}: tocar de novo no fotógrafo volta a todas as fotos`);

    // Legenda do visualizador com o crédito, e o nome amigável do download.
    await page.evaluate(() => {
      /** @type {any} */ (window).__links = [];
      const orig = HTMLAnchorElement.prototype.click;
      HTMLAnchorElement.prototype.click = function () {
        /** @type {any} */ (window).__links.push({ href: this.getAttribute('href'), download: this.getAttribute('download') });
        return orig.call(this);
      };
    });
    await page.locator('.g-t').nth(1).tap(); // foto 2: da Ana, na seção da raiz
    await page.waitForSelector('.pswp--open');
    await espera(page, 800);
    const legenda = await page.evaluate(() => ({ txt: (document.querySelector('.g-leg-autor') || {}).textContent || '', todo: (document.querySelector('.pswp__custom-caption, .g-legenda') || document.body).textContent || '' }));
    registra(legenda.txt === 'Foto de Ana Souza', `${nome}: a legenda do visualizador credita a fotógrafa da foto`, legenda.txt);
    await page.locator('.pswp__button--g-baixar').tap();
    await page.waitForSelector('#g-folha:not([hidden])');
    await page.locator('.g-op').last().tap();
    await espera(page, 600);
    const links = await page.evaluate(() => /** @type {any} */ (window).__links);
    const idAna = LISTAGEM_CAP.secoes[0].fotos[1][0];
    const esperado = nomeAmigavel(/** @type {any} */ (LISTAGEM_CAP), { titulo: 'Formatura 2026', capitulo: 'Cerimônia' }, idAna, 'x.jpg');
    const baixou = links.find((/** @type {any} */ l) => /\/baixar\//.test(l.href || ''));
    registra(!!baixou && baixou.href === `/galeria/formatura/cerimonia/baixar/${idAna}?v=max` && baixou.download === esperado && /Ana Souza/.test(esperado || '') && /Cerim/.test(esperado || '') && esperado !== LISTAGEM_CAP.secoes[0].fotos[1][3],
      `${nome}: o download leva o nome amigável (evento, capítulo, fotógrafa, data/hora) — o mesmo cálculo do servidor`, { baixou, esperado });
    if (nome === 'iPhone 390') await verificaAxe(page, registra, `${nome}: capítulo com vários fotógrafos (tema claro)`);
    registra(estado.erros.length === 0 && estado.csp.length === 0, `${nome}: capítulo sem erro de JS nem CSP`, [...estado.erros, ...estado.csp]);
    await ctx.close();
  });
}

// ---- 6g. Índice de capítulos ----------------------------------------------------
// Um cartão por subpasta, com a capa e a contagem do resumo; capítulo vazio só
// para o dono; nome comprido quebra sem estourar a tela (360 px).
const CAPS_IDX = {
  v: /** @type {1} */ (1), pasta: 'RAIZ_PASTA_0001', em: '2026-10-10T12:00:00.000Z', truncada: false,
  caps: [
    { id: 'CAPABERTURA0001', rk: '', bruto: 'Abertura', nome: 'Abertura', slug: 'abertura' },
    { id: 'CAPCERIMONIA001', rk: '', bruto: 'Cerimônia', nome: 'Cerimônia', slug: 'cerimonia' },
    { id: 'CAPGALA00000001', rk: '', bruto: NOME_LONGO, nome: NOME_LONGO, slug: 'festa-de-gala' },
    { id: 'CAPVAZIO0000001', rk: '', bruto: 'Ainda sem fotos', nome: 'Ainda sem fotos', slug: 'ainda-sem-fotos' },
  ],
};
const RESUMO_IDX = { CAPABERTURA0001: { n: 1, capas: [raiz[0][0]] }, CAPCERIMONIA001: { n: 12, capas: [raiz[1][0]] }, CAPGALA00000001: { n: 120, capas: [raiz[2][0]] }, CAPVAZIO0000001: { n: 0, capas: [], z: Date.now() } };
for (const [nome, viewport, dpr, dono] of /** @type {const} */ ([['visitante 360', { width: 360, height: 780 }, 2, false], ['visitante 390', { width: 390, height: 844 }, 3, false], ['dono 360', { width: 360, height: 780 }, 2, true]])) {
  await cenario(`Índice: ${nome}`, async () => {
    const pagina = galeriaIndiceHTML({ event: /** @type {any} */ ({ ...EVENTO, galeriaCapitulos: true }), caps: CAPS_IDX, resumo: RESUMO_IDX, ocultas: [], dono, indexavel: true, nonce: NONCE });
    const { ctx, page, estado } = await abre({ pagina, viewport, dpr, toque: true });
    await espera(page, 500);
    const m = await page.evaluate(() => {
      const cards = [...document.querySelectorAll('.ix-card')].map(c => {
        const r = c.getBoundingClientRect();
        return { nome: (c.querySelector('.ix-nome') || {}).textContent, sub: (c.querySelector('.ix-sub') || {}).textContent, href: c.getAttribute('href'), alt: Math.round(r.height), esq: Math.round(r.left), dir: Math.round(r.right) };
      });
      return { cards, lateral: document.scrollingElement.scrollWidth > window.innerWidth, h1: (document.querySelector('h1') || {}).textContent, meta: (document.querySelector('.ix-meta') || {}).textContent };
    });
    const nomes = m.cards.map(c => c.nome);
    registra(m.h1 === 'Formatura 2026', `Índice ${nome}: o título é o do evento`, m.h1);
    if (dono) {
      registra(m.cards.length === 4 && m.cards[3].sub === 'vazio', `Índice ${nome}: o dono vê o capítulo vazio, marcado "vazio"`, m.cards.map(c => c.sub));
    } else {
      registra(m.cards.length === 3 && !nomes.includes('Ainda sem fotos'), `Índice ${nome}: o visitante não vê o capítulo vazio`, nomes);
      registra(m.cards[0].sub === '1 foto' && m.cards[1].sub === '12 fotos', `Índice ${nome}: a contagem do cartão (singular e plural)`, m.cards.map(c => c.sub));
    }
    registra(m.cards.every(c => c.href && c.href.startsWith('/galeria/formatura/') && c.alt >= 44 && c.esq >= 0 && c.dir <= viewport.width), `Índice ${nome}: cada cartão leva ao capítulo, cabe na tela e tem alvo de toque`, m.cards);
    registra(!m.lateral, `Índice ${nome}: sem rolagem lateral (nome comprido incluso)`);
    if (nome === 'visitante 390') await verificaAxe(page, registra, `Índice ${nome}: capítulos (tema claro)`);
    registra(estado.erros.length === 0 && estado.csp.length === 0, `Índice ${nome}: sem erro de JS nem CSP`, [...estado.erros, ...estado.csp]);
    await ctx.close();
  });
}

// "N novas" nos cartões (item j, #250): a visita anterior ao capítulo está no
// localStorage; só o cartão com foto mais nova que ela ganha a marca.
await cenario('Índice: N novas desde a última visita', async () => {
  const agora = Date.now();
  const cr = (/** @type {number} */ atrasoMs) => Math.floor((agora - atrasoMs - EPOCA_CRIADA_MS) / 60_000);
  const resumo = { ...RESUMO_IDX, CAPCERIMONIA001: { n: 12, capas: [raiz[1][0]], cr: [cr(3_600_000), cr(2 * 3_600_000), cr(10 * 3_600_000)] } };
  const pagina = galeriaIndiceHTML({ event: /** @type {any} */ ({ ...EVENTO, galeriaCapitulos: true }), caps: CAPS_IDX, resumo, ocultas: [], dono: false, indexavel: true, nonce: NONCE });
  const visita = { p: 0, u: agora - 5 * 3_600_000 };
  const { ctx, page, estado } = await abre({ pagina, viewport: { width: 390, height: 844 }, dpr: 2, toque: true, storage: { 'gal-visita:formatura:cerimonia': JSON.stringify(visita), 'gal-visita:formatura:abertura': JSON.stringify(visita) } });
  await espera(page, 500);
  const m = await page.evaluate(() => [...document.querySelectorAll('.ix-card')].map(c => ((c.querySelector('.ix-novas') || {}).textContent || '')));
  registra(m[1] === '2 novas' && m[0] === '' && m[2] === '', 'Índice novas: só o capítulo com fotos depois da última visita ganha "2 novas" (a foto de 10 h atrás é anterior)', m);
  registra(estado.erros.length === 0 && estado.csp.length === 0, 'Índice novas: sem erro de JS nem CSP', [...estado.erros, ...estado.csp]);
  await ctx.close();
});

// ---- 6g. Vídeos e Live Photo (item 1f) --------------------------------------
// O vídeo é um item da grade (selo de play com a duração); o Live Photo é uma
// foto com selo "LIVE". No visualizador (v4.3.0) o vídeo abre no player estilo
// reels: <video> da própria origem, tocando mudo, toque pausa, botão de som,
// barra arrastável. Nada do Google carrega. Se o <video> falhar, cai na
// FACHADA (miniatura + play) e só o toque no play põe o iframe do Drive.
const MIDIA_FOTOS = /** @type {import('../src/drive.js').FotoDrive[]} */ ([
  ['MIDIAFOTO_000001', 4032, 3024, 'IMG_0100.HEIC', 3_000_000, 0, 20261105143000, ['MIDIALIVE_000001', 'IMG_0100.MOV', 2_000_000]],
  ['MIDIAVIDEO_00001', 1920, 1080, 'passeio.mp4', 90_000_000, 0, 0, 75],
  ['MIDIAFOTO_000002', 4032, 3024, 'IMG_0101.jpg', 3_000_000, 0, 20261105143100],
]);
for (const f of MIDIA_FOTOS) POR_ID.set(f[0], /** @type {any} */ (f));
const LISTAGEM_MIDIA = {
  v: /** @type {3} */ (3), pasta: 'RAIZ_PASTA_0001', em: '2026-10-10T12:00:00.000Z', truncada: false,
  total: 3, videos: 1, outros: 0, rk: {}, secoes: [{ nome: '', caminho: '', fotos: MIDIA_FOTOS }],
};
const PAGINA_MIDIA = await paginaAssinada({ event: EVENTO, listagem: LISTAGEM_MIDIA, erro: null, nonce: NONCE });
for (const [nome, viewport, dpr, toque] of /** @type {const} */ ([['desktop', { width: 1440, height: 900 }, 1, false], ['iPhone 390', { width: 390, height: 844 }, 3, true]])) {
  await cenario(`Vídeo: ${nome}`, async () => {
    const { ctx, page, estado } = await abre({ pagina: PAGINA_MIDIA, viewport, dpr, toque, driveFrame: true });
    await espera(page, 800);
    const grade = await page.evaluate(() => ({
      n: document.querySelectorAll('.g-t').length,
      play: [...document.querySelectorAll('.g-t .g-play')].map(e => (e.textContent || '').trim()),
      live: [...document.querySelectorAll('.g-t .g-live')].map(e => (e.textContent || '').trim()),
      rotulos: [...document.querySelectorAll('.g-t')].map(a => a.getAttribute('aria-label')),
      iframes: document.querySelectorAll('iframe').length,
      videos: document.querySelectorAll('video').length,
      lateral: document.scrollingElement.scrollWidth > window.innerWidth,
    }));
    registra(grade.n === 3 && grade.play.length === 1 && grade.play[0] === '1:15' && grade.live.length === 1 && grade.live[0] === 'LIVE',
      `Vídeo ${nome}: a grade mostra o selo de play com a duração (1:15) e o selo LIVE na foto`, grade);
    registra(/^Vídeo passeio/.test(grade.rotulos[1] || '') && /^Live Photo IMG_0100/.test(grade.rotulos[0] || '') && /^Foto IMG_0101/.test(grade.rotulos[2] || ''),
      `Vídeo ${nome}: o rótulo de cada tile diz se é vídeo, Live Photo ou foto`, grade.rotulos);
    registra(grade.iframes === 0 && grade.videos === 0 && estado.drive.length === 0 && estado.video.length === 0,
      `Vídeo ${nome}: antes de abrir, nenhum player, nenhum pedido de vídeo nem ao Google Drive`, { ...grade, drive: estado.drive, video: estado.video });
    registra(!grade.lateral, `Vídeo ${nome}: sem rolagem lateral`);

    // Abre o vídeo: o player toca sozinho, mudo, pela rota do próprio site.
    if (toque) await page.locator('.g-t').nth(1).tap(); else await page.locator('.g-t').nth(1).click();
    await page.waitForSelector('.pswp--open', { timeout: 5000 });
    await page.waitForFunction(() => { const v = /** @type {HTMLVideoElement|null} */ (document.querySelector('.pswp .g-reel video')); return !!v && !v.paused && v.currentTime > 0; }, null, { timeout: 6000 }).catch(() => {});
    const player = await page.evaluate(() => {
      const box = document.querySelector('.pswp .g-reel');
      const v = /** @type {HTMLVideoElement|null} */ (box && box.querySelector('video'));
      const som = box && box.querySelector('.g-vid-som');
      const barra = box && box.querySelector('.g-vid-barra');
      const rs = som ? som.getBoundingClientRect() : null;
      const rv = v ? v.getBoundingClientRect() : null;
      return {
        tem: !!v, tocando: !!v && !v.paused, mudo: !!v && v.muted, inline: !!v && v.hasAttribute('playsinline'), loop: !!v && v.loop,
        poster: v ? v.getAttribute('poster') : '', src: v ? v.getAttribute('src') : '', controls: !!v && v.controls,
        som: som ? { rotulo: som.getAttribute('aria-label'), pressed: som.getAttribute('aria-pressed'), alvo: rs ? Math.round(Math.min(rs.width, rs.height)) : 0 } : null,
        barra: barra ? { role: barra.getAttribute('role'), texto: barra.getAttribute('aria-valuetext'), foco: /** @type {HTMLElement} */ (barra).tabIndex } : null,
        resta: (box && box.querySelector('.g-vid-resta') || { textContent: '' }).textContent,
        enche: rv ? Math.round(rv.width) >= Math.round(window.innerWidth * 0.95) || Math.round(rv.height) >= Math.round(window.innerHeight * 0.6) : false,
        iframes: document.querySelectorAll('iframe').length,
        legenda: (document.querySelector('.pswp__g-legenda') || document.body).textContent,
      };
    });
    registra(player.tem && player.tocando && player.mudo && player.inline && player.loop && !player.controls,
      `Vídeo ${nome}: o slide do vídeo toca sozinho, mudo, inline e em loop, sem os controles do navegador`, player);
    registra(/\/galeria\/formatura\/video\/MIDIAVIDEO_00001$/.test(player.src || '') && /\/f\/MIDIAVIDEO_00001\/1280/.test(player.poster || ''),
      `Vídeo ${nome}: o vídeo vem da rota do próprio site e o pôster é a miniatura`, { src: player.src, poster: player.poster });
    registra(estado.video.length > 0 && estado.video.every(x => x.id === 'MIDIAVIDEO_00001') && estado.video.some(x => /^bytes=0-/.test(x.range)),
      `Vídeo ${nome}: o navegador pede o vídeo com Range (é o que deixa pular e tocar no iPhone)`, estado.video);
    registra(player.iframes === 0 && estado.drive.length === 0, `Vídeo ${nome}: nada do Google Drive (nem iframe)`, { iframes: player.iframes, drive: estado.drive });
    registra(!!player.som && player.som.rotulo === 'Ligar o som' && player.som.pressed === 'false' && player.som.alvo >= 44,
      `Vídeo ${nome}: botão de som redondo de 44 px, rotulado, começando mudo`, player.som);
    registra(!!player.barra && player.barra.role === 'slider' && player.barra.foco === 0 && / de 1:15$| de 0:0[0-9]$/.test(player.barra.texto || '') && /^-\d+:\d\d$/.test(player.resta || ''),
      `Vídeo ${nome}: barra de progresso acessível (slider) e o tempo que falta`, { barra: player.barra, resta: player.resta });
    registra(player.enche, `Vídeo ${nome}: o vídeo ocupa o slide`, player);
    registra(/passeio/.test(player.legenda || ''), `Vídeo ${nome}: a legenda mostra o nome do vídeo`, player.legenda);

    // Toque/clique no vídeo pausa (ícone de play aparece); de novo, continua.
    const naTela = page.locator('.pswp .g-reel video');
    const toca = async () => { if (toque) await naTela.tap({ position: { x: 60, y: 120 } }); else await naTela.click({ position: { x: 60, y: 120 } }); };
    await toca();
    await espera(page, toque ? 700 : 400);
    const pausado = await page.evaluate(() => ({ p: !!(/** @type {HTMLVideoElement} */ (document.querySelector('.pswp .g-reel video'))).paused, cls: !!document.querySelector('.pswp .g-reel.pausado'), barraUi: document.querySelector('.pswp')?.classList.contains('pswp--ui-visible') }));
    registra(pausado.p && pausado.cls && pausado.barraUi, `Vídeo ${nome}: tocar no vídeo pausa e mostra o ícone de play (sem esconder a barra do visualizador)`, pausado);
    await toca();
    await espera(page, toque ? 700 : 400);
    const voltou = await page.evaluate(() => !(/** @type {HTMLVideoElement} */ (document.querySelector('.pswp .g-reel video'))).paused);
    registra(voltou, `Vídeo ${nome}: tocar de novo continua`, voltou);

    // Som: liga, vale para a sessão, e o toque no botão não pausa o vídeo.
    const cobre = await page.evaluate(() => {
      const b = document.querySelector('.pswp .g-vid-som');
      if (!b) return 'sem botão';
      const r = b.getBoundingClientRect();
      const el = document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2);
      return el === b || b.contains(el) ? 'livre' : (el ? el.className || el.tagName : 'nada') + ' ' + JSON.stringify(r);
    });
    registra(cobre === 'livre', `Vídeo ${nome}: nada cobre o botão de som`, cobre);
    if (process.env.VERIFICA_PRINTS) await page.screenshot({ path: join(process.env.VERIFICA_PRINTS, `video-${nome.replace(/\W+/g, '-')}.png`) });
    const cobreBarra = await page.evaluate(() => {
      const b = document.querySelector('.pswp .g-vid-barra');
      if (!b) return 'sem barra';
      const r = b.getBoundingClientRect();
      const el = document.elementFromPoint(r.x + r.width * 0.8, r.y + r.height / 2);
      return el === b || b.contains(el) ? 'livre' : (el ? el.className || el.tagName : 'nada');
    });
    registra(cobreBarra === 'livre', `Vídeo ${nome}: nada cobre a barra de progresso`, cobreBarra);
    if (toque) await page.locator('.pswp .g-vid-som').tap(); else await page.locator('.pswp .g-vid-som').click();
    await espera(page, 300);
    const som = await page.evaluate(() => {
      const v = /** @type {HTMLVideoElement} */ (document.querySelector('.pswp .g-reel video'));
      const b = /** @type {HTMLElement} */ (document.querySelector('.pswp .g-vid-som'));
      return { mudo: v.muted, tocando: !v.paused, rotulo: b.getAttribute('aria-label'), pressed: b.getAttribute('aria-pressed'), guardado: sessionStorage.getItem('g-som'), aberto: !!document.querySelector('.pswp--open') };
    });
    registra(!som.mudo && som.tocando && som.rotulo === 'Desligar o som' && som.pressed === 'true' && som.guardado === '1' && som.aberto,
      `Vídeo ${nome}: o botão liga o som (lembrado na sessão) sem pausar nem fechar`, som);

    // Barra: arrastar/tocar nela pula; as setas no teclado andam o vídeo e NÃO trocam de slide.
    await page.evaluate(() => { const v = /** @type {HTMLVideoElement} */ (document.querySelector('.pswp .g-reel video')); v.pause(); v.currentTime = 0; });
    await espera(page, 200);
    const bb = await page.locator('.pswp .g-vid-barra').boundingBox();
    if (bb) {
      if (toque) await page.touchscreen.tap(bb.x + bb.width * 0.8, bb.y + bb.height / 2); else await page.mouse.click(bb.x + bb.width * 0.8, bb.y + bb.height / 2);
    }
    await espera(page, 400);
    const pulo = await page.evaluate(() => {
      const v = /** @type {HTMLVideoElement} */ (document.querySelector('.pswp .g-reel video'));
      return { t: v.currentTime, pausado: v.paused, aberto: !!document.querySelector('.pswp--open'), legenda: (document.querySelector('.pswp__g-legenda') || document.body).textContent };
    });
    registra(pulo.aberto && pulo.pausado && pulo.t > 0.3 && /passeio/.test(pulo.legenda || ''), `Vídeo ${nome}: tocar na barra pula o vídeo (parado) sem trocar de slide`, pulo);
    await page.evaluate(() => (/** @type {HTMLVideoElement} */ (document.querySelector('.pswp .g-reel video'))).play());
    if (!toque) {
      await page.locator('.pswp .g-vid-barra').focus();
      const antes = await page.evaluate(() => (/** @type {HTMLVideoElement} */ (document.querySelector('.pswp .g-reel video'))).currentTime);
      await page.keyboard.press('Home');
      await espera(page, 200);
      const depoisHome = await page.evaluate(() => (/** @type {HTMLVideoElement} */ (document.querySelector('.pswp .g-reel video'))).currentTime);
      await page.keyboard.press('ArrowRight');
      await espera(page, 300);
      const teclado = await page.evaluate(() => ({ legenda: (document.querySelector('.pswp__g-legenda') || document.body).textContent, now: (document.querySelector('.pswp .g-vid-barra') || { getAttribute: () => '' }).getAttribute('aria-valuenow') }));
      registra(depoisHome < antes + 0.01 && /passeio/.test(teclado.legenda || ''), `Vídeo ${nome}: Home/setas na barra mexem no vídeo e não trocam de slide`, { antes, depoisHome, teclado });
      // Espaço (foco fora dos controles) pausa.
      await page.locator('.pswp').evaluate(el => /** @type {HTMLElement} */ (el).focus());
      await page.keyboard.press(' ');
      await espera(page, 300);
      const espaco = await page.evaluate(() => (/** @type {HTMLVideoElement} */ (document.querySelector('.pswp .g-reel video'))).paused);
      registra(espaco, `Vídeo ${nome}: a barra de espaço pausa`, espaco);
      await page.keyboard.press(' ');
      await espera(page, 300);
    }

    // Sair do slide pausa o vídeo.
    if (toque) {
      await page.locator('.pswp__button--close').tap();
      await espera(page, 700);
      const fechado = await page.evaluate(() => [...document.querySelectorAll('video')].every(v => v.paused));
      registra(fechado, `Vídeo ${nome}: fechar o visualizador para o vídeo`, fechado);
    } else {
      await page.locator('.pswp__button--arrow--next').click();
      await espera(page, 700);
      const fora = await page.evaluate(() => [...document.querySelectorAll('.pswp video')].every(v => v.paused));
      registra(fora, `Vídeo ${nome}: trocar de slide pausa o vídeo`, fora);
      await page.locator('.pswp__button--arrow--prev').click();
      await page.waitForFunction(() => { const v = /** @type {HTMLVideoElement|null} */ (document.querySelector('.pswp .g-reel video')); return !!v && !v.paused; }, null, { timeout: 4000 }).catch(() => {});
      const denovo = await page.evaluate(() => { const v = /** @type {HTMLVideoElement|null} */ (document.querySelector('.pswp .g-reel video')); return !!v && !v.paused && !v.muted; });
      registra(denovo, `Vídeo ${nome}: voltar ao slide retoma o vídeo, com o som que a pessoa escolheu`, denovo);
      await page.locator('.pswp__button--close').click();
      await espera(page, 600);
    }
    registra(estado.erros.length === 0 && estado.csp.length === 0, `Vídeo ${nome}: sem erro de JS nem violação de CSP`, [...estado.erros, ...estado.csp]);
    await ctx.close();
  });
}
await cenario('Vídeo: a rota falha e o slide cai no player do Drive', async () => {
  const { ctx, page, estado } = await abre({ pagina: PAGINA_MIDIA, driveFrame: true, videoFalha: true });
  await page.locator('.g-t').nth(1).click();
  await page.waitForSelector('.pswp--open', { timeout: 5000 });
  await page.waitForSelector('.pswp .g-vid-play', { timeout: 5000 }).catch(() => {});
  const fachada = await page.evaluate(() => {
    const b = document.querySelector('.pswp .g-vid-play');
    const r = b ? b.getBoundingClientRect() : null;
    return { botao: !!b, rotulo: b ? b.getAttribute('aria-label') : '', alvo: r ? Math.round(Math.min(r.width, r.height)) : 0, videos: document.querySelectorAll('.pswp video').length, iframes: document.querySelectorAll('iframe').length };
  });
  registra(fachada.botao && /^Tocar o vídeo passeio/.test(fachada.rotulo || '') && fachada.alvo >= 44 && fachada.videos === 0 && fachada.iframes === 0 && estado.drive.length === 0,
    'Vídeo com falha: a fachada (miniatura + play de 44 px) entra no lugar, ainda sem nada do Google', { fachada, drive: estado.drive });
  await page.locator('.g-vid-play').first().click();
  await espera(page, 900);
  const tocando = await page.evaluate(() => { const f = document.querySelector('.pswp iframe'); return f ? { src: f.getAttribute('src'), allow: f.getAttribute('allow') } : null; });
  registra(!!tocando && tocando.src === 'https://drive.google.com/file/d/MIDIAVIDEO_00001/preview' && tocando.allow === 'fullscreen' && estado.drive.includes('/file/d/MIDIAVIDEO_00001/preview'),
    'Vídeo com falha: o toque no play põe o player do Drive', { tocando, drive: estado.drive });
  await page.locator('.pswp__button--arrow--prev').click();
  await espera(page, 700);
  await page.locator('.pswp__button--arrow--next').click();
  await espera(page, 700);
  const volta = await page.evaluate(() => ({ iframes: document.querySelectorAll('.pswp iframe').length, botao: !!document.querySelector('.pswp .g-vid-play') }));
  registra(volta.iframes === 0 && volta.botao, 'Vídeo com falha: sair do slide e voltar traz a fachada (o iframe saiu)', volta);
  registra(estado.erros.length === 0 && estado.csp.length === 0, 'Vídeo com falha: sem erro de JS nem violação de CSP', [...estado.erros, ...estado.csp]);
  await ctx.close();
});
await cenario('Vídeo: sem a liberação na CSP nada de vídeo sai', async () => {
  // Prova de que media-src/frame-src das páginas com vídeo são o que faz os
  // players funcionarem: sem elas, o <video> e o frame do Drive são barrados.
  const { ctx, page, estado } = await abre({ pagina: PAGINA_MIDIA, driveFrame: false });
  await page.locator('.g-t').nth(1).click();
  await page.waitForSelector('.pswp--open', { timeout: 5000 });
  await page.waitForSelector('.pswp .g-vid-play', { timeout: 5000 }).catch(() => {});
  await page.locator('.g-vid-play').first().click().catch(() => {});
  await espera(page, 800);
  registra(estado.csp.some(x => /media/i.test(x)) && estado.csp.some(x => /frame/i.test(x)) && estado.drive.length === 0 && estado.video.length === 0,
    'Vídeo: sem a liberação na CSP o <video> e o frame do Drive são barrados (nenhum pedido sai)', { csp: estado.csp, drive: estado.drive, video: estado.video });
  await ctx.close();
});

// ---- 6h. Fotos novas desde a última visita (item j, #250) -------------------
// A última visita vive só no localStorage. Com visita anterior há duas horas:
// as fotos que chegaram depois ganham a marca "nova" (e o rótulo diz), o chip
// "Só as novas" filtra a grade, e recarregar a página não apaga as marcas.
// Sem visita anterior nada é marcado, e a página grava a visita de agora.
{
  const cr = (/** @type {number} */ atrasoMs) => Math.floor((Date.now() - atrasoMs - EPOCA_CRIADA_MS) / 60_000);
  const HORA = 3_600_000;
  const NOVAS_FOTOS = /** @type {import('../src/drive.js').FotoDrive[]} */ ([
    ['NOVASFOTO_000001', 4000, 3000, 'chegou-agora.jpg', 3_000_000, 0, 0, null, cr(HORA)],
    ['NOVASFOTO_000002', 4000, 3000, 'chegou-ontem.jpg', 3_000_000, 0, 0, null, cr(3 * HORA)],
    ['NOVASFOTO_000003', 4000, 3000, 'sem-data.jpg', 3_000_000],
    ['NOVASVIDEO_00001', 1920, 1080, 'filme.mp4', 9_000_000, 0, 0, 20, cr(HORA / 2)],
  ]);
  for (const f of NOVAS_FOTOS) POR_ID.set(f[0], /** @type {any} */ (f));
  const PAGINA_NOVAS = await paginaAssinada({
    event: EVENTO, nonce: NONCE, erro: null,
    listagem: { v: /** @type {3} */ (3), pasta: 'RAIZ_PASTA_0001', em: '2026-10-10T12:00:00.000Z', truncada: false, total: 4, videos: 1, outros: 0, rk: {}, secoes: [{ nome: '', caminho: '', fotos: NOVAS_FOTOS }] },
  });
  const CHAVE = 'gal-visita:formatura:';
  const leTela = (/** @type {import('playwright-core').Page} */ page) => page.evaluate(() => ({
    marcadas: [...document.querySelectorAll('.g-t.nova')].map(a => a.getAttribute('data-i')),
    selos: document.querySelectorAll('.g-t .g-nova').length,
    rotulos: [...document.querySelectorAll('.g-t')].map(a => a.getAttribute('aria-label') || ''),
    chip: (() => { const b = document.querySelector('[data-acao="filtro-novas"]'); return b ? (b.textContent || '').trim() : null; })(),
    visiveis: [...document.querySelectorAll('.g-t')].filter(a => /** @type {HTMLElement} */ (a).offsetParent !== null && !/** @type {HTMLElement} */ (a).hidden).length,
    visita: localStorage.getItem('gal-visita:formatura:'),
    lateral: document.scrollingElement.scrollWidth > window.innerWidth,
  }));
  for (const [nome, viewport, dpr, toque] of /** @type {const} */ ([['desktop', { width: 1440, height: 900 }, 1, false], ['iPhone 390', { width: 390, height: 844 }, 3, true]])) {
    await cenario(`Fotos novas: ${nome}`, async () => {
      const antes = Date.now() - 2 * HORA;
      const { ctx, page, estado } = await abre({ pagina: PAGINA_NOVAS, viewport, dpr, toque, storage: { [CHAVE]: JSON.stringify({ p: 0, u: antes }) } });
      await espera(page, 500);
      const t = await leTela(page);
      registra(t.marcadas.join() === '0,3' && t.selos === 2, `Fotos novas ${nome}: só o que chegou depois da visita anterior ganha a marca (a foto e o vídeo recentes; não a antiga nem a sem data)`, t);
      registra(/, nova$/.test(t.rotulos[0]) && /, nova$/.test(t.rotulos[3]) && !/nova/.test(t.rotulos[1]) && !/nova/.test(t.rotulos[2]), `Fotos novas ${nome}: o rótulo de acessibilidade diz "nova"`, t.rotulos);
      registra(t.chip === 'Só as novas2', `Fotos novas ${nome}: o chip "Só as novas" mostra a contagem`, t.chip);
      const v = JSON.parse(t.visita || 'null');
      registra(!!v && v.p === antes && v.u > antes + HORA, `Fotos novas ${nome}: a página grava a visita de agora e guarda a anterior`, t.visita);
      registra(!t.lateral, `Fotos novas ${nome}: sem rolagem lateral`);

      // O filtro.
      await page.locator('[data-acao="filtro-novas"]').click();
      await espera(page, 700);
      const f = await leTela(page);
      registra(f.visiveis === 2 && /true/.test(await page.locator('[data-acao="filtro-novas"]').getAttribute('aria-pressed') || ''), `Fotos novas ${nome}: "Só as novas" deixa só as duas na grade`, f);
      await page.locator('[data-acao="filtro-novas"]').click();
      await espera(page, 700);
      registra((await leTela(page)).visiveis === 4, `Fotos novas ${nome}: tocar de novo volta todas`);

      // Recarregar dentro da mesma sessão mantém as marcas.
      await page.reload();
      await espera(page, 900);
      const r = await leTela(page);
      registra(r.marcadas.join() === '0,3', `Fotos novas ${nome}: recarregar dentro de 30 minutos não apaga as marcas`, r);
      registra(estado.erros.length === 0 && estado.csp.length === 0, `Fotos novas ${nome}: sem erro de JS nem CSP`, [...estado.erros, ...estado.csp]);
      await ctx.close();
    });
  }
  await cenario('Fotos novas: primeira visita', async () => {
    const { ctx, page, estado } = await abre({ pagina: PAGINA_NOVAS });
    await espera(page, 400);
    const t = await leTela(page);
    const v = JSON.parse(t.visita || 'null');
    registra(t.selos === 0 && t.chip === null && !!v && v.p === 0, 'Fotos novas: sem visita anterior nada é marcado e a visita de agora é gravada', t);
    registra(estado.erros.length === 0 && estado.csp.length === 0, 'Fotos novas: primeira visita sem erro de JS nem CSP', [...estado.erros, ...estado.csp]);
    await ctx.close();
  });
  await cenario('Fotos novas: sem localStorage', async () => {
    const { ctx, page, estado } = await abre({ pagina: PAGINA_NOVAS, semStorage: true });
    await espera(page, 400);
    registra(estado.erros.length === 0 && (await page.locator('.g-t').count()) === 4, 'Fotos novas: com o armazenamento bloqueado a galeria abre normalmente, sem marcas', estado.erros);
    await ctx.close();
  });
}

// ---- 6i. Chips do servidor (4.1.2): a faixa não abre depois ------------------
// A faixa de chips sai pronta do servidor (chipsProntosHTML) e o script monta
// a dele por cima. São duas cópias da mesma regra; aqui o navegador confere
// que dizem a mesma coisa, e que o cabeçalho tem a mesma altura antes e depois
// do script. Antes ele crescia 55 px e a grade pulava (CLS de 0,75 a 0,81).
const LISTAGEM_ANOS = {
  ...LISTAGEM_CAP, total: 18,
  secoes: [
    { nome: 'Dia 1', caminho: '2025 / Dia 1', fotos: comAutor(raiz.slice(0, 6), 0) },
    { nome: 'Dia 2', caminho: '2025 / Dia 2', fotos: comAutor(raiz.slice(6, 12), 0) },
    { nome: '2026', caminho: '2026', fotos: comAutor(festa.slice(0, 6), 6) },
  ],
};
const PAGINA_ANOS = await paginaAssinada({ event: EVENTO, listagem: LISTAGEM_ANOS, erro: null, nonce: NONCE, dono: false, formToken: '' });
for (const [nome, pagina, esperados] of /** @type {const} */ ([
  ['seções', PAGINA, 2],
  ['fotógrafos e seções', PAGINA_CAP, 6],
  ['anos e fotógrafos', PAGINA_ANOS, 7],
])) {
  await cenario(`Chips do servidor: ${nome}`, async () => {
    const celular = { viewport: { width: 390, height: 844 }, dpr: 3, toque: true };
    const doServidor = (pagina.match(/<nav class="g-chips"[^>]*>([\s\S]*?)<\/nav>/) || [])[1] || '';
    const mede = (/** @type {string} */ html) => {
      const nav = /** @type {HTMLElement} */ (document.getElementById('g-chips'));
      const t = document.createElement('template');
      t.innerHTML = html;
      return {
        topo: /** @type {HTMLElement} */ (document.querySelector('.g-top')).offsetHeight,
        visivel: !nav.hidden && nav.offsetHeight > 0,
        n: nav.querySelectorAll('.g-chip').length,
        igual: t.innerHTML === nav.innerHTML,
        html: nav.innerHTML,
      };
    };
    const a = await abre({ ...celular, pagina, semScript: true });
    const antes = await a.page.evaluate(mede, doServidor);
    await a.ctx.close();
    const d = await abre({ ...celular, pagina });
    const depois = await d.page.evaluate(mede, doServidor);
    registra(antes.visivel && antes.n === esperados, `Chips do servidor (${nome}): a faixa já está aberta antes do script, com ${esperados} chips`, { visivel: antes.visivel, n: antes.n });
    registra(depois.igual, `Chips do servidor (${nome}): o script monta exatamente os mesmos chips`, depois.igual ? '' : { servidor: doServidor, script: depois.html });
    registra(antes.topo === depois.topo && antes.topo > 0, `Chips do servidor (${nome}): o cabeçalho tem a mesma altura antes e depois do script`, { antes: antes.topo, depois: depois.topo });
    registra(d.estado.erros.length === 0 && d.estado.csp.length === 0, `Chips do servidor (${nome}): sem erro de JS nem CSP`, [...d.estado.erros, ...d.estado.csp]);
    await d.ctx.close();
  });
}
// Sem seções nem segundo fotógrafo, o servidor não abre a faixa (e o script
// também não): a galeria simples não ganha uma faixa vazia.
await cenario('Chips do servidor: galeria simples', async () => {
  const simples = await paginaAssinada({ event: EVENTO, listagem: { ...LISTAGEM, total: raiz.length, secoes: [LISTAGEM.secoes[0]] }, erro: null, nonce: NONCE });
  const { ctx, page } = await abre({ pagina: simples, viewport: { width: 390, height: 844 }, dpr: 3, toque: true });
  const nav = await page.evaluate(() => { const n = /** @type {HTMLElement} */ (document.getElementById('g-chips')); return { hidden: n.hidden, n: n.childElementCount }; });
  registra(/<nav class="g-chips"[^>]* hidden><\/nav>/.test(simples) && nav.hidden && nav.n === 0, 'Chips do servidor (galeria simples): sem faixa no servidor e sem faixa no script', nav);
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
