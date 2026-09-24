// Inter servido pela própria origem (#131).
//
// Três coisas precisam concordar e nenhuma delas quebra de forma visível se
// divergir: os WOFF2 em `fonts/`, o módulo gerado em `src/content/fonts.js`
// (que é o que vai no bundle) e o que as páginas e a CSP declaram. Um WOFF2
// trocado sem `npm run build:fonts` publicaria a fonte antiga com cache de um
// ano; um caminho divergente faria o browser cair na fonte do sistema sem
// erro nenhum além de um 404 no console.

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { FONTS } from '../src/content/fonts.js';
import { fontFaceCSS, fontPreloadHTML } from '../src/utils.js';
import { contentSecurityPolicy } from '../src/security.js';
import worker from '../src/index.js';

const sha256 = (/** @type {Uint8Array} */ b) => createHash('sha256').update(b).digest('hex');
const decodifica = (/** @type {string} */ b64) => Uint8Array.from(Buffer.from(b64, 'base64'));

// KV só para o caminho do 404: `/fonts` sem arquivo cai na busca de projeto
// por slug, que lê a lista de eventos.
const env = { FOTOS: { async get(/** @type {string} */ k) { return k === 'events' ? '[]' : null; }, async put() {} } };
const ctx = { waitUntil: () => {} };
const get = (/** @type {string} */ p, method = 'GET') =>
  worker.fetch(new Request('https://fotos.lucafchala.com' + p, { method }), /** @type {any} */ (env), /** @type {any} */ (ctx));

describe('módulo gerado de fontes', () => {
  it('tem a face normal e a itálica', () => {
    expect(FONTS.map(f => f.style).sort()).toEqual(['italic', 'normal']);
  });

  it.each(FONTS.map(f => [f.source, f]))('%s: o módulo gerado é o arquivo, byte a byte', (_s, f) => {
    // É isto que substitui o "a CI regenera e compara" do build:legal: um
    // arquivo trocado sem regenerar reprova aqui, com a instrução de conserto.
    const noDisco = readFileSync(new URL('../' + f.source, import.meta.url));
    const noBundle = decodifica(f.b64);
    expect(sha256(noBundle), `${f.source} mudou — rode npm run build:fonts`).toBe(sha256(noDisco));
    expect(f.sha256).toBe(sha256(noDisco));
    expect(f.bytes).toBe(noDisco.length);
  });

  it.each(FONTS.map(f => [f.path, f]))('%s: é WOFF2 e o nome carrega o hash do conteúdo', (_p, f) => {
    expect(Buffer.from(decodifica(f.b64).subarray(0, 4)).toString('latin1')).toBe('wOF2');
    // O hash no nome é o que torna `immutable` seguro: conteúdo novo, URL nova.
    expect(f.path).toBe(`/fonts/${f.source.replace(/^fonts\//, '').replace(/\.woff2$/, '')}.${f.sha256.slice(0, 10)}.woff2`);
  });

  it('a licença acompanha a fonte', () => {
    // A SIL OFL exige que o texto da licença vá junto dos arquivos da fonte.
    const ofl = readFileSync(new URL('../fonts/OFL.txt', import.meta.url), 'utf8');
    expect(ofl).toMatch(/SIL OPEN FONT LICENSE Version 1\.1/);
    expect(ofl).toMatch(/The Inter Project Authors/);
  });
});

describe('rota /fonts/', () => {
  it.each(FONTS.map(f => [f.path, f]))('GET %s devolve o arquivo com cache imutável', async (_p, f) => {
    // Duas vezes: a segunda sai do cache de bytes decodificados do isolate, e
    // um buffer reaproveitado que tivesse sido consumido pela primeira resposta
    // chegaria vazio aqui.
    //
    // O corpo é comparado byte a byte com o arquivo, NÃO por sha256: para o
    // CodeQL, o que `worker.fetch` devolve pode ser a resposta da troca de
    // senha (é o mesmo roteador), e hash rápido sobre isso vira alerta alto de
    // "senha com hash fraco" (js/insufficient-password-hash). Já aconteceu
    // neste teste; a comparação direta ainda é a prova mais forte das duas.
    const noDisco = readFileSync(new URL('../' + f.source, import.meta.url));
    for (let i = 0; i < 2; i++) {
      const res = await get(f.path);
      expect(res.status).toBe(200);
      expect(res.headers.get('Content-Type')).toBe('font/woff2');
      expect(res.headers.get('Cache-Control')).toBe('public, max-age=31536000, immutable');
      expect(res.headers.get('X-Content-Type-Options')).toBe('nosniff');
      const corpo = Buffer.from(await res.arrayBuffer());
      expect(corpo.length, `chamada ${i + 1}`).toBe(f.bytes);
      expect(corpo.equals(noDisco), `chamada ${i + 1}: bytes diferentes do arquivo`).toBe(true);
    }
  });

  it('HEAD tem o status do GET e não leva corpo', async () => {
    const res = await get(FONTS[0].path, 'HEAD');
    expect(res.status).toBe(200);
    expect(await res.text()).toBe('');
  });

  it.each([
    '/fonts/inter-latin-wght-normal.woff2',          // sem o hash
    '/fonts/inter-latin-wght-normal.0000000000.woff2', // hash de outra versão
    '/fonts/../wrangler.toml',
    '/fonts/',
  ])('%s não existe', async p => {
    expect((await get(p)).status).toBe(404);
  });
});

describe('páginas e CSP', () => {
  it('o @font-face declara cada arquivo gerado, com a faixa do subset e swap', () => {
    const css = fontFaceCSS();
    for (const f of FONTS) {
      expect(css).toContain(`font-style:${f.style}`);
      expect(css).toContain(`src:url(${f.path}) format('woff2')`);
      expect(css).toContain(`unicode-range:${f.unicodeRange}`);
    }
    expect(css.match(/font-display:swap/g)).toHaveLength(FONTS.length);
  });

  it('o preload é da face normal, com crossorigin', () => {
    // Sem `crossorigin` o preload fica num pool diferente do da busca real
    // (fonte é sempre CORS) e o arquivo desce duas vezes.
    const normal = FONTS.find(f => f.style === 'normal');
    expect(fontPreloadHTML()).toBe(`<link rel="preload" href="${normal?.path}" as="font" type="font/woff2" crossorigin>`);
  });

  it.each([false, true])('CSP (strict=%s) só aceita fonte e estilo da própria origem', strict => {
    const csp = contentSecurityPolicy('N', { strict });
    expect(csp).toContain("font-src 'self';");
    expect(csp).toContain("style-src 'self' 'unsafe-inline';");
    expect(csp).not.toMatch(/fonts\.(googleapis|gstatic)\.com/);
  });
});
