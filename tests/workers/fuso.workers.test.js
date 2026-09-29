import { describe, it, expect } from 'vitest';
import { hojeEmSaoPaulo, dataHoraBR } from '../../src/utils.js';

// #192 depende de o runtime ter os dados de fuso do ICU. Isso é da
// plataforma, então se prova aqui: um workerd sem eles devolveria a data UTC
// (ou lançaria RangeError) e o node, que tem ICU completo, nunca veria.
describe('fuso de São Paulo no workerd', () => {
  it('22:30 de 25/09 em São Paulo continua 25/09, com UTC já em 26/09', () => {
    const noite = new Date('2026-09-26T01:30:00Z');
    expect(hojeEmSaoPaulo(noite)).toBe('2026-09-25');
    expect(dataHoraBR(noite)).toContain('22:30');
  });
});
