// O painel redesenhado em blocos (out/2026, #220).
//
// O que este arquivo prende:
//   1. O card de evento é UMA função para os dois lados: o servidor a chama
//      na primeira pintura, e o script da página recebe o código dela
//      (cardProjetoPainel.toString()). Se alguém a fizer depender de algo de
//      fora dela, o servidor continua funcionando e o NAVEGADOR quebra no
//      primeiro redesenho — por isso aqui o texto injetado é executado
//      isolado, sem o escopo do módulo, e tem de dar o mesmo card.
//   2. A estrutura que o redesenho promete: uma nav com as quatro seções,
//      cada uma com a sua <section>; o menu "Mais ações" com as ações de
//      sempre; o formulário em blocos recolhíveis com cada rótulo ligado ao
//      seu campo; o filtro rápido de status.
//   3. Os selos escritos que substituíram a cor dos ícones.
//
// O comportamento no navegador (abrir menu, recolher bloco, navegar) é do
// scripts/verifica-painel.mjs, que roda o Worker de verdade num Chromium.

import { describe, it, expect, vi, afterEach } from 'vitest';
import { createRequire } from 'node:module';
import { dashboardHTML, cardProjetoPainel, ICONES } from '../src/ui/dashboard.js';
import { escape, toHttps } from '../src/utils.js';

afterEach(() => { vi.useRealTimers(); });

// O MESMO esbuild que o wrangler usa no deploy, resolvido a partir do próprio
// wrangler: se um dia ele trouxer outra versão (aninhada), o teste acompanha
// em vez de testar a transformação de um esbuild que o deploy não usa.
const requireDoWrangler = createRequire(createRequire(import.meta.url).resolve('wrangler'));
const { transformSync } = /** @type {typeof import('esbuild')} */ (requireDoWrangler('esbuild'));

const BASE = {
  id: 'abc123', slug: 'formatura-2026', title: 'Formatura 2026', status: 'entregue',
  date: '2026-10-04', category: 'Formatura', visible: true, pinned: false, comingSoon: false,
  accessType: 'public', thumbnailUrl: 'https://lh3.googleusercontent.com/d/FOTO_AAAAAAAAAA',
  driveUrl: 'https://drive.google.com/drive/folders/PASTA_AAAAAAAAAA', photos: [],
};

/** As variações que exercitam cada ramo do card. */
const VARIACOES = [
  BASE,
  { ...BASE, pinned: true },
  { ...BASE, visible: false },
  { ...BASE, comingSoon: true },
  { ...BASE, accessType: 'private' },
  { ...BASE, accessType: 'family' },
  { ...BASE, status: 'em-edicao', promisedDate: '2020-01-01' },
  { ...BASE, status: 'em-revisao', promisedDate: '2099-12-31' },
  { ...BASE, status: 'arquivado', promisedDate: '2020-01-01' },
  { ...BASE, status: 'desconhecido' },
  { ...BASE, thumbnailUrl: '' },
  { ...BASE, thumbnailUrl: 'javascript:alert(1)' },
  { ...BASE, date: '' },
  { ...BASE, date: 'lixo' },
  { ...BASE, category: '' },
  { ...BASE, id: '" onmouseover="alert(1)" x="', title: '<img src=x onerror=alert(1)>', slug: 'a"b', category: '<b>c</b>' },
];

const ROTULOS = { 'em-edicao': 'Em edição', 'em-revisao': 'Em revisão', 'entregue': 'Entregue', 'arquivado': 'Arquivado' };
const HOJE = '2026-10-10';
const atrasado = (/** @type {any} */ e) => !!e.promisedDate && e.promisedDate < HOJE
  && (e.status || 'entregue') !== 'entregue' && (e.status || 'entregue') !== 'arquivado';
const ajuda = {
  esc: escape,
  safeUrl: (/** @type {unknown} */ u) => toHttps(u),
  rotulo: (/** @type {string} */ st) => ROTULOS[/** @type {keyof typeof ROTULOS} */ (st)] || st,
  atrasado,
  icones: ICONES,
};

/** O script principal do painel, como sai na página. */
function scriptDoPainel(/** @type {string} */ html) {
  const blocos = [...html.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script\b[^>]*>/gi)].map(m => m[1]);
  const principal = blocos.find(b => b.includes('const cardProjeto = ('));
  if (!principal) throw new Error('script do painel sem o card compartilhado');
  return principal;
}

describe('card de evento: uma função só, servidor e navegador', () => {
  const html = dashboardHTML([BASE], [], 'N');
  const script = scriptDoPainel(html);

  it('o script da página leva o código da função do servidor, inteiro', () => {
    expect(script).toContain('const cardProjeto = (' + cardProjetoPainel.toString() + ');');
  });

  it('o código injetado roda SOZINHO (sem o escopo do módulo) e dá o mesmo card, em todos os ramos', () => {
    // Executado como o navegador o veria: só o texto, nenhuma variável de
    // fora. Uma referência solta a algo do módulo estoura aqui.
    const isolada = new Function('return (' + cardProjetoPainel.toString() + ');')();
    for (const e of VARIACOES) {
      for (const marcado of [null, false, true]) {
        expect(isolada(e, ajuda, marcado), JSON.stringify(e)).toBe(cardProjetoPainel(e, ajuda, marcado));
      }
    }
  });

  it('sobrevive ao empacotamento do deploy: com keepNames, o código ainda roda sozinho', () => {
    // O wrangler empacota com esbuild e `keepNames`: toda função NOMEADA
    // ganha um `__name(fn, "nome")`, e `__name` é definido no topo do bundle.
    // Dentro do card isso seria uma variável de fora — que no navegador não
    // existe. A suíte roda o fonte sem empacotar e não veria; aqui o card
    // passa pela mesma transformação e o resultado é executado isolado.
    const saida = transformSync('export ' + cardProjetoPainel.toString(), { keepNames: true, loader: 'js', format: 'esm' }).code;
    const ini = saida.indexOf('function cardProjetoPainel(');
    const fim = saida.indexOf('__name(cardProjetoPainel, "cardProjetoPainel")');
    expect(ini).toBeGreaterThanOrEqual(0);
    expect(fim).toBeGreaterThan(ini);
    const corpo = saida.slice(ini, fim);
    expect(corpo, 'função nomeada dentro do card: o bundle a embrulha em __name').not.toContain('__name(');
    const isolada = new Function('return (' + corpo + ');')();
    for (const e of VARIACOES) expect(isolada(e, ajuda, null)).toBe(cardProjetoPainel(e, ajuda, null));
  });

  it('o servidor desenha a lista com a mesma função', () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date(HOJE + 'T15:00:00Z'));
    const lista = dashboardHTML(VARIACOES.slice(0, 9).map((e, i) => ({ ...e, id: 'id' + i, slug: 's' + i })), [], 'N');
    for (let i = 0; i < 9; i++) {
      const e = { ...VARIACOES[i], id: 'id' + i, slug: 's' + i };
      expect(lista).toContain(cardProjetoPainel(e, ajuda, null));
    }
  });
});

describe('card de evento: conteúdo', () => {
  const card = (/** @type {any} */ e, /** @type {boolean | null} */ marcado = null) => cardProjetoPainel(e, ajuda, marcado);

  it('ações principais com rótulo; o resto no menu "Mais ações", com a exclusão separada', () => {
    const c = card(BASE);
    expect(c).toMatch(/data-action="edit" data-id="abc123">[\s\S]*<span>Editar<\/span>/);
    expect(c).toContain('href="/galeria/formatura-2026"');
    expect(c).toMatch(/data-action="menu" data-id="abc123" aria-haspopup="menu" aria-expanded="false"/);
    expect(c).toMatch(/<div class="menu" role="menu"[^>]*hidden>/);
    for (const acao of ['pin', 'vis', 'dup', 'del']) expect(c).toContain(`data-id="abc123" data-action="${acao}"`);
    expect(c).toContain('href="/formatura-2026" target="_blank" rel="noopener"');
    // A exclusão vem depois de um separador e marcada como perigosa.
    expect(c.indexOf('menu-sep')).toBeLessThan(c.indexOf('data-action="del"'));
    expect(c).toMatch(/class="menu-item danger"[^>]*data-action="del"/);
  });

  it('os rótulos do menu dizem o que vai acontecer, conforme o estado', () => {
    expect(card(BASE)).toContain('Destacar na galeria');
    expect(card({ ...BASE, pinned: true })).toContain('Remover destaque');
    expect(card(BASE)).toContain('Ocultar da galeria');
    expect(card({ ...BASE, visible: false })).toContain('Mostrar na galeria');
  });

  it('o estado vira selo escrito', () => {
    const selos = (/** @type {any} */ e) => [...card(e).matchAll(/class="status-badge [^"]+">([^<]+)</g)].map(m => m[1]);
    expect(selos(BASE)).toEqual(['Entregue']);
    expect(selos({ ...BASE, pinned: true, visible: false, comingSoon: true, accessType: 'family' }))
      .toEqual(['Entregue', 'Destaque', 'Oculto', 'Em breve', 'Familiar']);
    expect(selos({ ...BASE, accessType: 'private' })).toEqual(['Entregue', 'Privado']);
    expect(selos({ ...BASE, status: 'em-edicao', promisedDate: '2020-01-01' })).toEqual(['Em edição', 'Atrasado']);
  });

  it('data em dd/mm/aaaa por texto (sem fuso), categoria e prazo só enquanto não entregou', () => {
    expect(card(BASE)).toContain('<span class="evt-slug">/formatura-2026</span> · 04/10/2026 · Formatura');
    expect(card({ ...BASE, date: 'lixo' })).not.toContain('lixo');
    expect(card({ ...BASE, status: 'em-edicao', promisedDate: '2026-11-20' })).toContain('prazo 20/11');
    expect(card({ ...BASE, status: 'entregue', promisedDate: '2026-11-20' })).not.toContain('prazo');
  });

  it('no modo de seleção, a caixa vem antes da miniatura e lembra se estava marcada', () => {
    expect(card(BASE)).not.toContain('evt-check');
    expect(card(BASE, false)).toMatch(/class="evt-item com-check"[\s\S]*<input type="checkbox" class="evt-check" data-id="abc123" aria-label="Selecionar Formatura 2026">/);
    expect(card(BASE, true)).toContain('aria-label="Selecionar Formatura 2026" checked>');
  });

  it('dado hostil vira texto em todo atributo e conteúdo', () => {
    const c = card(VARIACOES[VARIACOES.length - 1]);
    expect(c).not.toContain('onmouseover="alert(1)"');
    expect(c).not.toContain('<img src=x');
    expect(c).not.toContain('<b>c</b>');
    expect(c).toContain('&lt;img src=x onerror=alert(1)&gt;');
    expect(card({ ...BASE, thumbnailUrl: 'javascript:alert(1)' })).not.toMatch(/src="[^"]*javascript:/i);
  });
});

describe('estrutura do painel', () => {
  const html = dashboardHTML([BASE], ['Formatura'], 'N', 'Agenda aberta');

  it('uma nav com as quatro seções, cada uma com a sua <section>; uma só saída', () => {
    const navs = html.match(/<nav class="nav"/g) || [];
    expect(navs).toHaveLength(1);
    const abas = [...html.matchAll(/class="tab[^"]*" (?:id="[^"]+" )?data-onclick="switchTab" data-tab="([a-z]+)"/g)].map(m => m[1]);
    expect(abas).toEqual(['events', 'requests', 'metrics', 'settings']);
    for (const a of abas) expect(html).toContain(`<section id="tab-${a}" class="panel`);
    expect(html.match(/action="\/dashboard\/logout"/g)).toHaveLength(1);
    expect(html).toMatch(/data-tab="events" aria-current="page"/);
  });

  it('o selo de pedidos pendentes tem lugar próprio na nav (o script só troca o número)', () => {
    expect(html).toContain('<span class="tab-badge" id="requests-badge" hidden></span>');
  });

  it('formulário em seis blocos recolhíveis, o essencial aberto', () => {
    const blocos = [...html.matchAll(/<details class="bloco-form" id="([a-z-]+)"( open)?>/g)].map(m => m[1] + (m[2] ? '*' : ''));
    expect(blocos).toEqual(['bf-basico*', 'bf-fotos*', 'bf-video', 'bf-acesso', 'bf-producao', 'bf-pagina']);
    // Cada atalho aponta para um bloco que existe.
    const alvos = [...html.matchAll(/data-onclick="irParaBloco" data-alvo="([a-z-]+)"/g)].map(m => m[1]);
    expect(alvos).toEqual(['bf-basico', 'bf-fotos', 'bf-video', 'bf-acesso', 'bf-producao', 'bf-pagina']);
  });

  it('todo rótulo do formulário aponta para um campo que existe', () => {
    const inicio = html.indexOf('<div class="sheet-body">');
    const fim = html.indexOf('<div class="sheet-foot">');
    const form = html.slice(inicio, fim);
    const fors = [...form.matchAll(/<label[^>]*\bfor="([^"]+)"/g)].map(m => m[1]);
    expect(fors.length).toBeGreaterThanOrEqual(16);
    for (const id of fors) expect(form, id).toContain(`id="${id}"`);
    // Nenhum rótulo de campo ficou solto (os toggles usam o <label class="toggle"> em volta).
    const soltos = [...form.matchAll(/<label(?![^>]*\bfor=)(?![^>]*class="toggle")[^>]*>/g)];
    expect(soltos).toEqual([]);
  });

  it('filtro rápido de status: botões, um só pressionado ("Todos")', () => {
    const chips = [...html.matchAll(/class="chip" aria-pressed="(true|false)" data-onclick="filtraStatus" data-valor="([a-z-]+)"/g)];
    expect(chips.map(m => m[2])).toEqual(['todos', 'ativos', 'em-edicao', 'em-revisao', 'entregue', 'arquivado']);
    expect(chips.filter(m => m[1] === 'true').map(m => m[2])).toEqual(['todos']);
  });

  it('ajustes em três grupos — Site, Dados, Conta — e as ações sensíveis marcadas', () => {
    const grupos = [...html.matchAll(/<h2 class="grupo-titulo">([^<]+)<\/h2>/g)].map(m => m[1]);
    expect(grupos).toEqual(['Site', 'Dados', 'Conta']);
    expect((html.match(/class="bloco sensivel"/g) || []).length).toBe(2);
    expect(html).toMatch(/class="bloco sensivel">[\s\S]*?Restaurar backup/);
    expect(html).toMatch(/class="bloco sensivel">[\s\S]*?Trocar a senha do painel/);
  });

  it('lista vazia convida a criar o primeiro evento', () => {
    expect(dashboardHTML([], [], 'N')).toContain('Toque em "Novo evento" para criar o primeiro.');
  });
});
