// Roteiro do ENVIO PELO SITE num Chromium de verdade, em tela de celular:
// escolher muitas fotos, agrupar por dia, sugerir o evento, enviar em partes,
// cair a rede no meio, recarregar a página e retomar, não duplicar.
//
//   npm run verifica:envio
//
// Sobe o `src/index.js` DE VERDADE (scripts/worker-local.mjs) com a credencial
// do envio ligada e o Google SIMULADO no `externo`: o token, a lista das
// pastas do álbum, a pergunta "já existe este fp?", o espaço livre e a sessão
// de envio retomável (308 + Range até o fim, 200 no fim). Cada byte que chega
// ao "Drive" fica guardado, e o roteiro confere que o arquivo inteiro chegou,
// na pasta certa, com o crédito certo, uma vez só.
//
// O que ele NÃO prova (e o PR diz): o Google de verdade (escopo do token, a
// resposta real a uma sessão vencida), o que o iPhone entrega do seletor de
// fotos (HEIC convertido, Live Photo) e o Turnstile de verdade — o daqui é
// de mentira, como nos outros roteiros.
//
// Qualquer mensagem de CSP no console é FALHA (scripts/vigia-csp.mjs).

// As funções passadas a evaluate rodam DENTRO do Chromium.
/* global document, window */
import { existsSync, readdirSync } from 'node:fs';
import { chromium } from 'playwright-core';
import { sobeWorker } from './worker-local.mjs';
import { vigiaCsp, provaOVigia } from './vigia-csp.mjs';
import { verificaAxe } from './axe.mjs';
import { registraResumo } from '../src/drive.js';
import { fakeCaches } from '../tests/helpers/caches.js';

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

/** @param {string} nome @param {() => Promise<void>} fn */
async function cenario(nome, fn) {
  try {
    await fn();
  } catch (e) {
    registra(false, `${nome}: o cenário quebrou no meio`, String(e instanceof Error ? e.message : e).split('\n')[0]);
  }
}

// ---------------------------------------------------------------------------
// O álbum e o Google simulado
// ---------------------------------------------------------------------------

const RAIZ = 'RAIZ_PASTA_0001';
const ENVIO = '!turma 2026 (adicione suas fotos aqui)';
const PASTA_FORMATURA = 'ENVIO_A_00001';
const PASTA_INTERCLASSE = 'ENVIO_B25_001';
const pasta = (/** @type {string} */ id, /** @type {string} */ nome) => ({ id, name: nome, mimeType: 'application/vnd.google-apps.folder' });
/** @type {Record<string, any[]>} */
const ARVORE = {
  [RAIZ]: [pasta('EVA_PASTA_0001', '01 - Formatura'), pasta('EVB_PASTA_0001', '02 - Interclasse')],
  EVA_PASTA_0001: [pasta('EVA_CHALA_01', 'chala'), pasta(PASTA_FORMATURA, ENVIO)],
  EVB_PASTA_0001: [pasta('EVB_2025_0001', '2025')],
  EVB_2025_0001: [pasta('B25_CHALA_01', 'chala'), pasta(PASTA_INTERCLASSE, ENVIO)],
};
const EVENTO = {
  id: '1', slug: 'entrenos2026', title: 'Entre Nós', status: 'entregue', accessType: 'public', visible: true, comingSoon: false,
  galeriaCapitulos: true, driveUrl: `https://drive.google.com/drive/folders/${RAIZ}`, photos: [], date: '2026-12-01',
  galeriaCreditos: `chala = Luca F. Chala\n${ENVIO} = Turma 2026\n* = Turma 2026`,
};

/**
 * @typedef {{ id: string, total: number, recebido: number, partes: Buffer[], meta: any, tipo: string, feito: boolean }} Sessao
 */
const G = {
  /** @type {Map<string, Sessao>} */
  sessoes: new Map(),
  seq: 0,
  /** @type {Map<string, string>} fp → id do arquivo no "Drive" */
  noDrive: new Map(),
  tokens: 0,
  partes: 0,
};

/** @param {URL} url @param {RequestInit | undefined} init */
async function googleFalso(url, init) {
  const metodo = String(init && init.method || 'GET').toUpperCase();
  const cab = new Headers(init && init.headers ? init.headers : {});
  if (url.host === 'oauth2.googleapis.com') { G.tokens++; return Response.json({ access_token: `ya29.roteiro${G.tokens}`, expires_in: 3599 }); }
  if (url.host !== 'www.googleapis.com') return null;
  if (url.pathname === '/drive/v3/files') {
    const q = url.searchParams.get('q') || '';
    if (q.includes('appProperties')) {
      const fp = q.match(/value='([a-f0-9]+)'/)?.[1] || '';
      const id = G.noDrive.get(fp);
      return Response.json({ files: id ? [{ id }] : [] });
    }
    const id = q.match(/^'([^']+)' in parents/)?.[1] || '';
    return Response.json({ files: ARVORE[id] || [] });
  }
  if (url.pathname === '/drive/v3/about') return Response.json({ storageQuota: { limit: String(100 * 1024 ** 3), usage: String(1024 ** 3) } });
  if (url.pathname === '/upload/drive/v3/files') {
    const id = url.searchParams.get('upload_id');
    if (!id) {
      const novo = `U${++G.seq}`;
      G.sessoes.set(novo, {
        id: novo, total: Number(cab.get('X-Upload-Content-Length')), recebido: 0, partes: [],
        meta: JSON.parse(String(init && init.body)), tipo: cab.get('X-Upload-Content-Type') || '', feito: false,
      });
      return new Response(null, { status: 200, headers: { Location: `https://www.googleapis.com/upload/drive/v3/files?uploadType=resumable&upload_id=${novo}` } });
    }
    const s = G.sessoes.get(id);
    if (!s) return new Response('Not Found', { status: 404 });
    if (metodo === 'DELETE') { G.sessoes.delete(id); return new Response(null, { status: 499 }); }
    const faixa = cab.get('Content-Range') || '';
    const andamento = () => new Response(null, { status: 308, headers: s.recebido ? { Range: `bytes=0-${s.recebido - 1}` } : {} });
    if (/^bytes \*\//.test(faixa)) return s.feito ? Response.json({ id: `ARQ_${id}` }) : andamento();
    const m = /^bytes (\d+)-(\d+)\/(\d+)$/.exec(faixa);
    if (!m || Number(m[1]) !== s.recebido) return new Response('fora de posição', { status: 400 });
    const bytes = Buffer.from(await new Response(/** @type {any} */ (init && init.body)).arrayBuffer());
    G.partes++;
    s.partes.push(bytes);
    s.recebido = Number(m[2]) + 1;
    if (s.recebido < s.total) return andamento();
    s.feito = true;
    G.noDrive.set(s.meta.appProperties.fp, `ARQ_${id}`);
    return Response.json({ id: `ARQ_${id}` });
  }
  return null;
}

/** O que chegou ao "Drive" com este nome (a última sessão dele). @param {string} nome */
const noDrive = nome => [...G.sessoes.values()].filter(s => s.meta.name === nome);
/** @param {Sessao} s */
const bytesDe = s => Buffer.concat(s.partes);

// ---------------------------------------------------------------------------
// Os arquivos
// ---------------------------------------------------------------------------

/**
 * Um "JPEG": o começo certo, a data de captura como o EXIF a guarda (texto
 * "AAAA:MM:DD hh:mm:ss") e o resto com conteúdo que muda com `semente` (cada
 * arquivo tem a sua impressão digital).
 * @param {number} tamanho @param {string} data '' para foto sem data @param {number} semente
 */
function jpeg(tamanho, data, semente) {
  const b = Buffer.alloc(tamanho);
  for (let i = 0; i < tamanho; i += 4096) b[i] = (i / 4096 + semente * 31) % 256;
  b[tamanho - 1] = semente % 256;
  Buffer.from([0xff, 0xd8, 0xff, 0xe1, 0x00, 0x40]).copy(b, 0);
  Buffer.from(`Exif\0\0MM${semente}`).copy(b, 6);
  if (data) Buffer.from(data, 'latin1').copy(b, 64);
  return b;
}
const MB = 1024 * 1024;
const A = { name: 'IMG_0001.jpg', mimeType: 'image/jpeg', buffer: jpeg(700 * 1024, '2025:06:14 21:03:11', 1) };
const B = { name: 'IMG_0002.jpg', mimeType: 'image/jpeg', buffer: jpeg(500 * 1024, '2025:06:14 22:15:00', 2) };
const C = { name: 'IMG_0003.jpg', mimeType: 'image/jpeg', buffer: jpeg(300 * 1024, '2025:12:12 19:00:00', 3) };
const D = { name: 'print.jpg', mimeType: 'image/jpeg', buffer: jpeg(200 * 1024, '', 4) };
const A_DE_NOVO = { ...A, name: 'IMG_0001 (1).jpg' };
const EXE = { name: 'programa.exe', mimeType: 'application/octet-stream', buffer: Buffer.from('MZ\x90\0isto não é foto') };
const GRANDE = { name: 'VID_0005.jpg', mimeType: 'image/jpeg', buffer: jpeg(9 * MB + 123, '2025:12:12 20:00:00', 5) };
const GRANDE2 = { name: 'VID_0006.jpg', mimeType: 'image/jpeg', buffer: jpeg(9 * MB + 77, '2025:12:12 20:30:00', 6) };
const GRANDE3 = { name: 'VID_0007.jpg', mimeType: 'image/jpeg', buffer: jpeg(9 * MB + 55, '2025:12:12 21:00:00', 7) };

// Turnstile de mentira, como o widget gerenciado de verdade: entrega a ficha
// sozinho depois do render, e uma nova a cada reset.
const TURNSTILE_FALSO = `window.turnstile = {
  render(sel, o) { window.__o = o; setTimeout(function () { o.callback('tok' + Math.random()); }, 150); return 'w1'; },
  reset() { var o = window.__o; if (o) setTimeout(function () { o.callback('tok' + Math.random()); }, 150); },
  execute() {}, remove() {}, getResponse() { return ''; },
};`;

// ---------------------------------------------------------------------------
// Sobe tudo
// ---------------------------------------------------------------------------

// A Cache API não existe fora do workerd; os dias do evento (`dd`, o que faz
// a página sugerir o evento pela data da foto) moram no resumo, que mora nela.
/** @type {any} */ (globalThis).caches = fakeCaches();
/** Uma foto da listagem, com a hora AAAAMMDDhhmmss. @param {number} hora @param {number} i */
const fotoDaLista = (hora, i) => [`FOTO_${String(i).padStart(9, '0')}`, 10, 10, `${i}.jpg`, 100, 0, hora];
/** @param {number} hora */
const listagem = hora => /** @type {any} */ ({
  v: 3, pasta: 'x', em: new Date().toISOString(), truncada: false, total: 10, videos: 0, outros: 0, rk: {}, aut: ['Turma'],
  secoes: [{ nome: '', caminho: '', fotos: Array.from({ length: 10 }, (_, i) => fotoDaLista(hora, i)) }],
});
await registraResumo(RAIZ, 'EVA_PASTA_0001', listagem(20251212200000));
await registraResumo(RAIZ, 'EVB_PASTA_0001', listagem(20250614210000));

const w = await sobeWorker({
  kv: { events: JSON.stringify([EVENTO]) },
  env: {
    GOOGLE_DRIVE_API_KEY: 'AIzaChaveDoRoteiro',
    GOOGLE_OAUTH_CLIENT_ID: 'roteiro.apps.googleusercontent.com',
    GOOGLE_OAUTH_CLIENT_SECRET: 'segredo-do-roteiro',
    GOOGLE_OAUTH_REFRESH_TOKEN: '1//roteiro',
  },
  externo: (url, init) => googleFalso(url, init),
});
const PAGINA = `${w.url}/galeria/entrenos2026/enviar`;

const browser = await chromium.launch({ executablePath: chromiumLocal() });
await provaOVigia(browser, registra);

/**
 * Um aparelho novo (IndexedDB e sessionStorage vazios).
 * @param {{ viewport?: { width: number, height: number }, celular?: boolean }} [o]
 */
async function aparelho(o = {}) {
  const celular = o.celular !== false;
  const ctx = await browser.newContext({ viewport: o.viewport || { width: 390, height: 844 }, deviceScaleFactor: 1, hasTouch: celular, isMobile: celular });
  const page = await ctx.newPage();
  const estado = { erros: /** @type {string[]} */ ([]), csp: /** @type {string[]} */ ([]), pedidos: /** @type {string[]} */ ([]) };
  page.on('pageerror', e => estado.erros.push(String(e).slice(0, 200)));
  vigiaCsp(page, estado.csp);
  page.on('request', r => { const u = new URL(r.url()); if (u.pathname.startsWith('/api/envio/')) estado.pedidos.push(`${r.method()} ${u.pathname}`); });
  if (process.env.VERIFICA_DEBUG) page.on('response', async r => { const u = new URL(r.url()); if (u.pathname.startsWith('/api/envio/')) console.log('DEBUG', r.status(), u.pathname, (await r.text().catch(() => '')).slice(0, 200)); });
  await page.route(/challenges\.cloudflare\.com/, r => r.fulfill({ contentType: 'text/javascript', body: TURNSTILE_FALSO }));
  return { ctx, page, estado };
}

/** @param {import('playwright-core').Page} page */
const textoDe = async (/** @type {import('playwright-core').Page} */ page, /** @type {string} */ sel) => ((await page.locator(sel).textContent().catch(() => '')) || '').trim();
/** Espera o estado do envio dizer `re`. @param {import('playwright-core').Page} page @param {RegExp} re @param {number} [ms] */
async function esperaEstado(page, re, ms = 60_000) {
  const fim = Date.now() + ms;
  while (Date.now() < fim) {
    if (re.test(await textoDe(page, '#ev-estado'))) return true;
    await page.waitForTimeout(200);
  }
  return false;
}
/** Escolhe arquivos e espera a leitura terminar. @param {import('playwright-core').Page} page @param {any[]} arquivos */
async function escolhe(page, arquivos) {
  await page.waitForSelector('#ev-escolher:not([disabled])', { timeout: 10_000 });
  await page.setInputFiles('#ev-arq', arquivos);
  await page.waitForFunction(() => !(/** @type {HTMLButtonElement} */ (document.getElementById('ev-escolher'))).disabled && !/Lendo/.test(document.getElementById('ev-leitura')?.textContent || ''), null, { timeout: 30_000 });
}
/**
 * Confirma a declaração e toca em Enviar. O `form_token` da página só vale 3 s
 * depois de emitido (piso contra robô, FORM_TOKEN_MIN_AGE_SECS): ninguém
 * escolhe fotos e confere eventos mais rápido que isso, mas o roteiro sim.
 * @param {import('playwright-core').Page} page
 */
async function envia(page, nome = '', { espera = true } = {}) {
  if (espera) await page.waitForTimeout(3200);
  if (nome) await page.fill('#ev-nome', nome);
  if (!(await page.isChecked('#ev-aceite'))) await page.locator('label.ev-check').tap();
  await page.locator('#ev-enviar').tap();
}
/** Os grupos da revisão: dia, contagem, evento escolhido e a sugestão. @param {import('playwright-core').Page} page */
const grupos = page => page.$$eval('.ev-grupo', gs => gs.map(g => ({
  dia: g.querySelector('.ev-grupo-t')?.textContent || '',
  n: g.querySelector('.ev-grupo-n')?.textContent || '',
  evento: (() => { const s = /** @type {HTMLSelectElement} */ (g.querySelector('select')); return s.selectedIndex > 0 ? s.options[s.selectedIndex].textContent : ''; })(),
  sug: g.querySelector('.ev-sug')?.textContent || '',
})));

/** Alvos de toque com menos de 44 px de altura, entre os visíveis. @param {import('playwright-core').Page} page */
const alvosPequenos = page => page.$$eval('#ev button, #ev select, #ev input[type=text]:not(#ev-hp), #ev a.ev-btn, #ev .ev-check', els => els
  .filter(e => /** @type {HTMLElement} */ (e).offsetParent !== null)
  .map(e => ({ q: e.id || e.className, h: Math.round(e.getBoundingClientRect().height) }))
  .filter(x => x.h < 44));

/** Erros de JS e mensagens de CSP de um aparelho. @param {string} rotulo @param {{ erros: string[], csp: string[] }} estado */
function semErros(rotulo, estado) {
  registra(estado.erros.length === 0, `${rotulo}: nenhum erro de JavaScript`, estado.erros);
  registra(estado.csp.length === 0, `${rotulo}: nenhuma mensagem de CSP no console`, estado.csp);
}

// ---------------------------------------------------------------------------
// 1. A página, a escolha, os grupos por dia e a sugestão do evento
// ---------------------------------------------------------------------------
await cenario('Escolher e enviar', async () => {
  const { ctx, page, estado } = await aparelho();
  await page.goto(PAGINA);
  await page.waitForSelector('#ev-escolher:not([disabled])', { timeout: 10_000 });
  const largura = await page.evaluate(() => ({ doc: document.documentElement.scrollWidth, tela: window.innerWidth }));
  registra(largura.doc <= largura.tela, 'Página: sem rolagem lateral no celular (390 px)', largura);
  registra(estado.pedidos.length === 0, 'Página: nada é pedido ao servidor antes de escolher fotos', estado.pedidos);
  await verificaAxe(page, registra, 'Página de envio: antes de escolher');

  await escolhe(page, [A, B, C, D, EXE, A_DE_NOVO]);
  const leitura = await textoDe(page, '#ev-leitura');
  registra(/1 repetido ignorado/.test(leitura) && /1 arquivo que não é foto nem vídeo/.test(leitura),
    'Escolha: o repetido (mesmo conteúdo, outro nome) e o que não é foto ficam de fora, com aviso', leitura);
  const g = await grupos(page);
  registra(g.length === 3, 'Revisão: um grupo por dia (14/jun, 12/dez e o de hoje)', g);
  registra(/^14 de junho de 2025$/.test(g[0]?.dia) && /2 fotos/.test(g[0]?.n) && g[0]?.evento === 'Interclasse · 2025' && /Sugerido pela data/.test(g[0]?.sug),
    'Revisão: as fotos de 14/jun/2025 vêm com o Interclasse sugerido pela data', g[0]);
  registra(/^12 de dezembro de 2025$/.test(g[1]?.dia) && g[1]?.evento === 'Formatura', 'Revisão: a de 12/dez/2025 vem com a Formatura', g[1]);
  registra(g[2]?.evento === '', 'Revisão: a foto do dia de hoje (sem data no arquivo) fica sem evento, para a pessoa escolher', g[2]);
  registra(await textoDe(page, '#ev-enviar') === 'Enviar 4 arquivos', 'Revisão: o botão diz quantos arquivos vão', await textoDe(page, '#ev-enviar'));
  const pequenos = await alvosPequenos(page);
  registra(pequenos.length === 0, 'Revisão: todo alvo de toque tem 44 px ou mais', pequenos);
  await verificaAxe(page, registra, 'Página de envio: revisão');

  await page.locator('#ev-enviar').tap();
  const semEvento = await textoDe(page, '#ev-rev-msg');
  const invalido = await page.locator('.ev-grupo select[aria-invalid="true"]').count();
  registra(/Escolha o evento de cada dia/.test(semEvento) && invalido === 1 && G.sessoes.size === 0, 'Revisão: sem evento num dia, não envia nada e marca o campo', { semEvento, invalido });
  await page.locator('.ev-grupo select').nth(2).selectOption({ label: 'Formatura' });
  await page.locator('#ev-enviar').tap();
  registra(/Marque a caixa/.test(await textoDe(page, '#ev-rev-msg')) && G.sessoes.size === 0, 'Revisão: sem a declaração marcada, não envia', await textoDe(page, '#ev-rev-msg'));

  await envia(page, 'Ana Souza');
  const pronto = await esperaEstado(page, /Pronto! Tudo enviado/);
  registra(pronto, 'Envio: termina com "Pronto! Tudo enviado."', await textoDe(page, '#ev-estado'));
  registra(await textoDe(page, '#ev-num') === '4 de 4 arquivos', 'Envio: 4 de 4', await textoDe(page, '#ev-num'));
  const verAlbum = await page.locator('#ev-ver').isVisible();
  registra(verAlbum, 'Envio: no fim aparece "Ver o álbum"', '');
  const conferidos = [[A, PASTA_INTERCLASSE], [B, PASTA_INTERCLASSE], [C, PASTA_FORMATURA], [D, PASTA_FORMATURA]].map(([arq, destino]) => {
    const ss = noDrive(/** @type {any} */ (arq).name);
    const s = ss[0];
    return {
      nome: /** @type {any} */ (arq).name, sessoes: ss.length,
      inteiro: !!s && s.feito && bytesDe(s).equals(/** @type {any} */ (arq).buffer),
      pasta: s && s.meta.parents[0] === destino,
      credito: s && s.meta.description === 'Crédito: Ana Souza\nEnviado pelo site do álbum.',
      tipo: s && s.tipo === 'image/jpeg',
    };
  });
  registra(conferidos.every(c => c.sessoes === 1 && c.inteiro && c.pasta && c.credito && c.tipo),
    'Drive: cada arquivo chegou inteiro, uma vez, na pasta do evento escolhido, com o crédito e o tipo', conferidos);
  registra(estado.pedidos.filter(p => p.endsWith('/passe')).length === 1, 'Envio: um passe (um Turnstile) para os 4 arquivos', estado.pedidos.filter(p => p.endsWith('/passe')));
  await verificaAxe(page, registra, 'Página de envio: terminado');

  // ---- Os mesmos arquivos de novo, no mesmo aparelho ----
  await page.reload();
  await escolhe(page, [A]);
  const jaFoi = await textoDe(page, '#ev-leitura');
  registra(/1 já foi enviado deste aparelho/.test(jaFoi), 'Mesmo aparelho: a foto já enviada é reconhecida na leitura', jaFoi);
  semErros('Escolher e enviar', estado);
  await ctx.close();
});

// ---------------------------------------------------------------------------
// 1b. O passe recusado para TUDO, com o motivo, e "Tentar de novo" destrava
// ---------------------------------------------------------------------------
await cenario('Passe recusado', async () => {
  const { ctx, page, estado } = await aparelho();
  await page.goto(`${PAGINA}?evento=formatura`);
  const antes = G.sessoes.size;
  const arq = { name: 'IMG_0099.jpg', mimeType: 'image/jpeg', buffer: jpeg(200 * 1024, '2025:12:12 18:00:00', 99) };
  // Rápido demais (o form_token ainda não tem 3 s): o servidor recusa o passe.
  await escolhe(page, [arq]);
  await envia(page, '', { espera: false });
  const parou = await esperaEstado(page, /Não foi possível validar/, 15_000);
  const problemas = await textoDe(page, '#ev-problemas');
  registra(parou && problemas === '' && G.sessoes.size === antes,
    'Passe recusado: a página para e mostra o motivo do servidor, sem marcar a foto como recusada', { estado: await textoDe(page, '#ev-estado'), problemas });
  registra(await page.locator('#ev-repetir').isVisible(), 'Passe recusado: aparece "Tentar de novo"', '');
  await page.waitForTimeout(3200);
  await page.locator('#ev-repetir').tap();
  const pronto = await esperaEstado(page, /Pronto! Tudo enviado/);
  const s = noDrive(arq.name);
  registra(pronto && s.length === 1 && bytesDe(s[0]).equals(arq.buffer), '"Tentar de novo" pede outro passe e envia', { pronto, sessoes: s.length });
  semErros('Passe recusado', estado);
  await ctx.close();
});

// ---------------------------------------------------------------------------
// 2. Não duplicar, de outro aparelho
// ---------------------------------------------------------------------------
await cenario('Duplicata', async () => {
  const { ctx, page, estado } = await aparelho();
  await page.goto(PAGINA);
  const antes = G.sessoes.size;
  await escolhe(page, [A, B]);
  await envia(page);
  await esperaEstado(page, /Pronto/);
  const det = await textoDe(page, '#ev-det');
  registra(G.sessoes.size === antes && /2 já estavam no álbum/.test(det) && await textoDe(page, '#ev-num') === '2 de 2 arquivos',
    'Outro aparelho: o que já está no Drive não vai de novo (nenhuma sessão nova) e a página diz', { det, sessoes: G.sessoes.size - antes });
  semErros('Duplicata', estado);
  await ctx.close();
});

// ---------------------------------------------------------------------------
// 3. Queda de rede no meio
// ---------------------------------------------------------------------------
await cenario('Queda de rede', async () => {
  const { ctx, page, estado } = await aparelho();
  await page.goto(`${PAGINA}?evento=formatura`);
  // Uma parte se perde no caminho (a rede caiu com ela no ar).
  let abortadas = 0;
  await page.route(/\/api\/envio\/parte/, async r => {
    const pos = Number(new URL(r.request().url()).searchParams.get('pos'));
    if (pos > 0 && abortadas === 0) { abortadas++; return r.abort('connectionreset'); }
    return r.continue();
  });
  await escolhe(page, [GRANDE]);
  const g = await grupos(page);
  registra(g[0]?.evento === 'Formatura' && g[0]?.sug === '', 'Link com ?evento=: o evento de onde a pessoa veio já vem escolhido', g);
  await envia(page);
  const pronto = await esperaEstado(page, /Pronto! Tudo enviado/, 90_000);
  const s = noDrive(GRANDE.name);
  const estados = estado.pedidos.filter(p => p.endsWith('/estado')).length;
  registra(pronto && abortadas === 1 && s.length === 1 && bytesDe(s[0]).equals(GRANDE.buffer),
    'Parte perdida: a página pergunta onde parou e termina o arquivo inteiro, numa sessão só', { pronto, abortadas, sessoes: s.length, perguntas: estados });
  registra(estados >= 1, 'Parte perdida: a retomada passa por /api/envio/estado (a posição do Google é a que vale)', estado.pedidos);

  // ---- Sem internet: avisa, e segue sozinho quando volta ----
  await page.unroute(/\/api\/envio\/parte/);
  let liberar = /** @type {() => void} */ (() => {});
  const segura = new Promise(ok => { liberar = () => ok(undefined); });
  let seguradas = 0;
  await page.route(/\/api\/envio\/parte/, async r => {
    const pos = Number(new URL(r.request().url()).searchParams.get('pos'));
    if (pos > 0 && seguradas === 0) { seguradas++; await segura; return r.abort('internetdisconnected'); }
    return r.continue();
  });
  await escolhe(page, [GRANDE2]);
  await envia(page);
  await page.waitForFunction(() => /\d+%/.test(document.getElementById('ev-agora')?.textContent || ''), null, { timeout: 30_000 });
  while (seguradas === 0) await page.waitForTimeout(100);
  await ctx.setOffline(true);
  liberar();
  const avisou = await esperaEstado(page, /Sem internet|não foi/, 20_000);
  const aviso = await textoDe(page, '#ev-estado');
  await ctx.setOffline(false);
  const voltou = await esperaEstado(page, /Pronto! Tudo enviado/, 90_000);
  const s2 = noDrive(GRANDE2.name);
  registra(avisou, 'Sem internet: a página avisa', aviso);
  registra(voltou && s2.length === 1 && bytesDe(s2[0]).equals(GRANDE2.buffer), 'Sem internet: quando a rede volta, o envio segue sozinho e termina inteiro', { voltou, sessoes: s2.length });
  semErros('Queda de rede', estado);
  await ctx.close();
});

// ---------------------------------------------------------------------------
// 4. Recarregar a página no meio e retomar de onde parou
// ---------------------------------------------------------------------------
await cenario('Recarregar e retomar', async () => {
  const { ctx, page, estado } = await aparelho();
  await page.goto(PAGINA);
  // A segunda parte fica presa no caminho (rede lenta): dá tempo de pausar
  // com o arquivo pela metade. Na rede local ele terminaria antes do toque.
  await page.route(/\/api\/envio\/parte/, async r => {
    if (Number(new URL(r.request().url()).searchParams.get('pos')) > 0) return; // nunca responde; a pausa aborta
    return r.continue();
  });
  await escolhe(page, [GRANDE3]);
  await envia(page);
  const fim = Date.now() + 30_000;
  while (Date.now() < fim && !(noDrive(GRANDE3.name)[0]?.recebido > 0)) await page.waitForTimeout(100);
  await page.waitForTimeout(300);
  await page.locator('#ev-pausar').tap();
  await page.unroute(/\/api\/envio\/parte/);
  await page.waitForTimeout(500);
  const recebidoAntes = noDrive(GRANDE3.name)[0]?.recebido || 0;
  registra(/Pausado/.test(await textoDe(page, '#ev-estado')) && recebidoAntes > 0 && recebidoAntes < GRANDE3.buffer.length,
    'Pausar: para no meio, com parte do arquivo já no Drive', { recebidoAntes, total: GRANDE3.buffer.length });

  await page.reload();
  await page.waitForSelector('#ev-escolher:not([disabled])', { timeout: 10_000 });
  const pend = await page.locator('#ev-pend').isVisible();
  registra(pend && /1 arquivo ficou pela metade/.test(await textoDe(page, '#ev-pend-txt')), 'Recarregar: a página lembra o envio pela metade', await textoDe(page, '#ev-pend-txt'));
  const passesAntes = estado.pedidos.filter(p => p.endsWith('/passe')).length;
  await escolhe(page, [GRANDE3]);
  const g = await grupos(page);
  registra(/Continuando o envio de antes/.test(g[0]?.sug) && g[0]?.evento === 'Formatura', 'Recarregar: as mesmas fotos voltam com o evento de antes', g);
  await envia(page);
  const pronto = await esperaEstado(page, /Pronto! Tudo enviado/, 90_000);
  const ss = noDrive(GRANDE3.name);
  registra(pronto && ss.length === 1 && bytesDe(ss[0]).equals(GRANDE3.buffer),
    'Recarregar: o arquivo continua na MESMA sessão e chega inteiro', { pronto, sessoes: ss.length });
  registra(estado.pedidos.filter(p => p.endsWith('/passe')).length === passesAntes, 'Recarregar: o passe da aba é reaproveitado (sem outro Turnstile)', estado.pedidos);
  semErros('Recarregar e retomar', estado);
  await ctx.close();
});

// ---------------------------------------------------------------------------
// 5. Computador
// ---------------------------------------------------------------------------
await cenario('Computador', async () => {
  const { ctx, page, estado } = await aparelho({ viewport: { width: 1280, height: 800 }, celular: false });
  await page.goto(PAGINA);
  await page.waitForSelector('#ev-escolher:not([disabled])', { timeout: 10_000 });
  const caixa = await page.locator('main.ev').boundingBox();
  registra(!!caixa && caixa.width <= 700, 'Computador: a página fica numa coluna legível', caixa);
  await verificaAxe(page, registra, 'Página de envio: computador');
  semErros('Computador', estado);
  await ctx.close();
});

await browser.close();
await w.fecha();

let falhas = 0;
for (const r of resultados) {
  if (!r.ok) falhas++;
  console.log(`${r.ok ? 'OK   ' : 'FALHA'} ${r.nome}${r.ok || !r.detalhe ? '' : `\n      ${r.detalhe.slice(0, 600)}`}`);
}
console.log(`\n${resultados.length - falhas} ok, ${falhas} falha(s)`);
process.exit(falhas ? 1 : 0);
