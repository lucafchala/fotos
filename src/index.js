import { galleryHTML } from './ui/gallery.js';
import { eventHTML } from './ui/event.js';
import { loginHTML, dashboardHTML } from './ui/dashboard.js';
import { supportHTML } from './ui/support.js';
import {
  getEvents, saveEvents, hashPassword, verifyPassword, generateToken,
  verifySession, escape, validateSlug, generateId, checkRateLimit,
  sendRemovalEmail, sendConfirmationEmail, sendResolvedEmail, sendSupportEmail,
} from './utils.js';

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const path = url.pathname.replace(/\/+$/, '') || '/';
    const method = request.method.toUpperCase();

    try {
      // PWA assets
      if (path === '/manifest.json' && method === 'GET') return handleManifest();
      if (path === '/icon.svg' && method === 'GET') return handleIcon();

      // Gallery index
      if (path === '/' && method === 'GET') return handleGallery(env);

      // Dashboard routes
      if (path === '/dashboard' && method === 'GET') return handleDashboardPage(request, env, url);
      if (path === '/dashboard/login' && method === 'POST') return handleLogin(request, env);
      if (path === '/dashboard/logout' && method === 'POST') return handleLogout(request, env);

      // API routes (require auth)
      if (path === '/api/events' && method === 'POST') return handleCreateEvent(request, env);
      if (path.startsWith('/api/events/') && method === 'PUT') return handleUpdateEvent(request, env, path);
      if (path.startsWith('/api/events/') && method === 'DELETE') return handleDeleteEvent(request, env, path);
      if (path === '/api/metrics' && method === 'GET') return handleMetrics(request, env);
      if (path === '/api/settings/password' && method === 'PUT') return handleChangePassword(request, env);
      if (path === '/api/backup' && method === 'GET') return handleGetBackup(request, env);
      if (path === '/api/backup/restore' && method === 'POST') return handleRestoreBackup(request, env);

      // Health check — tests Worker startup, KV connectivity, and hashing performance
      if (path === '/api/healthz' && method === 'GET') return handleHealthz(request, env);

      // Support page
      if (path === '/suporte' && method === 'GET') return html(supportHTML());
      if (path === '/api/suporte' && method === 'POST') return handleSupportRequest(request, env);

      // Public API
      if (path === '/api/removal-request' && method === 'POST') return handleRemovalRequest(request, env);
      if (path === '/api/track-drive' && method === 'POST') return handleTrackDrive(request, env);

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
      return new Response('Erro interno.', { status: 500 });
    }
  },
};

// ---------------------------------------------------------------------------
// Gallery
// ---------------------------------------------------------------------------
async function handleGallery(env) {
  const events = await getEvents(env);
  return html(galleryHTML(events, env.CF_ANALYTICS_TOKEN ?? null));
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

  const events = await getEvents(env, true);
  return new Response(dashboardHTML(events), {
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

  let name, email, message, tsToken;
  const ct = request.headers.get('Content-Type') || '';
  if (ct.includes('application/x-www-form-urlencoded') || ct.includes('multipart/form-data')) {
    const fd = await request.formData().catch(() => null);
    if (!fd) return html(supportHTML(false, 'Erro ao processar formulário.'), 400);
    name = String(fd.get('name') || '').trim().slice(0, 120);
    email = String(fd.get('email') || '').trim().slice(0, 200);
    message = String(fd.get('message') || '').trim().slice(0, 2000);
    tsToken = String(fd.get('cf-turnstile-response') || '');
  } else {
    let body;
    try { body = await request.json(); } catch { return jsonErr('JSON inválido.', 400); }
    name = String(body.name || '').trim().slice(0, 120);
    email = String(body.email || '').trim().slice(0, 200);
    message = String(body.message || '').trim().slice(0, 2000);
    tsToken = String(body['cf-turnstile-response'] || '');
  }

  const tsOk = await verifyTurnstile(tsToken, env);
  if (!tsOk) return html(supportHTML(false, 'Verificação de segurança falhou. Recarregue a página e tente novamente.'), 403);

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
  const requests = await getRemovalRequests(env);
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
      'Content-Security-Policy':
        "default-src 'self'; " +
        "script-src 'self' 'unsafe-inline' https://challenges.cloudflare.com https://static.cloudflareinsights.com https://cdn.jsdelivr.net; " +
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

// ---------------------------------------------------------------------------
// Backup — build / merge / Drive upload
// ---------------------------------------------------------------------------
function buildBackup(events) {
  return JSON.stringify({
    version: 1,
    backupAt: new Date().toISOString(),
    eventCount: events.length,
    events,
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
  const events = await getEvents(env, true);
  const date = new Date().toISOString().split('T')[0];
  return new Response(buildBackup(events), {
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
  return jsonOk({ ok: true, added, updated, total: merged.length });
}

function notFound() {
  return html(`<!DOCTYPE html><html lang="pt-BR"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1.0"><title>Não encontrado · fotos</title><style>*{box-sizing:border-box;margin:0;padding:0}body{font-family:sans-serif;background:#0a0a0a;color:#555;display:flex;align-items:center;justify-content:center;min-height:100vh;text-align:center;padding:2rem}h1{font-size:4rem;font-weight:700;color:#1a1a1a;margin-bottom:1rem}p{margin-bottom:2rem;font-size:.9rem}a{color:#666;text-decoration:none}a:hover{color:#aaa}</style></head><body><div><h1>404</h1><p>Página não encontrada.</p><a href="/">← Voltar para a galeria</a></div></body></html>`, 404);
}
