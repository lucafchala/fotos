import { sortEvents, escape, safeUrl } from '../utils.js';
import { PASSWORD_MIN_LENGTH } from '../security.js';

const BASE = `
*,*::before,*::after{box-sizing:border-box;margin:0;padding:0}
:root{--bg:#0d0d0d;--bg2:#141414;--bg3:#1a1a1a;--border:#222;--text:#f0ebe5;--text2:#999;--text3:#555;--accent:#f0ebe5;--red:#c0392b;--green:#27ae60;--radius:10px}
body{font-family:'Inter',sans-serif;background:var(--bg);color:var(--text);min-height:100vh;-webkit-text-size-adjust:100%}
input,textarea,select,button{font-family:inherit;font-size:inherit}
button{cursor:pointer}
:focus-visible{outline:2px solid #c0a060;outline-offset:2px}
`;

/**
 * @param {{ error?: boolean, isSetup?: boolean }} [opts]
 * @param {string} [nonce]
 */
export function loginHTML(opts = {}, nonce = '') {
  const { error = false, isSetup = false } = opts;
  const title = isSetup ? 'Criar senha de acesso' : 'Painel administrativo';
  const btnLabel = isSetup ? 'Criar senha e entrar' : 'Entrar';
  const confirmField = isSetup ? `
    <div class="field">
      <label for="confirm">Confirmar senha</label>
      <input type="password" id="confirm" name="confirm" required autocomplete="new-password" placeholder="••••••••">
    </div>` : '';

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
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link href="https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600&display=swap" rel="stylesheet">
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
    .btn-primary:hover{opacity:.9;transform:translateY(-1px)}
    .btn-primary:active{transform:translateY(0)}
    .error-msg{background:#1a0a0a;border:1px solid #3a1010;color:#e07070;font-size:.8rem;padding:.75rem 1rem;border-radius:8px;margin-bottom:1.25rem}
  </style>
</head>
<body>
  <div class="box">
    <div class="logo"><span>fotos · <strong>Luca F. Chala</strong></span></div>
    <h1>${title}</h1>
    <p class="subtitle">${isSetup ? 'Defina uma senha para proteger o painel.' : 'Entre para gerenciar os projetos.'}</p>
    ${error ? `<div class="error-msg">Senha incorreta. Tente novamente.</div>` : ''}
    <form method="POST" action="/dashboard/login">
      <input type="hidden" name="setup" value="${isSetup ? '1' : '0'}">
      <div class="field">
        <label for="password">${isSetup ? 'Nova senha' : 'Senha'}</label>
        <input type="password" id="password" name="password" required autocomplete="${isSetup ? 'new-password' : 'current-password'}" placeholder="••••••••" autofocus>
      </div>
      ${confirmField}
      <button type="submit" class="btn-primary">${btnLabel}</button>
    </form>
  </div>
</body>
</html>`;
}

/** @type {Record<string, string>} */
const STATUS_LABELS_SSR = { 'em-edicao': 'Em edição', 'em-revisao': 'Em revisão', 'entregue': 'Entregue', 'arquivado': 'Arquivado' };

/**
 * @param {import('../utils.js').Evento[]} events
 * @param {string[]} [categories]
 * @param {string} [nonce]
 */
export function dashboardHTML(events, categories = [], nonce = '') {
  const eventsJSON = JSON.stringify(events).replace(/</g, '\\u003c').replace(/>/g, '\\u003e');
  const categoriesJSON = JSON.stringify(categories).replace(/</g, '\\u003c').replace(/>/g, '\\u003e');

  const esc = escape; // canonical 5-char escaper (also escapes '), shared with the gallery/event pages
  const catOptionsSSR = ['<option value="">Sem categoria</option>']
    .concat(categories.map(c => `<option value="${esc(c)}">${esc(c)}</option>`)).join('');
  const catFilterOptionsSSR = ['<option value="">Todas as categorias</option>']
    .concat(categories.map(c => `<option value="${esc(c)}">${esc(c)}</option>`)).join('');
  const sorted = sortEvents(events);
  const active = sorted.filter(e => (e.status || 'entregue') !== 'arquivado');
  /** @param {number} n */
  const noun = n => n === 1 ? 'evento' : 'eventos';
  const ssrCount = `${active.length} ${noun(active.length)} ativos`;
  const ssrList = active.length === 0
    ? '<p class="empty">Nenhum evento ainda. Clique em Adicionar.</p>'
    : active.map(e => {
        const st = e.status || 'entregue';
        const thumb = e.thumbnailUrl
          ? `<img class="evt-thumb" src="${esc(safeUrl(e.thumbnailUrl))}" alt="" onerror="this.style.display='none'">`
          : `<div class="evt-thumb-ph"><svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><rect x="3" y="5" width="18" height="15" rx="2"/><circle cx="12" cy="12" r="4"/><path d="M9 5l1.5-2h3L15 5"/></svg></div>`;
        return `<div class="evt-item${e.visible === false ? ' hidden-evt' : ''}" id="evt-${esc(e.id)}">
          ${thumb}
          <div class="evt-info">
            <div class="evt-name">${esc(e.title)} <span class="status-badge st-${esc(st)}">${esc(STATUS_LABELS_SSR[st] || st)}</span></div>
            <div class="evt-slug">/${esc(e.slug)}</div>
          </div>
          <div class="evt-actions">
            <button class="icon-btn${e.pinned ? ' pinned' : ''}" data-action="pin" data-id="${esc(e.id)}" title="${e.pinned ? 'Remover destaque' : 'Destacar'}" aria-label="${e.pinned ? 'Remover destaque' : 'Destacar'}"><svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="${e.pinned ? 'currentColor' : 'none'}" stroke="currentColor" stroke-width="2"><path d="M12 2l3 7h4l-3.5 5 1.5 7L12 18l-5 3 1.5-7L5 9h4z"/></svg></button>
            <button class="icon-btn" data-action="vis" data-id="${esc(e.id)}" title="${e.visible !== false ? 'Ocultar' : 'Mostrar'}" aria-label="${e.visible !== false ? 'Ocultar' : 'Mostrar'}">${e.visible !== false ? `<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>` : `<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M17.94 17.94A10.07 10.07 0 0112 20c-7 0-11-8-11-8a18.45 18.45 0 015.06-5.94M9.9 4.24A9.12 9.12 0 0112 4c7 0 11 8 11 8a18.5 18.5 0 01-2.16 3.19m-6.72-1.07a3 3 0 11-4.24-4.24"/><line x1="1" y1="1" x2="23" y2="23"/></svg>`}</button>
            <button class="icon-btn" data-action="edit" data-id="${esc(e.id)}" title="Editar" aria-label="Editar"><svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4 9.5-9.5z"/></svg></button>
            <button class="icon-btn" data-action="dup" data-id="${esc(e.id)}" title="Duplicar" aria-label="Duplicar"><svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 01-2-2V4a2 2 0 012-2h9a2 2 0 012 2v1"/></svg></button>
            <button class="icon-btn danger" data-action="del" data-id="${esc(e.id)}" title="Excluir" aria-label="Excluir"><svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 01-2 2H8a2 2 0 01-2-2L5 6"/><path d="M10 11v6"/><path d="M14 11v6"/><path d="M9 6V4h6v2"/></svg></button>
          </div>
        </div>`;
      }).join('');


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
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link href="https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600&display=swap" rel="stylesheet">
  <style>
    ${BASE}
    /* layout */
    .topbar{display:flex;align-items:center;justify-content:space-between;padding:1rem 1.25rem;border-bottom:1px solid var(--border);position:sticky;top:0;background:var(--bg);z-index:10}
    .topbar-logo{font-size:.85rem;font-weight:300;letter-spacing:.18em;text-transform:lowercase;color:var(--text2)}
    .topbar-logo strong{font-weight:600;color:var(--text)}
    .topbar-right{display:flex;align-items:center;gap:.75rem}
    .btn-sm{background:none;border:1px solid var(--border);color:var(--text2);padding:.45rem .875rem;border-radius:7px;font-size:.75rem;font-weight:500;transition:border-color .2s,color .2s}
    .btn-sm:hover{border-color:#444;color:var(--text)}
    /* tabs */
    .tabs{display:flex;border-bottom:1px solid var(--border);padding:0 1.25rem;gap:0}
    .tab{background:none;border:none;color:var(--text3);padding:.875rem 1rem;font-size:.8rem;font-weight:500;letter-spacing:.04em;border-bottom:2px solid transparent;margin-bottom:-1px;transition:color .2s,border-color .2s}
    .tab.active{color:var(--text);border-bottom-color:var(--text)}
    /* panels */
    .panel{display:none;padding:1.5rem 1.25rem}
    .panel.active{display:block}
    /* panel header */
    .panel-head{display:flex;align-items:center;justify-content:space-between;margin-bottom:1.5rem}
    .panel-head h2{font-size:.9rem;font-weight:600}
    .btn-add{display:inline-flex;align-items:center;gap:.4rem;background:var(--accent);color:#0a0a0a;border:none;padding:.6rem 1.1rem;border-radius:8px;font-size:.8rem;font-weight:600;transition:opacity .18s}
    .btn-add:hover{opacity:.85}
    /* event list */
    .evt-list{display:flex;flex-direction:column;gap:.625rem}
    .evt-item{display:flex;align-items:center;gap:.875rem;background:var(--bg2);border:1px solid var(--border);border-radius:9px;padding:.75rem}
    .evt-thumb{width:48px;height:48px;border-radius:6px;object-fit:cover;background:var(--bg3);flex-shrink:0}
    .evt-thumb-ph{width:48px;height:48px;border-radius:6px;background:var(--bg3);flex-shrink:0;display:flex;align-items:center;justify-content:center;color:var(--text3)}
    .evt-info{flex:1;min-width:0}
    .evt-name{font-size:.85rem;font-weight:500;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
    .evt-slug{font-size:.7rem;color:var(--text3);font-family:monospace}
    .evt-actions{display:flex;gap:.375rem;flex-shrink:0}
    .icon-btn{background:none;border:1px solid var(--border);color:var(--text3);width:34px;height:34px;border-radius:7px;display:flex;align-items:center;justify-content:center;transition:border-color .2s,color .2s}
    .icon-btn:hover{border-color:#3a3a3a;color:var(--text)}
    .icon-btn.danger:hover{border-color:var(--red);color:var(--red)}
    .icon-btn.muted{opacity:.4}
    .metrics-nota{font-size:.75rem;color:var(--text3);line-height:1.5;margin:-.25rem 0 1rem;max-width:60ch}
    .metrics-resumo{display:flex;flex-wrap:wrap;gap:.5rem;margin-bottom:1rem}
    .resumo-card{flex:1 1 120px;background:var(--bg2);border:1px solid var(--border);border-radius:9px;padding:.7rem .8rem}
    .resumo-num{font-size:1.25rem;font-weight:600;line-height:1.1}
    .resumo-lab{font-size:.68rem;color:var(--text3);text-transform:uppercase;letter-spacing:.04em;margin-top:.15rem}
    .evt-item.hidden-evt .evt-name{color:var(--text3)}
    .icon-btn.pinned{border-color:#c0a060;color:#c0a060}
    /* Celular: as cinco ações ganham uma linha só para elas.
       A conta que obrigava a isto: 5 botões de 34px + 4 vãos = 194px, e
       .evt-actions era flex-shrink:0, então não cedia nunca. Com a miniatura
       (48px), os vãos e o respiro da caixa, sobravam ~66px para o título num
       aparelho de 360px — era o nome do projeto sumindo, não um detalhe de
       espaçamento.
       Consertado só no CSS, de propósito: a marcação da linha é gerada em DOIS
       lugares (servidor e redesenho no cliente) e qualquer correção feita na
       marcação teria de ser escrita duas vezes, com as duas cópias livres para
       divergir depois. Aqui não há o que sincronizar.
       Os 44px são o alvo de toque mínimo recomendado (WCAG 2.5.5); cabem porque
       agora a linha é inteira deles. */
    @media(max-width:599px){
      .evt-item{flex-wrap:wrap;gap:.625rem .75rem}
      .evt-actions{flex-basis:100%;justify-content:space-between;gap:.25rem}
      .icon-btn{width:44px;height:44px}
    }
    /* status badge */
    .status-badge{display:inline-block;font-size:.58rem;font-weight:600;letter-spacing:.08em;text-transform:uppercase;padding:.15rem .45rem;border-radius:3px;margin-left:.4rem;vertical-align:middle;border:1px solid currentColor;line-height:1.4}
    .st-em-edicao{color:#c8880a;background:rgba(200,136,10,.08)}
    .st-em-revisao{color:#4a8ac8;background:rgba(74,138,200,.08)}
    .st-entregue{color:#4a9a4a;background:rgba(74,154,74,.08)}
    .st-arquivado{color:#666;background:rgba(102,102,102,.08)}
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
    /* settings */
    .settings-card{background:var(--bg2);border:1px solid var(--border);border-radius:10px;padding:1.5rem;margin-bottom:1.25rem}
    .settings-card h3{font-size:.85rem;font-weight:600;margin-bottom:.25rem}
    .settings-card p{font-size:.78rem;color:var(--text3);margin-bottom:1.25rem;line-height:1.5}
    .danger-zone{background:var(--bg2);border:1px solid var(--red);border-radius:10px;padding:1.5rem;margin-top:1.5rem}
    .danger-zone h3{color:var(--red);font-size:.85rem;font-weight:600;display:flex;align-items:center;gap:.5rem;margin-bottom:.25rem}
    /* form overlay */
    .overlay{position:fixed;inset:0;background:rgba(0,0,0,.85);z-index:100;display:none;align-items:flex-end;justify-content:center}
    @media(min-width:600px){.overlay{align-items:center}}
    .overlay.open{display:flex}
    .sheet{background:var(--bg);width:100%;max-width:560px;max-height:92vh;border-radius:16px 16px 0 0;display:flex;flex-direction:column;overflow:hidden}
    @media(min-width:600px){.sheet{border-radius:16px;max-height:88vh}}
    .sheet-head{display:flex;align-items:center;justify-content:space-between;padding:1.25rem 1.25rem 1rem;border-bottom:1px solid var(--border);flex-shrink:0}
    .sheet-head h2{font-size:.95rem;font-weight:600}
    .sheet-body{flex:1;overflow-y:auto;padding:1.25rem;-webkit-overflow-scrolling:touch}
    .sheet-foot{padding:1rem 1.25rem;border-top:1px solid var(--border);display:flex;gap:.75rem;flex-shrink:0;position:sticky;bottom:0;background:var(--bg);z-index:1}
    /* form fields */
    .field{display:flex;flex-direction:column;gap:.45rem;margin-bottom:1.125rem}
    .field label{font-size:.7rem;font-weight:500;letter-spacing:.08em;text-transform:uppercase;color:var(--text3)}
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
    .toast{position:fixed;bottom:1.5rem;left:50%;transform:translateX(-50%) translateY(20px);background:#1e1e1e;border:1px solid #2e2e2e;color:var(--text);padding:.7rem 1.25rem;border-radius:8px;font-size:.82rem;opacity:0;transition:opacity .25s,transform .25s;z-index:200;pointer-events:none;white-space:nowrap}
    .toast.show{opacity:1;transform:translateX(-50%) translateY(0)}
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
    .cat-add input{flex:1;background:var(--bg2);border:1px solid var(--border);color:var(--text);padding:.6rem .75rem;border-radius:7px;font-size:.82rem;outline:none}
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
    .views-bar{position:absolute;left:.75rem;top:50%;transform:translateY(-50%);height:60%;background:#c0a060;opacity:.16;border-radius:3px;z-index:0;pointer-events:none}
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
    /* reduced motion */
    @media (prefers-reduced-motion: reduce){
      *,*::before,*::after{transition:none!important;animation-duration:.001ms!important;animation-iteration-count:1!important}
      .toast{transition:opacity .001ms!important}
      .spinner{animation:none!important;border-top-color:#0a0a0a;border-right-color:transparent}
    }
  </style>
</head>
<body>
  <div class="topbar">
    <div class="topbar-logo">fotos · <strong>Luca F. Chala</strong></div>
    <div class="topbar-right">
      <a href="/" target="_blank" class="btn-sm">Ver site</a>
      <form method="POST" action="/dashboard/logout" style="margin:0">
        <button type="submit" class="btn-sm">Sair</button>
      </form>
    </div>
  </div>

  <div class="tabs">
    <button class="tab active" onclick="switchTab('events',this)">Eventos</button>
    <button class="tab" onclick="switchTab('metrics',this)">Métricas</button>
    <button class="tab" onclick="switchTab('settings',this)">Config.</button>
    <button class="tab" id="tab-btn-requests" onclick="switchTab('requests',this)">Solicitações</button>
  </div>

  <!-- EVENTS TAB -->
  <div id="tab-events" class="panel active">
    <div class="panel-head">
      <h2 id="evt-count">${ssrCount}</h2>
      <div style="display:flex;gap:.5rem">
        <button class="btn-sm" id="mass-toggle" onclick="toggleMassMode()">Selecionar</button>
        <button class="btn-add" onclick="openForm()">
          <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
          Adicionar
        </button>
      </div>
    </div>
    <div class="search-row">
      <input type="search" id="evt-search" placeholder="Buscar por título, URL ou categoria…" oninput="renderEventList()" aria-label="Buscar eventos">
    </div>
    <div class="filter-row">
      <select id="status-filter" onchange="renderEventList()">
        <option value="todos" selected>Todos</option>
        <option value="ativos">Ativos (sem arquivados)</option>
        <option value="em-edicao">Em edição</option>
        <option value="em-revisao">Em revisão</option>
        <option value="entregue">Entregue</option>
        <option value="arquivado">Arquivado</option>
      </select>
      <select id="category-filter" onchange="renderEventList()" aria-label="Filtrar por categoria">${catFilterOptionsSSR}</select>
    </div>
    <div class="mass-bar" id="mass-bar" style="display:none">
      <label class="mass-selall"><input type="checkbox" id="mass-selall" onchange="toggleSelectAll(this.checked)"> Todos</label>
      <span id="mass-count">0 selecionados</span>
      <div class="mass-apply">
        <select id="mass-cat" aria-label="Categoria para aplicar">${catOptionsSSR}</select>
        <button class="btn-sm" onclick="applyMassCategory()">Aplicar</button>
        <select id="mass-access" aria-label="Tipo de acesso para aplicar">
          <option value="public">Público</option>
          <option value="private">Privado</option>
          <option value="family">Familiar</option>
        </select>
        <button class="btn-sm" onclick="applyMassAccess()">Aplicar</button>
      </div>
    </div>
    <div class="evt-list" id="evt-list">${ssrList}</div>
  </div>

  <!-- METRICS TAB -->
  <div id="tab-metrics" class="panel">
    <div class="panel-head">
      <h2>Visitantes</h2>
      <button class="btn-sm" id="metrics-export" onclick="exportMetricsCSV()" style="display:none">⬇ Exportar CSV</button>
    </div>
    <p class="metrics-nota">
      Conta <strong>visitante único por hora</strong>, não recarregamento: abrir a
      mesma página de novo no mesmo navegador não soma. Por isso o número não se
      mexe quando você testa recarregando — é assim de propósito.
    </p>
    <div id="metrics-resumo" class="metrics-resumo" hidden></div>
    <div id="metrics-body"><p class="empty">Carregando…</p></div>
  </div>


  <!-- SETTINGS TAB -->
  <div id="tab-settings" class="panel">
    <div class="settings-card">
      <h3>Categorias</h3>
      <p>Usadas para filtrar a galeria. Para aplicar uma categoria a vários eventos de uma vez, use o botão "Selecionar" na aba Eventos.</p>
      <div id="cat-list" class="cat-list"></div>
      <div class="cat-add">
        <input type="text" id="cat-new" placeholder="Nova categoria" maxlength="40" onkeydown="if(event.key==='Enter')createCategory()">
        <button class="btn-sm" onclick="createCategory()">Adicionar</button>
      </div>
    </div>
    <div class="settings-card">
      <h3>Backup dos dados</h3>
      <p style="margin-bottom:1rem">Baixe uma cópia completa dos seus eventos. O Drive é atualizado automaticamente a cada mudança — se configurado.</p>
      <button class="btn-sm" onclick="downloadBackup()">⬇ Baixar backup JSON</button>
    </div>
    <div class="settings-card">
      <h3>Exportar dados</h3>
      <p style="margin-bottom:1rem">Baixe planilhas CSV (compatíveis com Excel e Google Sheets) dos registros do site.</p>
      <div class="export-grid">
        <button class="btn-sm" onclick="exportConsentCSV()">⬇ Consentimentos (CSV)</button>
        <button class="btn-sm" onclick="exportRemovalCSV()">⬇ Solicitações de remoção (CSV)</button>
        <button class="btn-sm" onclick="exportMetricsCSV()">⬇ Métricas (CSV)</button>
      </div>
    </div>
    <div class="danger-zone">
      <h3>⚠️ Zona de perigo</h3>
      <p style="font-size:.8rem;color:var(--text2);margin-bottom:1rem">Ações abaixo exigem digitar uma palavra de confirmação.</p>
      <div class="field">
        <label>Nova senha</label>
        <input type="password" id="new-pass" placeholder="••••••••" autocomplete="new-password" minlength="${PASSWORD_MIN_LENGTH}">
        <p style="font-size:.72rem;color:var(--text3);margin-top:.4rem">Mínimo de ${PASSWORD_MIN_LENGTH} caracteres. Use três tipos de caractere (minúscula, maiúscula, número, símbolo) — ou uma frase com 20+ caracteres, que dispensa a mistura.</p>
      </div>
      <div class="field">
        <label>Confirmar senha</label>
        <input type="password" id="new-pass2" placeholder="••••••••" autocomplete="new-password" minlength="${PASSWORD_MIN_LENGTH}">
      </div>
      <button class="btn-danger" style="margin-top:.25rem;margin-bottom:1.5rem" onclick="changePassword()">Salvar nova senha</button>
      <div class="field">
        <label>Restaurar a partir de backup</label>
        <input type="file" id="restore-file" accept=".json" style="background:var(--bg3);border:1px solid var(--border);color:var(--text);padding:.6rem .75rem;border-radius:8px;font-size:.82rem;width:100%">
        <p style="font-size:.72rem;color:var(--text3);margin-top:.4rem">Nenhum dado atual será excluído. Eventos do backup são mesclados com os existentes.</p>
      </div>
      <button class="btn-danger" onclick="restoreBackup()">↩ Restaurar backup</button>
    </div>
  </div>

  <!-- REQUESTS TAB -->
  <div id="tab-requests" class="panel">
    <div class="panel-head"><h2>Solicitações de remoção</h2></div>
    <div id="requests-body"><p class="empty">Carregando…</p></div>
  </div>

  <!-- EVENT FORM OVERLAY -->
  <div class="overlay" id="overlay" onclick="overlayClick(event)">
    <div class="sheet" id="sheet" role="dialog" aria-modal="true" aria-labelledby="form-title">
      <div class="sheet-head">
        <h2 id="form-title">Adicionar evento</h2>
        <button class="icon-btn" onclick="closeForm()" aria-label="Fechar">
          <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
        </button>
      </div>
      <div class="sheet-body">
        <div class="field">
          <label>URL do projeto <span class="req-star">*</span> <span style="color:#555">(só letras minúsculas, números e -)</span></label>
          <div class="slug-prefix">
            <span>fotos.lucafchala.com/</span>
            <input type="text" id="f-slug" placeholder="meu-evento-2025" pattern="[a-z0-9][a-z0-9\\-]*[a-z0-9]|[a-z0-9]" maxlength="60">
          </div>
        </div>
        <div class="field">
          <label>Título <span class="req-star">*</span></label>
          <input type="text" id="f-title" placeholder="Ex: Formatura Turma 2025">
        </div>
        <div class="field">
          <label>Descrição completa <span style="color:#555">(aparece na página do projeto)</span></label>
          <textarea id="f-long" placeholder="Detalhes sobre o evento, contexto, etc."></textarea>
        </div>
        <div class="field">
          <label>Fotos de capa <span style="color:#555">(até 6)</span></label>
          <div class="field-hint" style="margin-bottom:.625rem">A primeira foto aparece como miniatura na galeria. Cole links do Drive ou URLs diretas de imagem — a conversão é automática.</div>
          <div class="photo-list" id="photo-list"></div>
          <div style="display:flex;gap:.5rem;flex-wrap:wrap;margin-top:.25rem">
            <button type="button" class="btn-add-photo" id="btn-add-photo" onclick="addPhotoInput('')">
              <svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
              Adicionar foto
            </button>
            <button type="button" class="btn-sm" id="btn-paste-photos" onclick="openPastePhotos()">📋 Colar vários links</button>
          </div>
          <div id="paste-photos-box" style="display:none;margin-top:.625rem">
            <textarea id="paste-photos-input" placeholder="Um link por linha" rows="4" style="width:100%"></textarea>
            <div style="display:flex;gap:.5rem;margin-top:.5rem">
              <button type="button" class="btn-sm" onclick="commitPastePhotos()">Adicionar</button>
              <button type="button" class="btn-sm" onclick="closePastePhotos()">Cancelar</button>
            </div>
          </div>
        </div>
        <div class="field">
          <label>Link da pasta do Google Drive <span class="req-star">*</span></label>
          <input type="url" id="f-drive" placeholder="https://drive.google.com/drive/folders/...">
        </div>
        <div class="field">
          <label>Link do Drive para o Instagram <span style="color:#555">(opcional)</span></label>
          <div class="field-hint" style="margin-bottom:.625rem">Pasta com as fotos já redimensionadas e prontas para o Instagram.</div>
          <input type="url" id="f-drive-ig" placeholder="https://drive.google.com/drive/folders/...">
        </div>
        <div class="field-row">
          <div class="field">
            <label>Data</label>
            <input type="date" id="f-date">
          </div>
          <div class="field">
            <label>Em colaboração com <span style="color:#555">(opcional — instituição, fotógrafo colaborador ou projeto)</span></label>
            <input type="text" id="f-credits" placeholder="Ex: Colégio Santa Cruz">
          </div>
        </div>
        <div class="field">
          <label>Link extra do projeto <span style="color:#555">(opcional)</span></label>
          <input type="url" id="f-purl" placeholder="https://...">
        </div>
        <div class="field-row">
          <div class="field">
            <label>Status de produção</label>
            <select id="f-status">
              <option value="em-edicao">Em edição</option>
              <option value="em-revisao">Em revisão</option>
              <option value="entregue" selected>Entregue</option>
              <option value="arquivado">Arquivado</option>
            </select>
          </div>
          <div class="field">
            <label>Categoria <span style="color:#555">(opcional)</span></label>
            <select id="f-category">${catOptionsSSR}</select>
          </div>
        </div>
        <div class="field">
          <label>Tipo de acesso</label>
          <select id="f-access">
            <option value="public" selected>Público</option>
            <option value="private">Privado</option>
            <option value="family">Familiar</option>
          </select>
          <div class="field-hint" style="margin-top:.5rem">Define a autodeclaração exigida no gateway antes de liberar o Drive. <strong>Público</strong>: só o aceite dos Termos. <strong>Privado/Familiar</strong>: o visitante também precisa declarar que é participante/autorizado ou membro da família.</div>
        </div>
        <div class="field">
          <label>Notas privadas <span style="color:#555">(só você vê)</span></label>
          <textarea id="f-notes" placeholder="Cliente, valor cobrado, observações, links de contrato…" rows="3"></textarea>
        </div>
        <div class="field">
          <div class="toggle-row">
            <span class="toggle-label">Visível na galeria</span>
            <label class="toggle">
              <input type="checkbox" id="f-visible" checked>
              <span class="toggle-track"></span>
            </label>
          </div>
        </div>
        <div class="field">
          <div class="toggle-row">
            <span class="toggle-label">Em breve <span style="color:var(--text3);font-size:.7rem;font-weight:400">(oculta as fotos)</span></span>
            <label class="toggle">
              <input type="checkbox" id="f-comingsoon">
              <span class="toggle-track"></span>
            </label>
          </div>
          <div class="field-hint" style="margin-top:.5rem">Quando ativo: o card na galeria e a página do projeto ficam visíveis, mas as fotos de capa são escondidas e o botão do Drive vira "As fotos virão em breve".</div>
        </div>
        <div class="field" style="border-top:1px solid var(--border);padding-top:1.125rem;margin-top:.25rem">
          <label>Aviso de novas fotos</label>
          <div class="toggle-row" style="margin-bottom:.75rem">
            <span style="font-size:.85rem;color:var(--text2)">Mostrar banner na página do projeto</span>
            <label class="toggle">
              <input type="checkbox" id="f-alert-active" onchange="toggleAlertOpts(this.checked)">
              <span class="toggle-track"></span>
            </label>
          </div>
          <div id="alert-opts" style="display:none">
            <div class="field-hint" style="margin-bottom:.625rem">Exibe "Novas fotos adicionadas há X" com o horário atual. Ao reativar o aviso, o contador reinicia.</div>
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
      </div>
      <div class="sheet-foot">
        <button class="btn-secondary" onclick="closeForm()">Cancelar</button>
        <button class="btn-primary" id="submit-btn" onclick="submitForm()">Salvar</button>
      </div>
    </div>
  </div>

  <div class="toast" id="toast"></div>

  <script nonce="${nonce}">
    let events = ${eventsJSON};
    let categories = ${categoriesJSON};
    let massMode = false;
    let selectedIds = new Set();
    let editingId = null;
    let metricsLoaded = false;
    let metricsData = [];
    let metricsSort = { key: 'views', dir: 'desc' };
    let photoList = [];
    // Declaradas aqui, junto do resto do estado, e nao la embaixo perto de
    // stashDraft(): restoreDraft() roda no init, que e ANTES do ponto onde
    // ficavam. Uma const nao e icada como uma function — a chamada morria numa
    // ReferenceError de zona morta temporal, engolida pelo try/catch do init,
    // e o rascunho simplesmente nunca voltava.
    // (Sem crase neste comentario: todo este script vive dentro de um template
    // literal, e uma crase solta encerra a string e quebra o modulo inteiro.)
    const DRAFT_KEY = 'fotos:draft';
    const DRAFT_MAX_AGE_MS = 3600000; // 1 h — rascunho velho demais confunde mais do que ajuda
    let requestsLoaded = false;
    let lastFocused = null;
    let formSnapshot = '';
    const STATUS_LABELS = { 'em-edicao': 'Em edição', 'em-revisao': 'Em revisão', 'entregue': 'Entregue', 'arquivado': 'Arquivado' };
    // Same ordering criterion as utils.sortEvents (pinned first, then date desc).
    const byDate = e => e.date ? new Date(e.date).getTime() : new Date(e.createdAt || 0).getTime();

    // ---- Init ----
    // Event delegation for evt-list buttons (works for both SSR and JS-rendered items)
    document.getElementById('evt-list').addEventListener('click', function(ev) {
      const btn = ev.target.closest('[data-action]');
      if (!btn) return;
      const { action, id } = btn.dataset;
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
    try { renderEventList(); } catch(e) { console.error('renderEventList:', e); }
    refreshCategorySelects();
    renderCategoryManager();
    loadRequests();
    // Depois de a lista existir: se a sessão expirou no meio de uma edição,
    // reabre o formulário com o que estava digitado.
    try { restoreDraft(); } catch(e) { console.error('restoreDraft:', e); }

    // ---- Tabs ----
    function switchTab(name, btn) {
      document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
      document.querySelectorAll('.panel').forEach(p => p.classList.remove('active'));
      btn.classList.add('active');
      document.getElementById('tab-' + name).classList.add('active');
      if (name === 'metrics') loadMetrics();
      if (name === 'requests' && !requestsLoaded) loadRequests();
    }

    // ---- Event List ----
    function renderEventList() {
      const list = document.getElementById('evt-list');
      const count = document.getElementById('evt-count');
      const filter = document.getElementById('status-filter')?.value || 'ativos';
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
          (filter === 'todos' || filter === 'ativos') ? '<p class="empty">Nenhum evento ainda. Clique em Adicionar.</p>' :
          \`<p class="empty">Nenhum evento com status "\${STATUS_LABELS[filter]}".</p>\`;
        return;
      }
      list.innerHTML = sorted.map(e => {
        const thumb = e.thumbnailUrl
          ? \`<img class="evt-thumb" src="\${esc(safeUrl(e.thumbnailUrl))}" alt="" onerror="this.style.display='none'">\`
          : \`<div class="evt-thumb-ph"><svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><rect x="3" y="5" width="18" height="15" rx="2"/><circle cx="12" cy="12" r="4"/><path d="M9 5l1.5-2h3L15 5"/></svg></div>\`;
        const eyeIcon = e.visible !== false
          ? \`<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>\`
          : \`<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M17.94 17.94A10.07 10.07 0 0112 20c-7 0-11-8-11-8a18.45 18.45 0 015.06-5.94M9.9 4.24A9.12 9.12 0 0112 4c7 0 11 8 11 8a18.5 18.5 0 01-2.16 3.19m-6.72-1.07a3 3 0 11-4.24-4.24"/><line x1="1" y1="1" x2="23" y2="23"/></svg>\`;
        const pinIcon = \`<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="\${e.pinned ? 'currentColor' : 'none'}" stroke="currentColor" stroke-width="2"><path d="M12 2l3 7h4l-3.5 5 1.5 7L12 18l-5 3 1.5-7L5 9h4z"/></svg>\`;
        const st = e.status || 'entregue';
        return \`<div class="evt-item\${e.visible === false ? ' hidden-evt' : ''}" id="evt-\${esc(e.id)}">
          \${massMode ? \`<input type="checkbox" class="evt-check" data-id="\${esc(e.id)}" \${selectedIds.has(e.id) ? 'checked' : ''}>\` : ''}
          \${thumb}
          <div class="evt-info">
            <div class="evt-name">\${esc(e.title)} <span class="status-badge st-\${esc(st)}">\${esc(STATUS_LABELS[st] || st)}</span></div>
            <div class="evt-slug">/\${esc(e.slug)}</div>
          </div>
          <div class="evt-actions">
            <button class="icon-btn \${e.pinned ? 'pinned' : ''}" data-action="pin" data-id="\${esc(e.id)}" title="\${e.pinned ? 'Remover destaque' : 'Destacar na galeria'}" aria-label="\${e.pinned ? 'Remover destaque' : 'Destacar na galeria'}">\${pinIcon}</button>
            <button class="icon-btn \${e.visible === false ? 'muted' : ''}" data-action="vis" data-id="\${esc(e.id)}" title="\${e.visible !== false ? 'Ocultar' : 'Mostrar'}" aria-label="\${e.visible !== false ? 'Ocultar' : 'Mostrar'}">\${eyeIcon}</button>
            <button class="icon-btn" data-action="edit" data-id="\${esc(e.id)}" title="Editar" aria-label="Editar">
              <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
            </button>
            <button class="icon-btn" data-action="dup" data-id="\${esc(e.id)}" title="Duplicar" aria-label="Duplicar">
              <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 01-2-2V4a2 2 0 012-2h9a2 2 0 012 2v1"/></svg>
            </button>
            <button class="icon-btn danger" data-action="del" data-id="\${esc(e.id)}" title="Excluir" aria-label="Excluir">
              <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14H6L5 6"/><path d="M10 11v6M14 11v6"/><path d="M9 6V4h6v2"/></svg>
            </button>
          </div>
        </div>\`;
      }).join('');
    }

    // ---- Form open/close ----
    // prefill (used by duplicateEvent) lets a "new event" form open pre-filled
    // from an existing event's data without treating it as an edit — id stays
    // null so submitForm() POSTs a new event instead of PUTing the source one.
    function openForm(id, prefill) {
      editingId = id || null;
      const e = id ? events.find(ev => ev.id === id) : (prefill || null);
      document.getElementById('form-title').textContent = id ? 'Editar evento' : 'Adicionar evento';
      document.getElementById('f-slug').value = e ? e.slug : '';
      document.getElementById('f-slug').readOnly = !!id;
      document.getElementById('f-slug').style.opacity = id ? '.5' : '1';
      document.getElementById('f-title').value = e ? (e.title || '') : '';
      document.getElementById('f-long').value = e ? (e.longDescription || '') : '';
      document.getElementById('f-drive').value = e ? (e.driveUrl || '') : '';
      document.getElementById('f-drive-ig').value = e ? (e.driveUrlInstagram || '') : '';
      document.getElementById('f-date').value = e ? (e.date || '') : '';
      document.getElementById('f-credits').value = e ? (e.eventCredits || '') : '';
      document.getElementById('f-purl').value = e ? (e.projectUrl || '') : '';
      document.getElementById('f-visible').checked = e ? (e.visible !== false) : true;
      document.getElementById('f-comingsoon').checked = e ? (e.comingSoon === true) : false;
      document.getElementById('f-status').value = e?.status || 'entregue';
      document.getElementById('f-access').value = e?.accessType || 'public';
      document.getElementById('f-category').value = e?.category || '';
      document.getElementById('f-notes').value = e?.internalNotes || '';
      const alertActive = e?.photosAlert?.active === true;
      document.getElementById('f-alert-active').checked = alertActive;
      document.getElementById('f-alert-active').dataset.wasActive = alertActive ? '1' : '0';
      document.getElementById('f-alert-expires').value = String(e?.photosAlert?.expiresAfterHours ?? 24);
      toggleAlertOpts(alertActive);
      const initPhotos = e
        ? (Array.isArray(e.photos) && e.photos.length ? e.photos : e.thumbnailUrl ? [e.thumbnailUrl] : [])
        : [];
      photoList = [...initPhotos];
      renderPhotoList();
      closePastePhotos();
      lastFocused = document.activeElement;
      document.getElementById('overlay').classList.add('open');
      document.body.style.overflow = 'hidden';
      if (!id) setTimeout(() => document.getElementById('f-slug').focus(), 100);
      formSnapshot = snapshotForm();
    }

    // Reads the exact same fields submitForm() reads into its save payload
    // (plus photoList) — keep the two in sync: any field added to one belongs
    // in the other.
    function snapshotForm() {
      const val = id => document.getElementById(id)?.value ?? '';
      const chk = id => document.getElementById(id)?.checked ?? false;
      return JSON.stringify({
        title: val('f-title'), long: val('f-long'), drive: val('f-drive'),
        driveIg: val('f-drive-ig'), date: val('f-date'), credits: val('f-credits'), purl: val('f-purl'),
        visible: chk('f-visible'), comingSoon: chk('f-comingsoon'), status: val('f-status'),
        accessType: val('f-access'), category: val('f-category'), notes: val('f-notes'),
        alertActive: chk('f-alert-active'), alertExpires: val('f-alert-expires'),
        photos: photoList,
      });
    }
    function isFormDirty() {
      return document.getElementById('overlay').classList.contains('open') && snapshotForm() !== formSnapshot;
    }

    // ---- Rascunho de emergência (sessão expirada) ----
    // A sessão agora morre por inatividade (2 h), e não só pelo teto de 24 h.
    // Isso é melhor para a segurança e pior para quem estava no meio de uma
    // edição: o api() manda para o login no 401, e sem isto tudo que estava
    // digitado ia embora junto. Perder o trabalho de alguém para expirar uma
    // sessão é um péssimo negócio — então o rascunho vai para o
    // sessionStorage antes do redirect e volta depois do login.
    //
    // sessionStorage e não localStorage: o rascunho pode conter notas internas,
    // e ele deve morrer junto com a aba, não ficar no disco. Reaproveita
    // snapshotForm(), que já é a fonte da verdade do que compõe o formulário.
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
      set('f-drive-ig', f.driveIg); set('f-date', f.date); set('f-credits', f.credits);
      set('f-purl', f.purl); set('f-status', f.status); set('f-access', f.accessType);
      set('f-category', f.category); set('f-notes', f.notes); set('f-alert-expires', f.alertExpires);
      setChk('f-visible', f.visible); setChk('f-comingsoon', f.comingSoon);
      setChk('f-alert-active', f.alertActive);
      toggleAlertOpts(!!f.alertActive);
      if (Array.isArray(f.photos)) { photoList = [...f.photos]; renderPhotoList(); }
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

    function overlayClick(e) {
      if (e.target === document.getElementById('overlay')) closeForm();
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
        const focusable = sheet.querySelectorAll('a[href],button:not([disabled]),input:not([disabled]),select:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex="-1"])');
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
                oninput="onPhotoInput(\${i}, this)"
                onblur="onPhotoBlur(\${i}, this)">
              \${i === 0 ? '' : \`<img class="photo-mini" id="pm-\${i}" src="\${esc(url)}" \${url ? 'style="display:block"' : ''} onerror="this.style.display='none'" onload="this.style.display='block'">\`}
              <button type="button" class="icon-btn danger" onclick="removePhotoInput(\${i})" title="Remover" aria-label="Remover foto">
                <svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
              </button>
            </div>
            \${i === 0 ? '<span class="photo-badge">capa da galeria</span>' : ''}
            \${i === 0 ? \`<img class="photo-cover-preview" id="pcover" src="\${esc(url)}" \${url ? 'style="display:block"' : ''} alt="" onerror="this.style.display='none'" onload="this.style.display='block'">\` : ''}
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
        return toast('URL inválida. Use só letras minúsculas, números e hífens.', 'err');
      }
      if (!title) return toast('O título é obrigatório.', 'err');
      if (!drive) return toast('O link do Google Drive é obrigatório.', 'err');

      if (!editingId) {
        const conflict = events.find(e => e.slug === slug);
        if (conflict) return toast('Já existe um evento com essa URL.', 'err');
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
        date: document.getElementById('f-date').value,
        eventCredits: document.getElementById('f-credits').value.trim(),
        projectUrl: document.getElementById('f-purl').value.trim(),
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
          };
        })(),
      };

      const btn = document.getElementById('submit-btn');
      btn.disabled = true;
      btn.innerHTML = '<span class="spinner" aria-hidden="true"></span>Salvando…';

      try {
        if (editingId) {
          const updated = await api('PUT', '/api/events/' + editingId, body);
          events = events.map(e => e.id === editingId ? updated : e);
          toast('Evento atualizado!', 'ok');
        } else {
          const created = await api('POST', '/api/events', body);
          events.push(created);
          toast('Evento adicionado!', 'ok');
        }
        renderEventList();
        closeForm(true);
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
    // Opens the "add event" form pre-filled from an existing event — same shoot
    // config (drive links, category, access type, credits, photos), fresh slug
    // required, never pinned (server enforces a single pinned event, so cloning
    // a pinned one as pinned would silently unpin the original on save).
    function duplicateEvent(id) {
      const e = events.find(ev => ev.id === id);
      if (!e) return;
      openForm(null, { ...e, title: e.title + ' (cópia)', slug: '', pinned: false });
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
        const tabBtn = document.getElementById('tab-btn-requests');
        if (tabBtn) tabBtn.innerHTML = 'Solicitações' + (pending > 0 ? \`<span class="tab-badge">\${pending}</span>\` : '');
        if (!data.length) { container.innerHTML = '<p class="empty">Nenhuma solicitação ainda.</p>'; return; }

        const methodLabel = { number: 'Número da foto', url: 'Link da foto', upload: 'Arquivo enviado' };

        const renderReq = r => \`
          <div class="req-item \${r.resolved ? 'resolved' : ''}" id="req-\${r.id}">
            <div class="req-header">
              <span class="req-badge \${r.resolved ? '' : 'pending'}">\${r.resolved ? 'resolvido' : 'pendente'}</span>
              <span class="req-date">\${new Date(r.createdAt).toLocaleDateString('pt-BR')}</span>
            </div>
            <div class="req-body">
              <span><strong>Tipo:</strong> \${esc(methodLabel[r.method] || r.method)}</span>
              \${r.value ? \`<span><strong>Identificação:</strong> \${esc(r.value)}</span>\` : ''}
              \${r.method === 'upload' ? \`<span><strong>Arquivo:</strong> \${esc(r.fileName || '—')} (por e-mail)</span>\` : ''}
              \${r.email ? \`<span><strong>E-mail:</strong> \${esc(r.email)}</span>\` : ''}
              \${r.phone ? \`<span><strong>Telefone:</strong> \${esc(r.phone)}</span>\` : ''}
              \${!r.email && !r.phone && r.contact ? \`<span><strong>Contato:</strong> \${esc(r.contact)}</span>\` : ''}
              \${r.message ? \`<span><strong>Mensagem:</strong> \${esc(r.message)}</span>\` : ''}
              \${r.emailStatus ? \`<span style="font-size:.7rem;margin-top:.25rem;color:\${r.emailStatus === 'sent' ? '#4a9a4a' : '#b04040'}">📧 \${esc(r.emailStatus)}</span>\` : ''}
              \${r.confirmEmailStatus === 'sent' ? '<span style="font-size:.7rem;color:#4a9a4a">✉️ confirmação enviada</span>' : r.confirmEmailStatus ? \`<span style="font-size:.7rem;color:#b04040">✉️ \${esc(r.confirmEmailStatus)}</span>\` : ''}
              \${r.resolvedEmailStatus === 'sent' ? '<span style="font-size:.7rem;color:#4a9a4a">✅ aviso de resolução enviado</span>' : r.resolvedEmailStatus ? \`<span style="font-size:.7rem;color:#b04040">✅ \${esc(r.resolvedEmailStatus)}</span>\` : ''}
            </div>
            \${!r.resolved ? \`<button class="btn-resolve" onclick="resolveRequest('\${r.id}')">✓ Marcar como resolvido</button>\` : ''}
          </div>\`;

        // Group by project, sorted by most recent first within each group
        const byProject = {};
        const projectOrder = [];
        [...data].sort((a, b) => b.createdAt.localeCompare(a.createdAt)).forEach(r => {
          if (!byProject[r.eventSlug]) {
            byProject[r.eventSlug] = { title: r.eventTitle, slug: r.eventSlug, pending: [], resolved: [] };
            projectOrder.push(r.eventSlug);
          }
          (r.resolved ? byProject[r.eventSlug].resolved : byProject[r.eventSlug].pending).push(r);
        });

        container.innerHTML = projectOrder.map((slug, gi) => {
          const g = byProject[slug];
          const resolvedHTML = g.resolved.length > 0 ? \`
            <button class="req-resolved-toggle" onclick="toggleResolved(\${gi})" id="rtoggle-\${gi}">▶ \${g.resolved.length} resolvida\${g.resolved.length !== 1 ? 's' : ''}</button>
            <div id="ritems-\${gi}" style="display:none">\${g.resolved.map(renderReq).join('')}</div>\` : '';
          return \`<div class="req-group">
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

    async function resolveRequest(id) {
      try {
        await api('PUT', '/api/removal-requests/' + id + '/resolve');
        await loadRequests();
        toast('Solicitação marcada como resolvida.', 'ok');
      } catch(err) {
        toast(err.message || 'Erro.', 'err');
      }
    }

    // ---- Metrics ----
    async function loadMetrics() {
      const body = document.getElementById('metrics-body');
      const exportBtn = document.getElementById('metrics-export');
      try {
        const data = await api('GET', '/api/metrics');
        metricsLoaded = true;
        metricsData = Array.isArray(data) ? data : [];
        if (exportBtn) exportBtn.style.display = metricsData.length ? 'inline-flex' : 'none';
        if (!metricsData.length) {
          body.innerHTML = '<p class="empty">Nenhuma visualização ainda.</p>';
          return;
        }
        renderMetrics();
      } catch(err) {
        if (exportBtn) exportBtn.style.display = 'none';
        body.innerHTML = '<p class="empty">Erro ao carregar métricas.</p>';
      }
    }

    function renderMetrics() {
      const body = document.getElementById('metrics-body');
      const key = metricsSort.key;
      const dir = metricsSort.dir === 'asc' ? 1 : -1;
      const num = (m, k) => k === 'driveClicks' ? (m.driveClicks || 0) : (m.views || 0);
      const rowsData = [...metricsData].sort((a, b) => (num(a, key) - num(b, key)) * dir);
      const maxViews = metricsData.reduce((mx, m) => Math.max(mx, m.views || 0), 0) || 1;
      const ind = k => k === metricsSort.key ? \`<span class="sort-ind">\${metricsSort.dir === 'asc' ? '▲' : '▼'}</span>\` : '';
      const rows = rowsData.map(m => {
        const pct = Math.max(2, Math.round((m.views || 0) / maxViews * 100));
        return \`<tr>
          <td>\${esc(m.title)}<br><span style="font-size:.7rem;color:var(--text3)">/\${esc(m.slug)}</span></td>
          <td class="views-cell"><span class="views-bar" style="width:\${pct}%"></span><span class="views-badge">\${m.views || 0}</span></td>
          <td><span class="views-badge" style="color:#4a7a4a">\${m.driveClicks || 0}</span></td>
          <td><span class="views-badge" style="color:var(--text3)">\${(m.views || 0) ? Math.round(taxa(m) * 100) + '%' : '—'}</span></td>
        </tr>\`;
      }).join('');
      body.innerHTML = \`<table class="metrics-table"><thead><tr>
        <th>Projeto</th>
        <th class="sortable" onclick="sortMetrics('views')" title="Visitantes únicos por hora">Visitantes\${ind('views')}</th>
        <th class="sortable" onclick="sortMetrics('driveClicks')" title="Quantos abriram o link do Drive">Abriu Drive\${ind('driveClicks')}</th>
        <th class="sortable" onclick="sortMetrics('taxa')" title="Abriu Drive ÷ visitantes">Taxa\${ind('taxa')}</th>
      </tr></thead><tbody>\${rows}</tbody></table>\`;
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
      // O mínimo vem da MESMA constante que o servidor usa (PASSWORD_MIN_LENGTH
      // em security.js), interpolada aqui. Antes o cliente dizia 6 e o servidor
      // exigia 12: a pessoa digitava uma senha, passava na checagem local e
      // levava um erro diferente do outro lado. Regra duplicada é regra que
      // diverge; interpolar a constante mantém as duas em sincronia.
      // As regras finas (classes, padrões previsíveis) ficam só no servidor, que
      // é a autoridade — a mensagem específica dele chega via toast.
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
        toast('Restaurado: ' + res.added + ' adicionados, ' + res.updated + ' atualizados.', 'ok');
        setTimeout(() => window.location.reload(), 1800);
      } catch(err) {
        toast(err.message || 'Erro ao restaurar.', 'err');
      }
    }

    // ---- CSV helpers (BOM + escaping, matches server) ----
    function toCSV(cols, rows){
      function cell(v){ v = (v==null?'':String(v)); return /[",\\r\\n]/.test(v) ? '"'+v.replace(/"/g,'""')+'"' : v; }
      return '\\uFEFF' + [cols.join(',')].concat(rows.map(function(r){ return cols.map(function(c){ return cell(r[c]); }).join(','); })).join('\\r\\n') + '\\r\\n';
    }
    function downloadCSV(name, cols, rows){ var b=new Blob([toCSV(cols,rows)],{type:'text/csv;charset=utf-8'}); var u=URL.createObjectURL(b); var a=document.createElement('a'); a.href=u; a.download=name; document.body.appendChild(a); a.click(); a.remove(); setTimeout(function(){URL.revokeObjectURL(u);},1000); }
    function csvDate(){ return new Date().toISOString().slice(0,10); }

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
        if (newPinned) {
          events.forEach(e => { e.pinned = e.id === id; });
        } else {
          ev.pinned = false;
        }
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
      document.getElementById('mass-toggle').textContent = massMode ? 'Cancelar' : 'Selecionar';
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
        // Session expired — send them back to login instead of firing a confusing
        // "Não autorizado" toast on every subsequent action. Antes de sair,
        // guarda o que estava sendo editado: com o corte por inatividade, este
        // caminho passou a ser alcançável no meio de uma edição.
        stashDraft();
        window.location.href = '/dashboard';
        throw new Error(data.error || 'Sessão expirada.');
      }
      if (!res.ok) throw new Error(data.error || 'Erro ' + res.status);
      return data;
    }

    // ---- Escape ----
    // Mirror of the canonical 5-char escaper (utils.js). Defined locally because
    // this runs in the browser, where the module import is not available. Must
    // also escape ' since client-rendered values land in single-quoted attributes.
    function esc(s) {
      // Mirror utils.js exactly: only null/undefined become ''. The old
      // truthiness check also swallowed the number 0, rendering it as an empty
      // cell in the metrics table (0 views showed blank instead of "0").
      if (s === null || s === undefined) return '';
      return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#x27;');
    }

    // Espelho do safeUrl/toHttps de utils.js, pelo mesmo motivo do esc() acima:
    // isto roda no browser, onde não há import de módulo.
    //
    // Vem em par com o esc(), nunca sozinho — é o contrato documentado em
    // utils.js: esc() fecha o atributo mas NÃO mata o esquema, e safeUrl() mata
    // o esquema mas devolve URL crua, que pode conter aspas. Um esquema
    // javascript: guardado no KV por um restore de backup (que mescla
    // verbatim) precisa dos dois para não ficar a um clique da execução.
    function safeUrl(u) {
      if (typeof u !== 'string') return '';
      const v = u.startsWith('http://') ? 'https://' + u.slice(7) : u;
      // Comparação de prefixo em vez de regex: uma barra escapada dentro de
      // um literal de template vira ruído de escape que o linter reprova, e o
      // teste é o mesmo.
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
