// Cache API de mentira: um Map com a mesma superfície que o `caches.default` do
// Workers. Em vitest `caches` não existe, e sem isto os caminhos que só rodam
// num isolate frio — a cópia de sobrevivência da lista de eventos
// (tests/kv.test.js) e a lista da pasta da galeria própria
// (tests/galeria.test.js) — nunca rodariam em teste nenhum.
//
// Mora aqui porque as duas suítes precisam dele: importar um .test.js de
// dentro de outro registraria os testes dele de novo, em dobro.
export function fakeCaches() {
  /** @type {Map<string, string>} */
  const store = new Map();
  return {
    _store: store,
    default: {
      /** @param {string | Request | URL} key @param {Response} res */
      async put(key, res) { store.set(String(key), await res.text()); },
      /** @param {string | Request | URL} key */
      async match(key) {
        const v = store.get(String(key));
        return v === undefined ? undefined : new Response(v);
      },
    },
  };
}
