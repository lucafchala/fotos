// Caminho da fonte que uma página pré-carrega (`<link rel="preload" as="font">`).
//
// Existe como arquivo, e não como `node -e` dentro do scripts/smoke.sh, porque
// dois lugares precisam do MESMO parser (#181): o smoke, que pede esse caminho
// à produção depois de cada promoção, e o tests/smoke.test.js, que roda o
// parser no HTML do Worker antes do merge. Com uma cópia em cada lado, uma
// mudança na marcação passaria na suíte e só quebraria no smoke — e smoke
// vermelho em produção é reversão automática, não aviso.
//
// Não é um parser de HTML: só precisa achar a tag que o fontPreloadHTML()
// emite, em qualquer ordem de atributos e com aspas simples, duplas ou sem
// aspas, e não confundi-la com um preload de outra coisa.
//
// Uso: curl -s https://site/ | node scripts/fonte-do-preload.mjs
// Escreve o href e nada mais; sem preload de fonte, não escreve nada.

/**
 * @param {string} tag
 * @param {string} nome
 */
function atributo(tag, nome) {
  const m = tag.match(new RegExp(`\\s${nome}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s"'>]+))`, 'i'));
  return m ? (m[1] ?? m[2] ?? m[3]) : undefined;
}

/** @param {string} html */
export function fonteDoPreload(html) {
  for (const tag of html.match(/<link\b[^>]*>/gi) ?? []) {
    const rel = (atributo(tag, 'rel') ?? '').toLowerCase().split(/\s+/);
    if (rel.includes('preload') && (atributo(tag, 'as') ?? '').toLowerCase() === 'font') {
      return atributo(tag, 'href') ?? '';
    }
  }
  return '';
}

// `import.meta.main` não existe em todo Node 22; comparar os caminhos, sim.
if (process.argv[1] && process.argv[1].endsWith('fonte-do-preload.mjs')) {
  let html = '';
  process.stdin.setEncoding('utf8');
  process.stdin.on('data', d => { html += d; });
  process.stdin.on('end', () => { process.stdout.write(fonteDoPreload(html)); });
}
