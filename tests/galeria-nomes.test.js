// Nomes amigáveis nos downloads (v3.1): só o NOME do arquivo muda, calculado no
// servidor; desligado, o nome exato do Drive; bytes sempre intactos.

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import worker from '../src/index.js';
import { limpaCacheDrive, listaPasta } from '../src/drive.js';
import { saveEvents } from '../src/utils.js';
import { nomesDaListagem, nomeAmigavel, limpaParte, extDe, horaLegivel } from '../src/nomes.js';
import { withDurableObjects } from './helpers/do.js';

const SITE = 'https://fotos.lucafchala.com';
const RAIZ = 'RAIZ_PASTA_0001';
const SUB = 'SUB_PASTA_00001';
const MAG = 'PASTA_MAG_00001';
const IG = 'IG_PASTA_000001';

const img = (id, name, time, w = 3000) => ({
  id, name, mimeType: 'image/jpeg', size: '1000',
  imageMediaMetadata: { width: w, height: 2000, ...(time ? { time } : {}) },
});
const ARVORE = {
  [RAIZ]: [[
    img('FOTO_A_0000001', 'IMG_0001.JPEG', '2026:03:14 10:22:33'),
    img('FOTO_B_0000001', 'IMG_0002.HEIC'),
    img('FOTO_C_0000001', 'IMG_0003.jpg', '2026:03:14 10:22:33'), // mesma hora, mesmo autor, mesma extensão que a A (jpeg->jpg): colisão
    { id: SUB, name: 'Festa: "noite"/dia', mimeType: 'application/vnd.google-apps.folder' },
    { id: MAG, name: 'mag', mimeType: 'application/vnd.google-apps.folder' },
  ]],
  [SUB]: [[img('FOTO_D_0000001', 'd.png')]],
  [MAG]: [[img('FOTO_E_0000001', 'e.jpg', '2026:03:14 10:22:33')]],
  [IG]: [[{ id: 'IG_A_000000001', name: 'IMG_0001-insta.PNG', mimeType: 'image/png', size: '500' }]],
};

function fakeKV() {
  const store = new Map();
  return {
    async get(k) { return store.has(k) ? store.get(k) : null; },
    async put(k, v) { store.set(k, v); },
    async delete(k) { store.delete(k); },
    async list() { return { keys: [], list_complete: true, cursor: null }; },
  };
}

let env;
const evento = extra => ({
  id: '1', slug: 'formatura', title: 'Formatura 2026', accessType: 'public',
  galeriaCreditos: 'mag = Mag',
  driveUrl: `https://drive.google.com/drive/folders/${RAIZ}`,
  driveUrlInstagram: `https://drive.google.com/drive/folders/${IG}`,
  ...extra,
});
beforeEach(async () => {
  limpaCacheDrive();
  vi.stubGlobal('fetch', vi.fn(async input => {
    const url = new URL(typeof input === 'string' ? input : input.url);
    if (url.pathname === '/drive/v3/files') {
      const id = (url.searchParams.get('q') || '').match(/^'([^']+)' in parents/)?.[1];
      return Response.json({ files: ARVORE[id][0] });
    }
    if (url.pathname.startsWith('/drive/v3/files/')) {
      return new Response('BYTES-' + url.pathname.split('/').pop(), { headers: { 'Content-Type': 'image/jpeg' } });
    }
    return new Response('x', { status: 599 });
  }));
  env = withDurableObjects({ FOTOS: fakeKV(), GOOGLE_DRIVE_API_KEY: 'AIzaChaveDeTeste' });
  await saveEvents(env, [evento({ nomesAmigaveis: true })]);
});
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });

const baixa = (id, v = 'max') => worker.fetch(new Request(`${SITE}/galeria/formatura/baixar/${id}?v=${v}`, { headers: { 'CF-Connecting-IP': '203.0.113.9' } }), env, { waitUntil() {} });
const nomeDe = res => decodeURIComponent(res.headers.get('X-Nome-Arquivo'));

describe('nomes.js — as peças', () => {
  it('limpaParte tira proibidos e controle, pontas e espaços repetidos', () => {
    expect(limpaParte('  a/b\\c:d*e?f"g<h>i|j\u0001k  ')).toBe('a b c d e f g h i j k');
    expect(limpaParte('..oculto. ')).toBe('oculto');
    expect(limpaParte(null)).toBe('');
    expect(limpaParte('x'.repeat(100), 10)).toBe('x'.repeat(10));
  });
  it('extDe: minúscula, jpeg vira jpg, sem extensão fica vazio', () => {
    expect(extDe('A.JPEG')).toBe('jpg');
    expect(extDe('a.HEIC')).toBe('heic');
    expect(extDe('sem')).toBe('');
    expect(extDe('a.tar.gz')).toBe('gz');
  });
  it('horaLegivel', () => { expect(horaLegivel(20260314102233)).toBe('2026-03-14 10h22m33'); });
});

describe('download com nomes amigáveis', () => {
  it('com data: título - seção - autor - data.ext; bytes intactos', async () => {
    const r = await baixa('FOTO_A_0000001');
    expect(r.status).toBe(200);
    expect(nomeDe(r)).toBe('Formatura 2026 - Luca F. Chala - 2026-03-14 10h22m33.jpg');
    expect(await r.text()).toBe('BYTES-FOTO_A_0000001');
    const cd = r.headers.get('Content-Disposition');
    expect(cd).toContain('filename="Formatura 2026 - Luca F. Chala - 2026-03-14 10h22m33.jpg"');
    expect(cd).toContain("filename*=UTF-8''Formatura%202026%20-%20Luca%20F.%20Chala%20-%202026-03-14%2010h22m33.jpg");
  });

  it('colisão ganha -2 pela ordem da listagem; sem data entra o número da foto (3 dígitos)', async () => {
    // A e C têm a mesma hora, autor e extensão (jpeg e jpg → jpg)
    expect(nomeDe(await baixa('FOTO_C_0000001'))).toBe('Formatura 2026 - Luca F. Chala - 2026-03-14 10h22m33-2.jpg');
    // B: sem data; a seção raiz ordena as com data primeiro (A, C, E) e B vem depois: 4ª
    expect(nomeDe(await baixa('FOTO_B_0000001'))).toBe('Formatura 2026 - Luca F. Chala - 004.heic');
  });

  it('seção entra no nome (proibidos viram espaço); autor da pasta de autor; seção com um nome só', async () => {
    expect(nomeDe(await baixa('FOTO_D_0000001'))).toBe('Formatura 2026 - Festa noite dia - Luca F. Chala - 001.png');
    expect(nomeDe(await baixa('FOTO_E_0000001'))).toBe('Formatura 2026 - Mag - 2026-03-14 10h22m33.jpg');
  });

  it('"para redes" usa a extensão do arquivo do Instagram', async () => {
    const r = await baixa('FOTO_A_0000001', 'redes');
    expect(nomeDe(r)).toBe('Formatura 2026 - Luca F. Chala - 2026-03-14 10h22m33.png');
    expect(await r.text()).toBe('BYTES-IG_A_000000001');
  });

  it('desligado: o nome exato do Drive, como sempre', async () => {
    await saveEvents(env, [evento({ nomesAmigaveis: false })]);
    limpaCacheDrive();
    const r = await baixa('FOTO_A_0000001');
    expect(nomeDe(r)).toBe('IMG_0001.JPEG');
    expect(r.headers.get('Content-Disposition')).toContain('filename="IMG_0001.JPEG"');
  });

  it('o nome não vem do cliente: parâmetros extras são ignorados', async () => {
    const r = await worker.fetch(new Request(`${SITE}/galeria/formatura/baixar/FOTO_A_0000001?v=max&nome=hack.exe&n=../../x`), env, { waitUntil() {} });
    expect(nomeDe(r)).not.toMatch(/hack|\.\./);
  });

  it('título longo é cortado no prefixo; nenhum nome passa de 150 caracteres', async () => {
    await saveEvents(env, [evento({ nomesAmigaveis: true, title: 'T'.repeat(200), galeriaCreditos: 'mag = ' + 'M'.repeat(80) })]);
    limpaCacheDrive();
    const r = await baixa('FOTO_E_0000001');
    expect(nomeDe(r).length).toBeLessThanOrEqual(150);
  });

  it('a numeração não muda quando o dono oculta outra foto', async () => {
    const antes = nomeDe(await baixa('FOTO_B_0000001'));
    await saveEvents(env, [evento({ nomesAmigaveis: true, fotosOcultas: ['FOTO_A_0000001'] })]);
    limpaCacheDrive();
    expect(nomeDe(await baixa('FOTO_B_0000001'))).toBe(antes);
  });
});

describe('nomesDaListagem — a mesma conta da página', () => {
  it('prefixo por seção, cauda por foto; partes vazias somem sem separador dobrado', async () => {
    const l = await listaPasta(env, { id: RAIZ, resourceKey: '' }, { creditos: 'mag = Mag' });
    const sem = nomesDaListagem(l, { titulo: '', capitulo: '' });
    expect(sem.pre[0]).toBe('');
    expect(sem.cauda.FOTO_A_0000001).toBe('Luca F. Chala - 2026-03-14 10h22m33');
    const com = nomesDaListagem(l, { titulo: 'Evento', capitulo: '2026 Formatura' });
    expect(com.pre[0]).toBe('Evento - 2026 Formatura');
    expect(nomeAmigavel(l, { titulo: 'Evento', capitulo: '2026 Formatura' }, 'FOTO_A_0000001', 'x.JPG'))
      .toBe('Evento - 2026 Formatura - Luca F. Chala - 2026-03-14 10h22m33.jpg');
    expect(nomeAmigavel(l, {}, 'NAO_EXISTE_000', 'x.jpg')).toBeNull();
  });
});

describe('a página leva o necessário para o mesmo nome', () => {
  it('amigavel (prefixo por seção) e cauda por foto só com a opção ligada', async () => {
    const pega = async () => {
      const html = await (await worker.fetch(new Request(`${SITE}/galeria/formatura`), env, { waitUntil() {} })).text();
      return JSON.parse(html.match(/<script type="application\/json" id="g-dados"[^>]*>([\s\S]*?)<\/script>/)[1]);
    };
    const d = await pega();
    expect(d.amigavel).toEqual(expect.any(Array));
    const a = d.secoes[0].fotos.find(f => f[0] === 'FOTO_A_0000001');
    expect(a[8]).toBe(' - Luca F. Chala - 2026-03-14 10h22m33'); // com prefixo (título), a cauda traz o " - " de ligação
    await saveEvents(env, [evento({ nomesAmigaveis: false })]);
    limpaCacheDrive();
    const off = await pega();
    expect(off.amigavel).toBeNull();
    const aOff = off.secoes[0].fotos.find(f => f[0] === 'FOTO_A_0000001');
    expect(aOff[8]).toBeUndefined(); // sem a cauda amigável (slot 8)
    expect(JSON.stringify(off)).not.toContain('Luca F. Chala - 2026');
  });
});
