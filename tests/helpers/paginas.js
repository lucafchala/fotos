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
import { galeriaHTML } from '../../src/ui/galeria.js';
import { comFaixa, SIMULACOES } from '../../src/previa.js';

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
    // Galeria própria (prévia, #235): com lista, para os scripts saírem.
    galeria: galeriaHTML({
      event: EVENTO,
      listagem: {
        v: 1, pasta: 'PASTA_RAIZ_123', em: '2026-10-10T12:00:00.000Z', truncada: false, total: 2, videos: 0, outros: 0, rk: {},
        secoes: [{ nome: '', caminho: '', fotos: [['FOTO_AAAAAAAAAA', 6000, 4000, '001.jpg', 18000000], ['FOTO_BBBBBBBBBB', 0, 0, '002.heic', 0]] }],
      },
      erro: null,
      nonce: 'NONCE',
    }),
  };
}

/**
 * Cada variação que muda o que SAI da página — o script ou a marcação —, e não
 * só um argumento: a MESMA lista para as três suítes que olham a página
 * renderizada (o lint/tsc dos scripts, a estrutura do HTML e a CSP estrita).
 * Antes cada uma tinha a sua, e a CSP precisa ver todas: um handler ou um
 * <script> sem nonce só aparece na variação que o emite.
 */
export function variacoes() {
  const muitos = Array.from({ length: 15 }, (_, i) => ({ ...EVENTO, id: `e${i}`, slug: `evento-${i}`, date: `2025-01-${String(i + 1).padStart(2, '0')}` }));
  const tudoLigado = Object.fromEntries(Object.entries(SIMULACOES).map(([nome, s]) => [nome, Object.keys(s.opcoes).at(-1)]));
  return {
    ...paginas(),
    // O JSON-LD só sai com nonce (sem ele, sem bloco): a variação com nonce é a
    // que um <script> sem o atributo poderia atingir.
    aboutComNonce: aboutHTML('Agenda aberta para 2027', 'NONCE'),
    loginComErro: loginHTML({ error: true }, 'NONCE'),
    loginIndisponivel: loginHTML({ indisponivel: true }, 'NONCE'),
    loginVerificacao: loginHTML({ verificacao: true }, 'NONCE'),
    dashboardComAgenda: dashboardHTML([EVENTO], ['Casamento'], 'NONCE', 'Agenda aberta para 2027'),
    galeriaComBeaconEMais: galleryHTML([...muitos, { ...EVENTO, pinned: true }], 'tok', 'NONCE', 'Agenda aberta para 2027'),
    eventoEmBreve: eventHTML({ ...EVENTO, comingSoon: true }, '2026', null, 'NONCE', 'dn', 'ft'),
    eventoCarrosselComBeacon: eventHTML({
      ...EVENTO, photos: [EVENTO.photos[0], 'https://lh3.googleusercontent.com/d/BBB'],
      driveUrlInstagram: 'https://drive.google.com/y', accessType: 'family',
      photosAlert: { active: true, addedAt: '2026-06-19T00:00:00Z', expiresAfterHours: 0 },
    }, '2026', 'tok', 'NONCE', 'dn', 'ft'),
    eventoComAviso: eventHTML({ ...EVENTO, photosAlert: { active: true, addedAt: new Date().toISOString(), expiresAfterHours: 24 } }, '2026', null, 'NONCE', 'dn', 'ft'),
    eventoComVideo: eventHTML({ ...EVENTO, youtubeId: 'dQw4w9WgXcQ' }, '2026', null, 'NONCE', 'dn', 'ft'),
    suporteComErro: supportHTML(false, 'erro', { name: 'x' }, 'NONCE', 'ft'),
    suporteEnviado: supportHTML(true, '', {}, 'NONCE', 'ft'),
    galeriaPropriaComErro: galeriaHTML({ event: EVENTO, listagem: null, erro: { codigo: 'chave-ausente', mensagem: 'Falta a chave.' }, nonce: 'NONCE' }),
    // A faixa da prévia de PR (src/previa.js) entra por cima de qualquer página:
    // com tudo desligado e com toda simulação ligada e um aviso aberto.
    faixaDaPrevia: comFaixa(paginas().gallery, 'passa', '/'),
    faixaDaPreviaLigada: comFaixa(paginas().event, /** @type {any} */ (tudoLigado), '/evento', { aviso: 'metricas-geradas', versao: 'Versão 2.0.0' }),
    // Doze páginas de documento saem de uma função só; cada uma traz o texto
    // do seu markdown, e é ali que um HTML cru poderia entrar.
    ...Object.fromEntries(LEGAL_DOCS.map(d => [`doc:${d.slug}`, docHTML(d)])),
  };
}

// ---------------------------------------------------------------------------
// A CSP estrita (#126): o que a página emitida pode e não pode conter
// ---------------------------------------------------------------------------
// Com `script-src 'self' 'nonce-…'` e sem 'unsafe-inline', três coisas deixam
// de executar: um <script> inline sem o nonce, um atributo `on…=` e um URL
// `javascript:`. Nenhum teste de string da política enxerga isso — por isso a
// varredura olha a página RENDERIZADA, como o navegador a lê.
//
// Sem regex para "a tag inteira", pelo motivo da lição nº 2 logo abaixo: o
// padrão certo é o que o TOKENIZADOR aceita, e `<img/onerror=x>` (a barra como
// separador), `<a href="x"onclick="y">` (atributo colado no anterior) e
// `ONCLICK=` (caixa) são todos handlers para ele. A varredura anda como o
// tokenizador: nome da tag, atributos (aspas simples, duplas ou nenhuma), e o
// corpo de <script> e <style> como texto cru até o fechamento.

/**
 * @param {string} html
 * @returns {{ tag: string, attrs: { nome: string, valor: string }[], corpo: string }[]} as tags
 *   de abertura (com o corpo cru, quando é <script> ou <style>), fora dos comentários
 */
export function tagsDeAbertura(html) {
  const baixo = html.toLowerCase();
  /** @type {{ tag: string, attrs: { nome: string, valor: string }[], corpo: string }[]} */
  const tags = [];
  let i = 0;
  while (i < html.length) {
    const lt = html.indexOf('<', i);
    if (lt < 0) break;
    if (html.startsWith('<!--', lt)) {
      const fim = html.indexOf('-->', lt + 4);
      i = fim < 0 ? html.length : fim + 3;
      continue;
    }
    // `</x>`, `<!doctype>` e um `a < b` solto no texto não abrem tag.
    if (!/[a-zA-Z]/.test(html.charAt(lt + 1))) { i = lt + 1; continue; }
    let j = lt + 1;
    while (j < html.length && !/[\s/>]/.test(html.charAt(j))) j++;
    const tag = baixo.slice(lt + 1, j);
    /** @type {{ nome: string, valor: string }[]} */
    const attrs = [];
    for (;;) {
      while (j < html.length && /[\s/]/.test(html.charAt(j))) j++;
      if (j >= html.length || html.charAt(j) === '>') break;
      const ini = j;
      while (j < html.length && !/[\s/>=]/.test(html.charAt(j))) j++;
      if (j === ini) { j++; continue; } // um '=' no lugar do nome: anda
      const nome = baixo.slice(ini, j);
      while (j < html.length && /\s/.test(html.charAt(j))) j++;
      let valor = '';
      if (html.charAt(j) === '=') {
        j++;
        while (j < html.length && /\s/.test(html.charAt(j))) j++;
        const aspas = html.charAt(j);
        if (aspas === '"' || aspas === "'") {
          const fim = html.indexOf(aspas, j + 1);
          valor = html.slice(j + 1, fim < 0 ? html.length : fim);
          j = fim < 0 ? html.length : fim + 1;
        } else {
          const ini2 = j;
          while (j < html.length && !/[\s>]/.test(html.charAt(j))) j++;
          valor = html.slice(ini2, j);
        }
      }
      attrs.push({ nome, valor });
    }
    j++; // o '>'
    let corpo = '';
    if (tag === 'script' || tag === 'style') {
      // Texto cru até o primeiro `</script` (ou `</style`) seguido de espaço,
      // `/` ou `>` — o que o tokenizador fecha.
      let fecha = baixo.indexOf(`</${tag}`, j);
      while (fecha >= 0 && !/[\s/>]/.test(baixo.charAt(fecha + tag.length + 2))) fecha = baixo.indexOf(`</${tag}`, fecha + 1);
      corpo = html.slice(j, fecha < 0 ? html.length : fecha);
      const fimDaTag = fecha < 0 ? -1 : baixo.indexOf('>', fecha);
      j = fimDaTag < 0 ? html.length : fimDaTag + 1;
    }
    tags.push({ tag, attrs, corpo });
    i = j;
  }
  return tags;
}

/**
 * Handlers inline: atributos `on…=` nas tags da página e, dentro dos
 * <script> que executam, HTML montado como texto com um `on…=` dentro
 * (`'<button onclick="…">'`) — o servidor não o vê, e a CSP o barra do mesmo
 * jeito quando o script o põe na página.
 * @param {string} html
 */
export function handlersInline(html) {
  /** @type {string[]} */
  const achados = [];
  for (const t of tagsDeAbertura(html)) {
    for (const a of t.attrs) if (/^on[a-z]+$/.test(a.nome)) achados.push(`<${t.tag} ${a.nome}=…>`);
    if (t.tag !== 'script' || ehDados(t.attrs.map(a => `${a.nome}="${a.valor}"`).join(' '))) continue;
    for (const m of t.corpo.matchAll(/<([a-zA-Z][\w-]*)[^<>]*?[\s"'/](on[a-z]{3,})\s*=/g)) {
      achados.push(`<script> monta <${m[1]} ${m[2]}=…> como texto`);
    }
  }
  return achados;
}

/**
 * Os <script> que não levam o nonce da requisição (vazio não vale como nonce).
 * Todos, com ou sem `src`: os de fora (Turnstile, beacon) passam pelo host, mas
 * o gate da CI exige o atributo em qualquer um, e é ele que mantém o script
 * funcionando se o host sair da lista.
 * @param {string} html
 * @param {string} nonce
 */
export function scriptsSemNonce(html, nonce) {
  return tagsDeAbertura(html)
    .filter(t => t.tag === 'script')
    .filter(t => !nonce || !t.attrs.some(a => a.nome === 'nonce' && a.valor === nonce))
    .map(t => `<script ${t.attrs.map(a => a.nome).join(' ')}>`);
}

/**
 * Atributos cujo valor é um URL `javascript:` — como o navegador o lê: tabs e
 * quebras de linha dentro do esquema são descartados, e controles/espaços à
 * frente também.
 * @param {string} html
 */
export function urlsJavascript(html) {
  /** @type {string[]} */
  const achados = [];
  for (const t of tagsDeAbertura(html)) {
    for (const a of t.attrs) {
      const limpo = a.valor.replace(/[\t\n\r]/g, '').replace(/^[\0-\x20]+/, '');
      if (/^javascript:/i.test(limpo)) achados.push(`<${t.tag} ${a.nome}="${a.valor.slice(0, 40)}…">`);
    }
  }
  return achados;
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

// `application/json`: a ilha de dados da galeria própria (#235) — a lista de
// fotos que o script da página lê com JSON.parse. Também é dado, e também
// passa a ser validada como JSON.
const RE_JSON_DADOS = /type\s*=\s*["']application\/json["']/i;

/** Tipos cujo corpo é DADO, não programa. */
const ehDados = attrs => RE_JSON_LD.test(attrs) || RE_SPEC_RULES.test(attrs) || RE_JSON_DADOS.test(attrs);

/** @param {string} html */
export function blocos(html) {
  const todos = [...html.matchAll(RE_SCRIPT_BLOCO)];
  return {
    js: todos.filter(m => !ehDados(m[1])).map(m => m[2]),
    jsonld: todos.filter(m => RE_JSON_LD.test(m[1])).map(m => m[2]),
    dados: todos.filter(m => ehDados(m[1])).map(m => m[2]),
  };
}

// O HTML com os blocos <script> tirados — para afirmar sobre o que a página
// MOSTRA, sem tropeçar no que o script ou a ilha de dados carrega.
//
// Sem regex de propósito. Era `html.replace(/<script\b[\s\S]*?<\/script>/gi,
// '')`, e o CodeQL do #236 acusou com razão as duas falhas dela: não fecha em
// `</script >` (o tokenizador fecha — a mesma lição de RE_SCRIPT_BLOCO acima)
// e "tirar uma vez" deixa sobrar `<script` quando os pedaços se recompõem. Aqui
// a varredura anda como o tokenizador: abre em `<script`, fecha no primeiro
// `</script` seguido de espaço, `/` ou `>`, e um bloco sem fechamento leva o
// resto da página — que é o que o navegador faria com ele.
/** @param {string} html */
export function foraDosScripts(html) {
  const baixo = html.toLowerCase();
  const fechaAqui = (/** @type {number} */ i) => {
    const c = baixo.charAt(i + 8);
    return c === '>' || c === '/' || c === ' ' || c === '\t' || c === '\n' || c === '\r' || c === '\f';
  };
  let saida = '';
  let i = 0;
  for (;;) {
    const abre = baixo.indexOf('<script', i);
    if (abre < 0) return saida + html.slice(i);
    saida += html.slice(i, abre);
    let fecha = baixo.indexOf('</script', abre);
    while (fecha >= 0 && !fechaAqui(fecha)) fecha = baixo.indexOf('</script', fecha + 1);
    if (fecha < 0) return saida;
    const fim = baixo.indexOf('>', fecha);
    if (fim < 0) return saida;
    i = fim + 1;
  }
}

/** Abre/fecha, para o teste de fechamento precoce. */
export function contaScriptTags(html) {
  return {
    abre: (html.match(RE_SCRIPT_ABRE) || []).length,
    fecha: (html.match(RE_SCRIPT_FECHA) || []).length,
  };
}
