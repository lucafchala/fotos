// Pico de acessos (item 1g): a lista do Drive não é relida por todo mundo ao
// mesmo tempo quando vence, e a primeira leitura (sem nada guardado) é de um só.
import process from 'node:process';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import worker from '../src/index.js';
import { limpaCacheDrive, listaPasta } from '../src/drive.js';
import { saveEvents, tomaLease, soltaLease } from '../src/utils.js';
import { ctxColetor } from './helpers/ctx.js';
import { withDurableObjects } from './helpers/do.js';
import { fakeCaches } from './helpers/caches.js';
import { d1Sqlite } from './helpers/d1.js';

const SITE = 'https://fotos.lucafchala.com';
const RAIZ = 'RAIZ_PASTA_0001';
const arq = (id, nome) => ({ id, name: nome, mimeType: 'image/jpeg', size: '1000', imageMediaMetadata: { width: 3000, height: 2000 } });
const EVENTO = { id: '1', slug: 'festa', title: 'Festa', accessType: 'public', driveUrl: `https://drive.google.com/drive/folders/${RAIZ}` };

let env;
let chamadas;
let arvore;
let portao; // quando definido, a listagem espera por ele

function fakeKV() {
  const store = new Map();
  return {
    async get(k) { return store.has(k) ? store.get(k) : null; },
    async put(k, v) { store.set(k, v); },
    async delete(k) { store.delete(k); },
    async list() { return { keys: [], list_complete: true, cursor: null }; },
  };
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date('2026-11-05T12:00:00Z'));
  limpaCacheDrive();
  chamadas = [];
  portao = null;
  arvore = { [RAIZ]: [arq('FOTO_1_0000001', 'um.jpg'), arq('FOTO_2_0000001', 'dois.jpg')] };
  vi.stubGlobal('caches', fakeCaches());
  vi.stubGlobal('fetch', vi.fn(async input => {
    const url = new URL(typeof input === 'string' ? input : input.url);
    if (url.pathname === '/drive/v3/files') {
      chamadas.push(url);
      if (portao) await portao;
      const id = (url.searchParams.get('q') || '').match(/^'([^']+)' in parents/)?.[1];
      const soPastas = (url.searchParams.get('q') || '').includes("mimeType = 'application/vnd.google-apps.folder'");
      return Response.json({ files: (arvore[id] || []).filter(f => !soPastas || f.mimeType.endsWith('.folder')) });
    }
    return new Response('nao esperado', { status: 599 });
  }));
  env = withDurableObjects({
    FOTOS: fakeKV(),
    GOOGLE_DRIVE_API_KEY: 'AIzaChaveDeTeste123',
    SIGNING_SECRET: 's'.repeat(48),
    CONSENT_DB: d1Sqlite(),
  });
});
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });

const MIN = 60_000;
const avanca = ms => vi.setSystemTime(new Date(Date.now() + ms));
const pede = (ctx, ip = '203.0.113.9') => worker.fetch(new Request(`${SITE}/galeria/festa`, { headers: { 'CF-Connecting-IP': ip } }), env, ctx);

describe('lease (Durable Object)', () => {
  it('200 pedidos ao mesmo tempo: exatamente um ganha', async () => {
    const r = await Promise.all(Array.from({ length: 200 }, () => tomaLease(env, 'l:teste', 45_000)));
    expect(r.filter(Boolean)).toHaveLength(1);
  });

  it('solta devolve o direito; sem solta, o prazo é o freio', async () => {
    expect(await tomaLease(env, 'l:x', 45_000)).toBe(true);
    expect(await tomaLease(env, 'l:x', 45_000)).toBe(false);
    await soltaLease(env, 'l:x', 0);
    expect(await tomaLease(env, 'l:x', 45_000)).toBe(true);
    avanca(46_000);
    expect(await tomaLease(env, 'l:x', 45_000)).toBe(true);
  });

  it('chaves diferentes não se atrapalham', async () => {
    expect(await tomaLease(env, 'l:a', 45_000)).toBe(true);
    expect(await tomaLease(env, 'l:b', 45_000)).toBe(true);
  });

  it('sem o Durable Object (env sem RATELIMIT) não trava: quem pergunta lê', async () => {
    expect(await tomaLease({}, 'l:a', 45_000)).toBe(true);
    await expect(soltaLease({}, 'l:a', 0)).resolves.toBeUndefined();
  });
});

const reinicia = async () => {
  limpaCacheDrive();
  chamadas.length = 0;
  vi.stubGlobal('caches', fakeCaches());
  env = withDurableObjects({ FOTOS: fakeKV(), GOOGLE_DRIVE_API_KEY: 'AIzaChaveDeTeste123', SIGNING_SECRET: 's'.repeat(48), CONSENT_DB: d1Sqlite() });
  await saveEvents(env, [{ ...EVENTO }]);
};

describe('primeira leitura, sem nada guardado', () => {
  it('200 visitas ao mesmo tempo (um isolate): a mesma conta de UMA visita', async () => {
    await reinicia();
    const c = ctxColetor();
    await pede(c);
    await c.drena();
    const uma = chamadas.length;
    expect(uma).toBeGreaterThan(0);

    await reinicia();
    const ctxs = Array.from({ length: 200 }, () => ctxColetor());
    const res = await Promise.all(ctxs.map((x, i) => pede(x, `203.0.113.${i % 250}`)));
    expect(res.every(r => r.status === 200)).toBe(true);
    await Promise.all(ctxs.map(x => x.drena()));
    expect(chamadas.length).toBe(uma);
  });

  it('outro isolate com a leitura em curso: não lista de novo; sem nada, mostra "Carregando as fotos…" (503) e se recarrega', async () => {
    await saveEvents(env, [{ ...EVENTO }]);
    let abre;
    portao = new Promise(r => { abre = r; });
    const c1 = ctxColetor();
    const primeira = pede(c1);
    await vi.waitFor(() => expect(chamadas.length).toBeGreaterThan(0));
    const feitas = chamadas.length;
    // "Outro isolate": a memória e os voos locais não existem lá, o lease sim.
    limpaCacheDrive();
    vi.useFakeTimers({ toFake: ['Date', 'setTimeout'] });
    const c2 = ctxColetor();
    const segunda = pede(c2, '198.51.100.7');
    await vi.advanceTimersByTimeAsync(10_000);
    const r2 = await segunda;
    const h2 = await r2.text();
    expect(r2.status).toBe(503);
    expect(Number(r2.headers.get('Retry-After'))).toBeGreaterThan(0);
    expect(r2.headers.get('Cache-Control')).toBe('no-store');
    expect(h2).toContain('Carregando as fotos');
    expect(h2).toContain('http-equiv="refresh"');
    expect(h2).not.toContain('AIzaChaveDeTeste123');
    expect(chamadas.length).toBe(feitas);
    abre();
    expect((await primeira).status).toBe(200);
    await c1.drena();
  });

  it('o outro isolate usa a lista assim que o primeiro a guarda (espera e relê, sem listar)', async () => {
    await saveEvents(env, [{ ...EVENTO }]);
    let abre;
    portao = new Promise(r => { abre = r; });
    const c1 = ctxColetor();
    const primeira = pede(c1);
    await vi.waitFor(() => expect(chamadas.length).toBeGreaterThan(0));
    const feitas = chamadas.length;
    limpaCacheDrive();
    vi.useFakeTimers({ toFake: ['Date', 'setTimeout'] });
    const segunda = pede(ctxColetor(), '198.51.100.7');
    await vi.advanceTimersByTimeAsync(1000);
    abre();
    await primeira;
    await c1.drena();
    await vi.advanceTimersByTimeAsync(2000);
    const r2 = await segunda;
    expect(r2.status).toBe(200);
    expect(await r2.text()).toContain('FOTO_1_0000001');
    expect(chamadas.length).toBe(feitas);
  });

  it('falha do Drive na primeira leitura devolve o direito: a próxima visita tenta e vê o erro real', async () => {
    await saveEvents(env, [{ ...EVENTO }]);
    vi.stubGlobal('fetch', vi.fn(async () => Response.json({ error: { errors: [{ reason: 'keyInvalid' }], message: 'API key not valid' } }, { status: 400 })));
    const r1 = await pede(ctxColetor());
    expect(r1.status).toBe(200);
    expect(await r1.text()).toContain('O Google recusou a chave');
    limpaCacheDrive();
    const r2 = await pede(ctxColetor(), '198.51.100.7');
    expect(await r2.text()).toContain('O Google recusou a chave');
  });
});

describe('lista vencida', () => {
  async function esquenta() {
    await saveEvents(env, [{ ...EVENTO }]);
    const c = ctxColetor();
    await pede(c);
    await c.drena();
    return chamadas.length;
  }

  it('200 visitas na hora em que vence: servem a velha e só uma relê', async () => {
    const base = await esquenta();
    arvore[RAIZ].push(arq('FOTO_3_0000001', 'tres.jpg'));
    avanca(11 * MIN);
    const ctxs = Array.from({ length: 200 }, () => ctxColetor());
    const res = await Promise.all(ctxs.map(c => pede(c)));
    const htmls = await Promise.all(res.map(r => r.text()));
    expect(htmls.every(h => h.includes('FOTO_1_0000001') && !h.includes('FOTO_3_0000001'))).toBe(true);
    await Promise.all(ctxs.map(c => c.drena()));
    // Uma releitura = o mesmo número de chamadas que a primeira leitura.
    expect(chamadas.length - base).toBe(base);
    const depois = await (await pede(ctxColetor())).text();
    expect(depois).toContain('FOTO_3_0000001');
  });

  it('outro isolate enquanto a releitura de um está em curso: serve a velha e não lista de novo', async () => {
    const base = await esquenta();
    avanca(11 * MIN);
    let abre;
    portao = new Promise(r => { abre = r; });
    const cA = ctxColetor();
    const rA = await pede(cA); // serve a velha e começa a reler (travada no portão)
    expect(await rA.text()).toContain('FOTO_1_0000001');
    await vi.waitFor(() => expect(chamadas.length).toBeGreaterThan(base));
    const feitas = chamadas.length;
    limpaCacheDrive(); // "outro isolate": sem memória, sem voo; o lease continua tomado
    const cB = ctxColetor();
    const rB = await pede(cB, '198.51.100.7');
    expect(rB.status).toBe(200);
    expect(await rB.text()).toContain('FOTO_1_0000001');
    expect(chamadas.length).toBe(feitas);
    abre();
    await cA.drena();
    await cB.drena();
    expect(chamadas.length).toBe(base * 2);
  });

  it('D1: colo frio (sem memória nem Cache API) serve a foto durável sem esperar o Drive', async () => {
    const base = await esquenta();
    limpaCacheDrive();
    vi.stubGlobal('caches', fakeCaches());
    avanca(11 * MIN);
    let abre;
    portao = new Promise(r => { abre = r; }); // o Drive "não responde" enquanto a página sai
    chamadas.length = 0;
    const c = ctxColetor();
    const r = await pede(c);
    expect(await r.text()).toContain('FOTO_1_0000001');
    abre();
    await c.drena();
    expect(chamadas.length).toBe(base);
  });

  it('lista velha demais (além de 6 h) não é servida: relê antes de responder', async () => {
    await esquenta();
    arvore[RAIZ].push(arq('FOTO_3_0000001', 'tres.jpg'));
    limpaCacheDrive();
    vi.stubGlobal('caches', fakeCaches());
    avanca(7 * 3600_000);
    const h = await (await pede(ctxColetor())).text();
    expect(h).toContain('FOTO_3_0000001');
  });

  it('o dono, em "Atualizar agora", relê direto (sem esperar o lease de ninguém)', async () => {
    await esquenta();
    expect(await tomaLease(env, 'qualquer', 45_000)).toBe(true);
    arvore[RAIZ].push(arq('FOTO_3_0000001', 'tres.jpg'));
    const antes = chamadas.length;
    const lista = await listaPasta(env, { id: RAIZ }, { atualizar: true });
    expect(lista.total).toBe(3);
    expect(chamadas.length).toBeGreaterThan(antes);
  });
});

// ---------------------------------------------------------------------------
// Orçamento do caminho quente: quantas idas a KV, Durable Object, D1, Drive e
// Cache API uma visita gasta. O número vai no RETOMADA ("Pico de acessos"); o
// teto aqui é o que NÃO pode subir sem decisão consciente.
describe('caminho quente (memória aquecida)', () => {
  function instrumenta() {
    const n = { kvGet: 0, kvPut: 0, d1: 0, cacheMatch: 0, cachePut: 0 };
    const kv = env.FOTOS;
    const g = kv.get.bind(kv); const p = kv.put.bind(kv);
    kv.get = async (...a) => { n.kvGet++; return g(...a); };
    kv.put = async (...a) => { n.kvPut++; return p(...a); };
    const prep = env.CONSENT_DB.prepare.bind(env.CONSENT_DB);
    env.CONSENT_DB.prepare = sql => { n.d1++; return prep(sql); };
    const cs = globalThis.caches.default;
    const m = cs.match.bind(cs); const pu = cs.put.bind(cs);
    cs.match = async (...a) => { n.cacheMatch++; return m(...a); };
    cs.put = async (...a) => { n.cachePut++; return pu(...a); };
    env.COUNTER._resetCalls(); env.RATELIMIT._resetCalls();
    chamadas.length = 0;
    return () => ({ ...n, drive: chamadas.length, doCounter: env.COUNTER._calls().length, doLimite: env.RATELIMIT._calls().length });
  }

  async function aquece() {
    await saveEvents(env, [{ ...EVENTO }]);
    const c = ctxColetor();
    await pede(c);
    await c.drena();
  }

  it('página: com cookie de "já contei" não gasta DO nem KV de escrita nem D1 nem Drive', async () => {
    await aquece();
    const le = instrumenta();
    const c = ctxColetor();
    const r = await worker.fetch(new Request(`${SITE}/galeria/festa`, { headers: { 'CF-Connecting-IP': '203.0.113.9', Cookie: 'gv_festa=1' } }), env, c);
    expect(r.status).toBe(200);
    await c.drena();
    const x = le();

    expect(x.kvPut).toBe(0);
    expect(x.drive).toBe(0);
    expect(x.d1).toBe(0);
    expect(x.doLimite).toBe(0);
    expect(x.doCounter).toBe(0);
  });

  it('página: a primeira visita do navegador na hora gasta UMA chamada de DO (contador, em waitUntil) e zero KV de escrita', async () => {
    await aquece();
    const le = instrumenta();
    const c = ctxColetor();
    await pede(c, '198.51.100.7');
    await c.drena();
    const x = le();

    expect(x.kvPut).toBe(0);
    expect(x.drive).toBe(0);
    expect(x.d1).toBe(0);
    expect(x.doCounter).toBe(1);
    expect(x.doLimite).toBe(0);
  });

  it('download: 1 DO de limite + 1 DO de contagem, zero KV de escrita, zero Drive de listagem (só o arquivo)', async () => {
    await aquece();
    const arquivos = [];
    const fetchAntes = fetch;
    vi.stubGlobal('fetch', vi.fn(async (input, init) => {
      const url = new URL(typeof input === 'string' ? input : input.url);
      if (url.pathname.startsWith('/drive/v3/files/')) { arquivos.push(url); return new Response('BYTES', { headers: { 'Content-Type': 'image/jpeg', 'Content-Length': '5' } }); }
      return fetchAntes(input, init);
    }));
    const le = instrumenta();
    const c = ctxColetor();
    const r = await worker.fetch(new Request(`${SITE}/galeria/festa/baixar/FOTO_1_0000001?v=max`, { headers: { 'CF-Connecting-IP': '203.0.113.9' } }), env, c);
    expect(r.status).toBe(200);
    expect(await r.text()).toBe('BYTES');
    await c.drena();
    const x = le();

    expect(arquivos).toHaveLength(1);
    expect(x.kvPut).toBe(0);
    expect(x.drive).toBe(0);
    expect(x.d1).toBe(0);
    expect(x.doLimite).toBe(1);
    expect(x.doCounter).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// CPU da página de um capítulo grande (6000 itens), memória aquecida. Mede em
// Node com process.cpuUsage (CPU do processo, não relógio de parede) — como o
// teste de `casaRedes` em tests/galeria.test.js, o teto aqui é folgado para CI
// e o número real vai no RETOMADA. O Workers tem 10 ms de CPU no plano gratuito.
// Medir CPU absoluta numa suíte que roda dezenas de arquivos em paralelo não
// presta: o mesmo código que gasta 6 ms sozinho chega a gastar 45 ms com a
// máquina cheia (hyperthreads, cache, frequência), e subir o teto só esconderia
// regressão. Por isso cada amostra é medida CONTRA uma carga de referência
// (montar e fatiar texto, o mesmo tipo de trabalho) rodada logo antes, sob a
// mesma pressão: o que se compara é a RAZÃO. O teto absoluto de 10 ms do plano
// gratuito vale quando a máquina está livre (MEDE_CPU=1 mostra os dois).
// `process.threadCpuUsage()` (Node 22.19+) conta só a thread do teste.
const cpuAgora = () => (typeof process.threadCpuUsage === 'function' ? process.threadCpuUsage() : process.cpuUsage());
const cpuMs = c0 => { const c = (typeof process.threadCpuUsage === 'function' ? process.threadCpuUsage(c0) : process.cpuUsage(c0)); return (c.user + c.system) / 1000; };
function cargaDeReferencia() {
  let n = 0;
  for (let r = 0; r < 20; r++) {
    const partes = [];
    for (let i = 0; i < 6000; i++) partes.push(`<a href="#foto=F${i}" data-i="${i}"><img src="https://x.test/${i}=w400" width="400" height="300"></a>`);
    n += JSON.parse(JSON.stringify(partes.slice(0, 600))).length + partes.join('').length;
  }
  return n;
}
/** Menor razão (CPU de `fn` / CPU da referência) em `n` rodadas, e as medidas da melhor. */
async function razaoDeCpu(fn, n = 15) {
  let melhor = { razao: Infinity, ms: 0, refMs: 0 };
  const todas = [];
  for (let i = 0; i < n; i++) {
    const r0 = cpuAgora();
    cargaDeReferencia();
    const refMs = cpuMs(r0);
    const c0 = cpuAgora();
    const ret = await fn();
    const ms = cpuMs(c0);
    if (ret && ret.depois) await ret.depois();
    const razao = ms / Math.max(refMs, 0.01);
    todas.push(razao);
    if (razao < melhor.razao) melhor = { razao, ms, refMs };
  }
  todas.sort((a, b) => a - b);
  return { ...melhor, mediana: todas[Math.floor(todas.length / 2)] };
}

describe('CPU: página de capítulo com 6000 itens', () => {
  // Medido sozinho: 0,11 a 0,15 (página) e 0,14 a 0,22 (requisição). O teto dá ~2x de folga.
  const RAZAO_MAX_PAGINA = 0.35;
  const RAZAO_MAX_REQUISICAO = 0.5;
  const N = 6000;
  const foto = i => [`F${String(i).padStart(13, '0')}`, 6000, 4000, `IMG_${String(i).padStart(5, '0')}.JPG`, 1000, i % 4, 20261105143000 + i];
  const listagem = {
    v: 2, pasta: 'RAIZ_PASTA_0001', em: '2026-10-10T12:00:00.000Z', truncada: false, total: N, videos: 0, outros: 0, rk: {},
    aut: ['Ana', 'Bruno', 'Carla', 'Davi'],
    secoes: [{ nome: '', caminho: '', fotos: Array.from({ length: N }, (_, i) => foto(i)) }],
  };
  const capitulo = { slug: 'festa', nome: 'Festa', anterior: { slug: 'cerimonia', nome: 'Cerimônia' }, proximo: null };

  it('montar o HTML (galeriaHTML) usa poucos milissegundos de CPU', async () => {
    const { galeriaHTML } = await import('../src/ui/galeria.js');
    const evento = { slug: 'formatura', title: 'Formatura 2026', driveUrl: 'https://drive.google.com/drive/folders/RAIZ_PASTA_0001', galeriaCapitulos: true, nomesAmigaveis: true };
    const monta = () => galeriaHTML({ event: evento, listagem, listagemBruta: listagem, capituloNome: 'Festa', capitulo, erro: null, nonce: 'NONCE', dono: false, formToken: '' });
    for (let i = 0; i < 5; i++) monta(); // esquenta o JIT
    const m = await razaoDeCpu(() => { monta(); });
    if (process.env.MEDE_CPU) console.log('CPU_PAGINA_6000', 'MS', m.ms.toFixed(2), 'REF_MS', m.refMs.toFixed(2), 'RAZAO', m.razao.toFixed(2), 'MEDIANA_RAZAO', m.mediana.toFixed(2));
    expect(m.razao).toBeLessThan(RAZAO_MAX_PAGINA);
    if (m.refMs < 50) expect(m.ms).toBeLessThan(10); // máquina livre: cabe nos 10 ms do plano gratuito
  });

  it('a requisição inteira (worker.fetch, lista em memória, nomes amigáveis, 5 ocultas) também fica curta', async () => {
    arvore[RAIZ] = Array.from({ length: N }, (_, i) => arq(`FOTO_${String(i).padStart(9, '0')}`, `IMG_${String(i).padStart(5, '0')}.jpg`));
    await saveEvents(env, [{ ...EVENTO, nomesAmigaveis: true, fotosOcultas: arvore[RAIZ].slice(0, 5).map(f => f.id) }]);
    const pedido = () => worker.fetch(new Request(`${SITE}/galeria/festa`, { headers: { 'CF-Connecting-IP': '203.0.113.9', Cookie: 'gv_festa=1' } }), env, ctxColetor());
    const frio = await pedido(); // lê a pasta (não entra na medida)
    expect(frio.status).toBe(200);
    for (let i = 0; i < 5; i++) await (await pedido()).text();
    // Mede até a RESPOSTA existir (HTML montado). Ler o corpo para string
    // (`text()`) é só do teste: no Workers o corpo sai pelo envio, não pelo JS.
    const m = await razaoDeCpu(async () => {
      const r = await pedido();
      return { depois: async () => { expect((await r.text()).length).toBeGreaterThan(N * 20); } };
    });
    if (process.env.MEDE_CPU) console.log('CPU_REQUISICAO_6000', 'MS', m.ms.toFixed(2), 'REF_MS', m.refMs.toFixed(2), 'RAZAO', m.razao.toFixed(2), 'MEDIANA_RAZAO', m.mediana.toFixed(2));
    expect(m.razao).toBeLessThan(RAZAO_MAX_REQUISICAO);
    if (m.refMs < 50) expect(m.ms).toBeLessThan(10);
  });
});
