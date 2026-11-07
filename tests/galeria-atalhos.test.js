// Atalhos do Drive e o Workers Paid (v3.6). O álbum da turma usa fotos que já
// moram em outra pasta (a de outros projetos publicados): um ATALHO dentro da
// pasta do fotógrafo traz as fotos sem copiar nem mover. O que estes testes
// prendem:
//  1. atalho de pasta é transparente: mesma seção e mesmo autor de onde está;
//     as subpastas do destino viram seções como sempre;
//  2. atalho de arquivo não entra; destino sem acesso é pulado e contado (`sa`),
//     sem derrubar a galeria; ciclo e atalho repetido não leem duas vezes;
//  3. os tetos só sobem com WORKERS_PLANO = "pago" (no grátis, estourariam o
//     limite de 50 subrequisições).
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { percorre, planoPago, alvoDaGaleria, limpaCacheDrive } from '../src/drive.js';
import { GALERIA_MAX_CHAMADAS_CAP, GALERIA_MAX_CHAMADAS_CAP_PAGO, GALERIA_MAX_PASTAS } from '../src/config.js';

const FOLDER = 'application/vnd.google-apps.folder';
const SHORT = 'application/vnd.google-apps.shortcut';
const pasta = (/** @type {string} */ id, /** @type {string} */ name) => ({ id, name, mimeType: FOLDER });
const foto = (/** @type {string} */ id) => ({ id, name: `${id}.jpg`, mimeType: 'image/jpeg', size: '100', imageMediaMetadata: { width: 3000, height: 2000 } });
const atalho = (/** @type {string} */ id, /** @type {string} */ alvo, mime = FOLDER) => ({ id, name: 'Fotos do evento', mimeType: SHORT, shortcutDetails: { targetId: alvo, targetMimeType: mime } });

/** @type {Record<string, any[]>} */
let ARVORE;
/** @type {string[]} */
let lidas;
beforeEach(() => {
  limpaCacheDrive();
  lidas = [];
  ARVORE = {
    RAIZ_PASTA_0001: [pasta('CHALA_PASTA_01', 'chala'), foto('SOLTA_FOTO_001')],
    CHALA_PASTA_01: [atalho('ATALHO_0000001', 'ESCOLA_AMAREL1'), atalho('ATALHO_REPETE1', 'ESCOLA_AMAREL1'), atalho('ATALHO_ARQUIV1', 'FOTO_QUALQUER1', 'image/jpeg'), atalho('ATALHO_PRIVAD1', 'PASTA_PRIVADA1')],
    ESCOLA_AMAREL1: [foto('AMAREL_FOTO_01'), foto('AMAREL_FOTO_02'), pasta('ESCOLA_NOITE01', 'Noite'), atalho('ATALHO_CICLO01', 'RAIZ_PASTA_0001')],
    ESCOLA_NOITE01: [foto('NOITE_FOTO_001')],
  };
  vi.stubGlobal('fetch', vi.fn(async (/** @type {any} */ input) => {
    const url = new URL(typeof input === 'string' ? input : input.url);
    const id = (url.searchParams.get('q') || '').match(/^'([^']+)' in parents/)?.[1] || '';
    lidas.push(id);
    if (!ARVORE[id]) return Response.json({ error: { code: 404, message: 'File not found', errors: [{ reason: 'notFound' }] } }, { status: 404 });
    return Response.json({ files: ARVORE[id] });
  }));
});
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });

const creditos = new Map([['chala', 'Luca F. Chala'], ['*', 'Turma 2026']]);
const ids = (/** @type {any} */ s) => s.fotos.map((/** @type {any[]} */ f) => f[0]);

describe('atalhos de pasta', () => {
  it('o conteúdo entra onde o atalho está, com o autor da pasta; subpastas do destino viram seções', async () => {
    const l = await percorre('CHAVE', { id: 'RAIZ_PASTA_0001', resourceKey: '' }, 26, creditos);
    const raiz = l.secoes.find(s => s.caminho === '');
    const noite = l.secoes.find(s => s.caminho === 'Noite');
    expect(ids(raiz).sort()).toEqual(['AMAREL_FOTO_01', 'AMAREL_FOTO_02', 'SOLTA_FOTO_001']);
    expect(ids(noite)).toEqual(['NOITE_FOTO_001']);
    const autor = (/** @type {string} */ id) => l.aut[/** @type {any} */ (raiz).fotos.find((/** @type {any[]} */ f) => f[0] === id)[5] ?? 0];
    expect(autor('AMAREL_FOTO_01')).toBe('Luca F. Chala');
    expect(autor('SOLTA_FOTO_001')).toBe('Turma 2026');
  });

  it('atalho repetido e ciclo não leem duas vezes; atalho de arquivo não entra', async () => {
    const l = await percorre('CHAVE', { id: 'RAIZ_PASTA_0001', resourceKey: '' }, 26, creditos);
    expect(lidas.filter(i => i === 'ESCOLA_AMAREL1')).toHaveLength(1);
    expect(lidas.filter(i => i === 'RAIZ_PASTA_0001')).toHaveLength(1);
    expect(lidas).not.toContain('FOTO_QUALQUER1');
    expect(l.outros).toBe(1);
  });

  it('destino sem acesso: pulado e contado, o resto da galeria aparece', async () => {
    const l = await percorre('CHAVE', { id: 'RAIZ_PASTA_0001', resourceKey: '' }, 26, creditos);
    expect(l.sa).toBe(1);
    expect(l.total).toBe(4);
    expect(l.truncada).toBe(false);
  });

  it('a raiz sem acesso continua sendo erro (não é atalho)', async () => {
    await expect(percorre('CHAVE', { id: 'NAO_EXISTE_0001', resourceKey: '' }, 26, creditos)).rejects.toThrow();
  });
});

describe('Workers Paid', () => {
  it('só "pago" liga os tetos maiores', () => {
    expect(planoPago({ WORKERS_PLANO: 'pago' })).toBe(true);
    expect(planoPago({ WORKERS_PLANO: ' Pago ' })).toBe(true);
    for (const v of [undefined, '', 'gratis', 'paid', 'sim']) expect(planoPago({ WORKERS_PLANO: v })).toBe(false);
  });

  it('pasta com muitas subpastas: cortada no grátis, inteira no pago', async () => {
    const anos = Array.from({ length: 30 }, (_, i) => `ANO_PASTA_${String(i).padStart(4, '0')}`);
    ARVORE.GRANDE_PASTA_01 = anos.map((id, i) => pasta(id, `Ano ${i}`));
    for (const id of anos) ARVORE[id] = [foto(`${id}_F`)];
    const gratis = await percorre('CHAVE', { id: 'GRANDE_PASTA_01', resourceKey: '' }, 26, creditos);
    expect(gratis.truncada).toBe(true);
    expect(gratis.total).toBeLessThan(30);
    expect(GALERIA_MAX_PASTAS).toBeLessThan(31);
    const pago = await percorre('CHAVE', { id: 'GRANDE_PASTA_01', resourceKey: '' }, 150, creditos, 200);
    expect(pago.truncada).toBe(false);
    expect(pago.total).toBe(30);
  });

  it('alvoDaGaleria usa o teto do plano no capítulo', async () => {
    ARVORE.ALBUM_RAIZ_0001 = [pasta('CAPITULO_00001', 'Festa Junina')];
    const ev = { slug: 'x', galeriaCapitulos: true, driveUrl: 'https://drive.google.com/drive/folders/ALBUM_RAIZ_0001' };
    const env = { GOOGLE_DRIVE_API_KEY: 'AIzaTeste' };
    const g = await alvoDaGaleria(/** @type {any} */ (env), /** @type {any} */ (ev), 'festa-junina');
    expect(g).toMatchObject({ kind: 'ok', maxChamadas: GALERIA_MAX_CHAMADAS_CAP });
    limpaCacheDrive();
    const p = await alvoDaGaleria(/** @type {any} */ ({ ...env, WORKERS_PLANO: 'pago' }), /** @type {any} */ (ev), 'festa-junina');
    expect(p).toMatchObject({ kind: 'ok', maxChamadas: GALERIA_MAX_CHAMADAS_CAP_PAGO });
  });
});
