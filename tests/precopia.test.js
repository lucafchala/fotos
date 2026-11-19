// Pré-cópia dos originais para o R2 (v4.9.0, src/precopia.js). O que estes
// testes prendem:
//  1. o cron copia o álbum inteiro (capítulos, vídeo do Live Photo e a pasta
//     do Instagram) para `o/<id>` no R2, sem a foto oculta;
//  2. o que já está no R2 não é baixado de novo;
//  3. orçamento por execução e progresso no KV: o resto vai na próxima;
//  4. "limite" do Google para a execução na hora;
//  5. sem R2 (a prévia) ou sem álbum configurado, nada.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { precopiaAlbuns, andamentoDaPrecopia, arquivosDaListagem, slugsDaPrecopia, PRECOPIA_POR_VEZ, PRECOPIA_A_CADA_MS } from '../src/precopia.js';
import { limpaCacheDrive, limpaCacheCapitulos } from '../src/drive.js';

const FOLDER = 'application/vnd.google-apps.folder';
const pasta = (/** @type {string} */ id, /** @type {string} */ name) => ({ id, name, mimeType: FOLDER });
const foto = (/** @type {string} */ id) => ({ id, name: `${id}.jpg`, mimeType: 'image/jpeg', size: '100', imageMediaMetadata: { width: 3000, height: 2000, time: '2026:06:20 20:00:00' } });

const AGORA = Date.parse('2026-11-20T15:00:00Z');
const ALBUM = {
  slug: 'entrenos2026', galeriaCapitulos: true,
  driveUrl: 'https://drive.google.com/drive/folders/RAIZ_PASTA_0001',
  driveUrlInstagram: 'https://drive.google.com/drive/folders/PASTA_IG_00001',
  fotosOcultas: ['GALA_FOTO_0002'],
};

/** @type {Record<string, any[]>} */
let ARVORE;
/** @type {string[]} */
let baixados;
/** @type {Set<string>} */
let recusaComLimite;
function kv() {
  const m = new Map();
  return {
    m,
    async get(/** @type {string} */ k) { return m.has(k) ? m.get(k) : null; },
    async put(/** @type {string} */ k, /** @type {string} */ v) { m.set(k, v); },
    async delete(/** @type {string} */ k) { m.delete(k); },
  };
}
function r2() {
  /** @type {Map<string, string>} */
  const m = new Map();
  return {
    m,
    async list(/** @type {any} */ op) {
      const todas = [...m.keys()].filter(k => k.startsWith(op.prefix)).sort();
      const ini = op.cursor ? Number(op.cursor) : 0;
      const lim = op.limit || 1000;
      const fatia = todas.slice(ini, ini + lim);
      const truncated = ini + lim < todas.length;
      return { objects: fatia.map(key => ({ key })), truncated, cursor: truncated ? String(ini + lim) : undefined };
    },
    async put(/** @type {string} */ k, /** @type {any} */ corpo, /** @type {any} */ op) {
      const t = typeof corpo === 'string' ? corpo : await new Response(corpo).text();
      m.set(k, `${op && op.httpMetadata ? op.httpMetadata.contentType : ''}|${t}`);
    },
  };
}
/** @param {any} [extra] */
const ambiente = extra => ({ FOTOS: kv(), FOTOS_R2: r2(), GOOGLE_DRIVE_API_KEY: 'CHAVE', WORKERS_PLANO: 'pago', R2_PRECOPIA_SLUGS: 'entrenos2026', ...extra });

beforeEach(() => {
  limpaCacheDrive();
  limpaCacheCapitulos();
  baixados = [];
  recusaComLimite = new Set();
  ARVORE = {
    RAIZ_PASTA_0001: [pasta('CAP_FESTA_0001', 'Festa Junina'), pasta('CAP_GALA_00001', 'Gala')],
    CAP_FESTA_0001: [foto('FESTA_FOTO_001'), foto('FESTA_FOTO_002')],
    CAP_GALA_00001: [foto('GALA_FOTO_0001'), foto('GALA_FOTO_0002')],
    PASTA_IG_00001: [foto('IG_FOTO_000001')],
  };
  vi.stubGlobal('fetch', vi.fn(async (/** @type {any} */ input) => {
    const url = new URL(typeof input === 'string' ? input : input.url);
    const arquivo = url.pathname.match(/\/files\/([^/]+)$/)?.[1];
    if (arquivo && url.searchParams.get('alt') === 'media') {
      if (recusaComLimite.has(arquivo)) return Response.json({ error: { code: 403, message: 'quota', errors: [{ reason: 'downloadQuotaExceeded' }] } }, { status: 403 });
      baixados.push(arquivo);
      return new Response(`bytes-de-${arquivo}`, { headers: { 'Content-Type': 'image/jpeg' } });
    }
    const id = (url.searchParams.get('q') || '').match(/^'([^']+)' in parents/)?.[1] || '';
    if (!ARVORE[id]) return Response.json({ error: { code: 404, message: 'File not found', errors: [{ reason: 'notFound' }] } }, { status: 404 });
    return Response.json({ files: ARVORE[id] });
  }));
});
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });

describe('pré-cópia para o R2', () => {
  it('copia o álbum inteiro, a pasta do Instagram junto, sem a foto oculta', async () => {
    const env = ambiente();
    const r = await precopiaAlbuns(env, [ALBUM], { agora: AGORA });
    expect(r).toMatchObject({ slug: 'entrenos2026', copiados: 4, completo: true, parou: null });
    expect([...env.FOTOS_R2.m.keys()].sort()).toEqual(['o/FESTA_FOTO_001', 'o/FESTA_FOTO_002', 'o/GALA_FOTO_0001', 'o/IG_FOTO_000001']);
    expect(env.FOTOS_R2.m.get('o/FESTA_FOTO_001')).toBe('image/jpeg|bytes-de-FESTA_FOTO_001');
    // A pasta do Instagram vai primeiro.
    expect(baixados[0]).toBe('IG_FOTO_000001');
    const estado = JSON.parse(env.FOTOS.m.get('precopia:entrenos2026'));
    expect(estado).toMatchObject({ completo: true, copiados: 4, noR2: 4 });
    expect(await andamentoDaPrecopia(env)).toEqual({ albuns: 1, completos: 1, copiados: 4, noR2: 4 });
  });

  it('o que já está no R2 não é baixado de novo; completo, só volta depois do intervalo', async () => {
    const env = ambiente();
    await env.FOTOS_R2.put('o/FESTA_FOTO_001', 'ja');
    await precopiaAlbuns(env, [ALBUM], { agora: AGORA });
    expect(baixados).not.toContain('FESTA_FOTO_001');
    baixados = [];
    expect(await precopiaAlbuns(env, [ALBUM], { agora: AGORA + 60_000 })).toBeNull();
    ARVORE.CAP_GALA_00001.push(foto('GALA_FOTO_NOVA'));
    limpaCacheDrive();
    const r = await precopiaAlbuns(env, [ALBUM], { agora: AGORA + PRECOPIA_A_CADA_MS });
    expect(r && r.copiados).toBe(1);
    expect(baixados).toEqual(['GALA_FOTO_NOVA']);
  });

  it('orçamento por execução: o resto vai na próxima', async () => {
    const muitas = Array.from({ length: PRECOPIA_POR_VEZ + 5 }, (_, i) => foto(`MUITAS_${String(i).padStart(6, '0')}`));
    ARVORE.CAP_FESTA_0001 = muitas;
    const env = ambiente();
    const r1 = await precopiaAlbuns(env, [ALBUM], { agora: AGORA });
    expect(r1).toMatchObject({ copiados: PRECOPIA_POR_VEZ, completo: false, parou: 'orcamento' });
    const r2_ = await precopiaAlbuns(env, [ALBUM], { agora: AGORA + 300_000 });
    expect(r2_).toMatchObject({ completo: true });
    expect(env.FOTOS_R2.m.size).toBe(PRECOPIA_POR_VEZ + 5 + 2);
  });

  it('"limite" do Google para a execução e não marca a pasta como feita', async () => {
    recusaComLimite.add('IG_FOTO_000001');
    const env = ambiente();
    const r = await precopiaAlbuns(env, [ALBUM], { agora: AGORA });
    expect(r).toMatchObject({ copiados: 0, parou: 'limite', completo: false });
    recusaComLimite.clear();
    const r2_ = await precopiaAlbuns(env, [ALBUM], { agora: AGORA + 300_000 });
    expect(r2_).toMatchObject({ copiados: 4, completo: true });
  });

  it('sem R2, sem álbum configurado ou com álbum fora da lista: nada', async () => {
    expect(await precopiaAlbuns(ambiente({ FOTOS_R2: undefined }), [ALBUM])).toBeNull();
    expect(await precopiaAlbuns(ambiente({ R2_PRECOPIA_SLUGS: '' }), [ALBUM])).toBeNull();
    expect(await precopiaAlbuns(ambiente({ R2_PRECOPIA_SLUGS: 'outro' }), [ALBUM])).toBeNull();
    expect(baixados).toEqual([]);
    expect(await andamentoDaPrecopia(ambiente({ R2_PRECOPIA_SLUGS: '' }))).toBeNull();
    expect(slugsDaPrecopia({ R2_PRECOPIA_SLUGS: ' a, b ,,' })).toEqual(['a', 'b']);
  });

  it('arquivosDaListagem: o vídeo do Live Photo entra; o grande demais, não', () => {
    const lista = /** @type {any} */ ({
      rk: { FOTO_LIVE_0001: 'RK1' },
      secoes: [{ fotos: [
        ['FOTO_LIVE_0001', 1, 1, 'a.heic', 500, 0, 0, ['VIDEO_LIVE_001', 'a.mov', 900]],
        ['VIDEO_GIGANTE1', 1, 1, 'b.mov', 600 * 1024 * 1024],
        ['FOTO_OCULTA_01', 1, 1, 'c.jpg', 10],
      ] }],
    });
    expect(arquivosDaListagem(lista, new Set(['FOTO_OCULTA_01']))).toEqual([
      { id: 'FOTO_LIVE_0001', bytes: 500, rk: 'RK1' },
      { id: 'VIDEO_LIVE_001', bytes: 900, rk: '' },
    ]);
  });
});
