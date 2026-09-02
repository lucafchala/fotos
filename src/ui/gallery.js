import { escape, formatDatePT, sortEvents, eventTime, sizedDriveThumb, driveSrcset, perfBootScript, footerLegalLinksHTML, updateBannerHTML, safeUrl, fontPreconnectHTML, photoPreconnectHTML, socialMetaHTML, ogImageFor, previewDescription, analyticsBeaconHTML } from '../utils.js';

const SITE_URL = 'https://fotos.lucafchala.com';
const INITIAL = 12; // cards shown before "Carregar mais"

// ---------------------------------------------------------------------------
// Larguras pedidas ao lh3, e como o browser escolhe entre elas
// ---------------------------------------------------------------------------
// `sizes` descreve o espaço que a foto OCUPA, não o arquivo que queremos: o
// browser multiplica pelo DPR da tela e pega o menor candidato que serve. Por
// isso os valores abaixo saem do CSS desta página, e mudar a grade sem mudar
// aqui faz todo mundo baixar o tamanho errado em silêncio.
//
// Grade: 2 colunas até 560px, 3 até 900px, 4 acima — `main` tem max-width
// 1280px com 1rem de padding, então a coluna satura em (1248 - 3*24)/4 ≈ 294px.
// Destaque: largura cheia no mobile; a partir de 900px vira linha e a foto fica
// com 60% dos mesmos 1248px ≈ 749px.
const GRID_WIDTHS = [300, 450, 600, 900];
const GRID_SIZES = '(min-width:1312px) 294px, (min-width:900px) 23vw, (min-width:560px) 30vw, 46vw';
const FEATURED_WIDTHS = [480, 640, 800, 1200, 1600];
const FEATURED_SIZES = '(min-width:1312px) 749px, (min-width:900px) 60vw, 100vw';

// A capa de "em breve" sai com blur(8px) e scale(1.1) por cima. Ela CONTINUA
// sendo a capa do projeto: é dela que vêm a cor dominante do card e a silhueta
// do logo do evento, que é o que o cartão promete antes de existir galeria.
// O que muda é só a resolução pedida — o blur de 8px CSS (≈14px de tela em
// DPR 1.75) já apaga qualquer detalhe mais fino que isso, então largura acima
// do necessário vira byte que ninguém enxerga. 320px deixa margem folgada
// sobre esse limite e ainda pede ~1/4 dos 46 KiB de antes.
const SOON_WIDTHS = [320];
const SOON_FEATURED_WIDTHS = [640];

/**
 * @param {import('../utils.js').Evento[]} events
 * @param {string|null} analyticsToken
 * @param {string} [nonce]
 */
export function galleryHTML(events, analyticsToken, nonce = '') {
  // Second guard beyond getEvents(): a null/non-object entry here would throw
  // on e.visible and 500 the whole homepage instead of just skipping it.
  const safe = Array.isArray(events) ? events.filter(e => e && typeof e === 'object') : [];
  const visible = sortEvents(safe.filter(e => e.visible !== false));
  /** @type {import('../utils.js').Evento[]} */
  const pinned = [];
  /** @type {import('../utils.js').Evento[]} */
  const rest = [];
  for (const e of visible) (e.pinned === true ? pinned : rest).push(e);

  /** @param {import('../utils.js').Evento} e */
  const yearOf = e => e.date ? e.date.slice(0, 4) : String(new Date(eventTime(e)).getFullYear());

  // Uma <picture> em vez de uma <img> solta: o `<source type="image/webp">`
  // faz o WebP ser escolhido pelo BROWSER, antes de a requisição sair. Quem não
  // decodifica WebP nunca pede a URL `-rw`, então não dependemos de o lh3
  // acertar a negociação por `Accept` — e se ele devolvesse JPEG mesmo assim, a
  // página continuaria correta, porque o browser decodifica pelo conteúdo real.
  //
  // `driveSrcset()` devolve vazio para URL que não é do lh3; aí sai uma <img>
  // simples com o `src` de sempre, que é o comportamento certo para um host
  // cujas larguras não controlamos.
  /**
   * @param {string} base URL já normalizada por safeUrl()
   * @param {number[]} widths
   * @param {string} sizes
   * @param {number} fallbackWidth largura do `src`, usado só sem suporte a srcset
   * @param {string} attrs atributos extras da <img> (alt, class, loading…)
   */
  const pictureHTML = (base, widths, sizes, fallbackWidth, attrs) => {
    const src = escape(sizedDriveThumb(base, fallbackWidth));
    const jpeg = driveSrcset(base, widths);
    const webp = driveSrcset(base, widths, { webp: true });
    const responsive = jpeg ? ` srcset="${escape(jpeg)}" sizes="${escape(sizes)}"` : '';
    const source = webp
      ? `<source type="image/webp" srcset="${escape(webp)}" sizes="${escape(sizes)}">`
      : '';
    return `<picture>${source}<img src="${src}"${responsive} ${attrs}></picture>`;
  };

  /**
   * @param {import('../utils.js').Evento} e
   * @param {{ hidden?: boolean, featured?: boolean, pinned?: boolean, priority?: boolean, year?: string }} [opts]
   */
  const cardHTML = (e, { hidden = false, featured = false, pinned: isPinned = false, priority = false, year = yearOf(e) } = {}) => {
    // safeUrl além do escape(): escape() sozinho fecha o atributo mas não mata
    // o esquema, e thumbnailUrl pode vir de um registro antigo que nunca
    // passou por toHttps(). Aplicado ANTES de dimensionar, para que um
    // `http://lh3…` antigo vire https e ainda assim ganhe srcset.
    const base = e.thumbnailUrl ? safeUrl(e.thumbnailUrl) : '';
    const width = featured ? 1600 : 600;
    const thumb = base ? sizedDriveThumb(base, width) : '';
    // O primeiro card da página é o LCP: sai eager e com prioridade alta. Todos
    // os outros continuam `lazy` — adiantá-los só roubaria banda deste.
    const loadAttrs = priority ? 'fetchpriority="high" decoding="async"' : 'loading="lazy" decoding="async"';
    const title = escape((e.title || '').toLowerCase());
    const catLower = escape((e.category || '').toLowerCase());
    const cls = [
      'card',
      featured ? 'card-featured' : '',
      e.comingSoon ? 'card-soon' : '',
      hidden ? 'hidden' : '',
    ].filter(Boolean).join(' ');
    return `
      <a href="/${escape(e.slug)}" class="${cls}"${(featured || isPinned) ? '' : ' data-card'} data-title="${title}" data-cat="${catLower}" data-year="${escape(year)}">
        <div class="thumb${thumb && !e.comingSoon ? ' loading' : ''}"${thumb && !e.comingSoon ? ' aria-busy="true"' : ''}>
          ${e.comingSoon
            ? thumb
              ? `${pictureHTML(base, featured ? SOON_FEATURED_WIDTHS : SOON_WIDTHS, featured ? FEATURED_SIZES : GRID_SIZES, featured ? 640 : 320, `alt="${escape(e.title)}" class="thumb-blur" ${loadAttrs}`)}<div class="thumb-soon-ov">${iconClock()}</div><span class="soon-badge">em breve</span><span class="soon-hint">clique para saber mais</span>`
              : `<div class="thumb-ph">${iconClock()}</div><span class="soon-badge">em breve</span><span class="soon-hint">clique para saber mais</span>`
            : thumb
              ? pictureHTML(base, featured ? FEATURED_WIDTHS : GRID_WIDTHS, featured ? FEATURED_SIZES : GRID_SIZES, width, `alt="${escape(e.title)}" ${loadAttrs}`)
              : `<div class="thumb-ph">${iconCamera()}</div>`}
          ${(featured || isPinned) ? `<span class="featured-badge">Em destaque</span>` : ''}
        </div>
        <div class="info">
          ${e.date ? `<span class="date">${escape(formatDatePT(e.date))}</span>` : ''}
          <h2>${escape(e.title)}</h2>
          ${e.category ? `<span class="cat-tag">${escape(e.category)}</span>` : ''}
        </div>
      </a>`;
  };

  // Um único fixado leva o card "super destaque" (largura cheia). Com mais de
  // um, nenhum vira hero — todos entram no grid normal, só que primeiro e com
  // a etiqueta "Em destaque" (senão vários heroes empilhados dominam a página).
  const singlePinned = pinned.length === 1;

  // O LCP da home é a primeira CAPA da ordem de renderização — não o primeiro
  // card. Um evento sem foto abre com o ícone de câmera, que não pinta nada
  // grande; a prioridade tem que pular para o primeiro que tem foto de verdade,
  // senão gastamos `fetchpriority` num SVG e o LCP continua atrás de um `lazy`.
  const lcpCard = [...pinned, ...rest].find(e => e.thumbnailUrl && safeUrl(e.thumbnailUrl)) || null;

  const pinnedHTML = pinned.map(e => cardHTML(e, { featured: singlePinned, pinned: true, priority: e === lcpCard })).join('');

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
    restNodes.push(cardHTML(e, { hidden: idx >= INITIAL, year: y, priority: e === lcpCard }));
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

  // Capa do cartão de link: a primeira foto de projeto já entregue — a de um
  // "em breve" é a versão borrada, que como miniatura de compartilhamento não
  // diz nada.
  const ogImage = ogImageFor((visible.find(ev => ev.thumbnailUrl && !ev.comingSoon) || {}).thumbnailUrl);

  // O cartão da home mostra o tamanho e o alcance do acervo em vez de repetir
  // o título: quantos projetos, de que tipo e de que período.
  const ogYears = [...new Set(visible.map(yearOf))].sort();
  const ogPeriod = ogYears.length > 1 ? `${ogYears[0]}–${ogYears[ogYears.length - 1]}` : (ogYears[0] || '');
  const ogDescription = previewDescription([
    visible.length > 0 ? `${visible.length} ${visible.length === 1 ? 'projeto' : 'projetos'}` : '',
    presentCats.slice(0, 4).join(', '),
    ogPeriod,
  ], 'Formaturas, casamentos, ensaios e eventos por Luca F. Chala.');

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
  <link rel="canonical" href="${SITE_URL}/">
  <!-- Google Search Console verification: replace VERIFICATION_CODE with your GSC meta tag -->
  <!-- <meta name="google-site-verification" content="VERIFICATION_CODE"> -->
  <!-- Microsoft Clarity: replace PROJECT_ID with your Clarity project ID -->
  <!-- <script type="text/javascript">
    (function(c,l,a,r,i,t,y){
        c[a]=c[a]||function(){(c[a].q=c[a].q||[]).push(arguments)};
        t=l.createElement(r);t.async=1;t.src="https://www.clarity.ms/tag/"+i;
        y=l.getElementsByTagName(r)[0];y.parentNode.insertBefore(t,y);
    })(window, document, "clarity", "script", "PROJECT_ID");
  </script> -->
  ${socialMetaHTML({
    title: 'fotos · Luca F. Chala',
    description: ogDescription,
    url: `${SITE_URL}/`,
    image: ogImage.url,
    imageAlt: 'Galeria de fotos de Luca F. Chala',
    imageWidth: ogImage.width,
    imageHeight: ogImage.height,
  })}
  ${jsonLd ? `<script type="application/ld+json" nonce="${nonce}">${jsonLd}</script>` : ''}
  ${fontPreconnectHTML()}
  ${photoPreconnectHTML()}
  <link href="https://fonts.googleapis.com/css2?family=Inter:ital,wght@0,300;0,400;0,500;0,600;1,300&display=swap" rel="stylesheet">
  <style>
    *,*::before,*::after{box-sizing:border-box;margin:0;padding:0}
    :root{
      --bg-page:#0a0a0a;--bg-card:#111;--bg-card-border:#1c1c1c;--bg-input:#111;--bg-wrap:#0a0a0a;
      --text:#f0ebe5;--text-2:#c8c0b8;--text-muted:#777;--text-dim:#555;--text-ph:#444;
      --border-dim:#1a1a1a;--footer-link:#888;--accent:#c0a060;--accent-hover:#d4b070;
      --cta-bg:#c0a060;--cta-text:#0a0a0a;
      --shimmer-a:#181818;--shimmer-b:#222;
      --banner-bg:#151208;--banner-border:#3a3320;--banner-text:#d8c89a;--banner-text-dim:#8a7a50;
    }
    @media (prefers-color-scheme: light) {
      :root{
        --bg-page:#f0ece8;--bg-card:#fff;--bg-card-border:#ddd9d4;--bg-input:#fff;--bg-wrap:#f0ece8;
        --text:#1a1715;--text-2:#4a4744;--text-muted:#6b6460;--text-dim:#8a8480;--text-ph:#9a9490;
        --border-dim:#ddd9d4;--footer-link:#6b6460;--accent:#8a6428;--accent-hover:#a67d38;
        --cta-bg:#8a6428;--cta-text:#faf7f3;
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
    /* Colapsa ao rolar pra baixo (toggle no script) pra liberar espaço em
       telas pequenas. max-height, não transform, porque precisa liberar o
       espaço de verdade — overflow:hidden esconde o miolo na transição. */
    .controls-wrap{position:sticky;top:0;z-index:10;background:var(--bg-wrap);padding:.75rem 0 0;max-height:400px;overflow:hidden;transition:max-height .25s ease,padding .25s ease}
    .controls-wrap.controls-collapsed{max-height:0;padding-top:0;padding-bottom:0}
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
    .grid{display:grid;grid-template-columns:repeat(2,1fr);gap:.875rem;margin-top:.875rem}
    @media(min-width:560px){.grid{grid-template-columns:repeat(3,1fr);gap:1.125rem}}
    @media(min-width:900px){.grid{grid-template-columns:repeat(4,1fr);gap:1.5rem}}
    .year-head{grid-column:1/-1;font-size:.75rem;font-weight:500;letter-spacing:.18em;text-transform:uppercase;color:var(--text-dim);padding:1.5rem 0 .25rem;border-bottom:1px solid var(--border-dim);margin-bottom:.25rem}
    .card.hidden,.year-head.hidden{display:none}
    .card{display:block;text-decoration:none;color:inherit;border-radius:10px;overflow:hidden;background:var(--bg-card);border:1px solid var(--bg-card-border);transition:transform .2s ease,border-color .2s}
    .card:hover{transform:translateY(-4px);border-color:var(--text-dim)}
    /* Em toque não existe hover: sem isto, tocar num card não devolve nada
       até a próxima página pintar. Composto, responde no mesmo quadro. */
    .card:active{transform:scale(.985)}
    /* Caixa de proporção fixa (grade uniforme, não masonry). object-fit:contain
       nunca corta a foto — o espaço sobrando vira barra na cor do card. */
    .thumb{overflow:hidden;background:var(--bg-card);position:relative;aspect-ratio:4/3;display:flex;align-items:center;justify-content:center}
    /* Esqueleto em TRÊS tempos, para não anunciar espera que ninguém sentiu:
       0-600ms   bloco chapado — a estrutura já está lá, sem movimento;
       600ms+    a varredura aparece (fade), sinalizando "isto está vindo";
       4s+       .slow acrescenta o rótulo, posto pelo script do <head>.
       A varredura anda em transform, não em background-position: só assim ela
       é composta pela GPU. Na versão anterior o Lighthouse acusava as .thumb
       em "Avoid non-composited animations", e cada quadro passava pelo
       Style & Layout do main thread. */
    .thumb.loading{background:var(--shimmer-a)}
    .thumb.loading::after{content:"";position:absolute;inset:0;background:linear-gradient(90deg,transparent 0,var(--shimmer-b) 50%,transparent 100%);transform:translateX(-100%);opacity:0;animation:shimmer-in .25s .6s forwards,shimmer 1.4s .6s infinite linear}
    @keyframes shimmer{to{transform:translateX(100%)}}
    @keyframes shimmer-in{to{opacity:1}}
    @media(prefers-reduced-motion:reduce){.thumb.loading::after{animation:none}}
    /* z-index:1 põe o rótulo acima da varredura (::after, z-index auto) e
       abaixo das etiquetas de canto, que já usam 2. */
    .thumb.loading.slow::before{content:"carregando…";position:absolute;left:50%;top:50%;transform:translate(-50%,-50%);z-index:1;font-size:.6rem;font-weight:500;letter-spacing:.1em;text-transform:uppercase;color:var(--text-dim)}
    /* Foto que não veio mostra o MESMO ícone do card sem capa. Antes daqui ela
       virava um retângulo vazio: quem não tem foto se explicava, quem perdeu a
       foto não. Em CSS, e não em marcação, para não pagar o SVG em todo card. */
    .thumb.failed::after{content:"";position:absolute;inset:0;background:url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='28' height='28' viewBox='0 0 24 24' fill='none' stroke='%23252525' stroke-width='1.25'%3E%3Crect x='3' y='5' width='18' height='15' rx='2'/%3E%3Ccircle cx='12' cy='12' r='4'/%3E%3Cpath d='M9 5l1.5-2h3L15 5'/%3E%3C/svg%3E") center no-repeat}
    .thumb.loading img{opacity:0}
    .soon-badge{position:absolute;top:.5rem;right:.5rem;background:rgba(0,0,0,.7);color:#c0a060;font-size:.6rem;font-weight:600;letter-spacing:.12em;text-transform:uppercase;padding:.25rem .55rem;border-radius:4px;border:1px solid rgba(192,160,96,.3);backdrop-filter:blur(4px);z-index:2}
    /* Uma única regra de transition: opacity e transform em regras separadas
       faziam a segunda sobrescrever a primeira, e a foto aparecia de estalo. */
    /* O elemento picture é só um invólucro: sem carregar a caixa, o
       height:100% da imagem não teria contra o que resolver e o card
       esticaria. (Sem escrever a tag aqui: marcação dentro do style confunde
       tanto quem lê quanto os testes que varrem o HTML emitido.) */
    .thumb picture{display:block;width:100%;height:100%}
    .thumb img{width:100%;height:100%;object-fit:contain;display:block;transition:opacity .3s ease,transform .4s ease}
    .card:hover .thumb img{transform:scale(1.06)}
    .thumb-ph{width:100%;height:100%;display:flex;align-items:center;justify-content:center;color:#252525}
    .thumb-blur{width:100%;height:100%;object-fit:cover;filter:blur(8px);transform:scale(1.1);display:block}
    .thumb-soon-ov{position:absolute;inset:0;display:flex;align-items:center;justify-content:center;color:#555}
    /* O relógio sozinho não sinalizava "clicável" — hover/foco pinta o ícone
       na cor de destaque e revela uma dica, pro card não parecer morto. */
    .card-soon .thumb-ph,.card-soon .thumb-soon-ov{transition:color .2s ease}
    .card-soon:hover .thumb-ph,.card-soon:hover .thumb-soon-ov,.card-soon:focus-visible .thumb-ph,.card-soon:focus-visible .thumb-soon-ov{color:var(--accent)}
    .soon-hint{position:absolute;bottom:.5rem;left:50%;transform:translate(-50%,4px);font-size:.62rem;font-weight:600;letter-spacing:.06em;text-transform:uppercase;color:#f0ebe5;background:rgba(0,0,0,.6);padding:.3rem .6rem;border-radius:20px;backdrop-filter:blur(4px);opacity:0;transition:opacity .2s ease,transform .2s ease;white-space:nowrap;pointer-events:none;z-index:2}
    .card-soon:hover .soon-hint,.card-soon:focus-visible .soon-hint{opacity:1;transform:translate(-50%,0)}
    .info{padding:1rem 1rem 1.125rem}
    .date{font-size:.625rem;font-weight:500;letter-spacing:.1em;text-transform:uppercase;color:var(--text-dim)}
    .info h2{font-size:1.05rem;font-weight:600;margin:.4rem 0 .5rem;line-height:1.3}
    .cat-tag{display:inline-block;font-size:.58rem;font-weight:600;letter-spacing:.08em;text-transform:uppercase;color:var(--accent);background:rgba(192,160,96,.1);border:1px solid rgba(192,160,96,.2);border-radius:4px;padding:.15rem .45rem;margin-top:.4rem}
    .card-featured{grid-column:1/-1}
    .card-featured .thumb{aspect-ratio:3/2}
    .featured-badge{position:absolute;top:.5rem;left:.5rem;background:rgba(240,235,229,.12);color:#f0ebe5;font-size:.6rem;font-weight:600;letter-spacing:.12em;text-transform:uppercase;padding:.25rem .55rem;border-radius:4px;border:1px solid rgba(240,235,229,.2);backdrop-filter:blur(4px);z-index:2}
    /* Precisa de height definida (não só min-height): sem isso, height:100%
       da <img> não resolve, cai pra auto, e o card estica pra caber uma
       foto de retrato. */
    @media(min-width:900px){.card-featured{display:flex;flex-direction:row;height:420px}.card-featured .thumb{aspect-ratio:unset;width:60%;flex-shrink:0;height:100%}.card-featured .info{flex:1;padding:1.75rem;display:flex;flex-direction:column;justify-content:center;overflow:hidden}.card-featured .info h2{font-size:1.35rem}}
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
  <!-- A capa só aparece quando o script tira a classe "loading" (é ele que sabe
       que a foto assentou). Sem JS ninguém tira, e a galeria inteira ficava
       invisível — um esqueleto que nunca vira conteúdo. Estas três regras
       devolvem a página a quem bloqueia script: sem varredura, sem rótulo, e a
       foto visível desde o começo. -->
  <noscript><style>
    .thumb.loading{background:var(--bg-card)}
    .thumb.loading::after{display:none}
    .thumb.loading img{opacity:1}
  </style></noscript>
  ${perfBootScript('gallery', !!analyticsToken, nonce)}
  <!-- Prefetch no hover (~200ms) ou no pointerdown, não na carga: só gasta com
       o link que o visitante já demonstrou querer. "prefetch", nunca
       "prerender" — prerender EXECUTA o JS da página, e dispararia o beacon de
       performance e o da Cloudflare por uma visita que talvez não aconteça.
       Do lado do servidor, handleEventPage() ignora "Sec-Purpose: prefetch"
       na contagem, senão a métrica passaria a contar hover. -->
  <script type="speculationrules" nonce="${escape(nonce)}">
    {"prefetch":[{"where":{"and":[{"href_matches":"/*"},{"not":{"href_matches":"/dashboard*"}},{"not":{"href_matches":"/api/*"}}]},"eagerness":"moderate"}]}
  </script>
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

  <script nonce="${nonce}">
    // Daqui até o fecha-script tudo vive dentro de um template literal: uma
    // crase solta, em comentário ou string, encerra a string e quebra o módulo.
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

      // Reflects q/cat into the URL (no reload) so Back navigation lands on
      // a URL that already encodes filter state — read back by restore below.
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

      // Restore q/cat from the URL (syncURL wrote it before navigating away)
      // and shown/scroll from sessionStorage, so Back lands where you left off.
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

      // Colapsa a busca ao rolar pra baixo (reabre ao rolar pra cima ou perto
      // do topo). Não colapsa com filtro ativo ou busca focada, pra não sumir
      // "N resultados"/"Limpar filtros" no meio do uso.
      var controlsWrap = document.querySelector('.controls-wrap');
      if (controlsWrap) {
        var lastScrollY = window.scrollY || document.documentElement.scrollTop;
        var controlsTicking = false;
        var onControlsScroll = function() {
          var y = window.scrollY || document.documentElement.scrollTop;
          var delta = y - lastScrollY;
          if (y < 48) {
            controlsWrap.classList.remove('controls-collapsed');
          } else if (!isFiltering() && document.activeElement !== searchEl) {
            if (delta > 4) controlsWrap.classList.add('controls-collapsed');
            else if (delta < -4) controlsWrap.classList.remove('controls-collapsed');
          }
          lastScrollY = y;
          controlsTicking = false;
        };
        addEventListener('scroll', function(){
          if (!controlsTicking) { controlsTicking = true; requestAnimationFrame(onControlsScroll); }
        }, { passive: true });
      }
    })();
  </script>
  ${analyticsBeaconHTML(analyticsToken, nonce)}
</body>
</html>`;
}

function iconCamera() {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.25"><rect x="3" y="5" width="18" height="15" rx="2"/><circle cx="12" cy="12" r="4"/><path d="M9 5l1.5-2h3L15 5"/></svg>`;
}

function iconClock() {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.25"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>`;
}
