// Envio de fotos pelo site (src/envio.js, rotas /api/envio/* em src/index.js,
// docs/ENVIO.md). O arquivo sai do celular em partes, passa pelo Worker e vai
// para a pasta de envio do evento no Google Drive, por uma sessão de envio
// retomável aberta com a credencial OAuth do dono.
//
// O Google aqui é SIMULADO (o `fetch` global), com as regras que o código
// depende dele seguir: o token sai de oauth2.googleapis.com; a sessão é aberta
// por POST com `uploadType=resumable` e volta no `Location`; cada parte é um
// PUT com `Content-Range`, respondido com 308 + `Range: bytes=0-N` até o fim e
// 200/201 no fim; `bytes */total` pergunta onde parou; 404/410 é sessão morta.
// O que estes testes prendem:
//  1. as peças puras: selo (cifrado, autenticado, com prazo), nome, tipo e
//     primeiros bytes, assinatura e crédito, data, impressão digital;
//  2. o token: guardado, pedido de novo num 401, recusa guardada por um
//     minuto, rede e 5xx não guardados;
//  3. o protocolo inteiro pelas rotas: passe (Turnstile + declaração, aceite
//     no D1) → inicia (duplicata, espaço, tetos do dia, pasta da lista do
//     servidor) → partes (308 → 200, alinhamento, primeiros bytes, 409
//     quando a página e o Google discordam) → estado;
//  4. o que nunca pode vazar: o endereço da sessão em claro, o texto do
//     Google na resposta, a chave de API nas chamadas que gravam;
//  5. o /api/healthz (desligado / ok / falha / incerto) e a página de envio;
//  6. a listagem: crédito assinado só dentro de pasta de envio, nunca com o
//     nome de um crédito do álbum, com teto; e os dias do evento (`dd`).
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import worker from '../src/index.js';
import { mintFormToken, albumRecebeEnvio } from '../src/index.js';
import {
  EnvioError, envioLigado, tokenDeAcesso, limpaCacheEnvioSite, sessaoDoGoogle, criaSessao, enviaParte, consultaSessao,
  cancelaSessao, procuraDuplicata, espacoNoDrive, cabeNoDrive, saudeDoEnvio, selaSessao, abreSessao, nomeDeArquivo,
  extensaoDe, tipoDoArquivo, familiaDosBytes, bytesConferem, fpValido, dataModificada, limpaAssinatura, descricaoDoEnvio,
  creditoDaDescricao,
} from '../src/envio.js';
import { limpaCacheEnvio, limpaCacheDrive, listaPasta, registraResumo, lerResumo } from '../src/drive.js';
import { saveEvents, counterStub, hojeEmSaoPaulo } from '../src/utils.js';
import { signToken } from '../src/security.js';
import {
  ENVIO_SESSAO_TTL_SECS, ENVIO_MARGEM_DRIVE_BYTES, ENVIO_AVISO_DRIVE_BYTES, ENVIO_TETO_ARQUIVOS_DIA, ENVIO_TETO_MB_DIA,
  ENVIO_PARTE_MULTIPLO, ENVIO_PARTE_MAX_BYTES, ENVIO_MAX_BYTES, ENVIO_DECLARACAO, ENVIO_ASSINATURAS_POR_LISTA, RESUMO_DIAS_MAX,
} from '../src/config.js';
import { withDurableObjects } from './helpers/do.js';
import { d1Sqlite } from './helpers/d1.js';
import { ctxColetor } from './helpers/ctx.js';
import { fakeCaches } from './helpers/caches.js';

const SITE = 'https://fotos.lucafchala.com';
const TOKEN_DONO = 'e'.repeat(64);
const SEGREDO = 's'.repeat(48);
const RAIZ = 'RAIZ_PASTA_0001';
const ENVIO = '!turma 2026 (adicione suas fotos aqui)';
const CREDITOS = `chala = Luca F. Chala\nmag = Mag\n${ENVIO} = Turma 2026\n* = Turma 2026`;
const PASTA_A = 'ENVIO_A_00001';
const PASTA_B25 = 'ENVIO_B25_001';
const GB = 1024 ** 3;
const FP = 'a'.repeat(32);
const FP2 = 'b'.repeat(32);
const SESSAO_RE = /^https:\/\/www\.googleapis\.com\/upload\/drive\/v3\/files\?uploadType=resumable&upload_id=/;

const pasta = (/** @type {string} */ id, /** @type {string} */ nome) => ({ id, name: nome, mimeType: 'application/vnd.google-apps.folder' });
const lugar = (/** @type {string} */ p, /** @type {string} */ envio) => [pasta(`${p}_CHALA_01`, 'chala'), pasta(`${p}_MAG_0001`, 'mag'), pasta(envio, ENVIO)];

/** @type {Record<string, any[]>} */
const ARVORE = {
  [RAIZ]: [pasta('EVA_PASTA_0001', '01 - Formatura'), pasta('EVB_PASTA_0001', '02 - Interclasse')],
  EVA_PASTA_0001: lugar('EVA', PASTA_A),
  EVB_PASTA_0001: [pasta('EVB_2025_0001', '2025')],
  EVB_2025_0001: lugar('B25', PASTA_B25),
};

/** Um JPEG de `n` bytes: o começo certo, o resto zeros. */
function jpeg(/** @type {number} */ n) {
  const b = new Uint8Array(n);
  b.set([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01]);
  for (let i = 12; i < n; i++) b[i] = i % 251;
  return b;
}

// ---------------------------------------------------------------------------
// O Google simulado
// ---------------------------------------------------------------------------

/**
 * @typedef {{ total: number, recebido: number, partes: Uint8Array[], meta: any, headers: Headers, feito: boolean, cancelada: boolean }} Sessao
 */
/** @type {{
 *   tokens: number, token: (() => Response | Promise<Response>) | null,
 *   sessoes: Map<string, Sessao>, seq: number,
 *   duplicadas: Map<string, string>, buscas: { url: URL, auth: string }[], buscaFalha: boolean,
 *   about: any, aboutFalha: number,
 *   abrir: (() => Response) | null, aberturas: { meta: any, headers: Headers, url: URL }[],
 *   parte: ((s: Sessao) => Response | null) | null,
 *   auth: string[], turnstileOk: boolean, turnstile: number,
 * }} */
let G;
/** @type {URL[]} */
let listagens;

function novoGoogle() {
  G = {
    tokens: 0, token: null, sessoes: new Map(), seq: 0,
    duplicadas: new Map(), buscas: [], buscaFalha: false,
    about: { storageQuota: { limit: String(100 * GB), usage: String(10 * GB) } }, aboutFalha: 0,
    abrir: null, aberturas: [], parte: null, auth: [], turnstileOk: true, turnstile: 0,
  };
  listagens = [];
}

const urlDaSessao = (/** @type {string} */ id) => `https://www.googleapis.com/upload/drive/v3/files?uploadType=resumable&upload_id=${id}`;

async function googleFalso(/** @type {any} */ input, /** @type {any} */ init = {}) {
  const url = new URL(typeof input === 'string' ? input : input.url);
  const method = String(init.method || 'GET').toUpperCase();
  const headers = new Headers(init.headers || {});
  if (url.host === 'challenges.cloudflare.com') { G.turnstile++; return Response.json({ success: G.turnstileOk }); }
  if (url.host === 'oauth2.googleapis.com' && url.pathname === '/token') {
    G.tokens++;
    const corpo = new URLSearchParams(String(init.body));
    expect(corpo.get('grant_type')).toBe('refresh_token');
    if (G.token) return G.token();
    return Response.json({ access_token: `ya29.token${G.tokens}`, expires_in: 3599, token_type: 'Bearer' });
  }
  if (url.host !== 'www.googleapis.com') return new Response('nao esperado', { status: 599 });
  const auth = headers.get('Authorization') || '';
  if (url.pathname === '/drive/v3/files') {
    const q = url.searchParams.get('q') || '';
    if (q.includes('appProperties')) {
      G.buscas.push({ url, auth });
      G.auth.push(auth);
      if (G.buscaFalha) return Response.json({ error: { code: 500 } }, { status: 500 });
      const fp = q.match(/value='([a-f0-9]+)'/)?.[1] || '';
      const id = G.duplicadas.get(fp);
      return Response.json({ files: id ? [{ id }] : [] });
    }
    // A listagem da galeria (chave de API, nunca o token do envio).
    listagens.push(url);
    const id = q.match(/^'([^']+)' in parents/)?.[1] || '';
    return Response.json({ files: ARVORE[id] || [] });
  }
  if (url.pathname === '/drive/v3/about') {
    G.auth.push(auth);
    if (G.aboutFalha) return Response.json({ error: { code: G.aboutFalha } }, { status: G.aboutFalha });
    return Response.json(G.about);
  }
  if (url.pathname === '/upload/drive/v3/files') {
    const id = url.searchParams.get('upload_id');
    if (!id) {
      G.auth.push(auth);
      expect(method).toBe('POST');
      expect(url.searchParams.get('uploadType')).toBe('resumable');
      G.aberturas.push({ meta: JSON.parse(String(init.body)), headers, url });
      if (G.abrir) return G.abrir();
      const novo = `U${++G.seq}`;
      G.sessoes.set(novo, { total: Number(headers.get('X-Upload-Content-Length')), recebido: 0, partes: [], meta: JSON.parse(String(init.body)), headers, feito: false, cancelada: false });
      return new Response(null, { status: 200, headers: { Location: urlDaSessao(novo) } });
    }
    const s = G.sessoes.get(id);
    if (!s || s.cancelada) return new Response('Not Found', { status: 404 });
    if (method === 'DELETE') { s.cancelada = true; return new Response(null, { status: 499 }); }
    // A sessão é a credencial: nada de Authorization nas partes.
    expect(auth).toBe('');
    const faixa = headers.get('Content-Range') || '';
    const pergunta = /^bytes \*\/(\d+)$/.exec(faixa);
    if (pergunta) {
      if (s.feito) return Response.json({ id: `ARQ_${id}` });
      return new Response(null, { status: 308, headers: s.recebido ? { Range: `bytes=0-${s.recebido - 1}` } : {} });
    }
    if (G.parte) { const r = G.parte(s); if (r) return r; }
    const m = /^bytes (\d+)-(\d+)\/(\d+)$/.exec(faixa);
    if (!m || Number(m[3]) !== s.total) return new Response('bad range', { status: 400 });
    if (Number(m[1]) !== s.recebido) return new Response('fora de posição', { status: 400 });
    const bytes = new Uint8Array(await new Response(init.body).arrayBuffer());
    expect(bytes.byteLength).toBe(Number(m[2]) - Number(m[1]) + 1);
    s.partes.push(bytes);
    s.recebido = Number(m[2]) + 1;
    if (s.recebido === s.total) { s.feito = true; return Response.json({ id: `ARQ_${id}` }, { status: 200 }); }
    return new Response(null, { status: 308, headers: { Range: `bytes=0-${s.recebido - 1}` } });
  }
  return new Response('nao esperado', { status: 599 });
}

function fakeKV(/** @type {Record<string, string>} */ inicial = {}) {
  const store = new Map(Object.entries(inicial));
  return {
    _store: store,
    async get(/** @type {string} */ k) { return store.has(k) ? store.get(k) : null; },
    async put(/** @type {string} */ k, /** @type {string} */ v) { store.set(k, v); },
    async delete(/** @type {string} */ k) { store.delete(k); },
    async list() { return { keys: [], list_complete: true, cursor: null }; },
  };
}

const EVENTO = {
  id: '1', slug: 'entrenos2026', title: 'Entre Nós', accessType: 'public', galeriaCapitulos: true, visible: true,
  driveUrl: `https://drive.google.com/drive/folders/${RAIZ}`, galeriaCreditos: CREDITOS,
};

/** @type {any} */
let env;
/** @type {ReturnType<typeof ctxColetor>} */
let ctx;
/** @type {ReturnType<typeof d1Sqlite>} */
let db;
let ipSeq = 0;

beforeEach(async () => {
  limpaCacheEnvio();
  limpaCacheDrive();
  limpaCacheEnvioSite();
  novoGoogle();
  vi.stubGlobal('fetch', vi.fn(googleFalso));
  db = d1Sqlite();
  env = withDurableObjects({
    FOTOS: fakeKV({ [`admin_session:${TOKEN_DONO}`]: JSON.stringify({ createdAt: Date.now() }) }),
    GOOGLE_DRIVE_API_KEY: 'AIzaChaveDeTeste123',
    GOOGLE_OAUTH_CLIENT_ID: 'cliente.apps.googleusercontent.com',
    GOOGLE_OAUTH_CLIENT_SECRET: 'segredo-do-cliente',
    GOOGLE_OAUTH_REFRESH_TOKEN: '1//refresh',
    TURNSTILE_SECRET_KEY: 'ts-secret',
    SIGNING_SECRET: SEGREDO,
    CONSENT_DB: db,
  });
  ctx = ctxColetor();
  await saveEvents(env, [structuredClone(EVENTO)]);
});
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });

const ip = () => `198.51.100.${(++ipSeq % 250) + 1}`;
const post = (/** @type {string} */ caminho, /** @type {any} */ corpo, /** @type {Record<string, string>} */ extra = {}) => worker.fetch(new Request(SITE + caminho, {
  method: 'POST', headers: { 'Content-Type': 'application/json', 'CF-Connecting-IP': '203.0.113.9', ...extra }, body: JSON.stringify(corpo),
}), env, ctx);

async function pedePasse(/** @type {Record<string, any>} */ extra = {}) {
  return post('/api/envio/passe', {
    slug: 'entrenos2026', form_token: await mintFormToken(env, 'envio', { preAged: true }),
    turnstileToken: 'tok', aceite: true, nome: '', company_website: '', ...extra,
  });
}
const passeValido = () => signToken(SEGREDO, { purpose: 'envio', scope: 'entrenos2026', ttlSecs: 3600 });

async function inicia(/** @type {Record<string, any>} */ extra = {}) {
  return post('/api/envio/inicia', {
    slug: 'entrenos2026', passe: await passeValido(), pasta: PASTA_A, nome: 'IMG_0001.JPG', tamanho: 300_000,
    modificado: Date.UTC(2026, 5, 14, 21), fp: FP, assinatura: '', ...extra,
  });
}

const parte = (/** @type {string} */ selo, /** @type {number} */ pos, /** @type {Uint8Array} */ bytes) => worker.fetch(new Request(`${SITE}/api/envio/parte?pos=${pos}`, {
  method: 'PUT', headers: { 'X-Envio-Sessao': selo, 'Content-Type': 'application/octet-stream', 'CF-Connecting-IP': '203.0.113.9' }, body: bytes,
}), env, ctx);

// ---------------------------------------------------------------------------
// 1. As peças puras
// ---------------------------------------------------------------------------

describe('envioLigado: as três peças da credencial e um SIGNING_SECRET de verdade', () => {
  it('liga só com tudo', () => {
    expect(envioLigado(env)).toBe(true);
    for (const falta of ['GOOGLE_OAUTH_CLIENT_ID', 'GOOGLE_OAUTH_CLIENT_SECRET', 'GOOGLE_OAUTH_REFRESH_TOKEN']) {
      expect(envioLigado({ ...env, [falta]: '  ' })).toBe(false);
    }
    // Sem o segredo o envio fica DESLIGADO, não aberto.
    expect(envioLigado({ ...env, SIGNING_SECRET: '' })).toBe(false);
    expect(envioLigado({ ...env, SIGNING_SECRET: 'curto' })).toBe(false);
  });
});

describe('o selo da sessão', () => {
  const dados = { u: urlDaSessao('X1'), n: 1000, s: 'entrenos2026', x: 'jpg' };

  it('vai e volta, e não deixa o endereço em claro', async () => {
    const selo = await selaSessao(SEGREDO, dados);
    expect(selo).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(selo).not.toContain('upload_id');
    expect(Buffer.from(selo, 'base64url').toString('latin1')).not.toContain('googleapis');
    expect(await abreSessao(SEGREDO, selo)).toMatchObject(dados);
  });

  it('com outro segredo, mexido, curto, longo ou com caracteres de fora: null', async () => {
    const selo = await selaSessao(SEGREDO, dados);
    expect(await abreSessao('t'.repeat(48), selo)).toBeNull();
    const meio = Math.floor(selo.length / 2);
    const mexido = selo.slice(0, meio) + (selo[meio] === 'A' ? 'B' : 'A') + selo.slice(meio + 1);
    expect(await abreSessao(SEGREDO, mexido)).toBeNull();
    expect(await abreSessao(SEGREDO, 'curto')).toBeNull();
    expect(await abreSessao(SEGREDO, 'A'.repeat(4001))).toBeNull();
    expect(await abreSessao(SEGREDO, `${selo}=`)).toBeNull();
    expect(await abreSessao(SEGREDO, 42)).toBeNull();
  });

  it('vence (um dia antes da sessão do Google)', async () => {
    const selo = await selaSessao(SEGREDO, dados);
    const agora = Date.now();
    vi.spyOn(Date, 'now').mockReturnValue(agora + (ENVIO_SESSAO_TTL_SECS + 5) * 1000);
    expect(await abreSessao(SEGREDO, selo)).toBeNull();
  });

  it('não abre selo de sessão que não é do Google, nem com tamanho inválido', async () => {
    expect(await abreSessao(SEGREDO, await selaSessao(SEGREDO, { ...dados, u: 'https://evil.example/upload/drive/v3?upload_id=1' }))).toBeNull();
    expect(await abreSessao(SEGREDO, await selaSessao(SEGREDO, { ...dados, n: 0 }))).toBeNull();
    expect(await abreSessao(SEGREDO, await selaSessao(SEGREDO, { ...dados, s: /** @type {any} */ (7) }))).toBeNull();
  });
});

describe('sessaoDoGoogle: o endereço da sessão tem de ser do Google', () => {
  it('host, protocolo, caminho e upload_id conferidos com new URL()', () => {
    expect(sessaoDoGoogle(urlDaSessao('abc'))).toBe(true);
    for (const u of [
      'http://www.googleapis.com/upload/drive/v3/files?upload_id=1',
      'https://www.googleapis.com.evil.example/upload/drive/v3/files?upload_id=1',
      'https://evil.example/upload/drive/v3/files?upload_id=1&x=www.googleapis.com',
      'https://www.googleapis.com/drive/v3/files?upload_id=1',
      'https://www.googleapis.com/upload/drive/v3/files',
      'não é url', 42, null, `https://www.googleapis.com/upload/drive/?upload_id=${'x'.repeat(2000)}`,
    ]) expect(sessaoDoGoogle(u)).toBe(false);
  });
});

describe('nome, tipo e primeiros bytes', () => {
  it('nomeDeArquivo: só o nome, sem controle, com a extensão de foto ou vídeo', () => {
    expect(nomeDeArquivo('IMG_0001.HEIC')).toBe('IMG_0001.HEIC');
    expect(nomeDeArquivo('pasta/sub\\IMG 1.jpg')).toBe('pasta_sub_IMG 1.jpg');
    expect(nomeDeArquivo('a\u0000b\u2028c\u202fd.mp4')).toBe('abc d.mp4');
    expect(nomeDeArquivo('...oculto.png')).toBe('oculto.png');
    expect(nomeDeArquivo('  espaços   demais .jpg ')).toBe('espaços demais.jpg');
    expect(nomeDeArquivo('Café.jpg')).toBe('Café.jpg');
    for (const ruim of ['virus.exe', 'semextensao', '.jpg', 'x.jpg.exe', 'doc.pdf', 42, null]) expect(nomeDeArquivo(ruim)).toBe('');
    const longo = nomeDeArquivo(`${'x'.repeat(300)}.jpeg`);
    expect(longo.length).toBe(200);
    expect(longo.endsWith('.jpeg')).toBe(true);
  });

  it('extensaoDe e tipoDoArquivo: o tipo vem da extensão, nunca do navegador', () => {
    expect(extensaoDe('A.JPG')).toBe('jpg');
    expect(extensaoDe('sem')).toBe('');
    expect(tipoDoArquivo('a.heic')).toEqual({ ext: 'heic', mime: 'image/heic', video: false });
    expect(tipoDoArquivo('a.MOV')).toEqual({ ext: 'mov', mime: 'video/quicktime', video: true });
    expect(tipoDoArquivo('a.svg')).toBeNull();
    expect(tipoDoArquivo('a.toString')).toBeNull();
    expect(tipoDoArquivo('a.__proto__')).toBeNull();
  });

  it('familiaDosBytes reconhece cada formato pelo começo', () => {
    const de = (/** @type {number[] | string} */ v) => {
      const b = new Uint8Array(16);
      if (typeof v === 'string') for (let i = 0; i < v.length; i++) b[i] = v.charCodeAt(i);
      else b.set(v);
      return b;
    };
    expect(familiaDosBytes(jpeg(20))).toBe('jpeg');
    expect(familiaDosBytes(de([0x89, 0x50, 0x4e, 0x47]))).toBe('png');
    expect(familiaDosBytes(de('GIF89a'))).toBe('gif');
    expect(familiaDosBytes(de('RIFF\0\0\0\0WEBP'))).toBe('webp');
    expect(familiaDosBytes(de([0x1a, 0x45, 0xdf, 0xa3]))).toBe('webm');
    expect(familiaDosBytes(de([0x49, 0x49, 0x2a, 0]))).toBe('tiff');
    expect(familiaDosBytes(de([0x4d, 0x4d, 0, 0x2a]))).toBe('tiff');
    expect(familiaDosBytes(de('\0\0\0\x18ftypheic'))).toBe('bmff');
    expect(familiaDosBytes(de('\0\0\0\x08wide'))).toBe('bmff');
    expect(familiaDosBytes(de('MZ\x90\0'))).toBe('');
    expect(familiaDosBytes(new Uint8Array(4))).toBe('');
  });

  it('bytesConferem: a extensão e o conteúdo têm de ser da mesma família', () => {
    const heic = new TextEncoder().encode('\0\0\0\x18ftypheic\0\0\0\0');
    expect(bytesConferem('jpg', jpeg(20))).toBe(true);
    expect(bytesConferem('heic', heic)).toBe(true);
    expect(bytesConferem('mp4', heic)).toBe(true);
    expect(bytesConferem('jpg', heic)).toBe(false);
    expect(bytesConferem('png', jpeg(20))).toBe(false);
    expect(bytesConferem('exe', jpeg(20))).toBe(false);
  });

  it('fpValido e dataModificada', () => {
    expect(fpValido(FP)).toBe(true);
    for (const v of ['A'.repeat(32), 'a'.repeat(31), 'g'.repeat(32), 1]) expect(fpValido(v)).toBe(false);
    expect(dataModificada(Date.UTC(2026, 5, 14, 21))).toBe('2026-06-14T21:00:00.000Z');
    expect(dataModificada(String(Date.UTC(2020, 0, 1)))).toBe('2020-01-01T00:00:00.000Z');
    for (const v of [0, -1, 'x', Date.UTC(1989, 11, 31), Date.now() + 2 * 86_400_000, NaN, Infinity]) expect(dataModificada(v)).toBe('');
  });
});

describe('a assinatura e o crédito', () => {
  it('limpaAssinatura: letras de qualquer alfabeto, sem link nem e-mail, de 2 a 40', () => {
    expect(limpaAssinatura('  Maria   da  Silva ')).toBe('Maria da Silva');
    expect(limpaAssinatura("D'Ávila-Souza Jr.")).toBe("D'Ávila-Souza Jr.");
    expect(limpaAssinatura('Иван')).toBe('Иван');
    expect(limpaAssinatura('Ana\nBeatriz')).toBe('Ana Beatriz');
    for (const ruim of ['A', 'x'.repeat(41), 'ana@x.com', 'https://x', 'a/b', '1ana', ' ', 7, null, 'ana: oi']) expect(limpaAssinatura(ruim)).toBe('');
  });

  it('descricaoDoEnvio e creditoDaDescricao andam juntas', () => {
    expect(descricaoDoEnvio('Maria')).toBe('Crédito: Maria\nEnviado pelo site do álbum.');
    expect(descricaoDoEnvio('')).toBe('Enviado pelo site do álbum.');
    expect(creditoDaDescricao(descricaoDoEnvio('Maria'))).toBe('Maria');
    expect(creditoDaDescricao('credito:   Joao Pedro')).toBe('Joao Pedro');
    expect(creditoDaDescricao('CRÉDITO: Ana')).toBe('Ana');
    // Só a primeira linha, e só no formato.
    expect(creditoDaDescricao('Foto linda\nCrédito: Ana')).toBe('');
    expect(creditoDaDescricao('Crédito: <script>')).toBe('');
    expect(creditoDaDescricao('Enviado pelo site do álbum.')).toBe('');
    expect(creditoDaDescricao('')).toBe('');
    expect(creditoDaDescricao(undefined)).toBe('');
  });
});

// ---------------------------------------------------------------------------
// 2. O token de acesso
// ---------------------------------------------------------------------------

describe('tokenDeAcesso', () => {
  it('sem credencial: desligado, sem chamar o Google', async () => {
    await expect(tokenDeAcesso({})).rejects.toMatchObject({ codigo: 'desligado' });
    expect(G.tokens).toBe(0);
  });

  it('guardado no isolate; pedidos ao mesmo tempo dividem uma ida ao Google', async () => {
    const [a, b] = await Promise.all([tokenDeAcesso(env), tokenDeAcesso(env)]);
    expect(a).toBe('ya29.token1');
    expect(b).toBe(a);
    expect(await tokenDeAcesso(env)).toBe(a);
    expect(G.tokens).toBe(1);
    expect(await tokenDeAcesso(env, { novo: true })).toBe('ya29.token2');
  });

  it('vence 5 min antes do Google dizer', async () => {
    G.token = () => Response.json({ access_token: `ya29.curto${G.tokens}`, expires_in: 600 });
    await tokenDeAcesso(env);
    const agora = Date.now();
    vi.spyOn(Date, 'now').mockReturnValue(agora + 301_000);
    await tokenDeAcesso(env);
    expect(G.tokens).toBe(2);
  });

  it('credencial recusada (invalid_grant): erro guardado por um minuto, sem repetir o pedido', async () => {
    G.token = () => Response.json({ error: 'invalid_grant', error_description: 'Token has been expired or revoked.' }, { status: 400 });
    await expect(tokenDeAcesso(env)).rejects.toMatchObject({ codigo: 'credencial', message: expect.stringContaining('invalid_grant') });
    await expect(tokenDeAcesso(env)).rejects.toMatchObject({ codigo: 'credencial' });
    expect(G.tokens).toBe(1);
    const agora = Date.now();
    vi.spyOn(Date, 'now').mockReturnValue(agora + 61_000);
    await expect(tokenDeAcesso(env)).rejects.toMatchObject({ codigo: 'credencial' });
    expect(G.tokens).toBe(2);
  });

  it('o motivo do Google é aparado (nada do texto dele vai inteiro)', async () => {
    G.token = () => Response.json({ error: 'x<y>z'.repeat(30) }, { status: 401 });
    const e = await tokenDeAcesso(env).catch(x => x);
    expect(e.message).not.toContain('<');
    expect(e.message).toMatch(/\(xyz[xyz]*\)/);
  });

  it('5xx, 429 e rede: "google", e NÃO fica guardado', async () => {
    for (const resposta of [() => new Response('x', { status: 503 }), () => new Response('x', { status: 429 }), () => { throw new TypeError('rede'); }]) {
      limpaCacheEnvioSite();
      G.tokens = 0;
      G.token = resposta;
      await expect(tokenDeAcesso(env)).rejects.toMatchObject({ codigo: 'google' });
      G.token = null;
      expect(await tokenDeAcesso(env)).toMatch(/^ya29\./);
      expect(G.tokens).toBe(2);
    }
  });

  it('200 sem access_token é recusa, e sem expires_in vale 1 h', async () => {
    G.token = () => Response.json({ token_type: 'Bearer' });
    await expect(tokenDeAcesso(env)).rejects.toMatchObject({ codigo: 'credencial' });
    limpaCacheEnvioSite();
    G.token = () => Response.json({ access_token: 'ya29.sem-prazo' });
    expect(await tokenDeAcesso(env)).toBe('ya29.sem-prazo');
  });
});

// ---------------------------------------------------------------------------
// 3. As chamadas ao Drive, uma a uma
// ---------------------------------------------------------------------------

describe('criaSessao', () => {
  const a = { pasta: PASTA_A, rk: '', nome: 'IMG.jpg', mime: 'image/jpeg', tamanho: 10, fp: FP };

  it('abre com o token (não com a chave de API), na pasta, com fp, descrição e data', async () => {
    const uri = await criaSessao(env, { ...a, rk: 'rk-1', descricao: 'Crédito: Ana\nx', modificado: '2026-06-14T21:00:00.000Z' });
    expect(uri).toMatch(SESSAO_RE);
    const [ab] = G.aberturas;
    expect(ab.headers.get('Authorization')).toBe('Bearer ya29.token1');
    expect(ab.url.searchParams.get('key')).toBeNull();
    expect(ab.url.searchParams.get('supportsAllDrives')).toBe('true');
    expect(ab.headers.get('X-Upload-Content-Type')).toBe('image/jpeg');
    expect(ab.headers.get('X-Upload-Content-Length')).toBe('10');
    expect(ab.headers.get('X-Goog-Drive-Resource-Keys')).toBe(`${PASTA_A}/rk-1`);
    expect(ab.meta).toEqual({
      name: 'IMG.jpg', parents: [PASTA_A], appProperties: { envio: '1', fp: FP },
      description: 'Crédito: Ana\nx', modifiedTime: '2026-06-14T21:00:00.000Z',
    });
  });

  it('pasta ou fp inválidos não chegam ao Google', async () => {
    await expect(criaSessao(env, { ...a, pasta: "x' or '1" })).rejects.toMatchObject({ codigo: 'pasta' });
    await expect(criaSessao(env, { ...a, fp: 'z' })).rejects.toMatchObject({ codigo: 'pasta' });
    expect(G.aberturas).toHaveLength(0);
  });

  it('resource key fora do formato não vai no cabeçalho', async () => {
    await criaSessao(env, { ...a, rk: 'a b' });
    expect(G.aberturas[0].headers.get('X-Goog-Drive-Resource-Keys')).toBeNull();
  });

  it('Location que não é do Google: recusado', async () => {
    G.abrir = () => new Response(null, { status: 200, headers: { Location: 'https://evil.example/upload/drive/v3/files?upload_id=1' } });
    await expect(criaSessao(env, a)).rejects.toMatchObject({ codigo: 'google' });
    G.abrir = () => new Response(null, { status: 200 });
    await expect(criaSessao(env, a)).rejects.toMatchObject({ codigo: 'google' });
  });

  it('401 com o token guardado: pede um novo e tenta UMA vez mais', async () => {
    let n = 0;
    G.abrir = () => (++n === 1 ? new Response('x', { status: 401 }) : new Response(null, { status: 200, headers: { Location: urlDaSessao('Z') } }));
    expect(await criaSessao(env, a)).toBe(urlDaSessao('Z'));
    expect(G.tokens).toBe(2);
    expect(G.aberturas.map(x => x.headers.get('Authorization'))).toEqual(['Bearer ya29.token1', 'Bearer ya29.token2']);
  });

  it('os erros do Google viram códigos nossos', async () => {
    const erro = (/** @type {number} */ status, /** @type {string} */ reason) => () => Response.json({ error: { code: status, errors: [{ reason }] } }, { status });
    const casos = /** @type {[number, string, string][]} */ ([
      [403, 'storageQuotaExceeded', 'cheio'],
      [403, 'quotaExceeded', 'cheio'],
      [401, 'authError', 'credencial'],
      [429, 'x', 'ocupado'],
      [403, 'userRateLimitExceeded', 'ocupado'],
      [403, 'insufficientFilePermissions', 'pasta'],
      [404, 'notFound', 'pasta'],
      [500, 'backendError', 'google'],
      [400, 'invalid', 'google'],
    ]);
    for (const [status, reason, codigo] of casos) {
      G.abrir = erro(status, reason);
      const e = await criaSessao(env, a).catch(x => x);
      expect(e, `${status} ${reason}`).toBeInstanceOf(EnvioError);
      expect(e.codigo, `${status} ${reason}`).toBe(codigo);
    }
    G.abrir = () => new Response('<html>', { status: 502 });
    expect((await criaSessao(env, a).catch(x => x)).codigo).toBe('google');
  });

  it('rede caída: "google"', async () => {
    G.abrir = () => { throw new TypeError('rede'); };
    await expect(criaSessao(env, a)).rejects.toMatchObject({ codigo: 'google' });
  });
});

describe('enviaParte, consultaSessao e cancelaSessao', () => {
  /** @type {string} */
  let uri;
  beforeEach(async () => {
    uri = await criaSessao(env, { pasta: PASTA_A, nome: 'a.jpg', mime: 'image/jpeg', tamanho: 300_000, fp: FP });
  });

  it('308 com Range diz até onde; 200 diz que terminou', async () => {
    const b = jpeg(300_000);
    expect(await consultaSessao(uri, 300_000)).toEqual({ feito: false, pos: 0 });
    expect(await enviaParte(uri, b.subarray(0, ENVIO_PARTE_MULTIPLO), 0, 300_000)).toEqual({ feito: false, pos: ENVIO_PARTE_MULTIPLO });
    expect(await consultaSessao(uri, 300_000)).toEqual({ feito: false, pos: ENVIO_PARTE_MULTIPLO });
    expect(await enviaParte(uri, b.subarray(ENVIO_PARTE_MULTIPLO), ENVIO_PARTE_MULTIPLO, 300_000)).toEqual({ feito: true, id: 'ARQ_U1' });
    expect(await consultaSessao(uri, 300_000)).toEqual({ feito: true, id: 'ARQ_U1' });
  });

  it('fora de posição: desalinhado; sessão morta: sessao; 5xx e rede: ocupado', async () => {
    const b = jpeg(1000);
    await expect(enviaParte(uri, b, 5, 300_000)).rejects.toMatchObject({ codigo: 'desalinhado' });
    G.parte = () => new Response('x', { status: 416 });
    await expect(enviaParte(uri, b, 0, 300_000)).rejects.toMatchObject({ codigo: 'desalinhado' });
    G.parte = () => new Response('x', { status: 503 });
    await expect(enviaParte(uri, b, 0, 300_000)).rejects.toMatchObject({ codigo: 'ocupado' });
    G.parte = () => { throw new TypeError('rede'); };
    await expect(enviaParte(uri, b, 0, 300_000)).rejects.toMatchObject({ codigo: 'ocupado' });
    G.parte = () => Response.json({ error: { errors: [{ reason: 'storageQuotaExceeded' }] } }, { status: 403 });
    await expect(enviaParte(uri, b, 0, 300_000)).rejects.toMatchObject({ codigo: 'cheio' });
    G.parte = () => new Response('x', { status: 410 });
    await expect(enviaParte(uri, b, 0, 300_000)).rejects.toMatchObject({ codigo: 'sessao' });
    G.parte = null;
    await cancelaSessao(uri);
    expect(G.sessoes.get('U1')?.cancelada).toBe(true);
    await expect(consultaSessao(uri, 300_000)).rejects.toMatchObject({ codigo: 'sessao' });
  });

  it('consultaSessao com a rede caída: ocupado; cancelaSessao nunca lança', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new TypeError('rede'); }));
    await expect(consultaSessao(uri, 300_000)).rejects.toMatchObject({ codigo: 'ocupado' });
    await expect(cancelaSessao(uri)).resolves.toBeUndefined();
  });
});

describe('procuraDuplicata', () => {
  it('pergunta à pasta pelo fp, com o token; devolve o ID ou ""', async () => {
    G.duplicadas.set(FP, 'JA_EXISTE_0001');
    expect(await procuraDuplicata(env, PASTA_A, 'rk-1', FP)).toBe('JA_EXISTE_0001');
    expect(await procuraDuplicata(env, PASTA_A, '', FP2)).toBe('');
    const { url, auth } = G.buscas[0];
    expect(auth).toBe('Bearer ya29.token1');
    expect(url.searchParams.get('key')).toBeNull();
    expect(url.searchParams.get('q')).toBe(`'${PASTA_A}' in parents and trashed = false and appProperties has { key='fp' and value='${FP}' }`);
  });

  it('pasta ou fp inválidos: "" sem chamar o Google (nada de injeção na q)', async () => {
    expect(await procuraDuplicata(env, "x' or '1'='1", '', FP)).toBe('');
    expect(await procuraDuplicata(env, PASTA_A, '', "a' or '1")).toBe('');
    expect(G.buscas).toHaveLength(0);
  });

  it('falha da pergunta: "" (melhor repetida do que recusada); credencial ruim: lança', async () => {
    G.buscaFalha = true;
    expect(await procuraDuplicata(env, PASTA_A, '', FP)).toBe('');
    G.token = () => Response.json({ error: 'invalid_grant' }, { status: 400 });
    limpaCacheEnvioSite();
    await expect(procuraDuplicata(env, PASTA_A, '', FP)).rejects.toMatchObject({ codigo: 'credencial' });
    G.token = () => new Response('x', { status: 503 });
    limpaCacheEnvioSite();
    expect(await procuraDuplicata(env, PASTA_A, '', FP)).toBe('');
  });
});

describe('o espaço no Drive', () => {
  it('limite - uso, guardado 5 min', async () => {
    expect(await espacoNoDrive(env)).toBe(90 * GB);
    G.about = { storageQuota: { limit: String(100 * GB), usage: String(99 * GB) } };
    expect(await espacoNoDrive(env)).toBe(90 * GB);
    const agora = Date.now();
    vi.spyOn(Date, 'now').mockReturnValue(agora + 301_000);
    expect(await espacoNoDrive(env)).toBe(GB);
  });

  it('conta sem teto: null (sem limite conhecido); sem credencial: desligado', async () => {
    G.about = { storageQuota: { usage: '5' } };
    expect(await espacoNoDrive(env)).toBeNull();
    await expect(espacoNoDrive({})).rejects.toMatchObject({ codigo: 'desligado' });
  });

  it('cabeNoDrive deixa a margem; sem resposta do Google deixa passar; credencial ruim lança', async () => {
    G.about = { storageQuota: { limit: String(ENVIO_MARGEM_DRIVE_BYTES + 1000), usage: '0' } };
    expect(await cabeNoDrive(env, 1000)).toBe(true);
    expect(await cabeNoDrive(env, 1001)).toBe(false);
    limpaCacheEnvioSite();
    G.aboutFalha = 500;
    expect(await cabeNoDrive(env, 10 * GB)).toBe(true);
    limpaCacheEnvioSite();
    G.token = () => Response.json({ error: 'invalid_grant' }, { status: 400 });
    await expect(cabeNoDrive(env, 1)).rejects.toMatchObject({ codigo: 'credencial' });
  });
});

// ---------------------------------------------------------------------------
// 4. O protocolo inteiro, pelas rotas
// ---------------------------------------------------------------------------

describe('POST /api/envio/passe', () => {
  it('Turnstile + declaração: passe preso ao álbum, e o aceite no registro (D1)', async () => {
    const res = await pedePasse({ nome: '  Maria  Silva ' });
    expect(res.status).toBe(200);
    const j = await res.json();
    expect(j.passe).toMatch(/\S{20,}/);
    expect(G.turnstile).toBe(1);
    await ctx.drena();
    const linhas = /** @type {any[]} */ (db.sqlite.prepare("SELECT * FROM image_use_consent WHERE drive_target = 'envio'").all());
    expect(linhas).toHaveLength(1);
    expect(linhas[0]).toMatchObject({ event_slug: 'entrenos2026', declaration_text: ENVIO_DECLARACAO, consenter_name: 'Maria Silva', turnstile_ok: 1, ip: '203.0.113.9', access_type: 'public' });
    // O passe abre o inicia deste álbum.
    const r = await post('/api/envio/inicia', { slug: 'entrenos2026', passe: j.passe, pasta: PASTA_A, nome: 'a.jpg', tamanho: 10, fp: FP });
    expect(r.status).toBe(200);
  });

  it('sem nome: o aceite vai sem nome', async () => {
    expect((await pedePasse()).status).toBe(200);
    await ctx.drena();
    expect(db.sqlite.prepare("SELECT consenter_name FROM image_use_consent WHERE drive_target = 'envio'").get()).toEqual({ consenter_name: null });
  });

  it('cada recusa antes de gastar o Turnstile', async () => {
    expect((await pedePasse({ aceite: 'true' })).status).toBe(400);
    expect((await pedePasse({ form_token: 'x' })).status).toBe(400);
    expect((await pedePasse({ form_token: await mintFormToken(env, 'outro', { preAged: true }) })).status).toBe(400);
    expect((await pedePasse({ nome: 'ana@x.com' })).status).toBe(400);
    // Ninguém assina como um crédito do álbum.
    const r = await pedePasse({ nome: 'Luca F. Chala' });
    expect(r.status).toBe(400);
    expect((await r.json()).error).toContain('crédito do álbum');
    expect((await pedePasse({ slug: 'outro' })).status).toBe(404);
    expect(G.turnstile).toBe(0);
  });

  it('form_token recém-emitido (rápido demais) e vencido são recusados', async () => {
    expect((await pedePasse({ form_token: await mintFormToken(env, 'envio') })).status).toBe(400);
    const velho = await mintFormToken(env, 'envio', { preAged: true });
    const agora = Date.now();
    vi.spyOn(Date, 'now').mockReturnValue(agora + 3 * 86_400_000);
    const r = await pedePasse({ form_token: velho });
    expect(r.status).toBe(400);
    expect((await r.json()).error).toContain('tempo demais');
  });

  it('Turnstile recusado: sem passe, sem aceite', async () => {
    G.turnstileOk = false;
    expect((await pedePasse()).status).toBe(400);
    await ctx.drena();
    expect(db.sqlite.prepare('SELECT COUNT(*) AS n FROM image_use_consent').get()).toEqual({ n: 0 });
  });

  it('honeypot: 200 com passe vazio, que não abre nada', async () => {
    const r = await pedePasse({ company_website: 'http://spam' });
    expect(await r.json()).toEqual({ ok: true, passe: '' });
    expect((await post('/api/envio/inicia', { slug: 'entrenos2026', passe: '', pasta: PASTA_A, nome: 'a.jpg', tamanho: 10, fp: FP })).status).toBe(401);
  });

  it('envio desligado: 404', async () => {
    delete env.GOOGLE_OAUTH_REFRESH_TOKEN;
    expect((await pedePasse()).status).toBe(404);
  });

  it('álbum "Em breve": 404 para o visitante', async () => {
    await saveEvents(env, [{ ...EVENTO, comingSoon: true, visible: false }]);
    expect((await pedePasse()).status).toBe(404);
  });

  it('D1 recusando o INSERT não derruba o passe (fica no healthz)', async () => {
    env.CONSENT_DB = { prepare() { throw new Error('D1 fora'); } };
    expect((await pedePasse()).status).toBe(200);
    await ctx.drena();
  });

  it('JSON inválido: 400', async () => {
    const r = await worker.fetch(new Request(`${SITE}/api/envio/passe`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{' }), env, ctx);
    expect(r.status).toBe(400);
  });
});

describe('POST /api/envio/inicia', () => {
  it('abre a sessão e devolve só o selo: nem o endereço do Google, nem o token', async () => {
    const res = await inicia({ assinatura: 'Maria Silva' });
    expect(res.status).toBe(200);
    const texto = await res.text();
    expect(texto).not.toContain('googleapis');
    expect(texto).not.toContain('upload_id');
    expect(texto).not.toContain('ya29');
    const j = JSON.parse(texto);
    expect(j).toMatchObject({ ok: true, pos: 0 });
    expect(await abreSessao(SEGREDO, j.sessao)).toMatchObject({ u: urlDaSessao('U1'), n: 300_000, s: 'entrenos2026', x: 'jpg' });
    expect(G.aberturas[0].meta).toMatchObject({
      name: 'IMG_0001.JPG', parents: [PASTA_A], appProperties: { envio: '1', fp: FP },
      description: 'Crédito: Maria Silva\nEnviado pelo site do álbum.', modifiedTime: '2026-06-14T21:00:00.000Z',
    });
  });

  it('assinatura com nome de crédito do álbum, ou inválida: vai sem crédito (não recusa a foto)', async () => {
    await inicia({ assinatura: 'mag' });
    await inicia({ assinatura: 'x@y', fp: FP2 });
    expect(G.aberturas.map(a => a.meta.description)).toEqual(['Enviado pelo site do álbum.', 'Enviado pelo site do álbum.']);
  });

  it('a pasta tem de estar na lista do SERVIDOR (o ID veio do navegador)', async () => {
    expect((await inicia({ pasta: 'EVA_CHALA_01' })).status).toBe(400);
    expect((await inicia({ pasta: 'OUTRA_PASTA_QUALQUER' })).status).toBe(400);
    expect((await inicia({ pasta: "x' or '1" })).status).toBe(400);
    expect((await inicia({ pasta: PASTA_B25 })).status).toBe(200);
    expect(G.aberturas.map(a => a.meta.parents[0])).toEqual([PASTA_B25]);
  });

  it('duplicata: não abre sessão, e devolve a ficha do limite por IP', async () => {
    G.duplicadas.set(FP, 'JA_EXISTE_0001');
    const r = await inicia();
    expect(await r.json()).toEqual({ ok: true, duplicada: true });
    expect(G.aberturas).toHaveLength(0);
  });

  it('passe: sem, de outro álbum, de outro propósito ou vencido → 401 "passe"', async () => {
    const passes = [
      '',
      await signToken(SEGREDO, { purpose: 'envio', scope: 'outro', ttlSecs: 3600 }),
      await signToken(SEGREDO, { purpose: 'galeria', scope: 'entrenos2026', ttlSecs: 3600 }),
      await signToken('t'.repeat(48), { purpose: 'envio', scope: 'entrenos2026', ttlSecs: 3600 }),
    ];
    for (const passe of passes) {
      const r = await inicia({ passe });
      expect(r.status).toBe(401);
      expect((await r.json()).codigo).toBe('passe');
    }
    expect(G.aberturas).toHaveLength(0);
  });

  it('nome, tipo, tamanho e fp conferidos antes de qualquer chamada ao Google', async () => {
    const casos = /** @type {[Record<string, any>, number, string?][]} */ ([
      [{ nome: 'virus.exe' }, 415, 'tipo'],
      [{ nome: 'foto' }, 415, 'tipo'],
      [{ tamanho: 0 }, 400, 'tamanho'],
      [{ tamanho: 1.5 }, 400, 'tamanho'],
      [{ tamanho: ENVIO_MAX_BYTES + 1 }, 413, 'tamanho'],
      [{ fp: 'curto' }, 400],
      [{ pasta: 42 }, 400],
      [{ slug: '../x' }, 400],
    ]);
    for (const [extra, status, codigo] of casos) {
      const r = await inicia(extra);
      expect(r.status, JSON.stringify(extra)).toBe(status);
      if (codigo) expect((await r.json()).codigo).toBe(codigo);
    }
    expect(G.tokens).toBe(0);
    expect(G.aberturas).toHaveLength(0);
  });

  it('Drive sem margem: 507 "cheio", sem abrir sessão', async () => {
    G.about = { storageQuota: { limit: String(ENVIO_MARGEM_DRIVE_BYTES + 100_000), usage: '0' } };
    const r = await inicia();
    expect(r.status).toBe(507);
    expect((await r.json()).codigo).toBe('cheio');
    expect(G.aberturas).toHaveLength(0);
  });

  it('teto do dia por álbum: arquivos e megabytes → 429 "teto"', async () => {
    const c = counterStub(env);
    await c.increment('envio:arquivos:entrenos2026', ENVIO_TETO_ARQUIVOS_DIA);
    let r = await inicia();
    expect(r.status).toBe(429);
    expect((await r.json()).codigo).toBe('teto');
    expect(await c.value(`d:${hojeEmSaoPaulo()}:envio:arquivos:entrenos2026`)).toBe(ENVIO_TETO_ARQUIVOS_DIA + 1);
    expect(G.aberturas).toHaveLength(0);
  });

  it('teto do dia em megabytes: o tamanho prometido conta, arredondado para cima', async () => {
    await counterStub(env).increment('envio:mb:entrenos2026', ENVIO_TETO_MB_DIA);
    let r = await inicia({ tamanho: 1 });
    expect(r.status).toBe(429);
    expect((await r.json()).codigo).toBe('teto');
    // Outro álbum não divide o teto.
    await saveEvents(env, [structuredClone(EVENTO), { ...EVENTO, id: '2', slug: 'outro-album' }]);
    r = await post('/api/envio/inicia', {
      slug: 'outro-album', passe: await signToken(SEGREDO, { purpose: 'envio', scope: 'outro-album', ttlSecs: 3600 }),
      pasta: PASTA_A, nome: 'a.jpg', tamanho: 10, fp: FP,
    });
    expect(r.status).toBe(200);
  });

  it('contador fora do ar: o teto do dia não é conferido (falha aberta, fica no healthz)', async () => {
    env.COUNTER = { idFromName() { return 'x'; }, get() { throw new Error('DO fora'); } };
    expect((await inicia()).status).toBe(200);
  });

  it('erros do Google ao abrir: o texto dele nunca vai à página', async () => {
    const casos = /** @type {[() => Response, number, string][]} */ ([
      [() => Response.json({ error: { message: 'segredo interno da pasta ENVIO_A', errors: [{ reason: 'storageQuotaExceeded' }] } }, { status: 403 }), 507, 'cheio'],
      [() => Response.json({ error: { message: 'segredo interno', errors: [{ reason: 'notFound' }] } }, { status: 404 }), 503, 'pasta'],
      [() => Response.json({ error: { message: 'segredo interno' } }, { status: 500 }), 503, 'ocupado'],
    ]);
    for (const [resposta, status, codigo] of casos) {
      G.abrir = resposta;
      const r = await inicia();
      expect(r.status).toBe(status);
      const texto = await r.text();
      expect(JSON.parse(texto).codigo).toBe(codigo);
      expect(texto).not.toContain('segredo interno');
      expect(texto).not.toContain('ENVIO_A');
    }
    const r = await inicia();
    expect(r.headers.get('Retry-After')).toBe('5');
  });

  it('credencial recusada: 503 "credencial", com a frase de "fora do ar"', async () => {
    G.token = () => Response.json({ error: 'invalid_grant' }, { status: 400 });
    const r = await inicia();
    expect(r.status).toBe(503);
    const j = await r.json();
    expect(j.codigo).toBe('credencial');
    expect(j.error).toContain('pasta do álbum no Google Drive');
  });

  it('álbum fechado, família, sem capítulos ou sem pasta de envio: 404', async () => {
    for (const ev of [{ comingSoon: true, visible: false }, { accessType: 'family' }, { galeriaCapitulos: false }, { galeriaCreditos: 'chala = Luca' }]) {
      await saveEvents(env, [{ ...EVENTO, ...ev }]);
      expect((await inicia()).status, JSON.stringify(ev)).toBe(404);
    }
    // Antes do lançamento o DONO envia (prévia do envio).
    await saveEvents(env, [{ ...EVENTO, comingSoon: true, visible: false }]);
    expect((await post('/api/envio/inicia', {
      slug: 'entrenos2026', passe: await passeValido(), pasta: PASTA_A, nome: 'a.jpg', tamanho: 10, fp: FP,
    }, { Cookie: `__Host-session=${TOKEN_DONO}` })).status).toBe(200);
  });

  it('Drive fora do ar ao listar os eventos: 503 "ocupado"', async () => {
    vi.stubGlobal('fetch', vi.fn(async (/** @type {any} */ i, /** @type {any} */ o) => {
      const u = new URL(typeof i === 'string' ? i : i.url);
      if (u.pathname === '/drive/v3/files') return Response.json({ error: { code: 500 } }, { status: 500 });
      return googleFalso(i, o);
    }));
    const r = await inicia();
    expect(r.status).toBe(503);
    expect((await r.json()).codigo).toBe('ocupado');
  });

  it('envio desligado (sem credencial ou sem segredo): 404', async () => {
    env.GOOGLE_OAUTH_CLIENT_ID = '';
    expect((await inicia()).status).toBe(404);
    expect((await post('/api/envio/inicia', {})).status).toBe(404);
    env.GOOGLE_OAUTH_CLIENT_ID = 'cliente.apps.googleusercontent.com';
    env.SIGNING_SECRET = '';
    expect((await inicia()).status).toBe(404);
  });
});

describe('PUT /api/envio/parte e POST /api/envio/estado', () => {
  const TOTAL = 300_000;
  const arquivo = jpeg(TOTAL);
  /** @type {string} */
  let selo;
  beforeEach(async () => {
    selo = (await (await inicia()).json()).sessao;
  });

  it('o arquivo inteiro, em duas partes: 308 → pos, 200 → feito, e o contador do álbum', async () => {
    let r = await parte(selo, 0, arquivo.subarray(0, ENVIO_PARTE_MULTIPLO));
    expect(await r.json()).toEqual({ pos: ENVIO_PARTE_MULTIPLO });
    r = await post('/api/envio/estado', { sessao: selo });
    expect(await r.json()).toEqual({ pos: ENVIO_PARTE_MULTIPLO });
    r = await parte(selo, ENVIO_PARTE_MULTIPLO, arquivo.subarray(ENVIO_PARTE_MULTIPLO));
    expect(await r.json()).toEqual({ feito: true });
    await ctx.drena();
    // O que chegou ao Drive é byte a byte o arquivo.
    const s = /** @type {Sessao} */ (G.sessoes.get('U1'));
    const junto = new Uint8Array(s.recebido);
    let p = 0;
    for (const x of s.partes) { junto.set(x, p); p += x.byteLength; }
    expect(junto).toEqual(arquivo);
    expect(await (await post('/api/envio/estado', { sessao: selo })).json()).toEqual({ feito: true });
    expect(await counterStub(env).value('envio:feitos:entrenos2026')).toBe(1);
  });

  it('a página e o Google discordam de onde parou: 409 com a posição DO GOOGLE', async () => {
    await parte(selo, 0, arquivo.subarray(0, ENVIO_PARTE_MULTIPLO));
    // A página acha que nada foi (recarregou sem o IndexedDB) e manda do zero.
    const r = await parte(selo, 0, arquivo.subarray(0, ENVIO_PARTE_MULTIPLO));
    expect(r.status).toBe(409);
    expect(await r.json()).toMatchObject({ codigo: 'pos', pos: ENVIO_PARTE_MULTIPLO });
  });

  it('desalinhado mas o Google já tinha terminado: feito', async () => {
    await parte(selo, 0, arquivo.subarray(0, ENVIO_PARTE_MULTIPLO));
    await parte(selo, ENVIO_PARTE_MULTIPLO, arquivo.subarray(ENVIO_PARTE_MULTIPLO));
    const r = await parte(selo, ENVIO_PARTE_MULTIPLO, arquivo.subarray(ENVIO_PARTE_MULTIPLO));
    expect(await r.json()).toEqual({ feito: true });
  });

  it('os primeiros bytes não são do tipo da extensão: 415, e a sessão é cancelada', async () => {
    const falso = new Uint8Array(ENVIO_PARTE_MULTIPLO);
    falso.set([0x4d, 0x5a, 0x90, 0]);
    const r = await parte(selo, 0, falso);
    expect(r.status).toBe(415);
    expect((await r.json()).codigo).toBe('tipo');
    await ctx.drena();
    expect(G.sessoes.get('U1')?.cancelada).toBe(true);
    expect(G.sessoes.get('U1')?.partes).toHaveLength(0);
  });

  it('tamanho da parte: múltiplo de 256 KiB (menos a última), nunca além do arquivo, nunca vazia', async () => {
    expect((await parte(selo, 0, arquivo.subarray(0, 1000))).status).toBe(400);
    expect((await parte(selo, 0, new Uint8Array(0))).status).toBe(400);
    const sobra = new Uint8Array(TOTAL - ENVIO_PARTE_MULTIPLO + 1);
    expect((await parte(selo, ENVIO_PARTE_MULTIPLO, sobra)).status).toBe(400);
    for (const pos of ['-1', 'x', String(TOTAL), '1.5']) {
      const r = await worker.fetch(new Request(`${SITE}/api/envio/parte?pos=${pos}`, { method: 'PUT', headers: { 'X-Envio-Sessao': selo }, body: arquivo.subarray(0, 10) }), env, ctx);
      expect(r.status, pos).toBe(400);
    }
    expect(G.sessoes.get('U1')?.partes).toHaveLength(0);
  });

  it('parte grande demais: 413 pelo Content-Length, antes de ler o corpo', async () => {
    const req = new Request(`${SITE}/api/envio/parte?pos=0`, { method: 'PUT', headers: { 'X-Envio-Sessao': selo, 'Content-Length': String(ENVIO_PARTE_MAX_BYTES + 1) }, body: arquivo.subarray(0, 10) });
    const lido = vi.spyOn(req, 'arrayBuffer');
    const r = await worker.fetch(req, env, ctx);
    expect(r.status).toBe(413);
    expect(lido).not.toHaveBeenCalled();
  });

  it('selo ruim, de outro segredo ou vencido: 410 "sessao" (a página recomeça o arquivo)', async () => {
    const outro = await selaSessao('t'.repeat(48), { u: urlDaSessao('U1'), n: TOTAL, s: 'entrenos2026', x: 'jpg' });
    for (const s of ['', 'x'.repeat(50), outro]) {
      const r = await parte(s, 0, arquivo.subarray(0, ENVIO_PARTE_MULTIPLO));
      expect(r.status).toBe(410);
      expect((await r.json()).codigo).toBe('sessao');
      expect((await post('/api/envio/estado', { sessao: s })).status).toBe(410);
    }
    const agora = Date.now();
    vi.spyOn(Date, 'now').mockReturnValue(agora + (ENVIO_SESSAO_TTL_SECS + 5) * 1000);
    expect((await parte(selo, 0, arquivo.subarray(0, ENVIO_PARTE_MULTIPLO))).status).toBe(410);
  });

  it('sessão encerrada no Google (venceu): 410 "sessao"', async () => {
    /** @type {Sessao} */ (G.sessoes.get('U1')).cancelada = true;
    const r = await parte(selo, 0, arquivo.subarray(0, ENVIO_PARTE_MULTIPLO));
    expect(r.status).toBe(410);
    expect((await r.json()).codigo).toBe('sessao');
    expect((await post('/api/envio/estado', { sessao: selo })).status).toBe(410);
  });

  it('Google ocupado na parte: 503 "ocupado" com Retry-After; Drive cheio no meio: 507', async () => {
    G.parte = () => new Response('x', { status: 503 });
    let r = await parte(selo, 0, arquivo.subarray(0, ENVIO_PARTE_MULTIPLO));
    expect(r.status).toBe(503);
    expect(r.headers.get('Retry-After')).toBe('5');
    expect((await r.json()).codigo).toBe('ocupado');
    G.parte = () => Response.json({ error: { errors: [{ reason: 'storageQuotaExceeded' }] } }, { status: 403 });
    r = await parte(selo, 0, arquivo.subarray(0, ENVIO_PARTE_MULTIPLO));
    expect(r.status).toBe(507);
  });

  it('desalinhado e a pergunta também falha: 503', async () => {
    let n = 0;
    G.parte = () => (++n === 1 ? new Response('x', { status: 400 }) : null);
    vi.stubGlobal('fetch', vi.fn(async (/** @type {any} */ i, /** @type {any} */ o) => {
      const h = new Headers(o?.headers || {});
      if (/^bytes \*\//.test(h.get('Content-Range') || '')) throw new TypeError('rede');
      return googleFalso(i, o);
    }));
    const r = await parte(selo, 0, arquivo.subarray(0, ENVIO_PARTE_MULTIPLO));
    expect(r.status).toBe(503);
  });

  it('o selo vale para o arquivo e o tamanho dele: a página não muda o total', async () => {
    // Mandar como se o arquivo fosse menor (fechar a sessão antes) não passa:
    // o total que vai ao Google é o do selo.
    const r = await parte(selo, 0, arquivo.subarray(0, ENVIO_PARTE_MULTIPLO));
    expect(r.status).toBe(200);
    expect(G.sessoes.get('U1')?.total).toBe(TOTAL);
  });

  it('envio desligado depois de aberto: 404 nas partes e no estado', async () => {
    env.GOOGLE_OAUTH_CLIENT_SECRET = '';
    expect((await parte(selo, 0, arquivo.subarray(0, ENVIO_PARTE_MULTIPLO))).status).toBe(404);
    expect((await post('/api/envio/estado', { sessao: selo })).status).toBe(404);
  });

  it('estado: JSON inválido 400; Google fora 503', async () => {
    const r = await worker.fetch(new Request(`${SITE}/api/envio/estado`, { method: 'POST', body: '{' }), env, ctx);
    expect(r.status).toBe(400);
    vi.stubGlobal('fetch', vi.fn(async () => { throw new TypeError('rede'); }));
    expect((await post('/api/envio/estado', { sessao: selo })).status).toBe(503);
  });
});

describe('o caminho inteiro, como a página faz', () => {
  it('passe → inicia → partes → feito; o mesmo arquivo de novo vira duplicata', async () => {
    const TOTAL = 3 * ENVIO_PARTE_MULTIPLO + 777;
    const arquivo = jpeg(TOTAL);
    const { passe } = await (await pedePasse({ nome: 'Ana' })).json();
    const corpo = { slug: 'entrenos2026', passe, pasta: PASTA_A, nome: 'IMG_9.jpg', tamanho: TOTAL, fp: FP2, assinatura: 'Ana' };
    const { sessao } = await (await post('/api/envio/inicia', corpo)).json();
    let pos = 0;
    /** @type {any} */
    let j = {};
    while (!j.feito) {
      const n = Math.min(ENVIO_PARTE_MULTIPLO * 2, TOTAL - pos);
      j = await (await parte(sessao, pos, arquivo.subarray(pos, pos + n))).json();
      if (!j.feito) pos = j.pos;
    }
    const s = /** @type {Sessao} */ (G.sessoes.get('U1'));
    expect(s.feito).toBe(true);
    expect(s.meta.description).toBe('Crédito: Ana\nEnviado pelo site do álbum.');
    // O Drive agora tem o arquivo com aquele fp.
    G.duplicadas.set(FP2, 'ARQ_U1');
    expect(await (await post('/api/envio/inicia', corpo)).json()).toEqual({ ok: true, duplicada: true });
    expect(G.aberturas).toHaveLength(1);
    // Nenhuma chamada que GRAVA usou a chave de API, e toda chamada do envio
    // levou o token.
    expect(G.auth.every(a => a.startsWith('Bearer ya29.'))).toBe(true);
    for (const u of listagens) expect(u.searchParams.get('key')).toBe('AIzaChaveDeTeste123');
  });
});

// ---------------------------------------------------------------------------
// 5. O healthz e a página
// ---------------------------------------------------------------------------

describe('saudeDoEnvio (o /api/healthz)', () => {
  it('desligado: sem credencial, sem chamar o Google', async () => {
    expect(await saudeDoEnvio({})).toEqual({ estado: 'desligado', livreGb: null, problemas: [] });
    expect(G.tokens).toBe(0);
  });

  it('credencial sem SIGNING_SECRET: falha (o envio fica desligado, e o dono precisa saber)', async () => {
    const s = await saudeDoEnvio({ ...env, SIGNING_SECRET: '' });
    expect(s.estado).toBe('falha');
    expect(s.problemas[0]).toContain('SIGNING_SECRET');
  });

  it('ok, com o espaço livre em GB', async () => {
    expect(await saudeDoEnvio(env)).toEqual({ estado: 'ok', livreGb: 90, problemas: [] });
  });

  it('espaço acabando: ok com aviso; abaixo da margem: falha', async () => {
    G.about = { storageQuota: { limit: String(ENVIO_AVISO_DRIVE_BYTES), usage: String(GB) } };
    let s = await saudeDoEnvio(env);
    expect(s.estado).toBe('ok');
    expect(s.problemas[0]).toContain('acabando');
    limpaCacheEnvioSite();
    G.about = { storageQuota: { limit: String(ENVIO_MARGEM_DRIVE_BYTES), usage: String(GB) } };
    s = await saudeDoEnvio(env);
    expect(s.estado).toBe('falha');
    expect(s.problemas[0]).toContain('RECUSANDO');
  });

  it('credencial recusada: falha; Google sem responder: incerto (não é ok, e não é problema)', async () => {
    G.token = () => Response.json({ error: 'invalid_grant' }, { status: 400 });
    let s = await saudeDoEnvio(env);
    expect(s.estado).toBe('falha');
    expect(s.problemas[0]).toContain('recusou a credencial');
    limpaCacheEnvioSite();
    G.token = () => new Response('x', { status: 503 });
    s = await saudeDoEnvio(env);
    expect(s).toEqual({ estado: 'incerto', livreGb: null, problemas: [] });
  });

  it('token ok mas o espaço não veio: ok sem número', async () => {
    G.aboutFalha = 500;
    expect(await saudeDoEnvio(env)).toEqual({ estado: 'ok', livreGb: null, problemas: [] });
  });
});

describe('GET /galeria/<slug>/enviar (e /enviar no domínio do álbum)', () => {
  const pagina = (/** @type {string} */ u, /** @type {Record<string, string>} */ h = {}) => worker.fetch(new Request(u, { headers: { 'CF-Connecting-IP': ip(), ...h } }), env, ctx);

  it('com o envio ligado: a página, sem cache e fora dos buscadores, com os destinos do servidor', async () => {
    const r = await pagina(`${SITE}/galeria/entrenos2026/enviar?evento=formatura`);
    expect(r.status).toBe(200);
    expect(r.headers.get('Cache-Control')).toBe('private, no-store');
    expect(r.headers.get('X-Robots-Tag')).toContain('noindex');
    const h = await r.text();
    expect(h).toContain('<h1>Mandar suas fotos</h1>');
    const dados = JSON.parse(/** @type {string} */ (h.match(/<script type="application\/json" id="ev-dados"[^>]*>([^<]*)<\/script>/)?.[1]));
    expect(dados.slug).toBe('entrenos2026');
    expect(dados.evento).toBe('formatura');
    expect(dados.destinos.map((/** @type {any} */ d) => d.p)).toEqual([PASTA_A, PASTA_B25]);
    expect(dados.destinos[1]).toMatchObject({ evento: 'Interclasse', rotulo: '2025', url: `https://drive.google.com/drive/folders/${PASTA_B25}` });
    expect(dados.token).toMatch(/\S{20,}/);
    // A página nunca carrega segredo do Google.
    expect(h).not.toContain('segredo-do-cliente');
    expect(h).not.toContain('1//refresh');
  });

  it('?evento= que não é slug some', async () => {
    const h = await (await pagina(`${SITE}/galeria/entrenos2026/enviar?evento=${encodeURIComponent('"><x')}`)).text();
    expect(h).toContain('"evento":""');
  });

  it('no domínio do álbum, /enviar', async () => {
    const r = await pagina('https://entrenos2026.com/enviar');
    expect(r.status).toBe(200);
    expect(await r.text()).toContain('Mandar suas fotos');
  });

  it('Drive fora do ar (sem lista guardada): 503', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => Response.json({ error: { code: 500 } }, { status: 500 })));
    expect((await pagina(`${SITE}/galeria/entrenos2026/enviar`)).status).toBe(503);
  });

  it('desligado, fechado ou sem pasta de envio: 404', async () => {
    env.GOOGLE_OAUTH_REFRESH_TOKEN = '';
    expect((await pagina(`${SITE}/galeria/entrenos2026/enviar`)).status).toBe(404);
    env.GOOGLE_OAUTH_REFRESH_TOKEN = '1//refresh';
    await saveEvents(env, [{ ...EVENTO, comingSoon: true, visible: false }]);
    expect((await pagina(`${SITE}/galeria/entrenos2026/enviar`)).status).toBe(404);
    expect((await pagina(`${SITE}/galeria/entrenos2026/enviar`, { Cookie: `__Host-session=${TOKEN_DONO}` })).status).toBe(200);
    await saveEvents(env, [{ ...EVENTO, galeriaCreditos: 'chala = Luca' }]);
    expect((await pagina(`${SITE}/galeria/entrenos2026/enviar`)).status).toBe(404);
  });

  it('albumRecebeEnvio: o botão do álbum leva à página só com tudo no lugar', () => {
    expect(albumRecebeEnvio(env, /** @type {any} */ (EVENTO))).toBe(true);
    expect(albumRecebeEnvio({ ...env, GOOGLE_OAUTH_CLIENT_ID: '' }, /** @type {any} */ (EVENTO))).toBe(false);
    expect(albumRecebeEnvio(env, /** @type {any} */ ({ ...EVENTO, accessType: 'family' }))).toBe(false);
    expect(albumRecebeEnvio(env, /** @type {any} */ ({ ...EVENTO, galeriaCapitulos: false }))).toBe(false);
    expect(albumRecebeEnvio(env, /** @type {any} */ ({ ...EVENTO, galeriaCreditos: 'chala = Luca\noutros = Turma' }))).toBe(false);
  });

  it('a página do álbum: com o envio ligado o botão vai para /enviar; desligado, para a pasta do Drive', async () => {
    await saveEvents(env, [{ ...EVENTO, galeriaAbertura: 'Oi, turma.' }]);
    let h = await (await pagina(`${SITE}/galeria/entrenos2026`)).text();
    expect(h).toContain('<a class="al-btn al-b2 al-mandar" href="/galeria/entrenos2026/enviar">');
    expect(h).not.toContain('id="al-env"');
    h = await (await pagina('https://entrenos2026.com/')).text();
    expect(h).toContain('href="/enviar"');
    env.GOOGLE_OAUTH_REFRESH_TOKEN = '';
    h = await (await pagina(`${SITE}/galeria/entrenos2026`)).text();
    expect(h).toContain('data-acao="mandar-fotos"');
    expect(h).not.toContain('/enviar"');
  });
});

// ---------------------------------------------------------------------------
// 6. A listagem: crédito assinado e os dias do evento
// ---------------------------------------------------------------------------

describe('o crédito assinado na listagem', () => {
  const RAIZ2 = 'RAIZ_LISTA_0001';
  const foto = (/** @type {string} */ id, /** @type {string} */ descricao) => ({
    id, name: `${id}.jpg`, mimeType: 'image/jpeg', size: '1000', ...(descricao ? { description: descricao } : {}),
    imageMediaMetadata: { width: 10, height: 10, time: '2026:06:14 21:00:00' },
  });
  /** @type {Record<string, any[]>} */
  let arvore;
  beforeEach(() => {
    arvore = {
      [RAIZ2]: [pasta('L_ENVIO_00001', ENVIO), pasta('L_CHALA_00001', 'chala')],
      L_ENVIO_00001: [
        foto('F_ANA_0000001', 'Crédito: Ana Souza\nEnviado pelo site do álbum.'),
        foto('F_ANA_0000002', 'Crédito: Ana Souza'),
        foto('F_SEM_0000003', 'Enviado pelo site do álbum.'),
        foto('F_FALSO_00004', 'Crédito: Luca F. Chala'),
        foto('F_FALSO_00005', 'Crédito: mag'),
        foto('F_RUIM_000006', 'Crédito: https://spam'),
        foto('F_NADA_000007', ''),
      ],
      // Na pasta do fotógrafo a descrição não muda crédito nenhum.
      L_CHALA_00001: [foto('F_CHALA_00008', 'Crédito: Outra Pessoa')],
    };
    vi.stubGlobal('fetch', vi.fn(async (/** @type {any} */ i) => {
      const u = new URL(typeof i === 'string' ? i : i.url);
      const id = (u.searchParams.get('q') || '').match(/^'([^']+)' in parents/)?.[1] || '';
      return Response.json({ files: arvore[id] || [] });
    }));
  });
  const autorDe = (/** @type {any} */ d, /** @type {string} */ id) => {
    for (const s of d.secoes) for (const f of s.fotos) if (f[0] === id) return d.aut[Number(f[5]) || 0];
    return undefined;
  };

  it('só dentro de pasta de envio, nunca com nome de crédito do álbum', async () => {
    const d = await listaPasta(env, { id: RAIZ2, resourceKey: '' }, { creditos: CREDITOS });
    expect(autorDe(d, 'F_ANA_0000001')).toBe('Ana Souza');
    expect(autorDe(d, 'F_ANA_0000002')).toBe('Ana Souza');
    expect(d.aut.filter((/** @type {string} */ a) => a === 'Ana Souza')).toHaveLength(1);
    for (const id of ['F_SEM_0000003', 'F_FALSO_00004', 'F_FALSO_00005', 'F_RUIM_000006', 'F_NADA_000007']) expect(autorDe(d, id), id).toBe('Turma 2026');
    expect(autorDe(d, 'F_CHALA_00008')).toBe('Luca F. Chala');
    expect(d.aut).not.toContain('Outra Pessoa');
    // O campo que traz a descrição é pedido ao Drive.
    const u = new URL(/** @type {any} */ (vi.mocked(fetch).mock.calls[0][0]));
    expect(u.searchParams.get('fields')).toContain('description');
  });

  it('teto de nomes por lista: daí em diante, o crédito da pasta', async () => {
    arvore.L_ENVIO_00001 = Array.from({ length: ENVIO_ASSINATURAS_POR_LISTA + 5 }, (_, i) => foto(`F_MUITOS_${String(i).padStart(4, '0')}`, `Crédito: Pessoa ${String.fromCharCode(65 + (i % 26))}${String.fromCharCode(65 + Math.floor(i / 26))}`));
    const d = await listaPasta(env, { id: RAIZ2, resourceKey: '' }, { creditos: CREDITOS });
    const assinadas = d.aut.filter((/** @type {string} */ a) => a.startsWith('Pessoa '));
    expect(assinadas).toHaveLength(ENVIO_ASSINATURAS_POR_LISTA);
    expect(autorDe(d, `F_MUITOS_${String(ENVIO_ASSINATURAS_POR_LISTA + 4).padStart(4, '0')}`)).toBe('Turma 2026');
  });
});

describe('os dias do evento no resumo (dd)', () => {
  beforeEach(() => { vi.stubGlobal('caches', fakeCaches()); });
  /** Uma foto com a hora AAAAMMDDhhmmss que a listagem guarda. */
  const f = (/** @type {number} */ hora, /** @type {number} */ i) => [`FOTO_${String(i).padStart(9, '0')}`, 10, 10, `${i}.jpg`, 100, 0, hora];
  const listagem = (/** @type {number[]} */ horas) => ({
    v: 3, pasta: 'CAP_00000001', em: '2026-11-06T12:00:00.000Z', truncada: false, total: horas.length, videos: 0, outros: 0, rk: {}, aut: ['Turma'],
    secoes: [{ nome: '', caminho: '', fotos: horas.map(f) }],
  });

  it('os dias com mais fotos, em ordem; a foto solta de um relógio errado não entra', async () => {
    const horas = [
      ...Array(30).fill(20250614210000), ...Array(20).fill(20250615013000),
      ...Array(10).fill(20250613180000), 20190101120000,
    ];
    await registraResumo('RAIZ_DD_00001', 'CAP_00000001', /** @type {any} */ (listagem(horas)), env);
    const r = await lerResumo('RAIZ_DD_00001', env);
    expect(r.CAP_00000001.dd).toEqual([20250613, 20250614, 20250615]);
  });

  it('no máximo RESUMO_DIAS_MAX dias; sem foto datada, sem dd', async () => {
    const horas = Array.from({ length: 20 }, (_, i) => Array(3).fill(20250601120000 + i * 1000000)).flat();
    await registraResumo('RAIZ_DD_00002', 'CAP_00000001', /** @type {any} */ (listagem(horas)), env);
    expect((await lerResumo('RAIZ_DD_00002', env)).CAP_00000001.dd).toHaveLength(RESUMO_DIAS_MAX);
    await registraResumo('RAIZ_DD_00003', 'CAP_00000001', /** @type {any} */ (listagem([0, 0])), env);
    expect((await lerResumo('RAIZ_DD_00003', env)).CAP_00000001.dd).toBeUndefined();
  });
});
