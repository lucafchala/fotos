import { PERSON_LD, jsonParaScript, footerLegalLinksHTML, FOOTER_CSS, fontPreloadHTML, fontFaceCSS, socialMetaHTML, escape } from '../utils.js';

// "Sobre" (About) page — mirrors privacy.js structure (same head, dark
// theme, back link, footer). The only dynamic content is the agenda badge
// (#211), escaped like every interpolation. The copy below is a placeholder
// the owner can edit freely.
/**
 * @param {string} [agenda] selo de agenda; vazio, nada aparece
 * @param {string} [nonce] nonce do CSP, para o bloco JSON-LD
 */
export function aboutHTML(agenda = '', nonce = '') {
  return `<!DOCTYPE html>
<html lang="pt-BR">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <link rel="icon" type="image/svg+xml" href="/icon.svg">
  <link rel="apple-touch-icon" href="/apple-touch-icon.png">
  <link rel="manifest" href="/manifest.json">
  <meta name="theme-color" content="#0a0a0a">
  <title>Sobre · fotos</title>
  <link rel="canonical" href="https://fotos.lucafchala.com/sobre">
  ${socialMetaHTML({
    type: 'profile',
    title: 'Sobre · Luca F. Chala',
    description: 'Quem faz as fotos: formaturas, casamentos, ensaios e eventos, com o equipamento e o método por trás de cada projeto.',
    url: 'https://fotos.lucafchala.com/sobre',
  })}
  <meta property="profile:first_name" content="Luca">
  <meta property="profile:last_name" content="F. Chala">
  <meta property="profile:username" content="lucafchala">
  ${nonce ? `<script type="application/ld+json" nonce="${escape(nonce)}">${jsonParaScript({
    '@context': 'https://schema.org',
    '@type': 'ProfilePage',
    url: 'https://fotos.lucafchala.com/sobre',
    inLanguage: 'pt-BR',
    mainEntity: {
      ...PERSON_LD,
      jobTitle: 'Photographer',
      knowsAbout: ['Photography', 'Event photography'],
      sameAs: ['https://lucafchala.com/', 'https://www.instagram.com/lucafchala'],
    },
  })}</script>` : ''}
  ${fontPreloadHTML()}
  <style>
    ${fontFaceCSS()}
    *,*::before,*::after{box-sizing:border-box;margin:0;padding:0}
    :root{
      --bg-page:#0a0a0a; --text:#f0ebe5; --text-2:#b0a89e; --text-heading:#e0d8d0; --text-strong:#d0c8be;
      --text-muted:#999; --text-dim:#8c8c8c; --text-dim-2:#888888; --border-dim:#1e1e1e; --border-hair:#141414;
      --footer-link:#888; --accent:#c0a060; --ease:cubic-bezier(.22,1,.36,1);
      --ok-border:#1a2e1a; --ok-text:#4a8a4a; --ok-border-hover:#2a4a2a; --ok-text-hover:#6aaa6a; --ok-bg-hover:#0a120a;
      --btn-border:#2a2a2a; --btn-text:#888; --btn-border-hover:#555; --btn-text-hover:#ccc; --btn-bg-hover:#111;
    }
    @media (prefers-color-scheme: light) {
      :root{
        --bg-page:#f0ece8; --text:#1a1715; --text-2:#4a4744; --text-heading:#2a2521; --text-strong:#332d28;
        --text-muted:#6b6460; --text-dim:#66605b; --text-dim-2:#6b6560; --border-dim:#ddd9d4; --border-hair:#e5e1db;
        --footer-link:#6b6460; --accent:#8a6428;
        --ok-border:#b8dab8; --ok-text:#2e7d32; --ok-border-hover:#8fc491; --ok-text-hover:#1b5e20; --ok-bg-hover:#eaf6ea;
        --btn-border:#ddd9d4; --btn-text:#6b6460; --btn-border-hover:#b8b2ab; --btn-text-hover:#332d28; --btn-bg-hover:#fff;
      }
    }
    body{font-family:'Inter',sans-serif;background:var(--bg-page);color:var(--text);min-height:100vh}
    :focus-visible{outline:2px solid var(--accent);outline-offset:2px}
    header{padding:1.25rem 1.5rem}
    .back{display:inline-flex;align-items:center;gap:.375rem;min-height:44px;text-decoration:none;color:var(--text-dim-2);font-size:.875rem;letter-spacing:0;transition:color .16s var(--ease)}
    .back:hover{color:var(--text-2)}
    .back svg{width:16px;height:16px}
    main{max-width:680px;margin:0 auto;padding:2rem 1.5rem 6rem}
    h1{font-size:1.75rem;font-weight:500;line-height:1.15;margin-bottom:.5rem}
    .tagline{font-size:.9375rem;color:var(--text-muted);margin-bottom:2rem;letter-spacing:0}
    .agenda-selo{display:inline-block;margin:-1rem 0 2rem;padding:.25rem .75rem;border:1px solid var(--border-dim);border-radius:999px;color:var(--text-muted);font-size:.8125rem;letter-spacing:0}
    h2{font-size:1.125rem;font-weight:500;margin:2.5rem 0 .75rem;color:var(--text-heading)}
    p,li{font-size:.9375rem;line-height:1.75;color:var(--text-2)}
    p{margin-bottom:.75rem}
    ul{margin:.25rem 0 .75rem;padding-left:1.25rem}
    li{margin-bottom:.4rem}
    strong{color:var(--text-strong);font-weight:500}
    a{color:var(--accent);text-decoration:none}
    a:hover{text-decoration:underline}
    .intro{font-size:1rem;color:var(--text-muted);line-height:1.7;margin-bottom:.5rem}
    .cta{display:flex;gap:.75rem;flex-wrap:wrap;margin-top:1.25rem}
    .cta-btn{display:inline-flex;align-items:center;gap:.5rem;min-height:44px;padding:0 1rem;border-radius:10px;font-size:.875rem;font-weight:500;text-decoration:none;letter-spacing:0;transition:border-color .16s var(--ease),color .16s var(--ease),background .16s var(--ease);white-space:nowrap;border:1px solid}
    .cta-btn:hover{text-decoration:none}
    .btn-whatsapp{border-color:var(--btn-border);color:var(--btn-text)}
    .btn-whatsapp:hover{border-color:var(--btn-border-hover);color:var(--btn-text-hover);background:var(--btn-bg-hover)}
    .btn-default{border-color:var(--btn-border);color:var(--btn-text)}
    .btn-default:hover{border-color:var(--btn-border-hover);color:var(--btn-text-hover);background:var(--btn-bg-hover)}
    .cta-btn svg{width:16px;height:16px;flex-shrink:0}
    .note{font-size:.875rem;color:var(--text-dim);line-height:1.6;border-left:1px solid var(--border-dim);padding-left:1rem;margin:1.5rem 0 0}
    footer{text-align:center;padding:2rem 1rem 2.5rem;border-top:1px solid var(--border-hair);display:flex;flex-direction:column;align-items:center}
    footer a{color:var(--footer-link);font-size:.8125rem;text-decoration:none;letter-spacing:0;transition:color .2s}
    footer > a{display:inline-flex;align-items:center;min-height:44px}
    footer a:hover{color:var(--text-2)}
    ${FOOTER_CSS}
  </style>
</head>
<body>
  <header>
    <a href="/" class="back">
      <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="15 18 9 12 15 6"/></svg>
      Voltar
    </a>
  </header>
  <main>
    <h1>Sobre</h1>
    <p class="tagline">Luca F. Chala · fotografia de formaturas, casamentos, ensaios e eventos</p>
    ${agenda ? `<p class="agenda-selo">${escape(agenda)}</p>` : ''}

    <p class="intro">Olá, sou <strong>Luca F. Chala</strong>, fotógrafo. Registro formaturas, casamentos,
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
        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M7.9 20A9 9 0 104 16.1L2 22z"/></svg>
        WhatsApp
      </a>
      <a href="https://instagram.com/lucafchala" target="_blank" rel="noopener" class="cta-btn btn-default">
        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="2" y="2" width="20" height="20" rx="5"/><circle cx="12" cy="12" r="4"/><line x1="17.5" y1="6.5" x2="17.51" y2="6.5"/></svg>
        @lucafchala
      </a>
      <a href="/suporte?tema=orcamento" class="cta-btn btn-default">
        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="2" y="4" width="20" height="16" rx="2"/><polyline points="2,4 12,13 22,4"/></svg>
        Pedir orçamento
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
