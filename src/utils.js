let _cache = null;
let _cacheAt = 0;
const CACHE_TTL = 30_000;
// Abort outbound transactional-email calls if Resend hangs, so a slow upstream
// never holds the request past this budget.
const EMAIL_TIMEOUT_MS = 10_000;

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
          <rect x="2" y="2" width="20" height="20" rx="6" fill="url(#igGrad${idSuffix})"/>
          <circle cx="12" cy="12" r="5" fill="none" stroke="#fff" stroke-width="1.8"/>
          <circle cx="17.2" cy="6.8" r="1.3" fill="#fff"/>
        </svg>
      </span>
      <span class="ig-credit-text">${label}: <strong>@lucafchala</strong></span>
    </a>`;
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
