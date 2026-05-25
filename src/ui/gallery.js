import { escape, formatDatePT } from '../utils.js';

export function galleryHTML(events) {
  const visible = events
    .filter(e => e.visible !== false)
    .sort((a, b) => (b.date || '').localeCompare(a.date || ''));

  const cards = visible.length === 0
    ? `<p class="empty">Em breve…</p>`
    : visible.map(e => `
      <a href="/${escape(e.slug)}" class="card">
        <div class="thumb">
          ${e.thumbnailUrl
            ? `<img src="${escape(e.thumbnailUrl)}" alt="${escape(e.title)}" loading="lazy">`
            : `<div class="thumb-ph">${iconCamera()}</div>`}
        </div>
        <div class="info">
          ${e.date ? `<span class="date">${escape(formatDatePT(e.date))}</span>` : ''}
          <h2>${escape(e.title)}</h2>
          ${e.shortDescription ? `<p>${escape(e.shortDescription)}</p>` : ''}
        </div>
      </a>`).join('');

  return `<!DOCTYPE html>
<html lang="pt-BR">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>fotos · Luca F. Chala</title>
  <meta name="description" content="Galeria de fotos de Luca Fchala">
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link href="https://fonts.googleapis.com/css2?family=Inter:ital,wght@0,300;0,400;0,500;0,600;1,300&display=swap" rel="stylesheet">
  <style>
    *,*::before,*::after{box-sizing:border-box;margin:0;padding:0}
    body{font-family:'Inter',sans-serif;background:#0a0a0a;color:#f0ebe5;min-height:100vh}
    header{padding:3rem 1.5rem 1.75rem;text-align:center}
    .logo{font-size:1rem;font-weight:300;letter-spacing:.25em;text-transform:lowercase;color:#c8c0b8}
    .logo strong{font-weight:600;color:#f0ebe5}
    main{max-width:1280px;margin:0 auto;padding:.5rem 1rem 5rem}
    .grid{display:grid;grid-template-columns:repeat(2,1fr);gap:.875rem}
    @media(min-width:560px){.grid{grid-template-columns:repeat(3,1fr);gap:1.125rem}}
    @media(min-width:900px){.grid{grid-template-columns:repeat(4,1fr);gap:1.5rem}}
    .card{display:block;text-decoration:none;color:inherit;border-radius:10px;overflow:hidden;background:#111;border:1px solid #1c1c1c;transition:transform .2s ease,border-color .2s}
    .card:hover{transform:translateY(-4px);border-color:#2e2e2e}
    .thumb{aspect-ratio:4/3;overflow:hidden;background:#181818;position:relative}
    .thumb img{width:100%;height:100%;object-fit:cover;display:block;transition:transform .4s ease}
    .card:hover .thumb img{transform:scale(1.06)}
    .thumb-ph{width:100%;height:100%;display:flex;align-items:center;justify-content:center;color:#252525}
    .info{padding:.75rem .875rem 1rem}
    .date{font-size:.625rem;font-weight:500;letter-spacing:.1em;text-transform:uppercase;color:#555}
    .info h2{font-size:.875rem;font-weight:600;margin:.25rem 0 .3rem;line-height:1.3}
    .info p{font-size:.75rem;color:#777;line-height:1.5;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden}
    .empty{text-align:center;color:#333;padding:6rem 0;font-size:.875rem;letter-spacing:.06em}
    footer{text-align:center;padding:2rem 1rem;border-top:1px solid #141414}
    footer a{color:#3a3a3a;font-size:.75rem;text-decoration:none;letter-spacing:.12em;transition:color .2s}
    footer a:hover{color:#777}
  </style>
</head>
<body>
  <header>
    <div class="logo">fotos · <strong>Luca F. Chala</strong></div>
  </header>
  <main>
    <div class="grid">${cards}</div>
  </main>
  <footer>
    <a href="https://instagram.com/lucafchala" target="_blank" rel="noopener">@lucafchala</a>
  </footer>
</body>
</html>`;
}

function iconCamera() {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.25"><rect x="3" y="5" width="18" height="15" rx="2"/><circle cx="12" cy="12" r="4"/><path d="M9 5l1.5-2h3L15 5"/></svg>`;
}
