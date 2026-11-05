// "Pedir remoção desta foto" na galeria: o visitante pede, a foto sai na hora e
// o dono decide no painel. O que estes testes prendem:
//
//  1. O pedido válido ESCONDE a foto (fotosOcultas + ocultasPendentes), registra
//     o pedido em Pedidos e manda os e-mails; "menor" é prioridade.
//  2. Nada esconde sem as defesas: Turnstile, token do formulário, honeypot, foto
//     que NÃO está no álbum, álbum de família sem o passe, "Em breve".
//  3. Os tetos: por IP/dia e por álbum/dia. Passado o teto, o pedido É registrado
//     e avisado, a foto NÃO é escondida e a resposta diz a verdade.
//  4. O painel: "Manter oculta" e "Devolver à galeria" resolvem o pedido e
//     acertam a foto; o restore saneia `ocultasPendentes`.
//  5. A foto escondida some do HTML, do JSON-LD, do sitemap e do download.
//  6. Custo: UMA escrita do evento (mais as do pedido), nunca uma por visitante.

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import worker, { sanitizeRestoredRequest, mintFormToken } from '../src/index.js';
import { limpaCacheDrive, normalizaPendentes } from '../src/drive.js';
import { saveEvents } from '../src/utils.js';
import { signToken } from '../src/security.js';
import { dashboardHTML } from '../src/ui/dashboard.js';
import {
  GALERIA_REMOCAO_OCULTA_POR_IP_DIA, GALERIA_REMOCAO_OCULTA_POR_ALBUM_DIA, GALERIA_REMOCAO_PEDIDOS_POR_IP_DIA,
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
  it('esconde a foto na hora, grava a pendência e responde que foi ocultada', async () => {
    const res = await pede();
    expect(res.status).toBe(200);
    const j = await res.json();
    expect(j.ok).toBe(true);
    expect(j.ocultada).toBe(true);
    expect(ocultas()).toEqual([FOTO_A]);
    expect(pendentes()).toHaveLength(1);
    expect(pendentes()[0].id).toBe(FOTO_A);
    expect(pendentes()[0].pedido).toMatch(/^[a-f0-9]+$/);
    expect(Number.isNaN(Date.parse(pendentes()[0].em))).toBe(false);
  });

  it('registra o pedido em Pedidos com foto, link da galeria, motivo e e-mail; manda os dois e-mails', async () => {
    await pede();
    const pedidos = pedidosGravados(env.FOTOS._store);
    expect(pedidos).toHaveLength(1);
    expect(pedidos[0]).toMatchObject({
      origem: 'galeria', method: 'galeria', eventSlug: 'formatura', fotoId: FOTO_A, fotoNome: 'a.jpg',
      motivo: 'eu', ocultada: true, email: 'ana@example.com', resolved: false,
      value: `${SITE}/galeria/formatura`,
    });
    expect(pedidos[0].prioridade).toBeFalsy();
    expect(pedidos[0].id).toBe(pendentes()[0].pedido);
    // Um e-mail para o dono e a confirmação para quem pediu.
    expect(emails.length).toBeGreaterThanOrEqual(2);
    expect(emails.some(e => [].concat(e.to).includes('ana@example.com'))).toBe(true);
  });

  it('"Sou responsável por um menor" é prioridade, e esconde do mesmo jeito', async () => {
    const res = await pede({ motivo: 'menor' });
    expect((await res.json()).ocultada).toBe(true);
    expect(ocultas()).toEqual([FOTO_A]);
    const [p] = pedidosGravados(env.FOTOS._store);
    expect(p.prioridade).toBe(true);
    expect(p.motivo).toBe('menor');
    expect(emails.some(e => /prioridade|menor/i.test(e.subject))).toBe(true);
  });

  it('pedir de uma foto que já está oculta não duplica nada e não gasta ficha do IP', async () => {
    await comEvento(e => { e.fotosOcultas = [FOTO_A]; });
    const res = await pede();
    expect(res.status).toBe(200);
    expect((await res.json()).ocultada).toBe(true);
    expect(ocultas()).toEqual([FOTO_A]);
    expect(pendentes()).toEqual([]);
    expect(env.FOTOS._escritas.filter(k => k === 'events')).toHaveLength(0);
    expect(pedidosGravados(env.FOTOS._store)).toHaveLength(1);
  });

  it('custo de KV: UMA escrita do evento por foto escondida', async () => {
    await pede();
    expect(env.FOTOS._escritas.filter(k => k === 'events')).toHaveLength(1);
  });

  it('motivo ou e-mail inválido: 400 e nada escondido', async () => {
    expect((await pede({ motivo: 'qualquer' })).status).toBe(400);
    expect((await pede({ email: 'sem-arroba' })).status).toBe(400);
    expect((await pede({ foto: 'x' })).status).toBe(400);
    expect(ocultas()).toEqual([]);
    expect(pedidosGravados(env.FOTOS._store)).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
describe('defesas: nada esconde sem elas', () => {
  it('foto que não está no álbum: 404 e nada oculto nem registrado', async () => {
    const res = await pede({ foto: FORA });
    expect(res.status).toBe(404);
    expect(ocultas()).toEqual([]);
    expect(pendentes()).toEqual([]);
    expect(pedidosGravados(env.FOTOS._store)).toHaveLength(0);
    expect(emails).toHaveLength(0);
  });

  it('Turnstile recusado: 403 e nada escondido', async () => {
    turnstileOk = false;
    const res = await pede();
    expect(res.status).toBe(403);
    expect(ocultas()).toEqual([]);
    expect(pedidosGravados(env.FOTOS._store)).toHaveLength(0);
  });

  it('sem token do formulário, ou com um token de outro formulário: 403 e nada escondido', async () => {
    expect((await pede({ form_token: undefined })).status).toBe(403);
    const outro = await mintFormToken(env, 'remocao', { preAged: true });
    expect((await pede({ form_token: outro })).status).toBe(403);
    expect(ocultas()).toEqual([]);
    expect(pedidosGravados(env.FOTOS._store)).toHaveLength(0);
  });

  it('token novo demais (menos de 3 s): 403 e nada escondido', async () => {
    const novo = await mintFormToken(env, 'galeria-remocao');
    expect((await pede({ form_token: novo })).status).toBe(403);
    expect(ocultas()).toEqual([]);
  });

  it('honeypot preenchido: responde 200 comum, sem esconder nem registrar', async () => {
    const res = await pede({ company_website: 'http://spam.example' });
    expect(res.status).toBe(200);
    expect((await res.json()).ocultada).toBe(false);
    expect(ocultas()).toEqual([]);
    expect(pedidosGravados(env.FOTOS._store)).toHaveLength(0);
    expect(emails).toHaveLength(0);
  });

  it('álbum de família: sem o passe 404 (nada escondido); com o passe do álbum, esconde', async () => {
    await comEvento(e => { e.accessType = 'family'; });
    expect((await pede()).status).toBe(404);
    expect(ocultas()).toEqual([]);
    expect(pedidosGravados(env.FOTOS._store)).toHaveLength(0);
    // Passe de outro álbum não vale.
    expect((await pede({}, { cookie: `galeria=${await passeDe('outro')}` })).status).toBe(404);
    const ok = await pede({}, { cookie: `galeria=${await passeDe('formatura')}` });
    expect(ok.status).toBe(200);
    expect(ocultas()).toEqual([FOTO_A]);
  });

  it('álbum privado sem passe e "Em breve": 404', async () => {
    await comEvento(e => { e.accessType = 'private'; });
    expect((await pede()).status).toBe(404);
    await comEvento(e => { e.accessType = 'public'; e.comingSoon = true; });
    expect((await pede()).status).toBe(404);
    expect(ocultas()).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
describe('tetos de abuso', () => {
  it('por IP: a partir da (N+1)ª foto o pedido é registrado e avisado, mas a foto não é escondida', async () => {
    expect(GALERIA_REMOCAO_OCULTA_POR_IP_DIA).toBeLessThan(GALERIA_REMOCAO_PEDIDOS_POR_IP_DIA);
    const ids = [];
    for (let i = 0; i <= GALERIA_REMOCAO_OCULTA_POR_IP_DIA; i++) ids.push(`FOTO_LOTE_${String(i).padStart(5, '0')}`);
    // Álbum com fotos suficientes para o laço.
    fetch.mockImplementation(async (input, init = {}) => {
      const url = new URL(typeof input === 'string' ? input : input.url);
      if (url.host === 'challenges.cloudflare.com') return Response.json({ success: true });
      if (url.host === 'api.resend.com') { emails.push(JSON.parse(init.body)); return Response.json({ id: 'm' }); }
      return Response.json({ files: ids.map((id, i) => foto(id, `${i}.jpg`)) });
    });
    const respostas = [];
    for (const id of ids) respostas.push(await (await pede({ foto: id })).json());
    expect(respostas.slice(0, GALERIA_REMOCAO_OCULTA_POR_IP_DIA).every(r => r.ocultada)).toBe(true);
    const ultima = respostas[GALERIA_REMOCAO_OCULTA_POR_IP_DIA];
    expect(ultima.ok).toBe(true);
    expect(ultima.ocultada).toBe(false);
    expect(ultima.motivoNaoOculta).toBe('ip');
    expect(ocultas()).toHaveLength(GALERIA_REMOCAO_OCULTA_POR_IP_DIA);
    expect(ocultas()).not.toContain(ids[GALERIA_REMOCAO_OCULTA_POR_IP_DIA]);
    // O pedido da foto não escondida foi registrado.
    const pedidos = pedidosGravados(env.FOTOS._store);
    expect(pedidos).toHaveLength(ids.length);
    expect(pedidos.find(p => p.fotoId === ids[GALERIA_REMOCAO_OCULTA_POR_IP_DIA]).ocultada).toBe(false);
    // Outro IP continua escondendo.
    const outro = await (await pede({ foto: ids[GALERIA_REMOCAO_OCULTA_POR_IP_DIA] }, { ip: '198.51.100.77' })).json();
    expect(outro.ocultada).toBe(true);
  });

  it('por IP: "menor" não fura o teto', async () => {
    const ids = Array.from({ length: GALERIA_REMOCAO_OCULTA_POR_IP_DIA + 1 }, (_, i) => `FOTO_MENOR_${String(i).padStart(4, '0')}`);
    fetch.mockImplementation(async (input, init = {}) => {
      const url = new URL(typeof input === 'string' ? input : input.url);
      if (url.host === 'challenges.cloudflare.com') return Response.json({ success: true });
      if (url.host === 'api.resend.com') { emails.push(JSON.parse(init.body)); return Response.json({ id: 'm' }); }
      return Response.json({ files: ids.map((id, i) => foto(id, `${i}.jpg`)) });
    });
    let ultima;
    for (const id of ids) ultima = await (await pede({ foto: id, motivo: 'menor' })).json();
    expect(ultima.ocultada).toBe(false);
    expect(ocultas()).toHaveLength(GALERIA_REMOCAO_OCULTA_POR_IP_DIA);
  });

  it('por álbum/dia: passado o teto o pedido é registrado e a foto não é escondida', async () => {
    const agora = Date.now();
    const antigas = Array.from({ length: GALERIA_REMOCAO_OCULTA_POR_ALBUM_DIA }, (_, i) => ({
      id: `FOTO_OLD_${String(i).padStart(6, '0')}`, em: new Date(agora - 60_000).toISOString(), pedido: 'a'.repeat(8),
    }));
    await comEvento(e => { e.fotosOcultas = antigas.map(p => p.id); e.ocultasPendentes = antigas; });
    const res = await pede({}, { ip: 'novo' });
    expect(res.status).toBe(200);
    const j = await res.json();
    expect(j.ok).toBe(true);
    expect(j.ocultada).toBe(false);
    expect(j.motivoNaoOculta).toBe('album');
    expect(ocultas()).not.toContain(FOTO_A);
    expect(ocultas()).toHaveLength(GALERIA_REMOCAO_OCULTA_POR_ALBUM_DIA);
    const [p] = pedidosGravados(env.FOTOS._store);
    expect(p).toMatchObject({ fotoId: FOTO_A, ocultada: false, origem: 'galeria' });
    expect(emails.length).toBeGreaterThanOrEqual(2);
    // O teto não gasta ficha do IP nem escreve o evento.
    expect(env.FOTOS._escritas.filter(k => k === 'events')).toHaveLength(0);
  });

  it('por álbum/dia: pendência de mais de 24 h não conta', async () => {
    const velha = new Date(Date.now() - 25 * 3600_000).toISOString();
    const antigas = Array.from({ length: GALERIA_REMOCAO_OCULTA_POR_ALBUM_DIA }, (_, i) => ({
      id: `FOTO_OLD_${String(i).padStart(6, '0')}`, em: velha, pedido: 'b'.repeat(8),
    }));
    await comEvento(e => { e.fotosOcultas = antigas.map(p => p.id); e.ocultasPendentes = antigas; });
    const j = await (await pede({}, { ip: 'novo' })).json();
    expect(j.ocultada).toBe(true);
    expect(ocultas()).toContain(FOTO_A);
  });

  it('por álbum/dia: foto que já está oculta não conta de novo nem é recusada', async () => {
    const agora = Date.now();
    const antigas = Array.from({ length: GALERIA_REMOCAO_OCULTA_POR_ALBUM_DIA }, (_, i) => ({
      id: i === 0 ? FOTO_A : `FOTO_OLD_${String(i).padStart(6, '0')}`, em: new Date(agora).toISOString(), pedido: 'c'.repeat(8),
    }));
    await comEvento(e => { e.fotosOcultas = antigas.map(p => p.id); e.ocultasPendentes = antigas; });
    const j = await (await pede({}, { ip: 'novo' })).json();
    expect(j.ocultada).toBe(true);
    expect(j.motivoNaoOculta).toBeUndefined();
    expect(ocultas()).toHaveLength(GALERIA_REMOCAO_OCULTA_POR_ALBUM_DIA);
    expect(pendentes()).toHaveLength(GALERIA_REMOCAO_OCULTA_POR_ALBUM_DIA);
  });

  it('pedidos por IP/dia: passado o teto, 429 e nada gravado', async () => {
    for (let i = 0; i < GALERIA_REMOCAO_PEDIDOS_POR_IP_DIA; i++) {
      expect([200, 404]).toContain((await pede({ foto: FOTO_A })).status);
    }
    const antes = pedidosGravados(env.FOTOS._store).length;
    const res = await pede({ foto: FOTO_B });
    expect(res.status).toBe(429);
    expect(pedidosGravados(env.FOTOS._store)).toHaveLength(antes);
    expect(ocultas()).not.toContain(FOTO_B);
  });

  it('o teto de fotos ocultas do projeto vale: sem espaço, o pedido segue registrado e a foto não entra', async () => {
    const cheias = Array.from({ length: GALERIA_MAX_OCULTAS }, (_, i) => `FOTO_CHEIA_${String(i).padStart(5, '0')}`);
    await comEvento(e => { e.fotosOcultas = cheias; });
    const j = await (await pede({}, { ip: 'novo' })).json();
    expect(j.ocultada).toBe(false);
    expect(ocultas()).toHaveLength(GALERIA_MAX_OCULTAS);
    expect(pedidosGravados(env.FOTOS._store)).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
describe('a foto escondida some de tudo o que o visitante alcança', () => {
  it('HTML, JSON-LD, sitemap de imagens e download; o dono ainda vê, marcada "oculta a pedido"', async () => {
    const antes = await (await visitante('/galeria/formatura')).text();
    expect(antes).toContain(FOTO_A);
    await pede();
    const html = await (await visitante('/galeria/formatura')).text();
    expect(html).not.toContain(FOTO_A);
    expect(html).toContain(FOTO_B);
    expect(html).toContain('application/ld+json');
    const xml = await (await visitante('/sitemap-galeria-formatura.xml')).text();
    expect(xml).not.toContain(FOTO_A);
    expect(xml).toContain(FOTO_B);
    const baixar = await visitante(`/galeria/formatura/baixar/${FOTO_A}?v=max`);
    expect(baixar.status).toBe(404);
    const meu = await (await dono('/galeria/formatura')).text();
    expect(meu).toContain(`"ocultas":["${FOTO_A}"]`);
    expect(meu).toContain(`"pendentes":["${FOTO_A}"]`);
  });

  it('a página do visitante leva o link e o formulário; a do dono não', async () => {
    const v = await (await visitante('/galeria/formatura')).text();
    expect(v).toContain('"remocao":{"token":"');
    expect(v).toContain('id="g-rem"');
    expect(v).toContain('name="company_website"');
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

  async function criaPedido(extra = {}) {
    await pede(extra);
    return pedidosGravados(env.FOTOS._store).find(p => p.fotoId === (extra.foto || FOTO_A));
  }

  it('"Manter oculta": resolve, tira da pendência e mantém em fotosOcultas; manda o e-mail de atendido', async () => {
    const p = await criaPedido();
    emails.length = 0;
    const res = await resolve(p.id, { desfecho: 'mantida' });
    expect(res.status).toBe(200);
    expect(ocultas()).toEqual([FOTO_A]);
    expect(pendentes()).toEqual([]);
    expect(pedidoGravado(p.id)).toMatchObject({ resolved: true, desfecho: 'mantida' });
    expect(emails.some(e => [].concat(e.to).includes('ana@example.com'))).toBe(true);
  });

  it('"Devolver à galeria": tira de fotosOcultas e da pendência, e a foto volta ao visitante', async () => {
    const p = await criaPedido();
    emails.length = 0;
    const res = await resolve(p.id, { desfecho: 'devolvida' });
    expect(res.status).toBe(200);
    expect(ocultas()).toEqual([]);
    expect(pendentes()).toEqual([]);
    expect(pedidoGravado(p.id)).toMatchObject({ resolved: true, desfecho: 'devolvida' });
    // Não diz "foto removida" a quem a foto foi devolvida.
    expect(emails.some(e => [].concat(e.to).includes('ana@example.com'))).toBe(false);
    expect(await (await visitante('/galeria/formatura')).text()).toContain(FOTO_A);
  });

  it('pedido que o teto não escondeu: "mantida" esconde agora', async () => {
    const p = await criaPedido();
    await comEvento(e => { e.fotosOcultas = []; e.ocultasPendentes = []; });
    // Simula o pedido sem esconder (limite): marca como não ocultada.
    env.FOTOS._store.set(`removal_request:${p.id}`, JSON.stringify({ ...p, ocultada: false }));
    expect((await resolve(p.id, { desfecho: 'mantida' })).status).toBe(200);
    expect(ocultas()).toEqual([FOTO_A]);
    expect(pendentes()).toEqual([]);
  });

  it('sem corpo, o resolver de sempre: resolve e não mexe na foto', async () => {
    const p = await criaPedido();
    const res = await resolve(p.id);
    expect(res.status).toBe(200);
    expect(ocultas()).toEqual([FOTO_A]);
    expect(pendentes()).toHaveLength(1);
    expect(pedidoGravado(p.id).resolved).toBe(true);
    expect(pedidoGravado(p.id).desfecho).toBeUndefined();
  });

  it('desfecho num pedido que não é da galeria é ignorado', async () => {
    await comEvento(e => { e.fotosOcultas = [FOTO_A]; });
    const id = 'ab12';
    env.FOTOS._store.set(`removal_request:${id}`, JSON.stringify({
      id, eventSlug: 'formatura', method: 'number', value: 'IMG_1', email: 'x@example.com', resolved: false, createdAt: new Date().toISOString(), fotoId: FOTO_A,
    }));
    expect((await resolve(id, { desfecho: 'devolvida' })).status).toBe(200);
    expect(ocultas()).toEqual([FOTO_A]);
  });

  it('devolver pelo botão do dono na galeria também encerra a pendência', async () => {
    await pede();
    const res = await worker.fetch(new Request(SITE + '/api/galeria/ocultar', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: `__Host-session=${TOKEN}` },
      body: JSON.stringify({ slug: 'formatura', foto: FOTO_A, oculta: false }),
    }), env, ctx);
    expect(res.status).toBe(200);
    expect(ocultas()).toEqual([]);
    expect(pendentes()).toEqual([]);
  });

  it('o painel mostra a miniatura, o álbum e as duas ações', () => {
    const html = dashboardHTML([], [], 'NONCE');
    for (const t of ['Manter oculta', 'Devolver à galeria', 'lh3.googleusercontent.com/d/${esc(r.fotoId)}=w160', 'decidirFoto', 'Pedido pela galeria']) {
      expect(html, t).toContain(t);
    }
  });
});

// ---------------------------------------------------------------------------
describe('ocultasPendentes: validação e restore', () => {
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
