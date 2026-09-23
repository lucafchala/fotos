import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { hashPassword } from '../src/utils.js';
import { withDurableObjects } from './helpers/do.js';

// Queda de KV FORA do caminho das fotos (issue #118).
//
// Galeria, página do projeto e portão do Drive já sobrevivem a uma queda de
// leitura (cópia na Cache API — ver kv.test.js). O que sobrava respondendo 500
// numa queda total era o formulário de suporte e o painel. Os dois pedem
// desfechos OPOSTOS, e é isso que estes testes travam:
//
//   • suporte: a mensagem sai por e-mail, que não depende do KV. A leitura que
//     derrubava tudo era a da supressão de repetição — conforto, não controle.
//   • painel: falha FECHADO. Nunca sessão ou hash servidos de cópia (seria
//     autenticar contra um estado que pode já ter sido revogado), mas com um
//     503 que diz o que houve, e não a página 500 genérica com um e-mail de
//     "erro no site" disparado a cada tentativa.

const SITE = 'https://fotos.lucafchala.com';
const TOKEN = 'c'.repeat(64);

function fakeKV(initial = {}) {
  const store = new Map(Object.entries(initial));
  return {
    async get(k) { return store.has(k) ? store.get(k) : null; },
    async put(k, v) { store.set(k, v); },
    async delete(k) { store.delete(k); },
    async list({ prefix = '' } = {}) {
      return { keys: [...store.keys()].filter(k => k.startsWith(prefix)).map(name => ({ name })), list_complete: true };
    },
    _store: store,
  };
}

// A queda total: toda operação recusada, como a API do KV faz fora do ar ou
// com a cota diária estourada.
function kvFora() {
  const recusa = async () => { throw new Error('KV GET failed: 503 Service Unavailable'); };
  return { get: recusa, put: recusa, delete: recusa, list: recusa };
}

function fakeCtx() {
  const pendentes = [];
  return { waitUntil: p => pendentes.push(p), settle: () => Promise.allSettled(pendentes) };
}

// Host exato, nunca `includes()` — ver o comentário equivalente em
// removal-request.test.js.
const hostDe = u => { try { return new URL(String(u)).host; } catch { return ''; } };

function fetchStub() {
  return vi.fn(async url => {
    switch (hostDe(url)) {
      case 'challenges.cloudflare.com':
        return new Response(JSON.stringify({ success: true }), { status: 200 });
      case 'api.resend.com':
        return new Response(JSON.stringify({ id: 'msg_1' }), { status: 200 });
      default:
        throw new Error('fetch inesperado: ' + url);
    }
  });
}

const enviosResend = () => globalThis.fetch.mock.calls.filter(([u]) => hostDe(u) === 'api.resend.com');

// Registro NOVO de módulos a cada teste: o `getEvents` guarda a lista num
// cache de isolate, e um teste anterior com KV são faria a queda passar
// despercebida. `index` e `utils` têm de vir do MESMO registro, senão o teste
// lê um mapa de degradações que ninguém escreveu (ver kv.test.js).
async function isolateFrio() {
  vi.resetModules();
  const index = await import('../src/index.js');
  const utils = await import('../src/utils.js');
  utils.resetDegraded();
  return { worker: index.default, index, degradacoes: utils.degradedHealth };
}

const envBase = (extra = {}) => withDurableObjects({
  ADMIN_PASSWORD: 'Senha-Forte-De-Teste-2026!',
  RESEND_API_KEY: 'rs',
  ADMIN_EMAIL: 'dono@exemplo.com',
  TURNSTILE_SECRET_KEY: 'ts',
  ...extra,
});

beforeEach(() => {
  vi.spyOn(console, 'error').mockImplementation(() => {});
  vi.stubGlobal('fetch', fetchStub());
});
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });

describe('painel com o KV fora', () => {
  it('GET /dashboard responde 503 explicando, não a página 500', async () => {
    const { worker, degradacoes } = await isolateFrio();
    const ctx = fakeCtx();
    const res = await worker.fetch(new Request(`${SITE}/dashboard`), envBase({ FOTOS: kvFora() }), ctx);
    await ctx.settle();

    expect(res.status).toBe(503);
    expect(await res.text()).toMatch(/temporariamente indispon[ií]vel/);
    // Cabeçalhos do painel mesmo no erro: noindex e sem cache.
    expect(res.headers.get('Cache-Control')).toMatch(/no-store/);
    // 500 passa pelo catch do roteador, que manda e-mail de alerta. 503 não.
    expect(enviosResend()).toHaveLength(0);
    expect(degradacoes().map(d => d.label)).toContain('KV: leitura recusada');
  });

  it('login responde com o aviso de indisponibilidade, não com "senha incorreta"', async () => {
    const { index, degradacoes } = await isolateFrio();
    const res = await index.handleLogin(loginReq('qualquer'), envBase({ FOTOS: kvFora() }), fakeCtx());

    expect(res.status).toBe(302);
    expect(res.headers.get('Location')).toBe('/dashboard?error=kv');
    expect(res.headers.get('Set-Cookie')).toBeNull();
    expect(degradacoes()[0].detail).toMatch(/login do painel/);
  });

  it('senha CERTA com a gravação da sessão recusada também é "indisponível", não "incorreta"', async () => {
    // Era `error=1`: a tela dizia "Senha incorreta" para quem tinha acertado a
    // senha, no dia em que o problema era a cota do KV.
    const { index } = await isolateFrio();
    const kv = fakeKV({ admin_password: await hashPassword('Senha-Forte-De-Teste-2026!') });
    kv.put = async () => { throw new Error('KV PUT failed: 429 Too Many Requests'); };

    const res = await index.handleLogin(loginReq('Senha-Forte-De-Teste-2026!'), envBase({ FOTOS: kv }), fakeCtx());
    expect(res.headers.get('Location')).toBe('/dashboard?error=kv');
  });

  it('a tela de login mostra o aviso certo para cada código', async () => {
    const { worker } = await isolateFrio();
    const env = envBase({ FOTOS: fakeKV() });

    const kv = await (await worker.fetch(new Request(`${SITE}/dashboard?error=kv`), env, fakeCtx())).text();
    expect(kv).toMatch(/banco de dados do site não respondeu/);
    expect(kv).not.toMatch(/Senha incorreta/);

    const senha = await (await worker.fetch(new Request(`${SITE}/dashboard?error=1`), env, fakeCtx())).text();
    expect(senha).toMatch(/Senha incorreta/);
    expect(senha).not.toMatch(/banco de dados do site não respondeu/);
  });

  it('a semeadura recusada do hash não tranca o dono fora do painel', async () => {
    // KV sem hash gravado e ADMIN_PASSWORD definido: o hash é calculado e
    // semeado. Se a ESCRITA da semente falhar, o login desta requisição ainda
    // vale — a próxima tenta semear de novo.
    const { index, degradacoes } = await isolateFrio();
    const kv = fakeKV();
    const putOriginal = kv.put.bind(kv);
    kv.put = async (k, v, o) => {
      if (k === 'admin_password') throw new Error('KV PUT failed: 429 Too Many Requests');
      return putOriginal(k, v, o);
    };

    const res = await index.handleLogin(loginReq('Senha-Forte-De-Teste-2026!'), envBase({ FOTOS: kv }), fakeCtx());
    expect(res.headers.get('Location')).toBe('/dashboard');
    expect(res.headers.get('Set-Cookie')).toMatch(/^__Host-session=/);
    expect(degradacoes().map(d => d.detail).join(' ')).toMatch(/semeadura/);
  });

  it('API autenticada responde 503 — nem 401 (mandaria para um login que falha), nem 500', async () => {
    const { worker, degradacoes } = await isolateFrio();
    const ctx = fakeCtx();
    const res = await worker.fetch(new Request(`${SITE}/api/metrics`, {
      headers: { Cookie: `__Host-session=${TOKEN}` },
    }), envBase({ FOTOS: kvFora() }), ctx);
    await ctx.settle();

    expect(res.status).toBe(503);
    expect((await res.json()).error).toMatch(/indispon[ií]vel/);
    expect(enviosResend()).toHaveLength(0);
    expect(degradacoes()[0].detail).toMatch(/verificação de sessão/);
  });

  it('com o KV no ar, sessão ausente continua sendo 401', async () => {
    // O 503 é só para a queda: não pode virar a resposta de "não autenticado".
    const { worker } = await isolateFrio();
    const res = await worker.fetch(new Request(`${SITE}/api/metrics`), envBase({ FOTOS: fakeKV() }), fakeCtx());
    expect(res.status).toBe(401);
  });
});

describe('formulário de suporte com o KV fora', () => {
  function pedido() {
    return new Request(`${SITE}/api/suporte`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'CF-Connecting-IP': '7.7.7.7' },
      body: JSON.stringify({
        name: 'Fulana',
        email: 'fulana@exemplo.com',
        message: 'quero as fotos do jogo de sábado',
        consent: '1',
        'cf-turnstile-response': 'token-ok',
      }),
    });
  }

  it('a mensagem sai por e-mail e o visitante vê sucesso — a supressão de repetição não derruba o envio', async () => {
    const { index, degradacoes } = await isolateFrio();
    const res = await index.handleSupportRequest(pedido(), envBase({ FOTOS: kvFora() }), 'nonce', fakeCtx());

    expect(res.status).toBe(200);
    expect(await res.text()).toMatch(/Mensagem enviada/);
    const enviados = enviosResend();
    expect(enviados).toHaveLength(1);
    expect(enviados[0][1].body).toContain('quero as fotos do jogo de s');
    // A queda não pode passar calada: leitura E escrita da supressão acusadas.
    const labels = degradacoes().map(d => d.label);
    expect(labels).toContain('KV: leitura recusada');
    expect(labels).toContain('KV: escrita recusada');
  });

  it('com o KV no ar, a repetição continua sendo suprimida', async () => {
    const { index } = await isolateFrio();
    const env = envBase({ FOTOS: fakeKV() });
    await index.handleSupportRequest(pedido(), env, 'nonce', fakeCtx());
    await index.handleSupportRequest(pedido(), env, 'nonce', fakeCtx());
    expect(enviosResend()).toHaveLength(1);
  });
});

describe('clique no Drive com o KV fora e sem cópia', () => {
  it('não conta, mas também não vira 500', async () => {
    const { index, degradacoes } = await isolateFrio();
    const res = await index.handleTrackDrive(new Request(`${SITE}/api/track-drive`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'CF-Connecting-IP': '8.8.8.8' },
      body: JSON.stringify({ slug: 'casamento-ana' }),
    }), envBase({ FOTOS: kvFora() }), fakeCtx());

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
    expect(degradacoes()[0].detail).toMatch(/clique no Drive/);
  });
});

function loginReq(password) {
  return new Request(`${SITE}/dashboard/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'CF-Connecting-IP': '9.9.9.9' },
    body: `password=${encodeURIComponent(password)}`,
  });
}
