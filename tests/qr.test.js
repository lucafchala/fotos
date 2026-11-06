// QR code do projeto (v3.1, #251). O que estes testes prendem:
//  1. o gerador (src/qr.js): o que ele desenha é lido de volta, byte a byte, por
//     uma biblioteca leitora de verdade (jsqr, só devDependency) — de 1 a 213
//     bytes (todas as versões 1 a 10, nível M) e com texto não ASCII; texto
//     grande demais é recusado;
//  2. a API (/api/qr): só o dono; o link certo (galeria, índice, capítulo,
//     página do projeto), a matriz decodifica para esse mesmo link e o título
//     sai com o nome do capítulo;
//  3. o painel: o menu do projeto tem "QR code da galeria…" e o script do
//     navegador traz o desenho do PNG e do SVG.

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import jsQR from 'jsqr';
import worker from '../src/index.js';
import { qrMatriz, qrLinhas, QR_VERSAO_MAX } from '../src/qr.js';
import { limpaCacheDrive } from '../src/drive.js';
import { saveEvents } from '../src/utils.js';
import { dashboardHTML, cardProjetoPainel, ICONES } from '../src/ui/dashboard.js';
import { withDurableObjects } from './helpers/do.js';

/** Rasteriza a matriz (margem de 4 módulos) e lê com o jsqr. */
function leitura(linhas, escala = 6) {
  const n = linhas.length;
  const q = 4;
  const L = (n + 2 * q) * escala;
  const px = new Uint8ClampedArray(L * L * 4).fill(255);
  for (let y = 0; y < n; y++) {
    for (let x = 0; x < n; x++) {
      if (linhas[y][x] !== '1') continue;
      for (let dy = 0; dy < escala; dy++) {
        for (let dx = 0; dx < escala; dx++) {
          const i = (((y + q) * escala + dy) * L + (x + q) * escala + dx) * 4;
          px[i] = px[i + 1] = px[i + 2] = 0;
        }
      }
    }
  }
  const r = jsQR(px, L, L);
  return r ? r.data : null;
}

describe('src/qr.js', () => {
  it('decodifica de volta o mesmo texto em todas as versões (1 a 10), incluindo as fronteiras de capacidade', () => {
    const versoes = new Set();
    for (const len of [1, 5, 14, 15, 26, 27, 42, 43, 62, 63, 84, 85, 106, 107, 122, 123, 152, 153, 180, 181, 213]) {
      const texto = 'https://fotos.lucafchala.com/galeria/'.padEnd(len, 'x').slice(0, len);
      const { versao, n } = qrMatriz(texto);
      expect(n).toBe(17 + 4 * versao);
      versoes.add(versao);
      expect(leitura(qrLinhas(texto).linhas)).toBe(texto);
    }
    expect([...versoes].sort((a, b) => a - b)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
  });

  it('usa a menor versão que cabe', () => {
    expect(qrMatriz('x'.repeat(14)).versao).toBe(1);
    expect(qrMatriz('x'.repeat(15)).versao).toBe(2);
    expect(qrMatriz('x'.repeat(213)).versao).toBe(10);
  });

  it('texto com acentos e emoji (UTF-8) decodifica igual', () => {
    const texto = 'https://fotos.lucafchala.com/galeria/formatura/cerimônia-ação';
    expect(leitura(qrLinhas(texto).linhas)).toBe(texto);
  });

  it('recusa o que não cabe na versão 10', () => {
    expect(QR_VERSAO_MAX).toBe(10);
    expect(() => qrMatriz('x'.repeat(214))).toThrow(RangeError);
  });

  it('é determinístico: o mesmo texto dá a mesma matriz', () => {
    expect(qrLinhas('https://exemplo.test/a').linhas).toEqual(qrLinhas('https://exemplo.test/a').linhas);
  });
});

// ---- A API -------------------------------------------------------------------
const SITE = 'https://fotos.lucafchala.com';
const TOKEN = 'e'.repeat(64);
const RAIZ = 'QRRAIZ_PASTA_0001';
const pasta = (id, name) => ({ id, name, mimeType: 'application/vnd.google-apps.folder' });
let env;
let arvore;

function fakeKV(inicial = {}) {
  const store = new Map(Object.entries(inicial));
  return {
    async get(k) { return store.has(k) ? store.get(k) : null; },
    async put(k, v) { store.set(k, v); },
    async delete(k) { store.delete(k); },
    async list() { return { keys: [], list_complete: true, cursor: null }; },
  };
}
const EVENTOS = [
  { id: '1', slug: 'formatura', title: 'Formatura 2026', accessType: 'public', galeriaCapitulos: true, driveUrl: `https://drive.google.com/drive/folders/${RAIZ}` },
  { id: '2', slug: 'casamento', title: 'Casamento', accessType: 'public', driveUrl: `https://drive.google.com/drive/folders/${RAIZ}` },
  { id: '3', slug: 'sem-pasta', title: 'Sem pasta', accessType: 'public', driveUrl: '' },
];

beforeEach(async () => {
  limpaCacheDrive();
  arvore = { [RAIZ]: [pasta('QRCAP_ABERTURA_01', '01 - Abertura'), pasta('QRCAP_FESTA_00001', '02 - Festa de gala')] };
  vi.stubGlobal('fetch', vi.fn(async input => {
    const url = new URL(typeof input === 'string' ? input : input.url);
    if (url.pathname === '/drive/v3/files') {
      const id = (url.searchParams.get('q') || '').match(/^'([^']+)' in parents/)?.[1];
      return Response.json({ files: arvore[id] || [] });
    }
    return new Response('nao esperado', { status: 599 });
  }));
  env = withDurableObjects({
    FOTOS: fakeKV({ [`admin_session:${TOKEN}`]: JSON.stringify({ createdAt: Date.now() }) }),
    GOOGLE_DRIVE_API_KEY: 'AIzaChaveDeTeste123',
    SIGNING_SECRET: 's'.repeat(48),
  });
  await saveEvents(env, structuredClone(EVENTOS));
});
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });

const api = (query, { dono = true } = {}) => worker.fetch(
  new Request(`${SITE}/api/qr?${query}`, { headers: dono ? { Cookie: `__Host-session=${TOKEN}` } : {} }),
  env, { waitUntil() {} },
);

describe('GET /api/qr', () => {
  it('só o dono', async () => {
    expect((await api('slug=formatura', { dono: false })).status).toBe(401);
  });

  it('galeria por capítulos: o QR é o do índice e a lista traz os capítulos', async () => {
    const r = await api('slug=formatura');
    expect(r.status).toBe(200);
    const j = await r.json();
    expect(j.url).toBe(`${SITE}/galeria/formatura`);
    expect(j.destino).toBe('indice');
    expect(j.titulo).toBe('Formatura 2026');
    expect(j.capitulos.map(c => c.slug)).toEqual(expect.arrayContaining(['abertura', 'festa-de-gala']));
    expect(leitura(j.linhas)).toBe(j.url);
  });

  it('um capítulo: o link do capítulo, com o nome no título, e a matriz decodifica para ele', async () => {
    const j = await (await api('slug=formatura&cap=festa-de-gala')).json();
    expect(j.url).toBe(`${SITE}/galeria/formatura/festa-de-gala`);
    expect(j.destino).toBe('capitulo');
    expect(j.titulo).toBe('Formatura 2026 · Festa de gala');
    expect(leitura(j.linhas)).toBe(j.url);
  });

  it('galeria comum: o link da galeria; capítulo inexistente ou em projeto sem capítulos: 404', async () => {
    const j = await (await api('slug=casamento')).json();
    expect(j.url).toBe(`${SITE}/galeria/casamento`);
    expect(j.destino).toBe('galeria');
    expect(j.capitulos).toEqual([]);
    expect(leitura(j.linhas)).toBe(j.url);
    expect((await api('slug=formatura&cap=nao-existe')).status).toBe(404);
    expect((await api('slug=casamento&cap=abertura')).status).toBe(404);
    expect((await api('slug=nao-existe')).status).toBe(404);
  });

  it('projeto sem pasta do Drive: o QR leva à página do projeto', async () => {
    const j = await (await api('slug=sem-pasta')).json();
    expect(j.url).toBe(`${SITE}/sem-pasta`);
    expect(j.destino).toBe('projeto');
    expect(leitura(j.linhas)).toBe(j.url);
  });

  it('o Drive fora do ar não derruba o QR do índice (só vem sem a lista)', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('x', { status: 500 })));
    limpaCacheDrive();
    const r = await api('slug=formatura');
    expect(r.status).toBe(200);
    const j = await r.json();
    expect(j.capitulos).toEqual([]);
    expect(leitura(j.linhas)).toBe(`${SITE}/galeria/formatura`);
  });
});

describe('o painel', () => {
  const BASE = { id: 'abc123', slug: 'formatura-2026', title: 'Formatura 2026', status: 'entregue', visible: true, accessType: 'public', driveUrl: `https://drive.google.com/drive/folders/${RAIZ}`, photos: [] };

  it('o menu do projeto tem a ação "QR code da galeria…" com o ícone', () => {
    const card = cardProjetoPainel(BASE, { esc: s => String(s), safeUrl: s => s, rotulo: s => s, atrasado: () => false, icones: ICONES });
    expect(card).toMatch(/data-action="qr"[^>]*>[\s\S]*?QR code da galeria/);
    expect(ICONES.qr).toContain('<svg');
  });

  it('o script da página traz o desenho do PNG, do SVG e a chamada à API', () => {
    const h = dashboardHTML([BASE], [], 'NONCE');
    for (const trecho of ['function abreQr', 'function desenhaQr', 'function svgDoQr', '/api/qr?slug=', "'image/png'", 'image/svg+xml', 'Baixar PNG', 'Baixar SVG']) expect(h).toContain(trecho);
  });
});
