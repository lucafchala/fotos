import { TERMS_VERSION, formatDatePT } from '../utils.js';

export function termsHTML() {
  return `<!DOCTYPE html>
<html lang="pt-BR">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <link rel="icon" type="image/svg+xml" href="/icon.svg">
  <link rel="apple-touch-icon" href="/icon.svg">
  <meta name="theme-color" content="#0a0a0a">
  <title>Termos de Uso · fotos</title>
  <meta name="description" content="Termos de uso e autorização de uso de imagem de fotos.lucafchala.com">
  <link rel="canonical" href="https://fotos.lucafchala.com/termos">
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
    .updated{font-size:.78rem;color:#555;margin-bottom:2.25rem}
    h2{font-size:1rem;font-weight:600;margin:2.25rem 0 .75rem;color:#e0d8d0}
    p,li{font-size:.9rem;line-height:1.75;color:#b0a89e}
    p{margin-bottom:.75rem}
    ul{margin:.25rem 0 .75rem;padding-left:1.25rem}
    li{margin-bottom:.4rem}
    strong{color:#d0c8be;font-weight:600}
    a{color:#c0a060;text-decoration:none}
    a:hover{text-decoration:underline}
    .intro{font-size:.92rem;color:#999;line-height:1.7;margin-bottom:.5rem}
    .note{font-size:.82rem;color:#666;line-height:1.6;border-left:2px solid #1e1e1e;padding-left:1rem;margin:1rem 0}
    .key{border-left:2px solid #3a3320;background:#0f0d08;padding:1rem 1.1rem;border-radius:0 7px 7px 0;margin:1rem 0}
    .key strong{color:#d8c89a}
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
    <h1>Termos de Uso</h1>
    <p class="updated">Atualizados em ${formatDatePT(TERMS_VERSION)}</p>

    <p class="intro">Estes Termos regem o uso do site <strong>fotos.lucafchala.com</strong> e o acesso às fotos dos eventos. Ao acessar as fotos de um projeto, você declara que leu, entendeu e concorda com estes Termos.</p>

    <h2>1. Quem é o responsável</h2>
    <p>O site é operado por <strong>Luca Ferriani Chala</strong>, responsável pela fotografia e pela disponibilização das imagens. Contato: <a href="mailto:suporte@lucafchala.com">suporte@lucafchala.com</a> · questões de dados: <a href="mailto:privacidade@lucafchala.com">privacidade@lucafchala.com</a>.</p>

    <h2>2. O serviço</h2>
    <p>O site funciona como uma página de entrega: cada projeto reúne a descrição do evento e um link para a pasta no <strong>Google Drive</strong> onde as fotos podem ser visualizadas e baixadas pelas pessoas que participaram do evento. As fotos exibidas na própria página são apenas uma prévia; o material completo fica no Drive.</p>

    <h2>3. Autorização de uso de imagem</h2>
    <div class="key">
      <p>Ao marcar a caixa de aceite e acessar as fotos, você <strong>autoriza Luca Ferriani Chala a utilizar as imagens em que você aparece</strong>, captadas no evento correspondente, para as seguintes finalidades:</p>
      <ul>
        <li><strong>Entrega</strong> das fotos às pessoas que participaram do evento;</li>
        <li><strong>Divulgação do trabalho do fotógrafo</strong> — portfólio, este site e redes sociais (por exemplo, Instagram), a título de demonstração profissional.</li>
      </ul>
      <p>A autorização é <strong>gratuita</strong>, por prazo indeterminado e válida para todo o território nacional. As imagens <strong>não são vendidas a terceiros</strong> nem usadas para publicidade de produtos de terceiros. Você pode revogar esta autorização e pedir a remoção das suas fotos a qualquer momento (veja o item 7).</p>
    </div>
    <p>Esta autorização tem fundamento no art. 20 do Código Civil e no consentimento previsto na Lei nº 13.709/2018 (LGPD). Para sua segurança e como comprovação, o aceite é registrado com data, hora e dados técnicos do acesso, conforme a <a href="/privacidade">Política de Privacidade</a>.</p>
    <p><strong>Menores de idade.</strong> Se a foto retrata uma criança ou adolescente, o aceite deve ser dado pelos <strong>pais ou pelo responsável legal</strong>. Ao marcar a caixa de aceite, você declara ser maior de 18 anos e, quando autoriza o uso da imagem de um menor sob sua responsabilidade, que o faz na condição de responsável legal e no melhor interesse dele(a), conforme o art. 14 da LGPD. O consentimento relativo a menores também pode ser coletado junto à instituição contratante (escola/organização) no momento do evento. Pedidos de remoção envolvendo menores são tratados com <strong>prioridade</strong>.</p>

    <h2>4. Uso permitido das fotos</h2>
    <p>As fotos são entregues para <strong>uso pessoal</strong> das pessoas retratadas. Você pode baixá-las, imprimi-las e publicá-las nas suas redes. Ao publicar, pedimos que <strong>marque @lucafchala</strong> — isso valoriza o trabalho e incentiva novos projetos.</p>
    <p>Não é permitido revender as imagens, usá-las para fins comerciais ou publicitários de terceiros, nem alterar substancialmente a foto de forma que descaracterize o trabalho ou prejudique a honra e a imagem das pessoas retratadas.</p>

    <h2>5. Direitos autorais</h2>
    <p>Os direitos autorais das fotografias pertencem a <strong>Luca Ferriani Chala</strong> (Lei nº 9.610/1998). A autorização de uso descrita acima não transfere a titularidade dos direitos autorais — ela concede uma licença de uso nos termos aqui descritos.</p>

    <h2>6. Privacidade e proteção de dados</h2>
    <p>O tratamento de dados pessoais (incluindo o registro do aceite e os dados de formulários) é descrito na <a href="/privacidade">Política de Privacidade</a>, em conformidade com a LGPD.</p>

    <h2>7. Remoção de fotos</h2>
    <p>Se você identificar uma foto sua que deseja remover, use o botão <em>“Solicitar remoção de foto”</em> no rodapé da página do evento, ou escreva para <a href="mailto:privacidade@lucafchala.com">privacidade@lucafchala.com</a>. A remoção é <strong>gratuita</strong> e respondida em até <strong>15 dias úteis</strong>.</p>

    <h2>8. Serviços de terceiros</h2>
    <p>O site usa <strong>Google Drive</strong> (hospedagem e download das fotos), <strong>Cloudflare</strong> (hospedagem, medição anônima e proteção contra robôs via <strong>Turnstile em modo invisível</strong> — uma verificação automática do navegador, sem desafio visível; consulte o <a href="https://www.cloudflare.com/turnstile-privacy-policy/" target="_blank" rel="noopener">Adendo de Privacidade do Turnstile</a>) e <strong>Resend</strong> (envio de e-mails). O acesso ao Drive também se sujeita aos termos do Google.</p>

    <h2>9. Isenções e limitação de responsabilidade</h2>
    <p>O site é fornecido “no estado em que se encontra”. Não garantimos disponibilidade ininterrupta nem nos responsabilizamos por indisponibilidades de serviços de terceiros (como o Google Drive) ou por uso indevido das imagens por parte de quem as baixa.</p>

    <h2>10. Alterações nos Termos</h2>
    <p>Estes Termos podem ser atualizados para refletir mudanças no site ou na legislação. A data de atualização no topo indica a versão vigente; o aceite registrado guarda a versão aceita por você.</p>

    <h2>11. Lei aplicável e foro</h2>
    <p>Estes Termos são regidos pelas leis brasileiras. Fica eleito o <strong>foro da Comarca de São Paulo/SP</strong> para dirimir eventuais controvérsias, salvo competência legal diversa (como o foro do consumidor).</p>

    <p class="note">Dúvidas? Fale com a gente pelo <a href="https://wa.me/5511989211178" target="_blank" rel="noopener">WhatsApp</a> ou por <a href="mailto:suporte@lucafchala.com">suporte@lucafchala.com</a>. A remoção de fotos e o atendimento são gratuitos.</p>
  </main>
  <footer>
    <a href="/">fotos · lucafchala</a>
    <a href="/privacidade">Privacidade</a>
    <a href="/suporte">Suporte</a>
  </footer>
</body>
</html>`;
}
