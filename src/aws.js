// Chamada à API da Amazon Rekognition (busca pelo rosto, v3.2). Só o
// necessário: assinatura SigV4 com WebCrypto (nenhuma dependência, funciona no
// Worker e no Node do indexador) e um POST JSON por operação.
//
// A chave da AWS NUNCA vai para a página: só o servidor (Worker) e o indexador
// (GitHub Actions) a usam. Ver docs/ROSTO.md.

const enc = new TextEncoder();

/** @param {ArrayBuffer} buf */
function hex(buf) {
  return [...new Uint8Array(buf)].map(b => b.toString(16).padStart(2, '0')).join('');
}

/** @param {string | Uint8Array} dado */
async function sha256Hex(dado) {
  return hex(await crypto.subtle.digest('SHA-256', typeof dado === 'string' ? enc.encode(dado) : dado));
}

/** @param {ArrayBuffer | Uint8Array} chave @param {string} texto */
async function hmac(chave, texto) {
  const k = await crypto.subtle.importKey('raw', chave, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return crypto.subtle.sign('HMAC', k, enc.encode(texto));
}

/**
 * Cabeçalhos assinados (SigV4) de uma requisição. Só o caso que usamos:
 * caminho sem caracteres especiais, query já ordenada (ou vazia).
 * @param {{
 *   metodo: string, host: string, caminho?: string, query?: string,
 *   cabecalhos?: Record<string, string>, corpo: string,
 *   regiao: string, servico: string, chave: string, segredo: string, token?: string,
 *   agora?: Date,
 * }} p
 * @returns {Promise<Record<string, string>>}
 */
export async function assinaV4(p) {
  const quando = (p.agora || new Date()).toISOString().replace(/[:-]|\.\d{3}/g, '');
  const dia = quando.slice(0, 8);
  /** @type {Record<string, string>} */
  const cab = { ...(p.cabecalhos || {}), host: p.host, 'x-amz-date': quando };
  if (p.token) cab['x-amz-security-token'] = p.token;
  const nomes = Object.keys(cab).map(k => k.toLowerCase()).sort();
  /** @type {Record<string, string>} */
  const baixos = {};
  for (const [k, v] of Object.entries(cab)) baixos[k.toLowerCase()] = String(v).trim().replace(/\s+/g, ' ');
  const canonicos = nomes.map(k => `${k}:${baixos[k]}\n`).join('');
  const assinados = nomes.join(';');
  const pedido = [p.metodo, p.caminho || '/', p.query || '', canonicos, assinados, await sha256Hex(p.corpo)].join('\n');
  const escopo = `${dia}/${p.regiao}/${p.servico}/aws4_request`;
  const paraAssinar = ['AWS4-HMAC-SHA256', quando, escopo, await sha256Hex(pedido)].join('\n');
  let k = await hmac(enc.encode('AWS4' + p.segredo), dia);
  k = await hmac(k, p.regiao);
  k = await hmac(k, p.servico);
  k = await hmac(k, 'aws4_request');
  const assinatura = hex(await hmac(k, paraAssinar));
  /** @type {Record<string, string>} */
  const saida = { ...(p.cabecalhos || {}), 'X-Amz-Date': quando, Authorization: `AWS4-HMAC-SHA256 Credential=${p.chave}/${escopo}, SignedHeaders=${assinados}, Signature=${assinatura}` };
  if (p.token) saida['X-Amz-Security-Token'] = p.token;
  return saida;
}

/** Erro da AWS com o tipo (`__type`) que ela devolve, sem a mensagem crua na página. */
export class ErroAws extends Error {
  /** @param {string} tipo @param {number} status @param {string} mensagem */
  constructor(tipo, status, mensagem) {
    super(`${tipo} (${status}): ${mensagem}`.slice(0, 300));
    this.name = 'ErroAws';
    this.tipo = tipo;
    this.status = status;
  }
}

/**
 * @typedef {{ chave: string, segredo: string, regiao: string, token?: string }} CredAws
 */

/**
 * Uma operação da Rekognition (JSON 1.1). Lança ErroAws com o tipo curto
 * (`InvalidParameterException`, `ThrottlingException`…).
 * @param {CredAws} cred
 * @param {string} operacao ex.: 'SearchFacesByImage'
 * @param {Record<string, unknown>} corpo
 * @param {{ fetch?: typeof fetch, agora?: Date }} [opcoes]
 * @returns {Promise<any>}
 */
export async function rekognition(cred, operacao, corpo, opcoes = {}) {
  const host = `rekognition.${cred.regiao}.amazonaws.com`;
  const json = JSON.stringify(corpo);
  const cabecalhos = await assinaV4({
    metodo: 'POST', host, corpo: json, regiao: cred.regiao, servico: 'rekognition',
    chave: cred.chave, segredo: cred.segredo, token: cred.token, agora: opcoes.agora,
    cabecalhos: { 'Content-Type': 'application/x-amz-json-1.1', 'X-Amz-Target': `RekognitionService.${operacao}` },
  });
  const res = await (opcoes.fetch || fetch)(`https://${host}/`, { method: 'POST', headers: cabecalhos, body: json });
  const texto = await res.text();
  /** @type {any} */
  let dado;
  try { dado = texto ? JSON.parse(texto) : {}; } catch { dado = null; }
  if (!res.ok) {
    const tipo = String((dado && (dado.__type || dado.code)) || `HTTP${res.status}`).split('#').pop() || 'Desconhecido';
    throw new ErroAws(tipo, res.status, String((dado && (dado.message || dado.Message)) || texto || '').slice(0, 200));
  }
  if (!dado) throw new ErroAws('RespostaInvalida', res.status, 'JSON ilegível');
  return dado;
}

/** Os bytes em base64 (o formato de `Image.Bytes` na API JSON). @param {Uint8Array} bytes */
export function base64(bytes) {
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode.apply(null, /** @type {any} */ (bytes.subarray(i, i + 0x8000)));
  return btoa(s);
}
