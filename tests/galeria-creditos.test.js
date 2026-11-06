// Créditos por pasta de autor (v3.1). O que estes testes prendem:
//  1. O campo: linhas `pasta = Nome[ <e-mail>]`, validadas e limitadas; vazio
//     = autor padrão.
//  2. A listagem: pasta de autor NÃO é seção (fotos vão para a seção de cima
//     com o autor), não conta para a profundidade; ordem por hora da captura
//     só em seção com autores misturados; a chave do cache leva os créditos.
//  3. A página: "Fotos: A, B e C" e o filtro por fotógrafo só com mais de um
//     autor; JSON-LD por foto; o e-mail do autor NUNCA aparece.

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import worker from '../src/index.js';
import { listaPasta, limpaCacheDrive, normalizaCreditos, parseCreditos, emailDoAutor, chavePasta } from '../src/drive.js';
import { saveEvents } from '../src/utils.js';
import { normalizeEventFields } from '../src/index.js';
import { withDurableObjects } from './helpers/do.js';
import { fakeCaches } from './helpers/caches.js';

const SITE = 'https://fotos.lucafchala.com';
const RAIZ = 'RAIZ_PASTA_0001';
const MAG = 'PASTA_MAG_00001';
const CHALA = 'PASTA_CHALA_001';
const FESTA = 'PASTA_FESTA_001';
const MAGFESTA = 'PASTA_MAGFESTA1';
const PROFUNDA = 'PASTA_PROF_0001';
const MAIS = 'PASTA_MAIS_00001';

const img = (id, name, time, extra = {}) => ({
  id, name, mimeType: 'image/jpeg', size: '1000',
  imageMediaMetadata: { width: 3000, height: 2000, ...(time ? { time } : {}) }, ...extra,
});
const pasta = (id, name) => ({ id, name, mimeType: 'application/vnd.google-apps.folder' });

const ARVORE = {
  [RAIZ]: [[
    img('RAIZ_FOTO_0001', 'solta.jpg', '2026:03:14 10:00:00'),
    pasta(MAG, ' MAG '),
    pasta(CHALA, 'Chala'),
    pasta(FESTA, 'Festa'),
  ]],
  [MAG]: [[img('MAG_FOTO_00001', 'm1.jpg', '2026:03:14 10:30:00'), img('MAG_SEM_HORA_1', 'm2.jpg')]],
  [CHALA]: [[img('CHALA_FOTO_001', 'c1.jpg', '2026:03:14 10:15:00')]],
  [FESTA]: [[
    img('FESTA_FOTO_001', 'f1.jpg', '2026:03:14 21:00:00'),
    img('FESTA_FOTO_002', 'f2.jpg'),
    pasta(MAGFESTA, 'mág'),
    pasta(PROFUNDA, 'Nivel2'),
  ]],
  [MAGFESTA]: [[img('MAGF_FOTO_0001', 'mf1.jpg', '2026:03:14 20:00:00')]],
  [PROFUNDA]: [[pasta(MAIS, 'Nivel3'), img('PROF_FOTO_0001', 'p1.jpg')]],
  [MAIS]: [[img('MAIS_FOTO_0001', 'x.jpg')]],
};

let chamadas;
function stubFetch() {
  chamadas = [];
  vi.stubGlobal('fetch', vi.fn(async input => {
    const url = new URL(typeof input === 'string' ? input : input.url);
    chamadas.push(url.toString());
    if (url.host === 'www.googleapis.com' && url.pathname === '/drive/v3/files') {
      const id = (url.searchParams.get('q') || '').match(/^'([^']+)' in parents/)?.[1];
      const paginas = ARVORE[id];
      if (!paginas) return Response.json({ error: { code: 404, message: 'x', errors: [{ reason: 'notFound' }] } }, { status: 404 });
      return Response.json({ files: paginas[0] });
    }
    return new Response('x', { status: 599 });
  }));
}

const EMAIL_MAG = 'mag@example.com';
const CREDITOS = `chala = Luca F. Chala\nmag = Mag <${EMAIL_MAG}>\n`;

function fakeKV() {
  const store = new Map();
  return {
    async get(k) { return store.has(k) ? store.get(k) : null; },
    async put(k, v) { store.set(k, v); },
    async delete(k) { store.delete(k); },
    async list() { return { keys: [], list_complete: true, cursor: null }; },
    _store: store,
  };
}

let env;
beforeEach(async () => {
  limpaCacheDrive();
  stubFetch();
  env = withDurableObjects({ FOTOS: fakeKV(), GOOGLE_DRIVE_API_KEY: 'AIzaChaveDeTeste' });
  await saveEvents(env, [{
    id: '1', slug: 'formatura', title: 'Formatura 2026', accessType: 'public', galeriaCreditos: CREDITOS,
    driveUrl: `https://drive.google.com/drive/folders/${RAIZ}?usp=sharing`,
  }]);
});
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });

const raiz = { id: RAIZ, resourceKey: '' };
const ids = s => s.fotos.map(f => f[0]);

describe('o campo "Créditos por pasta"', () => {
  it('chavePasta: sem acento, minúscula, espaços simples', () => {
    expect(chavePasta('  MÁG  ')).toBe('mag');
    expect(chavePasta('Turma  2026')).toBe('turma 2026');
  });

  it('normaliza: linhas válidas, sem repetição, nome e e-mail limitados', () => {
    const t = normalizaCreditos(` Mag = Mag Silva <MAG@Example.com> \nsem igual\n= sem pasta\nmag = Repetida\nx =   \nturma 2026 = Turma 2026`);
    expect(t).toBe('Mag = Mag Silva <mag@example.com>\nturma 2026 = Turma 2026');
    expect(normalizaCreditos('a = ' + 'N'.repeat(200))).toBe('a = ' + 'N'.repeat(80));
    expect(normalizaCreditos(Array.from({ length: 40 }, (_, i) => `p${i} = N${i}`).join('\n')).split('\n')).toHaveLength(20);
    expect(normalizaCreditos(null)).toBe('');
    expect(normalizaCreditos({})).toBe('');
  });

  it('e-mail inválido é descartado (o nome fica); sinais < > não entram no nome', () => {
    expect(normalizaCreditos('mag = Mag <nao-e-email>')).toBe('mag = Mag');
    expect(normalizaCreditos('mag = <b>Mag</b>')).toBe('mag = bMag/b');
    expect(normalizaCreditos(`mag = Mag <${'a'.repeat(130)}@example.com>`)).toBe('mag = Mag');
  });

  it('vazio = padrão (chala = Luca F. Chala); o mapa não carrega e-mail', () => {
    expect([...parseCreditos('')]).toEqual([['chala', 'Luca F. Chala']]);
    expect([...parseCreditos(CREDITOS)]).toEqual([['chala', 'Luca F. Chala'], ['mag', 'Mag']]);
    expect(emailDoAutor(CREDITOS, 'Mag')).toBe(EMAIL_MAG);
    expect(emailDoAutor(CREDITOS, 'Luca F. Chala')).toBe('');
    expect(emailDoAutor('', 'Mag')).toBe('');
  });

  it('normalizeEventFields grava normalizado e o projeto antigo fica com o padrão vazio', () => {
    const base = { slug: 'x' };
    expect(normalizeEventFields({ galeriaCreditos: 'mag = Mag <MAG@example.com>' }, base, []).galeriaCreditos).toBe('mag = Mag <mag@example.com>');
    expect(normalizeEventFields({}, base, []).galeriaCreditos).toBe('');
    expect(normalizeEventFields({ galeriaCreditos: 42 }, base, []).galeriaCreditos).toBe('');
    expect(normalizeEventFields({}, base, []).galeriaCapitulos).toBe(false);
    expect(normalizeEventFields({ galeriaCapitulos: true, nomesAmigaveis: true }, base, [])).toMatchObject({ galeriaCapitulos: true, nomesAmigaveis: true });
    expect(normalizeEventFields({ galeriaCapitulos: 'sim' }, base, []).galeriaCapitulos).toBe(false);
  });
});

describe('listaPasta com pastas de autor', () => {
  it('pasta de autor não é seção: as fotos vão para a seção de cima, com o autor', async () => {
    const d = await listaPasta(env, raiz, { creditos: CREDITOS });
    expect(d.v).toBe(3);
    expect(d.aut).toEqual(['Luca F. Chala', 'Mag']);
    expect(d.secoes.map(s => s.nome)).toEqual(['', 'Festa', 'Nivel2']);
    const rz = d.secoes[0];
    // seção da raiz mistura Luca (solta + Chala) e Mag: ordem por hora; sem hora por último
    expect(ids(rz)).toEqual(['RAIZ_FOTO_0001', 'CHALA_FOTO_001', 'MAG_FOTO_00001', 'MAG_SEM_HORA_1']);
    expect(rz.fotos.map(f => f[5] || 0)).toEqual([0, 0, 1, 1]);
    expect(rz.fotos[0][6]).toBe(20260314100000);
    expect(rz.fotos[3][6]).toBeUndefined();
  });

  it('seção sem mistura de autores mantém a ordem de hoje (nome, natural)', async () => {
    const d = await listaPasta(env, raiz, { creditos: '' });
    // padrão: só "chala" é autor; "mag" volta a ser seção; Festa mistura? não: só Luca
    expect(d.aut).toEqual(['Luca F. Chala']);
    const festa = d.secoes.find(s => s.nome === 'Festa');
    expect(ids(festa)).toEqual(['FESTA_FOTO_001', 'FESTA_FOTO_002']);
    expect(d.secoes.map(s => s.nome)).toEqual(['', ' MAG ', 'Festa', 'mág', 'Nivel2']);
  });

  it('autor dentro de Festa (acento e maiúscula não contam) entra na seção Festa', async () => {
    const d = await listaPasta(env, raiz, { creditos: CREDITOS });
    const festa = d.secoes.find(s => s.nome === 'Festa');
    // mf1 (20:00, Mag) antes de f1 (21:00, Luca); f2 sem hora por último.
    expect(ids(festa)).toEqual(['MAGF_FOTO_0001', 'FESTA_FOTO_001', 'FESTA_FOTO_002']);
  });

  it('a pasta de autor não conta para a profundidade (Festa/mág/Nivel2 chega a 2 níveis de seção)', async () => {
    const d = await listaPasta(env, raiz, { creditos: CREDITOS });
    expect(d.secoes.map(s => s.caminho)).toContain('Festa / Nivel2');
    // o terceiro nível de seção continua cortado
    expect(d.secoes.map(s => s.caminho).some(c => c.includes('Nivel3'))).toBe(false);
    expect(d.truncada).toBe(true);
  });

  it('a chave do cache leva os créditos: mudar o campo não serve a lista antiga', async () => {
    const caches = fakeCaches();
    vi.stubGlobal('caches', caches);
    await listaPasta(env, raiz, { creditos: CREDITOS });
    const n = chamadas.length;
    await listaPasta(env, raiz, { creditos: CREDITOS });
    expect(chamadas.length).toBe(n);
    const outra = await listaPasta(env, raiz, { creditos: 'turma = Turma' });
    expect(chamadas.length).toBeGreaterThan(n);
    expect(outra.aut).toEqual(['Luca F. Chala']);
    expect(caches._store.size).toBe(2);
  });

  it('lista antiga (v1) guardada no cache é ignorada', async () => {
    const caches = fakeCaches();
    vi.stubGlobal('caches', caches);
    await listaPasta(env, raiz, { creditos: CREDITOS });
    const [chave] = [...caches._store.keys()];
    await caches.default.put(chave, new Response(JSON.stringify({ v: 1, pasta: RAIZ, secoes: [] })));
    limpaCacheDrive();
    const d = await listaPasta(env, raiz, { creditos: CREDITOS });
    expect(d.v).toBe(3);
    expect(d.total).toBeGreaterThan(0);
  });

  it('álbum de um autor só: a tupla fica com 5 elementos (JSON compacto)', async () => {
    const d = await listaPasta(env, raiz, { creditos: 'nada = Ninguem' });
    expect(d.secoes.find(s => s.nome === 'Festa').fotos.every(f => f.length === 5 || f[5] === 0 || f[6] > 0)).toBe(true);
    const f2 = d.secoes.find(s => s.nome === 'Festa').fotos.find(f => f[0] === 'FESTA_FOTO_002');
    expect(f2).toHaveLength(5);
  });
});

const dadosDaPagina = html => JSON.parse(html.match(/<script type="application\/json" id="g-dados"[^>]*>([\s\S]*?)<\/script>/)[1]);
const jsonLd = html => JSON.parse(html.match(/<script type="application\/ld\+json"[^>]*>([\s\S]*?)<\/script>/)[1]);
const visitante = async path => worker.fetch(new Request(SITE + path), env, { waitUntil() {} });

describe('a página da galeria', () => {
  it('mais de um autor: linha "Fotos: A e B", autores nos dados e fotógrafo por foto', async () => {
    const res = await visitante('/galeria/formatura');
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toContain('Fotos: Luca F. Chala e Mag');
    const d = dadosDaPagina(html);
    expect(d.autores).toEqual(['Luca F. Chala', 'Mag']);
    const mag = d.secoes[0].fotos.find(f => f[0] === 'MAG_FOTO_00001');
    expect(mag[7]).toBe(1);
    expect(d.secoes[0].fotos[0]).toHaveLength(5); // foto do autor padrão: sem sobra
  });

  it('um autor só: nenhuma linha "Fotos:" e a tupla da página não ganha nada', async () => {
    await saveEvents(env, [{ id: '1', slug: 'formatura', title: 'F', accessType: 'public', galeriaCreditos: '', driveUrl: `https://drive.google.com/drive/folders/${RAIZ}` }]);
    limpaCacheDrive();
    // sem créditos, "mag" volta a ser seção e a raiz só tem Luca (pasta Chala vira autor padrão)
    const html = await (await visitante('/galeria/formatura')).text();
    expect(html).not.toContain('Fotos: ');
    expect(dadosDaPagina(html).autores).toEqual(['Luca F. Chala']);
  });

  it('JSON-LD: Luca fica PERSON_LD, os demais viram Person com o nome', async () => {
    const html = await (await visitante('/galeria/formatura')).text();
    const midia = jsonLd(html).associatedMedia;
    const por = {};
    for (const m of midia) por[m.creditText] = m.creator;
    expect(por['Luca F. Chala']['@id']).toBeTruthy();
    expect(por['Mag']).toEqual({ '@type': 'Person', name: 'Mag' });
  });

  it('o e-mail do autor não aparece em lugar nenhum da resposta pública (HTML, dados, JSON-LD)', async () => {
    for (const caminho of ['/galeria/formatura', '/sitemap-galeria-formatura.xml', '/sitemap.xml', '/formatura']) {
      const res = await visitante(caminho);
      const corpo = await res.text();
      expect(corpo, caminho).not.toContain(EMAIL_MAG);
      expect(corpo, caminho).not.toContain('example.com');
    }
  });

  it('o e-mail não vai nem para a página do dono (a faixa do dono mostra só o nome)', async () => {
    const TOKEN = 'e'.repeat(64);
    await env.FOTOS.put(`admin_session:${TOKEN}`, JSON.stringify({ createdAt: Date.now() }));
    const res = await worker.fetch(new Request(SITE + '/galeria/formatura', { headers: { Cookie: `__Host-session=${TOKEN}` } }), env, { waitUntil() {} });
    expect(await res.text()).not.toContain(EMAIL_MAG);
  });
});

describe('autor padrão configurável (linha "* = Nome")', () => {
  const MAIS_PADRAO = `* = Turma 2026\nmag = Mag <${EMAIL_MAG}>\n`;

  it('a linha "*" entra no campo normalizado, com e-mail opcional', () => {
    expect(normalizaCreditos('* = Turma 2026')).toBe('* = Turma 2026');
    expect(normalizaCreditos('*=Turma 2026 <TURMA@Example.com>')).toBe('* = Turma 2026 <turma@example.com>');
    expect(emailDoAutor('* = Turma 2026 <turma@example.com>', 'Turma 2026')).toBe('turma@example.com');
  });

  it('a foto fora de pasta de autor é do autor padrão do projeto; as pastas de autor continuam valendo', async () => {
    const d = await listaPasta(env, raiz, { creditos: MAIS_PADRAO });
    expect(d.aut).toEqual(['Turma 2026', 'Mag']);
    const rz = d.secoes[0];
    const solta = rz.fotos.find(f => f[0] === 'RAIZ_FOTO_0001');
    expect(solta[5] || 0).toBe(0);
    expect(rz.fotos.find(f => f[0] === 'MAG_FOTO_00001')[5]).toBe(1);
  });

  it('sem a linha "*" o padrão continua o Luca', async () => {
    const d = await listaPasta(env, raiz, { creditos: CREDITOS });
    expect(d.aut[0]).toBe('Luca F. Chala');
  });

  it('com a linha "*" mas sem "chala", a pasta Chala volta a ser seção (o campo manda)', async () => {
    const d = await listaPasta(env, raiz, { creditos: MAIS_PADRAO });
    expect(d.secoes.map(s => s.nome)).toContain('Chala');
  });

  it('uma pasta do Drive chamada "*" não vira pasta de autor', async () => {
    ARVORE[RAIZ][0].push(pasta('PASTA_ESTRELA_01', '*'));
    ARVORE.PASTA_ESTRELA_01 = [[img('ESTRELA_FOTO_01', 'e1.jpg')]];
    try {
      const d = await listaPasta(env, raiz, { creditos: MAIS_PADRAO });
      expect(d.secoes.map(s => s.nome)).toContain('*');
    } finally {
      ARVORE[RAIZ][0].pop();
      delete ARVORE.PASTA_ESTRELA_01;
    }
  });

  it('mudar o autor padrão muda a chave do cache (não serve a lista antiga)', async () => {
    const caches = fakeCaches();
    vi.stubGlobal('caches', caches);
    await listaPasta(env, raiz, { creditos: '* = Turma A' });
    const n = chamadas.length;
    const outra = await listaPasta(env, raiz, { creditos: '* = Turma B' });
    expect(chamadas.length).toBeGreaterThan(n);
    expect(outra.aut[0]).toBe('Turma B');
  });

  it('a página mostra "Fotos: Turma 2026 e Mag", o JSON-LD usa o nome e o e-mail nunca sai', async () => {
    await saveEvents(env, [{
      id: '1', slug: 'formatura', title: 'Formatura 2026', accessType: 'public', galeriaCreditos: `* = Turma 2026 <turma@example.com>\nmag = Mag <${EMAIL_MAG}>`,
      driveUrl: `https://drive.google.com/drive/folders/${RAIZ}?usp=sharing`,
    }]);
    const res = await worker.fetch(new Request(SITE + '/galeria/formatura', { headers: { 'CF-Connecting-IP': '203.0.113.9' } }), env, { waitUntil() {} });
    const html = await res.text();
    expect(html).toContain('Fotos: Turma 2026 e Mag');
    expect(html).toContain('"creditText":"Turma 2026"');
    expect(html).not.toContain('Luca F. Chala<');
    expect(html).not.toContain('turma@example.com');
    expect(html).not.toContain(EMAIL_MAG);
  });
});
