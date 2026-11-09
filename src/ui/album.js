// Apresentação de um álbum (v3.3): o índice da galeria por capítulos vira a
// página especial do álbum quando o projeto tem "Texto de abertura". Quatro
// estilos de primeira tela, escolhidos no painel (`galeriaEstilo`):
//   - mosaico (o padrão): colagem de 5 capas;
//   - tela-cheia: as fotos de capa do projeto trocam sozinhas atrás do título;
//   - recordacao: polaroids com o nome do evento e o título manuscrito;
//   - linha: título e texto primeiro; os eventos contam o ano, alternando lados.
// Em todos: o texto, a linha do tempo dos eventos (com o período de cada um,
// pelas datas de captura), "Quem fotografou" e o recado final. Fonte: Open
// Sans, a mais parecida com a do Colégio Santa Cruz (ver scripts/build-fonts.mjs).
//
// Página de servidor, sem framework. O único JS é o das "N novas" e o da busca
// pelo rosto (indice-comum.js). A troca de fotos da tela cheia é CSS puro e
// para com "reduzir movimento". Tudo que vem do painel ou do Drive é escapado.
// As capas e as contagens vêm do RESUMO dos capítulos (drive.js), como os
// cartões do índice simples: nenhuma listagem a mais.

import { enderecoDoAlbum, marcaDoAlbum, escape, fontFaceCSS, fontFaceAlbumCSS, fontPreloadHTML, photoPreconnectHTML, navegacaoFluidaHTML, socialMetaHTML, previewDescription, ogImageFor, footerLegalLinksHTML } from '../utils.js';
import { urlLh3, pastaDoDrive, parseCreditos, chavesDeEnvio } from '../drive.js';
import { urlFoto } from '../foto-rota.js';
import { HONEYPOT_CSS } from '../security.js';
import { ROSTO_CSS, BUSCA_CSS } from './indice-comum.js';
import { GALERIA_ESTILOS, DOMINIOS_DE_ALBUM } from '../config.js';
import { brCodePix } from '../pix.js';
import { qrLinhas } from '../qr.js';

const MESES = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez'];
const ID_RE = /^[A-Za-z0-9_-]{10,200}$/;

/**
 * O período de um capítulo, para o rótulo da linha do tempo: "jun 2026",
 * "mai – jun 2026" ou "2024 – 2026". '' sem data.
 * @param {[number, number] | undefined} p AAAAMM inicial e final
 */
export function rotuloDoPeriodo(p) {
  if (!Array.isArray(p) || !(p[0] > 0) || !(p[1] >= p[0])) return '';
  const [a, b] = p;
  const ano = (/** @type {number} */ m) => Math.floor(m / 100);
  const mes = (/** @type {number} */ m) => MESES[(m % 100) - 1] || '';
  if (!mes(a) || !mes(b)) return '';
  if (a === b) return `${mes(a)} ${ano(a)}`;
  if (ano(a) === ano(b)) return `${mes(a)} – ${mes(b)} ${ano(a)}`;
  return `${ano(a)} – ${ano(b)}`;
}

/**
 * O ID do Drive de uma das "Fotos de capa" do projeto (link do lh3 ou do
 * Drive), ou ''. Outro endereço não entra: a página só carrega imagem do lh3.
 * @param {unknown} url
 */
export function idDaCapa(url) {
  if (typeof url !== 'string') return '';
  const m = url.match(/^https:\/\/lh3\.googleusercontent\.com\/d\/([\w-]+)/)
    || url.match(/^https:\/\/drive\.google\.com\/file\/d\/([\w-]+)/)
    || url.match(/^https:\/\/drive\.google\.com\/(?:open|uc|thumbnail)\?(?:.*&)?id=([\w-]+)/);
  return m && ID_RE.test(m[1]) ? m[1] : '';
}

/**
 * Os capítulos na ordem da linha do tempo: por data de início quando TODOS
 * têm data (senão, a ordem das pastas, que o dono controla pelo nome).
 * @template {{ id: string }} C
 * @param {C[]} caps
 * @param {Record<string, import('../drive.js').ResumoCap>} resumo
 * @returns {C[]}
 */
export function ordemDaLinha(caps, resumo) {
  const comData = caps.every(c => resumo[c.id] && Array.isArray(resumo[c.id].p));
  if (!comData) return caps;
  return caps.map((c, i) => ({ c, i, d: /** @type {[number, number]} */ (resumo[c.id].p)[0] }))
    .sort((x, y) => x.d - y.d || x.i - y.i).map(x => x.c);
}

// Foto do lh3 em WebP (`-rw`) e no tamanho certo para cada tela (v3.7.6):
// o celular baixa a menor que serve, o computador a maior. É o mesmo padrão
// das páginas dos eventos (galeria.js). `larguras` em px; `sizes` diz ao
// navegador quanto da tela a foto ocupa.
/** @param {string} id @param {number[]} larguras @param {string} sizes */
const fonteLh3 = (id, larguras, sizes) => `src="${escape(urlFoto(id, larguras[Math.min(1, larguras.length - 1)]))}" srcset="${escape(larguras.map(w => `${urlFoto(id, w)} ${w}w`).join(', '))}" sizes="${sizes}"`;

/** Acima disto, os eventos do álbum vão para a grade compacta por ano. */
export const EVENTOS_COMPACTOS = 8;

/**
 * A grade compacta dos eventos (v3.8.2): por ano (o do primeiro mês com foto),
 * na ordem da linha do tempo. Evento sem data fica no grupo de quem vem antes.
 * Os cartões levam as mesmas marcas da linha do tempo (`ix-card`, `data-cap`,
 * `data-cr`, `.ix-sub`), que os scripts e o indexador procuram.
 * @param {{ id: string, slug: string, nome: string }[]} caps
 * @param {Record<string, import('../drive.js').ResumoCap>} resumo
 * @param {(id: string) => string[]} capasDe
 * @param {string} base
 */
function gradeDeEventos(caps, resumo, capasDe, base) {
  /** @type {{ ano: string, itens: string[] }[]} */
  const grupos = [];
  for (const c of caps) {
    const r = resumo[c.id];
    const ano = r && Array.isArray(r.p) && r.p[0] > 0 ? String(Math.floor(r.p[0] / 100)) : '';
    const atual = grupos[grupos.length - 1];
    // Ano que já teve título (ordem sem data) fica no grupo corrente: um título por ano.
    if (!atual || (ano && ano !== atual.ano && !grupos.some(g => g.ano === ano))) grupos.push({ ano, itens: [] });
    const n = r ? r.n : 0;
    const sub = r ? (n === 1 ? '1 foto' : `${n.toLocaleString('pt-BR')} fotos`) : 'Ver fotos';
    const cr = r && r.cr && r.cr.length ? ` data-cr="${r.cr.join(',')}"` : '';
    const capa = capasDe(c.id)[0];
    const img = capa ? `<img ${fonteLh3(capa, [320, 480, 640], '(max-width:700px) 46vw, 240px')} alt="" loading="lazy" decoding="async" referrerpolicy="no-referrer">` : '<span class="al-vazio"></span>';
    grupos[grupos.length - 1].itens.push(`<li><a class="ix-card al-card al-mini" href="${escape(`${base}/${c.slug}`)}" data-cap="${escape(c.slug)}"${cr}>${img}<span class="al-nm"><b>${escape(c.nome)}</b><span class="ix-sub">${escape(sub)}</span></span></a></li>`);
  }
  const anos = grupos.filter(g => g.ano);
  const atalhos = anos.length > 1 ? `<nav class="al-anos" aria-label="Ir para o ano">${anos.map(g => `<a href="#ano-${g.ano}">${g.ano}</a>`).join('')}</nav>` : '';
  const corpo = grupos.map(g => `${g.ano ? `<h3 class="al-ano" id="ano-${g.ano}">${g.ano}</h3>` : ''}<ol class="al-grade">${g.itens.join('')}</ol>`).join('');
  return `<section class="al-sec" id="eventos" aria-labelledby="al-eventos-t"><span class="al-kick">Linha do tempo</span><h2 id="al-eventos-t">Os ${caps.length} eventos</h2>${atalhos}${corpo}</section>`;
}

const ICONE_SINO = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9"/><path d="M10.3 21a1.94 1.94 0 0 0 3.4 0"/></svg>';

// Um rosto simples (traço), no botão da busca pelo rosto.
const ICONE_ROSTO = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 8V6a2 2 0 0 1 2-2h2M16 4h2a2 2 0 0 1 2 2v2M20 16v2a2 2 0 0 1-2 2h-2M8 20H6a2 2 0 0 1-2-2v-2"/><circle cx="9.5" cy="10" r=".6" fill="currentColor"/><circle cx="14.5" cy="10" r=".6" fill="currentColor"/><path d="M9 15c1.6 1.3 4.4 1.3 6 0"/></svg>';

/**
 * @param {{
 *   event: import('../utils.js').Evento,
 *   titulo: string,
 *   caps: { id: string, slug: string, nome: string }[],
 *   resumo: Record<string, import('../drive.js').ResumoCap>,
 *   ocultasSet: Set<string>,
 *   restrito: boolean,
 *   indexavel: boolean,
 *   origem: string,
 *   base?: string,
 *   barraDono: string,
 *   avisoTrunc: string,
 *   botaoRosto: boolean,
 *   rostoDialog: string,
 *   buscaFotos?: string,
 *   scripts: string,
 *   nonce?: string,
 * }} p
 */
export function albumHTML(p) {
  const { event, titulo, resumo, ocultasSet, restrito, indexavel, origem } = p;
  const slug = String(event.slug || '');
  const base = typeof p.base === 'string' ? p.base : `/galeria/${slug}`;
  const estilo = GALERIA_ESTILOS.includes(String(event.galeriaEstilo)) ? String(event.galeriaEstilo) : GALERIA_ESTILOS[0];
  const caps = ordemDaLinha(p.caps, resumo);
  // A capa escolhida pelo dono no visualizador ("Usar como capa do evento",
  // v3.8.0) vem primeiro; depois, as do resumo.
  const escolhidas = event.capasEventos && typeof event.capasEventos === 'object' ? /** @type {Record<string, unknown>} */ (event.capasEventos) : {};
  const slugDoId = new Map(p.caps.map(c => [c.id, c.slug]));
  /** @param {string} id */
  const capasDe = id => {
    const doResumo = resumo[id] ? resumo[id].capas : [];
    const e = escolhidas[slugDoId.get(id) || ''];
    const lista = typeof e === 'string' && /^[A-Za-z0-9_-]{10,200}$/.test(e) ? [e, ...doResumo.filter(x => x !== e)] : doResumo;
    return lista.filter(x => !ocultasSet.has(x));
  };

  // Fotos da abertura: primeiro as "Fotos de capa" do projeto, completadas
  // pela primeira capa de cada capítulo (o mosaico pede 5, a tela cheia até 6).
  // Álbum família/privado não mostra foto na abertura.
  const doProjeto = (Array.isArray(event.photos) ? event.photos : []).map(idDaCapa).filter(id => id && !ocultasSet.has(id));
  const dosCaps = caps.map(c => capasDe(c.id)[0]).filter(Boolean);
  const heroi = restrito ? [] : [...new Set([...doProjeto, ...dosCaps])].slice(0, 6);

  // Números: só quando todos os capítulos já têm resumo (senão, menores que o real).
  const todos = caps.length > 0 && caps.every(c => resumo[c.id]);
  /** @type {Map<string, number>} */
  const porAutor = new Map();
  if (todos) for (const c of caps) for (const [nome, n] of Object.entries(resumo[c.id].a || {})) porAutor.set(nome, (porAutor.get(nome) || 0) + n);
  const autores = todos && porAutor.size ? [...porAutor].sort((a, b) => b[1] - a[1]) : [];
  // Só os eventos (v3.7.2, pedido do dono): contagem de fotos e de fotógrafos
  // na abertura soava como relatório.
  const meta = caps.length ? `${caps.length} ${caps.length === 1 ? 'evento' : 'eventos'}` : '';

  const texto = String(event.galeriaAbertura || '').trim();
  const intro = texto.split(/\n\s*\n/).map(t => t.trim()).filter(Boolean)
    .map(t => `<p>${t.split('\n').map(l => escape(l.trim())).join('<br>')}</p>`).join('');
  const recado = String(event.galeriaRecado || '').trim();

  const pasta = restrito ? null : pastaDoDrive(event.driveUrl);
  const urlPasta = pasta ? `https://drive.google.com/drive/folders/${pasta.id}${pasta.resourceKey ? `?resourcekey=${pasta.resourceKey}` : ''}` : '';
  const botoes = `<div class="al-btns">${[
    // A busca pelo rosto é o caminho principal (v3.7.5, pedido do dono): vem
    // primeiro e em destaque. Ela só aparece com o script ligado; até lá (ou
    // sem ela), "Ver todas as fotos" é o principal — ver .al-ver no CSS.
    p.botaoRosto ? `<button type="button" class="al-btn al-b1 al-rosto" id="rs-abrir" hidden>${ICONE_ROSTO}Achar minhas fotos pelo rosto</button>` : '',
    caps.length ? '<a class="al-btn al-b1 al-ver" href="#eventos">Ver todas as fotos</a>' : '',
    urlPasta ? `<a class="al-btn al-b2" href="${escape(urlPasta)}" target="_blank" rel="nofollow noopener" data-acao="mandar-fotos">Mandar suas fotos</a>` : '',
  ].join('')}</div>`;
  // O selo acima do título: o do domínio do álbum ("Turma 2026 · Colégio Santa
  // Cruz"), o mesmo da página "em breve"; senão, o ano do projeto.
  const doDominio = Object.values(DOMINIOS_DE_ALBUM).find(a => a.slug === slug);
  // Pasta trancada para leitura, com só as pastas de envio abertas (o caso do
  // álbum da turma): as de crédito que começam com "!" (v3.4). Com elas, o
  // botão abre o diálogo que leva à pasta certa de cada evento; sem JS, o link
  // continua indo para a pasta do álbum. O crédito `outros` é o jeito antigo.
  const temEnvio = !!urlPasta && caps.length > 0 && !!event.galeriaCapitulos && chavesDeEnvio(event.galeriaCreditos).size > 0;
  const temOutros = !temEnvio && !!urlPasta && parseCreditos(event.galeriaCreditos).has('outros');
  const dicaEnvio = temEnvio
    ? '<p class="al-dica">Toque em <b>Mandar suas fotos</b> e escolha o evento.</p>'
    : temOutros ? '<p class="al-dica">Para mandar fotos: abra o evento e a pasta <b>outros</b>.</p>' : '';
  const envio = temEnvio ? envioHTML(slug, urlPasta) : '';
  const kicker = doDominio ? doDominio.linha : (event.date ? String(event.date).slice(0, 4) : '');
  // O texto de abertura vem ANTES dos botões, em todo estilo (v3.8.2, pedido
  // do dono: a turma tem de ler antes de sair clicando).
  // A busca nas fotos fica junto dos botões (v3.8.2, pedido do dono): o
  // campo vai para a abertura; os resultados, para o corpo da página.
  const corteBusca = (p.buscaFotos || '').indexOf('<section class="rs-res" id="bf-res"');
  const buscaTopo = p.buscaFotos && corteBusca > 0 ? p.buscaFotos.slice(0, corteBusca) : (p.buscaFotos || '');
  const buscaRes = p.buscaFotos && corteBusca > 0 ? p.buscaFotos.slice(corteBusca) : '';
  // Aviso de fotos novas no celular (v3.8.4): o script mostra o botão quando
  // o navegador sabe receber aviso (no iPhone, só com o site na Tela de Início).
  const avisoHTML = restrito ? '' : `<div class="al-aviso" id="av" data-slug="${escape(slug)}" hidden><button type="button" class="al-aviso-btn" id="av-btn" aria-pressed="false">${ICONE_SINO}<span id="av-txt">Avisar quando chegar foto nova</span></button><p class="al-aviso-msg" id="av-msg" role="status"></p></div>`;
  const cabecalho = () => `${kicker ? `<span class="al-kick">${escape(kicker)}</span>` : ''}<h1 class="al-tit">${escape(titulo)}</h1>${intro ? `<div class="al-intro">${intro}</div>` : ''}${meta ? `<p class="al-meta">${escape(meta)}</p>` : ''}${botoes}${buscaTopo}${dicaEnvio}${avisoHTML}`;

  /** @type {string} */
  let primeiraTela;
  /** @type {string} */
  let cssEstilo;
  if (estilo === 'tela-cheia') {
    const n = heroi.length;
    primeiraTela = `<header class="al-hero${n ? '' : ' al-sem-foto'}">${n ? `<div class="al-slides" aria-hidden="true">${heroi.map((id, i) => `<img ${fonteLh3(id, [960, 1600, 2400], '100vw')} alt="" decoding="async"${i === 0 ? ' fetchpriority="high"' : ''} referrerpolicy="no-referrer">`).join('')}</div>` : ''}
    <div class="al-hero-txt">${cabecalho()}</div><a class="al-desce" href="#sobre" aria-label="Rolar para baixo">⌄</a></header>`;
    cssEstilo = cssTelaCheia(n);
  } else if (estilo === 'mosaico') {
    const m = heroi.slice(0, 5);
    primeiraTela = `<header class="al-mos-h">${m.length >= 3 ? `<div class="al-mos" aria-hidden="true">${m.map((id, i) => `<img ${i === 0 ? fonteLh3(id, [640, 960, 1200, 1600], '(max-width:700px) 100vw, 60vw') : fonteLh3(id, [320, 480, 640], '(max-width:700px) 50vw, 25vw')} alt="" decoding="async"${i === 0 ? ' fetchpriority="high"' : ''} referrerpolicy="no-referrer">`).join('')}</div>` : ''}
    <div class="al-mos-txt${m.length >= 3 ? '' : ' al-sem-foto'}">${cabecalho()}</div></header>`;
    cssEstilo = CSS_MOSAICO;
  } else if (estilo === 'recordacao') {
    // Polaroids: um evento em cada, com o nome escrito embaixo.
    const pol = restrito ? [] : caps.map(c => ({ nome: c.nome, id: capasDe(c.id)[1] || capasDe(c.id)[0] })).filter(x => x.id).slice(0, 5);
    primeiraTela = `<header class="al-papel">${pol.length >= 2 ? `<div class="al-mesa" aria-hidden="true">${pol.map((x, i) => `<div class="al-pol al-p${i + 1}"><img ${fonteLh3(x.id, [320, 480, 640], '(max-width:700px) 45vw, 240px')} alt="" decoding="async" referrerpolicy="no-referrer"><span>${escape(x.nome)}</span></div>`).join('')}</div>` : ''}
    <div class="al-pol-txt">${cabecalho()}</div></header>`;
    cssEstilo = CSS_RECORDACAO;
  } else {
    primeiraTela = `<header class="al-linha-h">${cabecalho()}</header>`;
    cssEstilo = CSS_LINHA;
  }

  // A linha do tempo: os cartões levam `ix-card`, `data-cap`, `data-cr` e
  // `.ix-sub` — é o que o script das "N novas" e o indexador da busca pelo
  // rosto procuram (o indexador lê os links /galeria/<slug>/<cap>).
  const grande = estilo === 'linha';
  const itens = caps.map(c => {
    const r = resumo[c.id];
    const cs = capasDe(c.id);
    const periodo = r ? rotuloDoPeriodo(r.p) : '';
    const n = r ? r.n : 0;
    const sub = r ? (n === 1 ? '1 foto' : `${n.toLocaleString('pt-BR')} fotos`) : 'Ver fotos';
    const cr = r && r.cr && r.cr.length ? ` data-cr="${r.cr.join(',')}"` : '';
    const img = (/** @type {string} */ id, /** @type {number} */ w) => `<img ${fonteLh3(id, w > 600 ? [400, 640, 900, 1200] : [320, 480, 640], w > 600 ? '(max-width:700px) 92vw, 640px' : '(max-width:700px) 46vw, 320px')} alt="" loading="lazy" decoding="async" referrerpolicy="no-referrer">`;
    const fotosHtml = grande
      ? `<span class="al-fx">${cs[0] ? img(cs[0], 900) : '<span class="al-vazio"></span>'}${cs[1] ? img(cs[1], 500) : ''}</span>`
      : (cs[0] ? img(cs[0], 800) : '<span class="al-vazio"></span>');
    return `<li>${periodo ? `<span class="al-mes">${escape(periodo)}</span>` : ''}<a class="ix-card al-card" href="${escape(`${base}/${c.slug}`)}" data-cap="${escape(c.slug)}"${cr}>${fotosHtml}<span class="al-nm"><b>${escape(c.nome)}</b><span class="ix-sub">${escape(sub)}</span></span></a></li>`;
  });
  // Muitos eventos (v3.8.2): a linha do tempo vira uma grade compacta,
  // separada por ano, com atalhos para cada ano. Poucos: o desenho do estilo.
  const compacta = caps.length > EVENTOS_COMPACTOS;
  const linha = compacta ? gradeDeEventos(caps, resumo, capasDe, base) : itens.length
    ? `<section class="al-sec" id="eventos" aria-labelledby="al-eventos-t"><span class="al-kick">Linha do tempo</span><h2 id="al-eventos-t">${grande ? 'Evento por evento' : 'A nossa história, evento por evento'}</h2><ol class="${grande ? 'al-big' : 'al-tl'}">${itens.join('')}</ol></section>`
    : '<p class="al-sec al-vazio-msg" id="eventos">As fotos estão chegando. Volte em breve.</p>';

  // Só os nomes, na ordem de quem tem mais fotos (v3.7.6, pedido do dono: a
  // contagem por pessoa soava como relatório).
  const quem = autores.length
    ? `<section class="al-sec" aria-labelledby="al-quem-t"><span class="al-kick">Quem fotografou</span><h2 id="al-quem-t">As fotos são de</h2><div class="al-cred">${autores.slice(0, 8).map(([nome]) => `<div><span>${escape(nome)}</span></div>`).join('')}</div></section>`
    : '';

  // "Apoie o projeto" (Pix estático): só com chave, nome e cidade no painel, e
  // só em álbum público. O QR e o "copia e cola" levam o mesmo código.
  const pix = restrito ? '' : brCodePix({ chave: event.pixChave, nome: event.pixNome, cidade: event.pixCidade });
  const apoio = pix ? apoioHTML(pix, String(event.pixNome || '').trim()) : '';

  const restritoCartao = restrito;
  const capaOg = heroi[0] || dosCaps[0] || '';
  // Álbum com domínio próprio: o cartão de link especial (sem foto de ninguém).
  const ogImage = doDominio && !restritoCartao
    ? { url: `${origem}/og-entrenos.jpg`, width: 1200, height: 630 }
    : ogImageFor(restritoCartao ? '' : event.thumbnailUrl || (capaOg ? urlLh3(capaOg, 1200) : ''));
  const descricao = restritoCartao
    ? previewDescription([], `Galeria de fotos de ${titulo}.`)
    : previewDescription([meta], texto.split('\n')[0].slice(0, 160) || `Galeria de fotos de ${titulo}.`);
  const marca = marcaDoAlbum(slug);
  // Com domínio próprio, a aba diz só o nome do álbum (o fotos é a base, v3.7.1).
  const tituloPagina = marca ? titulo : `${titulo} — fotos`;
  // O endereço principal: a raiz do domínio próprio, quando há (v3.7.1).
  const canonico = enderecoDoAlbum(slug);

  return `<!DOCTYPE html>
<html lang="pt-BR">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0, viewport-fit=cover">
  <meta name="robots" content="${indexavel ? 'index,follow,max-image-preview:large' : 'noindex,nofollow'}">
  <meta name="theme-color" content="#0f0e0c">
  <link rel="icon" type="image/svg+xml" href="${marca ? marca.icone : '/icon.svg'}">
  <link rel="apple-touch-icon" href="${marca ? marca.apple : '/apple-touch-icon.png'}">
  ${marca ? '<link rel="manifest" href="/manifest-album.json"><meta name="apple-mobile-web-app-capable" content="yes"><meta name="apple-mobile-web-app-title" content="' + escape(titulo) + '">' : ''}
  <title>${escape(tituloPagina)}</title>
  <link rel="canonical" href="${escape(canonico)}">
  ${socialMetaHTML({ title: titulo, description: descricao, url: canonico, image: ogImage.url, imageAlt: `Fotos de ${titulo}`, imageWidth: ogImage.width, imageHeight: ogImage.height , ...(marca ? { siteName: marca.siteName } : {}) })}
  ${fontPreloadHTML()}
  ${photoPreconnectHTML()}
  <style>
    ${fontFaceCSS()}
    ${fontFaceAlbumCSS()}
    ${CSS_BASE}
    ${cssEstilo}
    ${ROSTO_CSS}
    ${p.buscaFotos ? BUSCA_CSS : ''}
    ${HONEYPOT_CSS}
  </style>
  ${navegacaoFluidaHTML(p.nonce || '')}
</head>
<body class="al al-${estilo}">
  ${p.barraDono}
  ${primeiraTela}
  ${p.avisoTrunc}
  <main id="g-main">
    <span id="sobre"></span>
    ${p.rostoDialog}
    ${buscaRes ? `<section class="al-sec al-busca" aria-label="Resultado da busca nas fotos">${buscaRes}</section>` : ''}
    ${envio}
    ${linha}
    ${quem}
    ${apoio}
  </main>
  <footer class="al-fim">
    ${recado ? `<p class="al-recado">${recado.split('\n').map(l => escape(l.trim())).join('<br>')}</p>` : ''}
    <span class="al-kick">${escape(titulo)}</span>
    <div class="al-legal">${footerLegalLinksHTML(marca ? 'https://fotos.lucafchala.com' : '')}</div>
  </footer>
  ${p.scripts}
  ${apoio ? `<script nonce="${p.nonce || ''}">${SCRIPT_PIX}</script>` : ''}
  ${envio ? `<script nonce="${p.nonce || ''}">${SCRIPT_ENVIO}</script>` : ''}
</body>
</html>`;
}

/** O QR de um texto, em SVG (escuro sobre branco, com a margem de 4 módulos). @param {string} texto */
function qrSVG(texto) {
  let q;
  try { q = qrLinhas(texto); } catch { return ''; }
  const m = 4;
  const lado = q.n + 2 * m;
  let d = '';
  q.linhas.forEach((linha, y) => {
    // Um retângulo por sequência de módulos escuros na linha: SVG bem menor.
    for (let x = 0; x < linha.length;) {
      if (linha[x] !== '1') { x++; continue; }
      let f = x;
      while (f < linha.length && linha[f] === '1') f++;
      d += `M${x + m} ${y + m}h${f - x}v1h${x - f}z`;
      x = f;
    }
  });
  return `<svg class="al-pix-qr" viewBox="0 0 ${lado} ${lado}" role="img" aria-label="QR code do Pix" shape-rendering="crispEdges"><rect width="${lado}" height="${lado}" fill="#fff"/><path d="${d}" fill="#141a33"/></svg>`;
}

/** A seção "Apoie o projeto". @param {string} pix o código copia e cola @param {string} nome o recebedor */
function apoioHTML(pix, nome) {
  return `<section class="al-sec al-apoio" aria-labelledby="al-apoio-t">
      <span class="al-kick">Apoie o projeto</span>
      <h2 id="al-apoio-t">Gostou do álbum?</h2>
      <div class="al-pix">
        ${qrSVG(pix)}
        <div class="al-pix-txt">
          <p>O álbum é gratuito e sem anúncios. Se quiser ajudar com o domínio, o servidor e a busca pelo rosto, qualquer valor é bem-vindo, pelo Pix.</p>
          <label class="al-pix-rot" for="al-pix-cod">Pix copia e cola</label>
          <textarea id="al-pix-cod" class="al-pix-cod" rows="4" readonly>${escape(pix)}</textarea>
          <button type="button" class="al-btn al-b1" id="al-pix-copiar" hidden>Copiar código Pix</button>
          <p class="al-pix-nota" id="al-pix-ok" role="status"></p>
          <p class="al-pix-nota">${nome ? `Vai direto para ${escape(nome)}. ` : ''}O site não fica sabendo quem doou nem quanto.</p>
        </div>
      </div>
    </section>`;
}

// O botão "Copiar" (sem JS, o código continua no campo para copiar à mão).
// Fora de crase, dollar-chave e barra invertida: JS dentro de template literal.
const SCRIPT_PIX = `(function () {
  var b = document.getElementById('al-pix-copiar');
  var t = document.getElementById('al-pix-cod');
  var ok = document.getElementById('al-pix-ok');
  if (!b || !t || !navigator.clipboard) return;
  b.hidden = false;
  b.addEventListener('click', function () {
    navigator.clipboard.writeText(t.value).then(function () {
      ok.textContent = 'Código copiado. Abra o app do banco, escolha Pix copia e cola e cole.';
      b.textContent = 'Copiado';
      setTimeout(function () { b.textContent = 'Copiar código Pix'; }, 3000);
    }, function () { t.select(); ok.textContent = 'Selecione o código e copie.'; });
  });
  t.addEventListener('focus', function () { t.select(); });
})();`;

/**
 * O diálogo "Mandar suas fotos" (v3.4): o script mostra os eventos (e o ano ou
 * a banda, quando há mais de uma pasta no evento) e leva à pasta de envio
 * certa no Drive. Usa o visual do diálogo da busca pelo rosto (`.rs`).
 * @param {string} slug
 * @param {string} urlPasta a pasta do álbum (o caminho de volta)
 */
function envioHTML(slug, urlPasta) {
  return `<dialog class="rs al-env" id="al-env" aria-labelledby="al-env-t" data-slug="${escape(slug)}">
      <p class="rs-t" id="al-env-t">Mandar suas fotos</p>
      <p class="al-env-como">As fotos vão para a pasta do evento no Google Drive. Lá, entre com sua conta Google, toque em <b>+</b> (ou <b>Novo</b>) e escolha <b>Fazer upload</b>.</p>
      <p class="al-env-msg" id="al-env-msg" role="status"></p>
      <ul class="al-env-lista" id="al-env-lista"></ul>
      <p class="al-env-raiz">Não achou o evento? <a href="${escape(urlPasta)}" target="_blank" rel="nofollow noopener">Abrir a pasta do álbum</a></p>
      <div class="rs-acoes"><button type="button" class="rs-btn" id="al-env-voltar" hidden>Voltar</button><button type="button" class="rs-btn" data-env="fechar">Fechar</button></div>
    </dialog>`;
}

// O script do diálogo. Sem JS (ou sem <dialog>), o botão segue como link para a
// pasta do álbum. Os eventos saem na ordem da linha do tempo da página. Tudo
// por textContent: nome de pasta do Drive nunca vira HTML.
// Fora de crase, dollar-chave e barra invertida: JS dentro de template literal.
export const SCRIPT_ENVIO = `(function () {
  var a = document.querySelector('[data-acao="mandar-fotos"]');
  var d = document.getElementById('al-env');
  if (!a || !d || typeof d.showModal !== 'function' || !window.fetch) return;
  var lista = document.getElementById('al-env-lista');
  var tit = document.getElementById('al-env-t');
  var msg = document.getElementById('al-env-msg');
  var voltar = document.getElementById('al-env-voltar');
  var slug = d.getAttribute('data-slug') || '';
  var pastas = null;
  var carregando = false;
  function limpa() { while (lista.firstChild) lista.removeChild(lista.firstChild); }
  function opcao(el, texto, sub) {
    el.className = 'al-env-op';
    var s = document.createElement('span');
    var b = document.createElement('b');
    b.textContent = texto;
    s.appendChild(b);
    if (sub) { var m = document.createElement('small'); m.textContent = sub; s.appendChild(m); }
    el.appendChild(s);
    var li = document.createElement('li');
    li.appendChild(el);
    lista.appendChild(li);
  }
  function link(texto, url, sub) {
    if (!/^https:[/][/]drive[.]google[.]com[/]/.test(url)) return;
    var x = document.createElement('a');
    x.href = url;
    x.target = '_blank';
    x.rel = 'nofollow noopener';
    opcao(x, texto, sub);
  }
  function botao(texto, sub, fn) {
    var x = document.createElement('button');
    x.type = 'button';
    x.addEventListener('click', fn);
    opcao(x, texto, sub);
  }
  function eventos() {
    limpa();
    voltar.hidden = true;
    msg.textContent = '';
    tit.textContent = 'Para qual evento?';
    var pos = {};
    var cards = document.querySelectorAll('.ix-card[data-cap]');
    for (var i = 0; i < cards.length; i++) pos[cards[i].getAttribute('data-cap')] = i;
    var ordem = [];
    var grupos = {};
    pastas.forEach(function (p) {
      if (!grupos[p.cap]) { grupos[p.cap] = []; ordem.push(p.cap); }
      grupos[p.cap].push(p);
    });
    ordem.sort(function (x, y) { return (x in pos ? pos[x] : 999) - (y in pos ? pos[y] : 999); });
    ordem.forEach(function (cap) {
      var g = grupos[cap];
      if (g.length === 1) link(g[0].evento, g[0].url, g[0].rotulo);
      else botao(g[0].evento, g.length + ' pastas: escolha qual', function () { subpastas(g); });
    });
  }
  function subpastas(g) {
    limpa();
    voltar.hidden = false;
    tit.textContent = g[0].evento;
    g.forEach(function (p) { link(p.rotulo || 'Fotos gerais do evento', p.url, ''); });
    var primeiro = lista.querySelector('a');
    if (primeiro) primeiro.focus();
  }
  function falhou() {
    limpa();
    tit.textContent = 'Mandar suas fotos';
    msg.textContent = 'Não consegui carregar a lista de eventos agora.';
    botao('Tentar de novo', '', function () {
      limpa();
      msg.textContent = 'Carregando os eventos…';
      carrega();
    });
  }
  // A lista começa a vir assim que a página abre (v3.7.2): quando a pessoa
  // toca no botão, ela já chegou. Falhou antes do toque: o toque tenta de novo.
  var errou = false;
  function carrega() {
    if (pastas || carregando) return;
    carregando = true;
    errou = false;
    fetch('/api/galeria/envio?slug=' + encodeURIComponent(slug), { credentials: 'same-origin', headers: { Accept: 'application/json' } })
      .then(function (r) { if (!r.ok) throw new Error('http ' + r.status); return r.json(); })
      .then(function (j) {
        carregando = false;
        if (!j || !Array.isArray(j.pastas) || !j.pastas.length) { errou = true; if (d.open) falhou(); return; }
        pastas = j.pastas;
        if (d.open) eventos();
      })
      .catch(function () { carregando = false; errou = true; if (d.open) falhou(); });
  }
  a.addEventListener('click', function (e) {
    if (e.ctrlKey || e.metaKey || e.shiftKey || e.altKey) return;
    e.preventDefault();
    d.showModal();
    if (pastas) { eventos(); return; }
    limpa();
    tit.textContent = 'Mandar suas fotos';
    msg.textContent = 'Carregando os eventos…';
    carrega();
  });
  a.addEventListener('pointerenter', carrega);
  a.addEventListener('focus', carrega);
  if ('requestIdleCallback' in window) window.requestIdleCallback(carrega, { timeout: 2500 });
  else setTimeout(carrega, 1200);
  voltar.addEventListener('click', eventos);
  d.querySelector('[data-env="fechar"]').addEventListener('click', function () { d.close(); });
})();`;

// Paleta fixa (escura) da apresentação: as fotos dão a cor. O amarelo e o azul
// são os do Colégio Santa Cruz (as cores `yellow` #F9DE4B e `blue` #243580 do
// site da escola); o azul entra pouco: a faixa do recado, o fim da linha do
// tempo e um brilho atrás do título. As variáveis da segunda linha são as que
// o CSS da busca pelo rosto (indice-comum.js) usa.
const CSS_BASE = `
*,*::before,*::after{box-sizing:border-box;margin:0;padding:0}
:root{--bg:#0f0e0c;--card:#1a1815;--borda:#2b2823;--txt:#f3ede3;--txt2:#cfc6b8;--mudo:#a39a8c;--sol:#f9de4b;--azul:#243580;--pad:clamp(16px,4vw,48px);
  --bg-page:var(--bg);--bg-card:var(--card);--border:var(--borda);--text:var(--txt);--text-2:var(--txt2);--text-muted:var(--mudo);--accent:var(--sol);--warn-text:#f0b46a;--esqueleto:#24211c;color-scheme:dark}
html{scroll-behavior:smooth}
@media (prefers-reduced-motion: reduce){html{scroll-behavior:auto}}
body{background:var(--bg);color:var(--txt);font-family:'Open Sans','Inter',sans-serif;-webkit-font-smoothing:antialiased;-webkit-text-size-adjust:100%;min-height:100vh}
a{color:inherit;text-decoration:none}
:focus-visible{outline:2px solid var(--sol);outline-offset:3px}
.al-tit{font-family:'Open Sans',sans-serif;font-weight:800;letter-spacing:-.03em;line-height:.95;overflow-wrap:anywhere}
.al-kick{display:inline-block;font-size:.74rem;font-weight:600;letter-spacing:.22em;text-transform:uppercase;color:var(--sol)}
.al-meta{color:var(--txt2);font-size:.95rem;margin-top:.2rem}
.al-btns{display:flex;flex-wrap:wrap;gap:.6rem;margin-top:1.6rem}
@media (max-width:520px){.al-btns{flex-direction:column;align-items:stretch}.al-btns .al-btn{justify-content:center}}
.al-dica{margin-top:.7rem;font-size:.82rem;color:var(--mudo)}.al-dica b{color:var(--txt2);font-weight:600}
.al-env-msg{min-height:1.2em;margin:.3rem 0}
.rs .al-env-lista{list-style:none;margin:.2rem 0 0;display:grid;gap:.45rem}
.al-env-op{display:flex;justify-content:space-between;align-items:center;gap:.8rem;width:100%;min-height:52px;padding:.55rem 1rem;border:1px solid var(--borda);border-radius:12px;background:var(--bg);color:var(--txt);font:inherit;text-align:left;cursor:pointer}
.al-env-op span{display:flex;flex-direction:column;gap:.1rem;min-width:0}
.al-env-op b{font-size:.95rem;font-weight:600;overflow-wrap:anywhere}
.al-env-op small{font-size:.78rem;color:var(--mudo)}
.al-env-op::after{content:'›';flex:none;color:var(--sol);font-size:1.4rem;line-height:1}
@media (hover:hover){.al-env-op:hover{border-color:var(--sol)}}
.rs .al-env-raiz{margin-top:.9rem;font-size:.82rem}.al-env-raiz a{color:var(--sol);text-decoration:underline}
.al-pol-txt .al-dica{text-align:center}
.al-btn{display:inline-flex;align-items:center;min-height:46px;padding:0 1.25rem;border-radius:999px;font:inherit;font-weight:600;font-size:.93rem;border:1px solid var(--sol);cursor:pointer;transition:transform .15s ease,background-color .15s ease}
.al-btn:active{transform:scale(.97)}
.al-b1{background:var(--sol);color:#141a33}
.al-rosto{gap:.55rem;justify-content:center}.al-rosto svg{width:1.25rem;height:1.25rem;flex:none}
.al-btns:has(#rs-abrir:not([hidden])) .al-ver{background:rgba(15,14,12,.45);color:var(--sol);-webkit-backdrop-filter:blur(6px);backdrop-filter:blur(6px)}
.al-b2{color:var(--sol);background:rgba(15,14,12,.45);-webkit-backdrop-filter:blur(6px);backdrop-filter:blur(6px)}
@media (hover:hover){.al-b2:hover{background:rgba(249,222,75,.12)}.al-b1:hover{filter:brightness(1.06)}}
.al-sec{display:block;padding:3.5rem var(--pad) 0;max-width:72rem;margin:0 auto}
.al-sec h2{font-family:'Open Sans',sans-serif;font-weight:600;font-size:clamp(1.6rem,4vw,2.4rem);letter-spacing:-.02em;margin:.4rem 0 1.4rem}
.al-intro{max-width:40rem;font-size:clamp(1.02rem,2.2vw,1.18rem);line-height:1.7;color:var(--txt2)}
.al-intro p+p{margin-top:1rem}
.al-tit+.al-intro{margin:0 0 1rem}
.al-pol-txt .al-intro{margin-left:auto;margin-right:auto}
.al-btns+.bf,.al-btns~.bf{margin-top:1rem;max-width:34rem}
.al-pol-txt .bf{margin-left:auto;margin-right:auto}
.al-aviso{margin-top:.9rem;display:grid;gap:.35rem;justify-items:start}
.al-pol-txt .al-aviso{justify-items:center}
.al-aviso-btn{display:inline-flex;align-items:center;gap:.5rem;min-height:44px;padding:0 1rem;border-radius:999px;border:1px solid var(--borda);background:transparent;color:var(--txt2);font:inherit;font-size:.9rem;cursor:pointer}
.al-aviso-btn svg{width:1.1rem;height:1.1rem;flex:none;color:var(--sol)}
.al-aviso-btn[aria-pressed="true"]{border-color:var(--sol);color:var(--txt)}
.al-aviso-btn:disabled{opacity:.6;cursor:default}
.al-aviso-msg{font-size:.82rem;color:var(--mudo);max-width:34rem}
.al-aviso-msg:empty{display:none}
.al-anos{display:flex;flex-wrap:wrap;gap:.4rem;margin:1rem 0 .4rem}
.al-anos a{display:inline-flex;align-items:center;min-height:44px;padding:0 1rem;border-radius:999px;border:1px solid var(--borda);color:var(--txt2);font-weight:600;font-size:.88rem}
@media (hover:hover){.al-anos a:hover{border-color:var(--sol);color:var(--sol)}}
.al-ano{font-family:'Open Sans',sans-serif;font-size:.8rem;font-weight:600;letter-spacing:.16em;color:var(--sol);margin:1.6rem 0 .7rem;scroll-margin-top:1rem}
.al-grade{list-style:none;display:grid;gap:.7rem;grid-template-columns:repeat(auto-fill,minmax(9.5rem,1fr))}
.al-mini{margin-top:0}
.al-mini img,.al-mini .al-vazio{display:block;width:100%;height:auto;aspect-ratio:4/3;object-fit:cover;background:var(--esqueleto)}
.al-mini .al-nm{flex-direction:column;gap:.15rem;padding:.55rem .65rem .65rem}
.al-mini .al-nm b{font-size:.95rem;line-height:1.3;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden}
.al-mini .al-nm .ix-sub{font-size:.75rem}
.al-vazio-msg{color:var(--mudo)}
.al-vazio{display:block;width:100%;aspect-ratio:16/9;background:var(--esqueleto)}
.al-sem-foto{padding-top:clamp(3rem,10vh,6rem)}
.al-tl{list-style:none;position:relative;display:grid;gap:1.1rem;grid-template-columns:1fr}
.al-tl::before{content:"";position:absolute;left:7px;top:6px;bottom:6px;width:2px;background:linear-gradient(var(--sol),var(--azul) 70%,var(--borda))}
.al-tl>li{position:relative;padding-left:2rem}
.al-tl>li::before{content:"";position:absolute;left:0;top:.3rem;width:16px;height:16px;border-radius:50%;background:var(--bg);border:3px solid var(--sol)}
.al-mes{display:block;font-size:.72rem;font-weight:600;letter-spacing:.16em;text-transform:uppercase;color:var(--sol);min-height:1em}
.al-card{display:block;margin-top:.45rem;border-radius:14px;overflow:hidden;background:var(--card);border:1px solid var(--borda);transition:border-color .2s ease}
@media (hover:hover){.al-card:hover{border-color:var(--sol)}}
.al-tl img{display:block;width:100%;height:auto;aspect-ratio:16/9;object-fit:cover;background:var(--esqueleto)}
.al-nm{display:flex;justify-content:space-between;gap:1rem;align-items:baseline;padding:.75rem .9rem}
.al-nm b{font-family:'Open Sans',sans-serif;font-weight:600;font-size:1.15rem;overflow-wrap:anywhere}
.al-nm .ix-sub{font-size:.8rem;color:var(--mudo);white-space:nowrap}
.ix-novas{display:inline-block;margin-left:.45rem;padding:.05rem .45rem;border:1px solid var(--sol);border-radius:999px;font-size:.7rem;color:var(--sol);white-space:nowrap}
@media (min-width:760px){.al-tl{grid-template-columns:1fr 1fr;column-gap:2.5rem}.al-tl::before,.al-tl>li::before{display:none}.al-tl>li{padding-left:0}}
.al-cred{display:grid;grid-template-columns:repeat(auto-fit,minmax(12rem,1fr));gap:.8rem}
.al-pix{display:grid;grid-template-columns:1fr;gap:1.2rem;align-items:start;background:var(--card);border:1px solid var(--borda);border-radius:16px;padding:1.2rem}
.al-pix-qr{display:block;width:min(220px,60vw);height:auto;border-radius:10px;justify-self:center}
.al-pix-txt p{color:var(--txt2);line-height:1.6}
.al-pix-rot{display:block;margin-top:1rem;font-size:.8rem;color:var(--mudo)}
.al-pix-cod{display:block;width:100%;margin-top:.3rem;padding:.6rem .7rem;border:1px solid var(--borda);border-radius:10px;background:var(--bg);color:var(--txt2);font:12px/1.4 ui-monospace,SFMono-Regular,Menlo,monospace;resize:none;word-break:break-all}
.al-pix .al-btn{margin-top:.8rem}
.al-pix-nota{margin-top:.6rem;font-size:.8rem;color:var(--mudo)}
@media (min-width:760px){.al-pix{grid-template-columns:auto 1fr;padding:1.6rem}.al-pix-qr{width:220px}}
.al-cred div{background:var(--card);border:1px solid var(--borda);border-radius:14px;padding:1.1rem 1.2rem}
.al-cred span{display:block;font-family:'Open Sans',sans-serif;font-size:1.35rem;font-weight:700;color:var(--sol);overflow-wrap:anywhere}
.rs-res{max-width:72rem;margin:0 auto;padding:2.5rem var(--pad) 0}
.rs-res h2{font-family:'Open Sans',sans-serif;font-size:1.5rem}
.al-fim{margin:4.5rem 0 0;padding:3.5rem var(--pad) 2.5rem;text-align:center;background:linear-gradient(180deg,var(--bg) 0%,#141a33 30%,#172154 100%);border-top:1px solid #1f2a5c}
.al-fim .al-kick{color:var(--sol)}
.al-recado{max-width:40rem;margin:0 auto 1.4rem;font-family:'Open Sans',sans-serif;font-style:italic;font-weight:500;font-size:clamp(1.3rem,3.4vw,1.9rem);line-height:1.4;color:var(--txt2)}
.al-legal{margin-top:2rem;font-size:.8rem;color:var(--mudo)}
.al-legal .footer-actions-legal{display:flex;flex-wrap:wrap;justify-content:center;gap:.2rem 1rem}
.al-legal a{display:inline-flex;align-items:center;min-height:44px;text-decoration:underline;text-underline-offset:3px}
.al-legal .footer-copyright{margin-top:.4rem}
.ix-dono{display:flex;flex-wrap:wrap;align-items:center;gap:.4rem 1rem;padding:.5rem var(--pad);font-size:.78rem;color:var(--mudo);background:var(--card);border-bottom:1px solid var(--borda);position:relative;z-index:3}
.ix-dono a{color:var(--txt2);text-decoration:underline;text-underline-offset:2px;padding:.55rem 0}
.ix-dono b{font-weight:600;color:var(--sol);letter-spacing:.06em;text-transform:uppercase;font-size:.7rem;border:1px solid var(--sol);border-radius:4px;padding:.1rem .4rem}
.ix-aviso{margin:1rem var(--pad);padding:.7rem .9rem;border:1px solid #4a3a12;background:#1d1606;color:#d8b25a;border-radius:8px;font-size:.85rem}
`;

/** A tela cheia, com a troca de N fotos: cada uma fica 6 s, com 1 s de fusão. @param {number} n */
function cssTelaCheia(n) {
  const T = 6;
  const total = Math.max(1, n) * T;
  const pct = (/** @type {number} */ s) => `${((s / total) * 100).toFixed(2)}%`;
  const troca = n > 1
    ? `.al-slides img{opacity:0;animation:al-troca ${total}s linear infinite}
${Array.from({ length: n }, (_, i) => `.al-slides img:nth-child(${i + 1}){animation-delay:${i * T - 1}s}`).join('')}
@keyframes al-troca{0%{opacity:0;transform:scale(1.08)}${pct(1)}{opacity:1}${pct(T)}{opacity:1}${pct(T + 1)}{opacity:0;transform:scale(1)}100%{opacity:0;transform:scale(1)}}
@media (prefers-reduced-motion: reduce){.al-slides img{animation:none;opacity:0}.al-slides img:first-child{opacity:1}}`
    : '';
  return `
.al-hero{position:relative;min-height:100svh;display:flex;align-items:flex-end;overflow:hidden}
.al-slides img{position:absolute;inset:0;width:100%;height:100%;object-fit:cover;background:var(--esqueleto)}
${troca}
.al-hero:not(.al-sem-foto)::after{content:"";position:absolute;inset:0;background:linear-gradient(180deg,rgba(15,14,12,.25) 0%,rgba(15,14,12,0) 30%,rgba(15,14,12,.7) 68%,var(--bg) 100%)}
.al-hero-txt{position:relative;z-index:1;width:100%;max-width:72rem;margin:0 auto;padding:0 var(--pad) clamp(3rem,9vh,5.5rem)}
.al-hero .al-tit{font-size:clamp(3.6rem,16vw,10.5rem);margin:.6rem 0 .8rem}
.al-desce{position:absolute;z-index:1;left:50%;bottom:.6rem;transform:translateX(-50%);display:flex;align-items:center;justify-content:center;width:44px;height:44px;color:var(--mudo);font-size:1.4rem}
.ix-dono+.al-hero{min-height:calc(100svh - 40px)}`;
}

const CSS_MOSAICO = `
.al-mos{position:relative;display:grid;grid-template-columns:repeat(4,1fr);grid-template-rows:repeat(2,clamp(110px,19vw,280px));gap:4px}
.al-mos img{display:block;width:100%;height:100%;object-fit:cover;background:var(--esqueleto)}
.al-mos img:first-child{grid-column:span 2;grid-row:span 2}
.al-mos::after{content:"";position:absolute;inset:auto 0 0;height:45%;background:linear-gradient(transparent,var(--bg));pointer-events:none}
@media (max-width:560px){.al-mos{grid-template-columns:repeat(3,1fr);grid-template-rows:repeat(2,30vw)}.al-mos img:nth-child(n+4){display:none}}
.al-mos-txt{position:relative;max-width:72rem;margin:-3.5rem auto 0;padding:0 var(--pad)}
.al-mos-txt::before{content:"";position:absolute;z-index:-1;left:-10%;top:10%;width:70%;height:90%;background:radial-gradient(closest-side,rgba(36,53,128,.45),transparent);pointer-events:none}
.al-mos-h{position:relative;isolation:isolate}
.al-mos-txt.al-sem-foto{margin-top:0;padding-top:clamp(2.5rem,9vw,5.5rem)}
.al-mos-h .al-tit{font-size:clamp(3.2rem,12vw,7.5rem);margin:.5rem 0 .7rem}`;

const CSS_RECORDACAO = `
.al-papel{background:radial-gradient(ellipse at 30% 0%,#1b2347 0%,var(--bg) 62%);padding:clamp(2rem,6vh,4rem) var(--pad) 1rem;overflow:hidden}
.al-mesa{position:relative;height:clamp(300px,52vw,520px);max-width:60rem;margin:0 auto}
.al-pol{position:absolute;background:#fbf7ef;padding:10px 10px 38px;box-shadow:0 18px 40px rgba(0,0,0,.45);width:clamp(140px,30vw,300px)}
.al-pol img{display:block;width:100%;aspect-ratio:1;object-fit:cover;background:#ddd6c8}
.al-pol span{position:absolute;left:6px;right:6px;bottom:6px;text-align:center;font-family:'Caveat',cursive;font-size:clamp(1.1rem,2.6vw,1.6rem);color:#3a3226;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.al-pol::before{content:"";position:absolute;top:-10px;left:50%;width:70px;height:22px;transform:translateX(-50%) rotate(-3deg);background:rgba(249,222,75,.6)}
.al-p1{left:2%;top:6%;transform:rotate(-7deg)}.al-p2{left:23%;top:0;transform:rotate(4deg);z-index:2}.al-p3{left:46%;top:9%;transform:rotate(-3deg);z-index:3}
.al-p4{left:68%;top:2%;transform:rotate(6deg);z-index:1}.al-p5{left:36%;top:38%;transform:rotate(-1deg);z-index:4}
@media (max-width:560px){.al-p1,.al-p4{display:none}.al-p2{left:0}.al-p3{left:44%}.al-p5{left:18%;top:42%}}
.al-pol-txt{text-align:center;max-width:72rem;margin:0 auto;padding:1.5rem 0 0}
.al-recordacao .al-tit{font-family:'Caveat',cursive;font-weight:700;letter-spacing:0;font-size:clamp(4.2rem,16vw,9rem);line-height:.9;margin:.3rem 0 .4rem}
.al-pol-txt .al-btns{justify-content:center}`;

const CSS_LINHA = `
.al-linha-h{max-width:72rem;margin:0 auto;padding:clamp(3rem,10vh,6rem) var(--pad) 0}
.al-linha-h .al-tit{font-size:clamp(3.6rem,14vw,9rem);margin:.5rem 0 1.2rem}
.al-linha-h .al-intro{margin-bottom:1.2rem}
.al-big{list-style:none;position:relative}
.al-big::before{content:"";position:absolute;left:9px;top:0;bottom:0;width:2px;background:linear-gradient(var(--sol),var(--azul) 75%,transparent)}
.al-big>li{position:relative;padding:0 0 2.6rem 2.6rem}
.al-big>li::before{content:"";position:absolute;left:0;top:.15rem;width:20px;height:20px;border-radius:50%;background:var(--bg);border:4px solid var(--sol)}
.al-big .al-mes{font-family:'Open Sans',sans-serif;font-style:italic;font-weight:500;font-size:1.2rem;letter-spacing:0;text-transform:none}
.al-big .al-card{background:none;border:0;border-radius:0;overflow:visible;margin-top:.2rem}
.al-big .al-nm{padding:.7rem 0 0;justify-content:flex-start}
.al-big .al-nm b{font-size:clamp(1.5rem,3.6vw,2.3rem)}
.al-fx{display:grid;grid-template-columns:2fr 1fr;gap:6px;border-radius:16px;overflow:hidden;max-width:46rem}
.al-fx img{display:block;width:100%;height:100%;min-height:0;aspect-ratio:4/3;object-fit:cover;background:var(--esqueleto)}
.al-fx img:only-child{grid-column:span 2;aspect-ratio:16/9}
@media (min-width:900px){
  .al-big::before{left:50%}
  .al-big>li{width:50%;padding:0 3rem 3rem 0;text-align:right}
  .al-big>li::before{left:auto;right:-10px}
  .al-big>li:nth-child(even){margin-left:50%;padding:0 0 3rem 3rem;text-align:left}
  .al-big>li:nth-child(even)::before{right:auto;left:-10px}
  .al-big>li .al-fx{margin-left:auto}.al-big>li:nth-child(even) .al-fx{margin-left:0}
  .al-big>li .al-nm{justify-content:flex-end}.al-big>li:nth-child(even) .al-nm{justify-content:flex-start}
}`;
