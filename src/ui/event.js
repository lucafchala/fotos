import { escape, formatDatePT, sizedDriveThumb, safeUrl, ACCESS_DECLARATIONS, perfBootScript, footerLegalLinksHTML, igCreditButtonHTML } from '../utils.js';

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
  const slugJSON    = JSON.stringify(event.slug || '');
  const ogImage     = event.comingSoon
    ? `${SITE_URL}/og-coming-soon.png`
    : (photos[0] ? sizedDriveThumb(photos[0], 1200) : '');
  const ogDescription = event.longDescription
    ? event.longDescription.slice(0, 200).trim()
    : 'Fotografias de Luca F. Chala.';

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
      ? `<div class="hero"><img src="${escape(displayPhotos[0])}" alt="${escape(event.title)}" class="hero-blur-img" fetchpriority="high" decoding="async" onerror="this.style.opacity='0'"><div class="hero-soon-ov">${clockIcon(56)}<span>Em breve</span></div></div>`
      : `<div class="hero"><div class="hero-ph hero-soon">${clockIcon(56)}<span>Em breve</span></div></div>`
    : photos.length === 0
      ? `<div class="hero"><div class="hero-ph">${camIcon(48)}</div></div>`
      : photos.length === 1
        ? `<div class="hero"><img src="${escape(displayPhotos[0])}" alt="${escape(event.title)}" fetchpriority="high" decoding="async" onerror="this.style.opacity='0'"></div>`
        : `<div class="carousel" id="carousel">
          <img id="c-img" src="${escape(displayPhotos[0])}" alt="${escape(event.title)}" fetchpriority="high" decoding="async" onload="this.style.opacity='1';window.cImgSettled&&cImgSettled()" onerror="this.style.opacity='0';window.cImgSettled&&cImgSettled()">
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
  <meta property="og:description" content="${escape(ogDescription)}">
  ${ogImage ? `<meta property="og:image" content="${escape(ogImage)}">` : ''}
  <meta property="og:type" content="website">
  <meta property="og:url" content="${SITE_URL}/${escape(event.slug)}">
  <meta name="twitter:card" content="${ogImage ? 'summary_large_image' : 'summary'}">
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://drive.google.com">
  <link rel="preconnect" href="https://lh3.googleusercontent.com">
  ${perfBootScript('event', !!analyticsToken)}
  <link href="https://fonts.googleapis.com/css2?family=Inter:ital,wght@0,300;0,400;0,500;0,600;1,400&display=swap" rel="stylesheet">
  <style>
    *,*::before,*::after{box-sizing:border-box;margin:0;padding:0}
    body{font-family:'Inter',sans-serif;background:#0a0a0a;color:#f0ebe5;min-height:100vh}
    :focus-visible{outline:2px solid #c0a060;outline-offset:2px}
    .hero-stage{position:relative}
    .back-pill{position:absolute;top:.875rem;left:.875rem;z-index:3;display:inline-flex;align-items:center;gap:.4rem;text-decoration:none;color:#f0ebe5;font-size:.8rem;background:rgba(0,0,0,.45);backdrop-filter:blur(6px);-webkit-backdrop-filter:blur(6px);padding:.5rem .8rem .5rem .65rem;border-radius:20px;transition:background .2s}
    .back-pill:hover{background:rgba(0,0,0,.65)}
    .back-pill svg{width:14px;height:14px;flex-shrink:0}
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
    /* Enquanto a próxima foto não chega, o contador pulsa: a navegação sempre
       responde, mesmo quando a rede não. */
    .c-pending .c-count{opacity:.55;animation:cpulse 1s ease-in-out infinite}
    @keyframes cpulse{0%,100%{opacity:.35}50%{opacity:.75}}
    @media(prefers-reduced-motion:reduce){.c-pending .c-count{animation:none}}
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
    h1{font-size:clamp(1.5rem,6vw,2.25rem);font-weight:600;line-height:1.15;margin:.4rem 0 2rem}
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
    /* credits */
    .credits{border-top:1px solid #191919;padding-top:2.25rem}
    .credits-title{font-size:.65rem;font-weight:500;letter-spacing:.14em;text-transform:uppercase;color:#3a3a3a;margin-bottom:1rem}
    .credits-list{display:flex;flex-direction:column;gap:.5rem;margin-bottom:1rem}
    .credits-list a,.credits-list span{font-size:.85rem;line-height:1.5;color:#666;text-decoration:none;transition:color .2s;display:block}
    .credits-list a:hover{color:#bbb}
    .ig-credit-btn{display:inline-flex;align-items:center;gap:.6rem;background:#1c1c1c;border:1px solid #3a3a3a;color:#f0ebe5;text-decoration:none;padding:.65rem 1rem;border-radius:24px;font-size:.85rem;font-weight:500;transition:border-color .2s,background .2s,transform .15s}
    .ig-credit-btn:hover{background:#242424;border-color:#dc2743;transform:translateY(-1px)}
    .ig-credit-icon{display:inline-flex;flex-shrink:0}
    .ig-credit-text strong{font-weight:700;color:#fff}
    /* banner */
    .photos-banner{background:#0d1a0d;border-bottom:1px solid #1a3a1a;padding:.75rem 1.5rem;display:flex;align-items:center;justify-content:center;gap:.625rem}
    .banner-inner{display:flex;align-items:center;gap:.5rem;font-size:.82rem;color:#8ac88a;max-width:680px;width:100%}
    .banner-dot{width:7px;height:7px;border-radius:50%;background:#5aaa5a;flex-shrink:0;animation:pulse 2s infinite}
    @keyframes pulse{0%,100%{opacity:1}50%{opacity:.4}}
    .banner-text strong{color:#a8d8a8}
    .banner-time{color:#6aaa6a}
    /* footer — plain links, industry-standard, no button chrome. Emphasis on
       Share/removal comes from contrast + weight + being the top row, not
       from a button shape. */
    footer{padding:2rem 1.5rem 3rem;border-top:1px solid #111;margin-top:2rem;display:flex;flex-direction:column;align-items:center;gap:1rem}
    .footer-brand{color:#777;font-size:.8rem;text-decoration:none;letter-spacing:.1em;transition:color .2s;flex-shrink:0}
    .footer-brand:hover{color:#aaa}
    .footer-actions-primary{display:flex;align-items:center;gap:1.25rem;flex-wrap:wrap;justify-content:center}
    .action-btn{display:inline-flex;align-items:center;gap:.4rem;background:none;border:none;color:#e8e3dc;padding:.35rem 0;font-size:.85rem;font-weight:600;letter-spacing:.02em;cursor:pointer;text-decoration:none;transition:color .2s;white-space:nowrap}
    .action-btn:hover{color:#fff;text-decoration:underline;text-underline-offset:3px}
    .action-btn svg{width:15px;height:15px;flex-shrink:0}
    .footer-actions-legal{display:flex;align-items:center;gap:1.25rem;flex-wrap:wrap;justify-content:center;margin-top:.25rem}
    .legal-link{display:inline-flex;align-items:center;gap:.4rem;background:none;border:none;color:#999;padding:.35rem 0;font-size:.8rem;font-weight:500;letter-spacing:.02em;text-decoration:none;transition:color .2s;white-space:nowrap}
    .legal-link:hover{color:#ccc;text-decoration:underline;text-underline-offset:3px}
    .footer-copyright{font-size:.75rem;color:#888;letter-spacing:.03em;text-align:center;width:100%;margin-top:.5rem}
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
    .guide-box{border-left:3px solid #c0a060;background:#141210;border-radius:0 10px 10px 0;padding:1.125rem 1.25rem;margin-bottom:1.25rem}
    .guide-title{font-size:.8rem;font-weight:700;letter-spacing:.1em;text-transform:uppercase;color:#c0a060;margin-bottom:.75rem}
    .guide-note{font-size:.85rem;line-height:1.65;color:#ddd;margin-bottom:.875rem}
    .guide-note:last-child{margin-bottom:0}
    .guide-credit{color:#aaa}
    .drive-verifying{display:flex;align-items:center;gap:.5rem;color:#888;font-size:.82rem;margin-top:.875rem}
    .spin{width:14px;height:14px;border:2px solid #2a2a2a;border-top-color:#999;border-radius:50%;animation:spin .7s linear infinite;flex-shrink:0}
    @keyframes spin{to{transform:rotate(360deg)}}
    .drive-consent{display:flex;align-items:flex-start;gap:.5rem;cursor:pointer;margin-top:1.25rem;font-size:.85rem;color:#bbb;line-height:1.5;border-radius:8px}
    .drive-consent input{width:18px;height:18px;accent-color:#c0a060;flex-shrink:0;margin-top:1px}
    .drive-consent a{color:#c0a060}
    .flash-warn{animation:flashWarn 1.3s ease}
    @keyframes flashWarn{0%,100%{box-shadow:none}25%,65%{box-shadow:0 0 0 2px #a9714a}}
    .drive-name-toggle{background:none;border:none;color:#666;font-size:.74rem;cursor:pointer;margin-top:.625rem;padding:0;text-decoration:underline}
    .drive-name-toggle:hover{color:#999}
    #drive-gate-hint{font-size:.82rem;color:#c99a5c;line-height:1.5;margin-top:.875rem}
    .drive-consent-note{font-size:.8rem;color:#555;line-height:1.5;margin-top:.875rem}
    .drive-consent-note a{color:#777}
    .drive-locked .btn-drive-go,.drive-locked .btn-drive-opt{background:#1a1a1a;border-color:#232323;color:#6a6a6a;cursor:not-allowed}
    .drive-locked .btn-drive-go:hover,.drive-locked .btn-drive-opt:hover{background:#1a1a1a;transform:none;border-color:#232323}
    .drive-locked .btn-drive-opt svg{color:#555}
    .drive-locked .drive-opt-text strong{color:#8a8a8a}
    .drive-locked .drive-opt-text span{color:#555}
    .btn-drive-go{display:flex;align-items:center;justify-content:center;gap:.65rem;background:#f0ebe5;color:#0a0a0a;border:none;padding:.875rem 1.5rem;border-radius:9px;font-size:.875rem;font-weight:600;cursor:pointer;margin-top:1rem;width:100%;text-decoration:none;transition:background .18s,transform .15s,box-shadow .3s}
    .btn-drive-go:hover{background:#fff;transform:translateY(-1px)}
    .btn-drive-go svg{width:18px;height:18px;flex-shrink:0}
    .drive-opts{display:flex;flex-direction:column;gap:.5rem;margin-top:1rem}
    .btn-drive-opt{display:flex;align-items:center;gap:.875rem;background:#1c1c1c;border:1px solid #3a3a3a;color:#f0ebe5;padding:.9rem 1.1rem;border-radius:10px;text-decoration:none;transition:border-color .18s,background .18s,box-shadow .3s;width:100%}
    .btn-drive-opt:hover{border-color:#4a4a4a;background:#242424}
    .btn-drive-opt svg{width:20px;height:20px;flex-shrink:0;color:#aaa}
    .drive-opt-text{display:flex;flex-direction:column;gap:.15rem}
    .drive-opt-text strong{font-size:.875rem;font-weight:600;color:#f0ebe5}
    .drive-opt-text span{font-size:.72rem;color:#8a8a8a;font-weight:400}
    .btn-icon{display:inline-flex}
    .btn-spin{display:none}
    .drive-loading{pointer-events:none}
    .drive-loading .btn-icon{display:none}
    .drive-loading .btn-spin{display:inline-flex}
    .drive-attn{animation:driveAttn 1.6s ease-in-out infinite}
    @keyframes driveAttn{0%,100%{box-shadow:0 0 0 0 rgba(192,160,96,0)}50%{box-shadow:0 0 0 5px rgba(192,160,96,.22)}}
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
    .adblock-warn{background:#1d1606;border:1px solid #4a3a12;color:#d8b25a;padding:.7rem .85rem;border-radius:8px;font-size:.78rem;line-height:1.55;margin-top:1rem}
    .adblock-warn strong{color:#f0d080}
    .adblock-warn a{color:#f0d080}
    .adblock-warn button{background:none;border:none;color:#f0d080;text-decoration:underline;cursor:pointer;font:inherit;padding:0}
    .noscript-banner{background:#1d1606;border-bottom:1px solid #4a3a12;color:#e8c878;padding:.85rem 1.25rem;font-size:.82rem;line-height:1.55;text-align:center}
    .noscript-banner strong{color:#f0d080}
    .noscript-banner a{color:#f0d080}
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
      .btn-drive:hover,.btn-drive-go:hover,.ig-credit-btn:hover{transform:none}
    }
  </style>
</head>
<body>
  <div id="drive-turnstile"></div>
  <noscript>
    <div class="noscript-banner">
      Para acessar as fotos, ative o <strong>JavaScript</strong> e desative o bloqueador de anúncios para este site; depois recarregue a página. Precisa de ajuda? <a href="/suporte">Suporte</a>.
    </div>
  </noscript>
  ${showBanner ? `<div class="photos-banner" id="photos-banner">
    <div class="banner-inner">
      <span class="banner-dot"></span>
      <span class="banner-text"><strong>Novas fotos adicionadas</strong> <span class="banner-time" id="banner-time"></span></span>
    </div>
  </div>` : ''}

  <div class="hero-stage">
    ${heroHTML}
    <a href="/" class="back-pill" aria-label="Voltar para todos os projetos">
      <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><polyline points="15 18 9 12 15 6"/></svg>
      <span>todos os projetos</span>
    </a>
  </div>

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
        ${event.eventCredits ? `<span>${escape(event.eventCredits)}</span>` : ''}
        ${safeUrl(event.projectUrl) ? `<a href="${escape(safeUrl(event.projectUrl))}" target="_blank" rel="noopener">🔗 ${escape(event.projectUrl)}</a>` : ''}
      </div>
      ${igCreditButtonHTML('1')}
    </div>
  </main>

  <footer>
    <a href="/" class="footer-brand">fotos · Luca F. Chala</a>
    <div class="footer-actions-primary">
      <button class="action-btn" id="btn-share-native" style="display:none" onclick="doNativeShare()">
        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="15" height="15"><path d="M4 12v8a2 2 0 002 2h12a2 2 0 002-2v-8"/><polyline points="16 6 12 2 8 6"/><line x1="12" y1="2" x2="12" y2="15"/></svg>
        Compartilhar
      </button>
      <a href="https://wa.me/?text=${escape(`Veja as fotos de ${event.title} em fotos.lucafchala.com/${event.slug}`)}" target="_blank" rel="noopener" class="action-btn" id="btn-share-wa">
        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" width="15" height="15"><path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413z"/></svg>
        WhatsApp
      </a>
      <button class="action-btn" id="btn-copy-link" style="display:none" onclick="copyLink()">
        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 01-2-2V4a2 2 0 012-2h9a2 2 0 012 2v1"/></svg>
        <span id="copy-label">Copiar link</span>
      </button>
      <button class="action-btn" onclick="openRemModal()">
        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14H6L5 6"/><path d="M10 11v6M14 11v6"/><path d="M9 6V4h6v2"/></svg>
        Solicitar remoção de foto
      </button>
    </div>
    ${footerLegalLinksHTML()}
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
      <div class="guide-box">
        <div class="guide-title">Antes de acessar</div>
        <p class="guide-note">Baixe as fotos pelo Google Drive — <strong>evite print de tela</strong>, a foto perde qualidade e resolução. Baixar direto do Drive garante o arquivo original.</p>
        ${igCreditButtonHTML('2')}
        ${event.eventCredits ? `<p class="guide-note guide-credit">Crédito: <strong>${escape(event.eventCredits)}</strong></p>` : ''}
      </div>
      <div id="drive-adblock" class="adblock-warn" style="display:none">
        <strong>⚠️ Bloqueador de anúncios detectado.</strong> Você ainda pode acessar as fotos, mas a verificação de segurança não carregou. Para registrarmos seu consentimento de uso de imagem corretamente, recomendamos <button type="button" onclick="location.reload()">desativar o bloqueador e recarregar</button> (e ativar o JavaScript, caso esteja desativado).
      </div>
      <div id="drive-gate">
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
        <p id="drive-gate-hint" style="display:none"></p>
        <div id="drive-verify-error" class="drive-verifying" style="display:none;color:#cc8888;margin-top:1rem">Verificação de segurança demorando mais que o esperado. Desative o bloqueador de anúncios para este site (e ative o JavaScript, caso esteja desativado) e recarregue a página.</div>
        <div id="drive-link-error" class="drive-verifying" style="display:none;color:#cc8888;margin-top:1rem">
          Não foi possível liberar o acesso. <button type="button" onclick="retryDriveLink()" style="background:none;border:none;color:#e0a0a0;text-decoration:underline;cursor:pointer;font:inherit;padding:0;margin-left:.35rem">Tentar novamente</button>
        </div>
        <div id="drive-links-wrap" class="drive-locked" style="margin-top:1rem">
        ${event.driveUrlInstagram
          ? `<div class="drive-opts">
              <a id="drive-link" href="#" target="_blank" rel="noopener" class="btn-drive-opt" onclick="return onDriveLinkClick(event)">
                <span class="btn-icon"><svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><path d="M18 13v6a2 2 0 01-2 2H5a2 2 0 01-2-2V8a2 2 0 012-2h6"/><polyline points="15 3 21 3 21 9"/><line x1="10" y1="14" x2="21" y2="3"/></svg></span>
                <span class="btn-spin"><span class="spin"></span></span>
                <div class="drive-opt-text"><strong>Resolução completa</strong><span>Arquivos originais em alta qualidade</span></div>
              </a>
              <a id="drive-link-ig" href="#" target="_blank" rel="noopener" class="btn-drive-opt" onclick="return onDriveLinkClick(event)">
                <span class="btn-icon"><svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><rect x="2" y="2" width="20" height="20" rx="5"/><circle cx="12" cy="12" r="5"/><circle cx="17.5" cy="6.5" r="1.5" fill="currentColor" stroke="none"/></svg></span>
                <span class="btn-spin"><span class="spin"></span></span>
                <div class="drive-opt-text"><strong>Para o Instagram</strong><span>Já redimensionadas e prontas para postar</span></div>
              </a>
            </div>`
          : `<a id="drive-link" href="#" target="_blank" rel="noopener" class="btn-drive-go" onclick="return onDriveLinkClick(event)">
              <span class="btn-icon"><svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><path d="M18 13v6a2 2 0 01-2 2H5a2 2 0 01-2-2V8a2 2 0 012-2h6"/><polyline points="15 3 21 3 21 9"/><line x1="10" y1="14" x2="21" y2="3"/></svg></span>
              <span class="btn-spin"><span class="spin"></span></span>
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
        <div id="rem-adblock" class="adblock-warn" style="display:none">
          <strong>⚠️ Bloqueador de anúncios detectado.</strong> A verificação de segurança necessária para enviar esta solicitação não carregou. Desative o bloqueador para este site e ative o JavaScript (caso esteja desativado), depois <button type="button" onclick="location.reload()">recarregue a página</button>. Se preferir, fale pelo <a href="https://wa.me/5511989211178" target="_blank" rel="noopener">WhatsApp</a>.
        </div>
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
    const EVENT_SLUG     = ${slugJSON};
    const EVENT_TITLE    = ${JSON.stringify(event.title || '')};
    const PHOTOS         = ${photosJSON};
    const ALERT_ADDED_AT = ${alertAddedAtJSON};
    const ALERT_EXPIRES  = ${alertExpiresJSON};

    let lastFocused = null;

    // ---- Ad-block / privacy-extension detection ----
    // The Turnstile script is the asset these extensions block. Without it we
    // can't run the security check the Drive gate and the LGPD forms (image-use
    // consent + photo removal) depend on, so we surface a clear, actionable
    // warning instead of letting the flow break silently. (window.__tsBlocked is
    // also set by the script tag's onerror at the bottom of the page.)
    window.__tsBlocked = window.__tsBlocked || false;
    function tsUnavailable() { return window.__tsBlocked || typeof turnstile === 'undefined'; }
    function showAdblockWarn(id) { var el = document.getElementById(id); if (el) el.style.display = ''; }
    function hideAdblockWarn(id) { var el = document.getElementById(id); if (el) el.style.display = 'none'; }

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
    let driveWidgetId  = null;
    let driveTsToken   = '';
    let driveTimeout   = null;
    let driveLinkState = 'idle'; // idle | loading | ready | error
    let driveLinkResult = null;  // { driveUrl, driveUrlInstagram } cached after a successful fetch
    let driveAttnTimer = null;
    let remWidgetId   = null;
    let remTsToken    = '';

    // ---- Pre-warm the Drive gate's Turnstile challenge as soon as the script
    // loads, instead of waiting for the modal to open — by the time a visitor
    // taps "Acessar fotos" the token is usually already sitting ready, so the
    // gate reveals near-instantly instead of visibly resolving in front of them.
    function initDriveTurnstile() {
      if (tsUnavailable() || driveWidgetId !== null) return;
      driveWidgetId = turnstile.render('#drive-turnstile', {
        sitekey: TS_SITEKEY,
        appearance: 'interaction-only',
        execution: 'execute', // don't fire on render — we control the timing below
        callback: function(t) {
          driveTsToken = t;
          // Terms/button are already visible — this just clears the stuck-check
          // note (if it had fired) and lets the gate fetch the real link.
          revealDriveGate();
          maybeFetchDriveLink();
        },
        'error-callback': function() { driveTsToken = ''; driveVerifyError(); },
        'expired-callback': function() { driveTsToken = ''; turnstile.execute(driveWidgetId); }, // silent refresh
      });
      turnstile.execute(driveWidgetId);
    }

    // ---- Drive modal (Terms-gated, low-friction) ----
    function openModal() {
      lastFocused = document.activeElement;
      clearCtaAttn();
      const consent = document.getElementById('drive-consent');
      const declaration = document.getElementById('drive-declaration');
      const nameWrap = document.getElementById('drive-name-wrap');
      if (nameWrap) nameWrap.style.display = 'none';
      const nameToggle = document.getElementById('drive-name-toggle');
      if (nameToggle) nameToggle.style.display = '';
      const nameInput = document.getElementById('drive-name');
      if (nameInput) nameInput.value = '';
      document.getElementById('drive-verify-error').style.display = 'none';
      hideAdblockWarn('drive-adblock');
      document.getElementById('modal').classList.add('open');
      document.body.style.overflow = 'hidden';
      updateStickyCta();

      // Already granted earlier this page session — skip straight to ready,
      // no re-fetch, no re-wait.
      if (driveLinkResult) {
        if (consent) consent.checked = true;
        if (declaration) declaration.checked = true;
        driveLinkState = 'ready';
        setDriveLinkUI('ready', driveLinkResult);
        return;
      }

      if (consent) consent.checked = false;
      if (declaration) declaration.checked = false;
      driveLinkState = 'idle';
      setDriveLinkUI('idle');

      // Terms + the (visibly-present, disabled-styled) button show together
      // immediately — Turnstile keeps resolving invisibly in the background,
      // exactly as it pre-warmed on page load. Only a genuinely stuck check
      // (no token after 9s) surfaces a small inline note; it never hides
      // the terms or the button.
      clearTimeout(driveTimeout);
      driveTimeout = setTimeout(function() { if (!driveTsToken) driveVerifyError(); }, 9000);
      // Only bypass when the Turnstile *script* can't load (e.g. blocked CDN) —
      // that must not brick delivery, so the server has its own (weaker,
      // rate-limited) path for this token value.
      if (tsUnavailable()) { showAdblockWarn('drive-adblock'); driveTsToken = 'noscript'; maybeFetchDriveLink(); return; }
      if (driveTsToken) {
        // Pre-fetched while the page was idle — nothing left to wait for.
        clearTimeout(driveTimeout);
      }
      // else: initDriveTurnstile()'s callback is still resolving in the
      // background and will call revealDriveGate() once it lands.
    }
    function revealDriveGate() {
      clearTimeout(driveTimeout);
      const e = document.getElementById('drive-verify-error'); if (e) e.style.display = 'none';
    }
    // Browser check is taking unusually long — surface a small note without
    // hiding the terms or the (still visibly-present) button.
    function driveVerifyError() {
      const e = document.getElementById('drive-verify-error'); if (e) e.style.display = '';
    }
    function onDriveConsent() {
      maybeFetchDriveLink();
    }
    // Fires the real gate: only requests the link once Turnstile + consent
    // (+ declaration, when required) are all satisfied — no click needed.
    function maybeFetchDriveLink() {
      if (driveLinkState === 'loading' || driveLinkState === 'ready') return;
      const c = document.getElementById('drive-consent');
      const decl = document.getElementById('drive-declaration');
      const ok = c && c.checked && (!decl || decl.checked) && driveTsToken !== '';
      if (ok) fetchDriveLink();
    }
    function fetchDriveLink() {
      driveLinkState = 'loading';
      setDriveLinkUI('loading');
      const nameEl = document.getElementById('drive-name');
      const decl = document.getElementById('drive-declaration');
      fetch('/api/drive-link', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          slug: EVENT_SLUG,
          turnstileToken: driveTsToken,
          consent: true,
          declaration: decl ? decl.checked : undefined,
          name: nameEl ? nameEl.value : '',
        }),
      })
        .then(function(r) { return r.ok ? r.json() : Promise.reject(); })
        .then(function(data) {
          driveLinkResult = data;
          driveLinkState = 'ready';
          setDriveLinkUI('ready', data);
        })
        .catch(function() {
          driveLinkState = 'error';
          setDriveLinkUI('error');
          // Turnstile tokens are single-use — this attempt already spent it.
          // Fetch a fresh one in the background; its callback retries automatically.
          if (driveTsToken !== 'noscript') {
            driveTsToken = '';
            if (driveWidgetId !== null && !tsUnavailable()) turnstile.execute(driveWidgetId);
          }
        });
    }
    function retryDriveLink() {
      driveLinkState = 'idle';
      if (driveTsToken) maybeFetchDriveLink();
      else setDriveLinkUI('loading'); // waiting on a fresh token; retries itself once it lands
    }
    // Drives the visible state of the link button(s): visibly-present but
    // muted (.drive-locked) until the real href lands, with a spinner
    // swapped in for the icon while the request is in flight (.drive-loading,
    // see .btn-icon/.btn-spin). Once ready, an idle timer draws attention if
    // the visitor doesn't click within a few seconds.
    function clearDriveAttn() {
      clearTimeout(driveAttnTimer);
      const wrap = document.getElementById('drive-links-wrap');
      if (wrap) wrap.classList.remove('drive-attn');
    }
    function setDriveLinkUI(state, data) {
      const wrap = document.getElementById('drive-links-wrap');
      const err = document.getElementById('drive-link-error');
      if (!wrap) return;
      clearDriveAttn();
      if (state === 'idle') {
        wrap.classList.add('drive-locked');
        wrap.classList.remove('drive-loading');
        if (err) err.style.display = 'none';
      } else if (state === 'loading') {
        wrap.classList.add('drive-locked', 'drive-loading');
        if (err) err.style.display = 'none';
      } else if (state === 'ready') {
        wrap.classList.remove('drive-locked', 'drive-loading');
        if (err) err.style.display = 'none';
        const primary = document.getElementById('drive-link');
        if (primary) {
          primary.href = (data && data.driveUrl) || '#';
          primary.focus();
        }
        const ig = document.getElementById('drive-link-ig');
        if (ig) ig.href = (data && data.driveUrlInstagram) || '#';
        driveAttnTimer = setTimeout(function() { wrap.classList.add('drive-attn'); }, 7000);
      } else if (state === 'error') {
        wrap.classList.add('drive-locked');
        wrap.classList.remove('drive-loading');
        if (err) err.style.display = '';
      }
    }
    function onDriveLinkClick(e) {
      if (driveLinkState !== 'ready') { e.preventDefault(); handleBlockedDriveClick(); return false; }
      clearDriveAttn();
      onDriveOpen();
      return true;
    }
    // Clicked while not ready: only the "accept the terms" message is ever
    // right here — if terms are already accepted and it's just Turnstile or
    // the network still resolving, saying "accept the terms" would be wrong,
    // so we stay silent (the button's own spinner already communicates that).
    function handleBlockedDriveClick() {
      const c = document.getElementById('drive-consent');
      const decl = document.getElementById('drive-declaration');
      const acceptOk = !!(c && c.checked) && (!decl || decl.checked);
      if (!acceptOk) {
        const hint = document.getElementById('drive-gate-hint');
        if (hint) {
          hint.textContent = 'você precisa aceitar os termos e declarações primeiro';
          hint.style.display = '';
          clearTimeout(window.__driveHintTimer);
          window.__driveHintTimer = setTimeout(function() { hint.style.display = 'none'; }, 3500);
        }
        document.querySelectorAll('.drive-consent').forEach(function(l) {
          l.classList.remove('flash-warn'); void l.offsetWidth; l.classList.add('flash-warn');
        });
      }
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
      clearDriveAttn();
      updateStickyCta();
      if (lastFocused && lastFocused.focus) lastFocused.focus();
    }
    function ovClick(e) { if (e.target === document.getElementById('modal')) closeModal(); }
    function onDriveOpen() {
      trackDrive(); // simple click counter — navigation follows the real href natively
      closeModal();
    }
    function trackDrive() {
      fetch('/api/track-drive', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ slug: EVENT_SLUG }) }).catch(() => {});
    }

    // ---- Carousel ----
    const _preloaded = {};
    // No desktop vale aquecer uma vizinhança maior: clicar rápido no ›› passava
    // do único vizinho pré-carregado e caía numa imagem fria. No mobile fica em
    // ±1 de propósito — lá a conta é de dados do usuário, não de latência.
    function preloadAround() {
      if (PHOTOS.length < 2) return;
      const reach = Math.min(innerWidth < 768 ? 1 : 3, Math.floor(PHOTOS.length / 2));
      for (let off = -reach; off <= reach; off++) {
        if (off === 0) continue;
        const i = (((cur + off) % PHOTOS.length) + PHOTOS.length) % PHOTOS.length;
        if (_preloaded[i]) continue;
        _preloaded[i] = true;
        const im = new Image(); im.src = PHOTOS[i];
      }
    }
    // O contador vira o retorno visual da navegação: se a próxima foto ainda não
    // chegou, ele avisa em vez de deixar o toque sem resposta nenhuma.
    function cImgSettled() {
      const car = document.getElementById('carousel');
      if (car) { car.classList.remove('c-pending'); car.removeAttribute('aria-busy'); }
    }
    window.cImgSettled = cImgSettled;
    function cGoto(n) {
      if (!PHOTOS.length) return;
      cur = ((n % PHOTOS.length) + PHOTOS.length) % PHOTOS.length;
      const img = document.getElementById('c-img');
      const car = document.getElementById('carousel');
      if (img) {
        img.style.opacity = '0';
        img.src = PHOTOS[cur];
        // Imagem já em cache decodifica antes do próximo frame: só marcamos
        // como "carregando" se ela realmente não estiver pronta, senão o
        // indicador pisca à toa em toda navegação.
        if (car && !img.complete) { car.classList.add('c-pending'); car.setAttribute('aria-busy', 'true'); }
      }
      document.querySelectorAll('.c-dot').forEach((d, i) => d.classList.toggle('on', i === cur));
      const cnt = document.getElementById('c-count');
      if (cnt) cnt.textContent = (cur + 1) + ' / ' + PHOTOS.length;
      preloadAround();
    }
    function cGo(dir) { if (window.perfCount) perfCount('navCount'); cGoto(cur + dir); }
    const car = document.getElementById('carousel');
    if (car) {
      let tx = 0;
      car.addEventListener('touchstart', e => { tx = e.touches[0].clientX; }, { passive: true });
      car.addEventListener('touchend', e => { if (Math.abs(tx - e.changedTouches[0].clientX) > 40) cGo(tx > e.changedTouches[0].clientX ? 1 : -1); });
      preloadAround();
      // Um tablet girado troca de faixa de largura: reavalia o alcance.
      addEventListener('orientationchange', preloadAround);
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
      hideAdblockWarn('rem-adblock');
      document.getElementById('rem-form').style.display = 'block';
      document.getElementById('rem-success').style.display = 'none';
      remTsToken = '';
      const btn = document.getElementById('rem-submit');
      if (btn) btn.disabled = true;
      document.getElementById('rem-modal').classList.add('open');
      document.body.style.overflow = 'hidden';
      updateStickyCta();
      setTimeout(() => {
        // No Turnstile (blocked by an ad-blocker / privacy extension): this form
        // requires server-side verification, so warn the visitor and keep submit
        // disabled rather than letting every attempt fail with a 403.
        if (tsUnavailable()) { showAdblockWarn('rem-adblock'); if (btn) btn.disabled = true; return; }
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

    // ---- Idle-attention pulse on the main CTA: draw the eye if the visitor
    // hasn't opened the Drive modal within a while. Cleared the moment they do.
    var ctaAttnTimer = setTimeout(function() {
      document.querySelectorAll('.btn-drive:not(.btn-soon), .sticky-cta').forEach(function(b) { b.classList.add('drive-attn'); });
    }, 11000);
    function clearCtaAttn() {
      clearTimeout(ctaAttnTimer);
      document.querySelectorAll('.btn-drive, .sticky-cta').forEach(function(b) { b.classList.remove('drive-attn'); });
    }

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
  <script src="https://challenges.cloudflare.com/turnstile/v0/api.js" async defer onload="initDriveTurnstile()" onerror="window.__tsBlocked=true"></script>
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
