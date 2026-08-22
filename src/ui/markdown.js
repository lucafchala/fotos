import { escape } from '../utils.js';
import { DOC_PATH_TO_SLUG } from '../content/legal-docs.js';

/**
 * Uma entrada do índice lateral (só h2 e h3 entram).
 * @typedef {{ id: string, level: number, title: string }} ItemIndice
 */

// Renderizador de um subconjunto de Markdown, feito sob medida para os
// documentos de conformidade.
//
// Não é uma biblioteca genérica de propósito: uma dependência de markdown
// completa traz um parser grande, superfície de ataque de XSS conhecida e
// atualizações a acompanhar, tudo para renderizar doze arquivos que nós mesmos
// escrevemos. O subconjunto abaixo cobre o que esses arquivos usam de fato.
//
// REGRA CENTRAL: escapar PRIMEIRO, formatar DEPOIS.
//
// Todo texto passa por escape() antes de qualquer regex de formatação rodar.
// Assim, um `<script>` que apareça no markdown já virou `&lt;script&gt;` quando
// as regras inline agem, e nenhuma delas consegue reconstituir uma tag. A ordem
// inversa — formatar e depois tentar limpar — é exatamente como sanitizadores
// de markdown costumam falhar. O conteúdo é nosso, mas tratar como não confiável
// custa nada e sobrevive ao dia em que alguém colar algo de fora num documento.

// ---------------------------------------------------------------------------
// Links
// ---------------------------------------------------------------------------
// Três destinos possíveis, e um deles é deliberadamente descartado:
//
//  1. Caminho relativo para outro documento (./ROPA.md) → vira a rota interna.
//  2. URL absoluta do próprio site → vira caminho relativo.
//  3. Externa https → mantida, com rel="noopener".
//
// Qualquer outra coisa — caminho de arquivo do repositório (./TODO.md,
// ../../src/ui/privacy.js), link quebrado, e **qualquer coisa apontando para o
// GitHub** — é rebaixada a texto puro. O rótulo continua legível; só o link some.
// Isso cumpre a regra do site (nada leva ao GitHub, exceto o link de
// código-fonte no rodapé) sem depender de alguém lembrar de revisar cada
// markdown antes de publicar.
const SITE_HOST = 'fotos.lucafchala.com';

/**
 * @param {unknown} raw
 * @returns {string|null}
 */
export function resolveDocHref(raw) {
  if (typeof raw !== 'string' || !raw) return null;
  const href = raw.trim();

  // Âncora dentro da própria página.
  if (href.startsWith('#')) return href;

  // Nunca deixamos um link para o GitHub sair daqui. A comparação por
  // substring é deliberada e não é a mesma coisa que a de baixo: esta é uma
  // regra de NEGAÇÃO, então alcance a mais erra para o lado seguro — o link
  // vira texto puro e ninguém se machuca. Alcance a menos, não.
  if (/github\.com/i.test(href)) return null;

  // Documento irmão, em qualquer das formas relativas que os markdowns usam.
  const withoutAnchor = href.split('#')[0];
  const slug = /** @type {Record<string, string>} */ (DOC_PATH_TO_SLUG)[withoutAnchor];
  if (slug) return '/legal/' + slug;

  // Caminho interno já absoluto — mas `//exemplo.com/x` também começa com `/`
  // e NÃO é interno: é URL protocol-relative, que o browser resolve como
  // `https://exemplo.com/x`. Sem a segunda condição ela era devolvida crua,
  // pulando a validação de esquema e de host logo abaixo, e ainda saía sem
  // `rel="noopener noreferrer"` — porque `isExternal()` testa `^https://` e um
  // `//` não casa. Link externo disfarçado de caminho interno.
  //
  // Com a exclusão, `//exemplo.com/x` cai no `new URL(href)` mais abaixo, que
  // lança sem base e rebaixa o link a texto puro.
  if (href.startsWith('/') && !href.startsWith('//')) return href;

  // Antes de tratar o resto como URL: mailto: não sobrevive à checagem de
  // esquema abaixo e precisa passar aqui.
  if (/^mailto:/i.test(href)) return href;

  // Sobrou URL absoluta. Daqui para frente quem decide é o parser, não uma
  // comparação de prefixo. `startsWith('https://fotos.lucafchala.com')`
  // aceitaria `https://fotos.lucafchala.com.exemplo.com/x` e
  // `https://fotos.lucafchala.com@exemplo.com/x` — dois hosts completamente
  // diferentes que só *começam* com o nosso nome. É o erro clássico de
  // validar URL por substring, e o parser não o comete.
  let url;
  try {
    url = new URL(href);
  } catch {
    // Caminho de repositório (../../src/ui/privacy.js), link quebrado, o que
    // for: não é URL, não vira link. Texto.
    return null;
  }

  // Só https. `javascript:`, `data:` e `http:` param aqui.
  if (url.protocol !== 'https:') return null;

  // Próprio site → relativa, para não sair e voltar.
  if (url.host === SITE_HOST) return (url.pathname + url.search + url.hash) || '/';

  // Externa legítima. Devolve o texto original, sem a normalização do parser,
  // para o href publicado ser exatamente o que o documento escreveu.
  return href;
}

/** @param {string} href */
function isExternal(href) {
  return /^https:\/\//i.test(href);
}

// Desfaz o escape de escape() em UMA passada.
//
// Encadear `.replace(/&amp;/g,'&').replace(/&quot;/g,'"')` desescapa duas
// vezes: a primeira troca transforma `&amp;quot;` em `&quot;`, e a segunda o
// transforma em `"`. Um destino escrito no markdown como `&amp;quot;` — que
// deveria virar o texto literal `&quot;` — sairia como aspas de verdade,
// justamente o caractere que fecha o atributo href. O escape() na emissão já
// impediria a fuga, mas depender do último passo é frágil; a passada única
// nunca reexamina o que acabou de produzir e o problema deixa de existir.
const ENTITIES = { '&amp;': '&', '&quot;': '"', '&#x27;': "'", '&lt;': '<', '&gt;': '>' };

/** @param {string} s */
function unescapeEntities(s) {
  return s.replace(/&(?:amp|quot|#x27|lt|gt);/g, /** @param {string} m */ m => /** @type {Record<string, string>} */ (ENTITIES)[m]);
}

// ---------------------------------------------------------------------------
// Formatação inline — roda SOBRE texto já escapado
// ---------------------------------------------------------------------------
/** @param {string} escaped */
function inline(escaped) {
  let s = escaped;

  // Código inline primeiro: o que estiver dentro de crases não deve receber
  // negrito nem virar link. O marcador usa caracteres de uso privado, e não
  // algo como " CODE0 ": esse injetaria espaços quando a crase vem colada na
  // palavra vizinha, e ainda poderia casar com as regras seguintes.
  /** @type {string[]} */
  const codes = [];
  s = s.replace(/`([^`]+)`/g, /** @param {string} _ @param {string} code */ (_, code) => {
    codes.push(code);
    return '\uE000' + (codes.length - 1) + '\uE001';
  });

  // Links: [rótulo](destino). O destino já vem escapado, então desfazemos o
  // escape só para analisá-lo, e reescapamos ao emitir o atributo.
  s = s.replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, /** @param {string} whole @param {string} label @param {string} target */ (whole, label, target) => {
    const raw = unescapeEntities(target);
    const href = resolveDocHref(raw);
    if (!href) return label; // rebaixado a texto puro
    const attrs = isExternal(href) ? ' target="_blank" rel="noopener noreferrer"' : '';
    return `<a href="${escape(href)}"${attrs}>${label}</a>`;
  });

  s = s.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
  s = s.replace(/(^|[\s(])\*([^*\n]+)\*(?=[\s).,;:!?]|$)/g, '$1<em>$2</em>');

  s = s.replace(/\uE000(\d+)\uE001/g, /** @param {string} _ @param {string} i */ (_, i) => `<code>${escape(codes[Number(i)])}</code>`);
  return s;
}

/** @param {unknown} raw */
function text(raw) {
  return inline(escape(raw));
}

// ---------------------------------------------------------------------------
// Blocos
// ---------------------------------------------------------------------------
/** @param {string} line */
function tableRowCells(line) {
  // Descarta o pipe inicial/final e divide. Não trata pipe escapado — os
  // documentos não usam, e inventar suporte para o que ninguém escreve só cria
  // superfície para errar.
  return line.replace(/^\||\|$/g, '').split('|').map(c => c.trim());
}

const HEADING_RE = /^(#{1,6})\s+(.*)$/;
const HR_RE = /^\s*(?:---|\*\*\*|___)\s*$/;
const UL_RE = /^\s*[-*]\s+(.*)$/;
const OL_RE = /^\s*\d+\.\s+(.*)$/;
const QUOTE_RE = /^>\s?(.*)$/;
const TABLE_SEP_RE = /^\|?[\s:|-]+\|[\s:|-]*$/;

/**
 * @param {unknown} md
 * @returns {{ html: string, toc: ItemIndice[] }}
 */
export function renderMarkdown(md) {
  const lines = String(md ?? '').replace(/\r\n?/g, '\n').split('\n');
  const out = [];
  let i = 0;

  // Índice de headings, para a navegação lateral da página do documento.
  /** @type {ItemIndice[]} */
  const toc = [];
  const slugCount = new Map();
  /** @param {string} title */
  const headingId = title => {
    const base = title.toLowerCase()
      .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
      .replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'secao';
    const n = (slugCount.get(base) || 0) + 1;
    slugCount.set(base, n);
    return n === 1 ? base : `${base}-${n}`;
  };

  while (i < lines.length) {
    const line = lines[i];

    // --- bloco de código cercado ---
    if (/^```/.test(line)) {
      const body = [];
      i++;
      while (i < lines.length && !/^```/.test(lines[i])) { body.push(lines[i]); i++; }
      i++; // fecha
      out.push(`<pre><code>${escape(body.join('\n'))}</code></pre>`);
      continue;
    }

    if (!line.trim()) { i++; continue; }

    if (HR_RE.test(line)) { out.push('<hr>'); i++; continue; }

    // --- heading ---
    const h = line.match(HEADING_RE);
    if (h) {
      const level = Math.min(h[1].length, 6);
      const raw = h[2].trim().replace(/\s*#+\s*$/, '');
      const id = headingId(raw.replace(/[*`[\]()]/g, ''));
      if (level === 2 || level === 3) toc.push({ id, level, title: raw.replace(/[*`]/g, '') });
      out.push(`<h${level} id="${escape(id)}">${text(raw)}</h${level}>`);
      i++;
      continue;
    }

    // --- tabela ---
    if (line.includes('|') && i + 1 < lines.length && TABLE_SEP_RE.test(lines[i + 1])) {
      const head = tableRowCells(line);
      i += 2;
      const rows = [];
      while (i < lines.length && lines[i].includes('|') && lines[i].trim()) {
        rows.push(tableRowCells(lines[i]));
        i++;
      }
      out.push(
        '<div class="table-wrap"><table><thead><tr>' +
        head.map(c => `<th>${text(c)}</th>`).join('') +
        '</tr></thead><tbody>' +
        rows.map(r => '<tr>' + r.map(c => `<td>${text(c)}</td>`).join('') + '</tr>').join('') +
        '</tbody></table></div>'
      );
      continue;
    }

    // --- citação ---
    if (QUOTE_RE.test(line)) {
      const body = [];
      // Casa UMA vez e usa o resultado como condição, em vez de `test()` seguido
      // de `match()`. Dois ganhos: metade do trabalho de regex, e o grupo de
      // captura deixa de depender de `test` e `match` concordarem — o dia em que
      // alguém acrescentar a flag `g` a um destes padrões, `test` vira stateful
      // (`lastIndex`) e `match` passa a devolver a lista de ocorrências em vez
      // dos grupos. As duas coisas quebram calado.
      for (;;) {
        const m = i < lines.length ? lines[i].match(QUOTE_RE) : null;
        if (!m) break;
        body.push(m[1]);
        i++;
      }
      // Recursivo: as citações dos documentos contêm títulos, listas e tabelas
      // (é onde moram os avisos "não é parecer jurídico" e os modelos de termo).
      out.push(`<blockquote>${renderMarkdown(body.join('\n')).html}</blockquote>`);
      continue;
    }

    // --- listas ---
    const isUl = UL_RE.test(line);
    const isOl = !isUl && OL_RE.test(line);
    if (isUl || isOl) {
      const re = isUl ? UL_RE : OL_RE;
      const items = [];
      // Mesmo motivo da citação acima: uma passada de regex, e o grupo de
      // captura vem do próprio casamento que autorizou a iteração.
      for (;;) {
        const m = i < lines.length ? lines[i].match(re) : null;
        if (!m) break;
        let item = m[1];
        i++;
        // Continuação indentada da mesma entrada.
        while (i < lines.length && /^\s{2,}\S/.test(lines[i]) && !re.test(lines[i]) && !UL_RE.test(lines[i]) && !OL_RE.test(lines[i])) {
          item += ' ' + lines[i].trim();
          i++;
        }
        // Caixa de seleção dos modelos de termo: vira um quadrado visível em
        // vez de um "( )" solto, que numa página renderizada some.
        item = item.replace(/^\[( |x|X)\]\s*/, (_, m) => (m === ' ' ? '☐ ' : '☑ '));
        items.push(`<li>${text(item)}</li>`);
      }
      out.push(`<${isUl ? 'ul' : 'ol'}>${items.join('')}</${isUl ? 'ul' : 'ol'}>`);
      continue;
    }

    // --- parágrafo ---
    const para = [];
    while (
      i < lines.length && lines[i].trim() &&
      !HEADING_RE.test(lines[i]) && !HR_RE.test(lines[i]) &&
      !UL_RE.test(lines[i]) && !OL_RE.test(lines[i]) &&
      !QUOTE_RE.test(lines[i]) && !/^```/.test(lines[i])
    ) {
      para.push(lines[i]);
      i++;
    }
    out.push(`<p>${text(para.join(' '))}</p>`);
  }

  return { html: out.join('\n'), toc };
}
