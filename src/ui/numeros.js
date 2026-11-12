// "Turma em números" (v3.9.1): a retrospectiva do álbum em números, para
// compartilhar. /numeros no domínio do álbum, /galeria/<slug>/numeros no site.
// Mesmo portão da galeria. Tudo sai do resumo que o álbum já guarda por evento
// (drive.js, registraResumo), com as datas do dono por cima (comDatasDoDono):
// nenhuma leitura nova do Drive, nenhum dado de visitante.

import { escape, fontFaceCSS, fontPreloadHTML, marcaDoAlbum } from '../utils.js';
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
body{background:var(--bg);color:var(--txt);font-family:'Open Sans','Inter',sans-serif;-webkit-font-smoothing:antialiased;-webkit-text-size-adjust:100%;min-height:100vh;line-height:1.5}
a{color:inherit}
:focus-visible{outline:2px solid var(--sol);outline-offset:3px}
.nu{max-width:760px;margin:0 auto;padding:1.4rem var(--pad) 4rem}
.nu-volta{display:inline-flex;align-items:center;min-height:44px;color:var(--txt2);text-decoration:none;font-size:.9rem}
.nu-kick{display:block;margin-top:1rem;font-size:.74rem;font-weight:600;letter-spacing:.22em;text-transform:uppercase;color:var(--sol)}
h1{font-weight:800;letter-spacing:-.03em;line-height:.98;font-size:clamp(2.4rem,9vw,4rem);margin-top:.3rem;overflow-wrap:anywhere}
.nu-sub{color:var(--txt2);margin-top:.6rem}
.nu-grandes{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:.7rem;margin-top:2rem}
.nu-grande{padding:1.1rem 1.2rem;border-radius:18px;background:var(--card);border:1px solid var(--borda)}
.nu-grande b{display:block;font-size:clamp(2rem,9vw,3rem);font-weight:800;letter-spacing:-.03em;line-height:1;color:var(--sol)}
.nu-grande span{display:block;margin-top:.35rem;color:var(--txt2);font-size:.9rem}
.nu-sec{margin-top:2.6rem}
.nu-sec h2{font-size:1.25rem;font-weight:700;margin-top:.2rem}
.nu-sec .nu-kick{margin-top:0}
.nu-barras{list-style:none;display:grid;gap:.7rem;margin-top:1rem}
.nu-barras li{display:grid;grid-template-columns:4.2rem 1fr auto;align-items:center;gap:.7rem}
.nu-barras .nu-rot{font-weight:700;color:var(--txt);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.nu-barra{height:14px;border-radius:999px;background:var(--azul)}
.nu-barras .nu-n{color:var(--txt2);font-variant-numeric:tabular-nums;font-size:.9rem}
.nu-lista{list-style:none;margin-top:1rem;border-top:1px solid var(--borda)}
.nu-lista li{display:flex;align-items:baseline;gap:.8rem;padding:.75rem 0;border-bottom:1px solid var(--borda)}
.nu-lista .nu-pos{width:1.6rem;color:var(--sol);font-weight:800}
.nu-lista a,.nu-lista .nu-nome{flex:1;min-width:0;font-weight:600;text-decoration:none;overflow-wrap:anywhere}
.nu-lista a:hover{text-decoration:underline}
.nu-lista .nu-n{color:var(--txt2);font-variant-numeric:tabular-nums}
.nu-acoes{margin-top:2.6rem;display:flex;flex-wrap:wrap;gap:.6rem}
.nu-btn{display:inline-flex;align-items:center;justify-content:center;min-height:48px;padding:0 1.3rem;border-radius:999px;border:1px solid var(--sol);background:var(--sol);color:#141a33;font:inherit;font-weight:700;text-decoration:none;cursor:pointer}
.nu-btn.nu-2{background:transparent;color:var(--sol)}
.nu-msg{min-height:1.4em;margin-top:.6rem;color:var(--txt2);font-size:.9rem}
.nu-nota{margin-top:2.4rem;color:var(--mudo);font-size:.82rem}
.nu-fim{padding:0 var(--pad) 3rem}
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
    n.anos.length ? [String(n.anos.length), n.anos.length === 1 ? 'ano' : `anos (${periodo})`] : null,
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
  <title>Turma em números · ${escape(titulo)}</title>
  <meta name="description" content="${escape(`${num(n.fotos)} fotos em ${num(n.eventos)} eventos${periodo ? `, de ${periodo}` : ''}.`)}">
  <link rel="icon" type="image/svg+xml" href="${marca ? marca.icone : '/icon.svg'}">
  ${fontPreloadHTML()}
  <style>${fontFaceCSS()}${CORES_DO_ALBUM}${CSS}${BOTAO_AJUDA_CSS}</style>
</head>
<body>
  <main class="nu">
    <a class="nu-volta" href="${escape(raiz)}">← Voltar ao álbum</a>
    <span class="nu-kick">${escape(titulo)}</span>
    <h1>A turma em números</h1>
    <p class="nu-sub">${n.eventos ? `Tudo o que está no álbum até agora${periodo ? `, de ${escape(periodo)}` : ''}.` : 'Os números aparecem quando os eventos tiverem fotos.'}</p>
    <div class="nu-grandes">${grandes.map(g => `<div class="nu-grande"><b>${escape(/** @type {string[]} */ (g)[0])}</b><span>${escape(/** @type {string[]} */ (g)[1])}</span></div>`).join('')}</div>
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
