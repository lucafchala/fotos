// Lembrete de backup: "Último backup: há N dias" em Ajustes → Dados.
//
// Não há backup automático, e o dono só lembra de baixar um depois de uma
// mudança grande. O servidor marca em `backup:ultimo` o instante em que
// entregou o arquivo; o painel lê na abertura e escreve a frase no navegador,
// por dia de São Paulo; sem backup nenhum, ou com mais de 30 dias, a linha vira
// aviso. Tudo aqui prende o que o dono ia notar se quebrasse em silêncio:
//  - o download NUNCA falha por causa do lembrete (cota de escrita do KV);
//  - o lembrete NUNCA derruba o painel (a leitura é enfeite);
//  - "ontem" é dia de calendário, não 24 horas;
//  - o bloco "Sair dos outros aparelhos" está no lugar certo e ligado.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { readFileSync } from 'node:fs';
import worker, { handleGetBackup } from '../src/index.js';
import { degradedHealth, resetDegraded, BACKUP_ULTIMO_KEY, limpaBackupUltimo } from '../src/utils.js';
import { dashboardHTML, loginHTML } from '../src/ui/dashboard.js';
import { withDurableObjects } from './helpers/do.js';

const TOKEN = 'a'.repeat(64);
const AGORA = Date.parse('2026-10-17T15:00:00Z');

/** @param {Record<string, string>} inicial */
function kv(inicial = {}) {
  const store = new Map(Object.entries({
    events: '[]',
    admin_password: 'pbkdf2:1:00:00',
    [`admin_session:${TOKEN}`]: JSON.stringify({ createdAt: Date.now() - 3600_000, lastSeen: Date.now() - 1000 }),
    ...inicial,
  }));
  /** @type {{ op: string, k: string }[]} */
  const log = [];
  return {
    async get(/** @type {string} */ k) { log.push({ op: 'get', k }); return store.has(k) ? store.get(k) : null; },
    async put(/** @type {string} */ k, /** @type {string} */ v) { log.push({ op: 'put', k }); store.set(k, v); },
    async delete(/** @type {string} */ k) { log.push({ op: 'delete', k }); store.delete(k); },
    async list(/** @type {{ prefix?: string }} */ { prefix = '' } = {}) {
      return { keys: [...store.keys()].filter(k => k.startsWith(prefix)).map(name => ({ name })), list_complete: true, cursor: null };
    },
    _store: store,
    _log: log,
  };
}
const escritas = (/** @type {ReturnType<typeof kv>} */ FOTOS) => FOTOS._log.filter(c => c.op === 'put' || c.op === 'delete').map(c => c.k);

/** ctx que guarda o que foi entregue ao waitUntil, para o teste aguardar depois. */
function comCtx() {
  /** @type {Promise<unknown>[]} */
  const pendentes = [];
  return { ctx: { waitUntil: (/** @type {Promise<unknown>} */ p) => { pendentes.push(p); } }, aguarda: () => Promise.all(pendentes) };
}

const chama = (/** @type {ReturnType<typeof kv>} */ FOTOS, caminho, /** @type {any} */ ctx, init = {}) => worker.fetch(
  new Request(`https://fotos.lucafchala.com${caminho}`, { headers: { Cookie: `__Host-session=${TOKEN}` }, ...init }),
  /** @type {any} */ (withDurableObjects({ FOTOS })), ctx,
);
/** O handler sem passar pelo roteador, e sem ctx. */
const direto = (/** @type {ReturnType<typeof kv>} */ FOTOS) => handleGetBackup(
  new Request('https://fotos.lucafchala.com/api/backup', { headers: { Cookie: `__Host-session=${TOKEN}` } }),
  /** @type {any} */ ({ FOTOS }),
);

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(AGORA);
  resetDegraded();
  vi.spyOn(console, 'error').mockImplementation(() => {});
});
afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); resetDegraded(); });

// ---------------------------------------------------------------------------
describe('GET /api/backup marca backup:ultimo', () => {
  it('escreve o instante da entrega em ISO, uma vez, e o arquivo sai inteiro', async () => {
    const FOTOS = kv();
    const { ctx, aguarda } = comCtx();
    const res = await chama(FOTOS, '/api/backup', ctx);
    await aguarda();

    expect(res.status).toBe(200);
    expect(res.headers.get('Content-Disposition')).toMatch(/^attachment; filename="fotos-backup-2026-10-17\.json"$/);
    const backup = await res.json();
    expect(Array.isArray(backup.events)).toBe(true);

    expect(FOTOS._store.get(BACKUP_ULTIMO_KEY)).toBe('2026-10-17T15:00:00.000Z');
    expect(escritas(FOTOS).filter(k => k === BACKUP_ULTIMO_KEY), 'uma escrita por download').toHaveLength(1);
  });

  it('o download não espera a gravação (waitUntil) — nem a cota lenta o segura', async () => {
    const FOTOS = kv();
    /** @type {() => void} */
    let libera = () => {};
    FOTOS.put = (/** @type {string} */ k, /** @type {string} */ v) => new Promise(ok => { libera = () => { FOTOS._store.set(k, v); ok(undefined); }; });
    const { ctx, aguarda } = comCtx();

    const res = await chama(FOTOS, '/api/backup', ctx);   // resolve com a gravação ainda pendente
    expect(res.status).toBe(200);
    expect(FOTOS._store.has(BACKUP_ULTIMO_KEY), 'ainda não gravou').toBe(false);
    libera();
    await aguarda();
    expect(FOTOS._store.has(BACKUP_ULTIMO_KEY)).toBe(true);
  });

  it('chamado sem ctx (o roteador sempre passa um), aguarda a gravação antes de responder', async () => {
    const FOTOS = kv();
    // A gravação só pousa depois de um turno do laço de eventos: sem o `await`,
    // a resposta sairia antes dela (no Worker, sem waitUntil, a escrita seria
    // cortada com a requisição).
    const real = FOTOS.put;
    FOTOS.put = async (k, v) => { await new Promise(ok => setTimeout(ok, 0)); return real(k, v); };
    const res = await direto(FOTOS);
    expect(res.status).toBe(200);
    expect(FOTOS._store.get(BACKUP_ULTIMO_KEY)).toBe('2026-10-17T15:00:00.000Z');
  });

  it('o KV recusando a escrita (cota) não quebra o download — vai para o healthz', async () => {
    for (const comWaitUntil of [true, false]) {
      resetDegraded();
      const FOTOS = kv();
      const real = FOTOS.put;
      FOTOS.put = (k, v) => (k === BACKUP_ULTIMO_KEY ? Promise.reject(new Error('KV PUT failed: 429 Too Many Requests')) : real(k, v));
      const { ctx, aguarda } = comCtx();
      const res = comWaitUntil ? await chama(FOTOS, '/api/backup', ctx) : await direto(FOTOS);
      await aguarda();

      expect(res.status, comWaitUntil ? 'com waitUntil' : 'sem waitUntil').toBe(200);
      expect(Array.isArray((await res.json()).events)).toBe(true);
      const [aviso] = degradedHealth();
      expect(aviso.label).toBe('KV: escrita recusada');
      expect(aviso.detail).toMatch(/registro do último backup/);
    }
  });

  it('uma escrita que lança de forma síncrona também não quebra o download', async () => {
    const FOTOS = kv();
    FOTOS.put = () => { throw new Error('put síncrono'); };
    const res = await chama(FOTOS, '/api/backup', comCtx().ctx);
    expect(res.status).toBe(200);
    expect(degradedHealth().map(p => p.label)).toEqual(['KV: escrita recusada']);
  });

  it('HEAD não baixa nada: não marca backup', async () => {
    const FOTOS = kv();
    const { ctx, aguarda } = comCtx();
    const res = await chama(FOTOS, '/api/backup', ctx, { method: 'HEAD' });
    await aguarda();
    expect(res.status).toBe(200);
    expect(escritas(FOTOS)).toEqual([]);
  });

  it('sem sessão: 401 e nada gravado', async () => {
    const FOTOS = kv();
    const res = await worker.fetch(new Request('https://fotos.lucafchala.com/api/backup'), /** @type {any} */ (withDurableObjects({ FOTOS })), /** @type {any} */ (comCtx().ctx));
    expect(res.status).toBe(401);
    expect(escritas(FOTOS)).toEqual([]);
  });

  it('um backup que não ficou pronto não conta: a leitura dos eventos falhou, nada é marcado', async () => {
    const FOTOS = kv();
    const real = FOTOS.get;
    FOTOS.get = k => (k === 'events' ? Promise.reject(new Error('KV GET failed: 503')) : real(k));
    const { ctx, aguarda } = comCtx();
    // Hoje o roteador deixa a rejeição de um handler passar (o `return handler()`
    // dentro do try não é `return await`); se algum dia virar uma página 500,
    // o que este teste prende — nada marcado — continua valendo.
    const res = await chama(FOTOS, '/api/backup', ctx).catch(e => e);
    await aguarda();
    expect(res instanceof Error || res.status >= 500).toBe(true);
    expect(escritas(FOTOS)).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
describe('o painel lê backup:ultimo na abertura', () => {
  const abre = (/** @type {ReturnType<typeof kv>} */ FOTOS) => chama(FOTOS, '/dashboard', comCtx().ctx);

  it('uma leitura a mais, e o valor chega ao script da página', async () => {
    const FOTOS = kv({ [BACKUP_ULTIMO_KEY]: '2026-10-01T12:00:00.000Z' });
    const res = await abre(FOTOS);
    expect(res.status).toBe(200);
    expect(await res.text()).toContain('let backupUltimo = "2026-10-01T12:00:00.000Z";');
    expect(FOTOS._log.filter(c => c.op === 'get' && c.k === BACKUP_ULTIMO_KEY), 'uma leitura por abertura').toHaveLength(1);
  });

  it('sem backup nunca feito: null', async () => {
    const html = await (await abre(kv())).text();
    expect(html).toContain('let backupUltimo = null;');
  });

  it('valor fora da forma que nós gravamos vira "nunca" — não entra na página', async () => {
    for (const lixo of ['ontem', '2026-10-01', '"><script>alert(1)</script>', '{"a":1}', '2026-13-45T99:99:99Z']) {
      const html = await (await abre(kv({ [BACKUP_ULTIMO_KEY]: lixo }))).text();
      expect(html, lixo).toContain('let backupUltimo = null;');
      expect(html).not.toContain('alert(1)</script>');
    }
  });

  it('a leitura falhando não derruba o painel: abre sem o lembrete e avisa o healthz', async () => {
    const FOTOS = kv({ [BACKUP_ULTIMO_KEY]: '2026-10-01T12:00:00.000Z' });
    const real = FOTOS.get;
    FOTOS.get = k => (k === BACKUP_ULTIMO_KEY ? Promise.reject(new Error('KV GET failed: 503')) : real(k));
    const res = await abre(FOTOS);
    expect(res.status).toBe(200);
    expect(await res.text()).toContain('let backupUltimo = null;');
    expect(degradedHealth().map(p => p.label)).toContain('KV: leitura recusada');
  });

  it('na tela de login não lê nada disso', async () => {
    const FOTOS = kv();
    const res = await worker.fetch(new Request('https://fotos.lucafchala.com/dashboard'), /** @type {any} */ (withDurableObjects({ FOTOS })), /** @type {any} */ (comCtx().ctx));
    expect(res.status).toBe(200);
    expect(FOTOS._log.some(c => c.k === BACKUP_ULTIMO_KEY)).toBe(false);
  });

  it('limpaBackupUltimo só deixa passar o ISO que o servidor grava', () => {
    expect(limpaBackupUltimo('2026-10-17T15:00:00.000Z')).toBe('2026-10-17T15:00:00.000Z');
    expect(limpaBackupUltimo('2026-10-17T15:00:00Z')).toBe('2026-10-17T15:00:00Z');
    // Dia que não existe: o Date "corrigiria" para março em silêncio.
    for (const v of [null, undefined, 42, '', 'x', '2026-10-17', '2026-10-17T15:00:00', '2026-10-17T15:00:00+03:00', '2026-02-31T10:00:00.000Z', '2026-10-17T24:00:00Z', '2026-13-01T00:00:00Z']) {
      expect(limpaBackupUltimo(v), String(v)).toBeNull();
    }
  });
});

// ---------------------------------------------------------------------------
// A frase de Ajustes é calculada NO NAVEGADOR. O teste tira a função do fonte
// da página, exatamente como ela vai para o navegador, e a executa no node —
// a mesma técnica de tests/metricas-painel.test.js e dos pares de
// tests/security.test.js. O fuso do node não entra: as contas usam o
// hojeEmSaoPaulo() do próprio painel, que fixa America/Sao_Paulo.
const fonte = readFileSync(new URL('../src/ui/dashboard.js', import.meta.url), 'utf8');
/** @param {RegExp} re @param {string} nome */
function tira(re, nome) {
  const m = fonte.match(re);
  if (!m) throw new Error(`${nome} não encontrada em dashboard.js — o teste precisa ser reapontado`);
  return m[0].replace(/\\\\/g, '\\');   // dentro do template literal, toda barra está dobrada
}
const cliente = new Function(`
  ${tira(/function hojeEmSaoPaulo\(agora = new Date\(\)\) \{[\s\S]*?\n {4}\}/, 'hojeEmSaoPaulo')}
  ${tira(/function textoUltimoBackup\(iso, agora\) \{[\s\S]*?\n {4}\}/, 'textoUltimoBackup')}
  ${tira(/function avisoSessoesEncerradas\(n\) \{[\s\S]*?\n {4}\}/, 'avisoSessoesEncerradas')}
  return { textoUltimoBackup, avisoSessoesEncerradas };
`)();
const frase = (/** @type {string|null} */ iso, /** @type {string} */ agora) => cliente.textoUltimoBackup(iso, new Date(agora));

describe('a linha "Último backup" (script do painel)', () => {
  // São Paulo é UTC-3 o ano todo (sem horário de verão desde 2019).
  const AGORA_SP = '2026-10-17T20:00:00Z';   // 17h do dia 17

  it('hoje, ontem e há N dias com a data', () => {
    expect(frase('2026-10-17T15:00:00Z', AGORA_SP)).toEqual({ texto: 'Último backup: hoje', velho: false });
    expect(frase('2026-10-16T15:00:00Z', AGORA_SP)).toEqual({ texto: 'Último backup: ontem', velho: false });
    expect(frase('2026-10-15T15:00:00Z', AGORA_SP)).toEqual({ texto: 'Último backup: há 2 dias (15/10/2026)', velho: false });
    expect(frase('2026-10-12T15:00:00Z', AGORA_SP)).toEqual({ texto: 'Último backup: há 5 dias (12/10/2026)', velho: false });
  });

  it('conta por dia de CALENDÁRIO de São Paulo, não por 24 horas', () => {
    // 23h50 de sexta (02h50Z de sábado) visto 20 minutos depois, já sábado em SP: ontem.
    expect(frase('2026-10-17T02:50:00Z', '2026-10-17T03:10:00Z').texto).toBe('Último backup: ontem');
    // 00h05 de sábado em SP visto às 23h50 do mesmo sábado — quase 24 h depois: ainda hoje.
    expect(frase('2026-10-17T03:05:00Z', '2026-10-18T02:50:00Z').texto).toBe('Último backup: hoje');
    // Ano novo: 31/12 às 22h (01h do dia 1º em UTC) visto em 1º/1 às 09h.
    expect(frase('2027-01-01T01:00:00Z', '2027-01-01T12:00:00Z').texto).toBe('Último backup: ontem');
  });

  it('nunca baixado, ou um valor que não é data: "Nenhum backup baixado ainda." em aviso', () => {
    const nunca = { texto: 'Nenhum backup baixado ainda.', velho: true };
    expect(frase(null, AGORA_SP)).toEqual(nunca);
    expect(frase('', AGORA_SP)).toEqual(nunca);
    expect(frase('lixo', AGORA_SP)).toEqual(nunca);
  });

  it('vira aviso só com MAIS de 30 dias', () => {
    // 17/10 menos 30 dias = 17/09; menos 31 = 16/09.
    expect(frase('2026-09-17T15:00:00Z', AGORA_SP)).toEqual({ texto: 'Último backup: há 30 dias (17/09/2026)', velho: false });
    expect(frase('2026-09-16T15:00:00Z', AGORA_SP)).toEqual({ texto: 'Último backup: há 31 dias (16/09/2026)', velho: true });
    expect(frase('2025-10-17T15:00:00Z', AGORA_SP).velho).toBe(true);
  });

  it('relógio do navegador atrás do servidor: um backup "do futuro" é de hoje, não "há -1 dias"', () => {
    expect(frase('2026-10-18T15:00:00Z', AGORA_SP)).toEqual({ texto: 'Último backup: hoje', velho: false });
  });
});

// ---------------------------------------------------------------------------
describe('Ajustes: o bloco "Sair dos outros aparelhos" e o lembrete na página', () => {
  const html = dashboardHTML([], [], 'N', '', '2026-10-17T15:00:00.000Z');

  it('"Sair dos outros aparelhos" está em Conta, depois da senha, e NÃO é um bloco sensível', () => {
    const conta = html.indexOf('<h2 class="grupo-titulo">Conta</h2>');
    const sobre = html.indexOf('<h2 class="grupo-titulo">Sobre</h2>');
    const senha = html.indexOf('<h3>Trocar a senha do painel</h3>');
    const bloco = html.indexOf('<div class="bloco" id="bloco-sessoes">');
    expect(conta).toBeGreaterThan(-1);
    expect(senha).toBeGreaterThan(conta);
    expect(bloco).toBeGreaterThan(senha);
    expect(bloco).toBeLessThan(sobre);
    const trecho = html.slice(bloco, sobre);
    expect(trecho).toContain('<h3>Sair dos outros aparelhos</h3>');
    expect(trecho).toContain('Encerra a sessão do painel em todos os aparelhos, menos neste. Em outro lugar, pode levar até 30 s.');
    expect(trecho).toContain('data-onclick="revokeOtherSessions"');
    expect(trecho, 'sem confirmação digitada: nenhum dado se perde').not.toContain('sensivel');
    expect((html.match(/class="bloco sensivel"/g) || []).length).toBe(2);
  });

  it('o botão está ligado: há um case no switch delegado e a função existe', () => {
    expect(html).toContain("case 'revokeOtherSessions': revokeOtherSessions(el); break;");
    expect(html).toContain('async function revokeOtherSessions(btn) {');
    expect(html).toContain("api('POST', '/api/sessions/revoke-others')");
  });

  it('o aviso conta 0, 1 e N sessões por extenso', () => {
    expect(cliente.avisoSessoesEncerradas(0)).toBe('Nenhuma outra sessão estava aberta.');
    expect(cliente.avisoSessoesEncerradas(1)).toBe('1 sessão encerrada.');
    expect(cliente.avisoSessoesEncerradas(2)).toBe('2 sessões encerradas.');
    expect(cliente.avisoSessoesEncerradas(12)).toBe('12 sessões encerradas.');
  });

  it('a linha do backup mora no bloco "Backup dos dados", antes do botão, e o valor vai para o script', () => {
    const titulo = html.indexOf('<h3>Backup dos dados</h3>');
    const linha = html.indexOf('<p class="backup-ultimo" id="backup-ultimo"></p>');
    const botao = html.indexOf('data-onclick="downloadBackup"');
    expect(titulo).toBeGreaterThan(-1);
    expect(linha).toBeGreaterThan(titulo);
    expect(botao).toBeGreaterThan(linha);
    expect(html).toContain('let backupUltimo = "2026-10-17T15:00:00.000Z";');
    // Na abertura, e não só depois do download: o texto de Ajustes nasce vazio.
    expect(html).toMatch(/renderCategoryManager\(\);\s*mostraUltimoBackup\(\);\s*loadRequests\(\);/);
    // Depois do download: a linha muda no lugar, sem recarregar.
    // (O texto do toast depende do registro de consentimento — avisoDoBackup,
    // tests/backup-consentimento.test.js.)
    expect(html).toMatch(/toast\(aviso\.texto, aviso\.tipo\);[\s\S]*?backupUltimo = new Date\(\)\.toISOString\(\);\s*mostraUltimoBackup\(\);/);
  });

  it('sem o parâmetro (as outras chamadas da página), o padrão é null', () => {
    expect(dashboardHTML([], [], 'N')).toContain('let backupUltimo = null;');
    expect(dashboardHTML([], [], 'N', '', 42)).toContain('let backupUltimo = null;');
  });

  it('dado hostil no parâmetro não fecha o script', () => {
    const hostil = dashboardHTML([], [], 'N', '', '</script><script>alert(1)</script>');
    expect(hostil).not.toContain('</script><script>alert(1)');
    expect(hostil).toContain('\\u003c/script\\u003e');
  });

  it('o aviso âmbar tem UMA regra, no CSS compartilhado, e vale para o painel e o login', () => {
    const regra = /\.aviso\{background:#1a1408;[^}]*\}/g;
    expect((html.match(regra) || []).length, 'painel').toBe(1);
    expect((loginHTML({}, 'N').match(regra) || []).length, 'login').toBe(1);
    expect(html).toContain('.backup-ultimo.aviso{margin-bottom:0}');
  });
});
