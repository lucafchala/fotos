import { SELF } from 'cloudflare:test';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { VENDOR } from '../../src/content/vendor.js';
import { listaPasta, limpaCacheDrive } from '../../src/drive.js';

// Galeria própria (prévia, #235) no workerd. O que só a plataforma garante é
// provado aqui — no node, o teste equivalente afirmaria sobre o node:
//   - o PhotoSwipe sai do bundle byte a byte (o módulo gerado guarda o texto
//     numa string JS; um escape errado no gerador só apareceria aqui);
//   - a Cache API de verdade aceita a chave `https://fotos.invalid/...` e
//     devolve a lista a um isolate novo, sem chamar o Google de novo.
async function sha256(/** @type {ArrayBuffer} */ buf) {
  const d = await crypto.subtle.digest('SHA-256', buf);
  return [...new Uint8Array(d)].map(b => b.toString(16).padStart(2, '0')).join('');
}

afterEach(() => { vi.unstubAllGlobals(); limpaCacheDrive(); });

describe('galeria própria no runtime de verdade', () => {
  it.each(VENDOR.map(v => [v.path, v]))('%s: sai byte a byte, com o tipo e o cache imutável', async (_p, v) => {
    const res = await SELF.fetch('https://fotos.lucafchala.com' + v.path);
    expect(res.status).toBe(200);
    expect(res.headers.get('Content-Type')).toBe(v.contentType);
    expect(res.headers.get('Cache-Control')).toBe('public, max-age=31536000, immutable');
    expect(await sha256(await res.arrayBuffer())).toBe(v.sha256);
  });

  it('/galeria/<slug> sem sessão é o 404 de rota inexistente', async () => {
    const res = await SELF.fetch('https://fotos.lucafchala.com/galeria/qualquer-projeto');
    expect(res.status).toBe(404);
  });

  it('a lista da pasta passa de um isolate para o próximo pela Cache API', async () => {
    const google = vi.fn(async () => Response.json({ files: [
      { id: 'FOTO_WORKERS_01', name: '001.jpg', mimeType: 'image/jpeg', size: '18000000', imageMediaMetadata: { width: 6000, height: 4000 } },
    ] }));
    vi.stubGlobal('fetch', google);
    const env = { GOOGLE_DRIVE_API_KEY: 'chave-de-teste' };
    const pasta = { id: 'PASTA_WORKERS_0001', resourceKey: '' };
    const primeira = await listaPasta(env, pasta);
    limpaCacheDrive(); // isolate novo: a memória some, a Cache API do data center fica
    const segunda = await listaPasta(env, pasta);
    expect(google).toHaveBeenCalledTimes(1);
    expect(segunda).toEqual(primeira);
    expect(segunda.secoes[0].fotos[0]).toEqual(['FOTO_WORKERS_01', 6000, 4000, '001.jpg', 18000000]);
  });
});
