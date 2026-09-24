// D1 em cima de SQLite de verdade, para a suíte `unit`.
//
// O D1 é SQLite; o que ele acrescenta (réplicas, API remota) não é o que estes
// testes afirmam. Um dublê em JS que "executasse" a consulta reimplementaria o
// `COUNT(DISTINCT …)` e a janela por `created_at` do nosso jeito, e testaria o
// dublê. Aqui as migrações REAIS de `migrations/` criam o esquema e o SQL que
// roda é o do código. A superfície imitada é só a que o `src/` usa:
// `prepare().bind().run()/first()/all()`.

import { DatabaseSync } from 'node:sqlite';
import { readFileSync, readdirSync } from 'node:fs';

export function d1Sqlite() {
  const db = new DatabaseSync(':memory:');
  const dir = new URL('../../migrations/', import.meta.url);
  for (const f of readdirSync(dir).filter(n => n.endsWith('.sql')).sort()) {
    db.exec(readFileSync(new URL(f, dir), 'utf8'));
  }
  return {
    /** Acesso direto, para o teste semear ou conferir linhas. */
    sqlite: db,
    /** @param {string} sql */
    prepare(sql) {
      /** @type {any[]} */
      let valores = [];
      const stmt = {
        /** @param {...any} v */
        bind(...v) { valores = v; return stmt; },
        async run() { db.prepare(sql).run(...valores); return { success: true }; },
        async first() { return db.prepare(sql).get(...valores) ?? null; },
        async all() { return { results: db.prepare(sql).all(...valores) }; },
      };
      return stmt;
    },
  };
}
