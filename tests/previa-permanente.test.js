// Prévia permanente (preview.fotos.lucafchala.com, preview.entrenos2026.com).
// O que estes testes prendem:
//  1. a troca de host: o site recebe o host real e quem navega fica no preview.;
//  2. a recusa sem AMBIENTE = "previa";
//  3. a configuração: Worker próprio, sem cron, R2 próprio, sem ids de produção;
//  4. o script recusa publicar com o KV ou o D1 de produção.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import previa, { hostReal, paraPrevia, paraProducao } from '../src/previa-permanente.js';
import { DOMINIOS_DE_ALBUM } from '../src/config.js';
import { idsDeProducao, configComIds } from '../scripts/previa-permanente.mjs';
import { withDurableObjects } from './helpers/do.js';

const SLUG = DOMINIOS_DE_ALBUM['entrenos2026.com'].slug;
const ctx = { waitUntil: () => {} };
const TOML = readFileSync(new URL('../wrangler.toml', import.meta.url), 'utf8');
const MODELO = readFileSync(new URL('../wrangler.previa-permanente.toml', import.meta.url), 'utf8');

function kv(events = []) {
  const store = new Map(Object.entries({ events: JSON.stringify(events) }));
  return { async get(k) { return store.has(k) ? store.get(k) : null; },
    async put(k, v) { store.set(k, v); }, async delete(k) { store.delete(k); },
    async list() { return { keys: [], list_complete: true }; } };
}
const ALBUM = [{ id: '1', slug: SLUG, title: 'Entre Nós', accessType: 'public' }];
/** @param {string} endereco @param {RequestInit} [init] @param {Record<string, any>} [extra] */
const pede = (endereco, init, extra = { AMBIENTE: 'previa' }) =>
  previa.fetch(new Request(endereco, init), withDurableObjects({ FOTOS: kv(ALBUM), ...extra }), ctx);

describe('prévia permanente: troca de host', () => {
  it('reconhece só os dois nomes de prévia', () => {
    expect(hostReal('preview.fotos.lucafchala.com')).toBe('fotos.lucafchala.com');
    expect(hostReal('PREVIEW.entrenos2026.com')).toBe('entrenos2026.com');
    expect(hostReal('fotos.lucafchala.com')).toBeNull();
    expect(hostReal('preview.exemplo.com')).toBeNull();
    expect(hostReal('fotos-previa-permanente.x.workers.dev')).toBeNull();
  });

  it('troca endereços absolutos e deixa o texto corrido', () => {
    expect(paraPrevia('<a href="https://entrenos2026.com/x">')).toBe('<a href="https://preview.entrenos2026.com/x">');
    expect(paraPrevia('https://www.entrenos2026.com/')).toBe('https://preview.entrenos2026.com/');
    expect(paraPrevia('//fotos.lucafchala.com/a')).toBe('//preview.fotos.lucafchala.com/a');
    expect(paraPrevia('via fotos.lucafchala.com')).toBe('via fotos.lucafchala.com');
    expect(paraPrevia('https://fotos.lucafchala.com.evil.com')).toBe('https://fotos.lucafchala.com.evil.com');
    expect(paraProducao('https://preview.fotos.lucafchala.com')).toBe('https://fotos.lucafchala.com');
  });

  it('preview.entrenos2026.com abre o álbum na raiz, com links da prévia', async () => {
    const res = await pede('https://preview.entrenos2026.com/');
    expect(res.status).toBe(200);
    const html = await res.text();
    // Nenhum endereço absoluto do álbum de produção: depois de https:// vem
    // sempre o preview. (Sem âncora, o CodeQL avisa regex de URL solta.)
    expect(html.split('https://').slice(1).filter(t => /^(www\.)?entrenos2026\.com(?![\w.-])/.test(t))).toEqual([]);
    expect(html).toContain('preview.entrenos2026.com');
  });

  it('redirecionamentos ficam no preview.', async () => {
    const res = await pede('https://preview.entrenos2026.com/dashboard', { redirect: 'manual' });
    // O painel mora no domínio principal: na prévia, o principal da prévia.
    expect(res.status).toBe(302);
    expect(res.headers.get('Location')).toBe('https://preview.fotos.lucafchala.com/dashboard');
    expect(res.headers.get('X-Robots-Tag')).toMatch(/noindex/);
  });

  it('um POST da própria prévia não é tido como de outra origem', async () => {
    const res = await pede('https://preview.fotos.lucafchala.com/api/perf', {
      method: 'POST', body: '{}', headers: { Origin: 'https://preview.fotos.lucafchala.com', 'Content-Type': 'application/json' },
    });
    expect(res.status).not.toBe(403);
  });

  it('recusa servir sem AMBIENTE = "previa"', async () => {
    const res = await pede('https://preview.fotos.lucafchala.com/', undefined, {});
    expect(res.status).toBe(503);
  });
});

describe('prévia permanente: configuração', () => {
  it('é outro Worker, com a entrada da prévia e a marca de prévia', () => {
    expect(MODELO).toMatch(/^name = "fotos-previa-permanente"$/m);
    expect(MODELO).toMatch(/^main = "src\/previa-permanente\.js"$/m);
    expect(MODELO).toMatch(/^AMBIENTE = "previa"$/m);
  });

  it('não tem cron nem ids escritos, e o R2 é próprio', () => {
    expect(MODELO).not.toMatch(/^\[triggers\]/m);
    expect(MODELO).toMatch(/^bucket_name = "fotos-previa-permanente"$/m);
    expect(MODELO).not.toMatch(/bucket_name = "fotos-album"/);
    expect(TOML).toMatch(/^bucket_name = "fotos-album"$/m);
    expect(MODELO).toMatch(/id = "__KV_ID__"/);
    expect(MODELO).toMatch(/database_id = "__D1_ID__"/);
  });

  it('não abre o workers.dev, que o Access não cobre', () => {
    expect(MODELO).toMatch(/^workers_dev = false$/m);
  });

  it('responde nos dois domínios de prévia', () => {
    expect(MODELO).toContain('{ pattern = "preview.fotos.lucafchala.com", custom_domain = true }');
    expect(MODELO).toContain('{ pattern = "preview.entrenos2026.com", custom_domain = true }');
  });

  it('o script lê os ids de produção (só do topo do wrangler.toml)', () => {
    const ids = idsDeProducao(TOML);
    expect(ids.size).toBe(2);
    expect(ids.has('4d2c399e77804f3a82b66e4ec0a7fa5e')).toBe(true);
  });

  it('o script recusa o KV ou o D1 de produção', () => {
    const prod = idsDeProducao(TOML);
    const [kvProd, d1Prod] = [...prod];
    const kvNovo = '0123456789abcdef0123456789abcdef';
    const d1Novo = '01234567-89ab-cdef-0123-456789abcdef';
    expect(() => configComIds(MODELO, kvProd, d1Novo, prod)).toThrow(/PRODUÇÃO/);
    expect(() => configComIds(MODELO, kvNovo, d1Prod, prod)).toThrow(/PRODUÇÃO/);
    const ok = configComIds(MODELO, kvNovo, d1Novo, prod);
    expect(ok).toContain(`id = "${kvNovo}"`);
    expect(ok).toContain(`database_id = "${d1Novo}"`);
  });
});
