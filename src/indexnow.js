// IndexNow (v3.11.0, pedido do dono: "quero a galeria indexada em tudo").
//
// Bing, Yandex, Seznam, Naver e Yep aceitam um aviso direto quando uma página
// entra ou sai, em vez de esperar o próximo rastreio. O Google NÃO participa
// do IndexNow: para ele seguem valendo o sitemap e o robots.txt.
//
// Como funciona aqui: o cron calcula as URLs públicas (as mesmas do sitemap,
// mais os eventos de cada galeria — ver urlsDoIndexNow em src/index.js),
// compara com a última lista avisada (KV `indexnow:avisadas`) e manda só a
// diferença. A URL que SAIU também vai: o buscador relê, vê o 404/noindex e
// tira do índice mais cedo (foto ou álbum retirado some antes).
//
// Custo: uma leitura de KV por passada; gravação só quando a lista muda e o
// aviso foi aceito. Sem mudança, zero gravações (o KV tem 1.000/dia, dividido
// com o resto da conta).

// A chave do IndexNow é PÚBLICA por desenho: o buscador confere que ela está
// em https://<host>/<chave>.txt para saber que o aviso veio do dono do site.
// Não é segredo, não vai para o wrangler secret. Trocar a chave exige só um
// deploy (o arquivo e o aviso usam esta mesma constante).
export const INDEXNOW_CHAVE = '824ae18acafda5c29ca670b0a7c4ce14';
export const INDEXNOW_ENDPOINT = 'https://api.indexnow.org/indexnow';
export const INDEXNOW_KV = 'indexnow:avisadas';
// O protocolo aceita até 10.000 URLs por pedido.
const INDEXNOW_MAX_POR_PEDIDO = 10_000;

/** O caminho do arquivo da chave, em qualquer domínio do site. */
export const INDEXNOW_CAMINHO = `/${INDEXNOW_CHAVE}.txt`;

/**
 * Ligado só onde o wrangler.toml diz (`INDEXNOW = "ligado"` em [vars]): a
 * prévia não tem a variável (e o cron nem roda lá), e os testes e o Worker
 * local também não — nenhum deles pode avisar os buscadores de produção.
 * @param {{ INDEXNOW?: string } | null | undefined} env
 */
export function indexNowLigado(env) {
  return !!env && String(env.INDEXNOW || '').trim().toLowerCase() === 'ligado';
}

/**
 * Passada do cron que avisa: a cada 15 min (o cron roda a cada 5). Sem
 * `scheduledTime` (chamada direta, como nos testes) conta como passada.
 * @param {{ scheduledTime?: number } | undefined} event
 */
export function ehPassadaDoIndexNow(event) {
  const t = event && event.scheduledTime;
  if (typeof t !== 'number') return true;
  return new Date(t).getUTCMinutes() % 15 < 5;
}

/** O arquivo da chave: texto puro, só a chave. */
export function respostaDaChave() {
  return new Response(INDEXNOW_CHAVE, {
    headers: { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'public, max-age=86400', 'X-Content-Type-Options': 'nosniff' },
  });
}

/**
 * O que mudou entre a última lista avisada e a de agora: entradas e saídas,
 * sem repetição, em ordem.
 * @param {string[]} antes @param {string[]} agora
 */
export function diferenca(antes, agora) {
  const a = new Set(antes);
  const b = new Set(agora);
  return [...new Set([...agora.filter(u => !a.has(u)), ...antes.filter(u => !b.has(u))])].sort();
}

/**
 * Um pedido por domínio: o protocolo exige que toda URL da lista seja do
 * `host` do pedido, com a chave publicada naquele host.
 * @param {string[]} urls
 * @returns {Map<string, string[]>}
 */
export function porDominio(urls) {
  /** @type {Map<string, string[]>} */
  const m = new Map();
  for (const u of urls) {
    let host;
    try { host = new URL(u).host; } catch { continue; }
    const lista = m.get(host) || [];
    lista.push(u);
    m.set(host, lista);
  }
  return m;
}

/**
 * Avisa o IndexNow do que mudou. A lista nova só é gravada se TODO domínio
 * foi aceito (200 ou 202 — este é "chave ainda em verificação"); com falha,
 * nada é gravado e a próxima passada manda de novo (repetir um aviso é
 * inofensivo, perder um não).
 *
 * `urlsAgora` null quer dizer "não deu para saber a lista" (Drive fora no
 * meio do cálculo): não avisa nada, para não anunciar como retirada uma
 * página que só não foi lida.
 * @param {{ FOTOS: KVNamespace }} env
 * @param {string[] | null} urlsAgora
 * @param {typeof fetch} [buscar]
 * @returns {Promise<{ avisadas: number, falhas: string[] }>}
 */
export async function avisaIndexNow(env, urlsAgora, buscar = fetch) {
  if (!urlsAgora) return { avisadas: 0, falhas: [] };
  const agora = [...new Set(urlsAgora)].sort();
  /** @type {string[]} */
  let antes = [];
  const guardado = await env.FOTOS.get(INDEXNOW_KV);
  if (guardado) {
    try {
      const v = JSON.parse(guardado);
      if (Array.isArray(v)) antes = v.filter(x => typeof x === 'string');
    } catch { /* lista corrompida: trata como vazia e reavisa tudo uma vez */ }
  }
  const mudou = diferenca(antes, agora);
  if (!mudou.length) return { avisadas: 0, falhas: [] };

  /** @type {string[]} */
  const falhas = [];
  for (const [host, urls] of porDominio(mudou)) {
    for (let i = 0; i < urls.length; i += INDEXNOW_MAX_POR_PEDIDO) {
      const urlList = urls.slice(i, i + INDEXNOW_MAX_POR_PEDIDO);
      try {
        const r = await buscar(INDEXNOW_ENDPOINT, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json; charset=utf-8' },
          body: JSON.stringify({ host, key: INDEXNOW_CHAVE, keyLocation: `https://${host}${INDEXNOW_CAMINHO}`, urlList }),
        });
        if (r.status !== 200 && r.status !== 202) falhas.push(`${host}: HTTP ${r.status}`);
      } catch (e) {
        falhas.push(`${host}: ${e instanceof Error ? e.message : String(e)}`);
      }
    }
  }
  if (falhas.length) return { avisadas: 0, falhas };
  await env.FOTOS.put(INDEXNOW_KV, JSON.stringify(agora));
  return { avisadas: mudou.length, falhas };
}
