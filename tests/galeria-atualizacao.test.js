// Atualização da lista do Drive (v3.1, item 1e): período da atualização
// automática, foto durável no D1 e "Atualizar agora".
//
//  1. política: valores inválidos caem no padrão (10 min, automática);
//  2. automática: relê quando passa o período escolhido, não antes (relógio
//     congelado só em Date; a Cache API também respeita a idade da lista);
//  3. desligada: a lista só muda no "Atualizar agora" do dono, e sobrevive ao
//     isolate novo (memória limpa) porque vem do D1;
//  4. o D1 só é gravado quando o conteúdo muda (e sempre no "Atualizar agora");
//  5. sem D1 nada quebra; apagar o projeto apaga a foto durável.

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import worker, { normalizeEventFields } from '../src/index.js';
import { limpaCacheDrive, periodoValido, politicaDaGaleria, descreveRenovacao } from '../src/drive.js';
import { hashDaListagem } from '../src/snapshot.js';
import { saveEvents } from '../src/utils.js';
import { withDurableObjects } from './helpers/do.js';
import { fakeCaches } from './helpers/caches.js';
import { d1Sqlite } from './helpers/d1.js';

const SITE = 'https://fotos.lucafchala.com';
const TOKEN = 'e'.repeat(64);
const RAIZ = 'RAIZ_PASTA_0001';
const CAP_A = 'CAPA_PASTA_0001';
const CAP_B = 'CAPB_PASTA_0001';

const arq = (id, nome) => ({ id, name: nome, mimeType: 'image/jpeg', size: '1000', imageMediaMetadata: { width: 3000, height: 2000 } });
const pasta = (id, nome) => ({ id, name: nome, mimeType: 'application/vnd.google-apps.folder' });

let arvore;
let chamadas;
let env;
let d1;
let escritas; // INSERTs no D1

const EVENTO = {
  id: '1', slug: 'festa', title: 'Festa', accessType: 'public',
  driveUrl: `https://drive.google.com/drive/folders/${RAIZ}`,
};

function fakeKV(inicial = {}) {
  const store = new Map(Object.entries(inicial));
  return {
    async get(k) { return store.has(k) ? store.get(k) : null; },
    async put(k, v) { store.set(k, v); },
    async delete(k) { store.delete(k); },
    async list() { return { keys: [], list_complete: true, cursor: null }; },
  };
}

function montaEnv({ comD1 = true } = {}) {
  d1 = d1Sqlite();
  escritas = 0;
  const original = d1.prepare.bind(d1);
  d1.prepare = sql => { if (/^\s*INSERT INTO galeria_snapshot/i.test(sql)) escritas++; return original(sql); };
  return withDurableObjects({
    FOTOS: fakeKV({ [`admin_session:${TOKEN}`]: JSON.stringify({ createdAt: Date.now() }) }),
    GOOGLE_DRIVE_API_KEY: 'AIzaChaveDeTeste123',
    SIGNING_SECRET: 's'.repeat(48),
    ...(comD1 ? { CONSENT_DB: d1 } : {}),
  });
}

beforeEach(async () => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date('2026-11-05T12:00:00Z'));
  limpaCacheDrive();
  chamadas = [];
  arvore = {
    [RAIZ]: [arq('FOTO_1_0000001', 'um.jpg'), arq('FOTO_2_0000001', 'dois.jpg')],
  };
  vi.stubGlobal('fetch', vi.fn(async input => {
    const url = new URL(typeof input === 'string' ? input : input.url);
    if (url.pathname === '/drive/v3/files') {
      chamadas.push(url);
      const id = (url.searchParams.get('q') || '').match(/^'([^']+)' in parents/)?.[1];
      const soPastas = (url.searchParams.get('q') || '').includes("mimeType = 'application/vnd.google-apps.folder'");
      return Response.json({ files: (arvore[id] || []).filter(f => !soPastas || f.mimeType.endsWith('.folder')) });
    }
    return new Response('nao esperado', { status: 599 });
  }));
  env = montaEnv();
  await saveEvents(env, [{ ...EVENTO }]);
});
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });

const avanca = ms => vi.setSystemTime(new Date(Date.now() + ms));
const MIN = 60_000;
const get = async (path, { dono = false } = {}) => {
  const headers = { 'CF-Connecting-IP': '203.0.113.9' };
  if (dono) headers.Cookie = `__Host-session=${TOKEN}`;
  return worker.fetch(new Request(SITE + path, { headers }), env, { waitUntil() {} });
};
const nFotos = async (path, o) => {
  const h = await (await get(path, o)).text();
  return [...h.matchAll(/FOTO_[A-Z0-9]_\d+/g)].map(m => m[0]).filter((v, i, a) => a.indexOf(v) === i).length;
};
const linhas = () => d1.sqlite.prepare('SELECT chave, slug, ctx, hash, em FROM galeria_snapshot').all();

describe('política', () => {
  it('períodos válidos passam; o resto cai em 10 minutos', () => {
    for (const p of [600, 3600, 21600, 86400]) expect(periodoValido(p)).toBe(p);
    for (const p of [0, -1, 59, 601, '3600', 'x', null, undefined, NaN, 1e12]) {
      expect(periodoValido(p)).toBe(p === '3600' ? 3600 : 600);
    }
    expect(politicaDaGaleria({})).toEqual({ auto: true, periodo: 600 });
    expect(politicaDaGaleria({ galeriaAtualizacaoAuto: false, galeriaPeriodo: 3600 })).toEqual({ auto: false, periodo: 3600 });
    expect(politicaDaGaleria({ galeriaAtualizacaoAuto: 'não' })).toEqual({ auto: true, periodo: 600 });
  });

  it('normalizeEventFields: padrão ligado/10 min, valor ruim vira padrão, só false desliga', () => {
    const base = { ...EVENTO };
    const n = (body) => normalizeEventFields(body, base, []);
    expect(n({}).galeriaAtualizacaoAuto).toBe(true); // campo ausente: herda do evento (padrão ligado)
    expect(n({ galeriaAtualizacaoAuto: false, galeriaPeriodo: 21600 })).toMatchObject({ galeriaAtualizacaoAuto: false, galeriaPeriodo: 21600 });
    expect(n({ galeriaAtualizacaoAuto: 'false', galeriaPeriodo: 7 })).toMatchObject({ galeriaAtualizacaoAuto: true, galeriaPeriodo: 600 });
    expect(n({ galeriaAtualizacaoAuto: 0 }).galeriaAtualizacaoAuto).toBe(true);
  });

  it('descreveRenovacao fala a língua do dono', () => {
    expect(descreveRenovacao({})).toContain('a cada 10 minutos');
    expect(descreveRenovacao({ galeriaPeriodo: 3600 })).toContain('a cada 1 hora');
    expect(descreveRenovacao({ galeriaPeriodo: 21600 })).toContain('a cada 6 horas');
    expect(descreveRenovacao({ galeriaPeriodo: 86400 })).toContain('a cada 24 horas');
    expect(descreveRenovacao({ galeriaAtualizacaoAuto: false })).toContain('Atualizar agora');
  });
});

describe('atualização automática', () => {
  it('padrão: relê depois de 10 minutos, não antes', async () => {
    expect(await nFotos('/galeria/festa')).toBe(2);
    expect(chamadas.length).toBe(1);
    arvore[RAIZ].push(arq('FOTO_3_0000001', 'tres.jpg'));
    avanca(9 * MIN);
    expect(await nFotos('/galeria/festa')).toBe(2);
    expect(chamadas.length).toBe(1);
    avanca(2 * MIN);
    expect(await nFotos('/galeria/festa')).toBe(3);
    expect(chamadas.length).toBe(2);
  });

  it('período de 1 hora: aos 30 minutos ainda não, aos 61 sim', async () => {
    await saveEvents(env, [{ ...EVENTO, galeriaPeriodo: 3600 }]);
    await nFotos('/galeria/festa');
    arvore[RAIZ].push(arq('FOTO_3_0000001', 'tres.jpg'));
    avanca(30 * MIN);
    expect(await nFotos('/galeria/festa')).toBe(2);
    avanca(31 * MIN);
    expect(await nFotos('/galeria/festa')).toBe(3);
  });

  it('a Cache API também respeita o período: lista mais velha que ele é relida', async () => {
    vi.stubGlobal('caches', fakeCaches());
    await saveEvents(env, [{ ...EVENTO, galeriaPeriodo: 86400 }]);
    await nFotos('/galeria/festa');
    expect(chamadas.length).toBe(1);
    limpaCacheDrive(); // isolate novo: só a Cache API lembra
    avanca(2 * 3600_000);
    expect(await nFotos('/galeria/festa')).toBe(2);
    expect(chamadas.length).toBe(1); // 2 h < 24 h: serviu do cache
    // o dono encurta o período para 10 minutos: a lista de 2 h deixa de valer
    await saveEvents(env, [{ ...EVENTO, galeriaPeriodo: 600 }]);
    limpaCacheDrive();
    await nFotos('/galeria/festa');
    expect(chamadas.length).toBe(2);
  });

  it('só grava no D1 quando o conteúdo muda', async () => {
    await nFotos('/galeria/festa');
    expect(escritas).toBe(1);
    expect(linhas()).toHaveLength(1);
    avanca(11 * MIN); // relê, mesma lista
    await nFotos('/galeria/festa');
    expect(chamadas.length).toBe(2);
    expect(escritas).toBe(1);
    arvore[RAIZ].push(arq('FOTO_3_0000001', 'tres.jpg'));
    avanca(11 * MIN);
    await nFotos('/galeria/festa');
    expect(escritas).toBe(2);
    expect(linhas()[0]).toMatchObject({ chave: RAIZ, slug: 'festa' });
  });
});

describe('atualização automática desligada', () => {
  beforeEach(async () => { await saveEvents(env, [{ ...EVENTO, galeriaAtualizacaoAuto: false }]); });

  it('a lista não muda sozinha, nem com o tempo, nem num isolate novo', async () => {
    expect(await nFotos('/galeria/festa')).toBe(2);
    expect(linhas()).toHaveLength(1); // sem foto ainda: leu uma vez e guardou
    arvore[RAIZ].push(arq('FOTO_3_0000001', 'tres.jpg'));
    avanca(30 * 24 * 3600_000);
    limpaCacheDrive();
    expect(await nFotos('/galeria/festa')).toBe(2);
    expect(chamadas.length).toBe(1);
  });

  it('"Atualizar agora" do dono relê e grava, mesmo sem mudança; o visitante não consegue', async () => {
    await nFotos('/galeria/festa');
    const antes = linhas()[0].em;
    avanca(5 * 3600_000);
    limpaCacheDrive();
    await get('/galeria/festa?atualizar=1'); // visitante
    expect(chamadas.length).toBe(1);
    arvore[RAIZ].push(arq('FOTO_3_0000001', 'tres.jpg'));
    const r = await get('/galeria/festa?atualizar=1', { dono: true });
    expect([200, 302, 303]).toContain(r.status);
    expect(chamadas.length).toBe(2);
    expect(linhas()[0].em).not.toBe(antes);
    expect(await nFotos('/galeria/festa')).toBe(3);
    // mesma lista de novo, mas o dono pediu: o "em" anda
    const meio = linhas()[0].em;
    avanca(MIN);
    limpaCacheDrive();
    await get('/galeria/festa?atualizar=1', { dono: true });
    expect(linhas()[0].em).not.toBe(meio);
  });

  it('o dono vê "Atualizada em" e a explicação; o visitante não vê a faixa', async () => {
    const dono = await (await get('/galeria/festa', { dono: true })).text();
    expect(dono).toContain('Atualizada em ');
    expect(dono).toContain('Atualizar agora');
    expect(dono).toContain('atualização automática desligada');
    const visita = await (await get('/galeria/festa')).text();
    expect(visita).not.toContain('Atualizada em');
  });

  it('mudar os créditos descarta a foto antiga (outra listagem)', async () => {
    await nFotos('/galeria/festa');
    arvore[RAIZ].push(arq('FOTO_3_0000001', 'tres.jpg'));
    await saveEvents(env, [{ ...EVENTO, galeriaAtualizacaoAuto: false, galeriaCreditos: 'turma = Turma' }]);
    limpaCacheDrive();
    expect(await nFotos('/galeria/festa')).toBe(3);
    expect(chamadas.length).toBe(2);
  });

  it('religar a automática volta a renovar pelo período', async () => {
    await nFotos('/galeria/festa');
    arvore[RAIZ].push(arq('FOTO_3_0000001', 'tres.jpg'));
    await saveEvents(env, [{ ...EVENTO, galeriaAtualizacaoAuto: true }]);
    limpaCacheDrive();
    expect(await nFotos('/galeria/festa')).toBe(3);
  });

  it('foto durável corrompida: relê o Drive em vez de falhar', async () => {
    await nFotos('/galeria/festa');
    d1.sqlite.prepare('UPDATE galeria_snapshot SET dados = ?').run('{não é json');
    limpaCacheDrive();
    expect(await nFotos('/galeria/festa')).toBe(2);
    expect(chamadas.length).toBe(2);
  });
});

describe('capítulos', () => {
  beforeEach(async () => {
    arvore = {
      [RAIZ]: [pasta(CAP_A, '01 - Abertura'), pasta(CAP_B, '02 - Festa')],
      [CAP_A]: [arq('FOTO_1_0000001', 'a.jpg')],
      [CAP_B]: [arq('FOTO_2_0000001', 'b.jpg')],
    };
  });

  it('desligada: capítulos novos e fotos novas só aparecem no Atualizar agora', async () => {
    await saveEvents(env, [{ ...EVENTO, galeriaCapitulos: true, galeriaAtualizacaoAuto: false }]);
    const indice = async o => [...(await (await get('/galeria/festa', o)).text()).matchAll(/class="ix-nome">([^<]*)</g)].map(m => m[1]);
    expect(await indice()).toEqual(['Abertura', 'Festa']);
    await nFotos('/galeria/festa/abertura');
    expect(linhas().map(l => l.chave).sort()).toEqual([CAP_A, `c:${RAIZ}`].sort());
    arvore[RAIZ].push(pasta('CAPC_PASTA_0001', '03 - Nova'));
    arvore[CAP_A].push(arq('FOTO_9_0000001', 'nova.jpg'));
    avanca(48 * 3600_000);
    await env.FOTOS.put(`admin_session:${TOKEN}`, JSON.stringify({ createdAt: Date.now() })); // a sessão de 48 h atrás já expirou
    limpaCacheDrive();
    expect(await indice()).toEqual(['Abertura', 'Festa']);
    expect(await nFotos('/galeria/festa/abertura')).toBe(1);
    expect(await indice({ dono: true })).toEqual(['Abertura', 'Festa']); // sem ?atualizar, nem o dono
    await get('/galeria/festa?atualizar=1', { dono: true });
    expect(await indice({ dono: true })).toEqual(['Abertura', 'Festa', 'Nova']);
    expect(await indice()).toEqual(['Abertura', 'Festa', 'Nova']);
  });
});

describe('sem D1 e limpeza', () => {
  it('sem CONSENT_DB: a página funciona (desligada, só perde a foto durável)', async () => {
    env = montaEnv({ comD1: false });
    await saveEvents(env, [{ ...EVENTO, galeriaAtualizacaoAuto: false }]);
    expect(await nFotos('/galeria/festa')).toBe(2);
    expect(escritas).toBe(0);
  });

  it('D1 falhando não derruba a página', async () => {
    env.CONSENT_DB = { prepare() { throw new Error('d1 fora do ar'); } };
    vi.spyOn(console, 'error').mockImplementation(() => {});
    expect(await nFotos('/galeria/festa')).toBe(2);
  });

  it('apagar o projeto apaga as linhas dele (só dele)', async () => {
    await nFotos('/galeria/festa');
    d1.sqlite.prepare("INSERT INTO galeria_snapshot (chave, slug, ctx, hash, em, dados) VALUES ('OUTRA_PASTA_0001','outro','m28#x','h','2026-01-01T00:00:00Z','{}')").run();
    const r = await worker.fetch(new Request(`${SITE}/api/events/1`, {
      method: 'DELETE', headers: { Cookie: `__Host-session=${TOKEN}`, Origin: SITE },
    }), env, { waitUntil() {} });
    expect(r.status).toBe(200);
    expect(linhas().map(l => l.slug)).toEqual(['outro']);
  });

  it('o hash ignora o instante da leitura e muda com o conteúdo', async () => {
    const a = { v: 2, em: '2026-01-01T00:00:00Z', secoes: [{ nome: 'x' }] };
    expect(await hashDaListagem(a)).toBe(await hashDaListagem({ ...a, em: '2027-01-01T00:00:00Z' }));
    expect(await hashDaListagem(a)).not.toBe(await hashDaListagem({ ...a, secoes: [{ nome: 'y' }] }));
    expect(await hashDaListagem(a)).toMatch(/^[0-9a-f]{16}$/);
  });
});
