// "Mandar suas fotos" (v3.4): numa pasta colaborativa trancada para leitura, a
// turma só envia nas pastas de crédito que começam com "!" ("!turma 2026
// (adicione suas fotos aqui)"), uma em cada evento (e em cada ano ou banda). O
// botão abre um diálogo que leva à pasta certa. O que estes testes prendem:
//  1. quais pastas são de envio (chavesDeEnvio) e como são achadas
//     (pastasDeEnvio): direto no evento ou dentro de ano/banda; pasta de
//     fotógrafo nunca é aberta; teto de chamadas; capítulo que falha não
//     derruba os outros; cache que muda quando entra evento novo;
//  2. a rota: só álbum público por capítulos, antes do lançamento só o dono;
//  3. a página: dica e diálogo só quando há pasta de envio;
//  4. o script: JS válido, sem innerHTML, ordem da linha do tempo, ano/banda
//     num segundo passo, só link do Drive, e o caminho de volta se falhar.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import worker from '../src/index.js';
import { chavesDeEnvio, pastasDeEnvio, limpaCacheEnvio, limpaCacheDrive } from '../src/drive.js';
import { galeriaIndiceHTML } from '../src/ui/galeria-indice.js';
import { SCRIPT_ENVIO } from '../src/ui/album.js';
import { saveEvents } from '../src/utils.js';
import { withDurableObjects } from './helpers/do.js';
import { fakeCaches } from './helpers/caches.js';

const SITE = 'https://fotos.lucafchala.com';
const TOKEN = 'e'.repeat(64);
const RAIZ = 'RAIZ_PASTA_0001';
const ENVIO = '!turma 2026 (adicione suas fotos aqui)';
const CREDITOS = `chala = Luca F. Chala\nmag = Mag <mag@example.com>\nsanta oficial = Colégio Santa Cruz\ncomissao = Comissão de Festas\n${ENVIO} = Turma 2026\n* = Turma 2026`;

const pasta = (/** @type {string} */ id, /** @type {string} */ nome) => ({ id, name: nome, mimeType: 'application/vnd.google-apps.folder' });
/** As 5 pastas de um lugar (evento, ano ou banda); a de envio tem o ID `envio`. @param {string} p @param {string} envio */
const lugar = (p, envio) => [pasta(`${p}_CHALA_01`, 'chala'), pasta(`${p}_MAG_0001`, 'mag'), pasta(`${p}_SANTA_01`, 'santa oficial'), pasta(`${p}_COMIS_01`, 'comissao'), pasta(envio, ENVIO)];

/** @type {Record<string, any[]>} */
const ARVORE = {
  [RAIZ]: [pasta('EVA_PASTA_0001', '01 - Formatura'), pasta('EVB_PASTA_0001', '02 - Interclasse'), pasta('EVC_PASTA_0001', '03 - Sem envio'), pasta('EVD_PASTA_0001', '04 - Festival')],
  EVA_PASTA_0001: lugar('EVA', 'ENVIO_A_00001'),
  // Evento com anos: a pasta de envio está dentro de cada ano.
  EVB_PASTA_0001: [pasta('EVB_2025_0001', '2025'), pasta('EVB_2026_0001', '2026')],
  EVB_2025_0001: lugar('B25', 'ENVIO_B25_001'),
  EVB_2026_0001: lugar('B26', 'ENVIO_B26_001'),
  EVC_PASTA_0001: [pasta('EVC_CHALA_01', 'chala')],
  // Envio direto no evento E dentro de uma banda (com número de ordem).
  EVD_PASTA_0001: [...lugar('EVD', 'ENVIO_D_00001'), pasta('EVD_BANDA_001', '03 - Banda X')],
  EVD_BANDA_001: [pasta('ENVIO_DX_0001', ENVIO)],
};

/** @type {URL[]} */
let chamadas;
/** @type {Set<string>} */
let falham;

const capsDe = (/** @type {string[]} */ ids) => ({
  v: /** @type {1} */ (1), pasta: RAIZ, em: '2026-11-06T12:00:00.000Z', truncada: false,
  caps: ids.map((id, i) => ({ id, rk: '', bruto: `ev ${i}`, nome: ['Formatura', 'Interclasse', 'Sem envio', 'Festival'][i] || `Ev ${i}`, slug: `ev-${i}` })),
});
const abertas = () => chamadas.map(u => (u.searchParams.get('q') || '').match(/^'([^']+)'/)?.[1]);

function fakeKV(/** @type {Record<string, string>} */ inicial = {}) {
  const store = new Map(Object.entries(inicial));
  return {
    async get(/** @type {string} */ k) { return store.has(k) ? store.get(k) : null; },
    async put(/** @type {string} */ k, /** @type {string} */ v) { store.set(k, v); },
    async delete(/** @type {string} */ k) { store.delete(k); },
    async list() { return { keys: [], list_complete: true, cursor: null }; },
  };
}

/** @type {any} */
let env;
beforeEach(() => {
  limpaCacheEnvio();
  limpaCacheDrive();
  chamadas = [];
  falham = new Set();
  vi.stubGlobal('fetch', vi.fn(async (/** @type {any} */ input) => {
    const url = new URL(typeof input === 'string' ? input : input.url);
    if (url.pathname === '/drive/v3/files') {
      chamadas.push(url);
      const id = (url.searchParams.get('q') || '').match(/^'([^']+)' in parents/)?.[1] || '';
      if (falham.has(id)) return Response.json({ error: { code: 500, message: 'x' } }, { status: 500 });
      return Response.json({ files: ARVORE[id] || [] });
    }
    return new Response('nao esperado', { status: 599 });
  }));
  env = withDurableObjects({
    FOTOS: fakeKV({ [`admin_session:${TOKEN}`]: JSON.stringify({ createdAt: Date.now() }) }),
    GOOGLE_DRIVE_API_KEY: 'AIzaChaveDeTeste123',
    SIGNING_SECRET: 's'.repeat(48),
  });
});
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });

describe('quais pastas são de envio', () => {
  it('as chaves de crédito que começam com "!" (sem acento, minúsculas); "outros" e "*" não', () => {
    expect([...chavesDeEnvio(CREDITOS)]).toEqual([ENVIO]);
    expect([...chavesDeEnvio('!Turmã  2026 = T\noutros = T\n* = T')]).toEqual(['!turma 2026']);
    expect(chavesDeEnvio('')).toEqual(new Set());
    expect(chavesDeEnvio(42)).toEqual(new Set());
  });
});

describe('pastasDeEnvio', () => {
  const todas = ['EVA_PASTA_0001', 'EVB_PASTA_0001', 'EVC_PASTA_0001', 'EVD_PASTA_0001'];

  it('acha a pasta direto no evento e dentro de cada ano ou banda, sem número de ordem no rótulo', async () => {
    const r = await pastasDeEnvio(env, capsDe(todas), CREDITOS);
    expect(r).toEqual([
      { evento: 'Formatura', cap: 'ev-0', rotulo: '', id: 'ENVIO_A_00001', rk: '' },
      { evento: 'Interclasse', cap: 'ev-1', rotulo: '2025', id: 'ENVIO_B25_001', rk: '' },
      { evento: 'Interclasse', cap: 'ev-1', rotulo: '2026', id: 'ENVIO_B26_001', rk: '' },
      { evento: 'Festival', cap: 'ev-3', rotulo: '', id: 'ENVIO_D_00001', rk: '' },
      { evento: 'Festival', cap: 'ev-3', rotulo: 'Banda X', id: 'ENVIO_DX_0001', rk: '' },
    ]);
  });

  it('só lista pastas, e nunca abre pasta de fotógrafo (chala, mag, santa oficial, comissao)', async () => {
    await pastasDeEnvio(env, capsDe(todas), CREDITOS);
    for (const u of chamadas) expect(u.searchParams.get('q')).toContain("mimeType = 'application/vnd.google-apps.folder'");
    expect(abertas()).toEqual(['EVA_PASTA_0001', 'EVB_PASTA_0001', 'EVB_2025_0001', 'EVB_2026_0001', 'EVC_PASTA_0001', 'EVD_PASTA_0001', 'EVD_BANDA_001']);
  });

  it('sem pasta de envio nos créditos, nenhuma chamada', async () => {
    expect(await pastasDeEnvio(env, capsDe(todas), 'chala = Luca\noutros = Turma')).toEqual([]);
    expect(chamadas).toHaveLength(0);
  });

  it('um evento que falha não derruba os outros', async () => {
    falham.add('EVB_PASTA_0001');
    const r = await pastasDeEnvio(env, capsDe(todas), CREDITOS);
    expect(r.map(p => p.id)).toEqual(['ENVIO_A_00001', 'ENVIO_D_00001', 'ENVIO_DX_0001']);
  });

  it('teto de chamadas ao Drive (plano grátis: 50 por pedido)', async () => {
    const muitos = Array.from({ length: 30 }, (_, i) => `MUITO_${String(i).padStart(4, '0')}_01`);
    for (const id of muitos) ARVORE[id] = [pasta(`${id}_A`, 'Ano A'), pasta(`${id}_B`, 'Ano B')];
    try {
      await pastasDeEnvio(env, capsDe(muitos), CREDITOS);
      expect(chamadas.length).toBeLessThanOrEqual(40);
    } finally {
      for (const id of muitos) delete ARVORE[id];
    }
  });

  it('cache: a segunda leitura não chama o Drive; evento novo entra na hora', async () => {
    vi.stubGlobal('caches', fakeCaches());
    await pastasDeEnvio(env, capsDe(todas.slice(0, 2)), CREDITOS);
    const n = chamadas.length;
    await pastasDeEnvio(env, capsDe(todas.slice(0, 2)), CREDITOS);
    expect(chamadas.length).toBe(n);
    // Outro isolate (memória vazia) usa a Cache API.
    limpaCacheEnvio();
    await pastasDeEnvio(env, capsDe(todas.slice(0, 2)), CREDITOS);
    expect(chamadas.length).toBe(n);
    // Evento novo na pasta: a assinatura muda e a lista é lida de novo.
    const r = await pastasDeEnvio(env, capsDe(todas), CREDITOS);
    expect(chamadas.length).toBeGreaterThan(n);
    expect(r.map(p => p.evento)).toContain('Festival');
  });
});

const EVENTO = {
  id: '1', slug: 'entrenos2026', title: 'Entre Nós', accessType: 'public', galeriaCapitulos: true,
  driveUrl: `https://drive.google.com/drive/folders/${RAIZ}`, galeriaCreditos: CREDITOS,
};
const api = async (/** @type {Record<string, any>} */ ev, { dono = false, slug = 'entrenos2026' } = {}) => {
  await saveEvents(env, [{ ...EVENTO, ...ev }]);
  /** @type {Record<string, string>} */
  const headers = { 'CF-Connecting-IP': '203.0.113.9' };
  if (dono) headers.Cookie = `__Host-session=${TOKEN}`;
  return worker.fetch(new Request(`${SITE}/api/galeria/envio?slug=${encodeURIComponent(slug)}`, { headers }), env, { waitUntil() {} });
};

describe('GET /api/galeria/envio', () => {
  it('álbum público: evento, rótulo e o link da pasta no Drive', async () => {
    const res = await api({});
    expect(res.status).toBe(200);
    expect(res.headers.get('Cache-Control')).toBe('private, max-age=600');
    const j = await res.json();
    expect(j.pastas).toHaveLength(5);
    // A ordem é a dos capítulos; o diálogo reordena pela linha do tempo da página.
    expect(j.pastas).toContainEqual({ evento: 'Formatura', cap: 'formatura', rotulo: '', url: 'https://drive.google.com/drive/folders/ENVIO_A_00001' });
    expect(j.pastas).toContainEqual({ evento: 'Festival', cap: 'festival', rotulo: 'Banda X', url: 'https://drive.google.com/drive/folders/ENVIO_DX_0001' });
    // Nada de ID cru nem e-mail dos créditos.
    expect(JSON.stringify(j)).not.toContain('@');
  });

  it('antes do lançamento ("Em breve"), só o dono', async () => {
    expect((await api({ comingSoon: true, visible: false })).status).toBe(404);
    expect((await api({ comingSoon: true, visible: false }, { dono: true })).status).toBe(200);
  });

  it('família/privado, sem capítulos ou slug inválido: nada', async () => {
    expect((await api({ accessType: 'family' })).status).toBe(404);
    expect((await api({ galeriaCapitulos: false })).status).toBe(404);
    expect((await api({}, { slug: '../x' })).status).toBe(400);
    expect((await api({}, { slug: 'outro' })).status).toBe(404);
  });

  it('Drive fora do ar: 503, e a página manda abrir a pasta do álbum', async () => {
    falham.add(RAIZ);
    expect((await api({})).status).toBe(503);
  });
});

describe('a página do álbum', () => {
  const caps = capsDe(['EVA_PASTA_0001', 'EVB_PASTA_0001']);
  const pagina = (/** @type {Record<string, any>} */ ev = {}) => galeriaIndiceHTML({
    event: /** @type {any} */ ({ ...EVENTO, galeriaAbertura: 'Oi.', ...ev }), caps, resumo: {}, ocultas: [], dono: false, indexavel: true, nonce: 'N',
  });

  it('com pasta de envio: a dica nova, o diálogo e o script; o botão continua link para a pasta do álbum', () => {
    const h = pagina();
    expect(h).toContain('<p class="al-dica">Toque em <b>Mandar suas fotos</b> e escolha o evento.</p>');
    expect(h).toContain('<dialog class="rs al-env" id="al-env" aria-labelledby="al-env-t" data-slug="entrenos2026">');
    expect(h).toContain(`<script nonce="N">${SCRIPT_ENVIO}</script>`);
    expect(h).toContain(`href="https://drive.google.com/drive/folders/${RAIZ}" target="_blank" rel="nofollow noopener" data-acao="mandar-fotos">Mandar suas fotos</a>`);
    expect(h).toContain('Fazer upload');
  });

  it('só "outros" (o jeito antigo): a dica antiga, sem diálogo', () => {
    const h = pagina({ galeriaCreditos: 'chala = Luca\noutros = Turma 2026' });
    expect(h).toContain('a pasta <b>outros</b>');
    expect(h).not.toContain('id="al-env"');
  });

  it('família/privado ou sem créditos de envio: nada', () => {
    for (const ev of [{ accessType: 'family' }, { galeriaCreditos: 'chala = Luca' }]) {
      const h = pagina(ev);
      expect(h).not.toContain('id="al-env"');
      expect(h).not.toContain('al-dica">Toque');
    }
  });
});

// DOM mínimo para rodar o script do diálogo de verdade (o projeto não tem jsdom).
class El {
  constructor(/** @type {string} */ tag, /** @type {Record<string, string>} */ attrs = {}) {
    this.tagName = tag.toUpperCase();
    this.attrs = { ...attrs };
    /** @type {El[]} */
    this.children = [];
    this.textContent = '';
    this.className = '';
    this.hidden = false;
    this.open = false;
    /** @type {Record<string, Function[]>} */
    this.ouvintes = {};
    this.focado = false;
  }
  get firstChild() { return this.children[0] || null; }
  appendChild(/** @type {El} */ c) { this.children.push(c); return c; }
  removeChild(/** @type {El} */ c) { this.children = this.children.filter(x => x !== c); return c; }
  getAttribute(/** @type {string} */ k) { return k in this.attrs ? this.attrs[k] : null; }
  addEventListener(/** @type {string} */ t, /** @type {Function} */ f) { (this.ouvintes[t] ||= []).push(f); }
  dispara(/** @type {string} */ t, /** @type {any} */ e = {}) { for (const f of this.ouvintes[t] || []) f({ preventDefault() { e.prevenido = true; }, ...e }); return e; }
  showModal() { this.open = true; }
  close() { this.open = false; }
  focus() { this.focado = true; }
  /** @returns {El[]} */
  todos() { return this.children.flatMap(c => [c, ...c.todos()]); }
  querySelector(/** @type {string} */ s) {
    if (s === 'a') return this.todos().find(c => c.tagName === 'A') || null;
    if (s === '[data-env="fechar"]') return this.todos().find(c => c.attrs['data-env'] === 'fechar') || null;
    throw new Error(`seletor não simulado: ${s}`);
  }
  /** O texto visível de uma opção (nome + subtítulo). */
  get texto() { return this.textContent + this.children.map(c => c.texto).join('|'); }
}

function montaDOM(/** @type {string[]} */ ordemDosCards) {
  const fechar = new El('button', { 'data-env': 'fechar' });
  const d = new El('dialog', { 'data-slug': 'entrenos2026' });
  d.appendChild(fechar);
  const ids = { 'al-env': d, 'al-env-lista': new El('ul'), 'al-env-t': new El('p'), 'al-env-msg': new El('p'), 'al-env-voltar': new El('button') };
  const botao = new El('a', { 'data-acao': 'mandar-fotos' });
  const cards = ordemDosCards.map(c => new El('a', { 'data-cap': c }));
  const document = {
    querySelector: (/** @type {string} */ s) => (s === '[data-acao="mandar-fotos"]' ? botao : null),
    getElementById: (/** @type {string} */ id) => /** @type {any} */ (ids)[id] || null,
    querySelectorAll: (/** @type {string} */ s) => (s === '.ix-card[data-cap]' ? cards : []),
    createElement: (/** @type {string} */ t) => new El(t),
  };
  return { document, botao, ...ids };
}

/** Roda o script com o DOM simulado e um fetch dado. */
function roda(/** @type {string[]} */ cards, /** @type {Function} */ fetch) {
  const dom = montaDOM(cards);
  new Function('document', 'window', 'fetch', SCRIPT_ENVIO)(dom.document, { fetch }, fetch);
  return dom;
}
const espera = () => new Promise(r => setTimeout(r, 0));
const PASTAS = [
  { evento: 'Formatura', cap: 'formatura', rotulo: '', url: 'https://drive.google.com/drive/folders/ENVIO_A_00001' },
  { evento: 'Interclasse', cap: 'interclasse', rotulo: '2025', url: 'https://drive.google.com/drive/folders/ENVIO_B25_001' },
  { evento: 'Interclasse', cap: 'interclasse', rotulo: '2026', url: 'https://drive.google.com/drive/folders/ENVIO_B26_001' },
  { evento: 'Golpe', cap: 'golpe', rotulo: '', url: 'javascript:alert(1)' },
];

describe('o script do diálogo', () => {
  it('é JS válido, sem innerHTML, e só pede à própria origem', () => {
    expect(() => new Function(SCRIPT_ENVIO)).not.toThrow();
    expect(SCRIPT_ENVIO).not.toMatch(/innerHTML|insertAdjacentHTML|document\.write|outerHTML/);
    expect(SCRIPT_ENVIO).toContain("fetch('/api/galeria/envio?slug=' + encodeURIComponent(slug)");
  });

  it('abre o diálogo, lista os eventos na ordem da linha do tempo e leva à pasta certa', async () => {
    const pedidos = [];
    const dom = roda(['interclasse', 'formatura'], async (/** @type {string} */ u) => { pedidos.push(u); return { ok: true, json: async () => ({ pastas: PASTAS }) }; });
    const e = dom.botao.dispara('click', {});
    expect(e.prevenido).toBe(true);
    expect(dom['al-env'].open).toBe(true);
    expect(dom['al-env-msg'].textContent).toBe('Carregando os eventos…');
    await espera(); await espera();
    expect(pedidos).toEqual(['/api/galeria/envio?slug=entrenos2026']);
    expect(dom['al-env-t'].textContent).toBe('Para qual evento?');
    const ops = dom['al-env-lista'].children.map(li => li.children[0]);
    // Interclasse primeiro (é o primeiro cartão da página); o link que não é do Drive some.
    expect(ops.map(o => o.tagName)).toEqual(['BUTTON', 'A']);
    expect(ops[0].texto).toContain('Interclasse');
    expect(ops[0].texto).toContain('2 pastas');
    expect(ops[1]).toMatchObject({ href: PASTAS[0].url, target: '_blank', rel: 'nofollow noopener' });
    // Evento com anos: o segundo passo, com "Voltar".
    ops[0].dispara('click');
    expect(dom['al-env-t'].textContent).toBe('Interclasse');
    expect(dom['al-env-voltar'].hidden).toBe(false);
    const anos = dom['al-env-lista'].children.map(li => li.children[0]);
    expect(anos.map(a => [a.texto, a.href])).toEqual([['2025', PASTAS[1].url], ['2026', PASTAS[2].url]]);
    expect(anos[0].focado).toBe(true);
    dom['al-env-voltar'].dispara('click');
    expect(dom['al-env-t'].textContent).toBe('Para qual evento?');
    // Fechar e abrir de novo não pede a lista outra vez.
    dom['al-env'].children[0].dispara('click');
    expect(dom['al-env'].open).toBe(false);
    dom.botao.dispara('click', {});
    expect(pedidos).toHaveLength(1);
  });

  it('Ctrl/Cmd+clique segue o link normal (a pasta do álbum)', () => {
    const dom = roda([], async () => ({ ok: true, json: async () => ({ pastas: PASTAS }) }));
    expect(dom.botao.dispara('click', { ctrlKey: true }).prevenido).toBeUndefined();
    expect(dom['al-env'].open).toBe(false);
  });

  it('se a lista não vem, explica e deixa o link da pasta do álbum', async () => {
    for (const resposta of [async () => ({ ok: false, json: async () => ({}) }), async () => ({ ok: true, json: async () => ({ pastas: [] }) }), async () => { throw new Error('rede'); }]) {
      const dom = roda([], resposta);
      dom.botao.dispara('click', {});
      await espera(); await espera();
      expect(dom['al-env-msg'].textContent).toContain('Abra a pasta do álbum');
      expect(dom['al-env-lista'].children).toHaveLength(0);
    }
  });
});
