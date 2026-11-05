// Aviso por e-mail ao AUTOR da foto (v3.1, item 1c). O que estes testes prendem:
//
//  1. Pedido de remoção, decisão do dono e ocultar/devolver pelo dono avisam o
//     autor — só quando a foto vem de pasta de autor COM e-mail nos créditos.
//  2. O conteúdo é mínimo: nada de e-mail nem mensagem de quem pediu.
//  3. No máximo um aviso por foto por tipo (retry e clique repetido não duplicam).
//  4. O teto do dia pula o aviso (e registra); falha do Resend não derruba a ação.
//  5. O e-mail do autor não aparece em NENHUMA resposta pública nem em log.

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import worker, { mintFormToken } from '../src/index.js';
import { limpaCacheDrive } from '../src/drive.js';
import { avisaAutor } from '../src/avisoautor.js';
import { saveEvents, degradedHealth, resetDegraded } from '../src/utils.js';
import { AUTOR_AVISO_DIA } from '../src/config.js';
import { withDurableObjects } from './helpers/do.js';
import { pedidosGravados, relogioAdiantavel } from './helpers/pedidos.js';

const SITE = 'https://fotos.lucafchala.com';
const TOKEN = 'e'.repeat(64);
const SEGREDO = 's'.repeat(48);
const RAIZ = 'RAIZ_PASTA_0001';
const MAG = 'PASTA_MAG_00001';
const ZED = 'PASTA_ZED_00001';
const F_LUCA = 'FOTO_LUCA_00001';
const F_MAG = 'FOTO_MAG_000001';
const F_MAG2 = 'FOTO_MAG_000002';
const F_ZED = 'FOTO_ZED_000001';
const EMAIL_AUTOR = 'mag.autora@example.com';

const arq = (id, nome) => ({ id, name: nome, mimeType: 'image/jpeg', size: '1000', imageMediaMetadata: { width: 3000, height: 2000 } });
const pasta = (id, nome) => ({ id, name: nome, mimeType: 'application/vnd.google-apps.folder' });
const ARVORE = {
  [RAIZ]: [arq(F_LUCA, 'luca.jpg'), pasta(MAG, 'mag'), pasta(ZED, 'zed')],
  [MAG]: [arq(F_MAG, 'm1.jpg'), arq(F_MAG2, 'm2.jpg')],
  [ZED]: [arq(F_ZED, 'z1.jpg')],
};

function fakeKV(inicial = {}) {
  const store = new Map(Object.entries(inicial));
  return {
    async get(k) { return store.has(k) ? store.get(k) : null; },
    async put(k, v) { store.set(k, v); },
    async delete(k) { store.delete(k); },
    async list() { return { keys: [], list_complete: true, cursor: null }; },
    _store: store,
  };
}

const EVENTO = {
  id: '1', slug: 'formatura', title: 'Formatura 2026', accessType: 'public',
  driveUrl: `https://drive.google.com/drive/folders/${RAIZ}`,
  galeriaCreditos: `mag = Mag <${EMAIL_AUTOR}>\nzed = Zed\nchala = Luca F. Chala`,
};

let emails;
let falhaAutor;
let env;
let pend;
let ctx;
let ipSeq;

beforeEach(async () => {
  limpaCacheDrive();
  resetDegraded();
  relogioAdiantavel();
  emails = [];
  falhaAutor = false;
  pend = [];
  ctx = { waitUntil: p => { pend.push(p); } };
  ipSeq = 0;
  vi.stubGlobal('fetch', vi.fn(async (input, init = {}) => {
    const url = new URL(typeof input === 'string' ? input : input.url);
    if (url.host === 'challenges.cloudflare.com') return Response.json({ success: true });
    if (url.host === 'api.resend.com') {
      const corpo = JSON.parse(init.body);
      emails.push(corpo);
      if (falhaAutor && corpo.to.includes(EMAIL_AUTOR)) {
        return new Response(`{"message":"Invalid to ${EMAIL_AUTOR}"}`, { status: 422 });
      }
      return Response.json({ id: 'msg_1' });
    }
    if (url.host === 'www.googleapis.com' && url.pathname === '/drive/v3/files') {
      const id = (url.searchParams.get('q') || '').match(/^'([^']+)' in parents/)?.[1];
      return Response.json({ files: ARVORE[id] || [] });
    }
    return new Response('nao esperado', { status: 599 });
  }));
  env = withDurableObjects({
    FOTOS: fakeKV({ [`admin_session:${TOKEN}`]: JSON.stringify({ createdAt: Date.now() }) }),
    GOOGLE_DRIVE_API_KEY: 'AIzaChaveDeTeste123',
    TURNSTILE_SECRET_KEY: 'ts-secret',
    RESEND_API_KEY: 'resend-key',
    ADMIN_EMAIL: 'dono@example.com',
    SIGNING_SECRET: SEGREDO,
  });
  await saveEvents(env, [structuredClone(EVENTO)]);
});
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });

const fundo = async () => { await Promise.all(pend.splice(0)); };
const paraAutor = () => emails.filter(e => e.to.includes(EMAIL_AUTOR));
const evento = () => JSON.parse(env.FOTOS._store.get('events')).find(e => e.slug === 'formatura');

async function pede(extra = {}) {
  const c = {
    slug: 'formatura', foto: F_MAG, motivo: 'eu', email: 'ana.solicitante@example.com',
    mensagem: 'Prefiro nao aparecer, por favor.', turnstileToken: 'tok', company_website: '',
    form_token: await mintFormToken(env, 'galeria-remocao', { preAged: true }),
    ...extra,
  };
  const res = await worker.fetch(new Request(SITE + '/api/galeria/remocao', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'CF-Connecting-IP': `198.51.100.${++ipSeq}` },
    body: JSON.stringify(c),
  }), env, ctx);
  await fundo();
  return res;
}
const resolve = async (id, corpo) => {
  const res = await worker.fetch(new Request(`${SITE}/api/removal-requests/${id}/resolve`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json', Cookie: `__Host-session=${TOKEN}` },
    body: JSON.stringify(corpo),
  }), env, ctx);
  await fundo();
  return res;
};
const ocultar = async (foto, oculta) => {
  const res = await worker.fetch(new Request(SITE + '/api/galeria/ocultar', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Cookie: `__Host-session=${TOKEN}` },
    body: JSON.stringify({ slug: 'formatura', foto, oculta }),
  }), env, ctx);
  await fundo();
  return res;
};

describe('(a) pedido de remoção chegou', () => {
  it('avisa a autora com o conteúdo mínimo — sem nada de quem pediu', async () => {
    const res = await pede();
    expect(res.status).toBe(200);
    expect(paraAutor()).toHaveLength(1);
    const m = paraAutor()[0];
    expect(m.subject).toContain('Pedido de remoção de uma foto sua');
    expect(m.subject).toContain('Formatura 2026');
    expect(m.to).toEqual([EMAIL_AUTOR]);
    expect(m.html).toContain('Formatura 2026');
    expect(m.html).toContain('ocultada da galeria agora');
    expect(m.html).toContain('a pessoa que pediu aparece na foto');
    expect(m.html).toContain(`lh3.googleusercontent.com/d/${F_MAG}=w320`);
    expect(m.html).toContain(`drive.google.com/file/d/${F_MAG}/view`);
    expect(m.html).toContain('privacidade@lucafchala.com');
    expect(m.html).toContain('O Luca cuida da resposta');
    // Nada do solicitante
    expect(m.html).not.toContain('ana.solicitante');
    expect(m.html).not.toContain('Prefiro nao aparecer');
    expect(JSON.stringify(m)).not.toContain('ana.solicitante');
    // O e-mail do autor só no destinatário (nem em cc/bcc)
    expect(m.cc).toBeUndefined();
    expect(m.bcc).toBeUndefined();
  });

  it('motivo "menor" aparece como categoria; "outro" também', async () => {
    await pede({ motivo: 'menor' });
    expect(paraAutor()[0].html).toContain('responsável por um menor');
  });

  it('foto do autor padrão (sem e-mail): nenhum aviso a autor', async () => {
    await pede({ foto: F_LUCA });
    expect(paraAutor()).toHaveLength(0);
    // só os dois de sempre: ao dono e a quem pediu
    expect(emails.map(e => e.to[0]).sort()).toEqual(['ana.solicitante@example.com', 'dono@example.com']);
  });

  it('autor sem e-mail nos créditos: nenhum aviso', async () => {
    await pede({ foto: F_ZED });
    expect(emails.map(e => e.to[0]).sort()).toEqual(['ana.solicitante@example.com', 'dono@example.com']);
  });

  it('a resposta ao visitante e o pedido gravado não levam o e-mail do autor', async () => {
    const res = await pede();
    expect(await res.clone().text()).not.toContain(EMAIL_AUTOR);
    expect(JSON.stringify(pedidosGravados(env.FOTOS._store))).not.toContain(EMAIL_AUTOR);
  });

  it('pedido repetido da mesma foto: um aviso só', async () => {
    await pede();
    await pede({ email: 'outra@example.com' });
    expect(paraAutor()).toHaveLength(1);
  });

  it('sem o teto de ocultar (já passou do limite): diz que o Luca vai analisar', async () => {
    const ev = evento();
    const r = await avisaAutor(env, ev, { fotoId: F_MAG2, tipo: 'pedido', motivo: 'outro', ocultada: false });
    expect(r).toBe('enviado');
    const m = paraAutor().at(-1);
    expect(m.html).toContain('Ela ainda está na galeria');
    expect(m.html).toContain('outro motivo');
  });
});

describe('(b) o dono decidiu', () => {
  it('"Manter oculta" avisa a autora uma vez, mesmo resolvendo de novo', async () => {
    await pede();
    const p = pedidosGravados(env.FOTOS._store)[0];
    emails.length = 0;
    expect((await resolve(p.id, { desfecho: 'mantida' })).status).toBe(200);
    expect(paraAutor()).toHaveLength(1);
    expect(paraAutor()[0].html).toContain('continua oculta');
    expect(paraAutor()[0].html).not.toContain('ana.solicitante');
    await resolve(p.id, { desfecho: 'mantida' });
    expect(paraAutor()).toHaveLength(1);
  });

  it('"Devolver à galeria" avisa que voltou', async () => {
    await pede();
    const p = pedidosGravados(env.FOTOS._store)[0];
    emails.length = 0;
    await resolve(p.id, { desfecho: 'devolvida' });
    expect(paraAutor()).toHaveLength(1);
    expect(paraAutor()[0].html).toContain('voltou à galeria');
  });

  it('resolver sem desfecho (painel antigo) não avisa autor', async () => {
    await pede();
    const p = pedidosGravados(env.FOTOS._store)[0];
    emails.length = 0;
    await resolve(p.id, {});
    expect(paraAutor()).toHaveLength(0);
  });
});

describe('(c) o dono ocultou ou devolveu pelo botão', () => {
  it('oculta e devolve: um aviso de cada; repetir o mesmo estado não manda nada', async () => {
    expect((await ocultar(F_MAG, true)).status).toBe(200);
    expect(paraAutor()).toHaveLength(1);
    expect(paraAutor()[0].html).toContain('ocultou uma foto sua');
    await ocultar(F_MAG, true); // já estava oculta
    expect(paraAutor()).toHaveLength(1);
    await ocultar(F_MAG, false);
    expect(paraAutor()).toHaveLength(2);
    expect(paraAutor()[1].html).toContain('devolveu uma foto sua');
    await ocultar(F_MAG, true); // oculta de novo no mesmo dia: o tipo já foi avisado
    expect(paraAutor()).toHaveLength(2);
  });

  it('foto do autor padrão ou de autor sem e-mail: nenhum aviso', async () => {
    await ocultar(F_LUCA, true);
    await ocultar(F_ZED, true);
    expect(emails).toHaveLength(0);
  });

  it('visitante não consegue disparar (rota é do dono)', async () => {
    const res = await worker.fetch(new Request(SITE + '/api/galeria/ocultar', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ slug: 'formatura', foto: F_MAG, oculta: true }),
    }), env, ctx);
    await fundo();
    expect(res.status).toBe(401);
    expect(emails).toHaveLength(0);
  });
});

describe('teto, falhas e privacidade', () => {
  it('passado o teto do dia, o aviso é pulado e registrado', async () => {
    const secao = (n, ids) => ({ nome: n, caminho: n, fotos: ids.map(id => [id, 3000, 2000, id + '.jpg', 1000, 0, 0].slice(0, 5).concat([1])) });
    const ids = Array.from({ length: AUTOR_AVISO_DIA + 3 }, (_, i) => `FOTO_T_${String(i).padStart(7, '0')}`);
    const listagem = { v: 2, aut: ['Luca F. Chala', 'Mag'], secoes: [secao('Mag', ids)], total: ids.length };
    const resultados = [];
    for (const id of ids) resultados.push(await avisaAutor(env, evento(), { fotoId: id, tipo: 'oculta', listagem }));
    expect(resultados.filter(r => r === 'enviado')).toHaveLength(AUTOR_AVISO_DIA);
    expect(resultados.filter(r => r === 'teto')).toHaveLength(3);
    expect(paraAutor()).toHaveLength(AUTOR_AVISO_DIA);
    expect(JSON.stringify(degradedHealth())).toContain('aviso ao autor pulado');
    expect(JSON.stringify(degradedHealth())).not.toContain(EMAIL_AUTOR);
  });

  it('o aviso é o último a entrar na conta: os códigos de e-mail seguem com o próprio teto', async () => {
    // o teto do aviso não é o do código (EMAIL_CODE_DAILY_CAP): sozinho já deixa folga
    expect(AUTOR_AVISO_DIA).toBeLessThan(40);
  });

  it('Resend recusando o aviso não derruba o pedido nem vaza o endereço no log', async () => {
    falhaAutor = true;
    const res = await pede();
    expect(res.status).toBe(200);
    expect((await res.json()).ocultada).toBe(true);
    const saude = JSON.stringify(degradedHealth());
    expect(saude).toContain('aviso ao autor não saiu');
    expect(saude).not.toContain(EMAIL_AUTOR);
    expect(saude).not.toContain('mag.autora');
    // a ação principal ficou: foto oculta, pedido gravado
    expect(evento().fotosOcultas).toContain(F_MAG);
    expect(pedidosGravados(env.FOTOS._store)).toHaveLength(1);
  });

  it('sem RESEND_API_KEY, nada acontece (e nada quebra)', async () => {
    delete env.RESEND_API_KEY;
    expect(await avisaAutor(env, evento(), { fotoId: F_MAG, tipo: 'oculta' })).toBe('sem-chave');
  });

  it('foto que não está na listagem: sem aviso', async () => {
    expect(await avisaAutor(env, evento(), { fotoId: 'FOTO_INEXISTENTE', tipo: 'oculta' })).toBe('sem-autor');
  });

  it('o e-mail do autor não aparece em nenhuma resposta pública', async () => {
    await pede();
    await ocultar(F_MAG2, true);
    const caminhos = ['/', '/formatura', '/galeria/formatura', '/galeria/formatura/sitemap.xml', '/sitemap.xml', '/robots.txt', '/healthz'];
    for (const c of caminhos) {
      const r = await worker.fetch(new Request(SITE + c, { headers: { Accept: 'text/html' } }), env, ctx);
      const t = await r.text();
      expect(t, c).not.toContain(EMAIL_AUTOR);
      expect(t, c).not.toContain('mag.autora');
    }
    const dl = await worker.fetch(new Request(`${SITE}/galeria/formatura/baixar/${F_MAG}?v=max`), env, ctx);
    expect([...dl.headers].join('\n')).not.toContain('mag.autora');
  });
});
