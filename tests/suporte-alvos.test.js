// 4.1.6: na página de suporte, todo alvo de toque tem 44 px de altura (eram
// 15 a 43) e o texto passa no contraste mínimo de 4,5:1 — o botão do WhatsApp
// no tema claro dava 4,36 e a linha "ou envie uma mensagem", 1,4 a 1,5.
// Relatório da revisão de 16/11/2026, achados A5 e A6.
import { describe, it, expect } from 'vitest';
import { supportHTML } from '../src/ui/support.js';

/** Contraste WCAG entre duas cores #rrggbb. */
function contraste(/** @type {string} */ a, /** @type {string} */ b) {
  const lum = (/** @type {string} */ h) => {
    const c = [1, 3, 5].map(i => parseInt(h.slice(i, i + 2), 16) / 255).map(x => (x <= 0.03928 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4));
    return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
  };
  const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p);
  return (x + 0.05) / (y + 0.05);
}

/** As variáveis de cor de um tema, lidas do CSS da página. */
function tema(/** @type {string} */ css) {
  /** @type {Record<string, string>} */
  const v = {};
  for (const m of css.matchAll(/--([a-z0-9-]+):(#[0-9a-f]{6})/gi)) v[m[1]] = m[2].toLowerCase();
  return v;
}

const h = supportHTML(false, '', {}, 'NONCE', 'ft');
const escuro = tema(/** @type {string} */ (h.match(/:root\{([^}]*)\}/))[1]);
const claro = tema(/** @type {string} */ (h.match(/prefers-color-scheme: light\)\s*\{\s*:root\{([^}]*)\}/))[1]);

describe('suporte: alvos de toque', () => {
  it('"Voltar", botões de contato, campos, "Enviar mensagem" e rodapé com 44 px', () => {
    expect(h).toMatch(/\.back\{[^}]*min-height:44px/);
    expect(h).toMatch(/\.contact-btn\{[^}]*min-height:44px/);
    expect(h).toMatch(/input\[type=text\],input\[type=email\]\{min-height:44px\}/);
    expect(h).toMatch(/\.submit-btn\{[^}]*min-height:44px/);
    expect(h).toMatch(/footer a\{[^}]*display:inline-flex;align-items:center;min-height:44px/);
  });

  it('a caixa de consentimento não cresce: o alvo dela é o rótulo inteiro', () => {
    expect(h).not.toMatch(/(^|[{};\s])input\{[^}]*min-height/);
    expect(h).toMatch(/<label style="display:flex[^"]*cursor:pointer[^"]*">\s*<input type="checkbox" id="support-consent"/);
  });
});

describe('suporte: contraste nos dois temas', () => {
  for (const [nome, v] of /** @type {const} */ ([['escuro', escuro], ['claro', claro]])) {
    it(`${nome}: WhatsApp, "ou envie uma mensagem" e a mensagem de sucesso passam de 4,5:1`, () => {
      expect(contraste(v['ok-text'], v['bg-page'])).toBeGreaterThanOrEqual(4.5);
      expect(contraste(v['divider-text'], v['bg-page'])).toBeGreaterThanOrEqual(4.5);
      expect(contraste(v['ok-text'], v['ok-bg'])).toBeGreaterThanOrEqual(4.5);
    });
  }

  it('o divisor usa a variável de texto dele (e não a cor da linha)', () => {
    expect(h).toMatch(/\.divider\{[^}]*color:var\(--divider-text\)/);
    expect(h).toContain('<div class="divider">ou envie uma mensagem</div>');
  });
});
