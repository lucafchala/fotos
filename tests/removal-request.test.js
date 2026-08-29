import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { handleRemovalRequest } from '../src/index.js';
import { degradedHealth, resetDegraded } from '../src/utils.js';
import { withDurableObjects } from './helpers/do.js';

// O formulário de remoção é o canal por onde um titular exerce um direito da
// LGPD, com prazo correndo. O que estes testes travam não é o caminho feliz —
// é o que acontece quando o KV cai por baixo dele. Antes, qualquer falha de
// leitura ou escrita subia até o `catch` do roteador e virava a página 500
// genérica: o pedido sumia inteiro, sem registro em lugar nenhum e sem que
// ninguém fosse avisado. Perder pedido de titular por indisponibilidade de
// banco é negar o direito por motivo nosso.

function fakeKV(initial = {}) {
  const store = new Map(Object.entries(initial));
  return {
    async get(k) { return store.has(k) ? store.get(k) : null; },
    async put(k, v) { store.set(k, v); },
    async delete(k) { store.delete(k); },
    _store: store,
  };
}

// KV que recusa tudo — a queda total, que é o cenário em que o pedido corria
// risco de sumir.
const kvDown = () => ({
  async get() { throw new Error('KV GET failed: 503'); },
  async put() { throw new Error('KV PUT failed: 503'); },
});

// Distingue as duas chamadas externas do fluxo: o siteverify do Turnstile e o
// envio pela Resend. Um stub que devolvesse a mesma coisa para as duas faria o
// teste passar por motivo errado.
function fetchStub({ turnstile = true, resendOk = true } = {}) {
  return vi.fn(async url => {
    const u = String(url);
    if (u.includes('challenges.cloudflare.com')) {
      return new Response(JSON.stringify({ success: turnstile }), { status: 200 });
    }
    if (u.includes('api.resend.com')) {
      return resendOk
        ? new Response(JSON.stringify({ id: 'msg_1' }), { status: 200 })
        : new Response('service unavailable', { status: 503 });
    }
    throw new Error('fetch inesperado: ' + u);
  });
}

const BODY = {
  eventSlug: 'casamento-ana',
  method: 'number',
  value: 'IMG_0042',
  email: 'ana@example.com',
  phone: '11989211178',
  message: 'Gostaria de remover esta foto.',
  consent: true,
  turnstileToken: 'tok',
  company_website: '',
};

function req(extra = {}) {
  return new Request('https://fotos.lucafchala.com/api/removal-request', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'CF-Connecting-IP': '1.2.3.4' },
    body: JSON.stringify({ ...BODY, ...extra }),
  });
}

// SIGNING_SECRET fica de fora de propósito: sem ele o token de formulário é
// pulado, e o que estes testes exercitam é o registro do pedido, não a
// verificação de origem (essa já tem cobertura própria).
const baseEnv = (extra = {}) => withDurableObjects({
  FOTOS: fakeKV(),
  TURNSTILE_SECRET_KEY: 'secret',
  RESEND_API_KEY: 'resend-key',
  ...extra,
});

// Isolate frio: `getEvents` guarda a lista num cache de módulo, e um teste
// anterior que leu com KV são deixaria a queda passar despercebida aqui.
async function coldHandler() {
  vi.resetModules();
  const index = await import('../src/index.js');
  const utils = await import('../src/utils.js');
  utils.resetDegraded();
  return { handle: index.handleRemovalRequest, degraded: utils.degradedHealth };
}

describe('handleRemovalRequest', () => {
  beforeEach(() => {
    resetDegraded();
    vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.stubGlobal('fetch', fetchStub());
  });
  afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); resetDegraded(); });

  it('grava o pedido no painel e avisa por e-mail', async () => {
    const env = baseEnv();
    const res = await handleRemovalRequest(req(), env);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });

    const [stored] = JSON.parse(env.FOTOS._store.get('removal_requests'));
    expect(stored).toMatchObject({
      eventSlug: 'casamento-ana',
      email: 'ana@example.com',
      resolved: false,
      emailStatus: 'sent',
      confirmEmailStatus: 'sent',
    });
    expect(degradedHealth()).toEqual([]);
  });

  it('com o KV fora, o pedido ainda sai por e-mail em vez de virar 500', async () => {
    // O e-mail não passa pelo KV, então continua sendo um registro válido: o
    // dono é avisado, o titular recebe confirmação e o prazo começa a correr.
    // Devolver erro aqui só faria a pessoa reenviar tudo de novo.
    const { handle, degraded } = await coldHandler();
    const env = withDurableObjects({
      FOTOS: kvDown(), TURNSTILE_SECRET_KEY: 'secret', RESEND_API_KEY: 'resend-key',
    });

    const res = await handle(req(), env);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, stored: false });

    const enviados = globalThis.fetch.mock.calls.filter(([u]) => String(u).includes('api.resend.com'));
    expect(enviados).toHaveLength(2); // aviso ao dono + confirmação ao titular
    expect(enviados[0][1].body).toContain('casamento-ana');

    // Falhar sem barulho seria o mesmo defeito de outro jeito: o pedido não
    // está no painel, e o dono precisa saber disso pelo healthz.
    expect(degraded().map(d => d.label)).toContain('pedido de remoção não gravado no painel');
  });

  it('sem KV e sem e-mail, responde 503 com o caminho alternativo — nunca sucesso falso', async () => {
    // Aqui o pedido realmente não existe em lugar nenhum. Fingir `ok` mandaria
    // a pessoa embora achando que exerceu um direito que ninguém registrou.
    const { handle } = await coldHandler();
    const env = withDurableObjects({ FOTOS: kvDown(), TURNSTILE_SECRET_KEY: 'secret' });

    const res = await handle(req(), env);
    expect(res.status).toBe(503);
    expect(res.headers.get('content-type')).toContain('application/json');
    const { error } = await res.json();
    expect(error).toContain('privacidade@lucafchala.com');
  });

  it('uma falha na segunda gravação não tira o sucesso de quem pediu', async () => {
    // A segunda escrita só carimba o status dos e-mails. O pedido já está
    // gravado pela primeira, e perder o carimbo não vale um erro na tela.
    const kv = fakeKV();
    let puts = 0;
    const original = kv.put.bind(kv);
    kv.put = async (k, v) => { if (++puts > 1) throw new Error('KV PUT failed: 503'); return original(k, v); };

    const res = await handleRemovalRequest(req(), baseEnv({ FOTOS: kv }));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
    expect(JSON.parse(kv._store.get('removal_requests'))).toHaveLength(1);
    expect(degradedHealth().map(d => d.label)).toContain('status de e-mail do pedido de remoção não gravado');
  });

  it('registra a falha de e-mail sem derrubar o pedido', async () => {
    vi.stubGlobal('fetch', fetchStub({ resendOk: false }));
    const env = baseEnv();
    const res = await handleRemovalRequest(req(), env);
    expect(res.status).toBe(200);

    const [stored] = JSON.parse(env.FOTOS._store.get('removal_requests'));
    expect(stored.emailStatus).toMatch(/^error: Resend 503/);
    expect(degradedHealth().map(d => d.label)).toContain('pedido de remoção sem aviso por e-mail');
  });

  it('continua recusando o que já recusava — a degradação não abriu porta', async () => {
    const env = baseEnv();
    const semConsentimento = await handleRemovalRequest(req({ consent: false }), env);
    expect(semConsentimento.status).toBe(400);

    const slugInvalido = await handleRemovalRequest(req({ eventSlug: '../etc/passwd' }), env);
    expect(slugInvalido.status).toBe(400);

    vi.stubGlobal('fetch', fetchStub({ turnstile: false }));
    const semTurnstile = await handleRemovalRequest(req(), env);
    expect(semTurnstile.status).toBe(403);

    expect(env.FOTOS._store.has('removal_requests')).toBe(false);
  });
});
