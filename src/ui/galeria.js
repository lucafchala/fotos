// Galeria própria — PRÉVIA (#234/#235). Só o dono logado no painel chega aqui;
// para qualquer outra pessoa a rota é um 404 (ver handleGaleriaPagina).
//
// O que ela faz melhor que a pasta do Drive:
//  - grade justificada com a proporção REAL de cada foto (nada cortado, nada
//    de nome de arquivo poluindo), seções por subpasta;
//  - visualizador em tela cheia (PhotoSwipe, vendorizado em vendor/) que pede
//    ao Google a largura exata da tela em pixels FÍSICOS e, a cada zoom, a
//    próxima — até o original (srcset + o `sizes` que o PhotoSwipe atualiza);
//  - dois downloads por foto: "para redes" (lado maior GALERIA_LADO_REDES, leve)
//    e "tamanho máximo" (o arquivo original, byte a byte); no celular, o
//    "Salvar" vai direto para a galeria do aparelho (Web Share com arquivo) —
//    igual no iPhone e no Android;
//  - seleção de várias fotos, lembrada no aparelho, e link direto para cada
//    foto (#foto=ID).
//
// As fotos vêm do lh3 do Google (sem chave). Os downloads passam pelo proxy
// /galeria/<slug>/baixar/<id>, que só entrega arquivo que está na pasta do
// projeto. A chave da Drive API nunca chega a esta página.

import { escape, jsonParaScript, safeUrl, fontFaceCSS, fontPreloadHTML, photoPreconnectHTML } from '../utils.js';
import { VENDOR } from '../content/vendor.js';
import { GALERIA_LARGURAS, GALERIA_LARGURAS_GRADE, GALERIA_LADO_REDES } from '../config.js';

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
 * }} p
 */
export function galeriaHTML({ event, listagem, erro, nonce }) {
  const titulo = String(event.title || event.slug || '');
  const slug = String(event.slug || '');
  const drive = safeUrl(event.driveUrl);
  const total = listagem ? listagem.total : 0;
  const quando = listagem
    ? new Date(listagem.em).toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })
    : '';

  const conserto = erro ? (CONSERTOS[erro.codigo] || CONSERTOS.falha) : null;
  const avisos = [];
  if (listagem && listagem.truncada) {
    avisos.push('Lista parcial: pastas muito grandes ou subpastas além de dois níveis ficam de fora — o Drive continua com tudo.');
  }
  if (listagem && (listagem.videos || listagem.outros)) {
    const partes = [];
    if (listagem.videos) partes.push(`${listagem.videos} vídeo${listagem.videos > 1 ? 's' : ''}`);
    if (listagem.outros) partes.push(`${listagem.outros} outro${listagem.outros > 1 ? 's' : ''} arquivo${listagem.outros > 1 ? 's' : ''}`);
    avisos.push(`A pasta também tem ${partes.join(' e ')}, que ficam só no Drive.`);
  }

  const dados = listagem ? {
    slug,
    secoes: listagem.secoes.map(s => ({ nome: s.nome, fotos: s.fotos })),
    larguras: GALERIA_LARGURAS,
    grade: GALERIA_LARGURAS_GRADE,
    ladoRedes: GALERIA_LADO_REDES,
    lightbox: vendorPath('vendor/photoswipe/photoswipe-lightbox.esm.min.js'),
    core: vendorPath('vendor/photoswipe/photoswipe.esm.min.js'),
  } : null;

  return `<!DOCTYPE html>
<html lang="pt-BR">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0, viewport-fit=cover">
  <meta name="robots" content="noindex,nofollow">
  <meta name="theme-color" content="#0a0a0a">
  <link rel="icon" type="image/svg+xml" href="/icon.svg">
  <title>Galeria · ${escape(titulo)} · prévia</title>
  ${fontPreloadHTML()}
  ${photoPreconnectHTML()}
  <link rel="stylesheet" href="${vendorPath('vendor/photoswipe/photoswipe.css')}">
  <style>
    ${fontFaceCSS()}
    *,*::before,*::after{box-sizing:border-box;margin:0;padding:0}
    :root{
      --bg-page:#0a0a0a; --text:#f0ebe5; --text-2:#bbb; --text-muted:#999; --text-dim:#666;
      --bg-card:#141414; --bg-card-2:#1c1c1c; --border:#262626; --accent:#c0a060; --accent-text:#0a0a0a;
      --warn-bg:#1d1606; --warn-border:#4a3a12; --warn-text:#d8b25a;
      --err-bg:#1a0a0a; --err-border:#2e1a1a; --err-text:#e0a0a0;
      --pad:clamp(12px,3vw,32px); --gap:5px;
    }
    @media (prefers-color-scheme: light){
      :root{
        --bg-page:#f0ece8; --text:#1a1715; --text-2:#4a4744; --text-muted:#6b6460; --text-dim:#8a8480;
        --bg-card:#e5e1db; --bg-card-2:#fff; --border:#ddd9d4; --accent:#8a6428; --accent-text:#faf7f3;
        --warn-bg:#fdf3dc; --warn-border:#e8d1a0; --warn-text:#7a5a17;
        --err-bg:#fdecec; --err-border:#f2c6c6; --err-text:#8c1d18;
      }
    }
    @media (max-width:520px){ :root{ --gap:3px } }
    body{font-family:'Inter',sans-serif;background:var(--bg-page);color:var(--text);min-height:100vh;-webkit-text-size-adjust:100%}
    :focus-visible{outline:2px solid var(--accent);outline-offset:2px}
    a{color:inherit}
    .g-top{position:sticky;top:0;z-index:5;display:flex;flex-wrap:wrap;align-items:center;gap:.75rem 1.25rem;padding:.9rem var(--pad);background:color-mix(in srgb,var(--bg-page) 86%,transparent);backdrop-filter:blur(10px);-webkit-backdrop-filter:blur(10px);border-bottom:1px solid var(--border)}
    .g-nav{display:flex;gap:.5rem;font-size:.8rem}
    .g-nav a{color:var(--text-muted);text-decoration:none}
    .g-nav a:hover{color:var(--text)}
    .g-tit{flex:1 1 16rem;min-width:0}
    .g-tit h1{font-size:clamp(1.05rem,2.4vw,1.4rem);font-weight:600;letter-spacing:-.01em;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
    .g-meta{font-size:.78rem;color:var(--text-muted);margin-top:.15rem}
    .g-acoes{display:flex;flex-wrap:wrap;gap:.5rem}
    .g-btn{display:inline-flex;align-items:center;gap:.4rem;font:inherit;font-size:.8rem;font-weight:500;padding:.5rem .85rem;border-radius:999px;border:1px solid var(--border);background:var(--bg-card-2);color:var(--text);text-decoration:none;cursor:pointer;white-space:nowrap}
    .g-btn:hover{border-color:var(--text-dim)}
    .g-btn[aria-pressed="true"]{background:var(--accent);border-color:var(--accent);color:var(--accent-text)}
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
    .g-sec h2{padding:0 var(--pad);margin-bottom:.7rem;font-size:.72rem;letter-spacing:.16em;text-transform:uppercase;color:var(--text-muted);font-weight:600}
    .g-grade{padding:0 var(--pad)}
    .g-linha{display:flex;gap:var(--gap);margin-bottom:var(--gap)}
    .g-t{position:relative;flex:none;height:100%;display:block;background:var(--bg-card);overflow:hidden;border-radius:2px;-webkit-tap-highlight-color:transparent}
    .g-t img{width:100%;height:100%;display:block;object-fit:cover;opacity:0;transition:opacity .35s ease}
    .g-t img.ok{opacity:1}
    .g-t:hover img.ok{filter:brightness(1.06)}
    .g-t .g-ck{position:absolute;top:6px;right:6px;width:24px;height:24px;border-radius:50%;border:2px solid #fff;background:rgba(0,0,0,.25);display:none;box-shadow:0 1px 4px rgba(0,0,0,.4)}
    .g-modo-sel .g-t .g-ck{display:block}
    .g-t.sel .g-ck{display:block;background:var(--accent);border-color:var(--accent)}
    .g-t.sel .g-ck::after{content:"";position:absolute;left:7px;top:3px;width:6px;height:11px;border:solid var(--accent-text);border-width:0 2px 2px 0;transform:rotate(45deg)}
    .g-t.sel img{opacity:.78}
    .g-barra{position:fixed;left:50%;bottom:calc(16px + env(safe-area-inset-bottom));transform:translateX(-50%);z-index:6;display:flex;align-items:center;gap:.5rem;padding:.5rem .55rem .5rem 1rem;border-radius:999px;background:var(--bg-card-2);border:1px solid var(--border);box-shadow:0 8px 30px rgba(0,0,0,.35);font-size:.85rem;max-width:calc(100vw - 24px)}
    .g-barra[hidden]{display:none}
    .g-barra .g-btn{padding:.45rem .8rem}
    .g-barra .g-prim{background:var(--accent);border-color:var(--accent);color:var(--accent-text)}
    #g-barra-n{white-space:nowrap;margin-right:.25rem}
    /* Folha de download: por cima do visualizador (o PhotoSwipe usa z-index 100000). */
    .g-folha{position:fixed;inset:0;z-index:100010;display:flex;align-items:flex-end;justify-content:center;background:rgba(0,0,0,.55)}
    .g-folha[hidden]{display:none}
    .g-folha-c{width:min(30rem,100%);background:var(--bg-card-2);color:var(--text);border-radius:16px 16px 0 0;padding:1.1rem 1.1rem calc(1.1rem + env(safe-area-inset-bottom));box-shadow:0 -10px 40px rgba(0,0,0,.4)}
    @media (min-width:700px){ .g-folha{align-items:center} .g-folha-c{border-radius:16px} }
    .g-folha-t{font-weight:600;font-size:.95rem;margin-bottom:.8rem;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
    .g-op{display:flex;flex-direction:column;align-items:flex-start;gap:.15rem;width:100%;text-align:left;font:inherit;padding:.8rem .9rem;margin-bottom:.5rem;border-radius:10px;border:1px solid var(--border);background:var(--bg-page);color:var(--text);cursor:pointer}
    .g-op:hover{border-color:var(--text-dim)}
    .g-op strong{font-size:.9rem;font-weight:600}
    .g-op span{font-size:.76rem;color:var(--text-muted)}
    .g-op.g-pronto{background:var(--accent);border-color:var(--accent);color:var(--accent-text)}
    .g-op.g-pronto span{color:var(--accent-text);opacity:.8}
    .g-op[disabled]{opacity:.6;cursor:progress}
    .g-folha-msg{font-size:.8rem;color:var(--text-muted);min-height:1.2em;margin:.2rem 0 .6rem}
    .g-folha-rod{display:flex;justify-content:space-between;align-items:center;gap:.5rem}
    .g-folha-rod a{font-size:.78rem;color:var(--text-muted)}
    .g-aviso-flut{position:fixed;left:50%;top:calc(68px + env(safe-area-inset-top));transform:translateX(-50%);z-index:100020;background:#111;color:#f0ebe5;font-size:.82rem;padding:.55rem .9rem;border-radius:999px;box-shadow:0 6px 24px rgba(0,0,0,.35);pointer-events:none;opacity:0;transition:opacity .2s}
    .g-aviso-flut.on{opacity:1}
    /* Visualizador: legenda e o botão de seleção ligado. */
    .pswp{--pswp-bg:#000}
    .pswp__g-legenda{position:absolute;left:0;right:0;bottom:0;padding:1.6rem 1rem calc(.9rem + env(safe-area-inset-bottom));text-align:center;font:500 13px/1.4 'Inter',sans-serif;color:#e8e3dd;background:linear-gradient(transparent,rgba(0,0,0,.55));pointer-events:none;transition:opacity .25s}
    .pswp:not(.pswp--ui-visible) .pswp__g-legenda{opacity:0}
    .pswp__button--g-sel.on .pswp__icn{fill:#c0a060}
    @media (prefers-reduced-motion: reduce){ .g-t img{transition:none} }
  </style>
</head>
<body>
  <header class="g-top">
    <nav class="g-nav" aria-label="Voltar"><a href="/dashboard">← Painel</a><span aria-hidden="true">·</span><a href="/${escape(slug)}">Página do projeto</a></nav>
    <div class="g-tit">
      <h1>${escape(titulo)}</h1>
      <p class="g-meta">${listagem ? `Lista do Drive de ${escape(quando)}` : 'Galeria'}</p>
    </div>
    <div class="g-acoes">
      ${listagem && total ? '<button type="button" class="g-btn" id="g-sel" aria-pressed="false">Selecionar</button>' : ''}
      ${drive ? `<a class="g-btn" href="${escape(drive)}" target="_blank" rel="noopener">Abrir no Drive</a>` : ''}
      ${listagem ? '<a class="g-btn" href="?atualizar=1" title="Relê a pasta no Drive agora (a lista fica guardada por 10 minutos)">Atualizar lista</a>' : ''}
    </div>
  </header>
  <p class="g-previa"><b>Prévia</b> Só você (logado no painel) vê esta página. O público continua indo para o Drive.</p>
  ${avisos.map(a => `<p class="g-aviso">${escape(a)}</p>`).join('\n  ')}
  ${conserto && erro ? `<section class="g-erro" role="alert">
    <h2>${escape(conserto.titulo)}</h2>
    <p>${escape(erro.mensagem)}</p>
    <ol>${conserto.passos.map(p => `<li>${p}</li>`).join('')}</ol>
  </section>` : ''}
  ${listagem && !total ? '<section class="g-erro"><h2>A pasta não tem fotos</h2><p>O Drive respondeu, mas não há imagens nesta pasta (nem nas subpastas lidas).</p></section>' : ''}
  <main id="g-main" aria-label="Fotos"></main>
  <noscript><p class="g-aviso">A galeria precisa de JavaScript. ${drive ? `<a href="${escape(drive)}">Abrir a pasta no Drive</a>.` : ''}</p></noscript>
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
      <div class="g-folha-rod"><a id="g-folha-drive" href="#" target="_blank" rel="noopener" hidden>Abrir no Drive</a><button type="button" class="g-btn" data-acao="fechar-folha">Fechar</button></div>
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
  /** @type {{ slug: string, secoes: { nome: string, fotos: [string, number, number, string, number][] }[], larguras: number[], grade: number[], ladoRedes: number, lightbox: string, core: string }} */
  const D = JSON.parse(dadosEl.textContent || '{}');

  // ---- Dados ----
  /** @typedef {{ id: string, w: number, h: number, nome: string, bytes: number, s: number, i: number, el: HTMLAnchorElement, img: HTMLImageElement, estimada: boolean }} Foto */
  /** @type {Foto[]} */
  const fotos = [];
  let rw = '';
  const lh3 = function (id, w) { return 'https://lh3.googleusercontent.com/d/' + id + '=w' + Math.round(w) + rw; };
  const semExt = function (n) { return String(n || '').replace(/[.][^.]+$/, ''); };
  const LONGO_ESTIMADO = 4096;

  // Unidades decimais (1 MB = 1.000.000 bytes): é o que o iPhone, o Mac e o
  // Android mostram para o arquivo baixado — o número aqui tem de bater com o
  // da galeria do celular depois.
  function fmtBytes(n) {
    if (!n) return '';
    const mb = n / 1e6;
    if (mb < 1) return Math.max(1, Math.round(n / 1e3)) + ' KB';
    return mb.toLocaleString('pt-BR', { maximumFractionDigits: mb < 10 ? 1 : 0 }) + ' MB';
  }

  // ---- WebP: decide por decodificação de verdade, não por user-agent ----
  function detectaWebp(pronto) {
    const t = new Image();
    let feito = false;
    const fim = function (ok) { if (feito) return; feito = true; rw = ok ? '-rw' : ''; pronto(); };
    t.onload = function () { fim(t.width === 1); };
    t.onerror = function () { fim(false); };
    setTimeout(function () { fim(false); }, 1500);
    t.src = 'data:image/webp;base64,UklGRiIAAABXRUJQVlA4IBYAAAAwAQCdASoBAAEADsD+JaQAA3AAAAAA';
  }

  // ---- Grade justificada ----
  /** @type {{ sec: HTMLElement, grade: HTMLElement, lista: Foto[] }[]} */
  const grades = [];
  function monta() {
    const varias = D.secoes.length > 1;
    D.secoes.forEach(function (sec, s) {
      const secEl = document.createElement('section');
      secEl.className = 'g-sec';
      if (varias) {
        const h2 = document.createElement('h2');
        // Sem número de fotos, de propósito: a contagem foi removida do site a
        // pedido do dono (TODO.md, Decidido não fazer) — as fotos já vêm
        // numeradas. O "N de M" do visualizador é posição, não contagem.
        h2.textContent = sec.nome || 'Fotos';
        secEl.appendChild(h2);
      }
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
        img.alt = '';
        img.decoding = 'async';
        img.loading = i < 16 ? 'eager' : 'lazy';
        if (i < 4) img.setAttribute('fetchpriority', 'high');
        const ck = document.createElement('span');
        ck.className = 'g-ck';
        ck.setAttribute('aria-hidden', 'true');
        a.appendChild(img);
        a.appendChild(ck);
        /** @type {Foto} */
        const foto = { id: f[0], w: f[1], h: f[2], nome: f[3], bytes: f[4], s: s, i: i, el: a, img: img, estimada: !(f[1] > 0 && f[2] > 0) };
        img.addEventListener('load', function () { carregou(foto); });
        img.addEventListener('error', function () { img.classList.add('ok'); });
        fotos.push(foto);
        lista.push(foto);
      });
      grades.push({ sec: secEl, grade: grade, lista: lista });
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
    const alvo = W < 520 ? 118 : W < 900 ? 170 : 230;
    const gap = W < 520 ? 3 : 5;
    grades.forEach(function (g) { diagrama(g, W, alvo, gap); });
  }

  function diagrama(g, W, alvo, gap) {
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
      linha.forEach(function (f, k) {
        let w = Math.floor(proporcao(f) * h);
        if (k === linha.length - 1 && !naoEstica) w = Math.max(20, livre - usado);
        usado += w;
        f.el.style.width = w + 'px';
        dimensiona(f, w);
        row.appendChild(f.el);
      });
      frag.appendChild(row);
      altura += h + gap;
      linha = [];
      soma = 0;
    };
    g.lista.forEach(function (f) {
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
  function dimensiona(f, w) {
    if (!f.img.srcset) {
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

  // ---- Seleção ----
  const CHAVE_SEL = 'galeria:sel:' + D.slug;
  /** @type {Set<string>} */
  let sel = new Set();
  try {
    const salvo = JSON.parse(localStorage.getItem(CHAVE_SEL) || '[]');
    if (Array.isArray(salvo)) sel = new Set(salvo.map(String));
  } catch (e) { /* armazenamento indisponível: seleção só nesta visita */ }
  let modoSel = false;
  const barra = document.getElementById('g-barra');
  const barraN = document.getElementById('g-barra-n');
  const botaoSel = document.getElementById('g-sel');

  function salvaSel() {
    try { localStorage.setItem(CHAVE_SEL, JSON.stringify(Array.from(sel))); } catch (e) { /* idem */ }
  }
  function pintaSel(f) {
    const on = sel.has(f.id);
    f.el.classList.toggle('sel', on);
    // O check é só visual (aria-hidden): leitor de tela ouve o estado no nome.
    f.el.setAttribute('aria-label', 'Foto ' + semExt(f.nome) + (on ? ', selecionada' : ''));
  }
  function atualizaBarra() {
    if (!barra || !barraN) return;
    const n = sel.size;
    barra.hidden = !(modoSel || n > 0);
    barraN.textContent = n === 1 ? '1 selecionada' : n + ' selecionadas';
  }
  function alternaSel(f) {
    if (sel.has(f.id)) sel.delete(f.id); else sel.add(f.id);
    pintaSel(f);
    salvaSel();
    atualizaBarra();
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
      alt: 'Foto ' + semExt(f.nome),
      element: f.el,
    };
  }

  const ICONE_BAIXAR = '<svg aria-hidden="true" class="pswp__icn" viewBox="0 0 32 32" width="32" height="32"><path d="M15 6h2v12.2l4.3-4.3 1.4 1.4-6.7 6.7-6.7-6.7 1.4-1.4 4.3 4.3zM8 24h16v2H8z"/></svg>';
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

  function preparaLightbox() {
    if (carregandoLb) return carregandoLb;
    const urlLb = D.lightbox;
    const urlCore = D.core;
    carregandoLb = import(urlLb).then(function (mod) {
      const PhotoSwipeLightbox = mod.default;
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
      });
      lightbox.addFilter('numItems', function () { return fotos.length; });
      lightbox.addFilter('itemData', function (_d, index) { return dadosSlide(fotos[index]); });
      lightbox.on('uiRegister', registraUi);
      // Link direto para a foto aberta (#foto=ID): copiar a barra de endereço
      // e mandar para alguém (ou abrir noutra aba) cai na mesma foto. Abrir
      // EMPILHA uma entrada (o "voltar" fecha a foto — ver o popstate acima);
      // trocar de foto só reescreve a entrada, senão o voltar andaria foto
      // por foto.
      lightbox.on('afterInit', function () {
        const f = fotos[lightbox.pswp.currIndex];
        if (f) history.pushState({ g: 'foto' }, '', '#foto=' + f.id);
      });
      lightbox.on('change', function () {
        const f = fotos[lightbox.pswp.currIndex];
        if (f && noTopo('foto')) history.replaceState(history.state, '', '#foto=' + f.id);
      });
      lightbox.on('close', function () {
        // Fechou pela interface (×, Esc, arrastar): tira a entrada que a
        // abertura pôs. Fechou pelo voltar: ela já saiu.
        if (noTopo('foto')) history.back();
        const f = lightbox.pswp ? fotos[lightbox.pswp.currIndex] : null;
        if (f) f.el.focus({ preventScroll: true });
      });
      lightbox.init();
      return lightbox;
    });
    return carregandoLb;
  }

  function registraUi() {
    const pswp = lightbox.pswp;
    pswp.ui.registerElement({
      name: 'g-sel', order: 8, isButton: true, title: 'Selecionar esta foto', html: ICONE_SEL,
      onInit: function (el, p) {
        const sync = function () {
          const f = fotos[p.currIndex];
          const on = !!f && sel.has(f.id);
          el.classList.toggle('on', on);
          el.setAttribute('aria-pressed', String(on));
        };
        p.on('change', sync);
        sync();
      },
      onClick: function (_e, el, p) {
        const f = fotos[p.currIndex];
        if (!f) return;
        alternaSel(f);
        el.classList.toggle('on', sel.has(f.id));
        el.setAttribute('aria-pressed', String(sel.has(f.id)));
        avisa(sel.has(f.id) ? 'Selecionada' : 'Fora da seleção');
      },
    });
    pswp.ui.registerElement({
      name: 'g-baixar', order: 9, isButton: true, title: 'Baixar', html: ICONE_BAIXAR,
      onClick: function (_e, _el, p) {
        const f = fotos[p.currIndex];
        if (f) abreFolha([f]);
      },
    });
    pswp.ui.registerElement({
      name: 'g-legenda', order: 9, isButton: false, appendTo: 'root', html: '',
      onInit: function (el, p) {
        const sync = function () {
          const f = fotos[p.currIndex];
          if (!f) return;
          const secao = D.secoes.length > 1 ? D.secoes[f.s].nome : '';
          el.textContent = semExt(f.nome) + (secao ? ' · ' + secao : '');
        };
        p.on('change', sync);
        sync();
      },
    });
  }

  function abre(i) {
    preparaLightbox().then(function (lb) { lb.loadAndOpen(i); }).catch(function () {
      avisa('O visualizador não carregou. Recarregue a página.');
    });
  }

  // ---- Downloads ----
  // Celular com Web Share de arquivo: "Salvar" leva a foto para a galeria do
  // aparelho (iPhone e Android pelo mesmo caminho). Computador: download
  // direto, com o nome que o servidor dá.
  let compartilha = false;
  try {
    compartilha = matchMedia('(pointer: coarse)').matches && typeof navigator.canShare === 'function'
      && navigator.canShare({ files: [new File(['x'], 'x.jpg', { type: 'image/jpeg' })] });
  } catch (e) { compartilha = false; }

  const folha = document.getElementById('g-folha');
  const folhaT = document.getElementById('g-folha-t');
  const folhaOps = document.getElementById('g-folha-ops');
  const folhaMsg = document.getElementById('g-folha-msg');
  const folhaDrive = /** @type {HTMLAnchorElement | null} */ (document.getElementById('g-folha-drive'));
  /** @type {Element | null} */
  let focoAntes = null;
  let geracao = 0;

  function urlBaixar(f, v) {
    return '/galeria/' + encodeURIComponent(D.slug) + '/baixar/' + f.id + '?v=' + v;
  }
  function linkDireto(url) {
    const a = document.createElement('a');
    a.href = url;
    a.download = '';
    document.body.appendChild(a);
    a.click();
    a.remove();
  }
  async function buscaArquivo(f, v) {
    const r = await fetch(urlBaixar(f, v), { credentials: 'same-origin' });
    if (!r.ok) {
      let msg = '';
      try { msg = (await r.json()).error || ''; } catch (e) { msg = ''; }
      throw new Error(msg || 'O Google recusou a foto (' + r.status + ').');
    }
    const blob = await r.blob();
    let nome = '';
    try { nome = decodeURIComponent(r.headers.get('X-Nome-Arquivo') || ''); } catch (e) { nome = ''; }
    return new File([blob], nome || (semExt(f.nome) + '.jpg'), { type: blob.type || 'image/jpeg' });
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

  function abreFolha(lista) {
    if (!folha || !folhaT || !folhaOps || !folhaMsg || !lista.length) return;
    geracao++;
    focoAntes = document.activeElement;
    folhaT.textContent = lista.length === 1 ? 'Baixar ' + semExt(lista[0].nome) : 'Baixar ' + lista.length + ' fotos';
    folhaMsg.textContent = '';
    folhaOps.replaceChildren();
    const um = lista.length === 1 ? lista[0] : null;
    const bytesMax = lista.reduce(function (t, f) { return t + (f.bytes || 0); }, 0);
    const redes = opcao('Para redes sociais', 'Leve: ' + D.ladoRedes + ' px no lado maior, JPEG — pronto para Instagram e WhatsApp');
    const max = opcao('Tamanho máximo', um
      ? 'O arquivo original' + (um.w && !um.estimada ? ' · ' + um.w + ' × ' + um.h + ' px' : '') + (um.bytes ? ' · ' + fmtBytes(um.bytes) : '')
      : 'Os arquivos originais' + (bytesMax ? ' · ' + fmtBytes(bytesMax) + ' no total' : ''));
    redes.addEventListener('click', function () { executa(lista, 'redes', redes); });
    max.addEventListener('click', function () { executa(lista, 'max', max); });
    folhaOps.appendChild(redes);
    folhaOps.appendChild(max);
    if (folhaDrive) {
      folhaDrive.hidden = !um;
      if (um) folhaDrive.href = 'https://drive.google.com/file/d/' + um.id + '/view';
    }
    // Reaberta por cima de si mesma (o lote seguinte do "Salvar"), não empilha.
    if (folha.hidden) history.pushState({ g: 'folha' }, '', location.href);
    folha.hidden = false;
    redes.focus();
  }

  /** @param {boolean} [peloVoltar] a entrada do histórico já saiu */
  function fechaFolha(peloVoltar) {
    if (!folha || folha.hidden) return;
    geracao++;
    folha.hidden = true;
    if (!peloVoltar && noTopo('folha')) history.back();
    if (focoAntes && typeof (/** @type {HTMLElement} */ (focoAntes)).focus === 'function') (/** @type {HTMLElement} */ (focoAntes)).focus();
  }

  async function executa(lista, v, botao) {
    if (!folhaMsg) return;
    const minha = geracao;
    if (!compartilha) {
      lista.forEach(function (f, k) { setTimeout(function () { linkDireto(urlBaixar(f, v)); }, k * 700); });
      folhaMsg.textContent = lista.length > 1
        ? 'Baixando ' + lista.length + ' fotos. Se o navegador perguntar, permita vários downloads.'
        : 'Download iniciado.';
      setTimeout(function () { if (minha === geracao) fechaFolha(); }, lista.length > 1 ? 2500 : 900);
      return;
    }
    // Celular: prepara os arquivos e só então pede o toque em "Salvar" — o
    // iPhone exige que o compartilhamento saia de um toque recente, e baixar
    // 20 MB leva mais que isso.
    const limite = v === 'max' ? 10 : 30;
    const lote = lista.slice(0, limite);
    const resto = lista.slice(limite);
    botao.disabled = true;
    /** @type {File[]} */
    const arquivos = [];
    try {
      for (let k = 0; k < lote.length; k++) {
        if (minha !== geracao) return;
        folhaMsg.textContent = 'Preparando ' + (k + 1) + ' de ' + lote.length + '…';
        arquivos.push(await buscaArquivo(lote[k], v));
      }
    } catch (e) {
      botao.disabled = false;
      folhaMsg.textContent = (e && e.message) || 'Não foi possível preparar a foto.';
      return;
    }
    if (minha !== geracao) return;
    botao.disabled = false;
    botao.classList.add('g-pronto');
    const tit = botao.querySelector('strong');
    const det = botao.querySelector('span');
    if (tit) tit.textContent = arquivos.length > 1 ? 'Salvar ' + arquivos.length + ' fotos' : 'Salvar na galeria';
    if (det) det.textContent = 'Toque para escolher "Salvar imagem"' + (resto.length ? ' — depois vêm as outras ' + resto.length : '');
    folhaMsg.textContent = 'Pronto.';
    const novo = botao.cloneNode(true);
    botao.replaceWith(novo);
    novo.addEventListener('click', function () {
      navigator.share({ files: arquivos }).then(function () {
        if (resto.length) { abreFolha(resto); return; }
        fechaFolha();
        // "Pronto", e não "salva": a pessoa pode ter escolhido WhatsApp ou
        // AirDrop em vez de "Salvar imagem" — a página não fica sabendo.
        avisa(arquivos.length > 1 ? 'Pronto: ' + arquivos.length + ' fotos' : 'Pronto');
      }).catch(function (e) {
        if (e && e.name === 'AbortError') return;
        // Compartilhamento recusado: cai no download comum.
        lote.forEach(function (f, k) { setTimeout(function () { linkDireto(urlBaixar(f, v)); }, k * 700); });
        if (folhaMsg) folhaMsg.textContent = 'Baixando pelo navegador.';
      });
    });
    novo.focus();
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

  // ---- Eventos ----
  main.addEventListener('click', function (e) {
    const alvo = /** @type {Element} */ (e.target);
    const a = alvo.closest('.g-t');
    if (!a) return;
    if (e.metaKey || e.ctrlKey || e.shiftKey || e.button === 1) return; // nova aba: o #foto= abre lá
    e.preventDefault();
    const f = fotos[Number(a.dataset.i)];
    if (!f) return;
    if (modoSel) { alternaSel(f); return; }
    abre(f.i);
  });
  document.addEventListener('click', function (e) {
    const alvo = /** @type {Element} */ (e.target);
    if (alvo === folha) { fechaFolha(); return; }
    const b = alvo.closest('[data-acao]');
    if (!b) return;
    const acao = b.dataset.acao;
    if (acao === 'fechar-folha') fechaFolha();
    else if (acao === 'limpar-sel') { sel.clear(); fotos.forEach(pintaSel); salvaSel(); atualizaBarra(); }
    else if (acao === 'fim-sel') ligaModoSel(false);
    else if (acao === 'baixar-sel') {
      const lista = fotos.filter(function (f) { return sel.has(f.id); });
      if (lista.length) abreFolha(lista); else avisa('Nenhuma foto selecionada');
    }
  });
  if (botaoSel) botaoSel.addEventListener('click', function () { ligaModoSel(!modoSel); });
  // Com a folha aberta, Esc e as setas são dela — não do visualizador por baixo.
  window.addEventListener('keydown', function (e) {
    if (!folha || folha.hidden) return;
    if (e.key === 'Escape') { e.preventDefault(); fechaFolha(); }
    if (e.key === 'Escape' || e.key === 'ArrowLeft' || e.key === 'ArrowRight') e.stopPropagation();
  }, true);
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
    atualizaBarra();
    diagramaTudo();
    if (typeof ResizeObserver === 'function') {
      new ResizeObserver(function () { if (main.clientWidth !== larguraDiagramada) agendaDiagrama(); }).observe(main);
    } else {
      window.addEventListener('resize', agendaDiagrama);
    }
    const m = location.hash.match(/^#foto=([A-Za-z0-9_-]+)$/);
    if (m) {
      const f = fotos.find(function (x) { return x.id === m[1]; });
      if (f) {
        // A entrada de chegada vira a da grade, e a abertura empilha a da
        // foto: assim o voltar de quem chegou pelo link fecha a foto e fica
        // na galeria.
        history.replaceState(null, '', location.pathname + location.search);
        abre(f.i);
      }
    }
    // Aquece o visualizador no tempo ocioso: o primeiro toque abre na hora.
    const ocioso = window.requestIdleCallback || function (fn) { return setTimeout(fn, 1200); };
    ocioso(function () { preparaLightbox().catch(function () {}); });
  });
})();
`;
