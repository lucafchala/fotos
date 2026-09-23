// Páginas renderizadas e a varredura dos blocos <script> dentro delas.
//
// Moram aqui, e não dentro de um arquivo .test.js, porque mais de uma suíte
// precisa deles (rendered-pages e o lint dos scripts embutidos): importar um
// .test.js de dentro de outro registraria os testes dele de novo, em dobro.

import { dashboardHTML, loginHTML } from '../../src/ui/dashboard.js';
import { galleryHTML } from '../../src/ui/gallery.js';
import { eventHTML } from '../../src/ui/event.js';
import { supportHTML } from '../../src/ui/support.js';
import { privacyHTML } from '../../src/ui/privacy.js';
import { termsHTML } from '../../src/ui/terms.js';
import { aboutHTML } from '../../src/ui/about.js';
import { gearHTML } from '../../src/ui/gear.js';
import { legalHTML } from '../../src/ui/legal.js';
import { docHTML } from '../../src/ui/doc.js';
import { LEGAL_DOCS } from '../../src/content/legal-docs.js';

export const EVENTO = {
  id: 'a1b2c3', slug: 'evento', title: 'Evento', status: 'entregue',
  driveUrl: 'https://drive.google.com/x', driveUrlInstagram: '', projectUrl: '',
  photos: ['https://lh3.googleusercontent.com/d/AAA'],
  thumbnailUrl: 'https://lh3.googleusercontent.com/d/AAA',
  visible: true, comingSoon: false, accessType: 'public', category: 'Casamento',
  date: '2026-01-15', eventCredits: '', longDescription: 'Descrição',
  photosAlert: { active: false, addedAt: null, expiresAfterHours: 24 },
};

/** Todas as páginas que emitem script, com um argumento realista cada. */
export function paginas() {
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
export const RE_SCRIPT_BLOCO = /<script\b([^>]*)>([\s\S]*?)<\/script\b[^>]*>/gi;
// Mesmo formato, mesmo motivo, para <style> — ver a lição nº 2 acima. Uma
// varredura que procura marcação na página precisa pular o <style>, porque os
// comentários de CSS deste projeto CITAM tags ("a altura da <img> não
// resolve") e elas saem no HTML tal e qual.
export const RE_STYLE_BLOCO = /<style\b[^>]*>[\s\S]*?<\/style\b[^>]*>/gi;
const RE_SCRIPT_ABRE = /<script\b/gi;
const RE_SCRIPT_FECHA = /<\/script\b[^>]*>/gi;
const RE_JSON_LD = /type\s*=\s*["']application\/ld\+json["']/i;
// `speculationrules` é a segunda tag <script> que o browser NÃO executa: o
// corpo é JSON de configuração, lido pelo mecanismo de pré-busca. Classificar
// por tipo, e não por "é ld+json ou é JavaScript", é o que impede o teste de
// sintaxe de reprovar um bloco correto — e, mais importante, é o que faz este
// bloco ser validado como JSON em vez de não ser validado por ninguém.
const RE_SPEC_RULES = /type\s*=\s*["']speculationrules["']/i;

/** Tipos cujo corpo é DADO, não programa. */
const ehDados = attrs => RE_JSON_LD.test(attrs) || RE_SPEC_RULES.test(attrs);

/** @param {string} html */
export function blocos(html) {
  const todos = [...html.matchAll(RE_SCRIPT_BLOCO)];
  return {
    js: todos.filter(m => !ehDados(m[1])).map(m => m[2]),
    jsonld: todos.filter(m => RE_JSON_LD.test(m[1])).map(m => m[2]),
    dados: todos.filter(m => ehDados(m[1])).map(m => m[2]),
  };
}

/** Abre/fecha, para o teste de fechamento precoce. */
export function contaScriptTags(html) {
  return {
    abre: (html.match(RE_SCRIPT_ABRE) || []).length,
    fecha: (html.match(RE_SCRIPT_FECHA) || []).length,
  };
}
