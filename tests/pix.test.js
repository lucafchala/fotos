// "Apoie o projeto" (v3.3, Pix estático). O que estes testes prendem:
//  1. o CRC16 e o BR Code batem com o exemplo do manual do Banco Central;
//  2. só chaves aceitas (aleatória, e-mail, telefone, CNPJ) — CPF nunca, porque
//     a chave aparece na página;
//  3. o QR desenhado na página é lido de volta (jsqr) como o mesmo código;
//  4. a seção só aparece com os três campos e em álbum público.
import { describe, it, expect } from 'vitest';
import jsQR from 'jsqr';
import { crc16, brCodePix, chavePixValida, textoPix } from '../src/pix.js';
import { galeriaIndiceHTML } from '../src/ui/galeria-indice.js';
import { normalizeEventFields } from '../src/index.js';

const CHAVE = '123e4567-e12b-12d1-a456-426655440000';

describe('BR Code do Pix', () => {
  it('CRC16-CCITT: o valor de conferência e o exemplo do manual do BCB', () => {
    expect(crc16('123456789')).toBe('29B1');
    expect(crc16('00020126580014br.gov.bcb.pix0136123e4567-e12b-12d1-a456-4266554400005204000053039865802BR5913Fulano de Tal6008BRASILIA62070503***6304')).toBe('1D3D');
  });

  it('o código estático tem os campos do padrão, sem valor, e termina no CRC dele mesmo', () => {
    const c = brCodePix({ chave: CHAVE, nome: 'Luca F. Chála', cidade: 'São Paulo' });
    expect(c).toBe(`00020126580014br.gov.bcb.pix0136${CHAVE}5204000053039865802BR5913LUCA F. CHALA6009SAO PAULO62070503***6304${crc16(c.slice(0, -4))}`);
    expect(c).not.toContain('54'.concat('0')); // sem campo 54 (valor): quem doa escolhe
  });

  it('nome e cidade: sem acento, maiúsculos e com o teto do padrão (25 e 15)', () => {
    expect(textoPix('Ação & Cia\u0007', 25)).toBe('ACAO & CIA');
    expect(textoPix('x'.repeat(40), 25)).toHaveLength(25);
    expect(brCodePix({ chave: CHAVE, nome: 'Fulano', cidade: 'Florianópolis do Norte' })).toContain('6015FLORIANOPOLIS ');
  });

  it('chaves: aleatória, e-mail, telefone e CNPJ sim; CPF e lixo não', () => {
    expect(chavePixValida(CHAVE.toUpperCase())).toBe(CHAVE);
    expect(chavePixValida(' Luca@Example.com ')).toBe('luca@example.com');
    expect(chavePixValida('+55 (11) 98921-1178')).toBe('+5511989211178');
    expect(chavePixValida('12.345.678/0001-95')).toBe('12345678000195');
    for (const ruim of ['123.456.789-09', '12345678909', '11989211178', 'oi', '', 42, null, 'a'.repeat(80) + '@x.com']) expect(chavePixValida(ruim)).toBe('');
    expect(brCodePix({ chave: '12345678909', nome: 'A', cidade: 'B' })).toBe('');
    expect(brCodePix({ chave: CHAVE, nome: '', cidade: 'B' })).toBe('');
  });
});

const EVENTO = {
  slug: 'entrenos2026', title: 'Entre Nós', accessType: 'public', galeriaCapitulos: true, galeriaAbertura: 'Oi.',
  driveUrl: 'https://drive.google.com/drive/folders/RAIZ_PASTA_0001', pixChave: CHAVE, pixNome: 'Luca F. Chala', pixCidade: 'São Paulo',
};
const caps = { v: /** @type {1} */ (1), pasta: 'RAIZ_PASTA_0001', em: '2026-11-06T12:00:00.000Z', truncada: false, caps: [{ id: 'CAPITULO0000001', rk: '', bruto: 'A', nome: 'A', slug: 'a' }] };
/** @param {Record<string, any>} [ev] */
const pagina = (ev = {}) => galeriaIndiceHTML({ event: /** @type {any} */ ({ ...EVENTO, ...ev }), caps, resumo: {}, ocultas: [], dono: false, indexavel: true, nonce: 'N' });

/** Rasteriza o SVG do QR da página (os retângulos do path) e lê com o jsqr. @param {string} h */
function leQR(h) {
  const m = h.match(/<svg class="al-pix-qr" viewBox="0 0 (\d+) \1"[^>]*><rect[^>]*\/><path d="([^"]+)"/);
  if (!m) return null;
  const lado = Number(m[1]);
  const esc = 6;
  const L = lado * esc;
  const px = new Uint8ClampedArray(L * L * 4).fill(255);
  for (const [, x, y, w] of m[2].matchAll(/M(\d+) (\d+)h(\d+)v1h-\d+z/g)) {
    for (let yy = Number(y) * esc; yy < (Number(y) + 1) * esc; yy++) {
      for (let xx = Number(x) * esc; xx < (Number(x) + Number(w)) * esc; xx++) {
        const i = (yy * L + xx) * 4;
        px[i] = px[i + 1] = px[i + 2] = 0;
      }
    }
  }
  const r = jsQR(px, L, L);
  return r ? r.data : null;
}

describe('"Apoie o projeto" na página do álbum', () => {
  it('o QR da página é lido de volta como o mesmo código do "copia e cola"', () => {
    const h = pagina();
    const codigo = brCodePix({ chave: EVENTO.pixChave, nome: EVENTO.pixNome, cidade: EVENTO.pixCidade });
    expect(codigo).not.toBe('');
    expect(h).toContain(`<textarea id="al-pix-cod" class="al-pix-cod" rows="4" readonly>${codigo}</textarea>`);
    expect(leQR(h)).toBe(codigo);
    expect(h).toContain('Vai direto para Luca F. Chala.');
    expect(h).toContain('<script nonce="N">(function () {\n  var b = document.getElementById(\'al-pix-copiar\');');
  });

  it('sem os três campos, ou em álbum família/privado, a seção não aparece', () => {
    for (const ev of [{ pixChave: '' }, { pixNome: '' }, { pixCidade: '' }, { pixChave: '12345678909' }, { accessType: 'family' }, { accessType: 'private' }]) {
      expect(pagina(ev)).not.toContain('al-apoio');
    }
  });

  it('o painel grava só chave aceita; nome e cidade sem caractere de controle', () => {
    const base = { slug: 'x' };
    expect(normalizeEventFields({ pixChave: '123.456.789-09' }, base, []).pixChave).toBe('');
    expect(normalizeEventFields({ pixChave: CHAVE }, base, []).pixChave).toBe(CHAVE);
    expect(normalizeEventFields({ pixNome: ' Luca\u0000 ' }, base, []).pixNome).toBe('Luca');
    expect(normalizeEventFields({}, base, []).pixChave).toBe('');
  });
});
