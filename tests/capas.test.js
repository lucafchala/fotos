// Capas da página de projeto (#141): a caixa reservada antes de a foto chegar
// (CLS), a largura escolhida por pixels físicos para cada foto do carrossel e
// do lightbox, e o Turnstile fora da abertura da página. O comportamento no
// navegador (caixa medida com a foto presa, rotação, rolagem) está em
// `npm run verifica:evento`; aqui fica preso o que o HTML e o script decidem.
import { describe, it, expect } from 'vitest';
import { eventHTML } from '../src/ui/event.js';

const base = { id: 'a', slug: 'a', title: 'A', accessType: 'public', date: '2026-01-01', driveUrl: 'https://drive.google.com/drive/folders/x' };
const fotos = n => Array.from({ length: n }, (_, i) => `https://lh3.googleusercontent.com/d/f${i}`);
const pagina = n => eventHTML({ ...base, photos: fotos(n) }, '2026', null, 'N', 'dn', 'ft');
const css = html => html.match(/<style>([\s\S]*?)<\/style>/)?.[1] ?? '';
/** As declarações da regra cujo seletor é exatamente `sel`. */
const regra = (html, sel) => {
  const esc = sel.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return css(html).match(new RegExp(`(?:^|[}\\s])${esc}\\{([^}]*)\\}`))?.[1] ?? null;
};

describe('caixa da capa reservada antes de a foto chegar (CLS)', () => {
  it('carrossel e foto única: caixa 3:2 com teto de 72vh', () => {
    const r = regra(pagina(3), '.hero-foto,.carousel');
    expect(r).not.toBeNull();
    expect(r).toContain('aspect-ratio:3/2');
    expect(r).toContain('max-height:72vh');
  });

  it('a foto ocupa a caixa e cabe inteira (contain, nunca cortada)', () => {
    const r = regra(pagina(3), '.hero-foto img,.carousel img') ?? '';
    for (const d of ['position:absolute', 'inset:0', 'width:100%', 'height:100%', 'object-fit:contain']) expect(r).toContain(d);
    expect(r).not.toContain('object-fit:cover');
  });

  it('a foto única usa a caixa; o placeholder sem foto e o "em breve" não', () => {
    expect(pagina(1)).toMatch(/<div class="hero hero-foto"><picture>/);
    expect(pagina(0)).not.toContain('hero-foto"');
    const emBreve = eventHTML({ ...base, photos: fotos(1), comingSoon: true }, '2026', null, 'N', 'dn', 'ft');
    expect(emBreve).not.toContain('class="hero hero-foto"');
  });

  it('o lightbox é uma caixa fixa (a tela): trocar de foto não mexe em layout', () => {
    const r = regra(pagina(3), '#lb-img') ?? '';
    expect(r).toContain('width:100%');
    expect(r).toContain('height:100%');
    expect(r).toContain('object-fit:contain');
  });
});

// As funções puras saem do script DA PÁGINA, entre os marcadores, e rodam
// aqui como o navegador as rodaria.
const bloco = pagina(3).match(/\/\/ ---- escolha da largura \(início\) ----([\s\S]*?)\/\/ ---- escolha da largura \(fim\) ----/)?.[1] ?? '';
const { larguraParaTela, urlNaLargura } = /** @type {any} */ (new Function(`${bloco}; return { larguraParaTela, urlNaLargura };`))();
const WS = JSON.parse(pagina(3).match(/const PHOTO_WS = (\[[^\]]*\]);/)?.[1] ?? '[]');
const LH3 = 'https://lh3.googleusercontent.com/d/';

describe('largura de cada foto por pixels físicos (largura CSS × DPR)', () => {
  it('a escada é a do srcset da 1ª foto', () => {
    expect(WS).toEqual([800, 1200, 1600]);
  });

  it('aparelhos de verdade: a menor da escada que cobre a tela', () => {
    expect(larguraParaTela(390, 3, WS)).toBe(1200); // iPhone
    expect(larguraParaTela(360, 2, WS)).toBe(800); // Android pequeno
    expect(larguraParaTela(412, 2.625, WS)).toBe(1200); // Pixel
    expect(larguraParaTela(384, 3.75, WS)).toBe(1600); // Galaxy
    expect(larguraParaTela(844, 3, WS)).toBe(1600); // celular deitado
    expect(larguraParaTela(400, 2, WS)).toBe(800); // exatamente 800 px físicos
    expect(larguraParaTela(320, undefined, WS)).toBe(800); // sem devicePixelRatio = 1
  });

  it('nunca menos pixels que a tela, e telão nunca abaixo dos 1600 de antes', () => {
    for (let css = 280; css <= 3000; css += 37) {
      for (const dpr of [1, 1.5, 2, 2.625, 3, 3.5]) {
        const w = larguraParaTela(css, dpr, WS);
        expect(w >= Math.min(css * dpr, 1600), `${css}@${dpr} → ${w}`).toBe(true);
      }
    }
    expect(larguraParaTela(2560, 1, WS)).toBe(1600);
  });

  it('troca só o sufixo das URLs do lh3 em =w1600; o resto passa intacto', () => {
    expect(urlNaLargura(`${LH3}abc=w1600`, 1200, true, LH3, '=w1600')).toBe(`${LH3}abc=w1200-rw`);
    expect(urlNaLargura(`${LH3}abc=w1600`, 800, false, LH3, '=w1600')).toBe(`${LH3}abc=w800`);
    expect(urlNaLargura(`${LH3}abc=w2400`, 800, true, LH3, '=w1600')).toBe(`${LH3}abc=w2400`);
    expect(urlNaLargura('https://exemplo.com/foto.jpg', 800, true, LH3, '=w1600')).toBe('https://exemplo.com/foto.jpg');
  });

  it('carrossel, lightbox e pré-carga pedem a foto por fotoUrl(), com a janela de AGORA', () => {
    const html = pagina(3);
    expect(html).toContain('larguraParaTela(innerWidth, window.devicePixelRatio, PHOTO_WS)');
    expect(html).toContain('img.src = fotoUrl(cur);');
    expect(html).toContain('lbImg.src = fotoUrl(cur);');
    expect(html).toContain('const u = fotoUrl(i);');
    expect(html).not.toMatch(/\.src = PHOTOS\[/);
  });
});

describe('Turnstile só com intenção (TBT)', () => {
  const SRC = 'https://challenges.cloudflare.com/turnstile/v0/api.js';
  it('a página não traz o <script> do Turnstile na abertura', () => {
    for (const html of [pagina(0), pagina(1), pagina(3)]) {
      expect(html).not.toMatch(/<script[^>]*challenges\.cloudflare\.com\/turnstile/);
    }
  });

  it('o endereço aparece uma vez, por extenso, no script — a prévia o troca por texto ("sem script")', () => {
    const html = pagina(3);
    expect(html.split(SRC).length - 1).toBe(1);
    expect(html).toContain(`const TS_SRC = '${SRC}';`);
  });

  it('carrega no primeiro toque, tecla ou rolagem, e o portão e a remoção esperam por ele', () => {
    const html = pagina(3);
    expect(html).toContain("['pointerdown', 'touchstart', 'keydown', 'scroll'].forEach");
    expect(html).toMatch(/comTurnstile\(function\(\) \{\s*if \(!document\.getElementById\('modal'\)/);
    expect(html).toContain('setTimeout(() => comTurnstile(() => {');
  });
});
