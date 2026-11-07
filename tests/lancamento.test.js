// Lançamento do álbum (v3.5): o botão "Lançar agora…" e o lançamento marcado
// (`lancarEm`), com a contagem regressiva opcional na página "em breve". O
// álbum é SURPRESA até a hora, então o que estes testes prendem é, antes de
// tudo, o que NÃO aparece:
//  1. antes da hora, nada do álbum é público: nem a galeria, nem a página do
//     projeto (/entrenos2026, só para álbum com domínio próprio), nem a data
//     marcada em página ou API nenhuma; a contagem só com o interruptor;
//  2. na hora, o álbum vale como lançado em todo o site ao mesmo tempo (a troca
//     é na leitura, getEvents), sem tarefa agendada;
//  3. o painel nunca lança sem querer: data no passado não lança, restaurar
//     backup não lança, e o formulário aberto desde antes da hora não desfaz o
//     lançamento ao salvar.
import { describe, it, expect, vi, afterEach } from 'vitest';
import { comLancamentos, albumSurpresa, albumLancado } from '../src/utils.js';
import { normalizaLancamento, normalizeEventFields, sanitizeRestoredEvent } from '../src/index.js';
import { emBreveHTML, dataDoLancamento, SCRIPT_CONTAGEM } from '../src/ui/em-breve.js';
import { dashboardHTML } from '../src/ui/dashboard.js';
import { LANCAMENTO_MAX_DIAS } from '../src/config.js';
import { withDurableObjects } from './helpers/do.js';

const AGORA = Date.parse('2026-11-07T15:00:00.000Z');
const DAQUI_A = (/** @type {number} */ min) => new Date(AGORA + min * 60000).toISOString();
const ALBUM = {
  id: '1', slug: 'entrenos2026', title: 'Entre Nós · Turma 2026', accessType: 'public', galeriaCapitulos: true, destaqueMaximo: true,
  driveUrl: 'https://drive.google.com/drive/folders/RAIZ_PASTA_0001', galeriaAbertura: 'Oi, turma.',
  comingSoon: true, visible: false, pinned: false, lancarEm: '', lancarContagem: false,
};
const OUTRO = { id: '2', slug: 'festa-x', title: 'Festa X', accessType: 'public', comingSoon: true, visible: false, driveUrl: 'https://drive.google.com/drive/folders/OUTRA_PASTA_001' };
const ctx = { waitUntil() {} };
const TOKEN = 'e'.repeat(64);
function kv(/** @type {any[]} */ eventos) {
  const store = new Map([['events', JSON.stringify(eventos)], [`admin_session:${TOKEN}`, JSON.stringify({ createdAt: Date.now() })]]);
  return { async get(/** @type {string} */ k) { return store.has(k) ? store.get(k) : null; }, async put(/** @type {string} */ k, /** @type {string} */ v) { store.set(k, v); },
    async delete() {}, async list() { return { keys: [], list_complete: true, cursor: null }; } };
}
async function frio() {
  vi.resetModules();
  return (await import('../src/index.js')).default;
}
/** @param {any[]} eventos @param {string} url @param {boolean} [dono] */
async function pede(eventos, url, dono = false) {
  const w = await frio();
  /** @type {Record<string, string>} */
  const headers = { 'CF-Connecting-IP': '203.0.113.7' };
  if (dono) headers.Cookie = `__Host-session=${TOKEN}`;
  return w.fetch(new Request(url, { headers }), withDurableObjects({ FOTOS: kv(eventos) }), ctx);
}
afterEach(() => { vi.useRealTimers(); });

describe('a troca na hora (comLancamentos)', () => {
  it('antes da hora: a MESMA lista, sem cópia', () => {
    const lista = [{ ...ALBUM, lancarEm: DAQUI_A(60) }, OUTRO];
    expect(comLancamentos(/** @type {any} */ (lista), AGORA)).toBe(lista);
    expect(comLancamentos(/** @type {any} */ ([{ ...ALBUM, lancarEm: 'lixo' }]), AGORA)[0].comingSoon).toBe(true);
  });

  it('na hora: fora do "Em breve", visível, fixado, e sem a data (a próxima gravação torna permanente)', () => {
    const [a, o] = comLancamentos(/** @type {any} */ ([{ ...ALBUM, lancarEm: DAQUI_A(0), lancarContagem: true }, OUTRO]), AGORA);
    expect(a).toMatchObject({ comingSoon: false, visible: true, pinned: true, lancarEm: '', lancarContagem: false, destaqueMaximo: true });
    expect(albumLancado(/** @type {any} */ (a))).toBe(true);
    expect(o).toBe(OUTRO);
  });

  it('getEvents troca sozinho quando o relógio passa da hora', async () => {
    vi.useFakeTimers({ now: AGORA, toFake: ['Date'] });
    vi.resetModules();
    const { getEvents } = await import('../src/utils.js');
    const env = /** @type {any} */ ({ FOTOS: kv([{ ...ALBUM, lancarEm: DAQUI_A(30) }]) });
    expect((await getEvents(env))[0].comingSoon).toBe(true);
    vi.setSystemTime(AGORA + 31 * 60000);
    // Mesmo com a lista no cache do isolate.
    expect((await getEvents(env))[0]).toMatchObject({ comingSoon: false, visible: true });
    expect((await getEvents(env, true))[0].lancarEm).toBe('');
  });
});

describe('surpresa: nada aparece antes da hora', () => {
  const marcado = { ...ALBUM, lancarEm: '2099-11-20T23:00:00.000Z' };

  it('a página do projeto do álbum é 404 para o público; o dono vê; outro projeto "Em breve" segue como sempre', async () => {
    expect(albumSurpresa(/** @type {any} */ (marcado))).toBe(true);
    expect(albumSurpresa(/** @type {any} */ (OUTRO))).toBe(false);
    const pub = await pede([marcado, OUTRO], 'https://fotos.lucafchala.com/entrenos2026');
    expect(pub.status).toBe(404);
    expect(await pub.text()).not.toContain('Entre Nós');
    // O dono passa; e a página de álbum com apresentação leva à galeria (v3.7).
    const doDono = await pede([marcado], 'https://fotos.lucafchala.com/entrenos2026', true);
    expect(doDono.status).toBe(302);
    expect(doDono.headers.get('Location')).toBe('/galeria/entrenos2026');
    expect((await pede([marcado, OUTRO], 'https://fotos.lucafchala.com/festa-x')).status).toBe(200);
    expect((await pede([marcado], 'https://fotos.lucafchala.com/galeria/entrenos2026')).status).toBe(404);
  });

  it('a data marcada não sai em página nem API pública', async () => {
    for (const url of ['https://fotos.lucafchala.com/', 'https://fotos.lucafchala.com/api/recentes', 'https://fotos.lucafchala.com/api/destaque', 'https://entrenos2026.com/', 'https://fotos.lucafchala.com/sitemap.xml']) {
      const t = await (await pede([marcado, OUTRO], url)).text();
      expect(t, url).not.toContain('2099');
      expect(t, url).not.toContain('lancarEm');
    }
  });

  it('"em breve": sem o interruptor, nem data nem script; com ele, a contagem com nonce e sem cache', async () => {
    let res = await pede([marcado], 'https://entrenos2026.com/');
    let h = await res.text();
    expect(h).toContain('O álbum da turma está chegando');
    expect(h).not.toMatch(/<script|Chega em/);
    expect(res.headers.get('Cache-Control')).toBe('public, max-age=60');

    res = await pede([{ ...marcado, lancarContagem: true }], 'https://entrenos2026.com/');
    h = await res.text();
    expect(h).toContain('Chega em 20 de novembro, às 20h.');
    const nonce = h.match(/<script nonce="([^"]+)">/)?.[1];
    expect(nonce).toBeTruthy();
    expect(res.headers.get('Content-Security-Policy')).toContain(`'nonce-${nonce}'`);
    expect(res.headers.get('Cache-Control')).toBe('no-cache');
    expect(h).toContain('data-ate="2099-11-20T23:00:00.000Z"');
  });

  it('na hora, o domínio mostra a galeria (sem esperar ninguém)', async () => {
    vi.useFakeTimers({ now: AGORA, toFake: ['Date'] });
    const res = await pede([{ ...ALBUM, lancarEm: DAQUI_A(-1) }], 'https://entrenos2026.com/');
    expect(res.headers.get('Location')).toBeNull();
    expect(await res.text()).not.toContain('O álbum da turma está chegando');
  });
});

describe('o painel não lança sem querer', () => {
  const base = { ...ALBUM };
  it('data futura: guardada em ISO; longe demais, inválida ou vazia: nada', () => {
    expect(normalizaLancamento({ lancarEm: '2026-11-20T20:00:00-03:00' }, base, AGORA).lancarEm).toBe('2026-11-20T23:00:00.000Z');
    expect(normalizaLancamento({ lancarEm: new Date(AGORA + (LANCAMENTO_MAX_DIAS + 1) * 864e5).toISOString() }, base, AGORA).lancarEm).toBe('');
    for (const v of ['lixo', '', '2026-13-40']) expect(normalizaLancamento({ lancarEm: v }, base, AGORA).lancarEm).toBe('');
  });

  it('data no passado NÃO lança (engano de digitação)', () => {
    const out = normalizaLancamento({ lancarEm: DAQUI_A(-60), comingSoon: true, visible: false, lancarContagem: true }, base, AGORA);
    expect(out).toMatchObject({ lancarEm: '', comingSoon: true, visible: false, lancarContagem: false });
  });

  it('formulário aberto desde antes da hora: salvar não devolve ao "Em breve"', () => {
    const lancado = { ...ALBUM, comingSoon: false, visible: true, pinned: true };
    const out = normalizaLancamento({ lancarEm: DAQUI_A(-5), comingSoon: true, visible: false, pinned: false }, lancado, AGORA);
    expect(out).toMatchObject({ comingSoon: false, visible: true, pinned: true, lancarEm: '' });
  });

  it('normalizeEventFields passa pelo mesmo crivo; o contador só com true', () => {
    const fut = new Date(Date.now() + 864e5).toISOString();
    expect(normalizeEventFields({ lancarEm: fut, lancarContagem: 'sim' }, { slug: 'x' }, [])).toMatchObject({ lancarEm: fut, lancarContagem: false });
    expect(normalizeEventFields({}, { slug: 'x' }, []).lancarEm).toBe('');
  });

  it('restaurar backup nunca lança: data vencida vira vazio', () => {
    expect(sanitizeRestoredEvent({ ...ALBUM, lancarEm: '2020-01-01T00:00:00Z', lancarContagem: 'x' })).toMatchObject({ lancarEm: '', lancarContagem: false, comingSoon: true });
    const fut = new Date(Date.now() + 864e5).toISOString();
    expect(sanitizeRestoredEvent({ ...ALBUM, lancarEm: fut }).lancarEm).toBe(fut);
  });
});

describe('a página "em breve" e o painel', () => {
  it('a data em português, no horário de Brasília', () => {
    expect(dataDoLancamento('2026-11-20T23:00:00Z')).toBe('20 de novembro, às 20h');
    expect(dataDoLancamento('2026-12-01T00:30:00Z')).toBe('30 de novembro, às 21h30');
    expect(dataDoLancamento('lixo')).toBe('');
  });

  it('a contagem é JS válido; sem nonce ou com a data passada, não aparece', () => {
    expect(() => new Function(SCRIPT_CONTAGEM)).not.toThrow();
    expect(SCRIPT_CONTAGEM).not.toMatch(/innerHTML|document\.write/);
    const p = { titulo: 'Entre Nós', linha: 'Turma 2026' };
    expect(emBreveHTML({ ...p, contagem: '2099-01-01T00:00:00Z' })).not.toContain('<script');
    expect(emBreveHTML({ ...p, contagem: '2020-01-01T00:00:00Z', nonce: 'N' })).not.toContain('<script');
  });

  it('o painel: campos, selo com a data, "Lançar agora…" só para o que não foi lançado', () => {
    const marcado = { ...ALBUM, lancarEm: '2099-11-20T23:00:00.000Z' };
    const lancado = { ...OUTRO, id: '3', slug: 'no-ar', comingSoon: false, visible: true };
    const h = dashboardHTML(/** @type {any} */ ([marcado, lancado]), [], 'N');
    expect(h).toContain('<input type="datetime-local" id="f-lancar-em" aria-describedby="dica-lancar">');
    expect(h).toContain('<input type="checkbox" id="f-lancar-contagem" aria-describedby="dica-lancar-contagem">');
    expect(h).toContain('Lança 20/11, 20:00');
    expect(h.match(/data-action="lancar"/g)).toHaveLength(1);
    expect(h).toContain("typeToConfirm: 'LANÇAR'");
    expect(h).toContain("{ comingSoon: false, visible: true, pinned: true, lancarEm: '', lancarContagem: false }");
    expect(h).toContain('lancarEm: lancarEmISO,');
    expect(h).toContain("lancarEm: val('f-lancar-em'), lancarContagem: chk('f-lancar-contagem')");
  });
});
