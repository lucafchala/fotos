// Contraste AA (4,5:1) dos tokens de texto das páginas públicas, nos dois
// temas, sobre cada fundo em que o token é usado. Mede os valores que estão
// no CSS, não uma tabela à parte.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';

const PAGINAS = ['event', 'gallery', 'galeria', 'about', 'support', 'privacy', 'terms', 'gear', 'legal', 'doc'];
const TEXTOS = ['text', 'text-2', 'text-muted', 'text-dim', 'text-dim-2', 'text-ph', 'footer-link'];
// A galeria tem tokens que só servem de borda (text-dim no :hover) e o dourado
// (accent) usado como COR DE TEXTO na etiqueta "Prévia": nela, só se mede o que
// de fato é usado como `color:`, e o accent entra na conta (o axe pegou os dois
// abaixo de 4,5:1 no tema claro, sobre o cartão #e5e1db).
const SO_OS_USADOS_COMO_TEXTO = new Set(['galeria']);
const FUNDOS = /^bg-(page|card|card-2|input)$/;

const lum = (/** @type {string} */ hex) => {
  let h = hex.replace('#', '');
  if (h.length === 3) h = [...h].map(c => c + c).join('');
  const [r, g, b] = [0, 2, 4].map(i => parseInt(h.slice(i, i + 2), 16) / 255).map(v => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};
const razao = (/** @type {string} */ a, /** @type {string} */ b) => {
  const x = lum(a), y = lum(b);
  return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05);
};

describe('contraste AA dos tokens de texto públicos', () => {
  for (const pagina of PAGINAS) {
    it(`${pagina}: todo texto passa de 4,5:1 sobre os fundos do tema`, () => {
      const css = readFileSync(new URL(`../src/ui/${pagina}.js`, import.meta.url), 'utf8');
      const blocos = [...css.matchAll(/:root\{([^}]*)\}/g)].map(m => m[1]);
      const reprovados = [];
      let medidos = 0;
      for (const [i, bloco] of blocos.entries()) {
        /** @type {Record<string, string>} */
        const v = {};
        for (const m of bloco.matchAll(/--([\w-]+):\s*(#[0-9a-fA-F]{3,6})\b/g)) v[m[1]] = m[2];
        for (const fundo of Object.keys(v).filter(k => FUNDOS.test(k))) {
          const candidatos = SO_OS_USADOS_COMO_TEXTO.has(pagina)
            ? [...TEXTOS, 'accent'].filter(t => new RegExp(`(?<![-\\w])color:\\s*var\\(--${t}\\)`).test(css))
            : TEXTOS;
          for (const texto of candidatos.filter(t => v[t])) {
            medidos++;
            const r = razao(v[texto], v[fundo]);
            if (r < 4.5) reprovados.push(`bloco ${i}: ${texto} ${v[texto]} sobre ${fundo} ${v[fundo]} = ${r.toFixed(2)}`);
          }
        }
      }
      expect(medidos).toBeGreaterThan(0);
      expect(reprovados).toEqual([]);
    });
  }
});

// WCAG 1.4.1 (axe: link-in-text-block): o link do aviso de cookies tem 1,08:1 de
// contraste com o texto ao redor no tema claro; sem sublinhado, só a cor o
// distinguiria.
describe('link dentro de texto corrido', () => {
  for (const pagina of ['event', 'gallery']) {
    it(`${pagina}: o link do aviso de cookies é sublinhado`, () => {
      const css = readFileSync(new URL(`../src/ui/${pagina}.js`, import.meta.url), 'utf8');
      const regra = css.match(/\.cookie-notice a\{([^}]*)\}/);
      expect(regra).not.toBeNull();
      expect(regra?.[1]).toMatch(/text-decoration:\s*underline/);
    });
  }
});
