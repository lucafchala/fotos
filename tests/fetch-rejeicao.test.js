import { describe, it, expect, vi, afterEach } from 'vitest';
import worker from '../src/index.js';

// Sem `return await handle…` em worker.fetch, a rejeição de um handler
// assíncrono escapa do catch-all: não sai a página 500 nem o e-mail de alerta.

afterEach(() => { vi.unstubAllGlobals(); });

function ambienteComKvQuebrado() {
  return {
    FOTOS: {
      get: vi.fn(async () => { throw new Error('KV indisponível'); }),
      put: vi.fn(async () => {}),
      delete: vi.fn(async () => {}),
      list: vi.fn(async () => ({ keys: [], list_complete: true })),
    },
    RESEND_API_KEY: 're_teste',
    ADMIN_EMAIL: 'dono@example.com',
  };
}

function contexto() {
  /** @type {Promise<unknown>[]} */
  const pendentes = [];
  return { pendentes, ctx: { waitUntil: (p) => { pendentes.push(p); }, passThroughOnException() {} } };
}

describe('worker.fetch — rejeição de handler assíncrono', () => {
  it('GET /api/recentes com o KV rejeitando vira 500 e dispara o alerta', async () => {
    const enviados = [];
    vi.stubGlobal('fetch', vi.fn(async (url) => { enviados.push(String(url)); return new Response('{}', { status: 200 }); }));
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const env = ambienteComKvQuebrado();
    const { ctx, pendentes } = contexto();

    const res = await worker.fetch(new Request('https://fotos.lucafchala.com/api/recentes'), env, ctx);
    await Promise.all(pendentes);

    expect(res.status).toBe(500);
    expect(enviados.some(u => u.includes('resend'))).toBe(true);
  });

  it('GET / com o KV rejeitando também devolve 500, não uma rejeição solta', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('{}', { status: 200 })));
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const env = ambienteComKvQuebrado();
    const { ctx, pendentes } = contexto();

    const res = await worker.fetch(new Request('https://fotos.lucafchala.com/'), env, ctx);
    await Promise.all(pendentes);

    expect(res.status).toBe(500);
  });
});
