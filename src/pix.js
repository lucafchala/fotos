// Pix estático (v3.3, "Apoie o projeto" da apresentação do álbum): o código
// "copia e cola" (BR Code, padrão EMV MPM do Banco Central) e nada mais. O
// valor fica em aberto (quem doa escolhe), não há intermediário nem taxa, e o
// site não fica sabendo quem doou: o pagamento vai direto do banco de quem doa
// para a chave do dono.
//
// A chave aparece na página (é o que o QR carrega). Por isso CPF NÃO é aceito:
// viraria um dado pessoal público. Use uma chave aleatória, e-mail, telefone
// ou CNPJ — o painel avisa.

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const EMAIL_RE = /^[^\s@]{1,64}@[^\s@]{1,190}\.[a-z]{2,}$/;
const TELEFONE_RE = /^\+[1-9]\d{10,13}$/;
const CNPJ_RE = /^\d{14}$/;

/**
 * A chave Pix aceita (normalizada), ou ''. Aceita chave aleatória (EVP), e-mail,
 * telefone com +DDI e CNPJ. CPF (11 dígitos) é recusado de propósito.
 * @param {unknown} v
 */
export function chavePixValida(v) {
  if (typeof v !== 'string') return '';
  const s = v.trim();
  if (!s || s.length > 77) return '';
  const minusc = s.toLowerCase();
  if (UUID_RE.test(minusc)) return minusc;
  if (EMAIL_RE.test(minusc)) return minusc;
  const fone = s.replace(/[\s().-]/g, '');
  if (TELEFONE_RE.test(fone)) return fone;
  const digitos = s.replace(/[.\-/\s]/g, '');
  if (CNPJ_RE.test(digitos)) return digitos;
  return '';
}

/**
 * Texto para o BR Code: sem acento, só ASCII imprimível, com teto.
 * @param {unknown} v
 * @param {number} max
 */
export function textoPix(v, max) {
  return String(v == null ? '' : v).normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/[^\x20-\x7e]/g, '').replace(/\s+/g, ' ').trim().toUpperCase().slice(0, max).trim();
}

/** CRC16-CCITT (polinômio 0x1021, início 0xFFFF), como o BR Code pede. @param {string} s */
export function crc16(s) {
  let crc = 0xffff;
  for (let i = 0; i < s.length; i++) {
    crc ^= s.charCodeAt(i) << 8;
    for (let b = 0; b < 8; b++) crc = (crc & 0x8000) ? ((crc << 1) ^ 0x1021) & 0xffff : (crc << 1) & 0xffff;
  }
  return crc.toString(16).toUpperCase().padStart(4, '0');
}

/** Um campo EMV: ID + tamanho (2 dígitos) + valor. @param {string} id @param {string} valor */
const campo = (id, valor) => `${id}${String(valor.length).padStart(2, '0')}${valor}`;

/**
 * O "Pix copia e cola" estático, sem valor. '' se a chave não for aceita ou
 * faltar nome/cidade.
 * @param {{ chave: unknown, nome: unknown, cidade: unknown }} p
 */
export function brCodePix({ chave, nome, cidade }) {
  const k = chavePixValida(chave);
  const n = textoPix(nome, 25);
  const c = textoPix(cidade, 15);
  if (!k || !n || !c) return '';
  const conta = campo('00', 'br.gov.bcb.pix') + campo('01', k);
  const corpo = campo('00', '01') + campo('26', conta) + campo('52', '0000') + campo('53', '986')
    + campo('58', 'BR') + campo('59', n) + campo('60', c) + campo('62', campo('05', '***')) + '6304';
  return corpo + crc16(corpo);
}
