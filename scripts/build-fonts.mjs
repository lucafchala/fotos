// Empacota os WOFF2 de `fonts/` em `src/content/fonts.js` — um Worker não tem
// sistema de arquivos, então os bytes precisam estar no bundle (o mesmo motivo
// do `build-legal-docs.mjs`). Servir da própria origem é o que tira o Google
// Fonts do caminho: cada página carregava o CSS e os WOFF2 de lá, entregando
// o IP de todo visitante a um terceiro no exterior (#131).
//
// Os arquivos são o Inter variável do pacote npm `@fontsource-variable/inter`
// 5.3.0 (Inter v20, os MESMOS arquivos que o Google Fonts servia, subset
// latin — cobre o português inteiro). Licença SIL OFL 1.1, em `fonts/OFL.txt`:
// a licença exige que ela acompanhe a fonte.
//
// O nome publicado leva os 10 primeiros hex do sha256 do arquivo. É isso que
// torna seguro servir com `immutable`: arquivo novo é URL nova, e nenhum
// browser fica preso na fonte velha por um ano.
//
// Os testes (`tests/fonts.test.js`) conferem o módulo gerado contra os
// arquivos: trocar um WOFF2 sem rodar `npm run build:fonts` reprova a suíte.

import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

// Faixa do subset latin, copiada do CSS do próprio pacote. Declarada no
// @font-face para o browser só baixar o arquivo se a página usar um desses
// caracteres; fora dela (seta →, por exemplo), cai na fonte do sistema —
// exatamente como já acontecia com o Google Fonts.
const LATIN = 'U+0000-00FF,U+0131,U+0152-0153,U+02BB-02BC,U+02C6,U+02DA,U+02DC,U+0304,U+0308,U+0329,U+2000-206F,U+20AC,U+2122,U+2191,U+2193,U+2212,U+2215,U+FEFF,U+FFFD';

const FACES = [
  { file: 'inter-latin-wght-normal.woff2', style: 'normal' },
  { file: 'inter-latin-wght-italic.woff2', style: 'italic' },
];

const fonts = FACES.map(({ file, style }) => {
  const bytes = readFileSync(join(ROOT, 'fonts', file));
  // Cabeçalho mágico do WOFF2. Um arquivo trocado por HTML de erro ou por um
  // TTF não pode virar "fonte" publicada com cache de um ano.
  if (bytes.subarray(0, 4).toString('latin1') !== 'wOF2') {
    throw new Error(`fonts/${file} não é WOFF2`);
  }
  const sha256 = createHash('sha256').update(bytes).digest('hex');
  return {
    style,
    source: `fonts/${file}`,
    path: `/fonts/${file.replace(/\.woff2$/, '')}.${sha256.slice(0, 10)}.woff2`,
    unicodeRange: LATIN,
    sha256,
    bytes: bytes.length,
    b64: bytes.toString('base64'),
  };
});

const out = `// ARQUIVO GERADO — não edite à mão.
//
// Fonte: fonts/*.woff2 (Inter, SIL OFL 1.1 — ver fonts/OFL.txt)
// Gerar:  npm run build:fonts

export const FONTS = ${JSON.stringify(fonts, null, 2)};
`;

mkdirSync(join(ROOT, 'src/content'), { recursive: true });
writeFileSync(join(ROOT, 'src/content/fonts.js'), out);
console.log(`fonts.js gerado: ${fonts.length} faces, ${out.length} bytes`);
