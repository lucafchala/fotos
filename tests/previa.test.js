import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import worker, { mintDriveNonce } from '../src/index.js';
import { ehPrevia, comFaixa, MODOS_TURNSTILE } from '../src/previa.js';
import { saveEvents, corpoResend } from '../src/utils.js';
import { TURNSTILE_SITE_KEY } from '../src/config.js';
import { withDurableObjects } from './helpers/do.js';

// Prévia de PR (Worker Previews, v2.0). A camada de src/previa.js só existe
// quando AMBIENTE = "previa" — variável que só o bloco [previews] do
// wrangler.toml declara. O que mais importa aqui é a primeira seção: em
// PRODUÇÃO nada muda, nem um cabeçalho. O resto prende o que a prévia
// promete: a faixa, o noindex, o Turnstile de teste escolhido na página (com o
// segredo de teste chegando de verdade ao siteverify), o redirecionamento que
// não sai da origem, e o "[PRÉVIA]" no assunto do e-mail.

const SITE = 'https://previa-fotos.exemplo.workers.dev';
const SENHA = 'Senha-Da-Previa-2026!';

function fakeKV(initial = {}) {
  const store = new Map(Object.entries(initial));
  return {
    async get(k) { return store.has(k) ? store.get(k) : null; },
    async put(k, v) { store.set(k, v); },
    async delete(k) { store.delete(k); },
    async list({ prefix = '' } = {}) {
      return { keys: [...store.keys()].filter(k => k.startsWith(prefix)).map(name => ({ name })), list_complete: true, cursor: null };
    },
    _store: store,
  };
}

const EVENTOS = [{
  id: '1', slug: 'formatura', title: 'Formatura', visible: true, accessType: 'public',
  driveUrl: 'https://drive.google.com/drive/folders/PASTA_0000000001', photos: [], date: '2026-10-01',
}];

/** @type {{ url: string, body: string }[]} */
let saidas;
/** @param {Record<string, unknown>} extra */
async function montaEnv(extra = {}) {
  const env = withDurableObjects({
    FOTOS: fakeKV(),
    ADMIN_PASSWORD: SENHA,
    SIGNING_SECRET: 'assinatura-de-teste-longa-o-suficiente',
    RESEND_API_KEY: 'k',
    ADMIN_EMAIL: 'dono@exemplo.com',
    TURNSTILE_SECRET_KEY: 'segredo-de-producao',
    ...extra,
  });
  await saveEvents(env, structuredClone(EVENTOS));
  return env;
}
const ctx = { waitUntil() {}, passThroughOnException() {} };

beforeEach(() => {
  saidas = [];
  vi.stubGlobal('fetch', vi.fn(async (entrada, init) => {
    const url = String(entrada instanceof Request ? entrada.url : entrada);
    const body = init && init.body ? String(init.body) : '';
    saidas.push({ url, body });
    if (url.startsWith('https://challenges.cloudflare.com/')) {
      const segredo = new URLSearchParams(body).get('secret');
      return Response.json(segredo === MODOS_TURNSTILE.passa.segredo || segredo === 'segredo-de-producao'
        ? { success: true } : { success: false, 'error-codes': ['invalid-input-response'] });
    }
    if (url.startsWith('https://api.resend.com/')) return Response.json({ id: 'x' });
    return new Response('fora do teste', { status: 599 });
  }));
});
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });

/** @param {string} path @param {RequestInit & { cookie?: string }} [o] */
function pede(env, path, o = {}) {
  const headers = new Headers(o.headers || {});
  if (o.cookie) headers.set('Cookie', o.cookie);
  headers.set('CF-Connecting-IP', '203.0.113.7');
  return worker.fetch(new Request(SITE + path, { ...o, headers, redirect: 'manual' }), env, ctx);
}

// ---------------------------------------------------------------------------
describe('produção: a camada da prévia não existe', () => {
  it('ehPrevia só com AMBIENTE exatamente "previa"', () => {
    expect(ehPrevia({})).toBe(false);
    expect(ehPrevia(null)).toBe(false);
    expect(ehPrevia({ AMBIENTE: 'producao' })).toBe(false);
    expect(ehPrevia({ AMBIENTE: 'PREVIA' })).toBe(false);
    expect(ehPrevia({ AMBIENTE: 'previa' })).toBe(true);
  });

  it('sem faixa, sem noindex na página pública, com a chave de produção do Turnstile', async () => {
    const env = await montaEnv();
    const inicio = await pede(env, '/');
    expect(inicio.headers.get('X-Robots-Tag'), 'a galeria pública é indexável').toBeNull();
    expect(await inicio.text()).not.toContain('previa-faixa');
    const login = await (await pede(env, '/dashboard')).text();
    expect(login).not.toContain('previa-faixa');
    expect(login).toContain(TURNSTILE_SITE_KEY);
  });

  it('a rota do controle não existe em produção', async () => {
    const env = await montaEnv();
    const res = await pede(env, '/__previa/turnstile?modo=recusa&volta=%2F');
    expect(res.status).toBe(404);
    expect(res.headers.get('Set-Cookie') || '').not.toContain('previa_ts');
  });

  it('o corpo do e-mail sai igual ao JSON.stringify de antes', () => {
    const dados = { from: 'a', to: ['b'], subject: 'Oi', html: '<p>x</p>' };
    expect(corpoResend({}, dados)).toBe(JSON.stringify(dados));
  });
});

// ---------------------------------------------------------------------------
describe('prévia: faixa, noindex e robots', () => {
  it('toda página HTML ganha a faixa logo depois do <body>, e noindex', async () => {
    const env = await montaEnv({ AMBIENTE: 'previa' });
    for (const caminho of ['/', '/dashboard', '/formatura', '/nao-existe']) {
      const res = await pede(env, caminho);
      const html = await res.text();
      expect(res.headers.get('X-Robots-Tag'), caminho).toBe('noindex, nofollow');
      expect(html, caminho).toMatch(/<body[^>]*><div id="previa-faixa"/);
      expect((html.match(/id="previa-faixa"/g) || []).length, `${caminho}: uma faixa só`).toBe(1);
    }
  });

  it('resposta que não é HTML só ganha o noindex, corpo intacto', async () => {
    const env = await montaEnv({ AMBIENTE: 'previa' });
    const res = await pede(env, '/api/healthz');
    expect(res.headers.get('X-Robots-Tag')).toBe('noindex, nofollow');
    const corpo = await res.json();
    expect(corpo).toHaveProperty('ok');
  });

  it('robots.txt da prévia fecha tudo', async () => {
    const env = await montaEnv({ AMBIENTE: 'previa' });
    const txt = await (await pede(env, '/robots.txt')).text();
    expect(txt).toContain('Disallow: /');
  });

  it('HEAD também passa pela camada', async () => {
    const env = await montaEnv({ AMBIENTE: 'previa' });
    const res = await pede(env, '/', { method: 'HEAD' });
    expect(res.status).toBe(200);
    expect(res.headers.get('X-Robots-Tag')).toBe('noindex, nofollow');
  });
});

// ---------------------------------------------------------------------------
describe('prévia: o controle do Turnstile', () => {
  it('troca o modo por cookie e volta para a página', async () => {
    const env = await montaEnv({ AMBIENTE: 'previa' });
    const res = await pede(env, '/__previa/turnstile?modo=recusa&volta=%2Fformatura%3Fx%3D1');
    expect(res.status).toBe(303);
    expect(res.headers.get('Location')).toBe('/formatura?x=1');
    expect(res.headers.get('Set-Cookie')).toMatch(/^previa_ts=recusa; Path=\/; .*HttpOnly/);
  });

  it('o "volta" nunca sai da origem', async () => {
    const env = await montaEnv({ AMBIENTE: 'previa' });
    for (const ruim of ['//evil.example', '/\\evil.example', 'https://evil.example/', 'evil', '/a\nb', '/a b']) {
      const res = await pede(env, `/__previa/turnstile?modo=passa&volta=${encodeURIComponent(ruim)}`);
      expect(res.headers.get('Location'), JSON.stringify(ruim)).toBe('/');
    }
  });

  it('modo desconhecido não grava cookie', async () => {
    const env = await montaEnv({ AMBIENTE: 'previa' });
    const res = await pede(env, '/__previa/turnstile?modo=tudo-liberado&volta=%2F');
    expect(res.headers.get('Set-Cookie')).toBeNull();
  });

  it('cada modo põe a chave de teste dele na página; "sem script" nem carrega o Turnstile', async () => {
    const env = await montaEnv({ AMBIENTE: 'previa' });
    for (const [modo, m] of Object.entries(MODOS_TURNSTILE)) {
      const html = await (await pede(env, '/dashboard', { cookie: `previa_ts=${modo}` })).text();
      expect(html, modo).toContain(m.sitekey);
      expect(html, `${modo}: a chave de produção some`).not.toContain(TURNSTILE_SITE_KEY);
      expect(html, `${modo}: a faixa diz o modo`).toContain(`Turnstile: <strong>${m.curto}</strong>`);
      const carregaScript = html.includes('https://challenges.cloudflare.com/turnstile/v0/api.js');
      expect(carregaScript, modo).toBe(modo !== 'sem-script');
    }
  });

  it('o login da prévia verifica com o SEGREDO de teste do modo — e o cookie de sessão atravessa a camada', async () => {
    const env = await montaEnv({ AMBIENTE: 'previa' });
    const entra = cookie => pede(env, '/dashboard/login', {
      method: 'POST', cookie,
      headers: { 'Content-Type': 'application/x-www-form-urlencoded', Origin: SITE },
      body: new URLSearchParams({ password: SENHA, 'cf-turnstile-response': 'XXXX.DUMMY.TOKEN.XXXX' }).toString(),
    });

    const ok = await entra('previa_ts=passa');
    const segredos = saidas.filter(s => s.url.startsWith('https://challenges')).map(s => new URLSearchParams(s.body).get('secret'));
    expect(segredos).toEqual([MODOS_TURNSTILE.passa.segredo]);
    expect(ok.status).toBe(302);
    expect(ok.headers.getSetCookie().some(c => c.startsWith('__Host-session='))).toBe(true);

    saidas.length = 0;
    const recusado = await entra('previa_ts=recusa');
    expect(saidas.filter(s => s.url.startsWith('https://challenges')).map(s => new URLSearchParams(s.body).get('secret')))
      .toEqual([MODOS_TURNSTILE.recusa.segredo]);
    expect(recusado.headers.get('Location')).toBe('/dashboard?error=ts');
  });

  it('em produção o login segue com o segredo de produção', async () => {
    const env = await montaEnv();
    await pede(env, '/dashboard/login', {
      method: 'POST', cookie: 'previa_ts=recusa',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded', Origin: SITE },
      body: new URLSearchParams({ password: SENHA, 'cf-turnstile-response': 't' }).toString(),
    });
    const segredos = saidas.filter(s => s.url.startsWith('https://challenges')).map(s => new URLSearchParams(s.body).get('secret'));
    expect(segredos).toEqual(['segredo-de-producao']);
  });
});

// ---------------------------------------------------------------------------
describe('prévia: e-mail e telemetria', () => {
  it('assunto com [PRÉVIA], uma vez só', () => {
    const env = { AMBIENTE: 'previa' };
    expect(JSON.parse(corpoResend(env, { subject: 'Oi' })).subject).toBe('[PRÉVIA] Oi');
    expect(JSON.parse(corpoResend(env, { subject: '[PRÉVIA] Oi' })).subject).toBe('[PRÉVIA] Oi');
  });

  it('o código por e-mail da prévia chega com [PRÉVIA] no assunto', async () => {
    const env = await montaEnv({ AMBIENTE: 'previa' });
    const driveNonce = await mintDriveNonce(env, 'formatura');
    const res = await pede(env, '/api/drive-code', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Origin: SITE },
      body: JSON.stringify({ slug: 'formatura', email: 'pessoa@exemplo.com', driveNonce }),
    });
    expect(res.status).toBe(200);
    const email = saidas.find(s => s.url.startsWith('https://api.resend.com/'));
    expect(email && JSON.parse(email.body).subject).toMatch(/^\[PRÉVIA\] /);
  });

  it('heartbeat do Kuma desligado na prévia, mesmo com o segredo copiado', async () => {
    const env = await montaEnv({ AMBIENTE: 'previa', KUMA_PUSH_URL: 'https://kuma.exemplo/api/push/TOKEN' });
    await pede(env, '/');
    expect(saidas.some(s => s.url.startsWith('https://kuma.exemplo'))).toBe(false);
  });
});

// ---------------------------------------------------------------------------
describe('comFaixa', () => {
  it('entra depois de <body> com atributos; sem <body>, não mexe', () => {
    expect(comFaixa('<html><body class="x" data-a="b"><p>oi</p></body></html>', 'passa', '/'))
      .toMatch(/^<html><body class="x" data-a="b"><div id="previa-faixa"[\s\S]*<\/div><p>oi<\/p>/);
    expect(comFaixa('<p>sem corpo</p>', 'passa', '/')).toBe('<p>sem corpo</p>');
  });

  it('o caminho de volta vai codificado — nada de aspa fechando o atributo', () => {
    const html = comFaixa('<body>', 'passa', '/x?a="><script>alert(1)</script>');
    expect(html).not.toContain('<script>');
    expect(html).toContain('volta=%2Fx%3Fa%3D%22%3E%3Cscript%3E');
  });
});

// ---------------------------------------------------------------------------
describe('prévia: restaurar backup sem dados pessoais de terceiros', () => {
  async function restaura(env, backup) {
    const login = await pede(env, '/dashboard/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded', Origin: SITE },
      body: new URLSearchParams({ password: SENHA, 'cf-turnstile-response': 't' }).toString(),
    });
    const sessao = login.headers.getSetCookie().find(c => c.startsWith('__Host-session=')).split(';')[0];
    return pede(env, '/api/backup/restore', {
      method: 'POST', cookie: sessao,
      headers: { 'Content-Type': 'application/json', Origin: SITE },
      body: JSON.stringify(backup),
    });
  }
  const pedido = { id: 'c'.repeat(32), eventSlug: 'formatura', eventTitle: 'Formatura', method: 'number', value: 'Foto 3', email: 'real@exemplo.com', createdAt: new Date().toISOString(), resolved: false };
  const backup = { events: [{ ...EVENTOS[0], id: '9', slug: 'outro', title: 'Outro' }], categories: ['Formatura'], removalRequests: [pedido] };

  it('na prévia, eventos e categorias entram; os pedidos de remoção, não — e a resposta diz quantos ficaram de fora', async () => {
    const env = await montaEnv({ AMBIENTE: 'previa' });
    const res = await restaura(env, backup);
    expect(res.status).toBe(200);
    const corpo = await res.json();
    expect(corpo.added).toBe(1);
    expect(corpo.removalRequestsSkipped).toBe(1);
    expect(corpo.removalRequestsAdded).toBeUndefined();
    expect(env.FOTOS._store.get('removal_requests') || '').not.toContain('real@exemplo.com');
  });

  it('em produção o restore continua trazendo os pedidos', async () => {
    const env = await montaEnv();
    const corpo = await (await restaura(env, backup)).json();
    expect(corpo.removalRequestsAdded).toBe(1);
    expect(env.FOTOS._store.get('removal_requests')).toContain('real@exemplo.com');
  });
});
