// Galeria por capítulos (v3.1, item 2): /galeria/<slug> vira um ÍNDICE com um
// cartão por subpasta de primeiro nível; /galeria/<slug>/<capítulo> é a galeria
// daquela subpasta. O que estes testes prendem:
//
//  1. o índice custa UMA chamada ao Drive e não lê nenhum capítulo;
//  2. ordem (anos do mais novo ao mais antigo, depois a natural), nomes limpos,
//     slug com sufixo na colisão, capítulo desconhecido = 404;
//  3. segurança: download, remoção e "para redes" só procuram a foto na pasta do
//     capítulo da ROTA — foto de outro capítulo é 404, e o ID da pasta nunca vem
//     do navegador;
//  4. contadores por capítulo, sitemaps, nomes amigáveis com o capítulo;
//  5. o orçamento de subrequisições do plano gratuito.

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import worker, { mintFormToken } from '../src/index.js';
import { limpaCacheDrive, listaCapitulos, lerResumo, nomeDeCapitulo, slugBaseDeCapitulo, ordemDeCapitulos } from '../src/drive.js';
import { saveEvents, readCounters, deleteCounters } from '../src/utils.js';
import { GALERIA_MAX_CHAMADAS_IG, GALERIA_MAX_CHAMADAS_CAP } from '../src/config.js';
import { withDurableObjects } from './helpers/do.js';
import { fakeCaches } from './helpers/caches.js';
import { d1Contado } from './helpers/d1.js';
import { pedidosGravados, relogioAdiantavel } from './helpers/pedidos.js';

const SITE = 'https://fotos.lucafchala.com';
const TOKEN = 'e'.repeat(64);
const RAIZ = 'RAIZ_PASTA_0001';
const IG = 'IG_PASTA_000001';
const CAP_A = 'CAPA_PASTA_0001';
const CAP_B = 'CAPB_PASTA_0001';
const CAP_C = 'CAPC_PASTA_0001';
const CAP_D = 'CAPD_PASTA_0001';
const CAP_E = 'CAPE_PASTA_0001';
const SUB_C = 'SUBC_PASTA_0001';

const arq = (id, nome, time) => ({ id, name: nome, mimeType: 'image/jpeg', size: '1000', imageMediaMetadata: { width: 3000, height: 2000, ...(time ? { time } : {}) } });
const pasta = (id, nome) => ({ id, name: nome, mimeType: 'application/vnd.google-apps.folder' });
const ARVORE = {
  [RAIZ]: [
    arq('FOTO_SOLTA_0001', 'solta.jpg'),
    pasta(CAP_A, '01 - Abertura'), pasta(CAP_B, '2026 - Churrasco'), pasta(CAP_C, 'Colação_de_grau'),
    pasta(CAP_D, '02 - Abertura'), pasta(CAP_E, '2024 - Festa'),
  ],
  [CAP_A]: [arq('FOTO_A1_000001', 'a1.jpg', '2026:03:14 10:22:33'), arq('FOTO_A2_000001', 'a2.jpg')],
  [CAP_B]: [arq('FOTO_B1_000001', 'b1.jpg'), arq('FOTO_B2_000001', 'b2.jpg')],
  [CAP_C]: [arq('FOTO_C1_000001', 'c1.jpg'), pasta(SUB_C, 'Noite')],
  [SUB_C]: [arq('FOTO_C2_000001', 'c2.jpg')],
  [CAP_D]: [arq('FOTO_D1_000001', 'd1.jpg')],
  [CAP_E]: [arq('FOTO_E1_000001', 'e1.jpg'), arq('FOTO_E2_000001', 'e2.jpg'), arq('FOTO_E3_000001', 'e3.jpg')],
  [IG]: [{ id: 'IG_A1_00000001', name: 'a1.png', mimeType: 'image/png', size: '500' }, { id: 'IG_D1_00000001', name: 'd1.png', mimeType: 'image/png', size: '500' }],
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
  id: '1', slug: 'formatura', title: 'Formatura 2026', accessType: 'public', galeriaCapitulos: true,
  driveUrl: `https://drive.google.com/drive/folders/${RAIZ}`,
  driveUrlInstagram: `https://drive.google.com/drive/folders/${IG}`,
};

let env;
let chamadas; // pedidos ao googleapis (Drive)
let pend;
let ctx;
let ipSeq;

beforeEach(async () => {
  limpaCacheDrive();
  relogioAdiantavel();
  chamadas = [];
  pend = [];
  ipSeq = 0;
  ctx = { waitUntil: p => { pend.push(p); } };
  vi.stubGlobal('fetch', vi.fn(async input => {
    const url = new URL(typeof input === 'string' ? input : input.url);
    if (url.host === 'challenges.cloudflare.com') return Response.json({ success: true });
    if (url.pathname === '/drive/v3/files') {
      chamadas.push(url);
      const id = (url.searchParams.get('q') || '').match(/^'([^']+)' in parents/)?.[1];
      const soPastas = (url.searchParams.get('q') || '').includes("mimeType = 'application/vnd.google-apps.folder'");
      return Response.json({ files: (ARVORE[id] || []).filter(f => !soPastas || f.mimeType.endsWith('.folder')) });
    }
    if (url.pathname.startsWith('/drive/v3/files/')) {
      return new Response('BYTES-' + url.pathname.split('/').pop(), { headers: { 'Content-Type': 'image/jpeg' } });
    }
    return new Response('nao esperado', { status: 599 });
  }));
  env = withDurableObjects({
    FOTOS: fakeKV({ [`admin_session:${TOKEN}`]: JSON.stringify({ createdAt: Date.now() }) }),
    GOOGLE_DRIVE_API_KEY: 'AIzaChaveDeTeste123',
    TURNSTILE_SECRET_KEY: 'ts-secret',
    SIGNING_SECRET: 's'.repeat(48),
  });
  await saveEvents(env, [structuredClone(EVENTO)]);
});
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });

const fundo = async () => { await Promise.all(pend.splice(0)); await new Promise(r => setTimeout(r, 0)); };
const get = async (path, { dono = false, ip = '203.0.113.9', cookie = '' } = {}) => {
  const headers = { 'CF-Connecting-IP': ip };
  const c = [dono ? `__Host-session=${TOKEN}` : '', cookie].filter(Boolean).join('; ');
  if (c) headers.Cookie = c;
  const res = await worker.fetch(new Request(SITE + path, { headers }), env, ctx);
  await fundo();
  return res;
};
const html = async (path, o) => (await get(path, o)).text();
const contadores = chaves => readCounters(env, chaves);
const slugsDoIndice = h => [...h.matchAll(/href="\/galeria\/formatura\/([a-z0-9-]+)"/g)].map(m => m[1]);
const nomesDoIndice = h => [...h.matchAll(/class="ix-nome">([^<]*)</g)].map(m => m[1]);

describe('primitivas', () => {
  it('nomeDeCapitulo: tira o número de ordem, mantém ano, "_" vira espaço', () => {
    expect(nomeDeCapitulo('01 - Abertura')).toBe('Abertura');
    expect(nomeDeCapitulo('2026 - Churrasco')).toBe('2026 - Churrasco');
    expect(nomeDeCapitulo('Colação_de_grau')).toBe('Colação de grau');
    expect(nomeDeCapitulo('10. Final')).toBe('Final');
    expect(nomeDeCapitulo('x'.repeat(200)).length).toBeLessThanOrEqual(80);
  });
  it('slugBaseDeCapitulo: sem acento nem símbolo; vazio vira "capitulo"', () => {
    expect(slugBaseDeCapitulo('Colação de grau')).toBe('colacao-de-grau');
    expect(slugBaseDeCapitulo('!!!')).toBe('capitulo');
    expect(slugBaseDeCapitulo('A/B\\C?')).toMatch(/^[a-z0-9-]+$/);
  });
  it('ordemDeCapitulos: anos do mais novo ao mais antigo, depois a ordem natural', () => {
    const nomes = ['Festa', '2024', 'Abertura 10', 'Abertura 2', '2026 - Churrasco'];
    const bruto = nomes.map(n => ({ bruto: n, nome: n }));
    expect(bruto.sort(ordemDeCapitulos).map(c => c.nome)).toEqual(['2026 - Churrasco', '2024', 'Abertura 2', 'Abertura 10', 'Festa']);
  });
});

describe('o índice', () => {
  it('uma chamada ao Drive, só as subpastas; cartões na ordem, com nomes limpos', async () => {
    const res = await get('/galeria/formatura');
    expect(res.status).toBe(200);
    expect(chamadas).toHaveLength(1);
    expect(chamadas[0].searchParams.get('q')).toContain("mimeType = 'application/vnd.google-apps.folder'");
    const h = await res.text();
    const nomes = nomesDoIndice(h);
    expect(nomes).toEqual(['2026 - Churrasco', '2024 - Festa', 'Abertura', 'Abertura', 'Colação de grau']);
    const slugs = slugsDoIndice(h);
    expect(slugs).toHaveLength(5);
    expect(new Set(slugs).size).toBe(5); // colisão ganhou sufixo
    expect(slugs).toContain('abertura');
    expect(slugs.filter(s => /^abertura-[a-z0-9]{4}$/.test(s))).toHaveLength(1);
    expect(slugs).toContain('colacao-de-grau');
    expect(h).not.toContain('solta.jpg');
    expect(h).toContain('<link rel="canonical" href="https://fotos.lucafchala.com/galeria/formatura">');
    expect(h).not.toContain('AIzaChaveDeTeste123');
  });

  it('capítulo nunca aberto: espaço reservado e "Ver fotos"; depois de aberto, contagem e capa', async () => {
    let h = await html('/galeria/formatura');
    expect(h).toContain('Ver fotos');
    expect(h).not.toContain('<img');
    expect((await get('/galeria/formatura/abertura')).status).toBe(200);
    limpaCacheDrive();
    h = await html('/galeria/formatura');
    // memória limpa e sem Cache API em teste: o resumo some junto — o índice volta ao espaço reservado, sem erro.
    expect(h).toContain('Ver fotos');
  });

  it('com Cache API, o resumo sobrevive ao isolate e o índice mostra contagem e capa', async () => {
    vi.stubGlobal('caches', fakeCaches());
    expect((await get('/galeria/formatura/2024-festa')).status).toBe(200);
    limpaCacheDrive();
    const n = chamadas.length;
    const h = await html('/galeria/formatura');
    expect(chamadas.length).toBe(n); // a lista de capítulos também veio do cache
    expect(h).toContain('3 fotos');
    expect(h).toContain('/d/FOTO_E1_000001=w480');
    const resumo = await lerResumo(RAIZ);
    expect(Object.values(resumo).map(r => r.n)).toEqual([3]);
  });

  it('capa oculta é pulada', async () => {
    vi.stubGlobal('caches', fakeCaches());
    await get('/galeria/formatura/2024-festa');
    const ev = structuredClone(EVENTO);
    ev.fotosOcultas = ['FOTO_E1_000001'];
    await saveEvents(env, [ev]);
    limpaCacheDrive();
    const h = await html('/galeria/formatura');
    expect(h).not.toContain('FOTO_E1_000001');
    expect(h).toContain('/d/FOTO_E2_000001=w480');
  });

  it('visitante: sem a faixa do dono; dono vê a faixa e "Atualizar agora" relê e volta ao endereço limpo', async () => {
    expect(await html('/galeria/formatura')).not.toContain('Só você (logado)');
    expect(await html('/galeria/formatura', { dono: true })).toContain('Só você (logado)');
    const antes = chamadas.length;
    const r = await get('/galeria/formatura?atualizar=1', { dono: true });
    expect(r.status).toBe(302);
    expect(r.headers.get('Location')).toBe('/galeria/formatura');
    expect(chamadas.length).toBe(antes + 1);
  });

  it('visitante não força a releitura (?atualizar=1 é ignorado)', async () => {
    await get('/galeria/formatura');
    const n = chamadas.length;
    const r = await get('/galeria/formatura?atualizar=1');
    expect(r.status).toBe(200);
    expect(chamadas.length).toBe(n);
  });

  it('o Drive fora: o índice dá a página de erro da galeria, sem derrubar o Worker', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('{}', { status: 500 })));
    const r = await get('/galeria/formatura');
    expect([200, 502, 503]).toContain(r.status);
    expect(r.status).not.toBe(500);
  });

  it('projeto sem capítulos continua igual: página única; e /galeria/<slug>/<x> é 404', async () => {
    await saveEvents(env, [{ ...EVENTO, galeriaCapitulos: false }]);
    limpaCacheDrive();
    const h = await html('/galeria/formatura');
    expect(h).toContain('id="g-dados"');
    expect((await get('/galeria/formatura/abertura')).status).toBe(404);
  });

  it('truncada sem capítulos: só o dono recebe a dica de ligar os capítulos', async () => {
    await saveEvents(env, [{ ...EVENTO, galeriaCapitulos: false }]);
    vi.stubGlobal('fetch', vi.fn(async input => {
      const url = new URL(typeof input === 'string' ? input : input.url);
      const n = Number(url.searchParams.get('pageToken') || 0);
      return Response.json({ files: [arq(`PAGINA_${String(n).padStart(5, '0')}_X`, `${n}.jpg`)], nextPageToken: String(n + 1) });
    }));
    limpaCacheDrive();
    expect(await html('/galeria/formatura', { dono: true })).toContain('Galeria por capítulos');
    expect(await html('/galeria/formatura')).not.toContain('Galeria por capítulos');
  });
});

describe('a página do capítulo', () => {
  it('tem tudo da galeria; só as fotos do capítulo (e das subpastas dele)', async () => {
    const res = await get('/galeria/formatura/colacao-de-grau');
    expect(res.status).toBe(200);
    const h = await res.text();
    expect(h).toContain('id="g-dados"');
    expect(h).toContain('FOTO_C1_000001');
    expect(h).toContain('FOTO_C2_000001');
    expect(h).not.toContain('FOTO_A1_000001');
    expect(h).not.toContain('FOTO_SOLTA_0001');
    expect(h).toContain('"cap":"colacao-de-grau"');
    expect(h).toContain('<link rel="canonical" href="https://fotos.lucafchala.com/galeria/formatura/colacao-de-grau">');
    expect(h).toContain('Todos os eventos');
    // Drive: capítulos (1) + o capítulo e sua subpasta (2) + a pasta do Instagram (1)
    expect(chamadas).toHaveLength(4);
  });

  it('navegação: anterior e próximo na ordem do índice', async () => {
    const h = await html('/galeria/formatura/2024-festa');
    expect(h).toContain('href="/galeria/formatura/2026-churrasco"'); // anterior
    expect(h).toMatch(/rel="next" href="\/galeria\/formatura\/abertura/);
    const primeiro = await html('/galeria/formatura/2026-churrasco');
    expect(primeiro).not.toContain('rel="prev"');
    const ultimo = await html('/galeria/formatura/colacao-de-grau');
    expect(ultimo).not.toContain('rel="next"');
  });

  it('capítulo desconhecido, reservado ou malformado: o 404 da galeria', async () => {
    for (const c of ['nao-existe', 'baixar', 'sitemap', 'ABERTURA', 'a_b']) {
      expect((await get(`/galeria/formatura/${c}`)).status).toBe(404);
    }
    expect((await get('/galeria/nao-existe/abertura')).status).toBe(404);
  });

  it('cabeçalhos: visitante é "private, no-cache"; capítulo de projeto público é indexável', async () => {
    const r = await get('/galeria/formatura/2024-festa');
    expect(r.headers.get('Cache-Control')).toBe('private, no-cache');
    expect(await r.text()).toContain('content="index,follow');
  });

  it('álbum de família sem o passe: 404 também nos capítulos e no índice', async () => {
    await saveEvents(env, [{ ...EVENTO, accessType: 'family' }]);
    limpaCacheDrive();
    expect((await get('/galeria/formatura')).status).toBe(404);
    expect((await get('/galeria/formatura/abertura')).status).toBe(404);
    expect((await get('/galeria/formatura/abertura/baixar/FOTO_A1_000001')).status).toBe(404);
    expect((await get('/galeria/formatura/2024-festa', { dono: true })).status).toBe(200);
  });

  it('"para redes": o par é achado pelo nome dentro do capítulo', async () => {
    const r = await get('/galeria/formatura/abertura/baixar/FOTO_A1_000001?v=redes');
    expect(r.status).toBe(200);
    expect(await r.text()).toBe('BYTES-IG_A1_00000001');
  });
});

describe('segurança: a foto é procurada só na pasta do capítulo da rota', () => {
  it('download: foto de outro capítulo, ou sem capítulo, é 404', async () => {
    expect((await get('/galeria/formatura/abertura/baixar/FOTO_A1_000001')).status).toBe(200);
    expect((await get('/galeria/formatura/2024-festa/baixar/FOTO_A1_000001')).status).toBe(404);
    expect((await get('/galeria/formatura/baixar/FOTO_A1_000001')).status).toBe(404); // sem capítulo num projeto com capítulos
    expect((await get('/galeria/formatura/nao-existe/baixar/FOTO_A1_000001')).status).toBe(404);
    expect((await get('/galeria/formatura/abertura/baixar/FOTO_SOLTA_0001')).status).toBe(404);
    expect((await get('/galeria/formatura/abertura/baixar/FORA_DA_PASTA_1')).status).toBe(404);
  });

  it('o ID de pasta vindo do cliente nunca é lido: query com folder/pasta é ignorada', async () => {
    const r = await get(`/galeria/formatura/abertura/baixar/FOTO_E1_000001?v=max&pasta=${CAP_E}&folder=${CAP_E}&cap=2024-festa`);
    expect(r.status).toBe(404);
    const listadas = chamadas.map(u => (u.searchParams.get('q') || '').match(/^'([^']+)' in parents/)?.[1]);
    expect(listadas).not.toContain(CAP_E);
  });

  it('o download lê o capítulo e nada mais: nenhuma outra subpasta é listada', async () => {
    await get('/galeria/formatura/2026-churrasco/baixar/FOTO_B1_000001');
    const listadas = chamadas.map(u => (u.searchParams.get('q') || '').match(/^'([^']+)' in parents/)?.[1]);
    expect(listadas).toContain(RAIZ); // a lista de capítulos
    expect(listadas).toContain(CAP_B);
    for (const outra of [CAP_A, CAP_C, CAP_D, CAP_E, SUB_C]) expect(listadas).not.toContain(outra);
  });

  it('o projeto sem capítulos rejeita a rota com capítulo', async () => {
    await saveEvents(env, [{ ...EVENTO, galeriaCapitulos: false }]);
    limpaCacheDrive();
    expect((await get('/galeria/formatura/abertura/baixar/FOTO_A1_000001')).status).toBe(404);
  });

  it('nome amigável leva o capítulo e a data do capítulo certo', async () => {
    await saveEvents(env, [{ ...EVENTO, nomesAmigaveis: true }]);
    limpaCacheDrive();
    const r = await get('/galeria/formatura/abertura/baixar/FOTO_A1_000001');
    expect(decodeURIComponent(r.headers.get('X-Nome-Arquivo'))).toBe('Formatura 2026 - Abertura - Luca F. Chala - 2026-03-14 10h22m33.jpg');
  });

  it('o robots.txt fecha o download do capítulo', async () => {
    const t = await (await get('/robots.txt')).text();
    expect(t).toContain('Disallow: /galeria/*/*/baixar/');
  });
});

describe('remoção e ocultar com capítulo', () => {
  async function pede(corpo) {
    const c = {
      slug: 'formatura', foto: 'FOTO_A1_000001', cap: 'abertura', motivo: 'eu', email: 'ana@example.com',
      mensagem: '', turnstileToken: 'tok', company_website: '',
      form_token: await mintFormToken(env, 'galeria-remocao', { preAged: true }),
      ...corpo,
    };
    const res = await worker.fetch(new Request(SITE + '/api/galeria/remocao', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'CF-Connecting-IP': `198.51.100.${++ipSeq}` },
      body: JSON.stringify(c),
    }), env, ctx);
    await fundo();
    return res;
  }

  it('foto do capítulo: pedido registrado com o capítulo, foto oculta no projeto', async () => {
    const r = await pede({});
    expect(r.status).toBe(200);
    expect((await r.json()).ocultada).toBe(true);
    const ped = pedidosGravados(env.FOTOS._store);
    expect(ped).toHaveLength(1);
    expect(ped[0]).toMatchObject({ capSlug: 'abertura', capitulo: 'Abertura', fotoId: 'FOTO_A1_000001' });
    expect(ped[0].value).toBe('https://fotos.lucafchala.com/galeria/formatura/abertura');
    const ev = JSON.parse(env.FOTOS._store.get('events')).find(e => e.slug === 'formatura');
    expect(ev.fotosOcultas).toEqual(['FOTO_A1_000001']);
    // oculta no projeto: some do capítulo e do download
    expect((await get('/galeria/formatura/abertura/baixar/FOTO_A1_000001')).status).toBe(404);
  });

  it('foto de OUTRO capítulo (ou sem capítulo) não é aceita nem ocultada', async () => {
    expect((await pede({ cap: '2024-festa' })).status).toBe(404);
    expect((await pede({ cap: '' })).status).toBe(404);
    expect((await pede({ cap: 'nao-existe' })).status).toBe(404);
    expect((await pede({ cap: 'ABC_!' })).status).toBe(400);
    expect(pedidosGravados(env.FOTOS._store)).toHaveLength(0);
    const ev = JSON.parse(env.FOTOS._store.get('events')).find(e => e.slug === 'formatura');
    expect(ev.fotosOcultas || []).toEqual([]);
  });

  it('projeto sem capítulos rejeita pedido com capítulo', async () => {
    await saveEvents(env, [{ ...EVENTO, galeriaCapitulos: false }]);
    limpaCacheDrive();
    expect((await pede({})).status).toBe(404);
    expect((await pede({ cap: '' })).status).toBe(200);
  });

  it('ocultar (dono) segue por id de foto no projeto, com ou sem cap', async () => {
    const r = await worker.fetch(new Request(SITE + '/api/galeria/ocultar', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: `__Host-session=${TOKEN}` },
      body: JSON.stringify({ slug: 'formatura', cap: 'abertura', foto: 'FOTO_A2_000001', oculta: true }),
    }), env, ctx);
    expect(r.status).toBe(200);
    expect((await r.json()).ocultas).toEqual(['FOTO_A2_000001']);
  });
});

describe('contadores por capítulo', () => {
  it('abrir o índice conta o projeto; abrir um capítulo conta o projeto e o capítulo, uma vez por hora', async () => {
    const c1 = await get('/galeria/formatura');
    const ck = c1.headers.getSetCookie().map(c => c.split(';')[0]);
    expect(ck).toEqual(['gv_formatura=1']);
    const c2 = await get('/galeria/formatura/2024-festa', { cookie: ck.join('; ') });
    const ck2 = c2.headers.getSetCookie().map(c => c.split(';')[0]);
    expect(ck2).toEqual(['gv_formatura_2024-festa=1']); // o do projeto já valia
    expect(c2.headers.getSetCookie()[0]).toContain('Path=/galeria/formatura/2024-festa');
    // de novo com os dois cookies: nada soma
    await get('/galeria/formatura/2024-festa', { cookie: 'gv_formatura=1; gv_formatura_2024-festa=1' });
    const v = await contadores(['galeria_views:formatura', 'galeria_views:formatura:2024-festa', 'galeria_views:formatura:abertura']);
    expect(v).toEqual({ 'galeria_views:formatura': 1, 'galeria_views:formatura:2024-festa': 1, 'galeria_views:formatura:abertura': 0 });
  });

  it('dono, robô e prefetch não contam', async () => {
    await get('/galeria/formatura/2024-festa', { dono: true });
    await worker.fetch(new Request(SITE + '/galeria/formatura/2024-festa', { headers: { 'User-Agent': 'Googlebot/2.1' } }), env, ctx);
    await worker.fetch(new Request(SITE + '/galeria/formatura/2024-festa', { headers: { 'Sec-Purpose': 'prefetch' } }), env, ctx);
    await fundo();
    const v = await contadores(['galeria_views:formatura', 'galeria_views:formatura:2024-festa']);
    expect(v).toEqual({ 'galeria_views:formatura': 0, 'galeria_views:formatura:2024-festa': 0 });
  });

  it('capítulo desconhecido não cria contador', async () => {
    await get('/galeria/formatura/nao-existe');
    expect(await contadores(['galeria_views:formatura:nao-existe', 'galeria_views:formatura'])).toEqual({ 'galeria_views:formatura:nao-existe': 0, 'galeria_views:formatura': 0 });
  });

  it('apagar o projeto leva os contadores de todos os capítulos (prefixo)', async () => {
    await get('/galeria/formatura/2024-festa');
    await get('/galeria/formatura/abertura', { ip: '203.0.113.10' });
    const chaves = ['galeria_views:formatura', 'galeria_views:formatura:2024-festa', 'galeria_views:formatura:abertura', 'galeria_views:outro:abertura', 'galeria_views:formatura-2'];
    await contadores(['galeria_views:outro:abertura', 'galeria_views:formatura-2']); // só garante a chave lida
    await deleteCounters(env, ['galeria_views:formatura', 'galeria_views:formatura:*']);
    const depois = await contadores(chaves);
    expect(depois['galeria_views:formatura']).toBe(0);
    expect(depois['galeria_views:formatura:2024-festa']).toBe(0);
    expect(depois['galeria_views:formatura:abertura']).toBe(0);
    expect(depois['galeria_views:formatura-2']).toBe(0);
  });
});

describe('sitemaps', () => {
  it('o índice de sitemaps lista o do projeto e um por capítulo', async () => {
    const x = await html('/sitemap-galerias.xml');
    expect(x).toContain('/sitemap-galeria-formatura.xml');
    for (const s of slugsDoIndice(await html('/galeria/formatura'))) expect(x).toContain(`/sitemap-galeria-formatura.${s}.xml`);
  });

  it('o sitemap do projeto: o índice e as páginas dos capítulos, sem fotos', async () => {
    const x = await html('/sitemap-galeria-formatura.xml');
    expect(x).toContain('<loc>https://fotos.lucafchala.com/galeria/formatura</loc>');
    expect(x).toContain('<loc>https://fotos.lucafchala.com/galeria/formatura/2024-festa</loc>');
    expect(x).not.toContain('image:image');
  });

  it('o sitemap de um capítulo: as fotos dele, na URL dele; oculta não entra', async () => {
    await saveEvents(env, [{ ...EVENTO, fotosOcultas: ['FOTO_E2_000001'] }]);
    limpaCacheDrive();
    const r = await get('/sitemap-galeria-formatura.2024-festa.xml');
    expect(r.status).toBe(200);
    const x = await r.text();
    expect(x).toContain('<loc>https://fotos.lucafchala.com/galeria/formatura/2024-festa</loc>');
    expect(x).toContain('FOTO_E1_000001');
    expect(x).not.toContain('FOTO_E2_000001');
    expect(x).not.toContain('FOTO_A1_000001');
    expect((await get('/sitemap-galeria-formatura.nao-existe.xml')).status).toBe(404);
  });

  it('sitemap com capítulo num projeto sem capítulos: 404', async () => {
    await saveEvents(env, [{ ...EVENTO, galeriaCapitulos: false }]);
    limpaCacheDrive();
    expect((await get('/sitemap-galeria-formatura.abertura.xml')).status).toBe(404);
  });

  it('o índice de sitemaps abre no máximo 8 projetos com capítulos por pedido', async () => {
    const muitos = Array.from({ length: 12 }, (_, i) => ({ ...EVENTO, id: String(i), slug: `p${i}`, driveUrl: `https://drive.google.com/drive/folders/RAIZ_PASTA_00${String(i).padStart(2, '0')}` }));
    await saveEvents(env, muitos);
    limpaCacheDrive();
    chamadas.length = 0;
    await get('/sitemap-galerias.xml');
    expect(chamadas.length).toBeLessThanOrEqual(8);
  });
});

describe('orçamento do plano gratuito', () => {
  it('download "para redes" de capítulo, tudo frio e enorme, usa no máximo 49 subrequisições', async () => {
    let kv = 0;
    for (const m of ['get', 'put', 'delete', 'list']) {
      const orig = env.FOTOS[m].bind(env.FOTOS);
      env.FOTOS[m] = (...a) => { kv++; return orig(...a); };
    }
    let cache = 0;
    const fake = fakeCaches();
    for (const m of ['match', 'put']) {
      const orig = fake.default[m].bind(fake.default);
      fake.default[m] = (...a) => { cache++; return orig(...a); };
    }
    vi.stubGlobal('caches', fake);
    const d1c = d1Contado();
    env.CONSENT_DB = d1c.db;
    let drive = 0;
    vi.stubGlobal('fetch', vi.fn(async input => {
      const url = new URL(typeof input === 'string' ? input : input.url);
      if (url.pathname === '/drive/v3/files') {
        drive++;
        const q = url.searchParams.get('q') || '';
        const n = Number(url.searchParams.get('pageToken') || 0);
        if (q.includes(`'${RAIZ}'`)) return Response.json({ files: [pasta(CAP_A, '01 - Abertura')] });
        const base = q.includes(`'${IG}'`) ? 'IG' : 'GA';
        return Response.json({ files: [arq(`${base}_PAGINA_${String(n).padStart(5, '0')}`, `${n}.jpg`)], nextPageToken: String(n + 1) });
      }
      return new Response('BYTES', { headers: { 'Content-Type': 'image/jpeg' } });
    }));
    env.RATELIMIT._resetCalls();
    env.COUNTER._resetCalls();
    const res = await get('/galeria/formatura/abertura/baixar/GA_PAGINA_00000?v=redes');
    expect(res.status).toBe(200);
    const total = drive + 1 /* os bytes */ + kv + cache + d1c.n() + env.RATELIMIT._calls().length + env.COUNTER._calls().length;
    expect(drive).toBeGreaterThan(GALERIA_MAX_CHAMADAS_IG); // as duas pastas foram lidas até o teto
    expect(drive).toBeLessThanOrEqual(1 + GALERIA_MAX_CHAMADAS_CAP + GALERIA_MAX_CHAMADAS_IG);
    expect(d1c.n()).toBeGreaterThan(0); // o D1 entrou na conta
    expect(total).toBeLessThanOrEqual(49);
  });

  it('a página do capítulo (visitante, tudo frio) cabe nas 49 subrequisições', async () => {
    let kv = 0;
    for (const m of ['get', 'put', 'delete', 'list']) {
      const orig = env.FOTOS[m].bind(env.FOTOS);
      env.FOTOS[m] = (...a) => { kv++; return orig(...a); };
    }
    let cache = 0;
    const fake = fakeCaches();
    for (const m of ['match', 'put']) {
      const orig = fake.default[m].bind(fake.default);
      fake.default[m] = (...a) => { cache++; return orig(...a); };
    }
    vi.stubGlobal('caches', fake);
    const d1c = d1Contado();
    env.CONSENT_DB = d1c.db;
    let drive = 0;
    vi.stubGlobal('fetch', vi.fn(async input => {
      const url = new URL(typeof input === 'string' ? input : input.url);
      drive++;
      const q = url.searchParams.get('q') || '';
      const n = Number(url.searchParams.get('pageToken') || 0);
      if (q.includes(`'${RAIZ}'`)) return Response.json({ files: [pasta(CAP_A, '01 - Abertura')] });
      const base = q.includes(`'${IG}'`) ? 'IG' : 'GA';
      return Response.json({ files: [arq(`${base}_PAGINA_${String(n).padStart(5, '0')}`, `${n}.jpg`)], nextPageToken: String(n + 1) });
    }));
    env.RATELIMIT._resetCalls();
    env.COUNTER._resetCalls();
    const res = await get('/galeria/formatura/abertura');
    expect(res.status).toBe(200);
    const total = drive + kv + cache + d1c.n() + env.RATELIMIT._calls().length + env.COUNTER._calls().length;
    expect(d1c.n()).toBeGreaterThan(0); // o D1 entrou na conta
    expect(total).toBeLessThanOrEqual(49);
  });
});

describe('listaCapitulos', () => {
  it('guarda o resultado: a segunda chamada não vai ao Drive; atualizar vai', async () => {
    const pasta0 = { id: RAIZ, resourceKey: '' };
    await listaCapitulos(env, pasta0);
    await listaCapitulos(env, pasta0);
    expect(chamadas).toHaveLength(1);
    await listaCapitulos(env, pasta0, { atualizar: true });
    expect(chamadas).toHaveLength(2);
  });

  it('mais de 100 subpastas: corta e marca como truncada', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => Response.json({ files: Array.from({ length: 150 }, (_, i) => pasta(`PASTA_${String(i).padStart(8, '0')}`, `Evento ${i}`)) })));
    const d = await listaCapitulos(env, { id: RAIZ, resourceKey: '' });
    expect(d.caps).toHaveLength(100);
    expect(d.truncada).toBe(true);
    expect(new Set(d.caps.map(c => c.slug)).size).toBe(100);
  });

  it('pasta sem acesso: erro tratado como o da listagem', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => Response.json({ error: { code: 404, message: 'x', errors: [{ reason: 'notFound' }] } }, { status: 404 })));
    await expect(listaCapitulos(env, { id: RAIZ, resourceKey: '' })).rejects.toMatchObject({ name: 'DriveError' });
  });
});
