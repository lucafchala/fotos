// Domínio próprio de um álbum (entrenos2026.com). O que estes testes prendem:
//  1. a raiz desse domínio leva direto à galeria do álbum, com a query junto;
//  2. www. vai para o domínio sem www., preservando caminho e query;
//  3. o painel volta para o domínio principal (a sessão mora lá);
//  4. o resto do site responde igual nesse domínio — e o domínio principal
//     não muda nada;
//  5. sem o projeto (ou com ele oculto), a raiz mostra "em breve", não um 404.
import { describe, it, expect, vi } from 'vitest';
import worker, { rotaDoDominioDeAlbum } from '../src/index.js';
import { DOMINIOS_DE_ALBUM } from '../src/config.js';
import { withDurableObjects } from './helpers/do.js';

const SLUG = DOMINIOS_DE_ALBUM['entrenos2026.com'].slug;
const ctx = { waitUntil: () => {} };

function kv(events = []) {
  const store = new Map(Object.entries({ events: JSON.stringify(events) }));
  return { async get(k) { return store.has(k) ? store.get(k) : null; },
    async put(k, v) { store.set(k, v); }, async delete(k) { store.delete(k); },
    async list() { return { keys: [], list_complete: true }; } };
}

const ALBUM = [{ id: '1', slug: SLUG, title: 'Entre Nós', accessType: 'public' }];
/** @param {string} endereco @param {RequestInit} [init] @param {any[]} [eventos] */
function pede(endereco, init, eventos = ALBUM) {
  const env = withDurableObjects({ FOTOS: kv(eventos) });
  return worker.fetch(new Request(endereco, init), env, ctx);
}
const envCom = (eventos = ALBUM) => withDurableObjects({ FOTOS: kv(eventos) });

describe('domínio de álbum (entrenos2026.com)', () => {
  it('aponta para um slug válido de projeto', () => {
    expect(SLUG).toMatch(/^[a-z0-9][a-z0-9-]*$/);
  });

  it('a raiz vai direto à galeria do álbum (302), com a query junto', async () => {
    const res = await pede('https://entrenos2026.com/?utm_source=qr');
    expect(res.status).toBe(302);
    expect(res.headers.get('Location')).toBe(`/galeria/${SLUG}?utm_source=qr`);
    // Mesmo um redirecionamento sai com os cabeçalhos de segurança.
    expect(res.headers.get('X-Content-Type-Options')).toBe('nosniff');
  });

  it('HEAD na raiz também redireciona', async () => {
    const res = await pede('https://entrenos2026.com/', { method: 'HEAD' });
    expect(res.status).toBe(302);
    expect(res.headers.get('Location')).toBe(`/galeria/${SLUG}`);
  });

  it('www. vai para o domínio sem www. (301), preservando caminho e query', async () => {
    const res = await pede('https://www.entrenos2026.com/galeria/x/cap?a=1');
    expect(res.status).toBe(301);
    expect(res.headers.get('Location')).toBe('https://entrenos2026.com/galeria/x/cap?a=1');
  });

  it('maiúsculas no host não escapam do desvio', async () => {
    const res = await rotaDoDominioDeAlbum(new URL('https://EntreNos2026.COM/'), '/', envCom());
    expect(res?.headers.get('Location')).toBe(`/galeria/${SLUG}`);
  });

  it('o painel volta para o domínio principal', async () => {
    for (const caminho of ['/dashboard', '/dashboard/qualquer']) {
      const res = await pede(`https://entrenos2026.com${caminho}`);
      expect(res.status).toBe(302);
      expect(res.headers.get('Location')).toBe('https://fotos.lucafchala.com/dashboard');
    }
  });

  it('o resto do site responde igual nesse domínio', async () => {
    const res = await pede('https://entrenos2026.com/privacidade');
    expect(res.status).toBe(200);
    expect(await rotaDoDominioDeAlbum(new URL('https://entrenos2026.com/galeria/x'), '/galeria/x', envCom())).toBeNull();
  });

  it('o domínio principal e domínios parecidos não mudam', async () => {
    const res = await pede('https://fotos.lucafchala.com/');
    expect(res.status).toBe(200);
    for (const host of ['entrenos2026.com.evil.example', 'xentrenos2026.com', 'fotos.lucafchala.com']) {
      expect(await rotaDoDominioDeAlbum(new URL(`https://${host}/`), '/', envCom())).toBeNull();
    }
  });

  it('sem o projeto, ou com ele oculto, a raiz mostra "em breve" (200, noindex), não um 404', async () => {
    for (const eventos of [[], [{ ...ALBUM[0], visible: false }]]) {
      // Isolate frio: getEvents tem cache de módulo, e o teste anterior
      // serviria a lista dele (com o projeto) no lugar desta.
      vi.resetModules();
      const { default: frio } = await import('../src/index.js');
      const res = await frio.fetch(new Request('https://entrenos2026.com/'), envCom(eventos), ctx);
      expect(res.status).toBe(200);
      expect(res.headers.get('X-Robots-Tag')).toBe('noindex');
      const h = await res.text();
      expect(h).toContain('<h1>Entre Nós</h1>');
      expect(h).toContain('Turma 2026 · Colégio Santa Cruz');
      expect(h).toContain('Fotos de Luca F. Chala e Mag');
      expect(h).not.toContain('<script');
    }
  });

  it('o robots.txt do domínio anuncia só o sitemap do álbum, com os endereços de lá', async () => {
    const txt = await (await pede('https://entrenos2026.com/robots.txt')).text();
    expect(txt).toContain('# robots.txt — entrenos2026.com');
    expect(txt).toContain(`Sitemap: https://entrenos2026.com/sitemap-galeria-${SLUG}.xml`);
    expect(txt).not.toContain('fotos.lucafchala.com/sitemap');
    expect(txt).toContain('Disallow: /galeria/*/baixar/');
    const principal = await (await pede('https://fotos.lucafchala.com/robots.txt')).text();
    expect(principal).toContain('Sitemap: https://fotos.lucafchala.com/sitemap-galerias.xml');
  });

  it('os sitemaps do domínio principal deixam o álbum de domínio próprio de fora', async () => {
    const drive = 'https://drive.google.com/drive/folders/RAIZ_PASTA_0001';
    const eventos = [{ ...ALBUM[0], driveUrl: drive }, { id: '2', slug: 'formatura', title: 'F', accessType: 'public', driveUrl: drive }];
    vi.resetModules();
    const { default: frio } = await import('../src/index.js');
    for (const caminho of ['/sitemap.xml', '/sitemap-galerias.xml']) {
      const xml = await (await frio.fetch(new Request(`https://fotos.lucafchala.com${caminho}`), envCom(eventos), ctx)).text();
      expect(xml).toContain('formatura');
      // A página do projeto (fotos.lucafchala.com/<slug>) continua; a galeria não.
      expect(xml).not.toContain(`galeria/${SLUG}`);
      expect(xml).not.toContain(`sitemap-galeria-${SLUG}`);
    }
  });
});
