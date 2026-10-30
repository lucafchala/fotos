// Galeria própria (#235). O que estes testes prendem:
//
//  1. Quem vê: álbum público, todos; família/privado, só com o passe do
//     portão; "Em breve", ninguém. Para quem não pode, página e downloads são
//     o mesmo 404 de uma rota inexistente. Foto oculta pelo dono não chega ao
//     visitante, e o download dela é 404.
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
// Álbum público agora é aberto a todos; o fechamento vale para família/privado.
async function virarFamilia() {
  const eventos = structuredClone(EVENTOS);
  eventos[0].accessType = 'family';
  await saveEvents(env, eventos);
}
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
  it('álbum de família, sem sessão: o 404 de rota inexistente, sem chamar o Google nem ler sessão no KV', async () => {
    await virarFamilia();
    const res = await get('/galeria/formatura', { logado: false });
    expect(res.status).toBe(404);
    expect(await res.text()).toContain('Página não encontrada');
    expect(chamadas).toHaveLength(0);
    expect(env.FOTOS._leituras.some(k => k.startsWith('admin_session:'))).toBe(false);
  });

  it('álbum de família, cookie de sessão inválido também é 404', async () => {
    await virarFamilia();
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
    expect(html).toContain('class="g-dono"');
    for (const v of VENDOR) expect(html).toContain(v.path);
    expect(html).not.toMatch(/vídeo/); // aviso de vídeos removido (29/10/2026)
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
  it('álbum de família, sem sessão: 404, sem chamar o Google', async () => {
    await virarFamilia();
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

describe('galeriaHTML — cabeçalho de galeria', () => {
  // A contagem de fotos tinha sido removida do painel (TODO.md, "Decidido não
  // fazer": as fotos já vêm numeradas). Na galeria que o convidado vai receber
  // ela volta, por pedido do dono (handoff 4.1): o Drive mostra quantos itens
  // há, e a galeria própria tem de ser melhor. O número vem da lista lida do
  // Drive, nunca de cadastro manual.
  const fotos37 = Array.from({ length: 37 }, (_, i) => [`FOTO_${String(i).padStart(10, '0')}`, 6000, 4000, `${i + 1}.jpg`, 1]);
  const bruto = (/** @type {any[]} */ fotos, total = fotos.length, evento = {}) => galeriaHTML({
    event: { ...EVENTOS[0], ...evento },
    listagem: { v: 1, pasta: RAIZ, em: '2026-10-10T12:00:00.000Z', truncada: false, total, videos: 0, outros: 0, rk: {}, secoes: [{ nome: '', caminho: '', fotos }] },
    erro: null,
    nonce: 'N',
  });
  const render = (/** @type {any[]} */ fotos, total = fotos.length, evento = {}) => foraDosScripts(bruto(fotos, total, evento));

  it('o cabeçalho traz a data do evento e quantas fotos há', () => {
    const html = render(fotos37, 37, { date: '2026-03-14' });
    expect(html).toMatch(/<p class="g-meta">14 de março de 2026 · 37 fotos<\/p>/);
  });

  it('no singular, e sem data quando o evento não tem', () => {
    expect(render(fotos37.slice(0, 1), 1, { date: '' })).toMatch(/<p class="g-meta">1 foto<\/p>/);
  });

  it('os controles do dono ficam numa faixa própria, fora do cabeçalho fixo', () => {
    const html = render(fotos37);
    const dono = html.match(/<div class="g-dono">([\s\S]*?)<\/div>\s*<header/);
    expect(dono).not.toBeNull();
    for (const t of ['← Painel', 'Página do projeto', 'Atualizar lista', 'Lista do Drive de 10/10, 09:00']) expect(dono?.[1]).toContain(t);
    const cab = html.match(/<header class="g-top"[\s\S]*?<\/header>/);
    expect(cab?.[0]).not.toContain('Atualizar lista');
    expect(cab?.[0]).not.toContain('← Painel');
  });

  it('as ações do convidado são "Selecionar" e "Baixar tudo"', () => {
    const html = render(fotos37);
    expect(html).toMatch(/<button type="button" class="g-btn" id="g-sel" aria-pressed="false">Selecionar<\/button>/);
    expect(html).toMatch(/<button type="button" class="g-btn" data-acao="baixar-tudo">Baixar tudo<\/button>/);
  });

  it('a pasta sem fotos não mostra Selecionar nem Baixar tudo', () => {
    const html = render([], 0);
    expect(html).not.toContain('data-acao="baixar-tudo"');
    expect(html).not.toContain('id="g-sel"');
  });

  it('o botão "Voltar ao topo" tem 44 px e nome acessível', () => {
    const html = bruto(fotos37);
    expect(html).toMatch(/<button type="button" class="g-topo" id="g-topo" data-acao="topo" aria-label="Voltar ao topo">/);
    expect(html).toMatch(/\.g-topo\{[^}]*width:44px;height:44px/);
  });

  it('a faixa de chips existe (a página decide se aparece) e o link do Drive vai nos dados', () => {
    const html = bruto(fotos37.slice(0, 1));
    expect(html).toContain('id="g-chips"');
    const ilha = html.match(/<script type="application\/json" id="g-dados" nonce="N">([\s\S]*?)<\/script>/);
    expect(JSON.parse(/** @type {RegExpMatchArray} */ (ilha)[1]).drive).toBe(EVENTOS[0].driveUrl);
    expect(html).not.toContain(CHAVE);
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

// ---------------------------------------------------------------------------
// Álbum público: aberto a todos. Família/privado: só com o passe do portão.
import { signToken as assinaPasse } from '../src/security.js';
describe('galeria aberta ao visitante', () => {
  const SEGREDO = 's'.repeat(48);
  const passe = (slug, purpose = 'galeria') => assinaPasse(SEGREDO, { purpose, scope: slug, ttlSecs: 3600 });
  const visita = (path, token) => worker.fetch(new Request(SITE + path, {
    headers: { Accept: 'text/html', ...(token ? { Cookie: `galeria=${token}` } : {}) },
  }), env, ctx);
  async function comFamilia() {
    const eventos = structuredClone(EVENTOS);
    eventos[0].accessType = 'family';
    await saveEvents(env, eventos);
  }
  beforeEach(() => { env.SIGNING_SECRET = SEGREDO; });

  it('álbum público: página e download abrem sem login nem passe', async () => {
    expect((await visita('/galeria/formatura')).status).toBe(200);
    expect((await visita('/galeria/formatura/baixar/FOTO_DEZ_00010?v=redes')).status).toBe(200);
  });

  it('álbum de família sem passe, com passe de outro álbum, de outro propósito ou forjado: 404', async () => {
    await comFamilia();
    expect((await visita('/galeria/formatura')).status).toBe(404);
    expect((await visita('/galeria/formatura/baixar/FOTO_DEZ_00010?v=redes')).status).toBe(404);
    expect((await visita('/galeria/formatura', await passe('outro-album'))).status).toBe(404);
    expect((await visita('/galeria/formatura', await passe('formatura', 'drive'))).status).toBe(404);
    expect((await visita('/galeria/formatura', 'zzz.forjado')).status).toBe(404);
  });

  it('álbum de família com o passe do álbum: abre', async () => {
    await comFamilia();
    expect((await visita('/galeria/formatura', await passe('formatura'))).status).toBe(200);
  });

  it('álbum "Em breve" continua fechado', async () => {
    const eventos = structuredClone(EVENTOS);
    eventos[0].comingSoon = true;
    await saveEvents(env, eventos);
    expect((await visita('/galeria/formatura')).status).toBe(404);
  });
});

describe('galeria para o visitante', () => {
  it('sem a faixa do dono, sem "prévia" no título, e ?atualizar não relê o Drive', async () => {
    const res = await worker.fetch(new Request(SITE + '/galeria/formatura', { headers: { Accept: 'text/html' } }), env, ctx);
    const html = await res.text();
    expect(res.status).toBe(200);
    expect(html).not.toContain('class="g-dono"');
    expect(html).not.toMatch(/<title>[^<]*prévia/i);
    const antes = chamadasDrive().length;
    const r2 = await worker.fetch(new Request(SITE + '/galeria/formatura?atualizar=1', { headers: { Accept: 'text/html' } }), env, ctx);
    expect(r2.status).toBe(200);
    expect(chamadasDrive().length).toBe(antes);
  });
});

// ---------------------------------------------------------------------------
// Ocultar uma foto (pedido de remoção, LGPD) e contar downloads por versão.
import { semOcultas, normalizaOcultas } from '../src/drive.js';
import { normalizeEventFields } from '../src/index.js';
import { GALERIA_MAX_OCULTAS, DEFAULT_EVENT } from '../src/config.js';
describe('fotos ocultas', () => {
  const OCULTA = 'FOTO_DEZ_00010';
  const visitante = path => worker.fetch(new Request(SITE + path, { headers: { Accept: 'text/html' } }), env, ctx);
  const ocultar = (corpo, { logado = true } = {}) => worker.fetch(new Request(SITE + '/api/galeria/ocultar', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...(logado ? { Cookie: `__Host-session=${TOKEN}` } : {}) },
    body: JSON.stringify(corpo),
  }), env, ctx);
  const gravadas = () => JSON.parse(env.FOTOS._store.get('events')).find(e => e.slug === 'formatura').fotosOcultas;

  it('normalizaOcultas: só IDs válidos, sem repetir, com teto; outra forma vira lista vazia', () => {
    expect(normalizaOcultas(['FOTO_DEZ_00010', 'FOTO_DEZ_00010', 'curto', 42, '../x/y/z/w', null])).toEqual(['FOTO_DEZ_00010']);
    expect(normalizaOcultas('FOTO_DEZ_00010')).toEqual([]);
    expect(normalizaOcultas(undefined)).toEqual([]);
    const muitas = Array.from({ length: GALERIA_MAX_OCULTAS + 20 }, (_, i) => `FOTO_${String(i).padStart(8, '0')}`);
    expect(normalizaOcultas(muitas)).toHaveLength(GALERIA_MAX_OCULTAS);
    expect(DEFAULT_EVENT.fotosOcultas).toEqual([]);
  });

  it('semOcultas: tira a foto, a seção vazia sai, o total acompanha; sem ocultas, a mesma listagem', () => {
    const dados = { v: 1, pasta: 'x', em: '', truncada: false, videos: 0, outros: 0, rk: {}, total: 3, secoes: [
      { nome: '', caminho: '', fotos: [['AAAAAAAAAA', 1, 1, 'a', 0], ['BBBBBBBBBB', 1, 1, 'b', 0]] },
      { nome: 'Festa', caminho: 'Festa', fotos: [['CCCCCCCCCC', 1, 1, 'c', 0]] },
    ] };
    const r = semOcultas(dados, ['CCCCCCCCCC', 'AAAAAAAAAA']);
    expect(r.total).toBe(1);
    expect(r.secoes).toHaveLength(1);
    expect(r.secoes[0].fotos.map(f => f[0])).toEqual(['BBBBBBBBBB']);
    expect(dados.total).toBe(3);
    expect(semOcultas(dados, [])).toBe(dados);
  });

  it('formulário e backup só gravam IDs válidos', () => {
    const n = normalizeEventFields({ fotosOcultas: [OCULTA, '<script>'] }, DEFAULT_EVENT, []);
    expect(n.fotosOcultas).toEqual([OCULTA]);
    expect(normalizeEventFields({}, { ...DEFAULT_EVENT, fotosOcultas: [OCULTA] }, []).fotosOcultas).toEqual([OCULTA]);
  });

  it('só o dono oculta: sem sessão 401; corpo errado 400; projeto inexistente 404', async () => {
    expect((await ocultar({ slug: 'formatura', foto: OCULTA, oculta: true }, { logado: false })).status).toBe(401);
    expect((await ocultar({ slug: 'formatura', foto: 'x', oculta: true })).status).toBe(400);
    expect((await ocultar({ slug: 'formatura', foto: OCULTA, oculta: 'sim' })).status).toBe(400);
    expect((await ocultar({ slug: 'nao-existe', foto: OCULTA, oculta: true })).status).toBe(404);
    expect(gravadas()).toBeUndefined();
  });

  it('oculta, repetir não duplica, e mostrar de novo tira da lista', async () => {
    const r = await ocultar({ slug: 'formatura', foto: OCULTA, oculta: true });
    expect(r.status).toBe(200);
    expect((await r.json()).ocultas).toEqual([OCULTA]);
    await ocultar({ slug: 'formatura', foto: OCULTA, oculta: true });
    expect(gravadas()).toEqual([OCULTA]);
    const v = await ocultar({ slug: 'formatura', foto: OCULTA, oculta: false });
    expect((await v.json()).ocultas).toEqual([]);
    expect(gravadas()).toEqual([]);
  });

  it('o visitante não recebe a foto oculta (nem o ID) e o download dela é 404, sem chamar o Google', async () => {
    await ocultar({ slug: 'formatura', foto: OCULTA, oculta: true });
    const html = await (await visitante('/galeria/formatura')).text();
    expect(html).not.toContain(OCULTA);
    expect(html).toContain('FOTO_DOIS_0002');
    expect(html).toContain('4 fotos');
    chamadas.length = 0;
    expect((await visitante(`/galeria/formatura/baixar/${OCULTA}?v=max`)).status).toBe(404);
    expect(chamadas.some(c => c.url.includes(OCULTA))).toBe(false);
  });

  it('o dono vê todas, com a lista das ocultas e o aviso na faixa, e ainda baixa a oculta', async () => {
    await ocultar({ slug: 'formatura', foto: OCULTA, oculta: true });
    const html = await (await get('/galeria/formatura', { accept: 'text/html' })).text();
    expect(html).toContain(`"ocultas":["${OCULTA}"]`);
    expect(html).toContain('1 oculta para os visitantes');
    expect((await get(`/galeria/formatura/baixar/${OCULTA}?v=redes`)).status).toBe(200);
  });

  it('a página do visitante não leva lista de ocultas nem o botão do dono', async () => {
    const html = await (await visitante('/galeria/formatura')).text();
    expect(html).toContain('"dono":false,"ocultas":[]');
  });
});

describe('downloads contados por versão', () => {
  const visitante = path => worker.fetch(new Request(SITE + path, { headers: { Accept: '*/*' } }), env, ctx);
  async function metricas() {
    const r = await get('/api/metrics');
    return (await r.json()).find(m => m.slug === 'formatura');
  }

  it('cada download do visitante soma na versão certa; o do dono não conta; o painel recebe os dois', async () => {
    expect((await visitante('/galeria/formatura/baixar/FOTO_DEZ_00010?v=redes')).status).toBe(200);
    expect((await visitante('/galeria/formatura/baixar/FOTO_DOIS_0002?v=redes')).status).toBe(200);
    expect((await visitante('/galeria/formatura/baixar/FOTO_DEZ_00010?v=max')).status).toBe(200);
    expect((await get('/galeria/formatura/baixar/FOTO_DEZ_00010?v=max')).status).toBe(200);
    const m = await metricas();
    expect(m.baixarRedes).toBe(2);
    expect(m.baixarMax).toBe(1);
  });

  it('download recusado (foto fora da pasta) não conta, e ler os zeros não lê o KV', async () => {
    expect((await visitante('/galeria/formatura/baixar/FORA_DA_PASTA_1?v=redes')).status).toBe(404);
    env.FOTOS._leituras.length = 0;
    const m = await metricas();
    expect(m.baixarRedes).toBe(0);
    expect(m.baixarMax).toBe(0);
    expect(env.FOTOS._leituras.filter(k => k.startsWith('baixar_'))).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// Galeria de álbum PÚBLICO no Google (decisão do dono, 29/10/2026). Família,
// privado, "Em breve", não listado, prévia e a visão do dono continuam fora de
// busca; downloads nunca entram (cota do Drive e do Worker).
import { handleGaleriaPagina, galeriaIndexavel } from '../src/index.js';
describe('galeria pública no Google', () => {
  const SEGREDO = 's'.repeat(48);
  const visitante = (path, cookie = '') => worker.fetch(new Request(SITE + path, {
    headers: { Accept: 'text/html', ...(cookie ? { Cookie: cookie } : {}) },
  }), env, ctx);
  const metaRobots = html => (html.match(/<meta name="robots" content="([^"]*)">/) || [])[1];
  async function comEventos(muda) {
    const eventos = structuredClone(EVENTOS);
    muda(eventos);
    await saveEvents(env, eventos);
  }
  beforeEach(() => { env.SIGNING_SECRET = SEGREDO; });

  it('álbum público, visitante: indexável no cabeçalho e na meta, sem no-store, CSP com nonce mantida', async () => {
    const res = await visitante('/galeria/formatura');
    expect(res.status).toBe(200);
    expect(res.headers.get('X-Robots-Tag')).toBeNull();
    expect(res.headers.get('Cache-Control')).toBe('private, no-cache');
    expect(res.headers.get('Content-Security-Policy')).toMatch(/script-src 'self' 'nonce-[\w-]+'/);
    const html = await res.text();
    expect(metaRobots(html)).toBe('index,follow,max-image-preview:large');
    expect(html).not.toMatch(/noindex/);
  });

  it('título, descrição, canonical, og:image da capa e JSON-LD ImageGallery ligado ao Person do site', async () => {
    await comEventos(ev => {
      ev[0].date = '2026-01-15';
      ev[0].thumbnailUrl = 'https://lh3.googleusercontent.com/d/CAPA_DO_EVENTO1=w800';
    });
    const html = await (await visitante('/galeria/formatura')).text();
    expect(html).toContain('<title>Fotos de Formatura 2026 — 15 de janeiro de 2026</title>');
    expect(html).toContain('<link rel="canonical" href="https://fotos.lucafchala.com/galeria/formatura">');
    expect(html).toMatch(/<meta name="description" content="15 de janeiro de 2026 · 5 fotos — Galeria de fotos de Formatura 2026/);
    expect(html).toContain('<meta property="og:image" content="https://lh3.googleusercontent.com/d/CAPA_DO_EVENTO1=w1200-h630-c">');
    expect(html).toContain('<meta property="og:url" content="https://fotos.lucafchala.com/galeria/formatura">');
    const ld = JSON.parse(html.match(/<script type="application\/ld\+json" nonce="[^"]+">([^<]*)<\/script>/)[1]);
    expect(ld['@type']).toBe('ImageGallery');
    expect(ld.author['@id']).toBe('https://lucafchala.com/#person');
    expect(ld.url).toBe('https://fotos.lucafchala.com/galeria/formatura');
    expect(ld.numberOfItems).toBe(5);
    expect(ld.associatedMedia[0]).toMatchObject({ '@type': 'ImageObject', name: 'Formatura 2026 — foto 1 de 5' });
    expect(ld.associatedMedia[0].creator['@id']).toBe('https://lucafchala.com/#person');
    // O alt da grade sai do mesmo título (o script monta "<evento> — foto i de n").
    expect(html).toContain('"titulo":"Formatura 2026"');
  });

  it('família e privado (mesmo com o passe): noindex no cabeçalho e na meta, e nunca em cache', async () => {
    for (const tipo of ['family', 'private']) {
      await comEventos(ev => { ev[0].accessType = tipo; });
      const token = await assinaPasse(SEGREDO, { purpose: 'galeria', scope: 'formatura', ttlSecs: 3600 });
      const res = await visitante('/galeria/formatura', `galeria=${token}`);
      expect(res.status, tipo).toBe(200);
      expect(res.headers.get('X-Robots-Tag'), tipo).toMatch(/noindex/);
      expect(res.headers.get('Cache-Control'), tipo).toMatch(/no-store/);
      expect(metaRobots(await res.text()), tipo).toBe('noindex,nofollow');
      // E sem o passe, o 404 de sempre.
      expect((await visitante('/galeria/formatura')).status, tipo).toBe(404);
    }
  });

  it('"Em breve" é 404; não listado, prévia de PR e a visão do dono ficam com noindex', async () => {
    await comEventos(ev => { ev[0].comingSoon = true; });
    expect((await visitante('/galeria/formatura')).status).toBe(404);

    await comEventos(ev => { ev[0].visible = false; });
    const oculto = await visitante('/galeria/formatura');
    expect(oculto.status).toBe(200);
    expect(oculto.headers.get('X-Robots-Tag')).toMatch(/noindex/);
    expect(metaRobots(await oculto.text())).toBe('noindex,nofollow');

    await saveEvents(env, structuredClone(EVENTOS));
    const req = new Request(SITE + '/galeria/formatura', { headers: { Accept: 'text/html' } });
    const previa = await handleGaleriaPagina(req, { ...env, AMBIENTE: 'previa' }, 'formatura', new URL(req.url), 'n0nce');
    expect(previa.headers.get('X-Robots-Tag')).toMatch(/noindex/);
    expect(metaRobots(await previa.text())).toBe('noindex,nofollow');

    const dono = await get('/galeria/formatura', { accept: 'text/html' });
    expect(dono.headers.get('X-Robots-Tag')).toMatch(/noindex/);
    expect(metaRobots(await dono.text())).toBe('noindex,nofollow');
  });

  it('página de erro (pasta inacessível) não vai para o índice', async () => {
    rotaExtra = url => (url.host === 'www.googleapis.com' ? Response.json({ error: { code: 404, errors: [{ reason: 'notFound' }] } }, { status: 404 }) : null);
    const res = await visitante('/galeria/formatura');
    expect(res.status).toBe(200);
    expect(res.headers.get('X-Robots-Tag')).toMatch(/noindex/);
  });

  it('galeriaIndexavel: só público, listado, publicado e com pasta', () => {
    const base = EVENTOS[0];
    expect(galeriaIndexavel(base)).toBe(true);
    expect(galeriaIndexavel({ ...base, accessType: 'family' })).toBe(false);
    expect(galeriaIndexavel({ ...base, accessType: 'private' })).toBe(false);
    expect(galeriaIndexavel({ ...base, comingSoon: true })).toBe(false);
    expect(galeriaIndexavel({ ...base, visible: false })).toBe(false);
    expect(galeriaIndexavel(EVENTOS[1])).toBe(false); // link de arquivo, não de pasta
  });

  it('sitemap.xml lista a galeria pública (com lastmod) e não as de família, privado, não listado ou "Em breve" — sem chamar o Drive', async () => {
    await comEventos(ev => {
      ev[0].updatedAt = '2026-10-29T10:00:00.000Z';
      const pasta = ev[0].driveUrl;
      ev.push(
        { id: '3', slug: 'da-familia', title: 'F', accessType: 'family', driveUrl: pasta },
        { id: '4', slug: 'participantes', title: 'P', accessType: 'private', driveUrl: pasta },
        { id: '5', slug: 'nao-listado', title: 'N', accessType: 'public', visible: false, driveUrl: pasta },
        { id: '6', slug: 'em-breve', title: 'B', accessType: 'public', comingSoon: true, driveUrl: pasta },
      );
    });
    const xml = await (await visitante('/sitemap.xml')).text();
    expect(xml).toContain('<url><loc>https://fotos.lucafchala.com/galeria/formatura</loc><lastmod>2026-10-29</lastmod></url>');
    for (const s of ['da-familia', 'participantes', 'nao-listado', 'em-breve', 'so-arquivo']) {
      expect(xml).not.toContain(`/galeria/${s}<`);
    }
    const indice = await (await visitante('/sitemap-galerias.xml')).text();
    expect(indice).toContain('<sitemapindex');
    expect(indice).toContain('<loc>https://fotos.lucafchala.com/sitemap-galeria-formatura.xml</loc><lastmod>2026-10-29</lastmod>');
    expect(indice.match(/<sitemap>/g)).toHaveLength(1);
    expect(chamadas).toHaveLength(0);
  });

  it('sitemap de imagens da galeria: cada foto do lh3 em image:image, sem a oculta, e família/privado/não listado são 404', async () => {
    await comEventos(ev => { ev[0].fotosOcultas = ['FOTO_DOIS_0002']; ev[0].updatedAt = '2026-10-29T10:00:00.000Z'; });
    const res = await visitante('/sitemap-galeria-formatura.xml');
    expect(res.status).toBe(200);
    expect(res.headers.get('Content-Type')).toMatch(/application\/xml/);
    expect(res.headers.get('Cache-Control')).toBe('no-cache');
    const xml = await res.text();
    expect(xml).toContain('xmlns:image="http://www.google.com/schemas/sitemap-image/1.1"');
    expect(xml).toContain('<loc>https://fotos.lucafchala.com/galeria/formatura</loc><lastmod>2026-10-29</lastmod>');
    expect(xml.match(/<image:image>/g)).toHaveLength(4);
    expect(xml).toContain('<image:loc>https://lh3.googleusercontent.com/d/FOTO_DEZ_00010=w1600</image:loc>');
    expect(xml).not.toContain('FOTO_DOIS_0002');
    expect(xml).not.toContain(CHAVE);
    for (const muda of [ev => { ev[0].accessType = 'family'; }, ev => { ev[0].accessType = 'private'; }, ev => { ev[0].visible = false; }, ev => { ev[0].comingSoon = true; }]) {
      await comEventos(muda);
      expect((await visitante('/sitemap-galeria-formatura.xml')).status).toBe(404);
    }
  });

  it('sitemap de imagens: até 1000 por URL, e custa o mesmo que uma visita (a listagem em cache não chama o Drive de novo)', async () => {
    const muitas = Array.from({ length: 1200 }, (_, i) => ({ id: `MUITAS_${String(i).padStart(6, '0')}`, name: `${i}.jpg`, mimeType: 'image/jpeg', imageMediaMetadata: { width: 3000, height: 2000 } }));
    rotaExtra = url => (url.host === 'www.googleapis.com' && url.pathname === '/drive/v3/files' ? Response.json({ files: muitas }) : null);
    const xml = await (await visitante('/sitemap-galeria-formatura.xml')).text();
    expect(xml.match(/<image:image>/g)).toHaveLength(1000);
    const frias = chamadasDrive().length;
    expect(frias).toBeLessThanOrEqual(30); // GALERIA_MAX_CHAMADAS: dentro das 50 subrequisições do plano gratuito
    await visitante('/galeria/formatura');
    await visitante('/sitemap-galeria-formatura.xml');
    expect(chamadasDrive().length).toBe(frias);
  });

  it('Drive fora: o sitemap de imagens responde 503 com Retry-After (o Google guarda a versão anterior)', async () => {
    rotaExtra = url => (url.host === 'www.googleapis.com' ? Response.json({ error: { code: 500 } }, { status: 500 }) : null);
    const res = await visitante('/sitemap-galeria-formatura.xml');
    expect(res.status).toBe(503);
    expect(res.headers.get('Retry-After')).toBe('3600');
  });

  it('download: X-Robots-Tag noindex em toda resposta do proxy (a foto, o 404 e o recusado)', async () => {
    for (const caminho of ['/galeria/formatura/baixar/FOTO_DEZ_00010?v=redes', '/galeria/formatura/baixar/FOTO_DEZ_00010?v=max', '/galeria/formatura/baixar/FORA_DA_PASTA_1?v=redes']) {
      const res = await visitante(caminho);
      expect(res.headers.get('X-Robots-Tag'), caminho).toMatch(/noindex/);
    }
    await comEventos(ev => { ev[0].accessType = 'family'; });
    expect((await visitante('/galeria/formatura/baixar/FOTO_DEZ_00010?v=redes')).headers.get('X-Robots-Tag')).toMatch(/noindex/);
  });

  it('links de download e do Drive levam rel="nofollow"', async () => {
    const html = await (await visitante('/galeria/formatura')).text();
    expect(html).toMatch(/<a id="g-folha-drive"[^>]* rel="nofollow noopener"/);
    expect(html).toMatch(/href="https:\/\/drive\.google\.com\/[^"]*" rel="nofollow">Abrir a pasta no Drive/);
    // O <a download> que o script cria para o download e o "Pelo Google Drive".
    const script = html.slice(html.indexOf('function linkDireto'));
    expect(script.slice(0, 300)).toContain("a.rel = 'nofollow';");
    expect(html).toContain("a.rel = 'nofollow noopener';");
    expect(html).not.toMatch(/a\.rel = 'noopener';/);
  });
});
