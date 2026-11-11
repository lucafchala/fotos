// Índice da galeria por capítulos (v3.1): um cartão por subpasta de primeiro
// nível da pasta do projeto. Página de servidor; o único JS do navegador é o
// pequeno script das "N novas" (#250, SCRIPT_NOVAS, com nonce). O cartão leva a capa e a contagem do RESUMO guardado
// no cache (drive.js, registraResumo): capítulo que ninguém abriu ainda fica com
// um espaço reservado e o texto "Ver fotos" (ler a lista de cada capítulo só
// para desenhar o índice custaria a cota do Google e o teto de subrequisições).

import { HONEYPOT_CSS } from '../security.js';
import { SCRIPT_NOVAS, SCRIPT_ROSTO, ROSTO_CSS, rostoHTML, SCRIPT_BUSCA, BUSCA_CSS, buscaHTML, SCRIPT_AVISO, SCRIPT_VISOR, VISOR_CSS } from './indice-comum.js';
import { albumHTML, ordemDaLinha } from './album.js';
import { enderecoDoAlbum, baseDaGaleria, marcaDoAlbum, escape, jsonParaScript, origemDoAlbum, formatDatePT, fontFaceCSS, fontPreloadHTML, photoPreconnectHTML, navegacaoFluidaHTML, socialMetaHTML, previewDescription, ogImageFor, isRestrictedAccess } from '../utils.js';
import { urlLh3, descreveRenovacao, capVazio } from '../drive.js';
import { urlFoto } from '../foto-rota.js';
import { TURNSTILE_SITE_KEY, ROSTO_LIMIAR, ROSTO_TENTATIVAS_NO_PICO } from '../config.js';


/**
 * @param {{
 *   event: import('../utils.js').Evento,
 *   caps: import('../drive.js').CapitulosDrive,
 *   resumo: Record<string, import('../drive.js').ResumoCap>,
 *   ocultas: string[],
 *   dono: boolean,
 *   indexavel: boolean,
 *   nonce?: string,
 *   rosto?: { token: string, idx?: number } | null,
 *   busca?: boolean,
 *   host?: string,
 *   assina?: (id: string) => string,
 * }} p
 */
export function galeriaIndiceHTML({ event, caps, resumo, ocultas, dono, indexavel, nonce = '', rosto = null, busca = false, host = '', assina = () => '' }) {
  const titulo = String(event.title || event.slug || '');
  const slug = String(event.slug || '');
  // Links curtos no domínio do álbum (v3.8.3).
  const base = baseDaGaleria(slug, host);
  const dataEvento = event.date ? formatDatePT(String(event.date)) : '';
  const marca = marcaDoAlbum(slug);
  const tituloPagina = marca ? titulo : `Fotos de ${titulo}${dataEvento ? ` — ${dataEvento}` : ''}`;
  // Capítulo com resumo guardado dizendo 0 fotos não aparece para o visitante
  // (a pasta existe, mas ainda não chegou nada); o dono o vê marcado "vazio".
  // Sem resumo (ninguém abriu ainda) o capítulo aparece normalmente.
  /** @param {{ id: string }} c */
  const vazio = c => capVazio(resumo[c.id]);
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
      ? `<img src="${escape(urlFoto(capa, 480, assina))}" alt="" width="480" height="320" loading="lazy" decoding="async" referrerpolicy="no-referrer">`
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
  const botaoRosto = comRosto ? '<button type="button" class="ab-btn ab-btn-2" id="rs-abrir" hidden>Achar minhas fotos pelo rosto</button>' : '';
  // Busca nas fotos (v3.7): idem, buscaTextoAtiva no servidor.
  const comBusca = !!busca && !restrito && visiveis.length > 0;
  const quandoCaps = new Date(caps.em).toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
  const barraDono = dono ? `<div class="ix-dono"><b>Painel</b><span>Só você (logado) vê esta faixa.</span><a href="/dashboard">← Painel</a><a href="/${escape(slug)}">Página do projeto</a><a href="?atualizar=1" title="Relê as subpastas no Drive agora (${escape(descreveRenovacao(event))})">Atualizar agora</a><span>Atualizada em ${escape(quandoCaps)}</span></div>` : '';
  const scripts = `${cartoes.length ? `<script nonce="${nonce}">${SCRIPT_NOVAS(slug)}</script>` : ''}
  ${comRosto ? `<script type="application/json" id="rs-dados" nonce="${nonce}">${jsonParaScript({ slug, titulo: String(event.title || ''), token: /** @type {{ token: string }} */ (rosto).token, idx: /** @type {{ idx?: number }} */ (rosto).idx || 0, ts: TURNSTILE_SITE_KEY, certo: ROSTO_LIMIAR, tentativas: ROSTO_TENTATIVAS_NO_PICO, base, caps: Object.fromEntries(visiveis.map(c => [c.slug, c.nome])), ordem: ordemDaLinha(visiveis, resumo).map(c => c.slug) })}</script>
  <script nonce="${nonce}">${SCRIPT_ROSTO}</script>` : ''}
  ${comBusca ? `<script type="application/json" id="bf-dados" nonce="${nonce}">${jsonParaScript({ slug, base, caps: Object.fromEntries(visiveis.map(c => [c.slug, c.nome])), ordem: ordemDaLinha(visiveis, resumo).map(c => c.slug) })}</script>
  <script nonce="${nonce}">${SCRIPT_BUSCA}</script>` : ''}
  ${!isRestrictedAccess(event) && String(event.galeriaAbertura || '').trim() ? `<script nonce="${nonce}">${SCRIPT_AVISO}</script>` : ''}
  ${comRosto || comBusca ? `<style>${VISOR_CSS}</style><script nonce="${nonce}">${SCRIPT_VISOR}</script>` : ''}`;
  // Com texto de abertura, o índice vira a apresentação do álbum (v3.3).
  if (String(event.galeriaAbertura || '').trim()) {
    return albumHTML({
      event, titulo, caps: visiveis, resumo, ocultasSet, restrito, indexavel, origem: origemDoAlbum(slug),
      base, barraDono, avisoTrunc, botaoRosto: comRosto, rostoDialog: comRosto ? rostoHTML() : '', buscaFotos: comBusca ? buscaHTML() : '', scripts, nonce, assina,
    });
  }

  return `<!DOCTYPE html>
<html lang="pt-BR">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0, viewport-fit=cover">
  <meta name="robots" content="${indexavel ? 'index,follow,max-image-preview:large' : 'noindex,nofollow'}">
  <meta name="theme-color" content="#0a0a0a">
  <link rel="icon" type="image/svg+xml" href="${marca ? marca.icone : '/icon.svg'}">
  <link rel="apple-touch-icon" href="${marca ? marca.apple : '/apple-touch-icon.png'}">
  ${marca ? '' : '<link rel="manifest" href="/manifest.json">'}
  <title>${escape(tituloPagina)}</title>
  <link rel="canonical" href="${escape(enderecoDoAlbum(slug))}">
  ${socialMetaHTML({
    title: tituloPagina,
    description: descricao,
    url: enderecoDoAlbum(slug),
    image: ogImage.url,
    imageAlt: `Fotos de ${titulo}`,
    imageWidth: ogImage.width,
    imageHeight: ogImage.height,
    ...(marca ? { siteName: marca.siteName } : {}),
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
    .ab-acoes{display:flex;flex-wrap:wrap;gap:.6rem;margin-top:1.5rem}
    .ab-btn{display:inline-flex;align-items:center;min-height:44px;padding:0 1.1rem;border-radius:999px;font-size:.92rem;font-weight:600;text-decoration:none;border:1px solid var(--accent)}
    .ab-btn-1{background:var(--accent);color:var(--bg-page)}
    .ab-btn-2{color:var(--accent)}
    .ab-btn:hover{filter:brightness(1.08)}
    ${ROSTO_CSS}
    ${comBusca ? BUSCA_CSS : ''}
    ${HONEYPOT_CSS}
  </style>
  ${navegacaoFluidaHTML(nonce)}
</head>
<body>
  ${barraDono}
  <header class="ix-top">
    <a class="ix-voltar" href="/${escape(slug)}"><span aria-hidden="true">‹</span>&nbsp;Página do projeto</a>
    <h1>${escape(titulo)}</h1>
    <p class="ix-meta">${escape([dataEvento, visiveis.length ? `${visiveis.length} ${visiveis.length === 1 ? 'evento' : 'eventos'}` : ''].filter(Boolean).join(' · '))}</p>
    ${botaoRosto ? `<div class="ab-acoes">${botaoRosto}</div>` : ''}
    ${comBusca ? buscaHTML() : ''}
  </header>
  ${comRosto ? rostoHTML() : ''}
  ${avisoTrunc}
  <main id="g-main" aria-label="Eventos">
    ${cartoes.length ? `<ul class="ix-grade">${cartoes.join('\n    ')}</ul>` : `<p class="ix-vazio-msg">${dono && !caps.caps.length ? 'A pasta não tem subpastas: não há eventos para mostrar.' : 'As fotos estão chegando. Volte em breve.'}</p>`}
  </main>
  ${scripts}
</body>
</html>`;
}
