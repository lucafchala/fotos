// A versão do site em todos os lugares que a mostram (src/config.js, "Versões").
//
// O número é escrito à mão em dois arquivos (src/config.js e package.json) e o
// CHANGELOG.md abre com a seção dele. Três cópias da mesma informação: se uma
// fica para trás, o painel diz uma versão, o healthz outra e o CHANGELOG
// descreve uma terceira — e ninguém percebe até alguém precisar saber o que
// está no ar. Estes testes não decidem QUANDO subir o número (isso é
// julgamento, descrito no comentário de VERSAO); garantem que, subido, ele
// sobe em todo lugar.

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { VERSAO } from '../src/config.js';
import { handleHealthz } from '../src/index.js';
import { withDurableObjects } from './helpers/do.js';

const pacote = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
const changelog = readFileSync(new URL('../CHANGELOG.md', import.meta.url), 'utf8');

// semver.org, sem pré-lançamento nem metadado: o site não publica "-beta".
const SEMVER = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/;

/** As seções de versão do CHANGELOG, na ordem em que aparecem: `## [2.0.0] — …`. */
const secoes = [...changelog.matchAll(/^## \[(\d+\.\d+\.\d+)\]/gm)].map(m => m[1]);

/** @param {string} v */
const partes = v => v.split('.').map(Number);

describe('versão do site (VERSAO)', () => {
  it('é semver puro: MAIOR.MENOR.CORREÇÃO, sem sufixo', () => {
    expect(VERSAO).toMatch(SEMVER);
  });

  it('é a mesma do package.json', () => {
    expect(pacote.version, 'suba as duas juntas').toBe(VERSAO);
  });

  it('o CHANGELOG abre com a seção dela', () => {
    expect(secoes.length, 'nenhuma seção "## [x.y.z]" no CHANGELOG.md').toBeGreaterThan(0);
    expect(secoes[0], 'a primeira seção do CHANGELOG.md é a da versão atual').toBe(VERSAO);
  });

  it('as seções do CHANGELOG vão da mais nova para a mais velha, sem repetir', () => {
    expect(new Set(secoes).size, 'versão repetida no CHANGELOG.md').toBe(secoes.length);
    for (let i = 1; i < secoes.length; i++) {
      const [a, b] = [partes(secoes[i - 1]), partes(secoes[i])];
      const maior = a[0] - b[0] || a[1] - b[1] || a[2] - b[2];
      expect(maior, `${secoes[i - 1]} vem antes de ${secoes[i]}`).toBeGreaterThan(0);
    }
  });

  it('o /api/healthz mostra as duas versões: a do site e a implantação da Cloudflare', async () => {
    const kv = { async get() { return null; }, async put() {}, async delete() {}, async list() { return { keys: [], list_complete: true }; } };
    const env = withDurableObjects({
      FOTOS: kv,
      CF_VERSION_METADATA: { id: '6a9c2f1e-4b7d-4f0a-9e3c-2d8b1a7f5e40', tag: '3aba593', timestamp: '2026-10-17T00:00:00.000Z' },
    });
    const res = await handleHealthz(new Request('https://fotos.lucafchala.com/api/healthz'), /** @type {any} */ (env));
    const corpo = /** @type {any} */ (await res.json());
    expect(corpo.versaoSite).toBe(VERSAO);
    expect(corpo.versao).toEqual({ id: '6a9c2f1e-4b7d-4f0a-9e3c-2d8b1a7f5e40', tag: '3aba593', em: '2026-10-17T00:00:00.000Z' });
  });
});
