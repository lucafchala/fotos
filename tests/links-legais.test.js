// 4.1.5: nos textos legais, link no meio do texto é sublinhado (a cor sozinha
// dava 1,7:1 com o texto ao lado; o axe acusava "link-in-text-block"), o
// "voltar" e os links do rodapé têm 44 px de altura, e a tabela rolável da
// Central de Transparência recebe foco pelo teclado.
import { describe, it, expect } from 'vitest';
import { privacyHTML } from '../src/ui/privacy.js';
import { termsHTML } from '../src/ui/terms.js';
import { legalHTML } from '../src/ui/legal.js';

const paginas = /** @type {const} */ ([['privacidade', privacyHTML], ['termos', termsHTML], ['legal', legalHTML]]);

describe('links das páginas legais', () => {
  for (const [nome, pagina] of paginas) {
    const h = pagina();
    it(`${nome}: link dentro do texto é sublinhado`, () => {
      expect(h).toMatch(/:is\(p,li,td,dd\) a:not\(\[class\]\)\{text-decoration:underline/);
      // E existe link nessa situação (senão a regra não prende nada).
      expect(h).toMatch(/<(p|li|td|dd)\b[^>]*>(?:(?!<\/\1>)[\s\S])*<a href=/);
    });
    it(`${nome}: "voltar" e rodapé com 44 px`, () => {
      expect(h).toMatch(/\.back\{[^}]*min-height:44px/);
      expect(h).toMatch(/footer a\{[^}]*min-height:44px/);
    });
  }

  it('legal: a tabela que rola para o lado recebe foco e tem nome', () => {
    const h = legalHTML();
    expect(h).toContain('<div class="table-wrap" tabindex="0" role="region" aria-label="Seus dados, em resumo (role para o lado)">');
    expect(h).toMatch(/\.table-wrap:focus-visible\{outline:2px/);
  });
});
