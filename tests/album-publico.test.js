// "O público pode ver este álbum?" — UMA definição para o site inteiro (v3.8.8).
//
// A regra estava escrita em vários lugares e eles discordavam (revisão de
// nov/2026, achado 9): a raiz do domínio do álbum olhava "visível E fora do Em
// breve"; a galeria, só o "Em breve"; a home e o /api/recentes, só o "visível".
// O álbum com domínio próprio é SURPRESA antes do lançamento, e bastava um dos
// dois interruptores do painel fora do lugar para ele aparecer:
//   - oculto, mas com "Em breve" desmarcado: a raiz do domínio dizia "em breve"
//     e /galeria/<slug> abria o álbum inteiro;
//   - visível e "Em breve": o título saía na home e no /api/recentes.
// Estes testes prendem a CONCORDÂNCIA entre as rotas, nos quatro estados dos
// dois interruptores, para o álbum com domínio próprio e para um projeto comum
// (que segue como sempre: "oculto" é não listado, e abre por link direto).
import { describe, it, expect, vi } from 'vitest';
import { albumAbertoAoPublico, albumListado, albumLancado, albumSurpresa } from '../src/utils.js';
import { withDurableObjects } from './helpers/do.js';

const ALBUM = {
  id: '1', slug: 'entrenos2026', title: 'Entre Nós · Turma 2026', accessType: 'public', galeriaCapitulos: false,
  driveUrl: 'https://drive.google.com/drive/folders/RAIZ_PASTA_0001',
};
const COMUM = { id: '2', slug: 'projeto-comum', title: 'Projeto Comum', accessType: 'public', driveUrl: 'https://drive.google.com/drive/folders/OUTRA_PASTA_001' };
const ESTADOS = [
  { comingSoon: true, visible: false },
  { comingSoon: true, visible: true },
  { comingSoon: false, visible: false },
  { comingSoon: false, visible: true },
];
const ctx = { waitUntil() {} };

function kv(/** @type {any[]} */ eventos) {
  const store = new Map([['events', JSON.stringify(eventos)]]);
  return { async get(/** @type {string} */ k) { return store.has(k) ? store.get(k) : null; }, async put(/** @type {string} */ k, /** @type {string} */ v) { store.set(k, v); },
    async delete() {}, async list() { return { keys: [], list_complete: true, cursor: null }; } };
}
/** @param {any[]} eventos @param {string} url @param {RequestInit} [init] */
async function pede(eventos, url, init = {}) {
  vi.resetModules();
  const w = (await import('../src/index.js')).default;
  return w.fetch(new Request(url, { ...init, headers: { 'CF-Connecting-IP': '203.0.113.7', ...(init.headers || {}) } }), withDurableObjects({ FOTOS: kv(eventos) }), ctx);
}

describe('a regra (utils.js)', () => {
  it('álbum com domínio próprio: só abre visível E fora do "Em breve"; fechado, é surpresa e não é listado', () => {
    for (const e of ESTADOS) {
      const a = /** @type {any} */ ({ ...ALBUM, ...e });
      const aberto = e.visible && !e.comingSoon;
      expect(albumAbertoAoPublico(a), JSON.stringify(e)).toBe(aberto);
      expect(albumLancado(a), JSON.stringify(e)).toBe(aberto);
      expect(albumSurpresa(a), JSON.stringify(e)).toBe(!aberto);
      expect(albumListado(a), JSON.stringify(e)).toBe(aberto);
    }
  });

  it('projeto comum: "Em breve" fecha as fotos; "oculto" só tira das listas (segue abrindo por link)', () => {
    for (const e of ESTADOS) {
      const p = /** @type {any} */ ({ ...COMUM, ...e });
      expect(albumAbertoAoPublico(p), JSON.stringify(e)).toBe(!e.comingSoon);
      expect(albumLancado(p), JSON.stringify(e)).toBe(e.visible && !e.comingSoon);
      expect(albumSurpresa(p), JSON.stringify(e)).toBe(false);
      expect(albumListado(p), JSON.stringify(e)).toBe(e.visible);
    }
  });

  it('sem projeto: fechado, não listado, não lançado', () => {
    for (const f of [albumAbertoAoPublico, albumListado, albumLancado, albumSurpresa]) {
      expect(f(undefined)).toBe(false);
      expect(f(null)).toBe(false);
    }
  });
});

describe('as rotas concordam: o álbum com domínio próprio antes do lançamento', () => {
  for (const e of ESTADOS.filter(x => !(x.visible && !x.comingSoon))) {
    const rotulo = `visível=${e.visible}, em breve=${e.comingSoon}`;
    const eventos = [{ ...ALBUM, ...e }];

    it(`${rotulo}: a galeria é o 404 de rota inexistente, no site e no domínio do álbum`, async () => {
      expect((await pede(eventos, 'https://fotos.lucafchala.com/galeria/entrenos2026')).status).toBe(404);
      expect((await pede(eventos, 'https://fotos.lucafchala.com/galeria/entrenos2026/capitulo-de-teste')).status).toBe(404);
      expect((await pede(eventos, 'https://entrenos2026.com/capitulo-de-teste')).status).toBe(404);
    });

    it(`${rotulo}: a raiz do domínio mostra "em breve", não a galeria`, async () => {
      const res = await pede(eventos, 'https://entrenos2026.com/');
      expect(res.status).toBe(200);
      const html = await res.text();
      expect(html).toContain('Entre Nós');
      expect(html).not.toContain('g-dados');
    });

    it(`${rotulo}: nem a home, nem o /api/recentes, nem os sitemaps, nem a página do projeto dizem que ele existe`, async () => {
      const home = await (await pede(eventos, 'https://fotos.lucafchala.com/')).text();
      expect(home).not.toContain('entrenos2026');
      expect(home).not.toContain('Turma 2026');
      const recentes = await (await pede(eventos, 'https://fotos.lucafchala.com/api/recentes')).text();
      expect(recentes).not.toContain('entrenos2026');
      for (const mapa of ['/sitemap.xml', '/sitemap-galerias.xml']) {
        expect(await (await pede(eventos, `https://fotos.lucafchala.com${mapa}`)).text()).not.toContain('entrenos2026');
      }
      expect((await pede(eventos, 'https://fotos.lucafchala.com/sitemap-galeria-entrenos2026.xml')).status).toBe(404);
      expect((await pede(eventos, 'https://fotos.lucafchala.com/entrenos2026')).status).toBe(404);
    });

    it(`${rotulo}: o portão do Drive não entrega o link`, async () => {
      const res = await pede(eventos, 'https://fotos.lucafchala.com/api/drive-link', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ slug: 'entrenos2026', turnstileToken: 'noscript', consent: true }),
      });
      expect(res.status).toBe(403);
      expect(await res.text()).not.toContain('drive.google.com');
    });
  }

  it('lançado (visível e fora do "Em breve"): abre em todo lugar', async () => {
    const eventos = [{ ...ALBUM, comingSoon: false, visible: true }];
    expect((await pede(eventos, 'https://fotos.lucafchala.com/galeria/entrenos2026')).status).not.toBe(404);
    expect(await (await pede(eventos, 'https://fotos.lucafchala.com/api/recentes')).text()).toContain('entrenos2026');
    expect(await (await pede(eventos, 'https://fotos.lucafchala.com/')).text()).toContain('Turma 2026');
  });
});

describe('o projeto comum segue como sempre', () => {
  it('oculto e fora do "Em breve": não listado, mas a galeria abre por link direto', async () => {
    const eventos = [{ ...COMUM, comingSoon: false, visible: false }];
    expect((await pede(eventos, 'https://fotos.lucafchala.com/galeria/projeto-comum')).status).not.toBe(404);
    expect(await (await pede(eventos, 'https://fotos.lucafchala.com/')).text()).not.toContain('Projeto Comum');
    expect(await (await pede(eventos, 'https://fotos.lucafchala.com/api/recentes')).text()).not.toContain('projeto-comum');
  });

  it('visível e "Em breve": o cartão aparece na home e no /api/recentes (como "em breve"), e a galeria fica fechada', async () => {
    const eventos = [{ ...COMUM, comingSoon: true, visible: true }];
    expect(await (await pede(eventos, 'https://fotos.lucafchala.com/')).text()).toContain('Projeto Comum');
    const recentes = JSON.parse(await (await pede(eventos, 'https://fotos.lucafchala.com/api/recentes')).text());
    expect(recentes.galerias).toHaveLength(1);
    expect(recentes.galerias[0].emBreve).toBe(true);
    expect((await pede(eventos, 'https://fotos.lucafchala.com/galeria/projeto-comum')).status).toBe(404);
  });
});

describe('fora dos buscadores (v3.10.0): o dono tira um álbum do Google sem fechá-lo', () => {
  const aberto = { ...COMUM, comingSoon: false, visible: true };

  it('a regra: com o interruptor, a galeria não é indexável; sem ele, é', async () => {
    const { galeriaIndexavel, normalizeEventFields } = await import('../src/index.js');
    expect(galeriaIndexavel(/** @type {any} */ (aberto))).toBe(true);
    expect(galeriaIndexavel(/** @type {any} */ ({ ...aberto, foraDosBuscadores: true }))).toBe(false);
    // O painel grava booleano; projeto antigo, sem o campo, segue indexável.
    expect(normalizeEventFields({ foraDosBuscadores: true }, { slug: 'x' }, []).foraDosBuscadores).toBe(true);
    expect(normalizeEventFields({ foraDosBuscadores: 'sim' }, { slug: 'x' }, []).foraDosBuscadores).toBe(false);
    expect(normalizeEventFields({}, { slug: 'x' }, []).foraDosBuscadores).toBe(false);
  });

  it('sai dos sitemaps, mas continua na home e abre por link', async () => {
    const mapa = async (/** @type {any[]} */ evs) => (await pede(evs, 'https://fotos.lucafchala.com/sitemap-galerias.xml')).text();
    expect(await mapa([aberto])).toContain('projeto-comum');
    const fora = [{ ...aberto, foraDosBuscadores: true }];
    expect(await mapa(fora)).not.toContain('projeto-comum');
    expect((await pede(fora, 'https://fotos.lucafchala.com/sitemap-galeria-projeto-comum.xml')).status).toBe(404);
    expect(await (await pede(fora, 'https://fotos.lucafchala.com/')).text()).toContain('Projeto Comum');
    expect((await pede(fora, 'https://fotos.lucafchala.com/galeria/projeto-comum')).status).not.toBe(404);
  });
});
