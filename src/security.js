// ---------------------------------------------------------------------------
// Primitivas de segurança compartilhadas: cabeçalhos, CSP, checagem de
// origem, tokens assinados, higienização de nomes de arquivo, política de
// senha. Centralizado porque esses controles falham em silêncio (cabeçalho
// esquecido numa rota nova, CSP divergente) sem que nenhum teste funcional
// perceba.
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

// 2 anos (não 1) porque é o que a lista de preload do Chrome exige — mas
// `preload` em si não está declarado de propósito: é praticamente irreversível
// (remoção leva meses) e cabe ao dono decidir, não a um commit.
const HSTS = 'max-age=63072000; includeSubDomains';

// Nega tudo que o site não usa — lista longa de propósito, porque qualquer API
// nova do browser nasce liberada por padrão. Diretivas que o Chrome não
// reconhece (ambient-light-sensor, battery, etc.) foram removidas: ele só loga
// "Unrecognized feature" sem negar nada de fato.
const PERMISSIONS_POLICY = [
  'accelerometer=()', 'autoplay=()',
  'camera=()', 'display-capture=()', 'encrypted-media=()',
  'fullscreen=(self)', 'gamepad=()', 'geolocation=()', 'gyroscope=()',
  'hid=()', 'idle-detection=()', 'local-fonts=()', 'magnetometer=()',
  'microphone=()', 'midi=()', 'payment=()', 'picture-in-picture=()',
  'publickey-credentials-get=()', 'screen-wake-lock=()', 'serial=()',
  'storage-access=()', 'usb=()', 'web-share=(self)',
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
// CUIDADO: por CSP Level 3, a presença de um nonce faz o browser DESCARTAR
// 'unsafe-inline' — `'unsafe-inline' 'nonce-abc'` vira só `'nonce-abc'`, e todo
// handler inline (onclick="…") para de funcionar. Pego só em teste com browser
// real: testes de unidade que checam a STRING da política não veem isso, já
// que 'unsafe-inline' continua lá no texto.
//
// Por isso o nonce só entra na política estrita (strict=true):
//  - strict=false (enforced hoje): 'unsafe-inline' sem nonce — mantém os
//    handlers inline vivos.
//  - strict=true (report-only): 'nonce-…' sem 'unsafe-inline' — a política
//    que queremos impor. Cada handler inline que sobrar vira relatório em
//    /api/csp-report em vez de quebrar a página; quando os relatórios
//    zerarem, strict passa a valer no enforced também.
/**
 * @param {string} nonce
 * @param {{ strict?: boolean }} [opts]
 */
export function contentSecurityPolicy(nonce, { strict = false } = {}) {
  // Sem nonce (páginas de erro, sem script) a fonte é omitida em vez de virar
  // um 'nonce-' vazio, que o browser trataria como token sintaticamente
  // inválido.
  const nonceSrc = nonce ? ` 'nonce-${nonce}'` : '';
  const scriptSrc = strict
    ? `'self'${nonceSrc} ${CSP_TURNSTILE} ${CSP_CF_INSIGHTS_SCRIPT}`
    // Nada de nonce aqui — ver o aviso acima. Acrescentar um é o mesmo que
    // apagar o 'unsafe-inline' e quebrar toda a interface.
    : `'self' 'unsafe-inline' ${CSP_TURNSTILE} ${CSP_CF_INSIGHTS_SCRIPT}`;

  return [
    "default-src 'self'",
    `script-src ${scriptSrc}`,
    // 'unsafe-inline' aqui é seguro: CSS não executa script sob esta CSP
    // (sem 'unsafe-eval', sem script-src aberto).
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
    // Só na política aplicada: numa report-only o Chrome a ignora mas ainda
    // loga um aviso no console a cada carga de página, o que é ruído puro.
    ...(strict ? [] : ['upgrade-insecure-requests']),
    'report-uri /api/csp-report',
    'report-to csp',
  ].join('; ');
}

// Cabeçalhos de uma página HTML pública.
/** @param {string} nonce */
export function htmlSecurityHeaders(nonce) {
  return {
    ...baseHeaders(),
    'Content-Type': 'text/html; charset=utf-8',
    'Referrer-Policy': 'strict-origin-when-cross-origin',
    'Cross-Origin-Opener-Policy': 'same-origin',
    'Cross-Origin-Resource-Policy': 'same-site',
    // Sem COEP de propósito: as fotos vêm de lh3.googleusercontent.com, que
    // não manda CORP, e `require-corp` apagaria a galeria inteira.
    'Content-Security-Policy': contentSecurityPolicy(nonce),
    'Content-Security-Policy-Report-Only': contentSecurityPolicy(nonce, { strict: true }),
    'Reporting-Endpoints': 'csp="/api/csp-report"',
  };
}

// Cabeçalhos das páginas autenticadas (painel e login). Além do que a página
// pública leva: nada de cache em disco compartilhado, nada de indexação e
// nenhum referrer vazando URL de painel para terceiros.
/** @param {string} nonce */
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
// `default-src 'none'` protege contra content-sniffing (browser induzido a
// renderizar o corpo como documento). `no-store` é o que importa de fato:
// /api/metrics, /api/backup e /api/consent/export devolvem dados pessoais.
/**
 * @param {string} contentType
 * @param {{ store?: boolean }} [opts]
 */
export function dataSecurityHeaders(contentType, { store = false } = {}) {
  // Record<string, string>: o bloco `no-store` abaixo acrescenta chaves que não
  // estão no literal, e a forma inferida as recusaria.
  /** @type {Record<string, string>} */
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
// SameSite=Strict no cookie de sessão não basta: (1) SameSite é *site*, não
// origem — um subdomínio comprometido ainda conta como same-site; (2) não
// protege endpoints públicos sem cookie (/api/removal-request, /api/suporte,
// /api/drive-link). Sec-Fetch-Site cobre os dois — é o browser dizendo de onde
// veio a requisição, inforjável por script.
//
// Sinal ausente passa de propósito: quem não manda Sec-Fetch-Site nem Origin
// não é um browser, e um não-browser não sofre CSRF.
/** @param {Request} request */
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
// Amarram uma chamada de API a uma página que nós renderizamos (nonce do
// /api/drive-link, token dos formulários públicos). Sem estado de propósito:
// um nonce em KV gastaria a cota de escrita (1000/dia, compartilhada com
// eventos/sessões/consentimento); HMAC dá a mesma garantia com zero I/O.
//
// Não impedem reuso do token em si — o objetivo é só obrigar o atacante a
// carregar a página de cada slug (visível, contado, com rate limit) em vez de
// varrer slugs com um token só.

const encoder = new TextEncoder();
const keyCache = new Map();

/** @param {string} secret */
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

// Uint8Array, não ArrayBuffer: o spread abaixo precisa de algo iterável, e um
// ArrayBuffer cru não é. Os dois chamadores já embrulham com `new Uint8Array(sig)`.
/** @param {Uint8Array} bytes */
function b64url(bytes) {
  return btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

// Comparação em tempo constante sobre strings ASCII. Duplicada de utils.js de
// propósito: security.js não importa utils.js para que a dependência aponte só
// num sentido (utils -> security), sem ciclo.
/**
 * @param {string} a
 * @param {string} b
 */
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
/**
 * @param {string} secret
 * @param {{ purpose: string, scope?: string, ttlSecs: number }} opts
 */
export async function signToken(secret, { purpose, scope = '', ttlSecs }) {
  const exp = Math.floor(Date.now() / 1000) + ttlSecs;
  const payload = `${purpose}|${scope}|${exp}`;
  const sig = await crypto.subtle.sign('HMAC', await hmacKey(secret), encoder.encode(payload));
  return `${exp.toString(36)}.${b64url(new Uint8Array(sig))}`;
}

// Devolve um motivo em vez de um booleano: o chamador precisa distinguir
// "expirou" (recarregue a página — recuperável, e é o que acontece com uma aba
// aberta desde ontem) de "assinatura inválida" (alguém forjando).
/**
 * @param {string} secret
 * @param {unknown} token
 * @param {{ purpose: string, scope?: string, ttlSecs?: number|null, minAgeSecs?: number }} opts
 */
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

/**
 * @param {unknown} name
 * @param {string} [fallback]
 */
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
// Mínimo de 12 (não os 6 antigos, que aceitavam "123456") para aguentar
// ataque offline se o hash PBKDF2 vazar. Máximo existe porque o hash roda
// dentro do orçamento de CPU do Worker; entrada absurda é timeout barato.
export const PASSWORD_MIN_LENGTH = 12;
export const PASSWORD_MAX_LENGTH = 200;

// Não é lista de "top 10k senhas" (não cabe num Worker); são os padrões óbvios
// mais os termos deste projeto, primeiro palpite de um ataque direcionado.
const WEAK_PATTERNS = [
  /^(.)\1+$/,                       // um caractere repetido
  /^(012|123|234|345|456|567|678|789|890)+/,
  /^(?:qwert|asdfg|zxcvb|qwerty|senha|password|admin|letmein|welcome|master)/i,
  /^(?:fotos|lucafchala|luca|chala|galeria|dashboard|painel)/i,
];

/**
 * @param {unknown} password
 * @returns {{ ok: true } | { ok: false, error: string }}
 */
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
// Campo isca invisível que bots preenchem; segunda camada depois do
// Turnstile, sem I/O. O nome soa como um campo de formulário de contato de
// verdade — bots miram em nomes plausíveis. `aria-hidden`/`tabindex="-1"`/
// `autocomplete="off"` mantêm leitor de tela e autofill longe dele, senão o
// autofill do próprio usuário legítimo dispararia a isca.
export const HONEYPOT_FIELD = 'company_website';

export function honeypotFieldHTML() {
  return `<div class="hp-field" aria-hidden="true"><label for="${HONEYPOT_FIELD}">Não preencha este campo</label><input type="text" id="${HONEYPOT_FIELD}" name="${HONEYPOT_FIELD}" tabindex="-1" autocomplete="off" value=""></div>`;
}

// CSS do honeypot. Fora da viewport em vez de `display:none`: bot mais esperto
// checa `display`/`visibility` antes de preencher.
export const HONEYPOT_CSS = '.hp-field{position:absolute;left:-9999px;top:auto;width:1px;height:1px;overflow:hidden}';

/** @param {unknown} value */
export function honeypotTripped(value) {
  return typeof value === 'string' && value.trim() !== '';
}
