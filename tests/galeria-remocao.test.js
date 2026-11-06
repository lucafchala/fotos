// "Pedir remoção desta foto" na galeria é APROVAÇÃO PELO DONO (v3.1): o pedido
// do visitante NÃO esconde nada. O que estes testes prendem:
//
//  1. O pedido válido vai ao painel (Pedidos) e por e-mail ao dono na hora;
//     "menor" é prioridade (assunto do e-mail). A foto continua na galeria, o
//     evento não é escrito, e a confirmação a quem pediu promete só a análise.
//  2. Sem as defesas (Turnstile, token do formulário, honeypot, foto que NÃO
//     está no álbum, família sem o passe, "Em breve") nada é registrado.
//  3. Só há teto por IP: 30/dia ao painel, até 200/dia só por e-mail (sem KV),
//     depois 429 amigável. Não existem mais os tetos de "ocultar" (5/IP, 20/álbum).
//  4. O painel: "Remover da galeria" esconde e avisa; "Manter na galeria" deixa
//     (ou devolve) a foto e avisa; desfechos antigos e restore de backup antigo
//     (com `ocultasPendentes`) seguem funcionando.
//  5. O "Ocultar" do próprio dono continua imediato.

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import worker, { sanitizeRestoredRequest, mintFormToken } from '../src/index.js';
import { limpaCacheDrive, normalizaPendentes } from '../src/drive.js';
import { saveEvents } from '../src/utils.js';
import { signToken } from '../src/security.js';
import { dashboardHTML } from '../src/ui/dashboard.js';
import {
  GALERIA_REMOCAO_PEDIDOS_POR_IP_DIA, GALERIA_REMOCAO_EMAIL_POR_IP_DIA,
  GALERIA_MAX_OCULTAS, DEFAULT_EVENT,
} from '../src/config.js';
import { withDurableObjects } from './helpers/do.js';
import { pedidosGravados, relogioAdiantavel } from './helpers/pedidos.js';

const SITE = 'https://fotos.lucafchala.com';
const TOKEN = 'e'.repeat(64);
const SEGREDO = 's'.repeat(48);
const RAIZ = 'RAIZ_PASTA_0001';
const FOTO_A = 'FOTO_AAAAAAAA01';
const FOTO_B = 'FOTO_BBBBBBBB02';
const FOTO_C = 'FOTO_CCCCCCCC03';
const FORA = 'FOTO_FORA_00004';

function fakeKV(inicial = {}) {
  const store = new Map(Object.entries(inicial));
  const escritas = [];
  return {
    async get(k) { return store.has(k) ? store.get(k) : null; },
    async put(k, v) { escritas.push(k); store.set(k, v); },
    async delete(k) { store.delete(k); },
    async list() { return { keys: [], list_complete: true, cursor: null }; },
    _store: store,
    _escritas: escritas,
  };
}

const EVENTO = { id: '1', slug: 'formatura', title: 'Formatura 2026', accessType: 'public', driveUrl: `https://drive.google.com/drive/folders/${RAIZ}?usp=sharing` };

function foto(id, nome) {
  return { id, name: nome, mimeType: 'image/jpeg', size: '1000', imageMediaMetadata: { width: 3000, height: 2000 } };
}

let turnstileOk;
let emails;
let env;
let ipSeq;

beforeEach(async () => {
  limpaCacheDrive();
  relogioAdiantavel();
  turnstileOk = true;
  emails = [];
  ipSeq = 0;
  vi.stubGlobal('fetch', vi.fn(async (input, init = {}) => {
    const url = new URL(typeof input === 'string' ? input : input.url);
    if (url.host === 'challenges.cloudflare.com') return Response.json({ success: turnstileOk });
    if (url.host === 'api.resend.com') {
      emails.push(JSON.parse(init.body));
      return Response.json({ id: 'msg_1' });
    }
    if (url.host === 'www.googleapis.com' && url.pathname === '/drive/v3/files') {
      const id = (url.searchParams.get('q') || '').match(/^'([^']+)' in parents/)?.[1];
      if (id !== RAIZ) return Response.json({ error: { code: 404, message: 'nf', errors: [{ reason: 'notFound' }] } }, { status: 404 });
      return Response.json({ files: [foto(FOTO_A, 'a.jpg'), foto(FOTO_B, 'b.jpg'), foto(FOTO_C, 'c.jpg')] });
    }
    if (url.host === 'www.googleapis.com') return new Response('ORIGINAL', { headers: { 'Content-Type': 'image/jpeg', 'Content-Length': '8' } });
    return new Response('nao esperado', { status: 599 });
  }));
  env = withDurableObjects({
    FOTOS: fakeKV({ [`admin_session:${TOKEN}`]: JSON.stringify({ createdAt: Date.now() }) }),
    GOOGLE_DRIVE_API_KEY: 'AIzaChaveDeTeste123',
    TURNSTILE_SECRET_KEY: 'ts-secret',
    RESEND_API_KEY: 'resend-key',
    SIGNING_SECRET: SEGREDO,
    ADMIN_EMAIL: 'dono@example.com',
  });
  await saveEvents(env, [structuredClone(EVENTO)]);
  env.FOTOS._escritas.length = 0;
});
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });

const ctx = { waitUntil() {} };
const evento = () => JSON.parse(env.FOTOS._store.get('events')).find(e => e.slug === 'formatura');
const ocultas = () => evento().fotosOcultas || [];
const pendentes = () => evento().ocultasPendentes || [];
const passeDe = (slug, purpose = 'galeria') => signToken(SEGREDO, { purpose, scope: slug, ttlSecs: 3600 });

async function comEvento(muda) {
  const ev = structuredClone(JSON.parse(env.FOTOS._store.get('events')));
  muda(ev[0]);
  await saveEvents(env, ev);
  env.FOTOS._escritas.length = 0;
}

/** Corpo de um pedido válido; `extra` sobrescreve. */
async function corpo(extra = {}) {
  return {
    slug: 'formatura', foto: FOTO_A, motivo: 'eu', email: 'ana@example.com', mensagem: 'Prefiro não aparecer.',
    turnstileToken: 'tok', company_website: '',
    form_token: await mintFormToken(env, 'galeria-remocao', { preAged: true }),
    ...extra,
  };
}

/** `ip` fixo, ou um novo a cada chamada (`'novo'`). */
async function pede(extra = {}, { ip = '203.0.113.9', cookie = '' } = {}) {
  const c = await corpo(extra);
  for (const [k, v] of Object.entries(c)) if (v === undefined) delete c[k];
  return worker.fetch(new Request(SITE + '/api/galeria/remocao', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'CF-Connecting-IP': ip === 'novo' ? `198.51.100.${++ipSeq}` : ip, ...(cookie ? { Cookie: cookie } : {}) },
    body: JSON.stringify(c),
  }), env, ctx);
}

const visitante = (path, cookie = '') => worker.fetch(new Request(SITE + path, {
  headers: { Accept: 'text/html', ...(cookie ? { Cookie: cookie } : {}) },
}), env, ctx);
const dono = path => worker.fetch(new Request(SITE + path, {
  headers: { Accept: 'text/html', Cookie: `__Host-session=${TOKEN}` },
}), env, ctx);

// ---------------------------------------------------------------------------
describe('pedido válido', () => {
  it('NÃO esconde a foto: nada em fotosOcultas, nenhuma escrita do evento, resposta só { ok: true }', async () => {
    const res = await pede();
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
    expect(ocultas()).toEqual([]);
    expect(pendentes()).toEqual([]);
    expect(env.FOTOS._escritas.filter(k => k === 'events')).toHaveLength(0);
    // A foto continua para o visitante.
    expect(await (await visitante('/galeria/formatura')).text()).toContain(FOTO_A);
  });

  it('registra o pedido em Pedidos com foto, link da galeria, motivo e e-mail; manda os dois e-mails', async () => {
    await pede();
    const pedidos = pedidosGravados(env.FOTOS._store);
    expect(pedidos).toHaveLength(1);
    expect(pedidos[0]).toMatchObject({
      origem: 'galeria', method: 'galeria', eventSlug: 'formatura', fotoId: FOTO_A, fotoNome: 'a.jpg',
      motivo: 'eu', ocultada: false, email: 'ana@example.com', resolved: false,
      value: `${SITE}/galeria/formatura`,
    });
    expect(pedidos[0].prioridade).toBeFalsy();
    // Um e-mail para o dono (na hora) e a confirmação para quem pediu.
    expect(emails.length).toBeGreaterThanOrEqual(2);
    expect(emails.some(e => [].concat(e.to).includes('ana@example.com'))).toBe(true);
    expect(emails.some(e => [].concat(e.to).includes('dono@example.com'))).toBe(true);
  });

  it('a confirmação a quem pediu promete análise, nunca remoção imediata', async () => {
    await pede();
    const conf = emails.find(e => [].concat(e.to).includes('ana@example.com'));
    expect(conf.html).toContain('Recebemos o pedido. O fotógrafo vai analisar e você recebe a resposta por e-mail.');
    for (const e of emails) {
      expect(e.html).not.toMatch(/sai na hora|até 2 minutos|foi ocultada/i);
    }
  });

  it('"Sou responsável por um menor" é prioridade (assunto do e-mail ao dono) e também não esconde', async () => {
    const res = await pede({ motivo: 'menor' });
    expect((await res.json()).ok).toBe(true);
    expect(ocultas()).toEqual([]);
    const [p] = pedidosGravados(env.FOTOS._store);
    expect(p.prioridade).toBe(true);
    expect(p.motivo).toBe('menor');
    const dono = emails.find(e => [].concat(e.to).includes('dono@example.com'));
    expect(dono.subject).toMatch(/prioridade/i);
    // Um pedido comum não leva o assunto de prioridade.
    emails.length = 0;
    await pede({ motivo: 'eu' }, { ip: 'novo' });
    const comum = emails.find(e => [].concat(e.to).includes('dono@example.com'));
    expect(comum.subject).not.toMatch(/prioridade/i);
  });

  it('pedir de uma foto que o dono já escondeu: registra com ocultada=true e não escreve o evento', async () => {
    await comEvento(e => { e.fotosOcultas = [FOTO_A]; });
    const res = await pede();
    expect(res.status).toBe(200);
    expect(ocultas()).toEqual([FOTO_A]);
    expect(env.FOTOS._escritas.filter(k => k === 'events')).toHaveLength(0);
    const [p] = pedidosGravados(env.FOTOS._store);
    expect(p.ocultada).toBe(true);
  });

  it('muitas fotos pedidas pelo mesmo IP: nenhuma é escondida (não há mais teto 5/IP nem 20/álbum)', async () => {
    const ids = Array.from({ length: 12 }, (_, i) => `FOTO_LOTE_${String(i).padStart(5, '0')}`);
    fetch.mockImplementation(async (input, init = {}) => {
      const url = new URL(typeof input === 'string' ? input : input.url);
      if (url.host === 'challenges.cloudflare.com') return Response.json({ success: true });
      if (url.host === 'api.resend.com') { emails.push(JSON.parse(init.body)); return Response.json({ id: 'm' }); }
      return Response.json({ files: ids.map((id, i) => foto(id, `${i}.jpg`)) });
    });
    for (const id of ids) expect((await (await pede({ foto: id })).json()).ok).toBe(true);
    expect(ocultas()).toEqual([]);
    expect(pedidosGravados(env.FOTOS._store)).toHaveLength(ids.length);
    expect(env.FOTOS._escritas.filter(k => k === 'events')).toHaveLength(0);
  });

  it('motivo ou e-mail inválido: 400 e nada registrado', async () => {
    expect((await pede({ motivo: 'qualquer' })).status).toBe(400);
    expect((await pede({ email: 'sem-arroba' })).status).toBe(400);
    expect((await pede({ foto: 'x' })).status).toBe(400);
    expect(ocultas()).toEqual([]);
    expect(pedidosGravados(env.FOTOS._store)).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
describe('defesas: sem elas o pedido nem é registrado', () => {
  it('foto que não está no álbum: 404 e nada registrado', async () => {
    const res = await pede({ foto: FORA });
    expect(res.status).toBe(404);
    expect(pedidosGravados(env.FOTOS._store)).toHaveLength(0);
    expect(emails).toHaveLength(0);
  });

  it('Turnstile recusado: 403 e nada registrado', async () => {
    turnstileOk = false;
    const res = await pede();
    expect(res.status).toBe(403);
    expect(pedidosGravados(env.FOTOS._store)).toHaveLength(0);
    expect(emails).toHaveLength(0);
  });

  it('sem token do formulário, ou com um token de outro formulário: 403', async () => {
    expect((await pede({ form_token: undefined })).status).toBe(403);
    const outro = await mintFormToken(env, 'remocao', { preAged: true });
    expect((await pede({ form_token: outro })).status).toBe(403);
    expect(pedidosGravados(env.FOTOS._store)).toHaveLength(0);
  });

  it('token novo demais (menos de 3 s): 403', async () => {
    const novo = await mintFormToken(env, 'galeria-remocao');
    expect((await pede({ form_token: novo })).status).toBe(403);
    expect(pedidosGravados(env.FOTOS._store)).toHaveLength(0);
  });

  it('honeypot preenchido: responde 200 comum, sem registrar nem mandar e-mail', async () => {
    const res = await pede({ company_website: 'http://spam.example' });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
    expect(pedidosGravados(env.FOTOS._store)).toHaveLength(0);
    expect(emails).toHaveLength(0);
  });

  it('álbum de família: sem o passe 404; com o passe do álbum, registra', async () => {
    await comEvento(e => { e.accessType = 'family'; });
    expect((await pede()).status).toBe(404);
    expect(pedidosGravados(env.FOTOS._store)).toHaveLength(0);
    // Passe de outro álbum não vale.
    expect((await pede({}, { cookie: `galeria=${await passeDe('outro')}` })).status).toBe(404);
    const ok = await pede({}, { cookie: `galeria=${await passeDe('formatura')}` });
    expect(ok.status).toBe(200);
    expect(pedidosGravados(env.FOTOS._store)).toHaveLength(1);
  });

  it('álbum privado sem passe e "Em breve": 404', async () => {
    await comEvento(e => { e.accessType = 'private'; });
    expect((await pede()).status).toBe(404);
    await comEvento(e => { e.accessType = 'public'; e.comingSoon = true; });
    expect((await pede()).status).toBe(404);
    expect(pedidosGravados(env.FOTOS._store)).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
describe('tetos de abuso: só por IP', () => {
  it('o teto antigo de "ocultar" não existe mais na configuração', () => {
    expect(GALERIA_REMOCAO_PEDIDOS_POR_IP_DIA).toBeGreaterThan(0);
    expect(GALERIA_REMOCAO_EMAIL_POR_IP_DIA).toBeGreaterThan(GALERIA_REMOCAO_PEDIDOS_POR_IP_DIA);
  });

  it('pedidos por IP/dia: passado o 1º teto, o pedido segue só por e-mail (200, sem KV); o 2º teto dá 429 com página amigável', async () => {
    for (let i = 0; i < GALERIA_REMOCAO_PEDIDOS_POR_IP_DIA; i++) {
      expect([200, 404]).toContain((await pede({ foto: FOTO_A })).status);
    }
    const antes = pedidosGravados(env.FOTOS._store).length;
    expect(antes).toBeGreaterThan(0);
    const escritasAntes = env.FOTOS._escritas.length;
    const emailsAntes = emails.length;
    // Wi-Fi de evento: o 31º pedido do mesmo IP não é erro.
    const res = await pede({ foto: FOTO_B });
    expect(res.status).toBe(200);
    expect((await res.json()).ok).toBe(true);
    expect(pedidosGravados(env.FOTOS._store)).toHaveLength(antes);
    // O e-mail ao dono saiu (é o único registro desse pedido).
    expect(emails.length).toBeGreaterThan(emailsAntes);
    expect(emails.slice(emailsAntes).some(e => [].concat(e.to).includes('dono@example.com'))).toBe(true);
    expect(env.FOTOS._escritas.length).toBe(escritasAntes);
    // Só um robô chega ao teto de verdade.
    for (let i = 1; i < GALERIA_REMOCAO_EMAIL_POR_IP_DIA; i++) await pede({ foto: FOTO_B });
    const fim = await pede({ foto: FOTO_B });
    expect(fim.status).toBe(429);
    expect((await fim.json()).error).toContain('privacidade@');
    expect(pedidosGravados(env.FOTOS._store)).toHaveLength(antes);
    // Outro IP segue normal.
    expect((await pede({ foto: FOTO_C }, { ip: '198.51.100.99' })).status).toBe(200);
  });
});

// ---------------------------------------------------------------------------
describe('o pedido não muda o que o visitante vê', () => {
  it('HTML, JSON-LD, sitemap de imagens e download seguem com a foto; o dono não vê pendência', async () => {
    await pede();
    const html = await (await visitante('/galeria/formatura')).text();
    expect(html).toContain(FOTO_A);
    expect(html).toContain(FOTO_B);
    const xml = await (await visitante('/sitemap-galeria-formatura.xml')).text();
    expect(xml).toContain(FOTO_A);
    const baixar = await visitante(`/galeria/formatura/baixar/${FOTO_A}?v=max`);
    expect(baixar.status).toBe(200);
    const meu = await (await dono('/galeria/formatura')).text();
    expect(meu).toContain('"ocultas":[]');
    expect(meu).toContain('"pendentes":[]');
  });

  it('a página do visitante leva o link e o formulário com o texto de análise; a do dono não', async () => {
    const v = await (await visitante('/galeria/formatura')).text();
    expect(v).toContain('"remocao":{"token":"');
    expect(v).toContain('id="g-rem"');
    expect(v).toContain('name="company_website"');
    expect(v).toContain('O fotógrafo vai analisar');
    expect(v).not.toMatch(/sai da galeria na hora|em até 2 min(utos)?, enquanto/i);
    const d = await (await dono('/galeria/formatura')).text();
    expect(d).not.toContain('id="g-rem"');
    expect(d).toContain('"remocao":null');
  });
});

// ---------------------------------------------------------------------------
describe('painel: decidir sobre a foto do pedido', () => {
  const resolve = (id, corpoJson) => worker.fetch(new Request(`${SITE}/api/removal-requests/${id}/resolve`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json', Cookie: `__Host-session=${TOKEN}` },
    body: corpoJson === undefined ? undefined : JSON.stringify(corpoJson),
  }), env, ctx);
  const pedidoGravado = id => JSON.parse(env.FOTOS._store.get(`removal_request:${id}`));
  const paraPessoa = () => emails.filter(e => [].concat(e.to).includes('ana@example.com'));

  async function criaPedido(extra = {}) {
    await pede(extra);
    return pedidosGravados(env.FOTOS._store).find(p => p.fotoId === (extra.foto || FOTO_A));
  }

  it('"Remover da galeria": esconde a foto (uma escrita do evento), resolve e avisa quem pediu', async () => {
    const p = await criaPedido();
    emails.length = 0;
    env.FOTOS._escritas.length = 0;
    const res = await resolve(p.id, { desfecho: 'removida' });
    expect(res.status).toBe(200);
    expect(ocultas()).toEqual([FOTO_A]);
    expect(pendentes()).toEqual([]);
    expect(env.FOTOS._escritas.filter(k => k === 'events')).toHaveLength(1);
    expect(pedidoGravado(p.id)).toMatchObject({ resolved: true, desfecho: 'removida' });
    expect(paraPessoa()).toHaveLength(1);
    // Some de tudo o que o visitante alcança.
    const html = await (await visitante('/galeria/formatura')).text();
    expect(html).not.toContain(FOTO_A);
    expect(html).toContain(FOTO_B);
    expect((await visitante(`/galeria/formatura/baixar/${FOTO_A}?v=max`)).status).toBe(404);
    expect(await (await visitante('/sitemap-galeria-formatura.xml')).text()).not.toContain(FOTO_A);
  });

  it('"Manter na galeria": resolve, a foto segue visível e quem pediu recebe o e-mail de "mantida"', async () => {
    const p = await criaPedido();
    emails.length = 0;
    env.FOTOS._escritas.length = 0;
    const res = await resolve(p.id, { desfecho: 'mantida_na_galeria' });
    expect(res.status).toBe(200);
    expect(ocultas()).toEqual([]);
    expect(env.FOTOS._escritas.filter(k => k === 'events')).toHaveLength(0);
    expect(pedidoGravado(p.id)).toMatchObject({ resolved: true, desfecho: 'mantida_na_galeria' });
    expect(paraPessoa()).toHaveLength(1);
    expect(paraPessoa()[0].html).toContain('manter a foto na galeria');
    expect(paraPessoa()[0].html).not.toMatch(/removid|atendid/i);
    expect(await (await visitante('/galeria/formatura')).text()).toContain(FOTO_A);
  });

  it('"Manter na galeria" também devolve uma foto que o dono tinha escondido', async () => {
    await comEvento(e => { e.fotosOcultas = [FOTO_A]; });
    const p = await criaPedido();
    expect(p.ocultada).toBe(true);
    expect((await resolve(p.id, { desfecho: 'mantida_na_galeria' })).status).toBe(200);
    expect(ocultas()).toEqual([]);
  });

  it('desfechos antigos continuam valendo: "mantida" esconde, "devolvida" devolve (sem e-mail de remoção)', async () => {
    const p = await criaPedido();
    expect((await resolve(p.id, { desfecho: 'mantida' })).status).toBe(200);
    expect(ocultas()).toEqual([FOTO_A]);
    const q = await criaPedido({ foto: FOTO_B });
    await comEvento(e => { e.fotosOcultas = [FOTO_B]; });
    emails.length = 0;
    expect((await resolve(q.id, { desfecho: 'devolvida' })).status).toBe(200);
    expect(ocultas()).toEqual([]);
    expect(paraPessoa()).toHaveLength(0);
  });

  it('"Remover" com o projeto no teto de fotos ocultas: 409 em português e o pedido segue aberto', async () => {
    const p = await criaPedido();
    const cheias = Array.from({ length: GALERIA_MAX_OCULTAS }, (_, i) => `FOTO_CHEIA_${String(i).padStart(5, '0')}`);
    await comEvento(e => { e.fotosOcultas = cheias; });
    const res = await resolve(p.id, { desfecho: 'removida' });
    expect(res.status).toBe(409);
    expect((await res.json()).error).toMatch(/teto|ocultas/i);
    expect(ocultas()).toHaveLength(GALERIA_MAX_OCULTAS);
    expect(pedidoGravado(p.id).resolved).toBe(false);
  });

  it('sem corpo, o resolver de sempre: resolve e não mexe na foto', async () => {
    const p = await criaPedido();
    const res = await resolve(p.id);
    expect(res.status).toBe(200);
    expect(ocultas()).toEqual([]);
    expect(pedidoGravado(p.id).resolved).toBe(true);
    expect(pedidoGravado(p.id).desfecho).toBeUndefined();
  });

  it('desfecho desconhecido é ignorado (só resolve)', async () => {
    const p = await criaPedido();
    expect((await resolve(p.id, { desfecho: 'apagar' })).status).toBe(200);
    expect(ocultas()).toEqual([]);
    expect(pedidoGravado(p.id).desfecho).toBeUndefined();
  });

  it('desfecho num pedido que não é da galeria é ignorado', async () => {
    await comEvento(e => { e.fotosOcultas = [FOTO_A]; });
    const id = 'ab12';
    env.FOTOS._store.set(`removal_request:${id}`, JSON.stringify({
      id, eventSlug: 'formatura', method: 'number', value: 'IMG_1', email: 'x@example.com', resolved: false, createdAt: new Date().toISOString(), fotoId: FOTO_A,
    }));
    expect((await resolve(id, { desfecho: 'mantida_na_galeria' })).status).toBe(200);
    expect(ocultas()).toEqual([FOTO_A]);
  });

  it('o botão "Ocultar" do dono na galeria continua imediato', async () => {
    const res = await worker.fetch(new Request(SITE + '/api/galeria/ocultar', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: `__Host-session=${TOKEN}` },
      body: JSON.stringify({ slug: 'formatura', foto: FOTO_A, oculta: true }),
    }), env, ctx);
    expect(res.status).toBe(200);
    expect(ocultas()).toEqual([FOTO_A]);
    expect((await (await visitante('/galeria/formatura')).text())).not.toContain(FOTO_A);
  });

  it('devolver pelo botão do dono na galeria também encerra uma pendência antiga', async () => {
    await comEvento(e => { e.fotosOcultas = [FOTO_A]; e.ocultasPendentes = [{ id: FOTO_A, em: new Date().toISOString(), pedido: 'ab12' }]; });
    const res = await worker.fetch(new Request(SITE + '/api/galeria/ocultar', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: `__Host-session=${TOKEN}` },
      body: JSON.stringify({ slug: 'formatura', foto: FOTO_A, oculta: false }),
    }), env, ctx);
    expect(res.status).toBe(200);
    expect(ocultas()).toEqual([]);
    expect(pendentes()).toEqual([]);
  });

  it('o painel mostra a miniatura, o álbum e as duas ações novas (sem as antigas)', () => {
    const html = dashboardHTML([], [], 'NONCE');
    for (const t of ['Remover da galeria', 'Manter na galeria', 'data-desfecho="removida"', 'data-desfecho="mantida_na_galeria"', 'lh3.googleusercontent.com/d/${esc(r.fotoId)}=w160', 'decidirFoto', 'Pedido pela galeria']) {
      expect(html, t).toContain(t);
    }
    for (const t of ['Manter oculta', 'Devolver à galeria', 'foto NÃO foi ocultada']) {
      expect(html, t).not.toContain(t);
    }
  });
});

// ---------------------------------------------------------------------------
describe('ocultasPendentes (campo antigo): validação e restore de backup antigo', () => {
  it('normalizaPendentes: só IDs válidos e ocultos, datas ISO, sem repetir, com teto', () => {
    const r = normalizaPendentes([
      { id: FOTO_A, em: '2026-10-30T10:00:00.000Z', pedido: 'ab12' },
      { id: FOTO_A, em: '2026-10-30T11:00:00.000Z', pedido: 'cd34' },
      { id: '<script>', em: '2026-10-30T10:00:00.000Z', pedido: 'ab12' },
      { id: FOTO_B, em: 'ontem', pedido: 'ab12' },
      { id: FOTO_C, em: '2026-10-30T10:00:00.000Z', pedido: '../x' },
      'texto', null, 7,
    ], [FOTO_A, FOTO_B, FOTO_C]);
    expect(r.map(p => p.id)).toEqual(expect.arrayContaining([FOTO_A]));
    expect(r.filter(p => p.id === FOTO_A)).toHaveLength(1);
    expect(r.some(p => p.id === '<script>')).toBe(false);
    for (const p of r) {
      expect(Number.isNaN(Date.parse(p.em))).toBe(false);
      expect(p.pedido).toMatch(/^[a-f0-9]*$/);
    }
    expect(normalizaPendentes('x')).toEqual([]);
    expect(normalizaPendentes(undefined)).toEqual([]);
    // Pendência de foto que não está oculta não sobrevive.
    expect(normalizaPendentes([{ id: FOTO_A, em: '2026-10-30T10:00:00.000Z', pedido: 'ab' }], [])).toEqual([]);
    const muitas = Array.from({ length: GALERIA_MAX_OCULTAS + 20 }, (_, i) => ({ id: `FOTO_${String(i).padStart(8, '0')}`, em: '2026-10-30T10:00:00.000Z', pedido: 'ab' }));
    expect(normalizaPendentes(muitas)).toHaveLength(GALERIA_MAX_OCULTAS);
    expect(DEFAULT_EVENT.ocultasPendentes).toEqual([]);
  });

  async function restaura(eventos) {
    return worker.fetch(new Request(SITE + '/api/backup/restore', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: `__Host-session=${TOKEN}` },
      body: JSON.stringify({ version: 3, events: eventos }),
    }), env, ctx);
  }

  it('restore: pendência adulterada é saneada; pendência de foto não oculta é descartada', async () => {
    const res = await restaura([{
      id: '9', slug: 'novo-album', title: 'Novo', accessType: 'public', updatedAt: '2026-10-30T10:00:00.000Z',
      fotosOcultas: [FOTO_A, '<img onerror=1>'],
      ocultasPendentes: [
        { id: FOTO_A, em: '2026-10-30T10:00:00.000Z', pedido: 'ab12' },
        { id: FOTO_B, em: '2026-10-30T10:00:00.000Z', pedido: 'ab12' }, // não está oculta
        { id: '<img onerror=1>', em: '2026-10-30T10:00:00.000Z', pedido: 'ab12' },
        { id: FOTO_A, em: '<script>', pedido: '"><x>' },
      ],
    }]);
    expect(res.status).toBe(200);
    const gravado = JSON.parse(env.FOTOS._store.get('events')).find(e => e.slug === 'novo-album');
    expect(gravado.fotosOcultas).toEqual([FOTO_A]);
    expect(gravado.ocultasPendentes.map(p => p.id)).toEqual([FOTO_A]);
    expect(JSON.stringify(gravado)).not.toMatch(/<script>|<img|"><x>/);
  });

  it('restore: ocultasPendentes sem fotosOcultas no mesmo evento é descartada', async () => {
    await restaura([{
      id: '10', slug: 'outro-album', title: 'Outro', accessType: 'public', updatedAt: '2026-10-30T10:00:00.000Z',
      ocultasPendentes: [{ id: FOTO_A, em: '2026-10-30T10:00:00.000Z', pedido: 'ab' }],
    }]);
    const gravado = JSON.parse(env.FOTOS._store.get('events')).find(e => e.slug === 'outro-album');
    expect(gravado.ocultasPendentes || []).toEqual([]);
  });

  it('restore de pedido: só ID de Drive válido, motivo conhecido e booleanos de verdade', () => {
    const ok = sanitizeRestoredRequest({ id: 'ab12', origem: 'galeria', fotoId: FOTO_A, motivo: 'menor', prioridade: true, ocultada: true, desfecho: 'mantida' });
    expect(ok).toMatchObject({ fotoId: FOTO_A, motivo: 'menor', prioridade: true, ocultada: true, desfecho: 'mantida' });
    const ruim = sanitizeRestoredRequest({ id: 'ab12', fotoId: '"><img src=x>', motivo: 'xyz', prioridade: 'sim', ocultada: 1, desfecho: 'apagar' });
    expect(ruim.fotoId).toBeUndefined();
    expect(ruim.motivo).toBeUndefined();
    expect(ruim.prioridade).toBeUndefined();
    expect(ruim.ocultada).toBeUndefined();
    expect(ruim.desfecho).toBeUndefined();
  });
});
