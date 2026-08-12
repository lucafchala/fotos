import { footerLegalLinksHTML } from '../utils.js';

// Static "Equipamento" (gear list) page — mirrors about.js's structure (same
// head, back link, footer, CSS var schema for prefers-color-scheme light
// mode). No dynamic content, so no escaping is needed.
export function gearHTML() {
  return `<!DOCTYPE html>
<html lang="pt-BR">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <link rel="icon" type="image/svg+xml" href="/icon.svg">
  <link rel="apple-touch-icon" href="/icon.svg">
  <meta name="theme-color" content="#0a0a0a">
  <title>Equipamento · fotos</title>
  <meta name="description" content="Equipamento fotográfico usado por Luca F. Chala">
  <link rel="canonical" href="https://fotos.lucafchala.com/equipamentos">
  <meta property="og:type" content="website">
  <meta property="og:title" content="Equipamento · Luca F. Chala">
  <meta property="og:description" content="Câmeras, lentes e o resto do equipamento usado nas fotos">
  <meta property="og:url" content="https://fotos.lucafchala.com/equipamentos">
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link href="https://fonts.googleapis.com/css2?family=Inter:ital,wght@0,300;0,400;0,500;0,600;1,300&display=swap" rel="stylesheet">
  <style>
    *,*::before,*::after{box-sizing:border-box;margin:0;padding:0}
    :root{
      --bg-page:#0a0a0a; --text:#f0ebe5; --text-2:#b0a89e; --text-heading:#e0d8d0; --text-strong:#d0c8be;
      --text-muted:#999; --text-dim:#666; --text-dim-2:#555; --border-dim:#1e1e1e; --border-hair:#141414;
      --footer-link:#888; --accent:#c0a060;
    }
    @media (prefers-color-scheme: light) {
      :root{
        --bg-page:#f0ece8; --text:#1a1715; --text-2:#4a4744; --text-heading:#2a2521; --text-strong:#332d28;
        --text-muted:#6b6460; --text-dim:#8a8480; --text-dim-2:#9a9490; --border-dim:#ddd9d4; --border-hair:#e5e1db;
        --footer-link:#6b6460; --accent:#8a6428;
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
    h2{font-size:1rem;font-weight:600;margin:2.25rem 0 .5rem;color:var(--text-heading)}
    h3{font-size:.82rem;font-weight:600;letter-spacing:.04em;text-transform:uppercase;color:var(--text-muted);margin:1.25rem 0 .5rem}
    p,li{font-size:.9rem;line-height:1.75;color:var(--text-2)}
    p{margin-bottom:.75rem}
    ul{margin:.25rem 0 .75rem;padding-left:1.25rem}
    li{margin-bottom:.35rem}
    strong{color:var(--text-strong);font-weight:600}
    a{color:var(--accent);text-decoration:none}
    a:hover{text-decoration:underline}
    .intro{font-size:.92rem;color:var(--text-muted);line-height:1.7;margin-bottom:.5rem}
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
    <h1>Equipamento</h1>
    <p class="tagline">O que uso para fotografar</p>

    <p class="intro">Lista do equipamento que uso no dia a dia — câmeras, lentes, acessórios e o resto do
    fluxo de trabalho. Atualizo aqui conforme troco ou adiciono algo.</p>

    <h2>Essenciais</h2>

    <h3>Câmeras</h3>
    <ul>
      <li>Sony A6700 (kit)</li>
    </ul>

    <h3>Lentes</h3>
    <ul>
      <li>Sigma 24-70 f/2.8 DG DN II ART</li>
      <li>Sigma 10-18 f/2.8 DC DN Contemporary</li>
    </ul>

    <h3>Cartões de memória</h3>
    <ul>
      <li>SanDisk 128GB Extreme PRO UHS-I SDXC (vem com o kit da A6700)</li>
      <li>SanDisk 128GB Extreme PRO UHS-II SDXC (qualidade máxima de vídeo)</li>
      <li>Lexar 256GB Professional 1667x UHS-II SDXC (cartão principal)</li>
    </ul>

    <h3>Tripés</h3>
    <ul>
      <li>Tripé Ulanzi &amp; Coman Zero Y</li>
    </ul>

    <h3>Flashes</h3>
    <ul>
      <li>Godox V1 PRO</li>
    </ul>

    <h3>Carregadores</h3>
    <ul>
      <li>Carregador Anker Prime 160W USB-C</li>
      <li>Carregador triplo Jupio para Sony NP-FZ100 (também serve de case)</li>
    </ul>

    <h3>Baterias</h3>
    <ul>
      <li>Sony NP-FZ100 (3x)</li>
      <li>Godox VB-30 (1x)</li>
    </ul>

    <h2>Acessórios</h2>

    <h3>Filtros de lente</h3>
    <ul>
      <li>Filtro UV B+W MRC Nano Master 67mm (revestimento 16x, slim)</li>
      <li>Polarizador circular PolarPro 82mm QuartzLine</li>
      <li>Filtro UV Hoya UV-HMC 82mm</li>
    </ul>

    <h3>Adaptadores de filtro</h3>
    <ul>
      <li>Anel adaptador step-up 67-82mm</li>
    </ul>

    <h3>Kit de limpeza</h3>
    <ul>
      <li>Lens pen</li>
      <li>OXO Cleaning Pen</li>
      <li>Soprador de ar genérico</li>
    </ul>

    <h3>Suporte e fixação</h3>
    <ul>
      <li>Alça Peak Design Slide</li>
      <li>Peak Design Capture Clip v3</li>
      <li>Peak Design Pro Pad para Capture Clip v3</li>
      <li>Peak Design Cuff (pulseira de câmera)</li>
      <li>Alça Sony original</li>
      <li>Capa de sapata Pikachu</li>
    </ul>

    <h3>Sistema de transporte no cinto</h3>
    <ul>
      <li>Case de neoprene C-Rope para lente, grande</li>
      <li>Case de neoprene C-Rope para lente, pequeno</li>
      <li>Conjunto de bolsas de câmera C-Rope (P, M, G)</li>
      <li>Bolso de cinto universal Matador</li>
      <li>Mosquetão com trava Matador</li>
      <li>Cinto tático JUKMO</li>
    </ul>

    <h3>Gerenciamento de cartões</h3>
    <ul>
      <li>Leitor de cartão SanDisk USB-C UHS-II</li>
    </ul>

    <h2>Computação e fluxo de trabalho</h2>

    <h3>Edição móvel</h3>
    <ul>
      <li>Samsung Galaxy Tab S9+</li>
    </ul>

    <h2>Bolsas e transporte</h2>

    <h3>Mochilas</h3>
    <ul>
      <li>Mochila K&amp;F Concept Beta Photography 20L</li>
      <li>Coldre Ruggard Hunter 35 DSLR (vem com o kit da A6700)</li>
    </ul>

    <h3>Acessórios</h3>
    <ul>
      <li>Kit de flash AK-R1</li>
    </ul>
  </main>
  <footer>
    <a href="/">fotos · lucafchala</a>
    ${footerLegalLinksHTML()}
  </footer>
</body>
</html>`;
}
