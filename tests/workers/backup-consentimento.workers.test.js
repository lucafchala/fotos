import { env, SELF } from 'cloudflare:test';
import { describe, it, expect, beforeAll } from 'vitest';
import m1 from '../../migrations/0001_consent.sql?raw';
import m2 from '../../migrations/0002_access_type.sql?raw';

// O backup v3 contra o D1 de VERDADE (miniflare). A suíte `unit` usa SQLite
// com uma imitação nossa de `raw()`, `batch()` e `meta.changes` — e é
// exatamente isso que o código usa para caber no limite de consultas e contar
// o que entrou. Aqui quem responde é o runtime: `raw()` devolve listas na
// ordem do SELECT, `batch()` é uma consulta só, e INSERT OR IGNORE de uma
// linha que já existe dá `changes: 0`.

const TOKEN = 'c'.repeat(64);
const SITE = 'https://fotos.lucafchala.com';
const COLUNAS = [
  'id', 'created_at', 'event_slug', 'event_title', 'drive_target', 'access_type',
  'terms_version', 'terms_hash', 'consent_text', 'declaration_text', 'consenter_name',
  'turnstile_ok', 'ip', 'country', 'region', 'city', 'timezone', 'asn', 'as_org', 'colo',
  'user_agent', 'accept_language', 'referrer', 'page_url',
];
const hex = n => n.toString(16).padStart(32, '0');
const linha = n => [
  hex(n), new Date(Date.UTC(2026, 9, 1, 12, 0, n % 60)).toISOString(), 'formatura', 'Formatura', 'full', 'public',
  '2026-10-18', 'b2'.repeat(32), 'Li e aceito.', null, null, 1, `203.0.113.${n % 250}`, 'BR', 'SP', 'São Paulo',
  'America/Sao_Paulo', n % 2 ? 64500 : null, 'Rede', 'GRU', 'Mozilla/5.0', 'pt-BR', '', `${SITE}/formatura`,
];

/** @param {string} sql */
const comandos = sql => sql.split(';').map(s => s.replace(/--.*$/gm, '').trim()).filter(Boolean);

beforeAll(async () => {
  const db = env.CONSENT_DB;
  await db.batch(comandos(m1).map(s => db.prepare(s)));
  for (const s of comandos(m2)) {
    try { await db.prepare(s).run(); } catch (e) { if (!/duplicate column/i.test(String(e))) throw e; }
  }
  await env.FOTOS.put(`admin_session:${TOKEN}`, JSON.stringify({ v: 1, createdAt: Date.now(), lastSeen: Date.now() }), { expirationTtl: 86400 });
});

const pede = (caminho, init = {}) => SELF.fetch(SITE + caminho, {
  ...init, headers: { Cookie: `__Host-session=${TOKEN}`, 'Content-Type': 'application/json', Origin: SITE, ...(init.headers || {}) },
});

describe('backup v3 com o D1 de verdade', () => {
  it('baixa na forma compacta, restaura num banco vazio, e a segunda vez não duplica', async () => {
    const db = env.CONSENT_DB;
    const sql = `INSERT INTO image_use_consent (${COLUNAS.join(',')}) VALUES (${COLUNAS.map(() => '?').join(',')})`;
    await db.batch(Array.from({ length: 130 }, (_, i) => db.prepare(sql).bind(...linha(i + 1))));
    const antes = (await db.prepare(`SELECT ${COLUNAS.join(',')} FROM image_use_consent ORDER BY id`).raw());

    const res = await pede('/api/backup');
    expect(res.status).toBe(200);
    expect(res.headers.get('X-Backup-Consentimento')).toBe('completo');
    const backup = await res.json();
    expect(backup.version).toBe(3);
    expect(backup.consent.colunas).toEqual(COLUNAS);
    expect(backup.consent.total).toBe(130);
    expect(backup.consent.linhas).toHaveLength(130);
    expect(backup.consent.linhas.every(l => Array.isArray(l) && l.length === COLUNAS.length)).toBe(true);

    await db.prepare('DELETE FROM image_use_consent').run();
    const primeiro = await (await pede('/api/backup/restore', { method: 'POST', body: JSON.stringify(backup) })).json();
    expect(primeiro).toMatchObject({ ok: true, consentAdded: 130, consentDuplicates: 0 });
    const depois = (await db.prepare(`SELECT ${COLUNAS.join(',')} FROM image_use_consent ORDER BY id`).raw());
    expect(depois).toEqual(antes);

    const segundo = await (await pede('/api/backup/restore', { method: 'POST', body: JSON.stringify(backup) })).json();
    expect(segundo).toMatchObject({ ok: true, consentAdded: 0, consentDuplicates: 130 });
    const { n } = await db.prepare('SELECT COUNT(*) AS n FROM image_use_consent').first();
    expect(n).toBe(130);
  });
});
