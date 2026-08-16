// ---------------------------------------------------------------------------
// Primitivas de segurança compartilhadas.
//
// Tudo que é política de segurança — cabeçalhos, CSP, checagem de origem,
// tokens assinados, higienização de nomes de arquivo, política de senha — mora
// aqui, num só lugar. O motivo é o modo de falha típico desses controles: eles
// não quebram quando estão errados, só param de proteger em silêncio. Um
// cabeçalho esquecido numa rota nova, uma CSP que diverge entre duas respostas,
// um `no-store` que ficou de fora justamente do endpoint que devolve o export
// de consentimentos — nada disso aparece num teste funcional. Concentrar aqui
// deixa cada controle com um dono, um teste e um comentário explicando por que
// ele é assim.
// ---------------------------------------------------------------------------

// Origens externas que o site realmente precisa carregar. Escritas uma vez e
// reaproveitadas na CSP para que a política enforced e a report-only não possam
// divergir com o tempo (divergir é o que faz a report-only virar ruído).
const CSP_TURNSTILE = 'https://challenges.cloudflare.com';
const CSP_CF_INSIGHTS_SCRIPT = 'https://static.cloudflareinsights.com';
const CSP_CF_INSIGHTS_CONNECT = 'https://cloudflareinsights.com';
const CSP_GOOGLE_FONTS_CSS = 'https://fonts.googleapis.com';
const CSP_GOOGLE_FONTS_FILES = 'https://fonts.gstatic.com';
const CSP_IMAGES = "https://*.googleusercontent.com https://drive.google.com";

// Um ano era o mínimo recomendado; dois anos é o que a lista de preload do
// Chrome exige. Ainda NÃO declaramos `preload` — isso é um compromisso que vale
// para o domínio inteiro e é praticamente irreversível (a remoção da lista leva
// meses), então é decisão do dono, não efeito colateral de um commit. O
// `includeSubDomains` aqui só alcança *.fotos.lucafchala.com.
const HSTS = 'max-age=63072000; includeSubDomains';

// Negar tudo que o site não usa. Um Permissions-Policy curto ("camera=(),
// microphone=(), geolocation=()") só nega três coisas; qualquer API nova do
// browser nasce liberada. A lista longa é chata de manter, mas é a única forma
// de a política valer alguma coisa contra o que ainda não existe hoje.
const PERMISSIONS_POLICY = [
  'accelerometer=()', 'ambient-light-sensor=()', 'autoplay=()', 'battery=()',
  'camera=()', 'display-capture=()', 'document-domain=()', 'encrypted-media=()',
  'execution-while-not-rendered=()', 'execution-while-out-of-viewport=()',
  'fullscreen=(self)', 'gamepad=()', 'geolocation=()', 'gyroscope=()',
  'hid=()', 'idle-detection=()', 'local-fonts=()', 'magnetometer=()',
  'microphone=()', 'midi=()', 'payment=()', 'picture-in-picture=()',
  'publickey-credentials-get=()', 'screen-wake-lock=()', 'serial=()',
  'speaker-selection=()', 'storage-access=()', 'usb=()', 'web-share=(self)',
  'xr-spatial-tracking=()',
].join(', ');

// Cabeçalhos que valem para QUALQUER resposta, inclusive 404 e 500. Uma página
// de erro sem `nosniff` ou sem `X-Frame-Options` continua sendo uma página
// servida pela nossa origem.
function baseHeaders() {
  return {
    'X-Content-Type-Options': 'nosniff',
    'X-Frame-Options': 'DENY',
    'Strict-Transport-Security': HSTS,
    'Permissions-Policy': PERMISSIONS_POLICY,
    // Isola o processo/agent cluster desta origem de outras do mesmo site.
    'Origin-Agent-Cluster': '?1',
    // Adobe crossdomain.xml legado — nunca servimos um, mas declarar `none`
    // impede que um dia um arquivo desses seja interpretado se aparecer.
    'X-Permitted-Cross-Domain-Policies': 'none',
  };
}

// Nonce por requisição para os blocos <script> inline. 128 bits em base64url:
// o requisito da CSP é ser imprevisível, não ter formato específico.
export function generateNonce() {
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  return btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

// CSP das páginas HTML.
//
// `strict` decide entre as duas políticas que servimos ao mesmo tempo:
//
//  - strict=false (enforced hoje): mantém 'unsafe-inline' em script-src porque
//    a UI ainda usa handlers inline (onclick="…"). Handlers em atributo NÃO são
//    cobertos por nonce — nenhum valor de nonce os libera —, então tirar o
//    'unsafe-inline' agora quebraria a galeria, a página de evento e o painel
//    inteiro. Reconhecer isso é mais honesto do que publicar uma CSP "forte"
//    que na prática precisaria ser revertida no primeiro clique.
//
//  - strict=true (report-only): a política que queremos passar a impor —
//    'nonce-…' sem 'unsafe-inline'. Como ela roda em Report-Only, cada handler
//    inline remanescente vira um relatório em /api/csp-report em vez de um
//    elemento quebrado. É a lista de tarefas da migração, medida em produção e
//    não chutada, e é a única forma segura de descobrir se sobrou algum caso
//    antes de trocar o enforced.
//
// Os dois cabeçalhos saem juntos em toda página. O dia da virada é quando os
// relatórios zerarem: aí `strict` passa a valer para o enforced também.
export function contentSecurityPolicy(nonce, { strict = false } = {}) {
  // Sem nonce (páginas de erro, que não têm script nenhum) a fonte é omitida em
  // vez de virar um `'nonce-'` vazio. Um token assim é sintaticamente inválido:
  // o browser o descarta, e o que sobraria numa política estrita seria um
  // `script-src 'self'` — que funciona, mas por acidente. Melhor a política
  // dizer exatamente o que quer dizer.
  const nonceSrc = nonce ? ` 'nonce-${nonce}'` : '';
  const scriptSrc = strict
    ? `'self'${nonceSrc} ${CSP_TURNSTILE} ${CSP_CF_INSIGHTS_SCRIPT}`
    : `'self' 'unsafe-inline'${nonceSrc} ${CSP_TURNSTILE} ${CSP_CF_INSIGHTS_SCRIPT}`;

  return [
    "default-src 'self'",
    `script-src ${scriptSrc}`,
    // style-src continua com 'unsafe-inline': todo o CSS é <style> inline por
    // página, e CSS inline não é um vetor de execução de script sob esta CSP
    // (sem 'unsafe-eval', sem script-src aberto). Trocar por nonce aqui daria
    // ganho marginal e exigiria tocar em todas as folhas ao mesmo tempo.
    `style-src 'self' 'unsafe-inline' ${CSP_GOOGLE_FONTS_CSS}`,
    `font-src 'self' ${CSP_GOOGLE_FONTS_FILES}`,
    `img-src 'self' data: blob: ${CSP_IMAGES}`,
    `connect-src 'self' ${CSP_TURNSTILE} ${CSP_CF_INSIGHTS_CONNECT}`,
    `frame-src ${CSP_TURNSTILE}`,
    // Nada abaixo é usado pelo site: negar explicitamente evita que um dia um
    // <object>/<embed> injetado tenha para onde ir.
    "object-src 'none'",
    "media-src 'none'",
    "worker-src 'self'",
    "manifest-src 'self'",
    "frame-ancestors 'none'",
    "base-uri 'none'", // era 'self'; nenhuma página usa <base>, então 'none' é mais apertado
    "form-action 'self'",
    'upgrade-insecure-requests',
    `report-uri /api/csp-report`,
    `report-to csp`,
  ].join('; ');
}

// Cabeçalhos de uma página HTML pública.
export function htmlSecurityHeaders(nonce) {
  return {
    ...baseHeaders(),
    'Content-Type': 'text/html; charset=utf-8',
    'Referrer-Policy': 'strict-origin-when-cross-origin',
    'Cross-Origin-Opener-Policy': 'same-origin',
    'Cross-Origin-Resource-Policy': 'same-site',
    // COEP fica deliberadamente de fora: as fotos vêm do
    // lh3.googleusercontent.com, que não manda CORP, então `require-corp`
    // apagaria a galeria inteira. Documentado em SECURITY.md para que a
    // ausência seja uma decisão registrada e não um esquecimento.
    'Content-Security-Policy': contentSecurityPolicy(nonce),
    'Content-Security-Policy-Report-Only': contentSecurityPolicy(nonce, { strict: true }),
    'Reporting-Endpoints': 'csp="/api/csp-report"',
  };
}

// Cabeçalhos das páginas autenticadas (painel e login). Além do que a página
// pública leva: nada de cache em disco compartilhado, nada de indexação e
// nenhum referrer vazando URL de painel para terceiros.
export function adminHtmlSecurityHeaders(nonce) {
  return {
    ...htmlSecurityHeaders(nonce),
    'Cache-Control': 'no-store, no-cache, must-revalidate, max-age=0',
    Pragma: 'no-cache',
    Expires: '0',
    'Referrer-Policy': 'no-referrer',
    'X-Robots-Tag': 'noindex, nofollow, noarchive, nosnippet',
  };
}

// Cabeçalhos de respostas que NÃO são HTML (JSON, CSV, texto, imagem).
//
// `default-src 'none'` aqui não é teatro: se um endpoint devolver JSON e o
// browser for induzido a renderizar o corpo como documento (content sniffing
// numa navegação direta, um Content-Type errado num refactor futuro), essa CSP
// impede que qualquer coisa dentro dele carregue ou execute. `no-store` é o
// controle que realmente importa: /api/metrics, /api/backup e
// /api/consent/export devolvem dados pessoais e não podem encostar em cache
// intermediário nem no cache de disco do browser.
export function dataSecurityHeaders(contentType, { store = false } = {}) {
  const headers = {
    ...baseHeaders(),
    'Content-Type': contentType,
    'Referrer-Policy': 'no-referrer',
    'Cross-Origin-Resource-Policy': 'same-origin',
    'Content-Security-Policy': "default-src 'none'; frame-ancestors 'none'; base-uri 'none'; sandbox",
  };
  if (!store) {
    headers['Cache-Control'] = 'no-store, no-cache, must-revalidate, max-age=0';
    headers.Pragma = 'no-cache';
    headers.Expires = '0';
  }
  return headers;
}

// ---------------------------------------------------------------------------
// CSRF
// ---------------------------------------------------------------------------
// O cookie de sessão já é SameSite=Strict, o que barra a maior parte do CSRF.
// Isso não basta por dois motivos concretos:
//
//  1. SameSite é *site*, não origem. Qualquer coisa capaz de servir conteúdo em
//     outro host de lucafchala.com (um subdomínio comprometido, um CNAME órfão
//     apontando para serviço de terceiro) é "same-site" e passa pelo cookie.
//  2. SameSite protege o cookie, não os endpoints públicos sem cookie nenhum
//     (/api/removal-request, /api/suporte, /api/drive-link), que um site
//     terceiro pode acionar em nome de um visitante.
//
// Sec-Fetch-Site resolve os dois: é o browser dizendo de onde a requisição
// partiu, e o valor é inforjável por script.
//
// Ausência de sinal passa de propósito. Um cliente que não manda nem
// Sec-Fetch-Site nem Origin não é um browser, e um não-browser não sofre CSRF —
// ele já controla a própria requisição. Bloquear por ausência custaria
// compatibilidade sem comprar segurança.
export function isCrossSiteRequest(request) {
  const secFetchSite = request.headers.get('Sec-Fetch-Site');
  if (secFetchSite) {
    // 'none' = navegação iniciada pelo usuário (URL digitada, favorito).
    // 'same-site' é recusado de propósito: é justamente o caso (1) acima.
    return !(secFetchSite === 'same-origin' || secFetchSite === 'none');
  }
  const origin = request.headers.get('Origin');
  if (origin) {
    try {
      // Comparado com o host do próprio request, não com um domínio fixo: o
      // mesmo Worker atende produção, *.workers.dev e o localhost do
      // `wrangler dev`. Fixar o domínio quebraria os dois últimos.
      return new URL(origin).host !== new URL(request.url).host;
    } catch {
      return true; // Origin presente mas ilegível — trate como hostil
    }
  }
  return false;
}

// ---------------------------------------------------------------------------
// Tokens assinados (HMAC-SHA256, sem estado)
// ---------------------------------------------------------------------------
// Usados para amarrar uma chamada de API a uma página realmente renderizada por
// nós (nonce do /api/drive-link e token dos formulários públicos).
//
// Sem estado de propósito: um nonce em KV gastaria a cota de escrita (1000/dia,
// compartilhada com eventos, sessões e consentimento) — o mesmo motivo que fez
// o /api/perf não escrever em KV. Uma assinatura HMAC dá a mesma garantia de
// "isto foi emitido pelo servidor, para este recurso, dentro deste prazo" com
// zero I/O.
//
// O que estes tokens NÃO fazem: impedir que alguém peça uma página e use o
// token dela. Isso é intencional — o objetivo é obrigar o atacante a carregar a
// página de cada slug (visível, contabilizado e sujeito a rate limit) em vez de
// varrer slugs com um único token na mão.

const encoder = new TextEncoder();
const keyCache = new Map();

async function hmacKey(secret) {
  let key = keyCache.get(secret);
  if (!key) {
    key = await crypto.subtle.importKey(
      'raw', encoder.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']
    );
    keyCache.set(secret, key);
  }
  return key;
}

function b64url(bytes) {
  return btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

// Comparação em tempo constante sobre strings ASCII. Duplicada de utils.js de
// propósito: security.js não importa utils.js para que a dependência aponte só
// num sentido (utils -> security), sem ciclo.
function timingSafeEqualStr(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string') return false;
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

// Assina `purpose|scope|exp`. `purpose` separa os usos (um token de formulário
// não vale como nonce de Drive nem vice-versa) e `scope` amarra ao recurso
// (o slug do evento).
export async function signToken(secret, { purpose, scope = '', ttlSecs }) {
  const exp = Math.floor(Date.now() / 1000) + ttlSecs;
  const payload = `${purpose}|${scope}|${exp}`;
  const sig = await crypto.subtle.sign('HMAC', await hmacKey(secret), encoder.encode(payload));
  return `${exp.toString(36)}.${b64url(new Uint8Array(sig))}`;
}

// Devolve um motivo em vez de um booleano: o chamador precisa distinguir
// "expirou" (recarregue a página — recuperável, e é o que acontece com uma aba
// aberta desde ontem) de "assinatura inválida" (alguém forjando).
export async function verifyToken(secret, token, { purpose, scope = '', ttlSecs = null, minAgeSecs = 0 }) {
  if (typeof token !== 'string' || !token) return { ok: false, reason: 'missing' };
  const dot = token.indexOf('.');
  if (dot <= 0) return { ok: false, reason: 'malformed' };

  const exp = parseInt(token.slice(0, dot), 36);
  if (!Number.isFinite(exp)) return { ok: false, reason: 'malformed' };

  const payload = `${purpose}|${scope}|${exp}`;
  const sig = await crypto.subtle.sign('HMAC', await hmacKey(secret), encoder.encode(payload));
  // Assinatura primeiro, prazo depois: só faz sentido falar em "expirado" de um
  // token que era nosso. Um token forjado com exp no futuro tem que cair em
  // 'invalid', não vazar que a única coisa errada era a data.
  if (!timingSafeEqualStr(token.slice(dot + 1), b64url(new Uint8Array(sig)))) {
    return { ok: false, reason: 'invalid' };
  }

  const now = Math.floor(Date.now() / 1000);
  if (now > exp) return { ok: false, reason: 'expired' };

  // Idade mínima (anti-bot nos formulários): o token não carrega o instante de
  // emissão, mas ele é derivável de `exp - ttlSecs` — desde que quem verifica
  // passe o mesmo TTL usado na emissão. Por isso cada TTL vive numa constante
  // exportada, usada nos dois lados; um valor divergente aqui não "falha
  // aberto", ele reprova envio legítimo, que é o erro seguro de se cometer.
  if (minAgeSecs > 0) {
    if (ttlSecs === null) return { ok: false, reason: 'malformed' };
    const age = now - (exp - ttlSecs);
    if (age < minAgeSecs) return { ok: false, reason: 'too-fast' };
  }
  return { ok: true, reason: 'ok' };
}

// ---------------------------------------------------------------------------
// Higienização de nome de arquivo
// ---------------------------------------------------------------------------
// O nome vem do formulário público de remoção e vira o filename de um anexo de
// e-mail. Sem tratar, um `../../.bashrc` ou um nome com CRLF viaja para dentro
// do cabeçalho MIME que o Resend monta. Também barramos a dupla extensão
// clássica ("foto.jpg.exe") normalizando para uma extensão de imagem conhecida.
const SAFE_IMAGE_EXTS = ['jpg', 'jpeg', 'png', 'gif', 'webp', 'heic', 'heif', 'avif'];

export function sanitizeFilename(name, fallback = 'foto.jpg') {
  if (typeof name !== 'string' || !name.trim()) return fallback;

  // Só a última parte do caminho, com separadores dos dois mundos.
  const base = name.split(/[/\\]/).pop() || '';
  // Fora: caracteres de controle (inclui o CR/LF que quebraria o cabeçalho MIME
  // do anexo), aspas e os reservados de sistema de arquivos. O `^\.+` derruba
  // nomes iniciados por ponto, incluindo o `..` de travessia que sobrar.
  // eslint-disable-next-line no-control-regex
  const cleaned = base.replace(/[\x00-\x1f\x7f<>:"|?*]/g, '').replace(/^\.+/, '').trim();
  if (!cleaned) return fallback;

  const dot = cleaned.lastIndexOf('.');
  const stem = (dot > 0 ? cleaned.slice(0, dot) : cleaned).slice(0, 100) || 'foto';
  const ext = (dot > 0 ? cleaned.slice(dot + 1) : '').toLowerCase();
  const safeExt = SAFE_IMAGE_EXTS.includes(ext) ? ext : 'jpg';
  // Pontos internos viram '_': mata "foto.jpg.exe" antes que o nome final
  // dependa de qual extensão o leitor de e-mail resolve olhar.
  return `${stem.replace(/\./g, '_')}.${safeExt}`;
}

// ---------------------------------------------------------------------------
// Política de senha
// ---------------------------------------------------------------------------
// O painel é o único login do site e dá acesso a dados pessoais (log de
// consentimento, pedidos de remoção com e-mail e telefone). O mínimo anterior
// era 6 caracteres, o que aceita "123456" — abaixo do que o PBKDF2 de 100k
// iterações consegue compensar contra um ataque offline se o hash vazar.
//
// O limite superior existe para o outro lado: o hash roda dentro do orçamento
// de CPU do Worker, e uma entrada absurda é uma forma barata de causar timeout.
export const PASSWORD_MIN_LENGTH = 12;
export const PASSWORD_MAX_LENGTH = 200;

// Não é uma lista de "top 10k senhas" — não cabe num Worker e não é o gargalo.
// É o conjunto de padrões que aparecem quando alguém escolhe uma senha com
// pressa, mais os termos deste projeto especificamente, que são o primeiro
// palpite de qualquer ataque direcionado.
const WEAK_PATTERNS = [
  /^(.)\1+$/,                       // um caractere repetido
  /^(012|123|234|345|456|567|678|789|890)+/,
  /^(?:qwert|asdfg|zxcvb|qwerty|senha|password|admin|letmein|welcome|master)/i,
  /^(?:fotos|lucafchala|luca|chala|galeria|dashboard|painel)/i,
];

export function validatePassword(password) {
  if (typeof password !== 'string') return { ok: false, error: 'Senha inválida.' };
  if (password.length < PASSWORD_MIN_LENGTH) {
    return { ok: false, error: `Senha muito curta (mínimo de ${PASSWORD_MIN_LENGTH} caracteres).` };
  }
  if (password.length > PASSWORD_MAX_LENGTH) {
    return { ok: false, error: `Senha muito longa (máximo de ${PASSWORD_MAX_LENGTH} caracteres).` };
  }
  // Uma frase longa é forte sem variedade de classes, então a exigência de
  // classes só vale abaixo de 20 caracteres. Impor "1 maiúscula + 1 símbolo"
  // numa passphrase de 30 caracteres é atrito sem ganho.
  if (password.length < 20) {
    const classes = [/[a-z]/, /[A-Z]/, /[0-9]/, /[^a-zA-Z0-9]/].filter(re => re.test(password)).length;
    if (classes < 3) {
      return {
        ok: false,
        error: 'Use ao menos três tipos de caractere (minúscula, maiúscula, número, símbolo) — ou uma frase com 20+ caracteres.',
      };
    }
  }
  if (new Set(password).size < 5) {
    return { ok: false, error: 'Senha com pouca variedade de caracteres.' };
  }
  if (WEAK_PATTERNS.some(re => re.test(password))) {
    return { ok: false, error: 'Senha previsível demais. Evite sequências, palavras óbvias e o nome do site.' };
  }
  return { ok: true };
}

// ---------------------------------------------------------------------------
// Honeypot
// ---------------------------------------------------------------------------
// Campo isca, invisível para gente e irresistível para bot que preenche tudo o
// que encontra no DOM. É a segunda camada depois do Turnstile, e a mais barata:
// não faz I/O e não incomoda ninguém.
//
// O nome importa. Bots miram em nomes plausíveis, então o campo se chama como
// algo que um formulário de contato teria de verdade. `aria-hidden` +
// `tabindex="-1"` + `autocomplete="off"` mantêm leitor de tela e autofill do
// browser longe dele — um honeypot que o autofill preenche vira um formulário
// que rejeita usuário legítimo.
export const HONEYPOT_FIELD = 'company_website';

export function honeypotFieldHTML() {
  return `<div class="hp-field" aria-hidden="true"><label for="${HONEYPOT_FIELD}">Não preencha este campo</label><input type="text" id="${HONEYPOT_FIELD}" name="${HONEYPOT_FIELD}" tabindex="-1" autocomplete="off" value=""></div>`;
}

// CSS do honeypot. Fora da viewport em vez de `display:none`: bot mais esperto
// checa `display`/`visibility` antes de preencher.
export const HONEYPOT_CSS = '.hp-field{position:absolute;left:-9999px;top:auto;width:1px;height:1px;overflow:hidden}';

export function honeypotTripped(value) {
  return typeof value === 'string' && value.trim() !== '';
}
