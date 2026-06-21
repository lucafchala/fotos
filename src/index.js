import { galleryHTML } from './ui/gallery.js';
import { eventHTML } from './ui/event.js';
import { loginHTML, dashboardHTML } from './ui/dashboard.js';
import { supportHTML } from './ui/support.js';
import { privacyHTML } from './ui/privacy.js';
import { termsHTML } from './ui/terms.js';
import {
  getEvents, saveEvents, getCategories, saveCategories, MAX_CATEGORIES, MAX_CATEGORY_LEN,
  hashPassword, verifyPassword, generateToken,
  verifySession, escape, validateSlug, generateId, checkRateLimit,
  sendRemovalEmail, sendConfirmationEmail, sendResolvedEmail, sendSupportEmail,
  toHttps, isLikelyImage, csvResponse,
  TERMS_VERSION, CONSENT_LABEL, ACCESS_TYPES,
} from './utils.js';

const SITE_URL = 'https://fotos.lucafchala.com';
const REMOVAL_RETENTION_DAYS = 180; // resolved removal requests are purged after this
const CONSENT_RETENTION_DAYS = 1825; // image-use consent rows purged after this (~5 anos — cobre o prazo prescricional de reparação civil; ajuste conforme orientação jurídica)

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const path = url.pathname.replace(/\/+$/, '') || '/';
    const method = request.method.toUpperCase();

    try {
      // PWA assets
      if (path === '/manifest.json' && method === 'GET') return handleManifest();
      if (path === '/icon.svg' && method === 'GET') return handleIcon();
      if (path === '/og-coming-soon.png' && method === 'GET') return handleComingSoonOgImage();

      // SEO
      if (path === '/sitemap.xml' && method === 'GET') return handleSitemap(env);
      if (path === '/robots.txt' && method === 'GET') return handleRobots();

      // Security contact (RFC 9116)
      if (path === '/.well-known/security.txt' && method === 'GET') return handleSecurityTxt();
      // Global Privacy Control — declares the site honors GPC opt-out signals
      if (path === '/.well-known/gpc.json' && method === 'GET') return handleGpc();

      // Gallery index
      if (path === '/' && method === 'GET') return handleGallery(env);

      // Dashboard routes
      if (path === '/dashboard' && method === 'GET') return handleDashboardPage(request, env, url);
      if (path === '/dashboard/login' && method === 'POST') return handleLogin(request, env);
      if (path === '/dashboard/logout' && method === 'POST') return handleLogout(request, env);

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
      if (path === '/api/settings/password' && method === 'PUT') return handleChangePassword(request, env);
      if (path === '/api/backup' && method === 'GET') return handleGetBackup(request, env);
      if (path === '/api/backup/restore' && method === 'POST') return handleRestoreBackup(request, env);
      if (path === '/api/consent/export' && method === 'GET') return handleConsentExport(request, env);

      // Health check — tests Worker startup, KV connectivity, and hashing performance
      if (path === '/api/healthz' && method === 'GET') return handleHealthz(request, env);

      // Support page
      if (path === '/suporte' && method === 'GET') return html(supportHTML());
      if (path === '/api/suporte' && method === 'POST') return handleSupportRequest(request, env);

      // Privacy policy
      if (path === '/privacidade' && method === 'GET') return html(privacyHTML());

      // Terms of use
      if (path === '/termos' && method === 'GET') return html(termsHTML());

      // About page (/sobre) — TODO: finalize the copy before exposing it. The
      // page exists in src/ui/about.js but is intentionally unrouted (hidden
      // from public view) and left out of the sitemap/footer for now.

      // Public API
      if (path === '/api/removal-request' && method === 'POST') return handleRemovalRequest(request, env);
      if (path === '/api/track-drive' && method === 'POST') return handleTrackDrive(request, env);
      if (path === '/api/consent' && method === 'POST') return handleConsent(request, env, ctx);

      // Admin API — removal requests
      if (path === '/api/removal-requests' && method === 'GET') return handleGetRemovalRequests(request, env);
      const resolveMatch = path.match(/^\/api\/removal-requests\/([a-f0-9]+)\/resolve$/);
      if (resolveMatch && method === 'PUT') return handleResolveRequest(request, env, resolveMatch[1]);

      // Event detail pages — must be last
      const slugMatch = path.match(/^\/([a-z0-9][a-z0-9-]*)$/);
      if (slugMatch && method === 'GET') return handleEventPage(request, env, slugMatch[1], ctx);

      return notFound();
    } catch (err) {
      console.error(err);
      return serverError();
    }
  },

  // Daily cron: purge resolved removal requests past the retention window so
  // personal data (e-mail/phone) is not kept indefinitely. Configured in
  // wrangler.toml ([triggers] crons).
  async scheduled(event, env, ctx) {
    ctx.waitUntil(pruneResolvedRemovalRequests(env).catch(e => console.error('retention prune failed', e)));
    ctx.waitUntil(pruneOldConsent(env).catch(e => console.error('consent prune failed', e)));
  },
};

// ---------------------------------------------------------------------------
// Gallery
// ---------------------------------------------------------------------------
async function handleGallery(env) {
  const events = await getEvents(env);
  const res = html(galleryHTML(events, env.CF_ANALYTICS_TOKEN ?? null));
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
    `  <url><loc>${SITE_URL}/privacidade</loc></url>`,
    `  <url><loc>${SITE_URL}/termos</loc></url>`,
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
    headers: { 'Content-Type': 'application/xml; charset=utf-8', 'Cache-Control': 'public, max-age=3600' },
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
    headers: { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'public, max-age=86400' },
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
    headers: { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'public, max-age=86400' },
  });
}

function handleGpc() {
  // This site never sells or shares personal data, so the GPC "do not
  // sell/share" opt-out is honored by default. https://globalprivacycontrol.org
  const body = JSON.stringify({ gpc: true, lastUpdate: '2026-06-16' });
  return new Response(body, {
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'public, max-age=86400' },
  });
}

// ---------------------------------------------------------------------------
// Event page
// ---------------------------------------------------------------------------
async function handleEventPage(request, env, slug, ctx) {
  const events = await getEvents(env);
  const event = events.find(e => e.slug === slug);
  if (!event) return notFound();

  // Only count view once per hour per visitor (avoids KV read+write on repeat visits).
  // KV read-modify-write is not atomic, so concurrent visits can undercount —
  // these are soft analytics, not hard metrics.
  const cookieName = `fv_${slug}`;
  const alreadyCounted = (request.headers.get('Cookie') || '').includes(`${cookieName}=1`);
  if (!alreadyCounted) {
    const viewKey = `views:${slug}`;
    ctx.waitUntil(
      env.FOTOS.get(viewKey).then(async v => {
        await env.FOTOS.put(viewKey, String(parseInt(v || '0', 10) + 1));
      }).catch(e => console.error('view counter failed', e))
    );
  }

  const res = html(eventHTML(event, env.CF_ANALYTICS_TOKEN ?? null));
  if (!alreadyCounted) res.headers.append('Set-Cookie', `${cookieName}=1; Max-Age=3600; Path=/${slug}; SameSite=Lax`);
  return res;
}

// ---------------------------------------------------------------------------
// Dashboard page
// ---------------------------------------------------------------------------
async function handleDashboardPage(request, env, url) {
  const stored = await getAdminHash(env);
  if (!stored) {
    return html('<p style="font-family:monospace;padding:40px">Painel não configurado — defina o secret <code>ADMIN_PASSWORD</code> no Worker.</p>', 503);
  }

  const authed = await verifySession(env, request);
  if (!authed) {
    const hasError = url.searchParams.get('error') === '1';
    return html(loginHTML({ error: hasError }));
  }

  const [events, categories] = await Promise.all([getEvents(env, true), getCategories(env)]);
  return new Response(dashboardHTML(events, categories), {
    headers: {
      'Content-Type': 'text/html; charset=utf-8',
      'Cache-Control': 'no-store, no-cache, must-revalidate, max-age=0',
    },
  });
}

// ---------------------------------------------------------------------------
// Login
// ---------------------------------------------------------------------------
async function handleLogin(request, env) {
  // Throttle brute-force: hard ceiling of login attempts per IP (PBKDF2 is
  // already slow, but this caps automated guessing). Counts every attempt.
  const ip = request.headers.get('CF-Connecting-IP') || 'unknown';
  if (!await checkRateLimit(env, ip, 'login', 10, 600)) {
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
  if (!stored) return redirect('/dashboard?error=1');

  const ok = await verifyPassword(password, stored);
  if (!ok) return redirect('/dashboard?error=1');
  // Migrate legacy SHA-256 hash to PBKDF2 on first successful login
  if (!stored.startsWith('pbkdf2:')) {
    await env.FOTOS.put('admin_password', await hashPassword(password));
  }

  const token = generateToken();
  await env.FOTOS.put(`admin_session:${token}`, 'valid', { expirationTtl: 86400 });

  return new Response(null, {
    status: 302,
    headers: {
      Location: '/dashboard',
      'Set-Cookie': `session=${token}; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=86400`,
    },
  });
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
async function handleLogout(request, env) {
  const cookies = request.headers.get('Cookie') || '';
  const match = cookies.match(/(?:^|;\s*)session=([a-f0-9]{64})/);
  if (match) await env.FOTOS.delete(`admin_session:${match[1]}`).catch(e => console.error('session delete failed', e));

  return new Response(null, {
    status: 302,
    headers: {
      Location: '/dashboard',
      'Set-Cookie': 'session=; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=0',
    },
  });
}

// ---------------------------------------------------------------------------
// Event field normalization (shared by create + update)
// ---------------------------------------------------------------------------
const EVENT_STATUSES = ['em-edicao', 'em-revisao', 'entregue', 'arquivado'];

// Fallback values for a brand-new event and for any field a legacy event is
// missing. Create passes this as the base; update passes the existing event.
export const DEFAULT_EVENT = {
  title: '', shortDescription: '', longDescription: '',
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
    shortDescription: pick('shortDescription', v => String(v).slice(0, 300)),
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
        views: parseInt(v || '0', 10),
        driveClicks: parseInt(d || '0', 10),
      };
    })
  );
  metrics.sort((a, b) => b.views - a.views);
  return jsonOk(metrics);
}

// ---------------------------------------------------------------------------
// API: Track Drive click (public)
// ---------------------------------------------------------------------------
async function handleTrackDrive(request, env) {
  const ip = request.headers.get('CF-Connecting-IP') || 'unknown';
  const allowed = await checkRateLimit(env, ip, 'drive', 60, 3600);
  if (!allowed) return jsonOk({ ok: true });

  let body;
  try { body = await request.json(); } catch { return jsonOk({ ok: true }); }
  const slug = String(body.slug || '').slice(0, 60);
  if (!slug || !validateSlug(slug)) return jsonOk({ ok: true });
  const key = `drive_clicks:${slug}`;
  const v = await env.FOTOS.get(key).catch(() => null);
  await env.FOTOS.put(key, String(parseInt(v || '0', 10) + 1)).catch(e => console.error('drive-click counter failed', e));
  return jsonOk({ ok: true });
}

// ---------------------------------------------------------------------------
// Support page form submission (public)
// ---------------------------------------------------------------------------
async function handleSupportRequest(request, env) {
  const ip = request.headers.get('CF-Connecting-IP') || 'unknown';
  const allowed = await checkRateLimit(env, ip, 'support', 5, 3600);
  if (!allowed) {
    return html(supportHTML(false, 'Muitas mensagens enviadas. Tente mais tarde.'), 429);
  }

  let name, email, message, tsToken, consent;
  const ct = request.headers.get('Content-Type') || '';
  if (ct.includes('application/x-www-form-urlencoded') || ct.includes('multipart/form-data')) {
    const fd = await request.formData().catch(() => null);
    if (!fd) return html(supportHTML(false, 'Erro ao processar formulário.'), 400);
    name = String(fd.get('name') || '').trim().slice(0, 120);
    email = String(fd.get('email') || '').trim().slice(0, 200);
    message = String(fd.get('message') || '').trim().slice(0, 2000);
    tsToken = String(fd.get('cf-turnstile-response') || '');
    consent = String(fd.get('consent') || '');
  } else {
    let body;
    try { body = await request.json(); } catch { return jsonErr('JSON inválido.', 400); }
    name = String(body.name || '').trim().slice(0, 120);
    email = String(body.email || '').trim().slice(0, 200);
    message = String(body.message || '').trim().slice(0, 2000);
    tsToken = String(body['cf-turnstile-response'] || '');
    consent = String(body.consent || '');
  }

  const tsOk = await verifyTurnstile(tsToken, env);
  if (!tsOk) return html(supportHTML(false, 'Verificação de segurança falhou. Recarregue a página e tente novamente.'), 403);

  if (consent !== '1') {
    return html(supportHTML(false, 'É necessário concordar com a política de privacidade.'), 400);
  }

  if (!message) {
    return html(supportHTML(false, 'A mensagem não pode estar vazia.'), 400);
  }

  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email)) {
    return html(supportHTML(false, 'E-mail inválido.'), 400);
  }

  try {
    await sendSupportEmail(env, { name, email, message });
  } catch (e) {
    console.error('sendSupportEmail:', e);
  }

  return html(supportHTML(true));
}

// ---------------------------------------------------------------------------
// API: Change password
// ---------------------------------------------------------------------------
async function handleChangePassword(request, env) {
  const authErr = await checkAuth(request, env);
  if (authErr) return authErr;

  let body;
  try { body = await request.json(); } catch { return jsonErr('JSON inválido.', 400); }

  const { password } = body;
  if (!password || typeof password !== 'string' || password.length < 6) {
    return jsonErr('Senha muito curta.', 400);
  }
  const hash = await hashPassword(password);
  await env.FOTOS.put('admin_password', hash);
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
      return jsonErr('Envie uma imagem válida (JPEG, PNG, WebP, GIF ou HEIC).', 415);
    }
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
    fileBase64: method === 'upload' ? fileBase64 : null,
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
  const newReq = { ...req, fileBase64: null };
  requests.push(newReq);

  const MAX_REQUESTS = 500;
  trimRequests(requests, MAX_REQUESTS);

  await env.FOTOS.put('removal_requests', JSON.stringify(requests));

  // Send notification to admin
  try {
    const sent = await sendRemovalEmail(env, req);
    newReq.emailStatus = sent ? 'sent' : 'skipped: RESEND_API_KEY não configurada';
  } catch (err) {
    newReq.emailStatus = 'error: ' + String(err.message || err).slice(0, 200);
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
  const unresolved = requests.filter(r => !r.resolved);
  const resolved = requests.filter(r => r.resolved)
    .sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)))
    .slice(0, Math.max(0, max - unresolved.length));
  requests.splice(0, requests.length, ...unresolved, ...resolved);
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
async function handleHealthz(request, env) {
  const ip = request.headers.get('CF-Connecting-IP') || 'unknown';
  const allowed = await checkRateLimit(env, ip, 'healthz', 10, 60);
  if (!allowed) return jsonErr('Too many requests.', 429);

  // KV is the binding the whole app depends on. A read failure here (or a
  // corrupt `events` value) is the only condition that flips ok:false — this
  // mirrors the pre-existing 500-on-throw behavior the deploy smoke test relies
  // on, while now reporting *which* subsystem failed instead of a blank 500.
  let kv = false;
  let events = null;
  try {
    await env.FOTOS.get('__healthz__');
    kv = true;
    const list = await getEvents(env, true);
    events = Array.isArray(list) ? list.length : null;
  } catch {
    // KV unavailable — kv/events keep their pre-failure values, so ok flips false
  }

  // The D1 consent log is optional/best-effort: a missing or unscoped binding
  // must never fail the deploy (see deploy.yml), so it is reported for the
  // status dashboard but never flips ok.
  let d1 = 'absent';
  if (env.CONSENT_DB) {
    try {
      await env.CONSENT_DB.prepare('SELECT 1').first();
      d1 = 'ok';
    } catch {
      d1 = 'down';
    }
  }

  // PBKDF2 hash — confirms login hashing completes within the CPU budget
  const t0 = Date.now();
  await hashPassword('healthcheck');
  const hashMs = Date.now() - t0;

  const ok = kv && events !== null;
  return jsonOk({ ok, kv, events, d1, hashMs }, ok ? 200 : 503);
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

// Public, best-effort, non-blocking: record an image-use authorization at the
// moment of Drive access, capturing as much defensible context as possible.
// A missing CONSENT_DB binding (not yet provisioned) is a no-op, never an error.
async function handleConsent(request, env, ctx) {
  const ip = request.headers.get('CF-Connecting-IP') || 'unknown';
  const allowed = await checkRateLimit(env, ip, 'consent', 60, 3600);
  if (!allowed) return jsonOk({ ok: true });
  if (!env.CONSENT_DB) return jsonOk({ ok: true, logged: false });

  let body;
  try { body = await request.json(); } catch { return jsonOk({ ok: true }); }

  const slug = String(body.slug || '').slice(0, 60);
  if (!validateSlug(slug)) return jsonOk({ ok: true });

  // Server-side Turnstile check (the drive gate's first real server verification).
  // A failed/expired token still logs the access with turnstile_ok=0 — the human
  // already ticked the box, so we record the truth rather than block the download.
  const turnstileOk = (await verifyTurnstile(body.turnstileToken, env)) ? 1 : 0;

  const cf = request.cf || {};
  const events = await getEvents(env);
  const event = events.find(e => e.slug === slug);

  // The category the visitor accepted under, and the verbatim self-declaration they ticked
  // (empty for 'public', which requires only the Terms acceptance).
  const accessType = ACCESS_TYPES.includes(body.accessType) ? body.accessType : 'public';

  const vals = [
    generateId(),
    new Date().toISOString(),
    slug,
    (event?.title || '').slice(0, 200),
    ['full', 'instagram'].includes(body.driveTarget) ? body.driveTarget : 'full',
    accessType,
    String(body.termsVersion || TERMS_VERSION).slice(0, 40),
    await getTermsHash(),
    String(body.consentText || CONSENT_LABEL).slice(0, 500),
    String(body.declarationText || '').slice(0, 500) || null,
    String(body.name || '').trim().slice(0, 120) || null,
    turnstileOk,
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
  ctx.waitUntil(stmt.run().catch(e => console.error('consent insert failed', e)));

  return jsonOk({ ok: true });
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

function html(content, status = 200) {
  return new Response(content, {
    status,
    headers: {
      'Content-Type': 'text/html; charset=utf-8',
      'X-Content-Type-Options': 'nosniff',
      'X-Frame-Options': 'DENY',
      'Referrer-Policy': 'strict-origin-when-cross-origin',
      'Strict-Transport-Security': 'max-age=31536000; includeSubDomains',
      'Permissions-Policy': 'camera=(), microphone=(), geolocation=()',
      'Cross-Origin-Opener-Policy': 'same-origin',
      'Cross-Origin-Resource-Policy': 'same-site',
      'Content-Security-Policy':
        "default-src 'self'; " +
        "script-src 'self' 'unsafe-inline' https://challenges.cloudflare.com https://static.cloudflareinsights.com; " +
        "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; " +
        "font-src https://fonts.gstatic.com; " +
        "img-src 'self' data: blob: https://*.googleusercontent.com https://drive.google.com; " +
        "connect-src 'self' https://challenges.cloudflare.com https://cloudflareinsights.com; " +
        "frame-src https://challenges.cloudflare.com; " +
        "frame-ancestors 'none'; base-uri 'self'; form-action 'self'; upgrade-insecure-requests",
    },
  });
}

function redirect(location) {
  return new Response(null, { status: 302, headers: { Location: location } });
}

function jsonOk(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json', 'X-Content-Type-Options': 'nosniff' },
  });
}

function jsonErr(message, status = 400) {
  return new Response(JSON.stringify({ error: message }), {
    status,
    headers: { 'Content-Type': 'application/json', 'X-Content-Type-Options': 'nosniff' },
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
    headers: { 'Content-Type': 'application/manifest+json', 'Cache-Control': 'public, max-age=86400' },
  });
}

function handleIcon() {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 256 256"><rect width="256" height="256" rx="48" fill="#0a0a0a"/><text x="50%" y="55%" text-anchor="middle" dominant-baseline="middle" font-family="-apple-system,BlinkMacSystemFont,'Inter',sans-serif" font-size="140" font-weight="600" fill="#f0ebe5">f.</text></svg>`;
  return new Response(svg, {
    status: 200,
    headers: { 'Content-Type': 'image/svg+xml', 'Cache-Control': 'public, max-age=604800' },
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
    headers: { 'Content-Type': 'image/png', 'Cache-Control': 'public, max-age=604800' },
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

export function mergeRestore(current, backupEvents) {
  const result = [...current];
  let added = 0, updated = 0;
  for (const bEv of backupEvents) {
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
      'Content-Type': 'application/json',
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
      if (r && r.id && !byId.has(r.id)) { byId.set(r.id, r); rAdded++; }
    }
    await env.FOTOS.put('removal_requests', JSON.stringify([...byId.values()]));
    result.removalRequestsAdded = rAdded;
  }

  return jsonOk(result);
}

function errorPage(code, message, status) {
  return html(`<!DOCTYPE html><html lang="pt-BR"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1.0"><title>${code} · fotos</title><style>*{box-sizing:border-box;margin:0;padding:0}body{font-family:sans-serif;background:#0a0a0a;color:#555;display:flex;align-items:center;justify-content:center;min-height:100vh;text-align:center;padding:2rem}h1{font-size:4rem;font-weight:700;color:#1a1a1a;margin-bottom:1rem}p{margin-bottom:2rem;font-size:.9rem}a{color:#666;text-decoration:none}a:hover{color:#aaa}</style></head><body><div><h1>${code}</h1><p>${message}</p><a href="/">← Voltar para a galeria</a></div></body></html>`, status);
}

function notFound() {
  return errorPage('404', 'Página não encontrada.', 404);
}

function serverError() {
  return errorPage('500', 'Algo deu errado. Tente novamente em instantes.', 500);
}
