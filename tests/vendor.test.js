// Bibliotecas vendorizadas (hoje, o PhotoSwipe da galeria própria, #235).
//
// Mesmo contrato das fontes (tests/fonts.test.js): o que vai no bundle
// (`src/content/vendor.js`) tem de ser BYTE A BYTE o que está em `vendor/`, e o
// nome publicado leva o hash do conteúdo — é isso que torna seguro o cache
// `immutable` de um ano. Trocar um arquivo em `vendor/` sem `npm run
// build:vendor` reprova aqui, com a instrução de conserto.

import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { VENDOR } from '../src/content/vendor.js';

const sha256 = (/** @type {string} */ t) => createHash('sha256').update(t, 'utf8').digest('hex');

describe('módulo gerado de bibliotecas vendorizadas', () => {
  it('traz o PhotoSwipe inteiro: lightbox, núcleo e CSS', () => {
    expect(VENDOR.map(v => v.source).sort()).toEqual([
      'vendor/photoswipe/photoswipe-lightbox.esm.min.js',
      'vendor/photoswipe/photoswipe.css',
      'vendor/photoswipe/photoswipe.esm.min.js',
    ]);
  });

  it.each(VENDOR.map(v => [v.source, v]))('%s: o módulo gerado é o arquivo, byte a byte', (_s, v) => {
    const noDisco = readFileSync(new URL('../' + v.source, import.meta.url), 'utf8');
    expect(sha256(v.texto), `${v.source} mudou — rode npm run build:vendor`).toBe(sha256(noDisco));
    expect(v.sha256).toBe(sha256(noDisco));
  });

  it.each(VENDOR.map(v => [v.path, v]))('%s: o nome publicado leva o hash do conteúdo', (_p, v) => {
    expect(v.path).toMatch(new RegExp(`^/vendor/[a-z-]+\\.${v.sha256.slice(0, 10)}\\.(js|css)$`));
  });

  it('a licença MIT acompanha os arquivos (a licença exige)', () => {
    const licenca = new URL('../vendor/photoswipe/LICENSE', import.meta.url);
    expect(existsSync(licenca)).toBe(true);
    expect(readFileSync(licenca, 'utf8')).toMatch(/The MIT License/);
  });

  it('nada no código vendorizado que a CI de segurança proíbe em src/', () => {
    // O módulo gerado mora em src/content/, e a invariante "Nenhuma primitiva
    // de execução dinâmica" do security.yml varre src/ inteiro.
    for (const v of VENDOR) expect(v.texto, v.source).not.toMatch(/\beval\(|new Function\(|document\.write\(/);
  });
});
