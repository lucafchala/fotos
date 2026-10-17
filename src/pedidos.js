import { generateId } from './utils.js';

// ---------------------------------------------------------------------------
// Pedidos de remoção (LGPD) — um registro por chave (#198)
// ---------------------------------------------------------------------------
// Até a v2.0 era UM array no KV (`removal_requests`), lido e regravado por
// cinco caminhos: o envio público (duas vezes — a segunda só para carimbar se
// os e-mails saíram), o "resolver" do painel, a poda do cron e o restore. O KV
// é last-write-wins, e cada caminho regravava a lista INTEIRA a partir do
// retrato que tinha lido. Dois pedidos no mesmo instante, ou um pedido e um
// "resolver", e o `put` de depois apagava do painel o registro de antes. A
// segunda gravação do envio era a pior: regravava o retrato de ANTES dos
// e-mails, apagando qualquer coisa que tivesse chegado naqueles 1–2 s, no
// mesmo datacenter. E o KV recusa mais de uma escrita por segundo na mesma
// chave — envios simultâneos podiam ser recusados de vez.
//
// O e-mail ao dono sempre saiu, então nenhum pedido se perdia de fato; o que
// se perdia era o registro no painel, e com ele o "resolver" e o prazo à vista.
//
// Agora cada pedido mora em `removal_request:<id>`: criar não lê nada,
// resolver mexe só no próprio registro, e nada regrava o que não é seu.
//
// A troca não perde nada no meio do caminho:
//   - a LEITURA junta o array antigo e os registros próprios (por id; o
//     próprio vence, porque só o código novo o escreve);
//   - a MIGRAÇÃO roda no cron diário (`migraLegado`): copia o que falta e só
//     apaga o array se TODO registro dele já tiver a sua chave. Se um código
//     antigo regravar o array (a janela do deploy), o próximo cron migra de
//     novo;
//   - rota GET nenhuma escreve no KV — a cota de 1000 escritas/dia da conta
//     não é gasta para abrir o painel.
//
// Dois limites do KV moldam o resto do arquivo (docs do Workers KV):
//   - uma escrita por segundo NA MESMA CHAVE; a segunda, dentro da janela,
//     volta 429. O envio grava o pedido antes dos e-mails e carimba o status
//     deles depois — `regravaPedido` espera o que falta da janela;
//   - 1000 operações por invocação no plano free. A lista lê os registros em
//     leituras EM LOTE (até 100 chaves numa operação só), e não uma por chave:
//     um painel com mil pedidos continua abrindo.

export const PREFIXO_PEDIDO = 'removal_request:';
export const CHAVE_LEGADA = 'removal_requests';
/** Id que pode virar nome de chave (o `generateId()` do site produz hex). */
const ID_DE_CHAVE = /^[\w-]{1,64}$/;
/** Máximo de chaves numa leitura em lote do KV (`get(chaves[])`). */
export const LOTE_DE_LEITURA = 100;
/**
 * Intervalo mínimo entre duas escritas na MESMA chave: o KV aceita uma por
 * segundo ("Limits to KV writes to the same key"); 100 ms de folga para o
 * relógio e a rede.
 */
export const JANELA_MESMA_CHAVE_MS = 1100;

/**
 * A espera da janela, num objeto que os testes podem trocar (`vi.spyOn`): um
 * segundo de verdade em cada pedido simulado deixaria a suíte lenta à toa.
 */
export const relogio = {
  /** @param {number} ms */
  dorme: ms => new Promise(ok => setTimeout(ok, ms)),
};

/** @typedef {Record<string, any>} Pedido */

/** @param {string} id */
export const chavePedido = id => PREFIXO_PEDIDO + id;

/** @param {unknown} r @returns {r is Pedido} */
function ehRegistro(r) {
  return !!r && typeof r === 'object' && !Array.isArray(r);
}

/** @param {Pedido} r */
function temIdDeChave(r) {
  return typeof r.id === 'string' && ID_DE_CHAVE.test(r.id);
}

/**
 * O array antigo, se ainda existir. Valor corrompido vira lista vazia — o
 * mesmo portão de forma de sempre: um objeto no lugar do array quebrava o
 * POST público com `.filter is not a function`. Falha do KV, ao contrário,
 * SOBE: quem chama decide (o cron alerta; o painel mostra o erro).
 * @param {{ FOTOS: KVNamespace }} env
 * @returns {Promise<Pedido[]>}
 */
async function lerLegado(env) {
  const data = await env.FOTOS.get(CHAVE_LEGADA);
  if (!data) return [];
  try {
    const parsed = JSON.parse(data);
    return Array.isArray(parsed) ? parsed.filter(ehRegistro) : [];
  } catch {
    return [];
  }
}

/**
 * Os nomes de todas as chaves de pedido, página por página.
 * @param {{ FOTOS: KVNamespace }} env
 * @returns {Promise<string[]>}
 */
async function nomesDePedidos(env) {
  /** @type {string[]} */
  const nomes = [];
  /** @type {string | undefined} */
  let cursor;
  do {
    const r = await env.FOTOS.list({ prefix: PREFIXO_PEDIDO, cursor });
    for (const k of r.keys || []) nomes.push(k.name);
    cursor = r.list_complete ? undefined : /** @type {any} */ (r).cursor;
  } while (cursor);
  return nomes;
}

/**
 * Um registro gravado, ou null se ausente ou ilegível.
 * @param {string | null | undefined} data
 * @returns {Pedido | null}
 */
function registroDe(data) {
  if (!data) return null;
  try {
    const r = JSON.parse(data);
    return ehRegistro(r) ? r : null;
  } catch {
    return null;
  }
}

/**
 * @param {{ FOTOS: KVNamespace }} env
 * @param {string} nome
 */
async function lerRegistro(env, nome) {
  return registroDe(await env.FOTOS.get(nome));
}

/**
 * Os registros de `nomes`, na mesma ordem, em leituras EM LOTE: cada lote de
 * até 100 chaves é UMA operação do KV (e um `Map` de volta), não cem.
 * @param {{ FOTOS: KVNamespace }} env
 * @param {string[]} nomes
 */
async function lerRegistros(env, nomes) {
  /** @type {(Pedido | null)[]} */
  const out = [];
  for (let i = 0; i < nomes.length; i += LOTE_DE_LEITURA) {
    const lote = nomes.slice(i, i + LOTE_DE_LEITURA);
    const valores = await env.FOTOS.get(lote);
    for (const nome of lote) out.push(registroDe(valores.get(nome)));
  }
  return out;
}

/**
 * Todos os pedidos: os registros próprios mais o que ainda estiver no array
 * antigo. Registro do array sem id utilizável continua aparecendo (o painel
 * mostra), só não tem como ser resolvido por id — como antes.
 * @param {{ FOTOS: KVNamespace }} env
 * @returns {Promise<Pedido[]>}
 */
export async function listaPedidos(env) {
  const [legado, nomes] = await Promise.all([lerLegado(env), nomesDePedidos(env)]);
  const proprios = await lerRegistros(env, nomes);
  /** @type {Map<unknown, Pedido>} */
  const porId = new Map();
  for (const r of legado) porId.set(temIdDeChave(r) ? r.id : Symbol('sem-id'), r);
  for (const r of proprios) if (r && temIdDeChave(r)) porId.set(r.id, r);
  return [...porId.values()];
}

/**
 * Um pedido pelo id: o registro próprio, ou o do array antigo enquanto ele
 * não tiver sido migrado.
 * @param {{ FOTOS: KVNamespace }} env
 * @param {string} id
 * @returns {Promise<Pedido | null>}
 */
export async function lePedido(env, id) {
  if (typeof id !== 'string' || !ID_DE_CHAVE.test(id)) return null;
  const proprio = await lerRegistro(env, chavePedido(id));
  if (proprio) return proprio;
  return (await lerLegado(env)).find(r => r.id === id) || null;
}

/**
 * Grava UM pedido na chave dele. Lança se o KV recusar — quem chama decide.
 * @param {{ FOTOS: KVNamespace }} env
 * @param {Pedido} pedido
 */
export async function gravaPedido(env, pedido) {
  if (!temIdDeChave(pedido)) throw new Error('pedido sem id utilizável');
  await env.FOTOS.put(chavePedido(pedido.id), JSON.stringify(pedido));
}

/**
 * Grava DE NOVO um pedido que esta mesma invocação gravou há pouco — o
 * carimbo do status dos e-mails, logo depois do envio. Espera o que falta da
 * janela de um segundo desde a primeira escrita: os dois e-mails costumam
 * voltar antes disso, e sem a espera o carimbo levaria 429 justamente no caso
 * normal. Lança se o KV recusar — quem chama decide.
 * @param {{ FOTOS: KVNamespace }} env
 * @param {Pedido} pedido
 * @param {number} gravadoEm `Date.now()` logo depois da escrita anterior
 */
export async function regravaPedido(env, pedido, gravadoEm) {
  const falta = JANELA_MESMA_CHAVE_MS - (Date.now() - gravadoEm);
  if (falta > 0) await relogio.dorme(falta);
  await gravaPedido(env, pedido);
}

/**
 * Migração do array antigo (#198), idempotente. Registro próprio que já
 * existe NÃO é sobrescrito: ele é mais novo (só o código novo o escreve — um
 * "resolver" feito antes da migração, por exemplo). O array só é apagado
 * depois de todo registro dele ter a sua chave; uma escrita recusada no meio
 * aborta sem apagar nada, e o próximo cron continua de onde parou.
 * @param {{ FOTOS: KVNamespace }} env
 * @returns {Promise<{ migrados: number, apagouLegado: boolean }>}
 */
export async function migraLegado(env) {
  const bruto = await env.FOTOS.get(CHAVE_LEGADA);
  if (bruto === null || bruto === undefined) return { migrados: 0, apagouLegado: false };
  const legado = await lerLegado(env);
  const existentes = new Set(await nomesDePedidos(env));
  let migrados = 0;
  for (const r of legado) {
    // Sem id utilizável (dado antigo corrompido): ganha um, para não sumir.
    const registro = temIdDeChave(r) ? r : { ...r, id: generateId() };
    if (existentes.has(chavePedido(registro.id))) continue;
    await gravaPedido(env, registro);
    migrados++;
  }
  await env.FOTOS.delete(CHAVE_LEGADA);
  return { migrados, apagouLegado: true };
}

/**
 * Poda dos pedidos RESOLVIDOS há mais de `limiteMs` (prazo da política de
 * retenção). Pendente nunca é apagado; registro ilegível também não — não se
 * apaga dado de titular que não se conseguiu ler.
 * @param {{ FOTOS: KVNamespace }} env
 * @param {number} limiteMs epoch em ms: resolvido antes disto sai
 * @returns {Promise<number>} quantos foram apagados
 */
export async function podaResolvidos(env, limiteMs) {
  const nomes = await nomesDePedidos(env);
  const registros = await lerRegistros(env, nomes);
  let apagados = 0;
  for (let i = 0; i < nomes.length; i++) {
    const r = registros[i];
    if (!r || r.resolved !== true) continue;
    const quando = new Date(r.resolvedAt || r.createdAt || 0).getTime();
    if (quando < limiteMs) {
      await env.FOTOS.delete(nomes[i]);
      apagados++;
    }
  }
  return apagados;
}
