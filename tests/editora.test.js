// A editora do álbum (v3.8.1): uma senha à parte, só para o álbum dela. O que
// estes testes prendem:
//  1. a senha fica só como hash; curta ou igual à da prévia é recusada;
//  2. entrar: errada volta para /entrar?erro=1; certa dá o cookie e leva ao
//     álbum, que abre antes do lançamento (como dona);
//  3. ela oculta foto e escolhe capa SÓ no álbum dela; o painel continua
//     fechado para ela;
//  4. trocar a senha tira quem estava dentro; /sair apaga o cookie.
import { describe, it, expect, vi } from 'vitest';
import { aplicaSenhaEditora, aplicaSenhaPrevia } from '../src/index.js';
import { withDurableObjects } from './helpers/do.js';

const BASE = {
  id: '1', slug: 'entrenos2026', title: 'Entre Nós', accessType: 'public', galeriaCapitulos: true, galeriaAbertura: 'Oi, turma.',
  driveUrl: 'https://drive.google.com/drive/folders/RAIZ_PASTA_0001', comingSoon: true, visible: false,
};
const OUTRO = { ...BASE, id: '2', slug: 'outro-album', comingSoon: false, visible: true };
async function comSenha(/** @type {string} */ senha, extra = {}) {
  const ev = { ...BASE, ...extra };
  expect(await aplicaSenhaEditora({ editoraSenhaNova: senha }, ev)).toBe('');
  return ev;
}
function kv(/** @type {any[]} */ eventos) {
  const store = new Map([['events', JSON.stringify(eventos)]]);
  return { store, async get(/** @type {string} */ k) { return store.has(k) ? store.get(k) : null; }, async put(/** @type {string} */ k, /** @type {string} */ v) { store.set(k, v); },
    async delete() {}, async list() { return { keys: [], list_complete: true, cursor: null }; } };
}
/** @param {any} env @param {string} url @param {{ cookie?: string, metodo?: string, corpo?: string, json?: any, ip?: string }} [o] */
async function pede(env, url, o = {}) {
  vi.resetModules();
  const w = (await import('../src/index.js')).default;
  /** @type {Record<string, string>} */
  const headers = { 'CF-Connecting-IP': o.ip || '203.0.113.9' };
  if (o.cookie) headers.Cookie = o.cookie;
  if (o.corpo) headers['Content-Type'] = 'application/x-www-form-urlencoded';
  if (o.json) headers['Content-Type'] = 'application/json';
  return w.fetch(new Request(url, { method: o.metodo || 'GET', headers, body: o.corpo || (o.json ? JSON.stringify(o.json) : undefined) }), env, { waitUntil() {} });
}
const novoEnv = (/** @type {any[]} */ eventos) => withDurableObjects({ FOTOS: kv(eventos), SIGNING_SECRET: 's'.repeat(48) });
const entra = (/** @type {any} */ env, /** @type {string} */ senha, ip = '203.0.113.9') =>
  pede(env, 'https://entrenos2026.com/api/editora/entrar', { metodo: 'POST', corpo: `slug=entrenos2026&senha=${encodeURIComponent(senha)}`, ip });
const cookieDe = (/** @type {Response} */ r) => (r.headers.get('Set-Cookie') || '').split(';')[0];

describe('a senha da editora', () => {
  it('fica só como hash; curta ou igual à da prévia é recusada', async () => {
    const ev = await comSenha('mag-edita-2026');
    expect(ev.editoraSenha).toMatch(/^[a-f0-9]{32}\$[a-f0-9]{64}$/);
    expect(JSON.stringify(ev)).not.toContain('mag-edita-2026');
    expect(await aplicaSenhaEditora({ editoraSenhaNova: 'curta' }, { ...BASE })).toMatch(/8 a 100/);
    const comPrevia = { ...BASE };
    await aplicaSenhaPrevia({ previaSenhaNova: 'girassol26' }, comPrevia);
    expect(await aplicaSenhaEditora({ editoraSenhaNova: 'girassol26' }, comPrevia)).toMatch(/diferente da senha da prévia/);
  });
});

describe('entrar como editora', () => {
  it('errada volta para /entrar?erro=1; certa dá o cookie e o álbum abre antes do lançamento', async () => {
    const ev = await comSenha('mag-edita-2026');
    const env = novoEnv([ev]);
    const errada = await entra(env, 'nao-e-essa');
    expect(errada.status).toBe(303);
    expect(errada.headers.get('Location')).toBe('/entrar?erro=1');
    expect(errada.headers.get('Set-Cookie')).toBeNull();
    const ok = await entra(env, 'mag-edita-2026');
    expect(ok.status).toBe(303);
    expect(ok.headers.get('Location')).toBe('/');
    expect(ok.headers.get('Set-Cookie')).toMatch(/^editora_entrenos2026=[^;]+; Path=\/; Max-Age=2592000; HttpOnly; Secure; SameSite=Lax$/);
    const cookie = cookieDe(ok);
    expect(await (await pede(env, 'https://entrenos2026.com/')).text()).toContain('O álbum da turma está chegando');
    expect(await (await pede(env, 'https://entrenos2026.com/', { cookie })).text()).not.toContain('O álbum da turma está chegando');
  });

  it('a página /entrar existe no domínio, sem índice, e mostra o erro', async () => {
    const env = novoEnv([BASE]);
    const r = await pede(env, 'https://entrenos2026.com/entrar?erro=1');
    expect(r.status).toBe(200);
    expect(r.headers.get('X-Robots-Tag')).toBe('noindex');
    const h = await r.text();
    expect(h).toContain('<form method="post" action="/api/editora/entrar">');
    expect(h).toContain('Senha errada.');
  });
});

describe('o que a editora pode e não pode', () => {
  it('oculta foto e escolhe capa só no álbum dela; o painel continua fechado', async () => {
    const ev = await comSenha('mag-edita-2026');
    const env = novoEnv([ev, OUTRO]);
    const cookie = cookieDe(await entra(env, 'mag-edita-2026'));
    const foto = 'FOTO_ABC_0000001';
    const ocultar = (/** @type {string} */ slug) => pede(env, 'https://entrenos2026.com/api/galeria/ocultar', { metodo: 'POST', cookie, json: { slug, foto, oculta: true } });
    expect((await ocultar('entrenos2026')).status).toBe(200);
    expect((await ocultar('outro-album')).status).toBe(401);
    const capa = await pede(env, 'https://entrenos2026.com/api/galeria/capa', { metodo: 'POST', cookie, json: { slug: 'entrenos2026', cap: 'piauifut', foto } });
    expect(capa.status).toBe(200);
    expect(await capa.json()).toEqual({ capas: { piauifut: foto } });
    // O ano do evento (v3.9.0): só ano, ano e mês, voltar ao automático; lixo é 400.
    const data = (/** @type {string} */ d, slug = 'entrenos2026') => pede(env, 'https://entrenos2026.com/api/galeria/data', { metodo: 'POST', cookie, json: { slug, cap: 'piauifut', data: d } });
    expect(await (await data('2024')).json()).toEqual({ datas: { piauifut: '2024' } });
    expect(await (await data('2023-05')).json()).toEqual({ datas: { piauifut: '2023-05' } });
    expect((await data('24')).status).toBe(400);
    expect((await data('2024-13')).status).toBe(400);
    expect((await data('2024', 'outro-album')).status).toBe(401);
    expect(await (await data('')).json()).toEqual({ datas: {} });
    // O painel: nada.
    expect((await pede(env, 'https://fotos.lucafchala.com/api/metrics', { cookie })).status).toBe(401);
  });

  it('trocar a senha tira quem estava dentro; /sair apaga o cookie', async () => {
    const ev = await comSenha('mag-edita-2026');
    const cookie = cookieDe(await entra(novoEnv([ev]), 'mag-edita-2026'));
    const trocado = await comSenha('outra-senha-2026');
    expect(await (await pede(novoEnv([trocado]), 'https://entrenos2026.com/', { cookie })).text()).toContain('O álbum da turma está chegando');
    const sai = await pede(novoEnv([ev]), 'https://entrenos2026.com/sair', { cookie });
    expect(sai.status).toBe(303);
    expect(sai.headers.get('Set-Cookie')).toMatch(/^editora_entrenos2026=; Path=\/; Max-Age=0/);
  });
});
