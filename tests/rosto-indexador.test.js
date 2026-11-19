// O indexador (scripts/rosto-indexa.mjs) roda no GitHub Actions de um
// repositório PÚBLICO, e lê o álbum antes do lançamento. O que estes testes
// prendem (revisão de nov/2026, achado 3, v3.8.8):
//  1. o LOG só tem contagens: nunca o slug do álbum, o nome de um evento, o ID
//     de uma foto, o nome da coleção ou a mensagem crua de um erro. Os logs do
//     Actions abrem para qualquer conta do GitHub;
//  2. o ESTADO mora no site (/api/busca/estado, com o token), não no cache do
//     Actions — que o workflow de um PR vindo de um fork consegue restaurar;
//  3. perder o estado não apaga o índice, e uma leitura incompleta do álbum
//     (o Drive falhou numa página) não apaga rosto nenhum.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { readFile } from 'node:fs/promises';
import { ErroAws } from '../src/aws.js';
import { estadoDoIndexadorLimpo, errosDoIndexadorLimpos, leErrosDoIndexador } from '../src/busca.js';
import { AQUECE_LARGURAS } from '../src/config.js';
import { withDurableObjects } from './helpers/do.js';
import { d1Sqlite } from './helpers/d1.js';

const SITE = 'https://site.test';
const SLUG = 'album-secreto';
const TOKEN = 't'.repeat(40);
// Dois eventos e quatro fotos, com nomes que NÃO podem aparecer no log.
const CAP_A = 'evento-secreto-a';
const CAP_B = 'evento-secreto-b';
const F = (/** @type {number} */ n) => `FOTO_SECRETA_${String(n).padStart(4, '0')}`;
const SEGREDOS = [SLUG, CAP_A, CAP_B, 'evento-secreto', 'FOTO_SECRETA', `fotos-${SLUG}`, 'site.test/galeria', 'Evento Secreto'];

/** @param {string} cap @param {string[]} ids */
const paginaDoEvento = (cap, ids) => `<html><script type="application/json" id="g-dados" nonce="n">${JSON.stringify({ slug: SLUG, cap, secoes: [{ nome: '', fotos: ids.map(id => [id, 3000, 2000, `${id}.jpg`, 1000]) }], autores: ['Fulano'] })}</script></html>`;
/** @param {string[]} caps */
const paginaDoIndice = caps => `<html>${caps.map(c => `<a class="ix-card" href="/galeria/${SLUG}/${c}"><span class="ix-nome">Evento Secreto ${c}</span></a>`).join('')}</html>`;

/**
 * O mundo de mentira do indexador: o site, o lh3 e a Rekognition.
 * @param {{
 *   paginas?: Record<string, string | number>, estado?: any, estadoHttp?: number,
 *   indexadas?: Record<string, string[]>, semRosto?: string[], miniatura429?: string[], imagemInvalida?: string[],
 * }} o
 */
function mundo(o = {}) {
  const paginas = o.paginas || {
    '': paginaDoIndice([CAP_A, CAP_B]),
    [CAP_A]: paginaDoEvento(CAP_A, [F(1), F(2)]),
    [CAP_B]: paginaDoEvento(CAP_B, [F(3), F(4)]),
  };
  /** @type {{ op: string, corpo: any }[]} */
  const aws = [];
  /** @type {any[]} */
  const estadosGravados = [];
  /** @type {any[]} */
  const enviosDaBusca = [];
  /** @type {any[]} */
  const errosMandados = [];
  // O estado já marca as larguras de hoje (v3.9.3); sem isso, toda execução
  // reaqueceria (ver o teste das larguras novas).
  let estado = { quentesLarguras: AQUECE_LARGURAS.join(','), ...(o.estado || { vistas: [], descritas: [], qualidade: '', origem: 'vazio' }) };
  const f = vi.fn(async (/** @type {any} */ input, /** @type {any} */ init = {}) => {
    const url = new URL(typeof input === 'string' ? input : input.url);
    if (url.origin === SITE) {
      if (url.pathname === '/api/busca/estado') {
        if (init.headers['X-Rosto-Indexador'] !== TOKEN) return new Response('x', { status: 404 });
        if (o.estadoHttp) return new Response('x', { status: o.estadoHttp });
        if (init.method === 'POST') { estado = { ...JSON.parse(init.body), origem: 'guardado' }; estadosGravados.push(JSON.parse(init.body)); return Response.json({ ok: true }); }
        return Response.json(estado);
      }
      if (url.pathname === '/api/busca/erro') {
        if (init.headers['X-Rosto-Indexador'] !== TOKEN) return new Response('x', { status: 404 });
        errosMandados.push(JSON.parse(init.body)); return Response.json({ ok: true });
      }
      if (url.pathname === '/api/busca/indexar') { enviosDaBusca.push(JSON.parse(init.body)); return Response.json({ ok: true, marcadas: 0, escondidas: 0 }); }
      const cap = url.pathname === `/galeria/${SLUG}` ? '' : url.pathname.replace(`/galeria/${SLUG}/`, '');
      const p = paginas[cap];
      if (typeof p === 'number') return new Response(`erro em ${url.href}`, { status: p });
      return new Response(p === undefined ? 'nao ha' : p, { status: p === undefined ? 404 : 200 });
    }
    if (url.host === 'lh3.googleusercontent.com') {
      const id = url.pathname.replace('/d/', '').split('=')[0];
      if ((o.miniatura429 || []).includes(id)) return new Response('x', { status: 429 });
      return new Response(`BYTES-${id}`);
    }
    if (url.host.startsWith('rekognition.')) {
      const op = init.headers['X-Amz-Target'].split('.')[1];
      const corpo = JSON.parse(init.body);
      aws.push({ op, corpo });
      if (op === 'CreateCollection') return new Response(JSON.stringify({ __type: 'ResourceAlreadyExistsException', message: `The collection id: fotos-${SLUG} already exists` }), { status: 400 });
      if (op === 'ListFaces') return Response.json({ Faces: Object.entries(o.indexadas || {}).flatMap(([ext, ids]) => ids.map(FaceId => ({ FaceId, ExternalImageId: ext }))) });
      if (op === 'IndexFaces') {
        const id = String(corpo.ExternalImageId).split(':')[1];
        if ((o.imagemInvalida || []).includes(id)) return new Response(JSON.stringify({ __type: 'InvalidImageFormatException', message: `Request has invalid image format in collection fotos-${SLUG}` }), { status: 400 });
        return Response.json({ FaceRecords: (o.semRosto || []).includes(id) ? [] : [{ Face: { FaceId: `face-${id}` } }] });
      }
      if (op === 'DeleteFaces') return Response.json({ DeletedFaces: corpo.FaceIds });
      return Response.json({});
    }
    return new Response('nao esperado', { status: 599 });
  });
  vi.stubGlobal('fetch', f);
  return { aws, estadosGravados, enviosDaBusca, errosMandados, estadoAtual: () => estado, ops: (/** @type {string} */ op) => aws.filter(c => c.op === op) };
}

/** @type {string[]} */
let log;
beforeEach(() => {
  log = [];
  for (const nivel of /** @type {const} */ (['log', 'warn', 'error', 'info'])) vi.spyOn(console, nivel).mockImplementation((...a) => { log.push(a.map(String).join(' ')); });
  vi.stubEnv('ROSTO_PASSO_MS', '0');
  vi.stubEnv('ROSTO_SLUGS', SLUG);
  vi.stubEnv('ROSTO_SITE', SITE);
  vi.stubEnv('ROSTO_INDEXADOR_TOKEN', TOKEN);
  vi.stubEnv('AWS_ACCESS_KEY_ID', 'AKIDTESTE');
  vi.stubEnv('AWS_SECRET_ACCESS_KEY', 'segredo');
  vi.stubEnv('GITHUB_ACTIONS', 'true');
});
afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); vi.restoreAllMocks(); });

async function indexador() {
  vi.resetModules();
  return import('../scripts/rosto-indexa.mjs');
}
const semSegredo = (/** @type {string} */ texto) => { for (const s of SEGREDOS) expect(texto, `o log não pode levar "${s}"`).not.toContain(s); };

describe('1. o log é público: só contagens', () => {
  it('uma execução inteira, com falhas, não imprime álbum, evento, foto nem coleção', async () => {
    const m = mundo({ miniatura429: [F(2)], imagemInvalida: [F(3)], semRosto: [F(4)] });
    await (await indexador()).principal();
    const texto = log.join('\n');
    semSegredo(texto);
    // O que o dono precisa saber continua lá, em números.
    expect(texto).toContain('álbum 1 de 1: 4 fotos em 2 eventos.');
    expect(texto).toContain('4 fotos processadas, 1 rostos indexados, 2 falhas.');
    expect(texto).toMatch(/falhas por tipo: (miniatura HTTP 429 × 1, AWS InvalidImageFormatException × 1|AWS InvalidImageFormatException × 1, miniatura HTTP 429 × 1)\./);
    expect(m.ops('IndexFaces').length).toBe(3);
  });

  it('quando o indexador para, o erro que sai não leva o endereço da página', async () => {
    mundo({ paginas: { '': 500 } });
    const { principal, tipoDoErro } = await indexador();
    const erro = await principal().then(() => null, e => e);
    expect(erro).toBeInstanceOf(Error);
    expect(tipoDoErro(erro)).toBe('página do álbum HTTP 500');
    semSegredo(`${erro.message}\n${tipoDoErro(erro)}\n${log.join('\n')}`);
  });

  it('página de um evento fora do ar: o rótulo não diz qual', async () => {
    mundo({ paginas: { '': paginaDoIndice([CAP_A]), [CAP_A]: 503 } });
    const { principal, tipoDoErro } = await indexador();
    const erro = await principal().then(() => null, e => e);
    expect(tipoDoErro(erro)).toBe('página de um evento HTTP 503');
    semSegredo(String(erro.message));
  });

  it('tipoDoErro: da AWS, só o tipo (a mensagem leva o nome da coleção); de outros erros, só o nome', async () => {
    const { tipoDoErro } = await indexador();
    expect(tipoDoErro(new ErroAws('ResourceNotFoundException', 400, `The collection id: fotos-${SLUG} does not exist`))).toBe('AWS ResourceNotFoundException');
    expect(tipoDoErro(new TypeError(`fetch failed: ${SITE}/galeria/${SLUG}/${CAP_A}`))).toBe('TypeError');
    expect(tipoDoErro(`texto solto com ${F(1)}`)).toBe('erro');
    semSegredo(tipoDoErro(new ErroAws(`tipo/${SLUG}`, 400, 'x')));
  });

  it('o código do script não tem console.* com o slug, a chave da foto ou a mensagem do erro', async () => {
    const fonte = await readFile(new URL('../scripts/rosto-indexa.mjs', import.meta.url), 'utf8');
    const linhas = fonte.split('\n').filter(l => /console\.(log|warn|error|info)\(/.test(l));
    expect(linhas.length).toBeGreaterThan(5);
    for (const l of linhas) expect(l, l.trim()).not.toMatch(/\$\{(slug|k|id|cap|col|url|base|site)\b|\.message|\[\$\{slug\}\]/);
  });
});

describe('2. o estado mora no site, com o token', () => {
  it('primeira execução: lê o estado, processa, e grava o que viu (inclusive a foto sem rosto)', async () => {
    const m = mundo({ semRosto: [F(4)] });
    await (await indexador()).principal();
    const final = m.estadosGravados.at(-1);
    expect(final.slug).toBe(SLUG);
    expect([...final.vistas].sort()).toEqual([`${CAP_A}:${F(1)}`, `${CAP_A}:${F(2)}`, `${CAP_B}:${F(3)}`, `${CAP_B}:${F(4)}`]);
    expect([...final.descritas].sort()).toEqual([F(1), F(2), F(3), F(4)]);
    expect(final.qualidade).toBe('NONE');
  });

  it('segunda execução, nada novo: nenhuma chamada paga e nenhuma gravação', async () => {
    const vistas = [`${CAP_A}:${F(1)}`, `${CAP_A}:${F(2)}`, `${CAP_B}:${F(3)}`, `${CAP_B}:${F(4)}`];
    const m = mundo({ estado: { vistas, descritas: [F(1), F(2), F(3), F(4)], qualidade: 'NONE', origem: 'guardado' }, indexadas: { [`${CAP_A}:${F(1)}`]: ['f1'] } });
    await (await indexador()).principal();
    expect(m.aws.map(c => c.op).filter(op => !['CreateCollection', 'ListFaces'].includes(op))).toEqual([]);
    expect(m.estadosGravados).toEqual([]);
  });

  it('sem conseguir ler o estado, para — não indexa "do zero" (pagaria de novo por cada foto)', async () => {
    const m = mundo({ estadoHttp: 503 });
    const { principal, tipoDoErro } = await indexador();
    const erro = await principal().then(() => null, e => e);
    expect(tipoDoErro(erro)).toBe('leitura do estado HTTP 503');
    expect(m.ops('IndexFaces')).toEqual([]);
  });

  it('no Actions, sem o token, não roda: o estado não teria onde ficar', async () => {
    vi.stubEnv('ROSTO_INDEXADOR_TOKEN', '');
    const m = mundo();
    const { principal, tipoDoErro } = await indexador();
    const erro = await principal().then(() => null, e => e);
    expect(tipoDoErro(erro)).toContain('falta ROSTO_INDEXADOR_TOKEN');
    expect(m.aws).toEqual([]);
  });

  it('o workflow não usa mais o cache do Actions nem o arquivo de estado', async () => {
    const yml = await readFile(new URL('../.github/workflows/rosto.yml', import.meta.url), 'utf8');
    const passos = yml.split('\n').filter(l => !l.trim().startsWith('#')).join('\n');
    expect(passos).not.toMatch(/actions\/cache/);
    expect(passos).not.toContain('.rosto-estado.json');
    // E só roda agendado ou à mão: nunca num pull request.
    expect(passos).not.toMatch(/pull_request/);
  });
});

describe('3. perder o estado ou ler o álbum pela metade não apaga o índice', () => {
  const TODAS = { [`${CAP_A}:${F(1)}`]: ['f1'], [`${CAP_A}:${F(2)}`]: ['f2'], [`${CAP_B}:${F(3)}`]: ['f3'], [`${CAP_B}:${F(4)}`]: ['f4'] };
  const ESTADO = { vistas: Object.keys(TODAS), descritas: [F(1), F(2), F(3), F(4)], qualidade: 'NONE', origem: 'guardado' };

  it('estado sem a marca do filtro de qualidade (perdido, ou vindo do banco): adota a de hoje e NÃO apaga os rostos', async () => {
    const m = mundo({ estado: { ...ESTADO, qualidade: '', origem: 'banco' }, indexadas: TODAS });
    await (await indexador()).principal();
    expect(m.ops('DeleteFaces')).toEqual([]);
    expect(m.ops('IndexFaces')).toEqual([]);
    expect(m.estadosGravados.at(-1).qualidade).toBe('NONE');
  });

  it('marca guardada e DIFERENTE: aí sim, apaga uma vez e indexa de novo', async () => {
    const m = mundo({ estado: { ...ESTADO, qualidade: 'LOW' }, indexadas: TODAS });
    await (await indexador()).principal();
    expect(m.ops('DeleteFaces')).toHaveLength(1);
    expect(m.ops('DeleteFaces')[0].corpo.FaceIds.sort()).toEqual(['f1', 'f2', 'f3', 'f4']);
    expect(m.ops('IndexFaces')).toHaveLength(4);
  });

  it('álbum lido inteiro e uma foto saiu: o rosto dela é apagado e ela sai da busca', async () => {
    const m = mundo({
      estado: ESTADO, indexadas: TODAS,
      paginas: { '': paginaDoIndice([CAP_A, CAP_B]), [CAP_A]: paginaDoEvento(CAP_A, [F(1), F(2)]), [CAP_B]: paginaDoEvento(CAP_B, [F(3)]) },
    });
    await (await indexador()).principal();
    expect(m.ops('DeleteFaces').map(c => c.corpo.FaceIds)).toEqual([['f4']]);
    expect(m.enviosDaBusca.flatMap(e => e.remover)).toEqual([F(4)]);
    expect(m.estadosGravados.at(-1).vistas).not.toContain(`${CAP_B}:${F(4)}`);
  });

  it('uma página veio sem a lista de fotos (o Drive falhou): nada é apagado, e o estado fica como estava', async () => {
    const m = mundo({
      estado: ESTADO, indexadas: TODAS,
      paginas: { '': paginaDoIndice([CAP_A, CAP_B]), [CAP_A]: paginaDoEvento(CAP_A, [F(1), F(2)]), [CAP_B]: '<html>O Google Drive não respondeu agora.</html>' },
    });
    await (await indexador()).principal();
    expect(m.ops('DeleteFaces')).toEqual([]);
    expect(m.enviosDaBusca.flatMap(e => e.remover || [])).toEqual([]);
    expect(m.estadosGravados).toEqual([]);
    expect(log.join('\n')).toContain('leitura incompleta do álbum; nada é apagado nesta execução.');
  });

  it('o álbum veio VAZIO (o índice não listou evento nenhum): nada é apagado', async () => {
    const m = mundo({ estado: ESTADO, indexadas: TODAS, paginas: { '': '<html>Sem eventos por enquanto.</html>' } });
    await (await indexador()).principal();
    expect(m.ops('DeleteFaces')).toEqual([]);
    expect(m.enviosDaBusca.flatMap(e => e.remover || [])).toEqual([]);
    expect(m.estadosGravados).toEqual([]);
  });
});

describe('R1. a mensagem inteira do erro vai ao site, em particular, e nunca ao log', () => {
  it('falhas numa execução: o site recebe tipo, vezes e a 1ª mensagem inteira de cada tipo; o log continua sem segredo', async () => {
    const m = mundo({ miniatura429: [F(2)], imagemInvalida: [F(3)] });
    await (await indexador()).principal();
    semSegredo(log.join('\n'));
    expect(m.errosMandados).toHaveLength(1);
    const [envio] = m.errosMandados;
    expect(envio.slug).toBe(SLUG);
    const porTipo = Object.fromEntries(envio.erros.map((/** @type {any} */ e) => [e.tipo, e]));
    expect(porTipo['AWS InvalidImageFormatException'].vezes).toBe(1);
    // A mensagem que o log não pode levar é justamente a que o dono precisa.
    expect(porTipo['AWS InvalidImageFormatException'].mensagem).toContain(`fotos-${SLUG}`);
    expect(porTipo['miniatura HTTP 429'].vezes).toBe(1);
  });

  it('execução sem falha não manda nada', async () => {
    const m = mundo();
    await (await indexador()).principal();
    expect(m.errosMandados).toHaveLength(0);
  });

  it('mensagemDoErro segue a causa (o "fetch failed" esconde o ECONNRESET)', async () => {
    const { mensagemDoErro } = await indexador();
    const causa = Object.assign(new Error('read ECONNRESET'), { code: 'ECONNRESET' });
    expect(mensagemDoErro(new TypeError('fetch failed', { cause: causa }))).toBe('TypeError: fetch failed ← Error: read ECONNRESET (ECONNRESET)');
    expect(mensagemDoErro('texto solto')).toBe('texto solto');
    expect(mensagemDoErro(new Error('x'.repeat(2000))).length).toBe(600);
  });

  it('o site fora do ar ao mandar os erros não derruba nada e não vaza a mensagem', async () => {
    const { mandaErros } = await indexador();
    vi.stubGlobal('fetch', vi.fn(async () => { throw new TypeError(`fetch failed ${SITE}/galeria/${SLUG}`); }));
    await mandaErros(SITE, SLUG, [{ tipo: 'erro', mensagem: F(1), vezes: 1 }]);
    semSegredo(log.join('\n'));
    expect(log.join('\n')).toContain('Os erros não foram guardados no site: TypeError.');
  });
});

describe('a rota do estado no site (/api/busca/estado)', () => {
  const EVENTO = { id: '1', slug: SLUG, title: 'Álbum', accessType: 'public', galeriaCapitulos: true, comingSoon: true, visible: false, driveUrl: 'https://drive.google.com/drive/folders/RAIZ_PASTA_0001' };
  function kv() {
    const store = new Map([['events', JSON.stringify([EVENTO])]]);
    return { _store: store, async get(/** @type {string} */ k) { return store.has(k) ? store.get(k) : null; }, async put(/** @type {string} */ k, /** @type {string} */ v) { store.set(k, v); },
      async delete(/** @type {string} */ k) { store.delete(k); }, async list() { return { keys: [], list_complete: true, cursor: null }; } };
  }
  /** @type {any} */ let env;
  /** @type {any} */ let worker;
  beforeEach(async () => {
    vi.resetModules();
    worker = (await import('../src/index.js')).default;
    env = withDurableObjects({ FOTOS: kv(), CONSENT_DB: d1Sqlite(), ROSTO_INDEXADOR_TOKEN: TOKEN });
  });
  /** @param {string} path @param {{ token?: string, body?: any }} [o] */
  const pede = (path, o = {}) => worker.fetch(new Request(`https://fotos.lucafchala.com${path}`, {
    method: o.body ? 'POST' : 'GET',
    headers: { ...(o.token ? { 'X-Rosto-Indexador': o.token } : {}), ...(o.body ? { 'Content-Type': 'application/json' } : {}) },
    ...(o.body ? { body: JSON.stringify(o.body) } : {}),
  }), env, { waitUntil() {} });

  it('sem o token (ou com outro): o 404 de rota inexistente, para ler e para gravar', async () => {
    expect((await pede(`/api/busca/estado?slug=${SLUG}`)).status).toBe(404);
    expect((await pede(`/api/busca/estado?slug=${SLUG}`, { token: 'x'.repeat(40) })).status).toBe(404);
    expect((await pede('/api/busca/estado', { body: { slug: SLUG, vistas: [] } })).status).toBe(404);
    expect(env.FOTOS._store.has(`rosto-estado:${SLUG}`)).toBe(false);
  });

  it('grava e devolve; lixo não entra', async () => {
    const res = await pede('/api/busca/estado', { token: TOKEN, body: { slug: SLUG, vistas: [`${CAP_A}:${F(1)}`, `:${F(2)}`, 'lixo', 42, `${CAP_A}:${F(1)}`], descritas: [F(1), '../x'], qualidade: 'NONE', intruso: 'x' } });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, vistas: 2, descritas: 1 });
    const lido = await (await pede(`/api/busca/estado?slug=${SLUG}`, { token: TOKEN })).json();
    expect(lido).toEqual({ vistas: [`${CAP_A}:${F(1)}`, `:${F(2)}`], descritas: [F(1)], qualidade: 'NONE', geracao: 0, limpar: false, dia: '', noDia: 0, quentes: [], quentesLarguras: '', origem: 'guardado', geracaoPedida: 0, rosto: false });
  });

  it('sem estado guardado, monta do que o banco da busca já sabe — a troca não reprocessa o álbum', async () => {
    expect((await (await pede(`/api/busca/estado?slug=${SLUG}`, { token: TOKEN })).json()).origem).toBe('vazio');
    await pede('/api/busca/indexar', { token: TOKEN, body: { slug: SLUG, itens: [{ foto: F(1), cap: CAP_A, texto: 'x' }, { foto: F(2), cap: '', texto: 'y' }] } });
    const lido = await (await pede(`/api/busca/estado?slug=${SLUG}`, { token: TOKEN })).json();
    expect(lido.origem).toBe('banco');
    expect(lido.vistas.sort()).toEqual([`:${F(2)}`, `${CAP_A}:${F(1)}`].sort());
    expect(lido.descritas.sort()).toEqual([F(1), F(2)]);
    expect(lido.qualidade).toBe('');
  });

  it('projeto que não existe: 404; slug inválido: 400', async () => {
    expect((await pede('/api/busca/estado?slug=nao-existe', { token: TOKEN })).status).toBe(404);
    expect((await pede('/api/busca/estado?slug=Com%20Espaco', { token: TOKEN })).status).toBe(400);
  });

  it('/api/busca/erro: sem o token, 404 e nada gravado; com o token, guarda limpo e o mais novo primeiro', async () => {
    expect((await pede('/api/busca/erro', { body: { slug: SLUG, erros: [{ tipo: 'x', mensagem: 'y' }] } })).status).toBe(404);
    expect((await pede('/api/busca/erro', { token: 'x'.repeat(40), body: { slug: SLUG, erros: [{ tipo: 'x', mensagem: 'y' }] } })).status).toBe(404);
    expect(env.FOTOS._store.has('rosto-erros')).toBe(false);
    expect((await pede('/api/busca/erro', { token: TOKEN, body: { slug: 'Com Espaco', erros: [] } })).status).toBe(400);
    const r1 = await pede('/api/busca/erro', { token: TOKEN, body: { slug: SLUG, erros: [{ tipo: 'AWS X', mensagem: 'linha 1\nlinha 2', vezes: 3 }, 'lixo', {}] } });
    expect(await r1.json()).toEqual({ ok: true, gravados: 1 });
    await pede('/api/busca/erro', { token: TOKEN, body: { erros: [{ tipo: 'TypeError', mensagem: 'fetch failed' }] } });
    const guardados = await leErrosDoIndexador(env);
    expect(guardados.map((/** @type {any} */ e) => [e.slug, e.tipo, e.mensagem, e.vezes])).toEqual([['', 'TypeError', 'fetch failed', 1], [SLUG, 'AWS X', 'linha 1 linha 2', 3]]);
  });

  it('errosDoIndexadorLimpos: no máximo 10 por envio, mensagem cortada em 600', () => {
    const muitos = Array.from({ length: 15 }, (_, i) => ({ tipo: `t${i}`, mensagem: 'm'.repeat(1000), vezes: -2 }));
    const limpos = errosDoIndexadorLimpos(muitos, SLUG, '2026-11-18T00:00:00.000Z');
    expect(limpos).toHaveLength(10);
    expect(limpos[0]).toEqual({ quando: '2026-11-18T00:00:00.000Z', slug: SLUG, tipo: 't0', mensagem: 'm'.repeat(600), vezes: 1 });
  });

  it('estadoDoIndexadorLimpo: forma, repetição e teto', () => {
    expect(estadoDoIndexadorLimpo(null)).toEqual({ vistas: [], descritas: [], qualidade: '', geracao: 0, limpar: false, dia: '', noDia: 0, quentes: [], quentesLarguras: '' });
    expect(estadoDoIndexadorLimpo({ vistas: 'x', descritas: {}, qualidade: 'none', geracao: -3, limpar: 'sim', dia: 'ontem', noDia: -1 })).toEqual({ vistas: [], descritas: [], qualidade: '', geracao: 0, limpar: false, dia: '', noDia: 0, quentes: [], quentesLarguras: '' });
    const muitas = Array.from({ length: 20050 }, (_, i) => `:FOTO_${String(i).padStart(8, '0')}`);
    expect(estadoDoIndexadorLimpo({ vistas: muitas }).vistas).toHaveLength(20000);
  });
});
