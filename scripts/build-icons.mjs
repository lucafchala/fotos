// Rasteriza os ícones do site para PNG e os empacota em `src/content/icons.js`
// (base64), no padrão de build-fonts.mjs e build-vendor.mjs: o Worker não tem
// sistema de arquivos. O iOS ignora SVG em apple-touch-icon, e o manifest
// precisa de PNG 192/512.
//
// `tests/icons.test.js` confere o módulo gerado contra `src/content/icon-svg.js`
// (o sha256 do SVG de origem vai no arquivo): mudar o SVG sem rodar
// `npm run build:icons` reprova a suíte.

import { writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';
import { ICON_SVG, ICON_MASKABLE_SVG, OG_PADRAO_SVG } from '../src/content/icon-svg.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const sha = (/** @type {string} */ t) => createHash('sha256').update(t, 'utf8').digest('hex');

const ALVOS = [
  { rota: '/apple-touch-icon.png', lado: 180, svg: ICON_SVG },
  { rota: '/icon-192.png', lado: 192, svg: ICON_SVG },
  { rota: '/icon-512.png', lado: 512, svg: ICON_SVG },
  { rota: '/icon-512-maskable.png', lado: 512, svg: ICON_MASKABLE_SVG },
  { rota: '/og-padrao.png', lado: 1200, altura: 630, svg: OG_PADRAO_SVG },
];

const icones = [];
for (const { rota, lado, altura = lado, svg } of ALVOS) {
  const png = await sharp(Buffer.from(svg), { density: 384 }).resize(lado, altura).png({ compressionLevel: 9 }).toBuffer();
  icones.push({ rota, lado, altura, sourceSha256: sha(svg), bytes: png.length, b64: png.toString('base64') });
}

const out = `// ARQUIVO GERADO — não edite à mão.
//
// Fonte: src/content/icon-svg.js
// Gerar:  npm run build:icons

export const ICONES = ${JSON.stringify(icones, null, 2)};
`;
writeFileSync(join(ROOT, 'src/content/icons.js'), out);
console.log(`icons.js gerado: ${icones.length} ícones, ${icones.reduce((t, i) => t + i.bytes, 0)} bytes`);
