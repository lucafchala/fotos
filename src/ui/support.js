import { escape, footerLegalLinksHTML } from '../utils.js';
import { honeypotFieldHTML, HONEYPOT_CSS } from '../security.js';

export function supportHTML(sent = false, error = '', values = {}, nonce = '', formToken = '') {
  return `<!DOCTYPE html>
<html lang="pt-BR">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <link rel="icon" type="image/svg+xml" href="/icon.svg">
  <link rel="apple-touch-icon" href="/icon.svg">
  <meta name="theme-color" content="#0a0a0a">
  <title>Suporte · fotos</title>
  <meta name="description" content="Entre em contato com Luca F. Chala">
  <!-- Microsoft Clarity: replace PROJECT_ID with your Clarity project ID -->
  <!-- <script type="text/javascript">
    (function(c,l,a,r,i,t,y){
        c[a]=c[a]||function(){(c[a].q=c[a].q||[]).push(arguments)};
        t=l.createElement(r);t.async=1;t.src="https://www.clarity.ms/tag/"+i;
        y=l.getElementsByTagName(r)[0];y.parentNode.insertBefore(t,y);
    })(window, document, "clarity", "script", "PROJECT_ID");
  </script> -->
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link href="https://fonts.googleapis.com/css2?family=Inter:ital,wght@0,300;0,400;0,500;0,600;1,300&display=swap" rel="stylesheet">
  <script nonce="${nonce}" src="https://challenges.cloudflare.com/turnstile/v0/api.js" async defer onerror="window.__supTsBlocked=true"></script>
  <style>
    *,*::before,*::after{box-sizing:border-box;margin:0;padding:0}
    :root{
      --bg-page:#0a0a0a; --text:#f0ebe5; --text-2:#b0a89e; --text-muted:#999; --text-dim:#666; --text-dim-2:#555;
      --border-dim:#1c1c1c; --border-hair:#141414; --footer-link:#888; --accent:#c0a060;
      --bg-input:#0d0d0d; --text-ph:#333; --cta-bg:#c0a060; --cta-text:#0a0a0a;
      --ok-bg:#0a120a; --ok-border:#1a2e1a; --ok-text:#4a8a4a; --ok-border-hover:#2a4a2a; --ok-text-hover:#6aaa6a; --ok-bg-hover:#0a120a;
      --err-bg:#1a0a0a; --err-border:#2e1a1a; --err-text:#aa5555;
      --warn-bg:#1d1606; --warn-border:#4a3a12; --warn-text:#d8b25a; --warn-text-strong:#f0d080;
      --btn-border:#2a2a2a; --btn-text:#888; --btn-border-hover:#555; --btn-text-hover:#ccc; --btn-bg-hover:#111;
      --divider-text:#2a2a2a; --divider-line:#1a1a1a;
    }
    @media (prefers-color-scheme: light) {
      :root{
        --bg-page:#f0ece8; --text:#1a1715; --text-2:#4a4744; --text-muted:#6b6460; --text-dim:#8a8480; --text-dim-2:#9a9490;
        --border-dim:#ddd9d4; --border-hair:#e5e1db; --footer-link:#6b6460; --accent:#8a6428;
        --bg-input:#fff; --text-ph:#9a9490; --cta-bg:#8a6428; --cta-text:#faf7f3;
        --ok-bg:#eaf6ea; --ok-border:#b8dab8; --ok-text:#2e7d32; --ok-border-hover:#8fc491; --ok-text-hover:#1b5e20; --ok-bg-hover:#eaf6ea;
        --err-bg:#fdecec; --err-border:#f2c6c6; --err-text:#b3261e;
        --warn-bg:#fdf3dc; --warn-border:#e8d1a0; --warn-text:#7a5a17; --warn-text-strong:#5c4310;
        --btn-border:#ddd9d4; --btn-text:#6b6460; --btn-border-hover:#b8b2ab; --btn-text-hover:#332d28; --btn-bg-hover:#fff;
        --divider-text:#c8c2ba; --divider-line:#ddd9d4;
      }
    }
    body{font-family:'Inter',sans-serif;background:var(--bg-page);color:var(--text);min-height:100vh}
    :focus-visible{outline:2px solid var(--accent);outline-offset:2px}
    ${HONEYPOT_CSS}
    header{padding:1.25rem 1.5rem}
    .back{display:inline-flex;align-items:center;gap:.35rem;text-decoration:none;color:var(--text-dim-2);font-size:.8rem;letter-spacing:.04em;transition:color .2s}
    .back:hover{color:var(--text-2)}
    .back svg{width:14px;height:14px}
    main{max-width:520px;margin:0 auto;padding:2rem 1.5rem 6rem}
    h1{font-size:1.4rem;font-weight:600;margin-bottom:.4rem}
    .subtitle{font-size:.85rem;color:var(--text-dim);margin-bottom:2rem;line-height:1.6}
    .contact-row{display:flex;gap:.75rem;margin-bottom:2.5rem;flex-wrap:wrap}
    .contact-btn{display:inline-flex;align-items:center;gap:.5rem;padding:.65rem 1.2rem;border-radius:8px;font-size:.82rem;font-weight:500;text-decoration:none;letter-spacing:.02em;transition:border-color .2s,color .2s,background .2s;white-space:nowrap;border:1px solid}
    .btn-whatsapp{border-color:var(--ok-border);color:var(--ok-text)}
    .btn-whatsapp:hover{border-color:var(--ok-border-hover);color:var(--ok-text-hover);background:var(--ok-bg-hover)}
    .btn-email{border-color:var(--btn-border);color:var(--btn-text)}
    .btn-email:hover{border-color:var(--btn-border-hover);color:var(--btn-text-hover);background:var(--btn-bg-hover)}
    .contact-btn svg{width:14px;height:14px;flex-shrink:0}
    .divider{display:flex;align-items:center;gap:.75rem;margin-bottom:1.75rem;color:var(--divider-text);font-size:.72rem;letter-spacing:.1em;text-transform:uppercase}
    .divider::before,.divider::after{content:'';flex:1;height:1px;background:var(--divider-line)}
    form{display:flex;flex-direction:column;gap:1rem}
    label{font-size:.8rem;font-weight:500;color:var(--footer-link);letter-spacing:.04em;display:block;margin-bottom:.3rem}
    input,textarea{width:100%;background:var(--bg-input);border:1px solid var(--border-dim);border-radius:8px;color:var(--text);font-family:inherit;font-size:.875rem;padding:.75rem 1rem;outline:none;transition:border-color .2s;resize:none}
    input::placeholder,textarea::placeholder{color:var(--text-ph)}
    input:focus,textarea:focus{border-color:var(--text-dim-2)}
    textarea{min-height:120px}
    .submit-btn{background:var(--cta-bg);color:var(--cta-text);border:none;border-radius:8px;padding:.8rem 1.5rem;font-size:.875rem;font-weight:600;cursor:pointer;transition:opacity .18s;align-self:flex-start}
    .submit-btn:hover{opacity:.88}
    .success{background:var(--ok-bg);border:1px solid var(--ok-border);color:var(--ok-text);padding:1rem 1.25rem;border-radius:8px;font-size:.875rem;line-height:1.6}
    .error-msg{background:var(--err-bg);border:1px solid var(--err-border);color:var(--err-text);padding:.75rem 1rem;border-radius:8px;font-size:.82rem}
    .adblock-warn{background:var(--warn-bg);border:1px solid var(--warn-border);color:var(--warn-text);padding:.75rem 1rem;border-radius:8px;font-size:.8rem;line-height:1.55}
    .adblock-warn strong{color:var(--warn-text-strong)}
    .adblock-warn button{background:none;border:none;color:var(--warn-text-strong);text-decoration:underline;cursor:pointer;font:inherit;padding:0}
    .noscript-banner{background:var(--warn-bg);border:1px solid var(--warn-border);color:var(--warn-text);padding:.85rem 1rem;border-radius:8px;font-size:.8rem;line-height:1.55;margin-bottom:1.75rem}
    .noscript-banner strong{color:var(--warn-text-strong)}
    footer{text-align:center;padding:2rem 1rem;border-top:1px solid var(--border-hair)}
    footer a{color:var(--footer-link);font-size:.8rem;text-decoration:none;letter-spacing:.12em;transition:color .2s}
    footer a:hover{color:var(--text-2)}
    .footer-actions-legal{display:flex;align-items:center;gap:1.25rem;flex-wrap:wrap;justify-content:center;margin-top:.5rem}
    .legal-link{display:inline-flex;align-items:center;gap:.4rem;color:var(--footer-link);font-size:.8rem;text-decoration:none;letter-spacing:.1em;transition:color .2s}
    .legal-link:hover{color:var(--text-2)}
    .footer-copyright{font-size:.75rem;color:var(--footer-link);letter-spacing:.03em;text-align:center;width:100%;margin-top:.5rem;display:block}
  </style>
</head>
<body>
  <header>
    <a href="/" class="back">
      <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="15 18 9 12 15 6"/></svg>
      Voltar
    </a>
  </header>
  <main>
    <h1>Suporte</h1>
    <p class="subtitle">Dúvidas, solicitações ou problemas? Escolha como prefere falar comigo.</p>

    <div class="contact-row">
      <a href="https://wa.me/5511989211178" target="_blank" rel="noopener" class="contact-btn btn-whatsapp">
        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor"><path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413z"/></svg>
        WhatsApp
      </a>
      <a href="mailto:suporte@lucafchala.com" class="contact-btn btn-email">
        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="2" y="4" width="20" height="16" rx="2"/><polyline points="2,4 12,13 22,4"/></svg>
        suporte@lucafchala.com
      </a>
    </div>

    <noscript>
      <div class="noscript-banner">
        O formulário precisa de <strong>JavaScript</strong> ativado e do bloqueador de anúncios desativado. Sem isso, use o <strong>WhatsApp</strong> ou o e-mail acima para falar comigo.
      </div>
    </noscript>

    <div class="divider">ou envie uma mensagem</div>

    ${sent ? `<div class="success">Mensagem enviada! Entrarei em contato em breve.</div>` : `
    ${error ? `<div class="error-msg">${escape(error)}</div>` : ''}
    <form method="POST" action="/api/suporte">
      <!-- Token assinado no servidor ao renderizar esta página. Prova que o
           envio veio de um formulário nosso e não de um POST direto, e o piso
           de idade (3 s) derruba automação que preenche instantaneamente. -->
      <input type="hidden" name="form_token" value="${escape(formToken || '')}">
      ${honeypotFieldHTML()}
      <div>
        <label for="name">Nome (opcional)</label>
        <input type="text" id="name" name="name" placeholder="Seu nome" maxlength="120" autocomplete="name" value="${escape(values.name || '')}">
      </div>
      <div>
        <label for="email">E-mail <span style="color:var(--text-dim-2)">(para resposta)</span></label>
        <input type="email" id="email" name="email" placeholder="seu@email.com" maxlength="200" autocomplete="email" value="${escape(values.email || '')}">
      </div>
      <div>
        <label for="message">Mensagem *</label>
        <textarea id="message" name="message" placeholder="Descreva sua dúvida ou solicitação…" maxlength="2000" required>${escape(values.message || '')}</textarea>
      </div>
      <div>
        <label style="display:flex;align-items:flex-start;gap:.5rem;cursor:pointer;font-size:.8rem;color:var(--footer-link);line-height:1.5;font-weight:400;letter-spacing:0">
          <input type="checkbox" id="support-consent" name="consent" value="1" required style="width:16px;height:16px;accent-color:var(--text);flex-shrink:0;margin-top:1px">
          <span>Li e concordo com a <a href="/privacidade" target="_blank" rel="noopener" style="color:var(--text-muted)">política de privacidade</a> e os <a href="/termos" target="_blank" rel="noopener" style="color:var(--text-muted)">termos de uso</a>, e autorizo o uso dos meus dados para responder ao contato.</span>
        </label>
      </div>
      <div id="support-adblock" class="adblock-warn" style="display:none;margin-bottom:.5rem">
        <strong>⚠️ Bloqueador de anúncios detectado.</strong> A verificação de segurança não carregou. Desative o bloqueador para este site e ative o JavaScript (caso esteja desativado), depois <button type="button" onclick="location.reload()">recarregue a página</button>, ou use o WhatsApp/e-mail acima.
      </div>
      <div class="cf-turnstile" data-sitekey="0x4AAAAAADg-tbuoPRO9s2I5" data-callback="onTurnstileSuccess" data-error-callback="onTurnstileError" style="margin-bottom:.5rem"></div>
      <button type="submit" class="submit-btn" id="support-submit" disabled>Enviar mensagem</button>
    </form>
    <script nonce="${nonce}">
      function supportBtn(){return document.getElementById('support-submit');}
      function showSupportAdblock(){var w=document.getElementById('support-adblock');if(w)w.style.display='';}
      function onTurnstileSuccess(){var b=supportBtn();if(b)b.disabled=false;}
      // A widget error must not strand the visitor on a dead button — re-enable it
      // so they can still try (the server validates the token and replies clearly),
      // and warn that an ad-blocker is the likely cause.
      function onTurnstileError(){var b=supportBtn();if(b)b.disabled=false;showSupportAdblock();}
      // Same safety net if the Turnstile script itself is blocked or never loads.
      if(window.__supTsBlocked)showSupportAdblock();
      setTimeout(function(){if(typeof turnstile==='undefined'||window.__supTsBlocked){showSupportAdblock();var b=supportBtn();if(b&&b.disabled)b.disabled=false;}},5000);
      // Guard against a double submit on the native form post.
      (function(){var f=document.querySelector('form[action="/api/suporte"]');if(f)f.addEventListener('submit',function(){var b=supportBtn();if(b){b.disabled=true;b.textContent='Enviando…';}});})();
    </script>`}
  </main>
  <footer>
    <a href="/">fotos · lucafchala</a>
    ${footerLegalLinksHTML()}
  </footer>
</body>
</html>`;
}
