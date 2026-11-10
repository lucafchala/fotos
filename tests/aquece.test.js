// Aquecer o álbum (v3.7.3, src/aquece.js). O que estes testes prendem:
//  1. quando aquecer: álbum "Em breve" a cada 3 h; lançamento agendado de novo
//     nos 30 min antes; nunca projeto lançado, oculto ou sem capítulos;
//  2. o ciclo relê a lista de eventos e cada evento, e o resumo (capas, número
//     de fotos) vai para o KV, de onde um data center frio o lê;
//  3. o progresso fica no KV: ciclo incompleto continua na execução seguinte.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { precisaAquecer, aqueceAlbuns, AQUECE_A_CADA_MS } from '../src/aquece.js';
import { lerResumo, limpaCacheDrive, limpaCacheCapitulos } from '../src/drive.js';

const FOLDER = 'application/vnd.google-apps.folder';
const pasta = (/** @type {string} */ id, /** @type {string} */ name) => ({ id, name, mimeType: FOLDER });
const foto = (/** @type {string} */ id) => ({ id, name: `${id}.jpg`, mimeType: 'image/jpeg', size: '100', imageMediaMetadata: { width: 3000, height: 2000, time: '2026:06:20 20:00:00' } });

const AGORA = Date.parse('2026-11-20T15:00:00Z');
const ALBUM = { slug: 'entrenos2026', galeriaCapitulos: true, driveUrl: 'https://drive.google.com/drive/folders/RAIZ_PASTA_0001', comingSoon: true, visible: false };

/** @type {Record<string, any[]>} */
let ARVORE;
/** @type {string[]} */
let lidas;
function kv() {
  const m = new Map();
  return {
    m,
    async get(/** @type {string} */ k) { return m.has(k) ? m.get(k) : null; },
    async put(/** @type {string} */ k, /** @type {string} */ v) { m.set(k, v); },
    async delete(/** @type {string} */ k) { m.delete(k); },
  };
}
beforeEach(() => {
  limpaCacheDrive();
  limpaCacheCapitulos();
  lidas = [];
  ARVORE = {
    RAIZ_PASTA_0001: [pasta('CAP_FESTA_0001', 'Festa Junina'), pasta('CAP_GALA_00001', 'Gala')],
    CAP_FESTA_0001: [foto('FESTA_FOTO_001'), foto('FESTA_FOTO_002')],
    CAP_GALA_00001: [foto('GALA_FOTO_0001')],
  };
  vi.stubGlobal('fetch', vi.fn(async (/** @type {any} */ input) => {
    const url = new URL(typeof input === 'string' ? input : input.url);
    const id = (url.searchParams.get('q') || '').match(/^'([^']+)' in parents/)?.[1] || '';
    lidas.push(id);
    if (!ARVORE[id]) return Response.json({ error: { code: 404, message: 'File not found', errors: [{ reason: 'notFound' }] } }, { status: 404 });
    return Response.json({ files: ARVORE[id] });
  }));
});
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });

describe('quando aquecer', () => {
  it('álbum "Em breve": sem ciclo, aquece; ciclo recente, não; passou 3 h, aquece de novo', () => {
    expect(precisaAquecer(ALBUM, null, AGORA)).toBe('periodico');
    expect(precisaAquecer(ALBUM, { inicio: AGORA - 60_000 }, AGORA)).toBeNull();
    expect(precisaAquecer(ALBUM, { inicio: AGORA - AQUECE_A_CADA_MS }, AGORA)).toBe('periodico');
  });

  it('lançamento agendado: de novo nos 30 min antes, uma vez por horário', () => {
    const ev = { ...ALBUM, lancarEm: new Date(AGORA + 20 * 60_000).toISOString() };
    expect(precisaAquecer(ev, { inicio: AGORA - 60_000, lancar: '' }, AGORA)).toBe('lancamento');
    expect(precisaAquecer(ev, { inicio: AGORA - 60_000, lancar: ev.lancarEm }, AGORA)).toBeNull();
    const longe = { ...ALBUM, lancarEm: new Date(AGORA + 3 * 3600_000).toISOString() };
    expect(precisaAquecer(longe, { inicio: AGORA - 60_000 }, AGORA)).toBeNull();
  });

  it('nunca: projeto lançado, projeto comum só oculto ou sem capítulos', () => {
    expect(precisaAquecer({ ...ALBUM, comingSoon: false, visible: true }, null, AGORA)).toBeNull();
    // Projeto comum oculto segue ABERTO por link direto: não é "a lançar".
    expect(precisaAquecer({ ...ALBUM, slug: 'formatura', comingSoon: false, visible: false }, null, AGORA)).toBeNull();
    expect(precisaAquecer({ ...ALBUM, galeriaCapitulos: false }, null, AGORA)).toBeNull();
  });

  it('v3.8.8: álbum com domínio próprio só oculto está fechado ao público, e é aquecido como o "Em breve"', () => {
    // A mesma regra do site inteiro (albumAbertoAoPublico): oculto, com domínio
    // próprio, é o álbum antes do lançamento.
    expect(precisaAquecer({ ...ALBUM, comingSoon: false, visible: false }, null, AGORA)).toBe('periodico');
  });
});

describe('o ciclo', () => {
  it('relê a lista e cada evento; o resumo vai para o KV e um data center frio o lê de lá', async () => {
    const env = { FOTOS: kv(), GOOGLE_DRIVE_API_KEY: 'AIzaTeste', WORKERS_PLANO: 'pago' };
    const r = await aqueceAlbuns(env, [ALBUM], AGORA);
    expect(r).toMatchObject({ slug: 'entrenos2026', motivo: 'periodico', eventos: 2, feitos: 2, completo: true });
    expect(lidas).toEqual(expect.arrayContaining(['RAIZ_PASTA_0001', 'CAP_FESTA_0001', 'CAP_GALA_00001']));
    const estado = JSON.parse(env.FOTOS.m.get('aquece:entrenos2026'));
    expect(estado.completo).toBe(true);
    expect(env.FOTOS.m.has('resumo:RAIZ_PASTA_0001')).toBe(true);
    // Isolate novo, sem Cache API (vitest): o resumo vem do KV.
    limpaCacheCapitulos();
    const resumo = await lerResumo('RAIZ_PASTA_0001', env);
    expect(resumo.CAP_FESTA_0001.n).toBe(2);
    expect(resumo.CAP_GALA_00001.capas).toEqual(['GALA_FOTO_0001']);
    // Logo depois: nada a fazer.
    expect(await aqueceAlbuns(env, [ALBUM], AGORA + 60_000)).toBeNull();
  });

  it('ciclo incompleto continua na execução seguinte, sem refazer o que já foi', async () => {
    const env = { FOTOS: kv(), GOOGLE_DRIVE_API_KEY: 'AIzaTeste', WORKERS_PLANO: 'pago' };
    await env.FOTOS.put('aquece:entrenos2026', JSON.stringify({ inicio: AGORA - 60_000, lancar: '', feitos: ['CAP_FESTA_0001'], completo: false }));
    const r = await aqueceAlbuns(env, [ALBUM], AGORA);
    expect(r).toMatchObject({ motivo: 'continua', feitos: 2, completo: true });
    expect(lidas).not.toContain('CAP_FESTA_0001');
    expect(lidas).toContain('CAP_GALA_00001');
  });

  it('pasta do álbum que não abre: desiste até o próximo ciclo (não tenta a cada 5 min)', async () => {
    const env = { FOTOS: kv(), GOOGLE_DRIVE_API_KEY: 'AIzaTeste', WORKERS_PLANO: 'pago' };
    delete ARVORE.RAIZ_PASTA_0001;
    const r = await aqueceAlbuns(env, [ALBUM], AGORA);
    expect(r && r.completo).toBe(true);
    expect(await aqueceAlbuns(env, [ALBUM], AGORA + 5 * 60_000)).toBeNull();
  });
});
