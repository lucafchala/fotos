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
import { spawnSync, spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { execPath, env as ambienteDoTeste } from 'node:process';
import { fileURLToPath } from 'node:url';
import {
  SEGREDOS_DA_PREVIA, PREFIXO, segredosDoBuild, argumentosDoWrangler, geraSegredo,
} from '../scripts/previa-publica.mjs';

const SCRIPT = fileURLToPath(new URL('../scripts/previa-publica.mjs', import.meta.url));
const README = readFileSync(new URL('../README.md', import.meta.url), 'utf8');
const PACOTE = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
const FONTES = readdirSync(new URL('../src/', import.meta.url))
  .filter((f) => f.endsWith('.js'))
  .map((f) => readFileSync(new URL(`../src/${f}`, import.meta.url), 'utf8'))
  .join('\n');

/** Gerador fixo: o teste vê ONDE o segredo gerado entra, sem depender do sorteio. */
const gera = () => 'gerado-no-teste';

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
    }, gera);
    expect(segredos).toEqual({ ADMIN_EMAIL: 'dono@exemplo.com', SIGNING_SECRET: 'gerado-no-teste' });
    expect(ignorados).toEqual(['PREVIA_CF_ANALYTICS_TOKEN', 'PREVIA_KUMA_PUSH_URL', 'PREVIA_TURNSTILE_SECRET_KEY']);
  });

  it('valor vazio ou só espaço não sobe', () => {
    const { segredos, vazios } = segredosDoBuild({ PREVIA_ADMIN_PASSWORD: '', PREVIA_SIGNING_SECRET: '  \n' }, gera);
    // …e o SIGNING_SECRET em branco no build é tratado como ausente: gerado.
    expect(segredos).toEqual({ SIGNING_SECRET: 'gerado-no-teste' });
    expect(vazios).toEqual(['PREVIA_ADMIN_PASSWORD', 'PREVIA_SIGNING_SECRET']);
  });

  it('o valor sobe como está — sem aparar', () => {
    expect(segredosDoBuild({ PREVIA_ADMIN_PASSWORD: ' senha com espaço ' }, gera).segredos)
      .toEqual({ ADMIN_PASSWORD: ' senha com espaço ', SIGNING_SECRET: 'gerado-no-teste' });
  });

  it('sem PREVIA_SIGNING_SECRET, o build gera um — e não o conta como ausente', () => {
    const r = segredosDoBuild({}, gera);
    expect(r.segredos).toEqual({ SIGNING_SECRET: 'gerado-no-teste' });
    expect(r.gerados).toEqual(['SIGNING_SECRET']);
    expect(r.ausentes).not.toContain('PREVIA_SIGNING_SECRET');
  });

  it('com PREVIA_SIGNING_SECRET, vale o do build', () => {
    const r = segredosDoBuild({ PREVIA_SIGNING_SECRET: 'b'.repeat(40) }, gera);
    expect(r.segredos.SIGNING_SECRET).toBe('b'.repeat(40));
    expect(r.gerados).toEqual([]);
  });
});

describe('geraSegredo', () => {
  it('64 caracteres de base64, acima do piso de 32 do Worker, e outro a cada vez', () => {
    const a = geraSegredo();
    expect(a).toMatch(/^[A-Za-z0-9+/]{64}$/);
    expect(geraSegredo()).not.toBe(a);
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
    // O falso anota os argumentos e, do arquivo de segredos, só os NOMES, o
    // tamanho de cada valor e a permissão — o valor fica no arquivo, longe do
    // registro.
    const npx = join(pasta, 'npx');
    writeFileSync(npx, [
      `#!${execPath}`,
      "const fs = require('node:fs');",
      'const args = process.argv.slice(2);',
      "const i = args.indexOf('--secrets-file');",
      'const arq = i >= 0 ? args[i + 1] : null;',
      'const info = { args, arquivo: arq, nomes: null, tamanhos: null, modo: null };',
      'if (arq) {',
      "  const segredos = JSON.parse(fs.readFileSync(arq, 'utf8'));",
      '  info.nomes = Object.keys(segredos).sort();',
      '  info.tamanhos = Object.fromEntries(Object.entries(segredos).map(([k, v]) => [k, v.length]));',
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

  it('sem PREVIA_* no build, publica do mesmo jeito — com o SIGNING_SECRET gerado, que não aparece no log', () => {
    const r = roda({});
    expect(r.status).toBe(0);
    expect(r.info.args.slice(0, 3)).toEqual(['wrangler', 'preview', '--secrets-file']);
    expect(r.info.nomes).toEqual(['SIGNING_SECRET']);
    expect(r.info.tamanhos).toEqual({ SIGNING_SECRET: 64 });
    expect(r.stderr).toContain('nenhum PREVIA_*');
    expect(r.stdout).toContain('SIGNING_SECRET: gerado neste build');
    expect(r.stdout + r.stderr).not.toMatch(/[A-Za-z0-9+/]{40,}/);
  });

  it('a falha do wrangler é a falha do build — e o arquivo some mesmo assim', () => {
    const r = roda({ PREVIA_ADMIN_PASSWORD: 'senha-da-previa', SAIDA_DO_FALSO: '3' });
    expect(r.status).toBe(3);
    expect(r.info.nomes).toEqual(['ADMIN_PASSWORD', 'SIGNING_SECRET']);
    expect(existsSync(r.info.arquivo)).toBe(false);
  });
});

// O wrangler DE VERDADE, contra uma API falsa da Cloudflare
// (CLOUDFLARE_API_BASE_URL). Não há conta nem token aqui, e é justamente o que
// o `npx` falso acima não prova: que o `wrangler preview --secrets-file` põe
// os segredos NA publicação, e com os bindings da PRÉVIA (KV `fotos-previa`,
// AMBIENTE = "previa"), nunca os de produção. Foi este teste, rodado à mão em
// 12/10/2026, que separou "o script não funciona" de "o build não rodou o
// script" (README, "Prévia de PR" → "Para conferir se pegou").
//
// Ele conhece os caminhos da API de prévias que o wrangler chama. Se uma
// versão nova do wrangler mudar esse diálogo e o teste quebrar, confira o
// que mudou antes de mexer no script.
describe('o wrangler de verdade, contra uma API falsa da Cloudflare', () => {
  const TOML = readFileSync(new URL('../wrangler.toml', import.meta.url), 'utf8');
  const CONTA = /^account_id\s*=\s*"([0-9a-f]{32})"/m.exec(TOML)?.[1] ?? '';
  const KV_DA_PREVIA = /\[\[previews\.kv_namespaces\]\][^[]*?id\s*=\s*"([0-9a-f]{32})"/.exec(TOML)?.[1] ?? '';

  it('a publicação leva os segredos e os bindings da prévia', async () => {
    expect(CONTA).not.toBe('');
    expect(KV_DA_PREVIA).not.toBe('');
    /** @type {{ metodo: string, caminho: string, env?: Record<string, any> }[]} */
    const pedidos = [];
    const servidor = createServer((req, res) => {
      /** @type {Buffer[]} */
      const partes = [];
      req.on('data', (c) => partes.push(c));
      req.on('end', () => {
        const caminho = new URL(req.url ?? '/', 'http://x').pathname;
        /** @type {{ metodo: string, caminho: string, env?: Record<string, any> }} */
        const pedido = { metodo: req.method ?? '', caminho };
        if (req.method === 'POST' && /\/previews\/[^/]+\/deployments$/.test(caminho)) {
          const fronteira = '--' + (/boundary=([^;]+)/.exec(req.headers['content-type'] ?? '')?.[1] ?? '');
          const parte = Buffer.concat(partes).toString('utf8').split(fronteira).find((x) => x.includes('name="metadata"')) ?? '';
          pedido.env = JSON.parse(parte.slice(parte.indexOf('\r\n\r\n') + 4).replace(/\r\n$/, '')).env;
        }
        pedidos.push(pedido);
        /** @param {unknown} result */
        const responde = (result) => {
          res.writeHead(200, { 'content-type': 'application/json' });
          res.end(JSON.stringify({ success: true, errors: [], messages: [], result }));
        };
        if (/\/previews\/[^/]+$/.test(caminho)) responde({ id: 'prev-1', slug: 'teste', name: 'teste', urls: [] });
        else if (/\/deployments\/latest$/.test(caminho)) responde({ id: 'dep-0', migration_tag: 'v1' });
        else if (/\/deployments$/.test(caminho)) responde({ id: 'dep-1', env: {}, urls: [] });
        else if (/\/workers\/workers\/[^/]+$/.test(caminho)) responde({ previews_base_config: {} });
        else responde({});
      });
    });
    await new Promise((ok) => servidor.listen(0, '127.0.0.1', () => ok(null)));
    const endereco = servidor.address();
    const porta = typeof endereco === 'object' && endereco ? endereco.port : 0;

    /** @type {Record<string, string | undefined>} */
    const env = {
      ...ambienteDoTeste,
      CLOUDFLARE_API_BASE_URL: `http://127.0.0.1:${porta}/client/v4`,
      CLOUDFLARE_API_TOKEN: 'token-falso',
      CLOUDFLARE_ACCOUNT_ID: CONTA,
      WRANGLER_SEND_METRICS: 'false',
      CI: 'true',
      PREVIA_RESEND_API_KEY: 're_valor_do_teste_que_nao_pode_vazar',
      PREVIA_ADMIN_EMAIL: 'dono@exemplo.com',
    };
    // A API falsa é local: nenhum proxy no caminho (o wrangler usa o do
    // ambiente para tudo, até para 127.0.0.1).
    for (const chave of ['HTTPS_PROXY', 'HTTP_PROXY', 'https_proxy', 'http_proxy']) delete env[chave];
    for (const chave of Object.keys(env)) {
      if (chave.startsWith(PREFIXO) && !['PREVIA_RESEND_API_KEY', 'PREVIA_ADMIN_EMAIL'].includes(chave)) delete env[chave];
    }

    const filho = spawn(execPath, [SCRIPT, '--name', 'teste'], { env, cwd: fileURLToPath(new URL('..', import.meta.url)) });
    let saida = '';
    filho.stdout.on('data', (c) => { saida += c; });
    filho.stderr.on('data', (c) => { saida += c; });
    const codigo = await new Promise((ok) => filho.on('close', ok));
    servidor.close();

    expect(codigo, saida).toBe(0);
    const publicacoes = pedidos.filter((p) => p.env);
    expect(publicacoes).toHaveLength(1);
    const enviado = publicacoes[0].env ?? {};
    for (const nome of ['RESEND_API_KEY', 'ADMIN_EMAIL', 'SIGNING_SECRET']) expect(enviado[nome]?.type, nome).toBe('secret_text');
    expect(enviado.RESEND_API_KEY.text).toBe('re_valor_do_teste_que_nao_pode_vazar');
    expect(enviado.SIGNING_SECRET.text).toMatch(/^[A-Za-z0-9+/]{64}$/);
    expect(enviado.AMBIENTE).toEqual({ type: 'plain_text', text: 'previa' });
    expect(enviado.FOTOS?.namespace_id).toBe(KV_DA_PREVIA);
    expect(Object.keys(enviado)).not.toContain('TURNSTILE_SECRET_KEY');
    expect(saida).not.toContain('re_valor_do_teste_que_nao_pode_vazar');
    expect(saida).not.toContain(enviado.SIGNING_SECRET.text);
  }, 120_000);
});
