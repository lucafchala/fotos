import { escape, formatDatePT } from '../utils.js';

export function eventHTML(event, analyticsToken) {
  const photos = (Array.isArray(event.photos) && event.photos.length > 0)
    ? event.photos.filter(Boolean)
    : (event.thumbnailUrl ? [event.thumbnailUrl] : []);

  const photosJSON  = JSON.stringify(photos).replace(/</g, '\\u003c').replace(/>/g, '\\u003e');
  const driveJSON   = JSON.stringify(event.driveUrl || '');
  const slugJSON    = JSON.stringify(event.slug || '');
  const ogImage     = photos[0] || '';

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
    ? `<div class="hero"><div class="hero-ph hero-soon">${clockIcon(56)}<span>Em breve</span></div></div>`
    : photos.length === 0
      ? `<div class="hero"><div class="hero-ph">${camIcon(48)}</div></div>`
      : photos.length === 1
        ? `<div class="hero"><img src="${escape(photos[0])}" alt="${escape(event.title)}"></div>`
        : `<div class="carousel" id="carousel">
          <img id="c-img" src="${escape(photos[0])}" alt="${escape(event.title)}">
          <button class="c-btn c-prev" onclick="cGo(-1)" aria-label="Anterior">
            <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="15 18 9 12 15 6"/></svg>
          </button>
          <button class="c-btn c-next" onclick="cGo(1)" aria-label="Próxima">
            <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="9 18 15 12 9 6"/></svg>
          </button>
          <div class="c-dots">${photos.map((_, i) => `<span class="c-dot${i === 0 ? ' on' : ''}" onclick="cGoto(${i})"></span>`).join('')}</div>
          <div class="c-count" id="c-count">1 / ${photos.length}</div>
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
  <meta property="og:title" content="${escape(event.title)}">
  <meta property="og:description" content="${escape(event.shortDescription || '')}">
  ${ogImage ? `<meta property="og:image" content="${escape(ogImage)}">` : ''}
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
    /* hero */
    .hero{width:100%;max-height:72vh;overflow:hidden;background:#0e0e0e}
    .hero img{width:100%;max-height:72vh;object-fit:cover;display:block}
    .hero-ph{height:260px;display:flex;align-items:center;justify-content:center;color:#1e1e1e}
    .hero-soon{flex-direction:column;gap:1rem;color:#3a3a3a;height:320px}
    .hero-soon span{font-size:.78rem;letter-spacing:.22em;text-transform:uppercase;color:#666;font-weight:500}
    .btn-soon{background:#141414;color:#888;border:1px dashed #2e2e2e;cursor:default}
    .btn-soon:hover{background:#141414;transform:none}
    /* tour */
    .tour-modal{position:fixed;inset:0;background:rgba(0,0,0,.85);z-index:60;display:none;align-items:flex-end;justify-content:center;padding:1rem;opacity:0;transition:opacity .3s ease}
    @media(min-width:580px){.tour-modal{align-items:center}}
    .tour-modal.open{display:flex;opacity:1}
    .tour-card{background:#0d0d0d;border:1px solid #1e1e1e;width:100%;max-width:420px;border-radius:16px;padding:1.75rem 1.5rem;animation:slideUp .35s ease}
    @keyframes slideUp{from{transform:translateY(20px);opacity:0}to{transform:translateY(0);opacity:1}}
    .tour-card h3{font-size:1.1rem;font-weight:600;margin-bottom:.35rem;color:#f0ebe5}
    .tour-sub{font-size:.85rem;color:#888;margin-bottom:1.25rem;line-height:1.5}
    .tour-list{list-style:none;padding:0;margin:0 0 1.5rem;display:flex;flex-direction:column;gap:.875rem}
    .tour-list li{display:flex;gap:.75rem;align-items:flex-start;font-size:.875rem;line-height:1.55;color:#bbb}
    .tour-icon{font-size:1.1rem;flex-shrink:0;width:1.5rem;text-align:center}
    .tour-list strong{color:#e0d8d0;font-weight:600}
    .tour-btn{width:100%;background:#f0ebe5;color:#0a0a0a;border:none;padding:.85rem;border-radius:9px;font-size:.875rem;font-weight:600;cursor:pointer;transition:opacity .18s}
    .tour-btn:hover{opacity:.88}
    /* carousel */
    .carousel{position:relative;width:100%;max-height:72vh;overflow:hidden;background:#0e0e0e;user-select:none;-webkit-user-select:none}
    .carousel img{width:100%;max-height:72vh;object-fit:cover;display:block}
    .c-btn{position:absolute;top:50%;transform:translateY(-50%);background:rgba(0,0,0,.55);border:none;color:#fff;width:42px;height:42px;border-radius:50%;display:flex;align-items:center;justify-content:center;cursor:pointer;z-index:2;transition:background .2s;backdrop-filter:blur(2px)}
    .c-btn:hover{background:rgba(0,0,0,.8)}
    .c-prev{left:.75rem}.c-next{right:.75rem}
    .c-dots{position:absolute;bottom:2.5rem;left:50%;transform:translateX(-50%);display:flex;gap:.4rem;z-index:2}
    .c-dot{width:6px;height:6px;border-radius:50%;background:rgba(255,255,255,.3);cursor:pointer;transition:background .2s}
    .c-dot.on{background:#fff}
    .c-count{position:absolute;bottom:.75rem;right:.875rem;font-size:.7rem;font-weight:500;color:rgba(255,255,255,.5);background:rgba(0,0,0,.4);padding:.2rem .5rem;border-radius:20px;backdrop-filter:blur(4px)}
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
    .modal-sheet{background:#0d0d0d;width:100%;max-width:500px;border-radius:18px 18px 0 0;max-height:92vh;overflow-y:auto;-webkit-overflow-scrolling:touch;padding:1.75rem 1.5rem 2.25rem}
    @media(min-width:580px){.modal-sheet{border-radius:14px}}
    .modal-head{display:flex;align-items:center;justify-content:space-between;margin-bottom:1.5rem}
    .modal-head h2{font-size:.975rem;font-weight:600}
    .m-close{background:none;border:1px solid #222;color:#555;width:32px;height:32px;border-radius:50%;display:flex;align-items:center;justify-content:center;cursor:pointer;flex-shrink:0;transition:border-color .2s,color .2s}
    .m-close:hover{border-color:#444;color:#ccc}
    /* drive modal */
    .credit-box{background:#091409;border:1px solid #173017;border-radius:10px;padding:1.125rem 1.25rem;margin-bottom:1.5rem}
    .credit-box-h{font-size:.68rem;font-weight:600;letter-spacing:.12em;text-transform:uppercase;color:#4a9a4a;margin-bottom:.75rem}
    .credit-box p{font-size:.875rem;color:#b0d0b0;line-height:1.7;margin-bottom:.35rem}
    .credit-box p:last-child{margin-bottom:0}
    .credit-box a{color:#7ec87e;text-decoration:none}
    .credit-box a:hover{color:#a0e0a0;text-decoration:underline}
    .credit-box .note{font-size:.78rem;color:#507a50;margin-top:.625rem}
    .guide-title{font-size:.68rem;font-weight:600;letter-spacing:.12em;text-transform:uppercase;color:#555;margin-bottom:1.125rem}
    .steps{display:flex;flex-direction:column;gap:.875rem;padding-left:0;list-style:none;counter-reset:step}
    .steps li{counter-increment:step;display:grid;grid-template-columns:1.4rem 1fr;gap:.5rem;font-size:.875rem;color:#999;line-height:1.6}
    .steps li::before{content:counter(step);font-size:.68rem;font-weight:600;color:#555;background:#1a1a1a;width:1.35rem;height:1.35rem;border-radius:50%;display:flex;align-items:center;justify-content:center;flex-shrink:0;margin-top:.18rem}
    .steps li strong{color:#d0d0d0}
    .steps li kbd{background:#1e1e1e;border:1px solid #2d2d2d;padding:.1em .4em;border-radius:4px;font-size:.8em;font-family:inherit;color:#bbb}
    .warn-box{display:flex;align-items:flex-start;gap:.6rem;margin-top:1.25rem;padding:.875rem 1rem;background:#130e00;border:1px solid #2a1c00;border-radius:8px}
    .warn-box svg{width:15px;height:15px;flex-shrink:0;color:#c8880a;margin-top:2px}
    .warn-box p{font-size:.8rem;color:#b87e0a;line-height:1.6}
    .warn-box p strong{color:#d89e30}
    .btn-drive-go{display:flex;align-items:center;justify-content:center;gap:.65rem;background:#f0ebe5;color:#0a0a0a;border:none;padding:.95rem 1.6rem;border-radius:9px;font-size:.9rem;font-weight:600;cursor:pointer;margin-top:1.75rem;width:100%;text-decoration:none;transition:background .18s,transform .15s}
    .btn-drive-go:hover{background:#fff;transform:translateY(-1px)}
    .btn-drive-go svg{width:18px;height:18px;flex-shrink:0}
    /* removal modal */
    .rem-intro{font-size:.875rem;color:#888;line-height:1.6;margin-bottom:1.5rem}
    .rem-field{display:flex;flex-direction:column;gap:.45rem;margin-bottom:1.125rem}
    .rem-field label{font-size:.7rem;font-weight:500;letter-spacing:.08em;text-transform:uppercase;color:#555}
    .rem-field input[type=text],.rem-field input[type=email],.rem-field input[type=tel],.rem-field input[type=url],.rem-field input[type=number],.rem-field textarea{width:100%;background:#141414;border:1px solid #222;color:#f0ebe5;padding:.75rem .875rem;border-radius:8px;font-size:.875rem;outline:none;transition:border-color .2s;-webkit-appearance:none}
    .rem-field input:focus,.rem-field textarea:focus{border-color:#3a3a3a}
    .rem-field textarea{resize:vertical;min-height:80px;line-height:1.5}
    .rem-field input[type=file]{color:#888;font-size:.8rem;width:100%}
    .radio-group{display:flex;flex-direction:column;gap:.5rem}
    .radio-opt{display:flex;align-items:center;gap:.625rem;cursor:pointer;padding:.5rem .75rem;border:1px solid #1e1e1e;border-radius:8px;transition:border-color .2s}
    .radio-opt:has(input:checked){border-color:#3a3a3a;background:#111}
    .radio-opt input[type=radio]{width:16px;height:16px;accent-color:#f0ebe5;flex-shrink:0}
    .radio-opt span{font-size:.875rem;color:#bbb}
    .rem-sheet-foot{display:flex;gap:.75rem;margin-top:1.5rem}
    .btn-rem-cancel{flex:1;background:none;border:1px solid #222;color:#888;padding:.8rem;border-radius:8px;font-size:.875rem;font-weight:500;cursor:pointer;transition:border-color .2s}
    .btn-rem-cancel:hover{border-color:#3a3a3a}
    .btn-rem-submit{flex:2;background:#f0ebe5;color:#0a0a0a;border:none;padding:.8rem;border-radius:8px;font-size:.875rem;font-weight:600;cursor:pointer;transition:opacity .18s}
    .btn-rem-submit:disabled{opacity:.5;cursor:not-allowed}
    .btn-rem-submit:not(:disabled):hover{opacity:.88}
    .rem-success{text-align:center;padding:2rem 0;color:#7ec87e;font-size:.9rem;line-height:1.7}
    .rem-success svg{margin-bottom:.75rem;color:#5aaa5a}
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
      <a href="https://wa.me/?text=${escape(`Veja as fotos de ${event.title} em fotos.lucafchala.com/${event.slug}`)}" target="_blank" rel="noopener" class="whatsapp-link">
        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" width="15" height="15"><path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413z"/></svg>
        Compartilhar
      </a>
      <button class="removal-link" onclick="openRemModal()">
        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14H6L5 6"/><path d="M10 11v6M14 11v6"/><path d="M9 6V4h6v2"/></svg>
        Solicitar remoção de foto
      </button>
    </div>
  </footer>

  <!-- DRIVE MODAL -->
  <div class="modal-ov" id="modal" onclick="ovClick(event)">
    <div class="modal-sheet">
      <div class="modal-head">
        <h2>Antes de acessar as fotos</h2>
        <button class="m-close" onclick="closeModal()" aria-label="Fechar">
          <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
        </button>
      </div>
      <div class="credit-box">
        <div class="credit-box-h">📸 Créditos ao postar</div>
        <p>Ao publicar estas fotos nas redes sociais, mencione sempre:</p>
        <p>• <a href="https://instagram.com/lucafchala" target="_blank" rel="noopener">@lucafchala</a> — fotografia</p>
        ${event.eventCredits ? `<p>• ${escape(event.eventCredits)}</p>` : ''}
        <p class="note">Isso valoriza o trabalho fotográfico e incentiva novos projetos. ♥</p>
      </div>
      <div class="guide-title">Como baixar as fotos</div>
      <ol class="steps">
        <li>Clique em "Ir para o Google Drive" abaixo e abra a pasta.</li>
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
        <p><strong>Não tire print das fotos.</strong> Ao baixar pelo Drive você mantém a resolução e qualidade originais.</p>
      </div>
      <a id="drive-link" href="#" target="_blank" rel="noopener" class="btn-drive-go" onclick="trackDrive();closeModal()">
        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><path d="M18 13v6a2 2 0 01-2 2H5a2 2 0 01-2-2V8a2 2 0 012-2h6"/><polyline points="15 3 21 3 21 9"/><line x1="10" y1="14" x2="21" y2="3"/></svg>
        Ir para o Google Drive
      </a>
    </div>
  </div>

  <!-- REMOVAL MODAL -->
  <div class="modal-ov" id="rem-modal" onclick="remOvClick(event)">
    <div class="modal-sheet">
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
        <div class="rem-sheet-foot">
          <button class="btn-rem-cancel" onclick="closeRemModal()">Cancelar</button>
          <button class="btn-rem-submit" id="rem-submit" onclick="submitRemoval()">Enviar solicitação</button>
        </div>
      </div>

      <div id="rem-success" class="rem-success" style="display:none">
        <svg xmlns="http://www.w3.org/2000/svg" width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" display="block" style="margin:0 auto"><circle cx="12" cy="12" r="10"/><polyline points="9 12 11 14 15 10"/></svg>
        Solicitação enviada!<br>
        <span style="font-size:.8rem;color:#507a50">Analisaremos o pedido em breve.</span>
      </div>
    </div>
  </div>

  ${event.comingSoon ? '' : `<!-- TOUR MODAL -->
  <div class="tour-modal" id="tour-modal">
    <div class="tour-card">
      <h3>Bem-vindo! 👋</h3>
      <p class="tour-sub">Algumas dicas rápidas pra você aproveitar:</p>
      <ul class="tour-list">
        <li><span class="tour-icon">📁</span><span>Toque em <strong>Acessar fotos</strong> para ir ao Google Drive e baixar.</span></li>
        <li><span class="tour-icon">💬</span><span>Compartilhe esta página por <strong>WhatsApp</strong> usando o botão verde no rodapé.</span></li>
        <li><span class="tour-icon">🗑</span><span>Apareceu uma foto sua que prefere remover? Use <strong>Solicitar remoção</strong> no rodapé.</span></li>
      </ul>
      <button class="tour-btn" onclick="closeTour()">Entendi</button>
    </div>
  </div>`}

  <script>
    const DRIVE_URL      = ${driveJSON};
    const EVENT_SLUG     = ${slugJSON};
    const PHOTOS         = ${photosJSON};
    const ALERT_ADDED_AT = ${alertAddedAtJSON};
    const ALERT_EXPIRES  = ${alertExpiresJSON};

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

    // ---- Tour (first visit) ----
    function closeTour() {
      const m = document.getElementById('tour-modal');
      if (!m) return;
      m.classList.remove('open');
      try { localStorage.setItem('fotos:tour_seen', '1'); } catch(_) {}
      setTimeout(() => { m.style.display = 'none'; }, 300);
    }
    (function maybeShowTour() {
      const m = document.getElementById('tour-modal');
      if (!m) return;
      try { if (localStorage.getItem('fotos:tour_seen')) return; } catch(_) { return; }
      setTimeout(() => { m.classList.add('open'); }, 800);
    })();

    // ---- Drive modal ----
    function openModal() {
      document.getElementById('drive-link').href = DRIVE_URL || '#';
      document.getElementById('modal').classList.add('open');
      document.body.style.overflow = 'hidden';
    }
    function closeModal() {
      document.getElementById('modal').classList.remove('open');
      document.body.style.overflow = '';
    }
    function ovClick(e) { if (e.target === document.getElementById('modal')) closeModal(); }
    function trackDrive() {
      fetch('/api/track-drive', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ slug: EVENT_SLUG }) }).catch(() => {});
    }

    // ---- Carousel ----
    function cGoto(n) {
      cur = ((n % PHOTOS.length) + PHOTOS.length) % PHOTOS.length;
      const img = document.getElementById('c-img');
      if (img) img.src = PHOTOS[cur];
      document.querySelectorAll('.c-dot').forEach((d, i) => d.classList.toggle('on', i === cur));
      const cnt = document.getElementById('c-count');
      if (cnt) cnt.textContent = (cur + 1) + ' / ' + PHOTOS.length;
    }
    function cGo(dir) { cGoto(cur + dir); }
    const car = document.getElementById('carousel');
    if (car) {
      let tx = 0;
      car.addEventListener('touchstart', e => { tx = e.touches[0].clientX; }, { passive: true });
      car.addEventListener('touchend', e => { if (Math.abs(tx - e.changedTouches[0].clientX) > 40) cGo(tx > e.changedTouches[0].clientX ? 1 : -1); });
    }

    // ---- Removal modal ----
    function openRemModal() {
      document.getElementById('rem-form').style.display = 'block';
      document.getElementById('rem-success').style.display = 'none';
      document.getElementById('rem-modal').classList.add('open');
      document.body.style.overflow = 'hidden';
    }
    function closeRemModal() {
      document.getElementById('rem-modal').classList.remove('open');
      document.body.style.overflow = '';
    }
    function remOvClick(e) { if (e.target === document.getElementById('rem-modal')) closeRemModal(); }

    function updateRemMethod() {
      const m = document.querySelector('input[name="rem-method"]:checked').value;
      document.getElementById('rem-number-field').style.display = m === 'number' ? '' : 'none';
      document.getElementById('rem-url-field').style.display    = m === 'url'    ? '' : 'none';
      document.getElementById('rem-upload-field').style.display = m === 'upload' ? '' : 'none';
    }

    async function submitRemoval() {
      const method = document.querySelector('input[name="rem-method"]:checked').value;
      let value = '', fileName = '', fileBase64 = '';

      if (method === 'number') {
        value = (document.getElementById('rem-number').value || '').trim();
        if (!value) return alert('Informe o número da foto.');
        value = 'Foto nº ' + value;
      } else if (method === 'url') {
        value = (document.getElementById('rem-url').value || '').trim();
        if (!value) return alert('Informe o link da foto.');
      } else {
        const file = document.getElementById('rem-file').files[0];
        if (!file) return alert('Selecione uma foto.');
        if (file.size > 2 * 1024 * 1024) return alert('Foto muito grande (máx. 2 MB). Tente colar o link da foto no Drive.');
        fileName = file.name;
        fileBase64 = await new Promise((res, rej) => {
          const r = new FileReader();
          r.onload = ev => res(ev.target.result.split(',')[1]);
          r.onerror = rej;
          r.readAsDataURL(file);
        });
      }

      const email = (document.getElementById('rem-email').value || '').trim();
      const phone = (document.getElementById('rem-phone').value || '').trim();
      if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email)) {
        return alert('Informe um e-mail válido.');
      }
      const phoneDigits = phone.replace(/\D/g, '');
      if (!phone || phoneDigits.length < 10 || phoneDigits.length > 13) {
        return alert('Informe um telefone válido com DDD (ex: (11) 99999-9999).');
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
          }),
        });
        if (!resp.ok) { const e = await resp.json().catch(() => ({})); throw new Error(e.error || 'Erro ao enviar.'); }
        document.getElementById('rem-form').style.display = 'none';
        document.getElementById('rem-success').style.display = 'block';
      } catch(err) {
        alert(err.message || 'Erro ao enviar. Tente novamente.');
      } finally {
        btn.disabled = false;
        btn.textContent = 'Enviar solicitação';
      }
    }
  </script>
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
