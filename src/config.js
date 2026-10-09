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
  accessType: 'public', category: '', internalNotes: '', pinned: false,
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
