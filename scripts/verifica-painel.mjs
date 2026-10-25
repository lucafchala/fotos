// Roteiro do PAINEL (/dashboard) num Chromium de verdade, logado, contra o
// Worker de verdade.
//
//   npm run verifica:painel
//   VERIFICA_PRINTS=/caminho npm run verifica:painel   # salva capturas de tela
//
// Não precisa do `wrangler dev`: sobe o `src/index.js` num servidor HTTP local
// (scripts/worker-local.mjs) com KV e Durable Objects em memória, semeados
// com eventos, categorias e pedidos de remoção. Turnstile e Resend são
// interceptados — nada sai da máquina.
//
// O roteiro é o "pronto quando" do #220, feito como o dono faria, em cada
// aparelho (iPhone, Android, computador):
//   entrar → criar um evento → editar e marcar entregue → ocultar pelo menu
//   "Mais ações" → resolver um pedido de remoção → trocar a senha (e entrar de
//   novo com ela) → "Sair dos outros aparelhos" (um segundo navegador logado
//   cai no login; este fica) → baixar o backup (no computador; a linha "Último
//   backup" passa a dizer hoje) → a sessão cair no meio de uma edição (e o
//   rascunho voltar) → excluir o evento de teste → o backup, com a sessão
//   caída, leva ao login.
// E, no caminho, o que só um navegador mostra: a navegação no lugar certo
// (barra de baixo no celular, lateral no computador), nada vazando para o
// lado, alvos de toque de 44 px, campo que não dá zoom no iPhone, menu com
// teclado, nenhum erro de JS, nenhuma mensagem de CSP no console (a política
// estrita é a aplicada, #126: scripts/vigia-csp.mjs), e quais chaves do KV o
// fluxo gravou (a cota é de 1000 escritas/dia — TODO.md).
//
// Uma falha não esconde as outras: cada cenário roda dentro de `cenario()`,
// que registra a exceção e segue (a mesma lição do smoke.sh).
//
// Precisa do gancho de `cloudflare:workers` (o script do package.json já
// passa): node --import ./scripts/node-com-workers.mjs scripts/verifica-painel.mjs

/* global document, window, getComputedStyle */
import { existsSync, readdirSync, mkdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { chromium } from 'playwright-core';
import { sobeWorker, entraNoPainel, SENHA_DE_TESTE } from './worker-local.mjs';
import { vigiaCsp, provaOVigia } from './vigia-csp.mjs';
import { metricasDeExemplo } from '../src/previa.js';
import { hojeEmSaoPaulo } from '../src/utils.js';

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

/**
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

// ---- A semente: um painel com cara de uso real -----------------------------
const lh = (/** @type {string} */ id) => `https://lh3.googleusercontent.com/d/${id}`;
/** @param {number} i @param {Record<string, any>} o */
const ev = (i, o) => ({
  id: 'ev' + i, slug: o.slug, title: o.title, status: o.status || 'entregue',
  driveUrl: `https://drive.google.com/drive/folders/PASTA_${String(i).padStart(10, '0')}`,
  driveUrlInstagram: '', projectUrl: '', photos: [lh(`FOTO_${i}_AAAAAAAAAA`)], thumbnailUrl: lh(`FOTO_${i}_AAAAAAAAAA`),
  visible: o.visible !== false, comingSoon: !!o.comingSoon, pinned: !!o.pinned, accessType: o.access || 'public',
  category: o.cat || 'Formatura', date: o.date || '2026-09-20', promisedDate: o.prazo || '', eventCredits: '',
  longDescription: 'Descrição.', photosAlert: { active: false, addedAt: null, expiresAfterHours: 24 },
});
const EVENTOS = [
  ev(1, { slug: 'formatura-medicina-2026', title: 'Formatura Medicina 2026', pinned: true, date: '2026-10-04' }),
  ev(2, { slug: 'casamento-ana-e-joao', title: 'Casamento Ana & João', cat: 'Casamento', access: 'family', date: '2026-09-27' }),
  ev(3, { slug: 'piauifut-2026', title: 'PiauiFut+ 2026', cat: 'Esporte', status: 'em-edicao', prazo: '2026-01-10', date: '2026-09-14' }),
  ev(4, { slug: 'baile-de-gala', title: 'Baile de Gala 3º Ano', comingSoon: true, status: 'em-revisao', prazo: '2099-11-02', date: '2026-11-02' }),
  ev(5, { slug: 'ensaio-externo', title: 'Ensaio Externo — Parque', visible: false, cat: 'Ensaio', access: 'private', date: '2026-08-30' }),
];
const agora = Date.now();
const PEDIDOS = [
  { id: 'a'.repeat(32), eventSlug: 'formatura-medicina-2026', eventTitle: 'Formatura Medicina 2026', method: 'number', value: 'Foto nº 12', email: 'pessoa@example.com', phone: '', message: 'Estou de olhos fechados.', fileName: null, fileBase64: null, resolved: false, createdAt: new Date(agora - 3600e3).toISOString(), emailStatus: 'sent', confirmEmailStatus: 'sent' },
  { id: 'b'.repeat(32), eventSlug: 'piauifut-2026', eventTitle: 'PiauiFut+ 2026', method: 'url', value: 'https://drive.google.com/file/d/XYZ/view', email: 'outra@example.com', phone: '', message: '', fileName: null, fileBase64: null, resolved: false, createdAt: new Date(agora - 86400e3).toISOString(), emailStatus: 'sent', confirmEmailStatus: 'sent' },
];
// Os dois formatos de pedido que produção tem logo depois do deploy da v2.0
// (#198): um ainda no array antigo `removal_requests` (até o primeiro cron
// migrar) e um já na chave própria `removal_request:<id>`. O painel lista os
// dois juntos, e resolver grava só a chave do pedido resolvido.
const SEMENTE = {
  events: JSON.stringify(EVENTOS),
  categories: JSON.stringify(['Formatura', 'Casamento', 'Esporte', 'Ensaio']),
  agenda: 'Agenda aberta para 2027',
  removal_requests: JSON.stringify([PEDIDOS[0]]),
  [`removal_request:${PEDIDOS[1].id}`]: JSON.stringify(PEDIDOS[1]),
};
const SENHA_NOVA = 'Outra-Senha-Forte-2027!';

// A série por dia das Métricas (v2, #215), sintética e DETERMINÍSTICA (o mesmo
// sorteio a cada execução, para as capturas compararem): 100 dias até hoje, um
// ritmo semanal (fim de semana movimenta mais) e um pico depois da data de
// cada evento. É a MESMA função da ação "Gerar métricas de exemplo" da prévia
// (src/previa.js) — uma regra, um lugar. O total `views:<slug>` leva também um
// histórico anterior à série (o que o KV contava antes do Durable Object), para
// o "Total desde o início" ser maior que a soma dos dias — como em produção.
function contadoresSinteticos() {
  const out = metricasDeExemplo(EVENTOS, hojeEmSaoPaulo(), 100);
  out['views:formatura-medicina-2026'] = (out['views:formatura-medicina-2026'] || 0) + 742;
  return out;
}
const CONTADORES = contadoresSinteticos();

// O pixel que vale por toda capa do lh3 (vermelho — por isso as miniaturas das capturas são quadrados vermelhos).
const PIXEL = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');

const browser = await chromium.launch({ executablePath: chromiumLocal() });
// O vigia de CSP enxerga e a política barra o que não tem nonce (scripts/vigia-csp.mjs).
await provaOVigia(browser, registra);

/**
 * Um contexto logado num Worker novo (cada aparelho com o seu: a troca de
 * senha de um não pode atrapalhar o outro).
 * @param {{ width: number, height: number }} viewport @param {number} dpr @param {boolean} toque
 */
async function abre(viewport, dpr, toque) {
  const w = await sobeWorker({ kv: SEMENTE, contadores: CONTADORES });
  const ctx = await browser.newContext({ viewport, deviceScaleFactor: dpr, hasTouch: toque, isMobile: toque });
  const page = await ctx.newPage();
  const estado = { erros: /** @type {string[]} */ ([]), csp: /** @type {string[]} */ ([]) };
  page.on('pageerror', e => estado.erros.push(String(e)));
  vigiaCsp(page, estado.csp);
  // Miniaturas do lh3: um pixel basta (o painel não depende da imagem).
  await page.route(/lh3\.googleusercontent\.com/, r => r.fulfill({ contentType: 'image/png', body: PIXEL }));
  await entraNoPainel(page, w.url);
  return { w, ctx, page, estado };
}

/** Toque no celular, clique no computador. */
const aciona = async (/** @type {import('playwright-core').Locator} */ l, /** @type {boolean} */ toque) => (toque ? l.tap() : l.click());
const espera = (/** @type {import('playwright-core').Page} */ page, ms = 400) => page.waitForTimeout(ms);
/** @param {import('playwright-core').Page} page */
const aviso = async page => {
  await page.waitForSelector('#toast.show', { timeout: 6000 });
  return (await page.locator('#toast').textContent()) || '';
};
/**
 * O aviso da vez sai já, como se os 3 s dele tivessem passado — para o
 * próximo `aviso()` ler o aviso seguinte, e não este. (Esperar os 3 s a cada
 * passo era metade do tempo do roteiro.)
 * @param {import('playwright-core').Page} page
 */
const someAviso = page => page.evaluate(() => {
  const t = /** @type {HTMLElement & { _t?: number }} */ (document.getElementById('toast'));
  clearTimeout(t._t);
  t.classList.remove('show');
});
/**
 * Percorre pelo Tab, como quem usa teclado, tudo que recebe foco dentro de
 * `escopo`, a partir de `inicio`, e devolve as paradas sem contorno de foco à
 * vista ou com o contorno cortado por alguma caixa em volta (overflow).
 * @param {import('playwright-core').Page} page @param {string} escopo @param {string} inicio
 */
async function varreFoco(page, escopo, inicio) {
  await page.focus(inicio);
  /** @type {string[]} */
  const semAnel = [];
  /** @type {Set<string>} */
  const vistos = new Set();
  let anterior = '';
  for (let n = 0; n < 160; n++) {
    const r = await page.evaluate(sel => {
      const el = /** @type {HTMLInputElement} */ (document.activeElement);
      if (!el || !el.closest(sel)) return { fim: true };
      // A posição no escopo identifica a parada (botões sem id se repetem).
      const chave = String([...document.querySelectorAll(sel + ' *')].indexOf(el));
      const nome = el.id || el.getAttribute('aria-label') || (el.textContent || '').trim().slice(0, 24) || el.tagName;
      // Quem desenha o contorno, e à vista: o próprio elemento; o trilho ao
      // lado (o toggle, cujo checkbox é invisível); ou a caixa em volta
      // (:focus-within — o campo da URL).
      const aVista = (/** @type {Element} */ e) => { const q = e.getBoundingClientRect(); return q.width > 0 && q.height > 0 && getComputedStyle(e).opacity !== '0'; };
      const anelDe = (/** @type {Element} */ e) => {
        const ee = getComputedStyle(e);
        if (ee.outlineStyle !== 'none') return parseFloat(ee.outlineOffset) + parseFloat(ee.outlineWidth);
        const sombra = ee.boxShadow.match(/0px 0px 0px (\d+(?:\.\d+)?)px/);
        return sombra ? parseFloat(sombra[1]) : -1;
      };
      /** @type {Element | null} */
      let dono = aVista(el) && anelDe(el) >= 0 ? el : null;
      for (let i = el.nextElementSibling; !dono && i; i = i.nextElementSibling) if (aVista(i) && anelDe(i) >= 0) dono = i;
      for (let a = el.parentElement; !dono && a; a = a.parentElement) if (anelDe(a) >= 0) dono = a;
      if (!dono) return { chave, erro: nome + ': sem contorno à vista' };
      const folga = anelDe(dono);
      const c = dono.getBoundingClientRect();
      const anel = { l: c.left - folga, t: c.top - folga, r: c.right + folga, b: c.bottom + folga };
      for (let a = dono.parentElement; a && a !== document.body; a = a.parentElement) {
        const ea = getComputedStyle(a);
        if (ea.overflowX === 'visible' && ea.overflowY === 'visible') continue;
        const ca = a.getBoundingClientRect();
        const x0 = ca.left + parseFloat(ea.borderLeftWidth), y0 = ca.top + parseFloat(ea.borderTopWidth);
        // Rolagem vertical traz o anel de cima e de baixo para a vista; o
        // corte de lado, e o de cima e de baixo numa caixa que não rola na
        // vertical, ficam.
        const rolaY = ea.overflowY === 'auto' || ea.overflowY === 'scroll';
        const corta = anel.l < x0 - 0.5 || anel.r > x0 + a.clientWidth + 0.5
          || ((!rolaY || a.scrollHeight <= a.clientHeight + 1) && (anel.t < y0 - 0.5 || anel.b > y0 + a.clientHeight + 0.5));
        if (corta) return { chave, erro: nome + ': contorno cortado por .' + (a.className || a.tagName) };
      }
      return { chave };
    }, escopo);
    // A data tem várias paradas (dia, mês, ano, calendário) no mesmo campo;
    // só voltar a uma parada já vista, depois de outra, é a volta.
    if (r.fim || (r.chave && r.chave !== anterior && vistos.has(r.chave))) break;
    if (r.chave && r.chave !== anterior) { vistos.add(r.chave); if (r.erro) semAnel.push(r.erro); }
    anterior = r.chave || '';
    await page.keyboard.press('Tab');
  }
  await page.evaluate(() => /** @type {HTMLElement} */ (document.activeElement).blur());
  return { semAnel, paradas: vistos.size };
}
/**
 * Alvos de toque à vista, dentro de `escopo`, com menos de 44 px de altura:
 * botões, links de ação, campos (menos caixas de seleção) e seletores.
 * @param {import('playwright-core').Page} page @param {string} escopo
 */
const alvosPequenos = (page, escopo) => page.evaluate(sel => {
  const vis = (/** @type {Element} */ e) => { const r = e.getBoundingClientRect(); return r.width > 0 && r.height > 0; };
  return [...document.querySelectorAll(sel.split(',').map(x => x.trim()).flatMap(x => [x + ' button', x + ' a.act', x + ' input:not([type=checkbox]):not([type=hidden])', x + ' select', x + ' summary']).join(', '))]
    .filter(vis).map(e => ({ t: (e.textContent || e.getAttribute('aria-label') || e.id || '').trim().slice(0, 24), h: Math.round(e.getBoundingClientRect().height) }))
    .filter(x => x.h < 44);
}, escopo);
/** @param {import('playwright-core').Page} page @param {string} nome */
const print = async (page, nome) => { if (PRINTS) await page.screenshot({ path: join(PRINTS, `painel-${nome}.png`), fullPage: false }); };

for (const [rotulo, viewport, dpr, toque] of /** @type {const} */ ([
  ['iPhone 390@3', { width: 390, height: 844 }, 3, true],
  ['Android 360@2', { width: 360, height: 780 }, 2, true],
  ['Computador 1440@1', { width: 1440, height: 900 }, 1, false],
])) {
  const id = rotulo.split(' ')[0].toLowerCase();
  await cenario(rotulo, async () => {
    const { w, ctx, page, estado } = await abre(viewport, dpr, toque);
    try {
      // ---- 1. A casa no lugar certo ---------------------------------------
      const nav = await page.locator('nav.nav').boundingBox();
      if (toque) {
        registra(!!nav && Math.abs((nav.y + nav.height) - viewport.height) <= 2 && nav.width >= viewport.width - 1,
          `${rotulo}: a navegação é a barra de baixo, de ponta a ponta`, nav);
      } else {
        registra(!!nav && nav.x < 40 && nav.height > 150, `${rotulo}: a navegação é a barra lateral`, nav);
      }
      // O atributo hidden esconde de verdade: uma classe com display (o selo
      // de Pedidos é inline-flex, o resumo das Métricas é grid) vencia o
      // [hidden] do navegador — com zero pendentes, um círculo vermelho vazio.
      const aparecendo = await page.evaluate(() => [...document.querySelectorAll('[hidden]')]
        .filter(e => getComputedStyle(e).display !== 'none').map(e => e.id || e.className));
      registra(aparecendo.length === 0, `${rotulo}: todo elemento com hidden está mesmo escondido`, aparecendo);
      // Vazar para o lado, seção por seção. Compara com a largura do APARELHO,
      // não com window.innerWidth: num celular, conteúdo largo demais faz o
      // navegador alargar a "janela de layout" e afastar a página (zoom para
      // fora) — e aí innerWidth cresce junto e a conta dá zero. Foi assim que
      // um bloco de Ajustes 25 px largo demais passou da primeira vez.
      /** @type {string[]} */
      const vazam = [];
      for (const aba of ['events', 'requests', 'metrics', 'settings']) {
        await page.evaluate(a => /** @type {HTMLElement} */ (document.querySelector('nav.nav [data-tab="' + a + '"]')).click(), aba);
        await espera(page, 350);
        const m = await page.evaluate(() => ({ sw: document.scrollingElement ? document.scrollingElement.scrollWidth : 0, escala: window.visualViewport ? window.visualViewport.scale : 1 }));
        if (m.sw > viewport.width || m.escala < 0.99) vazam.push(`${aba}: ${m.sw}px, escala ${m.escala}`);
      }
      await page.evaluate(() => /** @type {HTMLElement} */ (document.querySelector('nav.nav [data-tab="events"]')).click());
      await espera(page, 300);
      registra(vazam.length === 0, `${rotulo}: nada vaza para o lado, em nenhuma seção (página na escala 1)`, vazam);
      if (toque) {
        const pequenos = await alvosPequenos(page, '#tab-events, nav.nav');
        registra(pequenos.length === 0, `${rotulo}: todo alvo de toque da lista tem pelo menos 44 px`, pequenos.slice(0, 5));
        // Com "Selecionar vários" ligado, a caixa de cada card tem 17 px, mas o
        // alvo de toque é o rótulo em volta dela. Liga-se só para medir e
        // desliga-se logo depois: o resto do roteiro vê a lista como antes.
        await aciona(page.locator('#mass-toggle'), toque);
        await espera(page, 300);
        const selecao = await page.evaluate(() => {
          const vis = (/** @type {Element} */ e) => { const r = e.getBoundingClientRect(); return r.width > 0 && r.height > 0; };
          const tam = (/** @type {Element} */ e) => { const r = e.getBoundingClientRect(); return { w: Math.round(r.width), h: Math.round(r.height) }; };
          const caixas = /** @type {HTMLElement[]} */ ([...document.querySelectorAll('#evt-list .evt-check-alvo')]).filter(vis);
          const todos = /** @type {HTMLElement | null} */ (document.querySelector('label.mass-selall'));
          const pequenos = caixas.filter(e => tam(e).w < 44 || tam(e).h < 44)
            .map(e => ({ caixa: (e.querySelector('input')?.getAttribute('aria-label') || '').slice(0, 40), ...tam(e) }));
          // O canto de cima à esquerda do primeiro card, 3 px para dentro: fora
          // dos 17 px da caixa, mas dentro do rótulo de 44 px.
          const y = window.scrollY;
          const primeiro = caixas[0];
          let tocado = 'nada';
          if (primeiro) {
            primeiro.scrollIntoView({ block: 'center' });
            const r = primeiro.getBoundingClientRect();
            const ali = document.elementFromPoint(r.left + 3, r.top + 3);
            tocado = ali ? (ali === primeiro || primeiro.contains(ali) ? 'rótulo' : ali.tagName + '.' + ali.className) : 'nada';
          }
          window.scrollTo(0, y);
          return { caixas: caixas.length, pequenos, todos: todos ? tam(todos).h : 0, tocado };
        });
        registra(selecao.caixas === EVENTOS.length && selecao.pequenos.length === 0 && selecao.todos >= 44,
          `${rotulo}: no modo "Selecionar vários", cada caixa de seleção recebe o toque em pelo menos 44 × 44, e o "Todos" tem 44 px de altura`,
          { caixas: selecao.caixas, pequenos: selecao.pequenos, todos: selecao.todos });
        registra(selecao.tocado === 'rótulo', `${rotulo}: o toque 3 px dentro do canto de cima de uma caixa (fora dos 17 px dela) cai no rótulo`, selecao.tocado);
        // A barra com o modo ligado: nada dela passa da largura do APARELHO (os
        // pares select + botão empilham). Compara com viewport.width, não com
        // innerWidth — ver a nota do vazamento, mais acima.
        const barra = await page.evaluate(largura => {
          const b = /** @type {HTMLElement} */ (document.getElementById('mass-bar'));
          const direitas = [b, ...b.querySelectorAll('*')].map(e => e.getBoundingClientRect().right);
          return { sobra: b.scrollWidth - b.clientWidth, maiorDireita: Math.round(Math.max(...direitas) * 10) / 10, largura };
        }, viewport.width);
        registra(barra.sobra <= 1 && barra.maiorDireita <= viewport.width + 0.5,
          `${rotulo}: com "Selecionar vários" ligado, a barra cabe no aparelho (nada passa da borda)`, barra);
        await aciona(page.locator('#mass-toggle'), toque);
        await espera(page, 300);
        const fonte = await page.evaluate(() => parseFloat(getComputedStyle(/** @type {Element} */ (document.getElementById('evt-search'))).fontSize));
        registra(fonte >= 16, `${rotulo}: campo com letra de 16 px (o iPhone não dá zoom ao tocar)`, { fonte });
      }
      const cards = await page.locator('#evt-list .evt-item').count();
      registra(cards === EVENTOS.length, `${rotulo}: a lista mostra os ${EVENTOS.length} eventos`, cards);
      // Os filtros e a conta: a conta é a da lista que aparece (com categoria,
      // "Todos" contava o site inteiro), no singular quando é um ("1 evento
      // ativos" era o texto), e a lista vazia diz a combinação de filtros.
      const conta = async () => ((await page.locator('#evt-count').textContent()) || '').trim();
      await aciona(page.locator('#status-filter [data-valor="ativos"]'), toque);
      const ativos = await conta();
      await page.selectOption('#category-filter', 'Casamento');
      const umAtivo = await conta();
      await aciona(page.locator('#status-filter [data-valor="todos"]'), toque);
      const daCategoria = { conta: await conta(), cards: await page.locator('#evt-list .evt-item').count() };
      await aciona(page.locator('#status-filter [data-valor="em-edicao"]'), toque);
      const vazia = ((await page.locator('#evt-list .empty').textContent()) || '').trim();
      await page.selectOption('#category-filter', '');
      await aciona(page.locator('#status-filter [data-valor="todos"]'), toque);
      const deVolta = await conta();
      registra(ativos === `${EVENTOS.length} eventos ativos` && umAtivo === '1 evento ativo' && daCategoria.conta === '1 evento' && daCategoria.cards === 1
        && vazia === 'Nenhum evento com status "Em edição" na categoria "Casamento".' && deVolta === `${EVENTOS.length} eventos`,
      `${rotulo}: filtros: a conta é a da lista, no singular quando é um, e a lista vazia diz a combinação`, { ativos, umAtivo, daCategoria, vazia, deVolta });
      if (!toque) {
        // Campo em foco ganha o contorno de 2 px, como botões e links — antes só
        // a borda escurecia (#222 → #3a3a3a: 1,7:1 sobre o fundo).
        const anel = (/** @type {string} */ sel) => page.$eval(sel, el => { const e = getComputedStyle(el); return e.outlineStyle + ' ' + e.outlineWidth + ' ' + e.outlineColor; });
        await page.focus('#evt-search');
        const naBusca = await anel('#evt-search');
        await page.keyboard.press('Tab');
        const naCategoria = await anel('#category-filter');
        await page.evaluate(() => /** @type {HTMLElement} */ (document.activeElement).blur());
        registra(naBusca === 'solid 2px rgb(192, 160, 96)' && naCategoria === 'solid 2px rgb(192, 160, 96)',
          `${rotulo}: campo em foco ganha o contorno de 2 px (busca e categoria)`, { naBusca, naCategoria });
        const lista = await varreFoco(page, '#tab-events', '#evt-search');
        registra(lista.semAnel.length === 0 && lista.paradas > 15, `${rotulo}: no Tab, toda parada da lista mostra o contorno de foco, sem corte (${lista.paradas} paradas)`, lista.semAnel);
        // A seleção é só do que está à vista: "Todos" marca os cinco, e o filtro
        // "Em edição" (um card) deixa a conta em 1, não em 5 (§4.4). Depois, o
        // filtro volta e o modo se desliga: o resto do roteiro vê a lista como antes.
        await aciona(page.locator('#mass-toggle'), toque);
        await espera(page, 200);
        await page.check('#mass-selall');
        const todosMarcados = ((await page.locator('#mass-count').textContent()) || '').trim();
        // O "Todos" acompanha as caixas: desmarcar uma o desmarca, e remarcá-la
        // o marca de novo — sem esperar o próximo redesenho da lista.
        const primeiraCaixa = page.locator('#evt-list .evt-check').first();
        await primeiraCaixa.uncheck();
        const todosAposDesmarcar = await page.isChecked('#mass-selall');
        await primeiraCaixa.check();
        const todosAposRemarcar = await page.isChecked('#mass-selall');
        registra(!todosAposDesmarcar && todosAposRemarcar,
          `${rotulo}: o "Todos" acompanha as caixas: desmarcar uma o desmarca, remarcar o marca`, { todosAposDesmarcar, todosAposRemarcar });
        await aciona(page.locator('#status-filter [data-valor="em-edicao"]'), toque);
        const visiveisMarcados = await page.locator('#evt-list .evt-check:checked').count();
        const contagemFiltrada = ((await page.locator('#mass-count').textContent()) || '').trim();
        await aciona(page.locator('#status-filter [data-valor="todos"]'), toque);
        await aciona(page.locator('#mass-toggle'), toque);
        registra(todosMarcados === `${EVENTOS.length} selecionados` && visiveisMarcados === 1 && contagemFiltrada === '1 selecionado',
          `${rotulo}: a seleção só tem o que está à vista: filtrar tira da conta o que saiu da lista`, { todosMarcados, visiveisMarcados, contagemFiltrada });
      }
      const selos = await page.locator('#evt-ev3 .status-badge').allTextContents();
      registra(selos.join('|') === 'Em edição|Atrasado', `${rotulo}: o card escreve o estado (status, atrasado)`, selos);
      registra(/prazo 10\/01/.test((await page.locator('#evt-ev3 .evt-meta').textContent()) || ''), `${rotulo}: o card mostra o prazo de quem não entregou`, '');
      await print(page, `${id}-eventos`);

      // ---- 2. Criar um evento ---------------------------------------------
      /** A página atrás de um diálogo: `inert` (nem foco nem leitor de tela chegam lá). */
      const inerte = () => page.evaluate(() => /** @type {HTMLElement} */ (document.getElementById('app')).inert);
      await aciona(page.locator('button.btn-add'), toque);
      await page.waitForSelector('#overlay.open');
      registra(await inerte(), `${rotulo}: com a folha do formulário aberta, a página atrás fica inert`, '');
      // A URL ganha o foco 100 ms depois de a folha abrir — mas não pode
      // tirá-lo de quem já está num campo (o roteiro, rápido, perdia o texto
      // do Drive para a URL de vez em quando: "URL inválida").
      await page.focus('#f-title');
      await espera(page, 250);
      const focoFicou = await page.evaluate(() => document.activeElement && document.activeElement.id);
      registra(focoFicou === 'f-title', `${rotulo}: a folha nova não tira o foco de quem já está num campo`, focoFicou);
      await page.fill('#f-slug', 'teste-do-roteiro');
      // Só a URL digitada já é alteração: fechar pergunta antes de descartar
      // (o slug não entrava na conta do "sujo").
      await aciona(page.locator('#overlay button.btn-secondary[data-onclick="closeForm"]'), toque);
      const perguntouSlug = await page.waitForSelector('.confirm-cancel', { timeout: 3000 }).then(() => true, () => false);
      if (perguntouSlug) await aciona(page.locator('.confirm-cancel'), toque);
      registra(perguntouSlug && (await page.locator('#overlay.open').count()) === 1, `${rotulo}: evento novo com só a URL: fechar pergunta antes de descartar`, { perguntouSlug });
      await page.fill('#f-title', 'Teste do roteiro');
      await page.fill('#f-drive', 'https://drive.google.com/drive/folders/PASTA_TESTE_0001');
      // "Prazo e status" começa recolhido: o atalho abre e leva até ele.
      await aciona(page.locator('.bf-atalhos [data-alvo="bf-producao"]'), toque);
      await espera(page, 500);
      registra(await page.locator('#bf-producao').evaluate(d => /** @type {HTMLDetailsElement} */ (d).open), `${rotulo}: o atalho abre o bloco recolhido`, '');
      if (toque) {
        const eram = await page.$$eval('#overlay details.bloco-form', ds => ds.map(d => { const era = /** @type {HTMLDetailsElement} */ (d).open; /** @type {HTMLDetailsElement} */ (d).open = true; return era; }));
        const naFolha = await alvosPequenos(page, '#overlay');
        // Os toggles medem-se com os blocos ainda abertos. O trilho tem 26 px e
        // fica no meio do rótulo de 44 px: a faixa de cima é só do rótulo.
        const toggles = await page.evaluate(() => {
          const vis = (/** @type {Element} */ e) => { const r = e.getBoundingClientRect(); return r.width > 0 && r.height > 0; };
          const tam = (/** @type {Element} */ e) => { const r = e.getBoundingClientRect(); return { w: Math.round(r.width), h: Math.round(r.height) }; };
          const lista = /** @type {HTMLElement[]} */ ([...document.querySelectorAll('#overlay label.toggle')]).filter(vis);
          const pequenos = lista.filter(e => tam(e).w < 44 || tam(e).h < 44)
            .map(e => ({ campo: e.querySelector('input')?.id || '', ...tam(e) }));
          const corpo = /** @type {HTMLElement | null} */ (document.querySelector('#overlay .sheet-body'));
          const rolagem = corpo ? corpo.scrollTop : 0;
          const primeiro = lista[0];
          let tocado = 'nada';
          if (primeiro) {
            primeiro.scrollIntoView({ block: 'center' });
            const r = primeiro.getBoundingClientRect();
            const ali = document.elementFromPoint(r.left + r.width / 2, r.top + 3);
            tocado = ali ? (ali === primeiro || primeiro.contains(ali) ? 'rótulo' : ali.tagName + '.' + ali.className) : 'nada';
          }
          if (corpo) corpo.scrollTop = rolagem;
          return { n: lista.length, pequenos, tocado };
        });
        await page.$$eval('#overlay details.bloco-form', (ds, e) => ds.forEach((d, i) => { /** @type {HTMLDetailsElement} */ (d).open = e[i]; }), eram);
        registra(toggles.n > 0 && toggles.pequenos.length === 0, `${rotulo}: os toggles da folha recebem o toque em pelo menos 44 × 44`, toggles.pequenos.length ? toggles.pequenos : { toggles: toggles.n });
        registra(toggles.tocado === 'rótulo', `${rotulo}: o toque 3 px abaixo da borda de cima do primeiro toggle cai nele`, toggles.tocado);
        registra(naFolha.length === 0, `${rotulo}: todo alvo de toque da folha do formulário tem pelo menos 44 px`, naFolha.slice(0, 6));
      }
      if (!toque) {
        // A folha inteira percorrida pelo Tab, como faz quem usa teclado (o da
        // URL do projeto ficava cortado pela caixa do prefixo; os chips dos
        // atalhos, pela faixa que rola; os toggles não mostravam nada).
        const blocos = await page.$$eval('#overlay details.bloco-form', ds => ds.map(d => { const era = /** @type {HTMLDetailsElement} */ (d).open; /** @type {HTMLDetailsElement} */ (d).open = true; return era; }));
        const folha = await varreFoco(page, '#overlay', '#f-slug');
        await page.$$eval('#overlay details.bloco-form', (ds, eram) => ds.forEach((d, i) => { /** @type {HTMLDetailsElement} */ (d).open = eram[i]; }), blocos);
        registra(folha.semAnel.length === 0 && folha.paradas > 30, `${rotulo}: no Tab, toda parada da folha (campos, toggles, botões, blocos) mostra o contorno de foco, sem corte (${folha.paradas} paradas)`, folha.semAnel);
      }
      await page.selectOption('#f-status', 'em-edicao');
      if (PRINTS) await print(page, `${id}-formulario`);
      await aciona(page.locator('#submit-btn'), toque);
      const msgCriou = await aviso(page);
      registra(/adicionado/i.test(msgCriou), `${rotulo}: criar um evento`, msgCriou);
      registra(/O site mostra em até 1 min/.test(msgCriou), `${rotulo}: o aviso de criar diz quando o site mostra a mudança`, msgCriou);
      await page.waitForSelector('#overlay.open', { state: 'hidden' });
      registra(!(await inerte()), `${rotulo}: fechada a folha, a página volta a responder`, '');
      const novo = page.locator('#evt-list .evt-item', { hasText: 'Teste do roteiro' });
      registra((await novo.count()) === 1 && /Em edição/.test((await novo.locator('.evt-selos').textContent()) || ''), `${rotulo}: o evento novo aparece, "Em edição"`, '');

      // ---- 3. Editar e marcar entregue ------------------------------------
      await someAviso(page);
      await aciona(novo.locator('[data-action="edit"]'), toque);
      await page.waitForSelector('#overlay.open');
      const resumo = (await page.locator('[data-resumo="bf-producao"]').textContent()) || '';
      registra(/Em edição/.test(resumo), `${rotulo}: bloco recolhido mostra o resumo ("${resumo}")`, resumo);
      // Colar e remover fotos são cliques, não digitação: o resumo do bloco
      // ("2 capas") tem de acompanhar. Tira as duas no fim — nada é salvo.
      const resumoFotos = async () => ((await page.locator('[data-resumo="bf-fotos"]').textContent()) || '').trim();
      await aciona(page.locator('#btn-paste-photos'), toque);
      await page.fill('#paste-photos-input', 'https://lh3.googleusercontent.com/d/FOTO_COLADA_1\nhttps://lh3.googleusercontent.com/d/FOTO_COLADA_2');
      await aciona(page.locator('[data-onclick="commitPastePhotos"]'), toque);
      const comDuas = await resumoFotos();
      await aciona(page.locator('#photo-list [data-action="removePhoto"]').first(), toque);
      const comUma = await resumoFotos();
      await aciona(page.locator('#photo-list [data-action="removePhoto"]').first(), toque);
      registra(/2 capas$/.test(comDuas) && /1 capa$/.test(comUma), `${rotulo}: colar e remover fotos atualiza o resumo do bloco`, { comDuas, comUma });
      await someAviso(page); // o "2 foto(s) adicionada(s)." do colar não pode ser lido como o do salvar
      await aciona(page.locator('.bf-atalhos [data-alvo="bf-producao"]'), toque);
      await espera(page, 400);
      await page.selectOption('#f-status', 'entregue');
      await aciona(page.locator('#submit-btn'), toque);
      const msgEditou = await aviso(page);
      registra(/atualizado/i.test(msgEditou), `${rotulo}: editar e marcar entregue`, msgEditou);
      registra(/O site mostra em até 1 min/.test(msgEditou), `${rotulo}: o aviso de editar diz quando o site mostra a mudança`, msgEditou);
      await page.waitForSelector('#overlay.open', { state: 'hidden' });
      registra(/Entregue/.test((await novo.locator('.evt-selos').textContent()) || ''), `${rotulo}: o card passa a dizer "Entregue"`, '');

      // "Novas fotos": ligar marca a hora; religar REINICIA o contador, como a
      // dica do campo promete (mesmo sem salvar o "desligado" no meio); salvar
      // sem mexer mantém a hora. Lido do KV do worker-local, que é o que vale.
      const avisoSalvo = () => (JSON.parse(w.kv.get('events') || '[]').find((/** @type {any} */ e) => e.slug === 'teste-do-roteiro') || {}).photosAlert || {};
      const clicaAviso = () => page.locator('#f-alert-active').evaluate(el => /** @type {HTMLInputElement} */ (el).click());
      /** @param {() => Promise<unknown>} mexe */
      const salvaAviso = async mexe => {
        await someAviso(page);
        await aciona(novo.locator('[data-action="edit"]'), toque);
        await page.waitForSelector('#overlay.open');
        await aciona(page.locator('.bf-atalhos [data-alvo="bf-pagina"]'), toque);
        await espera(page, 300);
        await mexe();
        await aciona(page.locator('#submit-btn'), toque);
        await page.waitForSelector('#overlay.open', { state: 'hidden' });
      };
      await salvaAviso(clicaAviso);
      const ligado = avisoSalvo();
      await salvaAviso(async () => { await clicaAviso(); await clicaAviso(); });
      const religado = avisoSalvo();
      await salvaAviso(async () => {});
      const intocado = avisoSalvo();
      registra(ligado.active === true && !!ligado.addedAt && religado.active === true && religado.addedAt !== ligado.addedAt && intocado.addedAt === religado.addedAt,
        `${rotulo}: "Novas fotos": religar reinicia o contador; salvar sem mexer, não`, { ligado: ligado.addedAt, religado: religado.addedAt, intocado: intocado.addedAt });

      // Texto alternativo por foto: uma linha por foto, aparado, linha vazia
      // mantida (= usa o título); o que foi salvo volta ao reabrir o formulário.
      await salvaAviso(async () => { await page.fill('#f-photo-alts', '  Noiva sorrindo \n\nBolo de três andares'); });
      const altsSalvos = (JSON.parse(w.kv.get('events') || '[]').find((/** @type {any} */ e) => e.slug === 'teste-do-roteiro') || {}).photoAlts;
      await someAviso(page);
      await aciona(novo.locator('[data-action="edit"]'), toque);
      await page.waitForSelector('#overlay.open');
      const altsNoCampo = await page.inputValue('#f-photo-alts');
      await aciona(page.locator('#overlay button.btn-secondary[data-onclick="closeForm"]'), toque);
      await page.waitForSelector('#overlay.open', { state: 'hidden' });
      registra(JSON.stringify(altsSalvos) === JSON.stringify(['Noiva sorrindo', '', 'Bolo de três andares']) && altsNoCampo === 'Noiva sorrindo\n\nBolo de três andares',
        `${rotulo}: descrição das fotos: salva uma por linha (aparada) e volta ao reabrir`, { altsSalvos, altsNoCampo });

      // ---- 4. Menu "Mais ações": ocultar ----------------------------------
      await someAviso(page);
      const mais = novo.locator('[data-action="menu"]');
      await aciona(mais, toque);
      const menu = novo.locator('.menu');
      registra(await menu.isVisible() && (await mais.getAttribute('aria-expanded')) === 'true', `${rotulo}: "⋯" abre o menu`, '');
      if (toque) {
        const caixa = await menu.boundingBox();
        // Itens de 48 px na folha (a regra de toque, que vem depois no CSS, os
        // baixava para 44).
        const itens = await menu.locator('.menu-item').evaluateAll(es => es.map(e => Math.round(e.getBoundingClientRect().height)));
        registra(!!caixa && caixa.y + caixa.height > viewport.height * 0.6 && itens.length > 0 && itens.every(h => h >= 48),
          `${rotulo}: no celular o menu é uma folha embaixo, ao alcance do polegar, com itens de 48 px`, { caixa, itens });
        if (PRINTS) await print(page, `${id}-menu`);
      } else {
        // Teclado: o foco entra no primeiro item; seta desce; Esc fecha e devolve.
        const primeiro = await page.evaluate(() => document.activeElement && document.activeElement.textContent);
        await page.keyboard.press('ArrowDown');
        const segundo = await page.evaluate(() => document.activeElement && document.activeElement.textContent);
        await page.keyboard.press('Escape');
        const fechou = await menu.isHidden();
        const voltou = await page.evaluate(() => !!document.activeElement && document.activeElement.getAttribute('data-action') === 'menu');
        registra(/Destacar/.test(primeiro || '') && /Ocultar/.test(segundo || '') && fechou && voltou,
          `${rotulo}: menu no teclado (foco no 1º item, seta, Esc devolve o foco)`, { primeiro, segundo, fechou, voltou });
        if (PRINTS) { await mais.click(); await espera(page, 200); await print(page, `${id}-menu`); }
        if (await menu.isHidden()) await mais.click();
      }
      // Outro aparelho edita o evento depois que esta página abriu (direto no
      // KV): o "Ocultar" manda só `visible`, e a edição de lá fica.
      const evs = JSON.parse(w.kv.get('events') || '[]');
      evs.find((/** @type {any} */ e) => e.slug === 'teste-do-roteiro').eventCredits = 'Editado em outro aparelho';
      w.kv.set('events', JSON.stringify(evs));
      await aciona(novo.locator('[data-action="vis"]'), toque);
      const msgOcultou = await aviso(page);
      const oculto = JSON.parse(w.kv.get('events') || '[]').find((/** @type {any} */ e) => e.slug === 'teste-do-roteiro') || {};
      registra(oculto.visible === false && oculto.eventCredits === 'Editado em outro aparelho',
        `${rotulo}: "Ocultar" não desfaz o que outro aparelho editou`, { visible: oculto.visible, eventCredits: oculto.eventCredits });
      registra(/oculto/i.test(msgOcultou) && /Oculto/.test((await novo.locator('.evt-selos').textContent()) || ''),
        `${rotulo}: "Ocultar da galeria" pelo menu, e o card ganha o selo "Oculto"`, msgOcultou);

      // ---- 5. Resolver um pedido de remoção -------------------------------
      await someAviso(page);
      registra((await page.locator('#requests-badge').textContent()) === '2', `${rotulo}: a navegação avisa 2 pedidos pendentes`, await page.locator('#requests-badge').textContent());
      await aciona(page.locator('nav.nav [data-tab="requests"]'), toque);
      await page.waitForSelector('#tab-requests.active');
      await print(page, `${id}-pedidos`);
      if (toque) {
        const emPedidos = await alvosPequenos(page, '#tab-requests');
        registra(emPedidos.length === 0, `${rotulo}: todo alvo de toque de Pedidos tem pelo menos 44 px`, emPedidos.slice(0, 6));
      }
      await aciona(page.locator('[data-action="resolveRequest"]').first(), toque);
      const msgResolveu = await aviso(page);
      await espera(page, 600);
      registra(/resolvida/i.test(msgResolveu) && (await page.locator('#requests-badge').textContent()) === '1',
        `${rotulo}: resolver um pedido (e o aviso da navegação cai para 1)`, msgResolveu);
      if (!toque) {
        // Um Tab antes: foco por script só mostra o contorno de botão se o foco
        // anterior veio do teclado. Depois de um clique, a varredura começaria no
        // escuro — e a de Métricas, logo abaixo, faz o mesmo com a seta.
        await page.keyboard.press('Tab');
        const pedidos = await varreFoco(page, '#tab-requests', '#tab-requests button');
        registra(pedidos.semAnel.length === 0 && pedidos.paradas > 1, `${rotulo}: no Tab, toda parada de Pedidos mostra o contorno de foco, sem corte (${pedidos.paradas} paradas)`, pedidos.semAnel);
      }

      // ---- 6. Métricas (v2, #215) -------------------------------------------
      // Uma leitura da série por dia, e o resto é desenhado no navegador:
      // números do período comparados com o anterior, o gráfico de linhas com
      // a cruz (toque, mouse e teclado), a tabela, a semana, o portão, a lista
      // de projetos que foca o gráfico, e o CSV da série.
      await someAviso(page);
      await aciona(page.locator('nav.nav [data-tab="metrics"]'), toque);
      await page.waitForSelector('#tab-metrics.active');
      // A aba ativa é branca mesmo com o dedo (ou o mouse) ainda em cima dela.
      // Lida depois da transição de cor da aba (0,2 s).
      await espera(page, 300);
      const corDaAtiva = await page.locator('nav.nav [data-tab="metrics"]').evaluate(t => getComputedStyle(t).color);
      registra(corDaAtiva === 'rgb(240, 235, 229)', `${rotulo}: a aba tocada fica com o branco da ativa`, corDaAtiva);
      await page.waitForSelector('#grafico-acessos svg', { timeout: 6000 });
      const rotulos = await page.locator('#metrics-resumo .resumo-lab').allTextContents();
      registra(rotulos.join('|') === 'Visitas|Abriram o Drive|Taxa de abertura|Hoje', `${rotulo}: métricas abrem com os números do período`, rotulos);
      if (toque) {
        const alturaProjeto = Math.round(((await page.locator('#metrics-projeto').boundingBox()) || { height: 0 }).height * 10) / 10;
        registra(alturaProjeto >= 44, `${rotulo}: o seletor de projeto das métricas tem 44 px`, { alturaProjeto });
      }
      const delta = ((await page.locator('#metrics-resumo .resumo-delta').first().textContent()) || '').trim();
      registra(/vs\. 30 dias antes/.test(delta), `${rotulo}: o número vem comparado com o período anterior ("${delta}")`, delta);
      const desenho = page.locator('#grafico-acessos svg');
      const pontos = await desenho.getAttribute('data-pontos');
      const linhas = await desenho.locator('path[fill="none"]').count();
      const itensLegenda = await page.locator('#acessos-legenda span').count();
      registra(pontos === '30' && linhas === 2 && itensLegenda === 2, `${rotulo}: gráfico de 30 dias, duas linhas e a legenda`, { pontos, linhas, itensLegenda });

      await aciona(page.locator('#metrics-periodo [data-dias="7"]'), toque);
      await espera(page, 250);
      registra((await desenho.getAttribute('data-pontos')) === '7' && (await page.locator('#metrics-periodo [data-dias="7"]').getAttribute('aria-pressed')) === 'true',
        `${rotulo}: "7 dias" redesenha o gráfico com 7 pontos`, await desenho.getAttribute('data-pontos'));

      // No celular o gráfico fica abaixo da dobra (os números vêm antes), e
      // `touchscreen.tap(x, y)` não rola a página como o `locator.tap()`.
      await desenho.scrollIntoViewIfNeeded();
      const caixaGrafico = await desenho.boundingBox();
      if (caixaGrafico) {
        const meio = { x: caixaGrafico.x + caixaGrafico.width * 0.55, y: caixaGrafico.y + caixaGrafico.height * 0.5 };
        if (toque) await page.touchscreen.tap(meio.x, meio.y);
        else await page.mouse.move(meio.x, meio.y);
      }
      await espera(page, 200);
      const dica = page.locator('#dica-acessos');
      const textoDica = ((await dica.textContent()) || '').trim();
      registra(await dica.isVisible() && /Visitas/.test(textoDica) && /Abriram o Drive/.test(textoDica),
        `${rotulo}: ${toque ? 'tocar' : 'passar o mouse'} no gráfico mostra o dia e os dois números`, textoDica);
      const caixaDica = await dica.boundingBox();
      registra(!!caixaDica && caixaDica.x >= 0 && caixaDica.x + caixaDica.width <= viewport.width + 1, `${rotulo}: a dica cabe na tela`, caixaDica);
      if (PRINTS) await print(page, `${id}-metricas-dica`);
      // A dica nunca cobre o ponto que descreve — em vários lugares do gráfico
      // (no celular ela não cabe ao lado da cruz no meio, e foi assim que o
      // primeiro desenho escondia o próprio ponto).
      /** @type {string[]} */
      const cobertos = [];
      if (caixaGrafico) {
        for (const fracao of [0.08, 0.3, 0.5, 0.7, 0.95]) {
          const ponto = { x: caixaGrafico.x + caixaGrafico.width * fracao, y: caixaGrafico.y + caixaGrafico.height * 0.5 };
          if (toque) await page.touchscreen.tap(ponto.x, ponto.y);
          else await page.mouse.move(ponto.x, ponto.y);
          await espera(page, 120);
          const cobre = await page.evaluate(() => {
            const d = /** @type {HTMLElement} */ (document.getElementById('dica-acessos'));
            if (d.hidden) return 'dica escondida';
            const caixa = d.getBoundingClientRect();
            const ruins = [...document.querySelectorAll('#grafico-acessos .cruz circle')]
              .filter(c => c.getAttribute('visibility') !== 'hidden')
              .filter(c => {
                const r = c.getBoundingClientRect();
                const cx = r.x + r.width / 2, cy = r.y + r.height / 2;
                return cx >= caixa.left && cx <= caixa.right && cy >= caixa.top && cy <= caixa.bottom;
              });
            return ruins.length ? 'cobre ' + ruins.length + ' ponto(s)' : '';
          });
          if (cobre) cobertos.push(`${Math.round(fracao * 100)}%: ${cobre}`);
        }
      }
      registra(cobertos.length === 0, `${rotulo}: a dica não cobre o ponto que descreve (5 posições)`, cobertos);
      if (!toque) {
        await page.locator('#grafico-acessos').focus();
        const antes = await page.locator('#dica-acessos .dica-dia').textContent();
        await page.keyboard.press('ArrowLeft');
        const depois = await page.locator('#dica-acessos .dica-dia').textContent();
        const anuncio = (await page.locator('#acessos-anuncio').textContent()) || '';
        registra(antes !== depois && /visitas/.test(anuncio), `${rotulo}: no teclado, a seta anda um dia e o leitor de tela ouve`, { antes, depois, anuncio });
        const anelGrafico = await page.$eval('#grafico-acessos', el => getComputedStyle(el).boxShadow);
        registra(/rgb\(192, 160, 96\) 0px 0px 0px 2px/.test(anelGrafico), `${rotulo}: o gráfico em foco tem o anel dourado (o cinza de antes tinha 2,1:1)`, anelGrafico);
        await page.keyboard.press('Escape');
        registra(await dica.isHidden(), `${rotulo}: Esc esconde a dica`, '');
        const metricas = await varreFoco(page, '#tab-metrics', '#metrics-periodo [data-dias="7"]');
        registra(metricas.semAnel.length === 0 && metricas.paradas > 8, `${rotulo}: no Tab, toda parada das Métricas mostra o contorno de foco, sem corte (${metricas.paradas} paradas)`, metricas.semAnel);
      } else {
        await page.touchscreen.tap(5, Math.round(viewport.height * 0.3));
        await espera(page, 150);
        registra(await dica.isHidden(), `${rotulo}: tocar fora do gráfico esconde a dica`, '');
      }

      await aciona(page.locator('#acessos-ver-tabela'), toque);
      const linhasTabela = await page.locator('#acessos-tabela tbody tr').count();
      registra(linhasTabela === 7 && (await page.locator('#acessos-ver-tabela').getAttribute('aria-expanded')) === 'true',
        `${rotulo}: "Ver como tabela" abre os 7 dias`, linhasTabela);
      await aciona(page.locator('#acessos-ver-tabela'), toque);
      await aciona(page.locator('#metrics-periodo [data-dias="30"]'), toque);
      await espera(page, 250);

      registra((await page.locator('#grafico-semana [data-coluna]').count()) === 7, `${rotulo}: dia da semana com 7 colunas`, '');
      const portao = await page.locator('#grafico-portao .barra-rot').allTextContents();
      registra(portao.length === 3 && portao.every(t => /\d+%/.test(t)), `${rotulo}: modos do portão com contagem e %`, portao);

      const numeroAntes = await page.locator('#metrics-resumo .resumo-num').first().textContent();
      await aciona(page.locator('#metrics-ranking .rank-item').first(), toque);
      await espera(page, 500);
      const escolhido = await page.locator('#metrics-projeto').inputValue();
      const numeroDepois = await page.locator('#metrics-resumo .resumo-num').first().textContent();
      registra((await page.locator('#metrics-ranking .rank-item[aria-pressed="true"]').count()) === 1 && escolhido !== '' && numeroAntes !== numeroDepois,
        `${rotulo}: tocar num projeto foca os gráficos nele`, { escolhido, numeroAntes, numeroDepois });
      await aciona(page.locator('#metrics-ranking .rank-item[aria-pressed="true"]'), toque);
      await espera(page, 300);
      registra((await page.locator('#metrics-projeto').inputValue()) === '', `${rotulo}: tocar de novo volta a todos os projetos`, '');

      const [baixado] = await Promise.all([
        page.waitForEvent('download', { timeout: 6000 }),
        aciona(page.locator('#bloco-acessos [data-onclick="exportSerieCSV"]'), toque),
      ]);
      const caminhoCsv = await baixado.path();
      const csv = caminhoCsv ? readFileSync(caminhoCsv, 'utf8').replace(/^\uFEFF/, '') : '';
      registra(/^metricas-por-dia-\d{4}-\d{2}-\d{2}\.csv$/.test(baixado.suggestedFilename()) && csv.startsWith('dia,slug,titulo,visitas,abriram_drive'),
        `${rotulo}: CSV da série por dia`, baixado.suggestedFilename());

      const medida = await page.evaluate(() => ({ sw: document.scrollingElement ? document.scrollingElement.scrollWidth : 0, escala: window.visualViewport ? window.visualViewport.scale : 1 }));
      registra(medida.sw <= viewport.width && medida.escala >= 0.99, `${rotulo}: as métricas desenhadas não vazam para o lado`, medida);
      await page.evaluate(() => window.scrollTo(0, 0));
      await print(page, `${id}-metricas`);
      if (PRINTS) {
        await page.screenshot({ path: join(PRINTS, `painel-${id}-metricas-inteira.png`), fullPage: true });
        // A captura de página inteira desliga a emulação de toque do celular
        // ((pointer: coarse) passa a falso) até a próxima navegação — e as
        // medidas de alvo de toque depois dela (Ajustes) mediam o computador.
        if (toque) await (await ctx.newCDPSession(page)).send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 });
      }

      // ---- 7. Trocar a senha (e entrar de novo com ela) --------------------
      await aciona(page.locator('nav.nav [data-tab="settings"]'), toque);
      await page.waitForSelector('#tab-settings.active');
      const grupos = await page.locator('.grupo-titulo').allTextContents();
      registra(grupos.join('|') === 'Site|Dados|Conta|Sobre', `${rotulo}: ajustes em quatro grupos (o último diz a versão)`, grupos);
      // Lembrete de backup: a semente não tem `backup:ultimo`, então a linha
      // avisa — com o texto E com o fundo âmbar do .aviso aplicado de verdade
      // (rgb de #1a1408), não só a classe no elemento.
      const linhaBackup = () => page.locator('#backup-ultimo').evaluate(e => ({ texto: (e.textContent || '').trim(), aviso: e.classList.contains('aviso'), fundo: getComputedStyle(e).backgroundColor }));
      const semBackup = await linhaBackup();
      registra(semBackup.texto === 'Nenhum backup baixado ainda.' && semBackup.aviso && semBackup.fundo === 'rgb(26, 20, 8)',
        `${rotulo}: sem backup baixado, a linha de Ajustes avisa "Nenhum backup baixado ainda." em âmbar`, semBackup);
      await print(page, `${id}-ajustes`);
      if (toque) {
        const emAjustes = await alvosPequenos(page, '#tab-settings');
        registra(emAjustes.length === 0, `${rotulo}: todo alvo de toque de Ajustes tem pelo menos 44 px`, emAjustes.slice(0, 6));
      } else {
        const ajustes = await varreFoco(page, '#tab-settings', '#agenda-texto');
        registra(ajustes.semAnel.length === 0 && ajustes.paradas > 15, `${rotulo}: no Tab, toda parada de Ajustes mostra o contorno de foco, sem corte (${ajustes.paradas} paradas)`, ajustes.semAnel);
      }
      await page.fill('#new-pass', SENHA_NOVA);
      await page.fill('#new-pass2', SENHA_NOVA);
      await aciona(page.locator('[data-onclick="changePassword"]'), toque);
      await page.waitForSelector('.confirm-type-input');
      await page.fill('.confirm-type-input', 'TROCAR');
      await aciona(page.locator('.confirm-ok'), toque);
      const msgSenha = await aviso(page);
      registra(/alterada/i.test(msgSenha), `${rotulo}: trocar a senha`, msgSenha);
      // Recarregar volta para a seção em que o dono estava.
      await page.reload();
      await page.waitForSelector('#tab-settings.active', { timeout: 5000 });
      registra(true, `${rotulo}: recarregar a página volta para a mesma seção`, '');
      // Sai; a senha antiga não entra mais (a troca valeu no servidor) e a
      // nova entra.
      await Promise.all([page.waitForNavigation(), aciona(page.locator('form[action="/dashboard/logout"] button'), toque)]);
      const tentaEntrar = (/** @type {string} */ senha) => entraNoPainel(page, w.url, senha).then(() => 'entrou', e => String(e instanceof Error ? e.message : e));
      const comAntiga = await tentaEntrar(SENHA_DE_TESTE);
      registra(/login recusado/.test(comAntiga), `${rotulo}: a senha antiga não entra mais`, comAntiga);
      const comNova = await tentaEntrar(SENHA_NOVA);
      registra(comNova === 'entrou' && (await page.locator('nav.nav').count()) === 1, `${rotulo}: entrar de novo com a senha nova`, comNova);

      // ---- 7b. Sair dos outros aparelhos ---------------------------------------
      // Um segundo aparelho (outro contexto do navegador, com os cookies dele)
      // entra com a senha nova. Este pede "Sair dos outros aparelhos": o outro cai
      // no login no gesto seguinte, e este continua — com uma sessão MAIS VELHA
      // que o corte, que só passa por ser a de quem pediu.
      //
      // O KV deste roteiro é um Map, forte e sem cache: o buraco do KV de verdade
      // (o apagamento que ainda não chegou a outro local, e a renovação que
      // ressuscita o registro) não acontece sozinho. Então ele é feito à mão: o
      // registro apagado do outro aparelho é posto de volta no KV, como a
      // renovação de um local com cache velho o poria — e o marcador de revogação
      // tem de recusá-lo do mesmo jeito.
      await someAviso(page);
      await aciona(page.locator('nav.nav [data-tab="settings"]'), toque);
      await page.waitForSelector('#tab-settings.active');
      const sessoesNoKv = () => [...w.kv.keys()].filter(k => k.startsWith('admin_session:'));
      const desteAparelho = sessoesNoKv();
      const ctx2 = await browser.newContext({ viewport, deviceScaleFactor: dpr, hasTouch: toque, isMobile: toque });
      try {
        const page2 = await ctx2.newPage();
        page2.on('pageerror', e => estado.erros.push('[2º aparelho] ' + String(e)));
        await page2.route(/lh3\.googleusercontent\.com/, r => r.fulfill({ contentType: 'image/png', body: PIXEL }));
        await entraNoPainel(page2, w.url, SENHA_NOVA);
        const comOsDois = sessoesNoKv();
        const chaveDoOutro = comOsDois.find(k => !desteAparelho.includes(k)) || '';
        const registroDoOutro = w.kv.get(chaveDoOutro) || '';
        registra(desteAparelho.length === 1 && comOsDois.length === 2 && !!registroDoOutro,
          `${rotulo}: com o segundo aparelho dentro, há duas sessões abertas`, { desteAparelho: desteAparelho.length, comOsDois: comOsDois.length });

        const botaoSessoes = page.locator('[data-onclick="revokeOtherSessions"]');
        await aciona(botaoSessoes, toque);
        await page.waitForSelector('.confirm-ok');
        const pedeDigitar = await page.locator('.confirm-type-input').count();
        await aciona(page.locator('.confirm-ok'), toque);
        const msgSessoes = await aviso(page);
        registra(pedeDigitar === 0 && msgSessoes === '1 sessão encerrada.' && (await botaoSessoes.isEnabled()),
          `${rotulo}: "Sair dos outros aparelhos" pede uma confirmação simples (sem digitar) e o aviso diz "1 sessão encerrada."`, { pedeDigitar, msgSessoes });

        const restaram = sessoesNoKv();
        const corte = JSON.parse(w.kv.get('admin_sessions_corte') || '{}');
        registra(restaram.length === 1 && restaram[0] === desteAparelho[0] && typeof corte.antes === 'number' && /^[0-9a-f]{64}$/.test(corte.exceto),
          `${rotulo}: no KV só fica a sessão deste aparelho, e o corte (o marcador de revogação) fica gravado`, { restaram: restaram.length, corte });

        // O registro apagado volta ao KV (a renovação de um local com cache velho).
        w.kv.set(chaveDoOutro, registroDoOutro);
        /** @type {string[]} */
        const dialogosDoOutro = [];
        page2.on('dialog', d => { dialogosDoOutro.push(d.type()); d.accept().catch(() => {}); });
        // O gesto seguinte do outro aparelho: abrir Métricas pede dados ao servidor.
        await aciona(page2.locator('nav.nav [data-tab="metrics"]'), toque);
        const outroNoLogin = await page2.waitForSelector('form[action="/dashboard/login"]', { timeout: 8000 }).then(() => true, () => false);
        registra(outroNoLogin, `${rotulo}: o outro aparelho, no gesto seguinte, cai no login — mesmo com o registro posto de volta no KV (o marcador o recusa)`, { outroNoLogin, dialogosDoOutro });
        registra(!w.kv.has(chaveDoOutro), `${rotulo}: o registro ressuscitado é apagado de novo`, w.kv.has(chaveDoOutro));

        // Este aparelho continua dentro: recarregar devolve o painel, não o login.
        await page.reload();
        registra((await page.locator('nav.nav').count()) === 1 && (await page.locator('form[action="/dashboard/login"]').count()) === 0,
          `${rotulo}: este aparelho continua logado depois do corte (a sessão dele é mais velha que o corte)`, page.url());
      } finally {
        await ctx2.close();
      }

      // Só no computador: o download e o aviso de saída são o mesmo código no celular.
      if (!toque) {
        await aciona(page.locator('nav.nav [data-tab="settings"]'), toque);
        await page.waitForSelector('#tab-settings.active');
        const [baixado] = await Promise.all([
          page.waitForEvent('download', { timeout: 6000 }),
          aciona(page.locator('[data-onclick="downloadBackup"]'), toque),
        ]);
        const caminhoBackup = await baixado.path();
        const backup = caminhoBackup ? (() => { try { return JSON.parse(readFileSync(caminhoBackup, 'utf8')); } catch { return {}; } })() : {};
        registra(/^fotos-backup-.*\.json$/.test(baixado.suggestedFilename()) && Array.isArray(backup.events),
          `${rotulo}: "Baixar backup" baixa fotos-backup-AAAA-MM-DD.json, com a lista de eventos`, baixado.suggestedFilename());
        // A linha de Ajustes muda no lugar — sem recarregar — assim que o fetch do
        // backup termina, e sai do aviso.
        await page.waitForFunction(() => (document.getElementById('backup-ultimo')?.textContent || '').startsWith('Último backup'), null, { timeout: 4000 }).catch(() => {});
        const depoisDoBackup = await linhaBackup();
        registra(depoisDoBackup.texto === 'Último backup: hoje' && !depoisDoBackup.aviso && depoisDoBackup.fundo === 'rgba(0, 0, 0, 0)',
          `${rotulo}: "Baixar backup" muda a linha para "Último backup: hoje", sem recarregar e sem o aviso`, depoisDoBackup);

        // Ajustes com texto não salvo: recarregar pergunta "Sair do site?" (uma
        // vez), e o dispensar mantém a página e o texto. Sem texto, não pergunta.
        // Uma marca na janela: some só com uma recarga de verdade. (Sem ela, o
        // "#tab-settings.active" do documento antigo passaria sozinho.)
        await page.fill('#cat-new', 'Categoria do roteiro');
        await page.evaluate(() => { window.__antesDoRecarregar = 1; });
        /** @type {string[]} */
        const avisosSujo = [];
        const anotaSujo = (/** @type {import('playwright-core').Dialog} */ d) => { avisosSujo.push(d.type()); d.dismiss().catch(() => {}); };
        page.on('dialog', anotaSujo);
        // Dispensado, o aviso cancela a recarga: o reload() pode falhar — o que vale é o que ficou.
        await page.reload({ timeout: 5000 }).catch(() => {});
        page.off('dialog', anotaSujo);
        const ficou = await page.evaluate(() => window.__antesDoRecarregar === 1);
        const campoFicou = await page.inputValue('#cat-new');
        registra(avisosSujo.length === 1 && avisosSujo[0] === 'beforeunload' && campoFicou === 'Categoria do roteiro' && ficou,
          `${rotulo}: Ajustes com texto não salvo: recarregar pergunta "Sair do site?" uma vez, e a página fica`, { avisosSujo, campoFicou, ficou });
        await page.fill('#cat-new', '');
        await page.evaluate(() => { window.__antesDoRecarregar = 1; });
        /** @type {string[]} */
        const avisosLimpo = [];
        const anotaLimpo = (/** @type {import('playwright-core').Dialog} */ d) => { avisosLimpo.push(d.type()); d.dismiss().catch(() => {}); };
        page.on('dialog', anotaLimpo);
        await page.reload({ timeout: 5000 }).catch(() => {});
        page.off('dialog', anotaLimpo);
        await page.waitForSelector('#tab-settings.active', { timeout: 5000 });
        const recarregou = await page.evaluate(() => window.__antesDoRecarregar === undefined);
        registra(avisosLimpo.length === 0 && recarregou, `${rotulo}: Ajustes sem texto não salvo: recarregar não pergunta nada`, { avisosLimpo, recarregou });
        // Recarregada de verdade, a linha vem do servidor: ele gravou backup:ultimo
        // no download, e a página o leu na abertura.
        const doServidor = await linhaBackup();
        registra(/^\d{4}-\d{2}-\d{2}T[\d:.]+Z$/.test(w.kv.get('backup:ultimo') || '') && doServidor.texto === 'Último backup: hoje' && !doServidor.aviso,
          `${rotulo}: recarregar a página mantém "Último backup: hoje" (o servidor gravou backup:ultimo e a página o leu)`, { gravado: w.kv.get('backup:ultimo'), doServidor });
      }

      // ---- 8. A sessão cai no meio de uma edição -----------------------------
      // (Inatividade, ou a senha trocada em outro aparelho.) O painel guarda um
      // rascunho e vai para o login SEM o "Sair do site? As alterações podem
      // não ser salvas" do navegador — elas estão no rascunho —, e entrar de
      // novo devolve a edição. Inclusive o "religar o aviso de novidade", que
      // muda o que é gravado (reinicia o contador) e por isso conta, sozinho,
      // como alteração.
      await someAviso(page);
      await aciona(page.locator('nav.nav [data-tab="events"]'), toque);
      await page.waitForSelector('#tab-events.active');
      const teste = page.locator('#evt-list .evt-item', { hasText: 'Teste do roteiro' });
      const contadorAntes = avisoSalvo().addedAt;
      await aciona(teste.locator('[data-action="edit"]'), toque);
      await page.waitForSelector('#overlay.open');
      await aciona(page.locator('.bf-atalhos [data-alvo="bf-pagina"]'), toque);
      await espera(page, 300);
      await clicaAviso();
      await clicaAviso();
      await aciona(page.locator('#overlay button.btn-secondary[data-onclick="closeForm"]'), toque);
      const perguntou = await page.waitForSelector('.confirm-cancel', { timeout: 3000 }).then(() => true, () => false);
      if (perguntou) await aciona(page.locator('.confirm-cancel'), toque);
      await espera(page, 200);
      registra(perguntou && (await page.locator('#overlay.open').count()) === 1,
        `${rotulo}: desligar e religar o aviso conta como alteração (fechar pergunta antes de descartar)`, { perguntou });
      const NOTA = 'Escrita antes de a sessão cair.';
      await aciona(page.locator('.bf-atalhos [data-alvo="bf-producao"]'), toque);
      await espera(page, 300);
      await page.fill('#f-notes', NOTA);
      for (const k of [...w.kv.keys()]) if (k.startsWith('admin_session:')) w.kv.delete(k);
      /** @type {string[]} */
      const dialogos = [];
      // Aceita (o roteiro segue mesmo com o defeito de volta), mas anota.
      const anota = (/** @type {import('playwright-core').Dialog} */ d) => { dialogos.push(d.type()); d.accept().catch(() => {}); };
      page.on('dialog', anota);
      await Promise.all([page.waitForNavigation({ timeout: 10000 }), aciona(page.locator('#submit-btn'), toque)]);
      page.off('dialog', anota);
      const noLogin = (await page.locator('form[action="/dashboard/login"]').count()) === 1;
      registra(noLogin && dialogos.length === 0, `${rotulo}: com a sessão caída, salvar leva ao login sem o "Sair do site?"`, { noLogin, dialogos });
      const voltou = await tentaEntrar(SENHA_NOVA);
      const msgRecuperou = voltou === 'entrou' ? await aviso(page) : '';
      const notaDeVolta = (await page.locator('#overlay.open').count()) === 1 ? await page.inputValue('#f-notes') : '';
      registra(/Recuperei/.test(msgRecuperou) && notaDeVolta === NOTA, `${rotulo}: entrar de novo devolve a edição aberta`, { voltou, msgRecuperou, notaDeVolta });
      await aciona(page.locator('#submit-btn'), toque);
      await page.waitForSelector('#overlay.open', { state: 'hidden' });
      const gravado = JSON.parse(w.kv.get('events') || '[]').find((/** @type {any} */ e) => e.slug === 'teste-do-roteiro') || {};
      const contadorDepois = (gravado.photosAlert || {}).addedAt;
      registra(gravado.internalNotes === NOTA && (gravado.photosAlert || {}).active === true && !!contadorDepois && contadorDepois !== contadorAntes,
        `${rotulo}: salvar o rascunho grava a nota e reinicia o contador do aviso religado`, { nota: gravado.internalNotes, contadorAntes, contadorDepois });

      // ---- 9. Excluir o evento de teste -----------------------------------
      await someAviso(page);
      await aciona(teste.locator('[data-action="menu"]'), toque);
      await aciona(teste.locator('[data-action="del"]'), toque);
      await page.waitForSelector('.confirm-type-input');
      registra(await inerte(), `${rotulo}: com a confirmação aberta, a página atrás fica inert`, '');
      if (toque) {
        const botoes = await page.locator('.confirm-foot button').evaluateAll(bs => bs.map(b => Math.round(b.getBoundingClientRect().height * 10) / 10));
        registra(botoes.length === 2 && botoes.every(h => h >= 44), `${rotulo}: os botões da confirmação têm 44 px (eram 40)`, botoes);
      }
      await page.fill('.confirm-type-input', 'Teste do roteiro');
      await aciona(page.locator('.confirm-ok'), toque);
      const msgExcluiu = await aviso(page);
      await espera(page, 400);
      registra(/excluído/i.test(msgExcluiu) && (await teste.count()) === 0, `${rotulo}: excluir (com a confirmação digitada)`, msgExcluiu);
      registra(!(await inerte()), `${rotulo}: fechada a confirmação, a página volta a responder`, '');

      // ---- 9b. Baixar o backup com a sessão caída (só no computador) ---------
      // No fim do roteiro, para não precisar de nova sessão depois. O 401 do
      // backup tem de levar ao login, e não deixar o JSON do erro na tela.
      if (!toque) {
        await aciona(page.locator('nav.nav [data-tab="settings"]'), toque);
        await page.waitForSelector('#tab-settings.active');
        for (const k of [...w.kv.keys()]) if (k.startsWith('admin_session:')) w.kv.delete(k);
        await aciona(page.locator('[data-onclick="downloadBackup"]'), toque);
        const noLoginDoBackup = await page.waitForSelector('form[action="/dashboard/login"]', { timeout: 8000 }).then(() => true, () => false);
        registra(noLoginDoBackup, `${rotulo}: "Baixar backup" com a sessão caída leva ao login, sem o JSON do erro`, noLoginDoBackup);
      }

      // ---- 10. Limpeza do console e da cota ----------------------------------
      registra(estado.erros.length === 0, `${rotulo}: nenhum erro de JS`, estado.erros);
      registra(estado.csp.length === 0, `${rotulo}: nenhuma mensagem de CSP no console`, estado.csp);
      const chaves = [...new Set(w.escritas.map(k => k.replace(/^admin_session:.*/, 'admin_session:*').replace(/^removal_request:.*/, 'removal_request:*')))].sort();
      // Só o computador baixa o backup, então só nele `backup:ultimo` é esperado.
      // A conta é exata de propósito: uma escrita a mais numa chave permitida
      // também gasta a cota (16 por aparelho; 17 no computador — docs/PAINEL.md §15.2).
      const permitidas = ['admin_password', 'admin_session:*', 'admin_sessions_corte', 'events', 'removal_request:*', ...(toque ? [] : ['backup:ultimo'])];
      const esperadas = toque ? 17 : 18;
      registra(chaves.every(k => permitidas.includes(k)) && w.escritas.length === esperadas,
        `${rotulo}: o fluxo só grava o que deve no KV (${w.escritas.length} escritas)`, { chaves, esperadas });
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
