// Página "em breve" de um domínio de álbum (entrenos2026.com) enquanto o
// projeto ainda não existe ou está oculto. Sem foto (o domínio pode estar no
// ar antes de alguém decidir o que mostrar) e sem nada de fora: só texto. O
// único script é o da contagem regressiva (v3.5), que só existe quando o dono
// marcou o lançamento E ligou "Mostrar contagem" — senão a página não diz
// quando o álbum chega. A mesma página vai, como Worker à parte, no prompt do Cowork, para o
// domínio ter algo no ar antes do merge.

import { escape, fontFaceAlbumCSS } from '../utils.js';

/**
 * "20 de novembro, às 20h" (ou "às 20h30"), no horário de Brasília.
 * @param {string} iso
 */
export function dataDoLancamento(iso) {
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return '';
  const p = Object.fromEntries(new Intl.DateTimeFormat('pt-BR', {
    timeZone: 'America/Sao_Paulo', day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
  }).formatToParts(new Date(t)).map(x => [x.type, x.value]));
  return `${p.day} de ${p.month}, às ${Number(p.hour)}h${p.minute === '00' ? '' : p.minute}`;
}

/**
 * @param {{ titulo: string, linha: string, assinatura?: string, contagem?: string, nonce?: string, slug?: string, previa?: boolean }} p
 *   `contagem`: o ISO do lançamento marcado, só quando o dono quer mostrar;
 *   `previa`: o projeto tem senha de prévia (o easter egg: 5 toques no título)
 */
export function emBreveHTML({ titulo, linha, assinatura = '', contagem = '', nonce = '', slug = '', previa = false }) {
  const comPrevia = !!(previa && nonce && slug);
  const quando = contagem && nonce && Date.parse(contagem) > Date.now() ? dataDoLancamento(contagem) : '';
  return `<!DOCTYPE html>
<html lang="pt-BR">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0, viewport-fit=cover">
<meta name="robots" content="noindex">
<meta name="theme-color" content="#243580">
<meta name="color-scheme" content="dark">
<title>${escape(titulo)} · em breve</title>
<link rel="icon" type="image/svg+xml" href="/icon-entrenos.svg">
<meta property="og:type" content="website">
<meta property="og:title" content="${escape(titulo)}">
<meta property="og:description" content="${escape(linha)} — o álbum de fotos da turma está chegando.">
<meta property="og:image" content="/og-entrenos.jpg">
<meta property="og:image:width" content="1200">
<meta property="og:image:height" content="630">
<meta name="twitter:card" content="summary_large_image">
<style>
${fontFaceAlbumCSS()}
*,*::before,*::after{box-sizing:border-box;margin:0;padding:0}
:root{color-scheme:dark}
html,body{height:100%}
body{background:#243580;color:#f3ede3;font-family:'Open Sans',system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;-webkit-font-smoothing:antialiased;-webkit-text-size-adjust:100%;display:flex;align-items:center;justify-content:center;padding:24px;text-align:center}
main{max-width:34rem;animation:eb-entra .4s cubic-bezier(.22,1,.36,1) both}
@keyframes eb-entra{from{opacity:0;transform:translateY(8px)}to{opacity:1;transform:none}}
::selection{background:#f9de4b;color:#16204d}
:focus-visible{outline:2px solid #f9de4b;outline-offset:3px}
.k{display:block;font-size:.9375rem;font-weight:400;line-height:1.5;color:#d6dbef}
h1{font-family:'Open Sans',system-ui,sans-serif;font-weight:600;font-size:clamp(2.5rem,10vw,4.5rem);line-height:1.08;letter-spacing:-.025em;margin:.5rem 0 1rem;text-wrap:balance}
p{font-size:clamp(1rem,2.6vw,1.125rem);line-height:1.6;color:#d6dbef}
.l{display:block;width:3rem;height:2px;background:#f9de4b;margin:1.75rem auto 0;border-radius:2px}
small{display:block;margin-top:1rem;font-size:.875rem;line-height:1.5;color:#c3cbe8}
.q{margin-top:1.5rem;font-weight:600;color:#f3ede3}
.c{display:flex;justify-content:center;gap:1rem;margin-top:.75rem;font-variant-numeric:tabular-nums}
.c span{display:flex;flex-direction:column;align-items:center;min-width:3.5rem}
.c b{font-size:clamp(1.75rem,7vw,2.5rem);font-weight:600;line-height:1.1}
.c i{font-style:normal;font-size:.75rem;line-height:1.5;color:#c3cbe8}
h1{-webkit-user-select:none;user-select:none;-webkit-tap-highlight-color:transparent}
.pv{display:flex;flex-wrap:wrap;justify-content:center;gap:.5rem;margin-top:1.5rem}
.pv[hidden]{display:none}
.pv input{min-height:44px;width:min(16rem,100%);padding:0 1rem;border-radius:999px;border:1px solid rgba(243,237,227,.24);background:rgba(10,14,40,.4);color:#f3ede3;font:inherit;text-align:center;transition:border-color .15s cubic-bezier(.22,1,.36,1)}
.pv input:focus{border-color:#f9de4b}
.pv button{min-height:44px;padding:0 1.25rem;border-radius:999px;border:0;background:#f9de4b;color:#16204d;font:inherit;font-weight:600;cursor:pointer;transition:transform .15s cubic-bezier(.22,1,.36,1)}
.pv button:active{transform:scale(.97)}
.pv p{flex-basis:100%;min-height:1.25em;font-size:.875rem;color:#d6dbef}
@media (prefers-reduced-motion:reduce){*,*::before,*::after{animation:none!important;transition-duration:.01ms!important}}
</style>
</head>
<body>
<main>
<span class="k">${escape(linha)}</span>
<h1>${escape(titulo)}</h1>
<p>O álbum da turma está chegando: as fotos de todos os eventos, num lugar só.</p>
${quando ? `<p class="q">Chega em ${escape(quando)}.</p>
<div class="c" id="c" data-ate="${escape(new Date(Date.parse(contagem)).toISOString())}" aria-hidden="true"><span><b id="c-d">–</b><i>dias</i></span><span><b id="c-h">–</b><i>horas</i></span><span><b id="c-m">–</b><i>min</i></span><span><b id="c-s">–</b><i>seg</i></span></div>` : ''}
${comPrevia ? `<form class="pv" id="pv" data-slug="${escape(slug)}" hidden><input type="password" id="pv-senha" autocomplete="current-password" placeholder="Senha" aria-label="Senha da prévia" maxlength="100"><button type="submit">Entrar</button><p id="pv-msg" role="status"></p></form>` : ''}
<span class="l" aria-hidden="true"></span>
<small>${assinatura ? `${escape(assinatura)} · ` : ''}Volte em breve</small>
</main>
${quando ? `<script nonce="${escape(nonce)}">${SCRIPT_CONTAGEM}</script>` : ''}
${comPrevia ? `<script nonce="${escape(nonce)}">${SCRIPT_PREVIA}</script>` : ''}
</body>
</html>`;
}

// A contagem: um tique por segundo; na hora, recarrega (o servidor já manda
// para a galeria). Fora de crase, dollar-chave e barra invertida: JS dentro
// de template literal.
export const SCRIPT_CONTAGEM = `(function () {
  var c = document.getElementById('c');
  if (!c) return;
  var ate = Date.parse(c.getAttribute('data-ate'));
  var campos = ['c-d', 'c-h', 'c-m', 'c-s'].map(function (id) { return document.getElementById(id); });
  var dois = function (n) { return n < 10 ? '0' + n : String(n); };
  var tentativas = 0;
  function tique() {
    var falta = Math.max(0, ate - Date.now());
    var s = Math.floor(falta / 1000);
    var v = [Math.floor(s / 86400), Math.floor(s / 3600) % 24, Math.floor(s / 60) % 60, s % 60];
    campos.forEach(function (el, i) { if (el) el.textContent = i === 0 ? String(v[0]) : dois(v[i]); });
    if (falta > 0) { setTimeout(tique, 1000 - (Date.now() % 1000)); return; }
    if (tentativas++ < 12) setTimeout(function () { location.reload(); }, 2000 + tentativas * 3000);
  }
  tique();
})();`;

// O easter egg (v3.7): 5 toques no título em até 4 s mostram o campo de senha.
// Senha certa: o servidor manda o cookie da prévia e o endereço da galeria.
// Fora de crase, dollar-chave e barra invertida: JS dentro de template literal.
export const SCRIPT_PREVIA = `(function () {
  var f = document.getElementById('pv');
  var h = document.querySelector('h1');
  if (!f || !h || !window.fetch) return;
  var toques = [];
  h.addEventListener('click', function () {
    var agora = Date.now();
    toques = toques.filter(function (t) { return agora - t < 4000; });
    toques.push(agora);
    if (toques.length >= 5 && f.hidden) { f.hidden = false; document.getElementById('pv-senha').focus(); }
  });
  f.addEventListener('submit', function (e) {
    e.preventDefault();
    var senha = document.getElementById('pv-senha').value;
    var msg = document.getElementById('pv-msg');
    var b = f.querySelector('button');
    if (!senha || b.disabled) return;
    b.disabled = true;
    msg.textContent = '';
    fetch('/api/previa', { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ slug: f.getAttribute('data-slug'), senha: senha }) })
      .then(function (r) { return r.json().catch(function () { return {}; }).then(function (j) { if (!r.ok) throw new Error(j.error || 'Não deu. Tente de novo.'); return j; }); })
      .then(function (j) { msg.textContent = 'Entrando…'; location.href = j.url; })
      .catch(function (err) { msg.textContent = err.message; b.disabled = false; });
  });
})();`;

// O favicon do álbum com domínio próprio: "EN" em amarelo sobre o azul do
// Colégio Santa Cruz. Servido em /icon-entrenos.svg.
export const ICONE_ALBUM_SVG = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><rect width="64" height="64" rx="14" fill="#243580"/><text x="32" y="43" text-anchor="middle" font-family="Georgia,\'Times New Roman\',serif" font-weight="700" font-size="30" fill="#f9de4b">EN</text></svg>';

