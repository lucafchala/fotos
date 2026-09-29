// #192 — o runtime do Workers roda em UTC; o dono e os visitantes estão em
// São Paulo. Os testes fixam o relógio num instante em que UTC já virou o dia
// e São Paulo não (22:30 de 25/09 em SP = 01:30 de 26/09 em UTC) — o horário
// exato em que os três defeitos apareciam.

import { describe, it, expect, vi, afterEach } from 'vitest';
import { hojeEmSaoPaulo, dataHoraBR, sendErrorAlert } from '../src/utils.js';
import { eventHTML } from '../src/ui/event.js';
import { dashboardHTML } from '../src/ui/dashboard.js';

const NOITE_EM_SP = new Date('2026-09-26T01:30:00Z'); // 25/09, 22:30 em São Paulo

afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });

describe('hojeEmSaoPaulo / dataHoraBR', () => {
  it('às 22:30 de São Paulo ainda é o mesmo dia, mesmo com UTC no dia seguinte', () => {
    expect(NOITE_EM_SP.toISOString().slice(0, 10)).toBe('2026-09-26');
    expect(hojeEmSaoPaulo(NOITE_EM_SP)).toBe('2026-09-25');
    expect(hojeEmSaoPaulo(new Date('2026-09-26T03:00:00Z'))).toBe('2026-09-26');
  });
  it('dataHoraBR escreve a hora de São Paulo com o fuso, e vazio para data ilegível', () => {
    const s = dataHoraBR(NOITE_EM_SP);
    expect(s).toContain('25/09/2026');
    expect(s).toContain('22:30');
    expect(s).toMatch(/BRT|GMT-3|UTC-3/);
    expect(dataHoraBR('lixo')).toBe('');
  });
});

describe('os três lugares do #192', () => {
  it('"Atrasado" não aparece na noite do próprio dia prometido', () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(NOITE_EM_SP);
    const base = { id: 'a', slug: 'a', title: 'A', status: 'em-edicao' };
    // O script do cliente também carrega a marcação do selo; o que muda com a
    // data é quantas vezes ela aparece (o SSR soma uma quando está atrasado).
    const selos = (/** @type {string} */ html) => html.split('st-atrasado">Atrasado').length - 1;
    const semPrazo = selos(dashboardHTML([base], [], 'N'));
    expect(selos(dashboardHTML([{ ...base, promisedDate: '2026-09-25' }], [], 'N'))).toBe(semPrazo);
    expect(selos(dashboardHTML([{ ...base, promisedDate: '2026-09-24' }], [], 'N'))).toBe(semPrazo + 1);
  });

  it('"Em breve": na véspera e no próprio dia, a página ainda diz "adiantando"', () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(NOITE_EM_SP);
    const ev = { id: 'a', slug: 'a', title: 'A', comingSoon: true, accessType: 'public', photos: [] };
    expect(eventHTML({ ...ev, date: '2026-09-26' }, '2026', null)).toContain('adiantando');
    expect(eventHTML({ ...ev, date: '2026-09-25' }, '2026', null)).toContain('adiantando');
    expect(eventHTML({ ...ev, date: '2026-09-24' }, '2026', null)).toContain('ainda não estão prontas');
  });

  it('o e-mail de alerta sai com a hora de São Paulo', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(NOITE_EM_SP);
    /** @type {string[]} */
    const corpos = [];
    vi.stubGlobal('fetch', vi.fn(async (_u, init) => { corpos.push(String(init.body)); return new Response('{}'); }));
    const env = { RESEND_API_KEY: 're_x', ADMIN_EMAIL: 'dono@example.com', FOTOS: { get: async () => null, put: async () => {} } };
    await sendErrorAlert(env, new Error('teste'), { path: '/x', method: 'GET' });
    expect(corpos.join('')).toContain('25/09/2026');
    expect(corpos.join('')).not.toContain('26/09/2026');
  });
});
