// Prévia do álbum com senha — o easter egg da página "em breve" (v3.7) — e a
// página do projeto que leva à galeria. O álbum é surpresa: o que estes testes
// prendem é que só quem sabe a senha entra, e que nada vaza:
//  1. a senha fica só como hash; curta é recusada; tirar e trocar funcionam;
//  2. senha errada: 403; certa: cookie que abre a galeria e a página do
//     projeto antes do lançamento; trocar a senha derruba o cookie;
//  3. tentativas limitadas por IP;
//  4. a página "em breve" só tem o easter egg com senha cadastrada, e o hash
//     nunca vai para a página;
//  5. álbum com apresentação: a página do projeto leva à galeria (no domínio
//     próprio depois do lançamento); projeto comum segue igual.
import { describe, it, expect, vi } from 'vitest';
import { aplicaSenhaPrevia, sanitizeRestoredEvent } from '../src/index.js';
import { SCRIPT_PREVIA } from '../src/ui/em-breve.js';
import { withDurableObjects } from './helpers/do.js';

const SESSAO = 'e'.repeat(64);
const BASE = {
  id: '1', slug: 'entrenos2026', title: 'Entre Nós', accessType: 'public', galeriaCapitulos: true, galeriaAbertura: 'Oi, turma.',
  driveUrl: 'https://drive.google.com/drive/folders/RAIZ_PASTA_0001', comingSoon: true, visible: false,
};
async function comSenha(/** @type {string} */ senha, extra = {}) {
  const ev = { ...BASE, ...extra };
  expect(await aplicaSenhaPrevia({ previaSenhaNova: senha }, ev)).toBe('');
  return ev;
}
function kv(/** @type {any[]} */ eventos) {
  const store = new Map([['events', JSON.stringify(eventos)], [`admin_session:${SESSAO}`, JSON.stringify({ createdAt: Date.now() })]]);
  return { async get(/** @type {string} */ k) { return store.has(k) ? store.get(k) : null; }, async put(/** @type {string} */ k, /** @type {string} */ v) { store.set(k, v); },
    async delete() {}, async list() { return { keys: [], list_complete: true, cursor: null }; } };
}
/** @param {any[]} eventos @param {string} url @param {{ cookie?: string, metodo?: string, corpo?: any, ip?: string, env?: any }} [o] */
async function pede(eventos, url, o = {}) {
  vi.resetModules();
  const w = (await import('../src/index.js')).default;
  /** @type {Record<string, string>} */
  const headers = { 'CF-Connecting-IP': o.ip || '203.0.113.8' };
  if (o.cookie) headers.Cookie = o.cookie;
  if (o.corpo) headers['Content-Type'] = 'application/json';
  const env = o.env || withDurableObjects({ FOTOS: kv(eventos), SIGNING_SECRET: 's'.repeat(48) });
  return w.fetch(new Request(url, { method: o.metodo || 'GET', headers, body: o.corpo ? JSON.stringify(o.corpo) : undefined }), env, { waitUntil() {} });
}
const entra = (/** @type {any[]} */ evs, /** @type {string} */ senha, ip = '203.0.113.8', env = undefined) =>
  pede(evs, 'https://entrenos2026.com/api/previa', { metodo: 'POST', corpo: { slug: 'entrenos2026', senha }, ip, env });
const cookieDe = (/** @type {Response} */ r) => (r.headers.get('Set-Cookie') || '').split(';')[0];

describe('a senha', () => {
  it('fica só como hash; curta é recusada; tirar apaga', async () => {
    const ev = await comSenha('girassol26');
    expect(ev.previaSenha).toMatch(/^[a-f0-9]{32}\$[a-f0-9]{64}$/);
    expect(JSON.stringify(ev)).not.toContain('girassol26');
    expect(await aplicaSenhaPrevia({ previaSenhaNova: '123' }, { ...BASE })).toMatch(/6 a 100/);
    const sem = { ...ev };
    await aplicaSenhaPrevia({ previaRemover: true }, sem);
    expect(sem.previaSenha).toBe('');
    // Campo vazio: mantém.
    const mantem = { ...ev };
    await aplicaSenhaPrevia({ previaSenhaNova: '' }, mantem);
    expect(mantem.previaSenha).toBe(ev.previaSenha);
  });

  it('backup restaurado só traz hash bem formado', () => {
    expect(sanitizeRestoredEvent({ ...BASE, previaSenha: 'senha-em-claro' }).previaSenha).toBe('');
  });
});

describe('entrar pela senha', () => {
  it('errada: 403; certa: cookie que abre a galeria e leva da página do projeto à galeria', async () => {
    const ev = await comSenha('girassol26');
    expect((await entra([ev], 'errada')).status).toBe(403);
    const ok = await entra([ev], 'girassol26');
    expect(ok.status).toBe(200);
    expect(await ok.json()).toEqual({ ok: true, url: '/galeria/entrenos2026' });
    expect(ok.headers.get('Set-Cookie')).toMatch(/^previa_entrenos2026=[^;]+; Path=\/; Max-Age=2592000; HttpOnly; Secure; SameSite=Lax$/);
    const cookie = cookieDe(ok);

    // Sem cookie: nada. Com cookie: passa do portão (a página tenta o Drive).
    // Sem cookie, a raiz é o "em breve"; com ele, a raiz já mostra o álbum.
    expect(await (await pede([ev], 'https://entrenos2026.com/')).text()).toContain('O álbum da turma está chegando');
    expect(await (await pede([ev], 'https://entrenos2026.com/', { cookie })).text()).not.toContain('O álbum da turma está chegando');
    expect((await pede([ev], 'https://fotos.lucafchala.com/galeria/entrenos2026')).status).toBe(404);
    expect((await pede([ev], 'https://fotos.lucafchala.com/entrenos2026')).status).toBe(404);
    const proj = await pede([ev], 'https://fotos.lucafchala.com/entrenos2026', { cookie });
    expect(proj.status).toBe(302);
    expect(proj.headers.get('Location')).toBe('/galeria/entrenos2026');
  });

  it('trocar a senha derruba as prévias abertas', async () => {
    const ev = await comSenha('girassol26');
    const cookie = cookieDe(await entra([ev], 'girassol26'));
    const trocado = await comSenha('outra-senha');
    expect(await (await pede([trocado], 'https://entrenos2026.com/', { cookie })).text()).toContain('O álbum da turma está chegando');
  });

  it('tentativas limitadas por IP', async () => {
    const ev = await comSenha('girassol26');
    const env = withDurableObjects({ FOTOS: kv([ev]), SIGNING_SECRET: 's'.repeat(48) });
    let ultimo = 0;
    for (let i = 0; i < 10; i++) ultimo = (await entra([ev], 'chute' + i, '198.51.100.4', env)).status;
    expect(ultimo).toBe(429);
    // Nem a certa passa enquanto o limite vale.
    expect((await entra([ev], 'girassol26', '198.51.100.4', env)).status).toBe(429);
  });
});

describe('a página "em breve"', () => {
  it('easter egg só com senha cadastrada; o hash não vai para a página', async () => {
    const ev = await comSenha('girassol26');
    const res = await pede([ev], 'https://entrenos2026.com/');
    const h = await res.text();
    expect(h).toContain('<form class="pv" id="pv" data-slug="entrenos2026" hidden>');
    const nonce = h.match(/<script nonce="([^"]+)">\(function \(\) \{\n {2}var f = document.getElementById\('pv'\)/)?.[1];
    expect(nonce).toBeTruthy();
    expect(res.headers.get('Content-Security-Policy')).toContain(`'nonce-${nonce}'`);
    expect(h).not.toContain(/** @type {string} */ (ev.previaSenha).split('$')[1]);
    const semSenha = await (await pede([BASE], 'https://entrenos2026.com/')).text();
    expect(semSenha).not.toContain('id="pv"');
    expect(semSenha).not.toContain('<script');
  });

  it('o script é JS válido e sem innerHTML', () => {
    expect(() => new Function(SCRIPT_PREVIA)).not.toThrow();
    expect(SCRIPT_PREVIA).not.toMatch(/innerHTML|document\.write/);
  });
});

describe('a página do projeto leva à galeria', () => {
  it('álbum lançado: para o domínio próprio; projeto sem apresentação: igual a antes', async () => {
    const lancado = { ...BASE, comingSoon: false, visible: true };
    const r = await pede([lancado], 'https://fotos.lucafchala.com/entrenos2026');
    expect(r.status).toBe(302);
    expect(r.headers.get('Location')).toBe('https://entrenos2026.com/');
    const comum = { ...lancado, id: '2', slug: 'festa-x', galeriaAbertura: '' };
    expect((await pede([comum], 'https://fotos.lucafchala.com/festa-x')).status).toBe(200);
  });
});

describe('a prévia testa a busca pelo rosto (v3.7.1)', () => {
  it('com a senha, o álbum mostra "Procurar meu rosto"; sem ela, nada', async () => {
    const ev = await comSenha('girassol26', { buscaRosto: true });
    vi.stubGlobal('fetch', vi.fn(async (/** @type {any} */ input) => {
      const url = new URL(typeof input === 'string' ? input : input.url);
      if (url.pathname === '/drive/v3/files') return Response.json({ files: [{ id: 'CAPITULO_000001', name: 'Gala', mimeType: 'application/vnd.google-apps.folder' }] });
      return new Response('nao esperado', { status: 599 });
    }));
    const env = () => withDurableObjects({ FOTOS: kv([ev]), SIGNING_SECRET: 's'.repeat(48), GOOGLE_DRIVE_API_KEY: 'AIzaTeste', AWS_ACCESS_KEY_ID: 'AKIATESTE', AWS_SECRET_ACCESS_KEY: 'x'.repeat(40) });
    const cookie = cookieDe(await entra([ev], 'girassol26', '203.0.113.8', env()));
    const comPrevia = await (await pede([ev], 'https://entrenos2026.com/', { cookie, env: env() })).text();
    expect(comPrevia).toContain('id="rs-abrir"');
    expect(await (await pede([ev], 'https://entrenos2026.com/', { env: env() })).text()).not.toContain('id="rs-abrir"');
    vi.unstubAllGlobals();
  });
});
