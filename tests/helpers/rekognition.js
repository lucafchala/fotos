// Uma Rekognition de mentira, em memória, para os testes da busca pelo rosto.
//
// Os testes antigos respondiam cada operação com um JSON pronto: provavam que
// o código chamava a AWS na ordem esperada, não que a REGRA valia ("quem saiu
// não é achado nas fotos novas"). Aqui há coleções de verdade: indexar guarda
// um rosto, buscar compara, apagar apaga — e dá para perguntar, no fim, o que
// ficou no índice.
//
// O "rosto" é o nome de uma pessoa. Uma imagem é uma lista de pessoas (a
// primeira é o maior rosto, o único que a busca por imagem olha — como na
// Rekognition de verdade). A semelhança entre duas pessoas: 99,5 para a mesma,
// o que `parecidos` disser para um par, 0 para o resto.
import { Buffer } from 'node:buffer';

/**
 * @param {{ parecidos?: Record<string, number>, regiao?: string }} [o]
 *   `parecidos`: `{ 'ana|bia': 72 }` (a ordem dos nomes não importa)
 */
export function rekognitionFalsa(o = {}) {
  /** @type {Map<string, { FaceId: string, ExternalImageId: string, pessoa: string }[]>} */
  const colecoes = new Map();
  /** @type {Map<string, string[]>} */
  const imagens = new Map();
  /** @type {{ op: string, corpo: any }[]} */
  const chamadas = [];
  /** @type {Record<string, (corpo: any) => Response | null | undefined>} */
  const falhas = {};
  let n = 0;
  const novoId = () => { n++; return `${String(n).padStart(8, '0')}-aaaa-bbbb-cccc-${String(n).padStart(12, '0')}`; };
  const erro = (/** @type {string} */ tipo, status = 400) => new Response(JSON.stringify({ __type: tipo, message: tipo }), { status });
  /** @param {string} a @param {string} b */
  const semelhanca = (a, b) => (a === b ? 99.5 : Number((o.parecidos || {})[`${a}|${b}`] ?? (o.parecidos || {})[`${b}|${a}`] ?? 0));
  /** @param {string} colecao @param {string} pessoa @param {number} limiar @param {string} [menos] */
  const parecidos = (colecao, pessoa, limiar, menos) => (colecoes.get(colecao) || [])
    .filter(f => f.FaceId !== menos)
    .map(f => ({ Similarity: semelhanca(pessoa, f.pessoa), Face: { FaceId: f.FaceId, ExternalImageId: f.ExternalImageId } }))
    .filter(m => m.Similarity >= limiar)
    .sort((a, b) => b.Similarity - a.Similarity);

  /** @param {string} op @param {any} corpo @returns {Response} */
  function responde(op, corpo) {
    chamadas.push({ op, corpo });
    const forcada = falhas[op] && falhas[op](corpo);
    if (forcada) return forcada;
    const col = String(corpo.CollectionId || '');
    if (op === 'CreateCollection') {
      if (colecoes.has(col)) return erro('ResourceAlreadyExistsException');
      colecoes.set(col, []);
      return Response.json({ StatusCode: 200 });
    }
    if (op === 'DeleteCollection') {
      if (!colecoes.has(col)) return erro('ResourceNotFoundException');
      colecoes.delete(col);
      return Response.json({ StatusCode: 200 });
    }
    if (op === 'DetectText' || op === 'DetectLabels' || op === 'DetectModerationLabels') return Response.json({});
    const faces = colecoes.get(col);
    if (!faces) return erro('ResourceNotFoundException');
    if (op === 'ListFaces') return Response.json({ Faces: faces.map(f => ({ FaceId: f.FaceId, ExternalImageId: f.ExternalImageId })) });
    if (op === 'IndexFaces') {
      const pessoas = (imagens.get(String(corpo.Image && corpo.Image.Bytes)) || []).slice(0, Number(corpo.MaxFaces) || 100);
      const novas = pessoas.map(pessoa => ({ FaceId: novoId(), ExternalImageId: String(corpo.ExternalImageId), pessoa }));
      faces.push(...novas);
      return Response.json({ FaceRecords: novas.map(f => ({ Face: { FaceId: f.FaceId, ExternalImageId: f.ExternalImageId } })) });
    }
    if (op === 'SearchFacesByImage') {
      const pessoas = imagens.get(String(corpo.Image && corpo.Image.Bytes)) || [];
      if (!pessoas.length) return erro('InvalidParameterException');
      return Response.json({ FaceMatches: parecidos(col, pessoas[0], Number(corpo.FaceMatchThreshold) || 80).slice(0, Number(corpo.MaxFaces) || 80) });
    }
    if (op === 'SearchFaces') {
      const de = faces.find(f => f.FaceId === corpo.FaceId);
      if (!de) return erro('InvalidParameterException');
      return Response.json({ FaceMatches: parecidos(col, de.pessoa, Number(corpo.FaceMatchThreshold) || 80, de.FaceId).slice(0, Number(corpo.MaxFaces) || 80) });
    }
    if (op === 'DeleteFaces') {
      const fora = new Set(corpo.FaceIds || []);
      const antes = faces.length;
      colecoes.set(col, faces.filter(f => !fora.has(f.FaceId)));
      return Response.json({ DeletedFaces: [...fora].slice(0, antes) });
    }
    return Response.json({});
  }

  return {
    chamadas,
    /** Diz quem está numa imagem (base64, como a Rekognition recebe). @param {string} b64 @param {string[]} pessoas */
    imagem(b64, pessoas) { imagens.set(b64, pessoas); return b64; },
    /** Diz quem está numa foto cujos BYTES são este texto (o lh3 de mentira). @param {string} bytes @param {string[]} pessoas */
    imagemDeBytes(bytes, pessoas) { imagens.set(Buffer.from(bytes).toString('base64'), pessoas); },
    /** Põe rostos direto numa coleção (o que o indexador já fez). @param {string} colecao @param {string} ext @param {string[]} pessoas */
    semeia(colecao, ext, pessoas) {
      if (!colecoes.has(colecao)) colecoes.set(colecao, []);
      const novas = pessoas.map(pessoa => ({ FaceId: novoId(), ExternalImageId: ext, pessoa }));
      /** @type {any[]} */ (colecoes.get(colecao)).push(...novas);
      return novas.map(f => f.FaceId);
    },
    /** O que há numa coleção: `[{ ext, pessoa }]`, ou null se ela não existe. @param {string} colecao */
    rostos(colecao) {
      const f = colecoes.get(colecao);
      return f ? f.map(x => ({ ext: x.ExternalImageId, pessoa: x.pessoa, id: x.FaceId })) : null;
    },
    /** Faz uma operação falhar (devolva uma Response) enquanto estiver posta. @param {string} op @param {(corpo: any) => Response | null | undefined} f */
    falha(op, f) { falhas[op] = f; },
    semFalhas() { for (const k of Object.keys(falhas)) delete falhas[k]; },
    erro,
    ops: (/** @type {string} */ op) => chamadas.filter(c => c.op === op),
    /**
     * Para pôr dentro de um `fetch` de mentira: responde se o pedido é para a
     * Rekognition, senão devolve null.
     * @param {any} input @param {any} [init]
     * @returns {Response | null}
     */
    atende(input, init = {}) {
      const url = new URL(typeof input === 'string' ? input : input.url);
      if (!url.host.startsWith('rekognition.')) return null;
      return responde(String(init.headers['X-Amz-Target']).split('.')[1], JSON.parse(init.body));
    },
  };
}
