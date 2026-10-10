import { DurableObject } from 'cloudflare:workers';
import { toCount, hojeEmSaoPaulo, diaMenos } from './utils.js';
import { METRICAS_RETENCAO_DIAS } from './config.js';

// ---------------------------------------------------------------------------
// Série por dia (v2, #215)
// ---------------------------------------------------------------------------
// Além do total (`views:<slug>`), cada incremento soma no balde do DIA de São
// Paulo: `d:<AAAA-MM-DD>:<chave do total>` — por exemplo
// `d:2026-10-10:views:formatura`. O dia vem PRIMEIRO na chave de propósito:
// podar "tudo antes de tal dia" e ler "tudo desde tal dia" viram comparações
// de texto, sem índice nenhum.
//
// Custo, dito sem rodeio: a mesma chamada ao objeto (nenhuma subrequisição a
// mais por visita) e uma linha escrita a mais (o `put` grava as duas chaves
// juntas). No plano gratuito são 100 mil linhas/dia; um evento de 750 pessoas
// gasta uns 1,5 mil a mais. O que a série NÃO tem é dado pessoal: é contagem.
const DIARIO = 'd:';
/** Tamanho de `d:AAAA-MM-DD:` — o que vem depois é a chave do total. */
const PREFIXO_DIA = DIARIO.length + 11;
/** @param {string} dia @param {string} key */
const chaveDia = (dia, key) => `${DIARIO}${dia}:${key}`;

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
  /** Último dia em que a poda da série rodou (uma vez por dia, ver #poda). */
  #podadoEm = '';

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

    // Síncrono até a gravação: quando o `put` começa, as duas somas (total e
    // balde do dia) já aconteceram — nenhuma intercalação perde contagem. As
    // duas chaves vão no MESMO `put`: ou gravam juntas ou nenhuma grava.
    const dia = hojeEmSaoPaulo();
    const dk = chaveDia(dia, key);
    const atual = Counter.#valido(this.#counts.get(key)) ? this.#counts.get(key) : 0;
    const atualDia = Counter.#valido(this.#counts.get(dk)) ? this.#counts.get(dk) : 0;
    const next = atual + by;
    this.#counts.set(key, next);
    this.#counts.set(dk, atualDia + by);
    await this.ctx.storage.put({ [key]: next, [dk]: atualDia + by });
    if (dia !== this.#podadoEm) await this.#poda(dia);
    return next;
  }

  // Poda da série: no primeiro incremento de cada dia, apaga os baldes mais
  // velhos que METRICAS_RETENCAO_DIAS. Sem isto, storage de Durable Object não
  // expira nunca (ver RateLimiter) e a série cresceria para sempre. `#podadoEm`
  // é marcado ANTES do primeiro `await`, então duas visitas simultâneas na
  // virada do dia não podam duas vezes. Se o objeto reiniciar, a poda roda de
  // novo uma vez — idempotente.
  /** @param {string} hoje */
  async #poda(hoje) {
    this.#podadoEm = hoje;
    const corte = diaMenos(hoje, METRICAS_RETENCAO_DIAS);
    /** @type {string[]} */
    const velhas = [];
    for (const k of this.#counts.keys()) {
      if (k.startsWith(DIARIO) && k.slice(DIARIO.length, DIARIO.length + 10) < corte) velhas.push(k);
    }
    for (const k of velhas) this.#counts.delete(k);
    // A API apaga até 128 chaves por chamada.
    for (let i = 0; i < velhas.length; i += 128) await this.ctx.storage.delete(velhas.slice(i, i + 128));
  }

  // A série inteira desde `desde` numa chamada só (#215: chamada de DO é
  // subrequisição — o painel não pode pedir um dia ou um projeto por vez).
  // `totais` traz junto o total de chaves que o painel também quer (os modos
  // do portão), para continuar sendo UMA chamada. `primeiroDia` é o dia mais
  // antigo que a série tem: o painel diz "contagem diária desde…".
  /**
   * @param {string} desde 'AAAA-MM-DD'
   * @param {string[]} [totais]
   */
  async serie(desde, totais = []) {
    /** @type {Record<string, number>} */
    const serie = {};
    let primeiroDia = '';
    for (const [k, v] of this.#counts) {
      if (!k.startsWith(DIARIO) || !Counter.#valido(v)) continue;
      const dia = k.slice(DIARIO.length, DIARIO.length + 10);
      if (!primeiroDia || dia < primeiroDia) primeiroDia = dia;
      if (dia >= desde) serie[k] = v;
    }
    /** @type {Record<string, number>} */
    const tot = {};
    for (const k of totais) tot[k] = Counter.#valido(this.#counts.get(k)) ? this.#counts.get(k) : 0;
    return { serie, primeiroDia, totais: tot };
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

  // Apaga os totais E a série diária deles: um projeto excluído não pode
  // deixar baldes órfãos ocupando o objeto até a poda (400 dias).
  /** @param {string[]} keys */
  async remove(keys) {
    const alvo = new Set(keys);
    const apagar = [...keys];
    for (const k of this.#counts.keys()) {
      if (k.startsWith(DIARIO) && alvo.has(k.slice(PREFIXO_DIA))) apagar.push(k);
    }
    for (const k of apagar) this.#counts.delete(k);
    for (let i = 0; i < apagar.length; i += 128) await this.ctx.storage.delete(apagar.slice(i, i + 128));
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

    // A contagem nova é gravada ANTES de qualquer outro `await`. Nada de
    // `await` entre a leitura acima e este `put`: é isso que faz a
    // leitura-modificação-escrita ser atômica. Já esteve na ordem inversa, com
    // o `setAlarm()` no meio — e durante ele outra chamada entrava, lia a
    // mesma contagem 0 e também passava: 50 chamadas simultâneas com limite 10
    // deixavam passar 11 em ~6% dos objetos (medido no workerd, 13 de 200).
    await this.ctx.storage.put('w', { janela, contagem: atual + 1 });

    // Alarme armado só quando a janela COMEÇA (`atual === 0`): `setAlarm()` é
    // cobrado como escrita, e rearmar a cada chamada dobraria o custo à toa.
    if (atual === 0) {
      // Uma janela inteira de folga: o que importa não é apagar no instante
      // exato, é nunca apagar um registro ainda sendo contado — apagar cedo
      // devolveria o limite pra quem acabou de estourá-lo.
      await this.ctx.storage.setAlarm(Date.now() + windowSecs * 2000);
    }
    return true;
  }

  /**
   * Balde de fichas (token bucket) — o limite "moderno" do portão do Drive.
   *
   * A janela fixa de `check()` é um corte seco: estourou, só na hora cheia
   * seguinte. Num evento, o público inteiro chega junto pelo MESMO IP (o
   * Wi-Fi do local), e um corte seco vira uma hora sem fotos para quem chegou
   * depois. O balde aguenta a rajada até `capacity` e devolve fichas
   * continuamente (`perHour` por hora): quem esvazia espera SEGUNDOS, e a
   * resposta diz quantos (`retryAfter`), para o cliente tentar de novo na
   * hora certa em vez de martelar.
   *
   * Mesmas regras de atomicidade de `check()`: nenhum `await` entre a leitura
   * e a gravação. Recusa não grava nada (não gasta linha escrita do DO).
   *
   * @param {number} capacity fichas no balde cheio (a rajada que cabe)
   * @param {number} perHour fichas devolvidas por hora (o ritmo sustentado)
   * @returns {Promise<{ ok: boolean, retryAfter: number }>} retryAfter em segundos (0 quando ok)
   */
  async take(capacity, perHour) {
    const agora = Date.now();
    const porMs = perHour / 3_600_000;
    /** @type {{ fichas: number, t: number, cap: number, porMs: number } | undefined} */
    const rec = await this.ctx.storage.get('b');

    // Registro inválido (NaN, negativo, do futuro) vira balde cheio — o mesmo
    // que "registro novo", e a próxima gravação o substitui por um válido. O
    // limite volta a valer na hora; nada fica envenenado para sempre.
    let fichas = capacity;
    if (rec && Number.isFinite(rec.fichas) && rec.fichas >= 0 && Number.isFinite(rec.t) && rec.t <= agora) {
      fichas = Math.min(capacity, rec.fichas + (agora - rec.t) * porMs);
    }
    if (fichas < 1) {
      return { ok: false, retryAfter: Math.max(1, Math.ceil((1 - fichas) / porMs / 1000)) };
    }

    await this.ctx.storage.put('b', { fichas: fichas - 1, t: agora, cap: capacity, porMs });
    // Alarme só quando o balde nasce: `setAlarm()` custa uma escrita. O
    // alarme se reagenda sozinho enquanto o balde não encher (ver alarm()).
    if (!rec) await this.ctx.storage.setAlarm(agora + Math.ceil(1 / porMs));
    return { ok: true, retryAfter: 0 };
  }

  // Sem registro, o runtime recolhe o Durable Object sozinho — a limpeza
  // automática que o `expirationTtl` do KV fazia; um IP de passagem não
  // custa armazenamento eterno.
  //
  // Balde (take) só é apagado CHEIO: balde cheio é indistinguível de balde
  // novo, então apagar não devolve fichas a ninguém. Antes disso, o alarme
  // se reagenda para o instante em que ele enche.
  async alarm() {
    /** @type {{ fichas: number, t: number, cap: number, porMs: number } | undefined} */
    const b = await this.ctx.storage.get('b');
    if (b && Number.isFinite(b.fichas) && Number.isFinite(b.t) && Number.isFinite(b.cap) && b.porMs > 0) {
      const cheioEm = b.t + Math.max(0, b.cap - b.fichas) / b.porMs;
      if (cheioEm > Date.now()) {
        await this.ctx.storage.setAlarm(Math.ceil(cheioEm) + 1000);
        return;
      }
    }
    await this.ctx.storage.deleteAll();
  }
}
