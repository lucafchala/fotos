// ---------------------------------------------------------------------------
// Constantes de configuração do Worker
// ---------------------------------------------------------------------------
// Estas moravam em `src/index.js`. Saíram de lá por uma regra do runtime que
// não perdoa:
//
//   **O módulo de ENTRADA de um Worker só pode exportar função ou classe.**
//
// Qualquer outro valor exportado — um número, um objeto — faz o workerd recusar
// o script inteiro, na inicialização:
//
//     Uncaught TypeError: Incorrect type for map entry 'DRIVE_NONCE_TTL_SECS':
//     the provided value is not of type 'function or ExportedHandler'.
//
// É a regra que trata todo export nomeado do entrypoint como um entrypoint em
// potencial (é assim que as classes de Durable Object são encontradas). Um
// `export const` no meio disso não tem como ser interpretado.
//
// O sintoma prático é traiçoeiro: o deploy em produção passava, mas
// `npx wrangler dev` morria na subida — ou seja, quebrava exatamente a
// ferramenta que o docs/VERIFICACAO.md manda usar antes de publicar. Ficou
// escondido enquanto ninguém rodou o servidor local.
//
// Regra para daqui em diante: **constante nova vem para cá, não para o
// index.js.** O index.js exporta o handler, as classes de Durable Object e as
// funções que os testes exercitam — mais nada.

// Um segredo curto é pior do que segredo nenhum: o painel diria que o controle
// está ligado enquanto ele é forçável à vontade. 32 caracteres aleatórios é o
// piso que torna isso inviável.
export const SIGNING_SECRET_MIN_LENGTH = 32;

// Nonce de página do portão do Drive. Duas horas cobrem quem abre a página e
// resolve com calma, e ainda deixam o token inútil como ferramenta de varredura
// no dia seguinte.
export const DRIVE_NONCE_TTL_SECS = 7200;

// Formulários públicos: janela longa (a pessoa pode escrever devagar) com piso
// de 3 s. O piso é o que pega automação — um bot preenche e envia em
// milissegundos; humano nenhum lê um formulário e envia em menos de 3 s.
export const FORM_TOKEN_TTL_SECS = 7200;
export const FORM_TOKEN_MIN_AGE_SECS = 3;

// Valores de partida de um projeto novo, e de qualquer campo que falte num
// projeto antigo. A criação passa isto como base; a edição passa o projeto
// existente.
export const DEFAULT_EVENT = {
  title: '', longDescription: '',
  driveUrl: '', driveUrlInstagram: '', date: '', eventCredits: '',
  projectUrl: '', visible: true, comingSoon: false, status: 'entregue',
  accessType: 'public', category: '', internalNotes: '', pinned: false,
  photosAlert: { active: false, addedAt: null, expiresAfterHours: 24 },
};
