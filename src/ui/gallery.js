import { escape, formatDatePT, sortEvents, eventTime, sizedDriveThumb } from '../utils.js';

const SITE_URL = 'https://fotos.lucafchala.com';
const INITIAL = 12; // cards shown before "Carregar mais"

export function galleryHTML(events, analyticsToken) {
  const visible = sortEvents(events.filter(e => e.visible !== false));
  const pinned = visible.filter(e => e.pinned === true);
  const rest = visible.filter(e => e.pinned !== true);

  const yearOf = e => e.date ? e.date.slice(0, 4) : String(new Date(eventTime(e)).getFullYear());

  const cardHTML = (e, { hidden = false, featured = false } = {}) => {
    const width = featured ? 1600 : 600;
    const thumb = e.thumbnailUrl ? sizedDriveThumb(e.thumbnailUrl, width) : '';
    const title = escape((e.title || '').toLowerCase());
    const desc = escape((e.shortDescription || '').toLowerCase());
    const catLower = escape((e.category || '').toLowerCase());
    const cls = [
      'card',
      featured ? 'card-featured' : '',
      e.comingSoon ? 'card-soon' : '',
      hidden ? 'hidden' : '',
    ].filter(Boolean).join(' ');
    return `
      <a href="/${escape(e.slug)}" class="${cls}"${featured ? '' : ' data-card'} data-title="${title}" data-desc="${desc}" data-cat="${catLower}" data-year="${escape(yearOf(e))}">
        <div class="thumb${thumb && !e.comingSoon ? ' loading' : ''}">
          ${e.comingSoon
            ? thumb
              ? `<img src="${escape(thumb)}" alt="${escape(e.title)}" class="thumb-blur" loading="lazy"><div class="thumb-soon-ov">${iconClock()}</div><span class="soon-badge">em breve</span>`
              : `<div class="thumb-ph">${iconClock()}</div><span class="soon-badge">em breve</span>`
            : thumb
              ? `<img src="${escape(thumb)}" alt="${escape(e.title)}" loading="lazy" onload="this.parentElement.classList.remove('loading')" onerror="this.parentElement.classList.remove('loading')">`
              : `<div class="thumb-ph">${iconCamera()}</div>`}
          ${featured ? `<span class="featured-badge">Em destaque</span>` : ''}
        </div>
        <div class="info">
          ${e.date ? `<span class="date">${escape(formatDatePT(e.date))}</span>` : ''}
          <h2>${escape(e.title)}</h2>
          ${e.shortDescription ? `<p>${escape(e.shortDescription)}</p>` : ''}
          ${e.category ? `<span class="cat-tag">${escape(e.category)}</span>` : ''}
        </div>
      </a>`;
  };

  // Pinned cards first (full width, never counted toward the batch).
  const pinnedHTML = pinned.map(e => cardHTML(e, { featured: true })).join('');

  // Remaining cards, grouped by year. Cards beyond INITIAL start hidden, and a
  // year heading starts hidden when its first card is already beyond INITIAL.
  let idx = 0;
  let lastYear = null;
  const restNodes = [];
  for (const e of rest) {
    const y = yearOf(e);
    if (y !== lastYear) {
      lastYear = y;
      const headHidden = idx >= INITIAL;
      restNodes.push(`<h2 class="year-head${headHidden ? ' hidden' : ''}" data-year-head="${escape(y)}">${escape(y)}</h2>`);
    }
    restNodes.push(cardHTML(e, { hidden: idx >= INITIAL }));
    idx++;
  }

  const cards = visible.length === 0
    ? `<p class="empty">Em breve…</p>`
    : pinnedHTML + restNodes.join('');

  const presentCats = [...new Set(visible.map(e => e.category).filter(Boolean))]
    .sort((a, b) => a.localeCompare(b, 'pt-BR'));
  const showControls = visible.length > 0;
  const chipsHTML = presentCats.length > 0
    ? `<div class="chips" id="chips" role="group" aria-label="Filtrar por categoria">
        <button class="chip active" data-cat="all">Todos</button>
        ${presentCats.map(c => `<button class="chip" data-cat="${escape(c.toLowerCase())}">${escape(c)}</button>`).join('')}
      </div>`
    : '';
  const controlsHTML = showControls
    ? `<div class="controls-wrap">
        <div class="controls" role="search">
          <input type="search" id="search" class="search-input" placeholder="Buscar por título, descrição ou categoria…" aria-label="Buscar projetos" autocomplete="off">
          ${presentCats.length > 0 ? `<button type="button" id="filters-btn" class="filters-btn" aria-expanded="false">Filtros ▾</button>` : ''}
        </div>
        ${presentCats.length > 0 ? `<div class="chips-wrap" id="chips-wrap">${chipsHTML}</div>` : ''}
        <div class="filter-status" id="filter-status">
          <span id="result-count"></span>
          <button type="button" id="clear-filters" class="clear-filters">Limpar filtros</button>
        </div>
      </div>`
    : '';

  const ogImage = (() => {
    const e = visible.find(ev => ev.thumbnailUrl && !ev.comingSoon);
    return e ? sizedDriveThumb(e.thumbnailUrl, 1200) : '';
  })();

  const ldItems = visible.slice(0, 12).map((e, i) => ({
    '@type': 'ListItem',
    position: i + 1,
    url: `${SITE_URL}/${e.slug}`,
    name: e.title,
  }));
  const jsonLd = visible.length > 0
    ? JSON.stringify({
        '@context': 'https://schema.org',
        '@type': 'CollectionPage',
        name: 'fotos · Luca F. Chala',
        url: `${SITE_URL}/`,
        mainEntity: { '@type': 'ItemList', numberOfItems: ldItems.length, itemListElement: ldItems },
      }).replace(/</g, '\\u003c')
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
  <meta name="description" content="Galeria de fotos de Luca F. Chala">
  <link rel="canonical" href="${SITE_URL}/">
  <meta property="og:type" content="website">
  <meta property="og:title" content="fotos · Luca F. Chala">
  <meta property="og:description" content="Galeria de fotos de Luca F. Chala">
  <meta property="og:url" content="${SITE_URL}/">
  ${ogImage ? `<meta property="og:image" content="${escape(ogImage)}">` : ''}
  <meta name="twitter:card" content="${ogImage ? 'summary_large_image' : 'summary'}">
  ${jsonLd ? `<script type="application/ld+json">${jsonLd}</script>` : ''}
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link href="https://fonts.googleapis.com/css2?family=Inter:ital,wght@0,300;0,400;0,500;0,600;1,300&display=swap" rel="stylesheet">
  <style>
    *,*::before,*::after{box-sizing:border-box;margin:0;padding:0}
    :root{--bg-page:#0a0a0a;--bg-card:#111;--bg-card-border:#1c1c1c;--bg-input:#111;--bg-wrap:#0a0a0a;--text:#f0ebe5;--text-2:#c8c0b8;--text-muted:#777;--text-dim:#555;--text-ph:#444;--border-dim:#1a1a1a;--footer-link:#3a3a3a}
    body{font-family:'Inter',sans-serif;background:var(--bg-page);color:var(--text);min-height:100vh}
    body.light{--bg-page:#f0ece8;--bg-card:#fff;--bg-card-border:#ddd9d4;--bg-input:#fff;--bg-wrap:#f0ece8;--text:#1a1715;--text-2:#4a4744;--text-muted:#6b6460;--text-dim:#8a8480;--text-ph:#9a9490;--border-dim:#ddd9d4;--footer-link:#9a9490}
    :focus-visible{outline:2px solid #c0a060;outline-offset:2px}
    header{padding:2.5rem 1.5rem 1.5rem;text-align:center;position:relative}
    .logo{font-size:1rem;font-weight:300;letter-spacing:.25em;text-transform:lowercase;color:var(--text-2)}
    .logo strong{font-weight:600;color:var(--text)}
    .theme-toggle{position:absolute;right:1.25rem;top:50%;transform:translateY(-50%);background:none;border:1px solid var(--bg-card-border);color:var(--text-muted);border-radius:20px;padding:.35rem .8rem;font-size:.65rem;font-family:inherit;cursor:pointer;transition:border-color .2s,color .2s;display:inline-flex;align-items:center;gap:.35rem}
    .theme-toggle:hover{border-color:var(--text-dim);color:var(--text)}
    .theme-toggle .exp{font-size:.58rem;opacity:.45;font-style:italic}
    main{max-width:1280px;margin:0 auto;padding:.5rem 1rem 5rem}
    .controls-wrap{position:sticky;top:0;z-index:10;background:var(--bg-wrap);padding:.75rem 0 0}
    .controls{display:flex;flex-direction:row;align-items:center;gap:.75rem;padding-bottom:.75rem}
    .search-input{flex:1;min-width:0;max-width:340px;background:var(--bg-input);border:1px solid var(--bg-card-border);color:var(--text);padding:.7rem 1rem;border-radius:8px;font-size:.85rem;outline:none;transition:border-color .2s;-webkit-appearance:none}
    .search-input::placeholder{color:var(--text-ph)}
    .search-input:focus{border-color:#c0a060}
    .filters-btn{flex-shrink:0;background:var(--bg-card);border:1px solid var(--bg-card-border);color:var(--text-muted);padding:.45rem .9rem;border-radius:8px;font-size:.78rem;font-weight:500;cursor:pointer;transition:border-color .2s,color .2s;white-space:nowrap;font-family:inherit}
    .filters-btn:hover{border-color:var(--text-dim);color:var(--text-2)}
    .filters-btn.active{border-color:#c0a060;color:#c0a060}
    .chips-wrap{display:none;padding-bottom:.5rem}
    .chips-wrap.open{display:block}
    .chips{display:flex;gap:.5rem;flex-wrap:wrap}
    .chip{background:var(--bg-card);border:1px solid var(--bg-card-border);color:var(--text-muted);padding:.45rem .9rem;border-radius:20px;font-size:.72rem;font-weight:500;letter-spacing:.04em;cursor:pointer;transition:border-color .2s,color .2s,background .2s}
    .chip:hover{border-color:var(--text-dim);color:var(--text-2)}
    .chip.active{border-color:#c0a060;color:#c0a060;background:rgba(192,160,96,.08)}
    .filter-status{display:none;align-items:center;gap:.75rem;padding:.2rem 0 .7rem;font-size:.75rem;color:var(--text-muted)}
    .filter-status.show{display:flex}
    .result-count{flex:1}
    .clear-filters{background:none;border:none;color:#c0a060;font-size:.75rem;font-family:inherit;cursor:pointer;padding:0;text-decoration:underline;text-underline-offset:2px}
    .clear-filters:hover{color:#d4b070}
    .grid{display:grid;grid-template-columns:repeat(2,1fr);gap:.875rem;margin-top:.875rem}
    @media(min-width:560px){.grid{grid-template-columns:repeat(3,1fr);gap:1.125rem}}
    @media(min-width:900px){.grid{grid-template-columns:repeat(4,1fr);gap:1.5rem}}
    .year-head{grid-column:1/-1;font-size:.75rem;font-weight:500;letter-spacing:.18em;text-transform:uppercase;color:var(--text-dim);padding:1.5rem 0 .25rem;border-bottom:1px solid var(--border-dim);margin-bottom:.25rem}
    .card.hidden,.year-head.hidden{display:none}
    .card{display:block;text-decoration:none;color:inherit;border-radius:10px;overflow:hidden;background:var(--bg-card);border:1px solid var(--bg-card-border);transition:transform .2s ease,border-color .2s}
    .card:hover{transform:translateY(-4px);border-color:var(--text-dim)}
    .thumb{aspect-ratio:4/3;overflow:hidden;background:var(--bg-card);position:relative}
    .thumb.loading{background:linear-gradient(90deg,#181818 0%,#222 50%,#181818 100%);background-size:200% 100%;animation:shimmer 1.4s infinite linear}
    @keyframes shimmer{0%{background-position:200% 0}100%{background-position:-200% 0}}
    .thumb.loading img{opacity:0}
    .thumb img{transition:opacity .25s ease}
    .soon-badge{position:absolute;top:.5rem;right:.5rem;background:rgba(0,0,0,.7);color:#c0a060;font-size:.6rem;font-weight:600;letter-spacing:.12em;text-transform:uppercase;padding:.25rem .55rem;border-radius:4px;border:1px solid rgba(192,160,96,.3);backdrop-filter:blur(4px);z-index:2}
    .thumb img{width:100%;height:100%;object-fit:cover;display:block;transition:transform .4s ease}
    .card:hover .thumb img{transform:scale(1.06)}
    .thumb-ph{width:100%;height:100%;display:flex;align-items:center;justify-content:center;color:#252525}
    .thumb-blur{filter:blur(8px);transform:scale(1.1);width:100%;height:100%;object-fit:cover;display:block}
    .thumb-soon-ov{position:absolute;inset:0;display:flex;align-items:center;justify-content:center;color:#555}
    .info{padding:.75rem .875rem 1rem}
    .date{font-size:.625rem;font-weight:500;letter-spacing:.1em;text-transform:uppercase;color:var(--text-dim)}
    .info h2{font-size:.875rem;font-weight:600;margin:.25rem 0 .3rem;line-height:1.3}
    .info p{font-size:.75rem;color:var(--text-muted);line-height:1.5;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden}
    .cat-tag{display:inline-block;font-size:.58rem;font-weight:600;letter-spacing:.08em;text-transform:uppercase;color:#c0a060;background:rgba(192,160,96,.1);border:1px solid rgba(192,160,96,.2);border-radius:4px;padding:.15rem .45rem;margin-top:.4rem}
    .card-featured{grid-column:1/-1}
    .card-featured .thumb{aspect-ratio:3/2}
    .featured-badge{position:absolute;top:.5rem;left:.5rem;background:rgba(240,235,229,.12);color:#f0ebe5;font-size:.6rem;font-weight:600;letter-spacing:.12em;text-transform:uppercase;padding:.25rem .55rem;border-radius:4px;border:1px solid rgba(240,235,229,.2);backdrop-filter:blur(4px);z-index:2}
    @media(min-width:900px){.card-featured{display:flex;flex-direction:row}.card-featured .thumb{aspect-ratio:unset;width:60%;flex-shrink:0;min-height:340px}.card-featured .info{flex:1;padding:1.75rem;display:flex;flex-direction:column;justify-content:center}.card-featured .info h2{font-size:1.1rem}.card-featured .info p{-webkit-line-clamp:4}}
    .empty{text-align:center;color:var(--text-dim);padding:6rem 0;font-size:.875rem;letter-spacing:.06em}
    .load-more{display:block;margin:2.5rem auto 0;background:transparent;color:var(--text-2);border:1px solid var(--border-dim);border-radius:8px;padding:.7rem 1.6rem;font-family:inherit;font-size:.78rem;font-weight:500;letter-spacing:.12em;text-transform:lowercase;cursor:pointer;transition:border-color .2s,color .2s}
    .load-more:hover{border-color:var(--text-dim);color:var(--text)}
    footer{text-align:center;padding:2rem 1rem;border-top:1px solid var(--border-dim);display:flex;align-items:center;justify-content:center;gap:1.5rem;flex-wrap:wrap}
    footer a{color:var(--footer-link);font-size:.75rem;text-decoration:none;letter-spacing:.12em;transition:color .2s}
    footer a:hover{color:var(--text-muted)}
    .support-link{display:inline-flex;align-items:center;gap:.4rem;color:var(--footer-link);font-size:.75rem;text-decoration:none;letter-spacing:.12em;transition:color .2s}
    .support-link:hover{color:var(--text-muted)}
    .support-link svg{width:13px;height:13px}
    .cookie-notice{position:fixed;left:1rem;right:1rem;bottom:5rem;max-width:520px;margin:0 auto;background:#141414;border:1px solid #2a2a2a;border-radius:10px;padding:.875rem 1rem;display:none;align-items:center;gap:.875rem;font-size:.76rem;color:#999;line-height:1.5;z-index:80;box-shadow:0 8px 24px rgba(0,0,0,.4)}
    @media(min-width:560px){.cookie-notice{bottom:1rem}}
    .cookie-notice.show{display:flex}
    .cookie-notice a{color:#c0a060;text-decoration:none}
    .cookie-notice a:hover{text-decoration:underline}
    .cookie-notice button{flex-shrink:0;background:#f0ebe5;color:#0a0a0a;border:none;padding:.5rem 1rem;border-radius:7px;font-size:.74rem;font-weight:600;cursor:pointer;transition:opacity .18s}
    .cookie-notice button:hover{opacity:.85}
  </style>
</head>
<body>
  <header>
    <div class="logo">fotos · <strong>Luca F. Chala</strong></div>
    <button class="theme-toggle" id="theme-toggle" type="button" aria-label="Alternar modo claro/escuro">
      <span id="theme-icon">☀</span><span id="theme-label">claro</span><span class="exp">experimental</span>
    </button>
  </header>
  <main>
    ${controlsHTML}
    <div class="grid">${cards}</div>
    <p class="empty" id="no-results" style="display:none">Nenhum evento encontrado</p>
    ${rest.length > INITIAL ? `<button id="load-more" class="load-more">Carregar mais</button>` : ''}
  </main>
  <footer>
    <a href="https://instagram.com/lucafchala" target="_blank" rel="noopener">@lucafchala</a>
    <a href="/privacidade" class="support-link">
      <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg>
      Privacidade
    </a>
    <a href="/termos" class="support-link">
      <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="9" y1="13" x2="15" y2="13"/><line x1="9" y1="17" x2="13" y2="17"/></svg>
      Termos
    </a>
    <a href="/suporte" class="support-link">
      <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>
      Suporte
    </a>
  </footer>

  <div class="cookie-notice" id="cookie-notice">
    <span>Usamos cookies essenciais e medição anônima de acesso. <a href="/privacidade">Saiba mais</a>.</span>
    <button id="cookie-ok" type="button">Entendi</button>
  </div>

  <script>
    (function(){
      var BATCH = ${INITIAL};
      var shown = BATCH;
      var activeCat = 'all';
      var allCards = [].slice.call(document.querySelectorAll('.card'));
      var batchCards = allCards.filter(function(c){ return c.hasAttribute('data-card'); });
      var searchEl = document.getElementById('search');
      var loadMoreBtn = document.getElementById('load-more');
      var noResults = document.getElementById('no-results');
      var chips = document.getElementById('chips');
      var chipsWrap = document.getElementById('chips-wrap');
      var filtersBtn = document.getElementById('filters-btn');
      var filterStatus = document.getElementById('filter-status');
      var resultCount = document.getElementById('result-count');
      var clearFiltersBtn = document.getElementById('clear-filters');

      function updateFiltersBtn() {
        if (!filtersBtn) return;
        var active = activeCat !== 'all';
        filtersBtn.classList.toggle('active', active);
        filtersBtn.textContent = active ? 'Filtros · 1 ▾' : 'Filtros ▾';
        filtersBtn.setAttribute('aria-expanded', chipsWrap && chipsWrap.classList.contains('open') ? 'true' : 'false');
      }
      if (filtersBtn) filtersBtn.addEventListener('click', function() {
        if (chipsWrap) chipsWrap.classList.toggle('open');
        updateFiltersBtn();
      });

      function isFiltering(){
        return (searchEl && searchEl.value.trim() !== '') || activeCat !== 'all';
      }
      function matches(card, q){
        if (activeCat !== 'all' && card.getAttribute('data-cat') !== activeCat) return false;
        if (!q) return true;
        return (card.getAttribute('data-title') + ' ' + card.getAttribute('data-desc') + ' ' + card.getAttribute('data-cat')).indexOf(q) !== -1;
      }
      function syncHeadings(){
        var heads = document.querySelectorAll('[data-year-head]');
        for (var i = 0; i < heads.length; i++){
          var y = heads[i].getAttribute('data-year-head');
          var any = batchCards.some(function(c){ return c.getAttribute('data-year') === y && !c.classList.contains('hidden'); });
          heads[i].classList.toggle('hidden', !any);
        }
      }
      function apply(){
        var q = searchEl ? searchEl.value.trim().toLowerCase() : '';
        var filtering = isFiltering();
        var idx = 0, matchCount = 0;
        for (var i = 0; i < allCards.length; i++){
          var card = allCards[i], show;
          if (filtering){
            show = matches(card, q);
          } else if (card.hasAttribute('data-card')){
            show = idx < shown; idx++;
          } else {
            show = true;
          }
          card.classList.toggle('hidden', !show);
          if (show) matchCount++;
        }
        if (noResults) noResults.style.display = (filtering && matchCount === 0) ? '' : 'none';
        if (loadMoreBtn) loadMoreBtn.style.display = (!filtering && shown < batchCards.length) ? '' : 'none';
        if (filterStatus) {
          filterStatus.classList.toggle('show', filtering);
          if (filtering && resultCount) {
            resultCount.textContent = matchCount + ' projeto' + (matchCount !== 1 ? 's' : '') + ' encontrado' + (matchCount !== 1 ? 's' : '');
          }
        }
        syncHeadings();
      }

      if (searchEl) searchEl.addEventListener('input', function(){ shown = BATCH; apply(); });
      if (chips) chips.addEventListener('click', function(ev){
        var chip = ev.target.closest('[data-cat]');
        if (!chip) return;
        activeCat = chip.getAttribute('data-cat');
        var all = chips.querySelectorAll('.chip');
        for (var i = 0; i < all.length; i++) all[i].classList.toggle('active', all[i] === chip);
        shown = BATCH; apply(); updateFiltersBtn();
      });
      if (loadMoreBtn) loadMoreBtn.addEventListener('click', function(){ shown += BATCH; apply(); });
      if (clearFiltersBtn) clearFiltersBtn.addEventListener('click', function(){
        if (searchEl) searchEl.value = '';
        activeCat = 'all';
        if (chips) {
          var all = chips.querySelectorAll('.chip');
          for (var i = 0; i < all.length; i++) all[i].classList.toggle('active', all[i].getAttribute('data-cat') === 'all');
        }
        if (chipsWrap) chipsWrap.classList.remove('open');
        shown = BATCH; apply(); updateFiltersBtn();
      });
      apply();

      // Cookie / analytics notice (essential cookies + anonymous measurement)
      try {
        if (!localStorage.getItem('fotos:cookie_notice')) {
          var cn = document.getElementById('cookie-notice');
          if (cn) cn.classList.add('show');
        }
      } catch(_) {}
      var ck = document.getElementById('cookie-ok');
      if (ck) ck.addEventListener('click', function(){
        try { localStorage.setItem('fotos:cookie_notice', '1'); } catch(_) {}
        var cn = document.getElementById('cookie-notice');
        if (cn) cn.classList.remove('show');
      });

      // Light/dark theme toggle (experimental)
      var toggleBtn = document.getElementById('theme-toggle');
      var themeIcon = document.getElementById('theme-icon');
      var themeLabel = document.getElementById('theme-label');
      function setTheme(light){
        document.body.classList.toggle('light', light);
        if (themeIcon) themeIcon.textContent = light ? '☽' : '☀';
        if (themeLabel) themeLabel.textContent = light ? 'escuro' : 'claro';
        try { localStorage.setItem('fotos:theme', light ? 'light' : 'dark'); } catch(_) {}
      }
      try {
        if (localStorage.getItem('fotos:theme') === 'light') setTheme(true);
      } catch(_) {}
      if (toggleBtn) toggleBtn.addEventListener('click', function(){
        setTheme(!document.body.classList.contains('light'));
      });
    })();
  </script>
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
