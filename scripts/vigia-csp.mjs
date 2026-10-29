// O vigia de CSP dos roteiros de navegador: UMA definição de "mensagem de CSP"
// para todos eles.
//
// Antes, cada roteiro tinha a sua cópia do filtro, e as cópias divergiram:
// painel, prévia e navegador descartavam de propósito a Report-Only
// (`!/Report Only/i`), a galeria só a separava numa lista que ninguém lia, e o
// roteiro do evento nem servia a página com cabeçalho de CSP. A política
// estrita só tinha como ser medida em produção, pelos relatórios. Agora ela é a
// APLICADA (#126): qualquer mensagem de CSP no console — um script ou um
// handler inline sem nonce, uma origem fora da lista, um aviso de diretiva
// ignorada — é uma FALHA, em qualquer roteiro.
//
// Todas as mensagens de CSP do Chromium trazem a frase "Content Security
// Policy" ("Refused to execute inline script because it violates the following
// Content Security Policy directive…"; a report-only vem com "[Report Only]" na
// frente), e os avisos de análise da política trazem "Content-Security-Policy"
// com hífens. Um padrão só, largo de propósito: filtrar por "Refused to" ou
// pela diretiva deixaria passar o aviso que não bloqueia nada mas diz que a
// política não é a que escrevemos.

/* global window */
import { htmlSecurityHeaders } from '../src/security.js';

/** @param {string} texto */
export const ehMensagemDeCsp = texto => /Content[ -]Security[ -]Policy|\[Report Only\]/i.test(texto);

/**
 * Anota em `mensagens` toda mensagem de CSP que a página escrever no console,
 * com o arquivo e a linha de onde veio — o texto sozinho não diz qual bloco
 * da página foi o culpado.
 * @param {import('playwright-core').Page} page
 * @param {string[]} mensagens
 */
export function vigiaCsp(page, mensagens) {
  page.on('console', m => {
    const t = m.text();
    if (!ehMensagemDeCsp(t)) return;
    const { url, lineNumber } = m.location();
    mensagens.push(`${t.slice(0, 150)}${url ? ` [${url.slice(0, 80)}:${lineNumber}]` : ''}`);
  });
}

// A página do cão de guarda: um script e um handler SEM nonce (o que a política
// estrita tem de barrar) e um script COM nonce (o que ela tem de deixar rodar —
// sem este, "tudo bloqueado" também passaria como "bloqueou o que devia").
const NONCE_DO_CANARIO = 'canario123';
const PAGINA_DO_CANARIO = `<!DOCTYPE html><html lang="pt-BR"><head><meta charset="utf-8"><title>canário</title>
<script>window.__semNonce = 1;</script></head>
<body><button id="b" type="button" onclick="window.__handler = 1">x</button>
<script nonce="${NONCE_DO_CANARIO}">window.__comNonce = 1;</script></body></html>`;

/**
 * A prova de que o vigia vigia. "Nenhuma violação da CSP" é uma checagem de
 * AUSÊNCIA, e ausência passa de graça quando o vigia está cego: o Chromium
 * muda o texto de uma mensagem, o padrão acima ganha um erro de digitação, e
 * todo roteiro segue verde para sempre. Por isso cada roteiro começa por aqui:
 * serve uma página com os cabeçalhos REAIS do site (htmlSecurityHeaders) e um
 * script e um handler inline sem nonce, e confere (1) que o vigia ouviu os dois
 * e (2) que a política os BLOQUEOU — o com nonce roda, os sem nonce não. Nenhum
 * roteiro precisa de outro cuidado para saber que a verde dele quer dizer algo.
 * @param {import('playwright-core').Browser} browser
 * @param {(ok: boolean, nome: string, detalhe?: unknown) => void} registra
 */
export async function provaOVigia(browser, registra) {
  const ctx = await browser.newContext();
  try {
    const page = await ctx.newPage();
    /** @type {string[]} */
    const mensagens = [];
    vigiaCsp(page, mensagens);
    await page.route('https://csp.test/**', route => route.fulfill({
      status: 200, headers: htmlSecurityHeaders(NONCE_DO_CANARIO), body: PAGINA_DO_CANARIO,
    }));
    await page.goto('https://csp.test/');
    await page.click('#b');
    await page.waitForTimeout(150);
    const rodou = await page.evaluate(() => {
      const w = /** @type {any} */ (window);
      return { semNonce: w.__semNonce === 1, handler: w.__handler === 1, comNonce: w.__comNonce === 1 };
    });
    const viu = {
      script: mensagens.some(t => /inline script/i.test(t)),
      handler: mensagens.some(t => /inline event handler/i.test(t)),
    };
    registra(viu.script && viu.handler,
      'vigia de CSP: enxerga um script inline e um handler inline sem nonce (sem isto, "nenhuma violação" não prova nada)',
      { viu, mensagens });
    // Só a política APLICADA barra: se este check cair, o cabeçalho servido
    // voltou a aceitar 'unsafe-inline' (ou um Report-Only está fazendo as
    // vezes dela) e a estrita deixou de valer — o que nenhuma outra checagem
    // de ausência perceberia.
    registra(!rodou.semNonce && !rodou.handler && rodou.comNonce,
      'CSP servida pelo site: BLOQUEIA o script e o handler inline sem nonce e deixa rodar o que tem nonce',
      rodou);
  } finally {
    await ctx.close();
  }
}
