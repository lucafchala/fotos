// Apresentação do álbum (v3.3): com "Texto de abertura", o índice da galeria por
// capítulos vira a página especial do álbum (src/ui/album.js). O que estes
// testes prendem:
//  1. sem texto, o índice é o de sempre;
//  2. os quatro estilos (mosaico é o padrão; valor inválido cai nele);
//  3. as fotos da abertura: as "Fotos de capa" do projeto, senão as capas dos
//     capítulos — nunca oculta, nunca em álbum família/privado;
//  4. a linha do tempo: período de cada capítulo, ordem por data quando todos
//     têm data, e o formato dos cartões que o script das "N novas" e o
//     indexador da busca pelo rosto leem;
//  5. "Quem fotografou", os números e o recado, sem e-mail e escapados;
//  6. o endereço canônico do álbum com domínio próprio;
//  7. o painel grava os campos novos com tipo e teto.
import { describe, it, expect } from 'vitest';
import { galeriaIndiceHTML } from '../src/ui/galeria-indice.js';
import { rotuloDoPeriodo, idDaCapa, ordemDaLinha } from '../src/ui/album.js';
import { normalizeEventFields } from '../src/index.js';
import { capitulosDoIndice } from '../scripts/rosto-indexa.mjs';
import { GALERIA_ABERTURA_MAX, GALERIA_RECADO_MAX, GALERIA_ESTILOS } from '../src/config.js';

const PASTA = 'RAIZ_PASTA_0001';
const EVENTO = {
  slug: 'entrenos2026', title: 'Entre Nós', date: '2026-11-06', accessType: 'public', galeriaCapitulos: true,
  driveUrl: `https://drive.google.com/drive/folders/${PASTA}`,
  galeriaCreditos: 'chala = Luca F. Chala\nmag = Mag <mag@example.com>\n* = Turma 2026',
  galeriaAbertura: 'Oi, turma.',
};
const caps = {
  v: /** @type {1} */ (1), pasta: PASTA, em: '2026-11-06T12:00:00.000Z', truncada: false,
  caps: [1, 2, 3].map(i => ({ id: `CAPITULO000000${i}`, rk: '', bruto: `Cap ${i}`, nome: `Cap ${i}`, slug: `cap-${i}` })),
};
const RESUMO = {
  CAPITULO0000001: { n: 10, capas: ['FOTO_A1_000000', 'FOTO_A2_000000'], p: [202609, 202609], a: { 'Luca F. Chala': 8, Mag: 2 }, cr: [5, 3] },
  CAPITULO0000002: { n: 20, capas: ['FOTO_B1_000000', 'FOTO_B2_000000'], p: [202403, 202606], a: { 'Luca F. Chala': 15, 'Turma 2026': 5 } },
  CAPITULO0000003: { n: 1500, capas: ['FOTO_C1_000000', 'FOTO_C2_000000'], p: [202605, 202606], a: { Mag: 1000, 'Luca F. Chala': 500 } },
};

/** @param {Record<string, any>} [ev] @param {Record<string, any>} [resumo] @param {string[]} [ocultas] @param {any} [rosto] */
const pagina = (ev = {}, resumo = RESUMO, ocultas = [], rosto = null) =>
  galeriaIndiceHTML({ event: /** @type {any} */ ({ ...EVENTO, ...ev }), caps, resumo, ocultas, dono: false, indexavel: true, nonce: 'N', rosto });

/** IDs do Drive nas <img> de um trecho da página. @param {string} h @param {RegExp} trecho */
const idsEm = (h, trecho) => {
  const m = h.match(trecho);
  return m ? [...m[0].matchAll(/ src="https:\/\/lh3\.googleusercontent\.com\/d\/([A-Za-z0-9_-]+)=w/g)].map(x => x[1]) : [];
};
const MOSAICO = /<div class="al-mos"[^>]*>.*?<\/div>/s;

describe('apresentação do álbum', () => {
  it('sem texto de abertura, o índice é o de sempre', () => {
    const h = pagina({ galeriaAbertura: '' });
    expect(h).toContain('class="ix-top"');
    expect(h).not.toContain('class="al ');
  });

  it('o padrão é o mosaico, e valor inválido também cai nele', () => {
    expect(GALERIA_ESTILOS[0]).toBe('mosaico');
    for (const galeriaEstilo of [undefined, 'lixo', '<b>']) {
      const h = pagina({ galeriaEstilo });
      expect(h).toContain('<body class="al al-mosaico">');
      expect(h).toMatch(MOSAICO);
    }
  });

  it('os quatro estilos desenham a primeira tela deles', () => {
    expect(pagina({ galeriaEstilo: 'tela-cheia' })).toMatch(/<header class="al-hero"><div class="al-slides" aria-hidden="true">/);
    expect(pagina({ galeriaEstilo: 'recordacao' })).toMatch(/<div class="al-mesa" aria-hidden="true"><div class="al-pol al-p1">/);
    const linha = pagina({ galeriaEstilo: 'linha' });
    expect(linha).toContain('<header class="al-linha-h">');
    expect(linha).toContain('<ol class="al-big">');
    // No estilo linha do tempo o texto vai no cabeçalho, não repetido abaixo.
    expect(linha.match(/<div class="al-intro">/g)).toHaveLength(1);
  });

  it('texto e recado: parágrafos e quebras viram <p>/<br>, tudo escapado', () => {
    const h = pagina({ galeriaAbertura: 'Primeiro <b>oi</b>\nlinha 2\n\n\nSegundo & fim', galeriaRecado: 'Feito com <3\npor nós' });
    expect(h).toContain('<div class="al-intro"><p>Primeiro &lt;b&gt;oi&lt;/b&gt;<br>linha 2</p><p>Segundo &amp; fim</p></div>');
    expect(h).toContain('<p class="al-recado">Feito com &lt;3<br>por nós</p>');
    expect(h).not.toContain('<b>oi');
  });

  it('título grande, números e créditos sem e-mail', () => {
    const h = pagina();
    expect(h).toContain('<span class="al-kick">Turma 2026 · Colégio Santa Cruz</span><h1 class="al-tit">Entre Nós</h1>');
    expect(pagina({ slug: 'formatura' })).toContain('<span class="al-kick">2026</span><h1 class="al-tit">');
    expect(h).toContain('3 eventos · 1.530 fotos · 3 fotógrafos');
    expect(h).not.toContain('mag@example.com');
  });

  it('fotos da abertura: as de capa do projeto primeiro, completadas pelas capas; sem oculta e sem link de fora', () => {
    const photos = ['https://lh3.googleusercontent.com/d/CAPA_PROJETO_01=w1600', 'https://drive.google.com/file/d/CAPA_PROJETO_02/view', 'https://exemplo.com/x.jpg', 'https://lh3.googleusercontent.com/d/CAPA_OCULTA_003=w800'];
    const h = pagina({ photos }, RESUMO, ['CAPA_OCULTA_003']);
    expect(idsEm(h, MOSAICO)).toEqual(['CAPA_PROJETO_01', 'CAPA_PROJETO_02', 'FOTO_B1_000000', 'FOTO_C1_000000', 'FOTO_A1_000000']);
    expect(h).not.toContain('exemplo.com');
  });

  it('sem fotos de capa, a abertura usa a capa de cada capítulo (na ordem da linha do tempo)', () => {
    const h = pagina({ galeriaEstilo: 'tela-cheia' }, RESUMO, ['FOTO_C1_000000']);
    expect(idsEm(h, /<div class="al-slides"[^>]*>.*?<\/div>/s)).toEqual(['FOTO_B1_000000', 'FOTO_C2_000000', 'FOTO_A1_000000']);
  });

  it('álbum família ou privado: sem foto na abertura e sem o link da pasta', () => {
    for (const accessType of ['family', 'private']) {
      for (const galeriaEstilo of GALERIA_ESTILOS) {
        const h = pagina({ accessType, galeriaEstilo, photos: ['https://lh3.googleusercontent.com/d/CAPA_PROJETO_01=w1600'] });
        expect(h).not.toMatch(/<div class="al-(mos|slides|mesa)"/);
        expect(h).not.toContain('Mandar suas fotos');
      }
    }
  });

  it('botões: "Ver as fotos" leva à linha do tempo e "Mandar suas fotos" abre a pasta', () => {
    const h = pagina();
    expect(h).toContain('<a class="al-btn al-b1" href="#eventos">Ver as fotos</a>');
    expect(h).toContain('id="eventos"');
    expect(h).toContain(`href="https://drive.google.com/drive/folders/${PASTA}" target="_blank" rel="nofollow noopener" data-acao="mandar-fotos">Mandar suas fotos</a>`);
  });

  it('com a pasta "outros" nos créditos, a dica diz onde mandar as fotos', () => {
    expect(pagina()).not.toContain('al-dica">');
    expect(pagina({ galeriaCreditos: 'chala = Luca\noutros = Turma 2026' })).toContain('<p class="al-dica">Para mandar fotos: abra o evento e a pasta <b>outros</b>.</p>');
    expect(pagina({ galeriaCreditos: 'outros = Turma', accessType: 'family' })).not.toContain('al-dica">');
  });

  it('linha do tempo: por data de início, com o período de cada evento', () => {
    const h = pagina();
    expect(capitulosDoIndice(h, 'entrenos2026')).toEqual(['cap-2', 'cap-3', 'cap-1']);
    expect(h).toContain('<span class="al-mes">2024 – 2026</span>');
    expect(h).toContain('<span class="al-mes">mai – jun 2026</span>');
    expect(h).toContain('<span class="al-mes">set 2026</span>');
  });

  it('os cartões têm o que o script das "N novas" e o indexador leem', () => {
    const h = pagina();
    expect(h).toContain('<a class="ix-card al-card" href="/galeria/entrenos2026/cap-1" data-cap="cap-1" data-cr="5,3">');
    expect(h.match(/<span class="ix-sub">/g)).toHaveLength(3);
    expect(h).toContain('<script nonce="N">(function () {\n  var SLUG = "entrenos2026";');
  });

  it('quem fotografou: soma dos capítulos, do maior para o menor; some se falta resumo', () => {
    const h = pagina();
    const quem = /** @type {RegExpMatchArray} */ (h.match(/<div class="al-cred">.*?<\/section>/s))[0];
    expect([...quem.matchAll(/<span>([^<]+)<\/span>/g)].map(x => x[1])).toEqual(['Mag', 'Luca F. Chala', 'Turma 2026']);
    expect(quem).toContain('<b>1.002</b>');
    const parcial = { ...RESUMO };
    delete parcial.CAPITULO0000003;
    const semTodos = pagina({}, parcial);
    expect(semTodos).not.toContain('<div class="al-cred">');
    expect(semTodos).not.toMatch(/\d fotos · /);
  });

  it('endereço canônico: o domínio do álbum; os outros seguem no principal', () => {
    expect(pagina()).toContain('<link rel="canonical" href="https://entrenos2026.com/galeria/entrenos2026">');
    expect(pagina({ slug: 'formatura' })).toContain('<link rel="canonical" href="https://fotos.lucafchala.com/galeria/formatura">');
    expect(pagina({ galeriaAbertura: '' })).toContain('<link rel="canonical" href="https://entrenos2026.com/galeria/entrenos2026">');
  });

  it('a busca pelo rosto aparece na apresentação quando vale', () => {
    const h = pagina({}, RESUMO, [], { token: 'TOK' });
    expect(h).toContain('id="rs-abrir" hidden>Procurar meu rosto</button>');
    expect(h).toContain('<dialog class="rs" id="rs"');
    expect(h).toContain('id="rs-dados"');
    expect(pagina()).not.toContain('rs-abrir');
  });

  it('as fontes da apresentação só nesta página', () => {
    expect(pagina()).toContain("font-family:'Fraunces'");
    expect(pagina({ galeriaAbertura: '' })).not.toContain("font-family:'Fraunces'");
  });
});

describe('peças da apresentação', () => {
  it('rótulo do período', () => {
    expect(rotuloDoPeriodo([202606, 202606])).toBe('jun 2026');
    expect(rotuloDoPeriodo([202605, 202606])).toBe('mai – jun 2026');
    expect(rotuloDoPeriodo([202403, 202606])).toBe('2024 – 2026');
    for (const ruim of [undefined, [0, 0], [202613, 202613], [202606, 202605]]) expect(rotuloDoPeriodo(/** @type {any} */ (ruim))).toBe('');
  });

  it('ID da foto de capa: lh3 e Drive; o resto não', () => {
    expect(idDaCapa('https://lh3.googleusercontent.com/d/ABCDEFGHIJ12=w1600')).toBe('ABCDEFGHIJ12');
    expect(idDaCapa('https://drive.google.com/file/d/ABCDEFGHIJ12/view?usp=sharing')).toBe('ABCDEFGHIJ12');
    expect(idDaCapa('https://drive.google.com/uc?export=view&id=ABCDEFGHIJ12')).toBe('ABCDEFGHIJ12');
    for (const ruim of ['https://exemplo.com/d/ABCDEFGHIJ12', 'javascript:alert(1)', 'https://lh3.googleusercontent.com/d/curto', 42]) expect(idDaCapa(ruim)).toBe('');
  });

  it('ordem da linha do tempo: por data só quando todos têm data', () => {
    const cs = [{ id: 'a' }, { id: 'b' }];
    expect(ordemDaLinha(cs, /** @type {any} */ ({ a: { p: [202606, 202606] }, b: { p: [202601, 202601] } })).map(c => c.id)).toEqual(['b', 'a']);
    expect(ordemDaLinha(cs, /** @type {any} */ ({ a: { p: [202606, 202606] }, b: {} })).map(c => c.id)).toEqual(['a', 'b']);
  });
});

describe('campos da apresentação no painel', () => {
  const base = { slug: 'x' };
  it('texto de abertura: aparado, com quebras normalizadas e teto', () => {
    expect(normalizeEventFields({ galeriaAbertura: '  Oi\r\n\r\nTchau  ' }, base, []).galeriaAbertura).toBe('Oi\n\nTchau');
    expect(normalizeEventFields({ galeriaAbertura: 'x'.repeat(GALERIA_ABERTURA_MAX + 50) }, base, []).galeriaAbertura).toHaveLength(GALERIA_ABERTURA_MAX);
    expect(normalizeEventFields({}, base, []).galeriaAbertura).toBe('');
  });

  it('estilo: só um dos quatro; recado: aparado e com teto', () => {
    expect(normalizeEventFields({ galeriaEstilo: 'linha' }, base, []).galeriaEstilo).toBe('linha');
    expect(normalizeEventFields({ galeriaEstilo: '<script>' }, base, []).galeriaEstilo).toBe('mosaico');
    expect(normalizeEventFields({ galeriaRecado: ' Oi\r\nTchau ' }, base, []).galeriaRecado).toBe('Oi\nTchau');
    expect(normalizeEventFields({ galeriaRecado: 'x'.repeat(GALERIA_RECADO_MAX + 9) }, base, []).galeriaRecado).toHaveLength(GALERIA_RECADO_MAX);
  });
});
