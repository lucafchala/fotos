// O teto de e-mails do dia (v3.8.9; revisão de nov/2026, achado 11).
//
// Era um balde de 90 que repunha 90 por dia: cheio de manhã, deixava sair perto
// de 180 nas primeiras 24 horas, e o código por e-mail e os alertas ficavam de
// fora. O Resend grátis recusa a partir do centésimo do dia. O que estes testes
// prendem:
//  1. é uma janela FIXA: no mesmo dia (UTC) nunca sai mais que o teto, por mais
//     que o tempo passe; vira à meia-noite UTC;
//  2. TODO envio conta nela — o código por e-mail e os alertas também;
//  3. os alertas ao dono têm vagas que o resto do site não gasta.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { cotaDeEmail, sendErrorAlert, sendLoginAlert } from '../src/utils.js';
import { EMAIL_TETO_DIA, EMAIL_RESERVA_ALERTAS } from '../src/config.js';
import { withDurableObjects } from './helpers/do.js';

const COMUM = EMAIL_TETO_DIA - EMAIL_RESERVA_ALERTAS;
/** @param {any} env @param {number} n @param {'comum' | 'alerta'} [classe] */
async function pede(env, n, classe) {
  let sim = 0;
  for (let i = 0; i < n; i++) if (await cotaDeEmail(env, classe)) sim++;
  return sim;
}

beforeEach(() => { vi.useFakeTimers({ toFake: ['Date'] }); vi.setSystemTime(new Date('2026-11-20T00:00:05Z')); });
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });

describe('o teto de e-mails do dia', () => {
  it('cabe na franquia do Resend, com folga para o envio manual do dono', () => {
    expect(EMAIL_TETO_DIA).toBeLessThanOrEqual(90);
    expect(EMAIL_RESERVA_ALERTAS).toBeGreaterThanOrEqual(5);
    expect(COMUM).toBeGreaterThan(0);
  });

  it('janela fixa: no mesmo dia não sai mais que o teto, mesmo 23 horas depois (o balde repunha)', async () => {
    const env = /** @type {any} */ (withDurableObjects({}));
    expect(await pede(env, COMUM + 5)).toBe(COMUM);
    // O balde antigo teria reposto ~86 fichas até aqui.
    vi.setSystemTime(new Date('2026-11-20T23:00:00Z'));
    expect(await pede(env, 50)).toBe(0);
    // Virou o dia (UTC): a janela é outra.
    vi.setSystemTime(new Date('2026-11-21T00:00:01Z'));
    expect(await pede(env, COMUM + 5)).toBe(COMUM);
  });

  it('os alertas têm vagas que o resto do site não gasta, e o total do dia não passa do teto', async () => {
    const env = /** @type {any} */ (withDurableObjects({}));
    expect(await pede(env, 500)).toBe(COMUM);
    expect(await pede(env, 500, 'alerta')).toBe(EMAIL_RESERVA_ALERTAS);
    expect(await pede(env, 10)).toBe(0);
  });

  it('num dia calmo os alertas usam o que sobrou, até o teto', async () => {
    const env = /** @type {any} */ (withDurableObjects({}));
    expect(await pede(env, 500, 'alerta')).toBe(EMAIL_TETO_DIA);
    expect(await pede(env, 10)).toBe(0);
  });

  it('o alerta de erro só gasta vaga quando MANDA (a trava de tempo vem antes)', async () => {
    const mandados = vi.fn(async () => Response.json({ id: 'x' }));
    vi.stubGlobal('fetch', mandados);
    const store = new Map();
    const env = /** @type {any} */ (withDurableObjects({ RESEND_API_KEY: 're_x', ADMIN_EMAIL: 'dono@site.test', FOTOS: { async get(/** @type {string} */ k) { return store.get(k) ?? null; }, async put(/** @type {string} */ k, /** @type {string} */ v) { store.set(k, v); } } }));
    // Uma onda de 200 erros: um e-mail, uma vaga.
    for (let i = 0; i < 200; i++) await sendErrorAlert(env, new Error('x'), { path: '/x' });
    expect(mandados).toHaveBeenCalledTimes(1);
    expect(await pede(env, 500, 'alerta')).toBe(EMAIL_TETO_DIA - 1);
  });

  it('o alerta de login conta no teto', async () => {
    const mandados = vi.fn(async () => Response.json({ id: 'x' }));
    vi.stubGlobal('fetch', mandados);
    const env = /** @type {any} */ (withDurableObjects({ RESEND_API_KEY: 're_x', ADMIN_EMAIL: 'dono@site.test', FOTOS: { async get() { return null; }, async put() {} } }));
    expect(await pede(env, 500, 'alerta')).toBe(EMAIL_TETO_DIA);
    await sendLoginAlert(env, { ip: '203.0.113.1', attempts: 5, windowMins: 15 });
    expect(mandados).not.toHaveBeenCalled();
  });
});

describe('o código por e-mail conta no teto do site', () => {
  it('com o teto do dia gasto, o código não é enviado', async () => {
    vi.useRealTimers();
    const mandados = vi.fn(async (/** @type {any} */ input) => (String(input).includes('resend') ? Response.json({ id: 'x' }) : Response.json({ success: true })));
    vi.stubGlobal('fetch', mandados);
    const store = new Map();
    const FOTOS = { async get(/** @type {string} */ k) { return store.get(k) ?? null; }, async put(/** @type {string} */ k, /** @type {string} */ v) { store.set(k, v); }, async delete() {}, async list() { return { keys: [], list_complete: true, cursor: null }; } };
    const env = /** @type {any} */ (withDurableObjects({ FOTOS, RESEND_API_KEY: 're_x', ADMIN_EMAIL: 'dono@site.test', SIGNING_SECRET: 's'.repeat(48), TURNSTILE_SECRET_KEY: 'ts' }));
    const { saveEvents } = await import('../src/utils.js');
    await saveEvents(env, [{ id: '1', slug: 'projeto-comum', title: 'Projeto', accessType: 'public', gate: 'email', driveUrl: 'https://drive.google.com/drive/folders/RAIZ_PASTA_0001' }]);
    const { handleDriveCode, mintDriveNonce } = await import('../src/index.js');
    const pedeCodigo = async (/** @type {string} */ email) => handleDriveCode(new Request('https://fotos.lucafchala.com/api/drive-code', {
      method: 'POST', headers: { 'Content-Type': 'application/json', 'CF-Connecting-IP': '203.0.113.9' },
      body: JSON.stringify({ slug: 'projeto-comum', email, driveNonce: await mintDriveNonce(env, 'projeto-comum') }),
    }), env, /** @type {any} */ ({ waitUntil() {} }));
    const primeiro = await pedeCodigo('alguem@exemplo.test');
    // Se a rota do código recusar por outro motivo neste cenário, o teste não prova nada.
    expect(primeiro.status, await primeiro.clone().text()).toBe(200);
    const antes = mandados.mock.calls.filter(c => String(c[0]).includes('resend')).length;
    expect(antes).toBe(1);
    // O resto do site gasta o teto do dia.
    await pede(env, 500);
    const res = await pedeCodigo('outra@exemplo.test');
    expect(res.status).toBe(503);
    expect(mandados.mock.calls.filter(c => String(c[0]).includes('resend')).length).toBe(antes);
  });
});
