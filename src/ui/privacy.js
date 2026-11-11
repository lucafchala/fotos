import { footerLegalLinksHTML, fontPreloadHTML, fontFaceCSS, socialMetaHTML } from '../utils.js';

export function privacyHTML() {
  return `<!DOCTYPE html>
<html lang="pt-BR">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <link rel="icon" type="image/svg+xml" href="/icon.svg">
  <link rel="apple-touch-icon" href="/apple-touch-icon.png">
  <link rel="manifest" href="/manifest.json">
  <meta name="theme-color" content="#0a0a0a">
  <title>Política de Privacidade · fotos</title>
  <link rel="canonical" href="https://fotos.lucafchala.com/privacidade">
  ${socialMetaHTML({
    type: 'article',
    title: 'Política de Privacidade · fotos',
    description: 'Quais dados pessoais são tratados em fotos.lucafchala.com, por quanto tempo, com quem são compartilhados e como pedir a remoção de uma foto.',
    url: 'https://fotos.lucafchala.com/privacidade',
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
    <h1>Política de Privacidade</h1>
    <p class="updated">Atualizada em 11 de novembro de 2026</p>

    <p class="intro">Esta política explica como os dados pessoais são tratados no site <strong>fotos.lucafchala.com</strong>, em conformidade com a Lei Geral de Proteção de Dados (Lei nº 13.709/2018 — LGPD).</p>

    <h2>1. Quem é o responsável</h2>
    <p>O controlador dos dados é <strong>Luca F. Chala</strong> (pessoa física), responsável pela fotografia e pela operação deste site.</p>
    <p>Encarregado pelo tratamento de dados (DPO) e canal para exercer direitos: <a href="mailto:privacidade@lucafchala.com">privacidade@lucafchala.com</a>.</p>

    <h2>2. Quais dados são coletados</h2>
    <p>O site coleta o mínimo necessário, apenas quando você usa um dos formulários:</p>
    <ul>
      <li><strong>Solicitação de remoção de foto:</strong> e-mail, telefone, mensagem (opcional) e, se você escolher enviar, a própria foto identificada. Se o pedido é feito <strong>pela própria galeria</strong> (“Pedir remoção”, com a foto aberta), os dados são os mesmos, sem o telefone: e-mail, o motivo escolhido (sou eu na foto, sou responsável por um menor, outro motivo), a mensagem (opcional) e a identificação da foto que você estava vendo.</li>
      <li><strong>Formulário de suporte:</strong> nome (opcional), e-mail (opcional) e a mensagem.</li>
      <li><strong>Código de acesso por e-mail</strong> (só se a verificação anti-robô falhar no seu aparelho e você escolher esse caminho): o e-mail que você digitar, usado <strong>apenas para enviar o código</strong>. O site não guarda o seu e-mail — guarda só, por até 1 hora, um resumo irreversível dele (hash), para impedir que alguém use o site para encher a caixa de entrada de outra pessoa.</li>
      <li><strong>Registro de autorização de uso de imagem:</strong> ao abrir o link do Google Drive de um evento (em qualquer categoria de acesso) ou liberar a galeria própria dos projetos familiares e privados, registramos o seu aceite dos <a href="/termos">Termos de Uso</a> com data e hora, o evento, a versão dos Termos aceita, a <strong>categoria de acesso do projeto</strong> (público, privado ou familiar) e a <strong>autodeclaração</strong> eventualmente aceita (de participação ou de vínculo familiar), além de dados técnicos do acesso (endereço IP, localização aproximada, provedor, navegador/dispositivo, idioma e verificação anti-robô) — e o seu nome, caso você opte por informá-lo. Esses dados servem como <strong>comprovação do consentimento</strong> e não são usados para outra finalidade. Já nas páginas dos <strong>projetos públicos</strong>, a galeria própria abre para qualquer pessoa sem aceite prévio dos Termos — e, por isso, sem registro de aceite; nesses projetos, o registro continua sendo feito quando você abre o link do Drive.</li>
    </ul>
    <p>Além disso, são usados cookies e medição estritamente funcionais:</p>
    <ul>
      <li><strong>Cookie de sessão</strong> (apenas no painel administrativo, restrito a mim).</li>
      <li><strong>Cookie de contagem de visualização</strong> (<code>fv_…</code>, expira em 1 hora) para não contar a mesma visita várias vezes. A contagem em si é só um número por projeto e por dia — quantas visitas e quantos acessos às fotos —, sem identificar quem visitou; a contagem por dia é apagada depois de 400 dias.</li>
      <li><strong>Cookie de contagem da galeria</strong> (<code>gv_…</code>, expira em 1 hora) para não contar a mesma abertura da galeria várias vezes. A contagem segue a mesma regra: só um número por projeto e por dia — quantas aberturas da galeria e quantos downloads de fotos —, sem identificar ninguém.</li>
      <li><strong>Cookie do álbum restrito</strong> (<code>galeria</code>, expira em 12 horas, assinado e preso ao endereço da galeria daquele projeto): é o que mantém a galeria de projetos familiares e privados liberada depois do aceite dos Termos e da declaração de categoria.</li>
      <li><strong>Medição de acesso anônima e sem cookies</strong> (Cloudflare Web Analytics), que não identifica visitantes individualmente.</li>
      <li><strong>Contagem por capítulo</strong>: nos projetos com a galeria dividida em capítulos, as contagens de aberturas e de downloads também são separadas por capítulo. É só um número por projeto, por capítulo e por dia, sem identificar ninguém, e apagado depois de 400 dias, como as demais.</li>
      <li><strong>Última visita, só no seu aparelho</strong> (<code>localStorage</code>, chaves <code>gal-visita:…</code>): a galeria guarda no seu navegador o instante da sua última visita a cada projeto ou capítulo, só para destacar as fotos que chegaram depois. Não é cookie, não é enviado ao servidor e some quando você limpa os dados do site.</li>
    </ul>
    <p><strong>Dados lidos do Google Drive.</strong> Para montar a galeria, o site lê da pasta do Drive o nome e o tamanho de cada arquivo, o nome da subpasta de créditos (que indica o <strong>autor</strong> da foto) e a <strong>data e hora de captura</strong> gravadas no arquivo. Não lê localização (GPS) nem dados da câmera.</p>
    <p><strong>Cópia da lista de fotos (banco de dados).</strong> Duas tabelas guardam só o que a galeria já mostra: a <em>última lista lida</em> de cada pasta (id, nome do arquivo, medidas, autor, capítulo e data/hora de captura), usada para a galeria continuar funcionando e para perceber fotos que sumiram da pasta, e a lista de <em>fotos apagadas recentemente</em> (as mesmas informações de cada foto, mais o momento em que o sumiço foi percebido), para eu ser avisado. Não há e-mail, localização nem dado de visitante nessas tabelas.</p>

    <h2>3. As fotos dos eventos</h2>
    <p>O tratamento dos dados e imagens obedece à natureza de cada projeto:</p>
    <ul>
      <li><strong>Projetos Familiares:</strong> Conforme o <strong>art. 4º, I, da LGPD</strong>, o tratamento realizado para fins estritamente particulares e não econômicos é isento da aplicação da lei. Protegemos o acesso para garantir a privacidade da família.</li>
      <li><strong>Projetos Privados:</strong> A publicação nas galerias apoia-se no <strong>legítimo interesse</strong> (art. 7º, IX, da LGPD) para entregar o material aos participantes, sustentado pela autodeclaração de participação no acesso.</li>
      <li><strong>Projetos Públicos:</strong> Envolvem fotografias sem expectativa de privacidade de terceiros, preservando os direitos autorais. As páginas e as fotos dessas galerias podem aparecer em buscadores (como o Google), inclusive na busca de imagens; as de projetos familiares e privados ficam fora da indexação, e os downloads não são indexados em nenhum caso. O site pede aos buscadores que não usem o conteúdo para treinar inteligência artificial, mas não controla o que esses serviços fazem. Quando alguém pede a remoção de uma foto (ou o responsável decide tirá-la), ela sai da galeria e do mapa do site em até 2 minutos (o tempo de a alteração chegar a todo o site) e o download dela deixa de funcionar; o resultado no buscador, porém, pode levar um tempo para atualizar, e, quando for urgente, eu solicito a remoção diretamente ao buscador, pela ferramenta de remoção do Google Search Console. A foto original pode continuar no Drive até ser apagada lá.</li>
    </ul>
    <p><strong>Fotos de terceiros e de menores em álbuns públicos.</strong> Um álbum pode reunir fotos de mais de uma pessoa (a pasta do Drive pode ser colaborativa) e mostrar terceiros e menores de idade. Por isso há sempre um canal de remoção, na própria galeria e no rodapé do evento, e os pedidos de quem é <strong>responsável por um menor</strong> têm prioridade. O autor da foto é avisado do pedido e da decisão, <strong>sem receber os dados de contato</strong> de quem pediu.</p>
    <p>Para uso em portfólio, a exibição segue o legítimo interesse. Qualquer pessoa retratada pode exercer seu direito de oposição solicitando a remoção da imagem pelo canal facilitado no rodapé do evento.</p>

    <h2 id="busca-rosto">3.1. Busca pelo rosto</h2>
    <p>Alguns álbuns públicos têm o botão <em>“Procurar meu rosto”</em>: você envia uma selfie e o site mostra as fotos do álbum em que você provavelmente aparece. O rosto é um <strong>dado biométrico</strong>, um dado pessoal sensível (art. 5º, II, e art. 11 da LGPD), e por isso a busca funciona assim:</p>
    <ul>
      <li><strong>Só com o seu consentimento.</strong> A busca só começa depois que você marca que concorda, a cada vez. A selfie é reduzida no seu aparelho, enviada à <strong>Amazon Rekognition</strong> (Amazon Web Services, região de São Paulo) só para a comparação e <strong>não é guardada</strong> nem pelo site nem pela Amazon.</li>
      <li><strong>O índice do álbum.</strong> Para a comparação, cada rosto das fotos do álbum vira um código numérico (um “vetor”), guardado na Amazon Rekognition. O código não traz nome nem identifica ninguém sozinho: só diz em qual foto há um rosto parecido. Ele é montado a partir das fotos públicas do álbum e acompanha o álbum: foto oculta ou removida sai do índice.</li>
      <li><strong>Você pode sair da busca.</strong> Pelo link <em>“Não quero aparecer na busca”</em>, no mesmo botão, você envia uma selfie e o site tira o seu rosto do índice; ninguém mais acha as suas fotos pela busca, nem as que chegarem depois: a cada leva de fotos novas, os rostos parecidos com o seu são apagados do índice antes de a busca os mostrar. Para isso o seu rosto fica guardado, só para esse fim, até o fim do álbum. O site não guarda quais eram as suas fotos. Como o pedido aceita qualquer foto de rosto, o responsável vê a data de cada saída (nunca a foto) e pode desfazer uma que tenha sido feita por outra pessoa no seu lugar. Também pode pedir por <a href="mailto:privacidade@lucafchala.com">privacidade@lucafchala.com</a>.</li>
      <li><strong>Resultado aproximado.</strong> A comparação é automática e pode errar para os dois lados; ela não identifica pessoas por nome e não toma decisão nenhuma sobre você.</li>
      <li><strong>Use só com o seu rosto.</strong> Procurar outra pessoa sem a autorização dela não é permitido: a busca existe para cada um achar as próprias fotos.</li>
      <li><strong>“Ver minhas fotos” neste aparelho.</strong> O resultado fica guardado no seu navegador por até 30 dias, com a lista das fotos e até quatro códigos de rostos <strong>do índice do álbum</strong> (nunca a selfie). Quando chegam fotos novas, o site usa esses códigos para procurar as novas, sem pedir outra selfie. “Esquecer neste aparelho” apaga tudo.</li>
    </ul>

    <h2 id="aviso-fotos">3.2. Aviso de fotos novas</h2>
    <p>Nos álbuns que têm o botão <em>“Avisar quando chegar foto nova”</em>, você pode receber uma notificação no celular ou no computador. Só funciona se você tocar no botão e o navegador pedir a sua permissão. O site guarda o endereço de entrega que o seu navegador cria para isso (um link do serviço de notificação do Google, da Apple, da Mozilla ou da Microsoft) e as chaves que cifram o aviso, sem nome, e-mail ou telefone. O texto vai cifrado: o serviço de notificação não o lê. Para parar, toque de novo no botão (“Desligar”) ou bloqueie as notificações do site no navegador; o endereço é apagado na hora ou quando o serviço de notificação o recusar, é apagado junto com o álbum, e vence sozinho se passar 400 dias sem que um aviso seja entregue a ele. Base legal: o seu consentimento (art. 7º, I, da LGPD).</p>

    <h2>4. Com quem os dados são compartilhados</h2>
    <p>Para funcionar, o site utiliza serviços de terceiros que podem processar dados:</p>
    <ul>
      <li><strong>Google Drive</strong> — hospeda e disponibiliza as fotos e os vídeos dos eventos. Nos vídeos da galeria, o player do Google Drive só é carregado quando você toca para reproduzir; a partir daí, o Google passa a ser um terceiro que recebe os dados do seu acesso, e vale a <a href="https://policies.google.com/privacy" target="_blank" rel="noopener">Política de Privacidade do Google</a>.</li>
      <li><strong>Resend</strong> — envio dos e-mails das solicitações, do suporte e dos códigos de acesso.</li>
      <li><strong>Serviços de notificação do navegador (Google, Apple, Mozilla, Microsoft)</strong> — só para quem liga o aviso de fotos novas: entregam a notificação ao seu aparelho, cifrada. Ver a seção 3.2.</li>
      <li><strong>Amazon Web Services (Amazon Rekognition)</strong> — só nos álbuns com busca pelo rosto: compara a selfie com o índice do álbum, na região de São Paulo. Ver a seção 3.1.</li>
      <li><strong>YouTube (Google)</strong> — só em projetos que têm um vídeo na página. A imagem de capa do vídeo vem do YouTube junto com a página; o player em si só é carregado quando você clica em reproduzir, no modo de privacidade aprimorada (<code>youtube-nocookie.com</code>). A partir daí vale a <a href="https://policies.google.com/privacy" target="_blank" rel="noopener">Política de Privacidade do Google</a>.</li>
      <li><strong>Cloudflare</strong> — hospedagem do site, guarda de <strong>cópias das fotos</strong> dos álbuns (miniaturas e, quando alguém baixa, o arquivo) para a galeria abrir rápido — a cópia de uma foto é apagada quando ela é ocultada, removida ou apagada da pasta —, medição anônima de acesso e proteção contra robôs (Turnstile). O Turnstile verifica sinais do navegador para distinguir pessoas de robôs, sem coletar dados para publicidade. Na maior parte dos acessos isso acontece sem nenhuma ação sua; quando a Cloudflare julga necessário, ele pode pedir uma confirmação simples (como marcar uma caixa). Consulte o <a href="https://www.cloudflare.com/turnstile-privacy-policy/" target="_blank" rel="noopener">Adendo de Privacidade do Turnstile da Cloudflare</a>.</li>
    </ul>
    <p>Os dados não são vendidos nem usados para publicidade.</p>

    <h2>4.1. Transferência internacional de dados</h2>
    <p>Todos os serviços listados acima são operados por empresas <strong>sediadas nos Estados Unidos</strong>, com infraestrutura distribuída globalmente. Isso significa que os seus dados — inclusive as fotografias — são tratados fora do Brasil.</p>
    <p>Essa transferência se apoia no <strong>art. 33, inciso II, alíneas “a” e “b”, da LGPD</strong>: cada um desses fornecedores oferece garantias por meio de cláusulas contratuais específicas de proteção de dados (<em>Data Processing Agreements</em>), que incorporam as cláusulas-padrão internacionais e obrigam o fornecedor a um nível de proteção compatível com a lei brasileira.</p>
    <p class="note">Em outras palavras: o site não roda em servidor no Brasil, e é justo que você saiba disso. A proteção dos seus dados fora do país está garantida por contrato com cada fornecedor, não por promessa minha.</p>

    <h2>4.2. Decisões automatizadas</h2>
    <p><strong>Não existem.</strong> Nenhum tratamento neste site toma decisão automatizada que produza efeito jurídico ou afete você de forma significativa (art. 20 da LGPD). A busca pelo rosto (seção 3.1) só sugere fotos para você conferir. A verificação anti-robô (Turnstile) apenas distingue pessoas de programas para liberar um formulário — e, se ela falhar, você pode receber um código por e-mail e seguir, ou usar o caminho humano: <a href="https://wa.me/5511989211178" target="_blank" rel="noopener">WhatsApp</a> ou e-mail, indicados na própria tela.</p>

    <h2>5. Por quanto tempo guardamos</h2>
    <ul>
      <li><strong>Solicitações de remoção:</strong> mantidas enquanto necessárias para atender ao pedido e <strong>apagadas automaticamente em até 6 meses após a resolução</strong>.</li>
      <li><strong>Cópia da lista de fotos de cada pasta:</strong> uma linha por pasta, substituída a cada atualização e apagada junto com o projeto.</li>
      <li><strong>Fotos apagadas recentemente:</strong> registradas por <strong>30 dias</strong> e apagadas automaticamente depois disso (ou junto com o projeto).</li>
      <li><strong>Busca pelo rosto:</strong> a selfie da busca não é guardada. O índice de rostos de um álbum é apagado na hora quando o álbum é excluído, e em até 4 dias quando a busca é desligada. O rosto de quem pediu para sair da busca fica guardado só para isso, até o índice ser apagado.</li>
      <li><strong>Mensagens de suporte:</strong> não ficam armazenadas no sistema do site — são entregues por e-mail para mim.</li>
      <li><strong>E-mail do código de acesso:</strong> não fica armazenado no site; o resumo (hash) usado para limitar envios some em até 2 horas.</li>
      <li><strong>Registros de autorização de uso de imagem:</strong> mantidos como comprovação do consentimento durante o prazo em que a autorização pode ser questionada e <strong>apagados automaticamente após 5 anos</strong>. Uma cópia deles também entra no arquivo de backup do site: fica guardado pelo responsável, protegido, e segue o mesmo prazo de 5 anos.</li>
    </ul>

    <h2>6. Seus direitos</h2>
    <p>O art. 18 da LGPD garante a você, <strong>gratuitamente e sem precisar criar conta</strong>:</p>
    <ul>
      <li><strong>Confirmação</strong> de que existe (ou não) tratamento de dados seus;</li>
      <li><strong>Acesso</strong> aos dados que tenho sobre você;</li>
      <li><strong>Correção</strong> de dados incompletos, inexatos ou desatualizados;</li>
      <li><strong>Anonimização, bloqueio ou eliminação</strong> de dados desnecessários, excessivos ou tratados fora da lei;</li>
      <li><strong>Portabilidade</strong> a outro fornecedor, mediante requisição expressa;</li>
      <li><strong>Eliminação</strong> dos dados tratados com o seu consentimento;</li>
      <li><strong>Informação</strong> sobre com quem os dados são compartilhados (está na seção 4 acima);</li>
      <li><strong>Informação</strong> sobre o que acontece se você não consentir — no caso do acesso às fotos, sem o aceite dos Termos o link do Drive não é liberado, mas isso <em>não</em> impede você de pedir a remoção de uma foto sua;</li>
      <li><strong>Revogação do consentimento</strong>, a qualquer momento;</li>
      <li><strong>Oposição</strong> a tratamento feito com base no legítimo interesse — este é o direito que se aplica se você aparece numa foto e nunca preencheu nada aqui.</li>
    </ul>
    <p>Para exercer qualquer um deles, escreva para mim em <a href="mailto:privacidade@lucafchala.com">privacidade@lucafchala.com</a> ou me chame no <a href="https://wa.me/5511989211178" target="_blank" rel="noopener">WhatsApp</a>.</p>
    <p><strong>Para pedir a remoção de uma foto sua</strong>, o caminho mais rápido é o botão <em>“Solicitar remoção de foto”</em> no rodapé da página de cada evento ou, na galeria, o link <em>“Pedir remoção”</em> com a foto aberta. O pedido chega a mim e a foto <strong>continua na galeria até eu decidir</strong>; quem se declara <strong>responsável por um menor</strong> na foto tem prioridade. Eu decido, você recebe a resposta por e-mail e o autor da foto é avisado, sem receber os seus dados de contato. Respondo em até <strong>15 dias</strong>.</p>
    <p>Para confirmar que o pedido é mesmo seu, posso pedir alguma informação que ajude a te identificar na foto (o evento, o número da imagem). <strong>Não peço documento de identidade como primeiro passo</strong> — exigir RG ou CPF de quem está justamente pedindo menos exposição seria coletar mais dados do que o necessário.</p>

    <h2>6.1. Se você não concordar com a minha resposta</h2>
    <p>Você pode apresentar reclamação à <strong>Autoridade Nacional de Proteção de Dados (ANPD)</strong>, em <a href="https://www.gov.br/anpd/" target="_blank" rel="noopener">gov.br/anpd</a>, ou aos órgãos de defesa do consumidor. Se eu recusar algum pedido, explico o motivo por escrito, citando o fundamento legal — você não vai receber um “não” sem justificativa.</p>

    <h2>7. Alterações nesta política</h2>
    <p>Esta política pode ser atualizada para refletir mudanças no site ou na legislação. A data de atualização no topo indica a versão vigente.</p>

    <h2>8. Menores de idade</h2>
    <p>Os eventos fotografados (formaturas, eventos escolares e familiares) podem incluir <strong>crianças e adolescentes</strong>. O tratamento da imagem de menores observa o <strong>art. 14 da LGPD</strong> e o seu melhor interesse: o consentimento é dado pelos <strong>pais ou pelo responsável legal</strong> — coletado, quando aplicável, junto à instituição contratante no momento do evento e/ou no aceite dos <a href="/termos">Termos de Uso</a> feito por quem acessa as fotos na condição de responsável.</p>
    <p>Pedidos de remoção de imagens de menores têm <strong>prioridade</strong> e podem ser feitos a qualquer momento por um responsável, pelo botão <em>“Solicitar remoção de foto”</em> no rodapé do evento ou por <a href="mailto:privacidade@lucafchala.com">privacidade@lucafchala.com</a>.</p>

    <h2>9. Como os dados são protegidos</h2>
    <p>As medidas não são genéricas — cada uma está implementada e descrita em detalhe na <a href="/legal/seguranca-da-informacao">política de segurança da informação</a>, com o ponteiro para o trecho de código que a executa:</p>
    <ul>
      <li><strong>Conexão sempre cifrada</strong> (HTTPS obrigatório) e política de segurança de conteúdo restritiva em todas as páginas.</li>
      <li><strong>Acesso às fotos protegido no servidor</strong>: o link do Google Drive não fica no código da página — ele só é liberado após a verificação anti-robô e o aceite dos Termos.</li>
      <li><strong>Painel administrativo</strong> com senha derivada por PBKDF2 (100 mil iterações), sessão curta e limite de tentativas com alerta por e-mail.</li>
      <li><strong>Coleta mínima</strong>: a mensagem de suporte não é guardada em banco nenhum, e a foto enviada num pedido de remoção não é armazenada — trafega apenas no e-mail.</li>
      <li><strong>Metadados removidos</strong>: se você envia uma foto para pedir a remoção, os metadados EXIF (que costumam incluir <strong>a localização por GPS</strong> de onde a foto foi tirada, o modelo do aparelho e a hora exata) são <strong>apagados no servidor</strong> antes de qualquer coisa. Você está pedindo menos exposição, não mais.</li>
      <li><strong>Apagamento automático</strong> dos prazos da seção 5, executado por rotina diária — com verificação de que a rotina de fato rodou.</li>
    </ul>

    <h2>10. Incidentes de segurança</h2>
    <p>Caso ocorra um incidente que possa acarretar risco ou dano relevante aos titulares, comunicarei a <strong>ANPD</strong> e as pessoas afetadas em até <strong>3 dias úteis</strong> do meu conhecimento do fato, conforme o art. 48 da LGPD e a Resolução CD/ANPD nº 15/2024. A comunicação dirá o que aconteceu, quais dados foram afetados e o que fazer a respeito.</p>
    <p>Suspeitas de vulnerabilidade podem ser reportadas a <a href="mailto:security@lucafchala.com">security@lucafchala.com</a> — há chave PGP e política de divulgação responsável no <a href="/.well-known/security.txt">security.txt</a>.</p>

    <p class="note">Em caso de dúvida sobre seus dados, fale comigo — a remoção de fotos e o atendimento a pedidos são gratuitos e simples.</p>
  </main>
  <footer>
    <a href="/">fotos · lucafchala</a>
    ${footerLegalLinksHTML()}
  </footer>
</body>
</html>`;
}
