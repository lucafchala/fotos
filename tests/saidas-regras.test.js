// As regras do registro de quem saiu da busca pelo rosto (src/saidas.js),
// uma por uma. tests/rosto-saida.test.js cobre o caminho inteiro (a rota, a
// Rekognition, o painel); aqui ficam os casos de borda que lá passavam sem
// ninguém ver: na revisão de 16/11/2026, 10 de 24 mudanças de operador neste
// arquivo não quebravam nenhum teste (relatório, achado C1).
//
// O que cada bloco prende:
//  - registraSaida: id que não é FaceId não grava; repetir o pedido soma os
//    rostos e mantém a PRIMEIRA data; anotação anterior estragada não vale;
//  - listaSaidas: só o álbum pedido, só ids válidos, contagens certas, da mais
//    nova para a mais velha, e todas as páginas da lista do KV;
//  - desfazUmaSaida: id inválido nunca vira "apague este rosto" na AWS, mesmo
//    que alguém tenha gravado a chave à mão;
//  - o fim do índice: marca sem data não vira NaN, e o cron só apaga o índice
//    de um álbum DEPOIS do prazo (busca desligada: o dono tem horas para
//    religar sem perder o índice).
import { describe, it, expect } from 'vitest';
import { registraSaida, listaSaidas, desfazUmaSaida, geracaoDoIndice, marcaIndiceParaApagar, indiceSeraApagadoEm, apagaIndicesVencidos } from '../src/saidas.js';
import { ROSTO_APAGA_APOS_DESLIGAR_H } from '../src/config.js';

const SLUG = 'album';
const CRED = { chave: 'AKIDEXAMPLE', segredo: 'segredo', regiao: 'sa-east-1' };
// FaceIds de mentira, no formato que a Rekognition devolve.
const ID = (/** @type {number} */ n) => `0000000${n}-aaaa-4bbb-8ccc-${String(n).padStart(12, '0')}`;
const chave = (/** @type {string} */ id, slug = SLUG) => `rosto-saiu:${slug}:${id}`;

/**
 * KV de mentira com metadados e lista por prefixo, que devolve no máximo
 * `porPagina` chaves por chamada (o KV de verdade pagina em 1.000).
 */
function kv(porPagina = 1000) {
  /** @type {Map<string, { v: string, m?: any }>} */
  const m = new Map();
  return {
    m,
    async get(/** @type {string} */ k) { return m.has(k) ? /** @type {any} */ (m.get(k)).v : null; },
    async getWithMetadata(/** @type {string} */ k) { const x = m.get(k); return { value: x ? x.v : null, metadata: x ? x.m ?? null : null }; },
    async put(/** @type {string} */ k, /** @type {string} */ v, /** @type {any} */ o = {}) { m.set(k, { v, m: o.metadata }); },
    async delete(/** @type {string} */ k) { m.delete(k); },
    async list(/** @type {{ prefix?: string, cursor?: string }} */ o = {}) {
      const todas = [...m.keys()].filter(k => k.startsWith(o.prefix || '')).sort();
      const de = Number(o.cursor || 0);
      const keys = todas.slice(de, de + porPagina).map(name => ({ name, metadata: /** @type {any} */ (m.get(name)).m }));
      const fim = de + porPagina >= todas.length;
      return { keys, list_complete: fim, cursor: fim ? undefined : String(de + porPagina) };
    },
  };
}

/** fetch de mentira para a Rekognition: anota cada chamada e responde 200. */
function aws() {
  /** @type {string[]} */
  const chamadas = [];
  const fetch = /** @type {any} */ (async (/** @type {any} */ _url, /** @type {any} */ init) => {
    chamadas.push(String(init && init.headers && (init.headers['X-Amz-Target'] || init.headers['x-amz-target']) || '?'));
    return new Response('{}', { status: 200, headers: { 'Content-Type': 'application/x-amz-json-1.1' } });
  });
  return { chamadas, fetch };
}

describe('registraSaida', () => {
  it('ignora um id que não é FaceId: nada é gravado', async () => {
    const FOTOS = kv();
    await registraSaida({ FOTOS }, SLUG, 'nao-e-um-face-id', 3, 1000);
    await registraSaida({ FOTOS }, SLUG, ID(1).toUpperCase(), 3, 1000);
    expect(FOTOS.m.size).toBe(0);
  });

  it('a primeira saída grava a data e quantos rostos foram apagados', async () => {
    const FOTOS = kv();
    await registraSaida({ FOTOS }, SLUG, ID(1), 4, 1000);
    expect(FOTOS.m.get(chave(ID(1)))).toEqual({ v: '1', m: { t: 1000, n: 4 } });
  });

  it('repetir o pedido soma os rostos e mantém a primeira data', async () => {
    const FOTOS = kv();
    await registraSaida({ FOTOS }, SLUG, ID(1), 4, 1000);
    await registraSaida({ FOTOS }, SLUG, ID(1), 2, 5000);
    await registraSaida({ FOTOS }, SLUG, ID(1), 0, 9000);
    expect(FOTOS.m.get(chave(ID(1)))?.m).toEqual({ t: 1000, n: 6 });
  });

  it('uma anotação anterior sem data não vale: fica a data de agora e só os rostos de agora', async () => {
    const FOTOS = kv();
    await FOTOS.put(chave(ID(1)), '1', { metadata: { n: 50 } });
    await registraSaida({ FOTOS }, SLUG, ID(1), 2, 7000);
    expect(FOTOS.m.get(chave(ID(1)))?.m).toEqual({ t: 7000, n: 2 });
  });

  it('a contagem anterior que não é número conta como zero', async () => {
    const FOTOS = kv();
    await FOTOS.put(chave(ID(1)), '1', { metadata: { t: 1000, n: 'muitos' } });
    await registraSaida({ FOTOS }, SLUG, ID(1), 3, 7000);
    expect(FOTOS.m.get(chave(ID(1)))?.m).toEqual({ t: 1000, n: 3 });
  });

  it('se a leitura da anotação anterior falha, grava a de agora', async () => {
    const FOTOS = kv();
    FOTOS.getWithMetadata = async () => { throw new Error('KV fora do ar'); };
    await registraSaida({ FOTOS }, SLUG, ID(1), 2.9, 7000);
    expect(FOTOS.m.get(chave(ID(1)))?.m).toEqual({ t: 7000, n: 2 });
  });

  it('rostos apagados negativos ou inválidos contam como zero', async () => {
    const FOTOS = kv();
    await registraSaida({ FOTOS }, SLUG, ID(1), -5, 1000);
    await registraSaida({ FOTOS }, SLUG, ID(2), Number.NaN, 1000);
    expect(FOTOS.m.get(chave(ID(1)))?.m.n).toBe(0);
    expect(FOTOS.m.get(chave(ID(2)))?.m.n).toBe(0);
  });
});

describe('listaSaidas', () => {
  it('lista só o álbum pedido, só ids válidos, da mais nova para a mais velha', async () => {
    const FOTOS = kv();
    await registraSaida({ FOTOS }, SLUG, ID(1), 4, 1000);
    await registraSaida({ FOTOS }, SLUG, ID(2), 1, 3000);
    await registraSaida({ FOTOS }, SLUG, ID(3), 7, 2000);
    await registraSaida({ FOTOS }, 'album2', ID(4), 9, 9000); // outro álbum, prefixo parecido
    await FOTOS.put(chave('lixo'), '1', { metadata: { t: 8000, n: 1 } }); // gravada à mão
    expect(await listaSaidas({ FOTOS }, SLUG)).toEqual([
      { id: ID(2), em: 3000, removidas: 1 },
      { id: ID(3), em: 2000, removidas: 7 },
      { id: ID(1), em: 1000, removidas: 4 },
    ]);
  });

  it('anotação sem metadados aparece com data e contagem zero', async () => {
    const FOTOS = kv();
    await FOTOS.put(chave(ID(1)), '1');
    expect(await listaSaidas({ FOTOS }, SLUG)).toEqual([{ id: ID(1), em: 0, removidas: 0 }]);
  });

  it('lê todas as páginas da lista do KV', async () => {
    const FOTOS = kv(2);
    for (let i = 1; i <= 5; i++) await registraSaida({ FOTOS }, SLUG, ID(i), i, i * 1000);
    const lista = await listaSaidas({ FOTOS }, SLUG);
    expect(lista.map(s => s.removidas)).toEqual([5, 4, 3, 2, 1]);
  });
});

describe('desfazUmaSaida', () => {
  it('desfaz uma saída da lista: tira a marca na AWS, sobe a geração do índice e apaga a anotação', async () => {
    const FOTOS = kv();
    const a = aws();
    await registraSaida({ FOTOS }, SLUG, ID(1), 4, 1000);
    expect(await desfazUmaSaida({ FOTOS }, CRED, SLUG, ID(1), { fetch: a.fetch })).toBe(true);
    expect(a.chamadas).toEqual(['RekognitionService.DeleteFaces']);
    expect(await geracaoDoIndice({ FOTOS }, SLUG)).toBe(1);
    expect(FOTOS.m.has(chave(ID(1)))).toBe(false);
  });

  it('um id que não está na lista deste álbum não chega à AWS', async () => {
    const FOTOS = kv();
    const a = aws();
    await registraSaida({ FOTOS }, 'album2', ID(1), 4, 1000);
    expect(await desfazUmaSaida({ FOTOS }, CRED, SLUG, ID(1), { fetch: a.fetch })).toBe(false);
    expect(a.chamadas).toEqual([]);
    expect(await geracaoDoIndice({ FOTOS }, SLUG)).toBe(0);
  });

  it('um id inválido é recusado mesmo que a chave exista: nada muda', async () => {
    const FOTOS = kv();
    const a = aws();
    await FOTOS.put(chave('lixo'), '1', { metadata: { t: 1000, n: 1 } });
    expect(await desfazUmaSaida({ FOTOS }, CRED, SLUG, 'lixo', { fetch: a.fetch })).toBe(false);
    expect(a.chamadas).toEqual([]);
    expect(await geracaoDoIndice({ FOTOS }, SLUG)).toBe(0);
    expect(FOTOS.m.has(chave('lixo'))).toBe(true);
  });
});

describe('o fim do índice de um álbum', () => {
  const H = 3600_000;

  it('indiceSeraApagadoEm: sem marca, marca sem data ou estragada dá 0; com data, a data', async () => {
    const FOTOS = kv();
    expect(await indiceSeraApagadoEm({ FOTOS }, SLUG)).toBe(0);
    await FOTOS.put(`rosto-apagar:${SLUG}`, JSON.stringify({ motivo: 'desligado' }));
    expect(await indiceSeraApagadoEm({ FOTOS }, SLUG)).toBe(0);
    await FOTOS.put(`rosto-apagar:${SLUG}`, '{estragado');
    expect(await indiceSeraApagadoEm({ FOTOS }, SLUG)).toBe(0);
    await marcaIndiceParaApagar({ FOTOS }, SLUG, 'desligado', 1000);
    expect(await indiceSeraApagadoEm({ FOTOS }, SLUG)).toBe(1000 + ROSTO_APAGA_APOS_DESLIGAR_H * H);
  });

  it('o cron não apaga antes do prazo, apaga depois, e sem as chaves da AWS só conta', async () => {
    const FOTOS = kv();
    const a = aws();
    await marcaIndiceParaApagar({ FOTOS }, SLUG, 'desligado', 0);
    await registraSaida({ FOTOS }, SLUG, ID(1), 4, 0);
    const prazo = ROSTO_APAGA_APOS_DESLIGAR_H * H;

    expect(await apagaIndicesVencidos({ FOTOS }, CRED, prazo - 1, { fetch: a.fetch })).toEqual({ apagados: 0, falhas: 0, semChave: 0 });
    expect(a.chamadas).toEqual([]);
    expect(FOTOS.m.has(chave(ID(1)))).toBe(true);

    expect(await apagaIndicesVencidos({ FOTOS }, null, prazo, { fetch: a.fetch })).toEqual({ apagados: 0, falhas: 0, semChave: 1 });
    expect(a.chamadas).toEqual([]);

    expect(await apagaIndicesVencidos({ FOTOS }, CRED, prazo, { fetch: a.fetch })).toEqual({ apagados: 1, falhas: 0, semChave: 0 });
    expect(a.chamadas).toEqual(['RekognitionService.DeleteCollection', 'RekognitionService.DeleteCollection']);
    expect(FOTOS.m.has(chave(ID(1)))).toBe(false);
    expect(await indiceSeraApagadoEm({ FOTOS }, SLUG)).toBe(0);
  });

  it('o cron pula sem erro uma marca vazia (não conta como falha)', async () => {
    const FOTOS = kv();
    const a = aws();
    await FOTOS.put(`rosto-apagar:${SLUG}`, 'null');
    expect(await apagaIndicesVencidos({ FOTOS }, CRED, Date.now(), { fetch: a.fetch })).toEqual({ apagados: 0, falhas: 0, semChave: 0 });
    expect(a.chamadas).toEqual([]);
  });

  it('o prazo vale ao milissegundo: um antes não apaga, no prazo apaga', async () => {
    // Projeto excluído: o prazo é o próprio instante da marca.
    const FOTOS = kv();
    const a = aws();
    await marcaIndiceParaApagar({ FOTOS }, SLUG, 'excluido', 5000);
    expect(await apagaIndicesVencidos({ FOTOS }, CRED, 4999, { fetch: a.fetch })).toEqual({ apagados: 0, falhas: 0, semChave: 0 });
    expect(await apagaIndicesVencidos({ FOTOS }, CRED, 5000, { fetch: a.fetch })).toEqual({ apagados: 1, falhas: 0, semChave: 0 });
  });
});
