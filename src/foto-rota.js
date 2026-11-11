// As fotos pelo próprio site (v3.8.3): GET /f/<id>/<largura>[j]?k=<álbum>.<assinatura>
//
// Por quê: a miniatura do lh3.googleusercontent.com leva de 0,7 a 2 s (o
// Google redimensiona na hora) e, com mil pessoas abrindo o álbum no mesmo
// dia, cada uma pediria o mesmo arquivo ao Google. Aqui o primeiro pedido de
// cada tamanho vai ao Google; os seguintes saem do cache da Cloudflare, no
// data center de quem pede, e do R2 (binding FOTOS_R2), na chave
// `w/<id>/<largura>.<webp|jpg>`. Sem o objeto (ou sem o binding), segue para o
// Google.
//
// PRESA AOS ÁLBUNS DO SITE (v3.8.8). Até a 3.8.7 a rota servia QUALQUER ID do
// Drive: era um proxy aberto (qualquer imagem pública do Google, com o nosso
// domínio na frente e uma cópia eterna no R2), e uma foto oculta ou removida
// continuava saindo daqui. Agora o endereço leva `k=<slug>.<assinatura>`, e
// quem chama (handleFoto, em index.js) confere, NESTA ordem e antes de
// qualquer leitura de cache, do R2 ou do Google:
//   1. a assinatura: HMAC de (álbum, foto) com o segredo do site, emitida só
//      pelas páginas que montam o endereço (`assinadorDeFotos`);
//   2. o álbum: existe e o público pode vê-lo (a regra única do site,
//      albumAbertoAoPublico) — fechado, só quem a galeria também deixaria ver;
//   3. a foto não está em `fotosOcultas` (oculta, só o dono e a editora).
// Sem isso: 404, sem buscar no Google e sem gravar no R2. A assinatura não tem
// prazo (o endereço precisa ser estável para o cache do navegador), por isso
// os itens 2 e 3 são conferidos a cada pedido.
//
// Sem limite por IP de propósito (ver a auditoria em config.js: ver fotos não
// pode barrar 300 pessoas atrás do mesmo Wi-Fi). O que limita o abuso: a
// assinatura, só larguras de uma lista fechada (cache finito por foto) e só
// imagem como resposta.
import { idDriveValido } from './drive.js';
import { assinaCurta, confereCurta } from './security.js';

/** As larguras servidas; o pedido sobe para a próxima da lista. */
export const FOTO_LARGURAS = [160, 200, 240, 300, 320, 360, 400, 480, 500, 600, 640, 700, 800, 900, 960, 1000, 1200, 1280, 1600, 2048, 2400, 2560, 3200, 4096, 5120, 6400];
/**
 * Quanto a foto fica no navegador e no cache da Cloudflare: 4 h (v3.8.8). Eram
 * 7 dias com `immutable`, e uma foto removida continuava aparecendo por uma
 * semana em quem já a tinha visto. Com 4 h, a remoção vale "em horas": quem
 * volta no mesmo dia ainda usa o que já baixou, e depois disso o navegador pede
 * de novo — e o pedido passa de novo pela conferência (álbum aberto, foto não
 * oculta). O preço é baixar a miniatura outra vez depois de 4 h, do cache da
 * Cloudflare ou do R2, sem chamar o Google. A cópia que dura é a do R2, e ela
 * é apagada quando a foto é ocultada ou removida (apagaCopiasDaFoto).
 */
export const FOTO_CACHE_S = 4 * 3600;

const ROTA = /^\/f\/([A-Za-z0-9_-]{10,200})\/([0-9]{1,5})(j?)$/;

const SLUG_DA_CHAVE = /^[a-z0-9][a-z0-9-]{0,99}$/;

/**
 * O endereço de uma foto no próprio site (WebP), para as páginas. `assina` vem
 * de `assinadorDeFotos`; sem ele o endereço sai sem `k` e a rota responde 404.
 * @param {string} id @param {number} w
 * @param {(id: string) => string} [assina]
 */
export function urlFoto(id, w, assina) {
  const k = assina ? assina(id) : '';
  return `/f/${id}/${larguraServida(Math.round(w))}${k ? `?k=${k}` : ''}`;
}

/**
 * O parâmetro `k` de um endereço: `<slug>.<assinatura>`, ou só `<slug>` (sem
 * o segredo de assinatura no Worker).
 * @param {unknown} k
 * @returns {{ slug: string, assinatura: string } | null}
 */
export function lerChaveFoto(k) {
  if (typeof k !== 'string' || !k || k.length > 200) return null;
  const ponto = k.indexOf('.');
  const slug = ponto < 0 ? k : k.slice(0, ponto);
  if (!SLUG_DA_CHAVE.test(slug)) return null;
  return { slug, assinatura: ponto < 0 ? '' : k.slice(ponto + 1) };
}

// As assinaturas já calculadas neste isolate: a página de um evento pede até
// 6 mil de uma vez, e a seguinte pede as mesmas. Trocou o segredo, esvazia.
/** @type {Map<string, Map<string, string>>} */
const assinaturas = new Map();
let totalDeAssinaturas = 0;
let segredoDasAssinaturas = '';
const ASSINATURAS_MAX = 60_000;
const ASSINATURAS_LOTE = 500;

/**
 * Assina as fotos de um álbum e devolve a função (síncrona, para os modelos
 * de página) que dá o `k` de cada uma: `<slug>.<assinatura>`. ID que não foi
 * pedido aqui sai '' (a página não pode assinar o que não listou). Sem o
 * segredo, o `k` é só o slug: a assinatura fica desligada, como o nonce do
 * Drive e os tokens de formulário (o /api/healthz acusa), e o resto da
 * conferência da rota continua valendo.
 * @param {string | null} secret
 * @param {string} slug
 * @param {Iterable<string>} ids
 * @returns {Promise<(id: string) => string>}
 */
export async function assinadorDeFotos(secret, slug, ids) {
  if (!SLUG_DA_CHAVE.test(slug)) return () => '';
  if (!secret) return () => slug;
  if (secret !== segredoDasAssinaturas || totalDeAssinaturas > ASSINATURAS_MAX) {
    assinaturas.clear();
    totalDeAssinaturas = 0;
    segredoDasAssinaturas = secret;
  }
  // Um mapa por álbum, com o ID como chave: no caminho quente (a página de
  // 6 mil fotos já assinada neste isolate) cada foto custa uma consulta, sem
  // montar texto nem conferir o formato de novo (o que está aqui já passou).
  // Percorrida duas vezes (aqui e, se preciso, em `pedidas`): um iterador de uso único não serviria.
  const lista = Array.isArray(ids) ? ids : [...ids];
  let doAlbum = assinaturas.get(slug);
  if (!doAlbum) { doAlbum = new Map(); assinaturas.set(slug, doAlbum); }
  /** @type {string[]} */
  const faltam = [];
  /** @type {Set<string>} */
  const vistas = new Set();
  for (const id of lista) {
    if (doAlbum.has(id)) continue;
    if (typeof id !== 'string' || vistas.has(id) || !idDriveValido(id)) continue;
    vistas.add(id);
    faltam.push(id);
  }
  // Em lotes: milhares de promessas pendentes de uma vez só gastam memória.
  for (let i = 0; i < faltam.length; i += ASSINATURAS_LOTE) {
    const lote = faltam.slice(i, i + ASSINATURAS_LOTE);
    const feitas = await Promise.all(lote.map(id => assinaCurta(secret, 'foto', `${slug}|${id}`)));
    lote.forEach((id, j) => { /** @type {Map<string, string>} */ (doAlbum).set(id, feitas[j]); });
    totalDeAssinaturas += lote.length;
  }
  const mapa = doAlbum;
  // Só o que ESTA chamada pediu (a página não assina o que não listou). O
  // conjunto é montado na primeira consulta: quem só usa `crua` não paga por ele.
  /** @type {Set<string> | null} */
  let pedidas = null;
  /** @type {((id: string) => string) & { crua?: (id: string) => string }} */
  const assina = id => {
    if (!pedidas) pedidas = new Set(lista);
    const a = pedidas.has(id) ? mapa.get(id) : '';
    return a ? `${slug}.${a}` : '';
  };
  // Só a assinatura, sem o álbum na frente e sem conferir se o ID foi pedido
  // nesta chamada: é para quem percorre A MESMA lista que passou aqui (a página
  // de um evento junta milhares num campo só: assinaturasDaSecao, em
  // src/ui/galeria.js). Nunca para um ID que veio de fora.
  assina.crua = id => mapa.get(id) || '';
  return assina;
}

/**
 * A assinatura do endereço confere com (álbum, foto)?
 * @param {string} secret @param {string} slug @param {string} id @param {string} assinatura
 */
export function assinaturaDaFotoConfere(secret, slug, id, assinatura) {
  return confereCurta(secret, assinatura, 'foto', `${slug}|${id}`);
}

/** @param {number} w */
export function larguraServida(w) {
  return FOTO_LARGURAS.find(x => x >= w) || FOTO_LARGURAS[FOTO_LARGURAS.length - 1];
}

/**
 * @param {string} path
 * @returns {{ id: string, w: number, jpeg: boolean } | null}
 */
export function lerRotaFoto(path) {
  const m = ROTA.exec(path);
  if (!m || !idDriveValido(m[1])) return null;
  const pedida = Number(m[2]);
  if (!(pedida >= 1)) return null;
  return { id: m[1], w: larguraServida(pedida), jpeg: m[3] === 'j' };
}

/**
 * @param {string} tipo @param {string} [origem]
 * @param {'navegador' | 'nunca'} [privado] ver respondeFoto
 */
function cabecalhos(tipo, origem = '', privado = undefined) {
  return {
    'Content-Type': tipo,
    // Sem `immutable`: passado o prazo, o navegador pede de novo (ver FOTO_CACHE_S).
    'Cache-Control': privado === 'nunca' ? 'private, no-store' : `${privado ? 'private' : 'public'}, max-age=${FOTO_CACHE_S}`,
    'X-Content-Type-Options': 'nosniff',
    'Cross-Origin-Resource-Policy': 'same-site',
    ...(privado ? { 'X-Robots-Tag': 'noindex' } : {}),
    ...(origem ? { 'X-Foto-Origem': origem } : {}),
  };
}

/**
 * @param {Request} request
 * @param {{ FOTOS_R2?: any }} env
 * @param {{ waitUntil(p: Promise<any>): void }} ctx
 * @param {{ id: string, w: number, jpeg: boolean }} alvo
 * @param {{ fetch?: typeof fetch, cache?: any, privado?: 'navegador' | 'nunca' }} [deps]
 *   `fetch` e `cache`: para os testes. `privado`: quem chama já conferiu o
 *   acesso (handleFoto) e esta resposta não é do público:
 *    - 'navegador' (álbum ainda fechado, visto pela prévia, pela editora ou
 *      pelo dono): só o navegador de quem pediu guarda;
 *    - 'nunca' (foto OCULTA, vista pelo dono ou pela editora): ninguém guarda,
 *      e nada é gravado no cache da Cloudflare nem no R2 — ocultar apagou as
 *      cópias de lá, e ver a foto no painel não pode trazê-las de volta.
 * @returns {Promise<Response>}
 */
export async function respondeFoto(request, env, ctx, alvo, deps = {}) {
  const f = deps.fetch || fetch;
  const cache = deps.cache !== undefined ? deps.cache : (typeof caches !== 'undefined' ? /** @type {any} */ (caches).default : null);
  const privado = deps.privado;
  const guarda = privado !== 'nunca';
  // A chave do cache é a da largura servida: /f/X/350 e /f/X/360 viram uma só
  // (e o `k` não entra: a conferência já foi feita, o arquivo é o mesmo).
  const u = new URL(request.url);
  const chave = new Request(`${u.origin}/f/${alvo.id}/${alvo.w}${alvo.jpeg ? 'j' : ''}`, { method: 'GET' });
  if (cache) {
    const guardada = await cache.match(chave).catch(() => null);
    // Os cabeçalhos são os DESTE pedido: a cópia foi guardada como pública.
    if (guardada) return new Response(guardada.body, { headers: cabecalhos(guardada.headers.get('Content-Type') || (alvo.jpeg ? 'image/jpeg' : 'image/webp'), 'cache', privado) });
  }
  // 1. R2, quando existir.
  if (env.FOTOS_R2) {
    try {
      const obj = await env.FOTOS_R2.get(`w/${alvo.id}/${alvo.w}.${alvo.jpeg ? 'jpg' : 'webp'}`);
      if (obj) {
        const tipoR2 = alvo.jpeg ? 'image/jpeg' : 'image/webp';
        if (cache && guarda) {
          const [paraQuemPediu, paraOCache] = obj.body.tee();
          ctx.waitUntil(cache.put(chave, new Response(paraOCache, { headers: cabecalhos(tipoR2, 'r2') })).catch(() => {}));
          return new Response(paraQuemPediu, { headers: cabecalhos(tipoR2, 'r2', privado) });
        }
        return new Response(obj.body, { headers: cabecalhos(tipoR2, 'r2', privado) });
      }
    } catch (e) {
      console.error('foto: R2 falhou, vai ao Google', e);
    }
  }
  // 2. O Google (lh3), com o cache da Cloudflare na frente.
  const origem = `https://lh3.googleusercontent.com/d/${alvo.id}=w${alvo.w}${alvo.jpeg ? '' : '-rw'}`;
  let r;
  try {
    r = await f(origem, guarda ? { cf: { cacheEverything: true, cacheTtl: FOTO_CACHE_S } } : {});
  } catch {
    return new Response('Foto indisponível agora.', { status: 502, headers: { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store' } });
  }
  const tipo = r.headers.get('Content-Type') || '';
  if (!r.ok || !tipo.startsWith('image/')) {
    // 404/403 do Google (foto apagada ou fechada) ou página de erro: não vira
    // cache e não repassa o corpo de lá.
    return new Response('Foto indisponível.', { status: r.status === 404 || r.status === 403 ? 404 : 502, headers: { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store' } });
  }
  if (!guarda) return new Response(r.body, { headers: cabecalhos(tipo, 'google', privado) });
  // A cópia que vai para o cache e para o R2 leva os cabeçalhos PÚBLICOS; a
  // resposta de quem pediu, os dele.
  const publica = new Response(r.body, { headers: cabecalhos(tipo, 'google') });
  const res = privado ? new Response(publica.clone().body, { headers: cabecalhos(tipo, 'google', privado) }) : publica;
  if (cache) ctx.waitUntil(cache.put(chave, publica.clone()).catch(() => {}));
  // Com o R2: a primeira vez de cada tamanho também vai para lá (a miniatura
  // é pequena; a cópia em memória não pesa). Daí em diante o Google não é
  // mais chamado para ela, nem em outro data center.
  if (env.FOTOS_R2) {
    const copia = publica.clone();
    ctx.waitUntil(copia.arrayBuffer()
      .then(b => env.FOTOS_R2.put(`w/${alvo.id}/${alvo.w}.${alvo.jpeg ? 'jpg' : 'webp'}`, b, { httpMetadata: { contentType: tipo } }))
      .catch((/** @type {unknown} */ e) => console.error('foto: cópia no R2 falhou', e)));
  }
  return res;
}

/** Original maior que isto (vídeo longo) não vai para o R2: fica no Drive. */
export const R2_ORIGINAL_MAX = 512 * 1024 * 1024;

/**
 * O ORIGINAL guardado no R2 (o "Baixar" da galeria), se existir.
 * @param {{ FOTOS_R2?: any }} env @param {string} id
 * @returns {Promise<{ body: ReadableStream | null, size: number, tipo: string } | null>}
 */
export async function originalDoR2(env, id) {
  if (!env.FOTOS_R2) return null;
  try {
    const o = await env.FOTOS_R2.get(`o/${id}`);
    return o ? { body: o.body, size: Number(o.size) || 0, tipo: (o.httpMetadata && o.httpMetadata.contentType) || 'application/octet-stream' } : null;
  } catch (e) {
    console.error('baixar: R2 falhou, vai ao Drive', e);
    return null;
  }
}

/**
 * Copia o original do Drive para o R2, depois de entregar o primeiro download
 * (v3.8.3). Uma segunda leitura do Drive, direto para o R2: o site não segura
 * o arquivo na memória (dividir o mesmo corpo entre o visitante e o R2 faria
 * isso quando o celular é mais lento que o R2).
 * @param {{ FOTOS_R2?: any }} env
 * @param {string} id
 * @param {string} url o endereço do original no Drive (com a chave)
 * @param {Record<string, string>} headers
 * @param {number} tamanho Content-Length do Drive
 * @param {string} tipo
 * @param {typeof fetch} [f]
 */
export async function copiaOriginalParaR2(env, id, url, headers, tamanho, tipo, f = fetch) {
  if (!env.FOTOS_R2 || !(tamanho > 0) || tamanho > R2_ORIGINAL_MAX) return false;
  try {
    const r = await f(url, { headers });
    if (!r.ok || !r.body) return false;
    await env.FOTOS_R2.put(`o/${id}`, r.body, { httpMetadata: { contentType: tipo } });
    return true;
  } catch (e) {
    console.error('baixar: cópia do original no R2 falhou', e);
    return false;
  }
}

/**
 * Apaga do R2 as cópias de fotos que saíram do site (v3.8.8): as miniaturas
 * (`w/<id>/…`, todas as larguras e os dois formatos — listadas pelo prefixo,
 * para não depender da lista de larguras de hoje) e o original (`o/<id>`).
 * Chamado quando a foto é ocultada, removida por um pedido ou some do Drive.
 * Sem isso a cópia ficava para sempre, mesmo com o arquivo apagado no Google.
 * LANÇA se o R2 recusar: quem chama registra (uma remoção que não apagou a
 * cópia não pode passar calada).
 * @param {{ FOTOS_R2?: any }} env
 * @param {Iterable<string>} ids
 * @returns {Promise<number>} quantos objetos foram apagados
 */
export async function apagaCopiasDaFoto(env, ids) {
  if (!env || !env.FOTOS_R2) return 0;
  const lista = [...new Set(ids)].filter(id => typeof id === 'string' && idDriveValido(id));
  let apagados = 0;
  for (const id of lista) {
    /** @type {string[]} */
    const chaves = [`o/${id}`];
    /** @type {string | undefined} */
    let cursor;
    do {
      const pagina = await env.FOTOS_R2.list({ prefix: `w/${id}/`, ...(cursor ? { cursor } : {}) });
      for (const o of pagina.objects || []) chaves.push(o.key);
      cursor = pagina.truncated ? pagina.cursor : undefined;
    } while (cursor);
    // O R2 apaga até 1000 chaves por chamada.
    for (let i = 0; i < chaves.length; i += 1000) await env.FOTOS_R2.delete(chaves.slice(i, i + 1000));
    apagados += chaves.length;
  }
  return apagados;
}
