import { escape } from '../utils.js';
import { DOC_PATH_TO_SLUG } from '../content/legal-docs.js';

/**
 * Uma entrada do índice lateral (só h2 e h3 entram).
 * @typedef {{ id: string, level: number, title: string }} ItemIndice
 */

// Subconjunto de Markdown sob medida para os documentos de conformidade — não
// uma lib genérica, pra não trazer superfície de XSS por um parser completo.
//
// Regra central: escapar PRIMEIRO, formatar DEPOIS. Todo texto passa por
// escape() antes das regras inline rodarem, então um `<script>` no markdown
// já virou `&lt;script&gt;` antes delas agirem — nenhuma consegue reconstituir
// uma tag.

// ---------------------------------------------------------------------------
// Links
// ---------------------------------------------------------------------------
// Três destinos sobrevivem: caminho relativo pra outro documento (vira rota
// interna), URL absoluta do próprio site (vira relativa) e https externa
// (mantida, com rel="noopener"). Qualquer outra coisa — caminho de repo, link
// quebrado, qualquer coisa apontando pro GitHub — vira texto puro, sem
// depender de revisão manual de cada markdown.
const SITE_HOST = 'fotos.lucafchala.com';
const GITHUB_RE = /github\.com/i;

/**
 * @param {unknown} raw
 * @returns {string|null}
 */
export function resolveDocHref(raw) {
  if (typeof raw !== 'string' || !raw) return null;
  const href = raw.trim();

  // Âncora dentro da própria página.
  if (href.startsWith('#')) return href;

  // Substring match deliberado: é regra de negação, então pegar demais é
  // seguro (vira texto puro); pegar de menos, não.
  if (GITHUB_RE.test(href)) return null;

  // Documento irmão, em qualquer das formas relativas que os markdowns usam.
  const withoutAnchor = href.split('#')[0];
  const slug = /** @type {Record<string, string>} */ (DOC_PATH_TO_SLUG)[withoutAnchor];
  if (slug) return '/legal/' + slug;

  // `//exemplo.com/x` também começa com `/`, mas é protocol-relative — o
  // browser resolve como https://exemplo.com/x. Excluir aqui manda pro
  // new URL() abaixo em vez de pular a validação de esquema/host e sair
  // sem rel="noopener" (isExternal() só casa ^https://).
  if (href.startsWith('/') && !href.startsWith('//')) return href;

  // Antes de tratar o resto como URL: mailto: não sobrevive à checagem de
  // esquema abaixo e precisa passar aqui.
  if (/^mailto:/i.test(href)) return href;

  // Daqui pra frente quem decide é o parser (new URL), não um prefix match:
  // startsWith('https://fotos.lucafchala.com') aceitaria hosts como
  // fotos.lucafchala.com.exemplo.com ou fotos.lucafchala.com@exemplo.com.
  let url;
  try {
    url = new URL(href);
  } catch {
    return null; // caminho de repo, link quebrado etc. — não é URL, vira texto
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

// Desfaz escape() numa única passada: encadear replaces (&amp; primeiro,
// depois &quot;) desescapa duas vezes — `&amp;quot;` viraria aspas de verdade
// em vez do literal `&quot;`, abrindo o atributo href.
const ENTITIES = { '&amp;': '&', '&quot;': '"', '&#x27;': "'", '&lt;': '<', '&gt;': '>' };
const UNESCAPE_RE = /&(?:amp|quot|#x27|lt|gt);/g;

/** @param {string} s */
function unescapeEntities(s) {
  return s.replace(UNESCAPE_RE, /** @param {string} m */ m => /** @type {Record<string, string>} */ (ENTITIES)[m]);
}

// ---------------------------------------------------------------------------
// Formatação inline — roda SOBRE texto já escapado
// ---------------------------------------------------------------------------
const INLINE_CODE_RE = /`([^`]+)`/g;
const INLINE_LINK_RE = /\[([^\]]+)\]\(([^)\s]+)\)/g;
const INLINE_BOLD_RE = /\*\*([^*]+)\*\*/g;
const INLINE_ITALIC_RE = /(^|[\s(])\*([^*\n]+)\*(?=[\s).,;:!?]|$)/g;
const INLINE_CODE_RESTORE_RE = /\uE000(\d+)\uE001/g;

/** @param {string} escaped */
function inline(escaped) {
  let s = escaped;

  // Código inline primeiro, pra não receber negrito/link. Marcador usa
  // caracteres de uso privado (não " CODE0 ") pra não injetar espaços nem
  // colidir com as regras seguintes.
  /** @type {string[]} */
  const codes = [];
  s = s.replace(INLINE_CODE_RE, /** @param {string} _ @param {string} code */ (_, code) => {
    codes.push(code);
    return '\uE000' + (codes.length - 1) + '\uE001';
  });

  // Links: [rótulo](destino). O destino já vem escapado, então desfazemos o
  // escape só para analisá-lo, e reescapamos ao emitir o atributo.
  s = s.replace(INLINE_LINK_RE, /** @param {string} whole @param {string} label @param {string} target */ (whole, label, target) => {
    const raw = unescapeEntities(target);
    const href = resolveDocHref(raw);
    if (!href) return label; // rebaixado a texto puro
    const attrs = isExternal(href) ? ' target="_blank" rel="noopener noreferrer"' : '';
    return `<a href="${escape(href)}"${attrs}>${label}</a>`;
  });

  s = s.replace(INLINE_BOLD_RE, '<strong>$1</strong>');
  s = s.replace(INLINE_ITALIC_RE, '$1<em>$2</em>');

  s = s.replace(INLINE_CODE_RESTORE_RE, /** @param {string} _ @param {string} i */ (_, i) => `<code>${escape(codes[Number(i)])}</code>`);
  return s;
}

/** @param {unknown} raw */
function text(raw) {
  return inline(escape(raw));
}

// ---------------------------------------------------------------------------
// Blocos
// ---------------------------------------------------------------------------
const TABLE_ROW_TRIM_RE = /^\||\|$/g;

/** @param {string} line */
function tableRowCells(line) {
  // Descarta pipe inicial/final e divide. Não trata pipe escapado — os
  // documentos não usam.
  return line.replace(TABLE_ROW_TRIM_RE, '').split('|').map(c => c.trim());
}

const HEADING_RE = /^(#{1,6})\s+(.*)$/;
const HR_RE = /^\s*(?:---|\*\*\*|___)\s*$/;
const UL_RE = /^\s*[-*]\s+(.*)$/;
const OL_RE = /^\s*\d+\.\s+(.*)$/;
const QUOTE_RE = /^>\s?(.*)$/;
const TABLE_SEP_RE = /^\|?[\s:|-]+\|[\s:|-]*$/;
const FENCE_RE = /^```/;
const LIST_CONT_RE = /^\s{2,}\S/;

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
    if (FENCE_RE.test(line)) {
      const body = [];
      i++;
      while (i < lines.length && !FENCE_RE.test(lines[i])) { body.push(lines[i]); i++; }
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
      // match() uma vez em vez de test()+match(): evita o trabalho duplo e não
      // depende dos dois concordarem se alguém adicionar a flag /g depois.
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
        while (i < lines.length && LIST_CONT_RE.test(lines[i]) && !re.test(lines[i]) && !UL_RE.test(lines[i]) && !OL_RE.test(lines[i])) {
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
      !QUOTE_RE.test(lines[i]) && !FENCE_RE.test(lines[i])
    ) {
      para.push(lines[i]);
      i++;
    }
    out.push(`<p>${text(para.join(' '))}</p>`);
  }

  return { html: out.join('\n'), toc };
}
