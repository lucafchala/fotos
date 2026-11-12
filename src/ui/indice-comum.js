// Peças comuns às duas formas do índice da galeria por capítulos: o índice
// simples (galeria-indice.js) e a apresentação do álbum (album.js) — as "N
// novas" dos cartões e a busca pelo rosto. Ficam aqui para as duas páginas não
// divergirem.

import { honeypotFieldHTML } from '../security.js';
import { EPOCA_CRIADA_MS, NOVAS_SESSAO_MIN, NOVAS_RESUMO_MAX } from '../config.js';
import { EMBUTIDO_FONTE } from './navegador-embutido.js';

/** O CSS do diálogo e do resultado da busca pelo rosto (usa as variáveis de cor da página). */
export const ROSTO_CSS = `.ix-visto-m{display:inline-block;margin-left:.45rem;font-size:.7rem;opacity:.75}
.ix-visto-m::before{content:'✓ '}
.ix-continuar{display:flex;flex-direction:column;gap:.1rem;margin-top:.9rem;max-width:26rem;padding:.7rem 1rem;border-radius:12px;border:1px solid var(--border);background:var(--bg-card);color:var(--text);text-decoration:none;min-height:44px}
.ix-continuar span{font-size:.75rem;letter-spacing:.06em;text-transform:uppercase;color:var(--text-muted)}
.ix-continuar b{font-size:1rem}
.ix-continuar b::after{content:' →';color:var(--accent)}
.rs{margin:auto;width:min(30rem,calc(100vw - 2rem));max-height:calc(100dvh - 2rem);overflow:auto;border:1px solid var(--border);border-radius:14px;background:var(--bg-card);color:var(--text);padding:1.25rem 1.25rem 1rem}
.rs::backdrop{background:rgba(0,0,0,.6)}
.rs-t{font-size:1.1rem;font-weight:600;margin-bottom:.6rem}
.rs p,.rs li{font-size:.9rem;line-height:1.55;color:var(--text-2)}
.rs ul{margin:.6rem 0 .8rem 1.1rem}
.rs-aceite{display:flex;gap:.7rem;align-items:center;font-size:.9rem;line-height:1.45;margin:.6rem 0 .2rem;min-height:44px;padding:.35rem .7rem;border:1px solid var(--border);border-radius:12px;cursor:pointer}
.rs-aceite input{width:1.3rem;height:1.3rem;flex:none;accent-color:var(--accent)}
.rs .rs-pol{font-size:.8rem;margin:.35rem 0 .6rem;color:var(--text-muted)}
.rs .rs-pol a{color:var(--text-2);text-decoration:underline}
@media (max-width:520px){.rs-acoes{flex-direction:column-reverse;align-items:stretch}}
.rs-guia{display:flex;justify-content:center;color:var(--accent);margin:.2rem 0 .1rem}
.rs-guia svg{width:6.5rem;height:6.5rem}
.rs .rs-dicas{list-style:none;margin:.2rem 0 .6rem;padding:0;display:grid;gap:.3rem}
.rs .rs-dicas li{font-size:.84rem;padding-left:1.3rem;position:relative}
.rs .rs-dicas li::before{content:"";position:absolute;left:.15rem;top:.5em;width:.45rem;height:.45rem;border-radius:50%;background:var(--accent)}
.rs-nova{position:relative;outline:2px solid var(--accent);outline-offset:-2px}
.rs-nova::after{content:"nova";position:absolute;left:.35rem;top:.35rem;padding:.1rem .45rem;border-radius:999px;background:var(--accent);color:var(--bg-page);font-size:.7rem;font-weight:700}
.rs-talvez{margin-top:1.6rem;padding-top:1rem;border-top:1px dashed var(--border)}
.rs-talvez>p{font-size:.85rem;color:var(--text-muted);margin:.2rem 0 .6rem}
.rs-erro{color:var(--warn-text);min-height:1.2em;margin:.4rem 0}
.rs-acoes{display:flex;flex-wrap:wrap;justify-content:flex-end;gap:.5rem;margin-top:.6rem}
.rs-btn{min-height:44px;padding:0 1rem;border-radius:999px;border:1px solid var(--border);background:transparent;color:var(--text);font:inherit;font-size:.9rem;cursor:pointer}
.rs-btn-1{background:var(--accent);border-color:var(--accent);color:var(--bg-page);font-weight:600}
.rs-btn:disabled{opacity:.5;cursor:default}
.rs-link{background:none;border:0;color:var(--text-muted);font:inherit;font-size:.8rem;text-decoration:underline;cursor:pointer;min-height:44px;padding:0}
.rs-res{padding:1rem var(--pad) 0}
.rs-cartao-linha{margin-top:.9rem}
.rs-cartao{max-width:min(92vw,420px)}
.rs-cartao h2{font-size:1.05rem;font-weight:600}
.rs-cartao-sub{font-size:.82rem;color:var(--text-muted);margin:.3rem 0 .8rem}
#rs-cartao-cv{display:block;width:min(62vw,250px);height:auto;aspect-ratio:9/16;margin:0 auto;border-radius:12px;box-shadow:0 6px 24px rgba(0,0,0,.25)}
.rs-de-novo{margin-top:.9rem}
.rs-ev{margin-top:1.1rem}.rs-ev h3{display:flex;align-items:baseline;gap:.5rem;font-size:.98rem;font-weight:700;color:var(--text)}
.rs-ev h3 small{font-size:.78rem;font-weight:500;color:var(--text-muted)}
.rs-ev .rs-grade{margin-top:.5rem}
.rs-grade a.rs-ultima{outline:3px solid var(--accent);outline-offset:-3px}
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
  // (protegido: um navegador estranho não derruba as "N novas" abaixo)
  try {
    // Já visto (v3.8.0): o evento que esta pessoa já abriu neste aparelho ganha
    // a marca "visto"; o que não abriu fica sem (fácil achar o que falta ver).
    var todos = document.querySelectorAll('a.ix-card[data-cap]');
    for (var t = 0; t < todos.length; t++) {
      var visto = null;
      try { visto = localStorage.getItem('gal-visita:' + SLUG + ':' + todos[t].getAttribute('data-cap')); } catch (e) { visto = null; }
      if (!visto) continue;
      todos[t].classList.add('ix-visto');
      var vs = document.createElement('span');
      vs.className = 'ix-visto-m';
      vs.textContent = 'visto';
      var sb = todos[t].querySelector('.ix-sub');
      if (sb) sb.appendChild(vs);
    }
    // Continuar de onde parou (v3.8.0): a última foto aberta, por até 30 dias.
    var ult = null;
    try { ult = JSON.parse(localStorage.getItem('gal-ultima:' + SLUG) || 'null'); } catch (e) { ult = null; }
    var cartaoUlt = ult && ult.cap ? document.querySelector('a.ix-card[data-cap="' + String(ult.cap).replace(/[^a-z0-9-]/g, '') + '"]') : null;
    if (ult && cartaoUlt && typeof ult.id === 'string' && agora - ult.em < 30 * 86400000) {
      var c = document.createElement('a');
      c.className = 'ix-continuar';
      c.href = cartaoUlt.getAttribute('href') + '?foto=' + encodeURIComponent(ult.id);
      var k = document.createElement('span');
      k.textContent = 'Continuar de onde parou';
      var b = document.createElement('b');
      b.textContent = ult.nome || cartaoUlt.querySelector('b').textContent;
      c.appendChild(k); c.appendChild(b);
      var ondeBtns = document.querySelector('.al-btns') || document.querySelector('.ix-top');
      if (ondeBtns && ondeBtns.parentNode) ondeBtns.parentNode.insertBefore(c, ondeBtns.nextSibling);
    }
  } catch (e) { /* segue sem as marcas */ }
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
/** @param {string} [base] o começo dos links da galeria (para "Como funciona") */
export function rostoHTML(base) {
  return `<dialog class="rs" id="rs" aria-labelledby="rs-t">
    <form method="dialog" id="rs-form">
      <p class="rs-t" id="rs-t">Achar minhas fotos pelo rosto</p>
      <div id="rs-txt-buscar">
        <p>Tire uma selfie (ou escolha uma foto sua) e o site mostra as fotos do álbum em que você provavelmente aparece.</p>
        <ul>
          <li>A selfie vai para a Amazon Rekognition, em São Paulo, só para a comparação. Nem o site nem a Amazon a guardam.</li>
          <li>O resultado é aproximado: pode faltar foto e pode aparecer alguém parecido.</li>
          <li>Use só com o <strong>seu</strong> rosto.</li>
        </ul>${typeof base === 'string' ? `<p><a href="${base}/ajuda/rosto">Como funciona e dicas</a></p>` : ''}
      </div>
      <div id="rs-txt-sair" hidden>
        <p>Envie uma selfie e o site tira o seu rosto da busca deste álbum: ninguém mais acha as suas fotos por ela, nem as que chegarem depois.</p>
        <ul>
          <li>Para isso, o seu rosto fica guardado (só ele, só para esse fim) até o fim do álbum. Para apagar: privacidade@lucafchala.com.</li>
          <li>As fotos continuam no álbum. Para tirar uma foto, use "Pedir remoção" nela.</li>
        </ul>
      </div>
      <div class="rs-guia" id="rs-guia" aria-hidden="true">
        <svg viewBox="0 0 120 120"><ellipse cx="60" cy="56" rx="30" ry="38" fill="none" stroke="currentColor" stroke-width="3" stroke-dasharray="7 6"/><circle cx="49" cy="50" r="2.6" fill="currentColor"/><circle cx="71" cy="50" r="2.6" fill="currentColor"/><path d="M50 70c6 5 14 5 20 0" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round"/></svg>
      </div>
      <ul class="rs-dicas" id="rs-dicas">
        <li>Rosto inteiro dentro do oval, de frente, olhando para a câmera.</li>
        <li>Luz de frente (janela ou lâmpada à sua frente, não atrás).</li>
        <li>Sem óculos escuros, boné ou máscara. Só você na foto.</li>
      </ul>
      <label class="rs-aceite"><input type="checkbox" id="rs-aceite"><span>Concordo com o uso do meu rosto para isso.</span></label>
      <p class="rs-pol">Como funciona: <a href="/privacidade#busca-rosto" target="_blank" rel="noopener">política de privacidade</a>.</p>
      ${honeypotFieldHTML()}
      <div id="rs-ts"></div>
      <p class="rs-erro" id="rs-erro" role="alert"></p>
      <input type="file" id="rs-arquivo" accept="image/*" capture="user" hidden>
      <input type="file" id="rs-galeria" accept="image/*" hidden>
      <div class="rs-acoes">
        <button type="button" class="rs-btn" data-rs="fechar">Cancelar</button>
        <button type="button" class="rs-btn" id="rs-escolher" disabled>Escolher uma foto</button>
        <button type="button" class="rs-btn rs-btn-1" id="rs-tirar" disabled>Tirar selfie</button>
      </div>
      <p><button type="button" class="rs-link" id="rs-modo">Não quero aparecer na busca</button></p>
    </form>
  </dialog>
  <section class="rs-res" id="rs-res" hidden aria-live="polite"><h2 id="rs-res-t" tabindex="-1"></h2><p id="rs-res-sub"></p><div class="rs-grupos" id="rs-grade"></div><p class="rs-cartao-linha" id="rs-cartao-linha" hidden><button type="button" class="rs-btn rs-btn-1" id="rs-cartao-abrir">Criar cartão para os stories</button></p><p class="rs-de-novo"><button type="button" class="rs-btn" id="rs-de-novo">Tentar com outra selfie</button> <button type="button" class="rs-link" id="rs-esquecer">Esquecer neste aparelho</button></p></section>
  <dialog class="rs rs-cartao" id="rs-cartao" aria-labelledby="rs-cartao-t">
    <h2 id="rs-cartao-t">Seu cartão</h2>
    <p class="rs-cartao-sub">Feito aqui no seu celular, com as suas melhores fotos. Nada é enviado: só sai daqui se você compartilhar.</p>
    <canvas id="rs-cartao-cv" width="1080" height="1920" role="img" aria-label="Cartão com as suas fotos do álbum"></canvas>
    <div class="rs-acoes">
      <button type="button" class="rs-btn" id="rs-cartao-fechar">Fechar</button>
      <button type="button" class="rs-btn" id="rs-cartao-baixar">Baixar</button>
      <button type="button" class="rs-btn rs-btn-1" id="rs-cartao-enviar" hidden>Compartilhar</button>
    </div>
  </dialog>`;
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
  // Links curtos no domínio do álbum (v3.8.3): D.base é '' lá, /galeria/<slug> aqui.
  var BASE = typeof D.base === 'string' ? D.base : '/galeria/' + encodeURIComponent(D.slug);
  function linkDaFoto(cap, id) { return BASE + (cap ? '/' + encodeURIComponent(cap) : (BASE ? '' : '/')) + '?foto=' + encodeURIComponent(id); }
  // Por evento (v3.8.0): um título por evento, na ordem da linha do tempo do
  // álbum; dentro dele, as fotos na ordem em que vieram (no rosto, da mais
  // parecida para a menos).
  function porEvento(lista) {
    var pos = {};
    (D.ordem || []).forEach(function (c, i) { pos[c] = i; });
    var grupos = {}, ordem = [];
    lista.forEach(function (r) {
      var c = r.cap || '';
      if (!grupos[c]) { grupos[c] = []; ordem.push(c); }
      grupos[c].push(r);
    });
    ordem.sort(function (a, b) { return (a in pos ? pos[a] : 9999) - (b in pos ? pos[b] : 9999); });
    return ordem.map(function (c) { return { cap: c, nome: (D.caps && D.caps[c]) || 'Outras fotos', fotos: grupos[c] }; });
  }
  function desenhaGrupos(alvo, lista) {
    porEvento(lista).forEach(function (g) {
      var sec = document.createElement('section');
      sec.className = 'rs-ev';
      var h = document.createElement('h3');
      h.textContent = g.nome;
      var n = document.createElement('small');
      n.textContent = g.fotos.length === 1 ? '1 foto' : g.fotos.length + ' fotos';
      h.appendChild(n);
      sec.appendChild(h);
      var ul = document.createElement('ul');
      ul.className = 'rs-grade';
      g.fotos.forEach(function (r) {
        var li = document.createElement('li');
        var a = document.createElement('a');
        a.href = linkDaFoto(r.cap, r.id);
        a.setAttribute('data-id', r.id);
        a.setAttribute('data-cap', r.cap || '');
        // k: o álbum e a assinatura da foto, que o servidor manda com o achado
        // (v3.8.8); sem ele a rota das fotos responde 404.
        a.setAttribute('data-k', r.k || '');
        if (r.nova) a.className = 'rs-nova';
        var img = document.createElement('img');
        img.src = '/f/' + encodeURIComponent(r.id) + '/360' + (r.k ? '?k=' + encodeURIComponent(r.k) : '');
        img.alt = ''; img.loading = 'lazy'; img.decoding = 'async'; img.referrerPolicy = 'no-referrer';
        a.appendChild(img);
        li.appendChild(a); ul.appendChild(li);
      });
      sec.appendChild(ul);
      alvo.appendChild(sec);
    });
  }
  var aceite = document.getElementById('rs-aceite');
  var tirar = document.getElementById('rs-tirar');
  var arquivo = document.getElementById('rs-arquivo');
  var galeria = document.getElementById('rs-galeria');
  var escolher = document.getElementById('rs-escolher');
  var erro = document.getElementById('rs-erro');
  var modo = document.getElementById('rs-modo');
  var sair = false, token = '', widget = null, pre = null, preOk = true, ocupado = false, tsEstado = 'fora', tsFila = [];
  var CHAVE = 'rs-res:' + D.slug, ULT = 'rs-ult:' + D.slug;
  abrir.hidden = false;
  function msg(t) { erro.textContent = t || ''; }
  function botao() {
    tirar.disabled = escolher.disabled = ocupado || !aceite.checked || !token;
    tirar.textContent = ocupado ? 'Procurando…' : (aceite.checked && !token ? 'Só um instante…' : (sair ? 'Enviar selfie e sair' : 'Tirar selfie'));
    escolher.hidden = ocupado;
  }
  // O Turnstile (verificação anti-robô) carrega uma vez só, e cedo: v3.7.5.
  function carregaTs(cb) {
    if (tsEstado === 'pronto') { cb(); return; }
    if (tsEstado === 'falhou') return;
    tsFila.push(cb);
    if (tsEstado === 'carregando') return;
    tsEstado = 'carregando';
    var sc = document.createElement('script');
    sc.src = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit';
    sc.async = true;
    sc.onload = function () {
      if (!window.turnstile) { tsEstado = 'falhou'; msg('A verificação de segurança não carregou (um bloqueador pode estar impedindo).'); return; }
      tsEstado = 'pronto';
      var f = tsFila; tsFila = [];
      f.forEach(function (x) { x(); });
    };
    sc.onerror = function () { tsEstado = 'falhou'; msg('A verificação de segurança não carregou (um bloqueador pode estar impedindo).'); };
    document.head.appendChild(sc);
  }
  // Quem espera o token (a atualização de "minhas fotos", v3.8.3).
  var tsEspera = [];
  function quandoToken(cb) { if (token) cb(); else tsEspera.push(cb); }
  var cbs = {
    callback: function (t) { token = t; botao(); var f = tsEspera; tsEspera = []; f.forEach(function (x) { x(); }); },
    'expired-callback': function () { token = ''; botao(); }
  };
  // Assim que a página abre, o Turnstile já trabalha escondido: quando a pessoa
  // toca no botão, o token costuma estar pronto e o "Tirar selfie" já vale.
  // Se ele pedir interação (raro), o widget visível entra na janela.
  function prepara() {
    carregaTs(function () {
      var box = document.createElement('div');
      box.id = 'rs-ts-pre';
      box.setAttribute('aria-hidden', 'true');
      box.style.cssText = 'position:absolute;left:-10000px;top:0;width:300px;height:70px;overflow:hidden';
      document.body.appendChild(box);
      try {
        pre = window.turnstile.render(box, {
          sitekey: D.ts, appearance: 'interaction-only', callback: cbs.callback, 'expired-callback': cbs['expired-callback'],
          'error-callback': function () { preOk = false; token = ''; botao(); if (dlg.open) naJanela(); return true; },
          'before-interactive-callback': function () { preOk = false; if (dlg.open) naJanela(); }
        });
      } catch (e) { preOk = false; }
    });
  }
  function naJanela() {
    if (widget !== null) { if (window.turnstile) window.turnstile.reset(widget); return; }
    carregaTs(function () {
      widget = window.turnstile.render('#rs-ts', {
        sitekey: D.ts, callback: cbs.callback, 'expired-callback': cbs['expired-callback'],
        'error-callback': function () { token = ''; botao(); }
      });
    });
  }
  function turnstile() {
    if (token) return;
    if (preOk && tsEstado !== 'falhou') {
      // Ainda chegando: espera um pouco; se não vier, mostra o widget na janela.
      setTimeout(function () { if (!token && dlg.open) naJanela(); }, 5000);
      return;
    }
    naJanela();
  }
  function renova() {
    token = '';
    if (widget !== null && window.turnstile) window.turnstile.reset(widget);
    else if (pre !== null && window.turnstile) window.turnstile.reset(pre);
  }
  // Um token NOVO do Turnstile, ou erro se ele não vier a tempo.
  function tokenNovo() {
    return new Promise(function (ok, erro) {
      var prazo = setTimeout(function () { erro(new Error('A verificação de segurança demorou. Feche e tente de novo.')); }, 20000);
      renova();
      quandoToken(function () { clearTimeout(prazo); ok(); });
    });
  }
  function dorme(ms) { return new Promise(function (ok) { setTimeout(ok, ms); }); }
  // Muita gente buscando ao mesmo tempo (429): espera o que o servidor pediu e
  // tenta de novo sozinho, até "max" vezes, avisando na tela. A cada tentativa,
  // um token novo do Turnstile (v3.8.8): o servidor GASTA o token ao conferi-lo,
  // e reenviar o mesmo dava "verificação de segurança falhou" na segunda vez —
  // a nova tentativa falhava sempre, justamente no pico. "envia" devolve
  // { status, ok, corpo } e monta o pedido com o token do momento.
  function comNovasTentativas(envia, tokenNovo, dorme, avisa, max) {
    function vez(n) {
      return envia().then(function (res) {
        if (res.status !== 429 || n >= max) return res;
        var s = Math.min(20, Math.max(2, Number(res.corpo && res.corpo.retryAfter) || 3));
        avisa(s);
        return dorme(s * 1000).then(tokenNovo).then(function () { avisa(0); return vez(n + 1); });
      });
    }
    return vez(0);
  }
  if ('requestIdleCallback' in window) window.requestIdleCallback(prepara, { timeout: 2000 });
  else setTimeout(prepara, 800);
  function poeModo(s) {
    sair = s;
    document.getElementById('rs-t').textContent = s ? 'Sair da busca pelo rosto' : 'Achar minhas fotos pelo rosto';
    document.getElementById('rs-txt-buscar').hidden = s;
    document.getElementById('rs-txt-sair').hidden = !s;
    modo.textContent = s ? 'Quero achar minhas fotos' : 'Não quero aparecer na busca';
    msg('');
    botao();
  }
  abrir.addEventListener('click', function () { poeModo(false); aceite.checked = false; botao(); dlg.showModal(); turnstile(); });
  // "Não quero aparecer na busca", à vista na abertura (v3.8.5): abre a janela já no modo de sair.
  var sairP = document.getElementById('rs-sair-p');
  var sairBtn = document.getElementById('rs-sair-abrir');
  if (sairP && sairBtn) {
    sairP.hidden = false;
    sairBtn.addEventListener('click', function () { poeModo(true); aceite.checked = false; botao(); dlg.showModal(); turnstile(); });
  }
  modo.addEventListener('click', function () { poeModo(!sair); });
  aceite.addEventListener('change', botao);
  dlg.addEventListener('click', function (e) { if (e.target && e.target.getAttribute && e.target.getAttribute('data-rs') === 'fechar') dlg.close(); });
  tirar.addEventListener('click', function () { if (!tirar.disabled) arquivo.click(); });
  // "Escolher uma foto" (v3.8.2): da galeria ou dos arquivos, sem abrir a câmera.
  escolher.addEventListener('click', function () { if (!escolher.disabled) galeria.click(); });
  galeria.addEventListener('change', function () { processa(galeria); });
  arquivo.addEventListener('change', function () { processa(arquivo); });
  function processa(campo) {
    var f = campo.files && campo.files[0];
    campo.value = '';
    if (!f) return;
    ocupado = true; botao(); msg('');
    reduz(f).then(function (b64) {
      var hp = document.getElementById('company_website');
      // O corpo é montado A CADA tentativa, com o token do Turnstile da vez.
      function envia() {
        return fetch(sair ? '/api/rosto/sair' : '/api/rosto/buscar', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ slug: D.slug, imagem: b64, aceite: true, form_token: D.token, turnstileToken: token, company_website: hp ? hp.value : '' })
        }).then(function (r) {
          return r.json().catch(function () { return {}; }).then(function (j) { return { status: r.status, ok: r.ok, corpo: j }; });
        });
      }
      function avisa(s) { msg(s ? 'Muita gente procurando agora. Tentando de novo em ' + s + ' s…' : ''); }
      return comNovasTentativas(envia, tokenNovo, dorme, avisa, D.tentativas || 3).then(function (res) {
        if (!res.ok) throw new Error((res.corpo && res.corpo.error) || 'A busca não respondeu. Tente de novo.');
        return res.corpo;
      });
    }).then(function (j) {
      dlg.close();
      mostra(j);
    }).catch(function (e) {
      msg(e && e.message ? e.message : 'A busca não respondeu. Tente de novo.');
    }).then(function () {
      // O token vale uma vez: pede outro para a próxima busca. A mensagem de
      // erro fica na tela (antes, poeModo a apagava na hora e a pessoa não via
      // o "Não achei um rosto nessa foto").
      ocupado = false; renova();
      var aviso = erro.textContent;
      poeModo(sair);
      msg(aviso);
    });
  }
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
  // O resultado fica guardado nesta aba (sessionStorage: só os IDs das fotos,
  // nunca a selfie) e o endereço ganha #minhas-fotos: abrir uma foto e voltar
  // traz a lista de volta, rolada até a foto que foi aberta (v3.7.5).
  function guarda(j) {
    // faces: rostos do ÍNDICE do álbum (nunca a selfie), para atualizar a lista
    // quando chegarem fotos novas sem pedir outra selfie (v3.8.3).
    var dado = JSON.stringify({ em: Date.now(), j: { resultados: j.resultados || [], semIndice: !!j.semIndice, faces: (j.faces || []).slice(0, 4) } });
    try { sessionStorage.setItem(CHAVE, dado); } catch (e) { /* sem armazenamento: só não volta */ }
    // Guardadas por 30 dias neste aparelho (v3.8.0): "Ver minhas fotos" sem
    // nova selfie. Só os IDs das fotos; "Esquecer" apaga.
    try { localStorage.setItem(CHAVE, dado); } catch (e) { /* idem */ }
    try { history.replaceState(history.state, '', '#minhas-fotos'); } catch (e) { /* idem */ }
  }
  function salvas() {
    var s = null;
    try { s = JSON.parse(localStorage.getItem(CHAVE) || 'null'); } catch (e) { s = null; }
    return s && s.j && Array.isArray(s.j.resultados) && s.j.resultados.length && comChave(s.j.resultados) && Date.now() - s.em < 30 * 86400000 ? s : null;
  }
  // Lista guardada antes da v3.8.8 não tem o "k" de cada foto (o endereço
  // assinado): as miniaturas viriam quebradas. Vale como não guardada.
  function comChave(lista) {
    for (var i = 0; i < lista.length; i++) if (!lista[i] || !lista[i].k) return false;
    return true;
  }
  var guardadas = salvas();
  if (guardadas) {
    var ver = document.createElement('button');
    ver.type = 'button';
    ver.className = abrir.className.replace('al-b1', 'al-b2').replace('al-rosto', '');
    ver.id = 'rs-minhas';
    ver.textContent = 'Ver minhas fotos (' + guardadas.j.resultados.length + ')';
    ver.addEventListener('click', function () {
      var g = salvas();
      if (!g) return;
      mostra(g.j, true);
      if (g.j.faces && g.j.faces.length && Number(D.idx) > g.em) quandoToken(function () { atualiza(g); });
    });
    abrir.parentNode.insertBefore(ver, abrir.nextSibling);
  }
  // Chegaram fotos ao álbum depois da última busca: procura com os rostos
  // guardados e junta as novas, marcadas (v3.8.3). Em erro, fica a lista salva.
  function atualiza(g) {
    var sub = document.getElementById('rs-res-sub');
    var antes = sub.textContent;
    sub.textContent = 'Procurando fotos novas suas…';
    var hp = document.getElementById('company_website');
    fetch('/api/rosto/atualizar', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ slug: D.slug, faces: g.j.faces, aceite: true, form_token: D.token, turnstileToken: token, company_website: hp ? hp.value : '' })
    }).then(function (r) { return r.ok ? r.json() : null; }).then(function (a) {
      renova();
      if (!a || !Array.isArray(a.resultados)) { sub.textContent = antes; return; }
      var tem = {};
      g.j.resultados.forEach(function (r) { tem[r.id] = true; });
      var novas = a.resultados.filter(function (r) { return !tem[r.id]; }).map(function (r) { return { cap: r.cap, id: r.id, sim: r.sim, k: r.k, nova: true }; });
      var j = { resultados: novas.concat(g.j.resultados.map(function (r) { return { cap: r.cap, id: r.id, sim: r.sim, k: r.k }; })), semIndice: false, faces: g.j.faces };
      mostra(j);
      document.getElementById('rs-res-sub').textContent = novas.length ? (novas.length === 1 ? '1 foto nova sua desde a última vez, marcada.' : novas.length + ' fotos novas suas desde a última vez, marcadas.') : 'Nenhuma foto nova sua desde a última vez.';
      var b = document.getElementById('rs-minhas');
      if (b) b.textContent = 'Ver minhas fotos (' + j.resultados.length + ')';
    }).catch(function () { sub.textContent = antes; renova(); });
  }
  function restaura() {
    if (location.hash !== '#minhas-fotos') return;
    var s = null;
    try { s = JSON.parse(sessionStorage.getItem(CHAVE) || 'null'); } catch (e) { s = null; }
    if (!s || !s.j || !Array.isArray(s.j.resultados) || !comChave(s.j.resultados) || Date.now() - s.em > 3 * 3600000) return;
    var ult = '';
    try { ult = sessionStorage.getItem(ULT) || ''; } catch (e) { ult = ''; }
    mostra(s.j, ult || true);
  }
  document.getElementById('rs-grade').addEventListener('click', function (e) {
    var a = e.target && e.target.closest ? e.target.closest('a[data-id]') : null;
    if (a) try { sessionStorage.setItem(ULT, a.getAttribute('data-id')); } catch (err) { /* idem */ }
  });
  document.getElementById('rs-de-novo').addEventListener('click', function () { abrir.click(); });
  document.getElementById('rs-esquecer').addEventListener('click', function () {
    try { localStorage.removeItem(CHAVE); sessionStorage.removeItem(CHAVE); localStorage.removeItem(ULT); } catch (e) { /* idem */ }
    var m = document.getElementById('rs-minhas');
    if (m) m.remove();
    document.getElementById('rs-res').hidden = true;
  });
  function mostra(j, restaurando) {
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
      // Quase certo primeiro; abaixo de D.certo, o grupo "Talvez seja você" (v3.8.2).
      var todas = j.resultados || [];
      var certo = Number(D.certo) || 80;
      var lista = todas.filter(function (r) { return !(Number(r.sim) < certo); });
      var talvez = todas.filter(function (r) { return Number(r.sim) < certo; });
      var nEv = porEvento(lista).length;
      t.textContent = lista.length ? (lista.length === 1 ? '1 foto em que pode ser você' : lista.length + ' fotos em que pode ser você' + (nEv > 1 ? ', em ' + nEv + ' eventos' : '')) : (talvez.length ? 'Talvez seja você' : 'Nenhuma foto encontrada');
      sub.textContent = j.semIndice ? 'O álbum ainda está sendo preparado para a busca. Tente de novo mais tarde.' : (todas.length ? 'Separadas por evento, das mais parecidas para as menos. Toque para abrir.' + (talvez.length && lista.length ? ' Mais ' + talvez.length + ' em "Talvez seja você", no fim.' : '') : 'Tente outra selfie, de frente e com boa luz.');
      desenhaGrupos(grade, lista);
      cartaoLista = lista;
      document.getElementById('rs-cartao-linha').hidden = !lista.length;
      if (talvez.length) {
        var tz = document.createElement('section');
        tz.className = 'rs-talvez';
        if (lista.length) {
          var th = document.createElement('h3');
          th.textContent = 'Talvez seja você (' + talvez.length + ')';
          tz.appendChild(th);
        }
        var tp = document.createElement('p');
        tp.textContent = 'Menos parecidas: confira uma por uma. Pode ser você de lado, de longe ou com pouca luz.';
        tz.appendChild(tp);
        desenhaGrupos(tz, talvez);
        grade.appendChild(tz);
      }
      if (!restaurando) guarda(j);
    }
    document.getElementById('rs-de-novo').parentNode.hidden = j.removidas !== undefined;
    if (j.removidas !== undefined) document.getElementById('rs-cartao-linha').hidden = true;
    var alvo = typeof restaurando === 'string' ? grade.querySelector('a[data-id="' + restaurando.replace(/[^A-Za-z0-9_-]/g, '') + '"]') : null;
    if (alvo) { alvo.classList.add('rs-ultima'); alvo.scrollIntoView({ block: 'center' }); return; }
    t.focus({ preventScroll: !!restaurando });
    sec.scrollIntoView({ behavior: restaurando ? 'auto' : 'smooth', block: 'start' });
  }

  // Cartão "minhas fotos" para os stories (v3.9.0): montado AQUI, num canvas,
  // com as fotos do resultado (as mesmas miniaturas assinadas da grade, do
  // próprio site). Nada vai ao servidor; a pessoa escolhe se compartilha.
  var cartaoLista = [];
  var arqCartao = null;
  var dlgC = document.getElementById('rs-cartao');
  var cv = document.getElementById('rs-cartao-cv');
  var btEnviar = document.getElementById('rs-cartao-enviar');
  function cor(nome, padrao) {
    var v = getComputedStyle(document.documentElement).getPropertyValue(nome).trim();
    return v || padrao;
  }
  function carregaFoto(r) {
    return new Promise(function (ok) {
      var im = new Image();
      im.decoding = 'async';
      im.onload = function () { ok(im); };
      im.onerror = function () { ok(null); };
      im.src = '/f/' + encodeURIComponent(r.id) + '/800' + (r.k ? '?k=' + encodeURIComponent(r.k) : '');
    });
  }
  // A melhor de cada evento primeiro (variedade), depois as mais parecidas.
  function escolheFotos(lista) {
    var out = [];
    porEvento(lista).forEach(function (g) { if (out.length < 6) out.push(g.fotos[0]); });
    for (var i = 0; out.length < 6 && i < lista.length; i++) if (out.indexOf(lista[i]) < 0) out.push(lista[i]);
    return out;
  }
  function cobre(ctx, im, x, y, w, h, raio) {
    ctx.save();
    ctx.beginPath();
    if (ctx.roundRect) ctx.roundRect(x, y, w, h, raio); else ctx.rect(x, y, w, h);
    ctx.clip();
    var e = Math.max(w / im.naturalWidth, h / im.naturalHeight);
    var iw = im.naturalWidth * e, ih = im.naturalHeight * e;
    ctx.drawImage(im, x + (w - iw) / 2, y + (h - ih) / 2, iw, ih);
    ctx.restore();
  }
  function quebra(ctx, texto, max, maxLinhas) {
    var palavras = String(texto || '').split(' '), linhas = [], atual = '';
    palavras.forEach(function (p) {
      var t = atual ? atual + ' ' + p : p;
      if (ctx.measureText(t).width > max && atual) { linhas.push(atual); atual = p; } else atual = t;
    });
    if (atual) linhas.push(atual);
    if (linhas.length > maxLinhas) { linhas = linhas.slice(0, maxLinhas); linhas[maxLinhas - 1] += '…'; }
    return linhas;
  }
  function desenhaCartao(fotos) {
    var W = 1080, H = 1920, M = 80;
    var ctx = cv.getContext('2d');
    var fundo = cor('--bg-page', '#111317'), texto = cor('--text', '#f2f0ea'), mudo = cor('--text-muted', '#a2a5b0'), destaque = cor('--accent', '#e8c34a');
    var h1 = document.querySelector('h1');
    var fTit = getComputedStyle(h1 || document.body).fontFamily;
    var fTxt = getComputedStyle(document.body).fontFamily;
    ctx.fillStyle = fundo;
    ctx.fillRect(0, 0, W, H);
    ctx.fillStyle = destaque;
    ctx.fillRect(M, 150, 72, 8);
    ctx.textBaseline = 'alphabetic';
    ctx.fillStyle = mudo;
    ctx.font = '600 34px ' + fTxt;
    ctx.fillText('MINHAS FOTOS NO ÁLBUM', M, 220);
    ctx.fillStyle = texto;
    ctx.font = '700 78px ' + fTit;
    var tit = quebra(ctx, D.titulo || document.title, W - 2 * M, 2);
    tit.forEach(function (l, i) { ctx.fillText(l, M, 320 + i * 92); });
    var topo = 320 + tit.length * 92 + 10;
    var base = 1500, gap = 18, raio = 28;
    var ok = fotos.filter(Boolean);
    var n = ok.length;
    var cols = n > 1 ? 2 : 1;
    var cheia = n > 1 && n % 2 === 1;
    var linhas = cheia ? 1 + (n - 1) / 2 : Math.ceil(n / cols);
    var lh = (base - topo - gap * (linhas - 1)) / linhas;
    var cw = (W - 2 * M - gap * (cols - 1)) / cols;
    var i = 0, y = topo;
    if (cheia || n === 1) { cobre(ctx, ok[0], M, y, W - 2 * M, lh, raio); i = 1; y += lh + gap; }
    for (; i < n; i += 2) {
      cobre(ctx, ok[i], M, y, cw, lh, raio);
      if (ok[i + 1]) cobre(ctx, ok[i + 1], M + cw + gap, y, cw, lh, raio);
      y += lh + gap;
    }
    var total = cartaoLista.length, nEv = porEvento(cartaoLista).length;
    ctx.fillStyle = texto;
    ctx.font = '700 60px ' + fTit;
    ctx.fillText(total === 1 ? '1 foto minha' : total + ' fotos minhas', M, base + 110);
    ctx.fillStyle = mudo;
    ctx.font = '500 38px ' + fTxt;
    if (nEv > 1) ctx.fillText('em ' + nEv + ' eventos', M, base + 170);
    ctx.fillText('Ache as suas em', M, H - 150);
    ctx.fillStyle = destaque;
    var ender = location.host + (BASE || '');
    var tam = 56;
    do { ctx.font = '700 ' + tam + 'px ' + fTxt; tam -= 2; } while (tam > 24 && ctx.measureText(ender).width > W - 2 * M);
    ctx.fillText(ender, M, H - 80);
  }
  document.getElementById('rs-cartao-abrir').addEventListener('click', function () {
    var bt = this;
    if (!cartaoLista.length || !cv.getContext) return;
    bt.disabled = true;
    var antes = bt.textContent;
    bt.textContent = 'Montando o cartão…';
    Promise.all(escolheFotos(cartaoLista).map(carregaFoto)).then(function (ims) {
      if (!ims.filter(Boolean).length) throw new Error('sem fotos');
      desenhaCartao(ims);
      return new Promise(function (ok) { cv.toBlob(ok, 'image/jpeg', 0.9); });
    }).then(function (blob) {
      arqCartao = blob && typeof File === 'function' ? new File([blob], 'minhas-fotos.jpg', { type: 'image/jpeg' }) : blob;
      var pode = false;
      try { pode = !!(arqCartao && navigator.canShare && navigator.canShare({ files: [arqCartao] })); } catch (e) { pode = false; }
      btEnviar.hidden = !pode;
      dlgC.showModal();
    }).catch(function () {
      bt.textContent = 'Não deu para montar o cartão. Tente de novo.';
      setTimeout(function () { bt.textContent = antes; }, 3000);
    }).then(function () { bt.disabled = false; if (bt.textContent === 'Montando o cartão…') bt.textContent = antes; });
  });
  btEnviar.addEventListener('click', function () {
    if (!arqCartao) return;
    navigator.share({ files: [arqCartao], text: 'Ache as suas fotos em ' + location.origin + (BASE || '/') }).catch(function () {});
  });
  document.getElementById('rs-cartao-baixar').addEventListener('click', function () {
    if (!arqCartao) return;
    var a = document.createElement('a');
    a.href = URL.createObjectURL(arqCartao);
    a.download = 'minhas-fotos.jpg';
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(function () { URL.revokeObjectURL(a.href); }, 30000);
  });
  document.getElementById('rs-cartao-fechar').addEventListener('click', function () { dlgC.close(); });
  dlgC.addEventListener('click', function (e) { if (e.target === dlgC) dlgC.close(); });
  restaura();
})();`;


// ---------------------------------------------------------------------------
// Visualizador das "minhas fotos" e da busca (v3.8.6): tocar numa foto do
// resultado abre em tela cheia e dá para passar por TODAS as do resultado,
// de todos os eventos (deslizar, setas do teclado, botões). "Ver no evento" e
// "Baixar" em cada uma. Sem biblioteca: as fotos vêm de /f/<id>/<largura>.
// ---------------------------------------------------------------------------
export const VISOR_CSS = `
.vz{position:fixed;inset:0;width:100vw;max-width:none;height:100dvh;max-height:none;margin:0;padding:0;border:0;background:#000;color:#fff;overflow:hidden;touch-action:none}
.vz::backdrop{background:#000}
.vz-img{position:absolute;inset:0;width:100%;height:100%;object-fit:contain;user-select:none;-webkit-user-select:none;-webkit-user-drag:none;-webkit-touch-callout:none;transition:opacity .15s ease}
.vz-img.carregando{opacity:.35}
.vz-img{transform-origin:50% 50%;will-change:transform}
.vz.vz-zoom .vz-topo,.vz.vz-zoom .vz-base,.vz.vz-zoom .vz-seta{opacity:.15;transition:opacity .2s}
.vz-topo,.vz-base{position:absolute;left:0;right:0;display:flex;align-items:center;gap:.5rem;padding:max(.6rem,env(safe-area-inset-top)) max(.75rem,env(safe-area-inset-right)) .6rem max(.75rem,env(safe-area-inset-left));background:linear-gradient(rgba(0,0,0,.65),rgba(0,0,0,0));z-index:2}
.vz-topo{top:0}
.vz-base{bottom:0;padding:.6rem max(.75rem,env(safe-area-inset-right)) max(.8rem,env(safe-area-inset-bottom)) max(.75rem,env(safe-area-inset-left));background:linear-gradient(rgba(0,0,0,0),rgba(0,0,0,.7));justify-content:space-between;flex-wrap:wrap}
.vz-n{font-size:.85rem;opacity:.85;margin-right:auto;font-variant-numeric:tabular-nums}
.vz-ev{font-size:.95rem;font-weight:600;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;max-width:60vw}
.vz-b{display:inline-flex;align-items:center;justify-content:center;min-width:44px;min-height:44px;padding:0 .9rem;border-radius:999px;border:1px solid rgba(255,255,255,.35);background:rgba(0,0,0,.35);color:#fff;font:inherit;font-size:.9rem;text-decoration:none;cursor:pointer}
.vz-b:focus-visible{outline:2px solid #fff;outline-offset:2px}
.vz-baixar{background:#f9de4b;border-color:#f9de4b;color:#141a33;font-weight:700}
.vz-seta{position:absolute;top:50%;transform:translateY(-50%);z-index:2;width:48px;height:48px;padding:0;font-size:1.6rem;line-height:1;background:rgba(0,0,0,.45)}
.vz-ant{left:max(.5rem,env(safe-area-inset-left))}
.vz-prox{right:max(.5rem,env(safe-area-inset-right))}
.vz-seta[hidden]{display:none}
`;

// Fora de crase, dollar-chave e barra invertida: é JS dentro de template literal.
export const SCRIPT_VISOR = `(function () {
  var dlg = null, img, nEl, evEl, verA, baixarA, antB, proxB, cheiaB, lista = [], i = 0, x0 = 0, y0 = 0, toque = false, empurrou = false;
  var LARGURAS = [480, 800, 1200, 1600, 2400, 3200];
  // Zoom (v3.8.7): pinça com dois dedos, toque duplo, clique duplo ou rodinha.
  var escala = 1, tx = 0, ty = 0, pinca = null, ultimoToque = 0, ultimoX = 0, ultimoY = 0, arrasto = null, fimDoToque = 0;
  function monta() {
    // Montado por createElement (sem innerHTML, como os outros scripts da página).
    function el(tag, cls, attrs, texto) {
      var n = document.createElement(tag);
      if (cls) n.className = cls;
      Object.keys(attrs || {}).forEach(function (k) { n.setAttribute(k, attrs[k]); });
      if (texto) n.textContent = texto;
      return n;
    }
    dlg = el('dialog', 'vz', { 'aria-label': 'Foto em tela cheia' });
    img = el('img', 'vz-img', { alt: '', decoding: 'async', referrerpolicy: 'no-referrer', draggable: 'false' });
    var topo = el('div', 'vz-topo');
    nEl = el('span', 'vz-n', { 'aria-live': 'polite' });
    cheiaB = el('button', 'vz-b', { type: 'button', 'data-vz': 'cheia' }, 'Tela cheia');
    cheiaB.hidden = true;
    var fecharB = el('button', 'vz-b', { type: 'button', 'data-vz': 'fechar', 'aria-label': 'Fechar' }, '✕');
    topo.appendChild(nEl); topo.appendChild(cheiaB); topo.appendChild(fecharB);
    antB = el('button', 'vz-b vz-seta vz-ant', { type: 'button', 'data-vz': 'ant', 'aria-label': 'Foto anterior' }, '‹');
    proxB = el('button', 'vz-b vz-seta vz-prox', { type: 'button', 'data-vz': 'prox', 'aria-label': 'Próxima foto' }, '›');
    var base = el('div', 'vz-base');
    evEl = el('span', 'vz-ev');
    verA = el('a', 'vz-b', { 'data-vz': 'ver' }, 'Ver no evento');
    baixarA = el('a', 'vz-b vz-baixar', { 'data-vz': 'baixar', download: '' }, 'Baixar');
    base.appendChild(evEl); base.appendChild(verA); base.appendChild(baixarA);
    [img, topo, antB, proxB, base].forEach(function (n) { dlg.appendChild(n); });
    document.body.appendChild(dlg);
    if (document.fullscreenEnabled && dlg.requestFullscreen) cheiaB.hidden = false;
    img.addEventListener('load', function () { img.classList.remove('carregando'); });
    dlg.addEventListener('click', function (e) {
      var a = e.target && e.target.closest ? e.target.closest('[data-vz]') : null;
      if (!a) return;
      var o = a.getAttribute('data-vz');
      if (o === 'fechar') fecha();
      else if (o === 'ant') vai(i - 1);
      else if (o === 'prox') vai(i + 1);
      else if (o === 'cheia') { if (document.fullscreenElement) document.exitFullscreen(); else dlg.requestFullscreen().catch(function () {}); }
    });
    dlg.addEventListener('keydown', function (e) {
      if (e.key === 'ArrowLeft') { e.preventDefault(); vai(i - 1); }
      else if (e.key === 'ArrowRight') { e.preventDefault(); vai(i + 1); }
    });
    dlg.addEventListener('cancel', function (e) { e.preventDefault(); fecha(); });
    // Deslizar: para os lados troca a foto; para baixo fecha (só sem zoom). No
    // celular pelos eventos de TOQUE (v3.8.7: o iPhone cancelava o gesto do
    // ponteiro sobre a imagem e parecia que só havia uma foto); no computador,
    // pelo mouse.
    function gesto(dx, dy) {
      if (escala > 1) return;
      if (Math.abs(dx) > 40 && Math.abs(dx) > Math.abs(dy)) vai(dx < 0 ? i + 1 : i - 1);
      else if (dy > 90 && Math.abs(dy) > Math.abs(dx)) fecha();
    }
    function controle(t) { return t && t.closest && t.closest('[data-vz]'); }
    function dist(a, b) { return Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY); }
    dlg.addEventListener('touchstart', function (e) {
      if (controle(e.target)) { toque = false; pinca = null; return; }
      if (e.touches.length === 2) {
        toque = false;
        pinca = { d: dist(e.touches[0], e.touches[1]), e: escala, mx: (e.touches[0].clientX + e.touches[1].clientX) / 2, my: (e.touches[0].clientY + e.touches[1].clientY) / 2, tx: tx, ty: ty };
        return;
      }
      if (e.touches.length !== 1) return;
      toque = true; x0 = e.touches[0].clientX; y0 = e.touches[0].clientY;
      arrasto = escala > 1 ? { x: x0, y: y0, tx: tx, ty: ty } : null;
    }, { passive: true });
    dlg.addEventListener('touchmove', function (e) {
      if (pinca && e.touches.length === 2) {
        e.preventDefault();
        var nova = Math.min(4, Math.max(1, pinca.e * dist(e.touches[0], e.touches[1]) / pinca.d));
        // Mantém parado o ponto entre os dedos.
        var k = nova / pinca.e;
        var cx = window.innerWidth / 2, cy = window.innerHeight / 2;
        aplica(nova, pinca.tx * k + (pinca.mx - cx) * (1 - k), pinca.ty * k + (pinca.my - cy) * (1 - k));
        return;
      }
      if (toque) {
        e.preventDefault();
        if (arrasto) aplica(escala, arrasto.tx + e.touches[0].clientX - arrasto.x, arrasto.ty + e.touches[0].clientY - arrasto.y);
      }
    }, { passive: false });
    dlg.addEventListener('touchend', function (e) {
      fimDoToque = Date.now();
      if (pinca) { if (e.touches.length < 2) { pinca = null; if (escala < 1.05) aplica(1, 0, 0); } return; }
      if (!toque) return;
      toque = false;
      var t = e.changedTouches[0];
      var agora = Date.now();
      var parado = Math.abs(t.clientX - x0) < 12 && Math.abs(t.clientY - y0) < 12;
      // Toque duplo: amplia no ponto tocado; de novo, volta.
      if (parado && agora - ultimoToque < 320 && Math.abs(t.clientX - ultimoX) < 30 && Math.abs(t.clientY - ultimoY) < 30) { ultimoToque = 0; alterna(t.clientX, t.clientY); return; }
      if (parado) { ultimoToque = agora; ultimoX = t.clientX; ultimoY = t.clientY; return; }
      if (!arrasto) gesto(t.clientX - x0, t.clientY - y0);
      arrasto = null;
    });
    dlg.addEventListener('touchcancel', function () { toque = false; pinca = null; arrasto = null; });
    var mouse = false;
    dlg.addEventListener('pointerdown', function (e) { if (e.pointerType === 'mouse' && !controle(e.target)) { mouse = true; x0 = e.clientX; y0 = e.clientY; arrasto = escala > 1 ? { x: x0, y: y0, tx: tx, ty: ty } : null; } });
    dlg.addEventListener('pointermove', function (e) { if (mouse && arrasto) aplica(escala, arrasto.tx + e.clientX - arrasto.x, arrasto.ty + e.clientY - arrasto.y); });
    dlg.addEventListener('pointerup', function (e) { if (!mouse) return; mouse = false; if (!arrasto) gesto(e.clientX - x0, e.clientY - y0); arrasto = null; });
    // O celular também gera um clique duplo de mouse depois do toque duplo: ignorado.
    img.addEventListener('dblclick', function (e) { if (Date.now() - fimDoToque > 800) alterna(e.clientX, e.clientY); });
    dlg.addEventListener('wheel', function (e) {
      if (controle(e.target)) return;
      e.preventDefault();
      var nova = Math.min(4, Math.max(1, escala * (e.deltaY < 0 ? 1.15 : 1 / 1.15)));
      var k = nova / escala, cx = window.innerWidth / 2, cy = window.innerHeight / 2;
      if (nova === 1) aplica(1, 0, 0); else aplica(nova, tx * k + (e.clientX - cx) * (1 - k), ty * k + (e.clientY - cy) * (1 - k));
    }, { passive: false });
    img.addEventListener('dragstart', function (e) { e.preventDefault(); });
    window.addEventListener('popstate', function () { if (dlg.open && empurrou) { empurrou = false; fechaJa(); } });
  }
  // f.k: o álbum e a assinatura da foto (v3.8.8), lidos do link da grade.
  function src(f, w) { return '/f/' + encodeURIComponent(f.id) + '/' + w + (f.k ? '?k=' + encodeURIComponent(f.k) : ''); }
  // Aplica o zoom; a foto não sai da tela. Ampliada, pede a versão maior.
  function aplica(e, x, y) {
    escala = e;
    var mx = (escala - 1) * window.innerWidth / 2, my = (escala - 1) * window.innerHeight / 2;
    tx = Math.max(-mx, Math.min(mx, x)); ty = Math.max(-my, Math.min(my, y));
    img.style.transform = escala > 1 ? 'translate(' + tx + 'px,' + ty + 'px) scale(' + escala + ')' : '';
    if (escala > 1.3 && img.sizes !== '300vw') img.sizes = '300vw';
    dlg.classList.toggle('vz-zoom', escala > 1);
  }
  function alterna(x, y) {
    if (escala > 1) { aplica(1, 0, 0); return; }
    var cx = window.innerWidth / 2, cy = window.innerHeight / 2;
    aplica(2.5, (cx - x) * 1.5, (cy - y) * 1.5);
  }
  function vai(k) {
    if (k < 0 || k >= lista.length) return;
    i = k;
    var f = lista[i];
    img.classList.add('carregando');
    aplica(1, 0, 0);
    img.srcset = LARGURAS.map(function (w) { return src(f, w) + ' ' + w + 'w'; }).join(', ');
    img.sizes = '100vw';
    img.src = src(f, 1600);
    nEl.textContent = (i + 1) + ' de ' + lista.length;
    evEl.textContent = f.ev || '';
    verA.href = f.href;
    baixarA.href = f.baixar;
    antB.hidden = i === 0;
    proxB.hidden = i === lista.length - 1;
    // Já pede a vizinha: passar para a próxima não espera.
    [i + 1, i - 1].forEach(function (j) { if (lista[j]) { var p = new Image(); p.src = src(lista[j], 1200); } });
    if (f.aoAbrir) f.aoAbrir();
  }
  function fechaJa() { if (document.fullscreenElement) document.exitFullscreen().catch(function () {}); dlg.close(); img.removeAttribute('src'); img.removeAttribute('srcset'); }
  function fecha() { if (empurrou) { empurrou = false; history.back(); } fechaJa(); }
  window.fotosVisor = function (itens, k) {
    if (!dlg) monta();
    lista = itens;
    if (!dlg.open) {
      dlg.showModal();
      // Voltar (botão do celular) fecha a foto, não sai da página.
      try { history.pushState({ vz: 1 }, '', location.href); empurrou = true; } catch (e) { empurrou = false; }
    }
    vai(k);
    var b = dlg.querySelector('[data-vz="fechar"]');
    if (b) b.focus({ preventScroll: true });
  };
  // Liga as grades de resultado (minhas fotos e busca): toque abre o visor;
  // com Ctrl/Cmd/meio, segue o link (nova aba).
  function liga(id, slug, chaveUlt) {
    var grade = document.getElementById(id);
    if (!grade) return;
    grade.addEventListener('click', function (e) {
      var a = e.target && e.target.closest ? e.target.closest('a[data-id]') : null;
      if (!a || e.metaKey || e.ctrlKey || e.shiftKey || e.button === 1) return;
      e.preventDefault();
      var as = grade.querySelectorAll('a[data-id]');
      var itens = [], k = 0;
      for (var j = 0; j < as.length; j++) {
        var el = as[j];
        if (el === a) k = j;
        var sec = el.closest('.rs-ev');
        var h = sec ? sec.querySelector('h3') : null;
        var cap = el.getAttribute('data-cap') || '';
        var fid = el.getAttribute('data-id');
        itens.push({
          id: fid, k: el.getAttribute('data-k') || '', href: el.getAttribute('href'), ev: h && h.firstChild ? h.firstChild.textContent : '',
          baixar: '/galeria/' + encodeURIComponent(slug) + (cap ? '/' + encodeURIComponent(cap) : '') + '/baixar/' + encodeURIComponent(fid),
          aoAbrir: (function (x) { return function () { try { sessionStorage.setItem(chaveUlt, x); } catch (er) { /* sem armazenamento */ } }; })(fid)
        });
      }
      window.fotosVisor(itens, k);
    }, true);
  }
  var rs = document.getElementById('rs-dados'), bf = document.getElementById('bf-dados');
  try { if (rs) { var dr = JSON.parse(rs.textContent || '{}'); liga('rs-grade', dr.slug, 'rs-ult:' + dr.slug); } } catch (e) { /* sem visor */ }
  try { if (bf) { var db = JSON.parse(bf.textContent || '{}'); liga('bf-grade', db.slug, 'bf-ult:' + db.slug); } } catch (e) { /* sem visor */ }
})();`;

// ---------------------------------------------------------------------------
// Aviso de fotos novas no celular (v3.8.4) — ver src/aviso.js
// ---------------------------------------------------------------------------
// Fora de crase, dollar-chave e barra invertida: é JS dentro de template literal.
export const SCRIPT_AVISO = `(function () {
  var el = document.getElementById('av');
  if (!el) return;
  var btn = document.getElementById('av-btn');
  var txt = document.getElementById('av-txt');
  var msg = document.getElementById('av-msg');
  var slug = el.getAttribute('data-slug');
  var ios = /iP(hone|ad|od)/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  var instalado = (window.matchMedia && window.matchMedia('(display-mode: standalone)').matches) || navigator.standalone === true;
  var temPush = 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;
  if (!temPush) {
    // Navegador de dentro de um app (v3.11.0, src/ui/navegador-embutido.js):
    // ali não há aviso, e "Adicionar à Tela de Início" nem existe. O caminho
    // é abrir o álbum no navegador de verdade.
    if (new RegExp(${JSON.stringify(EMBUTIDO_FONTE)}).test(navigator.userAgent || '')) { el.hidden = false; btn.hidden = true; msg.textContent = 'Quer aviso de foto nova? Abra o álbum no navegador do celular (Safari ou Chrome): dentro deste aplicativo os avisos não funcionam.'; return; }
    // iPhone fora da Tela de Início: o Safari só manda aviso para o site instalado.
    if (ios && !instalado) { el.hidden = false; btn.hidden = true; msg.textContent = 'Quer aviso de foto nova no iPhone? Toque em Compartilhar, depois em "Adicionar à Tela de Início", e abra o álbum pelo ícone.'; }
    return;
  }
  el.hidden = false;
  var reg = null;
  function estado(on) { txt.textContent = on ? 'Avisos de foto nova ligados · Desligar' : 'Avisar quando chegar foto nova'; btn.setAttribute('aria-pressed', on ? 'true' : 'false'); }
  function chave(b64) {
    var s = atob(b64.replace(/-/g, '+').replace(/_/g, '/'));
    var u = new Uint8Array(s.length);
    for (var i = 0; i < s.length; i++) u[i] = s.charCodeAt(i);
    return u;
  }
  function post(rota, corpo) { return fetch(rota, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(corpo) }); }
  function registra() { return reg ? Promise.resolve(reg) : navigator.serviceWorker.register('/sw.js').then(function (r) { reg = r; return r; }); }
  // O botão já aparece; o estado (ligado ou não) chega quando o registro sai.
  registra().then(function (r) { return r.pushManager.getSubscription(); }).then(function (s) { estado(!!s); }).catch(function () { /* tenta de novo no toque */ });
  btn.addEventListener('click', function () {
    btn.disabled = true; msg.textContent = '';
    registra().then(function () { return reg.pushManager.getSubscription(); }).then(function (s) {
      if (s) {
        return post('/api/aviso/sair', { slug: slug, endpoint: s.endpoint }).then(function () { return s.unsubscribe(); })
          .then(function () { estado(false); msg.textContent = 'Avisos desligados.'; });
      }
      return Notification.requestPermission().then(function (p) {
        if (p !== 'granted') { msg.textContent = 'O navegador não deixou mandar avisos. Dá para liberar nas configurações do site.'; return null; }
        return fetch('/api/aviso/chave').then(function (r) { return r.json(); })
          .then(function (j) { return reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: chave(j.chave) }); })
          .then(function (sub) {
            var j = sub.toJSON();
            return post('/api/aviso/inscrever', { slug: slug, sub: { endpoint: j.endpoint, keys: j.keys } }).then(function (r) {
              if (!r.ok) throw new Error('inscrição');
              estado(true);
              msg.textContent = 'Pronto: você recebe um aviso quando chegarem fotos novas.';
            });
          });
      });
    }).catch(function () { msg.textContent = 'Não deu para ligar os avisos agora. Tente de novo.'; })
      .then(function () { btn.disabled = false; });
  });
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
      <input type="search" id="bf-q" name="q" maxlength="120" enterkeyhint="search" autocomplete="off" placeholder="Procurar nas fotos" aria-label="Procurar nas fotos por número, palavra ou coisa">
      <button type="submit">Procurar</button>
      <span class="bf-dica">Número da camisa, palavra de uma faixa ou uma coisa. Ou toque num atalho:</span>
      <span class="bf-sug">${['jogo', 'comida', 'palco', 'bola', 'fantasia', 'bolo'].map(t => `<button type="button" data-bf="${t}">${t}</button>`).join('')}</span>
    </form>
    <section class="rs-res" id="bf-res" hidden aria-live="polite"><h2 id="bf-res-t" tabindex="-1"></h2><p id="bf-res-sub"></p><div class="rs-grupos" id="bf-grade"></div></section>`;
}

// O script da busca: pergunta ao servidor e desenha a grade, como a do rosto.
// Tudo por textContent; a foto é a miniatura pública do lh3.
// Fora de crase, dollar-chave e barra invertida: é JS dentro de template literal.
export const SCRIPT_BUSCA = `(function () {
  var el = document.getElementById('bf-dados');
  var f = document.getElementById('bf-form');
  if (!el || !f || !window.fetch) return;
  var D = JSON.parse(el.textContent || '{}');
  // Links curtos no domínio do álbum (v3.8.3): D.base é '' lá, /galeria/<slug> aqui.
  var BASE = typeof D.base === 'string' ? D.base : '/galeria/' + encodeURIComponent(D.slug);
  function linkDaFoto(cap, id) { return BASE + (cap ? '/' + encodeURIComponent(cap) : (BASE ? '' : '/')) + '?foto=' + encodeURIComponent(id); }
  // Por evento (v3.8.0): um título por evento, na ordem da linha do tempo do
  // álbum; dentro dele, as fotos na ordem em que vieram (no rosto, da mais
  // parecida para a menos).
  function porEvento(lista) {
    var pos = {};
    (D.ordem || []).forEach(function (c, i) { pos[c] = i; });
    var grupos = {}, ordem = [];
    lista.forEach(function (r) {
      var c = r.cap || '';
      if (!grupos[c]) { grupos[c] = []; ordem.push(c); }
      grupos[c].push(r);
    });
    ordem.sort(function (a, b) { return (a in pos ? pos[a] : 9999) - (b in pos ? pos[b] : 9999); });
    return ordem.map(function (c) { return { cap: c, nome: (D.caps && D.caps[c]) || 'Outras fotos', fotos: grupos[c] }; });
  }
  function desenhaGrupos(alvo, lista) {
    porEvento(lista).forEach(function (g) {
      var sec = document.createElement('section');
      sec.className = 'rs-ev';
      var h = document.createElement('h3');
      h.textContent = g.nome;
      var n = document.createElement('small');
      n.textContent = g.fotos.length === 1 ? '1 foto' : g.fotos.length + ' fotos';
      h.appendChild(n);
      sec.appendChild(h);
      var ul = document.createElement('ul');
      ul.className = 'rs-grade';
      g.fotos.forEach(function (r) {
        var li = document.createElement('li');
        var a = document.createElement('a');
        a.href = linkDaFoto(r.cap, r.id);
        a.setAttribute('data-id', r.id);
        a.setAttribute('data-cap', r.cap || '');
        a.setAttribute('data-k', r.k || '');
        var img = document.createElement('img');
        img.src = '/f/' + encodeURIComponent(r.id) + '/360' + (r.k ? '?k=' + encodeURIComponent(r.k) : '');
        img.alt = ''; img.loading = 'lazy'; img.decoding = 'async'; img.referrerPolicy = 'no-referrer';
        a.appendChild(img);
        li.appendChild(a); ul.appendChild(li);
      });
      sec.appendChild(ul);
      alvo.appendChild(sec);
    });
  }
  var q = document.getElementById('bf-q');
  var bt = f.querySelector('button');
  var CHAVE = 'bf-res:' + D.slug, ULT = 'bf-ult:' + D.slug;
  f.hidden = false;
  // Como na busca pelo rosto: o resultado fica nesta aba e volta ao voltar
  // de uma foto (#busca=termo), rolado até a foto aberta (v3.7.5).
  document.getElementById('bf-grade').addEventListener('click', function (e) {
    var a = e.target && e.target.closest ? e.target.closest('a[data-id]') : null;
    if (a) try { sessionStorage.setItem(ULT, a.getAttribute('data-id')); } catch (err) { /* sem armazenamento */ }
  });
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
      .then(function (j) {
        var lista = j.resultados || [];
        mostra(termo, lista, '');
        try { sessionStorage.setItem(CHAVE, JSON.stringify({ em: Date.now(), termo: termo, lista: lista })); } catch (err) { /* idem */ }
        try { history.replaceState(history.state, '', '#busca=' + encodeURIComponent(termo)); } catch (err) { /* idem */ }
      })
      .catch(function (err) { mostra(termo, [], (err && err.message) || 'A busca não respondeu. Tente de novo.'); })
      .then(function () { bt.disabled = false; bt.textContent = 'Procurar'; });
  });
  function mostra(termo, lista, erro, restaurando) {
    var sec = document.getElementById('bf-res');
    var t = document.getElementById('bf-res-t');
    var sub = document.getElementById('bf-res-sub');
    var grade = document.getElementById('bf-grade');
    grade.textContent = '';
    sec.hidden = false;
    t.textContent = erro ? 'Não deu para procurar' : lista.length ? (lista.length === 1 ? '1 foto com "' + termo + '"' : lista.length + ' fotos com "' + termo + '"') : 'Nenhuma foto com "' + termo + '"';
    sub.textContent = erro || (lista.length ? 'Toque para abrir.' : 'Tente outra palavra: um número, um nome de faixa ou uma coisa (palco, bolo, bola).');
    desenhaGrupos(grade, lista);
    var alvo = typeof restaurando === 'string' ? grade.querySelector('a[data-id="' + restaurando.replace(/[^A-Za-z0-9_-]/g, '') + '"]') : null;
    if (alvo) { alvo.classList.add('rs-ultima'); alvo.scrollIntoView({ block: 'center' }); return; }
    t.focus({ preventScroll: !!restaurando });
    sec.scrollIntoView({ behavior: restaurando ? 'auto' : 'smooth', block: 'start' });
  }
  if (location.hash.indexOf('#busca=') === 0) {
    var s = null;
    try { s = JSON.parse(sessionStorage.getItem(CHAVE) || 'null'); } catch (e) { s = null; }
    if (s && Array.isArray(s.lista) && s.lista.every(function (r) { return r && r.k; }) && Date.now() - s.em < 3 * 3600000) {
      q.value = s.termo || '';
      var ult = '';
      try { ult = sessionStorage.getItem(ULT) || ''; } catch (e) { ult = ''; }
      mostra(s.termo || '', s.lista, '', ult || true);
    }
  }
})();`;
