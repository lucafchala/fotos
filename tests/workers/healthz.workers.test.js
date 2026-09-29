import { SELF } from 'cloudflare:test';
import { describe, it, expect } from 'vitest';

// A memória do /api/healthz (#195) é chaveada pelo objeto `env`. Isso só
// economiza alguma coisa se o runtime entregar o MESMO `env` a pedidos
// seguidos do mesmo isolate — garantia da plataforma, então é aqui, no
// workerd, que se prova. No node o teste afirmaria sobre o nosso dublê.
describe('/api/healthz no runtime de verdade', () => {
  it('o segundo pedido seguido reaproveita a medição do primeiro', async () => {
    const primeiro = await SELF.fetch('https://fotos.lucafchala.com/api/healthz');
    expect(primeiro.status).toBe(200);
    await primeiro.arrayBuffer();
    const segundo = await SELF.fetch('https://fotos.lucafchala.com/api/healthz');
    expect(segundo.status).toBe(200);
    expect(segundo.headers.get('X-Healthz-Cache')).toBe('hit');
    const corpo = await segundo.json();
    expect(corpo.ok).toBe(true);
  });
});
