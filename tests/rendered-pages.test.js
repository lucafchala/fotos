// Suíte das PÁGINAS RENDERIZADAS.
//
// As páginas deste projeto são template string: `src/ui/**` monta HTML — e,
// dentro dele, blocos <script> inteiros — por concatenação. Isso cria uma
// classe de defeito que nenhuma das outras suítes alcança e que o linter não
// vê, porque para o ESLint aquilo é uma string:
//
//   - uma crase ou um `${` escritos por engano dentro do literal FECHAM o
//     template mais cedo e quebram o JavaScript emitido;
//   - uma barra escapada a mais ou a menos numa regex emitida muda o padrão;
//   - um `</script>` literal no meio de um dado encerra o bloco no browser.
//
// Em todos esses casos `npm test`, `eslint` e `tsc` passam verdes e a página
// chega quebrada ao visitante. É exatamente a armadilha que o docs/VERIFICACAO
// .md descreve: cobertura de template mede se a função foi CHAMADA, não se a
// página está certa.
//
// O que esta suíte faz é barato e pega justamente isso: renderiza cada página,
// extrai os blocos e PARSEIA o que saiu.

import { describe, it, expect } from 'vitest';
import vm from 'node:vm';
import { dashboardHTML, loginHTML } from '../src/ui/dashboard.js';
import { galleryHTML } from '../src/ui/gallery.js';
import { eventHTML } from '../src/ui/event.js';
import { supportHTML } from '../src/ui/support.js';
import { privacyHTML } from '../src/ui/privacy.js';
import { termsHTML } from '../src/ui/terms.js';
import { aboutHTML } from '../src/ui/about.js';
import { gearHTML } from '../src/ui/gear.js';
import { legalHTML } from '../src/ui/legal.js';
import { docHTML } from '../src/ui/doc.js';
import { LEGAL_DOCS } from '../src/content/legal-docs.js';

const EVENTO = {
  id: 'a1b2c3', slug: 'evento', title: 'Evento', status: 'entregue',
  driveUrl: 'https://drive.google.com/x', driveUrlInstagram: '', projectUrl: '',
  photos: ['https://lh3.googleusercontent.com/d/AAA'],
  thumbnailUrl: 'https://lh3.googleusercontent.com/d/AAA',
  visible: true, comingSoon: false, accessType: 'public', category: 'Casamento',
  date: '2026-01-15', eventCredits: '', longDescription: 'Descrição',
  photosAlert: { active: false, addedAt: null, expiresAfterHours: 24 },
};

/** Todas as páginas que emitem script, com um argumento realista cada. */
function paginas() {
  return {
    dashboard: dashboardHTML([EVENTO], ['Casamento'], 'NONCE'),
    login: loginHTML({ error: false }, 'NONCE'),
    gallery: galleryHTML([EVENTO], null, 'NONCE'),
    event: eventHTML(EVENTO, '2026', null, 'NONCE', 'nonce-drive', 'form-token'),
    support: supportHTML(false, '', {}, 'NONCE', 'form-token'),
    privacy: privacyHTML(),
    terms: termsHTML(),
    about: aboutHTML(),
    gear: gearHTML(),
    legal: legalHTML(),
    // Doze páginas de documento saem desta mesma função; uma basta para
    // cobrir o cabeçalho, que não depende de qual documento é.
    doc: docHTML(LEGAL_DOCS[0]),
  };
}

// ---------------------------------------------------------------------------
// Como se reconhece uma tag <script> — e por que não é óbvio
// ---------------------------------------------------------------------------
// Estas expressões saíram erradas DUAS vezes, e as duas foram apontadas pelo
// CodeQL sobre este próprio arquivo (`Bad HTML filtering regexp`). Vale
// registrar as duas, porque o erro é o mesmo nos dois casos: escrever o padrão
// pensando no HTML que NÓS emitimos, quando o que importa é o que o PARSER
// aceita.
//
//   1. **Caixa.** Nome de tag e de atributo não distinguem maiúscula:
//      `</SCRIPT>` fecha um bloco igual a `</script>`, e `TYPE=` vale como
//      `type=`. Faltava o flag `i`.
//
//   2. **Atributos na tag de fechamento.** Uma tag de fechamento pode carregar
//      atributos — o tokenizador os analisa e os DESCARTA, mas a tag fecha do
//      mesmo jeito. Ou seja, `</script foo="bar">` encerra o bloco, e um
//      `\s*` antes do `>` não alcança isso.
//
// A consequência, nos dois casos, é a mesma e é o que torna isso grave num
// arquivo de teste: a checagem de fechamento precoce existe justamente para
// pegar um `</script>` aparecendo onde não devia. Cega para essas formas, ela
// ficaria VERDE sobre uma página que o browser quebra. Uma verificação que só
// enxerga a variante bem-comportada do problema é pior do que nenhuma, porque
// passa a impressão de estar coberta — a mesma armadilha que o resto desta
// suíte existe para desarmar.
//
// Daí `[^>]*` no fechamento, e não `\s*`: tudo até o `>`, como o tokenizador.
const RE_SCRIPT_BLOCO = /<script\b([^>]*)>([\s\S]*?)<\/script\b[^>]*>/gi;
const RE_SCRIPT_ABRE = /<script\b/gi;
const RE_SCRIPT_FECHA = /<\/script\b[^>]*>/gi;
const RE_JSON_LD = /type\s*=\s*["']application\/ld\+json["']/i;

/** @param {string} html */
export function blocos(html) {
  const todos = [...html.matchAll(RE_SCRIPT_BLOCO)];
  return {
    js: todos.filter(m => !RE_JSON_LD.test(m[1])).map(m => m[2]),
    jsonld: todos.filter(m => RE_JSON_LD.test(m[1])).map(m => m[2]),
  };
}

/** Abre/fecha, para o teste de fechamento precoce. */
export function contaScriptTags(html) {
  return {
    abre: (html.match(RE_SCRIPT_ABRE) || []).length,
    fecha: (html.match(RE_SCRIPT_FECHA) || []).length,
  };
}

describe('scripts embutidos nas páginas', () => {
  it.each(Object.keys(paginas()))('o JavaScript emitido por %s é sintaticamente válido', nome => {
    const { js } = blocos(paginas()[nome]);
    for (const [i, src] of js.entries()) {
      if (!src.trim()) continue;
      // `new vm.Script` compila sem executar: é o parser do V8 dizendo se o
      // que saiu do template é JavaScript de verdade.
      expect(() => new vm.Script(src), `${nome} bloco #${i}`).not.toThrow();
    }
  });

  it.each(Object.keys(paginas()))('o JSON-LD emitido por %s é JSON válido', nome => {
    // JSON-LD quebrado não derruba a página, e é justamente por isso que passa
    // despercebido: só o rich-results do Google reclama, meses depois.
    const { jsonld } = blocos(paginas()[nome]);
    for (const [i, src] of jsonld.entries()) {
      expect(() => JSON.parse(src), `${nome} bloco #${i}`).not.toThrow();
    }
  });

  it('nenhuma página fecha um <script> cedo demais', () => {
    // Um `</script>` literal dentro de um bloco encerra o script no PARSER DO
    // BROWSER, independentemente de estar dentro de uma string JS. É o motivo
    // de event.js escapar `<` e `>` ao serializar o `photosJSON`.
    for (const [nome, html] of Object.entries(paginas())) {
      const { abre, fecha } = contaScriptTags(html);
      expect(fecha, `${nome}: <script> e </script> desbalanceados`).toBe(abre);
    }
  });
});

describe('dicas de conexão no cabeçalho', () => {
  // O defeito que estes testes travam existiu em DOZE cabeçalhos ao mesmo
  // tempo: todos preconectavam a `fonts.googleapis.com` (o CSS) e nenhum a
  // `fonts.gstatic.com` (os WOFF2 que aquele CSS aponta). Meio par não é meio
  // ganho — é ganho nenhum, porque o handshake que importa é justamente o do
  // host que ficou de fora, e ele só começa depois do CSS chegar e ser
  // parseado.
  //
  // É um defeito invisível para todo o resto da suíte: a página renderiza,
  // o JavaScript compila, a CSP continua válida. Só um waterfall de rede
  // mostra. Daí a asserção ser estrutural — sobre o par, não sobre a página.
  const paginasComFonte = Object.entries(paginas());

  it.each(paginasComFonte.map(([nome]) => nome))(
    '%s preconecta aos DOIS hosts do Google Fonts',
    nome => {
      const html = paginas()[nome];
      expect(html, `${nome}: preconnect do CSS ausente`)
        .toContain('<link rel="preconnect" href="https://fonts.googleapis.com">');
      expect(html, `${nome}: preconnect dos arquivos de fonte ausente`)
        .toContain('<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>');
    },
  );

  it('o preconnect de fonte leva crossorigin e o de CSS não leva', () => {
    // Requisição de fonte é CORS; folha de estilo não é. O browser guarda
    // pools de conexão separados para os dois modos, então trocar o atributo
    // de lugar (ou pô-lo nos dois) abre a conexão que a busca real NÃO
    // reaproveita — pior que não preconectar, porque parece resolvido.
    const html = galleryHTML([EVENTO], null, 'NONCE');
    expect(html).not.toMatch(/<link rel="preconnect" href="https:\/\/fonts\.googleapis\.com" crossorigin>/);
    expect(html).not.toMatch(/<link rel="preconnect" href="https:\/\/fonts\.gstatic\.com">/);
  });

  it('a galeria preconecta ao host das miniaturas', () => {
    // Todo card desta página busca a miniatura em lh3.googleusercontent.com.
    // A página de projeto já fazia isso com UMA imagem; a galeria abre com
    // dezenas e não fazia.
    const html = galleryHTML([EVENTO], null, 'NONCE');
    expect(html).toContain('<link rel="preconnect" href="https://lh3.googleusercontent.com">');
  });

  it('a página de projeto continua preconectando ao host das fotos', () => {
    const html = eventHTML(EVENTO, '2026', null, 'NONCE', 'nonce-drive', 'form-token');
    expect(html).toContain('<link rel="preconnect" href="https://lh3.googleusercontent.com">');
  });

  it('nenhuma página preconecta a um host que a CSP não deixa carregar', () => {
    // Preconnect não passa pela CSP (não busca nada), então um host aqui que
    // a política recusa é trabalho de rede jogado fora — e a divergência não
    // apareceria em lugar nenhum. Amarrar os dois lados aqui evita que uma
    // origem removida da CSP fique para trás no cabeçalho.
    const permitidos = new Set([
      'https://fonts.googleapis.com',   // style-src
      'https://fonts.gstatic.com',      // font-src
      'https://lh3.googleusercontent.com', // img-src (*.googleusercontent.com)
      'https://drive.google.com',       // img-src
      'https://challenges.cloudflare.com', // script-src/frame-src/connect-src
      'https://static.cloudflareinsights.com',
    ]);
    for (const [nome, html] of paginasComFonte) {
      for (const m of html.matchAll(/<link rel="preconnect" href="([^"]+)"/g)) {
        expect(permitidos.has(m[1]), `${nome}: preconnect a ${m[1]}, que a CSP não permite`).toBe(true);
      }
    }
  });
});

describe('painel: dado guardado não vira marcação', () => {
  // O restore de backup é o único caminho que grava eventos em KV sem passar
  // por `normalizeEventFields` — o próprio código diz isso. `sanitizeRestored
  // Event` cobre os campos de URL, mas `id` e `status` passavam verbatim, e o
  // painel os interpolava CRUS em `data-id="…"` e `class="st-…"` no template
  // que roda no browser. Um backup adulterado (o cenário plausível é social:
  // "restaura esse arquivo aí") plantava marcação dentro do painel logado.
  //
  // O servidor já escapava esses mesmos campos na primeira renderização; era
  // só o caminho do cliente que não. Divergência entre os dois é o modo de
  // falha clássico de uma página renderizada dos dois lados.
  const HOSTIL = '" onmouseover="alert(1)" x="';

  it('escapa o id do evento no template do cliente', () => {
    const html = dashboardHTML([{ ...EVENTO, id: HOSTIL }], [], 'NONCE');
    expect(html).not.toContain('onmouseover="alert(1)"');
    expect(html).toContain('&quot; onmouseover=&quot;alert(1)&quot;');
  });

  it('escapa o status do evento no template do cliente', () => {
    const html = dashboardHTML([{ ...EVENTO, status: HOSTIL }], [], 'NONCE');
    expect(html).not.toContain('onmouseover="alert(1)"');
  });

  it('um status desconhecido vira texto, não "undefined"', () => {
    // `STATUS_LABELS[st]` devolvia undefined para qualquer status fora da
    // lista — e um backup restaurado pode trazer qualquer coisa. Renderizar a
    // string "undefined" num badge é o tipo de defeito que ninguém reporta.
    const html = dashboardHTML([{ ...EVENTO, status: 'desconhecido' }], [], 'NONCE');
    expect(html).not.toMatch(/>undefined</);
  });

  it('não deixa um esquema javascript: chegar ao src da miniatura', () => {
    // Mesmo contrato das páginas públicas: safeUrl mata o esquema, esc fecha o
    // atributo. Nenhum dos dois sozinho cobre os dois riscos.
    //
    // A asserção é sobre o SINK, não sobre a página inteira: o valor guardado
    // aparece legitimamente dentro do `eventsJSON` que o painel serializa para
    // o cliente re-renderizar. Ali ele é uma string de dados, não marcação — o
    // que precisa estar protegido é o atributo onde ele desemboca.
    const html = dashboardHTML([{ ...EVENTO, thumbnailUrl: 'javascript:alert(1)' }], [], 'NONCE');
    expect(html).not.toMatch(/src=["']javascript:/i);
    expect(html).not.toMatch(/src=["'][^"']*javascript:/i);
  });
});

describe('a própria varredura desta suíte', () => {
  // Achado do CodeQL sobre este arquivo (`Bad HTML filtering regexp`), fechado
  // com o teste que prova o conserto em vez de uma supressão. Um verificador
  // que só enxerga a forma minúscula do problema deixa passar exatamente o que
  // ele deveria pegar — e ainda dá a impressão de estar cobrindo.
  it('enxerga <SCRIPT> em qualquer caixa', () => {
    const { js } = blocos('<SCRIPT>var a = 1;</SCRIPT>');
    expect(js).toEqual(['var a = 1;']);
  });

  it('conta o fechamento em qualquer caixa, e com espaço antes do >', () => {
    // `</script >` é fechamento válido para o parser de HTML.
    expect(contaScriptTags('<script>a</SCRIPT >')).toEqual({ abre: 1, fecha: 1 });
  });

  it('enxerga uma tag de fechamento COM atributos', () => {
    // O tokenizador analisa os atributos de uma tag de fechamento e os
    // descarta — mas a tag fecha. `</script foo="bar">` encerra o bloco, e um
    // padrão que só admite espaço em branco antes do `>` não vê isso.
    expect(contaScriptTags('<script>a</script foo="bar">')).toEqual({ abre: 1, fecha: 1 });
    const { js } = blocos('<script>var a = 1;</script data-x>');
    expect(js).toEqual(['var a = 1;']);
  });

  it('não confunde o fechamento de uma tag de nome diferente', () => {
    expect(contaScriptTags('</scriptish>')).toEqual({ abre: 0, fecha: 0 });
  });

  it('casa o contraexemplo exato que o CodeQL apontou', () => {
    // Vem literalmente do alerta (`</script\t\n bar>`): tabulação, quebra de
    // linha E um atributo solto, tudo dentro da tag de fechamento. Fixado aqui
    // com o valor cru porque um contraexemplo dado pelo próprio analisador é o
    // melhor caso de regressão que existe — não é hipótese nossa sobre o que
    // pode aparecer, é a forma que a ferramenta sabe que quebra o padrão.
    expect(contaScriptTags('<script>a</script\t\n bar>')).toEqual({ abre: 1, fecha: 1 });
    expect(blocos('<script>var a=1;</script\t\n bar>').js).toEqual(['var a=1;']);
  });

  it('casa a tag de fechamento com barra de auto-fechamento', () => {
    // `</script/>` é erro de parsing para a especificação, mas ainda assim é
    // uma tag de fechamento — o tokenizador segue em frente e fecha o bloco.
    expect(contaScriptTags('<script>a</script/>')).toEqual({ abre: 1, fecha: 1 });
  });

  it('não confunde uma tag que só COMEÇA com "script"', () => {
    expect(contaScriptTags('<scriptish>')).toEqual({ abre: 0, fecha: 0 });
  });

  it('reconhece o JSON-LD com o atributo em maiúsculas', () => {
    const { js, jsonld } = blocos('<script TYPE="application/ld+json">{"a":1}</script>');
    expect(jsonld).toEqual(['{"a":1}']);
    expect(js).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// Cartão de pré-visualização do link
// ---------------------------------------------------------------------------
// O que o destinatário de um link no WhatsApp vê ANTES de tocar. É o cartão,
// não a página, e ele é montado só a partir do <head> — nenhum script roda no
// scraper. Como o bloco agora sai de uma função só (socialMetaHTML), o que
// esta suíte cobre é o que cada página passa para ela: uma página que esqueça
// de chamá-la volta a ser um link sem cartão, e nada mais no projeto acusaria.

/** @param {string} html */
function metas(html) {
  /** @type {Record<string, string>} */
  const out = {};
  for (const m of html.matchAll(/<meta\s+(?:property|name)="([^"]+)"\s+content="([^"]*)">/g)) {
    if (!(m[1] in out)) out[m[1]] = m[2];
  }
  return out;
}

/** Páginas públicas — o painel é noindex e não se compartilha. */
const PUBLICAS = ['gallery', 'event', 'support', 'privacy', 'terms', 'about', 'gear', 'legal', 'doc'];

describe('cartão de pré-visualização do link', () => {
  it.each(PUBLICAS)('%s traz título, descrição, url e origem', nome => {
    const m = metas(paginas()[nome]);
    expect(m['og:title']).toBeTruthy();
    expect(m['og:description']).toBeTruthy();
    expect(m['og:url']).toMatch(/^https:\/\/fotos\.lucafchala\.com\//);
    expect(m['og:site_name']).toBe('fotos · Luca F. Chala');
    expect(m['og:locale']).toBe('pt_BR');
    expect(m['twitter:card']).toBeTruthy();
  });

  it.each(PUBLICAS)('%s repete a descrição do cartão na meta description', nome => {
    // Um texto só para busca e compartilhamento: separados, um envelhece
    // sozinho sem que nada acuse.
    const m = metas(paginas()[nome]);
    expect(m.description).toBe(m['og:description']);
  });

  it.each(PUBLICAS)('a descrição de %s cabe no que um scraper mostra', nome => {
    expect(metas(paginas()[nome])['og:description'].length).toBeLessThanOrEqual(300);
  });

  it('a página do projeto abre o cartão pelos fatos, com o colaborador logo após a data', () => {
    const m = metas(eventHTML(
      { ...EVENTO, eventCredits: 'Colégio Santa Cruz', longDescription: 'Colação de grau.' },
      '2026', null, 'NONCE', 'nonce-drive', 'form-token',
    ));
    expect(m['og:description']).toBe(
      '15 de janeiro de 2026 · Em colaboração com Colégio Santa Cruz · Casamento — Colação de grau.',
    );
  });

  it('a página do projeto anuncia acesso restrito', () => {
    const m = metas(eventHTML({ ...EVENTO, accessType: 'family' }, '2026', null, 'N', 'nd', 'ft'));
    expect(m['og:description']).toContain('Acesso restrito');
  });

  it('a página do projeto não promete acesso restrito quando é público', () => {
    const m = metas(eventHTML(EVENTO, '2026', null, 'N', 'nd', 'ft'));
    expect(m['og:description']).not.toContain('Acesso restrito');
  });

  it('a capa do projeto vai recortada no formato do cartão, com as dimensões declaradas', () => {
    // Sem width/height o WhatsApp precisa baixar a imagem para medir e, quando
    // o download demora, cai na miniatura quadrada em vez do cartão grande.
    const m = metas(eventHTML(EVENTO, '2026', null, 'N', 'nd', 'ft'));
    expect(m['og:image']).toBe('https://lh3.googleusercontent.com/d/AAA=w1200-h630-c');
    expect(m['og:image:width']).toBe('1200');
    expect(m['og:image:height']).toBe('630');
    expect(m['og:image:alt']).toBe('Foto de Evento');
    expect(m['twitter:card']).toBe('summary_large_image');
  });

  it('um projeto "em breve" usa o PNG próprio, do mesmo tamanho', () => {
    const m = metas(eventHTML({ ...EVENTO, comingSoon: true }, '2026', null, 'N', 'nd', 'ft'));
    expect(m['og:image']).toBe('https://fotos.lucafchala.com/og-coming-soon.png');
    expect(m['og:image:width']).toBe('1200');
    expect(m['og:description']).toMatch(/^Em breve/);
  });

  it('um projeto sem foto nenhuma sai sem tag de imagem, não com tag vazia', () => {
    const m = metas(eventHTML(
      { ...EVENTO, photos: [], thumbnailUrl: '' }, '2026', null, 'N', 'nd', 'ft',
    ));
    expect(m['og:image']).toBeUndefined();
    expect(m['twitter:card']).toBe('summary');
  });

  it('a home resume o acervo em vez de repetir o título', () => {
    const m = metas(galleryHTML([EVENTO], null, 'NONCE'));
    expect(m['og:description']).toContain('1 projeto');
    expect(m['og:description']).toContain('Casamento');
  });

  it('o JSON-LD do projeto carrega os mesmos fatos do cartão', () => {
    const { jsonld } = blocos(eventHTML(
      { ...EVENTO, eventCredits: 'Colégio Santa Cruz' }, '2026', null, 'NONCE', 'nd', 'ft',
    ));
    const galeria = JSON.parse(jsonld[0]).find(n => n['@type'] === 'PhotoGallery');
    expect(galeria.creditText).toBe('Colégio Santa Cruz');
    expect(galeria.datePublished).toBe('2026-01-15');
    expect(galeria.genre).toBe('Casamento');
    expect(galeria.author.name).toBe('Luca F. Chala');
  });

  it('título e descrição do cartão saem escapados', () => {
    const m = metas(eventHTML(
      { ...EVENTO, title: 'Ensaio "Luz"', eventCredits: '<b>X</b>' }, '2026', null, 'N', 'nd', 'ft',
    ));
    expect(m['og:title']).toBe('Ensaio &quot;Luz&quot;');
    expect(m['og:description']).toContain('&lt;b&gt;X&lt;/b&gt;');
  });
});
