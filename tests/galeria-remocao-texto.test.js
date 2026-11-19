// 4.1.4: o formulário "Pedir remoção" explica o que vai acontecer; o
// "Recebemos o pedido" só aparece depois do envio, na confirmação.
import { describe, it, expect } from 'vitest';
import { galeriaHTML, GALERIA_JS } from '../src/ui/galeria.js';
import { EVENTO } from './helpers/paginas.js';

const foto = (/** @type {string} */ id) => [id, 6000, 4000, `${id}.jpg`, 1000];
const listagem = {
  v: 1, pasta: 'RAIZ', em: '2026-11-14T12:00:00.000Z', truncada: false, total: 2, videos: 0, outros: 0, rk: {},
  secoes: [{ nome: 'Abertura', caminho: 'Abertura', fotos: [foto('FOTO_A_00000001'), foto('FOTO_B_00000001')] }],
};

describe('texto do pedido de remoção', () => {
  const html = galeriaHTML(/** @type {any} */ ({ event: EVENTO, listagem, erro: null, nonce: 'n', dono: false, formToken: 't' }));
  const form = (html.match(/<form id="g-rem-f"[\s\S]*?<\/form>/) || [''])[0];

  it('antes de enviar, o formulário não diz que recebeu nada', () => {
    expect(form).toContain('id="g-rem-motivo"');
    expect(form).not.toMatch(/Recebemos|recebido|enviado/i);
    expect(form).toContain('O fotógrafo analisa cada pedido e responde no e-mail que você deixar aqui.');
    expect(form).toContain('A foto continua no álbum enquanto isso.');
  });

  it('a confirmação, depois do envio, continua dizendo que recebeu', () => {
    expect(GALERIA_JS.texto).toContain("'Recebemos o pedido. O fotógrafo vai analisar e você recebe a resposta no e-mail '");
    expect(html).toMatch(/<div class="g-rem-ok" id="g-rem-ok" hidden>/);
  });
});
