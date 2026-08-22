// `cloudflare:workers` só existe dentro do workerd. A suíte roda em vitest
// puro (node), como o resto do projeto, então este módulo ocupa o lugar dele —
// mapeado por `resolve.alias` no vitest.config.js.
//
// A classe base de verdade só guarda `ctx` e `env` e expõe os métodos que a
// subclasse define; é exatamente isso que está reproduzido aqui. O que NÃO é
// reproduzido é o isolamento e a serialização do runtime — quem depende deles
// (a atomicidade do incremento) é garantido pela plataforma, não por esta
// classe, e por isso não é o que os testes afirmam.
export class DurableObject {
  constructor(ctx, env) {
    this.ctx = ctx;
    this.env = env;
  }
}
