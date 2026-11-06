// Domínio próprio de um álbum (entrenos2026.com). O que estes testes prendem:
//  1. a raiz desse domínio leva direto à galeria do álbum, com a query junto;
//  2. www. vai para o domínio sem www., preservando caminho e query;
//  3. o painel volta para o domínio principal (a sessão mora lá);
//  4. o resto do site responde igual nesse domínio — e o domínio principal
//     não muda nada.
import { describe, it, expect } from 'vitest';
import worker, { rotaDoDominioDeAlbum } from '../src/index.js';
import { DOMINIOS_DE_ALBUM } from '../src/config.js';
import { withDurableObjects } from './helpers/do.js';

const SLUG = DOMINIOS_DE_ALBUM['entrenos2026.com'];
const ctx = { waitUntil: () => {} };

function kv(events = []) {
  const store = new Map(Object.entries({ events: JSON.stringify(events) }));
  return { async get(k) { return store.has(k) ? store.get(k) : null; },
    async put(k, v) { store.set(k, v); }, async delete(k) { store.delete(k); },
    async list() { return { keys: [], list_complete: true }; } };
}

function pede(endereco, init) {
  const env = withDurableObjects({ FOTOS: kv() });
  return worker.fetch(new Request(endereco, init), env, ctx);
}

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

  it('maiúsculas no host não escapam do desvio', () => {
    const res = rotaDoDominioDeAlbum(new URL('https://EntreNos2026.COM/'), '/');
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
    expect(rotaDoDominioDeAlbum(new URL('https://entrenos2026.com/galeria/x'), '/galeria/x')).toBeNull();
  });

  it('o domínio principal e domínios parecidos não mudam', async () => {
    const res = await pede('https://fotos.lucafchala.com/');
    expect(res.status).toBe(200);
    for (const host of ['entrenos2026.com.evil.example', 'xentrenos2026.com', 'fotos.lucafchala.com']) {
      expect(rotaDoDominioDeAlbum(new URL(`https://${host}/`), '/')).toBeNull();
    }
  });
});
