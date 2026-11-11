// Busca nas fotos e moderação (v3.7). O que estes testes prendem:
//  1. o que se guarda de cada foto: palavras lidas com confiança alta, "coisas"
//     em português e inglês (sem as genéricas), e só as categorias de
//     moderação que contam (praia/piscina não);
//  2. a busca: palavra inteira ("10" não acha "100"), todos os termos, sem as
//     ocultas; antes do lançamento só o dono; família/privado nunca;
//  3. o indexador: só com o token; a moderação ESCONDE só foto da turma, e uma
//     vez só (se voltou ao álbum, foi o dono que mostrou); o dono recebe e-mail;
//     foto que saiu do álbum sai da busca;
//  4. o script da página: JS válido, sem innerHTML.
import { describe, it, expect, vi, afterEach } from 'vitest';
import { normaliza, descreveFoto, termosDaBusca, itemDaBusca, ROTULOS_PT } from '../src/busca.js';
import { SCRIPT_BUSCA, buscaHTML } from '../src/ui/indice-comum.js';
import { autoresDaTurma, normalizeEventFields } from '../src/index.js';
import { fotosDaPagina } from '../scripts/rosto-indexa.mjs';
import { withDurableObjects } from './helpers/do.js';
import { d1Sqlite } from './helpers/d1.js';

const TOKEN = 't'.repeat(40);
const SESSAO = 'e'.repeat(64);
const CREDITOS = 'chala = Luca F. Chala\nmag = Mag\n!turma 2026 (adicione suas fotos aqui) = Turma 2026\n* = Turma 2026';
const ALBUM = { id: '1', slug: 'entrenos2026', title: 'Entre Nós', accessType: 'public', galeriaCapitulos: true, buscaTexto: true, galeriaCreditos: CREDITOS, driveUrl: 'https://drive.google.com/drive/folders/RAIZ_PASTA_0001', fotosOcultas: [] };
const F = (/** @type {number} */ n) => `FOTO_${String(n).padStart(6, '0')}_AB`;

function kv(/** @type {any[]} */ eventos) {
  const store = new Map([['events', JSON.stringify(eventos)], [`admin_session:${SESSAO}`, JSON.stringify({ createdAt: Date.now() })]]);
  return { _store: store, async get(/** @type {string} */ k) { return store.has(k) ? store.get(k) : null; }, async put(/** @type {string} */ k, /** @type {string} */ v) { store.set(k, v); },
    async delete() {}, async list() { return { keys: [], list_complete: true, cursor: null }; } };
}
async function frio() {
  vi.resetModules();
  return (await import('../src/index.js')).default;
}
/** @param {any[]} eventos @param {any} db */
function ambiente(eventos, db) {
  return withDurableObjects({ FOTOS: kv(eventos), CONSENT_DB: db, ROSTO_INDEXADOR_TOKEN: TOKEN, RESEND_API_KEY: 're_x', ADMIN_EMAIL: 'dono@example.com' });
}
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });

describe('o que se guarda de cada foto', () => {
  it('normaliza: sem acento, minúsculo, só letras e números', () => {
    expect(normaliza('  Ação-Nº 10!  ')).toBe('acao n 10');
  });

  it('texto: só palavras com confiança alta', () => {
    const d = descreveFoto({ texto: { TextDetections: [
      { Type: 'WORD', DetectedText: '10', Confidence: 99 },
      { Type: 'WORD', DetectedText: 'TERCEIRÃO', Confidence: 95 },
      { Type: 'WORD', DetectedText: 'borrão', Confidence: 40 },
      { Type: 'LINE', DetectedText: 'linha inteira', Confidence: 99 },
    ] } });
    expect(d.texto.split(' ').sort()).toEqual(['10', 'terceirao']);
  });

  it('coisas: português e inglês; as genéricas ficam de fora', () => {
    const d = descreveFoto({ rotulos: { Labels: [
      { Name: 'Cake', Confidence: 97 }, { Name: 'Stage', Confidence: 90 }, { Name: 'Person', Confidence: 99 }, { Name: 'Guitar', Confidence: 50 },
    ] } });
    const c = d.coisas.split(' ');
    expect(c).toEqual(expect.arrayContaining(['cake', 'bolo', 'stage', 'palco']));
    expect(c).not.toContain('person');
    expect(c).not.toContain('violao');
    expect(ROTULOS_PT.Stage).toBe('palco');
  });

  it('moderação: só as categorias que contam, com confiança alta; praia não', () => {
    const d = descreveFoto({ moderacao: { ModerationLabels: [
      { Name: 'Middle Finger', ParentName: 'Rude Gestures', Confidence: 92 },
      { Name: 'Swimwear or Underwear', ParentName: '', Confidence: 99 },
      { Name: 'Alcohol', ParentName: '', Confidence: 60 },
    ] } });
    expect(d.moderacao).toBe('Middle Finger');
    expect(descreveFoto({}).moderacao).toBe('');
  });

  it('termos: até 5, normalizados, sem repetir', () => {
    expect(termosDaBusca(' Bolo  BOLO palco 10 a b c d')).toEqual(['bolo', 'palco', '10', 'a', 'b']);
    expect(termosDaBusca('')).toEqual([]);
  });

  it('item do indexador: só id e capítulo válidos; texto limpo', () => {
    expect(itemDaBusca({ foto: F(1), cap: 'festa-junina', autor: 'Turma\u00002026', texto: 'Olá <b>', coisas: 'bolo', moderacao: 'Alcohol<script>' }))
      .toEqual({ foto: F(1), cap: 'festa-junina', autor: 'Turma2026', texto: 'ola b', coisas: 'bolo', moderacao: 'Alcoholscript' });
    for (const ruim of [null, { foto: '../x', cap: '' }, { foto: F(1), cap: 'A B' }, { foto: F(1) }]) expect(itemDaBusca(ruim)).toBeNull();
  });

  it('autores da turma: a linha * e as pastas com "!"; sem *, o dono não é turma', () => {
    expect([...autoresDaTurma(/** @type {any} */ (ALBUM))].sort()).toEqual(['Turma 2026']);
    expect([...autoresDaTurma(/** @type {any} */ ({ galeriaCreditos: 'chala = Luca F. Chala' }))]).toEqual([]);
  });

  it('o indexador lê o autor de cada foto da página', () => {
    const html = `<script type="application/json" id="g-dados">${JSON.stringify({ cap: 'gala', autores: ['Turma 2026', 'Luca F. Chala'], secoes: [{ fotos: [[F(1), 1, 1, 'a', 1], [F(2), 1, 1, 'b', 1, -1, '', 1], [F(3), 1, 1, 'c', 1, -1, '', 0, '', 30]] }] })}</script>`;
    const p = fotosDaPagina(html);
    expect(p?.ids).toEqual([F(1), F(2)]);
    expect(p?.autores.get(F(1))).toBe('Turma 2026');
    expect(p?.autores.get(F(2))).toBe('Luca F. Chala');
  });
});

/** @param {any} db @param {any} corpo @param {string} [token] */
async function indexa(db, eventos, corpo, token = TOKEN) {
  const w = await frio();
  const env = ambiente(eventos, db);
  /** @type {Promise<any>[]} */
  const pend = [];
  const res = await w.fetch(new Request('https://fotos.lucafchala.com/api/busca/indexar', {
    method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Rosto-Indexador': token }, body: JSON.stringify(corpo),
  }), env, { waitUntil: (/** @type {Promise<any>} */ p) => pend.push(p) });
  await Promise.all(pend);
  return { res, env };
}
/** @param {any} db @param {any[]} eventos @param {string} q @param {boolean} [dono] */
async function buscaCrua(db, eventos, q, dono = false) {
  const w = await frio();
  /** @type {Record<string, string>} */
  const headers = { 'CF-Connecting-IP': '203.0.113.5' };
  if (dono) headers.Cookie = `__Host-session=${SESSAO}`;
  return w.fetch(new Request(`https://fotos.lucafchala.com/api/busca?slug=entrenos2026&q=${encodeURIComponent(q)}`, { headers }), ambiente(eventos, db), { waitUntil() {} });
}
// Desde a v3.8.8 cada achado leva também `k` (o álbum e a assinatura que o
// endereço da foto exige, /f/). Os testes daqui comparam o capítulo e a foto;
// o `k` tem teste próprio, logo abaixo, com a resposta crua.
/** @param {any} db @param {any[]} eventos @param {string} q @param {boolean} [dono] */
async function busca(db, eventos, q, dono = false) {
  const res = await buscaCrua(db, eventos, q, dono);
  return {
    status: res.status,
    headers: res.headers,
    json: async () => {
      const j = /** @type {any} */ (await res.json());
      return Array.isArray(j.resultados) ? { ...j, resultados: j.resultados.map((/** @type {any} */ r) => { const semK = { ...r }; delete semK.k; return semK; }) } : j;
    },
  };
}

describe('indexador → site', () => {
  it('sem o token certo: 404, nada gravado', async () => {
    const db = d1Sqlite();
    const { res } = await indexa(db, [ALBUM], { slug: 'entrenos2026', itens: [{ foto: F(1), cap: 'a', texto: 'x' }] }, 'errado'.repeat(8));
    expect(res.status).toBe(404);
    expect(db.sqlite.prepare('SELECT COUNT(*) n FROM busca_foto').get()).toEqual({ n: 0 });
  });

  it('grava; moderação esconde só a foto da turma, uma vez; o dono recebe e-mail', async () => {
    const db = d1Sqlite();
    const emails = [];
    vi.stubGlobal('fetch', vi.fn(async (/** @type {any} */ u, /** @type {any} */ init) => { if (String(u).includes('resend')) emails.push(JSON.parse(init.body)); return Response.json({ id: 'x' }); }));
    const itens = [
      { foto: F(1), cap: 'piauifut', autor: 'Turma 2026', texto: '10 piauifut', coisas: 'ball bola', moderacao: '' },
      { foto: F(2), cap: 'piauifut', autor: 'Turma 2026', texto: '', coisas: 'party', moderacao: 'Middle Finger' },
      { foto: F(3), cap: 'gala', autor: 'Luca F. Chala', texto: '', coisas: 'party', moderacao: 'Alcohol' },
    ];
    const { res, env } = await indexa(db, [ALBUM], { slug: 'entrenos2026', itens });
    expect(await res.json()).toMatchObject({ gravadas: 3, marcadas: 2, escondidas: 1 });
    const salvo = JSON.parse(/** @type {any} */ (env.FOTOS)._store.get('events'))[0];
    expect(salvo.fotosOcultas).toEqual([F(2)]);
    expect(emails).toHaveLength(1);
    expect(emails[0].to).toEqual(['dono@example.com']);
    expect(emails[0].html).toContain('escondida');
    expect(emails[0].html).toContain('só marcada');

    // O dono mostrou a F(2) de novo; o indexador manda de novo: não esconde.
    emails.length = 0;
    const { res: r2, env: env2 } = await indexa(db, [{ ...ALBUM, fotosOcultas: [] }], { slug: 'entrenos2026', itens: [itens[1]] });
    expect(await r2.json()).toMatchObject({ marcadas: 0, escondidas: 0 });
    expect(JSON.parse(/** @type {any} */ (env2.FOTOS)._store.get('events'))[0].fotosOcultas).toEqual([]);
    expect(emails).toHaveLength(0);
  });

  it('fotos novas marcam o aviso no celular e "minhas fotos"; a mesma foto de novo não conta (v3.8.4)', async () => {
    const db = d1Sqlite();
    vi.stubGlobal('fetch', vi.fn(async () => Response.json({ id: 'x' })));
    const itens = [{ foto: F(1), cap: 'piauifut', texto: '', coisas: '', moderacao: '' }, { foto: F(2), cap: 'gala', texto: '', coisas: '', moderacao: '' }];
    const { env } = await indexa(db, [ALBUM], { slug: 'entrenos2026', itens });
    const loja = /** @type {any} */ (env.FOTOS)._store;
    expect(JSON.parse(loja.get('aviso:pendente:entrenos2026'))).toMatchObject({ n: 2, caps: { piauifut: 1, gala: 1 } });
    expect(Number(loja.get('rosto-novas:entrenos2026'))).toBeGreaterThan(0);
    // A releitura das mesmas fotos não vira "fotos novas".
    const { env: env2 } = await indexa(db, [ALBUM], { slug: 'entrenos2026', itens });
    expect(/** @type {any} */ (env2.FOTOS)._store.get('aviso:pendente:entrenos2026')).toBeUndefined();
  });

  it('foto que saiu do álbum sai da busca', async () => {
    const db = d1Sqlite();
    await indexa(db, [ALBUM], { slug: 'entrenos2026', itens: [{ foto: F(1), cap: 'a', texto: 'bolo' }, { foto: F(2), cap: 'a', texto: 'bolo' }] });
    await indexa(db, [ALBUM], { slug: 'entrenos2026', remover: [F(1)] });
    expect(db.sqlite.prepare('SELECT foto FROM busca_foto').all()).toEqual([{ foto: F(2) }]);
  });
});

describe('GET /api/busca', () => {
  /** @param {any} db */
  async function semeia(db) {
    await indexa(db, [ALBUM], { slug: 'entrenos2026', itens: [
      { foto: F(1), cap: 'piauifut', texto: '10 piauifut', coisas: 'ball bola soccer futebol' },
      { foto: F(2), cap: 'piauifut', texto: '100', coisas: 'ball bola' },
      { foto: F(3), cap: 'festa-junina', texto: '', coisas: 'cake bolo party festa' },
    ] });
  }

  it('v3.8.8: cada achado leva o `k` do endereço da foto (o álbum; com o segredo, também a assinatura)', async () => {
    const db = d1Sqlite();
    await semeia(db);
    const achados = (await (await buscaCrua(db, [{ ...ALBUM }], '10')).json()).resultados;
    expect(achados).toHaveLength(1);
    expect(achados[0].id).toBe(F(1));
    expect(achados[0].k).toMatch(/^entrenos2026(\.[\w-]{8})?$/);
  });

  it('palavra inteira e todos os termos; as ocultas não aparecem', async () => {
    const db = d1Sqlite();
    await semeia(db);
    const lanc = { ...ALBUM };
    expect((await (await busca(db, [lanc], '10')).json()).resultados).toEqual([{ cap: 'piauifut', id: F(1) }]);
    expect((await (await busca(db, [lanc], 'bola 10')).json()).resultados).toEqual([{ cap: 'piauifut', id: F(1) }]);
    expect((await (await busca(db, [lanc], 'Bolo')).json()).resultados).toEqual([{ cap: 'festa-junina', id: F(3) }]);
    expect((await (await busca(db, [{ ...lanc, fotosOcultas: [F(3)] }], 'bolo')).json()).resultados).toEqual([]);
    expect((await (await busca(db, [lanc], '')).json()).resultados).toEqual([]);
  });

  it('antes do lançamento só o dono; desligada ou família: nada', async () => {
    const db = d1Sqlite();
    await semeia(db);
    const surpresa = { ...ALBUM, comingSoon: true, visible: false };
    expect((await busca(db, [surpresa], 'bolo')).status).toBe(404);
    expect((await busca(db, [surpresa], 'bolo', true)).status).toBe(200);
    expect((await busca(db, [{ ...ALBUM, buscaTexto: false }], 'bolo')).status).toBe(404);
    expect((await busca(db, [{ ...ALBUM, accessType: 'family' }], 'bolo')).status).toBe(404);
  });
});

describe('página e painel', () => {
  it('o script é JS válido, sem innerHTML; o campo começa escondido', () => {
    expect(() => new Function(SCRIPT_BUSCA)).not.toThrow();
    expect(SCRIPT_BUSCA).not.toMatch(/innerHTML|insertAdjacentHTML|document\.write/);
    expect(buscaHTML()).toContain('<form class="bf" id="bf-form" role="search" hidden>');
  });

  it('o painel grava a opção só com true', () => {
    expect(normalizeEventFields({ buscaTexto: true }, { slug: 'x' }, []).buscaTexto).toBe(true);
    expect(normalizeEventFields({ buscaTexto: 'sim' }, { slug: 'x' }, []).buscaTexto).toBe(false);
  });
});

describe('atalhos prontos da busca (v3.7.1)', () => {
  it('"jogo" e "comida" acham esporte e comida; a página traz os botões', () => {
    const c = descreveFoto({ rotulos: { Labels: [{ Name: 'Soccer', Confidence: 95 }, { Name: 'Pizza', Confidence: 95 }] } }).coisas.split(' ');
    expect(c).toEqual(expect.arrayContaining(['jogo', 'comida', 'futebol', 'pizza']));
    for (const t of ['jogo', 'comida', 'palco', 'bola']) expect(buscaHTML()).toContain(`<button type="button" data-bf="${t}">${t}</button>`);
    expect(SCRIPT_BUSCA).toContain("closest('[data-bf]')");
  });
});
