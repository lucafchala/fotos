import { escape, footerLegalLinksHTML, fontPreconnectHTML } from '../utils.js';
import { renderMarkdown } from './markdown.js';
import { LEGAL_DOCS } from '../content/legal-docs.js';

// Página de um documento de conformidade.
//
// Antes esses documentos só existiam como markdown no repositório, e a Central
// de Transparência mandava o visitante para o GitHub para lê-los. Mandar alguém
// para fora do site para ler a política que rege os dados dele é o oposto de
// transparência: exige conta em outro serviço para se orientar, quebra o tema,
// perde o rodapé e a navegação, e não funciona bem em celular.
//
// Agora cada documento é uma página daqui, renderizada do mesmo markdown que
// continua sendo a fonte da verdade (ver scripts/build-legal-docs.mjs).

const SITE_URL = 'https://fotos.lucafchala.com';

/**
 * @param {{ slug: string, title: string, markdown: string, [k: string]: any }} doc
 */
export function docHTML(doc) {
  const { html, toc } = renderMarkdown(doc.markdown);

  // Documento anterior/próximo, na ordem da Central. Ler conformidade é
  // navegação sequencial mais vezes do que se imagina, e a alternativa é voltar
  // ao índice a cada documento.
  const idx = LEGAL_DOCS.findIndex(d => d.slug === doc.slug);
  const prev = idx > 0 ? LEGAL_DOCS[idx - 1] : null;
  const next = idx >= 0 && idx < LEGAL_DOCS.length - 1 ? LEGAL_DOCS[idx + 1] : null;

  const tocHTML = toc.length >= 3
    ? `<nav class="toc" aria-label="Índice do documento">
         <p class="toc-label">Nesta página</p>
         <ul>${toc.map(t => `<li class="toc-l${t.level}"><a href="#${escape(t.id)}">${escape(t.title)}</a></li>`).join('')}</ul>
       </nav>`
    : '';

  return `<!DOCTYPE html>
<html lang="pt-BR">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <link rel="icon" type="image/svg+xml" href="/icon.svg">
  <link rel="apple-touch-icon" href="/icon.svg">
  <meta name="theme-color" content="#0a0a0a">
  <title>${escape(doc.title)} · fotos</title>
  <meta name="description" content="${escape(doc.summary)}">
  <link rel="canonical" href="${SITE_URL}/legal/${escape(doc.slug)}">
  <meta property="og:type" content="article">
  <meta property="og:title" content="${escape(doc.title)} · fotos">
  <meta property="og:description" content="${escape(doc.summary)}">
  <meta property="og:url" content="${SITE_URL}/legal/${escape(doc.slug)}">
  ${fontPreconnectHTML()}
  <link href="https://fonts.googleapis.com/css2?family=Inter:ital,wght@0,300;0,400;0,500;0,600;1,300&display=swap" rel="stylesheet">
  <style>
    *,*::before,*::after{box-sizing:border-box;margin:0;padding:0}
    :root{
      --bg-page:#0a0a0a; --text:#f0ebe5; --text-2:#b0a89e; --text-heading:#e0d8d0; --text-strong:#d0c8be;
      --text-muted:#999; --text-dim:#666; --text-dim-2:#555; --border-dim:#1e1e1e; --border-hair:#141414;
      --footer-link:#888; --accent:#c0a060; --accent-soft:rgba(192,160,96,.12);
      --card-bg:#111; --card-bg-hover:#161616; --card-border:#212121; --card-border-hover:#3a3a3a;
      --chip-bg:#141414; --chip-border:#242424; --chip-text:#8a8a8a; --code-bg:#141414;
      --quote-bar:#2a2620;
    }
    @media (prefers-color-scheme: light) {
      :root{
        --bg-page:#f0ece8; --text:#1a1715; --text-2:#4a4744; --text-heading:#2a2521; --text-strong:#332d28;
        --text-muted:#6b6460; --text-dim:#8a8480; --text-dim-2:#9a9490; --border-dim:#ddd9d4; --border-hair:#e5e1db;
        --footer-link:#6b6460; --accent:#8a6428; --accent-soft:rgba(138,100,40,.10);
        --card-bg:#fff; --card-bg-hover:#faf8f5; --card-border:#e2ded8; --card-border-hover:#c4bdb3;
        --chip-bg:#f6f3ef; --chip-border:#e2ded8; --chip-text:#6b6460; --code-bg:#f2eee9;
        --quote-bar:#e0d3b8;
      }
    }
    body{font-family:'Inter',sans-serif;background:var(--bg-page);color:var(--text);min-height:100vh;-webkit-font-smoothing:antialiased}
    :focus-visible{outline:2px solid var(--accent);outline-offset:2px}
    header{padding:1.25rem 1.5rem}
    .back{display:inline-flex;align-items:center;gap:.35rem;text-decoration:none;color:var(--text-dim-2);font-size:.8rem;letter-spacing:.04em;transition:color .2s}
    .back:hover{color:var(--text-2)}
    .back svg{width:14px;height:14px}
    main{max-width:820px;margin:0 auto;padding:1rem 1.5rem 5rem}
    a{color:var(--accent);text-decoration:none}
    a:hover{text-decoration:underline}

    .doc-head{padding-bottom:1.75rem;border-bottom:1px solid var(--border-hair);margin-bottom:2rem}
    .doc-tag{display:inline-block;padding:.28rem .65rem;border:1px solid var(--chip-border);background:var(--chip-bg);border-radius:100px;font-size:.68rem;letter-spacing:.06em;color:var(--chip-text);margin-bottom:.9rem}
    .doc-title{font-size:clamp(1.6rem,4.5vw,2.15rem);font-weight:600;letter-spacing:-.02em;line-height:1.2;margin-bottom:.6rem}
    .doc-summary{font-size:.95rem;line-height:1.65;color:var(--text-muted);max-width:60ch}

    /* Índice */
    .toc{border:1px solid var(--card-border);background:var(--card-bg);border-radius:12px;padding:1rem 1.15rem;margin-bottom:2.25rem}
    .toc-label{font-size:.66rem;letter-spacing:.14em;text-transform:uppercase;color:var(--text-dim);margin-bottom:.6rem}
    .toc ul{list-style:none;display:flex;flex-direction:column;gap:.3rem}
    .toc a{font-size:.83rem;color:var(--text-2);line-height:1.45}
    .toc a:hover{color:var(--accent)}
    .toc-l3{padding-left:1rem}
    .toc-l3 a{font-size:.79rem;color:var(--text-muted)}

    /* Corpo renderizado do markdown */
    .doc h1{font-size:1.45rem;font-weight:600;letter-spacing:-.015em;margin:2.5rem 0 .85rem;color:var(--text);line-height:1.3}
    .doc h2{font-size:1.15rem;font-weight:600;margin:2.5rem 0 .75rem;color:var(--text-heading);line-height:1.35;scroll-margin-top:1.5rem}
    .doc h3{font-size:1rem;font-weight:600;margin:1.9rem 0 .6rem;color:var(--text-heading);scroll-margin-top:1.5rem}
    .doc h4{font-size:.9rem;font-weight:600;margin:1.5rem 0 .5rem;color:var(--text-strong)}
    .doc p{font-size:.9rem;line-height:1.75;color:var(--text-2);margin-bottom:.9rem}
    .doc ul,.doc ol{margin:.4rem 0 1.1rem;padding-left:1.35rem}
    .doc li{font-size:.9rem;line-height:1.7;color:var(--text-2);margin-bottom:.45rem}
    .doc strong{color:var(--text-strong);font-weight:600}
    .doc em{font-style:italic}
    .doc hr{border:0;border-top:1px solid var(--border-hair);margin:2.5rem 0}
    .doc code{font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:.82em;background:var(--code-bg);padding:.15rem .38rem;border-radius:5px;color:var(--text-strong);word-break:break-word}
    /* Vários links destes documentos têm o nome do arquivo como rótulo, e o
       rótulo é código inline. Sem isto, a cor de <code> vence a do link e o
       item fica com cara de texto morto: é um link que ninguém clica. */
    .doc a code{color:inherit;background:var(--accent-soft)}
    .doc pre{background:var(--code-bg);border:1px solid var(--card-border);border-radius:10px;padding:.9rem 1rem;overflow-x:auto;margin:0 0 1.1rem}
    .doc pre code{background:none;padding:0;font-size:.78rem;line-height:1.6;color:var(--text-2);white-space:pre}
    .doc blockquote{border-left:3px solid var(--quote-bar);background:var(--card-bg);border-radius:0 10px 10px 0;padding:1rem 1.15rem;margin:1.4rem 0}
    .doc blockquote > *:last-child{margin-bottom:0}
    .doc blockquote h2,.doc blockquote h3{margin-top:.25rem;font-size:.95rem}
    .doc .table-wrap{overflow-x:auto;border:1px solid var(--card-border);border-radius:12px;background:var(--card-bg);margin:0 0 1.4rem}
    .doc table{width:100%;border-collapse:collapse;font-size:.82rem;min-width:520px}
    .doc th{text-align:left;font-weight:600;font-size:.68rem;letter-spacing:.08em;text-transform:uppercase;color:var(--text-dim);padding:.8rem 1rem;border-bottom:1px solid var(--card-border);white-space:nowrap}
    .doc td{padding:.8rem 1rem;border-bottom:1px solid var(--border-hair);color:var(--text-2);line-height:1.55;vertical-align:top}
    .doc tr:last-child td{border-bottom:0}

    /* Navegação entre documentos */
    .doc-nav{display:grid;gap:.75rem;grid-template-columns:repeat(auto-fit,minmax(240px,1fr));margin-top:3rem;padding-top:2rem;border-top:1px solid var(--border-hair)}
    .doc-nav a{display:flex;flex-direction:column;gap:.3rem;padding:1rem 1.15rem;border:1px solid var(--card-border);border-radius:12px;background:var(--card-bg);text-decoration:none;transition:border-color .2s,background .2s}
    .doc-nav a:hover{border-color:var(--card-border-hover);background:var(--card-bg-hover);text-decoration:none}
    .doc-nav .dn-dir{font-size:.66rem;letter-spacing:.12em;text-transform:uppercase;color:var(--text-dim)}
    .doc-nav .dn-title{font-size:.88rem;font-weight:600;color:var(--text)}
    .doc-nav .dn-next{text-align:right}

    footer{text-align:center;padding:2rem 1rem;border-top:1px solid var(--border-hair);display:flex;gap:1.5rem;justify-content:center;flex-wrap:wrap;margin-top:3rem}
    footer a{color:var(--footer-link);font-size:.8rem;text-decoration:none;letter-spacing:.12em;transition:color .2s}
    footer a:hover{color:var(--text-2)}
    .footer-actions-legal{display:flex;align-items:center;gap:1.25rem;flex-wrap:wrap;justify-content:center}
    .legal-link{display:inline-flex;align-items:center;gap:.4rem;color:var(--footer-link);font-size:.8rem;text-decoration:none;letter-spacing:.1em;transition:color .2s}
    .legal-link:hover{color:var(--text-2)}
    .footer-copyright{font-size:.75rem;color:var(--footer-link);letter-spacing:.03em;text-align:center;width:100%;margin-top:.5rem}

    @media (max-width:600px){ main{padding:.75rem 1.15rem 3.5rem} }
    @media (prefers-reduced-motion:reduce){ *{transition:none!important} }
  </style>
</head>
<body>
  <header>
    <a href="/legal" class="back">
      <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="15 18 9 12 15 6"/></svg>
      Central de Transparência
    </a>
  </header>

  <main>
    <div class="doc-head">
      <span class="doc-tag">${escape(doc.tag)}</span>
      <h1 class="doc-title">${escape(doc.title)}</h1>
      <p class="doc-summary">${escape(doc.summary)}</p>
    </div>

    ${tocHTML}

    <article class="doc">${html}</article>

    <nav class="doc-nav">
      ${prev ? `<a href="/legal/${escape(prev.slug)}"><span class="dn-dir">← Anterior</span><span class="dn-title">${escape(prev.title)}</span></a>` : '<span></span>'}
      ${next ? `<a href="/legal/${escape(next.slug)}" class="dn-next"><span class="dn-dir">Próximo →</span><span class="dn-title">${escape(next.title)}</span></a>` : ''}
    </nav>
  </main>

  <footer>
    <a href="/legal">Central de Transparência</a>
    ${footerLegalLinksHTML()}
  </footer>
</body>
</html>`;
}
