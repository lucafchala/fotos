// Páginas de ajuda do álbum (v3.9.0, src/ui/ajuda.js). O que estes testes
// prendem:
//  1. entrenos2026.com/ajuda e /ajuda/<tema> respondem com o álbum aberto, e os
//     links das respostas ficam no domínio do álbum (sem /galeria/<slug>);
//  2. antes do lançamento ("Em breve"), o público recebe 404: a ajuda não
//     revela o álbum surpresa;
//  3. tema que não existe é 404; "Apoiar" só aparece com Pix cadastrado;
//  4. no site principal, /galeria/<slug>/ajuda funciona e os links levam o
//     prefixo; "ajuda" é nome reservado (não vira evento);
//  5. a página não tem script sem nonce nem innerHTML.
import { describe, it, expect } from 'vitest';
import worker from '../src/index.js';
import { DOMINIOS_DE_ALBUM } from '../src/config.js';
import { validateSlug, saveEvents } from '../src/utils.js';
import { ajudaHTML, TEMAS_DE_AJUDA } from '../src/ui/ajuda.js';
import { withDurableObjects } from './helpers/do.js';

const SLUG = DOMINIOS_DE_ALBUM['entrenos2026.com'].slug;
const ctx = { waitUntil: () => {} };

function kv(events) {
  const store = new Map(Object.entries({ events: JSON.stringify(events) }));
  return { async get(k) { return store.has(k) ? store.get(k) : null; },
    async put(k, v) { store.set(k, v); }, async delete(k) { store.delete(k); },
    async list() { return { keys: [], list_complete: true }; } };
}
const ABERTO = [{ id: '1', slug: SLUG, title: 'Entre Nós', accessType: 'public' }];
/**
 * saveEvents também troca o cache de eventos do isolate: sem isso, o teste
 * seguinte leria a lista do anterior.
 * @param {string} endereco @param {any[]} [eventos]
 */
const pede = async (endereco, eventos = ABERTO) => {
  const env = withDurableObjects({ FOTOS: kv(eventos) });
  await saveEvents(env, structuredClone(eventos));
  return worker.fetch(new Request(endereco), env, ctx);
};

describe('ajuda no domínio do álbum', () => {
  it('/ajuda lista os temas, com o campo de dúvida e links no próprio domínio', async () => {
    const res = await pede('https://entrenos2026.com/ajuda');
    expect(res.status).toBe(200);
    expect(res.headers.get('X-Robots-Tag')).toBe('noindex');
    const h = await res.text();
    expect(h).toContain('<h1>Como usar o álbum</h1>');
    expect(h).toContain('id="aj-q"');
    expect(h).toContain('href="/ajuda/rosto"');
    expect(h).toContain('href="/ajuda/remover"');
    expect(h).not.toContain('/galeria/');
  });

  it('/ajuda/<tema> mostra só aquele tema, com as respostas abertas', async () => {
    const h = await (await pede('https://entrenos2026.com/ajuda/rosto')).text();
    expect(h).toContain('<h1>Achar minhas fotos pelo rosto</h1>');
    expect(h).toContain('<details data-q=');
    expect(h).toMatch(/<details data-q="[^"]*" open>/);
    expect(h).not.toContain('Como baixo uma foto?');
    expect(h).toContain('href="/ajuda/remover"');
  });

  it('antes do lançamento ("Em breve"), o público recebe 404', async () => {
    const emBreve = [{ ...ABERTO[0], comingSoon: true, visible: false }];
    expect((await pede('https://entrenos2026.com/ajuda', emBreve)).status).toBe(404);
    expect((await pede('https://entrenos2026.com/ajuda/rosto', emBreve)).status).toBe(404);
  });

  it('tema que não existe é 404; "Apoiar" só com Pix', async () => {
    expect((await pede('https://entrenos2026.com/ajuda/nada')).status).toBe(404);
    expect((await pede('https://entrenos2026.com/ajuda/apoiar')).status).toBe(404);
    const comPix = [{ ...ABERTO[0], pixChave: 'chave-de-teste' }];
    const h = await (await pede('https://entrenos2026.com/ajuda/apoiar', comPix)).text();
    expect(h).toContain('href="/#al-apoio-t"');
  });
});

describe('ajuda no site principal', () => {
  it('/galeria/<slug>/ajuda funciona com o prefixo nos links', async () => {
    const res = await pede(`https://fotos.lucafchala.com/galeria/${SLUG}/ajuda/baixar`);
    expect(res.status).toBe(200);
    const h = await res.text();
    expect(h).toContain(`href="/galeria/${SLUG}/ajuda"`);
  });

  it('"ajuda" é nome reservado: não vira projeto', () => {
    expect(validateSlug('ajuda')).toBe(false);
  });
});

describe('a página em si', () => {
  it('todo script com nonce, sem innerHTML; título de evento escapado', () => {
    const h = /** @type {string} */ (ajudaHTML({ event: { slug: 'x', title: '<b>Turma</b>' }, tema: '', base: '/galeria/x', nonce: 'NONCE' }));
    for (const s of h.match(/<script[^>]*>/gi) || []) expect(s).toContain('nonce="NONCE"');
    expect(h).not.toContain('innerHTML');
    expect(h).toContain('&lt;b&gt;Turma&lt;/b&gt;');
    expect(h).not.toContain('<b>Turma</b>');
  });

  it('cada tema tem título, resumo e perguntas; os nomes são únicos', () => {
    const nomes = TEMAS_DE_AJUDA.map(t => t.tema);
    expect(new Set(nomes).size).toBe(nomes.length);
    for (const t of TEMAS_DE_AJUDA) {
      expect(t.titulo && t.resumo && t.perguntas.length).toBeTruthy();
      expect(t.tema).toMatch(/^[a-z]+$/);
    }
  });
});
