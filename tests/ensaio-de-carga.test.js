// O script do ensaio de carga (docs/ENSAIO-DE-CARGA.md) não roda no npm test —
// precisa do k6 e de uma prévia —, mas a parte que lê o HTML do site sim. A
// primeira versão do plano lia os endereços /f/ do texto e achava UMA foto (só
// o preload tem endereço pronto); o ensaio teria medido outra coisa sem
// ninguém ver. Este teste tira as funções de extração do próprio documento e
// as roda contra o HTML que o código gera hoje.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { galeriaHTML } from '../src/ui/galeria.js';
import { galeriaIndiceHTML } from '../src/ui/galeria-indice.js';

const doc = readFileSync(new URL('../docs/ENSAIO-DE-CARGA.md', import.meta.url), 'utf8');
const js = doc.slice(doc.indexOf('```js\n') + 6, doc.indexOf('```\n', doc.indexOf('```js\n') + 6));
const ext = js.slice(js.indexOf('// --- extração'), js.indexOf('// --- fim da extração'));
const { eventosDoAlbum, fotosDoEvento } = new Function(`${ext}; return { eventosDoAlbum, fotosDoEvento };`)();

const EVENTO = /** @type {any} */ ({ id: '1', slug: 'formatura', title: 'Formatura', accessType: 'public', galeriaCapitulos: true, driveUrl: 'https://drive.google.com/drive/folders/RAIZ_PASTA_0001' });

describe('o script do ensaio de carga', () => {
  it('usa um executor que existe no k6 e chega a 1.000 pessoas', () => {
    const ex = js.match(/executor: '([a-z-]+)'/);
    expect(ex && ex[1]).toBe('constant-arrival-rate');
    const rate = Number((js.match(/rate: (\d+)/) || [])[1]);
    const dur = Number((js.match(/duration: '(\d+)s'/) || [])[1]);
    expect(rate * dur).toBeGreaterThanOrEqual(1000);
  });

  it('acha os eventos do álbum pelos cartões, e não /numeros nem /ajuda', () => {
    const caps = { v: 1, pasta: 'RAIZ_PASTA_0001', em: '2026-11-06T12:00:00.000Z', truncada: false, caps: [
      { id: 'CAP1_PASTA_001', rk: '', bruto: 'Festa', nome: 'Festa', slug: 'festa' },
      { id: 'CAP2_PASTA_002', rk: '', bruto: 'Colação', nome: 'Colação', slug: 'colacao' },
    ] };
    for (const abertura of ['', 'Oi.']) {
      const h = galeriaIndiceHTML({ event: { ...EVENTO, galeriaAbertura: abertura }, caps: /** @type {any} */ (caps), resumo: {}, ocultas: [], dono: false, indexavel: true, nonce: 'N' });
      expect(eventosDoAlbum(h).sort()).toEqual(['colacao', 'festa']);
    }
  });

  it('acha TODAS as fotos do evento, cada uma com a assinatura dela', () => {
    const fotos = Array.from({ length: 40 }, (_, i) => [`FOTO_${String(i).padStart(10, 'A')}`, 6000, 4000, `${i}.jpg`, 100]);
    const assina = (/** @type {string} */ id) => `formatura.${id.slice(-8)}`;
    const h = galeriaHTML({ event: EVENTO, nonce: 'N', erro: null, assina,
      listagem: /** @type {any} */ ({ v: 3, pasta: 'P', em: '2026-11-06T12:00:00.000Z', truncada: false, total: 40, videos: 0, outros: 0, rk: {}, aut: ['Luca'], secoes: [{ nome: '', caminho: '', fotos }] }) });
    const achadas = fotosDoEvento(h);
    expect(achadas).toHaveLength(40);
    for (const f of achadas) expect(f.k).toBe(assina(f.id));
  });
});
