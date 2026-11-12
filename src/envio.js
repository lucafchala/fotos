// Envio de fotos pelo site (v3.9): o arquivo sai do celular e termina na
// pasta de envio do evento, no Google Drive. O Drive continua sendo a fonte
// da verdade — a galeria, o indexador de rostos e os créditos leem a pasta
// como sempre leram. Este módulo é só o caminho de IDA.
//
// Como o arquivo viaja:
//   celular --(partes, PUT)--> Worker --(envio retomável da Drive API)--> Drive
//
// 1. A página pede `POST /api/envio/inicia`. O servidor abre uma SESSÃO de
//    envio retomável no Google (com a credencial OAuth do dono, abaixo) e
//    devolve essa sessão SELADA (AES-GCM com uma chave derivada do
//    SIGNING_SECRET). O endereço da sessão é uma credencial — quem o tem
//    grava aquele arquivo no Drive — e por isso nunca vai em claro à página.
// 2. A página manda o arquivo em partes (`PUT /api/envio/parte`), cada uma com
//    o selo. O Worker abre o selo e repassa a parte ao Google. O Google diz
//    até onde recebeu; é ESSA posição que vale, nunca a que a página acha.
// 3. Caiu a rede, o celular dormiu, a página foi fechada: a sessão continua
//    viva no Google por uma semana. A página pergunta (`/api/envio/estado`)
//    onde parou e segue dali.
//
// Sem estado no servidor: nenhuma escrita de KV, nenhum Durable Object novo
// (migração de DO não sobe por `versions upload`, RETOMADA §5.3-b). O selo é o
// estado, e mora no aparelho de quem envia.
//
// Por que passa pelo Worker, e não direto do celular para o Google: direto
// exigiria entregar o endereço da sessão à página (com ele, a página gravaria
// no Drive sem passar por nenhuma conferência nossa) e dependeria de o Google
// responder CORS para a nossa origem — coisa que não dá para testar daqui. Pelo
// Worker, cada parte é conferida (tamanho, alinhamento, os primeiros bytes) e
// a página só fala com a própria origem (a CSP não muda).
//
// Por que OAuth, e não a chave de API da galeria: chave de API só LÊ pasta
// pública. Gravar exige agir em nome de uma conta. Conta de serviço não serve
// numa conta pessoal (ela não tem espaço próprio no Drive; o Google recusa o
// envio com `storageQuotaExceeded`), então é o token de atualização (refresh
// token) de uma conta de verdade: `GOOGLE_OAUTH_CLIENT_ID`,
// `GOOGLE_OAUTH_CLIENT_SECRET` e `GOOGLE_OAUTH_REFRESH_TOKEN`. Os arquivos
// ficam em nome dessa conta e ocupam o espaço DELA. Passo a passo e os riscos
// em docs/ENVIO.md.
//
// "Não duplicar" mora no Drive também: cada arquivo enviado leva em
// `appProperties` a impressão digital do conteúdo (`fp`), e antes de abrir uma
// sessão o servidor pergunta à pasta se já existe um arquivo com ela. Vale
// entre aparelhos e entre pessoas, sem banco paralelo.

import { noteDegraded, errMessage } from './utils.js';
import {
  ENVIO_TIPOS, ENVIO_ASSINATURA_MIN, ENVIO_ASSINATURA_MAX, ENVIO_SESSAO_TTL_SECS,
  ENVIO_MARGEM_DRIVE_BYTES, ENVIO_AVISO_DRIVE_BYTES, SIGNING_SECRET_MIN_LENGTH,
} from './config.js';

const TOKEN_URL = 'https://oauth2.googleapis.com/token';
const UPLOAD_URL = 'https://www.googleapis.com/upload/drive/v3/files';
const FILES_URL = 'https://www.googleapis.com/drive/v3/files';
const ABOUT_URL = 'https://www.googleapis.com/drive/v3/about';
// O mesmo formato de drive.js (o ID entra numa consulta `q` entre apóstrofos).
const ID_RE = /^[A-Za-z0-9_-]{10,200}$/;
const RK_RE = /^[A-Za-z0-9_-]{1,200}$/;
const FP_RE = /^[a-f0-9]{32}$/;
const NOME_MAX = 200;

/**
 * Erro com código estável: o handler decide o status e o texto por ele, nunca
 * pela mensagem do Google (que não vai à página).
 */
export class EnvioError extends Error {
  /**
   * @param {'desligado'|'credencial'|'pasta'|'cheio'|'sessao'|'desalinhado'|'ocupado'|'google'} codigo
   * @param {string} mensagem
   */
  constructor(codigo, mensagem) {
    super(mensagem);
    this.name = 'EnvioError';
    this.codigo = codigo;
  }
}

// ---------------------------------------------------------------------------
// Credencial (OAuth) e token de acesso
// ---------------------------------------------------------------------------

/**
 * As três peças da credencial, aparadas; null se faltar qualquer uma.
 * @param {{ GOOGLE_OAUTH_CLIENT_ID?: string, GOOGLE_OAUTH_CLIENT_SECRET?: string, GOOGLE_OAUTH_REFRESH_TOKEN?: string }} env
 */
function credencial(env) {
  const id = String(env.GOOGLE_OAUTH_CLIENT_ID || '').trim();
  const segredo = String(env.GOOGLE_OAUTH_CLIENT_SECRET || '').trim();
  const refresh = String(env.GOOGLE_OAUTH_REFRESH_TOKEN || '').trim();
  return id && segredo && refresh ? { id, segredo, refresh } : null;
}

/**
 * O envio pelo site está LIGADO neste Worker? As três peças da credencial e o
 * SIGNING_SECRET (o selo da sessão e o passe dependem dele: sem ele o envio
 * fica desligado, não aberto — ao contrário do resto do site, RETOMADA §5.4,
 * porque aqui o que estaria sem proteção é a escrita no Drive do dono).
 * @param {Record<string, any>} env
 */
export function envioLigado(env) {
  const s = typeof env.SIGNING_SECRET === 'string' ? env.SIGNING_SECRET.trim() : '';
  return !!credencial(env) && s.length >= SIGNING_SECRET_MIN_LENGTH;
}

/** @type {Map<string, { token?: string, ate: number, erro?: EnvioError, voo?: Promise<string> }>} */
const tokens = new Map();
// Uma recusa do Google fica guardada este tempo: sem isto, cada foto de cada
// pessoa repetiria o pedido de token com a credencial já sabidamente ruim.
const TOKEN_ERRO_MS = 60_000;

/** Só para os testes: esquece tokens, espaço e saúde guardados no isolate. */
export function limpaCacheEnvioSite() {
  tokens.clear();
  espacos.clear();
  chaves.clear();
}

/**
 * Token de acesso (vale ~1 h; guardado na memória do isolate até 5 min antes
 * de vencer). Nunca vai a log, a erro nem à página.
 * @param {Record<string, any>} env
 * @param {{ novo?: boolean }} [o] `novo`: o Google recusou o guardado (401)
 * @returns {Promise<string>}
 */
export async function tokenDeAcesso(env, { novo = false } = {}) {
  const c = credencial(env);
  if (!c) throw new EnvioError('desligado', 'O envio pelo site não está configurado.');
  const k = `${c.id}|${c.refresh}`;
  const agora = Date.now();
  const tem = tokens.get(k);
  if (tem && !novo) {
    if (tem.token && agora < tem.ate) return tem.token;
    if (tem.erro && agora < tem.ate) throw tem.erro;
    if (tem.voo) return tem.voo;
  }
  const voo = (async () => {
    /** @type {Response} */
    let res;
    try {
      res = await fetch(TOKEN_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' },
        body: new URLSearchParams({ client_id: c.id, client_secret: c.segredo, refresh_token: c.refresh, grant_type: 'refresh_token' }),
        signal: AbortSignal.timeout(8000),
      });
    } catch (e) {
      // Rede: não é a credencial que está ruim. Não fica guardado.
      tokens.delete(k);
      throw new EnvioError('google', `o Google não respondeu ao pedido de token (${errMessage(e).slice(0, 80)})`);
    }
    /** @type {any} */
    let corpo = null;
    try { corpo = await res.json(); } catch { /* corpo que não é JSON */ }
    if (res.ok && corpo && typeof corpo.access_token === 'string' && corpo.access_token) {
      const vale = Number(corpo.expires_in) > 0 ? Number(corpo.expires_in) : 3600;
      tokens.set(k, { token: corpo.access_token, ate: Date.now() + Math.max(60, vale - 300) * 1000 });
      return corpo.access_token;
    }
    if (res.status >= 500 || res.status === 429) {
      tokens.delete(k);
      throw new EnvioError('google', `o Google respondeu ${res.status} ao pedido de token`);
    }
    // 400/401: a credencial foi recusada. `invalid_grant` é o token de
    // atualização vencido ou revogado — o caso clássico é o app do Google
    // Cloud ainda em "Testing", em que ele vence em 7 dias (docs/ENVIO.md).
    const motivo = corpo && typeof corpo.error === 'string' ? corpo.error.replace(/[^a-z_]/gi, '').slice(0, 40) : `http ${res.status}`;
    const erro = new EnvioError('credencial', `o Google recusou a credencial do envio (${motivo})`);
    tokens.set(k, { erro, ate: Date.now() + TOKEN_ERRO_MS });
    noteDegraded('envio de fotos: o Google recusou a credencial', `${motivo} — as fotos enviadas pelo site NÃO estão chegando ao Drive; refaça o token (docs/ENVIO.md)`);
    throw erro;
  })();
  tokens.set(k, { voo, ate: 0 });
  return voo;
}

/**
 * Uma chamada autenticada à API. Num 401 (token guardado que o Google já não
 * aceita) pede um token novo e tenta UMA vez mais.
 * @param {Record<string, any>} env
 * @param {string} url
 * @param {RequestInit} init
 * @param {number} [timeoutMs]
 */
async function chama(env, url, init, timeoutMs = 15000) {
  /** @param {string} token */
  const vai = token => fetch(url, {
    ...init,
    headers: { ...(/** @type {Record<string, string>} */ (init.headers || {})), Authorization: `Bearer ${token}` },
    signal: AbortSignal.timeout(timeoutMs),
  });
  let res;
  try {
    res = await vai(await tokenDeAcesso(env));
    if (res.status === 401) res = await vai(await tokenDeAcesso(env, { novo: true }));
  } catch (e) {
    if (e instanceof EnvioError) throw e;
    throw new EnvioError('google', `o Google Drive não respondeu a tempo (${errMessage(e).slice(0, 80)})`);
  }
  return res;
}

/**
 * Traduz um erro da Drive API num código nosso. O texto do Google fica no log
 * (sem nome de arquivo nem de pasta), nunca na resposta.
 * @param {Response} res
 * @param {string} onde
 * @returns {Promise<EnvioError>}
 */
async function erroDoGoogle(res, onde) {
  /** @type {any} */
  let corpo = null;
  try { corpo = await res.json(); } catch { /* corpo que não é JSON */ }
  const err = corpo && corpo.error && typeof corpo.error === 'object' ? corpo.error : {};
  const razoes = (Array.isArray(err.errors) ? err.errors : []).map((/** @type {any} */ e) => String(e && e.reason || '')).filter(Boolean);
  const tem = (/** @type {string} */ r) => razoes.includes(r);
  const resumo = `${onde}: http ${res.status}${razoes.length ? ` (${razoes.join(', ').slice(0, 80)})` : ''}`;
  if (tem('storageQuotaExceeded') || tem('teamDriveFileLimitExceeded') || tem('quotaExceeded')) {
    noteDegraded('envio de fotos: o Drive está cheio', 'o Google recusou o arquivo por falta de espaço na conta do envio');
    return new EnvioError('cheio', resumo);
  }
  if (res.status === 401) return new EnvioError('credencial', resumo);
  if (res.status === 429 || tem('rateLimitExceeded') || tem('userRateLimitExceeded') || tem('dailyLimitExceeded')) return new EnvioError('ocupado', resumo);
  if (res.status === 404 || res.status === 403) {
    // A conta do envio não enxerga a pasta, ou não pode gravar nela: é
    // configuração (escopo do token, compartilhamento da pasta), não azar.
    noteDegraded('envio de fotos: o Drive recusou a pasta de envio', `${resumo} — confira o escopo do token e se a pasta está como Editor (docs/ENVIO.md)`);
    return new EnvioError('pasta', resumo);
  }
  return new EnvioError('google', resumo);
}

// ---------------------------------------------------------------------------
// Sessão de envio retomável
// ---------------------------------------------------------------------------

/**
 * O endereço de sessão que o Google devolve tem de ser dele: é para lá que as
 * partes do arquivo vão. Host comparado com new URL(), nunca por texto
 * (RETOMADA §5.6).
 * @param {unknown} uri
 */
export function sessaoDoGoogle(uri) {
  if (typeof uri !== 'string' || uri.length > 2000) return false;
  let u;
  try { u = new URL(uri); } catch { return false; }
  return u.protocol === 'https:' && u.host === 'www.googleapis.com' && u.pathname.startsWith('/upload/drive/') && u.searchParams.has('upload_id');
}

/**
 * Abre a sessão de envio de UM arquivo na pasta de envio.
 * @param {Record<string, any>} env
 * @param {{ pasta: string, rk?: string, nome: string, mime: string, tamanho: number, descricao?: string, modificado?: string, fp: string }} a
 * @returns {Promise<string>} o endereço da sessão (segredo: selar antes de sair do servidor)
 */
export async function criaSessao(env, a) {
  if (!ID_RE.test(a.pasta) || !FP_RE.test(a.fp)) throw new EnvioError('pasta', 'pasta ou impressão digital inválida');
  /** @type {Record<string, any>} */
  const meta = { name: a.nome, parents: [a.pasta], appProperties: { envio: '1', fp: a.fp } };
  if (a.descricao) meta.description = a.descricao;
  if (a.modificado) meta.modifiedTime = a.modificado;
  /** @type {Record<string, string>} */
  const headers = {
    'Content-Type': 'application/json; charset=UTF-8',
    'X-Upload-Content-Type': a.mime,
    'X-Upload-Content-Length': String(a.tamanho),
  };
  if (a.rk && RK_RE.test(a.rk)) headers['X-Goog-Drive-Resource-Keys'] = `${a.pasta}/${a.rk}`;
  const res = await chama(env, `${UPLOAD_URL}?uploadType=resumable&supportsAllDrives=true&fields=id`, { method: 'POST', headers, body: JSON.stringify(meta) });
  if (!res.ok) throw await erroDoGoogle(res, 'abrir a sessão');
  const uri = res.headers.get('Location');
  if (!sessaoDoGoogle(uri)) throw new EnvioError('google', 'abrir a sessão: o Google não devolveu um endereço de sessão válido');
  return /** @type {string} */ (uri);
}

/**
 * O que o Google respondeu sobre a sessão: terminou, ou até onde recebeu.
 * @param {Response} res
 * @param {string} onde
 * @returns {Promise<{ feito: true, id: string } | { feito: false, pos: number }>}
 */
async function interpreta(res, onde) {
  if (res.status === 200 || res.status === 201) {
    /** @type {any} */
    let corpo = null;
    try { corpo = await res.json(); } catch { /* sem corpo: terminou do mesmo jeito */ }
    return { feito: true, id: corpo && typeof corpo.id === 'string' ? corpo.id : '' };
  }
  if (res.status === 308) {
    // "Resume Incomplete": `Range: bytes=0-N` diz o último byte guardado. Sem
    // o cabeçalho, nada foi guardado ainda.
    const m = /^bytes=0-(\d+)$/.exec(res.headers.get('Range') || '');
    try { await res.body?.cancel(); } catch { /* sem corpo */ }
    return { feito: false, pos: m ? Number(m[1]) + 1 : 0 };
  }
  // 404/410: a sessão não existe mais (venceu, foi cancelada, ou o arquivo
  // já foi concluído e a sessão recolhida).
  if (res.status === 404 || res.status === 410) { try { await res.body?.cancel(); } catch { /* sem corpo */ } throw new EnvioError('sessao', `${onde}: sessão encerrada (http ${res.status})`); }
  // 400/416: a parte não começa onde o Google parou.
  if (res.status === 400 || res.status === 416) { try { await res.body?.cancel(); } catch { /* sem corpo */ } throw new EnvioError('desalinhado', `${onde}: parte fora de posição (http ${res.status})`); }
  if (res.status >= 500) { try { await res.body?.cancel(); } catch { /* sem corpo */ } throw new EnvioError('ocupado', `${onde}: http ${res.status}`); }
  throw await erroDoGoogle(res, onde);
}

/**
 * Manda uma parte. A autorização é o próprio endereço da sessão.
 * @param {string} uri
 * @param {ArrayBuffer | Uint8Array} bytes
 * @param {number} inicio
 * @param {number} total
 */
export async function enviaParte(uri, bytes, inicio, total) {
  const n = bytes.byteLength;
  let res;
  try {
    res = await fetch(uri, {
      method: 'PUT',
      headers: { 'Content-Range': `bytes ${inicio}-${inicio + n - 1}/${total}` },
      body: bytes,
      signal: AbortSignal.timeout(120_000),
    });
  } catch (e) {
    throw new EnvioError('ocupado', `mandar a parte: o Google não respondeu (${errMessage(e).slice(0, 80)})`);
  }
  return interpreta(res, 'mandar a parte');
}

/**
 * Pergunta ao Google até onde ele recebeu.
 * @param {string} uri
 * @param {number} total
 */
export async function consultaSessao(uri, total) {
  let res;
  try {
    res = await fetch(uri, { method: 'PUT', headers: { 'Content-Range': `bytes */${total}`, 'Content-Length': '0' }, signal: AbortSignal.timeout(15_000) });
  } catch (e) {
    throw new EnvioError('ocupado', `consultar a sessão: o Google não respondeu (${errMessage(e).slice(0, 80)})`);
  }
  return interpreta(res, 'consultar a sessão');
}

/** Desiste de uma sessão (arquivo recusado pela conferência dos bytes). Nunca lança. @param {string} uri */
export async function cancelaSessao(uri) {
  try {
    const res = await fetch(uri, { method: 'DELETE', headers: { 'Content-Length': '0' }, signal: AbortSignal.timeout(8000) });
    await res.body?.cancel();
  } catch { /* a sessão vence sozinha em uma semana */ }
}

/**
 * Já existe nesta pasta um arquivo com esta impressão digital? Devolve o ID
 * dele, ou ''. Se a pergunta falhar, responde '' (melhor uma foto repetida do
 * que uma foto recusada): quem conserta credencial ou pasta ruim é a abertura
 * da sessão, logo em seguida, com o erro certo.
 * @param {Record<string, any>} env
 * @param {string} pasta
 * @param {string} rk
 * @param {string} fp
 */
export async function procuraDuplicata(env, pasta, rk, fp) {
  if (!ID_RE.test(pasta) || !FP_RE.test(fp)) return '';
  const params = new URLSearchParams({
    q: `'${pasta}' in parents and trashed = false and appProperties has { key='fp' and value='${fp}' }`,
    fields: 'files(id)',
    pageSize: '1',
    supportsAllDrives: 'true',
    includeItemsFromAllDrives: 'true',
  });
  /** @type {Record<string, string>} */
  const headers = { Accept: 'application/json' };
  if (rk && RK_RE.test(rk)) headers['X-Goog-Drive-Resource-Keys'] = `${pasta}/${rk}`;
  try {
    const res = await chama(env, `${FILES_URL}?${params}`, { headers }, 8000);
    if (!res.ok) { await res.body?.cancel(); return ''; }
    const corpo = /** @type {any} */ (await res.json());
    const f = corpo && Array.isArray(corpo.files) ? corpo.files[0] : null;
    return f && typeof f.id === 'string' ? f.id : '';
  } catch (e) {
    if (e instanceof EnvioError && (e.codigo === 'credencial' || e.codigo === 'desligado')) throw e;
    return '';
  }
}

/** @type {Map<string, { ate: number, livre: number | null }>} */
const espacos = new Map();
const ESPACO_TTL_MS = 5 * 60_000;

/**
 * O espaço livre na conta do envio, em bytes; `null` = sem limite conhecido
 * (conta sem teto, ou o Google não disse). Guardado 5 min no isolate.
 * @param {Record<string, any>} env
 * @returns {Promise<number | null>}
 */
export async function espacoNoDrive(env) {
  const c = credencial(env);
  if (!c) throw new EnvioError('desligado', 'O envio pelo site não está configurado.');
  const k = `${c.id}|${c.refresh}`;
  const tem = espacos.get(k);
  if (tem && Date.now() < tem.ate) return tem.livre;
  const res = await chama(env, `${ABOUT_URL}?fields=storageQuota`, { headers: { Accept: 'application/json' } }, 8000);
  if (!res.ok) throw await erroDoGoogle(res, 'ler o espaço do Drive');
  const corpo = /** @type {any} */ (await res.json());
  const q = corpo && corpo.storageQuota && typeof corpo.storageQuota === 'object' ? corpo.storageQuota : {};
  const limite = Number(q.limit), uso = Number(q.usage);
  const livre = Number.isFinite(limite) && limite > 0 && Number.isFinite(uso) ? Math.max(0, limite - uso) : null;
  espacos.set(k, { ate: Date.now() + ESPACO_TTL_MS, livre });
  return livre;
}

/**
 * Cabe um arquivo deste tamanho, deixando a margem (ENVIO_MARGEM_DRIVE_BYTES)?
 * Se não der para saber (o Google não respondeu), deixa passar: quem recusa de
 * verdade é o próprio Drive, na abertura da sessão.
 * @param {Record<string, any>} env
 * @param {number} tamanho
 */
export async function cabeNoDrive(env, tamanho) {
  let livre;
  try { livre = await espacoNoDrive(env); } catch (e) { if (e instanceof EnvioError && e.codigo === 'credencial') throw e; return true; }
  return livre === null || livre - tamanho >= ENVIO_MARGEM_DRIVE_BYTES;
}

/**
 * O estado do envio para o /api/healthz: a credencial funciona DE VERDADE (um
 * token novo foi emitido) e quanto espaço há. Roda no healthz e não só quando
 * alguém envia porque o defeito típico é silencioso: o token de atualização
 * vence, o site segue no ar, e as fotos da turma param de chegar.
 * @param {Record<string, any>} env
 *  - `desligado`: sem credencial (o álbum segue mandando pela pasta do Drive);
 *  - `ok`: o Google emitiu um token agora (ou há um válido guardado);
 *  - `falha`: o Google RECUSOU a credencial, falta o SIGNING_SECRET, ou o
 *    Drive está cheio — o envio não funciona, e vai para `problemas`;
 *  - `incerto`: o Google não respondeu a tempo. Não é "ok" e não é defeito
 *    nosso: fica dito, sem entrar em `problemas`.
 * @returns {Promise<{ estado: 'desligado' | 'ok' | 'falha' | 'incerto', livreGb: number | null, problemas: string[] }>}
 */
export async function saudeDoEnvio(env) {
  if (!credencial(env)) return { estado: 'desligado', livreGb: null, problemas: [] };
  if (!envioLigado(env)) {
    return { estado: 'falha', livreGb: null, problemas: ['envio de fotos: credencial do Google presente, mas sem SIGNING_SECRET válido — o envio pelo site fica DESLIGADO'] };
  }
  try {
    await tokenDeAcesso(env);
  } catch (e) {
    const cod = e instanceof EnvioError ? e.codigo : 'google';
    // Rede ou 5xx do Google: não sabemos — e desconhecido não é "ok".
    if (cod !== 'credencial') return { estado: 'incerto', livreGb: null, problemas: [] };
    return {
      estado: 'falha', livreGb: null,
      problemas: ['envio de fotos: o Google recusou a credencial — as fotos enviadas pelo site NÃO chegam ao Drive (refaça o token: docs/ENVIO.md)'],
    };
  }
  /** @type {number | null} */
  let livre;
  try { livre = await espacoNoDrive(env); } catch { return { estado: 'ok', livreGb: null, problemas: [] }; }
  const livreGb = livre === null ? null : Math.round(livre / 1024 ** 3 * 10) / 10;
  /** @type {string[]} */
  const problemas = [];
  if (livre !== null && livre < ENVIO_MARGEM_DRIVE_BYTES) problemas.push(`envio de fotos: o Drive do envio está cheio (${livreGb} GB livres) — o site está RECUSANDO fotos novas`);
  else if (livre !== null && livre < ENVIO_AVISO_DRIVE_BYTES) problemas.push(`envio de fotos: o Drive do envio está acabando (${livreGb} GB livres)`);
  return { estado: livre !== null && livre < ENVIO_MARGEM_DRIVE_BYTES ? 'falha' : 'ok', livreGb, problemas };
}

// ---------------------------------------------------------------------------
// O selo da sessão (AES-GCM, sem estado no servidor)
// ---------------------------------------------------------------------------

/** @type {Map<string, Promise<CryptoKey>>} */
const chaves = new Map();
/** @param {string} secret */
function chaveDoSelo(secret) {
  let k = chaves.get(secret);
  if (!k) {
    // Chave própria deste uso: derivada do segredo do site com um rótulo, para
    // um selo nunca valer como assinatura de outra coisa (nem o contrário).
    k = crypto.subtle.digest('SHA-256', new TextEncoder().encode(`envio-sessao|${secret}`))
      .then(d => crypto.subtle.importKey('raw', d, 'AES-GCM', false, ['encrypt', 'decrypt']));
    chaves.set(secret, k);
  }
  return k;
}

/** @param {Uint8Array} b */
const b64url = b => {
  let s = '';
  for (let i = 0; i < b.length; i += 0x8000) s += String.fromCharCode(...b.subarray(i, i + 0x8000));
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
};
/** @param {string} t */
const deB64url = t => Uint8Array.from(atob(t.replace(/-/g, '+').replace(/_/g, '/')), c => c.charCodeAt(0));

/**
 * @typedef {{ u: string, n: number, s: string, x: string, e: number }} SessaoSelada
 *   u = endereço da sessão no Google, n = tamanho do arquivo, s = slug do
 *   álbum, x = extensão (para conferir os primeiros bytes), e = vencimento (s)
 */

/**
 * Sela a sessão: cifrada E autenticada. A página guarda e devolve, sem
 * conseguir ler nem alterar.
 * @param {string} secret
 * @param {{ u: string, n: number, s: string, x: string }} dados
 */
export async function selaSessao(secret, dados) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const claro = new TextEncoder().encode(JSON.stringify({ ...dados, e: Math.floor(Date.now() / 1000) + ENVIO_SESSAO_TTL_SECS }));
  const cifrado = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, await chaveDoSelo(secret), claro));
  const tudo = new Uint8Array(iv.length + cifrado.length);
  tudo.set(iv);
  tudo.set(cifrado, iv.length);
  return b64url(tudo);
}

/**
 * Abre um selo. null se não for nosso, se foi mexido ou se venceu.
 * @param {string} secret
 * @param {unknown} selo
 * @returns {Promise<SessaoSelada | null>}
 */
export async function abreSessao(secret, selo) {
  if (typeof selo !== 'string' || selo.length < 40 || selo.length > 4000 || !/^[A-Za-z0-9_-]+$/.test(selo)) return null;
  try {
    const tudo = deB64url(selo);
    const claro = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: tudo.subarray(0, 12) }, await chaveDoSelo(secret), tudo.subarray(12));
    const d = JSON.parse(new TextDecoder().decode(claro));
    if (!d || typeof d !== 'object' || !sessaoDoGoogle(d.u) || !Number.isSafeInteger(d.n) || d.n < 1) return null;
    if (typeof d.s !== 'string' || typeof d.x !== 'string' || !Number.isFinite(d.e) || Date.now() / 1000 > d.e) return null;
    return d;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// O que o site aceita: nome, tipo, primeiros bytes
// ---------------------------------------------------------------------------

// eslint-disable-next-line no-control-regex
const CONTROLE_RE = /[\u0000-\u001f\u007f-\u009f\u2028\u2029]/g;

/**
 * O nome do arquivo como vai para o Drive: o do aparelho (é ele que casa o
 * vídeo de um Live Photo com a foto, e é o que a pessoa reconhece), sem
 * caminho, sem caractere de controle e com no máximo NOME_MAX caracteres.
 * '' se não sobrar nome ou se a extensão não for de foto ou vídeo.
 * @param {unknown} nome
 */
export function nomeDeArquivo(nome) {
  if (typeof nome !== 'string') return '';
  let n = nome.normalize('NFC').replace(CONTROLE_RE, '').replace(/[\\/]/g, '_').replace(/\s+/g, ' ').trim();
  // Só o último pedaço de um caminho, e nada de nome que comece com ponto.
  n = n.replace(/^\.+/, '');
  const ext = extensaoDe(n);
  if (!ext || !Object.hasOwn(ENVIO_TIPOS, ext)) return '';
  const base = n.slice(0, n.length - ext.length - 1).trim();
  if (!base) return '';
  return `${base.slice(0, NOME_MAX - ext.length - 1)}.${n.slice(n.length - ext.length)}`;
}

/** A extensão, minúscula, sem o ponto; '' se não houver. @param {string} nome */
export function extensaoDe(nome) {
  const m = /\.([A-Za-z0-9]{1,5})$/.exec(String(nome || ''));
  return m ? m[1].toLowerCase() : '';
}

/**
 * O tipo que o site declara ao Drive, pela extensão (nunca o que o navegador
 * diz). Declarar certo importa: arquivo que chega como
 * `application/octet-stream` não entra na galeria (RETOMADA §5.20).
 * @param {string} nome
 * @returns {{ ext: string, mime: string, video: boolean } | null}
 */
export function tipoDoArquivo(nome) {
  const ext = extensaoDe(nome);
  if (!ext || !Object.hasOwn(ENVIO_TIPOS, ext)) return null;
  const mime = /** @type {Record<string, string>} */ (ENVIO_TIPOS)[ext];
  return { ext, mime, video: mime.startsWith('video/') };
}

const FAMILIA_DA_EXT = /** @type {Record<string, string>} */ ({
  jpg: 'jpeg', jpeg: 'jpeg', png: 'png', gif: 'gif', webp: 'webp', dng: 'tiff', webm: 'webm',
  heic: 'bmff', heif: 'bmff', avif: 'bmff', mp4: 'bmff', m4v: 'bmff', mov: 'bmff', '3gp': 'bmff',
});
// Um arquivo ISO-BMFF (HEIC, AVIF, MP4, MOV) começa por uma caixa: 4 bytes de
// tamanho e 4 de tipo. Quase sempre `ftyp`; MOV antigo pode abrir com outra.
const CAIXAS_BMFF = ['ftyp', 'moov', 'mdat', 'wide', 'free', 'skip', 'pnot'];

/**
 * A "família" de um arquivo pelos primeiros bytes; '' se não reconhecer.
 * @param {Uint8Array} b
 */
export function familiaDosBytes(b) {
  if (b.length < 12) return '';
  const txt = (/** @type {number} */ i, /** @type {number} */ n) => String.fromCharCode(...b.subarray(i, i + n));
  if (b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return 'jpeg';
  if (b[0] === 0x89 && txt(1, 3) === 'PNG') return 'png';
  if (txt(0, 4) === 'GIF8') return 'gif';
  if (txt(0, 4) === 'RIFF' && txt(8, 4) === 'WEBP') return 'webp';
  if (b[0] === 0x1a && b[1] === 0x45 && b[2] === 0xdf && b[3] === 0xa3) return 'webm';
  if ((txt(0, 2) === 'II' && b[2] === 0x2a && b[3] === 0) || (txt(0, 2) === 'MM' && b[2] === 0 && b[3] === 0x2a)) return 'tiff';
  if (CAIXAS_BMFF.includes(txt(4, 4))) return 'bmff';
  return '';
}

/**
 * Os primeiros bytes são do tipo que a extensão diz? É o que impede um
 * `virus.exe` renomeado para `foto.jpg` de ir parar na pasta da turma. Não
 * distingue HEIC de MP4 (mesma família) nem valida o arquivo inteiro: o
 * objetivo é só "isto é mídia", e o Drive faz a leitura fina.
 * @param {string} ext
 * @param {Uint8Array} bytes
 */
export function bytesConferem(ext, bytes) {
  const esperada = FAMILIA_DA_EXT[ext];
  return !!esperada && familiaDosBytes(bytes) === esperada;
}

/** @param {unknown} fp */
export const fpValido = fp => typeof fp === 'string' && FP_RE.test(fp);

/**
 * A data do arquivo no aparelho (`File.lastModified`, em ms) como o Drive a
 * quer (`modifiedTime`); '' se for absurda. É o que mantém, na lista do Drive,
 * a data em que a foto foi feita em vez da data do envio. A data de captura
 * que a galeria usa vem do EXIF, que viaja intacto dentro do arquivo.
 * @param {unknown} ms
 */
export function dataModificada(ms) {
  const n = Number(ms);
  if (!Number.isFinite(n) || n < Date.UTC(1990, 0, 1) || n > Date.now() + 86_400_000) return '';
  return new Date(n).toISOString();
}

// ---------------------------------------------------------------------------
// A assinatura de quem manda → o crédito das fotos dela
// ---------------------------------------------------------------------------
// O crédito de um álbum é por PASTA (`pasta = Nome`, src/drive.js). A pasta de
// envio credita todo mundo junto ("Turma 2026"). Quem manda pelo site pode
// assinar; a assinatura vai na DESCRIÇÃO do arquivo no Drive ("Crédito: Maria
// Silva") e a galeria a lê junto com a lista da pasta — zero chamada a mais,
// visível e editável no próprio Drive (painel de detalhes do arquivo). Só vale
// dentro de pasta de envio, e nunca com o nome de um crédito do álbum.

// Letras de qualquer alfabeto, números, espaço, ponto, apóstrofo e hífen;
// começa por letra. Sem @, barra ou dois-pontos: não cabe link nem e-mail.
const ASSINATURA_RE = /^\p{L}[\p{L}\p{M}\p{N} .'’-]*$/u;

/**
 * A assinatura limpa, ou '' se não servir.
 * @param {unknown} v
 */
export function limpaAssinatura(v) {
  if (typeof v !== 'string') return '';
  const s = v.normalize('NFC').replace(CONTROLE_RE, ' ').replace(/\s+/g, ' ').trim();
  if (s.length < ENVIO_ASSINATURA_MIN || s.length > ENVIO_ASSINATURA_MAX || !ASSINATURA_RE.test(s)) return '';
  return s;
}

/** A descrição que o arquivo leva no Drive. @param {string} assinatura já limpa, ou '' */
export function descricaoDoEnvio(assinatura) {
  return `${assinatura ? `Crédito: ${assinatura}\n` : ''}Enviado pelo site do álbum.`;
}

/**
 * O crédito escrito na descrição de um arquivo: a primeira linha, no formato
 * "Crédito: Nome". '' se não houver ou não servir.
 * @param {unknown} descricao
 */
export function creditoDaDescricao(descricao) {
  if (typeof descricao !== 'string' || !descricao) return '';
  const m = /^\s*cr[eé]dito\s*:\s*(.+)$/iu.exec(descricao.slice(0, 200).split('\n')[0]);
  return m ? limpaAssinatura(m[1]) : '';
}
