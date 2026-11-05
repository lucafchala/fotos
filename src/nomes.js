// Nomes amigáveis nos downloads da galeria (v3.1). Projeto com "Nomes
// amigáveis nos downloads" ligado entrega o arquivo com um nome que diz de onde
// ele vem — só o nome do arquivo (Content-Disposition) muda; os bytes e o EXIF
// são exatamente os do Drive.
//
//   <Título do projeto> - <Capítulo> - <Seção> - <Autor> - <AAAA-MM-DD HHhMMmSS>.<ext>
//
// Parte vazia some (sem separador dobrado). Sem data de captura, entra o número
// da foto na seção, com 3 dígitos. Colisão (mesmo nome na MESMA listagem) ganha
// -2, -3... pela ordem da listagem — determinístico, então a página e o
// download sempre concordam. O nome é calculado NO SERVIDOR, a partir da
// listagem do capítulo; nunca vem do cliente.
//
// Forma: nome = pre[seção] + cauda[foto] + '.' + extensão. A página recebe só
// `pre` (por seção) e `cauda` (por foto) e junta com a extensão do arquivo que
// vai baixar (original ou da pasta do Instagram) — o mesmo cálculo do servidor.

export const NOME_PRE_MAX = 60;
export const NOME_AUTOR_MAX = 40;

// Caracteres proibidos em nome de arquivo (Windows, macOS, Linux) e de controle.
// eslint-disable-next-line no-control-regex
const PROIBIDOS_RE = /[\\/:*?"<>|\u0000-\u001f\u007f]/g;

/**
 * Uma parte do nome: sem caractere proibido, espaços simples, sem ponto ou
 * espaço nas pontas (nome que começa com ponto some nos sistemas Unix).
 * @param {unknown} t
 * @param {number} [max]
 */
export function limpaParte(t, max = 0) {
  const s = String(t == null ? '' : t).replace(PROIBIDOS_RE, ' ').replace(/\s+/g, ' ').replace(/^[.\s]+|[.\s]+$/g, '');
  return max ? s.slice(0, max).replace(/[.\s]+$/g, '') : s;
}

/**
 * Extensão do arquivo original: minúscula, "jpeg" vira "jpg". Sem extensão,
 * vazio (o nome fica sem ponto).
 * @param {unknown} nome
 */
export function extDe(nome) {
  const m = /[.]([A-Za-z0-9]{1,8})$/.exec(String(nome || ''));
  if (!m) return '';
  const e = m[1].toLowerCase();
  return e === 'jpeg' ? 'jpg' : e;
}

/** AAAAMMDDHHMMSS (número) → "AAAA-MM-DD HHhMMmSS". @param {number} h */
export function horaLegivel(h) {
  const t = String(h).padStart(14, '0');
  return `${t.slice(0, 4)}-${t.slice(4, 6)}-${t.slice(6, 8)} ${t.slice(8, 10)}h${t.slice(10, 12)}m${t.slice(12, 14)}`;
}

/**
 * Os nomes de uma listagem BRUTA (antes de esconder as ocultas: a numeração e
 * as colisões não podem mudar quando o dono oculta uma foto).
 *
 * Sem `id`, calcula tudo (a página); com `id`, para na foto pedida (o
 * download) e devolve só ela.
 * @param {import('./drive.js').ListagemDrive} listagem
 * @param {{ titulo?: string, capitulo?: string }} ctx
 * @param {string} [id]
 * @returns {{ pre: string[], cauda: Record<string, string> }}
 */
export function nomesDaListagem(listagem, ctx, id) {
  const aut = Array.isArray(listagem.aut) && listagem.aut.length ? listagem.aut : [''];
  const titulo = limpaParte(ctx.titulo);
  const capitulo = limpaParte(ctx.capitulo);
  const pre = listagem.secoes.map(s =>
    [titulo, capitulo, limpaParte(s.nome)].filter(Boolean).join(' - ').slice(0, NOME_PRE_MAX).replace(/[.\s]+$/g, ''));
  /** @type {Record<string, string>} */
  const cauda = {};
  /** @type {Map<string, number>} */
  const vistos = new Map();
  for (let si = 0; si < listagem.secoes.length; si++) {
    const fotos = listagem.secoes[si].fotos;
    for (let k = 0; k < fotos.length; k++) {
      const f = fotos[k];
      const autor = limpaParte(aut[f[5] || 0], NOME_AUTOR_MAX);
      const quando = f[6] ? horaLegivel(f[6]) : String(k + 1).padStart(3, '0');
      const meio = [autor, quando].filter(Boolean).join(' - ');
      let c = (pre[si] ? ' - ' : '') + meio;
      const chave = `${pre[si]}\u0001${c}\u0001${extDe(f[3])}`;
      const n = (vistos.get(chave) || 0) + 1;
      vistos.set(chave, n);
      if (n > 1) c += `-${n}`;
      cauda[f[0]] = c;
      if (id !== undefined && f[0] === id) return { pre, cauda };
    }
  }
  return { pre, cauda };
}

/**
 * O nome final de UMA foto da listagem (o do download).
 * @param {import('./drive.js').ListagemDrive} listagem
 * @param {{ titulo?: string, capitulo?: string }} ctx
 * @param {string} id
 * @param {string} nomeDoArquivo o arquivo que vai ser entregue (original ou do Instagram): dele sai a extensão
 * @returns {string | null} null se a foto não está na listagem
 */
export function nomeAmigavel(listagem, ctx, id, nomeDoArquivo) {
  const { pre, cauda } = nomesDaListagem(listagem, ctx, id);
  const c = cauda[id];
  if (c === undefined) return null;
  const si = listagem.secoes.findIndex(s => s.fotos.some(f => f[0] === id));
  const ext = extDe(nomeDoArquivo);
  const nome = (pre[si] || '') + c;
  // Nome só com a extensão (tudo vazio) não acontece: o número entra sempre.
  return ext ? `${nome}.${ext}` : nome;
}
