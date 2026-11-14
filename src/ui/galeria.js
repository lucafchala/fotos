// Galeria própria (#234/#235). Nos álbuns PÚBLICOS abre a todos, sem login e
// sem o portão do Drive; nos de família e privados, só com o passe que o
// portão emite depois da declaração de acesso (cookie assinado "galeria",
// 12 h, preso a /galeria/<slug>). Álbuns "Em breve" seguem fechados (404).
// A faixa do dono e o ?atualizar só valem para o dono logado
// (ver handleGaleriaPagina).
//
// O que ela faz melhor que a pasta do Drive:
//  - grade justificada com a proporção REAL de cada foto (nada cortado, nada
//    de nome de arquivo poluindo), seções por subpasta;
//  - visualizador em tela cheia (PhotoSwipe, vendorizado em vendor/) que pede
//    ao Google a largura exata da tela em pixels FÍSICOS e, a cada zoom, a
//    próxima — até o original (srcset + o `sizes` que o PhotoSwipe atualiza);
//  - dois downloads por foto, os DOIS byte a byte e com o nome exato do Drive
//    (o site não altera arquivo): "tamanho máximo" (o original) e "para redes"
//    (o arquivo de mesmo nome da pasta do Instagram do projeto, já pronto —
//    só aparece nas fotos que têm par lá). Android e computador: download
//    comum. iPhone/iPad: "Salvar no Fotos" (a folha do sistema com o arquivo,
//    um toque até o app Fotos) e "Baixar arquivo" (vai para o app Arquivos);
//  - seleção de várias fotos, lembrada no aparelho, e link direto para cada
//    foto (?foto=código; o #foto= antigo também abre).
//
// As fotos vêm do lh3 do Google (sem chave). Os downloads passam pelo proxy
// /galeria/<slug>/baixar/<id>, que só entrega arquivo que está na pasta do
// projeto (ou na do Instagram dele). A chave da Drive API nunca chega a esta
// página.

import { escape, jsonParaScript, marcaDoAlbum, baseDaGaleria, enderecoDoEvento, enderecoDoAlbum, safeUrl, formatDatePT, fontFaceCSS, fontPreloadHTML, photoPreconnectHTML, navegacaoFluidaHTML, socialMetaHTML, ogImageFor, previewDescription, isRestrictedAccess, PERSON_LD } from '../utils.js';
import { VENDOR } from '../content/vendor.js';
import { PALETA_ALBUM as P, GALERIA_LARGURAS, GALERIA_LARGURAS_GRADE, GALERIA_MINIATURA_TENTATIVAS, TURNSTILE_SITE_KEY, AUTOR_PADRAO, EPOCA_CRIADA_MS, NOVAS_SESSAO_MIN } from '../config.js';
import { ehVideo } from '../drive.js';
import { botaoDeAjudaHTML, BOTAO_AJUDA_CSS } from './botao-ajuda.js';
import { honeypotFieldHTML, HONEYPOT_CSS, ASSINATURA_CURTA_LEN } from '../security.js';
import { urlLh3, descreveRenovacao } from '../drive.js';
import { urlFoto } from '../foto-rota.js';
import { nomesDaListagem } from '../nomes.js';
import { rotuloDoPeriodo } from './album.js';
import { navegadorEmbutidoHTML } from './navegador-embutido.js';

// Álbum com domínio próprio (Entre Nós): a página do evento usa a paleta da
// apresentação do álbum, escura e com o amarelo do Santa, em qualquer tema do
// aparelho (v3.7.6). `:root:root` vence o :root claro do prefers-color-scheme.
const TEMA_ALBUM = `
    :root:root{
      --bg-page:${P.bg}; --text:${P.txt}; --text-2:${P.txt2}; --text-muted:${P.mudo}; --text-dim:${P.dim};
      --bg-card:${P.card}; --bg-card-2:${P.card2}; --esqueleto:${P.esqueleto}; --border:${P.borda}; --accent:${P.sol}; --accent-text:#141a33;
      --warn-bg:#1d1606; --warn-border:#4a3a12; --warn-text:#f0b46a;
      --err-bg:#1a0a0a; --err-border:#2e1a1a; --err-text:#e0a0a0;
      color-scheme:dark;
    }
    .g-fim{display:flex;flex-direction:column;align-items:center;padding:2.5rem var(--pad) 3rem}
    ${BOTAO_AJUDA_CSS}
    .g-fim a{display:inline-flex;align-items:center;min-height:44px;color:var(--text-muted);font-size:.85rem;text-decoration:underline;text-underline-offset:3px}`;

/**
 * O período das fotos de uma listagem, pelas datas de captura: [AAAAMM, AAAAMM]
 * (o mesmo de `p` no resumo do capítulo), ou null.
 * @param {import('../drive.js').ListagemDrive | null} listagem
 * @returns {[number, number] | null}
 */
function periodoDaListagem(listagem) {
  if (!listagem) return null;
  let min = 0, max = 0;
  for (const sec of listagem.secoes) for (const f of sec.fotos) {
    const hora = Number(f[6]) || 0;
    if (hora <= 19000101000000) continue;
    const m = Math.floor(hora / 1e8);
    if (!min || m < min) min = m;
    if (m > max) max = m;
  }
  return min ? [min, max] : null;
}

const SITE_URL = 'https://fotos.lucafchala.com';
// Quantas fotos o JSON-LD descreve como ImageObject. Poucas: o sitemap de
// imagens (/sitemap-galeria-<slug>.xml) é quem lista todas; aqui é só o
// bastante para o buscador ligar fotos, galeria e autor sem inchar o HTML.
const LD_FOTOS = 12;

/** @param {string} source */
const vendorPath = source => {
  const v = VENDOR.find(x => x.source === source);
  if (!v) throw new Error(`vendor ausente: ${source}`);
  return v.path;
};

// O conserto de cada erro, escrito para o dono — é ele quem vê esta página.
/** @type {Record<string, { titulo: string, passos: string[] }>} */
const CONSERTOS = {
  'chave-ausente': {
    titulo: 'Falta conectar o site ao Google Drive',
    passos: [
      'Abra <a href="https://console.cloud.google.com/apis/library/drive.googleapis.com" target="_blank" rel="noopener">a Google Drive API no Google Cloud</a> (crie um projeto se for o primeiro) e clique em <strong>Ativar</strong>.',
      'Em <a href="https://console.cloud.google.com/apis/credentials" target="_blank" rel="noopener">Credenciais</a>: <strong>Criar credenciais → Chave de API</strong>.',
      'Edite a chave: em <strong>Restrições de API</strong>, marque só a <strong>Google Drive API</strong>. Em restrição de aplicativo, deixe <strong>Nenhuma</strong> (o servidor da Cloudflare não tem IP fixo).',
      'Guarde a chave como segredo do site: <code>npx wrangler secret put GOOGLE_DRIVE_API_KEY</code> (ou no painel da Cloudflare: Workers → fotos → Configurações → Variáveis e segredos → Adicionar → tipo Segredo).',
      'Recarregue esta página.',
    ],
  },
  'chave-invalida': {
    titulo: 'O Google recusou a chave',
    passos: [
      'Confira em <a href="https://console.cloud.google.com/apis/credentials" target="_blank" rel="noopener">Credenciais</a> se a chave ainda existe.',
      'Grave de novo, sem espaço sobrando: <code>npx wrangler secret put GOOGLE_DRIVE_API_KEY</code>.',
    ],
  },
  'chave-restrita': {
    titulo: 'A chave está restrita de um jeito que bloqueia o site',
    passos: [
      'Na chave, em <strong>Restrições de aplicativo</strong>, escolha <strong>Nenhuma</strong> — restrição por site ou IP bloqueia o servidor.',
      'Em <strong>Restrições de API</strong>, a <strong>Google Drive API</strong> precisa estar marcada.',
    ],
  },
  'api-desligada': {
    titulo: 'A Google Drive API está desligada nesse projeto',
    passos: [
      'Ative em <a href="https://console.cloud.google.com/apis/library/drive.googleapis.com" target="_blank" rel="noopener">Google Drive API → Ativar</a>, no MESMO projeto da chave. Leva até alguns minutos para valer.',
    ],
  },
  'pasta-inacessivel': {
    titulo: 'O Drive não deixou ler esta pasta',
    passos: [
      'No Drive, na pasta do projeto: <strong>Compartilhar → Acesso geral → Qualquer pessoa com o link</strong> (Leitor) — é o mesmo que o visitante já usa hoje.',
      'Confira se o link no cadastro do projeto (painel → Editar) é o da pasta, e não o de uma foto.',
    ],
  },
  'sem-pasta': {
    titulo: 'Este projeto não tem uma pasta do Drive reconhecível',
    passos: [
      'No painel, edite o projeto e cole no link do Drive o endereço da <strong>pasta</strong> (drive.google.com/drive/folders/…).',
    ],
  },
  limite: {
    titulo: 'O Google limitou as consultas por um momento',
    passos: ['Espere alguns minutos e recarregue.'],
  },
  // Primeira leitura desta pasta (ou depois de um longo intervalo) já em curso
  // por outro visitante: nada a consertar, só esperar (a página se recarrega).
  carregando: {
    titulo: 'Carregando as fotos…',
    passos: [],
  },
  falha: {
    titulo: 'O Google Drive não respondeu',
    passos: ['Recarregue em instantes. Se continuar, veja /api/healthz e o status do Google Workspace.'],
  },
};

/**
 * As assinaturas das fotos de uma seção, juntas (ver `as` nos dados da página).
 * @param {import('../drive.js').FotoDrive[]} fotos
 * @param {(id: string) => string} assina dá `<slug>.<assinatura>`, ou só o slug
 */
function assinaturasDaSecao(fotos, assina) {
  const crua = /** @type {any} */ (assina).crua;
  const partes = typeof crua === 'function'
    ? fotos.map(f => crua(f[0]))
    : fotos.map(f => { const k = assina(f[0]); const p = k.indexOf('.'); return p < 0 ? '' : k.slice(p + 1); });
  if (!partes.some(Boolean)) return '';
  return partes.map(a => (a.length === ASSINATURA_CURTA_LEN ? a : ' '.repeat(ASSINATURA_CURTA_LEN))).join('');
}

/**
 * @param {{
 *   event: import('../utils.js').Evento,
 *   listagem: import('../drive.js').ListagemDrive | null,
 *   erro: { codigo: string, mensagem: string } | null,
 *   nonce: string,
 *   dono?: boolean,
 *   ocultas?: string[],
 *   pendentes?: string[],
 *   formToken?: string,
 *   indexavel?: boolean,
 *   redes?: Map<string, import('../drive.js').FotoDrive>,
 *   avisoRedes?: { mensagem: string, parcial: boolean } | null,
 *   listagemBruta?: import('../drive.js').ListagemDrive | null,
 *   capituloNome?: string,
 *   capitulo?: { slug: string, nome: string, anterior: { slug: string, nome: string } | null, proximo: { slug: string, nome: string } | null, eventos?: { slug: string, nome: string, ano?: string }[] } | null,
 *   host?: string,
 *   assina?: (id: string) => string,
 *   fotoDoLink?: string,
 *   dataDoEvento?: { atual: string, auto: string } | null,
 * }} p
 */
// `indexavel` (padrão false, o lado seguro): a página pode ir para o Google —
// quem decide é handleGaleriaPagina (álbum público e listado, visitante, fora
// da prévia, com fotos). Com false, sai o noindex de antes.
// `pendentes` (só o dono): as ocultas que foram escondidas A PEDIDO de um
// visitante e esperam decisão — ganham o selo "Oculta a pedido".
// `formToken` (só o visitante): o token do formulário "Pedir remoção desta
// foto", assinado por handleGaleriaPagina; vazio quando o site não tem
// SIGNING_SECRET (o servidor então também não confere).
// `listagemBruta` + `capituloNome`: só para "nomes amigáveis" (nomes.js) — a
// listagem COM as ocultas, de onde sai a numeração, e o nome do capítulo.
// `capitulo` (galeria por capítulos): a página é a de UM capítulo, com a
// navegação para o índice e para os vizinhos. Hrefs sempre montados aqui, de
// slugs que o servidor validou.
// Sem link para a pasta no Drive (v3.7.2): com atalhos e subpastas o Drive não
// junta tudo, e quem não é dono da pasta de destino não entra. "Baixar tudo"
// baixa pelo próprio site. Só a faixa do dono mantém "Abrir no Drive".
// `redes` (id da foto da galeria → arquivo da pasta do Instagram, ver casaRedes
// em drive.js): as fotos que têm "para redes". Só tamanho e nome vão para a
// página — o id do arquivo do Instagram nunca sai do servidor.
export function galeriaHTML({ event, listagem, erro, nonce, dono = true, ocultas = [], pendentes = [], formToken = '', indexavel = false, redes = new Map(), avisoRedes = null, listagemBruta = null, capituloNome = '', capitulo = null, host = '', assina = () => '', fotoDoLink = '', dataDoEvento = null }) {
  const titulo = String(event.title || event.slug || '');
  const slug = String(event.slug || '');
  const drive = safeUrl(event.driveUrl);
  const total = listagem ? listagem.total : 0;
  const quando = listagem
    ? new Date(listagem.em).toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })
    : '';

  // Na página de UM evento (capítulo), a data é o período das fotos dele
  // ("jun – set 2025", "2024 – 2026"), não a data do projeto (v3.7.6).
  const dataEvento = capitulo
    ? rotuloDoPeriodo(periodoDaListagem(listagem) || undefined)
    : (event.date ? formatDatePT(String(event.date)) : '');
  // Fotos e vídeos (item 1f): "12 fotos e 2 vídeos". Sem vídeo, o texto de
  // sempre ("12 fotos"). `total` conta os dois.
  const nVideos = listagem ? listagem.secoes.reduce((n, sc) => n + sc.fotos.filter(ehVideo).length, 0) : 0;
  const nFotos = total - nVideos;
  const contagem = [
    nFotos || !nVideos ? (nFotos === 1 ? '1 foto' : `${nFotos} fotos`) : '',
    nVideos ? (nVideos === 1 ? '1 vídeo' : `${nVideos} vídeos`) : '',
  ].filter(Boolean).join(' e ');
  const meta = listagem && total ? [dataEvento, contagem].filter(Boolean).join(' · ') : dataEvento;

  // SEO (decisão do dono, 29/10/2026): título e descrição próprios de cada
  // galeria, canonical, cartão de link com a capa e JSON-LD ligado ao mesmo
  // Person (@id) do resto do site.
  // Álbum com domínio próprio: a marca dele (ícone, aba, cartão), não a do fotos (v3.7.1).
  const marca = marcaDoAlbum(slug);
  const tituloPagina = marca
    ? (capitulo ? `${capitulo.nome} · ${titulo}` : titulo)
    : `Fotos de ${titulo}${capitulo ? ` — ${capitulo.nome}` : ''}${dataEvento ? ` — ${dataEvento}` : ''}`;
  // Links curtos no domínio do álbum (v3.8.3): "entrenos2026.com/piauifut".
  const base = baseDaGaleria(slug, host);
  const caminhoBase = base || '/';
  // Álbum com domínio próprio: o endereço de lá (canonical e cartão de link).
  const urlPagina = capitulo ? enderecoDoEvento(slug, capitulo.slug) : enderecoDoAlbum(slug);
  const todasFotos = listagem ? listagem.secoes.flatMap(s => s.fotos) : [];
  // Autores da listagem (índice 0 = padrão) e os que de fato têm foto na
  // página (sem as ocultas, para o visitante): só com mais de um aparece a
  // linha "Fotos: A, B e C" e o filtro por fotógrafo.
  const autores = listagem && Array.isArray(listagem.aut) && listagem.aut.length ? listagem.aut : [AUTOR_PADRAO];
  const autoresUsados = [...new Set(todasFotos.map(f => f[5] || 0))].sort((a, b) => a - b);
  const variosAutores = autoresUsados.length > 1;
  const linhaAutores = variosAutores ? `Fotos: ${listaComE(autoresUsados.map(i => autores[i] || AUTOR_PADRAO))}` : '';
  // O crédito no topo da página (v3.7.1, pedido do dono: mais destaque para
  // quem fotografou): sempre que há foto, mesmo com um fotógrafo só.
  const nomesDosAutores = autoresUsados.map(i => autores[i] || AUTOR_PADRAO);
  // O alt de cada foto, igual ao do script da página: "<evento> — foto i de n".
  const altFoto = (/** @type {number} */ i) => `${titulo} — foto ${i + 1} de ${total}`;
  const altItem = (/** @type {import('../drive.js').FotoDrive} */ f, /** @type {number} */ i) =>
    ehVideo(f) ? `${titulo} — vídeo ${i + 1} de ${total}` : altFoto(i);
  // Cartão de link (WhatsApp, Telegram, redes): o nome de quem fez o quê vem
  // junto da contagem ("12 fotos · Fotos: Ana e Bruno"); o título de um
  // capítulo é "<Capítulo> · <Projeto>"; a capa do capítulo é a primeira foto
  // DELE (a listagem do visitante já vem sem as ocultas), e só sem foto cai na
  // capa do projeto. Fora de capítulos, a capa é a do projeto e, sem ela, a
  // primeira foto da pasta. Do lh3, sem passar pelo Worker — o robô do cartão
  // não gasta cota nossa. Álbum família/privado só abre com o passe do portão
  // (um robô recebe 404), e MESMO com o passe o cartão sai genérico: sem capa
  // nem nome de capítulo.
  const restrito = isRestrictedAccess(event);
  const creditoDoCartao = variosAutores
    ? linhaAutores
    : autoresUsados.length === 1 && autores[autoresUsados[0]] && autores[autoresUsados[0]] !== AUTOR_PADRAO ? `Fotos: ${autores[autoresUsados[0]]}` : '';
  const descricao = restrito
    ? previewDescription([], `Galeria de fotos de ${titulo}.`)
    : previewDescription(
      [dataEvento, listagem && total ? contagem : '', creditoDoCartao],
      `Galeria de fotos de ${titulo}${capitulo ? ` (${capitulo.nome})` : ''}, por Luca F. Chala. Veja em tela cheia e baixe para as redes ou no tamanho original.`,
    );
  const primeiraFoto = todasFotos.find(f => !ehVideo(f));
  const capaDaFoto = primeiraFoto ? urlLh3(primeiraFoto[0], 1600) : '';
  // Link de UMA foto (v3.9.0, "?foto=" com o código curto da foto): o cartão
  // do WhatsApp mostra aquela foto, não a capa. Só foto desta lista (a do
  // visitante já vem sem as ocultas), nunca em álbum restrito.
  const fotoDoCartao = restrito ? undefined : fotoDaLista(todasFotos, fotoDoLink);
  const capaDoCartao = restrito ? '' : fotoDoCartao ? urlLh3(fotoDoCartao[0], 1600) : capitulo ? capaDaFoto || event.thumbnailUrl || '' : event.thumbnailUrl || capaDaFoto;
  const ogImage = ogImageFor(capaDoCartao);
  const nomeDoCartao = capitulo ? `${capitulo.nome} · ${titulo}` : tituloPagina;
  const tituloDoCartao = restrito ? `Fotos de ${titulo}` : fotoDoCartao ? `Uma foto de ${capitulo ? capitulo.nome : titulo}` : nomeDoCartao;
  const jsonLd = todasFotos.length ? {
    '@context': 'https://schema.org',
    '@type': 'ImageGallery',
    '@id': `${urlPagina}#galeria`,
    name: tituloPagina,
    url: urlPagina,
    inLanguage: 'pt-BR',
    description: descricao,
    author: PERSON_LD,
    isPartOf: { '@type': 'PhotoGallery', name: titulo, url: `${SITE_URL}/${slug}` },
    ...(ogImage.url ? { image: ogImage.url } : {}),
    ...(event.date ? { datePublished: event.date } : {}),
    numberOfItems: total,
    associatedMedia: todasFotos.slice(0, LD_FOTOS).map((f, i) => {
      const nomeAutor = autores[f[5] || 0] || AUTOR_PADRAO;
      if (ehVideo(f)) {
        // Vídeo (item 1f): a miniatura é a do Drive; o player só abre com um
        // toque, então `embedUrl` é a página do player, não um arquivo.
        return {
          '@type': 'VideoObject',
          name: altItem(f, i),
          thumbnailUrl: urlLh3(f[0], 800),
          embedUrl: `https://drive.google.com/file/d/${f[0]}/preview`,
          ...(event.date ? { uploadDate: event.date } : {}),
          ...(f[7] ? { duration: duracaoIso(/** @type {number} */ (f[7])) } : {}),
          creator: nomeAutor === AUTOR_PADRAO ? PERSON_LD : { '@type': 'Person', name: nomeAutor },
          creditText: nomeAutor,
        };
      }
      return {
        '@type': 'ImageObject',
        contentUrl: urlLh3(f[0], Math.min(f[1] || 1600, 1600)),
        name: altFoto(i),
        // O Luca segue ligado ao Person (@id) do resto do site; os demais
        // autores são uma Person só com o nome (não há página deles aqui).
        creator: nomeAutor === AUTOR_PADRAO ? PERSON_LD : { '@type': 'Person', name: nomeAutor },
        creditText: nomeAutor,
      };
    }),
  } : null;

  // Pré-carga da miniatura do LCP no celular (até 430 px): lá a primeira foto,
  // se for deitada, ocupa a linha inteira — largura conhecida antes do script
  // (a da tela menos o --pad), então o navegador escolhe no srcset o MESMO
  // degrau que a <img> vai pedir. Só WebP (type): quem não decodifica ignora a
  // dica e segue o caminho de sempre. Foto em pé divide a linha: sem dica.
  const lcp = todasFotos[0];
  const preloadLcp = lcp && !ehVideo(lcp) && lcp[1] > 0 && lcp[2] > 0 && lcp[1] / lcp[2] >= 1.36
    ? `<link rel="preload" as="image" type="image/webp" fetchpriority="high" media="(max-width: 430px)" imagesrcset="${escape(GALERIA_LARGURAS_GRADE.map(x => `${urlFoto(lcp[0], x, assina)} ${x}w`).join(', '))}" imagesizes="calc(100vw - 2 * max(12px, 3vw))">`
    : '';

  const conserto = erro ? (CONSERTOS[erro.codigo] || CONSERTOS.falha) : null;
  const avisos = [];
  if (listagem && listagem.truncada) {
    avisos.push('Lista parcial: pastas muito grandes ou subpastas além de dois níveis ficam de fora — o Drive continua com tudo.');
    // Só o dono vê a sugestão: pasta com muitos eventos cabe melhor em capítulos.
    if (dono && !capitulo && !event.galeriaCapitulos) {
      avisos.push('Dica: ligue "Galeria por capítulos" no projeto (painel → Mais opções). Cada subpasta vira uma página própria e a lista deixa de ser cortada.');
    }
  }

  // Atalho cujo destino o Drive não abre (v3.6): só o dono vê, com o conserto.
  if (dono && listagem && listagem.sa) {
    avisos.push(`${listagem.sa === 1 ? 'Um atalho' : `${listagem.sa} atalhos`} desta pasta ${listagem.sa === 1 ? 'aponta' : 'apontam'} para uma pasta que o site não consegue abrir. No Drive, compartilhe a pasta de destino como "Qualquer pessoa com o link: Leitor".`);
  }
  // Só o dono vê o motivo de "para redes" estar desligado ou parcial.
  if (dono && avisoRedes) avisos.push(avisoRedes.mensagem);
  // Cada foto: [id, largura, altura, nome, bytes] e, se tem versão na pasta do
  // Instagram, mais [bytes] ou [bytes, nome] (o nome só quando difere do original).
  let comRedes = 0;
  // Nomes amigáveis: calculados na listagem BRUTA (a do servidor, com as
  // ocultas) — o visitante recebe a lista sem elas, mas a numeração e as
  // colisões têm de ser as do download. Por isso `listagemBruta`.
  const nomes = event.nomesAmigaveis && listagem && listagemBruta
    ? nomesDaListagem(listagemBruta, { titulo, capitulo: capituloNome || '' })
    : null;
  // Forma na página: [id, l, a, nome, bytes, redes, nomeRedes, autor] —
  // `redes` = bytes da versão "para redes" ou -1 quando não há; `nomeRedes` só
  // quando difere do original; `autor` = índice em `autores`. Os finais
  // padrão (nome igual, autor 0) não vão: a lista de 6000 fotos continua curta.
  // Com "nomes amigáveis" ligado, mais um: a cauda do nome do arquivo (ver
  // nomes.js), que a página junta ao prefixo da seção e à extensão.
  // Item 1f: um vídeo (número = duração em segundos) ou um Live Photo (lista
  // [id, nome, bytes] do vídeo dele) leva o `extra` no fim, o que obriga os
  // campos do meio — só então.
  const fotoDaPagina = (/** @type {import('../drive.js').FotoDrive} */ f) => {
    const r = redes.get(f[0]);
    const autor = f[5] || 0;
    const extra = f[7];
    const temExtra = extra != null;
    // Item j (#250): minutos desde cr0 em que a foto chegou à pasta (só as recentes).
    const criada = f[8] || 0;
    if (r) comRedes++;
    const cauda = nomes ? nomes.cauda[f[0]] || '' : '';
    if (!r && !autor && !cauda && !temExtra && !criada) return f.slice(0, 5);
    const nomeRedes = r && r[3] !== f[3] ? r[3] : '';
    /** @type {any[]} */
    const out = [...f.slice(0, 5), r ? r[4] : -1];
    if (nomeRedes || autor || cauda || temExtra || criada) out.push(nomeRedes);
    if (autor || cauda || temExtra || criada) out.push(autor);
    if (cauda || temExtra || criada) out.push(cauda);
    if (temExtra || criada) out.push(temExtra ? extra : null);
    if (criada) out.push(criada);
    return out;
  };

  const dados = listagem ? {
    slug,
    cap: capitulo ? capitulo.slug : '',
    capNome: capitulo ? capitulo.nome : '',
    // Só o dono: a capa escolhida deste evento (o botão "Usar como capa").
    capa: dono && capitulo && event.capasEventos && typeof event.capasEventos[capitulo.slug] === 'string' ? event.capasEventos[capitulo.slug] : '',
    titulo,
    // `as` (v3.8.8): a assinatura do endereço de cada foto (/f/, foto-rota.js),
    // todas juntas e na ordem de `fotos`, ASSINATURA_CURTA_LEN caracteres cada
    // (6 mil fotos = 48 KB; num campo por foto seriam 66 KB). Foto sem
    // assinatura leva espaços; sem o segredo no Worker, '' (nenhuma).
    secoes: listagem.secoes.map(s => ({ ...nomeDaSecao(s), fotos: s.fotos.map(fotoDaPagina), as: assinaturasDaSecao(s.fotos, assina) })),
    autores,
    // Prefixo do nome do arquivo de cada seção (na ordem de `secoes`).
    amigavel: nomes && listagemBruta ? listagem.secoes.map(sec => nomes.pre[listagemBruta.secoes.findIndex(b => b.caminho === sec.caminho)] || '') : null,
    // Fotos novas (#250): a origem dos minutos de f[10] e a duração da sessão.
    cr0: EPOCA_CRIADA_MS,
    sessao: NOVAS_SESSAO_MIN,
    larguras: GALERIA_LARGURAS,
    grade: GALERIA_LARGURAS_GRADE,
    tentativasMini: GALERIA_MINIATURA_TENTATIVAS,
    // Só o dono recebe a lista do que está oculto (o visitante já recebe a
    // listagem sem essas fotos) e o botão de ocultar no visualizador.
    dono: !!dono,
    ocultas: dono ? ocultas : [],
    pendentes: dono ? pendentes : [],
    // "Pedir remoção desta foto": só para o visitante (o dono tem o "Ocultar").
    // A chave do Turnstile é pública; o script dele só carrega quando o
    // formulário abre.
    remocao: dono ? null : { token: formToken, ts: TURNSTILE_SITE_KEY },
    lightbox: vendorPath('vendor/photoswipe/photoswipe-lightbox.esm.min.js'),
    // O CSS do visualizador entra junto com ele (preparaLightbox), não no
    // <head>: lá ele bloqueava a primeira pintura da grade.
    css: vendorPath('vendor/photoswipe/photoswipe.css'),
    core: vendorPath('vendor/photoswipe/photoswipe.esm.min.js'),
  } : null;

  return `<!DOCTYPE html>
<html lang="pt-BR">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0, viewport-fit=cover">
  <meta name="robots" content="${indexavel ? 'index,follow,max-image-preview:large' : 'noindex,nofollow'}">
  <meta name="theme-color" content="${marca ? P.bg : '#0a0a0a'}">${marca ? '\n  <meta name="color-scheme" content="dark">' : ''}
  <link rel="icon" type="image/svg+xml" href="${marca ? marca.icone : '/icon.svg'}">
  <link rel="apple-touch-icon" href="${marca ? marca.apple : '/apple-touch-icon.png'}">
  ${marca ? '' : '<link rel="manifest" href="/manifest.json">'}
  ${erro && erro.codigo === 'carregando' ? '<meta http-equiv="refresh" content="4">' : ''}
  <title>${escape(tituloPagina)}</title>
  <link rel="canonical" href="${escape(urlPagina)}">
  ${socialMetaHTML({
    title: tituloDoCartao,
    description: descricao,
    url: fotoDoCartao ? `${urlPagina}?foto=${encodeURIComponent(fotoDoLink)}` : urlPagina,
    image: ogImage.url,
    imageAlt: tituloDoCartao,
    imageWidth: ogImage.width,
    imageHeight: ogImage.height,
    ...(marca ? { siteName: marca.siteName } : {}),
  })}
  ${jsonLd ? `<script type="application/ld+json" nonce="${nonce}">${jsonParaScript(jsonLd)}</script>` : ''}
  ${fontPreloadHTML()}
  ${photoPreconnectHTML()}
  ${preloadLcp}
  <style>
    ${fontFaceCSS()}
    *,*::before,*::after{box-sizing:border-box;margin:0;padding:0}
    :root{
      --bg-page:#0a0a0a; --text:#f0ebe5; --text-2:#bbb; --text-muted:#999; --text-dim:#666;
      --bg-card:#141414; --bg-card-2:#1c1c1c; --esqueleto:#1d1d1d; --border:#262626; --accent:#c0a060; --accent-text:#0a0a0a;
      --warn-bg:#1d1606; --warn-border:#4a3a12; --warn-text:#d8b25a;
      --err-bg:#1a0a0a; --err-border:#2e1a1a; --err-text:#e0a0a0;
      --pad:clamp(12px,3vw,32px); --gap:5px; --topo:120px;
    --sai:cubic-bezier(.23,1,.32,1);
    }
    @media (prefers-color-scheme: light){
      :root{
        --bg-page:#f0ece8; --text:#1a1715; --text-2:#4a4744; --text-muted:#665f5b; --text-dim:#8a8480;
        --bg-card:#e5e1db; --bg-card-2:#fff; --esqueleto:#dcd7d0; --border:#ddd9d4; --accent:#7d5a22; --accent-text:#faf7f3;
        --warn-bg:#fdf3dc; --warn-border:#e8d1a0; --warn-text:#7a5a17;
        --err-bg:#fdecec; --err-border:#f2c6c6; --err-text:#8c1d18;
      }
    }
    ${marca ? TEMA_ALBUM : ''}
    @media (max-width:520px){ :root{ --gap:3px } }
    body{font-family:'Inter',sans-serif;background:var(--bg-page);color:var(--text);min-height:100vh;-webkit-text-size-adjust:100%}
    :focus-visible{outline:2px solid var(--accent);outline-offset:2px}
    a{color:inherit}
    .g-dono{display:flex;flex-wrap:wrap;align-items:center;gap:.4rem 1rem;padding:.5rem var(--pad);font-size:.78rem;color:var(--text-muted);background:var(--bg-card);border-bottom:1px solid var(--border)}
    .g-dono a{color:var(--text-2);text-decoration:underline;text-underline-offset:2px;padding:.55rem 0}
    .g-dono a:hover{color:var(--text)}
    .g-dono b{font-weight:600;color:var(--accent);letter-spacing:.06em;text-transform:uppercase;font-size:.7rem;border:1px solid var(--accent);border-radius:4px;padding:.1rem .4rem}
    .g-dono .g-lista{margin-left:auto}
    .g-dono .g-ano{display:inline-flex;align-items:center;gap:.4rem}
    .g-dono select{min-height:36px;padding:0 .4rem;border-radius:6px;border:1px solid var(--border);background:var(--bg-page);color:var(--text);font:inherit}
    .g-top{position:sticky;top:0;z-index:5;background:color-mix(in srgb,var(--bg-page) 90%,transparent);backdrop-filter:blur(10px);-webkit-backdrop-filter:blur(10px);border-bottom:1px solid var(--border)}
    .g-top-l{display:flex;flex-wrap:wrap;align-items:center;gap:.6rem 1.25rem;padding:.8rem var(--pad)}
    .g-tit{flex:1 1 14rem;min-width:0}
    .g-tit h1{font-size:clamp(1.05rem,2.4vw,1.5rem);font-weight:600;letter-spacing:-.01em;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
    .g-cap-nav{display:flex;flex-wrap:wrap;gap:.1rem .9rem;padding:.3rem var(--pad);font-size:.82rem;border-bottom:1px solid var(--border)}
    .g-evs{position:relative;display:flex;align-items:center;gap:.5rem;padding:.5rem var(--pad);border-bottom:1px solid var(--border)}
    .g-ev-seta{flex:none;display:inline-flex;align-items:center;justify-content:center;width:44px;height:44px;border-radius:50%;border:1px solid var(--border);color:var(--text);font-size:1.5rem;line-height:1;text-decoration:none}
    span.g-ev-seta{border-color:transparent}
    .g-ev-menu{flex:1;min-width:0}
    .g-ev-menu>summary{list-style:none;display:flex;align-items:center;justify-content:center;gap:.6rem;min-height:44px;padding:0 1rem;border-radius:999px;border:1px solid var(--border);cursor:pointer;color:var(--text)}
    .g-ev-menu>summary::-webkit-details-marker{display:none}
    .g-ev-menu>summary::after{content:"";flex:none;width:.45rem;height:.45rem;border-right:2px solid currentColor;border-bottom:2px solid currentColor;transform:translateY(-2px) rotate(45deg)}
    .g-ev-menu[open]>summary::after{transform:translateY(2px) rotate(-135deg)}
    .g-ev-nome{font-weight:600;font-size:.92rem;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;min-width:0}
    .g-ev-n{flex:none;font-size:.78rem;color:var(--text-muted)}
    .g-ev-lista{position:absolute;left:var(--pad);right:var(--pad);top:calc(100% - .2rem);z-index:30;max-width:32rem;margin:0 auto;max-height:min(30rem,calc(100vh - 5.5rem));max-height:min(30rem,calc(100svh - 5.5rem));overflow-y:auto;padding:.4rem;border-radius:16px;border:1px solid var(--border);background:var(--bg-card);box-shadow:0 18px 40px rgba(0,0,0,.35);display:flex;flex-direction:column}
    .g-ev{display:flex;align-items:center;min-height:44px;padding:0 .9rem;border-radius:10px;color:var(--text-2);font-size:.92rem;text-decoration:none}
    .g-ev[aria-current="page"]{background:var(--accent);color:var(--accent-text);font-weight:600}
    .g-ev-todos{color:var(--text);font-weight:600;border-bottom:1px solid var(--border);border-radius:10px 10px 0 0;margin-bottom:.2rem}
    .g-ev-ano{display:block;padding:.7rem .9rem .25rem;font-size:.72rem;font-weight:600;letter-spacing:.14em;color:var(--text-muted)}
    @media (hover:hover){.g-ev:not([aria-current]):hover{background:var(--border);color:var(--text)}.g-ev-seta:hover,.g-ev-menu>summary:hover{border-color:var(--text-muted)}}
    .g-cap-nav.g-cap-fim{border-bottom:0;border-top:1px solid var(--border);margin-top:1.5rem;padding:.6rem var(--pad) 1.5rem}
    .g-cap-a{display:inline-flex;align-items:center;gap:.3rem;min-height:44px;max-width:100%;color:var(--text-2);text-decoration:none}
    .g-cap-a:hover{color:var(--text);text-decoration:underline}
    .g-cap-t{overflow:hidden;text-overflow:ellipsis;white-space:nowrap;max-width:min(60vw,22rem)}
    .g-cap-p{margin-left:auto}
    .g-meta{font-size:.8rem;color:var(--text-muted);margin-top:.15rem}
    .g-autores{font-size:1.05rem;font-weight:700;color:var(--text);margin-top:.5rem;line-height:1.35}
    .g-top .g-prim{background:var(--accent);border-color:var(--accent);color:var(--accent-text);font-weight:600}
    .g-autores-k{display:inline-block;margin-right:.35rem;font-size:.75rem;font-weight:700;letter-spacing:.14em;text-transform:uppercase;color:var(--accent)}
    .g-acoes{display:flex;flex-wrap:wrap;gap:.5rem}
    .g-btn{display:inline-flex;align-items:center;justify-content:center;gap:.4rem;font:inherit;font-size:.85rem;font-weight:500;min-height:44px;padding:.5rem 1rem;border-radius:999px;border:1px solid var(--border);background:var(--bg-card-2);color:var(--text);text-decoration:none;cursor:pointer;white-space:nowrap;transition:transform .12s cubic-bezier(.23,1,.32,1),border-color .12s}
    .g-btn:active{transform:scale(.97)}
    .g-btn[aria-pressed="true"]{background:var(--accent);border-color:var(--accent);color:var(--accent-text)}
    .g-chips{display:flex;gap:.5rem;overflow-x:auto;scrollbar-width:none;-webkit-overflow-scrolling:touch;padding:0 var(--pad) .7rem}
    .g-chips::-webkit-scrollbar{display:none}
    .g-chips-grupo{flex:none;display:inline-flex;gap:.5rem;padding-left:.5rem;border-left:1px solid var(--border)}
    .g-chips-grupo:first-child{padding-left:0;border-left:0}
    .g-chips[hidden]{display:none}
    .g-chip{flex:none;display:inline-flex;align-items:center;gap:.45rem;font:inherit;font-size:.85rem;font-weight:500;min-height:44px;padding:.4rem .95rem;border-radius:999px;border:1px solid var(--border);background:var(--bg-card-2);color:var(--text-2);cursor:pointer;white-space:nowrap;transition:transform .12s cubic-bezier(.23,1,.32,1),background-color .15s,color .15s}
    .g-chip:active{transform:scale(.97)}
    .g-chip small{font-size:.75rem;color:var(--text-muted);font-variant-numeric:tabular-nums}
    .g-chip[aria-current="true"],.g-chip[aria-pressed="true"]{background:var(--text);border-color:var(--text);color:var(--bg-page)}
    .g-chip[aria-current="true"] small,.g-chip[aria-pressed="true"] small{color:inherit;opacity:.75}
    @media (hover:hover){ .g-btn:hover,.g-chip:hover{border-color:var(--text-dim)} }
    .g-previa{margin:.9rem var(--pad) 0;font-size:.78rem;color:var(--text-muted);display:flex;gap:.5rem;align-items:center}
    .g-previa b{font-weight:600;color:var(--accent);letter-spacing:.06em;text-transform:uppercase;font-size:.7rem;border:1px solid var(--accent);border-radius:4px;padding:.1rem .4rem}
    .g-aviso{margin:.75rem var(--pad) 0;padding:.7rem .9rem;border-radius:8px;font-size:.82rem;line-height:1.5;background:var(--warn-bg);border:1px solid var(--warn-border);color:var(--warn-text)}
    .g-erro{max-width:40rem;margin:3rem auto;padding:1.5rem 1.6rem;border-radius:12px;background:var(--err-bg);border:1px solid var(--err-border);color:var(--err-text);line-height:1.6}
    .g-erro h2{font-size:1.1rem;margin-bottom:.4rem;color:var(--text)}
    .g-erro p{font-size:.88rem;margin-bottom:.8rem}
    .g-erro ol{padding-left:1.2rem;font-size:.88rem;color:var(--text-2)}
    .g-erro li{margin-bottom:.45rem}
    .g-erro code{font-size:.8rem;background:var(--bg-card);padding:.1rem .35rem;border-radius:4px;color:var(--text)}
    .g-erro a{color:var(--text)}
    main{padding:1.25rem 0 6rem}
    .g-sec{margin-bottom:2rem;content-visibility:auto;contain-intrinsic-size:auto 900px}
    .g-sec{scroll-margin-top:calc(var(--topo) + 8px)}
    .g-sec[hidden]{display:none}
    .g-sec-cab{display:flex;align-items:center;justify-content:space-between;gap:1rem;padding:0 var(--pad);margin-bottom:.7rem}
    .g-sec-cab.sem-titulo{display:none}
    .g-modo-sel .g-sec-cab.sem-titulo{display:flex;justify-content:flex-end}
    .g-sec h2{font-size:.72rem;letter-spacing:.16em;text-transform:uppercase;color:var(--text-muted);font-weight:600}
    .g-sec-todas{display:none;font:inherit;font-size:.8rem;font-weight:500;min-height:44px;padding:.4rem .9rem;border-radius:999px;border:1px solid var(--border);background:var(--bg-card-2);color:var(--text);cursor:pointer}
    .g-modo-sel .g-sec-todas{display:inline-flex;align-items:center}
    .g-grade{padding:0 var(--pad)}
    .g-linha{display:flex;gap:var(--gap);margin-bottom:var(--gap)}
    /* v3.9.4: linha fora da tela não passa por layout nem pintura (a altura já
       vem fixa no style). A contenção corta o que vaza da linha: o foco da
       miniatura fica por dentro. */
    .g-linha{content-visibility:auto;contain-intrinsic-size:auto 300px}
    .g-t:focus-visible{outline-offset:-3px}
    .g-t{position:relative;flex:none;height:100%;display:block;background:var(--esqueleto);overflow:hidden;border-radius:2px;-webkit-tap-highlight-color:transparent;-webkit-user-select:none;user-select:none}
    .g-t img{width:100%;height:100%;display:block;object-fit:cover;opacity:0;transition:opacity .2s ease-out}
    .g-t img.ok{opacity:1}
    /* A primeira linha (a do LCP) aparece sem esperar o fade do "load": com
       opacidade 0 o navegador nem conta a foto como pintada. */
    .g-t img[fetchpriority="high"]{opacity:1;transition:none}
    @media (hover:hover){ .g-t:hover img.ok{filter:brightness(1.06)} }
    .g-t .g-ck{position:absolute;top:6px;right:6px;width:24px;height:24px;border-radius:50%;border:2px solid #fff;background:rgba(0,0,0,.25);display:none;box-shadow:0 1px 4px rgba(0,0,0,.4)}
    .g-modo-sel .g-t .g-ck{display:block}
    .g-fav{position:absolute;left:0;bottom:0;width:44px;height:44px;display:grid;place-items:center;color:#fff;opacity:0;pointer-events:none;transition:opacity .15s ease-out,transform .12s cubic-bezier(.23,1,.32,1)}
    /* O coração é um fundo em CSS, não um <svg> por miniatura: com centenas de
       fotos, eram dois elementos e um innerHTML a mais por foto na carga. */
    .g-fav::before{content:"";width:22px;height:22px;background:url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24'%3E%3Cpath d='M12 20.5 10.9 19.5C6.2 15.3 3.5 12.8 3.5 9.7 3.5 7.3 5.4 5.5 7.7 5.5c1.6 0 3.2.8 4.3 2.1 1.1-1.3 2.7-2.1 4.3-2.1 2.3 0 4.2 1.8 4.2 4.2 0 3.1-2.7 5.6-7.4 9.8z' fill='none' stroke='%23fff' stroke-width='2'/%3E%3C/svg%3E") center/contain no-repeat;filter:drop-shadow(0 1px 3px rgba(0,0,0,.65))}
    .g-t.fav .g-fav{opacity:1}
    .g-t.fav .g-fav::before{background-image:url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24'%3E%3Cpath d='M12 20.5 10.9 19.5C6.2 15.3 3.5 12.8 3.5 9.7 3.5 7.3 5.4 5.5 7.7 5.5c1.6 0 3.2.8 4.3 2.1 1.1-1.3 2.7-2.1 4.3-2.1 2.3 0 4.2 1.8 4.2 4.2 0 3.1-2.7 5.6-7.4 9.8z' fill='%23ff6b86' stroke='%23ff6b86' stroke-width='2'/%3E%3C/svg%3E")}
    .g-modo-sel .g-fav{display:none}
    @media (hover:hover){
      .g-t:hover .g-fav,.g-t:focus-visible .g-fav{opacity:1;pointer-events:auto}
      .g-fav:active{transform:scale(.9)}
    }
    .g-t.sel .g-ck{display:block;background:var(--accent);border-color:var(--accent)}
    .g-t.sel .g-ck::after{content:"";position:absolute;left:7px;top:3px;width:6px;height:11px;border:solid var(--accent-text);border-width:0 2px 2px 0;transform:rotate(45deg)}
    .g-t.sel img{opacity:.78}
    .g-t.oculta img.ok{opacity:.3}
    /* Item 1f: vídeo (play + duração) e Live Photo (LIVE) no canto de baixo à
       direita; miniatura que não carregou (HEIC/RAW sem prévia, vídeo ainda
       processando) vira um bloco com a extensão. */
    .g-t .g-nova{position:absolute;left:6px;top:6px;padding:.1rem .4rem;border-radius:4px;background:var(--accent);color:var(--accent-text);font-size:.62rem;font-weight:700;letter-spacing:.06em;text-transform:uppercase;pointer-events:none}
    .g-t.oculta .g-nova,.g-t.pendente .g-nova{display:none}
    .g-t .g-play,.g-t .g-live{position:absolute;right:6px;bottom:6px;display:inline-flex;align-items:center;gap:.3rem;padding:.18rem .5rem;border-radius:999px;background:rgba(0,0,0,.65);color:#fff;font-size:.72rem;font-weight:600;font-variant-numeric:tabular-nums;pointer-events:none}
    .g-t .g-live{font-size:.62rem;font-weight:700;letter-spacing:.12em}
    .g-t .g-play::before{content:"";border-left:7px solid #fff;border-top:5px solid transparent;border-bottom:5px solid transparent}
    .g-t.sem-mini{background:var(--bg-card-2)}
    .g-t.sem-mini img{display:none}
    .g-t.sem-mini::after{content:attr(data-ext);position:absolute;inset:0;display:grid;place-items:center;color:var(--text-muted);font-size:.8rem;font-weight:600;letter-spacing:.12em}
    .g-t .g-oc{position:absolute;left:6px;top:6px;padding:.15rem .45rem;border-radius:4px;background:rgba(0,0,0,.7);color:#fff;font-size:.68rem;font-weight:600;letter-spacing:.04em;text-transform:uppercase;display:none}
    .g-t.oculta .g-oc{display:block}
    .g-barra{position:fixed;left:50%;bottom:calc(16px + env(safe-area-inset-bottom));transform:translateX(-50%);z-index:6;display:flex;align-items:center;gap:.5rem;padding:.5rem .55rem .5rem 1rem;border-radius:999px;background:var(--bg-card-2);border:1px solid var(--border);box-shadow:0 8px 30px rgba(0,0,0,.35);font-size:.85rem;max-width:calc(100vw - 24px)}
    .g-barra[hidden]{display:none}
    .g-topo{position:fixed;right:max(16px,env(safe-area-inset-right));bottom:calc(16px + env(safe-area-inset-bottom));z-index:6;width:44px;height:44px;display:grid;place-items:center;border-radius:50%;border:1px solid var(--border);background:var(--bg-card-2);color:var(--text);cursor:pointer;box-shadow:0 6px 20px rgba(0,0,0,.3);opacity:0;visibility:hidden;transform:translateY(8px);pointer-events:none;transition:opacity .15s ease-out,transform .15s var(--sai),visibility 0s .15s}
    .g-topo.on{opacity:1;visibility:visible;transform:none;pointer-events:auto;transition-delay:0s}
    .g-topo:active{transform:scale(.95)}
    .g-com-barra .g-topo{bottom:calc(84px + env(safe-area-inset-bottom))}
    .g-vendo .g-topo{display:none}
    .g-barra .g-btn{padding:.45rem .8rem}
    .g-bug{padding:.5rem;min-width:44px}
    /* Celular: o Compartilhar vira só ícone (o aria-label diz o que é), para os
       quatro botões caberem numa linha só e as fotos subirem na tela. */
    @media (max-width:519px){
      .g-btn[data-acao="compartilhar"]{padding:.5rem;min-width:44px}
      .g-btn[data-acao="compartilhar"] span{position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0 0 0 0);white-space:nowrap}
    }
    .g-voltar{display:inline-flex;align-items:center;gap:.25rem;min-height:44px;font-size:.85rem;color:var(--text-muted);text-decoration:none;margin-bottom:.15rem}
    @media (hover:hover){ .g-voltar:hover{color:var(--text)} }
    .g-barra .g-prim{background:var(--accent);border-color:var(--accent);color:var(--accent-text)}
    #g-barra-n{white-space:nowrap;margin-right:.25rem}
    /* Folha de download: por cima do visualizador (o PhotoSwipe usa z-index 100000). */
    .g-folha{position:fixed;inset:0;z-index:100010;display:flex;align-items:flex-end;justify-content:center;background:rgba(0,0,0,.55);opacity:1;transition:opacity .2s var(--sai),display .2s allow-discrete,overlay .2s allow-discrete}
    .g-folha[hidden]{display:none;opacity:0;transition-duration:.14s}
    @starting-style{ .g-folha{opacity:0} }
    .g-folha-c{transition:transform .2s var(--sai),opacity .2s var(--sai);width:min(30rem,100%);background:var(--bg-card-2);color:var(--text);border-radius:16px 16px 0 0;padding:1.1rem 1.1rem calc(1.1rem + env(safe-area-inset-bottom));box-shadow:0 -10px 40px rgba(0,0,0,.4)}
    .g-folha[hidden] .g-folha-c{transform:translateY(16px);opacity:0;transition-duration:.14s}
    @starting-style{ .g-folha-c{transform:translateY(16px);opacity:0} }
    @media (min-width:700px){ .g-folha{align-items:center} .g-folha-c{border-radius:16px} .g-folha[hidden] .g-folha-c{transform:scale(.96)} @starting-style{ .g-folha-c{transform:scale(.96);opacity:0} } }
    .g-folha-t{font-weight:600;font-size:.95rem;margin-bottom:.8rem;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
    .g-op{display:flex;flex-direction:column;align-items:flex-start;gap:.15rem;width:100%;text-align:left;font:inherit;padding:.8rem .9rem;margin-bottom:.5rem;border-radius:10px;border:1px solid var(--border);background:var(--bg-page);color:var(--text);cursor:pointer}
    .g-op{text-decoration:none;min-height:44px;transition:transform .12s cubic-bezier(.23,1,.32,1),border-color .12s}
    .g-op:active{transform:scale(.985)}
    @media (hover:hover){ .g-op:hover{border-color:var(--text-dim)} }
    .g-op strong{font-size:.9rem;font-weight:600}
    .g-op span{font-size:.76rem;color:var(--text-muted)}
    .g-op.g-pronto{background:var(--accent);border-color:var(--accent);color:var(--accent-text)}
    .g-op.g-pronto span{color:var(--accent-text);opacity:.8}
    .g-op[disabled]{opacity:.6;cursor:progress}
    /* iPhone/iPad: cada versão tem dois botões (Salvar no Fotos / Baixar arquivo). */
    .g-ver{margin-bottom:.6rem;padding:.8rem .9rem;border-radius:10px;border:1px solid var(--border);background:var(--bg-page)}
    .g-ver-t{display:flex;flex-direction:column;gap:.15rem;margin-bottom:.65rem}
    .g-ver-t strong{font-size:.9rem;font-weight:600}
    .g-ver-t span{font-size:.76rem;color:var(--text-muted);overflow-wrap:anywhere}
    .g-ver-a{display:flex;flex-wrap:wrap;gap:.5rem}
    .g-ver-a .g-btn{flex:1 1 9rem}
    .g-ver-a .g-prim{background:var(--accent);border-color:var(--accent);color:var(--accent-text)}
    .g-ver-a .g-btn[disabled]{opacity:.6;cursor:progress}
    .g-folha-msg{font-size:.8rem;color:var(--text-muted);min-height:1.2em;margin:.2rem 0 .6rem}
    .g-folha-rod{display:flex;justify-content:space-between;align-items:center;gap:.5rem}
    .g-folha-rod a{font-size:.78rem;color:var(--text-muted)}
    .g-aviso-flut{position:fixed;left:50%;bottom:calc(84px + env(safe-area-inset-bottom));transform:translateX(-50%);z-index:100020;background:#111;color:#f0ebe5;font-size:.82rem;padding:.55rem .9rem;border-radius:999px;box-shadow:0 6px 24px rgba(0,0,0,.35);pointer-events:none;opacity:0;transform:translateX(-50%) translateY(8px);transition:opacity .2s var(--sai),transform .2s var(--sai)}
    .g-aviso-flut.on{opacity:1;transform:translateX(-50%)}
    /* Visualizador: legenda e o botão de seleção ligado. */
    .pswp{--pswp-bg:#000}
    .pswp__g-legenda{position:absolute;left:0;right:0;bottom:0;padding:1.6rem 1rem calc(.9rem + env(safe-area-inset-bottom));text-align:center;font:500 13px/1.4 'Inter',sans-serif;color:#e8e3dd;background:linear-gradient(transparent,rgba(0,0,0,.55));pointer-events:none;transition:opacity .25s}
    .pswp:not(.pswp--ui-visible) .pswp__g-legenda{opacity:0}
    .g-vid{position:relative;background:#000;overflow:hidden}
    .g-vid img{width:100%;height:100%;object-fit:contain;display:block}
    .g-vid iframe{position:absolute;inset:0;width:100%;height:100%;border:0;background:#000}
    .g-vid-play{position:absolute;inset:0;margin:auto;width:76px;height:76px;border-radius:50%;border:2px solid #fff;background:rgba(0,0,0,.55);color:#fff;cursor:pointer;display:grid;place-items:center;padding:0}
    .g-vid-play::before{content:"";margin-left:6px;border-left:24px solid #fff;border-top:15px solid transparent;border-bottom:15px solid transparent}
    .g-vid-dur{position:absolute;left:10px;bottom:10px;padding:.18rem .55rem;border-radius:999px;background:rgba(0,0,0,.65);color:#fff;font:600 12px/1.4 'Inter',sans-serif;font-variant-numeric:tabular-nums}
    .g-vid.sem-mini{background:#161616}
    .g-eh-video .pswp__button--zoom{display:none}
    .pswp__button--g-sel.on .pswp__icn{fill:#c0a060}
    .pswp__button--g-fav.on .pswp__icn{fill:#ff6b86}
    .pswp__button--g-ocultar.on .pswp__icn{fill:#ff8a65}
    .pswp__button--g-capa.on .pswp__icn{fill:#f9de4b}
    .pswp__counter{white-space:nowrap}
    .g-t.pendente .g-oc{background:#92400e}
    .g-t.pendente img.ok{opacity:.45}
    /* "Pedir remoção": texto discreto sob a legenda do visualizador, nunca um ícone
       da barra. O fundo escuro garante o contraste mesmo sobre foto clara: no pior
       caso (foto branca) o fundo vira #474747 e #c8c3bd tem ~5,3:1 (AA pede 4,5). A
       área de toque tem 44 px de altura pelo min-height, com o texto de 12 px. */
    .pswp__g-legenda .g-leg-t{display:block}
    .pswp__g-legenda .g-leg-a{display:block;margin-top:.15rem;font-size:12px;color:#c9c3bb}
    .pswp__g-legenda .g-leg-autor{display:block;margin-bottom:.2rem;font:700 15px/1.3 'Inter',sans-serif;color:#fff;text-shadow:0 1px 3px rgba(0,0,0,.8)}
    /* v3.8.0: discreto (sem fundo, letra menor), mas com a área de toque de 44 px. */
    .g-rem-link{pointer-events:auto;display:inline-flex;align-items:center;justify-content:center;min-height:44px;min-width:44px;margin-top:.05rem;padding:0 .4rem;border:0;background:transparent;color:#bdb6ad;font:500 11px/1 'Inter',sans-serif;text-decoration:underline;text-underline-offset:3px;text-shadow:0 1px 2px rgba(0,0,0,.9);cursor:pointer;opacity:.85}
    .pswp__button--g-baixar-grande{position:absolute;right:max(12px,env(safe-area-inset-right));bottom:max(14px,env(safe-area-inset-bottom));width:auto!important;height:48px!important;display:inline-flex!important;align-items:center;gap:.45rem;padding:0 1.15rem!important;border-radius:999px;background:var(--accent)!important;color:var(--accent-text)!important;font:700 15px/1 'Inter',sans-serif;box-shadow:0 4px 18px rgba(0,0,0,.45);opacity:1!important}
    .pswp__button--g-baixar-grande .g-bg-ic svg{width:18px;height:18px;display:block}
    .g-rem-link:hover{color:#fff}
    .g-rem-link:focus-visible{outline:2px solid #c0a060;outline-offset:2px;color:#fff}
    /* O formulário é um <dialog> modal: vai para a camada de cima do navegador
       (por cima do visualizador, que usa z-index 100000), deixa o resto da página
       inerte e prende o foco sozinho. */
    .g-rem{border:0;padding:0;background:transparent;color:var(--text);width:min(30rem,100%);max-width:100%;max-height:100dvh;margin:auto auto 0}
    .g-rem::backdrop{background:rgba(0,0,0,.6)}
    .g-rem-c{background:var(--bg-card-2);border-radius:16px 16px 0 0;padding:1.1rem 1.1rem calc(1.1rem + env(safe-area-inset-bottom));max-height:92dvh;overflow:auto;box-shadow:0 -10px 40px rgba(0,0,0,.4)}
    @media (min-width:700px){ .g-rem{margin:auto} .g-rem-c{border-radius:16px} }
    .g-rem-foto{display:flex;align-items:center;gap:.8rem;margin-bottom:.8rem}
    .g-rem-foto img{width:72px;height:72px;object-fit:cover;border-radius:8px;background:var(--esqueleto);flex:none}
    .g-rem-foto span{font-size:.82rem;color:var(--text-muted);overflow-wrap:anywhere}
    .g-rem-aviso{font-size:.84rem;line-height:1.5;color:var(--text-2);margin-bottom:.9rem}
    .g-rem label{display:block;font-size:.8rem;font-weight:500;color:var(--text-2);margin:.7rem 0 .25rem}
    .g-rem select,.g-rem input[type=email],.g-rem textarea{width:100%;font:inherit;font-size:16px;color:var(--text);background:var(--bg-page);border:1px solid var(--border);border-radius:8px;padding:.6rem .7rem;min-height:44px}
    .g-rem textarea{min-height:5.5rem;resize:vertical}
    .g-rem [aria-invalid="true"]{border-color:var(--err-text)}
    .g-rem-ts{margin-top:.9rem;min-height:65px}
    .g-rem-erro{font-size:.82rem;color:var(--err-text);min-height:1.2em;margin-top:.6rem}
    .g-rem-priv{font-size:.74rem;line-height:1.5;color:var(--text-muted);margin-top:.6rem}
    .g-rem-priv a{color:var(--text-2)}
    .g-rem-acoes{display:flex;gap:.5rem;justify-content:flex-end;margin-top:.9rem}
    .g-rem-acoes .g-prim{background:var(--accent);border-color:var(--accent);color:var(--accent-text)}
    .g-rem-acoes .g-btn[disabled]{opacity:.6;cursor:not-allowed}
    .g-rem-ok p{font-size:.9rem;line-height:1.55;color:var(--text);margin-bottom:.6rem}
    .g-rem-ok p.sub{font-size:.8rem;color:var(--text-muted)}
    ${HONEYPOT_CSS}
    @media (prefers-reduced-motion: reduce){
      .g-t img,.g-fav,.g-btn,.g-chip,.g-op{transition:none}
      .g-topo,.g-folha-c,.g-aviso-flut{transition:opacity .1s linear;transform:none}
      .g-topo.on{transform:none}
      .g-aviso-flut{transform:translateX(-50%)}
      .g-folha,.g-folha[hidden]{transition:opacity .1s linear,display .1s allow-discrete,overlay .1s allow-discrete}
      .g-folha[hidden] .g-folha-c{transform:none}
      @starting-style{ .g-folha-c{transform:none} }
    }
  </style>
  ${navegacaoFluidaHTML(nonce)}
</head>
<body>
  ${dono ? `<div class="g-dono">
    <b>Painel</b>
    <span>Só você (logado) vê esta faixa.</span>
    <a href="/dashboard">← Painel</a>
    <a href="/${escape(slug)}">Página do projeto</a>
    ${drive ? `<a href="${escape(drive)}" target="_blank" rel="nofollow noopener">Abrir no Drive</a>` : ''}
    ${listagem ? `<a href="?atualizar=1" title="Relê a pasta no Drive agora (${escape(descreveRenovacao(event))})">Atualizar agora</a>` : ''}
    ${listagem ? `<span class="g-lista" title="${escape(descreveRenovacao(event))}">Atualizada em ${escape(quando)}</span>` : ''}
    ${listagem && event.driveUrlInstagram ? `<span id="g-n-redes">${comRedes} de ${total} com "para redes" (pasta do Instagram)</span>` : ''}
    ${listagem ? `<span id="g-n-ocultas">${ocultas.length ? `${ocultas.length} oculta${ocultas.length === 1 ? '' : 's'} para os visitantes` : 'Para ocultar uma foto dos visitantes: abra a foto e toque no olho'}</span>` : ''}
    ${dataDoEvento && capitulo ? seletorDoAno(slug, capitulo.slug, dataDoEvento) : ''}
  </div>${dataDoEvento && capitulo ? `<script nonce="${nonce}">${SCRIPT_ANO}</script>` : ''}` : ''}
  <header class="g-top" id="g-topo-cab">
    <div class="g-top-l">
      <div class="g-tit">
        ${capitulo
    ? `<a class="g-voltar" href="${escape(caminhoBase)}"><span aria-hidden="true">←</span> Todos os eventos</a>`
    : `<a class="g-voltar" href="/${escape(slug)}"><span aria-hidden="true">‹</span> Página do projeto</a>`}
        <h1 id="g-h1" tabindex="-1">${escape(capitulo ? `${titulo} · ${capitulo.nome}` : titulo)}</h1>
        ${meta ? `<p class="g-meta">${escape(meta)}</p>` : ''}
        ${nomesDosAutores.length && total ? `<p class="g-autores"><span class="g-autores-k">Fotos de</span> ${escape(listaComE(nomesDosAutores))}</p>` : ''}
      </div>
      <div class="g-acoes">
        ${listagem && total ? '<button type="button" class="g-btn" id="g-sel" aria-pressed="false">Selecionar</button>' : ''}
        ${listagem && total ? '<button type="button" class="g-btn g-prim" data-acao="baixar-tudo">Baixar tudo</button>' : ''}
        ${listagem && total ? '<button type="button" class="g-btn" data-acao="compartilhar" aria-label="Compartilhar a página do projeto"><svg xmlns="http://www.w3.org/2000/svg" width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 12v8a2 2 0 002 2h12a2 2 0 002-2v-8"/><polyline points="16 6 12 2 8 6"/><line x1="12" y1="2" x2="12" y2="15"/></svg><span>Compartilhar</span></button>' : ''}
${marca ? '' : `<a class="g-btn g-bug" href="/suporte" title="Algo deu errado? Fale com a gente" aria-label="Reportar um problema na galeria"><svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M8 2l1.9 1.9M16 2l-1.9 1.9M9 7.1V6a3 3 0 016 0v1.1"/><path d="M12 20c-3.3 0-6-2.7-6-6v-3a4 4 0 014-4h4a4 4 0 014 4v3c0 3.3-2.7 6-6 6zM12 20v-9M6.5 13H2M22 13h-4.5M6 7.6C4.1 7.4 3 5.9 3 4M18 7.6c1.9-.2 3-1.7 3-3.6M6 17.4C4.1 17.6 3 19.1 3 21M18 17.4c1.9.2 3 1.7 3 3.6"/></svg></a>`}
      </div>
    </div>
    ${dados ? '<nav class="g-chips" id="g-chips" aria-label="Seções, fotógrafos e favoritas" hidden></nav>' : ''}
  </header>
  ${capitulo && capitulo.eventos && capitulo.eventos.length > 1 ? faixaDeEventos(base, capitulo) : capitulo ? navCapitulos(base, capitulo, 'topo') : ''}
  ${avisos.map(a => `<p class="g-aviso">${escape(a)}</p>`).join('\n  ')}
  ${conserto && erro ? `<section class="g-erro" role="alert">
    <h2>${escape(conserto.titulo)}</h2>
    <p>${escape(erro.mensagem)}</p>
    ${conserto.passos.length ? `<ol>${conserto.passos.map(p => `<li>${p}</li>`).join('')}</ol>` : ''}
  </section>` : ''}
  ${listagem && !total ? '<section class="g-erro"><h2>A pasta não tem fotos</h2><p>O Drive respondeu, mas não há imagens nesta pasta (nem nas subpastas lidas).</p></section>' : ''}
  <main id="g-main" aria-label="Fotos"></main>
  ${capitulo && listagem ? navCapitulos(base, capitulo, 'fim', marca ? '' : slug) : ''}
  ${marca ? `<footer class="g-fim"><div class="aj-rodape">${botaoDeAjudaHTML(base)}</div><a href="https://fotos.lucafchala.com/suporte">Algo deu errado? Fale com a gente</a></footer>` : ''}
  <noscript><p class="g-aviso">A galeria precisa de JavaScript. ${drive ? `<a href="${escape(drive)}" rel="nofollow">Abrir a pasta no Drive</a>.` : ''}</p></noscript>
  <button type="button" class="g-topo" id="g-topo" data-acao="topo" aria-label="Voltar ao topo"><svg aria-hidden="true" viewBox="0 0 24 24" width="22" height="22"><path d="M12 5.5 5.5 12l1.4 1.4 4.1-4.1V19h2V9.3l4.1 4.1 1.4-1.4z" fill="currentColor"/></svg></button>
  <div class="g-barra" id="g-barra" hidden>
    <span id="g-barra-n" aria-live="polite">0 selecionadas</span>
    <button type="button" class="g-btn g-prim" data-acao="baixar-sel">Baixar</button>
    <button type="button" class="g-btn" data-acao="limpar-sel">Limpar</button>
    <button type="button" class="g-btn" data-acao="fim-sel">Concluir</button>
  </div>
  <div class="g-folha" id="g-folha" hidden role="dialog" aria-modal="true" aria-labelledby="g-folha-t">
    <div class="g-folha-c">
      <p class="g-folha-t" id="g-folha-t">Baixar</p>
      <div id="g-folha-ops"></div>
      <p class="g-folha-msg" id="g-folha-msg" aria-live="polite"></p>
      <div class="g-folha-rod"><button type="button" class="g-btn" data-acao="fechar-folha">Fechar</button></div>
    </div>
  </div>
  ${dados && !dono ? `<dialog class="g-rem" id="g-rem" aria-labelledby="g-rem-t">
    <div class="g-rem-c">
      <form id="g-rem-f" novalidate>
        <p class="g-folha-t" id="g-rem-t">Pedir remoção desta foto</p>
        <div class="g-rem-foto"><img id="g-rem-img" alt="" width="72" height="72"><span id="g-rem-nome"></span></div>
        <p class="g-rem-aviso">Recebemos o pedido. O fotógrafo vai analisar e você recebe a resposta por e-mail.</p>
        <label for="g-rem-motivo">Motivo</label>
        <select id="g-rem-motivo" required>
          <option value="" disabled selected>Escolha um motivo</option>
          <option value="eu">Sou eu na foto</option>
          <option value="menor">Sou responsável por um menor na foto</option>
          <option value="outro">Outro motivo</option>
        </select>
        <label for="g-rem-email">Seu e-mail</label>
        <input type="email" id="g-rem-email" autocomplete="email" maxlength="200" required>
        <label for="g-rem-msg">Mensagem (opcional)</label>
        <textarea id="g-rem-msg" maxlength="1000"></textarea>
        ${honeypotFieldHTML()}
        <div class="g-rem-ts" id="g-rem-ts"></div>
        <p class="g-rem-erro" id="g-rem-erro" role="alert"></p>
        <p class="g-rem-priv">Usamos seu e-mail só para responder a este pedido. <a href="/privacidade" target="_blank" rel="noopener">Política de privacidade</a>.</p>
        <div class="g-rem-acoes">
          <button type="button" class="g-btn" data-acao="fechar-rem">Cancelar</button>
          <button type="submit" class="g-btn g-prim" id="g-rem-enviar" disabled>Enviar pedido</button>
        </div>
      </form>
      <div class="g-rem-ok" id="g-rem-ok" hidden>
        <p class="g-folha-t" id="g-rem-ok-t" tabindex="-1">Pedido enviado</p>
        <p id="g-rem-ok-txt" role="status"></p>
        <p class="sub">Se precisar falar com o fotógrafo: privacidade@lucafchala.com.</p>
        <div class="g-rem-acoes"><button type="button" class="g-btn g-prim" data-acao="fechar-rem">Fechar</button></div>
      </div>
    </div>
  </dialog>` : ''}
  <div class="g-aviso-flut" id="g-aviso-flut" role="status" aria-live="polite"></div>
  ${dados ? `<script type="application/json" id="g-dados" nonce="${nonce}">${jsonParaScript(dados)}</script>
  <script nonce="${nonce}">${SCRIPT}</script>
  ${navegadorEmbutidoHTML(nonce)}` : ''}
</body>
</html>`;
}

/**
 * "Ano do evento" (v3.9.0), na faixa do dono: o ano que vale na linha do tempo
 * quando a data das fotos está errada. "Automático" volta à data das fotos.
 * @param {string} slug @param {string} cap
 * @param {{ atual: string, auto: string }} d
 */
function seletorDoAno(slug, cap, d) {
  const agora = new Date().getUTCFullYear();
  /** @type {string[]} */
  const anos = [];
  for (let a = agora + 1; a >= 2015; a--) anos.push(String(a));
  if (d.atual && !anos.includes(d.atual)) anos.push(d.atual);
  const op = (/** @type {string} */ v, /** @type {string} */ t) => `<option value="${escape(v)}"${v === d.atual ? ' selected' : ''}>${escape(t)}</option>`;
  return `<label class="g-ano">Ano do evento <select id="g-ano" data-slug="${escape(slug)}" data-cap="${escape(cap)}">${op('', `Automático${d.auto ? ` (${d.auto})` : ''}`)}${anos.map(a => op(a, a)).join('')}</select></label><span id="g-ano-msg" role="status"></span>`;
}

const SCRIPT_ANO = `(function () {
  var s = document.getElementById('g-ano');
  var m = document.getElementById('g-ano-msg');
  if (!s || !m) return;
  s.addEventListener('change', function () {
    s.disabled = true;
    m.textContent = 'Salvando…';
    fetch('/api/galeria/data', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ slug: s.dataset.slug, cap: s.dataset.cap, data: s.value }) })
      .then(function (r) { return r.json().catch(function () { return {}; }).then(function (j) { if (!r.ok) throw new Error(j.error || 'Não salvou. Tente de novo.'); m.textContent = s.value ? 'Salvo: o evento vai para ' + s.value + ' na linha do tempo.' : 'Salvo: de volta à data das fotos.'; }); })
      .catch(function (e) { m.textContent = (e && e.message) || 'Não salvou. Tente de novo.'; })
      .then(function () { s.disabled = false; });
  });
})();`;

/**
 * A foto de um link "?foto=": pelo ID inteiro ou pelos 10 primeiros
 * caracteres (o código curto que a galeria usa no #foto=). Vídeo não vale:
 * o cartão precisa de imagem.
 * @param {import('../drive.js').FotoDrive[]} fotos
 * @param {unknown} codigo
 * @returns {import('../drive.js').FotoDrive | undefined}
 */
export function fotoDaLista(fotos, codigo) {
  if (typeof codigo !== 'string' || !/^[A-Za-z0-9_-]{6,120}$/.test(codigo)) return undefined;
  return fotos.find(f => !ehVideo(f) && f[0] === codigo)
    || (codigo.length === 10 ? fotos.find(f => !ehVideo(f) && String(f[0]).slice(0, 10) === codigo) : undefined);
}

/**
 * O título e o ano de uma seção (v3.8.2). Pasta de ano com subpastas (o
 * PiauiFut: "2024 / Dia 1") antes virava só "Dia 1": o filtro por ano sumia e
 * os títulos misturavam anos e dias. Agora a seção leva o ano do caminho e o
 * título o caminho inteiro ("2024 · Dia 1"); o "!" de seleção sai do título.
 * @param {{ nome: string, caminho: string }} s
 * @returns {{ nome: string, ano?: string }}
 */
export function nomeDaSecao(s) {
  const partes = String(s.caminho || '').split(' / ').map(x => x.trim()).filter(Boolean);
  const ano = partes.map(x => /^(19|20)[0-9]{2}(?![0-9])/.exec(x)).find(Boolean);
  if (!ano) return { nome: s.nome };
  return { nome: partes.length > 1 ? partes.map(x => x.replace(/^!+\s*/, '')).join(' · ') : s.nome, ano: ano[0] };
}

/**
 * A barra entre os eventos do álbum (v3.8.2). Antes era uma faixa com TODOS os
 * eventos lado a lado (v3.8.0); com 20+ eventos ninguém achava nada. Agora:
 * anterior, o atual ("5 de 23") que abre a lista inteira por ano, e próximo.
 * Sem JS, a lista abre e fecha do mesmo jeito (<details>).
 * @param {string} base
 * @param {{ slug: string, nome: string, eventos?: { slug: string, nome: string, ano?: string }[] }} c
 */
function faixaDeEventos(base, c) {
  const evs = c.eventos || [];
  const i = evs.findIndex(e => e.slug === c.slug);
  const ant = i > 0 ? evs[i - 1] : null;
  const prox = i >= 0 && i < evs.length - 1 ? evs[i + 1] : null;
  const seta = (/** @type {{ slug: string, nome: string } | null} */ e, /** @type {'prev' | 'next'} */ rel) => e
    ? `<a class="g-ev-seta" rel="${rel}" href="${escape(`${base}/${e.slug}`)}" aria-label="${rel === 'prev' ? 'Evento anterior' : 'Próximo evento'}: ${escape(e.nome)}">${rel === 'prev' ? '‹' : '›'}</a>`
    : '<span class="g-ev-seta" aria-hidden="true"></span>';
  let anoAtual = '';
  const itens = evs.map(e => {
    const ano = e.ano && e.ano !== anoAtual ? e.ano : '';
    if (ano) anoAtual = ano;
    const link = e.slug === c.slug
      ? `<a class="g-ev" aria-current="page" href="${escape(`${base}/${e.slug}`)}">${escape(e.nome)}</a>`
      : `<a class="g-ev" href="${escape(`${base}/${e.slug}`)}">${escape(e.nome)}</a>`;
    return `${ano ? `<span class="g-ev-ano">${escape(ano)}</span>` : ''}${link}`;
  }).join('');
  const atual = i >= 0 ? evs[i] : { nome: '' };
  return `<nav class="g-evs" aria-label="Eventos do álbum">${seta(ant, 'prev')}<details class="g-ev-menu" id="g-ev-menu"><summary><span class="g-ev-nome">${escape(atual.nome)}</span><span class="g-ev-n">${i + 1} de ${evs.length}</span></summary><div class="g-ev-lista"><a class="g-ev g-ev-todos" href="${escape(base || '/')}">← Todos os eventos</a>${itens}</div></details>${seta(prox, 'next')}</nav>`;
}

/**
 * A navegação entre capítulos: voltar ao índice e ir ao anterior/próximo.
 * `topo` é a faixa sob o cabeçalho; `fim` repete no fim da página, com o link
 * da página do projeto.
 * @param {string} base /galeria/<slug>
 * @param {{ slug: string, nome: string, anterior: { slug: string, nome: string } | null, proximo: { slug: string, nome: string } | null }} c
 * @param {'topo' | 'fim'} onde
 * @param {string} [slugProjeto]
 */
function navCapitulos(base, c, onde, slugProjeto = '') {
  const ant = c.anterior ? `<a class="g-cap-a" rel="prev" href="${escape(`${base}/${c.anterior.slug}`)}"><span aria-hidden="true">‹</span> <span class="g-cap-t">${escape(c.anterior.nome)}</span></a>` : '';
  const prox = c.proximo ? `<a class="g-cap-a g-cap-p" rel="next" href="${escape(`${base}/${c.proximo.slug}`)}"><span class="g-cap-t">${escape(c.proximo.nome)}</span> <span aria-hidden="true">›</span></a>` : '';
  const indice = `<a class="g-cap-a g-cap-i" href="${escape(base || '/')}">← Todos os eventos</a>`;
  const projeto = slugProjeto ? `<a class="g-cap-a g-cap-i" href="/${escape(slugProjeto)}">Página do projeto</a>` : '';
  return `<nav class="g-cap-nav g-cap-${onde}" aria-label="${onde === 'topo' ? 'Capítulos' : 'Mais capítulos'}">${onde === 'topo' ? '' : indice}${ant}${prox}${projeto}</nav>`;
}

/**
 * Duração em segundos como ISO 8601 (PT1H2M3S), o formato do schema.org.
 * @param {number} s
 */
function duracaoIso(s) {
  const t = Math.max(0, Math.round(s));
  const h = Math.floor(t / 3600), m = Math.floor((t % 3600) / 60), seg = t % 60;
  return `PT${h ? `${h}H` : ''}${m ? `${m}M` : ''}${seg || (!h && !m) ? `${seg}S` : ''}`;
}

/** "A", "A e B", "A, B e C". @param {string[]} nomes */
function listaComE(nomes) {
  if (nomes.length < 2) return nomes.join('');
  return `${nomes.slice(0, -1).join(', ')} e ${nomes[nomes.length - 1]}`;
}

// O script da página. Sem template literal dentro (o arquivo inteiro já é um),
// sem barra invertida (seria dobrada pelo template) e sem innerHTML com dado do
// Drive: nome de arquivo entra por textContent.
const SCRIPT = `
(function () {
  'use strict';
  // A lista de eventos (v3.8.2): fecha com toque fora ou Esc; aberta, o
  // evento atual já aparece.
  const menuEv = /** @type {HTMLDetailsElement | null} */ (document.getElementById('g-ev-menu'));
  if (menuEv) {
    menuEv.addEventListener('toggle', () => {
      // Aberta, a barra sobe para o topo da tela: a lista ganha a altura toda.
      const nav = menuEv.parentElement;
      if (menuEv.open && nav && nav.getBoundingClientRect().top > 8) nav.scrollIntoView({ block: 'start' });
      const a = /** @type {HTMLElement | null} */ (menuEv.open ? menuEv.querySelector('[aria-current]') : null);
      const l = /** @type {HTMLElement | null} */ (menuEv.querySelector('.g-ev-lista'));
      if (a && l) l.scrollTop = Math.max(0, a.offsetTop - (l.clientHeight - a.offsetHeight) / 2);
    });
    document.addEventListener('click', e => { if (menuEv.open && !menuEv.contains(/** @type {Node} */ (e.target))) menuEv.open = false; });
    document.addEventListener('keydown', e => { if (e.key === 'Escape' && menuEv.open) { menuEv.open = false; const s = menuEv.querySelector('summary'); if (s) s.focus(); } });
  }
  const dadosEl = document.getElementById('g-dados');
  const main = document.getElementById('g-main');
  if (!dadosEl || !main) return;
  /** @type {{ slug: string, cap: string, titulo: string, amigavel: string[] | null, tentativasMini: number, secoes: { nome: string, fotos: any[][], as?: string }[], autores: string[], cr0: number, sessao: number, larguras: number[], grade: number[], drive: string, dono: boolean, ocultas: string[], pendentes: string[], remocao: { token: string, ts: string } | null, lightbox: string, core: string, css: string }} */
  const D = JSON.parse(dadosEl.textContent || '{}');
  // Campos novos (v3.8.0) lidos por um apelido sem tipo fixo.
  const DX = /** @type {any} */ (D);
  // Texto alternativo de cada foto: "<evento> — foto i de n" (o mesmo do
  // JSON-LD da página). Nome de arquivo não descreve a foto para ninguém.
  const TOTAL = D.secoes.reduce(function (n, s) { return n + s.fotos.length; }, 0);
  const altDe = function (i, video) { return (D.titulo ? D.titulo + ' — ' : '') + (video ? 'vídeo ' : 'foto ') + (i + 1) + ' de ' + TOTAL; };
  // Duração de vídeo: m:ss (h:mm:ss a partir de uma hora).
  function fmtDur(s) {
    const t = Math.max(0, Math.round(s));
    const h = Math.floor(t / 3600);
    const m = Math.floor((t % 3600) / 60);
    const seg = t % 60;
    return (h ? h + ':' + String(m).padStart(2, '0') : String(m)) + ':' + String(seg).padStart(2, '0');
  }
  // Fotos que o dono ocultou do público. Só chega preenchido para o dono.
  const ocultas = new Set(D.ocultas || []);
  // Dentre elas, as escondidas A PEDIDO de um visitante e ainda sem decisão.
  const pendentes = new Set(D.pendentes || []);
  function pintaOculta(f) {
    const oc = f.el.classList.toggle('oculta', ocultas.has(f.id));
    const pend = oc && pendentes.has(f.id);
    f.el.classList.toggle('pendente', pend);
    const rotulo = f.el.querySelector('.g-oc');
    if (rotulo) rotulo.textContent = pend ? 'Oculta a pedido' : 'Oculta';
  }
  function textoOcultas() {
    if (!ocultas.size) return 'Nenhuma foto oculta';
    return ocultas.size + (ocultas.size === 1 ? ' oculta' : ' ocultas') + ' para os visitantes' +
      (pendentes.size ? ' (' + pendentes.size + ' a pedido, esperando você decidir em Pedidos)' : '');
  }

  // ---- Dados ----
  /** @typedef {{ id: string, w: number, h: number, nome: string, bytes: number, redes: { nome: string, bytes: number } | null, autor: number, cauda: string, s: number, el: HTMLAnchorElement, img: HTMLImageElement, estimada: boolean, alt: string, video: boolean, dur: number, live: { id: string, nome: string, bytes: number } | null, nova: boolean }} Foto */
  /** @type {Foto[]} */
  const fotos = [];
  // ---- Fotos novas desde a última visita (#250) ----
  // O instante da visita anterior fica só neste aparelho (localStorage, por
  // projeto e capítulo): nada vai ao servidor. Visita nova = mais de D.sessao
  // minutos desde a anterior, para recarregar a página não apagar as marcas.
  // Primeira visita: não há com o que comparar, então nada é marcado.
  const CHAVE_VISITA = 'gal-visita:' + D.slug + ':' + (D.cap || '');
  let visitaAnt = 0;
  (function () {
    const agora = Date.now();
    let p = 0;
    let u = 0;
    try {
      const v = JSON.parse(localStorage.getItem(CHAVE_VISITA) || 'null');
      if (v && typeof v.u === 'number') { u = v.u; p = typeof v.p === 'number' ? v.p : 0; }
    } catch (e) { /* sem armazenamento: sem marcas */ }
    if (u && agora - u > D.sessao * 60000) p = u;
    visitaAnt = p;
    try { localStorage.setItem(CHAVE_VISITA, JSON.stringify({ p: p, u: agora })); } catch (e) { /* idem */ }
  })();
  let rw = '';
  // As fotos passam pelo próprio site (v3.8.3): /f/<id>/<largura>. O site
  // guarda cada tamanho no cache da Cloudflare (e, com o R2, lê de lá); o
  // Google só é chamado na primeira vez. Sem WebP, o sufixo "j" pede JPEG.
  // Desde a v3.8.8 o endereço leva "k" = o álbum e a assinatura da foto, que
  // vem nos dados (as): sem ela a rota responde 404.
  const K = {};
  D.secoes.forEach(function (s) {
    const juntas = typeof s.as === 'string' ? s.as : '';
    const n = s.fotos.length ? juntas.length / s.fotos.length : 0;
    s.fotos.forEach(function (f, i) {
      const a = n >= 1 && n === Math.floor(n) ? juntas.slice(i * n, i * n + n).trim() : '';
      K[f[0]] = D.slug + (a ? '.' + a : '');
    });
  });
  const lh3 = function (id, w) { return '/f/' + id + '/' + Math.round(w) + (rw ? '' : 'j') + '?k=' + (K[id] || D.slug); };
  // Link curto da foto (v3.8.3): #foto= com os 10 primeiros caracteres do ID
  // (o ID inteiro só se dois começarem igual). O link antigo, com o ID
  // inteiro, continua abrindo.
  const prefixos = {};
  D.secoes.forEach(function (s) { s.fotos.forEach(function (f) { const p = String(f[0]).slice(0, 10); prefixos[p] = (prefixos[p] || 0) + 1; }); });
  const codigoDe = function (id) { const p = String(id).slice(0, 10); return prefixos[p] > 1 ? id : p; };
  // O link de uma foto (v3.9.0): "<página>?foto=<código>". O servidor vê o
  // código e o cartão do WhatsApp mostra a própria foto. O #foto= antigo
  // continua abrindo.
  const FOTO_NO_LINK = (function () {
    const q = new URLSearchParams(location.search).get('foto');
    if (q && /^[A-Za-z0-9_-]+$/.test(q)) return q;
    const m = location.hash.match(/^#foto=([A-Za-z0-9_-]+)$/);
    return m ? m[1] : '';
  })();
  const semFotoNaBusca = function () {
    const q = new URLSearchParams(location.search);
    q.delete('foto');
    const s = q.toString();
    return location.pathname + (s ? '?' + s : '');
  };
  const enderecoDaFoto = function (id) { return location.pathname + '?foto=' + codigoDe(id); };
  const semExt = function (n) { return String(n || '').replace(/[.][^.]+$/, ''); };
  const LONGO_ESTIMADO = 4096;
  const reduz = function () {
    try { return matchMedia('(prefers-reduced-motion: reduce)').matches; } catch (e) { return false; }
  };

  // Unidades decimais (1 MB = 1.000.000 bytes): é o que o iPhone, o Mac e o
  // Android mostram para o arquivo baixado — o número aqui tem de bater com o
  // da galeria do celular depois.
  function fmtBytes(n) {
    if (!n) return '';
    const mb = n / 1e6;
    if (mb < 1) return Math.max(1, Math.round(n / 1e3)) + ' KB';
    return mb.toLocaleString('pt-BR', { maximumFractionDigits: mb < 10 ? 1 : 0 }) + ' MB';
  }

  // ---- WebP: decide pelo que o navegador faz, não por user-agent ----
  // Primeiro o caminho síncrono: quem CODIFICA WebP num canvas também o
  // decodifica, e a grade sai no mesmo passo do script (a miniatura do LCP é
  // pedida antes). Quem não codifica (Safari antigo) cai na decodificação de
  // verdade, assíncrona, como antes.
  function webpPorCanvas() {
    try {
      const c = document.createElement('canvas');
      c.width = 1;
      c.height = 1;
      return c.toDataURL('image/webp').indexOf('data:image/webp') === 0;
    } catch (e) { return false; }
  }
  function detectaWebp(pronto) {
    if (webpPorCanvas()) { rw = '-rw'; pronto(); return; }
    const t = new Image();
    let feito = false;
    const fim = function (ok) { if (feito) return; feito = true; rw = ok ? '-rw' : ''; pronto(); };
    t.onload = function () { fim(t.width === 1); };
    t.onerror = function () { fim(false); };
    setTimeout(function () { fim(false); }, 1500);
    t.src = 'data:image/webp;base64,UklGRiIAAABXRUJQVlA4IBYAAAAwAQCdASoBAAEADsD+JaQAA3AAAAAA';
  }

  // ---- Grade justificada ----
  /** @type {{ sec: HTMLElement, grade: HTMLElement, lista: Foto[], todas: HTMLButtonElement }[]} */
  const grades = [];
  function monta() {
    const varias = D.secoes.length > 1;
    D.secoes.forEach(function (sec, s) {
      const secEl = document.createElement('section');
      secEl.className = 'g-sec';
      const cab = document.createElement('div');
      cab.className = 'g-sec-cab' + (varias ? '' : ' sem-titulo');
      if (varias) {
        const h2 = document.createElement('h2');
        h2.textContent = sec.nome || 'Fotos';
        cab.appendChild(h2);
      }
      const todas = document.createElement('button');
      todas.type = 'button';
      todas.className = 'g-sec-todas';
      todas.dataset.acao = 'sel-secao';
      todas.dataset.sec = String(s);
      todas.textContent = 'Selecionar todas';
      cab.appendChild(todas);
      secEl.appendChild(cab);
      const grade = document.createElement('div');
      grade.className = 'g-grade';
      secEl.appendChild(grade);
      main.appendChild(secEl);
      /** @type {Foto[]} */
      const lista = [];
      sec.fotos.forEach(function (f) {
        const i = fotos.length;
        // Item 1f: f[9] é o extra — número = vídeo (duração em segundos), lista
        // = Live Photo (o vídeo dele).
        const extra = f[9];
        const ehVid = typeof extra === 'number';
        const live = Array.isArray(extra) ? { id: extra[0], nome: extra[1], bytes: extra[2] } : null;
        const nova = !!(f[10] && visitaAnt && D.cr0 + f[10] * 60000 > visitaAnt);
        const a = document.createElement('a');
        a.className = 'g-t' + (ehVid ? ' g-video' : '') + (nova ? ' nova' : '');
        a.href = '?foto=' + codigoDe(f[0]);
        a.dataset.i = String(i);
        a.dataset.ext = extDoNome(f[3]).toUpperCase();
        a.setAttribute('aria-label', (ehVid ? 'Vídeo ' : live ? 'Live Photo ' : 'Foto ') + semExt(f[3]) + (nova ? ', nova' : ''));
        const img = document.createElement('img');
        img.alt = altDe(i, ehVid);
        img.decoding = 'async';
        // Preguiçosa por padrão; a primeira diagramação torna "eager" só o que
        // cai na primeira tela (ver dimensiona).
        img.loading = 'lazy';
        const ck = document.createElement('span');
        ck.className = 'g-ck';
        ck.setAttribute('aria-hidden', 'true');
        const fv = document.createElement('span');
        fv.className = 'g-fav';
        fv.setAttribute('aria-hidden', 'true');
        fv.title = 'Favoritar (tecla F)';
        a.appendChild(img);
        a.appendChild(ck);
        a.appendChild(fv);
        if (ehVid || live) {
          const sel = document.createElement('span');
          sel.className = ehVid ? 'g-play' : 'g-live';
          sel.setAttribute('aria-hidden', 'true');
          sel.textContent = ehVid ? (extra > 0 ? fmtDur(extra) : '') : 'LIVE';
          a.appendChild(sel);
        }
        if (nova) {
          const nv = document.createElement('span');
          nv.className = 'g-nova';
          nv.setAttribute('aria-hidden', 'true');
          nv.textContent = 'nova';
          a.appendChild(nv);
        }
        if (D.dono) {
          const oc = document.createElement('span');
          oc.className = 'g-oc';
          oc.textContent = 'Oculta';
          a.appendChild(oc);
        }
        /** @type {Foto} */
        const foto = { id: f[0], w: f[1], h: f[2], nome: f[3], bytes: f[4], redes: f[5] >= 0 ? { bytes: f[5], nome: f[6] || f[3] } : null, autor: f[7] || 0, cauda: f[8] || '', s: s, el: a, img: img, estimada: !(f[1] > 0 && f[2] > 0), alt: img.alt, video: ehVid, dur: ehVid ? extra : 0, live: live, nova: nova };
        if (D.dono) pintaOculta(foto);
        img.addEventListener('load', function () { carregou(foto); });
        // Miniatura que falhou (o site ou o Google recusou na rajada do
        // lançamento) tenta de novo, com espera crescente e sorteada, antes de
        // virar o quadro vazio: a falha não fica em cache, então pedir de novo
        // resolve. Sem isto, só recarregar a página trazia a foto.
        img.addEventListener('error', function () {
          var n = Number(img.getAttribute('data-t') || 0);
          if (n >= D.tentativasMini) { img.classList.add('ok'); a.classList.add('sem-mini'); return; }
          img.setAttribute('data-t', String(n + 1));
          setTimeout(function () {
            var conjunto = img.getAttribute('srcset'), unica = img.getAttribute('src');
            if (conjunto) { img.removeAttribute('srcset'); img.setAttribute('srcset', conjunto); }
            if (unica) { img.removeAttribute('src'); img.setAttribute('src', unica); }
          }, (n + 1) * 2000 + Math.random() * 2000);
        });
        fotos.push(foto);
        lista.push(foto);
      });
      grades.push({ sec: secEl, grade: grade, lista: lista, todas: todas });
    });
  }

  function proporcao(f) {
    return f.w > 0 && f.h > 0 ? Math.min(Math.max(f.w / f.h, 0.25), 5) : 1.5;
  }

  let larguraDiagramada = 0;
  function diagramaTudo() {
    const estilo = getComputedStyle(grades.length ? grades[0].grade : main);
    const W = Math.floor(main.clientWidth - parseFloat(estilo.paddingLeft) - parseFloat(estilo.paddingRight));
    if (!W || W < 50) return;
    larguraDiagramada = main.clientWidth;
    const alvo = window.innerWidth >= 1200 ? 280 : W < 520 ? 300 : W < 900 ? 260 : 240;
    const gap = W < 520 ? 3 : 5;
    // Onde cada linha cai na página, aproximado (o título da seção conta como
    // 48 px): decide o que é "primeira tela" na primeira diagramação.
    const pos = { y: main.getBoundingClientRect().top + window.scrollY, primeira: true };
    grades.forEach(function (g) { diagrama(g, W, alvo, gap, pos); });
  }

  function diagrama(g, W, alvo, gap, pos) {
    if (pos && D.secoes.length > 1) pos.y += 48;
    const mostradas = visiveisDe(g);
    g.sec.hidden = !mostradas.length;
    if (!mostradas.length) { g.grade.replaceChildren(); return; }
    const frag = document.createDocumentFragment();
    let linha = [];
    let soma = 0;
    let altura = 0;
    const fecha = function (ultima) {
      const livre = W - gap * (linha.length - 1);
      let h = livre / soma;
      const naoEstica = ultima && h > alvo * 1.15;
      if (naoEstica) h = alvo;
      h = Math.max(40, Math.floor(h));
      const row = document.createElement('div');
      row.className = 'g-linha';
      row.style.height = h + 'px';
      let usado = 0;
      const topo = pos ? pos.y : Infinity;
      const primeira = !!pos && pos.primeira;
      linha.forEach(function (f, k) {
        let w = Math.floor(proporcao(f) * h);
        if (k === linha.length - 1 && !naoEstica) w = Math.max(20, livre - usado);
        usado += w;
        f.el.style.width = w + 'px';
        dimensiona(f, w, topo, primeira);
        row.appendChild(f.el);
      });
      frag.appendChild(row);
      altura += h + gap;
      if (pos) { pos.y += h + gap; pos.primeira = false; }
      linha = [];
      soma = 0;
    };
    mostradas.forEach(function (f) {
      linha.push(f);
      soma += proporcao(f);
      if (soma * alvo + gap * (linha.length - 1) >= W) fecha(false);
    });
    if (linha.length) fecha(true);
    g.grade.replaceChildren(frag);
    g.sec.style.containIntrinsicSize = 'auto ' + Math.ceil(altura + 60) + 'px';
  }

  const vigia = typeof IntersectionObserver === 'function' ? new IntersectionObserver(function (es) {
    es.forEach(function (e) {
      if (!e.isIntersecting) return;
      vigia.unobserve(e.target);
      const f = fotos[Number(e.target.dataset.i)];
      if (f) poeSrc(f);
    });
  }, { rootMargin: '1500px 0px' }) : null;
  // A miniatura pede ao Google a menor largura que cobre o quadradinho em
  // pixels físicos: o navegador escolhe pelo srcset + sizes.
  function dimensiona(f, w, topo, primeiraLinha) {
    if (!f.img.srcset) {
      // Só na primeira vez (antes do src): o que cai na primeira tela baixa já,
      // e a primeira linha — onde está a maior foto da tela, o LCP — vai na
      // frente das outras. O resto espera chegar perto (loading=lazy), sem
      // disputar a banda com o que se vê.
      // Vídeo (v3.8.1): o Google demora para gerar a miniatura de vídeo
      // grande; ela vem depois das fotos e nunca segura a primeira tela.
      const perto = topo < window.innerHeight * 1.25;
      if (f.video) f.img.setAttribute('fetchpriority', 'low');
      else {
        if (perto) f.img.loading = 'eager';
        if (primeiraLinha) f.img.setAttribute('fetchpriority', 'high');
      }
      // v3.9.4: só a primeira tela ganha o srcset já. O resto ganha quando
      // chega perto (ver poeSrc): montar as ~13 URLs de cada uma das mil e
      // tantas miniaturas na abertura travava o celular por meio segundo.
      if (perto || !vigia) poeSrc(f);
      else if (!f.vigiada) { f.vigiada = true; vigia.observe(f.el); }
    }
    f.img.sizes = w + 'px';
  }
  function poeSrc(f) {
    if (f.img.srcset) return;
    f.img.srcset = D.grade.map(function (x) { return lh3(f.id, x) + ' ' + x + 'w'; }).join(', ');
    f.img.src = lh3(f.id, 400);
  }

  let reflow = 0;
  function agendaDiagrama() {
    if (reflow) return;
    reflow = requestAnimationFrame(function () { reflow = 0; diagramaTudo(); });
  }

  function carregou(f) {
    f.img.classList.add('ok');
    // Sem dimensões no Drive (alguns HEIC/RAW): a miniatura dá a proporção, e a
    // grade se refaz uma vez. O tamanho real fica estimado até o visualizador.
    if (f.estimada && f.img.naturalWidth && !f.w) {
      const k = LONGO_ESTIMADO / Math.max(f.img.naturalWidth, f.img.naturalHeight);
      f.w = Math.round(f.img.naturalWidth * k);
      f.h = Math.round(f.img.naturalHeight * k);
      agendaDiagrama();
    }
  }

  // ---- Seleção e favoritas ----
  // As duas listas ficam só neste aparelho (localStorage), e a página tem de
  // funcionar com o armazenamento bloqueado.
  const CHAVE_SEL = 'galeria:sel:' + D.slug;
  const CHAVE_FAV = 'galeria:fav:' + D.slug;
  function leLista(chave) {
    try {
      const salvo = JSON.parse(localStorage.getItem(chave) || '[]');
      if (Array.isArray(salvo)) return new Set(salvo.map(String));
    } catch (e) { /* armazenamento indisponível: vale só nesta visita */ }
    return new Set();
  }
  function gravaLista(chave, conjunto) {
    try { localStorage.setItem(chave, JSON.stringify(Array.from(conjunto))); } catch (e) { /* idem */ }
  }
  /** @type {Set<string>} */
  let sel = leLista(CHAVE_SEL);
  /** @type {Set<string>} */
  const fav = leLista(CHAVE_FAV);
  let modoSel = false;
  let filtroFav = false;
  let filtroNovas = false;
  // Seleção que chegou por link (#sel=id.id.id, #213): a galeria abre só com
  // essas fotos. Vive no fragmento — não vai ao servidor nem é gravada.
  /** @type {Set<string> | null} */
  let filtroLink = null;
  const MAX_LINK = 300;
  let vendo = false;
  const chips = document.getElementById('g-chips');
  const cab = document.getElementById('g-topo-cab');
  /** @type {HTMLButtonElement[]} */
  let chipsSec = [];
  /** @type {HTMLButtonElement | null} */
  let chipFav = null;

  /** @type {Foto | null} */
  let ultimoSel = null;
  /** As fotos na ordem em que aparecem agora (todas, ou só as favoritas). */
  let vistas = fotos;
  const barra = document.getElementById('g-barra');
  const barraN = document.getElementById('g-barra-n');
  const botaoSel = document.getElementById('g-sel');

  // Filtro por fotógrafo (-1 = todos): combina com as favoritas e com o link.
  let filtroAutor = -1;
  // Filtro por ano (v3.7.2): quando TODAS as seções da página são anos ("2026",
  // "2025 - Final"), as etiquetas do topo filtram em vez de rolar até a seção.
  let filtroSec = -1;
  // O ano de cada seção vem do servidor (do caminho: "2024 / Dia 1" é 2024);
  // o filtro é por ano, juntando as seções do mesmo ano (v3.8.2).
  const anosSec = D.secoes.map(function (sec, i) { const m = /^(19|20)[0-9][0-9](?![0-9])/.exec(String(sec.nome || '').trim()); return String(DX.secoes[i].ano || (m ? m[0] : '')); });
  const anosLista = anosSec.filter(function (a, i) { return a && anosSec.indexOf(a) === i; });
  const secoesSaoAnos = D.secoes.length > 1 && anosSec.every(Boolean) && anosLista.length > 1;
  // O ano escolhido fica lembrado neste aparelho (v3.8.3): voltar ao evento
  // reabre no mesmo ano. Quem chega por link de foto (?foto=) vê tudo.
  const CHAVE_ANO = 'gal-ano:' + D.slug + ':' + D.cap;
  if (secoesSaoAnos && !FOTO_NO_LINK) {
    try { const a = localStorage.getItem(CHAVE_ANO); const k = a ? anosLista.indexOf(a) : -1; if (k >= 0) filtroSec = k; } catch (e) { /* sem armazenamento */ }
  }
  function filtroAtivo() {
    const a = filtroAutor;
    const sc = filtroSec;
    const l = filtroLink;
    const base = l ? function (f) { return l.has(f.id); } : (filtroFav || filtroNovas) ? function (f) { return (!filtroFav || fav.has(f.id)) && (!filtroNovas || f.nova); } : null;
    if (a < 0 && sc < 0) return base;
    return function (f) { return (a < 0 || f.autor === a) && (sc < 0 || anosSec[f.s] === anosLista[sc]) && (!base || base(f)); };
  }
  function visiveisDe(g) {
    const fn = filtroAtivo();
    return fn ? g.lista.filter(fn) : g.lista;
  }
  function recalculaVistas() {
    const fn = filtroAtivo();
    vistas = fn ? fotos.filter(fn) : fotos;
  }
  function salvaSel() { gravaLista(CHAVE_SEL, sel); }
  function salvaFav() { gravaLista(CHAVE_FAV, fav); }
  function pintaSel(f) {
    const on = sel.has(f.id);
    const gosto = fav.has(f.id);
    f.el.classList.toggle('sel', on);
    f.el.classList.toggle('fav', gosto);
    // O check e o coração são só visuais (aria-hidden): o leitor de tela ouve
    // o estado no nome.
    f.el.setAttribute('aria-label', (f.video ? 'Vídeo ' : f.live ? 'Live Photo ' : 'Foto ') + semExt(f.nome) + (f.nova ? ', nova' : '') + (on ? ', selecionada' : '') + (gosto ? ', favorita' : ''));
  }
  function atualizaBarra() {
    if (!barra || !barraN) return;
    const n = sel.size;
    barra.hidden = !(modoSel || n > 0);
    document.body.classList.toggle('g-com-barra', !barra.hidden);
    barraN.textContent = n === 1 ? '1 selecionada' : n + ' selecionadas';
    grades.forEach(function (g) {
      const l = visiveisDe(g);
      g.todas.textContent = l.length && l.every(function (f) { return sel.has(f.id); }) ? 'Desmarcar todas' : 'Selecionar todas';
    });
  }
  function alternaSel(f) {
    if (sel.has(f.id)) sel.delete(f.id); else sel.add(f.id);
    ultimoSel = f;
    pintaSel(f);
    salvaSel();
    atualizaBarra();
  }
  // Shift+clique: do último marcado até este (na ordem que se vê).
  function selecionaIntervalo(f) {
    const a = ultimoSel ? vistas.indexOf(ultimoSel) : -1;
    const b = vistas.indexOf(f);
    if (a < 0 || b < 0) { alternaSel(f); return; }
    for (let k = Math.min(a, b); k <= Math.max(a, b); k++) {
      sel.add(vistas[k].id);
      pintaSel(vistas[k]);
    }
    ultimoSel = f;
    salvaSel();
    atualizaBarra();
  }
  function selecionaSecao(k) {
    const g = grades[k];
    if (!g) return;
    const lista = visiveisDe(g);
    const todas = lista.every(function (f) { return sel.has(f.id); });
    lista.forEach(function (f) {
      if (todas) sel.delete(f.id); else sel.add(f.id);
      pintaSel(f);
    });
    salvaSel();
    atualizaBarra();
    avisa(todas ? 'Seleção desta seção removida' : lista.length + (lista.length === 1 ? ' foto selecionada' : ' fotos selecionadas'));
  }
  function ligaModoSel(liga) {
    modoSel = liga;
    document.body.classList.toggle('g-modo-sel', liga);
    if (botaoSel) {
      botaoSel.setAttribute('aria-pressed', String(liga));
      botaoSel.textContent = liga ? 'Selecionando' : 'Selecionar';
    }
    atualizaBarra();
  }

  /** @returns {boolean} se a foto ficou favorita */
  function alternaFav(f) {
    const era = fav.has(f.id);
    if (era) fav.delete(f.id); else fav.add(f.id);
    salvaFav();
    pintaSel(f);
    atualizaChips();
    avisa(era ? 'Removida das favoritas' : 'Favorita guardada, só neste aparelho');
    // Com o visualizador aberto a lista não muda debaixo dele: refaz ao fechar.
    if (filtroFav && !vendo) {
      if (!fav.size) ligaFiltroFav(false);
      else { recalculaVistas(); agendaDiagrama(); }
    }
    return !era;
  }
  // ---- Seleção por link (#213) ----
  // As favoritas viram um link com os ids no fragmento: quem abre vê só elas.
  // Num álbum de família ou privado o link não fura nada — o servidor segue
  // pedindo o passe do portão para abrir a galeria.
  function linkDasFavoritas() {
    const ids = fotos.filter(function (f) { return fav.has(f.id); }).map(function (f) { return f.id; });
    return { url: location.origin + location.pathname + '#sel=' + ids.slice(0, MAX_LINK).join('.'), n: Math.min(ids.length, MAX_LINK), cortou: ids.length > MAX_LINK };
  }
  function compartilhaFavoritas() {
    const l = linkDasFavoritas();
    if (!l.n) { avisa('Marque fotos com o coração primeiro'); return; }
    const aviso = l.cortou ? 'Link com as primeiras ' + MAX_LINK + ' favoritas copiado' : 'Link com ' + l.n + (l.n === 1 ? ' foto copiado' : ' fotos copiado');
    const h1 = document.getElementById('g-h1');
    const titulo = (h1 ? (h1.textContent || '') : document.title) + ' — minha seleção';
    if (navigator.share && matchMedia('(pointer: coarse)').matches) {
      navigator.share({ title: titulo, url: l.url }).catch(function () {});
      return;
    }
    if (navigator.clipboard) {
      navigator.clipboard.writeText(l.url).then(function () { avisa(aviso); }, function () { avisa(l.url); });
    } else {
      avisa(l.url);
    }
  }
  /** Lê #sel= do endereço. Devolve quantas fotos do link existem aqui. */
  function leSelecaoDoLink() {
    const m = location.hash.match(/^#sel=([A-Za-z0-9_.-]+)$/);
    if (!m) return -1;
    const pedidas = m[1].split('.').filter(function (id) { return /^[A-Za-z0-9_-]{10,200}$/.test(id); }).slice(0, MAX_LINK);
    const aqui = new Set(pedidas.filter(function (id) { return fotos.some(function (f) { return f.id === id; }); }));
    if (!aqui.size) return 0;
    filtroLink = aqui;
    document.body.classList.add('g-so-link');
    recalculaVistas();
    return aqui.size;
  }
  function saiDoLink() {
    filtroLink = null;
    document.body.classList.remove('g-so-link');
    history.replaceState(history.state, '', location.pathname + location.search);
    recalculaVistas();
    montaChips();
    diagramaTudo();
    atualizaBarra();
    window.scrollTo(0, 0);
  }
  /** Guarda as fotos do link nas favoritas deste aparelho. */
  function guardaDoLink() {
    if (!filtroLink) return;
    let novas = 0;
    filtroLink.forEach(function (id) { if (!fav.has(id)) { fav.add(id); novas++; } });
    salvaFav();
    fotos.forEach(pintaSel);
    montaChips();
    avisa(novas ? novas + (novas === 1 ? ' foto guardada nas favoritas' : ' fotos guardadas nas favoritas') : 'Já estavam nas suas favoritas');
  }

  function ligaFiltroAutor(k) {
    const tinhaFoco = !!document.activeElement && /** @type {HTMLElement} */ (document.activeElement).dataset.acao === 'filtro-autor';
    filtroAutor = k === filtroAutor ? -1 : k;
    recalculaVistas();
    montaChips();
    diagramaTudo();
    atualizaBarra();
    window.scrollTo(0, 0);
    if (tinhaFoco) {
      const alvo = chips ? chips.querySelector('[data-acao="filtro-autor"][aria-pressed="true"]') || chips.querySelector('[data-acao="filtro-autor"]') : null;
      if (alvo) alvo.focus({ preventScroll: true });
    }
  }

  function ligaFiltroSec(k) {
    const tinhaFoco = !!document.activeElement && /** @type {HTMLElement} */ (document.activeElement).dataset.acao === 'filtro-sec';
    filtroSec = k === filtroSec ? -1 : k;
    try { if (filtroSec >= 0) localStorage.setItem(CHAVE_ANO, anosLista[filtroSec]); else localStorage.removeItem(CHAVE_ANO); } catch (e) { /* idem */ }
    recalculaVistas();
    montaChips();
    diagramaTudo();
    atualizaBarra();
    window.scrollTo(0, 0);
    if (tinhaFoco) {
      const alvo = chips ? chips.querySelector('[data-acao="filtro-sec"][aria-pressed="true"]') || chips.querySelector('[data-acao="filtro-sec"]') : null;
      if (alvo) /** @type {HTMLElement} */ (alvo).focus({ preventScroll: true });
    }
  }

  function ligaFiltroNovas(liga) {
    const tinhaFoco = !!document.activeElement && /** @type {HTMLElement} */ (document.activeElement).dataset.acao === 'filtro-novas';
    filtroNovas = liga;
    recalculaVistas();
    montaChips();
    diagramaTudo();
    atualizaBarra();
    window.scrollTo(0, 0);
    if (tinhaFoco) {
      const alvo = chips ? chips.querySelector('[data-acao="filtro-novas"]') : null;
      if (alvo) /** @type {HTMLElement} */ (alvo).focus({ preventScroll: true });
    }
  }

  function ligaFiltroFav(liga) {
    const tinhaFoco = !!document.activeElement && /** @type {HTMLElement} */ (document.activeElement).dataset.acao === 'filtro-fav';
    filtroFav = liga;
    recalculaVistas();
    document.body.classList.toggle('g-so-fav', liga);
    montaChips();
    diagramaTudo();
    atualizaBarra();
    window.scrollTo(0, 0);
    if (tinhaFoco && chipFav) chipFav.focus({ preventScroll: true });
  }

  // ---- Faixa de chips: seções (com a contagem) e favoritas ----
  function medeTopo() {
    if (cab) document.documentElement.style.setProperty('--topo', cab.offsetHeight + 'px');
  }
  function botaoChip(nome, n) {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'g-chip';
    b.appendChild(document.createTextNode(nome));
    const c = document.createElement('small');
    c.textContent = String(n);
    b.appendChild(c);
    return b;
  }
  /** Os fotógrafos com foto na página — só aparecem quando há mais de um. */
  function autoresDaPagina() {
    const n = {};
    fotos.forEach(function (f) { n[f.autor] = (n[f.autor] || 0) + 1; });
    return Object.keys(n).map(Number).sort(function (a, b) { return a - b; }).map(function (k) { return { k: k, n: n[k] }; });
  }
  function chipsAutores() {
    const l = autoresDaPagina();
    if (l.length < 2 || !chips) return;
    const grupo = document.createElement('span');
    grupo.className = 'g-chips-grupo';
    grupo.setAttribute('role', 'group');
    grupo.setAttribute('aria-label', 'Fotógrafo');
    const todos = botaoChip('Todos', fotos.length);
    todos.dataset.acao = 'filtro-autor';
    todos.dataset.aut = '-1';
    todos.setAttribute('aria-pressed', String(filtroAutor < 0));
    grupo.appendChild(todos);
    l.forEach(function (a) {
      const b = botaoChip(D.autores[a.k] || 'Fotos', a.n);
      b.dataset.acao = 'filtro-autor';
      b.dataset.aut = String(a.k);
      b.setAttribute('aria-pressed', String(filtroAutor === a.k));
      grupo.appendChild(b);
    });
    chips.appendChild(grupo);
  }
  function montaChips() {
    if (!chips) return;
    chips.replaceChildren();
    chipsSec = [];
    if (filtroLink) {
      const b = botaoChip('Seleção recebida', filtroLink.size);
      b.dataset.acao = 'sai-link';
      b.setAttribute('aria-pressed', 'true');
      b.title = 'Toque para ver todas as fotos';
      chips.appendChild(b);
      const g = document.createElement('button');
      g.type = 'button';
      g.className = 'g-chip';
      g.dataset.acao = 'guarda-link';
      g.textContent = 'Guardar nas minhas favoritas';
      chips.appendChild(g);
      chipsAutores();
      chipFav = null;
      chips.hidden = false;
      medeTopo();
      return;
    }
    if (secoesSaoAnos) {
      const grupo = document.createElement('span');
      grupo.className = 'g-chips-grupo g-chips-anos';
      grupo.setAttribute('role', 'group');
      grupo.setAttribute('aria-label', 'Ano');
      const todos = botaoChip('Todos os anos', fotos.length);
      todos.dataset.acao = 'filtro-sec';
      todos.dataset.sec = '-1';
      todos.setAttribute('aria-pressed', String(filtroSec < 0));
      grupo.appendChild(todos);
      anosLista.forEach(function (ano, k) {
        const n = D.secoes.reduce(function (t, sec, i) { return t + (anosSec[i] === ano ? sec.fotos.length : 0); }, 0);
        const b = botaoChip(ano, n);
        b.dataset.acao = 'filtro-sec';
        b.dataset.sec = String(k);
        b.setAttribute('aria-pressed', String(filtroSec === k));
        grupo.appendChild(b);
      });
      chips.appendChild(grupo);
    } else if (D.secoes.length > 1 && !filtroFav && !filtroNovas) {
      D.secoes.forEach(function (sec, k) {
        const b = botaoChip(sec.nome || 'Fotos', sec.fotos.length);
        b.dataset.acao = 'ir-sec';
        b.dataset.sec = String(k);
        chips.appendChild(b);
        chipsSec.push(b);
      });
      chipsSec[0].setAttribute('aria-current', 'true');
    }
    chipsAutores();
    const nNovas = fotos.filter(function (f) { return f.nova; }).length;
    if (nNovas) {
      const bn = botaoChip('Só as novas', nNovas);
      bn.dataset.acao = 'filtro-novas';
      bn.setAttribute('aria-pressed', String(filtroNovas));
      bn.title = 'Fotos que chegaram depois da sua última visita';
      chips.appendChild(bn);
    }
    chipFav = null;
    if (fav.size || filtroFav) {
      const b = botaoChip('Favoritas', fav.size);
      b.dataset.acao = 'filtro-fav';
      b.setAttribute('aria-pressed', String(filtroFav));
      b.title = 'Fica só neste aparelho';
      chips.appendChild(b);
      chipFav = b;
      if (filtroFav && fav.size) {
        const c = document.createElement('button');
        c.type = 'button';
        c.className = 'g-chip';
        c.dataset.acao = 'compartilhar-fav';
        c.title = 'Um link que abre a galeria só com estas fotos';
        c.textContent = 'Compartilhar as favoritas';
        chips.appendChild(c);
      }
    }
    chips.hidden = !chips.childElementCount;
    medeTopo();
    marcaAtiva();
  }
  function atualizaChips() {
    if (!chips) return;
    if (filtroLink) return;
    if (!!chipFav !== !!(fav.size || filtroFav)) { montaChips(); return; }
    const n = chipFav ? chipFav.querySelector('small') : null;
    if (n) n.textContent = String(fav.size);
  }
  const secVisiveis = new Set();
  function marcaAtiva() {
    if (!chipsSec.length) return;
    let ativa = -1;
    grades.forEach(function (g, k) { if (ativa < 0 && secVisiveis.has(g.sec)) ativa = k; });
    if (ativa < 0) return;
    chipsSec.forEach(function (b, k) {
      if (k === ativa) { b.setAttribute('aria-current', 'true'); centraChip(b); } else b.removeAttribute('aria-current');
    });
  }
  function centraChip(b) {
    if (!chips || chips.scrollWidth <= chips.clientWidth) return;
    const esq = b.getBoundingClientRect().left - chips.getBoundingClientRect().left + chips.scrollLeft;
    chips.scrollTo({ left: esq - (chips.clientWidth - b.offsetWidth) / 2, behavior: reduz() ? 'auto' : 'smooth' });
  }
  function observaSecoes() {
    if (typeof IntersectionObserver !== 'function') return;
    // Uma faixa estreita a 35% da altura da tela: a seção que a cruza é a atual.
    const io = new IntersectionObserver(function (es) {
      es.forEach(function (e) { if (e.isIntersecting) secVisiveis.add(e.target); else secVisiveis.delete(e.target); });
      marcaAtiva();
    }, { rootMargin: '-35% 0px -60% 0px' });
    grades.forEach(function (g) { io.observe(g.sec); });
  }
  function irParaSecao(k) {
    const g = grades[k];
    if (!g) return;
    g.sec.scrollIntoView({ behavior: reduz() ? 'auto' : 'smooth', block: 'start' });
    chipsSec.forEach(function (b, n) { if (n === k) b.setAttribute('aria-current', 'true'); else b.removeAttribute('aria-current'); });
  }

  // ---- Voltar ao topo ----
  const botaoTopo = document.getElementById('g-topo');
  let rolagem = 0;
  function atualizaTopo() {
    rolagem = 0;
    if (botaoTopo) botaoTopo.classList.toggle('on', window.scrollY > window.innerHeight * 2);
  }
  window.addEventListener('scroll', function () {
    if (!rolagem) rolagem = requestAnimationFrame(atualizaTopo);
  }, { passive: true });

  // ---- Visualizador (PhotoSwipe) ----
  /** @type {any} */
  let lightbox = null;
  /** @type {Promise<any> | null} */
  let carregandoLb = null;

  // ---- Vídeo no visualizador (item 1f): fachada, como o vídeo do YouTube ----
  // Nada do Google carrega antes do toque: o slide mostra a miniatura (lh3, a
  // mesma origem das fotos) e um botão de play. SÓ o toque coloca o iframe do
  // player do Drive (/file/d/ID/preview) no lugar, sem autoplay e com tela
  // cheia como única permissão. Sair do slide devolve a fachada (o vídeo para).
  const ID_DRIVE_RE = /^[A-Za-z0-9_-]{10,200}$/;
  function mostraFachada(box, f) {
    box.replaceChildren();
    box.classList.remove('sem-mini');
    const img = document.createElement('img');
    img.alt = f.alt;
    img.decoding = 'async';
    img.addEventListener('error', function () { img.remove(); box.classList.add('sem-mini'); });
    img.src = lh3(f.id, 1280);
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'g-vid-play';
    b.setAttribute('aria-label', 'Tocar o vídeo ' + semExt(f.nome));
    b.addEventListener('click', function (ev) { ev.stopPropagation(); tocaVideo(box, f); });
    box.appendChild(img);
    box.appendChild(b);
    if (f.dur > 0) {
      const d = document.createElement('span');
      d.className = 'g-vid-dur';
      d.textContent = fmtDur(f.dur);
      box.appendChild(d);
    }
  }
  function tocaVideo(box, f) {
    if (!ID_DRIVE_RE.test(f.id)) return;
    const fr = document.createElement('iframe');
    fr.src = 'https://drive.google.com/file/d/' + f.id + '/preview';
    fr.title = 'Vídeo ' + semExt(f.nome);
    fr.allow = 'fullscreen';
    fr.allowFullscreen = true;
    fr.referrerPolicy = 'strict-origin-when-cross-origin';
    box.replaceChildren(fr);
    fr.focus();
  }
  function montaVideo(f) {
    const box = document.createElement('div');
    box.className = 'pswp__content g-vid';
    mostraFachada(box, f);
    return box;
  }

  function dadosSlide(f) {
    if (f.video) {
      return {
        type: 'video',
        width: f.w || 1280,
        height: f.h || 720,
        msrc: f.img.currentSrc || undefined,
        alt: f.alt,
        element: f.el,
        foto: f,
      };
    }
    const maior = f.w || LONGO_ESTIMADO;
    const larguras = D.larguras.filter(function (x) { return x < maior; });
    larguras.push(maior);
    return {
      src: lh3(f.id, Math.min(maior, 1600)),
      srcset: larguras.map(function (x) { return lh3(f.id, x) + ' ' + x + 'w'; }).join(', '),
      width: f.w || LONGO_ESTIMADO,
      height: f.h || Math.round(LONGO_ESTIMADO / 1.5),
      msrc: f.img.currentSrc || undefined,
      alt: f.alt,
      element: f.el,
    };
  }

  const ICONE_BAIXAR = '<svg aria-hidden="true" class="pswp__icn" viewBox="0 0 32 32" width="32" height="32"><path d="M15 6h2v12.2l4.3-4.3 1.4 1.4-6.7 6.7-6.7-6.7 1.4-1.4 4.3 4.3zM8 24h16v2H8z"/></svg>';
  const ICONE_CAPA = '<svg aria-hidden="true" class="pswp__icn" viewBox="0 0 32 32" width="32" height="32"><path d="M7 8h18v16H7zM9 10v9.6l4.5-4.6 3.5 3.5 2.5-2.5L23 19.5V10z"/><circle cx="20" cy="13" r="1.6"/></svg>';
  const ICONE_BAIXAR_SVG = '<svg viewBox="0 0 32 32" fill="currentColor"><path d="M15 6h2v12.2l4.3-4.3 1.4 1.4-6.7 6.7-6.7-6.7 1.4-1.4 4.3 4.3zM8 24h16v2H8z"/></svg>';
  const ICONE_CORACAO_PSWP = '<svg aria-hidden="true" class="pswp__icn" viewBox="0 0 32 32" width="32" height="32"><path d="M16 27.500 14.300 26C8.600 20.900 5 17.700 5 13.600 5 10.400 7.500 8 10.600 8c1.800 0 3.500.8 4.600 2.100l.8.9.8-.9C18 8.800 19.700 8 21.500 8 24.500 8 27 10.400 27 13.600c0 4.100-3.600 7.300-9.300 12.400z"/></svg>';
  const ICONE_COMPARTILHAR = '<svg aria-hidden="true" class="pswp__icn" viewBox="0 0 32 32" width="32" height="32"><path d="M16 5l6 6-1.400 1.400L17 8.800V20h-2V8.800l-3.600 3.600L10 11zM8 15h4v2h-2v9h12v-9h-2v-2h4v13H8z"/></svg>';
  const ICONE_OCULTAR = '<svg aria-hidden="true" class="pswp__icn" viewBox="0 0 32 32" width="32" height="32"><path d="M16 9c-5.500 0-9.300 4.400-10.500 7 1.200 2.600 5 7 10.500 7s9.300-4.400 10.500-7C25.300 13.400 21.500 9 16 9zm0 11.500a4.500 4.500 0 1 1 0-9 4.500 4.500 0 0 1 0 9zM6.400 5 5 6.400 25.600 27 27 25.600z"/></svg>';
  const ICONE_SEL = '<svg aria-hidden="true" class="pswp__icn" viewBox="0 0 32 32" width="32" height="32"><path d="M16 6a10 10 0 1 0 0 20 10 10 0 0 0 0-20zm-1.5 14.6-4.6-4.6 1.4-1.4 3.2 3.2 6.6-6.6 1.4 1.4z"/></svg>';

  // ---- Voltar fecha a camada de cima, como num app ----
  // O visualizador e a folha de download empilham UMA entrada cada no
  // histórico. O "voltar" — botão do Android, gesto do iPhone, tecla do
  // navegador — fecha só a camada de cima, em vez de sair da galeria. Com
  // replaceState puro, o voltar com uma foto aberta levava de volta ao painel.
  // O ouvinte do popstate mora no fim, depois da folha existir.
  function noTopo(marca) {
    return !!(history.state && history.state.g === marca);
  }

  // O CSS do visualizador, antes do <style> da página: a mesma ordem de
  // cascata de quando ele vinha no <head> (as regras .pswp da página vencem).
  function carregaCssLb() {
    return new Promise(function (pronto) {
      const l = document.createElement('link');
      l.rel = 'stylesheet';
      l.href = D.css;
      l.addEventListener('load', function () { pronto(true); });
      l.addEventListener('error', function () { pronto(false); });
      document.head.insertBefore(l, document.head.querySelector('style'));
    });
  }

  // Slide de vídeo: sem zoom: a lupa some (classe na raiz do PhotoSwipe).
  function marcaTipoDoSlide() {
    const pswp = lightbox && lightbox.pswp;
    if (!pswp || !pswp.element) return;
    const f = vistas[pswp.currIndex];
    pswp.element.classList.toggle('g-eh-video', !!(f && f.video));
  }

  function preparaLightbox() {
    if (carregandoLb) return carregandoLb;
    const urlLb = D.lightbox;
    const urlCore = D.core;
    carregandoLb = Promise.all([import(urlLb), carregaCssLb()]).then(function (r) {
      const PhotoSwipeLightbox = r[0].default;
      lightbox = new PhotoSwipeLightbox({
        dataSource: [],
        pswpModule: function () { return import(urlCore); },
        bgOpacity: 1,
        wheelToZoom: true,
        preload: [1, 2],
        showHideAnimationType: 'zoom',
        closeTitle: 'Fechar (Esc)',
        zoomTitle: 'Ampliar (Z)',
        arrowPrevTitle: 'Anterior',
        arrowNextTitle: 'Próxima',
        errorMsg: 'A foto não carregou.',
        indexIndicatorSep: ' de ',
        // O dono tem um botão a mais (ocultar). Em celular estreito, a lupa
        // sai para a barra caber sem espremer o contador: ali o zoom é pinça
        // e toque duplo.
        zoom: !(D.dono && toqueEstreito()),
      });
      lightbox.addFilter('numItems', function () { return vistas.length; });
      lightbox.addFilter('itemData', function (_d, index) { return dadosSlide(vistas[index]); });
      // Slide de vídeo: a fachada no lugar do <img> (e, ao sair do slide, o
      // player some e ela volta).
      lightbox.on('contentLoad', function (e) {
        const dados = e.content.data;
        if (dados && dados.type === 'video' && dados.foto) {
          e.preventDefault();
          e.content.element = montaVideo(dados.foto);
        }
      });
      lightbox.on('contentDeactivate', function (e) {
        const dados = e.content.data;
        const el = e.content.element;
        if (dados && dados.type === 'video' && dados.foto && el && el.querySelector('iframe')) mostraFachada(el, dados.foto);
      });
      lightbox.on('uiRegister', registraUi);
      // Link direto para a foto aberta (?foto=código, v3.9.0): copiar a barra de endereço
      // e mandar para alguém (ou abrir noutra aba) cai na mesma foto. Abrir
      // EMPILHA uma entrada (o "voltar" fecha a foto — ver o popstate acima);
      // trocar de foto só reescreve a entrada, senão o voltar andaria foto
      // por foto.
      lightbox.on('afterInit', function () {
        vendo = true;
        document.body.classList.add('g-vendo');
        const f = vistas[lightbox.pswp.currIndex];
        if (f) history.pushState({ g: 'foto' }, '', enderecoDaFoto(f.id));
        marcaTipoDoSlide();
      });
      lightbox.on('destroy', function () {
        vendo = false;
        document.body.classList.remove('g-vendo');
        // Favorita tirada com a foto aberta: a grade filtrada se refaz agora.
        if (filtroFav) {
          if (!fav.size) ligaFiltroFav(false);
          else { recalculaVistas(); agendaDiagrama(); }
        }
      });
      lightbox.on('change', function () {
        const f = vistas[lightbox.pswp.currIndex];
        if (f && noTopo('foto')) history.replaceState(history.state, '', enderecoDaFoto(f.id));
        marcaTipoDoSlide();
      });
      lightbox.on('close', function () {
        // Fechou pela interface (×, Esc, arrastar): tira a entrada que a
        // abertura pôs. Fechou pelo voltar: ela já saiu.
        if (noTopo('foto')) history.back();
        const f = lightbox.pswp ? vistas[lightbox.pswp.currIndex] : null;
        if (f) f.el.focus({ preventScroll: true });
      });
      lightbox.init();
      return lightbox;
    });
    return carregandoLb;
  }

  /** @type {() => void} */
  let sincronizaFavUi = function () {};
  /** @type {() => void} */
  let sincronizaOcultaUi = function () {};

  // ---- Ocultar dos visitantes (só o dono) ----
  // Uma foto por vez, gravada no servidor na hora: o visitante deixa de
  // receber a foto na lista e o download dela vira 404. A foto segue no Drive.
  let ocultando = false;
  function alternaOculta(f) {
    if (ocultando) return;
    ocultando = true;
    const querOculta = !ocultas.has(f.id);
    fetch('/api/galeria/ocultar', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ slug: D.slug, cap: D.cap, foto: f.id, oculta: querOculta }),
    }).then(function (r) {
      return r.json().catch(function () { return {}; }).then(function (j) {
        if (!r.ok) throw new Error(j.error || ('Erro ' + r.status));
        return j;
      });
    }).then(function (j) {
      ocultas.clear();
      (j.ocultas || []).forEach(function (id) { ocultas.add(id); });
      pendentes.clear();
      (j.pendentes || []).forEach(function (id) { pendentes.add(id); });
      fotos.forEach(pintaOculta);
      const n = document.getElementById('g-n-ocultas');
      if (n) n.textContent = textoOcultas();
      sincronizaOcultaUi();
      avisa(querOculta ? 'Oculta para os visitantes (some para todos em até 2 min)' : 'Visível de novo para os visitantes');
    }).catch(function (e) {
      avisa(e && e.message ? e.message : 'Não deu para gravar. Tente de novo.');
    }).then(function () { ocultando = false; });
  }
  /** @type {() => void} */
  let sincronizaCapaUi = function () {};
  function registraUi() {
    const pswp = lightbox.pswp;
    pswp.ui.registerElement({
      name: 'g-fav', order: 7, isButton: true, title: 'Favoritar (F)', html: ICONE_CORACAO_PSWP,
      onInit: function (el, p) {
        sincronizaFavUi = function () {
          const f = vistas[p.currIndex];
          const on = !!f && fav.has(f.id);
          el.classList.toggle('on', on);
          el.setAttribute('aria-pressed', String(on));
        };
        p.on('change', sincronizaFavUi);
        // "Continuar de onde parou" (v3.8.0): a última foto aberta, só neste
        // aparelho; a página principal do álbum oferece voltar a ela.
        p.on('change', function () {
          const f = vistas[p.currIndex];
          if (!f || !D.cap) return;
          try { localStorage.setItem('gal-ultima:' + D.slug, JSON.stringify({ cap: D.cap, nome: DX.capNome || '', id: f.id, em: Date.now() })); } catch (e) { /* sem armazenamento */ }
        });
        sincronizaFavUi();
      },
      onClick: function (_e, _el, p) {
        const f = vistas[p.currIndex];
        if (!f) return;
        alternaFav(f);
        sincronizaFavUi();
      },
    });
    pswp.ui.registerElement({
      name: 'g-sel', order: 8, isButton: true, title: 'Selecionar esta foto', html: ICONE_SEL,
      onInit: function (el, p) {
        const sync = function () {
          const f = vistas[p.currIndex];
          const on = !!f && sel.has(f.id);
          el.classList.toggle('on', on);
          el.setAttribute('aria-pressed', String(on));
        };
        p.on('change', sync);
        sync();
      },
      onClick: function (_e, el, p) {
        const f = vistas[p.currIndex];
        if (!f) return;
        alternaSel(f);
        el.classList.toggle('on', sel.has(f.id));
        el.setAttribute('aria-pressed', String(sel.has(f.id)));
        avisa(sel.has(f.id) ? 'Adicionada à seleção' : 'Removida da seleção');
      },
    });
    pswp.ui.registerElement({
      name: 'g-baixar', order: 9, isButton: true, title: 'Baixar', html: ICONE_BAIXAR,
      onClick: function (_e, _el, p) {
        const f = vistas[p.currIndex];
        if (f) abreFolha([f]);
      },
    });
    pswp.ui.registerElement({
      name: 'g-compartilhar', order: 10, isButton: true, title: 'Compartilhar', html: ICONE_COMPARTILHAR,
      onClick: function (_e, _el, p) {
        const f = vistas[p.currIndex];
        if (f) compartilhaFoto(f);
      },
    });
    if (D.dono && D.cap) {
      // "Usar como capa do evento" (v3.8.0): a foto vira a capa do cartão do
      // evento na página do álbum; tocar de novo volta à automática.
      pswp.ui.registerElement({
        name: 'g-capa', order: 12, isButton: true, title: 'Usar como capa do evento', html: ICONE_CAPA,
        onInit: function (el, p) {
          const sync = function () {
            const f = vistas[p.currIndex];
            const on = !!f && DX.capa === f.id;
            el.classList.toggle('on', on);
            el.setAttribute('aria-pressed', String(on));
            el.title = on ? 'É a capa do evento: toque para voltar à automática' : 'Usar como capa do evento';
            el.setAttribute('aria-label', el.title);
          };
          p.on('change', sync);
          sync();
          sincronizaCapaUi = sync;
        },
        onClick: function (_e, el, p) {
          const f = vistas[p.currIndex];
          if (!f) return;
          const nova = DX.capa === f.id ? '' : f.id;
          fetch('/api/galeria/capa', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ slug: D.slug, cap: D.cap, foto: nova }) })
            .then(function (r) { if (!r.ok) throw new Error('Erro ' + r.status); DX.capa = nova; sincronizaCapaUi(); avisa(nova ? 'Agora é a capa do evento' : 'Capa automática de novo'); })
            .catch(function () { avisa('Não deu para trocar a capa. Tente de novo.'); });
        },
      });
    }
    if (D.dono) {
      pswp.ui.registerElement({
        name: 'g-ocultar', order: 11, isButton: true, title: 'Ocultar dos visitantes', html: ICONE_OCULTAR,
        onInit: function (el, p) {
          const sync = function () {
            const f = vistas[p.currIndex];
            const on = !!f && ocultas.has(f.id);
            el.classList.toggle('on', on);
            el.setAttribute('aria-pressed', String(on));
            el.title = on ? 'Oculta: toque para mostrar aos visitantes' : 'Ocultar dos visitantes';
            el.setAttribute('aria-label', el.title);
          };
          sincronizaOcultaUi = sync;
          p.on('change', sync);
          sync();
        },
        onClick: function (_e, _el, p) {
          const f = vistas[p.currIndex];
          if (f) alternaOculta(f);
        },
      });
    }
    // "Baixar" grande e na cor do destaque no canto de baixo (v3.8.0): é o que
    // a maioria quer fazer com a foto aberta. O ícone da barra continua.
    pswp.ui.registerElement({
      name: 'g-baixar-grande', order: 10, isButton: true, appendTo: 'root', title: 'Baixar esta foto',
      html: '<span class="g-bg-ic" aria-hidden="true">' + ICONE_BAIXAR_SVG + '</span><span>Baixar</span>',
      onClick: function (_e, _el, p) {
        const f = vistas[p.currIndex];
        if (f) abreFolha([f]);
      },
    });
    pswp.ui.registerElement({
      name: 'g-legenda', order: 9, isButton: false, appendTo: 'root', html: '',
      onInit: function (el, p) {
        // A legenda (texto) e, só para o visitante, o link discreto "Pedir
        // remoção" logo abaixo dela. O contêiner não recebe toque (pointer-events
        // none: não atrapalha o gesto na foto); só o botão recebe.
        const txt = document.createElement('span');
        txt.className = 'g-leg-t';
        el.appendChild(txt);
        if (D.remocao) {
          const b = document.createElement('button');
          b.type = 'button';
          b.className = 'g-rem-link';
          b.dataset.acao = 'pedir-remocao';
          b.textContent = 'Pedir remoção';
          b.title = 'Pedir para tirar esta foto da galeria';
          el.appendChild(b);
        }
        const sync = function () {
          const f = vistas[p.currIndex];
          if (!f) return;
          const secao = D.secoes.length > 1 ? D.secoes[f.s].nome : '';
          txt.textContent = semExt(f.nome) + (secao ? ' · ' + secao : '');
          const tipo = f.video ? 'Vídeo' + (f.dur > 0 ? ' · ' + fmtDur(f.dur) : '') : f.live ? 'Live Photo' : '';
          if (tipo) {
            const t = document.createElement('span');
            t.className = 'g-leg-a';
            t.textContent = tipo;
            txt.appendChild(t);
          }
          const quem = D.autores && D.autores[f.autor];
          if (quem) {
            // O crédito em destaque (v3.8.0): quem fotografou, maior e claro.
            const l = document.createElement('span');
            l.className = 'g-leg-autor';
            l.textContent = (f.video ? 'Vídeo de ' : 'Foto de ') + quem;
            txt.insertBefore(l, txt.firstChild);
          }
        };
        p.on('change', sync);
        sync();
      },
    });
  }

  function toqueEstreito() {
    try { return matchMedia('(pointer: coarse) and (max-width: 419px)').matches; } catch (e) { return false; }
  }

  function abre(i) {
    preparaLightbox().then(function (lb) { lb.loadAndOpen(Math.max(0, i)); }).catch(function () {
      avisa('O visualizador não carregou. Recarregue a página.');
    });
  }

  // ---- Downloads ----
  // O arquivo baixado é SEMPRE o do Drive: os mesmos bytes e o mesmo nome. O
  // site não redimensiona, não renomeia, não recodifica. "Tamanho máximo" é o
  // original da pasta do projeto; "para redes" é o arquivo de mesmo nome da
  // pasta do Instagram (f.redes), só nas fotos que têm par lá.
  //
  // Como o arquivo chega ao aparelho:
  //  - Android e computador: download comum (<a download>) — o navegador salva
  //    o arquivo e pronto. Nada de folha de compartilhamento.
  //  - iPhone e iPad: o download comum cai no app Arquivos, longe do Fotos. O
  //    melhor caminho do iOS é a folha do sistema com o ARQUIVO ("Salvar
  //    imagem" põe direto no Fotos, "Salvar N imagens" idem): botão "Salvar no
  //    Fotos". "Baixar arquivo" segue disponível (Arquivos).
  const LOTE_MAX_FOTOS = 20;
  const LOTE_MAX_BYTES = 80e6;

  // A ÚNICA checagem de plataforma da página (de resto vale detectar recurso,
  // nunca modelo de aparelho). Aqui não dá: canShare({ files }) existe no
  // Android, no iOS e no desktop, e só o iOS tem o "Salvar imagem" que põe a
  // foto no Fotos. Safari e Chrome do iOS são ambos WebKit, e o iPadOS finge
  // ser um Mac (plataforma MacIntel) mas é o único "Mac" com tela de toque. O
  // userAgentData não ajuda: o WebKit não o tem. A regra de "não decidir por
  // aparelho" vale para a RESOLUÇÃO das imagens, que segue por pixels físicos.
  function ehIOS() {
    try {
      if (/iP(hone|ad|od)/.test(navigator.userAgent || '')) return true;
      return navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1;
    } catch (e) { return false; }
  }
  const IOS = ehIOS();
  function podeCompartilharArquivos(arquivos) {
    try { return typeof navigator.canShare === 'function' && navigator.canShare({ files: arquivos }); } catch (e) { return false; }
  }
  function aceitaArquivoDeTeste() {
    try { return podeCompartilharArquivos([new File(['x'], 'x.jpg', { type: 'image/jpeg' })]); } catch (e) { return false; }
  }
  // iOS 15+ com Web Share de arquivo: sem isso, só "Baixar arquivo".
  const salvaNoFotos = IOS && aceitaArquivoDeTeste();

  const folha = document.getElementById('g-folha');
  const folhaT = document.getElementById('g-folha-t');
  const folhaOps = document.getElementById('g-folha-ops');
  const folhaMsg = document.getElementById('g-folha-msg');
  /** @type {Element | null} */
  let focoAntes = null;
  let geracao = 0;

  // semConta (c=0): o pedido NÃO é um download para a contagem de baixadas —
  // o botão Compartilhar do visualizador, e a nova busca de um arquivo que o
  // iPhone recusou salvar no Fotos (a primeira busca dele já contou). O
  // servidor serve o mesmo arquivo; só não soma em "Fotos baixadas".
  function urlBaixar(f, v, semConta) {
    return '/galeria/' + encodeURIComponent(D.slug) + (D.cap ? '/' + encodeURIComponent(D.cap) : '') + '/baixar/' + f.id + '?v=' + v + (semConta ? '&c=0' : '');
  }
  // ---- Fila de download (item 1g.4a) ----
  // O Google pode recusar o arquivo quando ele é muito baixado (o servidor
  // responde 503 "ocupado" com Retry-After; o limite por IP responde 429).
  // Nenhum erro cru: o botão vira "Na fila…", conta os segundos e tenta de
  // novo sozinho, com intervalo crescente, por até ~5 min. Uma tentativa por
  // vez nesta aba (filaViva). "Cancelar" e fechar a janela encerram a fila.
  const FILA_MAX_S = 300;
  const FILA_PASSO_MAX_S = 120;
  let filaViva = false;
  let filaCancelada = false;
  function segundosDe(r) {
    const s = Number.parseInt(r.headers.get('Retry-After') || '', 10);
    return s > 0 ? Math.min(s, FILA_PASSO_MAX_S) : 30;
  }
  // Pergunta "está pronto?" sem baixar o arquivo (?p=1: o servidor pede só o
  // primeiro byte ao Drive e responde 204). Rede fora ou resposta estranha:
  // segue para o download direto, como antes da fila.
  async function sondaDownload(f, v) {
    let r;
    try { r = await fetch(urlBaixar(f, v, true) + '&p=1', { credentials: 'same-origin' }); } catch (e) { return { ok: true }; }
    if (r.status === 204 || r.status === 200) return { ok: true };
    if (r.status === 429 || r.status === 503) return { espera: segundosDe(r) };
    let msg = '';
    try { msg = (await r.json()).error || ''; } catch (e) { msg = ''; }
    return { erro: msg || 'Não foi possível baixar esta foto agora.' };
  }
  function rotuloDoBotao(botao, texto) {
    if (!botao) return;
    const forte = botao.querySelector('strong');
    const alvo = forte || botao;
    if (!botao.dataset.orig) botao.dataset.orig = alvo.textContent || '';
    alvo.textContent = texto === null ? botao.dataset.orig : texto;
    if (texto === null) delete botao.dataset.orig;
  }
  // Espera s segundos mostrando a contagem no botão; a mensagem da folha (que
  // é aria-live) muda só de 10 em 10 s, para o leitor de tela não narrar cada
  // segundo. Devolve false se cancelaram ou fecharam a janela.
  function esperaNaFila(s, minha, botao) {
    return new Promise(function (resolve) {
      let resta = Math.ceil(s);
      const passo = function () {
        if (minha !== geracao || filaCancelada) { resolve(false); return; }
        if (resta <= 0) { resolve(true); return; }
        rotuloDoBotao(botao, 'Na fila… tentando de novo em ' + resta + ' s');
        if (folhaMsg && (resta === Math.ceil(s) || resta % 10 === 0)) folhaMsg.textContent = 'Muita gente baixando agora. Você está na fila: tentamos de novo sozinhos. Deixe esta janela aberta.';
        resta--;
        setTimeout(passo, 1000);
      };
      passo();
    });
  }
  // Cada espera é a anterior x1,5 (limite FILA_PASSO_MAX_S) com ±20% de jitter.
  function proximaEspera(anterior) {
    const base = Math.min(FILA_PASSO_MAX_S, Math.max(anterior, anterior * 1.5));
    return Math.max(5, Math.round(base * (0.8 + Math.random() * 0.4)));
  }
  function botaoCancelarFila() {
    const c = document.createElement('button');
    c.type = 'button';
    c.className = 'g-btn';
    c.textContent = 'Cancelar';
    c.setAttribute('data-acao', 'cancela-fila');
    c.addEventListener('click', function () { filaCancelada = true; });
    return c;
  }
  // O mesmo para quem busca o arquivo na memória (iPhone, "Salvar no Fotos"):
  // 503/429 viram espera na fila e nova tentativa, não erro.
  async function buscaNaFila(f, v, minha, botao) {
    const inicio = Date.now();
    let espera = 0;
    filaViva = true;
    filaCancelada = false;
    const cancelar = botaoCancelarFila();
    let mostrouCancelar = false;
    try {
      for (;;) {
        try {
          return await buscaArquivo(f, v);
        } catch (e) {
          if (!e || !e.espera) throw e;
          if (Date.now() - inicio > FILA_MAX_S * 1000) throw new Error('Continua muito movimentado. Tente de novo daqui a alguns minutos.');
          espera = espera ? proximaEspera(espera) : e.espera;
          if (!mostrouCancelar && folhaOps) { folhaOps.appendChild(cancelar); mostrouCancelar = true; }
          if (!await esperaNaFila(espera, minha, botao)) throw new Error(minha !== geracao ? 'Cancelado.' : 'Cancelado. Toque para tentar de novo.');
        }
      }
    } finally {
      filaViva = false;
      rotuloDoBotao(botao, null);
      if (mostrouCancelar) cancelar.remove();
    }
  }
  // Baixa a lista, UM arquivo por vez: sonda; se estiver ocupado, espera na
  // fila e sonda de novo; se estiver pronto, dispara o download direto (o mesmo
  // <a download> de sempre). Devolve true se todos saíram.
  async function baixaNaFila(lista, v, jaContadas, minha, botao) {
    filaViva = true;
    filaCancelada = false;
    const cancelar = botaoCancelarFila();
    let mostrouCancelar = false;
    const inicio = Date.now();
    let feitos = 0;
    try {
      for (let k = 0; k < lista.length; k++) {
        const f = lista[k];
        let espera = 0;
        for (;;) {
          if (minha !== geracao || filaCancelada) return false;
          const s = await sondaDownload(f, v);
          if (minha !== geracao || filaCancelada) return false;
          if (s.erro) { if (folhaMsg) folhaMsg.textContent = s.erro; return false; }
          if (s.ok) break;
          if (Date.now() - inicio > FILA_MAX_S * 1000) {
            if (folhaMsg) folhaMsg.textContent = 'Continua muito movimentado. Tente de novo daqui a alguns minutos' + (feitos ? ' (' + feitos + ' de ' + lista.length + ' já saíram).' : '.');
            return false;
          }
          espera = espera ? proximaEspera(espera) : s.espera;
          if (!mostrouCancelar && folhaOps) { folhaOps.appendChild(cancelar); mostrouCancelar = true; }
          if (!await esperaNaFila(espera, minha, botao)) return false;
        }
        rotuloDoBotao(botao, null);
        linkDireto(urlBaixar(f, v, !!jaContadas && jaContadas.has(f.id)), D.amigavel ? arquivoDe(f, v).nome : '');
        feitos++;
        if (k + 1 < lista.length) await new Promise(function (r) { setTimeout(r, 700); });
      }
      return true;
    } finally {
      filaViva = false;
      rotuloDoBotao(botao, null);
      if (mostrouCancelar) cancelar.remove();
    }
  }

  // O que a versão entrega para a foto: nome e peso do arquivo (ou null).
  // Com "nomes amigáveis" o nome é o que o servidor vai pôr no
  // Content-Disposition: prefixo da seção + cauda da foto + extensão do
  // arquivo entregue (nomes.js; mesmo cálculo, a lista vem pronta do servidor).
  function extDoNome(n) {
    const m = String(n || '').match(/[.]([A-Za-z0-9]{1,8})$/);
    if (!m) return '';
    const e = m[1].toLowerCase();
    return e === 'jpeg' ? 'jpg' : e;
  }
  function nomeAmigavelDe(f, nome) {
    if (!D.amigavel || !f.cauda) return nome;
    const ext = extDoNome(nome);
    return D.amigavel[f.s] + f.cauda + (ext ? '.' + ext : '');
  }
  function arquivoDe(f, v) {
    const a = v === 'redes' ? f.redes : { nome: f.nome, bytes: f.bytes };
    return a ? { nome: nomeAmigavelDe(f, a.nome), bytes: a.bytes } : a;
  }
  function daVersao(lista, v) {
    return v === 'redes' ? lista.filter(function (f) { return !!f.redes; }) : lista;
  }
  function somaBytes(lista, v) {
    return lista.reduce(function (t, f) { const a = arquivoDe(f, v); return t + (a && a.bytes ? a.bytes : 0); }, 0);
  }
  function linkDireto(url, nome) {
    const a = document.createElement('a');
    a.href = url;
    a.download = nome || '';
    // Download passa pelo Worker (cota do Drive): nada de robô seguindo.
    a.rel = 'nofollow';
    document.body.appendChild(a);
    a.click();
    a.remove();
  }
  const TIPOS = { jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', webp: 'image/webp', heic: 'image/heic', heif: 'image/heif', gif: 'image/gif', tif: 'image/tiff', tiff: 'image/tiff', mov: 'video/quicktime', mp4: 'video/mp4', m4v: 'video/mp4' };
  // "Salvar no Fotos" segura o arquivo INTEIRO na memória da aba do Safari:
  // vídeo acima disto só sai como "Baixar arquivo" (o download vai direto para
  // o disco, em fluxo).
  const VIDEO_FOTOS_MAX = 100e6;
  // Os bytes vêm como o servidor mandou; o nome é o do Drive (X-Nome-Arquivo).
  // O tipo só diz à folha do sistema que é imagem (se o Drive mandou
  // octet-stream, vale a extensão) — não toca em byte nenhum.
  async function buscaArquivo(f, v, semConta) {
    const r = await fetch(urlBaixar(f, v, semConta), { credentials: 'same-origin' });
    if (r.status === 429 || r.status === 503) {
      // Fila (item 1g): quem chamou decide se espera e tenta de novo.
      const e = /** @type {any} */ (new Error('Muita gente baixando esta foto agora. Tente de novo em alguns minutos.'));
      e.espera = segundosDe(r);
      throw e;
    }
    if (!r.ok) {
      let msg = '';
      try { msg = (await r.json()).error || ''; } catch (e) { msg = ''; }
      throw new Error(msg || 'O Google recusou a foto (' + r.status + ').');
    }
    const blob = await r.blob();
    let nome = '';
    try { nome = decodeURIComponent(r.headers.get('X-Nome-Arquivo') || ''); } catch (e) { nome = ''; }
    nome = nome || arquivoDe(f, v).nome;
    let tipo = blob.type;
    if (!tipo || (tipo.indexOf('image/') !== 0 && tipo.indexOf('video/') !== 0)) {
      const ext = (nome.match(/[.]([A-Za-z0-9]+)$/) || [])[1];
      tipo = (ext && TIPOS[ext.toLowerCase()]) || (f.video ? 'video/mp4' : 'image/jpeg');
    }
    return new File([blob], nome, { type: tipo });
  }

  function opcao(titulo, detalhe) {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'g-op';
    const t = document.createElement('strong');
    t.textContent = titulo;
    const d = document.createElement('span');
    d.textContent = detalhe;
    b.appendChild(t);
    b.appendChild(d);
    return b;
  }
  function botaoAcao(texto, primario) {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'g-btn' + (primario ? ' g-prim' : '');
    b.textContent = texto;
    return b;
  }

  // Texto de cada versão na folha. Nome e peso são os do arquivo que SERÁ
  // baixado; com várias fotos, "para redes" diz quantas têm a versão.
  function detalheDaVersao(lista, v) {
    const com = daVersao(lista, v);
    const total = somaBytes(com, v);
    if (lista.length === 1) {
      const f = lista[0];
      const a = arquivoDe(f, v);
      const dim = v === 'max' && f.w && !f.estimada && !f.video ? ' · ' + f.w + ' × ' + f.h + ' px' : '';
      return (v === 'redes' ? 'Da pasta do Instagram, sem alteração · ' : 'O arquivo original · ') + a.nome + dim + (a.bytes ? ' · ' + fmtBytes(a.bytes) : '');
    }
    if (v === 'redes') {
      const so = com.length === lista.length ? 'As ' + lista.length + ' fotos' : com.length + ' de ' + lista.length + ' fotos têm esta versão (as outras ficam de fora)';
      return so + ' · arquivos da pasta do Instagram, sem alteração' + (total ? ' · ' + fmtBytes(total) + ' no total' : '');
    }
    return 'Os arquivos originais, sem alteração' + (total ? ' · ' + fmtBytes(total) + ' no total' : '');
  }

  function abreFolha(lista) {
    if (!folha || !folhaT || !folhaOps || !folhaMsg || !lista.length) return;
    geracao++;
    if (folha.hidden) focoAntes = document.activeElement;
    const soVideos = lista.every(function (f) { return f.video; });
    const temVideo = lista.some(function (f) { return f.video; });
    folhaT.textContent = lista.length === 1 ? 'Baixar ' + semExt(arquivoDe(lista[0], 'max').nome) : 'Baixar ' + lista.length + (temVideo ? ' arquivos' : ' fotos');
    folhaMsg.textContent = IOS && salvaNoFotos ? 'No iPhone: toque em Salvar no Fotos e, na janela que abrir, em Salvar ' + (soVideos ? 'vídeo' : 'imagem') + '.' : '';
    folhaOps.replaceChildren();
    const um = lista.length === 1 ? lista[0] : null;
    // "Para redes" só entra se ao menos uma foto da lista tem a versão.
    const versoes = daVersao(lista, 'redes').length ? [['redes', 'Para redes sociais'], ['max', 'Tamanho máximo']] : [['max', 'Tamanho máximo']];
    /** @type {HTMLElement | null} */
    let primeiro = null;
    versoes.forEach(function (par) {
      const v = par[0];
      const el = IOS ? blocoIOS(lista, v, par[1]) : blocoComum(lista, v, par[1]);
      folhaOps.appendChild(el.raiz);
      if (!primeiro) primeiro = el.foco;
    });
    // Live Photo (item 1f): o vídeo de poucos segundos que acompanha a foto,
    // como arquivo à parte. Mesmo caminho do download de qualquer arquivo.
    if (um && um.live) {
      const lv = {
        id: um.live.id, w: 0, h: 0, nome: um.live.nome, bytes: um.live.bytes, redes: null, autor: um.autor, cauda: um.cauda,
        s: um.s, el: um.el, img: um.img, estimada: true, alt: um.alt, video: true, dur: 0, live: null,
      };
      const el = IOS ? blocoIOS([lv], 'max', 'Baixar vídeo do Live Photo') : blocoComum([lv], 'max', 'Baixar vídeo do Live Photo');
      folhaOps.appendChild(el.raiz);
    }
    mostraFolha(/** @type {HTMLElement} */ (primeiro));
  }

  // Android e computador: um botão por versão, o toque baixa.
  function blocoComum(lista, v, titulo) {
    const b = opcao(titulo, detalheDaVersao(lista, v));
    b.addEventListener('click', function () { baixaComum(daVersao(lista, v), v, null, false, b); });
    return { raiz: b, foco: b };
  }

  // iPhone e iPad: a versão com "Salvar no Fotos" (principal) e "Baixar
  // arquivo" (Arquivos).
  function blocoIOS(lista, v, titulo) {
    const raiz = document.createElement('div');
    raiz.className = 'g-ver';
    const t = document.createElement('div');
    t.className = 'g-ver-t';
    const st = document.createElement('strong');
    st.textContent = titulo;
    const sd = document.createElement('span');
    sd.textContent = detalheDaVersao(lista, v);
    t.appendChild(st);
    t.appendChild(sd);
    raiz.appendChild(t);
    const acoes = document.createElement('div');
    acoes.className = 'g-ver-a';
    const alvo = daVersao(lista, v);
    const grande = alvo.some(function (f) { return f.video && f.bytes > VIDEO_FOTOS_MAX; });
    const baixar = botaoAcao('Baixar arquivo', !salvaNoFotos || grande);
    baixar.addEventListener('click', function () { baixaComum(alvo, v, null, false, baixar); });
    let foco = baixar;
    if (grande) {
      const aviso = document.createElement('span');
      aviso.textContent = 'Vídeo grande: baixe como arquivo (app Arquivos) e salve no Fotos de lá.';
      t.appendChild(aviso);
    }
    if (salvaNoFotos && !grande) {
      const rotulo = alvo.length > 1 ? 'Salvar ' + alvo.length + ' fotos no Fotos' : 'Salvar no Fotos';
      const salvar = botaoAcao(rotulo, true);
      // Quando o arquivo está pronto, o próximo toque é de quem o espera (o
      // iOS só abre a folha dentro de um toque).
      /** @type {(() => void) | null} */
      let aoToque = null;
      salvar.addEventListener('click', function () {
        if (aoToque) { const f = aoToque; aoToque = null; f(); return; }
        salvarNoFotos(alvo, v, salvar, rotulo, function (f) { aoToque = f; });
      });
      acoes.appendChild(salvar);
      foco = salvar;
    }
    acoes.appendChild(baixar);
    raiz.appendChild(acoes);
    return { raiz: raiz, foco: foco };
  }

  // Reaberta por cima de si mesma, não empilha.
  function mostraFolha(primeiro) {
    if (!folha) return;
    if (folha.hidden) history.pushState({ g: 'folha' }, '', location.href);
    folha.hidden = false;
    primeiro.focus();
  }

  function favoritas() {
    return fotos.filter(function (f) { return fav.has(f.id); });
  }

  // "Baixar tudo" (v3.7.2): pelo próprio site, a mesma fila do "Baixar"
  // da seleção (uma por vez, espera quando o Google segura, lotes no iPhone).
  // Com filtro ligado (um ano, um fotógrafo), o que está na tela.
  function abreFolhaTudo() {
    if (!folha || !folhaT || !folhaOps || !folhaMsg) return;
    geracao++;
    if (folha.hidden) focoAntes = document.activeElement;
    folhaT.textContent = 'Baixar tudo';
    folhaMsg.textContent = '';
    folhaOps.replaceChildren();
    /** @type {HTMLElement | null} */
    let primeiro = null;
    const naTela = vistas.length ? vistas : fotos;
    if (naTela.length) {
      const filtrado = naTela.length !== fotos.length;
      const n = naTela.length;
      const b = opcao(filtrado ? 'Baixar as ' + n + ' da tela' : 'Baixar todas (' + n + ')', filtrado ? 'Só o que o filtro mostra · você escolhe o tamanho' : 'Uma por vez, pelo site · você escolhe o tamanho');
      b.addEventListener('click', function () { abreFolha(naTela.slice()); });
      folhaOps.appendChild(b);
      primeiro = b;
    }
    if (fav.size) {
      const b = opcao('Baixar as favoritas (' + fav.size + ')', 'Fica só neste aparelho · você escolhe o tamanho');
      b.addEventListener('click', function () { abreFolha(favoritas()); });
      folhaOps.appendChild(b);
      if (!primeiro) primeiro = b;
    }
    mostraFolha(primeiro || /** @type {HTMLElement} */ (folha.querySelector('[data-acao="fechar-folha"]')));
  }

  // Compartilhar a foto aberta (botão Compartilhar do visualizador): o arquivo
  // da pasta do Instagram, quando a foto tem e o aparelho aceita; senão o link
  // direto; senão copia o link. Não é download — é o menu de compartilhar, que
  // quem toca em "Compartilhar" pediu.
  /** @type {Map<string, File>} */
  const arquivosProntos = new Map();
  const podeArquivo = aceitaArquivoDeTeste();
  // Compartilhar não entra na fila (a pessoa está olhando a foto, não baixando
  // um lote): se o servidor mandou esperar, diz quanto e não repete o pedido
  // a cada toque até o prazo passar.
  let compartilharAte = 0;
  async function compartilhaFoto(f) {
    const link = location.origin + enderecoDaFoto(f.id);
    if (Date.now() < compartilharAte) {
      avisa('Muita gente baixando agora. Tente de novo em ' + Math.ceil((compartilharAte - Date.now()) / 1000) + ' s.');
      return;
    }
    try {
      if (podeArquivo && f.redes) {
        let arq = arquivosProntos.get(f.id);
        if (!arq) {
          avisa('Preparando a foto…');
          arq = await buscaArquivo(f, 'redes', true);
          arquivosProntos.set(f.id, arq);
        }
        try {
          await navigator.share({ files: [arq] });
        } catch (e) {
          // O iPhone só deixa compartilhar logo depois do toque: a foto já está
          // pronta, então o toque seguinte compartilha na hora.
          if (e && e.name === 'NotAllowedError') { avisa('Foto pronta: toque em Compartilhar de novo'); return; }
          throw e;
        }
        return;
      }
      if (typeof navigator.share === 'function') {
        await navigator.share({ title: document.title, url: link });
        return;
      }
      await navigator.clipboard.writeText(link);
      avisa('Link copiado');
    } catch (e) {
      if (e && e.name === 'AbortError') return;
      if (e && e.espera) {
        compartilharAte = Date.now() + e.espera * 1000;
        avisa('Muita gente baixando agora. Tente de novo em ' + e.espera + ' s.');
        return;
      }
      avisa(e && e.name === 'Error' && e.message ? e.message : 'Não foi possível compartilhar. Use Baixar.');
    }
  }

  /** @param {boolean} [peloVoltar] a entrada do histórico já saiu */
  function fechaFolha(peloVoltar) {
    if (!folha || folha.hidden) return;
    geracao++;
    folha.hidden = true;
    if (!peloVoltar && noTopo('folha')) history.back();
    if (focoAntes && typeof (/** @type {HTMLElement} */ (focoAntes)).focus === 'function') (/** @type {HTMLElement} */ (focoAntes)).focus();
  }

  // Download comum, um <a download> por arquivo, em fila (o navegador pede
  // permissão uma vez para vários). O nome vem do Content-Disposition do
  // servidor: o do Drive, exato. No iPhone é o "Baixar arquivo" (vai para o
  // app Arquivos).
  //
  // jaContadas: ids que já foram buscados (e contados) por buscaArquivo —
  // o iPhone recusou salvar no Fotos e o mesmo arquivo vem de novo como
  // download; esses saem com c=0 para a contagem não dobrar. manterAberta:
  // não fecha a folha sozinha (o texto que o chamador pôs nela precisa ser
  // lido — fechar em 900 ms o escondia).
  function baixaComum(lista, v, jaContadas, manterAberta, botao) {
    if (!folhaMsg || !lista.length) return;
    // Já há uma fila andando nesta aba: uma tentativa por vez.
    if (filaViva) { folhaMsg.textContent = 'Já há downloads na fila. Espere ou toque em Cancelar.'; return; }
    const minha = geracao;
    // v3.9.4: o toque responde NA HORA, embaixo (antes só depois da fila, no
    // topo) — sem resposta, a pessoa toca de novo e baixa duas vezes.
    avisa(lista.length > 1 ? 'Download de ' + lista.length + ' fotos iniciado' : 'Download iniciado');
    folhaMsg.textContent = lista.length > 1
      ? 'Baixando ' + lista.length + ' fotos. Se o navegador perguntar, permita vários downloads.'
      : 'Preparando o download…';
    baixaNaFila(lista, v, jaContadas, minha, botao).then(function (saiu) {
      if (minha !== geracao) return;
      if (!saiu) {
        // Cancelou, desistiu ou deu erro: a mensagem do erro já está na folha.
        if (filaCancelada && folhaMsg) folhaMsg.textContent = 'Cancelado.';
        return;
      }
      if (folhaMsg && !manterAberta) folhaMsg.textContent = lista.length > 1
        ? 'Baixando ' + lista.length + ' fotos. Se o navegador perguntar, permita vários downloads.'
        : 'Download iniciado.';
      if (!manterAberta) setTimeout(function () { if (minha === geracao) fechaFolha(); }, lista.length > 1 ? 2500 : 900);
    });
  }

  // Lotes para a folha do iOS: ela segura os arquivos todos na memória da aba
  // do Safari, que é pequena. Até LOTE_MAX_FOTOS fotos e LOTE_MAX_BYTES por vez
  // (sempre ao menos uma); o resto vem no lote seguinte, sem pedir nada à mão.
  function emLotes(lista, v) {
    const lotes = [];
    let atual = [];
    let soma = 0;
    lista.forEach(function (f) {
      const a = arquivoDe(f, v);
      const b = a && a.bytes ? a.bytes : 0;
      if (atual.length && (atual.length >= LOTE_MAX_FOTOS || soma + b > LOTE_MAX_BYTES)) {
        lotes.push(atual);
        atual = [];
        soma = 0;
      }
      atual.push(f);
      soma += b;
    });
    if (atual.length) lotes.push(atual);
    return lotes;
  }

  // Abre a folha do sistema com os arquivos. Logo depois de preparar, o toque
  // original já pode ter vencido (baixar 20 MB demora): tenta na hora e, se o
  // iOS recusar por falta de toque (NotAllowedError), pede UM toque no botão.
  // Devolve 'ok', 'recusou' (cai no download comum). Fechar a folha do sistema
  // sem escolher (AbortError) deixa o botão pronto para abrir de novo.
  function compartilhaLote(arquivos, pedeToque) {
    return new Promise(function (resolve) {
      const tenta = function (comToque) {
        let p;
        try { p = navigator.share({ files: arquivos }); } catch (e) { resolve('recusou'); return; }
        p.then(function () { resolve('ok'); }, function (e) {
          if (e && e.name === 'AbortError') { pedeToque(function () { tenta(true); }, 'Cancelado. Toque para abrir a janela de novo.'); return; }
          if (e && e.name === 'NotAllowedError' && !comToque) { pedeToque(function () { tenta(true); }, ''); return; }
          resolve('recusou');
        });
      };
      tenta(false);
    });
  }

  async function salvarNoFotos(lista, v, botao, rotulo, defineAoToque) {
    if (!folhaMsg) return;
    const minha = geracao;
    const lotes = emLotes(lista, v);
    botao.disabled = true;
    const volta = function () { botao.disabled = false; botao.textContent = rotulo; };
    for (let i = 0; i < lotes.length; i++) {
      const lote = lotes[i];
      const parte = lotes.length > 1 ? ' (parte ' + (i + 1) + ' de ' + lotes.length + ')' : '';
      /** @type {File[]} */
      const arquivos = [];
      try {
        for (let k = 0; k < lote.length; k++) {
          if (minha !== geracao) return;
          folhaMsg.textContent = 'Preparando ' + (k + 1) + ' de ' + lote.length + parte + '…';
          arquivos.push(await buscaNaFila(lote[k], v, minha, botao));
        }
      } catch (e) {
        volta();
        folhaMsg.textContent = (e && e.message) || 'Não foi possível preparar a foto.';
        return;
      }
      if (minha !== geracao) return;
      // O iOS conhece os tipos que aceita: se recusar estes arquivos, o
      // download comum (Arquivos) é o caminho que sobra.
      let r = 'recusou';
      if (podeCompartilharArquivos(arquivos)) {
        r = await compartilhaLote(arquivos, function (acao, msg) {
          if (minha !== geracao) return;
          botao.disabled = false;
          botao.textContent = arquivos.length > 1 ? 'Salvar ' + arquivos.length + ' fotos' + parte : 'Salvar no Fotos';
          folhaMsg.textContent = msg || 'Pronto. Toque em Salvar no Fotos e, na janela do iPhone, em Salvar imagem.';
          defineAoToque(function () { botao.disabled = true; acao(); });
          botao.focus();
        });
      }
      if (minha !== geracao) return;
      if (r !== 'ok') {
        volta();
        const restantes = lotes.slice(i).reduce(function (t, l) { return t.concat(l); }, []);
        // O lote atual já foi buscado (e contado) acima: só ele sai com c=0.
        const jaContadas = new Set(lote.map(function (f) { return f.id; }));
        // A folha fica aberta: a explicação abaixo é o que a pessoa precisa ler.
        baixaComum(restantes, v, jaContadas, true);
        folhaMsg.textContent = 'O iPhone não aceitou salvar direto no Fotos. Baixando como arquivo (app Arquivos).';
        return;
      }
      if (i + 1 < lotes.length) botao.textContent = 'Preparando a parte ' + (i + 2) + '…';
    }
    volta();
    fechaFolha();
    // Não diz "salvou": a pessoa pode ter escolhido WhatsApp ou AirDrop em vez
    // de "Salvar imagem", e a página não fica sabendo.
    avisa(lista.length > 1 ? lista.length + ' fotos enviadas pelo menu do iPhone' : 'Foto enviada pelo menu do iPhone');
  }

  // ---- Aviso flutuante ----
  const flut = document.getElementById('g-aviso-flut');
  let flutT = 0;
  function avisa(txt) {
    if (!flut) return;
    flut.textContent = txt;
    flut.classList.add('on');
    clearTimeout(flutT);
    flutT = setTimeout(function () { flut.classList.remove('on'); }, 2600);
  }

  // Compartilhar a PÁGINA DO PROJETO (não a galeria): é o link que o dono
  // divulga, com a capa e o resumo certos nas redes.
  function compartilhaPagina() {
    const url = location.origin + '/' + encodeURIComponent(D.slug);
    const h1 = document.getElementById('g-h1');
    const titulo = h1 ? (h1.textContent || '') : document.title;
    if (navigator.share) {
      navigator.share({ title: titulo, url: url }).catch(function () {});
      return;
    }
    if (navigator.clipboard) {
      navigator.clipboard.writeText(url).then(function () { avisa('Link copiado'); }, function () { avisa(url); });
    } else {
      avisa(url);
    }
  }


  // ---- Pedir remoção desta foto (só o visitante) ----
  // O link "Pedir remoção" fica sob a legenda do visualizador. O formulário é
  // um <dialog> modal: o Turnstile só carrega quando ele abre, e o pedido vai
  // para /api/galeria/remocao. O pedido só avisa o fotógrafo: a foto continua
  // na galeria até ele decidir (a resposta chega por e-mail).
  const R = D.remocao;
  const rem = /** @type {HTMLDialogElement | null} */ (document.getElementById('g-rem'));
  const remF = /** @type {HTMLFormElement | null} */ (document.getElementById('g-rem-f'));
  const remOk = document.getElementById('g-rem-ok');
  const remErro = document.getElementById('g-rem-erro');
  const remEnviar = /** @type {HTMLButtonElement | null} */ (document.getElementById('g-rem-enviar'));
  const remMotivo = /** @type {HTMLSelectElement | null} */ (document.getElementById('g-rem-motivo'));
  const remEmail = /** @type {HTMLInputElement | null} */ (document.getElementById('g-rem-email'));
  const remMsg = /** @type {HTMLTextAreaElement | null} */ (document.getElementById('g-rem-msg'));
  /** @type {Foto | null} */
  let remFoto = null;
  /** @type {Element | null} */
  let remFoco = null;
  let remToken = '';
  /** @type {string | null} */
  let remWidget = null;
  let remEnviando = false;

  // Turnstile sob demanda: o script só entra na página quando o formulário abre.
  const TS_SRC = 'https://challenges.cloudflare.com/turnstile/v0/api.js';
  let tsEstado = 'fora';
  const tsEspera = [];
  function tsFim(ok) {
    if (tsEstado === 'pronto' || tsEstado === 'falhou') return;
    tsEstado = ok ? 'pronto' : 'falhou';
    tsEspera.splice(0).forEach(function (fn) { fn(); });
  }
  function comTurnstile(fn) {
    if (tsEstado === 'pronto' || tsEstado === 'falhou') { fn(); return; }
    tsEspera.push(fn);
    if (tsEstado !== 'fora') return;
    tsEstado = 'carregando';
    const sc = document.createElement('script');
    sc.src = TS_SRC;
    sc.async = true;
    // Carregou mas não definiu o objeto (extensão que troca o script): falhou.
    sc.onload = function () { tsFim(typeof window.turnstile !== 'undefined'); };
    sc.onerror = function () { tsFim(false); };
    document.head.appendChild(sc);
  }

  function remMostraErro(txt, campo) {
    if (remErro) remErro.textContent = txt || '';
    [remMotivo, remEmail].forEach(function (c) { if (c) c.removeAttribute('aria-invalid'); });
    if (campo) { campo.setAttribute('aria-invalid', 'true'); campo.focus(); }
  }
  function remAtualizaBotao() {
    if (remEnviar) remEnviar.disabled = remEnviando || !remToken;
  }

  function abreRemocao(f) {
    if (!R || !rem || !remF || typeof rem.showModal !== 'function' || !f) return;
    remFoto = f;
    remFoco = document.activeElement;
    remToken = '';
    remEnviando = false;
    remF.hidden = false;
    if (remOk) remOk.hidden = true;
    remF.reset();
    remMostraErro('');
    const img = /** @type {HTMLImageElement | null} */ (document.getElementById('g-rem-img'));
    if (img) img.src = lh3(f.id, 160);
    const nome = document.getElementById('g-rem-nome');
    if (nome) nome.textContent = semExt(f.nome);
    remAtualizaBotao();
    history.pushState({ g: 'rem' }, '', location.href);
    rem.showModal();
    if (remMotivo) remMotivo.focus();
    comTurnstile(function () {
      // Bloqueador de anúncios/extensão de privacidade: sem Turnstile o servidor
      // recusaria o envio, então o aviso vem antes e o botão fica desligado.
      if (typeof window.turnstile === 'undefined') {
        remMostraErro('A verificação de segurança não carregou (um bloqueador pode estar impedindo). Desative-o para este site ou escreva para privacidade@lucafchala.com.');
        return;
      }
      if (remWidget !== null) { window.turnstile.reset(remWidget); return; }
      remWidget = window.turnstile.render('#g-rem-ts', {
        sitekey: R.ts,
        callback: function (t) { remToken = t; remAtualizaBotao(); },
        'error-callback': function () { remToken = ''; remAtualizaBotao(); },
        'expired-callback': function () { remToken = ''; remAtualizaBotao(); },
      });
    });
  }

  /** @param {boolean} [peloVoltar] a entrada do histórico já saiu */
  function fechaRemocao(peloVoltar) {
    if (!rem || !rem.open) return;
    rem.close();
    if (!peloVoltar && noTopo('rem')) history.back();
    const volta = remFoco;
    remFoco = null;
    if (volta && typeof (/** @type {HTMLElement} */ (volta)).focus === 'function' && document.contains(volta)) (/** @type {HTMLElement} */ (volta)).focus();
  }

  function enviaRemocao() {
    if (!R || !remFoto || remEnviando) return;
    const motivo = remMotivo ? remMotivo.value : '';
    const email = remEmail ? remEmail.value.trim() : '';
    if (!motivo) { remMostraErro('Escolha o motivo do pedido.', remMotivo); return; }
    // Conferência só de forma; o servidor valida de verdade.
    const arroba = email.indexOf('@');
    if (arroba < 1 || email.lastIndexOf('.') < arroba + 2 || email.indexOf(' ') >= 0 || email.length > 200) {
      remMostraErro('Informe um e-mail válido.', remEmail);
      return;
    }
    if (!remToken) { remMostraErro('Aguarde a verificação de segurança terminar.'); return; }
    remMostraErro('');
    remEnviando = true;
    remAtualizaBotao();
    if (remEnviar) remEnviar.textContent = 'Enviando…';
    const hp = /** @type {HTMLInputElement | null} */ (document.getElementById('company_website'));
    const foto = remFoto;
    fetch('/api/galeria/remocao', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        slug: D.slug,
        cap: D.cap,
        foto: foto.id,
        motivo: motivo,
        email: email,
        mensagem: remMsg ? remMsg.value.trim() : '',
        turnstileToken: remToken,
        form_token: R.token,
        company_website: hp ? hp.value : '',
      }),
    }).then(function (r) {
      return r.json().catch(function () { return {}; }).then(function (j) {
        if (!r.ok) throw new Error(j.error || 'Não foi possível enviar. Tente de novo.');
        return j;
      });
    }).then(function (j) {
      const txt = document.getElementById('g-rem-ok-txt');
      if (txt) {
        txt.textContent = 'Recebemos o pedido. O fotógrafo vai analisar e você recebe a resposta no e-mail ' + email + '.';
      }
      if (remF) remF.hidden = true;
      if (remOk) remOk.hidden = false;
      const t = document.getElementById('g-rem-ok-t');
      if (t) t.focus();
      remToken = '';
    }).catch(function (e) {
      remMostraErro(e && e.message ? e.message : 'Não foi possível enviar. Tente de novo.');
      // O token do Turnstile vale uma vez só: pede outro para a próxima tentativa.
      remToken = '';
      if (remWidget !== null && window.turnstile) window.turnstile.reset(remWidget);
    }).then(function () {
      remEnviando = false;
      if (remEnviar) remEnviar.textContent = 'Enviar pedido';
      remAtualizaBotao();
    });
  }

  if (R && rem && remF) {
    remF.addEventListener('submit', function (e) { e.preventDefault(); enviaRemocao(); });
    // Esc: o <dialog> cancela sozinho; o fechamento passa por aqui para limpar o histórico.
    rem.addEventListener('cancel', function (e) { e.preventDefault(); fechaRemocao(); });
    // Com o formulário aberto, nenhuma tecla é do visualizador por baixo (setas
    // trocariam a foto, Esc o fecharia). O comportamento nativo da tecla segue.
    window.addEventListener('keydown', function (e) {
      if (rem.open) e.stopPropagation();
    }, true);
  }

  // ---- Eventos ----
  main.addEventListener('click', function (e) {
    const alvo = /** @type {Element} */ (e.target);
    const a = /** @type {HTMLElement | null} */ (alvo.closest('.g-t'));
    if (!a) return;
    const f = fotos[Number(a.dataset.i)];
    if (!f) return;
    if (alvo.closest('.g-fav')) { e.preventDefault(); alternaFav(f); return; }
    if (modoSel && e.shiftKey && !e.metaKey && !e.ctrlKey) { e.preventDefault(); selecionaIntervalo(f); return; }
    if (e.metaKey || e.ctrlKey || e.shiftKey || e.button === 1) return; // nova aba: o ?foto= abre lá
    e.preventDefault();
    if (modoSel) { alternaSel(f); return; }
    abre(vistas.indexOf(f));
  });
  // F favorita a foto em foco na grade (o coração só aparece ao passar o mouse).
  main.addEventListener('keydown', function (e) {
    if ((e.key !== 'f' && e.key !== 'F') || e.metaKey || e.ctrlKey || e.altKey) return;
    const a = /** @type {HTMLElement | null} */ (/** @type {Element} */ (e.target).closest('.g-t'));
    const f = a ? fotos[Number(a.dataset.i)] : null;
    if (f) { e.preventDefault(); alternaFav(f); }
  });
  document.addEventListener('click', function (e) {
    const alvo = /** @type {Element} */ (e.target);
    if (alvo === folha) { fechaFolha(); return; }
    const b = /** @type {HTMLElement | null} */ (alvo.closest('[data-acao]'));
    if (!b) return;
    const acao = b.dataset.acao;
    if (acao === 'fechar-folha') fechaFolha();
    else if (acao === 'fechar-rem') fechaRemocao();
    else if (acao === 'pedir-remocao') abreRemocao(lightbox && lightbox.pswp ? vistas[lightbox.pswp.currIndex] : null);
    else if (acao === 'limpar-sel') { sel.clear(); ultimoSel = null; fotos.forEach(pintaSel); salvaSel(); atualizaBarra(); }
    else if (acao === 'fim-sel') ligaModoSel(false);
    else if (acao === 'baixar-sel') {
      const lista = fotos.filter(function (f) { return sel.has(f.id); });
      if (lista.length) abreFolha(lista); else avisa('Nenhuma foto selecionada');
    }
    else if (acao === 'baixar-tudo') abreFolhaTudo();
    else if (acao === 'compartilhar') compartilhaPagina();
    else if (acao === 'sel-secao') selecionaSecao(Number(b.dataset.sec));
    else if (acao === 'ir-sec') irParaSecao(Number(b.dataset.sec));
    else if (acao === 'filtro-fav') ligaFiltroFav(!filtroFav);
    else if (acao === 'filtro-novas') ligaFiltroNovas(!filtroNovas);
    else if (acao === 'filtro-autor') ligaFiltroAutor(Number(b.dataset.aut));
    else if (acao === 'filtro-sec') ligaFiltroSec(Number(b.dataset.sec));
    else if (acao === 'compartilhar-fav') compartilhaFavoritas();
    else if (acao === 'sai-link') saiDoLink();
    else if (acao === 'guarda-link') guardaDoLink();
    else if (acao === 'topo') {
      window.scrollTo({ top: 0, behavior: reduz() ? 'auto' : 'smooth' });
      const h1 = document.getElementById('g-h1');
      if (h1) h1.focus({ preventScroll: true });
    }
  });
  if (botaoSel) botaoSel.addEventListener('click', function () { ligaModoSel(!modoSel); });
  // Com a folha aberta, Esc e as setas são dela — não do visualizador por baixo.
  window.addEventListener('keydown', function (e) {
    if (!folha || folha.hidden) return;
    if (e.key === 'Escape') { e.preventDefault(); fechaFolha(); }
    if (e.key === 'Escape' || e.key === 'ArrowLeft' || e.key === 'ArrowRight') e.stopPropagation();
  }, true);
  // F favorita a foto aberta no visualizador.
  window.addEventListener('keydown', function (e) {
    if (!vendo || (folha && !folha.hidden)) return;
    if ((e.key !== 'f' && e.key !== 'F') || e.metaKey || e.ctrlKey || e.altKey) return;
    const f = lightbox && lightbox.pswp ? vistas[lightbox.pswp.currIndex] : null;
    if (f) { e.preventDefault(); alternaFav(f); sincronizaFavUi(); }
  });
  // Voltar: fecha a camada de cima (ver noTopo). A folha antes da foto.
  window.addEventListener('popstate', function () {
    if (folha && !folha.hidden && !noTopo('folha')) fechaFolha(true);
    if (rem && rem.open && !noTopo('rem')) fechaRemocao(true);
    if (lightbox && lightbox.pswp && !noTopo('foto') && !noTopo('folha') && !noTopo('rem')) lightbox.pswp.close();
  });

  // ---- Início ----
  detectaWebp(function () {
    monta();
    fotos.forEach(pintaSel);
    sel.forEach(function (id) { if (!fotos.some(function (f) { return f.id === id; })) sel.delete(id); });
    fav.forEach(function (id) { if (!fotos.some(function (f) { return f.id === id; })) fav.delete(id); });
    const doLink = leSelecaoDoLink();
    if (filtroSec >= 0) recalculaVistas();
    atualizaBarra();
    montaChips();
    diagramaTudo();
    observaSecoes();
    if (doLink === 0) {
      avisa('As fotos deste link não estão mais nesta galeria');
      history.replaceState(null, '', location.pathname + location.search);
    } else if (doLink > 0) {
      avisa(doLink === 1 ? '1 foto escolhida por quem mandou o link' : doLink + ' fotos escolhidas por quem mandou o link');
    }
    if (typeof ResizeObserver === 'function') {
      new ResizeObserver(function () { if (main.clientWidth !== larguraDiagramada) agendaDiagrama(); }).observe(main);
      if (cab) new ResizeObserver(medeTopo).observe(cab);
    } else {
      window.addEventListener('resize', function () { agendaDiagrama(); medeTopo(); });
    }
    if (FOTO_NO_LINK) {
      const f = fotos.find(function (x) { return x.id === FOTO_NO_LINK; }) || fotos.find(function (x) { return codigoDe(x.id) === FOTO_NO_LINK; });
      if (f) {
        // A entrada de chegada vira a da grade, e a abertura empilha a da
        // foto: assim o voltar de quem chegou pelo link fecha a foto e fica
        // na galeria.
        history.replaceState(null, '', semFotoNaBusca());
        abre(vistas.indexOf(f));
      }
    }
    // Aquece o visualizador no tempo ocioso: o primeiro toque abre na hora.
    const ocioso = window.requestIdleCallback || function (fn) { return setTimeout(fn, 1200); };
    ocioso(function () { preparaLightbox().catch(function () {}); });
  });
})();
`;
