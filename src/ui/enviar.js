// A página "Mandar suas fotos" (v4.0.0): /galeria/<slug>/enviar (no domínio do
// álbum, /enviar). A pessoa escolhe as fotos e os vídeos do celular, a página
// os separa por dia, sugere o evento de cada dia, e envia em partes para a
// pasta de envio do evento no Google Drive (o caminho está em src/envio.js).
//
// O que a página garante, e como:
//  - MUITOS ARQUIVOS DE UMA VEZ: um <input type="file" multiple>; no celular
//    ele abre a galeria do sistema com seleção múltipla. Nada é lido inteiro
//    para a memória: cada parte é um `file.slice()`.
//  - QUALIDADE ORIGINAL: os bytes que o navegador entrega são os que sobem.
//    Nada de canvas, nada de recompressão. (O que o SISTEMA faz ao entregar o
//    arquivo — o iPhone pode converter HEIC em JPEG e manda só a foto de um
//    Live Photo — está fora do alcance de uma página; ver docs/ENVIO.md.)
//  - RETOMAR E NÃO DUPLICAR: cada arquivo tem uma impressão digital (SHA-256
//    do tamanho e de três amostras do conteúdo). A sessão de envio fica no
//    IndexedDB do aparelho: fechou a página, é só escolher as mesmas fotos de
//    novo, e cada uma segue de onde parou (a posição quem diz é o Google). O
//    que já está na pasta do evento o servidor reconhece e não recebe de novo.
//  - WI-FI RUIM: a parte encolhe quando falha e cresce quando vai bem; toda
//    repetição automática tem TETO (RETOMADA §5.12) e a fila acorda sozinha
//    quando a rede ou a página voltam.
//  - SEGUNDO PLANO, ATÉ ONDE UMA PÁGINA PODE: a tela fica acesa durante o
//    envio (Wake Lock) e, se a pessoa trocar de app e o sistema congelar a
//    página, o envio continua de onde parou na volta. Enviar com a página
//    FECHADA não existe na web do iPhone; a página não promete isso.
//
// O script mora numa template string: sem crase, sem dólar-chave e sem barra
// invertida dentro dele (a barra seria dobrada pelo template).

import { escape, jsonParaScript, fontFaceCSS, fontFaceAlbumCSS, fontPreloadHTML, marcaDoAlbum, footerLegalLinksHTML } from '../utils.js';
import { HONEYPOT_CSS } from '../security.js';
import {
  TURNSTILE_SITE_KEY, ENVIO_PARTE_BYTES, ENVIO_PARTE_MIN_BYTES, ENVIO_PARTE_TETO_BYTES, ENVIO_PARTE_MULTIPLO,
  ENVIO_MAX_BYTES, ENVIO_TIPOS, ENVIO_DECLARACAO, ENVIO_ASSINATURA_MAX, PALETA_ALBUM as P,
} from '../config.js';

// As cores são as do álbum (PALETA_ALBUM, src/config.js): a página de envio é
// parte dele, e a paleta mora num lugar só desde a 3.9.0.
const CSS = `
*,*::before,*::after{box-sizing:border-box;margin:0;padding:0}
:root{--bg:${P.bg};--card:${P.card};--borda:${P.borda};--txt:${P.txt};--txt2:${P.txt2};--mudo:${P.mudo};--sol:${P.sol};--ok:#8fd694;--erro:#ff9d8a;color-scheme:dark}
html{-webkit-text-size-adjust:100%}
body{background:var(--bg);color:var(--txt);font-family:'Open Sans','Inter',system-ui,sans-serif;-webkit-font-smoothing:antialiased;min-height:100vh;line-height:1.5}
a{color:var(--sol)}
:focus-visible{outline:2px solid var(--sol);outline-offset:3px}
.ev{max-width:40rem;margin:0 auto;padding:1rem clamp(16px,4vw,32px) 4rem}
.ev-volta{display:inline-flex;align-items:center;min-height:44px;color:var(--txt2);text-decoration:none;font-size:.9rem}
.ev h1{font-size:clamp(1.7rem,6vw,2.3rem);font-weight:800;letter-spacing:-.03em;line-height:1.05;margin:.4rem 0 .6rem}
.ev-sub{color:var(--txt2);font-size:.98rem}
.ev-cartao{background:var(--card);border:1px solid var(--borda);border-radius:16px;padding:1.1rem;margin-top:1.1rem}
.ev-cartao h2{font-size:1.05rem;font-weight:700;margin-bottom:.5rem}
.ev-btn{display:inline-flex;align-items:center;justify-content:center;gap:.5rem;min-height:48px;padding:0 1.3rem;border-radius:999px;border:1px solid var(--sol);background:transparent;color:var(--sol);font:inherit;font-weight:700;font-size:1rem;cursor:pointer;text-decoration:none}
.ev-btn[disabled]{opacity:.5;cursor:default}
.ev-b1{background:var(--sol);color:var(--bg)}
.ev-largo{width:100%}
.ev-btn svg{width:1.25rem;height:1.25rem;flex:none}
.ev-nota{font-size:.84rem;color:var(--mudo);margin-top:.6rem}
.ev-aviso{border-color:var(--sol)}
.ev-grupo{border-top:1px solid var(--borda);padding:.9rem 0}
.ev-grupo:first-of-type{border-top:0;padding-top:.2rem}
.ev-grupo-t{font-weight:700}
.ev-grupo-n{font-size:.86rem;color:var(--mudo)}
.ev-campo{display:block;margin-top:.6rem}
.ev-campo span{display:block;font-size:.84rem;color:var(--txt2);margin-bottom:.25rem}
.ev-campo select,.ev-campo input[type=text]{width:100%;min-height:48px;padding:0 .8rem;border-radius:10px;border:1px solid var(--borda);background:var(--bg);color:var(--txt);font:inherit;font-size:16px}
.ev-campo select[aria-invalid=true],.ev-campo input[aria-invalid=true]{border-color:var(--erro)}
.ev-sug{font-size:.8rem;color:var(--ok);margin-top:.25rem;min-height:1.1em}
.ev-check{display:flex;gap:.7rem;align-items:flex-start;margin-top:.9rem;font-size:.9rem;color:var(--txt2);min-height:44px}
.ev-check input{flex:none;width:24px;height:24px;margin-top:.1rem;accent-color:var(--sol)}
.ev-msg{min-height:1.4em;margin-top:.7rem;font-size:.92rem}
.ev-msg[data-tom=erro]{color:var(--erro)}
.ev-msg[data-tom=ok]{color:var(--ok)}
.ev-barra{width:100%;height:12px;border-radius:999px;overflow:hidden;background:var(--borda);border:0;appearance:none;-webkit-appearance:none;display:block;margin:.7rem 0 .4rem}
.ev-barra::-webkit-progress-bar{background:var(--borda)}
.ev-barra::-webkit-progress-value{background:var(--sol)}
.ev-barra::-moz-progress-bar{background:var(--sol)}
.ev-num{font-size:1.05rem;font-weight:700}
.ev-det{font-size:.86rem;color:var(--txt2)}
.ev-lista{list-style:none;margin-top:.6rem;display:grid;gap:.35rem}
.ev-lista li{display:flex;justify-content:space-between;gap:.8rem;font-size:.84rem;color:var(--txt2)}
.ev-lista li b{font-weight:600;color:var(--txt);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;min-width:0}
.ev-lista li span{flex:none}
.ev-lista li[data-tom=erro] span{color:var(--erro)}
.ev-acoes{display:flex;flex-wrap:wrap;gap:.6rem;margin-top:.9rem}
.ev-ts{margin-top:.8rem;min-height:0}
.ev-fim{margin-top:2.5rem;font-size:.8rem;color:var(--mudo);text-align:center}
.ev-fim a{color:var(--mudo)}
[hidden]{display:none!important}
@media (prefers-reduced-motion: reduce){*{transition:none!important;animation:none!important}}
`;

const ICONE = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 16V4"/><path d="m7 9 5-5 5 5"/><path d="M20 16v3a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1v-3"/></svg>';

/**
 * @typedef {{ p: string, cap: string, evento: string, rotulo: string, url: string }} DestinoDeEnvio
 *   p = ID da pasta de envio (o servidor confere contra a própria lista em todo pedido)
 */

/**
 * @param {{
 *   event: import('../utils.js').Evento,
 *   destinos: DestinoDeEnvio[],
 *   dias: Record<string, number[]>,
 *   volta: string,
 *   base?: string,
 *   urlPasta: string,
 *   evento?: string,
 *   token: string,
 *   nonce: string,
 * }} p `dias`: slug do evento → os dias (AAAAMMDD) com mais fotos nele; `base`: de onde
 *   as rotas do envio partem nesta origem; `evento`: o evento já escolhido (?evento=)
 */
export function enviarHTML(p) {
  const { event, destinos, nonce } = p;
  const slug = String(event.slug || '');
  const titulo = String(event.title || slug);
  const marca = marcaDoAlbum(slug);
  const dados = {
    slug,
    destinos,
    dias: p.dias,
    evento: p.evento || '',
    token: p.token,
    ts: TURNSTILE_SITE_KEY,
    parte: { ini: ENVIO_PARTE_BYTES, min: ENVIO_PARTE_MIN_BYTES, max: ENVIO_PARTE_TETO_BYTES, mult: ENVIO_PARTE_MULTIPLO },
    maxBytes: ENVIO_MAX_BYTES,
    exts: Object.keys(ENVIO_TIPOS),
    videos: Object.entries(ENVIO_TIPOS).filter(([, m]) => m.startsWith('video/')).map(([e]) => e),
  };
  // O seletor do sistema: imagem e vídeo, mais as extensões por extenso (o
  // Android de alguns fabricantes ignora `image/*` para HEIC).
  const accept = ['image/*', 'video/*', ...Object.keys(ENVIO_TIPOS).map(e => `.${e}`)].join(',');
  return `<!DOCTYPE html>
<html lang="pt-BR">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0, viewport-fit=cover">
  <meta name="robots" content="noindex,nofollow">
  <meta name="theme-color" content="${P.bg}">
  <link rel="icon" type="image/svg+xml" href="${marca ? marca.icone : '/icon.svg'}">
  <link rel="apple-touch-icon" href="${marca ? marca.apple : '/apple-touch-icon.png'}">
  <link rel="manifest" href="${marca ? '/manifest-album.json' : '/manifest.json'}">
  <title>Mandar suas fotos · ${escape(titulo)}</title>
  ${fontPreloadHTML()}
  <style>
    ${fontFaceCSS()}
    ${fontFaceAlbumCSS()}
    ${CSS}
    ${HONEYPOT_CSS}
  </style>
</head>
<body>
  <main class="ev" id="ev" data-slug="${escape(slug)}">
    <a class="ev-volta" href="${escape(p.volta)}"><span aria-hidden="true">‹&nbsp;</span>${escape(titulo)}</a>
    <h1>Mandar suas fotos</h1>
    <p class="ev-sub">Escolha as fotos e os vídeos do seu celular. Eles vão para o álbum no tamanho original, na pasta do evento certo.</p>

    <noscript><section class="ev-cartao ev-aviso"><h2>Esta página precisa de JavaScript</h2><p class="ev-sub">Sem ele, mande pela pasta do álbum no Google Drive: <a href="${escape(p.urlPasta)}" rel="nofollow noopener">abrir a pasta</a>.</p></section></noscript>

    <section class="ev-cartao ev-aviso" id="ev-pend" hidden aria-labelledby="ev-pend-t">
      <h2 id="ev-pend-t">Você tem envios pela metade</h2>
      <p class="ev-sub" id="ev-pend-txt"></p>
      <div class="ev-acoes"><button type="button" class="ev-btn" data-acao="esquecer">Esquecer esses envios</button></div>
    </section>

    <section class="ev-cartao" id="ev-escolha" aria-labelledby="ev-escolha-t">
      <h2 id="ev-escolha-t">1. Escolha as fotos</h2>
      <input type="file" id="ev-arq" multiple accept="${escape(accept)}" hidden>
      <button type="button" class="ev-btn ev-b1 ev-largo" data-acao="escolher" id="ev-escolher" disabled>${ICONE}<span id="ev-escolher-txt">Escolher fotos e vídeos</span></button>
      <p class="ev-nota">Pode escolher muitas de uma vez, até a galeria inteira de um evento. O que já está no álbum não vai de novo.</p>
      <p class="ev-msg" id="ev-leitura" role="status"></p>
    </section>

    <section class="ev-cartao" id="ev-revisao" hidden aria-labelledby="ev-revisao-t">
      <h2 id="ev-revisao-t">2. Confira o evento de cada dia</h2>
      <div id="ev-grupos"></div>
      <label class="ev-campo"><span>Seu nome, para o crédito das fotos (opcional)</span><input type="text" id="ev-nome" maxlength="${ENVIO_ASSINATURA_MAX}" autocomplete="name" autocapitalize="words" enterkeyhint="done"></label>
      <p class="ev-nota">Com o nome, suas fotos aparecem no álbum como &ldquo;Foto: seu nome&rdquo;. Sem ele, saem com o crédito da turma.</p>
      <label class="ev-check"><input type="checkbox" id="ev-aceite"><span>${escape(ENVIO_DECLARACAO.replace(' e li os Termos de Uso.', ''))} e li os <a href="/termos" target="_blank" rel="noopener">Termos de Uso</a>.</span></label>
      <div class="hp-field" aria-hidden="true"><label>Não preencha<input type="text" id="ev-hp" tabindex="-1" autocomplete="off"></label></div>
      <div class="ev-ts" id="ev-ts"></div>
      <p class="ev-msg" id="ev-rev-msg" role="alert"></p>
      <button type="button" class="ev-btn ev-b1 ev-largo" data-acao="enviar" id="ev-enviar">Enviar</button>
    </section>

    <section class="ev-cartao" id="ev-andamento" hidden aria-labelledby="ev-and-t">
      <h2 id="ev-and-t" tabindex="-1">3. Enviando</h2>
      <p class="ev-num" id="ev-num"></p>
      <progress class="ev-barra" id="ev-barra" max="1000" value="0" aria-labelledby="ev-and-t"></progress>
      <p class="ev-det" id="ev-det"></p>
      <p class="ev-msg" id="ev-estado" role="status" aria-live="polite"></p>
      <ul class="ev-lista" id="ev-agora" aria-label="Enviando agora"></ul>
      <ul class="ev-lista" id="ev-problemas" aria-label="Arquivos que não foram"></ul>
      <div class="ev-acoes">
        <button type="button" class="ev-btn" data-acao="pausar" id="ev-pausar">Pausar</button>
        <button type="button" class="ev-btn" data-acao="repetir" id="ev-repetir" hidden>Tentar de novo</button>
        <a class="ev-btn" id="ev-ver" href="${escape(p.volta)}" hidden>Ver o álbum</a>
      </div>
      <p class="ev-nota" id="ev-dica">Deixe esta página aberta até terminar. Se a internet cair ou você sair do navegador, o envio continua de onde parou quando você voltar.</p>
    </section>

    <p class="ev-nota">Prefere o Google Drive? <a href="${escape(p.urlPasta)}" target="_blank" rel="nofollow noopener">Abrir a pasta do álbum</a>.</p>
    <footer class="ev-fim">${footerLegalLinksHTML(marca ? 'https://fotos.lucafchala.com' : '')}</footer>
  </main>
  <script type="application/json" id="ev-dados" nonce="${nonce}">${jsonParaScript(dados)}</script>
  <script nonce="${nonce}">${SCRIPT_ENVIAR}</script>
</body>
</html>`;
}

export const SCRIPT_ENVIAR = `
(function () {
  'use strict';
  var raiz = document.getElementById('ev');
  var bruto = document.getElementById('ev-dados');
  if (!raiz || !bruto) return;
  var D = JSON.parse(bruto.textContent || '{}');
  var elArq = document.getElementById('ev-arq');
  var elEscolher = document.getElementById('ev-escolher');
  var elEscolherTxt = document.getElementById('ev-escolher-txt');
  var elLeitura = document.getElementById('ev-leitura');
  var elRevisao = document.getElementById('ev-revisao');
  var elGrupos = document.getElementById('ev-grupos');
  var elNome = document.getElementById('ev-nome');
  var elAceite = document.getElementById('ev-aceite');
  var elHp = document.getElementById('ev-hp');
  var elRevMsg = document.getElementById('ev-rev-msg');
  var elEnviar = document.getElementById('ev-enviar');
  var elAnd = document.getElementById('ev-andamento');
  var elAndT = document.getElementById('ev-and-t');
  var elNum = document.getElementById('ev-num');
  var elBarra = document.getElementById('ev-barra');
  var elDet = document.getElementById('ev-det');
  var elEstado = document.getElementById('ev-estado');
  var elAgora = document.getElementById('ev-agora');
  var elProblemas = document.getElementById('ev-problemas');
  var elPausar = document.getElementById('ev-pausar');
  var elRepetir = document.getElementById('ev-repetir');
  var elVer = document.getElementById('ev-ver');
  var elDica = document.getElementById('ev-dica');
  var elPend = document.getElementById('ev-pend');
  var elPendTxt = document.getElementById('ev-pend-txt');

  var subtle = window.crypto && window.crypto.subtle;
  // Sem o que a página precisa (navegador muito antigo, página fora de HTTPS):
  // fica o caminho do Drive, que está no rodapé.
  if (!subtle || !window.fetch || !window.XMLHttpRequest || !elArq || typeof Blob === 'undefined' || !Blob.prototype.slice) {
    if (elLeitura) { elLeitura.dataset.tom = 'erro'; elLeitura.textContent = 'Este navegador não consegue enviar por aqui. Use a pasta do álbum no Google Drive, no fim da página.'; }
    return;
  }

  var AMOSTRA = 65536;
  var PARALELO = 3;
  var MAX_FALHAS = 6;
  var MAX_ESPERAS = 5;
  var MESES = ['janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho', 'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro'];
  var RE_DATA = /(19|20)[0-9][0-9]:[01][0-9]:[0-3][0-9] [0-2][0-9]:[0-5][0-9]:[0-5][0-9]/g;

  /** @type {any[]} */
  var itens = [];
  var seq = 0;
  var enviando = false;
  var pausado = false;
  var fatal = '';
  var ativos = 0;
  var parte = D.parte.ini;
  var passe = '';
  /** @type {any} */
  var vooDoPasse = null;
  var tsToken = '';
  /** @type {any} */
  var tsWidget = null;
  /** @type {any[]} */
  var tsEspera = [];
  /** @type {any} */
  var trava = null;
  /** @type {any[]} */
  var amostras = [];
  var bancoOk = false;
  /** @type {any} */
  var banco = null;
  /** @type {any} */
  var guardados = {};

  function txt(el, t) { if (el) el.textContent = t; }
  function msg(el, t, tom) { if (!el) return; el.textContent = t || ''; if (tom) el.dataset.tom = tom; else delete el.dataset.tom; }
  function plural(n, um, varios) { return n + ' ' + (n === 1 ? um : varios); }
  function tamanho(b) {
    if (b >= 1073741824) return (b / 1073741824).toFixed(1).replace('.', ',') + ' GB';
    if (b >= 1048576) return Math.round(b / 1048576) + ' MB';
    return Math.max(1, Math.round(b / 1024)) + ' KB';
  }
  function extensao(nome) { var i = nome.lastIndexOf('.'); return i < 0 ? '' : nome.slice(i + 1).toLowerCase(); }
  function dorme(ms) { return new Promise(function (ok) { setTimeout(ok, ms); }); }

  // ---- IndexedDB: a memória do aparelho (sessões em andamento e o que já foi) ----
  function abreBanco() {
    return new Promise(function (ok) {
      var idb = window.indexedDB;
      if (!idb) { ok(null); return; }
      var pedido;
      try { pedido = idb.open('envio-fotos', 1); } catch (e) { ok(null); return; }
      pedido.onupgradeneeded = function () { pedido.result.createObjectStore('itens', { keyPath: 'k' }); };
      pedido.onsuccess = function () { ok(pedido.result); };
      pedido.onerror = function () { ok(null); };
      pedido.onblocked = function () { ok(null); };
    });
  }
  function leBanco() {
    return new Promise(function (ok) {
      if (!banco) { ok([]); return; }
      try {
        var p = banco.transaction('itens', 'readonly').objectStore('itens').getAll();
        p.onsuccess = function () { ok(p.result || []); };
        p.onerror = function () { ok([]); };
      } catch (e) { ok([]); }
    });
  }
  function gravaBanco(reg) {
    if (!banco) return;
    try { banco.transaction('itens', 'readwrite').objectStore('itens').put(reg); } catch (e) { bancoOk = false; }
  }
  function apagaBanco(k) {
    if (!banco) return;
    try { banco.transaction('itens', 'readwrite').objectStore('itens').delete(k); } catch (e) { bancoOk = false; }
  }
  function chave(it) { return D.slug + '|' + it.fp; }
  function lembra(it, estado) {
    var reg = { k: chave(it), slug: D.slug, fp: it.fp, p: it.destino, nome: it.nome, tam: it.tam, sessao: estado === 'p' ? it.sessao : '', e: estado, q: Date.now() };
    guardados[it.fp] = reg;
    gravaBanco(reg);
  }
  function esquece(it) { delete guardados[it.fp]; apagaBanco(chave(it)); }
  function pendentesGuardados() {
    return Object.keys(guardados).map(function (k) { return guardados[k]; }).filter(function (r) { return r.e === 'p' && r.sessao; });
  }
  function mostraPendentes() {
    var l = pendentesGuardados().filter(function (r) { return !itens.some(function (it) { return it.fp === r.fp; }); });
    if (!elPend) return;
    elPend.hidden = l.length === 0 || enviando;
    if (l.length) txt(elPendTxt, plural(l.length, 'arquivo ficou', 'arquivos ficaram') + ' pela metade neste aparelho. Toque em "Escolher fotos e vídeos" e selecione as mesmas fotos: cada uma continua de onde parou.');
  }

  // ---- Ler os arquivos escolhidos: impressão digital e dia ----
  function leFatia(file, ini, fim) {
    var f = file.slice(ini, fim);
    if (f.arrayBuffer) return f.arrayBuffer();
    return new Promise(function (ok, erro) {
      var r = new FileReader();
      r.onload = function () { ok(r.result); };
      r.onerror = function () { erro(r.error); };
      r.readAsArrayBuffer(f);
    });
  }
  function hex(buf) {
    var b = new Uint8Array(buf), s = '';
    for (var i = 0; i < 16; i++) s += (b[i] < 16 ? '0' : '') + b[i].toString(16);
    return s;
  }
  // A data de captura, procurada no começo do arquivo: o EXIF guarda a data
  // como texto ("2025:06:14 21:03:11"). Serve para JPEG, HEIC e DNG sem um
  // leitor de cada formato. Com mais de uma data, vale a mais antiga (a de
  // quando a foto foi feita; as outras são de edição).
  function dataNoCabecalho(buf) {
    var b = new Uint8Array(buf), s = '';
    for (var i = 0; i < b.length; i += 8192) s += String.fromCharCode.apply(null, b.subarray(i, i + 8192));
    var achadas = s.match(RE_DATA);
    if (!achadas) return 0;
    var menor = 0;
    achadas.forEach(function (d) {
      var n = Number(d.slice(0, 4) + d.slice(5, 7) + d.slice(8, 10));
      var mes = Number(d.slice(5, 7)), dia = Number(d.slice(8, 10));
      if (mes < 1 || mes > 12 || dia < 1 || dia > 31) return;
      if (!menor || n < menor) menor = n;
    });
    return menor;
  }
  function diaDoRelogio(ms) {
    var d = new Date(ms);
    if (isNaN(d.getTime())) return 0;
    return d.getFullYear() * 10000 + (d.getMonth() + 1) * 100 + d.getDate();
  }
  function hoje() { return diaDoRelogio(Date.now()); }
  async function examina(file) {
    var tam = file.size;
    var meio = Math.max(0, Math.floor(tam / 2) - AMOSTRA / 2);
    var cabeca = await leFatia(file, 0, Math.min(tam, AMOSTRA));
    var partes = [cabeca];
    if (tam > AMOSTRA) partes.push(await leFatia(file, meio, Math.min(tam, meio + AMOSTRA)));
    if (tam > AMOSTRA * 2) partes.push(await leFatia(file, Math.max(0, tam - AMOSTRA), tam));
    var total = 16;
    partes.forEach(function (p) { total += p.byteLength; });
    var tudo = new Uint8Array(total);
    // O tamanho entra na conta: dois arquivos de tamanhos diferentes nunca
    // têm a mesma impressão, mesmo com o começo e o fim iguais.
    var cab = String(tam);
    for (var i = 0; i < cab.length && i < 16; i++) tudo[i] = cab.charCodeAt(i);
    var pos = 16;
    partes.forEach(function (p) { tudo.set(new Uint8Array(p), pos); pos += p.byteLength; });
    var fp = hex(await subtle.digest('SHA-256', tudo));
    var ext = extensao(file.name);
    var video = D.videos.indexOf(ext) >= 0;
    var dia = video ? 0 : dataNoCabecalho(cabeca);
    // Sem data dentro do arquivo (vídeo, print, foto que passou por um app):
    // a data do arquivo no aparelho.
    if (!dia || dia > hoje() || dia < 19900101) dia = diaDoRelogio(file.lastModified);
    if (dia > hoje()) dia = 0;
    return { fp: fp, dia: dia, video: video };
  }

  // ---- Sugestão do evento pelo dia da foto ----
  function diaVizinho(a, b) {
    function ms(n) { return Date.UTC(Math.floor(n / 10000), Math.floor(n / 100) % 100 - 1, n % 100); }
    return Math.abs(ms(a) - ms(b)) <= 86400000;
  }
  function capDoDia(dia) {
    if (!dia) return '';
    var exatos = [], perto = [];
    Object.keys(D.dias || {}).forEach(function (cap) {
      var dd = D.dias[cap] || [];
      if (dd.indexOf(dia) >= 0) exatos.push(cap);
      // Festa que passa da meia-noite: o dia seguinte ainda é o mesmo evento.
      else if (dd.some(function (d) { return diaVizinho(d, dia); })) perto.push(cap);
    });
    if (exatos.length === 1) return exatos[0];
    if (!exatos.length && perto.length === 1) return perto[0];
    return '';
  }
  // Devolve o índice em D.destinos, ou -1. Evento com várias pastas (uma por
  // ano ou por banda): a do ano da foto, se o rótulo trouxer o ano; senão a
  // pessoa escolhe.
  function destinoDoCap(cap, dia) {
    var l = [];
    D.destinos.forEach(function (d, i) { if (d.cap === cap) l.push(i); });
    if (l.length === 1) return l[0];
    if (l.length > 1 && dia) {
      var ano = String(Math.floor(dia / 10000));
      var doAno = l.filter(function (i) { return D.destinos[i].rotulo.indexOf(ano) >= 0; });
      if (doAno.length === 1) return doAno[0];
    }
    return -1;
  }
  function indiceDaPasta(p) {
    for (var i = 0; i < D.destinos.length; i++) if (D.destinos[i].p === p) return i;
    return -1;
  }
  function rotuloDoDestino(d) { return d.rotulo ? d.evento + ' · ' + d.rotulo : d.evento; }
  function nomeDoDia(dia) {
    if (!dia) return 'Sem data';
    return (dia % 100) + ' de ' + MESES[Math.floor(dia / 100) % 100 - 1] + ' de ' + Math.floor(dia / 10000);
  }

  // ---- Revisão: um grupo por dia, com o evento de cada um ----
  /** @type {any} */
  var escolhas = {};
  function novos() { return itens.filter(function (it) { return it.estado === 'novo'; }); }
  function desenhaGrupos() {
    var l = novos();
    var porDia = {};
    var ordem = [];
    l.forEach(function (it) {
      var k = String(it.dia);
      if (!porDia[k]) { porDia[k] = []; ordem.push(k); }
      porDia[k].push(it);
    });
    ordem.sort(function (a, b) { return Number(a) - Number(b); });
    while (elGrupos.firstChild) elGrupos.removeChild(elGrupos.firstChild);
    ordem.forEach(function (k) {
      var g = porDia[k];
      var dia = Number(k);
      var fotos = g.filter(function (it) { return !it.video; }).length;
      var videos = g.length - fotos;
      var bytes = 0;
      g.forEach(function (it) { bytes += it.tam; });
      var caixa = document.createElement('div');
      caixa.className = 'ev-grupo';
      var t = document.createElement('p');
      t.className = 'ev-grupo-t';
      t.textContent = nomeDoDia(dia);
      var n = document.createElement('p');
      n.className = 'ev-grupo-n';
      n.textContent = [fotos ? plural(fotos, 'foto', 'fotos') : '', videos ? plural(videos, 'vídeo', 'vídeos') : '', tamanho(bytes)].filter(Boolean).join(' · ');
      var rot = document.createElement('label');
      rot.className = 'ev-campo';
      var s = document.createElement('span');
      s.textContent = 'Evento';
      var sel = document.createElement('select');
      sel.dataset.dia = k;
      var vazio = document.createElement('option');
      vazio.value = '';
      vazio.textContent = 'Escolha o evento…';
      sel.appendChild(vazio);
      D.destinos.forEach(function (d, i) {
        var o = document.createElement('option');
        o.value = String(i);
        o.textContent = rotuloDoDestino(d);
        sel.appendChild(o);
      });
      var sug = document.createElement('p');
      sug.className = 'ev-sug';
      var ja = escolhas[k];
      if (ja === undefined) {
        // 1º o que este aparelho já estava mandando (retomada); 2º o evento de
        // onde a pessoa veio; 3º o dia da foto.
        var retomado = -1;
        g.forEach(function (it) { if (retomado < 0 && guardados[it.fp] && guardados[it.fp].e === 'p') retomado = indiceDaPasta(guardados[it.fp].p); });
        var doLink = D.evento ? destinoDoCap(D.evento, dia) : -1;
        var doDia = destinoDoCap(capDoDia(dia), dia);
        if (retomado >= 0) { ja = retomado; sug.textContent = 'Continuando o envio de antes.'; }
        else if (doLink >= 0) ja = doLink;
        else if (doDia >= 0) { ja = doDia; sug.textContent = 'Sugerido pela data das fotos. Confira.'; }
        else ja = -1;
        escolhas[k] = ja;
      }
      sel.value = ja >= 0 ? String(ja) : '';
      rot.appendChild(s);
      rot.appendChild(sel);
      caixa.appendChild(t);
      caixa.appendChild(n);
      caixa.appendChild(rot);
      caixa.appendChild(sug);
      elGrupos.appendChild(caixa);
    });
    elRevisao.hidden = l.length === 0;
    txt(elEnviar, l.length ? 'Enviar ' + plural(l.length, 'arquivo', 'arquivos') : 'Enviar');
    if (l.length) preparaTurnstile();
  }

  async function recebe(lista) {
    var arquivos = Array.prototype.slice.call(lista || []);
    if (!arquivos.length) return;
    elEscolher.disabled = true;
    var recusados = 0, repetidos = 0, grandes = 0, jaForam = 0;
    for (var i = 0; i < arquivos.length; i++) {
      var f = arquivos[i];
      msg(elLeitura, 'Lendo ' + (i + 1) + ' de ' + arquivos.length + '…');
      if (D.exts.indexOf(extensao(f.name)) < 0 || !f.size) { recusados++; continue; }
      if (f.size > D.maxBytes) { grandes++; continue; }
      var info;
      try { info = await examina(f); } catch (e) { recusados++; continue; }
      if (itens.some(function (it) { return it.fp === info.fp; })) { repetidos++; continue; }
      var it = { id: ++seq, file: f, nome: f.name, tam: f.size, lm: f.lastModified, fp: info.fp, dia: info.dia, video: info.video, destino: '', estado: 'novo', pos: 0, voando: 0, sessao: '', retomar: false, falhas: 0, esperas: 0, reinicios: 0, erro: '', xhr: null };
      var reg = guardados[info.fp];
      if (reg && reg.e === 'p' && reg.sessao && reg.tam === f.size) { it.sessao = reg.sessao; it.retomar = true; }
      if (reg && reg.e === 'f') jaForam++;
      itens.push(it);
    }
    var avisos = [];
    if (repetidos) avisos.push(plural(repetidos, 'repetido ignorado', 'repetidos ignorados'));
    if (recusados) avisos.push(plural(recusados, 'arquivo que não é foto nem vídeo ficou de fora', 'arquivos que não são foto nem vídeo ficaram de fora'));
    if (grandes) avisos.push(plural(grandes, 'arquivo grande demais ficou de fora', 'arquivos grandes demais ficaram de fora') + ' (o limite é ' + tamanho(D.maxBytes) + ')');
    if (jaForam) avisos.push(plural(jaForam, 'já foi enviado deste aparelho', 'já foram enviados deste aparelho') + ' e não vai de novo se continuar no álbum');
    msg(elLeitura, avisos.length ? avisos.join('; ') + '.' : '');
    elEscolher.disabled = false;
    txt(elEscolherTxt, 'Escolher mais');
    elArq.value = '';
    mostraPendentes();
    // Arquivo novo sempre passa pela conferência do evento, mesmo com um envio
    // em andamento: nada sobe para uma pasta que a pessoa não confirmou.
    desenhaGrupos();
  }

  // ---- Turnstile e o passe ----
  var tsEstado = 'fora';
  /** @type {any[]} */
  var tsFila = [];
  function tsFim(ok) {
    if (tsEstado === 'pronto' || tsEstado === 'falhou') return;
    tsEstado = ok ? 'pronto' : 'falhou';
    tsFila.splice(0).forEach(function (fn) { fn(); });
  }
  function comTurnstile(fn) {
    if (tsEstado === 'pronto' || tsEstado === 'falhou') { fn(); return; }
    tsFila.push(fn);
    if (tsEstado !== 'fora') return;
    tsEstado = 'carregando';
    var sc = document.createElement('script');
    sc.src = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit';
    sc.async = true;
    sc.onload = function () { tsFim(typeof window.turnstile !== 'undefined'); };
    sc.onerror = function () { tsFim(false); };
    document.head.appendChild(sc);
  }
  function entregaToken(t) {
    tsToken = t || '';
    if (tsToken) tsEspera.splice(0).forEach(function (fn) { fn(tsToken); });
  }
  function preparaTurnstile() {
    if (passe) return;
    comTurnstile(function () {
      if (typeof window.turnstile === 'undefined' || tsWidget !== null) return;
      tsWidget = window.turnstile.render('#ev-ts', {
        sitekey: D.ts,
        callback: entregaToken,
        'error-callback': function () { tsToken = ''; },
        'expired-callback': function () { tsToken = ''; if (window.turnstile) window.turnstile.reset(tsWidget); },
      });
    });
  }
  // Um token do Turnstile vale para UM pedido de passe. Devolve o que já
  // chegou, ou espera o próximo (com prazo: bloqueador, VPN).
  function tokenDoTurnstile() {
    return new Promise(function (ok, erro) {
      comTurnstile(function () {
        if (typeof window.turnstile === 'undefined') { erro({ tipo: 'ts' }); return; }
        preparaTurnstile();
        if (tsToken) { var t = tsToken; tsToken = ''; ok(t); return; }
        var venceu = setTimeout(function () { erro({ tipo: 'ts' }); }, 30000);
        tsEspera.push(function (t2) { clearTimeout(venceu); tsToken = ''; ok(t2); });
        if (tsWidget !== null) { try { window.turnstile.reset(tsWidget); } catch (e) { /* o widget ainda está chegando */ } }
      });
    });
  }
  function pedePasse() {
    if (vooDoPasse) return vooDoPasse;
    vooDoPasse = tokenDoTurnstile().then(function (t) {
      return api('/api/envio/passe', { slug: D.slug, form_token: D.token, turnstileToken: t, aceite: true, nome: elNome.value, company_website: elHp ? elHp.value : '' });
    }).then(function (r) {
      vooDoPasse = null;
      passe = r.passe || '';
      try { sessionStorage.setItem('envio-passe:' + D.slug, passe); } catch (e) { /* modo privado */ }
      return passe;
    }, function (e) {
      vooDoPasse = null;
      // Marca a origem: recusa do PASSE não é recusa do arquivo (trata()).
      if (e && typeof e === 'object') e.passe = true;
      throw e;
    });
    return vooDoPasse;
  }

  // ---- Falar com o servidor ----
  function api(caminho, corpo) {
    return fetch(caminho, { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json', Accept: 'application/json' }, body: JSON.stringify(corpo) })
      .then(function (r) {
        return r.json().then(function (j) { return j; }, function () { return {}; }).then(function (j) {
          if (r.ok) return j;
          throw { tipo: 'http', status: r.status, corpo: j || {}, espera: Number(r.headers.get('Retry-After')) || 0 };
        });
      }, function () { throw { tipo: 'rede' }; });
  }
  function mandaParte(it, n) {
    return new Promise(function (ok, erro) {
      var x = new window.XMLHttpRequest();
      it.xhr = x;
      x.open('PUT', '/api/envio/parte?pos=' + it.pos);
      x.setRequestHeader('X-Envio-Sessao', it.sessao);
      x.setRequestHeader('Content-Type', 'application/octet-stream');
      x.responseType = 'text';
      // Sem prazo fixo por parte: numa rede lenta ela demora mesmo. O que
      // conta é ficar PARADA — 60 s sem um byte sair, aborta e tenta de novo.
      var parada = setTimeout(function () { x.abort(); }, 60000);
      function mexeu() { clearTimeout(parada); parada = setTimeout(function () { x.abort(); }, 60000); }
      x.upload.onprogress = function (e) { it.voando = e.loaded; mexeu(); pinta(); };
      x.onload = function () {
        clearTimeout(parada);
        it.xhr = null;
        it.voando = 0;
        var j = {};
        try { j = JSON.parse(x.responseText || '{}'); } catch (e) { j = {}; }
        if (x.status >= 200 && x.status < 300) ok(j);
        else erro({ tipo: 'http', status: x.status, corpo: j, espera: Number(x.getResponseHeader('Retry-After')) || 0 });
      };
      x.onerror = x.onabort = x.ontimeout = function () { clearTimeout(parada); it.xhr = null; it.voando = 0; erro({ tipo: 'rede' }); };
      x.send(it.file.slice(it.pos, it.pos + n));
    });
  }

  // ---- A fila ----
  function daFila() { for (var i = 0; i < itens.length; i++) if (itens[i].estado === 'fila') return itens[i]; return null; }
  function bombeia() {
    if (!enviando || pausado || fatal) return;
    while (ativos < PARALELO) {
      var it = daFila();
      if (!it) break;
      ativos++;
      it.estado = 'enviando';
      manda(it).then(saiu, saiu);
    }
    pinta();
  }
  function saiu() { ativos--; bombeia(); if (!ativos) confereFim(); }
  function tamanhoDaParte(it) {
    var resta = it.tam - it.pos;
    if (resta <= parte) return resta;
    return Math.max(D.parte.mult, Math.floor(parte / D.parte.mult) * D.parte.mult);
  }
  function encolhe() { parte = Math.max(D.parte.min, Math.floor(parte / 2)); }
  function cresce() { parte = Math.min(D.parte.max, parte * 2); }
  function terminou(it, estado) {
    it.estado = estado;
    it.pos = it.tam;
    it.voando = 0;
    it.sessao = '';
    lembra(it, 'f');
  }
  // Erro que não adianta repetir (o servidor recusou ESTE arquivo).
  function recusa(it, texto) { it.estado = 'recusado'; it.erro = texto; it.sessao = ''; esquece(it); }
  function para(texto) { fatal = texto; itens.forEach(function (x) { if (x.estado === 'enviando' && x.xhr) x.xhr.abort(); }); }

  async function manda(it) {
    while (it.estado === 'enviando') {
      if (pausado || fatal) { it.estado = 'fila'; return; }
      try {
        if (!passe) await pedePasse();
        if (!it.sessao) {
          // Anota com que passe este pedido saiu: com vários arquivos ao mesmo
          // tempo, um 401 atrasado (passe antigo) não pode jogar fora o passe
          // novo que outro arquivo acabou de pedir (ver trata()).
          var usado = passe;
          var r = await api('/api/envio/inicia', { slug: D.slug, passe: usado, pasta: it.destino, nome: it.nome, tamanho: it.tam, modificado: it.lm, fp: it.fp, assinatura: elNome.value }).catch(function (er) { if (er && typeof er === 'object') er.passeUsado = usado; throw er; });
          if (r.duplicada) { terminou(it, 'duplicada'); return; }
          it.sessao = r.sessao;
          it.pos = 0;
          lembra(it, 'p');
        } else if (it.retomar) {
          var e = await api('/api/envio/estado', { sessao: it.sessao });
          it.retomar = false;
          if (e.feito) { terminou(it, 'feito'); return; }
          it.pos = e.pos || 0;
        }
        while (it.pos < it.tam) {
          if (pausado || fatal) { it.estado = 'fila'; it.retomar = true; return; }
          var t0 = Date.now();
          var n = tamanhoDaParte(it);
          var p = await mandaParte(it, n);
          amostras.push({ t: Date.now(), n: n });
          it.falhas = 0;
          if (p.feito) { terminou(it, 'feito'); return; }
          it.pos = p.pos;
          // Parte que passou depressa: a próxima pode ser maior.
          if (Date.now() - t0 < 4000) cresce();
          pinta();
        }
        // Chegou ao fim sem o "feito" (não deveria): pergunta ao servidor.
        it.retomar = true;
      } catch (e2) {
        if (!(await trata(it, e2))) return;
      }
    }
  }
  // Decide o que fazer com um erro. true = tentar de novo; false = este
  // arquivo parou (o estado dele já foi marcado).
  async function trata(it, e) {
    var st = e && e.status;
    var cod = e && e.corpo && e.corpo.codigo;
    var texto = (e && e.corpo && e.corpo.error) || '';
    if (pausado || fatal) { it.estado = 'fila'; it.retomar = !!it.sessao; return false; }
    if (e && e.tipo === 'ts') { para('A verificação de segurança não carregou (um bloqueador de anúncios ou VPN pode estar impedindo). Desative para este site e toque em "Tentar de novo", ou mande pela pasta do álbum no Google Drive.'); it.estado = 'fila'; return false; }
    // O passe foi recusado (página aberta tempo demais, verificação que não
    // passou, nome do crédito recusado): o problema é de TODOS os arquivos, e
    // a frase do servidor diz o que fazer. Antes cada arquivo virava "não pôde
    // ser aceito", sem motivo nenhum (achado pelo verifica:envio).
    if (e && e.passe && st >= 400 && st < 500 && st !== 429) { para(texto || 'A verificação de segurança não passou. Recarregue a página e tente de novo.'); it.estado = 'fila'; return false; }
    if (st === 401 && cod === 'passe') {
      if (!e.passeUsado || e.passeUsado === passe) passe = '';
      it.reinicios++;
      if (it.reinicios > 3) { it.estado = 'erro'; it.erro = 'A verificação de segurança não passou.'; return false; }
      return true;
    }
    if (st === 409 && typeof e.corpo.pos === 'number') { it.pos = e.corpo.pos; it.falhas++; if (it.falhas > MAX_FALHAS) { it.estado = 'erro'; it.erro = 'O envio se perdeu no caminho.'; return false; } return true; }
    if (st === 410) {
      // A sessão venceu (uma semana) ou foi encerrada: começa este arquivo de novo.
      it.sessao = ''; it.pos = 0; it.retomar = false; esquece(it);
      it.reinicios++;
      if (it.reinicios > 2) { it.estado = 'erro'; it.erro = 'Não foi possível retomar este arquivo.'; return false; }
      return true;
    }
    if (st === 507 || cod === 'cheio') { para('O álbum está sem espaço para receber fotos agora. Já avisamos quem cuida dele; tente de novo mais tarde.'); it.estado = 'fila'; it.retomar = !!it.sessao; return false; }
    if (cod === 'desligado' || cod === 'credencial' || cod === 'pasta' || st === 404) { para(texto || 'O envio pelo site está fora do ar agora. Use a pasta do álbum no Google Drive, no fim da página.'); it.estado = 'fila'; it.retomar = !!it.sessao; return false; }
    if (cod === 'teto') { para(texto || 'O álbum já recebeu o limite de fotos de hoje. Tente de novo amanhã: o que já foi enviado está guardado.'); it.estado = 'fila'; it.retomar = !!it.sessao; return false; }
    if (st === 429 || st === 503) {
      it.esperas++;
      if (it.esperas > MAX_ESPERAS) { it.estado = 'erro'; it.erro = texto || 'O servidor está ocupado.'; it.retomar = !!it.sessao; return false; }
      await dorme(Math.min(120, Math.max(3, e.espera || 5)) * 1000);
      it.retomar = !!it.sessao;
      return true;
    }
    if (st >= 400 && st < 500) { recusa(it, texto || 'O site não aceitou este arquivo.'); return false; }
    // Rede (ou 5xx sem aviso): a parte encolhe, espera crescente, e pergunta ao
    // servidor onde parou. Com TETO: depois dele o arquivo espera a rede voltar.
    it.falhas++;
    encolhe();
    it.retomar = !!it.sessao;
    if (it.falhas > MAX_FALHAS || navigator.onLine === false) { it.estado = 'erro'; it.erro = 'A internet falhou.'; return false; }
    await dorme(Math.min(30, Math.pow(2, it.falhas)) * 1000);
    return true;
  }

  function enfileiraNovos() {
    var faltou = false;
    novos().forEach(function (it) {
      var esc = escolhas[String(it.dia)];
      if (esc === undefined || esc < 0 || !D.destinos[esc]) { faltou = true; return; }
      it.destino = D.destinos[esc].p;
      // Retomada só vale para a mesma pasta de antes.
      var reg = guardados[it.fp];
      if (it.sessao && reg && reg.p !== it.destino) { it.sessao = ''; it.retomar = false; }
      it.estado = 'fila';
    });
    return !faltou;
  }

  function comeca() {
    msg(elRevMsg, '');
    var sels = elGrupos.querySelectorAll('select');
    var primeiroVazio = null;
    for (var i = 0; i < sels.length; i++) {
      var v = sels[i].value;
      escolhas[sels[i].dataset.dia] = v === '' ? -1 : Number(v);
      if (v === '') { sels[i].setAttribute('aria-invalid', 'true'); if (!primeiroVazio) primeiroVazio = sels[i]; } else sels[i].removeAttribute('aria-invalid');
    }
    if (primeiroVazio) { msg(elRevMsg, 'Escolha o evento de cada dia.', 'erro'); primeiroVazio.focus(); return; }
    var nome = elNome.value.replace(/ +/g, ' ').trim();
    elNome.value = nome;
    if (nome && nome.length < 2) { elNome.setAttribute('aria-invalid', 'true'); msg(elRevMsg, 'Escreva o nome completo, ou deixe em branco.', 'erro'); elNome.focus(); return; }
    elNome.removeAttribute('aria-invalid');
    if (!elAceite.checked) { msg(elRevMsg, 'Marque a caixa para confirmar que pode publicar essas fotos.', 'erro'); elAceite.focus(); return; }
    try { localStorage.setItem('envio-nome', nome); } catch (e) { /* modo privado */ }
    enfileiraNovos();
    enviando = true;
    pausado = false;
    fatal = '';
    elRevisao.hidden = true;
    elAnd.hidden = false;
    if (elPend) elPend.hidden = true;
    elAndT.focus();
    acende();
    bombeia();
  }

  // ---- Desenho do andamento ----
  var desenhoMarcado = false;
  function pinta() {
    if (desenhoMarcado) return;
    desenhoMarcado = true;
    setTimeout(function () { desenhoMarcado = false; desenha(); }, 250);
  }
  function velocidade() {
    var agora = Date.now();
    amostras = amostras.filter(function (a) { return agora - a.t < 20000; });
    if (amostras.length < 2) return 0;
    var bytes = 0;
    amostras.forEach(function (a) { bytes += a.n; });
    return bytes / ((agora - amostras[0].t) / 1000 || 1);
  }
  function linha(lista, nome, valor, tom) {
    var li = document.createElement('li');
    if (tom) li.dataset.tom = tom;
    var b = document.createElement('b');
    b.textContent = nome;
    var s = document.createElement('span');
    s.textContent = valor;
    li.appendChild(b);
    li.appendChild(s);
    lista.appendChild(li);
  }
  function desenha() {
    if (!enviando) return;
    var total = 0, feitoB = 0, n = 0, feitos = 0, dups = 0, erros = 0, recusados = 0, fila = 0;
    itens.forEach(function (it) {
      if (it.estado === 'novo') return;
      n++;
      if (it.estado === 'duplicada') { dups++; return; }
      if (it.estado === 'recusado') { recusados++; return; }
      total += it.tam;
      feitoB += Math.min(it.tam, it.pos + (it.voando || 0));
      if (it.estado === 'feito') feitos++;
      else if (it.estado === 'erro') erros++;
      else fila++;
    });
    var resolvidos = feitos + dups;
    txt(elNum, resolvidos + ' de ' + n + (n === 1 ? ' arquivo' : ' arquivos'));
    elBarra.value = total ? Math.round(feitoB / total * 1000) : (n ? 1000 : 0);
    var det = [tamanho(feitoB) + ' de ' + tamanho(total)];
    var v = velocidade();
    if (v > 0 && fila && !pausado && !fatal) {
      var s = (total - feitoB) / v;
      det.push(s < 90 ? 'falta menos de 2 min' : 'faltam uns ' + (s < 5400 ? Math.round(s / 60) + ' min' : Math.round(s / 3600) + ' h'));
    }
    if (dups) det.push(plural(dups, 'já estava no álbum', 'já estavam no álbum'));
    txt(elDet, det.join(' · '));
    while (elAgora.firstChild) elAgora.removeChild(elAgora.firstChild);
    itens.forEach(function (it) {
      if (it.estado === 'enviando') linha(elAgora, it.nome, Math.floor(Math.min(it.tam, it.pos + (it.voando || 0)) / it.tam * 100) + '%', '');
    });
    while (elProblemas.firstChild) elProblemas.removeChild(elProblemas.firstChild);
    var mostrados = 0;
    itens.forEach(function (it) {
      if ((it.estado === 'erro' || it.estado === 'recusado') && mostrados < 20) { mostrados++; linha(elProblemas, it.nome, it.erro || 'não foi', 'erro'); }
    });
    var acabou = !fila && !ativos;
    if (fatal) msg(elEstado, fatal, 'erro');
    else if (pausado) msg(elEstado, 'Pausado. Toque em Continuar quando quiser.');
    else if (acabou && !erros && !recusados) msg(elEstado, 'Pronto! Tudo enviado. As fotos aparecem no álbum em alguns minutos.', 'ok');
    else if (acabou && erros) msg(elEstado, plural(erros, 'arquivo não foi', 'arquivos não foram') + '. Toque em "Tentar de novo": o que já subiu não se perde.', 'erro');
    else if (acabou) msg(elEstado, 'Pronto. ' + plural(recusados, 'arquivo não pôde ser aceito', 'arquivos não puderam ser aceitos') + '.', recusados === n ? 'erro' : 'ok');
    else if (navigator.onLine === false) msg(elEstado, 'Sem internet. O envio continua sozinho quando a conexão voltar.');
    else msg(elEstado, 'Enviando…');
    elPausar.hidden = acabou || !!fatal;
    txt(elPausar, pausado ? 'Continuar' : 'Pausar');
    elRepetir.hidden = !(erros || fatal);
    elVer.hidden = !acabou;
    elDica.hidden = acabou;
  }
  function confereFim() {
    desenha();
    var resta = itens.some(function (it) { return it.estado === 'fila' || it.estado === 'enviando'; });
    if (!resta) apaga();
  }

  // ---- Tela acesa enquanto envia, e acordar quando a página ou a rede voltam ----
  function acende() {
    var w = navigator.wakeLock;
    if (!w || trava || document.visibilityState !== 'visible') return;
    w.request('screen').then(function (t) {
      trava = t;
      t.addEventListener('release', function () { trava = null; });
    }, function () { /* bateria fraca, modo economia: segue sem */ });
  }
  function apaga() { if (trava) { try { trava.release(); } catch (e) { /* já solta */ } trava = null; } }
  function acorda() {
    if (!enviando || pausado) return;
    var mexeu = false;
    itens.forEach(function (it) {
      if (it.estado === 'erro') { it.estado = 'fila'; it.falhas = 0; it.esperas = 0; it.erro = ''; it.retomar = !!it.sessao; mexeu = true; }
    });
    if (mexeu || daFila()) { acende(); bombeia(); }
  }
  window.addEventListener('online', function () { if (!fatal) acorda(); pinta(); });
  window.addEventListener('offline', pinta);
  document.addEventListener('visibilitychange', function () {
    if (document.visibilityState === 'visible') { if (!fatal) acorda(); if (enviando && !pausado) acende(); pinta(); }
  });
  window.addEventListener('beforeunload', function (e) {
    if (!itens.some(function (it) { return it.estado === 'fila' || it.estado === 'enviando'; })) return;
    e.preventDefault();
    e.returnValue = '';
  });

  // ---- Cliques ----
  raiz.addEventListener('click', function (e) {
    var b = e.target.closest('[data-acao]');
    if (!b) return;
    var acao = b.dataset.acao;
    if (acao === 'escolher') elArq.click();
    else if (acao === 'enviar') comeca();
    else if (acao === 'pausar') {
      pausado = !pausado;
      if (pausado) { itens.forEach(function (it) { if (it.xhr) it.xhr.abort(); }); apaga(); }
      else { acende(); bombeia(); }
      desenha();
    } else if (acao === 'repetir') {
      fatal = '';
      pausado = false;
      acorda();
      bombeia();
      desenha();
    } else if (acao === 'esquecer') {
      pendentesGuardados().forEach(function (r) { delete guardados[r.fp]; apagaBanco(r.k); });
      mostraPendentes();
    }
  });
  elArq.addEventListener('change', function () { recebe(elArq.files); });
  elGrupos.addEventListener('change', function (e) {
    var s = /** @type {HTMLSelectElement} */ (e.target);
    if (!s || !s.dataset || s.dataset.dia === undefined) return;
    escolhas[s.dataset.dia] = s.value === '' ? -1 : Number(s.value);
    s.removeAttribute('aria-invalid');
  });

  // ---- Partida ----
  try { elNome.value = localStorage.getItem('envio-nome') || ''; } catch (e) { /* modo privado */ }
  try { passe = sessionStorage.getItem('envio-passe:' + D.slug) || ''; } catch (e) { passe = ''; }
  abreBanco().then(function (b) {
    banco = b;
    bancoOk = !!b;
    return leBanco();
  }).then(function (regs) {
    var agora = Date.now();
    regs.forEach(function (r) {
      if (!r || r.slug !== D.slug) return;
      // A sessão do Google dura uma semana; a nossa, seis dias. "Já enviado"
      // fica 30 dias (depois disso quem responde é a pasta do evento).
      var velho = r.e === 'p' ? agora - r.q > 6 * 86400000 : agora - r.q > 30 * 86400000;
      if (velho) { apagaBanco(r.k); return; }
      guardados[r.fp] = r;
    });
    mostraPendentes();
    elEscolher.disabled = false;
    if (!bancoOk) txt(elDica, 'Deixe esta página aberta até terminar. Se a internet cair, o envio continua de onde parou quando ela voltar.');
  });
})();
`;
