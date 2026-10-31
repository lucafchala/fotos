import { TERMS_VERSION, formatDatePT, footerLegalLinksHTML, fontPreloadHTML, fontFaceCSS, socialMetaHTML } from '../utils.js';

export function termsHTML() {
  return `<!DOCTYPE html>
<html lang="pt-BR">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <link rel="icon" type="image/svg+xml" href="/icon.svg">
  <link rel="apple-touch-icon" href="/apple-touch-icon.png">
  <link rel="manifest" href="/manifest.json">
  <meta name="theme-color" content="#0a0a0a">
  <title>Termos de Uso · fotos</title>
  <link rel="canonical" href="https://fotos.lucafchala.com/termos">
  ${socialMetaHTML({
    type: 'article',
    title: 'Termos de Uso · fotos',
    description: `Termos de uso e autorização de uso de imagem de fotos.lucafchala.com, na versão de ${formatDatePT(TERMS_VERSION)}.`,
    url: 'https://fotos.lucafchala.com/termos',
  })}
  ${fontPreloadHTML()}
  <style>
    ${fontFaceCSS()}
    *,*::before,*::after{box-sizing:border-box;margin:0;padding:0}
    :root{
      --bg-page:#0a0a0a; --text:#f0ebe5; --text-2:#b0a89e; --text-heading:#e0d8d0; --text-strong:#d0c8be;
      --text-muted:#999; --text-dim:#8c8c8c; --text-dim-2:#888888; --border-dim:#1e1e1e; --border-hair:#141414;
      --footer-link:#888; --accent:#c0a060;
      --warn-bg:#0f0d08; --warn-border:#3a3320; --warn-text-strong:#d8c89a;
    }
    @media (prefers-color-scheme: light) {
      :root{
        --bg-page:#f0ece8; --text:#1a1715; --text-2:#4a4744; --text-heading:#2a2521; --text-strong:#332d28;
        --text-muted:#6b6460; --text-dim:#66605b; --text-dim-2:#6b6560; --border-dim:#ddd9d4; --border-hair:#e5e1db;
        --footer-link:#6b6460; --accent:#8a6428;
        --warn-bg:#fdf3dc; --warn-border:#e8d1a0; --warn-text-strong:#5c4310;
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
    .updated{font-size:.8rem;color:var(--text-dim-2);margin-bottom:2.25rem}
    h2{font-size:1rem;font-weight:600;margin:2.25rem 0 .75rem;color:var(--text-heading)}
    p,li{font-size:.9rem;line-height:1.75;color:var(--text-2)}
    p{margin-bottom:.75rem}
    ul{margin:.25rem 0 .75rem;padding-left:1.25rem}
    li{margin-bottom:.4rem}
    strong{color:var(--text-strong);font-weight:600}
    a{color:var(--accent);text-decoration:none}
    a:hover{text-decoration:underline}
    .intro{font-size:.92rem;color:var(--text-muted);line-height:1.7;margin-bottom:.5rem}
    .note{font-size:.82rem;color:var(--text-dim);line-height:1.6;border-left:2px solid var(--border-dim);padding-left:1rem;margin:1rem 0}
    .key{border-left:2px solid var(--warn-border);background:var(--warn-bg);padding:1rem 1.1rem;border-radius:0 7px 7px 0;margin:1rem 0}
    .key strong{color:var(--warn-text-strong)}
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
    <h1>Termos de Uso</h1>
    <p class="updated">Atualizados em ${formatDatePT(TERMS_VERSION)}</p>

    <p class="intro">Estes Termos regem o uso do site <strong>fotos.lucafchala.com</strong> e o uso das fotos dos eventos. Nos projetos públicos, a galeria do site abre para qualquer pessoa, sem aceite prévio dos Termos: ao usar o site e as fotos de um projeto, você concorda em segui-los. O aceite expresso dos Termos é pedido no acesso ao Google Drive e nas galerias de projetos familiares e privados.</p>

    <h2>1. Quem é o responsável</h2>
    <p>O site é operado por <strong>Luca Ferriani Chala</strong>, responsável pela fotografia e pela disponibilização das imagens. Contato: <a href="mailto:suporte@lucafchala.com">suporte@lucafchala.com</a> · questões de dados: <a href="mailto:privacidade@lucafchala.com">privacidade@lucafchala.com</a>.</p>

    <h2>2. O serviço</h2>
    <p>O site funciona como uma página de entrega: cada projeto reúne a descrição do evento e uma galeria própria do site, onde as fotos podem ser visualizadas e baixadas sem sair daqui, em duas versões: <strong>“para redes sociais”</strong> (a versão preparada para as redes, quando existe para a foto) e <strong>“tamanho máximo”</strong> (o arquivo original). Os arquivos são entregues exatamente como estão no Google Drive, sem alteração de nome nem de conteúdo. Além da galeria, cada projeto também oferece um link para a pasta no <strong>Google Drive</strong>, onde o material completo fica disponível para visualização e download pelas pessoas que participaram do evento.</p>

    <h2>3. Uso das imagens e Categorias de Acesso</h2>
    <div class="key">
      <p>O acesso às galerias varia conforme a natureza do projeto:</p>
      <ul>
        <li><strong>Projetos Familiares:</strong> Álbuns feitos para a família, para uso doméstico. O acesso se apoia no seu consentimento, não em senha: o link da pasta é de quem o recebe, e peço que ele fique dentro do círculo a que se destina.</li>
        <li><strong>Projetos Privados:</strong> Álbuns feitos para quem participou do evento. Também aqui o acesso se apoia no seu consentimento, não em senha, e o link é para quem esteve lá. A entrega ocorre sob a base do legítimo interesse.</li>
        <li><strong>Projetos Públicos:</strong> Trabalhos autorais ou registros sem expectativa de privacidade restrita. A galeria do site abre para qualquer pessoa, sem aceite prévio dos Termos e sem registro de aceite; o link do Google Drive, mesmo nesses projetos, continua passando pelo aceite registrado.</li>
      </ul>
      <p>Nos projetos públicos, as páginas e as fotos das galerias podem aparecer em buscadores (como o Google), inclusive na busca de imagens. As galerias de projetos familiares e privados ficam fora da indexação, e os downloads não são indexados em nenhum caso. O site pede aos buscadores que não usem o conteúdo para treinar inteligência artificial, mas não controla o que esses serviços fazem. Nos projetos familiares e privados, a galeria e o link do Drive continuam exigindo o aceite dos Termos e a declaração da categoria, com registro do aceite.</p>
      <p>Como parte da dinâmica do trabalho, eu realizo curadoria de imagens (exceto nas familiares) para meu portfólio profissional (site/redes sociais) e publicações editoriais, sem uso comercial/publicitário de terceiros.</p>
      <p><strong>Direito de Oposição (Opt-out):</strong> Caso encontre alguma foto sua ou de alguém sob sua responsabilidade que não deseje ver no portfólio ou na galeria, use o botão <em>“Solicitar remoção de foto”</em> no rodapé. A exclusão é imediata, gratuita e garantida.</p>
    </div>
    <p><strong>Finalidades conforme a categoria:</strong></p>
    <ul>
      <li><strong>Familiar:</strong> as imagens destinam-se exclusivamente à entrega e ao uso doméstico da família — sem inclusão em portfólio, redes sociais ou publicações.</li>
      <li><strong>Privado:</strong> entrega aos participantes e curadoria para meu portfólio profissional (site/redes) e publicações editoriais, com base no legítimo interesse, sem uso comercial/publicitário de terceiros.</li>
      <li><strong>Público:</strong> entrega, portfólio e publicação editorial, jornalística, cultural, artística e educacional, sem uso comercial/publicitário de terceiros.</li>
    </ul>
    <p><strong>Menores de idade.</strong> Se a foto retrata uma criança ou adolescente, o aceite deve ser dado pelos <strong>pais ou pelo responsável legal</strong>. Ao marcar a caixa de aceite, você declara ser maior de 18 anos e, quando autoriza o uso da imagem de um menor sob sua responsabilidade, que o faz na condição de responsável legal e no melhor interesse dele(a), conforme o art. 14 da LGPD. O consentimento relativo a menores também pode ser coletado junto à instituição contratante (escola/organização) no momento do evento. Pedidos de remoção envolvendo menores são tratados com <strong>prioridade</strong>.</p>

    <h2>4. Uso permitido das fotos</h2>
    <p>As fotos são entregues para <strong>uso pessoal</strong> das pessoas retratadas. Você pode baixá-las, imprimi-las e publicá-las nas suas redes. Ao publicar, pedimos que <strong>marque @lucafchala</strong> — isso valoriza o trabalho e incentiva novos projetos.</p>
    <p>Não é permitido revender as imagens, usá-las para fins comerciais ou publicitários de terceiros, nem alterar substancialmente a foto de forma que descaracterize o trabalho ou prejudique a honra e a imagem das pessoas retratadas.</p>

    <h2>5. Direitos autorais</h2>
    <p>Os direitos autorais das fotografias pertencem a <strong>Luca Ferriani Chala</strong> (Lei nº 9.610/1998). A autorização de uso descrita acima não transfere a titularidade dos direitos autorais — ela concede uma licença de uso nos termos aqui descritos.</p>

    <h2>6. Privacidade e proteção de dados</h2>
    <p>O tratamento de dados pessoais (incluindo o registro do aceite e os dados de formulários) é descrito na <a href="/privacidade">Política de Privacidade</a>, em conformidade com a LGPD.</p>

    <h2>7. Remoção de fotos</h2>
    <p>Se você identificar uma foto sua que deseja remover, use o botão <em>“Solicitar remoção de foto”</em> no rodapé da página do evento, ou escreva para mim em <a href="mailto:privacidade@lucafchala.com">privacidade@lucafchala.com</a>. A remoção é <strong>gratuita</strong> e respondida em até <strong>15 dias</strong>.</p>
    <p>Quando o pedido é atendido (ou quando o responsável decide tirar a foto), ela sai da galeria e do mapa do site em até 2 minutos (o tempo de a alteração chegar a todo o site), e o download dela deixa de funcionar. O resultado no buscador, porém, pode levar um tempo para atualizar; quando for urgente, eu solicito a remoção diretamente ao buscador, pela ferramenta de remoção do Google Search Console. A foto original pode continuar no Drive até ser apagada lá.</p>

    <h2>8. Serviços de terceiros</h2>
    <p>O site usa <strong>Google Drive</strong> (hospedagem e download das fotos), <strong>Cloudflare</strong> (hospedagem, medição anônima e proteção contra robôs via <strong>Turnstile em modo invisível</strong> — uma verificação automática do navegador, sem desafio visível; consulte o <a href="https://www.cloudflare.com/turnstile-privacy-policy/" target="_blank" rel="noopener">Adendo de Privacidade do Turnstile</a>) e <strong>Resend</strong> (envio de e-mails). O acesso ao Drive também se sujeita aos termos do Google.</p>

    <h2>9. Isenções e limitação de responsabilidade</h2>
    <p>O site é fornecido “no estado em que se encontra”. Não garantimos disponibilidade ininterrupta nem nos responsabilizamos por indisponibilidades de serviços de terceiros (como o Google Drive) ou por uso indevido das imagens por parte de quem as baixa.</p>

    <h2>10. Alterações nos Termos</h2>
    <p>Estes Termos podem ser atualizados para refletir mudanças no site ou na legislação. A data de atualização no topo indica a versão vigente; o aceite registrado guarda a versão aceita por você.</p>

    <h2>11. Lei aplicável e foro</h2>
    <p>Estes Termos são regidos pelas leis brasileiras. Fica eleito o <strong>foro da Comarca de São Paulo/SP</strong> para dirimir eventuais controvérsias, salvo competência legal diversa (como o foro do consumidor).</p>

    <p class="note">Dúvidas? Fale comigo pelo <a href="https://wa.me/5511989211178" target="_blank" rel="noopener">WhatsApp</a> ou por <a href="mailto:suporte@lucafchala.com">suporte@lucafchala.com</a>. A remoção de fotos e o atendimento são gratuitos.</p>
  </main>
  <footer>
    <a href="/">fotos · lucafchala</a>
    ${footerLegalLinksHTML()}
  </footer>
</body>
</html>`;
}
