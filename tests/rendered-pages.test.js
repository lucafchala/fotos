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

/** @param {string} html */
function blocos(html) {
  const todos = [...html.matchAll(/<script([^>]*)>([\s\S]*?)<\/script>/g)];
  return {
    js: todos.filter(m => !/type\s*=\s*["']application\/ld\+json["']/.test(m[1])).map(m => m[2]),
    jsonld: todos.filter(m => /application\/ld\+json/.test(m[1])).map(m => m[2]),
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
      const abre = (html.match(/<script/g) || []).length;
      const fecha = (html.match(/<\/script>/g) || []).length;
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
