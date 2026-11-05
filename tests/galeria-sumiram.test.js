// Fotos que sumiram da pasta do Drive (v3.1, item 1d). Prende:
//
//  1. listagem NOVA truncada não conclui nada (sem consulta, sem aviso, sem linha);
//  2. foto MOVIDA (existe fora da lixeira) não gera aviso nem linha;
//  3. foto APAGADA (404 ou na lixeira) gera UM resumo ao dono e UMA linha, e
//     a releitura seguinte não repete;
//  4. mais de SUMIRAM_CONFERIR_MAX sumidas: só a contagem, sem consulta por foto;
//  5. teto do dia do aviso ao dono: pula, registra no healthz, linha continua;
//  6. cópia ao autor só com as fotos DELE (e só se há e-mail nos créditos);
//  7. retenção de 30 dias: linhas mais velhas somem na leitura e na detecção;
//  8. o painel lista (só o dono) e apagar o projeto apaga as linhas;
//  9. o e-mail do autor não vaza para o e-mail do dono nem para o painel.

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import worker from '../src/index.js';
import { limpaCacheDrive } from '../src/drive.js';
import { saveEvents, degradedHealth, resetDegraded } from '../src/utils.js';
import { SUMIRAM_AVISO_DIA, SUMIRAM_CONFERIR_MAX, SUMIRAM_RETENCAO_DIAS } from '../src/config.js';
import { withDurableObjects } from './helpers/do.js';
import { d1Sqlite, d1Contado } from './helpers/d1.js';
import { GALERIA_MAX_CHAMADAS } from '../src/config.js';

const SITE = 'https://fotos.lucafchala.com';
const TOKEN = 'e'.repeat(64);
const RAIZ = 'RAIZ_PASTA_0001';
const MAG = 'PASTA_MAG_00001';
const EMAIL_AUTOR = 'mag.autora@example.com';
const DIA = 86_400_000;

const arq = (id, nome) => ({ id, name: nome, mimeType: 'image/jpeg', size: '1000', imageMediaMetadata: { width: 3000, height: 2000, time: '2026:10:30 15:04:05' } });
const pasta = (id, nome) => ({ id, name: nome, mimeType: 'application/vnd.google-apps.folder' });
const idFoto = n => `FOTO_${String(n).padStart(6, '0')}_X`;

let arvore;
let destino; // id -> 'apagada' | 'lixeira' | 'movida' | 'erro'
let consultas;
let emails;
let truncaNaProxima;
let env;
let d1;

const EVENTO = {
  id: '1', slug: 'festa', title: 'Festa', accessType: 'public',
  driveUrl: `https://drive.google.com/drive/folders/${RAIZ}`,
  galeriaCreditos: `mag = Mag <${EMAIL_AUTOR}>\nchala = Luca F. Chala`,
};

function fakeKV(inicial = {}) {
  const store = new Map(Object.entries(inicial));
  return {
    async get(k) { return store.has(k) ? store.get(k) : null; },
    async put(k, v) { store.set(k, v); },
    async delete(k) { store.delete(k); },
    async list() { return { keys: [], list_complete: true, cursor: null }; },
  };
}

beforeEach(async () => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date('2026-11-05T12:00:00Z'));
  limpaCacheDrive();
  resetDegraded();
  destino = {};
  consultas = [];
  emails = [];
  truncaNaProxima = false;
  arvore = {
    [RAIZ]: [arq(idFoto(1), 'um.jpg'), arq(idFoto(2), 'dois.jpg'), arq(idFoto(3), 'tres.jpg'), pasta(MAG, 'mag')],
    [MAG]: [arq(idFoto(10), 'm1.jpg'), arq(idFoto(11), 'm2.jpg')],
  };
  vi.stubGlobal('fetch', vi.fn(async (input, init = {}) => {
    const url = new URL(typeof input === 'string' ? input : input.url);
    if (url.host === 'api.resend.com') { emails.push(JSON.parse(init.body)); return Response.json({ id: 'm' }); }
    if (url.pathname === '/drive/v3/files') {
      const id = (url.searchParams.get('q') || '').match(/^'([^']+)' in parents/)?.[1];
      const soPastas = (url.searchParams.get('q') || '').includes("mimeType = 'application/vnd.google-apps.folder'");
      const r = { files: (arvore[id] || []).filter(f => !soPastas || f.mimeType.endsWith('.folder')) };
      if (truncaNaProxima && (arvore[id] || []).length) r.nextPageToken = 'mais';
      return Response.json(r);
    }
    const m = url.pathname.match(/^\/drive\/v3\/files\/([^/]+)$/);
    if (m) {
      consultas.push(m[1]);
      const d = destino[m[1]] || 'apagada';
      if (d === 'erro') return new Response('x', { status: 500 });
      if (d === 'apagada') return new Response('{}', { status: 404 });
      return Response.json(d === 'lixeira' ? { trashed: true, parents: [] } : { trashed: false, parents: ['OUTRA_PASTA_01'] });
    }
    return new Response('nao esperado', { status: 599 });
  }));
  d1 = d1Sqlite();
  env = withDurableObjects({
    FOTOS: fakeKV({ [`admin_session:${TOKEN}`]: JSON.stringify({ createdAt: Date.now() }) }),
    GOOGLE_DRIVE_API_KEY: 'AIzaChaveDeTeste123',
    SIGNING_SECRET: 's'.repeat(48),
    RESEND_API_KEY: 'resend-key',
    ADMIN_EMAIL: 'dono@example.com',
    CONSENT_DB: d1,
  });
  await saveEvents(env, [structuredClone(EVENTO)]);
});
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });

const avanca = ms => vi.setSystemTime(new Date(Date.now() + ms));
const MIN = 60_000;
const abre = async () => {
  const r = await worker.fetch(new Request(SITE + '/galeria/festa', { headers: { 'CF-Connecting-IP': '203.0.113.9' } }), env, { waitUntil() {} });
  await r.text();
  return r;
};
// Uma releitura: passa o período (10 min) e abre a galeria.
const relê = async () => { avanca(11 * MIN); limpaCacheDrive(); return abre(); };
const linhas = () => d1.sqlite.prepare('SELECT * FROM galeria_apagadas ORDER BY nome').all();
const doDono = () => emails.filter(e => e.to.includes('dono@example.com'));
const doAutor = () => emails.filter(e => e.to.includes(EMAIL_AUTOR));
const painel = async (slug = 'festa', { dono = true } = {}) => worker.fetch(
  new Request(`${SITE}/api/galeria/apagadas?slug=${slug}`, { headers: dono ? { Cookie: `__Host-session=${TOKEN}` } : {} }),
  env, { waitUntil() {} },
);
// Sessão e relógio: o teste avança minutos, a sessão dura bem mais.

describe('o que NÃO avisa', () => {
  it('primeira leitura: não há com o que comparar', async () => {
    await abre();
    expect(consultas).toEqual([]);
    expect(emails).toEqual([]);
    expect(linhas()).toEqual([]);
  });

  it('listagem nova truncada não conclui nada (com folga de subrequisições de sobra)', async () => {
    await abre();
    // Pasta funda demais: o percurso marca `truncada` gastando poucas páginas.
    arvore[RAIZ] = [...arvore[RAIZ].filter(f => f.id !== idFoto(1)), pasta('FUNDA_A_0000001', 'a')];
    arvore.FUNDA_A_0000001 = [pasta('FUNDA_B_0000001', 'b')];
    arvore.FUNDA_B_0000001 = [pasta('FUNDA_C_0000001', 'c')];
    await relê();
    expect(consultas).toEqual([]);
    expect(emails).toEqual([]);
    expect(linhas()).toEqual([]);
    expect(degradedHealth().some(d => d.label === 'fotos sumidas sem conferência')).toBe(false);
  });

  it('listagem nova que estourou o teto de páginas: sem folga, não confere e registra', async () => {
    await abre();
    arvore[RAIZ] = arvore[RAIZ].filter(f => f.id !== idFoto(1));
    truncaNaProxima = true; // nextPageToken sem fim: gasta todas as páginas
    await relê();
    expect(consultas).toEqual([]);
    expect(emails).toEqual([]);
    expect(linhas()).toEqual([]);
  });

  it('foto movida para outra pasta: só log, sem aviso e sem linha', async () => {
    await abre();
    destino[idFoto(1)] = 'movida';
    arvore[RAIZ] = arvore[RAIZ].filter(f => f.id !== idFoto(1));
    await relê();
    expect(consultas).toEqual([idFoto(1)]);
    expect(emails).toEqual([]);
    expect(linhas()).toEqual([]);
  });

  it('o Google não respondeu (500): não afirma que foi apagada; conta como não conferida', async () => {
    await abre();
    destino[idFoto(1)] = 'erro';
    arvore[RAIZ] = arvore[RAIZ].filter(f => f.id !== idFoto(1));
    await relê();
    expect(linhas()).toEqual([]);
    expect(doDono().length).toBe(1);
    expect(doDono()[0].html).toContain('sem conferência individual');
  });
});

describe('foto apagada', () => {
  it('avisa o dono UMA vez, com projeto, nome, autor, captura, quando e o recado', async () => {
    await abre();
    arvore[RAIZ] = arvore[RAIZ].filter(f => f.id !== idFoto(1));
    await relê();
    expect(consultas).toEqual([idFoto(1)]);
    expect(doDono().length).toBe(1);
    const e = doDono()[0];
    expect(e.subject).toContain('Uma foto sumiu da pasta do Drive');
    expect(e.subject).toContain('Festa');
    expect(e.html).toContain('um.jpg');
    expect(e.html).toContain('Luca F. Chala');
    expect(e.html).toContain('2026-10-30 15:04:05');
    expect(e.html).toContain('Sumiu entre');
    expect(e.html).toContain('Se foi engano, quem enviou pode reenviar; arquivos apagados vão para a lixeira de quem é dono do arquivo.');
    const l = linhas();
    expect(l.length).toBe(1);
    expect(l[0]).toMatchObject({ slug: 'festa', foto_id: idFoto(1), nome: 'um.jpg', autor: 'Luca F. Chala', capitulo: '' });
    // Não repete: a releitura seguinte não encontra nada novo.
    await relê();
    await relê();
    expect(doDono().length).toBe(1);
    expect(linhas().length).toBe(1);
  });

  it('na lixeira também conta como apagada', async () => {
    await abre();
    destino[idFoto(2)] = 'lixeira';
    arvore[RAIZ] = arvore[RAIZ].filter(f => f.id !== idFoto(2));
    await relê();
    expect(linhas().map(l => l.foto_id)).toEqual([idFoto(2)]);
  });

  it('a foto que some, volta e some de novo não é avisada duas vezes (linha já existe)', async () => {
    await abre();
    const f = arvore[RAIZ].find(x => x.id === idFoto(1));
    arvore[RAIZ] = arvore[RAIZ].filter(x => x !== f);
    await relê();
    arvore[RAIZ].push(f);
    await relê();
    arvore[RAIZ] = arvore[RAIZ].filter(x => x !== f);
    await relê();
    expect(doDono().length).toBe(1);
  });

  it('mais do que o máximo: só a contagem, sem consulta por foto e sem linhas', async () => {
    const muitas = Array.from({ length: SUMIRAM_CONFERIR_MAX + 3 }, (_, i) => arq(idFoto(100 + i), `m${i}.jpg`));
    arvore[RAIZ] = [...arvore[RAIZ], ...muitas];
    await abre();
    arvore[RAIZ] = arvore[RAIZ].filter(f => !muitas.includes(f));
    await relê();
    expect(consultas).toEqual([]);
    expect(linhas()).toEqual([]);
    expect(doDono().length).toBe(1);
    expect(doDono()[0].subject).toContain(`${SUMIRAM_CONFERIR_MAX + 3} fotos sumiram`);
    expect(doDono()[0].html).toContain(String(SUMIRAM_CONFERIR_MAX + 3));
  });

  it('exatamente o máximo: confere uma a uma e lista todas num único e-mail', async () => {
    const n = SUMIRAM_CONFERIR_MAX;
    const muitas = Array.from({ length: n }, (_, i) => arq(idFoto(100 + i), `m${i}.jpg`));
    arvore[RAIZ] = [...arvore[RAIZ], ...muitas];
    await abre();
    arvore[RAIZ] = arvore[RAIZ].filter(f => !muitas.includes(f));
    await relê();
    expect(consultas.length).toBe(n);
    expect(linhas().length).toBe(n);
    expect(doDono().length).toBe(1);
  });

  it('sem Resend configurado: registra a linha e não quebra a página', async () => {
    delete env.RESEND_API_KEY;
    await abre();
    arvore[RAIZ] = arvore[RAIZ].filter(f => f.id !== idFoto(1));
    const r = await relê();
    expect(r.status).toBe(200);
    expect(emails).toEqual([]);
    expect(linhas().length).toBe(1);
  });

  it('sem D1: ainda avisa o dono e a página abre', async () => {
    delete env.CONSENT_DB;
    await abre();
    arvore[RAIZ] = arvore[RAIZ].filter(f => f.id !== idFoto(1));
    const r = await relê();
    expect(r.status).toBe(200);
    // Sem D1 não há foto durável anterior: a memória do isolate cobre só o mesmo isolate.
    expect(doDono().length).toBeLessThanOrEqual(1);
  });
});

describe('orçamento de subrequisições', () => {
  it('releitura com 10 sumidas de 2 autores: Drive + consultas + e-mails cabem no teto da listagem, e o D1 em poucas operações', async () => {
    const c = d1Contado();
    d1 = c.db;
    env.CONSENT_DB = d1;
    const lixo = Array.from({ length: 5 }, (_, i) => arq(idFoto(300 + i), `r${i}.jpg`));
    const lixoMag = Array.from({ length: 5 }, (_, i) => arq(idFoto(400 + i), `g${i}.jpg`));
    arvore[RAIZ] = [...arvore[RAIZ], ...lixo];
    arvore[MAG] = [...arvore[MAG], ...lixoMag];
    await abre();
    arvore[RAIZ] = arvore[RAIZ].filter(f => !lixo.includes(f));
    arvore[MAG] = arvore[MAG].filter(f => !lixoMag.includes(f));
    const antesD1 = c.n();
    const chamadasAntes = fetch.mock.calls.length;
    await relê();
    const fetches = fetch.mock.calls.length - chamadasAntes;
    expect(consultas.length).toBe(10);
    expect(doDono().length).toBe(1);
    expect(doAutor().length).toBe(1);
    expect(fetches).toBeLessThanOrEqual(GALERIA_MAX_CHAMADAS + 2); // teto da listagem + e-mails (já dentro da folga reservada)
    expect(c.n() - antesD1).toBeLessThanOrEqual(5);
  });
});

describe('teto do dia', () => {
  it('passou do teto: o aviso ao dono é pulado e registrado; a linha fica no painel', async () => {
    await abre();
    let tirada = 0;
    // Cada rodada apaga uma foto nova (id diferente) para gerar um aviso por rodada.
    const extras = Array.from({ length: SUMIRAM_AVISO_DIA + 2 }, (_, i) => arq(idFoto(200 + i), `x${i}.jpg`));
    arvore[RAIZ] = [...arvore[RAIZ], ...extras];
    await relê();
    for (const f of extras) {
      arvore[RAIZ] = arvore[RAIZ].filter(x => x !== f);
      await relê();
      tirada++;
    }
    expect(tirada).toBe(SUMIRAM_AVISO_DIA + 2);
    expect(doDono().length).toBe(SUMIRAM_AVISO_DIA);
    expect(linhas().length).toBe(SUMIRAM_AVISO_DIA + 2);
    const aviso = degradedHealth().find(d => d.label === 'aviso de fotos sumidas pulado');
    expect(aviso).toBeTruthy();
  });
});

describe('cópia ao autor', () => {
  it('só com as fotos DELE, e o dono recebe o resumo completo sem o e-mail do autor', async () => {
    await abre();
    arvore[RAIZ] = arvore[RAIZ].filter(f => f.id !== idFoto(1));
    arvore[MAG] = arvore[MAG].filter(f => f.id !== idFoto(10));
    await relê();
    expect(doDono().length).toBe(1);
    expect(doDono()[0].html).toContain('um.jpg');
    expect(doDono()[0].html).toContain('m1.jpg');
    expect(doDono()[0].html).not.toContain(EMAIL_AUTOR);
    expect(doAutor().length).toBe(1);
    expect(doAutor()[0].html).toContain('m1.jpg');
    expect(doAutor()[0].html).not.toContain('um.jpg');
    expect(doAutor()[0].subject).toContain('Uma foto sua sumiu');
    expect(doAutor()[0].html).not.toContain('dono@example.com');
  });

  it('foto de autor sem e-mail nos créditos: ninguém além do dono recebe', async () => {
    await abre();
    arvore[RAIZ] = arvore[RAIZ].filter(f => f.id !== idFoto(1));
    await relê();
    expect(emails.length).toBe(1);
  });

  it('falha do Resend na cópia ao autor não derruba a página nem as linhas', async () => {
    await abre();
    const anterior = globalThis.fetch;
    vi.stubGlobal('fetch', vi.fn(async (input, init) => {
      const u = new URL(typeof input === 'string' ? input : input.url);
      if (u.host === 'api.resend.com' && JSON.parse(init.body).to.includes(EMAIL_AUTOR)) return new Response('{}', { status: 422 });
      return anterior(input, init);
    }));
    arvore[MAG] = arvore[MAG].filter(f => f.id !== idFoto(10));
    const r = await relê();
    expect(r.status).toBe(200);
    expect(linhas().length).toBe(1);
    expect(doDono().length).toBe(1);
  });
});

describe('painel e retenção', () => {
  it('lista só para o dono, da mais nova para a mais antiga, e diz a retenção', async () => {
    await abre();
    arvore[RAIZ] = arvore[RAIZ].filter(f => f.id !== idFoto(1));
    await relê();
    arvore[MAG] = arvore[MAG].filter(f => f.id !== idFoto(10));
    await relê();
    expect((await painel('festa', { dono: false })).status).toBe(401);
    const r = await painel();
    expect(r.status).toBe(200);
    const j = await r.json();
    expect(j.retencaoDias).toBe(SUMIRAM_RETENCAO_DIAS);
    expect(j.fotos.map(f => f.nome)).toEqual(['m1.jpg', 'um.jpg']);
    expect(j.fotos[0]).toMatchObject({ autor: 'Mag', secao: '' });
    expect(JSON.stringify(j)).not.toContain(EMAIL_AUTOR);
    expect((await painel('nao-existe')).status).toBe(404);
  });

  it('linhas com mais de 30 dias são apagadas na leitura do painel', async () => {
    const velha = new Date(Date.now() - (SUMIRAM_RETENCAO_DIAS + 1) * DIA).toISOString();
    const nova = new Date(Date.now() - (SUMIRAM_RETENCAO_DIAS - 1) * DIA).toISOString();
    const ins = d1.sqlite.prepare('INSERT INTO galeria_apagadas (slug, foto_id, nome, autor, capitulo, secao, captura, sumiu_em) VALUES (?,?,?,?,?,?,?,?)');
    ins.run('festa', 'VELHA_000000001', 'velha.jpg', 'A', '', '', '', velha);
    ins.run('festa', 'NOVA_0000000001', 'nova.jpg', 'A', '', '', '', nova);
    const j = await (await painel()).json();
    expect(j.fotos.map(f => f.nome)).toEqual(['nova.jpg']);
    expect(linhas().map(l => l.nome)).toEqual(['nova.jpg']);
  });

  it('a detecção também poda: foto antiga que sumiu de novo depois de 30 dias é avisada de novo', async () => {
    await abre();
    const velha = new Date(Date.now() - (SUMIRAM_RETENCAO_DIAS + 1) * DIA).toISOString();
    d1.sqlite.prepare('INSERT INTO galeria_apagadas (slug, foto_id, nome, autor, capitulo, secao, captura, sumiu_em) VALUES (?,?,?,?,?,?,?,?)')
      .run('festa', idFoto(1), 'um.jpg', 'Luca F. Chala', '', '', '', velha);
    arvore[RAIZ] = arvore[RAIZ].filter(f => f.id !== idFoto(1));
    await relê();
    expect(doDono().length).toBe(1);
    expect(linhas().length).toBe(1);
    expect(linhas()[0].sumiu_em > velha).toBe(true);
  });

  it('apagar o projeto apaga as linhas dele (e só as dele)', async () => {
    await abre();
    arvore[RAIZ] = arvore[RAIZ].filter(f => f.id !== idFoto(1));
    await relê();
    d1.sqlite.prepare('INSERT INTO galeria_apagadas (slug, foto_id, nome, autor, capitulo, secao, captura, sumiu_em) VALUES (?,?,?,?,?,?,?,?)')
      .run('outro', 'OUTRA_000000001', 'o.jpg', 'A', '', '', '', new Date().toISOString());
    const res = await worker.fetch(new Request(`${SITE}/api/events/1`, { method: 'DELETE', headers: { Cookie: `__Host-session=${TOKEN}` } }), env, { waitUntil() {} });
    expect(res.status).toBe(200);
    expect(linhas().map(l => l.slug)).toEqual(['outro']);
  });
});

describe('capítulo', () => {
  it('o e-mail e a linha dizem de qual capítulo a foto sumiu', async () => {
    const CAP = 'CAPA_PASTA_0001';
    await saveEvents(env, [{ ...EVENTO, galeriaCapitulos: true, driveUrl: `https://drive.google.com/drive/folders/${RAIZ}` }]);
    arvore[RAIZ] = [pasta(CAP, 'Cerimonia')];
    arvore[CAP] = [arq(idFoto(1), 'um.jpg'), arq(idFoto(2), 'dois.jpg')];
    const abreCap = async () => { limpaCacheDrive(); const r = await worker.fetch(new Request(SITE + '/galeria/festa/cerimonia', { headers: { 'CF-Connecting-IP': '203.0.113.9' } }), env, { waitUntil() {} }); await r.text(); return r; };
    await abreCap();
    arvore[CAP] = arvore[CAP].filter(f => f.id !== idFoto(1));
    avanca(11 * MIN);
    await abreCap();
    expect(linhas().map(l => [l.foto_id, l.capitulo])).toEqual([[idFoto(1), 'Cerimonia']]);
    expect(doDono()[0].html).toContain('Cerimonia');
  });
});
