// Página "em breve" de um domínio de álbum (entrenos2026.com) enquanto o
// projeto ainda não existe ou está oculto. Sem foto (o domínio pode estar no
// ar antes de alguém decidir o que mostrar), sem script e sem nada de fora: só
// texto. A mesma página vai, como Worker à parte, no prompt do Cowork, para o
// domínio ter algo no ar antes do merge.

import { escape } from '../utils.js';

/**
 * @param {{ titulo: string, linha: string, assinatura?: string }} p
 */
export function emBreveHTML({ titulo, linha, assinatura = '' }) {
  return `<!DOCTYPE html>
<html lang="pt-BR">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0, viewport-fit=cover">
<meta name="robots" content="noindex">
<meta name="theme-color" content="#16204d">
<title>${escape(titulo)} · em breve</title>
<style>
*,*::before,*::after{box-sizing:border-box;margin:0;padding:0}
html,body{height:100%}
body{background:radial-gradient(ellipse at 50% -10%,#2b3f94 0%,#1a2560 38%,#0d1230 80%);color:#f3ede3;font-family:system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;display:flex;align-items:center;justify-content:center;padding:24px;text-align:center}
main{max-width:34rem}
.k{font-size:.75rem;font-weight:600;letter-spacing:.22em;text-transform:uppercase;color:#f9de4b;line-height:1.7}
h1{font-family:"Iowan Old Style","Palatino Linotype",Palatino,Georgia,serif;font-weight:700;font-size:clamp(3.4rem,15vw,7rem);line-height:.95;letter-spacing:-.02em;margin:.6rem 0 1.2rem}
p{font-size:clamp(1.02rem,2.6vw,1.2rem);line-height:1.6;color:#d6dbef}
.l{display:block;width:3rem;height:2px;background:#f9de4b;margin:1.8rem auto 0;border-radius:2px}
small{display:block;margin-top:1.2rem;font-size:.85rem;color:#aab3d6}
</style>
</head>
<body>
<main>
<span class="k">${escape(linha)}</span>
<h1>${escape(titulo)}</h1>
<p>O álbum da turma está chegando: as fotos de todos os eventos, num lugar só.</p>
<span class="l" aria-hidden="true"></span>
<small>${assinatura ? `${escape(assinatura)} · ` : ''}Volte em breve.</small>
</main>
</body>
</html>`;
}
