// Segredos das prévias, sincronizados a cada build — scripts/previa-publica.mjs.
//
// A configuração base de prévias da Cloudflare só vale na criação de cada
// prévia; o script faz cada build levar os valores atuais à prévia do PR. O
// que precisa estar certo: só os nomes da tabela do README sobem, só com o
// prefixo; nenhum valor aparece no log; o arquivo de segredos não fica para
// trás; e o código de saída do wrangler chega ao build. Por isso o script roda
// de verdade aqui, com um `npx` falso no PATH.

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdtempSync, writeFileSync, readFileSync, readdirSync, existsSync, rmSync, chmodSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, delimiter } from 'node:path';
import { spawnSync } from 'node:child_process';
import { execPath, env as ambienteDoTeste } from 'node:process';
import { fileURLToPath } from 'node:url';
import {
  SEGREDOS_DA_PREVIA, PREFIXO, segredosDoBuild, argumentosDoWrangler,
} from '../scripts/previa-publica.mjs';

const SCRIPT = fileURLToPath(new URL('../scripts/previa-publica.mjs', import.meta.url));
const README = readFileSync(new URL('../README.md', import.meta.url), 'utf8');
const PACOTE = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
const FONTES = readdirSync(new URL('../src/', import.meta.url))
  .filter((f) => f.endsWith('.js'))
  .map((f) => readFileSync(new URL(`../src/${f}`, import.meta.url), 'utf8'))
  .join('\n');

describe('segredosDoBuild', () => {
  it('lê só os nomes da lista, só com o prefixo', () => {
    const { segredos, ausentes } = segredosDoBuild({
      PREVIA_SIGNING_SECRET: 'a'.repeat(48),
      PREVIA_RESEND_API_KEY: 're_teste',
      RESEND_API_KEY: 'sem-prefixo-nao-conta',
      ADMIN_EMAIL: 'sem-prefixo@exemplo.com',
    });
    expect(segredos).toEqual({ SIGNING_SECRET: 'a'.repeat(48), RESEND_API_KEY: 're_teste' });
    expect(ausentes).toEqual(['PREVIA_ADMIN_PASSWORD', 'PREVIA_ADMIN_EMAIL', 'PREVIA_GOOGLE_DRIVE_API_KEY']);
  });

  it('o que a prévia não deve receber fica de fora, com aviso', () => {
    const { segredos, ignorados } = segredosDoBuild({
      PREVIA_TURNSTILE_SECRET_KEY: 'x',
      PREVIA_KUMA_PUSH_URL: 'https://kuma.exemplo/api/push/x',
      PREVIA_CF_ANALYTICS_TOKEN: 'x',
      PREVIA_ADMIN_EMAIL: 'dono@exemplo.com',
    });
    expect(segredos).toEqual({ ADMIN_EMAIL: 'dono@exemplo.com' });
    expect(ignorados).toEqual(['PREVIA_CF_ANALYTICS_TOKEN', 'PREVIA_KUMA_PUSH_URL', 'PREVIA_TURNSTILE_SECRET_KEY']);
  });

  it('valor vazio ou só espaço não sobe', () => {
    const { segredos, vazios } = segredosDoBuild({ PREVIA_ADMIN_PASSWORD: '', PREVIA_SIGNING_SECRET: '  \n' });
    expect(segredos).toEqual({});
    expect(vazios).toEqual(['PREVIA_ADMIN_PASSWORD', 'PREVIA_SIGNING_SECRET']);
  });

  it('o valor sobe como está — sem aparar', () => {
    expect(segredosDoBuild({ PREVIA_ADMIN_PASSWORD: ' senha com espaço ' }).segredos)
      .toEqual({ ADMIN_PASSWORD: ' senha com espaço ' });
  });
});

describe('argumentosDoWrangler', () => {
  it('com segredos: `wrangler preview --secrets-file`, e os extras no fim', () => {
    expect(argumentosDoWrangler('/tmp/s.json', ['--name', 'x']))
      .toEqual(['wrangler', 'preview', '--secrets-file', '/tmp/s.json', '--name', 'x']);
  });

  it('sem segredos: o `wrangler preview` de sempre', () => {
    expect(argumentosDoWrangler(null, [])).toEqual(['wrangler', 'preview']);
  });
});

describe('a lista confere com o resto do repositório', () => {
  it('cada segredo da lista é lido pelo Worker', () => {
    for (const nome of SEGREDOS_DA_PREVIA) {
      expect(FONTES, nome).toMatch(new RegExp(`env\\??\\.${nome}\\b`));
    }
  });

  it('o README dá o nome com o prefixo de cada um', () => {
    for (const nome of SEGREDOS_DA_PREVIA) expect(README).toContain(`\`${PREFIXO}${nome}\``);
  });

  it('nenhum dos que o README manda NÃO copiar está na lista', () => {
    for (const nome of ['TURNSTILE_SECRET_KEY', 'KUMA_PUSH_URL', 'CF_ANALYTICS_TOKEN']) {
      expect(SEGREDOS_DA_PREVIA).not.toContain(nome);
    }
  });

  it('`npm run previa` roda este script — é o "Preview command" do Workers Builds', () => {
    expect(PACOTE.scripts.previa).toBe('node scripts/previa-publica.mjs');
  });
});

describe('o script de verdade, com um `npx` falso', () => {
  /** @type {string} */
  let pasta;
  /** @type {string} */
  let registro;

  beforeAll(() => {
    pasta = mkdtempSync(join(tmpdir(), 'previa-publica-teste-'));
    registro = join(pasta, 'registro.json');
    // O falso anota os argumentos e, do arquivo de segredos, só os NOMES, a
    // permissão e se ele existia — o valor fica no arquivo, longe do registro.
    const npx = join(pasta, 'npx');
    writeFileSync(npx, [
      `#!${execPath}`,
      "const fs = require('node:fs');",
      'const args = process.argv.slice(2);',
      "const i = args.indexOf('--secrets-file');",
      'const arq = i >= 0 ? args[i + 1] : null;',
      'const info = { args, arquivo: arq, nomes: null, modo: null };',
      'if (arq) {',
      "  info.nomes = Object.keys(JSON.parse(fs.readFileSync(arq, 'utf8'))).sort();",
      '  info.modo = (fs.statSync(arq).mode & 0o777).toString(8);',
      '}',
      'fs.writeFileSync(process.env.REGISTRO, JSON.stringify(info));',
      "process.exit(Number(process.env.SAIDA_DO_FALSO || '0'));",
    ].join('\n'));
    chmodSync(npx, 0o755);
  });

  afterAll(() => rmSync(pasta, { recursive: true, force: true }));

  /** @param {Record<string, string>} extra @param {string[]} [args] */
  function roda(extra, args = []) {
    /** @type {Record<string, string | undefined>} */
    const env = { ...ambienteDoTeste, ...extra, PATH: `${pasta}${delimiter}${ambienteDoTeste.PATH ?? ''}`, REGISTRO: registro };
    for (const chave of Object.keys(env)) if (chave.startsWith(PREFIXO) && !(chave in extra)) delete env[chave];
    rmSync(registro, { force: true });
    const r = spawnSync(execPath, [SCRIPT, ...args], { env, encoding: 'utf8' });
    return { ...r, info: existsSync(registro) ? JSON.parse(readFileSync(registro, 'utf8')) : null };
  }

  it('sobe os segredos do build, sem imprimir valor, e apaga o arquivo', () => {
    const valores = {
      PREVIA_SIGNING_SECRET: 'segredo-de-assinatura-da-previa-0123456789abcdef',
      PREVIA_RESEND_API_KEY: 're_valor_que_nao_pode_vazar',
      PREVIA_ADMIN_EMAIL: 'dono@exemplo.com',
      PREVIA_KUMA_PUSH_URL: 'https://kuma.exemplo/api/push/token-que-nao-pode-vazar',
    };
    const r = roda(valores, ['--name', 'minha-previa']);
    expect(r.status).toBe(0);
    expect(r.info.args.slice(0, 3)).toEqual(['wrangler', 'preview', '--secrets-file']);
    expect(r.info.args.slice(-2)).toEqual(['--name', 'minha-previa']);
    expect(r.info.nomes).toEqual(['ADMIN_EMAIL', 'RESEND_API_KEY', 'SIGNING_SECRET']);
    expect(r.info.modo).toBe('600');
    expect(existsSync(r.info.arquivo)).toBe(false);
    const log = r.stdout + r.stderr;
    for (const valor of Object.values(valores)) expect(log).not.toContain(valor);
    expect(log).toContain('SIGNING_SECRET, RESEND_API_KEY, ADMIN_EMAIL');
    expect(log).toContain('PREVIA_KUMA_PUSH_URL ignorado');
  });

  it('sem PREVIA_* no build, publica do mesmo jeito, sem `--secrets-file`', () => {
    const r = roda({});
    expect(r.status).toBe(0);
    expect(r.info.args).toEqual(['wrangler', 'preview']);
    expect(r.stderr).toContain('nenhum PREVIA_*');
  });

  it('a falha do wrangler é a falha do build — e o arquivo some mesmo assim', () => {
    const r = roda({ PREVIA_ADMIN_PASSWORD: 'senha-da-previa', SAIDA_DO_FALSO: '3' });
    expect(r.status).toBe(3);
    expect(r.info.nomes).toEqual(['ADMIN_PASSWORD']);
    expect(existsSync(r.info.arquivo)).toBe(false);
  });
});
