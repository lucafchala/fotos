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
import { readFileSync } from 'node:fs';
import { dashboardHTML, cardProjetoPainel, ICONES } from '../src/ui/dashboard.js';
import { escape, toHttps } from '../src/utils.js';
import { VERSAO } from '../src/config.js';

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

  it('o aviso (toast) é uma região viva: o leitor de tela ouve "Evento atualizado!" e os erros', () => {
    expect(html).toContain('<div class="toast" id="toast" role="status" aria-live="polite" aria-atomic="true"></div>');
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

  it('ajustes em quatro grupos — Site, Dados, Conta, Sobre — e as ações sensíveis marcadas', () => {
    const grupos = [...html.matchAll(/<h2 class="grupo-titulo">([^<]+)<\/h2>/g)].map(m => m[1]);
    expect(grupos).toEqual(['Site', 'Dados', 'Conta', 'Sobre']);
    expect((html.match(/class="bloco sensivel"/g) || []).length).toBe(2);
    expect(html).toMatch(/class="bloco sensivel">[\s\S]*?Restaurar backup/);
    expect(html).toMatch(/class="bloco sensivel">[\s\S]*?Trocar a senha do painel/);
  });

  it('mostra a versão do site — a mesma do package.json (há um número só)', () => {
    const pacote = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
    expect(VERSAO, 'src/config.js VERSAO e package.json "version" andam juntos').toBe(pacote.version);
    expect(html).toContain(`<span class="versao" title="Versão do site">v${VERSAO}</span>`);
    expect(html).toContain(`<h3>Versão ${VERSAO}</h3>`);
  });

  // Contraste WCAG, calculado das próprias cores da página — uma troca de cor
  // não passa calada.
  // As variáveis do :root lidas uma vez, para um mapa — sem montar RegExp com
  // texto tirado da página (o CodeQL acusa: o HTML do painel viraria padrão).
  const raiz = html.match(/:root\{([^}]*)\}/)[1];
  const tokens = Object.fromEntries([...raiz.matchAll(/--([\w-]+):(#[0-9a-f]{3,6})\b/gi)].map(m => [m[1], m[2]]));
  const cor = nome => {
    if (!tokens[nome]) throw new Error(`--${nome} não está no :root`);
    return tokens[nome];
  };
  const rgb = hex => {
    const h = hex.length === 4 ? hex.slice(1).split('').map(c => c + c).join('') : hex.slice(1);
    return [0, 2, 4].map(i => parseInt(h.slice(i, i + 2), 16));
  };
  const lum = c => {
    const [r, g, b] = (typeof c === 'string' ? rgb(c) : c).map(v => v / 255)
      .map(v => (v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
    return 0.2126 * r + 0.7152 * g + 0.0722 * b;
  };
  const contraste = (a, b) => (Math.max(lum(a), lum(b)) + 0.05) / (Math.min(lum(a), lum(b)) + 0.05);

  it('todo texto do painel tem contraste AA (4,5:1) sobre todo fundo do painel', () => {
    // v2.0: o cinza "apagado" (--text3) era #555 — 2,5:1 sobre os blocos, e é
    // a cor de datas, dicas e rótulos lidos no celular, na rua. E o vermelho
    // de texto é o --red-texto: o --red (#c0392b) dá 3,4:1 e fica só nas
    // bordas e fundos.
    for (const texto of ['text', 'text2', 'text3', 'red-texto', 'verde-texto']) {
      for (const fundo of ['bg', 'bg2', 'bg3']) {
        expect(contraste(cor(texto), cor(fundo)), `--${texto} sobre --${fundo}`).toBeGreaterThanOrEqual(4.5);
      }
    }
  });

  it('todo selo do card tem contraste AA sobre o próprio fundo (a cor translúcida sobre o card)', () => {
    // "Atrasado" (#c83a3a) tinha 3,4:1 e "Arquivado" (#666), 3:1.
    const regras = [...html.matchAll(/\.st-([a-z-]+)\{color:([^;]+);background:rgba\((\d+),(\d+),(\d+),([\d.]+)\)\}/g)];
    expect(regras.map(r => r[1]).sort()).toEqual(['acesso', 'arquivado', 'atrasado', 'destaque', 'em-edicao', 'em-revisao', 'embreve', 'entregue', 'oculto']);
    const card = rgb(cor('bg2'));
    for (const [, nome, bruta, r, g, b, a] of regras) {
      const texto = bruta.startsWith('var(--') ? cor(bruta.slice(6, -1)) : bruta;
      const fundo = [r, g, b].map((v, i) => Math.round(Number(v) * Number(a) + card[i] * (1 - Number(a))));
      expect(contraste(texto, fundo), `.st-${nome}`).toBeGreaterThanOrEqual(4.5);
    }
  });

  it('cor de texto escrita à mão em linha não existe — só classes e variáveis, que os testes acima medem', () => {
    // As dicas "(opcional)" eram <span style="color:#555"> (2,5:1) e a falha
    // de e-mail de um pedido, color:#b04040 (3,2:1): ninguém media.
    expect(html.match(/style="[^"]*(?<![-\w])color:\s*#[^"]*"/g)).toBeNull();
  });

  it('todo campo do painel tem nome para o leitor de tela — rótulo, aria-label ou <label> em volta', () => {
    // Placeholder não é nome: some ao digitar. O "Sumir em…" do aviso de
    // novidade e a caixa de colar links só tinham isso.
    const ssr = html.slice(0, html.lastIndexOf('<script nonce'));
    const fors = new Set([...ssr.matchAll(/<label[^>]*\bfor="([^"]+)"/g)].map(m => m[1]));
    const semNome = [...ssr.matchAll(/<(input|select|textarea)\b([^>]*)>/g)]
      .filter(([, , a]) => !/type="hidden"/.test(a) && !/aria-label(ledby)?=/.test(a) && !fors.has((a.match(/\bid="([^"]+)"/) || [])[1]))
      .filter(m => { const antes = ssr.slice(0, m.index); return antes.lastIndexOf('<label') <= antes.lastIndexOf('</label>'); })
      .map(m => m[0].slice(0, 70));
    expect(semNome).toEqual([]);
    // As linhas de foto nascem no script, uma por URL.
    expect(html).toContain('placeholder="URL da foto" aria-label="URL da foto ${i + 1}"');
  });

  it('um título com </script> não fecha o script do painel (os dados vão escapados)', () => {
    const hostil = { ...BASE, title: '</script><script>alert(1)</script>', internalNotes: '<!-- </script> -->' };
    const pagina = dashboardHTML([hostil], ['</script>'], 'N', '</script>');
    expect(pagina).not.toContain('</script><script>alert(1)');
    expect(pagina).toContain('\\u003c/script\\u003e\\u003cscript\\u003ealert(1)');
    // O documento continua com um só bloco de script do painel aberto e fechado.
    expect(pagina.split('<script nonce="N">').length - 1).toBe(pagina.split('</script>').length - 1);
  });

  it('lista vazia convida a criar o primeiro evento', () => {
    expect(dashboardHTML([], [], 'N')).toContain('Toque em "Novo evento" para criar o primeiro.');
  });
});

describe('formulário: "Visível na galeria" explica o que "oculto" quer dizer (#128)', () => {
  it('a dica fica logo abaixo do interruptor e diz: não listado, mas abre com o link', () => {
    const html = dashboardHTML([], [], 'N');
    const dica = html.match(/<div class="field-hint" id="dica-visivel"[^>]*>([\s\S]*?)<\/div>/);
    expect(dica, 'dica ausente').not.toBeNull();
    const texto = dica[1].replace(/<[^>]+>/g, '');
    expect(texto).toContain('oculto');
    expect(texto).toContain('não listado');
    expect(texto).toContain('quem tem o link ainda abre');
    expect(html.indexOf('id="f-visible"')).toBeLessThan(html.indexOf('id="dica-visivel"'));
  });
});
