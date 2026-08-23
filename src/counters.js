import { DurableObject } from 'cloudflare:workers';
import { toCount } from './utils.js';

// ---------------------------------------------------------------------------
// Contadores e rate limit em Durable Objects
// ---------------------------------------------------------------------------
// O KV é o primitivo errado para os dois, por duas razões que nenhum plano
// conserta: não existe incremento atômico (a leitura-modificação-escrita corre
// entre isolates) e o KV recusa mais de UMA escrita por segundo na mesma chave.
//
// Envelope no plano gratuito (docs da Cloudflare, ago/2026): 100 mil
// requisições/dia e 100 mil linhas escritas/dia, contra as 1000 escritas/dia do
// KV para a conta inteira. Só o backend SQLite existe no gratuito, daí
// `new_sqlite_classes` na migração declarada no wrangler.toml.

// ---------------------------------------------------------------------------
// UM objeto para TODOS os contadores — e o porquê, que custou um incidente
// ---------------------------------------------------------------------------
// A primeira versão disto era um objeto POR CHAVE (`idFromName('views:slug')`).
// Parecia mais limpo: cada contador isolado, sem ponto único de contenção.
//
// Quebrou o painel de métricas em produção. Cada chamada a um Durable Object é
// uma SUBREQUISIÇÃO, e o plano gratuito permite **50 por invocação** (o pago,
// 10 mil). O `/api/metrics` lê dois contadores por projeto: com 28 projetos são
// 56 chamadas + a leitura dos eventos = 57. Estourava o teto e a aba inteira
// respondia "Erro ao carregar métricas".
//
// Diferente do KV, chamada de DO nunca vem de cache de borda — não há
// atenuação possível. O erro é determinístico a partir de ~24 projetos.
//
// A lição, que vale para qualquer coisa parecida: **o número de objetos tem de
// acompanhar o padrão de LEITURA, não só o de escrita.** Quem lê aqui é um
// painel que quer tudo de uma vez; então tudo mora num objeto só, e o painel
// custa uma subrequisição em vez de N.
//
// O que se perde: as escritas de todos os contadores passam a serializar num
// objeto só. Para este site é irrelevante (dezenas de visitas por dia contra
// milhares de requisições/s que um objeto aguenta), e continua atômico. Se um
// dia isso apertar, o caminho é fatiar por prefixo (um objeto para `views:`,
// outro para `drive_clicks:`), não voltar a um objeto por chave.
export class Counter extends DurableObject {
  // Espelho em memória do armazenamento. O incremento é SÍNCRONO sobre ele,
  // então nenhuma intercalação perde soma: quando a gravação começa, a conta
  // já aconteceu.
  /** @type {Map<string, any>} */
  #counts = new Map();

  /**
   * @param {DurableObjectState} ctx
   * @param {{ FOTOS?: KVNamespace }} env
   */
  constructor(ctx, env) {
    super(ctx, env);
    // Carrega tudo de uma vez no nascimento do objeto, com os outros eventos
    // represados até terminar. `list()` é uma operação de armazenamento do
    // próprio objeto, não uma subrequisição.
    ctx.blockConcurrencyWhile(async () => {
      this.#counts = await ctx.storage.list();
    });
  }

  /** @param {unknown} v */
  static #valido(v) {
    // `typeof` estreita o `unknown` vindo do disco; `isInteger` recusa o NaN,
    // que É `typeof 'number'` e envenenaria o contador para sempre
    // (NaN + 1 = NaN); `>= 0` recusa negativo.
    return typeof v === 'number' && Number.isInteger(v) && v >= 0;
  }

  /**
   * @param {string} key
   * @param {number} [by]
   */
  async increment(key, by = 1) {
    // Primeiro toque nesta chave: adota o que ela tinha no KV antes da
    // migração, para que uma visita não zere o histórico do projeto.
    //
    // Dentro de `blockConcurrencyWhile` porque isto lê o KV, e I/O EXTERNO
    // ABRE o portão de entrada do objeto. Sem o bloqueio, cem visitas
    // simultâneas assentariam todas ao mesmo tempo, cada uma partindo do mesmo
    // valor — foi exatamente assim que "100 incrementos viraram 3".
    if (!Counter.#valido(this.#counts.get(key))) {
      await this.ctx.blockConcurrencyWhile(async () => {
        // Recheca: outra chamada pode ter assentado enquanto esta esperava.
        if (Counter.#valido(this.#counts.get(key))) return;
        const semente = await this.#seedFromKv(key);
        this.#counts.set(key, semente);
        await this.ctx.storage.put(key, semente);
      });
    }

    // Daqui para baixo é SÍNCRONO até a gravação: quando o `put` começa, a
    // soma já aconteceu, então nenhuma intercalação pode perdê-la.
    const atual = Counter.#valido(this.#counts.get(key)) ? this.#counts.get(key) : 0;
    const next = atual + by;
    this.#counts.set(key, next);
    await this.ctx.storage.put(key, next);
    return next;
  }

  // Best-effort: se o KV não responder, começa do zero em vez de recusar a
  // contagem. Perder o histórico é ruim; deixar de contar é pior.
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

  // Tudo de uma vez, para o painel. UMA subrequisição, independente de quantos
  // projetos existam — que é o ponto desta classe.
  //
  // Devolve também `missing`: as chaves pedidas que este objeto nunca viu.
  // Quem chama usa isso para assentar o histórico que ficou no KV (ver
  // `seed()`), porque ler o KV aqui dentro gastaria a cota de subrequisição
  // DESTE objeto — o mesmo erro, um nível abaixo.
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

  // Assentamento explícito das contagens que viviam no KV antes da migração.
  // Só grava o que ainda não existe: chamar de novo nunca sobrescreve contagem
  // viva, então é idempotente e seguro repetir.
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

// Rate limit de janela fixa, um objeto por par (chave, IP).
//
// A troca em relação ao KV não é só de cota: aqui a checagem e o incremento
// acontecem dentro da mesma chamada serializada, então some a corrida em que
// duas requisições liam o mesmo contador e ambas passavam.
//
// ATENÇÃO ao ciclo de vida, que é a diferença que quase passou batido. A versão
// em KV gravava com `expirationTtl: windowSecs`, então cada registro sumia
// sozinho. Armazenamento de Durable Object NÃO expira: sem o alarme abaixo,
// cada IP que um dia tocou o site deixaria um objeto para sempre — crescimento
// sem teto onde antes havia limpeza automática.
export class RateLimiter extends DurableObject {
  /**
   * @param {number} limit máximo de passagens permitidas na janela
   * @param {number} windowSecs tamanho da janela, em segundos
   * @returns {Promise<boolean>} true se pode passar
   */
  async check(limit, windowSecs) {
    const janela = Math.floor(Date.now() / (windowSecs * 1000));
    // O armazenamento devolve `unknown` — é dado que já esteve em disco e pode
    // ter qualquer forma. A anotação diz o que ESPERAMOS; a validação logo
    // abaixo é que trata o caso de não ser isso.
    /** @type {{ janela: number, contagem: number } | undefined} */
    const rec = await this.ctx.storage.get('w');

    // Janela nova zera a contagem. Guardar o número da janela junto com o total
    // é o que dispensa comparar relógio com prazo de validade: o registro velho
    // é reconhecido como velho em vez de precisar ter sumido na hora certa.
    //
    // A contagem é validada, não adotada: um registro corrompido com
    // `contagem: NaN` passaria em `NaN >= limit` (falso) e desligaria o limite
    // em silêncio para aquele par chave/IP. Lixo vira 0 — falha FECHADA, que é
    // o lado certo para um controle de abuso.
    const guardada = rec && rec.janela === janela ? rec.contagem : 0;
    const atual = Number.isInteger(guardada) && guardada >= 0 ? guardada : 0;
    if (atual >= limit) return false;

    // O alarme é armado só quando uma janela COMEÇA (`atual === 0`), e não a
    // cada chamada. Dois motivos: cada `setAlarm()` é cobrado como uma linha
    // escrita — rearmar a cada requisição dobraria o custo do controle — e
    // rearmar não muda nada, porque a janela seguinte arma o seu próprio.
    if (atual === 0) {
      // Uma janela inteira de folga depois do fim desta. A margem existe porque
      // o que importa não é apagar no instante exato, e sim nunca apagar um
      // registro que ainda está sendo contado: barrar alguém e esquecer no
      // segundo seguinte devolveria o limite para quem acabou de estourá-lo.
      await this.ctx.storage.setAlarm(Date.now() + windowSecs * 2000);
    }

    await this.ctx.storage.put('w', { janela, contagem: atual + 1 });
    return true;
  }

  // Fim de vida do objeto: sem registro, o runtime recolhe o Durable Object
  // sozinho. É o que devolve a limpeza automática que o `expirationTtl` do KV
  // fazia — e é por isso que um IP de passagem não custa armazenamento eterno.
  async alarm() {
    await this.ctx.storage.deleteAll();
  }
}
