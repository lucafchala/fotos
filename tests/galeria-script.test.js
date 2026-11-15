// #252: o script da galeria sai como arquivo com nome de hash e cache de um
// ano, não dentro do HTML de cada visita.
import { describe, it, expect } from 'vitest';
import worker from '../src/index.js';
import { galeriaHTML, GALERIA_JS } from '../src/ui/galeria.js';
import { EVENTO } from './helpers/paginas.js';

const listagem = {
  v: 1, pasta: 'RAIZ', em: '2026-11-14T12:00:00.000Z', truncada: false, total: 1, videos: 0, outros: 0, rk: {},
  secoes: [{ nome: '', caminho: '', fotos: [['FOTO_AAAAAAAAAA', 6000, 4000, 'a.jpg', 1000]] }],
};

describe('script da galeria como arquivo', () => {
  it('a página aponta para o arquivo, com nonce e defer, e não leva o texto', () => {
    const html = galeriaHTML({ event: EVENTO, listagem, erro: null, nonce: 'N', dono: false });
    expect(GALERIA_JS.path).toMatch(/^\/galeria\.[0-9a-f]{10}\.js$/);
    expect(html).toContain(`<script src="${GALERIA_JS.path}" nonce="N" defer></script>`);
    expect(html).not.toContain('function linkDireto');
    // Os dados continuam no HTML, ANTES do script (defer roda depois deles).
    expect(html.indexOf('id="g-dados"')).toBeLessThan(html.indexOf(GALERIA_JS.path));
  });

  it('a rota serve o texto com cache imutável; outro hash é 404', async () => {
    const env = { EVENTS: { get: async () => null, put: async () => {}, list: async () => ({ keys: [] }) } };
    const ctx = { waitUntil() {}, passThroughOnException() {} };
    const r = await worker.fetch(new Request(`https://fotos.lucafchala.com${GALERIA_JS.path}`), /** @type {any} */ (env), /** @type {any} */ (ctx));
    expect(r.status).toBe(200);
    expect(r.headers.get('Content-Type')).toMatch(/^text\/javascript/);
    expect(r.headers.get('Cache-Control')).toBe('public, max-age=31536000, immutable');
    expect(await r.text()).toBe(GALERIA_JS.texto);
    const outro = await worker.fetch(new Request('https://fotos.lucafchala.com/galeria.0000000000.js'), /** @type {any} */ (env), /** @type {any} */ (ctx));
    expect(outro.status).toBe(404);
  });
});
