// O limite da rota de vídeo (v4.4.0) é um balde PRÓPRIO: com ele vazio, o
// vídeo responde 429, mas o download do mesmo arquivo continua funcionando —
// assistir não gasta a ficha de quem quer baixar. O dono não tem limite.
// Arquivo à parte porque troca o balde por um de 2 fichas (vi.mock vale para o
// arquivo inteiro).

import { it, expect, beforeEach, afterEach, vi } from 'vitest';

vi.mock('../src/config.js', async orig => ({ ...(await orig()), GALERIA_VIDEO_BUCKET: { capacity: 2, perHour: 1 } }));

const { default: worker } = await import('../src/index.js');
const { limpaCacheDrive } = await import('../src/drive.js');
const { saveEvents } = await import('../src/utils.js');
const { withDurableObjects } = await import('./helpers/do.js');

const SITE = 'https://fotos.lucafchala.com';
const RAIZ = 'VIDEO_PASTA_002';
let env;

function fakeKV() {
  const store = new Map();
  return {
    async get(k) { return store.has(k) ? store.get(k) : null; },
    async put(k, v) { store.set(k, v); },
    async delete(k) { store.delete(k); },
    async list() { return { keys: [], list_complete: true, cursor: null }; },
  };
}

beforeEach(async () => {
  limpaCacheDrive();
  const arquivos = [{ id: 'VIDEO_REEL_002', name: 'passeio.mp4', mimeType: 'video/mp4', size: '4', videoMediaMetadata: { width: 1080, height: 1920, durationMillis: '30000' } }];
  vi.stubGlobal('fetch', vi.fn(async input => {
    const url = new URL(typeof input === 'string' ? input : input.url);
    if (url.pathname === '/drive/v3/files') return Response.json({ files: arquivos });
    return new Response('ABCD', { headers: { 'Content-Type': 'video/mp4', 'Content-Length': '4' } });
  }));
  env = withDurableObjects({ FOTOS: fakeKV(), GOOGLE_DRIVE_API_KEY: 'AIzaChaveDeTeste123', SIGNING_SECRET: 's'.repeat(48) });
  await saveEvents(env, [{ id: '3', slug: 'lim', title: 'Lim', accessType: 'public', driveUrl: `https://drive.google.com/drive/folders/${RAIZ}` }]);
});
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });

const get = path => worker.fetch(new Request(SITE + path, { headers: { 'CF-Connecting-IP': '198.51.100.7' } }), env, { waitUntil() {} });

it('o terceiro play do mesmo IP é 429, e o download segue liberado', async () => {
  expect((await get('/galeria/lim/video/VIDEO_REEL_002')).status).toBe(200);
  expect((await get('/galeria/lim/video/VIDEO_REEL_002')).status).toBe(200);
  const r = await get('/galeria/lim/video/VIDEO_REEL_002');
  expect(r.status).toBe(429);
  expect(Number(r.headers.get('Retry-After'))).toBeGreaterThan(0);
  expect((await get('/galeria/lim/baixar/VIDEO_REEL_002?v=max')).status).toBe(200);
});
