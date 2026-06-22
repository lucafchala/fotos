import { escape, formatDatePT, sizedDriveThumb, TERMS_VERSION, CONSENT_LABEL, ACCESS_DECLARATIONS } from '../utils.js';

const SITE_URL = 'https://fotos.lucafchala.com';

export function eventHTML(event, analyticsToken) {
  // Category-specific self-declaration required at the gateway, on top of the Terms
  // acceptance. Empty for 'public' (and any legacy event without accessType).
  const declaration = ACCESS_DECLARATIONS[event.accessType] || '';
  const photos = (Array.isArray(event.photos) && event.photos.length > 0)
    ? event.photos.filter(Boolean)
    : (event.thumbnailUrl ? [event.thumbnailUrl] : []);

  // Teasers, not downloads — request right-sized Drive thumbnails so the page loads fast.
  const displayPhotos = photos.map(u => sizedDriveThumb(u, 1600));

  const photosJSON  = JSON.stringify(displayPhotos).replace(/</g, '\\u003c').replace(/>/g, '\\u003e');
  const driveJSON   = JSON.stringify(event.driveUrl || '');
  const driveIgJSON = JSON.stringify(event.driveUrlInstagram || '');
  const slugJSON    = JSON.stringify(event.slug || '');
  const ogImage     = event.comingSoon
    ? `${SITE_URL}/og-coming-soon.png`
    : (photos[0] ? sizedDriveThumb(photos[0], 1200) : '');

  // Banner de novas fotos
  const alert = event.photosAlert;
  const showBanner = alert && alert.active && (() => {
    if (!alert.expiresAfterHours) return true;
    return Date.now() < new Date(alert.addedAt).getTime() + alert.expiresAfterHours * 3600000;
  })();
  const alertAddedAtJSON  = JSON.stringify(showBanner ? (alert.addedAt || '') : '');
  const alertExpiresJSON  = JSON.stringify(showBanner && alert.expiresAfterHours
    ? new Date(new Date(alert.addedAt).getTime() + alert.expiresAfterHours * 3600000).toISOString()
    : null);

  const heroHTML = event.comingSoon
    ? photos.length > 0
      ? `<div class="hero"><img src="${escape(displayPhotos[0])}" alt="${escape(event.title)}" class="hero-blur-img" fetchpriority="high" onerror="this.style.opacity='0'"><div class="hero-soon-ov">${clockIcon(56)}<span>Em breve</span></div></div>`
      : `<div class="hero"><div class="hero-ph hero-soon">${clockIcon(56)}<span>Em breve</span></div></div>`
    : photos.length === 0
      ? `<div class="hero"><div class="hero-ph">${camIcon(48)}</div></div>`
      : photos.length === 1
        ? `<div class="hero"><img src="${escape(displayPhotos[0])}" alt="${escape(event.title)}" fetchpriority="high" onerror="this.style.opacity='0'"></div>`
        : `<div class="carousel" id="carousel">
          <img id="c-img" src="${escape(displayPhotos[0])}" alt="${escape(event.title)}" fetchpriority="high" onload="this.style.opacity='1'" onerror="this.style.opacity='0'">
          <button class="c-btn c-prev" onclick="cGo(-1)" aria-label="Anterior">
            <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="15 18 9 12 15 6"/></svg>
          </button>
          <button class="c-btn c-next" onclick="cGo(1)" aria-label="Próxima">
            <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="9 18 15 12 9 6"/></svg>
          </button>
          <div class="c-dots">${photos.map((_, i) => `<span class="c-dot${i === 0 ? ' on' : ''}" onclick="cGoto(${i})"></span>`).join('')}</div>
          <div class="c-count" id="c-count">1 / ${photos.length}</div>
          <div class="swipe-hint" id="swipe-hint">deslize ←→</div>
        </div>`;

  return `<!DOCTYPE html>
<html lang="pt-BR">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <link rel="icon" type="image/svg+xml" href="/icon.svg">
  <link rel="apple-touch-icon" href="/icon.svg">
  <meta name="theme-color" content="#0a0a0a">
  <title>${escape(event.title)} · fotos</title>
  <link rel="canonical" href="${SITE_URL}/${escape(event.slug)}">
  <meta property="og:title" content="${escape(event.title)}">
  <meta property="og:description" content="${escape(event.shortDescription || '')}">
  ${ogImage ? `<meta property="og:image" content="${escape(ogImage)}">` : ''}
  <meta property="og:type" content="website">
  <meta property="og:url" content="${SITE_URL}/${escape(event.slug)}">
  <meta name="twitter:card" content="${ogImage ? 'summary_large_image' : 'summary'}">
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://drive.google.com">
  <link rel="preconnect" href="https://lh3.googleusercontent.com">
  <link href="https://fonts.googleapis.com/css2?family=Inter:ital,wght@0,300;0,400;0,500;0,600;1,400&display=swap" rel="stylesheet">
  <style>
    *,*::before,*::after{box-sizing:border-box;margin:0;padding:0}
    body{font-family:'Inter',sans-serif;background:#0a0a0a;color:#f0ebe5;min-height:100vh}
    :focus-visible{outline:2px solid #c0a060;outline-offset:2px}
    header{padding:1.25rem 1.5rem}
    .back{display:inline-flex;align-items:center;gap:.35rem;text-decoration:none;color:#555;font-size:.78rem;letter-spacing:.04em;transition:color .2s}
    .back:hover{color:#bbb}
    .back svg{width:14px;height:14px}
    /* hero */
    .hero{width:100%;max-height:72vh;overflow:hidden;background:#0e0e0e;position:relative}
    .hero img{width:100%;max-height:72vh;aspect-ratio:3/2;object-fit:cover;display:block;transition:opacity .25s ease}
    .hero-blur-img{width:100%;max-height:72vh;aspect-ratio:3/2;object-fit:cover;display:block;filter:blur(16px);transform:scale(1.08)}
    .hero-soon-ov{position:absolute;inset:0;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:1rem;color:#3a3a3a}
    .hero-soon-ov span{font-size:.78rem;letter-spacing:.22em;text-transform:uppercase;color:#888;font-weight:500}
    .hero-ph{height:260px;display:flex;align-items:center;justify-content:center;color:#333}
    .hero-soon{flex-direction:column;gap:1rem;color:#3a3a3a;height:320px}
    .hero-soon span{font-size:.78rem;letter-spacing:.22em;text-transform:uppercase;color:#666;font-weight:500}
    .btn-soon{background:#141414;color:#888;border:1px dashed #2e2e2e;cursor:default}
    .btn-soon:hover{background:#141414;transform:none}
    /* carousel */
    .carousel{position:relative;width:100%;max-height:72vh;overflow:hidden;background:#0e0e0e;user-select:none;-webkit-user-select:none}
    .carousel img{width:100%;max-height:72vh;aspect-ratio:3/2;object-fit:cover;display:block;transition:opacity .25s ease}
    .c-btn{position:absolute;top:50%;transform:translateY(-50%);background:rgba(0,0,0,.55);border:none;color:#fff;width:44px;height:44px;border-radius:50%;display:flex;align-items:center;justify-content:center;cursor:pointer;z-index:2;transition:background .2s;backdrop-filter:blur(2px)}
    .c-btn:hover{background:rgba(0,0,0,.8)}
    .c-prev{left:.75rem}.c-next{right:.75rem}
    .c-dots{position:absolute;bottom:2.5rem;left:50%;transform:translateX(-50%);display:flex;gap:.4rem;z-index:2}
    .c-dot{width:6px;height:6px;border-radius:50%;background:rgba(255,255,255,.3);background-clip:content-box;box-sizing:content-box;padding:5px;cursor:pointer;transition:background .2s}
    .c-dot.on{background:#fff;background-clip:content-box}
    .c-count{position:absolute;bottom:.75rem;right:.875rem;font-size:.7rem;font-weight:500;color:rgba(255,255,255,.5);background:rgba(0,0,0,.4);padding:.2rem .5rem;border-radius:20px;backdrop-filter:blur(4px)}
    .swipe-hint{position:absolute;bottom:.75rem;left:.875rem;font-size:.7rem;color:rgba(255,255,255,.6);background:rgba(0,0,0,.4);padding:.2rem .5rem;border-radius:20px;backdrop-filter:blur(4px);opacity:0;transition:opacity .4s;pointer-events:none;z-index:2}
    .swipe-hint.show{opacity:1}
    /* content */
    main{max-width:680px;margin:0 auto;padding:2.25rem 1.5rem 6rem}
    .meta{margin-bottom:.875rem}
    .date-chip{font-size:.65rem;font-weight:500;letter-spacing:.12em;text-transform:uppercase;color:#555}
    h1{font-size:clamp(1.5rem,6vw,2.25rem);font-weight:600;line-height:1.15;margin:.4rem 0 1.75rem}
    .desc{font-size:.95rem;line-height:1.85;color:#bbb;white-space:pre-wrap;word-break:break-word;margin-bottom:2.75rem}
    .drive-wrap{margin-bottom:3rem}
    .btn-drive{display:inline-flex;align-items:center;gap:.65rem;background:#f0ebe5;color:#0a0a0a;border:none;padding:.9rem 1.6rem;border-radius:9px;font-size:.9rem;font-weight:600;letter-spacing:.02em;cursor:pointer;transition:background .18s,transform .15s;width:100%;justify-content:center}
    @media(min-width:400px){.btn-drive{width:auto}}
    .btn-drive:hover{background:#fff;transform:translateY(-2px)}
    .btn-drive svg{width:18px;height:18px;flex-shrink:0}
    /* sticky mobile CTA */
    .sticky-cta{display:none}
    .sticky-cta svg{width:16px;height:16px;flex-shrink:0}
    @media(max-width:559px){
      .sticky-cta{display:flex;align-items:center;justify-content:center;gap:.5rem;position:fixed;left:1rem;right:1rem;bottom:1rem;z-index:40;background:#f0ebe5;color:#0a0a0a;border:none;padding:.85rem;border-radius:10px;font-size:.875rem;font-weight:600;cursor:pointer;box-shadow:0 8px 24px rgba(0,0,0,.5);transform:translateY(160%);transition:transform .25s ease}
      .sticky-cta.show{transform:translateY(0)}
    }
    .drive-note{font-size:.75rem;color:#555;margin-bottom:.875rem;line-height:1.5}
    /* credits */
    .credits{border-top:1px solid #191919;padding-top:2.25rem}
    .credits-title{font-size:.65rem;font-weight:500;letter-spacing:.14em;text-transform:uppercase;color:#3a3a3a;margin-bottom:1rem}
    .credits-list{display:flex;flex-direction:column;gap:.5rem}
    .credits-list a,.credits-list span{font-size:.85rem;line-height:1.5;color:#666;text-decoration:none;transition:color .2s;display:block}
    .credits-list a:hover{color:#bbb}
    .credits-note{font-size:.78rem;color:#3a5a3a;margin-top:.875rem;padding:.625rem .875rem;background:#0a140a;border:1px solid #162016;border-radius:7px;line-height:1.55}
    /* banner */
    .photos-banner{background:#0d1a0d;border-bottom:1px solid #1a3a1a;padding:.75rem 1.5rem;display:flex;align-items:center;justify-content:center;gap:.625rem}
    .banner-inner{display:flex;align-items:center;gap:.5rem;font-size:.82rem;color:#8ac88a;max-width:680px;width:100%}
    .banner-dot{width:7px;height:7px;border-radius:50%;background:#5aaa5a;flex-shrink:0;animation:pulse 2s infinite}
    @keyframes pulse{0%,100%{opacity:1}50%{opacity:.4}}
    .banner-text strong{color:#a8d8a8}
    .banner-time{color:#6aaa6a}
    /* footer */
    footer{padding:2rem 1.5rem 3rem;border-top:1px solid #111;margin-top:2rem;display:flex;flex-direction:column;align-items:center;gap:1.25rem}
    @media(min-width:560px){footer{flex-direction:row;justify-content:space-between;align-items:center}}
    .footer-brand{color:#2e2e2e;font-size:.75rem;text-decoration:none;letter-spacing:.1em;transition:color .2s;flex-shrink:0}
    .footer-brand:hover{color:#666}
    .footer-actions{display:flex;align-items:center;gap:.5rem;flex-wrap:wrap;justify-content:center}
    .removal-link{display:inline-flex;align-items:center;gap:.5rem;background:none;border:1px solid #2a2a2a;color:#888;padding:.6rem 1.1rem;border-radius:8px;font-size:.78rem;font-weight:500;cursor:pointer;letter-spacing:.02em;transition:border-color .2s,color .2s,background .2s;white-space:nowrap;text-decoration:none}
    .removal-link:hover{border-color:#555;color:#ccc;background:#111}
    .removal-link svg{width:13px;height:13px;flex-shrink:0}
    .whatsapp-link{display:inline-flex;align-items:center;gap:.5rem;background:none;border:1px solid #1a2e1a;color:#4a8a4a;padding:.6rem 1.1rem;border-radius:8px;font-size:.78rem;font-weight:500;letter-spacing:.02em;transition:border-color .2s,color .2s,background .2s;white-space:nowrap;text-decoration:none}
    .whatsapp-link:hover{border-color:#2a4a2a;color:#6aaa6a;background:#0a120a}
    /* shared modal base */
    .modal-ov{position:fixed;inset:0;background:rgba(0,0,0,.82);z-index:50;display:none;align-items:flex-end;justify-content:center}
    .modal-ov.open{display:flex}
    @media(min-width:580px){.modal-ov{align-items:center;padding:1.5rem}}
    .modal-sheet{background:#0d0d0d;width:100%;max-width:500px;border-radius:18px 18px 0 0;max-height:92vh;max-height:92dvh;overflow-y:auto;overscroll-behavior:contain;-webkit-overflow-scrolling:touch;padding:1.5rem 1.5rem max(3rem,calc(2rem + env(safe-area-inset-bottom)))}
    @media(min-width:580px){.modal-sheet{border-radius:14px;max-height:90vh;max-height:90dvh;padding-bottom:2.25rem}}
    .modal-head{display:flex;align-items:center;justify-content:space-between;margin-bottom:1.5rem}
    .modal-head h2{font-size:.975rem;font-weight:600}
    .m-close{background:none;border:1px solid #222;color:#555;width:32px;height:32px;border-radius:50%;display:flex;align-items:center;justify-content:center;cursor:pointer;flex-shrink:0;transition:border-color .2s,color .2s}
    .m-close:hover{border-color:#444;color:#ccc}
    /* drive modal */
    .guide-title{font-size:.65rem;font-weight:600;letter-spacing:.12em;text-transform:uppercase;color:#555;margin-bottom:.875rem}
    .steps{display:flex;flex-direction:column;gap:.625rem;padding-left:0;list-style:none;counter-reset:step}
    .steps li{counter-increment:step;display:grid;grid-template-columns:1.4rem 1fr;gap:.5rem;font-size:.82rem;color:#999;line-height:1.55}
    .steps li::before{content:counter(step);font-size:.65rem;font-weight:600;color:#555;background:#1a1a1a;width:1.35rem;height:1.35rem;border-radius:50%;display:flex;align-items:center;justify-content:center;flex-shrink:0;margin-top:.15rem}
    .steps li strong{color:#d0d0d0}
    .steps li kbd{background:#1e1e1e;border:1px solid #2d2d2d;padding:.1em .4em;border-radius:4px;font-size:.8em;font-family:inherit;color:#bbb}
    .drive-verifying{display:flex;align-items:center;gap:.5rem;color:#888;font-size:.8rem;margin-top:1rem}
    .spin{width:14px;height:14px;border:2px solid #2a2a2a;border-top-color:#999;border-radius:50%;animation:spin .7s linear infinite;flex-shrink:0}
    @keyframes spin{to{transform:rotate(360deg)}}
    .drive-consent{display:flex;align-items:flex-start;gap:.5rem;cursor:pointer;margin-top:1.25rem;font-size:.8rem;color:#bbb;line-height:1.5}
    .drive-consent input{width:18px;height:18px;accent-color:#c0a060;flex-shrink:0;margin-top:1px}
    .drive-consent a{color:#c0a060}
    .drive-name-toggle{background:none;border:none;color:#666;font-size:.74rem;cursor:pointer;margin-top:.625rem;padding:0;text-decoration:underline}
    .drive-name-toggle:hover{color:#999}
    .drive-consent-note{font-size:.68rem;color:#444;line-height:1.5;margin-top:.875rem}
    .drive-consent-note a{color:#666}
    .drive-locked{opacity:.4;pointer-events:none;filter:grayscale(.3)}
    .btn-drive-go{display:flex;align-items:center;justify-content:center;gap:.65rem;background:#f0ebe5;color:#0a0a0a;border:none;padding:.875rem 1.5rem;border-radius:9px;font-size:.875rem;font-weight:600;cursor:pointer;margin-top:1rem;width:100%;text-decoration:none;transition:background .18s,transform .15s}
    .btn-drive-go:hover{background:#fff;transform:translateY(-1px)}
    .btn-drive-go svg{width:18px;height:18px;flex-shrink:0}
    .drive-opts{display:flex;flex-direction:column;gap:.5rem;margin-top:1rem}
    .btn-drive-opt{display:flex;align-items:center;gap:.875rem;background:#111;border:1px solid #252525;color:#f0ebe5;padding:.9rem 1.1rem;border-radius:10px;text-decoration:none;transition:border-color .18s,background .18s;width:100%}
    .btn-drive-opt:hover{border-color:#3a3a3a;background:#161616}
    .btn-drive-opt svg{width:20px;height:20px;flex-shrink:0;color:#888}
    .drive-opt-text{display:flex;flex-direction:column;gap:.15rem}
    .drive-opt-text strong{font-size:.875rem;font-weight:600;color:#f0ebe5}
    .drive-opt-text span{font-size:.72rem;color:#666;font-weight:400}
    /* removal modal */
    .rem-intro{font-size:.875rem;color:#888;line-height:1.6;margin-bottom:1.5rem}
    .rem-field{display:flex;flex-direction:column;gap:.45rem;margin-bottom:1.125rem}
    .rem-field label{font-size:.7rem;font-weight:500;letter-spacing:.08em;text-transform:uppercase;color:#555}
    .rem-field input[type=text],.rem-field input[type=email],.rem-field input[type=tel],.rem-field input[type=url],.rem-field input[type=number],.rem-field textarea{width:100%;background:#141414;border:1px solid #222;color:#f0ebe5;padding:.75rem .875rem;border-radius:8px;font-size:.875rem;outline:none;transition:border-color .2s;-webkit-appearance:none}
    .rem-field input:focus,.rem-field textarea:focus{border-color:#3a3a3a}
    .rem-field input.bad,.rem-field textarea.bad{border-color:#7a2a2a}
    .rem-field textarea{resize:vertical;min-height:80px;line-height:1.5}
    .rem-field input[type=file]{color:#888;font-size:.8rem;width:100%}
    .radio-group{display:flex;flex-direction:column;gap:.5rem}
    .radio-opt{display:flex;align-items:center;gap:.625rem;cursor:pointer;padding:.5rem .75rem;border:1px solid #1e1e1e;border-radius:8px;transition:border-color .2s;min-height:44px}
    .radio-opt:has(input:checked){border-color:#3a3a3a;background:#111}
    .radio-opt input[type=radio]{width:16px;height:16px;accent-color:#f0ebe5;flex-shrink:0}
    .radio-opt span{font-size:.875rem;color:#bbb}
    .form-error{background:#1a0a0a;border:1px solid #2e1a1a;color:#cc8888;padding:.6rem .8rem;border-radius:8px;font-size:.78rem;line-height:1.5;margin-top:1rem}
    .rem-sheet-foot{display:flex;gap:.75rem;margin-top:1.25rem;position:sticky;bottom:0;background:#0d0d0d;padding:.875rem 0 .25rem;border-top:1px solid #161616}
    .btn-rem-cancel{flex:1;background:none;border:1px solid #222;color:#888;padding:.8rem;border-radius:8px;font-size:.875rem;font-weight:500;cursor:pointer;transition:border-color .2s}
    .btn-rem-cancel:hover{border-color:#3a3a3a}
    .btn-rem-submit{flex:2;background:#f0ebe5;color:#0a0a0a;border:none;padding:.8rem;border-radius:8px;font-size:.875rem;font-weight:600;cursor:pointer;transition:opacity .18s}
    .btn-rem-submit:disabled{opacity:.5;cursor:not-allowed}
    .btn-rem-submit:not(:disabled):hover{opacity:.88}
    .rem-success{text-align:center;padding:2rem 0;color:#7ec87e;font-size:.9rem;line-height:1.7}
    .rem-success svg{margin-bottom:.75rem;color:#5aaa5a}
    /* cookie notice */
    .cookie-notice{position:fixed;left:1rem;right:1rem;bottom:1rem;max-width:520px;margin:0 auto;background:#141414;border:1px solid #2a2a2a;border-radius:10px;padding:.875rem 1rem;display:none;align-items:center;gap:.875rem;font-size:.76rem;color:#999;line-height:1.5;z-index:80;box-shadow:0 8px 24px rgba(0,0,0,.4)}
    .cookie-notice.show{display:flex}
    .cookie-notice a{color:#c0a060;text-decoration:none}
    .cookie-notice a:hover{text-decoration:underline}
    .cookie-notice button{flex-shrink:0;background:#f0ebe5;color:#0a0a0a;border:none;padding:.5rem 1rem;border-radius:7px;font-size:.74rem;font-weight:600;cursor:pointer;transition:opacity .18s}
    .cookie-notice button:hover{opacity:.85}
    @media (prefers-reduced-motion: reduce){
      *,*::before,*::after{animation-duration:.001ms !important;animation-iteration-count:1 !important;transition-duration:.001ms !important;scroll-behavior:auto !important}
      .banner-dot{animation:none}
      .btn-drive:hover,.btn-drive-go:hover{transform:none}
    }
  </style>
</head>
<body>
  ${showBanner ? `<div class="photos-banner" id="photos-banner">
    <div class="banner-inner">
      <span class="banner-dot"></span>
      <span class="banner-text"><strong>Novas fotos adicionadas</strong> <span class="banner-time" id="banner-time"></span></span>
    </div>
  </div>` : ''}

  <header>
    <a href="/" class="back">
      <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><polyline points="15 18 9 12 15 6"/></svg>
      todos os projetos
    </a>
  </header>

  ${heroHTML}

  <main>
    <div class="meta">
      ${event.date ? `<span class="date-chip">${escape(formatDatePT(event.date))}</span>` : ''}
    </div>
    <h1>${escape(event.title)}</h1>
    ${event.longDescription ? `<div class="desc">${escape(event.longDescription)}</div>` : ''}

    <div class="drive-wrap">
      ${event.comingSoon
        ? `<div class="btn-drive btn-soon">
            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>
            As fotos virão em breve
          </div>`
        : `<button class="btn-drive" onclick="openModal()">
            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><rect x="3" y="3" width="18" height="18" rx="2"/><path d="M9 3v18M15 3v18M3 9h18M3 15h18" stroke-width="1.2"/></svg>
            Acessar fotos
          </button>`}
    </div>

    <div class="credits">
      <div class="credits-title">Créditos</div>
      <div class="credits-list">
        <a href="https://instagram.com/lucafchala" target="_blank" rel="noopener">📷 Fotografias: @lucafchala</a>
        ${event.eventCredits ? `<span>${escape(event.eventCredits)}</span>` : ''}
        ${event.projectUrl ? `<a href="${escape(event.projectUrl)}" target="_blank" rel="noopener">🔗 ${escape(event.projectUrl)}</a>` : ''}
      </div>
      <div class="credits-note">Ao postar as fotos, marque sempre <strong>@lucafchala</strong> 📸 — isso valoriza o trabalho e incentiva novos projetos.</div>
    </div>
  </main>

  <footer>
    <a href="/" class="footer-brand">fotos · Luca F. Chala</a>
    <div class="footer-actions">
      <button class="whatsapp-link" id="btn-share-native" style="display:none" onclick="doNativeShare()">
        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="15" height="15"><path d="M4 12v8a2 2 0 002 2h12a2 2 0 002-2v-8"/><polyline points="16 6 12 2 8 6"/><line x1="12" y1="2" x2="12" y2="15"/></svg>
        Compartilhar
      </button>
      <a href="https://wa.me/?text=${escape(`Veja as fotos de ${event.title} em fotos.lucafchala.com/${event.slug}`)}" target="_blank" rel="noopener" class="whatsapp-link" id="btn-share-wa">
        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" width="15" height="15"><path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413z"/></svg>
        WhatsApp
      </a>
      <button class="removal-link" id="btn-copy-link" style="display:none" onclick="copyLink()">
        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 01-2-2V4a2 2 0 012-2h9a2 2 0 012 2v1"/></svg>
        <span id="copy-label">Copiar link</span>
      </button>
      <button class="removal-link" onclick="openRemModal()">
        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14H6L5 6"/><path d="M10 11v6M14 11v6"/><path d="M9 6V4h6v2"/></svg>
        Solicitar remoção de foto
      </button>
      <a href="/suporte" class="removal-link">
        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>
        Suporte
      </a>
      <a href="/privacidade" class="removal-link">
        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg>
        Privacidade
      </a>
      <a href="/termos" class="removal-link">
        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="9" y1="13" x2="15" y2="13"/><line x1="9" y1="17" x2="13" y2="17"/></svg>
        Termos
      </a>
    </div>
  </footer>

  ${!event.comingSoon ? `<button class="sticky-cta" id="sticky-cta" onclick="openModal()" aria-label="Acessar fotos">
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><rect x="3" y="3" width="18" height="18" rx="2"/><path d="M9 3v18M15 3v18M3 9h18M3 15h18" stroke-width="1.2"/></svg>
    Acessar fotos
  </button>` : ''}

  <!-- DRIVE MODAL -->
  <div class="modal-ov" id="modal" onclick="ovClick(event)">
    <div class="modal-sheet" role="dialog" aria-modal="true" aria-label="Acessar fotos">
      <div class="modal-head">
        <h2>Acessar fotos</h2>
        <button class="m-close" onclick="closeModal()" aria-label="Fechar">
          <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
        </button>
      </div>
      <div class="guide-title">Como baixar as fotos</div>
      <ol class="steps">
        <li><span>${event.driveUrlInstagram
          ? `Escolha uma das opções abaixo e abra a pasta correspondente.`
          : `Clique em "Ir para o Google Drive" abaixo.`}</span></li>
        <li>
          <span><strong>No celular:</strong> toque em ⋮ → "Fazer download". Para baixar tudo: segure uma → selecione todas → ⋮ → "Fazer download".</span>
        </li>
        <li>
          <span><strong>No computador:</strong> <kbd>Ctrl+A</kbd> (ou <kbd>⌘A</kbd>) → botão direito → "Fazer download".</span>
        </li>
      </ol>
      <p class="drive-note">Baixe pelo Drive para manter a qualidade original — não tire print.</p>
      <div id="drive-turnstile" style="margin-top:1rem"></div>
      <div id="drive-verifying" class="drive-verifying"><span class="spin"></span> Carregando acesso ao Drive…</div>
      <div id="drive-verify-error" class="drive-verifying" style="display:none;color:#cc8888">Não foi possível carregar o acesso ao Drive. Recarregue a página e tente novamente.</div>
      <div id="drive-gate" style="display:none">
        ${declaration ? `<label class="drive-consent">
          <input type="checkbox" id="drive-declaration" onchange="onDriveConsent()">
          <span>${escape(declaration)}</span>
        </label>` : ''}
        <label class="drive-consent">
          <input type="checkbox" id="drive-consent" onchange="onDriveConsent()">
          <span>Li e aceito os <a href="/termos" target="_blank" rel="noopener">Termos de Uso</a> e autorizo o uso da minha imagem conforme descrito neles.</span>
        </label>
        <button type="button" id="drive-name-toggle" class="drive-name-toggle" onclick="toggleDriveName()">+ incluir meu nome (opcional)</button>
        <div id="drive-name-wrap" class="rem-field" style="display:none;margin-top:.625rem;margin-bottom:0">
          <input type="text" id="drive-name" placeholder="Seu nome (opcional)" maxlength="120" autocomplete="name">
        </div>
        <p id="drive-gate-hint" style="font-size:.72rem;color:#a98a4a;line-height:1.5;margin-top:.875rem"></p>
        <div id="drive-links-wrap" class="drive-locked" style="margin-top:1rem">
        ${event.driveUrlInstagram
          ? `<div class="drive-opts">
              <a id="drive-link" href="#" target="_blank" rel="noopener" class="btn-drive-opt" onclick="onDriveOpen('full')">
                <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><path d="M18 13v6a2 2 0 01-2 2H5a2 2 0 01-2-2V8a2 2 0 012-2h6"/><polyline points="15 3 21 3 21 9"/><line x1="10" y1="14" x2="21" y2="3"/></svg>
                <div class="drive-opt-text"><strong>Resolução completa</strong><span>Arquivos originais em alta qualidade</span></div>
              </a>
              <a id="drive-link-ig" href="#" target="_blank" rel="noopener" class="btn-drive-opt" onclick="onDriveOpen('instagram')">
                <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><rect x="2" y="2" width="20" height="20" rx="5"/><circle cx="12" cy="12" r="5"/><circle cx="17.5" cy="6.5" r="1.5" fill="currentColor" stroke="none"/></svg>
                <div class="drive-opt-text"><strong>Para o Instagram</strong><span>Já redimensionadas e prontas para postar</span></div>
              </a>
            </div>`
          : `<a id="drive-link" href="#" target="_blank" rel="noopener" class="btn-drive-go" onclick="onDriveOpen('full')">
              <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><path d="M18 13v6a2 2 0 01-2 2H5a2 2 0 01-2-2V8a2 2 0 012-2h6"/><polyline points="15 3 21 3 21 9"/><line x1="10" y1="14" x2="21" y2="3"/></svg>
              Ir para o Google Drive
            </a>`}
        </div>
        <p class="drive-consent-note">Ao acessar, registramos data, hora e dados técnicos do acesso para comprovação, conforme a <a href="/privacidade" target="_blank" rel="noopener">Política de Privacidade</a>.</p>
      </div>
    </div>
  </div>

  <!-- REMOVAL MODAL -->
  <div class="modal-ov" id="rem-modal" onclick="remOvClick(event)">
    <div class="modal-sheet" role="dialog" aria-modal="true" aria-label="Solicitar remoção de foto">
      <div class="modal-head">
        <h2>Solicitar remoção de foto</h2>
        <button class="m-close" onclick="closeRemModal()" aria-label="Fechar">
          <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
        </button>
      </div>

      <div id="rem-form">
        <p class="rem-intro">Identificou uma foto que quer remover? Preencha com suas informações de contato — analisaremos o pedido e você receberá uma confirmação por e-mail. <strong style="color:#999">Respondemos em até 15 dias úteis.</strong></p>

        <div class="rem-field">
          <label>Identificar a foto por</label>
          <div class="radio-group">
            <label class="radio-opt">
              <input type="radio" name="rem-method" value="number" checked onchange="updateRemMethod()">
              <span>Número da foto na pasta do Drive</span>
            </label>
            <label class="radio-opt">
              <input type="radio" name="rem-method" value="url" onchange="updateRemMethod()">
              <span>Link direto da foto</span>
            </label>
            <label class="radio-opt">
              <input type="radio" name="rem-method" value="upload" onchange="updateRemMethod()">
              <span>Enviar a foto (até 2 MB)</span>
            </label>
          </div>
        </div>

        <div id="rem-number-field" class="rem-field">
          <label>Número da foto</label>
          <input type="number" id="rem-number" min="1" placeholder="Ex: 12">
        </div>
        <div id="rem-url-field" class="rem-field" style="display:none">
          <label>Link da foto</label>
          <input type="url" id="rem-url" placeholder="https://drive.google.com/...">
        </div>
        <div id="rem-upload-field" class="rem-field" style="display:none">
          <label>Foto</label>
          <input type="file" id="rem-file" accept="image/*">
        </div>

        <div class="rem-field">
          <label>E-mail <span style="color:#c0392b">*</span></label>
          <input type="email" id="rem-email" placeholder="seu@email.com" autocomplete="email">
        </div>
        <div class="rem-field">
          <label>Telefone <span style="color:#c0392b">*</span> <span style="color:#444;font-size:.65rem">(com DDD)</span></label>
          <input type="tel" id="rem-phone" placeholder="(11) 99999-9999" autocomplete="tel">
        </div>
        <div class="rem-field">
          <label>Motivo <span style="color:#444">(opcional)</span></label>
          <textarea id="rem-message" placeholder="Descreva o motivo do pedido…"></textarea>
        </div>

        <p style="font-size:.68rem;color:#444;line-height:1.5;margin-top:1rem">Seus dados (e-mail e telefone) são usados exclusivamente para processar esta solicitação e não são compartilhados com terceiros.</p>
        <label style="display:flex;align-items:flex-start;gap:.5rem;margin-top:1rem;cursor:pointer">
          <input type="checkbox" id="rem-consent" style="width:16px;height:16px;accent-color:#f0ebe5;flex-shrink:0;margin-top:2px">
          <span style="font-size:.72rem;color:#888;line-height:1.5">Li e concordo com a <a href="/privacidade" target="_blank" rel="noopener" style="color:#aaa">política de privacidade</a> e os <a href="/termos" target="_blank" rel="noopener" style="color:#aaa">termos de uso</a>, e autorizo o uso dos meus dados para processar esta solicitação.</span>
        </label>
        <div id="rem-turnstile" style="margin-top:1rem"></div>
        <div id="rem-error" class="form-error" style="display:none"></div>
        <div class="rem-sheet-foot">
          <button class="btn-rem-cancel" onclick="closeRemModal()">Cancelar</button>
          <button class="btn-rem-submit" id="rem-submit" onclick="submitRemoval()" disabled>Enviar solicitação</button>
        </div>
      </div>

      <div id="rem-success" class="rem-success" style="display:none">
        <svg xmlns="http://www.w3.org/2000/svg" width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" display="block" style="margin:0 auto"><circle cx="12" cy="12" r="10"/><polyline points="9 12 11 14 15 10"/></svg>
        Solicitação enviada!<br>
        <span style="font-size:.8rem;color:#507a50">Analisaremos o pedido em breve.</span>
      </div>
    </div>
  </div>

  <div class="cookie-notice" id="cookie-notice">
    <span>Usamos cookies essenciais e medição anônima de acesso. <a href="/privacidade">Saiba mais</a>.</span>
    <button id="cookie-ok" type="button">Entendi</button>
  </div>

  <script>
    const DRIVE_URL      = ${driveJSON};
    const DRIVE_URL_IG   = ${driveIgJSON};
    const EVENT_SLUG     = ${slugJSON};
    const EVENT_TITLE    = ${JSON.stringify(event.title || '')};
    const PHOTOS         = ${photosJSON};
    const ALERT_ADDED_AT = ${alertAddedAtJSON};
    const ALERT_EXPIRES  = ${alertExpiresJSON};
    const TERMS_VERSION  = ${JSON.stringify(TERMS_VERSION)};
    const CONSENT_LABEL  = ${JSON.stringify(CONSENT_LABEL)};
    const ACCESS_TYPE       = ${JSON.stringify(event.accessType || 'public')};
    const DECLARATION_LABEL = ${JSON.stringify(declaration)};

    let lastFocused = null;

    // ---- Banner ----
    function updateBanner() {
      const el = document.getElementById('banner-time');
      const banner = document.getElementById('photos-banner');
      if (!el || !ALERT_ADDED_AT) return;
      if (ALERT_EXPIRES && Date.now() > new Date(ALERT_EXPIRES).getTime()) {
        if (banner) banner.style.display = 'none';
        return;
      }
      const diff = Date.now() - new Date(ALERT_ADDED_AT).getTime();
      const mins  = Math.floor(diff / 60000);
      const hours = Math.floor(diff / 3600000);
      const days  = Math.floor(diff / 86400000);
      if (mins < 1)       el.textContent = '— agora mesmo';
      else if (mins < 60) el.textContent = \`— há \${mins} minuto\${mins !== 1 ? 's' : ''}\`;
      else if (hours < 24)el.textContent = \`— há \${hours} hora\${hours !== 1 ? 's' : ''}\`;
      else                el.textContent = \`— há \${days} dia\${days !== 1 ? 's' : ''}\`;
    }
    if (ALERT_ADDED_AT) { updateBanner(); setInterval(updateBanner, 60000); }
    let cur = 0;

    // ---- Cookie / analytics notice ----
    try {
      if (!localStorage.getItem('fotos:cookie_notice')) {
        const cn = document.getElementById('cookie-notice');
        if (cn) cn.classList.add('show');
      }
    } catch(_) {}
    (function(){
      const ck = document.getElementById('cookie-ok');
      if (ck) ck.addEventListener('click', function(){
        try { localStorage.setItem('fotos:cookie_notice', '1'); } catch(_) {}
        const cn = document.getElementById('cookie-notice');
        if (cn) cn.classList.remove('show');
        updateStickyCta();
      });
    })();

    const TS_SITEKEY = '0x4AAAAAADg-tbuoPRO9s2I5';
    let driveWidgetId = null;
    let driveTsToken  = '';
    let driveGateShown = false;
    let driveTimeout  = null;
    let remWidgetId   = null;
    let remTsToken    = '';

    // ---- Drive modal (Terms-gated, low-friction) ----
    function openModal() {
      lastFocused = document.activeElement;
      driveTsToken = '';
      driveGateShown = false;
      const consent = document.getElementById('drive-consent');
      if (consent) consent.checked = false;
      const declaration = document.getElementById('drive-declaration');
      if (declaration) declaration.checked = false;
      const nameWrap = document.getElementById('drive-name-wrap');
      if (nameWrap) nameWrap.style.display = 'none';
      const nameToggle = document.getElementById('drive-name-toggle');
      if (nameToggle) nameToggle.style.display = '';
      const nameInput = document.getElementById('drive-name');
      if (nameInput) nameInput.value = '';
      document.getElementById('drive-links-wrap').classList.add('drive-locked');
      document.getElementById('drive-gate').style.display = 'none';
      document.getElementById('drive-verifying').style.display = '';
      document.getElementById('drive-verify-error').style.display = 'none';
      document.getElementById('drive-link').href = DRIVE_URL || '#';
      const igLink = document.getElementById('drive-link-ig');
      if (igLink) igLink.href = DRIVE_URL_IG || '#';
      document.getElementById('modal').classList.add('open');
      document.body.style.overflow = 'hidden';
      updateStickyCta();
      // Invisible browser check: the Terms + buttons are revealed only AFTER
      // Turnstile passes. A safety timeout surfaces an error instead of hanging.
      clearTimeout(driveTimeout);
      driveTimeout = setTimeout(driveVerifyError, 9000);
      setTimeout(function() {
        // Only bypass when the Turnstile *script* can't load (e.g. blocked CDN) —
        // that must not brick delivery.
        if (typeof turnstile === 'undefined') { driveTsToken = 'noscript'; revealDriveGate(); updateDriveLock(); return; }
        if (driveWidgetId !== null) { turnstile.reset(driveWidgetId); }
        else {
          driveWidgetId = turnstile.render('#drive-turnstile', {
            sitekey: TS_SITEKEY,
            appearance: 'interaction-only',
            callback: function(t) { driveTsToken = t; revealDriveGate(); updateDriveLock(); },
            'error-callback': function() { driveTsToken = ''; driveVerifyError(); },
            'expired-callback': function() { driveTsToken = ''; updateDriveLock(); },
          });
        }
      }, 100);
    }
    function revealDriveGate() {
      if (driveGateShown) return;
      driveGateShown = true;
      clearTimeout(driveTimeout);
      const v = document.getElementById('drive-verifying'); if (v) v.style.display = 'none';
      const e = document.getElementById('drive-verify-error'); if (e) e.style.display = 'none';
      const g = document.getElementById('drive-gate'); if (g) g.style.display = '';
      updateDriveLock();
      const c = document.getElementById('drive-consent'); if (c) c.focus();
    }
    // Browser check failed/timed out — surface it instead of hanging (fail closed).
    function driveVerifyError() {
      if (driveGateShown) return;
      const v = document.getElementById('drive-verifying'); if (v) v.style.display = 'none';
      const e = document.getElementById('drive-verify-error'); if (e) e.style.display = '';
    }
    function onDriveConsent() { updateDriveLock(); }
    // Drive links unlock only when the Terms are accepted, the category self-declaration
    // (when present) is accepted, AND Turnstile passed.
    function updateDriveLock() {
      const c = document.getElementById('drive-consent');
      const decl = document.getElementById('drive-declaration');
      const wrap = document.getElementById('drive-links-wrap');
      const hint = document.getElementById('drive-gate-hint');
      const consentOk = !!(c && c.checked);
      const declOk = !decl || decl.checked; // no declaration for this project → satisfied
      const acceptOk = consentOk && declOk;
      const tsOk = driveTsToken !== '';
      const ok = acceptOk && tsOk;
      if (wrap) wrap.classList.toggle('drive-locked', !ok);
      if (hint) {
        hint.style.display = ok ? 'none' : '';
        if (!ok) {
          const acceptText = decl ? 'a declaração e os Termos' : 'os Termos';
          hint.textContent = !tsOk
            ? (acceptOk ? 'Conclua a verificação de segurança acima para liberar o download.'
                        : 'Conclua a verificação de segurança e aceite ' + acceptText + '.')
            : 'Aceite ' + acceptText + ' para liberar o download.';
        }
      }
      if (ok) { const p = document.getElementById('drive-link'); if (p) p.focus(); }
    }
    function toggleDriveName() {
      const w = document.getElementById('drive-name-wrap');
      const t = document.getElementById('drive-name-toggle');
      if (!w) return;
      w.style.display = '';
      if (t) t.style.display = 'none';
      const i = document.getElementById('drive-name'); if (i) i.focus();
    }
    function closeModal() {
      document.getElementById('modal').classList.remove('open');
      document.body.style.overflow = '';
      updateStickyCta();
      if (lastFocused && lastFocused.focus) lastFocused.focus();
    }
    function ovClick(e) { if (e.target === document.getElementById('modal')) closeModal(); }
    function onDriveOpen(target) {
      trackDrive();
      recordConsent(target);
      closeModal();
    }
    function trackDrive() {
      fetch('/api/track-drive', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ slug: EVENT_SLUG }) }).catch(() => {});
    }
    function recordConsent(target) {
      try {
        const nameEl = document.getElementById('drive-name');
        const payload = JSON.stringify({
          slug: EVENT_SLUG,
          driveTarget: target,
          accessType: ACCESS_TYPE,
          termsVersion: TERMS_VERSION,
          consentText: CONSENT_LABEL,
          declarationText: DECLARATION_LABEL,
          name: nameEl ? nameEl.value : '',
          turnstileToken: driveTsToken,
          pageUrl: location.href,
        });
        if (navigator.sendBeacon) {
          navigator.sendBeacon('/api/consent', new Blob([payload], { type: 'application/json' }));
        } else {
          fetch('/api/consent', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: payload, keepalive: true }).catch(() => {});
        }
      } catch(_) {}
    }

    // ---- Carousel ----
    const _preloaded = {};
    function preloadAround() {
      if (PHOTOS.length < 2) return;
      [cur + 1, cur - 1].forEach(function(k) {
        const i = ((k % PHOTOS.length) + PHOTOS.length) % PHOTOS.length;
        if (_preloaded[i]) return;
        _preloaded[i] = true;
        const im = new Image(); im.src = PHOTOS[i];
      });
    }
    function cGoto(n) {
      if (!PHOTOS.length) return;
      cur = ((n % PHOTOS.length) + PHOTOS.length) % PHOTOS.length;
      const img = document.getElementById('c-img');
      if (img) { img.style.opacity = '0'; img.src = PHOTOS[cur]; }
      document.querySelectorAll('.c-dot').forEach((d, i) => d.classList.toggle('on', i === cur));
      const cnt = document.getElementById('c-count');
      if (cnt) cnt.textContent = (cur + 1) + ' / ' + PHOTOS.length;
      preloadAround();
    }
    function cGo(dir) { cGoto(cur + dir); }
    const car = document.getElementById('carousel');
    if (car) {
      let tx = 0;
      car.addEventListener('touchstart', e => { tx = e.touches[0].clientX; }, { passive: true });
      car.addEventListener('touchend', e => { if (Math.abs(tx - e.changedTouches[0].clientX) > 40) cGo(tx > e.changedTouches[0].clientX ? 1 : -1); });
      preloadAround();
      // One-time swipe hint on touch devices.
      try {
        if (('ontouchstart' in window) && !localStorage.getItem('fotos:swipe_hint')) {
          const h = document.getElementById('swipe-hint');
          if (h) { h.classList.add('show'); setTimeout(function(){ h.classList.remove('show'); }, 2600); }
          localStorage.setItem('fotos:swipe_hint', '1');
        }
      } catch(_) {}
    }

    // ---- Removal modal ----
    function remError(msg, fieldId) {
      const box = document.getElementById('rem-error');
      if (box) { box.textContent = msg; box.style.display = ''; }
      if (fieldId) { const f = document.getElementById(fieldId); if (f) { f.classList.add('bad'); f.focus(); } }
    }
    function clearRemError() {
      const box = document.getElementById('rem-error');
      if (box) { box.textContent = ''; box.style.display = 'none'; }
      ['rem-number','rem-url','rem-email','rem-phone'].forEach(function(id){ const f=document.getElementById(id); if(f) f.classList.remove('bad'); });
    }
    function openRemModal() {
      lastFocused = document.activeElement;
      clearRemError();
      document.getElementById('rem-form').style.display = 'block';
      document.getElementById('rem-success').style.display = 'none';
      remTsToken = '';
      const btn = document.getElementById('rem-submit');
      if (btn) btn.disabled = true;
      document.getElementById('rem-modal').classList.add('open');
      document.body.style.overflow = 'hidden';
      updateStickyCta();
      setTimeout(() => {
        if (typeof turnstile === 'undefined') { if (btn) btn.disabled = false; return; }
        if (remWidgetId !== null) { turnstile.reset(remWidgetId); }
        else {
          remWidgetId = turnstile.render('#rem-turnstile', {
            sitekey: TS_SITEKEY,
            callback: (token) => { remTsToken = token; if (btn) btn.disabled = false; },
            'error-callback': () => { remTsToken = ''; if (btn) btn.disabled = true; },
            'expired-callback': () => { remTsToken = ''; if (btn) btn.disabled = true; },
          });
        }
      }, 80);
    }
    function closeRemModal() {
      document.getElementById('rem-modal').classList.remove('open');
      document.body.style.overflow = '';
      updateStickyCta();
      if (lastFocused && lastFocused.focus) lastFocused.focus();
    }
    function remOvClick(e) { if (e.target === document.getElementById('rem-modal')) closeRemModal(); }

    function updateRemMethod() {
      const m = document.querySelector('input[name="rem-method"]:checked').value;
      document.getElementById('rem-number-field').style.display = m === 'number' ? '' : 'none';
      document.getElementById('rem-url-field').style.display    = m === 'url'    ? '' : 'none';
      document.getElementById('rem-upload-field').style.display = m === 'upload' ? '' : 'none';
    }

    async function submitRemoval() {
      clearRemError();
      const method = document.querySelector('input[name="rem-method"]:checked').value;
      let value = '', fileName = '', fileBase64 = '';

      if (method === 'number') {
        value = (document.getElementById('rem-number').value || '').trim();
        if (!value) return remError('Informe o número da foto.', 'rem-number');
        value = 'Foto nº ' + value;
      } else if (method === 'url') {
        value = (document.getElementById('rem-url').value || '').trim();
        if (!value) return remError('Informe o link da foto.', 'rem-url');
      } else {
        const file = document.getElementById('rem-file').files[0];
        if (!file) return remError('Selecione uma foto.');
        if (file.size > 2 * 1024 * 1024) return remError('Foto muito grande (máx. 2 MB). Tente colar o link da foto no Drive.');
        fileName = file.name;
        try {
          fileBase64 = await new Promise((res, rej) => {
            const r = new FileReader();
            r.onload = ev => res((ev.target.result || '').split(',')[1] || '');
            r.onerror = () => rej(new Error('read'));
            r.readAsDataURL(file);
          });
        } catch(_) {
          return remError('Não foi possível ler o arquivo. Tente outra foto ou cole o link da foto no Drive.');
        }
        if (!fileBase64) return remError('Não foi possível ler o arquivo. Tente outra foto ou cole o link da foto no Drive.');
      }

      const email = (document.getElementById('rem-email').value || '').trim();
      const phone = (document.getElementById('rem-phone').value || '').trim();
      if (!email || !/^[^\\s@]+@[^\\s@]+\\.[^\\s@]{2,}$/.test(email)) {
        return remError('Informe um e-mail válido.', 'rem-email');
      }
      const phoneDigits = phone.replace(/\\D/g, '');
      if (!phone || phoneDigits.length < 10 || phoneDigits.length > 13) {
        return remError('Informe um telefone válido com DDD (ex: (11) 99999-9999).', 'rem-phone');
      }
      if (!document.getElementById('rem-consent').checked) {
        return remError('É necessário concordar com a política de privacidade e os termos de uso.');
      }

      const btn = document.getElementById('rem-submit');
      btn.disabled = true;
      btn.textContent = 'Enviando…';

      try {
        const resp = await fetch('/api/removal-request', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            eventSlug: EVENT_SLUG,
            method,
            value,
            email,
            phone,
            message: (document.getElementById('rem-message').value || '').trim(),
            fileName,
            fileBase64,
            consent: true,
            turnstileToken: remTsToken,
          }),
        });
        if (!resp.ok) { const e = await resp.json().catch(() => ({})); throw new Error(e.error || 'Erro ao enviar.'); }
        document.getElementById('rem-form').style.display = 'none';
        document.getElementById('rem-success').style.display = 'block';
        remTsToken = '';
        if (remWidgetId !== null && typeof turnstile !== 'undefined') { turnstile.reset(remWidgetId); }
      } catch(err) {
        remError(err.message || 'Erro ao enviar. Tente novamente.');
        btn.textContent = 'Enviar solicitação';
        // Turnstile tokens are single-use — this attempt already spent it. Fetch a
        // fresh one before allowing a retry; otherwise the server rejects the stale
        // token and every retry fails until the page is reloaded. The widget's
        // callback re-enables the button once the new token arrives.
        remTsToken = '';
        if (remWidgetId !== null && typeof turnstile !== 'undefined') {
          turnstile.reset(remWidgetId);
        } else {
          btn.disabled = false;
        }
      }
    }

    // ---- Global: Esc closes, Tab traps focus, arrows drive the carousel ----
    function closeAnyModal(open) {
      if (open.id === 'modal') closeModal();
      else if (open.id === 'rem-modal') closeRemModal();
    }
    document.addEventListener('keydown', function(e) {
      var open = document.querySelector('.modal-ov.open');
      if (e.key === 'Escape' && open) { e.preventDefault(); closeAnyModal(open); return; }
      if (e.key === 'Tab' && open) {
        var sel = 'a[href],button:not([disabled]),input:not([disabled]),textarea:not([disabled]),select:not([disabled]),[tabindex]:not([tabindex="-1"])';
        var f = Array.prototype.filter.call(open.querySelectorAll(sel), function(el) { return el.offsetParent !== null; });
        if (!f.length) return;
        var first = f[0], last = f[f.length - 1];
        if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
        else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
        return;
      }
      if (!open && PHOTOS.length > 1) {
        if (e.key === 'ArrowLeft') cGo(-1);
        else if (e.key === 'ArrowRight') cGo(1);
      }
    });

    // ---- Sticky mobile CTA ----
    function updateStickyCta() {
      var sc = document.getElementById('sticky-cta');
      if (!sc) return;
      var modalOpen = !!document.querySelector('.modal-ov.open');
      var cn = document.getElementById('cookie-notice');
      var cookieOpen = cn && cn.classList.contains('show');
      var scrolled = (window.scrollY || document.documentElement.scrollTop) > 520;
      sc.classList.toggle('show', scrolled && !modalOpen && !cookieOpen);
    }
    window.addEventListener('scroll', updateStickyCta, { passive: true });
    window.addEventListener('resize', updateStickyCta);
    updateStickyCta();

    // ---- Share ----
    function doNativeShare() {
      navigator.share({ title: EVENT_TITLE, url: window.location.href }).catch(function(){});
    }
    function copyLink() {
      var label = document.getElementById('copy-label');
      navigator.clipboard.writeText(window.location.href).then(function() {
        if (label) { label.textContent = 'Copiado! ✓'; setTimeout(function(){ label.textContent = 'Copiar link'; }, 2000); }
      }).catch(function() {
        try {
          var t = document.createElement('textarea');
          t.value = window.location.href;
          document.body.appendChild(t); t.select(); document.execCommand('copy'); document.body.removeChild(t);
          if (label) { label.textContent = 'Copiado! ✓'; setTimeout(function(){ label.textContent = 'Copiar link'; }, 2000); }
        } catch(_) {}
      });
    }
    (function initShare() {
      if (navigator.share) {
        var n = document.getElementById('btn-share-native');
        var w = document.getElementById('btn-share-wa');
        if (n) n.style.display = '';
        if (w) w.style.display = 'none';
      } else {
        var c = document.getElementById('btn-copy-link');
        if (c) c.style.display = '';
      }
    })();
  </script>
  <script src="https://challenges.cloudflare.com/turnstile/v0/api.js" async defer></script>
  ${analyticsToken ? `<script defer src="https://static.cloudflareinsights.com/beacon.min.js" data-cf-beacon='${JSON.stringify({ token: String(analyticsToken) }).replace(/</g, '\\u003c')}'></script>` : ''}
</body>
</html>`;
}

function camIcon(size) {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1"><rect x="3" y="5" width="18" height="15" rx="2"/><circle cx="12" cy="12" r="4"/><path d="M9 5l1.5-2h3L15 5"/></svg>`;
}

function clockIcon(size) {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.25"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>`;
}
