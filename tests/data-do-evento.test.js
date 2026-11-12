// O ano de cada evento escolhido pelo dono (v3.9.0, comDatasDoDono). O que
// estes testes prendem:
//  1. a data do dono passa por cima da data das fotos: ordem da linha do tempo,
//     ano da grade e o rótulo do cartão ("2024" ou "mar 2024");
//  2. só o ano: o mês das fotos fica, para ordenar os eventos do mesmo ano;
//  3. data inválida, evento sem resumo ou sem escolha: nada muda;
//  4. a faixa do dono na página do evento tem o seletor "Ano do evento".
import { describe, it, expect } from 'vitest';
import { comDatasDoDono, ordemDaLinha, mesDoEvento } from '../src/ui/album.js';
import { galeriaHTML } from '../src/ui/galeria.js';
import { normalizaDatasEventos } from '../src/index.js';

const caps = [{ id: 'A', slug: 'gala', nome: 'Gala' }, { id: 'B', slug: 'piauifut', nome: 'PiauiFut' }, { id: 'C', slug: 'novo', nome: 'Novo' }];
const resumo = {
  A: { n: 10, capas: [], p: /** @type {[number, number]} */ ([202611, 202611]), pm: 202611 },
  B: { n: 5, capas: [], p: /** @type {[number, number]} */ ([202403, 202404]), pm: 202403 },
};

describe('comDatasDoDono', () => {
  it('a data do dono vale na ordem, no ano e no rótulo', () => {
    const r = comDatasDoDono(resumo, caps, { gala: '2023' });
    expect(mesDoEvento(r.A)).toBe(202311);
    expect(r.A.rotulo).toBe('2023');
    expect(ordemDaLinha(caps, r).map(c => c.slug)).toEqual(['gala', 'piauifut', 'novo']);
    expect(ordemDaLinha(caps, resumo).map(c => c.slug)).toEqual(['piauifut', 'gala', 'novo']);
    const m = comDatasDoDono(resumo, caps, { piauifut: '2025-02' });
    expect(mesDoEvento(m.B)).toBe(202502);
    expect(m.B.rotulo).toBe('fev 2025');
    // O resumo original não muda.
    expect(resumo.A.pm).toBe(202611);
  });

  it('inválido, sem resumo ou sem escolha: nada muda', () => {
    expect(comDatasDoDono(resumo, caps, null)).toBe(resumo);
    const r = comDatasDoDono(resumo, caps, { gala: '24', piauifut: '2024-13', novo: '2024' });
    expect(r.A).toBe(resumo.A);
    expect(r.B).toBe(resumo.B);
    expect(r.C).toBeUndefined();
  });

  it('normalizaDatasEventos guarda só slug válido com data válida', () => {
    expect(normalizaDatasEventos({ gala: '2024', 'X!': '2024', piauifut: '2024-1', novo: '2024-01' })).toEqual({ gala: '2024', novo: '2024-01' });
    expect(normalizaDatasEventos('lixo')).toEqual({});
  });
});

describe('o seletor na faixa do dono', () => {
  const listagem = { secoes: [{ nome: '', fotos: [['FOTO_0000000001', 'a.jpg', 3000, 2000]] }], total: 1, atualizadoEm: Date.now() };
  const base = { event: /** @type {any} */ ({ slug: 'formatura', title: 'Formatura', accessType: 'public' }), listagem: /** @type {any} */ (listagem), erro: null, nonce: 'N', capitulo: { slug: 'gala', nome: 'Gala', anterior: null, proximo: null } };
  it('o dono vê "Ano do evento" com o automático e o escolhido marcado', () => {
    const h = galeriaHTML({ ...base, dono: true, dataDoEvento: { atual: '2024', auto: '2026' } });
    expect(h).toContain('id="g-ano"');
    expect(h).toContain('<option value="">Automático (2026)</option>');
    expect(h).toContain('<option value="2024" selected>2024</option>');
    expect(h).toMatch(/<script nonce="N">\(function \(\) \{\s*var s = document.getElementById\('g-ano'\)/);
  });
  it('visitante não vê', () => {
    expect(galeriaHTML({ ...base, dono: false })).not.toContain('id="g-ano"');
  });
});
