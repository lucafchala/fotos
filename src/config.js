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
  accessType: 'public', category: '', internalNotes: '', pinned: false, galeriaCreditos: '', galeriaAbertura: '', galeriaEstilo: 'mosaico', galeriaRecado: '', destaqueMaximo: false, lancarEm: '', lancarContagem: false, pixChave: '', pixNome: '', pixCidade: '', buscaRosto: false, buscaTexto: false, galeriaCapitulos: false, nomesAmigaveis: false, galeriaAtualizacaoAuto: true, galeriaPeriodo: 600, photoAlts: [], fotosOcultas: [], ocultasPendentes: [],
  photosAlert: { active: false, addedAt: null, expiresAfterHours: 24, kind: 'fotos' },
};

// Chave PÚBLICA do widget Turnstile (site key) — vai para o HTML de propósito;
// a secreta é o TURNSTILE_SECRET_KEY, que só existe como secret do Worker.
// Uma constante só para as duas páginas que desenham o widget (projeto e
// /suporte): eram duas cópias da mesma string, e trocar a chave no painel da
// Cloudflare atualizaria uma e esqueceria a outra — o formulário que ficasse
// com a velha recusaria todo envio.
export const TURNSTILE_SITE_KEY = '0x4AAAAAADg-tbuoPRO9s2I5';

// Domínio próprio de um álbum (entrenos2026.com → álbum da Turma 2026). É o
// mesmo Worker, ligado ao domínio como Custom Domain no painel da Cloudflare
// (igual ao fotos.lucafchala.com — nada disso vai no wrangler.toml, que
// derrubaria o deploy enquanto a zona não existir na conta). Nesse endereço:
//   - a raiz leva direto à galeria do álbum (302, para poder mudar depois);
//   - www. vai para o domínio sem www. (301);
//   - o painel volta para o domínio principal, onde mora a sessão;
//   - o resto responde igual (mesma origem para formulários e downloads).
// Enquanto o projeto não existe (ou está oculto), a raiz mostra uma página
// "em breve" com `titulo` e `linha`, em vez de levar a um 404.
// Chave = domínio sem www.; `slug` = o do projeto no painel.
// ⚠️ O Turnstile só vale nos domínios cadastrados no widget: adicione o
// domínio lá também, ou todo formulário desta origem é recusado.
// Texto de abertura do índice da galeria por capítulos (campo do projeto
// `galeriaAbertura`): parágrafos separados por linha em branco, sem marcação.
export const GALERIA_ABERTURA_MAX = 2000;
// Apresentação do álbum (v3.3, src/ui/album.js): o estilo da primeira tela e o
// recado do rodapé. O estilo é escolhido no painel e muda sem deploy.
// O primeiro é o padrão (o escolhido para o álbum da turma).
export const GALERIA_ESTILOS = Object.freeze(['mosaico', 'tela-cheia', 'recordacao', 'linha']);
export const GALERIA_RECADO_MAX = 600;

/** @type {Readonly<Record<string, { slug: string, titulo: string, linha: string, assinatura?: string }>>} */
export const DOMINIOS_DE_ALBUM = Object.freeze({
  'entrenos2026.com': Object.freeze({ slug: 'entrenos2026', titulo: 'Entre Nós', linha: 'Turma 2026 · Colégio Santa Cruz', assinatura: 'Fotos de Luca F. Chala e Mag' }),
});

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
// Download sob carga (item 1g): o Google pode recusar o arquivo (403
// downloadQuotaExceeded/rateLimitExceeded ou 429) quando ele é muito baixado.
// O proxy tenta UMA vez mais, depois de DOWNLOAD_RETENTATIVA_MS a 2x isso
// (jitter), e então responde "ocupado": 503 com Retry-After sugerido entre
// MIN e MAX segundos, também com jitter. O script da página faz a fila
// automática em cima disso (src/ui/galeria.js).
//
// AUDITORIA DOS LIMITES POR IP (item 1g). Regra: ver a página, ver um capítulo,
// abrir uma foto e baixar NÃO podem barrar 300 pessoas atrás de um IP (NAT de
// Wi-Fi de evento) em uma hora de pico. Limite por IP só onde há abuso:
//  - ver a galeria / o capítulo / o índice / abrir foto (thumbnails vão direto
//    ao lh3.googleusercontent.com, nem passam pelo Worker): NENHUM limite por
//    IP. A contagem de abertura é por navegador (cookie gv_*), 1x/hora.
//  - baixar (galeria-baixar): balde 6000 + 20000/h, abaixo; o portão do Drive
//    (drive-gate 1500+1500/h, noscript 300+300/h) e o clique (drive-click
//    1000+200/h, só métrica) já foram dimensionados para o mesmo caso.
//  - pedir remoção (galeria-remocao): 30/dia por IP vão ao painel; os 200
//    seguintes vão só por e-mail ao dono (sem KV); depois, 429 em português
//    com o e-mail de privacidade. Ver GALERIA_REMOCAO_*. O pedido não esconde
//    a foto (só o dono decide), então não há mais limite de "esconder".
//  - formulários do site (removal, support: 20/h por IP; login 10/10 min e 60/dia;
//    drive-code por endereço e por conta): não são caminho de visualização,
//    ficam como estão. O 429 do formulário de privacidade passou a dizer onde
//    escrever.
//  - avisos por e-mail (autor-aviso 1/foto/tipo/dia + teto diário da conta,
//    sumiram-aviso-dia): por foto e por conta, nunca por IP.
export const DOWNLOAD_RETENTATIVA_MS = 500;
export const DOWNLOAD_OCUPADO_MIN_S = 20;
export const DOWNLOAD_OCUPADO_MAX_S = 60;

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
// Avisos por e-mail ao AUTOR de uma foto (créditos com e-mail; v3.1). Teto
// próprio do dia, abaixo do dos códigos: dos 100 e-mails/dia do plano gratuito
// do Resend, 40 são de códigos e 20 destes avisos; sobram 40 para suporte,
// remoção e alertas ao dono. O aviso ao autor é sempre o primeiro a ser
// pulado (fica no log do healthz), e nunca atrapalha a ação principal.
export const AUTOR_AVISO_DIA = 20;
// Fotos apagadas da pasta do Drive (v3.1): UM e-mail-resumo ao dono por
// releitura que perceba sumiços, com teto do dia da conta (10) — somam-se aos
// 40 de códigos e 20 de avisos a autores: 70 de 100, sobram 30. Estourou, pula
// o e-mail e registra no healthz; a lista do painel continua completa. As
// cópias aos autores usam o teto AUTOR_AVISO_DIA (acima).
//
// Conta de subrequisições: a detecção roda DENTRO da releitura e só gasta a
// folga que a listagem deixou do próprio teto (GALERIA_MAX_CHAMADAS menos as
// páginas usadas, menos 1 de leitura extra da foto durável): 3 ficam
// reservadas (ficha do teto, envio ao dono, gravação no D1), depois as
// conferências (no máximo SUMIRAM_CONFERIR_MAX) e, por fim, 2 por cópia a
// autor. Sem folga, nada é conferido e o healthz registra. Por construção a
// soma nunca passa do teto da listagem, então a conta de 49/48 acima vale.
export const SUMIRAM_AVISO_DIA = 10;
// Quantas fotos sumidas uma releitura confere uma a uma no Drive (`files.get`,
// uma subrequisição cada). Mais que isso: só a contagem, sem nomes.
export const SUMIRAM_CONFERIR_MAX = 10;
// Dias que o painel guarda "Fotos apagadas recentemente" (id, nome, autor,
// capítulo, seção e data de captura; sem e-mail nem dado de visitante).
export const SUMIRAM_RETENCAO_DIAS = 30;

// "Fotos novas desde a sua última visita" (v3.1, #250). O Drive diz quando cada
// arquivo chegou (`createdTime`); a lista leva esse instante, em minutos desde
// EPOCA_CRIADA_MS, só para o que chegou nos últimos NOVAS_JANELA_DIAS dias (quem
// volta depois disso vê tudo como "antigo": a lista não engorda com o acervo).
// O instante da última visita fica só no localStorage do visitante.
export const NOVAS_JANELA_DIAS = 90;
export const EPOCA_CRIADA_MS = Date.UTC(2025, 0, 1);
// Visita nova = mais de NOVAS_SESSAO_MIN minutos desde a anterior; dentro disso é a mesma sessão.
export const NOVAS_SESSAO_MIN = 30;
// Quantos instantes recentes o resumo do índice guarda por capítulo (os mais novos).
export const NOVAS_RESUMO_MAX = 100;
// Cópias a autores por releitura (cada uma é um envio + uma ficha de teto, e
// as duas contam na conta de 50 subrequisições da invocação).
export const SUMIRAM_COPIAS_MAX = 3;
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
// Período da atualização automática (campo "Período" do projeto, em segundos):
// 10 min, 1 h, 6 h ou 24 h. O padrão é o de sempre (GALERIA_LISTA_TTL_S).
export const GALERIA_PERIODOS_S = [600, 3600, 21600, 86400];
// Com a atualização automática DESLIGADA a lista vem da foto durável (D1) e
// este é só o tempo que o isolate guarda essa foto na memória, para não ir ao
// D1 a cada foto da grade — e para o "Atualizar agora" aparecer logo nos
// outros isolates.
export const GALERIA_SNAPSHOT_MEM_S = 60;
// Pico de acessos (v3.1, item 1g): centenas de pessoas abrindo a galeria ao
// mesmo tempo, muitas atrás do MESMO IP. Quando a lista vence, NINGUÉM espera
// a releitura e NINGUÉM a dispara em bando: serve-se sempre a última lista
// (memória do isolate -> Cache API -> foto durável do D1), mesmo vencida
// (stale-while-revalidate), e só quem ganha um LEASE no mundo inteiro relê,
// em segundo plano (ctx.waitUntil). O lease é um Durable Object atômico
// (RateLimiter.lease): 1 chamada para quem pergunta, 1 escrita só para quem
// ganha. Sem nenhuma lista guardada (a primeiríssima abertura), só o ganhador
// lista; os outros esperam um pouco e relêem, ou mostram "Carregando as
// fotos…" com refresh automático — nunca N listagens.
//  - GALERIA_LEASE_S: quanto dura o direito de reler. Cobre a leitura mais
//    longa (até ~15 s com 26 páginas) com folga e, se o ganhador morrer no
//    meio (isolate descartado), o próximo tenta depois deste prazo. Quem
//    termina — bem ou mal — devolve o lease (ver GALERIA_LEASE_POS_S); o freio
//    do Drive com problema é a lista velha que continua sendo servida e o
//    re-pergunta só a cada GALERIA_REVERIFICA_S por isolate.
//  - GALERIA_REVERIFICA_S: o isolate que serviu lista vencida só pergunta de
//    novo (cache/lease) depois deste intervalo — não a cada visita.
//  - GALERIA_VELHO_MAX_S: a lista vencida só é servida até aqui (6 h); mais
//    velha que isso conta como "sem lista" (um colo quase parado não mostra
//    foto apagada de ontem).
//  - GALERIA_ESPERA_MS x GALERIA_ESPERAS: quanto quem perdeu o lease sem
//    lista nenhuma espera (3 x 1,5 s) antes de mostrar "Carregando…". Espera
//    não gasta CPU, só relógio.
export const GALERIA_LEASE_S = 45;
//  - GALERIA_LEASE_POS_S: depois de uma leitura que terminou (bem ou mal) o
//    lease encolhe para esta folga. 0 = solta na hora: segurar 45 s depois de
//    pronto mandaria "Carregando…" a quem chega num colo sem cache, e o erro
//    real (chave inválida, pasta privada) ficaria escondido. Não abre
//    duplicidade: a lista nova já está na Cache API quando o lease solta, e
//    quem pergunta de novo olha o cache ANTES do lease.
export const GALERIA_LEASE_POS_S = 0;
export const GALERIA_REVERIFICA_S = 20;
export const GALERIA_VELHO_MAX_S = 6 * 3600;
export const GALERIA_ESPERA_MS = 1500;
export const GALERIA_ESPERAS = 3;
// Tetos que mantêm UMA requisição dentro do plano gratuito: cada página da
// Drive API (até 1000 arquivos) é uma subrequisição, e o plano gratuito dá 50
// por invocação. Passou de algum teto, a lista sai PARCIAL e a página avisa —
// nunca um erro.
export const GALERIA_MAX_FOTOS = 6000;
export const GALERIA_MAX_PASTAS = 25;
// Raiz = 0. Duas camadas de subpasta cobrem "Cerimônia / Festa" e
// "Dia 1 / Manhã"; mais fundo que isso é arquivo de trabalho, não galeria.
export const GALERIA_MAX_PROFUNDIDADE = 2;
export const GALERIA_MAX_CHAMADAS = 26;
// Pasta do Instagram (campo `driveUrlInstagram` do projeto): o download "para
// redes" entrega, byte a byte, o arquivo de lá — nada é redimensionado pelo
// site. Ela é listada junto com a pasta da galeria na MESMA invocação (página e
// download), então o teto próprio entra na conta das 50 subrequisições do plano
// gratuito, no PIOR caso (download "para redes", as duas listas frias e
// enormes, visitante sem sessão): 26 (galeria) + 6 (esta) + 6 do cache (match e
// put de cada lista, mais o do casamento "para redes") + 2 do D1 (a foto
// durável da lista da galeria: ler o hash e gravar; a do Instagram não tem) +
// 5 do resto (KV do projeto, ficha do limite por IP, contador, o arquivo) +
// 2 do lease da lista da galeria (tomar e soltar, item 1g) = 47, e o lease da
// lista do Instagram é o que o teste mede a mais, no pior caso. Os tetos
// caíram em 1g (28 -> 26 e 8 -> 6) justamente para pagar o lease sem passar de
// 50. Está medido em tests/galeria.test.js ("orçamento": 47 no download "para
// redes" e o teto asserido é 49): subir qualquer teto aqui, ou gastar uma
// subrequisição a mais nesse caminho, reprova o teste.
// Vídeo e Live Photo (item 1f) não pesam nesta conta: entram na MESMA leitura
// da pasta (só mais um campo, sem chamada extra), o player do Drive é um iframe
// do navegador do visitante e o download de vídeo é UMA subrequisição (o
// "máx", sem a versão "para redes"), igual à de uma foto.
// Passou do teto, as fotos do fim da lista ficam sem versão "para redes".
export const GALERIA_MAX_CHAMADAS_IG = 6;
// Galeria por capítulos (v3.1): cada subpasta de primeiro nível da pasta do
// projeto é uma página. O ÍNDICE custa uma página da API (só as subpastas) e
// um match do cache; o capítulo é lido como se fosse a raiz, com teto menor
// para a conta fechar: no pior caso (download "para redes", tudo frio) são
// 18 (capítulo) + 6 (Instagram) + 3 (índice: API, match e put) + 2 (D1 da
// lista de capítulos) + 6 (cache das listas e do casamento) + 2 (D1 da lista do
// capítulo) + 5 (KV, ficha do IP, contador, arquivo) = 42, mais os leases (item
// 1g: tomar e soltar, da lista de capítulos e da do capítulo) e o do Instagram.
// Medido em tests/galeria-capitulos.test.js ("orçamento"): 49 no download "para
// redes" e 48 na página do capítulo, com teto asserido de 49 (< 50).
export const GALERIA_MAX_CHAMADAS_CAP = 18;
// Workers Paid (v3.6): com `WORKERS_PLANO = "pago"` no wrangler.toml, o teto
// de subrequisições sobe de 50 para 10.000 por invocação, e as listas param de
// ser cortadas em pasta grande (Festa Junina: 5 anos × 5 fotógrafos = 31
// pastas). Os tetos abaixo ainda deixam folga larga, e o CPU do plano pago
// (30 s) cobre a leitura de milhares de fotos. Só ligar DEPOIS de assinar: no
// plano grátis, estes tetos estourariam o limite de 50 e a galeria quebraria.
export const GALERIA_MAX_CHAMADAS_PAGO = 150;
export const GALERIA_MAX_CHAMADAS_CAP_PAGO = 120;
export const GALERIA_MAX_PASTAS_PAGO = 200;
// Outros tetos que só existiam pelas 50 subrequisições do plano grátis (v3.7):
// a pasta "para redes" (Instagram), a busca das pastas de envio e quantos
// álbuns por capítulos o sitemap de imagens abre por pedido.
export const GALERIA_MAX_CHAMADAS_IG_PAGO = 40;
export const ENVIO_MAX_CHAMADAS_PAGO = 300;
export const SITEMAP_PROJETOS_COM_CAPITULOS_PAGO = 40;
// Quantos capítulos o índice mostra (a primeira página da API traz até 1000
// pastas; o índice corta aqui e avisa o dono).
export const GALERIA_MAX_CAPITULOS = 100;
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

// Créditos por pasta de autor (v3.1): campo do projeto `galeriaCreditos`, uma
// linha `pasta = Nome` por autor. Vazio = só o autor padrão. Teto de linhas e
// de tamanho do nome: o campo mora no evento (KV) e o nome vai para a página,
// para o JSON-LD e para o nome do arquivo baixado.
export const AUTOR_PADRAO = 'Luca F. Chala';
export const CREDITOS_PADRAO = 'chala = Luca F. Chala';
export const GALERIA_CREDITOS_MAX_LINHAS = 20;
export const GALERIA_CREDITOS_NOME_MAX = 80;
export const GALERIA_CREDITOS_EMAIL_MAX = 120;

// "Pedir remoção desta foto" na galeria: o visitante pede e o pedido vai ao
// dono (painel → Pedidos e e-mail na hora); a foto NÃO sai da galeria até o
// dono decidir ("Remover da galeria" ou "Manter na galeria"). Decisão do dono,
// nov/2026: antes (v3.0) o pedido escondia a foto na hora, com tetos de 5 por
// IP e 20 por álbum por dia contra abuso — sem a ocultação automática, esses
// tetos e o balde 'galeria-oculta' não existem mais, e nenhum visitante grava
// o evento no KV. `ocultasPendentes` (evento) não é mais preenchido; o campo
// segue lido e saneado só para pedidos abertos antes de 3.1.0 e para backups
// antigos. Dimensionado para o uso real: um evento rende de 0 a 3 pedidos
// legítimos; um Wi-Fi de local é UM IPv4 para ~750 pessoas, então o teto por IP
// não pode ser 1.
// Pedidos por IP por dia: cada pedido gasta 2 escritas de
// KV (o registro e o carimbo dos e-mails) e a cota do KV é da conta toda
// (1000/dia, TODO.md). Dois degraus por IP/dia (item 1g — um Wi-Fi de evento é
// UM IPv4 para centenas de pessoas, e o pico do pedido de remoção é logo depois
// do evento):
//  - até 30: o pedido vai ao painel (2 escritas de KV cada; 30 por IP é o teto
//    de 60 escritas por endereço, e a cota da conta só se aproxima disso com
//    vários endereços fazendo o mesmo — o que é abuso e não evento);
//  - os 200 seguintes (contados à parte): o pedido segue SÓ por e-mail ao dono (e ao autor, item 1c),
//    sem escrita de KV; a resposta ao visitante é a mesma
//    de sempre ("o fotógrafo vai analisar"). Nada de erro;
//  - depois desses 200: 429 com o e-mail de privacidade — só um robô chega aqui, e o
//    e-mail do dono tem de ser pesado de ler.
// Aviso de fotos novas no celular (v3.8.4, src/aviso.js). No máximo um aviso
// por álbum a cada 3 h (junta o que chegou nesse meio-tempo). Por execução do
// cron, até AVISO_LOTE navegadores (cada um é um pedido; o Worker tem teto de
// pedidos por execução). Só os serviços de entrega conhecidos.
export const AVISO_INTERVALO_MS = 3 * 3600_000;
export const AVISO_LOTE = 400;
export const AVISO_HOSTS = ['fcm.googleapis.com', '.push.services.mozilla.com', '.push.apple.com', '.notify.windows.com'];
// Inscrições por IP: balde, na ordem do da busca pelo rosto (uma escola inteira
// sai por um IP só; eram 20 por hora, e o 21º aluno a tocar em "Avisar" no
// Wi-Fi da escola recebia 429). A ficha só é gasta por um pedido bem formado.
export const AVISO_INSCRICAO_IP_BUCKET = { capacity: 600, perHour: 600 };
// Validade de uma inscrição no KV (v3.8.9): sem prazo, o endereço de entrega de
// quem trocou de celular ou nunca mais abriu o álbum ficava guardado para
// sempre. Cada aviso entregue renova a inscrição (no máximo uma escrita a cada
// AVISO_RENOVA_DIAS por pessoa); a de quem não recebe mais nada some sozinha.
// 400 dias: o álbum recebe fotos por um ano, e pode passar meses sem foto nova.
export const AVISO_INSCRICAO_TTL_S = 400 * 86400;
export const AVISO_RENOVA_DIAS = 30;
// Recusas seguidas (403) do serviço de entrega até a inscrição ser apagada. O
// 403 diz que a inscrição não aceita a chave deste site, e não volta a aceitar
// — mas um erro NOSSO na assinatura também daria 403 em todas de uma vez, e
// apagar na primeira jogaria fora a lista inteira. Três avisos seguidos
// recusados: é a inscrição.
export const AVISO_RECUSAS_MAX = 3;

// Teto de e-mails do site por dia (v3.8.3; janela fixa desde a 3.8.9). O
// Resend grátis manda até 100 por dia; o site manda no máximo EMAIL_TETO_DIA,
// e os 10 que sobram são do envio manual do dono.
//
// É UMA janela diária fixa, que vira à meia-noite UTC, para TODO envio do site
// (o código por e-mail e os alertas de segurança ficavam de fora). Era um balde
// de 90 que repunha 90 por dia: cheio de manhã, deixava sair ~180 nas primeiras
// 24 horas, e no dia do lançamento o Resend recusaria a partir do centésimo.
//
// EMAIL_RESERVA_ALERTAS desses envios são só dos alertas ao dono (erro no
// site, login, varredura, saídas da busca em excesso): o resto do site para em
// EMAIL_TETO_DIA - EMAIL_RESERVA_ALERTAS, e um dia cheio de códigos e
// confirmações não cala o aviso de que algo quebrou. Os tetos menores de cada
// tipo (EMAIL_CODE_DAILY_CAP, AUTOR_AVISO_DIA, SUMIRAM_AVISO_DIA) continuam
// valendo por dentro deste: dizem quem cede primeiro.
export const EMAIL_TETO_DIA = 90;
export const EMAIL_RESERVA_ALERTAS = 10;
export const GALERIA_REMOCAO_PEDIDOS_POR_IP_DIA = 30;
export const GALERIA_REMOCAO_EMAIL_POR_IP_DIA = 200;
// Motivos que o formulário da galeria aceita (valor gravado no pedido).
export const GALERIA_REMOCAO_MOTIVOS = /** @type {const} */ (['eu', 'menor', 'outro']);
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
export const VERSAO = '3.9.0';

// ---------------------------------------------------------------------------
// Busca pelo rosto (v3.2, Amazon Rekognition — ver docs/ROSTO.md)
// ---------------------------------------------------------------------------
// São Paulo: a selfie e o índice ficam no Brasil. A API de coleções existe lá
// (cota padrão de 5 buscas por segundo por conta — ver ROSTO_BUSCA_GLOBAL).
export const ROSTO_REGIAO_PADRAO = 'sa-east-1';
// Semelhança mínima (0–100) para uma foto entrar no resultado. v3.7.3, pedido
// do dono: na dúvida, mostrar ("evitar perder alguma foto própria"). 80 acha a
// pessoa de lado, de longe e com pouca luz; o preço é aparecer, no fim da
// lista, um parecido de vez em quando. Os achados vêm do mais certo para o
// menos certo. Era 90.
export const ROSTO_LIMIAR = 80;
// A busca no álbum vai mais longe (v3.8.2, pedido do dono: "que apareçam todas
// as fotos em que a pessoa possa estar"). De ROSTO_LIMIAR_BUSCA até
// ROSTO_LIMIAR a foto entra num grupo à parte, "Talvez seja você", no fim.
export const ROSTO_LIMIAR_BUSCA = 70;
// "Não quero aparecer": apaga do índice todo rosto acima deste limiar — SEMPRE
// abaixo de ROSTO_LIMIAR_BUSCA (a régua mais baixa da busca, a do "Talvez"),
// porque aqui errar para mais é o lado seguro: o que a busca acharia, a saída
// apaga. Era 75 até a 3.8.1 (a busca ia só até 80).
export const ROSTO_LIMIAR_SAIR = 65;
// No máximo quantas fotos voltam numa busca (a pessoa mais fotografada da
// turma não passa disso num álbum de alguns milhares).
export const ROSTO_MAX_RESULTADOS = 400;
// A selfie chega já reduzida pelo navegador (640 px, JPEG): ~60 KB. O teto em
// base64 deixa folga e mantém o JSON.parse dentro dos 10 ms de CPU do plano
// grátis.
export const ROSTO_IMAGEM_MAX_B64 = 400_000;
// Busca em duas etapas (v3.3): as fotos em que a pessoa aparece com
// semelhança ≥ ROSTO_SEMENTE_MIN viram "sementes" e cada uma procura os
// rostos parecidos com ELA — acha a mesma pessoa de lado, de longe ou com
// pouca luz, que a selfie de frente sozinha perde. Até ROSTO_SEMENTES
// chamadas a mais por busca.
export const ROSTO_SEMENTES = 4;
export const ROSTO_SEMENTE_MIN = 95;
export const ROSTO_LIMIAR_SEMENTE = 85;
// Por IP: a turma inteira no Wi-Fi da escola é UM IP (o mesmo raciocínio do
// DRIVE_GATE_BUCKET).
export const ROSTO_BUSCA_IP_BUCKET = { capacity: 300, perHour: 300 };
// Global: o teto de CUSTO do site inteiro. Dimensionado para o dia do
// lançamento (v3.8.8): ROSTO_PUBLICO_DO_DIA pessoas com ROSTO_BUSCAS_POR_PESSOA
// buscas cada (a primeira, uma segunda com outra selfie e a atualização de
// "minhas fotos" quando chegam fotos novas). O lançamento é uma rajada — a
// turma abre o álbum junta —, então o dia inteiro cabe no balde de uma vez
// (`capacity`); `perHour` é o ritmo dos dias seguintes. Era 1.200 + 100/h,
// menos que o público esperado, e cada tentativa que a AWS recusava por
// excesso gastava uma ficha: o teto acabava em recusas. Agora a ficha de uma
// busca recusada com "devagar" é devolvida (handleRosto), e o balde conta
// buscas que a AWS aceitou.
// Custo: uma busca são de 1 a 6 chamadas de US$ 0,001 (quem saiu, o álbum e
// até ROSTO_SEMENTES sementes; em geral 2 ou 3). O dia do lançamento, cheio:
// 4.500 buscas, de US$ 9 a US$ 27. O pior dia possível (balde cheio mais 24 h
// de reposição, todas com 6 chamadas): 6.900 buscas, US$ 41.
export const ROSTO_PUBLICO_DO_DIA = 1500;
export const ROSTO_BUSCAS_POR_PESSOA = 3;
export const ROSTO_BUSCA_GLOBAL_BUCKET = { capacity: ROSTO_PUBLICO_DO_DIA * ROSTO_BUSCAS_POR_PESSOA, perHour: 100 };
// Quantas vezes a página tenta de novo, sozinha, depois de um 429 da busca
// (cada vez com um token novo do Turnstile). Toda repetição automática tem
// teto (RETOMADA §5.12).
export const ROSTO_TENTATIVAS_NO_PICO = 4;

// A cota da Amazon Rekognition em sa-east-1, em transações por segundo por
// conta. UM lugar só: `vale` é o que a conta tem hoje (o padrão da AWS é 5 por
// operação); `pedido` é o que foi pedido à AWS. Aprovado em 11/2026 (casos de
// suporte de SearchFacesByImage e SearchFaces): 20 e 25. A AWS deu 20 onde
// pedimos 10. O tempo de espera que o 429 da busca manda
// (esperaDaBuscaNoPico) sai destes números, e nada mais no código repete a
// cota. O indexador (scripts/rosto-indexa.mjs) usa OUTRAS operações
// (IndexFaces e as de leitura), com o ritmo dele.
export const ROSTO_AWS_TPS = Object.freeze({
  SearchFacesByImage: Object.freeze({ vale: 20, pedido: 10 }),
  SearchFaces: Object.freeze({ vale: 25, pedido: 25 }),
});
/**
 * Quantos segundos o 429 de "a AWS pediu calma" manda a página esperar.
 * Sorteado, para a turma não voltar toda no mesmo segundo, numa janela que
 * encolhe quando a cota sobe: com 5 por segundo, de 2 a 8 s; com 10, de 2 a 5.
 * @param {number} [sorteio] 0 a 1 (para os testes)
 * @param {number} [tps] a cota de SearchFacesByImage (para os testes)
 */
export function esperaDaBuscaNoPico(sorteio = Math.random(), tps = ROSTO_AWS_TPS.SearchFacesByImage.vale) {
  const janela = Math.ceil(30 / Math.max(1, tps));
  return 2 + Math.floor(Math.min(0.999999, Math.max(0, sorteio)) * (janela + 1));
}
export const ROSTO_SAIR_POR_IP_DIA = 20;
// Saídas da busca por dia, no site inteiro (v3.8.9). A saída aceita qualquer
// foto de rosto, então alguém com rostos recortados do álbum tiraria a turma
// inteira da busca. Numa turma de 1.500, o esperado num dia cheio são algumas
// dezenas; passou disso, o pedido é recusado (com o e-mail de privacidade), o
// dono recebe um alerta e confere a lista no painel, onde cada saída pode ser
// desfeita.
export const ROSTO_SAIR_POR_DIA = 60;
// Aquecimento das miniaturas (v3.8.11). No lançamento, mil celulares abrem a
// mesma página no mesmo minuto; miniatura que ainda não está no R2 é buscada
// no Google por CADA pedido que chega antes de a primeira cópia ser gravada, e
// o Google recusa a rajada. O indexador (que já passa por toda foto do álbum,
// inclusive antes do lançamento) pede ao site estas larguras de cada foto, em
// ritmo lento, e a cópia fica no R2: no dia, a página não depende do Google.
// As larguras são as que um iPhone (390 px, densidade 3) pede na grade em
// mosaico, medidas no navegador; `verifica:galeria` reprova se a grade passar
// a pedir outra. As demais (outros aparelhos, o visor em tela cheia) ainda vão
// ao Google na primeira vez, e a grade tenta de novo se ele recusar.
export const AQUECE_LARGURAS = [400, 500, 700, 800, 1200];
// Fotos aquecidas por execução do indexador (cada uma são AQUECE_LARGURAS.length
// pedidos ao site).
export const AQUECE_FOTOS_POR_EXECUCAO = 600;
// Miniatura que falha na grade tenta de novo esta quantidade de vezes, com
// espera crescente e sorteada, antes de virar o quadro vazio.
export const GALERIA_MINIATURA_TENTATIVAS = 2;
// Quantas fotos o indexador processa por DIA (UTC) em cada álbum (v3.8.10). A
// pasta do álbum recebe fotos da turma por um ano, por link aberto: sem teto,
// alguém despejando arquivos fazia o indexador pagar por todos (até 4 chamadas
// de US$ 0,001 por foto, 3.000 fotos por execução, uma execução a cada 10 min:
// mais de mil dólares num dia). Com o teto, o pior dia custa
// ROSTO_FOTOS_POR_DIA × US$ 0,004 por álbum. O que passar fica para o dia
// seguinte, e o log do indexador diz. Para a primeira indexação de um álbum
// grande, a variável ROSTO_MAX_DIA do workflow sobe o teto naquele dia.
export const ROSTO_FOTOS_POR_DIA = 2000;
// Busca pelo rosto desligada no painel: o índice (os rostos de todo mundo) é
// apagado depois deste prazo, não na hora. Religar antes cancela. Um clique
// errado no painel não pode custar o índice inteiro e a lista de quem saiu; e
// projeto EXCLUÍDO não espera: apaga na hora.
export const ROSTO_APAGA_APOS_DESLIGAR_H = 72;

// Lançamento marcado de um álbum (v3.5): até quantos dias à frente o painel
// aceita marcar. Mais que isso é engano de digitação (ano errado).
export const LANCAMENTO_MAX_DIAS = 400;

// Busca nas fotos (v3.7): texto e "coisas" (Rekognition DetectText e
// DetectLabels) e moderação automática (DetectModerationLabels), feitos uma
// vez por foto pelo indexador. Ver src/busca.js e docs/ROSTO.md.
export const BUSCA_MAX_RESULTADOS = 120;
// Confiança mínima (0–100) para guardar uma palavra lida e uma "coisa". Texto
// alto: número de camisa errado manda a pessoa para a foto errada.
export const BUSCA_TEXTO_CONFIANCA_MIN = 85;
export const BUSCA_COISA_CONFIANCA_MIN = 75;
// Moderação: só as categorias de cima abaixo contam, e só com confiança alta.
// Ficam de fora "Swimwear or Underwear" (piscina, praia) e "Gambling". Com
// marca, a foto só vai para o e-mail do dono, que decide se oculta: o site não
// esconde nada sozinho (v3.8.12).
export const BUSCA_MODERACAO_CONFIANCA_MIN = 80;
export const BUSCA_MODERACAO_ESCONDE = Object.freeze([
  'Explicit', 'Explicit Nudity', 'Non-Explicit Nudity of Intimate parts and Kissing', 'Non-Explicit Nudity',
  'Violence', 'Visually Disturbing', 'Hate Symbols', 'Drugs & Tobacco', 'Drugs', 'Tobacco', 'Alcohol', 'Rude Gestures',
]);
// Buscas por IP (D1, sem custo na Amazon): rajada de 60 e 600 por hora.
export const BUSCA_IP_BUCKET = { capacity: 60, perHour: 600 };
// Itens por envio do indexador para /api/busca/indexar (o D1 aceita 100
// parâmetros por consulta: o slug mais 90 fotos cabem).
export const BUSCA_LOTE_MAX = 90;

// Prévia do álbum com senha (v3.7): o "easter egg" da página "em breve" (5
// toques no título → campo de senha). Quem acerta ganha um cookie de
// PREVIA_COOKIE_DIAS dias que abre o álbum antes do lançamento (só ver, sem
// painel). Trocar ou tirar a senha no painel derruba as prévias abertas.
export const PREVIA_SENHA_MIN = 6;
export const PREVIA_COOKIE_DIAS = 30;
export const PREVIA_TENTATIVAS_POR_IP_HORA = 8;
export const PREVIA_TENTATIVAS_POR_DIA = 200;

// As cores do álbum com domínio próprio (Entre Nós), num lugar só (v3.9.0):
// a página do álbum, a do evento, a da editora, a ajuda e o app instalado.
// Tudo sai do AZUL DO COLÉGIO SANTA CRUZ (#243580, o `blue` do site da
// escola; pedido do dono): o fundo, os cartões e as bordas são o mesmo azul,
// mais escuro (mesmo matiz, 229°), em vez do quase-preto quente de antes, que
// puxava para o marrom. As linhas e os brilhos usam o próprio #243580. O
// amarelo (#F9DE4B, também do colégio) só entra SÓLIDO, nos destaques:
// misturado com o azul ou transparente sobre o escuro, vira oliva/marrom.
export const PALETA_ALBUM = Object.freeze({
  bg: '#0a1029', card: '#111a3d', card2: '#16204a', borda: '#22306b', esqueleto: '#131c45',
  txt: '#f3f1ec', txt2: '#c9cee3', mudo: '#9ca3c4', dim: '#7a82a6',
  sol: '#f9de4b', azul: '#243580',
  /** O fundo com transparência (botão de vidro, sombra da capa): "r,g,b". */
  bgRgb: '10,16,41',
});

