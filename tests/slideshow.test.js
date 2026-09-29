// Modo apresentação (#212). O comportamento (girar, pausar, tela cheia) só
// um navegador mostra — foi verificado num Chromium. Aqui fica preso o que o
// HTML decide: quando o botão existe, e que ele nasce escondido (sem JS não
// há lightbox, e um botão morto seria pior que nenhum).
import { describe, it, expect } from 'vitest';
import { eventHTML } from '../src/ui/event.js';

const base = { id: 'a', slug: 'a', title: 'A', accessType: 'public', date: '2026-01-01' };
const fotos = n => Array.from({ length: n }, (_, i) => `https://lh3.googleusercontent.com/d/f${i}`);
const botao = html => html.match(/<button[^>]*data-action="startSlideshow"[^>]*>/)?.[0] ?? null;

describe('botão de apresentação', () => {
  it('com duas ou mais fotos, existe e nasce com [hidden]', () => {
    const b = botao(eventHTML({ ...base, photos: fotos(3) }, '2026', null));
    expect(b).not.toBeNull();
    expect(b).toContain(' hidden');
  });
  it('não existe com uma foto só, sem fotos, ou em "em breve"', () => {
    expect(botao(eventHTML({ ...base, photos: fotos(1) }, '2026', null))).toBeNull();
    expect(botao(eventHTML({ ...base, photos: [] }, '2026', null))).toBeNull();
    expect(botao(eventHTML({ ...base, photos: fotos(3), comingSoon: true }, '2026', null))).toBeNull();
  });
  it('o lightbox tem o botão de pausar/continuar', () => {
    expect(eventHTML({ ...base, photos: fotos(3) }, '2026', null)).toContain('data-action="toggleSlideshow"');
  });
});
