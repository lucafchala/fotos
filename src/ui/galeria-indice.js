// Índice da galeria por capítulos (v3.1): um cartão por subpasta de primeiro
// nível da pasta do projeto. Página de servidor; o único JS do navegador é o
// pequeno script das "N novas" (#250, SCRIPT_NOVAS, com nonce). O cartão leva a capa e a contagem do RESUMO guardado
// no cache (drive.js, registraResumo): capítulo que ninguém abriu ainda fica com
// um espaço reservado e o texto "Ver fotos" (ler a lista de cada capítulo só
// para desenhar o índice custaria a cota do Google e o teto de subrequisições).

import { honeypotFieldHTML, HONEYPOT_CSS } from '../security.js';
import { escape, jsonParaScript, formatDatePT, fontFaceCSS, fontPreloadHTML, photoPreconnectHTML, socialMetaHTML, previewDescription, ogImageFor, isRestrictedAccess } from '../utils.js';
import { urlLh3, descreveRenovacao, pastaDoDrive, parseCreditos } from '../drive.js';
import { EPOCA_CRIADA_MS, NOVAS_SESSAO_MIN, NOVAS_RESUMO_MAX, TURNSTILE_SITE_KEY } from '../config.js';

const SITE_URL = 'https://fotos.lucafchala.com';

/**
 * @param {{
 *   event: import('../utils.js').Evento,
 *   caps: import('../drive.js').CapitulosDrive,
 *   resumo: Record<string, import('../drive.js').ResumoCap>,
 *   ocultas: string[],
 *   dono: boolean,
 *   indexavel: boolean,
 *   nonce?: string,
 *   rosto?: { token: string } | null,
 * }} p
 */
export function galeriaIndiceHTML({ event, caps, resumo, ocultas, dono, indexavel, nonce = '', rosto = null }) {
  const titulo = String(event.title || event.slug || '');
  const slug = String(event.slug || '');
  const base = `/galeria/${slug}`;
  const dataEvento = event.date ? formatDatePT(String(event.date)) : '';
  const tituloPagina = `Fotos de ${titulo}${dataEvento ? ` — ${dataEvento}` : ''}`;
  // Capítulo com resumo guardado dizendo 0 fotos não aparece para o visitante
  // (a pasta existe, mas ainda não chegou nada); o dono o vê marcado "vazio".
  // Sem resumo (ninguém abriu ainda) o capítulo aparece normalmente.
  /** @param {{ id: string }} c */
  const vazio = c => { const r = resumo[c.id]; return !!r && r.n === 0; };
  const visiveis = caps.caps.filter(c => dono || !vazio(c));
  // Cartão de link: a contagem vem do resumo (só dos capítulos que alguém já
  // abriu; sem resumo nenhum, só "N eventos"). Álbum família/privado só abre
  // com o passe do portão; mesmo com ele o cartão sai genérico (sem capa).
  const restrito = isRestrictedAccess(event);
  const fotosNoResumo = visiveis.reduce((n, c) => n + (resumo[c.id] ? resumo[c.id].n : 0), 0);
  const descricao = restrito
    ? previewDescription([], `Galeria de fotos de ${titulo}.`)
    : previewDescription(
      [dataEvento, visiveis.length ? `${visiveis.length} ${visiveis.length === 1 ? 'evento' : 'eventos'}` : '', fotosNoResumo ? `${fotosNoResumo} ${fotosNoResumo === 1 ? 'foto' : 'fotos'}` : ''],
      `Galeria de fotos de ${titulo}, por Luca F. Chala. Escolha o evento para ver as fotos.`,
    );
  const ocultasSet = new Set(ocultas);
  const cartoes = visiveis.map(c => {
    const r = resumo[c.id];
    // A capa é a primeira foto do capítulo que não está oculta.
    const capa = r ? r.capas.find(id => !ocultasSet.has(id)) : '';
    const n = r ? r.n : 0;
    const href = `${base}/${c.slug}`;
    const img = capa
      ? `<img src="${escape(urlLh3(capa, 480))}" alt="" width="480" height="320" loading="lazy" decoding="async" referrerpolicy="no-referrer">`
      : '<span class="ix-vazio" aria-hidden="true"></span>';
    const sub = r ? (n === 0 ? 'vazio' : n === 1 ? '1 foto' : `${n} fotos`) : 'Ver fotos';
    // Fotos novas (#250): os instantes recentes vão no cartão; quem decide o
    // que é "novo" é o navegador, comparando com a última visita guardada lá.
    const cr = r && r.cr && r.cr.length ? ` data-cr="${r.cr.join(',')}"` : '';
    return `<li><a class="ix-card${vazio(c) ? ' ix-card-vazio' : ''}" href="${escape(href)}" data-cap="${escape(c.slug)}"${cr}>${img}<span class="ix-nome">${escape(c.nome)}</span><span class="ix-sub">${escape(sub)}</span></a></li>`;
  });
  const og = caps.caps.map(c => resumo[c.id]).find(r => r && r.capas.find(id => !ocultasSet.has(id)));
  const ogCapa = og ? og.capas.find(id => !ocultasSet.has(id)) : '';
  // A capa do cartão: a do projeto, se o dono cadastrou; senão a do primeiro
  // capítulo com foto.
  const ogImage = ogImageFor(restrito ? '' : event.thumbnailUrl || (ogCapa ? urlLh3(ogCapa, 1200) : ''));
  const avisoTrunc = dono && caps.truncada
    ? '<p class="ix-aviso">O Drive tem mais subpastas do que o índice mostra (até 100). As demais ficam de fora; reúna eventos antigos em outra pasta.</p>'
    : '';
  // Busca pelo rosto (v3.2): quem decide se vale é o servidor (buscaRostoAtiva).
  const comRosto = !!rosto && !restrito && visiveis.length > 0;
  const botaoRosto = comRosto ? '<button type="button" class="ab-btn ab-btn-2" id="rs-abrir" hidden>Procurar meu rosto</button>' : '';
  const abertura = aberturaHTML({ event, titulo, dataEvento, visiveis, resumo, ocultasSet, restrito, botaoRosto });
  const quandoCaps = new Date(caps.em).toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
  const barraDono = dono ? `<div class="ix-dono"><b>Painel</b><span>Só você (logado) vê esta faixa.</span><a href="/dashboard">← Painel</a><a href="/${escape(slug)}">Página do projeto</a><a href="?atualizar=1" title="Relê as subpastas no Drive agora (${escape(descreveRenovacao(event))})">Atualizar agora</a><span>Atualizada em ${escape(quandoCaps)}</span></div>` : '';

  return `<!DOCTYPE html>
<html lang="pt-BR">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0, viewport-fit=cover">
  <meta name="robots" content="${indexavel ? 'index,follow,max-image-preview:large' : 'noindex,nofollow'}">
  <meta name="theme-color" content="#0a0a0a">
  <link rel="icon" type="image/svg+xml" href="/icon.svg">
  <link rel="apple-touch-icon" href="/apple-touch-icon.png">
  <link rel="manifest" href="/manifest.json">
  <title>${escape(tituloPagina)}</title>
  <link rel="canonical" href="${escape(SITE_URL + base)}">
  ${socialMetaHTML({
    title: tituloPagina,
    description: descricao,
    url: SITE_URL + base,
    image: ogImage.url,
    imageAlt: `Fotos de ${titulo}`,
    imageWidth: ogImage.width,
    imageHeight: ogImage.height,
  })}
  ${fontPreloadHTML()}
  ${photoPreconnectHTML()}
  <style>
    ${fontFaceCSS()}
    *,*::before,*::after{box-sizing:border-box;margin:0;padding:0}
    :root{--bg-page:#0a0a0a;--text:#f0ebe5;--text-2:#bbb;--text-muted:#999;--bg-card:#141414;--esqueleto:#1d1d1d;--border:#262626;--accent:#c0a060;--warn-bg:#1d1606;--warn-border:#4a3a12;--warn-text:#d8b25a;--pad:clamp(12px,3vw,32px)}
    @media (prefers-color-scheme: light){:root{--bg-page:#f0ece8;--text:#1a1715;--text-2:#4a4744;--text-muted:#665f5b;--bg-card:#e5e1db;--esqueleto:#dcd7d0;--border:#ddd9d4;--accent:#7d5a22;--warn-bg:#fdf3dc;--warn-border:#e8d1a0;--warn-text:#7a5a17}}
    body{font-family:'Inter',sans-serif;background:var(--bg-page);color:var(--text);min-height:100vh;-webkit-text-size-adjust:100%}
    :focus-visible{outline:2px solid var(--accent);outline-offset:2px}
    a{color:inherit}
    .ix-dono{display:flex;flex-wrap:wrap;align-items:center;gap:.4rem 1rem;padding:.5rem var(--pad);font-size:.78rem;color:var(--text-muted);background:var(--bg-card);border-bottom:1px solid var(--border)}
    .ix-dono a{color:var(--text-2);text-decoration:underline;text-underline-offset:2px;padding:.55rem 0}
    .ix-dono b{font-weight:600;color:var(--accent);letter-spacing:.06em;text-transform:uppercase;font-size:.7rem;border:1px solid var(--accent);border-radius:4px;padding:.1rem .4rem}
    .ix-top{padding:1rem var(--pad) .5rem}
    .ix-voltar{display:inline-flex;align-items:center;min-height:44px;font-size:.85rem;color:var(--text-2);text-decoration:none}
    .ix-top h1{font-size:clamp(1.25rem,3.4vw,1.9rem);font-weight:600;letter-spacing:-.01em;overflow-wrap:anywhere}
    .ix-meta{font-size:.85rem;color:var(--text-muted);margin-top:.25rem}
    .ix-aviso{margin:.5rem var(--pad);padding:.7rem .9rem;border:1px solid var(--warn-border);background:var(--warn-bg);color:var(--warn-text);border-radius:8px;font-size:.85rem}
    .ix-grade{list-style:none;display:grid;grid-template-columns:repeat(auto-fill,minmax(min(100%,150px),1fr));gap:12px;padding:.75rem var(--pad) 2.5rem}
    .ix-card{display:flex;flex-direction:column;height:100%;border:1px solid var(--border);border-radius:10px;overflow:hidden;background:var(--bg-card);text-decoration:none}
    .ix-card:hover{border-color:var(--accent)}
    .ix-card img,.ix-vazio{display:block;width:100%;height:auto;aspect-ratio:3/2;object-fit:cover;background:var(--esqueleto)}
    .ix-nome{padding:.6rem .75rem .1rem;font-size:.92rem;font-weight:600;line-height:1.3;overflow-wrap:anywhere}
    .ix-sub{padding:0 .75rem .75rem;font-size:.78rem;color:var(--text-muted)}
    .ix-card-vazio{opacity:.65;border-style:dashed}
    .ix-novas{display:inline-block;margin-left:.45rem;padding:.05rem .45rem;border:1px solid var(--accent);border-radius:999px;font-size:.7rem;color:var(--accent);white-space:nowrap}
    .ix-vazio-msg{padding:2rem var(--pad);color:var(--text-muted)}
    .ab{position:relative;padding-bottom:1.5rem}
    .ab-mosaico{position:relative;display:grid;grid-template-columns:repeat(4,1fr);grid-template-rows:repeat(2,clamp(90px,17vw,240px));gap:3px;overflow:hidden}
    .ab-mosaico img{display:block;width:100%;height:100%;object-fit:cover;background:var(--esqueleto);animation:ab-surge .9s ease-out both}
    .ab-mosaico img:first-child{grid-column:span 2;grid-row:span 2}
    .ab-mosaico img:nth-child(2){animation-delay:.08s}.ab-mosaico img:nth-child(3){animation-delay:.16s}.ab-mosaico img:nth-child(4){animation-delay:.24s}.ab-mosaico img:nth-child(5){animation-delay:.32s}
    .ab-mosaico::after{content:"";position:absolute;inset:auto 0 0 0;height:40%;background:linear-gradient(to bottom,transparent,var(--bg-page));pointer-events:none}
    @keyframes ab-surge{from{opacity:0;transform:scale(1.04)}to{opacity:1;transform:none}}
    @media (prefers-reduced-motion: reduce){.ab-mosaico img{animation:none}}
    @media (max-width: 560px){.ab-mosaico{grid-template-columns:repeat(3,1fr);grid-template-rows:repeat(2,30vw)}.ab-mosaico img:nth-child(n+4){display:none}}
    .ab-texto{position:relative;max-width:46rem;margin:-2.5rem auto 0;padding:0 var(--pad)}
    .ab-texto-solo{margin-top:2rem}
    .ab h1{font-size:clamp(2rem,7vw,3.6rem);font-weight:700;line-height:1.05;letter-spacing:-.025em;margin:.35rem 0 .6rem;overflow-wrap:anywhere}
    .ab-meta{font-size:.9rem;color:var(--text-muted)}
    .ab-intro{margin-top:1.25rem;font-size:clamp(1rem,2.2vw,1.12rem);line-height:1.65;color:var(--text-2)}
    .ab-intro p+p{margin-top:.9rem}
    .ab-acoes{display:flex;flex-wrap:wrap;gap:.6rem;margin-top:1.5rem}
    .ab-btn{display:inline-flex;align-items:center;min-height:44px;padding:0 1.1rem;border-radius:999px;font-size:.92rem;font-weight:600;text-decoration:none;border:1px solid var(--accent)}
    .ab-btn-1{background:var(--accent);color:var(--bg-page)}
    .ab-btn-2{color:var(--accent)}
    .ab-btn:hover{filter:brightness(1.08)}
    .ab-voltar{display:inline-flex;align-items:center;min-height:44px;margin-top:.75rem;font-size:.8rem;color:var(--text-muted)}
    .rs{margin:auto;width:min(30rem,calc(100vw - 2rem));max-height:calc(100dvh - 2rem);overflow:auto;border:1px solid var(--border);border-radius:14px;background:var(--bg-card);color:var(--text);padding:1.25rem 1.25rem 1rem}
    .rs::backdrop{background:rgba(0,0,0,.6)}
    .rs-t{font-size:1.1rem;font-weight:600;margin-bottom:.6rem}
    .rs p,.rs li{font-size:.9rem;line-height:1.55;color:var(--text-2)}
    .rs ul{margin:.6rem 0 .8rem 1.1rem}
    .rs-aceite{display:flex;gap:.6rem;align-items:flex-start;font-size:.88rem;line-height:1.45;margin:.4rem 0 .8rem;cursor:pointer}
    .rs-aceite input{margin-top:.2rem;width:1.1rem;height:1.1rem;flex:none;accent-color:var(--accent)}
    .rs-erro{color:var(--warn-text);min-height:1.2em;margin:.4rem 0}
    .rs-acoes{display:flex;flex-wrap:wrap;justify-content:flex-end;gap:.5rem;margin-top:.6rem}
    .rs-btn{min-height:44px;padding:0 1rem;border-radius:999px;border:1px solid var(--border);background:transparent;color:var(--text);font:inherit;font-size:.9rem;cursor:pointer}
    .rs-btn-1{background:var(--accent);border-color:var(--accent);color:var(--bg-page);font-weight:600}
    .rs-btn:disabled{opacity:.5;cursor:default}
    .rs-link{background:none;border:0;color:var(--text-muted);font:inherit;font-size:.8rem;text-decoration:underline;cursor:pointer;min-height:44px;padding:0}
    .rs-res{padding:1rem var(--pad) 0}
    .rs-res h2{font-size:1.05rem;font-weight:600}
    .rs-res p{font-size:.85rem;color:var(--text-muted);margin-top:.25rem}
    .rs-grade{list-style:none;display:grid;grid-template-columns:repeat(auto-fill,minmax(min(100%,110px),1fr));gap:6px;margin-top:.75rem}
    .rs-grade a{display:block;position:relative;border-radius:8px;overflow:hidden;background:var(--esqueleto)}
    .rs-grade img{display:block;width:100%;height:auto;aspect-ratio:1;object-fit:cover}
    .rs-grade span{position:absolute;left:0;right:0;bottom:0;padding:.9rem .4rem .3rem;font-size:.7rem;color:#fff;background:linear-gradient(transparent,rgba(0,0,0,.7));white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
    ${HONEYPOT_CSS}
    .ab-eventos{font-size:1.05rem;font-weight:600;padding:.5rem var(--pad) 0;max-width:none;scroll-margin-top:1rem}
  </style>
</head>
<body>
  ${barraDono}
  ${abertura || `<header class="ix-top">
    <a class="ix-voltar" href="/${escape(slug)}"><span aria-hidden="true">‹</span>&nbsp;Página do projeto</a>
    <h1>${escape(titulo)}</h1>
    <p class="ix-meta">${escape([dataEvento, visiveis.length ? `${visiveis.length} ${visiveis.length === 1 ? 'evento' : 'eventos'}` : ''].filter(Boolean).join(' · '))}</p>
    ${botaoRosto ? `<div class="ab-acoes">${botaoRosto}</div>` : ''}
  </header>`}
  ${comRosto ? rostoHTML() : ''}
  ${avisoTrunc}
  <main id="g-main" aria-label="Eventos">
    ${abertura && cartoes.length ? '<h2 class="ab-eventos" id="eventos">Os eventos</h2>' : ''}
    ${cartoes.length ? `<ul class="ix-grade">${cartoes.join('\n    ')}</ul>` : `<p class="ix-vazio-msg">${dono && !caps.caps.length ? 'A pasta não tem subpastas: não há eventos para mostrar.' : 'As fotos estão chegando. Volte em breve.'}</p>`}
  </main>
  ${cartoes.length ? `<script nonce="${nonce}">${SCRIPT_NOVAS(slug)}</script>` : ''}
  ${comRosto ? `<script type="application/json" id="rs-dados" nonce="${nonce}">${jsonParaScript({ slug, token: /** @type {{ token: string }} */ (rosto).token, ts: TURNSTILE_SITE_KEY, caps: Object.fromEntries(visiveis.map(c => [c.slug, c.nome])) })}</script>
  <script nonce="${nonce}">${SCRIPT_ROSTO}</script>` : ''}
</body>
</html>`;
}

/**
 * Marca "N novas" nos cartões. A última visita a cada capítulo mora só no
 * localStorage do visitante (gravada pela página do capítulo): nada disto vai
 * ao servidor. Sem visita anterior não há o que comparar e nada é marcado.
 * Fica fora de qualquer crase, `dollar-chave` e barra invertida: é JS de navegador
 * dentro de um template literal.
 * @param {string} slug
 */
const SCRIPT_NOVAS = slug => `(function () {
  var SLUG = ${JSON.stringify(slug).replace(/</g, '\\u003c')};
  var EPOCA = ${EPOCA_CRIADA_MS};
  var SESSAO = ${NOVAS_SESSAO_MIN} * 60000;
  var MAX = ${NOVAS_RESUMO_MAX};
  var agora = Date.now();
  var cartoes = document.querySelectorAll('a.ix-card[data-cr]');
  for (var i = 0; i < cartoes.length; i++) {
    var a = cartoes[i];
    var ant = 0;
    try {
      var v = JSON.parse(localStorage.getItem('gal-visita:' + SLUG + ':' + a.getAttribute('data-cap')) || 'null');
      if (v && typeof v.u === 'number') ant = agora - v.u > SESSAO ? v.u : (typeof v.p === 'number' ? v.p : 0);
    } catch (e) { ant = 0; }
    if (!ant) continue;
    var cr = a.getAttribute('data-cr').split(',');
    var n = 0;
    for (var j = 0; j < cr.length; j++) if (EPOCA + Number(cr[j]) * 60000 > ant) n++;
    if (!n) continue;
    var s = document.createElement('span');
    s.className = 'ix-novas';
    s.textContent = (n >= MAX ? MAX + '+' : n) + (n === 1 ? ' nova' : ' novas');
    var sub = a.querySelector('.ix-sub');
    if (sub) sub.appendChild(s);
  }
})();`;

/**
 * A abertura do índice (v3.1, campo `galeriaAbertura`): mosaico com as capas
 * dos capítulos, o título grande, o texto do dono, os números do álbum e os
 * botões. Sem texto, '' — o índice segue com o cabeçalho simples. As capas e
 * as contagens vêm do mesmo resumo dos cartões: nenhuma chamada a mais.
 * @param {{
 *   event: import('../utils.js').Evento, titulo: string, dataEvento: string,
 *   visiveis: { id: string }[], resumo: Record<string, import('../drive.js').ResumoCap>,
 *   ocultasSet: Set<string>, restrito: boolean, botaoRosto?: string,
 * }} p
 */
function aberturaHTML({ event, titulo, dataEvento, visiveis, resumo, ocultasSet, restrito, botaoRosto = '' }) {
  const texto = typeof event.galeriaAbertura === 'string' ? event.galeriaAbertura.trim() : '';
  if (!texto) return '';
  const slug = String(event.slug || '');
  const paragrafos = texto.split(/\n\s*\n/).map(p => p.trim()).filter(Boolean)
    .map(p => `<p>${p.split('\n').map(l => escape(l.trim())).join('<br>')}</p>`);
  // Capas: a primeira de cada capítulo, depois a segunda de cada um, até 5 —
  // assim o mosaico mostra eventos diferentes antes de repetir um. Álbum
  // família/privado não ganha mosaico (o mesmo critério do cartão de link).
  /** @type {string[]} */
  const capas = [];
  if (!restrito) {
    const listas = visiveis.map(c => (resumo[c.id] ? resumo[c.id].capas.filter(id => !ocultasSet.has(id)) : []));
    for (let i = 0; capas.length < 5 && listas.some(l => l.length > i); i++) {
      for (const l of listas) if (l[i] && capas.length < 5 && !capas.includes(l[i])) capas.push(l[i]);
    }
  }
  // 5 enchem a grade do computador (uma grande + 4); o celular mostra 3.
  const mosaico = capas.length >= 3
    ? `<div class="ab-mosaico" aria-hidden="true">${capas.map((id, i) => `<img src="${escape(urlLh3(id, i === 0 ? 960 : 480))}" alt="" ${i === 0 ? 'fetchpriority="high"' : 'loading="lazy"'} decoding="async" referrerpolicy="no-referrer">`).join('')}</div>`
    : '';
  // Números: a contagem de fotos só quando todos os capítulos já têm resumo
  // (senão seria um número menor que o real).
  const todosComResumo = visiveis.length > 0 && visiveis.every(c => resumo[c.id]);
  const fotos = todosComResumo ? visiveis.reduce((n, c) => n + resumo[c.id].n, 0) : 0;
  const autores = [...new Set(parseCreditos(event.galeriaCreditos).values())].filter(Boolean);
  const listaAutores = autores.length > 1 ? `${autores.slice(0, -1).join(', ')} e ${autores[autores.length - 1]}` : (autores[0] || '');
  const meta = [
    dataEvento,
    visiveis.length ? `${visiveis.length} ${visiveis.length === 1 ? 'evento' : 'eventos'}` : '',
    fotos ? `${fotos.toLocaleString('pt-BR')} ${fotos === 1 ? 'foto' : 'fotos'}` : '',
    listaAutores ? `fotos de ${listaAutores}` : '',
  ].filter(Boolean).join(' · ');
  const pasta = restrito ? null : pastaDoDrive(event.driveUrl);
  const urlPasta = pasta ? `https://drive.google.com/drive/folders/${pasta.id}${pasta.resourceKey ? `?resourcekey=${pasta.resourceKey}` : ''}` : '';
  const acoes = [
    visiveis.length ? '<a class="ab-btn ab-btn-1" href="#eventos">Ver os eventos</a>' : '',
    botaoRosto,
    urlPasta ? `<a class="ab-btn ab-btn-2" href="${escape(urlPasta)}" target="_blank" rel="nofollow noopener" data-acao="mandar-fotos">Mandar suas fotos</a>` : '',
  ].filter(Boolean).join('');
  return `<header class="ab">
    ${mosaico}
    <div class="ab-texto${mosaico ? '' : ' ab-texto-solo'}">
      <h1>${escape(titulo)}</h1>
      ${meta ? `<p class="ab-meta">${escape(meta)}</p>` : ''}
      <div class="ab-intro">${paragrafos.join('')}</div>
      ${acoes ? `<div class="ab-acoes">${acoes}</div>` : ''}
      <a class="ab-voltar" href="/${escape(slug)}"><span aria-hidden="true">‹</span>&nbsp;Página do projeto</a>
    </div>
  </header>`;
}

/** O diálogo da busca pelo rosto (o script liga o botão; sem JS, nada aparece). */
function rostoHTML() {
  return `<dialog class="rs" id="rs" aria-labelledby="rs-t">
    <form method="dialog" id="rs-form">
      <p class="rs-t" id="rs-t">Procurar meu rosto</p>
      <div id="rs-txt-buscar">
        <p>Tire uma selfie (ou escolha uma foto sua) e o site mostra as fotos do álbum em que você provavelmente aparece.</p>
        <ul>
          <li>A selfie vai para a Amazon Rekognition, em São Paulo, só para a comparação. Nem o site nem a Amazon a guardam.</li>
          <li>O resultado é aproximado: pode faltar foto e pode aparecer alguém parecido.</li>
          <li>Use só com o <strong>seu</strong> rosto.</li>
        </ul>
      </div>
      <div id="rs-txt-sair" hidden>
        <p>Envie uma selfie e o site tira o seu rosto da busca deste álbum: ninguém mais acha as suas fotos por ela, nem as que chegarem depois.</p>
        <ul>
          <li>Para isso, o seu rosto fica guardado (só ele, só para esse fim) até o fim do álbum. Para apagar: privacidade@lucafchala.com.</li>
          <li>As fotos continuam no álbum. Para tirar uma foto, use "Pedir remoção" nela.</li>
        </ul>
      </div>
      <label class="rs-aceite"><input type="checkbox" id="rs-aceite"><span>Concordo com o uso do meu rosto para isso, como explica a <a href="/privacidade#busca-rosto" target="_blank" rel="noopener">política de privacidade</a>.</span></label>
      ${honeypotFieldHTML()}
      <div id="rs-ts"></div>
      <p class="rs-erro" id="rs-erro" role="alert"></p>
      <input type="file" id="rs-arquivo" accept="image/*" capture="user" hidden>
      <div class="rs-acoes">
        <button type="button" class="rs-btn" data-rs="fechar">Cancelar</button>
        <button type="button" class="rs-btn rs-btn-1" id="rs-tirar" disabled>Tirar selfie</button>
      </div>
      <p><button type="button" class="rs-link" id="rs-modo">Não quero aparecer na busca</button></p>
    </form>
  </dialog>
  <section class="rs-res" id="rs-res" hidden aria-live="polite"><h2 id="rs-res-t" tabindex="-1"></h2><p id="rs-res-sub"></p><ul class="rs-grade" id="rs-grade"></ul></section>`;
}

/**
 * O script da busca pelo rosto: reduz a selfie no próprio aparelho (640 px,
 * JPEG), manda com o aceite e os tokens, e desenha o resultado. A selfie só
 * existe na memória da página: não vai para o localStorage nem fica na tela.
 * Fora de crase, `dollar-chave` e barra invertida: é JS dentro de template literal.
 */
const SCRIPT_ROSTO = `(function () {
  var el = document.getElementById('rs-dados');
  var dlg = document.getElementById('rs');
  var abrir = document.getElementById('rs-abrir');
  if (!el || !dlg || !abrir || typeof dlg.showModal !== 'function' || !window.fetch || !window.createImageBitmap) return;
  var D = JSON.parse(el.textContent || '{}');
  var aceite = document.getElementById('rs-aceite');
  var tirar = document.getElementById('rs-tirar');
  var arquivo = document.getElementById('rs-arquivo');
  var erro = document.getElementById('rs-erro');
  var modo = document.getElementById('rs-modo');
  var sair = false, token = '', widget = null, ocupado = false, tsEstado = 'fora';
  abrir.hidden = false;
  function msg(t) { erro.textContent = t || ''; }
  function botao() { tirar.disabled = ocupado || !aceite.checked || !token; }
  function turnstile() {
    if (tsEstado !== 'fora') { if (widget !== null && window.turnstile) window.turnstile.reset(widget); return; }
    tsEstado = 'carregando';
    var sc = document.createElement('script');
    sc.src = 'https://challenges.cloudflare.com/turnstile/v0/api.js';
    sc.async = true;
    sc.onload = function () {
      if (!window.turnstile) { tsEstado = 'falhou'; msg('A verificação de segurança não carregou (um bloqueador pode estar impedindo).'); return; }
      tsEstado = 'pronto';
      widget = window.turnstile.render('#rs-ts', {
        sitekey: D.ts,
        callback: function (t) { token = t; botao(); },
        'error-callback': function () { token = ''; botao(); },
        'expired-callback': function () { token = ''; botao(); }
      });
    };
    sc.onerror = function () { tsEstado = 'falhou'; msg('A verificação de segurança não carregou (um bloqueador pode estar impedindo).'); };
    document.head.appendChild(sc);
  }
  function poeModo(s) {
    sair = s;
    document.getElementById('rs-t').textContent = s ? 'Sair da busca pelo rosto' : 'Procurar meu rosto';
    document.getElementById('rs-txt-buscar').hidden = s;
    document.getElementById('rs-txt-sair').hidden = !s;
    tirar.textContent = s ? 'Enviar selfie e sair' : 'Tirar selfie';
    modo.textContent = s ? 'Quero procurar meu rosto' : 'Não quero aparecer na busca';
    msg('');
  }
  abrir.addEventListener('click', function () { poeModo(false); aceite.checked = false; botao(); dlg.showModal(); turnstile(); });
  modo.addEventListener('click', function () { poeModo(!sair); });
  aceite.addEventListener('change', botao);
  dlg.addEventListener('click', function (e) { if (e.target && e.target.getAttribute && e.target.getAttribute('data-rs') === 'fechar') dlg.close(); });
  tirar.addEventListener('click', function () { if (!tirar.disabled) arquivo.click(); });
  arquivo.addEventListener('change', function () {
    var f = arquivo.files && arquivo.files[0];
    arquivo.value = '';
    if (!f) return;
    ocupado = true; botao(); msg('');
    tirar.textContent = 'Procurando…';
    reduz(f).then(function (b64) {
      var hp = document.getElementById('company_website');
      return fetch(sair ? '/api/rosto/sair' : '/api/rosto/buscar', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ slug: D.slug, imagem: b64, aceite: true, form_token: D.token, turnstileToken: token, company_website: hp ? hp.value : '' })
      });
    }).then(function (r) {
      return r.json().catch(function () { return {}; }).then(function (j) {
        if (!r.ok) throw new Error(j.error || 'A busca não respondeu. Tente de novo.');
        return j;
      });
    }).then(function (j) {
      dlg.close();
      mostra(j);
    }).catch(function (e) {
      msg(e && e.message ? e.message : 'A busca não respondeu. Tente de novo.');
    }).then(function () {
      ocupado = false; token = '';
      if (widget !== null && window.turnstile) window.turnstile.reset(widget);
      poeModo(sair); botao();
    });
  });
  function reduz(f) {
    return createImageBitmap(f).then(function (bmp) {
      var lado = 640, k = Math.min(1, lado / Math.max(bmp.width, bmp.height));
      var c = document.createElement('canvas');
      c.width = Math.max(1, Math.round(bmp.width * k)); c.height = Math.max(1, Math.round(bmp.height * k));
      c.getContext('2d').drawImage(bmp, 0, 0, c.width, c.height);
      if (bmp.close) bmp.close();
      var url = c.toDataURL('image/jpeg', 0.85);
      c.width = c.height = 0;
      return url.slice(url.indexOf(',') + 1);
    }, function () { throw new Error('Não consegui abrir essa foto. Tente tirar a selfie de novo.'); });
  }
  function mostra(j) {
    var sec = document.getElementById('rs-res');
    var t = document.getElementById('rs-res-t');
    var sub = document.getElementById('rs-res-sub');
    var grade = document.getElementById('rs-grade');
    grade.textContent = '';
    sec.hidden = false;
    if (j.removidas !== undefined) {
      t.textContent = 'Pronto: você saiu da busca';
      sub.textContent = j.removidas ? 'Tiramos o seu rosto de ' + j.removidas + (j.removidas === 1 ? ' foto' : ' fotos') + ' do índice. As fotos novas também ficam de fora.' : 'Não havia foto sua no índice. As que chegarem depois ficam de fora.';
    } else {
      var lista = j.resultados || [];
      t.textContent = lista.length ? (lista.length === 1 ? '1 foto em que pode ser você' : lista.length + ' fotos em que pode ser você') : 'Nenhuma foto encontrada';
      sub.textContent = j.semIndice ? 'O álbum ainda está sendo preparado para a busca. Tente de novo mais tarde.' : (lista.length ? 'Da mais parecida para a menos parecida. Toque para abrir.' : 'Tente outra selfie, de frente e com boa luz.');
      lista.forEach(function (r) {
        var li = document.createElement('li');
        var a = document.createElement('a');
        a.href = '/galeria/' + encodeURIComponent(D.slug) + (r.cap ? '/' + encodeURIComponent(r.cap) : '') + '#foto=' + encodeURIComponent(r.id);
        var img = document.createElement('img');
        img.src = 'https://lh3.googleusercontent.com/d/' + encodeURIComponent(r.id) + '=w320';
        img.alt = ''; img.loading = 'lazy'; img.decoding = 'async'; img.referrerPolicy = 'no-referrer';
        a.appendChild(img);
        if (r.cap && D.caps[r.cap]) { var s = document.createElement('span'); s.textContent = D.caps[r.cap]; a.appendChild(s); }
        li.appendChild(a); grade.appendChild(li);
      });
    }
    t.focus();
    sec.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }
})();`;
