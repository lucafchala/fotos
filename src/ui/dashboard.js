import { sortEvents, hojeEmSaoPaulo, AGENDA_MAX_LEN, escape, jsonParaScript, safeUrl, fontPreloadHTML, fontFaceCSS } from '../utils.js';
import { PASSWORD_MIN_LENGTH } from '../security.js';
import { TURNSTILE_SITE_KEY } from '../config.js';

const BASE = `
${fontFaceCSS()}
*,*::before,*::after{box-sizing:border-box;margin:0;padding:0}
:root{--bg:#0d0d0d;--bg2:#141414;--bg3:#1a1a1a;--border:#222;--text:#f0ebe5;--text2:#999;--text3:#555;--accent:#f0ebe5;--red:#c0392b;--green:#27ae60;--radius:10px}
body{font-family:'Inter',sans-serif;background:var(--bg);color:var(--text);min-height:100vh;-webkit-text-size-adjust:100%}
input,textarea,select,button{font-family:inherit;font-size:inherit}
button{cursor:pointer}
/* Sem o retângulo azul do toque (Android): cada botão tem o próprio estado. */
button,a,summary{-webkit-tap-highlight-color:transparent}
:focus-visible{outline:2px solid #c0a060;outline-offset:2px}
`;

// Sem modo "criar senha": o painel NÃO tem trust-on-first-use. Sem credencial
// em KV e sem o secret ADMIN_PASSWORD o login é impossível, em vez de ficar
// disponível para quem chegar primeiro (ver handleLogin em src/index.js) — e
// `handleDashboardPage` responde 503 nesse estado, nunca um formulário.
//
// O ramo `isSetup` daqui era o resto dessa versão anterior: desenhava um
// "Criar senha de acesso" com campo de confirmação e um hidden `setup=1` que
// nenhum handler lia. Ninguém nunca passou a opção, então a tela era
// inalcançável — mas ficava no arquivo parecendo um caminho vivo, e um campo
// de senha que o servidor ignora é a pior coisa para se encontrar numa leitura
// de código de autenticação. Se o cadastro inicial voltar, ele volta com
// handler, não só com formulário.
/**
 * @param {{ error?: boolean, indisponivel?: boolean, verificacao?: boolean }} [opts]
 *   `error`: senha recusada. `indisponivel`: o KV recusou ler o hash ou gravar
 *   a sessão — a senha pode estar certa, e dizer "incorreta" aqui mandaria o
 *   dono desconfiar dela no dia em que o problema era o banco.
 *   `verificacao`: o Turnstile recusou o token (ou ele não veio). Não diz nada
 *   sobre a senha — a mesma tela sai com senha certa ou errada (#167).
 * @param {string} [nonce]
 */
export function loginHTML(opts = {}, nonce = '') {
  const { error = false, indisponivel = false, verificacao = false } = opts;

  return `<!DOCTYPE html>
<html lang="pt-BR">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta name="robots" content="noindex,nofollow">
  <title>Dashboard · fotos</title>
  <link rel="manifest" href="/manifest.json">
  <meta name="theme-color" content="#0a0a0a">
  <link rel="apple-touch-icon" href="/icon.svg">
  <link rel="icon" type="image/svg+xml" href="/icon.svg">
  ${fontPreloadHTML()}
  <script nonce="${nonce}" src="https://challenges.cloudflare.com/turnstile/v0/api.js" async defer data-onerror="loginTsBlocked"></script>
  <script nonce="${nonce}">document.addEventListener('error', function(e){ if (e.target && e.target.dataset && e.target.dataset.onerror === 'loginTsBlocked') window.__loginTsBlocked = true; }, true);</script>
  <style>
    ${BASE}
    body{display:flex;align-items:center;justify-content:center;padding:2rem 1rem;min-height:100vh}
    .box{width:100%;max-width:380px}
    .logo{text-align:center;margin-bottom:2.5rem}
    .logo span{font-size:.9rem;font-weight:300;letter-spacing:.2em;text-transform:lowercase;color:var(--text2)}
    .logo strong{font-weight:600;color:var(--text)}
    h1{font-size:1rem;font-weight:500;margin-bottom:.4rem;color:var(--text)}
    .subtitle{font-size:.8rem;color:var(--text3);margin-bottom:2rem}
    .field{display:flex;flex-direction:column;gap:.5rem;margin-bottom:1.25rem}
    label{font-size:.75rem;font-weight:500;letter-spacing:.06em;text-transform:uppercase;color:var(--text3)}
    input[type=password]{width:100%;background:var(--bg2);border:1px solid var(--border);color:var(--text);padding:.875rem 1rem;border-radius:var(--radius);font-size:1rem;outline:none;transition:border-color .2s;-webkit-appearance:none}
    input[type=password]:focus{border-color:#444}
    .btn-primary{width:100%;background:var(--accent);color:#0a0a0a;padding:.9rem;border:none;border-radius:var(--radius);font-size:.9rem;font-weight:600;letter-spacing:.02em;margin-top:.5rem;transition:opacity .2s,transform .15s;-webkit-appearance:none}
    .btn-primary:hover:not(:disabled){opacity:.9;transform:translateY(-1px)}
    .btn-primary:active:not(:disabled){transform:translateY(0)}
    .btn-primary:disabled{opacity:.45;cursor:not-allowed}
    .cf-turnstile{min-height:65px;margin-bottom:.75rem}
    .error-msg{background:#1a0a0a;border:1px solid #3a1010;color:#e07070;font-size:.8rem;padding:.75rem 1rem;border-radius:8px;margin-bottom:1.25rem}
    .aviso{background:#1a1408;border:1px solid #3a2c10;color:#e0b870;font-size:.8rem;padding:.75rem 1rem;border-radius:8px;margin-bottom:1rem}
  </style>
</head>
<body>
  <div class="box">
    <div class="logo"><span>fotos · <strong>Luca F. Chala</strong></span></div>
    <h1>Painel administrativo</h1>
    <p class="subtitle">Entre para gerenciar os projetos.</p>
    ${indisponivel
      ? `<div class="error-msg" role="alert">Não foi possível entrar agora: o banco de dados do site não respondeu. Sua senha não foi recusada — tente de novo em alguns minutos.</div>`
      : verificacao
        ? `<div class="error-msg" role="alert">Não deu para entrar: a verificação anti-robô não passou. Recarregue a página e tente de novo — se o quadro de verificação não aparecer, desative o bloqueador de anúncios para este site.</div>`
        : error ? `<div class="error-msg" role="alert">Senha incorreta. Tente novamente.</div>` : ''}
    <form method="POST" action="/dashboard/login">
      <div class="field">
        <label for="password">Senha</label>
        <input type="password" id="password" name="password" required autocomplete="current-password" placeholder="••••••••" autofocus>
      </div>
      <div class="cf-turnstile" data-sitekey="${escape(TURNSTILE_SITE_KEY)}" data-callback="onLoginTs" data-error-callback="onLoginTsErro" data-expired-callback="onLoginTsExpirou"></div>
      <div class="aviso" id="login-adblock" role="alert" style="display:none">A verificação anti-robô não carregou — quase sempre é um bloqueador de anúncios. Desative-o para este site e recarregue a página.</div>
      <button type="submit" class="btn-primary" id="login-btn" disabled>Entrar</button>
    </form>
    <noscript><div class="aviso">O painel precisa de JavaScript ligado.</div></noscript>
    <script nonce="${nonce}">
      function loginBtn(){return document.getElementById('login-btn');}
      function avisoBloqueio(){var a=document.getElementById('login-adblock');if(a)a.style.display='';}
      function onLoginTs(){var b=loginBtn();if(b)b.disabled=false;}
      function onLoginTsExpirou(){var b=loginBtn();if(b)b.disabled=true;}
      // Erro do widget não pode deixar o dono num botão morto: o botão volta
      // (o servidor responde com a mensagem certa) e o aviso aparece.
      function onLoginTsErro(){onLoginTs();avisoBloqueio();}
      if(window.__loginTsBlocked)avisoBloqueio();
      setTimeout(function(){if(typeof turnstile==='undefined'||window.__loginTsBlocked){avisoBloqueio();onLoginTs();}},5000);
    </script>
  </div>
</body>
</html>`;
}

/** @type {Record<string, string>} */
const STATUS_LABELS_SSR = { 'em-edicao': 'Em edição', 'em-revisao': 'Em revisão', 'entregue': 'Entregue', 'arquivado': 'Arquivado' };

// ---------------------------------------------------------------------------
// Ícones do painel
// ---------------------------------------------------------------------------
// SVG em linha: nenhuma requisição a mais, herdam a cor do texto
// (stroke="currentColor") e não dependem de fonte de ícones. Vão para o
// cliente como dado (jsonParaScript), então o card redesenhado no navegador
// usa exatamente os mesmos.
/** @param {string} corpo */
const svg = corpo => `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${corpo}</svg>`;
export const ICONES = {
  projetos: svg('<rect x="3" y="3" width="7" height="7" rx="1.5"/><rect x="14" y="3" width="7" height="7" rx="1.5"/><rect x="3" y="14" width="7" height="7" rx="1.5"/><rect x="14" y="14" width="7" height="7" rx="1.5"/>'),
  pedidos: svg('<path d="M22 12h-6l-2 3h-4l-2-3H2"/><path d="M5.45 5.11L2 12v6a2 2 0 002 2h16a2 2 0 002-2v-6l-3.45-6.89A2 2 0 0016.76 4H7.24a2 2 0 00-1.79 1.11z"/>'),
  metricas: svg('<line x1="6" y1="20" x2="6" y2="12"/><line x1="12" y1="20" x2="12" y2="5"/><line x1="18" y1="20" x2="18" y2="9"/>'),
  ajustes: svg('<line x1="4" y1="6" x2="20" y2="6"/><line x1="4" y1="12" x2="20" y2="12"/><line x1="4" y1="18" x2="20" y2="18"/><circle cx="9" cy="6" r="2" fill="currentColor"/><circle cx="15" cy="12" r="2" fill="currentColor"/><circle cx="8" cy="18" r="2" fill="currentColor"/>'),
  camera: svg('<rect x="3" y="6" width="18" height="14" rx="2"/><circle cx="12" cy="13" r="3.5"/><path d="M9 6l1.5-2h3L15 6"/>'),
  editar: svg('<path d="M12 20h9"/><path d="M16.5 3.5a2.12 2.12 0 013 3L7 19l-4 1 1-4z"/>'),
  galeria: svg('<rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><path d="M21 15l-5-5L5 21"/>'),
  mais: svg('<circle cx="5" cy="12" r="1.2" fill="currentColor"/><circle cx="12" cy="12" r="1.2" fill="currentColor"/><circle cx="19" cy="12" r="1.2" fill="currentColor"/>'),
  destaque: svg('<path d="M12 2l3 7h4l-3.5 5 1.5 7L12 18l-5 3 1.5-7L5 9h4z"/>'),
  ocultar: svg('<path d="M17.94 17.94A10.07 10.07 0 0112 20c-7 0-11-8-11-8a18.45 18.45 0 015.06-5.94M9.9 4.24A9.12 9.12 0 0112 4c7 0 11 8 11 8a18.5 18.5 0 01-2.16 3.19"/><line x1="1" y1="1" x2="23" y2="23"/>'),
  mostrar: svg('<path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/>'),
  abrir: svg('<path d="M18 13v6a2 2 0 01-2 2H5a2 2 0 01-2-2V8a2 2 0 012-2h6"/><polyline points="15 3 21 3 21 9"/><line x1="10" y1="14" x2="21" y2="3"/>'),
  duplicar: svg('<rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 01-2-2V4a2 2 0 012-2h9a2 2 0 012 2v1"/>'),
  excluir: svg('<polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 01-2 2H8a2 2 0 01-2-2L5 6"/><path d="M10 11v6"/><path d="M14 11v6"/><path d="M9 6V4h6v2"/>'),
};

// ---------------------------------------------------------------------------
// Card de projeto — UMA fonte para o servidor e para o navegador
// ---------------------------------------------------------------------------
// A lista de projetos é desenhada duas vezes: pelo servidor (primeira
// pintura, sem esperar o JS) e pelo script da página (depois de cada ação,
// busca e filtro). Até out/2026 eram dois templates escritos à mão, e cada
// mudança no card precisava cair nos dois — o comentário antigo do CSS
// admitia consertar "só no CSS" para não ter de mexer duas vezes.
//
// Agora a MESMA função faz os dois: o servidor a chama aqui, e o script do
// cliente recebe o código dela (Function.prototype.toString, em
// dashboardHTML). Por isso a regra desta função: NADA de variável de fora
// dela. Tudo o que ela usa chega pelos parâmetros — no navegador não existe o
// escopo deste módulo, e o bundler pode até renomear o que é de fora.
// tests/painel.test.js prova as duas coisas: o texto injetado é esta função,
// e o card que ela devolve é o mesmo dos dois lados.
/**
 * @param {any} e o projeto (evento)
 * @param {{
 *   esc: (s: unknown) => string,
 *   safeUrl: (u: unknown) => string,
 *   rotulo: (st: string) => string,
 *   atrasado: (e: any) => boolean,
 *   icones: Record<string, string>,
 * }} h ajudantes do lado que chama
 * @param {boolean | null} [marcado] null fora do modo de seleção; no modo,
 *   se a caixa vem marcada
 * @returns {string}
 */
export function cardProjetoPainel(e, h, marcado) {
  const id = h.esc(e.id);
  const slug = h.esc(e.slug);
  const titulo = h.esc(e.title);
  const st = e.status || 'entregue';
  const visivel = e.visible !== false;
  const selecao = marcado === true || marcado === false;
  const thumb = e.thumbnailUrl
    ? '<img class="evt-thumb" src="' + h.esc(h.safeUrl(e.thumbnailUrl)) + '" alt="" loading="lazy" data-onerror="hide">'
    : '<div class="evt-thumb-ph">' + h.icones.camera + '</div>';
  // A data do evento é um dia do calendário ("2026-10-04"), não um instante:
  // vira dd/mm/aaaa por texto, sem passar por Date (que a moveria de fuso).
  const d = typeof e.date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(e.date) ? e.date : '';
  const meta = ['<span class="evt-slug">/' + slug + '</span>'];
  if (d) meta.push(d.slice(8, 10) + '/' + d.slice(5, 7) + '/' + d.slice(0, 4));
  if (e.category) meta.push(h.esc(e.category));
  // O prazo só interessa enquanto não entregou (#220: "prazo" no card).
  const prazo = typeof e.promisedDate === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(e.promisedDate)
    && st !== 'entregue' && st !== 'arquivado' ? e.promisedDate : '';
  if (prazo) meta.push('prazo ' + prazo.slice(8, 10) + '/' + prazo.slice(5, 7));
  // O estado que antes só aparecia na cor de um ícone agora é escrito.
  const selos = ['<span class="status-badge st-' + h.esc(st) + '">' + h.esc(h.rotulo(st)) + '</span>'];
  if (h.atrasado(e)) selos.push('<span class="status-badge st-atrasado">Atrasado</span>');
  if (e.pinned) selos.push('<span class="status-badge st-destaque">Destaque</span>');
  if (!visivel) selos.push('<span class="status-badge st-oculto">Oculto</span>');
  if (e.comingSoon) selos.push('<span class="status-badge st-embreve">Em breve</span>');
  if (e.accessType === 'private' || e.accessType === 'family') {
    selos.push('<span class="status-badge st-acesso">' + (e.accessType === 'family' ? 'Familiar' : 'Privado') + '</span>');
  }
  // Os itens do menu vão escritos um a um, sem uma função auxiliar com nome
  // aqui dentro: o deploy empacota com esbuild e `keepNames`, que embrulha
  // toda função nomeada num `__name(...)` definido no topo do bundle — e este
  // código roda no NAVEGADOR, onde `__name` não existe. Os testes (que rodam o
  // fonte sem empacotar) não veriam; tests/painel.test.js aplica a mesma
  // transformação do deploy para pegar isso.
  const itemMenu = '<button type="button" class="menu-item" role="menuitem" data-id="' + id + '" data-action=';
  return '<div class="evt-item' + (visivel ? '' : ' hidden-evt') + (selecao ? ' com-check' : '') + '" id="evt-' + id + '">'
    + (selecao ? '<input type="checkbox" class="evt-check" data-id="' + id + '" aria-label="Selecionar ' + titulo + '"' + (marcado ? ' checked' : '') + '>' : '')
    + thumb
    + '<div class="evt-info">'
    + '<div class="evt-name">' + titulo + '</div>'
    + '<div class="evt-meta">' + meta.join(' · ') + '</div>'
    + '<div class="evt-selos">' + selos.join('') + '</div>'
    + '</div>'
    + '<div class="evt-actions">'
    + '<button type="button" class="act act-edit" data-action="edit" data-id="' + id + '">' + h.icones.editar + '<span>Editar</span></button>'
    + '<a class="act act-gal" href="/galeria/' + slug + '" title="Galeria no site (prévia, só você vê)">' + h.icones.galeria + '<span>Galeria</span></a>'
    + '<div class="mais">'
    + '<button type="button" class="act act-mais" data-action="menu" data-id="' + id + '" aria-haspopup="menu" aria-expanded="false" aria-label="Mais ações: ' + titulo + '">' + h.icones.mais + '</button>'
    + '<div class="menu" role="menu" aria-label="Ações: ' + titulo + '" hidden>'
    + itemMenu + '"pin">' + h.icones.destaque + '<span>' + (e.pinned ? 'Remover destaque' : 'Destacar na galeria') + '</span></button>'
    + itemMenu + '"vis">' + (visivel ? h.icones.ocultar : h.icones.mostrar) + '<span>' + (visivel ? 'Ocultar da galeria' : 'Mostrar na galeria') + '</span></button>'
    + '<a class="menu-item" role="menuitem" href="/' + slug + '" target="_blank" rel="noopener">' + h.icones.abrir + '<span>Abrir a página do projeto</span></a>'
    + itemMenu + '"dup">' + h.icones.duplicar + '<span>Duplicar</span></button>'
    + '<div class="menu-sep" role="separator"></div>'
    + '<button type="button" class="menu-item danger" role="menuitem" data-id="' + id + '" data-action="del">' + h.icones.excluir + '<span>Excluir…</span></button>'
    + '</div>'
    + '</div>'
    + '</div>'
    + '</div>';
}

/**
 * @param {import('../utils.js').Evento[]} events
 * @param {string[]} [categories]
 * @param {string} [nonce]
 * @param {string} [agenda] selo de agenda (#211)
 */
export function dashboardHTML(events, categories = [], nonce = '', agenda = '') {
  const eventsJSON = jsonParaScript(events);
  const categoriesJSON = jsonParaScript(categories);

  const esc = escape; // canonical 5-char escaper (also escapes '), shared with the gallery/event pages
  const catOptionsBody = categories.map(c => `<option value="${esc(c)}">${esc(c)}</option>`).join('');
  const catOptionsSSR = '<option value="">Sem categoria</option>' + catOptionsBody;
  const catFilterOptionsSSR = '<option value="">Todas as categorias</option>' + catOptionsBody;
  // A primeira pintura mostra o mesmo recorte que o filtro padrão do cliente
  // ("Todos"), para a lista não mudar de tamanho quando o script assume.
  const sorted = sortEvents(events);
  /** @param {number} n */
  const noun = n => n === 1 ? 'evento' : 'eventos';
  const ssrCount = `${sorted.length} ${noun(sorted.length)}`;
  // "Atrasado": data prometida já passou e o evento ainda não foi entregue
  // (arquivado não conta — já saiu do fluxo de produção).
  // Hoje em São Paulo, não em UTC (#192) — senão "Atrasado" às 21:00 do
  // próprio dia prometido.
  const todayISO = hojeEmSaoPaulo();
  /** @param {import('../utils.js').Evento} e */
  const isOverdue = e => !!e.promisedDate && e.promisedDate < todayISO
    && (e.status || 'entregue') !== 'entregue' && (e.status || 'entregue') !== 'arquivado';
  // Os ajudantes do lado do SERVIDOR para o card compartilhado. O cliente
  // monta os dele (ajudaCard, no script) com as cópias de esc/safeUrl que os
  // pares cliente/servidor de tests/security.test.js mantêm iguais a estes.
  const ajudaServidor = {
    esc,
    safeUrl,
    rotulo: (/** @type {string} */ st) => STATUS_LABELS_SSR[st] || st,
    atrasado: isOverdue,
    icones: ICONES,
  };
  const ssrList = sorted.length === 0
    ? '<p class="empty">Nenhum evento ainda. Toque em "Novo evento" para criar o primeiro.</p>'
    : sorted.map(e => cardProjetoPainel(e, ajudaServidor, null)).join('');


  return `<!DOCTYPE html>
<html lang="pt-BR">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta name="robots" content="noindex,nofollow">
  <title>Dashboard · fotos</title>
  <link rel="manifest" href="/manifest.json">
  <meta name="theme-color" content="#0a0a0a">
  <link rel="apple-touch-icon" href="/icon.svg">
  <link rel="icon" type="image/svg+xml" href="/icon.svg">
  ${fontPreloadHTML()}
  <style>
    ${BASE}
    /* ================================================================
       Estrutura do painel (redesenho em blocos, out/2026)
       ----------------------------------------------------------------
       Uma <nav> só, com as quatro seções. No computador (>= 900 px) ela
       mora numa barra lateral fixa; no celular, a MESMA nav vira uma barra
       de baixo, ao alcance do polegar, e a marca + "Ver site"/"Sair" ficam
       numa barra de cima. Nada é desenhado duas vezes no HTML: só o CSS
       muda de lugar — então não há dois botões "Sair" para manter.
       Dentro de cada seção, tudo é BLOCO (.bloco): um cartão com título,
       uma frase do que ele faz e os controles. Uma coisa por bloco.
       ================================================================ */
    .app{min-height:100vh}
    .lateral{position:sticky;top:0;z-index:20;display:flex;align-items:center;justify-content:space-between;gap:.75rem;padding:.75rem 1rem;padding-top:calc(.75rem + env(safe-area-inset-top));background:var(--bg);border-bottom:1px solid var(--border)}
    .marca{font-size:.85rem;font-weight:300;letter-spacing:.18em;text-transform:lowercase;color:var(--text2);white-space:nowrap}
    .marca strong{font-weight:600;color:var(--text)}
    .lateral-pe{display:flex;align-items:center;gap:.5rem}
    .lateral-pe form{margin:0}
    .btn-sm{display:inline-flex;align-items:center;gap:.35rem;background:none;border:1px solid var(--border);color:var(--text2);padding:.45rem .875rem;border-radius:8px;font-size:.75rem;font-weight:500;text-decoration:none;transition:border-color .2s,color .2s}
    .btn-sm:hover{border-color:#444;color:var(--text)}
    /* navegação: barra de baixo no celular */
    .nav{position:fixed;left:0;right:0;bottom:0;z-index:30;display:grid;grid-template-columns:repeat(4,1fr);background:rgba(13,13,13,.97);border-top:1px solid var(--border);padding:.35rem .25rem calc(.35rem + env(safe-area-inset-bottom))}
    .tab{position:relative;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:.2rem;min-height:52px;background:none;border:none;border-radius:10px;color:var(--text3);font-size:.68rem;font-weight:500;letter-spacing:.02em;transition:color .2s,background .2s}
    .tab svg{width:20px;height:20px;flex-shrink:0}
    .tab.active{color:var(--text)}
    .tab.active svg{color:#c0a060}
    .tab:hover{color:var(--text2)}
    .tab-badge{position:absolute;top:.25rem;left:calc(50% + 4px);display:inline-flex;align-items:center;justify-content:center;background:#c0392b;color:#fff;font-size:.6rem;font-weight:700;min-width:16px;height:16px;padding:0 4px;border-radius:8px}
    .conteudo{padding:1.25rem 1rem calc(88px + env(safe-area-inset-bottom));max-width:1100px}
    /* computador: barra lateral */
    @media(min-width:900px){
      .app{display:grid;grid-template-columns:232px 1fr}
      .lateral{position:sticky;top:0;height:100vh;flex-direction:column;align-items:stretch;justify-content:flex-start;gap:1.5rem;padding:1.5rem 1rem;border-bottom:none;border-right:1px solid var(--border)}
      .marca{padding:0 .5rem}
      .nav{position:static;display:flex;flex-direction:column;gap:.25rem;background:none;border:none;padding:0}
      .tab{flex-direction:row;justify-content:flex-start;gap:.7rem;min-height:42px;padding:0 .75rem;font-size:.85rem}
      .tab.active{background:var(--bg3)}
      .tab-badge{position:static;margin-left:auto}
      .lateral-pe{margin-top:auto;flex-direction:column;align-items:stretch}
      .lateral-pe .btn-sm{justify-content:center;width:100%}
      .conteudo{padding:2rem 2.5rem 3rem}
    }
    /* seções */
    .panel{display:none}
    .panel.active{display:block}
    .secao-cabeca{display:flex;align-items:flex-end;justify-content:space-between;gap:1rem;flex-wrap:wrap;margin-bottom:1.25rem}
    .secao-cabeca h1{font-size:1.35rem;font-weight:600;letter-spacing:-.01em}
    .secao-sub{font-size:.8rem;color:var(--text3);margin-top:.2rem}
    .secao-acoes{display:flex;gap:.5rem;flex-wrap:wrap}
    /* blocos */
    .bloco{background:var(--bg2);border:1px solid var(--border);border-radius:14px;padding:1.25rem;margin-bottom:1rem}
    .bloco-cabeca{display:flex;align-items:flex-start;justify-content:space-between;gap:.75rem;margin-bottom:1rem}
    .bloco h2,.bloco h3{font-size:.95rem;font-weight:600}
    .bloco-desc{font-size:.78rem;color:var(--text3);line-height:1.55;margin-top:.25rem;max-width:68ch}
    .bloco.sensivel{border-color:rgba(192,57,43,.55)}
    .bloco.sensivel h3{color:#e07070}
    .sensivel-aviso{display:inline-block;font-size:.65rem;font-weight:600;letter-spacing:.06em;text-transform:uppercase;color:#e07070;border:1px solid rgba(192,57,43,.5);border-radius:4px;padding:.15rem .45rem;margin-bottom:.6rem}
    .grupo{margin-bottom:2rem}
    .grupo-titulo{font-size:.7rem;font-weight:600;letter-spacing:.14em;text-transform:uppercase;color:var(--text3);margin:0 0 .75rem .15rem}
    /* minmax(0,1fr), e não 1fr: um campo de texto dentro de uma linha flex
       não encolhe abaixo da largura "natural" dele, e numa coluna 1fr isso
       alargava o bloco além da tela do celular — o navegador então afastava a
       página inteira (zoom para fora) e a barra de baixo saía do lugar. */
    .grade-blocos{display:grid;gap:1rem;grid-template-columns:minmax(0,1fr)}
    .grade-blocos .bloco{margin-bottom:0;min-width:0}
    @media(min-width:900px){.grade-blocos{grid-template-columns:minmax(0,1fr) minmax(0,1fr)}}
    .btn-add{display:inline-flex;align-items:center;gap:.4rem;background:var(--accent);color:#0a0a0a;border:none;padding:.6rem 1.1rem;border-radius:9px;font-size:.82rem;font-weight:600;transition:opacity .18s}
    .btn-add:hover{opacity:.85}
    /* projetos: busca e filtros num bloco só */
    .filtros{display:grid;gap:.625rem;padding:1rem}
    @media(min-width:700px){.filtros{grid-template-columns:2fr 1fr;align-items:center}}
    .filtros input,.filtros select{width:100%;background:var(--bg);border:1px solid var(--border);color:var(--text);padding:.65rem .8rem;border-radius:9px;font-size:.85rem;outline:none;transition:border-color .2s;-webkit-appearance:none}
    .filtros input:focus,.filtros select:focus{border-color:#3a3a3a}
    .chips{grid-column:1 / -1;display:flex;gap:.4rem;overflow-x:auto;scrollbar-width:none;-webkit-overflow-scrolling:touch;padding-bottom:.1rem}
    .chips::-webkit-scrollbar{display:none}
    .chip{flex-shrink:0;min-height:40px;padding:0 .9rem;border-radius:999px;border:1px solid var(--border);background:none;color:var(--text2);font-size:.8rem;font-weight:500;transition:background .2s,color .2s,border-color .2s}
    .chip:hover{border-color:#3a3a3a;color:var(--text)}
    .chip[aria-pressed="true"]{background:var(--accent);border-color:var(--accent);color:#0a0a0a}
    /* lista de projetos */
    .evt-list{display:flex;flex-direction:column;gap:.625rem}
    .evt-item{position:relative;display:grid;grid-template-columns:auto 1fr;gap:.75rem .9rem;align-items:center;background:var(--bg2);border:1px solid var(--border);border-radius:14px;padding:.85rem}
    .evt-item.com-check{grid-template-columns:auto auto 1fr}
    .evt-thumb,.evt-thumb-ph{width:64px;height:64px;border-radius:10px;object-fit:cover;background:var(--bg3);flex-shrink:0}
    .evt-thumb-ph{display:flex;align-items:center;justify-content:center;color:var(--text3)}
    .evt-info{min-width:0}
    .evt-name{font-size:.92rem;font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
    .evt-meta{font-size:.72rem;color:var(--text3);margin-top:.15rem;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
    .evt-slug{font-family:ui-monospace,SFMono-Regular,Menlo,monospace}
    .evt-selos{display:flex;flex-wrap:wrap;gap:.3rem;margin-top:.45rem}
    .evt-item.hidden-evt .evt-name{color:var(--text3)}
    .evt-item.hidden-evt .evt-thumb{opacity:.5}
    .evt-actions{grid-column:1 / -1;display:flex;gap:.5rem;align-items:center}
    .act{display:inline-flex;align-items:center;justify-content:center;gap:.4rem;min-height:40px;padding:0 .9rem;background:none;border:1px solid var(--border);border-radius:9px;color:var(--text2);font-size:.8rem;font-weight:500;text-decoration:none;transition:border-color .2s,color .2s,background .2s}
    .act:hover{border-color:#3a3a3a;color:var(--text)}
    .act svg{width:15px;height:15px;flex-shrink:0}
    .act-edit{flex:1}
    .act-gal{flex:1}
    .act-mais{width:44px;padding:0;margin-left:auto}
    .act:disabled,.menu-item:disabled{opacity:.45;cursor:wait}
    /* botão só de ícone: fechar o formulário, remover foto da lista */
    .icon-btn{background:none;border:1px solid var(--border);color:var(--text3);width:36px;height:36px;border-radius:8px;display:flex;align-items:center;justify-content:center;flex-shrink:0;transition:border-color .2s,color .2s}
    .icon-btn:hover{border-color:#3a3a3a;color:var(--text)}
    .icon-btn.danger:hover{border-color:var(--red);color:var(--red)}
    @media(min-width:700px){
      .evt-item{grid-template-columns:auto 1fr auto}
      .evt-item.com-check{grid-template-columns:auto auto 1fr auto}
      .evt-actions{grid-column:auto}
      .act-edit,.act-gal{flex:none}
    }
    /* menu "Mais ações" do projeto: lista suspensa no computador, folha de
       baixo no celular (o polegar alcança e o texto cabe inteiro) */
    .mais{position:relative}
    .menu{position:absolute;right:0;top:calc(100% + 6px);z-index:40;min-width:230px;background:#171717;border:1px solid #2a2a2a;border-radius:12px;padding:.35rem;box-shadow:0 18px 40px rgba(0,0,0,.55)}
    .menu[hidden]{display:none}
    .menu-item{display:flex;align-items:center;gap:.6rem;width:100%;min-height:42px;padding:0 .75rem;background:none;border:none;border-radius:8px;color:var(--text2);font-size:.85rem;text-align:left;text-decoration:none}
    .menu-item:hover,.menu-item:focus-visible{background:var(--bg3);color:var(--text)}
    .menu-item svg{width:16px;height:16px;flex-shrink:0}
    .menu-item.danger{color:#e07070}
    .menu-sep{height:1px;background:#262626;margin:.3rem .25rem}
    @media(max-width:699px){
      .menu{position:fixed;left:.5rem;right:.5rem;top:auto;bottom:calc(.5rem + env(safe-area-inset-bottom));min-width:0;border-radius:16px;padding:.5rem}
      .menu-item{min-height:48px;font-size:.92rem}
      .menu-fundo{position:fixed;inset:0;z-index:35;background:rgba(0,0,0,.55)}
    }
    .menu-fundo[hidden]{display:none}
    @media(min-width:700px){.menu-fundo{display:none}}
    .metrics-nota{font-size:.75rem;color:var(--text3);line-height:1.5;margin:0;max-width:60ch}
    .metrics-resumo{display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:.75rem;margin-bottom:1rem}
    .resumo-card{background:var(--bg2);border:1px solid var(--border);border-radius:14px;padding:1rem}
    .resumo-num{font-size:1.5rem;font-weight:600;line-height:1.1}
    .resumo-lab{font-size:.68rem;color:var(--text3);text-transform:uppercase;letter-spacing:.06em;margin-top:.3rem}
    .resumo-det{font-size:.75rem;color:var(--text2);margin-top:.25rem;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
    /* ---- Métricas v2 (#215) ----------------------------------------------
       Cores dos gráficos: a paleta validada para o fundo dos blocos (#141414)
       — azul = Visitas, laranja = Abriram o Drive, verde-água = modos do
       portão. Contraste e separação para daltonismo conferidos com o
       validador da skill de dataviz (docs/PAINEL.md, "Métricas"). Texto NUNCA
       usa a cor da série: números e rótulos ficam na tinta do texto, e a
       marca colorida ao lado é que identifica a série. */
    .filtros-metricas{display:flex;flex-wrap:wrap;align-items:center;gap:.6rem;padding:.75rem}
    .filtros-metricas .chips{flex:0 1 auto}
    .filtros-metricas select{flex:1 1 200px;min-width:0;background:var(--bg);border:1px solid var(--border);color:var(--text);padding:.6rem .8rem;border-radius:9px;font-size:.85rem;outline:none;-webkit-appearance:none}
    .filtros-metricas select:focus{border-color:#3a3a3a}
    .metrics-atualizado{align-self:center;font-size:.72rem;color:var(--text3)}
    .resumo-delta{font-size:.72rem;color:var(--text2);margin-top:.35rem;line-height:1.4;font-variant-numeric:tabular-nums}
    .resumo-num{font-variant-numeric:tabular-nums}
    .bloco-acoes{display:flex;flex-wrap:wrap;gap:.5rem;justify-content:flex-end}
    .legenda{display:flex;flex-wrap:wrap;gap:.35rem 1.1rem;margin:0 0 .6rem;font-size:.78rem;color:var(--text2)}
    .legenda span{display:inline-flex;align-items:center;gap:.45rem}
    .legenda i{display:inline-block;width:18px;height:3px;border-radius:2px}
    .legenda b{color:var(--text);font-weight:600;font-variant-numeric:tabular-nums}
    /* pan-y: no celular, arrastar na vertical ainda rola a página; na
       horizontal, percorre os dias. */
    .grafico{position:relative;width:100%;min-width:0;touch-action:pan-y;-webkit-tap-highlight-color:transparent;outline:none;border-radius:8px}
    .grafico:focus-visible{box-shadow:0 0 0 2px #4a4a4a}
    .grafico svg{display:block;max-width:100%;height:auto}
    .grafico-vazio{display:flex;align-items:center;justify-content:center;min-height:180px;padding:1rem;text-align:center;font-size:.82rem;color:var(--text2);line-height:1.55;border:1px dashed #2c2c2a;border-radius:10px}
    .dica{position:absolute;top:0;left:0;z-index:5;pointer-events:none;background:#1f1f1e;border:1px solid #383835;border-radius:10px;padding:.5rem .7rem;font-size:.76rem;color:var(--text);box-shadow:0 10px 24px rgba(0,0,0,.5);white-space:nowrap}
    .dica[hidden]{display:none}
    .dica-dia{color:var(--text2);margin-bottom:.3rem}
    .dica-linha{display:flex;align-items:center;gap:.45rem;line-height:1.6}
    .dica-linha i{display:inline-block;width:10px;height:10px;border-radius:3px;flex-shrink:0}
    .dica-linha b{margin-left:auto;padding-left:1rem;font-weight:600;font-variant-numeric:tabular-nums}
    .barras{display:flex;flex-direction:column;gap:.85rem;margin-top:1rem}
    .barra-rot{display:flex;justify-content:space-between;gap:.75rem;font-size:.8rem;color:var(--text2);margin-bottom:.35rem}
    .barra-rot b{color:var(--text);font-weight:600;font-variant-numeric:tabular-nums;white-space:nowrap}
    .barra-trilho{height:10px;background:var(--bg3);border-radius:4px;overflow:hidden}
    .barra-trilho i{display:block;height:100%;min-width:2px;border-radius:0 4px 4px 0}
    .chips + .ranking{margin-top:.75rem}
    .ranking{display:flex;flex-direction:column;gap:.35rem}
    .rank-item{display:grid;grid-template-columns:minmax(0,1fr) auto;gap:.4rem .75rem;align-items:center;width:100%;min-height:44px;text-align:left;background:none;border:1px solid transparent;border-radius:10px;padding:.6rem .65rem;color:var(--text);transition:background .2s,border-color .2s}
    .rank-item:hover{background:var(--bg3)}
    .rank-item[aria-pressed="true"]{border-color:#3987e5;background:rgba(57,135,229,.08)}
    .rank-nome{min-width:0;font-size:.86rem;font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
    .rank-num{font-size:.75rem;color:var(--text2);font-variant-numeric:tabular-nums;white-space:nowrap}
    .rank-barra{grid-column:1 / -1;display:flex;align-items:center;gap:.75rem;min-width:0}
    .rank-barra .barra-trilho{flex:1;height:6px}
    .rank-barra svg{flex-shrink:0}
    .rank-resto{font-size:.75rem;color:var(--text3);margin:.5rem .65rem 0}
    .tabela-rolavel{max-height:360px;overflow:auto;-webkit-overflow-scrolling:touch;margin-top:.75rem;border:1px solid var(--border);border-radius:10px}
    .tabela-rolavel .metrics-table td,.tabela-rolavel .metrics-table th{padding:.5rem .75rem;font-variant-numeric:tabular-nums}
    .tabela-rolavel .metrics-table th{position:sticky;top:0;background:var(--bg2)}
    .sr-only{position:absolute;width:1px;height:1px;padding:0;margin:-1px;overflow:hidden;clip:rect(0,0,0,0);white-space:nowrap;border:0}
    /* Métricas no celular: os botões de um bloco descem para baixo do texto
       em vez de espremê-lo numa coluna; o número de cada projeto vai para a
       linha de baixo do nome (o nome inteiro importa mais); a tabela do total
       perde o endereço do projeto, que já está no nome. */
    #tab-metrics .bloco-cabeca{flex-wrap:wrap}
    #tab-metrics .bloco-cabeca > div:first-child{flex:1 1 240px;min-width:0}
    @media(max-width:599px){
      .rank-item{grid-template-columns:minmax(0,1fr)}
      .metrics-table .slug-mini{display:none}
      #metrics-body .metrics-table td,#metrics-body .metrics-table th{padding-left:.5rem;padding-right:.5rem}
      #metrics-body .views-bar{left:.5rem}
    }
    /* status badge */
    .status-badge{display:inline-block;font-size:.58rem;font-weight:600;letter-spacing:.08em;text-transform:uppercase;padding:.15rem .45rem;border-radius:3px;margin-left:.4rem;vertical-align:middle;border:1px solid currentColor;line-height:1.4}
    .st-em-edicao{color:#c8880a;background:rgba(200,136,10,.08)}
    .st-em-revisao{color:#4a8ac8;background:rgba(74,138,200,.08)}
    .st-entregue{color:#4a9a4a;background:rgba(74,154,74,.08)}
    .st-arquivado{color:#666;background:rgba(102,102,102,.08)}
    /* Lembrete de entrega (issue #139): não é um status de produção, é um
       aviso sobre um status — por isso é um badge à parte, não um 5º valor
       de EVENT_STATUSES. */
    .st-atrasado{color:#c83a3a;background:rgba(200,58,58,.1)}
    /* Selos do card de projeto: o estado que antes só aparecia na cor de um
       ícone (estrela dourada, olho cortado) agora é escrito. */
    .evt-selos .status-badge{margin-left:0}
    .st-destaque{color:#c0a060;background:rgba(192,160,96,.1)}
    .st-oculto{color:#8a8a8a;background:rgba(138,138,138,.08)}
    .st-embreve{color:#6aa8e0;background:rgba(106,168,224,.08)}
    .st-acesso{color:#b48ad0;background:rgba(180,138,208,.08)}
    /* filter row */
    .filter-row{margin-bottom:1rem;display:flex;flex-direction:column;gap:.625rem}
    .filter-row select{width:100%;background:var(--bg2);border:1px solid var(--border);color:var(--text);padding:.6rem .75rem;border-radius:7px;font-size:.82rem;outline:none;-webkit-appearance:none}
    @media(min-width:600px){.filter-row{flex-direction:row}.filter-row select{width:auto;min-width:200px}}
    /* metrics table */
    .metrics-table{width:100%;border-collapse:collapse}
    .metrics-table th{text-align:left;font-size:.7rem;font-weight:500;letter-spacing:.1em;text-transform:uppercase;color:var(--text3);padding:.5rem .75rem;border-bottom:1px solid var(--border)}
    .metrics-table td{padding:.75rem;border-bottom:1px solid #161616;font-size:.85rem}
    .metrics-table tr:last-child td{border-bottom:none}
    .views-badge{background:var(--bg3);padding:.2rem .6rem;border-radius:20px;font-size:.75rem;font-weight:500;color:var(--text2)}
    /* ajustes: os blocos usam .bloco; aqui só o que é deles */
    .bloco .field:last-of-type{margin-bottom:.75rem}
    .arquivo{background:var(--bg);border:1px solid var(--border);color:var(--text);padding:.6rem .75rem;border-radius:9px;font-size:.82rem;width:100%}
    /* form overlay */
    .overlay{position:fixed;inset:0;background:rgba(0,0,0,.85);z-index:100;display:none;align-items:flex-end;justify-content:center}
    @media(min-width:600px){.overlay{align-items:center}}
    .overlay.open{display:flex}
    .sheet{background:var(--bg);width:100%;max-width:680px;max-height:92vh;border-radius:16px 16px 0 0;display:flex;flex-direction:column;overflow:hidden}
    @media(min-width:600px){.sheet{border-radius:16px;max-height:88vh}}
    .sheet-head{display:flex;align-items:center;justify-content:space-between;padding:1.25rem 1.25rem 1rem;border-bottom:1px solid var(--border);flex-shrink:0}
    .sheet-head h2{font-size:.95rem;font-weight:600}
    .sheet-body{flex:1;overflow-y:auto;padding:1.25rem;-webkit-overflow-scrolling:touch}
    .sheet-foot{padding:1rem 1.25rem;border-top:1px solid var(--border);display:flex;gap:.75rem;flex-shrink:0;position:sticky;bottom:0;background:var(--bg);z-index:1}
    /* blocos do formulário (#220): cada um recolhível, o essencial primeiro */
    .bf-atalhos{display:flex;gap:.4rem;overflow-x:auto;scrollbar-width:none;margin:-.25rem 0 1rem;padding-bottom:.1rem}
    .bf-atalhos::-webkit-scrollbar{display:none}
    .bloco-form{border:1px solid var(--border);border-radius:14px;background:var(--bg2);margin-bottom:.75rem;scroll-margin-top:.5rem}
    .bloco-form>summary{display:flex;align-items:center;gap:.6rem;min-height:52px;padding:0 1rem;cursor:pointer;list-style:none;border-radius:14px}
    .bloco-form>summary::-webkit-details-marker{display:none}
    .bloco-form>summary::before{content:'';width:8px;height:8px;border-right:2px solid var(--text3);border-bottom:2px solid var(--text3);transform:rotate(-45deg);transition:transform .2s;flex-shrink:0;margin-right:.15rem}
    .bloco-form[open]>summary::before{transform:rotate(45deg)}
    .bf-titulo{font-size:.9rem;font-weight:600}
    .bf-resumo{margin-left:auto;font-size:.75rem;color:var(--text3);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:55%}
    .bloco-form[open] .bf-resumo{display:none}
    .bf-dica{font-size:.75rem;color:var(--text3);line-height:1.5;margin:-.15rem 1rem .9rem 1rem}
    .bloco-form>.field,.bloco-form>.field-row{margin-left:1rem;margin-right:1rem}
    .bloco-form>:last-child{margin-bottom:1.1rem}
    .bloco-form .field input,.bloco-form .field textarea,.bloco-form .field select,.bloco-form .slug-prefix{background:var(--bg)}
    /* form fields */
    .field{display:flex;flex-direction:column;gap:.45rem;margin-bottom:1.125rem}
    .field label,.rotulo-campo{font-size:.7rem;font-weight:500;letter-spacing:.08em;text-transform:uppercase;color:var(--text3)}
    .field label.toggle-label{font-size:.85rem;font-weight:400;letter-spacing:0;text-transform:none;color:var(--text)}
    .field input,.field textarea,.field select{width:100%;background:var(--bg2);border:1px solid var(--border);color:var(--text);padding:.8rem .875rem;border-radius:8px;font-size:.9rem;outline:none;transition:border-color .2s;-webkit-appearance:none}
    .field input:focus,.field textarea:focus{border-color:#3a3a3a}
    .field textarea{resize:vertical;min-height:100px;line-height:1.55}
    .field-hint{font-size:.7rem;color:var(--text3);line-height:1.5}
    .slug-prefix{display:flex;align-items:center;background:var(--bg2);border:1px solid var(--border);border-radius:8px;overflow:hidden}
    .slug-prefix span{padding:.8rem 0 .8rem .875rem;color:var(--text3);font-size:.9rem;white-space:nowrap}
    .slug-prefix input{border:none;border-radius:0;padding-left:.3rem;background:transparent}
    .slug-prefix:focus-within{border-color:#3a3a3a}
    /* toggle */
    .toggle-row{display:flex;align-items:center;justify-content:space-between;gap:1rem}
    .toggle-label{font-size:.85rem;color:var(--text)}
    .toggle{position:relative;width:44px;height:26px;flex-shrink:0}
    .toggle input{opacity:0;width:0;height:0;position:absolute}
    .toggle-track{position:absolute;inset:0;background:var(--bg3);border-radius:13px;transition:background .2s;cursor:pointer}
    .toggle-track::after{content:'';position:absolute;width:20px;height:20px;border-radius:50%;background:#fff;top:3px;left:3px;transition:transform .2s}
    .toggle input:checked~.toggle-track{background:#4caf50}
    .toggle input:checked~.toggle-track::after{transform:translateX(18px)}
    /* photo list */
    .photo-list{display:flex;flex-direction:column;gap:.5rem;margin-bottom:.625rem}
    .photo-row-inner{display:flex;align-items:center;gap:.5rem}
    .photo-num{font-size:.7rem;font-weight:600;color:var(--text3);width:1rem;flex-shrink:0;text-align:center}
    .photo-row-inner input{flex:1;background:var(--bg2);border:1px solid var(--border);color:var(--text);padding:.65rem .75rem;border-radius:7px;font-size:.82rem;outline:none;transition:border-color .2s;min-width:0}
    .photo-row-inner input:focus{border-color:#3a3a3a}
    .photo-mini{width:36px;height:36px;border-radius:5px;object-fit:cover;flex-shrink:0;background:var(--bg3);display:none}
    .photo-badge{font-size:.65rem;font-weight:500;letter-spacing:.06em;color:#4a8a4a;background:#091409;border:1px solid #162016;padding:.2rem .5rem;border-radius:4px;display:inline-block;margin-top:.3rem;margin-left:1.5rem}
    .btn-add-photo{display:inline-flex;align-items:center;gap:.4rem;background:none;border:1px dashed var(--border);color:var(--text3);padding:.55rem 1rem;border-radius:7px;font-size:.78rem;font-weight:500;transition:border-color .2s,color .2s;margin-top:.25rem}
    .btn-add-photo:hover{border-color:#3a3a3a;color:var(--text2)}
    /* buttons */
    .btn-primary{flex:1;background:var(--accent);color:#0a0a0a;border:none;padding:.875rem;border-radius:9px;font-size:.875rem;font-weight:600;transition:opacity .18s}
    .btn-primary:hover{opacity:.88}
    .btn-secondary{flex:1;background:none;border:1px solid var(--border);color:var(--text2);padding:.875rem;border-radius:9px;font-size:.875rem;font-weight:500;transition:border-color .2s}
    .btn-secondary:hover{border-color:#3a3a3a}
    .btn-danger{background:none;border:1px solid var(--red);color:var(--red);padding:.75rem 1.25rem;border-radius:8px;font-size:.8rem;font-weight:500;transition:background .2s}
    .btn-danger:hover{background:rgba(192,57,43,.1)}
    /* toast */
    .toast{position:fixed;bottom:calc(80px + env(safe-area-inset-bottom));left:50%;transform:translateX(-50%) translateY(20px);background:#1e1e1e;border:1px solid #2e2e2e;color:var(--text);padding:.7rem 1.25rem;border-radius:8px;font-size:.82rem;opacity:0;transition:opacity .25s,transform .25s;z-index:200;pointer-events:none;white-space:nowrap}
    .toast.show{opacity:1;transform:translateX(-50%) translateY(0)}
    @media(min-width:900px){.toast{bottom:1.5rem}}
    /* a tabela de métricas rola de lado dentro do bloco, em vez de vazar */
    .bloco-tabela{overflow-x:auto;padding:.5rem}
    .toast.ok{border-color:#1e3a1e;background:#0e1e0e;color:#7ecf7e}
    .toast.err{border-color:#3a1010;background:#180808;color:#e07070}
    /* empty */
    .empty{text-align:center;color:var(--text3);padding:3rem 0;font-size:.85rem}
    /* requests */
    .req-item{background:var(--bg2);border:1px solid var(--border);border-radius:9px;padding:1rem;margin-bottom:.625rem}
    .req-item.resolved{opacity:.45}
    .req-header{display:flex;align-items:flex-start;justify-content:space-between;gap:.75rem;margin-bottom:.5rem}
    .req-date{font-size:.68rem;color:var(--text3);white-space:nowrap;flex-shrink:0}
    .req-body{font-size:.8rem;color:var(--text2);line-height:1.55;display:flex;flex-direction:column;gap:.2rem}
    .req-badge{display:inline-block;font-size:.65rem;font-weight:600;letter-spacing:.06em;text-transform:uppercase;padding:.2rem .55rem;border-radius:4px;background:var(--bg3);color:var(--text3);margin-bottom:.4rem}
    .req-badge.pending{background:#1a0e00;color:#c8880a;border:1px solid #2e1c00}
    .btn-resolve{background:none;border:1px solid var(--border);color:var(--text3);padding:.4rem .875rem;border-radius:6px;font-size:.72rem;font-weight:500;margin-top:.625rem;transition:border-color .2s,color .2s}
    .btn-resolve:hover{border-color:var(--green);color:var(--green)}
    .btn-resolve:disabled{opacity:.5;cursor:wait}
    .tab-badge{display:inline-flex;align-items:center;justify-content:center;background:#c0392b;color:#fff;font-size:.6rem;font-weight:700;width:16px;height:16px;border-radius:50%;margin-left:.35rem;vertical-align:middle}
    .req-group{margin-bottom:1.75rem}
    .req-group-head{display:flex;align-items:center;flex-wrap:wrap;gap:.375rem;padding:.5rem 0;border-bottom:1px solid var(--border);margin-bottom:.75rem}
    .req-group-title{font-size:.85rem;font-weight:600}
    .req-group-slug{font-size:.7rem;color:var(--text3);font-family:monospace}
    .req-pending-badge{background:#1a0e00;color:#c8880a;border:1px solid #2e1c00;font-size:.62rem;font-weight:600;padding:.18rem .5rem;border-radius:4px;margin-left:auto}
    .req-resolved-toggle{background:none;border:none;cursor:pointer;font-size:.75rem;color:var(--text3);padding:.35rem 0;transition:color .2s;display:inline-flex;align-items:center;gap:.3rem;user-select:none;margin-bottom:.25rem}
    .req-resolved-toggle:hover{color:var(--text2)}
    /* info box */
    .info-box{background:var(--bg3);border:1px solid var(--border);border-radius:9px;padding:1rem 1.125rem;font-size:.78rem;color:var(--text3);line-height:1.65;margin-bottom:1.25rem}
    .info-box strong{color:var(--text2)}
    /* field row */
    .field-row{display:grid;grid-template-columns:1fr 1fr;gap:.875rem}
    /* mass edit */
    .mass-bar{display:flex;align-items:center;gap:.75rem;flex-wrap:wrap;background:var(--bg2);border:1px solid var(--border);border-radius:9px;padding:.625rem .875rem;margin-bottom:1rem}
    .mass-selall{display:inline-flex;align-items:center;gap:.4rem;font-size:.78rem;color:var(--text2);cursor:pointer}
    .mass-selall input,.evt-check{width:17px;height:17px;accent-color:#c0a060;cursor:pointer;flex-shrink:0}
    #mass-count{font-size:.75rem;color:var(--text3)}
    .mass-apply{display:flex;gap:.5rem;align-items:center;margin-left:auto}
    .mass-apply select{background:var(--bg);border:1px solid var(--border);color:var(--text);padding:.45rem .6rem;border-radius:7px;font-size:.78rem;outline:none;-webkit-appearance:none}
    .evt-item .evt-check{margin-right:.25rem}
    /* category manager */
    .cat-list{display:flex;flex-wrap:wrap;gap:.5rem;margin-bottom:1.125rem}
    .cat-chip{display:inline-flex;align-items:center;gap:.4rem;background:var(--bg3);border:1px solid var(--border);border-radius:20px;padding:.35rem .4rem .35rem .8rem;font-size:.78rem;color:var(--text2)}
    .cat-chip button{background:none;border:none;color:var(--text3);width:20px;height:20px;border-radius:50%;display:flex;align-items:center;justify-content:center;font-size:1rem;line-height:1;transition:background .2s,color .2s}
    .cat-chip button:hover{background:rgba(192,57,43,.15);color:var(--red)}
    .cat-empty{font-size:.78rem;color:var(--text3)}
    .cat-add{display:flex;gap:.5rem}
    .cat-add input{flex:1;min-width:0;background:var(--bg2);border:1px solid var(--border);color:var(--text);padding:.6rem .75rem;border-radius:7px;font-size:.82rem;outline:none}
    .cat-add input:focus{border-color:#3a3a3a}
    /* event search */
    .search-row{margin-bottom:.75rem}
    .search-row input{width:100%;background:var(--bg2);border:1px solid var(--border);color:var(--text);padding:.6rem .75rem;border-radius:7px;font-size:.82rem;outline:none;transition:border-color .2s;-webkit-appearance:none}
    .search-row input:focus{border-color:#3a3a3a}
    /* required marker */
    .req-star{color:var(--red)}
    /* bigger cover preview */
    .photo-cover-preview{display:none;width:100%;height:72px;object-fit:cover;border-radius:7px;background:var(--bg3);margin-top:.4rem;margin-left:1.5rem;border:1px solid var(--border);max-width:calc(100% - 1.5rem)}
    /* inline spinner */
    .spinner{display:inline-block;width:13px;height:13px;border:2px solid rgba(10,10,10,.35);border-top-color:#0a0a0a;border-radius:50%;vertical-align:-2px;margin-right:.45rem;animation:spin .6s linear infinite}
    @keyframes spin{to{transform:rotate(360deg)}}
    /* metrics: sortable headers + inline bar */
    .metrics-table th.sortable{cursor:pointer;user-select:none}
    .metrics-table th.sortable:hover{color:var(--text2)}
    .sort-ind{font-size:.6rem;margin-left:.25rem;color:var(--text2)}
    .views-cell{position:relative}
    .views-bar{position:absolute;left:.75rem;top:50%;transform:translateY(-50%);height:60%;background:#3987e5;opacity:.22;border-radius:3px;z-index:0;pointer-events:none}
    .views-cell .views-badge{position:relative;z-index:1}
    /* export buttons group */
    .export-grid{display:flex;flex-wrap:wrap;gap:.5rem}
    /* confirm dialog */
    .confirm-sheet{background:var(--bg);width:100%;max-width:400px;border-radius:14px;border:1px solid var(--border);overflow:hidden;margin:0 1rem}
    .confirm-body{padding:1.5rem 1.5rem 1.25rem}
    .confirm-body h3{font-size:.95rem;font-weight:600;margin-bottom:.5rem}
    .confirm-body p{font-size:.82rem;color:var(--text2);line-height:1.55}
    .confirm-type-label{display:block;font-size:.78rem;color:var(--text2);margin-top:1rem}
    .confirm-type-label strong{color:var(--text)}
    .confirm-type-input{display:block;width:100%;margin-top:.5rem;background:var(--bg2);border:1px solid var(--border);color:var(--text);padding:.7rem .875rem;border-radius:8px;font-size:.875rem;outline:none;transition:border-color .2s}
    .confirm-type-input:focus{border-color:#3a3a3a}
    .confirm-foot{padding:0 1.5rem 1.5rem;display:flex;gap:.75rem;justify-content:flex-end}
    .confirm-foot button{padding:.7rem 1.25rem;border-radius:8px;font-size:.82rem;font-weight:500;border:1px solid var(--border);background:none;color:var(--text2);transition:border-color .2s,color .2s,background .2s}
    .confirm-foot .confirm-cancel:hover{border-color:#3a3a3a;color:var(--text)}
    .confirm-foot .confirm-ok{background:var(--accent);color:#0a0a0a;border-color:var(--accent);font-weight:600}
    .confirm-foot .confirm-ok:hover{opacity:.88}
    .confirm-foot .confirm-ok.danger{background:none;border-color:var(--red);color:var(--red)}
    .confirm-foot .confirm-ok.danger:hover{background:rgba(192,57,43,.1)}
    .confirm-foot .confirm-ok:disabled{opacity:.4;cursor:not-allowed;pointer-events:none}
    /* Celular (#220: "só pelo celular e sem zoom"):
       - campo com letra menor que 16 px faz o Safari do iPhone dar zoom ao
         tocar, e a tela fica torta até a pessoa desfazer com dois dedos. O
         !important vence os estilos em linha antigos de alguns selects;
       - alvo de toque de pelo menos 44 px (WCAG 2.5.5) em tudo que se toca. */
    @media(max-width:899px){
      input,select,textarea{font-size:16px!important}
    }
    @media(pointer:coarse){
      .btn-sm,.act,.chip,.menu-item,.btn-resolve,.btn-danger,.req-resolved-toggle{min-height:44px}
      .icon-btn{width:44px;height:44px}
      .btn-sm{padding:0 1rem}
    }
    /* reduced motion */
    @media (prefers-reduced-motion: reduce){
      *,*::before,*::after{transition:none!important;animation-duration:.001ms!important;animation-iteration-count:1!important}
      .toast{transition:opacity .001ms!important}
      .spinner{animation:none!important;border-top-color:#0a0a0a;border-right-color:transparent}
    }
  </style>
</head>
<body>
  <div class="app">
  <!-- Barra lateral no computador; barra de cima (marca + saída) e de baixo
       (a nav) no celular. Ver o comentário "Estrutura do painel" no CSS. -->
  <aside class="lateral">
    <div class="marca">fotos · <strong>Luca F. Chala</strong></div>
    <nav class="nav" aria-label="Seções do painel">
      <button class="tab active" data-onclick="switchTab" data-tab="events" aria-current="page">${ICONES.projetos}<span>Eventos</span></button>
      <button class="tab" id="tab-btn-requests" data-onclick="switchTab" data-tab="requests">${ICONES.pedidos}<span>Pedidos</span><span class="tab-badge" id="requests-badge" hidden></span></button>
      <button class="tab" data-onclick="switchTab" data-tab="metrics">${ICONES.metricas}<span>Métricas</span></button>
      <button class="tab" data-onclick="switchTab" data-tab="settings">${ICONES.ajustes}<span>Ajustes</span></button>
    </nav>
    <div class="lateral-pe">
      <a href="/" target="_blank" rel="noopener" class="btn-sm">Ver site</a>
      <form method="POST" action="/dashboard/logout">
        <button type="submit" class="btn-sm">Sair</button>
      </form>
    </div>
  </aside>

  <main class="conteudo" id="conteudo">
  <!-- EVENTOS -->
  <section id="tab-events" class="panel active" aria-labelledby="h-projetos">
    <div class="secao-cabeca">
      <div>
        <h1 id="h-projetos">Eventos</h1>
        <p class="secao-sub" id="evt-count">${ssrCount}</p>
      </div>
      <div class="secao-acoes">
        <button class="btn-sm" id="mass-toggle" data-onclick="toggleMassMode">Selecionar vários</button>
        <button class="btn-add" data-onclick="openForm">
          <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" aria-hidden="true"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
          Novo evento
        </button>
      </div>
    </div>
    <div class="bloco filtros">
      <input type="search" id="evt-search" placeholder="Buscar por título, URL ou categoria…" data-oninput="renderEventList" aria-label="Buscar eventos">
      <select id="category-filter" data-onchange="renderEventList" aria-label="Filtrar por categoria">${catFilterOptionsSSR}</select>
      <!-- Filtro rápido de status (#220): botões de um toque, não uma lista. -->
      <div class="chips" id="status-filter" role="group" aria-label="Filtrar por status">
        <button type="button" class="chip" aria-pressed="true" data-onclick="filtraStatus" data-valor="todos">Todos</button>
        <button type="button" class="chip" aria-pressed="false" data-onclick="filtraStatus" data-valor="ativos">Ativos</button>
        <button type="button" class="chip" aria-pressed="false" data-onclick="filtraStatus" data-valor="em-edicao">Em edição</button>
        <button type="button" class="chip" aria-pressed="false" data-onclick="filtraStatus" data-valor="em-revisao">Em revisão</button>
        <button type="button" class="chip" aria-pressed="false" data-onclick="filtraStatus" data-valor="entregue">Entregues</button>
        <button type="button" class="chip" aria-pressed="false" data-onclick="filtraStatus" data-valor="arquivado">Arquivados</button>
      </div>
    </div>
    <div class="mass-bar" id="mass-bar" style="display:none">
      <label class="mass-selall"><input type="checkbox" id="mass-selall" data-onchange="toggleSelectAll"> Todos</label>
      <span id="mass-count">0 selecionados</span>
      <div class="mass-apply">
        <select id="mass-cat" aria-label="Categoria para aplicar">${catOptionsSSR}</select>
        <button class="btn-sm" data-onclick="applyMassCategory">Aplicar categoria</button>
        <select id="mass-access" aria-label="Tipo de acesso para aplicar">
          <option value="public">Público</option>
          <option value="private">Privado</option>
          <option value="family">Familiar</option>
        </select>
        <button class="btn-sm" data-onclick="applyMassAccess">Aplicar acesso</button>
      </div>
    </div>
    <div class="evt-list" id="evt-list">${ssrList}</div>
    <div class="menu-fundo" id="menu-fundo" hidden></div>
  </section>

  <!-- PEDIDOS DE REMOÇÃO -->
  <section id="tab-requests" class="panel" aria-labelledby="h-pedidos">
    <div class="secao-cabeca">
      <div>
        <h1 id="h-pedidos">Pedidos de remoção</h1>
        <p class="secao-sub">De quem pediu para tirar uma foto do ar (LGPD). Remova a foto no Drive e depois marque como resolvido — a pessoa recebe um e-mail.</p>
      </div>
    </div>
    <div id="requests-body"><p class="empty">Carregando…</p></div>
  </section>

  <!-- MÉTRICAS (v2, #215) -->
  <!-- Ordem de leitura, de cima para baixo: o filtro (período e projeto,
       numa linha só, acima de tudo que ele muda) → os números do período, com
       a comparação → o gráfico por dia → quando (dia da semana) e como (modo
       de entrada no portão) → cada projeto → o total desde sempre. Os
       gráficos são desenhados no navegador a partir de UMA leitura da série
       (GET /api/metrics/diario) — trocar o filtro não pede nada ao servidor. -->
  <section id="tab-metrics" class="panel" aria-labelledby="h-metricas">
    <div class="secao-cabeca">
      <div>
        <h1 id="h-metricas">Métricas</h1>
        <p class="secao-sub">Visitas e aberturas do Drive por dia, por projeto, e como as pessoas passaram pelo portão.</p>
      </div>
      <div class="secao-acoes">
        <span class="metrics-atualizado" id="metrics-atualizado"></span>
        <button class="btn-sm" data-onclick="loadMetrics" aria-describedby="metrics-atualizado">↻ Atualizar</button>
      </div>
    </div>
    <div class="bloco filtros-metricas" role="group" aria-label="Filtros das métricas">
      <div class="chips" id="metrics-periodo" role="group" aria-label="Período">
        <button type="button" class="chip" aria-pressed="false" data-onclick="escolhePeriodo" data-dias="7">7 dias</button>
        <button type="button" class="chip" aria-pressed="true" data-onclick="escolhePeriodo" data-dias="30">30 dias</button>
        <button type="button" class="chip" aria-pressed="false" data-onclick="escolhePeriodo" data-dias="90">90 dias</button>
      </div>
      <select id="metrics-projeto" data-onchange="escolheProjeto" aria-label="Projeto">
        <option value="">Todos os projetos</option>
      </select>
    </div>
    <div id="metrics-resumo" class="metrics-resumo" hidden></div>

    <div class="bloco" id="bloco-acessos">
      <div class="bloco-cabeca">
        <div>
          <h2>Acessos por dia</h2>
          <p class="bloco-desc" id="acessos-desc">Carregando…</p>
        </div>
        <div class="bloco-acoes">
          <button class="btn-sm" id="acessos-ver-tabela" data-onclick="alternaTabelaAcessos" aria-expanded="false" aria-controls="acessos-tabela">Ver como tabela</button>
          <button class="btn-sm" data-onclick="exportSerieCSV">⬇ CSV</button>
        </div>
      </div>
      <div class="legenda" id="acessos-legenda"></div>
      <div class="grafico" id="grafico-acessos" tabindex="0" role="group" aria-roledescription="gráfico" aria-label="Acessos por dia">
        <div class="dica" id="dica-acessos" hidden></div>
      </div>
      <p class="sr-only" id="acessos-anuncio" aria-live="polite"></p>
      <div id="acessos-tabela" class="tabela-rolavel" hidden></div>
      <p class="metrics-nota" id="acessos-nota"></p>
    </div>

    <div class="grade-blocos">
      <div class="bloco">
        <h2>Dia da semana</h2>
        <p class="bloco-desc" id="semana-desc">Média de visitas em cada dia da semana, no período.</p>
        <div class="grafico" id="grafico-semana"></div>
        <p class="metrics-nota" id="semana-leitura" aria-live="polite"></p>
      </div>
      <div class="bloco">
        <h2>Como passaram pelo portão</h2>
        <p class="bloco-desc">Cada acesso liberado ao Drive, pelo modo de verificação. Muito "código por e-mail" ou "sem JavaScript" costuma ser bloqueador de anúncio ou rede que atrapalha a verificação automática. Vale para todos os projetos: o portão não guarda qual foi.</p>
        <div id="grafico-portao" class="barras"></div>
      </div>
    </div>

    <div class="bloco">
      <div class="bloco-cabeca">
        <div>
          <h2>Projetos no período</h2>
          <p class="bloco-desc">Toque num projeto para ver só ele nos gráficos; toque de novo para voltar a todos.</p>
        </div>
      </div>
      <div class="chips" id="metrics-ordem" role="group" aria-label="Ordenar projetos por">
        <button type="button" class="chip" aria-pressed="true" data-onclick="ordenaRanking" data-ordem="views">Visitas</button>
        <button type="button" class="chip" aria-pressed="false" data-onclick="ordenaRanking" data-ordem="driveClicks">Abriram o Drive</button>
        <button type="button" class="chip" aria-pressed="false" data-onclick="ordenaRanking" data-ordem="taxa">Taxa</button>
      </div>
      <div id="metrics-ranking" class="ranking"><p class="empty">Carregando…</p></div>
    </div>

    <div class="bloco">
      <div class="bloco-cabeca">
        <div>
          <h2>Total desde o início</h2>
          <p class="bloco-desc">Tudo o que já foi contado, inclusive antes de existir a contagem por dia.</p>
        </div>
        <button class="btn-sm" id="metrics-export" data-onclick="exportMetricsCSV" style="display:none">⬇ CSV</button>
      </div>
      <p class="metrics-nota">
        Conta <strong>visitante único por hora</strong>, não recarregamento: abrir a
        mesma página de novo no mesmo navegador não soma. Por isso o número não se
        mexe quando você testa recarregando — é assim de propósito.
      </p>
      <div class="bloco-tabela"><div id="metrics-body"><p class="empty">Carregando…</p></div></div>
    </div>
  </section>

  <!-- AJUSTES -->
  <section id="tab-settings" class="panel" aria-labelledby="h-ajustes">
    <div class="secao-cabeca">
      <div>
        <h1 id="h-ajustes">Ajustes</h1>
        <p class="secao-sub">O que aparece no site, os dados guardados e o acesso ao painel.</p>
      </div>
    </div>

    <div class="grupo">
      <h2 class="grupo-titulo">Site</h2>
      <div class="grade-blocos">
        <div class="bloco">
          <h3>Selo de agenda</h3>
          <p class="bloco-desc">Uma frase curta no topo da galeria e da página Sobre — por exemplo "Agendando para janeiro/2027" ou "Agenda fechada até março". Vazio, o selo some.</p>
          <div class="cat-add" style="margin-top:1rem">
            <input type="text" id="agenda-texto" value="${esc(agenda)}" placeholder="Aceitando novos projetos" maxlength="${AGENDA_MAX_LEN}" data-keydown="saveAgenda" aria-label="Texto do selo de agenda">
            <button class="btn-sm" data-onclick="saveAgenda">Salvar</button>
          </div>
        </div>
        <div class="bloco">
          <h3>Categorias</h3>
          <p class="bloco-desc">Usadas para filtrar a galeria. Para aplicar uma categoria a vários eventos de uma vez, use "Selecionar vários" em Eventos.</p>
          <div id="cat-list" class="cat-list" style="margin-top:1rem"></div>
          <div class="cat-add">
            <input type="text" id="cat-new" placeholder="Nova categoria" maxlength="40" data-keydown="createCategory" aria-label="Nome da nova categoria">
            <button class="btn-sm" data-onclick="createCategory">Adicionar</button>
          </div>
        </div>
      </div>
    </div>

    <div class="grupo">
      <h2 class="grupo-titulo">Dados</h2>
      <div class="grade-blocos">
        <div class="bloco">
          <h3>Backup dos dados</h3>
          <p class="bloco-desc">Uma cópia completa: eventos, categorias e pedidos de remoção — estes com e-mail e telefone de quem pediu, então guarde o arquivo com cuidado. Não há backup automático: baixe depois de mudanças importantes.</p>
          <button class="btn-sm" style="margin-top:1rem" data-onclick="downloadBackup">⬇ Baixar backup JSON</button>
        </div>
        <div class="bloco">
          <h3>Exportar planilhas</h3>
          <p class="bloco-desc">Planilhas CSV (abrem no Excel e no Google Sheets) dos registros do site.</p>
          <div class="export-grid" style="margin-top:1rem">
            <button class="btn-sm" data-onclick="exportConsentCSV">⬇ Consentimentos (CSV)</button>
            <button class="btn-sm" data-onclick="exportRemovalCSV">⬇ Pedidos de remoção (CSV)</button>
            <button class="btn-sm" data-onclick="exportMetricsCSV">⬇ Métricas: totais (CSV)</button>
            <button class="btn-sm" data-onclick="exportSerieCSV">⬇ Métricas por dia (CSV)</button>
          </div>
        </div>
        <div class="bloco sensivel">
          <span class="sensivel-aviso">Pede confirmação digitada</span>
          <h3>Restaurar backup</h3>
          <p class="bloco-desc">Nenhum dado atual é apagado: os eventos do arquivo são mesclados com os que já existem (o mais recente vence).</p>
          <div class="field" style="margin-top:1rem">
            <label for="restore-file">Arquivo de backup (.json)</label>
            <input type="file" id="restore-file" accept=".json" class="arquivo">
          </div>
          <button class="btn-danger" data-onclick="restoreBackup">↩ Restaurar backup</button>
        </div>
      </div>
    </div>

    <div class="grupo">
      <h2 class="grupo-titulo">Conta</h2>
      <div class="grade-blocos">
        <div class="bloco sensivel">
          <span class="sensivel-aviso">Pede confirmação digitada</span>
          <h3>Trocar a senha do painel</h3>
          <p class="bloco-desc">Mínimo de ${PASSWORD_MIN_LENGTH} caracteres. Use três tipos de caractere (minúscula, maiúscula, número, símbolo) — ou uma frase com 20+ caracteres, que dispensa a mistura.</p>
          <div class="field" style="margin-top:1rem">
            <label for="new-pass">Nova senha</label>
            <input type="password" id="new-pass" placeholder="••••••••" autocomplete="new-password" minlength="${PASSWORD_MIN_LENGTH}">
          </div>
          <div class="field">
            <label for="new-pass2">Confirmar senha</label>
            <input type="password" id="new-pass2" placeholder="••••••••" autocomplete="new-password" minlength="${PASSWORD_MIN_LENGTH}">
          </div>
          <button class="btn-danger" data-onclick="changePassword">Salvar nova senha</button>
        </div>
      </div>
    </div>
  </section>
  </main>
  </div>

  <!-- EVENT FORM OVERLAY -->
  <div class="overlay" id="overlay">
    <div class="sheet" id="sheet" role="dialog" aria-modal="true" aria-labelledby="form-title">
      <div class="sheet-head">
        <h2 id="form-title">Adicionar evento</h2>
        <button class="icon-btn" data-onclick="closeForm" aria-label="Fechar">
          <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
        </button>
      </div>
      <div class="sheet-body">
        <!-- Atalhos para os blocos: o formulário é longo, e no celular rolar até
             "Acesso" ou "Produção" era o que mais cansava (#220). -->
        <nav class="bf-atalhos" aria-label="Blocos do formulário">
          <button type="button" class="chip" data-onclick="irParaBloco" data-alvo="bf-basico">Básico</button>
          <button type="button" class="chip" data-onclick="irParaBloco" data-alvo="bf-fotos">Fotos e Drive</button>
          <button type="button" class="chip" data-onclick="irParaBloco" data-alvo="bf-video">Vídeo</button>
          <button type="button" class="chip" data-onclick="irParaBloco" data-alvo="bf-acesso">Acesso e LGPD</button>
          <button type="button" class="chip" data-onclick="irParaBloco" data-alvo="bf-producao">Prazo e status</button>
          <button type="button" class="chip" data-onclick="irParaBloco" data-alvo="bf-pagina">Página</button>
        </nav>
        <details class="bloco-form" id="bf-basico" open>
          <summary><span class="bf-titulo">Básico</span><span class="bf-resumo" data-resumo="bf-basico"></span></summary>
          <p class="bf-dica">O endereço, o nome e quando foi.</p>
          <div class="field">
            <label for="f-slug">URL do projeto <span class="req-star">*</span> <span style="color:#555">(só letras minúsculas, números e -)</span></label>
            <div class="slug-prefix">
              <span>fotos.lucafchala.com/</span>
              <input type="text" id="f-slug" placeholder="meu-evento-2025" pattern="[a-z0-9][a-z0-9\\-]*[a-z0-9]|[a-z0-9]" maxlength="60">
            </div>
          </div>
          <div class="field">
            <label for="f-title">Título <span class="req-star">*</span></label>
            <input type="text" id="f-title" placeholder="Ex: Formatura Turma 2025">
          </div>
          <div class="field-row">
            <div class="field">
              <label for="f-date">Data</label>
              <input type="date" id="f-date">
            </div>
            <div class="field">
              <label for="f-category">Categoria <span style="color:#555">(opcional)</span></label>
              <select id="f-category">${catOptionsSSR}</select>
            </div>
          </div>
          <div class="field">
            <label for="f-long">Descrição completa <span style="color:#555">(aparece na página do projeto)</span></label>
            <textarea id="f-long" placeholder="Detalhes sobre o evento, contexto, etc."></textarea>
          </div>
        </details>
        <details class="bloco-form" id="bf-fotos" open>
          <summary><span class="bf-titulo">Fotos e Drive</span><span class="bf-resumo" data-resumo="bf-fotos"></span></summary>
          <p class="bf-dica">De onde as fotos saem: a pasta do Drive (obrigatória) e as capas que aparecem na galeria.</p>
          <div class="field">
            <label for="f-drive">Link da pasta do Google Drive <span class="req-star">*</span></label>
            <input type="url" id="f-drive" placeholder="https://drive.google.com/drive/folders/...">
          </div>
          <div class="field">
            <!-- Parágrafo, e não rótulo de campo: titula uma LISTA de campos.
                 A lista se apresenta como grupo com este título. -->
            <p class="rotulo-campo" id="rot-capas">Fotos de capa <span style="color:#555">(até 6)</span></p>
            <div class="field-hint" style="margin-bottom:.625rem">A primeira foto aparece como miniatura na galeria. Cole links do Drive ou URLs diretas de imagem — a conversão é automática.</div>
            <div class="photo-list" id="photo-list" role="group" aria-labelledby="rot-capas"></div>
            <div style="display:flex;gap:.5rem;flex-wrap:wrap;margin-top:.25rem">
              <button type="button" class="btn-add-photo" id="btn-add-photo" data-onclick="addPhotoInput">
                <svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
                Adicionar foto
              </button>
              <button type="button" class="btn-sm" id="btn-paste-photos" data-onclick="openPastePhotos">📋 Colar vários links</button>
            </div>
            <div id="paste-photos-box" style="display:none;margin-top:.625rem">
              <textarea id="paste-photos-input" placeholder="Um link por linha" rows="4" style="width:100%"></textarea>
              <div style="display:flex;gap:.5rem;margin-top:.5rem">
                <button type="button" class="btn-sm" data-onclick="commitPastePhotos">Adicionar</button>
                <button type="button" class="btn-sm" data-onclick="closePastePhotos">Cancelar</button>
              </div>
            </div>
          </div>
          <div class="field">
            <label for="f-drive-ig">Link do Drive para o Instagram <span style="color:#555">(opcional)</span></label>
            <div class="field-hint" style="margin-bottom:.625rem">Pasta com as fotos já redimensionadas e prontas para o Instagram.</div>
            <input type="url" id="f-drive-ig" placeholder="https://drive.google.com/drive/folders/...">
          </div>
        </details>
        <details class="bloco-form" id="bf-video">
          <summary><span class="bf-titulo">Vídeo</span><span class="bf-resumo" data-resumo="bf-video"></span></summary>
          <p class="bf-dica">Opcional: vídeo no topo da página, mais vídeos abaixo da descrição e a pasta só de vídeos.</p>
          <div class="field">
            <label for="f-youtube">Vídeo do YouTube na página <span style="color:#555">(opcional)</span></label>
            <div class="field-hint" style="margin-bottom:.625rem">Toca no topo da página do projeto, no lugar das fotos de capa. Suba no YouTube como <strong>Não listado</strong> e cole o link aqui. O player só carrega quando o visitante clica em play.</div>
            <input type="url" id="f-youtube" placeholder="https://youtu.be/...">
          </div>
          <div class="field">
            <label for="f-youtube-mais">Mais vídeos do YouTube <span style="color:#555">(opcional, até 5)</span></label>
            <div class="field-hint" style="margin-bottom:.625rem">Um link por linha. Aparecem abaixo da descrição, cada um com play. Link de <strong>Shorts</strong> já sai vertical; para outro vídeo vertical, escreva <code>vertical</code> no fim da linha.</div>
            <textarea id="f-youtube-mais" rows="3" placeholder="https://youtu.be/...&#10;https://youtube.com/shorts/..."></textarea>
          </div>
          <div class="field">
            <label for="f-drive-videos">Link do Drive só com os vídeos <span style="color:#555">(opcional)</span></label>
            <div class="field-hint" style="margin-bottom:.625rem">Pasta só com os vídeos do evento, para quem já baixou as fotos. Deixe os vídeos também dentro da pasta principal — quem entra por ela deve ver tudo. Preenchido, o projeto ganha o selo "Vídeos" na galeria.</div>
            <input type="url" id="f-drive-videos" placeholder="https://drive.google.com/drive/folders/...">
          </div>
        </details>
        <details class="bloco-form" id="bf-acesso">
          <summary><span class="bf-titulo">Acesso e LGPD</span><span class="bf-resumo" data-resumo="bf-acesso"></span></summary>
          <p class="bf-dica">Quem pode abrir as fotos e se o evento aparece na galeria.</p>
          <div class="field">
            <label for="f-access">Tipo de acesso</label>
            <select id="f-access">
              <option value="public" selected>Público</option>
              <option value="private">Privado</option>
              <option value="family">Familiar</option>
            </select>
            <div class="field-hint" style="margin-top:.5rem">Define a autodeclaração exigida no gateway antes de liberar o Drive. <strong>Público</strong>: só o aceite dos Termos. <strong>Privado/Familiar</strong>: o visitante também precisa declarar que é participante/autorizado ou membro da família.</div>
          </div>
          <div class="field">
            <div class="toggle-row">
              <label class="toggle-label" for="f-visible">Visível na galeria</label>
              <label class="toggle">
                <input type="checkbox" id="f-visible" checked>
                <span class="toggle-track"></span>
              </label>
            </div>
          </div>
          <div class="field">
            <div class="toggle-row">
              <label class="toggle-label" for="f-comingsoon">Em breve <span style="color:var(--text3);font-size:.7rem;font-weight:400">(oculta as fotos)</span></label>
              <label class="toggle">
                <input type="checkbox" id="f-comingsoon">
                <span class="toggle-track"></span>
              </label>
            </div>
            <div class="field-hint" style="margin-top:.5rem">Quando ativo: o card na galeria e a página do projeto ficam visíveis, mas as fotos de capa são escondidas e o botão do Drive vira "As fotos virão em breve".</div>
          </div>
        </details>
        <details class="bloco-form" id="bf-producao">
          <summary><span class="bf-titulo">Prazo e status</span><span class="bf-resumo" data-resumo="bf-producao"></span></summary>
          <p class="bf-dica">Em que pé está a entrega — só você vê.</p>
          <div class="field">
            <label for="f-status">Status de produção</label>
            <select id="f-status">
              <option value="em-edicao">Em edição</option>
              <option value="em-revisao">Em revisão</option>
              <option value="entregue" selected>Entregue</option>
              <option value="arquivado">Arquivado</option>
            </select>
          </div>
          <div class="field">
            <label for="f-promised">Data prometida de entrega <span style="color:#555">(opcional)</span></label>
            <div class="field-hint" style="margin-bottom:.625rem">Se passar da data e o evento ainda não estiver "Entregue", ele aparece destacado em vermelho na lista.</div>
            <input type="date" id="f-promised">
          </div>
          <div class="field">
            <label for="f-notes">Notas privadas <span style="color:#555">(só você vê)</span></label>
            <textarea id="f-notes" placeholder="Cliente, valor cobrado, observações, links de contrato…" rows="3"></textarea>
          </div>
        </details>
        <details class="bloco-form" id="bf-pagina">
          <summary><span class="bf-titulo">Página do projeto</span><span class="bf-resumo" data-resumo="bf-pagina"></span></summary>
          <p class="bf-dica">Créditos, link extra e o aviso de fotos novas.</p>
          <div class="field">
            <label for="f-credits">Em colaboração com <span style="color:#555">(opcional — instituição, fotógrafo colaborador ou projeto)</span></label>
            <input type="text" id="f-credits" placeholder="Ex: Colégio Santa Cruz">
          </div>
          <div class="field">
            <label for="f-purl">Link extra do projeto <span style="color:#555">(opcional)</span></label>
            <input type="url" id="f-purl" placeholder="https://...">
          </div>
          <div class="field">
            <label for="f-alert-active">Aviso de novidade</label>
            <div class="toggle-row" style="margin-bottom:.75rem">
              <span style="font-size:.85rem;color:var(--text2)">Mostrar banner na página do projeto</span>
              <label class="toggle">
                <input type="checkbox" id="f-alert-active" data-onchange="toggleAlertOpts">
                <span class="toggle-track"></span>
              </label>
            </div>
            <div id="alert-opts" style="display:none">
              <div class="field-hint" style="margin-bottom:.625rem">Exibe "Novas fotos adicionadas há X" (ou "Novos vídeos") com o horário atual. Ao reativar o aviso, o contador reinicia.</div>
              <select id="f-alert-kind" aria-label="O que foi adicionado" style="width:100%;background:var(--bg2);border:1px solid var(--border);color:var(--text);padding:.75rem .875rem;border-radius:8px;font-size:.875rem;outline:none;-webkit-appearance:none;margin-bottom:.625rem">
                <option value="fotos" selected>Novas fotos adicionadas</option>
                <option value="videos">Novos vídeos adicionados</option>
              </select>
              <select id="f-alert-expires" style="width:100%;background:var(--bg2);border:1px solid var(--border);color:var(--text);padding:.75rem .875rem;border-radius:8px;font-size:.875rem;outline:none;-webkit-appearance:none">
                <option value="0">Não expirar automaticamente</option>
                <option value="1">Sumir em 1 hora</option>
                <option value="6">Sumir em 6 horas</option>
                <option value="24" selected>Sumir em 24 horas</option>
                <option value="48">Sumir em 2 dias</option>
                <option value="168">Sumir em 7 dias</option>
              </select>
            </div>
          </div>
        </details>
      </div>
      <div class="sheet-foot">
        <button class="btn-secondary" data-onclick="closeForm">Cancelar</button>
        <button class="btn-primary" id="submit-btn" data-onclick="submitForm">Salvar</button>
      </div>
    </div>
  </div>

  <div class="toast" id="toast"></div>

  <script nonce="${nonce}">
    // Daqui até o fecha-script tudo vive dentro de um template literal: uma
    // crase solta, em comentário ou string, encerra a string e quebra o módulo.
    let events = ${eventsJSON};
    let categories = ${categoriesJSON};
    // Ícones e card de evento: a MESMA fonte do servidor. O card é o código da
    // função cardProjetoPainel() de dashboard.js, inteiro (toString), entre
    // parênteses — assim o nome que o bundler der à função não importa.
    const ICONES = ${jsonParaScript(ICONES)};
    const cardProjeto = (${cardProjetoPainel.toString()});
    // Menu "Mais ações" aberto agora (no máximo um). Declarado aqui em cima:
    // renderEventList() o fecha e roda já na inicialização.
    let menuAberto = null;
    let massMode = false;
    let selectedIds = new Set();
    let editingId = null;
    let metricsLoaded = false;
    let metricsData = [];
    let metricsSort = { key: 'views', dir: 'desc' };
    // Métricas v2 (#215): a série por dia (UMA leitura de 180 dias — o maior
    // período, 90, mais os 90 de antes para a comparação) e o que o dono
    // escolheu nos filtros. Trocar filtro redesenha daqui, sem pedir nada ao
    // servidor. O período escolhido volta ao recarregar (sessionStorage).
    let serieDiaria = null;
    let metricsPeriodo = (function () {
      try { const n = Number(sessionStorage.getItem('painel:periodo')); return [7, 30, 90].includes(n) ? n : 30; } catch (e) { return 30; }
    })();
    let metricsProjeto = '';
    let metricsOrdem = 'views';
    let recorteAtual = null;
    let geoAcessos = null;
    let cruzIdx = -1;
    let tabelaAcessosAberta = false;
    let dicasSemana = [];
    // Paleta dos gráficos, validada sobre o fundo dos blocos (#141414): ver o
    // comentário "Métricas v2" no CSS. Uma cor por COISA, sempre a mesma.
    const COR_VISITAS = '#3987e5';
    const COR_DRIVE = '#d95926';
    const COR_PORTAO = '#199e70';
    let photoList = [];
    // Declared here (not down by stashDraft()) because restoreDraft() runs
    // during init, before that point — a const isn't hoisted like a function,
    // so the call would hit a TDZ ReferenceError, silently swallowed by
    // init's try/catch, and the draft would never come back.
    const DRAFT_KEY = 'fotos:draft';
    const DRAFT_MAX_AGE_MS = 3600000; // 1 h — rascunho velho demais confunde mais do que ajuda
    let requestsLoaded = false;
    let lastFocused = null;
    let formSnapshot = '';
    const STATUS_LABELS = { 'em-edicao': 'Em edição', 'em-revisao': 'Em revisão', 'entregue': 'Entregue', 'arquivado': 'Arquivado' };
    // Os ajudantes do lado do NAVEGADOR para o card compartilhado (os do
    // servidor ficam em dashboardHTML, com escape/safeUrl de utils.js).
    const ajudaCard = { esc: esc, safeUrl: safeUrl, rotulo: st => STATUS_LABELS[st] || st, atrasado: isOverdue, icones: ICONES };
    // Espelha isOverdue() da versão SSR acima — mesma regra, dois contextos
    // (Worker no request inicial, browser depois de cada ação).
    function isOverdue(e) {
      const st = e.status || 'entregue';
      if (!e.promisedDate || st === 'entregue' || st === 'arquivado') return false;
      return e.promisedDate < hojeEmSaoPaulo();
    }
    // Cópia de hojeEmSaoPaulo() de utils.js (#192): o navegador do dono pode
    // estar em qualquer fuso, e o prazo é o de São Paulo. Presa à do servidor
    // por describe('pares cliente/servidor') em tests/security.test.js.
    function hojeEmSaoPaulo(agora = new Date()) {
      return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo', year: 'numeric', month: '2-digit', day: '2-digit' }).format(agora);
    }
    // Same ordering criterion as utils.sortEvents (pinned first, then date desc).
    const byDate = e => e.date ? new Date(e.date).getTime() : new Date(e.createdAt || 0).getTime();

    // ---- Init ----
    // Event delegation for evt-list buttons (works for both SSR and JS-rendered items)
    document.getElementById('evt-list').addEventListener('click', function(ev) {
      // "Abrir a página do projeto" é um link (abre noutra aba): só fecha o menu.
      if (ev.target.closest('.menu a')) { fechaMenus(); return; }
      const btn = ev.target.closest('[data-action]');
      if (!btn) return;
      const { action, id } = btn.dataset;
      if (action === 'menu') { alternaMenu(btn); return; }
      fechaMenus();
      if (action === 'edit') openForm(id);
      else if (action === 'dup') duplicateEvent(id);
      else if (action === 'del') deleteEvent(id);
      else if (action === 'pin') togglePin(id);
      else if (action === 'vis') toggleVisible(id);
    });
    // Selection checkboxes (mass-edit mode)
    document.getElementById('evt-list').addEventListener('change', function(ev) {
      const cb = ev.target.closest('.evt-check');
      if (!cb) return;
      if (cb.checked) selectedIds.add(cb.dataset.id); else selectedIds.delete(cb.dataset.id);
      updateMassCount();
    });

    // ---- Delegated handlers (CSP: no inline on* attributes) ----
    // Photo-list row buttons/inputs (container survives renderPhotoList()'s innerHTML swaps).
    document.getElementById('photo-list').addEventListener('click', function(ev) {
      const btn = ev.target.closest('[data-action="removePhoto"]');
      if (btn) removePhotoInput(parseInt(btn.dataset.i, 10));
    });
    document.getElementById('photo-list').addEventListener('input', function(ev) {
      const el = ev.target.closest('[data-photo-input]');
      if (el) onPhotoInput(parseInt(el.dataset.i, 10), el);
    });
    // 'blur' doesn't bubble — 'focusout' is its bubbling equivalent, same trigger point.
    document.getElementById('photo-list').addEventListener('focusout', function(ev) {
      const el = ev.target.closest('[data-photo-input]');
      if (el) onPhotoBlur(parseInt(el.dataset.i, 10), el);
    });
    // Requests tab (container survives loadRequests()'s innerHTML swaps).
    document.getElementById('requests-body').addEventListener('click', function(ev) {
      const resolveBtn = ev.target.closest('[data-action="resolveRequest"]');
      if (resolveBtn) { resolveRequest(resolveBtn.dataset.id, resolveBtn); return; }
      const toggleBtn = ev.target.closest('[data-action="toggleResolved"]');
      if (toggleBtn) toggleResolved(parseInt(toggleBtn.dataset.gi, 10));
    });
    // Metrics table (container survives renderMetrics()'s innerHTML swaps).
    document.getElementById('metrics-body').addEventListener('click', function(ev) {
      const th = ev.target.closest('[data-action="sortMetrics"]');
      if (th) sortMetrics(th.dataset.sort);
    });
    // Métricas v2: a lista de projetos e as colunas da semana são refeitas a
    // cada filtro (innerHTML); os ouvintes ficam nos contêineres, que não.
    document.getElementById('metrics-ranking').addEventListener('click', function(ev) {
      const item = ev.target.closest('[data-action="focaProjeto"]');
      if (item) focaProjeto(item.dataset.slug);
    });
    document.getElementById('grafico-semana').addEventListener('click', function(ev) {
      const col = ev.target.closest('[data-coluna]');
      const leitura = document.getElementById('semana-leitura');
      if (col && leitura && dicasSemana[Number(col.dataset.coluna)]) leitura.textContent = dicasSemana[Number(col.dataset.coluna)] + '.';
    });
    // A cruz do gráfico de acessos. Ponteiro (mouse, dedo, caneta): o dia mais
    // perto do x. Teclado, com o gráfico em foco: setas andam um dia, Home e
    // End vão às pontas, Esc esconde — e cada passo é anunciado ao leitor de
    // tela. No toque a dica fica até tocar fora do gráfico.
    (function ligaGraficoAcessos() {
      const box = document.getElementById('grafico-acessos');
      const doPonteiro = ev => {
        const svg = box.querySelector('svg');
        const g = geoAcessos;
        if (!svg || !g) return -1;
        const rect = svg.getBoundingClientRect();
        const x = (ev.clientX - rect.left) * (g.largura / (rect.width || g.largura));
        return g.n <= 1 ? 0 : Math.round((x - g.esq) / g.w * (g.n - 1));
      };
      box.addEventListener('pointermove', ev => { const i = doPonteiro(ev); if (i >= 0) mostraCruz(i, false); });
      box.addEventListener('pointerdown', ev => { const i = doPonteiro(ev); if (i >= 0) mostraCruz(i, false); });
      box.addEventListener('pointerleave', ev => { if (ev.pointerType === 'mouse') escondeCruz(); });
      document.addEventListener('pointerdown', ev => { if (!box.contains(/** @type {Node} */ (ev.target))) escondeCruz(); });
      box.addEventListener('focus', () => { if (geoAcessos) mostraCruz(cruzIdx >= 0 ? cruzIdx : geoAcessos.n - 1, true); });
      box.addEventListener('blur', () => escondeCruz());
      box.addEventListener('keydown', ev => {
        const g = geoAcessos;
        if (!g) return;
        let i = cruzIdx < 0 ? g.n - 1 : cruzIdx;
        if (ev.key === 'ArrowLeft') i--;
        else if (ev.key === 'ArrowRight') i++;
        else if (ev.key === 'Home') i = 0;
        else if (ev.key === 'End') i = g.n - 1;
        else if (ev.key === 'Escape') { escondeCruz(); return; }
        else return;
        ev.preventDefault();
        mostraCruz(i, true);
      });
      // Redesenha quando a LARGURA muda (girar o celular, abrir a lateral):
      // o SVG é desenhado na medida, em pixels, para o texto não esticar.
      // requestAnimationFrame: redesenhar dentro do próprio aviso do
      // ResizeObserver dispara o erro de "loop" no console.
      if (typeof ResizeObserver === 'function') {
        const larguras = new Map();
        const ro = new ResizeObserver(entradas => {
          let mudou = false;
          for (const en of entradas) {
            const w = Math.round(en.contentRect.width);
            if (w > 0 && Math.abs((larguras.get(en.target) || 0) - w) > 2) { larguras.set(en.target, w); mudou = true; }
          }
          if (mudou && serieDiaria) requestAnimationFrame(() => { renderGraficoAcessos(); renderSemana(); });
        });
        ro.observe(box);
        ro.observe(document.getElementById('grafico-semana'));
      }
    })();
    // 'load'/'error' don't bubble, but a capture-phase listener on document
    // still sees them on the way down — this script runs synchronously before
    // the event loop can fire any queued load/error task for images already
    // in the markup above, so nothing here is missed.
    document.addEventListener('error', function(ev) {
      if (ev.target && ev.target.dataset && ev.target.dataset.onerror === 'hide') ev.target.style.display = 'none';
    }, true);
    document.addEventListener('load', function(ev) {
      if (ev.target && ev.target.dataset && ev.target.dataset.onload === 'show') ev.target.style.display = 'block';
    }, true);
    // Everything else: static buttons/selects that are never regenerated.
    document.addEventListener('click', function(ev) {
      if (ev.target.id === 'overlay') { closeForm(); return; }
      const el = ev.target.closest('[data-onclick]');
      if (!el) return;
      switch (el.dataset.onclick) {
        case 'switchTab': switchTab(el.dataset.tab, el); break;
        case 'filtraStatus': filtraStatus(el); break;
        case 'irParaBloco': irParaBloco(el.dataset.alvo); break;
        case 'toggleMassMode': toggleMassMode(); break;
        case 'openForm': openForm(); break;
        case 'applyMassCategory': applyMassCategory(); break;
        case 'applyMassAccess': applyMassAccess(); break;
        case 'exportMetricsCSV': exportMetricsCSV(); break;
        case 'exportSerieCSV': exportSerieCSV(); break;
        case 'loadMetrics': loadMetrics(el); break;
        case 'escolhePeriodo': escolhePeriodo(el); break;
        case 'ordenaRanking': ordenaRanking(el); break;
        case 'alternaTabelaAcessos': alternaTabelaAcessos(); break;
        case 'createCategory': createCategory(); break;
        case 'saveAgenda': saveAgenda(); break;
        case 'downloadBackup': downloadBackup(); break;
        case 'exportConsentCSV': exportConsentCSV(); break;
        case 'exportRemovalCSV': exportRemovalCSV(); break;
        case 'changePassword': changePassword(); break;
        case 'restoreBackup': restoreBackup(); break;
        case 'closeForm': closeForm(); break;
        case 'submitForm': submitForm(); break;
        case 'addPhotoInput': addPhotoInput(''); break;
        case 'openPastePhotos': openPastePhotos(); break;
        case 'commitPastePhotos': commitPastePhotos(); break;
        case 'closePastePhotos': closePastePhotos(); break;
      }
    });
    document.addEventListener('change', function(ev) {
      const el = ev.target.closest('[data-onchange]');
      if (!el) return;
      switch (el.dataset.onchange) {
        case 'renderEventList': renderEventList(); break;
        case 'toggleSelectAll': toggleSelectAll(el.checked); break;
        case 'toggleAlertOpts': toggleAlertOpts(el.checked); break;
        case 'escolheProjeto': escolheProjeto(el); break;
      }
    });
    document.addEventListener('input', function(ev) {
      if (ev.target.closest('[data-oninput="renderEventList"]')) renderEventList();
    });
    document.addEventListener('keydown', function(ev) {
      if (ev.key === 'Enter' && ev.target.closest('[data-keydown="createCategory"]')) createCategory();
      if (ev.key === 'Enter' && ev.target.closest('[data-keydown="saveAgenda"]')) saveAgenda();
    });

    try { renderEventList(); } catch(e) { console.error('renderEventList:', e); }
    refreshCategorySelects();
    renderCategoryManager();
    loadRequests();
    // Depois de a lista existir: se a sessão expirou no meio de uma edição,
    // reabre o formulário com o que estava digitado.
    try { restoreDraft(); } catch(e) { console.error('restoreDraft:', e); }

    // ---- Seções (a nav lateral / de baixo) ----
    // A seção aberta fica no sessionStorage da aba: recarregar a página (ou o
    // reload depois de restaurar um backup) volta para onde o dono estava, e
    // não para Eventos. sessionStorage, não localStorage: morre com a aba.
    const CHAVE_SECAO = 'painel:secao';
    function switchTab(name, btn) {
      fechaMenus();
      document.querySelectorAll('.tab').forEach(t => { t.classList.remove('active'); t.removeAttribute('aria-current'); });
      document.querySelectorAll('.panel').forEach(p => p.classList.remove('active'));
      btn.classList.add('active');
      btn.setAttribute('aria-current', 'page');
      document.getElementById('tab-' + name).classList.add('active');
      window.scrollTo(0, 0);
      try { sessionStorage.setItem(CHAVE_SECAO, name); } catch (e) {}
      if (name === 'metrics') loadMetrics();
      if (name === 'requests' && !requestsLoaded) loadRequests();
    }
    (function voltaParaSecao() {
      let salva = null;
      try { salva = sessionStorage.getItem(CHAVE_SECAO); } catch (e) {}
      const btn = salva && salva !== 'events' ? document.querySelector('.tab[data-tab="' + salva + '"]') : null;
      if (btn) switchTab(salva, btn);
    })();

    // ---- Filtro rápido de status ----
    function filtroStatusAtual() {
      const b = document.querySelector('#status-filter [aria-pressed="true"]');
      return (b && b.dataset.valor) || 'todos';
    }
    function filtraStatus(btn) {
      document.querySelectorAll('#status-filter .chip').forEach(c => c.setAttribute('aria-pressed', String(c === btn)));
      renderEventList();
    }

    // ---- Menu "Mais ações" do card ----
    // Lista suspensa no computador, folha de baixo no celular (o CSS decide).
    // Um aberto por vez; clique fora, Esc ou Tab fecham; setas andam entre os
    // itens; Esc devolve o foco ao botão que abriu.
    function alternaMenu(botao) {
      const menu = botao.parentElement ? botao.parentElement.querySelector('.menu') : null;
      if (!menu) return;
      const eraEste = menuAberto && menuAberto.menu === menu;
      fechaMenus();
      if (eraEste) return;
      menu.hidden = false;
      botao.setAttribute('aria-expanded', 'true');
      const fundo = document.getElementById('menu-fundo');
      if (fundo) fundo.hidden = false;
      menuAberto = { botao: botao, menu: menu };
      const primeiro = menu.querySelector('.menu-item');
      if (primeiro) primeiro.focus();
    }
    function fechaMenus(devolveFoco) {
      if (!menuAberto) return;
      const aberto = menuAberto;
      menuAberto = null;
      aberto.menu.hidden = true;
      aberto.botao.setAttribute('aria-expanded', 'false');
      const fundo = document.getElementById('menu-fundo');
      if (fundo) fundo.hidden = true;
      if (devolveFoco && aberto.botao.isConnected) aberto.botao.focus();
    }
    document.addEventListener('click', function(ev) {
      if (menuAberto && !ev.target.closest('.mais')) fechaMenus();
    }, true);
    document.addEventListener('keydown', function(ev) {
      if (!menuAberto) return;
      if (ev.key === 'Escape') { ev.preventDefault(); fechaMenus(true); return; }
      if (ev.key === 'Tab') { fechaMenus(); return; }
      if (ev.key === 'ArrowDown' || ev.key === 'ArrowUp') {
        ev.preventDefault();
        const itens = Array.from(menuAberto.menu.querySelectorAll('.menu-item'));
        const i = itens.indexOf(document.activeElement);
        const prox = ev.key === 'ArrowDown' ? (i + 1) % itens.length : (i - 1 + itens.length) % itens.length;
        itens[prox].focus();
      }
    });

    // ---- Event List ----
    function renderEventList() {
      const list = document.getElementById('evt-list');
      const count = document.getElementById('evt-count');
      fechaMenus();
      const filter = filtroStatusAtual();
      const catFilter = document.getElementById('category-filter')?.value || '';
      const q = (document.getElementById('evt-search')?.value || '').trim().toLowerCase();
      const byStatus =
        filter === 'todos' ? events :
        filter === 'ativos' ? events.filter(e => (e.status || 'entregue') !== 'arquivado') :
        events.filter(e => (e.status || 'entregue') === filter);
      const byCategory = catFilter ? byStatus.filter(e => (e.category || '') === catFilter) : byStatus;
      const filtered = q
        ? byCategory.filter(e =>
            (e.title || '').toLowerCase().includes(q) ||
            (e.slug || '').toLowerCase().includes(q) ||
            (e.category || '').toLowerCase().includes(q))
        : byCategory;
      const sorted = [...filtered].sort((a, b) => {
        if (a.pinned && !b.pinned) return -1;
        if (!a.pinned && b.pinned) return 1;
        return byDate(b) - byDate(a);
      });
      const noun = n => n === 1 ? 'evento' : 'eventos';
      count.textContent = q
        ? \`\${sorted.length} \${noun(sorted.length)} encontrado\${sorted.length !== 1 ? 's' : ''}\`
        : filter === 'todos' ? \`\${events.length} \${noun(events.length)}\` :
          filter === 'ativos' ? \`\${sorted.length} \${noun(sorted.length)} ativos\` :
          \`\${sorted.length} \${noun(sorted.length)} (\${STATUS_LABELS[filter]})\`;
      if (sorted.length === 0) {
        list.innerHTML =
          q ? \`<p class="empty">Nenhum evento encontrado para "\${esc(q)}".</p>\` :
          filter === 'ativos' && events.length > 0 ? '<p class="empty">Nenhum evento ativo — todos foram arquivados.</p>' :
          (filter === 'todos' || filter === 'ativos') ? '<p class="empty">Nenhum evento ainda. Toque em "Novo evento" para criar o primeiro.</p>' :
          \`<p class="empty">Nenhum evento com status "\${STATUS_LABELS[filter]}".</p>\`;
        return;
      }
      list.innerHTML = sorted.map(e => cardProjeto(e, ajudaCard, massMode ? selectedIds.has(e.id) : null)).join('');
    }

    // ---- Form open/close ----
    // prefill (used by duplicateEvent) opens the "new event" form pre-filled
    // from an existing event, but id stays null so submitForm() POSTs a new
    // event instead of PUTing the source one.
    function openForm(id, prefill) {
      editingId = id || null;
      const e = id ? events.find(ev => ev.id === id) : (prefill || null);
      document.getElementById('form-title').textContent = id ? 'Editar evento' : 'Adicionar evento';
      const slugEl = document.getElementById('f-slug');
      slugEl.value = e ? e.slug : '';
      slugEl.readOnly = !!id;
      slugEl.style.opacity = id ? '.5' : '1';
      document.getElementById('f-title').value = e ? (e.title || '') : '';
      document.getElementById('f-long').value = e ? (e.longDescription || '') : '';
      document.getElementById('f-drive').value = e ? (e.driveUrl || '') : '';
      document.getElementById('f-drive-ig').value = e ? (e.driveUrlInstagram || '') : '';
      document.getElementById('f-drive-videos').value = e ? (e.driveUrlVideos || '') : '';
      document.getElementById('f-youtube').value = e && e.youtubeId ? 'https://youtu.be/' + e.youtubeId : '';
      // Vertical volta como link de Shorts: o servidor o reconhece como
      // vertical, então editar e salvar sem mexer não perde a proporção.
      document.getElementById('f-youtube-mais').value = e && Array.isArray(e.youtubeMais)
        ? e.youtubeMais.map(v => v.vertical ? 'https://www.youtube.com/shorts/' + v.id : 'https://youtu.be/' + v.id).join('\\n')
        : '';
      document.getElementById('f-date').value = e ? (e.date || '') : '';
      document.getElementById('f-credits').value = e ? (e.eventCredits || '') : '';
      document.getElementById('f-purl').value = e ? (e.projectUrl || '') : '';
      document.getElementById('f-promised').value = e ? (e.promisedDate || '') : '';
      document.getElementById('f-visible').checked = e ? (e.visible !== false) : true;
      document.getElementById('f-comingsoon').checked = e ? (e.comingSoon === true) : false;
      document.getElementById('f-status').value = e?.status || 'entregue';
      document.getElementById('f-access').value = e?.accessType || 'public';
      document.getElementById('f-category').value = e?.category || '';
      document.getElementById('f-notes').value = e?.internalNotes || '';
      const alertActive = e?.photosAlert?.active === true;
      const alertActiveEl = document.getElementById('f-alert-active');
      alertActiveEl.checked = alertActive;
      alertActiveEl.dataset.wasActive = alertActive ? '1' : '0';
      document.getElementById('f-alert-expires').value = String(e?.photosAlert?.expiresAfterHours ?? 24);
      document.getElementById('f-alert-kind').value = e?.photosAlert?.kind === 'videos' ? 'videos' : 'fotos';
      toggleAlertOpts(alertActive);
      const initPhotos = e
        ? (Array.isArray(e.photos) && e.photos.length ? e.photos : e.thumbnailUrl ? [e.thumbnailUrl] : [])
        : [];
      photoList = [...initPhotos];
      renderPhotoList();
      closePastePhotos();
      // Todo formulário abre igual: o essencial aberto, o resto recolhido com
      // o resumo à vista. Rola para o topo (o sheet guardava a rolagem anterior).
      document.querySelectorAll('.bloco-form').forEach(b => { b.open = b.id === 'bf-basico' || b.id === 'bf-fotos'; });
      const corpo = document.querySelector('.sheet-body');
      if (corpo) corpo.scrollTop = 0;
      atualizaResumos();
      lastFocused = document.activeElement;
      document.getElementById('overlay').classList.add('open');
      document.body.style.overflow = 'hidden';
      if (!id) setTimeout(() => slugEl.focus(), 100);
      formSnapshot = snapshotForm();
    }

    // Mirrors the fields submitForm() reads into its save payload (plus
    // photoList) — keep the two in sync when adding a field.
    function snapshotForm() {
      const val = id => document.getElementById(id)?.value ?? '';
      const chk = id => document.getElementById(id)?.checked ?? false;
      return JSON.stringify({
        title: val('f-title'), long: val('f-long'), drive: val('f-drive'),
        driveIg: val('f-drive-ig'), driveVideos: val('f-drive-videos'), youtube: val('f-youtube'), youtubeMais: val('f-youtube-mais'), date: val('f-date'), credits: val('f-credits'), purl: val('f-purl'),
        promised: val('f-promised'),
        visible: chk('f-visible'), comingSoon: chk('f-comingsoon'), status: val('f-status'),
        accessType: val('f-access'), category: val('f-category'), notes: val('f-notes'),
        alertActive: chk('f-alert-active'), alertExpires: val('f-alert-expires'), alertKind: val('f-alert-kind'),
        photos: photoList,
      });
    }
    function isFormDirty() {
      return document.getElementById('overlay').classList.contains('open') && snapshotForm() !== formSnapshot;
    }

    // ---- Rascunho de emergência (sessão expirada) ----
    // A sessão expira por inatividade (2h); api() manda para o login no 401 e,
    // sem isto, o que estava sendo editado se perdia. sessionStorage (não
    // localStorage) porque o rascunho pode conter notas internas e deve
    // morrer com a aba.
    function stashDraft() {
      if (!document.getElementById('overlay').classList.contains('open')) return false;
      if (!isFormDirty()) return false; // nada alterado, nada a recuperar
      try {
        sessionStorage.setItem(DRAFT_KEY, JSON.stringify({
          editingId, at: Date.now(), form: snapshotForm(),
        }));
        return true;
      } catch (_) { return false; }
    }

    function restoreDraft() {
      let raw = null;
      try {
        raw = sessionStorage.getItem(DRAFT_KEY);
        sessionStorage.removeItem(DRAFT_KEY); // só uma tentativa: se falhar, não fica insistindo
      } catch (_) { return; }
      if (!raw) return;

      let d;
      try { d = JSON.parse(raw); } catch (_) { return; }
      if (!d || !d.form || Date.now() - d.at > DRAFT_MAX_AGE_MS) return;
      // O evento pode ter sido apagado enquanto a sessão estava expirada.
      if (d.editingId && !events.some(e => e.id === d.editingId)) return;

      let f;
      try { f = JSON.parse(d.form); } catch (_) { return; }

      openForm(d.editingId || undefined);
      const set = (id, v) => { const el = document.getElementById(id); if (el) el.value = v ?? ''; };
      const setChk = (id, v) => { const el = document.getElementById(id); if (el) el.checked = !!v; };
      set('f-title', f.title); set('f-long', f.long); set('f-drive', f.drive);
      set('f-drive-ig', f.driveIg); set('f-drive-videos', f.driveVideos); set('f-youtube', f.youtube); set('f-youtube-mais', f.youtubeMais); set('f-date', f.date); set('f-credits', f.credits);
      set('f-purl', f.purl); set('f-promised', f.promised); set('f-status', f.status); set('f-access', f.accessType);
      set('f-category', f.category); set('f-notes', f.notes); set('f-alert-expires', f.alertExpires);
      set('f-alert-kind', f.alertKind || 'fotos');
      setChk('f-visible', f.visible); setChk('f-comingsoon', f.comingSoon);
      setChk('f-alert-active', f.alertActive);
      toggleAlertOpts(!!f.alertActive);
      if (Array.isArray(f.photos)) { photoList = [...f.photos]; renderPhotoList(); }
      atualizaResumos();
      // NÃO atualiza formSnapshot: o rascunho é justamente "alterações não
      // salvas", e fechar sem salvar tem que continuar pedindo confirmação.
      toast('Sua sessão tinha expirado. Recuperei o que você estava editando.', 'ok');
    }

    // skipCheck=true is used right after a successful save, where there's
    // nothing left to discard.
    async function closeForm(skipCheck) {
      if (!skipCheck && isFormDirty()) {
        const ok = await confirmDialog({
          title: 'Descartar alterações?',
          message: 'Você tem alterações não salvas neste evento.',
          confirmLabel: 'Descartar',
          danger: true,
        });
        if (!ok) return;
      }
      document.getElementById('overlay').classList.remove('open');
      document.body.style.overflow = '';
      editingId = null;
      if (lastFocused && typeof lastFocused.focus === 'function') {
        try { lastFocused.focus(); } catch (e) {}
      }
      lastFocused = null;
    }

    window.addEventListener('beforeunload', function(e) {
      if (isFormDirty()) { e.preventDefault(); e.returnValue = ''; }
    });

    // ---- Form keyboard handling (Esc close, Ctrl/Cmd+Enter submit, focus trap) ----
    document.getElementById('overlay').addEventListener('keydown', function(e) {
      if (e.key === 'Escape') { e.preventDefault(); closeForm(); return; }
      if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') { e.preventDefault(); submitForm(); return; }
      if (e.key === 'Tab') {
        const sheet = document.getElementById('sheet');
        const focusable = sheet.querySelectorAll('a[href],button:not([disabled]),summary,input:not([disabled]),select:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex="-1"])');
        const items = Array.prototype.filter.call(focusable, el => el.offsetParent !== null || el === document.activeElement);
        if (!items.length) return;
        const first = items[0];
        const last = items[items.length - 1];
        if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
        else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
      }
    });

    function toggleAlertOpts(on) {
      document.getElementById('alert-opts').style.display = on ? 'block' : 'none';
    }

    // ---- Blocos do formulário (#220) ----
    // Atalho: abre o bloco (se estiver recolhido) e rola até ele.
    function irParaBloco(id) {
      const b = document.getElementById(id);
      if (!b) return;
      b.open = true;
      b.scrollIntoView({ block: 'start', behavior: 'smooth' });
      const s = b.querySelector('summary');
      if (s) s.focus({ preventScroll: true });
    }
    // Erro de validação num campo que está num bloco recolhido: abre o bloco
    // e põe o foco no campo — senão o aviso fala de algo que não está à vista.
    function mostraCampo(id) {
      const el = document.getElementById(id);
      if (!el) return;
      const b = el.closest('details');
      if (b) b.open = true;
      el.focus();
    }
    // Resumo de cada bloco, visível quando ele está recolhido: o dono vê o
    // essencial (acesso, status, vídeos) sem abrir nada.
    function atualizaResumos() {
      const val = id => (document.getElementById(id)?.value || '').trim();
      const chk = id => !!document.getElementById(id)?.checked;
      const ddmm = iso => /^\\d{4}-\\d{2}-\\d{2}$/.test(iso) ? iso.slice(8, 10) + '/' + iso.slice(5, 7) : '';
      const nVideos = (val('f-youtube') ? 1 : 0) + val('f-youtube-mais').split('\\n').filter(l => l.trim()).length;
      const acesso = { public: 'Público', private: 'Privado', family: 'Familiar' }[val('f-access')] || '';
      const capas = photoList.filter(u => (u || '').trim()).length;
      const resumos = {
        'bf-basico': val('f-slug') ? '/' + val('f-slug') : '',
        'bf-fotos': (val('f-drive') ? 'pasta ligada' : 'falta a pasta do Drive') + ' · ' + capas + (capas === 1 ? ' capa' : ' capas'),
        'bf-video': nVideos ? nVideos + (nVideos === 1 ? ' vídeo' : ' vídeos') : 'nenhum',
        'bf-acesso': acesso + (chk('f-visible') ? '' : ' · oculto') + (chk('f-comingsoon') ? ' · em breve' : ''),
        'bf-producao': (STATUS_LABELS[val('f-status')] || '') + (ddmm(val('f-promised')) ? ' · prazo ' + ddmm(val('f-promised')) : ''),
        'bf-pagina': chk('f-alert-active') ? 'aviso de novidade ligado' : '',
      };
      document.querySelectorAll('[data-resumo]').forEach(el => { el.textContent = resumos[el.dataset.resumo] || ''; });
    }
    document.getElementById('sheet').addEventListener('input', atualizaResumos);
    document.getElementById('sheet').addEventListener('change', atualizaResumos);

    // ---- Photo list ----
    function renderPhotoList() {
      const container = document.getElementById('photo-list');
      const addBtn = document.getElementById('btn-add-photo');
      const pasteBtn = document.getElementById('btn-paste-photos');
      if (photoList.length === 0) {
        container.innerHTML = '';
      } else {
        container.innerHTML = photoList.map((url, i) => \`
          <div class="photo-row" id="pr-\${i}">
            <div class="photo-row-inner">
              <span class="photo-num">\${i + 1}</span>
              <input type="url" value="\${esc(url)}" placeholder="URL da foto"
                data-photo-input data-i="\${i}">
              \${i === 0 ? '' : \`<img class="photo-mini" id="pm-\${i}" src="\${esc(url)}" \${url ? 'style="display:block"' : ''} data-onerror="hide" data-onload="show">\`}
              <button type="button" class="icon-btn danger" data-action="removePhoto" data-i="\${i}" title="Remover" aria-label="Remover foto">
                <svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
              </button>
            </div>
            \${i === 0 ? '<span class="photo-badge">capa da galeria</span>' : ''}
            \${i === 0 ? \`<img class="photo-cover-preview" id="pcover" src="\${esc(url)}" \${url ? 'style="display:block"' : ''} alt="" data-onerror="hide" data-onload="show">\` : ''}
          </div>\`).join('');
      }
      if (addBtn) addBtn.style.display = photoList.length >= 6 ? 'none' : 'inline-flex';
      if (pasteBtn) pasteBtn.style.display = photoList.length >= 6 ? 'none' : '';
    }

    function addPhotoInput(url) {
      if (photoList.length >= 6) return;
      photoList.push(url || '');
      renderPhotoList();
      setTimeout(() => {
        const inputs = document.querySelectorAll('.photo-row-inner input');
        if (inputs.length) inputs[inputs.length - 1].focus();
      }, 50);
    }

    function removePhotoInput(i) {
      photoList.splice(i, 1);
      renderPhotoList();
    }

    // ---- Bulk photo paste (one link per line) ----
    function openPastePhotos() {
      document.getElementById('paste-photos-box').style.display = '';
      document.getElementById('paste-photos-input').focus();
    }
    function closePastePhotos() {
      document.getElementById('paste-photos-box').style.display = 'none';
      document.getElementById('paste-photos-input').value = '';
    }
    function commitPastePhotos() {
      const raw = document.getElementById('paste-photos-input').value;
      const lines = raw.split('\\n').map(l => l.trim()).filter(Boolean);
      if (!lines.length) { closePastePhotos(); return; }
      const room = 6 - photoList.length;
      if (room <= 0) { toast('Limite de 6 fotos atingido.', 'err'); return; }
      photoList.push(...lines.slice(0, room));
      renderPhotoList();
      closePastePhotos();
      if (lines.length > room) toast('Só ' + room + ' vaga(s) — o restante foi ignorado.', 'err');
      else toast(lines.slice(0, room).length + ' foto(s) adicionada(s).', 'ok');
    }

    function onPhotoInput(i, el) {
      photoList[i] = el.value;
      if (i === 0) updateCoverPreview(el.value);
    }

    function onPhotoBlur(i, el) {
      const converted = convertDriveUrl(el.value.trim());
      photoList[i] = converted;
      el.value = converted;
      if (i === 0) { updateCoverPreview(converted); return; }
      const mini = document.getElementById('pm-' + i);
      if (mini) { mini.src = converted; mini.style.display = converted ? 'block' : 'none'; }
    }

    function updateCoverPreview(url) {
      const cover = document.getElementById('pcover');
      if (!cover) return;
      const src = convertDriveUrl((url || '').trim());
      if (src) { cover.src = src; cover.style.display = 'block'; }
      else { cover.removeAttribute('src'); cover.style.display = 'none'; }
    }

    function collectPhotos() {
      return photoList.map(u => convertDriveUrl(u.trim())).filter(Boolean);
    }

    function convertDriveUrl(url) {
      if (!url) return '';
      const fileM = url.match(/drive\\.google\\.com\\/file\\/d\\/([\\w-]+)/);
      if (fileM) return 'https://lh3.googleusercontent.com/d/' + fileM[1];
      const openM = url.match(/drive\\.google\\.com\\/open\\?id=([\\w-]+)/);
      if (openM) return 'https://lh3.googleusercontent.com/d/' + openM[1];
      const ucM = url.match(/drive\\.google\\.com\\/uc\\?.*id=([\\w-]+)/);
      if (ucM) return 'https://lh3.googleusercontent.com/d/' + ucM[1];
      return url;
    }

    // ---- Submit form ----
    async function submitForm() {
      const slug = document.getElementById('f-slug').value.trim().toLowerCase();
      const title = document.getElementById('f-title').value.trim();
      const drive = document.getElementById('f-drive').value.trim();

      if (!slug || !/^[a-z0-9][a-z0-9\\-]*$/.test(slug)) {
        mostraCampo('f-slug');
        return toast('URL inválida. Use só letras minúsculas, números e hífens.', 'err');
      }
      if (!title) { mostraCampo('f-title'); return toast('O título é obrigatório.', 'err'); }
      if (!drive) { mostraCampo('f-drive'); return toast('O link do Google Drive é obrigatório.', 'err'); }

      if (!editingId) {
        const conflict = events.find(e => e.slug === slug);
        if (conflict) { mostraCampo('f-slug'); return toast('Já existe um evento com essa URL.', 'err'); }
      }

      const photos = collectPhotos();
      const body = {
        slug,
        title,
        longDescription: document.getElementById('f-long').value.trim(),
        photos,
        thumbnailUrl: photos[0] || '',
        driveUrl: drive,
        driveUrlInstagram: document.getElementById('f-drive-ig').value.trim(),
        driveUrlVideos: document.getElementById('f-drive-videos').value.trim(),
        youtubeId: document.getElementById('f-youtube').value.trim(),
        youtubeMais: document.getElementById('f-youtube-mais').value.split('\\n').map(s => s.trim()).filter(Boolean),
        date: document.getElementById('f-date').value,
        eventCredits: document.getElementById('f-credits').value.trim(),
        projectUrl: document.getElementById('f-purl').value.trim(),
        promisedDate: document.getElementById('f-promised').value,
        visible: document.getElementById('f-visible').checked,
        comingSoon: document.getElementById('f-comingsoon').checked,
        status: document.getElementById('f-status').value,
        accessType: document.getElementById('f-access').value,
        category: document.getElementById('f-category').value,
        internalNotes: document.getElementById('f-notes').value,
        photosAlert: (() => {
          const nowActive = document.getElementById('f-alert-active').checked;
          const wasActive = document.getElementById('f-alert-active').dataset.wasActive === '1';
          const existingAddedAt = editingId ? events.find(ev => ev.id === editingId)?.photosAlert?.addedAt : null;
          return {
            active: nowActive,
            addedAt: nowActive ? (wasActive && existingAddedAt ? existingAddedAt : new Date().toISOString()) : null,
            expiresAfterHours: parseInt(document.getElementById('f-alert-expires').value) || 0,
            kind: document.getElementById('f-alert-kind').value === 'videos' ? 'videos' : 'fotos',
          };
        })(),
      };

      const btn = document.getElementById('submit-btn');
      btn.disabled = true;
      btn.innerHTML = '<span class="spinner" aria-hidden="true"></span>Salvando…';

      let saved = null;
      try {
        if (editingId) {
          saved = await api('PUT', '/api/events/' + editingId, body);
          events = events.map(e => e.id === editingId ? saved : e);
          toast('Evento atualizado!', 'ok');
        } else {
          saved = await api('POST', '/api/events', body);
          events.push(saved);
          toast('Evento adicionado!', 'ok');
        }
        renderEventList();
        closeForm(true);
        // O servidor guarda só o ID do vídeo; link que não é do YouTube vira
        // vazio. Salvar em silêncio sem o vídeo deixaria o dono achando que ele
        // está na página.
        if (body.youtubeId && saved && !saved.youtubeId) {
          toast('Salvo, mas o link do YouTube não foi reconhecido — o vídeo não vai aparecer. Confira o link.', 'err');
        } else if (saved && Array.isArray(body.youtubeMais) && (saved.youtubeMais || []).length < Math.min(body.youtubeMais.length, 5)) {
          toast('Salvo, mas algum link em "Mais vídeos" não foi reconhecido (ou repetiu). Confira a lista.', 'err');
        }
      } catch(err) {
        toast(err.message || 'Erro ao salvar.', 'err');
      } finally {
        btn.disabled = false;
        btn.textContent = 'Salvar';
      }
    }

    // ---- Themed confirm dialog ----
    // opts.typeToConfirm: when set, the OK button starts disabled and only
    // enables once the visitor types this exact string (trimmed, case-insensitive)
    // into an inline input — used for delete/restore/mass-apply actions where a
    // plain Confirm/Cancel isn't enough friction.
    function confirmDialog(opts) {
      opts = opts || {};
      const title = opts.title || 'Confirmar';
      const message = opts.message || '';
      const confirmLabel = opts.confirmLabel || 'Confirmar';
      const danger = !!opts.danger;
      const typeToConfirm = opts.typeToConfirm || '';
      return new Promise(function(resolve) {
        const prev = document.activeElement;
        const overlay = document.createElement('div');
        overlay.className = 'overlay open';
        overlay.style.alignItems = 'center';
        overlay.innerHTML =
          '<div class="confirm-sheet" role="dialog" aria-modal="true" aria-labelledby="confirm-title">' +
            '<div class="confirm-body">' +
              '<h3 id="confirm-title">' + esc(title) + '</h3>' +
              (message ? '<p>' + esc(message) + '</p>' : '') +
              (typeToConfirm
                ? '<label class="confirm-type-label">Digite <strong>' + esc(typeToConfirm) + '</strong> para confirmar:' +
                  '<input type="text" class="confirm-type-input" autocomplete="off"></label>'
                : '') +
            '</div>' +
            '<div class="confirm-foot">' +
              '<button type="button" class="confirm-cancel">Cancelar</button>' +
              '<button type="button" class="confirm-ok' + (danger ? ' danger' : '') + '"' + (typeToConfirm ? ' disabled' : '') + '>' + esc(confirmLabel) + '</button>' +
            '</div>' +
          '</div>';
        document.body.appendChild(overlay);
        const okBtn = overlay.querySelector('.confirm-ok');
        const cancelBtn = overlay.querySelector('.confirm-cancel');
        const typeInput = overlay.querySelector('.confirm-type-input');
        function done(val) {
          document.removeEventListener('keydown', onKey, true);
          overlay.remove();
          if (prev && typeof prev.focus === 'function') { try { prev.focus(); } catch (e) {} }
          resolve(val);
        }
        if (typeInput) {
          typeInput.addEventListener('input', () => {
            okBtn.disabled = typeInput.value.trim().toLowerCase() !== typeToConfirm.trim().toLowerCase();
          });
        }
        function onKey(e) {
          if (e.key === 'Escape') { e.preventDefault(); done(false); }
          else if (e.key === 'Tab') {
            const f = typeInput ? [typeInput, cancelBtn, okBtn] : [cancelBtn, okBtn];
            const idx = f.indexOf(document.activeElement);
            e.preventDefault();
            const next = e.shiftKey ? (idx <= 0 ? f.length - 1 : idx - 1) : (idx === f.length - 1 ? 0 : idx + 1);
            f[next].focus();
          } else if (e.key === 'Enter' && !okBtn.disabled) { e.preventDefault(); done(true); }
        }
        okBtn.addEventListener('click', () => done(true));
        cancelBtn.addEventListener('click', () => done(false));
        overlay.addEventListener('click', (e) => { if (e.target === overlay) done(false); });
        document.addEventListener('keydown', onKey, true);
        setTimeout(() => (typeInput || okBtn).focus(), 30);
      });
    }

    // ---- Row action helpers ----
    function setRowBusy(id, busy) {
      const row = document.getElementById('evt-' + id);
      if (!row) return;
      row.querySelectorAll('.evt-actions button').forEach(b => { b.disabled = busy; });
    }

    // ---- Duplicate ----
    // Pre-fills the "add event" form from an existing event; slug is cleared
    // (must be unique) and pinned resets — a clone shouldn't inherit that silently.
    function duplicateEvent(id) {
      const e = events.find(ev => ev.id === id);
      if (!e) return;
      openForm(null, { ...e, title: e.title + ' (cópia)', slug: '', pinned: false, promisedDate: '' });
    }

    // ---- Delete ----
    async function deleteEvent(id) {
      const e = events.find(ev => ev.id === id);
      if (!e) return;
      const ok = await confirmDialog({
        title: 'Excluir evento',
        message: \`Excluir "\${e.title}"? Essa ação não pode ser desfeita.\`,
        confirmLabel: 'Excluir',
        danger: true,
        typeToConfirm: e.title,
      });
      if (!ok) return;
      setRowBusy(id, true);
      try {
        await api('DELETE', '/api/events/' + id);
        events = events.filter(ev => ev.id !== id);
        renderEventList();
        toast('Evento excluído.', 'ok');
      } catch(err) {
        setRowBusy(id, false);
        toast(err.message || 'Erro ao excluir.', 'err');
      }
    }

    // ---- Toggle visible ----
    async function toggleVisible(id) {
      const e = events.find(ev => ev.id === id);
      if (!e) return;
      const updated = { ...e, visible: e.visible === false ? true : false };
      setRowBusy(id, true);
      try {
        const result = await api('PUT', '/api/events/' + id, updated);
        events = events.map(ev => ev.id === id ? result : ev);
        renderEventList();
        toast(result.visible !== false ? 'Evento visível.' : 'Evento oculto.', 'ok');
      } catch(err) {
        toast(err.message || 'Erro.', 'err');
      } finally {
        setRowBusy(id, false);
      }
    }

    // ---- Requests ----
    async function loadRequests() {
      const container = document.getElementById('requests-body');
      try {
        const data = await api('GET', '/api/removal-requests');
        requestsLoaded = true;
        const pending = data.filter(r => !r.resolved).length;
        const badge = document.getElementById('requests-badge');
        if (badge) { badge.textContent = pending > 0 ? String(pending) : ''; badge.hidden = !(pending > 0); }
        if (!data.length) { container.innerHTML = '<div class="bloco"><p class="empty">Nenhum pedido de remoção ainda.</p></div>'; return; }

        const methodLabel = { number: 'Número da foto', url: 'Link da foto', upload: 'Arquivo enviado' };

        // esc() no id como em todo o resto do arquivo. Hoje ele é hexadecimal
        // (generateId, e sanitizeRestoredRequest recusa o que não casar com
        // /^[a-f0-9]{1,64}$/), mas era a última interpolação de DADO sem escape
        // aqui — e a de baixo cai dentro de uma string JS dentro de um atributo
        // HTML, o pior contexto para depender de validação feita noutro arquivo.
        const renderReq = r => \`
          <div class="req-item \${r.resolved ? 'resolved' : ''}" id="req-\${esc(r.id)}">
            <div class="req-header">
              <span class="req-badge \${r.resolved ? '' : 'pending'}">\${r.resolved ? 'resolvido' : 'pendente'}</span>
              <span class="req-date">\${r.createdAt ? new Date(r.createdAt).toLocaleDateString('pt-BR') : '—'}</span>
            </div>
            <div class="req-body">
              <span><strong>Tipo:</strong> \${esc(methodLabel[r.method] || r.method)}</span>
              \${r.value ? \`<span><strong>Identificação:</strong> \${esc(r.value)}</span>\` : ''}
              \${r.method === 'upload' ? \`<span><strong>Arquivo:</strong> \${esc(r.fileName || '—')} (por e-mail)</span>\` : ''}
              \${r.email ? \`<span><strong>E-mail:</strong> \${esc(r.email)}</span>\` : ''}
              \${r.phone ? \`<span><strong>Telefone:</strong> \${esc(r.phone)}</span>\` : ''}
              \${!r.email && !r.phone && r.contact ? \`<span><strong>Contato:</strong> \${esc(r.contact)}</span>\` : ''}
              \${r.message ? \`<span><strong>Mensagem:</strong> \${esc(r.message)}</span>\` : ''}
              \${r.emailStatus ? \`<span style="font-size:.7rem;margin-top:.25rem;color:\${r.emailStatus === 'sent' ? '#4a9a4a' : '#b04040'}">📧 \${r.emailStatus === 'sent' ? 'aviso enviado ao seu e-mail' : esc(r.emailStatus)}</span>\` : ''}
              \${r.confirmEmailStatus === 'sent' ? '<span style="font-size:.7rem;color:#4a9a4a">✉️ confirmação enviada</span>' : r.confirmEmailStatus ? \`<span style="font-size:.7rem;color:#b04040">✉️ \${esc(r.confirmEmailStatus)}</span>\` : ''}
              \${r.resolvedEmailStatus === 'sent' ? '<span style="font-size:.7rem;color:#4a9a4a">✅ aviso de resolução enviado</span>' : r.resolvedEmailStatus ? \`<span style="font-size:.7rem;color:#b04040">✅ \${esc(r.resolvedEmailStatus)}</span>\` : ''}
            </div>
            \${!r.resolved ? \`<button class="btn-resolve" data-action="resolveRequest" data-id="\${esc(r.id)}">✓ Marcar como resolvido</button>\` : ''}
          </div>\`;

        // Group by project, sorted by most recent first within each group.
        // String(... || '') espelha porCriacaoDesc() no servidor: um registro
        // restaurado de backup pode não ter createdAt, e o .localeCompare direto
        // que estava aqui derrubava a aba inteira ("Erro ao carregar") por causa
        // de um registro só.
        const byProject = {};
        const projectOrder = [];
        [...data].sort((a, b) => String(b.createdAt || '').localeCompare(String(a.createdAt || ''))).forEach(r => {
          if (!byProject[r.eventSlug]) {
            byProject[r.eventSlug] = { title: r.eventTitle, slug: r.eventSlug, pending: [], resolved: [] };
            projectOrder.push(r.eventSlug);
          }
          (r.resolved ? byProject[r.eventSlug].resolved : byProject[r.eventSlug].pending).push(r);
        });

        container.innerHTML = projectOrder.map((slug, gi) => {
          const g = byProject[slug];
          const resolvedHTML = g.resolved.length > 0 ? \`
            <button class="req-resolved-toggle" data-action="toggleResolved" data-gi="\${gi}" id="rtoggle-\${gi}">▶ \${g.resolved.length} resolvida\${g.resolved.length !== 1 ? 's' : ''}</button>
            <div id="ritems-\${gi}" style="display:none">\${g.resolved.map(renderReq).join('')}</div>\` : '';
          return \`<div class="req-group bloco">
            <div class="req-group-head">
              <span class="req-group-title">\${esc(g.title)}</span>
              <span class="req-group-slug">/\${esc(g.slug)}</span>
              \${g.pending.length > 0 ? \`<span class="req-pending-badge">\${g.pending.length} pendente\${g.pending.length !== 1 ? 's' : ''}</span>\` : ''}
            </div>
            \${g.pending.map(renderReq).join('')}
            \${resolvedHTML}
          </div>\`;
        }).join('');
      } catch(err) {
        container.innerHTML = '<p class="empty">Erro ao carregar solicitações.</p>';
      }
    }

    function toggleResolved(gi) {
      const items = document.getElementById('ritems-' + gi);
      const toggle = document.getElementById('rtoggle-' + gi);
      if (!items || !toggle) return;
      const open = items.style.display !== 'none';
      items.style.display = open ? 'none' : 'block';
      const txt = toggle.textContent.replace(/^[▶▼] /, '');
      toggle.textContent = (open ? '▶' : '▼') + ' ' + txt;
    }

    async function resolveRequest(id, btn) {
      // Desabilitado enquanto a requisição corre: um duplo clique mandava dois
      // PUT simultâneos, os dois liam o pedido ainda em aberto e a pessoa
      // recebia dois e-mails de "Solicitação atendida". A guarda do servidor
      // pega a repetição em sequência; a simultânea só se evita aqui.
      if (btn) btn.disabled = true;
      try {
        await api('PUT', '/api/removal-requests/' + id + '/resolve');
        await loadRequests();
        toast('Solicitação marcada como resolvida.', 'ok');
      } catch(err) {
        toast(err.message || 'Erro.', 'err');
        if (btn) btn.disabled = false;
      }
    }

    // ---- Métricas ----
    // Duas leituras em paralelo, cada uma com o seu erro: o total desde
    // sempre (/api/metrics, como antes) e a série por dia (/api/metrics/diario,
    // v2). Uma falhar não apaga a outra da tela.
    //
    // Por que não atualiza sozinho de minuto em minuto: cada leitura passa
    // pela sessão, e uma sessão que se renova sozinha nunca cai por
    // inatividade — o painel aberto e esquecido num computador ficaria logado
    // para sempre. O botão "Atualizar" faz a mesma leitura quando o dono quer.
    async function loadMetrics(btn) {
      const body = document.getElementById('metrics-body');
      const exportBtn = document.getElementById('metrics-export');
      if (btn) btn.disabled = true;
      const lido = p => p.then(d => ({ ok: true, d: d }), () => ({ ok: false, d: null }));
      const [totais, serie] = await Promise.all([
        lido(api('GET', '/api/metrics')),
        lido(api('GET', '/api/metrics/diario?dias=180')),
      ]);
      if (btn) btn.disabled = false;
      if (totais.ok) {
        metricsLoaded = true;
        metricsData = Array.isArray(totais.d) ? totais.d : [];
        if (exportBtn) exportBtn.style.display = metricsData.length ? 'inline-flex' : 'none';
        if (!metricsData.length) body.innerHTML = '<p class="empty">Nenhuma visualização ainda.</p>';
        else renderMetrics();
      } else {
        if (exportBtn) exportBtn.style.display = 'none';
        body.innerHTML = '<p class="empty">Erro ao carregar métricas.</p>';
      }
      serieDiaria = serie.ok && serie.d && Array.isArray(serie.d.dias) ? serie.d : null;
      const quando = document.getElementById('metrics-atualizado');
      if (quando) quando.textContent = totais.ok || serie.ok ? 'atualizado às ' + new Date().toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' }) : '';
      renderOpcoesProjeto();
      renderMetricas();
    }

    function renderOpcoesProjeto() {
      const sel = document.getElementById('metrics-projeto');
      if (!sel) return;
      const lista = [...events].sort((a, b) => String(a.title || a.slug).localeCompare(String(b.title || b.slug), 'pt-BR'));
      if (metricsProjeto && !lista.some(e => e.slug === metricsProjeto)) metricsProjeto = '';
      sel.innerHTML = '<option value="">Todos os projetos</option>'
        + lista.map(e => '<option value="' + esc(e.slug) + '">' + esc(e.title || e.slug) + '</option>').join('');
      sel.value = metricsProjeto;
    }

    function tituloDoProjeto(slug) {
      const e = events.find(x => x.slug === slug);
      return e && e.title ? e.title : slug;
    }

    function fmtN(n) { return Math.round(n || 0).toLocaleString('pt-BR'); }

    // Tudo o que depende do filtro, de uma vez.
    function renderMetricas() {
      document.querySelectorAll('#metrics-periodo .chip').forEach(b => b.setAttribute('aria-pressed', String(Number(b.dataset.dias) === metricsPeriodo)));
      document.querySelectorAll('#metrics-ordem .chip').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.ordem === metricsOrdem)));
      recorteAtual = serieDiaria ? recorteMetricas(serieDiaria, metricsPeriodo, metricsProjeto) : null;
      renderResumoMetricas();
      renderGraficoAcessos();
      renderSemana();
      renderPortao();
      renderRanking();
    }

    function escolhePeriodo(el) {
      const n = Number(el.dataset.dias);
      if (![7, 30, 90].includes(n)) return;
      metricsPeriodo = n;
      try { sessionStorage.setItem('painel:periodo', String(n)); } catch (e) {}
      renderMetricas();
    }
    function escolheProjeto(el) {
      metricsProjeto = el.value || '';
      renderMetricas();
    }
    // Tocar num projeto da lista foca os gráficos nele; tocar de novo volta a
    // todos. Leva a tela até o gráfico, que é o que mudou.
    function focaProjeto(slug) {
      metricsProjeto = metricsProjeto === slug ? '' : slug;
      const sel = document.getElementById('metrics-projeto');
      if (sel) sel.value = metricsProjeto;
      renderMetricas();
      const bloco = document.getElementById('bloco-acessos');
      const calmo = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
      if (bloco && metricsProjeto) bloco.scrollIntoView({ behavior: calmo ? 'auto' : 'smooth', block: 'start' });
    }
    function ordenaRanking(el) {
      if (!['views', 'driveClicks', 'taxa'].includes(el.dataset.ordem)) return;
      metricsOrdem = el.dataset.ordem;
      renderMetricas();
    }
    function alternaTabelaAcessos() {
      tabelaAcessosAberta = !tabelaAcessosAberta;
      renderTabelaAcessos();
    }

    // Os números do topo: o período escolhido, comparado com o período
    // anterior de mesmo tamanho. Sem série por dia ainda (logo depois da
    // atualização), mostra os totais desde o início, como antes.
    function renderResumoMetricas() {
      const el = document.getElementById('metrics-resumo');
      if (!el) return;
      const card = (num, lab, det) => '<div class="resumo-card"><div class="resumo-num">' + num + '</div><div class="resumo-lab">' + lab + '</div>' + (det ? '<div class="resumo-delta">' + det + '</div>' : '') + '</div>';
      const r = recorteAtual;
      if (!r || !serieDiaria.primeiroDia) {
        if (!metricsData.length) { el.hidden = true; return; }
        const totV = metricsData.reduce((t, m) => t + (m.views || 0), 0);
        const totD = metricsData.reduce((t, m) => t + (m.driveClicks || 0), 0);
        el.innerHTML = card(fmtN(totV), 'Visitas', 'desde o início')
          + card(fmtN(totD), 'Abriram o Drive', 'desde o início')
          + card(totV ? Math.round(totD / totV * 100) + '%' : '—', 'Taxa de abertura', 'desde o início');
        el.hidden = false;
        return;
      }
      const periodo = 'nos últimos ' + metricsPeriodo + ' dias';
      const taxa = r.totV ? Math.round(r.totD / r.totV * 100) : null;
      const taxaAnt = r.antV ? Math.round(r.antD / r.antV * 100) : null;
      const dV = r.temAnterior ? htmlVariacao(variacao(r.totV, r.antV), '%') : '';
      const dD = r.temAnterior ? htmlVariacao(variacao(r.totD, r.antD), '%') : '';
      const dT = r.temAnterior && taxa !== null && taxaAnt !== null ? htmlVariacao({ dir: Math.sign(taxa - taxaAnt), valor: Math.abs(taxa - taxaAnt) }, ' p.p.') : '';
      const hojeV = r.views[r.views.length - 1] || 0;
      const hojeD = r.drive[r.drive.length - 1] || 0;
      el.innerHTML = card(fmtN(r.totV), 'Visitas', dV || periodo)
        + card(fmtN(r.totD), 'Abriram o Drive', dD || periodo)
        + card(taxa === null ? '—' : taxa + '%', 'Taxa de abertura', dT || 'abriram o Drive ÷ visitas')
        + card(fmtN(hojeV), 'Hoje', fmtN(hojeD) + ' abriram o Drive');
      el.hidden = false;
    }

    function htmlVariacao(v, unidade) {
      if (!v) return '';
      const base = ' vs. ' + metricsPeriodo + ' dias antes';
      if (!v.dir) return 'igual' + base;
      return '<span aria-hidden="true">' + (v.dir > 0 ? '▲' : '▼') + '</span><span class="sr-only">' + (v.dir > 0 ? 'alta de' : 'queda de') + '</span> '
        + v.valor.toLocaleString('pt-BR') + unidade + base;
    }

    function renderGraficoAcessos() {
      const box = document.getElementById('grafico-acessos');
      if (!box) return;
      const desc = document.getElementById('acessos-desc');
      const leg = document.getElementById('acessos-legenda');
      const nota = document.getElementById('acessos-nota');
      escondeCruz();
      box.querySelectorAll('svg, .grafico-vazio').forEach(n => n.remove());
      geoAcessos = null;
      const vazio = texto => { leg.innerHTML = ''; nota.textContent = ''; box.insertAdjacentHTML('afterbegin', '<div class="grafico-vazio">' + texto + '</div>'); };
      const r = recorteAtual;
      const quem = metricsProjeto ? tituloDoProjeto(metricsProjeto) : 'todos os projetos';
      if (!serieDiaria) {
        desc.textContent = 'Não deu para carregar a contagem por dia.';
        vazio('Não deu para carregar a contagem por dia. Toque em “Atualizar” para tentar de novo.');
      } else if (!serieDiaria.primeiroDia) {
        desc.textContent = 'Visitas e aberturas do Drive por dia — ' + quem + '.';
        vazio('A contagem por dia começa com a versão 2.0 e ainda não há nenhum dia contado. A próxima visita já aparece aqui; os totais desde o início estão no fim da página.');
      } else {
        const largura = Math.max(240, Math.round(box.clientWidth || 0));
        const res = svgLinhas({
          largura: largura,
          altura: largura < 560 ? 220 : 260,
          dias: r.dias,
          rotulosFim: largura >= 560,
          series: [
            { nome: 'Visitas', curto: 'Visitas', cor: COR_VISITAS, valores: r.views },
            { nome: 'Abriram o Drive', curto: 'Drive', cor: COR_DRIVE, valores: r.drive },
          ],
        });
        box.insertAdjacentHTML('afterbegin', res.svg);
        geoAcessos = res.geo;
        const item = (cor, nome, total) => '<span><i style="background:' + cor + '"></i>' + nome + ' <b>' + fmtN(total) + '</b></span>';
        leg.innerHTML = item(COR_VISITAS, 'Visitas', r.totV) + item(COR_DRIVE, 'Abriram o Drive', r.totD);
        const pico = indicePico(r.views);
        desc.textContent = 'Últimos ' + metricsPeriodo + ' dias, ' + quem + '.'
          + (pico >= 0 ? ' Pico: ' + fmtN(r.views[pico]) + ' visitas em ' + diaLongo(r.dias[pico]) + '.' : '');
        nota.textContent = serieDiaria.primeiroDia > r.dias[0]
          ? 'A contagem por dia começou em ' + diaLongo(serieDiaria.primeiroDia) + ' (versão 2.0). Antes disso a linha fica em branco: não é zero, é que não havia contagem por dia. Os totais desde o início estão no fim da página.'
          : '';
      }
      box.setAttribute('aria-label', 'Gráfico de linhas. ' + desc.textContent + (geoAcessos ? ' Use as setas para percorrer os dias, ou abra a tabela.' : ''));
      renderTabelaAcessos();
    }

    function renderTabelaAcessos() {
      const t = document.getElementById('acessos-tabela');
      const btn = document.getElementById('acessos-ver-tabela');
      if (!t) return;
      t.hidden = !tabelaAcessosAberta;
      if (btn) {
        btn.setAttribute('aria-expanded', String(tabelaAcessosAberta));
        btn.textContent = tabelaAcessosAberta ? 'Ocultar tabela' : 'Ver como tabela';
      }
      if (!tabelaAcessosAberta) return;
      const r = recorteAtual;
      if (!r || !serieDiaria.primeiroDia) { t.innerHTML = '<p class="empty">Ainda não há contagem por dia.</p>'; return; }
      let linhas = '';
      for (let i = r.dias.length - 1; i >= 0; i--) {
        const sem = r.views[i] === null;
        linhas += '<tr><td>' + diaLongo(r.dias[i]) + '</td><td>' + (sem ? '—' : fmtN(r.views[i])) + '</td><td>' + (sem ? '—' : fmtN(r.drive[i])) + '</td></tr>';
      }
      t.innerHTML = '<table class="metrics-table"><caption class="sr-only">Acessos por dia, do mais recente ao mais antigo</caption>'
        + '<thead><tr><th scope="col">Dia</th><th scope="col">Visitas</th><th scope="col">Abriram o Drive</th></tr></thead><tbody>' + linhas + '</tbody></table>';
    }

    // ---- A cruz do gráfico: ponteiro, toque e teclado ----
    function escondeCruz() {
      const box = document.getElementById('grafico-acessos');
      const dica = document.getElementById('dica-acessos');
      if (dica) dica.hidden = true;
      const cruz = box && box.querySelector('.cruz');
      if (cruz) cruz.setAttribute('visibility', 'hidden');
    }
    function mostraCruz(i, anunciar) {
      const box = document.getElementById('grafico-acessos');
      const r = recorteAtual, g = geoAcessos;
      const svg = box && box.querySelector('svg');
      if (!r || !g || !svg) return;
      let ini = 0;
      while (ini < g.n - 1 && r.views[ini] === null) ini++;
      i = Math.max(ini, Math.min(g.n - 1, i));
      cruzIdx = i;
      const x = geoX(g, i);
      const cruz = svg.querySelector('.cruz');
      cruz.setAttribute('visibility', 'visible');
      const linha = cruz.querySelector('line');
      linha.setAttribute('x1', String(x));
      linha.setAttribute('x2', String(x));
      const pontos = cruz.querySelectorAll('circle');
      [r.views, r.drive].forEach((vals, k) => {
        const v = vals[i];
        pontos[k].setAttribute('cx', String(x));
        pontos[k].setAttribute('cy', String(geoY(g, v || 0)));
        pontos[k].setAttribute('visibility', v === null ? 'hidden' : 'visible');
      });
      const linhaDica = (cor, nome, v) => '<div class="dica-linha"><i style="background:' + cor + '"></i>' + nome + '<b>' + (v === null ? '—' : fmtN(v)) + '</b></div>';
      const dica = document.getElementById('dica-acessos');
      dica.innerHTML = '<div class="dica-dia">' + diaLongo(r.dias[i]) + (i === g.n - 1 ? ' (hoje)' : '') + '</div>'
        + linhaDica(COR_VISITAS, 'Visitas', r.views[i]) + linhaDica(COR_DRIVE, 'Abriram o Drive', r.drive[i]);
      dica.hidden = false;
      // Onde a dica fica: nunca em cima do ponto que ela descreve. Primeiro
      // tenta o alto, AO LADO da cruz (do lado com mais espaço). No celular a
      // dica pode não caber de lado nenhum; aí ela vai, nesta ordem, para cima
      // do ponto mais alto, para baixo do mais baixo, para o vão entre os dois
      // — e, se nada disso couber, para cima do gráfico (sobre a legenda, que
      // ela repete), onde não cobre dado nenhum.
      const escala = svg.getBoundingClientRect().width / g.largura || 1;
      const xPx = x * escala;
      const larg = box.clientWidth, alt = box.clientHeight;
      const dw = dica.offsetWidth, dh = dica.offsetHeight;
      let esq, topo = 0;
      if (xPx - dw - 12 >= 0 && (xPx > larg / 2 || xPx + 12 + dw > larg)) esq = xPx - dw - 12;
      else if (xPx + 12 + dw <= larg) esq = xPx + 12;
      else {
        esq = Math.max(0, Math.min(larg - dw, xPx - dw / 2));
        const ys = [r.views[i], r.drive[i]].filter(v => v !== null).map(v => geoY(g, v) * escala);
        const alto = ys.length ? Math.min(...ys) : 0, baixo = ys.length ? Math.max(...ys) : 0;
        if (alto - dh - 10 >= 0) topo = alto - dh - 10;
        else if (baixo + 10 + dh <= alt) topo = baixo + 10;
        else if (baixo - alto >= dh + 20) topo = alto + 10;
        else topo = -dh - 8;
      }
      dica.style.transform = 'translate(' + Math.round(esq) + 'px,' + Math.round(topo) + 'px)';
      if (anunciar) {
        const an = document.getElementById('acessos-anuncio');
        if (an) an.textContent = diaLongo(r.dias[i]) + ': ' + (r.views[i] === null ? 'sem contagem' : fmtN(r.views[i]) + ' visitas, ' + fmtN(r.drive[i]) + ' abriram o Drive');
      }
    }

    // A semana: média por dia da semana no período.
    const NOMES_SEMANA = ['Domingo', 'Segunda', 'Terça', 'Quarta', 'Quinta', 'Sexta', 'Sábado'];
    const PLURAL_SEMANA = ['domingos', 'segundas', 'terças', 'quartas', 'quintas', 'sextas', 'sábados'];
    function renderSemana() {
      const box = document.getElementById('grafico-semana');
      const leitura = document.getElementById('semana-leitura');
      if (!box) return;
      const r = recorteAtual;
      if (!r || !serieDiaria.primeiroDia) {
        box.innerHTML = '<div class="grafico-vazio">Ainda não há contagem por dia.</div>';
        dicasSemana = [];
        if (leitura) leitura.textContent = '';
        return;
      }
      const sem = mediaPorSemana(r.dias, r.views);
      const fmtMedia = v => v.toLocaleString('pt-BR', { maximumFractionDigits: v < 10 ? 1 : 0 });
      dicasSemana = sem.map((x, w) => NOMES_SEMANA[w] + ': média de ' + fmtMedia(x.media) + ' visitas'
        + (x.dias ? ' (' + x.dias + ' ' + (x.dias === 1 ? NOMES_SEMANA[w].toLowerCase() : PLURAL_SEMANA[w]) + ' no período)' : ' (nenhum no período)'));
      const largura = Math.max(220, Math.round(box.clientWidth || 0));
      box.innerHTML = svgColunas({
        largura: largura, altura: 190, cor: COR_VISITAS,
        rotulos: ['dom', 'seg', 'ter', 'qua', 'qui', 'sex', 'sáb'],
        valores: sem.map(x => x.media), dicas: dicasSemana, formata: fmtMedia,
      }) + '<ul class="sr-only">' + dicasSemana.map(t => '<li>' + t + '</li>').join('') + '</ul>';
      let top = -1;
      sem.forEach((x, w) => { if (x.media > 0 && (top < 0 || x.media > sem[top].media)) top = w; });
      if (leitura) leitura.textContent = top >= 0 ? 'Dia mais movimentado: ' + NOMES_SEMANA[top].toLowerCase() + ', com média de ' + fmtMedia(sem[top].media) + ' visitas. Toque numa coluna para ver o número.' : 'Nenhuma visita no período.';
    }

    // O portão: quantos acessos ao Drive foram liberados por cada modo.
    function renderPortao() {
      const el = document.getElementById('grafico-portao');
      if (!el) return;
      const d = serieDiaria;
      if (!d || !d.gate) { el.innerHTML = '<p class="metrics-nota">Sem dados do portão.</p>'; return; }
      const ini = Math.max(0, d.dias.length - metricsPeriodo);
      const modos = [['turnstile', 'Verificação automática'], ['email', 'Código por e-mail'], ['noscript', 'Sem JavaScript']];
      const vals = modos.map(m => (d.gate[m[0]] || []).slice(ini).reduce((t, v) => t + (v || 0), 0));
      const tot = vals.reduce((a, b) => a + b, 0);
      const sempre = Object.values(d.gateTotal || {}).reduce((a, b) => a + (b || 0), 0);
      const rodape = '<p class="metrics-nota">' + fmtN(tot) + ' acesso' + (tot === 1 ? '' : 's') + ' liberado' + (tot === 1 ? '' : 's') + ' nos últimos ' + metricsPeriodo + ' dias'
        + (sempre ? '; ' + fmtN(sempre) + ' desde que esta contagem existe (versão 2.0).' : '.') + '</p>';
      if (!tot) { el.innerHTML = rodape; return; }
      const max = Math.max(...vals);
      el.innerHTML = modos.map((m, i) => '<div><div class="barra-rot"><span>' + m[1] + '</span><b>' + fmtN(vals[i]) + ' · ' + Math.round(vals[i] / tot * 100) + '%</b></div>'
        + '<div class="barra-trilho"><i style="width:' + (vals[i] ? Math.max(1, vals[i] / max * 100) : 0).toFixed(1) + '%;background:' + COR_PORTAO + '"></i></div></div>').join('') + rodape;
    }

    // Cada projeto no período, com a barra da ordem escolhida e a curva das
    // visitas por dia (sparkline).
    function renderRanking() {
      const el = document.getElementById('metrics-ranking');
      if (!el) return;
      const d = serieDiaria;
      if (!d || !d.primeiroDia) { el.innerHTML = '<p class="empty">Ainda não há contagem por dia — os totais estão logo abaixo.</p>'; return; }
      const ini = Math.max(0, d.dias.length - metricsPeriodo);
      const linhas = [];
      for (const slug of Object.keys(d.projetos)) {
        const p = d.projetos[slug];
        const v = p.views.slice(ini), c = p.driveClicks.slice(ini);
        const tv = v.reduce((a, b) => a + b, 0), tc = c.reduce((a, b) => a + b, 0);
        if (!tv && !tc) continue;
        linhas.push({ slug: slug, titulo: tituloDoProjeto(slug), views: tv, driveClicks: tc, taxa: tv ? tc / tv : 0,
          serie: v.map((x, i) => d.dias[ini + i] < d.primeiroDia ? null : x) });
      }
      if (!linhas.length) { el.innerHTML = '<p class="empty">Nenhuma visita nos últimos ' + metricsPeriodo + ' dias.</p>'; return; }
      const k = metricsOrdem;
      linhas.sort((a, b) => (b[k] - a[k]) || (b.views - a.views) || a.titulo.localeCompare(b.titulo, 'pt-BR'));
      const maxV = Math.max(1, ...linhas.map(l => l.views));
      const maxD = Math.max(1, ...linhas.map(l => l.driveClicks));
      const barra = l => k === 'views' ? { pct: l.views / maxV * 100, cor: COR_VISITAS }
        : k === 'driveClicks' ? { pct: l.driveClicks / maxD * 100, cor: COR_DRIVE } : { pct: Math.min(100, l.taxa * 100), cor: COR_DRIVE };
      const semVisita = Math.max(0, events.length - linhas.length);
      el.innerHTML = linhas.map(l => {
        const b = barra(l);
        return '<button type="button" class="rank-item" data-action="focaProjeto" data-slug="' + esc(l.slug) + '" aria-pressed="' + (l.slug === metricsProjeto) + '">'
          + '<span class="rank-nome">' + esc(l.titulo) + '</span>'
          + '<span class="rank-num">' + fmtN(l.views) + ' visitas · ' + fmtN(l.driveClicks) + ' Drive · ' + (l.views ? Math.round(l.taxa * 100) + '%' : '—') + '</span>'
          + '<span class="rank-barra"><span class="barra-trilho"><i style="width:' + Math.max(1, b.pct).toFixed(1) + '%;background:' + b.cor + '"></i></span>'
          + sparkline(l.serie, 72, 20, COR_VISITAS) + '</span></button>';
      }).join('') + (semVisita ? '<p class="rank-resto">' + semVisita + (semVisita === 1 ? ' projeto sem visita' : ' projetos sem visita') + ' no período.</p>' : '');
    }

    // ---- Métricas: contas puras ----
    // Sem DOM e sem estado de fora: tests/painel.test.js tira cada uma deste
    // arquivo e a executa no node (a mesma técnica dos pares cliente/servidor
    // de tests/security.test.js). Se mudar o nome ou a assinatura, o teste
    // avisa que precisa ser reapontado.

    // Escala do eixo y: topo "redondo" e de 3 a 6 linhas de grade, em passos
    // inteiros (contagem de gente não tem meia pessoa).
    function escalaMetricas(max) {
      const alvo = Math.max(4, Math.ceil(max));
      const bruto = alvo / 4;
      const pot = Math.pow(10, Math.floor(Math.log10(bruto)));
      const mult = pot >= 10 ? [1, 2, 2.5, 5, 10] : [1, 2, 5, 10];
      let passo = 10 * pot;
      for (const m of mult) { if (m * pot >= bruto) { passo = m * pot; break; } }
      const topo = Math.ceil(alvo / passo) * passo;
      const marcas = [];
      for (let v = 0; v <= topo; v += passo) marcas.push(v);
      return { topo: topo, marcas: marcas };
    }

    // O recorte do período: os N dias até hoje, somados em todos os projetos
    // (ou só no escolhido), e a soma dos N dias ANTERIORES para a comparação.
    // Dia anterior ao primeiro dia da série vale null — "sem dado", não zero:
    // antes dele a contagem por dia não existia. Comparação só quando o
    // período anterior inteiro já tinha contagem; senão a "queda" seria só o
    // começo da série.
    function recorteMetricas(d, n, slug) {
      const total = d.dias.length;
      const ini = Math.max(0, total - n);
      const projs = slug ? (d.projetos[slug] ? [d.projetos[slug]] : []) : Object.values(d.projetos);
      const soma = (campo, i) => projs.reduce((t, p) => t + (p[campo][i] || 0), 0);
      const views = [], drive = [];
      for (let i = ini; i < total; i++) {
        const semDado = !d.primeiroDia || d.dias[i] < d.primeiroDia;
        views.push(semDado ? null : soma('views', i));
        drive.push(semDado ? null : soma('driveClicks', i));
      }
      const antIni = ini - n;
      const temAnterior = antIni >= 0 && !!d.primeiroDia && d.dias[antIni] >= d.primeiroDia;
      let antV = 0, antD = 0;
      if (temAnterior) for (let i = antIni; i < ini; i++) { antV += soma('views', i); antD += soma('driveClicks', i); }
      const tot = arr => arr.reduce((t, v) => t + (v || 0), 0);
      return { dias: d.dias.slice(ini), views: views, drive: drive, totV: tot(views), totD: tot(drive), antV: antV, antD: antD, temAnterior: temAnterior };
    }

    // Variação de um período para o outro, em % inteiro. null quando não há
    // base (o anterior foi zero): "+∞%" não informa nada.
    function variacao(atual, antes) {
      if (!antes) return null;
      const pct = Math.round((atual - antes) / antes * 100);
      return { dir: Math.sign(pct), valor: Math.abs(pct) };
    }

    // O dia de maior valor (o mais recente, no empate); -1 se nenhum passa de 0.
    function indicePico(valores) {
      let k = -1;
      valores.forEach((v, i) => { if (v !== null && v > 0 && (k < 0 || v >= valores[k])) k = i; });
      return k;
    }

    // Média por dia da semana (0 = domingo). Dia sem dado (null) não entra —
    // senão os dias de antes da contagem puxariam a média para baixo.
    function mediaPorSemana(dias, valores) {
      const soma = [0, 0, 0, 0, 0, 0, 0], qtd = [0, 0, 0, 0, 0, 0, 0];
      dias.forEach((dia, i) => {
        if (valores[i] === null) return;
        const w = new Date(dia + 'T12:00:00Z').getUTCDay();
        soma[w] += valores[i];
        qtd[w]++;
      });
      return soma.map((s, w) => ({ media: qtd[w] ? s / qtd[w] : 0, dias: qtd[w] }));
    }

    function diaCurto(dia) { return dia.slice(8, 10) + '/' + dia.slice(5, 7); }
    function diaLongo(dia) {
      return ['dom', 'seg', 'ter', 'qua', 'qui', 'sex', 'sáb'][new Date(dia + 'T12:00:00Z').getUTCDay()] + ', ' + diaCurto(dia);
    }

    // Quais dias ganham rótulo no eixo x: todos até 8; acima disso, uns cinco,
    // contados de HOJE para trás (o último rótulo é sempre hoje) e espaçados
    // por igual — o primeiro só entra se não encostar no segundo.
    function marcasX(n) {
      if (n <= 0) return [];
      if (n <= 8) return Array.from({ length: n }, (_, i) => i);
      const passo = Math.ceil((n - 1) / 4);
      const out = [];
      for (let i = n - 1; i >= 0; i -= passo) out.unshift(i);
      if (out[0] !== 0 && out[0] >= passo * 0.75) out.unshift(0);
      return out;
    }

    // Onde fica o dia i e o valor v, na geometria que svgLinhas devolveu.
    function geoX(g, i) { return g.esq + (g.n <= 1 ? g.w / 2 : i * g.w / (g.n - 1)); }
    function geoY(g, v) { return g.cima + g.h - v / g.topo * g.h; }

    // Gráfico de linhas em SVG, como texto (entra por innerHTML). Um eixo y
    // só — nunca dois. Dia sem dado (null) interrompe a linha em vez de
    // desenhá-la no zero. Grade e eixos recessivos; rótulos na tinta do texto;
    // só o pico das visitas leva número. Com espaço (rotulosFim), cada linha
    // leva o nome na ponta — a legenda acima existe sempre.
    function svgLinhas(o) {
      const n = o.dias.length;
      let max = 0;
      o.series.forEach(se => se.valores.forEach(v => { if (v !== null && v > max) max = v; }));
      const escala = escalaMetricas(max);
      const rotY = escala.marcas.map(m => m.toLocaleString('pt-BR'));
      const esq = 10 + 7 * Math.max(...rotY.map(t => t.length));
      const dir = o.rotulosFim ? 62 : 12;
      const cima = 18, baixo = 26;
      const g = { largura: o.largura, altura: o.altura, esq: esq, cima: cima, w: Math.max(10, o.largura - esq - dir), h: Math.max(10, o.altura - cima - baixo), n: n, topo: escala.topo };
      const r1 = v => Math.round(v * 10) / 10;
      const x = i => r1(geoX(g, i));
      const y = v => r1(geoY(g, v));
      let s = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ' + o.largura + ' ' + o.altura + '" width="' + o.largura + '" height="' + o.altura + '" aria-hidden="true" focusable="false" data-pontos="' + n + '">';
      escala.marcas.forEach((m, k) => {
        s += '<line x1="' + esq + '" x2="' + r1(esq + g.w) + '" y1="' + y(m) + '" y2="' + y(m) + '" stroke="' + (m === 0 ? '#383835' : '#2c2c2a') + '" stroke-width="1"/>'
          + '<text x="' + (esq - 6) + '" y="' + y(m) + '" dy="0.32em" text-anchor="end" fill="#898781" font-size="11">' + rotY[k] + '</text>';
      });
      marcasX(n).forEach(i => {
        const ancora = n > 1 && i === 0 ? 'start' : n > 1 && i === n - 1 ? 'end' : 'middle';
        s += '<text x="' + x(i) + '" y="' + (cima + g.h + 18) + '" text-anchor="' + ancora + '" fill="#898781" font-size="11">' + diaCurto(o.dias[i]) + '</text>';
      });
      const pontas = [];
      o.series.forEach(se => {
        let d = '', novo = true, ultimo = -1;
        se.valores.forEach((v, i) => {
          if (v === null) { novo = true; return; }
          d += (novo ? 'M' : 'L') + x(i) + ' ' + y(v);
          novo = false;
          ultimo = i;
        });
        if (d) s += '<path d="' + d + '" fill="none" stroke="' + se.cor + '" stroke-width="2" stroke-linejoin="round" stroke-linecap="round"/>';
        if (ultimo >= 0) pontas.push({ x: x(ultimo), y: y(se.valores[ultimo]), cor: se.cor, nome: se.curto || se.nome });
      });
      // Ponta de cada linha: um ponto com anel da cor do fundo (separa as
      // duas quando se encostam) e, com espaço, o nome — afastados se colidem.
      if (o.rotulosFim && pontas.length === 2 && Math.abs(pontas[0].y - pontas[1].y) < 13) {
        const meio = (pontas[0].y + pontas[1].y) / 2, cima0 = pontas[0].y <= pontas[1].y;
        pontas[0].ty = meio + (cima0 ? -6.5 : 6.5);
        pontas[1].ty = meio + (cima0 ? 6.5 : -6.5);
      }
      pontas.forEach(p => {
        s += '<circle cx="' + p.x + '" cy="' + p.y + '" r="3" fill="' + p.cor + '" stroke="#141414" stroke-width="2"/>';
        if (o.rotulosFim) s += '<text x="' + r1(p.x + 8) + '" y="' + r1(p.ty === undefined ? p.y : p.ty) + '" dy="0.32em" fill="#c9c4be" font-size="11">' + p.nome + '</text>';
      });
      // O pico da primeira série (visitas): o único número dentro do gráfico.
      const pico = o.series.length ? indicePico(o.series[0].valores) : -1;
      if (pico >= 0) {
        const px = x(pico), py = y(o.series[0].valores[pico]);
        const ancora = px < esq + 24 ? 'start' : px > esq + g.w - 24 ? 'end' : 'middle';
        s += '<circle cx="' + px + '" cy="' + py + '" r="4" fill="' + o.series[0].cor + '" stroke="#141414" stroke-width="2"/>'
          + '<text x="' + px + '" y="' + r1(py - 9 < cima ? py + 17 : py - 9) + '" text-anchor="' + ancora + '" fill="#f0ebe5" font-size="11" font-weight="600">' + o.series[0].valores[pico].toLocaleString('pt-BR') + '</text>';
      }
      // A cruz do ponteiro: escondida até alguém passar o dedo ou o mouse.
      s += '<g class="cruz" visibility="hidden"><line x1="0" x2="0" y1="' + cima + '" y2="' + r1(cima + g.h) + '" stroke="#6b6a66" stroke-width="1"/>';
      o.series.forEach(se => { s += '<circle r="4" cx="0" cy="0" fill="' + se.cor + '" stroke="#141414" stroke-width="2"/>'; });
      return { svg: s + '</g></svg>', geo: g };
    }

    // Colunas (dia da semana), com a ponta de dado arredondada em 4 px e
    // presa à linha de base; a área de toque é a faixa inteira da coluna,
    // maior que a marca. Só a maior leva o número.
    function svgColunas(o) {
      const n = o.valores.length;
      const max = Math.max(0, ...o.valores);
      const escala = escalaMetricas(max);
      const rotY = escala.marcas.map(m => m.toLocaleString('pt-BR'));
      const esq = 10 + 7 * Math.max(...rotY.map(t => t.length));
      const cima = 18, baixo = 24, dir = 4;
      const w = Math.max(10, o.largura - esq - dir), h = Math.max(10, o.altura - cima - baixo);
      const banda = w / n;
      const larg = Math.max(4, Math.min(44, banda * 0.72));
      const r1 = v => Math.round(v * 10) / 10;
      const y = v => cima + h - v / escala.topo * h;
      const base = cima + h;
      let s = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ' + o.largura + ' ' + o.altura + '" width="' + o.largura + '" height="' + o.altura + '" aria-hidden="true" focusable="false" data-colunas="' + n + '">';
      escala.marcas.forEach((m, k) => {
        s += '<line x1="' + esq + '" x2="' + r1(esq + w) + '" y1="' + r1(y(m)) + '" y2="' + r1(y(m)) + '" stroke="' + (m === 0 ? '#383835' : '#2c2c2a') + '" stroke-width="1"/>'
          + '<text x="' + (esq - 6) + '" y="' + r1(y(m)) + '" dy="0.32em" text-anchor="end" fill="#898781" font-size="11">' + rotY[k] + '</text>';
      });
      let maior = -1;
      o.valores.forEach((v, i) => { if (v > 0 && (maior < 0 || v > o.valores[maior])) maior = i; });
      o.valores.forEach((v, i) => {
        const cx = esq + banda * i + banda / 2, x0 = cx - larg / 2, ty = y(v), alt = base - ty;
        if (alt >= 0.5) {
          const r = Math.min(4, alt, larg / 2);
          s += '<path d="M' + r1(x0) + ' ' + r1(base) + 'V' + r1(ty + r) + 'Q' + r1(x0) + ' ' + r1(ty) + ' ' + r1(x0 + r) + ' ' + r1(ty)
            + 'H' + r1(x0 + larg - r) + 'Q' + r1(x0 + larg) + ' ' + r1(ty) + ' ' + r1(x0 + larg) + ' ' + r1(ty + r) + 'V' + r1(base) + 'Z" fill="' + o.cor + '"/>';
        }
        s += '<text x="' + r1(cx) + '" y="' + (base + 17) + '" text-anchor="middle" fill="#898781" font-size="11">' + o.rotulos[i] + '</text>';
        if (i === maior) s += '<text x="' + r1(cx) + '" y="' + r1(ty - 6) + '" text-anchor="middle" fill="#f0ebe5" font-size="11" font-weight="600">' + o.formata(v) + '</text>';
        s += '<rect x="' + r1(esq + banda * i) + '" y="' + cima + '" width="' + r1(banda) + '" height="' + r1(h + baixo) + '" fill="transparent" data-coluna="' + i + '"><title>' + o.dicas[i] + '</title></rect>';
      });
      return s + '</svg>';
    }

    // Linha pequena (sparkline): só a forma, sem eixo; null interrompe.
    function sparkline(valores, largura, altura, cor) {
      const n = valores.length;
      let max = 0;
      valores.forEach(v => { if (v !== null && v > max) max = v; });
      const r1 = v => Math.round(v * 10) / 10;
      let d = '', novo = true;
      valores.forEach((v, i) => {
        if (v === null) { novo = true; return; }
        const px = n <= 1 ? largura / 2 : 1 + i * (largura - 2) / (n - 1);
        const py = altura - 2 - (max ? v / max * (altura - 4) : 0);
        d += (novo ? 'M' : 'L') + r1(px) + ' ' + r1(py);
        novo = false;
      });
      return '<svg width="' + largura + '" height="' + altura + '" viewBox="0 0 ' + largura + ' ' + altura + '" aria-hidden="true" focusable="false">'
        + (d ? '<path d="' + d + '" fill="none" stroke="' + cor + '" stroke-width="1.5" stroke-linejoin="round" stroke-linecap="round"/>' : '') + '</svg>';
    }

    // ---- Total desde o início (a tabela de antes) ----
    function renderMetrics() {
      const body = document.getElementById('metrics-body');
      const key = metricsSort.key;
      const dir = metricsSort.dir === 'asc' ? 1 : -1;
      const taxa = m => (m.driveClicks || 0) / (m.views || 1);
      const num = (m, k) => k === 'driveClicks' ? (m.driveClicks || 0) : k === 'taxa' ? taxa(m) : (m.views || 0);
      const rowsData = [...metricsData].sort((a, b) => (num(a, key) - num(b, key)) * dir);
      const maxViews = metricsData.reduce((mx, m) => Math.max(mx, m.views || 0), 0) || 1;
      const ind = k => k === metricsSort.key ? '<span class="sort-ind">' + (metricsSort.dir === 'asc' ? '▲' : '▼') + '</span>' : '';
      const sortAttr = k => k === metricsSort.key ? ' aria-sort="' + (metricsSort.dir === 'asc' ? 'ascending' : 'descending') + '"' : '';
      const rows = rowsData.map(m => {
        const pct = Math.max(2, Math.round((m.views || 0) / maxViews * 100));
        return '<tr>'
          + '<td>' + esc(m.title) + '<span class="slug-mini"><br><span style="font-size:.7rem;color:var(--text3)">/' + esc(m.slug) + '</span></span></td>'
          + '<td class="views-cell"><span class="views-bar" style="width:' + pct + '%"></span><span class="views-badge">' + fmtN(m.views) + '</span></td>'
          + '<td><span class="views-badge">' + fmtN(m.driveClicks) + '</span></td>'
          + '<td><span class="views-badge">' + ((m.views || 0) ? Math.round(taxa(m) * 100) + '%' : '—') + '</span></td>'
          + '</tr>';
      }).join('');
      body.innerHTML = '<table class="metrics-table"><thead><tr>'
        + '<th scope="col">Projeto</th>'
        + '<th scope="col" class="sortable" data-action="sortMetrics" data-sort="views" title="Visitantes únicos por hora"' + sortAttr('views') + '>Visitas' + ind('views') + '</th>'
        + '<th scope="col" class="sortable" data-action="sortMetrics" data-sort="driveClicks" title="Quantos abriram o link do Drive"' + sortAttr('driveClicks') + '>Drive' + ind('driveClicks') + '</th>'
        + '<th scope="col" class="sortable" data-action="sortMetrics" data-sort="taxa" title="Abriram o Drive ÷ visitas"' + sortAttr('taxa') + '>Taxa' + ind('taxa') + '</th>'
        + '</tr></thead><tbody>' + rows + '</tbody></table>';
    }

    function sortMetrics(key) {
      if (metricsSort.key === key) metricsSort.dir = metricsSort.dir === 'desc' ? 'asc' : 'desc';
      else { metricsSort.key = key; metricsSort.dir = 'desc'; }
      renderMetrics();
    }

    // ---- Change password ----
    async function changePassword() {
      const p1 = document.getElementById('new-pass').value;
      const p2 = document.getElementById('new-pass2').value;
      if (!p1) return toast('Digite a nova senha.', 'err');
      if (p1 !== p2) return toast('As senhas não coincidem.', 'err');
      // Interpola PASSWORD_MIN_LENGTH (security.js) para não divergir do mínimo
      // real do servidor. Regras finas (classes, padrões) ficam só no servidor.
      if (p1.length < ${PASSWORD_MIN_LENGTH}) return toast('Senha muito curta (mínimo ${PASSWORD_MIN_LENGTH} caracteres).', 'err');
      const ok = await confirmDialog({
        title: 'Trocar senha',
        message: 'Você está prestes a trocar a senha de acesso ao painel.',
        confirmLabel: 'Trocar senha',
        danger: true,
        typeToConfirm: 'TROCAR',
      });
      if (!ok) return;
      try {
        await api('PUT', '/api/settings/password', { password: p1 });
        document.getElementById('new-pass').value = '';
        document.getElementById('new-pass2').value = '';
        toast('Senha alterada com sucesso!', 'ok');
      } catch(err) {
        toast(err.message || 'Erro ao alterar senha.', 'err');
      }
    }

    // ---- Backup ----
    function downloadBackup() {
      const a = document.createElement('a');
      a.href = '/api/backup';
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
    }
    async function restoreBackup() {
      const fileInput = document.getElementById('restore-file');
      const file = fileInput.files[0];
      if (!file) { toast('Selecione um arquivo de backup.', 'err'); return; }
      let backup;
      try { backup = JSON.parse(await file.text()); } catch { toast('Arquivo inválido.', 'err'); return; }
      if (!Array.isArray(backup.events)) { toast('Backup inválido: sem campo "events".', 'err'); return; }
      const n = backup.events.length;
      const date = backup.backupAt ? new Date(backup.backupAt).toLocaleDateString('pt-BR') : 'data desconhecida';
      const ok = await confirmDialog({
        title: 'Restaurar backup',
        message: 'Restaurar backup de ' + date + ' com ' + n + ' evento' + (n !== 1 ? 's' : '') + '? Eventos novos serão adicionados sem excluir nenhum dado atual.',
        confirmLabel: 'Restaurar',
        danger: true,
        typeToConfirm: 'RESTAURAR',
      });
      if (!ok) return;
      try {
        const res = await api('POST', '/api/backup/restore', backup);
        // Ignorados = sem id ou sem URL válida no backup. Dizer quantos é o que
        // separa "restaurei tudo" de "restaurei tudo o que dava".
        const ignorados = res.skipped ? ', ' + res.skipped + ' ignorado' + (res.skipped !== 1 ? 's' : '') + ' (sem id ou URL válida)' : '';
        toast('Restaurado: ' + res.added + ' adicionados, ' + res.updated + ' atualizados' + ignorados + '.', 'ok');
        setTimeout(() => window.location.reload(), 1800);
      } catch(err) {
        toast(err.message || 'Erro ao restaurar.', 'err');
      }
    }

    // ---- CSV helpers (BOM + escaping) ----
    // Espelha csvCell() de utils.js PASSO A PASSO, e as três etapas importam na
    // ordem em que estão. Este bloco já dizia "matches server" enquanto fazia só
    // a citação: os exports do navegador (solicitações de remoção, métricas)
    // saíam sem a defesa contra INJEÇÃO DE FÓRMULA que o export do servidor tem
    // desde sempre — e é justamente o do navegador que carrega "message" e
    // "value", texto cru digitado por visitante.
    //
    // O ataque: Excel/Sheets executam uma célula que começa com =, +, -, @, TAB
    // ou CR ao abrir o arquivo — uma fórmula HYPERLINK exfiltra a linha ao lado
    // com um clique. As aspas do CSV não bloqueiam isso (são citação, não escape
    // de fórmula), e quem abre o arquivo é o admin, com os dados pessoais dos
    // titulares na tela. O apóstrofo à frente é o que a planilha lê como "isto
    // é texto". Sem crase em nenhum comentário daqui: este bloco vive dentro de
    // um template literal, e uma crase solta encerra a string e quebra o módulo.
    function toCSV(cols, rows){
      function cell(v){
        if (v == null) return '';
        var s = String(v);
        s = s.replace(/[\\x00-\\x08\\x0b\\x0c\\x0e-\\x1f\\x7f]/g, '');
        if (/^[-=+@\\t\\r]/.test(s)) s = "'" + s;
        return /[",\\r\\n]/.test(s) ? '"'+s.replace(/"/g,'""')+'"' : s;
      }
      return '\\uFEFF' + [cols.map(cell).join(',')].concat(rows.map(function(r){ return cols.map(function(c){ return cell(r[c]); }).join(','); })).join('\\r\\n') + '\\r\\n';
    }
    function downloadCSV(name, cols, rows){ var b=new Blob([toCSV(cols,rows)],{type:'text/csv;charset=utf-8'}); var u=URL.createObjectURL(b); var a=document.createElement('a'); a.href=u; a.download=name; document.body.appendChild(a); a.click(); a.remove(); setTimeout(function(){URL.revokeObjectURL(u);},1000); }
    function csvDate(){ return hojeEmSaoPaulo(); }

    // ---- Exports ----
    async function exportMetricsCSV() {
      try {
        let data = metricsData;
        if (!metricsLoaded) { data = await api('GET', '/api/metrics'); }
        if (!data || !data.length) return toast('Nenhuma métrica para exportar.', 'err');
        const rows = data.map(m => ({ title: m.title, slug: m.slug, views: m.views || 0, driveClicks: m.driveClicks || 0 }));
        downloadCSV('metricas-' + csvDate() + '.csv', ['title', 'slug', 'views', 'driveClicks'], rows);
      } catch(err) {
        toast(err.message || 'Erro ao exportar métricas.', 'err');
      }
    }

    // A série por dia inteira que o painel tem (até 180 dias, a partir do
    // primeiro dia contado), um projeto por linha e dia: abre direto numa
    // tabela dinâmica. Projeto sem nenhuma visita na janela não entra.
    async function exportSerieCSV() {
      try {
        const d = serieDiaria || await api('GET', '/api/metrics/diario?dias=180');
        if (!d || !d.primeiroDia) return toast('Ainda não há contagem por dia para exportar.', 'err');
        const ini = Math.max(0, d.dias.findIndex(x => x >= d.primeiroDia));
        const rows = [];
        for (const slug of Object.keys(d.projetos).sort()) {
          const p = d.projetos[slug];
          for (let i = ini; i < d.dias.length; i++) {
            rows.push({ dia: d.dias[i], slug: slug, titulo: tituloDoProjeto(slug), visitas: p.views[i] || 0, abriram_drive: p.driveClicks[i] || 0 });
          }
        }
        if (!rows.length) return toast('Nenhuma visita contada por dia ainda.', 'err');
        downloadCSV('metricas-por-dia-' + csvDate() + '.csv', ['dia', 'slug', 'titulo', 'visitas', 'abriram_drive'], rows);
      } catch(err) {
        toast(err.message || 'Erro ao exportar métricas por dia.', 'err');
      }
    }

    async function exportRemovalCSV() {
      try {
        const data = await api('GET', '/api/removal-requests');
        if (!data || !data.length) return toast('Nenhuma solicitação para exportar.', 'err');
        downloadCSV('solicitacoes-remocao-' + csvDate() + '.csv',
          ['createdAt', 'eventSlug', 'eventTitle', 'method', 'value', 'email', 'phone', 'message', 'resolved', 'resolvedAt'], data);
      } catch(err) {
        toast(err.message || 'Erro ao exportar solicitações.', 'err');
      }
    }

    async function exportConsentCSV() {
      try {
        const res = await fetch('/api/consent/export', { credentials: 'same-origin' });
        if (res.ok) {
          const blob = await res.blob();
          const u = URL.createObjectURL(blob);
          const a = document.createElement('a');
          a.href = u; a.download = 'consentimentos-' + csvDate() + '.csv';
          document.body.appendChild(a); a.click(); a.remove();
          setTimeout(() => URL.revokeObjectURL(u), 1000);
        } else {
          const data = await res.json().catch(() => ({}));
          toast(data.error || 'Erro ao exportar consentimentos.', 'err');
        }
      } catch(err) {
        toast(err.message || 'Erro ao exportar consentimentos.', 'err');
      }
    }

    // ---- Pin ----
    async function togglePin(id) {
      const ev = events.find(e => e.id === id);
      if (!ev) return;
      const newPinned = !ev.pinned;
      setRowBusy(id, true);
      try {
        await api('PUT', \`/api/events/\${id}\`, { pinned: newPinned });
        ev.pinned = newPinned;
        renderEventList();
        toast(newPinned ? 'Evento destacado na galeria.' : 'Destaque removido.', 'ok');
      } catch(err) {
        toast(err.message || 'Erro ao alterar destaque.', 'err');
      } finally {
        setRowBusy(id, false);
      }
    }

    // ---- Categories ----
    function catOptionsHTML(selected) {
      return ['<option value="">Sem categoria</option>']
        .concat(categories.map(c => '<option value="' + esc(c) + '"' + (c === selected ? ' selected' : '') + '>' + esc(c) + '</option>'))
        .join('');
    }
    function catFilterOptionsHTML(selected) {
      return ['<option value="">Todas as categorias</option>']
        .concat(categories.map(c => '<option value="' + esc(c) + '"' + (c === selected ? ' selected' : '') + '>' + esc(c) + '</option>'))
        .join('');
    }
    function refreshCategorySelects() {
      const f = document.getElementById('f-category');
      if (f) { const v = f.value; f.innerHTML = catOptionsHTML(v); }
      const m = document.getElementById('mass-cat');
      if (m) { const v = m.value; m.innerHTML = catOptionsHTML(v); }
      const cf = document.getElementById('category-filter');
      if (cf) { const v = cf.value; cf.innerHTML = catFilterOptionsHTML(v); }
    }
    function renderCategoryManager() {
      const el = document.getElementById('cat-list');
      if (!el) return;
      if (!categories.length) { el.innerHTML = '<span class="cat-empty">Nenhuma categoria ainda.</span>'; return; }
      el.innerHTML = categories.map(c =>
        '<span class="cat-chip">' + esc(c) +
        '<button type="button" title="Excluir" aria-label="Excluir categoria" data-cat-del="' + esc(c) + '">×</button></span>'
      ).join('');
    }
    document.getElementById('cat-list')?.addEventListener('click', function(ev) {
      const btn = ev.target.closest('[data-cat-del]');
      if (btn) deleteCategory(btn.dataset.catDel);
    });
    async function saveAgenda() {
      const input = document.getElementById('agenda-texto');
      try {
        const res = await api('PUT', '/api/settings/agenda', { texto: input.value || '' });
        input.value = res.texto;
        toast(res.texto ? 'Selo salvo. A galeria mostra em até 30 s.' : 'Selo removido.', 'ok');
      } catch(err) {
        toast(err.message || 'Erro ao salvar o selo.', 'err');
      }
    }
    async function createCategory() {
      const input = document.getElementById('cat-new');
      const name = (input.value || '').trim();
      if (!name) return toast('Digite o nome da categoria.', 'err');
      try {
        const res = await api('POST', '/api/categories', { name });
        categories = res.categories;
        input.value = '';
        renderCategoryManager();
        refreshCategorySelects();
        toast('Categoria criada.', 'ok');
      } catch(err) {
        toast(err.message || 'Erro ao criar categoria.', 'err');
      }
    }
    async function deleteCategory(name) {
      const inUse = events.filter(e => e.category === name).length;
      const warn = inUse > 0 ? ' Ela será removida de ' + inUse + ' evento' + (inUse !== 1 ? 's' : '') + '.' : '';
      const ok = await confirmDialog({
        title: 'Excluir categoria',
        message: 'Excluir a categoria "' + name + '"?' + warn,
        confirmLabel: 'Excluir',
        danger: true,
        typeToConfirm: name,
      });
      if (!ok) return;
      try {
        const res = await api('POST', '/api/categories/delete', { name });
        categories = res.categories;
        events.forEach(e => { if (e.category === name) e.category = ''; });
        renderCategoryManager();
        refreshCategorySelects();
        renderEventList();
        toast('Categoria excluída.', 'ok');
      } catch(err) {
        toast(err.message || 'Erro ao excluir categoria.', 'err');
      }
    }

    // ---- Mass edit ----
    function toggleMassMode(force) {
      massMode = typeof force === 'boolean' ? force : !massMode;
      if (!massMode) selectedIds.clear();
      document.getElementById('mass-bar').style.display = massMode ? 'flex' : 'none';
      document.getElementById('mass-toggle').textContent = massMode ? 'Cancelar seleção' : 'Selecionar vários';
      const selAll = document.getElementById('mass-selall');
      if (selAll) selAll.checked = false;
      renderEventList();
      updateMassCount();
    }
    function toggleSelectAll(checked) {
      document.querySelectorAll('#evt-list .evt-check').forEach(cb => {
        cb.checked = checked;
        if (checked) selectedIds.add(cb.dataset.id); else selectedIds.delete(cb.dataset.id);
      });
      updateMassCount();
    }
    function updateMassCount() {
      const el = document.getElementById('mass-count');
      if (el) el.textContent = selectedIds.size + ' selecionado' + (selectedIds.size !== 1 ? 's' : '');
    }
    async function applyMassCategory() {
      if (selectedIds.size === 0) return toast('Selecione ao menos um evento.', 'err');
      const category = document.getElementById('mass-cat').value;
      const ids = [...selectedIds];
      const ok = await confirmDialog({
        title: 'Aplicar em massa',
        message: 'Aplicar a categoria "' + category + '" a ' + ids.length + ' evento' + (ids.length !== 1 ? 's' : '') + '? Essa ação não pode ser desfeita em lote.',
        confirmLabel: 'Aplicar',
        danger: true,
        typeToConfirm: String(ids.length),
      });
      if (!ok) return;
      try {
        const res = await api('POST', '/api/events/bulk-category', { ids, category });
        events.forEach(e => { if (selectedIds.has(e.id)) e.category = category; });
        toggleMassMode(false);
        toast(res.updated + ' evento' + (res.updated !== 1 ? 's' : '') + ' atualizado' + (res.updated !== 1 ? 's' : '') + '.', 'ok');
      } catch(err) {
        toast(err.message || 'Erro ao aplicar categoria.', 'err');
      }
    }
    async function applyMassAccess() {
      if (selectedIds.size === 0) return toast('Selecione ao menos um evento.', 'err');
      const accessType = document.getElementById('mass-access').value;
      const accessLabel = { public: 'Público', private: 'Privado', family: 'Familiar' }[accessType] || accessType;
      const ids = [...selectedIds];
      const ok = await confirmDialog({
        title: 'Aplicar em massa',
        message: 'Aplicar o tipo de acesso "' + accessLabel + '" a ' + ids.length + ' evento' + (ids.length !== 1 ? 's' : '') + '? Essa ação não pode ser desfeita em lote.',
        confirmLabel: 'Aplicar',
        danger: true,
        typeToConfirm: String(ids.length),
      });
      if (!ok) return;
      try {
        const res = await api('POST', '/api/events/bulk-access', { ids, accessType });
        events.forEach(e => { if (selectedIds.has(e.id)) e.accessType = accessType; });
        toggleMassMode(false);
        toast(res.updated + ' evento' + (res.updated !== 1 ? 's' : '') + ' atualizado' + (res.updated !== 1 ? 's' : '') + '.', 'ok');
      } catch(err) {
        toast(err.message || 'Erro ao aplicar tipo de acesso.', 'err');
      }
    }

    // ---- API helper ----
    async function api(method, path, body) {
      const res = await fetch(path, {
        method,
        headers: body && method !== 'GET' ? { 'Content-Type': 'application/json' } : {},
        body: body && method !== 'GET' ? JSON.stringify(body) : undefined,
      });
      const data = await res.json().catch(() => ({}));
      if (res.status === 401) {
        // Session expired — send back to login instead of a confusing toast on
        // every action. stashDraft() first so an in-progress edit isn't lost.
        stashDraft();
        window.location.href = '/dashboard';
        throw new Error(data.error || 'Sessão expirada.');
      }
      if (!res.ok) throw new Error(data.error || 'Erro ' + res.status);
      return data;
    }

    // ---- Escape ----
    // Mirrors utils.js's escaper — defined locally since the browser has no
    // module import. Also escapes ' since values land in single-quoted attrs.
    function esc(s) {
      // Only null/undefined become '' — a truthiness check would also swallow
      // 0, rendering "0 views" as a blank cell.
      if (s === null || s === undefined) return '';
      return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#x27;');
    }

    // Mirrors utils.js's safeUrl/toHttps, same reason as esc() above. Always
    // pairs with esc(): esc() closes the attribute but doesn't kill the scheme,
    // safeUrl() kills the scheme but returns a raw URL — a backup restore can
    // put a javascript: URL in the KV verbatim, so both are needed together.
    function safeUrl(u) {
      if (typeof u !== 'string') return '';
      const v = u.startsWith('http://') ? 'https://' + u.slice(7) : u;
      // Prefix check instead of regex: an escaped slash in a template literal
      // reads as lint noise for the same test.
      return v.slice(0, 8).toLowerCase() === 'https://' ? v : '';
    }

    // ---- Toast ----
    function toast(msg, type) {
      const el = document.getElementById('toast');
      el.textContent = msg;
      el.className = 'toast show' + (type ? ' ' + type : '');
      clearTimeout(el._t);
      el._t = setTimeout(() => { el.classList.remove('show'); }, 3000);
    }
  </script>
</body>
</html>`;
}
