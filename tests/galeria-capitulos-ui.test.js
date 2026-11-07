// Páginas da galeria por capítulos (v3.1) com dado hostil vindo da pasta do
// Drive: nome de capítulo, nome de pasta de autor e título viram TEXTO, nunca
// marcação. O nome do capítulo e o do autor vêm de nomes de pastas que
// qualquer pessoa com acesso de Editor pode criar (a pasta é colaborativa).
import { describe, it, expect } from 'vitest';
import { galeriaIndiceHTML } from '../src/ui/galeria-indice.js';
import { galeriaHTML } from '../src/ui/galeria.js';

const HOSTIL = '<img src=x onerror=alert(1)>"\'&';
const EVENTO = { slug: 'formatura', title: 'Formatura 2026', driveUrl: 'https://drive.google.com/drive/folders/RAIZ_PASTA_0001', galeriaCapitulos: true };

describe('índice de capítulos: nomes de pasta viram texto', () => {
  const caps = {
    v: /** @type {1} */ (1), pasta: 'RAIZ_PASTA_0001', em: '2026-10-10T12:00:00.000Z', truncada: false,
    caps: [{ id: 'CAPITULO0000001', rk: '', bruto: HOSTIL, nome: HOSTIL, slug: 'abertura' }],
  };
  const html = (dono = false) => galeriaIndiceHTML({ event: /** @type {any} */ (EVENTO), caps, resumo: {}, ocultas: [], dono, indexavel: false });

  it('o nome do capítulo sai escapado', () => {
    const h = html();
    expect(h).not.toContain('<img src=x onerror');
    expect(h).toContain('&lt;img src=x onerror=alert(1)&gt;');
  });

  it('o cartão aponta para o slug validado, não para o nome', () => {
    expect(html()).toContain('href="/galeria/formatura/abertura"');
  });

  it('o dono também recebe o nome escapado', () => {
    expect(html(true)).not.toContain('<img src=x onerror');
  });
});

describe('página do capítulo: nomes de capítulo e de autor viram texto', () => {
  const foto = (/** @type {string} */ id, /** @type {number} */ autor) => /** @type {import('../src/drive.js').FotoDrive} */ ([id, 6000, 4000, `${id}.jpg`, 1000, autor, 20261105143000]);
  const listagem = {
    v: /** @type {2} */ (2), pasta: 'RAIZ_PASTA_0001', em: '2026-10-10T12:00:00.000Z', truncada: false, total: 2, videos: 0, outros: 0, rk: {},
    aut: ['Luca F. Chala', HOSTIL],
    secoes: [{ nome: '', caminho: '', fotos: [foto('FOTO000000000A', 0), foto('FOTO000000000B', 1)] }],
  };
  const capitulo = { slug: 'cerimonia', nome: HOSTIL, anterior: { slug: 'abertura', nome: HOSTIL }, proximo: { slug: 'festa', nome: HOSTIL } };
  const h = galeriaHTML({ event: /** @type {any} */ ({ ...EVENTO, nomesAmigaveis: true }), listagem, listagemBruta: listagem, capituloNome: HOSTIL, capitulo, erro: null, nonce: 'NONCE', dono: false, formToken: '' });

  it('nenhum nome hostil vira marcação em lugar nenhum da página', () => {
    expect(h).not.toContain('<img src=x onerror');
  });

  it('a linha de créditos, o título e a navegação saem escapados', () => {
    expect(h).toContain('Fotos: Luca F. Chala e &lt;img src=x onerror=alert(1)&gt;');
    expect(h).toContain('<span class="g-cap-t">&lt;img src=x onerror=alert(1)&gt;');
  });

  it('os links de navegação usam os slugs, não os nomes', () => {
    expect(h).toContain('href="/galeria/formatura/abertura"');
    expect(h).toContain('href="/galeria/formatura/festa"');
  });

  it('o nome do autor nos dados da página não fecha o <script>', () => {
    // O dado vai em JSON dentro de um <script>: um "</script>" no nome de uma
    // pasta tem de sair neutralizado.
    const l2 = { ...listagem, aut: ['Luca F. Chala', '</script><script>alert(1)</script>'] };
    const p = galeriaHTML({ event: /** @type {any} */ (EVENTO), listagem: l2, listagemBruta: l2, capitulo, erro: null, nonce: 'NONCE', dono: false, formToken: '' });
    expect(p).not.toContain('</script><script>alert(1)');
    expect(p.match(/<\/script>/gi)?.length).toBe(p.match(/<script\b/gi)?.length);
  });

  it('o e-mail dos créditos não existe na página (só o nome da pasta)', () => {
    const ev = { ...EVENTO, galeriaCreditos: [{ pasta: 'Ana Souza', nome: 'Ana Souza', email: 'ana@example.com' }] };
    const p = galeriaHTML({ event: /** @type {any} */ (ev), listagem, listagemBruta: listagem, capitulo, erro: null, nonce: 'NONCE', dono: true, formToken: '' });
    expect(p).not.toContain('ana@example.com');
  });
});

describe('sem link para a pasta no Drive (v3.7.2; era o item 1g.4b)', () => {
  const foto = (/** @type {string} */ id) => /** @type {import('../src/drive.js').FotoDrive} */ ([id, 6000, 4000, `${id}.jpg`, 1000, 0, 20261105143000]);
  const lista = (/** @type {number} */ n) => ({
    v: /** @type {2} */ (2), pasta: 'RAIZ_PASTA_0001', em: '2026-10-10T12:00:00.000Z', truncada: false, total: n, videos: 0, outros: 0, rk: {},
    aut: ['Luca F. Chala'],
    secoes: [{ nome: '', caminho: '', fotos: Array.from({ length: n }, (_, i) => foto(`FOTO00000000${i}A`)) }],
  });
  const pagina = (n = 2, capitulo = null) => {
    const l = lista(n);
    return galeriaHTML({ event: /** @type {any} */ ({ ...EVENTO, driveUrl: 'https://drive.google.com/drive/folders/PROJETO_RAIZ_0001' }), listagem: l, listagemBruta: l, capitulo, erro: null, nonce: 'NONCE', dono: false, formToken: '' });
  };

  // v3.7.2: com atalhos e subpastas o Drive não junta tudo, e quem não é dono
  // da pasta de destino não entra. O visitante não recebe link para pasta.
  it('o visitante não recebe link para a pasta no Drive (nem o botão, nem na folha "Baixar tudo")', () => {
    const h = pagina();
    expect(h).not.toContain('data-acao="pasta-drive"');
    expect(h).not.toContain('Baixar o evento inteiro (Google Drive)');
    expect(h).not.toContain('"drive":');
    expect(h).not.toContain('id="g-folha-drive"');
    expect(h).toContain('data-acao="baixar-tudo"');
    expect(pagina(0)).not.toContain('data-acao="baixar-tudo"');
  });
});
