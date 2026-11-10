// Um bucket R2 de mentira, só com o que o site usa: get, put, delete (uma
// chave ou uma lista) e list por prefixo. Guarda os objetos num Map, para o
// teste conferir o que ficou e o que foi apagado.

/**
 * @param {Record<string, string>} [inicial] chave → conteúdo
 */
export function r2Falso(inicial = {}) {
  /** @type {Map<string, { corpo: string, tipo: string }>} */
  const objetos = new Map(Object.entries(inicial).map(([k, v]) => [k, { corpo: v, tipo: 'image/webp' }]));
  /** @type {string[]} */
  const gravadas = [];
  /** @type {string[]} */
  const apagadas = [];
  return {
    objetos,
    gravadas,
    apagadas,
    async get(/** @type {string} */ k) {
      const o = objetos.get(k);
      return o ? { body: new Response(o.corpo).body, size: o.corpo.length, httpMetadata: { contentType: o.tipo } } : null;
    },
    async put(/** @type {string} */ k, /** @type {any} */ corpo, /** @type {any} */ opcoes = {}) {
      const texto = typeof corpo === 'string' ? corpo : await new Response(corpo).text();
      objetos.set(k, { corpo: texto, tipo: (opcoes.httpMetadata && opcoes.httpMetadata.contentType) || '' });
      gravadas.push(k);
      return {};
    },
    async delete(/** @type {string | string[]} */ k) {
      for (const chave of Array.isArray(k) ? k : [k]) { objetos.delete(chave); apagadas.push(chave); }
    },
    async list(/** @type {{ prefix?: string }} */ o = {}) {
      const prefixo = o.prefix || '';
      return { objects: [...objetos.keys()].filter(k => k.startsWith(prefixo)).map(key => ({ key })), truncated: false };
    },
  };
}
