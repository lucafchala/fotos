// Prévia permanente: o mesmo site, em preview.fotos.lucafchala.com e
// preview.entrenos2026.com, com dados próprios.
//
// É a entrada de OUTRO Worker (`fotos-previa-permanente`, configurado em
// wrangler.previa-permanente.toml). Produção não importa este arquivo e não
// muda nada por causa dele.
//
// O código do site decide muita coisa pelo host: `entrenos2026.com` abre o
// álbum na raiz, `fotos.lucafchala.com` é o site principal, e os links
// absolutos, o canonical, o manifesto e os redirecionamentos apontam para os
// dois. Em vez de ensinar cada um desses lugares a reconhecer um terceiro
// nome, esta camada faz o pedido chegar ao site com o host real (sem o
// `preview.`) e, na volta, troca os endereços absolutos de produção pelos da
// prévia. O site vê o pedido como veria em produção; quem navega nunca sai do
// `preview.`.
//
// O que fica de fora de propósito:
//  - O cron. Este Worker não declara `[triggers]`: nada de e-mail de alerta,
//    IndexNow ou faxina rodando sozinho na prévia.
//  - O isolamento. Ele vem da configuração (KV, D1 e R2 próprios,
//    `AMBIENTE = "previa"`), não daqui. A camada de src/previa.js (faixa,
//    noindex, Turnstile de teste, "[PRÉVIA]" no e-mail) continua ligada, porque
//    o `fetch` abaixo passa pelo mesmo `worker.fetch` da entrada principal.

import principal from './index.js';

export { Counter, RateLimiter } from './counters.js';

const PREFIXO = 'preview.';

/** Os hosts de produção que ganham um `preview.` na frente. */
export const HOSTS_DE_PRODUCAO = Object.freeze(['fotos.lucafchala.com', 'entrenos2026.com']);

/**
 * O host real de um host de prévia, ou null quando o pedido não veio por um
 * dos nomes de prévia (o workers.dev do Worker, por exemplo).
 * @param {string} host
 */
export function hostReal(host) {
  const h = host.toLowerCase();
  if (!h.startsWith(PREFIXO)) return null;
  const real = h.slice(PREFIXO.length);
  return HOSTS_DE_PRODUCAO.includes(real) ? real : null;
}

/**
 * Troca `fotos.lucafchala.com` e `entrenos2026.com` (com ou sem `www.`) pelos
 * nomes de prévia, só quando aparecem como host de um endereço: depois de
 * `//`, que cobre `https://`, `http://` e os `//` relativos a protocolo. O
 * texto corrido ("Recebida via fotos.lucafchala.com") fica como está.
 * @param {string} texto
 */
export function paraPrevia(texto) {
  return texto.replace(
    /\/\/(?:www\.)?(fotos\.lucafchala\.com|entrenos2026\.com)(?![\w.-])/gi,
    (_, host) => `//${PREFIXO}${host.toLowerCase()}`,
  );
}

/**
 * O contrário, para o que o navegador manda de volta (Origin, Referer): o site
 * compara a Origin com o host do pedido, e os dois têm de falar a mesma língua.
 * @param {string} texto
 */
export function paraProducao(texto) {
  return texto.replace(
    /\/\/preview\.(fotos\.lucafchala\.com|entrenos2026\.com)(?![\w.-])/gi,
    (_, host) => `//${host.toLowerCase()}`,
  );
}

const TEXTO = /^(text\/|application\/(json|javascript|xml|manifest\+json|rss\+xml|atom\+xml)|image\/svg\+xml)/i;
const CABECALHOS_COM_ENDERECO = ['Location', 'Content-Security-Policy', 'Link', 'Refresh'];

/**
 * @param {Request} request
 * @param {string} real
 * @returns {Request}
 */
function pedidoParaProducao(request, real) {
  const url = new URL(request.url);
  url.hostname = real;
  const headers = new Headers(request.headers);
  for (const nome of ['Origin', 'Referer']) {
    const v = headers.get(nome);
    if (v) headers.set(nome, paraProducao(v));
  }
  return /** @type {Request} */ (new Request(url.toString(), new Request(request, { headers })));
}

/** @param {Response} res */
async function respostaParaPrevia(res) {
  const headers = new Headers(res.headers);
  for (const nome of CABECALHOS_COM_ENDERECO) {
    const v = headers.get(nome);
    if (v) headers.set(nome, paraPrevia(v));
  }
  const tipo = headers.get('Content-Type') || '';
  // Corpo sem texto (foto, fonte, zip) e respostas sem corpo passam intactos.
  if (!res.body || !TEXTO.test(tipo) || headers.has('Content-Encoding')) {
    return new Response(res.body, { status: res.status, statusText: res.statusText, headers });
  }
  const corpo = paraPrevia(await res.text());
  headers.delete('Content-Length');
  headers.delete('ETag');
  return new Response(corpo, { status: res.status, statusText: res.statusText, headers });
}

export default {
  /**
   * @param {Request} request
   * @param {any} env
   * @param {ExecutionContext} ctx
   */
  async fetch(request, env, ctx) {
    // Recusa por desenho: sem a marca de prévia, esta entrada não serve nada.
    // Uma configuração errada que apontasse este Worker para os dados de
    // produção sem `AMBIENTE = "previa"` daria um segundo site de produção.
    if (env.AMBIENTE !== 'previa') {
      return new Response('Configuração de prévia ausente.\n', { status: 503, headers: { 'Content-Type': 'text/plain; charset=utf-8' } });
    }
    const url = new URL(request.url);
    // `www.preview.…` não existe; `preview.www.…` também não. Só os dois nomes.
    const real = hostReal(url.hostname);
    if (!real) return principal.fetch(request, env, ctx);
    const res = await principal.fetch(pedidoParaProducao(request, real), env, ctx);
    return respostaParaPrevia(res);
  },
};
