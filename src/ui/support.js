function esc(s) {
  return String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#x27;');
}

export function supportHTML(sent = false, error = '') {
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
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link href="https://fonts.googleapis.com/css2?family=Inter:ital,wght@0,300;0,400;0,500;0,600;1,300&display=swap" rel="stylesheet">
  <script src="https://challenges.cloudflare.com/turnstile/v0/api.js" async defer></script>
  <style>
    *,*::before,*::after{box-sizing:border-box;margin:0;padding:0}
    body{font-family:'Inter',sans-serif;background:#0a0a0a;color:#f0ebe5;min-height:100vh}
    :focus-visible{outline:2px solid #c0a060;outline-offset:2px}
    header{padding:1.25rem 1.5rem}
    .back{display:inline-flex;align-items:center;gap:.35rem;text-decoration:none;color:#555;font-size:.78rem;letter-spacing:.04em;transition:color .2s}
    .back:hover{color:#bbb}
    .back svg{width:14px;height:14px}
    main{max-width:520px;margin:0 auto;padding:2rem 1.5rem 6rem}
    h1{font-size:1.4rem;font-weight:600;margin-bottom:.4rem}
    .subtitle{font-size:.85rem;color:#666;margin-bottom:2rem;line-height:1.6}
    .contact-row{display:flex;gap:.75rem;margin-bottom:2.5rem;flex-wrap:wrap}
    .contact-btn{display:inline-flex;align-items:center;gap:.5rem;padding:.65rem 1.2rem;border-radius:8px;font-size:.82rem;font-weight:500;text-decoration:none;letter-spacing:.02em;transition:border-color .2s,color .2s,background .2s;white-space:nowrap;border:1px solid}
    .btn-whatsapp{border-color:#1a2e1a;color:#4a8a4a}
    .btn-whatsapp:hover{border-color:#2a4a2a;color:#6aaa6a;background:#0a120a}
    .btn-email{border-color:#2a2a2a;color:#888}
    .btn-email:hover{border-color:#555;color:#ccc;background:#111}
    .contact-btn svg{width:14px;height:14px;flex-shrink:0}
    .divider{display:flex;align-items:center;gap:.75rem;margin-bottom:1.75rem;color:#2a2a2a;font-size:.72rem;letter-spacing:.1em;text-transform:uppercase}
    .divider::before,.divider::after{content:'';flex:1;height:1px;background:#1a1a1a}
    form{display:flex;flex-direction:column;gap:1rem}
    label{font-size:.78rem;font-weight:500;color:#888;letter-spacing:.04em;display:block;margin-bottom:.3rem}
    input,textarea{width:100%;background:#0d0d0d;border:1px solid #1c1c1c;border-radius:8px;color:#f0ebe5;font-family:inherit;font-size:.875rem;padding:.75rem 1rem;outline:none;transition:border-color .2s;resize:none}
    input::placeholder,textarea::placeholder{color:#333}
    input:focus,textarea:focus{border-color:#333}
    textarea{min-height:120px}
    .submit-btn{background:#f0ebe5;color:#0a0a0a;border:none;border-radius:8px;padding:.8rem 1.5rem;font-size:.875rem;font-weight:600;cursor:pointer;transition:opacity .18s;align-self:flex-start}
    .submit-btn:hover{opacity:.88}
    .success{background:#0a120a;border:1px solid #1a2e1a;color:#4a8a4a;padding:1rem 1.25rem;border-radius:8px;font-size:.875rem;line-height:1.6}
    .error-msg{background:#1a0a0a;border:1px solid #2e1a1a;color:#aa5555;padding:.75rem 1rem;border-radius:8px;font-size:.82rem}
    footer{text-align:center;padding:2rem 1rem;border-top:1px solid #141414}
    footer a{color:#3a3a3a;font-size:.75rem;text-decoration:none;letter-spacing:.12em;transition:color .2s}
    footer a:hover{color:#777}
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
    <p class="subtitle">Dúvidas, solicitações ou problemas? Escolha como prefere entrar em contato.</p>

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

    <div class="divider">ou envie uma mensagem</div>

    ${sent ? `<div class="success">Mensagem enviada! Entrarei em contato em breve.</div>` : `
    ${error ? `<div class="error-msg">${esc(error)}</div>` : ''}
    <form method="POST" action="/api/suporte">
      <div>
        <label for="name">Nome (opcional)</label>
        <input type="text" id="name" name="name" placeholder="Seu nome" maxlength="120" autocomplete="name">
      </div>
      <div>
        <label for="email">E-mail <span style="color:#555">(para resposta)</span></label>
        <input type="email" id="email" name="email" placeholder="seu@email.com" maxlength="200" autocomplete="email">
      </div>
      <div>
        <label for="message">Mensagem *</label>
        <textarea id="message" name="message" placeholder="Descreva sua dúvida ou solicitação…" maxlength="2000" required></textarea>
      </div>
      <div>
        <label style="display:flex;align-items:flex-start;gap:.5rem;cursor:pointer;font-size:.72rem;color:#888;line-height:1.5;font-weight:400;letter-spacing:0">
          <input type="checkbox" id="support-consent" name="consent" value="1" required style="width:16px;height:16px;accent-color:#f0ebe5;flex-shrink:0;margin-top:1px">
          <span>Li e concordo com a <a href="/privacidade" target="_blank" rel="noopener" style="color:#aaa">política de privacidade</a> e os <a href="/termos" target="_blank" rel="noopener" style="color:#aaa">termos de uso</a>, e autorizo o uso dos meus dados para responder ao contato.</span>
        </label>
      </div>
      <div class="cf-turnstile" data-sitekey="0x4AAAAAADg-tbuoPRO9s2I5" data-callback="onTurnstileSuccess" style="margin-bottom:.5rem"></div>
      <button type="submit" class="submit-btn" id="support-submit" disabled>Enviar mensagem</button>
    </form>
    <script>function onTurnstileSuccess(){var b=document.getElementById('support-submit');if(b)b.disabled=false;}</script>`}
  </main>
  <footer>
    <a href="/">fotos · lucafchala</a>
    <a href="/privacidade" style="margin-left:1.5rem">Privacidade</a>
    <a href="/termos" style="margin-left:1.5rem">Termos</a>
  </footer>
</body>
</html>`;
}
