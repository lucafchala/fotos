import { galleryHTML } from './ui/gallery.js';
import { eventHTML } from './ui/event.js';
import { loginHTML, dashboardHTML } from './ui/dashboard.js';
import {
  getEvents, saveEvents, hashPassword, generateToken,
  verifySession, escape, validateSlug, generateId,
} from './utils.js';

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const path = url.pathname.replace(/\/+$/, '') || '/';
    const method = request.method.toUpperCase();

    try {
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

      // Event detail pages — must be last
      const slugMatch = path.match(/^\/([a-z0-9][a-z0-9-]*)$/);
      if (slugMatch && method === 'GET') return handleEventPage(request, env, slugMatch[1]);

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
  return html(galleryHTML(events));
}

// ---------------------------------------------------------------------------
// Event page
// ---------------------------------------------------------------------------
async function handleEventPage(request, env, slug) {
  const events = await getEvents(env);
  const event = events.find(e => e.slug === slug);
  if (!event) return notFound();

  // Track view (fire-and-forget, don't block the response)
  const viewKey = `views:${slug}`;
  env.FOTOS.get(viewKey).then(async v => {
    const count = parseInt(v || '0', 10);
    await env.FOTOS.put(viewKey, String(count + 1));
  }).catch(() => {});

  return html(eventHTML(event));
}

// ---------------------------------------------------------------------------
// Dashboard page
// ---------------------------------------------------------------------------
async function handleDashboardPage(request, env, url) {
  const stored = await env.FOTOS.get('admin_password');
  if (!stored) return html(loginHTML({ isSetup: true }));

  const authed = await verifySession(env, request);
  if (!authed) {
    const hasError = url.searchParams.get('error') === '1';
    return html(loginHTML({ error: hasError }));
  }

  const events = await getEvents(env);
  return html(dashboardHTML(events));
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
  const isSetup = body.setup === '1';
  const confirm = body.confirm || '';
  const stored = await env.FOTOS.get('admin_password');

  if (isSetup || !stored) {
    // First-run: set the password
    if (isSetup && password !== confirm) return redirect('/dashboard?error=1');
    if (!password || password.length < 6) return redirect('/dashboard?error=1');
    const hash = await hashPassword(password);
    await env.FOTOS.put('admin_password', hash);
  } else {
    // Normal login
    const hash = await hashPassword(password);
    if (hash !== stored) return redirect('/dashboard?error=1');
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

// ---------------------------------------------------------------------------
// Logout
// ---------------------------------------------------------------------------
async function handleLogout(request, env) {
  const cookies = request.headers.get('Cookie') || '';
  const match = cookies.match(/(?:^|;\s*)session=([a-f0-9]{64})/);
  if (match) await env.FOTOS.delete(`admin_session:${match[1]}`).catch(() => {});

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

  const events = await getEvents(env);
  if (events.find(e => e.slug === slug)) return jsonErr('Já existe um evento com essa URL.', 409);

  const event = {
    id: generateId(),
    slug,
    title: String(title).slice(0, 200),
    shortDescription: String(body.shortDescription || '').slice(0, 300),
    longDescription: String(body.longDescription || '').slice(0, 5000),
    thumbnailUrl: String(body.thumbnailUrl || '').slice(0, 500),
    driveUrl: String(driveUrl).slice(0, 500),
    date: /^\d{4}-\d{2}-\d{2}$/.test(body.date || '') ? body.date : '',
    eventCredits: String(body.eventCredits || '').slice(0, 200),
    projectUrl: String(body.projectUrl || '').slice(0, 500),
    visible: body.visible !== false,
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

  const events = await getEvents(env);
  const idx = events.findIndex(e => e.id === id);
  if (idx === -1) return jsonErr('Evento não encontrado.', 404);

  const existing = events[idx];
  const updated = {
    ...existing,
    title: body.title !== undefined ? String(body.title).slice(0, 200) : existing.title,
    shortDescription: body.shortDescription !== undefined ? String(body.shortDescription).slice(0, 300) : existing.shortDescription,
    longDescription: body.longDescription !== undefined ? String(body.longDescription).slice(0, 5000) : existing.longDescription,
    thumbnailUrl: body.thumbnailUrl !== undefined ? String(body.thumbnailUrl).slice(0, 500) : existing.thumbnailUrl,
    driveUrl: body.driveUrl !== undefined ? String(body.driveUrl).slice(0, 500) : existing.driveUrl,
    date: body.date !== undefined ? (/^\d{4}-\d{2}-\d{2}$/.test(body.date) ? body.date : '') : existing.date,
    eventCredits: body.eventCredits !== undefined ? String(body.eventCredits).slice(0, 200) : existing.eventCredits,
    projectUrl: body.projectUrl !== undefined ? String(body.projectUrl).slice(0, 500) : existing.projectUrl,
    visible: body.visible !== undefined ? body.visible !== false : existing.visible,
    updatedAt: new Date().toISOString(),
  };

  // Allow slug update only if no other event uses it
  if (body.slug && body.slug !== existing.slug) {
    if (!validateSlug(body.slug)) return jsonErr('URL inválida.', 400);
    if (events.some((e, i) => i !== idx && e.slug === body.slug)) return jsonErr('URL já está em uso.', 409);
    updated.slug = body.slug;
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
  const events = await getEvents(env);
  const idx = events.findIndex(e => e.id === id);
  if (idx === -1) return jsonErr('Evento não encontrado.', 404);

  const [removed] = events.splice(idx, 1);
  await saveEvents(env, events);
  await env.FOTOS.delete(`views:${removed.slug}`).catch(() => {});
  return jsonOk({ deleted: true });
}

// ---------------------------------------------------------------------------
// API: Metrics
// ---------------------------------------------------------------------------
async function handleMetrics(request, env) {
  const authErr = await checkAuth(request, env);
  if (authErr) return authErr;

  const events = await getEvents(env);
  const metrics = await Promise.all(
    events.map(async e => {
      const v = await env.FOTOS.get(`views:${e.slug}`);
      return { slug: e.slug, title: e.title, views: parseInt(v || '0', 10) };
    })
  );
  metrics.sort((a, b) => b.views - a.views);
  return jsonOk(metrics);
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
    headers: { 'Content-Type': 'text/html; charset=utf-8' },
  });
}

function redirect(location) {
  return new Response(null, { status: 302, headers: { Location: location } });
}

function jsonOk(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

function jsonErr(message, status = 400) {
  return new Response(JSON.stringify({ error: message }), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

function notFound() {
  return html(`<!DOCTYPE html><html lang="pt-BR"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1.0"><title>Não encontrado · fotos</title><style>*{box-sizing:border-box;margin:0;padding:0}body{font-family:sans-serif;background:#0a0a0a;color:#555;display:flex;align-items:center;justify-content:center;min-height:100vh;text-align:center;padding:2rem}h1{font-size:4rem;font-weight:700;color:#1a1a1a;margin-bottom:1rem}p{margin-bottom:2rem;font-size:.9rem}a{color:#666;text-decoration:none}a:hover{color:#aaa}</style></head><body><div><h1>404</h1><p>Página não encontrada.</p><a href="/">← Voltar para a galeria</a></div></body></html>`, 404);
}
