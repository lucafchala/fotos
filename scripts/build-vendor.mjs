// Empacota as bibliotecas de terceiros vendorizadas em `vendor/` num módulo
// JS (`src/content/vendor.js`) — mesmo motivo do build-fonts.mjs: o Worker não
// tem sistema de arquivos, e a CSP só aceita script da própria origem.
//
// Hoje é só o PhotoSwipe (visualizador da galeria própria, #235). Ver
// `vendor/photoswipe/README.md` para a origem exata e como atualizar.
//
// O nome publicado leva os 10 primeiros hex do sha256 do arquivo: arquivo
// novo é URL nova, então dá para servir com `immutable` sem nenhum browser
// ficar preso numa versão velha.
//
// `tests/vendor.test.js` confere o módulo gerado contra os arquivos: trocar um
// arquivo em `vendor/` sem rodar `npm run build:vendor` reprova a suíte.

import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

const ARQUIVOS = [
  { nome: 'photoswipe-lightbox', source: 'vendor/photoswipe/photoswipe-lightbox.esm.min.js', ext: 'js', contentType: 'text/javascript; charset=utf-8' },
  { nome: 'photoswipe', source: 'vendor/photoswipe/photoswipe.esm.min.js', ext: 'js', contentType: 'text/javascript; charset=utf-8' },
  { nome: 'photoswipe', source: 'vendor/photoswipe/photoswipe.css', ext: 'css', contentType: 'text/css; charset=utf-8' },
];

const vendor = ARQUIVOS.map(({ nome, source, ext, contentType }) => {
  const texto = readFileSync(join(ROOT, source), 'utf8');
  const sha256 = createHash('sha256').update(texto, 'utf8').digest('hex');
  return {
    source,
    path: `/vendor/${nome}.${sha256.slice(0, 10)}.${ext}`,
    contentType,
    sha256,
    texto,
  };
});

const out = `// ARQUIVO GERADO — não edite à mão.
//
// Fonte: vendor/ (PhotoSwipe 5.4.4, licença MIT — ver vendor/photoswipe/LICENSE)
// Gerar:  npm run build:vendor

export const VENDOR = ${JSON.stringify(vendor, null, 2)};
`;

mkdirSync(join(ROOT, 'src/content'), { recursive: true });
writeFileSync(join(ROOT, 'src/content/vendor.js'), out);
console.log(`vendor.js gerado: ${vendor.length} arquivos, ${out.length} bytes`);
