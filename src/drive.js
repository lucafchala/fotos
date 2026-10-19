// Galeria própria (#234/#235) — leitura da pasta do Google Drive pela API
// oficial (Drive API v3), com uma chave de API que SÓ o servidor conhece.
//
// Por que chave de API e não OAuth: as pastas dos projetos já são
// compartilhadas como "qualquer pessoa com o link" (é assim que o visitante as
// abre hoje), e a Drive API lê pasta pública com uma chave simples — sem tela
// de consentimento, sem token de atualização para guardar, sem depender de a
// conta ser Workspace ou pessoal (#124). A chave fica em
// `GOOGLE_DRIVE_API_KEY` (wrangler secret) e nunca sai do Worker: as fotos
// chegam ao navegador pelo lh3 (sem chave) e os originais passam pelo proxy de
// download, que confere se o arquivo pertence à pasta do projeto.
//
// A lista é lida sob demanda e guardada por GALERIA_LISTA_TTL_S na memória do
// isolate e na Cache API (grátis, sem cota de escrita — o mesmo padrão da cópia
// da lista de eventos em utils.js). Nenhuma escrita de KV.

import {
  GALERIA_LISTA_TTL_S, GALERIA_MAX_FOTOS, GALERIA_MAX_PASTAS,
  GALERIA_MAX_PROFUNDIDADE, GALERIA_MAX_CHAMADAS,
} from './config.js';

const DRIVE_FILES = 'https://www.googleapis.com/drive/v3/files';
const FOLDER_MIME = 'application/vnd.google-apps.folder';
// Só o que a galeria usa: menos campos = JSON menor = menos CPU no parse (o
// plano gratuito tem 10 ms de CPU por requisição).
const CAMPOS = 'nextPageToken,files(id,name,mimeType,size,resourceKey,imageMediaMetadata(width,height,rotation))';
// ID de arquivo/pasta do Drive. Validado antes de entrar na query `q` da API:
// o da pasta raiz vem do painel e os das subpastas vêm da própria API, mas um
// apóstrofo fecharia a string da query.
const ID_RE = /^[A-Za-z0-9_-]{10,200}$/;
const TIMEOUT_MS = 8000;

/**
 * Uma foto da listagem, em forma compacta (vai para o cache e para a página):
 * [id, largura, altura, nome, bytes]. Largura/altura já com a rotação EXIF
 * aplicada (o lh3 entrega a foto girada); 0 quando o Drive não informou.
 * @typedef {[string, number, number, string, number]} FotoDrive
 */
/**
 * @typedef {{ nome: string, caminho: string, fotos: FotoDrive[] }} SecaoDrive
 * @typedef {{
 *   v: 1,
 *   pasta: string,
 *   em: string,
 *   truncada: boolean,
 *   secoes: SecaoDrive[],
 *   total: number,
 *   videos: number,
 *   outros: number,
 *   rk: Record<string, string>,
 * }} ListagemDrive
 */

// Erro com um código estável, para a página mostrar o conserto certo ao dono
// em vez de "deu erro". A mensagem é para pessoa, não para log.
export class DriveError extends Error {
  /**
   * @param {'chave-ausente'|'chave-invalida'|'chave-restrita'|'api-desligada'|'pasta-inacessivel'|'limite'|'falha'} codigo
   * @param {string} mensagem
   */
  constructor(codigo, mensagem) {
    super(mensagem);
    this.name = 'DriveError';
    this.codigo = codigo;
  }
}

/**
 * Extrai o ID da pasta (e a resourcekey, se houver) de um link do Drive.
 * Host comparado com new URL(), nunca por substring (RETOMADA §5.6).
 * Aceita /drive/folders/ID, /drive/u/N/folders/ID, /open?id=ID e
 * /folderview?id=ID. Qualquer outra coisa → null (link de arquivo, Google
 * Fotos, texto solto).
 * @param {unknown} link
 * @returns {{ id: string, resourceKey: string } | null}
 */
export function pastaDoDrive(link) {
  if (typeof link !== 'string' || !link) return null;
  let u;
  try { u = new URL(link); } catch { return null; }
  if (u.protocol !== 'https:' || u.host !== 'drive.google.com') return null;
  const m = u.pathname.match(/^\/drive\/(?:u\/\d+\/)?folders\/([^/]+)\/?$/);
  let id = m ? m[1] : '';
  if (!id && (u.pathname === '/open' || u.pathname === '/folderview')) id = u.searchParams.get('id') || '';
  if (!ID_RE.test(id)) return null;
  const rk = u.searchParams.get('resourcekey') || '';
  return { id, resourceKey: /^[A-Za-z0-9_-]{1,200}$/.test(rk) ? rk : '' };
}

// Ordem natural ("2" antes de "10"), sem diferenciar maiúscula/acento — é como
// o fotógrafo numera os arquivos e como o Drive mostra quando ordena por nome.
const COLLATOR = new Intl.Collator('pt-BR', { numeric: true, sensitivity: 'base' });
/** @param {string} a @param {string} b */
export const ordemNatural = (a, b) => COLLATOR.compare(a, b);

/** @type {Map<string, { em: number, dados: ListagemDrive }>} */
const memoria = new Map();
/** @param {string} id */
const chaveCache = id => `https://fotos.invalid/__galeria/${id}`;

function cacheStore() {
  // Ausente no vitest e fora do runtime Workers — o cache é best-effort.
  return (typeof caches !== 'undefined' && caches && caches.default) || null;
}

/** Só para testes: o cache de módulo vazaria entre casos. */
export function limpaCacheDrive() { memoria.clear(); }

/**
 * Lê a pasta do projeto: fotos da raiz e de subpastas (cada subpasta vira uma
 * seção), com limites que mantêm uma requisição dentro do plano gratuito.
 * @param {{ GOOGLE_DRIVE_API_KEY?: string }} env
 * @param {{ id: string, resourceKey: string }} pasta
 * @param {{ atualizar?: boolean }} [opts]
 * @returns {Promise<ListagemDrive>}
 */
export async function listaPasta(env, pasta, { atualizar = false } = {}) {
  const chave = (env.GOOGLE_DRIVE_API_KEY || '').trim();
  if (!chave) {
    throw new DriveError('chave-ausente', 'Falta a chave da Drive API (GOOGLE_DRIVE_API_KEY).');
  }
  if (!ID_RE.test(pasta.id)) throw new DriveError('pasta-inacessivel', 'O link do Drive deste projeto não aponta para uma pasta.');

  if (!atualizar) {
    const mem = memoria.get(pasta.id);
    if (mem && Date.now() - mem.em < GALERIA_LISTA_TTL_S * 1000) return mem.dados;
    const store = cacheStore();
    if (store) {
      try {
        const hit = await store.match(chaveCache(pasta.id));
        if (hit) {
          const dados = /** @type {ListagemDrive} */ (await hit.json());
          memoria.set(pasta.id, { em: Date.now(), dados });
          return dados;
        }
      } catch (e) {
        console.error('galeria: leitura do cache falhou', e);
      }
    }
  }

  const dados = await percorre(chave, pasta);
  memoria.set(pasta.id, { em: Date.now(), dados });
  const store = cacheStore();
  if (store) {
    try {
      await store.put(chaveCache(pasta.id), new Response(JSON.stringify(dados), {
        headers: { 'Content-Type': 'application/json', 'Cache-Control': `max-age=${GALERIA_LISTA_TTL_S}` },
      }));
    } catch (e) {
      console.error('galeria: escrita do cache falhou', e);
    }
  }
  return dados;
}

/**
 * Busca em largura, pasta a pasta. Cada página da API é uma subrequisição
 * (50 por invocação no plano gratuito), por isso o teto GALERIA_MAX_CHAMADAS
 * e a marca `truncada` em vez de falhar: lista parcial é melhor que nenhuma, e
 * a página avisa.
 * @param {string} chave
 * @param {{ id: string, resourceKey: string }} raiz
 * @returns {Promise<ListagemDrive>}
 */
async function percorre(chave, raiz) {
  /** @type {{ id: string, rk: string, caminho: string[] }[]} */
  const fila = [{ id: raiz.id, rk: raiz.resourceKey, caminho: [] }];
  /** @type {Map<string, SecaoDrive>} */
  const secoes = new Map();
  /** @type {Record<string, string>} */
  const rk = {};
  let chamadas = 0, pastas = 1, total = 0, videos = 0, outros = 0, truncada = false;

  percurso:
  while (fila.length) {
    const atual = /** @type {{ id: string, rk: string, caminho: string[] }} */ (fila.shift());
    const caminho = atual.caminho.join(' / ');
    let secao = secoes.get(caminho);
    if (!secao) {
      secao = { nome: atual.caminho[atual.caminho.length - 1] || '', caminho, fotos: [] };
      secoes.set(caminho, secao);
    }
    let pageToken = '';
    do {
      if (chamadas >= GALERIA_MAX_CHAMADAS) { truncada = true; break percurso; }
      chamadas++;
      const pagina = await chamaDrive(chave, atual, pageToken);
      for (const f of Array.isArray(pagina.files) ? pagina.files : []) {
        if (!f || typeof f.id !== 'string' || !ID_RE.test(f.id)) continue;
        const mime = typeof f.mimeType === 'string' ? f.mimeType : '';
        if (mime === FOLDER_MIME) {
          if (atual.caminho.length < GALERIA_MAX_PROFUNDIDADE && pastas < GALERIA_MAX_PASTAS) {
            pastas++;
            fila.push({ id: f.id, rk: typeof f.resourceKey === 'string' ? f.resourceKey : '', caminho: [...atual.caminho, String(f.name || 'Sem nome').slice(0, 120)] });
          } else {
            truncada = true;
          }
          continue;
        }
        if (mime.startsWith('image/')) {
          if (total >= GALERIA_MAX_FOTOS) { truncada = true; continue; }
          total++;
          secao.fotos.push(fotoCompacta(f));
          if (typeof f.resourceKey === 'string' && f.resourceKey) rk[f.id] = f.resourceKey;
        } else if (mime.startsWith('video/')) {
          videos++;
        } else {
          outros++;
        }
      }
      pageToken = typeof pagina.nextPageToken === 'string' ? pagina.nextPageToken : '';
    } while (pageToken);
  }

  for (const s of secoes.values()) s.fotos.sort((a, b) => ordemNatural(a[3], b[3]));
  // Raiz primeiro, depois as subpastas em ordem natural; seção vazia some (uma
  // pasta só de subpastas não deixa um título solto sem foto embaixo).
  const lista = [...secoes.values()]
    .filter(s => s.fotos.length > 0)
    .sort((a, b) => (a.caminho === '' ? -1 : b.caminho === '' ? 1 : ordemNatural(a.caminho, b.caminho)));

  return { v: 1, pasta: raiz.id, em: new Date().toISOString(), truncada, secoes: lista, total, videos, outros, rk };
}

/**
 * @param {any} f arquivo como a API devolve
 * @returns {FotoDrive}
 */
function fotoCompacta(f) {
  const meta = f.imageMediaMetadata && typeof f.imageMediaMetadata === 'object' ? f.imageMediaMetadata : {};
  let w = Number.isInteger(meta.width) && meta.width > 0 ? meta.width : 0;
  let h = Number.isInteger(meta.height) && meta.height > 0 ? meta.height : 0;
  // rotation = quartos de volta da orientação EXIF. O lh3 já entrega a foto
  // girada, então em 90°/270° a largura exibida é a altura armazenada — sem
  // isto a grade reservaria uma caixa deitada para uma foto em pé.
  if (meta.rotation === 1 || meta.rotation === 3) [w, h] = [h, w];
  const bytes = Number.parseInt(String(f.size || '0'), 10);
  return [f.id, w, h, String(f.name || '').slice(0, 200), Number.isFinite(bytes) && bytes > 0 ? bytes : 0];
}

/**
 * @param {string} chave
 * @param {{ id: string, rk: string }} pasta
 * @param {string} pageToken
 */
async function chamaDrive(chave, pasta, pageToken) {
  const params = new URLSearchParams({
    q: `'${pasta.id}' in parents and trashed = false`,
    fields: CAMPOS,
    pageSize: '1000',
    supportsAllDrives: 'true',
    includeItemsFromAllDrives: 'true',
    key: chave,
  });
  if (pageToken) params.set('pageToken', pageToken);
  /** @type {Record<string, string>} */
  const headers = { Accept: 'application/json' };
  if (pasta.rk) headers['X-Goog-Drive-Resource-Keys'] = `${pasta.id}/${pasta.rk}`;
  let res;
  try {
    res = await fetch(`${DRIVE_FILES}?${params}`, { headers, signal: AbortSignal.timeout(TIMEOUT_MS) });
  } catch {
    // Sem a URL na mensagem: ela carrega a chave.
    throw new DriveError('falha', 'O Google Drive não respondeu a tempo. Tente de novo em instantes.');
  }
  if (!res.ok) throw await erroDaApi(res);
  return /** @type {any} */ (await res.json());
}

/**
 * Traduz o erro da API no conserto que o dono precisa fazer.
 * @param {Response} res
 * @returns {Promise<DriveError>}
 */
export async function erroDaApi(res) {
  /** @type {any} */
  let corpo = null;
  try { corpo = await res.json(); } catch { /* corpo não-JSON */ }
  const err = corpo && corpo.error ? corpo.error : {};
  const razoes = [
    ...(Array.isArray(err.errors) ? err.errors.map((/** @type {any} */ e) => e && e.reason) : []),
    ...(Array.isArray(err.details) ? err.details.map((/** @type {any} */ d) => d && d.reason) : []),
  ].filter(Boolean).map(String);
  const tem = (/** @type {string} */ r) => razoes.includes(r);
  const msg = String(err.message || '');

  if (tem('API_KEY_INVALID') || /API key not valid/i.test(msg)) {
    return new DriveError('chave-invalida', 'A chave da Drive API foi recusada pelo Google (inválida ou apagada).');
  }
  if (razoes.some(r => /^API_KEY_.*_BLOCKED$/.test(r)) || tem('API_KEY_SERVICE_BLOCKED')) {
    return new DriveError('chave-restrita', 'A chave existe, mas está restrita de um jeito que bloqueia o Worker (site, IP ou API errada).');
  }
  if (tem('accessNotConfigured') || tem('SERVICE_DISABLED')) {
    return new DriveError('api-desligada', 'A Google Drive API não está ativada no projeto do Google Cloud desta chave.');
  }
  if (res.status === 429 || tem('rateLimitExceeded') || tem('userRateLimitExceeded') || tem('dailyLimitExceeded') || tem('downloadQuotaExceeded')) {
    return new DriveError('limite', 'O Google limitou as consultas por um momento. Tente de novo em alguns minutos.');
  }
  if (res.status === 404 || res.status === 403) {
    return new DriveError('pasta-inacessivel', 'O Drive não deixa ler esta pasta: confira se ela está compartilhada como "Qualquer pessoa com o link" e se o link no projeto está certo.');
  }
  return new DriveError('falha', `O Google Drive respondeu com erro ${res.status}.`);
}

/**
 * Procura uma foto na listagem.
 * @param {ListagemDrive} dados
 * @param {string} id
 * @returns {FotoDrive | null}
 */
export function achaFoto(dados, id) {
  for (const s of dados.secoes) {
    for (const f of s.fotos) if (f[0] === id) return f;
  }
  return null;
}

/** @param {string} id */
export const idDriveValido = id => ID_RE.test(id);

/**
 * URL da foto redimensionada pelo próprio Google (lh3), sem chave. A largura é
 * o lado HORIZONTAL; o lh3 não amplia além do original.
 * @param {string} id
 * @param {number} largura
 */
export function urlLh3(id, largura) {
  return `https://lh3.googleusercontent.com/d/${id}=w${Math.max(1, Math.round(largura))}`;
}

/**
 * URL do ARQUIVO ORIGINAL pela Drive API (byte a byte). Leva a chave — só
 * para uso do servidor, nunca para a página.
 * @param {string} id
 * @param {string} chave
 */
export function urlOriginal(id, chave) {
  const p = new URLSearchParams({ alt: 'media', supportsAllDrives: 'true', key: chave });
  return `${DRIVE_FILES}/${id}?${p}`;
}
