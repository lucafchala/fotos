// Leitura do QR baixado no PRÓPRIO Node, sem page.evaluate (#302).
//
// O roteiro do painel desenhava o PNG e o SVG baixados num canvas do
// navegador para o jsqr ler. No Chromium 158 (playwright-core 1.65) esse
// page.evaluate logo depois de um download morria com "Execution context was
// destroyed" — até numa aba nova, que nunca navegou. Ler os bytes aqui tira o
// navegador da conta: o que o roteiro prova é o arquivo que a pessoa recebe.
//
// Só o que o painel gera é aceito, e o resto lança (o roteiro registra como
// falha): PNG de 8 bits por canal, RGB ou RGBA, sem entrelaçamento (o que o
// canvas.toBlob produz); SVG com o <path> de módulos "M x y h n v1 h-n z" de
// svgDoQr (src/ui/dashboard.js).

import { inflateSync } from 'node:zlib';

/**
 * @param {Buffer} buf
 * @returns {{ w: number, h: number, data: Uint8ClampedArray }} RGBA
 */
export function decodificaPng(buf) {
  if (buf.length < 8 || buf.readUInt32BE(0) !== 0x89504e47) throw new Error('não é PNG');
  let p = 8, w = 0, h = 0, canais = 0;
  /** @type {Buffer[]} */
  const idat = [];
  while (p + 8 <= buf.length) {
    const tam = buf.readUInt32BE(p);
    const tipo = buf.toString('latin1', p + 4, p + 8);
    const corpo = buf.subarray(p + 8, p + 8 + tam);
    if (tipo === 'IHDR') {
      w = corpo.readUInt32BE(0);
      h = corpo.readUInt32BE(4);
      const prof = corpo[8], cor = corpo[9], entrelacado = corpo[12];
      if (prof !== 8 || (cor !== 6 && cor !== 2) || entrelacado !== 0) throw new Error(`PNG fora do formato do canvas (profundidade ${prof}, cor ${cor}, entrelaçado ${entrelacado})`);
      canais = cor === 6 ? 4 : 3;
    } else if (tipo === 'IDAT') idat.push(corpo);
    else if (tipo === 'IEND') break;
    p += 12 + tam;
  }
  if (!w || !h || !idat.length) throw new Error('PNG sem IHDR ou IDAT');
  const cru = inflateSync(Buffer.concat(idat));
  const linha = w * canais;
  if (cru.length < h * (linha + 1)) throw new Error('PNG curto');
  const px = new Uint8Array(w * h * canais);
  for (let y = 0; y < h; y++) {
    const filtro = cru[y * (linha + 1)];
    const ent = y * (linha + 1) + 1;
    const sai = y * linha;
    for (let i = 0; i < linha; i++) {
      const x = cru[ent + i];
      const a = i >= canais ? px[sai + i - canais] : 0;
      const b = y > 0 ? px[sai - linha + i] : 0;
      const c = i >= canais && y > 0 ? px[sai - linha + i - canais] : 0;
      let v;
      if (filtro === 0) v = x;
      else if (filtro === 1) v = x + a;
      else if (filtro === 2) v = x + b;
      else if (filtro === 3) v = x + ((a + b) >> 1);
      else if (filtro === 4) {
        const pp = a + b - c, pa = Math.abs(pp - a), pb = Math.abs(pp - b), pc = Math.abs(pp - c);
        v = x + (pa <= pb && pa <= pc ? a : pb <= pc ? b : c);
      } else throw new Error(`filtro de PNG desconhecido: ${filtro}`);
      px[sai + i] = v & 255;
    }
  }
  if (canais === 4) return { w, h, data: new Uint8ClampedArray(px.buffer) };
  const rgba = new Uint8ClampedArray(w * h * 4);
  for (let i = 0, j = 0; i < px.length; i += 3, j += 4) {
    rgba[j] = px[i]; rgba[j + 1] = px[i + 1]; rgba[j + 2] = px[i + 2]; rgba[j + 3] = 255;
  }
  return { w, h, data: rgba };
}

/**
 * Rasteriza só os módulos do QR (o texto embaixo não entra: o jsqr não
 * precisa dele, e o título é conferido no texto do SVG).
 * @param {string} svg
 * @param {number} [escala] pixels por módulo
 * @returns {{ w: number, h: number, data: Uint8ClampedArray }} RGBA
 */
export function rasterizaSvgDoQr(svg, escala = 8) {
  const vb = /viewBox="0 0 ([\d.]+) ([\d.]+)"/.exec(svg);
  const d = /<path d="([^"]*)"/.exec(svg);
  if (!vb || !d) throw new Error('SVG sem viewBox ou sem o <path> dos módulos');
  const lado = Math.ceil(Number(vb[1]));
  const w = lado * escala, h = lado * escala;
  const data = new Uint8ClampedArray(w * h * 4).fill(255);
  const re = /M(\d+) (\d+)h(\d+)v1h-(\d+)z/g;
  let m, n = 0;
  while ((m = re.exec(d[1]))) {
    const x0 = Number(m[1]), y0 = Number(m[2]), larg = Number(m[3]);
    if (y0 >= lado || x0 + larg > lado) continue;
    n++;
    for (let y = y0 * escala; y < (y0 + 1) * escala; y++) {
      for (let x = x0 * escala; x < (x0 + larg) * escala; x++) {
        const k = (y * w + x) * 4;
        data[k] = 0; data[k + 1] = 0; data[k + 2] = 0;
      }
    }
  }
  if (!n) throw new Error('SVG sem módulos no formato de svgDoQr');
  return { w, h, data };
}
