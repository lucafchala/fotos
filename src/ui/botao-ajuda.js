// O botão "Ajuda" dos rodapés do álbum (v3.9.1). Módulo à parte, sem
// imports: album.js e galeria.js o usam, e ajuda.js importa album.js (um
// import de volta faria um ciclo).

const ICONE_AJUDA = '<svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="10"/><path d="M9.1 9a3 3 0 0 1 5.8 1c0 2-3 3-3 3"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>';

/**
 * O botão "Ajuda" dos rodapés do álbum (v3.9.1): o mesmo em todas as páginas
 * (álbum, evento, números). O estilo vem junto (classe própria, sem depender
 * do CSS de cada página; o seletor vence o `footer a` de cada uma).
 * @param {string} base '' no domínio do álbum, '/galeria/<slug>' no site
 */
export function botaoDeAjudaHTML(base) {
  return `<a class="aj-botao" href="${base}/ajuda">${ICONE_AJUDA}<span>Ajuda</span></a>`;
}

/** O CSS do botão de ajuda (vai no <style> de cada página que o usa). */
export const BOTAO_AJUDA_CSS = `.aj-rodape a.aj-botao{display:inline-flex;align-items:center;gap:.45rem;min-height:44px;padding:0 1.1rem;border-radius:999px;border:1px solid var(--accent,#f9de4b);color:var(--accent,#f9de4b);font-weight:600;font-size:.92rem;text-decoration:none}
.aj-rodape a.aj-botao:hover{background:var(--accent,#f9de4b);color:#141a33}
.aj-rodape{display:flex;justify-content:center;margin:0 0 1.2rem}`;

