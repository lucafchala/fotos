import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import worker, { mintDriveNonce } from '../src/index.js';
import {
  ehPrevia, comFaixa, MODOS_TURNSTILE, SIMULACOES, LIMITES_DO_APARELHO, ATRASO_LENTO_MS, ESPERA_LOTADO_S,
  CHAVE_RESEND_RECUSADA, CHAVE_DRIVE_RECUSADA, envSimulado, simulacoes, metricasDeExemplo, relogioDaPrevia,
} from '../src/previa.js';
import { saveEvents, corpoResend, checkRateLimit, degradedHealth, resetDegraded, hojeEmSaoPaulo } from '../src/utils.js';
import { TURNSTILE_SITE_KEY, VERSAO, FORM_LIMIT_PER_HOUR, FORM_TOKEN_TTL_SECS, FORM_TOKEN_MIN_AGE_SECS } from '../src/config.js';
import { signToken } from '../src/security.js';
import { readFileSync } from 'node:fs';
import { withDurableObjects } from './helpers/do.js';
import { pedidosGravados } from './helpers/pedidos.js';

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

/** @type {{ url: string, body: string, chave: string }[]} */
let saidas;
// Para onde uma saída foi: o host exato, não um prefixo da URL — o CodeQL
// aponta (com razão, em código de produção) `startsWith('https://host')`,
// que também aceitaria `https://host.outro-dominio`.
/** @param {{ url: string }} s */
const hostDe = s => new URL(s.url).hostname;
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
    const chave = new Headers((init && init.headers) || {}).get('Authorization') || '';
    saidas.push({ url, body, chave });
    if (url.startsWith('https://challenges.cloudflare.com/')) {
      const segredo = new URLSearchParams(body).get('secret');
      return Response.json(segredo === MODOS_TURNSTILE.passa.segredo || segredo === 'segredo-de-producao'
        ? { success: true } : { success: false, 'error-codes': ['invalid-input-response'] });
    }
    if (url.startsWith('https://api.resend.com/')) {
      // Como o Resend de verdade: chave que ele não conhece leva 401.
      return chave === `Bearer ${CHAVE_RESEND_RECUSADA}`
        ? Response.json({ statusCode: 401, message: 'API key is invalid' }, { status: 401 })
        : Response.json({ id: 'x' });
    }
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
      expect(html, `${modo}: o menu marca o modo`).toMatch(new RegExp(`data-valor="${modo}" href="/__previa/simula\\?sim=turnstile[^"]*" aria-current="true"`));
      // O normal ("passa") não aparece no resumo da faixa; os outros, sim.
      expect(html.includes(`Turnstile: <strong>${m.curto}</strong>`), `${modo}: o resumo da faixa`).toBe(modo !== 'passa');
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
    const segredos = saidas.filter(s => hostDe(s) === 'challenges.cloudflare.com').map(s => new URLSearchParams(s.body).get('secret'));
    expect(segredos).toEqual([MODOS_TURNSTILE.passa.segredo]);
    expect(ok.status).toBe(302);
    expect(ok.headers.getSetCookie().some(c => c.startsWith('__Host-session='))).toBe(true);

    saidas.length = 0;
    const recusado = await entra('previa_ts=recusa');
    expect(saidas.filter(s => hostDe(s) === 'challenges.cloudflare.com').map(s => new URLSearchParams(s.body).get('secret')))
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
    const segredos = saidas.filter(s => hostDe(s) === 'challenges.cloudflare.com').map(s => new URLSearchParams(s.body).get('secret'));
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
    const email = saidas.find(s => hostDe(s) === 'api.resend.com');
    expect(email && JSON.parse(email.body).subject).toMatch(/^\[PRÉVIA\] /);
  });

  it('heartbeat do Kuma desligado na prévia, mesmo com o segredo copiado', async () => {
    const env = await montaEnv({ AMBIENTE: 'previa', KUMA_PUSH_URL: 'https://kuma.exemplo/api/push/TOKEN' });
    await pede(env, '/');
    expect(saidas.some(s => hostDe(s) === 'kuma.exemplo')).toBe(false);
  });
});

// ---------------------------------------------------------------------------
describe('comFaixa', () => {
  it('entra depois de <body> com atributos', () => {
    expect(comFaixa('<html><body class="x" data-a="b"><p>oi</p></body></html>', 'passa', '/'))
      .toMatch(/^<html><body class="x" data-a="b"><div id="previa-faixa"[\s\S]*<\/div><p>oi<\/p>/);
  });

  it('página sem <body> (as de erro curtas) também ganha a faixa — antes do conteúdo, depois do <head> e do DOCTYPE', () => {
    expect(comFaixa('<p>sem corpo</p>', 'passa', '/')).toMatch(/^<div id="previa-faixa"[\s\S]*<\/div><p>sem corpo<\/p>$/);
    expect(comFaixa('<!DOCTYPE html><p>x</p>', 'passa', '/')).toMatch(/^<!DOCTYPE html><div id="previa-faixa"[\s\S]*<p>x<\/p>$/);
    expect(comFaixa('<html lang="pt"><head><title>t</title></head><p>x</p>', 'passa', '/'))
      .toMatch(/^<html lang="pt"><head><title>t<\/title><\/head><div id="previa-faixa"[\s\S]*<p>x<\/p>$/);
    expect(comFaixa('<html><body class="x"', 'passa', '/'), 'tag quebrada: não mexe').toBe('<html><body class="x"');
  });

  it('com o KV fora, o "painel indisponível" sai com a faixa e a saída "Voltar tudo ao normal"', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const env = await montaEnv({ AMBIENTE: 'previa' });
    const res = await pede(env, '/dashboard', { cookie: 'previa_banco=leitura' });
    expect(res.status).toBe(503);
    const html = await res.text();
    expect(html).toMatch(/<body><div id="previa-faixa"/);
    expect(html).toContain('href="/__previa/normal?volta=%2Fdashboard"');
    expect(html, 'documento de verdade, legível no celular').toContain('<meta name="viewport" content="width=device-width, initial-scale=1">');
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
    expect(pedidosGravados(env.FOTOS._store).some(p => p.email === 'real@exemplo.com')).toBe(false);
  });

  it('em produção o restore continua trazendo os pedidos', async () => {
    const env = await montaEnv();
    const corpo = await (await restaura(env, backup)).json();
    expect(corpo.removalRequestsAdded).toBe(1);
    expect(pedidosGravados(env.FOTOS._store).map(p => p.email)).toEqual(['real@exemplo.com']);
  });
});

// ---------------------------------------------------------------------------
// O menu "Testes" da faixa (v2.0): simulações por cookie e ações da prévia.
// ---------------------------------------------------------------------------

/** Entra no painel da prévia e devolve o cookie de sessão. */
async function sessaoDaPrevia(env) {
  const login = await pede(env, '/dashboard/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', Origin: SITE },
    body: new URLSearchParams({ password: SENHA, 'cf-turnstile-response': 't' }).toString(),
  });
  return login.headers.getSetCookie().find(c => c.startsWith('__Host-session=')).split(';')[0];
}

/** POST de uma ação da faixa, como o formulário dela manda. */
function acao(env, qual, { cookie = '', site = 'same-origin', volta = '/dashboard' } = {}) {
  return pede(env, `/__previa/acao?volta=${encodeURIComponent(volta)}`, {
    method: 'POST', cookie,
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'Sec-Fetch-Site': site, Origin: SITE },
    body: new URLSearchParams({ acao: qual }).toString(),
  });
}

/** O valor de um cookie num Set-Cookie da resposta. */
function cookieDe(res, nome) {
  const c = res.headers.getSetCookie().find(x => x.startsWith(nome + '='));
  return c ? c.split(';')[0].slice(nome.length + 1) : undefined;
}

describe('prévia: o menu Testes', () => {
  it('cada simulação tem o seu grupo no menu, com o normal marcado', async () => {
    const env = await montaEnv({ AMBIENTE: 'previa' });
    const html = await (await pede(env, '/')).text();
    for (const [nome, s] of Object.entries(SIMULACOES)) {
      expect(html, nome).toContain(`data-sim="${nome}"`);
      expect(html, `${nome}: o normal marcado`).toMatch(new RegExp(`data-valor="${s.padrao}" href="/__previa/simula\\?sim=${nome}&amp;[^"]*" aria-current="true"`));
    }
    expect(html, 'nada ligado: o resumo é só "Testes"').toContain('<summary><span class="previa-pilula">Testes ▾</span></summary>');
    expect(html).not.toContain('/__previa/normal');
  });

  it('trocar grava o cookie da simulação; voltar ao normal apaga', async () => {
    const env = await montaEnv({ AMBIENTE: 'previa' });
    const liga = await pede(env, '/__previa/simula?sim=email&valor=dono&volta=%2Fformatura');
    expect(liga.status).toBe(303);
    expect(liga.headers.get('Location')).toBe('/formatura');
    expect(liga.headers.get('Set-Cookie')).toMatch(/^previa_email=dono; Path=\/; Max-Age=2592000; SameSite=Lax; Secure; HttpOnly$/);
    const desliga = await pede(env, '/__previa/simula?sim=email&valor=normal&volta=%2F');
    expect(desliga.headers.get('Set-Cookie')).toMatch(/^previa_email=; Path=\/; Max-Age=0;/);
  });

  it('simulação ou opção desconhecida não grava nada, e o "volta" nunca sai da origem', async () => {
    const env = await montaEnv({ AMBIENTE: 'previa' });
    for (const q of ['sim=tudo&valor=normal', 'sim=email&valor=tudo-liberado', 'sim=__proto__&valor=normal', 'sim=email&valor=__proto__']) {
      const res = await pede(env, `/__previa/simula?${q}&volta=%2F%2Fevil.example`);
      expect(res.headers.get('Set-Cookie'), q).toBeNull();
      expect(res.headers.get('Location'), q).toBe('/');
    }
  });

  it('cookie com valor desconhecido vale como o normal', async () => {
    const r = new Request(SITE + '/', { headers: { Cookie: 'previa_email=qualquer; previa_banco=leitura; previa_ts=../../x' } });
    expect(simulacoes(r)).toMatchObject({ email: 'normal', banco: 'leitura', turnstile: 'passa' });
  });

  it('a faixa resume o que está ligado, conta, e oferece voltar tudo ao normal', async () => {
    const env = await montaEnv({ AMBIENTE: 'previa' });
    const html = await (await pede(env, '/', { cookie: 'previa_email=dono; previa_banco=escrita' })).text();
    expect(html).toContain('E-mail: <strong>para o dono</strong>');
    expect(html).toContain('Banco de dados: <strong>KV não grava</strong>');
    expect(html).toMatch(/class="previa-conta" aria-label="2 simulações ligadas">2</);
    expect(html).toContain('href="/__previa/normal?volta=%2F"');
  });

  it('"Voltar tudo ao normal" apaga o cookie de toda simulação', async () => {
    const env = await montaEnv({ AMBIENTE: 'previa' });
    const res = await pede(env, '/__previa/normal?volta=%2Fdashboard');
    expect(res.status).toBe(303);
    expect(res.headers.get('Location')).toBe('/dashboard');
    const apagados = res.headers.getSetCookie().filter(c => /=; Path=\/; Max-Age=0;/.test(c)).map(c => c.split('=')[0]);
    expect(apagados.sort()).toEqual(Object.values(SIMULACOES).map(s => s.cookie).sort());
  });

  it('rota de ferramenta desconhecida: 404 em texto, sem executar como script', async () => {
    const env = await montaEnv({ AMBIENTE: 'previa' });
    for (const caminho of ['/__previa/turnstile-bloqueado.js', '/__previa/qualquer', '/__previa/acao']) {
      const res = await pede(env, caminho);
      expect(res.status, caminho).toBe(404);
      expect(res.headers.get('Content-Type'), caminho).toMatch(/^text\/plain/);
      expect(res.headers.get('X-Content-Type-Options'), caminho).toBe('nosniff');
    }
  });

  it('"Esta prévia" diz a versão e, havendo metadados, a etiqueta e a data', async () => {
    const env = await montaEnv({ AMBIENTE: 'previa', CF_VERSION_METADATA: { id: 'abcdef12-3456', tag: 'a1b2c3d', timestamp: '2026-10-10T17:32:00.000Z' } });
    const html = await (await pede(env, '/')).text();
    expect(html).toContain(`Versão ${VERSAO} · a1b2c3d · publicada 10/10/2026, 14:32`);
    const semEtiqueta = await montaEnv({ AMBIENTE: 'previa', CF_VERSION_METADATA: { id: 'abcdef12-3456', tag: '', timestamp: '' } });
    expect(await (await pede(semEtiqueta, '/')).text()).toContain(`Versão ${VERSAO} · abcdef12<br>`);
  });
});

// ---------------------------------------------------------------------------
describe('prévia: simulações de e-mail', () => {
  async function pedeCodigo(env, cookie) {
    const driveNonce = await mintDriveNonce(env, 'formatura');
    return pede(env, '/api/drive-code', {
      method: 'POST', cookie,
      headers: { 'Content-Type': 'application/json', Origin: SITE },
      body: JSON.stringify({ slug: 'formatura', email: 'pessoa@exemplo.com', driveNonce }),
    });
  }
  const envios = () => saidas.filter(s => hostDe(s) === 'api.resend.com');

  it('"tudo para o dono": o código vai para ADMIN_EMAIL, e o assunto diz para quem iria', async () => {
    const env = await montaEnv({ AMBIENTE: 'previa' });
    expect((await pedeCodigo(env, 'previa_email=dono')).status).toBe(200);
    const [email] = envios();
    const corpo = JSON.parse(email.body);
    expect(corpo.to).toBe('dono@exemplo.com');
    expect(corpo.subject).toMatch(/^\[PRÉVIA → pessoa@exemplo\.com\] /);
  });

  it('"tudo para o dono" sem ADMIN_EMAIL: nada sai — nunca para o endereço digitado', async () => {
    const env = await montaEnv({ AMBIENTE: 'previa', ADMIN_EMAIL: undefined });
    await pedeCodigo(env, 'previa_email=dono');
    expect(envios()).toEqual([]);
  });

  it('"o envio falha": o Resend recebe a chave recusada e o site segue o caminho de e-mail que não saiu', async () => {
    const env = await montaEnv({ AMBIENTE: 'previa' });
    const res = await pedeCodigo(env, 'previa_email=falha');
    expect(res.status).toBeGreaterThanOrEqual(500);
    const [chamada] = envios();
    expect(chamada.chave).toBe(`Bearer ${CHAVE_RESEND_RECUSADA}`);
  });

  it('"sem e-mail configurado": nenhum envio, e o código responde indisponível', async () => {
    const env = await montaEnv({ AMBIENTE: 'previa' });
    const res = await pedeCodigo(env, 'previa_email=desligado');
    expect(res.status).toBe(503);
    expect(envios()).toEqual([]);
  });

  it('corpoResend: e-mail que já ia para o dono não ganha a seta; cópias somem', () => {
    const env = { AMBIENTE: 'previa', PREVIA_EMAIL: 'dono', ADMIN_EMAIL: 'Dono@Exemplo.com' };
    const paraODono = JSON.parse(corpoResend(env, { to: ['dono@exemplo.com'], subject: 'Pedido', cc: ['x@y.z'] }));
    expect(paraODono).toEqual({ to: 'Dono@Exemplo.com', subject: '[PRÉVIA] Pedido' });
    const deFora = JSON.parse(corpoResend(env, { to: ['a@b.c', 'd@e.f'], subject: 'Oi', bcc: 'g@h.i' }));
    expect(deFora).toEqual({ to: 'Dono@Exemplo.com', subject: '[PRÉVIA → a@b.c, d@e.f] Oi' });
    expect(JSON.parse(corpoResend(env, { to: 'a@b.c', subject: '[PRÉVIA] já marcado' })).subject, 'não marca duas vezes').toBe('[PRÉVIA] já marcado');
  });
});

// ---------------------------------------------------------------------------
describe('prévia: banco de dados', () => {
  it('KV: um lado recusa com o erro do KV de verdade; o outro passa', async () => {
    const env = await montaEnv({ AMBIENTE: 'previa' });
    const le = envSimulado(env, { ...simulacoes(new Request(SITE)), banco: 'leitura' }).FOTOS;
    await expect(le.get('events')).rejects.toThrow(/^KV GET failed: 503/);
    await expect(le.list({ prefix: 'x' })).rejects.toThrow(/^KV LIST failed: 503/);
    await le.put('k', 'v');
    expect(env.FOTOS._store.get('k')).toBe('v');
    const grava = envSimulado(env, { ...simulacoes(new Request(SITE)), banco: 'escrita' }).FOTOS;
    await expect(grava.put('k', 'w')).rejects.toThrow(/^KV PUT failed: 503/);
    await expect(grava.delete('k')).rejects.toThrow(/^KV DELETE failed: 503/);
    expect(await grava.get('k')).toBe('v');
  });

  it('KV não grava: o pedido de remoção segue só por e-mail, e a resposta diz isso', async () => {
    resetDegraded();
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const env = await montaEnv({ AMBIENTE: 'previa' });
    // Token pré-envelhecido: o piso de idade é para automação (security.test.js).
    const formToken = await signToken(env.SIGNING_SECRET, {
      purpose: 'form', scope: 'remocao', ttlSecs: FORM_TOKEN_TTL_SECS - FORM_TOKEN_MIN_AGE_SECS,
    });
    const res = await pede(env, '/api/removal-request', {
      method: 'POST', cookie: 'previa_banco=escrita',
      headers: { 'Content-Type': 'application/json', Origin: SITE, 'Sec-Fetch-Site': 'same-origin' },
      body: JSON.stringify({ eventSlug: 'formatura', method: 'number', value: 'Foto 1', email: 'p@exemplo.com', phone: '11999990000', message: '', consent: true, turnstileToken: 't', company_website: '', form_token: formToken }),
    });
    expect(await res.json()).toEqual({ ok: true, stored: false });
    expect(pedidosGravados(env.FOTOS._store)).toEqual([]);
    expect(degradedHealth().map(d => d.label)).toContain('pedido de remoção não gravado no painel');
  });

  it('D1: o registro de consentimento recusa o INSERT', async () => {
    const env = await montaEnv({ AMBIENTE: 'previa', CONSENT_DB: { prepare: () => ({ bind: () => ({ run: async () => ({ success: true }) }) }) } });
    const d1 = envSimulado(env, { ...simulacoes(new Request(SITE)), banco: 'consentimento' }).CONSENT_DB;
    await expect(d1.prepare('INSERT …').bind(1, 2).run()).rejects.toThrow(/^D1_ERROR/);
    await expect(d1.prepare('SELECT 1').first()).rejects.toThrow(/^D1_ERROR/);
  });
});

// ---------------------------------------------------------------------------
describe('prévia: portão lotado', () => {
  const pedeLink = (env, cookie, turnstileToken = 't') => pede(env, '/api/drive-link', {
    method: 'POST', cookie,
    headers: { 'Content-Type': 'application/json', Origin: SITE },
    body: JSON.stringify({ slug: 'formatura', turnstileToken, consent: true }),
  });

  it('o portão responde "muita gente" com o Retry-After — pelo Turnstile e pelo caminho sem script', async () => {
    const env = await montaEnv({ AMBIENTE: 'previa' });
    for (const token of ['t', 'noscript']) {
      const res = await pedeLink(env, 'previa_portao=lotado', token);
      expect(res.status, token).toBe(429);
      expect(res.headers.get('Retry-After'), token).toBe(String(ESPERA_LOTADO_S));
      expect((await res.json()).retryAfter, token).toBe(ESPERA_LOTADO_S);
    }
  });

  it('o código por e-mail — a saída que o portão lotado oferece — não fica lotado', async () => {
    const env = await montaEnv({ AMBIENTE: 'previa' });
    const res = await pedeLink(env, 'previa_portao=lotado', 'email');
    expect(res.status).not.toBe(429);
  });

  it('sem a simulação, o mesmo pedido passa do limite', async () => {
    const env = await montaEnv({ AMBIENTE: 'previa' });
    expect((await pedeLink(env, '')).status).not.toBe(429);
  });
});

// ---------------------------------------------------------------------------
describe('prévia: Drive (galeria) e velocidade', () => {
  it('a chave da Drive API: recusada ou ausente', async () => {
    const env = await montaEnv({ AMBIENTE: 'previa', GOOGLE_DRIVE_API_KEY: 'chave-de-verdade' });
    const base = simulacoes(new Request(SITE));
    expect(envSimulado(env, base).GOOGLE_DRIVE_API_KEY).toBe('chave-de-verdade');
    expect(envSimulado(env, { ...base, drive: 'recusa' }).GOOGLE_DRIVE_API_KEY).toBe(CHAVE_DRIVE_RECUSADA);
    expect(envSimulado(env, { ...base, drive: 'sem' }).GOOGLE_DRIVE_API_KEY).toBeUndefined();
  });

  it('"lenta" atrasa só as APIs, não as páginas', async () => {
    const dorme = vi.spyOn(relogioDaPrevia, 'dorme').mockResolvedValue(undefined);
    const env = await montaEnv({ AMBIENTE: 'previa' });
    await pede(env, '/', { cookie: 'previa_rede=lenta' });
    expect(dorme).not.toHaveBeenCalled();
    await pede(env, '/api/healthz', { cookie: 'previa_rede=lenta' });
    expect(dorme).toHaveBeenCalledWith(ATRASO_LENTO_MS);
    dorme.mockClear();
    await pede(env, '/api/healthz');
    expect(dorme, 'sem a simulação, nada').not.toHaveBeenCalled();
  });

  it('o env simulado é um objeto novo: a requisição seguinte não herda nada', async () => {
    const env = await montaEnv({ AMBIENTE: 'previa' });
    const kvReal = env.FOTOS;
    envSimulado(env, { ...simulacoes(new Request(SITE)), banco: 'leitura', email: 'falha' });
    expect(env.FOTOS).toBe(kvReal);
    expect(env.RESEND_API_KEY).toBe('k');
  });
});

// ---------------------------------------------------------------------------
describe('prévia: ações da faixa', () => {
  it('sem o painel aberto, nenhuma ação roda — nem o corpo é lido — e a faixa diz por quê', async () => {
    const env = await montaEnv({ AMBIENTE: 'previa' });
    const res = await acao(env, 'metricas-exemplo', { volta: '/formatura' });
    expect(res.status).toBe(303);
    expect(res.headers.get('Location')).toBe('/formatura');
    expect(cookieDe(res, 'previa_aviso')).toBe('precisa-entrar');
    expect(env.COUNTER._calls()).toEqual([]);
    const lido = vi.fn();
    const pedido = new Request(SITE + '/__previa/acao?volta=%2F', {
      method: 'POST', headers: { 'Sec-Fetch-Site': 'same-origin', 'CF-Connecting-IP': '203.0.113.7' }, body: 'acao=metricas-apagar',
    });
    pedido.text = lido;
    await worker.fetch(pedido, env, ctx);
    expect(lido).not.toHaveBeenCalled();
  });

  it('corpo grande demais, mesmo com sessão: 413, nada roda', async () => {
    const env = await montaEnv({ AMBIENTE: 'previa' });
    const sessao = await sessaoDaPrevia(env);
    const res = await pede(env, '/__previa/acao?volta=%2F', {
      method: 'POST', cookie: sessao,
      headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'Sec-Fetch-Site': 'same-origin', 'Content-Length': '5000' },
      body: 'acao=metricas-apagar&x=' + 'a'.repeat(4980),
    });
    expect(res.status).toBe(413);
    expect(env.COUNTER._calls()).toEqual([]);
  });

  it('de outro site, recusada antes de tudo', async () => {
    const env = await montaEnv({ AMBIENTE: 'previa' });
    const sessao = await sessaoDaPrevia(env);
    const res = await acao(env, 'metricas-exemplo', { cookie: sessao, site: 'cross-site' });
    expect(res.status).toBe(403);
    expect(env.COUNTER._calls()).toEqual([]);
  });

  it('gerar métricas de exemplo: 90 dias por projeto no contador da prévia, e o aviso aparece aberto na faixa', async () => {
    const env = await montaEnv({ AMBIENTE: 'previa' });
    const sessao = await sessaoDaPrevia(env);
    const res = await acao(env, 'metricas-exemplo', { cookie: sessao });
    expect(res.headers.get('Location')).toBe('/dashboard');
    expect(cookieDe(res, 'previa_aviso')).toBe('metricas-geradas');

    const dados = await (await pede(env, '/api/metrics/diario?dias=90', { cookie: sessao })).json();
    expect(JSON.stringify(dados)).toMatch(/formatura/);
    const { counts } = await env.COUNTER.get('contadores').snapshot(['views:formatura', 'gate:turnstile']);
    expect(counts['views:formatura']).toBeGreaterThan(0);
    expect(counts['gate:turnstile']).toBeGreaterThan(0);

    const pagina = await pede(env, '/dashboard', { cookie: `${sessao}; previa_aviso=metricas-geradas` });
    const html = await pagina.text();
    expect(html).toContain('<details open>');
    expect(html).toMatch(/role="status">✓ Métricas de exemplo geradas/);
    expect(cookieDe(pagina, 'previa_aviso'), 'o aviso aparece uma vez só').toBe('');
  });

  it('gerar SUBSTITUI o que havia — um total de verdade ao lado de 90 dias inventados não faria sentido —, e apagar zera', async () => {
    const env = await montaEnv({ AMBIENTE: 'previa' });
    const sessao = await sessaoDaPrevia(env);
    const contador = env.COUNTER.get('contadores');
    const le = async () => (await contador.snapshot(['views:formatura'])).counts['views:formatura'];
    await contador.increment('views:formatura'); // uma visita de verdade, de um teste anterior
    await acao(env, 'metricas-exemplo', { cookie: sessao });
    const esperado = metricasDeExemplo(EVENTOS, hojeEmSaoPaulo(), 90)['views:formatura'];
    expect(await le(), 'o total é o dos 90 dias, não 1 nem 1 + eles').toBe(esperado);
    await acao(env, 'metricas-exemplo', { cookie: sessao });
    expect(await le(), 'gerar de novo não soma').toBe(esperado);
    const res = await acao(env, 'metricas-apagar', { cookie: sessao });
    expect(cookieDe(res, 'previa_aviso')).toBe('metricas-apagadas');
    expect(await le()).toBeUndefined();
  });

  it('zerar os limites deste aparelho libera o formulário — e o teto diário de e-mails continua', async () => {
    const env = await montaEnv({ AMBIENTE: 'previa' });
    const sessao = await sessaoDaPrevia(env);
    const ip = '203.0.113.7';
    for (let i = 0; i < FORM_LIMIT_PER_HOUR; i++) await checkRateLimit(env, ip, 'removal', FORM_LIMIT_PER_HOUR, 3600);
    expect(await checkRateLimit(env, ip, 'removal', FORM_LIMIT_PER_HOUR, 3600), 'esgotado').toBe(false);
    await checkRateLimit(env, 'conta', 'drive-code-dia', 1, 86400);

    const res = await acao(env, 'zerar-limites', { cookie: sessao });
    expect(cookieDe(res, 'previa_aviso')).toBe('limites-zerados');
    expect(await checkRateLimit(env, ip, 'removal', FORM_LIMIT_PER_HOUR, 3600), 'liberado').toBe(true);
    expect(await checkRateLimit(env, 'conta', 'drive-code-dia', 1, 86400), 'o teto da conta não foi zerado').toBe(false);
  });

  it('a lista do "zerar" acompanha os limites por IP do código', () => {
    // Uma regra escrita duas vezes é corrigida uma vez só: um limite por IP
    // novo em src/index.js tem de entrar em LIMITES_DO_APARELHO.
    const fonte = readFileSync(new URL('../src/index.js', import.meta.url), 'utf8');
    const porIp = new Set([...fonte.matchAll(/(?:checkRateLimit|takeToken)\(env, ip, '([a-z-]+)'/g)].map(m => m[1]));
    expect([...porIp].sort()).toEqual([...LIMITES_DO_APARELHO].sort());
  });

  it('"contar minhas visitas de novo" apaga o cookie de visita de cada projeto', async () => {
    const env = await montaEnv({ AMBIENTE: 'previa' });
    const res = await pede(env, '/__previa/visitas?volta=%2Fformatura');
    expect(res.status).toBe(303);
    expect(res.headers.getSetCookie()).toContain('fv_formatura=; Max-Age=0; Path=/formatura; SameSite=Lax');
    expect(cookieDe(res, 'previa_aviso')).toBe('visitas-esquecidas');
  });

  it('em produção, a rota das ações não existe', async () => {
    const env = await montaEnv();
    const res = await acao(env, 'metricas-apagar');
    expect(res.status).toBe(404);
    expect(env.COUNTER._calls()).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
describe('metricasDeExemplo', () => {
  const eventos = [
    { slug: 'a', date: '2026-10-01', visible: true },
    { slug: 'oculto', date: '2026-06-01', visible: false },
    { slug: 'breve', date: '2026-10-05', comingSoon: true },
    { slug: 'Inválido!', date: '2026-10-05' },
  ];

  it('é determinística, cobre os dias pedidos e deixa de fora "em breve" e slug inválido', () => {
    const m = metricasDeExemplo(eventos, '2026-10-10', 90);
    expect(metricasDeExemplo(eventos, '2026-10-10', 90)).toEqual(m);
    const dias = new Set(Object.keys(m).filter(k => k.startsWith('d:')).map(k => k.slice(2, 12)));
    expect(dias.size).toBe(90);
    expect([...dias].sort()[0]).toBe('2026-07-13');
    expect(Object.keys(m).some(k => k.endsWith(':breve') || k.includes('Inválido'))).toBe(false);
  });

  it('o total é a soma dos dias, e a semana depois da data do projeto tem o pico', () => {
    const m = metricasDeExemplo(eventos, '2026-10-10', 90);
    const somaDias = Object.entries(m).filter(([k]) => /^d:.{10}:views:a$/.test(k)).reduce((t, [, v]) => t + v, 0);
    expect(m['views:a']).toBe(somaDias);
    const dia = d => m[`d:${d}:views:a`] || 0;
    expect(dia('2026-10-01')).toBeGreaterThan(dia('2026-09-10'));
    expect(m['views:oculto'], 'oculto pesa menos').toBeLessThan(m['views:a']);
  });
});
