import { escape, formatDatePT, sizedImg, imgSrcset } from '../utils.js';

// Larguras e `sizes` casados com o grid (2 col <560px, 3 col ≥560px, 4 col ≥900px).
const CARD_WIDTHS = [320, 480, 640, 960];
const CARD_SIZES = '(min-width:900px) 23vw, (min-width:560px) 31vw, 47vw';
// Card em destaque (pinned) ocupa a largura toda; em ≥900px vira 60% de até ~1248px.
const FEAT_WIDTHS = [640, 960, 1280, 1600];
const FEAT_SIZES = '(min-width:1280px) 760px, (min-width:900px) 60vw, 96vw';

export function galleryHTML(events, analyticsToken) {
  const byDate = e => e.date ? new Date(e.date).getTime() : new Date(e.createdAt || 0).getTime();
  const visible = events
    .filter(e => e.visible !== false)
    .sort((a, b) => {
      if (a.pinned && !b.pinned) return -1;
      if (!a.pinned && b.pinned) return 1;
      return byDate(b) - byDate(a);
    });

  const cardHTML = (e, index) => {
    const featured = e.pinned === true;
    const isLCP = index === 0; // primeiro card visível = candidato a LCP
    const widths = featured ? FEAT_WIDTHS : CARD_WIDTHS;
    const sizesAttr = featured ? FEAT_SIZES : CARD_SIZES;
    const responsive = (extraClass = '', loadAttr = 'loading="lazy"') => {
      const src = escape(sizedImg(e.thumbnailUrl, featured ? 960 : 640, { crop: true }));
      const set = imgSrcset(e.thumbnailUrl, widths, { crop: true });
      const ss = set ? ` srcset="${escape(set)}" sizes="${sizesAttr}"` : '';
      const cls = extraClass ? ` class="${extraClass}"` : '';
      return `<img src="${src}"${ss} alt="${escape(e.title)}"${cls} ${loadAttr} onload="this.parentElement.classList.remove('loading')" onerror="this.parentElement.classList.remove('loading')">`;
    };
    return `
      <a href="/${escape(e.slug)}" class="card${featured ? ' card-featured' : ''}${e.comingSoon ? ' card-soon' : ''}">
        <div class="thumb${e.thumbnailUrl && !e.comingSoon ? ' loading' : ''}">
          ${e.comingSoon
            ? e.thumbnailUrl
              ? `${responsive('thumb-blur')}<div class="thumb-soon-ov">${iconClock()}</div><span class="soon-badge">em breve</span>`
              : `<div class="thumb-ph">${iconClock()}</div><span class="soon-badge">em breve</span>`
            : e.thumbnailUrl
              ? responsive('', isLCP ? 'loading="eager" fetchpriority="high"' : 'loading="lazy"')
              : `<div class="thumb-ph">${iconCamera()}</div>`}
          ${featured ? `<span class="featured-badge">Em destaque</span>` : ''}
        </div>
        <div class="info">
          ${e.date ? `<span class="date">${escape(formatDatePT(e.date))}</span>` : ''}
          <h2>${escape(e.title)}</h2>
          ${e.shortDescription ? `<p>${escape(e.shortDescription)}</p>` : ''}
        </div>
      </a>`;
  };

  const cards = visible.length === 0
    ? `<p class="empty">Em breve…</p>`
    : visible.map(cardHTML).join('');

  // Preload da imagem do LCP (primeiro card visível, com thumbnail e não "em breve").
  const lcp = visible[0];
  const lcpPreload = (lcp && lcp.thumbnailUrl && !lcp.comingSoon)
    ? `<link rel="preload" as="image" fetchpriority="high" imagesrcset="${escape(imgSrcset(lcp.thumbnailUrl, lcp.pinned ? FEAT_WIDTHS : CARD_WIDTHS, { crop: true }))}" imagesizes="${lcp.pinned ? FEAT_SIZES : CARD_SIZES}">`
    : '';

  return `<!DOCTYPE html>
<html lang="pt-BR">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <link rel="icon" type="image/svg+xml" href="/icon.svg">
  <link rel="apple-touch-icon" href="/icon.svg">
  <meta name="theme-color" content="#0a0a0a">
  <title>fotos · Luca F. Chala</title>
  <meta name="description" content="Galeria de fotos de Luca Fchala">
  <link rel="preconnect" href="https://lh3.googleusercontent.com" crossorigin>
  <link rel="dns-prefetch" href="https://lh3.googleusercontent.com">
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=Inter:ital,wght@0,300;0,400;0,500;0,600;1,300&display=swap" rel="stylesheet">
  ${lcpPreload}
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
    .thumb.loading{background:#181818}
    .thumb.loading::after{content:"";position:absolute;inset:0;background:linear-gradient(90deg,transparent,#ffffff14,transparent);transform:translateX(-100%);animation:shimmer 1.4s infinite}
    @keyframes shimmer{100%{transform:translateX(100%)}}
    .thumb.loading img{opacity:0}
    .thumb img{transition:opacity .25s ease}
    .soon-badge{position:absolute;top:.5rem;right:.5rem;background:rgba(0,0,0,.7);color:#c0a060;font-size:.6rem;font-weight:600;letter-spacing:.12em;text-transform:uppercase;padding:.25rem .55rem;border-radius:4px;border:1px solid rgba(192,160,96,.3);backdrop-filter:blur(4px);z-index:2}
    .thumb img{width:100%;height:100%;object-fit:cover;display:block;transition:transform .4s ease}
    .card:hover .thumb img{transform:scale(1.06)}
    .thumb-ph{width:100%;height:100%;display:flex;align-items:center;justify-content:center;color:#252525}
    .thumb-blur{filter:blur(8px);transform:scale(1.1);width:100%;height:100%;object-fit:cover;display:block}
    .thumb-soon-ov{position:absolute;inset:0;display:flex;align-items:center;justify-content:center;color:#555}
    .info{padding:.75rem .875rem 1rem}
    .date{font-size:.625rem;font-weight:500;letter-spacing:.1em;text-transform:uppercase;color:#8a8a8a}
    .info h2{font-size:.875rem;font-weight:600;margin:.25rem 0 .3rem;line-height:1.3}
    .info p{font-size:.75rem;color:#909090;line-height:1.5;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden}
    .card-featured{grid-column:1/-1}
    .card-featured .thumb{aspect-ratio:3/2}
    .featured-badge{position:absolute;top:.5rem;left:.5rem;background:rgba(240,235,229,.12);color:#f0ebe5;font-size:.6rem;font-weight:600;letter-spacing:.12em;text-transform:uppercase;padding:.25rem .55rem;border-radius:4px;border:1px solid rgba(240,235,229,.2);backdrop-filter:blur(4px);z-index:2}
    @media(min-width:900px){.card-featured{display:flex;flex-direction:row}.card-featured .thumb{aspect-ratio:unset;width:60%;flex-shrink:0;min-height:340px}.card-featured .info{flex:1;padding:1.75rem;display:flex;flex-direction:column;justify-content:center}.card-featured .info h2{font-size:1.1rem}.card-featured .info p{-webkit-line-clamp:4}}
    .empty{text-align:center;color:#333;padding:6rem 0;font-size:.875rem;letter-spacing:.06em}
    footer{text-align:center;padding:2rem 1rem;border-top:1px solid #141414;display:flex;align-items:center;justify-content:center;gap:1.5rem;flex-wrap:wrap}
    footer a{color:#808080;font-size:.75rem;text-decoration:none;letter-spacing:.12em;transition:color .2s}
    footer a:hover{color:#bbb}
    .support-link{display:inline-flex;align-items:center;gap:.4rem;color:#808080;font-size:.75rem;text-decoration:none;letter-spacing:.12em;transition:color .2s}
    .support-link:hover{color:#777}
    .support-link svg{width:13px;height:13px}
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
    <a href="/suporte" class="support-link">
      <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>
      Suporte
    </a>
  </footer>
  ${analyticsToken ? `<script defer src="https://static.cloudflareinsights.com/beacon.min.js" data-cf-beacon='${JSON.stringify({ token: String(analyticsToken) }).replace(/</g, '\\u003c')}'></script>` : ''}
</body>
</html>`;
}

function iconCamera() {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.25"><rect x="3" y="5" width="18" height="15" rx="2"/><circle cx="12" cy="12" r="4"/><path d="M9 5l1.5-2h3L15 5"/></svg>`;
}

function iconClock() {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.25"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>`;
}
