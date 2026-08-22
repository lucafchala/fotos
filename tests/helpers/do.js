import { Counter, RateLimiter } from '../../src/counters.js';

// Namespaces de Durable Object de mentira para a suíte.
//
// A escolha que importa: estes ajudantes instanciam as classes DE VERDADE
// (src/counters.js) sobre um armazenamento em memória, em vez de reimplementar
// o comportamento delas. Um dublê que reimplementa a lógica passa a testar a si
// mesmo — e foi assim que a contagem já quebrou duas vezes neste projeto sem a
// suíte perceber (RETOMADA §5.3).
//
// A serialização por objeto é reproduzida (`serialized` abaixo): é o contrato
// que o runtime garante e a razão de o incremento ser atômico. Sem ela o dublê
// perderia contagem numa rajada e o teste estaria medindo o dublê, não o
// código — exatamente ao contrário do que a migração para Durable Object faz.
// O que NÃO é reproduzido é o isolamento físico entre objetos.

// Só a superfície de `ctx.storage` que as classes usam.
function fakeStorage() {
  const m = new Map();
  let alarme = null;
  return {
    async get(k) { return m.get(k); },
    async put(k, v) { m.set(k, v); },
    async delete(k) { return m.delete(k); },
    // Devolve uma cópia: o Counter guarda o resultado de `list()` como espelho
    // em memória, e entregar o Map interno faria os dois virarem o mesmo
    // objeto — o dublê esconderia qualquer escrita que esquecesse o storage.
    async list() { return new Map(m); },
    async deleteAll() { m.clear(); },
    // O alarme é o que devolve a limpeza automática que o `expirationTtl` do KV
    // fazia. Aqui ele é só REGISTRADO — a suíte `unit` afirma que foi armado, e
    // quando; que ele dispara e apaga é afirmado na suíte `workers`, contra o
    // agendador de verdade.
    async setAlarm(t) { alarme = t; },
    async getAlarm() { return alarme; },
    async deleteAlarm() { alarme = null; },
    _map: m,
    _alarme: () => alarme,
  };
}

// `ctx` de mentira. Dois detalhes que não são enfeite:
//
//   • `id.name` — usado pelo RateLimiter e pelo endereçamento. O Counter é um
//     objeto só ('contadores'), e a chave de cada contagem vai por parâmetro.
//   • `blockConcurrencyWhile` — o construtor represa os outros eventos
//     enquanto assenta. Aqui a promessa é guardada e vira o começo da fila de
//     serialização, que é o efeito que ela tem no runtime.
function fakeCtx(name, storage = fakeStorage()) {
  const portao = [];
  return {
    id: { name },
    storage,
    blockConcurrencyWhile(fn) {
      const p = Promise.resolve().then(fn);
      portao.push(p);
      return p;
    },
    _portao: () => Promise.all(portao),
  };
}

// Enfileira as chamadas de um objeto, uma de cada vez. É o que o runtime faz
// com um Durable Object, e é de onde vem a atomicidade do incremento: sem isto,
// `read` e `write` de duas chamadas se intercalam e a contagem se perde.
function serialized(instance, inicial, contar) {
  let fila = inicial || Promise.resolve();
  return new Proxy(instance, {
    get(target, prop) {
      const v = target[prop];
      if (typeof v !== 'function') return v;
      return (...args) => {
        if (contar) contar(prop);
        const corrida = fila.then(() => v.apply(target, args));
        fila = corrida.catch(() => {});
        return corrida;
      };
    },
  });
}

// Uma instância por nome, criada sob demanda — que é o contrato do
// `idFromName`/`get` de verdade: mesmo nome, mesmo objeto, armazenamento
// próprio.
export function fakeDONamespace(Klass, env) {
  const instances = new Map();
  // Conta TODA chamada de método que passa pelo dublê. Existe porque uma
  // chamada de Durable Object é uma subrequisição, e o plano gratuito permite
  // 50 por invocação: um teste que só olha o RESULTADO não vê o painel de
  // métricas voltar a estourar o teto. Contar aqui, e não instrumentando o
  // stub no teste, evita reentrar na fila de serialização (isso trava).
  /** @type {string[]} */
  const chamadas = [];
  return {
    _calls: () => chamadas.slice(),
    _resetCalls: () => { chamadas.length = 0; },
    idFromName: name => name,
    get(name) {
      if (!instances.has(name)) {
        const ctx = fakeCtx(name);
        // A fila começa no portão do construtor: nenhuma chamada corre antes
        // de o assentamento terminar, que é o contrato do
        // `blockConcurrencyWhile`.
        instances.set(name, serialized(new Klass(ctx, env), ctx._portao(), m => chamadas.push(m)));
      }
      return instances.get(name);
    },
    // Simula uma EVICÇÃO: o objeto é destruído e reconstruído, mas o
    // armazenamento sobrevive — que é exatamente o que o runtime faz quando um
    // objeto fica ocioso. É o único jeito de exercitar o que o construtor faz
    // com um estado já existente (adotar, ou recusar se estiver corrompido).
    _evict(name) {
      const atual = instances.get(name);
      if (!atual) return;
      const ctx = fakeCtx(name, atual.ctx.storage);
      instances.set(name, serialized(new Klass(ctx, env), ctx._portao(), m => chamadas.push(m)));
    },
    _instances: instances,
  };
}

// Namespace que recusa toda chamada, para exercitar o caminho de degradação
// (contador que não grava, rate limit que falha aberto).
export function brokenDONamespace(message = 'DO indisponível') {
  return {
    idFromName: name => name,
    get() {
      return {
        async increment() { throw new Error(message); },
        async value() { throw new Error(message); },
        async snapshot() { throw new Error(message); },
        async seed() { throw new Error(message); },
        async remove() { throw new Error(message); },
        async check() { throw new Error(message); },
      };
    },
  };
}

// Monta o `env` completo em volta de um KV já pronto. Os namespaces fecham
// sobre o MESMO objeto `env`, então o assentamento inicial (que lê o contador
// antigo do KV) enxerga o `FOTOS` que o teste montou.
export function withDurableObjects(env) {
  env.COUNTER = fakeDONamespace(Counter, env);
  env.RATELIMIT = fakeDONamespace(RateLimiter, env);
  return env;
}
