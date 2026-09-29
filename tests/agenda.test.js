// Selo de agenda (#211): uma frase que o dono edita no painel e aparece no
// topo da galeria e da /sobre. O que importa travar: vazio não mostra nada,
// o texto passa pelo escape, uma falha de leitura NUNCA derruba a home, e
// salvar exige sessão.
import { describe, it, expect, vi } from 'vitest';
import { withDurableObjects } from './helpers/do.js';
import { limpaAgenda, AGENDA_MAX_LEN } from '../src/utils.js';
import { galleryHTML } from '../src/ui/gallery.js';
import { aboutHTML } from '../src/ui/about.js';
import { dashboardHTML } from '../src/ui/dashboard.js';

function kv(inicial = {}) {
  const store = new Map(Object.entries({ events: '[]', ...inicial }));
  let escritas = 0;
  return {
    async get(k) { return store.has(k) ? store.get(k) : null; },
    async put(k, v) { escritas++; store.set(k, v); },
    async delete(k) { escritas++; store.delete(k); },
    async list() { return { keys: [], list_complete: true }; },
    _store: store,
    get escritas() { return escritas; },
  };
}
const ctx = { waitUntil: () => {} };

// Isolate FRIO a cada chamada: o selo tem cache de módulo de 30 s.
async function frio() {
  vi.resetModules();
  const { default: w } = await import('../src/index.js');
  return w;
}
const get = async (FOTOS, caminho) => (await frio()).fetch(new Request(`https://fotos.lucafchala.com${caminho}`), withDurableObjects({ FOTOS }), ctx);

describe('limpaAgenda', () => {
  it('uma linha, sem espaço sobrando, no teto; o que não é texto vira vazio', () => {
    expect(limpaAgenda('  Agendando\n para   janeiro  ')).toBe('Agendando para janeiro');
    expect(limpaAgenda('x'.repeat(500))).toHaveLength(AGENDA_MAX_LEN);
    expect(limpaAgenda(null)).toBe('');
    expect(limpaAgenda(42)).toBe('');
  });
});

describe('selo na página', () => {
  it('vazio, nada aparece; com texto, sai escapado na galeria e na /sobre', () => {
    expect(galleryHTML([], null, 'N')).not.toContain('agenda-selo">');
    expect(aboutHTML()).not.toContain('agenda-selo">');
    const hostil = '<img src=x onerror=alert(1)>';
    for (const html of [galleryHTML([], null, 'N', hostil), aboutHTML(hostil)]) {
      expect(html).toContain('agenda-selo">&lt;img src=x onerror=alert(1)&gt;</p>');
      expect(html).not.toContain(hostil);
    }
    expect(dashboardHTML([], [], 'N', hostil)).toContain('value="&lt;img src=x onerror=alert(1)&gt;"');
  });

  it('a home e a /sobre leem o selo do KV', async () => {
    for (const caminho of ['/', '/sobre']) {
      const html = await (await get(kv({ agenda: 'Agenda fechada até março' }), caminho)).text();
      expect(html, caminho).toContain('agenda-selo">Agenda fechada até março</p>');
    }
  });

  it('falha de leitura do selo não derruba a home: sai sem selo', async () => {
    const FOTOS = kv();
    const real = FOTOS.get;
    FOTOS.get = k => (k === 'agenda' ? Promise.reject(new Error('KV GET failed: 503')) : real(k));
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const res = await get(FOTOS, '/');
    expect(res.status).toBe(200);
    expect(await res.text()).not.toContain('agenda-selo">');
    vi.restoreAllMocks();
  });
});

describe('PUT /api/settings/agenda', () => {
  const put = async (FOTOS, corpo, cookie = '') => (await frio()).fetch(new Request('https://fotos.lucafchala.com/api/settings/agenda', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json', 'Sec-Fetch-Site': 'same-origin', Cookie: cookie },
    body: JSON.stringify(corpo),
  }), withDurableObjects({ FOTOS }), ctx);
  const TOKEN = 'a'.repeat(64);
  const logado = () => kv({ [`admin_session:${TOKEN}`]: JSON.stringify({ createdAt: Date.now() }) });

  it('sem sessão, 401 e nada gravado', async () => {
    const FOTOS = kv();
    expect((await put(FOTOS, { texto: 'x' })).status).toBe(401);
    expect(FOTOS._store.has('agenda')).toBe(false);
  });

  it('com sessão, grava o texto limpo; vazio apaga a chave', async () => {
    const FOTOS = logado();
    const res = await put(FOTOS, { texto: '  Agendando   para 2027 ' }, `__Host-session=${TOKEN}`);
    expect(res.status).toBe(200);
    expect((await res.json()).texto).toBe('Agendando para 2027');
    expect(FOTOS._store.get('agenda')).toBe('Agendando para 2027');
    await put(FOTOS, { texto: '' }, `__Host-session=${TOKEN}`);
    expect(FOTOS._store.has('agenda')).toBe(false);
  });

  it('texto que não é string é recusado', async () => {
    const res = await put(logado(), { texto: { x: 1 } }, `__Host-session=${TOKEN}`);
    expect(res.status).toBe(400);
  });
});
