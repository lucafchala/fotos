// Quatro acertos do portão do Drive, vistos no Chromium (handoff 4.2).
import { describe, it, expect } from 'vitest';
import { eventHTML } from '../src/ui/event.js';
import { EVENTO } from './helpers/paginas.js';

const html = eventHTML(EVENTO, '2026', null, 'NONCE', 'nonce-drive', 'form-token');
const css = (/** @type {string} */ seletor) => {
  const m = html.match(new RegExp(seletor.replace(/[.#[\]\\]/g, '\\$&') + '\\{([^}]*)\\}'));
  return m ? m[1] : '';
};

describe('portão do Drive: o que a página afirma e onde fica', () => {
  it('o aviso do código diz o que vai acontecer, não que já aconteceu', () => {
    expect(html).not.toContain('Mandamos um código de 6 dígitos para o seu e-mail.');
    expect(html).toMatch(/Ao tocar em <strong>Enviar código<\/strong>, mandamos um código/);
  });

  it('o motivo do teto de álbuns fica acima do campo de e-mail, não abaixo do botão', () => {
    const motivo = html.indexOf('id="drive-email-motivo"');
    const campo = html.indexOf('id="drive-email-addr"');
    const msg = html.indexOf('id="drive-email-msg"');
    expect(motivo).toBeGreaterThan(0);
    expect(motivo).toBeLessThan(campo);
    expect(campo).toBeLessThan(msg);
    expect(html).toContain("driveEmailMotivo(errData.error || 'Para abrir este álbum");
  });

  it('a janela do portão fica acima do aviso de cookies no celular', () => {
    const z = (/** @type {string} */ s) => Number((css(s).match(/z-index:(\d+)/) || [])[1]);
    expect(z('.modal-ov')).toBeGreaterThan(z('.cookie-notice'));
    expect(z('.modal-ov')).toBeLessThan(z('.lightbox-ov'));
  });

  it('o aviso de bloqueador tem folga antes do campo de nome', () => {
    expect(css('#drive-adblock')).toMatch(/margin-bottom:1rem/);
  });
});

describe('#210: "Pedir orçamento" leva ao /suporte com um modelo preenchido', () => {
  it('a página /sobre aponta para ?tema=orcamento com o rótulo certo', async () => {
    const { aboutHTML } = await import('../src/ui/about.js');
    const pagina = aboutHTML('NONCE');
    expect(pagina).toMatch(/href="\/suporte\?tema=orcamento"[\s\S]*?Pedir orçamento/);
  });

  it('o /suporte?tema=orcamento abre com o modelo no campo de mensagem', async () => {
    const { default: worker } = await import('../src/index.js');
    const kv = { get: async () => null, put: async () => {}, delete: async () => {}, list: async () => ({ keys: [], list_complete: true }) };
    const ctx = { waitUntil() {}, passThroughOnException() {} };
    const res = await worker.fetch(new Request('https://fotos.test/suporte?tema=orcamento'), { FOTOS: kv }, ctx);
    const corpo = await res.text();
    expect(res.status).toBe(200);
    expect(corpo).toMatch(/<textarea[^>]*>Olá! Quero pedir um orçamento\./);
    expect(corpo).toContain('Tipo de evento:');
    expect(corpo).toContain('Data:');
  });
});
