// Foto durável da última listagem do Drive (D1, tabela `galeria_snapshot`,
// migrations/0003). Uma linha por pasta; regravada só quando o conteúdo muda.
// Não é KV de propósito: a cota de escrita do KV é da conta toda (~1000/dia).
//
// Tudo é best-effort: sem o binding `CONSENT_DB`, ou com o D1 falhando, a
// galeria funciona como antes (lista do Drive guardada em memória/Cache API) —
// só perde a opção de "congelar" a lista. Nunca derruba a página.
//
// Custo de subrequisição (conta do plano gratuito, src/config.js): cada
// operação no D1 conta como uma. Ler = 1; gravar = 1; marcar como conferida = 1.

import { GALERIA_SNAPSHOT_CONFERE_S } from './config.js';

/** @typedef {{ CONSENT_DB?: D1Database }} EnvSnapshot */

/**
 * SHA-256 (16 primeiros hex) do conteúdo da listagem SEM o instante da leitura:
 * duas leituras iguais do Drive dão o mesmo hash.
 * @param {object} dados
 */
export async function hashDaListagem(dados) {
  const texto = JSON.stringify({ ...dados, em: '' });
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(texto));
  return [...new Uint8Array(buf).slice(0, 8)].map(b => b.toString(16).padStart(2, '0')).join('');
}

/**
 * @param {EnvSnapshot} env
 * @param {string} chave
 * @param {string} ctx
 * @returns {Promise<{ hash: string, em: string, dados: string } | null>} null = sem foto (ou de outro contexto)
 */
export async function lerSnapshot(env, chave, ctx) {
  if (!env.CONSENT_DB) return null;
  try {
    const r = await env.CONSENT_DB.prepare('SELECT ctx, hash, em, dados FROM galeria_snapshot WHERE chave = ?').bind(chave).first();
    if (!r || r.ctx !== ctx) return null;
    return { hash: String(r.hash), em: String(r.em), dados: String(r.dados) };
  } catch (e) {
    console.error('galeria: leitura da foto da lista falhou', e);
    return null;
  }
}

/** Só o hash — não traz o JSON (que pode passar de 500 KB) quando basta comparar. @param {EnvSnapshot} env @param {string} chave @param {string} ctx */
async function lerHash(env, chave, ctx) {
  if (!env.CONSENT_DB) return null;
  try {
    const r = await env.CONSENT_DB.prepare('SELECT ctx, hash FROM galeria_snapshot WHERE chave = ?').bind(chave).first();
    return r && r.ctx === ctx ? String(r.hash) : null;
  } catch (e) {
    console.error('galeria: leitura do hash da lista falhou', e);
    return null;
  }
}

// O D1 aceita linhas de até 2 MB; a lista de 6000 fotos fica em ~600 KB.
// Acima de 1,5 MB não grava (e avisa no log) em vez de falhar na hora.
const TETO_BYTES = 1_500_000;

/**
 * A listagem guardada na foto durável, com o `em` da última CONFERÊNCIA (a
 * coluna), não o da última mudança (o JSON): a lista que o Drive confirmou
 * agora há pouco não é "velha" só porque ninguém mexeu na pasta.
 * @template {{ em: string }} T
 * @param {T} dados o JSON da foto, já lido
 * @param {{ em: string }} foto a linha
 * @returns {T}
 */
export function comEmConferido(dados, foto) {
  const coluna = Date.parse(foto.em);
  return coluna > Date.parse(dados.em) ? { ...dados, em: new Date(coluna).toISOString() } : dados;
}

/**
 * Releitura sem mudança: marca a foto como conferida agora, no máximo uma vez
 * a cada GALERIA_SNAPSHOT_CONFERE_S (o WHERE não toca a linha recém-marcada).
 * @param {EnvSnapshot} env
 * @param {string} chave
 * @param {string} ctx
 * @param {string} em o instante da releitura
 */
async function marcaConferida(env, chave, ctx, em) {
  const t = Date.parse(em);
  if (!env.CONSENT_DB || !Number.isFinite(t)) return;
  const limite = new Date(t - GALERIA_SNAPSHOT_CONFERE_S * 1000).toISOString();
  await env.CONSENT_DB.prepare('UPDATE galeria_snapshot SET em = ? WHERE chave = ? AND ctx = ? AND em < ?')
    .bind(new Date(t).toISOString(), chave, ctx, limite).run();
}

/**
 * Grava a listagem como a foto da pasta. Sem `forcar`, só grava se o conteúdo
 * mudou (1 leitura do hash; 1 escrita só quando mudou). Com `forcar` (o dono
 * tocou em "Atualizar agora", ou não havia foto) grava sempre — atualiza o "em".
 * @param {EnvSnapshot} env
 * @param {string} chave
 * @param {string} ctx
 * @param {{ em: string }} dados
 * @param {{ forcar?: boolean, slug?: string, antes?: string | null, aoMudar?: (anterior: unknown) => Promise<void> }} [opts] `antes`: o hash que o chamador JÁ leu do D1 (null = não havia linha; ausente = ler aqui) — poupa uma subrequisição; `slug`: o projeto dono
 *   (apagar o projeto apaga a linha); `aoMudar`: chamado com a listagem ANTERIOR quando o conteúdo mudou e havia uma
 *   (é daqui que sai a detecção de fotos sumidas). Nunca lança e roda antes da gravação.
 * @returns {Promise<boolean>} true se gravou
 */
export async function gravaSnapshot(env, chave, ctx, dados, { forcar = false, slug = '', antes: antesLido, aoMudar } = {}) {
  if (!env.CONSENT_DB) return false;
  try {
    const hash = await hashDaListagem(dados);
    const antes = antesLido !== undefined ? antesLido : await lerHash(env, chave, ctx);
    if (antes === hash && !forcar) { await marcaConferida(env, chave, ctx, dados.em); return false; }
    if (aoMudar && antes !== null && antes !== hash) {
      const foto = await lerSnapshot(env, chave, ctx);
      if (foto) {
        try { await aoMudar(JSON.parse(foto.dados)); } catch (e) { console.error('galeria: comparação com a foto anterior falhou', e); }
      }
    }
    const json = JSON.stringify(dados);
    if (json.length > TETO_BYTES) {
      console.error('galeria: lista grande demais para a foto durável', chave, json.length);
      return false;
    }
    await env.CONSENT_DB.prepare(
      'INSERT INTO galeria_snapshot (chave, slug, ctx, hash, em, dados) VALUES (?, ?, ?, ?, ?, ?) '
      + 'ON CONFLICT(chave) DO UPDATE SET slug = excluded.slug, ctx = excluded.ctx, hash = excluded.hash, em = excluded.em, dados = excluded.dados',
    ).bind(chave, slug, ctx, hash, dados.em, json).run();
    return true;
  } catch (e) {
    console.error('galeria: gravação da foto da lista falhou', e);
    return false;
  }
}

/** Apaga as fotos de todas as pastas de um projeto (projeto apagado). @param {EnvSnapshot} env @param {string} slug */
export async function apagaSnapshotsDoProjeto(env, slug) {
  if (!env.CONSENT_DB || !slug) return;
  try {
    await env.CONSENT_DB.prepare('DELETE FROM galeria_snapshot WHERE slug = ?').bind(slug).run();
  } catch (e) {
    console.error('galeria: apagar a foto da lista falhou', e);
  }
}
