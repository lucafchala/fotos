import { describe, it, expect } from 'vitest';
import {
  escape, validateSlug, formatDatePT, eventTime, sortEvents, sizedDriveThumb,
  timingSafeEqual, toHttps, safeUrl, isLikelyImage, csvCell, hashPassword, verifyPassword,
  sendErrorAlert, sendRemovalEmail, sendResolvedEmail, sendSupportEmail, sendConfirmationEmail,
  errMessage, truncateText, previewDescription, ogImageFor, socialMetaHTML,
  OG_IMAGE_W, OG_IMAGE_H,
} from '../src/utils.js';

// Build a base64 string from raw bytes (mirrors how the browser sends uploads).
const b64 = (...bytes) => Buffer.from(bytes).toString('base64');
const b64str = s => Buffer.from(s, 'binary').toString('base64');

describe('escape', () => {
  it('escapes all five HTML-sensitive characters', () => {
    expect(escape(`<a href="x" foo='y'>&`)).toBe('&lt;a href=&quot;x&quot; foo=&#x27;y&#x27;&gt;&amp;');
  });
  it('returns empty string for null/undefined', () => {
    expect(escape(null)).toBe('');
    expect(escape(undefined)).toBe('');
  });
});

describe('validateSlug', () => {
  it('accepts lowercase alphanumeric slugs with internal hyphens', () => {
    expect(validateSlug('casamento-ana-joao')).toBe(true);
    expect(validateSlug('a')).toBe(true);
    expect(validateSlug('evento2026')).toBe(true);
  });
  it('rejects uppercase, leading/trailing hyphens, spaces, and over-length', () => {
    expect(validateSlug('Casamento')).toBe(false);
    expect(validateSlug('-x')).toBe(false);
    expect(validateSlug('x-')).toBe(false);
    expect(validateSlug('a b')).toBe(false);
    expect(validateSlug('a'.repeat(61))).toBe(false);
    expect(validateSlug(123)).toBe(false);
  });
});

describe('formatDatePT', () => {
  it('formats an ISO date in Portuguese', () => {
    expect(formatDatePT('2026-06-19')).toBe('19 de junho de 2026');
  });
  it('passes through empty or malformed input', () => {
    expect(formatDatePT('')).toBe('');
    expect(formatDatePT('2026-13-01')).toBe('2026-13-01'); // month out of range
    expect(formatDatePT('2026-06')).toBe('2026-06');       // wrong number of parts
  });
});

describe('eventTime / sortEvents', () => {
  it('orders pinned first, then most recent by date', () => {
    const events = [
      { id: 'a', date: '2024-01-01' },
      { id: 'b', date: '2026-01-01' },
      { id: 'c', date: '2025-01-01', pinned: true },
    ];
    expect(sortEvents(events).map(e => e.id)).toEqual(['c', 'b', 'a']);
  });
  it('falls back to createdAt when date is absent', () => {
    expect(eventTime({ createdAt: '2025-05-05T00:00:00Z' })).toBe(Date.parse('2025-05-05T00:00:00Z'));
    expect(eventTime({})).toBe(0);
  });
  it('does not mutate the input array', () => {
    const events = [{ id: 'a', date: '2024-01-01' }, { id: 'b', date: '2026-01-01' }];
    const copy = [...events];
    sortEvents(events);
    expect(events).toEqual(copy);
  });
});

describe('sizedDriveThumb', () => {
  it('rewrites a Google Drive thumbnail to the requested width', () => {
    expect(sizedDriveThumb('https://lh3.googleusercontent.com/d/ABC123', 600))
      .toBe('https://lh3.googleusercontent.com/d/ABC123=w600');
    expect(sizedDriveThumb('https://lh3.googleusercontent.com/d/ABC123=w100', 1600))
      .toBe('https://lh3.googleusercontent.com/d/ABC123=w1600');
  });
  it('leaves non-Drive URLs untouched', () => {
    expect(sizedDriveThumb('https://example.com/x.jpg', 600)).toBe('https://example.com/x.jpg');
    expect(sizedDriveThumb('', 600)).toBe('');
  });
});

describe('sendErrorAlert', () => {
  it('no-ops (never throws, never calls fetch) without RESEND_API_KEY or ADMIN_EMAIL', async () => {
    const originalFetch = globalThis.fetch;
    let fetchCalled = false;
    globalThis.fetch = () => { fetchCalled = true; return Promise.reject(new Error('should not be called')); };
    try {
      expect(await sendErrorAlert({}, new Error('boom'), { path: '/x' })).toBe(false);
      expect(await sendErrorAlert({ RESEND_API_KEY: 'k' }, new Error('boom'), { path: '/x' })).toBe(false);
      expect(await sendErrorAlert({ ADMIN_EMAIL: 'a@b.com' }, new Error('boom'), { path: '/x' })).toBe(false);
      expect(fetchCalled).toBe(false);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});

// The four other Resend senders share the same shape: no-op (return false,
// never call fetch) when their required config/fields are missing, and post
// to the Resend API with the expected recipient/subject when configured.
describe('sendRemovalEmail / sendResolvedEmail / sendSupportEmail / sendConfirmationEmail', () => {
  const REQ = { eventTitle: 'Casamento Ana', eventSlug: 'casamento-ana', method: 'number', value: '12', createdAt: '2026-01-01T00:00:00Z' };

  it('no-op without RESEND_API_KEY', async () => {
    const originalFetch = globalThis.fetch;
    let fetchCalled = false;
    globalThis.fetch = () => { fetchCalled = true; return Promise.reject(new Error('should not be called')); };
    try {
      expect(await sendRemovalEmail({}, REQ)).toBe(false);
      expect(await sendResolvedEmail({}, { ...REQ, email: 'x@y.com' })).toBe(false);
      expect(await sendSupportEmail({}, { name: 'A', email: '', message: 'oi' })).toBe(false);
      expect(await sendConfirmationEmail({}, { ...REQ, email: 'x@y.com' })).toBe(false);
      expect(fetchCalled).toBe(false);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it('sendResolvedEmail and sendConfirmationEmail also no-op without a requester email', async () => {
    expect(await sendResolvedEmail({ RESEND_API_KEY: 'k' }, { ...REQ, email: '' })).toBe(false);
    expect(await sendConfirmationEmail({ RESEND_API_KEY: 'k' }, { ...REQ, email: '' })).toBe(false);
  });

  it('posts to Resend with the expected recipient when configured', async () => {
    const originalFetch = globalThis.fetch;
    const calls = [];
    globalThis.fetch = (url, opts) => {
      calls.push({ url, body: JSON.parse(opts.body) });
      return Promise.resolve(new Response('{}', { status: 200 }));
    };
    try {
      const env = { RESEND_API_KEY: 'k', ADMIN_EMAIL: 'admin@lucafchala.com' };

      expect(await sendRemovalEmail(env, REQ)).toBe(true);
      expect(calls[0].url).toBe('https://api.resend.com/emails');
      expect(calls[0].body.to).toEqual(['admin@lucafchala.com']);

      expect(await sendResolvedEmail(env, { ...REQ, email: 'requester@x.com' })).toBe(true);
      expect(calls[1].body.to).toEqual(['requester@x.com']);

      expect(await sendSupportEmail(env, { name: 'A', email: 'a@b.com', message: 'oi' })).toBe(true);
      expect(calls[2].body.to).toEqual(['admin@lucafchala.com']);
      expect(calls[2].body.reply_to).toBe('a@b.com');

      expect(await sendConfirmationEmail(env, { ...REQ, email: 'requester@x.com' })).toBe(true);
      expect(calls[3].body.to).toEqual(['requester@x.com']);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it('throws when Resend answers with a non-ok status (caller decides how to handle it)', async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = () => Promise.resolve(new Response('nope', { status: 500 }));
    try {
      await expect(sendRemovalEmail({ RESEND_API_KEY: 'k' }, REQ)).rejects.toThrow(/Resend 500/);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});

describe('timingSafeEqual', () => {
  it('compares equal-length strings', () => {
    expect(timingSafeEqual('abc', 'abc')).toBe(true);
    expect(timingSafeEqual('abc', 'abd')).toBe(false);
  });
  it('rejects differing lengths and non-strings', () => {
    expect(timingSafeEqual('abc', 'ab')).toBe(false);
    expect(timingSafeEqual(1, 1)).toBe(false);
  });
});

describe('toHttps', () => {
  it('upgrades http to https', () => {
    expect(toHttps('http://example.com/x')).toBe('https://example.com/x');
  });
  it('passes through https unchanged', () => {
    expect(toHttps('https://example.com/x')).toBe('https://example.com/x');
  });
  it('drops javascript:, data:, and other non-https schemes', () => {
    expect(toHttps('javascript:alert(1)')).toBe('');
    expect(toHttps('data:text/html,<script>')).toBe('');
    expect(toHttps('ftp://example.com')).toBe('');
    expect(toHttps('//evil.com')).toBe('');
  });
});

// safeUrl is the render-time sink guard. These pin what it does — and, just as
// importantly, what it does NOT do, so nobody drops the escape() around it.
describe('safeUrl', () => {
  it('blocks the schemes that execute when clicked', () => {
    expect(safeUrl('javascript:alert(1)')).toBe('');
    expect(safeUrl('JavaScript:alert(1)')).toBe('');
    expect(safeUrl('data:text/html,<script>alert(1)</script>')).toBe('');
    expect(safeUrl('vbscript:msgbox(1)')).toBe('');
  });

  it('survives the non-string values a restored backup can carry', () => {
    expect(safeUrl(null)).toBe('');
    expect(safeUrl(undefined)).toBe('');
    expect(safeUrl(42)).toBe('');
    expect(safeUrl({ href: 'https://x.com' })).toBe('');
  });

  it('upgrades http and keeps a legitimate https URL intact', () => {
    expect(safeUrl('http://drive.google.com/d/1')).toBe('https://drive.google.com/d/1');
    expect(safeUrl('https://drive.google.com/d/1?x=1&y=2')).toBe('https://drive.google.com/d/1?x=1&y=2');
  });

  // The contract that the review docs got wrong: safeUrl is a SCHEME allowlist,
  // not an HTML escaper. A quote inside an otherwise-valid https URL passes
  // through untouched, so an href sink needs escape() on top. Asserting the raw
  // passthrough here means a future "safeUrl already sanitizes" refactor that
  // drops the escape() has to walk past a failing test.
  it('does NOT escape HTML — attribute breakout needs escape() on top', () => {
    const hostile = 'https://evil.com/" onload="alert(1)';
    expect(safeUrl(hostile)).toBe(hostile);
    expect(escape(safeUrl(hostile))).not.toContain('onload="');
    expect(escape(safeUrl(hostile))).toContain('&quot;');
  });
});

describe('isLikelyImage', () => {
  it('accepts known image magic bytes', () => {
    expect(isLikelyImage(b64(0xFF, 0xD8, 0xFF, 0xE0, 0, 0, 0, 0))).toBe(true);            // JPEG
    expect(isLikelyImage(b64(0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A))).toBe(true); // PNG
    expect(isLikelyImage(b64str('GIF89a' + '\0\0\0\0'))).toBe(true);                        // GIF
    expect(isLikelyImage(b64str('RIFF\0\0\0\0WEBPVP8 '))).toBe(true);                       // WebP
    expect(isLikelyImage(b64str('\0\0\0\x18ftypheic\0\0\0\0'))).toBe(true);                 // HEIC
  });
  it('rejects non-image and malformed payloads', () => {
    expect(isLikelyImage(b64str('hello world, not an image'))).toBe(false);
    expect(isLikelyImage('!!!not base64!!!')).toBe(false);
    expect(isLikelyImage('')).toBe(false);
  });
});

describe('csvCell', () => {
  it('passes simple values through', () => {
    expect(csvCell('hello')).toBe('hello');
    expect(csvCell(42)).toBe('42');
  });
  it('empties null/undefined', () => {
    expect(csvCell(null)).toBe('');
    expect(csvCell(undefined)).toBe('');
  });
  it('quotes and escapes values containing comma, quote, or newline', () => {
    expect(csvCell('a,b')).toBe('"a,b"');
    expect(csvCell('say "hi"')).toBe('"say ""hi"""');
    expect(csvCell('line1\nline2')).toBe('"line1\nline2"');
  });
});

describe('hashPassword / verifyPassword', () => {
  it('round-trips a PBKDF2 hash', async () => {
    const hash = await hashPassword('correct horse');
    expect(hash.startsWith('pbkdf2:')).toBe(true);
    expect(await verifyPassword('correct horse', hash)).toBe(true);
    expect(await verifyPassword('wrong', hash)).toBe(false);
  });
  it('rejects an empty stored credential', async () => {
    expect(await verifyPassword('x', '')).toBe(false);
    expect(await verifyPassword('x', null)).toBe(false);
  });
  it('verifies a legacy bare SHA-256 hash', async () => {
    const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode('legacy-pw'));
    const legacy = Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, '0')).join('');
    expect(await verifyPassword('legacy-pw', legacy)).toBe(true);
    expect(await verifyPassword('nope', legacy)).toBe(false);
  });
});

// `catch` entrega `unknown`. Todo caminho de degradação deste projeto lê a
// mensagem do que foi lançado, então a extração precisa aguentar o que NÃO é
// Error — senão o tratador quebra justamente quando está tentando registrar
// que algo quebrou.
describe('errMessage', () => {
  it('tira a mensagem de um Error', () => {
    expect(errMessage(new Error('KV PUT failed: 429'))).toBe('KV PUT failed: 429');
  });

  it('aceita uma string lançada direto', () => {
    expect(errMessage('deu ruim')).toBe('deu ruim');
  });

  it('aceita um objeto com message que não é Error', () => {
    // Bibliotecas lançam isto o tempo todo.
    expect(errMessage({ message: 'falha do fornecedor' })).toBe('falha do fornecedor');
  });

  it('não inventa mensagem para objeto sem message', () => {
    expect(errMessage({ status: 500 })).toBe('[object Object]');
  });

  it('não quebra com null, undefined ou Error sem mensagem', () => {
    expect(errMessage(null)).toBe('null');
    expect(errMessage(undefined)).toBe('undefined');
    expect(errMessage(new Error(''))).toBe('Error');
  });
});


// ---------------------------------------------------------------------------
// Cartão de pré-visualização do link
// ---------------------------------------------------------------------------
describe('truncateText', () => {
  it('devolve o texto inteiro quando cabe', () => {
    expect(truncateText('Formatura', 20)).toBe('Formatura');
  });

  it('corta no espaço, não no meio da palavra', () => {
    expect(truncateText('Colação de grau da turma', 18)).toBe('Colação de grau…');
  });

  it('corta seco quando a última palavra é longa demais para valer o espaço', () => {
    // Sem a regra dos 60%, uma URL colada na descrição comeria o limite inteiro.
    expect(truncateText('a https://exemplo.com/uma-url-enorme-mesmo', 20)).toBe('a https://exemplo.c…');
  });

  it('normaliza espaço em branco', () => {
    expect(truncateText('  linha um\n\n  linha dois  ', 100)).toBe('linha um linha dois');
  });

  it('não quebra com valor ausente', () => {
    expect(truncateText(null, 50)).toBe('');
    expect(truncateText(undefined, 50)).toBe('');
  });
});

describe('previewDescription', () => {
  it('põe os fatos antes do texto livre', () => {
    expect(previewDescription(['15 de janeiro de 2026', 'Em colaboração com o Colégio X'], 'Colação de grau.'))
      .toBe('15 de janeiro de 2026 · Em colaboração com o Colégio X — Colação de grau.');
  });

  it('descarta fato vazio em vez de emitir separador solto', () => {
    expect(previewDescription(['', 'Formatura', null, false], '')).toBe('Formatura');
  });

  it('devolve só o texto quando não há fato nenhum', () => {
    expect(previewDescription([], 'Fotografias de Luca F. Chala.')).toBe('Fotografias de Luca F. Chala.');
  });

  it('corta o texto no espaço que sobra depois dos fatos', () => {
    const out = previewDescription(['2026'], 'palavra '.repeat(60), 60);
    expect(out.length).toBeLessThanOrEqual(60);
    expect(out.startsWith('2026 — palavra')).toBe(true);
    expect(out.endsWith('…')).toBe(true);
  });

  it('deixa a linha de fatos limpa quando não sobra espaço para frase', () => {
    const facts = ['Em breve', '15 de janeiro de 2026', 'Em colaboração com o Colégio Santa Cruz'];
    expect(previewDescription(facts, 'Uma descrição que não caberia.', 80))
      .toBe('Em breve · 15 de janeiro de 2026 · Em colaboração com o Colégio Santa Cruz');
  });
});

describe('ogImageFor', () => {
  it('recorta a capa do Drive no formato do cartão e devolve as dimensões', () => {
    expect(ogImageFor('https://lh3.googleusercontent.com/d/ABC')).toEqual({
      url: `https://lh3.googleusercontent.com/d/ABC=w${OG_IMAGE_W}-h${OG_IMAGE_H}-c`,
      width: OG_IMAGE_W,
      height: OG_IMAGE_H,
    });
  });

  it('troca um dimensionamento anterior pelo do cartão', () => {
    expect(ogImageFor('https://lh3.googleusercontent.com/d/ABC=w600').url)
      .toBe(`https://lh3.googleusercontent.com/d/ABC=w${OG_IMAGE_W}-h${OG_IMAGE_H}-c`);
  });

  it('não inventa dimensão para imagem de outro host', () => {
    expect(ogImageFor('https://exemplo.com/foto.jpg')).toEqual({
      url: 'https://exemplo.com/foto.jpg', width: 0, height: 0,
    });
  });

  it('rejeita URL sem esquema seguro', () => {
    expect(ogImageFor('javascript:alert(1)')).toEqual({ url: '', width: 0, height: 0 });
    expect(ogImageFor('')).toEqual({ url: '', width: 0, height: 0 });
    expect(ogImageFor(null)).toEqual({ url: '', width: 0, height: 0 });
  });
});

describe('socialMetaHTML', () => {
  const base = { title: 'Evento', description: 'Descrição', url: 'https://fotos.lucafchala.com/evento' };

  it('emite o cartão grande quando as dimensões da imagem são conhecidas', () => {
    const html = socialMetaHTML({ ...base, image: 'https://img/x=w1200-h630-c', imageWidth: 1200, imageHeight: 630 });
    expect(html).toContain('<meta property="og:image:width" content="1200">');
    expect(html).toContain('<meta property="og:image:height" content="630">');
    expect(html).toContain('<meta name="twitter:card" content="summary_large_image">');
  });

  it('cai para miniatura quando a imagem existe mas o tamanho não é conhecido', () => {
    const html = socialMetaHTML({ ...base, image: 'https://exemplo.com/foto.jpg' });
    expect(html).toContain('<meta property="og:image" content="https://exemplo.com/foto.jpg">');
    expect(html).not.toContain('og:image:width');
    expect(html).toContain('<meta name="twitter:card" content="summary">');
  });

  it('omite as tags de imagem inteiras quando não há imagem', () => {
    const html = socialMetaHTML(base);
    expect(html).not.toContain('og:image');
    expect(html).not.toContain('twitter:image');
  });

  it('usa o título como alt quando nenhum é dado', () => {
    const html = socialMetaHTML({ ...base, image: 'https://img/x', imageWidth: 1200, imageHeight: 630 });
    expect(html).toContain('<meta property="og:image:alt" content="Evento">');
  });

  it('escapa aspas do título e da descrição', () => {
    const html = socialMetaHTML({ ...base, title: 'Ensaio "Luz"', description: 'a & b' });
    expect(html).toContain('content="Ensaio &quot;Luz&quot;"');
    expect(html).toContain('content="a &amp; b"');
    expect(html).not.toContain('"Luz"');
  });
});
