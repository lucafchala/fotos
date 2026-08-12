import { footerLegalLinksHTML } from '../utils.js';

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
  <meta name="description" content="Sobre Luca F. Chala, fotografia de formaturas, casamentos, ensaios e eventos">
  <link rel="canonical" href="https://fotos.lucafchala.com/sobre">
  <!-- Microsoft Clarity: replace PROJECT_ID with your Clarity project ID -->
  <!-- <script type="text/javascript">
    (function(c,l,a,r,i,t,y){
        c[a]=c[a]||function(){(c[a].q=c[a].q||[]).push(arguments)};
        t=l.createElement(r);t.async=1;t.src="https://www.clarity.ms/tag/"+i;
        y=l.getElementsByTagName(r)[0];y.parentNode.insertBefore(t,y);
    })(window, document, "clarity", "script", "PROJECT_ID");
  </script> -->
  <meta property="og:type" content="profile">
  <meta property="og:title" content="Sobre · Luca F. Chala">
  <meta property="og:description" content="Fotografia de formaturas, casamentos, ensaios e eventos">
  <meta property="og:url" content="https://fotos.lucafchala.com/sobre">
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link href="https://fonts.googleapis.com/css2?family=Inter:ital,wght@0,300;0,400;0,500;0,600;1,300&display=swap" rel="stylesheet">
  <style>
    *,*::before,*::after{box-sizing:border-box;margin:0;padding:0}
    :root{
      --bg-page:#0a0a0a; --text:#f0ebe5; --text-2:#b0a89e; --text-heading:#e0d8d0; --text-strong:#d0c8be;
      --text-muted:#999; --text-dim:#666; --text-dim-2:#555; --border-dim:#1e1e1e; --border-hair:#141414;
      --footer-link:#888; --accent:#c0a060;
      --ok-border:#1a2e1a; --ok-text:#4a8a4a; --ok-border-hover:#2a4a2a; --ok-text-hover:#6aaa6a; --ok-bg-hover:#0a120a;
      --btn-border:#2a2a2a; --btn-text:#888; --btn-border-hover:#555; --btn-text-hover:#ccc; --btn-bg-hover:#111;
    }
    @media (prefers-color-scheme: light) {
      :root{
        --bg-page:#f0ece8; --text:#1a1715; --text-2:#4a4744; --text-heading:#2a2521; --text-strong:#332d28;
        --text-muted:#6b6460; --text-dim:#8a8480; --text-dim-2:#9a9490; --border-dim:#ddd9d4; --border-hair:#e5e1db;
        --footer-link:#6b6460; --accent:#8a6428;
        --ok-border:#b8dab8; --ok-text:#2e7d32; --ok-border-hover:#8fc491; --ok-text-hover:#1b5e20; --ok-bg-hover:#eaf6ea;
        --btn-border:#ddd9d4; --btn-text:#6b6460; --btn-border-hover:#b8b2ab; --btn-text-hover:#332d28; --btn-bg-hover:#fff;
      }
    }
    body{font-family:'Inter',sans-serif;background:var(--bg-page);color:var(--text);min-height:100vh}
    :focus-visible{outline:2px solid var(--accent);outline-offset:2px}
    header{padding:1.25rem 1.5rem}
    .back{display:inline-flex;align-items:center;gap:.35rem;text-decoration:none;color:var(--text-dim-2);font-size:.8rem;letter-spacing:.04em;transition:color .2s}
    .back:hover{color:var(--text-2)}
    .back svg{width:14px;height:14px}
    main{max-width:680px;margin:0 auto;padding:2rem 1.5rem 6rem}
    h1{font-size:1.5rem;font-weight:600;margin-bottom:.4rem}
    .tagline{font-size:.85rem;color:var(--text-muted);margin-bottom:2.25rem;letter-spacing:.02em}
    h2{font-size:1rem;font-weight:600;margin:2.25rem 0 .75rem;color:var(--text-heading)}
    p,li{font-size:.9rem;line-height:1.75;color:var(--text-2)}
    p{margin-bottom:.75rem}
    ul{margin:.25rem 0 .75rem;padding-left:1.25rem}
    li{margin-bottom:.4rem}
    strong{color:var(--text-strong);font-weight:600}
    a{color:var(--accent);text-decoration:none}
    a:hover{text-decoration:underline}
    .intro{font-size:.92rem;color:var(--text-muted);line-height:1.7;margin-bottom:.5rem}
    .cta{display:flex;gap:.75rem;flex-wrap:wrap;margin-top:1.25rem}
    .cta-btn{display:inline-flex;align-items:center;gap:.5rem;padding:.65rem 1.2rem;border-radius:8px;font-size:.82rem;font-weight:500;text-decoration:none;letter-spacing:.02em;transition:border-color .2s,color .2s,background .2s;white-space:nowrap;border:1px solid}
    .cta-btn:hover{text-decoration:none}
    .btn-whatsapp{border-color:var(--ok-border);color:var(--ok-text)}
    .btn-whatsapp:hover{border-color:var(--ok-border-hover);color:var(--ok-text-hover);background:var(--ok-bg-hover)}
    .btn-default{border-color:var(--btn-border);color:var(--btn-text)}
    .btn-default:hover{border-color:var(--btn-border-hover);color:var(--btn-text-hover);background:var(--btn-bg-hover)}
    .cta-btn svg{width:14px;height:14px;flex-shrink:0}
    .note{font-size:.82rem;color:var(--text-dim);line-height:1.6;border-left:2px solid var(--border-dim);padding-left:1rem;margin:1.5rem 0 0}
    footer{text-align:center;padding:2rem 1rem;border-top:1px solid var(--border-hair);display:flex;gap:1.5rem;justify-content:center;flex-wrap:wrap}
    footer a{color:var(--footer-link);font-size:.8rem;text-decoration:none;letter-spacing:.12em;transition:color .2s}
    footer a:hover{color:var(--text-2)}
    .footer-actions-legal{display:flex;align-items:center;gap:1.25rem;flex-wrap:wrap;justify-content:center}
    .legal-link{display:inline-flex;align-items:center;gap:.4rem;color:var(--footer-link);font-size:.8rem;text-decoration:none;letter-spacing:.1em;transition:color .2s}
    .legal-link:hover{color:var(--text-2)}
    .footer-copyright{font-size:.75rem;color:var(--footer-link);letter-spacing:.03em;text-align:center;width:100%;margin-top:.5rem}
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
    ensaios e eventos com um olhar atento aos momentos que costumam passar despercebidos: as risadas,
    os abraços e os detalhes que tornam cada história única.</p>

    <h2>Como eu trabalho</h2>
    <p>Cada projeto começa com uma conversa para entender o que você imagina. No dia, procuro ser
    discreto e deixar tudo acontecer com naturalidade. Depois, faço uma curadoria e edição cuidadosa
    de cada imagem antes da entrega.</p>
    <ul>
      <li><strong>Conversa inicial:</strong> alinhamos data, local, expectativas e estilo.</li>
      <li><strong>Cobertura do evento:</strong> registro espontâneo, sem interromper o que importa.</li>
      <li><strong>Edição e curadoria:</strong> seleção e tratamento de cada foto.</li>
      <li><strong>Entrega digital:</strong> as fotos ficam disponíveis aqui mesmo, em galeria própria.</li>
    </ul>

    <h2>Equipamento</h2>
    <p>Trabalho com equipamento profissional de câmera e iluminação, sempre adaptado ao tipo de evento:
    do ambiente controlado de um ensaio à luz imprevisível de uma festa. <a href="/equipamentos">Veja a lista completa</a>.</p>

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
    imagem, use o botão no rodapé da página de cada evento: é gratuito e simples.</p>
  </main>
  <footer>
    <a href="/">fotos · lucafchala</a>
    ${footerLegalLinksHTML()}
  </footer>
</body>
</html>`;
}
