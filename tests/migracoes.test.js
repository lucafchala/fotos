import { describe, it, expect } from 'vitest';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync, readdirSync } from 'node:fs';
import { planoDaMigracao } from '../scripts/d1-migrate.mjs';

// O D1 é SQLite. Aqui TODAS as migrações de `migrations/` são aplicadas, em
// ordem, num banco vazio — o que `wrangler d1 migrations apply` faz num banco
// novo — e o esquema FINAL é conferido contra o que o código escreve e lê.
// Os outros testes pegam um pedaço (o INSERT, o parser do script); nenhum
// pegava "o conjunto aplicado do zero dá o esquema que o código espera".

const DIR = new URL('../migrations/', import.meta.url);
const arquivos = readdirSync(DIR).filter(f => f.endsWith('.sql')).sort();

function aplicar(db, lista = arquivos) {
  for (const f of lista) db.exec(readFileSync(new URL(f, DIR), 'utf8'));
}

function colunasDoCodigo() {
  const src = readFileSync(new URL('../src/index.js', import.meta.url), 'utf8');
  const bloco = src.match(/const CONSENT_COLS = \[([\s\S]*?)\];/);
  return [...bloco[1].matchAll(/'([a-z_]+)'/g)].map(m => m[1]);
}

const colunas = db => db.prepare("SELECT name FROM pragma_table_info('image_use_consent')").all().map(r => r.name);

describe('migrações do D1 aplicadas num banco vazio', () => {
  it('têm numeração contígua e ordem lexical igual à numérica', () => {
    expect(arquivos.length).toBeGreaterThanOrEqual(2);
    arquivos.forEach((f, i) => {
      expect(f.startsWith(String(i + 1).padStart(4, '0') + '_'), `${f} fora de sequência`).toBe(true);
    });
  });

  it('aplicam sem erro e deixam todas as colunas que o código exporta', () => {
    const db = new DatabaseSync(':memory:');
    aplicar(db);
    const cols = colunas(db);
    expect(cols).toContain('id');
    for (const c of colunasDoCodigo()) expect(cols, `coluna ${c} ausente do esquema final`).toContain(c);
    // 1 (id) + as exportadas: nenhuma coluna órfã escapando da exportação/retenção.
    expect(cols.length).toBe(colunasDoCodigo().length + 1);
  });

  it('criam os índices usados pela consulta por evento e pela poda por data', () => {
    const db = new DatabaseSync(':memory:');
    aplicar(db);
    const idx = db.prepare("SELECT name FROM pragma_index_list('image_use_consent')").all().map(r => r.name);
    expect(idx).toEqual(expect.arrayContaining(['idx_consent_slug', 'idx_consent_created']));
  });

  it('a ordem importa: a 0002 sem a 0001 falha (não há tabela para alterar)', () => {
    const db = new DatabaseSync(':memory:');
    expect(() => aplicar(db, [...arquivos].reverse())).toThrow(/no such table/i);
  });

  it('reaplicar tudo é erro — por isso o script de deploy confere comando a comando', () => {
    const db = new DatabaseSync(':memory:');
    aplicar(db);
    // A 0001 é idempotente (IF NOT EXISTS)…
    expect(() => aplicar(db, [arquivos[0]])).not.toThrow();
    // …a 0002 não é: ADD COLUMN não tem IF NOT EXISTS em SQLite.
    expect(() => aplicar(db, [arquivos[1]])).toThrow(/duplicate column name/i);
  });

  it('o plano do script de deploy vê TODO efeito como já presente num banco migrado', () => {
    const db = new DatabaseSync(':memory:');
    aplicar(db);
    for (const f of arquivos) {
      const { passos, naoEntendidos } = planoDaMigracao(readFileSync(new URL(f, DIR), 'utf8'));
      expect(naoEntendidos).toEqual([]);
      for (const p of passos.filter(x => !x.idempotente)) {
        expect(() => db.prepare(p.verificacao).all(), `${f}: ${p.verificacao}`).not.toThrow();
      }
    }
  });

  it('e vê o efeito como AUSENTE num banco só com a 0001 (o estado que a 0002 deve consertar)', () => {
    const db = new DatabaseSync(':memory:');
    aplicar(db, [arquivos[0]]);
    const { passos } = planoDaMigracao(readFileSync(new URL(arquivos[1], DIR), 'utf8'));
    const verificacoes = passos.filter(x => !x.idempotente);
    expect(verificacoes.length).toBeGreaterThan(0);
    for (const p of verificacoes) expect(() => db.prepare(p.verificacao).all()).toThrow(/no such column/i);
  });
});

describe('consultas do registro de consentimento contra o esquema migrado', () => {
  it('gravam a linha completa, exportam e podem ser podadas por data', () => {
    const db = new DatabaseSync(':memory:');
    aplicar(db);
    const cols = ['id', ...colunasDoCodigo()];
    const linha = (id, criado) => cols.map(c => (c === 'id' ? id : c === 'created_at' ? criado : c === 'asn' || c === 'turnstile_ok' ? 1 : `v-${c}`));
    const ins = db.prepare(`INSERT INTO image_use_consent (${cols.join(', ')}) VALUES (${cols.map(() => '?').join(',')})`);
    ins.run(...linha('a', '2020-01-01T00:00:00.000Z'));
    ins.run(...linha('b', '2026-10-01T00:00:00.000Z'));

    const exportadas = db.prepare(`SELECT ${colunasDoCodigo().join(', ')} FROM image_use_consent ORDER BY created_at DESC`).all();
    expect(exportadas.map(r => r.created_at)).toEqual(['2026-10-01T00:00:00.000Z', '2020-01-01T00:00:00.000Z']);

    db.prepare('DELETE FROM image_use_consent WHERE created_at < ?').run('2025-01-01T00:00:00.000Z');
    expect(db.prepare('SELECT id FROM image_use_consent').all().map(r => r.id)).toEqual(['b']);
  });

  it('linhas anteriores à 0002 continuam válidas (colunas novas nulas)', () => {
    const db = new DatabaseSync(':memory:');
    aplicar(db, [arquivos[0]]);
    db.prepare(`INSERT INTO image_use_consent (id, created_at, event_slug, terms_version) VALUES ('velha', '2025-01-01T00:00:00.000Z', 'x', '1')`).run();
    aplicar(db, arquivos.slice(1));
    expect(db.prepare("SELECT access_type, declaration_text FROM image_use_consent WHERE id='velha'").get())
      .toMatchObject({ access_type: null, declaration_text: null });
  });
});
