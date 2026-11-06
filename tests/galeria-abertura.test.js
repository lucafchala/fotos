// Abertura do índice da galeria por capítulos (campo `galeriaAbertura`). O que
// estes testes prendem:
//  1. sem texto, o índice é o de sempre (cabeçalho simples, nada de abertura);
//  2. com texto: parágrafos e quebras viram <p>/<br>, sempre escapados;
//  3. mosaico com até 5 capas, de capítulos diferentes antes de repetir, sem as
//     ocultas; álbum família/privado fica sem mosaico e sem link da pasta;
//  4. a contagem de fotos só aparece quando todos os capítulos têm resumo;
//  5. o painel grava o campo aparado e com teto.
import { describe, it, expect } from 'vitest';
import { galeriaIndiceHTML } from '../src/ui/galeria-indice.js';
import { normalizeEventFields } from '../src/index.js';
import { GALERIA_ABERTURA_MAX } from '../src/config.js';

const PASTA = 'RAIZ_PASTA_0001';
const EVENTO = {
  slug: 'entrenos2026', title: 'Entre Nós', accessType: 'public', galeriaCapitulos: true,
  driveUrl: `https://drive.google.com/drive/folders/${PASTA}`,
  galeriaCreditos: 'chala = Luca F. Chala\nmag = Mag <mag@example.com>\n* = Turma 2026',
};
const caps = {
  v: /** @type {1} */ (1), pasta: PASTA, em: '2026-11-06T12:00:00.000Z', truncada: false,
  caps: [1, 2, 3].map(i => ({ id: `CAPITULO000000${i}`, rk: '', bruto: `Cap ${i}`, nome: `Cap ${i}`, slug: `cap-${i}` })),
};
const RESUMO = {
  CAPITULO0000001: { n: 10, capas: ['FOTO_A1_000000', 'FOTO_A2_000000', 'FOTO_A3_000000'] },
  CAPITULO0000002: { n: 20, capas: ['FOTO_B1_000000', 'FOTO_B2_000000'] },
  CAPITULO0000003: { n: 1500, capas: ['FOTO_C1_000000', 'FOTO_C2_000000'] },
};

/** @param {Record<string, any>} ev @param {Record<string, any>} [resumo] @param {string[]} [ocultas] */
const pagina = (ev, resumo = RESUMO, ocultas = []) =>
  galeriaIndiceHTML({ event: /** @type {any} */ ({ ...EVENTO, ...ev }), caps, resumo, ocultas, dono: false, indexavel: true, nonce: 'N' });

/** As capas do mosaico, na ordem. @param {string} h */
const capasDoMosaico = h => {
  const m = h.match(/<div class="ab-mosaico"[^>]*>(.*?)<\/div>/s);
  return m ? [...m[1].matchAll(/\/d\/([A-Za-z0-9_-]+)=/g)].map(x => x[1]) : [];
};

describe('abertura do índice da galeria', () => {
  it('sem texto, o índice é o de sempre', () => {
    const h = pagina({ galeriaAbertura: '' });
    expect(h).not.toContain('class="ab"');
    expect(h).toContain('class="ix-top"');
    expect(h).not.toContain('id="eventos"');
  });

  it('com texto: parágrafos, quebras de linha e tudo escapado', () => {
    const h = pagina({ galeriaAbertura: 'Primeiro <b>parágrafo</b>\nlinha dois\n\n\nSegundo & último' });
    expect(h).toContain('<header class="ab">');
    expect(h).not.toContain('class="ix-top"');
    expect(h).toContain('<div class="ab-intro"><p>Primeiro &lt;b&gt;parágrafo&lt;/b&gt;<br>linha dois</p><p>Segundo &amp; último</p></div>');
    expect(h).not.toContain('<b>parágrafo');
  });

  it('título grande, números e créditos sem e-mail', () => {
    const h = pagina({ galeriaAbertura: 'Oi' });
    expect(h).toContain('<h1>Entre Nós</h1>');
    expect(h).toContain('3 eventos · 1.530 fotos · fotos de Luca F. Chala, Mag e Turma 2026');
    expect(h).not.toContain('mag@example.com');
  });

  it('a contagem de fotos some quando falta o resumo de algum capítulo', () => {
    const parcial = { ...RESUMO };
    delete parcial.CAPITULO0000003;
    const h = pagina({ galeriaAbertura: 'Oi' }, parcial);
    expect(h).toContain('3 eventos · fotos de');
    expect(h).not.toMatch(/\d fotos · fotos de/);
  });

  it('mosaico: até 5 capas, um capítulo de cada antes de repetir, sem as ocultas', () => {
    const h = pagina({ galeriaAbertura: 'Oi' }, RESUMO, ['FOTO_B1_000000']);
    expect(capasDoMosaico(h)).toEqual(['FOTO_A1_000000', 'FOTO_B2_000000', 'FOTO_C1_000000', 'FOTO_A2_000000', 'FOTO_C2_000000']);
    expect(h.match(/<div class="ab-mosaico" aria-hidden="true">/g)?.length).toBe(1);
  });

  it('menos de 3 capas: sem mosaico, o texto continua', () => {
    const h = pagina({ galeriaAbertura: 'Oi' }, { CAPITULO0000001: { n: 1, capas: ['FOTO_A1_000000'] } });
    expect(capasDoMosaico(h)).toEqual([]);
    expect(h).toContain('<p>Oi</p>');
  });

  it('botões: "Ver os eventos" leva à grade e "Mandar suas fotos" abre a pasta do Drive', () => {
    const h = pagina({ galeriaAbertura: 'Oi' });
    expect(h).toContain('href="#eventos">Ver os eventos</a>');
    expect(h).toContain('id="eventos"');
    expect(h).toContain(`href="https://drive.google.com/drive/folders/${PASTA}" target="_blank" rel="nofollow noopener" data-acao="mandar-fotos">Mandar suas fotos</a>`);
  });

  it('álbum família ou privado: sem mosaico e sem o link da pasta', () => {
    for (const accessType of ['family', 'private']) {
      const h = pagina({ galeriaAbertura: 'Oi', accessType });
      expect(capasDoMosaico(h)).toEqual([]);
      expect(h).not.toContain('Mandar suas fotos');
      expect(h).toContain('<p>Oi</p>');
    }
  });

  it('link de pasta inválido não vira botão', () => {
    const h = pagina({ galeriaAbertura: 'Oi', driveUrl: 'https://evil.example/drive/folders/x' });
    expect(h).not.toContain('Mandar suas fotos');
  });

  it('a capa do cartão do capítulo não estica (altura automática)', () => {
    expect(pagina({})).toContain('.ix-card img,.ix-vazio{display:block;width:100%;height:auto;aspect-ratio:3/2;');
  });
});

describe('campo galeriaAbertura no painel', () => {
  it('grava aparado, com quebras normalizadas e teto', () => {
    const base = { slug: 'x' };
    expect(normalizeEventFields({ galeriaAbertura: '  Oi\r\n\r\nTchau  ' }, base, []).galeriaAbertura).toBe('Oi\n\nTchau');
    expect(normalizeEventFields({ galeriaAbertura: 'x'.repeat(GALERIA_ABERTURA_MAX + 50) }, base, []).galeriaAbertura).toHaveLength(GALERIA_ABERTURA_MAX);
    expect(normalizeEventFields({}, base, []).galeriaAbertura).toBe('');
  });
});
