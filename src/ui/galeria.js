// Galeria própria (#234/#235). Nos álbuns PÚBLICOS abre a todos, sem login e
// sem o portão do Drive; nos de família e privados, só com o passe que o
// portão emite depois da declaração de acesso (cookie assinado "galeria",
// 12 h, preso a /galeria/<slug>). Álbuns "Em breve" seguem fechados (404).
// A faixa do dono e o ?atualizar só valem para o dono logado
// (ver handleGaleriaPagina).
//
// O que ela faz melhor que a pasta do Drive:
//  - grade justificada com a proporção REAL de cada foto (nada cortado, nada
//    de nome de arquivo poluindo), seções por subpasta;
//  - visualizador em tela cheia (PhotoSwipe, vendorizado em vendor/) que pede
//    ao Google a largura exata da tela em pixels FÍSICOS e, a cada zoom, a
//    próxima — até o original (srcset + o `sizes` que o PhotoSwipe atualiza);
//  - dois downloads por foto, os DOIS byte a byte e com o nome exato do Drive
//    (o site não altera arquivo): "tamanho máximo" (o original) e "para redes"
//    (o arquivo de mesmo nome da pasta do Instagram do projeto, já pronto —
//    só aparece nas fotos que têm par lá). Android e computador: download
//    comum. iPhone/iPad: "Salvar no Fotos" (a folha do sistema com o arquivo,
//    um toque até o app Fotos) e "Baixar arquivo" (vai para o app Arquivos);
//  - seleção de várias fotos, lembrada no aparelho, e link direto para cada
//    foto (#foto=ID).
//
// As fotos vêm do lh3 do Google (sem chave). Os downloads passam pelo proxy
// /galeria/<slug>/baixar/<id>, que só entrega arquivo que está na pasta do
// projeto (ou na do Instagram dele). A chave da Drive API nunca chega a esta
// página.

import { escape, jsonParaScript, safeUrl, formatDatePT, fontFaceCSS, fontPreloadHTML, photoPreconnectHTML, socialMetaHTML, ogImageFor, previewDescription, PERSON_LD } from '../utils.js';
import { VENDOR } from '../content/vendor.js';
import { GALERIA_LARGURAS, GALERIA_LARGURAS_GRADE } from '../config.js';
import { urlLh3 } from '../drive.js';

const SITE_URL = 'https://fotos.lucafchala.com';
// Quantas fotos o JSON-LD descreve como ImageObject. Poucas: o sitemap de
// imagens (/sitemap-galeria-<slug>.xml) é quem lista todas; aqui é só o
// bastante para o buscador ligar fotos, galeria e autor sem inchar o HTML.
const LD_FOTOS = 12;

/** @param {string} source */
const vendorPath = source => {
  const v = VENDOR.find(x => x.source === source);
  if (!v) throw new Error(`vendor ausente: ${source}`);
  return v.path;
};

// O conserto de cada erro, escrito para o dono — é ele quem vê esta página.
/** @type {Record<string, { titulo: string, passos: string[] }>} */
const CONSERTOS = {
  'chave-ausente': {
    titulo: 'Falta conectar o site ao Google Drive',
    passos: [
      'Abra <a href="https://console.cloud.google.com/apis/library/drive.googleapis.com" target="_blank" rel="noopener">a Google Drive API no Google Cloud</a> (crie um projeto se for o primeiro) e clique em <strong>Ativar</strong>.',
      'Em <a href="https://console.cloud.google.com/apis/credentials" target="_blank" rel="noopener">Credenciais</a>: <strong>Criar credenciais → Chave de API</strong>.',
      'Edite a chave: em <strong>Restrições de API</strong>, marque só a <strong>Google Drive API</strong>. Em restrição de aplicativo, deixe <strong>Nenhuma</strong> (o servidor da Cloudflare não tem IP fixo).',
      'Guarde a chave como segredo do site: <code>npx wrangler secret put GOOGLE_DRIVE_API_KEY</code> (ou no painel da Cloudflare: Workers → fotos → Configurações → Variáveis e segredos → Adicionar → tipo Segredo).',
      'Recarregue esta página.',
    ],
  },
  'chave-invalida': {
    titulo: 'O Google recusou a chave',
    passos: [
      'Confira em <a href="https://console.cloud.google.com/apis/credentials" target="_blank" rel="noopener">Credenciais</a> se a chave ainda existe.',
      'Grave de novo, sem espaço sobrando: <code>npx wrangler secret put GOOGLE_DRIVE_API_KEY</code>.',
    ],
  },
  'chave-restrita': {
    titulo: 'A chave está restrita de um jeito que bloqueia o site',
    passos: [
      'Na chave, em <strong>Restrições de aplicativo</strong>, escolha <strong>Nenhuma</strong> — restrição por site ou IP bloqueia o servidor.',
      'Em <strong>Restrições de API</strong>, a <strong>Google Drive API</strong> precisa estar marcada.',
    ],
  },
  'api-desligada': {
    titulo: 'A Google Drive API está desligada nesse projeto',
    passos: [
      'Ative em <a href="https://console.cloud.google.com/apis/library/drive.googleapis.com" target="_blank" rel="noopener">Google Drive API → Ativar</a>, no MESMO projeto da chave. Leva até alguns minutos para valer.',
    ],
  },
  'pasta-inacessivel': {
    titulo: 'O Drive não deixou ler esta pasta',
    passos: [
      'No Drive, na pasta do projeto: <strong>Compartilhar → Acesso geral → Qualquer pessoa com o link</strong> (Leitor) — é o mesmo que o visitante já usa hoje.',
      'Confira se o link no cadastro do projeto (painel → Editar) é o da pasta, e não o de uma foto.',
    ],
  },
  'sem-pasta': {
    titulo: 'Este projeto não tem uma pasta do Drive reconhecível',
    passos: [
      'No painel, edite o projeto e cole no link do Drive o endereço da <strong>pasta</strong> (drive.google.com/drive/folders/…).',
    ],
  },
  limite: {
    titulo: 'O Google limitou as consultas por um momento',
    passos: ['Espere alguns minutos e recarregue.'],
  },
  falha: {
    titulo: 'O Google Drive não respondeu',
    passos: ['Recarregue em instantes. Se continuar, veja /api/healthz e o status do Google Workspace.'],
  },
};

/**
 * @param {{
 *   event: import('../utils.js').Evento,
 *   listagem: import('../drive.js').ListagemDrive | null,
 *   erro: { codigo: string, mensagem: string } | null,
 *   nonce: string,
 *   dono?: boolean,
 *   ocultas?: string[],
 *   indexavel?: boolean,
 *   redes?: Map<string, import('../drive.js').FotoDrive>,
 *   avisoRedes?: { mensagem: string, parcial: boolean } | null,
 * }} p
 */
// `indexavel` (padrão false, o lado seguro): a página pode ir para o Google —
// quem decide é handleGaleriaPagina (álbum público e listado, visitante, fora
// da prévia, com fotos). Com false, sai o noindex de antes.
// `redes` (id da foto da galeria → arquivo da pasta do Instagram, ver casaRedes
// em drive.js): as fotos que têm "para redes". Só tamanho e nome vão para a
// página — o id do arquivo do Instagram nunca sai do servidor.
export function galeriaHTML({ event, listagem, erro, nonce, dono = true, ocultas = [], indexavel = false, redes = new Map(), avisoRedes = null }) {
  const titulo = String(event.title || event.slug || '');
  const slug = String(event.slug || '');
  const drive = safeUrl(event.driveUrl);
  const total = listagem ? listagem.total : 0;
  const quando = listagem
    ? new Date(listagem.em).toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })
    : '';

  const dataEvento = event.date ? formatDatePT(String(event.date)) : '';
  const contagem = total === 1 ? '1 foto' : `${total} fotos`;
  const meta = listagem && total ? [dataEvento, contagem].filter(Boolean).join(' · ') : dataEvento;

  // SEO (decisão do dono, 29/10/2026): título e descrição próprios de cada
  // galeria, canonical, cartão de link com a capa e JSON-LD ligado ao mesmo
  // Person (@id) do resto do site.
  const tituloPagina = `Fotos de ${titulo}${dataEvento ? ` — ${dataEvento}` : ''}`;
  const urlPagina = `${SITE_URL}/galeria/${slug}`;
  const descricao = previewDescription(
    [dataEvento, listagem && total ? contagem : ''],
    `Galeria de fotos de ${titulo}, por Luca F. Chala. Veja em tela cheia e baixe para as redes ou no tamanho original.`,
  );
  const todasFotos = listagem ? listagem.secoes.flatMap(s => s.fotos) : [];
  // O alt de cada foto, igual ao do script da página: "<evento> — foto i de n".
  const altFoto = (/** @type {number} */ i) => `${titulo} — foto ${i + 1} de ${total}`;
  // Capa: a do projeto; sem ela, a primeira foto da pasta. Do lh3, sem passar
  // pelo Worker — o robô do cartão não gasta cota nossa.
  const ogImage = ogImageFor(event.thumbnailUrl || (todasFotos[0] ? urlLh3(todasFotos[0][0], 1600) : ''));
  const jsonLd = todasFotos.length ? {
    '@context': 'https://schema.org',
    '@type': 'ImageGallery',
    '@id': `${urlPagina}#galeria`,
    name: tituloPagina,
    url: urlPagina,
    inLanguage: 'pt-BR',
    description: descricao,
    author: PERSON_LD,
    isPartOf: { '@type': 'PhotoGallery', name: titulo, url: `${SITE_URL}/${slug}` },
    ...(ogImage.url ? { image: ogImage.url } : {}),
    ...(event.date ? { datePublished: event.date } : {}),
    numberOfItems: total,
    associatedMedia: todasFotos.slice(0, LD_FOTOS).map((f, i) => ({
      '@type': 'ImageObject',
      contentUrl: urlLh3(f[0], Math.min(f[1] || 1600, 1600)),
      name: altFoto(i),
      creator: PERSON_LD,
      creditText: 'Luca F. Chala',
    })),
  } : null;

  // Pré-carga da miniatura do LCP no celular (até 430 px): lá a primeira foto,
  // se for deitada, ocupa a linha inteira — largura conhecida antes do script
  // (a da tela menos o --pad), então o navegador escolhe no srcset o MESMO
  // degrau que a <img> vai pedir. Só WebP (type): quem não decodifica ignora a
  // dica e segue o caminho de sempre. Foto em pé divide a linha: sem dica.
  const lcp = todasFotos[0];
  const preloadLcp = lcp && lcp[1] > 0 && lcp[2] > 0 && lcp[1] / lcp[2] >= 1.36
    ? `<link rel="preload" as="image" type="image/webp" fetchpriority="high" media="(max-width: 430px)" imagesrcset="${escape(GALERIA_LARGURAS_GRADE.map(x => `${urlLh3(lcp[0], x)}-rw ${x}w`).join(', '))}" imagesizes="calc(100vw - 2 * max(12px, 3vw))">`
    : '';

  const conserto = erro ? (CONSERTOS[erro.codigo] || CONSERTOS.falha) : null;
  const avisos = [];
  if (listagem && listagem.truncada) {
    avisos.push('Lista parcial: pastas muito grandes ou subpastas além de dois níveis ficam de fora — o Drive continua com tudo.');
  }

  // Só o dono vê o motivo de "para redes" estar desligado ou parcial.
  if (dono && avisoRedes) avisos.push(avisoRedes.mensagem);
  // Cada foto: [id, largura, altura, nome, bytes] e, se tem versão na pasta do
  // Instagram, mais [bytes] ou [bytes, nome] (o nome só quando difere do original).
  let comRedes = 0;
  const fotoDaPagina = (/** @type {import('../drive.js').FotoDrive} */ f) => {
    const r = redes.get(f[0]);
    if (!r) return f;
    comRedes++;
    return r[3] === f[3] ? [...f, r[4]] : [...f, r[4], r[3]];
  };

  const dados = listagem ? {
    slug,
    titulo,
    secoes: listagem.secoes.map(s => ({ nome: s.nome, fotos: s.fotos.map(fotoDaPagina) })),
    larguras: GALERIA_LARGURAS,
    grade: GALERIA_LARGURAS_GRADE,
    drive: drive || '',
    // Só o dono recebe a lista do que está oculto (o visitante já recebe a
    // listagem sem essas fotos) e o botão de ocultar no visualizador.
    dono: !!dono,
    ocultas: dono ? ocultas : [],
    lightbox: vendorPath('vendor/photoswipe/photoswipe-lightbox.esm.min.js'),
    // O CSS do visualizador entra junto com ele (preparaLightbox), não no
    // <head>: lá ele bloqueava a primeira pintura da grade.
    css: vendorPath('vendor/photoswipe/photoswipe.css'),
    core: vendorPath('vendor/photoswipe/photoswipe.esm.min.js'),
  } : null;

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
  <link rel="canonical" href="${escape(urlPagina)}">
  ${socialMetaHTML({
    title: tituloPagina,
    description: descricao,
    url: urlPagina,
    image: ogImage.url,
    imageAlt: `Fotos de ${titulo}`,
    imageWidth: ogImage.width,
    imageHeight: ogImage.height,
  })}
  ${jsonLd ? `<script type="application/ld+json" nonce="${nonce}">${jsonParaScript(jsonLd)}</script>` : ''}
  ${fontPreloadHTML()}
  ${photoPreconnectHTML()}
  ${preloadLcp}
  <style>
    ${fontFaceCSS()}
    *,*::before,*::after{box-sizing:border-box;margin:0;padding:0}
    :root{
      --bg-page:#0a0a0a; --text:#f0ebe5; --text-2:#bbb; --text-muted:#999; --text-dim:#666;
      --bg-card:#141414; --bg-card-2:#1c1c1c; --esqueleto:#1d1d1d; --border:#262626; --accent:#c0a060; --accent-text:#0a0a0a;
      --warn-bg:#1d1606; --warn-border:#4a3a12; --warn-text:#d8b25a;
      --err-bg:#1a0a0a; --err-border:#2e1a1a; --err-text:#e0a0a0;
      --pad:clamp(12px,3vw,32px); --gap:5px; --topo:120px;
    --sai:cubic-bezier(.23,1,.32,1);
    }
    @media (prefers-color-scheme: light){
      :root{
        --bg-page:#f0ece8; --text:#1a1715; --text-2:#4a4744; --text-muted:#665f5b; --text-dim:#8a8480;
        --bg-card:#e5e1db; --bg-card-2:#fff; --esqueleto:#dcd7d0; --border:#ddd9d4; --accent:#7d5a22; --accent-text:#faf7f3;
        --warn-bg:#fdf3dc; --warn-border:#e8d1a0; --warn-text:#7a5a17;
        --err-bg:#fdecec; --err-border:#f2c6c6; --err-text:#8c1d18;
      }
    }
    @media (max-width:520px){ :root{ --gap:3px } }
    body{font-family:'Inter',sans-serif;background:var(--bg-page);color:var(--text);min-height:100vh;-webkit-text-size-adjust:100%}
    :focus-visible{outline:2px solid var(--accent);outline-offset:2px}
    a{color:inherit}
    .g-dono{display:flex;flex-wrap:wrap;align-items:center;gap:.4rem 1rem;padding:.5rem var(--pad);font-size:.78rem;color:var(--text-muted);background:var(--bg-card);border-bottom:1px solid var(--border)}
    .g-dono a{color:var(--text-2);text-decoration:underline;text-underline-offset:2px;padding:.55rem 0}
    .g-dono a:hover{color:var(--text)}
    .g-dono b{font-weight:600;color:var(--accent);letter-spacing:.06em;text-transform:uppercase;font-size:.7rem;border:1px solid var(--accent);border-radius:4px;padding:.1rem .4rem}
    .g-dono .g-lista{margin-left:auto}
    .g-top{position:sticky;top:0;z-index:5;background:color-mix(in srgb,var(--bg-page) 90%,transparent);backdrop-filter:blur(10px);-webkit-backdrop-filter:blur(10px);border-bottom:1px solid var(--border)}
    .g-top-l{display:flex;flex-wrap:wrap;align-items:center;gap:.6rem 1.25rem;padding:.8rem var(--pad)}
    .g-tit{flex:1 1 14rem;min-width:0}
    .g-tit h1{font-size:clamp(1.05rem,2.4vw,1.5rem);font-weight:600;letter-spacing:-.01em;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
    .g-meta{font-size:.8rem;color:var(--text-muted);margin-top:.15rem}
    .g-acoes{display:flex;flex-wrap:wrap;gap:.5rem}
    .g-btn{display:inline-flex;align-items:center;justify-content:center;gap:.4rem;font:inherit;font-size:.85rem;font-weight:500;min-height:44px;padding:.5rem 1rem;border-radius:999px;border:1px solid var(--border);background:var(--bg-card-2);color:var(--text);text-decoration:none;cursor:pointer;white-space:nowrap;transition:transform .12s cubic-bezier(.23,1,.32,1),border-color .12s}
    .g-btn:active{transform:scale(.97)}
    .g-btn[aria-pressed="true"]{background:var(--accent);border-color:var(--accent);color:var(--accent-text)}
    .g-chips{display:flex;gap:.5rem;overflow-x:auto;scrollbar-width:none;-webkit-overflow-scrolling:touch;padding:0 var(--pad) .7rem}
    .g-chips::-webkit-scrollbar{display:none}
    .g-chips[hidden]{display:none}
    .g-chip{flex:none;display:inline-flex;align-items:center;gap:.45rem;font:inherit;font-size:.85rem;font-weight:500;min-height:44px;padding:.4rem .95rem;border-radius:999px;border:1px solid var(--border);background:var(--bg-card-2);color:var(--text-2);cursor:pointer;white-space:nowrap;transition:transform .12s cubic-bezier(.23,1,.32,1),background-color .15s,color .15s}
    .g-chip:active{transform:scale(.97)}
    .g-chip small{font-size:.75rem;color:var(--text-muted);font-variant-numeric:tabular-nums}
    .g-chip[aria-current="true"],.g-chip[aria-pressed="true"]{background:var(--text);border-color:var(--text);color:var(--bg-page)}
    .g-chip[aria-current="true"] small,.g-chip[aria-pressed="true"] small{color:inherit;opacity:.75}
    @media (hover:hover){ .g-btn:hover,.g-chip:hover{border-color:var(--text-dim)} }
    .g-previa{margin:.9rem var(--pad) 0;font-size:.78rem;color:var(--text-muted);display:flex;gap:.5rem;align-items:center}
    .g-previa b{font-weight:600;color:var(--accent);letter-spacing:.06em;text-transform:uppercase;font-size:.7rem;border:1px solid var(--accent);border-radius:4px;padding:.1rem .4rem}
    .g-aviso{margin:.75rem var(--pad) 0;padding:.7rem .9rem;border-radius:8px;font-size:.82rem;line-height:1.5;background:var(--warn-bg);border:1px solid var(--warn-border);color:var(--warn-text)}
    .g-erro{max-width:40rem;margin:3rem auto;padding:1.5rem 1.6rem;border-radius:12px;background:var(--err-bg);border:1px solid var(--err-border);color:var(--err-text);line-height:1.6}
    .g-erro h2{font-size:1.1rem;margin-bottom:.4rem;color:var(--text)}
    .g-erro p{font-size:.88rem;margin-bottom:.8rem}
    .g-erro ol{padding-left:1.2rem;font-size:.88rem;color:var(--text-2)}
    .g-erro li{margin-bottom:.45rem}
    .g-erro code{font-size:.8rem;background:var(--bg-card);padding:.1rem .35rem;border-radius:4px;color:var(--text)}
    .g-erro a{color:var(--text)}
    main{padding:1.25rem 0 6rem}
    .g-sec{margin-bottom:2rem;content-visibility:auto;contain-intrinsic-size:auto 900px}
    .g-sec{scroll-margin-top:calc(var(--topo) + 8px)}
    .g-sec[hidden]{display:none}
    .g-sec-cab{display:flex;align-items:center;justify-content:space-between;gap:1rem;padding:0 var(--pad);margin-bottom:.7rem}
    .g-sec-cab.sem-titulo{display:none}
    .g-modo-sel .g-sec-cab.sem-titulo{display:flex;justify-content:flex-end}
    .g-sec h2{font-size:.72rem;letter-spacing:.16em;text-transform:uppercase;color:var(--text-muted);font-weight:600}
    .g-sec-todas{display:none;font:inherit;font-size:.8rem;font-weight:500;min-height:44px;padding:.4rem .9rem;border-radius:999px;border:1px solid var(--border);background:var(--bg-card-2);color:var(--text);cursor:pointer}
    .g-modo-sel .g-sec-todas{display:inline-flex;align-items:center}
    .g-grade{padding:0 var(--pad)}
    .g-linha{display:flex;gap:var(--gap);margin-bottom:var(--gap)}
    .g-t{position:relative;flex:none;height:100%;display:block;background:var(--esqueleto);overflow:hidden;border-radius:2px;-webkit-tap-highlight-color:transparent;-webkit-user-select:none;user-select:none}
    .g-t img{width:100%;height:100%;display:block;object-fit:cover;opacity:0;transition:opacity .2s ease-out}
    .g-t img.ok{opacity:1}
    /* A primeira linha (a do LCP) aparece sem esperar o fade do "load": com
       opacidade 0 o navegador nem conta a foto como pintada. */
    .g-t img[fetchpriority="high"]{opacity:1;transition:none}
    @media (hover:hover){ .g-t:hover img.ok{filter:brightness(1.06)} }
    .g-t .g-ck{position:absolute;top:6px;right:6px;width:24px;height:24px;border-radius:50%;border:2px solid #fff;background:rgba(0,0,0,.25);display:none;box-shadow:0 1px 4px rgba(0,0,0,.4)}
    .g-modo-sel .g-t .g-ck{display:block}
    .g-fav{position:absolute;left:0;bottom:0;width:44px;height:44px;display:grid;place-items:center;color:#fff;opacity:0;pointer-events:none;transition:opacity .15s ease-out,transform .12s cubic-bezier(.23,1,.32,1)}
    /* O coração é um fundo em CSS, não um <svg> por miniatura: com centenas de
       fotos, eram dois elementos e um innerHTML a mais por foto na carga. */
    .g-fav::before{content:"";width:22px;height:22px;background:url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24'%3E%3Cpath d='M12 20.5 10.9 19.5C6.2 15.3 3.5 12.8 3.5 9.7 3.5 7.3 5.4 5.5 7.7 5.5c1.6 0 3.2.8 4.3 2.1 1.1-1.3 2.7-2.1 4.3-2.1 2.3 0 4.2 1.8 4.2 4.2 0 3.1-2.7 5.6-7.4 9.8z' fill='none' stroke='%23fff' stroke-width='2'/%3E%3C/svg%3E") center/contain no-repeat;filter:drop-shadow(0 1px 3px rgba(0,0,0,.65))}
    .g-t.fav .g-fav{opacity:1}
    .g-t.fav .g-fav::before{background-image:url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24'%3E%3Cpath d='M12 20.5 10.9 19.5C6.2 15.3 3.5 12.8 3.5 9.7 3.5 7.3 5.4 5.5 7.7 5.5c1.6 0 3.2.8 4.3 2.1 1.1-1.3 2.7-2.1 4.3-2.1 2.3 0 4.2 1.8 4.2 4.2 0 3.1-2.7 5.6-7.4 9.8z' fill='%23ff6b86' stroke='%23ff6b86' stroke-width='2'/%3E%3C/svg%3E")}
    .g-modo-sel .g-fav{display:none}
    @media (hover:hover){
      .g-t:hover .g-fav,.g-t:focus-visible .g-fav{opacity:1;pointer-events:auto}
      .g-fav:active{transform:scale(.9)}
    }
    .g-t.sel .g-ck{display:block;background:var(--accent);border-color:var(--accent)}
    .g-t.sel .g-ck::after{content:"";position:absolute;left:7px;top:3px;width:6px;height:11px;border:solid var(--accent-text);border-width:0 2px 2px 0;transform:rotate(45deg)}
    .g-t.sel img{opacity:.78}
    .g-t.oculta img.ok{opacity:.3}
    .g-t .g-oc{position:absolute;left:6px;top:6px;padding:.15rem .45rem;border-radius:4px;background:rgba(0,0,0,.7);color:#fff;font-size:.68rem;font-weight:600;letter-spacing:.04em;text-transform:uppercase;display:none}
    .g-t.oculta .g-oc{display:block}
    .g-barra{position:fixed;left:50%;bottom:calc(16px + env(safe-area-inset-bottom));transform:translateX(-50%);z-index:6;display:flex;align-items:center;gap:.5rem;padding:.5rem .55rem .5rem 1rem;border-radius:999px;background:var(--bg-card-2);border:1px solid var(--border);box-shadow:0 8px 30px rgba(0,0,0,.35);font-size:.85rem;max-width:calc(100vw - 24px)}
    .g-barra[hidden]{display:none}
    .g-topo{position:fixed;right:max(16px,env(safe-area-inset-right));bottom:calc(16px + env(safe-area-inset-bottom));z-index:6;width:44px;height:44px;display:grid;place-items:center;border-radius:50%;border:1px solid var(--border);background:var(--bg-card-2);color:var(--text);cursor:pointer;box-shadow:0 6px 20px rgba(0,0,0,.3);opacity:0;visibility:hidden;transform:translateY(8px);pointer-events:none;transition:opacity .15s ease-out,transform .15s var(--sai),visibility 0s .15s}
    .g-topo.on{opacity:1;visibility:visible;transform:none;pointer-events:auto;transition-delay:0s}
    .g-topo:active{transform:scale(.95)}
    .g-com-barra .g-topo{bottom:calc(84px + env(safe-area-inset-bottom))}
    .g-vendo .g-topo{display:none}
    .g-barra .g-btn{padding:.45rem .8rem}
    .g-bug{padding:.5rem;min-width:44px}
    /* Celular: o Compartilhar vira só ícone (o aria-label diz o que é), para os
       quatro botões caberem numa linha só e as fotos subirem na tela. */
    @media (max-width:519px){
      .g-btn[data-acao="compartilhar"]{padding:.5rem;min-width:44px}
      .g-btn[data-acao="compartilhar"] span{position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0 0 0 0);white-space:nowrap}
    }
    .g-voltar{display:inline-flex;align-items:center;gap:.25rem;min-height:32px;font-size:.85rem;color:var(--text-muted);text-decoration:none;margin-bottom:.15rem}
    @media (hover:hover){ .g-voltar:hover{color:var(--text)} }
    .g-barra .g-prim{background:var(--accent);border-color:var(--accent);color:var(--accent-text)}
    #g-barra-n{white-space:nowrap;margin-right:.25rem}
    /* Folha de download: por cima do visualizador (o PhotoSwipe usa z-index 100000). */
    .g-folha{position:fixed;inset:0;z-index:100010;display:flex;align-items:flex-end;justify-content:center;background:rgba(0,0,0,.55);opacity:1;transition:opacity .2s var(--sai),display .2s allow-discrete,overlay .2s allow-discrete}
    .g-folha[hidden]{display:none;opacity:0;transition-duration:.14s}
    @starting-style{ .g-folha{opacity:0} }
    .g-folha-c{transition:transform .2s var(--sai),opacity .2s var(--sai);width:min(30rem,100%);background:var(--bg-card-2);color:var(--text);border-radius:16px 16px 0 0;padding:1.1rem 1.1rem calc(1.1rem + env(safe-area-inset-bottom));box-shadow:0 -10px 40px rgba(0,0,0,.4)}
    .g-folha[hidden] .g-folha-c{transform:translateY(16px);opacity:0;transition-duration:.14s}
    @starting-style{ .g-folha-c{transform:translateY(16px);opacity:0} }
    @media (min-width:700px){ .g-folha{align-items:center} .g-folha-c{border-radius:16px} .g-folha[hidden] .g-folha-c{transform:scale(.96)} @starting-style{ .g-folha-c{transform:scale(.96);opacity:0} } }
    .g-folha-t{font-weight:600;font-size:.95rem;margin-bottom:.8rem;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
    .g-op{display:flex;flex-direction:column;align-items:flex-start;gap:.15rem;width:100%;text-align:left;font:inherit;padding:.8rem .9rem;margin-bottom:.5rem;border-radius:10px;border:1px solid var(--border);background:var(--bg-page);color:var(--text);cursor:pointer}
    .g-op{text-decoration:none;min-height:44px;transition:transform .12s cubic-bezier(.23,1,.32,1),border-color .12s}
    .g-op:active{transform:scale(.985)}
    @media (hover:hover){ .g-op:hover{border-color:var(--text-dim)} }
    .g-op strong{font-size:.9rem;font-weight:600}
    .g-op span{font-size:.76rem;color:var(--text-muted)}
    .g-op.g-pronto{background:var(--accent);border-color:var(--accent);color:var(--accent-text)}
    .g-op.g-pronto span{color:var(--accent-text);opacity:.8}
    .g-op[disabled]{opacity:.6;cursor:progress}
    /* iPhone/iPad: cada versão tem dois botões (Salvar no Fotos / Baixar arquivo). */
    .g-ver{margin-bottom:.6rem;padding:.8rem .9rem;border-radius:10px;border:1px solid var(--border);background:var(--bg-page)}
    .g-ver-t{display:flex;flex-direction:column;gap:.15rem;margin-bottom:.65rem}
    .g-ver-t strong{font-size:.9rem;font-weight:600}
    .g-ver-t span{font-size:.76rem;color:var(--text-muted);overflow-wrap:anywhere}
    .g-ver-a{display:flex;flex-wrap:wrap;gap:.5rem}
    .g-ver-a .g-btn{flex:1 1 9rem}
    .g-ver-a .g-prim{background:var(--accent);border-color:var(--accent);color:var(--accent-text)}
    .g-ver-a .g-btn[disabled]{opacity:.6;cursor:progress}
    .g-folha-msg{font-size:.8rem;color:var(--text-muted);min-height:1.2em;margin:.2rem 0 .6rem}
    .g-folha-rod{display:flex;justify-content:space-between;align-items:center;gap:.5rem}
    .g-folha-rod a{font-size:.78rem;color:var(--text-muted)}
    .g-aviso-flut{position:fixed;left:50%;top:calc(var(--topo) + 12px + env(safe-area-inset-top));transform:translateX(-50%);z-index:100020;background:#111;color:#f0ebe5;font-size:.82rem;padding:.55rem .9rem;border-radius:999px;box-shadow:0 6px 24px rgba(0,0,0,.35);pointer-events:none;opacity:0;transform:translateX(-50%) translateY(-6px);transition:opacity .2s var(--sai),transform .2s var(--sai)}
    .g-aviso-flut.on{opacity:1;transform:translateX(-50%)}
    /* Visualizador: legenda e o botão de seleção ligado. */
    .pswp{--pswp-bg:#000}
    .pswp__g-legenda{position:absolute;left:0;right:0;bottom:0;padding:1.6rem 1rem calc(.9rem + env(safe-area-inset-bottom));text-align:center;font:500 13px/1.4 'Inter',sans-serif;color:#e8e3dd;background:linear-gradient(transparent,rgba(0,0,0,.55));pointer-events:none;transition:opacity .25s}
    .pswp:not(.pswp--ui-visible) .pswp__g-legenda{opacity:0}
    .pswp__button--g-sel.on .pswp__icn{fill:#c0a060}
    .pswp__button--g-fav.on .pswp__icn{fill:#ff6b86}
    .pswp__button--g-ocultar.on .pswp__icn{fill:#ff8a65}
    .pswp__counter{white-space:nowrap}
    @media (prefers-reduced-motion: reduce){
      .g-t img,.g-fav,.g-btn,.g-chip,.g-op{transition:none}
      .g-topo,.g-folha-c,.g-aviso-flut{transition:opacity .1s linear;transform:none}
      .g-topo.on{transform:none}
      .g-aviso-flut{transform:translateX(-50%)}
      .g-folha,.g-folha[hidden]{transition:opacity .1s linear,display .1s allow-discrete,overlay .1s allow-discrete}
      .g-folha[hidden] .g-folha-c{transform:none}
      @starting-style{ .g-folha-c{transform:none} }
    }
  </style>
</head>
<body>
  ${dono ? `<div class="g-dono">
    <b>Painel</b>
    <span>Só você (logado) vê esta faixa.</span>
    <a href="/dashboard">← Painel</a>
    <a href="/${escape(slug)}">Página do projeto</a>
    ${drive ? `<a href="${escape(drive)}" target="_blank" rel="nofollow noopener">Abrir no Drive</a>` : ''}
    ${listagem ? '<a href="?atualizar=1" title="Relê a pasta no Drive agora (a lista fica guardada por 10 minutos)">Atualizar lista</a>' : ''}
    ${listagem ? `<span class="g-lista">Lista do Drive de ${escape(quando)}</span>` : ''}
    ${listagem && event.driveUrlInstagram ? `<span id="g-n-redes">${comRedes} de ${total} com "para redes" (pasta do Instagram)</span>` : ''}
    ${listagem ? `<span id="g-n-ocultas">${ocultas.length ? `${ocultas.length} oculta${ocultas.length === 1 ? '' : 's'} para os visitantes` : 'Para ocultar uma foto dos visitantes: abra a foto e toque no olho'}</span>` : ''}
  </div>` : ''}
  <header class="g-top" id="g-topo-cab">
    <div class="g-top-l">
      <div class="g-tit">
        <a class="g-voltar" href="/${escape(slug)}"><span aria-hidden="true">‹</span> Página do projeto</a>
        <h1 id="g-h1" tabindex="-1">${escape(titulo)}</h1>
        ${meta ? `<p class="g-meta">${escape(meta)}</p>` : ''}
      </div>
      <div class="g-acoes">
        ${listagem && total ? '<button type="button" class="g-btn" id="g-sel" aria-pressed="false">Selecionar</button>' : ''}
        ${listagem && total ? '<button type="button" class="g-btn" data-acao="baixar-tudo">Baixar tudo</button>' : ''}
        ${listagem && total ? '<button type="button" class="g-btn" data-acao="compartilhar" aria-label="Compartilhar a página do projeto"><svg xmlns="http://www.w3.org/2000/svg" width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 12v8a2 2 0 002 2h12a2 2 0 002-2v-8"/><polyline points="16 6 12 2 8 6"/><line x1="12" y1="2" x2="12" y2="15"/></svg><span>Compartilhar</span></button>' : ''}
        <a class="g-btn g-bug" href="/suporte" title="Algo deu errado? Fale com a gente" aria-label="Reportar um problema na galeria"><svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M8 2l1.9 1.9M16 2l-1.9 1.9M9 7.1V6a3 3 0 016 0v1.1"/><path d="M12 20c-3.3 0-6-2.7-6-6v-3a4 4 0 014-4h4a4 4 0 014 4v3c0 3.3-2.7 6-6 6zM12 20v-9M6.5 13H2M22 13h-4.5M6 7.6C4.1 7.4 3 5.9 3 4M18 7.6c1.9-.2 3-1.7 3-3.6M6 17.4C4.1 17.6 3 19.1 3 21M18 17.4c1.9.2 3 1.7 3 3.6"/></svg></a>
      </div>
    </div>
    ${dados ? '<nav class="g-chips" id="g-chips" aria-label="Seções e favoritas" hidden></nav>' : ''}
  </header>
  ${avisos.map(a => `<p class="g-aviso">${escape(a)}</p>`).join('\n  ')}
  ${conserto && erro ? `<section class="g-erro" role="alert">
    <h2>${escape(conserto.titulo)}</h2>
    <p>${escape(erro.mensagem)}</p>
    <ol>${conserto.passos.map(p => `<li>${p}</li>`).join('')}</ol>
  </section>` : ''}
  ${listagem && !total ? '<section class="g-erro"><h2>A pasta não tem fotos</h2><p>O Drive respondeu, mas não há imagens nesta pasta (nem nas subpastas lidas).</p></section>' : ''}
  <main id="g-main" aria-label="Fotos"></main>
  <noscript><p class="g-aviso">A galeria precisa de JavaScript. ${drive ? `<a href="${escape(drive)}" rel="nofollow">Abrir a pasta no Drive</a>.` : ''}</p></noscript>
  <button type="button" class="g-topo" id="g-topo" data-acao="topo" aria-label="Voltar ao topo"><svg aria-hidden="true" viewBox="0 0 24 24" width="22" height="22"><path d="M12 5.5 5.5 12l1.4 1.4 4.1-4.1V19h2V9.3l4.1 4.1 1.4-1.4z" fill="currentColor"/></svg></button>
  <div class="g-barra" id="g-barra" hidden>
    <span id="g-barra-n" aria-live="polite">0 selecionadas</span>
    <button type="button" class="g-btn g-prim" data-acao="baixar-sel">Baixar</button>
    <button type="button" class="g-btn" data-acao="limpar-sel">Limpar</button>
    <button type="button" class="g-btn" data-acao="fim-sel">Concluir</button>
  </div>
  <div class="g-folha" id="g-folha" hidden role="dialog" aria-modal="true" aria-labelledby="g-folha-t">
    <div class="g-folha-c">
      <p class="g-folha-t" id="g-folha-t">Baixar</p>
      <div id="g-folha-ops"></div>
      <p class="g-folha-msg" id="g-folha-msg" aria-live="polite"></p>
      <div class="g-folha-rod"><a id="g-folha-drive" href="#" target="_blank" rel="nofollow noopener" hidden>Abrir no Drive</a><button type="button" class="g-btn" data-acao="fechar-folha">Fechar</button></div>
    </div>
  </div>
  <div class="g-aviso-flut" id="g-aviso-flut" role="status" aria-live="polite"></div>
  ${dados ? `<script type="application/json" id="g-dados" nonce="${nonce}">${jsonParaScript(dados)}</script>
  <script nonce="${nonce}">${SCRIPT}</script>` : ''}
</body>
</html>`;
}

// O script da página. Sem template literal dentro (o arquivo inteiro já é um),
// sem barra invertida (seria dobrada pelo template) e sem innerHTML com dado do
// Drive: nome de arquivo entra por textContent.
const SCRIPT = `
(function () {
  'use strict';
  const dadosEl = document.getElementById('g-dados');
  const main = document.getElementById('g-main');
  if (!dadosEl || !main) return;
  /** @type {{ slug: string, titulo: string, secoes: { nome: string, fotos: ([string, number, number, string, number] | [string, number, number, string, number, number] | [string, number, number, string, number, number, string])[] }[], larguras: number[], grade: number[], drive: string, dono: boolean, ocultas: string[], lightbox: string, core: string, css: string }} */
  const D = JSON.parse(dadosEl.textContent || '{}');
  // Texto alternativo de cada foto: "<evento> — foto i de n" (o mesmo do
  // JSON-LD da página). Nome de arquivo não descreve a foto para ninguém.
  const TOTAL = D.secoes.reduce(function (n, s) { return n + s.fotos.length; }, 0);
  const altDe = function (i) { return (D.titulo ? D.titulo + ' — ' : '') + 'foto ' + (i + 1) + ' de ' + TOTAL; };
  // Fotos que o dono ocultou do público. Só chega preenchido para o dono.
  const ocultas = new Set(D.ocultas || []);

  // ---- Dados ----
  /** @typedef {{ id: string, w: number, h: number, nome: string, bytes: number, redes: { nome: string, bytes: number } | null, s: number, el: HTMLAnchorElement, img: HTMLImageElement, estimada: boolean, alt: string }} Foto */
  /** @type {Foto[]} */
  const fotos = [];
  let rw = '';
  const lh3 = function (id, w) { return 'https://lh3.googleusercontent.com/d/' + id + '=w' + Math.round(w) + rw; };
  const semExt = function (n) { return String(n || '').replace(/[.][^.]+$/, ''); };
  const LONGO_ESTIMADO = 4096;
  const reduz = function () {
    try { return matchMedia('(prefers-reduced-motion: reduce)').matches; } catch (e) { return false; }
  };

  // Unidades decimais (1 MB = 1.000.000 bytes): é o que o iPhone, o Mac e o
  // Android mostram para o arquivo baixado — o número aqui tem de bater com o
  // da galeria do celular depois.
  function fmtBytes(n) {
    if (!n) return '';
    const mb = n / 1e6;
    if (mb < 1) return Math.max(1, Math.round(n / 1e3)) + ' KB';
    return mb.toLocaleString('pt-BR', { maximumFractionDigits: mb < 10 ? 1 : 0 }) + ' MB';
  }

  // ---- WebP: decide pelo que o navegador faz, não por user-agent ----
  // Primeiro o caminho síncrono: quem CODIFICA WebP num canvas também o
  // decodifica, e a grade sai no mesmo passo do script (a miniatura do LCP é
  // pedida antes). Quem não codifica (Safari antigo) cai na decodificação de
  // verdade, assíncrona, como antes.
  function webpPorCanvas() {
    try {
      const c = document.createElement('canvas');
      c.width = 1;
      c.height = 1;
      return c.toDataURL('image/webp').indexOf('data:image/webp') === 0;
    } catch (e) { return false; }
  }
  function detectaWebp(pronto) {
    if (webpPorCanvas()) { rw = '-rw'; pronto(); return; }
    const t = new Image();
    let feito = false;
    const fim = function (ok) { if (feito) return; feito = true; rw = ok ? '-rw' : ''; pronto(); };
    t.onload = function () { fim(t.width === 1); };
    t.onerror = function () { fim(false); };
    setTimeout(function () { fim(false); }, 1500);
    t.src = 'data:image/webp;base64,UklGRiIAAABXRUJQVlA4IBYAAAAwAQCdASoBAAEADsD+JaQAA3AAAAAA';
  }

  // ---- Grade justificada ----
  /** @type {{ sec: HTMLElement, grade: HTMLElement, lista: Foto[], todas: HTMLButtonElement }[]} */
  const grades = [];
  function monta() {
    const varias = D.secoes.length > 1;
    D.secoes.forEach(function (sec, s) {
      const secEl = document.createElement('section');
      secEl.className = 'g-sec';
      const cab = document.createElement('div');
      cab.className = 'g-sec-cab' + (varias ? '' : ' sem-titulo');
      if (varias) {
        const h2 = document.createElement('h2');
        h2.textContent = sec.nome || 'Fotos';
        cab.appendChild(h2);
      }
      const todas = document.createElement('button');
      todas.type = 'button';
      todas.className = 'g-sec-todas';
      todas.dataset.acao = 'sel-secao';
      todas.dataset.sec = String(s);
      todas.textContent = 'Selecionar todas';
      cab.appendChild(todas);
      secEl.appendChild(cab);
      const grade = document.createElement('div');
      grade.className = 'g-grade';
      secEl.appendChild(grade);
      main.appendChild(secEl);
      /** @type {Foto[]} */
      const lista = [];
      sec.fotos.forEach(function (f) {
        const i = fotos.length;
        const a = document.createElement('a');
        a.className = 'g-t';
        a.href = '#foto=' + f[0];
        a.dataset.i = String(i);
        a.setAttribute('aria-label', 'Foto ' + semExt(f[3]));
        const img = document.createElement('img');
        img.alt = altDe(i);
        img.decoding = 'async';
        // Preguiçosa por padrão; a primeira diagramação torna "eager" só o que
        // cai na primeira tela (ver dimensiona).
        img.loading = 'lazy';
        const ck = document.createElement('span');
        ck.className = 'g-ck';
        ck.setAttribute('aria-hidden', 'true');
        const fv = document.createElement('span');
        fv.className = 'g-fav';
        fv.setAttribute('aria-hidden', 'true');
        fv.title = 'Favoritar (tecla F)';
        a.appendChild(img);
        a.appendChild(ck);
        a.appendChild(fv);
        if (D.dono) {
          const oc = document.createElement('span');
          oc.className = 'g-oc';
          oc.textContent = 'Oculta';
          a.appendChild(oc);
          if (ocultas.has(f[0])) a.classList.add('oculta');
        }
        /** @type {Foto} */
        const foto = { id: f[0], w: f[1], h: f[2], nome: f[3], bytes: f[4], redes: f.length > 5 ? { bytes: f[5], nome: f[6] || f[3] } : null, s: s, el: a, img: img, estimada: !(f[1] > 0 && f[2] > 0), alt: img.alt };
        img.addEventListener('load', function () { carregou(foto); });
        img.addEventListener('error', function () { img.classList.add('ok'); });
        fotos.push(foto);
        lista.push(foto);
      });
      grades.push({ sec: secEl, grade: grade, lista: lista, todas: todas });
    });
  }

  function proporcao(f) {
    return f.w > 0 && f.h > 0 ? Math.min(Math.max(f.w / f.h, 0.25), 5) : 1.5;
  }

  let larguraDiagramada = 0;
  function diagramaTudo() {
    const estilo = getComputedStyle(grades.length ? grades[0].grade : main);
    const W = Math.floor(main.clientWidth - parseFloat(estilo.paddingLeft) - parseFloat(estilo.paddingRight));
    if (!W || W < 50) return;
    larguraDiagramada = main.clientWidth;
    const alvo = window.innerWidth >= 1200 ? 280 : W < 520 ? 300 : W < 900 ? 260 : 240;
    const gap = W < 520 ? 3 : 5;
    // Onde cada linha cai na página, aproximado (o título da seção conta como
    // 48 px): decide o que é "primeira tela" na primeira diagramação.
    const pos = { y: main.getBoundingClientRect().top + window.scrollY, primeira: true };
    grades.forEach(function (g) { diagrama(g, W, alvo, gap, pos); });
  }

  function diagrama(g, W, alvo, gap, pos) {
    if (pos && D.secoes.length > 1) pos.y += 48;
    const mostradas = visiveisDe(g);
    g.sec.hidden = !mostradas.length;
    if (!mostradas.length) { g.grade.replaceChildren(); return; }
    const frag = document.createDocumentFragment();
    let linha = [];
    let soma = 0;
    let altura = 0;
    const fecha = function (ultima) {
      const livre = W - gap * (linha.length - 1);
      let h = livre / soma;
      const naoEstica = ultima && h > alvo * 1.15;
      if (naoEstica) h = alvo;
      h = Math.max(40, Math.floor(h));
      const row = document.createElement('div');
      row.className = 'g-linha';
      row.style.height = h + 'px';
      let usado = 0;
      const topo = pos ? pos.y : Infinity;
      const primeira = !!pos && pos.primeira;
      linha.forEach(function (f, k) {
        let w = Math.floor(proporcao(f) * h);
        if (k === linha.length - 1 && !naoEstica) w = Math.max(20, livre - usado);
        usado += w;
        f.el.style.width = w + 'px';
        dimensiona(f, w, topo, primeira);
        row.appendChild(f.el);
      });
      frag.appendChild(row);
      altura += h + gap;
      if (pos) { pos.y += h + gap; pos.primeira = false; }
      linha = [];
      soma = 0;
    };
    mostradas.forEach(function (f) {
      linha.push(f);
      soma += proporcao(f);
      if (soma * alvo + gap * (linha.length - 1) >= W) fecha(false);
    });
    if (linha.length) fecha(true);
    g.grade.replaceChildren(frag);
    g.sec.style.containIntrinsicSize = 'auto ' + Math.ceil(altura + 60) + 'px';
  }

  // A miniatura pede ao Google a menor largura que cobre o quadradinho em
  // pixels físicos: o navegador escolhe pelo srcset + sizes.
  function dimensiona(f, w, topo, primeiraLinha) {
    if (!f.img.srcset) {
      // Só na primeira vez (antes do src): o que cai na primeira tela baixa já,
      // e a primeira linha — onde está a maior foto da tela, o LCP — vai na
      // frente das outras. O resto espera chegar perto (loading=lazy), sem
      // disputar a banda com o que se vê.
      if (topo < window.innerHeight * 1.25) f.img.loading = 'eager';
      if (primeiraLinha) f.img.setAttribute('fetchpriority', 'high');
      f.img.srcset = D.grade.map(function (x) { return lh3(f.id, x) + ' ' + x + 'w'; }).join(', ');
      f.img.src = lh3(f.id, 400);
    }
    f.img.sizes = w + 'px';
  }

  let reflow = 0;
  function agendaDiagrama() {
    if (reflow) return;
    reflow = requestAnimationFrame(function () { reflow = 0; diagramaTudo(); });
  }

  function carregou(f) {
    f.img.classList.add('ok');
    // Sem dimensões no Drive (alguns HEIC/RAW): a miniatura dá a proporção, e a
    // grade se refaz uma vez. O tamanho real fica estimado até o visualizador.
    if (f.estimada && f.img.naturalWidth && !f.w) {
      const k = LONGO_ESTIMADO / Math.max(f.img.naturalWidth, f.img.naturalHeight);
      f.w = Math.round(f.img.naturalWidth * k);
      f.h = Math.round(f.img.naturalHeight * k);
      agendaDiagrama();
    }
  }

  // ---- Seleção e favoritas ----
  // As duas listas ficam só neste aparelho (localStorage), e a página tem de
  // funcionar com o armazenamento bloqueado.
  const CHAVE_SEL = 'galeria:sel:' + D.slug;
  const CHAVE_FAV = 'galeria:fav:' + D.slug;
  function leLista(chave) {
    try {
      const salvo = JSON.parse(localStorage.getItem(chave) || '[]');
      if (Array.isArray(salvo)) return new Set(salvo.map(String));
    } catch (e) { /* armazenamento indisponível: vale só nesta visita */ }
    return new Set();
  }
  function gravaLista(chave, conjunto) {
    try { localStorage.setItem(chave, JSON.stringify(Array.from(conjunto))); } catch (e) { /* idem */ }
  }
  /** @type {Set<string>} */
  let sel = leLista(CHAVE_SEL);
  /** @type {Set<string>} */
  const fav = leLista(CHAVE_FAV);
  let modoSel = false;
  let filtroFav = false;
  // Seleção que chegou por link (#sel=id.id.id, #213): a galeria abre só com
  // essas fotos. Vive no fragmento — não vai ao servidor nem é gravada.
  /** @type {Set<string> | null} */
  let filtroLink = null;
  const MAX_LINK = 300;
  let vendo = false;
  const chips = document.getElementById('g-chips');
  const cab = document.getElementById('g-topo-cab');
  /** @type {HTMLButtonElement[]} */
  let chipsSec = [];
  /** @type {HTMLButtonElement | null} */
  let chipFav = null;

  /** @type {Foto | null} */
  let ultimoSel = null;
  /** As fotos na ordem em que aparecem agora (todas, ou só as favoritas). */
  let vistas = fotos;
  const barra = document.getElementById('g-barra');
  const barraN = document.getElementById('g-barra-n');
  const botaoSel = document.getElementById('g-sel');

  function filtroAtivo() {
    if (filtroLink) { const l = filtroLink; return function (f) { return l.has(f.id); }; }
    if (filtroFav) return function (f) { return fav.has(f.id); };
    return null;
  }
  function visiveisDe(g) {
    const fn = filtroAtivo();
    return fn ? g.lista.filter(fn) : g.lista;
  }
  function recalculaVistas() {
    const fn = filtroAtivo();
    vistas = fn ? fotos.filter(fn) : fotos;
  }
  function salvaSel() { gravaLista(CHAVE_SEL, sel); }
  function salvaFav() { gravaLista(CHAVE_FAV, fav); }
  function pintaSel(f) {
    const on = sel.has(f.id);
    const gosto = fav.has(f.id);
    f.el.classList.toggle('sel', on);
    f.el.classList.toggle('fav', gosto);
    // O check e o coração são só visuais (aria-hidden): o leitor de tela ouve
    // o estado no nome.
    f.el.setAttribute('aria-label', 'Foto ' + semExt(f.nome) + (on ? ', selecionada' : '') + (gosto ? ', favorita' : ''));
  }
  function atualizaBarra() {
    if (!barra || !barraN) return;
    const n = sel.size;
    barra.hidden = !(modoSel || n > 0);
    document.body.classList.toggle('g-com-barra', !barra.hidden);
    barraN.textContent = n === 1 ? '1 selecionada' : n + ' selecionadas';
    grades.forEach(function (g) {
      const l = visiveisDe(g);
      g.todas.textContent = l.length && l.every(function (f) { return sel.has(f.id); }) ? 'Desmarcar todas' : 'Selecionar todas';
    });
  }
  function alternaSel(f) {
    if (sel.has(f.id)) sel.delete(f.id); else sel.add(f.id);
    ultimoSel = f;
    pintaSel(f);
    salvaSel();
    atualizaBarra();
  }
  // Shift+clique: do último marcado até este (na ordem que se vê).
  function selecionaIntervalo(f) {
    const a = ultimoSel ? vistas.indexOf(ultimoSel) : -1;
    const b = vistas.indexOf(f);
    if (a < 0 || b < 0) { alternaSel(f); return; }
    for (let k = Math.min(a, b); k <= Math.max(a, b); k++) {
      sel.add(vistas[k].id);
      pintaSel(vistas[k]);
    }
    ultimoSel = f;
    salvaSel();
    atualizaBarra();
  }
  function selecionaSecao(k) {
    const g = grades[k];
    if (!g) return;
    const lista = visiveisDe(g);
    const todas = lista.every(function (f) { return sel.has(f.id); });
    lista.forEach(function (f) {
      if (todas) sel.delete(f.id); else sel.add(f.id);
      pintaSel(f);
    });
    salvaSel();
    atualizaBarra();
    avisa(todas ? 'Seleção desta seção removida' : lista.length + (lista.length === 1 ? ' foto selecionada' : ' fotos selecionadas'));
  }
  function ligaModoSel(liga) {
    modoSel = liga;
    document.body.classList.toggle('g-modo-sel', liga);
    if (botaoSel) {
      botaoSel.setAttribute('aria-pressed', String(liga));
      botaoSel.textContent = liga ? 'Selecionando' : 'Selecionar';
    }
    atualizaBarra();
  }

  /** @returns {boolean} se a foto ficou favorita */
  function alternaFav(f) {
    const era = fav.has(f.id);
    if (era) fav.delete(f.id); else fav.add(f.id);
    salvaFav();
    pintaSel(f);
    atualizaChips();
    avisa(era ? 'Removida das favoritas' : 'Favorita guardada, só neste aparelho');
    // Com o visualizador aberto a lista não muda debaixo dele: refaz ao fechar.
    if (filtroFav && !vendo) {
      if (!fav.size) ligaFiltroFav(false);
      else { recalculaVistas(); agendaDiagrama(); }
    }
    return !era;
  }
  // ---- Seleção por link (#213) ----
  // As favoritas viram um link com os ids no fragmento: quem abre vê só elas.
  // Num álbum de família ou privado o link não fura nada — o servidor segue
  // pedindo o passe do portão para abrir a galeria.
  function linkDasFavoritas() {
    const ids = fotos.filter(function (f) { return fav.has(f.id); }).map(function (f) { return f.id; });
    return { url: location.origin + location.pathname + '#sel=' + ids.slice(0, MAX_LINK).join('.'), n: Math.min(ids.length, MAX_LINK), cortou: ids.length > MAX_LINK };
  }
  function compartilhaFavoritas() {
    const l = linkDasFavoritas();
    if (!l.n) { avisa('Marque fotos com o coração primeiro'); return; }
    const aviso = l.cortou ? 'Link com as primeiras ' + MAX_LINK + ' favoritas copiado' : 'Link com ' + l.n + (l.n === 1 ? ' foto copiado' : ' fotos copiado');
    const h1 = document.getElementById('g-h1');
    const titulo = (h1 ? (h1.textContent || '') : document.title) + ' — minha seleção';
    if (navigator.share && matchMedia('(pointer: coarse)').matches) {
      navigator.share({ title: titulo, url: l.url }).catch(function () {});
      return;
    }
    if (navigator.clipboard) {
      navigator.clipboard.writeText(l.url).then(function () { avisa(aviso); }, function () { avisa(l.url); });
    } else {
      avisa(l.url);
    }
  }
  /** Lê #sel= do endereço. Devolve quantas fotos do link existem aqui. */
  function leSelecaoDoLink() {
    const m = location.hash.match(/^#sel=([A-Za-z0-9_.-]+)$/);
    if (!m) return -1;
    const pedidas = m[1].split('.').filter(function (id) { return /^[A-Za-z0-9_-]{10,200}$/.test(id); }).slice(0, MAX_LINK);
    const aqui = new Set(pedidas.filter(function (id) { return fotos.some(function (f) { return f.id === id; }); }));
    if (!aqui.size) return 0;
    filtroLink = aqui;
    document.body.classList.add('g-so-link');
    recalculaVistas();
    return aqui.size;
  }
  function saiDoLink() {
    filtroLink = null;
    document.body.classList.remove('g-so-link');
    history.replaceState(history.state, '', location.pathname + location.search);
    recalculaVistas();
    montaChips();
    diagramaTudo();
    atualizaBarra();
    window.scrollTo(0, 0);
  }
  /** Guarda as fotos do link nas favoritas deste aparelho. */
  function guardaDoLink() {
    if (!filtroLink) return;
    let novas = 0;
    filtroLink.forEach(function (id) { if (!fav.has(id)) { fav.add(id); novas++; } });
    salvaFav();
    fotos.forEach(pintaSel);
    montaChips();
    avisa(novas ? novas + (novas === 1 ? ' foto guardada nas favoritas' : ' fotos guardadas nas favoritas') : 'Já estavam nas suas favoritas');
  }

  function ligaFiltroFav(liga) {
    const tinhaFoco = !!document.activeElement && /** @type {HTMLElement} */ (document.activeElement).dataset.acao === 'filtro-fav';
    filtroFav = liga;
    recalculaVistas();
    document.body.classList.toggle('g-so-fav', liga);
    montaChips();
    diagramaTudo();
    atualizaBarra();
    window.scrollTo(0, 0);
    if (tinhaFoco && chipFav) chipFav.focus({ preventScroll: true });
  }

  // ---- Faixa de chips: seções (com a contagem) e favoritas ----
  function medeTopo() {
    if (cab) document.documentElement.style.setProperty('--topo', cab.offsetHeight + 'px');
  }
  function botaoChip(nome, n) {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'g-chip';
    b.appendChild(document.createTextNode(nome));
    const c = document.createElement('small');
    c.textContent = String(n);
    b.appendChild(c);
    return b;
  }
  function montaChips() {
    if (!chips) return;
    chips.replaceChildren();
    chipsSec = [];
    if (filtroLink) {
      const b = botaoChip('Seleção recebida', filtroLink.size);
      b.dataset.acao = 'sai-link';
      b.setAttribute('aria-pressed', 'true');
      b.title = 'Toque para ver todas as fotos';
      chips.appendChild(b);
      const g = document.createElement('button');
      g.type = 'button';
      g.className = 'g-chip';
      g.dataset.acao = 'guarda-link';
      g.textContent = 'Guardar nas minhas favoritas';
      chips.appendChild(g);
      chipFav = null;
      chips.hidden = false;
      medeTopo();
      return;
    }
    if (D.secoes.length > 1 && !filtroFav) {
      D.secoes.forEach(function (sec, k) {
        const b = botaoChip(sec.nome || 'Fotos', sec.fotos.length);
        b.dataset.acao = 'ir-sec';
        b.dataset.sec = String(k);
        chips.appendChild(b);
        chipsSec.push(b);
      });
      chipsSec[0].setAttribute('aria-current', 'true');
    }
    chipFav = null;
    if (fav.size || filtroFav) {
      const b = botaoChip('Favoritas', fav.size);
      b.dataset.acao = 'filtro-fav';
      b.setAttribute('aria-pressed', String(filtroFav));
      b.title = 'Fica só neste aparelho';
      chips.appendChild(b);
      chipFav = b;
      if (filtroFav && fav.size) {
        const c = document.createElement('button');
        c.type = 'button';
        c.className = 'g-chip';
        c.dataset.acao = 'compartilhar-fav';
        c.title = 'Um link que abre a galeria só com estas fotos';
        c.textContent = 'Compartilhar as favoritas';
        chips.appendChild(c);
      }
    }
    chips.hidden = !chips.childElementCount;
    medeTopo();
    marcaAtiva();
  }
  function atualizaChips() {
    if (!chips) return;
    if (filtroLink) return;
    if (!!chipFav !== !!(fav.size || filtroFav)) { montaChips(); return; }
    const n = chipFav ? chipFav.querySelector('small') : null;
    if (n) n.textContent = String(fav.size);
  }
  const secVisiveis = new Set();
  function marcaAtiva() {
    if (!chipsSec.length) return;
    let ativa = -1;
    grades.forEach(function (g, k) { if (ativa < 0 && secVisiveis.has(g.sec)) ativa = k; });
    if (ativa < 0) return;
    chipsSec.forEach(function (b, k) {
      if (k === ativa) { b.setAttribute('aria-current', 'true'); centraChip(b); } else b.removeAttribute('aria-current');
    });
  }
  function centraChip(b) {
    if (!chips || chips.scrollWidth <= chips.clientWidth) return;
    const esq = b.getBoundingClientRect().left - chips.getBoundingClientRect().left + chips.scrollLeft;
    chips.scrollTo({ left: esq - (chips.clientWidth - b.offsetWidth) / 2, behavior: reduz() ? 'auto' : 'smooth' });
  }
  function observaSecoes() {
    if (typeof IntersectionObserver !== 'function') return;
    // Uma faixa estreita a 35% da altura da tela: a seção que a cruza é a atual.
    const io = new IntersectionObserver(function (es) {
      es.forEach(function (e) { if (e.isIntersecting) secVisiveis.add(e.target); else secVisiveis.delete(e.target); });
      marcaAtiva();
    }, { rootMargin: '-35% 0px -60% 0px' });
    grades.forEach(function (g) { io.observe(g.sec); });
  }
  function irParaSecao(k) {
    const g = grades[k];
    if (!g) return;
    g.sec.scrollIntoView({ behavior: reduz() ? 'auto' : 'smooth', block: 'start' });
    chipsSec.forEach(function (b, n) { if (n === k) b.setAttribute('aria-current', 'true'); else b.removeAttribute('aria-current'); });
  }

  // ---- Voltar ao topo ----
  const botaoTopo = document.getElementById('g-topo');
  let rolagem = 0;
  function atualizaTopo() {
    rolagem = 0;
    if (botaoTopo) botaoTopo.classList.toggle('on', window.scrollY > window.innerHeight * 2);
  }
  window.addEventListener('scroll', function () {
    if (!rolagem) rolagem = requestAnimationFrame(atualizaTopo);
  }, { passive: true });

  // ---- Visualizador (PhotoSwipe) ----
  /** @type {any} */
  let lightbox = null;
  /** @type {Promise<any> | null} */
  let carregandoLb = null;

  function dadosSlide(f) {
    const maior = f.w || LONGO_ESTIMADO;
    const larguras = D.larguras.filter(function (x) { return x < maior; });
    larguras.push(maior);
    return {
      src: lh3(f.id, Math.min(maior, 1600)),
      srcset: larguras.map(function (x) { return lh3(f.id, x) + ' ' + x + 'w'; }).join(', '),
      width: f.w || LONGO_ESTIMADO,
      height: f.h || Math.round(LONGO_ESTIMADO / 1.5),
      msrc: f.img.currentSrc || undefined,
      alt: f.alt,
      element: f.el,
    };
  }

  const ICONE_BAIXAR = '<svg aria-hidden="true" class="pswp__icn" viewBox="0 0 32 32" width="32" height="32"><path d="M15 6h2v12.2l4.3-4.3 1.4 1.4-6.7 6.7-6.7-6.7 1.4-1.4 4.3 4.3zM8 24h16v2H8z"/></svg>';
  const ICONE_CORACAO_PSWP = '<svg aria-hidden="true" class="pswp__icn" viewBox="0 0 32 32" width="32" height="32"><path d="M16 27.500 14.300 26C8.600 20.900 5 17.700 5 13.600 5 10.400 7.500 8 10.600 8c1.800 0 3.500.8 4.600 2.100l.8.9.8-.9C18 8.800 19.700 8 21.500 8 24.500 8 27 10.400 27 13.600c0 4.100-3.600 7.300-9.300 12.400z"/></svg>';
  const ICONE_COMPARTILHAR = '<svg aria-hidden="true" class="pswp__icn" viewBox="0 0 32 32" width="32" height="32"><path d="M16 5l6 6-1.400 1.400L17 8.800V20h-2V8.800l-3.600 3.600L10 11zM8 15h4v2h-2v9h12v-9h-2v-2h4v13H8z"/></svg>';
  const ICONE_OCULTAR = '<svg aria-hidden="true" class="pswp__icn" viewBox="0 0 32 32" width="32" height="32"><path d="M16 9c-5.500 0-9.300 4.400-10.500 7 1.200 2.600 5 7 10.500 7s9.300-4.400 10.500-7C25.300 13.400 21.500 9 16 9zm0 11.500a4.500 4.500 0 1 1 0-9 4.500 4.500 0 0 1 0 9zM6.400 5 5 6.400 25.600 27 27 25.600z"/></svg>';
  const ICONE_SEL = '<svg aria-hidden="true" class="pswp__icn" viewBox="0 0 32 32" width="32" height="32"><path d="M16 6a10 10 0 1 0 0 20 10 10 0 0 0 0-20zm-1.5 14.6-4.6-4.6 1.4-1.4 3.2 3.2 6.6-6.6 1.4 1.4z"/></svg>';

  // ---- Voltar fecha a camada de cima, como num app ----
  // O visualizador e a folha de download empilham UMA entrada cada no
  // histórico. O "voltar" — botão do Android, gesto do iPhone, tecla do
  // navegador — fecha só a camada de cima, em vez de sair da galeria. Com
  // replaceState puro, o voltar com uma foto aberta levava de volta ao painel.
  // O ouvinte do popstate mora no fim, depois da folha existir.
  function noTopo(marca) {
    return !!(history.state && history.state.g === marca);
  }

  // O CSS do visualizador, antes do <style> da página: a mesma ordem de
  // cascata de quando ele vinha no <head> (as regras .pswp da página vencem).
  function carregaCssLb() {
    return new Promise(function (pronto) {
      const l = document.createElement('link');
      l.rel = 'stylesheet';
      l.href = D.css;
      l.addEventListener('load', function () { pronto(true); });
      l.addEventListener('error', function () { pronto(false); });
      document.head.insertBefore(l, document.head.querySelector('style'));
    });
  }

  function preparaLightbox() {
    if (carregandoLb) return carregandoLb;
    const urlLb = D.lightbox;
    const urlCore = D.core;
    carregandoLb = Promise.all([import(urlLb), carregaCssLb()]).then(function (r) {
      const PhotoSwipeLightbox = r[0].default;
      lightbox = new PhotoSwipeLightbox({
        dataSource: [],
        pswpModule: function () { return import(urlCore); },
        bgOpacity: 1,
        wheelToZoom: true,
        preload: [1, 2],
        showHideAnimationType: 'zoom',
        closeTitle: 'Fechar (Esc)',
        zoomTitle: 'Ampliar (Z)',
        arrowPrevTitle: 'Anterior',
        arrowNextTitle: 'Próxima',
        errorMsg: 'A foto não carregou.',
        indexIndicatorSep: ' de ',
        // O dono tem um botão a mais (ocultar). Em celular estreito, a lupa
        // sai para a barra caber sem espremer o contador: ali o zoom é pinça
        // e toque duplo.
        zoom: !(D.dono && toqueEstreito()),
      });
      lightbox.addFilter('numItems', function () { return vistas.length; });
      lightbox.addFilter('itemData', function (_d, index) { return dadosSlide(vistas[index]); });
      lightbox.on('uiRegister', registraUi);
      // Link direto para a foto aberta (#foto=ID): copiar a barra de endereço
      // e mandar para alguém (ou abrir noutra aba) cai na mesma foto. Abrir
      // EMPILHA uma entrada (o "voltar" fecha a foto — ver o popstate acima);
      // trocar de foto só reescreve a entrada, senão o voltar andaria foto
      // por foto.
      lightbox.on('afterInit', function () {
        vendo = true;
        document.body.classList.add('g-vendo');
        const f = vistas[lightbox.pswp.currIndex];
        if (f) history.pushState({ g: 'foto' }, '', '#foto=' + f.id);
      });
      lightbox.on('destroy', function () {
        vendo = false;
        document.body.classList.remove('g-vendo');
        // Favorita tirada com a foto aberta: a grade filtrada se refaz agora.
        if (filtroFav) {
          if (!fav.size) ligaFiltroFav(false);
          else { recalculaVistas(); agendaDiagrama(); }
        }
      });
      lightbox.on('change', function () {
        const f = vistas[lightbox.pswp.currIndex];
        if (f && noTopo('foto')) history.replaceState(history.state, '', '#foto=' + f.id);
      });
      lightbox.on('close', function () {
        // Fechou pela interface (×, Esc, arrastar): tira a entrada que a
        // abertura pôs. Fechou pelo voltar: ela já saiu.
        if (noTopo('foto')) history.back();
        const f = lightbox.pswp ? vistas[lightbox.pswp.currIndex] : null;
        if (f) f.el.focus({ preventScroll: true });
      });
      lightbox.init();
      return lightbox;
    });
    return carregandoLb;
  }

  /** @type {() => void} */
  let sincronizaFavUi = function () {};
  /** @type {() => void} */
  let sincronizaOcultaUi = function () {};

  // ---- Ocultar dos visitantes (só o dono) ----
  // Uma foto por vez, gravada no servidor na hora: o visitante deixa de
  // receber a foto na lista e o download dela vira 404. A foto segue no Drive.
  let ocultando = false;
  function alternaOculta(f) {
    if (ocultando) return;
    ocultando = true;
    const querOculta = !ocultas.has(f.id);
    fetch('/api/galeria/ocultar', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ slug: D.slug, foto: f.id, oculta: querOculta }),
    }).then(function (r) {
      return r.json().catch(function () { return {}; }).then(function (j) {
        if (!r.ok) throw new Error(j.error || ('Erro ' + r.status));
        return j;
      });
    }).then(function (j) {
      ocultas.clear();
      (j.ocultas || []).forEach(function (id) { ocultas.add(id); });
      fotos.forEach(function (x) { x.el.classList.toggle('oculta', ocultas.has(x.id)); });
      const n = document.getElementById('g-n-ocultas');
      if (n) n.textContent = ocultas.size ? ocultas.size + (ocultas.size === 1 ? ' oculta' : ' ocultas') + ' para os visitantes' : 'Nenhuma foto oculta';
      sincronizaOcultaUi();
      avisa(querOculta ? 'Oculta para os visitantes (some para todos em até 2 min)' : 'Visível de novo para os visitantes');
    }).catch(function (e) {
      avisa(e && e.message ? e.message : 'Não deu para gravar. Tente de novo.');
    }).then(function () { ocultando = false; });
  }
  function registraUi() {
    const pswp = lightbox.pswp;
    pswp.ui.registerElement({
      name: 'g-fav', order: 7, isButton: true, title: 'Favoritar (F)', html: ICONE_CORACAO_PSWP,
      onInit: function (el, p) {
        sincronizaFavUi = function () {
          const f = vistas[p.currIndex];
          const on = !!f && fav.has(f.id);
          el.classList.toggle('on', on);
          el.setAttribute('aria-pressed', String(on));
        };
        p.on('change', sincronizaFavUi);
        sincronizaFavUi();
      },
      onClick: function (_e, _el, p) {
        const f = vistas[p.currIndex];
        if (!f) return;
        alternaFav(f);
        sincronizaFavUi();
      },
    });
    pswp.ui.registerElement({
      name: 'g-sel', order: 8, isButton: true, title: 'Selecionar esta foto', html: ICONE_SEL,
      onInit: function (el, p) {
        const sync = function () {
          const f = vistas[p.currIndex];
          const on = !!f && sel.has(f.id);
          el.classList.toggle('on', on);
          el.setAttribute('aria-pressed', String(on));
        };
        p.on('change', sync);
        sync();
      },
      onClick: function (_e, el, p) {
        const f = vistas[p.currIndex];
        if (!f) return;
        alternaSel(f);
        el.classList.toggle('on', sel.has(f.id));
        el.setAttribute('aria-pressed', String(sel.has(f.id)));
        avisa(sel.has(f.id) ? 'Adicionada à seleção' : 'Removida da seleção');
      },
    });
    pswp.ui.registerElement({
      name: 'g-baixar', order: 9, isButton: true, title: 'Baixar', html: ICONE_BAIXAR,
      onClick: function (_e, _el, p) {
        const f = vistas[p.currIndex];
        if (f) abreFolha([f]);
      },
    });
    pswp.ui.registerElement({
      name: 'g-compartilhar', order: 10, isButton: true, title: 'Compartilhar', html: ICONE_COMPARTILHAR,
      onClick: function (_e, _el, p) {
        const f = vistas[p.currIndex];
        if (f) compartilhaFoto(f);
      },
    });
    if (D.dono) {
      pswp.ui.registerElement({
        name: 'g-ocultar', order: 11, isButton: true, title: 'Ocultar dos visitantes', html: ICONE_OCULTAR,
        onInit: function (el, p) {
          const sync = function () {
            const f = vistas[p.currIndex];
            const on = !!f && ocultas.has(f.id);
            el.classList.toggle('on', on);
            el.setAttribute('aria-pressed', String(on));
            el.title = on ? 'Oculta: toque para mostrar aos visitantes' : 'Ocultar dos visitantes';
            el.setAttribute('aria-label', el.title);
          };
          sincronizaOcultaUi = sync;
          p.on('change', sync);
          sync();
        },
        onClick: function (_e, _el, p) {
          const f = vistas[p.currIndex];
          if (f) alternaOculta(f);
        },
      });
    }
    pswp.ui.registerElement({
      name: 'g-legenda', order: 9, isButton: false, appendTo: 'root', html: '',
      onInit: function (el, p) {
        const sync = function () {
          const f = vistas[p.currIndex];
          if (!f) return;
          const secao = D.secoes.length > 1 ? D.secoes[f.s].nome : '';
          el.textContent = semExt(f.nome) + (secao ? ' · ' + secao : '');
        };
        p.on('change', sync);
        sync();
      },
    });
  }

  function toqueEstreito() {
    try { return matchMedia('(pointer: coarse) and (max-width: 419px)').matches; } catch (e) { return false; }
  }

  function abre(i) {
    preparaLightbox().then(function (lb) { lb.loadAndOpen(Math.max(0, i)); }).catch(function () {
      avisa('O visualizador não carregou. Recarregue a página.');
    });
  }

  // ---- Downloads ----
  // O arquivo baixado é SEMPRE o do Drive: os mesmos bytes e o mesmo nome. O
  // site não redimensiona, não renomeia, não recodifica. "Tamanho máximo" é o
  // original da pasta do projeto; "para redes" é o arquivo de mesmo nome da
  // pasta do Instagram (f.redes), só nas fotos que têm par lá.
  //
  // Como o arquivo chega ao aparelho:
  //  - Android e computador: download comum (<a download>) — o navegador salva
  //    o arquivo e pronto. Nada de folha de compartilhamento.
  //  - iPhone e iPad: o download comum cai no app Arquivos, longe do Fotos. O
  //    melhor caminho do iOS é a folha do sistema com o ARQUIVO ("Salvar
  //    imagem" põe direto no Fotos, "Salvar N imagens" idem): botão "Salvar no
  //    Fotos". "Baixar arquivo" segue disponível (Arquivos).
  const LOTE_MAX_FOTOS = 20;
  const LOTE_MAX_BYTES = 80e6;

  // A ÚNICA checagem de plataforma da página (de resto vale detectar recurso,
  // nunca modelo de aparelho). Aqui não dá: canShare({ files }) existe no
  // Android, no iOS e no desktop, e só o iOS tem o "Salvar imagem" que põe a
  // foto no Fotos. Safari e Chrome do iOS são ambos WebKit, e o iPadOS finge
  // ser um Mac (plataforma MacIntel) mas é o único "Mac" com tela de toque. O
  // userAgentData não ajuda: o WebKit não o tem. A regra de "não decidir por
  // aparelho" vale para a RESOLUÇÃO das imagens, que segue por pixels físicos.
  function ehIOS() {
    try {
      if (/iP(hone|ad|od)/.test(navigator.userAgent || '')) return true;
      return navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1;
    } catch (e) { return false; }
  }
  const IOS = ehIOS();
  function podeCompartilharArquivos(arquivos) {
    try { return typeof navigator.canShare === 'function' && navigator.canShare({ files: arquivos }); } catch (e) { return false; }
  }
  function aceitaArquivoDeTeste() {
    try { return podeCompartilharArquivos([new File(['x'], 'x.jpg', { type: 'image/jpeg' })]); } catch (e) { return false; }
  }
  // iOS 15+ com Web Share de arquivo: sem isso, só "Baixar arquivo".
  const salvaNoFotos = IOS && aceitaArquivoDeTeste();

  const folha = document.getElementById('g-folha');
  const folhaT = document.getElementById('g-folha-t');
  const folhaOps = document.getElementById('g-folha-ops');
  const folhaMsg = document.getElementById('g-folha-msg');
  const folhaDrive = /** @type {HTMLAnchorElement | null} */ (document.getElementById('g-folha-drive'));
  /** @type {Element | null} */
  let focoAntes = null;
  let geracao = 0;

  // semConta (c=0): o pedido NÃO é um download para a contagem de baixadas —
  // o botão Compartilhar do visualizador, e a nova busca de um arquivo que o
  // iPhone recusou salvar no Fotos (a primeira busca dele já contou). O
  // servidor serve o mesmo arquivo; só não soma em "Fotos baixadas".
  function urlBaixar(f, v, semConta) {
    return '/galeria/' + encodeURIComponent(D.slug) + '/baixar/' + f.id + '?v=' + v + (semConta ? '&c=0' : '');
  }
  // 429 do limite por IP (Wi-Fi de evento = um IP só). O servidor diz quantos
  // segundos esperar (Retry-After); até lá NENHUM pedido de download sai —
  // nem repetição automática, nem toque em outro botão: quem toca de novo vê o
  // tempo que falta, sem martelar o servidor.
  let esperaAte = 0;
  function msgEspera() {
    const s = Math.max(1, Math.ceil((esperaAte - Date.now()) / 1000));
    return 'Muita gente baixando agora. Tente de novo em ' + (s >= 90 ? Math.ceil(s / 60) + ' minutos' : s + ' s') + '.';
  }
  function emEspera() { return Date.now() < esperaAte; }
  function anotaEspera(r) {
    let s = Number.parseInt(r.headers.get('Retry-After') || '', 10);
    if (!(s > 0)) s = 60;
    esperaAte = Date.now() + Math.min(s, 3600) * 1000;
  }
  // O que a versão entrega para a foto: nome e peso do arquivo (ou null).
  function arquivoDe(f, v) {
    return v === 'redes' ? f.redes : { nome: f.nome, bytes: f.bytes };
  }
  function daVersao(lista, v) {
    return v === 'redes' ? lista.filter(function (f) { return !!f.redes; }) : lista;
  }
  function somaBytes(lista, v) {
    return lista.reduce(function (t, f) { const a = arquivoDe(f, v); return t + (a && a.bytes ? a.bytes : 0); }, 0);
  }
  function linkDireto(url) {
    const a = document.createElement('a');
    a.href = url;
    a.download = '';
    // Download passa pelo Worker (cota do Drive): nada de robô seguindo.
    a.rel = 'nofollow';
    document.body.appendChild(a);
    a.click();
    a.remove();
  }
  const TIPOS = { jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', webp: 'image/webp', heic: 'image/heic', heif: 'image/heif', gif: 'image/gif', tif: 'image/tiff', tiff: 'image/tiff' };
  // Os bytes vêm como o servidor mandou; o nome é o do Drive (X-Nome-Arquivo).
  // O tipo só diz à folha do sistema que é imagem (se o Drive mandou
  // octet-stream, vale a extensão) — não toca em byte nenhum.
  async function buscaArquivo(f, v, semConta) {
    if (emEspera()) throw new Error(msgEspera());
    const r = await fetch(urlBaixar(f, v, semConta), { credentials: 'same-origin' });
    if (r.status === 429) {
      anotaEspera(r);
      throw new Error(msgEspera());
    }
    if (!r.ok) {
      let msg = '';
      try { msg = (await r.json()).error || ''; } catch (e) { msg = ''; }
      throw new Error(msg || 'O Google recusou a foto (' + r.status + ').');
    }
    const blob = await r.blob();
    let nome = '';
    try { nome = decodeURIComponent(r.headers.get('X-Nome-Arquivo') || ''); } catch (e) { nome = ''; }
    nome = nome || arquivoDe(f, v).nome;
    let tipo = blob.type;
    if (!tipo || tipo.indexOf('image/') !== 0) {
      const ext = (nome.match(/[.]([A-Za-z0-9]+)$/) || [])[1];
      tipo = (ext && TIPOS[ext.toLowerCase()]) || 'image/jpeg';
    }
    return new File([blob], nome, { type: tipo });
  }

  function opcao(titulo, detalhe) {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'g-op';
    const t = document.createElement('strong');
    t.textContent = titulo;
    const d = document.createElement('span');
    d.textContent = detalhe;
    b.appendChild(t);
    b.appendChild(d);
    return b;
  }
  function botaoAcao(texto, primario) {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'g-btn' + (primario ? ' g-prim' : '');
    b.textContent = texto;
    return b;
  }

  // Texto de cada versão na folha. Nome e peso são os do arquivo que SERÁ
  // baixado; com várias fotos, "para redes" diz quantas têm a versão.
  function detalheDaVersao(lista, v) {
    const com = daVersao(lista, v);
    const total = somaBytes(com, v);
    if (lista.length === 1) {
      const f = lista[0];
      const a = arquivoDe(f, v);
      const dim = v === 'max' && f.w && !f.estimada ? ' · ' + f.w + ' × ' + f.h + ' px' : '';
      return (v === 'redes' ? 'Da pasta do Instagram, sem alteração · ' : 'O arquivo original · ') + a.nome + dim + (a.bytes ? ' · ' + fmtBytes(a.bytes) : '');
    }
    if (v === 'redes') {
      const so = com.length === lista.length ? 'As ' + lista.length + ' fotos' : com.length + ' de ' + lista.length + ' fotos têm esta versão (as outras ficam de fora)';
      return so + ' · arquivos da pasta do Instagram, sem alteração' + (total ? ' · ' + fmtBytes(total) + ' no total' : '');
    }
    return 'Os arquivos originais, sem alteração' + (total ? ' · ' + fmtBytes(total) + ' no total' : '');
  }

  function abreFolha(lista) {
    if (!folha || !folhaT || !folhaOps || !folhaMsg || !lista.length) return;
    geracao++;
    if (folha.hidden) focoAntes = document.activeElement;
    folhaT.textContent = lista.length === 1 ? 'Baixar ' + semExt(lista[0].nome) : 'Baixar ' + lista.length + ' fotos';
    folhaMsg.textContent = IOS && salvaNoFotos ? 'No iPhone: toque em Salvar no Fotos e, na janela que abrir, em Salvar imagem.' : '';
    folhaOps.replaceChildren();
    const um = lista.length === 1 ? lista[0] : null;
    // "Para redes" só entra se ao menos uma foto da lista tem a versão.
    const versoes = daVersao(lista, 'redes').length ? [['redes', 'Para redes sociais'], ['max', 'Tamanho máximo']] : [['max', 'Tamanho máximo']];
    /** @type {HTMLElement | null} */
    let primeiro = null;
    versoes.forEach(function (par) {
      const v = par[0];
      const el = IOS ? blocoIOS(lista, v, par[1]) : blocoComum(lista, v, par[1]);
      folhaOps.appendChild(el.raiz);
      if (!primeiro) primeiro = el.foco;
    });
    if (folhaDrive) {
      folhaDrive.hidden = !um;
      if (um) folhaDrive.href = 'https://drive.google.com/file/d/' + um.id + '/view';
    }
    mostraFolha(/** @type {HTMLElement} */ (primeiro));
  }

  // Android e computador: um botão por versão, o toque baixa.
  function blocoComum(lista, v, titulo) {
    const b = opcao(titulo, detalheDaVersao(lista, v));
    b.addEventListener('click', function () { baixaComum(daVersao(lista, v), v); });
    return { raiz: b, foco: b };
  }

  // iPhone e iPad: a versão com "Salvar no Fotos" (principal) e "Baixar
  // arquivo" (Arquivos).
  function blocoIOS(lista, v, titulo) {
    const raiz = document.createElement('div');
    raiz.className = 'g-ver';
    const t = document.createElement('div');
    t.className = 'g-ver-t';
    const st = document.createElement('strong');
    st.textContent = titulo;
    const sd = document.createElement('span');
    sd.textContent = detalheDaVersao(lista, v);
    t.appendChild(st);
    t.appendChild(sd);
    raiz.appendChild(t);
    const acoes = document.createElement('div');
    acoes.className = 'g-ver-a';
    const alvo = daVersao(lista, v);
    const baixar = botaoAcao('Baixar arquivo', !salvaNoFotos);
    baixar.addEventListener('click', function () { baixaComum(alvo, v); });
    let foco = baixar;
    if (salvaNoFotos) {
      const rotulo = alvo.length > 1 ? 'Salvar ' + alvo.length + ' fotos no Fotos' : 'Salvar no Fotos';
      const salvar = botaoAcao(rotulo, true);
      // Quando o arquivo está pronto, o próximo toque é de quem o espera (o
      // iOS só abre a folha dentro de um toque).
      /** @type {(() => void) | null} */
      let aoToque = null;
      salvar.addEventListener('click', function () {
        if (aoToque) { const f = aoToque; aoToque = null; f(); return; }
        salvarNoFotos(alvo, v, salvar, rotulo, function (f) { aoToque = f; });
      });
      acoes.appendChild(salvar);
      foco = salvar;
    }
    acoes.appendChild(baixar);
    raiz.appendChild(acoes);
    return { raiz: raiz, foco: foco };
  }

  // Reaberta por cima de si mesma, não empilha.
  function mostraFolha(primeiro) {
    if (!folha) return;
    if (folha.hidden) history.pushState({ g: 'folha' }, '', location.href);
    folha.hidden = false;
    primeiro.focus();
  }

  function favoritas() {
    return fotos.filter(function (f) { return fav.has(f.id); });
  }

  // "Baixar tudo": o Drive junta a pasta inteira num .zip, melhor do que 244
  // downloads soltos. As favoritas (só deste aparelho) baixam foto a foto.
  function abreFolhaTudo() {
    if (!folha || !folhaT || !folhaOps || !folhaMsg) return;
    geracao++;
    if (folha.hidden) focoAntes = document.activeElement;
    folhaT.textContent = 'Baixar tudo';
    folhaMsg.textContent = '';
    folhaOps.replaceChildren();
    /** @type {HTMLElement | null} */
    let primeiro = null;
    if (D.drive) {
      const a = document.createElement('a');
      a.className = 'g-op';
      a.href = D.drive;
      a.target = '_blank';
      a.rel = 'nofollow noopener';
      const t = document.createElement('strong');
      t.textContent = 'Pelo Google Drive';
      const d = document.createElement('span');
      d.textContent = 'O Drive junta tudo num .zip';
      a.appendChild(t);
      a.appendChild(d);
      a.addEventListener('click', function () { setTimeout(function () { fechaFolha(); }, 300); });
      folhaOps.appendChild(a);
      primeiro = a;
    }
    if (fav.size) {
      const b = opcao('Baixar as favoritas (' + fav.size + ')', 'Fica só neste aparelho · você escolhe o tamanho');
      b.addEventListener('click', function () { abreFolha(favoritas()); });
      folhaOps.appendChild(b);
      if (!primeiro) primeiro = b;
    }
    if (!primeiro) folhaMsg.textContent = 'Sem a pasta do Drive cadastrada, não há como baixar tudo de uma vez. Selecione as fotos e baixe.';
    if (folhaDrive) folhaDrive.hidden = true;
    mostraFolha(primeiro || /** @type {HTMLElement} */ (folha.querySelector('[data-acao="fechar-folha"]')));
  }

  // Compartilhar a foto aberta (botão Compartilhar do visualizador): o arquivo
  // da pasta do Instagram, quando a foto tem e o aparelho aceita; senão o link
  // direto; senão copia o link. Não é download — é o menu de compartilhar, que
  // quem toca em "Compartilhar" pediu.
  /** @type {Map<string, File>} */
  const arquivosProntos = new Map();
  const podeArquivo = aceitaArquivoDeTeste();
  async function compartilhaFoto(f) {
    const link = location.origin + location.pathname + '#foto=' + f.id;
    try {
      if (podeArquivo && f.redes) {
        let arq = arquivosProntos.get(f.id);
        if (!arq) {
          avisa('Preparando a foto…');
          arq = await buscaArquivo(f, 'redes', true);
          arquivosProntos.set(f.id, arq);
        }
        try {
          await navigator.share({ files: [arq] });
        } catch (e) {
          // O iPhone só deixa compartilhar logo depois do toque: a foto já está
          // pronta, então o toque seguinte compartilha na hora.
          if (e && e.name === 'NotAllowedError') { avisa('Foto pronta: toque em Compartilhar de novo'); return; }
          throw e;
        }
        return;
      }
      if (typeof navigator.share === 'function') {
        await navigator.share({ title: document.title, url: link });
        return;
      }
      await navigator.clipboard.writeText(link);
      avisa('Link copiado');
    } catch (e) {
      if (e && e.name === 'AbortError') return;
      avisa(e && e.name === 'Error' && e.message ? e.message : 'Não foi possível compartilhar. Use Baixar.');
    }
  }

  /** @param {boolean} [peloVoltar] a entrada do histórico já saiu */
  function fechaFolha(peloVoltar) {
    if (!folha || folha.hidden) return;
    geracao++;
    folha.hidden = true;
    if (!peloVoltar && noTopo('folha')) history.back();
    if (focoAntes && typeof (/** @type {HTMLElement} */ (focoAntes)).focus === 'function') (/** @type {HTMLElement} */ (focoAntes)).focus();
  }

  // Download comum, um <a download> por arquivo, em fila (o navegador pede
  // permissão uma vez para vários). O nome vem do Content-Disposition do
  // servidor: o do Drive, exato. No iPhone é o "Baixar arquivo" (vai para o
  // app Arquivos).
  //
  // jaContadas: ids que já foram buscados (e contados) por buscaArquivo —
  // o iPhone recusou salvar no Fotos e o mesmo arquivo vem de novo como
  // download; esses saem com c=0 para a contagem não dobrar. manterAberta:
  // não fecha a folha sozinha (o texto que o chamador pôs nela precisa ser
  // lido — fechar em 900 ms o escondia).
  function baixaComum(lista, v, jaContadas, manterAberta) {
    if (!folhaMsg || !lista.length) return;
    // Em espera por um 429: nada sai (um <a download> não deixa ver a resposta,
    // então a única proteção contra martelar é não pedir enquanto se espera).
    if (emEspera()) { folhaMsg.textContent = msgEspera(); avisa('Muita gente baixando agora'); return; }
    const minha = geracao;
    lista.forEach(function (f, k) { setTimeout(function () { linkDireto(urlBaixar(f, v, !!jaContadas && jaContadas.has(f.id))); }, k * 700); });
    folhaMsg.textContent = lista.length > 1
      ? 'Baixando ' + lista.length + ' fotos. Se o navegador perguntar, permita vários downloads.'
      : 'Download iniciado.';
    avisa(lista.length > 1 ? lista.length + ' fotos baixando' : 'Download começou');
    if (!manterAberta) setTimeout(function () { if (minha === geracao) fechaFolha(); }, lista.length > 1 ? 2500 : 900);
  }

  // Lotes para a folha do iOS: ela segura os arquivos todos na memória da aba
  // do Safari, que é pequena. Até LOTE_MAX_FOTOS fotos e LOTE_MAX_BYTES por vez
  // (sempre ao menos uma); o resto vem no lote seguinte, sem pedir nada à mão.
  function emLotes(lista, v) {
    const lotes = [];
    let atual = [];
    let soma = 0;
    lista.forEach(function (f) {
      const a = arquivoDe(f, v);
      const b = a && a.bytes ? a.bytes : 0;
      if (atual.length && (atual.length >= LOTE_MAX_FOTOS || soma + b > LOTE_MAX_BYTES)) {
        lotes.push(atual);
        atual = [];
        soma = 0;
      }
      atual.push(f);
      soma += b;
    });
    if (atual.length) lotes.push(atual);
    return lotes;
  }

  // Abre a folha do sistema com os arquivos. Logo depois de preparar, o toque
  // original já pode ter vencido (baixar 20 MB demora): tenta na hora e, se o
  // iOS recusar por falta de toque (NotAllowedError), pede UM toque no botão.
  // Devolve 'ok', 'recusou' (cai no download comum). Fechar a folha do sistema
  // sem escolher (AbortError) deixa o botão pronto para abrir de novo.
  function compartilhaLote(arquivos, pedeToque) {
    return new Promise(function (resolve) {
      const tenta = function (comToque) {
        let p;
        try { p = navigator.share({ files: arquivos }); } catch (e) { resolve('recusou'); return; }
        p.then(function () { resolve('ok'); }, function (e) {
          if (e && e.name === 'AbortError') { pedeToque(function () { tenta(true); }, 'Cancelado. Toque para abrir a janela de novo.'); return; }
          if (e && e.name === 'NotAllowedError' && !comToque) { pedeToque(function () { tenta(true); }, ''); return; }
          resolve('recusou');
        });
      };
      tenta(false);
    });
  }

  async function salvarNoFotos(lista, v, botao, rotulo, defineAoToque) {
    if (!folhaMsg) return;
    const minha = geracao;
    const lotes = emLotes(lista, v);
    botao.disabled = true;
    const volta = function () { botao.disabled = false; botao.textContent = rotulo; };
    for (let i = 0; i < lotes.length; i++) {
      const lote = lotes[i];
      const parte = lotes.length > 1 ? ' (parte ' + (i + 1) + ' de ' + lotes.length + ')' : '';
      /** @type {File[]} */
      const arquivos = [];
      try {
        for (let k = 0; k < lote.length; k++) {
          if (minha !== geracao) return;
          folhaMsg.textContent = 'Preparando ' + (k + 1) + ' de ' + lote.length + parte + '…';
          arquivos.push(await buscaArquivo(lote[k], v));
        }
      } catch (e) {
        volta();
        folhaMsg.textContent = (e && e.message) || 'Não foi possível preparar a foto.';
        return;
      }
      if (minha !== geracao) return;
      // O iOS conhece os tipos que aceita: se recusar estes arquivos, o
      // download comum (Arquivos) é o caminho que sobra.
      let r = 'recusou';
      if (podeCompartilharArquivos(arquivos)) {
        r = await compartilhaLote(arquivos, function (acao, msg) {
          if (minha !== geracao) return;
          botao.disabled = false;
          botao.textContent = arquivos.length > 1 ? 'Salvar ' + arquivos.length + ' fotos' + parte : 'Salvar no Fotos';
          folhaMsg.textContent = msg || 'Pronto. Toque em Salvar no Fotos e, na janela do iPhone, em Salvar imagem.';
          defineAoToque(function () { botao.disabled = true; acao(); });
          botao.focus();
        });
      }
      if (minha !== geracao) return;
      if (r !== 'ok') {
        volta();
        const restantes = lotes.slice(i).reduce(function (t, l) { return t.concat(l); }, []);
        // O lote atual já foi buscado (e contado) acima: só ele sai com c=0.
        const jaContadas = new Set(lote.map(function (f) { return f.id; }));
        // A folha fica aberta: a explicação abaixo é o que a pessoa precisa ler.
        baixaComum(restantes, v, jaContadas, true);
        if (!emEspera()) folhaMsg.textContent = 'O iPhone não aceitou salvar direto no Fotos. Baixando como arquivo (app Arquivos).';
        return;
      }
      if (i + 1 < lotes.length) botao.textContent = 'Preparando a parte ' + (i + 2) + '…';
    }
    volta();
    fechaFolha();
    // Não diz "salvou": a pessoa pode ter escolhido WhatsApp ou AirDrop em vez
    // de "Salvar imagem", e a página não fica sabendo.
    avisa(lista.length > 1 ? lista.length + ' fotos enviadas pelo menu do iPhone' : 'Foto enviada pelo menu do iPhone');
  }

  // ---- Aviso flutuante ----
  const flut = document.getElementById('g-aviso-flut');
  let flutT = 0;
  function avisa(txt) {
    if (!flut) return;
    flut.textContent = txt;
    flut.classList.add('on');
    clearTimeout(flutT);
    flutT = setTimeout(function () { flut.classList.remove('on'); }, 1800);
  }

  // Compartilhar a PÁGINA DO PROJETO (não a galeria): é o link que o dono
  // divulga, com a capa e o resumo certos nas redes.
  function compartilhaPagina() {
    const url = location.origin + '/' + encodeURIComponent(D.slug);
    const h1 = document.getElementById('g-h1');
    const titulo = h1 ? (h1.textContent || '') : document.title;
    if (navigator.share) {
      navigator.share({ title: titulo, url: url }).catch(function () {});
      return;
    }
    if (navigator.clipboard) {
      navigator.clipboard.writeText(url).then(function () { avisa('Link copiado'); }, function () { avisa(url); });
    } else {
      avisa(url);
    }
  }

  // ---- Eventos ----
  main.addEventListener('click', function (e) {
    const alvo = /** @type {Element} */ (e.target);
    const a = /** @type {HTMLElement | null} */ (alvo.closest('.g-t'));
    if (!a) return;
    const f = fotos[Number(a.dataset.i)];
    if (!f) return;
    if (alvo.closest('.g-fav')) { e.preventDefault(); alternaFav(f); return; }
    if (modoSel && e.shiftKey && !e.metaKey && !e.ctrlKey) { e.preventDefault(); selecionaIntervalo(f); return; }
    if (e.metaKey || e.ctrlKey || e.shiftKey || e.button === 1) return; // nova aba: o #foto= abre lá
    e.preventDefault();
    if (modoSel) { alternaSel(f); return; }
    abre(vistas.indexOf(f));
  });
  // F favorita a foto em foco na grade (o coração só aparece ao passar o mouse).
  main.addEventListener('keydown', function (e) {
    if ((e.key !== 'f' && e.key !== 'F') || e.metaKey || e.ctrlKey || e.altKey) return;
    const a = /** @type {HTMLElement | null} */ (/** @type {Element} */ (e.target).closest('.g-t'));
    const f = a ? fotos[Number(a.dataset.i)] : null;
    if (f) { e.preventDefault(); alternaFav(f); }
  });
  document.addEventListener('click', function (e) {
    const alvo = /** @type {Element} */ (e.target);
    if (alvo === folha) { fechaFolha(); return; }
    const b = /** @type {HTMLElement | null} */ (alvo.closest('[data-acao]'));
    if (!b) return;
    const acao = b.dataset.acao;
    if (acao === 'fechar-folha') fechaFolha();
    else if (acao === 'limpar-sel') { sel.clear(); ultimoSel = null; fotos.forEach(pintaSel); salvaSel(); atualizaBarra(); }
    else if (acao === 'fim-sel') ligaModoSel(false);
    else if (acao === 'baixar-sel') {
      const lista = fotos.filter(function (f) { return sel.has(f.id); });
      if (lista.length) abreFolha(lista); else avisa('Nenhuma foto selecionada');
    }
    else if (acao === 'baixar-tudo') abreFolhaTudo();
    else if (acao === 'compartilhar') compartilhaPagina();
    else if (acao === 'sel-secao') selecionaSecao(Number(b.dataset.sec));
    else if (acao === 'ir-sec') irParaSecao(Number(b.dataset.sec));
    else if (acao === 'filtro-fav') ligaFiltroFav(!filtroFav);
    else if (acao === 'compartilhar-fav') compartilhaFavoritas();
    else if (acao === 'sai-link') saiDoLink();
    else if (acao === 'guarda-link') guardaDoLink();
    else if (acao === 'topo') {
      window.scrollTo({ top: 0, behavior: reduz() ? 'auto' : 'smooth' });
      const h1 = document.getElementById('g-h1');
      if (h1) h1.focus({ preventScroll: true });
    }
  });
  if (botaoSel) botaoSel.addEventListener('click', function () { ligaModoSel(!modoSel); });
  // Com a folha aberta, Esc e as setas são dela — não do visualizador por baixo.
  window.addEventListener('keydown', function (e) {
    if (!folha || folha.hidden) return;
    if (e.key === 'Escape') { e.preventDefault(); fechaFolha(); }
    if (e.key === 'Escape' || e.key === 'ArrowLeft' || e.key === 'ArrowRight') e.stopPropagation();
  }, true);
  // F favorita a foto aberta no visualizador.
  window.addEventListener('keydown', function (e) {
    if (!vendo || (folha && !folha.hidden)) return;
    if ((e.key !== 'f' && e.key !== 'F') || e.metaKey || e.ctrlKey || e.altKey) return;
    const f = lightbox && lightbox.pswp ? vistas[lightbox.pswp.currIndex] : null;
    if (f) { e.preventDefault(); alternaFav(f); sincronizaFavUi(); }
  });
  // Voltar: fecha a camada de cima (ver noTopo). A folha antes da foto.
  window.addEventListener('popstate', function () {
    if (folha && !folha.hidden && !noTopo('folha')) fechaFolha(true);
    if (lightbox && lightbox.pswp && !noTopo('foto') && !noTopo('folha')) lightbox.pswp.close();
  });

  // ---- Início ----
  detectaWebp(function () {
    monta();
    fotos.forEach(pintaSel);
    sel.forEach(function (id) { if (!fotos.some(function (f) { return f.id === id; })) sel.delete(id); });
    fav.forEach(function (id) { if (!fotos.some(function (f) { return f.id === id; })) fav.delete(id); });
    const doLink = leSelecaoDoLink();
    atualizaBarra();
    montaChips();
    diagramaTudo();
    observaSecoes();
    if (doLink === 0) {
      avisa('As fotos deste link não estão mais nesta galeria');
      history.replaceState(null, '', location.pathname + location.search);
    } else if (doLink > 0) {
      avisa(doLink === 1 ? '1 foto escolhida por quem mandou o link' : doLink + ' fotos escolhidas por quem mandou o link');
    }
    if (typeof ResizeObserver === 'function') {
      new ResizeObserver(function () { if (main.clientWidth !== larguraDiagramada) agendaDiagrama(); }).observe(main);
      if (cab) new ResizeObserver(medeTopo).observe(cab);
    } else {
      window.addEventListener('resize', function () { agendaDiagrama(); medeTopo(); });
    }
    const m = location.hash.match(/^#foto=([A-Za-z0-9_-]+)$/);
    if (m) {
      const f = fotos.find(function (x) { return x.id === m[1]; });
      if (f) {
        // A entrada de chegada vira a da grade, e a abertura empilha a da
        // foto: assim o voltar de quem chegou pelo link fecha a foto e fica
        // na galeria.
        history.replaceState(null, '', location.pathname + location.search);
        abre(vistas.indexOf(f));
      }
    }
    // Aquece o visualizador no tempo ocioso: o primeiro toque abre na hora.
    const ocioso = window.requestIdleCallback || function (fn) { return setTimeout(fn, 1200); };
    ocioso(function () { preparaLightbox().catch(function () {}); });
  });
})();
`;
