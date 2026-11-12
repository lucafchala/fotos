// Páginas da galeria por capítulos (v3.1) com dado hostil vindo da pasta do
// Drive: nome de capítulo, nome de pasta de autor e título viram TEXTO, nunca
// marcação. O nome do capítulo e o do autor vêm de nomes de pastas que
// qualquer pessoa com acesso de Editor pode criar (a pasta é colaborativa).
import { describe, it, expect } from 'vitest';
import { galeriaIndiceHTML } from '../src/ui/galeria-indice.js';
import { galeriaHTML } from '../src/ui/galeria.js';
import { PALETA_ALBUM } from '../src/config.js';

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

describe('evento do álbum com domínio próprio (v3.7.6)', () => {
  const foto = (/** @type {string} */ id, /** @type {number} */ hora) => /** @type {import('../src/drive.js').FotoDrive} */ ([id, 6000, 4000, `${id}.jpg`, 1000, 0, hora]);
  const lista = {
    v: /** @type {3} */ (3), pasta: 'CAP_PASTA_0001', em: '2026-11-07T12:00:00.000Z', truncada: false, total: 3, videos: 0, outros: 0, rk: {}, aut: ['Luca F. Chala'],
    secoes: [{ nome: '2024', caminho: '2024', fotos: [foto('FOTO00000000001', 20240612150000)] }, { nome: '2026', caminho: '2026', fotos: [foto('FOTO00000000002', 20260610120000), foto('FOTO00000000003', 20260615120000)] }],
  };
  const pagina = (/** @type {string} */ slug, capitulo = /** @type {any} */ ({ slug: 'piauifut', nome: 'PiauiFut', anterior: null, proximo: null })) => galeriaHTML({
    event: /** @type {any} */ ({ ...EVENTO, slug, date: '2026-11-06', driveUrl: 'https://drive.google.com/drive/folders/PROJETO_RAIZ_0001' }),
    listagem: lista, listagemBruta: lista, capitulo, capituloNome: 'PiauiFut', erro: null, nonce: 'NONCE', dono: false, formToken: '',
  });

  it('a paleta escura do álbum, em qualquer tema do aparelho; outros projetos seguem iguais', () => {
    const h = pagina('entrenos2026');
    expect(h).toContain(':root:root{');
    expect(h).toContain('--accent:#f9de4b');
    expect(h).toContain(`<meta name="theme-color" content="${PALETA_ALBUM.bg}">`);
    expect(pagina('formatura')).not.toContain(':root:root{');
  });

  it('o "reportar problema" sai do topo e vira "Algo deu errado?" no rodapé; outros projetos seguem com o ícone', () => {
    const h = pagina('entrenos2026');
    expect(h).not.toContain('class="g-btn g-bug"');
    expect(h).toContain('<a href="https://fotos.lucafchala.com/suporte">Algo deu errado? Fale com a gente</a></footer>');
    // O botão de ajuda do rodapé (v3.9.1), na página do álbum.
    expect(h).toMatch(/<footer class="g-fim"><div class="aj-rodape"><a class="aj-botao" href="[^"]*\/ajuda">/);
    // No álbum, o fim do evento não manda para a "Página do projeto" (o álbum já é ela).
    expect(h).not.toMatch(/g-cap-fim[^]*Página do projeto/);
    const outro = pagina('formatura');
    expect(outro).toContain('class="g-btn g-bug"');
    expect(outro).not.toContain('class="g-fim"');
  });

  it('a data do evento é o período das fotos, não a data do projeto', () => {
    const h = pagina('entrenos2026');
    expect(h).toMatch(/2024 – 2026 · 3 fotos/);
    expect(h).not.toContain('6 de novembro de 2026 · 3 fotos');
    // Página sem capítulo (projeto comum): a data do projeto, como sempre.
    expect(pagina('formatura', null)).toContain('6 de novembro de 2026');
  });
});
