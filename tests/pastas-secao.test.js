// #319: pasta de fotógrafo fora dos Créditos vira um chip de seção com o nome
// cru da pasta. A faixa do dono lista essas pastas para ele perceber antes da
// turma; o visitante nunca vê a dica.
import { describe, it, expect } from 'vitest';
import { galeriaHTML, pastasQueViraramSecao } from '../src/ui/galeria.js';
import { EVENTO } from './helpers/paginas.js';

const foto = (/** @type {string} */ id) => [id, 6000, 4000, `${id}.jpg`, 1000];
const listagem = (/** @type {{ nome: string, caminho: string }[]} */ secoes) => ({
  v: 1, pasta: 'RAIZ', em: '2026-11-14T12:00:00.000Z', truncada: false, total: secoes.length, videos: 0, outros: 0, rk: {},
  secoes: secoes.map((s, i) => ({ ...s, fotos: [foto(`FOTO_${i}_AAAAAAAA`)] })),
});

describe('pastasQueViraramSecao', () => {
  it('lista as pastas de primeiro nível que não são ano', () => {
    const l = listagem([
      { nome: '', caminho: '' },
      { nome: 'comissao', caminho: 'comissao' },
      { nome: 'santa oficial', caminho: 'santa oficial' },
      { nome: 'Sub', caminho: 'comissao / Sub' },
    ]);
    expect(pastasQueViraramSecao(l)).toEqual(['comissao', 'santa oficial']);
  });

  it('ano e "ano / dia" não entram, e o "!" de seleção sai do nome', () => {
    const l = listagem([
      { nome: '2024', caminho: '2024' },
      { nome: 'Dia 1', caminho: '2025 / Dia 1' },
      { nome: '!Bastidores', caminho: '!Bastidores' },
    ]);
    expect(pastasQueViraramSecao(l)).toEqual(['Bastidores']);
  });

  it('sem lista ou só a raiz: nada', () => {
    expect(pastasQueViraramSecao(null)).toEqual([]);
    expect(pastasQueViraramSecao(listagem([{ nome: '', caminho: '' }]))).toEqual([]);
  });
});

describe('faixa do dono', () => {
  const l = listagem([{ nome: '', caminho: '' }, { nome: 'comissao', caminho: 'comissao' }]);

  it('o dono vê a dica com o nome da pasta', () => {
    const html = galeriaHTML({ event: EVENTO, listagem: l, erro: null, nonce: 'N', dono: true });
    expect(html).toContain('<span class="g-dica-sec">');
    expect(html).toContain('Pastas que viraram seção: comissao.');
  });

  it('o visitante não vê', () => {
    const html = galeriaHTML({ event: EVENTO, listagem: l, erro: null, nonce: 'N', dono: false });
    expect(html).not.toContain('Pastas que viraram seção');
  });

  it('sem pasta virando seção, a dica não aparece', () => {
    const html = galeriaHTML({ event: EVENTO, listagem: listagem([{ nome: '2024', caminho: '2024' }]), erro: null, nonce: 'N', dono: true });
    expect(html).not.toContain('Pastas que viraram seção');
  });
});
