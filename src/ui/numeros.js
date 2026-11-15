// "Turma em números" (v3.9.1): a retrospectiva do álbum em números, para
// compartilhar. /numeros no domínio do álbum, /galeria/<slug>/numeros no site.
// Mesmo portão da galeria. Tudo sai do resumo que o álbum já guarda por evento
// (drive.js, registraResumo), com as datas do dono por cima (comDatasDoDono):
// nenhuma leitura nova do Drive, nenhum dado de visitante.

import { escape, fontFaceAlbumCSS, marcaDoAlbum } from '../utils.js';
import { CORES_DO_ALBUM, mesDoEvento } from './album.js';
import { PALETA_ALBUM as P } from '../config.js';
import { botaoDeAjudaHTML, BOTAO_AJUDA_CSS } from './botao-ajuda.js';

/**
 * Os números do álbum. Só entram eventos com resumo e com foto (o mesmo que o
 * visitante vê na página do álbum).
 * @param {{ id: string, slug: string, nome: string }[]} caps
 * @param {Record<string, import('../drive.js').ResumoCap>} resumo
 */
export function numerosDoAlbum(caps, resumo) {
  const eventos = caps.filter(c => resumo[c.id] && resumo[c.id].n > 0).map(c => ({ ...c, r: resumo[c.id] }));
  const fotos = eventos.reduce((n, e) => n + e.r.n, 0);
  /** @type {Map<string, number>} */
  const porAno = new Map();
  /** @type {Map<string, number>} */
  const porAutor = new Map();
  for (const e of eventos) {
    const mes = mesDoEvento(e.r);
    if (mes) {
      const ano = String(Math.floor(mes / 100));
      porAno.set(ano, (porAno.get(ano) || 0) + e.r.n);
    }
    for (const [nome, n] of Object.entries(e.r.a || {})) porAutor.set(nome, (porAutor.get(nome) || 0) + n);
  }
  const anos = [...porAno].sort((a, b) => a[0].localeCompare(b[0]));
  const maiores = [...eventos].sort((a, b) => b.r.n - a.r.n).slice(0, 5).map(e => ({ slug: e.slug, nome: e.nome, n: e.r.n }));
  const autores = [...porAutor].sort((a, b) => b[1] - a[1]);
  return {
    fotos,
    eventos: eventos.length,
    anos,
    maiores,
    autores: autores.slice(0, 6),
    fotografos: autores.length,
  };
}

/** @param {number} n */
const num = n => n.toLocaleString('pt-BR');

const CSS = `
*,*::before,*::after{box-sizing:border-box;margin:0;padding:0}
[hidden]{display:none!important}
:root{color-scheme:dark}
body{background:var(--bg);color:var(--txt);font-family:'Open Sans',sans-serif;-webkit-font-smoothing:antialiased;-webkit-text-size-adjust:100%;min-height:100vh;line-height:1.5}
a{color:inherit}
::selection{background:var(--sol);color:#141a33}
:focus-visible{outline:2px solid var(--sol);outline-offset:3px}
.nu{max-width:760px;margin:0 auto;padding:1.5rem var(--pad) 4rem}
.nu-volta{display:inline-flex;align-items:center;min-height:44px;color:var(--txt2);text-decoration:none;font-size:.9375rem}
.nu-kick{display:block;margin-top:1rem;font-size:.9375rem;font-weight:600;color:var(--sol)}
h1{font-weight:600;letter-spacing:-.025em;line-height:1.08;font-size:clamp(2.25rem,9vw,3.5rem);margin-top:.5rem;overflow-wrap:anywhere;text-wrap:balance}
h1::after,.nu-sec h2::after{content:"";display:block;width:3rem;height:2px;margin-top:.75rem;background:var(--sol)}
.nu-sub{color:var(--txt2);margin-top:1rem}
.nu-grandes{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:.75rem;margin-top:2rem}
.nu-grande{padding:1rem;border-radius:16px;background:var(--card);border:1px solid var(--borda)}
.nu-grande b{display:block;font-size:clamp(1.5rem,7vw,2rem);font-weight:600;letter-spacing:-.02em;line-height:1;font-variant-numeric:tabular-nums}
.nu-grande span{display:block;margin-top:.5rem;color:var(--txt2);font-size:.875rem;line-height:1.3}
.nu-grande.nu-1{grid-column:1/-1;padding:1.5rem 1.25rem}
.nu-grande.nu-1 b{font-size:clamp(3rem,16vw,5rem);letter-spacing:-.03em;color:var(--sol)}
.nu-grande.nu-1 span{font-size:1rem}
.nu-sec{position:relative;margin-top:3rem}
.nu-sec h2{font-size:1.25rem;font-weight:600;line-height:1.3}
.nu-sec .nu-kick{position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0 0 0 0);white-space:nowrap;margin:0}
.nu-barras{list-style:none;display:grid;gap:.75rem;margin-top:1.5rem}
.nu-barras li{display:grid;grid-template-columns:4.25rem 1fr auto;align-items:center;gap:.75rem}
.nu-barras .nu-rot{font-weight:600;color:var(--txt);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.nu-barra{height:12px;border-radius:999px;background:var(--azul);transition:width .4s cubic-bezier(.22,1,.36,1)}
.nu-barras li:last-child .nu-barra{background:var(--sol)}
.nu-barras .nu-n{color:var(--txt2);font-variant-numeric:tabular-nums;font-size:.875rem}
.nu-lista{list-style:none;margin-top:1rem;border-top:1px solid var(--borda)}
.nu-lista li{display:flex;align-items:center;gap:.75rem;min-height:48px;padding:.5rem 0;border-bottom:1px solid var(--borda)}
.nu-lista .nu-pos{width:1.5rem;color:var(--sol);font-weight:600;font-variant-numeric:tabular-nums}
.nu-lista a,.nu-lista .nu-nome{flex:1;min-width:0;font-weight:600;text-decoration:none;overflow-wrap:anywhere}
.nu-lista a{display:flex;align-items:center;min-height:44px}
@media (hover:hover){.nu-lista a:hover{text-decoration:underline;text-underline-offset:3px}}
.nu-lista .nu-n{color:var(--txt2);font-variant-numeric:tabular-nums;font-size:.875rem}
.nu-acoes{margin-top:3rem;display:flex;flex-wrap:wrap;gap:.75rem}
.nu-btn{display:inline-flex;align-items:center;justify-content:center;min-height:48px;padding:0 1.25rem;border-radius:999px;border:1px solid var(--sol);background:var(--sol);color:#141a33;font:inherit;font-weight:600;text-decoration:none;cursor:pointer;transition:transform .15s cubic-bezier(.22,1,.36,1),background-color .15s cubic-bezier(.22,1,.36,1)}
.nu-btn:active{transform:scale(.97)}
.nu-btn.nu-2{background:rgba(240,235,229,.06);color:var(--sol);border-color:var(--sol)}
@media (hover:hover){.nu-btn.nu-2:hover{background:var(--sol);color:#141a33}}
.nu-msg{min-height:1.4em;margin-top:.75rem;color:var(--txt2);font-size:.9rem}
.nu-nota{margin-top:2rem;color:var(--mudo);font-size:.8125rem}
.nu-fim{padding:0 var(--pad) 3rem}
@media (prefers-reduced-motion: reduce){*,*::before,*::after{animation-duration:.01ms!important;transition-duration:.01ms!important}}
`;

const SCRIPT = `(function () {
  var b = document.getElementById('nu-compartilhar');
  var m = document.getElementById('nu-msg');
  if (!b || !m) return;
  b.hidden = false;
  b.addEventListener('click', function () {
    var dados = { title: document.title, url: location.href };
    if (navigator.share) { navigator.share(dados).catch(function () {}); return; }
    if (navigator.clipboard) navigator.clipboard.writeText(location.href).then(function () { m.textContent = 'Link copiado.'; }, function () { m.textContent = location.href; });
    else m.textContent = location.href;
  });
})();`;

/**
 * @param {{
 *   event: { slug: string, title?: string },
 *   numeros: ReturnType<typeof numerosDoAlbum>,
 *   base: string, nonce: string,
 * }} p  base: '' no domínio do álbum, '/galeria/<slug>' no site
 */
export function numerosHTML({ event, numeros: n, base, nonce }) {
  const titulo = String(event.title || 'Álbum');
  const raiz = base || '/';
  const marca = marcaDoAlbum(event.slug);
  const periodo = n.anos.length > 1 ? `${n.anos[0][0]} a ${n.anos[n.anos.length - 1][0]}` : n.anos.length ? n.anos[0][0] : '';
  const maxAno = Math.max(1, ...n.anos.map(a => a[1]));
  const grandes = [
    [num(n.fotos), n.fotos === 1 ? 'foto' : 'fotos'],
    [num(n.eventos), n.eventos === 1 ? 'evento' : 'eventos'],
    n.anos.length ? [String(n.anos.length), n.anos.length === 1 ? 'ano' : 'anos'] : null,
    n.fotografos ? [String(n.fotografos), n.fotografos === 1 ? 'pessoa fotografou' : 'pessoas fotografaram'] : null,
  ].filter(Boolean);
  const porAno = n.anos.length > 1 ? `
    <section class="nu-sec" aria-labelledby="nu-anos-t">
      <span class="nu-kick">Ano a ano</span>
      <h2 id="nu-anos-t">Fotos por ano</h2>
      <ul class="nu-barras">${n.anos.map(([ano, q]) => `<li><span class="nu-rot">${escape(ano)}</span><span class="nu-barra" style="width:${Math.max(4, Math.round(q / maxAno * 100))}%" aria-hidden="true"></span><span class="nu-n">${num(q)}</span></li>`).join('')}</ul>
    </section>` : '';
  const maiores = n.maiores.length > 1 ? `
    <section class="nu-sec" aria-labelledby="nu-ev-t">
      <span class="nu-kick">Os mais fotografados</span>
      <h2 id="nu-ev-t">Os eventos com mais fotos</h2>
      <ol class="nu-lista">${n.maiores.map((e, i) => `<li><span class="nu-pos">${i + 1}</span><a href="${escape(base)}/${escape(e.slug)}">${escape(e.nome)}</a><span class="nu-n">${num(e.n)} fotos</span></li>`).join('')}</ol>
    </section>` : '';
  const autores = n.autores.length > 1 ? `
    <section class="nu-sec" aria-labelledby="nu-quem-t">
      <span class="nu-kick">Quem fotografou</span>
      <h2 id="nu-quem-t">Quem mais fotografou</h2>
      <ol class="nu-lista">${n.autores.map(([nome, q], i) => `<li><span class="nu-pos">${i + 1}</span><span class="nu-nome">${escape(nome)}</span><span class="nu-n">${num(q)} fotos</span></li>`).join('')}</ol>
    </section>` : '';
  return `<!DOCTYPE html>
<html lang="pt-BR">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta name="robots" content="noindex">
  <meta name="theme-color" content="${P.bg}">
  <meta name="color-scheme" content="dark">
  <title>Turma em números · ${escape(titulo)}</title>
  <meta name="description" content="${escape(`${num(n.fotos)} fotos em ${num(n.eventos)} eventos${periodo ? `, de ${periodo}` : ''}.`)}">
  <link rel="icon" type="image/svg+xml" href="${marca ? marca.icone : '/icon.svg'}">
  <style>${fontFaceAlbumCSS()}${CORES_DO_ALBUM}${CSS}${BOTAO_AJUDA_CSS}</style>
</head>
<body>
  <main class="nu">
    <a class="nu-volta" href="${escape(raiz)}">← Voltar ao álbum</a>
    <span class="nu-kick">${escape(titulo)}</span>
    <h1>A turma em números</h1>
    <p class="nu-sub">${n.eventos ? `Tudo o que está no álbum até agora${periodo ? `, de ${escape(periodo)}` : ''}.` : 'Os números aparecem quando os eventos tiverem fotos.'}</p>
    <div class="nu-grandes">${grandes.map((g, i) => `<div class="nu-grande${i === 0 ? ' nu-1' : ''}"><b>${escape(/** @type {string[]} */ (g)[0])}</b><span>${escape(/** @type {string[]} */ (g)[1])}</span></div>`).join('')}</div>
    ${porAno}${maiores}${autores}
    <div class="nu-acoes">
      <a class="nu-btn" href="${escape(raiz)}">Ver o álbum</a>
      <button type="button" class="nu-btn nu-2" id="nu-compartilhar" hidden>Compartilhar</button>
    </div>
    <p class="nu-msg" id="nu-msg" role="status"></p>
    <p class="nu-nota">Contado das fotos que estão no álbum. Fotos novas entram nos números quando o evento é aberto.</p>
  </main>
  <footer class="nu-fim"><div class="aj-rodape">${botaoDeAjudaHTML(base)}</div></footer>
  <script nonce="${nonce}">${SCRIPT}</script>
</body>
</html>`;
}
