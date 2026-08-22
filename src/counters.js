import { DurableObject } from 'cloudflare:workers';
import { toCount } from './utils.js';

// ---------------------------------------------------------------------------
// Contadores e rate limit em Durable Objects
// ---------------------------------------------------------------------------
// O KV é o primitivo errado para os dois, por duas razões que nenhum plano
// conserta:
//
//   • não existe incremento atômico — a leitura-modificação-escrita corre entre
//     isolates, e duas visitas simultâneas sobrescrevem uma à outra;
//   • o KV recusa mais de UMA escrita por segundo na mesma chave, e esse limite
//     é igual no plano pago.
//
// `views:<slug>` é uma chave só com o público inteiro de um projeto batendo
// nela, então o limite por chave sempre foi o teto real — não a cota diária. É
// por isso que existia toda a agregação em memória (mapa de pendentes, piso de
// 1 s por chave, trava de flush, drenagem agendada): era o jeito de transformar
// N visitantes num segundo numa escrita só.
//
// O Durable Object resolve os dois de uma vez. Cada contador é um objeto único
// no mundo, as chamadas nele são serializadas pelo runtime, e o incremento é
// atômico por construção — sem piso, sem lote, sem cauda perdida quando o
// isolate morre. A agregação inteira deixa de ter motivo para existir.
//
// Envelope no plano gratuito (docs da Cloudflare, consultadas em ago/2026):
// 100 mil requisições/dia e 100 mil linhas escritas/dia, contra as 1000
// escritas/dia do KV para a conta inteira — cem vezes mais, e sem Workers Paid.
// Só o backend SQLite existe no gratuito, daí `new_sqlite_classes` na migração
// declarada no wrangler.toml.

// Um contador por chave (`views:<slug>`, `drive_clicks:<slug>`), endereçado por
// `idFromName(chave)` — de modo que `ctx.id.name` É a chave, e o objeto não
// precisa que ninguém lhe diga qual contador ele é.
export class Counter extends DurableObject {
  // A contagem vive em memória e é espelhada no armazenamento. O incremento em
  // si é SÍNCRONO (`this.#n += by`), então nenhuma intercalação pode perdê-lo:
  // quando a gravação começa, a soma já aconteceu.
  #n = 0;

  /**
   * @param {DurableObjectState} ctx
   * @param {{ FOTOS?: KVNamespace }} env
   */
  constructor(ctx, env) {
    super(ctx, env);

    // `blockConcurrencyWhile` não é enfeite — é o que torna o assentamento
    // seguro, e custou um teste para descobrir.
    //
    // O Durable Object serializa eventos enquanto uma operação de ARMAZENAMENTO
    // está em voo (o portão de entrada fecha sozinho). Mas o assentamento lê o
    // KV, e I/O EXTERNO **abre** o portão: com a leitura do KV no caminho do
    // incremento, cem chamadas simultâneas assentavam todas ao mesmo tempo,
    // cada uma partindo de 0. Medido no workerd: 100 incrementos viraram 3.
    //
    // Aqui o assentamento acontece uma vez, no nascimento do objeto, com todos
    // os outros eventos represados até terminar. Depois disso nenhum caminho
    // quente toca o KV.
    ctx.blockConcurrencyWhile(async () => {
      const stored = await ctx.storage.get('n');
      // As três checagens têm papéis diferentes e nenhuma é redundante:
      // `typeof` estreita o `unknown` que vem do armazenamento; `Number
      // .isInteger` recusa o NaN, que É `typeof 'number'` e envenenaria o
      // contador para sempre (NaN + 1 = NaN); e `>= 0` recusa negativo. É o
      // mesmo veneno que o `toCount` existia para conter na versão em KV.
      if (typeof stored === 'number' && Number.isInteger(stored) && stored >= 0) {
        this.#n = stored;
        return;
      }
      this.#n = await this.#seedFromKv();
      await ctx.storage.put('n', this.#n);
    });
  }

  // Assentamento: adota a contagem que esta chave tinha no KV, para que a
  // migração não zere o histórico acumulado em produção. Roda uma única vez por
  // objeto; depois o valor vive no armazenamento do próprio objeto.
  async #seedFromKv() {
    const chave = this.ctx.id.name;
    if (!chave || !this.env.FOTOS) return 0;
    try {
      return toCount(await this.env.FOTOS.get(chave));
    } catch {
      // Best-effort: se o KV não responder, começa do zero em vez de recusar a
      // contagem. Perder o histórico é ruim; deixar de contar é pior.
      return 0;
    }
  }

  async increment(by = 1) {
    this.#n += by;
    await this.ctx.storage.put('n', this.#n);
    return this.#n;
  }

  async value() {
    return this.#n;
  }

  // Usado quando o projeto é apagado no painel: o contador some junto.
  //
  // Zera explicitamente em vez de só apagar tudo. Um objeto vazio é
  // indistinguível de um objeto NOVO, e o assentamento voltaria a ler o KV — de
  // modo que apagar um projeto e recriar outro com o mesmo slug ressuscitaria a
  // contagem antiga. O `0` gravado é o que diz "este contador já foi assentado".
  async reset() {
    this.#n = 0;
    await this.ctx.storage.deleteAll();
    await this.ctx.storage.put('n', 0);
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
