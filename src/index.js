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
  TERMS_VERSION, CONSENT_LABEL,
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
      if (path.startsWith('/api/events/') && method === 'PUT') return handleUpdateEvent(request, env, path);
      if (path.startsWith('/api/events/') && method === 'DELETE') return handleDeleteEvent(request, env, path);
      if (path === '/api/categories' && method === 'GET') return handleGetCategories(request, env);
      if (path === '/api/categories' && method === 'POST') return handleCreateCategory(request, env);
      if (path === '/api/categories/delete' && method === 'POST') return handleDeleteCategory(request, env);
      if (path === '/api/metrics' && method === 'GET') return handleMetrics(request, env);
      if (path === '/api/reviews' && method === 'GET') return handleGetReviews(request, env);
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

      // Public API
      if (path === '/api/removal-request' && method === 'POST') return handleRemovalRequest(request, env);
      if (path === '/api/track-drive' && method === 'POST') return handleTrackDrive(request, env);
      if (path === '/api/review' && method === 'POST') return handleReview(request, env);
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
  // Open to all crawlers and AI agents (training, search, live answering);
  // admin dashboard and API endpoints stay excluded from indexing.
  const aiAgents = [
    'GPTBot', 'OAI-SearchBot', 'ChatGPT-User', 'Google-Extended',
    'ClaudeBot', 'Claude-Web', 'Claude-User', 'Claude-SearchBot', 'anthropic-ai',
    'PerplexityBot', 'CCBot', 'Bytespider', 'Amazonbot', 'Applebot-Extended',
    'Meta-ExternalAgent', 'cohere-ai',
  ];
  const rules = 'Allow: /\nDisallow: /dashboard\nDisallow: /api/\n';
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
    'Expires: 2027-01-20T14:54:00Z\n' +
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
    ? body.photos.slice(0, 6).map(u => toHttps(String(u).slice(0, 500))).filter(Boolean)
    : (body.thumbnailUrl ? [toHttps(String(body.thumbnailUrl).slice(0, 500))] : []);

  const event = {
    id: generateId(),
    slug,
    title: String(title).slice(0, 200),
    shortDescription: String(body.shortDescription || '').slice(0, 300),
    longDescription: String(body.longDescription || '').slice(0, 5000),
    photos,
    thumbnailUrl: photos[0] || '',
    driveUrl: toHttps(String(driveUrl).slice(0, 500)),
    driveUrlInstagram: body.driveUrlInstagram ? toHttps(String(body.driveUrlInstagram).slice(0, 500)) : '',
    date: /^\d{4}-\d{2}-\d{2}$/.test(body.date || '') ? body.date : '',
    eventCredits: String(body.eventCredits || '').slice(0, 200),
    projectUrl: body.projectUrl ? toHttps(String(body.projectUrl).slice(0, 500)) : '',
    visible: body.visible !== false,
    comingSoon: body.comingSoon === true,
    status: ['em-edicao','em-revisao','entregue','arquivado'].includes(body.status) ? body.status : 'entregue',
    category: cats.includes(body.category) ? body.category : '',
    internalNotes: String(body.internalNotes || '').slice(0, 5000),
    pinned: body.pinned === true,
    photosAlert: body.photosAlert && typeof body.photosAlert === 'object' ? {
      active: body.photosAlert.active === true,
      addedAt: body.photosAlert.addedAt || null,
      expiresAfterHours: parseInt(body.photosAlert.expiresAfterHours) || 0,
    } : { active: false, addedAt: null, expiresAfterHours: 24 },
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

  const newPhotos = body.photos !== undefined
    ? (Array.isArray(body.photos)
        ? body.photos.slice(0, 6).map(u => toHttps(String(u).slice(0, 500))).filter(Boolean)
        : (existing.photos || []))
    : (existing.photos || []);

  const updated = {
    ...existing,
    title: body.title !== undefined ? String(body.title).slice(0, 200) : existing.title,
    shortDescription: body.shortDescription !== undefined ? String(body.shortDescription).slice(0, 300) : existing.shortDescription,
    longDescription: body.longDescription !== undefined ? String(body.longDescription).slice(0, 5000) : existing.longDescription,
    photos: newPhotos,
    thumbnailUrl: newPhotos[0] || existing.thumbnailUrl || '',
    driveUrl: body.driveUrl !== undefined ? toHttps(String(body.driveUrl).slice(0, 500)) : existing.driveUrl,
    driveUrlInstagram: body.driveUrlInstagram !== undefined
      ? (body.driveUrlInstagram ? toHttps(String(body.driveUrlInstagram).slice(0, 500)) : '')
      : (existing.driveUrlInstagram || ''),
    date: body.date !== undefined ? (/^\d{4}-\d{2}-\d{2}$/.test(body.date) ? body.date : '') : existing.date,
    eventCredits: body.eventCredits !== undefined ? String(body.eventCredits).slice(0, 200) : existing.eventCredits,
    projectUrl: body.projectUrl !== undefined ? toHttps(String(body.projectUrl).slice(0, 500)) : existing.projectUrl,
    visible: body.visible !== undefined ? body.visible !== false : existing.visible,
    comingSoon: body.comingSoon !== undefined ? body.comingSoon === true : (existing.comingSoon === true),
    status: body.status !== undefined
      ? (['em-edicao','em-revisao','entregue','arquivado'].includes(body.status) ? body.status : (existing.status || 'entregue'))
      : (existing.status || 'entregue'),
    category: body.category !== undefined
      ? (cats.includes(body.category) ? body.category : (existing.category || ''))
      : (existing.category || ''),
    internalNotes: body.internalNotes !== undefined ? String(body.internalNotes).slice(0, 5000) : (existing.internalNotes || ''),
    pinned: body.pinned !== undefined ? body.pinned === true : (existing.pinned === true),
    photosAlert: body.photosAlert && typeof body.photosAlert === 'object' ? {
      active: body.photosAlert.active === true,
      addedAt: body.photosAlert.addedAt || null,
      expiresAfterHours: parseInt(body.photosAlert.expiresAfterHours) || 0,
    } : (existing.photosAlert || { active: false, addedAt: null, expiresAfterHours: 24 }),
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
// API: Review submission (public)
// ---------------------------------------------------------------------------
async function handleReview(request, env) {
  const ip = request.headers.get('CF-Connecting-IP') || 'unknown';
  const allowed = await checkRateLimit(env, ip, 'review', 5, 3600);
  if (!allowed) return jsonErr('Muitas solicitações. Tente mais tarde.', 429);

  let body;
  try { body = await request.json(); } catch { return jsonErr('JSON inválido.', 400); }

  const { slug, rating, comment, email, turnstileToken } = body;
  if (!slug || !validateSlug(String(slug))) return jsonErr('Evento não encontrado.', 400);
  const r = Number(rating);
  if (!Number.isInteger(r) || r < 1 || r > 5) return jsonErr('Avaliação inválida.', 400);

  const tsOk = await verifyTurnstile(turnstileToken, env);
  if (!tsOk) return jsonErr('Verificação de segurança falhou. Recarregue e tente novamente.', 403);

  const key = `reviews_${slug}`;
  let reviews = [];
  try { reviews = JSON.parse(await env.FOTOS.get(key) || '[]'); } catch { reviews = []; }
  reviews.push({
    id: generateId(),
    slug: String(slug).slice(0, 60),
    rating: r,
    comment: String(comment || '').trim().slice(0, 1000),
    email: String(email || '').trim().slice(0, 200),
    submittedAt: new Date().toISOString(),
  });
  await env.FOTOS.put(key, JSON.stringify(reviews));
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
  requests.push({ ...req, fileBase64: null });

  const MAX_REQUESTS = 500;
  if (requests.length > MAX_REQUESTS) {
    const unresolved = requests.filter(r => !r.resolved);
    const resolved = requests.filter(r => r.resolved)
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
      .slice(0, MAX_REQUESTS - unresolved.length);
    requests.splice(0, requests.length, ...unresolved, ...resolved);
  }

  await env.FOTOS.put('removal_requests', JSON.stringify(requests));

  // Send notification to admin
  try {
    const sent = await sendRemovalEmail(env, req);
    requests[requests.length - 1].emailStatus = sent ? 'sent' : 'skipped: RESEND_API_KEY não configurada';
  } catch (err) {
    requests[requests.length - 1].emailStatus = 'error: ' + String(err.message || err).slice(0, 200);
  }

  // Send confirmation to requester
  try {
    const sent = await sendConfirmationEmail(env, req);
    requests[requests.length - 1].confirmEmailStatus = sent ? 'sent' : null;
  } catch (err) {
    requests[requests.length - 1].confirmEmailStatus = 'error: ' + String(err.message || err).slice(0, 200);
  }

  await env.FOTOS.put('removal_requests', JSON.stringify(requests));

  return jsonOk({ ok: true });
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
  let resolvedEmailStatus = null;
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

  // KV read — confirms the binding is alive
  await env.FOTOS.get('__healthz__');

  // PBKDF2 hash — confirms hashing completes within the CPU budget
  const t0 = Date.now();
  await hashPassword('healthcheck');
  const hashMs = Date.now() - t0;

  return jsonOk({ ok: true, hashMs });
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
  'created_at', 'event_slug', 'event_title', 'drive_target', 'terms_version',
  'terms_hash', 'consent_text', 'consenter_name', 'turnstile_ok', 'ip', 'country',
  'region', 'city', 'timezone', 'asn', 'as_org', 'colo', 'user_agent',
  'accept_language', 'referrer', 'page_url',
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

  const vals = [
    generateId(),
    new Date().toISOString(),
    slug,
    (event?.title || '').slice(0, 200),
    ['full', 'instagram'].includes(body.driveTarget) ? body.driveTarget : 'full',
    String(body.termsVersion || TERMS_VERSION).slice(0, 40),
    await getTermsHash(),
    String(body.consentText || CONSENT_LABEL).slice(0, 500),
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
       (id, created_at, event_slug, event_title, drive_target, terms_version, terms_hash,
        consent_text, consenter_name, turnstile_ok, ip, country, region, city, timezone,
        asn, as_org, colo, user_agent, accept_language, referrer, page_url)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`
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

// Retention: delete consent rows older than the window (6 months). Runs in the daily cron.
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

function toHttps(url) {
  const u = url.startsWith('http://') ? 'https://' + url.slice(7) : url;
  // href/src are script-executing sinks — drop javascript:/data:/anything non-https
  return /^https:\/\//i.test(u) ? u : '';
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

// CSV export helpers (shared by the consent / removal / metrics / reviews exports).
function csvCell(v) {
  if (v === null || v === undefined) return '';
  const s = String(v);
  return /[",\n\r]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
}

function csvResponse(filename, cols, rows) {
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

// ---------------------------------------------------------------------------
// Reviews — admin read + aggregation
// ---------------------------------------------------------------------------
// Reviews are stored per event under `reviews_<slug>` and previously had no
// read path. Aggregate them across all events for the dashboard and backups.
async function getAllReviews(env) {
  const out = [];
  let cursor;
  do {
    const list = await env.FOTOS.list({ prefix: 'reviews_', cursor });
    for (const k of list.keys) {
      const slug = k.name.slice('reviews_'.length);
      let arr = [];
      try { arr = JSON.parse(await env.FOTOS.get(k.name) || '[]'); } catch { arr = []; }
      for (const r of arr) out.push({ slug, ...r });
    }
    cursor = list.list_complete ? null : list.cursor;
  } while (cursor);
  out.sort((a, b) => String(b.submittedAt || '').localeCompare(String(a.submittedAt || '')));
  return out;
}

async function handleGetReviews(request, env) {
  const authErr = await checkAuth(request, env);
  if (authErr) return authErr;
  return jsonOk(await getAllReviews(env));
}

// ---------------------------------------------------------------------------
// Backup — full site state (v2), with v1-compatible restore
// ---------------------------------------------------------------------------
function buildBackup({ events, categories, reviews, removalRequests }) {
  return JSON.stringify({
    version: 2,
    backupAt: new Date().toISOString(),
    eventCount: events.length,
    events,
    categories,
    reviews,
    removalRequests,
  });
}

function mergeRestore(current, backupEvents) {
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
  const [events, categories, reviews, removalRequests] = await Promise.all([
    getEvents(env, true), getCategories(env), getAllReviews(env), getRemovalRequests(env),
  ]);
  const date = new Date().toISOString().split('T')[0];
  return new Response(buildBackup({ events, categories, reviews, removalRequests }), {
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

  if (Array.isArray(body.reviews)) {
    const bySlug = {};
    for (const rv of body.reviews) {
      if (rv && rv.slug) (bySlug[rv.slug] = bySlug[rv.slug] || []).push(rv);
    }
    let rvAdded = 0;
    for (const slug of Object.keys(bySlug)) {
      if (!validateSlug(slug)) continue;
      const key = `reviews_${slug}`;
      let cur = [];
      try { cur = JSON.parse(await env.FOTOS.get(key) || '[]'); } catch { cur = []; }
      const ids = new Set(cur.map(x => x.id));
      for (const rv of bySlug[slug]) {
        if (rv.id && !ids.has(rv.id)) { cur.push(rv); ids.add(rv.id); rvAdded++; }
      }
      await env.FOTOS.put(key, JSON.stringify(cur));
    }
    result.reviewsAdded = rvAdded;
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
