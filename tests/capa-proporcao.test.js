// #254: a caixa da capa usa a proporção real (medida no Drive quando o dono
// salva), não um 3:2 fixo que dava faixas escuras em capa em pé no celular.
import { describe, it, expect, vi, afterEach } from 'vitest';
import { medeCapas, normalizaProporcoes } from '../src/drive.js';
import { idDaCapa } from '../src/ui/album.js';
import { eventHTML, proporcaoDaCapa } from '../src/ui/event.js';
import { sanitizeRestoredEvent } from '../src/index.js';
import { EVENTO } from './helpers/paginas.js';

const A = 'AAAAAAAAAAAAAAAA';
const B = 'BBBBBBBBBBBBBBBB';
const C = 'CCCCCCCCCCCCCCCC';
const url = (/** @type {string} */ id) => `https://lh3.googleusercontent.com/d/${id}`;

afterEach(() => vi.unstubAllGlobals());

describe('normalizaProporcoes', () => {
  it('só ID válido e número dentro da faixa', () => {
    expect(normalizaProporcoes({ [A]: 0.6667, curto: 1, [B]: 'x', [C]: 99 })).toEqual({ [A]: 0.667 });
    expect(normalizaProporcoes(null)).toEqual({});
    expect(normalizaProporcoes([1, 2])).toEqual({});
  });

  it('o restore de backup passa pelo mesmo filtro', () => {
    expect(sanitizeRestoredEvent({ capasProporcao: { [A]: 1.5, '"}body{': 1 } }).capasProporcao).toEqual({ [A]: 1.5 });
  });
});

describe('medeCapas', () => {
  it('mede só a capa nova, gira com a rotação e solta a capa que saiu', async () => {
    const fetch = vi.fn(async (/** @type {string} */ u) => {
      expect(u).toContain(`/files/${B}?`);
      expect(u).toContain('imageMediaMetadata');
      return Response.json({ imageMediaMetadata: { width: 6000, height: 4000, rotation: 1 } });
    });
    vi.stubGlobal('fetch', fetch);
    const mapa = await medeCapas({ GOOGLE_DRIVE_API_KEY: 'k' }, [url(A), url(B)], idDaCapa, { [A]: 1.5, [C]: 0.8 });
    expect(mapa).toEqual({ [A]: 1.5, [B]: 0.667 });
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it('erro da API ou sem chave: a capa fica sem medida', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('', { status: 403 })));
    expect(await medeCapas({ GOOGLE_DRIVE_API_KEY: 'k' }, [url(A)], idDaCapa)).toEqual({});
    const nada = vi.fn();
    vi.stubGlobal('fetch', nada);
    expect(await medeCapas({}, [url(A)], idDaCapa)).toEqual({});
    expect(nada).not.toHaveBeenCalled();
  });
});

describe('página do projeto', () => {
  it('foto única: a proporção dela; carrossel: a mediana; falta medida: 3:2', () => {
    expect(proporcaoDaCapa({ capasProporcao: { [A]: 0.667 } }, [url(A)])).toBe(0.667);
    expect(proporcaoDaCapa({ capasProporcao: { [A]: 0.667, [B]: 1.5, [C]: 1.333 } }, [url(A), url(B), url(C)])).toBe(1.333);
    expect(proporcaoDaCapa({ capasProporcao: { [A]: 0.667 } }, [url(A), url(B)])).toBeNull();
    expect(proporcaoDaCapa({}, [url(A)])).toBeNull();
  });

  it('a caixa sai com a proporção medida', () => {
    const ev = { ...EVENTO, photos: [url(A)], thumbnailUrl: url(A), capasProporcao: { [A]: 0.667 } };
    const html = eventHTML(ev, 2026, '', 'N');
    expect(html).toContain('.hero-foto,.carousel,.hero-blur-img{aspect-ratio:0.667}');
    const sem = eventHTML({ ...ev, capasProporcao: undefined }, 2026, '', 'N');
    expect(sem).not.toContain('{aspect-ratio:0.');
  });
});
