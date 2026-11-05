// Aviso por e-mail ao AUTOR de uma foto (v3.1). Só quando a foto vem de uma
// pasta de autor cujo e-mail está nos créditos do projeto; foto do autor padrão
// (sem e-mail) não gera nada. Roda sempre dentro de `ctx.waitUntil` e NUNCA
// derruba a ação principal: toda falha vira registro no healthz.
//
// Salvaguardas, nesta ordem (da mais barata à mais cara):
//   1. sem chave do Resend, sem e-mail do autor, ou foto fora da listagem: nada;
//   2. no máximo UM aviso por foto, por tipo de ocorrência, a cada 24 h (o
//      retry de um pedido ou o clique repetido não duplica);
//   3. teto do dia da conta (AUTOR_AVISO_DIA): estourou, pula e registra.
// O e-mail do autor não aparece em log: só o nome do projeto e o motivo.

import { AUTOR_AVISO_DIA } from './config.js';
import { achaFoto, emailDoAutor, listaPasta, alvoDaGaleria } from './drive.js';
import { opcoesDaLista } from './sumiram.js';
import { checkRateLimit, noteDegraded, errMessage, sendAutorEmail } from './utils.js';

/**
 * @typedef {'pedido' | 'mantida' | 'devolvida' | 'oculta' | 'restaurada'} TipoAviso
 */

/**
 * Avisa o autor da foto, se houver e-mail. Nunca lança.
 * @param {import('./utils.js').Env} env
 * @param {Record<string, any>} evento o projeto (traz driveUrl e galeriaCreditos)
 * @param {{ fotoId: string, tipo: TipoAviso, motivo?: string, ocultada?: boolean, capitulo?: string, capituloNome?: string, listagem?: import('./drive.js').ListagemDrive }} o
 * @returns {Promise<'enviado' | 'sem-chave' | 'sem-autor' | 'sem-email' | 'repetido' | 'teto' | 'erro'>}
 */
export async function avisaAutor(env, evento, o) {
  try {
    if (!env.RESEND_API_KEY) return 'sem-chave';
    let listagem = o.listagem;
    let nomeCapitulo = o.capituloNome || '';
    if (!listagem) {
      // Só o capítulo da foto (ou a pasta do projeto): nunca um ID vindo de fora.
      const alvo = await alvoDaGaleria(env, evento, o.capitulo || '');
      if (alvo.kind !== 'ok' || !alvo.pasta) return 'sem-autor';
      listagem = await listaPasta(env, alvo.pasta, opcoesDaLista(evento, alvo.maxChamadas, alvo.capitulo));
      nomeCapitulo = alvo.capitulo ? alvo.capitulo.nome : '';
    }
    const f = achaFoto(listagem, o.fotoId);
    if (!f) return 'sem-autor';
    const nome = (listagem.aut || [])[f[5] || 0] || '';
    const para = nome ? emailDoAutor(evento.galeriaCreditos, nome) : '';
    if (!para) return 'sem-email';

    // Sem ":" na chave: ipParaLimite() leria como IPv6.
    if (!await checkRateLimit(env, `${evento.slug}|${o.fotoId}`, `autor-aviso-${o.tipo}`, 1, 86400)) return 'repetido';
    if (!await checkRateLimit(env, 'conta', 'autor-aviso-dia', AUTOR_AVISO_DIA, 86400)) {
      noteDegraded('aviso ao autor pulado', `teto de ${AUTOR_AVISO_DIA}/dia atingido (${evento.slug}) — volta na virada UTC`);
      return 'teto';
    }
    const secao = listagem.secoes.find(s => s.fotos.some(x => x[0] === o.fotoId));
    await sendAutorEmail(env, {
      to: para,
      tipo: o.tipo,
      projeto: String(evento.title || evento.slug),
      capitulo: nomeCapitulo,
      secao: secao ? String(secao.nome || '') : '',
      fotoId: o.fotoId,
      motivo: o.motivo,
      ocultada: o.ocultada,
    });
    return 'enviado';
  } catch (e) {
    // Sem o objeto do erro e sem endereço no texto: o e-mail do autor não vai a log.
    noteDegraded('aviso ao autor não saiu', `${evento && evento.slug} — ${errMessage(e).replace(/[^\s@<>"']+@[^\s@<>"']+/g, '<e-mail>').slice(0, 120)}`);
    return 'erro';
  }
}
