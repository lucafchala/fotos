let _cache = null;
let _cacheAt = 0;
const CACHE_TTL = 30_000;
// Abort outbound transactional-email calls if Resend hangs, so a slow upstream
// never holds the request past this budget.
const EMAIL_TIMEOUT_MS = 10_000;
// Same idea for outbound Google Drive API calls (photo-count auto-fetch).
const DRIVE_API_TIMEOUT_MS = 10_000;
// Hard ceiling on paginated files.list requests per fetch — a runaway loop
// (e.g. Drive misbehaving) can't hang the request indefinitely or blow past
// a sane per-event photo count.
const DRIVE_API_MAX_PAGES = 20;
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

export async function verifySession(env, request) {
  const cookies = request.headers.get('Cookie') || '';
  const match = cookies.match(/(?:^|;\s*)session=([a-f0-9]{64})/);
  if (!match) return false;
  const valid = await env.FOTOS.get(`admin_session:${match[1]}`);
  return valid === 'valid';
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
// page so the six near-identical footers can't drift out of sync as new
// links get added. The year is computed live — pages render per-request, so
// the copyright is always current with no cron/build step needed. Callers
// provide their own CSS for .legal-link/.footer-copyright (this only returns
// markup, same contract as escape()/formatDatePT()).
export function footerLegalLinksHTML() {
  const year = new Date().getFullYear();
  return `
    <div class="footer-actions-legal">
      <a href="/suporte" class="legal-link">Suporte</a>
      <a href="/privacidade" class="legal-link">Privacidade</a>
      <a href="/termos" class="legal-link">Termos</a>
      <a href="https://github.com/lucafchala/fotos" target="_blank" rel="noopener" class="legal-link">Código-fonte</a>
    </div>
    <p class="footer-copyright">© ${year} Luca F. Chala. Todos os direitos reservados.</p>`;
}

// Instagram-branded credit button, reused twice on the event page (main
// credits section + drive-modal guide box). idSuffix keeps each instance's
// SVG gradient id unique since both can render on the same document.
export function igCreditButtonHTML(idSuffix, label = 'por favor marque o fotógrafo') {
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

// Pull the folder ID out of a typical Drive share link
// (https://drive.google.com/drive/folders/<id>?usp=sharing). Returns '' for
// anything else (a file link, a malformed URL, a non-Drive URL).
export function extractDriveFolderId(url) {
  if (!url || typeof url !== 'string') return '';
  const m = url.match(/\/folders\/([\w-]+)/);
  return m ? m[1] : '';
}

// Counts image files in a public Drive folder via the Drive v3 API using a
// plain API key (no OAuth/service account needed — works for any folder
// shared "Anyone with the link"). Paginates until exhausted or
// DRIVE_API_MAX_PAGES is hit. Returns null (never throws) on any failure —
// this backs an optional "auto-fetch" convenience in the dashboard, not a
// path anything else depends on, so callers just fall back to the
// manually-entered count when this comes back null.
export async function fetchDrivePhotoCount(folderId, apiKey) {
  if (!folderId || !apiKey) return null;
  let count = 0;
  let pageToken = '';
  try {
    for (let page = 0; page < DRIVE_API_MAX_PAGES; page++) {
      const params = new URLSearchParams({
        q: `'${folderId}' in parents and trashed = false and mimeType contains 'image/'`,
        fields: 'nextPageToken,files(id)',
        pageSize: '1000',
        key: apiKey,
      });
      if (pageToken) params.set('pageToken', pageToken);
      const res = await fetch(`https://www.googleapis.com/drive/v3/files?${params}`, {
        signal: AbortSignal.timeout(DRIVE_API_TIMEOUT_MS),
      });
      if (!res.ok) return null;
      const data = await res.json();
      count += Array.isArray(data.files) ? data.files.length : 0;
      pageToken = data.nextPageToken || '';
      if (!pageToken) break;
    }
    return count;
  } catch {
    return null;
  }
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
export function csvCell(v) {
  if (v === null || v === undefined) return '';
  const s = String(v);
  return /[",\n\r]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
}

export function csvResponse(filename, cols, rows) {
  const head = cols.map(csvCell).join(',');
  const lines = rows.map(r => cols.map(c => csvCell(r[c])).join(','));
  // Leading BOM so Excel opens UTF-8 (accents) correctly.
  const csv = '﻿' + [head, ...lines].join('\r\n') + '\r\n';
  return new Response(csv, {
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="${filename}"`,
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
    body.attachments = [{ filename: req.fileName, content: req.fileBase64 }];
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
  <p style="margin-top:12px;font-size:13px;line-height:1.6;color:#666">Qualquer outra dúvida, fale pelo <a href="https://wa.me/5511989211178" style="color:#888">WhatsApp</a> ou envie um e-mail para <a href="mailto:suporte@lucafchala.com" style="color:#888">suporte@lucafchala.com</a>.</p>
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
  <p style="margin-top:12px;font-size:13px;line-height:1.6;color:#666">Em caso de dúvidas, entre em contato pelo <a href="https://wa.me/5511989211178" style="color:#888">WhatsApp</a> ou por <a href="mailto:suporte@lucafchala.com" style="color:#888">suporte@lucafchala.com</a>.</p>
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
export function perfBootScript(page, enabled) {
  return `<script>(function(){
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
