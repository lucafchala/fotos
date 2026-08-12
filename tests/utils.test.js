import { describe, it, expect } from 'vitest';
import {
  escape, validateSlug, formatDatePT, eventTime, sortEvents, sizedDriveThumb,
  timingSafeEqual, toHttps, safeUrl, isLikelyImage, csvCell, hashPassword, verifyPassword,
  extractDriveFolderId, sendErrorAlert,
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

describe('extractDriveFolderId', () => {
  it('pulls the folder id out of a share link', () => {
    expect(extractDriveFolderId('https://drive.google.com/drive/folders/1a2B3c-XYZ'))
      .toBe('1a2B3c-XYZ');
    expect(extractDriveFolderId('https://drive.google.com/drive/folders/1a2B3c-XYZ?usp=sharing'))
      .toBe('1a2B3c-XYZ');
  });
  it('returns empty string for non-folder links or garbage input', () => {
    expect(extractDriveFolderId('https://drive.google.com/file/d/abc/view')).toBe('');
    expect(extractDriveFolderId('https://example.com')).toBe('');
    expect(extractDriveFolderId('')).toBe('');
    expect(extractDriveFolderId(null)).toBe('');
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
