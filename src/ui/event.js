import { escape, formatDatePT } from '../utils.js';

export function eventHTML(event) {
  const photos = (Array.isArray(event.photos) && event.photos.length > 0)
    ? event.photos.filter(Boolean)
    : (event.thumbnailUrl ? [event.thumbnailUrl] : []);

  const photosJSON = JSON.stringify(photos).replace(/</g, '\\u003c').replace(/>/g, '\\u003e');
  const driveJSON  = JSON.stringify(event.driveUrl || '');
  const ogImage    = photos[0] || '';

  const heroHTML = photos.length === 0
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
    /* access button */
    .drive-wrap{margin-bottom:3rem}
    .btn-drive{display:inline-flex;align-items:center;gap:.65rem;background:#f0ebe5;color:#0a0a0a;border:none;padding:.9rem 1.6rem;border-radius:9px;font-size:.9rem;font-weight:600;letter-spacing:.02em;cursor:pointer;transition:background .18s,transform .15s;width:100%;justify-content:center}
    @media(min-width:400px){.btn-drive{width:auto}}
    .btn-drive:hover{background:#fff;transform:translateY(-2px)}
    .btn-drive svg{width:18px;height:18px;flex-shrink:0}
    /* credits section */
    .credits{border-top:1px solid #191919;padding-top:2.25rem}
    .credits-title{font-size:.65rem;font-weight:500;letter-spacing:.14em;text-transform:uppercase;color:#3a3a3a;margin-bottom:1rem}
    .credits-list{display:flex;flex-direction:column;gap:.5rem}
    .credits-list a,.credits-list span{font-size:.85rem;line-height:1.5;color:#666;text-decoration:none;transition:color .2s;display:block}
    .credits-list a:hover{color:#bbb}
    .credits-note{font-size:.78rem;color:#3a5a3a;margin-top:.875rem;padding:.625rem .875rem;background:#0a140a;border:1px solid #162016;border-radius:7px;line-height:1.55}
    /* modal */
    .modal-ov{position:fixed;inset:0;background:rgba(0,0,0,.82);z-index:50;display:none;align-items:flex-end;justify-content:center}
    .modal-ov.open{display:flex}
    @media(min-width:580px){.modal-ov{align-items:center;padding:1.5rem}}
    .modal-sheet{background:#0d0d0d;width:100%;max-width:500px;border-radius:18px 18px 0 0;max-height:92vh;overflow-y:auto;-webkit-overflow-scrolling:touch;padding:1.75rem 1.5rem 2.25rem}
    @media(min-width:580px){.modal-sheet{border-radius:14px}}
    .modal-head{display:flex;align-items:center;justify-content:space-between;margin-bottom:1.5rem}
    .modal-head h2{font-size:.975rem;font-weight:600}
    .m-close{background:none;border:1px solid #222;color:#555;width:32px;height:32px;border-radius:50%;display:flex;align-items:center;justify-content:center;cursor:pointer;flex-shrink:0;transition:border-color .2s,color .2s}
    .m-close:hover{border-color:#444;color:#ccc}
    /* credit box inside modal */
    .credit-box{background:#091409;border:1px solid #173017;border-radius:10px;padding:1.125rem 1.25rem;margin-bottom:1.5rem}
    .credit-box-h{font-size:.68rem;font-weight:600;letter-spacing:.12em;text-transform:uppercase;color:#4a9a4a;margin-bottom:.75rem}
    .credit-box p{font-size:.875rem;color:#b0d0b0;line-height:1.7;margin-bottom:.35rem}
    .credit-box p:last-child{margin-bottom:0}
    .credit-box a{color:#7ec87e;text-decoration:none}
    .credit-box a:hover{color:#a0e0a0;text-decoration:underline}
    .credit-box .note{font-size:.78rem;color:#507a50;margin-top:.625rem}
    /* steps inside modal */
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
    /* drive button inside modal */
    .btn-drive-go{display:flex;align-items:center;justify-content:center;gap:.65rem;background:#f0ebe5;color:#0a0a0a;border:none;padding:.95rem 1.6rem;border-radius:9px;font-size:.9rem;font-weight:600;cursor:pointer;margin-top:1.75rem;width:100%;text-decoration:none;transition:background .18s,transform .15s}
    .btn-drive-go:hover{background:#fff;transform:translateY(-1px)}
    .btn-drive-go svg{width:18px;height:18px;flex-shrink:0}
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

  ${heroHTML}

  <main>
    <div class="meta">
      ${event.date ? `<span class="date-chip">${escape(formatDatePT(event.date))}</span>` : ''}
    </div>
    <h1>${escape(event.title)}</h1>
    ${event.longDescription ? `<div class="desc">${escape(event.longDescription)}</div>` : ''}

    <div class="drive-wrap">
      <button class="btn-drive" onclick="openModal()">
        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><rect x="3" y="3" width="18" height="18" rx="2"/><path d="M9 3v18M15 3v18M3 9h18M3 15h18" stroke-width="1.2"/></svg>
        Acessar fotos
      </button>
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

  <footer><a href="/">fotos · luca fchala</a></footer>

  <!-- MODAL -->
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
        <p><strong>Não tire print das fotos.</strong> Ao baixar pelo Drive você mantém a resolução e qualidade originais. Prints perdem qualidade e não fazem jus ao trabalho.</p>
      </div>

      <a id="drive-link" href="#" target="_blank" rel="noopener" class="btn-drive-go" onclick="closeModal()">
        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><path d="M18 13v6a2 2 0 01-2 2H5a2 2 0 01-2-2V8a2 2 0 012-2h6"/><polyline points="15 3 21 3 21 9"/><line x1="10" y1="14" x2="21" y2="3"/></svg>
        Ir para o Google Drive
      </a>
    </div>
  </div>

  <script>
    const DRIVE_URL = ${driveJSON};
    const PHOTOS = ${photosJSON};
    let cur = 0;

    // modal
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

    // carousel
    function cGoto(n) {
      cur = ((n % PHOTOS.length) + PHOTOS.length) % PHOTOS.length;
      const img = document.getElementById('c-img');
      if (img) img.src = PHOTOS[cur];
      document.querySelectorAll('.c-dot').forEach((d, i) => d.classList.toggle('on', i === cur));
      const cnt = document.getElementById('c-count');
      if (cnt) cnt.textContent = (cur + 1) + ' / ' + PHOTOS.length;
    }
    function cGo(dir) { cGoto(cur + dir); }

    // swipe
    const car = document.getElementById('carousel');
    if (car) {
      let tx = 0;
      car.addEventListener('touchstart', e => { tx = e.touches[0].clientX; }, { passive: true });
      car.addEventListener('touchend', e => {
        const dx = tx - e.changedTouches[0].clientX;
        if (Math.abs(dx) > 40) cGo(dx > 0 ? 1 : -1);
      });
    }
  </script>
</body>
</html>`;
}

function camIcon(size) {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1"><rect x="3" y="5" width="18" height="15" rx="2"/><circle cx="12" cy="12" r="4"/><path d="M9 5l1.5-2h3L15 5"/></svg>`;
}
