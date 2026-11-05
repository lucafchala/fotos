// ExecutionContext de teste que GUARDA o que vai para waitUntil, em vez de
// descartar. Desde o item 1g a galeria serve a lista vencida e relê em segundo
// plano (ctx.waitUntil): quem quer ver o efeito da releitura espera por
// `drena()` depois da resposta, como o runtime faz depois de enviá-la.
export function ctxColetor() {
  /** @type {Promise<unknown>[]} */
  const pendentes = [];
  return {
    waitUntil(/** @type {Promise<unknown>} */ p) { pendentes.push(Promise.resolve(p).catch(() => {})); },
    /** Espera tudo o que foi agendado (inclusive o que for agendado enquanto espera). */
    async drena() {
      while (pendentes.length) await Promise.all(pendentes.splice(0));
    },
  };
}
