// As fotos pelo próprio site (v3.8.3): GET /f/<id>/<largura>[j].
//
// Por quê: a miniatura do lh3.googleusercontent.com leva de 0,7 a 2 s (o
// Google redimensiona na hora) e, com mil pessoas abrindo o álbum no mesmo
// dia, cada uma pediria o mesmo arquivo ao Google. Aqui o primeiro pedido de
// cada tamanho vai ao Google; os seguintes saem do cache da Cloudflare, no
// data center de quem pede.
//
// Pronto para o R2 (quando existir, binding FOTOS_R2): a rota lê primeiro de
// lá, na chave `w/<id>/<largura>.<webp|jpg>`; sem o objeto (ou sem o binding),
// segue para o Google como hoje. Nada mais muda nas páginas.
//
// Sem limite por IP de propósito (ver a auditoria em config.js: ver fotos não
// pode barrar 300 pessoas atrás do mesmo Wi-Fi). O que limita o abuso: só ID
// do Drive válido, só larguras de uma lista fechada (cache finito por foto) e
// só imagem como resposta.
import { idDriveValido } from './drive.js';

/** As larguras servidas; o pedido sobe para a próxima da lista. */
export const FOTO_LARGURAS = [160, 200, 240, 300, 320, 360, 400, 480, 500, 600, 640, 700, 800, 900, 960, 1000, 1200, 1280, 1600, 2048, 2400, 2560, 3200, 4096, 5120, 6400];
/** Uma semana no cache da Cloudflare e no navegador; a foto do Drive não muda. */
export const FOTO_CACHE_S = 7 * 86400;

const ROTA = /^\/f\/([A-Za-z0-9_-]{10,200})\/([0-9]{1,5})(j?)$/;

/**
 * O endereço de uma foto no próprio site (WebP), para as páginas.
 * @param {string} id @param {number} w
 */
export function urlFoto(id, w) {
  return `/f/${id}/${larguraServida(Math.round(w))}`;
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

/** @param {string} tipo @param {string} [origem] */
function cabecalhos(tipo, origem = '') {
  return {
    'Content-Type': tipo,
    'Cache-Control': `public, max-age=${FOTO_CACHE_S}, immutable`,
    'X-Content-Type-Options': 'nosniff',
    'Cross-Origin-Resource-Policy': 'same-site',
    ...(origem ? { 'X-Foto-Origem': origem } : {}),
  };
}

/**
 * @param {Request} request
 * @param {{ FOTOS_R2?: any }} env
 * @param {{ waitUntil(p: Promise<any>): void }} ctx
 * @param {{ id: string, w: number, jpeg: boolean }} alvo
 * @param {{ fetch?: typeof fetch, cache?: any }} [deps] para os testes
 * @returns {Promise<Response>}
 */
export async function respondeFoto(request, env, ctx, alvo, deps = {}) {
  const f = deps.fetch || fetch;
  const cache = deps.cache !== undefined ? deps.cache : (typeof caches !== 'undefined' ? /** @type {any} */ (caches).default : null);
  // A chave do cache é a da largura servida: /f/X/350 e /f/X/360 viram uma só.
  const u = new URL(request.url);
  const chave = new Request(`${u.origin}/f/${alvo.id}/${alvo.w}${alvo.jpeg ? 'j' : ''}`, { method: 'GET' });
  if (cache) {
    const guardada = await cache.match(chave).catch(() => null);
    if (guardada) return guardada;
  }
  // 1. R2, quando existir.
  if (env.FOTOS_R2) {
    try {
      const obj = await env.FOTOS_R2.get(`w/${alvo.id}/${alvo.w}.${alvo.jpeg ? 'jpg' : 'webp'}`);
      if (obj) {
        const res = new Response(obj.body, { headers: cabecalhos(alvo.jpeg ? 'image/jpeg' : 'image/webp', 'r2') });
        if (cache) ctx.waitUntil(cache.put(chave, res.clone()).catch(() => {}));
        return res;
      }
    } catch (e) {
      console.error('foto: R2 falhou, vai ao Google', e);
    }
  }
  // 2. O Google (lh3), com o cache da Cloudflare na frente.
  const origem = `https://lh3.googleusercontent.com/d/${alvo.id}=w${alvo.w}${alvo.jpeg ? '' : '-rw'}`;
  let r;
  try {
    r = await f(origem, { cf: { cacheEverything: true, cacheTtl: FOTO_CACHE_S } });
  } catch {
    return new Response('Foto indisponível agora.', { status: 502, headers: { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store' } });
  }
  const tipo = r.headers.get('Content-Type') || '';
  if (!r.ok || !tipo.startsWith('image/')) {
    // 404/403 do Google (foto apagada ou fechada) ou página de erro: não vira
    // cache e não repassa o corpo de lá.
    return new Response('Foto indisponível.', { status: r.status === 404 || r.status === 403 ? 404 : 502, headers: { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store' } });
  }
  const res = new Response(r.body, { headers: cabecalhos(tipo, 'google') });
  if (cache) ctx.waitUntil(cache.put(chave, res.clone()).catch(() => {}));
  // Com o R2: a primeira vez de cada tamanho também vai para lá (a miniatura
  // é pequena; a cópia em memória não pesa). Daí em diante o Google não é
  // mais chamado para ela, nem em outro data center.
  if (env.FOTOS_R2) {
    const copia = res.clone();
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
