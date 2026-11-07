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
 * @param {{ titulo: string, linha: string, assinatura?: string, contagem?: string, nonce?: string }} p
 *   `contagem`: o ISO do lançamento marcado, só quando o dono quer mostrar
 */
export function emBreveHTML({ titulo, linha, assinatura = '', contagem = '', nonce = '' }) {
  const quando = contagem && nonce && Date.parse(contagem) > Date.now() ? dataDoLancamento(contagem) : '';
  return `<!DOCTYPE html>
<html lang="pt-BR">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0, viewport-fit=cover">
<meta name="robots" content="noindex">
<meta name="theme-color" content="#16204d">
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
html,body{height:100%}
body{background:radial-gradient(ellipse at 50% -10%,#2b3f94 0%,#1a2560 38%,#0d1230 80%);color:#f3ede3;font-family:'Open Sans',system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;display:flex;align-items:center;justify-content:center;padding:24px;text-align:center}
main{max-width:34rem}
.k{font-size:.75rem;font-weight:600;letter-spacing:.22em;text-transform:uppercase;color:#f9de4b;line-height:1.7}
h1{font-family:'Open Sans',system-ui,sans-serif;font-weight:800;font-size:clamp(3.4rem,15vw,7rem);line-height:.95;letter-spacing:-.02em;margin:.6rem 0 1.2rem}
p{font-size:clamp(1.02rem,2.6vw,1.2rem);line-height:1.6;color:#d6dbef}
.l{display:block;width:3rem;height:2px;background:#f9de4b;margin:1.8rem auto 0;border-radius:2px}
small{display:block;margin-top:1.2rem;font-size:.85rem;color:#aab3d6}
.q{margin-top:1.4rem;font-weight:600;color:#f9de4b}
.c{display:flex;justify-content:center;gap:.9rem;margin-top:.7rem;font-variant-numeric:tabular-nums}
.c span{display:flex;flex-direction:column;align-items:center;min-width:3.4rem}
.c b{font-size:clamp(1.8rem,7vw,2.6rem);font-weight:800;line-height:1.1}
.c i{font-style:normal;font-size:.7rem;letter-spacing:.14em;text-transform:uppercase;color:#aab3d6}
</style>
</head>
<body>
<main>
<span class="k">${escape(linha)}</span>
<h1>${escape(titulo)}</h1>
<p>O álbum da turma está chegando: as fotos de todos os eventos, num lugar só.</p>
${quando ? `<p class="q">Chega em ${escape(quando)}.</p>
<div class="c" id="c" data-ate="${escape(new Date(Date.parse(contagem)).toISOString())}" aria-hidden="true"><span><b id="c-d">–</b><i>dias</i></span><span><b id="c-h">–</b><i>horas</i></span><span><b id="c-m">–</b><i>min</i></span><span><b id="c-s">–</b><i>seg</i></span></div>` : ''}
<span class="l" aria-hidden="true"></span>
<small>${assinatura ? `${escape(assinatura)} · ` : ''}Volte em breve.</small>
</main>
${quando ? `<script nonce="${escape(nonce)}">${SCRIPT_CONTAGEM}</script>` : ''}
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

// O favicon do álbum com domínio próprio: "EN" em amarelo sobre o azul do
// Colégio Santa Cruz. Servido em /icon-entrenos.svg.
export const ICONE_ALBUM_SVG = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><rect width="64" height="64" rx="14" fill="#243580"/><text x="32" y="43" text-anchor="middle" font-family="Georgia,\'Times New Roman\',serif" font-weight="700" font-size="30" fill="#f9de4b">EN</text></svg>';

