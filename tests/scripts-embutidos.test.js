// Lint dos scripts que as páginas EMITEM (issue #127).
//
// Os <script> das páginas vivem dentro de template literals em src/ui/**, e
// para o ESLint e o tsc aquilo é uma string: código de produção sem rede
// nenhuma. O preço já foi cobrado — um `const` usado antes da declaração
// morreu em TDZ engolido por um try/catch, e funções mortas sobreviveram à
// remoção dos handlers inline sem ninguém perceber.
//
// Não dá para lintar o arquivo-fonte (o JS está dentro de uma string), mas dá
// para lintar o que SAI: renderiza cada página, extrai os blocos executáveis
// e passa cada um pelo Linter do próprio ESLint, como script clássico de
// browser. O typecheck desses blocos continua fora de alcance — ver #127.

import { describe, it, expect } from 'vitest';
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
