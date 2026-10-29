// Contrato do beacon de performance ampliado: INP, CLS e erros de JavaScript
// (handlePerfBeacon em src/index.js, script em perfBootScript, src/utils.js).
// O comportamento antigo (204 sempre, Origin, números implausíveis) continua
// em tests/drive-gate.test.js.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { handlePerfBeacon } from '../src/index.js';
import { perfBootScript, limparMensagemErro, PERF_ERR_LEN, PERF_ERR_MAX } from '../src/utils.js';

const SITE = 'https://fotos.lucafchala.com';

// Teto de erros por minuto vive em memória do módulo: cada teste começa numa
// janela nova, avançando o relógio (só Date) mais de 60 s.
let relogio = Date.parse('2026-01-01T00:00:00Z');

// O beacon é um POST simples de sendBeacon: só headers, corpo e request.cf
// importam para o handler.
function beacon(body, { cf } = {}) {
  const req = new Request(`${SITE}/api/perf`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: typeof body === 'string' ? body : JSON.stringify(body),
  });
  // `request.cf` quem preenche é o runtime da Cloudflare; no teste vira
  // propriedade própria para não depender do Request do Node.
  if (cf) Object.defineProperty(req, 'cf', { value: cf, configurable: true });
  return req;
}

const envComPerf = (pontos) => ({ PERF: { writeDataPoint: (d) => pontos.push(d) } });

// --- leitura do que o handler produziu --------------------------------------

let logSpy;

beforeEach(() => {
  relogio += 61000;
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(relogio);
  // O handler loga uma linha por amostra e uma por erro; silenciar o console
  // deixa a saída do vitest legível, e o spy é como conferimos o conteúdo.
  logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

const linhas = () => logSpy.mock.calls.map((args) => args.map(String).join(' '));

// `perf {json}` é a amostra; `perf-error {json}`, um erro. Os prefixos não se
// confundem porque depois de "perf" vem espaço ou hífen.
const logsComPrefixo = (prefixo) =>
  linhas().filter((l) => l.startsWith(prefixo)).map((l) => JSON.parse(l.slice(l.indexOf('{'))));

const amostras = () => logsComPrefixo('perf {');
const errosLogados = () => logsComPrefixo('perf-error {');

function amostraUnica() {
  const todas = amostras();
  expect(todas).toHaveLength(1);
  return todas[0];
}

const ehPontoDeErro = (p) => Array.isArray(p.indexes) && p.indexes[0] === 'error';

function pontoAmostra(pontos) {
  const principais = pontos.filter((p) => !ehPontoDeErro(p));
  expect(principais).toHaveLength(1);
  return principais[0];
}

const pontosDeErro = (pontos) => pontos.filter(ehPontoDeErro);

describe('handlePerfBeacon — contrato novo (inp, cls, errs)', () => {
  // -------------------------------------------------------------------------
  // inp / cls: normalização e sentinela
  // -------------------------------------------------------------------------

  it('arredonda inp para inteiro e mantém 0 como medida válida', async () => {
    const casos = [
      [1234.6, 1235],
      [0.4, 0],
      [0, 0],
      [59999.9, 60000],
      [60000, 60000],
    ];
    for (const [bruto, esperado] of casos) {
      const pontos = [];
      const res = await handlePerfBeacon(beacon({ page: 'event', inp: bruto }), envComPerf(pontos));
      expect(res.status, `inp ${bruto}`).toBe(204);
      expect(pontoAmostra(pontos).doubles[6], `inp ${bruto}`).toBe(esperado);
    }
  });

  it('arredonda cls para 3 casas, sem perder 0', async () => {
    const casos = [
      [12.3456, 12.346],
      [0.1234, 0.123],
      [0.1, 0.1],
      [0, 0],
      [100, 100],
    ];
    for (const [bruto, esperado] of casos) {
      const pontos = [];
      await handlePerfBeacon(beacon({ page: 'event', cls: bruto }), envComPerf(pontos));
      expect(pontoAmostra(pontos).doubles[7], `cls ${bruto}`).toBe(esperado);
    }
  });

  it('loga inp e cls já normalizados na amostra', async () => {
    await handlePerfBeacon(beacon({ page: 'event', inp: 1234.6, cls: 0.1234 }), envComPerf([]));
    const a = amostraUnica();
    expect(a.page).toBe('event');
    expect(a.inp).toBe(1235);
    expect(a.cls).toBe(0.123);
  });

  it('troca inp/cls implausíveis pelo sentinela -1', async () => {
    const corpos = [
      ['negativo', { inp: -1, cls: -0.0001 }],
      ['acima do teto', { inp: 60001, cls: 100.001 }],
      ['string no lugar de número', { inp: '1200', cls: '0.1' }],
      ['bool e objeto', { inp: true, cls: { v: 1 } }],
      ['ausentes', {}],
      ['null explícito', { inp: null, cls: null }],
    ];
    for (const [nome, corpo] of corpos) {
      const pontos = [];
      await handlePerfBeacon(beacon({ page: 'event', ...corpo }), envComPerf(pontos));
      const doubles = pontoAmostra(pontos).doubles;
      expect(doubles[6], nome).toBe(-1);
      expect(doubles[7], nome).toBe(-1);
    }

    // Infinity só entra por JSON cru: JSON.stringify({ inp: Infinity }) vira null.
    const pontos = [];
    await handlePerfBeacon(beacon('{"page":"event","inp":1e400,"cls":1e400}'), envComPerf(pontos));
    const doubles = pontoAmostra(pontos).doubles;
    expect(doubles[6]).toBe(-1);
    expect(doubles[7]).toBe(-1);
  });

  it('mantém doubles com 8 posições, null virando -1', async () => {
    const pontos = [];
    await handlePerfBeacon(beacon({ page: 'gallery' }), envComPerf(pontos));
    const p = pontoAmostra(pontos);
    expect(p.doubles).toEqual([-1, -1, -1, -1, -1, -1, -1, -1]);
    expect(p.blobs).toHaveLength(3);
    expect(p.indexes).toEqual(['gallery']);
  });

  // -------------------------------------------------------------------------
  // errs: formato do datapoint, k e m
  // -------------------------------------------------------------------------

  it('grava cada erro como datapoint próprio, com k/m no blob e contador 1', async () => {
    const pontos = [];
    const cf = { colo: 'GRU', country: 'BR' };
    await handlePerfBeacon(
      beacon({ page: 'event', errs: [{ k: 'rejection', m: 'promessa rejeitada' }] }, { cf }),
      envComPerf(pontos)
    );

    const erros = pontosDeErro(pontos);
    expect(erros).toHaveLength(1);
    expect(erros[0].blobs).toEqual(['event', 'GRU', 'BR', 'rejection', 'promessa rejeitada']);
    expect(erros[0].doubles).toEqual([1]);
    expect(erros[0].indexes).toEqual(['error']);
    // Só page, k, m e a região grosseira (colo/country, sem IP) no log do erro.
    expect(errosLogados()).toEqual([{ page: 'event', k: 'rejection', m: 'promessa rejeitada', colo: 'GRU', country: 'BR' }]);
    // Um erro não pode contaminar a amostra principal.
    expect(pontoAmostra(pontos).doubles).toHaveLength(8);
  });

  it('normaliza k desconhecido (ou ausente) para error', async () => {
    const pontos = [];
    await handlePerfBeacon(
      beacon({
        page: 'event',
        errs: [
          { k: 'warn', m: 'k desconhecido' },
          { k: null, m: 'k nulo' },
          { m: 'k ausente' },
        ],
      }),
      envComPerf(pontos)
    );

    const erros = pontosDeErro(pontos);
    expect(erros).toHaveLength(3);
    expect(erros.map((e) => e.blobs[3])).toEqual(['error', 'error', 'error']);
    expect(errosLogados().map((e) => e.k)).toEqual(['error', 'error', 'error']);
  });

  it('não grava nada quando errs não é um array de objetos úteis — e ainda responde 204', async () => {
    const casos = [
      ['string', 'erro qualquer'],
      ['objeto solto', { k: 'error', m: 'não é array' }],
      ['números', [1, 2, 3]],
      ['nulos', [null, null]],
      ['strings dentro do array', ['a', 'b']],
      ['m não-string', [{ k: 'error', m: 42 }, { k: 'error', m: {} }]],
      ['m vazio ou ausente', [{ k: 'error', m: '' }, { k: 'error' }, {}]],
    ];

    for (const [nome, errs] of casos) {
      const pontos = [];
      const res = await handlePerfBeacon(beacon({ page: 'event', lcp: 900, errs }), envComPerf(pontos));
      expect(res.status, nome).toBe(204);
      expect(await res.text(), nome).toBe('');
      expect(pontosDeErro(pontos), nome).toHaveLength(0);
      // A amostra principal continua indo embora; só o lixo de errs é descartado.
      expect(pontos, nome).toHaveLength(1);
      expect(errosLogados(), nome).toHaveLength(0);
    }
  });

  // -------------------------------------------------------------------------
  // limites de tamanho e volume
  // -------------------------------------------------------------------------

  it('corta mensagem gigante em 200 caracteres', async () => {
    const pontos = [];
    // 10.000 caracteres em palavras curtas: uma sequência única de 10 mil
    // letras seria um "token longo" e viraria <tok>, mascarando o corte.
    const enorme = 'erro '.repeat(2000);
    await handlePerfBeacon(beacon({ page: 'event', errs: [{ k: 'error', m: enorme }] }), envComPerf(pontos));

    const [erro] = pontosDeErro(pontos);
    expect(erro.blobs[4].length).toBeLessThanOrEqual(200);
    expect(erro.blobs[4].length).toBeGreaterThan(0);
    expect(erro.blobs[4].startsWith('erro')).toBe(true);
    // O corte é real: 41 repetições passam de 200 caracteres e não podem estar lá.
    expect(erro.blobs[4]).not.toContain('erro '.repeat(41).trimEnd());

    const [log] = errosLogados();
    expect(log.m.length).toBeLessThanOrEqual(200);
    expect(JSON.stringify(log).length).toBeLessThan(400);
  });

  it('guarda no máximo 3 erros por beacon', async () => {
    const errs = Array.from({ length: 50 }, (_, i) => ({ k: 'error', m: `falha ${i}` }));
    const pontos = [];
    await handlePerfBeacon(beacon({ page: 'event', errs }), envComPerf(pontos));

    expect(pontosDeErro(pontos)).toHaveLength(3);
    expect(errosLogados()).toHaveLength(3);
    expect(pontos).toHaveLength(4); // 1 amostra + 3 erros
    expect(amostraUnica().page).toBe('event');
  });

  it('ignora campo desconhecido de 100 KB sem ecoar no log nem no datapoint', async () => {
    const lixo = 'x'.repeat(100 * 1024);
    const pontos = [];
    const res = await handlePerfBeacon(
      beacon({ page: 'event', lcp: 900, lixo, meta: { lixo } }),
      envComPerf(pontos)
    );

    expect(res.status).toBe(204);
    expect(pontos).toHaveLength(1);
    expect(linhas()).toHaveLength(1);
    expect(linhas().join('\n').length).toBeLessThan(2000);
    expect(JSON.stringify(pontos).length).toBeLessThan(1000);
  });

  it('não deixa campo desconhecido vazar para a amostra logada', async () => {
    const pontos = [];
    await handlePerfBeacon(
      beacon({
        page: 'event',
        lcp: 900,
        inp: 100,
        cls: 0.05,
        foo: 'bar',
        segredo: 'NAO-PODE-VAZAR',
        user: { email: 'ana@exemplo.com' },
      }),
      envComPerf(pontos)
    );

    const a = amostraUnica();
    const conhecidas = new Set([
      'page', 'fcp', 'lcp', 'ttfb', 'load', 'imgCount', 'imgP50', 'imgP95',
      'filterMs', 'navCount', 'vw', 'colo', 'country', 'inp', 'cls',
    ]);
    expect(Object.keys(a).filter((k) => !conhecidas.has(k))).toEqual([]);
    expect(Object.keys(a)).toEqual(expect.arrayContaining(['page', 'inp', 'cls']));
    expect(linhas().join(' ')).not.toContain('NAO-PODE-VAZAR');

    const p = pontoAmostra(pontos);
    expect(p.blobs).toHaveLength(3);
    expect(p.doubles).toHaveLength(8);
  });

  // -------------------------------------------------------------------------
  // limpeza do texto e dedupe
  // -------------------------------------------------------------------------

  it('troca a URL inteira (com query) por <url>', async () => {
    const pontos = [];
    await handlePerfBeacon(
      beacon({ page: 'event', errs: [{ k: 'error', m: 'GET https://exemplo.com/fotos/ana.jpg?w=600 falhou' }] }),
      envComPerf(pontos)
    );

    const m = pontosDeErro(pontos)[0].blobs[4];
    expect(m).toContain('<url>');
    expect(m).not.toContain('exemplo.com');
    expect(m).not.toContain('w=600');
  });

  it('troca e-mail por <email>', async () => {
    const pontos = [];
    await handlePerfBeacon(
      beacon({ page: 'event', errs: [{ k: 'error', m: 'envio para ana.silva@exemplo.com.br falhou' }] }),
      envComPerf(pontos)
    );

    const m = pontosDeErro(pontos)[0].blobs[4];
    expect(m).toContain('<email>');
    expect(m).not.toContain('ana.silva');
    expect(m).not.toContain('exemplo.com');
  });

  it('apaga a query string solta', async () => {
    const pontos = [];
    await handlePerfBeacon(
      beacon({ page: 'event', errs: [{ k: 'error', m: 'busca ?utm_source=instagram&utm_medium=bio falhou' }] }),
      envComPerf(pontos)
    );

    const m = pontosDeErro(pontos)[0].blobs[4];
    expect(m).toBe('busca ? falhou');
    expect(m).not.toContain('utm_source');
    expect(m).not.toContain('instagram');
  });

  it('troca token de 24+ caracteres por <tok> e preserva token curto', async () => {
    const longo = 'A1b2'.repeat(6); // 24 caracteres de [A-Za-z0-9_-]
    const pontos = [];
    await handlePerfBeacon(
      beacon({
        page: 'event',
        errs: [
          { k: 'error', m: `assinatura ${longo} recusada` },
          { k: 'error', m: 'classe abc-123 ok' },
        ],
      }),
      envComPerf(pontos)
    );

    const msgs = pontosDeErro(pontos).map((e) => e.blobs[4]);
    const comToken = msgs.find((m) => m.includes('assinatura'));
    const comTokenCurto = msgs.find((m) => m.includes('classe'));

    expect(comToken).toContain('<tok>');
    expect(comToken).not.toContain(longo);
    // 7 caracteres não é token: redigir isso apagaria mensagem útil.
    expect(comTokenCurto).toContain('abc-123');
    expect(comTokenCurto).not.toContain('<tok>');
  });

  it('deduplica pelo texto já limpo, não pelo texto bruto', async () => {
    const pontos = [];
    await handlePerfBeacon(
      beacon({
        page: 'event',
        errs: [
          { k: 'error', m: 'Falha ao carregar https://a.example/1' },
          { k: 'error', m: 'Falha ao carregar https://a.example/1' },
          // Só é duplicata depois da limpeza: as URLs brutas são diferentes.
          { k: 'error', m: 'Falha ao carregar https://b.example/2' },
          { k: 'error', m: 'Outra falha' },
        ],
      }),
      envComPerf(pontos)
    );

    const erros = pontosDeErro(pontos);
    expect(erros.map((e) => e.blobs[4])).toEqual(['Falha ao carregar <url>', 'Outra falha']);
    expect(errosLogados()).toHaveLength(2);
    expect(errosLogados().map((e) => e.m)).toEqual(['Falha ao carregar <url>', 'Outra falha']);
  });
});

describe('handlePerfBeacon — teto de erros e custo', () => {
  beforeEach(() => { vi.spyOn(console, 'log').mockImplementation(() => {}); });

  it('passa de 120 erros por minuto no isolate: descarta os erros, mantém a métrica', async () => {
    relogio += 61000;
    vi.setSystemTime(relogio);
    const pontos = [];
    const env = envComPerf(pontos);
    let n = 0;
    // 41 beacons de 3 erros distintos = 123 > 120: o último não passa inteiro.
    for (let i = 0; i < 41; i++) {
      const errs = [0, 1, 2].map(j => ({ k: 'error', m: `falha ${i}-${j}` }));
      expect((await handlePerfBeacon(beacon({ page: 'event', lcp: 900, errs }), env)).status).toBe(204);
      n++;
    }
    expect(pontosDeErro(pontos)).toHaveLength(120);
    // Todas as 41 amostras de métrica foram registradas, inclusive a sem erros.
    expect(pontos.filter(p => !ehPontoDeErro(p))).toHaveLength(n);
    // Passado 1 minuto a janela reabre.
    vi.setSystemTime(relogio + 61000);
    await handlePerfBeacon(beacon({ page: 'event', errs: [{ k: 'error', m: 'de novo' }] }), env);
    expect(pontosDeErro(pontos)).toHaveLength(121);
  });

  it('nunca toca em KV: nem para as métricas, nem para os erros', async () => {
    const kv = new Proxy({}, { get() { throw new Error('KV não deveria ser tocado pelo /api/perf'); } });
    const env = { ...envComPerf([]), KV: kv, EVENTS: kv, SESSIONS: kv, CACHE: kv };
    const res = await handlePerfBeacon(beacon({ page: 'event', inp: 80, cls: 0.02, errs: [{ k: 'error', m: 'x' }] }), env);
    expect(res.status).toBe(204);
  });

  it('um writeDataPoint que lança não derruba a resposta', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const env = { PERF: { writeDataPoint() { throw new Error('AE fora'); } } };
    const res = await handlePerfBeacon(beacon({ page: 'event', errs: [{ k: 'error', m: 'x' }] }), env);
    expect(res.status).toBe(204);
  });
});

describe('limparMensagemErro', () => {
  it('apara em PERF_ERR_LEN e normaliza espaço e quebra de linha', () => {
    expect(limparMensagemErro('a\n\n  b\t c')).toBe('a b c');
    expect(limparMensagemErro('palavra '.repeat(100)).length).toBeLessThanOrEqual(PERF_ERR_LEN);
  });
  it('lida com null, undefined e objetos sem lançar', () => {
    expect(limparMensagemErro(null)).toBe('');
    expect(limparMensagemErro(undefined)).toBe('');
    expect(limparMensagemErro({})).toBe('[object Object]');
  });
  it('tira URL de qualquer esquema, inclusive entre parênteses de stack', () => {
    expect(limparMensagemErro('at foo (https://x.com/a/b.js?v=3:10:5)')).toBe('at foo (<url>)');
    expect(limparMensagemErro('blob:https://x.com/abc-def falhou')).not.toContain('x.com');
  });
});

describe('perfBootScript — beacon com INP, CLS e erros', () => {
  const js = perfBootScript('event', true, 'N0NCE');

  it('observa layout-shift (CLS) e event (INP) com PerformanceObserver', () => {
    expect(js).toContain('PerformanceObserver');
    expect(js).toContain("'layout-shift'");
    expect(js).toContain("'event'");
    // INP só conta interação de verdade, e CLS ignora deslocamento após input.
    expect(js).toContain("e['interactionId']");
    expect(js).toContain("e['hadRecentInput']");
  });

  it("escuta 'error' e 'unhandledrejection' na window", () => {
    expect(js).toContain("window.addEventListener('error'");
    expect(js).toContain("window.addEventListener('unhandledrejection'");
  });

  it('manda inp, cls e errs no corpo do mesmo sendBeacon', () => {
    expect(js).toMatch(/inp:inp,cls:[^,]*,errs:errs/);
    expect((js.match(/sendBeacon/g) ?? []).length).toBe(1);
  });

  it('usa os mesmos limites do servidor', () => {
    expect(js).toContain(`errs.length>=${PERF_ERR_MAX}`);
    expect(js).toContain(`.slice(0,${PERF_ERR_LEN})`);
  });

  it('sem o beacon ligado, nada disso é emitido (nem observer nem listener)', () => {
    const off = perfBootScript('event', false, 'N0NCE');
    expect(off).not.toContain('PerformanceObserver');
    expect(off).not.toContain('unhandledrejection');
    expect(off).not.toContain('sendBeacon');
  });

  it('continua anônimo: sem cookie, storage, ids nem localização', () => {
    for (const proibido of ['document.cookie', 'localStorage', 'sessionStorage', 'location.', 'userAgent', 'stack']) {
      expect(js, proibido).not.toContain(proibido);
    }
  });

  it('a cópia de clean() no script limpa igual à do servidor', () => {
    // O template dobra as barras invertidas; o browser as vê simples. Isto é
    // o que o navegador executa.
    const m = js.match(/function clean\(v\)\{return ([^\n]*);\}\n/);
    if (!m) throw new Error('clean() não encontrada no script do beacon — reaponte o teste');
    const clean = new Function('v', `return ${m[1]};`);
    const amostras = [
      'x', '', null, undefined, 'a\nb  c',
      'GET https://exemplo.com/fotos/ana.jpg?w=600 falhou',
      'envio para ana.silva@exemplo.com.br falhou',
      'busca ?utm_source=instagram&utm_medium=bio falhou',
      'token ' + 'A1b2'.repeat(8) + ' recusado',
      'erro '.repeat(500),
      'at foo (https://x.com/a/b.js?v=3:10:5)',
    ];
    for (const a of amostras) expect(clean(a), JSON.stringify(a)).toBe(limparMensagemErro(a));
  });
});
