// Backup v3: o registro de consentimento (D1) dentro do arquivo.
//
// O que se prende aqui, e por quê:
//  - o GET leva a tabela `image_use_consent` inteira, na forma compacta
//    (`colunas` uma vez, cada aceite uma lista) — e continua `no-store`;
//  - sem D1, ou com ele fora, o backup SAI (eventos, categorias, pedidos) e a
//    seção diz que faltou: nunca 500, nunca sumir calado;
//  - acima do teto, as linhas mais recentes vão e a seção diz que está
//    incompleta (o caminho completo é `wrangler d1 export`);
//  - backups v1 e v2 (arquivos de verdade, em tests/fixtures/) restauram
//    EXATAMENTE como antes — mesma resposta, nada no D1;
//  - o restore v3 só ACRESCENTA (INSERT OR IGNORE por id), em lotes, e uma
//    linha ruim é recusada sozinha, sem derrubar as outras;
//  - na prévia de PR o registro não entra (dados pessoais de terceiros).

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { readFileSync } from 'node:fs';
import worker from '../src/index.js';
import { getEvents, resetDegraded, degradedHealth } from '../src/utils.js';
import { withDurableObjects } from './helpers/do.js';
import { pedidosGravados } from './helpers/pedidos.js';
import { d1Sqlite } from './helpers/d1.js';

const SITE = 'https://fotos.lucafchala.com';
const TOKEN = 'e'.repeat(64);
const fixture = nome => JSON.parse(readFileSync(new URL(`./fixtures/${nome}`, import.meta.url), 'utf8'));

const COLUNAS = [
  'id', 'created_at', 'event_slug', 'event_title', 'drive_target', 'access_type',
  'terms_version', 'terms_hash', 'consent_text', 'declaration_text', 'consenter_name',
  'turnstile_ok', 'ip', 'country', 'region', 'city', 'timezone', 'asn', 'as_org', 'colo',
  'user_agent', 'accept_language', 'referrer', 'page_url',
];

function fakeKV(inicial = {}) {
  const store = new Map(Object.entries({
    [`admin_session:${TOKEN}`]: JSON.stringify({ createdAt: Date.now(), lastSeen: Date.now() }),
    ...inicial,
  }));
  return {
    async get(k) { return store.has(k) ? store.get(k) : null; },
    async put(k, v) { store.set(k, v); },
    async delete(k) { store.delete(k); },
    async list({ prefix = '' } = {}) {
      return { keys: [...store.keys()].filter(k => k.startsWith(prefix)).map(name => ({ name })), list_complete: true, cursor: null };
    },
    _store: store,
  };
}

const montaEnv = (extra = {}) => withDurableObjects({ FOTOS: fakeKV(), CONSENT_DB: d1Sqlite(), ...extra });
const ctx = { waitUntil() {}, passThroughOnException() {} };
const pede = (env, path, o = {}) => worker.fetch(new Request(SITE + path, {
  ...o, headers: { Cookie: `__Host-session=${TOKEN}`, 'Content-Type': 'application/json', Origin: SITE, ...(o.headers || {}) },
}), env, ctx);
const baixa = env => pede(env, '/api/backup');
const restaura = (env, backup) => pede(env, '/api/backup/restore', { method: 'POST', body: JSON.stringify(backup) });

const hex = n => n.toString(16).padStart(32, '0');
const HASH = 'a1'.repeat(32);
/** Um aceite como o handleDriveLink grava (valores fictícios). */
const aceite = (n, extra = {}) => ({
  id: hex(n),
  created_at: new Date(Date.UTC(2026, 9, 1, 12, 0, n % 60, n % 1000)).toISOString(),
  event_slug: 'formatura-direito-2026',
  event_title: 'Formatura Direito 2026',
  drive_target: 'both',
  access_type: 'public',
  terms_version: '2026-10-18',
  terms_hash: HASH,
  consent_text: 'Li e aceito os Termos de Uso e autorizo o uso da minha imagem conforme descrito neles.',
  declaration_text: null,
  consenter_name: null,
  turnstile_ok: 1,
  ip: `203.0.113.${n % 250}`,
  country: 'BR', region: 'São Paulo', city: 'São Paulo', timezone: 'America/Sao_Paulo',
  asn: 64500, as_org: 'Rede de Exemplo', colo: 'GRU',
  user_agent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_6 like Mac OS X)', accept_language: 'pt-BR',
  referrer: '', page_url: 'https://fotos.lucafchala.com/formatura-direito-2026',
  ...extra,
});
const linhaDe = a => COLUNAS.map(c => a[c]);
function semeia(db, aceites) {
  const ins = db.sqlite.prepare(`INSERT INTO image_use_consent (${COLUNAS.join(',')}) VALUES (${COLUNAS.map(() => '?').join(',')})`);
  db.sqlite.exec('BEGIN');
  for (const a of aceites) ins.run(...linhaDe(a));
  db.sqlite.exec('COMMIT');
}
const linhasNoD1 = db => db.sqlite.prepare(`SELECT ${COLUNAS.join(',')} FROM image_use_consent ORDER BY id`).all();
const contaNoD1 = db => Number(db.sqlite.prepare('SELECT COUNT(*) AS n FROM image_use_consent').get().n);
const v3 = (linhas, extra = {}) => ({
  version: 3, backupAt: new Date().toISOString(), events: [], categories: [], removalRequests: [],
  consent: { tabela: 'image_use_consent', colunas: COLUNAS, linhas, total: linhas.length, completo: true, ...extra },
});

beforeEach(() => { resetDegraded(); vi.spyOn(console, 'error').mockImplementation(() => {}); });
afterEach(() => { vi.restoreAllMocks(); resetDegraded(); });

// ---------------------------------------------------------------------------
describe('GET /api/backup (v3) leva o registro de consentimento', () => {
  it('na forma compacta: colunas uma vez, cada aceite uma lista — e o cabeçalho diz "completo"', async () => {
    const env = montaEnv();
    semeia(env.CONSENT_DB, [aceite(1), aceite(2, { access_type: 'family', declaration_text: 'Declaro que…', consenter_name: 'Maria', turnstile_ok: 0, asn: null })]);
    const res = await baixa(env);
    expect(res.status).toBe(200);
    expect(res.headers.get('X-Backup-Consentimento')).toBe('completo');
    const b = await res.json();
    expect(b.version).toBe(3);
    expect(b.consent.tabela).toBe('image_use_consent');
    expect(b.consent.colunas).toEqual(COLUNAS);
    expect(b.consent.total).toBe(2);
    expect(b.consent.completo).toBe(true);
    expect(b.consent.ausente).toBeUndefined();
    // Mais recente primeiro, como o CSV; cada linha na ordem de `colunas`.
    expect(b.consent.linhas).toEqual([linhaDe(aceite(2, { access_type: 'family', declaration_text: 'Declaro que…', consenter_name: 'Maria', turnstile_ok: 0, asn: null })), linhaDe(aceite(1))]);
    // As outras seções continuam lá.
    expect(Array.isArray(b.events)).toBe(true);
    expect(Array.isArray(b.categories)).toBe(true);
    expect(Array.isArray(b.removalRequests)).toBe(true);
  });

  it('continua no-store e com os cabeçalhos de dado (agora há IP dentro)', async () => {
    const env = montaEnv();
    semeia(env.CONSENT_DB, [aceite(1)]);
    const res = await baixa(env);
    expect(res.headers.get('Cache-Control')).toMatch(/no-store/);
    expect(res.headers.get('Content-Security-Policy')).toContain("default-src 'none'");
    expect(res.headers.get('Referrer-Policy')).toBe('no-referrer');
    expect(res.headers.get('X-Content-Type-Options')).toBe('nosniff');
  });

  it('sem D1 configurado: o backup sai mesmo assim, e a seção diz que faltou', async () => {
    const env = montaEnv({ CONSENT_DB: undefined });
    const res = await baixa(env);
    expect(res.status).toBe(200);
    expect(res.headers.get('X-Backup-Consentimento')).toBe('ausente');
    const b = await res.json();
    expect(b.version).toBe(3);
    expect(Array.isArray(b.events)).toBe(true);
    expect(b.consent).toMatchObject({ tabela: 'image_use_consent', ausente: true });
    expect(b.consent.motivo).toMatch(/não configurado/);
    expect(b.consent.linhas).toBeUndefined();
  });

  it('com o D1 fora do ar: 200, a seção marcada como ausente — e o healthz fica sabendo', async () => {
    const recusa = () => Promise.reject(new Error('D1_ERROR: simulado'));
    const comando = { bind: () => comando, first: recusa, all: recusa, raw: recusa, run: recusa };
    const env = montaEnv({ CONSENT_DB: { prepare: () => comando, batch: recusa } });
    const res = await baixa(env);
    expect(res.status).toBe(200);
    expect(res.headers.get('X-Backup-Consentimento')).toBe('ausente');
    const b = await res.json();
    expect(b.consent.ausente).toBe(true);
    expect(b.consent.motivo).toMatch(/não respondeu.*D1_ERROR: simulado/);
    expect(degradedHealth().map(p => p.label)).toContain('backup sem o registro de consentimento');
  });

  it('acima do teto (1500): vão os mais recentes, e a seção diz que está incompleta e aponta o wrangler d1 export', async () => {
    const env = montaEnv();
    // n=0 é o MAIS ANTIGO (created_at em 2026-09), os outros em 2026-10.
    semeia(env.CONSENT_DB, [aceite(0, { created_at: '2026-09-01T00:00:00.000Z' }), ...Array.from({ length: 1500 }, (_, i) => aceite(i + 1))]);
    const res = await baixa(env);
    expect(res.status).toBe(200);
    expect(res.headers.get('X-Backup-Consentimento')).toBe('parcial');
    const { consent } = await res.json();
    expect(consent.linhas).toHaveLength(1500);
    expect(consent.total).toBe(1501);
    expect(consent.completo).toBe(false);
    expect(consent.motivo).toMatch(/wrangler d1 export/);
    expect(consent.linhas.map(l => l[0])).not.toContain(hex(0));
  });
});

// ---------------------------------------------------------------------------
describe('backups antigos restauram exatamente como antes', () => {
  it('v1 (só eventos, 2025): a mesma resposta de sempre, nada no D1', async () => {
    const env = montaEnv();
    const prepare = vi.spyOn(env.CONSENT_DB, 'prepare');
    const res = await restaura(env, fixture('backup-v1.json'));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, added: 2, updated: 0, skipped: 0, total: 2 });
    const salvos = await getEvents(env, true);
    expect(salvos.map(e => e.slug)).toEqual(['casamento-ana-e-bruno', 'ensaio-praia']);
    expect(salvos[0].driveUrl).toBe('https://drive.google.com/drive/folders/1AbCdEfGhIjKlMnOpQrStUvWxYz012345');
    expect(salvos[1].visible).toBe(false);
    expect(prepare, 'backup sem a seção consent não toca o D1').not.toHaveBeenCalled();
    expect(contaNoD1(env.CONSENT_DB)).toBe(0);
  });

  it('v2 (eventos, categorias, pedidos e a seção morta `reviews`): a mesma resposta de sempre, nada no D1', async () => {
    const env = montaEnv();
    const prepare = vi.spyOn(env.CONSENT_DB, 'prepare');
    const res = await restaura(env, fixture('backup-v2.json'));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, added: 2, updated: 0, skipped: 0, total: 2, categories: 6, removalRequestsAdded: 1 });
    // 6 = as categorias padrão do site somadas às do arquivo (união, sem repetir).
    expect((await getEvents(env, true)).map(e => e.slug)).toEqual(['formatura-direito-2026', 'aniversario-familia']);
    expect(pedidosGravados(env.FOTOS._store).map(p => p.email)).toEqual(['titular@exemplo.com']);
    expect(JSON.stringify([...env.FOTOS._store.values()])).not.toContain('recurso removido');
    expect(prepare).not.toHaveBeenCalled();
  });

  it('v1 e v2 restauram também sem D1 nenhum (a resposta não ganha campo de consentimento)', async () => {
    for (const nome of ['backup-v1.json', 'backup-v2.json']) {
      const corpo = await (await restaura(montaEnv({ CONSENT_DB: undefined }), fixture(nome))).json();
      expect(Object.keys(corpo).filter(k => k.startsWith('consent')), nome).toEqual([]);
    }
  });
});

// ---------------------------------------------------------------------------
describe('restore v3: o registro volta, só acrescentando', () => {
  it('ida e volta: o que o GET baixou entra num D1 vazio, coluna por coluna', async () => {
    const origem = montaEnv();
    semeia(origem.CONSENT_DB, [aceite(1), aceite(2, { asn: null, consenter_name: 'João', access_type: 'private', declaration_text: 'Declaro…' }), aceite(3, { turnstile_ok: 2 })]);
    const backup = await (await baixa(origem)).json();

    const destino = montaEnv();
    const corpo = await (await restaura(destino, backup)).json();
    expect(corpo).toMatchObject({ ok: true, consentAdded: 3, consentDuplicates: 0 });
    expect(corpo.consentRejected).toBeUndefined();
    expect(linhasNoD1(destino.CONSENT_DB)).toEqual(linhasNoD1(origem.CONSENT_DB));
  });

  it('o mesmo arquivo duas vezes não duplica; e uma linha que já existe NÃO é alterada (INSERT OR IGNORE)', async () => {
    const env = montaEnv();
    semeia(env.CONSENT_DB, [aceite(1)]);
    // O arquivo traz o aceite 1 adulterado (outro IP) e um novo, o 2.
    const backup = v3([linhaDe(aceite(1, { ip: '198.51.100.99' })), linhaDe(aceite(2))]);
    const primeiro = await (await restaura(env, backup)).json();
    expect(primeiro).toMatchObject({ consentAdded: 1, consentDuplicates: 1 });
    const segundo = await (await restaura(env, backup)).json();
    expect(segundo).toMatchObject({ consentAdded: 0, consentDuplicates: 2 });
    expect(contaNoD1(env.CONSENT_DB)).toBe(2);
    expect(linhasNoD1(env.CONSENT_DB).find(l => l.id === hex(1)).ip).toBe(aceite(1).ip);
  });

  it('o mesmo id repetido no próprio arquivo entra uma vez só (a primeira cópia)', async () => {
    const env = montaEnv();
    const corpo = await (await restaura(env, v3([linhaDe(aceite(1)), linhaDe(aceite(1, { ip: '198.51.100.1' }))]))).json();
    expect(corpo).toMatchObject({ consentAdded: 1, consentDuplicates: 1 });
    expect(linhasNoD1(env.CONSENT_DB)).toEqual([aceite(1)]);
  });

  it('a ordem das colunas vem da seção, não de uma posição fixa', async () => {
    const env = montaEnv();
    const invertidas = [...COLUNAS].reverse();
    const a = aceite(7);
    const corpo = await (await restaura(env, v3([invertidas.map(c => a[c])], { colunas: invertidas }))).json();
    expect(corpo.consentAdded).toBe(1);
    expect(linhasNoD1(env.CONSENT_DB)).toEqual([a]);
  });

  it('grava em lotes (D1 batch), não uma consulta por linha: 250 linhas = 3 chamadas', async () => {
    const env = montaEnv();
    const batch = vi.spyOn(env.CONSENT_DB, 'batch');
    const corpo = await (await restaura(env, v3(Array.from({ length: 250 }, (_, i) => linhaDe(aceite(i + 1)))))).json();
    expect(corpo.consentAdded).toBe(250);
    expect(batch).toHaveBeenCalledTimes(3);
    expect(batch.mock.calls.map(c => c[0].length)).toEqual([100, 100, 50]);
  });

  it('um lote recusado pelo D1 não derruba o restore: diz quantas entraram e quantas faltaram', async () => {
    const env = montaEnv();
    const real = env.CONSENT_DB.batch.bind(env.CONSENT_DB);
    let chamadas = 0;
    env.CONSENT_DB.batch = async cmds => (++chamadas === 2 ? Promise.reject(new Error('D1_ERROR: lote')) : real(cmds));
    const res = await restaura(env, v3(Array.from({ length: 250 }, (_, i) => linhaDe(aceite(i + 1)))));
    expect(res.status).toBe(200);
    const corpo = await res.json();
    expect(corpo).toMatchObject({ ok: true, consentAdded: 100, consentNotWritten: 150 });
    expect(corpo.consentError).toMatch(/recusou a gravação/);
    expect(contaNoD1(env.CONSENT_DB)).toBe(100);
    expect(degradedHealth().map(p => p.label)).toContain('restore do registro de consentimento parou');
  });

  it('lixo numa linha é recusado POR LINHA — as boas entram', async () => {
    const env = montaEnv();
    const ruins = [
      [...linhaDe(aceite(10)), 'coluna a mais'],                       // tamanho errado
      'não é lista',
      linhaDe(aceite(11, { ip: 2030113 })),                           // tipo errado
      linhaDe(aceite(12, { user_agent: 'x'.repeat(401) })),           // passa do teto
      linhaDe(aceite(13, { created_at: '01/10/2026' })),              // data fora do formato
      linhaDe(aceite(14, { created_at: '2099-01-01T00:00:00.000Z' })), // aceite "do futuro" fugiria da poda
      linhaDe(aceite(15, { turnstile_ok: 7 })),                       // fora do 0/1/2
      linhaDe(aceite(16, { access_type: 'admin' })),                  // enum desconhecido
      linhaDe(aceite(17, { id: "x'); DROP TABLE image_use_consent;--" })),
      linhaDe(aceite(18, { terms_hash: 'curto' })),
      linhaDe(aceite(19, { event_slug: '../../etc' })),
      linhaDe(aceite(20, { terms_version: null })),                   // NOT NULL
      linhaDe(aceite(21, { asn: 1.5 })),
      linhaDe(aceite(22, { consenter_name: { nome: 'objeto' } })),
    ];
    const boas = [linhaDe(aceite(1)), linhaDe(aceite(2))];
    const res = await restaura(env, v3([boas[0], ...ruins, boas[1]]));
    expect(res.status).toBe(200);
    const corpo = await res.json();
    expect(corpo).toMatchObject({ ok: true, consentAdded: 2, consentRejected: ruins.length });
    expect(linhasNoD1(env.CONSENT_DB).map(l => l.id)).toEqual([hex(1), hex(2)]);
  });

  it('aceite mais velho que a retenção (5 anos) não volta: restaurá-lo desfaria a poda', async () => {
    const env = montaEnv();
    const velho = new Date(Date.now() - 1826 * 86400_000).toISOString();
    const corpo = await (await restaura(env, v3([linhaDe(aceite(1, { created_at: velho })), linhaDe(aceite(2))]))).json();
    expect(corpo).toMatchObject({ consentAdded: 1, consentExpired: 1 });
    expect(corpo.consentRejected).toBeUndefined();
    expect(contaNoD1(env.CONSENT_DB)).toBe(1);
  });

  it('colunas desconhecidas, repetidas ou faltando: a seção fica de fora, dizendo por quê — os eventos entram', async () => {
    const casos = [
      [...COLUNAS.slice(0, -1), 'senha'],
      [...COLUNAS.slice(0, -1), 'id'],
      COLUNAS.filter(c => c !== 'created_at'),
      ['__proto__', ...COLUNAS.slice(1)],
    ];
    for (const colunas of casos) {
      const env = montaEnv();
      const backup = v3([colunas.map(() => 'x')], { colunas });
      backup.events = [{ id: 'ev1', slug: 'um-evento', title: 'Um' }];
      const res = await restaura(env, backup);
      expect(res.status).toBe(200);
      const corpo = await res.json();
      expect(corpo.added, String(colunas)).toBe(1);
      expect(corpo.consentError).toMatch(/Colunas/);
      expect(corpo.consentAdded).toBe(0);
      expect(contaNoD1(env.CONSENT_DB)).toBe(0);
    }
  });

  it('colunas opcionais ausentes da seção entram como NULL', async () => {
    const env = montaEnv();
    const colunas = ['id', 'created_at', 'event_slug', 'terms_version', 'turnstile_ok'];
    const a = aceite(5);
    expect((await (await restaura(env, v3([colunas.map(c => a[c])], { colunas }))).json()).consentAdded).toBe(1);
    const [gravado] = linhasNoD1(env.CONSENT_DB);
    expect(gravado.ip).toBeNull();
    expect(gravado.event_slug).toBe(a.event_slug);
  });

  it('backup v3 que saiu SEM o registro (D1 fora no dia): o restore avisa, sem erro', async () => {
    const env = montaEnv();
    const corpo = await (await restaura(env, { ...v3([]), consent: { tabela: 'image_use_consent', ausente: true, motivo: 'x' } })).json();
    expect(corpo).toMatchObject({ ok: true, consentMissingInBackup: true });
    expect(corpo.consentAdded).toBeUndefined();
  });

  it('backup incompleto (acima do teto) e linhas além do teto: a resposta diz as duas coisas', async () => {
    const env = montaEnv();
    const corpo = await (await restaura(env, v3(Array.from({ length: 1503 }, (_, i) => linhaDe(aceite(i + 1))), { completo: false }))).json();
    expect(corpo).toMatchObject({ consentAdded: 1500, consentOverLimit: 3, consentIncompleteBackup: true });
  });

  it('sem D1 no ambiente: os eventos entram e a resposta diz que o registro não entrou (nunca 500)', async () => {
    const env = montaEnv({ CONSENT_DB: undefined });
    const backup = v3([linhaDe(aceite(1))]);
    backup.events = [{ id: 'ev1', slug: 'um-evento', title: 'Um' }];
    const res = await restaura(env, backup);
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ ok: true, added: 1, consentAdded: 0, consentError: 'Registro de consentimentos não configurado.' });
  });

  it('seção consent que não é objeto: erro dito, o resto do restore segue', async () => {
    const env = montaEnv();
    const corpo = await (await restaura(env, { events: [{ id: 'ev1', slug: 'um-evento' }], consent: [1, 2] })).json();
    expect(corpo).toMatchObject({ ok: true, added: 1, consentError: 'Seção "consent" inválida.' });
  });
});

// ---------------------------------------------------------------------------
describe('prévia de PR: o registro de consentimento não entra', () => {
  it('nada vai ao D1 da prévia, e a resposta diz quantos ficaram de fora', async () => {
    const env = montaEnv({ AMBIENTE: 'previa' });
    const batch = vi.spyOn(env.CONSENT_DB, 'batch');
    const backup = v3([linhaDe(aceite(1)), linhaDe(aceite(2))]);
    backup.events = [{ id: 'ev1', slug: 'um-evento', title: 'Um' }];
    const res = await restaura(env, backup);
    expect(res.status).toBe(200);
    const corpo = await res.json();
    expect(corpo).toMatchObject({ ok: true, added: 1, consentSkipped: 2 });
    expect(corpo.consentAdded).toBeUndefined();
    expect(batch).not.toHaveBeenCalled();
    expect(contaNoD1(env.CONSENT_DB)).toBe(0);
  });

  it('em produção, o mesmo arquivo grava', async () => {
    const env = montaEnv();
    const corpo = await (await restaura(env, v3([linhaDe(aceite(1)), linhaDe(aceite(2))]))).json();
    expect(corpo.consentAdded).toBe(2);
    expect(corpo.consentSkipped).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// Os avisos do painel rodam NO NAVEGADOR: o teste tira as funções do fonte da
// página e as executa no node (a técnica de tests/backup-lembrete.test.js).
const fontePainel = readFileSync(new URL('../src/ui/dashboard.js', import.meta.url), 'utf8');
function tira(re, nome) {
  const m = fontePainel.match(re);
  if (!m) throw new Error(`${nome} não encontrada em dashboard.js — o teste precisa ser reapontado`);
  return m[0].replace(/\\\\/g, '\\');
}
const painel = new Function(`
  ${tira(/function avisoDoBackup\(consentimento\) \{[\s\S]*?\n {4}\}/, 'avisoDoBackup')}
  ${tira(/function textoConsentRestaurado\(res\) \{[\s\S]*?\n {4}\}/, 'textoConsentRestaurado')}
  return { avisoDoBackup, textoConsentRestaurado };
`)();

describe('painel: o que o dono lê sobre o registro de consentimento', () => {
  it('download: "ausente" e "parcial" avisam em vermelho; "completo" é o toast de sempre', () => {
    expect(painel.avisoDoBackup('completo')).toEqual({ texto: 'Backup baixado.', tipo: 'ok' });
    expect(painel.avisoDoBackup(null)).toEqual({ texto: 'Backup baixado.', tipo: 'ok' });
    expect(painel.avisoDoBackup('ausente')).toMatchObject({ tipo: 'err', texto: expect.stringMatching(/SEM o registro de consentimento/) });
    expect(painel.avisoDoBackup('parcial')).toMatchObject({ tipo: 'err', texto: expect.stringMatching(/wrangler d1 export/) });
  });

  it('restore: v1/v2 não ganham frase; v3 diz o que entrou, o que já existia, o recusado e o vencido', () => {
    expect(painel.textoConsentRestaurado({ added: 1 })).toBe('');
    expect(painel.textoConsentRestaurado({ consentAdded: 3, consentDuplicates: 2, consentRejected: 1, consentExpired: 1 }))
      .toBe(' Consentimento: 3 aceites novos, 2 já existiam, 1 recusado (inválido), 1 vencido (fora da retenção).');
    expect(painel.textoConsentRestaurado({ consentAdded: 1, consentDuplicates: 0 })).toBe(' Consentimento: 1 aceite novo.');
    expect(painel.textoConsentRestaurado({ consentSkipped: 4 })).toMatch(/não entra na prévia/);
    expect(painel.textoConsentRestaurado({ consentMissingInBackup: true })).toMatch(/saiu sem o registro/);
    expect(painel.textoConsentRestaurado({ consentAdded: 0, consentError: 'Registro de consentimentos não configurado.' }))
      .toBe(' Consentimento: 0 aceites novos. Registro de consentimentos não configurado.');
  });
});

// ---------------------------------------------------------------------------
// Ordem e independência das seções do restore: o consentimento (a PROVA de
// aceite) vem antes do laço dos pedidos de remoção — que grava uma chave de KV
// por pedido (até 500) e é quem estoura as 50 subrequisições do plano gratuito
// — e uma seção que falha nunca esconde as outras.
describe('restore: seções independentes, consentimento antes dos pedidos de remoção', () => {
  const pedido = n => ({
    id: hex(n).slice(-16), name: `Titular ${n}`, email: `t${n}@exemplo.com`, resolved: false,
    createdAt: new Date(Date.UTC(2026, 9, 1, 12, 0, n % 60)).toISOString(),
  });
  const backup = (nPedidos, nAceites) => ({
    ...v3(Array.from({ length: nAceites }, (_, i) => linhaDe(aceite(i + 1)))),
    categories: ['Casamentos'],
    removalRequests: Array.from({ length: nPedidos }, (_, i) => pedido(i + 1)),
  });
  /** KV que passa a recusar a escrita de pedidos depois de `ate` gravados. */
  function recusaPedidosDepois(env, ate) {
    const real = env.FOTOS.put.bind(env.FOTOS);
    let n = 0;
    env.FOTOS.put = async (k, ...r) => {
      if (k.startsWith('removal_request:') && ++n > ate) throw new Error('KV put: limite de subrequisições');
      return real(k, ...r);
    };
  }

  it('muitos pedidos + aceites, KV parando no meio: TODOS os aceites entram e a resposta diz até onde os pedidos foram', async () => {
    const env = montaEnv();
    recusaPedidosDepois(env, 40);
    const res = await restaura(env, backup(300, 250));
    expect(res.status).toBe(200);
    const corpo = await res.json();
    expect(corpo).toMatchObject({ ok: true, consentAdded: 250, removalRequestsAdded: 40 });
    expect(corpo.removalRequestsError).toMatch(/parou depois de 40/);
    expect(corpo.consentError).toBeUndefined();
    expect(contaNoD1(env.CONSENT_DB)).toBe(250);
    expect(pedidosGravados(env.FOTOS._store)).toHaveLength(40);
    expect(corpo.categories).toBeGreaterThan(0);
  });

  it('o consentimento é gravado ANTES do primeiro pedido de remoção', async () => {
    const env = montaEnv();
    const ordem = [];
    const batch = env.CONSENT_DB.batch.bind(env.CONSENT_DB);
    env.CONSENT_DB.batch = async c => { ordem.push('consent'); return batch(c); };
    const put = env.FOTOS.put.bind(env.FOTOS);
    env.FOTOS.put = async (k, ...r) => { if (k.startsWith('removal_request:')) ordem.push('pedido'); return put(k, ...r); };
    await restaura(env, backup(3, 3));
    expect(ordem.indexOf('consent')).toBeGreaterThanOrEqual(0);
    expect(ordem.indexOf('consent')).toBeLessThan(ordem.indexOf('pedido'));
  });

  it('o D1 recusando tudo não impede as categorias nem os pedidos, e o erro aparece na resposta', async () => {
    const env = montaEnv();
    env.CONSENT_DB.batch = async () => { throw new Error('D1_ERROR: fora'); };
    const corpo = await (await restaura(env, backup(5, 120))).json();
    expect(corpo.consentError || corpo.consentNotWritten).toBeTruthy();
    expect(corpo).toMatchObject({ ok: true, removalRequestsAdded: 5 });
    expect(corpo.categories).toBeGreaterThan(0);
    expect(pedidosGravados(env.FOTOS._store)).toHaveLength(5);
  });

  it('categorias falhando não impedem consentimento nem pedidos: a resposta traz categoriesError', async () => {
    const env = montaEnv();
    const put = env.FOTOS.put.bind(env.FOTOS);
    env.FOTOS.put = async (k, ...r) => { if (k.includes('categor')) throw new Error('KV put: categorias'); return put(k, ...r); };
    const corpo = await (await restaura(env, backup(4, 10))).json();
    expect(corpo.categoriesError).toMatch(/categorias/);
    expect(corpo).toMatchObject({ ok: true, consentAdded: 10, removalRequestsAdded: 4 });
  });

  it('restaurar o mesmo arquivo de novo continua de onde parou, sem duplicar aceites nem pedidos', async () => {
    const env = montaEnv();
    const arq = backup(30, 20);
    // Leitura em lote do KV (get com lista de chaves), que o fakeKV deste arquivo não tem.
    const get = env.FOTOS.get.bind(env.FOTOS);
    env.FOTOS.get = async k => (Array.isArray(k) ? new Map(await Promise.all(k.map(async n => [n, await get(n)]))) : get(k));
    const put = env.FOTOS.put.bind(env.FOTOS);
    recusaPedidosDepois(env, 10);
    const primeiro = await (await restaura(env, arq)).json();
    expect(primeiro).toMatchObject({ consentAdded: 20, removalRequestsAdded: 10 });
    env.FOTOS.put = put;
    const segundo = await (await restaura(env, arq)).json();
    expect(segundo).toMatchObject({ consentAdded: 0, consentDuplicates: 20, removalRequestsAdded: 20 });
    expect(segundo.removalRequestsError).toBeUndefined();
    expect(pedidosGravados(env.FOTOS._store)).toHaveLength(30);
    expect(contaNoD1(env.CONSENT_DB)).toBe(20);
  });
});
