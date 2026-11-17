// Página de erro (404, 500, 503 e "Ops") — 4.1.3.
//
// Antes era um bloco escuro dentro de src/index.js com o número em #1a1a1a
// sobre #0a0a0a (contraste 1,13), o texto em 2,9 e os links em 3,6, com 19 px
// de altura. Agora segue o tema do aparelho, tudo passa de 4,5 e os dois
// links têm 44 px. O texto é neutro de propósito: a mesma página sai em
// fotos.lucafchala.com e no domínio de um álbum, então não diz "fotos" nem
// "galeria"; "/" é o início de cada um.

/** Cores da página, as duas usadas pelo teste de contraste. */
export const CORES_DA_PAGINA_DE_ERRO = {
  claro: { fundo: '#faf9f6', texto: '#1c1b19', suave: '#57534e', link: '#1d4ed8' },
  escuro: { fundo: '#141412', texto: '#f2f0eb', suave: '#b8b3aa', link: '#93b4ff' },
};

/**
 * @param {string|number} code número (ou "Ops") que aparece grande no topo
 * @param {string} message frase já escapada para HTML
 * @returns {string}
 */
export function paginaDeErroHTML(code, message) {
  const { claro: c, escuro: e } = CORES_DA_PAGINA_DE_ERRO;
  const titulo = /^[0-9]+$/.test(String(code)) ? `Erro ${code}` : 'Algo deu errado';
  return `<!DOCTYPE html><html lang="pt-BR"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1.0"><meta name="robots" content="noindex"><meta name="color-scheme" content="light dark"><title>${titulo}</title><style>`
    + `:root{--fundo:${c.fundo};--texto:${c.texto};--suave:${c.suave};--link:${c.link}}`
    + `@media (prefers-color-scheme:dark){:root{--fundo:${e.fundo};--texto:${e.texto};--suave:${e.suave};--link:${e.link}}}`
    + '*{box-sizing:border-box;margin:0;padding:0}'
    + 'body{font-family:system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;background:var(--fundo);color:var(--texto);display:flex;align-items:center;justify-content:center;min-height:100vh;min-height:100dvh;text-align:center;padding:2rem 1.25rem;line-height:1.5}'
    + 'main{max-width:28rem}'
    + 'h1{font-size:3.5rem;line-height:1;font-weight:700;letter-spacing:-.02em;margin-bottom:1rem;font-variant-numeric:tabular-nums}'
    + 'p{font-size:1.0625rem;color:var(--suave);margin-bottom:1.75rem}'
    + '.links{display:flex;gap:.5rem 1.5rem;justify-content:center;flex-wrap:wrap}'
    + 'a{color:var(--link);text-decoration:underline;text-underline-offset:.2em;display:inline-flex;align-items:center;min-height:44px;padding:0 .25rem;font-size:1rem}'
    + 'a:hover{text-decoration-thickness:2px}'
    + 'a:focus-visible{outline:2px solid var(--link);outline-offset:2px;border-radius:4px}'
    + `</style></head><body><main><h1>${code}</h1><p>${message}</p><nav class="links" aria-label="Para onde ir"><a href="/">Voltar ao início</a><a href="/suporte">Falar com o suporte</a></nav></main></body></html>`;
}
