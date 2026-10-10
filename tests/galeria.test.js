// Galeria própria — PRÉVIA (#235). O que estes testes prendem:
//
//  1. SÓ o dono logado vê. Para qualquer outra pessoa, página e downloads são
//     o mesmo 404 de uma rota inexistente — e sem gastar leitura de KV.
//  2. A chave da Drive API nunca sai do servidor.
//  3. O proxy de download só entrega arquivo que está NA PASTA do projeto —
//     sem isso, o Worker viraria um proxy aberto para qualquer arquivo
//     público do Drive.
//  4. A listagem: link da pasta, subpastas como seções, paginação, rotação,
//     ordem natural, cache, limites do plano gratuito e o conserto certo
//     para cada erro do Google.

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import worker, { larguraRedes, nomeDownload, contentDisposition } from '../src/index.js';
import { pastaDoDrive, listaPasta, limpaCacheDrive, DriveError, achaFoto } from '../src/drive.js';
import { saveEvents, validateSlug } from '../src/utils.js';
import { VENDOR } from '../src/content/vendor.js';
import { dashboardHTML } from '../src/ui/dashboard.js';
import { GALERIA_MAX_PASTAS, GALERIA_LADO_REDES } from '../src/config.js';
import { withDurableObjects } from './helpers/do.js';
import { fakeCaches } from './helpers/caches.js';
import { contaScriptTags, foraDosScripts } from './helpers/paginas.js';
import { galeriaHTML } from '../src/ui/galeria.js';

const SITE = 'https://fotos.lucafchala.com';
const TOKEN = 'e'.repeat(64);
const CHAVE = 'AIzaChaveDeTesteQueNaoPodeVazar123';
const RAIZ = 'RAIZ_PASTA_0001';
const SUB = 'SUB_PASTA_00001';

function fakeKV(inicial = {}) {
  const store = new Map(Object.entries(inicial));
  const leituras = [];
  return {
    async get(k) { leituras.push(k); return store.has(k) ? store.get(k) : null; },
    async put(k, v) { store.set(k, v); },
    async delete(k) { store.delete(k); },
    async list() { return { keys: [], list_complete: true, cursor: null }; },
    _store: store,
    _leituras: leituras,
  };
}

const EVENTOS = [
  { id: '1', slug: 'formatura', title: 'Formatura 2026', accessType: 'public', driveUrl: `https://drive.google.com/drive/folders/${RAIZ}?usp=sharing` },
  { id: '2', slug: 'so-arquivo', title: 'Só arquivo', accessType: 'public', driveUrl: 'https://drive.google.com/file/d/ARQUIVO_SOLTO_1/view' },
];

// A pasta de mentira: raiz com fotos (uma girada, uma sem dimensões), um
// vídeo, um PDF e uma subpasta com duas páginas de resultado.
const ARVORE = {
  [RAIZ]: [[
    { id: 'FOTO_DEZ_00010', name: '010.jpg', mimeType: 'image/jpeg', size: '18000000', imageMediaMetadata: { width: 6000, height: 4000, rotation: 0 } },
    { id: 'FOTO_DOIS_0002', name: '002.jpg', mimeType: 'image/jpeg', size: '17000000', imageMediaMetadata: { width: 6000, height: 4000, rotation: 1 } },
    { id: 'FOTO_UM_000001', name: '1.HEIC', mimeType: 'image/heic', size: '3000000', resourceKey: 'rkFoto' },
    { id: 'VIDEO_0000001', name: 'v.mp4', mimeType: 'video/mp4' },
    { id: 'PDF_000000001', name: 'contrato.pdf', mimeType: 'application/pdf' },
    { id: SUB, name: 'Festa', mimeType: 'application/vnd.google-apps.folder', resourceKey: 'rkSub' },
  ]],
  [SUB]: [
    [{ id: 'FOTO_BE_00000B', name: 'b.jpg', mimeType: 'image/jpeg', size: '1000', imageMediaMetadata: { width: 3000, height: 2000 } }],
    [{ id: 'FOTO_A_00000A', name: 'a.jpg', mimeType: 'image/jpeg', size: '1000', imageMediaMetadata: { width: 3000, height: 2000 } }],
  ],
};

/** @type {{ url: string, headers: Record<string, string> }[]} */
let chamadas;
/** @type {(url: URL, headers: Record<string,string>) => Response | Promise<Response> | null} */
let rotaExtra;

function stubFetch() {
  chamadas = [];
  rotaExtra = () => null;
  vi.stubGlobal('fetch', vi.fn(async (input, init = {}) => {
    const url = new URL(typeof input === 'string' ? input : input.url);
    const headers = Object.fromEntries(Object.entries(init.headers || {}));
    chamadas.push({ url: url.toString(), headers });
    const extra = await rotaExtra(url, headers);
    if (extra) return extra;
    if (url.host === 'www.googleapis.com' && url.pathname === '/drive/v3/files') {
      const id = (url.searchParams.get('q') || '').match(/^'([^']+)' in parents/)?.[1];
      const paginas = ARVORE[id];
      if (!paginas) return Response.json({ error: { code: 404, message: 'File not found', errors: [{ reason: 'notFound' }] } }, { status: 404 });
      const n = Number(url.searchParams.get('pageToken') || 0);
      return Response.json({ files: paginas[n], ...(n + 1 < paginas.length ? { nextPageToken: String(n + 1) } : {}) });
    }
    if (url.host === 'lh3.googleusercontent.com') {
      return new Response('JPEGBYTES', { headers: { 'Content-Type': 'image/jpeg', 'Content-Length': '9' } });
    }
    if (url.host === 'www.googleapis.com' && url.pathname.startsWith('/drive/v3/files/')) {
      return new Response('ORIGINAL', { headers: { 'Content-Type': 'image/jpeg', 'Content-Length': '8' } });
    }
    return new Response('nao esperado', { status: 599 });
  }));
}

let env;
beforeEach(async () => {
  limpaCacheDrive();
  stubFetch();
  env = withDurableObjects({
    FOTOS: fakeKV({ [`admin_session:${TOKEN}`]: JSON.stringify({ createdAt: Date.now() }) }),
    GOOGLE_DRIVE_API_KEY: CHAVE,
  });
  await saveEvents(env, structuredClone(EVENTOS));
  chamadas.length = 0;
});
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });

const ctx = { waitUntil() {} };
function get(path, { logado = true, accept = '*/*' } = {}) {
  return worker.fetch(new Request(SITE + path, {
    headers: { Accept: accept, ...(logado ? { Cookie: `__Host-session=${TOKEN}` } : {}) },
  }), env, ctx);
}
const chamadasDrive = () => chamadas.filter(c => c.url.startsWith('https://www.googleapis.com/drive/v3/files?'));

// ---------------------------------------------------------------------------
describe('pastaDoDrive — o link cadastrado no projeto', () => {
  it('reconhece os formatos de link de pasta', () => {
    expect(pastaDoDrive(`https://drive.google.com/drive/folders/${RAIZ}?usp=sharing`)).toEqual({ id: RAIZ, resourceKey: '' });
    expect(pastaDoDrive(`https://drive.google.com/drive/u/1/folders/${RAIZ}`)).toEqual({ id: RAIZ, resourceKey: '' });
    expect(pastaDoDrive(`https://drive.google.com/open?id=${RAIZ}`)).toEqual({ id: RAIZ, resourceKey: '' });
    expect(pastaDoDrive(`https://drive.google.com/drive/folders/${RAIZ}?resourcekey=0-abcDEF_12`)).toEqual({ id: RAIZ, resourceKey: '0-abcDEF_12' });
  });

  it('recusa o que não é pasta do Drive — host comparado de verdade, não por substring', () => {
    for (const ruim of [
      `https://drive.google.com.exemplo.com/drive/folders/${RAIZ}`,
      `http://drive.google.com/drive/folders/${RAIZ}`,
      'https://drive.google.com/file/d/ARQUIVO_SOLTO_1/view',
      "https://drive.google.com/drive/folders/abc'or'1234567",
      'https://photos.google.com/share/xyz',
      '', null, 42,
    ]) expect(pastaDoDrive(ruim), String(ruim)).toBeNull();
  });
});

// ---------------------------------------------------------------------------
describe('listaPasta — a pasta lida pela Drive API', () => {
  it('sem chave, nem tenta: erro com o código do conserto', async () => {
    await expect(listaPasta({}, { id: RAIZ, resourceKey: '' })).rejects.toMatchObject({ codigo: 'chave-ausente' });
    expect(chamadas).toHaveLength(0);
  });

  it('raiz primeiro, subpasta vira seção; ordem natural; rotação aplicada; vídeo e PDF só contados', async () => {
    const d = await listaPasta(env, { id: RAIZ, resourceKey: '' });
    expect(d.secoes.map(s => s.nome)).toEqual(['', 'Festa']);
    // "1" antes de "002" antes de "010": a numeração do fotógrafo.
    expect(d.secoes[0].fotos.map(f => f[3])).toEqual(['1.HEIC', '002.jpg', '010.jpg']);
    const dois = achaFoto(d, 'FOTO_DOIS_0002');
    expect([dois[1], dois[2]], 'rotation 1 = 90°: a foto exibida fica em pé').toEqual([4000, 6000]);
    expect(achaFoto(d, 'FOTO_UM_000001').slice(1, 3), 'sem dimensões no Drive').toEqual([0, 0]);
    expect(achaFoto(d, 'FOTO_DEZ_00010')[4]).toBe(18000000);
    // Duas páginas de resultado na subpasta, as duas lidas.
    expect(d.secoes[1].fotos.map(f => f[3])).toEqual(['a.jpg', 'b.jpg']);
    expect(d.total).toBe(5);
    expect(d.videos).toBe(1);
    expect(d.outros).toBe(1);
    expect(d.truncada).toBe(false);
    expect(d.rk).toEqual({ FOTO_UM_000001: 'rkFoto' });
  });

  it('resource key vai no cabeçalho da pasta e da subpasta; só os campos que a galeria usa', async () => {
    await listaPasta(env, { id: RAIZ, resourceKey: 'rkRaiz' });
    const daPasta = id => chamadasDrive().find(c => (new URL(c.url).searchParams.get('q') || '').startsWith(`'${id}'`));
    const raiz = daPasta(RAIZ);
    const sub = daPasta(SUB);
    expect(raiz.headers['X-Goog-Drive-Resource-Keys']).toBe(`${RAIZ}/rkRaiz`);
    expect(sub.headers['X-Goog-Drive-Resource-Keys']).toBe(`${SUB}/rkSub`);
    const u = new URL(raiz.url);
    expect(u.searchParams.get('key')).toBe(CHAVE);
    expect(u.searchParams.get('fields')).not.toMatch(/thumbnailLink|webContentLink|owners/);
  });

  it('guarda a lista: a segunda leitura não chama o Google; "atualizar" relê', async () => {
    await listaPasta(env, { id: RAIZ, resourceKey: '' });
    const n = chamadas.length;
    await listaPasta(env, { id: RAIZ, resourceKey: '' });
    expect(chamadas.length).toBe(n);
    await listaPasta(env, { id: RAIZ, resourceKey: '' }, { atualizar: true });
    expect(chamadas.length).toBeGreaterThan(n);
  });

  it('isolate frio: a lista vem da Cache API, sem chamar o Google (e sem gravar no KV)', async () => {
    const caches = fakeCaches();
    vi.stubGlobal('caches', caches);
    const primeira = await listaPasta(env, { id: RAIZ, resourceKey: '' });
    expect([...caches._store.keys()]).toEqual([`https://fotos.invalid/__galeria/${RAIZ}`]);
    limpaCacheDrive(); // isolate novo: a memória some, a Cache API do data center fica
    const n = chamadas.length;
    const segunda = await listaPasta(env, { id: RAIZ, resourceKey: '' });
    expect(chamadas.length).toBe(n);
    expect(segunda).toEqual(primeira);
  });

  it('Cache API com defeito não derruba a galeria: lê do Google e segue', async () => {
    const erro = vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.stubGlobal('caches', { default: {
      async match() { throw new Error('cache fora'); },
      async put() { throw new Error('cache fora'); },
    } });
    const dados = await listaPasta(env, { id: RAIZ, resourceKey: '' });
    expect(dados.total).toBeGreaterThan(0);
    expect(erro).toHaveBeenCalledTimes(2); // a leitura e a escrita, cada uma registrada
  });

  it('pasta enorme não estoura o plano gratuito: lista parcial, marcada, sem erro', async () => {
    const muitas = Array.from({ length: GALERIA_MAX_PASTAS + 10 }, (_, i) => ({
      id: `PASTA_MUITAS_${String(i).padStart(4, '0')}`, name: `P${i}`, mimeType: 'application/vnd.google-apps.folder',
    }));
    rotaExtra = url => {
      const q = url.searchParams.get('q') || '';
      if (q.includes(`'${RAIZ}'`)) return Response.json({ files: muitas });
      if (q.includes('PASTA_MUITAS_')) return Response.json({ files: [{ id: `FOTO_${q.slice(14, 26)}`, name: 'x.jpg', mimeType: 'image/jpeg' }] });
      return null;
    };
    const d = await listaPasta(env, { id: RAIZ, resourceKey: '' });
    expect(d.truncada).toBe(true);
    expect(chamadasDrive().length).toBeLessThanOrEqual(30);
  });

  it.each([
    [400, { error: { code: 400, message: 'API key not valid. Please pass a valid API key.', errors: [{ reason: 'badRequest' }], details: [{ reason: 'API_KEY_INVALID' }] } }, 'chave-invalida'],
    [403, { error: { code: 403, errors: [{ reason: 'accessNotConfigured' }], details: [{ reason: 'SERVICE_DISABLED' }] } }, 'api-desligada'],
    [403, { error: { code: 403, details: [{ reason: 'API_KEY_HTTP_REFERRER_BLOCKED' }] } }, 'chave-restrita'],
    [404, { error: { code: 404, errors: [{ reason: 'notFound' }] } }, 'pasta-inacessivel'],
    [429, { error: { code: 429, errors: [{ reason: 'rateLimitExceeded' }] } }, 'limite'],
    [500, { error: { code: 500 } }, 'falha'],
  ])('HTTP %i do Google vira o conserto certo (%s)', async (status, corpo, codigo) => {
    rotaExtra = () => Response.json(corpo, { status });
    const err = await listaPasta(env, { id: RAIZ, resourceKey: '' }).catch(e => e);
    expect(err).toBeInstanceOf(DriveError);
    expect(err.codigo).toBe(codigo);
    expect(err.message).not.toContain(CHAVE);
  });

  it('rede fora: erro "falha", sem a URL (que leva a chave) na mensagem', async () => {
    rotaExtra = () => { throw new TypeError(`fetch failed for https://www.googleapis.com/?key=${CHAVE}`); };
    const err = await listaPasta(env, { id: RAIZ, resourceKey: '' }).catch(e => e);
    expect(err.codigo).toBe('falha');
    expect(err.message).not.toContain(CHAVE);
  });
});

// ---------------------------------------------------------------------------
describe('/galeria/<slug> — só o dono', () => {
  it('sem sessão: o 404 de rota inexistente, sem chamar o Google nem ler sessão no KV', async () => {
    const res = await get('/galeria/formatura', { logado: false });
    expect(res.status).toBe(404);
    expect(await res.text()).toContain('Página não encontrada');
    expect(chamadas).toHaveLength(0);
    expect(env.FOTOS._leituras.some(k => k.startsWith('admin_session:'))).toBe(false);
  });

  it('cookie de sessão inválido também é 404', async () => {
    const res = await worker.fetch(new Request(SITE + '/galeria/formatura', { headers: { Cookie: `__Host-session=${'f'.repeat(64)}` } }), env, ctx);
    expect(res.status).toBe(404);
    expect(chamadas).toHaveLength(0);
  });

  it('logado: a galeria, fora de índice e de cache, sem a chave na página', async () => {
    const res = await get('/galeria/formatura');
    expect(res.status).toBe(200);
    expect(res.headers.get('X-Robots-Tag')).toMatch(/noindex/);
    expect(res.headers.get('Cache-Control')).toMatch(/no-store/);
    const html = await res.text();
    expect(html).not.toContain(CHAVE);
    expect(html).not.toContain('rkFoto'); // resource key é do servidor
    expect(html).toContain('FOTO_DEZ_00010');
    expect(html).toContain('Formatura 2026');
    expect(html).toContain('Prévia');
    for (const v of VENDOR) expect(html).toContain(v.path);
    expect(html).toMatch(/1 vídeo e 1 outro arquivo/);
  });

  it('logado, projeto inexistente: 404', async () => {
    expect((await get('/galeria/nao-existe')).status).toBe(404);
  });

  it('projeto cujo link não é de pasta: a página explica o conserto', async () => {
    const res = await get('/galeria/so-arquivo');
    expect(res.status).toBe(200);
    expect(await res.text()).toMatch(/não tem uma pasta do Drive reconhecível/);
    expect(chamadas).toHaveLength(0);
  });

  it('sem a chave configurada: a página mostra o passo a passo', async () => {
    delete env.GOOGLE_DRIVE_API_KEY;
    const html = await (await get('/galeria/formatura')).text();
    expect(html).toMatch(/Falta conectar o site ao Google Drive/);
    expect(html).toContain('GOOGLE_DRIVE_API_KEY');
  });

  it('"Atualizar lista" relê a pasta e volta para o endereço limpo', async () => {
    await get('/galeria/formatura');
    const antes = chamadas.length;
    const res = await get('/galeria/formatura?atualizar=1');
    expect(res.status).toBe(302);
    expect(res.headers.get('Location')).toBe('/galeria/formatura');
    expect(chamadas.length).toBeGreaterThan(antes);
  });

  it('galeria e vendor são nomes reservados: nenhum projeto pode ocupá-los', () => {
    for (const s of ['galeria', 'vendor', 'fonts']) expect(validateSlug(s), s).toBe(false);
  });
});

// ---------------------------------------------------------------------------
describe('/galeria/<slug>/baixar/<id> — downloads', () => {
  it('sem sessão: 404, sem chamar o Google', async () => {
    const res = await get('/galeria/formatura/baixar/FOTO_DEZ_00010?v=max', { logado: false });
    expect(res.status).toBe(404);
    expect(chamadas).toHaveLength(0);
  });

  it('arquivo que NÃO está na pasta do projeto: 404, e nada é buscado (não é proxy aberto)', async () => {
    const res = await get('/galeria/formatura/baixar/ARQUIVO_DE_OUTRA_PESSOA?v=max');
    expect(res.status).toBe(404);
    expect(chamadas.some(c => c.url.includes('ARQUIVO_DE_OUTRA_PESSOA'))).toBe(false);
  });

  it('"para redes": lh3 com o lado maior em GALERIA_LADO_REDES, nome com o slug e -redes', async () => {
    const res = await get('/galeria/formatura/baixar/FOTO_DEZ_00010?v=redes');
    expect(res.status).toBe(200);
    const up = chamadas.find(c => c.url.startsWith('https://lh3.googleusercontent.com/'));
    expect(up.url).toBe(`https://lh3.googleusercontent.com/d/FOTO_DEZ_00010=w${GALERIA_LADO_REDES}`);
    expect(res.headers.get('Content-Disposition')).toContain('filename="formatura-010-redes.jpg"');
    expect(decodeURIComponent(res.headers.get('X-Nome-Arquivo'))).toBe('formatura-010-redes.jpg');
    expect(res.headers.get('Content-Type')).toBe('image/jpeg');
    expect(await res.text()).toBe('JPEGBYTES');
  });

  it('"para redes" de foto em pé: a largura sai proporcional (o lado maior é a altura)', async () => {
    await get('/galeria/formatura/baixar/FOTO_DOIS_0002?v=redes');
    const up = chamadas.find(c => c.url.startsWith('https://lh3.googleusercontent.com/'));
    expect(up.url).toMatch(new RegExp(`=w${Math.round(GALERIA_LADO_REDES * 4000 / 6000)}$`));
  });

  it('"tamanho máximo": o original pela Drive API, com a chave SÓ na chamada do servidor', async () => {
    const res = await get('/galeria/formatura/baixar/FOTO_UM_000001?v=max');
    expect(res.status).toBe(200);
    const up = chamadas.find(c => c.url.includes('/drive/v3/files/FOTO_UM_000001'));
    const u = new URL(up.url);
    expect(u.searchParams.get('alt')).toBe('media');
    expect(u.searchParams.get('key')).toBe(CHAVE);
    expect(up.headers['X-Goog-Drive-Resource-Keys']).toBe('FOTO_UM_000001/rkFoto');
    expect(res.headers.get('Content-Disposition')).toContain('filename="formatura-1.heic"');
    for (const [, v] of res.headers) expect(v).not.toContain(CHAVE);
    expect(await res.text()).toBe('ORIGINAL');
  });

  it('cota de download do Google estourada: erro claro para o script (JSON) e para quem abriu o link (página)', async () => {
    rotaExtra = url => (url.pathname.startsWith('/drive/v3/files/')
      ? Response.json({ error: { code: 403, errors: [{ reason: 'downloadQuotaExceeded' }] } }, { status: 403 })
      : null);
    const json = await get('/galeria/formatura/baixar/FOTO_DEZ_00010?v=max');
    expect(json.status).toBe(502);
    expect((await json.json()).error).toMatch(/limitou downloads desta foto/);
    const pag = await get('/galeria/formatura/baixar/FOTO_DEZ_00010?v=max', { accept: 'text/html' });
    expect(pag.headers.get('Content-Type')).toMatch(/text\/html/);
    expect(await pag.text()).toMatch(/limitou downloads desta foto/);
  });
});

// ---------------------------------------------------------------------------
describe('galeriaHTML — nomes vindos do Drive são dado, não marcação', () => {
  // Nome de arquivo e de subpasta é texto de terceiro (quem tiver acesso de
  // edição à pasta escolhe). Eles viajam na ilha de dados JSON dentro de um
  // <script>: um `</script>` cru ali fecharia o bloco e o resto viraria HTML.
  it('um </script> no nome não fecha a ilha de dados, e o nome volta intacto', () => {
    const arquivo = '</script><script>alert(1)</script>\u2028<!--.jpg';
    const pasta = '</h2><img src=x onerror=alert(1)>';
    const html = galeriaHTML({
      event: { ...EVENTOS[0] },
      listagem: {
        v: 1, pasta: RAIZ, em: '2026-10-10T12:00:00.000Z', truncada: false, total: 1, videos: 0, outros: 0, rk: {},
        secoes: [{ nome: pasta, caminho: pasta, fotos: [['FOTO_AAAAAAAAAA', 10, 10, arquivo, 1]] }],
      },
      erro: null,
      nonce: 'N',
    });
    const { abre, fecha } = contaScriptTags(html);
    expect(abre).toBe(fecha);
    expect(html).not.toContain('<script>alert(1)');
    expect(html).not.toContain('<img src=x');
    const ilha = html.match(/<script type="application\/json" id="g-dados" nonce="N">([\s\S]*?)<\/script>/);
    expect(ilha).not.toBeNull();
    const dados = JSON.parse(/** @type {RegExpMatchArray} */ (ilha)[1]);
    expect(dados.secoes[0].fotos[0][3]).toBe(arquivo);
    expect(dados.secoes[0].nome).toBe(pasta);
  });
});

describe('foraDosScripts — fecha o bloco onde o navegador fecha', () => {
  it('tira o script em todas as formas de fechamento que o tokenizador aceita', () => {
    for (const fecho of ['</script>', '</script >', '</SCRIPT>', '</script\n>', '</script/>', '</script\tfoo>']) {
      expect(foraDosScripts(`a<script>x = 37${fecho}b`), JSON.stringify(fecho)).toBe('ab');
    }
  });

  it('não fecha em `</scripts>`', () => {
    expect(foraDosScripts('a<script>"</scripts>" 37</script>b')).toBe('ab');
  });

  it('devolve o texto de fora como o navegador o mostra — não é sanitizador', () => {
    // `a<scr` e `ipt>b` são TEXTO dos dois lados do bloco, e lado a lado a
    // página mostra "a<script>b". O resultado serve para afirmar sobre o que
    // a página exibe; nunca volta a ser renderizado como HTML.
    expect(foraDosScripts('a<scr<script>x</script>ipt>b')).toBe('a<scr' + 'ipt>b');
  });

  it('bloco sem fechamento leva o resto da página, como no navegador', () => {
    expect(foraDosScripts('a<script>37 e nunca fecha')).toBe('a');
  });
});

describe('galeriaHTML — sem contagem de fotos', () => {
  // TODO.md, "Decidido não fazer": a contagem de fotos (inclusive a automática
  // pela Drive API) foi removida do site por completo, a pedido do dono — as
  // fotos já vêm numeradas. A galeria lê a pasta inteira e teria o número à
  // mão; não o mostra.
  it('o cabeçalho diz de quando é a lista, não quantas fotos há', () => {
    const fotos = Array.from({ length: 37 }, (_, i) => [`FOTO_${String(i).padStart(10, '0')}`, 6000, 4000, `${i + 1}.jpg`, 1]);
    const html = galeriaHTML({
      event: { ...EVENTOS[0] },
      listagem: {
        v: 1, pasta: RAIZ, em: '2026-10-10T12:00:00.000Z', truncada: true, total: 37, videos: 0, outros: 0, rk: {},
        secoes: [{ nome: '', caminho: '', fotos }, { nome: 'Festa', caminho: 'Festa', fotos: [] }],
      },
      erro: null,
      nonce: 'N',
    });
    const semScripts = foraDosScripts(html);
    expect(semScripts).toMatch(/Lista do Drive de 10\/10, 09:00/);
    expect(semScripts).not.toMatch(/\b37\b/);
    expect(semScripts).not.toMatch(/\d+\s+fotos\b/);
  });
});

describe('nomes e tamanhos do download', () => {
  it('larguraRedes: lado maior no teto, nunca acima do original', () => {
    expect(larguraRedes(6000, 4000)).toBe(GALERIA_LADO_REDES);
    expect(larguraRedes(4000, 6000)).toBe(Math.round(GALERIA_LADO_REDES * 4000 / 6000));
    expect(larguraRedes(1200, 800)).toBe(1200);
    expect(larguraRedes(0, 0)).toBe(GALERIA_LADO_REDES);
  });

  it('nomeDownload: slug na frente (sem repetir), caracteres de sistema de arquivo fora, acento mantido', () => {
    expect(nomeDownload('formatura', '010.jpg', 'max', 'image/jpeg')).toBe('formatura-010.jpg');
    expect(nomeDownload('formatura', 'Formatura-001.JPG', 'max', 'image/jpeg')).toBe('Formatura-001.jpg');
    expect(nomeDownload('formatura', 'a/b:c*"d".jpg', 'redes', 'image/jpeg')).toBe('formatura-a-b-c-d--redes.jpg');
    expect(nomeDownload('festa', 'Cerimônia 12.png', 'redes', 'image/jpeg')).toBe('festa-Cerimônia 12-redes.jpg');
    expect(nomeDownload('festa', 'sem-extensao', 'max', 'image/png')).toBe('festa-sem-extensao.png');
  });

  it('contentDisposition: UTF-8 no filename* e um ASCII de reserva sem aspas', () => {
    const cd = contentDisposition('festa-Cerimônia 12-redes.jpg');
    expect(cd).toContain(`filename*=UTF-8''festa-Cerim%C3%B4nia%2012-redes.jpg`);
    expect(cd).toMatch(/filename="festa-Cerimonia 12-redes\.jpg"/);
    expect(cd).not.toMatch(/[\r\n]/);
  });
});

// ---------------------------------------------------------------------------
describe('bibliotecas vendorizadas', () => {
  it.each(VENDOR.map(v => [v.path, v]))('%s sai com o tipo certo e cache imutável', async (_p, v) => {
    const res = await get(v.path, { logado: false });
    expect(res.status).toBe(200);
    expect(res.headers.get('Content-Type')).toBe(v.contentType);
    expect(res.headers.get('Cache-Control')).toMatch(/immutable/);
    expect(await res.text()).toBe(v.texto);
  });

  it('caminho fora do mapa é 404 (busca exata, não prefixo)', async () => {
    const res = await get('/vendor/photoswipe.js', { logado: false });
    expect(res.status).toBe(404);
  });
});

// ---------------------------------------------------------------------------
// O painel desenha a lista de projetos em DOIS lugares (no servidor e no
// script). A regra "regra escrita duas vezes é corrigida uma vez só"
// (TODO.md) vale para o botão novo: os dois têm de levar à galeria.
describe('painel: o atalho para a galeria no card de cada evento', () => {
  it('o card (o mesmo no servidor e no script, ver tests/painel.test.js) aponta para /galeria/<slug>', () => {
    const html = dashboardHTML([{ ...EVENTOS[0], status: 'entregue' }], [], 'NONCE');
    expect(html).toContain('href="/galeria/formatura"');
  });
});
