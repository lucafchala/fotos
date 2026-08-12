import { escape, formatDatePT, sortEvents, eventTime, sizedDriveThumb, perfBootScript, footerLegalLinksHTML, updateBannerHTML } from '../utils.js';

const SITE_URL = 'https://fotos.lucafchala.com';
const INITIAL = 12; // cards shown before "Carregar mais"

export function galleryHTML(events, analyticsToken) {
  // getEvents() already filters junk entries, but this is the public homepage:
  // a single null/non-object here throws on `e.visible` and turns the whole
  // gallery into a 500. Second guard so the page degrades (skips the bad row)
  // no matter how the array was obtained.
  const safe = Array.isArray(events) ? events.filter(e => e && typeof e === 'object') : [];
  const visible = sortEvents(safe.filter(e => e.visible !== false));
  const pinned = visible.filter(e => e.pinned === true);
  const rest = visible.filter(e => e.pinned !== true);

  const yearOf = e => e.date ? e.date.slice(0, 4) : String(new Date(eventTime(e)).getFullYear());

  const cardHTML = (e, { hidden = false, featured = false } = {}) => {
    const width = featured ? 1600 : 600;
    const thumb = e.thumbnailUrl ? sizedDriveThumb(e.thumbnailUrl, width) : '';
    const title = escape((e.title || '').toLowerCase());
    const catLower = escape((e.category || '').toLowerCase());
    const cls = [
      'card',
      featured ? 'card-featured' : '',
      e.comingSoon ? 'card-soon' : '',
      hidden ? 'hidden' : '',
    ].filter(Boolean).join(' ');
    return `
      <a href="/${escape(e.slug)}" class="${cls}"${featured ? '' : ' data-card'} data-title="${title}" data-cat="${catLower}" data-year="${escape(yearOf(e))}">
        <div class="thumb${thumb && !e.comingSoon ? ' loading' : ''}"${thumb && !e.comingSoon ? ' aria-busy="true"' : ''}>
          ${e.comingSoon
            ? thumb
              ? `<img src="${escape(thumb)}" alt="${escape(e.title)}" class="thumb-blur" loading="lazy" decoding="async"><div class="thumb-soon-ov">${iconClock()}</div><span class="soon-badge">em breve</span>`
              : `<div class="thumb-ph">${iconClock()}</div><span class="soon-badge">em breve</span>`
            : thumb
              ? `<img src="${escape(thumb)}" alt="${escape(e.title)}" loading="lazy" decoding="async" onload="imgSettled(this,true)" onerror="imgSettled(this,false)">`
              : `<div class="thumb-ph">${iconCamera()}</div>`}
          ${featured ? `<span class="featured-badge">Em destaque</span>` : ''}
        </div>
        <div class="info">
          ${e.date ? `<span class="date">${escape(formatDatePT(e.date))}</span>` : ''}
          <h2>${escape(e.title)}</h2>
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
          <input type="search" id="search" class="search-input" placeholder="Buscar por título ou categoria…" aria-label="Buscar projetos" autocomplete="off">
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
    :root{
      --bg-page:#0a0a0a;--bg-card:#111;--bg-card-border:#1c1c1c;--bg-input:#111;--bg-wrap:#0a0a0a;
      --text:#f0ebe5;--text-2:#c8c0b8;--text-muted:#777;--text-dim:#555;--text-ph:#444;
      --border-dim:#1a1a1a;--footer-link:#888;--accent:#c0a060;--accent-hover:#d4b070;
      --cta-bg:#f0ebe5;--cta-text:#0a0a0a;
      --shimmer-a:#181818;--shimmer-b:#222;
      --banner-bg:#151208;--banner-border:#3a3320;--banner-text:#d8c89a;--banner-text-dim:#8a7a50;
    }
    @media (prefers-color-scheme: light) {
      :root{
        --bg-page:#f0ece8;--bg-card:#fff;--bg-card-border:#ddd9d4;--bg-input:#fff;--bg-wrap:#f0ece8;
        --text:#1a1715;--text-2:#4a4744;--text-muted:#6b6460;--text-dim:#8a8480;--text-ph:#9a9490;
        --border-dim:#ddd9d4;--footer-link:#6b6460;--accent:#8a6428;--accent-hover:#a67d38;
        --cta-bg:#1a1715;--cta-text:#faf7f3;
        --shimmer-a:#ececec;--shimmer-b:#f5f5f5;
        --banner-bg:#fdf3dc;--banner-border:#e8d1a0;--banner-text:#5c4310;--banner-text-dim:#a08a55;
      }
    }
    body{font-family:'Inter',sans-serif;background:var(--bg-page);color:var(--text);min-height:100vh}
    :focus-visible{outline:2px solid var(--accent);outline-offset:2px}
    .sr-only{position:absolute;width:1px;height:1px;padding:0;margin:-1px;overflow:hidden;clip:rect(0,0,0,0);white-space:nowrap;border:0}
    header{padding:2.5rem 1.5rem 1.5rem;text-align:center;position:relative}
    .logo{font-size:1rem;font-weight:300;letter-spacing:.25em;text-transform:lowercase;color:var(--text-2)}
    .logo strong{font-weight:600;color:var(--text)}
    main{max-width:1280px;margin:0 auto;padding:.5rem 1rem 5rem}
    .controls-wrap{position:sticky;top:0;z-index:10;background:var(--bg-wrap);padding:.75rem 0 0}
    .controls{display:flex;flex-direction:row;align-items:center;gap:.75rem;padding-bottom:.75rem}
    .search-input{flex:1;min-width:0;max-width:340px;background:var(--bg-input);border:1px solid var(--bg-card-border);color:var(--text);padding:.7rem 1rem;border-radius:8px;font-size:.85rem;outline:none;transition:border-color .2s;-webkit-appearance:none}
    .search-input::placeholder{color:var(--text-ph)}
    .search-input:focus{border-color:var(--accent)}
    .filters-btn{flex-shrink:0;background:var(--bg-card);border:1px solid var(--bg-card-border);color:var(--text-muted);padding:.45rem .9rem;border-radius:8px;font-size:.78rem;font-weight:500;cursor:pointer;transition:border-color .2s,color .2s;white-space:nowrap;font-family:inherit}
    .filters-btn:hover{border-color:var(--text-dim);color:var(--text-2)}
    .filters-btn.active{border-color:var(--accent);color:var(--accent)}
    .chips-wrap{display:none;padding-bottom:.5rem}
    .chips-wrap.open{display:block}
    .chips{display:flex;gap:.5rem;flex-wrap:wrap}
    .chip{background:var(--bg-card);border:1px solid var(--bg-card-border);color:var(--text-muted);padding:.45rem .9rem;border-radius:20px;font-size:.72rem;font-weight:500;letter-spacing:.04em;cursor:pointer;transition:border-color .2s,color .2s,background .2s}
    .chip:hover{border-color:var(--text-dim);color:var(--text-2)}
    .chip.active{border-color:var(--accent);color:var(--accent);background:rgba(192,160,96,.08)}
    .filter-status{display:none;align-items:center;gap:.75rem;padding:.2rem 0 .7rem;font-size:.8rem;color:var(--text-muted)}
    .filter-status.show{display:flex}
    .result-count{flex:1}
    .clear-filters{background:none;border:none;color:var(--accent);font-size:.75rem;font-family:inherit;cursor:pointer;padding:0;text-decoration:underline;text-underline-offset:2px}
    .clear-filters:hover{color:var(--accent-hover)}
    .grid{column-count:2;column-gap:.875rem;margin-top:.875rem}
    @media(min-width:560px){.grid{column-count:3;column-gap:1.125rem}}
    @media(min-width:900px){.grid{column-count:4;column-gap:1.5rem}}
    .year-head{column-span:all;font-size:.75rem;font-weight:500;letter-spacing:.18em;text-transform:uppercase;color:var(--text-dim);padding:1.5rem 0 .25rem;border-bottom:1px solid var(--border-dim);margin-bottom:.25rem}
    .card.hidden,.year-head.hidden{display:none}
    .card{display:block;text-decoration:none;color:inherit;border-radius:10px;overflow:hidden;background:var(--bg-card);border:1px solid var(--bg-card-border);transition:transform .2s ease,border-color .2s;break-inside:avoid;margin-bottom:.875rem}
    @media(min-width:560px){.card{margin-bottom:1.125rem}}
    @media(min-width:900px){.card{margin-bottom:1.5rem}}
    .card:hover{transform:translateY(-4px);border-color:var(--text-dim)}
    .thumb{overflow:hidden;background:var(--bg-card);position:relative;min-height:120px}
    .thumb.loading{background:linear-gradient(90deg,var(--shimmer-a) 0%,var(--shimmer-b) 50%,var(--shimmer-a) 100%);background-size:200% 100%;animation:shimmer 1.4s infinite linear}
    @keyframes shimmer{0%{background-position:200% 0}100%{background-position:-200% 0}}
    .thumb.loading img{opacity:0}
    .soon-badge{position:absolute;top:.5rem;right:.5rem;background:rgba(0,0,0,.7);color:#c0a060;font-size:.6rem;font-weight:600;letter-spacing:.12em;text-transform:uppercase;padding:.25rem .55rem;border-radius:4px;border:1px solid rgba(192,160,96,.3);backdrop-filter:blur(4px);z-index:2}
    /* Uma única regra de transition: declarar opacity e transform separadamente
       fazia a segunda sobrescrever a primeira (mesma especificidade), e a foto
       aparecia de estalo no lugar de surgir — o shimmer parecia travar. */
    .thumb img{width:100%;height:auto;display:block;transition:opacity .3s ease,transform .4s ease}
    .card:hover .thumb img{transform:scale(1.06)}
    /* Os dois estados de placeholder (sem foto real / capa borrada de "em breve")
       mantêm proporção fixa própria — não há foto de verdade ali para respeitar,
       e cada um precisa da própria altura já que o .thumb não força mais
       aspect-ratio (isso é o que deixa a miniatura real seguir a proporção
       verdadeira da foto, sem cortar retrato numa caixa de paisagem). */
    .thumb-ph{width:100%;aspect-ratio:4/3;min-height:140px;display:flex;align-items:center;justify-content:center;color:#252525}
    .thumb-blur{aspect-ratio:4/3;filter:blur(8px);transform:scale(1.1);width:100%;object-fit:cover;display:block}
    .thumb-soon-ov{position:absolute;inset:0;display:flex;align-items:center;justify-content:center;color:#555}
    .info{padding:1rem 1rem 1.125rem}
    .date{font-size:.625rem;font-weight:500;letter-spacing:.1em;text-transform:uppercase;color:var(--text-dim)}
    .info h2{font-size:1.05rem;font-weight:600;margin:.4rem 0 .5rem;line-height:1.3}
    .cat-tag{display:inline-block;font-size:.58rem;font-weight:600;letter-spacing:.08em;text-transform:uppercase;color:var(--accent);background:rgba(192,160,96,.1);border:1px solid rgba(192,160,96,.2);border-radius:4px;padding:.15rem .45rem;margin-top:.4rem}
    .card-featured{column-span:all;margin-bottom:.875rem}
    .card-featured .thumb{aspect-ratio:3/2}
    .featured-badge{position:absolute;top:.5rem;left:.5rem;background:rgba(240,235,229,.12);color:#f0ebe5;font-size:.6rem;font-weight:600;letter-spacing:.12em;text-transform:uppercase;padding:.25rem .55rem;border-radius:4px;border:1px solid rgba(240,235,229,.2);backdrop-filter:blur(4px);z-index:2}
    @media(min-width:900px){.card-featured{display:flex;flex-direction:row}.card-featured .thumb{aspect-ratio:unset;width:60%;flex-shrink:0;min-height:340px}.card-featured .info{flex:1;padding:1.75rem;display:flex;flex-direction:column;justify-content:center}.card-featured .info h2{font-size:1.35rem}}
    .empty{text-align:center;color:var(--text-dim);padding:6rem 0;font-size:.875rem;letter-spacing:.06em}
    .load-more{display:block;margin:2.5rem auto 0;background:transparent;color:var(--text-2);border:1px solid var(--border-dim);border-radius:8px;padding:.7rem 1.6rem;font-family:inherit;font-size:.78rem;font-weight:500;letter-spacing:.12em;text-transform:lowercase;cursor:pointer;transition:border-color .2s,color .2s}
    .load-more:hover{border-color:var(--text-dim);color:var(--text)}
    footer{text-align:center;padding:2rem 1rem;border-top:1px solid var(--border-dim);display:flex;align-items:center;justify-content:center;gap:1.5rem;flex-wrap:wrap}
    footer a{color:var(--footer-link);font-size:.8rem;text-decoration:none;letter-spacing:.12em;transition:color .2s}
    footer a:hover{color:var(--text)}
    .footer-actions-legal{display:flex;align-items:center;gap:1.25rem;flex-wrap:wrap;justify-content:center}
    .legal-link{display:inline-flex;align-items:center;gap:.4rem;color:var(--footer-link);font-size:.8rem;text-decoration:none;letter-spacing:.1em;transition:color .2s}
    .legal-link:hover{color:var(--text)}
    .footer-copyright{font-size:.75rem;color:var(--footer-link);letter-spacing:.03em;text-align:center;width:100%;order:99;margin-top:.75rem}
    .update-banner{background:var(--banner-bg);border-bottom:1px solid var(--banner-border);padding:.7rem 1.25rem;display:flex;align-items:center;justify-content:center;gap:.75rem;flex-wrap:wrap;font-size:.82rem;color:var(--banner-text);text-align:center}
    .update-banner a{color:var(--accent);text-decoration:underline;text-underline-offset:2px}
    .update-banner a:hover{color:var(--accent-hover)}
    .update-banner .ub-close{background:none;border:none;color:var(--banner-text-dim);cursor:pointer;font-size:1.1rem;line-height:1;padding:0 .25rem;flex-shrink:0}
    .update-banner .ub-close:hover{color:var(--banner-text)}
    .cookie-notice{position:fixed;left:1rem;right:1rem;bottom:5rem;max-width:520px;margin:0 auto;background:var(--bg-card);border:1px solid var(--bg-card-border);border-radius:10px;padding:.875rem 1rem;display:none;align-items:center;gap:.875rem;font-size:.76rem;color:var(--text-muted);line-height:1.5;z-index:80;box-shadow:0 8px 24px rgba(0,0,0,.4)}
    @media(min-width:560px){.cookie-notice{bottom:1rem}}
    .cookie-notice.show{display:flex}
    .cookie-notice a{color:var(--accent);text-decoration:none}
    .cookie-notice a:hover{text-decoration:underline}
    .cookie-notice button{flex-shrink:0;background:var(--cta-bg);color:var(--cta-text);border:none;padding:.5rem 1rem;border-radius:7px;font-size:.74rem;font-weight:600;cursor:pointer;transition:opacity .18s}
    .cookie-notice button:hover{opacity:.85}
  </style>
  ${perfBootScript('gallery', !!analyticsToken)}
</head>
<body>
  ${updateBannerHTML()}
  <header>
    <div class="logo">fotos · <strong>Luca F. Chala</strong></div>
  </header>
  <main>
    <h1 class="sr-only">Galeria de fotos</h1>
    ${controlsHTML}
    <div class="grid">${cards}</div>
    <p class="empty" id="no-results" style="display:none">Nenhum evento encontrado</p>
    ${rest.length > INITIAL ? `<button id="load-more" class="load-more">Carregar mais</button>` : ''}
  </main>
  <footer>
    <a href="https://instagram.com/lucafchala" target="_blank" rel="noopener">@lucafchala</a>
    ${footerLegalLinksHTML()}
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
        return (card.getAttribute('data-title') + ' ' + card.getAttribute('data-cat')).indexOf(q) !== -1;
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
        var _t0 = performance.now();
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
        // Pior caso da sessão: é o filtro lento que o usuário sente, não a média.
        if (window.perfMark) {
          var _d = Math.round(performance.now() - _t0);
          var _p = window.__perf;
          if (_p && (_p.marks.filterMs === null || _d > _p.marks.filterMs)) window.perfMark('filterMs', _d);
        }
        syncURL();
      }

      // Reflects q/cat into the URL (no reload) so a normal Back navigation
      // lands on a URL that already encodes the filter state — read back by
      // the restore block below on load.
      function syncURL() {
        try {
          var p = new URLSearchParams();
          var q = searchEl ? searchEl.value.trim() : '';
          if (q) p.set('q', q);
          if (activeCat !== 'all') p.set('cat', activeCat);
          var qs = p.toString();
          history.replaceState(null, '', location.pathname + (qs ? '?' + qs : ''));
        } catch(_) {}
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

      // Restore search/category from the URL (set by syncURL() before a
      // navigation away) and shown/scroll from sessionStorage — together these
      // put a visitor back where they left off after Back from an event page.
      var GSTATE_KEY = 'fotos:gallery_state';
      var savedY = null;
      try {
        var qp = new URLSearchParams(location.search);
        var qVal = qp.get('q'), catVal = qp.get('cat');
        if (qVal && searchEl) searchEl.value = qVal;
        if (catVal && chips) {
          var chipEls = chips.querySelectorAll('.chip'), found = null;
          for (var ci = 0; ci < chipEls.length; ci++) {
            if (chipEls[ci].getAttribute('data-cat') === catVal) found = chipEls[ci];
          }
          if (found) {
            activeCat = catVal;
            for (var cj = 0; cj < chipEls.length; cj++) chipEls[cj].classList.toggle('active', chipEls[cj] === found);
            if (chipsWrap) chipsWrap.classList.add('open');
          }
        }
      } catch(_) {}
      try {
        var raw = sessionStorage.getItem(GSTATE_KEY);
        if (raw) {
          var saved = JSON.parse(raw);
          if (saved && typeof saved.n === 'number' && saved.n > shown) shown = saved.n;
          if (saved && typeof saved.y === 'number') savedY = saved.y;
        }
      } catch(_) {}
      updateFiltersBtn();
      apply();
      if (savedY !== null) {
        requestAnimationFrame(function(){ requestAnimationFrame(function(){ scrollTo(0, savedY); }); });
      }

      function saveGalleryState() {
        try { sessionStorage.setItem(GSTATE_KEY, JSON.stringify({ n: shown, y: scrollY || document.documentElement.scrollTop })); } catch(_) {}
      }
      addEventListener('visibilitychange', function(){ if (document.visibilityState === 'hidden') saveGalleryState(); });
      addEventListener('pagehide', saveGalleryState);
      try { if ('scrollRestoration' in history) history.scrollRestoration = 'manual'; } catch(_) {}

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

      // New-interface banner (dismiss remembered per visitor)
      try {
        if (localStorage.getItem('fotos:update_banner_dismissed')) {
          var ub0 = document.getElementById('update-banner');
          if (ub0) ub0.style.display = 'none';
        }
      } catch(_) {}
      var ubClose = document.getElementById('update-banner-close');
      if (ubClose) ubClose.addEventListener('click', function(){
        try { localStorage.setItem('fotos:update_banner_dismissed', '1'); } catch(_) {}
        var ub = document.getElementById('update-banner');
        if (ub) ub.style.display = 'none';
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
