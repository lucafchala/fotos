/* global document */
// Gera src/content/og-entrenos.js (o cartão de link JPEG 1200×630 do
// entrenos2026.com) a partir de scripts/og/entrenos.html, com as fontes do
// próprio site. Rodar só quando o desenho mudar (precisa do Chromium do
// Playwright): PLAYWRIGHT_BROWSERS_PATH=… node scripts/og/gera-og-entrenos.mjs
import { chromium } from 'playwright-core';
import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { createHash } from 'node:crypto';
const aqui = dirname(fileURLToPath(import.meta.url));
const b = await chromium.launch();
const p = await b.newPage({ viewport: { width: 1200, height: 630 } });
await p.goto('file://' + join(aqui, 'entrenos.html'));
await p.evaluate(() => document.fonts.ready);
const png = await p.screenshot({ type: 'jpeg', quality: 88 });
await b.close();
const sha = createHash('sha256').update(png).digest('hex');
writeFileSync(join(aqui, '../../src/content/og-entrenos.js'), `// ARQUIVO GERADO — não edite à mão. Fonte: scripts/og/entrenos.html
// Gerar: node scripts/og/gera-og-entrenos.mjs

export const OG_ENTRENOS = { sha256: '${sha}', bytes: ${png.length}, largura: 1200, altura: 630, b64: '${png.toString('base64')}' };
`);
console.log('og-entrenos.jpg', png.length, 'bytes');
