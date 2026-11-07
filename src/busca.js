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
  'Cake': 'bolo', 'Birthday Cake': 'bolo aniversario', 'Food': 'comida', 'Dessert': 'doce sobremesa', 'Candy': 'doce bala', 'Popcorn': 'pipoca',
  'Corn': 'milho', 'Beverage': 'bebida', 'Pizza': 'pizza', 'Ice Cream': 'sorvete', 'Bonfire': 'fogueira', 'Fire': 'fogo fogueira',
  'Ball': 'bola', 'Soccer Ball': 'bola futebol', 'Football': 'futebol bola', 'Soccer': 'futebol', 'Basketball': 'basquete', 'Volleyball': 'volei',
  'Sport': 'esporte', 'Team': 'time', 'Field': 'campo', 'Stadium': 'estadio', 'Running': 'correndo', 'Trophy': 'trofeu', 'Medal': 'medalha',
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
