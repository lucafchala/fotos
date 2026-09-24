import { SELF } from 'cloudflare:test';
import { describe, it, expect } from 'vitest';
import { FONTS } from '../../src/content/fonts.js';

// O handler de /fonts/ decodifica o base64 UMA vez por isolate e entrega o
// MESMO Uint8Array a toda resposta, apostando que `new Response()` copia os
// bytes. Isso é garantia da plataforma, então é aqui, no workerd, que se
// prova — no node o teste equivalente afirmaria sobre o node.
async function sha256(/** @type {ArrayBuffer} */ buf) {
  const d = await crypto.subtle.digest('SHA-256', buf);
  return [...new Uint8Array(d)].map(b => b.toString(16).padStart(2, '0')).join('');
}

describe('/fonts/ no runtime de verdade', () => {
  it.each(FONTS.map(f => [f.path, f]))('%s: respostas seguidas e simultâneas levam o arquivo inteiro', async (_p, f) => {
    const seguidas = [];
    for (let i = 0; i < 3; i++) seguidas.push(await SELF.fetch('https://fotos.lucafchala.com' + f.path));
    const simultaneas = await Promise.all(Array.from({ length: 5 }, () => SELF.fetch('https://fotos.lucafchala.com' + f.path)));
    for (const res of [...seguidas, ...simultaneas]) {
      expect(res.status).toBe(200);
      expect(res.headers.get('Content-Type')).toBe('font/woff2');
      expect(await sha256(await res.arrayBuffer())).toBe(f.sha256);
    }
  });
});
