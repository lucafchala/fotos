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

import { lerSnapshot, gravaSnapshot } from './snapshot.js';
import { tomaLease, soltaLease } from './utils.js';
import {
  GALERIA_LISTA_TTL_S, GALERIA_PERIODOS_S, GALERIA_SNAPSHOT_MEM_S, GALERIA_MAX_FOTOS, GALERIA_MAX_PASTAS,
  GALERIA_MAX_PROFUNDIDADE, GALERIA_MAX_CHAMADAS, GALERIA_MAX_OCULTAS, GALERIA_MAX_CHAMADAS_CAP,
  GALERIA_MAX_CHAMADAS_PAGO, GALERIA_MAX_CHAMADAS_CAP_PAGO, GALERIA_MAX_PASTAS_PAGO, ENVIO_MAX_CHAMADAS_PAGO,
  AUTOR_PADRAO, CREDITOS_PADRAO, GALERIA_CREDITOS_MAX_LINHAS, GALERIA_CREDITOS_NOME_MAX,
  GALERIA_CREDITOS_EMAIL_MAX, EMAIL_RE, GALERIA_MAX_CAPITULOS,
  GALERIA_LEASE_S, GALERIA_LEASE_POS_S, GALERIA_REVERIFICA_S, GALERIA_VELHO_MAX_S, GALERIA_ESPERA_MS, GALERIA_ESPERAS,
  NOVAS_JANELA_DIAS, EPOCA_CRIADA_MS, NOVAS_RESUMO_MAX,
} from './config.js';

const DRIVE_FILES = 'https://www.googleapis.com/drive/v3/files';
const FOLDER_MIME = 'application/vnd.google-apps.folder';
// Só o que a galeria usa: menos campos = JSON menor = menos CPU no parse (o
// plano gratuito tem 10 ms de CPU por requisição).
// `videoMediaMetadata` (item 1f): largura, altura e duração do vídeo.
const CAMPOS = 'nextPageToken,files(id,name,mimeType,size,resourceKey,imageMediaMetadata(width,height,rotation,time),videoMediaMetadata(width,height,durationMillis),createdTime,shortcutDetails(targetId,targetMimeType,targetResourceKey))';
// Atalho do Drive (v3.6): ver percorre.
const SHORTCUT_MIME = 'application/vnd.google-apps.shortcut';
// ID de arquivo/pasta do Drive. Validado antes de entrar na query `q` da API:
// o da pasta raiz vem do painel e os das subpastas vêm da própria API, mas um
// apóstrofo fecharia a string da query.
const CAMPOS_PASTAS = 'nextPageToken,files(id,name,resourceKey)';
const ID_RE = /^[A-Za-z0-9_-]{10,200}$/;
const TIMEOUT_MS = 8000;
// Nome de arquivo guardado por inteiro até aqui: o download devolve o nome
// EXATO do Drive, e 255 é o teto de nome nos sistemas de arquivo comuns.
const NOME_MAX = 255;

/**
 * Um item da listagem (foto ou vídeo), em forma compacta (vai para o cache e
 * para a página): [id, largura, altura, nome, bytes, autor, hora, extra].
 * Largura/altura já com a rotação EXIF aplicada (o lh3 entrega a foto girada);
 * 0 quando o Drive não informou. `autor` é o índice em `ListagemDrive.aut` (0 =
 * autor padrão) e `hora` a data de captura como número AAAAMMDDHHMMSS (0 = sem
 * data); estes SÓ existem na tupla quando diferem de 0 (JSON compacto: nenhuma
 * foto de álbum comum paga bytes a mais).
 *
 * `extra` (item 1f) só existe quando há o que dizer, e tem duas formas:
 *  - NÚMERO: o item é um VÍDEO e o número é a duração em segundos (0 = o Drive
 *    não informou). Vídeo não tem hora de captura nem versão "para redes".
 *  - LISTA [id, nome, bytes]: a foto é um Live Photo e esse é o vídeo dele (o
 *    .MOV/.MP4 de mesmo nome na mesma pasta). O vídeo NÃO é um item à parte:
 *    some e aparece só como "Baixar vídeo do Live Photo".
 * `criada` (item j, #250, índice 8): minutos desde 2025-01-01 (UTC) em que o
 * arquivo chegou à pasta (`createdTime`) — só para o que chegou nos últimos
 * NOVAS_JANELA_DIAS dias; o resto não leva, e a lista não engorda.
 * @typedef {[string, number, number, string, number, number?, number?, (number | [string, string, number] | null)?, number?]} FotoDrive
 */
/**
 * @typedef {{ nome: string, caminho: string, fotos: FotoDrive[] }} SecaoDrive
 * @typedef {{
 *   v: 2 | 3,
 *   pasta: string,
 *   em: string,
 *   truncada: boolean,
 *   secoes: SecaoDrive[],
 *   total: number,
 *   videos: number,
 *   outros: number,
 *   rk: Record<string, string>,
 *   aut: string[],
 *   ch?: number,
 *   sa?: number,
 * }} ListagemDrive
 */

// Erro com um código estável, para a página mostrar o conserto certo ao dono
// em vez de "deu erro". A mensagem é para pessoa, não para log.
export class DriveError extends Error {
  /**
   * @param {'chave-ausente'|'chave-invalida'|'chave-restrita'|'api-desligada'|'pasta-inacessivel'|'limite'|'falha'|'carregando'} codigo
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

// ---------------------------------------------------------------------------
// Créditos por pasta de autor (v3.1)
// ---------------------------------------------------------------------------
// O campo do projeto "Créditos por pasta" tem uma linha por autor,
// `pasta = Nome`. Uma pasta do Drive cujo nome (aparado, minúsculo, sem acento)
// bate com uma chave NÃO é uma seção: as fotos dela entram na seção da pasta de
// cima, marcadas com o autor, e ela não conta para o limite de profundidade.
// Foto fora de pasta de autor é do autor padrão (AUTOR_PADRAO), a não ser que o
// campo tenha a linha `* = Nome[ <e-mail>]`: ela troca o autor padrão DAQUELE
// projeto (Santa: `* = Turma 2026`). A chave `*` nunca casa com uma pasta do
// Drive, mesmo que alguém dê esse nome a uma.
export const CHAVE_AUTOR_PADRAO = '*';

// eslint-disable-next-line no-control-regex
const CONTROLE_RE = /[\u0000-\u001f\u007f]/g;

/**
 * Chave de comparação do nome de uma pasta: sem acento, minúscula, espaços
 * simples e aparados. "  Mag " e "MAG" são a mesma pasta.
 * @param {unknown} nome
 */
export function chavePasta(nome) {
  return String(nome == null ? '' : nome)
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .toLowerCase().replace(/\s+/g, ' ').trim();
}

/**
 * Uma linha do campo: `pasta = Nome` ou `pasta = Nome <email@exemplo.com>`.
 * O e-mail (opcional) é de uso interno — avisar a autora de ocorrências com as
 * fotos dela (v3.1) — e NUNCA sai do servidor para a página pública: não entra
 * na listagem, no HTML, no JSON-LD nem no sitemap. E-mail que não passa na
 * validação é descartado (o nome fica).
 * @param {string} resto o que vem depois do "="
 * @returns {{ nome: string, email: string }}
 */
function nomeEEmail(resto) {
  const limpa = (/** @type {string} */ t) => t.replace(CONTROLE_RE, ' ').replace(/\s+/g, ' ').trim();
  const m = resto.match(/^([^<]*)<([^<>]*)>\s*$/);
  const nome = limpa(m ? m[1] : resto).replace(/[<>]/g, '').trim().slice(0, GALERIA_CREDITOS_NOME_MAX);
  const email = m ? limpa(m[2]).toLowerCase() : '';
  return { nome, email: email && email.length <= GALERIA_CREDITOS_EMAIL_MAX && EMAIL_RE.test(email) ? email : '' };
}

/**
 * Os créditos como o projeto grava: só linhas `pasta = Nome[ <e-mail>]` válidas
 * (chave e nome não vazios, nome até GALERIA_CREDITOS_NOME_MAX, sem caractere
 * de controle), sem chave repetida (vale a primeira), no máximo
 * GALERIA_CREDITOS_MAX_LINHAS. Vazio = "use o padrão" (CREDITOS_PADRAO).
 * @param {unknown} v
 * @returns {string}
 */
export function normalizaCreditos(v) {
  if (typeof v !== 'string') return '';
  /** @type {Map<string, string>} */
  const vistos = new Map();
  for (const linha of v.split(/\r?\n/)) {
    const i = linha.indexOf('=');
    if (i < 1) continue;
    const pasta = linha.slice(0, i).replace(CONTROLE_RE, ' ').replace(/\s+/g, ' ').trim().slice(0, GALERIA_CREDITOS_NOME_MAX);
    const { nome, email } = nomeEEmail(linha.slice(i + 1));
    const k = chavePasta(pasta);
    if (!k || !nome || vistos.has(k)) continue;
    vistos.set(k, `${pasta} = ${nome}${email ? ` <${email}>` : ''}`);
    if (vistos.size >= GALERIA_CREDITOS_MAX_LINHAS) break;
  }
  return [...vistos.values()].join('\n');
}

/**
 * chave da pasta → autor, já com o padrão quando o campo está vazio. Só o
 * NOME (o e-mail fica fora: ver `emailDoAutor`).
 * @param {unknown} v
 * @returns {Map<string, string>}
 */
export function parseCreditos(v) {
  const texto = normalizaCreditos(v) || CREDITOS_PADRAO;
  /** @type {Map<string, string>} */
  const mapa = new Map();
  for (const linha of texto.split('\n')) {
    const i = linha.indexOf(' = ');
    mapa.set(chavePasta(linha.slice(0, i)), nomeEEmail(linha.slice(i + 3)).nome);
  }
  return mapa;
}

/**
 * O e-mail cadastrado para um autor (o primeiro, se o mesmo nome aparece em
 * mais de uma pasta), ou '' — só para o servidor avisar a autora; nunca vai
 * para a página.
 * @param {unknown} creditos o campo do projeto
 * @param {string} autor nome do autor, como na listagem
 * @returns {string}
 */
export function emailDoAutor(creditos, autor) {
  const texto = normalizaCreditos(creditos);
  for (const linha of texto.split('\n')) {
    const i = linha.indexOf(' = ');
    if (i < 0) continue;
    const { nome, email } = nomeEEmail(linha.slice(i + 3));
    if (email && nome === autor) return email;
  }
  return '';
}

/** Hash curto (FNV-1a, base 36) dos créditos efetivos — entra na chave do cache. @param {string} t */
function hashCreditos(t) {
  let h = 0x811c9dc5;
  for (let i = 0; i < t.length; i++) { h ^= t.charCodeAt(i); h = Math.imul(h, 0x01000193) >>> 0; }
  return h.toString(36);
}

/** @param {unknown} v */
const creditosEfetivos = v => normalizaCreditos(v) || CREDITOS_PADRAO;

/**
 * "AAAA:MM:DD HH:MM:SS" (EXIF) → AAAAMMDDHHMMSS como número; 0 se não houver
 * data legível. O Drive não informa fuso: é a hora de parede da câmera.
 * @param {unknown} t
 */
function horaDaFoto(t) {
  if (typeof t !== 'string') return 0;
  const m = t.match(/^(\d{4}):(\d{2}):(\d{2}) (\d{2}):(\d{2}):(\d{2})/);
  if (!m) return 0;
  const [ano, mes, dia, h, mi, se] = m.slice(1).map(Number);
  if (ano < 1900 || mes < 1 || mes > 12 || dia < 1 || dia > 31 || h > 23 || mi > 59 || se > 60) return 0;
  return Number(m.slice(1).join(''));
}

/** @type {Map<string, { em: number, dados: ListagemDrive }>} */
const memoria = new Map();
// A chave leva o TETO de páginas: a galeria (GALERIA_MAX_CHAMADAS) e a pasta do
// Instagram (GALERIA_MAX_CHAMADAS_IG) leem com tetos diferentes, e uma lista
// feita com o teto de 8 páginas, guardada só pelo id da pasta, serviria de
// "completa" a quem pediu 30 (e a de 30 vazaria para quem pediu 8, estourando
// a conta das 50 subrequisições se virasse a base de uma releitura).
// Os créditos também entram na chave: mudar "pasta = Nome" no painel muda o
// que a listagem É (quais pastas viram seção, quem assina cada foto), então a
// lista feita com os créditos antigos não pode servir.
/** @param {string} id @param {number} maxChamadas @param {string} h */
const chaveMemoria = (id, maxChamadas, h) => `${id}#${maxChamadas}#${h}`;
/** @param {string} id @param {number} maxChamadas @param {string} h */
const chaveCache = (id, maxChamadas, h) => `https://fotos.invalid/__galeria/${id}/m${maxChamadas}/c${h}`;

function cacheStore() {
  // Ausente no vitest e fora do runtime Workers — o cache é best-effort.
  return (typeof caches !== 'undefined' && caches && caches.default) || null;
}


// ---------------------------------------------------------------------------
// Leitura resiliente a pico (item 1g)
// ---------------------------------------------------------------------------
// Uma função para as duas leituras (fotos de uma pasta e lista de capítulos):
//  1. memória do isolate fresca -> devolve (0 chamadas);
//  2. `fonte(temVelho)`: Cache API e, sem nada, a foto durável (D1) — pode
//     devolver lista VENCIDA (`fresco: false`), que ainda é servida;
//  3. lista vencida (até GALERIA_VELHO_MAX_S): serve JÁ e, em segundo plano,
//     só quem ganhar o lease relê. O isolate re-pergunta só a cada
//     GALERIA_REVERIFICA_S;
//  4. nenhuma lista: só quem ganha o lease lista (e responde); quem perde
//     espera um pouco pela lista do outro e, se ela não vier, `carregando`;
//  5. `atualizar` (dono, "Atualizar agora"): relê direto, sem lease.
// DENTRO do isolate, a releitura (`voos`) e a decisão de reler (`decisoes`)
// são únicas por chave: 200 requisições no mesmo isolate compartilham uma
// promessa, e só a primeira gasta cache, lease ou Drive.
/** @type {Map<string, Promise<any>>} */
const voos = new Map();
/** @type {Map<string, Promise<any>>} */
const decisoes = new Map();
/** @param {number} ms */
const dorme = ms => new Promise(r => setTimeout(r, ms));

/**
 * @template {{ em: string }} T
 * @param {any} env
 * @param {{ waitUntil?: (p: Promise<any>) => void } | null | undefined} ctx
 * @param {{
 *   kMem: string,
 *   leaseChave: string,
 *   memo: Map<string, { em: number, dados: T }>,
 *   ttlMs: number,
 *   atualizar: boolean,
 *   fonte: (temVelho: boolean) => Promise<{ dados: T, fresco: boolean } | null>,
 *   refaz: (forcar: boolean) => Promise<T>,
 * }} o
 * @returns {Promise<T>}
 */
async function leComRenovacao(env, ctx, { kMem, leaseChave, memo, ttlMs, atualizar, fonte, refaz }) {
  /** @param {boolean} forcar @returns {Promise<T>} */
  const voo = forcar => {
    const em = voos.get(kMem);
    if (em) return em;
    const p = refaz(forcar).finally(() => { if (voos.get(kMem) === p) voos.delete(kMem); });
    voos.set(kMem, p);
    return p;
  };
  if (atualizar) return voo(true);

  const mem = memo.get(kMem);
  if (mem && Date.now() - mem.em < ttlMs) return mem.dados;
  const velhoMem = mem ? mem.dados : null;
  const emCurso = decisoes.get(kMem);
  if (emCurso) return velhoMem || emCurso;

  /** @returns {Promise<T>} */
  const decide = async () => {
    let velho = velhoMem;
    const achada = await fonte(!!velho);
    if (achada) {
      if (achada.fresco) {
        memo.set(kMem, { em: Date.now(), dados: achada.dados });
        return achada.dados;
      }
      if (!velho || Date.parse(achada.dados.em) > Date.parse(velho.em)) velho = achada.dados;
    }
    if (velho && Date.now() - Date.parse(velho.em) <= GALERIA_VELHO_MAX_S * 1000) {
      // Serve a velha e deixa a memória "quase vencida": o isolate pergunta de
      // novo em GALERIA_REVERIFICA_S, não a cada visita.
      memo.set(kMem, { em: Date.now() - ttlMs + GALERIA_REVERIFICA_S * 1000, dados: velho });
      const tarefa = (async () => {
        if (!await tomaLease(env, leaseChave, GALERIA_LEASE_S * 1000)) return;
        try {
          await voo(false);
          await soltaLease(env, leaseChave, GALERIA_LEASE_POS_S * 1000);
        } catch (e) { console.error('galeria: releitura em segundo plano falhou', e); }
      })();
      if (ctx && typeof ctx.waitUntil === 'function') ctx.waitUntil(tarefa); else await tarefa;
      return velho;
    }
    // Nenhuma lista guardada: só o ganhador do lease lista.
    if (await tomaLease(env, leaseChave, GALERIA_LEASE_S * 1000)) {
      try {
        const dados = await voo(false);
        await soltaLease(env, leaseChave, GALERIA_LEASE_POS_S * 1000);
        return dados;
      } catch (e) {
        // Sem lista nenhuma, o erro (chave inválida, pasta privada…) é o que a
        // página precisa mostrar: a folga curta deixa o próximo ver o mesmo
        // erro em segundos, sem 200 tentativas seguidas.
        await soltaLease(env, leaseChave, GALERIA_LEASE_POS_S * 1000);
        throw e;
      }
    }
    for (let i = 0; i < GALERIA_ESPERAS; i++) {
      await dorme(GALERIA_ESPERA_MS);
      const outra = await fonte(false);
      if (outra) {
        memo.set(kMem, { em: Date.now(), dados: outra.dados });
        return outra.dados;
      }
    }
    throw new DriveError('carregando', 'As fotos estão sendo carregadas pela primeira vez. A página tenta de novo sozinha.');
  };
  const p = decide().finally(() => { if (decisoes.get(kMem) === p) decisoes.delete(kMem); });
  decisoes.set(kMem, p);
  return p;
}

/** Só para testes: o cache de módulo vazaria entre casos. */
export function limpaCacheDrive() { memoria.clear(); memoriaCaps.clear(); memoriaResumo.clear(); voos.clear(); decisoes.clear(); }

/**
 * Período da atualização automática, em segundos: um dos GALERIA_PERIODOS_S;
 * qualquer outra coisa cai no padrão (10 min).
 * @param {unknown} v
 */
export function periodoValido(v) {
  const n = Number(v);
  return GALERIA_PERIODOS_S.includes(n) ? n : GALERIA_LISTA_TTL_S;
}

/**
 * Como a lista do Drive deste projeto é renovada (campos do painel
 * "Atualização automática" e "Período").
 * @param {{ galeriaAtualizacaoAuto?: unknown, galeriaPeriodo?: unknown }} event
 * @returns {{ auto: boolean, periodo: number }}
 */
export function politicaDaGaleria(event) {
  return { auto: event.galeriaAtualizacaoAuto !== false, periodo: periodoValido(event.galeriaPeriodo) };
}

/**
 * Política da pasta do Instagram: ela não tem foto durável, então, com a
 * atualização automática desligada, só é relida a cada 24 h (ou no "Atualizar agora").
 * @param {{ galeriaAtualizacaoAuto?: unknown, galeriaPeriodo?: unknown }} event
 */
export function politicaDoInstagram(event) {
  const p = politicaDaGaleria(event);
  return { auto: true, periodo: p.auto ? p.periodo : GALERIA_PERIODOS_S[GALERIA_PERIODOS_S.length - 1] };
}

/**
 * Frase curta da política, para a faixa do dono ("a cada 10 minutos").
 * @param {{ galeriaAtualizacaoAuto?: unknown, galeriaPeriodo?: unknown }} event
 */
export function descreveRenovacao(event) {
  const { auto, periodo } = politicaDaGaleria(event);
  if (!auto) return 'atualização automática desligada: a lista só muda quando você toca em "Atualizar agora"';
  const rotulo = periodo >= 86400 ? '24 horas' : periodo >= 3600 ? `${periodo / 3600} ${periodo === 3600 ? 'hora' : 'horas'}` : `${periodo / 60} minutos`;
  return `a lista se renova sozinha a cada ${rotulo}`;
}

/** @param {{ galeriaAtualizacaoAuto?: unknown, galeriaPeriodo?: unknown, slug?: string, galeriaCreditos?: string }} event @param {number} maxChamadas */
export function opcoesBasicasDaLista(event, maxChamadas) {
  return { creditos: event.galeriaCreditos || '', maxChamadas, snapshot: true, slug: String(event.slug || ''), ...politicaDaGaleria(event) };
}

/**
 * Lê a pasta do projeto: fotos da raiz e de subpastas (cada subpasta vira uma
 * seção), com limites que mantêm uma requisição dentro do plano gratuito.
 *
 * Quando a lista é relida (v3.1):
 *  - atualização automática LIGADA: passou o `periodo` desde a última leitura
 *    (memória do isolate, depois Cache API; a idade vem do próprio `em` da
 *    lista, então mudar o período no painel vale na hora);
 *  - DESLIGADA: nunca sozinha. A página mostra a foto durável (D1) até o dono
 *    pedir `atualizar`. Sem foto ainda, lê uma vez e grava.
 * Com `snapshot`, a lista relida vai para o D1 (só se mudou; o `atualizar`
 * grava sempre).
 * @param {{ GOOGLE_DRIVE_API_KEY?: string, CONSENT_DB?: D1Database }} env
 * @param {{ id: string, resourceKey: string }} pasta
 * @param {{ atualizar?: boolean, maxChamadas?: number, creditos?: string, auto?: boolean, periodo?: number, snapshot?: boolean, slug?: string, ctx?: { waitUntil?: (p: Promise<any>) => void }, aoMudar?: (env: any, anterior: ListagemDrive, nova: ListagemDrive) => Promise<void> }} [opts] `aoMudar`: chamado quando a lista relida difere da foto durável anterior (detecção de fotos sumidas, sumiram.js); `maxChamadas`:
 *   teto de páginas da API nesta pasta (a do Instagram usa um menor, para as
 *   duas listas frias caberem nas 50 subrequisições da invocação); `creditos`:
 *   o campo "Créditos por pasta" do projeto (vazio = padrão)
 * @returns {Promise<ListagemDrive>}
 */
export async function listaPasta(env, pasta, { atualizar = false, maxChamadas = GALERIA_MAX_CHAMADAS, creditos = '', auto = true, periodo = GALERIA_LISTA_TTL_S, snapshot = false, slug = '', aoMudar, ctx } = {}) {
  const chave = (env.GOOGLE_DRIVE_API_KEY || '').trim();
  if (!chave) {
    throw new DriveError('chave-ausente', 'Falta a chave da Drive API (GOOGLE_DRIVE_API_KEY).');
  }
  if (!ID_RE.test(pasta.id)) throw new DriveError('pasta-inacessivel', 'O link do Drive deste projeto não aponta para uma pasta.');

  const efetivos = creditosEfetivos(creditos);
  const h = hashCreditos(efetivos);
  const kMem = chaveMemoria(pasta.id, maxChamadas, h);
  const kCache = chaveCache(pasta.id, maxChamadas, h);
  const congelada = snapshot && !auto;
  const ttlMs = (congelada ? GALERIA_SNAPSHOT_MEM_S : periodo) * 1000;
  const ctxSnap = `m${maxChamadas}#${h}`;

  // O que a última leitura da foto durável viu: o hash (ou null = sem linha),
  // para a gravação não ler de novo. undefined = não leu.
  /** @type {string | null | undefined} */
  let hashLido;
  /** @param {boolean} temVelho @returns {Promise<{ dados: ListagemDrive, fresco: boolean } | null>} */
  const fonte = async temVelho => {
    if (!congelada) {
      const store = cacheStore();
      if (store) {
        try {
          const hit = await store.match(kCache);
          if (hit) {
            const dados = /** @type {ListagemDrive} */ (await hit.json());
            // A idade é a da própria lista: mudar o período no painel vale na hora.
            // v2 (antes dos vídeos, item 1f) é servida vencida: a próxima leitura refaz.
            if (dados && (dados.v === 3 || dados.v === 2)) return { dados, fresco: dados.v === 3 && Date.now() - Date.parse(dados.em) < ttlMs };
          }
        } catch (e) {
          console.error('galeria: leitura do cache falhou', e);
        }
      }
    }
    // A foto durável: com a atualização automática DESLIGADA é a fonte (vale
    // sempre); ligada, é a última lista conhecida, servida vencida enquanto
    // alguém relê. Quem já tem lista na memória não vai ao D1.
    if (snapshot && !temVelho) {
      const foto = await lerSnapshot(env, pasta.id, ctxSnap);
      hashLido = foto ? foto.hash : null;
      if (foto) {
        try {
          const dados = /** @type {ListagemDrive} */ (JSON.parse(foto.dados));
          if (dados && (dados.v === 3 || dados.v === 2)) return { dados, fresco: congelada };
        } catch (e) {
          console.error('galeria: foto da lista ilegível', e);
        }
      }
    }
    return null;
  };

  /** @param {boolean} forcar */
  const refaz = async forcar => {
    const dados = await percorre(chave, pasta, maxChamadas, parseCreditos(efetivos), maxChamadas > GALERIA_MAX_CHAMADAS ? GALERIA_MAX_PASTAS_PAGO : GALERIA_MAX_PASTAS);
    memoria.set(kMem, { em: Date.now(), dados });
    if (snapshot) await gravaSnapshot(env, pasta.id, ctxSnap, dados, {
      forcar: forcar || congelada, slug, antes: hashLido,
      aoMudar: aoMudar ? anterior => aoMudar(env, /** @type {ListagemDrive} */ (anterior), dados) : undefined,
    });
    const store = congelada ? null : cacheStore();
    if (store) {
      try {
        await store.put(kCache, new Response(JSON.stringify(dados), {
          headers: { 'Content-Type': 'application/json', 'Cache-Control': `max-age=${periodo}` },
        }));
      } catch (e) {
        console.error('galeria: escrita do cache falhou', e);
      }
    }
    return dados;
  };

  return leComRenovacao(env, ctx, { kMem, leaseChave: `l:${kMem}`, memo: memoria, ttlMs, atualizar, fonte, refaz });
}

/**
 * O que aconteceu com um arquivo que sumiu da listagem: `files.get` com
 * `trashed,parents`. 404 ou na lixeira = "apagada"; existe fora da lixeira =
 * "movida" (só registra); qualquer outra resposta (limite, 5xx, tempo) =
 * "indefinida" (não conclui nada). Custa UMA subrequisição.
 * Atenção: 404 também é o que a API devolve a um arquivo tirado da pasta
 * compartilhada para um lugar privado — para a galeria, é a mesma coisa:
 * a foto deixou de existir para o público.
 * @param {{ GOOGLE_DRIVE_API_KEY?: string }} env
 * @param {string} id
 * @param {string} [rk] resourceKey do arquivo, se havia
 * @returns {Promise<'apagada' | 'movida' | 'indefinida'>}
 */
export async function consultaArquivo(env, id, rk = '') {
  const chave = (env.GOOGLE_DRIVE_API_KEY || '').trim();
  if (!chave || !ID_RE.test(id)) return 'indefinida';
  const params = new URLSearchParams({ fields: 'trashed,parents', supportsAllDrives: 'true', key: chave });
  /** @type {Record<string, string>} */
  const headers = { Accept: 'application/json' };
  if (rk) headers['X-Goog-Drive-Resource-Keys'] = `${id}/${rk}`;
  try {
    const res = await fetch(`${DRIVE_FILES}/${encodeURIComponent(id)}?${params}`, { headers, signal: AbortSignal.timeout(TIMEOUT_MS) });
    if (res.status === 404) return 'apagada';
    if (!res.ok) return 'indefinida';
    const corpo = /** @type {any} */ (await res.json());
    return corpo && corpo.trashed === true ? 'apagada' : 'movida';
  } catch {
    return 'indefinida';
  }
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
 * @param {Map<string, string>} creditos chave de pasta → autor (parseCreditos)
 * @param {number} [maxPastas]
 * @returns {Promise<ListagemDrive>}
 *
 * Atalho de PASTA (v3.6) é transparente: o conteúdo da pasta de destino entra
 * como se estivesse onde o atalho está — mesma seção, mesmo autor, sem contar
 * profundidade; desde a v3.7.1, as SUBPASTAS do destino também (não viram
 * seções). É assim que um álbum usa fotos que já moram em outra pasta
 * (de outro projeto publicado) sem copiar nem mover nada: um atalho dentro da
 * pasta do fotógrafo. Destino sem acesso público é pulado e contado em `sa`
 * (o dono vê o aviso); a mesma pasta nunca é lida duas vezes (ciclos de
 * atalho). Atalho de ARQUIVO não entra: a listagem não traz as medidas do
 * destino.
 */
export async function percorre(chave, raiz, maxChamadas, creditos, maxPastas = GALERIA_MAX_PASTAS) {
  /** @type {string[]} */
  const aut = [creditos.get(CHAVE_AUTOR_PADRAO) || AUTOR_PADRAO];
  /** @param {string} nome */
  const indiceAutor = nome => {
    const i = aut.indexOf(nome);
    if (i >= 0) return i;
    aut.push(nome);
    return aut.length - 1;
  };
  /** @type {{ id: string, rk: string, caminho: string[], autor: number, atalho?: boolean, origem?: string }[]} */
  const fila = [{ id: raiz.id, rk: raiz.resourceKey, caminho: [], autor: 0 }];
  const vistas = new Set([raiz.id]);
  let semAcesso = 0;
  // Dentro de atalho (v3.7.1): a mesma foto em duas pastas do destino
  // ("Resolução Redes Sociais" e "Resolução Total", uma seleção "!Dia 1" e o
  // "Dia 1") vira UMA, a de mais bytes. Chave (v3.8.0): o mesmo atalho de
  // origem + mesmo autor + seção + nome + a HORA DA CAPTURA. Antes era só
  // seção + nome, e duas fotos diferentes de nome igual (o IMG_1234 do Dia 1 e
  // o do Dia 2, ou um da Mag e um seu) viravam uma só: sumiam fotos. Sem hora
  // de captura, não junta nunca: não arrisca.
  /** @type {Map<string, { secao: SecaoDrive, i: number }>} */
  const porNome = new Map();
  /** @type {Map<string, SecaoDrive>} */
  const secoes = new Map();
  /** @type {Record<string, string>} */
  const rk = {};
  let chamadas = 0, pastas = 1, total = 0, videos = 0, outros = 0, truncada = false;

  percurso:
  while (fila.length) {
    const atual = /** @type {{ id: string, rk: string, caminho: string[], autor: number, atalho?: boolean, origem?: string }} */ (fila.shift());
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
      let pagina;
      try {
        pagina = await chamaDrive(chave, atual, pageToken);
      } catch (e) {
        // Destino de atalho que o Drive não abre (pasta privada, apagada):
        // pula ele, e não a galeria inteira.
        if (!atual.atalho || !(e instanceof DriveError)) throw e;
        semAcesso++;
        continue percurso;
      }
      for (const f of Array.isArray(pagina.files) ? pagina.files : []) {
        if (!f || typeof f.id !== 'string' || !ID_RE.test(f.id)) continue;
        const mime = typeof f.mimeType === 'string' ? f.mimeType : '';
        if (mime === SHORTCUT_MIME) {
          const sd = f.shortcutDetails && typeof f.shortcutDetails === 'object' ? f.shortcutDetails : null;
          const alvo = sd && sd.targetMimeType === FOLDER_MIME && typeof sd.targetId === 'string' && ID_RE.test(sd.targetId) ? sd.targetId : '';
          if (!alvo) { outros++; continue; }
          if (vistas.has(alvo)) continue;
          if (pastas < maxPastas) {
            pastas++;
            vistas.add(alvo);
            const rkAlvo = typeof sd.targetResourceKey === 'string' && /^[A-Za-z0-9_-]{1,200}$/.test(sd.targetResourceKey) ? sd.targetResourceKey : '';
            fila.push({ id: alvo, rk: rkAlvo, caminho: atual.caminho, autor: atual.autor, atalho: true, origem: atual.origem || alvo });
          } else {
            truncada = true;
          }
          continue;
        }
        if (mime === FOLDER_MIME) {
          if (vistas.has(f.id)) continue;
          vistas.add(f.id);
          const rkPasta = typeof f.resourceKey === 'string' ? f.resourceKey : '';
          const chaveDaPasta = chavePasta(f.name);
          const autorDaPasta = chaveDaPasta === CHAVE_AUTOR_PADRAO ? undefined : creditos.get(chaveDaPasta);
          if (autorDaPasta !== undefined) {
            // Pasta de autor: não é seção. Mesmo caminho do pai (não aumenta a
            // profundidade); as fotos dela levam o autor.
            if (pastas < maxPastas) {
              pastas++;
              fila.push({ id: f.id, rk: rkPasta, caminho: atual.caminho, autor: indiceAutor(autorDaPasta) });
            } else {
              truncada = true;
            }
          } else if (atual.atalho && pastas < maxPastas) {
            // Dentro de um atalho tudo é transparente (v3.7.1, pedido do dono):
            // as subpastas do destino não viram seções. As etiquetas do topo
            // seguem as pastas do álbum (o ano, a banda), não as de onde as
            // fotos moram.
            pastas++;
            fila.push({ id: f.id, rk: rkPasta, caminho: atual.caminho, autor: atual.autor, atalho: true, origem: atual.origem });
          } else if (atual.caminho.length < GALERIA_MAX_PROFUNDIDADE && pastas < maxPastas) {
            pastas++;
            fila.push({ id: f.id, rk: rkPasta, caminho: [...atual.caminho, String(f.name || 'Sem nome').slice(0, 120)], autor: atual.autor });
          } else {
            truncada = true;
          }
          continue;
        }
        // Item 1f: tudo o que o Drive vê como imagem (JPEG, HEIC/HEIF, PNG,
        // WEBP, GIF e RAW) e todo vídeo entram na galeria.
        const ehImg = mime.startsWith('image/');
        const ehVid = !ehImg && mime.startsWith('video/');
        if (ehImg || ehVid) {
          const item = ehVid ? videoCompacto(f, atual.autor) : fotoCompacta(f, atual.autor);
          if (atual.atalho) {
            const hora = ehVid ? 0 : Number(item[6]) || 0;
            const k = `${atual.origem || ''}\u0000${atual.autor}\u0000${caminho}\u0000${String(f.name || '').toLowerCase()}\u0000${hora || f.id}`;
            const ja = porNome.get(k);
            if (ja) {
              if ((item[4] || 0) > (ja.secao.fotos[ja.i][4] || 0)) {
                ja.secao.fotos[ja.i] = item;
                if (typeof f.resourceKey === 'string' && f.resourceKey) rk[f.id] = f.resourceKey;
              }
              continue;
            }
            porNome.set(k, { secao, i: secao.fotos.length });
          }
          if (total >= GALERIA_MAX_FOTOS) { truncada = true; continue; }
          total++;
          if (ehVid) videos++;
          secao.fotos.push(item);
          if (typeof f.resourceKey === 'string' && f.resourceKey) rk[f.id] = f.resourceKey;
        } else {
          outros++;
        }
      }
      pageToken = typeof pagina.nextPageToken === 'string' ? pagina.nextPageToken : '';
    } while (pageToken);
  }

  // Live Photo: o .MOV/.MP4 de mesmo nome da foto deixa de ser um item e passa
  // a ser o "vídeo do Live Photo" dela.
  const pareados = pareiaLive(secoes.values());
  total -= pareados;
  videos -= pareados;
  for (const s of secoes.values()) s.fotos.sort(ordemDaSecao(s.fotos));
  // Raiz primeiro, depois as subpastas em ordem natural; seção vazia some (uma
  // pasta só de subpastas não deixa um título solto sem foto embaixo).
  const lista = [...secoes.values()]
    .filter(s => s.fotos.length > 0)
    .sort((a, b) => (a.caminho === '' ? -1 : b.caminho === '' ? 1 : ordemNatural(a.caminho, b.caminho)));

  return { v: 3, pasta: raiz.id, em: new Date().toISOString(), truncada, secoes: lista, total, videos, outros, rk, aut, ch: chamadas, ...(semAcesso ? { sa: semAcesso } : {}) };
}

// Um Live Photo do iPhone é uma foto (.HEIC/.JPG) mais um vídeo de poucos
// segundos (.MOV) com o MESMO nome. Acima disto é um vídeo de verdade que por
// acaso tem o nome de uma foto.
const LIVE_DURACAO_MAX_S = 10;

/** @param {FotoDrive} f é um vídeo (extra numérico)? */
export const ehVideo = f => typeof f[7] === 'number';

/**
 * O vídeo do Live Photo de uma foto, ou null.
 * @param {FotoDrive} f
 * @returns {{ id: string, nome: string, bytes: number } | null}
 */
export function liveDe(f) {
  const l = f[7];
  return Array.isArray(l) ? { id: l[0], nome: l[1], bytes: l[2] } : null;
}

/** A listagem tem ao menos um vídeo (item)? @param {ListagemDrive} dados */
export function temVideo(dados) {
  for (const s of dados.secoes) for (const f of s.fotos) if (typeof f[7] === 'number') return true;
  return false;
}

/**
 * Casa cada vídeo curto com a foto de mesmo nome (sem extensão, sem diferenciar
 * maiúscula), da MESMA seção e do MESMO autor. A foto ganha o vídeo em `extra`
 * e o vídeo sai da seção. Vídeo sem foto de mesmo nome, ou longo, fica como
 * item. Devolve quantos vídeos foram absorvidos.
 * @param {Iterable<SecaoDrive>} secoes
 */
function pareiaLive(secoes) {
  let pareados = 0;
  for (const secao of secoes) {
    /** @type {Map<string, FotoDrive>} */
    const fotos = new Map();
    for (const f of secao.fotos) {
      if (typeof f[7] === 'number') continue;
      const k = `${f[5] || 0}\u0001${chaveDeNome(f[3])}`;
      if (!fotos.has(k)) fotos.set(k, f);
    }
    if (!fotos.size) continue;
    const resto = [];
    for (const f of secao.fotos) {
      if (typeof f[7] === 'number' && f[7] <= LIVE_DURACAO_MAX_S) {
        const par = fotos.get(`${f[5] || 0}\u0001${chaveDeNome(f[3])}`);
        if (par && par[7] == null) {
          par[5] = par[5] || 0;
          par[6] = par[6] || 0;
          par[7] = [f[0], f[3], f[4]];
          pareados++;
          continue;
        }
      }
      resto.push(f);
    }
    secao.fotos = resto;
  }
  return pareados;
}

/**
 * A ordem de uma seção: a de hoje (nome, natural) quando todas as fotos são do
 * mesmo autor; com autores misturados, pela hora da captura — é o que faz as
 * fotos de câmeras diferentes se intercalarem na ordem em que aconteceram — e
 * as sem hora por último, em ordem natural de nome.
 * @param {FotoDrive[]} fotos
 * @returns {(a: FotoDrive, b: FotoDrive) => number}
 */
function ordemDaSecao(fotos) {
  const misturada = fotos.some(f => (f[5] || 0) !== (fotos[0][5] || 0));
  if (!misturada) return (a, b) => ordemNatural(a[3], b[3]);
  return (a, b) => {
    const ha = a[6] || 0, hb = b[6] || 0;
    if (ha && hb && ha !== hb) return ha - hb;
    if (!ha !== !hb) return ha ? -1 : 1;
    return ordemNatural(a[3], b[3]);
  };
}

/**
 * @param {any} f arquivo como a API devolve
 * @param {number} autor índice do autor em `aut`
 * @returns {FotoDrive}
 */
function fotoCompacta(f, autor) {
  const meta = f.imageMediaMetadata && typeof f.imageMediaMetadata === 'object' ? f.imageMediaMetadata : {};
  let w = Number.isInteger(meta.width) && meta.width > 0 ? meta.width : 0;
  let h = Number.isInteger(meta.height) && meta.height > 0 ? meta.height : 0;
  // rotation = quartos de volta da orientação EXIF. O lh3 já entrega a foto
  // girada, então em 90°/270° a largura exibida é a altura armazenada — sem
  // isto a grade reservaria uma caixa deitada para uma foto em pé.
  if (meta.rotation === 1 || meta.rotation === 3) [w, h] = [h, w];
  const bytes = Number.parseInt(String(f.size || '0'), 10);
  /** @type {FotoDrive} */
  const foto = [f.id, w, h, String(f.name || '').slice(0, NOME_MAX), Number.isFinite(bytes) && bytes > 0 ? bytes : 0];
  const hora = horaDaFoto(meta.time);
  const criada = criadaEmMin(f.createdTime);
  if (autor || hora || criada) { foto[5] = autor; if (hora) foto[6] = hora; }
  if (criada) { foto[6] = foto[6] || 0; foto[7] = null; foto[8] = criada; }
  return foto;
}

/**
 * Um vídeo da pasta como item da listagem: [id, l, a, nome, bytes, autor, 0,
 * duração em segundos]. O Drive guarda a largura/altura do vídeo SEM a rotação
 * do aparelho (um vídeo em pé costuma vir deitado): é só a proporção da caixa
 * até a miniatura chegar.
 * @param {any} f arquivo como a API devolve
 * @param {number} autor índice do autor em `aut`
 * @returns {FotoDrive}
 */
function videoCompacto(f, autor) {
  const meta = f.videoMediaMetadata && typeof f.videoMediaMetadata === 'object' ? f.videoMediaMetadata : {};
  const w = Number.isInteger(meta.width) && meta.width > 0 ? meta.width : 0;
  const h = Number.isInteger(meta.height) && meta.height > 0 ? meta.height : 0;
  const ms = Number(meta.durationMillis);
  const dur = Number.isFinite(ms) && ms > 0 ? Math.round(ms / 1000) : 0;
  const bytes = Number.parseInt(String(f.size || '0'), 10);
  /** @type {FotoDrive} */
  const video = [f.id, w, h, String(f.name || '').slice(0, NOME_MAX), Number.isFinite(bytes) && bytes > 0 ? bytes : 0, autor, 0, dur];
  const criada = criadaEmMin(f.createdTime);
  if (criada) video[8] = criada;
  return video;
}

/**
 * `createdTime` do Drive → minutos desde EPOCA_CRIADA_MS, ou 0 quando falta,
 * é inválido ou é mais velho que a janela das "fotos novas" (nunca será nova
 * para quem volta dentro da janela).
 * @param {unknown} t
 */
export function criadaEmMin(t) {
  const ms = typeof t === 'string' ? Date.parse(t) : NaN;
  if (!Number.isFinite(ms)) return 0;
  if (Date.now() - ms > NOVAS_JANELA_DIAS * 86_400_000) return 0;
  const m = Math.floor((ms - EPOCA_CRIADA_MS) / 60_000);
  return m > 0 ? m : 0;
}

/**
 * @param {string} chave
 * @param {{ id: string, rk: string }} pasta
 * @param {string} pageToken
 * @param {boolean} [soPastas] só as subpastas (o índice de capítulos)
 */
async function chamaDrive(chave, pasta, pageToken, soPastas = false) {
  const params = new URLSearchParams({
    q: `'${pasta.id}' in parents and trashed = false${soPastas ? ` and mimeType = '${FOLDER_MIME}'` : ''}`,
    fields: soPastas ? CAMPOS_PASTAS : CAMPOS,
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

/**
 * Procura um ARQUIVO para baixar: o item da listagem OU o vídeo de um Live
 * Photo (que não é item). `foto` é sempre o item dono (é dele que valem
 * ocultar, remoção e capítulo); `arquivo` é o que se entrega.
 * @param {ListagemDrive} dados
 * @param {string} id
 * @returns {{ foto: FotoDrive, arquivo: FotoDrive, live: boolean } | null}
 */
export function achaArquivo(dados, id) {
  for (const s of dados.secoes) {
    for (const f of s.fotos) {
      if (f[0] === id) return { foto: f, arquivo: f, live: false };
      const l = f[7];
      if (Array.isArray(l) && l[0] === id) return { foto: f, arquivo: [l[0], 0, 0, l[1], l[2], f[5] || 0, f[6] || 0], live: true };
    }
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
 * Fotos escondidas A PEDIDO de um visitante e ainda sem decisão do dono
 * (`event.ocultasPendentes`): `{ id, em, pedido }` — a foto, quando saiu da
 * galeria (ISO) e o id do pedido de remoção que a escondeu. Tudo o que a
 * lista aceita já está em `fotosOcultas` (a pendência é uma marca sobre uma
 * foto oculta, não um segundo mecanismo de ocultar): com `ocultas`, entrada
 * de foto que não está oculta é descartada. IDs válidos, sem repetição, data
 * válida (normalizada), pedido hexadecimal ou vazio, no máximo
 * GALERIA_MAX_OCULTAS. Qualquer outra forma vira lista vazia.
 * @param {unknown} v
 * @param {readonly string[]} [ocultas] as fotos ocultas do mesmo evento
 * @returns {{ id: string, em: string, pedido: string }[]}
 */
export function normalizaPendentes(v, ocultas) {
  if (!Array.isArray(v)) return [];
  const permitidas = ocultas ? new Set(ocultas) : null;
  /** @type {Map<string, { id: string, em: string, pedido: string }>} */
  const out = new Map();
  for (const e of v) {
    if (!e || typeof e !== 'object' || Array.isArray(e)) continue;
    const { id, em, pedido } = /** @type {Record<string, unknown>} */ (e);
    if (typeof id !== 'string' || !ID_RE.test(id) || out.has(id)) continue;
    if (permitidas && !permitidas.has(id)) continue;
    const t = typeof em === 'string' ? new Date(em).getTime() : NaN;
    if (!Number.isFinite(t)) continue;
    out.set(id, {
      id,
      em: new Date(t).toISOString(),
      pedido: typeof pedido === 'string' && /^[a-f0-9]{1,64}$/.test(pedido) ? pedido : '',
    });
    if (out.size >= GALERIA_MAX_OCULTAS) break;
  }
  return [...out.values()];
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

// Marca que o fotógrafo costuma pôr no arquivo exportado para o Instagram, no
// fim ou NO MEIO do nome (v3.7.2: o modelo de exportação do dono põe antes do
// número, "Zenite_lowres-07.jpg" para "Zenite-07.jpg",
// "FestaJunina-2026-lowres-12.jpg" para "FestaJunina-2026-12.jpg"): "insta",
// "instagram", "ig", "redes", "lowres" ou "low-res", como palavra separada por
// espaço, ponto, "_" ou "-". Só vale quando NÃO há arquivo de nome igual.
const MARCA_IG = /[\s._-]+(?:instagram|insta|ig|redes|lowres|low[\s._-]res)(?=$|[\s._-])/g;
/** Filtro barato antes da regex: o nome tem alguma das marcas? @param {string} k */
const temMarca = k => k.includes('ig') || k.includes('insta') || k.includes('redes') || k.includes('low');
// Última tentativa (v3.7.2): os modelos de exportação mudam de projeto para
// projeto ("_social-274", "-downsided-23", "_lowres-07"). Vale o arquivo do
// Instagram que tem UMA palavra a mais que o original (palavra = só letras, 2+;
// número nunca sai), com "-", "_", "+", ponto e espaço valendo o mesmo.
const SEPARADORES = /[\s._+-]+/;
const PALAVRA = /^\p{L}{2,}$/u;
/** @param {string} k */
const semSeparadores = k => k.split(SEPARADORES).filter(Boolean).join('-');

/**
 * Candidato da pasta do Instagram, em lista encadeada (na ordem da listagem):
 * um objeto por foto, sem o array por nome que a versão anterior alocava.
 * @typedef {{ caminho: string, foto: FotoDrive, prox: Cand | null }} Cand
 */
/**
 * O índice de nomes de UMA listagem do Instagram, montado uma vez por listagem
 * (não por galeria nem por visita): chave do nome → candidatos.
 * @typedef {{ exato: Map<string, Cand>, semSufixo: Map<string, Cand>, semPalavra: Map<string, Cand> }} IndiceIg
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
  const indice = { exato: new Map(), semSufixo: new Map(), semPalavra: new Map() };
  for (const s of ig.secoes) {
    const caminho = caminhoChave(s.caminho);
    for (const foto of s.fotos) {
      if (typeof foto[7] === 'number') continue; // vídeo da pasta do Instagram não casa com foto
      const k = chaveDeNome(foto[3]);
      poe(indice.exato, k, { caminho, foto, prox: null });
      if (temMarca(k)) {
        const sem = k.replace(MARCA_IG, '');
        if (sem !== k && sem) {
          poe(indice.semSufixo, sem, { caminho, foto, prox: null });
          poe(indice.semPalavra, semSeparadores(sem), { caminho, foto, prox: null });
        }
      }
      const partes = k.split(SEPARADORES).filter(Boolean);
      if (partes.length >= 3) {
        for (let i = 0; i < partes.length; i++) {
          if (!PALAVRA.test(partes[i])) continue;
          poe(indice.semPalavra, [...partes.slice(0, i), ...partes.slice(i + 1)].join('-'), { caminho, foto, prox: null });
        }
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
 * vale o nome do Instagram com uma marca "insta", "ig", "instagram", "redes"
 * ou "lowres" a mais, no fim ou no meio ("Zenite_lowres-07" casa com
 * "Zenite-07", v3.7.2); por último, o com UMA palavra qualquer a mais e os
 * separadores (-, _, +, ponto, espaço) valendo o mesmo ("PiauiFut+2026_social-274"
 * casa com "PiauiFut+2026-274"). Com nomes repetidos em subpastas diferentes, vale o da
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

  const { exato, semSufixo, semPalavra } = indiceDoIg(ig);
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
      if (typeof f[7] === 'number') continue; // vídeo não tem versão "para redes"
      const k = chaveDeNome(f[3]);
      const par = escolhe(exato.get(k), caminho) || escolhe(semSufixo.get(k), caminho)
        || (semPalavra.size ? escolhe(semPalavra.get(semSeparadores(k)), caminho) : null);
      if (par) mapa.set(f[0], par);
    }
  }
  casamentos.set(galeria, { ig, mapa });
  return mapa;
}

/** @param {ListagemDrive} galeria @param {ListagemDrive} ig */
const chaveCasamento = (galeria, ig) =>
  `https://fotos.invalid/__galeria/redes/${galeria.pasta}/${ig.pasta}/${Date.parse(galeria.em) || 0}/${Date.parse(ig.em) || 0}/r2`;
// `/r2` (v3.7.2): a regra de casamento mudou (marca no meio do nome); o que foi
// guardado com a regra antiga não vale mais.

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

// ---------------------------------------------------------------------------
// Galeria por capítulos (v3.1)
// ---------------------------------------------------------------------------
// Com "Galeria por capítulos" ligado no projeto, cada subpasta de PRIMEIRO
// nível da pasta do projeto é uma página (`/galeria/<slug>/<capitulo>`) e a
// raiz vira um índice de cartões. O índice custa UMA página da API (só as
// subpastas); o capítulo é lido com `listaPasta` como se a subpasta fosse a
// raiz. Fotos soltas na raiz não aparecem neste modo (documentado).
//
// Quem aparece nas rotas é o `slug` do capítulo, feito do nome da pasta; o ID
// da pasta nunca vem do navegador — o servidor o acha aqui, na lista que ele
// mesmo leu do Drive.

/**
 * @typedef {{ id: string, rk: string, bruto: string, nome: string, slug: string }} Capitulo
 * @typedef {{ v: 1, pasta: string, em: string, truncada: boolean, caps: Capitulo[] }} CapitulosDrive
 */

// Slugs que colidiriam com rotas da própria galeria.
const SLUGS_RESERVADOS = new Set(['baixar', 'sitemap']);
const ANO_RE = /^(?:19|20)\d{2}(?!\d)/;

/**
 * O nome do capítulo como a página o mostra: sem controle, "_" vira espaço,
 * espaços repetidos somem e o prefixo de ordenação ("01 - ", "2. ") cai — mas
 * ano ("2026 - Formatura") fica. Nome que ficaria vazio volta como estava.
 * @param {unknown} bruto
 */
export function nomeDeCapitulo(bruto) {
  const base = String(bruto == null ? '' : bruto).replace(CONTROLE_RE, ' ').replace(/_+/g, ' ').replace(/\s+/g, ' ').trim();
  const sem = base.replace(/^\d{1,2}\s*[-.)–]\s+/, '').trim();
  return (sem || base || 'Sem nome').slice(0, 80);
}

/** a-z, 0-9 e hífen, sem acento; no máximo 60. @param {string} nome */
export function slugBaseDeCapitulo(nome) {
  const s = nome.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase()
    .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60).replace(/-+$/g, '');
  return s || 'capitulo';
}

/**
 * Anos (nome que começa com 19xx/20xx) do mais novo para o mais velho; depois
 * os demais, em ordem natural. Empate de ano: ordem natural do nome.
 * @param {{ nome: string }} a
 * @param {{ nome: string }} b
 */
export function ordemDeCapitulos(a, b) {
  const ya = ANO_RE.exec(a.nome), yb = ANO_RE.exec(b.nome);
  if (ya && yb) return Number(yb[0]) - Number(ya[0]) || ordemNatural(a.nome, b.nome);
  if (ya) return -1;
  if (yb) return 1;
  return ordemNatural(a.nome, b.nome);
}

/**
 * @param {{ id: string, rk: string, bruto: string }[]} pastas
 * @returns {Capitulo[]}
 */
function montaCapitulos(pastas) {
  const itens = pastas.map(p => ({ ...p, nome: nomeDeCapitulo(p.bruto) })).sort((a, b) => ordemDeCapitulos(a, b) || (a.id < b.id ? -1 : 1));
  const usados = new Set(SLUGS_RESERVADOS);
  return itens.map(p => {
    const base = slugBaseDeCapitulo(p.nome);
    let slug = base;
    if (usados.has(slug)) {
      const curto = p.id.toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 4) || 'x';
      slug = `${base.slice(0, 55)}-${curto}`.replace(/-+/g, '-');
      for (let i = 2; usados.has(slug); i++) slug = `${base.slice(0, 50)}-${curto}-${i}`;
    }
    usados.add(slug);
    return { id: p.id, rk: p.rk, bruto: p.bruto, nome: p.nome, slug };
  });
}

/** @type {Map<string, { em: number, dados: CapitulosDrive }>} */
const memoriaCaps = new Map();
/** @param {string} id */
const chaveCaps = id => `https://fotos.invalid/__galeria/capitulos/${id}/v1`;

/**
 * Os capítulos de um projeto: UMA chamada à API (só as subpastas de primeiro
 * nível), guardada pelo mesmo prazo das listagens (memória + Cache API).
 * @param {{ GOOGLE_DRIVE_API_KEY?: string, CONSENT_DB?: D1Database }} env
 * @param {{ id: string, resourceKey: string }} pasta
 * @param {{ atualizar?: boolean, auto?: boolean, periodo?: number, slug?: string, ctx?: { waitUntil?: (p: Promise<any>) => void } }} [opts] política de renovação (ver listaPasta)
 * @returns {Promise<CapitulosDrive>}
 */
export async function listaCapitulos(env, pasta, { atualizar = false, auto = true, periodo = GALERIA_LISTA_TTL_S, slug = '', ctx } = {}) {
  const chave = (env.GOOGLE_DRIVE_API_KEY || '').trim();
  if (!chave) throw new DriveError('chave-ausente', 'Falta a chave da Drive API (GOOGLE_DRIVE_API_KEY).');
  if (!ID_RE.test(pasta.id)) throw new DriveError('pasta-inacessivel', 'O link do Drive deste projeto não aponta para uma pasta.');
  const congelada = !auto;
  const ttlMs = (congelada ? GALERIA_SNAPSHOT_MEM_S : periodo) * 1000;
  const chaveSnap = `c:${pasta.id}`;

  /** @type {string | null | undefined} */
  let hashLido;
  /** @param {boolean} temVelho @returns {Promise<{ dados: CapitulosDrive, fresco: boolean } | null>} */
  const fonte = async temVelho => {
    if (!congelada) {
      const store = cacheStore();
      if (store) {
        try {
          const hit = await store.match(chaveCaps(pasta.id));
          if (hit) {
            const dados = /** @type {CapitulosDrive} */ (await hit.json());
            if (dados && dados.v === 1 && Array.isArray(dados.caps)) return { dados, fresco: Date.now() - Date.parse(dados.em) < ttlMs };
          }
        } catch (e) {
          console.error('galeria: leitura do cache dos capítulos falhou', e);
        }
      }
    }
    if (!temVelho) {
      const foto = await lerSnapshot(env, chaveSnap, 'v1');
      hashLido = foto ? foto.hash : null;
      if (foto) {
        try {
          const dados = /** @type {CapitulosDrive} */ (JSON.parse(foto.dados));
          if (dados && dados.v === 1 && Array.isArray(dados.caps)) return { dados, fresco: congelada };
        } catch (e) {
          console.error('galeria: foto dos capítulos ilegível', e);
        }
      }
    }
    return null;
  };

  /** @param {boolean} forcar */
  const refaz = async forcar => {
    const pagina = await chamaDrive(chave, { id: pasta.id, rk: pasta.resourceKey }, '', true);
    /** @type {{ id: string, rk: string, bruto: string }[]} */
    const pastas = [];
    for (const f of Array.isArray(pagina.files) ? pagina.files : []) {
      if (!f || typeof f.id !== 'string' || !ID_RE.test(f.id)) continue;
      pastas.push({ id: f.id, rk: typeof f.resourceKey === 'string' ? f.resourceKey : '', bruto: String(f.name || 'Sem nome').slice(0, 120) });
    }
    const truncada = !!pagina.nextPageToken || pastas.length > GALERIA_MAX_CAPITULOS;
    /** @type {CapitulosDrive} */
    const dados = { v: 1, pasta: pasta.id, em: new Date().toISOString(), truncada, caps: montaCapitulos(pastas.slice(0, GALERIA_MAX_CAPITULOS)) };
    memoriaCaps.set(pasta.id, { em: Date.now(), dados });
    await gravaSnapshot(env, chaveSnap, 'v1', dados, { forcar: forcar || congelada, slug, antes: hashLido });
    const store = congelada ? null : cacheStore();
    if (store) {
      try {
        await store.put(chaveCaps(pasta.id), new Response(JSON.stringify(dados), {
          headers: { 'Content-Type': 'application/json', 'Cache-Control': `max-age=${periodo}` },
        }));
      } catch (e) {
        console.error('galeria: escrita do cache dos capítulos falhou', e);
      }
    }
    return dados;
  };

  return leComRenovacao(env, ctx, { kMem: pasta.id, leaseChave: `c:${pasta.id}`, memo: memoriaCaps, ttlMs, atualizar, fonte, refaz });
}

/**
 * @param {CapitulosDrive} dados
 * @param {string} slug
 * @returns {{ cap: Capitulo, anterior: Capitulo | null, proximo: Capitulo | null } | null}
 */
export function achaCapitulo(dados, slug) {
  const i = dados.caps.findIndex(c => c.slug === slug);
  if (i < 0) return null;
  return { cap: dados.caps[i], anterior: dados.caps[i - 1] || null, proximo: dados.caps[i + 1] || null };
}

// O resumo de cada capítulo (quantas fotos, quais as três primeiras) para os
// cartões do índice, SEM ler as listas de todos os capítulos: um mapa pequeno,
// um por projeto, na Cache API (nunca KV). Cada capítulo aberto atualiza o seu
// pedaço quando mudou; capítulo nunca aberto fica sem resumo e o cartão mostra
// um espaço reservado.
/**
 * @typedef {{ n: number, capas: string[], cr?: number[], p?: [number, number], pm?: number, a?: Record<string, number>, z?: number }} ResumoCap
 * `cr`: os instantes (minutos desde EPOCA_CRIADA_MS) das fotos recentes, as mais novas primeiro, até NOVAS_RESUMO_MAX.
 * `p` (v3.3): o primeiro e o último mês das fotos do capítulo, AAAAMM, pelas datas de captura (a linha do tempo da apresentação).
 * `a` (v3.3): quantos itens cada autor tem no capítulo ("Quem fotografou").
 */
const RESUMO_MEM_MS = 6 * 3600 * 1000;
const RESUMO_MEM_PAGO_MS = 60 * 1000;
const RESUMO_CACHE_PAGO_S = 300;
/** @type {Map<string, { em: number, mapa: Record<string, ResumoCap> }>} */
const memoriaResumo = new Map();
/** @param {string} id */
// `/v2` (v3.7.5): as cópias antigas, gravadas para durar 24 h, deixam de valer.
const chaveResumo = id => `https://fotos.invalid/__galeria/resumo/${id}/v2`;
/** @param {string} id */
const chaveResumoKv = id => `resumo:${id}`;

/**
 * @param {string} raizId
 * @param {{ FOTOS?: any }} [env] com o KV, a reserva global (v3.7.3)
 * @returns {Promise<Record<string, ResumoCap>>}
 */
export async function lerResumo(raizId, env = undefined) {
  const mem = memoriaResumo.get(raizId);
  // No Workers Paid o KV é a fonte (v3.7.5): memória e Cache API valem pouco,
  // para um evento que voltou a ter fotos reaparecer para todos em minutos (um
  // resumo velho dizendo "0 fotos" escondia o evento por até 6 h).
  const pago = !!env && planoPago(env);
  if (mem && Date.now() - mem.em < (pago ? RESUMO_MEM_PAGO_MS : RESUMO_MEM_MS)) return mem.mapa;
  const store = cacheStore();
  if (store) {
    try {
      const hit = await store.match(chaveResumo(raizId));
      if (hit) {
        const j = /** @type {any} */ (await hit.json());
        if (j && j.v === 1 && j.mapa && typeof j.mapa === 'object') {
          memoriaResumo.set(raizId, { em: Date.now(), mapa: j.mapa });
          return j.mapa;
        }
      }
    } catch (e) {
      console.error('galeria: leitura do resumo dos capítulos falhou', e);
    }
  }
  // KV (v3.7.3): a Cache API é de cada data center; sem isto, o primeiro
  // visitante de cada lugar via os cartões sem capa e sem data até alguém
  // abrir cada evento ali. Achou no KV: guarda na Cache API deste lugar. Só no
  // Workers Paid: no grátis, a leitura e a escrita a mais estouram as 50
  // subrequisições da página fria de um evento.
  const kv = env && planoPago(env) && env.FOTOS;
  if (kv && typeof kv.get === 'function') {
    try {
      const bruto = await kv.get(chaveResumoKv(raizId), { cacheTtl: 300 });
      const j = bruto ? /** @type {any} */ (JSON.parse(bruto)) : null;
      if (j && j.v === 1 && j.mapa && typeof j.mapa === 'object') {
        memoriaResumo.set(raizId, { em: Date.now(), mapa: j.mapa });
        if (store) {
          try {
            await store.put(chaveResumo(raizId), new Response(bruto, { headers: { 'Content-Type': 'application/json', 'Cache-Control': `max-age=${RESUMO_CACHE_PAGO_S}` } }));
          } catch { /* best-effort */ }
        }
        return j.mapa;
      }
    } catch (e) {
      console.error('galeria: leitura do resumo no KV falhou', e);
    }
  }
  return mem ? mem.mapa : {};
}

/** Por quanto tempo um evento lido vazio fica escondido do visitante. */
export const RESUMO_VAZIO_MS = 6 * 3600_000;

/**
 * O evento está vazio para o visitante? Só com leitura recente dizendo 0
 * fotos (v3.8.2). Antes, um "0" ficava para sempre: o visitante não via o
 * evento, ninguém o abria e o resumo nunca mais era relido (o evento só
 * aparecia para o dono). Passadas 6 h, ele volta a aparecer; quem abrir relê.
 * @param {ResumoCap | undefined} r
 * @param {number} [agora]
 */
export function capVazio(r, agora = Date.now()) {
  return !!r && r.n === 0 && typeof r.z === 'number' && agora - r.z < RESUMO_VAZIO_MS;
}

/**
 * Guarda o resumo de UM capítulo, se mudou. No caso comum (nada mudou, isolate
 * quente) não gasta subrequisição nenhuma.
 * @param {string} raizId
 * @param {string} capId
 * @param {ListagemDrive} listagem a listagem CRUA do capítulo (com as ocultas)
 * @param {{ FOTOS?: any }} [env] com o KV, guarda também lá quando muda (v3.7.3)
 */
export async function registraResumo(raizId, capId, listagem, env = undefined) {
  const capas = [];
  for (const sec of listagem.secoes) {
    for (const f of sec.fotos) { if (capas.length < 3) capas.push(f[0]); }
    if (capas.length >= 3) break;
  }
  /** @type {ResumoCap} */
  const novo = { n: listagem.total, capas };
  // Vazio (v3.8.2): guarda QUANDO foi lido vazio. Lista cortada pelo teto de
  // chamadas antes de achar a primeira foto não conta como vazia.
  if (!listagem.total && !listagem.truncada) novo.z = Date.now();
  /** @type {number[]} */
  const cr = [];
  for (const sec of listagem.secoes) for (const f of sec.fotos) if (f[8]) cr.push(f[8]);
  if (cr.length) novo.cr = cr.sort((a, b) => b - a).slice(0, NOVAS_RESUMO_MAX);
  // O período do capítulo (primeiro e último mês das datas de captura) e a
  // contagem por autor, para a apresentação do álbum (v3.3).
  // v3.8.5: câmera com o relógio errado (uma foto em 2019 num evento de
  // 2025) puxava o evento para o ano errado. Agora o período ignora as 5% de
  // cada ponta e data impossível (antes de 2000 ou no futuro), e `pm` é o mês
  // do MEIO das fotos: o que separa os eventos por ano.
  /** @type {number[]} */
  const meses = [];
  const limite = Number(new Date().toISOString().slice(0, 7).replace('-', '')) + 1;
  /** @type {Record<string, number>} */
  const porAutor = {};
  const autores = Array.isArray(listagem.aut) ? listagem.aut : [];
  for (const sec of listagem.secoes) {
    for (const f of sec.fotos) {
      const hora = Number(f[6]) || 0;
      const m = Math.floor(hora / 1e8);
      if (m >= 200001 && m <= limite) meses.push(m);
      const nome = autores[Number(f[5]) || 0];
      if (typeof nome === 'string' && nome) porAutor[nome] = (porAutor[nome] || 0) + 1;
    }
  }
  if (meses.length) {
    meses.sort((a, b) => a - b);
    const corte = Math.floor(meses.length * 0.05);
    novo.p = [meses[corte], meses[meses.length - 1 - corte]];
    novo.pm = meses[Math.floor(meses.length / 2)];
  }
  if (Object.keys(porAutor).length) novo.a = porAutor;
  const mapa = { ...(await lerResumo(raizId, env)) };
  const velho = mapa[capId];
  if (velho && JSON.stringify(velho) === JSON.stringify(novo)) return;
  mapa[capId] = novo;
  memoriaResumo.set(raizId, { em: Date.now(), mapa });
  const corpo = JSON.stringify({ v: 1, mapa });
  const store = cacheStore();
  if (store) {
    try {
      await store.put(chaveResumo(raizId), new Response(corpo, {
        headers: { 'Content-Type': 'application/json', 'Cache-Control': `max-age=${env && planoPago(env) ? RESUMO_CACHE_PAGO_S : 86400}` },
      }));
    } catch (e) {
      console.error('galeria: escrita do resumo dos capítulos falhou', e);
    }
  }
  // Só quando mudou (raro): poucas escritas no KV. Só no Workers Paid.
  const kv = env && planoPago(env) && env.FOTOS;
  if (kv && typeof kv.put === 'function') {
    try { await kv.put(chaveResumoKv(raizId), corpo); } catch (e) { console.error('galeria: escrita do resumo no KV falhou', e); }
  }
}

/** @type {WeakMap<ListagemDrive, { nome: string, saida: ListagemDrive }>} */
const comPrefixo = new WeakMap();
/**
 * A listagem de um capítulo com o NOME DA PASTA do capítulo na frente do
 * caminho de cada seção — só para o casamento "para redes": a pasta do
 * Instagram é lida inteira (uma vez, compartilhada por todos os capítulos), e
 * os caminhos dela começam pela pasta do capítulo. Casar pelo mesmo caminho é o
 * que faz "IMG_0001" de um capítulo não pegar o "IMG_0001" de outro. A mesma
 * lista de saída por listagem (o casamento guardado depende da identidade).
 * @param {ListagemDrive} listagem
 * @param {string} nomeBruto
 * @returns {ListagemDrive}
 */
export function comPrefixoDeCapitulo(listagem, nomeBruto) {
  const guardado = comPrefixo.get(listagem);
  if (guardado && guardado.nome === nomeBruto) return guardado.saida;
  const saida = { ...listagem, secoes: listagem.secoes.map(s => ({ ...s, caminho: s.caminho ? `${nomeBruto} / ${s.caminho}` : nomeBruto })) };
  comPrefixo.set(listagem, { nome: nomeBruto, saida });
  return saida;
}

/** Só para testes. */
export function limpaCacheCapitulos() { memoriaCaps.clear(); memoriaResumo.clear(); }

/**
 * O Worker está no Workers Paid? (`WORKERS_PLANO = "pago"` no wrangler.toml,
 * ligado só depois de assinar — ver GALERIA_MAX_CHAMADAS_PAGO.)
 * @param {Record<string, any>} env
 */
export function planoPago(env) {
  return !!env && String(env.WORKERS_PLANO || '').trim().toLowerCase() === 'pago';
}

/**
 * Onde ler: a pasta do projeto (galeria comum) ou a subpasta do capítulo. UMA
 * função para a página, o download, o pedido de remoção, o sitemap e o aviso ao
 * autor — nenhum deles confia num ID de pasta que veio do navegador.
 *  - `ok`:   `pasta` é o que listar (null no ÍNDICE do modo capítulos), `caps` a
 *            lista de capítulos (null no modo comum) e `capitulo` o escolhido;
 *  - `nao`:  capítulo que não existe (ou `capSlug` num projeto sem capítulos): 404;
 *  - `erro`: o Drive falhou; `codigo`/`mensagem` como em DriveError.
 * @param {{ GOOGLE_DRIVE_API_KEY?: string }} env
 * @param {Record<string, any>} event
 * @param {string} [capSlug]
 * @param {boolean} [atualizar]
 * @param {{ waitUntil?: (p: Promise<any>) => void }} [ctx] o contexto da invocação (releitura em segundo plano)
 * @returns {Promise<
 *   { kind: 'ok', raiz: { id: string, resourceKey: string }, pasta: { id: string, resourceKey: string } | null, caps: CapitulosDrive | null, capitulo: Capitulo | null, anterior: Capitulo | null, proximo: Capitulo | null, maxChamadas: number }
 *   | { kind: 'nao' }
 *   | { kind: 'erro', codigo: string, mensagem: string }>}
 */
export async function alvoDaGaleria(env, event, capSlug = '', atualizar = false, ctx = undefined) {
  const pago = planoPago(env);
  const tetoRaiz = pago ? GALERIA_MAX_CHAMADAS_PAGO : GALERIA_MAX_CHAMADAS;
  const tetoCap = pago ? GALERIA_MAX_CHAMADAS_CAP_PAGO : GALERIA_MAX_CHAMADAS_CAP;
  const raiz = pastaDoDrive(event.driveUrl);
  if (!raiz) return { kind: 'erro', codigo: 'sem-pasta', mensagem: 'O link do Drive cadastrado não é o de uma pasta.' };
  if (!event.galeriaCapitulos) {
    if (capSlug) return { kind: 'nao' };
    return { kind: 'ok', raiz, pasta: raiz, caps: null, capitulo: null, anterior: null, proximo: null, maxChamadas: tetoRaiz };
  }
  let caps;
  try {
    caps = await listaCapitulos(env, raiz, { atualizar, ctx, slug: String(event.slug || ''), ...politicaDaGaleria(event) });
  } catch (e) {
    if (!(e instanceof DriveError)) throw e;
    return { kind: 'erro', codigo: e.codigo, mensagem: e.message };
  }
  if (!capSlug) return { kind: 'ok', raiz, pasta: null, caps, capitulo: null, anterior: null, proximo: null, maxChamadas: tetoCap };
  const ach = achaCapitulo(caps, capSlug);
  if (!ach) return { kind: 'nao' };
  return {
    kind: 'ok', raiz, pasta: { id: ach.cap.id, resourceKey: ach.cap.rk }, caps,
    capitulo: ach.cap, anterior: ach.anterior, proximo: ach.proximo, maxChamadas: tetoCap,
  };
}

// ---------------------------------------------------------------------------
// Pastas de envio ("Mandar suas fotos", v3.4)
// ---------------------------------------------------------------------------
// Numa pasta colaborativa trancada para leitura, a turma só envia nas pastas
// abertas — no álbum da turma, "!turma 2026 (adicione suas fotos aqui)" dentro
// de cada evento (e de cada ano/banda). A regra: pasta de envio é a de crédito
// cujo nome começa com "!" (o "!" também a põe no topo da lista do Drive).
// O site acha essas pastas para levar a pessoa direto à certa.

/**
 * As chaves (chavePasta) das pastas de envio nos créditos: as que começam com "!".
 * @param {unknown} creditos
 * @returns {Set<string>}
 */
export function chavesDeEnvio(creditos) {
  const out = new Set();
  for (const linha of normalizaCreditos(creditos).split('\n')) {
    const i = linha.indexOf(' = ');
    if (i < 1) continue;
    const k = chavePasta(linha.slice(0, i));
    if (k.startsWith('!')) out.add(k);
  }
  return out;
}

/** "03 - Banda X" → "Banda X": o número de ordem no começo do nome não vai para a tela. @param {string} nome */
function semOrdem(nome) {
  return String(nome || '').replace(/^\s*\d{1,3}\s*[-–.)_]?\s+(?=\S)/, '').trim().slice(0, 80);
}

/**
 * @typedef {{ evento: string, cap: string, rotulo: string, id: string, rk: string }} PastaDeEnvio
 */

/** @type {Map<string, { ate: number, dados: PastaDeEnvio[] }>} */
const memoriaEnvio = new Map();
// 30 min (v3.8.0; era 6 h): uma pasta de envio nova dentro de um evento
// aparece logo. Um evento NOVO muda a assinatura (ver abaixo) e é lido na hora.
const ENVIO_TTL_S = 30 * 60;
/** @param {string} raiz @param {string} assinatura */
const chaveEnvio = (raiz, assinatura) => `https://fotos.invalid/__galeria/envio/${raiz}/${assinatura}/v1`;

// Teto de chamadas ao Drive numa leitura das pastas de envio: o plano grátis
// dá 50 subrequisições por pedido, e a rota ainda lê a lista de capítulos.
const ENVIO_MAX_CHAMADAS = 40;
// Leitura que bateu no teto (ou com capítulo que falhou) fica pouco tempo: a
// próxima visita tenta completar.
const ENVIO_TTL_INCOMPLETO_S = 600;

/**
 * As pastas de envio de um álbum por capítulos: para cada capítulo, a pasta de
 * envio direto nele e/ou dentro de cada subpasta de primeiro nível (ano, banda).
 * As pastas de fotógrafo (as outras chaves dos créditos: chala, mag...) não são
 * abertas — só as que podem ser ano ou banda. Só pastas (1 chamada por
 * capítulo e por subpasta, até ENVIO_MAX_CHAMADAS); guardado 6 h na memória do
 * isolate e na Cache API — a estrutura quase nunca muda.
 * @param {import('./utils.js').Env} env
 * @param {CapitulosDrive} caps
 * @param {unknown} creditos o campo de créditos do projeto
 * @returns {Promise<PastaDeEnvio[]>}
 */
export async function pastasDeEnvio(env, caps, creditos) {
  const chaves = chavesDeEnvio(creditos);
  if (!chaves.size || !caps || !Array.isArray(caps.caps) || !caps.caps.length) return [];
  const chave = (env.GOOGLE_DRIVE_API_KEY || '').trim();
  if (!chave) return [];
  // Pastas de fotógrafo: nunca têm ano ou banda dentro, não vale abrir.
  const fotografos = new Set([...parseCreditos(creditos).keys()].filter(k => k !== '*' && !chaves.has(k)));
  // A chave do cache muda quando muda a lista de capítulos (evento novo entra
  // na hora, sem esperar as 6 h) ou as pastas nos créditos.
  const assinatura = hashCreditos([...chaves].sort().join('|') + '/' + [...fotografos].sort().join('|') + '#' + caps.caps.map(c => c.id).join(','));
  const kMem = `${caps.pasta}:${assinatura}`;
  const mem = memoriaEnvio.get(kMem);
  if (mem && Date.now() < mem.ate) return mem.dados;
  const store = cacheStore();
  if (store) {
    try {
      const hit = await store.match(chaveEnvio(caps.pasta, assinatura));
      if (hit) {
        const dados = /** @type {PastaDeEnvio[]} */ (await hit.json());
        if (Array.isArray(dados)) { memoriaEnvio.set(kMem, { ate: Date.now() + ENVIO_TTL_INCOMPLETO_S * 1000, dados }); return dados; }
      }
    } catch (e) {
      console.error('galeria: leitura do cache das pastas de envio falhou', e);
    }
  }
  // KV (v3.7.2): a Cache API é de cada data center, então a primeira pessoa de
  // cada lugar esperava o Drive inteiro. No KV a lista vale para todos.
  const kKv = `envio:${caps.pasta}:${assinatura}`;
  const kv = /** @type {any} */ (env).FOTOS;
  if (kv && typeof kv.get === 'function') {
    try {
      const bruto = await kv.get(kKv, { cacheTtl: 300 });
      const dados = bruto ? /** @type {PastaDeEnvio[]} */ (JSON.parse(bruto)) : null;
      if (Array.isArray(dados)) { memoriaEnvio.set(kMem, { ate: Date.now() + ENVIO_TTL_INCOMPLETO_S * 1000, dados }); return dados; }
    } catch (e) {
      console.error('galeria: leitura das pastas de envio no KV falhou', e);
    }
  }
  let chamadas = 0;
  let completo = true;
  const teto = planoPago(env) ? ENVIO_MAX_CHAMADAS_PAGO : ENVIO_MAX_CHAMADAS;
  /** @param {{ id: string, rk: string }} p @returns {Promise<{ id: string, rk: string, nome: string }[] | null>} */
  const filhas = async p => {
    if (chamadas >= teto) { completo = false; return null; }
    chamadas++;
    try {
      const pagina = await chamaDrive(chave, p, '', true);
      return (Array.isArray(pagina.files) ? pagina.files : [])
        .filter((/** @type {any} */ f) => f && typeof f.id === 'string' && ID_RE.test(f.id))
        .map((/** @type {any} */ f) => ({ id: f.id, rk: typeof f.resourceKey === 'string' ? f.resourceKey : '', nome: String(f.name || '') }));
    } catch {
      completo = false;
      return null;
    }
  };
  /** @type {PastaDeEnvio[]} */
  const dados = [];
  // Em sequência, de propósito: o teto de subrequisições do plano grátis é 50,
  // e um capítulo que falha não derruba os outros.
  for (const c of caps.caps.slice(0, 30)) {
    const nivel1 = await filhas({ id: c.id, rk: c.rk });
    if (!nivel1) continue;
    const direto = nivel1.find(f => chaves.has(chavePasta(f.nome)));
    if (direto) dados.push({ evento: c.nome, cap: c.slug, rotulo: '', id: direto.id, rk: direto.rk });
    for (const sub of nivel1) {
      if (sub === direto || fotografos.has(chavePasta(sub.nome)) || dados.length >= 120) continue;
      const nivel2 = await filhas(sub);
      if (!nivel2) continue;
      const achou = nivel2.find(f => chaves.has(chavePasta(f.nome)));
      if (achou) dados.push({ evento: c.nome, cap: c.slug, rotulo: semOrdem(sub.nome), id: achou.id, rk: achou.rk });
    }
  }
  const ttl = completo ? ENVIO_TTL_S : ENVIO_TTL_INCOMPLETO_S;
  memoriaEnvio.set(kMem, { ate: Date.now() + ttl * 1000, dados });
  if (store) {
    try {
      await store.put(chaveEnvio(caps.pasta, assinatura), new Response(JSON.stringify(dados), {
        headers: { 'Content-Type': 'application/json', 'Cache-Control': `max-age=${ttl}` },
      }));
    } catch (e) {
      console.error('galeria: escrita do cache das pastas de envio falhou', e);
    }
  }
  if (kv && typeof kv.put === 'function') {
    try { await kv.put(kKv, JSON.stringify(dados), { expirationTtl: Math.max(60, ttl) }); } catch (e) { console.error('galeria: escrita das pastas de envio no KV falhou', e); }
  }
  return dados;
}

/** Só para os testes: esquece as pastas de envio guardadas no isolate. */
export function limpaCacheEnvio() {
  memoriaEnvio.clear();
}
