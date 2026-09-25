// /api/recentes — a lista que a home lucafchala.com lê para o widget
// "Galerias recentes". É o único endpoint com CORS aberto do site, então o
// que importa travar é o que ele NÃO devolve: projeto oculto, private/family
// e qualquer campo além dos que o widget desenha.
import { describe, it, expect, vi } from 'vitest';
import { withDurableObjects } from './helpers/do.js';

function kv(events) {
  const store = new Map(Object.entries({ events: JSON.stringify(events) }));
  return { async get(k) { return store.has(k) ? store.get(k) : null; },
    async put(k, v) { store.set(k, v); }, async delete(k) { store.delete(k); },
    async list() { return { keys: [], list_complete: true }; }, _store: store };
}
const ctx = { waitUntil: () => {} };

// Isolate FRIO a cada chamada: getEvents() sem `fresh` responde do cache de
// módulo, e um teste anterior serviria a lista dele no lugar desta.
async function recentes(events, init) {
  vi.resetModules();
  const { default: coldWorker } = await import('../src/index.js');
  const env = withDurableObjects({ FOTOS: kv(events) });
  return coldWorker.fetch(new Request('https://fotos.lucafchala.com/api/recentes', init), env, ctx);
}

describe('/api/recentes', () => {
  it('só lista o que a galeria pública mostra — oculto e private/family ficam de fora', async () => {
    const res = await recentes([
      { id: 'a', slug: 'publico', title: 'Público', visible: true, date: '2026-09-01' },
      { id: 'b', slug: 'oculto', title: 'Oculto', visible: false, date: '2026-09-20' },
      { id: 'c', slug: 'da-familia', title: 'Família', accessType: 'family', date: '2026-09-21' },
      { id: 'd', slug: 'so-participantes', title: 'Privado', accessType: 'private', date: '2026-09-22' },
    ]);
    expect(res.status).toBe(200);
    const { galerias } = await res.json();
    expect(galerias.map(g => g.slug)).toEqual(['publico']);
  });

  it('fixado primeiro, depois do mais novo ao mais velho, no máximo 5', async () => {
    const res = await recentes([
      { id: '1', slug: 'e1', title: 'E1', date: '2026-01-01' },
      { id: '2', slug: 'e2', title: 'E2', date: '2026-02-01' },
      { id: '3', slug: 'e3', title: 'E3', date: '2026-03-01' },
      { id: '4', slug: 'e4', title: 'E4', date: '2026-04-01' },
      { id: '5', slug: 'e5', title: 'E5', date: '2026-05-01' },
      { id: '6', slug: 'e6', title: 'E6', date: '2026-06-01' },
      { id: '7', slug: 'velho-fixado', title: 'Fixado', date: '2025-01-01', pinned: true },
    ]);
    const { galerias } = await res.json();
    expect(galerias.map(g => g.slug)).toEqual(['velho-fixado', 'e6', 'e5', 'e4', 'e3']);
    expect(galerias[0].destaque).toBe(true);
    expect(galerias[1].destaque).toBe(false);
  });

  it('devolve só os campos do widget, e data fora do formato vira null', async () => {
    const res = await recentes([
      { id: 'a', slug: 'show', title: 'Show', date: '2026-09-12', comingSoon: true,
        driveUrl: 'https://drive.google.com/x', thumbnailUrl: 'https://lh3.googleusercontent.com/y', accessType: 'public' },
      { id: 'b', slug: 'sem-data', title: 'Sem data', date: 'ontem' },
    ]);
    const { galerias } = await res.json();
    expect(galerias[0]).toEqual({
      slug: 'show', titulo: 'Show', data: '2026-09-12',
      url: 'https://fotos.lucafchala.com/show', destaque: false, emBreve: true,
    });
    expect(galerias.find(g => g.slug === 'sem-data').data).toBeNull();
    expect(JSON.stringify(galerias)).not.toMatch(/drive|lh3|accessType/);
  });

  it('pula registro sem slug ou título em vez de devolver item quebrado', async () => {
    const res = await recentes([
      { id: 'a', title: 'Sem slug', date: '2026-09-02' },
      { id: 'b', slug: 'sem-titulo', date: '2026-09-03' },
      { id: 'c', slug: 'ok', title: 'Ok', date: '2026-09-01' },
    ]);
    const { galerias } = await res.json();
    expect(galerias.map(g => g.slug)).toEqual(['ok']);
  });

  it('é legível de outra origem e cacheável', async () => {
    const res = await recentes([{ id: 'a', slug: 'x', title: 'X' }]);
    expect(res.headers.get('Access-Control-Allow-Origin')).toBe('*');
    expect(res.headers.get('Cross-Origin-Resource-Policy')).toBe('cross-origin');
    expect(res.headers.get('Cache-Control')).toBe('public, max-age=300');
    expect(res.headers.get('Content-Type')).toBe('application/json; charset=utf-8');
  });

  it('só GET: outro método não cria rota nova', async () => {
    const res = await recentes([{ id: 'a', slug: 'x', title: 'X' }], { method: 'POST', headers: { 'Sec-Fetch-Site': 'same-origin' } });
    expect(res.status).toBe(404);
  });
});
