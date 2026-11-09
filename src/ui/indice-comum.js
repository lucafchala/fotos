// Peças comuns às duas formas do índice da galeria por capítulos: o índice
// simples (galeria-indice.js) e a apresentação do álbum (album.js) — as "N
// novas" dos cartões e a busca pelo rosto. Ficam aqui para as duas páginas não
// divergirem.

import { honeypotFieldHTML } from '../security.js';
import { EPOCA_CRIADA_MS, NOVAS_SESSAO_MIN, NOVAS_RESUMO_MAX } from '../config.js';

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
      c.href = cartaoUlt.getAttribute('href') + '#foto=' + encodeURIComponent(ult.id);
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
export function rostoHTML() {
  return `<dialog class="rs" id="rs" aria-labelledby="rs-t">
    <form method="dialog" id="rs-form">
      <p class="rs-t" id="rs-t">Achar minhas fotos pelo rosto</p>
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
  <section class="rs-res" id="rs-res" hidden aria-live="polite"><h2 id="rs-res-t" tabindex="-1"></h2><p id="rs-res-sub"></p><div class="rs-grupos" id="rs-grade"></div><p class="rs-de-novo"><button type="button" class="rs-btn" id="rs-de-novo">Tentar com outra selfie</button> <button type="button" class="rs-link" id="rs-esquecer">Esquecer neste aparelho</button></p></section>`;
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
  function linkDaFoto(cap, id) { return BASE + (cap ? '/' + encodeURIComponent(cap) : (BASE ? '' : '/')) + '#foto=' + encodeURIComponent(id); }
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
        if (r.nova) a.className = 'rs-nova';
        var img = document.createElement('img');
        img.src = '/f/' + encodeURIComponent(r.id) + '/360';
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
    return s && s.j && Array.isArray(s.j.resultados) && s.j.resultados.length && Date.now() - s.em < 30 * 86400000 ? s : null;
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
      var novas = a.resultados.filter(function (r) { return !tem[r.id]; }).map(function (r) { return { cap: r.cap, id: r.id, sim: r.sim, nova: true }; });
      var j = { resultados: novas.concat(g.j.resultados.map(function (r) { return { cap: r.cap, id: r.id, sim: r.sim }; })), semIndice: false, faces: g.j.faces };
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
    if (!s || !s.j || Date.now() - s.em > 3 * 3600000) return;
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
    var alvo = typeof restaurando === 'string' ? grade.querySelector('a[data-id="' + restaurando.replace(/[^A-Za-z0-9_-]/g, '') + '"]') : null;
    if (alvo) { alvo.classList.add('rs-ultima'); alvo.scrollIntoView({ block: 'center' }); return; }
    t.focus({ preventScroll: !!restaurando });
    sec.scrollIntoView({ behavior: restaurando ? 'auto' : 'smooth', block: 'start' });
  }
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
.vz-img{position:absolute;inset:0;width:100%;height:100%;object-fit:contain;user-select:none;-webkit-user-select:none;transition:opacity .15s ease}
.vz-img.carregando{opacity:.35}
.vz-topo,.vz-base{position:absolute;left:0;right:0;display:flex;align-items:center;gap:.5rem;padding:max(.6rem,env(safe-area-inset-top)) max(.75rem,env(safe-area-inset-right)) .6rem max(.75rem,env(safe-area-inset-left));background:linear-gradient(rgba(0,0,0,.65),rgba(0,0,0,0));z-index:2}
.vz-topo{top:0}
.vz-base{bottom:0;padding:.6rem max(.75rem,env(safe-area-inset-right)) max(.8rem,env(safe-area-inset-bottom)) max(.75rem,env(safe-area-inset-left));background:linear-gradient(rgba(0,0,0,0),rgba(0,0,0,.7));justify-content:space-between;flex-wrap:wrap}
.vz-n{font-size:.85rem;opacity:.85;margin-right:auto;font-variant-numeric:tabular-nums}
.vz-ev{font-size:.95rem;font-weight:600;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;max-width:60vw}
.vz-b{display:inline-flex;align-items:center;justify-content:center;min-width:44px;min-height:44px;padding:0 .9rem;border-radius:999px;border:1px solid rgba(255,255,255,.35);background:rgba(0,0,0,.35);color:#fff;font:inherit;font-size:.9rem;text-decoration:none;cursor:pointer}
.vz-b:focus-visible{outline:2px solid #fff;outline-offset:2px}
.vz-baixar{background:#f9de4b;border-color:#f9de4b;color:#141a33;font-weight:700}
.vz-seta{position:absolute;top:50%;transform:translateY(-50%);z-index:2;width:48px;height:48px;padding:0;font-size:1.6rem;line-height:1}
.vz-ant{left:max(.5rem,env(safe-area-inset-left))}
.vz-prox{right:max(.5rem,env(safe-area-inset-right))}
.vz-seta[hidden]{display:none}
@media (hover:none){.vz-seta{display:none}}
`;

// Fora de crase, dollar-chave e barra invertida: é JS dentro de template literal.
export const SCRIPT_VISOR = `(function () {
  var dlg = null, img, nEl, evEl, verA, baixarA, antB, proxB, cheiaB, lista = [], i = 0, x0 = 0, y0 = 0, toque = false, empurrou = false;
  var LARGURAS = [480, 800, 1200, 1600, 2400];
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
    img = el('img', 'vz-img', { alt: '', decoding: 'async', referrerpolicy: 'no-referrer' });
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
    // Deslizar: para os lados troca a foto; para baixo fecha.
    dlg.addEventListener('pointerdown', function (e) { if (e.target === img) { toque = true; x0 = e.clientX; y0 = e.clientY; } });
    dlg.addEventListener('pointerup', function (e) {
      if (!toque) return;
      toque = false;
      var dx = e.clientX - x0, dy = e.clientY - y0;
      if (Math.abs(dx) > 45 && Math.abs(dx) > Math.abs(dy)) vai(dx < 0 ? i + 1 : i - 1);
      else if (dy > 90 && Math.abs(dy) > Math.abs(dx)) fecha();
    });
    dlg.addEventListener('pointercancel', function () { toque = false; });
    window.addEventListener('popstate', function () { if (dlg.open && empurrou) { empurrou = false; fechaJa(); } });
  }
  function src(id, w) { return '/f/' + encodeURIComponent(id) + '/' + w; }
  function vai(k) {
    if (k < 0 || k >= lista.length) return;
    i = k;
    var f = lista[i];
    img.classList.add('carregando');
    img.srcset = LARGURAS.map(function (w) { return src(f.id, w) + ' ' + w + 'w'; }).join(', ');
    img.sizes = '100vw';
    img.src = src(f.id, 1600);
    nEl.textContent = (i + 1) + ' de ' + lista.length;
    evEl.textContent = f.ev || '';
    verA.href = f.href;
    baixarA.href = f.baixar;
    antB.hidden = i === 0;
    proxB.hidden = i === lista.length - 1;
    // Já pede a vizinha: passar para a próxima não espera.
    [i + 1, i - 1].forEach(function (j) { if (lista[j]) { var p = new Image(); p.src = src(lista[j].id, 1200); } });
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
          id: fid, href: el.getAttribute('href'), ev: h && h.firstChild ? h.firstChild.textContent : '',
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
      <input type="search" id="bf-q" name="q" maxlength="120" enterkeyhint="search" autocomplete="off" placeholder="Ex.: 10, bolo, palco" aria-label="Procurar nas fotos por número, palavra ou coisa">
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
  function linkDaFoto(cap, id) { return BASE + (cap ? '/' + encodeURIComponent(cap) : (BASE ? '' : '/')) + '#foto=' + encodeURIComponent(id); }
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
        var img = document.createElement('img');
        img.src = '/f/' + encodeURIComponent(r.id) + '/360';
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
    if (s && Array.isArray(s.lista) && Date.now() - s.em < 3 * 3600000) {
      q.value = s.termo || '';
      var ult = '';
      try { ult = sessionStorage.getItem(ULT) || ''; } catch (e) { ult = ''; }
      mostra(s.termo || '', s.lista, '', ult || true);
    }
  }
})();`;
