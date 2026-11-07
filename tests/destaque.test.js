// Pré-lançamento e destaque máximo (v3.3). O que estes testes prendem:
//  1. o destaque (faixa, cartão, popup, /api/destaque) só existe com o álbum
//     LANÇADO, marcado e público — antes, o público não vê nada;
//  2. o script dos outros sites é JS válido, não roda no próprio site e não
//     usa innerHTML com dado vindo da API;
//  3. antes do lançamento, o domínio mostra "em breve", a galeria é 404 para o
//     público e o indexador (com o token certo) lê a página;
//  4. o favicon e o cartão de link do entrenos2026.com;
//  5. o painel tem o interruptor e grava o campo (faltou até a 3.4.0).
import { describe, it, expect, vi } from 'vitest';
import { albumEmDestaque, faixaDestaqueHTML, cartaoDestaqueHTML, popupDestaqueHTML, destaqueParaApi, DESTAQUE_EMBED_JS } from '../src/ui/destaque.js';
import { albumLancado } from '../src/utils.js';
import { OG_ENTRENOS } from '../src/content/og-entrenos.js';
import { dashboardHTML } from '../src/ui/dashboard.js';
import { normalizeEventFields } from '../src/index.js';
import { withDurableObjects } from './helpers/do.js';

const ALBUM = {
  id: '1', slug: 'entrenos2026', title: 'Entre Nós', accessType: 'public', destaqueMaximo: true,
  thumbnailUrl: 'https://lh3.googleusercontent.com/d/CAPA_ALBUM_0001=w1600', galeriaAbertura: 'Este é o nosso álbum.\n\nOutro parágrafo.',
};
const ctx = { waitUntil() {} };
function kv(eventos) {
  const store = new Map([['events', JSON.stringify(eventos)]]);
  return { async get(/** @type {string} */ k) { return store.has(k) ? store.get(k) : null; }, async put(/** @type {string} */ k, /** @type {string} */ v) { store.set(k, v); },
    async delete() {}, async list() { return { keys: [], list_complete: true, cursor: null }; } };
}
/** Worker num isolate frio (getEvents tem cache de módulo). */
async function frio() {
  vi.resetModules();
  return (await import('../src/index.js')).default;
}

describe('quem é destacado', () => {
  it('só álbum lançado, marcado e público', () => {
    expect(albumEmDestaque([ALBUM])?.slug).toBe('entrenos2026');
    for (const muda of [{ comingSoon: true }, { visible: false }, { destaqueMaximo: false }, { accessType: 'family' }, { accessType: 'private' }]) {
      expect(albumEmDestaque([{ ...ALBUM, ...muda }])).toBeNull();
    }
    expect(albumLancado({ ...ALBUM, comingSoon: true })).toBe(false);
  });

  it('com mais de um marcado, vale o fixado', () => {
    const outro = { ...ALBUM, id: '2', slug: 'formatura', title: 'Formatura' };
    expect(albumEmDestaque([outro, { ...ALBUM, pinned: true }])?.slug).toBe('entrenos2026');
    expect(albumEmDestaque([outro, ALBUM])?.slug).toBe('formatura');
  });

  it('sem destaque, nenhuma peça é desenhada', () => {
    expect(faixaDestaqueHTML(null) + cartaoDestaqueHTML(null) + popupDestaqueHTML(null, 'N')).toBe('');
    expect(destaqueParaApi(null)).toEqual({ ativo: false });
  });

  it('a faixa e o cartão levam ao domínio do álbum, com o texto escapado', () => {
    const e = { ...ALBUM, title: 'Entre <b>Nós</b>' };
    expect(faixaDestaqueHTML(e)).toContain('href="https://entrenos2026.com/"');
    expect(faixaDestaqueHTML(e)).toContain('Entre &lt;b&gt;Nós&lt;/b&gt;');
    expect(cartaoDestaqueHTML(e)).toContain('<span class="dq-dom">entrenos2026.com</span>');
    expect(cartaoDestaqueHTML(e)).toContain('<p>Este é o nosso álbum.</p>');
    expect(cartaoDestaqueHTML({ ...ALBUM, slug: 'formatura' })).toContain('href="/galeria/formatura"');
  });

  it('a API dos outros sites só leva o que a faixa desenha', () => {
    expect(destaqueParaApi(ALBUM)).toEqual({ ativo: true, slug: 'entrenos2026', titulo: 'Entre Nós', linha: 'Turma 2026 · Colégio Santa Cruz', url: 'https://entrenos2026.com/' });
  });
});

describe('script dos outros sites', () => {
  it('é JS válido, não roda no próprio site e não usa innerHTML', () => {
    expect(() => new Function(DESTAQUE_EMBED_JS)).not.toThrow();
    expect(DESTAQUE_EMBED_JS).toContain("h === 'fotos.lucafchala.com'");
    expect(DESTAQUE_EMBED_JS).toContain('["entrenos2026.com"]');
    expect(DESTAQUE_EMBED_JS).not.toMatch(/innerHTML|insertAdjacentHTML|document\.write/);
    expect(DESTAQUE_EMBED_JS).toContain("credentials: 'omit'");
  });
});

describe('rotas', () => {
  it('home: destaque só depois do lançamento', async () => {
    for (const [ev, tem] of [[{ ...ALBUM, comingSoon: true, visible: false }, false], [ALBUM, true]]) {
      const w = await frio();
      const h = await (await w.fetch(new Request('https://fotos.lucafchala.com/'), withDurableObjects({ FOTOS: kv([ev]) }), ctx)).text();
      expect(h.includes('class="dq-faixa"'), JSON.stringify(ev)).toBe(tem);
      expect(h.includes('class="dq-cartao"')).toBe(tem);
      expect(h.includes('id="dq-pop"')).toBe(tem);
    }
  });

  it('/api/destaque e /destaque.js: CORS aberto; antes do lançamento, inativo', async () => {
    let w = await frio();
    const antes = await w.fetch(new Request('https://fotos.lucafchala.com/api/destaque'), withDurableObjects({ FOTOS: kv([{ ...ALBUM, comingSoon: true }]) }), ctx);
    expect(await antes.json()).toEqual({ ativo: false });
    expect(antes.headers.get('Access-Control-Allow-Origin')).toBe('*');
    w = await frio();
    const js = await w.fetch(new Request('https://fotos.lucafchala.com/destaque.js'), withDurableObjects({ FOTOS: kv([ALBUM]) }), ctx);
    expect(js.headers.get('Content-Type')).toContain('text/javascript');
    expect(js.headers.get('Cross-Origin-Resource-Policy')).toBe('cross-origin');
    expect(await js.text()).toBe(DESTAQUE_EMBED_JS);
  });

  it('antes do lançamento: domínio em "em breve", galeria 404 para o público, indexador com token lê', async () => {
    const ev = { ...ALBUM, comingSoon: true, galeriaCapitulos: true, driveUrl: 'https://drive.google.com/drive/folders/RAIZ_PASTA_0001' };
    const TOKEN = 't'.repeat(40);
    let w = await frio();
    const raiz = await w.fetch(new Request('https://entrenos2026.com/'), withDurableObjects({ FOTOS: kv([ev]) }), ctx);
    expect(await raiz.text()).toContain('O álbum da turma está chegando');
    w = await frio();
    const publico = await w.fetch(new Request('https://fotos.lucafchala.com/galeria/entrenos2026'), withDurableObjects({ FOTOS: kv([ev]), ROSTO_INDEXADOR_TOKEN: TOKEN }), ctx);
    expect(publico.status).toBe(404);
    w = await frio();
    const errado = await w.fetch(new Request('https://fotos.lucafchala.com/galeria/entrenos2026', { headers: { 'X-Rosto-Indexador': 'x'.repeat(40) } }), withDurableObjects({ FOTOS: kv([ev]), ROSTO_INDEXADOR_TOKEN: TOKEN }), ctx);
    expect(errado.status).toBe(404);
    // Com o token certo passa do portão (a página tenta ler o Drive; sem chave
    // da API, cai no aviso de configuração — o que importa é não ser 404).
    w = await frio();
    const certo = await w.fetch(new Request('https://fotos.lucafchala.com/galeria/entrenos2026', { headers: { 'X-Rosto-Indexador': TOKEN } }), withDurableObjects({ FOTOS: kv([ev]), ROSTO_INDEXADOR_TOKEN: TOKEN }), ctx);
    expect(certo.status).not.toBe(404);
    // Token curto demais no Worker não abre nada.
    w = await frio();
    const curto = await w.fetch(new Request('https://fotos.lucafchala.com/galeria/entrenos2026', { headers: { 'X-Rosto-Indexador': 'abc' } }), withDurableObjects({ FOTOS: kv([ev]), ROSTO_INDEXADOR_TOKEN: 'abc' }), ctx);
    expect(curto.status).toBe(404);
  });

  it('favicon e cartão de link do entrenos2026.com', async () => {
    const w = await frio();
    const env = withDurableObjects({ FOTOS: kv([]) });
    const ico = await w.fetch(new Request('https://entrenos2026.com/icon-entrenos.svg'), env, ctx);
    expect(ico.headers.get('Content-Type')).toBe('image/svg+xml');
    expect(await ico.text()).toContain('>EN</text>');
    const og = await w.fetch(new Request('https://entrenos2026.com/og-entrenos.jpg'), env, ctx);
    const bytes = new Uint8Array(await og.arrayBuffer());
    expect(og.headers.get('Content-Type')).toBe('image/jpeg');
    expect(bytes.length).toBe(OG_ENTRENOS.bytes);
    expect([bytes[0], bytes[1]]).toEqual([0xff, 0xd8]);
    expect(bytes.length).toBeLessThan(300_000); // o WhatsApp ignora cartão pesado
  });
});

describe('painel: o interruptor "Destaque máximo no site"', () => {
  it('existe, é lido do projeto, vai no rascunho e é gravado', () => {
    const h = dashboardHTML([], [], 'N');
    expect(h).toContain('<input type="checkbox" id="f-destaque-maximo" aria-describedby="dica-destaque-maximo">');
    expect(h).toContain("document.getElementById('f-destaque-maximo').checked = !!(e && e.destaqueMaximo);");
    expect(h).toContain("destaqueMaximo: chk('f-destaque-maximo')");
    expect(h).toContain("setChk('f-destaque-maximo', f.destaqueMaximo)");
    expect(h).toContain("destaqueMaximo: document.getElementById('f-destaque-maximo').checked,");
    expect(normalizeEventFields({ destaqueMaximo: true }, { slug: 'x' }, []).destaqueMaximo).toBe(true);
    expect(normalizeEventFields({ destaqueMaximo: 'sim' }, { slug: 'x' }, []).destaqueMaximo).toBe(false);
  });
});
