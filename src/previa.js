import { TURNSTILE_SITE_KEY } from './config.js';

// ---------------------------------------------------------------------------
// Prévia de PR (Cloudflare Worker Previews)
// ---------------------------------------------------------------------------
// Cada PR ganha uma Prévia: o MESMO código e a mesma configuração de
// produção, com dados próprios — KV `fotos-previa`, D1 `fotos-consent-previa`
// e Durable Objects que a Cloudflare cria por prévia (ver o bloco [previews]
// do wrangler.toml e a seção "Prévia de PR" do README).
//
// O que muda, e só na prévia (`AMBIENTE = "previa"`, que existe APENAS no
// bloco [previews] — produção não tem a variável):
//   1. toda página ganha uma faixa "PRÉVIA" no topo, e toda resposta,
//      `X-Robots-Tag: noindex` (o workers.dev já manda; um domínio próprio
//      de prévia, não);
//   2. o Turnstile usa as chaves de TESTE da Cloudflare, e a própria faixa tem
//      um controle para escolher o comportamento — passa, pede a caixa,
//      bloqueia, o servidor recusa, ou o script nem carrega (bloqueador de
//      anúncio). É o que permite testar as salvaguardas: o código por e-mail,
//      o caminho sem JavaScript, as mensagens de recusa;
//   3. e-mail sai de verdade, com "[PRÉVIA]" no assunto (corpoResend, em
//      utils.js);
//   4. heartbeat do Kuma e Web Analytics ficam desligados mesmo que alguém
//      copie esses segredos para a prévia: uma prévia batendo o monitor
//      manteria verde um site de produção caído.
//
// Tudo isto mora AQUI, por fora do roteador: em produção a chamada é
// `worker.fetch` direto, sem passar por linha nenhuma deste arquivo.

/** @param {{ AMBIENTE?: string } | null | undefined} env */
export function ehPrevia(env) {
  return !!env && env.AMBIENTE === 'previa';
}

// Chaves de TESTE do Turnstile, da documentação da Cloudflare ("Test your
// Turnstile implementation"). São públicas por natureza: não verificam nada de
// verdade e só funcionam como teste — por isso podem estar no código.
export const MODOS_TURNSTILE = /** @type {const} */ ({
  passa: {
    rotulo: 'Passa', curto: 'passa',
    sitekey: '1x00000000000000000000AA', segredo: '1x0000000000000000000000000000000AA',
  },
  desafio: {
    rotulo: 'Pede a caixa de seleção', curto: 'caixa',
    sitekey: '3x00000000000000000000FF', segredo: '1x0000000000000000000000000000000AA',
  },
  bloqueia: {
    rotulo: 'Bloqueia no navegador', curto: 'bloqueia',
    sitekey: '2x00000000000000000000AB', segredo: '2x0000000000000000000000000000000AA',
  },
  recusa: {
    rotulo: 'Passa no navegador, o servidor recusa', curto: 'servidor recusa',
    sitekey: '1x00000000000000000000AA', segredo: '2x0000000000000000000000000000000AA',
  },
  'sem-script': {
    rotulo: 'Script bloqueado (bloqueador de anúncio)', curto: 'sem script',
    sitekey: '1x00000000000000000000AA', segredo: '1x0000000000000000000000000000000AA',
  },
});
/** @typedef {keyof typeof MODOS_TURNSTILE} ModoTurnstile */

const COOKIE_MODO = 'previa_ts';
const ROTA_MODO = '/__previa/turnstile';
const SCRIPT_TURNSTILE = 'https://challenges.cloudflare.com/turnstile/v0/api.js';
// Um endereço da própria origem que não existe: o <script> falha, e cada página
// segue o caminho de quando um bloqueador de anúncio barra o Turnstile.
const SCRIPT_BLOQUEADO = '/__previa/turnstile-bloqueado.js';

/**
 * @param {Request} request
 * @returns {ModoTurnstile}
 */
export function modoTurnstile(request) {
  const m = (request.headers.get('Cookie') || '').match(/(?:^|;\s*)previa_ts=([a-z-]+)/);
  return m && Object.hasOwn(MODOS_TURNSTILE, m[1]) ? /** @type {ModoTurnstile} */ (m[1]) : 'passa';
}

/**
 * A camada da prévia em volta do roteador.
 * @template E
 * @param {Request} request
 * @param {E} env
 * @param {ExecutionContext} ctx
 * @param {(request: Request, env: E, ctx: ExecutionContext) => Promise<Response>} rotear
 * @returns {Promise<Response>}
 */
export async function fetchDaPrevia(request, env, ctx, rotear) {
  const url = new URL(request.url);
  if (url.pathname === ROTA_MODO) return trocaModo(url);
  if (url.pathname === '/robots.txt') {
    return new Response('User-agent: *\nDisallow: /\n', {
      headers: { 'Content-Type': 'text/plain; charset=utf-8', 'X-Robots-Tag': 'noindex, nofollow', 'Cache-Control': 'no-store' },
    });
  }
  const modo = modoTurnstile(request);
  /** @type {E} */
  const envDaPrevia = {
    ...env,
    TURNSTILE_SECRET_KEY: MODOS_TURNSTILE[modo].segredo,
    KUMA_PUSH_URL: undefined,
    CF_ANALYTICS_TOKEN: undefined,
  };
  return marcaResposta(await rotear(request, envDaPrevia, ctx), modo, url);
}

// GET /__previa/turnstile?modo=<modo>&volta=<caminho>: grava a escolha num
// cookie e volta para a página. Um link, e não um script: funciona com
// qualquer CSP e até com JavaScript desligado.
/** @param {URL} url */
function trocaModo(url) {
  const modo = url.searchParams.get('modo') || '';
  const volta = url.searchParams.get('volta') || '/';
  // Só caminho da própria origem: começa com UMA barra, sem `//` nem `/\`
  // (que o navegador lê como outro domínio), e só ASCII visível — nada de
  // quebra de linha indo parar num cabeçalho.
  const destino = /^\/(?![/\\])[\x21-\x7e]*$/.test(volta) ? volta : '/';
  const headers = new Headers({ Location: destino, 'Cache-Control': 'no-store', 'X-Robots-Tag': 'noindex, nofollow' });
  if (Object.hasOwn(MODOS_TURNSTILE, modo)) {
    headers.append('Set-Cookie', `${COOKIE_MODO}=${modo}; Path=/; Max-Age=2592000; SameSite=Lax; Secure; HttpOnly`);
  }
  return new Response(null, { status: 303, headers });
}

/**
 * Cabeçalhos copiados um a um — `Set-Cookie` inclusive, cada um separado (o
 * login da prévia depende disso).
 * @param {Response} res
 * @param {ModoTurnstile} modo
 * @param {URL} url
 */
async function marcaResposta(res, modo, url) {
  const headers = new Headers();
  res.headers.forEach((v, k) => { if (k.toLowerCase() !== 'set-cookie') headers.append(k, v); });
  for (const c of res.headers.getSetCookie()) headers.append('Set-Cookie', c);
  headers.set('X-Robots-Tag', 'noindex, nofollow');
  const tipo = headers.get('Content-Type') || '';
  if (!res.body || !tipo.startsWith('text/html')) {
    return new Response(res.body, { status: res.status, statusText: res.statusText, headers });
  }
  let html = await res.text();
  const m = MODOS_TURNSTILE[modo];
  html = html.split(TURNSTILE_SITE_KEY).join(m.sitekey);
  if (modo === 'sem-script') html = html.split(SCRIPT_TURNSTILE).join(SCRIPT_BLOQUEADO);
  html = comFaixa(html, modo, url.pathname + url.search);
  headers.delete('Content-Length');
  return new Response(html, { status: res.status, statusText: res.statusText, headers });
}

/**
 * A faixa "PRÉVIA" no topo do documento. Sem script (um `<details>` nativo abre
 * a lista) e com estilo em linha — não depende do CSS de página nenhuma, e a
 * CSP do site permite estilo em linha.
 *
 * Posição ABSOLUTA no topo, com o espaço dela reservado por `padding-top` no
 * <html>, e não um bloco no fluxo do <body>: o login centraliza o <body> com
 * flex, e uma faixa no fluxo virava item do flex e caía no meio da tela. Assim
 * ela fica no topo qualquer que seja o layout da página, rola junto com ela,
 * e o que é tela cheia (o visualizador de fotos, a folha do formulário) passa
 * POR CIMA — o botão de fechar deles continua alcançável.
 * @param {string} html
 * @param {ModoTurnstile} modo
 * @param {string} aqui caminho atual, para voltar depois de trocar o modo
 */
export function comFaixa(html, modo, aqui) {
  const abre = html.search(/<body\b/i);
  if (abre < 0) return html;
  const fim = html.indexOf('>', abre);
  if (fim < 0) return html;
  const volta = encodeURIComponent(aqui);
  const opcoes = Object.entries(MODOS_TURNSTILE).map(([chave, o]) => {
    const atual = chave === modo;
    return `<a href="${ROTA_MODO}?modo=${chave}&amp;volta=${volta}"${atual ? ' aria-current="true"' : ''} style="display:block;padding:.6rem .75rem;border-radius:8px;color:#111;text-decoration:none;line-height:1.35;${atual ? 'background:#f2e9c9;font-weight:700' : ''}">${atual ? '✓ ' : ''}${o.rotulo}</a>`;
  }).join('');
  const faixa = '<div id="previa-faixa" role="region" aria-label="Prévia de teste" style="position:absolute;top:0;left:0;right:0;height:40px;box-sizing:border-box;z-index:40;display:flex;align-items:center;gap:.6rem;padding:0 .75rem;background:#f5c518;color:#111;font:500 13px/1.2 system-ui,-apple-system,\'Segoe UI\',Roboto,sans-serif;text-align:left;white-space:nowrap">'
    + '<style>html{padding-top:40px!important}#previa-faixa .previa-aviso{display:none;overflow:hidden;text-overflow:ellipsis}@media(min-width:600px){#previa-faixa .previa-aviso{display:inline}}#previa-faixa summary::-webkit-details-marker{display:none}</style>'
    + '<strong style="font-weight:800;letter-spacing:.06em">PRÉVIA</strong>'
    + '<span class="previa-aviso">— dados de teste; nada aqui vale para o site real.</span>'
    + '<details style="position:relative;margin-left:auto"><summary style="cursor:pointer;list-style:none;padding:.3rem .65rem;border:1px solid rgba(0,0,0,.35);border-radius:999px">Turnstile: <strong>' + MODOS_TURNSTILE[modo].curto + '</strong> ▾</summary>'
    + '<div style="position:absolute;right:0;top:calc(100% + 6px);width:min(320px,calc(100vw - 1.5rem));white-space:normal;background:#fff;color:#111;border-radius:12px;box-shadow:0 14px 34px rgba(0,0,0,.4);padding:.35rem">'
    + '<div style="padding:.5rem .75rem .35rem;font-size:12px;color:#555">Como o Turnstile se comporta nesta prévia (chaves de teste da Cloudflare):</div>'
    + opcoes + '</div></details></div>';
  return html.slice(0, fim + 1) + faixa + html.slice(fim + 1);
}
