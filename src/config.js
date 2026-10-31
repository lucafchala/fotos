// ---------------------------------------------------------------------------
// Constantes de configuração do Worker
// ---------------------------------------------------------------------------
// O módulo de entrada de um Worker só pode exportar função ou classe — um
// `export const` em index.js derruba o workerd na inicialização. Por isso
// essas constantes moram aqui e não lá. Constante nova: sempre neste arquivo.

// Segredo curto é pior que nenhum (o painel jura "protegido" mas é forçável).
// 32 caracteres aleatórios torna a força bruta offline inviável.
export const SIGNING_SECRET_MIN_LENGTH = 32;

// Nonce do portão do Drive: 2h cobre quem lê a página com calma e ainda torna
// o token inútil como ferramenta de varredura no dia seguinte.
export const DRIVE_NONCE_TTL_SECS = 7200;

// Formulários públicos: janela longa (escrever devagar) com piso de 3s contra
// automação — nenhum humano preenche e envia mais rápido que isso.
export const FORM_TOKEN_TTL_SECS = 7200;
export const FORM_TOKEN_MIN_AGE_SECS = 3;

// Valores de partida de um projeto novo, e de qualquer campo que falte num
// projeto antigo. A criação passa isto como base; a edição passa o projeto
// existente.
export const DEFAULT_EVENT = {
  title: '', longDescription: '',
  driveUrl: '', driveUrlInstagram: '', driveUrlVideos: '', youtubeId: '', youtubeMais: [], date: '', eventCredits: '',
  projectUrl: '', promisedDate: '', visible: true, comingSoon: false, status: 'entregue',
  accessType: 'public', category: '', internalNotes: '', pinned: false, photoAlts: [], fotosOcultas: [],
  photosAlert: { active: false, addedAt: null, expiresAfterHours: 24, kind: 'fotos' },
};

// Chave PÚBLICA do widget Turnstile (site key) — vai para o HTML de propósito;
// a secreta é o TURNSTILE_SECRET_KEY, que só existe como secret do Worker.
// Uma constante só para as duas páginas que desenham o widget (projeto e
// /suporte): eram duas cópias da mesma string, e trocar a chave no painel da
// Cloudflare atualizaria uma e esqueceria a outra — o formulário que ficasse
// com a velha recusaria todo envio.
export const TURNSTILE_SITE_KEY = '0x4AAAAAADg-tbuoPRO9s2I5';

// Rate limit por IP do portão do Drive — balde de fichas (RateLimiter.take).
// Dimensionado para o caso real de pico: o público de um evento abrindo o
// link AO MESMO TEMPO, no Wi-Fi do local — e um Wi-Fi de local é UM IPv4
// público (NAT) para todos. Com a janela fixa antiga de 60/h, 750 pessoas no
// mesmo Wi-Fi viravam 60 com fotos e 690 com "Muitas tentativas" até virar a
// hora. Agora: `capacity` é a rajada que cabe de uma vez; `perHour`, o ritmo
// em que as fichas voltam — esvaziou, a espera é de segundos (o 429 diz
// quantos), não de uma hora.
//
// O limite é a SEGUNDA camada: quem barra robô é o Turnstile + o nonce
// assinado por slug. Este número só tem de ficar acima do maior público que
// divide um IP. O noscript é mais apertado porque não tem Turnstile, mas
// precisa caber a fração de um público com bloqueador de anúncios — a
// varredura por esse caminho tem alerta próprio (abaixo), que olha projetos
// distintos, não volume.
export const DRIVE_GATE_BUCKET = { capacity: 1500, perHour: 1500 };
export const DRIVE_GATE_NOSCRIPT_BUCKET = { capacity: 300, perHour: 300 };
// O clique no Drive (/api/track-drive) é só métrica, sem Turnstile: a rajada
// de um evento cabe (1000), mas o ritmo sustentado é baixo, para um flood não
// gastar a franquia de escrita do Durable Object (100 mil linhas/dia).
export const DRIVE_CLICK_BUCKET = { capacity: 1000, perHour: 200 };

// Download da galeria (/galeria/<slug>/baixar/<id>): por IP, balde de fichas
// (RateLimiter.take), SEM portão — a galeria dos álbuns públicos é aberta, e
// cada download gasta uma passada pelo Worker, 1–2 listas do Drive (quando
// frias) e a cota de download do arquivo no Google. Sem limite, um único
// cliente esvaziava a cota do Drive de todo mundo.
//
// Dimensionado, de novo, para o caso real de pico (um Wi-Fi de local = UM IPv4
// público): ~750 pessoas, cada uma baixando ~20 fotos ao longo de uma hora =
// ~15 mil downloads/h pelo mesmo IP, ou 4 por segundo, constantes. `perHour`
// 20 mil (5,6/s) cobre isso com folga de um terço. `capacity` 6 mil é a
// rajada: quando o link sai no grupo, metade do público baixa nos primeiros
// 10 minutos (7,5 mil downloads) — 6 mil de balde + as ~3,3 mil que voltam
// nesses 10 min cobrem — e cabem vários "baixar tudo" ao mesmo tempo (uma
// pessoa baixando um álbum de 244 fotos usa 244). Esvaziou, a espera é de
// segundos (o 429 diz quantos). O dono, logado, não passa por aqui.
//
// É a SEGUNDA camada, como no portão: o que segura o abuso de verdade é a cota
// de download do Google por arquivo e o teto de CPU do plano; este número só
// precisa ficar acima do maior público que divide um IP e abaixo do que um
// robô de um IP só consegue arrancar por hora. Custo de cota: 1 linha escrita
// de Durable Object por download (a ficha), somada às 2 da contagem de
// baixadas — o dia de um evento de 750 pessoas fica em ~45 mil das 100 mil
// linhas/dia do plano gratuito (TODO.md).
export const GALERIA_BAIXAR_BUCKET = { capacity: 6000, perHour: 20000 };

// Robôs conhecidos, fora da contagem de visitas e de aberturas da galeria
// (o Google rastreia a galeria desde a v3: sem este filtro, cada rastreio
// virava "uma pessoa abriu"). Lista curta e CONSERVADORA, sobre o User-Agent:
// só nomes que o robô se dá de propósito — nada de "bot" genérico, que
// engoliria visitante de verdade. Além dela, o próprio Cloudflare marca os
// robôs verificados (`request.cf.botManagement.verifiedBot`, quando o plano
// o inclui). O que não está aqui nem é verificado ainda entra na contagem:
// os números do painel PODEM incluir robôs desconhecidos.
export const ROBO_UA_RE = new RegExp('\\b(?:' + [
  'Googlebot', 'Google-InspectionTool', 'GoogleOther', 'Storebot-Google', 'AdsBot-Google', 'APIs-Google',
  'bingbot', 'BingPreview', 'DuckDuckBot', 'YandexBot', 'Baiduspider', 'Applebot', 'Slurp',
  'AhrefsBot', 'SemrushBot', 'MJ12bot', 'PetalBot', 'Bytespider', 'GPTBot', 'ClaudeBot', 'CCBot',
  'facebookexternalhit', 'Twitterbot', 'LinkedInBot', 'Slackbot', 'UptimeRobot',
].join('|') + ')\\b', 'i');

// Código por e-mail — o último recurso do portão do Drive, para quem não passa
// pelo Turnstile (VPN, bloqueador que quebra o desafio sem bloquear o script)
// ou ficou sem fichas. O código não é guardado em lugar nenhum: o servidor
// devolve um token HMAC sobre (slug, código, prazo), e só quem recebeu o
// e-mail sabe o código que fecha a assinatura. Zero escrita de KV.
export const EMAIL_CODE_TTL_SECS = 15 * 60;
// Envios por IP (balde: o Wi-Fi do evento é um IP só) e por endereço (janela
// fixa — impede usar o site para encher a caixa de alguém).
export const EMAIL_CODE_SEND_BUCKET = { capacity: 60, perHour: 60 };
export const EMAIL_CODE_PER_ADDRESS_PER_HOUR = 3;
// Teto do DIA para a conta inteira, na virada UTC. A franquia do Resend é
// dividida com suporte, remoção e alertas — este teto é o que garante que um
// abuso do código por e-mail não cale os outros e-mails do site.
export const EMAIL_CODE_DAILY_CAP = 40;
// Tentativas de confirmar o código, por IP. 6 dígitos = 1 milhão de
// combinações; 120/h por IP leva anos. E o prêmio é o mesmo link que o
// caminho noscript entrega sem desafio nenhum.
export const EMAIL_CODE_VERIFY_BUCKET = { capacity: 120, perHour: 120 };
// O formato de e-mail aceito pelo servidor — um só para todo formulário.
export const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

// Formulários de suporte e de remoção (LGPD): baixo volume, mas no mesmo IP
// de um evento. 5/h deixava a sexta pessoa do local sem poder pedir remoção.
export const FORM_LIMIT_PER_HOUR = 20;

// Varredura pelo caminho noscript do portão do Drive (#147). O fallback para
// quem tem o Turnstile bloqueado entrega o link sem desafio, e um script que já
// carregou a página consegue percorrer o catálogo por ele. Quem usa bloqueador
// de verdade abre um ou dois projetos; CINCO projetos distintos do mesmo IP em
// 24 h por esse caminho é o formato de coleta, não de visita. Volume num
// projeto só NÃO alerta: é indistinguível de um grupo atrás do mesmo IP (uma
// escola, um evento) com bloqueador — ver SECURITY.md.
export const NOSCRIPT_SWEEP_MIN_SLUGS = 5;
export const NOSCRIPT_SWEEP_WINDOW_SECS = 24 * 3600;
// Álbum restrito (família/privado) pelo caminho noscript (#146). O modelo é
// "consentimento, não sigilo": a declaração registra o uso combinado, não
// barra ninguém. Duas coisas apertam só este caminho, que não tem desafio:
//   - o nome é obrigatório, para o registro de consentimento não sair anônimo;
//   - um IP abre no máximo este número de álbuns restritos DISTINTOS na janela
//     do alerta acima (24 h). Conta álbuns, não pedidos: o mesmo álbum abre
//     quantas vezes for preciso, e o público de um evento atrás do Wi-Fi do
//     local nunca chega perto. Quem tem bloqueador abre um álbum restrito,
//     às vezes dois ou três da mesma família; quem varre o catálogo quer todos.
// Passou do teto, o portão oferece o código por e-mail, que prova uma caixa
// de e-mail e não conta aqui.
export const NOSCRIPT_RESTRITOS_POR_IP = 3;
// Um alerta a cada 6 h no máximo, para o conjunto — não por IP: com rotação de
// IP, um cooldown por IP viraria enxurrada de e-mails e de escritas no KV.
export const NOSCRIPT_SWEEP_ALERT_COOLDOWN_SECS = 6 * 3600;

// Versão do CONTRATO do /api/healthz: os campos que o smoke do deploy e o
// painel de status (status.lucafchala.com) leem. O contrato inteiro — nome e
// tipo de cada campo, e um exemplo — mora em docs/healthz-contrato.json, e
// é aquele arquivo, não esta constante, que os dois lados conferem:
//   • tests/healthz-contrato.test.js prende o healthz de verdade ao arquivo
//     (campo novo sem contrato reprova, campo do contrato que sumiu reprova);
//   • o CI do status baixa o arquivo e reprova se o status ler um campo que
//     o contrato não tem.
// Suba o número só quando um campo MUDAR de sentido ou sair — acrescentar
// campo não quebra quem lê, e o arquivo já registra o acréscimo.
export const HEALTHZ_CONTRATO = 1;

// ---------------------------------------------------------------------------
// Galeria própria (#234/#235) — aberta nos álbuns públicos; família/privado com passe
// ---------------------------------------------------------------------------
// A lista da pasta do Drive fica guardada por 10 min (memória do isolate +
// Cache API, sem escrita de KV). "Atualizar lista" na página força a releitura.
export const GALERIA_LISTA_TTL_S = 600;
// Tetos que mantêm UMA requisição dentro do plano gratuito: cada página da
// Drive API (até 1000 arquivos) é uma subrequisição, e o plano gratuito dá 50
// por invocação. Passou de algum teto, a lista sai PARCIAL e a página avisa —
// nunca um erro.
export const GALERIA_MAX_FOTOS = 6000;
export const GALERIA_MAX_PASTAS = 25;
// Raiz = 0. Duas camadas de subpasta cobrem "Cerimônia / Festa" e
// "Dia 1 / Manhã"; mais fundo que isso é arquivo de trabalho, não galeria.
export const GALERIA_MAX_PROFUNDIDADE = 2;
export const GALERIA_MAX_CHAMADAS = 30;
// Pasta do Instagram (campo `driveUrlInstagram` do projeto): o download "para
// redes" entrega, byte a byte, o arquivo de lá — nada é redimensionado pelo
// site. Ela é listada junto com a pasta da galeria na MESMA invocação (página e
// download), então o teto próprio entra na conta das 50 subrequisições do plano
// gratuito, no PIOR caso (download "para redes", as duas listas frias e
// enormes, visitante sem sessão): 30 (galeria) + 8 (esta) + 6 do cache (match e
// put de cada lista, mais o do casamento "para redes") + 5 do resto (KV do
// projeto, ficha do limite por IP, contador, o arquivo) = 49 < 50. Está
// medido em tests/galeria.test.js ("orçamento"): subir qualquer teto aqui, ou
// gastar uma subrequisição a mais nesse caminho, reprova o teste.
// Passou do teto, as fotos do fim da lista ficam sem versão "para redes".
export const GALERIA_MAX_CHAMADAS_IG = 8;
// Casamento "para redes" (casaRedes, drive.js) — o que custa de CPU. O plano
// gratuito dá 10 ms por invocação, e a conta de nomes de 6000 fotos contra
// 6000 do Instagram (normalizar, minusculizar, tirar o sufixo, procurar) custa,
// medido no node (CPU, 6000 × 6000, lista nova a cada rodada): antes ~7 ms no
// melhor caso e 15–37 ms na mediana; agora ~6,5 ms (mediana ~7 ms) calculando,
// e ~1,5 ms remontando do cache — e várias vezes isso num isolate frio (JIT
// frio), o suficiente para estourar. Por isso: (1) o índice de nomes do
// Instagram é montado UMA vez por listagem dele; (2) nome ASCII não passa por
// `normalize()`; (3) o RESULTADO (uma posição por foto, ~7 bytes cada) é
// guardado ao lado das listagens, na memória e na Cache API, com o mesmo
// prazo (GALERIA_LISTA_TTL_S) — um isolate novo só remonta o mapa, sem
// comparar nome. A conta de nomes acontece uma vez por listagem (10 min), não
// por visita. Custo em subrequisições: +1 match e, só quando calcula, +1 put.

// Teto de fotos ocultas por projeto (o dono esconde uma foto da galeria pelo
// visualizador, #235). A lista mora no próprio evento, no KV `events`, que
// toda página lê: 500 IDs são ~20 KB a mais, longe do 1 MB por chave.
export const GALERIA_MAX_OCULTAS = 500;
// Escada de larguras do visualizador, do menor ao maior. O navegador escolhe a
// menor que cobre a foto NA TELA em pixels físicos (srcset + sizes), e o zoom
// sobe o `sizes` — então ampliar busca o próximo degrau, até o original.
// Degraus acima do tamanho real da foto são cortados na hora de montar.
export const GALERIA_LARGURAS = [480, 800, 1200, 1600, 2048, 2560, 3200, 4096, 5120, 6400];
// Miniaturas da grade: a menor que cobre o quadradinho em pixels físicos.
// Degraus de 100 px até 800: no celular a miniatura ocupa a largura da tela
// (~390 px × DPR 1,75–3), e um degrau largo baixava até 30% a mais que o
// necessário em cada foto da primeira tela.
export const GALERIA_LARGURAS_GRADE = [200, 300, 400, 500, 600, 700, 800, 1000, 1200, 1600];

// ---------------------------------------------------------------------------
// Métricas por dia (v2, #215)
// ---------------------------------------------------------------------------
// Cada contador do Durable Object `Counter` (visitas, cliques no Drive, modo
// de entrada no portão) ganha também um balde por DIA de São Paulo, gravado
// na mesma chamada e na mesma gravação do total. Os baldes mais velhos que
// isto são podados uma vez por dia: 400 dias cobrem um ano inteiro e a
// comparação com o mesmo mês do ano anterior, sem a série crescer para sempre.
export const METRICAS_RETENCAO_DIAS = 400;
// O máximo que /api/metrics/diario devolve de uma vez. O painel pede 180 para
// comparar o maior período (90 dias) com os 90 anteriores.
export const METRICAS_DIAS_MAX = 180;
// Os modos de passar pelo portão do Drive, na ordem do `turnstile_ok` do
// registro de consentimento (0, 1, 2). Só a contagem — sem slug, sem IP.
export const GATE_METODOS = /** @type {const} */ (['noscript', 'turnstile', 'email']);

// ---------------------------------------------------------------------------
// Versões: como o site é numerado (leia antes de mexer em VERSAO)
// ---------------------------------------------------------------------------
// "Versão" aqui quer dizer três coisas, e cada uma responde a uma pergunta:
//
// 1. VERSAO, logo abaixo: "o que mudou para quem usa?" É versionamento
//    semântico (MAIOR.MENOR.CORREÇÃO, https://semver.org/lang/pt-BR/),
//    escrito à mão. É o número que o dono e quem testa leem: a barra lateral
//    do painel, Ajustes → Sobre, a faixa da prévia de PR e `versaoSite` no
//    /api/healthz. Mora em dois lugares que andam juntos, aqui e no
//    "version" do package.json, e o CHANGELOG.md abre com a seção dele —
//    tests/versao.test.js reprova se os três divergirem.
// 2. A implantação da Cloudflare: "qual build está no ar?" É o id que o
//    deploy gera (`wrangler versions upload`), lido do binding
//    [version_metadata] e mostrado em `versao` no /api/healthz (`id`, e `tag`
//    = o commit). Muda a cada deploy, com ou sem VERSAO nova, e é por ele que
//    se volta atrás: `wrangler versions deploy <id>`.
// 3. A etiqueta do git `deploy-AAAAMMDD-HHMMSS-<commit>` e o GitHub Release
//    que o .github/workflows/deploy.yml cria quando o smoke de produção
//    passa: "o que foi ao ar, quando, e o que veio desde o anterior".
//
// Quando subir VERSAO. Merge na main é deploy, então o número sobe no PR, uma
// vez por PR (não um por commit), junto com a seção dele no topo do
// CHANGELOG.md, marcada "— ainda não publicada" até o merge. Enquanto a
// versão não foi publicada, o que mais entrar no mesmo PR vai para a mesma
// seção, sem número novo.
//   - MAIOR (3.0.0): o dono precisa fazer algo para a versão funcionar, ou
//     algo deixa de valer. Formato de dado gravado que muda (KV, D1, backup),
//     secret ou binding novo obrigatório, mudança no que o visitante aceita
//     (Termos, modelo de consentimento), função que sai. A 2.0.0 é a primeira
//     com número: pedidos de remoção numa chave cada e métricas por dia.
//   - MENOR (2.1.0): função nova que o dono ou o visitante veem, sem quebrar
//     nada do que já existe.
//   - CORREÇÃO (2.0.1): defeito corrigido, texto, acessibilidade,
//     desempenho, dependência — o mesmo comportamento, melhor. Os documentos
//     de docs/legal/ contam: o site os serve (src/content/legal-docs.js).
//   - Nada: PR que não muda o que vai ao ar — só README e docs/ fora de
//     docs/legal, só testes, só CI. Não sobe número.
// Na dúvida entre dois níveis, o maior: número a mais custa nada, e número a
// menos esconde do dono que havia algo para ele fazer.
export const VERSAO = '3.0.0';
