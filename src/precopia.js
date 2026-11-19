// Pré-cópia dos originais para o R2 (v4.9.0). O Google Drive de conta pessoal
// trava o download de um arquivo quando muita gente o baixa ao mesmo tempo
// ("too many users", `downloadQuotaExceeded`, #233). Desde a 3.8.3 o original
// vai para o R2 no PRIMEIRO download e os seguintes saem de lá; o furo era
// justamente esse primeiro download, que no pico do lançamento é de todo
// mundo ao mesmo tempo. Aqui o cron copia o álbum inteiro ANTES: no dia, o
// download nem chega ao Google.
//
// O que é copiado, para cada álbum em `R2_PRECOPIA_SLUGS` (wrangler.toml):
//  - o original de cada foto e de cada vídeo de cada capítulo (ou da pasta,
//    sem capítulos), mais o vídeo de cada Live Photo;
//  - a versão "para redes" (a pasta do Instagram do projeto, se houver).
// Nunca: foto oculta (o dono a escondeu; se ela voltar, a cópia vem no ciclo
// seguinte) nem arquivo maior que R2_ORIGINAL_MAX.
//
// Custo (R2, preço de 2026): ~US$ 0,015 por GB por mês, os primeiros 10 GB
// grátis, sem tarifa de saída. Um álbum de 5 mil fotos (~60 GB) fica perto de
// US$ 1 por mês. As gravações (classe A) são uma por arquivo, uma vez; a
// listagem do que já está lá é por páginas de 1000 chaves.
//
// Ritmo: o cron roda a cada 5 min. Por execução, no máximo PRECOPIA_POR_VEZ
// arquivos (PRECOPIA_PARALELO de cada vez) e PRECOPIA_BYTES_POR_VEZ; o
// progresso fica no KV (`precopia:<slug>`). Com o álbum inteiro copiado, o
// ciclo recomeça a cada PRECOPIA_A_CADA_MS, para pegar as fotos novas. Se o
// Google disser "limite", a execução para na hora e tenta de novo na próxima.
//
// Teto (src/r2-limite.js): a pré-cópia para em PRECOPIA_FRACAO_DO_TETO do
// `R2_LIMITE_GB`, deixando a folga para as miniaturas e as cópias do primeiro
// download. Cheio, nem começa.

import { alvoDaGaleria, listaPasta, pastaInstagram, politicaDoInstagram, planoPago, normalizaOcultas, urlOriginal, erroDaApi, idDriveValido, DriveError } from './drive.js';
import { opcoesDaLista } from './sumiram.js';
import { R2_ORIGINAL_MAX } from './foto-rota.js';
import { GALERIA_MAX_CHAMADAS_IG, GALERIA_MAX_CHAMADAS_IG_PAGO } from './config.js';
import { usoAtualizado, gravaUsoDoR2, limiteDoR2 } from './r2-limite.js';

export const PRECOPIA_POR_VEZ = 30;
export const PRECOPIA_PARALELO = 4;
export const PRECOPIA_BYTES_POR_VEZ = 3 * 1024 * 1024 * 1024;
export const PRECOPIA_A_CADA_MS = 6 * 3600 * 1000;
const PRECOPIA_PRAZO_MS = 120 * 1000;
export const PRECOPIA_FRACAO_DO_TETO = 0.95;

/**
 * Os álbuns a pré-copiar: `R2_PRECOPIA_SLUGS`, separados por vírgula.
 * @param {any} env
 * @returns {string[]}
 */
export function slugsDaPrecopia(env) {
  return String((env && env.R2_PRECOPIA_SLUGS) || '').split(',').map(s => s.trim()).filter(Boolean);
}

/**
 * Os arquivos de uma listagem que valem cópia: cada item e o vídeo do Live
 * Photo dele. Sem as ocultas, sem o que passa do teto do R2.
 * @param {import('./drive.js').ListagemDrive} listagem
 * @param {Set<string>} ocultas
 * @returns {{ id: string, bytes: number, rk: string }[]}
 */
export function arquivosDaListagem(listagem, ocultas) {
  /** @type {{ id: string, bytes: number, rk: string }[]} */
  const fora = [];
  const rk = (listagem && listagem.rk) || {};
  for (const s of (listagem && listagem.secoes) || []) {
    for (const f of s.fotos || []) {
      if (!f || ocultas.has(f[0])) continue;
      const bytes = Number(f[4]) || 0;
      if (idDriveValido(f[0]) && bytes > 0 && bytes <= R2_ORIGINAL_MAX) fora.push({ id: f[0], bytes, rk: rk[f[0]] || '' });
      const l = f[7];
      if (Array.isArray(l) && idDriveValido(l[0])) {
        const b = Number(l[2]) || 0;
        if (b > 0 && b <= R2_ORIGINAL_MAX) fora.push({ id: l[0], bytes: b, rk: rk[l[0]] || '' });
      }
    }
  }
  return fora;
}

/**
 * Os ids que já têm original no R2 (`o/<id>`), lidos por páginas.
 * @param {any} r2
 * @returns {Promise<Set<string>>}
 */
export async function originaisNoR2(r2) {
  const ids = new Set();
  /** @type {string | undefined} */
  let cursor;
  do {
    const pagina = await r2.list({ prefix: 'o/', limit: 1000, ...(cursor ? { cursor } : {}) });
    for (const o of pagina.objects || []) ids.add(String(o.key).slice(2));
    cursor = pagina.truncated ? pagina.cursor : undefined;
  } while (cursor);
  return ids;
}

/**
 * Copia um arquivo do Drive para o R2. 'limite' quando o Google recusou por
 * excesso (a execução para); true/false para o resto.
 * @param {any} env
 * @param {{ id: string, rk: string }} arq
 * @param {typeof fetch} f
 * @returns {Promise<true | false | 'limite'>}
 */
async function copiaUm(env, arq, f) {
  /** @type {Record<string, string>} */
  const headers = {};
  if (arq.rk) headers['X-Goog-Drive-Resource-Keys'] = `${arq.id}/${arq.rk}`;
  try {
    const r = await f(urlOriginal(arq.id, (env.GOOGLE_DRIVE_API_KEY || '').trim()), { headers });
    if (!r.ok || !r.body) {
      const erro = await erroDaApi(r);
      if (erro.codigo === 'limite') return 'limite';
      console.error(`precopia: ${arq.id} recusado (${r.status} ${erro.codigo})`);
      return false;
    }
    const tipo = (r.headers.get('Content-Type') || 'application/octet-stream').split(';')[0].trim();
    await env.FOTOS_R2.put(`o/${arq.id}`, r.body, { httpMetadata: { contentType: tipo } });
    return true;
  } catch (e) {
    console.error(`precopia: ${arq.id} falhou`, e);
    return false;
  }
}

/**
 * As fontes de um álbum, na ordem da cópia: a pasta do Instagram primeiro (os
 * arquivos pequenos, os mais baixados no celular), depois cada capítulo.
 * Cada fonte é lida só quando a vez dela chega.
 * @param {any} env
 * @param {any} evento
 * @returns {Promise<{ chave: string, lista: () => Promise<import('./drive.js').ListagemDrive> }[]>}
 */
async function fontesDoAlbum(env, evento) {
  /** @type {{ chave: string, lista: () => Promise<import('./drive.js').ListagemDrive> }[]} */
  const fontes = [];
  const ig = pastaInstagram(evento);
  if (ig) {
    const maxChamadas = planoPago(env) ? GALERIA_MAX_CHAMADAS_IG_PAGO : GALERIA_MAX_CHAMADAS_IG;
    fontes.push({ chave: `ig:${ig.id}`, lista: () => listaPasta(env, ig, { maxChamadas, ...politicaDoInstagram(evento) }) });
  }
  const alvo = await alvoDaGaleria(env, evento, '');
  if (alvo.kind !== 'ok') return fontes;
  if (!evento.galeriaCapitulos) {
    if (alvo.pasta) {
      const pasta = alvo.pasta;
      fontes.push({ chave: `raiz:${pasta.id}`, lista: () => listaPasta(env, pasta, { ...opcoesDaLista(evento, alvo.maxChamadas, null) }) });
    }
    return fontes;
  }
  for (const cap of (alvo.caps && alvo.caps.caps) || []) {
    fontes.push({
      chave: `cap:${cap.id}`,
      lista: async () => {
        const a = await alvoDaGaleria(env, evento, cap.slug);
        if (a.kind !== 'ok' || !a.pasta) return /** @type {any} */ ({ secoes: [] });
        return listaPasta(env, a.pasta, { ...opcoesDaLista(evento, a.maxChamadas, a.capitulo) });
      },
    });
  }
  return fontes;
}

/**
 * Uma execução para um álbum: copia o que falta, até o orçamento.
 * @param {any} env
 * @param {any} evento
 * @param {{ inicio: number, feitas: string[], copiados: number, completo: boolean, em?: number, noR2?: number }} estado (alterado)
 * @param {{ fetch?: typeof fetch, agora?: number, uso?: import('./r2-limite.js').UsoR2 }} [op]
 */
export async function precopiaUm(env, evento, estado, op = {}) {
  const f = op.fetch || fetch;
  const t0 = Date.now();
  const uso = op.uso || await usoAtualizado(env, op.agora);
  const teto = limiteDoR2(env) * PRECOPIA_FRACAO_DO_TETO;
  const ocultas = new Set(normalizaOcultas(evento.fotosOcultas));
  const noR2 = await originaisNoR2(env.FOTOS_R2);
  const fontes = await fontesDoAlbum(env, evento);
  let copiados = 0;
  let bytes = 0;
  let parou = '';
  let faltam = 0;
  for (const fonte of fontes) {
    if (estado.feitas.includes(fonte.chave)) continue;
    if (parou) break;
    /** @type {import('./drive.js').ListagemDrive} */
    let listagem;
    try {
      listagem = await fonte.lista();
    } catch (e) {
      if (!(e instanceof DriveError)) throw e;
      console.error(`precopia: ${evento.slug} ${fonte.chave} não abriu`, e.message);
      if (e.codigo === 'limite') { parou = 'limite'; break; }
      // Pasta que não abre: fica para o próximo ciclo, não trava as outras.
      estado.feitas.push(fonte.chave);
      continue;
    }
    const pendentes = arquivosDaListagem(listagem, ocultas).filter(a => !noR2.has(a.id));
    let i = 0;
    let falhou = false;
    while (i < pendentes.length && !parou) {
      if (copiados >= PRECOPIA_POR_VEZ || bytes >= PRECOPIA_BYTES_POR_VEZ || Date.now() - t0 > PRECOPIA_PRAZO_MS) { parou = 'orcamento'; break; }
      const lote = pendentes.slice(i, i + Math.min(PRECOPIA_PARALELO, PRECOPIA_POR_VEZ - copiados));
      // O teto do bucket vale antes de baixar: o lote inteiro tem de caber.
      if (uso.bytes + bytes + lote.reduce((t, a) => t + a.bytes, 0) > teto) { parou = 'teto-r2'; break; }
      i += lote.length;
      const rs = await Promise.all(lote.map(a => copiaUm(env, a, f)));
      rs.forEach((r, k) => {
        if (r === true) { copiados++; bytes += lote[k].bytes; noR2.add(lote[k].id); } else falhou = true;
      });
      if (rs.includes('limite')) parou = 'limite';
    }
    const resto = pendentes.filter(a => !noR2.has(a.id)).length;
    faltam += resto;
    // A fonte está feita quando tudo dela foi copiado; um arquivo que falhou
    // (não por limite) não prende a fonte para sempre: volta no próximo ciclo.
    if (!parou && (resto === 0 || falhou)) estado.feitas.push(fonte.chave);
  }
  // O que esta execução gravou entra na conta até a próxima medição.
  if (copiados) await gravaUsoDoR2(env, { bytes: uso.bytes + bytes, objetos: uso.objetos + copiados, em: uso.em });
  estado.copiados = (Number(estado.copiados) || 0) + copiados;
  estado.completo = !parou && fontes.every(x => estado.feitas.includes(x.chave));
  estado.em = op.agora || Date.now();
  estado.noR2 = noR2.size;
  return { copiados, bytes, parou: parou || null, completo: estado.completo, fontes: fontes.length, feitas: estado.feitas.length, faltam };
}

/**
 * O que o cron chama a cada 5 min: o primeiro álbum de R2_PRECOPIA_SLUGS que
 * tem cópia por fazer. Sem R2 (a prévia), nada.
 * @param {any} env
 * @param {any[]} eventos
 * @param {{ fetch?: typeof fetch, agora?: number }} [op]
 */
export async function precopiaAlbuns(env, eventos, op = {}) {
  if (!env || !env.FOTOS_R2 || !env.FOTOS || !Array.isArray(eventos)) return null;
  const agora = op.agora || Date.now();
  // A medição do bucket roda mesmo sem álbum na lista: é ela que libera a
  // cópia do primeiro download e as miniaturas (o teto falha fechado).
  /** @type {import('./r2-limite.js').UsoR2} */
  let uso;
  try {
    uso = await usoAtualizado(env, agora);
  } catch (e) {
    console.error('precopia: medição do R2 falhou', e);
    return null;
  }
  if (uso.bytes >= limiteDoR2(env) * PRECOPIA_FRACAO_DO_TETO) {
    console.log(`precopia: R2 no teto (${Math.round(uso.bytes / 1073741824)} GB), nada a copiar`);
    return null;
  }
  for (const slug of slugsDaPrecopia(env)) {
    const evento = eventos.find(e => e && e.slug === slug);
    if (!evento || !evento.driveUrl) continue;
    const chave = `precopia:${slug}`;
    /** @type {any} */
    let estado;
    try { estado = JSON.parse((await env.FOTOS.get(chave)) || 'null'); } catch { estado = null; }
    if (estado && estado.completo && agora - (Number(estado.inicio) || 0) < PRECOPIA_A_CADA_MS) continue;
    if (!estado || !Array.isArray(estado.feitas) || estado.completo) estado = { inicio: agora, feitas: [], copiados: 0, completo: false };
    const r = await precopiaUm(env, evento, estado, { ...op, agora, uso });
    await env.FOTOS.put(chave, JSON.stringify(estado), { expirationTtl: 30 * 86400 });
    console.log(`precopia: ${slug} +${r.copiados} arquivos (${Math.round(r.bytes / 1048576)} MB), ${r.feitas}/${r.fontes} pastas${r.completo ? ', pronto' : ''}${r.parou ? `, parou (${r.parou})` : ''}`);
    return { slug, ...r };
  }
  return null;
}

/**
 * O andamento, para o healthz: só números somados, sem slug, id ou nome de
 * arquivo. null sem álbum configurado.
 * @param {any} env
 * @returns {Promise<{ albuns: number, completos: number, copiados: number, noR2: number } | null>}
 */
export async function andamentoDaPrecopia(env) {
  const slugs = slugsDaPrecopia(env);
  if (!env || !env.FOTOS || !env.FOTOS_R2 || !slugs.length) return null;
  const fora = { albuns: slugs.length, completos: 0, copiados: 0, noR2: 0 };
  for (const slug of slugs) {
    try {
      const e = JSON.parse((await env.FOTOS.get(`precopia:${slug}`)) || 'null');
      if (!e) continue;
      if (e.completo) fora.completos++;
      fora.copiados += Number(e.copiados) || 0;
      fora.noR2 = Math.max(fora.noR2, Number(e.noR2) || 0);
    } catch { /* estado ilegível: conta como não começado */ }
  }
  return fora;
}
