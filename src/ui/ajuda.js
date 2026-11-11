// Páginas de ajuda do álbum (v3.9.0): /ajuda e /ajuda/<tema> no domínio do
// álbum ("entrenos2026.com/ajuda/rosto"); /galeria/<slug>/ajuda[/<tema>] no
// site. Mesmo portão da galeria (antes do lançamento, só quem tem a prévia).
//
// O texto de cada tema mora SÓ aqui: as telas do álbum linkam para cá em vez
// de repetir a explicação. Cada resposta descreve o que o código faz hoje
// (nomes de botão iguais aos da tela); mudou o comportamento, muda aqui.

import { escape, fontFaceCSS, fontPreloadHTML, marcaDoAlbum } from '../utils.js';
import { CORES_DO_ALBUM } from './album.js';
import { PALETA_ALBUM as P } from '../config.js';

/**
 * @typedef {{ p: string, r: string }} Pergunta  r: HTML (só texto fixo daqui)
 * @typedef {{ tema: string, titulo: string, resumo: string, perguntas: Pergunta[], so?: 'pix' }} Tema
 */

/** @type {Tema[]} */
export const TEMAS_DE_AJUDA = [
  {
    tema: 'rosto',
    titulo: 'Achar minhas fotos pelo rosto',
    resumo: 'Como funciona a busca pela selfie, o que é guardado e como sair dela.',
    perguntas: [
      { p: 'Como funciona?', r: 'Toque em <b>Achar minhas fotos pelo rosto</b>, tire uma selfie (ou escolha uma foto sua) e o álbum mostra as fotos em que você provavelmente aparece, separadas por evento.' },
      { p: 'A minha selfie fica guardada?', r: 'Não. Ela vai para a Amazon Rekognition, em São Paulo, só para a comparação, e nem o site nem a Amazon a guardam. Neste aparelho fica só a lista das fotos encontradas, para você voltar a ela depois em <b>Ver minhas fotos</b>.' },
      { p: 'Como tirar uma selfie que funciona bem?', r: 'De frente, com o rosto inteiro dentro do oval, olhando para a câmera. Luz de frente (janela ou lâmpada à sua frente, não atrás). Sem óculos escuros nem boné.' },
      { p: 'O que é "Talvez seja você"?', r: 'São fotos menos parecidas com a selfie: você de lado, de longe ou com pouca luz. Confira uma por uma.' },
      { p: 'Faltou foto minha. E agora?', r: 'A busca é aproximada: pode faltar foto e pode aparecer alguém parecido. Tente outra selfie e, para ter certeza, olhe o evento inteiro em <b>Ver todas as fotos</b>.' },
      { p: 'Chegaram fotos novas. Preciso buscar de novo?', r: 'Não. No aparelho em que você buscou, <b>Ver minhas fotos</b> confere sozinho as fotos que chegaram depois e marca as novas.' },
      { p: 'Posso fazer um cartão para os stories?', r: 'Sim. Depois da busca, toque em <b>Criar cartão para os stories</b>: o próprio celular monta uma imagem com as suas melhores fotos. Nada é enviado; ela só sai do aparelho se você compartilhar ou baixar.' },
      { p: 'Não quero aparecer na busca.', r: 'Na página do álbum, toque em <b>Não quero aparecer na busca</b> e mande uma selfie: o seu rosto sai do índice, inclusive das fotos que chegarem depois. As fotos continuam no álbum; para tirar uma foto, veja <a href="{base}/ajuda/remover">Tirar uma foto do álbum</a>.' },
    ],
  },
  {
    tema: 'baixar',
    titulo: 'Baixar e compartilhar fotos',
    resumo: 'Uma foto, várias ou o evento inteiro, e o link de uma foto.',
    perguntas: [
      { p: 'Como baixo uma foto?', r: 'Abra a foto e toque em <b>Baixar</b>. Escolha <b>Para redes sociais</b> (mais leve, pronta para postar) ou <b>O arquivo original</b> (a qualidade total da câmera).' },
      { p: 'E várias de uma vez?', r: 'Toque em <b>Selecionar</b>, escolha as fotos e toque em <b>Baixar</b>. Para o evento inteiro, use <b>Baixar tudo</b>.' },
      { p: 'Apareceu "Você está na fila".', r: 'Muita gente está baixando ao mesmo tempo. O site tenta de novo sozinho: deixe a página aberta.' },
      { p: 'No iPhone, onde a foto vai parar?', r: 'Se ela for para o app Arquivos, abra a foto lá e toque em Compartilhar → <b>Salvar imagem</b> para mandá-la para o app Fotos.' },
      { p: 'Como mando uma foto para alguém?', r: 'Abra a foto e toque em <b>Compartilhar</b>. O link abre direto naquela foto, e no WhatsApp a prévia já mostra a própria foto.' },
      { p: 'Posso guardar as que gostei?', r: 'Toque na estrela (<b>Favoritar</b>) nas fotos que você gostou. Depois dá para ver só as favoritas e mandar todas num link só.' },
    ],
  },
  {
    tema: 'enviar',
    titulo: 'Mandar suas fotos',
    resumo: 'Como colocar as suas fotos no álbum da turma.',
    perguntas: [
      { p: 'Como mando as minhas fotos?', r: 'Na página do álbum, toque em <b>Mandar suas fotos</b> e siga o passo a passo. As fotos vão para a pasta da turma no Google Drive, e o álbum lê de lá.' },
      { p: 'Quanto tempo até aparecerem?', r: 'Em geral alguns minutos: o álbum confere a pasta sozinho. A busca pelo rosto passa a achar as fotos novas pouco depois. Em dias de muito envio, pode levar mais.' },
      { p: 'Posso mandar vídeos e Live Photos?', r: 'Pode. Vídeos aparecem com o botão de tocar, e Live Photos aparecem como foto.' },
      { p: 'Mandei uma foto por engano.', r: 'Peça para tirá-la: veja <a href="{base}/ajuda/remover">Tirar uma foto do álbum</a>.' },
      { p: 'O que não mandar?', r: 'O álbum é da turma toda e tem menores de idade: nada que exponha ou constranja alguém. Fotos assim podem ser tiradas do álbum.' },
    ],
  },
  {
    tema: 'remover',
    titulo: 'Tirar uma foto do álbum',
    resumo: 'Como pedir para tirar uma foto e o que acontece depois.',
    perguntas: [
      { p: 'Como peço para tirar uma foto?', r: 'Abra a foto e toque em <b>Pedir remoção desta foto</b>. Conte o motivo: o pedido vai direto para quem cuida do álbum.' },
      { p: 'A foto some na hora?', r: 'Não: quem cuida do álbum lê o pedido e tira a foto se for o caso. Quando ela sai, sai também das cópias do site.' },
      { p: 'Quero só sair da busca pelo rosto.', r: 'Isso é outra coisa: veja <a href="{base}/ajuda/rosto">Achar minhas fotos pelo rosto</a> → "Não quero aparecer na busca".' },
      { p: 'E os meus dados pessoais?', r: 'Para pedidos sobre seus dados (acesso, correção, exclusão), escreva para <a href="mailto:privacidade@lucafchala.com">privacidade@lucafchala.com</a>. Os detalhes estão na <a href="https://fotos.lucafchala.com/privacidade">Política de Privacidade</a>.' },
    ],
  },
  {
    tema: 'navegar',
    titulo: 'Andar pelo álbum',
    resumo: 'Eventos, busca por palavra, tela cheia e o álbum na tela inicial.',
    perguntas: [
      { p: 'Como acho um evento?', r: 'Na página do álbum, toque em <b>Ver os eventos</b>: eles vêm em ordem de data. Dentro de um evento, as setas levam ao anterior e ao próximo.' },
      { p: 'Dá para procurar por número de camisa ou palavra?', r: 'Sim: use <b>Procurar nas fotos</b> e digite um número, uma palavra de uma faixa ou uma coisa (palco, bolo, bola).' },
      { p: 'Como vejo em tela cheia?', r: 'Toque na foto. Deslize para os lados para passar as fotos. Para dar zoom, faça pinça ou toque duas vezes.' },
      { p: 'Como coloco o álbum na tela inicial?', r: 'No iPhone: no Safari, toque em Compartilhar → <b>Adicionar à Tela de Início</b>. No Android: no menu do navegador (⋮), <b>Adicionar à tela inicial</b>.' },
      { p: 'Como recebo aviso de foto nova?', r: 'Toque em <b>Avisar quando chegar foto nova</b> e permita as notificações. No iPhone, o aviso só funciona com o álbum na tela de início. Chega no máximo um aviso a cada 3 horas.' },
    ],
  },
  {
    tema: 'apoiar',
    titulo: 'Apoiar o álbum',
    resumo: 'Como ajudar a manter o álbum no ar.',
    so: 'pix',
    perguntas: [
      { p: 'O álbum custa alguma coisa?', r: 'O álbum é de graça para quem vê. Manter no ar tem custos: o servidor, a busca pelo rosto e o domínio.' },
      { p: 'Como ajudo?', r: 'Se quiser contribuir, o Pix está no fim da página do álbum, em <a href="{raiz}#al-apoio-t">Gostou do álbum?</a>. Qualquer valor ajuda, e não é obrigatório.' },
    ],
  },
  {
    tema: 'contato',
    titulo: 'Falar com a gente',
    resumo: 'Erro no site, reclamação ou sugestão.',
    perguntas: [
      { p: 'Achei um erro no site.', r: 'Conte pelo <a href="https://fotos.lucafchala.com/suporte">formulário de suporte</a>: o que você tentou fazer, o que aconteceu e em qual aparelho (iPhone, Android, computador).' },
      { p: 'Tenho uma reclamação ou sugestão.', r: 'Use o mesmo <a href="https://fotos.lucafchala.com/suporte">formulário de suporte</a>. Toda mensagem é lida.' },
      { p: 'É sobre uma foto específica.', r: 'Abra a foto e toque em <b>Pedir remoção desta foto</b>, que já leva junto qual é a foto. Veja <a href="{base}/ajuda/remover">Tirar uma foto do álbum</a>.' },
    ],
  },
];

/**
 * Os temas que valem para este álbum (o de apoio só com Pix cadastrado).
 * @param {{ pixChave?: unknown }} event
 */
export function temasDoAlbum(event) {
  const temPix = typeof event.pixChave === 'string' && event.pixChave.trim() !== '';
  return TEMAS_DE_AJUDA.filter(t => t.so !== 'pix' || temPix);
}

const CSS = `
*,*::before,*::after{box-sizing:border-box;margin:0;padding:0}
[hidden]{display:none!important}
body{background:var(--bg);color:var(--txt);font-family:'Open Sans','Inter',sans-serif;-webkit-font-smoothing:antialiased;-webkit-text-size-adjust:100%;min-height:100vh;line-height:1.55}
a{color:var(--sol)}
:focus-visible{outline:2px solid var(--sol);outline-offset:3px}
.aj{max-width:720px;margin:0 auto;padding:1.4rem var(--pad) 4rem}
.aj-volta{display:inline-flex;align-items:center;min-height:44px;color:var(--txt2);text-decoration:none;font-size:.9rem}
.aj-kick{display:block;margin-top:1rem;font-size:.74rem;font-weight:600;letter-spacing:.22em;text-transform:uppercase;color:var(--sol)}
h1{font-weight:800;letter-spacing:-.02em;line-height:1.05;font-size:clamp(1.9rem,6vw,2.6rem);margin-top:.3rem;overflow-wrap:anywhere}
.aj-sub{color:var(--txt2);margin-top:.5rem}
.aj-busca{margin-top:1.4rem}
.aj-rot{margin:0 0 .4rem}
.aj-busca input{width:100%;min-height:48px;padding:0 1rem;border-radius:999px;border:1px solid var(--borda);background:var(--card);color:var(--txt);font:inherit}
.aj-temas{list-style:none;display:grid;grid-template-columns:repeat(auto-fill,minmax(min(100%,200px),1fr));gap:.6rem;margin-top:1.4rem}
.aj-temas a{display:block;height:100%;padding:.9rem 1rem;border:1px solid var(--borda);border-radius:14px;background:var(--card);color:var(--txt);text-decoration:none}
.aj-temas a b{display:block;font-weight:700}
.aj-temas a span{display:block;font-size:.82rem;color:var(--mudo);margin-top:.2rem}
.aj-temas a[aria-current="page"]{border-color:var(--sol)}
.aj-sec{margin-top:2.2rem}
.aj-sec h2{font-size:1.25rem;font-weight:700}
.aj-sec h2 a{color:inherit;text-decoration:none}
details{border-bottom:1px solid var(--borda)}
summary{cursor:pointer;min-height:48px;display:flex;align-items:center;padding:.6rem 0;font-weight:600;list-style:none}
summary::-webkit-details-marker{display:none}
summary::after{content:"+";margin-left:auto;padding-left:1rem;color:var(--sol);font-weight:700}
details[open] summary::after{content:"–"}
details div{padding:0 0 1rem;color:var(--txt2)}
details b{color:var(--txt);font-weight:600}
.aj-nada{margin-top:1.4rem;color:var(--mudo)}
.aj-fim{margin-top:2.6rem;padding-top:1.2rem;border-top:1px solid var(--borda);color:var(--mudo);font-size:.9rem}
`;

// O filtro "Qual é a sua dúvida?": esconde as perguntas que não têm as
// palavras digitadas (sem acento, sem maiúscula). Sem servidor, sem innerHTML.
const SCRIPT = `(function () {
  var campo = document.getElementById('aj-q');
  if (!campo) return;
  var itens = Array.prototype.slice.call(document.querySelectorAll('details[data-q]'));
  var secoes = Array.prototype.slice.call(document.querySelectorAll('.aj-sec'));
  var nada = document.getElementById('aj-nada');
  var cartoes = document.querySelector('.aj-temas');
  function norm(s) { return String(s || '').toLowerCase().normalize('NFD').replace(/[\\u0300-\\u036f]/g, ''); }
  campo.addEventListener('input', function () {
    var termos = norm(campo.value).split(' ').filter(Boolean);
    var algum = false;
    itens.forEach(function (d) {
      var ok = termos.every(function (t) { return d.getAttribute('data-q').indexOf(t) >= 0; });
      d.hidden = !ok;
      d.open = ok && termos.length > 0;
      if (ok) algum = true;
    });
    secoes.forEach(function (s) { s.hidden = !s.querySelector('details:not([hidden])'); });
    if (cartoes) cartoes.hidden = termos.length > 0;
    nada.hidden = algum;
  });
})();`;

/** @param {string} s */
function semAcento(s) {
  return s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/<[^>]+>/g, ' ');
}

/**
 * @param {{
 *   event: { slug: string, title?: string, pixChave?: unknown },
 *   tema: string, base: string, nonce: string,
 * }} p  tema '' = todos; base: '' no domínio do álbum, '/galeria/<slug>' no site
 * @returns {string | null} null = tema que não existe neste álbum
 */
export function ajudaHTML({ event, tema, base, nonce }) {
  const temas = temasDoAlbum(event);
  const atual = tema ? temas.find(t => t.tema === tema) : null;
  if (tema && !atual) return null;
  const titulo = String(event.title || 'Álbum');
  const raiz = base || '/';
  const marca = marcaDoAlbum(event.slug);
  const mostrar = atual ? [atual] : temas;
  /** @param {string} r */
  const resposta = r => r.replaceAll('{base}', base).replaceAll('{raiz}', raiz);
  const secoes = mostrar.map(t => `
    <section class="aj-sec" id="${t.tema}" aria-labelledby="aj-${t.tema}">
      ${atual ? '' : `<h2 id="aj-${t.tema}"><a href="${base}/ajuda/${t.tema}">${escape(t.titulo)}</a></h2>`}
      ${t.perguntas.map(q => `<details data-q="${escape(semAcento(`${q.p} ${q.r} ${t.titulo}`))}"${atual ? ' open' : ''}><summary>${escape(q.p)}</summary><div>${resposta(q.r)}</div></details>`).join('\n      ')}
    </section>`).join('');
  const lista = temas.map(t => `<li><a href="${base}/ajuda/${t.tema}"${atual && t.tema === atual.tema ? ' aria-current="page"' : ''}><b>${escape(t.titulo)}</b><span>${escape(t.resumo)}</span></a></li>`).join('');
  const tituloPagina = atual ? `${atual.titulo} · Ajuda · ${titulo}` : `Ajuda · ${titulo}`;
  return `<!DOCTYPE html>
<html lang="pt-BR">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta name="robots" content="noindex">
  <meta name="theme-color" content="${P.bg}">
  <title>${escape(tituloPagina)}</title>
  <meta name="description" content="${escape(atual ? atual.resumo : `Como usar o álbum ${titulo}: busca pelo rosto, baixar, mandar fotos, tirar uma foto e mais.`)}">
  <link rel="icon" type="image/svg+xml" href="${marca ? marca.icone : '/icon.svg'}">
  ${fontPreloadHTML()}
  <style>${fontFaceCSS()}${CORES_DO_ALBUM}${CSS}</style>
</head>
<body>
  <main class="aj">
    <a class="aj-volta" href="${atual ? `${base}/ajuda` : escape(raiz)}">← ${atual ? 'Todas as dúvidas' : `Voltar ao álbum`}</a>
    <span class="aj-kick">Ajuda · ${escape(titulo)}</span>
    <h1>${escape(atual ? atual.titulo : 'Como usar o álbum')}</h1>
    <p class="aj-sub">${escape(atual ? atual.resumo : 'Toque numa dúvida para ver a resposta.')}</p>
    ${atual ? '' : `<div class="aj-busca"><label for="aj-q" class="aj-kick aj-rot">Qual é a sua dúvida?</label><input id="aj-q" type="search" placeholder="Ex.: selfie, baixar, iPhone" autocomplete="off" enterkeyhint="search"></div>
    <ul class="aj-temas">${lista}</ul>`}
    ${secoes}
    <p class="aj-nada" id="aj-nada" hidden>Nada com essas palavras. Tente outras, ou <a href="https://fotos.lucafchala.com/suporte">fale com a gente</a>.</p>
    ${atual ? `<nav class="aj-fim" aria-label="Outras dúvidas"><p>Outras dúvidas:</p><ul class="aj-temas">${lista}</ul></nav>` : `<p class="aj-fim">Não achou? <a href="${base}/ajuda/contato">Fale com a gente</a>.</p>`}
  </main>
  ${atual ? '' : `<script nonce="${nonce}">${SCRIPT}</script>`}
</body>
</html>`;
}
