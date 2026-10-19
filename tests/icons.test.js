// Ícones PNG (iOS ignora SVG em apple-touch-icon; o manifest precisa de 192/512).
import { describe, it, expect } from 'vitest';
import { createHash } from 'node:crypto';
import worker from '../src/index.js';
import { ICON_SVG, ICON_MASKABLE_SVG, OG_PADRAO_SVG } from '../src/content/icon-svg.js';
import { ICONES } from '../src/content/icons.js';
import { variacoes } from './helpers/paginas.js';

const sha = (/** @type {string} */ t) => createHash('sha256').update(t, 'utf8').digest('hex');
const ctx = { waitUntil() {}, passThroughOnException() {} };
const kv = { get: async () => null, put: async () => {}, delete: async () => {}, list: async () => ({ keys: [], list_complete: true }) };
const pega = (/** @type {string} */ caminho) => worker.fetch(new Request('https://fotos.test' + caminho), { FOTOS: kv }, ctx);

/** @param {Uint8Array} b */
const dimensoes = b => {
  const v = new DataView(b.buffer, b.byteOffset, b.byteLength);
  return { assinatura: Array.from(b.slice(0, 8)).join(','), largura: v.getUint32(16), altura: v.getUint32(20) };
};

describe('ícones PNG', () => {
  it('o módulo gerado está em sincronia com o SVG de origem (rode npm run build:icons)', () => {
    const esperado = { '/apple-touch-icon.png': ICON_SVG, '/icon-192.png': ICON_SVG, '/icon-512.png': ICON_SVG, '/icon-512-maskable.png': ICON_MASKABLE_SVG, '/og-padrao.png': OG_PADRAO_SVG };
    expect(ICONES.map(i => i.rota).sort()).toEqual(Object.keys(esperado).sort());
    for (const i of ICONES) expect(i.sourceSha256, `${i.rota} mudou — rode npm run build:icons`).toBe(sha(/** @type {any} */ (esperado)[i.rota]));
  });

  for (const [rota, lado] of [['/apple-touch-icon.png', 180], ['/icon-192.png', 192], ['/icon-512.png', 512], ['/icon-512-maskable.png', 512], ['/og-padrao.png', 1200]]) {
    it(`${rota}: PNG de verdade, ${lado}×${lado}, com cache longo`, async () => {
      const res = await pega(String(rota));
      expect(res.status).toBe(200);
      expect(res.headers.get('Content-Type')).toBe('image/png');
      expect(res.headers.get('Cache-Control')).toMatch(/max-age=\d{6,}/);
      const d = dimensoes(new Uint8Array(await res.arrayBuffer()));
      expect(d).toEqual({ assinatura: '137,80,78,71,13,10,26,10', largura: lado, altura: rota === '/og-padrao.png' ? 630 : lado });
    });
  }

  it('o manifest lista os PNG (any e maskable) e mantém o SVG', async () => {
    const m = await (await pega('/manifest.json')).json();
    const src = m.icons.map((/** @type {any} */ i) => `${i.src}:${i.sizes}:${i.purpose}`);
    expect(src).toContain('/icon-192.png:192x192:any');
    expect(src).toContain('/icon-512.png:512x512:any');
    expect(src).toContain('/icon-512-maskable.png:512x512:maskable');
    expect(src.some((/** @type {string} */ s) => s.startsWith('/icon.svg'))).toBe(true);
  });

  it('o /icon.svg serve o SVG de origem', async () => {
    expect(await (await pega('/icon.svg')).text()).toBe(ICON_SVG);
  });

  it('toda página ganha o apple-touch-icon em PNG, e nenhuma o aponta para o SVG', () => {
    const paginas = variacoes();
    expect(Object.keys(paginas).length).toBeGreaterThan(10);
    for (const [nome, html] of Object.entries(paginas)) {
      expect(html, nome).toContain('<link rel="apple-touch-icon" href="/apple-touch-icon.png">');
      expect(html, nome).not.toMatch(/apple-touch-icon" href="\/icon\.svg/);
    }
  });
});

describe('cartão de link padrão', () => {
  it('toda página pública ganha og:image 1200×630, a própria ou a padrão', () => {
    for (const [nome, html] of Object.entries(variacoes())) {
      if (/name="robots" content="noindex/.test(html)) continue;
      expect(html, nome).toMatch(/<meta property="og:image" content="https:\/\/[^"]+">/);
      expect(html, nome).toContain('<meta property="og:image:width" content="1200">');
      expect(html, nome).toContain('<meta property="og:image:height" content="630">');
    }
  });
});

describe('cabeçalho comum das páginas', () => {
  it('toda página liga o manifest, e o /suporte tem canonical absoluto e sem query', () => {
    const paginas = variacoes();
    for (const [nome, html] of Object.entries(paginas)) {
      expect(html, nome).toContain('<link rel="manifest" href="/manifest.json">');
    }
    expect(paginas.support).toContain('<link rel="canonical" href="https://fotos.lucafchala.com/suporte">');
  });
});
