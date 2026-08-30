import { env, runInDurableObject, runDurableObjectAlarm, evictDurableObject } from 'cloudflare:test';
import { describe, it, expect } from 'vitest';

// Estes testes rodam dentro do WORKERD, com Durable Objects de verdade.
//
// A suíte `unit` cobre a aritmética destes mesmos objetos contra um dublê. O
// que ela NÃO consegue afirmar é justamente o motivo da migração: que o runtime
// serializa as chamadas de um objeto e por isso o incremento é atômico. Um
// dublê que nós escrevemos afirmando isso estaria afirmando sobre si mesmo.

// Nome novo por caso: o objeto PERSISTE entre testes do mesmo arquivo (é o
// ponto dele), então reaproveitar chave faz um teste enxergar o estado do
// anterior.
//
// `crypto.randomUUID`, e não `process.hrtime`: `process` não existe no workerd.
const chave = prefixo => `${prefixo}:${crypto.randomUUID()}`;

// UM objeto para todos os contadores — ver o comentário no topo de
// src/counters.js para por que não é um por chave (resposta curta: chamada de
// DO é subrequisição, 50 por invocação no gratuito, e o painel lê tudo).
const contador = () => env.COUNTER.get(env.COUNTER.idFromName('contadores'));

describe('Counter — no runtime de verdade', () => {
  it('é atômico sob concorrência: 100 incrementos simultâneos viram 100', async () => {
    // ESTE é o teste que justifica a migração inteira. A mesma rajada contra
    // KV perdia contagem (leitura-modificação-escrita não atômica entre
    // isolates) e batia no teto de 1 escrita/s por chave.
    const k = chave('views');
    const stub = contador();

    await Promise.all(Array.from({ length: 100 }, () => stub.increment(k, 1)));

    expect(await stub.value(k)).toBe(100);
  });

  it('assenta do KV no primeiro toque, mesmo sob rajada', async () => {
    // O caso que junta os dois perigos: o assentamento lê o KV (I/O externo,
    // que ABRE o portão de entrada) e cem visitas chegam juntas. Sem o
    // `blockConcurrencyWhile`, todas assentariam de 742 ao mesmo tempo e o
    // total sairia errado.
    const k = chave('views');
    await env.FOTOS.put(k, '742');
    const stub = contador();

    await Promise.all(Array.from({ length: 100 }, () => stub.increment(k, 1)));

    expect(await stub.value(k), '742 herdados + 100 visitas').toBe(842);
  });

  it('chaves diferentes não se misturam dentro do mesmo objeto', async () => {
    const a = chave('views');
    const b = chave('drive_clicks');
    const stub = contador();
    await stub.increment(a, 3);
    await stub.increment(b, 5);
    expect(await stub.value(a)).toBe(3);
    expect(await stub.value(b)).toBe(5);
  });

  it('persiste entre stubs diferentes — não é estado de isolate', async () => {
    const k = chave('views');
    await contador().increment(k, 7);
    // Stub novo, obtido do zero: se a contagem morasse na memória do isolate,
    // isto voltaria 0.
    expect(await contador().value(k)).toBe(7);
  });

  it('sobrevive a uma evicção sem perder a contagem', async () => {
    // Evicção é rotina: o runtime descarta objetos ociosos e os reconstrói na
    // chamada seguinte, relendo o armazenamento no construtor.
    const k = chave('views');
    await contador().increment(k, 11);

    await evictDurableObject(contador());

    expect(await contador().value(k)).toBe(11);
  });

  it('snapshot devolve tudo de uma vez e aponta o que falta', async () => {
    // A propriedade que consertou o painel: UMA chamada para N chaves.
    const a = chave('views');
    const b = chave('views');
    const stub = contador();
    await stub.increment(a, 2);

    const { counts, missing } = await stub.snapshot([a, b]);

    expect(counts[a]).toBe(2);
    expect(counts[b], 'chave nunca vista não entra em counts').toBeUndefined();
    expect(missing).toEqual([b]);
  });

  it('seed assenta o histórico e NÃO sobrescreve contagem viva', async () => {
    const novo = chave('views');
    const vivo = chave('views');
    const stub = contador();
    await stub.increment(vivo, 5);

    await stub.seed({ [novo]: '742', [vivo]: '999' });

    expect(await stub.value(novo), 'assenta o que faltava').toBe(742);
    expect(await stub.value(vivo), 'não pisa em contagem viva').toBe(5);
  });

  it('seed recusa lixo em vez de guardar NaN', async () => {
    const k = chave('views');
    const stub = contador();
    await stub.seed({ [k]: 'NaN' });
    expect(await stub.value(k)).toBe(0);
    expect(await stub.increment(k, 1)).toBe(1);
  });

  it('remove apaga as chaves pedidas', async () => {
    const k = chave('views');
    const stub = contador();
    await stub.increment(k, 4);
    await stub.remove([k]);
    expect(await stub.value(k)).toBe(0);

    const { missing } = await stub.snapshot([k]);
    expect(missing, 'volta a ser desconhecida, não zero gravado').toEqual([k]);
  });

  it('o armazenamento fica limpo depois de remove — objeto recolhível', async () => {
    const k = chave('views');
    const stub = contador();
    await stub.increment(k, 1);
    await stub.remove([k]);
    await runInDurableObject(stub, async (_i, state) => {
      expect(await state.storage.get(k)).toBeUndefined();
    });
  });
});

describe('RateLimiter — no runtime de verdade', () => {
  it('deixa passar até o limite e barra depois, na mesma janela', async () => {
    const stub = env.RATELIMIT.get(env.RATELIMIT.idFromName(chave('login')));
    const out = [];
    for (let i = 0; i < 5; i++) out.push(await stub.check(3, 600));
    expect(out).toEqual([true, true, true, false, false]);
  });

  it('conta certo sob concorrência — nunca deixa passar mais que o limite', async () => {
    // O modo de falha do KV era este: duas requisições liam a mesma contagem e
    // ambas passavam. Serializado, o excedente é barrado.
    const stub = env.RATELIMIT.get(env.RATELIMIT.idFromName(chave('drive')));
    const out = await Promise.all(Array.from({ length: 50 }, () => stub.check(10, 3600)));
    expect(out.filter(Boolean)).toHaveLength(10);
  });

  it('objetos diferentes (IP/chave) não dividem orçamento', async () => {
    const a = env.RATELIMIT.get(env.RATELIMIT.idFromName(chave('login')));
    const b = env.RATELIMIT.get(env.RATELIMIT.idFromName(chave('login')));
    expect(await a.check(1, 600)).toBe(true);
    expect(await a.check(1, 600)).toBe(false);
    expect(await b.check(1, 600)).toBe(true);
  });

  it('janela nova zera a contagem sem depender de TTL', async () => {
    // windowSecs=1 faz a janela virar em menos de um segundo de relógio.
    //
    // As duas primeiras chamadas PRECISAM cair na mesma janela, e a janela é
    // `Math.floor(Date.now() / 1000)` — vira a cada segundo de relógio, não a
    // cada segundo contado a partir daqui. Começar a 2 ms do fim de um segundo
    // joga a segunda chamada para a janela seguinte, onde ela conta do zero e
    // devolve `true` corretamente: o teste reprova sem que nada esteja errado.
    //
    // Não é hipótese. Aconteceu no run #459, no MESMO commit que tinha passado
    // 40 s antes, e a linha que falhou foi exatamente a segunda chamada.
    //
    // Esperar a virada antes de começar dá quase um segundo inteiro de folga
    // para as duas — sem afrouxar asserção nenhuma, que é o ponto: o teste
    // continua exigindo o mesmo, só deixa de depender de onde o relógio estava
    // quando ele começou.
    await new Promise(r => setTimeout(r, 1000 - (Date.now() % 1000) + 20));

    const stub = env.RATELIMIT.get(env.RATELIMIT.idFromName(chave('curta')));
    expect(await stub.check(1, 1)).toBe(true);
    expect(await stub.check(1, 1)).toBe(false);
    await new Promise(r => setTimeout(r, 1100));
    expect(await stub.check(1, 1), 'janela virou: conta de novo do zero').toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Ciclo de vida — o que devolve a limpeza que o `expirationTtl` do KV fazia
// ---------------------------------------------------------------------------
// Armazenamento de Durable Object não expira. Sem o alarme, todo IP que um dia
// tocasse o site deixaria um objeto para sempre: crescimento sem teto onde a
// versão em KV limpava sozinha. Estes testes existem para que isso não volte a
// passar despercebido.
describe('RateLimiter — limpeza automática', () => {
  it('arma um alarme quando a janela começa', async () => {
    const stub = env.RATELIMIT.get(env.RATELIMIT.idFromName(chave('drive')));
    await stub.check(5, 3600);

    await runInDurableObject(stub, async (_inst, state) => {
      expect(await state.storage.getAlarm(), 'sem alarme, o objeto vive para sempre').not.toBeNull();
      expect(await state.storage.get('w')).toBeTruthy();
    });
  });

  it('o alarme só dispara DEPOIS do fim da janela — não devolve orçamento cedo', async () => {
    // A propriedade de segurança: apagar o registro cedo devolveria o limite
    // para quem acabou de estourá-lo.
    const janelaSecs = 600;
    const antes = Date.now();
    const stub = env.RATELIMIT.get(env.RATELIMIT.idFromName(chave('drive')));
    await stub.check(1, janelaSecs);

    await runInDurableObject(stub, async (_inst, state) => {
      const alarme = await state.storage.getAlarm();
      expect(alarme).toBeGreaterThan(antes + janelaSecs * 1000);
    });
  });

  it('não rearma a cada chamada — rearmar custa uma linha escrita por requisição', async () => {
    const stub = env.RATELIMIT.get(env.RATELIMIT.idFromName(chave('drive')));
    await stub.check(10, 3600);

    let primeiro;
    await runInDurableObject(stub, async (_inst, state) => {
      primeiro = await state.storage.getAlarm();
    });

    await stub.check(10, 3600);
    await stub.check(10, 3600);

    await runInDurableObject(stub, async (_inst, state) => {
      expect(await state.storage.getAlarm(), 'o alarme da janela em curso não muda').toBe(primeiro);
    });
  });

  it('quando o alarme dispara, o objeto fica VAZIO e pode ser recolhido', async () => {
    const stub = env.RATELIMIT.get(env.RATELIMIT.idFromName(chave('drive')));
    await stub.check(5, 3600);

    expect(await runDurableObjectAlarm(stub), 'havia alarme agendado').toBe(true);

    await runInDurableObject(stub, async (_inst, state) => {
      expect(await state.storage.get('w'), 'registro apagado').toBeUndefined();
      const restante = await state.storage.list();
      expect(restante.size, 'nada pode sobrar, senão o objeto nunca é recolhido').toBe(0);
    });
  });

  it('depois da limpeza o controle continua funcionando', async () => {
    // Limpar não pode virar "o rate limit parou de existir para este IP".
    const stub = env.RATELIMIT.get(env.RATELIMIT.idFromName(chave('drive')));
    expect(await stub.check(1, 3600)).toBe(true);
    expect(await stub.check(1, 3600)).toBe(false);

    await runDurableObjectAlarm(stub);

    expect(await stub.check(1, 3600), 'janela nova, orçamento novo').toBe(true);
    expect(await stub.check(1, 3600), 'e o limite volta a valer').toBe(false);
  });
});
