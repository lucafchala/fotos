// #196 — evento sem `date` nem `createdAt` (só chega por restauração ou dado
// legado: `mergeRestore` aceita) saía com "1970" no rótulo do ano da galeria,
// no breadcrumb e no JSON-LD da página. `new Date(0).getFullYear()` é 1970.
// A sonda passa pelo roteador de verdade, que é onde o defeito foi reproduzido.

import { describe, it, expect } from 'vitest';
import worker from '../src/index.js';
import { saveEvents, eventYear } from '../src/utils.js';
import { galleryHTML } from '../src/ui/gallery.js';
import { withDurableObjects } from './helpers/do.js';

function fakeKV() {
  const store = new Map();
  return {
    async get(k) { return store.has(k) ? store.get(k) : null; },
    async put(k, v) { store.set(k, v); },
    async delete(k) { store.delete(k); },
    async list({ prefix = '' } = {}) {
      return { keys: [...store.keys()].filter(k => k.startsWith(prefix)).map(name => ({ name })), list_complete: true, cursor: null };
    },
  };
}
const ctx = { waitUntil() {} };

const SEM_DATA = { id: 'x', slug: 'sem-data', title: 'Sem data', accessType: 'public', visible: true, photos: [] };

describe('eventYear', () => {
  it('prefere date, depois createdAt, depois updatedAt', () => {
    expect(eventYear({ date: '2024-03-02', createdAt: '2020-01-01T00:00:00Z' })).toBe('2024');
    expect(eventYear({ createdAt: '2023-06-01T12:00:00Z', updatedAt: '2025-01-01T00:00:00Z' })).toBe('2023');
    expect(eventYear({ updatedAt: '2025-01-01T12:00:00Z' })).toBe('2025');
  });
  it('sem data utilizável devolve vazio, nunca 1970', () => {
    expect(eventYear({})).toBe('');
    expect(eventYear({ createdAt: 'lixo' })).toBe('');
    expect(eventYear({ createdAt: 0 })).toBe('');
    expect(eventYear({ date: 'x', createdAt: 'lixo' })).toBe('');
  });
});

describe('evento sem data nas páginas (#196)', () => {
  it('a página do projeto não mostra 1970 nem no HTML nem no JSON-LD', async () => {
    const env = withDurableObjects({ FOTOS: fakeKV() });
    await saveEvents(env, [structuredClone(SEM_DATA)]);
    const res = await worker.fetch(new Request('https://fotos.lucafchala.com/sem-data'), env, ctx);
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).not.toContain('1970');
    expect(html).not.toContain('?year=');
    // Fatiado por indexOf, não por regex de tag: o bloco é o primeiro JSON-LD
    // da página, e o serializador neutraliza `<` dentro dele.
    const abre = html.indexOf('>', html.indexOf('<script type="application/ld+json"')) + 1;
    const ld = JSON.parse(html.slice(abre, html.indexOf('</' + 'script>', abre)));
    const trilha = ld.find(n => n['@type'] === 'BreadcrumbList').itemListElement;
    expect(trilha.map(i => i.position)).toEqual([1, 2]);
    expect(trilha[1].name).toBe('Sem data');
  });

  it('a página de projeto COM data mantém o ano na trilha', async () => {
    const env = withDurableObjects({ FOTOS: fakeKV() });
    await saveEvents(env, [{ ...structuredClone(SEM_DATA), slug: 'com-data', date: '2025-04-01' }]);
    const html = await (await worker.fetch(new Request('https://fotos.lucafchala.com/com-data'), env, ctx)).text();
    expect(html).toContain('href="/?year=2025"');
  });

  it('a galeria agrupa sob "Sem data" e o cartão de link ignora o ano vazio', () => {
    const html = galleryHTML([SEM_DATA, { ...SEM_DATA, id: 'y', slug: 'y', date: '2024-01-01' }], null);
    expect(html).not.toContain('1970');
    expect(html).toContain('>Sem data</h2>');
  });
});
