// Busca pelo rosto (v3.2). O que estes testes prendem:
//  1. a assinatura SigV4 é a mesma do botocore (vetor gerado pela biblioteca
//     oficial da AWS) e o erro da AWS vira um tipo curto;
//  2. a busca: quem saiu não é achado; sem rosto e sem índice têm resposta
//     própria; resultado sem foto oculta, sem repetição, do mais parecido ao
//     menos;
//  3. "Não quero aparecer": guarda o rosto na coleção de quem saiu e apaga os
//     parecidos do índice;
//  4. as rotas: 404 com a busca desligada, sem chave da AWS ou em álbum
//     restrito; aceite, token do formulário e Turnstile exigidos; teto por IP;
//  5. o índice da galeria só mostra o botão quando a busca vale;
//  6. o contrato com o indexador: ele lê da página o que a página escreve.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import worker, { mintFormToken, normalizeEventFields } from '../src/index.js';
import { assinaV4, rekognition, base64, ErroAws } from '../src/aws.js';
import { buscaPorRosto, sairDaBusca, imagemValida, idExterno, lerIdExterno, colecoes, credAws } from '../src/rosto.js';
import { galeriaIndiceHTML } from '../src/ui/galeria-indice.js';
import { galeriaHTML } from '../src/ui/galeria.js';
import { fotosDaPagina, capitulosDoIndice } from '../scripts/rosto-indexa.mjs';
import { saveEvents } from '../src/utils.js';
import { ROSTO_IMAGEM_MAX_B64, ROSTO_BUSCA_IP_BUCKET } from '../src/config.js';
import { withDurableObjects } from './helpers/do.js';

const CRED = { chave: 'AKIDEXAMPLE', segredo: 'wJalrXUtnFEMI/K7MDENG+bPxRfiCYEXAMPLEKEY', regiao: 'sa-east-1' };
const SELFIE = '/9j/' + 'A'.repeat(196);
const FACE = (/** @type {string} */ ext, /** @type {number} */ sim, id = '11111111-2222-3333-4444-555555555555') => ({ Similarity: sim, Face: { FaceId: id, ExternalImageId: ext } });

describe('assinatura SigV4', () => {
  it('é a mesma do botocore para a mesma requisição', async () => {
    // Gerado com botocore 1.40.72 (SigV4Auth, rekognition, sa-east-1).
    const h = await assinaV4({
      metodo: 'POST', host: 'rekognition.sa-east-1.amazonaws.com', regiao: 'sa-east-1', servico: 'rekognition',
      chave: CRED.chave, segredo: CRED.segredo, agora: new Date('2026-11-06T18:23:14Z'),
      corpo: '{"CollectionId":"fotos-x","Image":{"Bytes":"AAAA"},"MaxFaces":5}',
      cabecalhos: { 'Content-Type': 'application/x-amz-json-1.1', 'X-Amz-Target': 'RekognitionService.SearchFacesByImage' },
    });
    expect(h['X-Amz-Date']).toBe('20261106T182314Z');
    expect(h.Authorization).toBe('AWS4-HMAC-SHA256 Credential=AKIDEXAMPLE/20261106/sa-east-1/rekognition/aws4_request, '
      + 'SignedHeaders=content-type;host;x-amz-date;x-amz-target, Signature=1bd34e04036cd420af0455fe4498f193ea1f356051156642a43127b41f9c7e3d');
  });

  it('o erro da AWS vira o tipo curto, e a resposta boa vira objeto', async () => {
    const f = vi.fn(async () => Response.json({ __type: 'com.amazonaws.rekognition#InvalidParameterException', Message: 'no faces' }, { status: 400 }));
    await expect(rekognition(CRED, 'SearchFacesByImage', {}, { fetch: f })).rejects.toMatchObject({ tipo: 'InvalidParameterException', status: 400 });
    const [url, init] = f.mock.calls[0];
    expect(url).toBe('https://rekognition.sa-east-1.amazonaws.com/');
    expect(init.headers['X-Amz-Target']).toBe('RekognitionService.SearchFacesByImage');
    const ok = vi.fn(async () => Response.json({ FaceMatches: [] }));
    expect(await rekognition(CRED, 'SearchFacesByImage', {}, { fetch: ok })).toEqual({ FaceMatches: [] });
  });

  it('base64 de bytes grandes sem estourar a pilha', () => {
    const b = new Uint8Array(200_000).fill(255);
    expect(base64(b)).toBe(Buffer.from(b).toString('base64'));
  });
});

describe('peças da busca', () => {
  it('ExternalImageId vai e volta; lixo é recusado', () => {
    expect(lerIdExterno(idExterno('cap-1', 'FOTO_AAAAAAAA01'))).toEqual({ cap: 'cap-1', id: 'FOTO_AAAAAAAA01' });
    expect(lerIdExterno(idExterno('', 'FOTO_AAAAAAAA01'))).toEqual({ cap: '', id: 'FOTO_AAAAAAAA01' });
    for (const v of ['saiu', 'X:curto', 'Cap Grande:FOTO_AAAAAAAA01', 42, null]) expect(lerIdExterno(v)).toBeNull();
  });

  it('a selfie é conferida por forma: JPEG/PNG em base64, com teto', () => {
    expect(imagemValida(SELFIE)).toBe(true);
    expect(imagemValida('iVBORw0KGgo' + 'A'.repeat(197))).toBe(true);
    expect(imagemValida('R0lGOD' + 'A'.repeat(194))).toBe(false);
    expect(imagemValida('/9j/' + 'A'.repeat(ROSTO_IMAGEM_MAX_B64))).toBe(false);
    expect(imagemValida('/9j/' + 'A'.repeat(95) + '!')).toBe(false);
    expect(imagemValida(123)).toBe(false);
  });

  it('as credenciais: sem chave, a busca não existe; região inválida cai em São Paulo', () => {
    expect(credAws(/** @type {any} */ ({}))).toBeNull();
    expect(credAws(/** @type {any} */ ({ AWS_ACCESS_KEY_ID: 'a', AWS_SECRET_ACCESS_KEY: 'b', AWS_REGION: 'lixo' }))?.regiao).toBe('sa-east-1');
    expect(credAws(/** @type {any} */ ({ AWS_ACCESS_KEY_ID: 'a', AWS_SECRET_ACCESS_KEY: 'b', AWS_REGION: 'us-east-1' }))?.regiao).toBe('us-east-1');
  });
});

/** Uma Rekognition falsa: guarda as chamadas e responde por operação+coleção. */
function awsFalsa(/** @type {Record<string, any>} */ respostas) {
  /** @type {{ op: string, corpo: any }[]} */
  const chamadas = [];
  const f = vi.fn(async (/** @type {string} */ _url, /** @type {any} */ init) => {
    const op = init.headers['X-Amz-Target'].split('.')[1];
    const corpo = JSON.parse(init.body);
    chamadas.push({ op, corpo });
    const r = respostas[`${op} ${corpo.CollectionId}`] ?? respostas[op];
    if (r instanceof Error) return Response.json({ __type: r.message }, { status: 400 });
    return Response.json(r ?? {});
  });
  return { f, chamadas };
}

describe('buscaPorRosto', () => {
  const c = colecoes('album');
  it('resultado sem oculta, sem repetição e do mais parecido ao menos', async () => {
    const { f, chamadas } = awsFalsa({
      [`SearchFacesByImage ${c.sair}`]: { FaceMatches: [] },
      [`SearchFacesByImage ${c.principal}`]: { FaceMatches: [
        FACE('cap-a:FOTO_AAAAAAAA01', 91.24), FACE('cap-a:FOTO_AAAAAAAA01', 99.5), FACE('cap-b:FOTO_BBBBBBBB02', 95),
        FACE('cap-b:FOTO_OCULTA00003', 99.9), FACE('lixo', 99), FACE(':FOTO_SEMCAP0004', 92),
      ] },
    });
    const r = await buscaPorRosto(CRED, 'album', SELFIE, ['FOTO_OCULTA00003'], { fetch: f });
    expect(r).toMatchObject({ tipo: 'ok', resultados: [
      { cap: 'cap-a', id: 'FOTO_AAAAAAAA01', sim: 99.5 }, { cap: 'cap-b', id: 'FOTO_BBBBBBBB02', sim: 95 }, { cap: '', id: 'FOTO_SEMCAP0004', sim: 92 },
    ] });
    // As fotos de 99,5 e 95 viram sementes (a oculta de 99,9 não): duas SearchFaces a mais.
    expect(chamadas.map(x => `${x.op} ${x.corpo.CollectionId}`)).toEqual([`SearchFacesByImage ${c.sair}`, `SearchFacesByImage ${c.principal}`, `SearchFaces ${c.principal}`, `SearchFaces ${c.principal}`]);
    expect(chamadas[1].corpo.Image.Bytes).toBe(SELFIE);
  });

  it('busca em duas etapas: as sementes acham a pessoa de lado, abaixo dos achados diretos', async () => {
    const { f, chamadas } = awsFalsa({
      [`SearchFacesByImage ${c.principal}`]: { FaceMatches: [
        { Similarity: 99.2, Face: { FaceId: 'semente-1', ExternalImageId: 'a:FOTO_AAAAAAAA01' } },
        { Similarity: 98.5, Face: { FaceId: 'semente-1b', ExternalImageId: 'a:FOTO_AAAAAAAA01' } },
        { Similarity: 98.1, Face: { FaceId: 'semente-2', ExternalImageId: 'b:FOTO_BBBBBBBB02' } },
        { Similarity: 94.9, Face: { FaceId: 'nao-vira', ExternalImageId: 'c:FOTO_CCCCCCCC03' } },
      ] },
      SearchFaces: { FaceMatches: [FACE('d:FOTO_DELADO0004', 95), FACE('a:FOTO_AAAAAAAA01', 99)] },
    });
    const r = await buscaPorRosto(CRED, 'album', SELFIE, [], { fetch: f, temSair: false });
    // Sementes só de fotos diferentes e de 95 para cima; quem saiu não é consultado (temSair: false).
    const buscas = chamadas.filter(x => x.op === 'SearchFaces');
    // As sementes procuram em paralelo: a ordem de chegada das chamadas varia.
    expect(buscas.map(x => x.corpo.FaceId).sort()).toEqual(['semente-1', 'semente-2']);
    expect(chamadas[0].op).toBe('SearchFacesByImage');
    expect(chamadas.filter(x => x.op === 'SearchFacesByImage')).toHaveLength(1);
    expect(r.tipo === 'ok' && r.resultados.map(x => x.id)).toEqual(['FOTO_AAAAAAAA01', 'FOTO_BBBBBBBB02', 'FOTO_CCCCCCCC03', 'FOTO_DELADO0004']);
    // A de lado entra com a semelhança vezes a da semente: 95 × 0,992 = 94,2.
    expect(r.tipo === 'ok' && r.resultados[3].sim).toBe(94.2);
  });

  it('semente que falha não derruba a busca', async () => {
    const { f } = awsFalsa({
      [`SearchFacesByImage ${c.principal}`]: { FaceMatches: [FACE('a:FOTO_AAAAAAAA01', 99.9)] },
      SearchFaces: new Error('ThrottlingException'),
    });
    expect(await buscaPorRosto(CRED, 'album', SELFIE, [], { fetch: f, temSair: false })).toMatchObject({ tipo: 'ok', resultados: [{ cap: 'a', id: 'FOTO_AAAAAAAA01', sim: 99.9 }] });
  });

  it('quem saiu da busca não é achado', async () => {
    const { f, chamadas } = awsFalsa({ [`SearchFacesByImage ${c.sair}`]: { FaceMatches: [FACE('saiu', 97)] } });
    expect(await buscaPorRosto(CRED, 'album', SELFIE, [], { fetch: f })).toEqual({ tipo: 'saiu' });
    expect(chamadas).toHaveLength(1);
  });

  it('sem coleção de quem saiu, segue; sem índice do álbum, avisa; sem rosto, avisa', async () => {
    const semSair = awsFalsa({ [`SearchFacesByImage ${c.sair}`]: new Error('ResourceNotFoundException'), [`SearchFacesByImage ${c.principal}`]: { FaceMatches: [] } });
    expect(await buscaPorRosto(CRED, 'album', SELFIE, [], { fetch: semSair.f })).toMatchObject({ tipo: 'ok', resultados: [] });
    const semIndice = awsFalsa({ [`SearchFacesByImage ${c.sair}`]: new Error('ResourceNotFoundException'), [`SearchFacesByImage ${c.principal}`]: new Error('ResourceNotFoundException') });
    expect(await buscaPorRosto(CRED, 'album', SELFIE, [], { fetch: semIndice.f })).toEqual({ tipo: 'sem-indice' });
    const semRosto = awsFalsa({ SearchFacesByImage: new Error('InvalidParameterException') });
    expect(await buscaPorRosto(CRED, 'album', SELFIE, [], { fetch: semRosto.f })).toEqual({ tipo: 'sem-rosto' });
  });

  it('a AWS acelerando sobe como ErroAws (a rota responde 429)', async () => {
    const { f } = awsFalsa({ SearchFacesByImage: new Error('ThrottlingException') });
    await expect(buscaPorRosto(CRED, 'album', SELFIE, [], { fetch: f })).rejects.toBeInstanceOf(ErroAws);
  });
});

describe('sairDaBusca', () => {
  const c = colecoes('album');
  it('guarda o rosto em quem saiu e apaga os parecidos do índice', async () => {
    const { f, chamadas } = awsFalsa({
      CreateCollection: new Error('ResourceAlreadyExistsException'),
      IndexFaces: { FaceRecords: [{ Face: { FaceId: 'x' } }] },
      [`SearchFacesByImage ${c.principal}`]: { FaceMatches: [FACE('a:FOTO_AAAAAAAA01', 90, 'aaaaaaaa-0000-0000-0000-000000000001'), FACE('b:FOTO_BBBBBBBB02', 86, 'aaaaaaaa-0000-0000-0000-000000000002')] },
      DeleteFaces: { DeletedFaces: ['aaaaaaaa-0000-0000-0000-000000000001', 'aaaaaaaa-0000-0000-0000-000000000002'] },
    });
    expect(await sairDaBusca(CRED, 'album', SELFIE, { fetch: f })).toEqual({ tipo: 'ok', removidas: 2 });
    expect(chamadas.map(x => `${x.op} ${x.corpo.CollectionId}`)).toEqual([
      `CreateCollection ${c.sair}`, `IndexFaces ${c.sair}`, `SearchFacesByImage ${c.principal}`, `DeleteFaces ${c.principal}`,
    ]);
    expect(chamadas[3].corpo.FaceIds).toEqual(['aaaaaaaa-0000-0000-0000-000000000001', 'aaaaaaaa-0000-0000-0000-000000000002']);
  });

  it('sem rosto na selfie, nada é guardado', async () => {
    const { f, chamadas } = awsFalsa({ IndexFaces: { FaceRecords: [] } });
    expect(await sairDaBusca(CRED, 'album', SELFIE, { fetch: f })).toEqual({ tipo: 'sem-rosto' });
    expect(chamadas.map(x => x.op)).toEqual(['CreateCollection', 'IndexFaces']);
  });
});

// --- Rotas ----------------------------------------------------------------
const SITE = 'https://fotos.lucafchala.com';
const EVENTO = { id: '1', slug: 'album', title: 'Álbum', accessType: 'public', galeriaCapitulos: true, buscaRosto: true, driveUrl: 'https://drive.google.com/drive/folders/RAIZ_PASTA_0001', fotosOcultas: ['FOTO_OCULTA00003'] };
const ctx = { waitUntil() {} };
function kv() {
  const store = new Map();
  return { async get(/** @type {string} */ k) { return store.has(k) ? store.get(k) : null; }, async put(/** @type {string} */ k, /** @type {string} */ v) { store.set(k, v); },
    async delete(/** @type {string} */ k) { store.delete(k); }, async list() { return { keys: [], list_complete: true, cursor: null }; } };
}

/** @type {any} */ let env;
let turnstileOk = true;
/** @type {any[]} */ let awsChamadas;
beforeEach(() => {
  turnstileOk = true;
  awsChamadas = [];
  vi.stubGlobal('fetch', vi.fn(async (/** @type {any} */ input, /** @type {any} */ init = {}) => {
    const url = new URL(typeof input === 'string' ? input : input.url);
    if (url.host === 'challenges.cloudflare.com') return Response.json({ success: turnstileOk });
    if (url.host === 'rekognition.sa-east-1.amazonaws.com') {
      const op = init.headers['X-Amz-Target'].split('.')[1];
      const corpo = JSON.parse(init.body);
      awsChamadas.push({ op, corpo });
      if (op === 'SearchFacesByImage' && corpo.CollectionId === 'fotos-album-sair') return Response.json({ FaceMatches: [] });
      if (op === 'SearchFacesByImage') return Response.json({ FaceMatches: [FACE('cap-a:FOTO_AAAAAAAA01', 98), FACE('cap-a:FOTO_OCULTA00003', 99)] });
      if (op === 'IndexFaces') return Response.json({ FaceRecords: [{ Face: { FaceId: 'x' } }] });
      if (op === 'DeleteFaces') return Response.json({ DeletedFaces: corpo.FaceIds });
      return Response.json({});
    }
    return new Response('nao esperado', { status: 599 });
  }));
  env = withDurableObjects({ FOTOS: kv(), TURNSTILE_SECRET_KEY: 'ts', SIGNING_SECRET: 's'.repeat(48), AWS_ACCESS_KEY_ID: 'AKIDTESTE', AWS_SECRET_ACCESS_KEY: 'segredo' });
});
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });

/** @param {Record<string, any>} [extra] @param {string} [rota] @param {string} [ip] */
async function busca(extra = {}, rota = '/api/rosto/buscar', ip = '203.0.113.9') {
  const corpo = { slug: 'album', imagem: SELFIE, aceite: true, turnstileToken: 'tok', company_website: '', form_token: await mintFormToken(env, 'busca-rosto', { preAged: true }), ...extra };
  return worker.fetch(new Request(SITE + rota, { method: 'POST', headers: { 'Content-Type': 'application/json', 'CF-Connecting-IP': ip }, body: JSON.stringify(corpo) }), env, ctx);
}

describe('/api/rosto/buscar e /api/rosto/sair', () => {
  it('busca: devolve as fotos sem as ocultas e não guarda nada', async () => {
    await saveEvents(env, [structuredClone(EVENTO)]);
    const res = await busca();
    expect(res.status).toBe(200);
    expect(res.headers.get('Cache-Control')).toBe('no-store');
    // faces (v3.8.3): o rosto DO ÍNDICE que achou a pessoa (98% vira semente), para atualizar depois sem selfie.
    // k (v3.8.8): o álbum e a assinatura que o endereço da foto (/f/) exige.
    expect(await res.json()).toEqual({ ok: true, saiu: false, semIndice: false, resultados: [{ cap: 'cap-a', id: 'FOTO_AAAAAAAA01', sim: 98, k: expect.stringMatching(/^album\.[\w-]{8}$/) }], faces: ['11111111-2222-3333-4444-555555555555'] });
    // Ninguém saiu deste álbum: a coleção de quem saiu nem é consultada.
    expect(awsChamadas.map(c => `${c.op} ${c.corpo.CollectionId}`)).toEqual(['SearchFacesByImage fotos-album', 'SearchFaces fotos-album']);
  });

  it('atualizar (v3.8.3): sem selfie, só os rostos guardados procuram no índice; sem rosto válido, 400; Turnstile antes da AWS', async () => {
    await saveEvents(env, [structuredClone(EVENTO)]);
    const face = '11111111-2222-3333-4444-555555555555';
    const res = await busca({ imagem: undefined, faces: [face, 'nao-e-uuid', face] }, '/api/rosto/atualizar');
    expect(res.status).toBe(200);
    expect(res.headers.get('Cache-Control')).toBe('no-store');
    expect(awsChamadas.map(c => `${c.op} ${c.corpo.FaceId || ''}`)).toEqual([`SearchFaces ${face}`]);
    expect(awsChamadas[0].corpo.FaceMatchThreshold).toBe(80);
    expect((await busca({ imagem: undefined, faces: [] }, '/api/rosto/atualizar')).status).toBe(400);
    awsChamadas = [];
    turnstileOk = false;
    expect((await busca({ imagem: undefined, faces: [face] }, '/api/rosto/atualizar')).status).toBe(403);
    expect(awsChamadas).toEqual([]);
  });

  it('depois que alguém sai, toda busca consulta quem saiu', async () => {
    await saveEvents(env, [structuredClone(EVENTO)]);
    expect((await busca({}, '/api/rosto/sair')).status).toBe(200);
    awsChamadas = [];
    expect((await busca()).status).toBe(200);
    expect(awsChamadas[0]).toMatchObject({ op: 'SearchFacesByImage', corpo: { CollectionId: 'fotos-album-sair' } });
  });

  it('404 com a busca desligada, em álbum restrito, oculto ou sem as chaves da AWS', async () => {
    for (const muda of [{ buscaRosto: false }, { accessType: 'family' }, { accessType: 'private' }, { visible: false }]) {
      await saveEvents(env, [{ ...structuredClone(EVENTO), ...muda }]);
      expect((await busca()).status).toBe(404);
    }
    await saveEvents(env, [structuredClone(EVENTO)]);
    delete env.AWS_SECRET_ACCESS_KEY;
    expect((await busca()).status).toBe(404);
    expect(awsChamadas).toEqual([]);
  });

  it('sem aceite, sem token do formulário, com Turnstile recusado ou foto inválida: recusa antes da AWS', async () => {
    await saveEvents(env, [structuredClone(EVENTO)]);
    expect((await busca({ aceite: false })).status).toBe(400);
    expect((await busca({ form_token: 'x' })).status).toBe(403);
    expect((await busca({ imagem: 'R0lGOD' + 'A'.repeat(194) })).status).toBe(400);
    turnstileOk = false;
    expect((await busca()).status).toBe(403);
    expect(awsChamadas).toEqual([]);
  });

  it('o teto por IP responde 429 com Retry-After', async () => {
    await saveEvents(env, [structuredClone(EVENTO)]);
    for (let i = 0; i < ROSTO_BUSCA_IP_BUCKET.capacity; i++) await busca({}, '/api/rosto/buscar', '198.51.100.7');
    const res = await busca({}, '/api/rosto/buscar', '198.51.100.7');
    expect(res.status).toBe(429);
    expect(Number(res.headers.get('Retry-After'))).toBeGreaterThan(0);
  }, 60_000);

  it('a AWS acelerando vira 429; outra falha vira 503 sem vazar a mensagem', async () => {
    await saveEvents(env, [structuredClone(EVENTO)]);
    vi.stubGlobal('fetch', vi.fn(async (/** @type {any} */ input) => {
      const url = new URL(typeof input === 'string' ? input : input.url);
      if (url.host === 'challenges.cloudflare.com') return Response.json({ success: true });
      return Response.json({ __type: 'ThrottlingException' }, { status: 400 });
    }));
    expect((await busca()).status).toBe(429);
    vi.stubGlobal('fetch', vi.fn(async (/** @type {any} */ input) => {
      const url = new URL(typeof input === 'string' ? input : input.url);
      if (url.host === 'challenges.cloudflare.com') return Response.json({ success: true });
      return Response.json({ __type: 'AccessDeniedException', message: 'arn:aws:iam::123:user/segredo' }, { status: 400 });
    }));
    const res = await busca();
    expect(res.status).toBe(503);
    expect(await res.text()).not.toContain('arn:aws');
  });

  it('sair: guarda o rosto e apaga os parecidos', async () => {
    await saveEvents(env, [structuredClone(EVENTO)]);
    const res = await busca({}, '/api/rosto/sair');
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, removidas: 1 });
    expect(awsChamadas.map(c => `${c.op} ${c.corpo.CollectionId}`)).toEqual(['CreateCollection fotos-album-sair', 'IndexFaces fotos-album-sair', 'SearchFacesByImage fotos-album', 'DeleteFaces fotos-album']);
  });

  it('o painel grava a opção como booleano', () => {
    expect(normalizeEventFields({ buscaRosto: true }, { slug: 'x' }, []).buscaRosto).toBe(true);
    expect(normalizeEventFields({ buscaRosto: 'sim' }, { slug: 'x' }, []).buscaRosto).toBe(false);
    expect(normalizeEventFields({}, { slug: 'x' }, []).buscaRosto).toBe(false);
  });
});

// --- Página e indexador ----------------------------------------------------
const CAPS = {
  v: /** @type {1} */ (1), pasta: 'RAIZ_PASTA_0001', em: '2026-11-06T12:00:00.000Z', truncada: false,
  caps: [{ id: 'CAPITULO0000001', rk: '', bruto: 'Cap A', nome: 'Cap A', slug: 'cap-a' }, { id: 'CAPITULO0000002', rk: '', bruto: 'Cap B', nome: 'Cap B', slug: 'cap-b' }],
};

describe('índice da galeria com a busca', () => {
  /** @param {any} rosto @param {Record<string, any>} [ev] */
  const pagina = (rosto, ev = {}) => galeriaIndiceHTML({ event: /** @type {any} */ ({ ...EVENTO, ...ev }), caps: CAPS, resumo: {}, ocultas: [], dono: false, indexavel: true, nonce: 'N', rosto });

  it('com a busca valendo: botão (escondido até o script ligar), diálogo, aceite e os dados', () => {
    const h = pagina({ token: 'TOK' });
    expect(h).toContain('id="rs-abrir" hidden>Achar minhas fotos pelo rosto</button>');
    expect(h).toContain('<dialog class="rs" id="rs"');
    expect(h).toContain('id="rs-aceite"');
    expect(h).toContain('capture="user"');
    const dados = JSON.parse(/** @type {RegExpMatchArray} */ (h.match(/<script type="application\/json" id="rs-dados" nonce="N">(.*?)<\/script>/))[1]);
    expect(dados).toMatchObject({ slug: 'album', token: 'TOK', caps: { 'cap-a': 'Cap A', 'cap-b': 'Cap B' } });
  });

  it('sem a busca (ou em álbum restrito), nada disso aparece', () => {
    for (const h of [pagina(null), pagina({ token: 'TOK' }, { accessType: 'family' })]) {
      expect(h).not.toContain('rs-abrir');
      expect(h).not.toContain('id="rs-dados"');
    }
  });

  it('o script da busca não usa nada que um template literal estragaria', () => {
    const h = pagina({ token: 'TOK' });
    const script = /** @type {RegExpMatchArray} */ (h.match(/<script nonce="N">(\(function \(\) \{\n {2}var el = document\.getElementById\('rs-dados'\)[\s\S]*?)<\/script>/))[1];
    expect(() => new Function(script)).not.toThrow();
  });

  it('o servidor só entrega o token quando a busca vale', async () => {
    await saveEvents(env, [{ ...structuredClone(EVENTO), buscaRosto: false }]);
    const { buscaRostoAtiva } = await import('../src/index.js');
    expect(buscaRostoAtiva(env, { ...EVENTO, buscaRosto: false })).toBe(false);
    expect(buscaRostoAtiva(env, EVENTO)).toBe(true);
    expect(buscaRostoAtiva({ ...env, AWS_ACCESS_KEY_ID: '' }, EVENTO)).toBe(false);
  });
});

describe('contrato página → indexador', () => {
  it('o indexador acha os capítulos no índice', () => {
    const h = galeriaIndiceHTML({ event: /** @type {any} */ (EVENTO), caps: CAPS, resumo: {}, ocultas: [], dono: false, indexavel: true, nonce: 'N' });
    expect(capitulosDoIndice(h, 'album')).toEqual(['cap-a', 'cap-b']);
  });

  it('o indexador lê as fotos da página do capítulo e pula os vídeos', () => {
    const foto = (/** @type {string} */ id, extra = /** @type {any} */ (undefined)) => /** @type {any} */ ([id, 6000, 4000, `${id}.jpg`, 1000, 0, undefined, extra]);
    const listagem = {
      v: /** @type {2} */ (2), pasta: 'CAPITULO0000001', em: '2026-11-06T12:00:00.000Z', truncada: false, total: 3, videos: 1, outros: 0, rk: {},
      aut: ['Luca F. Chala'],
      secoes: [{ nome: '', caminho: '', fotos: [foto('FOTO_AAAAAAAA01'), foto('VIDEO_VVVVVVV01', 12), foto('FOTO_BBBBBBBB02')] }],
    };
    const h = galeriaHTML({ event: /** @type {any} */ (EVENTO), listagem, listagemBruta: listagem, capitulo: { slug: 'cap-a', nome: 'Cap A', anterior: null, proximo: null }, erro: null, nonce: 'N', dono: false, formToken: '' });
    expect(fotosDaPagina(h)).toMatchObject({ cap: 'cap-a', ids: ['FOTO_AAAAAAAA01', 'FOTO_BBBBBBBB02'] });
  });
});

describe('limiares da busca pelo rosto (v3.7.3: na dúvida, mostrar)', () => {
  it('a saída da busca apaga tudo o que a busca acharia; a busca é generosa', async () => {
    const c = await import('../src/config.js');
    expect(c.ROSTO_LIMIAR).toBeLessThanOrEqual(80);
    expect(c.ROSTO_LIMIAR_SAIR).toBeLessThan(c.ROSTO_LIMIAR);
    // v3.8.2: a busca vai até ROSTO_LIMIAR_BUSCA ("Talvez seja você"); a saída fica abaixo dela também.
    expect(c.ROSTO_LIMIAR_SAIR).toBeLessThan(c.ROSTO_LIMIAR_BUSCA);
    expect(c.ROSTO_LIMIAR_BUSCA).toBeLessThan(c.ROSTO_LIMIAR);
    expect(c.ROSTO_SEMENTE_MIN).toBeGreaterThan(c.ROSTO_LIMIAR_SEMENTE);
  });

  it('a busca no álbum não descarta selfie de qualidade baixa; o indexador põe todo rosto', async () => {
    const { readFile } = await import('node:fs/promises');
    const rosto = await readFile(new URL('../src/rosto.js', import.meta.url), 'utf8');
    expect(rosto).toMatch(/CollectionId: c\.principal, Image, MaxFaces: 4096, FaceMatchThreshold: ROSTO_LIMIAR_BUSCA, QualityFilter: 'NONE'/);
    const idx = await readFile(new URL('../scripts/rosto-indexa.mjs', import.meta.url), 'utf8');
    expect(idx).toContain("const QUALIDADE = 'NONE';");
    expect(idx).toContain('QualityFilter: QUALIDADE');
  });
});
