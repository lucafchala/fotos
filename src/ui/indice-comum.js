// Peças comuns às duas formas do índice da galeria por capítulos: o índice
// simples (galeria-indice.js) e a apresentação do álbum (album.js) — as "N
// novas" dos cartões e a busca pelo rosto. Ficam aqui para as duas páginas não
// divergirem.

import { honeypotFieldHTML } from '../security.js';
import { EPOCA_CRIADA_MS, NOVAS_SESSAO_MIN, NOVAS_RESUMO_MAX } from '../config.js';

/** O CSS do diálogo e do resultado da busca pelo rosto (usa as variáveis de cor da página). */
export const ROSTO_CSS = `.rs{margin:auto;width:min(30rem,calc(100vw - 2rem));max-height:calc(100dvh - 2rem);overflow:auto;border:1px solid var(--border);border-radius:14px;background:var(--bg-card);color:var(--text);padding:1.25rem 1.25rem 1rem}
.rs::backdrop{background:rgba(0,0,0,.6)}
.rs-t{font-size:1.1rem;font-weight:600;margin-bottom:.6rem}
.rs p,.rs li{font-size:.9rem;line-height:1.55;color:var(--text-2)}
.rs ul{margin:.6rem 0 .8rem 1.1rem}
.rs-aceite{display:flex;gap:.6rem;align-items:flex-start;font-size:.88rem;line-height:1.45;margin:.4rem 0 .8rem;cursor:pointer}
.rs-aceite input{margin-top:.2rem;width:1.1rem;height:1.1rem;flex:none;accent-color:var(--accent)}
.rs-erro{color:var(--warn-text);min-height:1.2em;margin:.4rem 0}
.rs-acoes{display:flex;flex-wrap:wrap;justify-content:flex-end;gap:.5rem;margin-top:.6rem}
.rs-btn{min-height:44px;padding:0 1rem;border-radius:999px;border:1px solid var(--border);background:transparent;color:var(--text);font:inherit;font-size:.9rem;cursor:pointer}
.rs-btn-1{background:var(--accent);border-color:var(--accent);color:var(--bg-page);font-weight:600}
.rs-btn:disabled{opacity:.5;cursor:default}
.rs-link{background:none;border:0;color:var(--text-muted);font:inherit;font-size:.8rem;text-decoration:underline;cursor:pointer;min-height:44px;padding:0}
.rs-res{padding:1rem var(--pad) 0}
.rs-res h2{font-size:1.05rem;font-weight:600}
.rs-res p{font-size:.85rem;color:var(--text-muted);margin-top:.25rem}
.rs-grade{list-style:none;display:grid;grid-template-columns:repeat(auto-fill,minmax(min(100%,110px),1fr));gap:6px;margin-top:.75rem}
.rs-grade a{display:block;position:relative;border-radius:8px;overflow:hidden;background:var(--esqueleto)}
.rs-grade img{display:block;width:100%;height:auto;aspect-ratio:1;object-fit:cover}
.rs-grade span{position:absolute;left:0;right:0;bottom:0;padding:.9rem .4rem .3rem;font-size:.7rem;color:#fff;background:linear-gradient(transparent,rgba(0,0,0,.7));white-space:nowrap;overflow:hidden;text-overflow:ellipsis}`;

/**
 * Marca "N novas" nos cartões. A última visita a cada capítulo mora só no
 * localStorage do visitante (gravada pela página do capítulo): nada disto vai
 * ao servidor. Sem visita anterior não há o que comparar e nada é marcado.
 * Fica fora de qualquer crase, `dollar-chave` e barra invertida: é JS de navegador
 * dentro de um template literal.
 * @param {string} slug
 */
export const SCRIPT_NOVAS = slug => `(function () {
  var SLUG = ${JSON.stringify(slug).replace(/</g, '\\u003c')};
  var EPOCA = ${EPOCA_CRIADA_MS};
  var SESSAO = ${NOVAS_SESSAO_MIN} * 60000;
  var MAX = ${NOVAS_RESUMO_MAX};
  var agora = Date.now();
  var cartoes = document.querySelectorAll('a.ix-card[data-cr]');
  for (var i = 0; i < cartoes.length; i++) {
    var a = cartoes[i];
    var ant = 0;
    try {
      var v = JSON.parse(localStorage.getItem('gal-visita:' + SLUG + ':' + a.getAttribute('data-cap')) || 'null');
      if (v && typeof v.u === 'number') ant = agora - v.u > SESSAO ? v.u : (typeof v.p === 'number' ? v.p : 0);
    } catch (e) { ant = 0; }
    if (!ant) continue;
    var cr = a.getAttribute('data-cr').split(',');
    var n = 0;
    for (var j = 0; j < cr.length; j++) if (EPOCA + Number(cr[j]) * 60000 > ant) n++;
    if (!n) continue;
    var s = document.createElement('span');
    s.className = 'ix-novas';
    s.textContent = (n >= MAX ? MAX + '+' : n) + (n === 1 ? ' nova' : ' novas');
    var sub = a.querySelector('.ix-sub');
    if (sub) sub.appendChild(s);
  }
})();`;

/** O diálogo da busca pelo rosto (o script liga o botão; sem JS, nada aparece). */
export function rostoHTML() {
  return `<dialog class="rs" id="rs" aria-labelledby="rs-t">
    <form method="dialog" id="rs-form">
      <p class="rs-t" id="rs-t">Procurar meu rosto</p>
      <div id="rs-txt-buscar">
        <p>Tire uma selfie (ou escolha uma foto sua) e o site mostra as fotos do álbum em que você provavelmente aparece.</p>
        <ul>
          <li>A selfie vai para a Amazon Rekognition, em São Paulo, só para a comparação. Nem o site nem a Amazon a guardam.</li>
          <li>O resultado é aproximado: pode faltar foto e pode aparecer alguém parecido.</li>
          <li>Use só com o <strong>seu</strong> rosto.</li>
        </ul>
      </div>
      <div id="rs-txt-sair" hidden>
        <p>Envie uma selfie e o site tira o seu rosto da busca deste álbum: ninguém mais acha as suas fotos por ela, nem as que chegarem depois.</p>
        <ul>
          <li>Para isso, o seu rosto fica guardado (só ele, só para esse fim) até o fim do álbum. Para apagar: privacidade@lucafchala.com.</li>
          <li>As fotos continuam no álbum. Para tirar uma foto, use "Pedir remoção" nela.</li>
        </ul>
      </div>
      <label class="rs-aceite"><input type="checkbox" id="rs-aceite"><span>Concordo com o uso do meu rosto para isso, como explica a <a href="/privacidade#busca-rosto" target="_blank" rel="noopener">política de privacidade</a>.</span></label>
      ${honeypotFieldHTML()}
      <div id="rs-ts"></div>
      <p class="rs-erro" id="rs-erro" role="alert"></p>
      <input type="file" id="rs-arquivo" accept="image/*" capture="user" hidden>
      <div class="rs-acoes">
        <button type="button" class="rs-btn" data-rs="fechar">Cancelar</button>
        <button type="button" class="rs-btn rs-btn-1" id="rs-tirar" disabled>Tirar selfie</button>
      </div>
      <p><button type="button" class="rs-link" id="rs-modo">Não quero aparecer na busca</button></p>
    </form>
  </dialog>
  <section class="rs-res" id="rs-res" hidden aria-live="polite"><h2 id="rs-res-t" tabindex="-1"></h2><p id="rs-res-sub"></p><ul class="rs-grade" id="rs-grade"></ul></section>`;
}

/**
 * O script da busca pelo rosto: reduz a selfie no próprio aparelho (640 px,
 * JPEG), manda com o aceite e os tokens, e desenha o resultado. A selfie só
 * existe na memória da página: não vai para o localStorage nem fica na tela.
 * Fora de crase, `dollar-chave` e barra invertida: é JS dentro de template literal.
 */
export const SCRIPT_ROSTO = `(function () {
  var el = document.getElementById('rs-dados');
  var dlg = document.getElementById('rs');
  var abrir = document.getElementById('rs-abrir');
  if (!el || !dlg || !abrir || typeof dlg.showModal !== 'function' || !window.fetch || !window.createImageBitmap) return;
  var D = JSON.parse(el.textContent || '{}');
  var aceite = document.getElementById('rs-aceite');
  var tirar = document.getElementById('rs-tirar');
  var arquivo = document.getElementById('rs-arquivo');
  var erro = document.getElementById('rs-erro');
  var modo = document.getElementById('rs-modo');
  var sair = false, token = '', widget = null, ocupado = false, tsEstado = 'fora';
  abrir.hidden = false;
  function msg(t) { erro.textContent = t || ''; }
  function botao() { tirar.disabled = ocupado || !aceite.checked || !token; }
  function turnstile() {
    if (tsEstado !== 'fora') { if (widget !== null && window.turnstile) window.turnstile.reset(widget); return; }
    tsEstado = 'carregando';
    var sc = document.createElement('script');
    sc.src = 'https://challenges.cloudflare.com/turnstile/v0/api.js';
    sc.async = true;
    sc.onload = function () {
      if (!window.turnstile) { tsEstado = 'falhou'; msg('A verificação de segurança não carregou (um bloqueador pode estar impedindo).'); return; }
      tsEstado = 'pronto';
      widget = window.turnstile.render('#rs-ts', {
        sitekey: D.ts,
        callback: function (t) { token = t; botao(); },
        'error-callback': function () { token = ''; botao(); },
        'expired-callback': function () { token = ''; botao(); }
      });
    };
    sc.onerror = function () { tsEstado = 'falhou'; msg('A verificação de segurança não carregou (um bloqueador pode estar impedindo).'); };
    document.head.appendChild(sc);
  }
  function poeModo(s) {
    sair = s;
    document.getElementById('rs-t').textContent = s ? 'Sair da busca pelo rosto' : 'Procurar meu rosto';
    document.getElementById('rs-txt-buscar').hidden = s;
    document.getElementById('rs-txt-sair').hidden = !s;
    tirar.textContent = s ? 'Enviar selfie e sair' : 'Tirar selfie';
    modo.textContent = s ? 'Quero procurar meu rosto' : 'Não quero aparecer na busca';
    msg('');
  }
  abrir.addEventListener('click', function () { poeModo(false); aceite.checked = false; botao(); dlg.showModal(); turnstile(); });
  modo.addEventListener('click', function () { poeModo(!sair); });
  aceite.addEventListener('change', botao);
  dlg.addEventListener('click', function (e) { if (e.target && e.target.getAttribute && e.target.getAttribute('data-rs') === 'fechar') dlg.close(); });
  tirar.addEventListener('click', function () { if (!tirar.disabled) arquivo.click(); });
  arquivo.addEventListener('change', function () {
    var f = arquivo.files && arquivo.files[0];
    arquivo.value = '';
    if (!f) return;
    ocupado = true; botao(); msg('');
    tirar.textContent = 'Procurando…';
    reduz(f).then(function (b64) {
      var hp = document.getElementById('company_website');
      var corpo = JSON.stringify({ slug: D.slug, imagem: b64, aceite: true, form_token: D.token, turnstileToken: token, company_website: hp ? hp.value : '' });
      // Muita gente buscando ao mesmo tempo (429): espera o que o servidor
      // pediu e tenta de novo sozinho, até 3 vezes, avisando na tela.
      function envia(tentativa) {
        return fetch(sair ? '/api/rosto/sair' : '/api/rosto/buscar', {
          method: 'POST', headers: { 'Content-Type': 'application/json' }, body: corpo
        }).then(function (r) {
          return r.json().catch(function () { return {}; }).then(function (j) {
            if (r.status === 429 && tentativa < 3) {
              var espera = Math.min(20, Math.max(2, Number(j.retryAfter) || 3));
              msg('Muita gente procurando agora. Tentando de novo em ' + espera + ' s…');
              return new Promise(function (ok) { setTimeout(ok, espera * 1000); }).then(function () { msg(''); return envia(tentativa + 1); });
            }
            if (!r.ok) throw new Error(j.error || 'A busca não respondeu. Tente de novo.');
            return j;
          });
        });
      }
      return envia(0);
    }).then(function (j) {
      dlg.close();
      mostra(j);
    }).catch(function (e) {
      msg(e && e.message ? e.message : 'A busca não respondeu. Tente de novo.');
    }).then(function () {
      ocupado = false; token = '';
      if (widget !== null && window.turnstile) window.turnstile.reset(widget);
      poeModo(sair); botao();
    });
  });
  function reduz(f) {
    return createImageBitmap(f).then(function (bmp) {
      var lado = 640, k = Math.min(1, lado / Math.max(bmp.width, bmp.height));
      var c = document.createElement('canvas');
      c.width = Math.max(1, Math.round(bmp.width * k)); c.height = Math.max(1, Math.round(bmp.height * k));
      c.getContext('2d').drawImage(bmp, 0, 0, c.width, c.height);
      if (bmp.close) bmp.close();
      var url = c.toDataURL('image/jpeg', 0.85);
      c.width = c.height = 0;
      return url.slice(url.indexOf(',') + 1);
    }, function () { throw new Error('Não consegui abrir essa foto. Tente tirar a selfie de novo.'); });
  }
  function mostra(j) {
    var sec = document.getElementById('rs-res');
    var t = document.getElementById('rs-res-t');
    var sub = document.getElementById('rs-res-sub');
    var grade = document.getElementById('rs-grade');
    grade.textContent = '';
    sec.hidden = false;
    if (j.removidas !== undefined) {
      t.textContent = 'Pronto: você saiu da busca';
      sub.textContent = j.removidas ? 'Tiramos o seu rosto de ' + j.removidas + (j.removidas === 1 ? ' foto' : ' fotos') + ' do índice. As fotos novas também ficam de fora.' : 'Não havia foto sua no índice. As que chegarem depois ficam de fora.';
    } else {
      var lista = j.resultados || [];
      t.textContent = lista.length ? (lista.length === 1 ? '1 foto em que pode ser você' : lista.length + ' fotos em que pode ser você') : 'Nenhuma foto encontrada';
      sub.textContent = j.semIndice ? 'O álbum ainda está sendo preparado para a busca. Tente de novo mais tarde.' : (lista.length ? 'Da mais parecida para a menos parecida. Toque para abrir.' : 'Tente outra selfie, de frente e com boa luz.');
      lista.forEach(function (r) {
        var li = document.createElement('li');
        var a = document.createElement('a');
        a.href = '/galeria/' + encodeURIComponent(D.slug) + (r.cap ? '/' + encodeURIComponent(r.cap) : '') + '#foto=' + encodeURIComponent(r.id);
        var img = document.createElement('img');
        img.src = 'https://lh3.googleusercontent.com/d/' + encodeURIComponent(r.id) + '=w320';
        img.alt = ''; img.loading = 'lazy'; img.decoding = 'async'; img.referrerPolicy = 'no-referrer';
        a.appendChild(img);
        if (r.cap && D.caps[r.cap]) { var s = document.createElement('span'); s.textContent = D.caps[r.cap]; a.appendChild(s); }
        li.appendChild(a); grade.appendChild(li);
      });
    }
    t.focus();
    sec.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }
})();`;


// ---------------------------------------------------------------------------
// Busca nas fotos (v3.7): texto lido nas fotos e "coisas" (GET /api/busca)
// ---------------------------------------------------------------------------
export const BUSCA_CSS = `.bf{display:flex;flex-wrap:wrap;gap:.5rem;margin-top:1rem;max-width:34rem}
.bf[hidden]{display:none}
.bf input{flex:1 1 13rem;min-width:0;min-height:44px;padding:0 1rem;border-radius:999px;border:1px solid var(--border);background:var(--bg-card);color:var(--text);font:inherit;font-size:16px}
.bf input:focus-visible,.bf button:focus-visible{outline:2px solid var(--accent);outline-offset:2px}
.bf button{min-height:44px;padding:0 1.1rem;border-radius:999px;border:1px solid var(--accent);background:transparent;color:var(--accent);font:inherit;font-size:.92rem;font-weight:600;cursor:pointer}
.bf button:disabled{opacity:.6;cursor:default}
.bf-dica{flex-basis:100%;font-size:.78rem;color:var(--text-muted)}
.bf-sug{flex-basis:100%;display:flex;flex-wrap:wrap;gap:.4rem}
.bf .bf-sug button{min-height:44px;padding:0 .95rem;font-size:.82rem;font-weight:500;border-color:var(--border);color:var(--text-2)}`;

/** O campo da busca (o script tira o `hidden`; sem JS, nada aparece). */
export function buscaHTML() {
  return `<form class="bf" id="bf-form" role="search" hidden>
      <input type="search" id="bf-q" name="q" maxlength="120" enterkeyhint="search" autocomplete="off" placeholder="Ex.: 10, bolo, palco" aria-label="Procurar nas fotos por número, palavra ou coisa">
      <button type="submit">Procurar</button>
      <span class="bf-dica">Número da camisa, palavra de uma faixa ou uma coisa. Ou toque num atalho:</span>
      <span class="bf-sug">${['jogo', 'comida', 'palco', 'bola', 'fantasia', 'bolo'].map(t => `<button type="button" data-bf="${t}">${t}</button>`).join('')}</span>
    </form>
    <section class="rs-res" id="bf-res" hidden aria-live="polite"><h2 id="bf-res-t" tabindex="-1"></h2><p id="bf-res-sub"></p><ul class="rs-grade" id="bf-grade"></ul></section>`;
}

// O script da busca: pergunta ao servidor e desenha a grade, como a do rosto.
// Tudo por textContent; a foto é a miniatura pública do lh3.
// Fora de crase, dollar-chave e barra invertida: é JS dentro de template literal.
export const SCRIPT_BUSCA = `(function () {
  var el = document.getElementById('bf-dados');
  var f = document.getElementById('bf-form');
  if (!el || !f || !window.fetch) return;
  var D = JSON.parse(el.textContent || '{}');
  var q = document.getElementById('bf-q');
  var bt = f.querySelector('button');
  f.hidden = false;
  // Os atalhos prontos (jogo, comida...): preenchem e procuram.
  f.addEventListener('click', function (e) {
    var b = e.target && e.target.closest ? e.target.closest('[data-bf]') : null;
    if (!b) return;
    q.value = b.getAttribute('data-bf');
    if (f.requestSubmit) f.requestSubmit(); else f.dispatchEvent(new Event('submit', { cancelable: true }));
  });
  f.addEventListener('submit', function (e) {
    e.preventDefault();
    var termo = (q.value || '').trim();
    if (!termo || bt.disabled) { q.focus(); return; }
    bt.disabled = true;
    bt.textContent = 'Procurando…';
    fetch('/api/busca?slug=' + encodeURIComponent(D.slug) + '&q=' + encodeURIComponent(termo), { credentials: 'same-origin', headers: { Accept: 'application/json' } })
      .then(function (r) {
        return r.json().catch(function () { return {}; }).then(function (j) {
          if (r.status === 429) throw new Error('Muita gente procurando agora. Tente de novo em alguns segundos.');
          if (!r.ok) throw new Error(j.error || 'A busca não respondeu. Tente de novo.');
          return j;
        });
      })
      .then(function (j) { mostra(termo, j.resultados || [], ''); })
      .catch(function (err) { mostra(termo, [], (err && err.message) || 'A busca não respondeu. Tente de novo.'); })
      .then(function () { bt.disabled = false; bt.textContent = 'Procurar'; });
  });
  function mostra(termo, lista, erro) {
    var sec = document.getElementById('bf-res');
    var t = document.getElementById('bf-res-t');
    var sub = document.getElementById('bf-res-sub');
    var grade = document.getElementById('bf-grade');
    grade.textContent = '';
    sec.hidden = false;
    t.textContent = erro ? 'Não deu para procurar' : lista.length ? (lista.length === 1 ? '1 foto com "' + termo + '"' : lista.length + ' fotos com "' + termo + '"') : 'Nenhuma foto com "' + termo + '"';
    sub.textContent = erro || (lista.length ? 'Toque para abrir.' : 'Tente outra palavra: um número, um nome de faixa ou uma coisa (palco, bolo, bola).');
    lista.forEach(function (r) {
      var li = document.createElement('li');
      var a = document.createElement('a');
      a.href = '/galeria/' + encodeURIComponent(D.slug) + (r.cap ? '/' + encodeURIComponent(r.cap) : '') + '#foto=' + encodeURIComponent(r.id);
      var img = document.createElement('img');
      img.src = 'https://lh3.googleusercontent.com/d/' + encodeURIComponent(r.id) + '=w320';
      img.alt = ''; img.loading = 'lazy'; img.decoding = 'async'; img.referrerPolicy = 'no-referrer';
      a.appendChild(img);
      if (r.cap && D.caps && D.caps[r.cap]) { var s = document.createElement('span'); s.textContent = D.caps[r.cap]; a.appendChild(s); }
      li.appendChild(a); grade.appendChild(li);
    });
    t.focus();
    sec.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }
})();`;
