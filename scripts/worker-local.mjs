// O Worker DE VERDADE num servidor HTTP local, para os roteiros de navegador.
//
// É o "harness local" do docs/VERIFICACAO.md §2, versionado: roda o
// `src/index.js` sem mudar uma linha, com
//   - KV em memória (um Map; cada escrita fica registrada em `escritas`, para
//     o roteiro provar que uma tela não gasta a cota de 1000/dia — TODO.md);
//   - Durable Objects de verdade (as classes de src/counters.js) sobre
//     armazenamento em memória — os mesmos de tests/helpers/do.js;
//   - o mundo externo INTERCEPTADO: Turnstile aprova, Resend aceita (e
//     anota cada envio em `emails`; a chave recusada da prévia leva 401, como
//     no Resend de verdade), e qualquer outro host recebe 599. Nada sai da
//     máquina, e um fetch novo esquecido aparece como erro em vez de ir à
//     internet.
//
// Precisa do gancho de `cloudflare:workers`:
//   node --import ./scripts/node-com-workers.mjs <roteiro>.mjs
//
// Diferença para o `wrangler dev`: aqui não há workerd, então o que só a
// plataforma garante (atomicidade de DO, Cache API, limites de CPU) NÃO é
// provado — isso é da suíte `workers`. O que este servidor prova é o que o
// navegador vê: HTML, CSP, cookies, rotas e o fluxo de cliques.

/* global document */
import http from 'node:http';
import worker from '../src/index.js';
import { hashPassword } from '../src/utils.js';
import { CHAVE_RESEND_RECUSADA } from '../src/previa.js';
import { withDurableObjects } from '../tests/helpers/do.js';

/** Senha do painel nos roteiros (passa na política de senha do site). */
export const SENHA_DE_TESTE = 'Senha-De-Teste-2026!';

/**
 * @typedef {{
 *   url: string,
 *   kv: Map<string, string>,
 *   escritas: string[],
 *   emails: { para: unknown, assunto: unknown }[],
 *   fecha: () => Promise<void>,
 * }} WorkerLocal
 */

/**
 * Sobe o Worker. `kv` semeia o armazenamento (valores já serializados, como o
 * KV guarda); a senha do painel é semeada sempre, com SENHA_DE_TESTE.
 * `externo` responde a hosts de fora antes do bloqueio padrão (devolva `null`
 * para cair nele).
 * `contadores` semeia o armazenamento do Durable Object dos contadores (as
 * chaves cruas, como `views:<slug>` e `d:<AAAA-MM-DD>:views:<slug>` — ver
 * src/counters.js), para o roteiro de Métricas ter série por dia sem esperar
 * meses de visitas.
 * @param {{
 *   porta?: number,
 *   kv?: Record<string, string>,
 *   contadores?: Record<string, number>,
 *   env?: Record<string, unknown>,
 *   externo?: (url: URL) => Response | Promise<Response> | null,
 * }} [o]
 * @returns {Promise<WorkerLocal>}
 */
export async function sobeWorker(o = {}) {
  /** @type {Map<string, string>} */
  const kv = new Map(Object.entries(o.kv || {}));
  kv.set('admin_password', await hashPassword(SENHA_DE_TESTE));
  /** @type {string[]} */
  const escritas = [];
  /** @type {{ para: unknown, assunto: unknown }[]} */
  const emails = [];
  const FOTOS = {
    /**
     * Uma chave, ou um LOTE de até 100 (`get(chaves[])` devolve um `Map`, como
     * o KV de verdade — a lista de pedidos de remoção lê assim, #198).
     * @param {string | string[]} k @param {string} [tipo]
     */
    async get(k, tipo) {
      /** @param {string} n */
      const um = n => {
        const v = kv.has(n) ? /** @type {string} */ (kv.get(n)) : null;
        return v !== null && tipo === 'json' ? JSON.parse(v) : v;
      };
      if (!Array.isArray(k)) return um(k);
      if (k.length > 100) throw new Error('KV GET_BULK failed: more than 100 keys');
      return new Map(k.map(n => [n, um(n)]));
    },
    /** @param {string} k @param {string} v */
    async put(k, v) { escritas.push(k); kv.set(k, String(v)); },
    /** @param {string} k */
    async delete(k) { kv.delete(k); },
    /** @param {{ prefix?: string }} [opts] */
    async list({ prefix = '' } = {}) {
      return { keys: [...kv.keys()].filter(k => k.startsWith(prefix)).map(name => ({ name })), list_complete: true, cursor: null };
    },
  };
  const env = withDurableObjects({
    FOTOS,
    ADMIN_EMAIL: 'admin@example.com',
    // Com o secret do Turnstile o login segue o caminho de PRODUÇÃO (token
    // exigido). O fetch abaixo aprova qualquer token; `entraNoPainel()` manda um.
    TURNSTILE_SECRET_KEY: 'teste',
    SIGNING_SECRET: 'x'.repeat(40),
    ...(o.env || {}),
  });
  if (o.contadores) {
    // Escreve direto no armazenamento do objeto e o "reinicia": o construtor
    // relê tudo, como o runtime faz depois de uma evicção.
    env.COUNTER.get('contadores');
    const armazenamento = env.COUNTER._instances.get('contadores').ctx.storage;
    for (const [k, v] of Object.entries(o.contadores)) armazenamento._map.set(k, v);
    env.COUNTER._evict('contadores');
  }

  // Troca o fetch GLOBAL: é o que o Worker usa para Turnstile, Resend, Drive…
  // O roteiro roda num processo só para isto, então não há quem mais dependa
  // do fetch original — mas as chamadas ao próprio servidor seguem por ele.
  const fetchOriginal = globalThis.fetch;
  globalThis.fetch = async (entrada, init) => {
    const url = new URL(typeof entrada === 'string' || entrada instanceof URL ? String(entrada) : entrada.url);
    if (url.hostname === '127.0.0.1') return fetchOriginal(entrada, init);
    if (url.host === 'challenges.cloudflare.com') return Response.json({ success: true });
    if (url.host === 'api.resend.com') {
      // Como o Resend de verdade: chave que ele não conhece leva 401 — a
      // simulação "o envio falha" da prévia depende disso. Cada envio aceito
      // fica em `emails`, para o roteiro conferir destinatário e assunto.
      const cab = new Headers(init && init.headers ? init.headers : (entrada instanceof Request ? entrada.headers : {}));
      if (cab.get('Authorization') === `Bearer ${CHAVE_RESEND_RECUSADA}`) {
        return Response.json({ statusCode: 401, message: 'API key is invalid' }, { status: 401 });
      }
      try {
        const corpo = JSON.parse(String(init && init.body ? init.body : '{}'));
        emails.push({ para: corpo.to, assunto: corpo.subject });
      } catch { /* corpo que não é JSON: não é um envio de verdade */ }
      return Response.json({ id: 'teste' });
    }
    const resposta = o.externo ? await o.externo(url) : null;
    if (resposta) return resposta;
    return new Response(`bloqueado no roteiro local: ${url.host}`, { status: 599 });
  };

  /** @type {Promise<unknown>[]} */
  const pendentes = [];
  /** @type {string} */
  let base = '';
  const servidor = http.createServer(async (req, res) => {
    try {
      /** @type {Buffer[]} */
      const pedacos = [];
      for await (const p of req) pedacos.push(p);
      const headers = new Headers();
      for (const [k, v] of Object.entries(req.headers)) {
        if (v !== undefined) headers.set(k, Array.isArray(v) ? v.join(', ') : v);
      }
      // O Worker lê o IP daqui (rate limit por IP); sem ele, tudo cairia num
      // balde "sem IP".
      headers.set('cf-connecting-ip', '203.0.113.10');
      const metodo = req.method || 'GET';
      const request = new Request(base + (req.url || '/'), {
        method: metodo,
        headers,
        body: metodo === 'GET' || metodo === 'HEAD' ? undefined : Buffer.concat(pedacos),
        redirect: 'manual',
      });
      // ctx.waitUntil coletado e aguardado no fim (VERIFICACAO §2, pegadinha 2).
      const ctx = { waitUntil: (/** @type {Promise<unknown>} */ p) => { pendentes.push(Promise.resolve(p).catch(() => {})); }, passThroughOnException() {} };
      const r = await worker.fetch(request, /** @type {any} */ (env), /** @type {any} */ (ctx));
      /** @type {Record<string, string | string[]>} */
      const saida = {};
      r.headers.forEach((v, k) => { if (k !== 'set-cookie') saida[k] = v; });
      const cookies = r.headers.getSetCookie();
      if (cookies.length) saida['set-cookie'] = cookies;
      res.writeHead(r.status, saida);
      res.end(r.body ? Buffer.from(await r.arrayBuffer()) : undefined);
    } catch (e) {
      console.error('worker-local: erro não tratado', e);
      res.writeHead(500);
      res.end('erro no roteiro local');
    }
  });
  await new Promise(ok => servidor.listen(o.porta || 0, '127.0.0.1', () => ok(undefined)));
  const endereco = servidor.address();
  base = `http://127.0.0.1:${endereco && typeof endereco === 'object' ? endereco.port : o.porta}`;

  return {
    url: base,
    kv,
    escritas,
    emails,
    async fecha() {
      await Promise.all(pendentes);
      await new Promise(ok => servidor.close(() => ok(undefined)));
      globalThis.fetch = fetchOriginal;
    },
  };
}

/**
 * Entra no painel pelo formulário de login de verdade. O widget do Turnstile
 * nunca carrega aqui, então o token vai num campo escondido criado na hora —
 * o servidor o confere contra o fetch interceptado, que aprova
 * (VERIFICACAO §2, pegadinha 3).
 * @param {import('playwright-core').Page} page
 * @param {string} base
 */
export async function entraNoPainel(page, base) {
  await page.route(/challenges\.cloudflare\.com/, r => r.fulfill({ status: 200, contentType: 'text/javascript', body: '' }));
  await page.goto(base + '/dashboard');
  await page.fill('input[type="password"]', SENHA_DE_TESTE);
  // O formulário DO LOGIN, não "o primeiro da página": numa prévia, a faixa
  // vem antes e tem formulários próprios (as ações do menu "Testes").
  await page.evaluate(() => {
    const f = /** @type {HTMLFormElement} */ (document.querySelector('form[action="/dashboard/login"]'));
    const i = document.createElement('input');
    i.type = 'hidden';
    i.name = 'cf-turnstile-response';
    i.value = 'teste';
    f.appendChild(i);
  });
  // `form.submit()` e não o clique: o script do login segura o envio até o
  // widget devolver um token, e aqui o widget não existe.
  //
  // Espera a navegação DO ENVIO, não "a URL ser /dashboard": a tela de login
  // também mora em /dashboard, então essa condição já vale antes do POST — e
  // o roteiro seguia com o login ainda em voo.
  await Promise.all([
    page.waitForNavigation({ waitUntil: 'load', timeout: 10000 }),
    page.evaluate(() => /** @type {HTMLFormElement} */ (document.querySelector('form[action="/dashboard/login"]')).submit()),
  ]);
  const recusado = new URL(page.url()).searchParams.get('error');
  const aindaNoLogin = await page.locator('form[action="/dashboard/login"]').count();
  if (recusado || aindaNoLogin) throw new Error(`login recusado no roteiro local (error=${recusado})`);
}
