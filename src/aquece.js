// Aquecer o álbum (v3.7.3). O primeiro visitante de cada data center não pode
// esperar o Google Drive: no lançamento, a turma inteira chega de uma vez.
//
// O que fica pronto, em lugar GLOBAL (vale para qualquer data center):
//  - a lista de eventos e a de fotos de cada evento: relidas à força, o que
//    grava a "foto durável" no D1 com a hora nova (a página serve essa foto na
//    hora, por até GALERIA_VELHO_MAX_S, e relê o Drive por trás);
//  - o resumo de cada evento (capas, número de fotos, datas da linha do tempo),
//    que agora também vai para o KV (drive.js, registraResumo).
//
// Quando: o cron roda a cada 5 min (wrangler.toml). Um álbum por capítulos que
// ainda não foi lançado é aquecido a cada AQUECE_A_CADA_MS; um álbum com
// lançamento AGENDADO, de novo nos AQUECE_ANTES_MS antes da hora. O
// "Lançar agora" pega o que o ciclo de 3 h deixou pronto.
//
// Custo: cada evento relido gasta as chamadas da listagem dele. Por execução,
// no máximo AQUECE_TETO_CHAMADAS; o que faltar fica para a próxima (o
// progresso fica no KV, `aquece:<slug>`).

import { alvoDaGaleria, listaPasta, registraResumo, DriveError } from './drive.js';
import { opcoesDaLista } from './sumiram.js';

export const AQUECE_A_CADA_MS = 3 * 3600 * 1000;
export const AQUECE_ANTES_MS = 30 * 60 * 1000;
export const AQUECE_TETO_CHAMADAS = 600;

/**
 * Este álbum precisa de um ciclo novo de aquecimento agora?
 * @param {any} evento
 * @param {{ inicio?: number, lancar?: string } | null} estado
 * @param {number} agora
 * @returns {string | null} o motivo ("lancamento" ou "periodico"), ou null
 */
export function precisaAquecer(evento, estado, agora) {
  if (!evento || !evento.galeriaCapitulos || !evento.driveUrl) return null;
  const t = typeof evento.lancarEm === 'string' && evento.lancarEm ? Date.parse(evento.lancarEm) : NaN;
  if (Number.isFinite(t) && t > agora && t - agora <= AQUECE_ANTES_MS && (!estado || estado.lancar !== evento.lancarEm)) return 'lancamento';
  // O ciclo de 3 h é só para o álbum "Em breve" (o que vai ser lançado);
  // projeto lançado ou apenas oculto não é aquecido.
  if (evento.comingSoon !== true) return null;
  if (!estado || !estado.inicio || agora - estado.inicio >= AQUECE_A_CADA_MS) return 'periodico';
  return null;
}

/**
 * Relê, à força, a lista de eventos e as fotos dos eventos que faltam no ciclo,
 * até o teto de chamadas. Nunca lança: erro de um evento não para os outros.
 * @param {any} env
 * @param {any} evento
 * @param {{ inicio: number, lancar: string, feitos: string[] }} estado (alterado: `feitos`)
 * @returns {Promise<{ eventos: number, feitos: number, chamadas: number, completo: boolean }>}
 */
export async function aqueceUm(env, evento, estado) {
  let chamadas = 1;
  let alvo;
  try {
    alvo = await alvoDaGaleria(env, evento, '', true);
  } catch (e) {
    if (!(e instanceof DriveError)) throw e;
    // A pasta do álbum não abriu: desiste até o próximo ciclo.
    return { eventos: 0, feitos: estado.feitos.length, chamadas, completo: true };
  }
  if (alvo.kind !== 'ok' || !alvo.caps) return { eventos: 0, feitos: estado.feitos.length, chamadas, completo: true };
  const caps = alvo.caps.caps;
  for (const cap of caps) {
    if (estado.feitos.includes(cap.id)) continue;
    if (chamadas >= AQUECE_TETO_CHAMADAS) break;
    try {
      const a = await alvoDaGaleria(env, evento, cap.slug);
      if (a.kind !== 'ok' || !a.pasta) { estado.feitos.push(cap.id); continue; }
      const listagem = await listaPasta(env, a.pasta, { atualizar: true, ...opcoesDaLista(evento, a.maxChamadas, a.capitulo) });
      chamadas += Number(listagem.ch) || 1;
      await registraResumo(a.raiz.id, cap.id, listagem, env);
    } catch (e) {
      if (!(e instanceof DriveError)) throw e;
      chamadas += 1;
      console.error(`aquece: ${evento.slug}/${cap.slug} falhou`, e.message);
    }
    estado.feitos.push(cap.id);
  }
  const completo = caps.every(c => estado.feitos.includes(c.id));
  return { eventos: caps.length, feitos: estado.feitos.length, chamadas, completo };
}

/**
 * O que o cron chama a cada 5 min. Um álbum por execução (o primeiro que
 * precisa), para o teto de chamadas valer por execução.
 * @param {any} env
 * @param {any[]} eventos
 * @param {number} [agora]
 * @returns {Promise<{ slug: string, motivo: string, eventos: number, feitos: number, chamadas: number, completo: boolean } | null>}
 */
export async function aqueceAlbuns(env, eventos, agora = Date.now()) {
  if (!env || !env.FOTOS || !Array.isArray(eventos)) return null;
  for (const evento of eventos) {
    if (!evento || !evento.galeriaCapitulos) continue;
    const chave = `aquece:${evento.slug}`;
    /** @type {any} */
    let estado;
    try { estado = JSON.parse((await env.FOTOS.get(chave)) || 'null'); } catch { estado = null; }
    const incompleto = estado && Array.isArray(estado.feitos) && estado.completo === false;
    const motivo = precisaAquecer(evento, estado, agora);
    if (!motivo && !incompleto) continue;
    if (motivo) estado = { inicio: agora, lancar: motivo === 'lancamento' ? evento.lancarEm : (estado && estado.lancar) || '', feitos: [], completo: false };
    const r = await aqueceUm(env, evento, estado);
    estado.completo = r.completo;
    await env.FOTOS.put(chave, JSON.stringify(estado), { expirationTtl: 30 * 86400 });
    console.log(`aquece: ${evento.slug} (${motivo || 'continua'}) ${r.feitos}/${r.eventos} eventos, ${r.chamadas} chamadas${r.completo ? ', pronto' : ''}`);
    return { slug: evento.slug, motivo: motivo || 'continua', ...r };
  }
  return null;
}
