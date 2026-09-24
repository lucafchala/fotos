// O /api/healthz contra o contrato escrito em docs/healthz-contrato.json.
//
// O healthz tem dois leitores fora deste repositório — o smoke do deploy e o
// painel de status — e cada campo que eles leem é uma segunda cópia de um nome
// que mora aqui. Já divergiu: o `hashMs` saiu do payload e o painel continuou
// com o rótulo "hash" e o README com o campo por meses (status#38). É a regra
// "uma regra escrita duas vezes é corrigida uma vez só" (TODO.md), no formato
// de payload.
//
// O arquivo de contrato é a cópia única. Este teste prende o healthz a ele
// nos DOIS sentidos: campo do contrato que sumiu ou mudou de tipo reprova, e
// campo novo no payload sem entrada no contrato também — senão o contrato
// envelheceria calado do mesmo jeito que o README envelheceu. O outro lado
// (o status só lê o que o contrato tem) é conferido no CI do status.

import { describe, it, expect, afterEach, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { handleHealthz } from '../src/index.js';
import { HEALTHZ_CONTRATO } from '../src/config.js';

const CONTRATO = JSON.parse(readFileSync(new URL('../docs/healthz-contrato.json', import.meta.url), 'utf8'));
const SITE = 'https://fotos.lucafchala.com';

/** @param {unknown} v */
const tipoDe = (v) => (v === null ? 'null' : Array.isArray(v) ? 'array' : typeof v);

/**
 * Pares [caminho, valor] de todas as folhas e nós do payload. Arrays são
 * folhas (o conteúdo de `selftest.problems` é texto livre, não contrato).
 * @param {any} obj @param {string} [pre]
 * @returns {[string, any][]}
 */
function caminhos(obj, pre = '') {
  /** @type {[string, any][]} */
  const out = [];
  for (const [k, v] of Object.entries(obj)) {
    const p = pre ? `${pre}.${k}` : k;
    out.push([p, v]);
    if (v && typeof v === 'object' && !Array.isArray(v)) out.push(...caminhos(v, p));
  }
  return out;
}

/** @param {any} obj @param {string} caminho */
function ler(obj, caminho) {
  return caminho.split('.').reduce((o, k) => (o == null ? undefined : o[k]), obj);
}

/**
 * Tudo o que o payload faz de diferente do contrato, em texto. Vazio = conforme.
 * @param {any} payload
 */
export function divergencias(payload) {
  const erros = [];
  for (const [caminho, tipos] of Object.entries(CONTRATO.campos)) {
    // Filho de um nó que é `null` (cron, versao) legitimamente não existe.
    const pai = caminho.includes('.') ? ler(payload, caminho.slice(0, caminho.lastIndexOf('.'))) : payload;
    if (pai === null) continue;
    const v = ler(payload, caminho);
    if (v === undefined) { erros.push(`${caminho}: ausente`); continue; }
    if (!String(tipos).split('|').includes(tipoDe(v))) erros.push(`${caminho}: ${tipoDe(v)}, contrato diz ${tipos}`);
  }
  for (const [caminho] of caminhos(payload)) {
    if (!(caminho in CONTRATO.campos)) erros.push(`${caminho}: fora do contrato (acrescente em docs/healthz-contrato.json)`);
  }
  for (const [caminho, permitidos] of Object.entries(CONTRATO.valores || {})) {
    const v = ler(payload, caminho);
    if (v !== undefined && !permitidos.includes(v)) erros.push(`${caminho}: valor ${JSON.stringify(v)} fora de ${permitidos.join('/')}`);
  }
  for (const campo of CONTRATO.ausentes || []) {
    if (ler(payload, campo) !== undefined) erros.push(`${campo}: saiu de propósito e voltou`);
  }
  return erros;
}

function fakeKV(initial = {}) {
  const store = new Map(Object.entries(initial));
  return {
    async get(/** @type {string} */ k) { return store.has(k) ? store.get(k) : null; },
    async put(/** @type {string} */ k, /** @type {string} */ v) { store.set(k, v); },
    async delete(/** @type {string} */ k) { store.delete(k); },
    async list() { return { keys: [], list_complete: true, cursor: null }; },
  };
}

const EVENTOS = JSON.stringify([
  { slug: 'festa', title: 'Festa', driveUrl: 'https://drive.google.com/drive/folders/abc', comingSoon: false, visible: true },
  { slug: 'breve', title: 'Em breve', comingSoon: true, visible: true },
]);

/** @param {Record<string, any>} env */
async function healthz(env) {
  const res = await handleHealthz(new Request(`${SITE}/api/healthz`), /** @type {any} */ (env));
  return { status: res.status, body: await res.json() };
}

afterEach(() => { vi.restoreAllMocks(); });

describe('healthz × docs/healthz-contrato.json', () => {
  it('produção: tudo ligado, com a versão implantada', async () => {
    const { status, body } = await healthz({
      FOTOS: fakeKV({ events: EVENTOS, 'cron:last': new Date().toISOString() }),
      CONSENT_DB: { prepare: () => ({ first: async () => ({ 1: 1 }) }) },
      CF_VERSION_METADATA: { id: '6a9c2f1e-4b7d-4f0a-9e3c-2d8b1a7f5e40', tag: '3aba593', timestamp: '2026-09-24T09:12:40.000Z' },
      TURNSTILE_SECRET_KEY: 't', RESEND_API_KEY: 'r', ADMIN_EMAIL: 'a@b.co', SIGNING_SECRET: 'x'.repeat(40),
    });
    expect(status).toBe(200);
    expect(divergencias(body)).toEqual([]);
    expect(body.versao).toEqual({ id: '6a9c2f1e-4b7d-4f0a-9e3c-2d8b1a7f5e40', tag: '3aba593', em: '2026-09-24T09:12:40.000Z' });
  });

  it('mínimo: sem D1, sem segredos, sem version metadata, cron nunca rodou', async () => {
    const { body } = await healthz({ FOTOS: fakeKV({ events: '[]' }) });
    expect(divergencias(body)).toEqual([]);
    // Sem o binding, "não sei" — nunca uma versão inventada.
    expect(body.versao).toBeNull();
  });

  it('KV fora do ar (503) continua no contrato — é quando o painel mais precisa ler', async () => {
    const { status, body } = await healthz({ FOTOS: { get: () => Promise.reject(new Error('kv down')) } });
    expect(status).toBe(503);
    expect(divergencias(body)).toEqual([]);
  });

  it('a etiqueta vazia do deploy vira null, não string vazia', async () => {
    const { body } = await healthz({ FOTOS: fakeKV({ events: '[]' }), CF_VERSION_METADATA: { id: 'abc', tag: '', timestamp: '' } });
    expect(body.versao).toEqual({ id: 'abc', tag: null, em: null });
  });

  it('o número do contrato no payload, na constante e no arquivo é o mesmo', async () => {
    const { body } = await healthz({ FOTOS: fakeKV({ events: '[]' }) });
    expect(body.contrato).toBe(HEALTHZ_CONTRATO);
    expect(CONTRATO.contrato).toBe(HEALTHZ_CONTRATO);
  });

  it('o exemplo do contrato (que o CI do status usa) está no próprio contrato', () => {
    expect(divergencias(CONTRATO.exemplo)).toEqual([]);
  });

  it('o verificador reprova campo novo sem contrato e campo que saiu de propósito', () => {
    // Sem isto, um `divergencias` quebrado que devolve [] sempre passaria
    // em todos os testes acima.
    const extra = { ...CONTRATO.exemplo, novidade: 1, hashMs: 0 };
    const erros = divergencias(extra);
    expect(erros.some(e => e.startsWith('novidade: fora do contrato'))).toBe(true);
    expect(erros.some(e => e.startsWith('hashMs: saiu de propósito'))).toBe(true);
    const semCampo = structuredClone(CONTRATO.exemplo);
    delete semCampo.cron.stale;
    expect(divergencias(semCampo)).toContain('cron.stale: ausente');
  });
});
