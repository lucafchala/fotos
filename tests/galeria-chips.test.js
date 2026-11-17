// A faixa de chips já vem do servidor (4.1.2). Antes ela saía vazia e
// escondida e o script a abria depois da primeira pintura: a grade descia
// 55 px com a pessoa olhando. O que estes testes prendem é o que o SERVIDOR
// decide; que o script chega ao mesmo resultado, quem confere é o navegador
// (scripts/verifica-galeria.mjs, "Chips do servidor").

import { describe, it, expect } from 'vitest';
import { galeriaHTML, chipsProntosHTML, GRADE_RESERVA_MIN, GALERIA_JS } from '../src/ui/galeria.js';

/** @param {string} id @param {number} [autor] */
const foto = (id, autor = 0) => /** @type {any} */ ([id.padEnd(15, '0'), 6000, 4000, `${id}.jpg`, 1000, autor]);
/** @param {[string, string, any[]][]} secoes @param {string[]} [aut] */
const lista = (secoes, aut = ['Fotógrafo Um']) => /** @type {any} */ ({
  secoes: secoes.map(([nome, caminho, fotos]) => ({ nome, caminho, fotos })),
  aut,
  total: secoes.reduce((n, s) => n + s[2].length, 0),
  em: Date.UTC(2026, 10, 1),
  truncada: false,
});
/** @param {string} html */
const chips = html => [...html.matchAll(/<button type="button" class="g-chip"([^>]*)>([^<]*)<small>(\d+)<\/small><\/button>/g)].map(m => ({ attrs: m[1], nome: m[2], n: Number(m[3]) }));

describe('chipsProntosHTML', () => {
  it('uma seção e um fotógrafo: a faixa sai escondida e vazia', () => {
    const html = chipsProntosHTML(lista([['', '', [foto('A'), foto('B')]]]), ['Fotógrafo Um']);
    expect(html).toBe('<nav class="g-chips" id="g-chips" aria-label="Seções, fotógrafos e favoritas" hidden></nav>');
  });

  it('várias seções: um chip por seção, com a contagem, e a primeira marcada como atual', () => {
    const html = chipsProntosHTML(lista([['Cerimônia', 'Cerimônia', [foto('A'), foto('B')]], ['Festa', 'Festa', [foto('C')]]]), ['Fotógrafo Um']);
    expect(html).not.toMatch(/<nav[^>]* hidden/);
    expect(chips(html)).toEqual([
      { attrs: ' data-acao="ir-sec" data-sec="0" aria-current="true"', nome: 'Cerimônia', n: 2 },
      { attrs: ' data-acao="ir-sec" data-sec="1"', nome: 'Festa', n: 1 },
    ]);
    expect(html).not.toContain('g-chips-grupo');
  });

  it('seção sem nome vira "Fotos" (igual ao script)', () => {
    const html = chipsProntosHTML(lista([['', '', [foto('A')]], ['Extras', 'Extras', [foto('B')]]]), ['Fotógrafo Um']);
    expect(chips(html).map(c => c.nome)).toEqual(['Fotos', 'Extras']);
  });

  it('seções que são anos: um filtro por ano, que junta as seções do mesmo ano', () => {
    const html = chipsProntosHTML(lista([
      ['Dia 1', '2025 / Dia 1', [foto('A'), foto('B')]],
      ['Dia 2', '2025 / Dia 2', [foto('C')]],
      ['2026', '2026', [foto('D')]],
    ]), ['Fotógrafo Um']);
    expect(html).toContain('<span class="g-chips-grupo g-chips-anos" role="group" aria-label="Ano">');
    expect(chips(html)).toEqual([
      { attrs: ' data-acao="filtro-sec" data-sec="-1" aria-pressed="true"', nome: 'Todos os anos', n: 4 },
      { attrs: ' data-acao="filtro-sec" data-sec="0" aria-pressed="false"', nome: '2025', n: 3 },
      { attrs: ' data-acao="filtro-sec" data-sec="1" aria-pressed="false"', nome: '2026', n: 1 },
    ]);
    expect(html).not.toContain('data-acao="ir-sec"');
  });

  it('um ano só não é filtro: as seções viram chips comuns', () => {
    const html = chipsProntosHTML(lista([['Dia 1', '2025 / Dia 1', [foto('A')]], ['Dia 2', '2025 / Dia 2', [foto('B')]]]), ['Fotógrafo Um']);
    expect(html).not.toContain('g-chips-anos');
    expect(chips(html).map(c => c.attrs.includes('ir-sec'))).toEqual([true, true]);
  });

  it('dois fotógrafos com foto na página: "Todos" e um chip por fotógrafo, na ordem dos créditos', () => {
    const html = chipsProntosHTML(lista([['', '', [foto('A', 2), foto('B', 0), foto('C', 2)]]], ['Fotógrafo Um', 'Sem Foto Aqui', 'Fotógrafa Dois']), ['Fotógrafo Um', 'Sem Foto Aqui', 'Fotógrafa Dois']);
    expect(html).toContain('<span class="g-chips-grupo" role="group" aria-label="Fotógrafo">');
    expect(chips(html)).toEqual([
      { attrs: ' data-acao="filtro-autor" data-aut="-1" aria-pressed="true"', nome: 'Todos', n: 3 },
      { attrs: ' data-acao="filtro-autor" data-aut="0" aria-pressed="false"', nome: 'Fotógrafo Um', n: 1 },
      { attrs: ' data-acao="filtro-autor" data-aut="2" aria-pressed="false"', nome: 'Fotógrafa Dois', n: 2 },
    ]);
  });

  it('um fotógrafo só com foto (mesmo com três nos créditos): sem filtro por fotógrafo', () => {
    const html = chipsProntosHTML(lista([['', '', [foto('A', 1), foto('B', 1)]]], ['Um', 'Dois', 'Três']), ['Um', 'Dois', 'Três']);
    expect(html).toMatch(/<nav[^>]* hidden><\/nav>$/);
  });

  it('seções primeiro, fotógrafos depois; o nome sai escapado', () => {
    const html = chipsProntosHTML(lista([['A & B', 'A & B', [foto('A', 0)]], ['<i>', '<i>', [foto('B', 1)]]], ['Um', 'Dois']), ['Um', 'Dois']);
    expect(html).toContain('A &amp; B<small>1</small>');
    expect(html).not.toContain('<i>');
    expect(html.indexOf('data-acao="ir-sec"')).toBeLessThan(html.indexOf('aria-label="Fotógrafo"'));
  });
});

describe('galeriaHTML: a faixa de chips', () => {
  const event = { slug: 'festa', title: 'Festa', driveUrl: 'https://drive.google.com/drive/folders/PASTA_DA_FESTA_0000000000001', accessType: 'public' };

  it('a página de um evento com dois fotógrafos já sai com a faixa aberta', () => {
    const html = galeriaHTML({ event, listagem: lista([['', '', [foto('A', 0), foto('B', 1)]]], ['Um', 'Dois']), erro: null, nonce: 'N', dono: false });
    const nav = /** @type {RegExpMatchArray} */ (html.match(/<nav class="g-chips"[^>]*>/))[0];
    expect(nav).not.toContain('hidden');
    expect(chips(html).map(c => c.nome)).toEqual(['Todos', 'Um', 'Dois']);
  });

  it('a galeria simples (uma seção, um fotógrafo) continua com a faixa escondida', () => {
    const html = galeriaHTML({ event, listagem: lista([['', '', [foto('A'), foto('B')]]]), erro: null, nonce: 'N', dono: false });
    expect(html).toContain('<nav class="g-chips" id="g-chips" aria-label="Seções, fotógrafos e favoritas" hidden></nav>');
  });

  it('sem listagem (erro do Drive) não há faixa', () => {
    const html = galeriaHTML({ event, listagem: null, erro: { codigo: 'falha', mensagem: 'x' }, nonce: 'N' });
    expect(html).not.toContain('id="g-chips"');
  });
});

// A outra metade do pulo: sem grade, a navegação do fim e o rodapé apareciam
// na primeira tela e o script os empurrava para baixo. Com fotos bastantes, o
// <main> reserva uma tela até o script montar a grade.
describe('reserva da grade', () => {
  const event = { slug: 'evento', title: 'Evento', visible: true, access: 'public' };
  const muitas = (/** @type {number} */ n) => lista([['', '', Array.from({ length: n }, (_, i) => foto('F' + i))]]);
  const mainDe = (/** @type {string} */ html) => (html.match(/<main id="g-main"[^>]*>/) || [''])[0];

  it(`com ${GRADE_RESERVA_MIN} fotos ou mais, o <main> sai com a reserva`, () => {
    expect(mainDe(galeriaHTML({ event, listagem: muitas(GRADE_RESERVA_MIN), erro: null, nonce: 'N', dono: false }))).toContain('class="g-reserva"');
  });
  it('com menos, sem reserva (a grade pode ser mais baixa que a tela)', () => {
    expect(mainDe(galeriaHTML({ event, listagem: muitas(GRADE_RESERVA_MIN - 1), erro: null, nonce: 'N', dono: false }))).not.toContain('g-reserva');
  });
  it('a reserva tem uma tela de altura, e o script a tira depois de diagramar a grade', () => {
    const html = galeriaHTML({ event, listagem: muitas(GRADE_RESERVA_MIN), erro: null, nonce: 'N', dono: false });
    expect(html).toContain('.g-reserva{min-height:100vh;min-height:100svh}');
    expect(GALERIA_JS.texto).toMatch(/diagramaTudo\(\);\s*if \(main\) main\.classList\.remove\('g-reserva'\);/);
  });
});
