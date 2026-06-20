// Static "Sobre" (About) page — mirrors privacy.js structure (same head, dark
// theme, back link, footer). No dynamic content, so no escaping is needed.
// The copy below is a placeholder the owner can edit freely.
export function aboutHTML() {
  return `<!DOCTYPE html>
<html lang="pt-BR">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <link rel="icon" type="image/svg+xml" href="/icon.svg">
  <link rel="apple-touch-icon" href="/icon.svg">
  <meta name="theme-color" content="#0a0a0a">
  <title>Sobre · fotos</title>
  <meta name="description" content="Sobre Luca F. Chala — fotografia de formaturas, casamentos, ensaios e eventos">
  <link rel="canonical" href="https://fotos.lucafchala.com/sobre">
  <meta property="og:type" content="profile">
  <meta property="og:title" content="Sobre · Luca F. Chala">
  <meta property="og:description" content="Fotografia de formaturas, casamentos, ensaios e eventos">
  <meta property="og:url" content="https://fotos.lucafchala.com/sobre">
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link href="https://fonts.googleapis.com/css2?family=Inter:ital,wght@0,300;0,400;0,500;0,600;1,300&display=swap" rel="stylesheet">
  <style>
    *,*::before,*::after{box-sizing:border-box;margin:0;padding:0}
    body{font-family:'Inter',sans-serif;background:#0a0a0a;color:#f0ebe5;min-height:100vh}
    :focus-visible{outline:2px solid #c0a060;outline-offset:2px}
    header{padding:1.25rem 1.5rem}
    .back{display:inline-flex;align-items:center;gap:.35rem;text-decoration:none;color:#555;font-size:.78rem;letter-spacing:.04em;transition:color .2s}
    .back:hover{color:#bbb}
    .back svg{width:14px;height:14px}
    main{max-width:680px;margin:0 auto;padding:2rem 1.5rem 6rem}
    h1{font-size:1.5rem;font-weight:600;margin-bottom:.4rem}
    .tagline{font-size:.85rem;color:#666;margin-bottom:2.25rem;letter-spacing:.02em}
    h2{font-size:1rem;font-weight:600;margin:2.25rem 0 .75rem;color:#e0d8d0}
    p,li{font-size:.9rem;line-height:1.75;color:#b0a89e}
    p{margin-bottom:.75rem}
    ul{margin:.25rem 0 .75rem;padding-left:1.25rem}
    li{margin-bottom:.4rem}
    strong{color:#d0c8be;font-weight:600}
    a{color:#c0a060;text-decoration:none}
    a:hover{text-decoration:underline}
    .intro{font-size:.92rem;color:#999;line-height:1.7;margin-bottom:.5rem}
    .cta{display:flex;gap:.75rem;flex-wrap:wrap;margin-top:1.25rem}
    .cta-btn{display:inline-flex;align-items:center;gap:.5rem;padding:.65rem 1.2rem;border-radius:8px;font-size:.82rem;font-weight:500;text-decoration:none;letter-spacing:.02em;transition:border-color .2s,color .2s,background .2s;white-space:nowrap;border:1px solid}
    .cta-btn:hover{text-decoration:none}
    .btn-whatsapp{border-color:#1a2e1a;color:#4a8a4a}
    .btn-whatsapp:hover{border-color:#2a4a2a;color:#6aaa6a;background:#0a120a}
    .btn-default{border-color:#2a2a2a;color:#888}
    .btn-default:hover{border-color:#555;color:#ccc;background:#111}
    .cta-btn svg{width:14px;height:14px;flex-shrink:0}
    .note{font-size:.82rem;color:#666;line-height:1.6;border-left:2px solid #1e1e1e;padding-left:1rem;margin:1.5rem 0 0}
    footer{text-align:center;padding:2rem 1rem;border-top:1px solid #141414;display:flex;gap:1.5rem;justify-content:center;flex-wrap:wrap}
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
    <h1>Sobre</h1>
    <p class="tagline">Luca F. Chala · fotografia de formaturas, casamentos, ensaios e eventos</p>

    <p class="intro">Olá! Sou <strong>Luca F. Chala</strong>, fotógrafo. Registro formaturas, casamentos,
    ensaios e eventos com um olhar atento aos momentos que costumam passar despercebidos — as risadas,
    os abraços e os detalhes que tornam cada história única.</p>

    <h2>Como eu trabalho</h2>
    <p>Cada projeto começa com uma conversa para entender o que você imagina. No dia, procuro ser
    discreto e deixar tudo acontecer com naturalidade. Depois, faço uma curadoria e edição cuidadosa
    de cada imagem antes da entrega.</p>
    <ul>
      <li><strong>Conversa inicial</strong> — alinhamos data, local, expectativas e estilo.</li>
      <li><strong>Cobertura do evento</strong> — registro espontâneo, sem interromper o que importa.</li>
      <li><strong>Edição e curadoria</strong> — seleção e tratamento de cada foto.</li>
      <li><strong>Entrega digital</strong> — as fotos ficam disponíveis aqui mesmo, em galeria própria.</li>
    </ul>

    <h2>Equipamento</h2>
    <p>Trabalho com equipamento profissional de câmera e iluminação, sempre adaptado ao tipo de evento —
    do ambiente controlado de um ensaio à luz imprevisível de uma festa.</p>

    <h2>Vamos conversar?</h2>
    <p>Para orçamentos, datas disponíveis ou qualquer dúvida, fale comigo. Respondo o mais rápido que conseguir.</p>
    <div class="cta">
      <a href="https://wa.me/5511989211178" target="_blank" rel="noopener" class="cta-btn btn-whatsapp">
        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor"><path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413z"/></svg>
        WhatsApp
      </a>
      <a href="https://instagram.com/lucafchala" target="_blank" rel="noopener" class="cta-btn btn-default">
        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="2" y="2" width="20" height="20" rx="5"/><circle cx="12" cy="12" r="4"/><line x1="17.5" y1="6.5" x2="17.51" y2="6.5"/></svg>
        @lucafchala
      </a>
      <a href="/suporte" class="cta-btn btn-default">
        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="2" y="4" width="20" height="16" rx="2"/><polyline points="2,4 12,13 22,4"/></svg>
        Enviar mensagem
      </a>
    </div>

    <p class="note">As fotos dos eventos ficam na <a href="/">galeria</a>. Para pedir a remoção de uma
    imagem, use o botão no rodapé da página de cada evento — é gratuito e simples.</p>
  </main>
  <footer>
    <a href="/">fotos · lucafchala</a>
    <a href="/privacidade">Privacidade</a>
    <a href="/termos">Termos</a>
    <a href="/suporte">Suporte</a>
  </footer>
</body>
</html>`;
}
