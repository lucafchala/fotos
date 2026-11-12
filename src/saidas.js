// Busca pelo rosto: o que o SITE guarda sobre quem saiu e sobre o fim do
// índice (v3.8.9). A Rekognition guarda os rostos (src/rosto.js); aqui ficam,
// no KV, só as anotações que o painel e o cron precisam:
//
//   rosto-saiu:<slug>:<marca>   uma saída da busca: a data e quantos rostos ela
//                               apagou (nos METADADOS: listar já traz tudo).
//                               `<marca>` é o FaceId da marca no índice. NÃO se
//                               guarda em quais fotos a pessoa aparecia: seria
//                               manter exatamente o que ela pediu para apagar.
//   rosto-geracao:<slug>        quantas vezes o dono pediu para refazer o índice
//                               (desfazer uma saída). O indexador compara com a
//                               que ele já fez.
//   rosto-apagar:<slug>         o índice deste álbum deve ser apagado a partir
//                               de `quando` (projeto excluído: já; busca
//                               desligada: ROSTO_APAGA_APOS_DESLIGAR_H depois).
//
// Por que o dono vê e desfaz: a saída aceita QUALQUER foto de rosto (não há
// como provar de quem é a selfie sem pedir documento a um menor). Quem tem
// rostos recortados do álbum tira os outros da busca. O teto do dia
// (ROSTO_SAIR_POR_DIA) limita o estrago; a lista com "desfazer" o conserta.
import { apagaColecoes, desfazSaida } from './rosto.js';
import { ROSTO_APAGA_APOS_DESLIGAR_H } from './config.js';

const FACE_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/** @param {string} slug */
const prefixoDasSaidas = slug => `rosto-saiu:${slug}:`;

/**
 * Anota uma saída. A mesma marca de novo (a pessoa repetiu o pedido) soma os
 * rostos apagados e mantém a primeira data.
 * @param {{ FOTOS: any }} env
 * @param {string} slug
 * @param {string} marca
 * @param {number} removidas
 * @param {number} [agora]
 */
export async function registraSaida(env, slug, marca, removidas, agora = Date.now()) {
  if (!FACE_ID.test(marca)) return;
  const chave = prefixoDasSaidas(slug) + marca;
  let t = agora, n = Math.max(0, Math.floor(removidas) || 0);
  try {
    const antes = await env.FOTOS.getWithMetadata(chave);
    const m = antes && antes.metadata;
    if (m && typeof m.t === 'number') { t = m.t; n += Number(m.n) || 0; }
  } catch { /* sem a anterior, vale esta */ }
  await env.FOTOS.put(chave, '1', { metadata: { t, n } });
}

/**
 * As saídas de um álbum, da mais recente para a mais antiga.
 * @param {{ FOTOS: any }} env
 * @param {string} slug
 * @returns {Promise<{ id: string, em: number, removidas: number }[]>}
 */
export async function listaSaidas(env, slug) {
  /** @type {{ id: string, em: number, removidas: number }[]} */
  const saidas = [];
  let cursor;
  do {
    /** @type {any} */
    const r = await env.FOTOS.list({ prefix: prefixoDasSaidas(slug), ...(cursor ? { cursor } : {}) });
    for (const k of r.keys) {
      const id = String(k.name).slice(prefixoDasSaidas(slug).length);
      if (!FACE_ID.test(id)) continue;
      const m = k.metadata || {};
      saidas.push({ id, em: Number(m.t) || 0, removidas: Number(m.n) || 0 });
    }
    cursor = r.list_complete ? undefined : r.cursor;
  } while (cursor);
  return saidas.sort((a, b) => b.em - a.em);
}

/** @param {{ FOTOS: any }} env @param {string} slug */
export async function geracaoDoIndice(env, slug) {
  return Math.max(0, Math.floor(Number(await env.FOTOS.get(`rosto-geracao:${slug}`)) || 0));
}

/**
 * O dono desfaz uma saída: a marca sai do índice, a anotação some e o
 * indexador é avisado para refazer o índice (só assim os rostos que a saída
 * apagou voltam: o site não guardou quais eram).
 * @param {{ FOTOS: any }} env
 * @param {import('./aws.js').CredAws} cred
 * @param {string} slug
 * @param {string} marca
 * @param {{ fetch?: typeof fetch }} [opcoes]
 * @returns {Promise<boolean>} false: não há saída com esse id neste álbum
 */
export async function desfazUmaSaida(env, cred, slug, marca, opcoes = {}) {
  if (!FACE_ID.test(marca)) return false;
  const chave = prefixoDasSaidas(slug) + marca;
  // Só o que está na lista deste álbum: o id não vira um "apague este rosto".
  if ((await env.FOTOS.get(chave)) === null) return false;
  await desfazSaida(cred, slug, marca, opcoes);
  await env.FOTOS.put(`rosto-geracao:${slug}`, String((await geracaoDoIndice(env, slug)) + 1));
  await env.FOTOS.delete(chave);
  return true;
}

/**
 * Marca o índice de um álbum para ser apagado.
 * @param {{ FOTOS: any }} env
 * @param {string} slug
 * @param {'excluido' | 'desligado'} motivo
 * @param {number} [agora]
 */
export async function marcaIndiceParaApagar(env, slug, motivo, agora = Date.now()) {
  const quando = motivo === 'excluido' ? agora : agora + ROSTO_APAGA_APOS_DESLIGAR_H * 3600_000;
  await env.FOTOS.put(`rosto-apagar:${slug}`, JSON.stringify({ motivo, quando }));
}

/** A busca foi religada antes do prazo: o índice fica. @param {{ FOTOS: any }} env @param {string} slug */
export async function cancelaApagarIndice(env, slug) {
  await env.FOTOS.delete(`rosto-apagar:${slug}`);
}

/**
 * Quando o índice deste álbum será apagado (0 = não está marcado).
 * @param {{ FOTOS: any }} env @param {string} slug
 */
export async function indiceSeraApagadoEm(env, slug) {
  try {
    const j = JSON.parse((await env.FOTOS.get(`rosto-apagar:${slug}`)) || 'null');
    return j && Number(j.quando) > 0 ? Number(j.quando) : 0;
  } catch { return 0; }
}

/** Todas as chaves de um prefixo. @param {{ FOTOS: any }} env @param {string} prefix */
async function apagaPrefixo(env, prefix) {
  let cursor, n = 0;
  do {
    /** @type {any} */
    const r = await env.FOTOS.list({ prefix, ...(cursor ? { cursor } : {}) });
    for (const k of r.keys) { await env.FOTOS.delete(k.name); n++; }
    cursor = r.list_complete ? undefined : r.cursor;
  } while (cursor);
  return n;
}

/**
 * Apaga o índice de um álbum de vez: as duas coleções na Rekognition e tudo o
 * que o KV guardava sobre ele. A marca `rosto-apagar` só sai no FIM: se a AWS
 * falhar no meio, a próxima passada repete (apagar de novo o que já não existe
 * é sucesso).
 * @param {{ FOTOS: any }} env
 * @param {import('./aws.js').CredAws} cred
 * @param {string} slug
 * @param {{ fetch?: typeof fetch }} [opcoes]
 */
export async function apagaIndiceDoAlbum(env, cred, slug, opcoes = {}) {
  await apagaColecoes(cred, slug, opcoes);
  await apagaPrefixo(env, prefixoDasSaidas(slug));
  for (const k of [`rosto-sair:${slug}`, `rosto-geracao:${slug}`, `rosto-novas:${slug}`, `rosto-apagar:${slug}`]) await env.FOTOS.delete(k);
}

/**
 * O cron: apaga os índices marcados cujo prazo venceu. Nunca lança; o que
 * falhou fica marcado para a próxima passada, e volta na lista de falhas.
 * @param {{ FOTOS: any }} env
 * @param {import('./aws.js').CredAws | null} cred
 * @param {number} [agora]
 * @param {{ fetch?: typeof fetch }} [opcoes]
 * @returns {Promise<{ apagados: number, falhas: number, semChave: number }>}
 */
export async function apagaIndicesVencidos(env, cred, agora = Date.now(), opcoes = {}) {
  let apagados = 0, falhas = 0, semChave = 0;
  /** @type {string[]} */
  const nomes = [];
  try {
    let cursor;
    do {
      /** @type {any} */
      const r = await env.FOTOS.list({ prefix: 'rosto-apagar:', ...(cursor ? { cursor } : {}) });
      for (const k of r.keys) nomes.push(String(k.name));
      cursor = r.list_complete ? undefined : r.cursor;
    } while (cursor);
  } catch (e) {
    console.error('rosto: não listou os índices a apagar', e);
    return { apagados, falhas: 1, semChave };
  }
  for (const nome of nomes) {
    const slug = nome.slice('rosto-apagar:'.length);
    try {
      const j = JSON.parse((await env.FOTOS.get(nome)) || 'null');
      if (!j || !(Number(j.quando) <= agora)) continue;
      // Sem as chaves da AWS não há como apagar: fica marcado (e contado).
      if (!cred) { semChave++; continue; }
      await apagaIndiceDoAlbum(env, cred, slug, opcoes);
      apagados++;
    } catch (e) {
      falhas++;
      console.error('rosto: não apagou um índice marcado', e);
    }
  }
  return { apagados, falhas, semChave };
}
