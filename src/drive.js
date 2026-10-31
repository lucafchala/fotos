// Galeria própria (#234/#235) — leitura da pasta do Google Drive pela API
// oficial (Drive API v3), com uma chave de API que SÓ o servidor conhece.
//
// Por que chave de API e não OAuth: as pastas dos projetos já são
// compartilhadas como "qualquer pessoa com o link" (é assim que o visitante as
// abre hoje), e a Drive API lê pasta pública com uma chave simples — sem tela
// de consentimento, sem token de atualização para guardar, sem depender de a
// conta ser Workspace ou pessoal (#124). A chave fica em
// `GOOGLE_DRIVE_API_KEY` (wrangler secret) e nunca sai do Worker: as fotos
// chegam ao navegador pelo lh3 (sem chave) e os arquivos baixados (o original e
// o da pasta do Instagram) passam pelo proxy de download, que confere se o
// arquivo pertence à pasta do projeto.
//
// A lista é lida sob demanda e guardada por GALERIA_LISTA_TTL_S na memória do
// isolate e na Cache API (grátis, sem cota de escrita — o mesmo padrão da cópia
// da lista de eventos em utils.js). Nenhuma escrita de KV.

import {
  GALERIA_LISTA_TTL_S, GALERIA_MAX_FOTOS, GALERIA_MAX_PASTAS,
  GALERIA_MAX_PROFUNDIDADE, GALERIA_MAX_CHAMADAS, GALERIA_MAX_OCULTAS,
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
// Nome de arquivo guardado por inteiro até aqui: o download devolve o nome
// EXATO do Drive, e 255 é o teto de nome nos sistemas de arquivo comuns.
const NOME_MAX = 255;

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
// A chave leva o TETO de páginas: a galeria (GALERIA_MAX_CHAMADAS) e a pasta do
// Instagram (GALERIA_MAX_CHAMADAS_IG) leem com tetos diferentes, e uma lista
// feita com o teto de 8 páginas, guardada só pelo id da pasta, serviria de
// "completa" a quem pediu 30 (e a de 30 vazaria para quem pediu 8, estourando
// a conta das 50 subrequisições se virasse a base de uma releitura).
/** @param {string} id @param {number} maxChamadas */
const chaveMemoria = (id, maxChamadas) => `${id}#${maxChamadas}`;
/** @param {string} id @param {number} maxChamadas */
const chaveCache = (id, maxChamadas) => `https://fotos.invalid/__galeria/${id}/m${maxChamadas}`;

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
 * @param {{ atualizar?: boolean, maxChamadas?: number }} [opts] `maxChamadas`:
 *   teto de páginas da API nesta pasta (a do Instagram usa um menor, para as
 *   duas listas frias caberem nas 50 subrequisições da invocação)
 * @returns {Promise<ListagemDrive>}
 */
export async function listaPasta(env, pasta, { atualizar = false, maxChamadas = GALERIA_MAX_CHAMADAS } = {}) {
  const chave = (env.GOOGLE_DRIVE_API_KEY || '').trim();
  if (!chave) {
    throw new DriveError('chave-ausente', 'Falta a chave da Drive API (GOOGLE_DRIVE_API_KEY).');
  }
  if (!ID_RE.test(pasta.id)) throw new DriveError('pasta-inacessivel', 'O link do Drive deste projeto não aponta para uma pasta.');

  const kMem = chaveMemoria(pasta.id, maxChamadas);
  const kCache = chaveCache(pasta.id, maxChamadas);
  if (!atualizar) {
    const mem = memoria.get(kMem);
    if (mem && Date.now() - mem.em < GALERIA_LISTA_TTL_S * 1000) return mem.dados;
    const store = cacheStore();
    if (store) {
      try {
        const hit = await store.match(kCache);
        if (hit) {
          const dados = /** @type {ListagemDrive} */ (await hit.json());
          memoria.set(kMem, { em: Date.now(), dados });
          return dados;
        }
      } catch (e) {
        console.error('galeria: leitura do cache falhou', e);
      }
    }
  }

  const dados = await percorre(chave, pasta, maxChamadas);
  memoria.set(kMem, { em: Date.now(), dados });
  const store = cacheStore();
  if (store) {
    try {
      await store.put(kCache, new Response(JSON.stringify(dados), {
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
 * (50 por invocação no plano gratuito), por isso o teto `maxChamadas`
 * (GALERIA_MAX_CHAMADAS na galeria, GALERIA_MAX_CHAMADAS_IG na pasta do
 * Instagram) e a marca `truncada` em vez de falhar: lista parcial é melhor que
 * nenhuma, e a página avisa.
 * @param {string} chave
 * @param {{ id: string, resourceKey: string }} raiz
 * @param {number} maxChamadas
 * @returns {Promise<ListagemDrive>}
 */
async function percorre(chave, raiz, maxChamadas) {
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
      if (chamadas >= maxChamadas) { truncada = true; break percurso; }
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
  return [f.id, w, h, String(f.name || '').slice(0, NOME_MAX), Number.isFinite(bytes) && bytes > 0 ? bytes : 0];
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
 * A listagem sem as fotos que o dono ocultou (pedido de remoção, foto ruim).
 * Seção que fica vazia sai; o total acompanha. Sem nada oculto, devolve a
 * MESMA listagem (nenhuma cópia por visita).
 * @param {ListagemDrive} dados
 * @param {readonly string[] | undefined} ocultas
 * @returns {ListagemDrive}
 */
export function semOcultas(dados, ocultas) {
  if (!ocultas || !ocultas.length) return dados;
  const fora = new Set(ocultas);
  const secoes = dados.secoes
    .map(s => ({ ...s, fotos: s.fotos.filter(f => !fora.has(f[0])) }))
    .filter(s => s.fotos.length);
  const total = secoes.reduce((n, s) => n + s.fotos.length, 0);
  return { ...dados, secoes, total };
}

/**
 * Lista de fotos ocultas como o evento grava: IDs do Drive válidos, sem
 * repetição, no máximo GALERIA_MAX_OCULTAS. Qualquer outra forma vira lista
 * vazia — este campo decide o que o público vê, não pode guardar lixo.
 * @param {unknown} v
 * @returns {string[]}
 */
export function normalizaOcultas(v) {
  if (!Array.isArray(v)) return [];
  const out = new Set();
  for (const id of v) {
    if (typeof id === 'string' && ID_RE.test(id)) out.add(id);
    if (out.size >= GALERIA_MAX_OCULTAS) break;
  }
  return [...out];
}

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

const ASCII_RE = /^[\p{ASCII}]*$/u;

/**
 * Chave de comparação do nome de uma foto: sem a extensão (a pasta do
 * Instagram costuma ser .jpg e o original .heic/.png/.JPG), sem diferenciar
 * maiúscula e com a forma Unicode normalizada (o Drive devolve "Cerimônia"
 * composto ou decomposto, conforme quem enviou).
 *
 * `normalize()` é a parte cara (passa pelo ICU) e só muda o resultado quando
 * há caractere fora do ASCII — "IMG_0001.jpg" não tem o que normalizar. Nome
 * 100% ASCII pula a chamada; sobra uma `toLowerCase()` só, na ordem que
 * importa para o Unicode (normaliza e depois minuscula).
 * @param {string} nome
 */
export function chaveDeNome(nome) {
  const ponto = nome.lastIndexOf('.');
  const base = ponto > 0 ? nome.slice(0, ponto) : nome;
  return (ASCII_RE.test(base) ? base : base.normalize('NFC')).toLowerCase().trim();
}

// Sufixo que o fotógrafo costuma pôr no arquivo exportado para o Instagram
// ("001-insta.jpg", "001_ig.jpg", "001 instagram.jpg", "001-redes.jpg"). Só vale
// quando NÃO há arquivo de nome igual ao da galeria.
const SUFIXO_IG = /[\s._-]+(?:insta|instagram|ig|redes)$/;
/** @param {string} k */
const terminaComSufixo = k => k.endsWith('insta') || k.endsWith('instagram') || k.endsWith('ig') || k.endsWith('redes');

/**
 * Candidato da pasta do Instagram, em lista encadeada (na ordem da listagem):
 * um objeto por foto, sem o array por nome que a versão anterior alocava.
 * @typedef {{ caminho: string, foto: FotoDrive, prox: Cand | null }} Cand
 */
/**
 * O índice de nomes de UMA listagem do Instagram, montado uma vez por listagem
 * (não por galeria nem por visita): chave do nome → candidatos.
 * @typedef {{ exato: Map<string, Cand>, semSufixo: Map<string, Cand> }} IndiceIg
 */
/** @type {WeakMap<ListagemDrive, IndiceIg>} */
const indices = new WeakMap();

/** Minúscula e NFC uma vez só por seção (o caminho é comparado por fotos). */
/** @param {string} caminho */
const caminhoChave = caminho => (ASCII_RE.test(caminho) ? caminho : caminho.normalize('NFC')).toLowerCase();

/**
 * @param {Map<string, Cand>} m
 * @param {string} k
 * @param {Cand} v
 */
function poe(m, k, v) {
  const c = m.get(k);
  if (!c) { m.set(k, v); return; }
  let ult = c;
  while (ult.prox) ult = ult.prox;
  ult.prox = v;
}

/** @param {ListagemDrive} ig @returns {IndiceIg} */
function indiceDoIg(ig) {
  const guardado = indices.get(ig);
  if (guardado) return guardado;
  /** @type {IndiceIg} */
  const indice = { exato: new Map(), semSufixo: new Map() };
  for (const s of ig.secoes) {
    const caminho = caminhoChave(s.caminho);
    for (const foto of s.fotos) {
      const k = chaveDeNome(foto[3]);
      poe(indice.exato, k, { caminho, foto, prox: null });
      if (terminaComSufixo(k)) {
        const sem = k.replace(SUFIXO_IG, '');
        if (sem !== k && sem) poe(indice.semSufixo, sem, { caminho, foto, prox: null });
      }
    }
  }
  indices.set(ig, indice);
  return indice;
}

/** @type {WeakMap<ListagemDrive, FotoDrive[]>} */
const planos = new WeakMap();

/**
 * Os arquivos da pasta do Instagram numa lista só, na ordem da listagem — a
 * posição de cada um é o que o casamento guardado grava no lugar do id. Não
 * passa pelo índice de nomes: remontar um casamento guardado não pode pagar a
 * normalização dos nomes que o guardado existe para evitar.
 * @param {ListagemDrive} ig
 */
function planoDoIg(ig) {
  let plano = planos.get(ig);
  if (!plano) { plano = ig.secoes.flatMap(s => s.fotos); planos.set(ig, plano); }
  return plano;
}

/** @type {WeakMap<ListagemDrive, { ig: ListagemDrive, mapa: Map<string, FotoDrive> }>} */
const casamentos = new WeakMap();

/**
 * Quais fotos da galeria têm versão na pasta do Instagram.
 *
 * Regra (documentada em RETOMADA §5.13 e no README): o arquivo do Instagram
 * casa com o da galeria pelo NOME SEM EXTENSÃO, sem diferenciar maiúscula
 * ("010.JPG" casa com "010.jpg" e com "010.heic"); na falta de um nome igual,
 * vale o nome do Instagram com um sufixo "-insta", "_ig", "-instagram" ou
 * "-redes" a mais. Com nomes repetidos em subpastas diferentes, vale o da
 * MESMA subpasta; sobrando mais de um, o primeiro em ordem natural. Foto sem
 * par fica fora do mapa — a página não oferece "para redes" para ela e o
 * download responde 404.
 *
 * Custo (o plano gratuito dá 10 ms de CPU por invocação): só olha o que a
 * listagem já trouxe (nenhuma chamada ao Drive); o índice de nomes do
 * Instagram é montado UMA vez por listagem dele; nome ASCII não passa por
 * `normalize()`. Medido com 6000 fotos de cada lado (config.js): ~6,5 ms de CPU
 * no node, contra 7 ms (melhor caso) e 15–37 ms (mediana) antes. Mesmo assim,
 * `casaRedesCacheado` guarda o RESULTADO (alguns KB) ao lado da listagem, e
 * um isolate novo remonta o mapa por id, sem refazer a comparação de nomes.
 * @param {ListagemDrive} galeria
 * @param {ListagemDrive} ig
 * @returns {Map<string, FotoDrive>} id da foto da galeria → arquivo da pasta do Instagram
 */
export function casaRedes(galeria, ig) {
  const guardado = casamentos.get(galeria);
  if (guardado && guardado.ig === ig) return guardado.mapa;

  const { exato, semSufixo } = indiceDoIg(ig);
  /** @param {Cand | undefined} cands @param {string} caminho */
  const escolhe = (cands, caminho) => {
    if (!cands) return null;
    // A lista de cada seção já está em ordem natural: o primeiro é o primeiro.
    for (let c = cands; c; c = /** @type {Cand} */ (c.prox)) if (c.caminho === caminho) return c.foto;
    return cands.foto;
  };

  /** @type {Map<string, FotoDrive>} */
  const mapa = new Map();
  for (const s of galeria.secoes) {
    const caminho = caminhoChave(s.caminho);
    for (const f of s.fotos) {
      const k = chaveDeNome(f[3]);
      const par = escolhe(exato.get(k), caminho) || escolhe(semSufixo.get(k), caminho);
      if (par) mapa.set(f[0], par);
    }
  }
  casamentos.set(galeria, { ig, mapa });
  return mapa;
}

/** @param {ListagemDrive} galeria @param {ListagemDrive} ig */
const chaveCasamento = (galeria, ig) =>
  `https://fotos.invalid/__galeria/redes/${galeria.pasta}/${ig.pasta}/${Date.parse(galeria.em) || 0}/${Date.parse(ig.em) || 0}`;

/**
 * `casaRedes` com o resultado guardado na Cache API, ao lado das listagens e
 * com o mesmo prazo (GALERIA_LISTA_TTL_S). A chave leva o instante de cada
 * listagem (`em`): releitura forçada ou lista nova = chave nova, então o
 * casamento nunca é de uma lista que já não é a que está na mão. Guarda só
 * posições (para cada foto da galeria, na ordem da listagem, a posição do
 * arquivo do Instagram ou -1: ~7 bytes por foto); no isolate novo, o mapa é
 * remontado por posição, sem normalizar nem comparar nome nenhum.
 *
 * Custo de subrequisição: +1 `match` (e +1 `put` quando precisa calcular).
 * Está na conta da config (GALERIA_MAX_CHAMADAS_IG).
 * @param {ListagemDrive} galeria
 * @param {ListagemDrive} ig
 * @returns {Promise<Map<string, FotoDrive>>}
 */
export async function casaRedesCacheado(galeria, ig) {
  const memoria = casamentos.get(galeria);
  if (memoria && memoria.ig === ig) return memoria.mapa;

  const store = cacheStore();
  const chave = chaveCasamento(galeria, ig);
  if (store) {
    try {
      const hit = await store.match(chave);
      if (hit) {
        const mapa = remontaCasamento(galeria, ig, /** @type {unknown} */ (await hit.json()));
        if (mapa) { casamentos.set(galeria, { ig, mapa }); return mapa; }
      }
    } catch (e) {
      console.error('galeria: leitura do casamento "para redes" falhou', e);
    }
  }

  const mapa = casaRedes(galeria, ig);
  if (store) {
    try {
      const posicao = new Map(planoDoIg(ig).map((f, i) => [f, i]));
      /** @type {number[]} */
      const posicoes = [];
      for (const s of galeria.secoes) for (const f of s.fotos) {
        const par = mapa.get(f[0]);
        posicoes.push(par ? /** @type {number} */ (posicao.get(par)) : -1);
      }
      await store.put(chave, new Response(JSON.stringify(posicoes), {
        headers: { 'Content-Type': 'application/json', 'Cache-Control': `max-age=${GALERIA_LISTA_TTL_S}` },
      }));
    } catch (e) {
      console.error('galeria: escrita do casamento "para redes" falhou', e);
    }
  }
  return mapa;
}

/**
 * Remonta o mapa a partir das posições guardadas. Qualquer coisa fora do
 * formato (tamanho diferente da galeria, posição fora da lista do Instagram)
 * descarta o guardado (null): o chamador recalcula, nunca serve um casamento
 * que não confere com as listas.
 * @param {ListagemDrive} galeria
 * @param {ListagemDrive} ig
 * @param {unknown} posicoes
 * @returns {Map<string, FotoDrive> | null}
 */
function remontaCasamento(galeria, ig, posicoes) {
  if (!Array.isArray(posicoes)) return null;
  const alvos = planoDoIg(ig);
  let i = 0;
  /** @type {Map<string, FotoDrive>} */
  const mapa = new Map();
  for (const s of galeria.secoes) {
    for (const f of s.fotos) {
      const j = posicoes[i++];
      if (j === -1) continue;
      if (!Number.isInteger(j) || j < 0 || j >= alvos.length) return null;
      mapa.set(f[0], alvos[j]);
    }
  }
  return i === posicoes.length ? mapa : null;
}

/**
 * A pasta do Instagram de um projeto, ou null quando não há uma de verdade:
 * sem link, link que não é de pasta, ou — o caso fácil de errar ao colar —
 * a MESMA pasta da galeria. Nesse último, "para redes" entregaria o próprio
 * original como se fosse a versão preparada (e leria a pasta duas vezes), então
 * é tratado como se não houvesse pasta do Instagram.
 * @param {{ driveUrl?: unknown, driveUrlInstagram?: unknown }} event
 * @returns {{ id: string, resourceKey: string } | null}
 */
export function pastaInstagram(event) {
  const ig = pastaDoDrive(event.driveUrlInstagram);
  if (!ig) return null;
  const galeria = pastaDoDrive(event.driveUrl);
  return galeria && galeria.id === ig.id ? null : ig;
}
