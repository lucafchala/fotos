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

const browser = await chromium.launch();
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
      if (/googleusercontent\.com|\/f\/[A-Za-z0-9_-]+\/[0-9]+j?$|\.(png|jpe?g|webp|svg)(\?|$)/.test(u)) return route.fulfill({ status: 200, contentType: 'image/png', body: PNG });
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
  const html = paginas[0].html;
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
  const page = await ctx.newPage();
  /** @type {string[]} */
  const erros = [];
  page.on('pageerror', e => { const m = String(e.message || e); if (!TRANSICAO_CANCELADA.test(m)) erros.push(m); });
  let tsCarregado = 0;
  let semRosto = false;
  await page.route('**/*', route => {
    const u = route.request().url();
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
    if (/googleusercontent\.com|\/f\/[A-Za-z0-9_-]+\/[0-9]+j?$|\.(png|jpe?g|webp|svg)(\?|$)/.test(u)) return route.fulfill({ status: 200, contentType: 'image/png', body: PNG });
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
  await page.locator('#rs-arquivo').setInputFiles({ name: 'selfie.png', mimeType: 'image/png', buffer: selfie });
  await page.waitForSelector('#rs-res:not([hidden]) #rs-grade a', { timeout: 8000 }).catch(() => {});
  registra(await page.locator('#rs-grade a').count() === 4 && page.url().endsWith('#minhas-fotos'), 'Rosto: o resultado aparece e o endereço ganha #minhas-fotos', page.url());
  const clicada = await page.locator('#rs-grade a').nth(1).getAttribute('data-id');
  await page.locator('#rs-grade a').nth(1).click();
  await page.waitForURL(/\/galeria\//);
  await page.goBack();
  await page.waitForSelector('#rs-res:not([hidden]) #rs-grade a', { timeout: 5000 }).catch(() => {});
  registra(await page.locator('#rs-grade a').count() === 4, 'Rosto: voltar da foto traz o resultado de volta', await page.locator('#rs-grade a').count());
  registra(await page.locator('#rs-grade a.rs-ultima').getAttribute('data-id').catch(() => null) === clicada, 'Rosto: a foto que foi aberta fica marcada e à vista', clicada);
  registra(await page.locator('#rs-grade > .rs-ev h3').count() === 2, 'Rosto: o resultado vem separado por evento', await page.locator('#rs-grade > .rs-ev h3').allTextContents());
  registra((await page.locator('#rs-grade .rs-talvez > h3').textContent().catch(() => '')) === 'Talvez seja você (1)' && await page.locator('#rs-grade .rs-talvez a[data-id="FOTO_TALVEZ_004"]').count() === 1, 'Rosto: a menos parecida vai para "Talvez seja você", no fim', '');
  // Busca nas fotos: o mesmo.
  await page.locator('[data-bf="bolo"]').click();
  await page.waitForSelector('#bf-res:not([hidden]) #bf-grade a');
  registra(decodeURIComponent(page.url()).endsWith('#busca=bolo'), 'Busca: o endereço guarda o termo', page.url());
  await page.locator('#bf-grade a').first().click();
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
  await page.addInitScript(v => { try { localStorage.setItem('rs-res:entrenos2026', v); } catch (e) { /* */ } }, JSON.stringify(salva));
  /** @type {any} */
  let pedido = null;
  await page.route('**/*', route => {
    const u = route.request().url();
    if (u === 'https://fotos.test/') return route.fulfill({ status: 200, contentType: 'text/html; charset=utf-8', body: html });
    if (u.startsWith('https://challenges.cloudflare.com/')) return route.fulfill({ status: 200, contentType: 'text/javascript', body: 'window.turnstile={n:0,render:function(el,o){var id=++this.n;setTimeout(function(){o.callback("tok"+id)},300);this["o"+id]=o;return id},reset:function(id){}};' });
    if (u.includes('/api/rosto/atualizar')) { pedido = JSON.parse(route.request().postData() || '{}'); return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true, resultados: [{ cap: 'gala', id: 'FOTO_ACHADA_002', sim: 92 }, { cap: 'festa-junina', id: 'FOTO_NOVA_00005', sim: 88 }] }) }); }
    if (/\/f\/[A-Za-z0-9_-]+\/[0-9]+j?$|\.(png|jpe?g|webp|svg)(\?|$)/.test(u)) return route.fulfill({ status: 200, contentType: 'image/png', body: PNG });
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

await browser.close();
console.log(`${oks} ok, ${falhas.length} falha(s)`);
process.exit(falhas.length ? 1 : 0);
