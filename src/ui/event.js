import { escape, formatDatePT, sizedDriveThumb, safeUrl, ACCESS_DECLARATIONS, perfBootScript, footerLegalLinksHTML, igCreditButtonHTML, updateBannerHTML, fontPreconnectHTML, photoPreconnectHTML, socialMetaHTML, ogImageFor, previewDescription, OG_IMAGE_W, OG_IMAGE_H, analyticsBeaconHTML } from '../utils.js';
import { honeypotFieldHTML, HONEYPOT_CSS } from '../security.js';

const SITE_URL = 'https://fotos.lucafchala.com';

/**
 * @param {import('../utils.js').Evento} event
 * @param {number|string} year
 * @param {string|null} analyticsToken
 * @param {string} [nonce]
 * @param {string} [driveNonce]
 * @param {string} [removalFormToken]
 */
export function eventHTML(event, year, analyticsToken, nonce = '', driveNonce = '', removalFormToken = '') {
  // Category-specific self-declaration required at the gateway, on top of the Terms
  // acceptance. Empty for 'public' (and any legacy event without accessType).
  const declaration = /** @type {Record<string, string>} */ (ACCESS_DECLARATIONS)[event.accessType] || '';

  // "Em breve" sem data = evento futuro ainda sem data marcada, então cai no
  // caso "fotos não ficaram prontas" — não dá pra dizer "adiantando" sem data.
  const eventDateMs = event.date ? new Date(event.date).getTime() : NaN;
  const eventIsFuture = !Number.isNaN(eventDateMs) && eventDateMs > Date.now();
  // safeUrl aplicado aqui na origem, não na interpolação: photos.length decide
  // o layout (bolinhas, contador "1/N") e displayPhotos fornece as URLs —
  // filtrar só a segunda faria as duas divergirem em tamanho. escape() fecha o
  // atributo mas não mata o esquema (javascript:), daí o par escape(safeUrl(x))
  // — vale também para photosJSON, que o lightbox usa sem parsing de HTML.
  const photos = (Array.isArray(event.photos) && event.photos.length > 0)
    ? event.photos.map(safeUrl).filter(Boolean)
    : (safeUrl(event.thumbnailUrl) ? [safeUrl(event.thumbnailUrl)] : []);

  // Teasers, not downloads — request right-sized Drive thumbnails so the page loads fast.
  const displayPhotos = photos.map(/** @param {string} u */ u => sizedDriveThumb(u, 1600));

  const photosJSON  = JSON.stringify(displayPhotos).replace(/</g, '\\u003c').replace(/>/g, '\\u003e');
  const slugJSON    = JSON.stringify(event.slug || '');
  // Imagem do cartão de link. O PNG de "em breve" tem exatamente OG_IMAGE_W ×
  // OG_IMAGE_H (ver handleComingSoonOgImage), então nos dois caminhos as
  // dimensões são conhecidas e o WhatsApp monta o cartão grande.
  const ogImage = event.comingSoon
    ? { url: `${SITE_URL}/og-coming-soon.png`, width: OG_IMAGE_W, height: OG_IMAGE_H }
    : ogImageFor(photos[0]);

  // Fatos que abrem a descrição do cartão, na ordem em que importam a quem
  // recebe o link: quando foi, com quem foi feito, que tipo de projeto é e se
  // o acesso é restrito. O crédito vem logo depois da data porque é a primeira
  // informação que o destinatário procura quando o evento é de uma instituição
  // — e porque o WhatsApp corta o resto.
  const restrictedAccess = event.accessType === 'private' || event.accessType === 'family';
  const ogDescription = previewDescription([
    event.comingSoon ? 'Em breve' : '',
    event.date ? formatDatePT(event.date) : '',
    event.eventCredits ? `Em colaboração com ${event.eventCredits}` : '',
    event.category || '',
    restrictedAccess ? 'Acesso restrito' : '',
  ], event.longDescription || '') || 'Fotografias de Luca F. Chala.';

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
      ? `<div class="hero"><img src="${escape(displayPhotos[0])}" alt="${escape(event.title)}" class="hero-blur-img" fetchpriority="high" decoding="async" data-onerror="heroImgError"><div class="hero-soon-ov">${clockIcon(56)}<span>Em breve</span></div></div>`
      : `<div class="hero"><div class="hero-ph hero-soon">${clockIcon(56)}<span>Em breve</span></div></div>`
    : photos.length === 0
      ? `<div class="hero"><div class="hero-ph">${camIcon(48)}</div></div>`
      : photos.length === 1
        ? `<div class="hero"><img src="${escape(displayPhotos[0])}" alt="${escape(event.title)}" fetchpriority="high" decoding="async" data-onerror="heroImgError" tabindex="0" role="button" aria-label="Ampliar foto" data-action="openLightbox" data-i="0" data-keydown="openLightbox0"></div>`
        : `<div class="carousel" id="carousel">
          <img id="c-img" src="${escape(displayPhotos[0])}" alt="${escape(event.title)}" fetchpriority="high" decoding="async" data-onload="cImgLoad" data-onerror="cImgError" data-action="openLightbox">
          <button class="c-btn c-prev" data-action="cGoPrev" aria-label="Anterior">
            <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="15 18 9 12 15 6"/></svg>
          </button>
          <button class="c-btn c-next" data-action="cGoNext" aria-label="Próxima">
            <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="9 18 15 12 9 6"/></svg>
          </button>
          <div class="c-dots">${photos.map((_, i) => `<span class="c-dot${i === 0 ? ' on' : ''}" data-action="cGoto" data-i="${i}"></span>`).join('')}</div>
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
  <!-- Microsoft Clarity: replace PROJECT_ID with your Clarity project ID -->
  <!-- <script type="text/javascript">
    (function(c,l,a,r,i,t,y){
        c[a]=c[a]||function(){(c[a].q=c[a].q||[]).push(arguments)};
        t=l.createElement(r);t.async=1;t.src="https://www.clarity.ms/tag/"+i;
        y=l.getElementsByTagName(r)[0];y.parentNode.insertBefore(t,y);
    })(window, document, "clarity", "script", "PROJECT_ID");
  </script> -->
  ${socialMetaHTML({
    title: event.title,
    description: ogDescription,
    url: `${SITE_URL}/${event.slug}`,
    type: 'article',
    image: ogImage.url,
    imageAlt: `Foto de ${event.title}`,
    imageWidth: ogImage.width,
    imageHeight: ogImage.height,
  })}
  ${event.date ? `<meta property="article:published_time" content="${escape(event.date)}">` : ''}
  <!-- article:author quer o PERFIL, não o nome: /sobre é a página que declara
       og:type=profile, então o par fecha em vez de repetir a string. -->
  <meta property="article:author" content="${SITE_URL}/sobre">
  ${fontPreconnectHTML()}
  <link rel="preconnect" href="https://drive.google.com">
  ${photoPreconnectHTML()}
  ${perfBootScript('event', !!analyticsToken, nonce)}
  <script type="application/ld+json" nonce="${nonce}">${JSON.stringify([
    {
      '@context': 'https://schema.org',
      '@type': 'BreadcrumbList',
      itemListElement: [
        { '@type': 'ListItem', position: 1, name: 'Início', item: SITE_URL },
        { '@type': 'ListItem', position: 2, name: year, item: `${SITE_URL}/?year=${year}` },
        // Sem escape() aqui: o valor é serializado por JSON.stringify e o bloco
        // inteiro sai com < e > neutralizados na linha de baixo. escape() antes
        // disso injetava ENTIDADE HTML dentro do JSON — um slug com "&" virava
        // "&amp;" no item da trilha, uma URL que não existe. O PhotoGallery
        // abaixo já fazia certo; eram os dois discordando sobre o mesmo campo.
        { '@type': 'ListItem', position: 3, name: event.title, item: `${SITE_URL}/${event.slug}` },
      ],
    },
    // Mesmo conjunto de fatos do cartão de link, na forma que o buscador lê.
    // creditText (e não contributor) porque o campo do painel aceita tanto
    // instituição quanto fotógrafo colaborador ou projeto — declarar
    // Organization onde pode haver Person seria afirmar o que não se sabe.
    {
      '@context': 'https://schema.org',
      '@type': 'PhotoGallery',
      name: event.title,
      url: `${SITE_URL}/${event.slug}`,
      inLanguage: 'pt-BR',
      description: ogDescription,
      author: { '@type': 'Person', name: 'Luca F. Chala', url: `${SITE_URL}/sobre` },
      ...(ogImage.url ? { image: ogImage.url } : {}),
      ...(event.date ? { datePublished: event.date } : {}),
      ...(event.eventCredits ? { creditText: event.eventCredits } : {}),
      ...(event.category ? { genre: event.category } : {}),
    },
  ]).replace(/</g, '\\u003c').replace(/>/g, '\\u003e')}</script>
  <link href="https://fonts.googleapis.com/css2?family=Inter:ital,wght@0,300;0,400;0,500;0,600;1,400&display=swap" rel="stylesheet">
  <style>
    *,*::before,*::after{box-sizing:border-box;margin:0;padding:0}
    :root{
      --bg-page:#0a0a0a; --text:#f0ebe5; --text-2:#bbb; --text-muted:#999; --text-dim:#555; --text-dim-2:#666;
      --bg-card:#141414; --bg-card-2:#1c1c1c; --bg-card-hover:#242424; --bg-card-border:#3a3a3a;
      --border-dim:#191919; --border-dim-2:#444; --border-hair:#111;
      --footer-link:#777; --accent:#c0a060; --accent-hover:#d4b070; --cta-bg:#c0a060; --cta-text:#0a0a0a;
      --ok-bg:#0d1a0d; --ok-border:#1a3a1a; --ok-text:#8ac88a; --ok-text-strong:#a8d8a8; --ok-text-muted:#6aaa6a; --ok-dot:#5aaa5a;
      --err-bg:#1a0a0a; --err-border:#2e1a1a; --err-text:#cc8888; --err-text-strong:#e0a0a0;
      --warn-bg:#1d1606; --warn-border:#4a3a12; --warn-text:#d8b25a; --warn-text-strong:#f0d080;
      --disabled-bg:#1a1a1a; --disabled-border:#232323; --disabled-text:#6a6a6a; --disabled-text-2:#8a8a8a;
    }
    @media (prefers-color-scheme: light) {
      :root{
        --bg-page:#f0ece8; --text:#1a1715; --text-2:#4a4744; --text-muted:#6b6460; --text-dim:#8a8480; --text-dim-2:#75706b;
        --bg-card:#fff; --bg-card-2:#f6f3ef; --bg-card-hover:#efece7; --bg-card-border:#ddd9d4;
        --border-dim:#ddd9d4; --border-dim-2:#c8c2ba; --border-hair:#e5e1db;
        --footer-link:#6b6460; --accent:#8a6428; --accent-hover:#a67d38; --cta-bg:#8a6428; --cta-text:#faf7f3;
        --ok-bg:#eaf6ea; --ok-border:#b8dab8; --ok-text:#2e7d32; --ok-text-strong:#1b5e20; --ok-text-muted:#3d8b41; --ok-dot:#2e7d32;
        --err-bg:#fdecec; --err-border:#f2c6c6; --err-text:#b3261e; --err-text-strong:#8c1d18;
        --warn-bg:#fdf3dc; --warn-border:#e8d1a0; --warn-text:#7a5a17; --warn-text-strong:#5c4310;
        --disabled-bg:#e5e1db; --disabled-border:#ddd9d4; --disabled-text:#9a9490; --disabled-text-2:#8a8480;
      }
    }
    body{font-family:'Inter',sans-serif;background:var(--bg-page);color:var(--text);min-height:100vh}
    :focus-visible{outline:2px solid var(--accent);outline-offset:2px}
    ${HONEYPOT_CSS}
    .hero-stage{position:relative}
    /* Chrome sobre a foto (back-pill, controles do carrossel) fica sempre
       escuro/translúcido nos dois temas — contraste contra a FOTO, não contra
       a página, então nunca usa as vars de tema. Idem .c-btn/.c-dots/.c-count. */
    .back-pill{position:absolute;top:.875rem;left:.875rem;z-index:3;display:inline-flex;align-items:center;gap:.4rem;text-decoration:none;color:#f0ebe5;font-size:.8rem;background:rgba(0,0,0,.45);backdrop-filter:blur(6px);-webkit-backdrop-filter:blur(6px);padding:.5rem .8rem .5rem .65rem;border-radius:20px;transition:background .2s}
    .back-pill:hover{background:rgba(0,0,0,.65)}
    .back-pill svg{width:14px;height:14px;flex-shrink:0}
    /* hero */
    .hero{width:100%;max-height:72vh;overflow:hidden;background:#0e0e0e;position:relative;display:flex;align-items:center;justify-content:center}
    /* max-width/max-height + width/height auto: a foto encolhe pra caber
       mantendo a proporção real, em vez de ser cortada — aspect-ratio+cover
       às vezes cortava cabeças em foto de grupo. */
    .hero img{max-width:100%;max-height:72vh;width:auto;height:auto;display:block;transition:opacity .25s ease;cursor:zoom-in}
    .hero-blur-img{width:100%;max-height:72vh;aspect-ratio:3/2;object-fit:cover;display:block;filter:blur(16px);transform:scale(1.08);cursor:default}
    .hero-soon-ov{position:absolute;inset:0;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:1rem;color:#3a3a3a}
    .hero-soon-ov span{font-size:.78rem;letter-spacing:.22em;text-transform:uppercase;color:#888;font-weight:500}
    .hero-ph{height:260px;display:flex;align-items:center;justify-content:center;color:#333}
    .hero-soon{flex-direction:column;gap:1rem;color:#3a3a3a;height:320px}
    .hero-soon span{font-size:.78rem;letter-spacing:.22em;text-transform:uppercase;color:#666;font-weight:500}
    .btn-soon{background:var(--bg-card);color:var(--text-muted);border:1px dashed var(--bg-card-border);cursor:pointer}
    /* Reseta o hover genérico de .btn-drive: no touch, o opacity:.9 do hover
       ficava "preso" sem mouseleave, escurecendo o botão à toa. */
    .btn-soon:hover,.btn-soon:active{background:var(--bg-card);opacity:1;transform:none}
    /* carousel */
    .carousel{position:relative;width:100%;max-height:72vh;overflow:hidden;background:#0e0e0e;user-select:none;-webkit-user-select:none;display:flex;align-items:center;justify-content:center}
    .carousel img{max-width:100%;max-height:72vh;width:auto;height:auto;display:block;transition:opacity .25s ease;cursor:zoom-in}
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
    main{max-width:680px;margin:0 auto;padding:2.25rem 1.5rem 2.5rem}
    .breadcrumbs{display:flex;align-items:center;gap:.4rem;flex-wrap:wrap;margin-bottom:1.25rem;font-size:.73rem;color:var(--text-dim)}
    .breadcrumbs a{color:var(--text-dim-2);text-decoration:none;transition:color .2s}
    .breadcrumbs a:hover{color:var(--text-2)}
    .breadcrumbs .sep{color:var(--border-dim-2)}
    .meta{margin-bottom:.875rem}
    .date-chip{font-size:.65rem;font-weight:500;letter-spacing:.12em;text-transform:uppercase;color:var(--text-dim)}
    h1{font-size:clamp(1.5rem,6vw,2.25rem);font-weight:600;line-height:1.15;margin:.4rem 0 2rem}
    .desc{font-size:.95rem;line-height:1.85;color:var(--text-2);white-space:pre-wrap;word-break:break-word;margin-bottom:2.75rem}
    .drive-wrap{margin-bottom:3rem}
    .btn-drive{display:inline-flex;align-items:center;gap:.65rem;background:var(--cta-bg);color:var(--cta-text);border:none;padding:.9rem 1.6rem;border-radius:9px;font-size:.9rem;font-weight:600;letter-spacing:.02em;cursor:pointer;transition:background .18s,transform .15s;width:100%;justify-content:center}
    @media(min-width:400px){.btn-drive{width:auto}}
    .btn-drive:hover{opacity:.9;transform:translateY(-2px)}
    .btn-drive svg{width:18px;height:18px;flex-shrink:0}
    /* sticky mobile CTA */
    .sticky-cta{display:none}
    .sticky-cta svg{width:16px;height:16px;flex-shrink:0}
    @media(max-width:559px){
      .sticky-cta{display:flex;align-items:center;justify-content:center;gap:.5rem;position:fixed;left:1rem;right:1rem;bottom:1rem;z-index:40;background:var(--cta-bg);color:var(--cta-text);border:none;padding:.85rem;border-radius:10px;font-size:.875rem;font-weight:600;cursor:pointer;box-shadow:0 8px 24px rgba(0,0,0,.5);transform:translateY(160%);transition:transform .25s ease}
      .sticky-cta.show{transform:translateY(0)}
      /* Clearance for the fixed CTA lives at the very end of the page (after
         the footer), not as dead space between the credits and the footer —
         it only matters once someone scrolls all the way down anyway. */
      footer{padding-bottom:6rem}
    }
    /* credits */
    .credits{border-top:1px solid var(--border-dim);padding-top:2.25rem}
    .credits-title{font-size:.65rem;font-weight:500;letter-spacing:.14em;text-transform:uppercase;color:var(--text-dim);margin-bottom:1rem}
    .credits-list{display:flex;flex-direction:column;gap:.5rem;margin-bottom:1rem}
    .credits-list a,.credits-list span{font-size:.85rem;line-height:1.5;color:var(--text-muted);text-decoration:none;transition:color .2s;display:block}
    .credits-list span strong,.credits-list a strong{color:var(--text);font-weight:600}
    .credits-list a:hover{color:var(--text-2)}
    .ig-credit-btn{display:inline-flex;align-items:center;gap:.6rem;background:var(--bg-card-2);border:1px solid var(--bg-card-border);color:var(--text);text-decoration:none;padding:.65rem 1rem;border-radius:24px;font-size:.85rem;font-weight:500;transition:border-color .2s,background .2s,transform .15s}
    .ig-credit-btn:hover{background:var(--bg-card-hover);border-color:#dc2743;transform:translateY(-1px)}
    .ig-credit-icon{display:inline-flex;flex-shrink:0}
    .ig-credit-text strong{font-weight:700;color:var(--text)}
    /* Na lista de créditos o botão do Instagram vira mais uma linha do grupo,
       não um pill solto — a versão na guide-box do modal mantém o visual original. */
    .credits-list .ig-credit-btn{display:inline-flex;align-items:center;background:none;border:none;padding:0;border-radius:0;color:var(--text-muted);gap:.5rem}
    .credits-list .ig-credit-btn:hover{background:none;border-color:transparent;color:var(--text-2);transform:none}
    .credits-list .ig-credit-text strong{color:var(--text)}
    /* banner */
    .photos-banner{background:var(--ok-bg);border-bottom:1px solid var(--ok-border);padding:.75rem 1.5rem;display:flex;align-items:center;justify-content:center;gap:.625rem}
    .banner-inner{display:flex;align-items:center;gap:.5rem;font-size:.82rem;color:var(--ok-text);max-width:680px;width:100%}
    .banner-dot{width:7px;height:7px;border-radius:50%;background:var(--ok-dot);flex-shrink:0;animation:pulse 2s infinite}
    @keyframes pulse{0%,100%{opacity:1}50%{opacity:.4}}
    .banner-text strong{color:var(--ok-text-strong)}
    .banner-time{color:var(--ok-text-muted)}
    /* footer — plain links, industry-standard, no button chrome. Emphasis on
       Share/removal comes from contrast + weight + being the top row, not
       from a button shape. */
    footer{padding:2rem 1.5rem 3rem;border-top:1px solid var(--border-hair);margin-top:2rem;display:flex;flex-direction:column;align-items:center;gap:1rem}
    .footer-brand{color:var(--footer-link);font-size:.8rem;text-decoration:none;letter-spacing:.1em;transition:color .2s;flex-shrink:0}
    .footer-brand:hover{color:var(--text-2)}
    .footer-actions-primary{display:flex;align-items:center;gap:1.25rem;flex-wrap:wrap;justify-content:center}
    .action-btn{display:inline-flex;align-items:center;gap:.4rem;background:none;border:none;color:var(--text-2);padding:.35rem 0;font-size:.85rem;font-weight:600;letter-spacing:.02em;cursor:pointer;text-decoration:none;transition:color .2s;white-space:nowrap}
    .action-btn:hover{color:var(--text);text-decoration:underline;text-underline-offset:3px}
    .action-btn svg{width:15px;height:15px;flex-shrink:0}
    .footer-actions-legal{display:flex;align-items:center;gap:1.25rem;flex-wrap:wrap;justify-content:center;margin-top:.25rem}
    .legal-link{display:inline-flex;align-items:center;gap:.4rem;background:none;border:none;color:var(--text-muted);padding:.35rem 0;font-size:.8rem;font-weight:500;letter-spacing:.02em;text-decoration:none;transition:color .2s;white-space:nowrap}
    .legal-link:hover{color:var(--text-2);text-decoration:underline;text-underline-offset:3px}
    .footer-copyright{font-size:.75rem;color:var(--footer-link);letter-spacing:.03em;text-align:center;width:100%;margin-top:.5rem}
    /* shared modal base — the scrim behind the sheet stays a fixed dark
       translucency regardless of theme (dimming, not page chrome); only the
       sheet itself (the card floating on it) follows the vars. */
    .modal-ov{position:fixed;inset:0;background:rgba(0,0,0,.82);z-index:50;display:none;align-items:flex-end;justify-content:center}
    .modal-ov.open{display:flex}
    @media(min-width:580px){.modal-ov{align-items:center;padding:1.5rem}}
    .modal-sheet{background:var(--bg-card);width:100%;max-width:500px;border-radius:18px 18px 0 0;max-height:92vh;max-height:92dvh;overflow-y:auto;overscroll-behavior:contain;-webkit-overflow-scrolling:touch;padding:1.5rem 1.5rem max(3rem,calc(2rem + env(safe-area-inset-bottom)))}
    @media(min-width:580px){.modal-sheet{border-radius:14px;max-height:90vh;max-height:90dvh;padding-bottom:2.25rem}}
    .modal-head{display:flex;align-items:center;justify-content:space-between;margin-bottom:1.5rem}
    .modal-head h2{font-size:.975rem;font-weight:600}
    .m-close{background:none;border:1px solid var(--border-dim);color:var(--text-dim);width:32px;height:32px;border-radius:50%;display:flex;align-items:center;justify-content:center;cursor:pointer;flex-shrink:0;transition:border-color .2s,color .2s}
    .m-close:hover{border-color:var(--border-dim-2);color:var(--text-2)}
    /* drive modal */
    .guide-box{border-left:3px solid var(--accent);background:var(--bg-card);border-radius:0 10px 10px 0;padding:1.125rem 1.25rem;margin-bottom:1.25rem}
    .guide-title{font-size:.8rem;font-weight:700;letter-spacing:.1em;text-transform:uppercase;color:var(--accent);margin-bottom:.75rem}
    .guide-note{font-size:.85rem;line-height:1.65;color:var(--text-2);margin-bottom:.875rem}
    .guide-note:last-child{margin-bottom:0}
    .guide-credit{color:var(--text-muted)}
    .drive-verifying{display:block;margin-top:1rem}
    .dv-msg{color:var(--err-text);font-size:.85rem;line-height:1.6}
    .dv-retry{background:none;border:none;color:var(--err-text-strong);text-decoration:underline;text-underline-offset:2px;cursor:pointer;font:inherit;padding:0}
    .dv-contact{color:var(--err-text);font-size:.85rem;line-height:1.6;margin-top:.625rem;padding-top:.625rem;border-top:1px solid var(--err-border)}
    .dv-contact a{color:var(--err-text-strong);text-decoration:underline;text-underline-offset:2px;font-weight:600}
    .spin{width:14px;height:14px;border:2px solid var(--border-dim);border-top-color:var(--text-muted);border-radius:50%;animation:spin .7s linear infinite;flex-shrink:0}
    @keyframes spin{to{transform:rotate(360deg)}}
    .drive-consent{display:flex;align-items:flex-start;gap:.5rem;cursor:pointer;margin-top:1.25rem;font-size:.85rem;color:var(--text-2);line-height:1.5;border-radius:8px}
    .drive-consent input{width:18px;height:18px;accent-color:var(--accent);flex-shrink:0;margin-top:1px}
    .drive-consent a{color:var(--accent)}
    .flash-warn{animation:flashWarn 1.3s ease}
    @keyframes flashWarn{0%,100%{box-shadow:none}25%,65%{box-shadow:0 0 0 2px #a9714a}}
    .drive-name-toggle{background:none;border:none;color:var(--text-dim-2);font-size:.74rem;cursor:pointer;margin-top:.625rem;padding:0;text-decoration:underline}
    .drive-name-toggle:hover{color:var(--text-muted)}
    #drive-gate-hint{font-size:.82rem;color:var(--warn-text);line-height:1.5;margin-top:.875rem}
    .drive-dl-tip{font-size:.82rem;color:var(--text-2);line-height:1.55;margin-top:1rem;padding:.7rem .875rem;background:var(--bg-card);border-radius:8px}
    .drive-dl-tip strong{color:var(--text)}
    .drive-consent-note{font-size:.8rem;color:var(--text-dim);line-height:1.5;margin-top:.875rem}
    .drive-consent-note a{color:var(--footer-link)}
    .drive-locked .btn-drive-go,.drive-locked .btn-drive-opt{background:var(--disabled-bg);border-color:var(--disabled-border);color:var(--disabled-text);cursor:not-allowed}
    .drive-locked .btn-drive-go:hover,.drive-locked .btn-drive-opt:hover{background:var(--disabled-bg);transform:none;border-color:var(--disabled-border)}
    .drive-locked .btn-drive-opt svg{color:var(--text-dim)}
    .drive-locked .drive-opt-text strong{color:var(--disabled-text-2)}
    .drive-locked .drive-opt-text span{color:var(--text-dim)}
    .btn-drive-go{display:flex;align-items:center;justify-content:center;gap:.65rem;background:var(--cta-bg);color:var(--cta-text);border:none;padding:.875rem 1.5rem;border-radius:9px;font-size:.875rem;font-weight:600;cursor:pointer;margin-top:1rem;width:100%;text-decoration:none;transition:background .18s,transform .15s,box-shadow .3s}
    .btn-drive-go:hover{opacity:.9;transform:translateY(-1px)}
    .btn-drive-go svg{width:18px;height:18px;flex-shrink:0}
    .drive-opts{display:flex;flex-direction:column;gap:.5rem;margin-top:1rem}
    .btn-drive-opt{display:flex;align-items:center;gap:.875rem;background:var(--bg-card-2);border:1px solid var(--bg-card-border);color:var(--text);padding:.9rem 1.1rem;border-radius:10px;text-decoration:none;transition:border-color .18s,background .18s,box-shadow .3s;width:100%}
    .btn-drive-opt:hover{border-color:var(--border-dim-2);background:var(--bg-card-hover)}
    .btn-drive-opt svg{width:20px;height:20px;flex-shrink:0;color:var(--text-muted)}
    .drive-opt-text{display:flex;flex-direction:column;gap:.15rem}
    .drive-opt-text strong{font-size:.875rem;font-weight:600;color:var(--text)}
    .drive-opt-text span{font-size:.72rem;color:var(--disabled-text-2);font-weight:400}
    .btn-icon{display:inline-flex}
    .btn-spin{display:none}
    .drive-loading .btn-icon{display:none}
    .drive-loading .btn-spin{display:inline-flex}
    .drive-attn{animation:driveAttn 1.6s ease-in-out infinite}
    @keyframes driveAttn{0%,100%{box-shadow:0 0 0 0 rgba(192,160,96,0)}50%{box-shadow:0 0 0 5px rgba(192,160,96,.22)}}
    /* removal modal */
    .rem-intro{font-size:.875rem;color:var(--text-muted);line-height:1.6;margin-bottom:1.5rem}
    .rem-field{display:flex;flex-direction:column;gap:.45rem;margin-bottom:1.125rem}
    .rem-field label{font-size:.7rem;font-weight:500;letter-spacing:.08em;text-transform:uppercase;color:var(--text-dim)}
    .rem-field input[type=text],.rem-field input[type=email],.rem-field input[type=tel],.rem-field input[type=url],.rem-field input[type=number],.rem-field textarea{width:100%;background:var(--bg-card);border:1px solid var(--border-dim);color:var(--text);padding:.75rem .875rem;border-radius:8px;font-size:.875rem;outline:none;transition:border-color .2s;-webkit-appearance:none}
    .rem-field input:focus,.rem-field textarea:focus{border-color:var(--bg-card-border)}
    .rem-field input.bad,.rem-field textarea.bad{border-color:var(--err-border)}
    .rem-field textarea{resize:vertical;min-height:80px;line-height:1.5}
    .rem-field input[type=file]{color:var(--text-muted);font-size:.8rem;width:100%}
    .radio-group{display:flex;flex-direction:column;gap:.5rem}
    .radio-opt{display:flex;align-items:center;gap:.625rem;cursor:pointer;padding:.5rem .75rem;border:1px solid var(--border-dim);border-radius:8px;transition:border-color .2s;min-height:44px}
    .radio-opt:has(input:checked){border-color:var(--bg-card-border);background:var(--bg-card)}
    .radio-opt input[type=radio]{width:16px;height:16px;accent-color:var(--text);flex-shrink:0}
    .radio-opt span{font-size:.875rem;color:var(--text-2)}
    .form-error{background:var(--err-bg);border:1px solid var(--err-border);color:var(--err-text);padding:.6rem .8rem;border-radius:8px;font-size:.78rem;line-height:1.5;margin-top:1rem}
    .adblock-warn{background:var(--warn-bg);border:1px solid var(--warn-border);color:var(--warn-text);padding:.7rem .85rem;border-radius:8px;font-size:.78rem;line-height:1.55;margin-top:1rem}
    .adblock-warn strong{color:var(--warn-text-strong)}
    .adblock-warn a{color:var(--warn-text-strong)}
    .adblock-warn button{background:none;border:none;color:var(--warn-text-strong);text-decoration:underline;cursor:pointer;font:inherit;padding:0}
    .noscript-banner{background:var(--warn-bg);border-bottom:1px solid var(--warn-border);color:var(--warn-text);padding:.85rem 1.25rem;font-size:.82rem;line-height:1.55;text-align:center}
    .noscript-banner strong{color:var(--warn-text-strong)}
    .noscript-banner a{color:var(--warn-text-strong)}
    .rem-sheet-foot{display:flex;gap:.75rem;margin-top:1.25rem;position:sticky;bottom:0;background:var(--bg-card);padding:.875rem 0 .25rem;border-top:1px solid var(--border-dim)}
    .btn-rem-cancel{flex:1;background:none;border:1px solid var(--border-dim);color:var(--text-muted);padding:.8rem;border-radius:8px;font-size:.875rem;font-weight:500;cursor:pointer;transition:border-color .2s}
    .btn-rem-cancel:hover{border-color:var(--bg-card-border)}
    .btn-rem-submit{flex:2;background:var(--cta-bg);color:var(--cta-text);border:none;padding:.8rem;border-radius:8px;font-size:.875rem;font-weight:600;cursor:pointer;transition:opacity .18s}
    .btn-rem-submit:disabled{opacity:.5;cursor:not-allowed}
    .btn-rem-submit:not(:disabled):hover{opacity:.88}
    .rem-success{text-align:center;padding:2rem 0;color:var(--ok-text);font-size:.9rem;line-height:1.7}
    .rem-success svg{margin-bottom:.75rem;color:var(--ok-dot)}
    /* new-interface banner */
    .update-banner{background:var(--warn-bg);border-bottom:1px solid var(--warn-border);padding:.7rem 1.25rem;display:flex;align-items:center;justify-content:center;gap:.75rem;flex-wrap:wrap;font-size:.82rem;color:var(--warn-text);text-align:center}
    .update-banner a{color:var(--accent);text-decoration:underline;text-underline-offset:2px}
    .update-banner a:hover{color:var(--accent-hover)}
    .update-banner .ub-close{background:none;border:none;color:var(--text-dim-2);cursor:pointer;font-size:1.1rem;line-height:1;padding:0 .25rem;flex-shrink:0}
    .update-banner .ub-close:hover{color:var(--warn-text)}
    /* cookie notice */
    .cookie-notice{position:fixed;left:1rem;right:1rem;bottom:1rem;max-width:520px;margin:0 auto;background:var(--bg-card);border:1px solid var(--bg-card-border);border-radius:10px;padding:.875rem 1rem;display:none;align-items:center;gap:.875rem;font-size:.76rem;color:var(--text-muted);line-height:1.5;z-index:80;box-shadow:0 8px 24px rgba(0,0,0,.4)}
    .cookie-notice.show{display:flex}
    .cookie-notice a{color:var(--accent);text-decoration:none}
    .cookie-notice a:hover{text-decoration:underline}
    .cookie-notice button{flex-shrink:0;background:var(--cta-bg);color:var(--cta-text);border:none;padding:.5rem 1rem;border-radius:7px;font-size:.74rem;font-weight:600;cursor:pointer;transition:opacity .18s}
    .cookie-notice button:hover{opacity:.85}
    /* lightbox — chrome sits on a full-bleed dark scrim, same "always dark,
       contrast against the photo not the page" rule as the carousel controls. */
    .lightbox-ov{position:fixed;inset:0;background:rgba(0,0,0,.92);z-index:90;display:none;align-items:center;justify-content:center}
    .lightbox-ov.open{display:flex}
    #lb-img{max-width:100vw;max-height:100vh;object-fit:contain;transition:transform .2s ease;touch-action:pan-y}
    .lb-close{position:absolute;top:1rem;right:1rem;background:rgba(0,0,0,.55);border:none;color:#fff;width:40px;height:40px;border-radius:50%;font-size:1.4rem;line-height:1;cursor:pointer;z-index:2}
    .lb-prev{left:1rem}.lb-next{right:1rem}
    #lb-count{bottom:1rem;left:50%;transform:translateX(-50%)}
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
  ${updateBannerHTML()}
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
    <nav class="breadcrumbs" aria-label="Breadcrumb">
      <a href="/">Início</a>
      <span class="sep">·</span>
      <a href="/?year=${escape(year)}">${escape(year)}</a>
      <span class="sep">·</span>
      <span>${escape(event.title)}</span>
    </nav>
    <div class="meta">
      ${event.date ? `<span class="date-chip">${escape(formatDatePT(event.date))}</span>` : ''}
    </div>
    <h1>${escape(event.title)}</h1>
    ${event.longDescription ? `<div class="desc">${escape(event.longDescription)}</div>` : ''}

    <div class="drive-wrap">
      ${event.comingSoon
        ? `<button type="button" class="btn-drive btn-soon" data-action="openSoonModal">
            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>
            As fotos virão em breve
          </button>`
        : `<button class="btn-drive" data-action="openModal">
            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><rect x="3" y="3" width="18" height="18" rx="2"/><path d="M9 3v18M15 3v18M3 9h18M3 15h18" stroke-width="1.2"/></svg>
            Acessar fotos
          </button>`}
    </div>

    <div class="credits">
      <div class="credits-title">Créditos</div>
      <div class="credits-list">
        ${event.eventCredits ? `<span>Em colaboração com: <strong>${escape(event.eventCredits)}</strong></span>` : ''}
        ${safeUrl(event.projectUrl) ? `<a href="${escape(safeUrl(event.projectUrl))}" target="_blank" rel="noopener">🔗 ${escape(event.projectUrl)}</a>` : ''}
        ${igCreditButtonHTML('1')}
      </div>
    </div>
  </main>

  <footer>
    <a href="/" class="footer-brand">fotos · Luca F. Chala</a>
    <div class="footer-actions-primary">
      <button class="action-btn" id="btn-share-native" style="display:none" data-action="doNativeShare">
        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="15" height="15"><path d="M4 12v8a2 2 0 002 2h12a2 2 0 002-2v-8"/><polyline points="16 6 12 2 8 6"/><line x1="12" y1="2" x2="12" y2="15"/></svg>
        Compartilhar
      </button>
      <!-- encodeURIComponent ANTES do escape(), e os dois são necessários: o
           valor vai para dentro de uma query string que também é atributo HTML.
           Só com escape() um "&" no título virava "&amp;", que o WhatsApp lê
           como fim do parâmetro — "Turma A & B" chegava como "Veja as fotos de
           Turma A " e o resto da frase, com o link, sumia. -->
      <a href="https://wa.me/?text=${escape(encodeURIComponent(`Veja as fotos de ${event.title} em ${SITE_URL.replace(/^https:\/\//, '')}/${event.slug}`))}" target="_blank" rel="noopener" class="action-btn" id="btn-share-wa">
        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" width="15" height="15"><path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413z"/></svg>
        WhatsApp
      </a>
      <button class="action-btn" id="btn-copy-link" style="display:none" data-action="copyLink">
        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 01-2-2V4a2 2 0 012-2h9a2 2 0 012 2v1"/></svg>
        <span id="copy-label">Copiar link</span>
      </button>
      <button class="action-btn" data-action="openRemModal">
        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14H6L5 6"/><path d="M10 11v6M14 11v6"/><path d="M9 6V4h6v2"/></svg>
        Solicitar remoção de foto
      </button>
    </div>
    ${footerLegalLinksHTML()}
  </footer>

  ${!event.comingSoon ? `<button class="sticky-cta" id="sticky-cta" data-action="openModal" aria-label="Acessar fotos">
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><rect x="3" y="3" width="18" height="18" rx="2"/><path d="M9 3v18M15 3v18M3 9h18M3 15h18" stroke-width="1.2"/></svg>
    Acessar fotos
  </button>` : ''}

  <!-- DRIVE MODAL -->
  <div class="modal-ov" id="modal">
    <div class="modal-sheet" role="dialog" aria-modal="true" aria-label="Acessar fotos">
      <div class="modal-head">
        <h2>Acessar fotos</h2>
        <button class="m-close" data-action="closeModal" aria-label="Fechar">
          <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
        </button>
      </div>
      <div class="guide-box">
        <div class="guide-title">Antes de acessar</div>
        <p class="guide-note">Baixe as fotos pelo Google Drive — <strong>evite print de tela</strong>, a foto perde qualidade e resolução. Baixar direto do Drive garante o arquivo original.</p>
        <p class="guide-note">Não compartilhe o link do Drive diretamente — quem tiver esse link consegue acessar. Para compartilhar esta galeria, use o botão <strong>Compartilhar</strong> no rodapé da página.</p>
        ${igCreditButtonHTML('2')}
        ${event.eventCredits ? `<p class="guide-note guide-credit">Em colaboração com: <strong>${escape(event.eventCredits)}</strong></p>` : ''}
      </div>
      <div id="drive-adblock" class="adblock-warn" style="display:none">
        <strong>⚠️ Bloqueador de anúncios detectado.</strong> Você ainda pode acessar as fotos, mas a verificação de segurança não carregou. Para registrarmos seu consentimento de uso de imagem corretamente, recomendamos <button type="button" data-action="reload">desativar o bloqueador e recarregar</button> (e ativar o JavaScript, caso esteja desativado).
      </div>
      <div id="drive-gate">
        <!--
          Nome vem ANTES do aceite de propósito: marcar o aceite dispara o
          pedido na hora (maybeFetchDriveLink lê o campo naquele instante), e
          com o campo embaixo o texto digitado depois do aceite era descartado
          em silêncio — o estado já ficava "ready" e não há um segundo pedido.
        -->
        <button type="button" id="drive-name-toggle" class="drive-name-toggle" style="margin-top:0;margin-bottom:.625rem" data-action="toggleDriveName">+ incluir meu nome (opcional)</button>
        <div id="drive-name-wrap" class="rem-field" style="display:none;margin-top:0;margin-bottom:.75rem">
          <input type="text" id="drive-name" placeholder="Seu nome (opcional)" maxlength="120" autocomplete="name">
        </div>
        ${declaration ? `<label class="drive-consent">
          <input type="checkbox" id="drive-declaration" data-onchange="onDriveConsent">
          <span>${escape(declaration)}</span>
        </label>` : ''}
        <label class="drive-consent">
          <input type="checkbox" id="drive-consent" data-onchange="onDriveConsent">
          <span>Li e aceito os <a href="/termos" target="_blank" rel="noopener">Termos de Uso</a> e autorizo o uso da minha imagem conforme descrito neles.</span>
        </label>
        <p id="drive-gate-hint" style="display:none"></p>
        <div id="drive-verify-error" class="drive-verifying" style="display:none">
          <p class="dv-msg">Verificação de segurança demorando mais que o esperado. Desative o bloqueador de anúncios para este site (e ative o JavaScript, caso esteja desativado) e recarregue a página.</p>
          <p class="dv-contact">Se continuar, <a href="/suporte">fale comigo</a> ou, se for urgente, <a href="https://wa.me/5511989211178" target="_blank" rel="noopener">me chame no WhatsApp</a>.</p>
        </div>
        <div id="drive-link-error" class="drive-verifying" style="display:none">
          <p class="dv-msg">Não foi possível liberar o acesso. <button type="button" data-action="retryDriveLink" class="dv-retry">Tentar novamente</button></p>
          <p class="dv-contact">Se persistir, <a href="/suporte">fale comigo</a> ou, se for urgente, <a href="https://wa.me/5511989211178" target="_blank" rel="noopener">me chame no WhatsApp</a>.</p>
        </div>
        <div id="drive-refreshed-note" class="drive-verifying" style="display:none">
          <p class="dv-msg">Esta página ficou aberta por um tempo e precisou ser atualizada. É só confirmar de novo abaixo.</p>
        </div>
        <div id="drive-links-wrap" class="drive-locked" style="margin-top:1rem">
        ${event.driveUrlInstagram
          ? `<div class="drive-opts">
              <a id="drive-link" href="#" target="_blank" rel="noopener" class="btn-drive-opt" data-action="driveLink">
                <span class="btn-icon"><svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><path d="M18 13v6a2 2 0 01-2 2H5a2 2 0 01-2-2V8a2 2 0 012-2h6"/><polyline points="15 3 21 3 21 9"/><line x1="10" y1="14" x2="21" y2="3"/></svg></span>
                <span class="btn-spin"><span class="spin"></span></span>
                <div class="drive-opt-text"><strong>Resolução completa</strong><span>Arquivos originais em alta qualidade</span></div>
              </a>
              <a id="drive-link-ig" href="#" target="_blank" rel="noopener" class="btn-drive-opt" data-action="driveLink">
                <span class="btn-icon"><svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><rect x="2" y="2" width="20" height="20" rx="5"/><circle cx="12" cy="12" r="5"/><circle cx="17.5" cy="6.5" r="1.5" fill="currentColor" stroke="none"/></svg></span>
                <span class="btn-spin"><span class="spin"></span></span>
                <div class="drive-opt-text"><strong>Para o Instagram</strong><span>Já redimensionadas e prontas para postar</span></div>
              </a>
            </div>`
          : `<a id="drive-link" href="#" target="_blank" rel="noopener" class="btn-drive-go" data-action="driveLink">
              <span class="btn-icon"><svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><path d="M18 13v6a2 2 0 01-2 2H5a2 2 0 01-2-2V8a2 2 0 012-2h6"/><polyline points="15 3 21 3 21 9"/><line x1="10" y1="14" x2="21" y2="3"/></svg></span>
              <span class="btn-spin"><span class="spin"></span></span>
              Ir para o Google Drive
            </a>`}
        </div>
        <p class="drive-dl-tip">💡 No Drive, selecione todas as fotos (ícone ⋮ ou Ctrl/Cmd+A) e use <strong>"Fazer download"</strong> para baixar tudo de uma vez em um .zip.</p>
        <p class="drive-consent-note">Ao acessar, registramos data, hora e dados técnicos do acesso para comprovação, conforme a <a href="/privacidade" target="_blank" rel="noopener">Política de Privacidade</a>.</p>
      </div>
    </div>
  </div>

  <!-- REMOVAL MODAL -->
  <div class="modal-ov" id="rem-modal">
    <div class="modal-sheet" role="dialog" aria-modal="true" aria-label="Solicitar remoção de foto">
      <div class="modal-head">
        <h2>Solicitar remoção de foto</h2>
        <button class="m-close" data-action="closeRemModal" aria-label="Fechar">
          <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
        </button>
      </div>

      <div id="rem-form">
        <p class="rem-intro">Identificou uma foto que quer remover? Preencha com suas informações de contato — analisaremos o pedido e você receberá uma confirmação por e-mail. <strong style="color:var(--text-muted)">Respondemos em até 15 dias.</strong></p>

        <div class="rem-field">
          <label>Identificar a foto por</label>
          <div class="radio-group">
            <label class="radio-opt">
              <input type="radio" name="rem-method" value="number" checked data-onchange="updateRemMethod">
              <span>Número da foto na pasta do Drive</span>
            </label>
            <label class="radio-opt">
              <input type="radio" name="rem-method" value="url" data-onchange="updateRemMethod">
              <span>Link direto da foto</span>
            </label>
            <label class="radio-opt">
              <input type="radio" name="rem-method" value="upload" data-onchange="updateRemMethod">
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
          <!-- Lista explícita, e não image/*: o servidor recusa o que não
               consegue limpar de metadados, e a lista é exatamente o que o
               strip sabe limpar hoje. HEIC entra desde que o strip aprendeu
               ISO-BMFF — era o formato que o iPhone oferecia para depois levar
               415. -->
          <input type="file" id="rem-file" accept="image/jpeg,image/png,image/webp,image/heic,image/heif,image/avif,image/gif">
        </div>

        <div class="rem-field">
          <label>E-mail <span style="color:#c0392b">*</span></label>
          <input type="email" id="rem-email" placeholder="seu@email.com" autocomplete="email">
        </div>
        <div class="rem-field">
          <label>Telefone <span style="color:#c0392b">*</span> <span style="color:var(--text-dim);font-size:.65rem">(com DDD)</span></label>
          <input type="tel" id="rem-phone" placeholder="(11) 99999-9999" autocomplete="tel">
        </div>
        <div class="rem-field">
          <label>Motivo <span style="color:var(--text-dim)">(opcional)</span></label>
          <textarea id="rem-message" placeholder="Descreva o motivo do pedido…"></textarea>
        </div>

        <p style="font-size:.68rem;color:var(--text-dim);line-height:1.5;margin-top:1rem">Seus dados (e-mail e telefone) são usados exclusivamente para processar esta solicitação e não são compartilhados com terceiros.</p>
        <label style="display:flex;align-items:flex-start;gap:.5rem;margin-top:1rem;cursor:pointer">
          <input type="checkbox" id="rem-consent" style="width:16px;height:16px;accent-color:var(--text);flex-shrink:0;margin-top:2px">
          <span style="font-size:.72rem;color:var(--text-muted);line-height:1.5">Li e concordo com a <a href="/privacidade" target="_blank" rel="noopener" style="color:var(--text-2)">política de privacidade</a> e os <a href="/termos" target="_blank" rel="noopener" style="color:var(--text-2)">termos de uso</a>, e autorizo o uso dos meus dados para processar esta solicitação.</span>
        </label>
        <div id="rem-adblock" class="adblock-warn" style="display:none">
          <strong>⚠️ Bloqueador de anúncios detectado.</strong> A verificação de segurança necessária para enviar esta solicitação não carregou. Desative o bloqueador para este site e ative o JavaScript (caso esteja desativado), depois <button type="button" data-action="reload">recarregue a página</button>. Se preferir, fale pelo <a href="https://wa.me/5511989211178" target="_blank" rel="noopener">WhatsApp</a>.
        </div>
        ${honeypotFieldHTML()}
        <div id="rem-turnstile" style="margin-top:1rem"></div>
        <div id="rem-error" class="form-error" style="display:none"></div>
        <div class="rem-sheet-foot">
          <button class="btn-rem-cancel" data-action="closeRemModal">Cancelar</button>
          <button class="btn-rem-submit" id="rem-submit" data-action="submitRemoval" disabled>Enviar solicitação</button>
        </div>
      </div>

      <div id="rem-success" class="rem-success" style="display:none">
        <svg xmlns="http://www.w3.org/2000/svg" width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" display="block" style="margin:0 auto"><circle cx="12" cy="12" r="10"/><polyline points="9 12 11 14 15 10"/></svg>
        Solicitação enviada!<br>
        <span style="font-size:.8rem;color:var(--ok-text-muted)">Analisaremos o pedido em breve.</span>
      </div>
    </div>
  </div>

  ${event.comingSoon ? `<!-- COMING SOON MODAL -->
  <div class="modal-ov" id="soon-modal">
    <div class="modal-sheet" role="dialog" aria-modal="true" aria-label="Fotos em breve">
      <div class="modal-head">
        <h2>Fotos em breve</h2>
        <button class="m-close" data-action="closeSoonModal" aria-label="Fechar">
          <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
        </button>
      </div>
      ${eventIsFuture
        ? `<p class="rem-intro">Opa, parece que você está adiantando! 😂 Esse evento ainda nem aconteceu — as fotos aparecem por aqui depois dele.</p>`
        : `<p class="rem-intro">Poxa, as fotos deste evento ainda não estão prontas. Peço desculpas pela demora — elas devem ficar disponíveis em breve.</p>
        <a href="/suporte" class="btn-drive-go" style="text-decoration:none">Falar comigo</a>`}
    </div>
  </div>` : ''}

  <!-- LIGHTBOX -->
  <div class="modal-ov lightbox-ov" id="lightbox">
    <button class="lb-close" data-action="closeLightbox" aria-label="Fechar">×</button>
    <button class="c-btn lb-prev" data-action="cGoPrev" aria-label="Anterior" style="display:none">
      <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="15 18 9 12 15 6"/></svg>
    </button>
    <img id="lb-img" src="" alt="">
    <button class="c-btn lb-next" data-action="cGoNext" aria-label="Próxima" style="display:none">
      <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="9 18 15 12 9 6"/></svg>
    </button>
    <div class="c-count" id="lb-count" style="display:none"></div>
  </div>

    </div>
  </div>

  <div class="cookie-notice" id="cookie-notice">
    <span>Usamos cookies essenciais e medição anônima de acesso. <a href="/privacidade">Saiba mais</a>.</span>
    <button id="cookie-ok" type="button">Entendi</button>
  </div>

  <script nonce="${nonce}">
    // Daqui até o fecha-script tudo vive dentro de um template literal: uma
    // crase solta, em comentário ou string, encerra a string e quebra o módulo.
    const EVENT_SLUG     = ${slugJSON};
    const EVENT_TITLE    = ${JSON.stringify(event.title || '')};
    // Nonce assinado para ESTE slug — impede que um token Turnstile válido
    // seja reaproveitado pra varrer os slugs do site sem carregar a página.
    // Vazio quando SIGNING_SECRET não está configurado (ver src/index.js).
    const DRIVE_NONCE    = ${JSON.stringify(driveNonce || '')};
    // Mesma ideia para o formulário de remoção, com um piso de idade: um envio
    // que chega menos de 3 s depois de a página ser servida é automação.
    const REMOVAL_FORM_TOKEN = ${JSON.stringify(removalFormToken || '')};
    const PHOTOS         = ${photosJSON};
    const ALERT_ADDED_AT = ${alertAddedAtJSON};
    const ALERT_EXPIRES  = ${alertExpiresJSON};

    let lastFocused = null;

    // ---- Delegated handlers (CSP: no inline on* attributes) ----
    // 'load'/'error' don't bubble, but a capture-phase listener on document
    // still sees them on the way down — and this script runs synchronously
    // before the event loop gets a chance to fire any queued load/error task
    // for images already in the markup above, so nothing is missed.
    function heroImgError(el) { el.style.opacity = '0'; }
    function cImgLoad(el) { el.style.opacity = '1'; if (window.cImgSettled) cImgSettled(); }
    function cImgError(el) { el.style.opacity = '0'; if (window.cImgSettled) cImgSettled(); }
    document.addEventListener('error', function(e) {
      var t = e.target;
      if (!t || !t.dataset) return;
      if (t.dataset.onerror === 'heroImgError') heroImgError(t);
      else if (t.dataset.onerror === 'cImgError') cImgError(t);
      else if (t.dataset.onerror === 'tsBlocked') window.__tsBlocked = true;
    }, true);
    document.addEventListener('load', function(e) {
      var t = e.target;
      if (!t || !t.dataset) return;
      if (t.dataset.onload === 'cImgLoad') cImgLoad(t);
      else if (t.dataset.onload === 'initDriveTurnstile') initDriveTurnstile();
    }, true);
    document.addEventListener('click', function(e) {
      var t = e.target;
      // Modal-scrim clicks: only when the click lands on the scrim itself
      // (not the sheet) — same check the old ovClick()/remOvClick()/etc did.
      if (t.id === 'modal') { closeModal(); return; }
      if (t.id === 'rem-modal') { closeRemModal(); return; }
      if (t.id === 'soon-modal') { closeSoonModal(); return; }
      if (t.id === 'lightbox') { closeLightbox(); return; }
      var el = t.closest('[data-action]');
      if (!el) return;
      switch (el.dataset.action) {
        case 'openSoonModal': openSoonModal(); break;
        case 'openModal': openModal(); break;
        case 'closeModal': closeModal(); break;
        case 'doNativeShare': doNativeShare(); break;
        case 'copyLink': copyLink(); break;
        case 'openRemModal': openRemModal(); break;
        case 'closeRemModal': closeRemModal(); break;
        case 'submitRemoval': submitRemoval(); break;
        case 'closeSoonModal': closeSoonModal(); break;
        case 'closeLightbox': closeLightbox(); break;
        case 'toggleDriveName': toggleDriveName(); break;
        case 'retryDriveLink': retryDriveLink(); break;
        case 'reload': location.reload(); break;
        case 'cGoPrev': cGo(-1); break;
        case 'cGoNext': cGo(1); break;
        case 'cGoto': cGoto(parseInt(el.dataset.i, 10)); break;
        case 'openLightbox': openLightbox(el.dataset.i !== undefined ? parseInt(el.dataset.i, 10) : cur); break;
        // onDriveLinkClick() already calls e.preventDefault() itself when the
        // link isn't ready yet (same as the old onclick="return …" pattern).
        case 'driveLink': onDriveLinkClick(e); break;
      }
    });
    document.addEventListener('change', function(e) {
      var el = e.target.closest('[data-onchange]');
      if (!el) return;
      switch (el.dataset.onchange) {
        case 'onDriveConsent': onDriveConsent(); break;
        case 'updateRemMethod': updateRemMethod(); break;
      }
    });
    document.addEventListener('keydown', function(e) {
      if (e.key !== 'Enter') return;
      if (e.target.closest('[data-keydown="openLightbox0"]')) openLightbox(0);
    });

    // ---- Ad-block / privacy-extension detection ----
    // Turnstile is what these extensions block; without it the Drive gate and
    // LGPD forms can't run their security check, so we surface a warning
    // instead of letting the flow fail silently. (window.__tsBlocked is also
    // set by the script tag's onerror at the bottom of the page.)
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

    // ---- New-interface banner (dismiss remembered per visitor) ----
    try {
      if (localStorage.getItem('fotos:update_banner_dismissed')) {
        const ub0 = document.getElementById('update-banner');
        if (ub0) ub0.style.display = 'none';
      }
    } catch(_) {}
    (function(){
      const ubClose = document.getElementById('update-banner-close');
      if (ubClose) ubClose.addEventListener('click', function(){
        try { localStorage.setItem('fotos:update_banner_dismissed', '1'); } catch(_) {}
        const ub = document.getElementById('update-banner');
        if (ub) ub.style.display = 'none';
      });
    })();

    // ---- Back-pill carries the gallery's filter/search state, when the
    // visitor actually came from there — degrades to the plain "/" it already
    // has whenever the referrer isn't usable (typed URL, another site, or a
    // gallery visit with no active filter). ----
    (function() {
      try {
        if (!document.referrer) return;
        const ref = new URL(document.referrer);
        if (ref.origin === location.origin && ref.pathname === '/' && ref.search) {
          const bp = document.querySelector('.back-pill');
          if (bp) bp.href = '/' + ref.search;
        }
      } catch(_) {}
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

      // Terms + button show immediately; Turnstile resolves invisibly in the
      // background. Only a stuck check (no token after 9s) surfaces a note —
      // it never hides the terms or button.
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
      const consentOk = c && c.checked && (!decl || decl.checked);
      if (consentOk && driveTsToken !== '') {
        fetchDriveLink();
      } else if (consentOk) {
        // Just waiting on a Turnstile token — show the spinner instead of an
        // inert button; the callback re-calls this once the token lands.
        setDriveLinkUI('loading');
      }
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
          driveNonce: DRIVE_NONCE,
          consent: true,
          declaration: decl ? decl.checked : undefined,
          name: nameEl ? nameEl.value : '',
        }),
      })
        .then(function(r) {
          // 410 = nonce da página venceu (aba aberta há horas), não erro do
          // visitante — reloadForFreshNonce() recarrega e o fluxo recomeça.
          if (r.status === 410) { reloadForFreshNonce(); return new Promise(function(){}); }
          return r.ok ? r.json() : Promise.reject();
        })
        .then(function(data) {
          driveLinkResult = data;
          driveLinkState = 'ready';
          // Solta a trava anti-laço: uma expiração futura na mesma aba ainda
          // pode se recuperar com uma recarga.
          try { sessionStorage.removeItem('fotos:drive_reloaded'); } catch(_) {}
          // Tranca só no sucesso — no erro o Turnstile renova o token e tenta
          // de novo, e essa tentativa ainda precisa poder levar um nome digitado.
          lockDriveName();
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
    // Nonce da página vale 2h; recarregar busca um novo e deixa um bilhete
    // (drive_reopen) para reabrir o modal com aviso ao voltar. O aceite NÃO é
    // remarcado — consentimento tem que ser um ato afirmativo da pessoa.
    // drive_reloaded é a trava anti-laço: sem ela, o Chrome restaura o
    // checkbox marcado ao recarregar, o gate dispara sozinho, toma 410 de
    // novo e recarrega para sempre (visto acontecer com browser de verdade).
    function reloadForFreshNonce() {
      var alreadyTried = null;
      try { alreadyTried = sessionStorage.getItem('fotos:drive_reloaded'); } catch(_) {}
      if (alreadyTried === EVENT_SLUG) {
        // Recarregar não resolveu (segredo rotacionado, relógio torto, algo
        // fora do normal). Melhor a tela de erro, que oferece "tentar de novo"
        // e os contatos, do que recarregar a página eternamente.
        try {
          sessionStorage.removeItem('fotos:drive_reloaded');
          sessionStorage.removeItem('fotos:drive_reopen');
        } catch(_) {}
        driveLinkState = 'error';
        setDriveLinkUI('error');
        return;
      }
      try {
        sessionStorage.setItem('fotos:drive_reopen', EVENT_SLUG);
        sessionStorage.setItem('fotos:drive_reloaded', EVENT_SLUG);
      } catch(_) {}
      location.reload();
    }

    function maybeReopenAfterRefresh() {
      var flag = null;
      try {
        flag = sessionStorage.getItem('fotos:drive_reopen');
        sessionStorage.removeItem('fotos:drive_reopen');
      } catch(_) { return; }
      if (flag !== EVENT_SLUG) return;

      // O browser restaura o checkbox marcado ao recarregar — desmarcar evita
      // o gate disparar sozinho (metade do laço em reloadForFreshNonce) e
      // mantém o consentimento como um ato afirmativo da pessoa.
      var consent = document.getElementById('drive-consent');
      if (consent) consent.checked = false;
      var decl = document.getElementById('drive-declaration');
      if (decl) decl.checked = false;
      driveLinkState = 'idle';

      var note = document.getElementById('drive-refreshed-note');
      if (note) note.style.display = '';
      openModal();
    }

    function retryDriveLink() {
      driveLinkState = 'idle';
      if (driveTsToken) maybeFetchDriveLink();
      else setDriveLinkUI('loading'); // waiting on a fresh token; retries itself once it lands
    }
    // Visible state of the link button(s): muted (.drive-locked) until the
    // real href lands, spinner (.drive-loading) while waiting on Turnstile or
    // the fetch. Once ready, an idle timer draws attention after a few seconds.
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
    function showDriveHint(text) {
      const hint = document.getElementById('drive-gate-hint');
      if (!hint) return;
      hint.textContent = text;
      hint.style.display = '';
      clearTimeout(window.__driveHintTimer);
      window.__driveHintTimer = setTimeout(function() { hint.style.display = 'none'; }, 3500);
    }
    // Clicked while not ready: flash the checkboxes if terms aren't accepted,
    // otherwise it's just Turnstile/network still resolving — say so.
    function handleBlockedDriveClick() {
      const c = document.getElementById('drive-consent');
      const decl = document.getElementById('drive-declaration');
      const acceptOk = !!(c && c.checked) && (!decl || decl.checked);
      if (!acceptOk) {
        showDriveHint('você precisa aceitar os termos e declarações primeiro');
        document.querySelectorAll('.drive-consent').forEach(function(l) {
          l.classList.remove('flash-warn'); void l.offsetWidth; l.classList.add('flash-warn');
        });
      } else {
        showDriveHint('só um instante, o acesso ainda está carregando');
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
    // Depois que o link saiu, o nome já foi para o registro (ou ficou de fora) e
    // não há como mandá-lo depois. Some com o convite e congela o que foi
    // enviado, em vez de deixar um campo que aceita texto e não faz nada.
    function lockDriveName() {
      const t = document.getElementById('drive-name-toggle');
      if (t) t.style.display = 'none';
      const w = document.getElementById('drive-name-wrap');
      const i = document.getElementById('drive-name');
      if (!w || !i) return;
      if (i.value.trim() === '') { w.style.display = 'none'; return; }
      i.readOnly = true;
      i.style.opacity = '.6';
      i.title = 'Nome registrado com o seu consentimento.';
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

    // ---- Coming soon modal ----
    function openSoonModal() {
      lastFocused = document.activeElement;
      document.getElementById('soon-modal').classList.add('open');
      document.body.style.overflow = 'hidden';
      updateStickyCta();
    }
    function closeSoonModal() {
      document.getElementById('soon-modal').classList.remove('open');
      document.body.style.overflow = '';
      updateStickyCta();
      if (lastFocused && lastFocused.focus) lastFocused.focus();
    }
    function soonOvClick(e) { if (e.target === document.getElementById('soon-modal')) closeSoonModal(); }

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
      const lb = document.getElementById('lightbox');
      if (lb && lb.classList.contains('open')) {
        const lbImg = document.getElementById('lb-img'); if (lbImg) lbImg.src = PHOTOS[cur];
        const lbCnt = document.getElementById('lb-count'); if (lbCnt) lbCnt.textContent = (cur + 1) + ' / ' + PHOTOS.length;
      }
    }
    function cGo(dir) { if (window.perfCount) perfCount('navCount'); cGoto(cur + dir); }

    // ---- Lightbox (preview photos only — not the Drive delivery flow) ----
    let lbLastFocused = null, lbZoomed = false;
    function openLightbox(i) {
      if (!PHOTOS.length) return;
      lbLastFocused = document.activeElement;
      document.getElementById('lightbox').classList.add('open');
      document.body.style.overflow = 'hidden';
      document.querySelector('.lb-prev').style.display = PHOTOS.length > 1 ? '' : 'none';
      document.querySelector('.lb-next').style.display = PHOTOS.length > 1 ? '' : 'none';
      document.getElementById('lb-count').style.display = PHOTOS.length > 1 ? '' : 'none';
      lbResetZoom();
      cGoto(i);
    }
    function closeLightbox() {
      document.getElementById('lightbox').classList.remove('open');
      document.body.style.overflow = '';
      lbResetZoom();
      if (lbLastFocused && lbLastFocused.focus) lbLastFocused.focus();
    }
    function lbOvClick(e) { if (e.target.id === 'lightbox') closeLightbox(); }
    function lbResetZoom() {
      lbZoomed = false;
      const img = document.getElementById('lb-img');
      if (img) { img.style.transform = ''; img.style.transformOrigin = ''; }
    }
    function lbToggleZoom(x, y) {
      const img = document.getElementById('lb-img');
      if (!img) return;
      lbZoomed = !lbZoomed;
      if (lbZoomed) {
        const r = img.getBoundingClientRect();
        img.style.transformOrigin = ((x - r.left) / r.width * 100) + '% ' + ((y - r.top) / r.height * 100) + '%';
        img.style.transform = 'scale(2.2)';
      } else { img.style.transform = ''; }
    }
    (function() {
      const lbImg = document.getElementById('lb-img');
      if (!lbImg) return;
      lbImg.addEventListener('dblclick', e => lbToggleZoom(e.clientX, e.clientY));
      let lbTx = 0, lbLastTap = 0;
      lbImg.addEventListener('touchstart', e => { lbTx = e.touches[0].clientX; }, { passive: true });
      lbImg.addEventListener('touchend', e => {
        const now = Date.now(), t = e.changedTouches[0];
        if (now - lbLastTap < 300) { lbToggleZoom(t.clientX, t.clientY); lbLastTap = 0; return; }
        lbLastTap = now;
        if (lbZoomed) return;
        const dx = lbTx - t.clientX;
        if (Math.abs(dx) > 40 && PHOTOS.length > 1) cGo(dx > 0 ? 1 : -1);
      });
    })();
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
            form_token: REMOVAL_FORM_TOKEN,
            company_website: (document.getElementById('company_website') || {}).value || '',
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
        // Tokens are single-use — fetch a fresh one or every retry fails with
        // a stale token. The widget's callback re-enables the button.
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
      else if (open.id === 'soon-modal') closeSoonModal();
      else if (open.id === 'lightbox') closeLightbox();
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
      if ((!open || open.id === 'lightbox') && PHOTOS.length > 1) {
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

    // Se chegamos aqui por causa de um nonce vencido, reabre o modal com o
    // aviso — ver reloadForFreshNonce().
    maybeReopenAfterRefresh();

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
  <script nonce="${nonce}" src="https://challenges.cloudflare.com/turnstile/v0/api.js" async defer data-onload="initDriveTurnstile" data-onerror="tsBlocked"></script>
  ${analyticsBeaconHTML(analyticsToken, nonce)}
</body>
</html>`;
}

/** @param {number} size */
function camIcon(size) {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1"><rect x="3" y="5" width="18" height="15" rx="2"/><circle cx="12" cy="12" r="4"/><path d="M9 5l1.5-2h3L15 5"/></svg>`;
}

/** @param {number} size */
function clockIcon(size) {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.25"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>`;
}
