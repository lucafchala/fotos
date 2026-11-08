// Evento lido vazio (v3.8.2). O que estes testes prendem:
//  1. o "vazio" vale por 6 h: depois, o evento volta para o visitante (quem
//     abrir relê); antes, um 0 antigo o escondia para sempre e só o dono via;
//  2. lista cortada pelo teto de chamadas antes da primeira foto não é vazia;
//  3. o dono vê o evento sempre.
import { describe, it, expect } from 'vitest';
import { capVazio, RESUMO_VAZIO_MS, registraResumo, lerResumo, limpaCacheCapitulos } from '../src/drive.js';
import { galeriaIndiceHTML } from '../src/ui/galeria-indice.js';

const AGORA = Date.parse('2026-11-08T20:00:00Z');
const caps = { caps: [{ id: 'CAP_CHEIO_0001', slug: 'cheio', nome: 'Cheio' }, { id: 'CAP_VAZIO_0001', slug: 'vazio', nome: 'Vazio' }] };
const cheio = { n: 3, capas: ['FOTO_A_0000001'] };
const html = (/** @type {any} */ vazio, dono = false) => galeriaIndiceHTML({
  event: { slug: 'teste-album', title: 'Teste', accessType: 'public' }, caps: /** @type {any} */ (caps),
  resumo: { CAP_CHEIO_0001: cheio, CAP_VAZIO_0001: vazio }, ocultas: [], dono, indexavel: false,
});

describe('evento lido vazio', () => {
  it('fica escondido por 6 h; depois volta (e o 0 antigo, sem data, não esconde)', () => {
    expect(capVazio({ n: 0, capas: [], z: AGORA - 60_000 }, AGORA)).toBe(true);
    expect(capVazio({ n: 0, capas: [], z: AGORA - RESUMO_VAZIO_MS }, AGORA)).toBe(false);
    expect(capVazio({ n: 0, capas: [] }, AGORA)).toBe(false);
    expect(capVazio({ n: 2, capas: [], z: AGORA }, AGORA)).toBe(false);
    expect(capVazio(undefined, AGORA)).toBe(false);
  });

  it('no índice: o visitante não vê o vazio recente, vê o antigo; o dono vê sempre', () => {
    const recente = { n: 0, capas: [], z: Date.now() };
    expect(html(recente)).not.toContain('/galeria/teste-album/vazio');
    expect(html(recente, true)).toContain('/galeria/teste-album/vazio');
    expect(html({ n: 0, capas: [] })).toContain('/galeria/teste-album/vazio');
  });

  it('lista cortada antes da primeira foto não marca vazio', async () => {
    limpaCacheCapitulos();
    const base = { v: 3, pasta: 'X', em: '', secoes: [], total: 0, videos: 0, outros: 0, rk: {}, aut: [], ch: 1 };
    await registraResumo('RAIZ_VAZIO_001', 'CAP_CORTADO_01', /** @type {any} */ ({ ...base, truncada: true }));
    await registraResumo('RAIZ_VAZIO_001', 'CAP_VAZIO_0001', /** @type {any} */ ({ ...base, truncada: false }));
    const r = await lerResumo('RAIZ_VAZIO_001');
    expect(capVazio(r.CAP_CORTADO_01)).toBe(false);
    expect(capVazio(r.CAP_VAZIO_0001)).toBe(true);
  });
});
