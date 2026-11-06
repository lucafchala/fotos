// "Fotos novas desde a sua última visita" (v3.1, item j, #250). O que estes
// testes prendem:
//  1. o servidor: `createdTime` vira minutos desde a época (só para o que
//     chegou dentro da janela de 90 dias) e viaja na tupla da página; o que é
//     velho NÃO leva o campo (a lista não engorda); vídeo e Live Photo também;
//  2. o resumo do índice guarda os instantes recentes (os mais novos, com teto);
//  3. a página do capítulo e o índice trazem o que o navegador precisa, sem
//     nenhum dado do visitante e sem cookie novo;
//  4. o JS do navegador (scripts reais, rodados contra um localStorage de
//     mentira): primeira visita não marca nada; a visita seguinte marca só o
//     que chegou depois; recarregar dentro de 30 min mantém as marcas.

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import worker from '../src/index.js';
import { limpaCacheDrive, listaPasta, criadaEmMin, registraResumo, lerResumo } from '../src/drive.js';
import { EPOCA_CRIADA_MS, NOVAS_JANELA_DIAS, NOVAS_RESUMO_MAX, NOVAS_SESSAO_MIN } from '../src/config.js';
import { galeriaIndiceHTML } from '../src/ui/galeria-indice.js';
import { saveEvents } from '../src/utils.js';
import { withDurableObjects } from './helpers/do.js';

const SITE = 'https://fotos.lucafchala.com';
const RAIZ = 'NOVAS_PASTA_0001';
const AGORA = Date.parse('2026-11-06T12:00:00Z');
const DIA = 86_400_000;
const iso = ms => new Date(ms).toISOString();
const min = ms => Math.floor((ms - EPOCA_CRIADA_MS) / 60_000);

const img = (id, name, criada, extra = {}) => ({ id, name, mimeType: 'image/jpeg', size: '1000', imageMediaMetadata: { width: 4000, height: 3000 }, ...(criada ? { createdTime: criada } : {}), ...extra });
const vid = (id, name, s, criada) => ({ id, name, mimeType: 'video/quicktime', size: '9000000', videoMediaMetadata: { width: 1920, height: 1080, durationMillis: String(s * 1000) }, ...(criada ? { createdTime: criada } : {}) });

let arvore;
let env;
let pend;
let ctx;

function fakeKV() {
  const store = new Map();
  return {
    async get(k) { return store.has(k) ? store.get(k) : null; },
    async put(k, v) { store.set(k, v); },
    async delete(k) { store.delete(k); },
    async list() { return { keys: [], list_complete: true, cursor: null }; },
  };
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(AGORA);
  limpaCacheDrive();
  pend = [];
  ctx = { waitUntil: p => { pend.push(p); } };
  arvore = {};
  vi.stubGlobal('fetch', vi.fn(async input => {
    const url = new URL(typeof input === 'string' ? input : input.url);
    if (url.pathname === '/drive/v3/files') {
      const q = url.searchParams.get('q') || '';
      const id = q.match(/^'([^']+)' in parents/)?.[1];
      return Response.json({ files: arvore[id] || [] });
    }
    return new Response('nao esperado', { status: 599 });
  }));
  env = withDurableObjects({ FOTOS: fakeKV(), GOOGLE_DRIVE_API_KEY: 'AIzaChaveDeTeste123', SIGNING_SECRET: 's'.repeat(48) });
});
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });

const raiz = { id: RAIZ, resourceKey: '' };
const todas = l => l.secoes.flatMap(s => s.fotos);
const achaF = (l, id) => todas(l).find(f => f[0] === id);
const get = async path => {
  const res = await worker.fetch(new Request(SITE + path, { headers: { 'CF-Connecting-IP': '203.0.113.9' } }), env, ctx);
  await Promise.all(pend.splice(0));
  return res;
};
const dadosDaPagina = html => JSON.parse(html.match(/<script type="application\/json" id="g-dados"[^>]*>([\s\S]*?)<\/script>/)[1]);

describe('criadaEmMin', () => {
  it('converte createdTime em minutos desde a época', () => {
    expect(criadaEmMin(iso(AGORA - 3600_000))).toBe(min(AGORA - 3600_000));
  });
  it('0 para o que falta, é inválido, é velho demais ou é anterior à época', () => {
    expect(criadaEmMin(undefined)).toBe(0);
    expect(criadaEmMin('ontem')).toBe(0);
    expect(criadaEmMin(iso(AGORA - (NOVAS_JANELA_DIAS + 1) * DIA))).toBe(0);
    expect(criadaEmMin(iso(AGORA - (NOVAS_JANELA_DIAS - 1) * DIA))).toBeGreaterThan(0);
  });
});

describe('a listagem leva a data de chegada só do que é recente', () => {
  it('foto recente leva o minuto no índice 8; a antiga e a sem data, nada', async () => {
    const recente = iso(AGORA - 2 * 3600_000);
    arvore[RAIZ] = [img('FOTO_NOVA_0001', 'a.jpg', recente), img('FOTO_VELHA_001', 'b.jpg', iso(AGORA - 200 * DIA)), img('FOTO_SEMDATA_01', 'c.jpg', '')];
    const l = await listaPasta(env, raiz);
    expect(achaF(l, 'FOTO_NOVA_0001')[8]).toBe(min(AGORA - 2 * 3600_000));
    expect(achaF(l, 'FOTO_VELHA_001')).toHaveLength(5);
    expect(achaF(l, 'FOTO_SEMDATA_01')).toHaveLength(5);
  });

  it('vídeo recente leva o campo; o Live Photo pareado fica com o dele (nulo no índice 7 não atrapalha)', async () => {
    const t = iso(AGORA - 3600_000);
    arvore[RAIZ] = [img('FOTO_LIVE_0001', 'IMG_1.HEIC', t), vid('VIDEO_LIVE_001', 'IMG_1.MOV', 3, t), vid('VIDEO_LONGO_01', 'passeio.mp4', 80, t)];
    const l = await listaPasta(env, raiz);
    const foto = achaF(l, 'FOTO_LIVE_0001');
    expect(Array.isArray(foto[7])).toBe(true);
    expect(foto[8]).toBe(min(AGORA - 3600_000));
    expect(achaF(l, 'VIDEO_LIVE_001')).toBeUndefined();
    const longo = achaF(l, 'VIDEO_LONGO_01');
    expect(longo[7]).toBe(80);
    expect(longo[8]).toBe(min(AGORA - 3600_000));
  });
});

describe('o resumo do índice', () => {
  const listagem = fotos => ({ v: 3, pasta: 'x', em: AGORA, truncada: false, total: fotos.length, videos: 0, outros: 0, secoes: [{ nome: '', caminho: '', fotos }] });
  const foto = (id, cr) => (cr ? [id, 1, 1, id + '.jpg', 1, 0, 0, null, cr] : [id, 1, 1, id + '.jpg', 1]);

  it('guarda os instantes recentes, os mais novos primeiro, e atualiza quando só eles mudam', async () => {
    await registraResumo(RAIZ, 'CAP1', listagem([foto('A', 100), foto('B', 300), foto('C'), foto('D', 200)]));
    expect((await lerResumo(RAIZ)).CAP1.cr).toEqual([300, 200, 100]);
    await registraResumo(RAIZ, 'CAP1', listagem([foto('A', 100), foto('B', 300), foto('C'), foto('D', 400)]));
    expect((await lerResumo(RAIZ)).CAP1.cr).toEqual([400, 300, 100]);
  });

  it('respeita o teto e não cria o campo quando nada é recente', async () => {
    const muitas = Array.from({ length: NOVAS_RESUMO_MAX + 25 }, (_, i) => foto('F' + i, i + 1));
    await registraResumo(RAIZ, 'CAP2', listagem(muitas));
    const cr = (await lerResumo(RAIZ)).CAP2.cr;
    expect(cr).toHaveLength(NOVAS_RESUMO_MAX);
    expect(cr[0]).toBe(NOVAS_RESUMO_MAX + 25);
    await registraResumo(RAIZ, 'CAP3', listagem([foto('Z')]));
    expect((await lerResumo(RAIZ)).CAP3.cr).toBeUndefined();
  });
});

describe('a página do capítulo (servidor)', () => {
  it('a tupla da página leva o minuto no índice 10 (extra nulo quando não há) e a origem em cr0; sem cookie novo', async () => {
    arvore[RAIZ] = [img('FOTO_NOVA_0001', 'a.jpg', iso(AGORA - 3600_000)), img('FOTO_VELHA_001', 'b.jpg', iso(AGORA - 300 * DIA))];
    await saveEvents(env, [{ id: '2', slug: 'proj-n', title: 'Novas', accessType: 'public', driveUrl: `https://drive.google.com/drive/folders/${RAIZ}` }]);
    const res = await get('/galeria/proj-n');
    expect(res.status).toBe(200);
    expect(res.headers.get('Set-Cookie') || '').not.toMatch(/visita/i);
    const d = dadosDaPagina(await res.text());
    expect(d.cr0).toBe(EPOCA_CRIADA_MS);
    expect(d.sessao).toBe(NOVAS_SESSAO_MIN);
    const f = d.secoes.flatMap(s => s.fotos);
    const nova = f.find(x => x[0] === 'FOTO_NOVA_0001');
    const velha = f.find(x => x[0] === 'FOTO_VELHA_001');
    expect(nova[10]).toBe(min(AGORA - 3600_000));
    expect(nova[9]).toBeNull();
    expect(velha).toHaveLength(5);
  });
});

describe('o índice (servidor)', () => {
  const caps = { caps: [{ id: 'CAP1', slug: 'abertura', nome: 'Abertura' }, { id: 'CAP2', slug: 'festa', nome: 'Festa' }], em: AGORA, truncada: false };
  const html = resumo => galeriaIndiceHTML({ event: { id: '1', slug: 'proj', title: 'Proj', accessType: 'public' }, caps, resumo, ocultas: [], dono: false, indexavel: false, nonce: 'N0NCE' });

  it('o cartão leva o slug do capítulo e os instantes; o script leva o nonce e a chave da visita', () => {
    const h = html({ CAP1: { n: 5, capas: ['A'], cr: [300, 200] }, CAP2: { n: 2, capas: ['B'] } });
    expect(h).toMatch(/data-cap="abertura" data-cr="300,200"/);
    expect(h).toMatch(/data-cap="festa">/);
    expect(h).toContain('<script nonce="N0NCE">');
    expect(h).toContain('gal-visita:');
  });

  it('o script do navegador não tem crase, ${ nem barra invertida (vive num template literal)', () => {
    const js = html({}).match(/<script nonce="N0NCE">([\s\S]*?)<\/script>/)[1];
    expect(js).not.toContain('`');
    expect(js).not.toContain('${');
    expect(js).not.toContain('\\');
  });
});

// ---- O JS do navegador, de verdade -----------------------------------------
// Roda o script que o servidor emite contra um DOM mínimo e um localStorage de
// mentira. Não é um navegador (isso é o verifica:galeria), mas pega a lógica.
function navegadorFalso(armazem) {
  const spans = [];
  const sub = { appendChild: s => spans.push(s) };
  const cartoes = [];
  return {
    spans, cartoes,
    doc: {
      querySelectorAll: () => cartoes,
      createElement: () => ({ className: '', textContent: '' }),
    },
    sub,
    ls: { getItem: k => (k in armazem ? armazem[k] : null), setItem: (k, v) => { armazem[k] = String(v); } },
  };
}
function rodaIndice(h, armazem, cartoesSpec) {
  const js = h.match(/<script nonce="N0NCE">([\s\S]*?)<\/script>/)[1];
  const nav = navegadorFalso(armazem);
  const porCartao = [];
  for (const c of cartoesSpec) {
    const subs = [];
    porCartao.push({ c, subs });
    nav.cartoes.push({
      getAttribute: n => (n === 'data-cap' ? c.cap : c.cr),
      querySelector: () => ({ appendChild: s => subs.push(s) }),
    });
  }
  new Function('document', 'localStorage', 'Date', js)(nav.doc, nav.ls, Date);
  return porCartao.map(p => p.subs.map(s => s.textContent));
}

describe('o script do índice no navegador', () => {
  const caps = { caps: [{ id: 'CAP1', slug: 'abertura', nome: 'Abertura' }], em: AGORA, truncada: false };
  const h = galeriaIndiceHTML({ event: { id: '1', slug: 'proj', title: 'Proj', accessType: 'public' }, caps, resumo: {}, ocultas: [], dono: false, indexavel: false, nonce: 'N0NCE' });
  const cr = [min(AGORA - 3600_000), min(AGORA - 5 * 3600_000), min(AGORA - 3 * DIA)].join(',');

  it('sem visita anterior não marca nada', () => {
    expect(rodaIndice(h, {}, [{ cap: 'abertura', cr }])).toEqual([[]]);
  });

  it('com visita anterior (sessão antiga), conta só o que chegou depois', () => {
    const u = AGORA - 2 * 3600_000 - 31 * 60_000;
    const out = rodaIndice(h, { 'gal-visita:proj:abertura': JSON.stringify({ p: 0, u }) }, [{ cap: 'abertura', cr }]);
    // chegou 1 h atrás (depois de u) e 5 h atrás (antes de u): 1 nova
    expect(out).toEqual([['1 nova']]);
  });

  it('dentro da mesma sessão vale o instante anterior à sessão (p), não o último acesso', () => {
    const p = AGORA - 6 * 3600_000;
    const out = rodaIndice(h, { 'gal-visita:proj:abertura': JSON.stringify({ p, u: AGORA - 5 * 60_000 }) }, [{ cap: 'abertura', cr }]);
    expect(out).toEqual([['2 novas']]);
  });

  it('localStorage quebrado ou com lixo não derruba o script', () => {
    expect(rodaIndice(h, { 'gal-visita:proj:abertura': '{lixo' }, [{ cap: 'abertura', cr }])).toEqual([[]]);
  });
});
