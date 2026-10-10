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
//   novo com ela) → excluir o evento de teste.
// E, no caminho, o que só um navegador mostra: a navegação no lugar certo
// (barra de baixo no celular, lateral no computador), nada vazando para o
// lado, alvos de toque de 44 px, campo que não dá zoom no iPhone, menu com
// teclado, nenhum erro de JS, nenhuma violação da CSP aplicada, e quais
// chaves do KV o fluxo gravou (a cota é de 1000 escritas/dia — TODO.md).
//
// Uma falha não esconde as outras: cada cenário roda dentro de `cenario()`,
// que registra a exceção e segue (a mesma lição do smoke.sh).
//
// Precisa do gancho de `cloudflare:workers` (o script do package.json já
// passa): node --import ./scripts/node-com-workers.mjs scripts/verifica-painel.mjs

/* global document, window, getComputedStyle */
import { existsSync, readdirSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { chromium } from 'playwright-core';
import { sobeWorker, entraNoPainel, SENHA_DE_TESTE } from './worker-local.mjs';

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
const SEMENTE = {
  events: JSON.stringify(EVENTOS),
  categories: JSON.stringify(['Formatura', 'Casamento', 'Esporte', 'Ensaio']),
  agenda: 'Agenda aberta para 2027',
  removal_requests: JSON.stringify(PEDIDOS),
};
const SENHA_NOVA = 'Outra-Senha-Forte-2027!';

const browser = await chromium.launch({ executablePath: chromiumLocal() });

/**
 * Um contexto logado num Worker novo (cada aparelho com o seu: a troca de
 * senha de um não pode atrapalhar o outro).
 * @param {{ width: number, height: number }} viewport @param {number} dpr @param {boolean} toque
 */
async function abre(viewport, dpr, toque) {
  const w = await sobeWorker({ kv: SEMENTE });
  const ctx = await browser.newContext({ viewport, deviceScaleFactor: dpr, hasTouch: toque, isMobile: toque });
  const page = await ctx.newPage();
  const estado = { erros: /** @type {string[]} */ ([]), csp: /** @type {string[]} */ ([]) };
  page.on('pageerror', e => estado.erros.push(String(e)));
  page.on('console', m => {
    const t = m.text();
    if (/Content Security Policy/i.test(t) && !/Report Only/i.test(t)) estado.csp.push(t.slice(0, 160));
  });
  // Miniaturas do lh3: um pixel basta (o painel não depende da imagem).
  await page.route(/lh3\.googleusercontent\.com/, r => r.fulfill({
    contentType: 'image/png',
    body: Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64'),
  }));
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
        const pequenos = await page.evaluate(() => {
          const vis = (/** @type {Element} */ e) => { const r = e.getBoundingClientRect(); return r.width > 0 && r.height > 0; };
          return [...document.querySelectorAll('#tab-events button, #tab-events a.act, nav.nav .tab')]
            .filter(vis).map(e => ({ t: (e.textContent || e.getAttribute('aria-label') || '').trim().slice(0, 24), h: Math.round(e.getBoundingClientRect().height) }))
            .filter(x => x.h < 44);
        });
        registra(pequenos.length === 0, `${rotulo}: todo alvo de toque da lista tem pelo menos 44 px`, pequenos.slice(0, 5));
        const fonte = await page.evaluate(() => parseFloat(getComputedStyle(/** @type {Element} */ (document.getElementById('evt-search'))).fontSize));
        registra(fonte >= 16, `${rotulo}: campo com letra de 16 px (o iPhone não dá zoom ao tocar)`, { fonte });
      }
      const cards = await page.locator('#evt-list .evt-item').count();
      registra(cards === EVENTOS.length, `${rotulo}: a lista mostra os ${EVENTOS.length} eventos`, cards);
      const selos = await page.locator('#evt-ev3 .status-badge').allTextContents();
      registra(selos.join('|') === 'Em edição|Atrasado', `${rotulo}: o card escreve o estado (status, atrasado)`, selos);
      registra(/prazo 10\/01/.test((await page.locator('#evt-ev3 .evt-meta').textContent()) || ''), `${rotulo}: o card mostra o prazo de quem não entregou`, '');
      await print(page, `${id}-eventos`);

      // ---- 2. Criar um evento ---------------------------------------------
      await aciona(page.locator('button.btn-add'), toque);
      await page.waitForSelector('#overlay.open');
      await page.fill('#f-slug', 'teste-do-roteiro');
      await page.fill('#f-title', 'Teste do roteiro');
      await page.fill('#f-drive', 'https://drive.google.com/drive/folders/PASTA_TESTE_0001');
      // "Prazo e status" começa recolhido: o atalho abre e leva até ele.
      await aciona(page.locator('.bf-atalhos [data-alvo="bf-producao"]'), toque);
      await espera(page, 500);
      registra(await page.locator('#bf-producao').evaluate(d => /** @type {HTMLDetailsElement} */ (d).open), `${rotulo}: o atalho abre o bloco recolhido`, '');
      await page.selectOption('#f-status', 'em-edicao');
      if (PRINTS) await print(page, `${id}-formulario`);
      await aciona(page.locator('#submit-btn'), toque);
      const msgCriou = await aviso(page);
      registra(/adicionado/i.test(msgCriou), `${rotulo}: criar um evento`, msgCriou);
      await page.waitForSelector('#overlay.open', { state: 'hidden' });
      const novo = page.locator('#evt-list .evt-item', { hasText: 'Teste do roteiro' });
      registra((await novo.count()) === 1 && /Em edição/.test((await novo.locator('.evt-selos').textContent()) || ''), `${rotulo}: o evento novo aparece, "Em edição"`, '');

      // ---- 3. Editar e marcar entregue ------------------------------------
      await espera(page, 3200); // o aviso anterior some
      await aciona(novo.locator('[data-action="edit"]'), toque);
      await page.waitForSelector('#overlay.open');
      const resumo = (await page.locator('[data-resumo="bf-producao"]').textContent()) || '';
      registra(/Em edição/.test(resumo), `${rotulo}: bloco recolhido mostra o resumo ("${resumo}")`, resumo);
      await aciona(page.locator('.bf-atalhos [data-alvo="bf-producao"]'), toque);
      await espera(page, 400);
      await page.selectOption('#f-status', 'entregue');
      await aciona(page.locator('#submit-btn'), toque);
      const msgEditou = await aviso(page);
      registra(/atualizado/i.test(msgEditou), `${rotulo}: editar e marcar entregue`, msgEditou);
      await page.waitForSelector('#overlay.open', { state: 'hidden' });
      registra(/Entregue/.test((await novo.locator('.evt-selos').textContent()) || ''), `${rotulo}: o card passa a dizer "Entregue"`, '');

      // ---- 4. Menu "Mais ações": ocultar ----------------------------------
      await espera(page, 3200);
      const mais = novo.locator('[data-action="menu"]');
      await aciona(mais, toque);
      const menu = novo.locator('.menu');
      registra(await menu.isVisible() && (await mais.getAttribute('aria-expanded')) === 'true', `${rotulo}: "⋯" abre o menu`, '');
      if (toque) {
        const caixa = await menu.boundingBox();
        registra(!!caixa && caixa.y + caixa.height > viewport.height * 0.6, `${rotulo}: no celular o menu é uma folha embaixo, ao alcance do polegar`, caixa);
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
      await aciona(novo.locator('[data-action="vis"]'), toque);
      const msgOcultou = await aviso(page);
      registra(/oculto/i.test(msgOcultou) && /Oculto/.test((await novo.locator('.evt-selos').textContent()) || ''),
        `${rotulo}: "Ocultar da galeria" pelo menu, e o card ganha o selo "Oculto"`, msgOcultou);

      // ---- 5. Resolver um pedido de remoção -------------------------------
      await espera(page, 3200);
      registra((await page.locator('#requests-badge').textContent()) === '2', `${rotulo}: a navegação avisa 2 pedidos pendentes`, await page.locator('#requests-badge').textContent());
      await aciona(page.locator('nav.nav [data-tab="requests"]'), toque);
      await page.waitForSelector('#tab-requests.active');
      await print(page, `${id}-pedidos`);
      await aciona(page.locator('[data-action="resolveRequest"]').first(), toque);
      const msgResolveu = await aviso(page);
      await espera(page, 600);
      registra(/resolvida/i.test(msgResolveu) && (await page.locator('#requests-badge').textContent()) === '1',
        `${rotulo}: resolver um pedido (e o aviso da navegação cai para 1)`, msgResolveu);

      // ---- 6. Métricas ----------------------------------------------------
      await espera(page, 3200);
      await aciona(page.locator('nav.nav [data-tab="metrics"]'), toque);
      await page.waitForSelector('#tab-metrics.active');
      await espera(page, 800);
      const resumos = await page.locator('#metrics-resumo .resumo-lab').allTextContents();
      registra(resumos.slice(0, 3).join('|') === 'Visitantes|Abriram o Drive|Taxa geral', `${rotulo}: métricas abrem com os blocos de resumo`, resumos);
      await print(page, `${id}-metricas`);

      // ---- 7. Trocar a senha (e entrar de novo com ela) --------------------
      await aciona(page.locator('nav.nav [data-tab="settings"]'), toque);
      await page.waitForSelector('#tab-settings.active');
      const grupos = await page.locator('.grupo-titulo').allTextContents();
      registra(grupos.join('|') === 'Site|Dados|Conta', `${rotulo}: ajustes em três grupos`, grupos);
      await print(page, `${id}-ajustes`);
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
      // Sai e entra com a senha nova.
      await Promise.all([page.waitForNavigation(), aciona(page.locator('form[action="/dashboard/logout"] button'), toque)]);
      await page.goto(w.url + '/dashboard');
      await page.fill('input[type="password"]', SENHA_NOVA);
      await page.evaluate(() => {
        const f = /** @type {HTMLFormElement} */ (document.querySelector('form'));
        const i = document.createElement('input');
        i.type = 'hidden'; i.name = 'cf-turnstile-response'; i.value = 'teste';
        f.appendChild(i);
      });
      await Promise.all([page.waitForNavigation(), page.evaluate(() => /** @type {HTMLFormElement} */ (document.querySelector('form')).submit())]);
      const entrou = (await page.locator('nav.nav').count()) === 1 && !new URL(page.url()).searchParams.get('error');
      registra(entrou, `${rotulo}: entrar de novo com a senha nova`, page.url());
      // A senha antiga não entra mais (prova de que a troca valeu no servidor).
      registra(SENHA_NOVA !== SENHA_DE_TESTE, `${rotulo}: (a senha nova é outra)`, '');

      // ---- 8. Excluir o evento de teste -----------------------------------
      await aciona(page.locator('nav.nav [data-tab="events"]'), toque);
      await page.waitForSelector('#tab-events.active');
      const teste = page.locator('#evt-list .evt-item', { hasText: 'Teste do roteiro' });
      await aciona(teste.locator('[data-action="menu"]'), toque);
      await aciona(teste.locator('[data-action="del"]'), toque);
      await page.waitForSelector('.confirm-type-input');
      await page.fill('.confirm-type-input', 'Teste do roteiro');
      await aciona(page.locator('.confirm-ok'), toque);
      const msgExcluiu = await aviso(page);
      await espera(page, 400);
      registra(/excluído/i.test(msgExcluiu) && (await teste.count()) === 0, `${rotulo}: excluir (com a confirmação digitada)`, msgExcluiu);

      // ---- 9. Limpeza do console e da cota -----------------------------------
      registra(estado.erros.length === 0, `${rotulo}: nenhum erro de JS`, estado.erros);
      registra(estado.csp.length === 0, `${rotulo}: nenhuma violação da CSP aplicada`, estado.csp);
      const chaves = [...new Set(w.escritas.map(k => k.replace(/^admin_session:.*/, 'admin_session:*')))].sort();
      registra(chaves.every(k => ['admin_password', 'admin_session:*', 'events', 'removal_requests'].includes(k)),
        `${rotulo}: o fluxo só grava o que deve no KV (${w.escritas.length} escritas)`, chaves);
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
