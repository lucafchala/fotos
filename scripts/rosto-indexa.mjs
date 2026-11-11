#!/usr/bin/env node
// Indexador da busca pelo rosto (v3.2). Roda no GitHub Actions
// (.github/workflows/rosto.yml), nunca no Worker: indexar uma foto custa
// baixar a miniatura e uma chamada à AWS, e o plano grátis do Worker tem 10 ms
// de CPU e 50 subrequisições por invocação.
//
// O que ele faz, por álbum (ROSTO_SLUGS):
//   1. lê as páginas PÚBLICAS da galeria (o índice e cada capítulo) e tira a
//      lista de fotos do JSON `g-dados` — a mesma lista que o visitante vê,
//      já sem as fotos ocultas e sem vídeo;
//   2. cria a coleção `fotos-<slug>` na Rekognition, se faltar;
//   3. indexa as fotos novas (miniatura de 2400 px, até 100 rostos, filtro de
//      qualidade LOW para não perder rosto pequeno de foto de grupo) e apaga do índice os
//      rostos das fotos que saíram do álbum.
//
// O ESTADO (quais fotos já foram vistas, inclusive as sem rosto, que a
// Rekognition não guarda) mora no SITE desde a v3.8.8: GET e POST
// /api/busca/estado, com o ROSTO_INDEXADOR_TOKEN (src/busca.js). Antes era um
// arquivo no cache do GitHub Actions — e o repositório é público: o workflow
// de um pull request vindo de um fork consegue restaurar um cache do
// repositório, e o arquivo tinha o ID de toda foto do álbum, inclusive antes
// do lançamento. Sem o token (execução à mão, fora do Actions), o estado fica
// num arquivo local (ROSTO_ESTADO); no Actions, sem o token, o indexador não
// roda.
//
// O LOG É PÚBLICO (os logs do Actions de um repositório público abrem para
// qualquer conta do GitHub). Por isso este script só imprime CONTAGENS: nunca
// o slug de um álbum, o nome de um evento, o ID de uma foto, o nome de uma
// coleção ou a mensagem crua de um erro (que pode levar qualquer um deles).
// Uma falha entra na contagem pelo TIPO (`tipoDoErro`). Antes de acrescentar
// um console.log aqui, releia este parágrafo — tests/rosto-indexador.test.js
// reprova qualquer linha que leve um desses dados.
//
// LEITURA INCOMPLETA NÃO APAGA NADA (v3.8.8). "Saiu do álbum" só vale quando o
// álbum foi lido inteiro: se uma página veio sem a lista de fotos (o Drive
// falhou naquele instante) ou o álbum veio vazio, nenhum rosto é apagado e
// nada sai da busca nesta execução. Antes, uma falha passageira do Drive
// apagava do índice os rostos do evento (ou do álbum todo), e a execução
// seguinte pagava para indexar tudo de novo.
//
// Variáveis: AWS_ACCESS_KEY_ID, AWS_SECRET_ACCESS_KEY, AWS_REGION (padrão
// sa-east-1), ROSTO_SLUGS (os slugs dos álbuns, separados por vírgula),
// ROSTO_SITE (padrão https://fotos.lucafchala.com), ROSTO_INDEXADOR_TOKEN (lê
// o álbum antes do lançamento, manda o que leu e guarda o estado),
// ROSTO_ESTADO (só sem o token: o arquivo local do estado, padrão
// .rosto-estado.json), ROSTO_MAX_NOVAS (padrão 3000 por execução),
// ROSTO_MAX_MINUTOS (padrão 35: passou disso, para de pegar foto nova, envia o
// que tem e grava o estado — a próxima execução continua de onde parou),
// ROSTO_SECO=1 (só conta).

import { readFile, writeFile } from 'node:fs/promises';
import { rekognition, base64, ErroAws } from '../src/aws.js';
import { colecoes, idExterno, lerIdExterno, MARCA_SAIU, limpaRostosDeQuemSaiu } from '../src/rosto.js';
import { ROSTO_REGIAO_PADRAO, BUSCA_LOTE_MAX, ROSTO_FOTOS_POR_DIA, AQUECE_LARGURAS, AQUECE_FOTOS_POR_EXECUCAO } from '../src/config.js';
import { ASSINATURA_CURTA_LEN } from '../src/security.js';

// Filtro de qualidade do IndexFaces. NONE (v3.7.3): todo rosto que a Amazon
// detecta entra, até o pequeno, de lado, tremido ou no escuro — melhor um
// rosto ruim no índice que uma foto da pessoa que a busca não acha. Trocar
// este valor reindexa os rostos uma vez (ver `#qualidade` no estado).
const QUALIDADE = 'NONE';
import { descreveFoto } from '../src/busca.js';

const UA = 'fotos-rosto-indexador/1.0 (bot; +https://github.com/lucafchala/fotos)';
const ID_RE = /^[A-Za-z0-9_-]{10,200}$/;

/** As fotos (não vídeos) do JSON g-dados de uma página, com o autor de cada uma. @param {string} html */
export function fotosDaPagina(html) {
  const m = html.match(/<script type="application\/json" id="g-dados"[^>]*>([\s\S]*?)<\/script>/);
  if (!m) return null;
  const dados = JSON.parse(m[1]);
  const nomes = Array.isArray(dados.autores) ? dados.autores.map(String) : [];
  /** @type {string[]} */
  const ids = [];
  /** @type {Map<string, string>} */
  const autores = new Map();
  // O `k` do endereço de cada foto (/f/, v3.8.8): o álbum e a assinatura, que a
  // página traz num campo só por seção (`as`), na ordem das fotos.
  /** @type {Map<string, string>} */
  const chaves = new Map();
  const slugDaPagina = typeof dados.slug === 'string' ? dados.slug : '';
  for (const sec of Array.isArray(dados.secoes) ? dados.secoes : []) {
    const assinaturas = typeof sec.as === 'string' ? sec.as : '';
    for (const [i, f] of (Array.isArray(sec.fotos) ? sec.fotos : []).entries()) {
      // Formato da página (fotoDaPagina em src/ui/galeria.js): o "extra"
      // numérico na posição 9 é a duração de um vídeo; o autor é o índice na
      // posição 7 (ausente = 0).
      if (!Array.isArray(f) || typeof f[9] === 'number') continue;
      if (typeof f[0] === 'string' && ID_RE.test(f[0])) {
        ids.push(f[0]);
        autores.set(f[0], nomes[typeof f[7] === 'number' ? f[7] : 0] || '');
        const a = assinaturas.slice(i * ASSINATURA_CURTA_LEN, (i + 1) * ASSINATURA_CURTA_LEN).trim();
        if (slugDaPagina) chaves.set(f[0], a ? `${slugDaPagina}.${a}` : slugDaPagina);
      }
    }
  }
  return { cap: typeof dados.cap === 'string' ? dados.cap : '', ids, autores, chaves };
}

/** Os slugs dos capítulos no índice. @param {string} html @param {string} slug */
export function capitulosDoIndice(html, slug) {
  const re = new RegExp(`<a class="ix-card[^"]*" href="/galeria/${slug.replace(/[^a-z0-9-]/g, '')}/([a-z0-9][a-z0-9-]*)"`, 'g');
  return [...new Set([...html.matchAll(re)].map(x => x[1]))];
}

/**
 * Um erro do próprio indexador, com um rótulo curto que PODE ir ao log (sem
 * endereço, sem ID, sem nome de álbum).
 */
class ErroDoIndexador extends Error {
  /** @param {string} rotulo */
  constructor(rotulo) {
    super(rotulo);
    this.name = 'ErroDoIndexador';
    this.rotulo = rotulo;
  }
}

/**
 * O TIPO de um erro, para o log público: nunca a mensagem crua (ver o topo).
 * @param {unknown} e
 * @returns {string}
 */
export function tipoDoErro(e) {
  // Pelo nome da classe, e não por `instanceof`: o erro pode vir de outra cópia
  // do módulo (os testes recarregam o script) e ainda assim só o tipo pode sair.
  const o = /** @type {any} */ (e);
  if (o instanceof ErroAws || (o && o.name === 'ErroAws' && typeof o.tipo === 'string')) return `AWS ${String(o.tipo).replace(/[^A-Za-z0-9]/g, '').slice(0, 60) || 'erro'}`;
  if (o instanceof ErroDoIndexador) return o.rotulo;
  return o instanceof Error && /^[A-Za-z]{1,40}$/.test(o.name) ? o.name : 'erro';
}

/** @param {string} url @param {string} oQue rótulo para o erro (sem o endereço) */
async function pagina(url, oQue) {
  // Com ROSTO_INDEXADOR_TOKEN, lê também o álbum ainda em "Em breve" (antes do
  // lançamento, para o dono testar a busca).
  const token = process.env.ROSTO_INDEXADOR_TOKEN || '';
  const r = await fetch(url, { headers: { 'User-Agent': UA, ...(token ? { 'X-Rosto-Indexador': token } : {}) } });
  if (!r.ok) throw new ErroDoIndexador(`${oQue} HTTP ${r.status}`);
  return r.text();
}

/**
 * Todas as fotos visíveis do álbum, como ExternalImageId → id do Drive, e o
 * capítulo e o autor de cada uma (para a busca nas fotos e a moderação).
 * `completo: false` quando alguma página veio sem a lista de fotos, ou o álbum
 * veio vazio: aí NADA pode ser dado como "saiu do álbum" (ver o topo).
 * @param {string} site @param {string} slug
 * @returns {Promise<{ todas: Map<string, string>, info: Map<string, { cap: string, autor: string, k?: string }>, eventos: number, completo: boolean }>}
 */
async function fotosDoAlbum(site, slug) {
  const base = `${site}/galeria/${slug}`;
  const inicio = await pagina(base, 'página do álbum');
  /** @type {Map<string, string>} */
  const todas = new Map();
  /** @type {Map<string, { cap: string, autor: string, k?: string }>} */
  const info = new Map();
  const unica = fotosDaPagina(inicio);
  if (unica) {
    for (const id of unica.ids) { todas.set(idExterno('', id), id); info.set(id, { cap: '', autor: unica.autores.get(id) || '', k: unica.chaves.get(id) || '' }); }
    return { todas, info, eventos: 0, completo: todas.size > 0 };
  }
  const caps = capitulosDoIndice(inicio, slug);
  let completo = caps.length > 0;
  for (const cap of caps) {
    const p = fotosDaPagina(await pagina(`${base}/${cap}`, 'página de um evento'));
    // Página sem a lista (o Drive não respondeu para ela): leitura incompleta.
    if (!p) { completo = false; continue; }
    for (const id of p.ids) { todas.set(idExterno(cap, id), id); info.set(id, { cap, autor: p.autores.get(id) || '', k: p.chaves.get(id) || '' }); }
  }
  return { todas, info, eventos: caps.length, completo: completo && todas.size > 0 };
}

/**
 * Manda ao site o que a Rekognition leu (busca nas fotos e moderação) e as
 * fotos que saíram do álbum, em lotes. Precisa do ROSTO_INDEXADOR_TOKEN.
 * @param {string} site @param {string} slug
 * @param {any[]} itens @param {string[]} remover
 */
async function enviaBusca(site, slug, itens, remover) {
  const token = process.env.ROSTO_INDEXADOR_TOKEN || '';
  if (!token) return { marcadas: 0, escondidas: 0 };
  let marcadas = 0, escondidas = 0;
  for (let i = 0; i < Math.max(itens.length, remover.length); i += BUSCA_LOTE_MAX) {
    const r = await fetch(`${site}/api/busca/indexar`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'User-Agent': UA, 'X-Rosto-Indexador': token },
      body: JSON.stringify({ slug, itens: itens.slice(i, i + BUSCA_LOTE_MAX), remover: remover.slice(i, i + BUSCA_LOTE_MAX) }),
    });
    if (!r.ok) throw new ErroDoIndexador(`envio da busca HTTP ${r.status}`);
    const j = /** @type {any} */ (await r.json());
    marcadas += Number(j.marcadas) || 0;
    escondidas += Number(j.escondidas) || 0;
  }
  return { marcadas, escondidas };
}

// ---------------------------------------------------------------------------
// O estado: no site (com o token) ou num arquivo local (sem ele)
// ---------------------------------------------------------------------------
/**
 * @typedef {{ vistas: Set<string>, descritas: Set<string>, qualidade: string, geracao: number, limpar: boolean, dia: string, noDia: number, quentes: Set<string>, geracaoPedida: number, rosto: boolean }} Estado
 *   `geracao` e `limpar` são guardados; `geracaoPedida` e `rosto` só
 *   vêm do site (quantas vezes o dono pediu para refazer o índice, e se a busca
 *   pelo rosto está ligada no painel) e não são gravados de volta.
 */

/** @param {Estado} e */
const textoDoEstado = e => JSON.stringify({ vistas: [...e.vistas].sort(), descritas: [...e.descritas].sort(), qualidade: e.qualidade, geracao: e.geracao, limpar: e.limpar, dia: e.dia, noDia: e.noDia, quentes: [...e.quentes].sort() });

/**
 * Onde o estado de um álbum é lido e gravado. Grava só quando mudou (uma
 * execução sem foto nova não escreve nada).
 * @param {{ site: string, slug: string, token: string, arquivo: string }} o
 */
function guardaDoEstado(o) {
  let gravado = '';
  /** @type {Record<string, any> | null} */
  let doArquivo = null;
  return {
    /** @returns {Promise<Estado>} */
    async le() {
      /** @type {any} */
      let bruto;
      if (o.token) {
        const r = await fetch(`${o.site}/api/busca/estado?slug=${encodeURIComponent(o.slug)}`, { headers: { 'User-Agent': UA, 'X-Rosto-Indexador': o.token } });
        // Sem o estado NÃO se segue: indexar "do zero" pagaria de novo por
        // cada foto. A execução para, e a próxima tenta outra vez.
        if (!r.ok) throw new ErroDoIndexador(`leitura do estado HTTP ${r.status}`);
        bruto = await r.json();
      } else {
        try { doArquivo = JSON.parse(await readFile(o.arquivo, 'utf8')); } catch { doArquivo = {}; }
        const a = /** @type {Record<string, any>} */ (doArquivo);
        // O formato do arquivo é o de sempre: `<slug>`, `<slug>#busca`, `<slug>#qualidade`.
        // À mão não há painel a consultar: a busca vale como ligada e ninguém pediu para refazer.
        const extra = a[`${o.slug}#rosto`] && typeof a[`${o.slug}#rosto`] === 'object' ? a[`${o.slug}#rosto`] : {};
        bruto = { vistas: a[o.slug], descritas: a[`${o.slug}#busca`], qualidade: a[`${o.slug}#qualidade`], geracao: extra.geracao, limpar: extra.limpar, dia: extra.dia, noDia: extra.noDia, quentes: extra.quentes, geracaoPedida: extra.geracao, rosto: true };
      }
      const lista = (/** @type {unknown} */ v) => (Array.isArray(v) ? v.filter(x => typeof x === 'string') : []);
      /** @type {Estado} */
      const numero = (/** @type {unknown} */ v) => (typeof v === 'number' && Number.isFinite(v) && v > 0 ? Math.floor(v) : 0);
      const estado = {
        vistas: new Set(lista(bruto && bruto.vistas)), descritas: new Set(lista(bruto && bruto.descritas)), qualidade: bruto && typeof bruto.qualidade === 'string' ? bruto.qualidade : '',
        dia: bruto && typeof bruto.dia === 'string' ? bruto.dia : '', noDia: numero(bruto && bruto.noDia), quentes: new Set(lista(bruto && bruto.quentes)),
        geracao: numero(bruto && bruto.geracao), limpar: !!bruto && bruto.limpar === true,
        geracaoPedida: numero(bruto && bruto.geracaoPedida),
        // Só um `false` dito pelo site desliga: site antigo (sem o campo) segue indexando.
        rosto: !(bruto && bruto.rosto === false),
      };
      gravado = textoDoEstado(estado);
      return estado;
    },
    /** @param {Estado} estado */
    async grava(estado) {
      const texto = textoDoEstado(estado);
      if (texto === gravado) return;
      if (o.token) {
        const r = await fetch(`${o.site}/api/busca/estado`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'User-Agent': UA, 'X-Rosto-Indexador': o.token },
          body: JSON.stringify({ slug: o.slug, vistas: [...estado.vistas], descritas: [...estado.descritas], qualidade: estado.qualidade, geracao: estado.geracao, limpar: estado.limpar, dia: estado.dia, noDia: estado.noDia, quentes: [...estado.quentes] }),
        });
        if (!r.ok) throw new ErroDoIndexador(`gravação do estado HTTP ${r.status}`);
      } else {
        const a = { ...(doArquivo || {}), [o.slug]: [...estado.vistas], [`${o.slug}#busca`]: [...estado.descritas], [`${o.slug}#qualidade`]: estado.qualidade, [`${o.slug}#rosto`]: { geracao: estado.geracao, limpar: estado.limpar, dia: estado.dia, noDia: estado.noDia, quentes: [...estado.quentes] } };
        doArquivo = a;
        await writeFile(o.arquivo, JSON.stringify(a));
      }
      gravado = texto;
    },
  };
}

const espera = (/** @type {number} */ ms) => new Promise(r => setTimeout(r, ms));

/**
 * A foto para indexar: 2400 px (rosto pequeno em foto de grupo ainda tem
 * pixels para a Rekognition); acima do teto de 5 MB da API, cai para 1600.
 * @param {string} id
 */
async function miniatura(id) {
  for (const w of [2400, 1600]) {
    const r = await fetch(`https://lh3.googleusercontent.com/d/${id}=w${w}`, { headers: { 'User-Agent': UA } });
    if (!r.ok) throw new ErroDoIndexador(`miniatura HTTP ${r.status}`);
    const bytes = new Uint8Array(await r.arrayBuffer());
    if (bytes.length <= 5_000_000) return bytes;
  }
  throw new ErroDoIndexador('miniatura acima de 5 MB');
}

/** Chamada com nova tentativa quando a AWS pede calma. @type {typeof rekognition} */
async function aws(cred, op, corpo) {
  for (let i = 0; ; i++) {
    try {
      return await rekognition(cred, op, corpo);
    } catch (e) {
      if (i < 5 && e instanceof ErroAws && /Throttling|ProvisionedThroughput/.test(e.tipo)) { await espera(PASSO_MS * 4 * 2 ** i); continue; }
      throw e;
    }
  }
}

/** Os rostos já no índice: ExternalImageId → FaceIds. */
async function rostosIndexados(cred, colecao) {
  /** @type {Map<string, string[]>} */
  const mapa = new Map();
  let NextToken;
  do {
    const r = await aws(cred, 'ListFaces', { CollectionId: colecao, MaxResults: 4096, ...(NextToken ? { NextToken } : {}) });
    for (const f of r.Faces || []) {
      const k = String(f.ExternalImageId || '');
      mapa.set(k, [...(mapa.get(k) || []), f.FaceId]);
    }
    NextToken = r.NextToken;
  } while (NextToken);
  return mapa;
}

// O intervalo entre o começo de uma foto e o da seguinte: com PARALELAS fotos
// ao mesmo tempo, cada operação fica em no máximo 4 por segundo (a cota padrão
// é 5/s). ROSTO_PASSO_MS existe para os testes.
const PASSO_MS = Number.isFinite(Number(process.env.ROSTO_PASSO_MS)) && process.env.ROSTO_PASSO_MS !== undefined && process.env.ROSTO_PASSO_MS !== '' ? Number(process.env.ROSTO_PASSO_MS) : 250;
const PARALELAS = 4;

export async function principal() {
  const cred = {
    chave: process.env.AWS_ACCESS_KEY_ID || '',
    segredo: process.env.AWS_SECRET_ACCESS_KEY || '',
    regiao: process.env.AWS_REGION || ROSTO_REGIAO_PADRAO,
  };
  const slugs = String(process.env.ROSTO_SLUGS || '').split(',').map(s => s.trim()).filter(s => /^[a-z0-9][a-z0-9-]*$/.test(s));
  const site = (process.env.ROSTO_SITE || 'https://fotos.lucafchala.com').replace(/\/+$/, '');
  const token = process.env.ROSTO_INDEXADOR_TOKEN || '';
  const arqEstado = process.env.ROSTO_ESTADO || '.rosto-estado.json';
  const maxNovas = Number(process.env.ROSTO_MAX_NOVAS) || 3000;
  const maxDia = Number(process.env.ROSTO_MAX_DIA) || ROSTO_FOTOS_POR_DIA;
  const maxAquece = process.env.ROSTO_AQUECE === '0' ? 0 : AQUECE_FOTOS_POR_EXECUCAO;
  const seco = process.env.ROSTO_SECO === '1';
  const inicio = Date.now();
  const limiteMs = (Number(process.env.ROSTO_MAX_MINUTOS) || 35) * 60000;
  const acabouOTempo = () => Date.now() - inicio > limiteMs;
  // Busca nas fotos (v3.7): texto, coisas e moderação, uma vez por foto.
  // ROSTO_DESCREVER=0 desliga (só rostos).
  const descrever = process.env.ROSTO_DESCREVER !== '0' && !!token;
  if (!slugs.length) { console.log('ROSTO_SLUGS vazio: nada a fazer.'); return; }
  if (!seco && (!cred.chave || !cred.segredo)) throw new ErroDoIndexador('faltam AWS_ACCESS_KEY_ID e AWS_SECRET_ACCESS_KEY');
  // No Actions o estado não pode ficar em arquivo (nem em cache): ver o topo.
  if (!seco && !token && process.env.GITHUB_ACTIONS === 'true') throw new ErroDoIndexador('falta ROSTO_INDEXADOR_TOKEN (sem ele o estado não tem onde ficar)');

  for (const [n, slug] of slugs.entries()) {
    // O rótulo do álbum no log: a posição na lista, nunca o slug.
    const album = `álbum ${n + 1} de ${slugs.length}`;
    const col = colecoes(slug).principal;
    const { todas: fotos, info, eventos, completo } = await fotosDoAlbum(site, slug);
    console.log(`${album}: ${fotos.size} fotos${eventos ? ` em ${eventos} eventos` : ''}.`);
    if (seco) continue;
    const guarda = guardaDoEstado({ site, slug, token, arquivo: arqEstado });
    const estado = await guarda.le();
    // Busca pelo rosto desligada no painel (v3.8.9): nenhum rosto é indexado e
    // a coleção nem é criada (o site apaga o índice depois do prazo). A busca
    // nas fotos (texto e moderação) segue, se estiver ligada aqui.
    const comRosto = estado.rosto;
    if (!comRosto) console.log(`${album}: busca pelo rosto desligada no painel; nenhum rosto é indexado.`);
    if (comRosto) {
      try { await aws(cred, 'CreateCollection', { CollectionId: col }); console.log(`${album}: coleção criada.`); } catch (e) {
        if (!(e instanceof ErroAws && e.tipo === 'ResourceAlreadyExistsException')) throw e;
      }
    }
    /** @type {Map<string, string[]>} */
    let indexados = comRosto ? await rostosIndexados(cred, col) : new Map();
    // As marcas de quem saiu da busca (src/rosto.js) moram no mesmo índice e
    // NUNCA são apagadas aqui: nem ao refazer o índice, nem como "foto que
    // saiu do álbum". Só o dono as tira (desfazer, no painel).
    indexados.delete(MARCA_SAIU);
    // Refazer o índice: apaga os rostos uma vez e indexa de novo, só a parte
    // do rosto — texto, coisas e moderação já lidos não são lidos outra vez.
    // Dois motivos:
    //  - o filtro de qualidade mudou (v3.7.3: LOW → NONE, "pegar todos os
    //    rostos, mesmo na dúvida");
    //  - o dono desfez uma saída da busca (v3.8.9): os rostos que ela apagou só
    //    voltam indexando de novo, porque o site não guarda quais eram.
    // A marca é gravada logo depois de apagar: se a execução parar no meio, a
    // próxima continua sem apagar de novo.
    // Só com a marca GUARDADA e diferente (v3.8.8). Estado sem marca (perdido,
    // ou vindo do banco) adota o filtro e o pedido de hoje e não apaga nada:
    // perder o estado não pode custar o índice inteiro.
    if (comRosto) {
      const filtroNovo = !!estado.qualidade && estado.qualidade !== QUALIDADE;
      const refazer = estado.geracaoPedida > estado.geracao;
      if (filtroNovo || refazer) {
        const ids = [...indexados.values()].flat();
        for (let i = 0; i < ids.length; i += 4096) await aws(cred, 'DeleteFaces', { CollectionId: col, FaceIds: ids.slice(i, i + 4096) });
        if (ids.length) console.log(`${album}: ${filtroNovo ? 'filtro de qualidade novo' : 'pedido do painel para refazer o índice'}: ${ids.length} rostos apagados para indexar de novo.`);
        indexados = new Map();
        estado.vistas = new Set();
      }
      estado.qualidade = QUALIDADE;
      estado.geracao = Math.max(estado.geracao, estado.geracaoPedida);
      await guarda.grava(estado);
    }
    const vistas = estado.vistas;
    for (const k of indexados.keys()) vistas.add(k);
    const descritas = estado.descritas;

    // Saíram do álbum (ocultas, apagadas, movidas de capítulo): apaga os rostos.
    // Só com o álbum lido INTEIRO (ver o topo).
    if (!comRosto) {
      // nada a apagar: o índice não é deste script enquanto a busca está desligada
    } else if (completo) {
      const apagar = [...indexados].filter(([k]) => !fotos.has(k) && lerIdExterno(k)).flatMap(([, ids]) => ids);
      for (let i = 0; i < apagar.length; i += 4096) await aws(cred, 'DeleteFaces', { CollectionId: col, FaceIds: apagar.slice(i, i + 4096) });
      if (apagar.length) console.log(`${album}: ${apagar.length} rostos apagados (fotos que saíram do álbum).`);
    } else {
      console.log(`${album}: leitura incompleta do álbum; nada é apagado nesta execução.`);
    }

    const idsNoAlbum = new Set(fotos.values());
    // Uma foto entra se falta o rosto OU (com a busca ligada) a descrição.
    const faltaRosto = (/** @type {string} */ k) => comRosto && !vistas.has(k);
    // O teto do dia (ROSTO_FOTOS_POR_DIA): o que esta execução ainda pode
    // processar hoje (UTC). A conta é gravada com o progresso.
    const hoje = new Date().toISOString().slice(0, 10);
    const jaHoje = estado.dia === hoje ? estado.noDia : 0;
    const restaHoje = Math.max(0, maxDia - jaHoje);
    const pendentes = [...fotos].filter(([k, id]) => faltaRosto(k) || (descrever && !descritas.has(id)));
    const novas = pendentes.slice(0, Math.min(maxNovas, restaHoje));
    if (pendentes.length > novas.length && restaHoje < maxNovas) console.log(`${album}: teto do dia (${maxDia} fotos): ${pendentes.length - novas.length} ficam para depois.`);
    // Só quem vai processar algo mexe na conta: execução sem foto nova não grava nada.
    if (novas.length) { estado.dia = hoje; estado.noDia = jaHoje; }
    // Vai indexar rostos: a limpeza dos de quem saiu da busca (no fim) fica
    // DEVIDA desde já, e gravada — se a execução cair no meio, a próxima limpa.
    if (novas.some(([k]) => faltaRosto(k)) && !estado.limpar) { estado.limpar = true; await guarda.grava(estado); }
    let rostos = 0;
    /** @type {Map<string, number>} as falhas, por tipo (nunca por foto) */
    const falhas = new Map();
    /** @type {any[]} */
    let lote = [];
    let marcadas = 0, escondidas = 0;
    // Até PARALELAS fotos ao mesmo tempo, começando uma a cada PASSO_MS.
    let parou = false;
    /** @param {string} k @param {string} id */
    const processa = async (k, id) => {
      try {
        const bytes = await miniatura(id);
        const imagem = { Bytes: base64(bytes) };
        const [res, texto, rotulos, moderacao] = await Promise.all([
          !faltaRosto(k) ? null : aws(cred, 'IndexFaces', { CollectionId: col, Image: imagem, ExternalImageId: k, MaxFaces: 100, QualityFilter: QUALIDADE, DetectionAttributes: [] }),
          descrever && !descritas.has(id) ? aws(cred, 'DetectText', { Image: imagem }) : null,
          descrever && !descritas.has(id) ? aws(cred, 'DetectLabels', { Image: imagem, MaxLabels: 30, MinConfidence: 70 }) : null,
          descrever && !descritas.has(id) ? aws(cred, 'DetectModerationLabels', { Image: imagem, MinConfidence: 70 }) : null,
        ]);
        if (res) { rostos += (res.FaceRecords || []).length; vistas.add(k); }
        if (texto || rotulos || moderacao) {
          const d = descreveFoto({ texto, rotulos, moderacao });
          const i = info.get(id) || { cap: '', autor: '' };
          lote.push({ foto: id, cap: i.cap, autor: i.autor, ...d });
          descritas.add(id);
        }
      } catch (e) {
        // Só o TIPO entra na contagem: a chave da foto e a mensagem não vão ao log.
        const tipo = tipoDoErro(e);
        falhas.set(tipo, (falhas.get(tipo) || 0) + 1);
      }
      if (lote.length >= BUSCA_LOTE_MAX) {
        const envio = lote; lote = [];
        const r = await enviaBusca(site, slug, envio, []);
        marcadas += r.marcadas; escondidas += r.escondidas;
        // Progresso gravado a cada lote: se o job cair, o que foi feito fica.
        await guarda.grava(estado);
      }
    };
    /** @type {Set<Promise<void>>} */
    const emCurso = new Set();
    let feitas = 0;
    for (const [k, id] of novas) {
      if (acabouOTempo()) { parou = true; break; }
      while (emCurso.size >= PARALELAS) await Promise.race(emCurso);
      const t = processa(k, id).finally(() => { emCurso.delete(t); });
      emCurso.add(t);
      feitas++;
      estado.noDia++;
      if (feitas % 100 === 0) console.log(`${album}: ${feitas} de ${novas.length}…`);
      await espera(PASSO_MS);
    }
    await Promise.all(emCurso);
    if (parou) console.log(`${album}: limite de tempo: ${feitas} de ${novas.length} nesta execução; a próxima continua.`);
    // O que sobrou do lote, e as fotos que saíram do álbum (a busca as esquece)
    // — estas, só com o álbum lido inteiro.
    const remover = descrever && completo ? [...descritas].filter(id => !idsNoAlbum.has(id)) : [];
    if (lote.length || remover.length) {
      const r = await enviaBusca(site, slug, lote, remover);
      marcadas += r.marcadas; escondidas += r.escondidas;
    }
    // Quem saiu da busca não volta pelas fotos novas (v3.8.9): os rostos
    // parecidos com cada marca são apagados. Roda quando esta execução indexou
    // rostos ou quando uma anterior ficou devendo a limpeza. As marcas são
    // lidas DE NOVO aqui: quem saiu durante esta execução entra (a saída, no
    // site, só apaga o que já estava no índice naquele instante).
    if (comRosto && (rostos > 0 || estado.limpar)) {
      const marcas = (await rostosIndexados(cred, col)).get(MARCA_SAIU) || [];
      const limpos = await limpaRostosDeQuemSaiu((op, corpo) => aws(cred, op, corpo), col, marcas);
      estado.limpar = false;
      if (limpos) console.log(`${album}: ${limpos} rostos apagados (de quem saiu da busca).`);
    }
    // Esquece o que saiu do álbum (se voltar, é indexado de novo).
    if (completo) {
      for (const k of [...vistas]) if (!fotos.has(k)) vistas.delete(k);
      for (const id of [...descritas]) if (!idsNoAlbum.has(id)) descritas.delete(id);
      for (const id of [...estado.quentes]) if (!idsNoAlbum.has(id)) estado.quentes.delete(id);
    }
    // Aquece as miniaturas no R2 do site (ver AQUECE_LARGURAS): cada foto que
    // ainda não foi aquecida é pedida ao site nas larguras do celular. Só com o
    // token (é ele que abre o álbum ainda fechado) e enquanto há tempo.
    if (token) {
      const frias = [...idsNoAlbum].filter(id => !estado.quentes.has(id)).slice(0, maxAquece);
      let aquecidas = 0, semAquecer = 0;
      /** @param {string} id */
      const aquece = async id => {
        const k = (info.get(id) || {}).k || '';
        let ok = !!k;
        for (const w of ok ? AQUECE_LARGURAS : []) {
          try {
            const r = await fetch(`${site}/f/${id}/${w}?k=${encodeURIComponent(k)}`, { headers: { 'User-Agent': UA, 'X-Rosto-Indexador': token } });
            await r.arrayBuffer();
            if (!r.ok) ok = false;
          } catch { ok = false; }
        }
        if (ok) { estado.quentes.add(id); aquecidas++; } else semAquecer++;
      };
      /** @type {Set<Promise<void>>} */
      const aquecendo = new Set();
      for (const id of frias) {
        if (acabouOTempo()) break;
        while (aquecendo.size >= PARALELAS) await Promise.race(aquecendo);
        const t = aquece(id).finally(() => { aquecendo.delete(t); });
        aquecendo.add(t);
        await espera(PASSO_MS);
      }
      await Promise.all(aquecendo);
      if (aquecidas || semAquecer) console.log(`${album}: miniaturas aquecidas: ${aquecidas} fotos${semAquecer ? `, ${semAquecer} ficaram para a próxima` : ''}.`);
    }
    await guarda.grava(estado);
    const totalDeFalhas = [...falhas.values()].reduce((a, b) => a + b, 0);
    console.log(`${album}: ${feitas} fotos processadas, ${rostos} rostos indexados, ${totalDeFalhas} falhas.`);
    if (totalDeFalhas) console.log(`${album}: falhas por tipo: ${[...falhas].sort((a, b) => b[1] - a[1]).map(([t, q]) => `${t} × ${q}`).join(', ')}.`);
    if (descrever) console.log(`${album}: busca nas fotos: ${marcadas} marcadas pela moderação, ${escondidas} escondidas (da turma).`);
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  // Só o tipo do erro: a mensagem crua pode levar o endereço de uma página.
  principal().catch(e => { console.error(`O indexador parou: ${tipoDoErro(e)}.`); process.exit(1); });
}
