import { env, SELF } from 'cloudflare:test';
import { describe, it, expect } from 'vitest';

// O corte de sessões (src/utils.js, `encerraOutrasSessoes`) no KV de VERDADE.
//
// A suíte `unit` prova a lógica contra um dublê; o que ela não pode afirmar é
// que a plataforma ACEITA o que pedimos: `cacheTtl` de 30 s no `get`,
// `expirationTtl` de 25 h no `put`, `list` por prefixo — e que a chave do
// marcador (`admin_sessions_corte`) não casa com o prefixo `admin_session:`, ou
// a varredura apagaria o próprio corte. A consistência eventual entre locais
// não existe aqui (um só local); ela está modelada em tests/sessoes-corte.test.js.

const DONO = 'a'.repeat(64);
const LADRAO = 'b'.repeat(64);
const chave = t => `admin_session:${t}`;
const sessao = createdAt => JSON.stringify({ v: 1, createdAt, lastSeen: Date.now() - 1000 });
const sha256 = async t => [...new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(t)))]
  .map(b => b.toString(16).padStart(2, '0')).join('');

const pede = (caminho, token, metodo = 'GET') => SELF.fetch(`https://fotos.lucafchala.com${caminho}`, {
  method: metodo, headers: { Cookie: `__Host-session=${token}` },
});

describe('"Sair dos outros aparelhos" no KV de verdade', () => {
  it('apaga as outras, grava o marcador com TTL de 25 h e deixa a sessão de quem pediu entrar', async () => {
    const agora = Date.now();
    await env.FOTOS.put(chave(DONO), sessao(agora - 3 * 3600_000), { expirationTtl: 86400 });
    await env.FOTOS.put(chave(LADRAO), sessao(agora - 2 * 3600_000), { expirationTtl: 86400 });

    const res = await pede('/api/sessions/revoke-others', DONO, 'POST');
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, encerradas: 1 });

    expect(await env.FOTOS.get(chave(LADRAO))).toBeNull();
    const marcador = JSON.parse(await env.FOTOS.get('admin_sessions_corte'));
    expect(marcador.exceto).toBe(await sha256(DONO));
    expect(marcador.antes).toBeGreaterThanOrEqual(agora);

    // O prefixo das sessões não enxerga o marcador, e ele leva expiração (~25 h).
    const sessoes = await env.FOTOS.list({ prefix: 'admin_session:' });
    expect(sessoes.keys.map(k => k.name)).toEqual([chave(DONO)]);
    const [deCorte] = (await env.FOTOS.list({ prefix: 'admin_sessions_corte' })).keys;
    expect(deCorte.expiration, 'o marcador expira').toBeGreaterThan(Date.now() / 1000 + 24 * 3600);
    expect(deCorte.expiration).toBeLessThanOrEqual(Date.now() / 1000 + 25 * 3600 + 5);

    // A sessão mais velha que o corte, mas de quem pediu, segue entrando.
    expect((await pede('/api/categories', DONO)).status).toBe(200);
  });

  it('o registro posto de volta (ressurreição) continua recusado', async () => {
    const agora = Date.now();
    await env.FOTOS.put(chave(DONO), sessao(agora - 3 * 3600_000), { expirationTtl: 86400 });
    await pede('/api/sessions/revoke-others', DONO, 'POST');

    await env.FOTOS.put(chave(LADRAO), sessao(agora - 2 * 3600_000), { expirationTtl: 86400 });
    expect((await pede('/api/categories', LADRAO)).status).toBe(401);
    expect(await env.FOTOS.get(chave(LADRAO)), 'e o registro é apagado de novo').toBeNull();
  });

  it('uma sessão aberta depois do corte entra', async () => {
    await env.FOTOS.put(chave(DONO), sessao(Date.now() - 3600_000), { expirationTtl: 86400 });
    await pede('/api/sessions/revoke-others', DONO, 'POST');
    await env.FOTOS.put(chave(LADRAO), sessao(Date.now() + 5000), { expirationTtl: 86400 });
    expect((await pede('/api/categories', LADRAO)).status).toBe(200);
  });
});
