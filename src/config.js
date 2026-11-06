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
  accessType: 'public', category: '', internalNotes: '', pinned: false, galeriaCreditos: '', galeriaCapitulos: false, nomesAmigaveis: false, galeriaAtualizacaoAuto: true, galeriaPeriodo: 600, photoAlts: [], fotosOcultas: [], ocultasPendentes: [],
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
export const VERSAO = '3.1.0';
