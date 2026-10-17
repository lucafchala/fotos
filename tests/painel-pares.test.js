// Pares do painel: as cópias escritas duas (ou quatro) vezes têm de concordar.
//
// O painel é um template literal em src/ui/dashboard.js, e o script que ele
// emite repete regras que o servidor também tem. O browser não importa nada de
// fora do template, então nenhuma cópia vem da outra: este arquivo lê o fonte
// como texto, extrai cada cópia e compara. É a técnica do bloco "pares
// cliente/servidor" de tests/security.test.js. Os porquês estão em
// docs/PAINEL.md: §5 (rótulos e atrasado) e §6.4 (o formulário).
//
// Três pares:
//   1. os rótulos de status: STATUS_LABELS_SSR (servidor) e STATUS_LABELS (navegador);
//   2. "atrasado": isOverdue nos dois lados, com "hoje" fixado;
//   3. os quatro lugares do formulário: openForm, snapshotForm, submitForm e
//      restoreDraft, comparados pelos campos `f-…` que cada um toca.
//
// Afirma a CONCORDÂNCIA entre as cópias. A regra de "atrasado" aparece aqui só
// como âncora, para que duas cópias erradas do mesmo jeito não passem.

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';

const dashboardSource = readFileSync(new URL('../src/ui/dashboard.js', import.meta.url), 'utf8');

/** Dentro do template literal toda barra invertida está dobrada: desfaz antes de executar ou comparar. */
function desdobra(trecho) {
  return trecho.replace(/\\\\/g, '\\');
}

/** Acha um trecho do fonte. Se ele mudou de forma, falha dizendo o que sumiu, em vez de comparar com nada. */
function achaNoFonte(re, nome) {
  const m = dashboardSource.match(re);
  if (!m) throw new Error(`${nome} não encontrado em dashboard.js — o teste precisa ser reapontado`);
  return m;
}

describe('pares do painel: rótulos, atrasado e o formulário têm de concordar', () => {
  describe('rótulos de status: servidor × navegador', () => {
    it('STATUS_LABELS_SSR e STATUS_LABELS têm as mesmas chaves e os mesmos nomes', () => {
      // Os dois são literais de uma linha só, sem chave aninhada: vão do `{` ao primeiro `}`.
      const literalServidor = achaNoFonte(/const STATUS_LABELS_SSR = (\{[^}]*\});/, 'STATUS_LABELS_SSR')[1];
      const literalNavegador = achaNoFonte(/const STATUS_LABELS = (\{[^}]*\});/, 'STATUS_LABELS')[1];
      const doServidor = new Function(`return ${desdobra(literalServidor)};`)();
      const doNavegador = new Function(`return ${desdobra(literalNavegador)};`)();
      expect(Object.keys(doServidor).length, 'o servidor tem de ter os quatro status').toBeGreaterThanOrEqual(4);
      expect(Object.keys(doNavegador).sort(), 'chaves: navegador × servidor').toEqual(Object.keys(doServidor).sort());
      expect(doNavegador, 'nomes: navegador × servidor').toEqual(doServidor);
    });
  });

  describe('"atrasado": servidor × navegador, com "hoje" fixado', () => {
    // "Hoje" é o mesmo para as duas cópias. O servidor recebe todayISO de
    // dashboardHTML; o navegador chama hojeEmSaoPaulo(), trocada aqui por um stub.
    const HOJE = '2026-10-17';
    const ONTEM = '2026-10-16';
    const AMANHA = '2026-10-18';
    const STATUSES = [undefined, 'em-edicao', 'em-revisao', 'entregue', 'arquivado'];
    const PRAZOS = [undefined, '', ONTEM, HOJE, AMANHA];

    // Servidor: `const isOverdue = e => …;` dentro de dashboardHTML, com todayISO injetado.
    const setaServidor = desdobra(achaNoFonte(/const isOverdue = (e => [\s\S]*?);\n/, 'isOverdue (servidor)')[1]);
    const atrasadoServidor = new Function('todayISO', `return ${setaServidor};`)(HOJE);

    // Navegador: `function isOverdue(e) {…}` do script, com um hojeEmSaoPaulo() que devolve HOJE.
    const funcaoNavegador = desdobra(achaNoFonte(/function isOverdue\(e\) \{[\s\S]*?\n {4}\}/, 'isOverdue (navegador)')[0]);
    const atrasadoNavegador = new Function('hojeEmSaoPaulo', `${funcaoNavegador}; return isOverdue;`)(() => HOJE);

    /** Os dois lados sobre o mesmo evento: [servidor, navegador]. */
    const dosDoisLados = (status, prazo) => {
      const evento = { status, promisedDate: prazo };
      return [atrasadoServidor(evento), atrasadoNavegador(evento)];
    };

    it('servidor e navegador respondem igual em toda combinação de status × prazo (5 × 5)', () => {
      const discordam = [];
      for (const status of STATUSES) {
        for (const prazo of PRAZOS) {
          const [servidor, navegador] = dosDoisLados(status, prazo);
          if (servidor !== navegador) discordam.push(`status=${status} prazo=${prazo}: servidor=${servidor}, navegador=${navegador}`);
        }
      }
      expect(discordam, 'combinações em que as duas cópias discordam').toEqual([]);
    });

    it('a regra vale nos dois lados: atrasado só com prazo anterior a hoje e status em edição ou revisão', () => {
      // Âncoras, escritas à mão: sem elas, duas cópias erradas do mesmo jeito
      // (todas "falso", por exemplo) passariam na comparação acima.
      //   - prazo de ontem, em edição ou revisão: atrasado;
      //   - sem status conta como entregue; entregue e arquivado nunca atrasam;
      //   - prazo de hoje não atrasa (a comparação é estrita), nem o de amanhã, nem o vazio.
      const regra = (status, prazo) => !!prazo && prazo < HOJE && ['em-edicao', 'em-revisao'].includes(status);
      const erros = [];
      for (const status of STATUSES) {
        for (const prazo of PRAZOS) {
          const esperado = regra(status, prazo);
          const [servidor, navegador] = dosDoisLados(status, prazo);
          if (servidor !== esperado || navegador !== esperado) {
            erros.push(`status=${status} prazo=${prazo}: servidor=${servidor}, navegador=${navegador}, esperado=${esperado}`);
          }
        }
      }
      expect(erros).toEqual([]);
      // Exemplos nomeados, para ler o teste sem fazer a conta:
      expect(dosDoisLados('em-edicao', ONTEM), 'em edição, prazo de ontem').toEqual([true, true]);
      expect(dosDoisLados('em-revisao', ONTEM), 'em revisão, prazo de ontem').toEqual([true, true]);
      expect(dosDoisLados(undefined, ONTEM), 'sem status (vale entregue), prazo de ontem').toEqual([false, false]);
      expect(dosDoisLados('entregue', ONTEM), 'entregue, prazo de ontem').toEqual([false, false]);
    });
  });

  describe('os quatro lugares do formulário (navegador): mesmos campos', () => {
    /** Corpo de uma função do script: do `function NOME(` até a chave que fecha na indentação de 4 espaços. */
    const corpoDaFuncao = (re, nome) => desdobra(achaNoFonte(re, nome)[0]);

    /**
     * Campos `f-…` que um corpo toca: todo literal 'f-…', seja direto em
     * getElementById, seja passado a um helper (val, set, chk, setChk, mostraCampo).
     * Comentário de linha inteira não conta como uso.
     */
    const camposTocados = corpo => new Set(
      [...corpo.replace(/^\s*\/\/.*$/gm, '').matchAll(/['"](f-[a-z0-9-]+)['"]/g)].map(m => m[1]),
    );

    const campos = {
      openForm: camposTocados(corpoDaFuncao(/function openForm\(id, prefill\) \{[\s\S]*?\n {4}\}/, 'openForm')),
      snapshotForm: camposTocados(corpoDaFuncao(/function snapshotForm\(\) \{[\s\S]*?\n {4}\}/, 'snapshotForm')),
      submitForm: camposTocados(corpoDaFuncao(/async function submitForm\(\) \{[\s\S]*?\n {4}\}/, 'submitForm')),
      restoreDraft: camposTocados(corpoDaFuncao(/function restoreDraft\(\) \{[\s\S]*?\n {4}\}/, 'restoreDraft')),
    };

    // Nenhuma exceção está codificada, porque hoje os quatro conjuntos são iguais.
    // O slug entra no snapshotForm (`slug: val('f-slug')`, com o comentário "O slug
    // também: num evento novo, digitar só a URL e fechar não perguntava nada"), e o
    // `pinned` não é campo do formulário: não aparece em nenhuma das quatro funções.
    // Uma exceção só entra aqui com o motivo que o código dá para ela, ao lado do campo.

    it('cada conjunto tem pelo menos 5 campos: uma regex quebrada não pode deixar a comparação passar em branco', () => {
      for (const [nome, conjunto] of Object.entries(campos)) {
        expect(conjunto.size, `${nome}: campos encontrados = [${[...conjunto].join(', ')}]`).toBeGreaterThanOrEqual(5);
      }
    });

    it('submitForm: todo campo que ele envia está em snapshotForm (senão a alteração não conta e some do rascunho)', () => {
      const faltam = [...campos.submitForm].filter(id => !campos.snapshotForm.has(id));
      expect(faltam, 'campos que o submitForm envia e o snapshotForm não serializa').toEqual([]);
    });

    it('snapshotForm: todo campo do instantâneo volta do rascunho em restoreDraft', () => {
      // f-slug conta como restaurado mesmo com `if (!d.editingId)` na frente: o próprio
      // código diz "na edição o slug é só leitura", e openForm já o preencheu.
      const faltam = [...campos.snapshotForm].filter(id => !campos.restoreDraft.has(id));
      expect(faltam, 'campos do snapshotForm que o restoreDraft não restaura').toEqual([]);
    });

    it('snapshotForm: todo campo do instantâneo é preenchido em openForm', () => {
      const faltam = [...campos.snapshotForm].filter(id => !campos.openForm.has(id));
      expect(faltam, 'campos do snapshotForm que o openForm não preenche').toEqual([]);
    });

    it('o HTML do formulário (id="f-…") tem exatamente os campos que as quatro funções tocam', () => {
      // docs/PAINEL.md §6.4, item 5: o HTML é o primeiro dos lugares. Um campo novo que
      // nenhuma das quatro funções conhece passaria em branco nas comparações acima; e
      // uma função que lê um id que o HTML não tem recebe null do getElementById.
      const noHtml = new Set([...dashboardSource.matchAll(/\sid="(f-[a-z0-9-]+)"/g)].map(m => m[1]));
      const tocados = new Set(Object.values(campos).flatMap(c => [...c]));
      expect([...noHtml].filter(id => !tocados.has(id)), 'campos do HTML que nenhuma das quatro funções toca').toEqual([]);
      expect([...tocados].filter(id => !noHtml.has(id)), 'ids que as funções tocam e o HTML não tem').toEqual([]);
    });
  });
});
