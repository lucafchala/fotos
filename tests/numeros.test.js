// "Turma em números" (v3.9.1, src/ui/numeros.js). O que estes testes prendem:
//  1. as contas: fotos, eventos, anos (com a data do dono por cima), o maior
//     evento e quem mais fotografou; evento sem foto ou sem resumo não entra;
//  2. a página: números formatados, barras por ano, links dos eventos no
//     domínio do álbum, script com nonce, nada sem escape;
//  3. o portão: antes do lançamento, 404 para o público; "numeros" é reservado.
import { describe, it, expect } from 'vitest';
import worker from '../src/index.js';
import { saveEvents, validateSlug } from '../src/utils.js';
import { numerosDoAlbum, numerosHTML } from '../src/ui/numeros.js';
import { comDatasDoDono } from '../src/ui/album.js';
import { withDurableObjects } from './helpers/do.js';

const caps = [
  { id: 'A', slug: 'amarelinhos', nome: 'Amarelinhos' },
  { id: 'B', slug: 'gala', nome: '<Gala>' },
  { id: 'C', slug: 'vazio', nome: 'Vazio' },
  { id: 'D', slug: 'sem-resumo', nome: 'Sem resumo' },
];
const resumo = {
  A: { n: 1200, capas: [], pm: 202303, a: { 'Luca F. Chala': 1000, Mag: 200 } },
  B: { n: 300, capas: [], pm: 202611, a: { Mag: 300 } },
  C: { n: 0, capas: [] },
};

describe('numerosDoAlbum', () => {
  it('soma fotos, conta eventos, agrupa por ano e ranqueia', () => {
    const n = numerosDoAlbum(caps, resumo);
    expect(n.fotos).toBe(1500);
    expect(n.eventos).toBe(2);
    expect(n.anos).toEqual([['2023', 1200], ['2026', 300]]);
    expect(n.maiores.map(e => e.slug)).toEqual(['amarelinhos', 'gala']);
    expect(n.autores).toEqual([['Luca F. Chala', 1000], ['Mag', 500]]);
    expect(n.fotografos).toBe(2);
  });
  it('a data escolhida pelo dono vale no "por ano"', () => {
    const n = numerosDoAlbum(caps, comDatasDoDono(resumo, caps, { gala: '2024' }));
    expect(n.anos).toEqual([['2023', 1200], ['2024', 300]]);
  });
});

describe('numerosHTML', () => {
  it('números em pt-BR, links do evento, escape e nonce', () => {
    const h = numerosHTML({ event: { slug: 'x', title: 'Turma <26>' }, numeros: numerosDoAlbum(caps, resumo), base: '', nonce: 'N' });
    expect(h).toContain('<b>1.500</b><span>fotos</span>');
    expect(h).toContain('<b>2</b><span>anos (2023 a 2026)</span>');
    expect(h).toContain('href="/amarelinhos"');
    expect(h).toContain('&lt;Gala&gt;');
    expect(h).not.toContain('<Gala>');
    expect(h).toContain('Turma &lt;26&gt;');
    for (const s of h.match(/<script[^>]*>/gi) || []) expect(s).toContain('nonce="N"');
    expect(h).not.toContain('innerHTML');
  });
  it('álbum sem fotos ainda: sem seções vazias', () => {
    const h = numerosHTML({ event: { slug: 'x' }, numeros: numerosDoAlbum(caps, {}), base: '', nonce: 'N' });
    expect(h).toContain('Os números aparecem quando os eventos tiverem fotos.');
    expect(h).not.toContain('class="nu-barras"');
  });
});

describe('a rota', () => {
  const kv = (/** @type {any[]} */ ev) => { const m = new Map([['events', JSON.stringify(ev)]]); return { async get(/** @type {string} */ k) { return m.get(k) ?? null; }, async put(/** @type {string} */ k, /** @type {string} */ v) { m.set(k, v); }, async delete() {}, async list() { return { keys: [], list_complete: true }; } }; };
  const pede = async (/** @type {string} */ u, /** @type {any[]} */ ev) => { const env = withDurableObjects({ FOTOS: kv(ev) }); await saveEvents(env, structuredClone(ev)); return worker.fetch(new Request(u), env, { waitUntil() {} }); };
  it('antes do lançamento, 404 para o público; sem pasta de eventos, 404', async () => {
    expect((await pede('https://entrenos2026.com/numeros', [{ id: '1', slug: 'entrenos2026', title: 'Entre Nós', accessType: 'public', comingSoon: true, visible: false }])).status).toBe(404);
    expect((await pede('https://entrenos2026.com/numeros', [{ id: '1', slug: 'entrenos2026', title: 'Entre Nós', accessType: 'public' }])).status).toBe(404);
  });
  it('"numeros" é nome reservado', () => {
    expect(validateSlug('numeros')).toBe(false);
  });
});
