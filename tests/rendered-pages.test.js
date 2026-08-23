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
