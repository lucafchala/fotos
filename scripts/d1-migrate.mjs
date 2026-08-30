// Aplica as migrações do D1 e, quando elas falham porque o efeito já está no
// banco, RETOMA a migração pela metade em vez de repetir o erro para sempre.
//
// -------------------------------------------------------------------------
// Por que este arquivo existe
// -------------------------------------------------------------------------
// `0002_access_type.sql` acrescenta duas colunas. O deploy de 30/08 falhou com
// `duplicate column name: access_type` — e não foi a primeira vez: o passo era
// `continue-on-error`, então repetiu a mesma falha em todo deploy desde 09/08
// sem nunca aparecer para ninguém.
//
// O que aconteceu é visível no próprio wrangler (`buildMigrationQuery`): cada
// migração é enviada como o CONTEÚDO DO ARQUIVO seguido de
// `INSERT INTO d1_migrations (name) …`, tudo numa requisição. O `/query` do D1
// não é transacional entre comandos. Então uma execução que aplique o primeiro
// `ALTER` e morra no segundo deixa exatamente este estado: a coluna existe, a
// linha no livro-razão não. A partir daí toda tentativa recomeça do primeiro
// `ALTER` e morre nele.
//
// A consequência que importa não é o vermelho no log. É que
// `migrations apply` processa os arquivos EM ORDEM e para no primeiro erro:
// com a 0002 travada, uma 0003 nunca seria aplicada. A próxima mudança de
// esquema entraria em produção sem o esquema, e o sintoma apareceria num
// INSERT em runtime — não aqui.
//
// -------------------------------------------------------------------------
// O que este script faz, e o que ele se recusa a fazer
// -------------------------------------------------------------------------
// Ele NÃO "ignora o erro" e NÃO marca migração como aplicada por decreto. Para
// cada comando de uma migração pendente ele pergunta ao banco se o efeito
// daquele comando já está lá, e só executa o que falta. Depois registra o
// arquivo no livro-razão e confirma que `migrations apply` passou a não ter
// nada a fazer.
//
// Se aparecer um comando cujo efeito ele não sabe verificar, ele PARA e diz
// qual é. Conservador de propósito: marcar como aplicada uma migração que não
// foi é pior do que o problema que este script resolve.
//
// Códigos de saída, porque o deploy.yml distingue os três casos:
//   0  esquema no lugar (aplicado agora, retomado agora, ou já estava)
//   1  esquema QUEBRADO ou irrecuperável — não promova código que escreve nele
//  75  indeterminado (rede, API, credencial) — o deploy segue, com aviso

import { spawnSync } from 'node:child_process';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

export const SAIDA_OK = 0;
export const SAIDA_QUEBRADO = 1;
export const SAIDA_INDETERMINADO = 75;

// -------------------------------------------------------------------------
// Parte pura: ler um .sql e dizer como verificar cada comando dele
// -------------------------------------------------------------------------

/**
 * Divide um arquivo .sql em comandos, sem os comentários.
 *
 * Os comentários importam: `-- ALTER TABLE …` numa linha de documentação não é
 * efeito nenhum, e as migrações deste repositório são cheias delas.
 */
export function dividirComandos(sql) {
  return sql
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/--[^\n]*/g, ' ')
    .split(';')
    .map(c => c.trim().replace(/\s+/g, ' '))
    .filter(Boolean);
}

/**
 * Classifica um comando em uma de duas formas de ser seguro:
 *
 *   idempotente        rodar de novo não faz mal (o próprio SQL diz
 *                      IF NOT EXISTS), então roda sem perguntar nada;
 *   verificacao        um SELECT que dá ERRO se, e somente se, o efeito do
 *                      comando ainda não estiver no banco. Passou = pula;
 *                      deu erro = falta, então executa o comando.
 *
 * Devolve null para o que não se encaixa em nenhuma das duas. Quem chama
 * trata null como "não dá para consertar sozinho", nunca como "tanto faz".
 */
export function classificar(comando) {
  const c = comando.trim();

  if (/^CREATE\s+TABLE\s+IF\s+NOT\s+EXISTS\s+/i.test(c)) return { tipo: 'create-table', idempotente: true };
  if (/^CREATE\s+(?:UNIQUE\s+)?INDEX\s+IF\s+NOT\s+EXISTS\s+/i.test(c)) return { tipo: 'create-index', idempotente: true };

  // `ADD COLUMN` é o caso que trouxe este script à existência: é o único
  // comando das migrações daqui que NÃO tem forma idempotente em SQLite.
  let m = c.match(/^ALTER\s+TABLE\s+"?([A-Za-z_]\w*)"?\s+ADD\s+(?:COLUMN\s+)?"?([A-Za-z_]\w*)"?/i);
  if (m) return { tipo: 'add-column', verificacao: `SELECT "${m[2]}" FROM "${m[1]}" LIMIT 0` };

  m = c.match(/^CREATE\s+TABLE\s+"?([A-Za-z_]\w*)"?/i);
  if (m) return { tipo: 'create-table', verificacao: `SELECT 1 FROM "${m[1]}" LIMIT 0` };

  return null;
}

/**
 * Traduz um arquivo de migração inteiro num plano executável.
 * `naoEntendidos` não vazio significa: não mexa neste banco sozinho.
 */
export function planoDaMigracao(sql) {
  const passos = [];
  const naoEntendidos = [];
  for (const comando of dividirComandos(sql)) {
    const forma = classificar(comando);
    if (!forma) naoEntendidos.push(comando.slice(0, 90));
    else passos.push({ comando, ...forma });
  }
  return { passos, naoEntendidos };
}

/** Nomes de migração que não são um nome de arquivo simples não entram em SQL. */
export function nomeDeArquivoSeguro(nome) {
  return /^[A-Za-z0-9._-]+\.sql$/.test(nome);
}

// -------------------------------------------------------------------------
// Parte que fala com a Cloudflare
// -------------------------------------------------------------------------

// `spawnSync` e não `execFileSync`: o segundo devolve só o stdout, e joga fora
// o stderr quando o comando dá certo. O wrangler manda ERRO para o stderr —
// era exatamente lá que estava `duplicate column name: access_type`. Um script
// de deploy que perde metade da saída do comando que executa não serve para
// diagnosticar o deploy.
function criarWrangler(versao) {
  return function wrangler(args) {
    const r = spawnSync('npx', ['--yes', `wrangler@${versao}`, ...args], {
      encoding: 'utf8',
      maxBuffer: 32 * 1024 * 1024,
    });
    const stdout = r.stdout || '';
    const stderr = r.stderr || '';
    return {
      ok: r.status === 0 && !r.error,
      stdout,
      stderr,
      // Para log e para casar padrão de erro: os dois fluxos, na ordem.
      saida: stdout + stderr + (r.error ? `\n${r.error.message}` : ''),
    };
  };
}

/**
 * Extrai o primeiro JSON da saída.
 *
 * Não basta procurar o primeiro `[` ou `{`: o wrangler imprime avisos como
 * `▲ [WARNING] …` antes, e um `[` de aviso faria o parse morrer sobre um texto
 * que não é JSON. Então tenta cada início candidato e devolve o primeiro que
 * realmente for JSON.
 */
export function primeiroJSON(texto) {
  for (let i = 0; i < texto.length; i++) {
    if (texto[i] !== '[' && texto[i] !== '{') continue;
    try {
      return JSON.parse(texto.slice(i));
    } catch {
      // Não era um JSON completo daqui; segue procurando.
    }
  }
  throw new Error('nenhum JSON na saída');
}

function migracoesAplicadas(wrangler, db) {
  const r = wrangler(['d1', 'execute', db, '--remote', '--yes', '--json',
    '--command', 'SELECT name FROM d1_migrations']);
  if (!r.ok) throw new Error(r.saida.trim().slice(-400));
  // Só o stdout: um aviso no stderr não é resposta da consulta.
  const dados = primeiroJSON(r.stdout);
  const linhas = (Array.isArray(dados) ? dados[0]?.results : dados?.results) || [];
  return new Set(linhas.map(l => l.name));
}

function main() {
  const db = process.argv[2] || 'fotos-consent';
  const dir = process.argv[3] || 'migrations';
  const versao = process.env.WRANGLER_VERSION;
  if (!versao) {
    console.error('::error::WRANGLER_VERSION não definida — o deploy.yml a deriva do node_modules.');
    return SAIDA_QUEBRADO;
  }
  const wrangler = criarWrangler(versao);

  // 1. O caminho normal. Na esmagadora maioria dos deploys termina aqui.
  const aplicar = wrangler(['d1', 'migrations', 'apply', db, '--remote']);
  console.log(aplicar.saida);
  if (aplicar.ok) {
    console.log('OK: migrações aplicadas (ou não havia nada pendente).');
    return SAIDA_OK;
  }

  // Um único formato de falha é recuperável: o banco dizendo que o objeto já
  // existe. Sintaxe, permissão e rede não são — e fingir que são esconderia
  // exatamente o que precisa ser visto.
  if (!/duplicate column name|already exists/i.test(aplicar.saida)) {
    console.error('::error::A migração do D1 falhou por um motivo que não é "já existe".');
    // Sem saber se o esquema está certo, travar o deploy por um problema de
    // rede seria pior que seguir: o esquema pode muito bem estar íntegro.
    return /fetch failed|ETIMEDOUT|ECONNRESET|socket hang up|ENOTFOUND|Authentication|code: 10000/i.test(aplicar.saida)
      ? SAIDA_INDETERMINADO
      : SAIDA_QUEBRADO;
  }
  console.log('\n== Falha do tipo "já existe": conferindo comando a comando ==');

  // 2. Quais migrações o banco ainda não registrou.
  let aplicadas;
  try {
    aplicadas = migracoesAplicadas(wrangler, db);
  } catch (err) {
    console.error(`::error::Não consegui ler d1_migrations: ${err.message}`);
    return SAIDA_INDETERMINADO;
  }

  const pendentes = readdirSync(dir).filter(f => f.endsWith('.sql')).sort()
    .filter(f => !aplicadas.has(f));
  console.log(`Registradas: ${[...aplicadas].join(', ') || '(nenhuma)'}`);
  console.log(`Pendentes:   ${pendentes.join(', ') || '(nenhuma)'}`);

  if (pendentes.length === 0) {
    // Nada pendente, mas o apply reclamou de duplicata: o erro veio de outro
    // lugar que não sabemos nomear. Não inventamos conserto.
    console.error('::error::Nada pendente no livro-razão, mas a aplicação falhou mesmo assim.');
    return SAIDA_QUEBRADO;
  }

  // 3. Retomar cada pendente, executando só o que falta.
  for (const arquivo of pendentes) {
    if (!nomeDeArquivoSeguro(arquivo)) {
      console.error(`::error::Nome de migração inesperado, não vou colocá-lo em SQL: ${arquivo}`);
      return SAIDA_QUEBRADO;
    }
    const { passos, naoEntendidos } = planoDaMigracao(readFileSync(join(dir, arquivo), 'utf8'));
    if (naoEntendidos.length) {
      console.error(`::error::Não sei verificar o efeito destes comandos de ${arquivo}:`);
      for (const c of naoEntendidos) console.error(`  ${c}`);
      console.error('::error::Aplique esta migração à mão e confira o esquema antes de promover.');
      return SAIDA_QUEBRADO;
    }

    console.log(`\n-- ${arquivo} (${passos.length} comando(s))`);
    for (const passo of passos) {
      const resumo = passo.comando.slice(0, 70);
      if (!passo.idempotente) {
        // A verificação passa se, e somente se, o efeito já estiver no banco.
        if (wrangler(['d1', 'execute', db, '--remote', '--yes', '--command', passo.verificacao]).ok) {
          console.log(`   já estava: ${resumo}`);
          continue;
        }
        // Não passou: falta. Executa o comando ORIGINAL do arquivo — este
        // script nunca escreve SQL que ele mesmo inventou.
      }
      const aplicado = wrangler(['d1', 'execute', db, '--remote', '--yes', '--command', passo.comando]);
      if (!aplicado.ok) {
        // A verificação disse que faltava e o banco diz que já existe. Quem
        // errou foi a VERIFICAÇÃO — um timeout, uma queda de rede no meio dela
        // — e não o esquema. Sem esta ressalva, um soluço de rede num SELECT
        // viraria "esquema quebrado" e travaria um deploy perfeitamente são.
        if (/duplicate column name|already exists/i.test(aplicado.saida)) {
          console.log(`   já estava (a verificação é que tinha falhado): ${resumo}`);
          continue;
        }
        console.error(`::error::Falhou ao aplicar de ${arquivo}: ${resumo}`);
        console.error(aplicado.saida);
        return SAIDA_QUEBRADO;
      }
      console.log(`   aplicado: ${resumo}`);
    }

    // O livro-razão só é escrito DEPOIS de todos os comandos do arquivo terem
    // sido confirmados um a um. A ordem é o que torna isto seguro.
    const registro = wrangler(['d1', 'execute', db, '--remote', '--yes', '--command',
      `INSERT OR IGNORE INTO d1_migrations (name) VALUES ('${arquivo}')`]);
    if (!registro.ok) {
      console.error(`::error::Comandos aplicados, mas não consegui registrar ${arquivo} no livro-razão.`);
      console.error(registro.saida);
      return SAIDA_QUEBRADO;
    }
    console.log(`   registrada em d1_migrations: ${arquivo}`);
  }

  // 4. A prova de que acabou: o próximo deploy tem de encontrar zero pendências.
  const conferencia = wrangler(['d1', 'migrations', 'apply', db, '--remote']);
  console.log(`\n== Conferência final ==\n${conferencia.saida}`);
  if (!conferencia.ok) {
    console.error('::error::Depois do conserto, `migrations apply` ainda falha.');
    return SAIDA_QUEBRADO;
  }
  console.log('OK: esquema no lugar e livro-razão em dia.');
  return SAIDA_OK;
}

// `import.meta.main` não existe em todo Node 22; comparar os caminhos, sim.
if (process.argv[1] && process.argv[1].endsWith('d1-migrate.mjs')) {
  process.exit(main());
}
