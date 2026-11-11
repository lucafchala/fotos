// A busca pelo rosto no PICO (v3.8.8): o lançamento de um álbum é uma rajada —
// a turma inteira procura o próprio rosto no mesmo minuto — e a Amazon aceita
// poucas buscas por segundo. O que estes testes prendem (revisão de nov/2026,
// achado 4):
//  1. a nova tentativa depois de um 429 vai com um token NOVO do Turnstile. O
//     servidor gasta o token ao conferi-lo; a página reenviava o mesmo, e a
//     segunda tentativa era sempre "verificação de segurança falhou";
//  2. a busca que a AWS recusa com "devagar" não custou nada: a ficha do teto
//     global (e a do IP) volta. Antes, as recusas esvaziavam o teto;
//  3. o teto global cabe o público do dia, e a cota da AWS mora num lugar só.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import worker, { mintFormToken } from '../src/index.js';
import { saveEvents } from '../src/utils.js';
import {
  ROSTO_BUSCA_IP_BUCKET, ROSTO_BUSCA_GLOBAL_BUCKET, ROSTO_PUBLICO_DO_DIA, ROSTO_BUSCAS_POR_PESSOA,
  ROSTO_AWS_TPS, ROSTO_TENTATIVAS_NO_PICO, esperaDaBuscaNoPico,
} from '../src/config.js';
import { SCRIPT_ROSTO } from '../src/ui/indice-comum.js';
import { withDurableObjects } from './helpers/do.js';

const SITE = 'https://fotos.lucafchala.com';
const IP = '203.0.113.9';
const SELFIE = '/9j/' + 'A'.repeat(196);
const EVENTO = { id: '1', slug: 'album', title: 'Álbum', accessType: 'public', galeriaCapitulos: true, buscaRosto: true, driveUrl: 'https://drive.google.com/drive/folders/RAIZ_PASTA_0001' };
const ctx = { waitUntil() {} };
function kv() {
  const store = new Map();
  return { async get(/** @type {string} */ k) { return store.has(k) ? store.get(k) : null; }, async put(/** @type {string} */ k, /** @type {string} */ v) { store.set(k, v); },
    async delete(/** @type {string} */ k) { store.delete(k); }, async list() { return { keys: [], list_complete: true, cursor: null }; } };
}

/** @type {any} */ let env;
/** @type {'ok' | 'devagar' | 'quebrada'} */ let aws;
/** @type {string[]} */ let tokensConferidos;
let awsChamadas = 0;

beforeEach(async () => {
  aws = 'ok';
  tokensConferidos = [];
  awsChamadas = 0;
  vi.stubGlobal('fetch', vi.fn(async (/** @type {any} */ input, /** @type {any} */ init = {}) => {
    const url = new URL(typeof input === 'string' ? input : input.url);
    if (url.host === 'challenges.cloudflare.com') {
      // Como o Turnstile de verdade: cada token vale UMA conferência.
      const token = String(new URLSearchParams(String(init.body)).get('response') || '');
      const repetido = tokensConferidos.includes(token);
      tokensConferidos.push(token);
      return Response.json(repetido ? { success: false, 'error-codes': ['timeout-or-duplicate'] } : { success: true });
    }
    if (url.host === 'rekognition.sa-east-1.amazonaws.com') {
      awsChamadas++;
      if (aws === 'devagar') return new Response(JSON.stringify({ __type: 'ThrottlingException', message: 'Rate exceeded' }), { status: 400 });
      if (aws === 'quebrada') return new Response(JSON.stringify({ __type: 'InternalServerError', message: 'x' }), { status: 500 });
      return Response.json({ FaceMatches: [] });
    }
    return new Response('nao esperado', { status: 599 });
  }));
  env = withDurableObjects({ FOTOS: kv(), TURNSTILE_SECRET_KEY: 'ts', SIGNING_SECRET: 's'.repeat(48), AWS_ACCESS_KEY_ID: 'AKIDTESTE', AWS_SECRET_ACCESS_KEY: 'segredo' });
  await saveEvents(env, [structuredClone(EVENTO)]);
});
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });

/** @param {Record<string, any>} [extra] @param {string} [rota] */
async function busca(extra = {}, rota = '/api/rosto/buscar') {
  const corpo = { slug: 'album', imagem: SELFIE, aceite: true, turnstileToken: `tok-${Math.random()}`, company_website: '', form_token: await mintFormToken(env, 'busca-rosto', { preAged: true }), ...extra };
  return worker.fetch(new Request(SITE + rota, { method: 'POST', headers: { 'Content-Type': 'application/json', 'CF-Connecting-IP': IP }, body: JSON.stringify(corpo) }), env, ctx);
}
/** As fichas que restam num balde (o registro do Durable Object), ou a capacidade se ele nem nasceu. */
function fichas(/** @type {string} */ nome, /** @type {number} */ capacidade) {
  const obj = env.RATELIMIT._instances.get(nome);
  const b = obj ? obj.ctx.storage._map.get('b') : null;
  return b ? Math.round(b.fichas) : capacidade;
}
const GLOBAL = 'rosto-buscar-global:global';
const DO_IP = `rosto-buscar:${IP}`;

describe('o servidor: a ficha só é gasta por busca que a AWS aceitou', () => {
  it('busca aceita: uma ficha do IP e uma do teto global', async () => {
    expect((await busca()).status).toBe(200);
    expect(fichas(GLOBAL, ROSTO_BUSCA_GLOBAL_BUCKET.capacity)).toBe(ROSTO_BUSCA_GLOBAL_BUCKET.capacity - 1);
    expect(fichas(DO_IP, ROSTO_BUSCA_IP_BUCKET.capacity)).toBe(ROSTO_BUSCA_IP_BUCKET.capacity - 1);
  });

  it('a AWS pede calma: 429 com a espera sorteada, e as duas fichas voltam', async () => {
    aws = 'devagar';
    const res = await busca();
    expect(res.status).toBe(429);
    const j = await res.json();
    expect(j.retryAfter).toBeGreaterThanOrEqual(2);
    expect(j.retryAfter).toBeLessThanOrEqual(8);
    expect(res.headers.get('Retry-After')).toBe(String(j.retryAfter));
    expect(fichas(GLOBAL, ROSTO_BUSCA_GLOBAL_BUCKET.capacity)).toBe(ROSTO_BUSCA_GLOBAL_BUCKET.capacity);
    expect(fichas(DO_IP, ROSTO_BUSCA_IP_BUCKET.capacity)).toBe(ROSTO_BUSCA_IP_BUCKET.capacity);
  });

  it('uma rajada de recusas não esvazia o teto: depois dela, a busca de verdade ainda passa', async () => {
    aws = 'devagar';
    for (let i = 0; i < 40; i++) expect((await busca()).status).toBe(429);
    expect(fichas(GLOBAL, ROSTO_BUSCA_GLOBAL_BUCKET.capacity)).toBe(ROSTO_BUSCA_GLOBAL_BUCKET.capacity);
    aws = 'ok';
    expect((await busca()).status).toBe(200);
  });

  it('"atualizar minhas fotos" segue a mesma regra', async () => {
    aws = 'devagar';
    const face = '11111111-2222-3333-4444-555555555555';
    expect((await busca({ imagem: undefined, faces: [face] }, '/api/rosto/atualizar')).status).toBe(429);
    expect(fichas(GLOBAL, ROSTO_BUSCA_GLOBAL_BUCKET.capacity)).toBe(ROSTO_BUSCA_GLOBAL_BUCKET.capacity);
  });

  it('teto global vazio: 429 sem chamar a AWS, e a ficha do IP volta', async () => {
    expect((await busca()).status).toBe(200);
    // Esvazia o balde global direto no registro (o relógio do teste não anda).
    const obj = env.RATELIMIT._instances.get(GLOBAL);
    obj.ctx.storage._map.set('b', { ...obj.ctx.storage._map.get('b'), fichas: 0, t: Date.now() });
    const doIpAntes = fichas(DO_IP, ROSTO_BUSCA_IP_BUCKET.capacity);
    awsChamadas = 0;
    const res = await busca();
    expect(res.status).toBe(429);
    expect(awsChamadas).toBe(0);
    expect(fichas(DO_IP, ROSTO_BUSCA_IP_BUCKET.capacity)).toBe(doIpAntes);
  });

  it('erro de verdade da AWS (não é "devagar"): 503, e a ficha NÃO volta (a chamada pode ter sido cobrada)', async () => {
    aws = 'quebrada';
    expect((await busca()).status).toBe(503);
    expect(fichas(GLOBAL, ROSTO_BUSCA_GLOBAL_BUCKET.capacity)).toBe(ROSTO_BUSCA_GLOBAL_BUCKET.capacity - 1);
  });

  it('o token do Turnstile vale uma vez: reenviar o MESMO depois de um 429 é recusado (por isso a página pede outro)', async () => {
    aws = 'devagar';
    expect((await busca({ turnstileToken: 'o-mesmo' })).status).toBe(429);
    aws = 'ok';
    expect((await busca({ turnstileToken: 'o-mesmo' })).status).toBe(403);
    expect((await busca({ turnstileToken: 'outro' })).status).toBe(200);
  });
});

describe('a página: nova tentativa com token novo, e com teto', () => {
  // A função de verdade, tirada do script que vai à página (o mesmo jeito de
  // tests/drive-gate.test.js): sem DOM, com os colaboradores trocados.
  const fonte = /** @type {RegExpMatchArray} */ (SCRIPT_ROSTO.match(/function comNovasTentativas\(envia, tokenNovo, dorme, avisa, max\) \{[\s\S]*?\n {2}\}/));
  /** @type {(envia: () => Promise<any>, tokenNovo: () => Promise<void>, dorme: (ms: number) => Promise<void>, avisa: (s: number) => void, max: number) => Promise<any>} */
  const comNovasTentativas = fonte ? new Function(`${fonte[0]}; return comNovasTentativas;`)() : null;

  /** Um servidor que responde 429 nas `recusas` primeiras vezes e recusa token repetido, como o de verdade. */
  function cenario(/** @type {number} */ recusas) {
    let token = 'token-0';
    let n = 0;
    /** @type {string[]} */ const usados = [];
    /** @type {number[]} */ const esperas = [];
    /** @type {number[]} */ const avisos = [];
    const envia = async () => {
      if (usados.includes(token)) { usados.push(token); return { status: 403, ok: false, corpo: { error: 'Verificação de segurança falhou.' } }; }
      usados.push(token);
      n++;
      return n <= recusas ? { status: 429, ok: false, corpo: { retryAfter: 4 } } : { status: 200, ok: true, corpo: { resultados: [] } };
    };
    const tokenNovo = async () => { token = `token-${usados.length}`; };
    const dorme = async (/** @type {number} */ ms) => { esperas.push(ms); };
    return { envia, tokenNovo, dorme, avisa: (/** @type {number} */ s) => { avisos.push(s); }, usados, esperas, avisos };
  }

  it('a função existe no script e é a que o envio usa', () => {
    expect(fonte, 'comNovasTentativas no SCRIPT_ROSTO').not.toBeNull();
    expect(SCRIPT_ROSTO).toContain('return comNovasTentativas(envia, tokenNovo, dorme, avisa, D.tentativas || 3)');
    // O pedido é montado a cada tentativa, com o token do momento.
    expect(SCRIPT_ROSTO).toMatch(/function envia\(\) \{[\s\S]{0,400}turnstileToken: token/);
  });

  it('depois de um 429, a tentativa seguinte vai com OUTRO token e passa', async () => {
    const c = cenario(2);
    const res = await comNovasTentativas(c.envia, c.tokenNovo, c.dorme, c.avisa, ROSTO_TENTATIVAS_NO_PICO);
    expect(res.status).toBe(200);
    expect(c.usados).toHaveLength(3);
    expect(new Set(c.usados).size).toBe(3);
    // Espera o que o servidor pediu, e avisa na tela (0 = apaga o aviso).
    expect(c.esperas).toEqual([4000, 4000]);
    expect(c.avisos).toEqual([4, 0, 4, 0]);
  });

  it('tem teto: no máximo `max` repetições, e devolve o último 429', async () => {
    const c = cenario(99);
    const res = await comNovasTentativas(c.envia, c.tokenNovo, c.dorme, c.avisa, ROSTO_TENTATIVAS_NO_PICO);
    expect(res.status).toBe(429);
    expect(c.usados).toHaveLength(ROSTO_TENTATIVAS_NO_PICO + 1);
  });

  it('a espera fica entre 2 e 20 s, venha o que vier do servidor', async () => {
    for (const [veio, espera] of [[0, 3000], [1, 2000], [500, 20000], ['x', 3000]]) {
      /** @type {number[]} */ const esperas = [];
      let n = 0;
      await comNovasTentativas(async () => (n++ ? { status: 200, ok: true, corpo: {} } : { status: 429, ok: false, corpo: { retryAfter: veio } }), async () => {}, async ms => { esperas.push(ms); }, () => {}, 3);
      expect(esperas, String(veio)).toEqual([espera]);
    }
  });

  it('sem token novo a tempo, para com erro em vez de reenviar o velho', async () => {
    const c = cenario(1);
    await expect(comNovasTentativas(c.envia, async () => { throw new Error('demorou'); }, c.dorme, c.avisa, 3)).rejects.toThrow('demorou');
    expect(c.usados).toHaveLength(1);
  });
});

describe('os números (config.js)', () => {
  it('o teto global cabe o público do dia do lançamento: 1.500 pessoas com 3 buscas cada', () => {
    expect(ROSTO_PUBLICO_DO_DIA * ROSTO_BUSCAS_POR_PESSOA).toBeGreaterThanOrEqual(4500);
    expect(ROSTO_BUSCA_GLOBAL_BUCKET.capacity).toBeGreaterThanOrEqual(ROSTO_PUBLICO_DO_DIA * ROSTO_BUSCAS_POR_PESSOA);
  });

  it('a cota da AWS mora num lugar só: o que vale hoje e o pedido em análise', () => {
    expect(ROSTO_AWS_TPS.SearchFacesByImage.pedido).toBe(10);
    expect(ROSTO_AWS_TPS.SearchFaces.pedido).toBe(25);
    for (const op of Object.values(ROSTO_AWS_TPS)) expect(op.vale).toBeGreaterThanOrEqual(5);
  });

  it('a espera do 429 sai da cota: sorteada, e mais curta quando a cota sobe', () => {
    expect(esperaDaBuscaNoPico(0, 5)).toBe(2);
    expect(esperaDaBuscaNoPico(0.9999, 5)).toBe(8);
    expect(esperaDaBuscaNoPico(0.9999, 10)).toBe(5);
    expect(esperaDaBuscaNoPico(0.9999, 25)).toBe(4);
    expect(esperaDaBuscaNoPico(5, 5)).toBe(8);
    expect(esperaDaBuscaNoPico(-1, 5)).toBe(2);
    for (let i = 0; i < 50; i++) { const s = esperaDaBuscaNoPico(); expect(s).toBeGreaterThanOrEqual(2); expect(s).toBeLessThanOrEqual(8); }
  });
});
