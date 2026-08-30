import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import {
  dividirComandos, classificar, planoDaMigracao, nomeDeArquivoSeguro, primeiroJSON,
} from '../scripts/d1-migrate.mjs';

// Este script decide se pode ESCREVER no banco de produção. O que ele precisa
// acertar não é o caminho feliz — é recusar tudo que não souber verificar.
describe('dividirComandos', () => {
  it('descarta comentários de linha antes de olhar qualquer comando', () => {
    // O caso real: as migrações deste repositório documentam o próprio comando
    // num comentário. Um parser ingênuo veria dois ALTER onde há um.
    const sql = `
      -- ALTER TABLE t ADD COLUMN nunca_existiu TEXT;
      ALTER TABLE t ADD COLUMN existe TEXT;  -- 'public' | 'private'
    `;
    const cmds = dividirComandos(sql);
    expect(cmds).toHaveLength(1);
    expect(cmds[0]).toBe('ALTER TABLE t ADD COLUMN existe TEXT');
  });

  it('descarta comentários de bloco', () => {
    expect(dividirComandos('/* DROP TABLE t; */ SELECT 1;')).toEqual(['SELECT 1']);
  });

  it('não devolve comando vazio para ponto-e-vírgula sobrando', () => {
    expect(dividirComandos(';;\n\n;')).toEqual([]);
  });
});

describe('classificar', () => {
  it('trata IF NOT EXISTS como idempotente, sem inventar verificação', () => {
    for (const c of [
      'CREATE TABLE IF NOT EXISTS t (a TEXT)',
      'CREATE INDEX IF NOT EXISTS i ON t (a)',
      'CREATE UNIQUE INDEX IF NOT EXISTS i ON t (a)',
    ]) {
      expect(classificar(c)).toMatchObject({ idempotente: true });
      expect(classificar(c).verificacao).toBeUndefined();
    }
  });

  it('gera uma verificação que só passa se a COLUNA existir', () => {
    expect(classificar('ALTER TABLE image_use_consent ADD COLUMN access_type TEXT'))
      .toEqual({ tipo: 'add-column', verificacao: 'SELECT "access_type" FROM "image_use_consent" LIMIT 0' });
  });

  it('aceita ADD sem a palavra COLUMN, que é SQL válido', () => {
    expect(classificar('ALTER TABLE t ADD c TEXT').verificacao).toBe('SELECT "c" FROM "t" LIMIT 0');
  });

  it('verifica CREATE TABLE sem IF NOT EXISTS, em vez de rodá-lo às cegas', () => {
    expect(classificar('CREATE TABLE t (a TEXT)').verificacao).toBe('SELECT 1 FROM "t" LIMIT 0');
  });

  // A lista abaixo é a razão de o script existir na forma conservadora que tem.
  // Cada um destes tem efeito que uma verificação por SELECT não prova, ou que
  // é destrutivo. Classificar qualquer um deles seria o bug.
  it.each([
    'DROP TABLE t',
    'DROP COLUMN c',
    'ALTER TABLE t RENAME TO outra',
    'ALTER TABLE t RENAME COLUMN a TO b',
    'ALTER TABLE t DROP COLUMN c',
    'UPDATE t SET a = 1',
    'DELETE FROM t',
    'INSERT INTO t (a) VALUES (1)',
    'CREATE TRIGGER g AFTER INSERT ON t BEGIN SELECT 1; END',
    'CREATE VIEW v AS SELECT 1',
    'PRAGMA foreign_keys = ON',
  ])('recusa %s', (comando) => {
    expect(classificar(comando)).toBeNull();
  });
});

describe('planoDaMigracao', () => {
  it('reprova o arquivo inteiro quando UM comando é irreconhecível', () => {
    // Não basta reportar: o chamador precisa ver que há algo não verificável,
    // porque metade de um plano aplicada é pior que nenhuma.
    const { naoEntendidos } = planoDaMigracao(
      'ALTER TABLE t ADD COLUMN c TEXT;\nDROP TABLE outra;',
    );
    expect(naoEntendidos).toHaveLength(1);
    expect(naoEntendidos[0]).toContain('DROP TABLE');
  });

  it('lê as migrações REAIS do repositório sem sobrar nada', () => {
    // Se alguém acrescentar uma migração com comando que o script não entende,
    // é aqui que descobre — no PR, e não no meio de um deploy.
    const arquivos = readdirSync('migrations').filter(f => f.endsWith('.sql'));
    expect(arquivos.length).toBeGreaterThan(0);
    for (const f of arquivos) {
      const plano = planoDaMigracao(readFileSync(`migrations/${f}`, 'utf8'));
      expect(plano.naoEntendidos, `${f} tem comando não verificável`).toEqual([]);
      expect(plano.passos.length).toBeGreaterThan(0);
    }
  });

  it('exige as duas colunas da 0002 — a que falhou e a que ninguém conferiu', () => {
    const plano = planoDaMigracao(readFileSync('migrations/0002_access_type.sql', 'utf8'));
    const checks = plano.passos.map(p => p.verificacao);
    expect(checks).toContain('SELECT "access_type" FROM "image_use_consent" LIMIT 0');
    expect(checks).toContain('SELECT "declaration_text" FROM "image_use_consent" LIMIT 0');
  });

  it('cobre toda coluna que o INSERT de consentimento escreve', () => {
    // O esquema e o INSERT são duas cópias da mesma regra e podem divergir em
    // silêncio: a divergência só aparece quando um consentimento real é
    // gravado, e esse caminho é best-effort — ou seja, some.
    const src = readFileSync('src/index.js', 'utf8');
    const bloco = src.match(/const CONSENT_COLS = \[([\s\S]*?)\];/);
    expect(bloco).not.toBeNull();
    const colunasDoCodigo = [...bloco[1].matchAll(/'([a-z_]+)'/g)].map(m => m[1]);
    expect(colunasDoCodigo.length).toBeGreaterThan(20);

    const esquema = readdirSync('migrations').filter(f => f.endsWith('.sql')).sort()
      .map(f => readFileSync(`migrations/${f}`, 'utf8')).join('\n');
    for (const coluna of colunasDoCodigo) {
      expect(esquema, `coluna ${coluna} não existe em migrations/`).toMatch(
        new RegExp(`\\b${coluna}\\b`),
      );
    }
  });
});

describe('nomeDeArquivoSeguro', () => {
  it('aceita os nomes que o wrangler gera', () => {
    expect(nomeDeArquivoSeguro('0002_access_type.sql')).toBe(true);
  });

  it('recusa nome que escaparia da string SQL', () => {
    // O nome vai para dentro de um INSERT. Uma aspa aqui é injeção.
    for (const mau of ["0003'; DROP TABLE d1_migrations; --.sql", '0003 x.sql', '../0001_consent.sql', '0003_sem_extensao']) {
      expect(nomeDeArquivoSeguro(mau)).toBe(false);
    }
  });
});

describe('primeiroJSON', () => {
  it('acha o JSON depois do banner do wrangler', () => {
    expect(primeiroJSON('\n ⛅️ wrangler 4.125.0\n────────\n[{"results":[{"name":"0001.sql"}]}]'))
      .toEqual([{ results: [{ name: '0001.sql' }] }]);
  });

  it('não se engana com o "[" de um aviso antes do JSON', () => {
    // `▲ [WARNING] …` aparece na saída real do wrangler. Procurar só o
    // primeiro "[" faria o parse morrer sobre um texto que não é JSON — e o
    // catch de quem chama trataria isso como "não consegui ler o livro-razão".
    expect(primeiroJSON('▲ [WARNING] Proxy detectado\n[{"results":[{"name":"0002.sql"}]}]'))
      .toEqual([{ results: [{ name: '0002.sql' }] }]);
  });

  it('lança quando não há JSON nenhum, em vez de devolver vazio', () => {
    // Devolver `[]` aqui viraria "nenhuma migração aplicada" e o script
    // tentaria reaplicar tudo. Falhar é o comportamento certo.
    expect(() => primeiroJSON('Authentication error [code: 10000]')).toThrow();
  });
});
