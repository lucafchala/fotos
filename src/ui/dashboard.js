import { escape } from '../utils.js';

const BASE = `
*,*::before,*::after{box-sizing:border-box;margin:0;padding:0}
:root{--bg:#0d0d0d;--bg2:#141414;--bg3:#1a1a1a;--border:#222;--text:#f0ebe5;--text2:#999;--text3:#555;--accent:#f0ebe5;--red:#c0392b;--green:#27ae60;--radius:10px}
body{font-family:'Inter',sans-serif;background:var(--bg);color:var(--text);min-height:100vh;-webkit-text-size-adjust:100%}
input,textarea,select,button{font-family:inherit;font-size:inherit}
button{cursor:pointer}
`;

export function loginHTML(opts = {}) {
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
  <title>Dashboard · fotos</title>
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
    <div class="logo"><span>fotos · <strong>luca fchala</strong></span></div>
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

export function dashboardHTML(events) {
  const eventsJSON = JSON.stringify(events).replace(/</g, '\\u003c').replace(/>/g, '\\u003e');

  return `<!DOCTYPE html>
<html lang="pt-BR">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Dashboard · fotos</title>
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
    .evt-item.hidden-evt .evt-name{color:var(--text3)}
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
    /* form overlay */
    .overlay{position:fixed;inset:0;background:rgba(0,0,0,.85);z-index:100;display:none;align-items:flex-end;justify-content:center}
    @media(min-width:600px){.overlay{align-items:center}}
    .overlay.open{display:flex}
    .sheet{background:var(--bg);width:100%;max-width:560px;max-height:92vh;border-radius:16px 16px 0 0;display:flex;flex-direction:column;overflow:hidden}
    @media(min-width:600px){.sheet{border-radius:16px;max-height:88vh}}
    .sheet-head{display:flex;align-items:center;justify-content:space-between;padding:1.25rem 1.25rem 1rem;border-bottom:1px solid var(--border);flex-shrink:0}
    .sheet-head h2{font-size:.95rem;font-weight:600}
    .sheet-body{flex:1;overflow-y:auto;padding:1.25rem;-webkit-overflow-scrolling:touch}
    .sheet-foot{padding:1rem 1.25rem;border-top:1px solid var(--border);display:flex;gap:.75rem;flex-shrink:0}
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
    /* thumb preview */
    .thumb-preview{width:100%;aspect-ratio:3/4;max-height:180px;object-fit:cover;border-radius:8px;margin-top:.625rem;display:none;background:var(--bg3)}
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
    /* info box */
    .info-box{background:var(--bg3);border:1px solid var(--border);border-radius:9px;padding:1rem 1.125rem;font-size:.78rem;color:var(--text3);line-height:1.65;margin-bottom:1.25rem}
    .info-box strong{color:var(--text2)}
    /* field row */
    .field-row{display:grid;grid-template-columns:1fr 1fr;gap:.875rem}
  </style>
</head>
<body>
  <div class="topbar">
    <div class="topbar-logo">fotos · <strong>luca fchala</strong></div>
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
  </div>

  <!-- EVENTS TAB -->
  <div id="tab-events" class="panel active">
    <div class="panel-head">
      <h2 id="evt-count"></h2>
      <button class="btn-add" onclick="openForm()">
        <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
        Adicionar
      </button>
    </div>
    <div class="evt-list" id="evt-list"></div>
  </div>

  <!-- METRICS TAB -->
  <div id="tab-metrics" class="panel">
    <div class="panel-head"><h2>Visualizações</h2></div>
    <div id="metrics-body"><p class="empty">Carregando…</p></div>
  </div>

  <!-- SETTINGS TAB -->
  <div id="tab-settings" class="panel">
    <div class="settings-card">
      <h3>Alterar senha</h3>
      <p>Recomendado usar algo fácil de lembrar mas difícil de adivinhar.</p>
      <div class="field">
        <label>Nova senha</label>
        <input type="password" id="new-pass" placeholder="••••••••" autocomplete="new-password">
      </div>
      <div class="field">
        <label>Confirmar senha</label>
        <input type="password" id="new-pass2" placeholder="••••••••" autocomplete="new-password">
      </div>
      <button class="btn-primary" style="margin-top:.25rem" onclick="changePassword()">Salvar nova senha</button>
    </div>
  </div>

  <!-- EVENT FORM OVERLAY -->
  <div class="overlay" id="overlay" onclick="overlayClick(event)">
    <div class="sheet" id="sheet">
      <div class="sheet-head">
        <h2 id="form-title">Adicionar evento</h2>
        <button class="icon-btn" onclick="closeForm()">
          <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
        </button>
      </div>
      <div class="sheet-body">
        <div class="field">
          <label>URL do projeto <span style="color:#555">(só letras minúsculas, números e -)</span></label>
          <div class="slug-prefix">
            <span>fotos.lucafchala.com/</span>
            <input type="text" id="f-slug" placeholder="meu-evento-2025" pattern="[a-z0-9][a-z0-9\\-]*[a-z0-9]|[a-z0-9]" maxlength="60">
          </div>
        </div>
        <div class="field">
          <label>Título</label>
          <input type="text" id="f-title" placeholder="Ex: Formatura Turma 2025">
        </div>
        <div class="field">
          <label>Descrição curta <span style="color:#555">(aparece no card)</span></label>
          <input type="text" id="f-short" placeholder="Resumo em 1-2 frases" maxlength="150">
        </div>
        <div class="field">
          <label>Descrição completa <span style="color:#555">(aparece na página do projeto)</span></label>
          <textarea id="f-long" placeholder="Detalhes sobre o evento, contexto, etc."></textarea>
        </div>
        <div class="field">
          <label>Miniatura</label>
          <input type="url" id="f-thumb" placeholder="Cole o link do Google Drive ou qualquer URL de imagem" oninput="updateThumbPreview(this.value)">
          <div class="field-hint">
            Para usar imagem do Drive: abra o arquivo → botão direito → "Obter link" → "Qualquer pessoa com o link" → copie.<br>
            <strong>A URL é convertida automaticamente.</strong>
          </div>
          <img id="thumb-preview" class="thumb-preview" alt="Pré-visualização" onerror="this.style.display='none'">
        </div>
        <div class="field">
          <label>Link da pasta do Google Drive</label>
          <input type="url" id="f-drive" placeholder="https://drive.google.com/drive/folders/...">
        </div>
        <div class="field-row">
          <div class="field">
            <label>Data</label>
            <input type="date" id="f-date">
          </div>
          <div class="field">
            <label>Créditos do evento <span style="color:#555">(opcional)</span></label>
            <input type="text" id="f-credits" placeholder="Ex: Evento: Formatura XYZ">
          </div>
        </div>
        <div class="field">
          <label>Link extra do projeto <span style="color:#555">(opcional)</span></label>
          <input type="url" id="f-purl" placeholder="https://...">
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
      </div>
      <div class="sheet-foot">
        <button class="btn-secondary" onclick="closeForm()">Cancelar</button>
        <button class="btn-primary" id="submit-btn" onclick="submitForm()">Salvar</button>
      </div>
    </div>
  </div>

  <div class="toast" id="toast"></div>

  <script>
    let events = ${eventsJSON};
    let editingId = null;
    let metricsLoaded = false;

    // ---- Init ----
    renderEventList();

    // ---- Tabs ----
    function switchTab(name, btn) {
      document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
      document.querySelectorAll('.panel').forEach(p => p.classList.remove('active'));
      btn.classList.add('active');
      document.getElementById('tab-' + name).classList.add('active');
      if (name === 'metrics' && !metricsLoaded) loadMetrics();
    }

    // ---- Event List ----
    function renderEventList() {
      const list = document.getElementById('evt-list');
      const count = document.getElementById('evt-count');
      const sorted = [...events].sort((a, b) => (b.date || '').localeCompare(a.date || ''));
      count.textContent = events.length === 1 ? '1 evento' : events.length + ' eventos';
      if (sorted.length === 0) {
        list.innerHTML = '<p class="empty">Nenhum evento ainda. Clique em Adicionar.</p>';
        return;
      }
      list.innerHTML = sorted.map(e => {
        const thumb = e.thumbnailUrl
          ? \`<img class="evt-thumb" src="\${esc(e.thumbnailUrl)}" alt="" onerror="this.style.display='none'">\`
          : \`<div class="evt-thumb-ph"><svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><rect x="3" y="5" width="18" height="15" rx="2"/><circle cx="12" cy="12" r="4"/><path d="M9 5l1.5-2h3L15 5"/></svg></div>\`;
        const eyeIcon = e.visible !== false
          ? \`<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>\`
          : \`<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M17.94 17.94A10.07 10.07 0 0112 20c-7 0-11-8-11-8a18.45 18.45 0 015.06-5.94M9.9 4.24A9.12 9.12 0 0112 4c7 0 11 8 11 8a18.5 18.5 0 01-2.16 3.19m-6.72-1.07a3 3 0 11-4.24-4.24"/><line x1="1" y1="1" x2="23" y2="23"/></svg>\`;
        return \`<div class="evt-item\${e.visible === false ? ' hidden-evt' : ''}" id="evt-\${e.id}">
          \${thumb}
          <div class="evt-info">
            <div class="evt-name">\${esc(e.title)}</div>
            <div class="evt-slug">/\${esc(e.slug)}</div>
          </div>
          <div class="evt-actions">
            <button class="icon-btn \${e.visible === false ? 'muted' : ''}" title="\${e.visible !== false ? 'Ocultar' : 'Mostrar'}" onclick="toggleVisible('\${e.id}')">\${eyeIcon}</button>
            <button class="icon-btn" title="Editar" onclick="openForm('\${e.id}')">
              <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
            </button>
            <button class="icon-btn danger" title="Excluir" onclick="deleteEvent('\${e.id}')">
              <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14H6L5 6"/><path d="M10 11v6M14 11v6"/><path d="M9 6V4h6v2"/></svg>
            </button>
          </div>
        </div>\`;
      }).join('');
    }

    // ---- Form open/close ----
    function openForm(id) {
      editingId = id || null;
      const e = id ? events.find(ev => ev.id === id) : null;
      document.getElementById('form-title').textContent = id ? 'Editar evento' : 'Adicionar evento';
      document.getElementById('f-slug').value = e ? e.slug : '';
      document.getElementById('f-slug').readOnly = !!id;
      document.getElementById('f-slug').style.opacity = id ? '.5' : '1';
      document.getElementById('f-title').value = e ? (e.title || '') : '';
      document.getElementById('f-short').value = e ? (e.shortDescription || '') : '';
      document.getElementById('f-long').value = e ? (e.longDescription || '') : '';
      document.getElementById('f-thumb').value = e ? (e.thumbnailUrl || '') : '';
      document.getElementById('f-drive').value = e ? (e.driveUrl || '') : '';
      document.getElementById('f-date').value = e ? (e.date || '') : '';
      document.getElementById('f-credits').value = e ? (e.eventCredits || '') : '';
      document.getElementById('f-purl').value = e ? (e.projectUrl || '') : '';
      document.getElementById('f-visible').checked = e ? (e.visible !== false) : true;
      updateThumbPreview(e ? (e.thumbnailUrl || '') : '');
      document.getElementById('overlay').classList.add('open');
      document.body.style.overflow = 'hidden';
      if (!id) setTimeout(() => document.getElementById('f-slug').focus(), 100);
    }

    function closeForm() {
      document.getElementById('overlay').classList.remove('open');
      document.body.style.overflow = '';
      editingId = null;
    }

    function overlayClick(e) {
      if (e.target === document.getElementById('overlay')) closeForm();
    }

    // ---- Thumb preview ----
    function updateThumbPreview(raw) {
      const url = convertDriveUrl(raw.trim());
      const input = document.getElementById('f-thumb');
      const preview = document.getElementById('thumb-preview');
      if (url !== raw.trim() && raw.trim()) {
        input.value = url;
      }
      if (url) {
        preview.src = url;
        preview.style.display = 'block';
      } else {
        preview.style.display = 'none';
      }
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

      const body = {
        slug,
        title,
        shortDescription: document.getElementById('f-short').value.trim(),
        longDescription: document.getElementById('f-long').value.trim(),
        thumbnailUrl: document.getElementById('f-thumb').value.trim(),
        driveUrl: drive,
        date: document.getElementById('f-date').value,
        eventCredits: document.getElementById('f-credits').value.trim(),
        projectUrl: document.getElementById('f-purl').value.trim(),
        visible: document.getElementById('f-visible').checked,
      };

      const btn = document.getElementById('submit-btn');
      btn.disabled = true;
      btn.textContent = 'Salvando…';

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
        closeForm();
      } catch(err) {
        toast(err.message || 'Erro ao salvar.', 'err');
      } finally {
        btn.disabled = false;
        btn.textContent = 'Salvar';
      }
    }

    // ---- Delete ----
    async function deleteEvent(id) {
      const e = events.find(ev => ev.id === id);
      if (!e) return;
      if (!confirm(\`Excluir "\${e.title}"? Essa ação não pode ser desfeita.\`)) return;
      try {
        await api('DELETE', '/api/events/' + id);
        events = events.filter(ev => ev.id !== id);
        renderEventList();
        toast('Evento excluído.', 'ok');
      } catch(err) {
        toast(err.message || 'Erro ao excluir.', 'err');
      }
    }

    // ---- Toggle visible ----
    async function toggleVisible(id) {
      const e = events.find(ev => ev.id === id);
      if (!e) return;
      const updated = { ...e, visible: e.visible === false ? true : false };
      try {
        const result = await api('PUT', '/api/events/' + id, updated);
        events = events.map(ev => ev.id === id ? result : ev);
        renderEventList();
        toast(result.visible !== false ? 'Evento visível.' : 'Evento oculto.', 'ok');
      } catch(err) {
        toast(err.message || 'Erro.', 'err');
      }
    }

    // ---- Metrics ----
    async function loadMetrics() {
      const body = document.getElementById('metrics-body');
      try {
        const data = await api('GET', '/api/metrics');
        metricsLoaded = true;
        if (!data.length) {
          body.innerHTML = '<p class="empty">Nenhuma visualização ainda.</p>';
          return;
        }
        const rows = data.map(m => \`<tr><td>\${esc(m.title)}<br><span style="font-size:.7rem;color:var(--text3)">/\${esc(m.slug)}</span></td><td><span class="views-badge">\${m.views}</span></td></tr>\`).join('');
        body.innerHTML = \`<table class="metrics-table"><thead><tr><th>Projeto</th><th>Visualizações</th></tr></thead><tbody>\${rows}</tbody></table>\`;
      } catch(err) {
        body.innerHTML = '<p class="empty">Erro ao carregar métricas.</p>';
      }
    }

    // ---- Change password ----
    async function changePassword() {
      const p1 = document.getElementById('new-pass').value;
      const p2 = document.getElementById('new-pass2').value;
      if (!p1) return toast('Digite a nova senha.', 'err');
      if (p1 !== p2) return toast('As senhas não coincidem.', 'err');
      if (p1.length < 6) return toast('Senha muito curta (mínimo 6 caracteres).', 'err');
      try {
        await api('PUT', '/api/settings/password', { password: p1 });
        document.getElementById('new-pass').value = '';
        document.getElementById('new-pass2').value = '';
        toast('Senha alterada com sucesso!', 'ok');
      } catch(err) {
        toast(err.message || 'Erro ao alterar senha.', 'err');
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
      if (!res.ok) throw new Error(data.error || 'Erro ' + res.status);
      return data;
    }

    // ---- Escape ----
    function esc(s) {
      if (!s) return '';
      return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
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
