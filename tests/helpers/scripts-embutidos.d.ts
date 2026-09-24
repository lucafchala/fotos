// Tipos para o typecheck dos scripts que as páginas emitem (#127). Só o
// tests/scripts-embutidos.test.js usa este arquivo: ele renderiza cada página,
// junta os blocos <script> de cada uma num arquivo e roda o tsc sobre eles.
//
// O tsc enxerga esses blocos com o lib.dom inteiro. O que está aqui é o que
// ele não tem como saber sozinho — e cada item é uma lista FECHADA, como a de
// globais do lint: um nome fora dela é erro de digitação, e o tsc acusa.

// ---------------------------------------------------------------------------
// 1. O que um bloco pendura em `window` para outro ler
// ---------------------------------------------------------------------------
// Um bloco define, outro (ou o mesmo, noutro momento) usa. Nada liga os dois
// além do nome — um `window.__tsBlockd` escrito errado num lado só falharia
// em silêncio no navegador. Declarados aqui, o tsc passa a conferir o nome
// nas duas pontas.
interface Window {
  /** Fim de carregamento de uma miniatura da galeria (ok = carregou). */
  imgSettled(img: any, ok: boolean): void;
  /** O mesmo, para as fotos do carrossel da página de projeto. */
  cImgSettled(img: any, ok: boolean): void;
  /** Métricas de performance do beacon (só quando o servidor liga o beacon). */
  __perf: { marks: Record<string, any> } | undefined;
  perfMark(k: string, v: any): void;
  perfCount(k: string): void;
  /** O script do Turnstile não carregou (bloqueador): cada formulário tem o seu. */
  __tsBlocked?: boolean;
  __loginTsBlocked?: boolean;
  __supTsBlocked?: boolean;
  /** Temporizador da dica do Drive, na página de projeto. */
  __driveHintTimer?: number;
}

// Carregado de fora, pelo <script> do Turnstile. Os blocos testam
// `typeof turnstile` antes de usar; os métodos são os que eles chamam.
declare var turnstile: {
  render(container: any, params?: any): string | undefined;
  execute(widget?: any, params?: any): void;
  reset(widget?: any): void;
} | undefined;

// ---------------------------------------------------------------------------
// 2. Elemento como elemento genérico
// ---------------------------------------------------------------------------
// O tsc não sabe que `getElementById('senha')` é um <input>, nem que o
// `e.target` de um listener delegado é um elemento. Na primeira execução,
// 207 dos 209 achados eram esse estreitamento — nenhum era defeito. Em vez de
// devolver `any` na busca (o que calaria também `classList.contians` e
// `.vlaue`), estas são as propriedades de SUBTIPO que os scripts usam num
// elemento genérico. Propriedade nova entra aqui com o mesmo cuidado de uma
// global nova no lint — ou o script estreita o tipo onde usa.

// O alvo de um evento delegado é tratado como o elemento que ele é.
interface EventTarget {
  closest(selectors: string): any;
  dataset: any;
  style: any;
  id: any;
}

interface Element {
  // <input>, <select>, <textarea>, <button>
  value: any;
  checked: any;
  disabled: any;
  readOnly: any;
  files: any;
  // <img>, <a>
  src: any;
  href: any;
  complete: any;
  naturalWidth: any;
  // HTMLElement
  offsetWidth: any;
  focus(options?: FocusOptions): void;
  /** Temporizador do aviso (toast) do painel, pendurado no próprio elemento. */
  _t?: any;
}

// ---------------------------------------------------------------------------
// 3. Entrada de performance como a entrada que ela é
// ---------------------------------------------------------------------------
// Mesmo caso dos elementos: `performance.getEntriesByType('resource')` devolve
// o tipo genérico, e o beacon lê os campos de recurso e de navegação que o
// tipo pedido garante. Os que ele usa, e só eles.
interface PerformanceEntry {
  // PerformanceResourceTiming
  initiatorType: any;
  responseStart: any;
  // PerformanceNavigationTiming
  domContentLoadedEventEnd: any;
  loadEventEnd: any;
}
