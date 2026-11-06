// Fotos que sumiram da pasta do Drive (v3.1). A pasta é colaborativa de
// propósito (qualquer pessoa com o link envia E apaga), então cada releitura
// da lista é comparada com a foto durável anterior (D1, snapshot.js):
//
//   - listagem NOVA truncada não conclui nada (a foto pode estar no que não foi lido);
//   - cada id que sumiu é conferido com `files.get` (trashed,parents), no máximo
//     SUMIRAM_CONFERIR_MAX por releitura: inexistente ou na lixeira = APAGADA;
//     existe fora da lixeira = MOVIDA (só log); mais que o máximo = só a contagem;
//   - as apagadas vão para `galeria_apagadas` (30 dias; painel "Fotos apagadas
//     recentemente"); a chave primária é o que impede avisar a mesma foto duas vezes;
//   - UM e-mail-resumo ao dono por releitura (teto do dia: SUMIRAM_AVISO_DIA) e,
//     se o autor tem e-mail nos créditos, uma cópia só com as fotos dele
//     (teto AUTOR_AVISO_DIA, como os avisos do item 1c).
//
// Roda dentro da requisição que releu a lista, então tudo é best-effort e
// contado na conta das 50 subrequisições: a folga é o que SOBROU do teto de
// páginas da listagem (`ch` = páginas usadas). Sem folga, não confere nada e
// só registra no healthz. Nunca lança.

import {
  AUTOR_AVISO_DIA, AUTOR_PADRAO, SUMIRAM_AVISO_DIA, SUMIRAM_CONFERIR_MAX, SUMIRAM_COPIAS_MAX, SUMIRAM_RETENCAO_DIAS,
} from './config.js';
import { consultaArquivo, emailDoAutor, opcoesBasicasDaLista } from './drive.js';
import { checkRateLimit, dataHoraBR, errMessage, noteDegraded, sendSumiramEmail } from './utils.js';

/**
 * As opções de `listaPasta` para a galeria de um projeto, já com a detecção de
 * fotos sumidas ligada.
 * @param {Record<string, any>} event
 * @param {number} maxChamadas
 * @param {{ nome: string } | null} [capitulo] o capítulo que está sendo lido (nome, para o e-mail e o painel)
 */
export function opcoesDaLista(event, maxChamadas, capitulo = null) {
  return {
    ...opcoesBasicasDaLista(event, maxChamadas),
    aoMudar: (/** @type {any} */ env, /** @type {any} */ anterior, /** @type {any} */ nova) =>
      detectaSumidas(env, { evento: event, capitulo: capitulo ? String(capitulo.nome || '') : '', maxChamadas }, anterior, nova),
  };
}

/** AAAAMMDDHHMMSS → "AAAA-MM-DD HH:MM:SS" ('' sem data). @param {number | undefined} n */
function capturaLegivel(n) {
  const t = String(n || '');
  return /^\d{14}$/.test(t) ? `${t.slice(0, 4)}-${t.slice(4, 6)}-${t.slice(6, 8)} ${t.slice(8, 10)}:${t.slice(10, 12)}:${t.slice(12, 14)}` : '';
}

/**
 * @param {import('./utils.js').Env} env
 * @param {{ evento: Record<string, any>, capitulo: string, maxChamadas: number }} info
 * @param {import('./drive.js').ListagemDrive} anterior a foto durável de antes
 * @param {import('./drive.js').ListagemDrive} nova a lista recém-lida
 */
export async function detectaSumidas(env, info, anterior, nova) {
  const slug = String(info.evento.slug || '');
  try {
    if (!anterior || (anterior.v !== 2 && anterior.v !== 3) || !Array.isArray(anterior.secoes) || !nova || nova.truncada) return;
    const presentes = new Set();
    for (const s of nova.secoes) {
      for (const f of s.fotos) {
        presentes.add(f[0]);
        // O vídeo de um Live Photo deixa de ser item quando a foto aparece:
        // não é um arquivo que sumiu.
        if (Array.isArray(f[7])) presentes.add(f[7][0]);
      }
    }
    /** @type {{ f: import('./drive.js').FotoDrive, secao: string }[]} */
    const sumidas = [];
    for (const s of anterior.secoes) for (const f of s.fotos) if (!presentes.has(f[0])) sumidas.push({ f, secao: String(s.nome || '') });
    if (!sumidas.length) return;

    // Folga de subrequisições: o que a listagem não gastou do teto dela, menos
    // a leitura da foto anterior (já feita). Gasta em ordem de prioridade:
    // 3 reservadas (ficha do teto + envio ao dono, e a gravação no D1), depois
    // as conferências, depois as cópias aos autores (2 cada).
    let folga = info.maxChamadas - (typeof nova.ch === 'number' ? nova.ch : info.maxChamadas) - 1;
    if (folga < 3) {
      noteDegraded('fotos sumidas sem conferência', `${slug} — ${sumidas.length} foto(s), sem folga de subrequisições nesta leitura`);
      return;
    }
    folga -= 3;
    const aConferir = sumidas.length <= SUMIRAM_CONFERIR_MAX ? sumidas.slice(0, Math.min(folga, SUMIRAM_CONFERIR_MAX)) : [];
    folga -= aConferir.length;
    const estados = await Promise.all(aConferir.map(x => consultaArquivo(env, x.f[0], (anterior.rk && anterior.rk[x.f[0]]) || '')));
    let naoConferidas = sumidas.length - aConferir.length;
    /** @type {typeof sumidas} */
    const apagadas = [];
    estados.forEach((e, i) => {
      if (e === 'apagada') apagadas.push(aConferir[i]);
      else if (e === 'movida') console.log(`galeria: foto movida para fora da pasta (${slug}), sem aviso`);
      else naoConferidas++;
    });
    if (!apagadas.length && !naoConferidas) return;

    const aut = anterior.aut || [];
    const agora = new Date().toISOString();
    const itens = apagadas.map(x => ({
      id: x.f[0], nome: x.f[3], autor: aut[x.f[5] || 0] || AUTOR_PADRAO, secao: x.secao, captura: capturaLegivel(x.f[6]),
    }));

    // Quais são NOVAS (não registradas antes): é o que impede o aviso repetido.
    let novas = itens;
    if (itens.length && env.CONSENT_DB) {
      const db = env.CONSENT_DB;
      const corte = new Date(Date.now() - SUMIRAM_RETENCAO_DIAS * 86_400_000).toISOString();
      const lote = [
        db.prepare('DELETE FROM galeria_apagadas WHERE sumiu_em < ?').bind(corte),
        ...itens.map(i => db.prepare(
          'INSERT OR IGNORE INTO galeria_apagadas (slug, foto_id, nome, autor, capitulo, secao, captura, sumiu_em) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
        ).bind(slug, i.id, i.nome, i.autor, info.capitulo, i.secao, i.captura, agora)),
      ];
      const res = await db.batch(lote);
      novas = itens.filter((_, i) => Number(res[i + 1] && res[i + 1].meta && res[i + 1].meta.changes) > 0);
    }
    if (!novas.length && !naoConferidas) return;

    const projeto = String(info.evento.title || slug);
    const de = dataHoraBR(anterior.em);
    const ate = dataHoraBR(nova.em);

    // Ao dono: um resumo.
    if (env.RESEND_API_KEY && env.ADMIN_EMAIL) {
      if (await checkRateLimit(env, 'conta', 'sumiram-aviso-dia', SUMIRAM_AVISO_DIA, 86400)) {
        await tenta(slug, () => sendSumiramEmail(env, { to: String(env.ADMIN_EMAIL), projeto, capitulo: info.capitulo, itens: novas, naoConferidas, de, ate }));
      } else {
        noteDegraded('aviso de fotos sumidas pulado', `teto de ${SUMIRAM_AVISO_DIA}/dia atingido (${slug}) — a lista fica no painel`);
      }
    }

    // Aos autores com e-mail: só as fotos de cada um.
    /** @type {Map<string, typeof novas>} */
    const porAutor = new Map();
    for (const i of novas) porAutor.set(i.autor, [...(porAutor.get(i.autor) || []), i]);
    let copias = 0;
    for (const [autor, fotos] of porAutor) {
      const para = emailDoAutor(info.evento.galeriaCreditos, autor);
      if (!para || !env.RESEND_API_KEY) continue;
      if (copias >= SUMIRAM_COPIAS_MAX || folga < 2) {
        noteDegraded('cópia a autor de fotos sumidas pulada', `${slug} — sem folga de subrequisições`);
        break;
      }
      folga -= 2;
      if (!await checkRateLimit(env, 'conta', 'autor-aviso-dia', AUTOR_AVISO_DIA, 86400)) {
        noteDegraded('aviso ao autor pulado', `teto de ${AUTOR_AVISO_DIA}/dia atingido (${slug}) — volta na virada UTC`);
        break;
      }
      copias++;
      await tenta(slug, () => sendSumiramEmail(env, { to: para, paraAutor: true, projeto, capitulo: info.capitulo, itens: fotos, de, ate }));
    }
  } catch (e) {
    // Sem o objeto do erro e sem endereço no texto.
    noteDegraded('fotos sumidas: aviso não saiu', `${slug} — ${errMessage(e).replace(/[^\s@<>"']+@[^\s@<>"']+/g, '<e-mail>').slice(0, 120)}`);
  }
}

/** Um envio que falha não derruba os outros nem a leitura da lista. @param {string} slug @param {() => Promise<unknown>} envia */
async function tenta(slug, envia) {
  try {
    await envia();
  } catch (e) {
    noteDegraded('aviso de fotos sumidas não saiu', `${slug} — ${errMessage(e).replace(/[^\s@<>"']+@[^\s@<>"']+/g, '<e-mail>').slice(0, 120)}`);
  }
}

/**
 * "Fotos apagadas recentemente" de um projeto (últimos 30 dias, a mais nova
 * primeiro). Poda as antigas na mesma ida ao banco.
 * @param {import('./utils.js').Env} env
 * @param {string} slug
 * @returns {Promise<{ fotoId: string, nome: string, autor: string, capitulo: string, secao: string, captura: string, sumiuEm: string }[]>}
 */
export async function listaApagadas(env, slug) {
  if (!env.CONSENT_DB) return [];
  try {
    const db = env.CONSENT_DB;
    const corte = new Date(Date.now() - SUMIRAM_RETENCAO_DIAS * 86_400_000).toISOString();
    const [, lista] = await db.batch([
      db.prepare('DELETE FROM galeria_apagadas WHERE sumiu_em < ?').bind(corte),
      db.prepare('SELECT foto_id, nome, autor, capitulo, secao, captura, sumiu_em FROM galeria_apagadas WHERE slug = ? ORDER BY sumiu_em DESC, nome LIMIT 500').bind(slug),
    ]);
    return (lista.results || []).map((/** @type {any} */ r) => ({
      fotoId: String(r.foto_id), nome: String(r.nome), autor: String(r.autor), capitulo: String(r.capitulo),
      secao: String(r.secao), captura: String(r.captura), sumiuEm: String(r.sumiu_em),
    }));
  } catch (e) {
    noteDegraded('fotos apagadas: leitura falhou', `${slug} — ${errMessage(e).slice(0, 120)}`);
    return [];
  }
}

/** Apaga as linhas de um projeto (projeto apagado). @param {import('./utils.js').Env} env @param {string} slug */
export async function apagaApagadasDoProjeto(env, slug) {
  if (!env.CONSENT_DB || !slug) return;
  try {
    await env.CONSENT_DB.prepare('DELETE FROM galeria_apagadas WHERE slug = ?').bind(slug).run();
  } catch (e) {
    console.error('galeria: apagar a lista de fotos apagadas falhou', e);
  }
}
