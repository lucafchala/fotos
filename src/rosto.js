// Busca pelo rosto (v3.2) sobre a Amazon Rekognition. O índice de um álbum é
// uma COLEÇÃO da Rekognition (`fotos-<slug>`): cada rosto de cada foto vira um
// vetor lá, com o ExternalImageId `<capítulo>:<id do Drive>`. Quem preenche a
// coleção é o indexador (scripts/rosto-indexa.mjs, no GitHub Actions); o
// Worker só BUSCA e APAGA — a selfie nunca é guardada.
//
// "Não quero aparecer na busca" (v3.8.9): o rosto da pessoa fica como uma
// MARCA dentro do próprio índice do álbum (ExternalImageId `saiu`, que não é
// foto nenhuma), com o consentimento dela e só para isso. A marca faz duas
// coisas:
//   - toda busca que a encontra entre os parecidos responde "você saiu", sem
//     mostrar nada (confereSaida), na régua mais baixa da busca;
//   - o indexador, depois de indexar fotos novas, procura os parecidos com cada
//     marca e os apaga (limpaRostosDeQuemSaiu). É o que faz a saída valer para
//     as fotos que chegam DEPOIS.
// Por que no mesmo índice: a Rekognition só compara um rosto já indexado com
// outros da MESMA coleção (SearchFaces), e a busca por imagem numa foto de
// grupo só olha o maior rosto. Com a marca numa coleção à parte (até a 3.8.8,
// `fotos-<slug>-sair`), não havia como perguntar "algum rosto desta foto nova
// é de quem saiu?", e a foto nova de quem saiu entrava no índice.
// A coleção antiga ainda é consultada enquanto existir a marca dela no KV
// (`rosto-sair:<slug>`): quem saiu antes desta versão continua fora da busca
// com a própria selfie.
//
// Ver docs/ROSTO.md (por que a Rekognition, custos, LGPD).

import { rekognition, ErroAws } from './aws.js';
import { ROSTO_REGIAO_PADRAO, ROSTO_LIMIAR, ROSTO_LIMIAR_BUSCA, ROSTO_LIMIAR_SAIR, ROSTO_MAX_RESULTADOS, ROSTO_IMAGEM_MAX_B64, ROSTO_SEMENTES, ROSTO_SEMENTE_MIN, ROSTO_LIMIAR_SEMENTE } from './config.js';

export { ErroAws };

const REGIAO_RE = /^[a-z]{2}(-[a-z]+)+-\d$/;
const ID_DRIVE_RE = /^[A-Za-z0-9_-]{10,200}$/;
const CAP_RE = /^[a-z0-9][a-z0-9-]{0,79}$/;

/**
 * As credenciais da AWS, ou null (busca desligada no site inteiro).
 * @param {import('./utils.js').Env} env
 * @returns {import('./aws.js').CredAws | null}
 */
export function credAws(env) {
  const chave = String(env.AWS_ACCESS_KEY_ID || '').trim();
  const segredo = String(env.AWS_SECRET_ACCESS_KEY || '').trim();
  if (!chave || !segredo) return null;
  const r = String(env.AWS_REGION || '').trim();
  return { chave, segredo, regiao: REGIAO_RE.test(r) ? r : ROSTO_REGIAO_PADRAO };
}

/** Os nomes das duas coleções de um álbum. @param {string} slug */
export function colecoes(slug) {
  return { principal: `fotos-${slug}`, sair: `fotos-${slug}-sair` };
}

/** O ExternalImageId da marca de quem saiu da busca (não é foto: não tem ":"). */
export const MARCA_SAIU = 'saiu';

/** Este rosto do índice é a marca de alguém que saiu? @param {any} face */
export function ehMarcaDeSaida(face) {
  return !!face && face.ExternalImageId === MARCA_SAIU;
}

/**
 * Entre os parecidos que a Rekognition devolveu há a marca de alguém que saiu,
 * na régua mais baixa da busca? Uma regra só, para a busca pela selfie e para
 * a atualização de "minhas fotos": o que a busca mostraria (até o "Talvez"), a
 * saída esconde.
 * @param {unknown} matches
 */
export function confereSaida(matches) {
  return (Array.isArray(matches) ? matches : []).some(m => m && ehMarcaDeSaida(m.Face) && Number(m.Similarity) >= ROSTO_LIMIAR_BUSCA);
}

/** O ExternalImageId de uma foto. @param {string} cap @param {string} id */
export function idExterno(cap, id) {
  return `${cap}:${id}`;
}

/**
 * Lê o ExternalImageId de volta, ou null se não for nosso.
 * @param {unknown} v
 * @returns {{ cap: string, id: string } | null}
 */
export function lerIdExterno(v) {
  if (typeof v !== 'string') return null;
  const i = v.lastIndexOf(':');
  if (i < 0) return null;
  const cap = v.slice(0, i);
  const id = v.slice(i + 1);
  if (cap && !CAP_RE.test(cap)) return null;
  return ID_DRIVE_RE.test(id) ? { cap, id } : null;
}

/**
 * A selfie como a Rekognition recebe (base64 de um JPEG ou PNG), conferida só
 * por forma: tamanho, alfabeto e assinatura do arquivo. Sem decodificar —
 * decodificar custaria CPU à toa, a AWS confere o resto.
 * @param {unknown} b64
 * @returns {b64 is string}
 */
export function imagemValida(b64) {
  if (typeof b64 !== 'string' || b64.length < 100 || b64.length > ROSTO_IMAGEM_MAX_B64) return false;
  if (b64.length % 4 !== 0 || !/^[A-Za-z0-9+/]+={0,2}$/.test(b64)) return false;
  return b64.startsWith('/9j/') || b64.startsWith('iVBORw0KGgo');
}

/** A AWS recusou porque não há rosto na imagem. @param {unknown} e */
function semRosto(e) {
  return e instanceof ErroAws && e.tipo === 'InvalidParameterException';
}

/** A coleção ainda não existe (o indexador não rodou, ninguém saiu). @param {unknown} e */
function semColecao(e) {
  return e instanceof ErroAws && e.tipo === 'ResourceNotFoundException';
}

/** A AWS pediu para esperar (cota de buscas por segundo). @param {unknown} e */
export function ehAcelerado(e) {
  return e instanceof ErroAws && /Throttling|ProvisionedThroughputExceeded|LimitExceeded/.test(e.tipo);
}

/**
 * @typedef {{ cap: string, id: string, sim: number }} AchadoRosto
 * @typedef {{ tipo: 'ok', resultados: AchadoRosto[], faces?: string[] } | { tipo: 'sem-rosto' } | { tipo: 'saiu' } | { tipo: 'sem-indice' }} ResultadoBusca
 */

/**
 * Busca as fotos do álbum com o rosto da selfie. Lança ErroAws em falha da
 * AWS que não seja "sem rosto" nem "sem coleção" (quem chama decide 429/503).
 * @param {import('./aws.js').CredAws} cred
 * @param {string} slug
 * @param {string} imagem base64 (já conferida por imagemValida)
 * @param {Iterable<string>} ocultas IDs do Drive que o público não vê
 * @param {{ fetch?: typeof fetch, temSair?: boolean }} [opcoes] `temSair: false`
 *   pula a consulta à coleção ANTIGA de quem saiu (até a 3.8.8); a marca de
 *   quem saiu desde a 3.8.9 vem na própria busca, sem chamada a mais
 * @returns {Promise<ResultadoBusca>}
 */
export async function buscaPorRosto(cred, slug, imagem, ocultas, opcoes = {}) {
  const c = colecoes(slug);
  const Image = { Bytes: imagem };
  // 1. Quem saiu ANTES da 3.8.9 (coleção antiga), na régua mais baixa da busca.
  if (opcoes.temSair !== false) try {
    const r = await rekognition(cred, 'SearchFacesByImage', { CollectionId: c.sair, Image, MaxFaces: 1, FaceMatchThreshold: ROSTO_LIMIAR_BUSCA }, opcoes);
    if (Array.isArray(r.FaceMatches) && r.FaceMatches.length) return { tipo: 'saiu' };
  } catch (e) {
    if (semRosto(e)) return { tipo: 'sem-rosto' };
    if (!semColecao(e)) throw e;
  }
  // 2. A busca no álbum.
  /** @type {any} */
  let r;
  try {
    // QualityFilter NONE (v3.7.3): selfie escura ou tremida ainda procura.
    // Limiar mais baixo (v3.8.2): o que fica abaixo de ROSTO_LIMIAR vira "Talvez".
    r = await rekognition(cred, 'SearchFacesByImage', { CollectionId: c.principal, Image, MaxFaces: 4096, FaceMatchThreshold: ROSTO_LIMIAR_BUSCA, QualityFilter: 'NONE' }, opcoes);
  } catch (e) {
    if (semRosto(e)) return { tipo: 'sem-rosto' };
    if (semColecao(e)) return { tipo: 'sem-indice' };
    throw e;
  }
  const fora = new Set(ocultas);
  /** @type {Map<string, AchadoRosto>} */
  const porFoto = new Map();
  /** @param {any[]} matches @param {number} fator semelhança da semente (1 = busca direta) */
  const junta = (matches, fator) => {
    for (const m of matches) {
      const alvo = lerIdExterno(m && m.Face && m.Face.ExternalImageId);
      if (!alvo || fora.has(alvo.id)) continue;
      const sim = Math.round(Number(m.Similarity) * fator * 10) / 10;
      if (!(sim >= 0)) continue;
      const antes = porFoto.get(alvo.id);
      if (!antes || antes.sim < sim) porFoto.set(alvo.id, { cap: alvo.cap, id: alvo.id, sim });
    }
  };
  const diretos = Array.isArray(r.FaceMatches) ? r.FaceMatches : [];
  // Quem saiu (a marca está entre os parecidos): nada volta — nem as fotos
  // novas que o indexador ainda não limpou.
  if (confereSaida(diretos)) return { tipo: 'saiu' };
  junta(diretos, 1);
  // 3. As sementes: rostos com semelhança altíssima, de fotos diferentes, que
  // procuram os parecidos com eles. O que acham entra com a semelhança
  // multiplicada pela da semente (fica abaixo dos achados diretos).
  /** @type {{ id: string, sim: number }[]} */
  const sementes = [];
  const fotosSemente = new Set();
  for (const m of diretos) {
    const alvo = lerIdExterno(m && m.Face && m.Face.ExternalImageId);
    const faceId = m && m.Face && m.Face.FaceId;
    if (!alvo || fora.has(alvo.id) || fotosSemente.has(alvo.id) || typeof faceId !== 'string' || !(Number(m.Similarity) >= ROSTO_SEMENTE_MIN)) continue;
    fotosSemente.add(alvo.id);
    sementes.push({ id: faceId, sim: Number(m.Similarity) });
    if (sementes.length >= ROSTO_SEMENTES) break;
  }
  const extras = await Promise.all(sementes.map(s => rekognition(cred, 'SearchFaces', { CollectionId: c.principal, FaceId: s.id, MaxFaces: 4096, FaceMatchThreshold: ROSTO_LIMIAR_SEMENTE }, opcoes)
    .then(x => ({ x, fator: s.sim / 100 }), () => null)));
  for (const e of extras) if (e && Array.isArray(e.x.FaceMatches)) junta(e.x.FaceMatches, e.fator);
  const resultados = [...porFoto.values()].sort((a, b) => b.sim - a.sim).slice(0, ROSTO_MAX_RESULTADOS);
  // As sementes voltam ao aparelho (v3.8.3): são rostos do ÍNDICE DO ÁLBUM
  // (nunca a selfie) e servem para atualizar "minhas fotos" quando chegam
  // fotos novas, sem outra selfie (atualizaPorFaces).
  return { tipo: 'ok', resultados, faces: sementes.map(s => s.id) };
}

/** O formato do FaceId da Rekognition (UUID). */
const FACE_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/**
 * "Minhas fotos" atualizada sem selfie nova (v3.8.3): cada rosto guardado no
 * aparelho (até ROSTO_SEMENTES, vindos de uma busca anterior) procura os
 * parecidos no índice do álbum. Quem saiu da busca teve esses rostos apagados
 * do índice: a Rekognition não os acha e nada volta.
 * @param {import('./aws.js').CredAws} cred
 * @param {string} slug
 * @param {unknown} faces
 * @param {Iterable<string>} ocultas
 * @param {{ fetch?: typeof fetch }} [opcoes]
 * @returns {Promise<{ tipo: 'ok', resultados: AchadoRosto[] }>}
 */
export async function atualizaPorFaces(cred, slug, faces, ocultas, opcoes = {}) {
  const c = colecoes(slug);
  const ids = [...new Set((Array.isArray(faces) ? faces : []).filter(x => typeof x === 'string' && FACE_ID.test(x)))].slice(0, ROSTO_SEMENTES);
  const fora = new Set(ocultas);
  /** @type {Map<string, AchadoRosto>} */
  const porFoto = new Map();
  const respostas = await Promise.all(ids.map(FaceId => rekognition(cred, 'SearchFaces', { CollectionId: c.principal, FaceId, MaxFaces: 4096, FaceMatchThreshold: ROSTO_LIMIAR }, opcoes)
    .catch(e => { if (ehAcelerado(e)) throw e; return null; })));
  for (const r of respostas) {
    // O rosto guardado parece com o de alguém que saiu: ele não acha nada.
    if (r && confereSaida(r.FaceMatches)) continue;
    for (const m of (r && Array.isArray(r.FaceMatches) ? r.FaceMatches : [])) {
      const alvo = lerIdExterno(m && m.Face && m.Face.ExternalImageId);
      if (!alvo || fora.has(alvo.id)) continue;
      const sim = Math.round(Number(m.Similarity) * 10) / 10;
      if (!(sim >= 0)) continue;
      const antes = porFoto.get(alvo.id);
      if (!antes || antes.sim < sim) porFoto.set(alvo.id, { cap: alvo.cap, id: alvo.id, sim });
    }
  }
  return { tipo: 'ok', resultados: [...porFoto.values()].sort((a, b) => b.sim - a.sim).slice(0, ROSTO_MAX_RESULTADOS) };
}

/**
 * Apaga do índice os rostos parecidos com uma marca de quem saiu (nunca outra
 * marca). A régua é ROSTO_LIMIAR_SAIR, abaixo da mais baixa da busca: o que a
 * busca acharia, a saída apaga. Usada na hora da saída e pelo indexador,
 * depois de cada leva de fotos novas.
 * @param {(op: string, corpo: Record<string, unknown>) => Promise<any>} chama
 * @param {string} colecao
 * @param {string} marca FaceId da marca
 * @returns {Promise<number>} quantos rostos saíram
 */
export async function apagaParecidosComAMarca(chama, colecao, marca) {
  const r = await chama('SearchFaces', { CollectionId: colecao, FaceId: marca, MaxFaces: 4096, FaceMatchThreshold: ROSTO_LIMIAR_SAIR });
  const ids = [...new Set((Array.isArray(r.FaceMatches) ? r.FaceMatches : [])
    .filter((/** @type {any} */ m) => m && m.Face && !ehMarcaDeSaida(m.Face))
    .map((/** @type {any} */ m) => m.Face.FaceId)
    .filter((/** @type {unknown} */ id) => typeof id === 'string' && FACE_ID.test(id)))];
  for (let i = 0; i < ids.length; i += 4096) await chama('DeleteFaces', { CollectionId: colecao, FaceIds: ids.slice(i, i + 4096) });
  return ids.length;
}

/**
 * O indexador chama depois de indexar fotos novas: para cada marca de quem
 * saiu, apaga os rostos parecidos que acabaram de entrar. Uma chamada paga
 * por marca.
 * @param {(op: string, corpo: Record<string, unknown>) => Promise<any>} chama
 * @param {string} colecao
 * @param {string[]} marcas FaceIds
 * @returns {Promise<number>}
 */
export async function limpaRostosDeQuemSaiu(chama, colecao, marcas) {
  let n = 0;
  for (const m of marcas) n += await apagaParecidosComAMarca(chama, colecao, m);
  return n;
}

/**
 * "Não quero aparecer na busca": guarda o rosto como MARCA no índice do álbum
 * e apaga dele todo rosto parecido.
 * @param {import('./aws.js').CredAws} cred
 * @param {string} slug
 * @param {string} imagem base64
 * @param {{ fetch?: typeof fetch }} [opcoes]
 * @returns {Promise<{ tipo: 'ok', removidas: number, marca: string, repetida: boolean } | { tipo: 'sem-rosto' }>}
 */
export async function sairDaBusca(cred, slug, imagem, opcoes = {}) {
  const c = colecoes(slug);
  const Image = { Bytes: imagem };
  /** @param {string} op @param {Record<string, unknown>} corpo */
  const chama = (op, corpo) => rekognition(cred, op, corpo, opcoes);
  try {
    await chama('CreateCollection', { CollectionId: c.principal });
  } catch (e) {
    if (!(e instanceof ErroAws && e.tipo === 'ResourceAlreadyExistsException')) throw e;
  }
  // A mesma pessoa pedindo de novo não vira uma segunda marca: a que já existe
  // é reaproveitada (e os parecidos são limpos outra vez).
  /** @type {any} */
  let antes;
  try {
    antes = await chama('SearchFacesByImage', { CollectionId: c.principal, Image, MaxFaces: 4096, FaceMatchThreshold: ROSTO_LIMIAR, QualityFilter: 'NONE' });
  } catch (e) {
    if (semRosto(e)) return { tipo: 'sem-rosto' };
    throw e;
  }
  const jaTem = (Array.isArray(antes.FaceMatches) ? antes.FaceMatches : []).find((/** @type {any} */ m) => m && ehMarcaDeSaida(m.Face) && typeof m.Face.FaceId === 'string');
  let marca = jaTem ? String(jaTem.Face.FaceId) : '';
  if (!marca) {
    let guardado;
    try {
      // QualityFilter NONE: se há um rosto, ele vira marca (selfie escura também).
      guardado = await chama('IndexFaces', { CollectionId: c.principal, Image, ExternalImageId: MARCA_SAIU, MaxFaces: 1, QualityFilter: 'NONE', DetectionAttributes: [] });
    } catch (e) {
      if (semRosto(e)) return { tipo: 'sem-rosto' };
      throw e;
    }
    const face = Array.isArray(guardado.FaceRecords) && guardado.FaceRecords[0] && guardado.FaceRecords[0].Face;
    if (!face || typeof face.FaceId !== 'string') return { tipo: 'sem-rosto' };
    marca = face.FaceId;
  }
  const removidas = await apagaParecidosComAMarca(chama, c.principal, marca);
  return { tipo: 'ok', removidas, marca, repetida: !!jaTem };
}

/**
 * O dono desfaz uma saída (alguém tirou outra pessoa da busca): apaga a marca.
 * Os rostos que a saída apagou voltam quando o indexador refizer o índice
 * (quem chama pede isso: ver `pedeReindexacao`).
 * @param {import('./aws.js').CredAws} cred
 * @param {string} slug
 * @param {string} marca FaceId
 * @param {{ fetch?: typeof fetch }} [opcoes]
 */
export async function desfazSaida(cred, slug, marca, opcoes = {}) {
  if (!FACE_ID.test(marca)) return false;
  try {
    await rekognition(cred, 'DeleteFaces', { CollectionId: colecoes(slug).principal, FaceIds: [marca] }, opcoes);
  } catch (e) {
    if (!semColecao(e)) throw e;
  }
  return true;
}

/**
 * Apaga as duas coleções de um álbum (o índice de rostos e a de quem saiu):
 * projeto excluído, ou busca pelo rosto desligada. Coleção que não existe é
 * sucesso. Lança em qualquer outra falha (quem chama tenta de novo depois).
 * @param {import('./aws.js').CredAws} cred
 * @param {string} slug
 * @param {{ fetch?: typeof fetch }} [opcoes]
 */
export async function apagaColecoes(cred, slug, opcoes = {}) {
  const c = colecoes(slug);
  for (const CollectionId of [c.principal, c.sair]) {
    try {
      await rekognition(cred, 'DeleteCollection', { CollectionId }, opcoes);
    } catch (e) {
      if (!semColecao(e)) throw e;
    }
  }
}
