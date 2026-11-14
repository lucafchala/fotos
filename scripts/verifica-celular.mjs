// Verificação do álbum no celular (v3.7.4). Abre, num Chromium de verdade, a
// página principal do álbum (apresentação, os quatro estilos) e a página de um
// evento com anos, em telas de celular, e confere o que deixa a página ruim no
// dedo:
//  1. nada vaza para os lados (sem rolagem horizontal);
//  2. todo botão e link solto tem pelo menos 44 px de altura (alvo de toque);
//  3. campo de texto com letra de 16 px ou mais (o iPhone dá zoom abaixo disso);
//  4. nenhum texto menor que 11 px;
//  5. as janelas (Mandar suas fotos, busca pelo rosto) cabem na tela.
// Salva as capturas em CAPTURAS (padrão: ./capturas-celular) para olhar.
// A página "em breve" fica de fora de propósito: o dono quer ela como está.
//
// Uso: node scripts/verifica-celular.mjs   (sai com 1 se algo falhar)
/* global document, window, getComputedStyle, NodeFilter */
import { chromium } from 'playwright-core';
import { mkdir } from 'node:fs/promises';
import { galeriaIndiceHTML } from '../src/ui/galeria-indice.js';
import { galeriaHTML } from '../src/ui/galeria.js';
import { GALERIA_ESTILOS } from '../src/config.js';
import { SERVICE_WORKER } from '../src/aviso.js';

const SAIDA = process.env.CAPTURAS || 'capturas-celular';
const TELAS = [
  { nome: 'iPhone SE 320', width: 320, height: 568, dpr: 2 },
  { nome: 'Android 360', width: 360, height: 740, dpr: 3 },
  { nome: 'iPhone 390', width: 390, height: 844, dpr: 3 },
  { nome: 'iPhone Max 430', width: 430, height: 932, dpr: 3 },
  { nome: 'Deitado 844', width: 844, height: 390, dpr: 3 },
];

// O álbum de mentira, com nomes e números parecidos com os de verdade.
const PASTA = 'RAIZ_PASTA_0001';
const NOMES = ['Amarelinhos', 'Cinesanta', 'Fantasia terceirão', 'Festa Junina', 'FNUSC', 'Gala', 'Mostra 2025', 'PiauiFest 2025', 'PiauiFut', 'Shows no recreio', 'Tribos'];
const caps = { v: /** @type {1} */ (1), pasta: PASTA, em: '2026-11-07T12:00:00.000Z', truncada: false,
  caps: NOMES.map((nome, i) => ({ id: `CAPITULO00000${String(i).padStart(2, '0')}`, rk: '', bruto: nome, nome, slug: nome.toLowerCase().normalize('NFD').replace(/[^a-z0-9]+/g, '-') })) };
/** @type {Record<string, any>} */
const resumo = {};
caps.caps.forEach((c, i) => {
  resumo[c.id] = { n: [131, 23, 64, 512, 88, 245, 40, 329, 410, 97, 0][i] || 30, capas: [`FOTO${i}A_000000`, `FOTO${i}B_000000`, `FOTO${i}C_000000`],
    p: [202300 + (i % 4) * 100 + 3 + (i % 9), 202300 + (i % 4) * 100 + 6 + (i % 6)], a: { 'Luca F. Chala': 80 + i, Mag: 20 + i, 'Turma 2026': 5 } };
});
const EVENTO = {
  slug: 'entrenos2026', title: 'Entre Nós', date: '2026-11-06', accessType: 'public', galeriaCapitulos: true,
  driveUrl: `https://drive.google.com/drive/folders/${PASTA}`,
  galeriaCreditos: 'chala = Luca F. Chala\nmag = Mariana Magalhães\n* = Turma 2026\n!turma 2026 (adicione suas fotos aqui) = Turma 2026',
  galeriaAbertura: 'Três anos de Santa Cruz, contados em fotos.\n\nDos Amarelinhos à Gala, tudo o que a turma viveu junta, num lugar só.',
  galeriaRecado: 'Mandou foto? Ela aparece aqui em minutos. Viu uma sua que não quer? Toque nela e peça para tirar.',
  buscaRosto: true, buscaTexto: true,
};

// Um evento com anos (o PiauiFut): 3 seções, fotos deitadas e em pé.
const foto = (/** @type {string} */ id, /** @type {number} */ i) => [id, i % 3 ? 6000 : 4000, i % 3 ? 4000 : 6000, `PiauiFut-${i}.jpg`, 9_000_000, 0, 20250610140000 + i];
const secao = (/** @type {string} */ ano, /** @type {number} */ n, dia = '') => ({ nome: dia || ano, caminho: dia ? `${ano} / ${dia}` : ano,
  fotos: Array.from({ length: n }, (_, i) => foto(`F${ano}${dia ? dia.replace(/[^0-9]/g, '') : ''}${String(i).padStart(9, '0')}`, i)) });
// Como o PiauiFut de verdade (v3.8.2): 2025 e 2024 têm subpastas "Dia 1" e "Dia 2".
const LISTAGEM = { v: 3, pasta: 'CAP_PIAUIFUT01', em: '2026-11-07T12:00:00.000Z', truncada: false, total: 90, videos: 0, outros: 0, rk: {},
  aut: ['Luca F. Chala', 'Mag'], secoes: [secao('2026', 40), secao('2025', 18, 'Dia 1'), secao('2025', 12, 'Dia 2'), secao('2024', 20, 'Dia 1')] };

const NONCE = 'nonceDoCelular123';
// A transição entre páginas (v3.8.3) é cancelada quando o destino não a tem
// (aqui, a página vazia do teste; no site, a política de privacidade): o
// Chrome avisa como erro, sem efeito na tela.
const TRANSICAO_CANCELADA = /^Transition was aborted because of invalid state/;
const paginas = [
  ...GALERIA_ESTILOS.map(estilo => ({
    nome: `álbum (${estilo})`,
    html: galeriaIndiceHTML({ event: /** @type {any} */ ({ ...EVENTO, galeriaEstilo: estilo }), caps, resumo, ocultas: [], dono: false, indexavel: false, nonce: NONCE, rosto: { token: 'tok' }, busca: true }),
    janelas: true,
  })),
  {
    nome: 'evento com anos',
    html: galeriaHTML({ event: /** @type {any} */ (EVENTO), listagem: /** @type {any} */ (LISTAGEM), listagemBruta: /** @type {any} */ (LISTAGEM), erro: null, nonce: NONCE, dono: false,
      capituloNome: 'PiauiFut', capitulo: { slug: 'piauifut', nome: 'PiauiFut', anterior: { slug: 'piauifest-2025', nome: 'PiauiFest 2025' }, proximo: { slug: 'shows-no-recreio', nome: 'Shows no recreio' },
        // A barra entre eventos (v3.8.2): todos os eventos, com o ano.
        eventos: caps.caps.map(c => ({ slug: c.slug, nome: c.nome, ano: String(Math.floor(resumo[c.id].p[0] / 100)) })) } }),
    janelas: false,
    menuEventos: true,
  },
];

// Uma imagem qualquer no lugar das fotos do Google (a página pede ao lh3).
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAgAAAAGCAIAAABxZ0isAAAAGklEQVR4nGNgYGD4z8DAwMDAxMDAwMDAAAAOMAEJtlsrvQAAAABJRU5ErkJggg==', 'base64');

/** @type {string[]} */
const falhas = [];
let oks = 0;
/** @param {boolean} ok @param {string} o_que @param {any} [detalhe] */
function registra(ok, o_que, detalhe = '') {
  if (ok) { oks++; console.log(`OK    ${o_que}`); return; }
  falhas.push(o_que);
  console.log(`FALHA ${o_que} — ${typeof detalhe === 'string' ? detalhe : JSON.stringify(detalhe)}`);
}

// Medições feitas dentro da página.
function mede() {
  const W = window.innerWidth;
  const vis = (/** @type {Element} */ el) => {
    const r = el.getBoundingClientRect();
    const s = getComputedStyle(el);
    // A armadilha anti-robô (honeypot) fica fora da tela de propósito.
    if (el.closest('[aria-hidden="true"]') || /** @type {HTMLElement} */ (el).tabIndex < 0 || r.right < 0 || r.bottom < -2000) return false;
    return r.width > 0 && r.height > 0 && s.visibility !== 'hidden' && s.display !== 'none' && Number(s.opacity) > 0;
  };
  const nome = (/** @type {Element} */ el) => `${el.tagName.toLowerCase()}${el.id ? '#' + el.id : ''}${el.className && typeof el.className === 'string' ? '.' + el.className.trim().split(/\s+/).slice(0, 2).join('.') : ''} "${(el.textContent || el.getAttribute('aria-label') || '').trim().slice(0, 30)}"`;
  const vaza = [];
  for (const el of document.querySelectorAll('body *')) {
    if (!vis(el)) continue;
    // Dentro de uma faixa que rola de lado de propósito (chips), não conta.
    let p = el.parentElement; let rola = false;
    while (p && p !== document.body) { const o = getComputedStyle(p).overflowX; if (o === 'auto' || o === 'scroll' || o === 'hidden') { rola = true; break; } p = p.parentElement; }
    if (rola) continue;
    const r = el.getBoundingClientRect();
    if (r.right > W + 1 || r.left < -1) vaza.push(nome(el) + ` [${Math.round(r.left)}..${Math.round(r.right)}]`);
  }
  const pequenos = [];
  for (const el of document.querySelectorAll('a[href], button, input:not([type=hidden]), select, summary, [role=button]')) {
    if (!vis(el)) continue;
    // Link no meio de um parágrafo (texto corrido) não é alvo solto.
    if (el.tagName === 'A' && el.closest('p, li') && el.closest('p, li')?.textContent?.trim() !== el.textContent?.trim()) continue;
    const r = el.getBoundingClientRect();
    if (r.height < 43.5) pequenos.push(nome(el) + ` ${Math.round(r.width)}x${Math.round(r.height)}`);
  }
  const zoom = [];
  for (const el of document.querySelectorAll('input:not([type=hidden]):not([type=checkbox]):not([type=radio]), textarea, select')) {
    if (!vis(el)) continue;
    const fs = parseFloat(getComputedStyle(el).fontSize);
    if (fs < 16) zoom.push(nome(el) + ` ${fs}px`);
  }
  const miudo = [];
  const andou = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
  /** @type {Node | null} */ let n;
  while ((n = andou.nextNode())) {
    const t = (n.textContent || '').trim();
    const el = n.parentElement;
    if (!t || !el || !vis(el)) continue;
    const fs = parseFloat(getComputedStyle(el).fontSize);
    if (fs < 11) miudo.push(nome(el) + ` ${fs}px`);
  }
  return { rolaDeLado: document.documentElement.scrollWidth > W + 1, larguraDoc: document.documentElement.scrollWidth, W, vaza: [...new Set(vaza)].slice(0, 12), pequenos: [...new Set(pequenos)].slice(0, 15), zoom, miudo: [...new Set(miudo)].slice(0, 12) };
}

// CHROMIUM_PATH, como nos outros roteiros: onde o Chromium instalado não é o
// da revisão que este playwright-core espera (as sessões na nuvem, por exemplo).
const browser = await chromium.launch(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {});
await mkdir(SAIDA, { recursive: true });
for (const tela of TELAS) {
  for (const p of paginas) {
    const ctx = await browser.newContext({ viewport: { width: tela.width, height: tela.height }, deviceScaleFactor: tela.dpr, isMobile: tela.width < 800, hasTouch: true });
    const page = await ctx.newPage();
    /** @type {string[]} */
    const erros = [];
    page.on('pageerror', e => { const m = String(e.message || e); if (!TRANSICAO_CANCELADA.test(m)) erros.push(m); });
    await page.route('**/*', route => {
      const u = route.request().url();
      if (u === 'https://fotos.test/') return route.fulfill({ status: 200, contentType: 'text/html; charset=utf-8', body: p.html });
      if (u === 'https://fotos.test/sw.js') return route.fulfill({ status: 200, contentType: 'text/javascript', body: SERVICE_WORKER });
      if (/googleusercontent\.com|\/f\/[A-Za-z0-9_-]+\/[0-9]+j?(\?k=[\w.-]+)?$|\.(png|jpe?g|webp|svg)(\?|$)/.test(u)) return route.fulfill({ status: 200, contentType: 'image/png', body: PNG });
      if (/\/api\//.test(u)) return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ pastas: [
        { evento: 'Festa Junina', cap: 'festa-junina', rotulo: '2026', url: 'https://drive.google.com/drive/folders/X1' },
        { evento: 'Festa Junina', cap: 'festa-junina', rotulo: '2025', url: 'https://drive.google.com/drive/folders/X2' },
        { evento: 'Fantasia terceirão', cap: 'fantasia-terceirao', rotulo: '', url: 'https://drive.google.com/drive/folders/X3' },
      ] }) });
      if (/\.(js|css|woff2?)(\?|$)/.test(u)) return route.fulfill({ status: 200, contentType: u.endsWith('.css') ? 'text/css' : 'text/javascript', body: '' });
      return route.fulfill({ status: 204, body: '' });
    });
    await page.goto('https://fotos.test/');
    await page.waitForTimeout(500);
    const rotulo = `${tela.nome} · ${p.nome}`;
    // "Não quero aparecer na busca" à vista na abertura (v3.8.5).
    if (p.janelas) registra(await page.locator('#rs-sair-p:not([hidden]) #rs-sair-abrir').isVisible().catch(() => false), `${rotulo}: "Não quero aparecer na busca pelo rosto" à vista`, '');
    // O botão do aviso de fotos novas (v3.8.4) aparece no álbum.
    if (p.janelas) registra(await page.locator('#av:not([hidden]) #av-btn').isVisible().catch(() => false), `${rotulo}: botão "Avisar quando chegar foto nova" à vista`, '');
    const m = await page.evaluate(mede);
    registra(!m.rolaDeLado && !m.vaza.length, `${rotulo}: nada vaza para os lados`, m.vaza.length ? m.vaza : `${m.larguraDoc} > ${m.W}`);
    registra(!m.pequenos.length, `${rotulo}: botões e links com 44 px de altura`, m.pequenos);
    registra(!m.zoom.length, `${rotulo}: campos com 16 px (sem zoom no iPhone)`, m.zoom);
    registra(!m.miudo.length, `${rotulo}: nenhum texto menor que 11 px`, m.miudo);
    registra(!erros.length, `${rotulo}: sem erro de JS`, erros);
    const arquivo = `${SAIDA}/${tela.width}-${p.nome.replace(/[^a-z0-9]+/gi, '-')}.png`;
    await page.screenshot({ path: arquivo, fullPage: true });

    if (p.janelas) {
      for (const [seletor, nomeJanela, dialogo] of [['[data-acao="mandar-fotos"]', 'Mandar suas fotos', '#al-env'], ['#rs-abrir', 'Achar minhas fotos pelo rosto', 'dialog[open]']]) {
        const botao = page.locator(seletor).first();
        if (!(await botao.count()) || !(await botao.isVisible())) continue;
        await botao.click();
        await page.waitForTimeout(400);
        const d = page.locator(dialogo).first();
        if (!(await d.count())) continue;
        const caixa = await d.boundingBox();
        registra(!!caixa && caixa.x >= -1 && caixa.x + caixa.width <= tela.width + 1 && caixa.height <= tela.height + 1, `${rotulo}: a janela "${nomeJanela}" cabe na tela`, caixa);
        const dentro = await page.evaluate(mede);
        registra(!dentro.zoom.length, `${rotulo}: "${nomeJanela}" sem campo que dá zoom`, dentro.zoom);
        await page.screenshot({ path: `${SAIDA}/${tela.width}-${p.nome.replace(/[^a-z0-9]+/gi, '-')}-${nomeJanela.replace(/[^a-z0-9]+/gi, '-')}.png` });
        await page.keyboard.press('Escape');
        await page.waitForTimeout(200);
      }
    }
    if (p.menuEventos) {
      // Os anos (v3.8.2): um chip por ano, mesmo com "Dia 1" e "Dia 2" dentro.
      const anos = await page.locator('.g-chips-anos [data-acao="filtro-sec"]').allTextContents();
      registra(anos.length === 4 && /^2026/.test(anos[1]) && /^2025\s*30/.test(anos[2]) && /^2024/.test(anos[3]), `${rotulo}: filtro com um chip por ano (subpastas "Dia" juntas)`, anos);

      // A lista de eventos abre inteira na tela, com o atual marcado e visível.
      await page.locator('.g-ev-menu summary').click();
      await page.waitForTimeout(250);
      const lista = await page.locator('.g-ev-lista').boundingBox();
      const atual = await page.locator('.g-ev-lista [aria-current]').boundingBox();
      registra(!!lista && lista.x >= -1 && lista.x + lista.width <= tela.width + 1 && lista.y + lista.height <= tela.height + 1, `${rotulo}: a lista de eventos cabe na tela`, lista);
      registra(!!lista && !!atual && atual.y >= lista.y - 1 && atual.y + atual.height <= lista.y + lista.height + 1, `${rotulo}: o evento atual aparece na lista aberta`, { lista, atual });
      const dentro = await page.evaluate(mede);
      registra(!dentro.pequenos.length, `${rotulo}: itens da lista com 44 px`, dentro.pequenos);
      await page.screenshot({ path: `${SAIDA}/${tela.width}-${p.nome.replace(/[^a-z0-9]+/gi, '-')}-lista-de-eventos.png` });
      await page.keyboard.press('Escape');
      await page.waitForTimeout(150);
      registra(!(await page.locator('.g-ev-menu[open]').count()), `${rotulo}: Esc fecha a lista de eventos`);
    }
    await ctx.close();
  }
}
// ---- A busca pelo rosto e a busca nas fotos no celular (v3.7.5) ----
// O Turnstile trabalha escondido desde a abertura da página: ao abrir a janela
// e marcar o aceite, "Tirar selfie" já vale. O resultado volta quando a pessoa
// abre uma foto e volta, rolado até a foto aberta.
{
  const RES = [{ cap: 'festa-junina', id: 'FOTO_ACHADA_001', sim: 99 }, { cap: 'gala', id: 'FOTO_ACHADA_002', sim: 91 }, { cap: 'gala', id: 'FOTO_ACHADA_003', sim: 82 }, { cap: 'gala', id: 'FOTO_TALVEZ_004', sim: 74 }];
  // Desde a v3.8.8 o servidor manda, com cada achado, o `k` do endereço da foto
  // (o álbum e a assinatura): sem ele a miniatura dá 404 e a lista guardada não vale.
  for (const r of RES) Object.assign(r, { k: `${EVENTO.slug}.AbCdEf12` });
  const html = paginas[0].html;
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
  const page = await ctx.newPage();
  /** @type {string[]} */
  const erros = [];
  page.on('pageerror', e => { const m = String(e.message || e); if (!TRANSICAO_CANCELADA.test(m)) erros.push(m); });
  let tsCarregado = 0;
  let semRosto = false;
  // As fotos do cartão (/800) vêm coloridas: a selfie de teste (v3.9.0).
  /** @type {Buffer | null} */
  let fotoColorida = null;
  await page.route('**/*', route => {
    const u = route.request().url();
    if (fotoColorida && /\/f\/[A-Za-z0-9_-]+\/800(\?|$)/.test(u)) return route.fulfill({ status: 200, contentType: 'image/png', body: fotoColorida });
    if (u.startsWith('https://fotos.test/galeria/')) return route.fulfill({ status: 200, contentType: 'text/html', body: '<!doctype html><title>foto</title><p>foto aberta</p>' });
    if (u === 'https://fotos.test/' || u.startsWith('https://fotos.test/#')) return route.fulfill({ status: 200, contentType: 'text/html; charset=utf-8', body: html });
    if (u.includes('challenges.cloudflare.com/turnstile')) {
      tsCarregado++;
      // Um Turnstile de mentira: dá o token 300 ms depois de renderizar.
      return route.fulfill({ status: 200, contentType: 'text/javascript', body: 'window.turnstile={n:0,render:function(el,o){var id=++this.n;setTimeout(function(){o.callback("tok"+id)},300);this["o"+id]=o;return id},reset:function(id){var o=this["o"+id];if(o)setTimeout(function(){o.callback("tok-novo")},300)}};' });
    }
    if (u.includes('/api/rosto/buscar') && semRosto) return route.fulfill({ status: 422, contentType: 'application/json', body: JSON.stringify({ error: 'Não achei um rosto nessa foto. Tente de frente, com boa luz.' }) });
    if (u.includes('/api/rosto/buscar')) return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true, resultados: RES }) });
    if (u.includes('/api/busca?')) return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ resultados: RES.slice(0, 2) }) });
    if (/googleusercontent\.com|\/f\/[A-Za-z0-9_-]+\/[0-9]+j?(\?k=[\w.-]+)?$|\.(png|jpe?g|webp|svg)(\?|$)/.test(u)) return route.fulfill({ status: 200, contentType: 'image/png', body: PNG });
    return route.fulfill({ status: 204, body: '' });
  });
  await page.goto('https://fotos.test/');
  await page.waitForTimeout(2500);
  registra(tsCarregado === 1, 'Rosto: o Turnstile carrega sozinho ao abrir a página, antes do toque', tsCarregado);
  const b1 = await page.locator('.al-btns .al-btn').first().getAttribute('id');
  registra(b1 === 'rs-abrir', 'Rosto: "Achar minhas fotos pelo rosto" é o primeiro botão', b1);
  const corVer = await page.locator('.al-ver').evaluate(el => getComputedStyle(el).backgroundColor);
  const corRosto = await page.locator('#rs-abrir').evaluate(el => getComputedStyle(el).backgroundColor);
  registra(corVer !== corRosto, 'Rosto: o botão do rosto em destaque, "Ver todas as fotos" secundário', { corRosto, corVer });
  await page.locator('#rs-abrir').click();
  await page.locator('#rs-aceite').check();
  registra(await page.locator('#rs-tirar').isEnabled(), 'Rosto: com o aceite, "Tirar selfie" já está ativo (sem esperar o Turnstile)', await page.locator('#rs-tirar').textContent());
  // A "selfie": uma captura de verdade (um PNG válido que o navegador decodifica).
  const selfie = await page.screenshot({ clip: { x: 0, y: 0, width: 120, height: 120 } });
  fotoColorida = await page.screenshot({ clip: { x: 0, y: 0, width: 390, height: 500 } });
  await page.locator('#rs-arquivo').setInputFiles({ name: 'selfie.png', mimeType: 'image/png', buffer: selfie });
  await page.waitForSelector('#rs-res:not([hidden]) #rs-grade a', { timeout: 8000 }).catch(() => {});
  registra(await page.locator('#rs-grade a').count() === 4 && page.url().endsWith('#minhas-fotos'), 'Rosto: o resultado aparece e o endereço ganha #minhas-fotos', page.url());
  // v3.8.8: a miniatura de cada achado sai com o `k` (sem ele a rota das fotos responde 404).
  const semK = await page.locator('#rs-grade a img').evaluateAll(imgs => imgs.map(i => i.getAttribute('src') || '').filter(u => !/\?k=[\w.-]+$/.test(u)));
  registra(semK.length === 0, 'Rosto: as miniaturas do resultado levam a assinatura (k)', semK.slice(0, 2));
  const clicada = await page.locator('#rs-grade a').nth(1).getAttribute('data-id');
  // v3.8.6: tocar abre a galeria em tela cheia, com TODAS as fotos do resultado.
  await page.locator('#rs-grade a').nth(1).click();
  await page.waitForSelector('dialog.vz[open]', { timeout: 3000 }).catch(() => {});
  registra(await page.locator('dialog.vz[open]').count() === 1 && (await page.locator('.vz-n').textContent()) === '2 de 4', 'Visor: tocar na foto abre em tela cheia, na foto tocada ("2 de 4")', await page.locator('.vz-n').textContent().catch(() => ''));
  const caixaImg = await page.locator('.vz-img').boundingBox();
  registra(!!caixaImg && caixaImg.width >= 380 && caixaImg.height >= 800, 'Visor: a foto ocupa a tela inteira', caixaImg);
  // Deslizar para a esquerda: a próxima.
  const cdp = await ctx.newCDPSession(page);
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: 300, y: 420 }] });
  for (const x of [250, 200, 150, 120]) await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x, y: 425 }] });
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  await page.waitForTimeout(200);
  registra((await page.locator('.vz-n').textContent()) === '3 de 4', 'Visor: deslizar para o lado passa para a próxima', await page.locator('.vz-n').textContent());
  // Zoom (v3.8.7): toque duplo amplia; ampliada, deslizar não troca a foto; toque duplo volta; pinça amplia.
  const toqueEm = async (/** @type {number} */ x, /** @type {number} */ y) => {
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y }] });
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  };
  await toqueEm(200, 420); await page.waitForTimeout(80); await toqueEm(200, 420);
  await page.waitForTimeout(150);
  registra(/scale\(2\.5\)/.test((await page.locator('.vz-img').getAttribute('style')) || ''), 'Visor: toque duplo amplia a foto', await page.locator('.vz-img').getAttribute('style'));
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: 300, y: 420 }] });
  for (const x of [250, 200, 150]) await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x, y: 420 }] });
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  await page.waitForTimeout(150);
  registra((await page.locator('.vz-n').textContent()) === '3 de 4', 'Visor: ampliada, arrastar move a foto (não troca)', await page.locator('.vz-n').textContent());
  await page.waitForTimeout(400);
  await toqueEm(200, 420); await page.waitForTimeout(80); await toqueEm(200, 420);
  await page.waitForTimeout(150);
  registra(!/scale/.test((await page.locator('.vz-img').getAttribute('style')) || ''), 'Visor: toque duplo de novo volta ao tamanho normal', await page.locator('.vz-img').getAttribute('style'));
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: 170, y: 420, id: 1 }, { x: 220, y: 420, id: 2 }] });
  for (const d of [40, 80, 120]) await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: 170 - d, y: 420, id: 1 }, { x: 220 + d, y: 420, id: 2 }] });
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  await page.waitForTimeout(150);
  const escalaPinca = Number((/scale\(([0-9.]+)\)/.exec((await page.locator('.vz-img').getAttribute('style')) || '') || [])[1] || 1);
  registra(escalaPinca > 2, 'Visor: pinça com dois dedos amplia', escalaPinca);
  await page.waitForTimeout(400);
  await toqueEm(200, 420); await page.waitForTimeout(80); await toqueEm(200, 420);
  await page.waitForTimeout(150);
  registra(/\/galeria\/entrenos2026\/[a-z-]+\/baixar\/FOTO_/.test((await page.locator('.vz-baixar').getAttribute('href')) || ''), 'Visor: "Baixar" leva ao original daquela foto', await page.locator('.vz-baixar').getAttribute('href'));
  // Voltar (botão do celular) fecha o visor e fica no resultado.
  await page.goBack();
  await page.waitForTimeout(300);
  registra(await page.locator('dialog.vz[open]').count() === 0 && page.url().endsWith('#minhas-fotos'), 'Visor: voltar fecha a foto e fica no resultado', page.url());
  // "Ver no evento" ainda leva à página do evento, e voltar traz o resultado.
  await page.locator('#rs-grade a').nth(1).click();
  await page.waitForSelector('dialog.vz[open]', { timeout: 3000 }).catch(() => {});
  await page.locator('.vz-base [data-vz="ver"]').click();
  await page.waitForURL(/\/galeria\//);
  await page.goBack();
  await page.waitForSelector('#rs-res:not([hidden]) #rs-grade a', { timeout: 5000 }).catch(() => {});
  registra(await page.locator('#rs-grade a').count() === 4, 'Rosto: voltar da foto traz o resultado de volta', await page.locator('#rs-grade a').count());
  registra(await page.locator('#rs-grade a.rs-ultima').getAttribute('data-id').catch(() => null) === clicada, 'Rosto: a foto que foi aberta fica marcada e à vista', clicada);
  registra(await page.locator('#rs-grade > .rs-ev h3').count() === 2, 'Rosto: o resultado vem separado por evento', await page.locator('#rs-grade > .rs-ev h3').allTextContents());
  registra((await page.locator('#rs-grade .rs-talvez > h3').textContent().catch(() => '')) === 'Talvez seja você (1)' && await page.locator('#rs-grade .rs-talvez a[data-id="FOTO_TALVEZ_004"]').count() === 1, 'Rosto: a menos parecida vai para "Talvez seja você", no fim', '');
  // Cartão "minhas fotos" (v3.9.0): montado no aparelho, num canvas.
  registra(await page.locator('#rs-cartao-abrir').isVisible(), 'Cartão: o botão aparece com o resultado', '');
  await page.locator('#rs-cartao-abrir').click();
  await page.waitForSelector('#rs-cartao[open]', { timeout: 8000 }).catch(() => {});
  const cartao = await page.evaluate(() => {
    const cv = /** @type {HTMLCanvasElement} */ (document.getElementById('rs-cartao-cv'));
    const d = cv.getContext('2d').getImageData(0, 0, cv.width, cv.height).data;
    const cores = new Set();
    for (let i = 0; i < d.length; i += 4 * 997) cores.add(d[i] + ',' + d[i + 1] + ',' + d[i + 2]);
    return { aberto: /** @type {HTMLDialogElement} */ (document.getElementById('rs-cartao')).open, w: cv.width, h: cv.height, cores: cores.size };
  });
  registra(cartao.aberto && cartao.w === 1080 && cartao.h === 1920 && cartao.cores > 8, 'Cartão: abre com a imagem 1080×1920 desenhada (fotos e texto)', cartao);
  if (process.env.CARTAO_PNG) {
    const png = await page.evaluate(() => /** @type {HTMLCanvasElement} */ (document.getElementById('rs-cartao-cv')).toDataURL('image/png'));
    (await import('node:fs')).writeFileSync(process.env.CARTAO_PNG, Buffer.from(png.split(',')[1], 'base64'));
  }
  await page.locator('#rs-cartao-fechar').click();
  registra(!(await page.locator('#rs-cartao[open]').count()), 'Cartão: Fechar fecha', '');
  // Busca nas fotos: o mesmo.
  // v3.8.7: as sugestões saíram da abertura; a pessoa digita.
  await page.locator('#bf-q').fill('bolo');
  await page.locator('#bf-q').press('Enter');
  await page.waitForSelector('#bf-res:not([hidden]) #bf-grade a');
  registra(decodeURIComponent(page.url()).endsWith('#busca=bolo'), 'Busca: o endereço guarda o termo', page.url());
  await page.locator('#bf-grade a').first().click();
  await page.waitForSelector('dialog.vz[open]', { timeout: 3000 }).catch(() => {});
  registra((await page.locator('.vz-n').textContent().catch(() => '')) === '1 de 2', 'Visor: a busca por palavra também abre em tela cheia', await page.locator('.vz-n').textContent().catch(() => ''));
  await page.locator('.vz-base [data-vz="ver"]').click();
  await page.waitForURL(/\/galeria\//);
  await page.goBack();
  await page.waitForSelector('#bf-res:not([hidden]) #bf-grade a', { timeout: 5000 }).catch(() => {});
  registra(await page.locator('#bf-grade a').count() === 2 && (await page.locator('#bf-q').inputValue()) === 'bolo', 'Busca: voltar da foto traz o resultado e o termo de volta', '');
  // Selfie sem rosto: a mensagem fica na janela (antes sumia na hora).
  semRosto = true;
  await page.locator('#rs-abrir').click();
  await page.locator('#rs-aceite').check();
  await page.waitForFunction(() => !(/** @type {any} */ (document.getElementById("rs-tirar"))).disabled, null, { timeout: 5000 }).catch(() => {});
  await page.locator('#rs-arquivo').setInputFiles({ name: 'selfie.png', mimeType: 'image/png', buffer: selfie });
  await page.waitForTimeout(1200);
  const aviso = (await page.locator('#rs-erro').textContent()) || '';
  registra(/Não achei um rosto/.test(aviso), 'Rosto: a mensagem de erro fica na tela', aviso);
  // O "Não quero aparecer" da abertura abre a janela já no modo de sair.
  await page.keyboard.press('Escape');
  await page.locator('#rs-sair-abrir').click();
  registra((await page.locator('#rs-t').textContent()) === 'Sair da busca pelo rosto' && await page.locator('#rs-txt-sair').isVisible(), 'Rosto: "Não quero aparecer" abre a janela no modo de sair', await page.locator('#rs-t').textContent());
  await page.keyboard.press('Escape');
  registra(!erros.length, 'Buscas: sem erro de JS', erros);
  await page.screenshot({ path: `${SAIDA}/390-busca-rosto-de-volta.png` });
  await ctx.close();
}

// ---- "Minhas fotos" que se atualiza sozinho (v3.8.3) ----
// A busca salva é de antes das fotos novas (idx mais novo): "Ver minhas fotos"
// mostra a lista salva na hora e depois junta as novas, marcadas.
{
  const html = galeriaIndiceHTML({ event: /** @type {any} */ (EVENTO), caps, resumo, ocultas: [], dono: false, indexavel: false, nonce: NONCE, rosto: { token: 'tok', idx: Date.now() }, busca: true });
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
  const page = await ctx.newPage();
  /** @type {string[]} */
  const erros = [];
  page.on('pageerror', e => { const m = String(e.message || e); if (!TRANSICAO_CANCELADA.test(m)) erros.push(m); });
  const salva = { em: Date.now() - 86400000, j: { resultados: [{ cap: 'gala', id: 'FOTO_ACHADA_002', sim: 91 }], semIndice: false, faces: ['11111111-2222-3333-4444-555555555555'] } };
  for (const r of salva.j.resultados) Object.assign(r, { k: `${EVENTO.slug}.AbCdEf12` });
  await page.addInitScript(v => { try { globalThis.localStorage.setItem('rs-res:entrenos2026', v); } catch { /* sem armazenamento */ } }, JSON.stringify(salva));
  /** @type {any} */
  let pedido = null;
  await page.route('**/*', route => {
    const u = route.request().url();
    if (u === 'https://fotos.test/') return route.fulfill({ status: 200, contentType: 'text/html; charset=utf-8', body: html });
    if (u.startsWith('https://challenges.cloudflare.com/')) return route.fulfill({ status: 200, contentType: 'text/javascript', body: 'window.turnstile={n:0,render:function(el,o){var id=++this.n;setTimeout(function(){o.callback("tok"+id)},300);this["o"+id]=o;return id},reset:function(id){}};' });
    if (u.includes('/api/rosto/atualizar')) { pedido = JSON.parse(route.request().postData() || '{}'); return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true, resultados: [{ cap: 'gala', id: 'FOTO_ACHADA_002', sim: 92 }, { cap: 'festa-junina', id: 'FOTO_NOVA_00005', sim: 88 }] }) }); }
    if (/\/f\/[A-Za-z0-9_-]+\/[0-9]+j?(\?k=[\w.-]+)?$|\.(png|jpe?g|webp|svg)(\?|$)/.test(u)) return route.fulfill({ status: 200, contentType: 'image/png', body: PNG });
    return route.fulfill({ status: 204, body: '' });
  });
  await page.goto('https://fotos.test/');
  await page.waitForTimeout(1500);
  registra(await page.locator('#rs-minhas').count() === 1, 'Minhas fotos: o botão "Ver minhas fotos" aparece com a busca salva', '');
  await page.locator('#rs-minhas').click();
  await page.waitForSelector('#rs-grade a.rs-nova', { timeout: 6000 }).catch(() => {});
  registra(await page.locator('#rs-grade a').count() === 2 && await page.locator('#rs-grade a.rs-nova[data-id="FOTO_NOVA_00005"]').count() === 1, 'Minhas fotos: a foto nova entra, marcada como nova', await page.locator('#rs-grade a').count());
  registra(!!pedido && Array.isArray(pedido.faces) && pedido.faces.length === 1 && !('imagem' in pedido), 'Minhas fotos: atualiza só com os rostos guardados, sem selfie', pedido);
  registra(/1 foto nova sua/.test((await page.locator('#rs-res-sub').textContent()) || ''), 'Minhas fotos: diz quantas fotos novas', await page.locator('#rs-res-sub').textContent());
  registra(!erros.length, 'Minhas fotos: sem erro de JS', erros);
  await ctx.close();
}

// ---- Navegador embutido de app (v3.11.0, src/ui/navegador-embutido.js) ----
// Quem abre o link pelo Instagram cai no navegador de dentro do app, onde
// baixar e os avisos falham calados. A faixa só aparece quando a pessoa tenta
// baixar, cabe na tela e tem alvos de 44 px; no Android, "Abrir no Chrome".
{
  const evento = /** @type {string} */ (paginas[paginas.length - 1].html);
  const UAS = {
    'Instagram (iPhone)': 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 Instagram 330.0.0.0 (iPhone14,5; iOS 17_5; pt_BR)',
    'Instagram (Android)': 'Mozilla/5.0 (Linux; Android 14; SM-S911B; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/124.0 Mobile Safari/537.36 Instagram 330.0.0.0 Android',
    'Safari (iPhone)': 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1',
  };
  for (const [nomeUa, userAgent] of Object.entries(UAS)) {
    const ctx = await browser.newContext({ viewport: { width: 360, height: 740 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, userAgent });
    const page = await ctx.newPage();
    const erros = /** @type {string[]} */ ([]);
    page.on('pageerror', e => erros.push(String(e).slice(0, 160)));
    await page.route('**/*', route => {
      const u = route.request().url();
      if (u === 'https://fotos.test/') return route.fulfill({ status: 200, contentType: 'text/html; charset=utf-8', body: evento });
      if (/\.(png|jpe?g|webp|svg)(\?|$)|\/f\//.test(u)) return route.fulfill({ status: 200, contentType: 'image/png', body: PNG });
      return route.fulfill({ status: 204, body: '' });
    });
    await page.goto('https://fotos.test/');
    await page.waitForTimeout(600);
    const rotulo = `Navegador embutido, ${nomeUa}`;
    const antes = await page.locator('#nav-emb').isVisible();
    await page.locator('[data-acao="baixar-tudo"]').tap();
    await page.waitForTimeout(300);
    const depois = await page.locator('#nav-emb').isVisible();
    if (nomeUa.startsWith('Safari')) {
      registra(!antes && !depois, `${rotulo}: no navegador de verdade, a faixa nunca aparece`, { antes, depois });
    } else {
      registra(!antes && depois, `${rotulo}: nada na entrada; ao tocar em "Baixar tudo", a faixa aparece`, { antes, depois });
      const texto = (await page.locator('#nav-emb-txt').textContent()) || '';
      registra(/navegador do Instagram/.test(texto), `${rotulo}: a faixa diz em que navegador a pessoa está`, texto);
      const caixa = await page.locator('#nav-emb').boundingBox();
      registra(!!caixa && caixa.x >= -1 && caixa.x + caixa.width <= 361 && caixa.y + caixa.height <= 741, `${rotulo}: a faixa cabe na tela`, caixa);
      const m = await page.evaluate(mede);
      registra(!m.pequenos.length && !m.rolaDeLado, `${rotulo}: botões da faixa com 44 px, nada vaza`, { pequenos: m.pequenos, vaza: m.vaza });
      const abrir = page.locator('#nav-emb-abrir');
      if (nomeUa.includes('Android')) {
        registra(await abrir.isVisible() && /^intent:\/\/fotos\.test\/#Intent;scheme=https;package=com\.android\.chrome;S\.browser_fallback_url=https%3A%2F%2Ffotos\.test%2F;end$/.test((await abrir.getAttribute('href')) || ''), `${rotulo}: "Abrir no Chrome" com o endereço da página (e a volta, sem Chrome)`, await abrir.getAttribute('href'));
      } else {
        registra(!(await abrir.isVisible()) && /Abrir no navegador/.test(texto), `${rotulo}: no iPhone, o caminho pelo menu (sem link que não funcionaria)`, texto);
      }
      await page.screenshot({ path: `${SAIDA}/navegador-embutido-${nomeUa.includes('Android') ? 'android' : 'iphone'}.png` });
      await page.locator('#nav-emb-fechar').tap();
      registra(!(await page.locator('#nav-emb').isVisible()), `${rotulo}: "Fechar" esconde a faixa`, '');
    }
    registra(!erros.length, `${rotulo}: sem erro de JS`, erros);
    await ctx.close();
  }
}

// ---- Aviso de foto nova sem push (v3.11.0, revisão final) ----
// O navegador de dentro do app NÃO tem PushManager/Notification; o Chromium
// do roteiro tem. Trocar só o user agent mostrava o botão de avisos como num
// navegador normal — foi assim que o #av-btn "inexistente no app" passou.
// Aqui as duas APIs saem antes de a página carregar, e o que se confere é o
// que a pessoa lê no álbum de verdade (não um DOM de mentira).
{
  const album = /** @type {string} */ (paginas[0].html);
  const CASOS = {
    'Instagram (iPhone)': ['Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 Instagram 330.0.0.0 (iPhone14,5; iOS 17_5; pt_BR)', /Abra o álbum no navegador/],
    'Instagram (Android)': ['Mozilla/5.0 (Linux; Android 14; SM-S911B; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/124.0 Mobile Safari/537.36 Instagram 330.0.0.0 Android', /Abra o álbum no navegador/],
    'Safari (iPhone), fora da Tela de Início': ['Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1', /Adicionar à Tela de Início/],
  };
  for (const [nomeUa, [userAgent, espera]] of Object.entries(CASOS)) {
    const ctx = await browser.newContext({ viewport: { width: 360, height: 740 }, deviceScaleFactor: 1, isMobile: true, hasTouch: true, userAgent });
    await ctx.addInitScript(() => { const w = /** @type {any} */ (globalThis); delete w.PushManager; delete w.Notification; });
    const page = await ctx.newPage();
    const erros = /** @type {string[]} */ ([]);
    page.on('pageerror', e => erros.push(String(e).slice(0, 160)));
    await page.route('**/*', route => {
      const u = route.request().url();
      if (u === 'https://fotos.test/') return route.fulfill({ status: 200, contentType: 'text/html; charset=utf-8', body: album });
      if (/\.(png|jpe?g|webp|svg)(\?|$)|\/f\//.test(u)) return route.fulfill({ status: 200, contentType: 'image/png', body: PNG });
      return route.fulfill({ status: 204, body: '' });
    });
    await page.goto('https://fotos.test/');
    await page.waitForTimeout(400);
    const rotulo = `Aviso sem push, ${nomeUa}`;
    const semApi = await page.evaluate(() => !('PushManager' in globalThis) && !('Notification' in globalThis));
    registra(semApi, `${rotulo}: o roteiro tirou PushManager e Notification`, '');
    const btn = await page.locator('#av-btn').isVisible();
    const frase = await page.locator('#av-msg').isVisible();
    const texto = (await page.locator('#av-msg').textContent().catch(() => '')) || '';
    registra(!btn && frase && espera.test(texto), `${rotulo}: sem botão de avisos (que nada faria); a frase certa à vista`, { btn, frase, texto });
    if (nomeUa.startsWith('Instagram (Android)')) await page.locator('#av-msg').screenshot({ path: `${SAIDA}/aviso-sem-push-android.png` });
    registra(!erros.length, `${rotulo}: sem erro de JS`, erros);
    await ctx.close();
  }
}

await browser.close();
console.log(`${oks} ok, ${falhas.length} falha(s)`);
process.exit(falhas.length ? 1 : 0);
