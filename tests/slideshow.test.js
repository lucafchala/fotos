// Modo apresentação (#212): removido na 4.6.0 a pedido do dono ("ngm usa").
// Este teste prende a remoção: nem o botão na página do evento, nem o de
// pausar/continuar no lightbox, nem o código que girava as fotos.
import { describe, it, expect } from 'vitest';
import { eventHTML } from '../src/ui/event.js';

const base = { id: 'a', slug: 'a', title: 'A', accessType: 'public', date: '2026-01-01' };
const fotos = n => Array.from({ length: n }, (_, i) => `https://lh3.googleusercontent.com/d/f${i}`);

describe('modo apresentação (removido)', () => {
  it('a página do evento não tem o botão nem o controle do lightbox', () => {
    const html = eventHTML({ ...base, photos: fotos(3) }, '2026', null);
    expect(html).not.toContain('startSlideshow');
    expect(html).not.toContain('toggleSlideshow');
    expect(html).not.toContain('lb-play');
    expect(html).not.toMatch(/Slideshow|slideTimer/);
  });
  it('o carrossel e o lightbox continuam', () => {
    const html = eventHTML({ ...base, photos: fotos(3) }, '2026', null);
    expect(html).toContain('id="lightbox"');
    expect(html).toContain('data-action="cGoNext"');
  });
});
