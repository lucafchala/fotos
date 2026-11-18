// Página de erro (4.1.3). O que estes testes prendem:
//  1. Contraste: texto, frase e links passam de 4,5:1 nos dois temas (antes
//     o número tinha 1,13, a frase 2,9 e os links 3,6).
//  2. Os links se distinguem sem depender da cor (sublinhados) e têm 44 px.
//  3. O texto é neutro: a mesma página sai no domínio de um álbum.
//  4. A rota de verdade usa esta página (404 de rota inexistente).

import { describe, it, expect } from 'vitest';
import { paginaDeErroHTML, CORES_DA_PAGINA_DE_ERRO } from '../src/ui/erro.js';
import worker from '../src/index.js';

/** @param {string} hex */
function luminancia(hex) {
  const [r, g, b] = [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16) / 255)
    .map(c => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}
/** @param {string} a @param {string} b */
function contraste(a, b) {
  const [x, y] = [luminancia(a), luminancia(b)].sort((m, n) => n - m);
  return (x + 0.05) / (y + 0.05);
}

describe('página de erro', () => {
  for (const [tema, c] of Object.entries(CORES_DA_PAGINA_DE_ERRO)) {
    it(`tema ${tema}: texto, frase e links passam de 4,5:1`, () => {
      expect(contraste(c.texto, c.fundo)).toBeGreaterThanOrEqual(4.5);
      expect(contraste(c.suave, c.fundo)).toBeGreaterThanOrEqual(4.5);
      expect(contraste(c.link, c.fundo)).toBeGreaterThanOrEqual(4.5);
    });
  }

  it('as cores do teste são as da página, nos dois temas', () => {
    const h = paginaDeErroHTML('404', 'Página não encontrada.');
    for (const c of Object.values(CORES_DA_PAGINA_DE_ERRO)) {
      for (const cor of Object.values(c)) expect(h).toContain(cor);
    }
    expect(h).toContain('prefers-color-scheme:dark');
  });

  it('links sublinhados, com 44 px de altura e foco visível', () => {
    const h = paginaDeErroHTML('404', 'Página não encontrada.');
    expect(h).toMatch(/a\{[^}]*text-decoration:underline/);
    expect(h).toMatch(/a\{[^}]*min-height:44px/);
    expect(h).toMatch(/a:focus-visible\{[^}]*outline:2px/);
  });

  it('texto neutro: não fala de "fotos" nem de "galeria", e não indexa', () => {
    const h = paginaDeErroHTML('500', 'Algo deu errado. Tente novamente em instantes.');
    expect(h).not.toMatch(/galeria|· fotos/i);
    expect(h).toContain('<title>Erro 500</title>');
    expect(h).toContain('href="/">Voltar ao início</a>');
    expect(h).toContain('href="/suporte">Falar com o suporte</a>');
    expect(h).toContain('<meta name="robots" content="noindex">');
    expect(paginaDeErroHTML('Ops', 'x')).toContain('<title>Algo deu errado</title>');
  });

  it('a rota inexistente responde 404 com esta página', async () => {
    const env = /** @type {any} */ ({});
    const res = await worker.fetch(new Request('https://fotos.lucafchala.com/nao-existe/de-jeito-nenhum/aqui'), env, /** @type {any} */ ({ waitUntil() {}, passThroughOnException() {} }));
    expect(res.status).toBe(404);
    const h = await res.text();
    expect(h).toContain('Página não encontrada.');
    expect(h).toContain('Voltar ao início');
  });
});
