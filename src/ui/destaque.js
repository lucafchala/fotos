// Destaque máximo de um álbum no site (v3.3): a faixa no topo das páginas, o
// cartão grande no começo da home e o popup da primeira visita. Só aparece com
// a opção "Destaque máximo no site" marcada E o álbum LANÇADO (albumLancado:
// visível e fora do "Em breve") — até o dono lançar, o público não vê nada.
// Álbum família/privado nunca é destacado.
//
// Cores do álbum da turma (o amarelo e o azul do Colégio Santa Cruz), sem
// depender do tema da página onde entra.

import { escape, origemDoAlbum, albumLancado, isRestrictedAccess, sizedDriveThumb } from '../utils.js';
import { DOMINIOS_DE_ALBUM } from '../config.js';

/**
 * O álbum em destaque, ou null. Se houver mais de um marcado, vale o primeiro
 * fixado; senão, o primeiro da lista.
 * @param {import('../utils.js').Evento[]} eventos
 */
export function albumEmDestaque(eventos) {
  const candidatos = (Array.isArray(eventos) ? eventos : []).filter(e => e && e.destaqueMaximo === true && albumLancado(e) && !isRestrictedAccess(e));
  return candidatos.find(e => e.pinned) || candidatos[0] || null;
}

/** Os textos e o link do destaque. @param {import('../utils.js').Evento} e */
function dados(e) {
  const slug = String(e.slug || '');
  const origem = origemDoAlbum(slug);
  const proprio = origem !== 'https://fotos.lucafchala.com';
  const doDominio = Object.values(DOMINIOS_DE_ALBUM).find(a => a.slug === slug);
  const capa = typeof e.thumbnailUrl === 'string' && /^https:\/\/lh3\.googleusercontent\.com\//.test(e.thumbnailUrl)
    ? e.thumbnailUrl
    : (Array.isArray(e.photos) ? e.photos.find(u => typeof u === 'string' && /^https:\/\/lh3\.googleusercontent\.com\//.test(u)) : '') || '';
  const texto = String(e.galeriaAbertura || '').trim().split(/\n/)[0].slice(0, 200);
  return {
    slug,
    titulo: String(e.title || slug),
    linha: doDominio ? doDominio.linha : 'Novo álbum',
    url: proprio ? `${origem}/` : `/galeria/${slug}`,
    mostra: proprio ? origem.replace(/^https:\/\//, '') : '',
    capa,
    texto,
  };
}

/** A faixa fina no topo da página. @param {import('../utils.js').Evento | null} e */
export function faixaDestaqueHTML(e) {
  if (!e) return '';
  const d = dados(e);
  return `<a class="dq-faixa" href="${escape(d.url)}" data-acao="destaque-faixa"><span class="dq-f-k">${escape(d.linha)}</span><span class="dq-f-t"><b>${escape(d.titulo)}</b> · o álbum está no ar</span><span class="dq-f-cta">Ver o álbum <span aria-hidden="true">→</span></span></a>`;
}

/** O cartão grande no começo da home. @param {import('../utils.js').Evento | null} e */
export function cartaoDestaqueHTML(e) {
  if (!e) return '';
  const d = dados(e);
  return `<section class="dq-cartao" aria-labelledby="dq-cartao-t">
    ${d.capa ? `<img class="dq-c-img" src="${escape(sizedDriveThumb(d.capa, 1200))}" alt="" decoding="async" fetchpriority="high" referrerpolicy="no-referrer">` : ''}
    <div class="dq-c-txt">
      <span class="dq-k">${escape(d.linha)}</span>
      <h2 id="dq-cartao-t">${escape(d.titulo)}</h2>
      ${d.texto ? `<p>${escape(d.texto)}</p>` : ''}
      <a class="dq-btn" href="${escape(d.url)}" data-acao="destaque-cartao">Ver o álbum</a>${d.mostra ? `<span class="dq-dom">${escape(d.mostra)}</span>` : ''}
    </div>
  </section>`;
}

/**
 * O popup da primeira visita (uma vez por aparelho e álbum; a lembrança fica
 * só no localStorage). Sem JS, não aparece — a faixa e o cartão continuam.
 * @param {import('../utils.js').Evento | null} e
 * @param {string} nonce
 */
export function popupDestaqueHTML(e, nonce) {
  if (!e) return '';
  const d = dados(e);
  return `<dialog class="dq-pop" id="dq-pop" aria-labelledby="dq-pop-t">
    ${d.capa ? `<img src="${escape(sizedDriveThumb(d.capa, 960))}" alt="" decoding="async" loading="lazy" referrerpolicy="no-referrer">` : ''}
    <div class="dq-pop-txt">
      <span class="dq-k">${escape(d.linha)}</span>
      <p class="dq-pop-t" id="dq-pop-t">${escape(d.titulo)}</p>
      <p>O álbum está no ar. ${d.texto ? escape(d.texto) : ''}</p>
      <div class="dq-pop-acoes"><a class="dq-btn" href="${escape(d.url)}" data-acao="destaque-popup">Ver o álbum</a><button type="button" class="dq-agora-nao" data-dq="fechar">Agora não</button></div>
    </div>
  </dialog>
  <script nonce="${nonce}">(function () {
    var d = document.getElementById('dq-pop');
    if (!d || typeof d.showModal !== 'function') return;
    var k = 'dq-visto:' + ${JSON.stringify(d.slug).replace(/</g, '\\u003c')};
    try { if (localStorage.getItem(k)) return; } catch (e) { return; }
    function marca() { try { localStorage.setItem(k, String(Date.now())); } catch (e) {} }
    d.addEventListener('click', function (ev) { if (ev.target === d || (ev.target.getAttribute && ev.target.getAttribute('data-dq') === 'fechar')) { marca(); d.close(); } });
    d.addEventListener('cancel', marca);
    d.querySelector('.dq-btn').addEventListener('click', marca);
    setTimeout(function () { if (!document.hidden) d.showModal(); }, 1200);
  })();</script>`;
}

/** O CSS das três peças (paleta própria, independente do tema da página). */
export const DESTAQUE_CSS = `
.dq-faixa{display:flex;flex-wrap:wrap;align-items:center;justify-content:center;gap:.2rem .8rem;min-height:44px;padding:.55rem 16px;background:#243580;color:#fff;text-decoration:none;font-size:.88rem;line-height:1.35;text-align:center}
.dq-faixa:hover .dq-f-cta{text-decoration:underline}
.dq-f-k{font-size:.68rem;font-weight:600;letter-spacing:.16em;text-transform:uppercase;color:#f9de4b}
.dq-f-t b{font-weight:700}
.dq-f-cta{font-weight:600;color:#f9de4b;white-space:nowrap}
.dq-cartao{position:relative;display:grid;grid-template-columns:1fr;overflow:hidden;margin:0 0 1.5rem;border-radius:16px;background:linear-gradient(135deg,#172154,#243580);color:#fff;border:1px solid #2f4196}
.dq-c-img{display:block;width:100%;height:100%;aspect-ratio:16/9;object-fit:cover;background:#1a2560}
.dq-c-txt{padding:1.4rem 1.4rem 1.5rem}
.dq-k{display:block;font-size:.7rem;font-weight:600;letter-spacing:.18em;text-transform:uppercase;color:#f9de4b}
.dq-cartao h2{font-size:clamp(1.9rem,5vw,3rem);font-weight:800;line-height:1;letter-spacing:-.02em;margin:.4rem 0 .6rem;overflow-wrap:anywhere}
.dq-cartao p{color:#d6dbef;line-height:1.55;max-width:34rem}
.dq-btn{display:inline-flex;align-items:center;min-height:46px;margin-top:1rem;padding:0 1.3rem;border-radius:999px;background:#f9de4b;color:#141a33;font-weight:700;text-decoration:none}
.dq-btn:hover{filter:brightness(1.05)}
.dq-dom{display:inline-block;margin:1rem 0 0 .9rem;font-size:.85rem;color:#aab3d6;vertical-align:middle}
@media (min-width:760px){.dq-cartao{grid-template-columns:1.2fr 1fr}.dq-c-img{aspect-ratio:auto;min-height:300px}.dq-c-txt{align-self:center;padding:2rem}}
.dq-pop{margin:auto;width:min(26rem,calc(100vw - 2rem));padding:0;border:0;border-radius:18px;overflow:hidden;background:#172154;color:#fff;box-shadow:0 30px 80px rgba(0,0,0,.5)}
.dq-pop::backdrop{background:rgba(5,8,20,.7)}
.dq-pop img{display:block;width:100%;aspect-ratio:16/10;object-fit:cover;background:#1a2560}
.dq-pop-txt{padding:1.2rem 1.3rem 1.3rem}
.dq-pop-t{font-size:1.7rem;font-weight:800;letter-spacing:-.02em;margin:.3rem 0 .4rem}
.dq-pop p{color:#d6dbef;line-height:1.5;font-size:.95rem}
.dq-pop-acoes{display:flex;flex-wrap:wrap;align-items:center;gap:.4rem 1rem}
.dq-agora-nao{min-height:44px;margin-top:1rem;padding:0 .4rem;background:none;border:0;color:#aab3d6;font:inherit;font-size:.9rem;text-decoration:underline;cursor:pointer}
@media (prefers-reduced-motion: no-preference){.dq-pop[open]{animation:dq-sobe .35s ease-out}@keyframes dq-sobe{from{opacity:0;transform:translateY(16px)}to{opacity:1;transform:none}}}
`;

/**
 * Os dados do destaque para os OUTROS sites (GET /api/destaque, CORS aberto).
 * Só o que o aviso desenha; nada de e-mail, pasta ou ID do Drive.
 * @param {import('../utils.js').Evento | null} e
 */
export function destaqueParaApi(e) {
  if (!e) return { ativo: false };
  const d = dados(e);
  return { ativo: true, slug: d.slug, titulo: d.titulo, linha: d.linha, url: new URL(d.url, 'https://fotos.lucafchala.com').toString() };
}

// O script que os outros sites incluem (uma linha: `<script src=
// "https://fotos.lucafchala.com/destaque.js" async></script>`). Pergunta a
// /api/destaque se há álbum lançado e, se houver, desenha a faixa no topo,
// dentro de um shadow root (o CSS do site não a afeta, e ela não afeta o
// site). Fechar esconde por 3 dias, só naquele aparelho. Não roda no próprio
// fotos.lucafchala.com nem no domínio do álbum (lá a faixa vem do servidor).
// Sem cookie, sem rastreio: o pedido sai com `credentials: 'omit'`.
export const DESTAQUE_EMBED_JS = `(function () {
  var h = location.hostname;
  if (h === 'fotos.lucafchala.com' || ${JSON.stringify(Object.keys(DOMINIOS_DE_ALBUM))}.indexOf(h.replace(/^www\\./, '')) >= 0) return;
  if (!window.fetch || !document.body || !document.body.attachShadow) return;
  fetch('https://fotos.lucafchala.com/api/destaque', { credentials: 'omit' }).then(function (r) { return r.ok ? r.json() : null; }).then(function (d) {
    if (!d || !d.ativo || typeof d.url !== 'string' || d.url.indexOf('https://') !== 0) return;
    var k = 'lfc-destaque-fechado:' + d.slug;
    try { var t = Number(localStorage.getItem(k)); if (t && Date.now() - t < 3 * 864e5) return; } catch (e) {}
    var host = document.createElement('div');
    host.setAttribute('data-lfc-destaque', '');
    var raiz = host.attachShadow({ mode: 'closed' });
    var css = document.createElement('style');
    css.textContent = ':host{all:initial;display:block}.f{display:flex;flex-wrap:wrap;align-items:center;justify-content:center;gap:.2rem .8rem;min-height:44px;padding:.5rem 52px .5rem 16px;background:#243580;color:#fff;font:14px/1.35 system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;text-align:center;position:relative;box-sizing:border-box}a{color:inherit;text-decoration:none;display:contents}.k{font-size:11px;font-weight:600;letter-spacing:.16em;text-transform:uppercase;color:#f9de4b}b{font-weight:700}.c{font-weight:600;color:#f9de4b;white-space:nowrap}a:hover .c{text-decoration:underline}button{position:absolute;right:4px;top:50%;transform:translateY(-50%);width:44px;height:44px;border:0;background:none;color:#aab3d6;font-size:20px;cursor:pointer}button:focus-visible,a:focus-visible .c{outline:2px solid #f9de4b;outline-offset:2px}';
    var f = document.createElement('div'); f.className = 'f'; f.setAttribute('role', 'region'); f.setAttribute('aria-label', 'Aviso');
    var a = document.createElement('a'); a.href = d.url;
    var s1 = document.createElement('span'); s1.className = 'k'; s1.textContent = d.linha || 'Novo álbum';
    var s2 = document.createElement('span'); var b = document.createElement('b'); b.textContent = d.titulo || ''; s2.appendChild(b); s2.appendChild(document.createTextNode(' · o álbum está no ar'));
    var s3 = document.createElement('span'); s3.className = 'c'; s3.textContent = 'Ver o álbum →';
    a.appendChild(s1); a.appendChild(s2); a.appendChild(s3);
    var x = document.createElement('button'); x.type = 'button'; x.setAttribute('aria-label', 'Fechar aviso'); x.textContent = '×';
    x.addEventListener('click', function () { try { localStorage.setItem(k, String(Date.now())); } catch (e) {} host.remove(); });
    f.appendChild(a); f.appendChild(x); raiz.appendChild(css); raiz.appendChild(f);
    document.body.insertBefore(host, document.body.firstChild);
  }).catch(function () {});
})();`;
