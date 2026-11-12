// Aviso para o navegador EMBUTIDO de um aplicativo (v3.11.0, item A3 do plano
// de lançamento): quem abre o álbum por um link no Instagram, no Facebook, no
// TikTok… cai no navegador de dentro do app. Ali o download de foto e o aviso
// de foto nova (push) costumam falhar em SILÊNCIO — o toque não faz nada, e a
// pessoa acha que o site está quebrado.
//
// O que este componente faz, e o que não faz:
//  - detecta pelo user agent (EMBUTIDO_FONTE). Não há API para isso; o user
//    agent é o único sinal, e cada app põe o seu nome nele. O WhatsApp NÃO
//    entra: ele abre links no navegador de verdade (Safari / Chrome Custom
//    Tabs), onde baixar funciona. Não verificado em aparelho real;
//  - mostra a faixa SÓ quando a pessoa tenta baixar ou ligar os avisos (um
//    ouvinte de clique em captura, no documento). Olhar as fotos funciona no
//    navegador embutido, e uma faixa logo na entrada atrapalharia a maioria;
//  - NÃO bloqueia a ação: às vezes o download funciona, e a faixa só explica
//    o que fazer se não funcionar;
//  - oferece "Copiar o link" e, no Android, "Abrir no Chrome" (um link
//    `intent://`, que o Android entrega ao Chrome). Só para os apps
//    conhecidos: uma WebView genérica pode não tratar `intent://` e trocaria
//    o álbum por uma página de erro. Sem o Chrome instalado, o
//    `S.browser_fallback_url` traz de volta a mesma página. O `#fragmento`
//    se perde (o `#` do intent é dele). No iPhone não existe link que tire a
//    pessoa do app: a faixa diz o caminho (⋯ → Abrir no navegador);
//  - sem aviso de foto nova possível (sem PushManager), o SCRIPT_AVISO de
//    src/ui/indice-comum.js diz para abrir no navegador, em vez de esconder;
//  - fechada, não volta nesta aba (sessionStorage).
//
// Um lugar só para as três páginas do álbum — a apresentação e o índice
// (src/ui/galeria-indice.js) e a página do evento (src/ui/galeria.js): o script não depende do estilo da página, e o CSS usa
// cores próprias, legíveis sobre qualquer um dos três.
//
// O script mora numa template string: sem crase, sem dólar-chave e sem barra
// invertida dentro dele.

import { escape } from '../utils.js';

/**
 * Os nomes que os apps põem no user agent do navegador embutido. `; wv[)]` é
 * a WebView genérica do Android (outros apps). Sem barra invertida: a mesma
 * fonte vira RegExp no servidor (testes) e no navegador.
 */
export const EMBUTIDO_FONTE = 'Instagram|FBAN|FBAV|FB_IAB|FBIOS|musical_ly|BytedanceWebview|TikTok|Snapchat|LinkedInApp|Line/|; wv[)]';

/**
 * O nome do app para a frase, ou '' se não for navegador embutido.
 * @param {string} ua
 */
export function navegadorEmbutido(ua) {
  const u = String(ua || '');
  if (!new RegExp(EMBUTIDO_FONTE).test(u)) return '';
  if (/Instagram/.test(u)) return 'Instagram';
  if (/FBAN|FBAV|FB_IAB|FBIOS/.test(u)) return 'Facebook';
  if (/musical_ly|BytedanceWebview|TikTok/.test(u)) return 'TikTok';
  if (/Snapchat/.test(u)) return 'Snapchat';
  if (/LinkedInApp/.test(u)) return 'LinkedIn';
  if (/Line\//.test(u)) return 'LINE';
  return 'deste aplicativo';
}

export const EMBUTIDO_CSS = `.nav-emb{position:fixed;left:0;right:0;bottom:0;z-index:100020;background:#141414;color:#f0ebe5;border-top:2px solid #f9de4b;padding:.9rem 1rem calc(.9rem + env(safe-area-inset-bottom));box-shadow:0 -10px 40px rgba(0,0,0,.45);font:15px/1.45 system-ui,-apple-system,'Segoe UI',sans-serif}
.nav-emb[hidden],.nav-emb [hidden]{display:none}
.nav-emb p{margin:0 0 .7rem;max-width:40rem}
.nav-emb b{color:#f9de4b}
.nav-emb-acoes{display:flex;flex-wrap:wrap;gap:.5rem}
.nav-emb button,.nav-emb a{display:inline-flex;align-items:center;justify-content:center;min-height:44px;padding:0 1rem;border-radius:999px;border:1px solid #f9de4b;background:transparent;color:#f9de4b;font:inherit;font-weight:700;text-decoration:none;cursor:pointer}
.nav-emb .nav-emb-1{background:#f9de4b;color:#0a0a0a}
.nav-emb button:focus-visible,.nav-emb a:focus-visible{outline:2px solid #fff;outline-offset:2px}`;

/** A faixa (escondida até a pessoa tentar baixar ou ligar os avisos). */
export function embutidoHTML() {
  return `<div class="nav-emb" id="nav-emb" hidden role="region" aria-labelledby="nav-emb-txt">
  <p id="nav-emb-txt"></p>
  <div class="nav-emb-acoes">
    <a class="nav-emb-1" id="nav-emb-abrir" href="#" hidden>Abrir no Chrome</a>
    <button type="button" id="nav-emb-copiar">Copiar o link</button>
    <button type="button" id="nav-emb-fechar">Fechar</button>
  </div>
</div>`;
}

export const SCRIPT_EMBUTIDO = `(function () {
  var ua = navigator.userAgent || '';
  if (!new RegExp(${JSON.stringify(EMBUTIDO_FONTE)}).test(ua)) return;
  var faixa = document.getElementById('nav-emb');
  if (!faixa) return;
  var txt = document.getElementById('nav-emb-txt');
  var abrir = document.getElementById('nav-emb-abrir');
  var copiar = document.getElementById('nav-emb-copiar');
  var fechar = document.getElementById('nav-emb-fechar');
  var app = /Instagram/.test(ua) ? 'do Instagram' : /FBAN|FBAV|FB_IAB|FBIOS/.test(ua) ? 'do Facebook' : /musical_ly|BytedanceWebview|TikTok/.test(ua) ? 'do TikTok' : /Snapchat/.test(ua) ? 'do Snapchat' : /LinkedInApp/.test(ua) ? 'do LinkedIn' : /Line[/]/.test(ua) ? 'do LINE' : 'de um aplicativo';
  var conhecido = app !== 'de um aplicativo';
  var android = /Android/.test(ua);
  var CHAVE = 'nav-emb-fechado';
  var mostrou = false;
  try { if (sessionStorage.getItem(CHAVE)) return; } catch (e) { /* modo privado: mostra */ }
  function mostra() {
    if (mostrou) return;
    mostrou = true;
    txt.textContent = '';
    var b = document.createElement('b');
    b.textContent = 'Você está no navegador ' + app + '.';
    txt.appendChild(b);
    txt.appendChild(document.createTextNode(android && conhecido
      ? ' Aqui, baixar fotos e receber avisos pode não funcionar. Abra o álbum no Chrome:'
      : android
      ? ' Aqui, baixar fotos e receber avisos pode não funcionar. Copie o link e abra no Chrome.'
      : ' Aqui, baixar fotos e receber avisos pode não funcionar. Toque nos três pontinhos (no canto da tela) e escolha "Abrir no navegador", ou copie o link e cole no Safari.'));
    if (android && conhecido) {
      abrir.href = 'intent://' + location.host + location.pathname + location.search + '#Intent;scheme=https;package=com.android.chrome;S.browser_fallback_url=' + encodeURIComponent(location.origin + location.pathname + location.search) + ';end';
      abrir.hidden = false;
    }
    faixa.hidden = false;
  }
  // Em captura: vê o toque antes do script da página, sem impedir a ação.
  document.addEventListener('click', function (e) {
    var t = e.target && e.target.closest ? e.target.closest('[data-acao^="baixar"], #g-folha-ops a, #g-folha-ops button, [data-vz="baixar"], #rs-cartao-baixar, #av-btn, a[download]') : null;
    if (t && !faixa.contains(t)) mostra();
  }, true);
  copiar.addEventListener('click', function () {
    var url = location.href;
    function ok() { copiar.textContent = 'Link copiado'; }
    if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(url).then(ok, function () { window.prompt('Copie o link:', url); });
    else window.prompt('Copie o link:', url);
  });
  fechar.addEventListener('click', function () {
    faixa.hidden = true;
    try { sessionStorage.setItem(CHAVE, '1'); } catch (e) { /* modo privado */ }
  });
})();`;

/**
 * Tudo o que uma página do álbum inclui: o CSS, a faixa e o script.
 * @param {string} nonce
 */
export function navegadorEmbutidoHTML(nonce) {
  return `<style>${EMBUTIDO_CSS}</style>
  ${embutidoHTML()}
  <script nonce="${escape(nonce)}">${SCRIPT_EMBUTIDO}</script>`;
}
