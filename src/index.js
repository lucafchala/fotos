import { galleryHTML } from './ui/gallery.js';
import { eventHTML } from './ui/event.js';
import { loginHTML, dashboardHTML } from './ui/dashboard.js';
import { supportHTML } from './ui/support.js';
import { privacyHTML } from './ui/privacy.js';
import { termsHTML } from './ui/terms.js';
import { aboutHTML } from './ui/about.js';
import { gearHTML } from './ui/gear.js';
import { legalHTML } from './ui/legal.js';
import { docHTML } from './ui/doc.js';
import { findDoc, LEGAL_DOCS } from './content/legal-docs.js';
import {
  getEvents, saveEvents, getCategories, saveCategories, MAX_CATEGORIES, MAX_CATEGORY_LEN,
  hashPassword, verifyPassword, generateToken,
  verifySession, escape, validateSlug, generateId, checkRateLimit,
  noteKvFailure, noteDegraded, degradedHealth, toCount, bumpCounter, flushCounters,
  sendRemovalEmail, sendConfirmationEmail, sendResolvedEmail, sendSupportEmail,
  toHttps, safeUrl, isLikelyImage, csvResponse, stripImageMetadata,
  TERMS_VERSION, CONSENT_LABEL, ACCESS_TYPES, ACCESS_DECLARATIONS,
  sendErrorAlert, sendLoginAlert,
  SESSION_TTL_SECS, sessionCookie, sessionRecord,
} from './utils.js';
import {
  generateNonce, htmlSecurityHeaders, adminHtmlSecurityHeaders, dataSecurityHeaders,
  isCrossSiteRequest, signToken, verifyToken, validatePassword,
  HONEYPOT_FIELD, honeypotTripped,
} from './security.js';

const SITE_URL = 'https://fotos.lucafchala.com';
const REMOVAL_RETENTION_DAYS = 180; // resolved removal requests are purged after this
const CONSENT_RETENTION_DAYS = 1825; // image-use consent rows purged after this (~5 anos — cobre o prazo prescricional de reparação civil; ajuste conforme orientação jurídica)
// Prefill text for the support form, keyed by the ?tema= query param — cosmetic
// only, never trusted server-side beyond seeding the textarea's initial text.
const TEMA_PREFILLS = {
  bug: 'Encontrei um problema na interface do site: ',
  sugestao: 'Tenho uma sugestão para o site: ',
  // Caminho de remoção para quem chega pela Central de Transparência sem saber
  // de qual projeto a foto é. O caminho principal continua sendo o botão no
  // rodapé de cada evento, que já vem com o projeto identificado.
  remocao: 'Gostaria de solicitar a remoção de uma foto minha. Evento (se souber): ',
};

// KV counters are plain strings, so a corrupted/absent value must never become
// A implementação mora em utils.js (o flush de contadores precisa dela e não
// pode importar daqui em círculo). Reexportada para não quebrar quem já
// importava daqui — inclusive os testes que prendem o contrato dos
// valores-veneno.
export { toCount };

// ---------------------------------------------------------------------------
// Segredo de assinatura dos tokens sem estado
// ---------------------------------------------------------------------------
// Um único segredo cobre o nonce de página do /api/drive-link e o token dos
// formulários públicos; `purpose` no payload separa os usos.
//
// Sem o segredo configurado, os dois controles ficam DESLIGADOS em vez de
// recusarem tudo. Essa escolha é deliberada e vai contra o "fail closed" que o
// resto do arquivo segue, então merece justificativa: um segredo ausente é erro
// de configuração de deploy, e fail-closed aqui significaria "ninguém baixa
// foto nenhuma e nenhum formulário envia" — uma indisponibilidade total do site
// causada por um controle *adicional*, colocado em cima de defesas que
// continuam de pé (Turnstile fail-closed, rate limit, consentimento). O
// contrapeso é não deixar isso silencioso: `auditSite()` acusa a falta, ela
// aparece em /api/healthz e no painel de status até alguém rodar
//
//     npx wrangler secret put SIGNING_SECRET
//
// A troca do segredo invalida os tokens em voo (visitante recarrega a página, o
// cliente já trata `nonce_expired` recarregando sozinho). É o comportamento
// desejado numa rotação.
// Piso de tamanho para a chave HMAC. Um segredo de 8 caracteres não é um
// segredo: dá para varrer o espaço inteiro offline a partir de um único token
// assinado, e aí o atacante forja nonce de Drive e token de formulário à
// vontade — pior do que ter o controle desligado, porque o painel diria que
// está ligado. 32 caracteres aleatórios é o piso que torna isso inviável.
export const SIGNING_SECRET_MIN_LENGTH = 32;

// Fonte ÚNICA da verdade sobre o estado do segredo.
//
// Antes existiam duas decisões separadas: `signingSecret()` para usar a chave e
// `!!env.SIGNING_SECRET` para relatar o estado no /api/healthz e no painel. Duas
// checagens do mesmo fato divergem no dia em que uma muda — e a que diverge aqui
// é a do relatório, ou seja, o painel passaria a dizer "protegido" sobre um
// segredo que o código de assinatura recusa. Agora as duas leem daqui.
//
// O que é recusado, e por quê:
//
//  - **Vazio.** `wrangler secret put` aceita valor vazio sem reclamar, então
//    "criei o secret" e "o secret existe" não são a mesma coisa. Um segredo
//    criado vazio é indistinguível de nenhum segredo — e tem que ser tratado
//    como nenhum, não como configurado.
//  - **Só espaço em branco / quebra de linha.** É o resultado de colar valor no
//    terminal. Seria truthy em JS e viraria uma chave HMAC de verdade, com o
//    painel jurando que está tudo certo. É o pior dos três estados possíveis:
//    o falso verde.
//  - **Curto demais.** Ver acima.
//
// O valor é normalizado com trim() antes de virar chave, para que um newline
// colado por acidente não produza uma chave diferente da que a pessoa acha que
// configurou.
// Cada estado tem uma mensagem PRÓPRIA, e isso não é preciosismo de texto.
//
// A primeira versão dizia "ausente ou vazio" para os dois casos, e isso custou
// caro na prática: com o secret aparecendo na lista do painel e o site lendo
// vazio, a mensagem não dizia se o binding não existia ou se existia com valor
// em branco — que pedem ações opostas (criar vs. recriar com o valor certo).
// Pior: o painel da Cloudflare **não mostra o valor de um secret**, então esta
// mensagem é a única coisa no mundo capaz de distinguir os dois. Uma mensagem
// de diagnóstico que junta dois estados é meio diagnóstico.
export function signingSecretProblem(env) {
  const raw = env?.SIGNING_SECRET;

  if (raw === undefined || raw === null) {
    return 'NÃO EXISTE neste Worker — o binding não chegou (confira se salvou no Worker certo)';
  }
  if (typeof raw !== 'string') {
    return `tipo inesperado (${typeof raw}) — esperado texto`;
  }
  if (raw === '') {
    return 'EXISTE neste Worker, mas o valor está VAZIO — recrie colando o valor';
  }

  const limpo = raw.trim();
  if (!limpo) {
    return `EXISTE, mas só contém espaço em branco (${raw.length} caractere(s)) — recrie colando o valor`;
  }
  if (limpo.length < SIGNING_SECRET_MIN_LENGTH) {
    return `curto demais (${limpo.length} de ${SIGNING_SECRET_MIN_LENGTH} caracteres) — o valor entrou cortado`;
  }
  return null;
}

function signingSecret(env) {
  return signingSecretProblem(env) ? null : env.SIGNING_SECRET.trim();
}

// Janela do nonce de página do Drive. Generosa de propósito: o gate é o último
// passo de uma leitura de Termos, e ninguém deve perder o acesso porque leu com
// calma. Duas horas ainda deixam o token inútil como ferramenta de varredura no
// dia seguinte.
export const DRIVE_NONCE_TTL_SECS = 7200;

// Formulários públicos: janela longa (a pessoa pode escrever devagar) com piso
// de 3 s. O piso é o que pega automação — um bot preenche e envia em
// milissegundos; humano nenhum lê um formulário e envia em menos de 3 s.
export const FORM_TOKEN_TTL_SECS = 7200;
export const FORM_TOKEN_MIN_AGE_SECS = 3;

export async function mintDriveNonce(env, slug) {
  const secret = signingSecret(env);
  if (!secret) return '';
  return signToken(secret, { purpose: 'drive', scope: slug, ttlSecs: DRIVE_NONCE_TTL_SECS });
}

// `preAged` emite um token que já nasce com a idade mínima cumprida.
//
// Serve para as re-renderizações de erro do formulário de suporte. Sem isso,
// cada erro devolve um token novinho, e quem esqueceu de marcar a caixa de
// consentimento — corrige e clica em dois segundos — leva "envio rápido demais"
// por cima do erro anterior. O piso de idade existe para pegar automação no
// primeiro envio, não para punir quem já está na segunda tentativa.
//
// Funciona porque verifyToken deriva o instante de emissão de `exp - ttlSecs`:
// assinar com um TTL menor faz o token parecer mais velho do que é. O prazo
// final encurta pelos mesmos 3 s, o que é irrelevante numa janela de 2 h.
export async function mintFormToken(env, form, { preAged = false } = {}) {
  const secret = signingSecret(env);
  if (!secret) return '';
  return signToken(secret, {
    purpose: 'form',
    scope: form,
    ttlSecs: preAged ? FORM_TOKEN_TTL_SECS - FORM_TOKEN_MIN_AGE_SECS : FORM_TOKEN_TTL_SECS,
  });
}

// HEAD tem de responder exatamente como GET — mesmo status, mesmos cabeçalhos,
// sem corpo (RFC 9110 §9.3.2). Todas as rotas abaixo casam com `method ===
// 'GET'`, então um HEAD caía no 404: `GET /` devolvia 200 e `HEAD /` devolvia
// 404 na mesma URL.
//
// Não é preciosismo de especificação. Monitor de uptime, verificador de link e
// parte dos crawlers pedem HEAD justamente para não baixar o corpo; para todos
// eles o site inteiro parecia fora do ar. Foi assim que o smoke test do deploy
// falhou: ele lê os cabeçalhos com `curl -sI`, recebeu a resposta 404 — que não
// leva nonce, porque não tem script inline — e reprovou a checagem de nonce.
// O sintoma apontava para a CSP; a causa era o método.
//
// A implementação delega ao roteamento normal com um GET equivalente e descarta
// o corpo. Custa a mesma leitura de KV que um GET, o que é correto: a promessa
// do HEAD é que os cabeçalhos sejam os mesmos, e cabeçalho inventado sem passar
// pelo handler mente sobre status e tipo.
function stripBody(res) {
  return new Response(null, { status: res.status, statusText: res.statusText, headers: res.headers });
}

// Referência nomeada, e não `this.fetch`: `this` some se alguém desestruturar
// o handler (`const { fetch } = worker`), e o HEAD voltaria a 404 de um jeito
// que nenhum teste de rota pegaria.
const worker = {
  // `interno` NÃO vem da rede: o Workers chama `fetch(request, env, ctx)` com
  // três argumentos, então o quarto só existe quando somos nós mesmos chamando
  // logo abaixo. É o que torna a flag inforjável — um cliente não consegue
  // pedir para não ser contado, porque não existe cabeçalho para isso.
  async fetch(request, env, ctx, interno = {}) {
    if (request.method.toUpperCase() === 'HEAD') {
      const asGet = new Request(request.url, { method: 'GET', headers: request.headers });
      return stripBody(await worker.fetch(asGet, env, ctx, { headOnly: true }));
    }
    const url = new URL(request.url);
    const path = url.pathname.replace(/\/+$/, '') || '/';
    const method = request.method.toUpperCase();

    try {
      // --- CSRF: um único portão antes do roteamento ---------------------
      // Colocado aqui, e não em cada handler, porque o modo de falha desse
      // controle é o esquecimento: uma rota nova escrita daqui a um ano não
      // pode depender de alguém lembrar de chamar o guard. Todo método que
      // muda estado passa por este ponto, sem exceção declarada em lugar
      // nenhum. Ver isCrossSiteRequest() para por que SameSite=Strict no
      // cookie não bastava.
      if (method !== 'GET' && method !== 'HEAD' && isCrossSiteRequest(request)) {
        return jsonErr('Origem não permitida.', 403);
      }

      // Nonce por requisição para os <script> inline. Gerado uma vez e usado
      // tanto no cabeçalho CSP quanto na marcação, para que os dois não possam
      // divergir (um nonce no HTML que não bate com o do cabeçalho é
      // exatamente igual a não ter nonce nenhum).
      const nonce = generateNonce();
      // PWA assets
      if (path === '/manifest.json' && method === 'GET') return handleManifest();
      if (path === '/icon.svg' && method === 'GET') return handleIcon();
      if (path === '/og-coming-soon.png' && method === 'GET') return handleComingSoonOgImage();

      // SEO
      if (path === '/sitemap.xml' && method === 'GET') return handleSitemap(env);
      if (path === '/robots.txt' && method === 'GET') return handleRobots();
      if (path === '/llms.txt' && method === 'GET') return handleLlmsTxt();

      // Security contact (RFC 9116)
      if (path === '/.well-known/security.txt' && method === 'GET') return handleSecurityTxt();
      // Global Privacy Control — declares the site honors GPC opt-out signals
      if (path === '/.well-known/gpc.json' && method === 'GET') return handleGpc();

      // Gallery index
      if (path === '/' && method === 'GET') return handleGallery(env, nonce);

      // Dashboard routes
      if (path === '/dashboard' && method === 'GET') return handleDashboardPage(request, env, url, nonce);
      if (path === '/dashboard/login' && method === 'POST') return handleLogin(request, env, ctx);
      if (path === '/dashboard/logout' && method === 'POST') return handleLogout(request, env, ctx);

      // API routes (require auth)
      if (path === '/api/events' && method === 'POST') return handleCreateEvent(request, env);
      if (path === '/api/events/bulk-category' && method === 'POST') return handleBulkCategory(request, env);
      if (path === '/api/events/bulk-access' && method === 'POST') return handleBulkAccessType(request, env);
      if (path.startsWith('/api/events/') && method === 'PUT') return handleUpdateEvent(request, env, path);
      if (path.startsWith('/api/events/') && method === 'DELETE') return handleDeleteEvent(request, env, path);
      if (path === '/api/categories' && method === 'GET') return handleGetCategories(request, env);
      if (path === '/api/categories' && method === 'POST') return handleCreateCategory(request, env);
      if (path === '/api/categories/delete' && method === 'POST') return handleDeleteCategory(request, env);
      if (path === '/api/metrics' && method === 'GET') return handleMetrics(request, env);
      if (path === '/api/settings/password' && method === 'PUT') return handleChangePassword(request, env, ctx);
      if (path === '/api/backup' && method === 'GET') return handleGetBackup(request, env);
      if (path === '/api/backup/restore' && method === 'POST') return handleRestoreBackup(request, env);
      if (path === '/api/consent/export' && method === 'GET') return handleConsentExport(request, env);

      // Health check — tests Worker startup, KV connectivity, and hashing performance
      if (path === '/api/healthz' && method === 'GET') return handleHealthz(request, env);

      // Support page. ?tema= pre-fills the message field (used by the "reportar
      // bug"/"sugestão" links on the new-interface banner and footer) — cosmetic
      // only, never trusted server-side.
      if (path === '/suporte' && method === 'GET') {
        // Object.hasOwn: sem ele, `?tema=toString` acha Object.prototype.toString
        // e o textarea abre pré-preenchido com "function toString() { [native
        // code] }". Inofensivo, mas é lixo visível numa página de suporte.
        const tema = url.searchParams.get('tema');
        const msg = tema && Object.hasOwn(TEMA_PREFILLS, tema) ? TEMA_PREFILLS[tema] : undefined;
        return html(supportHTML(false, '', msg ? { message: msg } : {}, nonce, await mintFormToken(env, 'suporte')), 200, nonce);
      }
      if (path === '/api/suporte' && method === 'POST') return handleSupportRequest(request, env, nonce, ctx);

      // Privacy policy
      if (path === '/privacidade' && method === 'GET') return html(privacyHTML(), 200, nonce);

      // Terms of use
      if (path === '/termos' && method === 'GET') return html(termsHTML(), 200, nonce);

      // Central de Transparência — hub de privacidade/termos/segurança/conformidade.
      // /compliance responde igual: é o termo que alguém de fora procuraria.
      if ((path === '/legal' || path === '/compliance') && method === 'GET') return html(legalHTML(), 200, nonce);

      // Cada documento de conformidade tem página própria. Nada aqui manda o
      // visitante para fora do site: ler a política que rege os próprios dados
      // não pode depender de abrir outro serviço.
      const docMatch = path.match(/^\/legal\/([a-z0-9-]+)$/);
      if (docMatch && method === 'GET') {
        const doc = findDoc(docMatch[1]);
        return doc ? html(docHTML(doc), 200, nonce) : notFound();
      }

      // About page
      if (path === '/sobre' && method === 'GET') return html(aboutHTML(), 200, nonce);

      // Gear list
      if (path === '/equipamentos' && method === 'GET') return html(gearHTML(), 200, nonce);

      // Public API
      if (path === '/api/removal-request' && method === 'POST') return handleRemovalRequest(request, env);
      if (path === '/api/track-drive' && method === 'POST') return handleTrackDrive(request, env, ctx);
      if (path === '/api/perf' && method === 'POST') return handlePerfBeacon(request, env);
      if (path === '/api/drive-link' && method === 'POST') return handleDriveLink(request, env, ctx);
      if (path === '/api/csp-report' && method === 'POST') return handleCspReport(request, env);

      // Admin API — removal requests
      if (path === '/api/removal-requests' && method === 'GET') return handleGetRemovalRequests(request, env);
      const resolveMatch = path.match(/^\/api\/removal-requests\/([a-f0-9]+)\/resolve$/);
      if (resolveMatch && method === 'PUT') return handleResolveRequest(request, env, resolveMatch[1]);

      // Event detail pages — must be last
      const slugMatch = path.match(/^\/([a-z0-9][a-z0-9-]*)$/);
      if (slugMatch && method === 'GET') return handleEventPage(request, env, slugMatch[1], ctx, nonce, interno.headOnly === true);

      return notFound();
    } catch (err) {
      console.error(err);
      // Best-effort admin alert — never lets an alerting failure affect the
      // response the visitor actually gets (fire-and-forget, own try/catch
      // inside sendErrorAlert too; this .catch is just an extra backstop).
      ctx.waitUntil(sendErrorAlert(env, err, { path, method }).catch(() => {}));
      return serverError();
    }
  },

  // Daily cron: purge resolved removal requests past the retention window so
  // personal data (e-mail/phone) is not kept indefinitely. Configured in
  // wrangler.toml ([triggers] crons).
  async scheduled(event, env, ctx) {
    // Heartbeat first: stamp the wall-clock the cron last fired so /api/healthz
    // (and the status dashboard) can detect a *silently dead* schedule — a job
    // that stops running emits no error, so without this beat the failure is
    // invisible until data quietly stops being pruned.
    ctx.waitUntil(env.FOTOS.put('cron:last', new Date().toISOString()).catch(e => console.error('cron heartbeat failed', e)));
    // Descarrega o que sobrou pendente nos contadores. Sem isto, o resto de uma
    // janela que não chegou a completar se perde quando o isolate morre — e o
    // fim do dia (justamente o rabo de um lançamento) é quando o tráfego cai e
    // ninguém dispara o flush.
    ctx.waitUntil(flushCounters(env).catch(e => noteKvFailure('escrita', e, 'flush de contadores no cron')));
    ctx.waitUntil(pruneResolvedRemovalRequests(env).catch(e => {
      console.error('retention prune failed', e);
      return sendErrorAlert(env, e, { path: 'cron:pruneResolvedRemovalRequests' }).catch(() => {});
    }));
    ctx.waitUntil(pruneOldConsent(env).catch(e => {
      console.error('consent prune failed', e);
      return sendErrorAlert(env, e, { path: 'cron:pruneOldConsent' }).catch(() => {});
    }));
  },
};

export default worker;

// ---------------------------------------------------------------------------
// Gallery
// ---------------------------------------------------------------------------
async function handleGallery(env, nonce) {
  const events = await getEvents(env);
  const res = html(galleryHTML(events, env.CF_ANALYTICS_TOKEN ?? null, nonce), 200, nonce);
  // Agent/crawler discovery hints (RFC 8288)
  res.headers.set('Link', `<${SITE_URL}/>; rel="canonical", <${SITE_URL}/sitemap.xml>; rel="sitemap"`);
  return res;
}

// ---------------------------------------------------------------------------
// SEO: sitemap.xml + robots.txt
// ---------------------------------------------------------------------------
async function handleSitemap(env) {
  const events = await getEvents(env);
  const visible = events.filter(e => e.visible !== false);
  const lastmodOf = e => String(e.updatedAt || e.date || e.createdAt || '').slice(0, 10);

  const urls = [
    `  <url><loc>${SITE_URL}/</loc></url>`,
    `  <url><loc>${SITE_URL}/sobre</loc></url>`,
    `  <url><loc>${SITE_URL}/equipamentos</loc></url>`,
    `  <url><loc>${SITE_URL}/privacidade</loc></url>`,
    `  <url><loc>${SITE_URL}/termos</loc></url>`,
    `  <url><loc>${SITE_URL}/legal</loc></url>`,
    ...LEGAL_DOCS.map(d => `  <url><loc>${SITE_URL}/legal/${d.slug}</loc></url>`),
    `  <url><loc>${SITE_URL}/suporte</loc></url>`,
  ];
  for (const e of visible) {
    const lastmod = lastmodOf(e);
    urls.push(
      `  <url><loc>${SITE_URL}/${escape(e.slug)}</loc>${lastmod ? `<lastmod>${lastmod}</lastmod>` : ''}</url>`
    );
  }
  const xml = `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls.join('\n')}\n</urlset>\n`;
  return new Response(xml, {
    headers: { ...dataSecurityHeaders('application/xml; charset=utf-8', { store: true }), 'Cache-Control': 'public, max-age=3600' },
  });
}

function handleRobots() {
  // Open to all crawlers and AI agents (training, search, live answering) —
  // no disallow rules. /dashboard and /api/ aren't gated by robots.txt (that's
  // advisory, not access control); they're protected by login + rate limiting.
  const aiAgents = [
    'GPTBot', 'OAI-SearchBot', 'ChatGPT-User', 'Google-Extended',
    'ClaudeBot', 'Claude-Web', 'Claude-User', 'Claude-SearchBot', 'anthropic-ai',
    'PerplexityBot', 'CCBot', 'Bytespider', 'Amazonbot', 'Applebot-Extended',
    'Meta-ExternalAgent', 'cohere-ai',
  ];
  const rules = 'Allow: /\n';
  const body =
    '# robots.txt — fotos.lucafchala.com\n' +
    '# RFC 9309 (https://www.rfc-editor.org/rfc/rfc9309).\n' +
    '# Content usage preferences — all uses permitted (https://contentsignals.org).\n\n' +
    'User-agent: *\n' +
    'Content-Signal: search=yes, ai-train=yes, ai-input=yes\n' +
    rules + '\n' +
    aiAgents.map(a => `User-agent: ${a}`).join('\n') + '\n' +
    rules + '\n' +
    `Sitemap: ${SITE_URL}/sitemap.xml\n`;
  return new Response(body, {
    headers: { ...dataSecurityHeaders('text/plain; charset=utf-8', { store: true }), 'Cache-Control': 'public, max-age=86400' },
  });
}

function handleLlmsTxt() {
  // llms.txt provides machine-readable guidelines for LLM scrapers (RFC draft).
  // Complements robots.txt with explicit data usage policies.
  const body =
    'Allow: *\n' +
    'Disallow: /dashboard\n' +
    'Disallow: /api\n' +
    'Disallow: /.well-known\n\n' +
    '# LLM Usage Policy\n' +
    'User-Agent: *\n' +
    'Allow-User-Agent: GPTBot, ClaudeBot, PerplexityBot, Amazonbot, OAI-SearchBot\n' +
    'Crawl-delay: 1\n' +
    'Request-limit: 100/1h\n\n' +
    '# Data usage declaration\n' +
    'Usage-Policy: Training allowed. Image-use consent required for sensitive content.\n' +
    'Source: https://fotos.lucafchala.com\n' +
    'Maintainer: Luca F. Chala <security@lucafchala.com>\n';
  return new Response(body, {
    headers: { ...dataSecurityHeaders('text/plain; charset=utf-8', { store: true }), 'Cache-Control': 'public, max-age=86400' },
  });
}

function handleSecurityTxt() {
  const body =
    'Contact: mailto:security@lucafchala.com\n' +
    'Expires: ' + new Date(Date.now() + 365 * 86400_000).toISOString() + '\n' +
    'Encryption: https://keys.openpgp.org/vks/v1/by-fingerprint/48E73F6FA2871E7B86EFEA648EC4329A369B7B33\n' +
    `Canonical: ${SITE_URL}/.well-known/security.txt\n` +
    'Preferred-Languages: en, pt-BR\n';
  return new Response(body, {
    headers: { ...dataSecurityHeaders('text/plain; charset=utf-8', { store: true }), 'Cache-Control': 'public, max-age=86400' },
  });
}

function handleGpc() {
  // This site never sells or shares personal data, so the GPC "do not
  // sell/share" opt-out is honored by default. https://globalprivacycontrol.org
  const body = JSON.stringify({ gpc: true, lastUpdate: '2026-06-16' });
  return new Response(body, {
    headers: { ...dataSecurityHeaders('application/json; charset=utf-8', { store: true }), 'Cache-Control': 'public, max-age=86400' },
  });
}

// ---------------------------------------------------------------------------
// Event page
// ---------------------------------------------------------------------------
async function handleEventPage(request, env, slug, ctx, nonce, headOnly = false) {
  const events = await getEvents(env);
  const event = events.find(e => e.slug === slug);
  if (!event) return notFound();

  // Projeto marcado como "não visível" é NÃO LISTADO, não privado: sai da
  // galeria, do sitemap e da auditoria, mas continua abrindo por link direto.
  // Isso é intencional — é o que faz o link de prévia enviado a um cliente
  // continuar funcionando —, só que a expectativa de quem clica em "Ocultar"
  // pode ser outra. Enquanto a semântica não for decidida (registrado no
  // TODO), no mínimo o projeto não pode ser indexado: sem isto, "oculto" some
  // da galeria e reaparece no Google.
  const unlisted = event.visible === false;

  const year = event.date ? event.date.slice(0, 4) : String(new Date(event.createdAt || event.updatedAt || 0).getFullYear());

  // Only count view once per hour per visitor (avoids KV read+write on repeat visits).
  // KV read-modify-write is not atomic, so concurrent visits can undercount —
  // these are soft analytics, not hard metrics.
  const cookieName = `fv_${slug}`;
  //
  // HEAD não conta. O HEAD é resolvido reexecutando a rota como GET, então sem
  // esta exceção todo HEAD sem cookie gastava uma ESCRITA em KV — e HEAD é o
  // método que monitor de uptime e verificador de link usam. Um monitor de
  // minuto em minuto são 1440 escritas/dia contra uma cota de 1000/dia no
  // plano free: o contador de visitas sozinho derrubaria eventos, sessões e
  // consentimento. E ainda inflaria a contagem pública com robô.
  //
  // O Set-Cookie também fica de fora: emitido numa resposta de HEAD, ele
  // marcaria o visitante como "já contado" e o GET seguinte — o de verdade —
  // não contaria. É uma divergência mínima entre os cabeçalhos de HEAD e GET,
  // aceita de propósito, e é o único ponto em que os dois não são idênticos.
  const alreadyCounted = (request.headers.get('Cookie') || '').includes(`${cookieName}=1`);
  if (!alreadyCounted && !headOnly) {
    // Agregado, não gravado na hora: era UMA escrita por visitante, o que fazia
    // o custo do site crescer junto com o público contra uma cota fixa. Agora
    // os incrementos se somam na memória do isolate e viram uma escrita por
    // janela — ver bumpCounter() em utils.js. O cookie de 1 h continua sendo o
    // que evita contar a mesma pessoa duas vezes.
    bumpCounter(env, ctx, `views:${slug}`);
  }

  // Nonce de página: assinado agora, para este slug, e gasto no
  // /api/drive-link. É o que amarra "pedi o link do Drive" a "carreguei esta
  // página" — sem ele, um token Turnstile válido servia para varrer slugs.
  const [driveNonce, removalFormToken] = await Promise.all([
    mintDriveNonce(env, slug),
    mintFormToken(env, 'remocao'),
  ]);

  const res = html(
    eventHTML(event, year, env.CF_ANALYTICS_TOKEN ?? null, nonce, driveNonce, removalFormToken),
    200,
    nonce
  );
  if (unlisted) res.headers.set('X-Robots-Tag', 'noindex, nofollow, noarchive');
  if (!alreadyCounted && !headOnly) res.headers.append('Set-Cookie', `${cookieName}=1; Max-Age=3600; Path=/${slug}; SameSite=Lax`);
  return res;
}

// ---------------------------------------------------------------------------
// Dashboard page
// ---------------------------------------------------------------------------
async function handleDashboardPage(request, env, url, nonce) {
  const stored = await getAdminHash(env);
  if (!stored) {
    return adminHtml('<p style="font-family:monospace;padding:40px">Painel não configurado — defina o secret <code>ADMIN_PASSWORD</code> no Worker.</p>', 503, nonce);
  }

  const authed = await verifySession(env, request);
  if (!authed) {
    const hasError = url.searchParams.get('error') === '1';
    return adminHtml(loginHTML({ error: hasError }, nonce), 200, nonce);
  }

  const [events, categories] = await Promise.all([getEvents(env, true), getCategories(env)]);
  return adminHtml(dashboardHTML(events, categories, nonce), 200, nonce);
}

// ---------------------------------------------------------------------------
// Login
// ---------------------------------------------------------------------------
export async function handleLogin(request, env, ctx) {
  const ip = request.headers.get('CF-Connecting-IP') || 'unknown';

  // Dois limites em vez de um. O antigo (10 por 10 min) segura a rajada, mas
  // deixa passar ~1400 tentativas por dia vindas do mesmo IP — folgado demais
  // para uma senha só. O limite diário fecha essa conta sem atrapalhar quem
  // erra a senha algumas vezes de manhã e volta à tarde.
  // Em série, e com saída antecipada: `checkRateLimit` INCREMENTA quando
  // deixa passar. Chamar os dois de uma vez fazia uma tentativa já barrada
  // pelo limite de rajada consumir também o orçamento diário — 60 tentativas
  // "gastas" dez vezes mais rápido do que o pretendido, e um IP compartilhado
  // (NAT de escola, operadora móvel) trancava o dono do painel por 24 h com um
  // minuto de tráfego.
  const burstOk = await checkRateLimit(env, ip, 'login', 10, 600);
  if (!burstOk) {
    // Sem noteFailedLogin aqui: ele faz leitura + escrita em KV, e a cota é de
    // 1000 escritas/dia para a conta inteira. Contabilizar tentativa já barrada
    // deixava mil POSTs não autenticados esgotarem a cota e derrubarem o que
    // importa — salvar evento, abrir sessão, gravar consentimento. Quem foi
    // barrado já está contido; não precisa custar escrita.
    return redirect('/dashboard?error=1');
  }
  if (!await checkRateLimit(env, ip, 'login-day', 60, 86400)) {
    return redirect('/dashboard?error=1');
  }

  let body;
  try {
    const text = await request.text();
    body = Object.fromEntries(new URLSearchParams(text));
  } catch {
    return redirect('/dashboard?error=1');
  }

  const password = body.password || '';
  const stored = await getAdminHash(env);

  // No trust-on-first-use: with no stored credential and no ADMIN_PASSWORD
  // secret, login is impossible rather than claimable by the first visitor.
  //
  // O hash roda mesmo sem credencial armazenada. Sem isso, um deploy sem
  // ADMIN_PASSWORD responde na hora, enquanto um configurado leva ~50 ms de
  // PBKDF2 — diferença medível de fora, que entrega se o painel tem dono. Não
  // é o achado mais grave do mundo, mas o conserto custa uma linha.
  const ok = stored
    ? await verifyPassword(password, stored)
    : (await hashPassword(password), false);
  if (!ok) {
    ctx?.waitUntil(noteFailedLogin(env, request, ip).catch(() => {}));
    return redirect('/dashboard?error=1');
  }
  // Migrate legacy SHA-256 hash to PBKDF2 on first successful login. Isolada:
  // a migração é oportunista, e falhar nela não pode impedir um login com senha
  // já conferida — na próxima vez ela tenta de novo.
  if (!stored.startsWith('pbkdf2:')) {
    await env.FOTOS.put('admin_password', await hashPassword(password))
      .catch(e => noteKvFailure('escrita', e, 'migração do hash da senha'));
  }

  const token = generateToken();
  // Esta escrita é a única do fluxo que NÃO dá para contornar: sem sessão
  // gravada não há login, e servir uma sessão "de mentira" seria pior do que
  // recusar. Mas o 500 cru que ela produzia era o pior dos dois mundos — o dono
  // via uma tela de erro genérica no meio de um incidente de KV, e o healthz
  // continuava verde porque ninguém registrava a falha.
  //
  // Agora: registra (o healthz passa a acusar) e devolve o mesmo redirect de
  // erro do resto do login, que a tela de login sabe exibir.
  try {
    await env.FOTOS.put(`admin_session:${token}`, sessionRecord(request), { expirationTtl: SESSION_TTL_SECS });
  } catch (e) {
    noteKvFailure('escrita', e, 'abertura de sessão do painel');
    return redirect('/dashboard?error=1');
  }

  const headers = new Headers({
    ...dataSecurityHeaders('text/plain; charset=utf-8'),
    Location: '/dashboard',
  });
  headers.append('Set-Cookie', sessionCookie(token));
  // Mata o cookie legado no MESMO passo em que emite o novo. O logout já fazia
  // isso; o login não, e essa assimetria era o bug: quem tinha `session=` de
  // antes da migração recebia o `__Host-session` novo com o antigo ainda vivo
  // ao lado, e ficava em loop de login enquanto o legado não expirasse.
  // Reemitir com Max-Age=0 é a única forma de apagá-lo — não dá para "não
  // enviar" um cookie que já está no browser.
  headers.append('Set-Cookie', 'session=; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=0');

  return new Response(null, { status: 302, headers });
}

// Contador de falhas por IP, só para alertar (o bloqueio é o rate limit acima).
// Ao cruzar o piso, dispara um e-mail — com cooldown próprio dentro de
// sendLoginAlert, então uma força bruta longa não vira flood. Tudo em
// waitUntil: a resposta ao visitante nunca espera por isto.
const LOGIN_ALERT_THRESHOLD = 5;
const LOGIN_ALERT_WINDOW_SECS = 900;

async function noteFailedLogin(env, request, ip) {
  const window = Math.floor(Date.now() / (LOGIN_ALERT_WINDOW_SECS * 1000));
  const key = `login-fail:${ip}:${window}`;
  const attempts = toCount(await env.FOTOS.get(key)) + 1;
  // Isolada: com a cota de escrita estourada, uma exceção aqui pularia
  // justamente o alerta de força bruta. A contagem já está em `attempts`.
  await env.FOTOS.put(key, String(attempts), { expirationTtl: LOGIN_ALERT_WINDOW_SECS })
    .catch(e => noteKvFailure('escrita', e, 'login-fail counter'));
  // `>=`, não `==`: o contador é KV, não atômico e de consistência eventual.
  // Numa força bruta paralela — exatamente o caso que o alerta existe para
  // pegar — duas requisições concorrentes leem o mesmo valor, e o contador
  // pula de 4 para 6 sem nunca ser igual a 5. O alerta silenciava justamente
  // no ataque mais sério. O flood continua contido pelo cooldown dentro de
  // sendLoginAlert.
  if (attempts >= LOGIN_ALERT_THRESHOLD) {
    await sendLoginAlert(env, {
      ip,
      attempts,
      windowMins: Math.round(LOGIN_ALERT_WINDOW_SECS / 60),
      userAgent: (request.headers.get('User-Agent') || '').slice(0, 200),
    });
  }
}

// Stored credential, seeded from the ADMIN_PASSWORD secret when KV is empty
// (fresh deploy / wiped namespace) so there is never an open setup window.
async function getAdminHash(env) {
  const stored = await env.FOTOS.get('admin_password');
  if (stored) return stored;
  if (env.ADMIN_PASSWORD) {
    const hash = await hashPassword(env.ADMIN_PASSWORD);
    await env.FOTOS.put('admin_password', hash);
    return hash;
  }
  return null;
}

// ---------------------------------------------------------------------------
// Logout
// ---------------------------------------------------------------------------
export async function handleLogout(request, env, ctx) {
  const cookies = request.headers.get('Cookie') || '';
  const match = cookies.match(/(?:^|;\s*)(?:__Host-)?session=([a-f0-9]{64})/);
  // Este delete não é limpeza, é a revogação. O cookie sai do browser logo
  // abaixo de qualquer forma, então quem clicou em "sair" vê a tela de login e
  // acredita ter saído — enquanto o token continua aceito pelo servidor até o
  // TTL de 24 h. Delete gasta cota de escrita do KV, então o dia de tráfego
  // grande é justamente o dia em que sair do painel pode parar de revogar.
  // Falhar aqui não pode interromper o logout (deixar o admin logado no browser
  // é pior), mas também não pode ser um `console.error` que ninguém lê.
  if (match) {
    await env.FOTOS.delete(`admin_session:${match[1]}`).catch(e => {
      noteDegraded(
        'logout não revogou a sessão',
        'o KV recusou apagar o registro; o cookie saiu do browser, mas o token segue válido até expirar sozinho',
        e,
      );
      // O aviso por e-mail não segura a resposta: o logout já falhou uma vez,
      // não vai também ficar lento por causa do aviso.
      ctx?.waitUntil(sendErrorAlert(env, e, { path: 'POST /dashboard/logout (session delete)' }).catch(() => {}));
    });
  }

  const headers = new Headers(dataSecurityHeaders('text/plain; charset=utf-8'));
  headers.set('Location', '/dashboard');
  // Os dois nomes: o `__Host-` atual e o `session` legado, senão um cookie
  // antigo sobreviveria ao logout e continuaria sendo enviado.
  headers.append('Set-Cookie', sessionCookie('', { clear: true }));
  headers.append('Set-Cookie', 'session=; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=0');
  // Limpa também o que ficou no browser: cache de páginas do painel,
  // localStorage e o resto. Sem isto, "sair" num computador emprestado deixa
  // a última tela do painel recuperável pelo botão voltar.
  headers.set('Clear-Site-Data', '"cache", "cookies", "storage"');

  return new Response(null, { status: 302, headers });
}

// ---------------------------------------------------------------------------
// Event field normalization (shared by create + update)
// ---------------------------------------------------------------------------
const EVENT_STATUSES = ['em-edicao', 'em-revisao', 'entregue', 'arquivado'];

// Fallback values for a brand-new event and for any field a legacy event is
// missing. Create passes this as the base; update passes the existing event.
export const DEFAULT_EVENT = {
  title: '', longDescription: '',
  driveUrl: '', driveUrlInstagram: '', date: '', eventCredits: '',
  projectUrl: '', visible: true, comingSoon: false, status: 'entregue',
  accessType: 'public', category: '', internalNotes: '', pinned: false,
  photosAlert: { active: false, addedAt: null, expiresAfterHours: 24 },
};

// Fill any field absent (undefined/null) on an existing event with the default,
// so the normalizer's fallbacks are always well-defined for legacy records.
function withEventDefaults(ev) {
  const out = { ...DEFAULT_EVENT };
  for (const k of Object.keys(DEFAULT_EVENT)) {
    if (ev[k] !== undefined && ev[k] !== null) out[k] = ev[k];
  }
  return out;
}

function normalizePhotosAlert(pa, fallback) {
  return pa && typeof pa === 'object'
    ? { active: pa.active === true, addedAt: pa.addedAt || null, expiresAfterHours: parseInt(pa.expiresAfterHours) || 0 }
    : fallback;
}

// Normalize the scalar/flag fields common to create and update. A field present
// in `body` is sanitized; an absent one falls back to `base` (DEFAULT_EVENT on
// create, the existing event on update). Callers handle id/slug/photos/
// thumbnail/timestamps separately. `cats` is the list of valid categories.
export function normalizeEventFields(body, base, cats) {
  const b = withEventDefaults(base);
  const pick = (key, norm) => (body[key] !== undefined ? norm(body[key]) : b[key]);
  return {
    title: pick('title', v => String(v).slice(0, 200)),
    longDescription: pick('longDescription', v => String(v).slice(0, 5000)),
    driveUrl: pick('driveUrl', v => toHttps(String(v).slice(0, 500))),
    driveUrlInstagram: pick('driveUrlInstagram', v => (v ? toHttps(String(v).slice(0, 500)) : '')),
    date: pick('date', v => (/^\d{4}-\d{2}-\d{2}$/.test(v) ? v : '')),
    eventCredits: pick('eventCredits', v => String(v).slice(0, 200)),
    projectUrl: pick('projectUrl', v => (v ? toHttps(String(v).slice(0, 500)) : '')),
    visible: pick('visible', v => v !== false),
    comingSoon: pick('comingSoon', v => v === true),
    status: pick('status', v => (EVENT_STATUSES.includes(v) ? v : b.status)),
    accessType: pick('accessType', v => (ACCESS_TYPES.includes(v) ? v : b.accessType)),
    category: pick('category', v => (cats.includes(v) ? v : b.category)),
    internalNotes: pick('internalNotes', v => String(v).slice(0, 5000)),
    pinned: pick('pinned', v => v === true),
    photosAlert: body.photosAlert !== undefined ? normalizePhotosAlert(body.photosAlert, b.photosAlert) : b.photosAlert,
  };
}

// Map a photos array to sanitized https URLs (max 6). Shared by create + update.
function normalizePhotos(arr) {
  return arr.slice(0, 6).map(u => toHttps(String(u).slice(0, 500))).filter(Boolean);
}

// ---------------------------------------------------------------------------
// API: Create event
// ---------------------------------------------------------------------------
async function handleCreateEvent(request, env) {
  const authErr = await checkAuth(request, env);
  if (authErr) return authErr;

  let body;
  try { body = await request.json(); } catch { return jsonErr('JSON inválido.', 400); }

  const { slug, title, driveUrl } = body;
  if (!slug || !validateSlug(slug)) return jsonErr('URL inválida.', 400);
  if (!title || typeof title !== 'string') return jsonErr('Título obrigatório.', 400);
  if (!driveUrl || typeof driveUrl !== 'string') return jsonErr('Link do Drive obrigatório.', 400);

  const events = await getEvents(env, true);
  if (events.find(e => e.slug === slug)) return jsonErr('Já existe um evento com essa URL.', 409);
  const cats = await getCategories(env);

  const photos = Array.isArray(body.photos)
    ? normalizePhotos(body.photos)
    : (body.thumbnailUrl ? [toHttps(String(body.thumbnailUrl).slice(0, 500))] : []);

  const event = {
    id: generateId(),
    slug,
    ...normalizeEventFields(body, DEFAULT_EVENT, cats),
    photos,
    thumbnailUrl: photos[0] || '',
    createdAt: new Date().toISOString(),
  };

  events.push(event);
  await saveEvents(env, events);
  return jsonOk(event, 201);
}

// ---------------------------------------------------------------------------
// API: Update event
// ---------------------------------------------------------------------------
async function handleUpdateEvent(request, env, path) {
  const authErr = await checkAuth(request, env);
  if (authErr) return authErr;

  const id = path.replace('/api/events/', '');
  let body;
  try { body = await request.json(); } catch { return jsonErr('JSON inválido.', 400); }

  const events = await getEvents(env, true);
  const idx = events.findIndex(e => e.id === id);
  if (idx === -1) return jsonErr('Evento não encontrado.', 404);

  const existing = events[idx];
  const cats = await getCategories(env);

  const newPhotos = body.photos !== undefined && Array.isArray(body.photos)
    ? normalizePhotos(body.photos)
    : (existing.photos || []);

  const updated = {
    ...existing,
    ...normalizeEventFields(body, existing, cats),
    photos: newPhotos,
    thumbnailUrl: newPhotos[0] || existing.thumbnailUrl || '',
    updatedAt: new Date().toISOString(),
  };

  // Allow slug update only if no other event uses it
  if (body.slug && body.slug !== existing.slug) {
    if (!validateSlug(body.slug)) return jsonErr('URL inválida.', 400);
    if (events.some((e, i) => i !== idx && e.slug === body.slug)) return jsonErr('URL já está em uso.', 409);
    updated.slug = body.slug;
  }

  if (updated.pinned) {
    for (let i = 0; i < events.length; i++) {
      if (i !== idx) events[i] = { ...events[i], pinned: false };
    }
  }
  events[idx] = updated;
  await saveEvents(env, events);
  return jsonOk(updated);
}

// ---------------------------------------------------------------------------
// API: Delete event
// ---------------------------------------------------------------------------
async function handleDeleteEvent(request, env, path) {
  const authErr = await checkAuth(request, env);
  if (authErr) return authErr;

  const id = path.replace('/api/events/', '');
  const events = await getEvents(env, true);
  const idx = events.findIndex(e => e.id === id);
  if (idx === -1) return jsonErr('Evento não encontrado.', 404);

  const [removed] = events.splice(idx, 1);
  await saveEvents(env, events);
  await env.FOTOS.delete(`views:${removed.slug}`).catch(e => console.error('view-counter cleanup failed', e));
  return jsonOk({ deleted: true });
}

// ---------------------------------------------------------------------------
// API: Categories (list / create / delete) + bulk category assignment
// ---------------------------------------------------------------------------
async function handleGetCategories(request, env) {
  const authErr = await checkAuth(request, env);
  if (authErr) return authErr;
  return jsonOk({ categories: await getCategories(env) });
}

async function handleCreateCategory(request, env) {
  const authErr = await checkAuth(request, env);
  if (authErr) return authErr;

  let body;
  try { body = await request.json(); } catch { return jsonErr('JSON inválido.', 400); }

  const name = String(body.name || '').trim().replace(/\s+/g, ' ').slice(0, MAX_CATEGORY_LEN);
  if (!name) return jsonErr('Nome da categoria obrigatório.', 400);

  const cats = await getCategories(env);
  if (cats.some(c => c.toLowerCase() === name.toLowerCase())) {
    return jsonErr('Já existe uma categoria com esse nome.', 409);
  }
  if (cats.length >= MAX_CATEGORIES) return jsonErr(`Máximo de ${MAX_CATEGORIES} categorias.`, 409);

  cats.push(name);
  await saveCategories(env, cats);
  return jsonOk({ categories: cats }, 201);
}

async function handleDeleteCategory(request, env) {
  const authErr = await checkAuth(request, env);
  if (authErr) return authErr;

  let body;
  try { body = await request.json(); } catch { return jsonErr('JSON inválido.', 400); }

  const name = String(body.name || '');
  const cats = await getCategories(env);
  if (!cats.includes(name)) return jsonErr('Categoria não encontrada.', 404);

  const remaining = cats.filter(c => c !== name);
  await saveCategories(env, remaining);

  // Clear the deleted category from any event that referenced it.
  const events = await getEvents(env, true);
  let cleared = 0;
  for (const e of events) {
    if (e.category === name) { e.category = ''; e.updatedAt = new Date().toISOString(); cleared++; }
  }
  if (cleared > 0) await saveEvents(env, events);

  return jsonOk({ categories: remaining, cleared });
}

async function handleBulkCategory(request, env) {
  const authErr = await checkAuth(request, env);
  if (authErr) return authErr;

  let body;
  try { body = await request.json(); } catch { return jsonErr('JSON inválido.', 400); }

  const ids = Array.isArray(body.ids) ? body.ids.map(String) : [];
  if (ids.length === 0) return jsonErr('Nenhum evento selecionado.', 400);

  const category = String(body.category || '');
  const cats = await getCategories(env);
  if (category !== '' && !cats.includes(category)) return jsonErr('Categoria inválida.', 400);

  const idSet = new Set(ids);
  const events = await getEvents(env, true);
  let updated = 0;
  for (const e of events) {
    if (idSet.has(e.id) && e.category !== category) {
      e.category = category;
      e.updatedAt = new Date().toISOString();
      updated++;
    }
  }
  if (updated > 0) await saveEvents(env, events);
  return jsonOk({ updated, category });
}

async function handleBulkAccessType(request, env) {
  const authErr = await checkAuth(request, env);
  if (authErr) return authErr;

  let body;
  try { body = await request.json(); } catch { return jsonErr('JSON inválido.', 400); }

  const ids = Array.isArray(body.ids) ? body.ids.map(String) : [];
  if (ids.length === 0) return jsonErr('Nenhum evento selecionado.', 400);

  const accessType = body.accessType;
  if (!ACCESS_TYPES.includes(accessType)) return jsonErr('Tipo de acesso inválido.', 400);

  const idSet = new Set(ids);
  const events = await getEvents(env, true);
  let updated = 0;
  for (const e of events) {
    if (idSet.has(e.id) && (e.accessType || 'public') !== accessType) {
      e.accessType = accessType;
      e.updatedAt = new Date().toISOString();
      updated++;
    }
  }
  if (updated > 0) await saveEvents(env, events);
  return jsonOk({ updated, accessType });
}

// ---------------------------------------------------------------------------
// API: Metrics
// ---------------------------------------------------------------------------
// ---------------------------------------------------------------------------
async function handleMetrics(request, env) {
  const authErr = await checkAuth(request, env);
  if (authErr) return authErr;

  const events = await getEvents(env, true);
  const metrics = await Promise.all(
    events.map(async e => {
      const [v, d] = await Promise.all([
        env.FOTOS.get(`views:${e.slug}`),
        env.FOTOS.get(`drive_clicks:${e.slug}`),
      ]);
      return {
        slug: e.slug,
        title: e.title,
        // NaN here would silently corrupt the sort below (and render as "NaN"
        // in the dashboard table), so coerce unparseable counters to 0.
        views: toCount(v),
        driveClicks: toCount(d),
      };
    })
  );
  metrics.sort((a, b) => b.views - a.views);
  return jsonOk(metrics);
}

// ---------------------------------------------------------------------------
// API: Track Drive click (public)
// ---------------------------------------------------------------------------
export async function handleTrackDrive(request, env, ctx) {
  // Ordem importa por causa da cota: `checkRateLimit` GRAVA em KV, e a cota é
  // de 1000 escritas/dia para a conta inteira. Com o rate limit na frente, todo
  // POST de lixo neste endpoint — que é público, aceita corpo qualquer e passa
  // pelo portão de CSRF quando o cliente não manda cabeçalho de browser
  // (decisão deliberada, ver isCrossSiteRequest) — custava uma escrita sem
  // nunca contar nada: 60 por IP por hora, de graça, contra a mesma cota de que
  // dependem evento, sessão e consentimento. É a mesma conta que já tinha sido
  // feita no handleLogin, e a mesma resposta: o que é grátis vem primeiro.
  //
  // Agora nada aqui grava antes de saber que existe um clique real para contar:
  // corpo, formato do slug e existência do evento são de graça (o getEvents tem
  // cache de isolate e leitura tem cota 100× maior). O rate limit continua
  // valendo para quem passa por tudo isso, que é o único caso capaz de gastar.
  let body;
  try { body = await request.json(); } catch { return jsonOk({ ok: true }); }
  const slug = String(body.slug || '').slice(0, 60);
  if (!slug || !validateSlug(slug)) return jsonOk({ ok: true });

  // `comingSoon` entra aqui pelo mesmo motivo que entra no portão do Drive: um
  // projeto anunciado antes das fotos é o mais divulgado do site e o mais fácil
  // de achar, e a página dele nem desenha o botão do Drive — então clique
  // nenhum pode vir dela. O que chegasse aqui seria POST direto, gastando duas
  // escritas e inflando a métrica de um projeto que não entregou foto nenhuma.
  const events = await getEvents(env);
  const event = events.find(e => e.slug === slug);
  if (!event || event.comingSoon) return jsonOk({ ok: true });

  // O rate limit continua aqui, e a tentativa de tirá-lo foi um erro que vale
  // registrar: o raciocínio era "a agregação virou o limite, um flood não gera
  // escrita a mais". Não fecha. A agregação grava uma vez por JANELA, e a
  // janela é de 10 s — um flood sustentado são 6 escritas/min, 360/hora,
  // ~8600/dia numa cota de 1000/dia. Ela reduz o custo por requisição, não o
  // custo por hora, e é justamente o custo por hora que um atacante controla.
  // Sem limite por IP, o endpoint público vira a maneira mais barata de
  // esvaziar a cota que este PR inteiro existe para proteger — e ainda deixa
  // `drive_clicks` forjável por curl, já que o portão de CSRF passa quem não
  // manda cabeçalho de browser.
  //
  // O que MUDOU e continua valendo: ele agora roda depois das checagens de
  // graça, então POST de lixo custa zero escrita. O ganho era esse; o limite
  // nunca foi o problema.
  const ip = request.headers.get('CF-Connecting-IP') || 'unknown';
  if (!await checkRateLimit(env, ip, 'drive', 60, 3600)) return jsonOk({ ok: true });

  // O ctx vem do roteador: sem ele, o flush que acabou de ESVAZIAR o mapa podia
  // ser descartado junto com a requisição, e o lote sumia sem nunca ser tentado
  // de novo.
  const work = bumpCounter(env, ctx, `drive_clicks:${slug}`);
  if (work && !(ctx && typeof ctx.waitUntil === 'function')) await work;
  return jsonOk({ ok: true });
}

// Recebe o beacon de performance real dos visitantes (um por visita, amostrado
// a 10% no cliente — ver perfBootScript em utils.js).
//
// Deliberadamente NÃO escreve em KV. A cota gratuita é de 1000 escritas/dia e é
// compartilhada com a status page; gastá-la para guardar telemetria deixaria o
// site sem escritas para o que importa (eventos, sessões, consentimento). O
// destino é log estruturado, que o Cloudflare já coleta de graça — visível em
// `wrangler tail` e em Workers Logs — e, opcionalmente, um dataset do Analytics
// Engine quando o binding PERF existir. Sem o binding, nada quebra.
//
// Sem rate limit por KV de propósito: checkRateLimit faz leitura+escrita em KV,
// o que custaria mais do que o próprio beacon economiza. O que limita o volume
// aqui é a amostragem no cliente, e o corpo é validado e truncado abaixo.
export async function handlePerfBeacon(request, env) {
  // sendBeacon não espera resposta; 204 encerra sem corpo.
  const done = () => new Response(null, { status: 204 });

  // Barato e sem estado, ao contrário de um rate limit por KV: se o browser
  // mandou um Origin (sendBeacon manda, em POST), ele tem que bater com o host
  // que serviu a página. Corta outro site despejando beacons forjados no
  // dataset a partir de visitantes reais.
  //
  // Comparado contra o host do próprio request, não contra SITE_URL: o mesmo
  // Worker atende o domínio de produção, a rota workers.dev (usada pelos smoke
  // tests do deploy) e o localhost do `wrangler dev` — fixar o domínio
  // descartaria silenciosamente os beacons dos outros dois.
  //
  // Origin ausente passa de propósito: nem todo cliente manda o header, e
  // barrar por ausência quebraria beacons legítimos sem barrar um atacante
  // (curl simplesmente omite o header).
  const origin = request.headers.get('Origin');
  if (origin) {
    let sameOrigin;
    try { sameOrigin = new URL(origin).host === new URL(request.url).host; } catch { sameOrigin = false; }
    if (!sameOrigin) return done();
  }

  let body;
  try { body = await request.json(); } catch { return done(); }
  if (!body || typeof body !== 'object') return done();

  // Só números plausíveis passam: o corpo vem do cliente e pode ser forjado.
  // Um valor absurdo aqui envenenaria a média sem que nada pareça quebrado.
  const num = (v, max) => (typeof v === 'number' && Number.isFinite(v) && v >= 0 && v <= max ? Math.round(v) : null);
  const nav = body.nav && typeof body.nav === 'object' ? body.nav : {};
  const sample = {
    page: body.page === 'event' ? 'event' : 'gallery',
    fcp: num(body.fcp, 120000),
    lcp: num(body.lcp, 120000),
    ttfb: num(nav.ttfb, 120000),
    load: num(nav.load, 300000),
    imgCount: num(body.imgCount, 500),
    imgP50: num(body.imgP50, 300000),
    imgP95: num(body.imgP95, 300000),
    filterMs: num(body.filterMs, 60000),
    navCount: num(body.navCount, 10000),
    vw: num(body.vw, 20000),
    colo: request.cf?.colo ?? null,
    country: request.cf?.country ?? null,
  };

  console.log(`perf ${JSON.stringify(sample)}`);

  if (env.PERF && typeof env.PERF.writeDataPoint === 'function') {
    try {
      env.PERF.writeDataPoint({
        blobs: [sample.page, sample.colo, sample.country],
        doubles: [sample.fcp, sample.lcp, sample.ttfb, sample.imgP50, sample.imgP95, sample.filterMs].map(v => v ?? -1),
        indexes: [sample.page],
      });
    } catch (e) { console.error('perf writeDataPoint failed', e); }
  }
  return done();
}

// ---------------------------------------------------------------------------
// Support page form submission (public)
// ---------------------------------------------------------------------------
export async function handleSupportRequest(request, env, nonce, ctx) {
  const ip = request.headers.get('CF-Connecting-IP') || 'unknown';

  // Toda resposta de erro precisa de um token novo, senão o visitante corrige o
  // que errou e esbarra num token já gasto/expirado na segunda tentativa.
  // `ok` distingue a tela de sucesso da re-renderização com erro. No caso de
  // erro o token sai pré-envelhecido, para que corrigir e reenviar depressa não
  // esbarre no piso de idade — ver mintFormToken().
  const page = async (ok, error = '', values = {}, status = 200) =>
    html(
      supportHTML(ok, error, values, nonce, await mintFormToken(env, 'suporte', { preAged: !ok })),
      status,
      nonce
    );

  const allowed = await checkRateLimit(env, ip, 'support', 5, 3600);
  if (!allowed) {
    return page(false, 'Muitas mensagens enviadas. Tente mais tarde.', {}, 429);
  }

  let name, email, message, tsToken, consent, honeypot, formToken;
  const ct = request.headers.get('Content-Type') || '';
  if (ct.includes('application/x-www-form-urlencoded') || ct.includes('multipart/form-data')) {
    const fd = await request.formData().catch(() => null);
    if (!fd) return page(false, 'Erro ao processar formulário.', {}, 400);
    name = String(fd.get('name') || '').trim().slice(0, 120);
    email = String(fd.get('email') || '').trim().slice(0, 200);
    message = String(fd.get('message') || '').trim().slice(0, 2000);
    tsToken = String(fd.get('cf-turnstile-response') || '');
    consent = String(fd.get('consent') || '');
    honeypot = String(fd.get(HONEYPOT_FIELD) || '');
    formToken = String(fd.get('form_token') || '');
  } else {
    let body;
    try { body = await request.json(); } catch { return jsonErr('JSON inválido.', 400); }
    name = String(body.name || '').trim().slice(0, 120);
    email = String(body.email || '').trim().slice(0, 200);
    message = String(body.message || '').trim().slice(0, 2000);
    tsToken = String(body['cf-turnstile-response'] || '');
    consent = String(body.consent || '');
    honeypot = String(body[HONEYPOT_FIELD] || '');
    formToken = String(body.form_token || '');
  }

  // Echo the submitted values back on every validation failure so a stumble
  // (e.g. a Turnstile hiccup) never makes the visitor retype their message.
  const values = { name, email, message };

  // Bot que preencheu a isca: mostra a tela de sucesso e não envia nada. Dizer
  // "deu errado" só ajudaria a calibrar o bot.
  if (honeypotTripped(honeypot)) return page(true);

  const formSecret = signingSecret(env);
  if (formSecret) {
    const t = await verifyToken(formSecret, formToken, {
      purpose: 'form',
      scope: 'suporte',
      ttlSecs: FORM_TOKEN_TTL_SECS,
      minAgeSecs: FORM_TOKEN_MIN_AGE_SECS,
    });
    if (!t.ok) {
      // 'too-fast' é quase sempre automação, mas um humano com autofill muito
      // rápido cairia aqui também — daí a mensagem pedir só para reenviar.
      const msg = t.reason === 'too-fast'
        ? 'Envio rápido demais. Tente novamente.'
        : 'O formulário expirou. Recarregue a página e envie novamente.';
      return page(false, msg, values, 403);
    }
  }

  const tsOk = await verifyTurnstile(tsToken, env);
  if (!tsOk) return page(false, 'Verificação de segurança falhou. Recarregue a página e tente novamente.', values, 403);

  if (consent !== '1') {
    return page(false, 'É necessário concordar com a política de privacidade.', values, 400);
  }

  if (!message) {
    return page(false, 'A mensagem não pode estar vazia.', values, 400);
  }

  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email)) {
    return page(false, 'E-mail inválido.', values, 400);
  }

  // Supressão de repetição. O Turnstile barra robô, não a pessoa que aperta
  // enviar cinco vezes com a mesma mensagem — e o resultado disso é a mesma
  // mensagem cinco vezes na caixa de entrada. A chave é o hash da mensagem por
  // IP; a resposta é a tela de sucesso, porque para quem enviou o pedido de
  // fato chegou (da primeira vez).
  const dupKey = `support-dup:${ip}:${await shortHash(message)}`;
  if (await env.FOTOS.get(dupKey)) return page(true);

  // A marca de "já recebi esta mensagem" só é gravada DEPOIS de o envio dar
  // certo. Gravá-la antes cria um jeito silencioso de perder mensagem: se o
  // Resend falhar, o visitante vê a tela de sucesso, reenvia o mesmo texto, o
  // dedupe engole o reenvio, e a mensagem nunca chega a lugar nenhum. Assim,
  // uma falha de envio deixa o reenvio funcionar.
  let sent = false;
  let falha = null;
  try {
    sent = await sendSupportEmail(env, { name, email, message });
  } catch (e) {
    falha = e;
  }
  if (sent) await env.FOTOS.put(dupKey, '1', { expirationTtl: 3600 }).catch(() => {});

  if (!sent) {
    // A mensagem só existe no e-mail: diferente do pedido de remoção, que fica
    // gravado, aqui não há cópia nenhuma. Um envio que falhou é uma mensagem
    // perdida — e a tela de sucesso fazia o visitante ir embora achando que
    // tinha chegado. É a mesma escolha que `getEvents()` já faz ao propagar em
    // vez de devolver lista vazia: mentir sobre ter o dado é pior que admitir
    // a falha. Os valores voltam preenchidos, então reenviar não custa
    // redigitar, e a mensagem dá o endereço direto para quem não quiser tentar
    // de novo.
    noteDegraded(
      'mensagem de suporte não enviada',
      'o Resend recusou o envio; o formulário de /suporte não está entregando mensagem nenhuma',
      falha,
    );
    ctx?.waitUntil(sendErrorAlert(env, falha || new Error('sendSupportEmail returned false'),
      { path: 'POST /suporte (send)' }).catch(() => {}));
    return page(
      false,
      'Não conseguimos enviar sua mensagem agora. Tente novamente em alguns minutos ou escreva direto para suporte@lucafchala.com.',
      values,
      503,
    );
  }

  return page(true);
}

// Hash curto para chaves de KV (dedupe). Não é segredo, só precisa espalhar bem.
async function shortHash(text) {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return Array.from(new Uint8Array(buf).slice(0, 8)).map(b => b.toString(16).padStart(2, '0')).join('');
}

// ---------------------------------------------------------------------------
// API: Change password
// ---------------------------------------------------------------------------
export async function handleChangePassword(request, env, ctx) {
  const authErr = await checkAuth(request, env);
  if (authErr) return authErr;

  let body;
  try { body = await request.json(); } catch { return jsonErr('JSON inválido.', 400); }

  const { password } = body;
  // A regra antiga era "6 caracteres", o que aceita "123456". O painel dá
  // acesso ao log de consentimento e aos pedidos de remoção — e-mail e telefone
  // de titulares —, então a credencial precisa aguentar um ataque offline se o
  // hash algum dia vazar. Ver validatePassword() para o raciocínio de cada
  // regra (e por que uma frase longa dispensa a exigência de símbolos).
  const check = validatePassword(password);
  if (!check.ok) return jsonErr(check.error, 400);

  const hash = await hashPassword(password);
  await env.FOTOS.put('admin_password', hash);

  // Changing the password is the standard reaction to "I think someone got in".
  // Without this sweep the stolen cookie stayed valid for up to 24 h, so the
  // change gave a false sense of having locked the intruder out. Every other
  // session is revoked; the caller's own session is kept so the admin isn't
  // bounced to the login screen mid-action. Best-effort: a KV hiccup here must
  // not fail the password change that already succeeded above.
  try {
    const cookies = request.headers.get('Cookie') || '';
    const currentToken = (cookies.match(/(?:^|;\s*)(?:__Host-)?session=([a-f0-9]{64})/) || [])[1];
    const { keys } = await env.FOTOS.list({ prefix: 'admin_session:' });
    await Promise.all(
      keys
        .filter(k => k.name !== `admin_session:${currentToken}`)
        .map(k => env.FOTOS.delete(k.name))
    );
  } catch (e) {
    // Trocar a senha é o que se faz quando se desconfia que ela vazou, e a
    // varredura é o que expulsa quem já estava dentro. Se ela falha, a senha
    // nova passa a valer e as sessões antigas continuam abrindo o painel por
    // até 24 h — com o admin vendo "ok" e acreditando ter fechado a porta.
    // O Promise.all acima também rejeita no primeiro delete que falhar, então
    // a varredura pode ter sido parcial. Não desfaz a troca de senha (ela deu
    // certo), mas não pode ficar só num console.error.
    noteDegraded(
      'troca de senha não encerrou as outras sessões',
      'o KV recusou apagar os registros; a senha nova já vale, mas sessões antigas seguem abertas até expirarem',
      e,
    );
    ctx?.waitUntil(sendErrorAlert(env, e, { path: 'PUT /api/settings/password (session sweep)' }).catch(() => {}));
  }

  return jsonOk({ ok: true });
}

// ---------------------------------------------------------------------------
// API: Removal request (public)
// ---------------------------------------------------------------------------
async function handleRemovalRequest(request, env) {
  const ip = request.headers.get('CF-Connecting-IP') || 'unknown';
  const allowed = await checkRateLimit(env, ip, 'removal', 5, 3600);
  if (!allowed) return jsonErr('Muitas solicitações. Tente mais tarde.', 429);

  let body;
  try { body = await request.json(); } catch { return jsonErr('JSON inválido.', 400); }

  // Honeypot antes de qualquer trabalho caro: se o campo isca veio preenchido,
  // é bot, e a resposta é um 200 comum de propósito — um 4xx aqui só ensinaria
  // ao autor do bot que existe um campo a evitar.
  if (honeypotTripped(body[HONEYPOT_FIELD])) return jsonOk({ ok: true });

  // Token de formulário: prova que este POST veio de um /<slug> que nós
  // renderizamos, e não de um script batendo direto no endpoint. O piso de
  // idade (3 s) derruba automação que preenche e envia instantaneamente.
  const formSecret = signingSecret(env);
  if (formSecret) {
    // `form_token`, com underline: é o nome que o cliente envia (ver
    // src/ui/event.js). Escrito como `formToken` aqui, a verificação lia
    // sempre string vazia e TODO pedido de remoção levava 403 — o canal que a
    // LGPD exige, morto em silêncio, e só depois de o SIGNING_SECRET ser
    // configurado. Há teste cobrindo o envio completo agora.
    const t = await verifyToken(formSecret, String(body.form_token || ''), {
      purpose: 'form',
      scope: 'remocao',
      ttlSecs: FORM_TOKEN_TTL_SECS,
      minAgeSecs: FORM_TOKEN_MIN_AGE_SECS,
    });
    if (!t.ok) {
      return t.reason === 'expired'
        ? jsonErr('O formulário expirou. Recarregue a página e envie novamente.', 410)
        : jsonErr('Não foi possível validar o envio. Recarregue a página e tente novamente.', 403);
    }
  }

  const tsOk = await verifyTurnstile(body.turnstileToken, env);
  if (!tsOk) return jsonErr('Verificação de segurança falhou. Recarregue e tente novamente.', 403);

  if (body.consent !== true) return jsonErr('É necessário concordar com a política de privacidade.', 400);

  const { eventSlug, method, value, email, phone, message, fileName, fileBase64 } = body;
  if (!eventSlug || !method) return jsonErr('Dados incompletos.', 400);
  if (!['number', 'url', 'upload'].includes(method)) return jsonErr('Método inválido.', 400);
  if (method !== 'upload' && (!value || !String(value).trim())) return jsonErr('Identificação obrigatória.', 400);
  if (method === 'upload' && !fileBase64) return jsonErr('Arquivo obrigatório.', 400);
  if (method === 'upload' && fileBase64) {
    // base64 overhead ≈ 4/3; 2 MB raw → ≈ 2.73 MB base64 string
    if (typeof fileBase64 !== 'string' || fileBase64.length > 2_900_000) {
      return jsonErr('Arquivo muito grande (máx. 2 MB).', 413);
    }
    // Confirm it's actually an image (magic bytes), not an arbitrary blob.
    if (!isLikelyImage(fileBase64)) {
      return jsonErr('Envie uma imagem válida (JPEG, PNG ou WebP).', 415);
    }
  }

  // Metadados fora antes de a foto virar anexo de e-mail. Quem manda uma foto
  // pedindo remoção não está oferecendo as coordenadas de GPS de onde ela foi
  // tirada — e nós não precisamos delas para atender ao pedido.
  //
  // O PORTÃO É A PRÓPRIA CAPACIDADE DE LIMPAR, e não uma segunda lista de
  // formatos. `isLikelyImage()` aceita HEIC, AVIF e GIF; `stripImageMetadata()`
  // só sabe limpar JPEG, PNG e WebP. As duas listas divergiam em silêncio, e o
  // resultado era o pior possível: a foto de quem pede remoção saía por e-mail
  // com o GPS intacto, enquanto a política de privacidade publicada afirmava,
  // sem ressalva, que os metadados são apagados. HEIC é o padrão do iPhone,
  // então esse era o caminho comum, não o exótico.
  //
  // Manter duas listas em sintonia é uma promessa que se quebra sozinha. Aqui
  // não há lista: se `stripped` voltar falso, por qualquer motivo, a foto não
  // vai. Suportar HEIC no futuro passa a ser só ensinar stripImageMetadata —
  // este portão abre junto, sem ninguém lembrar de nada.
  let photoMeta = null;
  let cleanFileBase64 = fileBase64;
  if (method === 'upload' && fileBase64) {
    const stripped = stripImageMetadata(fileBase64);
    if (!stripped.stripped) {
      // Duas causas com conselhos OPOSTOS, e mandar o conselho errado é pior
      // que não dar conselho:
      //
      //  - Formato que não sabemos limpar (HEIC, AVIF, GIF) → converter resolve.
      //  - Formato que sabemos limpar mas cujo arquivo saiu fora do padrão →
      //    "converta para JPEG" é absurdo para quem acabou de mandar um JPEG.
      //    Os parsers aqui abortam ao primeiro byte fora de lugar, de
      //    propósito: preferimos recusar a devolver uma imagem corrompida.
      const sabemosLimpar = ['jpeg', 'png', 'webp'].includes(stripped.format);
      return jsonErr(
        sabemosLimpar
          ? `Este arquivo ${stripped.format.toUpperCase()} tem uma estrutura fora do padrão e não ` +
            'consegui apagar os metadados dele com segurança — e não envio foto sem apagá-los, ' +
            'porque costumam incluir a localização por GPS. Abra a foto, salve/exporte de novo ' +
            '(ou tire um print dela) e envie o novo arquivo. Ou identifique a foto pelo ' +
            'número/link, sem anexo.'
          : `Não consigo apagar os metadados de um arquivo ${stripped.format.toUpperCase()}, e não ` +
            'envio foto sem apagá-los — eles costumam incluir a localização por GPS de onde ela ' +
            'foi tirada. Converta para JPEG, PNG ou WebP e envie de novo. No iPhone: Ajustes → ' +
            'Câmera → Formatos → "Mais compatível". Ou identifique a foto pelo número/link, ' +
            'sem anexo.',
        415
      );
    }
    cleanFileBase64 = stripped.base64;
    photoMeta = { stripped: stripped.stripped, format: stripped.format };
  }

  const emailTrimmed = String(email || '').trim().toLowerCase();
  if (!emailTrimmed || !/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(emailTrimmed)) {
    return jsonErr('E-mail inválido.', 400);
  }
  const phoneTrimmed = String(phone || '').trim();
  const phoneDigits = phoneTrimmed.replace(/\D/g, '');
  if (!phoneTrimmed || phoneDigits.length < 10 || phoneDigits.length > 13) {
    return jsonErr('Número de telefone inválido (inclua o DDD).', 400);
  }

  const events = await getEvents(env);
  const event  = events.find(e => e.slug === eventSlug);

  const req = {
    id:         generateId(),
    eventSlug,
    eventTitle: event?.title || eventSlug,
    method,
    value:      method !== 'upload' ? String(value || '').slice(0, 500) : null,
    email:      emailTrimmed.slice(0, 200),
    phone:      phoneTrimmed.slice(0, 50),
    message:    String(message || '').slice(0, 1000),
    fileName:   method === 'upload' ? String(fileName || 'foto').slice(0, 200) : null,
    fileBase64: method === 'upload' ? cleanFileBase64 : null,
    resolved:   false,
    createdAt:  new Date().toISOString(),
  };

  // Store request (without binary file)
  const stored = await getRemovalRequests(env);
  // Defensive retention: drop resolved requests past the window even if the
  // daily cron has not run yet.
  const cutoff = Date.now() - REMOVAL_RETENTION_DAYS * 86400_000;
  const requests = stored.filter(r => r.resolved
    ? new Date(r.resolvedAt || r.createdAt || 0).getTime() >= cutoff
    : true);
  // Hold a reference to the new record: the MAX_REQUESTS trim below reorders the
  // array, so we can't rely on it staying last. The trim always keeps it (it's
  // unresolved), and writing email statuses onto this reference persists because
  // the same object is still inside `requests` when re-serialized.
  // O binário nunca é gravado em KV — só viaja no e-mail. `photoMeta` guarda o
  // resultado da limpeza para que, ao revisar o pedido, dê para saber se a foto
  // chegou sem metadado ou se o formato não permitiu tratar.
  const newReq = { ...req, fileBase64: null, photoMeta };
  requests.push(newReq);

  const MAX_REQUESTS = 500;
  trimRequests(requests, MAX_REQUESTS);

  await env.FOTOS.put('removal_requests', JSON.stringify(requests));

  // Send notification to admin.
  //
  // O pedido já está gravado acima, então nada se perde — mas o AVISO é o que
  // faz alguém agir dentro do prazo, e um pedido de remoção é exercício de
  // direito do titular, com relógio correndo. Falhar aqui deixava o pedido
  // parado no painel esperando que o dono resolvesse abrir a tela por conta
  // própria. Vai para o registro de degradações, que o healthz publica e o
  // painel de status transforma em alerta.
  try {
    const sent = await sendRemovalEmail(env, req);
    newReq.emailStatus = sent ? 'sent' : 'skipped: RESEND_API_KEY não configurada';
    if (!sent) {
      noteDegraded(
        'pedido de remoção sem aviso por e-mail',
        'RESEND_API_KEY não configurada. O pedido está salvo no painel, mas ninguém foi avisado'
      );
    }
  } catch (err) {
    // O detalhe do erro fica AQUI — no próprio pedido, que só o painel lê — e
    // não no aviso. A mensagem vem do corpo cru da resposta da Resend, e o
    // e-mail carregava nome, e-mail, telefone e mensagem de um titular
    // exercendo direito sobre os próprios dados. Repetir isso no log
    // compartilhado não acrescenta nada que o painel já não mostre, e espalha
    // dado pessoal por um lugar a mais.
    newReq.emailStatus = 'error: ' + String(err.message || err).slice(0, 200);
    noteDegraded(
      'pedido de remoção sem aviso por e-mail',
      'o envio falhou. O pedido está salvo no painel, com o motivo no campo emailStatus'
    );
  }

  // Send confirmation to requester
  try {
    const sent = await sendConfirmationEmail(env, req);
    newReq.confirmEmailStatus = sent ? 'sent' : null;
  } catch (err) {
    newReq.confirmEmailStatus = 'error: ' + String(err.message || err).slice(0, 200);
  }

  await env.FOTOS.put('removal_requests', JSON.stringify(requests));

  return jsonOk({ ok: true });
}

// Cap stored removal requests: keep every unresolved request, plus the most
// recent resolved ones up to `max`. Mutates `requests` in place (and returns
// it). Unresolved records are always retained — the email-status write in
// handleRemovalRequest relies on the freshly-pushed request surviving this.
export function trimRequests(requests, max) {
  if (requests.length <= max) return requests;

  // `max` é TETO, não sugestão.
  //
  // A versão anterior preservava TODOS os não-resolvidos e só aparava os
  // resolvidos, então o teto não valia quando os não-resolvidos sozinhos já o
  // ultrapassavam. No fluxo normal isso quase nunca acontece — os pedidos
  // chegam devagar e o admin resolve. Mas `handleRestoreBackup` mescla um
  // arquivo arbitrário, e `sanitizeRestoredRequest` marca todo registro
  // restaurado como `resolved: false`: um backup grande passava inteiro,
  // estourava o limite de 25 MB por valor do KV, e a escrita falhava DEPOIS
  // de eventos e categorias já terem sido gravados — restore pela metade.
  //
  // Prioridade continua sendo dos não-resolvidos (são pedidos de titular em
  // aberto, prazo legal correndo). O que muda é que, se nem eles couberem, os
  // mais antigos também caem, em vez de o teto ser ignorado.
  const maisNovoPrimeiro = (a, b) => String(b.createdAt).localeCompare(String(a.createdAt));
  const unresolved = requests.filter(r => !r.resolved).sort(maisNovoPrimeiro);
  const resolved = requests.filter(r => r.resolved).sort(maisNovoPrimeiro);

  requests.splice(0, requests.length, ...[...unresolved, ...resolved].slice(0, max));
  return requests;
}

async function getRemovalRequests(env) {
  const data = await env.FOTOS.get('removal_requests');
  if (!data) return [];
  try { return JSON.parse(data); } catch { return []; }
}

// Drop resolved requests whose resolvedAt is older than the retention window.
// Unresolved requests are always kept. Returns true if anything was removed.
async function pruneResolvedRemovalRequests(env) {
  const requests = await getRemovalRequests(env);
  const cutoff = Date.now() - REMOVAL_RETENTION_DAYS * 86400_000;
  const kept = requests.filter(r => {
    if (!r.resolved) return true;
    const t = new Date(r.resolvedAt || r.createdAt || 0).getTime();
    return t >= cutoff;
  });
  if (kept.length === requests.length) return false;
  await env.FOTOS.put('removal_requests', JSON.stringify(kept));
  return true;
}

async function handleGetRemovalRequests(request, env) {
  const authErr = await checkAuth(request, env);
  if (authErr) return authErr;
  const requests = await getRemovalRequests(env);
  return jsonOk([...requests].sort((a, b) => b.createdAt.localeCompare(a.createdAt)));
}

async function handleResolveRequest(request, env, id) {
  const authErr = await checkAuth(request, env);
  if (authErr) return authErr;
  const requests = await getRemovalRequests(env);
  const idx = requests.findIndex(r => r.id === id);
  if (idx === -1) return jsonErr('Solicitação não encontrada.', 404);

  const req = requests[idx];

  // Send "resolved" email to requester
  let resolvedEmailStatus;
  try {
    const sent = await sendResolvedEmail(env, req);
    resolvedEmailStatus = sent ? 'sent' : null;
  } catch (err) {
    resolvedEmailStatus = 'error: ' + String(err.message || err).slice(0, 200);
  }

  requests[idx] = {
    ...req,
    resolved: true,
    resolvedAt: new Date().toISOString(),
    resolvedEmailStatus,
  };
  await env.FOTOS.put('removal_requests', JSON.stringify(requests));
  return jsonOk(requests[idx]);
}

// ---------------------------------------------------------------------------
// Health check
// ---------------------------------------------------------------------------
// The daily cron fires at 03:00 UTC. If the last heartbeat is older than one
// full day plus slack, the schedule is treated as silently dead.
const CRON_STALE_MS = 26 * 60 * 60 * 1000; // 26h — one daily run + 2h propagation slack

// Pure + unit-tested: is the cron heartbeat stale? A never-written beat
// (null/undefined) is NOT stale — a fresh deploy hasn't reached 03:00 yet, so we
// don't want the status dashboard to cry wolf for the first day. Only an
// existing-but-old beat counts as a real "the cron stopped" signal.
export function cronStale(lastIso, now = Date.now()) {
  if (!lastIso) return false;
  const t = new Date(lastIso).getTime();
  if (!Number.isFinite(t)) return true; // present but unparseable → something wrote garbage
  return now - t > CRON_STALE_MS;
}

// Pure + unit-tested functional self-test, run over the already-loaded events
// array (ZERO extra KV reads) plus env booleans. This is what lets the status
// dashboard flag things that "went wrong" — a bad edit, a broken/missing Google
// Drive link on a live event, or a form whose backend dependency is unset — as
// opposed to only catching a hard 500. It reports *what* is wrong, names the
// offending slug, and nominates one healthy event as a `sample` the dashboard
// can deep-probe (its Drive gate + removal form).
const MAX_SELFTEST_PROBLEMS = 12;
export function auditSite(events, env = {}, degradacoes = []) {
  const problems = [];
  const seen = new Set();
  let driveOk = 0, driveBad = 0, live = 0;
  let sample = null;

  for (const e of (Array.isArray(events) ? events : [])) {
    if (!e || typeof e !== 'object') continue;
    if (e.visible === false) continue; // hidden drafts aren't public — don't audit
    const slug = typeof e.slug === 'string' ? e.slug : '';
    const title = typeof e.title === 'string' ? e.title : '';
    if (!slug) { problems.push(`evento público sem slug${title ? ` ("${title}")` : ''}`); continue; }
    if (seen.has(slug)) problems.push(`slug duplicado: ${slug} (rotas colidem)`); else seen.add(slug);
    if (!title) problems.push(`evento sem título: ${slug}`);
    if (e.status && !EVENT_STATUSES.includes(e.status)) problems.push(`status inválido em ${slug}: ${e.status}`);

    // A live (non-comingSoon) event shows a "baixar fotos" CTA, so its Drive
    // link MUST work. Missing or malformed = Drive access is broken for visitors.
    if (!e.comingSoon) {
      live++;
      const u = typeof e.driveUrl === 'string' ? e.driveUrl : '';
      let valid = /^https:\/\//i.test(u);
      if (valid) { try { new URL(u); } catch { valid = false; } }
      if (!u)            { driveBad++; problems.push(`link do Drive ausente: ${slug}`); }
      else if (!valid)   { driveBad++; problems.push(`link do Drive inválido: ${slug}`); }
      else               { driveOk++; if (!sample) sample = slug; }
    }
  }

  // Form backends (env bindings → zero KV). All three public forms (support,
  // removal, Drive consent) verify a Turnstile token server-side and fail
  // closed, so a missing secret silently breaks every submission.
  const forms = {
    turnstile: !!env.TURNSTILE_SECRET_KEY,
    resend: !!env.RESEND_API_KEY,
    adminEmail: !!env.ADMIN_EMAIL,
    // Mesma função que decide se a chave é usada de fato. Relatar por
    // `!!env.SIGNING_SECRET` seria uma segunda opinião sobre o mesmo fato, e a
    // divergência apareceria como painel verde sobre um segredo recusado.
    signing: signingSecretProblem(env) === null,
  };
  if (!forms.turnstile)  problems.push('Turnstile ausente — suporte/remoção/Drive recusam todos os envios');
  if (!forms.resend)     problems.push('Resend ausente — suporte/remoção não disparam e-mail');
  if (!forms.adminEmail) problems.push('ADMIN_EMAIL ausente — suporte/remoção sem destinatário');
  // Este não quebra nada — por isso precisa aparecer. Sem SIGNING_SECRET o
  // nonce de página do Drive e o token dos formulários ficam desligados em
  // silêncio, e o site segue funcionando como se estivesse protegido. A
  // mensagem diz QUAL é o defeito, porque "ausente" e "criado vazio" levam a
  // ações diferentes — no segundo caso a pessoa jura que já resolveu.
  if (!forms.signing) {
    problems.push(`SIGNING_SECRET ${signingSecretProblem(env)} — nonce do Drive e token dos formulários DESLIGADOS`);
  }

  // Mesma lógica do SIGNING_SECRET acima: nada disto derruba o site, e é
  // exatamente por isso que precisa aparecer. Um site no ar não é prova de que
  // está tudo bem quando ele foi desenhado para continuar servindo enquanto as
  // peças cedem. Cada entrada some sozinha 30 min depois da última ocorrência.
  //
  // Toda degradação registrada entra aqui, sem lista fixa. É o ponto do desenho:
  // quem acrescentar uma degradação nova em qualquer lugar do código chama
  // `noteDegraded()` e ela aparece no painel sozinha — ninguém precisa lembrar
  // de vir editar esta função. Antes eram dois `if` escritos à mão, e o terceiro
  // caso (consentimento) teria sido esquecido exatamente por isso.
  for (const d of (Array.isArray(degradacoes) ? degradacoes : [])) {
    problems.push(`${d.label} (há ${d.agoSecs}s)${d.detail ? ` — ${d.detail}` : ''}`);
  }

  const trimmed = problems.slice(0, MAX_SELFTEST_PROBLEMS);
  if (problems.length > MAX_SELFTEST_PROBLEMS) trimmed.push(`+${problems.length - MAX_SELFTEST_PROBLEMS} outro(s)`);

  return {
    ok: problems.length === 0,
    problems: trimmed,
    drive: { ok: driveOk, bad: driveBad, live },
    forms,
    sample, // a healthy live event slug for the dashboard to deep-probe (or null)
  };
}

export async function handleHealthz(request, env) {
  // No KV rate-limit here on purpose. This endpoint is polled by the status
  // monitor on a schedule, and checkRateLimit() does a KV *write* per call — a
  // scarce, account-wide resource (free tier: 1k writes/day, shared with the
  // rest of the app). The work healthz does is bounded (two KV reads + one
  // PBKDF2 hash) and sits behind Cloudflare's edge/DDoS protection, so the
  // per-call write cost wasn't worth the 10/min cap it bought.
  // --- Core: KV is the binding the whole app depends on, and a read failure
  // here (or a corrupt `events` value) is the ONLY condition that flips ok:false
  // — mirroring the pre-existing 500-on-throw the deploy smoke test relies on
  // (`"ok":true`), while reporting *which* subsystem broke.
  //
  // KV-frugal by design: one read of `events` proves both that the binding
  // responds AND that the main store is a valid array — so we dropped the old
  // throwaway `__healthz__` probe and spend that second read on the cron
  // heartbeat below. Net: still two KV reads per healthz, same as before this
  // diagnostics expansion.
  let kv = false;
  let events = null;
  let eventsList = [];
  const kvT0 = Date.now();
  // `fresh: true` aqui não é só para furar o cache: é o que faz esta leitura
  // NUNCA cair para a cópia de sobrevivência. Ou seja, `kv` reflete o KV de
  // verdade — se ele estiver fora, isto lança e `kv` fica false, como deve ser.
  // A saúde do binding é medida pela própria leitura, não inferida de estado
  // compartilhado com outras requisições.
  try {
    eventsList = await getEvents(env, true);
    kv = true;
    events = Array.isArray(eventsList) ? eventsList.length : null;
  } catch {
    // KV unavailable — kv/events keep their pre-failure values, so ok flips false
  }
  const kvLatencyMs = Date.now() - kvT0;

  // --- D1 consent log (optional/best-effort): a missing or unscoped binding
  // must never fail the deploy (see deploy.yml), so it's reported but never ok. ---
  let d1 = 'absent';
  let d1LatencyMs = null;
  if (env.CONSENT_DB) {
    const t0 = Date.now();
    try {
      await env.CONSENT_DB.prepare('SELECT 1').first();
      d1 = 'ok';
    } catch {
      d1 = 'down';
    }
    d1LatencyMs = Date.now() - t0;
  }

  // --- PBKDF2 — canário do orçamento de CPU do login. ---
  //
  // O hash roda; o tempo dele NÃO é publicado, porque não dá para medi-lo aqui.
  // O Workers congela `Date.now()` durante execução síncrona (mitigação de
  // ataque de temporização): o relógio só anda depois de I/O. Um PBKDF2 de 100k
  // iterações é CPU pura, sem I/O no meio, então `Date.now()` antes e depois
  // devolve o MESMO valor e a conta dava `hashMs: 0` — sempre, em produção,
  // desde que foi escrita. Confirmado no log do último deploy: `hashMs: 0` ao
  // lado de `kvLatencyMs: 6` e `d1LatencyMs: 84`, que passam por I/O e por isso
  // são reais.
  //
  // Zero não é um hash rápido, é um número que não existe — e ele alimentava
  // três portões incapazes de reprovar: o `HASH_MS -gt 200` do deploy.yml, o
  // `hashMs > HASH_BUDGET_MS` do painel de status, e a linha "hash 0ms" que o
  // painel exibia como se fosse desempenho excelente. É a armadilha do
  // RETOMADA §5.7 de novo, no portão que deveria vigiar justamente a CPU.
  //
  // O que de fato protege continua de pé, e é o sinal real: se o hash não
  // couber no orçamento de CPU, o Workers mata a requisição e esta rota
  // responde 5xx. O smoke test cobre isso (healthz `ok:true` + login 302, não
  // 5xx) e o painel de status também (`h.status >= 500` → down). Medir CPU de
  // dentro do isolate não é possível; de fora, quem conta é o 5xx.
  await hashPassword('healthcheck');

  // --- Cron heartbeat (best-effort, one KV read): detects a silently dead daily
  // schedule. This is the second of the two KV reads; the throwaway `__healthz__`
  // probe used to be the second read, so the diagnostics gained a real signal at
  // no extra KV cost. ---
  const cron = await env.FOTOS.get('cron:last').then(last => ({
    lastRunAt: last || null,
    ageHours: last ? Math.round((Date.now() - new Date(last).getTime()) / 3600000) : null,
    stale: cronStale(last),
  })).catch(() => null);

  // --- Functional self-test over the already-loaded events array (ZERO extra KV
  // reads): broken/missing Drive links on live events, bad data, and form
  // backends that are unset. This is what surfaces "something went wrong" on the
  // status dashboard, not just hard 500s. ---
  const selftest = auditSite(eventsList, env, degradedHealth());

  // --- The rest of the extended surface is derived from already-loaded data and
  // env bindings — ZERO additional KV reads. `config` exposes only booleans
  // (which hardening secrets are present), never their values. Backlog/category
  // counts were intentionally dropped here: they cost a KV read each and signal
  // no *failure*, and the status dashboard already covers an unconfigured admin
  // via the /dashboard 503 probe. ---
  const ok = kv && events !== null;
  return jsonOk({
    // Stable contract (smoke test + existing dashboard parsing): keep these names.
    // `hashMs` saiu daqui de propósito — ver o comentário do PBKDF2 acima. Os
    // dois consumidores testam `typeof === 'number'` antes de usar, então a
    // ausência some sozinha em vez de virar "NaN" na tela.
    ok, kv, events, d1,
    // Extended surface (no extra KV reads).
    kvLatencyMs,
    d1LatencyMs,
    cron,
    selftest,
    config: {
      resend: !!env.RESEND_API_KEY,
      turnstile: !!env.TURNSTILE_SECRET_KEY,
      consentDb: !!env.CONSENT_DB,
      adminEmail: !!env.ADMIN_EMAIL,
      // Idem: a mesma pergunta tem uma resposta só no arquivo inteiro.
      signing: signingSecretProblem(env) === null,
    },
    termsVersion: TERMS_VERSION,
    colo: request.cf?.colo || null,
    country: request.cf?.country || null,
    now: new Date().toISOString(),
  }, ok ? 200 : 503);
}

// ---------------------------------------------------------------------------
// Coletor de violações de CSP
// ---------------------------------------------------------------------------
// Recebe os relatórios da política Report-Only (a estrita, sem 'unsafe-inline').
// Serve a dois propósitos, nesta ordem:
//
//  1. Medir a migração. Cada handler inline que sobrou vira um relatório com
//     arquivo e linha. Quando parar de chegar relatório de `script-src-attr`, a
//     política estrita pode virar a enforced sem adivinhação.
//  2. Detectar tentativa de XSS. Um relatório apontando para um script externo
//     que ninguém colocou ali é sinal de injeção — e chega antes de alguém
//     reclamar.
//
// Vai para log estruturado, não para KV. Mesma razão do /api/perf: a cota de
// escrita do KV é de 1000/dia e é compartilhada com eventos, sessões e
// consentimento; um endpoint que qualquer browser pode acionar não pode
// encostar nela. O log o Cloudflare já coleta de graça.
//
// Amostragem no servidor porque este endpoint não é chamado por nós: um browser
// hostil pode despejar relatórios à vontade, e o corpo vem de fora.
const CSP_REPORT_SAMPLE_RATE = 0.2;
const CSP_REPORT_MAX_BYTES = 8192;

export async function handleCspReport(request, env) {
  const done = () => new Response(null, { status: 204, headers: dataSecurityHeaders('text/plain; charset=utf-8') });
  if (Math.random() >= CSP_REPORT_SAMPLE_RATE) return done();

  let raw;
  try { raw = await request.text(); } catch { return done(); }
  if (!raw || raw.length > CSP_REPORT_MAX_BYTES) return done();

  let parsed;
  try { parsed = JSON.parse(raw); } catch { return done(); }

  // Dois formatos convivem: `report-uri` manda {"csp-report": {...}} e
  // `report-to`/Reporting API manda um array de {type, body}. Aceitar os dois
  // evita depender de qual deles o browser do visitante implementa.
  const reports = Array.isArray(parsed)
    ? parsed.filter(r => r && r.type === 'csp-violation').map(r => r.body || {})
    : [parsed['csp-report'] || parsed];

  for (const r of reports.slice(0, 5)) {
    if (!r || typeof r !== 'object') continue;
    // Só campos conhecidos, truncados: o corpo é entrada não confiável e vai
    // parar num log que alguém vai ler.
    const clip = (v, n) => (typeof v === 'string' ? v.slice(0, n) : null);
    console.log('csp-violation ' + JSON.stringify({
      directive: clip(r['effective-directive'] || r.effectiveDirective || r['violated-directive'], 60),
      blocked: clip(r['blocked-uri'] || r.blockedURL, 200),
      document: clip(r['document-uri'] || r.documentURL, 200),
      sample: clip(r['script-sample'] || r.sample, 120),
      line: typeof (r['line-number'] ?? r.lineNumber) === 'number' ? (r['line-number'] ?? r.lineNumber) : null,
    }));
  }
  return done();
}

// ---------------------------------------------------------------------------
// Turnstile verification
// ---------------------------------------------------------------------------
async function verifyTurnstile(token, env) {
  const secret = env.TURNSTILE_SECRET_KEY;
  if (!secret) return false; // fail closed — a missing secret is a deploy error, not a bypass
  if (!token) return false;
  try {
    const res = await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', {
      method: 'POST',
      signal: AbortSignal.timeout(8000),
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ secret, response: token }),
    });
    const data = await res.json();
    return data.success === true;
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------------------
// Image-use consent audit log (Cloudflare D1)
// ---------------------------------------------------------------------------
// Cached SHA-256 (hex) of the exact Terms text shown, so each consent row pins
// the content — not just the version. Computed once per isolate.
let _termsHashHex = null;
async function getTermsHash() {
  if (_termsHashHex) return _termsHashHex;
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(termsHTML()));
  _termsHashHex = Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, '0')).join('');
  return _termsHashHex;
}

const CONSENT_COLS = [
  'created_at', 'event_slug', 'event_title', 'drive_target', 'access_type',
  'terms_version', 'terms_hash', 'consent_text', 'declaration_text', 'consenter_name',
  'turnstile_ok', 'ip', 'country', 'region', 'city', 'timezone', 'asn', 'as_org', 'colo',
  'user_agent', 'accept_language', 'referrer', 'page_url',
];

// Public: the only place the real Drive URLs reach the client. Absorbs what
// /api/consent used to do — Turnstile tokens are single-use, so a second
// endpoint re-verifying the same token would fail; this is the one place
// that spends it, and where the image-use consent audit row is written.
//
// turnstileToken === 'noscript' is the path for when Turnstile itself is
// blocked client-side (ad-blocker) — weaker (no captcha), but still a real
// POST per event, rate-limited on its own (tighter) key and audited with
// turnstile_ok=0, instead of today's unconditional leak in the page HTML.
// Exported for the unit suite: this is the one endpoint that hands out the
// Drive URLs, so its refusals (bad Turnstile, missing consent, coming-soon
// event) are the security contract worth pinning against regression.
export async function handleDriveLink(request, env, ctx) {
  const ip = request.headers.get('CF-Connecting-IP') || 'unknown';

  let body;
  try { body = await request.json(); } catch { return jsonErr('JSON inválido.', 400); }

  const slug = String(body.slug || '').slice(0, 60);
  if (!slug || !validateSlug(slug)) return jsonErr('Projeto inválido.', 400);

  const isNoscript = body.turnstileToken === 'noscript';
  const allowed = isNoscript
    ? await checkRateLimit(env, ip, 'drive-link-noscript', 10, 3600)
    : await checkRateLimit(env, ip, 'drive-link', 60, 3600);
  if (!allowed) return jsonErr('Muitas tentativas. Tente novamente mais tarde.', 429);

  const events = await getEvents(env);
  const event = events.find(e => e.slug === slug);
  if (!event) return jsonErr('Projeto não encontrado.', 404);
  if (event.comingSoon) return jsonErr('As fotos ainda não estão disponíveis.', 403);

  // Nonce de página. O buraco que ele fecha: o Turnstile prova que existe um
  // browser do outro lado, mas o token dele não diz PARA QUAL página foi
  // emitido — então um script com um token válido na mão podia pedir o link de
  // vários slugs seguidos, dentro do rate limit, sem nunca abrir uma página.
  // O nonce é assinado no render de /<slug> e só vale para aquele slug.
  //
  // 'expired' ganha código próprio (410) porque tem conserto do lado do
  // cliente: uma aba aberta desde ontem só precisa recarregar, e o JS da página
  // faz isso sozinho. Um 403 genérico mandaria o visitante para a tela de erro
  // sem motivo.
  const secret = signingSecret(env);
  if (secret) {
    const nonceCheck = await verifyToken(secret, String(body.driveNonce || ''), {
      purpose: 'drive',
      scope: slug,
      ttlSecs: DRIVE_NONCE_TTL_SECS,
    });
    if (!nonceCheck.ok) {
      return nonceCheck.reason === 'expired'
        ? jsonErr('Esta página expirou. Recarregue para continuar.', 410)
        : jsonErr('Requisição inválida. Recarregue a página e tente novamente.', 403);
    }
  }

  let turnstileOk;
  if (isNoscript) {
    turnstileOk = false; // recorded as unverified, but still lets access through (conscious bypass)
  } else {
    turnstileOk = await verifyTurnstile(body.turnstileToken, env);
    if (!turnstileOk) return jsonErr('Verificação de segurança falhou. Recarregue a página e tente novamente.', 403);
  }

  if (body.consent !== true) return jsonErr('É necessário aceitar os Termos de Uso.', 400);
  const declarationText = ACCESS_DECLARATIONS[event.accessType] || '';
  if (declarationText && body.declaration !== true) {
    return jsonErr('É necessário confirmar a declaração de acesso.', 400);
  }

  // Audit — non-blocking, always using the server's canonical texts (never
  // whatever the client sends — stricter than the old /api/consent).
  if (env.CONSENT_DB) {
    const cf = request.cf || {};
    const accessType = ACCESS_TYPES.includes(event.accessType) ? event.accessType : 'public';
    const vals = [
      generateId(),
      new Date().toISOString(),
      slug,
      (event.title || '').slice(0, 200),
      event.driveUrlInstagram ? 'both' : 'full', // granted, no longer "clicked"
      accessType,
      TERMS_VERSION,
      await getTermsHash(),
      CONSENT_LABEL,
      declarationText || null,
      String(body.name || '').trim().slice(0, 120) || null,
      turnstileOk ? 1 : 0,
      ip.slice(0, 64),
      (request.headers.get('CF-IPCountry') || cf.country || '').slice(0, 8),
      String(cf.region || '').slice(0, 80),
      String(cf.city || '').slice(0, 120),
      String(cf.timezone || '').slice(0, 64),
      cf.asn ? parseInt(cf.asn, 10) : null,
      String(cf.asOrganization || '').slice(0, 160),
      String(cf.colo || '').slice(0, 16),
      (request.headers.get('User-Agent') || '').slice(0, 400),
      (request.headers.get('Accept-Language') || '').slice(0, 120),
      (request.headers.get('Referer') || '').slice(0, 400),
      String(body.pageUrl || '').slice(0, 400),
    ];
    const stmt = env.CONSENT_DB.prepare(
      `INSERT INTO image_use_consent
         (id, created_at, event_slug, event_title, drive_target, access_type, terms_version, terms_hash,
          consent_text, declaration_text, consenter_name, turnstile_ok, ip, country, region, city, timezone,
          asn, as_org, colo, user_agent, accept_language, referrer, page_url)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`
    ).bind(...vals);
    // Esta é a gravação mais importante do site, e era a mais silenciosa. Ela é
    // best-effort de propósito — recusar as fotos porque o log falhou puniria o
    // visitante por um problema nosso —, mas "best-effort" nunca deveria ter
    // significado "e ninguém fica sabendo": o registro de consentimento é a peça
    // de não-repúdio da conformidade LGPD. Perdê-lo em silêncio é o pior modo de
    // falha do sistema inteiro, porque o site continua parecendo perfeito.
    //
    // Agora falha com barulho nos dois canais: e-mail para o dono (throttle
    // global de 15 min dentro do sendErrorAlert, que nunca lança) e linha no
    // /api/healthz, que o painel de status transforma em alerta.
    ctx.waitUntil(stmt.run().catch(e => {
      noteDegraded(
        'registro de consentimento não gravou',
        `D1 recusou o INSERT (evento ${slug}). As fotos foram entregues, mas sem prova de aceite`,
        e
      );
      return sendErrorAlert(env, e, { path: 'POST /api/drive-link (consent insert)' }).catch(() => {});
    }));
  }

  // safeUrl at the sink: these land straight in an <a href> on the client, so a
  // `javascript:` value that reached KV through a restored backup (merged
  // verbatim) or a legacy row would otherwise be one click from executing.
  return jsonOk({ ok: true, driveUrl: safeUrl(event.driveUrl), driveUrlInstagram: safeUrl(event.driveUrlInstagram) });
}

async function handleConsentExport(request, env) {
  const authErr = await checkAuth(request, env);
  if (authErr) return authErr;
  if (!env.CONSENT_DB) return jsonErr('Registro de consentimentos não configurado.', 503);

  const { results } = await env.CONSENT_DB.prepare(
    `SELECT ${CONSENT_COLS.join(', ')} FROM image_use_consent ORDER BY created_at DESC`
  ).all();
  const date = new Date().toISOString().split('T')[0];
  return csvResponse(`consentimentos-${date}.csv`, CONSENT_COLS, results || []);
}

// Retention: delete consent rows older than the window (~5 years, see
// CONSENT_RETENTION_DAYS). Runs in the daily cron.
async function pruneOldConsent(env) {
  if (!env.CONSENT_DB) return;
  const cutoff = new Date(Date.now() - CONSENT_RETENTION_DAYS * 86400_000).toISOString();
  await env.CONSENT_DB.prepare('DELETE FROM image_use_consent WHERE created_at < ?').bind(cutoff).run();
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
async function checkAuth(request, env) {
  const authed = await verifySession(env, request);
  if (!authed) return jsonErr('Não autorizado.', 401);
  return null;
}

// A política de cabeçalhos toda mora em security.js; estes helpers só escolhem
// qual perfil se aplica. A separação existe para que uma rota nova só precise
// decidir "isto é HTML público, HTML de painel ou dado?" — e não reescrever
// uma lista de cabeçalhos que vai divergir da das outras.
//
// O `nonce` é opcional para que as páginas de erro (404/500), que não têm
// script nenhum, continuem chamando html(conteúdo, status) sem cerimônia.
function html(content, status = 200, nonce = '') {
  return new Response(content, { status, headers: htmlSecurityHeaders(nonce) });
}

function adminHtml(content, status = 200, nonce = '') {
  return new Response(content, { status, headers: adminHtmlSecurityHeaders(nonce) });
}

function redirect(location) {
  // Mesmo um 302 sai com os cabeçalhos de segurança: é uma resposta da nossa
  // origem e não há motivo para ela ser a exceção da regra.
  return new Response(null, {
    status: 302,
    headers: { ...dataSecurityHeaders('text/plain; charset=utf-8'), Location: location },
  });
}

function jsonOk(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: dataSecurityHeaders('application/json; charset=utf-8'),
  });
}

function jsonErr(message, status = 400) {
  return new Response(JSON.stringify({ error: message }), {
    status,
    headers: dataSecurityHeaders('application/json; charset=utf-8'),
  });
}

function handleManifest() {
  const manifest = {
    name: 'fotos · Luca F. Chala',
    short_name: 'fotos',
    description: 'Galeria de fotos de Luca F. Chala',
    start_url: '/dashboard',
    scope: '/',
    display: 'standalone',
    background_color: '#0a0a0a',
    theme_color: '#0a0a0a',
    icons: [
      { src: '/icon.svg', sizes: 'any', type: 'image/svg+xml', purpose: 'any maskable' },
    ],
  };
  return new Response(JSON.stringify(manifest), {
    status: 200,
    headers: { ...dataSecurityHeaders('application/manifest+json', { store: true }), 'Cache-Control': 'public, max-age=86400' },
  });
}

function handleIcon() {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 256 256"><rect width="256" height="256" rx="48" fill="#0a0a0a"/><text x="50%" y="55%" text-anchor="middle" dominant-baseline="middle" font-family="-apple-system,BlinkMacSystemFont,'Inter',sans-serif" font-size="140" font-weight="600" fill="#f0ebe5">f.</text></svg>`;
  return new Response(svg, {
    status: 200,
    headers: { ...dataSecurityHeaders('image/svg+xml', { store: true }), 'Cache-Control': 'public, max-age=604800' },
  });
}

// Static social-preview placeholder for events still marked "comingSoon" — a
// branded "em breve" card, so the cover (which is still subject to change)
// never gets baked into a link preview.
const COMING_SOON_OG_IMAGE_B64 = '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yWTy3e9+t1zId21U3NShMtt/rV9fX59Op81m8+jRo4uLi71er1qths/41FNPLSwsjMfjy5cvLy0t1ev1+zgC77zzzttvv12e71IUxfe+971/8A/+wec+97nNzc1Wq3Xw4MFLly7dyKLZ6w7vd77znR3DWxTFr//6r//Wb/1WlmVZln3mM5956aWXbqF/7uzLV61W19fXX3/99V/91V8dDodHjhw5ePDghQsXwhce1pQeO3Zs//794/G42+3++Mc/DvOcN/u9UavVTp48+eKLL173zJ7wzdNoNPzPE0AQAnAviqjT6YQZp+v+Zn+zq0bLDzudTk+dOnXgwIH5+flPfvKTL730UrkZ78SJE0mSTCaT8ID7Oxc0MzPTaDSazWaIk9BFJ0+e/MIXvnBHhrfdbofJse1zpP/u3/27r3zlK7Ozs1mWzc3NXTtXdl9evjiOf/SjH335y1/O87zb7T799NOnT58un1uWZc8991y9Xg9zp6+99totRHJIvnCCa6fTue7s4k3dZgHAg8DF9AC72PRDTCaTcFjoLXzMcFzke++9l6ZpFEXPPfdcOEEky7LZ2dlPfvKTRVGsrq5evnz51qLiDtra2hqPx8PhcDAYDIfDXq9XFMWTTz45nU6TJBmNRhcuXLidA06Ka+y4we/WkvuOv3xh1ejJkyfPnTtXr9fTNH3++efL5aZ5nrdarWeeeWYymTSbzXfeeecGz579sM+VZdmHPXM1CLDrmCEE2K2uncLa/k+hK27h5M+wWPHcuXO9Xm9paempp56an58fjUaTyeSTn/zk4uJipVI5derU5uZmtVpN0/R+fflFURw9ejRJkrJLm83mpz/96c985jN5ns/Pz3/jG99YXl6+2UNltptMJuPxePsM4XQ6/dznPre4uLi1tdXtdi9fvjwej29qD+FdevniON7c3HzllVeefPLJ4XD4xBNP7N27d2VlpV6vj0ajY8eOHTp0aDKZtFqtH/3oR2HL5S3PELZarQ/7kkejkQ2EAIIQgLsuy7KZmZnf+73fu/af8jxvt9t//ud//sd//Me30CrlJYSnT5/eu3fvnj17jh079pOf/KQoihMnToS1o2+88cbN3uhwx2M4TdO/9bf+1vZkCqezTCaTK1eufOtb3/rhD394a6kWBiGO4yNHjoxGozLYkiQ5evTo3/gbfyNN0ziO8zz/wQ9+cGtnqNzxly9s8HvllVe+8pWvFEUxOzt7/PjxCxcuNJvNNE2fffbZcITM1atX33jjjVtb5homXX/5l3/5i1/84rWXHCZJsrW19bWvfS3sOJWFAIIQgLsrjuOFhYXrFkWn05mZmbnlX8qjKMqy7PXXX//85z8fx/Hzzz//7//9vw+3UOR5PhgM3n777c985jP3/Zf+arW6/YjOsJgzFNrRo0cvX758+vTpZrN5C88zz/OZmZl/+A//4fYxCbORYc6w1Wr9q3/1r954441b+/h3/OULc3fnzp07efJkeJmef/757373u2E16YkTJ8IpQS+//PLq6urtdPLMzEyn07n27eEWjXt85CwAghDg0ZVl2fnz56/NhjDF1Ov1bvmm+FAXb7311ubm5szMzNNPP91oNA4cOHDgwIEoik6dOtXr9W55E9odEQrkpZde2n6rRBzHi4uLzzzzzBNPPHH06NFf/uVf/sM//MMf//jHMzMzt7aks9FolPcQltvkKpXK2bNnv/3tb//whz+85RNl7sbLF57kj370o+eeey4cK7q0tLSysvL4448fPnx4Op2Gg2dup9miKOr1euESyGtfjtFolGWZ/2ECCEIA7rokSTY3N//ZP/tn4Yrz63bFrYVQ5YP1hxcvXjx9+vSzzz67tLR08ODBo0ePhvM8f/rTn4Y2uL8jEMfxd77znXfffTes3iyf0uHDh3/3d393YWGhWq3+vb/39957771wtcPNlk+apu+99164cTFN0wMHDuzZsydN02q1GuYGu93uLffP3Xj5wubP119/fW1trdlszs/PHz9+fHl5+cSJE61WazweX7hw4d13363X67f2XZFlWbvd/tM//dM/+ZM/ue4po2GG9sMOTQXgwWRpB8AulmVZ+iFu85fyKIryPH/99dfDhezHjx8/duxYOLnkzTffDMVy37/8VqtVq9U6H2i3291u9+zZs9///vdbrdbW1taePXuOHj163cvfP7Y2R6PRP//n//xrX/va7//+73/ta1/7wz/8w3CmaJIkf+fv/J1Op3P7s2F39uULGb+ysvLmm2+Gqctnn322Uqk888wzaZo2Go1XX311c3MzXDF/y4qi+LCnbXoQQBACcE8lSVKtVpPrieP4dhYHhlNV3nzzzeFwmKbpX/krf+XJJ58siuLMmTPLy8u3dkblHXftcwiThGFhZxRFURTdzl7K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';

function handleComingSoonOgImage() {
  const bytes = Uint8Array.from(atob(COMING_SOON_OG_IMAGE_B64), c => c.charCodeAt(0));
  return new Response(bytes, {
    status: 200,
    headers: { ...dataSecurityHeaders('image/png', { store: true }), 'Cache-Control': 'public, max-age=604800' },
  });
}

// ---------------------------------------------------------------------------
// Backup — full site state (v2), with v1-compatible restore
// ---------------------------------------------------------------------------
export function buildBackup({ events, categories, removalRequests }) {
  return JSON.stringify({
    version: 2,
    backupAt: new Date().toISOString(),
    eventCount: events.length,
    events,
    categories,
    removalRequests,
  });
}

// A restored backup is the one path that writes events into KV without going
// through normalizeEventFields(), so its contents used to land verbatim — a
// hand-edited/corrupted file could inject `javascript:` into an href rendered
// on the public page, or a non-object entry that throws on `e.visible` and
// 500s the gallery. Sanitize the two things that actually bite (shape + URL
// sinks) and pass everything else through untouched, so legitimate backups —
// including fields this normalizer doesn't know about — restore unchanged.
const RESTORE_URL_FIELDS = ['driveUrl', 'driveUrlInstagram', 'projectUrl', 'thumbnailUrl'];

function sanitizeRestoredEvent(ev) {
  const out = { ...ev };
  for (const f of RESTORE_URL_FIELDS) {
    if (out[f] !== undefined) out[f] = toHttps(String(out[f] ?? '').slice(0, 500));
  }
  if (Array.isArray(out.photos)) {
    out.photos = out.photos.map(u => toHttps(String(u ?? '').slice(0, 500))).filter(Boolean);
  }
  return out;
}

// Os pedidos de remoção do backup passavam verbatim para o KV. Eles são
// renderizados no painel e exportados em CSV, então um arquivo adulterado podia
// plantar campos de tipo inesperado (um objeto onde o template espera string) e
// registros sem `id`, que colidem no Map de deduplicação. Só as chaves
// conhecidas sobrevivem, cada uma com o tipo e o tamanho certos.
const RESTORE_REQUEST_STRINGS = {
  id: 64, eventSlug: 60, eventTitle: 200, method: 20, value: 500,
  email: 200, phone: 50, message: 1000, fileName: 200,
  createdAt: 40, resolvedAt: 40,
  emailStatus: 220, confirmEmailStatus: 220, resolvedEmailStatus: 220,
};

export function sanitizeRestoredRequest(r) {
  if (!r || typeof r !== 'object' || Array.isArray(r)) return null;
  // Sem id não há como deduplicar nem resolver depois — o registro é inútil.
  if (typeof r.id !== 'string' || !/^[a-f0-9]{1,64}$/.test(r.id)) return null;

  const out = { resolved: r.resolved === true };
  for (const [key, max] of Object.entries(RESTORE_REQUEST_STRINGS)) {
    if (typeof r[key] === 'string') out[key] = r[key].slice(0, max);
  }
  // O binário nunca é guardado (só viaja no e-mail); um backup que traga um
  // não vai reintroduzi-lo em KV.
  out.fileBase64 = null;
  return out;
}

export function mergeRestore(current, backupEvents) {
  const result = [...current];
  let added = 0, updated = 0;
  for (const raw of backupEvents) {
    // Skip junk entries instead of letting them reach KV (null/string/array).
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) continue;
    const bEv = sanitizeRestoredEvent(raw);
    const idx = result.findIndex(e => e.id === bEv.id);
    if (idx === -1) {
      result.push(bEv);
      added++;
    } else {
      const ct = new Date(result[idx].updatedAt || result[idx].createdAt || 0).getTime();
      const bt = new Date(bEv.updatedAt || bEv.createdAt || 0).getTime();
      if (bt > ct) { result[idx] = bEv; updated++; }
    }
  }
  return { events: result, added, updated };
}

async function handleGetBackup(request, env) {
  const authErr = await checkAuth(request, env);
  if (authErr) return authErr;
  const [events, categories, removalRequests] = await Promise.all([
    getEvents(env, true), getCategories(env), getRemovalRequests(env),
  ]);
  const date = new Date().toISOString().split('T')[0];
  return new Response(buildBackup({ events, categories, removalRequests }), {
    headers: {
      // no-store importa especialmente aqui: o backup traz TODOS os pedidos de
      // remoção, com e-mail e telefone de cada titular.
      ...dataSecurityHeaders('application/json; charset=utf-8'),
      'Content-Disposition': `attachment; filename="fotos-backup-${date}.json"`,
    },
  });
}

async function handleRestoreBackup(request, env) {
  const authErr = await checkAuth(request, env);
  if (authErr) return authErr;
  let body;
  try { body = await request.json(); } catch { return jsonErr('JSON inválido.', 400); }
  if (!Array.isArray(body.events)) return jsonErr('Backup inválido: campo "events" ausente.', 400);

  const current = await getEvents(env);
  const { events: merged, added, updated } = mergeRestore(current, body.events);
  await saveEvents(env, merged);
  const result = { ok: true, added, updated, total: merged.length };

  // v2 sections — optional and backward-compatible (v1 backups simply omit them).
  if (Array.isArray(body.categories)) {
    const union = [...await getCategories(env)];
    for (const c of body.categories) {
      if (typeof c === 'string' && c && !union.includes(c)) union.push(c);
    }
    await saveCategories(env, union.slice(0, MAX_CATEGORIES));
    result.categories = union.length;
  }

  if (Array.isArray(body.removalRequests)) {
    const byId = new Map((await getRemovalRequests(env)).map(r => [r.id, r]));
    let rAdded = 0;
    for (const r of body.removalRequests) {
      const clean = sanitizeRestoredRequest(r);
      if (clean && !byId.has(clean.id)) { byId.set(clean.id, clean); rAdded++; }
    }
    // Teto no total: o corpo vem de um arquivo escolhido à mão e nada impedia
    // um restore de inflar `removal_requests` além do limite de valor do KV,
    // que falha a escrita e derruba a lista inteira, não só o excedente.
    const merged = [...byId.values()];
    trimRequests(merged, 500);
    await env.FOTOS.put('removal_requests', JSON.stringify(merged));
    result.removalRequestsAdded = rAdded;
  }

  return jsonOk(result);
}

function errorPage(code, message, status) {
  return html(`<!DOCTYPE html><html lang="pt-BR"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1.0"><title>${code} · fotos</title><style>*{box-sizing:border-box;margin:0;padding:0}body{font-family:sans-serif;background:#0a0a0a;color:#555;display:flex;align-items:center;justify-content:center;min-height:100vh;text-align:center;padding:2rem}h1{font-size:4rem;font-weight:700;color:#1a1a1a;margin-bottom:1rem}p{margin-bottom:1.5rem;font-size:.9rem}.links{display:flex;gap:1rem;justify-content:center;flex-wrap:wrap}a{color:#666;text-decoration:none}a:hover{color:#aaa}</style></head><body><div><h1>${code}</h1><p>${message}</p><div class="links"><a href="/">← Voltar para a galeria</a><a href="/suporte">Precisa de ajuda? Suporte</a></div></div></body></html>`, status);
}

function notFound() {
  return errorPage('404', 'Página não encontrada.', 404);
}

function serverError() {
  return errorPage('500', 'Algo deu errado. Tente novamente em instantes.', 500);
}
