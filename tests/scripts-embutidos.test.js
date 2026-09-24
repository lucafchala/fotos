// Lint e typecheck dos scripts que as páginas EMITEM (issue #127).
//
// Os <script> das páginas vivem dentro de template literals em src/ui/**, e
// para o ESLint e o tsc aquilo é uma string: código de produção sem rede
// nenhuma. O preço já foi cobrado — um `const` usado antes da declaração
// morreu em TDZ engolido por um try/catch, e funções mortas sobreviveram à
// remoção dos handlers inline sem ninguém perceber.
//
// Não dá para checar o arquivo-fonte (o JS está dentro de uma string), mas dá
// para checar o que SAI: renderiza cada página, extrai os blocos executáveis
// e passa cada um pelo Linter do próprio ESLint, como script clássico de
// browser — e pelo tsc, com os tipos do DOM.

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, basename } from 'node:path';
import { spawnSync } from 'node:child_process';
import { execPath } from 'node:process';
import { fileURLToPath } from 'node:url';
import { Linter } from 'eslint';
import { paginas, blocos, EVENTO } from './helpers/paginas.js';
import { eventHTML } from '../src/ui/event.js';
import { galleryHTML } from '../src/ui/gallery.js';
import { supportHTML } from '../src/ui/support.js';
import { loginHTML } from '../src/ui/dashboard.js';

// Globais de browser que os scripts USAM de fato, uma por uma. Lista fechada
// de propósito: um nome que não esteja aqui é erro de digitação ou global
// implícito, e é isso que o `no-undef` existe para pegar. Global nova e
// legítima entra aqui com o mesmo cuidado com que entraria num import.
const GLOBAIS_DO_BROWSER = [
  'window', 'document', 'console', 'navigator', 'location', 'history', 'performance',
  'localStorage', 'sessionStorage', 'fetch', 'URL', 'URLSearchParams', 'Blob', 'FileReader', 'Image',
  'setTimeout', 'clearTimeout', 'setInterval', 'requestAnimationFrame',
  'addEventListener', 'innerWidth', 'innerHeight', 'scrollY', 'scrollTo',
  // Carregado pelo <script> do Turnstile, de fora; os blocos testam
  // `typeof turnstile` antes de usar.
  'turnstile',
];

const REGRAS = {
  'no-undef': 'error',
  // Parâmetros e erros de catch não usados são idioma da base
  // (`catch(_) {}`); variável e função mortas, não.
  'no-unused-vars': ['error', { args: 'none', caughtErrors: 'none' }],
  // `variables: true` é o que pega o TDZ que já mordeu: `const` lido por uma
  // função chamada ANTES de a linha da declaração rodar. Funções declaradas
  // são içadas pelo JS, então ficam de fora.
  'no-use-before-define': ['error', { functions: false, classes: true, variables: true }],
  'no-redeclare': 'error',
  'no-dupe-keys': 'error',
  'no-unreachable': 'error',
  'no-const-assign': 'error',
};

const linter = new Linter();

// Funções que o HTML chama PELO NOME (`data-callback="onTurnstileSuccess"`
// do widget do Turnstile) não têm chamador visível dentro do script. Em vez
// de desligar a regra, elas são declaradas "exportadas" a partir do próprio
// HTML — assim, renomear a função sem renomear o atributo ainda reprova.
/** @param {string} html */
function chamadasPeloNome(html) {
  return [...html.matchAll(/data-(?:error-|expired-)?callback="([A-Za-z_$][\w$]*)"/g)].map(m => m[1]);
}

/** @param {string} html @param {string} src */
function lint(html, src) {
  const exportadas = chamadasPeloNome(html);
  const prefixo = exportadas.length ? `/* exported ${exportadas.join(', ')} */\n` : '';
  return linter.verify(prefixo + src, [{
    languageOptions: {
      ecmaVersion: 'latest',
      sourceType: 'script',
      globals: Object.fromEntries(GLOBAIS_DO_BROWSER.map(g => [g, 'readonly'])),
    },
    rules: REGRAS,
  }]).map(m => `${m.line - (prefixo ? 1 : 0)}:${m.column} ${m.ruleId}: ${m.message}`);
}

// Cada variação que muda o SCRIPT emitido, não só a marcação.
function variacoes() {
  const muitos = Array.from({ length: 15 }, (_, i) => ({ ...EVENTO, id: `e${i}`, slug: `evento-${i}`, date: `2025-01-${String(i + 1).padStart(2, '0')}` }));
  return {
    ...paginas(),
    loginComErro: loginHTML({ error: true }, 'NONCE'),
    loginVerificacao: loginHTML({ verificacao: true }, 'NONCE'),
    galeriaComBeaconEMais: galleryHTML([...muitos, { ...EVENTO, pinned: true }], 'tok', 'NONCE'),
    eventoEmBreve: eventHTML({ ...EVENTO, comingSoon: true }, '2026', null, 'NONCE', 'dn', 'ft'),
    eventoCarrosselComBeacon: eventHTML({
      ...EVENTO, photos: [EVENTO.photos[0], 'https://lh3.googleusercontent.com/d/BBB'],
      driveUrlInstagram: 'https://drive.google.com/y', accessType: 'family',
      photosAlert: { active: true, addedAt: '2026-06-19T00:00:00Z', expiresAfterHours: 0 },
    }, '2026', 'tok', 'NONCE', 'dn', 'ft'),
    suporteComErro: supportHTML(false, 'erro', { name: 'x' }, 'NONCE', 'ft'),
  };
}

describe('lint dos scripts emitidos pelas páginas (#127)', () => {
  it.each(Object.keys(variacoes()))('%s: nenhum bloco tem global implícita, código morto ou uso antes da declaração', nome => {
    const html = variacoes()[nome];
    const achados = blocos(html).js.flatMap((src, i) => lint(html, src).map(a => `bloco #${i} ${a}`));
    expect(achados).toEqual([]);
  });

  it('o próprio lint acusa os defeitos que já existiram nesta base', () => {
    // Sem isto, uma configuração quebrada (regra desligada, lista de globais
    // aberta) passaria verde sobre qualquer página.
    const html = '<script nonce="N"></script>';
    expect(lint(html, 'function ovClick(e) { return e; }').join()).toMatch(/no-unused-vars/);
    expect(lint(html, 'init();\nfunction init() { return CHAVE; }\nconst CHAVE = 1;').join()).toMatch(/no-use-before-define/);
    expect(lint(html, 'perfCount("x");').join()).toMatch(/no-undef/);
    expect(lint('<div data-callback="ok"></div>', 'function ok() {}')).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// Typecheck
// ---------------------------------------------------------------------------
// O TypeScript do projeto é o 7 (o nativo), que NÃO tem API JavaScript — não
// dá para chamar o checker de dentro do vitest como se faz com o Linter. Então
// o teste escreve os blocos num diretório temporário e roda o `tsc` de verdade
// sobre eles, uma vez só (~0,2 s).
//
// Um arquivo por página: no navegador os blocos de uma página dividem o mesmo
// escopo global, então vão juntos, na ordem. O `export {}` no fim faz de cada
// arquivo um módulo, para que páginas diferentes não se enxerguem — duas
// páginas declarando a mesma função seriam "redeclaração" para o tsc.
//
// Sem `strict`: o ganho é a propriedade digitada errada, o método que não
// existe e a chamada com argumento a menos nas APIs do DOM e do JS. O que o tsc
// não tem como saber sozinho está em tests/helpers/scripts-embutidos.d.ts,
// em listas fechadas.
const TSC = fileURLToPath(new URL('../node_modules/typescript/bin/tsc', import.meta.url));
const TIPOS = fileURLToPath(new URL('./helpers/scripts-embutidos.d.ts', import.meta.url));

// Amostras de defeito, checadas na MESMA execução do tsc que as páginas. Sem
// elas, uma configuração quebrada (checkJs desligado, arquivo fora do
// programa, lista aberta demais no .d.ts) passaria verde sobre qualquer página.
const AMOSTRAS = {
  metodoDoDocument: ['document.getElementByID("x");', 'TS2551'],
  // Elemento continua tipado: a lista de subtipo não virou `any` geral.
  metodoDoElemento: ['document.getElementById("x").classList.contians("y");', 'TS2551'],
  propriedadeDoElemento: ['document.getElementById("x").vlaue = "";', 'TS2551'],
  // O contrato entre blocos é lista fechada: nome errado numa ponta acusa.
  sinalEmWindow: ['window.__tsBlockd = true;', 'TS2551'],
  metodoDoTurnstile: ['turnstile.rest();', 'TS2551'],
  argumentoAMenos: ['JSON.parse();', 'TS2554'],
};

const RE_DIAGNOSTICO = /^(.*?)\((\d+),(\d+)\): error (TS\d+): (.*)$/;

describe('typecheck dos scripts emitidos pelas páginas (#127)', () => {
  // Preparo DENTRO do describe: se o tsc não rodar, só estes testes caem —
  // o lint acima continua valendo sozinho.
  /** @type {{ paginas: string[], amostras: Record<string, string[]>, outros: string[] }} */
  let resultado;
  /** @type {string} */
  let dir;

  beforeAll(() => {
    dir = mkdtempSync(join(tmpdir(), 'scripts-embutidos-'));
    // Onde cada bloco começa em cada arquivo, para devolver o achado como
    // "página, bloco, linha" — o número de linha do arquivo junto não diz nada.
    /** @type {Record<string, { bloco: number, linha: number, src: string }[]>} */
    const inicios = {};
    const arquivos = [TIPOS];
    for (const [nome, html] of Object.entries(variacoes())) {
      const js = blocos(html).js;
      if (!js.length) continue;
      let texto = '', linha = 1;
      inicios[nome] = js.map((src, bloco) => {
        texto += `// ---- bloco #${bloco}\n`;
        const inicio = { bloco, linha: linha + 1, src };
        texto += src + '\n';
        linha += 1 + src.split('\n').length;
        return inicio;
      });
      writeFileSync(join(dir, `${nome}.js`), texto + 'export {};\n');
      arquivos.push(join(dir, `${nome}.js`));
    }
    for (const [nome, [src]] of Object.entries(AMOSTRAS)) {
      writeFileSync(join(dir, `amostra-${nome}.js`), src + '\nexport {};\n');
      arquivos.push(join(dir, `amostra-${nome}.js`));
    }
    writeFileSync(join(dir, 'tsconfig.json'), JSON.stringify({
      compilerOptions: {
        target: 'es2022', lib: ['dom', 'es2022'], types: [],
        allowJs: true, checkJs: true, noEmit: true, strict: false,
        // Pula só o lib.dom, e confere o nosso .d.ts. Com `skipLibCheck`, um
        // tipo com nome errado ali (`FocusOptionz`) passava calado — medido.
        skipDefaultLibCheck: true,
      },
      files: arquivos,
    }));

    const r = spawnSync(execPath, [TSC, '-p', join(dir, 'tsconfig.json'), '--pretty', 'false'], { encoding: 'utf8' });
    if (r.error || r.status === null) throw new Error(`o tsc não rodou: ${r.error?.message ?? r.signal}`);
    const saida = `${r.stdout}${r.stderr}`;

    resultado = { paginas: [], amostras: {}, outros: [] };
    for (const l of saida.split('\n')) {
      const m = l.match(RE_DIAGNOSTICO);
      if (!m) {
        // Linha de continuação de uma mensagem já registrada ("  Property …").
        // Qualquer outra coisa — erro sem posição, de configuração — é achado.
        if (l.trim() && !/^\s/.test(l)) resultado.outros.push(l);
        continue;
      }
      const [, caminho, linhaTxt, coluna, codigo, mensagem] = m;
      const nome = basename(caminho).replace(/\.js$/, '');
      if (nome.startsWith('amostra-')) {
        (resultado.amostras[nome.slice('amostra-'.length)] ??= []).push(codigo);
      } else if (inicios[nome]) {
        const linha = Number(linhaTxt);
        const b = /** @type {{ bloco: number, linha: number, src: string }} */ ([...inicios[nome]].reverse().find(x => x.linha <= linha));
        const trecho = (b.src.split('\n')[linha - b.linha] ?? '').trim().slice(0, 100);
        resultado.paginas.push(`${nome}: bloco #${b.bloco}, linha ${linha - b.linha + 1}:${coluna} ${codigo} ${mensagem} — ${trecho}`);
      } else {
        resultado.outros.push(l);
      }
    }
    // Saída de erro sem nada que se reconheça também é falha, não silêncio.
    if (r.status !== 0 && !resultado.paginas.length && !Object.keys(resultado.amostras).length && !resultado.outros.length) {
      resultado.outros.push(`tsc saiu com ${r.status} sem diagnóstico reconhecível:\n${saida}`);
    }
  }, 60_000);

  afterAll(() => { if (dir) rmSync(dir, { recursive: true, force: true }); });

  it('nenhum bloco usa propriedade que não existe, método errado ou chamada incompleta', () => {
    expect(resultado.paginas).toEqual([]);
    expect(resultado.outros).toEqual([]);
  });

  it.each(Object.entries(AMOSTRAS))('o próprio typecheck acusa %s', (nome, [, codigo]) => {
    expect(resultado.amostras[nome] ?? []).toContain(codigo);
  });
});
