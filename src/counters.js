import { DurableObject } from 'cloudflare:workers';
import { toCount } from './utils.js';

// ---------------------------------------------------------------------------
// Contadores e rate limit em Durable Objects
// ---------------------------------------------------------------------------
// KV não tem incremento atômico (leitura-modificação-escrita corre entre
// isolates) e recusa mais de UMA escrita/s na mesma chave — o primitivo errado
// para os dois.
//
// Plano gratuito (docs Cloudflare, ago/2026): 100 mil requisições/dia e 100
// mil linhas escritas/dia, contra 1000 escritas/dia do KV pra conta inteira.
// Só o backend SQLite é grátis, daí `new_sqlite_classes` no wrangler.toml.

// ---------------------------------------------------------------------------
// UM objeto para TODOS os contadores, não um por chave
// ---------------------------------------------------------------------------
// A versão por chave (`idFromName('views:slug')`) quebrou o painel de
// métricas em produção: chamada de Durable Object é SUBREQUISIÇÃO, e o plano
// gratuito permite 50 por invocação. `/api/metrics` lia 2 contadores por
// projeto — com 28 projetos, 57 chamadas, estourando o teto a partir de ~24
// projetos com "Erro ao carregar métricas". Diferente do KV, chamada de DO
// nunca vem de cache de borda — sem atenuação possível.
//
// Lição: o número de objetos tem de acompanhar o padrão de LEITURA, não só o
// de escrita. O painel quer tudo de uma vez, então tudo mora num objeto só —
// uma subrequisição em vez de N. Custo: escritas de todos os contadores
// serializam num objeto só, irrelevante neste volume. Se um dia apertar,
// fatiar por prefixo (`views:`, `drive_clicks:`), não voltar a um objeto por
// chave.
export class Counter extends DurableObject {
  // Espelho em memória do storage. Incremento é SÍNCRONO sobre ele: quando a
  // gravação começa, a soma já aconteceu — nenhuma intercalação a perde.
  /** @type {Map<string, any>} */
  #counts = new Map();

  /**
   * @param {DurableObjectState} ctx
   * @param {{ FOTOS?: KVNamespace }} env
   */
  constructor(ctx, env) {
    super(ctx, env);
    // Carrega tudo no nascimento do objeto; outros eventos ficam represados
    // até terminar. `list()` é storage do próprio objeto, não subrequisição.
    ctx.blockConcurrencyWhile(async () => {
      this.#counts = await ctx.storage.list();
    });
  }

  /** @param {unknown} v */
  static #valido(v) {
    // isInteger recusa NaN (typeof 'number', envenenaria: NaN+1=NaN);
    // >= 0 recusa negativo.
    return typeof v === 'number' && Number.isInteger(v) && v >= 0;
  }

  /**
   * @param {string} key
   * @param {number} [by]
   */
  async increment(key, by = 1) {
    // Primeiro toque nesta chave: adota o valor do KV pré-migração, para não
    // zerar o histórico. Dentro de `blockConcurrencyWhile` porque isto lê o
    // KV (I/O externo abre o portão de entrada do objeto) — sem o lock, 100
    // visitas simultâneas assentariam todas do mesmo valor de partida (foi
    // assim que "100 incrementos viraram 3").
    if (!Counter.#valido(this.#counts.get(key))) {
      await this.ctx.blockConcurrencyWhile(async () => {
        // Recheca: outra chamada pode ter assentado enquanto esta esperava.
        if (Counter.#valido(this.#counts.get(key))) return;
        const semente = await this.#seedFromKv(key);
        this.#counts.set(key, semente);
        await this.ctx.storage.put(key, semente);
      });
    }

    // Síncrono até a gravação: quando o `put` começa, a soma já aconteceu.
    const atual = Counter.#valido(this.#counts.get(key)) ? this.#counts.get(key) : 0;
    const next = atual + by;
    this.#counts.set(key, next);
    await this.ctx.storage.put(key, next);
    return next;
  }

  // Best-effort: se o KV não responder, começa do zero em vez de recusar a
  // contagem — perder histórico é ruim, deixar de contar é pior.
  /** @param {string} key */
  async #seedFromKv(key) {
    if (!this.env.FOTOS) return 0;
    try {
      return toCount(await this.env.FOTOS.get(key));
    } catch {
      return 0;
    }
  }

  /** @param {string} key */
  async value(key) {
    const v = this.#counts.get(key);
    return Counter.#valido(v) ? v : 0;
  }

  // Tudo de uma vez para o painel — UMA subrequisição, independente de
  // quantos projetos existam. `missing` são as chaves nunca vistas por este
  // objeto; o chamador usa isso para assentar do KV (ver `seed()`), porque ler
  // o KV aqui dentro gastaria a cota de subrequisição DESTE objeto.
  /** @param {string[]} keys */
  async snapshot(keys) {
    /** @type {Record<string, number>} */
    const out = {};
    /** @type {string[]} */
    const missing = [];
    for (const k of keys) {
      const v = this.#counts.get(k);
      if (Counter.#valido(v)) out[k] = v;
      else missing.push(k);
    }
    return { counts: out, missing };
  }

  // Assenta contagens que viviam no KV pré-migração. Só grava o que ainda não
  // existe — idempotente, seguro repetir.
  /** @param {Record<string, unknown>} map */
  async seed(map) {
    for (const [k, raw] of Object.entries(map)) {
      if (Counter.#valido(this.#counts.get(k))) continue;
      const n = toCount(raw);
      this.#counts.set(k, n);
      await this.ctx.storage.put(k, n);
    }
  }

  /** @param {string[]} keys */
  async remove(keys) {
    for (const k of keys) {
      this.#counts.delete(k);
      await this.ctx.storage.delete(k);
    }
  }
}

// Rate limit de janela fixa, um objeto por par (chave, IP). A troca em
// relação ao KV não é só de cota: checagem e incremento acontecem na mesma
// chamada serializada, então some a corrida em que duas requisições liam o
// mesmo contador e ambas passavam.
//
// ATENÇÃO ao ciclo de vida: a versão em KV gravava com
// `expirationTtl: windowSecs`, então cada registro sumia sozinho. Storage de
// Durable Object NÃO expira — sem o alarme abaixo, todo IP que já tocou o
// site deixaria um objeto para sempre.
export class RateLimiter extends DurableObject {
  /**
   * @param {number} limit máximo de passagens permitidas na janela
   * @param {number} windowSecs tamanho da janela, em segundos
   * @returns {Promise<boolean>} true se pode passar
   */
  async check(limit, windowSecs) {
    const janela = Math.floor(Date.now() / (windowSecs * 1000));
    // storage.get devolve `unknown` — dado que já esteve em disco. A anotação
    // é o que ESPERAMOS; a validação abaixo trata quando não é isso.
    /** @type {{ janela: number, contagem: number } | undefined} */
    const rec = await this.ctx.storage.get('w');

    // Guardar o número da janela junto do total dispensa comparar relógio com
    // prazo de validade. Contagem é validada, não adotada: um registro com
    // `contagem: NaN` passaria em `NaN >= limit` (falso) e desligaria o limite
    // em silêncio — lixo vira 0, falha FECHADA (lado certo pra controle de abuso).
    const guardada = rec && rec.janela === janela ? rec.contagem : 0;
    const atual = Number.isInteger(guardada) && guardada >= 0 ? guardada : 0;
    if (atual >= limit) return false;

    // Alarme armado só quando a janela COMEÇA (`atual === 0`): `setAlarm()` é
    // cobrado como escrita, e rearmar a cada chamada dobraria o custo à toa.
    if (atual === 0) {
      // Uma janela inteira de folga: o que importa não é apagar no instante
      // exato, é nunca apagar um registro ainda sendo contado — apagar cedo
      // devolveria o limite pra quem acabou de estourá-lo.
      await this.ctx.storage.setAlarm(Date.now() + windowSecs * 2000);
    }

    await this.ctx.storage.put('w', { janela, contagem: atual + 1 });
    return true;
  }

  // Sem registro, o runtime recolhe o Durable Object sozinho — a limpeza
  // automática que o `expirationTtl` do KV fazia; um IP de passagem não
  // custa armazenamento eterno.
  async alarm() {
    await this.ctx.storage.deleteAll();
  }
}
