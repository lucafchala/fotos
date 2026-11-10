// As fotos pelo próprio site, PRESAS aos álbuns do site (v3.8.8).
//
// Até a 3.8.7 a rota /f/<id>/<largura> servia qualquer ID do Drive, sem
// conferir nada (revisão de nov/2026, achados 1 e 2):
//  - era um proxy aberto: qualquer imagem pública do Google saía com o domínio
//    do álbum na frente, e cada pedido gravava uma cópia eterna no R2;
//  - uma foto oculta ou removida continuava saindo por ela (cache de 7 dias,
//    cópia no R2 que nada apagava), e a foto de um álbum ainda fechado abria
//    para quem tivesse o ID.
// O que estes testes prendem, de ponta a ponta (página → endereço → rota):
//  1. as páginas emitem o endereço com `k=<álbum>.<assinatura>`, para as fotos
//     que listam, e a rota serve esses endereços;
//  2. sem assinatura válida: 404, SEM buscar no Google e SEM gravar no R2;
//  3. foto oculta: 404 para o público; ocultar apaga as cópias do R2;
//  4. álbum fechado ao público (a regra única, albumAbertoAoPublico): 404,
//     menos para quem a galeria também deixa entrar;
//  5. o navegador guarda por horas, não dias.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import worker, { aplicaSenhaPrevia } from '../src/index.js';
import { saveEvents, degradedHealth } from '../src/utils.js';
import { limpaCacheDrive } from '../src/drive.js';
import { assinadorDeFotos, apagaCopiasDaFoto, lerChaveFoto, urlFoto, FOTO_CACHE_S } from '../src/foto-rota.js';
import { galeriaIndiceHTML } from '../src/ui/galeria-indice.js';
import { ASSINATURA_CURTA_LEN } from '../src/security.js';
import { withDurableObjects } from './helpers/do.js';
import { r2Falso } from './helpers/r2.js';

const SITE = 'https://fotos.lucafchala.com';
const TOKEN = 'e'.repeat(64);
const SEGREDO = 's'.repeat(48);
const RAIZ = 'RAIZ_PASTA_0001';
const CAP = 'CAPA_PASTA_0001';
const F1 = 'FOTO_A1_000001';
const F2 = 'FOTO_A2_000001';
const F3 = 'FOTO_A3_000001';
// Uma imagem pública QUALQUER do Drive, de fora do site.
const DE_FORA = '1AbCdEfGhIjKlMnOpQrStUvWxYz012345';

const arq = (/** @type {string} */ id, /** @type {string} */ nome) => ({ id, name: nome, mimeType: 'image/jpeg', size: '1000', imageMediaMetadata: { width: 3000, height: 2000 } });
const ARVORE = /** @type {Record<string, any[]>} */ ({
  [RAIZ]: [{ id: CAP, name: 'Evento A', mimeType: 'application/vnd.google-apps.folder' }],
  [CAP]: [arq(F1, 'a1.jpg'), arq(F2, 'a2.jpg'), arq(F3, 'a3.jpg')],
});
const EVENTO = {
  id: '1', slug: 'formatura', title: 'Formatura 2026', accessType: 'public', galeriaCapitulos: true,
  driveUrl: `https://drive.google.com/drive/folders/${RAIZ}`,
};

function fakeKV(/** @type {Record<string, string>} */ inicial = {}) {
  const store = new Map(Object.entries(inicial));
  return {
    async get(/** @type {string} */ k) { return store.has(k) ? store.get(k) : null; },
    async put(/** @type {string} */ k, /** @type {string} */ v) { store.set(k, v); },
    async delete(/** @type {string} */ k) { store.delete(k); },
    async list() { return { keys: [], list_complete: true, cursor: null }; },
  };
}

/** @type {any} */
let env;
/** @type {string[]} */
let aoGoogle; // pedidos de imagem ao lh3
/** @type {Promise<any>[]} */
let pend;
/** @type {any} */
let ctx;
/** @type {ReturnType<typeof r2Falso>} */
let r2;

beforeEach(async () => {
  limpaCacheDrive();
  aoGoogle = [];
  pend = [];
  ctx = { waitUntil: (/** @type {Promise<any>} */ p) => { pend.push(p); } };
  r2 = r2Falso();
  vi.stubGlobal('fetch', vi.fn(async (/** @type {any} */ input) => {
    const url = new URL(typeof input === 'string' ? input : input.url);
    if (url.host === 'lh3.googleusercontent.com') {
      aoGoogle.push(url.pathname);
      return new Response('IMG', { headers: { 'Content-Type': 'image/webp' } });
    }
    if (url.pathname === '/drive/v3/files') {
      const id = (url.searchParams.get('q') || '').match(/^'([^']+)' in parents/)?.[1] || '';
      const soPastas = (url.searchParams.get('q') || '').includes("mimeType = 'application/vnd.google-apps.folder'");
      return Response.json({ files: (ARVORE[id] || []).filter(f => !soPastas || f.mimeType.endsWith('.folder')) });
    }
    return new Response('nao esperado', { status: 599 });
  }));
  env = withDurableObjects({
    FOTOS: fakeKV({ [`admin_session:${TOKEN}`]: JSON.stringify({ createdAt: Date.now() }) }),
    GOOGLE_DRIVE_API_KEY: 'AIzaChaveDeTeste123',
    SIGNING_SECRET: SEGREDO,
    FOTOS_R2: r2,
  });
  await saveEvents(env, [structuredClone(EVENTO)]);
});
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });

const fundo = async () => { await Promise.all(pend.splice(0)); await new Promise(r => setTimeout(r, 0)); };
/** @param {string} path @param {{ dono?: boolean, cookie?: string, method?: string, body?: any }} [o] */
async function pede(path, o = {}) {
  /** @type {Record<string, string>} */
  const headers = { 'CF-Connecting-IP': '203.0.113.9' };
  const c = [o.dono ? `__Host-session=${TOKEN}` : '', o.cookie || ''].filter(Boolean).join('; ');
  if (c) headers.Cookie = c;
  if (o.body) headers['Content-Type'] = 'application/json';
  const res = await worker.fetch(new Request(SITE + path, { method: o.method || 'GET', headers, ...(o.body ? { body: JSON.stringify(o.body) } : {}) }), env, ctx);
  await fundo();
  return res;
}
/** O endereço assinado de uma foto, como as páginas o montam. */
async function endereco(/** @type {string} */ id, w = 480, slug = 'formatura', segredo = SEGREDO) {
  return urlFoto(id, w, await assinadorDeFotos(segredo, slug, [id]));
}
/** Todos os endereços /f/ de um HTML (atributos já desescapados). */
const fotosDoHtml = (/** @type {string} */ h) => [...h.replace(/&amp;/g, '&').matchAll(/\/f\/[A-Za-z0-9_-]{10,}\/[0-9]+j?(\?k=[A-Za-z0-9._-]*)?/g)].map(m => m[0]);

describe('1. as páginas emitem o endereço assinado, e a rota o serve', () => {
  it('índice do álbum: toda capa sai com k=<álbum>.<assinatura> e abre', async () => {
    // A página do evento primeiro: é ela que grava o resumo (as capas do índice).
    vi.stubGlobal('caches', (await import('./helpers/caches.js')).fakeCaches());
    expect((await pede('/galeria/formatura/evento-a')).status).toBe(200);
    limpaCacheDrive();
    const h = await (await pede('/galeria/formatura')).text();
    const fotos = fotosDoHtml(h);
    expect(fotos.length).toBeGreaterThan(0);
    for (const u of fotos) expect(u, u).toMatch(new RegExp(`\\?k=formatura\\.[\\w-]{${ASSINATURA_CURTA_LEN}}$`));
    const res = await pede(fotos[0]);
    expect(res.status).toBe(200);
    expect(await res.text()).toBe('IMG');
  });

  it('página do evento: os dados levam a assinatura de cada foto (`as`), e o endereço que o script monta abre', async () => {
    const h = await (await pede('/galeria/formatura/evento-a')).text();
    const dados = JSON.parse(/** @type {RegExpMatchArray} */ (h.match(/<script type="application\/json" id="g-dados"[^>]*>([^<]+)<\/script>/))[1]);
    const sec = dados.secoes[0];
    expect(sec.fotos.map((/** @type {any[]} */ f) => f[0])).toEqual([F1, F2, F3]);
    expect(sec.as).toHaveLength(3 * ASSINATURA_CURTA_LEN);
    // O que o script faz (src/ui/galeria.js, `lh3`): fatia `as` na ordem das fotos.
    const k = (/** @type {number} */ i) => `${dados.slug}.${sec.as.slice(i * ASSINATURA_CURTA_LEN, (i + 1) * ASSINATURA_CURTA_LEN)}`;
    expect((await pede(`/f/${F2}/400?k=${k(1)}`)).status).toBe(200);
    // A assinatura é DA foto: a da primeira não abre a segunda.
    expect((await pede(`/f/${F2}/400?k=${k(0)}`)).status).toBe(404);
    // O script da página lê `as` para montar o endereço (sem isso, 404 em tudo).
    expect(h).toContain("'?k=' + (K[id] || D.slug)");
  });

  it('o modelo do índice não deixa nenhum endereço de foto sem assinatura', async () => {
    const resumo = { [CAP]: { n: 3, capas: [F1, F2, F3] } };
    const caps = { v: /** @type {1} */ (1), pasta: RAIZ, em: '2026-11-01T12:00:00.000Z', truncada: false, caps: [{ id: CAP, rk: '', bruto: 'Evento A', nome: 'Evento A', slug: 'evento-a' }] };
    const evento = /** @type {any} */ ({ ...EVENTO, galeriaAbertura: 'Oi, turma.', capasEventos: { 'evento-a': F3 }, photos: [`https://lh3.googleusercontent.com/d/${F2}`] });
    const { idsDeFotoDoIndice } = await import('../src/ui/album.js');
    const assina = await assinadorDeFotos(SEGREDO, 'formatura', idsDeFotoDoIndice(evento, resumo));
    for (const estilo of ['mosaico', 'tela-cheia', 'recordacao', 'linha']) {
      for (const ev of [evento, { ...evento, galeriaAbertura: '' }]) {
        const h = galeriaIndiceHTML({ event: { ...ev, galeriaEstilo: estilo }, caps, resumo, ocultas: [], dono: false, indexavel: true, nonce: 'N', assina });
        const fotos = fotosDoHtml(h);
        expect(fotos.length, estilo).toBeGreaterThan(0);
        for (const u of fotos) expect(u, `${estilo}: ${u}`).toMatch(/\?k=formatura\.[\w-]{8}$/);
      }
    }
  });
});

describe('2. sem assinatura válida: 404, sem Google e sem R2', () => {
  const nada = async (/** @type {string} */ path) => {
    const res = await pede(path);
    expect(res.status, path).toBe(404);
    expect(res.headers.get('Cache-Control'), path).toBe('no-store');
    expect(aoGoogle, path).toEqual([]);
    expect(r2.gravadas, path).toEqual([]);
  };

  it('endereço antigo, sem `k`', async () => {
    await nada(`/f/${F1}/480`);
  });

  it('proxy aberto fechado: uma imagem de fora do site não sai, nem com o nome de um álbum de verdade', async () => {
    await nada(`/f/${DE_FORA}/1600`);
    await nada(`/f/${DE_FORA}/1600?k=formatura`);
    await nada(`/f/${DE_FORA}/1600?k=formatura.AAAAAAAA`);
    // Nem com a assinatura de OUTRA foto do álbum.
    const k = lerChaveFoto(new URL(SITE + await endereco(F1)).searchParams.get('k'));
    await nada(`/f/${DE_FORA}/1600?k=formatura.${k && k.assinatura}`);
  });

  it('assinatura de outro álbum, de outro segredo, cortada ou de álbum que não existe', async () => {
    await saveEvents(env, [structuredClone(EVENTO), { ...structuredClone(EVENTO), id: '2', slug: 'outro' }]);
    const doOutro = new URL(SITE + await endereco(F1, 480, 'outro')).searchParams.get('k') || '';
    await nada(`/f/${F1}/480?k=formatura.${doOutro.split('.')[1]}`);
    await nada(await endereco(F1, 480, 'formatura', 'x'.repeat(48)));
    await nada((await endereco(F1)).slice(0, -1));
    await nada(await endereco(F1, 480, 'nao-existe'));
    await nada(`/f/${F1}/480?k=${'a'.repeat(300)}`);
  });

  it('com a assinatura certa: abre, vai ao Google uma vez e guarda no R2', async () => {
    const res = await pede(await endereco(F1));
    expect(res.status).toBe(200);
    expect(aoGoogle).toEqual([`/d/${F1}=w480-rw`]);
    expect(r2.gravadas).toEqual([`w/${F1}/480.webp`]);
  });
});

describe('3. foto oculta', () => {
  const oculta = (/** @type {string} */ foto, valor = true) => pede('/api/galeria/ocultar', { method: 'POST', dono: true, body: { slug: 'formatura', foto, oculta: valor } });

  it('ocultar apaga do R2 as miniaturas e o original DESTA foto, e só dela', async () => {
    for (const k of [`w/${F1}/480.webp`, `w/${F1}/1600.jpg`, `w/${F1}/999.webp`, `o/${F1}`, `w/${F2}/480.webp`, `o/${F2}`]) await r2.put(k, 'x');
    expect((await oculta(F1)).status).toBe(200);
    expect([...r2.objetos.keys()].sort()).toEqual([`o/${F2}`, `w/${F2}/480.webp`]);
  });

  it('a faxina diária apaga as cópias de foto que já estava oculta (ocultada antes desta versão, ou com o R2 fora na hora)', async () => {
    await saveEvents(env, [{ ...structuredClone(EVENTO), fotosOcultas: [F1] }, { ...structuredClone(EVENTO), id: '2', slug: 'outro', fotosOcultas: [F3] }]);
    for (const k of [`w/${F1}/480.webp`, `o/${F1}`, `w/${F2}/480.webp`, `w/${F3}/800.jpg`]) await r2.put(k, 'x');
    const { faxinaDasOcultasNoR2 } = await import('../src/index.js');
    await faxinaDasOcultasNoR2(env);
    expect([...r2.objetos.keys()]).toEqual([`w/${F2}/480.webp`]);
    // Sem foto oculta, nem toca no bucket; sem bucket, nada.
    await saveEvents(env, [structuredClone(EVENTO)]);
    r2.apagadas.length = 0;
    expect(await faxinaDasOcultasNoR2(env)).toBe(0);
    expect(r2.apagadas).toEqual([]);
    expect(await faxinaDasOcultasNoR2({ ...env, FOTOS_R2: undefined })).toBe(0);
  });

  it('a rota para de servir a foto oculta, mesmo com a assinatura certa e a cópia no R2', async () => {
    const u = await endereco(F1);
    expect((await pede(u)).status).toBe(200);
    await oculta(F1);
    // Uma cópia que tivesse sobrado (outro data center, corrida) não sai.
    await r2.put(`w/${F1}/480.webp`, 'SOBROU');
    aoGoogle.length = 0;
    const res = await pede(u);
    expect(res.status).toBe(404);
    expect(aoGoogle).toEqual([]);
    // As outras seguem.
    expect((await pede(await endereco(F2))).status).toBe(200);
  });

  it('o dono ainda vê a oculta (o visualizador dele a mostra), sem cache e SEM recriar a cópia no R2', async () => {
    await oculta(F1);
    r2.gravadas.length = 0;
    const res = await pede(await endereco(F1), { dono: true });
    expect(res.status).toBe(200);
    expect(res.headers.get('Cache-Control')).toBe('private, no-store');
    expect(r2.gravadas).toEqual([]);
  });

  it('mostrar de novo: a foto volta a sair', async () => {
    await oculta(F1);
    await oculta(F1, false);
    expect((await pede(await endereco(F1))).status).toBe(200);
  });
});

describe('4. álbum fechado ao público', () => {
  it('"Em breve": 404 para o público mesmo com o endereço assinado; o dono vê, só no navegador dele', async () => {
    await saveEvents(env, [{ ...structuredClone(EVENTO), comingSoon: true }]);
    const u = await endereco(F1);
    const publico = await pede(u);
    expect(publico.status).toBe(404);
    expect(aoGoogle).toEqual([]);
    const dono = await pede(u, { dono: true });
    expect(dono.status).toBe(200);
    expect(dono.headers.get('Cache-Control')).toBe(`private, max-age=${FOTO_CACHE_S}`);
  });

  it('álbum com domínio próprio oculto (a surpresa): a mesma regra da galeria', async () => {
    await saveEvents(env, [{ ...structuredClone(EVENTO), slug: 'entrenos2026', comingSoon: false, visible: false }]);
    expect((await pede(await endereco(F1, 480, 'entrenos2026'))).status).toBe(404);
    await saveEvents(env, [{ ...structuredClone(EVENTO), slug: 'entrenos2026', comingSoon: false, visible: true }]);
    expect((await pede(await endereco(F1, 480, 'entrenos2026'))).status).toBe(200);
  });

  it('quem entrou pela senha da prévia vê as fotos; sem o cookie, não', async () => {
    const ev = /** @type {any} */ ({ ...structuredClone(EVENTO), comingSoon: true });
    expect(await aplicaSenhaPrevia({ previaSenhaNova: 'surpresa-2026' }, ev)).toBe('');
    await saveEvents(env, [ev]);
    const entra = await pede('/api/previa', { method: 'POST', body: { slug: 'formatura', senha: 'surpresa-2026' } });
    expect(entra.status).toBe(200);
    const cookie = String(entra.headers.get('Set-Cookie')).split(';')[0];
    const u = await endereco(F1);
    expect((await pede(u)).status).toBe(404);
    const res = await pede(u, { cookie });
    expect(res.status).toBe(200);
    expect(res.headers.get('Cache-Control')).toMatch(/^private, /);
  });
});

describe('5. por quanto tempo fica guardada', () => {
  it('4 horas no navegador, sem `immutable` (eram 7 dias): a remoção vale em horas', async () => {
    expect(FOTO_CACHE_S).toBe(4 * 3600);
    const res = await pede(await endereco(F1));
    expect(res.headers.get('Cache-Control')).toBe('public, max-age=14400');
  });
});

describe('sem o segredo de assinatura no Worker', () => {
  it('a assinatura fica desligada (como o nonce do Drive), mas o álbum e a foto oculta continuam conferidos', async () => {
    delete env.SIGNING_SECRET;
    const u = await endereco(F1, 480, 'formatura', '');
    expect(u).toBe(`/f/${F1}/480?k=formatura`);
    expect((await pede(u)).status).toBe(200);
    expect((await pede(`/f/${F1}/480`)).status).toBe(404);
    expect((await pede(`/f/${F1}/480?k=nao-existe`)).status).toBe(404);
    await saveEvents(env, [{ ...structuredClone(EVENTO), fotosOcultas: [F1] }]);
    expect((await pede(u)).status).toBe(404);
    await saveEvents(env, [{ ...structuredClone(EVENTO), comingSoon: true }]);
    expect((await pede(u)).status).toBe(404);
  });
});

describe('as peças', () => {
  it('assinadorDeFotos: uma assinatura por (álbum, foto), estável, e nada para o que não foi pedido', async () => {
    const a = await assinadorDeFotos(SEGREDO, 'formatura', [F1, F2, F1, 'curto']);
    expect(a(F1)).toMatch(/^formatura\.[\w-]{8}$/);
    expect(a(F1)).not.toBe(a(F2));
    expect(a(F3)).toBe('');
    expect(a('curto')).toBe('');
    expect((await assinadorDeFotos(SEGREDO, 'formatura', [F1]))(F1)).toBe(a(F1));
    expect((await assinadorDeFotos(SEGREDO, 'outro', [F1]))(F1).split('.')[1]).not.toBe(a(F1).split('.')[1]);
    expect((await assinadorDeFotos(SEGREDO, 'Slug Inválido', [F1]))(F1)).toBe('');
  });

  it('os resultados das buscas e o visor em tela cheia montam o endereço com o `k` que veio do servidor', async () => {
    const m = await import('../src/ui/indice-comum.js');
    const scripts = Object.entries(m).filter(([nome, v]) => nome.startsWith('SCRIPT') && typeof v === 'string').map(([, v]) => String(v)).join('\n');
    // Nenhum endereço de foto montado no navegador sem o `k`.
    const semK = scripts.split('\n').filter(l => l.includes("'/f/'") && !l.includes("'?k='"));
    expect(semK).toEqual([]);
    expect(scripts).toContain("a.setAttribute('data-k', r.k || '')");
    expect(scripts).toContain("k: el.getAttribute('data-k') || ''");
    // Lista guardada antes da v3.8.8 (sem `k`) não é reaproveitada.
    expect(scripts).toContain('comChave(s.j.resultados)');
  });

  it('lerChaveFoto: <slug>.<assinatura>, ou só o slug; lixo é null', () => {
    expect(lerChaveFoto('formatura.Ab3dE9xZ')).toEqual({ slug: 'formatura', assinatura: 'Ab3dE9xZ' });
    expect(lerChaveFoto('formatura')).toEqual({ slug: 'formatura', assinatura: '' });
    for (const lixo of [null, '', '.abc', 'Com Espaço.x', '../x', 'a'.repeat(201)]) expect(lerChaveFoto(lixo)).toBeNull();
  });

  it('apagaCopiasDaFoto: sem bucket não faz nada; com erro do R2, LANÇA (quem chama registra)', async () => {
    expect(await apagaCopiasDaFoto({}, [F1])).toBe(0);
    const quebrado = { list: async () => { throw new Error('R2 fora'); }, delete: async () => {} };
    await expect(apagaCopiasDaFoto({ FOTOS_R2: quebrado }, [F1])).rejects.toThrow('R2 fora');
    // ID que não é do Drive nem chega ao bucket.
    const list = vi.fn(async () => ({ objects: [], truncated: false }));
    await apagaCopiasDaFoto({ FOTOS_R2: { list, delete: async () => {} } }, ['../../x']);
    expect(list).not.toHaveBeenCalled();
  });

  it('R2 fora ao ocultar: a foto sai do site do mesmo jeito, e o /api/healthz acusa a cópia que ficou', async () => {
    env.FOTOS_R2 = { get: async () => null, put: async () => ({}), list: async () => { throw new Error('R2 fora'); }, delete: async () => {} };
    const res = await pede('/api/galeria/ocultar', { method: 'POST', dono: true, body: { slug: 'formatura', foto: F1, oculta: true } });
    expect(res.status).toBe(200);
    expect((await pede(await endereco(F1))).status).toBe(404);
    expect(JSON.stringify(degradedHealth())).toContain('cópia de foto oculta não apagada do R2');
  });
});
