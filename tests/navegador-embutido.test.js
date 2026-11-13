// Aviso para o navegador embutido de um app (v3.11.0, src/ui/navegador-embutido.js).
// O que estes testes prendem: quem é detectado (e o WhatsApp, não); o script é
// JS válido, sem innerHTML, e só mostra a faixa quando a pessoa toca em
// baixar ou em ligar os avisos — sem impedir a ação; no Android, o link
// `intent://` leva ao Chrome com o mesmo endereço; e as três páginas do álbum
// incluem a faixa. O comportamento num Chromium de verdade está em
// `npm run verifica:celular` (cenário "navegador do Instagram").
import { describe, it, expect } from 'vitest';
import { navegadorEmbutido, EMBUTIDO_FONTE, SCRIPT_EMBUTIDO, navegadorEmbutidoHTML } from '../src/ui/navegador-embutido.js';
import { galeriaIndiceHTML } from '../src/ui/galeria-indice.js';
import { galeriaHTML } from '../src/ui/galeria.js';

const UA = {
  instagramIos: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 Instagram 330.0.0.0 (iPhone14,5; iOS 17_5; pt_BR)',
  instagramAndroid: 'Mozilla/5.0 (Linux; Android 14; SM-S911B Build/UP1A; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/124.0 Mobile Safari/537.36 Instagram 330.0.0.0 Android',
  facebook: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 [FBAN/FBIOS;FBAV/470.0.0;FBBV/1]',
  tiktok: 'Mozilla/5.0 (Linux; Android 13; Pixel 7; wv) AppleWebKit/537.36 Chrome/120.0 Mobile Safari/537.36 musical_ly_2023 BytedanceWebview/d8a21c6',
  webview: 'Mozilla/5.0 (Linux; Android 13; Pixel 7; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/120.0 Mobile Safari/537.36',
  safari: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1',
  chrome: 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Mobile Safari/537.36',
  // O WhatsApp abre links no navegador de verdade: o user agent é o do Safari/Chrome.
  whatsapp: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1',
};

describe('quem é navegador embutido', () => {
  it('Instagram, Facebook, TikTok e a WebView genérica do Android, sim', () => {
    expect(navegadorEmbutido(UA.instagramIos)).toBe('Instagram');
    expect(navegadorEmbutido(UA.instagramAndroid)).toBe('Instagram');
    expect(navegadorEmbutido(UA.facebook)).toBe('Facebook');
    expect(navegadorEmbutido(UA.tiktok)).toBe('TikTok');
    expect(navegadorEmbutido(UA.webview)).toBe('deste aplicativo');
  });

  it('Safari, Chrome e o WhatsApp (que abre no navegador de verdade), não', () => {
    for (const ua of [UA.safari, UA.chrome, UA.whatsapp, '', 'Mozilla/5.0 (Windows NT 10.0) Chrome/124']) expect(navegadorEmbutido(ua)).toBe('');
  });

  it('a mesma fonte vale no servidor e no navegador (sem barra invertida, que o template dobraria)', () => {
    expect(EMBUTIDO_FONTE).not.toContain('\\');
    expect(SCRIPT_EMBUTIDO).toContain(JSON.stringify(EMBUTIDO_FONTE));
  });
});

describe('o script', () => {
  it('é JS válido, sem innerHTML, sem crase nem barra invertida', () => {
    expect(() => new Function(SCRIPT_EMBUTIDO)).not.toThrow();
    expect(SCRIPT_EMBUTIDO).not.toMatch(/innerHTML|insertAdjacentHTML|document\.write|outerHTML|`|\\/);
  });

  /** DOM mínimo: os elementos da faixa e um botão de baixar, com ouvintes. */
  function roda(/** @type {string} */ ua, { fechado = false } = {}) {
    /** @param {string} id */
    const el = id => ({
      id, hidden: true, href: '#', textContent: '', filhos: /** @type {any[]} */ ([]), ouvintes: /** @type {Record<string, Function[]>} */ ({}),
      appendChild(/** @type {any} */ c) { this.filhos.push(c); return c; },
      addEventListener(/** @type {string} */ t, /** @type {Function} */ f) { (this.ouvintes[t] ||= []).push(f); },
      contains(/** @type {any} */ x) { return x === this; },
    });
    const ids = Object.fromEntries(['nav-emb', 'nav-emb-txt', 'nav-emb-abrir', 'nav-emb-copiar', 'nav-emb-fechar'].map(i => [i, el(i)]));
    /** @type {Function[]} */
    const capturas = [];
    const guardado = new Map(fechado ? [['nav-emb-fechado', '1']] : []);
    const document = {
      getElementById: (/** @type {string} */ i) => ids[i] || null,
      createElement: () => ({ textContent: '' }),
      createTextNode: (/** @type {string} */ t) => ({ textContent: t }),
      addEventListener: (/** @type {string} */ t, /** @type {Function} */ f, /** @type {boolean} */ cap) => { if (t === 'click' && cap) capturas.push(f); },
    };
    const sessionStorage = { getItem: (/** @type {string} */ k) => guardado.get(k) || null, setItem: (/** @type {string} */ k, /** @type {string} */ v) => guardado.set(k, v) };
    const location = { host: 'entrenos2026.com', pathname: '/formatura', search: '?foto=ABC', hash: '#x', origin: 'https://entrenos2026.com', href: 'https://entrenos2026.com/formatura?foto=ABC#x' };
    new Function('document', 'navigator', 'sessionStorage', 'location', 'window', SCRIPT_EMBUTIDO)(document, { userAgent: ua }, sessionStorage, location, {});
    /** Um toque num elemento que casa (ou não) com o seletor dos gatilhos. */
    const toca = (/** @type {boolean} */ gatilho) => {
      let impedido = false;
      for (const f of capturas) f({ target: { closest: () => (gatilho ? {} : null) }, preventDefault() { impedido = true; }, stopPropagation() { impedido = true; } });
      return impedido;
    };
    return { ids, capturas, toca, guardado };
  }

  it('fora de navegador embutido, não faz nada', () => {
    const r = roda(UA.safari);
    expect(r.capturas).toHaveLength(0);
    expect(r.ids['nav-emb'].hidden).toBe(true);
  });

  it('no Instagram do iPhone: nada na entrada; ao tocar em baixar, a faixa aparece com o caminho, sem impedir o download', () => {
    const r = roda(UA.instagramIos);
    expect(r.ids['nav-emb'].hidden).toBe(true);
    expect(r.toca(false)).toBe(false);
    expect(r.ids['nav-emb'].hidden).toBe(true);
    expect(r.toca(true)).toBe(false);
    expect(r.ids['nav-emb'].hidden).toBe(false);
    const texto = r.ids['nav-emb-txt'].filhos.map((/** @type {any} */ f) => f.textContent).join('');
    expect(texto).toContain('Você está no navegador do Instagram.');
    expect(texto).toContain('Abrir no navegador');
    // No iPhone não há link que tire a pessoa do app.
    expect(r.ids['nav-emb-abrir'].hidden).toBe(true);
  });

  it('no Android: "Abrir no Chrome" com o mesmo endereço (sem o fragmento)', () => {
    const r = roda(UA.instagramAndroid);
    r.toca(true);
    expect(r.ids['nav-emb-abrir'].hidden).toBe(false);
    expect(r.ids['nav-emb-abrir'].href).toBe('intent://entrenos2026.com/formatura?foto=ABC#Intent;scheme=https;package=com.android.chrome;S.browser_fallback_url=' + encodeURIComponent('https://entrenos2026.com/formatura?foto=ABC') + ';end');
  });

  it('numa WebView genérica do Android, sem "Abrir no Chrome" (o app pode não tratar intent://): só copiar o link', () => {
    const r = roda(UA.webview);
    r.toca(true);
    expect(r.ids['nav-emb'].hidden).toBe(false);
    expect(r.ids['nav-emb-abrir'].hidden).toBe(true);
    const texto = r.ids['nav-emb-txt'].filhos.map((/** @type {any} */ f) => f.textContent).join('');
    expect(texto).toContain('Copie o link e abra no Chrome.');
  });

  it('fechada, não volta nesta aba', () => {
    const r = roda(UA.facebook);
    r.toca(true);
    for (const f of r.ids['nav-emb-fechar'].ouvintes.click) f();
    expect(r.ids['nav-emb'].hidden).toBe(true);
    expect(r.guardado.get('nav-emb-fechado')).toBe('1');
    const outra = roda(UA.facebook, { fechado: true });
    expect(outra.capturas).toHaveLength(0);
  });
});

describe('as páginas do álbum incluem a faixa', () => {
  const EVENTO = /** @type {any} */ ({ id: '1', slug: 'formatura', title: 'Formatura', accessType: 'public', galeriaCapitulos: true, driveUrl: 'https://drive.google.com/drive/folders/RAIZ_PASTA_0001' });
  const caps = /** @type {any} */ ({ v: 1, pasta: 'RAIZ_PASTA_0001', em: '2026-11-06T12:00:00.000Z', truncada: false, caps: [{ id: 'CAP1_PASTA_001', rk: '', bruto: 'Festa', nome: 'Festa', slug: 'festa' }] });
  const comFaixa = (/** @type {string} */ h) => h.includes('id="nav-emb"') && h.includes(`<script nonce="N">${SCRIPT_EMBUTIDO}</script>`);

  it('o índice clássico e a apresentação (com texto de abertura)', () => {
    expect(comFaixa(galeriaIndiceHTML({ event: EVENTO, caps, resumo: {}, ocultas: [], dono: false, indexavel: true, nonce: 'N' }))).toBe(true);
    expect(comFaixa(galeriaIndiceHTML({ event: { ...EVENTO, galeriaAbertura: 'Oi.' }, caps, resumo: {}, ocultas: [], dono: false, indexavel: true, nonce: 'N' }))).toBe(true);
  });

  it('a página do evento', () => {
    const h = galeriaHTML({
      event: EVENTO, nonce: 'N', erro: null,
      listagem: /** @type {any} */ ({ v: 3, pasta: 'P', em: '2026-11-06T12:00:00.000Z', truncada: false, total: 1, videos: 0, outros: 0, rk: {}, aut: ['Luca'], secoes: [{ nome: '', caminho: '', fotos: [['FOTO_AAAAAAAAAA', 6000, 4000, '1.jpg', 100]] }] }),
    });
    expect(comFaixa(h)).toBe(true);
  });

  it('o bloco inteiro: CSS, faixa e script com nonce', () => {
    const h = navegadorEmbutidoHTML('N');
    expect(h).toContain('<style>.nav-emb{');
    expect(h).toContain('role="region"');
    expect(h).toContain(`<script nonce="N">${SCRIPT_EMBUTIDO}</script>`);
  });
});

describe('o aviso de foto nova dentro de um app', () => {
  /** Roda o SCRIPT_AVISO sem PushManager (como no navegador de um app). */
  async function aviso(/** @type {string} */ ua) {
    const { SCRIPT_AVISO } = await import('../src/ui/indice-comum.js');
    /** @param {string} id */
    const el = id => ({ id, hidden: true, textContent: '', getAttribute: () => 'formatura', addEventListener() {} });
    const ids = Object.fromEntries(['av', 'av-btn', 'av-txt', 'av-msg'].map(i => [i, el(i)]));
    const document = { getElementById: (/** @type {string} */ i) => ids[i] || null };
    new Function('document', 'navigator', 'window', SCRIPT_AVISO)(document, { userAgent: ua, platform: '', maxTouchPoints: 0 }, {});
    return ids;
  }

  it('no Instagram do iPhone: diz para abrir no navegador, não para "Adicionar à Tela de Início"', async () => {
    const ids = await aviso(UA.instagramIos);
    expect(ids.av.hidden).toBe(false);
    expect(ids['av-btn'].hidden).toBe(true);
    expect(ids['av-msg'].textContent).toContain('Abra o álbum no navegador');
    expect(ids['av-msg'].textContent).not.toContain('Tela de Início');
  });

  it('no Instagram do Android também (o caso que quebrava calado)', async () => {
    const ids = await aviso(UA.instagramAndroid);
    expect(ids.av.hidden).toBe(false);
    expect(ids['av-btn'].hidden).toBe(true);
    expect(ids['av-msg'].textContent).toContain('Abra o álbum no navegador');
  });

  it('no Safari do iPhone, continua a orientação da Tela de Início', async () => {
    const ids = await aviso(UA.safari);
    expect(ids['av-msg'].textContent).toContain('Adicionar à Tela de Início');
  });
});
