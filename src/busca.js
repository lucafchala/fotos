// Busca nas fotos (v3.7): por TEXTO que aparece na foto (número da camisa,
// faixa, placa) e por COISAS e cenas (palco, bolo, violão), mais a MODERAÇÃO
// automática. Tudo vem da Amazon Rekognition, uma vez por foto, no indexador
// (scripts/rosto-indexa.mjs, GitHub Actions): DetectText, DetectLabels e
// DetectModerationLabels. O resultado chega ao site pelo POST
// /api/busca/indexar (com o token do indexador) e fica na tabela `busca_foto`
// do D1. A busca em si (GET /api/busca) é só uma consulta ao D1: não chama a
// Amazon e não custa nada por visita.
//
// O que é guardado por foto: as palavras lidas (normalizadas), as "coisas" (em
// português e em inglês, normalizadas) e os rótulos de moderação. Nenhum rosto,
// nenhuma imagem, nenhum dado de visitante. Ver docs/ROSTO.md e o RIPD.

import { BUSCA_MAX_RESULTADOS, BUSCA_TEXTO_CONFIANCA_MIN, BUSCA_COISA_CONFIANCA_MIN, BUSCA_MODERACAO_CONFIANCA_MIN, BUSCA_MODERACAO_ESCONDE } from './config.js';

const ID_RE = /^[A-Za-z0-9_-]{10,200}$/;
const CAP_RE = /^[a-z0-9][a-z0-9-]{0,80}$/;

/**
 * Minúsculo, sem acento, só letras e números separados por um espaço.
 * @param {unknown} t
 */
export function normaliza(t) {
  return String(t == null ? '' : t).normalize('NFD').replace(/[̀-ͯ]/g, '')
    .toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
}

// "Coisas" que a Rekognition devolve em inglês, com o nome que a turma
// procuraria. Fica a palavra em inglês também (quem buscar "stage" acha).
// Lista pensada para eventos de escola; o que não está aqui entra só em inglês.
/** @type {Readonly<Record<string, string>>} */
export const ROTULOS_PT = Object.freeze({
  'Stage': 'palco', 'Concert': 'show', 'Crowd': 'plateia multidao', 'Audience': 'plateia', 'Dance Pose': 'danca', 'Dancing': 'danca',
  'Guitar': 'violao guitarra', 'Bass Guitar': 'baixo', 'Electric Guitar': 'guitarra', 'Drum': 'bateria tambor', 'Microphone': 'microfone',
  'Musical Instrument': 'instrumento', 'Music': 'musica', 'Singing': 'cantando', 'Musician': 'musico banda', 'Piano': 'piano', 'Keyboard': 'teclado',
  'Cake': 'bolo comida', 'Birthday Cake': 'bolo aniversario comida', 'Food': 'comida', 'Dessert': 'doce sobremesa comida', 'Candy': 'doce bala comida', 'Popcorn': 'pipoca comida',
  'Corn': 'milho comida', 'Beverage': 'bebida', 'Pizza': 'pizza comida', 'Ice Cream': 'sorvete comida', 'Bonfire': 'fogueira', 'Fire': 'fogo fogueira',
  'Ball': 'bola jogo', 'Soccer Ball': 'bola futebol jogo', 'Football': 'futebol bola jogo', 'Soccer': 'futebol jogo', 'Basketball': 'basquete jogo', 'Volleyball': 'volei jogo',
  'Sport': 'esporte jogo', 'Game': 'jogo', 'Board Game': 'jogo tabuleiro', 'Meal': 'comida refeicao', 'Snack': 'lanche comida', 'Fruit': 'fruta comida', 'Lunch': 'almoco comida', 'Dinner': 'jantar comida', 'Bread': 'pao comida', 'Sandwich': 'lanche sanduiche comida', 'Team': 'time', 'Field': 'campo', 'Stadium': 'estadio', 'Running': 'correndo', 'Trophy': 'trofeu', 'Medal': 'medalha',
  'Costume': 'fantasia', 'Clown': 'palhaco', 'Mask': 'mascara', 'Hat': 'chapeu', 'Sun Hat': 'chapeu', 'Cowboy Hat': 'chapeu', 'Wig': 'peruca',
  'Dress': 'vestido', 'Suit': 'terno', 'Tie': 'gravata', 'Formal Wear': 'traje gala', 'Gown': 'vestido longo', 'Uniform': 'uniforme',
  'Jersey': 'camisa camiseta', 'Shirt': 'camisa', 'T-Shirt': 'camiseta', 'Glasses': 'oculos', 'Sunglasses': 'oculos escuros',
  'Flag': 'bandeira', 'Banner': 'faixa', 'Balloon': 'balao bexiga', 'Confetti': 'confete', 'Decoration': 'decoracao', 'Lantern': 'lanterna balao',
  'Flower': 'flor', 'Flower Bouquet': 'buque flores', 'Tree': 'arvore', 'Plant': 'planta', 'Grass': 'grama', 'Beach': 'praia', 'Pool': 'piscina',
  'Swimming Pool': 'piscina', 'Sky': 'ceu', 'Night': 'noite', 'Sunset': 'por do sol', 'Light': 'luz', 'Spotlight': 'holofote luz', 'Fireworks': 'fogos',
  'Classroom': 'sala de aula', 'School': 'escola', 'Graduation': 'formatura', 'Diploma': 'diploma', 'Book': 'livro', 'Blackboard': 'lousa quadro',
  'Laughing': 'rindo', 'Smile': 'sorriso', 'Hug': 'abraco', 'Selfie': 'selfie', 'Group Photo': 'foto em grupo', 'Party': 'festa', 'Celebration': 'festa',
  'Theater': 'teatro', 'Performer': 'apresentacao artista', 'Film': 'filme', 'Camera': 'camera', 'Video Camera': 'filmadora', 'Projector': 'projetor',
  'Screen': 'tela', 'Car': 'carro', 'Bus': 'onibus', 'Bicycle': 'bicicleta', 'Dog': 'cachorro', 'Cat': 'gato', 'Animal': 'animal', 'Bird': 'passaro',
  'Gym': 'ginasio', 'Court': 'quadra', 'Indoors': 'dentro', 'Outdoors': 'ao ar livre', 'Night Life': 'balada', 'Accessories': 'acessorios',
});

// Rótulos que estão em quase toda foto de gente: não ajudam a achar nada.
const ROTULOS_IGNORADOS = new Set(['person', 'people', 'human', 'adult', 'male', 'female', 'man', 'woman', 'boy', 'girl', 'child', 'teen',
  'face', 'head', 'body part', 'finger', 'hand', 'arm', 'portrait', 'photography', 'clothing', 'apparel', 'happy', 'blonde', 'hair']);

/**
 * O que guardar de uma foto, a partir das três respostas da Rekognition.
 * @param {{ texto?: any, rotulos?: any, moderacao?: any }} r
 * @returns {{ texto: string, coisas: string, moderacao: string }}
 */
export function descreveFoto({ texto, rotulos, moderacao } = {}) {
  /** @type {Set<string>} */
  const palavras = new Set();
  for (const d of (texto && Array.isArray(texto.TextDetections) ? texto.TextDetections : [])) {
    if (!d || d.Type !== 'WORD' || !(Number(d.Confidence) >= BUSCA_TEXTO_CONFIANCA_MIN)) continue;
    for (const p of normaliza(d.DetectedText).split(' ')) if (p && p.length <= 30) palavras.add(p);
    if (palavras.size >= 80) break;
  }
  /** @type {Set<string>} */
  const coisas = new Set();
  for (const l of (rotulos && Array.isArray(rotulos.Labels) ? rotulos.Labels : [])) {
    if (!l || typeof l.Name !== 'string' || !(Number(l.Confidence) >= BUSCA_COISA_CONFIANCA_MIN)) continue;
    const en = normaliza(l.Name);
    if (!en || ROTULOS_IGNORADOS.has(en)) continue;
    coisas.add(en);
    const pt = ROTULOS_PT[l.Name];
    if (pt) for (const p of normaliza(pt).split(' ')) if (p) coisas.add(p);
    if (coisas.size >= 80) break;
  }
  /** @type {Set<string>} */
  const mod = new Set();
  for (const m of (moderacao && Array.isArray(moderacao.ModerationLabels) ? moderacao.ModerationLabels : [])) {
    if (!m || typeof m.Name !== 'string' || !(Number(m.Confidence) >= BUSCA_MODERACAO_CONFIANCA_MIN)) continue;
    // A categoria de cima (ParentName vazio = já é a de cima) é o que decide.
    const topo = typeof m.ParentName === 'string' && m.ParentName ? m.ParentName : m.Name;
    if (BUSCA_MODERACAO_ESCONDE.includes(topo)) mod.add(m.Name.slice(0, 60));
  }
  return { texto: [...palavras].join(' '), coisas: [...coisas].join(' '), moderacao: [...mod].join(', ') };
}

/**
 * Os termos de uma busca: até 5 palavras normalizadas (uma palavra pode ser
 * um número de camisa, "7").
 * @param {unknown} q
 */
export function termosDaBusca(q) {
  return [...new Set(normaliza(String(q || '').slice(0, 120)).split(' ').filter(Boolean))].slice(0, 5);
}

/**
 * Um item enviado pelo indexador, conferido (vem de fora do Worker).
 * @param {any} it
 * @returns {{ foto: string, cap: string, autor: string, texto: string, coisas: string, moderacao: string } | null}
 */
export function itemDaBusca(it) {
  if (!it || typeof it !== 'object') return null;
  if (typeof it.foto !== 'string' || !ID_RE.test(it.foto)) return null;
  const cap = typeof it.cap === 'string' && (it.cap === '' || CAP_RE.test(it.cap)) ? it.cap : null;
  if (cap === null) return null;
  const limpo = (/** @type {unknown} */ v, /** @type {number} */ max) => normaliza(v).slice(0, max);
  const moderacao = typeof it.moderacao === 'string' ? it.moderacao.replace(/[^\p{L}\p{N} ,&/-]/gu, '').slice(0, 300) : '';
  const autor = typeof it.autor === 'string' ? it.autor.replace(/\p{Cc}/gu, '').trim().slice(0, 80) : '';
  return { foto: it.foto, cap, autor, texto: limpo(it.texto, 1500), coisas: limpo(it.coisas, 1500), moderacao };
}

/**
 * Apaga a busca de um projeto inteiro (o projeto foi apagado).
 * @param {{ CONSENT_DB?: D1Database }} env
 * @param {string} slug
 */
export async function apagaBuscaDoProjeto(env, slug) {
  if (!env.CONSENT_DB) return;
  try { await env.CONSENT_DB.prepare('DELETE FROM busca_foto WHERE slug = ?').bind(slug).run(); } catch (e) { console.error('busca: não apagou o projeto', e); }
}

/**
 * As fotos do álbum com TODOS os termos (no texto ou nas coisas), sem as
 * ocultas. Uma consulta ao D1, com palavra inteira (" 10 " não acha "100").
 * @param {D1Database} db
 * @param {string} slug
 * @param {string[]} termos
 * @param {Set<string>} ocultas
 * @returns {Promise<{ cap: string, id: string }[]>}
 */
export async function buscaNasFotos(db, slug, termos, ocultas) {
  if (!termos.length) return [];
  const cond = termos.map(() => "(' ' || texto || ' ' || coisas || ' ') LIKE ?").join(' AND ');
  const r = await db.prepare(`SELECT foto, cap FROM busca_foto WHERE slug = ? AND ${cond} LIMIT ?`)
    .bind(slug, ...termos.map(t => `% ${t} %`), BUSCA_MAX_RESULTADOS + ocultas.size)
    .all();
  /** @type {{ cap: string, id: string }[]} */
  const out = [];
  for (const row of /** @type {any[]} */ (r.results || [])) {
    if (ocultas.has(row.foto)) continue;
    out.push({ cap: String(row.cap || ''), id: String(row.foto) });
    if (out.length >= BUSCA_MAX_RESULTADOS) break;
  }
  return out;
}

// ---------------------------------------------------------------------------
// O estado do indexador (v3.8.8)
// ---------------------------------------------------------------------------
// O indexador (scripts/rosto-indexa.mjs, GitHub Actions) precisa lembrar, de
// uma execução para a outra, quais fotos já processou: as que têm rosto a
// Rekognition lista, mas as SEM rosto não ficam em lugar nenhum, e sem essa
// memória cada execução (a cada 10 min) pagaria de novo por elas.
//
// Até a 3.8.7 essa memória era um arquivo no cache do GitHub Actions. O
// repositório é público, e um cache do Actions pode ser restaurado pelo
// workflow de um pull request vindo de um fork: o arquivo tinha o ID de toda
// foto do álbum, inclusive antes do lançamento. Agora mora aqui, no KV
// (`rosto-estado:<slug>`), e só entra e sai com o token do indexador
// (GET e POST /api/busca/estado).
//
// Sem estado guardado (a primeira execução depois desta versão, ou a chave
// perdida), a resposta é montada do que o D1 já sabe: toda foto com linha em
// `busca_foto` passou pelo indexador. Assim a troca não reprocessa o álbum.
const ESTADO_MAX_ITENS = 20000;
const VISTA_RE = /^(?:[a-z0-9][a-z0-9-]{0,80})?:[A-Za-z0-9_-]{10,200}$/;
const QUALIDADE_RE = /^[A-Z]{2,12}$/;

/** @param {string} slug */
const chaveDoEstado = slug => `rosto-estado:${slug}`;

/**
 * @typedef {{ vistas: string[], descritas: string[], qualidade: string, geracao: number, limpar: boolean, dia: string, noDia: number, quentes: string[] }} EstadoDoIndexador
 *   `quentes`: fotos cujas miniaturas já estão no R2 (v3.8.11);
 *   `dia`/`noDia`: quantas fotos o indexador já processou no dia (UTC), para o
 *   teto ROSTO_FOTOS_POR_DIA;
 *   `geracao`: o último pedido do dono para refazer o índice que o
 *   indexador já atendeu; `limpar`: indexou rostos e ainda não limpou os de quem saiu
 *   (v3.8.9, ver src/rosto.js)
 */

/** @param {unknown} v */
const inteiro = v => (typeof v === 'number' && Number.isFinite(v) && v > 0 ? Math.min(Math.floor(v), 1e9) : 0);

/**
 * Só o que tem a forma esperada, sem repetição e até o teto.
 * @param {unknown} v
 * @returns {EstadoDoIndexador}
 */
export function estadoDoIndexadorLimpo(v) {
  const o = v && typeof v === 'object' && !Array.isArray(v) ? /** @type {Record<string, unknown>} */ (v) : {};
  /** @param {unknown} lista @param {RegExp} re */
  const limpa = (lista, re) => [...new Set((Array.isArray(lista) ? lista : []).filter(x => typeof x === 'string' && re.test(x)))].slice(0, ESTADO_MAX_ITENS);
  return {
    vistas: limpa(o.vistas, VISTA_RE),
    descritas: limpa(o.descritas, ID_RE),
    qualidade: typeof o.qualidade === 'string' && QUALIDADE_RE.test(o.qualidade) ? o.qualidade : '',
    geracao: inteiro(o.geracao),
    limpar: o.limpar === true,
    dia: typeof o.dia === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(o.dia) ? o.dia : '',
    noDia: inteiro(o.noDia),
    quentes: limpa(o.quentes, ID_RE),
  };
}

/**
 * O estado guardado; sem ele, o que o D1 sabe (`origem: 'banco'`).
 * @param {{ FOTOS: any, CONSENT_DB?: any }} env
 * @param {string} slug
 * @returns {Promise<EstadoDoIndexador & { origem: 'guardado' | 'banco' | 'vazio' }>}
 */
export async function leEstadoDoIndexador(env, slug) {
  const bruto = await env.FOTOS.get(chaveDoEstado(slug));
  if (bruto) {
    try { return { ...estadoDoIndexadorLimpo(JSON.parse(bruto)), origem: 'guardado' }; } catch { /* ilegível: cai para o banco */ }
  }
  if (env.CONSENT_DB) {
    const r = await env.CONSENT_DB.prepare('SELECT foto, cap FROM busca_foto WHERE slug = ? LIMIT ?').bind(slug, ESTADO_MAX_ITENS).all();
    const linhas = /** @type {any[]} */ (r.results || []);
    if (linhas.length) {
      return { ...estadoDoIndexadorLimpo({ vistas: linhas.map(l => `${l.cap || ''}:${l.foto}`), descritas: linhas.map(l => String(l.foto)) }), origem: 'banco' };
    }
  }
  return { vistas: [], descritas: [], qualidade: '', geracao: 0, limpar: false, dia: '', noDia: 0, quentes: [], origem: 'vazio' };
}

/**
 * @param {{ FOTOS: any }} env
 * @param {string} slug
 * @param {unknown} estado
 * @returns {Promise<EstadoDoIndexador>} o que foi gravado
 */
export async function gravaEstadoDoIndexador(env, slug, estado) {
  const limpo = estadoDoIndexadorLimpo(estado);
  await env.FOTOS.put(chaveDoEstado(slug), JSON.stringify({ v: 1, em: new Date().toISOString(), ...limpo }));
  return limpo;
}

/** Projeto apagado: o estado do indexador vai junto. @param {{ FOTOS: any }} env @param {string} slug */
export async function apagaEstadoDoIndexador(env, slug) {
  if (!slug) return;
  try { await env.FOTOS.delete(chaveDoEstado(slug)); } catch (e) { console.error('busca: não apagou o estado do indexador', e); }
}
