// "Não quero aparecer na busca" (v3.8.9; revisão de nov/2026, achados 5, 6 e 7).
// O que estes testes prendem, com uma Rekognition de mentira que GUARDA rostos
// (tests/helpers/rekognition.js) — no fim de cada cenário dá para perguntar o
// que ficou no índice:
//  1. a saída vale para as fotos que chegam DEPOIS: o indexador apaga os
//     rostos de quem saiu logo depois de indexar, e a busca não mostra nada a
//     quem saiu — na régua mais baixa da busca, não na mais alta;
//  2. o dono vê as saídas no painel e desfaz uma (alguém tirou outra pessoa);
//     há um teto por dia no site inteiro, com UM alerta ao dono;
//  3. excluir o projeto apaga as coleções na AWS e as inscrições de aviso;
//     desligar a busca apaga o índice depois do prazo, e religar cancela.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import worker, { mintFormToken } from '../src/index.js';
import { buscaPorRosto, atualizaPorFaces, sairDaBusca, colecoes, MARCA_SAIU } from '../src/rosto.js';
import { apagaIndicesVencidos, listaSaidas, marcaIndiceParaApagar } from '../src/saidas.js';
import { inscreve } from '../src/aviso.js';
import { saveEvents } from '../src/utils.js';
import { ROSTO_LIMIAR, ROSTO_LIMIAR_BUSCA, ROSTO_LIMIAR_SAIR, ROSTO_SAIR_POR_DIA, ROSTO_APAGA_APOS_DESLIGAR_H, AVISO_INSCRICAO_TTL_S } from '../src/config.js';
import { withDurableObjects } from './helpers/do.js';
import { rekognitionFalsa } from './helpers/rekognition.js';

const CRED = { chave: 'AKIDEXAMPLE', segredo: 'segredo', regiao: 'sa-east-1' };
const SLUG = 'album';
const C = colecoes(SLUG);
// Uma "selfie" por pessoa: base64 com cara de JPEG, do tamanho que a rota aceita.
const selfie = (/** @type {string} */ letra) => '/9j/' + letra.repeat(196);
const F = (/** @type {number} */ n) => `FOTO_DO_ALBUM_${String(n).padStart(4, '0')}`;
// Uma semelhança entre a régua da saída (65) e a do "certeza" (80): a mesma
// pessoa de lado, ou com pouca luz. É a faixa que a 3.8.8 deixava passar.
const DE_LADO = 72;

/** KV de mentira com metadados, validade e lista por prefixo. */
function kv() {
  /** @type {Map<string, { v: string, m?: any, ttl?: number }>} */
  const m = new Map();
  return {
    m,
    async get(/** @type {string} */ k) { return m.has(k) ? /** @type {any} */ (m.get(k)).v : null; },
    async getWithMetadata(/** @type {string} */ k) { const x = m.get(k); return { value: x ? x.v : null, metadata: x ? x.m ?? null : null }; },
    async put(/** @type {string} */ k, /** @type {string} */ v, /** @type {any} */ o = {}) { m.set(k, { v, m: o.metadata, ttl: o.expirationTtl }); },
    async delete(/** @type {string} */ k) { m.delete(k); },
    async list(/** @type {{ prefix?: string }} */ o = {}) {
      return { keys: [...m.keys()].filter(k => k.startsWith(o.prefix || '')).sort().map(name => ({ name, metadata: /** @type {any} */ (m.get(name)).m })), list_complete: true, cursor: null };
    },
  };
}

afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); vi.restoreAllMocks(); vi.useRealTimers(); });

// ---------------------------------------------------------------------------
describe('1. a regra, direto na Rekognition de mentira', () => {
  /** @type {ReturnType<typeof rekognitionFalsa>} */
  let aws;
  const o = () => ({ fetch: /** @type {any} */ ((/** @type {any} */ i, /** @type {any} */ init) => Promise.resolve(aws.atende(i, init))) });
  beforeEach(() => {
    aws = rekognitionFalsa({ parecidos: { 'ana|ana-de-lado': DE_LADO, 'ana|prima-da-ana': 50 } });
    aws.imagem(selfie('A'), ['ana']);
    aws.imagem(selfie('B'), ['bia']);
    aws.imagem(selfie('L'), ['ana-de-lado']);
    aws.imagem(selfie('P'), ['prima-da-ana']);
    aws.semeia(C.principal, `cap:${F(1)}`, ['ana', 'bia']);
    aws.semeia(C.principal, `cap:${F(2)}`, ['ana-de-lado']);
    aws.semeia(C.principal, `cap:${F(3)}`, ['prima-da-ana', 'bia']);
  });

  it('a faixa do teste é a que importa: entre a régua da saída e a do "certeza"', () => {
    expect(DE_LADO).toBeGreaterThanOrEqual(ROSTO_LIMIAR_SAIR);
    expect(DE_LADO).toBeGreaterThanOrEqual(ROSTO_LIMIAR_BUSCA);
    expect(DE_LADO).toBeLessThan(ROSTO_LIMIAR);
  });

  it('sair: a marca fica no índice do álbum, os parecidos saem (até os "de lado") e os dos outros ficam', async () => {
    const r = await sairDaBusca(CRED, SLUG, selfie('A'), o());
    expect(r).toMatchObject({ tipo: 'ok', removidas: 2, repetida: false });
    const ficou = /** @type {any[]} */ (aws.rostos(C.principal));
    expect(ficou.filter(f => f.pessoa === 'ana' || f.pessoa === 'ana-de-lado').map(f => f.ext)).toEqual([MARCA_SAIU]);
    expect(ficou.filter(f => f.pessoa === 'bia')).toHaveLength(2);
    // Quem só lembra a pessoa (abaixo da régua da saída) não é apagado.
    expect(ficou.filter(f => f.pessoa === 'prima-da-ana')).toHaveLength(1);
    // Nada vai para a coleção antiga.
    expect(aws.rostos(C.sair)).toBeNull();
  });

  it('a mesma pessoa pedindo de novo não vira uma segunda marca', async () => {
    const a = await sairDaBusca(CRED, SLUG, selfie('A'), o());
    const b = await sairDaBusca(CRED, SLUG, selfie('A'), o());
    expect(b).toMatchObject({ tipo: 'ok', repetida: true, marca: /** @type {any} */ (a).marca });
    expect(/** @type {any[]} */ (aws.rostos(C.principal)).filter(f => f.ext === MARCA_SAIU)).toHaveLength(1);
  });

  it('sem rosto na selfie, nada é guardado', async () => {
    expect(await sairDaBusca(CRED, SLUG, selfie('Z'), o())).toEqual({ tipo: 'sem-rosto' });
    expect(/** @type {any[]} */ (aws.rostos(C.principal)).some(f => f.ext === MARCA_SAIU)).toBe(false);
  });

  it('quem saiu não é achado nem numa foto nova que o indexador ainda não limpou — nem com a selfie "de lado"', async () => {
    await sairDaBusca(CRED, SLUG, selfie('A'), o());
    // Uma foto nova da Ana entra no índice (o indexador acabou de indexar).
    aws.semeia(C.principal, `cap:${F(9)}`, ['ana']);
    expect(await buscaPorRosto(CRED, SLUG, selfie('A'), [], { ...o(), temSair: false })).toEqual({ tipo: 'saiu' });
    // A selfie de lado parece 72% com a marca: abaixo de 80, acima da régua da busca.
    expect(await buscaPorRosto(CRED, SLUG, selfie('L'), [], { ...o(), temSair: false })).toEqual({ tipo: 'saiu' });
    // A marca nunca é resultado, nem semente, para os outros.
    const bia = await buscaPorRosto(CRED, SLUG, selfie('B'), [], { ...o(), temSair: false });
    expect(bia).toMatchObject({ tipo: 'ok' });
    expect(/** @type {any} */ (bia).resultados.map((/** @type {any} */ x) => x.id).sort()).toEqual([F(1), F(3)]);
  });

  it('"minhas fotos" guardadas no aparelho de quem saiu não acham a foto nova', async () => {
    // O aparelho guardou um rosto do índice antes da saída; a saída não o alcançou
    // (cenário: o rosto guardado foi reindexado). Ele parece com a marca: não acha nada.
    await sairDaBusca(CRED, SLUG, selfie('A'), o());
    const [guardado] = aws.semeia(C.principal, `cap:${F(8)}`, ['ana']);
    aws.semeia(C.principal, `cap:${F(9)}`, ['ana']);
    expect((await atualizaPorFaces(CRED, SLUG, [guardado], [], o())).resultados).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
describe('1. o indexador: a saída vale para as fotos que chegam depois', () => {
  const SITE = 'https://site.test';
  const TOKEN = 't'.repeat(40);
  const CAP = 'evento-a';
  /** @type {ReturnType<typeof rekognitionFalsa>} */
  let aws;
  /** @type {any} */
  let estado;
  /** @type {string[]} */
  let fotos;
  /** @type {string[]} */
  let log;

  const pagina = () => `<html><script type="application/json" id="g-dados" nonce="n">${JSON.stringify({ slug: SLUG, cap: CAP, secoes: [{ nome: '', fotos: fotos.map(id => [id, 3000, 2000, `${id}.jpg`, 1000]) }], autores: ['Fulano'] })}</script></html>`;
  const indice = () => `<html><a class="ix-card" href="/galeria/${SLUG}/${CAP}"><span class="ix-nome">Evento A</span></a></html>`;

  beforeEach(() => {
    log = [];
    vi.spyOn(console, 'log').mockImplementation((...a) => { log.push(a.map(String).join(' ')); });
    aws = rekognitionFalsa({ parecidos: { 'ana|ana-de-lado': DE_LADO } });
    aws.imagem(selfie('A'), ['ana']);
    aws.imagem(selfie('B'), ['bia']);
    fotos = [F(1), F(2)];
    aws.imagemDeBytes(`BYTES-${F(1)}`, ['ana', 'bia']);
    aws.imagemDeBytes(`BYTES-${F(2)}`, ['bia']);
    // Fotos que chegam depois: a Ana de frente num grupo (ela NÃO é o maior
    // rosto), a Ana de lado sozinha, e uma só da Bia.
    aws.imagemDeBytes(`BYTES-${F(3)}`, ['bia', 'ana']);
    aws.imagemDeBytes(`BYTES-${F(4)}`, ['ana-de-lado']);
    aws.imagemDeBytes(`BYTES-${F(5)}`, ['bia']);
    estado = { vistas: [], descritas: [], qualidade: '', geracao: 0, limpar: false, origem: 'vazio', geracaoPedida: 0, rosto: true };
    vi.stubGlobal('fetch', vi.fn(async (/** @type {any} */ input, /** @type {any} */ init = {}) => {
      const url = new URL(typeof input === 'string' ? input : input.url);
      if (url.origin === SITE) {
        if (url.pathname === '/api/busca/estado') {
          if (init.method === 'POST') { estado = { ...estado, ...JSON.parse(init.body), origem: 'guardado' }; return Response.json({ ok: true }); }
          return Response.json(estado);
        }
        if (url.pathname === '/api/busca/indexar') return Response.json({ ok: true, marcadas: 0, escondidas: 0 });
        return new Response(url.pathname === `/galeria/${SLUG}` ? indice() : pagina());
      }
      if (url.host === 'lh3.googleusercontent.com') return new Response(`BYTES-${url.pathname.replace('/d/', '').split('=')[0]}`);
      return aws.atende(input, init) || new Response('nao esperado', { status: 599 });
    }));
    vi.stubEnv('ROSTO_PASSO_MS', '0');
    vi.stubEnv('ROSTO_SLUGS', SLUG);
    vi.stubEnv('ROSTO_SITE', SITE);
    vi.stubEnv('ROSTO_INDEXADOR_TOKEN', TOKEN);
    vi.stubEnv('ROSTO_DESCREVER', '0');
    vi.stubEnv('AWS_ACCESS_KEY_ID', 'AKIDTESTE');
    vi.stubEnv('AWS_SECRET_ACCESS_KEY', 'segredo');
    vi.stubEnv('GITHUB_ACTIONS', 'true');
  });

  async function indexa() {
    vi.resetModules();
    await (await import('../scripts/rosto-indexa.mjs')).principal();
  }
  const noIndice = (/** @type {string} */ pessoa) => /** @type {any[]} */ (aws.rostos(C.principal)).filter(f => f.pessoa === pessoa).map(f => f.ext).sort();
  const sai = (/** @type {string} */ letra) => sairDaBusca(CRED, SLUG, selfie(letra), { fetch: /** @type {any} */ ((/** @type {any} */ i, /** @type {any} */ init) => Promise.resolve(aws.atende(i, init))) });

  it('fotos novas de quem saiu não ficam no índice: nem de frente num grupo, nem de lado', async () => {
    await indexa();
    expect(noIndice('ana')).toEqual([`${CAP}:${F(1)}`]);
    await sai('A');
    expect(noIndice('ana')).toEqual([MARCA_SAIU]);
    // Chegam três fotos novas.
    fotos = [F(1), F(2), F(3), F(4), F(5)];
    await indexa();
    expect(noIndice('ana')).toEqual([MARCA_SAIU]);
    expect(noIndice('ana-de-lado')).toEqual([]);
    // A Bia segue em todas as dela, inclusive na foto de grupo com a Ana.
    expect(noIndice('bia')).toEqual([F(1), F(2), F(3), F(5)].map(id => `${CAP}:${id}`));
    expect(log.join('\n')).toContain('2 rostos apagados (de quem saiu da busca)');
    // E as fotos da Ana não voltam a ser indexadas na execução seguinte.
    const antes = aws.ops('IndexFaces').length;
    await indexa();
    expect(aws.ops('IndexFaces').length).toBe(antes);
    expect(estado.limpar).toBe(false);
  });

  it('quem sai DURANTE uma execução do indexador também é limpo no fim dela', async () => {
    fotos = [F(1), F(2), F(3)];
    // A saída acontece logo depois da primeira foto indexada.
    let feito = false;
    aws.falha('IndexFaces', corpo => {
      if (!feito && corpo.ExternalImageId !== MARCA_SAIU && aws.ops('IndexFaces').length >= 2) { feito = true; Promise.resolve().then(() => sai('A')); }
      return null;
    });
    await indexa();
    // Dá tempo de a saída (assíncrona) terminar antes de conferir.
    await new Promise(r => setTimeout(r, 20));
    aws.semFalhas();
    fotos = [F(1), F(2), F(3), F(5)];
    await indexa();
    expect(noIndice('ana')).toEqual([MARCA_SAIU]);
  });

  it('execução que caiu depois de indexar e antes de limpar: a seguinte limpa, mesmo sem foto nova', async () => {
    await indexa();
    await sai('A');
    // O que a execução interrompida deixou: o rosto da Ana de volta, e a dívida anotada.
    aws.semeia(C.principal, `${CAP}:${F(2)}`, ['ana']);
    estado = { ...estado, limpar: true };
    await indexa();
    expect(noIndice('ana')).toEqual([MARCA_SAIU]);
    expect(estado.limpar).toBe(false);
  });

  it('a dívida da limpeza é gravada ANTES de indexar', async () => {
    /** @type {boolean[]} */
    const naHoraDeIndexar = [];
    aws.falha('IndexFaces', () => { naHoraDeIndexar.push(estado.limpar === true); return null; });
    await indexa();
    expect(naHoraDeIndexar.length).toBe(2);
    expect(naHoraDeIndexar.every(Boolean)).toBe(true);
  });

  it('refazer o índice (filtro novo ou pedido do painel) nunca apaga a marca de quem saiu', async () => {
    await indexa();
    await sai('A');
    estado = { ...estado, geracaoPedida: 1 };
    await indexa();
    expect(log.join('\n')).toContain('pedido do painel para refazer o índice');
    expect(noIndice('ana')).toEqual([MARCA_SAIU]);
    expect(noIndice('bia')).toEqual([`${CAP}:${F(1)}`, `${CAP}:${F(2)}`]);
    expect(estado.geracao).toBe(1);
    // Atendido uma vez: a execução seguinte não apaga de novo.
    const apagadas = aws.ops('DeleteFaces').length;
    await indexa();
    expect(aws.ops('DeleteFaces').length).toBe(apagadas);
  });

  it('depois de desfeita a saída, refazer o índice traz a pessoa de volta', async () => {
    await indexa();
    const r = /** @type {any} */ (await sai('A'));
    // O dono desfaz: a marca sai e o pedido de refazer sobe.
    aws.atende('https://rekognition.sa-east-1.amazonaws.com/', { headers: { 'X-Amz-Target': 'RekognitionService.DeleteFaces' }, body: JSON.stringify({ CollectionId: C.principal, FaceIds: [r.marca] }) });
    estado = { ...estado, geracaoPedida: 1 };
    await indexa();
    expect(noIndice('ana')).toEqual([`${CAP}:${F(1)}`]);
  });

  it('a marca não é tratada como foto que saiu do álbum', async () => {
    await indexa();
    await sai('A');
    await indexa();
    await indexa();
    expect(noIndice('ana')).toEqual([MARCA_SAIU]);
  });

  it('busca pelo rosto desligada no painel: nenhum rosto é indexado e a coleção nem é criada', async () => {
    estado = { ...estado, rosto: false };
    await indexa();
    expect(aws.chamadas.map(c => c.op)).toEqual([]);
    expect(aws.rostos(C.principal)).toBeNull();
    expect(log.join('\n')).toContain('busca pelo rosto desligada no painel');
  });
});

// ---------------------------------------------------------------------------
describe('2 e 3. as rotas', () => {
  const SITE = 'https://fotos.lucafchala.com';
  const SESSAO = 'e'.repeat(64);
  const EVENTO = { id: '1', slug: SLUG, title: 'Álbum de teste', accessType: 'public', galeriaCapitulos: true, buscaRosto: true, driveUrl: 'https://drive.google.com/drive/folders/RAIZ_PASTA_0001' };
  const ctx = { waitUntil() {} };
  /** @type {any} */ let env;
  /** @type {ReturnType<typeof rekognitionFalsa>} */ let aws;
  /** @type {any[]} */ let emails;

  beforeEach(async () => {
    aws = rekognitionFalsa();
    emails = [];
    for (const l of 'ABCDEFGH') aws.imagem(selfie(l), [`pessoa-${l}`]);
    aws.semeia(C.principal, `cap:${F(1)}`, ['pessoa-A', 'pessoa-B']);
    aws.semeia(C.principal, `cap:${F(2)}`, ['pessoa-A']);
    vi.stubGlobal('fetch', vi.fn(async (/** @type {any} */ input, /** @type {any} */ init = {}) => {
      const url = new URL(typeof input === 'string' ? input : input.url);
      if (url.host === 'challenges.cloudflare.com') return Response.json({ success: true });
      if (url.host === 'api.resend.com') { emails.push(JSON.parse(init.body)); return Response.json({ id: 'x' }); }
      return aws.atende(input, init) || new Response('nao esperado', { status: 599 });
    }));
    const FOTOS = kv();
    await FOTOS.put(`admin_session:${SESSAO}`, JSON.stringify({ createdAt: Date.now() }));
    env = withDurableObjects({ FOTOS, TURNSTILE_SECRET_KEY: 'ts', SIGNING_SECRET: 's'.repeat(48), AWS_ACCESS_KEY_ID: 'AKIDTESTE', AWS_SECRET_ACCESS_KEY: 'segredo', RESEND_API_KEY: 're_x', ADMIN_EMAIL: 'dono@site.test', ROSTO_INDEXADOR_TOKEN: 't'.repeat(40) });
    await saveEvents(env, [structuredClone(EVENTO)]);
  });

  /** @param {string} letra @param {string} [ip] @param {string} [rota] */
  async function publico(letra, ip = '203.0.113.9', rota = '/api/rosto/sair') {
    const corpo = { slug: SLUG, imagem: selfie(letra), aceite: true, turnstileToken: 'tok', company_website: '', form_token: await mintFormToken(env, 'busca-rosto', { preAged: true }) };
    return worker.fetch(new Request(SITE + rota, { method: 'POST', headers: { 'Content-Type': 'application/json', 'CF-Connecting-IP': ip }, body: JSON.stringify(corpo) }), env, ctx);
  }
  /** @param {string} caminho @param {RequestInit & { anonimo?: boolean }} [init] */
  const dono = (caminho, init = {}) => worker.fetch(new Request(SITE + caminho, {
    ...init, headers: { 'Content-Type': 'application/json', Origin: SITE, 'CF-Connecting-IP': '198.51.100.1', ...(init.anonimo ? {} : { Cookie: `__Host-session=${SESSAO}` }) },
  }), env, ctx);
  const marcas = () => /** @type {any[]} */ (aws.rostos(C.principal) || []).filter(f => f.ext === MARCA_SAIU);

  it('sair pela rota: a marca no índice, a anotação para o painel (sem foto nenhuma) e a busca responde "saiu"', async () => {
    const res = await publico('A');
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, removidas: 2 });
    expect(marcas()).toHaveLength(1);
    const lista = await listaSaidas(env, SLUG);
    expect(lista).toEqual([{ id: marcas()[0].id, em: expect.any(Number), removidas: 2 }]);
    // O que o KV guarda de uma saída: a data e a contagem. Nenhum ID de foto.
    expect(JSON.stringify([...env.FOTOS.m.entries()].filter(([k]) => k.startsWith('rosto-saiu:')))).not.toContain('FOTO_');
    const busca = await (await publico('A', '203.0.113.9', '/api/rosto/buscar')).json();
    expect(busca).toMatchObject({ ok: true, saiu: true, resultados: [] });
    // A coleção antiga não é consultada por quem saiu pela marca nova.
    expect(aws.chamadas.some(c => c.corpo.CollectionId === C.sair)).toBe(false);
  });

  it('a lista e o desfazer são só do dono', async () => {
    await publico('A');
    expect((await dono(`/api/rosto/saidas?slug=${SLUG}`, { anonimo: true })).status).toBe(401);
    expect((await dono('/api/rosto/desfazer', { method: 'POST', body: JSON.stringify({ slug: SLUG, id: marcas()[0].id }), anonimo: true })).status).toBe(401);
    expect(marcas()).toHaveLength(1);
    const lista = await (await dono(`/api/rosto/saidas?slug=${SLUG}`)).json();
    expect(lista.saidas).toHaveLength(1);
    expect(lista.tetoDoDia).toBe(ROSTO_SAIR_POR_DIA);
  });

  it('desfazer: a marca sai, a anotação some, o indexador recebe o pedido de refazer o índice, e a pessoa volta a buscar', async () => {
    await publico('A');
    const id = marcas()[0].id;
    const res = await dono('/api/rosto/desfazer', { method: 'POST', body: JSON.stringify({ slug: SLUG, id }) });
    expect(res.status).toBe(200);
    expect(marcas()).toHaveLength(0);
    expect(await listaSaidas(env, SLUG)).toEqual([]);
    const estado = await (await worker.fetch(new Request(`${SITE}/api/busca/estado?slug=${SLUG}`, { headers: { 'X-Rosto-Indexador': 't'.repeat(40) } }), env, ctx)).json();
    expect(estado).toMatchObject({ geracaoPedida: 1, rosto: true });
    expect((await (await publico('A', '203.0.113.9', '/api/rosto/buscar')).json()).saiu).toBe(false);
    // De novo: já não existe.
    expect((await dono('/api/rosto/desfazer', { method: 'POST', body: JSON.stringify({ slug: SLUG, id }) })).status).toBe(404);
  });

  it('desfazer não apaga um rosto qualquer do índice: só o que está na lista de saídas deste álbum', async () => {
    const [deUmaFoto] = aws.semeia(C.principal, `cap:${F(7)}`, ['pessoa-H']);
    const antes = /** @type {any[]} */ (aws.rostos(C.principal)).length;
    expect((await dono('/api/rosto/desfazer', { method: 'POST', body: JSON.stringify({ slug: SLUG, id: deUmaFoto }) })).status).toBe(404);
    expect((await dono('/api/rosto/desfazer', { method: 'POST', body: JSON.stringify({ slug: SLUG, id: 'lixo' }) })).status).toBe(404);
    expect(/** @type {any[]} */ (aws.rostos(C.principal)).length).toBe(antes);
  });

  it('o teto do dia do site inteiro: depois dele a saída é recusada, nada é guardado, e o dono recebe UM alerta', async () => {
    aws.imagem(selfie('X'), ['pessoa-X']);
    // Cada pedido de um IP diferente: o limite por IP não é o que segura.
    for (let i = 0; i < ROSTO_SAIR_POR_DIA; i++) expect((await publico('B', `198.51.${Math.floor(i / 200)}.${i % 200 + 1}`)).status).toBe(200);
    expect(emails).toHaveLength(0);
    const n = aws.chamadas.length;
    for (const ip of ['192.0.2.1', '192.0.2.2', '192.0.2.3']) {
      const res = await publico('X', ip);
      expect(res.status).toBe(429);
      expect(await res.text()).toContain('privacidade@lucafchala.com');
    }
    expect(aws.chamadas.length).toBe(n);
    expect(/** @type {any[]} */ (aws.rostos(C.principal)).some(f => f.pessoa === 'pessoa-X')).toBe(false);
    expect(emails).toHaveLength(1);
    expect(emails[0].to).toEqual(['dono@site.test']);
    expect(emails[0].subject).toContain('saídas da busca');
  }, 60_000);

  it('excluir o projeto apaga as duas coleções na AWS, as saídas, as inscrições de aviso e as marcas no KV', async () => {
    await publico('A');
    aws.semeia(C.sair, 'saiu', ['alguem-de-antes']);
    await env.FOTOS.put(`rosto-sair:${SLUG}`, '1');
    const chaves = { p256dh: 'p'.repeat(87), auth: 'a'.repeat(22) };
    await inscreve(env, SLUG, { endpoint: 'https://fcm.googleapis.com/fcm/send/A', keys: chaves });
    await inscreve(env, SLUG, { endpoint: 'https://web.push.apple.com/B', keys: chaves });
    await inscreve(env, 'outro-album', { endpoint: 'https://fcm.googleapis.com/fcm/send/C', keys: chaves });
    await env.FOTOS.put(`aviso:pendente:${SLUG}`, '{}');
    expect((await dono('/api/events/1', { method: 'DELETE' })).status).toBe(200);
    expect(aws.rostos(C.principal)).toBeNull();
    expect(aws.rostos(C.sair)).toBeNull();
    const sobrou = [...env.FOTOS.m.keys()].filter(k => /^(rosto-|aviso:(sub|pendente|envio|ultimo))/.test(k));
    // Só fica a inscrição do OUTRO álbum.
    expect(sobrou).toHaveLength(1);
    expect(sobrou[0]).toMatch(/^aviso:sub:outro-album:/);
  });

  it('excluir com a AWS fora do ar: o projeto sai, o índice fica marcado, e o cron apaga depois', async () => {
    aws.falha('DeleteCollection', () => aws.erro('InternalServerError', 500));
    expect((await dono('/api/events/1', { method: 'DELETE' })).status).toBe(200);
    expect(aws.rostos(C.principal)).not.toBeNull();
    expect(env.FOTOS.m.has(`rosto-apagar:${SLUG}`)).toBe(true);
    // O cron com a AWS ainda fora: segue marcado, e conta a falha.
    expect(await apagaIndicesVencidos(env, CRED)).toEqual({ apagados: 0, falhas: 1, semChave: 0 });
    expect(env.FOTOS.m.has(`rosto-apagar:${SLUG}`)).toBe(true);
    aws.semFalhas();
    expect(await apagaIndicesVencidos(env, CRED)).toEqual({ apagados: 1, falhas: 0, semChave: 0 });
    expect(aws.rostos(C.principal)).toBeNull();
    expect(env.FOTOS.m.has(`rosto-apagar:${SLUG}`)).toBe(false);
  });

  it('desligar a busca: o índice é apagado depois do prazo, não antes; religar cancela', async () => {
    const salva = (/** @type {boolean} */ buscaRosto) => dono('/api/events/1', { method: 'PUT', body: JSON.stringify({ ...EVENTO, buscaRosto }) });
    const agora = Date.now();
    const H = 3600_000;
    expect((await salva(false)).status).toBe(200);
    const lista = await (await dono(`/api/rosto/saidas?slug=${SLUG}`)).json();
    expect(lista.apagaEm).toBeGreaterThan(agora + (ROSTO_APAGA_APOS_DESLIGAR_H - 1) * H);
    // O indexador é avisado na hora: não indexa mais rosto.
    const estado = await (await worker.fetch(new Request(`${SITE}/api/busca/estado?slug=${SLUG}`, { headers: { 'X-Rosto-Indexador': 't'.repeat(40) } }), env, ctx)).json();
    expect(estado.rosto).toBe(false);
    // Antes do prazo o cron não apaga.
    expect(await apagaIndicesVencidos(env, CRED, agora + (ROSTO_APAGA_APOS_DESLIGAR_H - 1) * H)).toEqual({ apagados: 0, falhas: 0, semChave: 0 });
    expect(aws.rostos(C.principal)).not.toBeNull();
    // Religou: a marca sai, e nem depois do prazo o índice é apagado.
    expect((await salva(true)).status).toBe(200);
    expect(await apagaIndicesVencidos(env, CRED, agora + (ROSTO_APAGA_APOS_DESLIGAR_H + 1) * H)).toEqual({ apagados: 0, falhas: 0, semChave: 0 });
    expect(aws.rostos(C.principal)).not.toBeNull();
    // Desligou de vez: passado o prazo, apaga.
    expect((await salva(false)).status).toBe(200);
    expect(await apagaIndicesVencidos(env, CRED, Date.now() + (ROSTO_APAGA_APOS_DESLIGAR_H + 1) * H)).toEqual({ apagados: 1, falhas: 0, semChave: 0 });
    expect(aws.rostos(C.principal)).toBeNull();
  });

  it('sem as chaves da AWS no Worker o índice marcado não some da lista: fica contado', async () => {
    await marcaIndiceParaApagar(env, SLUG, 'excluido');
    expect(await apagaIndicesVencidos(env, null)).toEqual({ apagados: 0, falhas: 0, semChave: 1 });
    expect(env.FOTOS.m.has(`rosto-apagar:${SLUG}`)).toBe(true);
  });

  it('a inscrição de aviso é gravada com validade', async () => {
    await inscreve(env, SLUG, { endpoint: 'https://fcm.googleapis.com/fcm/send/A', keys: { p256dh: 'p'.repeat(87), auth: 'a'.repeat(22) } });
    const [chave] = [...env.FOTOS.m.keys()].filter(k => k.startsWith('aviso:sub:'));
    expect(env.FOTOS.m.get(chave).ttl).toBe(AVISO_INSCRICAO_TTL_S);
    expect(AVISO_INSCRICAO_TTL_S).toBeGreaterThanOrEqual(365 * 86400);
  });
});
