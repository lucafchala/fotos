// O gate de dependências do CI (scripts/audita-dependencias.mjs): o que vai ao
// ar reprova sempre; ferramenta de dev só reprova quando há conserto publicado.
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { advisoriesDoRelatorio, decide } from '../scripts/audita-dependencias.mjs';

/** Relatório no formato do `npm audit --json` (v7+). */
function relatorio(/** @type {{ nome: string, ghsa: string, sev: string }[]} */ itens) {
  /** @type {Record<string, any>} */
  const vulnerabilities = {};
  for (const { nome, ghsa, sev } of itens) {
    vulnerabilities[nome] = {
      name: nome, severity: sev, isDirect: false, fixAvailable: true,
      via: [{ source: 1, name: nome, title: `falha em ${nome}`, url: `https://github.com/advisories/${ghsa}`, severity: sev, range: '<=1.0.0' }],
    };
    // Quem puxa o pacote aparece com `via` em texto: não é um advisory novo.
    vulnerabilities[`pai-de-${nome}`] = { name: `pai-de-${nome}`, severity: sev, via: [nome] };
  }
  return { vulnerabilities };
}

const PICO = { nome: 'picomatch', ghsa: 'GHSA-fc5q-39xc-vjpf', sev: 'high' };
const vazio = { vulnerabilities: {} };

describe('gate de dependências', () => {
  it('lê um advisory por GHSA e pacote, sem contar quem só puxa o pacote', () => {
    const ads = advisoriesDoRelatorio(relatorio([PICO]));
    expect(ads).toEqual([{ ghsa: 'GHSA-fc5q-39xc-vjpf', pacote: 'picomatch', severidade: 'high', titulo: 'falha em picomatch', faixa: '<=1.0.0' }]);
  });

  it('ferramenta de dev, alto, sem conserto publicado: aviso, não reprova', () => {
    const r = decide({ prod: vazio, todos: relatorio([PICO]), temConserto: () => false });
    expect(r.reprova).toEqual([]);
    expect(r.avisos.map((a) => a.pacote)).toEqual(['picomatch']);
  });

  it('o mesmo aviso reprova sozinho quando o conserto sai', () => {
    const r = decide({ prod: vazio, todos: relatorio([PICO]), temConserto: () => true });
    expect(r.reprova.map((a) => a.motivo)).toEqual(['tem versão corrigida: atualize']);
  });

  it('ferramenta de dev abaixo de alto não reprova nem avisa', () => {
    const r = decide({ prod: vazio, todos: relatorio([{ nome: 'x', ghsa: 'GHSA-aaaa-bbbb-cccc', sev: 'moderate' }]), temConserto: () => true });
    expect(r).toEqual({ reprova: [], avisos: [] });
  });

  it('o que vai ao ar reprova a partir de moderado, com ou sem conserto', () => {
    const prod = relatorio([{ nome: 'lib', ghsa: 'GHSA-aaaa-bbbb-cccc', sev: 'moderate' }]);
    const r = decide({ prod, todos: prod, temConserto: () => false });
    expect(r.reprova.map((a) => `${a.pacote}: ${a.motivo}`)).toEqual(['lib: vai ao ar']);
    expect(r.avisos).toEqual([]);
  });

  it('severidade desconhecida conta como a pior', () => {
    const r = decide({ prod: vazio, todos: relatorio([{ nome: 'y', ghsa: 'GHSA-aaaa-bbbb-dddd', sev: 'estranha' }]), temConserto: () => true });
    expect(r.reprova).toHaveLength(1);
  });
});

describe('o que vai ao ar não importa pacote do npm', () => {
  // Se `src/` importasse um pacote, ele entraria no bundle do Worker sendo,
  // para o npm, dependência de desenvolvimento: o gate o trataria com a régua
  // mais branda. Só caminho relativo e módulos da plataforma.
  /** @param {string} dir @returns {string[]} */
  const arquivos = (dir) => readdirSync(dir).flatMap((n) => {
    const p = join(dir, n);
    return statSync(p).isDirectory() ? arquivos(p) : p.endsWith('.js') ? [p] : [];
  });
  it('src/ só importa caminho relativo, cloudflare: ou node:', () => {
    const ruins = [];
    for (const f of arquivos(new URL('../src', import.meta.url).pathname)) {
      const t = readFileSync(f, 'utf8');
      for (const m of t.matchAll(/(?:^|\n)\s*(?:import|export)\b[^'"`;]*?\bfrom\s*['"]([^'"]+)['"]|\bimport\(\s*['"]([^'"]+)['"]\s*\)/g)) {
        const alvo = m[1] || m[2];
        if (!/^(\.{1,2}\/|cloudflare:|node:)/.test(alvo)) ruins.push(`${f}: ${alvo}`);
      }
    }
    expect(ruins).toEqual([]);
  });
});
