// Teto de espaço no R2 (v4.9.0). A Cloudflare não tem um limite de gasto que
// pare o R2 sozinho (só avisos de cobrança), então o teto mora aqui: nenhuma
// gravação no bucket (a pré-cópia, a cópia do original no primeiro download, a
// miniatura) passa de `R2_LIMITE_GB` (wrangler.toml; padrão R2_LIMITE_GB_PADRAO).
// Com o teto cheio, o site continua igual: o que não está no R2 sai do Google,
// como antes do R2 existir. O custo máximo de armazenamento fica em
// (teto − 10 GB grátis) × US$ 0,015 por mês: com 100 GB, US$ 1,35.
//
// Como se mede: o cron (src/precopia.js) soma o tamanho de todos os objetos do
// bucket a cada R2_MEDIR_A_CADA_MS e grava em `r2:uso` no KV; entre medições,
// a pré-cópia soma o que gravou. Quem grava lê esse número (memória do isolate
// por R2_USO_MEMO_MS). Sem medição ainda, NADA grava: o teto falha fechado.

export const R2_LIMITE_GB_PADRAO = 100;
export const R2_MEDIR_A_CADA_MS = 3600 * 1000;
export const R2_USO_MEMO_MS = 60 * 1000;
const GB = 1024 * 1024 * 1024;

/** @typedef {{ bytes: number, objetos: number, em: number }} UsoR2 */

/** @type {{ uso: UsoR2 | null, ate: number } | null} */
let memo = null;
/** Para os testes. */
export function limpaMemoDoR2() { memo = null; }

/**
 * O teto em bytes: `R2_LIMITE_GB` (1 a 1000) ou o padrão.
 * @param {any} env
 */
export function limiteDoR2(env) {
  const n = Number(env && env.R2_LIMITE_GB);
  const gb = Number.isFinite(n) && n >= 1 && n <= 1000 ? n : R2_LIMITE_GB_PADRAO;
  return gb * GB;
}

/**
 * A última medição (KV `r2:uso`), ou null se nunca houve.
 * @param {any} env
 * @returns {Promise<UsoR2 | null>}
 */
export async function usoDoR2(env, agora = Date.now()) {
  if (memo && agora < memo.ate) return memo.uso;
  /** @type {UsoR2 | null} */
  let uso = null;
  try {
    const v = JSON.parse((await env.FOTOS.get('r2:uso')) || 'null');
    if (v && Number.isFinite(v.bytes) && v.bytes >= 0) uso = { bytes: v.bytes, objetos: Number(v.objetos) || 0, em: Number(v.em) || 0 };
  } catch { uso = null; }
  memo = { uso, ate: agora + R2_USO_MEMO_MS };
  return uso;
}

/**
 * Pode gravar mais `bytes` no R2? Falha fechada: sem medição, ou o KV fora,
 * a resposta é não (o arquivo sai do Google, como sem R2).
 * @param {any} env
 * @param {number} [bytes]
 */
export async function r2TemEspaco(env, bytes = 0) {
  if (!env || !env.FOTOS_R2 || !env.FOTOS) return false;
  const uso = await usoDoR2(env);
  if (!uso) return false;
  return uso.bytes + Math.max(0, Number(bytes) || 0) <= limiteDoR2(env);
}

/**
 * Grava a medição no KV e na memória.
 * @param {any} env
 * @param {UsoR2} uso
 */
export async function gravaUsoDoR2(env, uso) {
  await env.FOTOS.put('r2:uso', JSON.stringify(uso));
  memo = { uso, ate: Date.now() + R2_USO_MEMO_MS };
}

/**
 * Soma o tamanho de todos os objetos do bucket (páginas de 1000) e grava.
 * @param {any} env
 * @param {number} [agora]
 * @returns {Promise<UsoR2>}
 */
export async function medeUsoDoR2(env, agora = Date.now()) {
  let bytes = 0;
  let objetos = 0;
  /** @type {string | undefined} */
  let cursor;
  do {
    const pagina = await env.FOTOS_R2.list({ limit: 1000, ...(cursor ? { cursor } : {}) });
    for (const o of pagina.objects || []) { bytes += Number(o.size) || 0; objetos++; }
    cursor = pagina.truncated ? pagina.cursor : undefined;
  } while (cursor);
  const uso = { bytes, objetos, em: agora };
  await gravaUsoDoR2(env, uso);
  return uso;
}

/**
 * A medição em dia: a do KV, ou uma nova se passou R2_MEDIR_A_CADA_MS.
 * @param {any} env
 * @param {number} [agora]
 */
export async function usoAtualizado(env, agora = Date.now()) {
  memo = null;
  const uso = await usoDoR2(env, agora);
  if (uso && agora - uso.em < R2_MEDIR_A_CADA_MS) return uso;
  return medeUsoDoR2(env, agora);
}

/**
 * Para o healthz: números em GB, ou null sem R2.
 * @param {any} env
 */
export async function resumoDoR2(env) {
  if (!env || !env.FOTOS_R2 || !env.FOTOS) return null;
  const uso = await usoDoR2(env);
  const limite = limiteDoR2(env);
  return {
    usoGb: uso ? Math.round((uso.bytes / GB) * 100) / 100 : 0,
    limiteGb: Math.round(limite / GB),
    objetos: uso ? uso.objetos : 0,
    medidoEm: uso && uso.em ? new Date(uso.em).toISOString() : null,
    cheio: uso ? uso.bytes >= limite : false,
  };
}
