// Gerador de QR code (v3.1, #251) — pequeno e sem dependência: modo byte (UTF-8),
// correção de erro nível M, versões 1 a 10 (até 213 bytes), a menor que couber.
// Serve ao painel do dono: o link da galeria de um projeto ou capítulo virar um
// QR para imprimir. Segue ISO/IEC 18004 (disposição, Reed-Solomon sobre
// GF(256)/0x11D, as 8 máscaras com a penalidade padrão, informação de formato
// e de versão). tests/qr.test.js decodifica o resultado com uma biblioteca
// leitora (jsqr, só devDependency) — é isso que prova que está certo.

/** Por versão (1..10), nível M: [bytes de correção por bloco, blocos do grupo 1, dados por bloco, blocos do grupo 2, dados por bloco]. */
const BLOCOS_M = [
  null,
  [10, 1, 16, 0, 0], [16, 1, 28, 0, 0], [26, 1, 44, 0, 0], [18, 2, 32, 0, 0], [24, 2, 43, 0, 0],
  [16, 4, 27, 0, 0], [18, 4, 31, 0, 0], [22, 2, 38, 2, 39], [22, 3, 36, 2, 37], [26, 4, 43, 1, 44],
];
/** Centros dos padrões de alinhamento por versão. */
const ALINHAMENTO = [null, [], [6, 18], [6, 22], [6, 26], [6, 30], [6, 34], [6, 22, 38], [6, 24, 42], [6, 26, 46], [6, 28, 50]];
export const QR_VERSAO_MAX = 10;

/** @param {number} v */
const dadosDaVersao = v => { const b = /** @type {number[]} */ (BLOCOS_M[v]); return b[1] * b[2] + b[3] * b[4]; };

// ---- GF(256) -----------------------------------------------------------
const EXP = new Uint8Array(512);
const LOG = new Uint8Array(256);
for (let i = 0, x = 1; i < 255; i++) {
  EXP[i] = x;
  LOG[x] = i;
  x <<= 1;
  if (x & 0x100) x ^= 0x11d;
}
for (let i = 255; i < 512; i++) EXP[i] = EXP[i - 255];
/** @param {number} a @param {number} b */
const mul = (a, b) => (a && b ? EXP[LOG[a] + LOG[b]] : 0);

/** Resto da divisão dos dados pelo gerador de grau `grau`. @param {number[]} dados @param {number} grau */
function restoRS(dados, grau) {
  // gerador = (x - a^0)(x - a^1)...(x - a^(grau-1)), coeficientes do maior para o menor (sem o líder 1)
  let ger = [1];
  for (let i = 0; i < grau; i++) {
    const prox = new Array(ger.length + 1).fill(0);
    for (let j = 0; j < ger.length; j++) {
      prox[j] ^= ger[j];
      prox[j + 1] ^= mul(ger[j], EXP[i]);
    }
    ger = prox;
  }
  const resto = new Array(grau).fill(0);
  for (const b of dados) {
    const f = b ^ resto[0];
    resto.shift();
    resto.push(0);
    if (f) for (let i = 0; i < grau; i++) resto[i] ^= mul(ger[i + 1], f);
  }
  return resto;
}

/**
 * Os bytes de dados (com cabeçalho, terminador e enchimento) e, por cima, os de
 * correção, intercalados como a norma manda.
 * @param {Uint8Array} bytes @param {number} versao
 */
function palavrasDeCodigo(bytes, versao) {
  const total = dadosDaVersao(versao) * 8;
  /** @type {number[]} */
  const bits = [];
  /** @param {number} valor @param {number} n */
  const poe = (valor, n) => { for (let i = n - 1; i >= 0; i--) bits.push((valor >>> i) & 1); };
  poe(0b0100, 4);
  poe(bytes.length, versao >= 10 ? 16 : 8);
  for (const b of bytes) poe(b, 8);
  poe(0, Math.min(4, total - bits.length));
  while (bits.length % 8) bits.push(0);
  for (let pad = 0xec; bits.length < total; pad ^= 0xec ^ 0x11) poe(pad, 8);
  const dados = [];
  for (let i = 0; i < bits.length; i += 8) dados.push(parseInt(bits.slice(i, i + 8).join(''), 2));

  const [ec, n1, d1, n2, d2] = /** @type {number[]} */ (BLOCOS_M[versao]);
  /** @type {number[][]} */
  const blocos = [];
  let pos = 0;
  for (let i = 0; i < n1 + n2; i++) {
    const tam = i < n1 ? d1 : d2;
    blocos.push(dados.slice(pos, pos + tam));
    pos += tam;
  }
  const ecs = blocos.map(b => restoRS(b, ec));
  const saida = [];
  for (let i = 0; i < Math.max(d1, d2); i++) for (const b of blocos) if (i < b.length) saida.push(b[i]);
  for (let i = 0; i < ec; i++) for (const e of ecs) saida.push(e[i]);
  return saida;
}

/** @param {number} valor @param {number} i */
const bit = (valor, i) => ((valor >>> i) & 1) !== 0;

/**
 * @param {string} texto
 * @returns {{ n: number, versao: number, modulos: boolean[][] }} `modulos[y][x]`, true = escuro
 */
export function qrMatriz(texto) {
  const bytes = new TextEncoder().encode(String(texto));
  let versao = 1;
  while (versao <= QR_VERSAO_MAX && bytes.length + (versao >= 10 ? 3 : 2) > dadosDaVersao(versao)) versao++;
  if (versao > QR_VERSAO_MAX) throw new RangeError('Texto grande demais para o QR code (até 213 bytes).');
  const n = 17 + 4 * versao;
  const mod = Array.from({ length: n }, () => new Array(n).fill(false));
  const func = Array.from({ length: n }, () => new Array(n).fill(false));
  /** @param {number} x @param {number} y @param {boolean} v */
  const poeFunc = (x, y, v) => { mod[y][x] = v; func[y][x] = true; };

  // Temporização, localizadores, alinhamento.
  for (let i = 0; i < n; i++) { poeFunc(6, i, i % 2 === 0); poeFunc(i, 6, i % 2 === 0); }
  for (const [cx, cy] of [[3, 3], [n - 4, 3], [3, n - 4]]) {
    for (let dy = -4; dy <= 4; dy++) {
      for (let dx = -4; dx <= 4; dx++) {
        const d = Math.max(Math.abs(dx), Math.abs(dy));
        const x = cx + dx, y = cy + dy;
        if (x >= 0 && x < n && y >= 0 && y < n) poeFunc(x, y, d !== 2 && d !== 4);
      }
    }
  }
  const alin = /** @type {number[]} */ (ALINHAMENTO[versao]);
  for (let i = 0; i < alin.length; i++) {
    for (let j = 0; j < alin.length; j++) {
      if ((i === 0 && j === 0) || (i === 0 && j === alin.length - 1) || (i === alin.length - 1 && j === 0)) continue;
      for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) poeFunc(alin[i] + dx, alin[j] + dy, Math.max(Math.abs(dx), Math.abs(dy)) !== 1);
    }
  }

  /** @param {number} mascara */
  const desenhaFormato = mascara => {
    const dados = (0 << 3) | mascara; // nível M = 00
    let r = dados;
    for (let i = 0; i < 10; i++) r = (r << 1) ^ ((r >>> 9) * 0x537);
    const bits = ((dados << 10) | r) ^ 0x5412;
    for (let i = 0; i <= 5; i++) poeFunc(8, i, bit(bits, i));
    poeFunc(8, 7, bit(bits, 6));
    poeFunc(8, 8, bit(bits, 7));
    poeFunc(7, 8, bit(bits, 8));
    for (let i = 9; i < 15; i++) poeFunc(14 - i, 8, bit(bits, i));
    for (let i = 0; i < 8; i++) poeFunc(n - 1 - i, 8, bit(bits, i));
    for (let i = 8; i < 15; i++) poeFunc(8, n - 15 + i, bit(bits, i));
    poeFunc(8, n - 8, true);
  };
  desenhaFormato(0); // reserva a área (o valor certo vem depois da máscara escolhida)
  if (versao >= 7) {
    let r = versao;
    for (let i = 0; i < 12; i++) r = (r << 1) ^ ((r >>> 11) * 0x1f25);
    const bits = (versao << 12) | r;
    for (let i = 0; i < 18; i++) {
      const a = n - 11 + (i % 3), b = Math.floor(i / 3);
      poeFunc(a, b, bit(bits, i));
      poeFunc(b, a, bit(bits, i));
    }
  }

  // Os dados em zigue-zague.
  const palavras = palavrasDeCodigo(bytes, versao);
  let k = 0;
  for (let direita = n - 1; direita >= 1; direita -= 2) {
    if (direita === 6) direita = 5;
    for (let v = 0; v < n; v++) {
      for (let j = 0; j < 2; j++) {
        const x = direita - j;
        const sobe = ((direita + 1) & 2) === 0;
        const y = sobe ? n - 1 - v : v;
        if (!func[y][x] && k < palavras.length * 8) { mod[y][x] = bit(palavras[k >>> 3], 7 - (k & 7)); k++; }
      }
    }
  }

  /** @type {Array<(x: number, y: number) => boolean>} */
  const MASCARAS = [
    (x, y) => (x + y) % 2 === 0, (x, y) => y % 2 === 0, (x) => x % 3 === 0, (x, y) => (x + y) % 3 === 0,
    (x, y) => (Math.floor(x / 3) + Math.floor(y / 2)) % 2 === 0, (x, y) => ((x * y) % 2) + ((x * y) % 3) === 0,
    (x, y) => (((x * y) % 2) + ((x * y) % 3)) % 2 === 0, (x, y) => (((x + y) % 2) + ((x * y) % 3)) % 2 === 0,
  ];
  /** @param {number} m */
  const aplica = m => { for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) if (!func[y][x] && MASCARAS[m](x, y)) mod[y][x] = !mod[y][x]; };

  let melhor = 0;
  let menor = Infinity;
  for (let m = 0; m < 8; m++) {
    aplica(m);
    desenhaFormato(m);
    const p = penalidade(mod, n);
    if (p < menor) { menor = p; melhor = m; }
    aplica(m); // desfaz
  }
  aplica(melhor);
  desenhaFormato(melhor);
  return { n, versao, modulos: mod };
}

/** @param {boolean[][]} m @param {number} n */
function penalidade(m, n) {
  let p = 0;
  // Sequências de 5 ou mais módulos iguais, em linhas e colunas.
  for (let a = 0; a < n; a++) {
    for (const horizontal of [true, false]) {
      let corrida = 1;
      for (let b = 1; b < n; b++) {
        const igual = (horizontal ? m[a][b] === m[a][b - 1] : m[b][a] === m[b - 1][a]);
        if (igual) { corrida++; if (corrida === 5) p += 3; else if (corrida > 5) p++; } else corrida = 1;
      }
    }
  }
  // Blocos 2x2 da mesma cor.
  for (let y = 0; y < n - 1; y++) for (let x = 0; x < n - 1; x++) if (m[y][x] === m[y][x + 1] && m[y][x] === m[y + 1][x] && m[y][x] === m[y + 1][x + 1]) p += 3;
  // Padrão parecido com o localizador (1:1:3:1:1) com 4 claros de um lado.
  const padrao = [true, false, true, true, true, false, true];
  for (let a = 0; a < n; a++) {
    for (let b = 0; b + 7 <= n; b++) {
      for (const horizontal of [true, false]) {
        const pega = (/** @type {number} */ i) => (horizontal ? m[a][i] : m[i][a]);
        if (!padrao.every((v, i) => pega(b + i) === v)) continue;
        const claros = (/** @type {number} */ de) => { for (let i = de; i < de + 4; i++) { if (i < 0 || i >= n) return false; if (pega(i)) return false; } return true; };
        if (claros(b - 4)) p += 40;
        if (claros(b + 7)) p += 40;
      }
    }
  }
  // Proporção de módulos escuros.
  let escuros = 0;
  for (const linha of m) for (const v of linha) if (v) escuros++;
  p += 10 * Math.floor(Math.abs((escuros * 100) / (n * n) - 50) / 5);
  return p;
}

/**
 * A matriz como linhas de "0"/"1" — o formato que o painel recebe e desenha.
 * @param {string} texto
 * @returns {{ n: number, versao: number, linhas: string[] }}
 */
export function qrLinhas(texto) {
  const { n, versao, modulos } = qrMatriz(texto);
  return { n, versao, linhas: modulos.map(l => l.map(v => (v ? '1' : '0')).join('')) };
}
