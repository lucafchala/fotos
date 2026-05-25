import { escape, formatDatePT } from '../utils.js';

export function eventHTML(event) {
  return `<!DOCTYPE html>
<html lang="pt-BR">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${escape(event.title)} · fotos</title>
  <meta property="og:title" content="${escape(event.title)}">
  <meta property="og:description" content="${escape(event.shortDescription || '')}">
  ${event.thumbnailUrl ? `<meta property="og:image" content="${escape(event.thumbnailUrl)}">` : ''}
  <meta property="og:type" content="website">
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link href="https://fonts.googleapis.com/css2?family=Inter:ital,wght@0,300;0,400;0,500;0,600;1,400&display=swap" rel="stylesheet">
  <style>
    *,*::before,*::after{box-sizing:border-box;margin:0;padding:0}
    body{font-family:'Inter',sans-serif;background:#0a0a0a;color:#f0ebe5;min-height:100vh}
    header{padding:1.25rem 1.5rem}
    .back{display:inline-flex;align-items:center;gap:.35rem;text-decoration:none;color:#555;font-size:.78rem;letter-spacing:.04em;transition:color .2s}
    .back:hover{color:#bbb}
    .back svg{width:14px;height:14px}
    .hero{width:100%;max-height:72vh;overflow:hidden;background:#0e0e0e}
    .hero img{width:100%;max-height:72vh;object-fit:cover;display:block}
    .hero-ph{height:260px;display:flex;align-items:center;justify-content:center;color:#1e1e1e}
    main{max-width:680px;margin:0 auto;padding:2.25rem 1.5rem 6rem}
    .meta{margin-bottom:.875rem}
    .date-chip{font-size:.65rem;font-weight:500;letter-spacing:.12em;text-transform:uppercase;color:#555}
    h1{font-size:clamp(1.5rem,6vw,2.25rem);font-weight:600;line-height:1.15;margin:.4rem 0 1.75rem}
    .desc{font-size:.95rem;line-height:1.85;color:#bbb;white-space:pre-wrap;word-break:break-word;margin-bottom:2.75rem}
    /* drive section */
    .drive-wrap{margin-bottom:3rem}
    .btn-drive{display:inline-flex;align-items:center;gap:.65rem;background:#f0ebe5;color:#0a0a0a;padding:.9rem 1.6rem;border-radius:9px;text-decoration:none;font-size:.9rem;font-weight:600;letter-spacing:.02em;transition:background .18s,transform .15s;width:100%;justify-content:center}
    @media(min-width:400px){.btn-drive{width:auto}}
    .btn-drive:hover{background:#fff;transform:translateY(-2px)}
    .btn-drive svg{width:18px;height:18px;flex-shrink:0}
    /* download guide */
    .guide{margin-top:1.75rem;background:#111;border:1px solid #1d1d1d;border-radius:11px;padding:1.5rem 1.5rem 1.625rem;overflow:hidden}
    .guide-title{font-size:.68rem;font-weight:600;letter-spacing:.12em;text-transform:uppercase;color:#666;margin-bottom:1.25rem}
    .steps{display:flex;flex-direction:column;gap:.875rem;padding-left:0;list-style:none;counter-reset:step}
    .steps li{counter-increment:step;display:grid;grid-template-columns:1.5rem 1fr;gap:.5rem;font-size:.875rem;color:#aaa;line-height:1.6}
    .steps li::before{content:counter(step);font-size:.7rem;font-weight:600;color:#555;background:#1a1a1a;width:1.4rem;height:1.4rem;border-radius:50%;display:flex;align-items:center;justify-content:center;flex-shrink:0;margin-top:.15rem}
    .steps li strong{color:#ddd}
    .steps li kbd{background:#1e1e1e;border:1px solid #2d2d2d;padding:.1em .45em;border-radius:4px;font-size:.8em;font-family:inherit;color:#ccc}
    .warn-box{display:flex;align-items:flex-start;gap:.65rem;margin-top:1.375rem;padding:.875rem 1rem;background:#140f00;border:1px solid #2e2000;border-radius:8px}
    .warn-box svg{width:15px;height:15px;flex-shrink:0;color:#d4930a;margin-top:2px}
    .warn-box p{font-size:.8rem;color:#c8920e;line-height:1.6}
    .warn-box p strong{color:#e8b050}
    /* credits */
    .credits{border-top:1px solid #191919;padding-top:2.25rem}
    .credits-title{font-size:.65rem;font-weight:500;letter-spacing:.14em;text-transform:uppercase;color:#3a3a3a;margin-bottom:1rem}
    .credits-list{display:flex;flex-direction:column;gap:.5rem}
    .credits-list a,.credits-list span{font-size:.85rem;line-height:1.5;color:#666;text-decoration:none;transition:color .2s;display:block}
    .credits-list a:hover{color:#bbb}
    footer{text-align:center;padding:2rem 1rem;border-top:1px solid #111;margin-top:2rem}
    footer a{color:#2e2e2e;font-size:.75rem;text-decoration:none;letter-spacing:.1em;transition:color .2s}
    footer a:hover{color:#666}
  </style>
</head>
<body>
  <header>
    <a href="/" class="back">
      <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><polyline points="15 18 9 12 15 6"/></svg>
      todos os projetos
    </a>
  </header>

  <div class="hero">
    ${event.thumbnailUrl
      ? `<img src="${escape(event.thumbnailUrl)}" alt="${escape(event.title)}">`
      : `<div class="hero-ph"><svg xmlns="http://www.w3.org/2000/svg" width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1"><rect x="3" y="5" width="18" height="15" rx="2"/><circle cx="12" cy="12" r="4"/><path d="M9 5l1.5-2h3L15 5"/></svg></div>`}
  </div>

  <main>
    <div class="meta">
      ${event.date ? `<span class="date-chip">${escape(formatDatePT(event.date))}</span>` : ''}
    </div>
    <h1>${escape(event.title)}</h1>

    ${event.longDescription ? `<div class="desc">${escape(event.longDescription)}</div>` : ''}

    <div class="drive-wrap">
      <a href="${escape(event.driveUrl || '#')}" target="_blank" rel="noopener" class="btn-drive">
        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
        Acessar fotos
      </a>

      <div class="guide">
        <div class="guide-title">Como baixar as fotos</div>
        <ol class="steps">
          <li>Abra a pasta do Google Drive pelo botão acima.</li>
          <li>
            <span><strong>No celular:</strong> toque nos três pontinhos (⋮) de uma foto → "Fazer download".<br>
            Para baixar <em>todas</em>: segure uma foto → selecione todas → ⋮ → "Fazer download".</span>
          </li>
          <li>
            <span><strong>No computador:</strong> selecione tudo com <kbd>Ctrl+A</kbd> (ou <kbd>⌘A</kbd> no Mac) → botão direito → "Fazer download".</span>
          </li>
        </ol>
        <div class="warn-box">
          <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>
          <p><strong>Não tire print das fotos.</strong> Ao baixar pelo Drive você mantém a resolução e qualidade originais. Prints perdem qualidade e não fazem jus ao trabalho.</p>
        </div>
      </div>
    </div>

    <div class="credits">
      <div class="credits-title">Créditos</div>
      <div class="credits-list">
        <a href="https://instagram.com/lucafchala" target="_blank" rel="noopener">📷 Fotografias: @lucafchala</a>
        ${event.eventCredits ? `<span>${escape(event.eventCredits)}</span>` : ''}
        ${event.projectUrl ? `<a href="${escape(event.projectUrl)}" target="_blank" rel="noopener">🔗 ${escape(event.projectUrl)}</a>` : ''}
      </div>
    </div>
  </main>

  <footer>
    <a href="/">fotos · luca fchala</a>
  </footer>
</body>
</html>`;
}
