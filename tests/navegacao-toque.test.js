import { describe, it, expect } from 'vitest';
import { navegacaoFluidaHTML } from '../src/utils.js';

// v3.9.4: resposta no toque ao abrir uma página do álbum.
describe('navegação com resposta no toque', () => {
  it('leva o script com o nonce e a barra, e ignora foto, download e API', () => {
    const h = navegacaoFluidaHTML('N0NCE');
    const js = h.match(/<script nonce="N0NCE" data-nav>([\s\S]*?)<\/script>/)[1];
    expect(() => new Function(js)).not.toThrow();
    expect(js).toContain("indexOf('/f/')===0");
    expect(js).toContain("indexOf('/api/')===0");
    expect(js).toContain("indexOf('/baixar/')>=0");
    expect(h).toContain('#nav-carrega');
    expect(h).toMatch(/prefers-reduced-motion:reduce\)\{html\.navegando #nav-carrega\{animation:none/);
  });
  it('sem nonce, nenhum script (a CSP recusaria)', () => {
    expect(navegacaoFluidaHTML('')).not.toContain('<script');
  });
});
