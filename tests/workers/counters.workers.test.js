import { env, runInDurableObject, runDurableObjectAlarm, evictDurableObject } from 'cloudflare:test';
import { describe, it, expect } from 'vitest';

// Estes testes rodam dentro do WORKERD, com Durable Objects de verdade.
//
// A suíte `unit` cobre a aritmética destes mesmos objetos contra um dublê. O
// que ela NÃO consegue afirmar é justamente o motivo da migração: que o runtime
// serializa as chamadas de um objeto e por isso o incremento é atômico. Um
// dublê que nós escrevemos afirmando isso estaria afirmando sobre si mesmo.
// Aqui a garantia é da plataforma, então o teste vale.

// Nome novo por caso: os objetos PERSISTEM entre testes do mesmo arquivo (é o
// ponto deles), então reaproveitar nome faz um teste enxergar o estado do
// anterior — e o segundo a rodar falha por um motivo que não é o dele.
//
// `crypto.randomUUID`, e não um contador com `process.hrtime`: `process` não
// existe no workerd. Um teste que depende de global de Node passa aqui por
// acaso, via camada de compatibilidade, e quebra quando ela mudar.
const nome = prefixo => `${prefixo}:${crypto.randomUUID()}`;

describe('Counter — no runtime de verdade', () => {
  it('é atômico sob concorrência: 100 incrementos simultâneos viram 100', async () => {
    // ESTE é o teste que justifica a migração inteira. A mesma rajada contra
    // KV perdia contagem (leitura-modificação-escrita não atômica entre
    // isolates) e batia no teto de 1 escrita/s por chave.
    const chave = nome('views');
    const stub = env.COUNTER.get(env.COUNTER.idFromName(chave));

    await Promise.all(Array.from({ length: 100 }, () => stub.increment(1)));

    expect(await stub.value()).toBe(100);
  });

  it('persiste entre stubs diferentes — não é estado de isolate', async () => {
    const chave = nome('views');
    const id = env.COUNTER.idFromName(chave);

    await env.COUNTER.get(id).increment(7);
    // Stub novo, obtido do zero: se a contagem morasse na memória do isolate,
    // isto voltaria 0.
    expect(await env.COUNTER.get(id).value()).toBe(7);
  });

  it('objetos com nomes diferentes não compartilham contagem', async () => {
    const a = nome('views');
    const b = nome('views');
    await env.COUNTER.get(env.COUNTER.idFromName(a)).increment(3);
    await env.COUNTER.get(env.COUNTER.idFromName(b)).increment(5);
    expect(await env.COUNTER.get(env.COUNTER.idFromName(a)).value()).toBe(3);
    expect(await env.COUNTER.get(env.COUNTER.idFromName(b)).value()).toBe(5);
  });

  it('assenta a contagem herdada do KV na primeira vez que é tocado', async () => {
    // O caminho da migração de verdade: o valor estava no KV, o objeto nunca
    // foi usado, e a primeira chamada tem de adotar o que estava lá.
    const chave = nome('views');
    await env.FOTOS.put(chave, '742');

    const stub = env.COUNTER.get(env.COUNTER.idFromName(chave));
    await stub.increment(1);

    expect(await stub.value()).toBe(743);
  });

  it('assenta em 0 quando o valor herdado é lixo, em vez de guardar NaN', async () => {
    const chave = nome('views');
    await env.FOTOS.put(chave, 'NaN');

    const stub = env.COUNTER.get(env.COUNTER.idFromName(chave));
    await stub.increment(1);

    expect(await stub.value()).toBe(1);
  });

  it('só consulta o KV uma vez: mudar o KV depois não move a contagem', async () => {
    const chave = nome('views');
    await env.FOTOS.put(chave, '10');

    const stub = env.COUNTER.get(env.COUNTER.idFromName(chave));
    await stub.increment(1);          // assenta em 10, vira 11
    await env.FOTOS.put(chave, '999');       // alguém mexeu no KV velho
    await stub.increment(1);

    expect(await stub.value()).toBe(12);
  });

  it('reset zera e NÃO deixa a contagem antiga do KV ressuscitar', async () => {
    // Um objeto vazio é indistinguível de um objeto novo, e o assentamento
    // voltaria a ler o KV: apagar um projeto e recriar outro com o mesmo slug
    // traria a contagem velha de volta.
    const chave = nome('views');
    await env.FOTOS.put(chave, '742');

    const stub = env.COUNTER.get(env.COUNTER.idFromName(chave));
    await stub.increment(1);
    expect(await stub.value()).toBe(743);

    await stub.reset();

    expect(await stub.value()).toBe(0);
    expect(await stub.increment(1)).toBe(1);
  });
});

describe('RateLimiter — no runtime de verdade', () => {
  it('deixa passar até o limite e barra depois, na mesma janela', async () => {
    const stub = env.RATELIMIT.get(env.RATELIMIT.idFromName(nome('login')));
    const out = [];
    for (let i = 0; i < 5; i++) out.push(await stub.check(3, 600));
    expect(out).toEqual([true, true, true, false, false]);
  });

  it('conta certo sob concorrência — nunca deixa passar mais que o limite', async () => {
    // O modo de falha do KV era este: duas requisições liam a mesma contagem e
    // ambas passavam. Serializado, o excedente é barrado.
    const stub = env.RATELIMIT.get(env.RATELIMIT.idFromName(nome('drive')));
    const out = await Promise.all(Array.from({ length: 50 }, () => stub.check(10, 3600)));
    expect(out.filter(Boolean)).toHaveLength(10);
  });

  it('objetos diferentes (IP/chave) não dividem orçamento', async () => {
    const a = env.RATELIMIT.get(env.RATELIMIT.idFromName(nome('login')));
    const b = env.RATELIMIT.get(env.RATELIMIT.idFromName(nome('login')));
    expect(await a.check(1, 600)).toBe(true);
    expect(await a.check(1, 600)).toBe(false);
    expect(await b.check(1, 600)).toBe(true);
  });

  it('janela nova zera a contagem sem depender de TTL', async () => {
    // windowSecs=1 faz a janela virar em menos de um segundo de relógio.
    const stub = env.RATELIMIT.get(env.RATELIMIT.idFromName(nome('curta')));
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
    const stub = env.RATELIMIT.get(env.RATELIMIT.idFromName(nome('drive')));
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
    const stub = env.RATELIMIT.get(env.RATELIMIT.idFromName(nome('drive')));
    await stub.check(1, janelaSecs);

    await runInDurableObject(stub, async (_inst, state) => {
      const alarme = await state.storage.getAlarm();
      expect(alarme).toBeGreaterThan(antes + janelaSecs * 1000);
    });
  });

  it('não rearma a cada chamada — rearmar custa uma linha escrita por requisição', async () => {
    const stub = env.RATELIMIT.get(env.RATELIMIT.idFromName(nome('drive')));
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
    const stub = env.RATELIMIT.get(env.RATELIMIT.idFromName(nome('drive')));
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
    const stub = env.RATELIMIT.get(env.RATELIMIT.idFromName(nome('drive')));
    expect(await stub.check(1, 3600)).toBe(true);
    expect(await stub.check(1, 3600)).toBe(false);

    await runDurableObjectAlarm(stub);

    expect(await stub.check(1, 3600), 'janela nova, orçamento novo').toBe(true);
    expect(await stub.check(1, 3600), 'e o limite volta a valer').toBe(false);
  });
});

describe('Counter — durabilidade', () => {
  it('sobrevive a uma evicção sem reler o KV nem perder a contagem', async () => {
    // Evicção é rotina: o runtime descarta objetos ociosos e os reconstrói na
    // chamada seguinte. O construtor tem de adotar o que está no armazenamento
    // DELE, e não voltar a assentar do KV — senão uma edição no KV velho (ou um
    // reset) reapareceria como contagem.
    const chave = nome('views');
    await env.FOTOS.put(chave, '10');
    const id = env.COUNTER.idFromName(chave);

    await env.COUNTER.get(id).increment(1);        // assenta 10, vira 11
    await env.FOTOS.put(chave, '999');             // alguém mexeu no KV antigo

    await evictDurableObject(env.COUNTER.get(id));

    expect(await env.COUNTER.get(id).value(), 'adota o próprio estado, não o KV').toBe(11);
  });

  it('um contador zerado continua zerado depois de evicção', async () => {
    const chave = nome('views');
    await env.FOTOS.put(chave, '742');
    const id = env.COUNTER.idFromName(chave);

    await env.COUNTER.get(id).increment(1);
    await env.COUNTER.get(id).reset();

    await evictDurableObject(env.COUNTER.get(id));

    expect(await env.COUNTER.get(id).value(), 'o reset não pode ser desfeito por uma evicção').toBe(0);
  });
});
