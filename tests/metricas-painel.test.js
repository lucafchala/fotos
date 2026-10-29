import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';

// As contas dos gráficos de Métricas (v2, #215) moram no script do painel —
// o navegador não tem `import` para dentro de um template literal. Estes
// testes tiram cada função do código-fonte, exatamente como ela vai para a
// página, e a executam no node: a mesma técnica dos "pares cliente/servidor"
// de tests/security.test.js.
//
// O que se prende aqui é o que um print não mostra: a escala do eixo nunca
// corta o maior valor, dia sem contagem não vira zero, comparação só com base
// inteira, nenhum NaN no SVG (um NaN some do desenho sem erro nenhum no
// console), e os rótulos do eixo x terminando sempre em hoje.

const fonte = readFileSync(new URL('../src/ui/dashboard.js', import.meta.url), 'utf8');

const NOMES = [
  'escalaMetricas', 'recorteMetricas', 'variacao', 'indicePico', 'mediaPorSemana',
  'diaCurto', 'diaLongo', 'marcasX', 'geoX', 'geoY', 'svgLinhas', 'svgColunas', 'sparkline',
];

/** Tira `function nome(...) { ... }` do script (fecha no `}` de 4 espaços). */
function extrai(nome) {
  const m = fonte.match(new RegExp(`\\n    function ${nome}\\([^)]*\\) \\{[\\s\\S]*?\\n    \\}`));
  if (!m) throw new Error(`${nome} não encontrada em dashboard.js — o teste precisa ser reapontado`);
  // Funções de uma linha fecham na mesma linha: a regex acima as pega até o
  // próximo fechamento, então cada uma é conferida pelo nome no começo.
  return m[0];
}
function extraiUmaLinha(nome) {
  const m = fonte.match(new RegExp(`\\n    function ${nome}\\([^)]*\\) \\{[^\\n]*\\}\\n`));
  return m ? m[0] : null;
}
const codigo = NOMES.map(n => extraiUmaLinha(n) || extrai(n)).join('\n')
  // Dentro do template literal toda barra invertida está dobrada.
  .replace(/\\\\/g, '\\');
const G = new Function(`${codigo}; return { ${NOMES.join(', ')} };`)();

/** N dias seguidos terminando em `fim` (AAAA-MM-DD). */
function diasAte(fim, n) {
  const out = [];
  const t = Date.parse(fim + 'T12:00:00Z');
  for (let i = n - 1; i >= 0; i--) out.push(new Date(t - i * 86400000).toISOString().slice(0, 10));
  return out;
}

// ---------------------------------------------------------------------------
describe('escalaMetricas — o eixo y', () => {
  it('casos de mão', () => {
    expect(G.escalaMetricas(0)).toEqual({ topo: 4, marcas: [0, 1, 2, 3, 4] });
    expect(G.escalaMetricas(7)).toEqual({ topo: 8, marcas: [0, 2, 4, 6, 8] });
    expect(G.escalaMetricas(128)).toEqual({ topo: 150, marcas: [0, 50, 100, 150] });
    expect(G.escalaMetricas(1000)).toEqual({ topo: 1000, marcas: [0, 250, 500, 750, 1000] });
    expect(G.escalaMetricas(2.3).topo, 'média fracionária (dia da semana)').toBe(4);
  });

  it('para todo máximo de 0 a 20 000: topo cobre o máximo, 3 a 6 linhas, passos inteiros', () => {
    const ruins = [];
    for (let max = 0; max <= 20000; max++) {
      const { topo, marcas } = G.escalaMetricas(max);
      const ok = topo >= max && marcas[0] === 0 && marcas.at(-1) === topo
        && marcas.length >= 3 && marcas.length <= 6 && marcas.every(Number.isInteger);
      if (!ok) ruins.push({ max, topo, marcas });
      if (ruins.length > 5) break;
    }
    expect(ruins).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
describe('recorteMetricas — o período escolhido', () => {
  // 10 dias; a série por dia começou no 4º (índice 3).
  const dias = diasAte('2026-10-10', 10);
  const d = {
    dias,
    primeiroDia: dias[3],
    projetos: {
      a: { views: [0, 0, 0, 1, 2, 3, 4, 5, 6, 7], driveClicks: [0, 0, 0, 0, 1, 1, 1, 1, 1, 2] },
      b: { views: [0, 0, 0, 10, 0, 0, 0, 0, 0, 1], driveClicks: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0] },
    },
  };

  it('os N últimos dias, somados em todos os projetos', () => {
    const r = G.recorteMetricas(d, 3, '');
    expect(r.dias).toEqual(dias.slice(7));
    expect(r.views).toEqual([5, 6, 8]);
    expect(r.drive).toEqual([1, 1, 2]);
    expect(r.totV).toBe(19);
    expect(r.totD).toBe(4);
  });

  it('só o projeto escolhido; projeto sem série vira zeros (a contagem existia)', () => {
    expect(G.recorteMetricas(d, 3, 'b').views).toEqual([0, 0, 1]);
    expect(G.recorteMetricas(d, 3, 'fantasma').views).toEqual([0, 0, 0]);
  });

  it('dia de antes do primeiro dia da série é null, não zero', () => {
    const r = G.recorteMetricas(d, 7, '');
    expect(r.dias[0], 'o recorte de 7 começa exatamente no primeiro dia da série').toBe(dias[3]);
    expect(r.views[0]).toBe(11);
    expect(r.views.includes(null)).toBe(false);
    const tudo = G.recorteMetricas(d, 10, '');
    expect(tudo.views.slice(0, 3)).toEqual([null, null, null]);
    expect(tudo.views[3]).toBe(11);
    expect(tudo.totV, 'null não soma').toBe(39);
  });

  it('compara só quando o período anterior inteiro já tinha contagem por dia', () => {
    const r3 = G.recorteMetricas(d, 3, '');
    expect(r3.temAnterior, 'dias 4..6 (índices 4,5,6) — todos depois do primeiro').toBe(true);
    expect(r3.antV).toBe(2 + 3 + 4);
    expect(r3.antD).toBe(3);
    const r4 = G.recorteMetricas(d, 4, '');
    expect(r4.temAnterior, 'o anterior começa no índice 2, antes da série').toBe(false);
    expect(r4.antV).toBe(0);
    expect(G.recorteMetricas(d, 10, '').temAnterior, 'sem dias suficientes buscados').toBe(false);
  });

  it('sem série nenhuma (logo depois da atualização): tudo null, sem comparação', () => {
    const vazio = { dias, primeiroDia: '', projetos: {} };
    const r = G.recorteMetricas(vazio, 7, '');
    expect(r.views.every(v => v === null)).toBe(true);
    expect(r.totV).toBe(0);
    expect(r.temAnterior).toBe(false);
  });
});

// ---------------------------------------------------------------------------
describe('variacao e indicePico', () => {
  it('variação em % inteiro, e null sem base', () => {
    expect(G.variacao(110, 100)).toEqual({ dir: 1, valor: 10 });
    expect(G.variacao(90, 100)).toEqual({ dir: -1, valor: 10 });
    expect(G.variacao(100, 100)).toEqual({ dir: 0, valor: 0 });
    expect(G.variacao(5, 0)).toBeNull();
    expect(G.variacao(0, 0)).toBeNull();
  });

  it('pico: o maior, o mais recente no empate; nada acima de zero = -1', () => {
    expect(G.indicePico([null, 0, 0])).toBe(-1);
    expect(G.indicePico([1, 3, 3, 2])).toBe(2);
    expect(G.indicePico([null, 5])).toBe(1);
  });
});

// ---------------------------------------------------------------------------
describe('mediaPorSemana', () => {
  it('média por dia da semana, sem contar dia sem dado', () => {
    // 2026-10-04 é domingo.
    const dias = diasAte('2026-10-17', 14); // 04/10 (dom) .. 17/10 (sáb)
    const vals = dias.map((_, i) => (i === 0 ? null : 10 + i));
    const sem = G.mediaPorSemana(dias, vals);
    expect(sem).toHaveLength(7);
    expect(sem[0], 'domingo: só o segundo conta (o primeiro é null)').toEqual({ media: 17, dias: 1 });
    expect(sem[6], 'sábado: 16 e 23').toEqual({ media: 19.5, dias: 2 });
  });
});

// ---------------------------------------------------------------------------
describe('eixo x e datas', () => {
  it('marcasX: todos até 8; acima, ~5 de hoje para trás, e o último é sempre hoje', () => {
    expect(G.marcasX(0)).toEqual([]);
    expect(G.marcasX(1)).toEqual([0]);
    expect(G.marcasX(7)).toEqual([0, 1, 2, 3, 4, 5, 6]);
    expect(G.marcasX(30)).toEqual([5, 13, 21, 29]);
    expect(G.marcasX(90)).toEqual([0, 20, 43, 66, 89]);
    for (let n = 9; n <= 180; n++) {
      const m = G.marcasX(n);
      expect(m.at(-1), `n=${n}`).toBe(n - 1);
      expect(m.length, `n=${n}`).toBeLessThanOrEqual(6);
      // nenhum par de rótulos colado: no mínimo 3/4 do passo entre eles
      const passo = Math.ceil((n - 1) / 4);
      for (let i = 1; i < m.length; i++) expect(m[i] - m[i - 1], `n=${n}`).toBeGreaterThanOrEqual(passo * 0.75);
    }
  });

  it('dia curto e longo, no fuso que o servidor já resolveu', () => {
    expect(G.diaCurto('2026-10-04')).toBe('04/10');
    expect(G.diaLongo('2026-10-04')).toBe('dom, 04/10');
    expect(G.diaLongo('2026-10-10')).toBe('sáb, 10/10');
  });
});

// ---------------------------------------------------------------------------
describe('svgLinhas — o gráfico de acessos', () => {
  const dias = diasAte('2026-10-10', 30);
  const serie = (f) => dias.map((_, i) => f(i));
  const desenha = (o = {}) => G.svgLinhas({
    largura: 600, altura: 260, dias, rotulosFim: true,
    series: [
      { nome: 'Visitas', curto: 'Visitas', cor: '#3987e5', valores: serie(i => (i < 5 ? null : i * 3)) },
      { nome: 'Abriram o Drive', curto: 'Drive', cor: '#d95926', valores: serie(i => (i < 5 ? null : i)) },
    ],
    ...o,
  });

  it('desenha uma linha por série, começando no primeiro dia com dado', () => {
    const { svg } = desenha();
    const caminhos = [...svg.matchAll(/<path d="([^"]+)" fill="none"/g)].map(m => m[1]);
    expect(caminhos).toHaveLength(2);
    for (const c of caminhos) {
      expect(c.startsWith('M'), 'um trecho só').toBe(true);
      expect((c.match(/M/g) || []).length).toBe(1);
      expect((c.match(/L/g) || []).length, '25 dias com dado = 24 segmentos').toBe(24);
    }
  });

  it('nenhum NaN nem Infinity em lugar nenhum — inclusive com um dia só e tudo zero', () => {
    for (const o of [
      {},
      { dias: ['2026-10-10'], series: [{ nome: 'V', cor: '#000', valores: [0] }, { nome: 'D', cor: '#111', valores: [0] }] },
      { series: [{ nome: 'V', cor: '#000', valores: serie(() => 0) }, { nome: 'D', cor: '#111', valores: serie(() => null) }] },
      { largura: 240, altura: 220, rotulosFim: false },
    ]) {
      const { svg, geo } = desenha(o);
      expect(svg).not.toMatch(/NaN|Infinity|undefined/);
      expect(Number.isFinite(G.geoX(geo, 0)) && Number.isFinite(G.geoY(geo, 0))).toBe(true);
    }
  });

  it('o único número dentro do gráfico é o pico das visitas', () => {
    const { svg } = desenha();
    const pico = 29 * 3;
    expect(svg).toContain(`>${pico}</text>`);
    expect(svg).toContain('data-pontos="30"');
  });

  it('nome na ponta de cada linha só com espaço (rotulosFim), e a cruz escondida', () => {
    expect(desenha().svg).toMatch(/>Visitas<\/text>/);
    expect(desenha({ rotulosFim: false }).svg).not.toMatch(/>Visitas<\/text>/);
    expect(desenha().svg).toMatch(/<g class="cruz" visibility="hidden">/);
  });

  it('a geometria devolvida põe o último dia na borda direita do traçado', () => {
    const { geo } = desenha();
    expect(G.geoX(geo, 29)).toBeCloseTo(geo.esq + geo.w);
    expect(G.geoY(geo, 0)).toBeCloseTo(geo.cima + geo.h);
    expect(G.geoY(geo, geo.topo)).toBeCloseTo(geo.cima);
  });
});

// ---------------------------------------------------------------------------
describe('svgColunas e sparkline', () => {
  it('colunas: uma área de toque por dia, barra só onde há valor, número só na maior', () => {
    const svg = G.svgColunas({
      largura: 320, altura: 190, cor: '#3987e5',
      rotulos: ['dom', 'seg', 'ter', 'qua', 'qui', 'sex', 'sáb'],
      valores: [0, 2.5, 4, 0, 1, 9.5, 3], dicas: ['a', 'b', 'c', 'd', 'e', 'f', 'g'], formata: v => String(v),
    });
    expect((svg.match(/data-coluna="/g) || []).length).toBe(7);
    expect((svg.match(/<path d="M/g) || []).length, 'cinco dias com valor').toBe(5);
    expect(svg).toContain('>9.5</text>');
    expect(svg).not.toMatch(/NaN|Infinity|undefined/);
  });

  it('sparkline: null quebra a linha; tudo zero vira uma linha no chão; sem NaN', () => {
    const quebrada = G.sparkline([1, 2, null, 3, 4], 72, 20, '#000');
    expect((quebrada.match(/M/g) || []).length).toBe(2);
    const zero = G.sparkline([0, 0, 0], 72, 20, '#000');
    expect(zero).toContain('M1 18L36 18L71 18');
    expect(G.sparkline([], 72, 20, '#000')).not.toContain('<path');
    for (const s of [quebrada, zero, G.sparkline([5], 72, 20, '#000')]) expect(s).not.toMatch(/NaN|Infinity/);
  });
});
