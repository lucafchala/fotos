import { TURNSTILE_SITE_KEY, VERSAO } from './config.js';
import { ehPrevia, getEvents, ipParaLimite, counterStub, hojeEmSaoPaulo, diaMenos, escape } from './utils.js';

export { ehPrevia };

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
//   2. o Turnstile usa as chaves de TESTE da Cloudflare;
//   3. e-mail sai de verdade, com "[PRÉVIA]" no assunto (corpoResend, em
//      utils.js);
//   4. heartbeat do Kuma e Web Analytics ficam desligados mesmo que alguém
//      copie esses segredos para a prévia: uma prévia batendo o monitor
//      manteria verde um site de produção caído;
//   5. a faixa tem um menu "Testes" — as ferramentas abaixo.
//
// Tudo isto mora AQUI, por fora do roteador: em produção a chamada é
// `worker.fetch` direto, sem passar por linha nenhuma deste arquivo.

// ---------------------------------------------------------------------------
// As ferramentas de teste
// ---------------------------------------------------------------------------
// Dois tipos, e a diferença importa:
//
// SIMULAÇÕES — um cookie por simulação, só NESTE navegador (30 dias). Mudam o
// `env` que o roteador recebe naquela requisição: a chave do Turnstile, a do
// Resend, um KV que recusa, um portão que diz "lotado". Do roteador para
// dentro, o código é o de produção, inteiro: o que se vê é o que o site faz
// quando aquilo acontece de verdade. Ninguém mais é afetado, e "Voltar tudo ao
// normal" apaga os cookies.
//
// AÇÕES — botões (POST) que mudam o estado DESTA prévia: gerar métricas de
// exemplo, apagá-las, zerar os limites deste aparelho. Pedem o painel aberto
// (sessão de admin): o link da prévia vale para qualquer pessoa, e estas
// mexem em dados. Os Durable Objects de uma prévia são só dela — nada aqui
// alcança produção.
//
// As ferramentas leem o `env` VERDADEIRO, nunca o simulado: com "o banco
// falha" ligado, "Voltar tudo ao normal" e "Zerar os limites" continuam
// funcionando.

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

/**
 * @typedef {{ rotulo: string, curto: string }} Opcao
 * @typedef {{ cookie: string, titulo: string, ajuda: string, padrao: string, opcoes: Record<string, Opcao> }} Simulacao
 */

/** As simulações, na ordem do menu. A primeira opção de cada uma é o normal. */
export const SIMULACOES = /** @type {const} */ ({
  turnstile: {
    cookie: 'previa_ts', titulo: 'Turnstile', padrao: 'passa',
    ajuda: 'Chaves de teste da Cloudflare. Teste o código por e-mail, o caminho sem JavaScript e as mensagens de recusa.',
    opcoes: MODOS_TURNSTILE,
  },
  email: {
    cookie: 'previa_email', titulo: 'E-mail', padrao: 'normal',
    ajuda: 'Todo e-mail da prévia sai com [PRÉVIA] no assunto.',
    opcoes: {
      normal: { rotulo: 'Sai de verdade, para quem foi digitado', curto: 'normal' },
      dono: { rotulo: 'Tudo para o dono (ADMIN_EMAIL), com o destinatário no assunto', curto: 'para o dono' },
      falha: { rotulo: 'O envio falha (o Resend recusa a chave)', curto: 'falha' },
      desligado: { rotulo: 'Sem e-mail configurado', curto: 'desligado' },
    },
  },
  portao: {
    cookie: 'previa_portao', titulo: 'Portão do Drive', padrao: 'normal',
    ajuda: 'Lotado: toda tentativa ouve "muita gente acessando agora" — a espera com contagem, as novas tentativas e, no fim, o código por e-mail.',
    opcoes: {
      normal: { rotulo: 'Normal', curto: 'normal' },
      lotado: { rotulo: 'Lotado (como num evento com todo mundo no mesmo Wi-Fi)', curto: 'lotado' },
    },
  },
  banco: {
    cookie: 'previa_banco', titulo: 'Banco de dados', padrao: 'normal',
    ajuda: 'Uma queda de verdade: o KV ou o D1 recusam, e o site segue o caminho de degradação dele.',
    opcoes: {
      normal: { rotulo: 'Normal', curto: 'normal' },
      leitura: { rotulo: 'KV: leitura falha', curto: 'KV não lê' },
      escrita: { rotulo: 'KV: gravação falha', curto: 'KV não grava' },
      consentimento: { rotulo: 'D1: o registro de consentimento falha', curto: 'D1 falha' },
    },
  },
  drive: {
    cookie: 'previa_drive', titulo: 'Google Drive (galeria própria)', padrao: 'normal',
    ajuda: 'A chave da Drive API que a galeria própria usa.',
    opcoes: {
      normal: { rotulo: 'Normal', curto: 'normal' },
      recusa: { rotulo: 'A API recusa a chave', curto: 'chave recusada' },
      sem: { rotulo: 'Sem chave configurada', curto: 'sem chave' },
    },
  },
  rede: {
    cookie: 'previa_rede', titulo: 'Velocidade', padrao: 'normal',
    ajuda: 'Para ver os "carregando" e os botões travados no celular.',
    opcoes: {
      normal: { rotulo: 'Normal', curto: 'normal' },
      lenta: { rotulo: 'Lenta: cada ação do site (/api/…) demora 3 s a mais', curto: 'lenta' },
    },
  },
});
/** @typedef {keyof typeof SIMULACOES} NomeSimulacao */
/** @typedef {Record<NomeSimulacao, string>} Estado */

/** Atraso da simulação "Velocidade → lenta". */
export const ATRASO_LENTO_MS = 3000;
/** O `retryAfter` do portão lotado: a página espera isso (mais um sorteio de 0–3 s) a cada tentativa. */
export const ESPERA_LOTADO_S = 4;
// O que a simulação "o envio falha" põe no lugar da chave do Resend: o Resend
// de verdade responde 401, e o site segue o caminho de "e-mail não saiu".
export const CHAVE_RESEND_RECUSADA = 're_previa_chave_recusada';
// Idem para a Drive API: o Google responde 400 ("API key not valid").
export const CHAVE_DRIVE_RECUSADA = 'previa-chave-recusada';

// A espera da "Velocidade → lenta", num objeto que os testes trocam
// (`vi.spyOn`) para não esperar três segundos de verdade.
export const relogioDaPrevia = {
  /** @param {number} ms */
  dorme: ms => new Promise(ok => setTimeout(ok, ms)),
};

const ROTA = '/__previa/';
const SCRIPT_TURNSTILE = 'https://challenges.cloudflare.com/turnstile/v0/api.js';
// Um endereço da própria origem que não existe: o <script> falha, e cada página
// segue o caminho de quando um bloqueador de anúncio barra o Turnstile.
const SCRIPT_BLOQUEADO = '/__previa/turnstile-bloqueado.js';
const COOKIE_AVISO = 'previa_aviso';
const UM_MES = 2592000;
const SLUG = /^[a-z0-9][a-z0-9-]*$/;

// Os limites POR IP do site (o 3º argumento de checkRateLimit/takeToken em
// src/index.js). "Zerar os limites deste aparelho" zera estes — e um teste
// confere que a lista acompanha o código. Ficam de fora, de propósito, os que
// não são por IP: o teto diário de códigos por e-mail (protege a franquia de
// e-mail, dividida com produção quando a chave é a mesma) e o limite por
// endereço (para repetir o código, "E-mail → tudo para o dono" com endereços
// diferentes).
export const LIMITES_DO_APARELHO = /** @type {const} */ ([
  'login', 'login-day', 'login-fail', 'support', 'removal',
  'drive-click', 'drive-gate', 'drive-gate-noscript', 'drive-gate-email', 'drive-code',
]);
// O "lotado" vale para o portão pelo Turnstile e pelo caminho sem JavaScript —
// não para o código por e-mail, que tem balde próprio (`drive-gate-email`) e é
// justamente a saída que o portão lotado oferece.
const LIMITES_DO_PORTAO = ['drive-gate', 'drive-gate-noscript'];

/** O que a faixa diz depois de uma ação. A chave vai num cookie; o texto, nunca. */
const AVISOS = /** @type {const} */ ({
  'metricas-geradas': '✓ Métricas de exemplo geradas: 90 dias para cada projeto. Painel → Métricas.',
  'metricas-apagadas': '✓ Métricas desta prévia apagadas.',
  'limites-zerados': '✓ Limites deste aparelho zerados: login, formulários, portão do Drive e código por e-mail.',
  'visitas-esquecidas': '✓ A próxima visita a cada projeto conta de novo.',
  'precisa-entrar': 'Esta ação mexe em dados da prévia: entre no painel (/dashboard) e tente de novo.',
  falhou: 'A ação não deu certo. O /api/healthz desta prévia diz o que está fora.',
});
/** @typedef {keyof typeof AVISOS} Aviso */

/**
 * O estado das simulações neste navegador: o valor de cada cookie, ou o
 * normal quando o cookie falta ou traz um valor desconhecido.
 * @param {Request} request
 * @returns {Estado}
 */
export function simulacoes(request) {
  const cookies = request.headers.get('Cookie') || '';
  /** @type {Record<string, string>} */
  const estado = {};
  for (const [nome, s] of Object.entries(SIMULACOES)) {
    const m = cookies.match(new RegExp(`(?:^|;\\s*)${s.cookie}=([a-z-]+)`));
    estado[nome] = m && Object.hasOwn(s.opcoes, m[1]) ? m[1] : s.padrao;
  }
  return /** @type {Estado} */ (estado);
}

/**
 * Compatibilidade: o modo do Turnstile sozinho.
 * @param {Request} request
 * @returns {ModoTurnstile}
 */
export function modoTurnstile(request) {
  return /** @type {ModoTurnstile} */ (simulacoes(request).turnstile);
}

/**
 * A camada da prévia em volta do roteador.
 * @template E
 * @param {Request} request
 * @param {E} env
 * @param {ExecutionContext} ctx
 * @param {{
 *   rotear: (request: Request, env: E, ctx: ExecutionContext) => Promise<Response>,
 *   autenticado: (request: Request, env: E) => Promise<boolean>,
 * }} roteador
 * @returns {Promise<Response>}
 */
export async function fetchDaPrevia(request, env, ctx, roteador) {
  const url = new URL(request.url);
  const real = /** @type {any} */ (env);
  if (url.pathname.startsWith(ROTA)) return ferramenta(request, url, real, r => roteador.autenticado(r, env));
  if (url.pathname === '/robots.txt') {
    return new Response('User-agent: *\nDisallow: /\n', {
      headers: { 'Content-Type': 'text/plain; charset=utf-8', 'X-Robots-Tag': 'noindex, nofollow', 'Cache-Control': 'no-store' },
    });
  }
  const estado = simulacoes(request);
  if (estado.rede === 'lenta' && url.pathname.startsWith('/api/')) await relogioDaPrevia.dorme(ATRASO_LENTO_MS);
  const res = await roteador.rotear(request, /** @type {E} */ (envSimulado(real, estado)), ctx);
  return marcaResposta(res, request, estado, url, real);
}

/**
 * O `env` que o roteador vê nesta requisição: o de verdade, com as trocas que
 * as simulações ligadas pedem. Objeto novo a cada requisição — nada vaza para
 * a próxima.
 * @param {Record<string, any>} env
 * @param {Estado} estado
 */
export function envSimulado(env, estado) {
  /** @type {Record<string, any>} */
  const e = {
    ...env,
    TURNSTILE_SECRET_KEY: MODOS_TURNSTILE[/** @type {ModoTurnstile} */ (estado.turnstile)].segredo,
    KUMA_PUSH_URL: undefined,
    CF_ANALYTICS_TOKEN: undefined,
  };
  if (estado.email === 'dono') {
    // Sem ADMIN_EMAIL não há "o dono" para quem desviar: nada sai, em vez de
    // sair para o endereço digitado — a promessa desta opção é não escrever
    // para ninguém de fora.
    if (env.ADMIN_EMAIL) e.PREVIA_EMAIL = 'dono';
    else e.RESEND_API_KEY = undefined;
  }
  if (estado.email === 'falha') e.RESEND_API_KEY = CHAVE_RESEND_RECUSADA;
  if (estado.email === 'desligado') e.RESEND_API_KEY = undefined;
  if ((estado.banco === 'leitura' || estado.banco === 'escrita') && env.FOTOS) e.FOTOS = kvQueFalha(env.FOTOS, estado.banco);
  if (estado.banco === 'consentimento' && env.CONSENT_DB) e.CONSENT_DB = d1QueFalha();
  if (estado.portao === 'lotado' && env.RATELIMIT) e.RATELIMIT = portaoLotado(env.RATELIMIT);
  if (estado.drive === 'recusa') e.GOOGLE_DRIVE_API_KEY = CHAVE_DRIVE_RECUSADA;
  if (estado.drive === 'sem') e.GOOGLE_DRIVE_API_KEY = undefined;
  return e;
}

/**
 * O KV com um lado quebrado. A recusa tem a forma da do KV de verdade (uma
 * promessa rejeitada com "KV <OP> failed: 503") — é o que o site já trata.
 * @param {any} kv
 * @param {'leitura' | 'escrita'} lado
 */
function kvQueFalha(kv, lado) {
  /** @param {string} op */
  const recusa = op => Promise.reject(new Error(`KV ${op} failed: 503 Service Unavailable (simulado pela prévia)`));
  const le = lado === 'leitura';
  return {
    /** @param {any[]} a */
    get: (...a) => (le ? recusa('GET') : kv.get(...a)),
    /** @param {any[]} a */
    getWithMetadata: (...a) => (le ? recusa('GET') : kv.getWithMetadata(...a)),
    /** @param {any[]} a */
    list: (...a) => (le ? recusa('LIST') : kv.list(...a)),
    /** @param {any[]} a */
    put: (...a) => (le ? kv.put(...a) : recusa('PUT')),
    /** @param {any[]} a */
    delete: (...a) => (le ? kv.delete(...a) : recusa('DELETE')),
  };
}

// O D1 do registro de consentimento recusando tudo — `prepare().bind().run()`
// rejeita, como numa queda.
function d1QueFalha() {
  const recusa = () => Promise.reject(new Error('D1_ERROR: falha simulada pela prévia'));
  /** @type {Record<string, any>} */
  const comando = { run: recusa, first: recusa, all: recusa, raw: recusa };
  comando.bind = () => comando;
  return { prepare: () => comando, batch: recusa, exec: recusa };
}

/**
 * O namespace do RateLimiter com o portão do Drive sempre sem fichas — a
 * resposta que o balde de verdade dá num pico (`take()` → `{ ok: false,
 * retryAfter }`). Os outros limites passam direto pelo objeto de verdade.
 * @param {any} ns
 */
function portaoLotado(ns) {
  /** @type {Map<unknown, string>} */
  const nomes = new Map();
  return {
    /** @param {string} nome */
    idFromName(nome) {
      const id = ns.idFromName(nome);
      nomes.set(id, nome);
      return id;
    },
    /** @param {unknown} id @param {any[]} resto */
    get(id, ...resto) {
      const stub = ns.get(id, ...resto);
      const nome = nomes.get(id) || '';
      if (!LIMITES_DO_PORTAO.some(k => nome.startsWith(k + ':'))) return stub;
      return {
        take: async () => ({ ok: false, retryAfter: ESPERA_LOTADO_S }),
        /** @param {any[]} a */
        check: (...a) => stub.check(...a),
      };
    },
    /** @param {any[]} a */
    idFromString: (...a) => ns.idFromString(...a),
    /** @param {any[]} a */
    newUniqueId: (...a) => ns.newUniqueId(...a),
  };
}

// ---------------------------------------------------------------------------
// As rotas /__previa/…
// ---------------------------------------------------------------------------
// Simulação é um LINK (GET → cookie → volta para a página): funciona com
// qualquer CSP e até com JavaScript desligado, e só mexe neste navegador.
// Ação é um FORMULÁRIO (POST), com origem conferida e sessão de admin.

/**
 * @param {Request} request
 * @param {URL} url
 * @param {Record<string, any>} env o de verdade
 * @param {(request: Request) => Promise<boolean>} autenticado
 */
async function ferramenta(request, url, env, autenticado) {
  const nome = url.pathname.slice(ROTA.length);
  const leitura = request.method === 'GET' || request.method === 'HEAD';
  const volta = destinoSeguro(url.searchParams.get('volta'));
  if (leitura && nome === 'simula') {
    return trocaSimulacao(url.searchParams.get('sim') || '', url.searchParams.get('valor') || '', volta);
  }
  // O endereço de antes do menu "Testes" (só o Turnstile) continua valendo.
  if (leitura && nome === 'turnstile') return trocaSimulacao('turnstile', url.searchParams.get('modo') || '', volta);
  if (leitura && nome === 'normal') {
    const h = cabecalhosDeVolta(volta);
    for (const s of Object.values(SIMULACOES)) h.append('Set-Cookie', cookie(s.cookie, null));
    return new Response(null, { status: 303, headers: h });
  }
  if (leitura && nome === 'visitas') return esqueceVisitas(env, volta);
  if (request.method === 'POST' && nome === 'acao') return acao(request, url, env, autenticado);
  return new Response('Ferramenta da prévia não encontrada.\n', {
    status: 404,
    headers: { 'Content-Type': 'text/plain; charset=utf-8', 'X-Content-Type-Options': 'nosniff', 'X-Robots-Tag': 'noindex, nofollow', 'Cache-Control': 'no-store' },
  });
}

// Só caminho da própria origem: começa com UMA barra, sem `//` nem `/\` (que
// o navegador lê como outro domínio), e só ASCII visível — nada de quebra de
// linha indo parar num cabeçalho.
/** @param {string | null} volta */
function destinoSeguro(volta) {
  return volta && /^\/(?![/\\])[\x21-\x7e]*$/.test(volta) ? volta : '/';
}

/** @param {string} destino */
function cabecalhosDeVolta(destino) {
  return new Headers({ Location: destino, 'Cache-Control': 'no-store', 'X-Robots-Tag': 'noindex, nofollow' });
}

/**
 * Cookie de simulação; `null` apaga. HttpOnly: nenhum script da página
 * precisa ler, e o servidor é quem aplica.
 * @param {string} nome
 * @param {string | null} valor
 * @param {number} [idade]
 */
function cookie(nome, valor, idade = UM_MES) {
  return valor === null
    ? `${nome}=; Path=/; Max-Age=0; SameSite=Lax; Secure; HttpOnly`
    : `${nome}=${valor}; Path=/; Max-Age=${idade}; SameSite=Lax; Secure; HttpOnly`;
}

/**
 * GET /__previa/simula?sim=<simulação>&valor=<opção>&volta=<caminho>. Voltar
 * ao normal apaga o cookie. Simulação ou opção desconhecida não grava nada.
 * @param {string} nome
 * @param {string} valor
 * @param {string} volta
 */
function trocaSimulacao(nome, valor, volta) {
  const h = cabecalhosDeVolta(volta);
  if (Object.hasOwn(SIMULACOES, nome)) {
    const s = /** @type {Simulacao} */ (SIMULACOES[/** @type {NomeSimulacao} */ (nome)]);
    if (Object.hasOwn(s.opcoes, valor)) h.append('Set-Cookie', cookie(s.cookie, valor === s.padrao ? null : valor));
  }
  return new Response(null, { status: 303, headers: h });
}

/**
 * GET /__previa/visitas: apaga o cookie `fv_<slug>` de cada projeto, e a
 * próxima visita conta de novo. O cookie é por caminho (`Path=/<slug>`), então
 * esta rota não o enxerga — apaga pelo nome, projeto por projeto.
 * @param {Record<string, any>} env
 * @param {string} volta
 */
async function esqueceVisitas(env, volta) {
  const h = cabecalhosDeVolta(volta);
  try {
    for (const e of await getEvents(/** @type {any} */ (env))) {
      const slug = String(e.slug || '');
      if (SLUG.test(slug)) h.append('Set-Cookie', `fv_${slug}=; Max-Age=0; Path=/${slug}; SameSite=Lax`);
    }
    h.append('Set-Cookie', cookie(COOKIE_AVISO, 'visitas-esquecidas', 60));
  } catch (e) {
    console.error('prévia: esquecer visitas', e);
    h.append('Set-Cookie', cookie(COOKIE_AVISO, 'falhou', 60));
  }
  return new Response(null, { status: 303, headers: h });
}

/**
 * POST /__previa/acao?volta=<caminho> (formulário da faixa): o campo `acao`.
 * @param {Request} request
 * @param {URL} url
 * @param {Record<string, any>} env
 * @param {(request: Request) => Promise<boolean>} autenticado
 */
async function acao(request, url, env, autenticado) {
  // Só da própria página: o formulário da faixa manda `Sec-Fetch-Site:
  // same-origin` (e a Origin). A sessão de admin já é SameSite=Strict — esta
  // conferência é a segunda camada.
  const site = request.headers.get('Sec-Fetch-Site');
  const origem = request.headers.get('Origin');
  const texto = { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store' };
  if ((site && site !== 'same-origin') || (!site && origem !== url.origin)) {
    return new Response('Origem recusada.\n', { status: 403, headers: texto });
  }
  // O `volta` vem no endereço, não no corpo: quem não tem sessão volta sem
  // que o corpo seja lido — a prévia não lê nada de quem ela vai recusar.
  const h = cabecalhosDeVolta(destinoSeguro(url.searchParams.get('volta')));
  /** @type {Aviso} */
  let aviso = 'falhou';
  if (!await autenticado(request)) {
    aviso = 'precisa-entrar';
  } else if (Number(request.headers.get('Content-Length') || 0) > 1024) {
    // O formulário manda um campo curto; nada maior que isto é dele.
    return new Response('Corpo grande demais.\n', { status: 413, headers: texto });
  } else {
    try {
      const qual = new URLSearchParams((await request.text()).slice(0, 1024)).get('acao');
      if (qual === 'metricas-exemplo') { await geraMetricasDeExemplo(env); aviso = 'metricas-geradas'; }
      else if (qual === 'metricas-apagar') { await apagaMetricas(env); aviso = 'metricas-apagadas'; }
      else if (qual === 'zerar-limites') { await zeraLimites(env, request); aviso = 'limites-zerados'; }
    } catch (e) {
      console.error('prévia: ação', e);
      aviso = 'falhou';
    }
  }
  h.append('Set-Cookie', cookie(COOKIE_AVISO, aviso, 60));
  return new Response(null, { status: 303, headers: h });
}

/**
 * Os contadores de todo projeto (totais — o objeto apaga a série por dia
 * junto) e os do portão.
 * @param {any[]} eventos
 */
function chavesDeMetricas(eventos) {
  const chaves = ['gate:turnstile', 'gate:email', 'gate:noscript'];
  for (const e of eventos) chaves.push(`views:${e.slug}`, `drive_clicks:${e.slug}`);
  return chaves;
}

/** @param {Record<string, any>} env */
async function apagaMetricas(env) {
  await counterStub(/** @type {any} */ (env)).remove(chavesDeMetricas(await getEvents(/** @type {any} */ (env), true)));
}

// Substitui as métricas da prévia por 90 dias de exemplo: apaga o que houver
// (o `seed` do objeto não sobrescreve chave existente — e um total real de 3
// visitas ao lado de 90 dias inventados ficaria sem sentido) e semeia.
/** @param {Record<string, any>} env */
async function geraMetricasDeExemplo(env) {
  const eventos = await getEvents(/** @type {any} */ (env), true);
  const contador = counterStub(/** @type {any} */ (env));
  await contador.remove(chavesDeMetricas(eventos));
  await contador.seed(metricasDeExemplo(eventos, hojeEmSaoPaulo(), 90));
}

/**
 * Zera os limites por IP deste aparelho (os objetos `RateLimiter` de cada
 * chave em LIMITES_DO_APARELHO para o IP desta requisição).
 * @param {Record<string, any>} env
 * @param {Request} request
 */
async function zeraLimites(env, request) {
  const ip = ipParaLimite(request.headers.get('CF-Connecting-IP') || 'unknown');
  await Promise.all(LIMITES_DO_APARELHO.map(k => env.RATELIMIT.get(env.RATELIMIT.idFromName(`${k}:${ip}`)).zera()));
}

/**
 * Métricas de exemplo, DETERMINÍSTICAS (o mesmo sorteio a cada vez): `dias`
 * dias até `hoje`, um ritmo semanal (fim de semana movimenta mais) e um pico na
 * semana depois da data de cada projeto. Projeto oculto pesa menos; "em breve"
 * fica de fora. Devolve as chaves cruas do objeto `Counter` (totais e
 * `d:<dia>:<total>` — ver src/counters.js). O `npm run verifica:painel` usa a
 * mesma função, com 100 dias.
 * @param {Array<Record<string, any>>} eventos
 * @param {string} hoje 'AAAA-MM-DD'
 * @param {number} dias
 * @returns {Record<string, number>}
 */
export function metricasDeExemplo(eventos, hoje, dias) {
  const base = Date.parse(hoje + 'T12:00:00Z');
  let semente = 42;
  const sorteio = () => { semente = (semente * 1103515245 + 12345) % 2147483648; return semente / 2147483648; };
  /** @type {Record<string, number>} */
  const out = {};
  /** @param {string} k @param {number} v */
  const soma = (k, v) => { if (v > 0) out[k] = (out[k] || 0) + v; };
  const projetos = eventos
    .filter(e => !e.comingSoon && SLUG.test(String(e.slug || '')))
    .map(e => ({ slug: e.slug, data: Date.parse(String(e.date || '') + 'T12:00:00Z'), peso: e.visible === false ? 0.15 : 1 }));
  for (let i = dias - 1; i >= 0; i--) {
    const dia = diaMenos(hoje, i);
    const t = base - i * 86400000;
    const semana = new Date(t).getUTCDay();
    const ritmo = semana === 0 || semana === 6 ? 1.6 : 1;
    for (const p of projetos) {
      const depois = (t - p.data) / 86400000;
      const pico = depois >= 0 && depois < 7 ? 5 - depois * 0.6 : 1;
      const v = Math.round((3 + sorteio() * 9) * p.peso * ritmo * pico);
      const c = Math.round(v * (0.2 + sorteio() * 0.25));
      soma(`d:${dia}:views:${p.slug}`, v); soma(`views:${p.slug}`, v);
      soma(`d:${dia}:drive_clicks:${p.slug}`, c); soma(`drive_clicks:${p.slug}`, c);
    }
    for (const [modo, f] of /** @type {const} */ ([['turnstile', 1.2], ['email', 0.18], ['noscript', 0.07]])) {
      const g = Math.round((2 + sorteio() * 6) * f * ritmo);
      soma(`d:${dia}:gate:${modo}`, g); soma(`gate:${modo}`, g);
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// A resposta: cabeçalhos, chave do Turnstile e a faixa
// ---------------------------------------------------------------------------

/**
 * Cabeçalhos copiados um a um — `Set-Cookie` inclusive, cada um separado (o
 * login da prévia depende disso).
 * @param {Response} res
 * @param {Request} request
 * @param {Estado} estado
 * @param {URL} url
 * @param {Record<string, any>} env
 */
async function marcaResposta(res, request, estado, url, env) {
  const headers = new Headers();
  res.headers.forEach((v, k) => { if (k.toLowerCase() !== 'set-cookie') headers.append(k, v); });
  for (const c of res.headers.getSetCookie()) headers.append('Set-Cookie', c);
  headers.set('X-Robots-Tag', 'noindex, nofollow');
  const tipo = headers.get('Content-Type') || '';
  if (!res.body || !tipo.startsWith('text/html')) {
    return new Response(res.body, { status: res.status, statusText: res.statusText, headers });
  }
  let html = await res.text();
  const m = MODOS_TURNSTILE[/** @type {ModoTurnstile} */ (estado.turnstile)];
  html = html.split(TURNSTILE_SITE_KEY).join(m.sitekey);
  if (estado.turnstile === 'sem-script') html = html.split(SCRIPT_TURNSTILE).join(SCRIPT_BLOQUEADO);
  const aviso = avisoDe(request);
  if (aviso) headers.append('Set-Cookie', cookie(COOKIE_AVISO, null));
  html = comFaixa(html, estado, url.pathname + url.search, { aviso, versao: versaoDaPrevia(env) });
  headers.delete('Content-Length');
  return new Response(html, { status: res.status, statusText: res.statusText, headers });
}

/**
 * @param {Request} request
 * @returns {Aviso | null}
 */
function avisoDe(request) {
  const m = (request.headers.get('Cookie') || '').match(/(?:^|;\s*)previa_aviso=([a-z-]+)/);
  return m && Object.hasOwn(AVISOS, m[1]) ? /** @type {Aviso} */ (m[1]) : null;
}

/**
 * "Versão 2.0.0 · a1b2c3d4 · publicada 10/10/2026 14:32" — do binding de
 * version metadata, quando existe.
 * @param {Record<string, any>} env
 */
function versaoDaPrevia(env) {
  const v = env.CF_VERSION_METADATA;
  const partes = [`Versão ${VERSAO}`];
  if (v && typeof v.tag === 'string' && v.tag) partes.push(v.tag.slice(0, 40));
  else if (v && typeof v.id === 'string' && v.id) partes.push(v.id.slice(0, 8));
  if (v && typeof v.timestamp === 'string' && v.timestamp) {
    const t = new Date(v.timestamp);
    if (!Number.isNaN(t.getTime())) {
      partes.push('publicada ' + t.toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo', dateStyle: 'short', timeStyle: 'short' }));
    }
  }
  return partes.join(' · ');
}

// O estilo da faixa e do menu, todo preso ao #previa-faixa: não depende do CSS
// de página nenhuma, e o seletor por id vence o CSS das páginas (botão, link e
// formulário têm estilo global no painel). A CSP do site permite estilo em
// linha.
const ESTILO = '<style>'
  + 'html{padding-top:44px!important}'
  + '#previa-faixa{position:absolute;top:0;left:0;right:0;height:44px;box-sizing:border-box;z-index:40;display:flex;align-items:center;gap:.6rem;padding:0 .75rem;background:#f5c518;color:#111;font:500 13px/1.2 system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;text-align:left;white-space:nowrap}'
  + '#previa-faixa *{box-sizing:border-box}'
  // Menu ABERTO por cima de tudo (o aviso de cookies, a barra de baixo do
  // painel); fechado, a faixa fica no z-index 40 e o que é tela cheia passa
  // por cima dela.
  + '#previa-faixa:has(details[open]){z-index:2147483646}'
  + '#previa-faixa .previa-aviso{display:none;overflow:hidden;text-overflow:ellipsis}'
  + '#previa-faixa details{position:relative;margin-left:auto}'
  + '#previa-faixa summary{cursor:pointer;list-style:none;display:flex;align-items:center;min-height:44px;color:#111}'
  + '#previa-faixa .previa-pilula{display:flex;align-items:center;gap:.4rem;padding:.3rem .65rem;border:1px solid rgba(0,0,0,.35);border-radius:999px}'
  + '#previa-faixa summary:focus-visible .previa-pilula{outline:2px solid #111;outline-offset:2px}'
  + '#previa-faixa summary::-webkit-details-marker{display:none}'
  + '#previa-faixa .previa-ligados{display:none}'
  + '#previa-faixa .previa-conta{display:inline-block;min-width:1.35rem;padding:.1rem .35rem;border-radius:999px;background:#111;color:#f5c518;font-weight:700;text-align:center}'
  + '#previa-faixa .previa-painel{position:absolute;right:0;top:calc(100% + 6px);width:min(360px,calc(100vw - 1.5rem));max-height:calc(100vh - 60px);overflow:auto;white-space:normal;background:#fff;color:#111;border-radius:12px;box-shadow:0 14px 34px rgba(0,0,0,.4);padding:.35rem .35rem .6rem}'
  + '#previa-faixa .previa-nota{margin:0;padding:.5rem .75rem .35rem;font-size:12px;line-height:1.4;color:#555}'
  + '#previa-faixa .previa-msg{margin:.25rem .35rem .5rem;padding:.6rem .7rem;border-radius:8px;background:#fff4c2;font-weight:600;line-height:1.4}'
  + '#previa-faixa .previa-grupo{border-top:1px solid #eee;padding-top:.35rem;margin-top:.35rem}'
  + '#previa-faixa .previa-titulo{margin:0;padding:.35rem .75rem .1rem;font-weight:800;font-size:12px;letter-spacing:.04em;text-transform:uppercase;color:#333}'
  + '#previa-faixa .previa-ajuda{margin:0;padding:.1rem .75rem .3rem;font-size:12px;line-height:1.4;color:#555}'
  + '#previa-faixa a.previa-op,#previa-faixa button.previa-op{display:flex;align-items:center;width:100%;min-height:44px;margin:0;padding:.55rem .75rem;border:0;border-radius:8px;background:none;color:#111;font:inherit;text-align:left;text-decoration:none;line-height:1.35;cursor:pointer}'
  + '#previa-faixa a.previa-op:hover,#previa-faixa button.previa-op:hover{background:#f4f4f4}'
  + '#previa-faixa a.previa-op[aria-current="true"]{background:#f2e9c9;font-weight:700}'
  + '#previa-faixa a.previa-normal{color:#7a4a00;font-weight:700}'
  + '#previa-faixa form{margin:0}'
  + '#previa-faixa .previa-versao{margin:0;padding:.35rem .75rem;font-size:12px;line-height:1.5;color:#333}'
  + '#previa-faixa .previa-versao a{color:#111}'
  + '@media(min-width:600px){#previa-faixa .previa-aviso{display:inline}}'
  + '@media(min-width:1000px){#previa-faixa .previa-ligados{display:inline}#previa-faixa .previa-conta{display:none}}'
  + '</style>';

/**
 * A faixa "PRÉVIA" no topo do documento, com o menu "Testes". Sem script (um
 * `<details>` nativo abre o menu; simulação é link, ação é formulário). 44 px
 * de altura: o "Testes" e cada opção do menu são alvos de toque inteiros.
 *
 * Posição ABSOLUTA no topo, com o espaço dela reservado por `padding-top` no
 * <html>, e não um bloco no fluxo do <body>: o login centraliza o <body> com
 * flex, e uma faixa no fluxo virava item do flex e caía no meio da tela. Assim
 * ela fica no topo qualquer que seja o layout da página, rola junto com ela,
 * e o que é tela cheia (o visualizador de fotos, a folha do formulário) passa
 * POR CIMA — o botão de fechar deles continua alcançável.
 * @param {string} html
 * @param {Estado | ModoTurnstile} estado (um modo do Turnstile sozinho também serve)
 * @param {string} aqui caminho atual, para voltar depois de uma troca
 * @param {{ aviso?: Aviso | null, versao?: string }} [extra]
 */
export function comFaixa(html, estado, aqui, extra = {}) {
  const pos = ondeEntraAFaixa(html);
  if (pos < 0) return html;
  /** @type {Estado} */
  const est = typeof estado === 'string'
    ? /** @type {Estado} */ ({ ...padroes(), turnstile: estado })
    : estado;
  const volta = encodeURIComponent(aqui);

  /** @type {string[]} */
  const ligados = [];
  const grupos = Object.entries(SIMULACOES).map(([nome, s]) => {
    const atual = est[/** @type {NomeSimulacao} */ (nome)];
    const sim = /** @type {Simulacao} */ (s);
    if (atual !== sim.padrao) ligados.push(`${sim.titulo}: <strong>${sim.opcoes[atual].curto}</strong>`);
    const opcoes = Object.entries(sim.opcoes).map(([valor, o]) => {
      const marcado = valor === atual;
      return `<a class="previa-op" data-valor="${valor}" href="${ROTA}simula?sim=${nome}&amp;valor=${valor}&amp;volta=${volta}"${marcado ? ' aria-current="true"' : ''}>${marcado ? '✓ ' : ''}${o.rotulo}</a>`;
    }).join('');
    return `<div class="previa-grupo" data-sim="${nome}" role="group" aria-labelledby="previa-t-${nome}">`
      + `<p class="previa-titulo" id="previa-t-${nome}">${sim.titulo}</p>`
      + `<p class="previa-ajuda">${sim.ajuda}</p>${opcoes}</div>`;
  }).join('');

  /** @param {string} acao @param {string} rotulo */
  const botao = (acao, rotulo) => `<form method="post" action="${ROTA}acao?volta=${volta}">`
    + `<input type="hidden" name="acao" value="${acao}">`
    + `<button type="submit" class="previa-op" data-acao="${acao}">${rotulo}</button></form>`;
  const acoes = '<div class="previa-grupo" data-sim="acoes" role="group" aria-labelledby="previa-t-acoes">'
    + '<p class="previa-titulo" id="previa-t-acoes">Ações nesta prévia</p>'
    + `<a class="previa-op" data-acao="visitas" href="${ROTA}visitas?volta=${volta}">Contar minhas visitas de novo</a>`
    + '<p class="previa-ajuda">As três abaixo pedem o painel aberto nesta prévia:</p>'
    + botao('metricas-exemplo', 'Gerar 90 dias de métricas de exemplo')
    + botao('metricas-apagar', 'Apagar as métricas desta prévia')
    + botao('zerar-limites', 'Zerar os limites deste aparelho')
    + '</div>';

  const sobre = '<div class="previa-grupo" data-sim="sobre" role="group" aria-labelledby="previa-t-sobre">'
    + '<p class="previa-titulo" id="previa-t-sobre">Esta prévia</p>'
    + `<p class="previa-versao">${escape(extra.versao || `Versão ${VERSAO}`)}<br>`
    + '<a href="/api/healthz">Saúde desta prévia (/api/healthz)</a></p></div>';

  const aviso = extra.aviso ? `<p class="previa-msg" role="status">${AVISOS[extra.aviso]}</p>` : '';
  const normal = ligados.length
    ? `<a class="previa-op previa-normal" data-acao="normal" href="${ROTA}normal?volta=${volta}">Voltar tudo ao normal</a>`
    : '';
  const resumo = ligados.length
    ? ` <span class="previa-ligados">· ${ligados.join(' · ')}</span><span class="previa-conta" aria-label="${ligados.length} ${ligados.length === 1 ? 'simulação ligada' : 'simulações ligadas'}">${ligados.length}</span>`
    : '';

  const faixa = '<div id="previa-faixa" role="region" aria-label="Prévia de teste">' + ESTILO
    + '<strong style="font-weight:800;letter-spacing:.06em">PRÉVIA</strong>'
    + '<span class="previa-aviso">— dados de teste; nada aqui vale para o site real.</span>'
    + `<details${aviso ? ' open' : ''}><summary><span class="previa-pilula">Testes${resumo} ▾</span></summary>`
    + '<div class="previa-painel">'
    + aviso
    + '<p class="previa-nota">Simulações valem só neste navegador. Do roteador para dentro, o código é o de produção.</p>'
    + normal + grupos + acoes + sobre
    + '</div></details></div>';
  return html.slice(0, pos) + faixa + html.slice(pos);
}

/**
 * Onde a faixa entra: logo depois do `<body ...>`. Página SEM `<body>` (as de
 * erro curtas, como "painel indisponível" com o KV fora) também ganha a faixa —
 * o navegador abre o corpo sozinho no primeiro conteúdo, e ela entra antes
 * dele: depois do `</head>`, do `<html>` ou do `<!DOCTYPE>`, o que vier por
 * último (antes do DOCTYPE, a página cairia em modo quirks). Sem isto, a
 * página de "KV fora" ficava sem a saída "Voltar tudo ao normal" — o
 * `verifica:previa` pegou. -1: tag quebrada, não mexe.
 * @param {string} html
 */
function ondeEntraAFaixa(html) {
  const abre = html.search(/<body\b/i);
  if (abre >= 0) {
    const fim = html.indexOf('>', abre);
    return fim < 0 ? -1 : fim + 1;
  }
  for (const re of [/<\/head\s*>/i, /<html\b[^>]*>/i, /^\s*<!doctype[^>]*>/i]) {
    const m = html.match(re);
    if (m && m.index !== undefined) return m.index + m[0].length;
  }
  return 0;
}

/** @returns {Estado} */
function padroes() {
  /** @type {Record<string, string>} */
  const p = {};
  for (const [nome, s] of Object.entries(SIMULACOES)) p[nome] = s.padrao;
  return /** @type {Estado} */ (p);
}
