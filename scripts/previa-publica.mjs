// Publica a prévia do PR com os segredos do build — e assim toda prévia, nova
// ou já existente, fica com os valores atuais (README, "Prévia de PR").
//
// -------------------------------------------------------------------------
// Por que este arquivo existe
// -------------------------------------------------------------------------
// A Cloudflare dá às prévias uma "configuração base" de segredos, mas ela só
// vale na CRIAÇÃO de cada prévia: "Later changes to Base secrets apply only to
// new Previews, so active Previews remain unchanged" (documentação de Worker
// Previews, "Configuration → Secrets"). Foi o que se viu na estreia, em
// 12/10/2026: a prévia do PR #236 nasceu com o ADMIN_PASSWORD e sem os outros,
// e o que fosse cadastrado na base depois não chegaria a ela. E o valor de um
// segredo não se lê de volta — não há como copiar da base para uma prévia que
// já existe.
//
// Então a fonte passa a ser o BUILD: as variáveis e segredos do Workers Builds
// (Settings → Builds), com o prefixo PREVIA_. A cada push, este script publica
// a prévia com `wrangler preview --secrets-file`: os valores entram junto com
// o código, na mesma implantação. Trocou um valor? O próximo build de cada PR
// já sai com ele.
//
// -------------------------------------------------------------------------
// O que ele aceita, e o que ele recusa
// -------------------------------------------------------------------------
// Só os nomes de SEGREDOS_DA_PREVIA, e só com o prefixo: um RESEND_API_KEY sem
// prefixo no ambiente do build não é lido. Outro PREVIA_* (o segredo do
// Turnstile, o do Kuma, o da Web Analytics) é ignorado com aviso — a prévia
// usa as chaves de teste do Turnstile e desliga os outros dois de qualquer
// jeito. Valor vazio ou só espaço não sobe: o site leria "configurado" onde
// não está.
//
// Nenhum valor é impresso, só nomes. O arquivo de segredos fica numa pasta
// temporária própria, com permissão 0600, e é apagado no fim, com sucesso ou
// não.
//
// O que ele NÃO faz: apagar. Tirar um PREVIA_* do build não tira o segredo de
// uma prévia que já o recebeu (para isso, `npx wrangler preview secret delete
// <NOME> --name <prévia>`). E sem nenhum PREVIA_* no build ele publica a
// prévia do mesmo jeito, avisando no log.
//
// Uso — o "Preview command" do Workers Builds: npm run previa
// Argumentos a mais vão para o `wrangler preview` (npm run previa -- --name x).

import { spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

/** Os segredos que uma prévia recebe — a tabela do README, "Prévia de PR". */
export const SEGREDOS_DA_PREVIA = /** @type {const} */ ([
  'ADMIN_PASSWORD',
  'SIGNING_SECRET',
  'RESEND_API_KEY',
  'ADMIN_EMAIL',
  'GOOGLE_DRIVE_API_KEY',
]);

export const PREFIXO = 'PREVIA_';

/**
 * Lê do ambiente do build os segredos da prévia. Puro: não toca disco nem rede.
 * @param {Record<string, string | undefined>} env
 */
export function segredosDoBuild(env) {
  /** @type {Record<string, string>} */
  const segredos = {};
  /** @type {string[]} */
  const vazios = [];
  /** @type {string[]} */
  const ausentes = [];
  for (const nome of SEGREDOS_DA_PREVIA) {
    const valor = env[PREFIXO + nome];
    if (valor === undefined) ausentes.push(PREFIXO + nome);
    else if (valor.trim() === '') vazios.push(PREFIXO + nome);
    else segredos[nome] = valor;
  }
  const conhecidos = new Set(SEGREDOS_DA_PREVIA.map((nome) => PREFIXO + nome));
  const ignorados = Object.keys(env)
    .filter((chave) => chave.startsWith(PREFIXO) && !conhecidos.has(chave))
    .sort();
  return { segredos, ausentes, vazios, ignorados };
}

/**
 * Os argumentos do `npx`: `--secrets-file` só quando há o que subir.
 * @param {string | null} arquivo
 * @param {string[]} extras
 */
export function argumentosDoWrangler(arquivo, extras) {
  return ['wrangler', 'preview', ...(arquivo ? ['--secrets-file', arquivo] : []), ...extras];
}

/** @returns {number} o código de saída */
function main() {
  const { segredos, ausentes, vazios, ignorados } = segredosDoBuild(process.env);
  for (const chave of ignorados) {
    console.warn(`[prévia] ${chave} ignorado: não é segredo de prévia (README, "Prévia de PR").`);
  }
  for (const chave of vazios) console.warn(`[prévia] ${chave} está vazio no build: não sobe.`);

  const nomes = Object.keys(segredos);
  /** @type {string | null} */
  let pasta = null;
  /** @type {string | null} */
  let arquivo = null;
  if (nomes.length) {
    pasta = mkdtempSync(join(tmpdir(), 'previa-segredos-'));
    arquivo = join(pasta, 'segredos.json');
    writeFileSync(arquivo, JSON.stringify(segredos), { mode: 0o600 });
    console.log(`[prévia] segredos do build que vão junto: ${nomes.join(', ')}.`);
    if (ausentes.length) {
      console.log(`[prévia] sem valor no build (a prévia fica com o que já tiver): ${ausentes.join(', ')}.`);
    }
  } else {
    console.warn('[prévia] nenhum PREVIA_* no build: a prévia sai sem segredos novos (README, "Prévia de PR").');
  }

  try {
    const r = spawnSync('npx', argumentosDoWrangler(arquivo, process.argv.slice(2)), { stdio: 'inherit' });
    if (r.error) {
      console.error(`[prévia] não deu para rodar o wrangler: ${r.error.message}`);
      return 1;
    }
    return r.status ?? 1;
  } finally {
    if (pasta) rmSync(pasta, { recursive: true, force: true });
  }
}

// `import.meta.main` não existe em todo Node 22; comparar os caminhos, sim.
if (process.argv[1] && process.argv[1].endsWith('previa-publica.mjs')) {
  process.exitCode = main();
}
