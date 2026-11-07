// Busca pelo rosto (v3.2) sobre a Amazon Rekognition. O índice de um álbum é
// uma COLEÇÃO da Rekognition (`fotos-<slug>`): cada rosto de cada foto vira um
// vetor lá, com o ExternalImageId `<capítulo>:<id do Drive>`. Quem preenche a
// coleção é o indexador (scripts/rosto-indexa.mjs, no GitHub Actions); o
// Worker só BUSCA e APAGA — a selfie nunca é guardada.
//
// "Não quero aparecer na busca": o rosto da pessoa vai para uma segunda
// coleção (`fotos-<slug>-sair`), com o consentimento dela e só para isso. Toda
// busca consulta essa coleção antes: se a selfie é de quem saiu, nada volta —
// nem as fotos novas que o indexador acrescentar depois.
//
// Ver docs/ROSTO.md (por que a Rekognition, custos, LGPD).

import { rekognition, ErroAws } from './aws.js';
import { ROSTO_REGIAO_PADRAO, ROSTO_LIMIAR, ROSTO_LIMIAR_SAIR, ROSTO_MAX_RESULTADOS, ROSTO_IMAGEM_MAX_B64, ROSTO_SEMENTES, ROSTO_SEMENTE_MIN, ROSTO_LIMIAR_SEMENTE } from './config.js';

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
 * @typedef {{ tipo: 'ok', resultados: AchadoRosto[] } | { tipo: 'sem-rosto' } | { tipo: 'saiu' } | { tipo: 'sem-indice' }} ResultadoBusca
 */

/**
 * Busca as fotos do álbum com o rosto da selfie. Lança ErroAws em falha da
 * AWS que não seja "sem rosto" nem "sem coleção" (quem chama decide 429/503).
 * @param {import('./aws.js').CredAws} cred
 * @param {string} slug
 * @param {string} imagem base64 (já conferida por imagemValida)
 * @param {Iterable<string>} ocultas IDs do Drive que o público não vê
 * @param {{ fetch?: typeof fetch, temSair?: boolean }} [opcoes] `temSair: false`
 *   pula a consulta a quem saiu (ninguém saiu ainda neste álbum: uma chamada a menos)
 * @returns {Promise<ResultadoBusca>}
 */
export async function buscaPorRosto(cred, slug, imagem, ocultas, opcoes = {}) {
  const c = colecoes(slug);
  const Image = { Bytes: imagem };
  // 1. Quem saiu da busca não é achado — nem nas fotos novas.
  if (opcoes.temSair !== false) try {
    const r = await rekognition(cred, 'SearchFacesByImage', { CollectionId: c.sair, Image, MaxFaces: 1, FaceMatchThreshold: ROSTO_LIMIAR }, opcoes);
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
    r = await rekognition(cred, 'SearchFacesByImage', { CollectionId: c.principal, Image, MaxFaces: 4096, FaceMatchThreshold: ROSTO_LIMIAR, QualityFilter: 'NONE' }, opcoes);
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
  return { tipo: 'ok', resultados };
}

/**
 * "Não quero aparecer na busca": guarda o rosto na coleção de quem saiu e
 * apaga do índice do álbum todo rosto parecido.
 * @param {import('./aws.js').CredAws} cred
 * @param {string} slug
 * @param {string} imagem base64
 * @param {{ fetch?: typeof fetch }} [opcoes]
 * @returns {Promise<{ tipo: 'ok', removidas: number } | { tipo: 'sem-rosto' }>}
 */
export async function sairDaBusca(cred, slug, imagem, opcoes = {}) {
  const c = colecoes(slug);
  const Image = { Bytes: imagem };
  try {
    await rekognition(cred, 'CreateCollection', { CollectionId: c.sair }, opcoes);
  } catch (e) {
    if (!(e instanceof ErroAws && e.tipo === 'ResourceAlreadyExistsException')) throw e;
  }
  let guardado;
  try {
    guardado = await rekognition(cred, 'IndexFaces', { CollectionId: c.sair, Image, ExternalImageId: 'saiu', MaxFaces: 1, QualityFilter: 'AUTO', DetectionAttributes: [] }, opcoes);
  } catch (e) {
    if (semRosto(e)) return { tipo: 'sem-rosto' };
    throw e;
  }
  if (!Array.isArray(guardado.FaceRecords) || !guardado.FaceRecords.length) return { tipo: 'sem-rosto' };
  /** @type {any} */
  let achados;
  try {
    achados = await rekognition(cred, 'SearchFacesByImage', { CollectionId: c.principal, Image, MaxFaces: 4096, FaceMatchThreshold: ROSTO_LIMIAR_SAIR, QualityFilter: 'NONE' }, opcoes);
  } catch (e) {
    if (semColecao(e) || semRosto(e)) return { tipo: 'ok', removidas: 0 };
    throw e;
  }
  const ids = [...new Set((Array.isArray(achados.FaceMatches) ? achados.FaceMatches : [])
    .map((/** @type {any} */ m) => m && m.Face && m.Face.FaceId)
    .filter((/** @type {unknown} */ id) => typeof id === 'string' && /^[0-9a-f-]{36}$/.test(id)))];
  if (!ids.length) return { tipo: 'ok', removidas: 0 };
  const apagou = await rekognition(cred, 'DeleteFaces', { CollectionId: c.principal, FaceIds: ids }, opcoes);
  return { tipo: 'ok', removidas: Array.isArray(apagou.DeletedFaces) ? apagou.DeletedFaces.length : ids.length };
}
