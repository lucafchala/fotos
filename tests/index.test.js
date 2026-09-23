import { describe, it, expect, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import worker, { mergeRestore, buildBackup, trimRequests, normalizeEventFields, cronStale, auditSite } from '../src/index.js';
import { DEFAULT_EVENT } from '../src/config.js';
import { saveEvents, readCounter, RESERVED_SLUGS } from '../src/utils.js';
import { galleryHTML } from '../src/ui/gallery.js';
import { eventHTML } from '../src/ui/event.js';
import { withDurableObjects } from './helpers/do.js';

const CATS = ['Casamento', 'Ensaio'];

describe('mergeRestore', () => {
  it('adds events absent from the current set', () => {
    const current = [{ id: 'a', title: 'A' }];
    const { events, added, updated } = mergeRestore(current, [{ id: 'b', slug: 'b', title: 'B' }]);
    expect(added).toBe(1);
    expect(updated).toBe(0);
    expect(events.map(e => e.id).sort()).toEqual(['a', 'b']);
  });
  it('replaces an existing event only when the backup is newer', () => {
    const current = [{ id: 'a', title: 'old', updatedAt: '2025-01-01T00:00:00Z' }];
    const newer = mergeRestore(current, [{ id: 'a', slug: 'a', title: 'new', updatedAt: '2026-01-01T00:00:00Z' }]);
    expect(newer.updated).toBe(1);
    expect(newer.events.find(e => e.id === 'a').title).toBe('new');

    const older = mergeRestore(current, [{ id: 'a', slug: 'a', title: 'older', updatedAt: '2024-01-01T00:00:00Z' }]);
    expect(older.updated).toBe(0);
    expect(older.events.find(e => e.id === 'a').title).toBe('old');
  });
  it('does not mutate the current array', () => {
    const current = [{ id: 'a' }];
    mergeRestore(current, [{ id: 'b', slug: 'b' }]);
    expect(current).toEqual([{ id: 'a' }]);
  });
});

describe('buildBackup', () => {
  it('produces a v2 envelope with counts and all sections', () => {
    const out = JSON.parse(buildBackup({
      events: [{ id: 'a' }, { id: 'b' }],
      categories: ['Casamento'],
      removalRequests: [{ id: 'q1' }],
    }));
    expect(out.version).toBe(2);
    expect(out.eventCount).toBe(2);
    expect(out.categories).toEqual(['Casamento']);
    expect(out.removalRequests).toHaveLength(1);
    expect(out.reviews).toBeUndefined(); // review feature removed
    expect(typeof out.backupAt).toBe('string');
  });
});

describe('normalizeEventFields', () => {
  it('applies defaults for an empty body (create shape)', () => {
    const f = normalizeEventFields({}, DEFAULT_EVENT, CATS);
    expect(f).toMatchObject({
      title: '', longDescription: '', driveUrl: '',
      driveUrlInstagram: '', date: '', eventCredits: '', projectUrl: '',
      visible: true, comingSoon: false, status: 'entregue', accessType: 'public',
      category: '', internalNotes: '', pinned: false,
    });
    expect(f).not.toHaveProperty('shortDescription');
    expect(f.photosAlert).toEqual({ active: false, addedAt: null, expiresAfterHours: 24 });
  });

  it('sanitizes provided fields (slice limits, https coercion, enums)', () => {
    const f = normalizeEventFields({
      title: 'x'.repeat(300),
      driveUrl: 'http://example.com/d',
      projectUrl: 'javascript:alert(1)',
      date: '2026-06-19', visible: false, comingSoon: true, pinned: true,
      status: 'em-revisao', accessType: 'family', category: 'Casamento',
    }, DEFAULT_EVENT, CATS);
    expect(f.title).toHaveLength(200);
    expect(f.driveUrl).toBe('https://example.com/d');
    expect(f.projectUrl).toBe('');            // non-https dropped
    expect(f.date).toBe('2026-06-19');
    expect(f.visible).toBe(false);
    expect(f.comingSoon).toBe(true);
    expect(f.pinned).toBe(true);
    expect(f.status).toBe('em-revisao');
    expect(f.accessType).toBe('family');
    expect(f.category).toBe('Casamento');
  });

  it('rejects invalid enum/category/date values to defaults on create', () => {
    const f = normalizeEventFields(
      { status: 'bogus', accessType: 'bogus', category: 'Nope', date: '06/2026' },
      DEFAULT_EVENT, CATS);
    expect(f.status).toBe('entregue');
    expect(f.accessType).toBe('public');
    expect(f.category).toBe('');
    expect(f.date).toBe('');
  });

  it('accepts a valid promisedDate and rejects a malformed one (issue #139)', () => {
    const ok = normalizeEventFields({ promisedDate: '2026-12-01' }, DEFAULT_EVENT, CATS);
    expect(ok.promisedDate).toBe('2026-12-01');
    const bad = normalizeEventFields({ promisedDate: '01/12/2026' }, DEFAULT_EVENT, CATS);
    expect(bad.promisedDate).toBe('');
  });

  it('no longer has a photoCount field (removed — photos are already numbered)', () => {
    const f = normalizeEventFields({ photoCount: 128 }, DEFAULT_EVENT, CATS);
    expect(f).not.toHaveProperty('photoCount');
  });

  it('falls back to the existing event when a field is absent (update shape)', () => {
    const existing = { title: 'Keep', status: 'arquivado', accessType: 'private', category: 'Ensaio', visible: false };
    const f = normalizeEventFields({ title: 'New' }, existing, CATS);
    expect(f.title).toBe('New');
    expect(f.status).toBe('arquivado');
    expect(f.accessType).toBe('private');
    expect(f.category).toBe('Ensaio');
    expect(f.visible).toBe(false);
  });

  it('keeps the existing value when an update provides an invalid one', () => {
    expect(normalizeEventFields({ status: 'bogus' }, { status: 'arquivado' }, CATS).status).toBe('arquivado');
  });

  it('defaults a legacy event missing status/accessType/photosAlert when the update omits them', () => {
    const f = normalizeEventFields({ title: 'x' }, { title: 'x' }, CATS);
    expect(f.status).toBe('entregue');
    expect(f.accessType).toBe('public');
    expect(f.photosAlert).toEqual({ active: false, addedAt: null, expiresAfterHours: 24 });
  });

  it('normalizes a provided photosAlert object', () => {
    const f = normalizeEventFields(
      { photosAlert: { active: true, addedAt: '2026-06-19', expiresAfterHours: '48' } },
      DEFAULT_EVENT, CATS);
    expect(f.photosAlert).toEqual({ active: true, addedAt: '2026-06-19', expiresAfterHours: 48 });
  });
});

describe('cronStale (healthz cron heartbeat)', () => {
  const now = Date.parse('2026-06-22T12:00:00Z');
  it('treats a never-written beat as NOT stale (fresh deploy grace)', () => {
    expect(cronStale(null, now)).toBe(false);
    expect(cronStale(undefined, now)).toBe(false);
    expect(cronStale('', now)).toBe(false);
  });
  it('is fresh for a beat within the last day', () => {
    expect(cronStale('2026-06-22T03:00:00Z', now)).toBe(false); // 9h ago
    expect(cronStale('2026-06-21T11:00:00Z', now)).toBe(false); // 25h ago — within 26h slack
  });
  it('is stale once the beat is older than a day + slack', () => {
    expect(cronStale('2026-06-21T03:00:00Z', now)).toBe(true);  // 33h ago
    expect(cronStale('2026-06-19T03:00:00Z', now)).toBe(true);  // ~3 days ago
  });
  it('flags an unparseable timestamp as stale (something wrote garbage)', () => {
    expect(cronStale('not-a-date', now)).toBe(true);
  });
});

describe('auditSite (healthz functional self-test)', () => {
  const FULL_ENV = { TURNSTILE_SECRET_KEY: 'x', RESEND_API_KEY: 'y', ADMIN_EMAIL: 'a@b.c', SIGNING_SECRET: 'z'.repeat(40) };
  const liveEvent = (over = {}) => ({ slug: 's' + Math.random().toString(36).slice(2, 7), title: 'T', visible: true, comingSoon: false, status: 'entregue', driveUrl: 'https://drive.google.com/drive/folders/abc', ...over });

  it('is clean for healthy events + fully-configured forms, and nominates a sample', () => {
    const r = auditSite([liveEvent({ slug: 'casamento' })], FULL_ENV);
    expect(r.ok).toBe(true);
    expect(r.problems).toEqual([]);
    expect(r.drive).toEqual({ ok: 1, bad: 0, live: 1 });
    expect(r.sample).toBe('casamento');
  });

  it('flags a live event whose Drive link is missing or malformed', () => {
    const r = auditSite([
      liveEvent({ slug: 'sem-link', driveUrl: '' }),
      liveEvent({ slug: 'ruim', driveUrl: 'not-a-url' }),
    ], FULL_ENV);
    expect(r.ok).toBe(false);
    expect(r.drive.bad).toBe(2);
    expect(r.problems).toContain('link do Drive ausente: sem-link');
    expect(r.problems).toContain('link do Drive inválido: ruim');
    expect(r.sample).toBeNull(); // no healthy live event to nominate
  });

  it('ignores hidden drafts and coming-soon events for the Drive check', () => {
    const r = auditSite([
      liveEvent({ slug: 'hidden', visible: false, driveUrl: '' }),
      liveEvent({ slug: 'soon', comingSoon: true, driveUrl: '' }),
    ], FULL_ENV);
    expect(r.problems).toEqual([]);
    expect(r.drive.live).toBe(0);
  });

  it('flags duplicate slugs and invalid status', () => {
    const r = auditSite([
      liveEvent({ slug: 'dup' }), liveEvent({ slug: 'dup' }),
      liveEvent({ slug: 'weird', status: 'bogus' }),
    ], FULL_ENV);
    expect(r.problems.some(p => p.includes('slug duplicado: dup'))).toBe(true);
    expect(r.problems.some(p => p.includes('status inválido em weird: bogus'))).toBe(true);
  });

  it('flags missing form backends from env', () => {
    const r = auditSite([liveEvent()], {}); // no secrets
    expect(r.forms).toEqual({ turnstile: false, resend: false, adminEmail: false, signing: false });
    expect(r.problems.some(p => p.startsWith('Turnstile ausente'))).toBe(true);
    expect(r.problems.some(p => p.startsWith('Resend ausente'))).toBe(true);
    expect(r.problems.some(p => p.startsWith('ADMIN_EMAIL ausente'))).toBe(true);
  });

  it('caps the problem list so the payload stays bounded', () => {
    const many = Array.from({ length: 20 }, (_, i) => liveEvent({ slug: 'e' + i, driveUrl: '' }));
    const r = auditSite(many, FULL_ENV);
    expect(r.problems.length).toBeLessThanOrEqual(13); // 12 + the "+N outro(s)" line
    expect(r.problems[r.problems.length - 1]).toMatch(/^\+\d+ outro\(s\)$/);
  });

  it('relata QUALQUER degradação registrada, sem lista fixa', () => {
    // O site é desenhado para continuar servindo enquanto as peças cedem, então
    // "está no ar" não é prova de que está tudo bem — o healthz é o único lugar
    // onde isso aparece. A lista é genérica de propósito: quem registrar uma
    // degradação nova em qualquer ponto do código aparece aqui sozinho, sem
    // ninguém precisar lembrar de editar o auditSite.
    expect(auditSite([liveEvent()], FULL_ENV).problems).toEqual([]);
    const r = auditSite([liveEvent()], FULL_ENV, [
      { label: 'KV: escrita recusada', detail: 'KV PUT failed: 429', agoSecs: 12 },
      { label: 'registro de consentimento não gravou', detail: 'D1 recusou o INSERT', agoSecs: 3 },
    ]);
    expect(r.ok).toBe(false);
    expect(r.problems.some(p => p.includes('KV: escrita recusada') && p.includes('429'))).toBe(true);
    expect(r.problems.some(p => p.includes('registro de consentimento não gravou'))).toBe(true);
  });

  it('never throws on garbage input', () => {
    expect(() => auditSite(null)).not.toThrow();
    expect(() => auditSite([null, 42, {}], {})).not.toThrow();
    expect(auditSite(undefined).ok).toBe(false); // missing form secrets → not clean
  });
});

describe('trimRequests (bug 1a invariant)', () => {
  it('returns the array untouched when at or below the cap', () => {
    const reqs = [{ id: 'a', resolved: false }];
    expect(trimRequests(reqs, 500)).toBe(reqs);
    expect(reqs).toHaveLength(1);
  });
  it('keeps every unresolved record — including the just-added one — when trimming', () => {
    const requests = [];
    // 510 resolved records, oldest first.
    for (let i = 0; i < 510; i++) {
      requests.push({ id: `r${i}`, resolved: true, createdAt: `2025-01-01T00:00:${String(i).padStart(2, '0')}Z` });
    }
    // The freshly-pushed request, as handleRemovalRequest appends it.
    const newReq = { id: 'NEW', resolved: false, createdAt: '2026-06-19T00:00:00Z' };
    requests.push(newReq);

    trimRequests(requests, 500);

    expect(requests.length).toBeLessThanOrEqual(500);
    // The new request must still be present and reachable by reference/id, so the
    // subsequent emailStatus write lands on the right record.
    expect(requests.find(r => r.id === 'NEW')).toBe(newReq);
  });
});

// ---------------------------------------------------------------------------
// Hardening: a restored backup is the only path that writes events to KV
// without going through normalizeEventFields(), so it gets its own guards.
// ---------------------------------------------------------------------------
describe('mergeRestore hardening', () => {
  it('strips script-executing URLs from a crafted backup (stored XSS)', () => {
    const { events } = mergeRestore([], [{
      id: 'x',
      slug: 'x',
      title: 'Evento',
      projectUrl: 'javascript:alert(document.cookie)',
      driveUrl: 'javascript:alert(1)',
      driveUrlInstagram: 'data:text/html,<script>alert(1)</script>',
      thumbnailUrl: 'javascript:alert(2)',
      photos: ['javascript:alert(3)', 'https://lh3.googleusercontent.com/d/ok'],
    }]);
    const ev = events.find(e => e.id === 'x');
    expect(ev.projectUrl).toBe('');
    expect(ev.driveUrl).toBe('');
    expect(ev.driveUrlInstagram).toBe('');
    expect(ev.thumbnailUrl).toBe('');
    // Only the safe https photo survives.
    expect(ev.photos).toEqual(['https://lh3.googleusercontent.com/d/ok']);
  });

  it('upgrades http:// URLs to https, like the create/update path does', () => {
    const { events } = mergeRestore([], [{ id: 'y', slug: 'y', driveUrl: 'http://drive.google.com/x' }]);
    expect(events.find(e => e.id === 'y').driveUrl).toBe('https://drive.google.com/x');
  });

  it('drops junk entries that would throw on e.visible and 500 the gallery', () => {
    const { events, added } = mergeRestore([], [null, 'nope', 42, ['a'], { id: 'ok', slug: 'ok', title: 'OK' }]);
    expect(added).toBe(1);
    expect(events).toHaveLength(1);
    expect(events[0].id).toBe('ok');
    // The surviving set must be safe to iterate the way galleryHTML does.
    expect(() => events.filter(e => e.visible !== false)).not.toThrow();
  });

  it('preserves fields the sanitizer does not know about', () => {
    const { events } = mergeRestore([], [{ id: 'z', slug: 'z', internalNotes: 'nota', someFutureField: { a: 1 } }]);
    const ev = events.find(e => e.id === 'z');
    expect(ev.internalNotes).toBe('nota');
    expect(ev.someFutureField).toEqual({ a: 1 });
  });
});

describe('mergeRestore: campos de enum', () => {
  // O restore é o único caminho que grava eventos sem passar por
  // `normalizeEventFields`, e `status`/`accessType` desembocam em atributo de
  // HTML no painel. O escape no sink cobre a marcação; isto impede que o valor
  // absurdo chegue a ser gravado.
  it('normaliza um status fora da lista para o padrão', () => {
    const { events } = mergeRestore([], [{ id: 'a', slug: 'a', status: '" onmouseover="alert(1)' }]);
    expect(events[0].status).toBe(DEFAULT_EVENT.status);
  });
  it('normaliza um accessType fora da lista para o padrão', () => {
    const { events } = mergeRestore([], [{ id: 'a', slug: 'a', accessType: 'inventado' }]);
    expect(events[0].accessType).toBe(DEFAULT_EVENT.accessType);
  });
  it('preserva um status e um accessType legítimos', () => {
    const { events } = mergeRestore([], [{ id: 'a', slug: 'a', status: 'arquivado', accessType: 'family' }]);
    expect(events[0].status).toBe('arquivado');
    expect(events[0].accessType).toBe('family');
  });
  it('não inventa os campos num evento que não os traz', () => {
    // Backups antigos legítimos podem simplesmente não ter as chaves; criá-las
    // aqui mudaria o registro em vez de sanear o que veio.
    const { events } = mergeRestore([], [{ id: 'a', slug: 'a', title: 'T' }]);
    expect('status' in events[0]).toBe(false);
    expect('accessType' in events[0]).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Restore: identidade, tipos e o aviso de novas fotos
// ---------------------------------------------------------------------------
// O restore aceita backup editado à mão (e o cenário de ataque é social:
// "restaura esse arquivo aí"). Os testes abaixo são sobre o que um valor desses
// fazia DEPOIS de gravado — na galeria pública, não no painel.
describe('mergeRestore: identidade do evento', () => {
  it('recusa slug que viraria link para fora do site', () => {
    // O card é `<a href="/<slug>">`: com `/evil.example`, o href saía
    // `//evil.example` — protocolo relativo, direto para outro host.
    const { events, skipped } = mergeRestore([], [{ id: 'a', slug: '/evil.example', title: 'X' }]);
    expect(events).toEqual([]);
    expect(skipped).toBe(1);
  });

  it('recusa slug reservado por uma página do site e evento sem slug', () => {
    const { events, skipped } = mergeRestore([], [
      { id: 'a', slug: 'sobre', title: 'X' },
      { id: 'b', title: 'sem slug' },
    ]);
    expect(events).toEqual([]);
    expect(skipped).toBe(2);
  });

  it('recusa evento sem id utilizável — o painel não conseguiria editá-lo nem apagá-lo', () => {
    const { events, skipped } = mergeRestore([], [
      { slug: 'sem-id', title: 'X' },
      { id: 42, slug: 'id-numerico', title: 'X' },
      { id: 'a/b?c', slug: 'id-com-barra', title: 'X' },
    ]);
    expect(events).toEqual([]);
    expect(skipped).toBe(3);
  });

  it('não deixa uma versão sem slug SUBSTITUIR o evento existente de mesmo id', () => {
    const atual = [{ id: 'a', slug: 'casamento', title: 'Casamento', updatedAt: '2025-01-01T00:00:00Z' }];
    const { events, updated } = mergeRestore(atual, [{ id: 'a', title: 'mais novo', updatedAt: '2026-01-01T00:00:00Z' }]);
    expect(updated).toBe(0);
    expect(events).toEqual(atual);
  });
});

describe('mergeRestore: campos que as páginas tratam como texto', () => {
  it('número vira o texto dele; objeto e lista viram vazio', () => {
    const { events } = mergeRestore([], [{
      id: 'a', slug: 'a', title: 2026, category: ['x'], eventCredits: { nome: 'y' }, longDescription: true,
    }]);
    expect(events[0]).toMatchObject({ title: '2026', category: '', eventCredits: '', longDescription: '' });
  });

  it('aplica os mesmos tetos de tamanho do painel', () => {
    const { events } = mergeRestore([], [{ id: 'a', slug: 'a', title: 'x'.repeat(5000), category: 'c'.repeat(100) }]);
    expect(events[0].title).toHaveLength(200);
    expect(events[0].category).toHaveLength(40);
  });

  it('data fora do formato AAAA-MM-DD vira vazio; a válida passa', () => {
    const { events } = mergeRestore([], [
      { id: 'a', slug: 'a', date: 20260115, promisedDate: '15/01/2026' },
      { id: 'b', slug: 'b', date: '2026-01-15', promisedDate: '2026-02-01' },
    ]);
    expect(events[0]).toMatchObject({ date: '', promisedDate: '' });
    expect(events[1]).toMatchObject({ date: '2026-01-15', promisedDate: '2026-02-01' });
  });

  it('um null continua null — ausência não é valor a corrigir', () => {
    const { events } = mergeRestore([], [{ id: 'a', slug: 'a', title: null }]);
    expect(events[0].title).toBeNull();
  });

  it('a galeria e a página do projeto renderizam o que o restore gravou', () => {
    // O consumidor de verdade: antes, `(e.title || '').toLowerCase()` com um
    // título numérico e `e.date.slice(0, 4)` com uma data numérica LANÇAVAM
    // dentro do galleryHTML — 500 na home para todo visitante.
    const { events } = mergeRestore([], [{
      id: 'a', slug: 'a', title: 2026, date: 20260115, category: 7, driveUrl: 'https://drive.google.com/x',
    }]);
    expect(() => galleryHTML(events, null, 'NONCE')).not.toThrow();
    expect(() => eventHTML(events[0], '2026', null, 'NONCE')).not.toThrow();
  });
});

describe('aviso de novas fotos com número de horas absurdo', () => {
  const absurdo = { active: true, addedAt: '2026-06-19T00:00:00Z', expiresAfterHours: '99999999999' };

  it('o painel e a API gravam o teto, não o absurdo', () => {
    const f = normalizeEventFields({ photosAlert: absurdo }, DEFAULT_EVENT, []);
    expect(f.photosAlert.expiresAfterHours).toBe(24 * 365);
    expect(normalizeEventFields({ photosAlert: { ...absurdo, expiresAfterHours: -5 } }, DEFAULT_EVENT, [])
      .photosAlert.expiresAfterHours).toBe(0);
  });

  it('data ilegível vira null em vez de ser gravada', () => {
    const f = normalizeEventFields({ photosAlert: { ...absurdo, addedAt: 'ontem' } }, DEFAULT_EVENT, []);
    expect(f.photosAlert.addedAt).toBeNull();
  });

  it('o restore passa pela mesma normalização', () => {
    const { events } = mergeRestore([], [{ id: 'a', slug: 'a', photosAlert: absurdo }]);
    expect(events[0].photosAlert.expiresAfterHours).toBe(24 * 365);
  });

  it('a página do projeto não quebra com o registro antigo, anterior à normalização', () => {
    // O registro já pode estar no KV: a guarda precisa estar também no sink.
    // Antes, `new Date(addedAt + horas).toISOString()` lançava RangeError.
    const evento = {
      id: 'a', slug: 'a', title: 'T', driveUrl: 'https://drive.google.com/x',
      photosAlert: { active: true, addedAt: '2026-06-19T00:00:00Z', expiresAfterHours: 99999999999 },
    };
    expect(() => eventHTML(evento, '2026', null, 'NONCE')).not.toThrow();
  });

  it('sem data legível, o banner não promete "há NaN dias"', () => {
    const evento = {
      id: 'a', slug: 'a', title: 'T', driveUrl: 'https://drive.google.com/x',
      photosAlert: { active: true, addedAt: null, expiresAfterHours: 0 },
    };
    const html = eventHTML(evento, '2026', null, 'NONCE');
    expect(html).toContain('id="photos-banner"');
    expect(html).toMatch(/const ALERT_ADDED_AT = "";/);
  });
});

describe('slugs reservados pelas rotas fixas', () => {
  it('toda rota fixa de um segmento em src/index.js está em RESERVED_SLUGS', () => {
    // A lista mora em utils.js e as rotas em index.js — duas cópias da mesma
    // regra. Este teste é o que as mantém concordando: uma rota nova de um
    // segmento que não entre na lista reprova aqui, antes de um projeto com
    // aquele slug sumir atrás dela.
    const fonte = readFileSync(new URL('../src/index.js', import.meta.url), 'utf8');
    const rotas = [...fonte.matchAll(/path === '\/([a-z0-9-]+)'/g)].map(m => m[1]);
    expect(rotas.length).toBeGreaterThan(5); // o padrão ainda acha as rotas
    for (const r of rotas) expect(RESERVED_SLUGS.has(r), `rota /${r} fora de RESERVED_SLUGS`).toBe(true);
  });

  it('criar um projeto com slug reservado é recusado com uma mensagem que diz por quê', async () => {
    const TOKEN = 'd'.repeat(64);
    const store = new Map([[`admin_session:${TOKEN}`, 'valid'], ['events', '[]']]);
    const env = withDurableObjects({
      FOTOS: {
        async get(k) { return store.get(k) ?? null; },
        async put(k, v) { store.set(k, v); },
        async delete(k) { store.delete(k); },
      },
    });
    const res = await worker.fetch(new Request('https://fotos.lucafchala.com/api/events', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json', 'Sec-Fetch-Site': 'same-origin', Cookie: `__Host-session=${TOKEN}`,
      },
      body: JSON.stringify({ slug: 'sobre', title: 'Sobre nós', driveUrl: 'https://drive.google.com/x' }),
    }), env, { waitUntil() {} });
    expect(res.status).toBe(400);
    expect((await res.json()).error).toMatch(/\/sobre já é uma página do site/);
    expect(store.get('events')).toBe('[]');
  });

  it('o autoteste do healthz acusa um projeto público que nunca vai abrir', () => {
    const { problems } = auditSite([{ slug: 'sobre', title: 'X', driveUrl: 'https://drive.google.com/x' }]);
    expect(problems.join(' | ')).toMatch(/slug inválido ou reservado: sobre/);
  });
});

describe('saveEvents com a escrita recusada', () => {
  it('não deixa o isolate servir como lista um valor que o KV não gravou', async () => {
    // Isolate frio: o cache de módulo é justamente o que está sob teste.
    vi.resetModules();
    const utils = await import('../src/utils.js');
    const store = new Map([['events', JSON.stringify([{ id: 'a', slug: 'velho' }])]]);
    const kv = {
      async get(k) { return store.get(k) ?? null; },
      async put() { throw new Error('KV PUT failed: 429 Too Many Requests'); },
    };
    const env = { FOTOS: kv };
    await utils.getEvents(env); // preenche o cache do isolate
    await expect(utils.saveEvents(env, [{ id: 'b', slug: 'nunca-gravado' }])).rejects.toThrow(/429/);
    const servida = await utils.getEvents(env); // leitura de VISITANTE, dentro do TTL
    expect(servida.map(e => e.slug)).toEqual(['velho']);
  });
});

// ---------------------------------------------------------------------------
describe('contagem de visita da página de projeto', () => {
  // A galeria faz prefetch no hover (speculation rules em gallery.js). Sem a
  // exceção aqui, /api/metrics viraria um contador de mouse passando por cima
  // dos cards — e pior: o Set-Cookie do prefetch marcaria "já contado", então
  // a visita DE VERDADE, a que vem depois do clique, não contaria. O número
  // ficaria errado nas duas direções ao mesmo tempo.
  function fakeKV(initial = {}) {
    const store = new Map(Object.entries(initial));
    return {
      async get(k) { return store.has(k) ? store.get(k) : null; },
      async put(k, v) { store.set(k, v); },
      async delete(k) { store.delete(k); },
      async list({ prefix = '' } = {}) {
        return { keys: [...store.keys()].filter(k => k.startsWith(prefix)).map(name => ({ name })), list_complete: true, cursor: null };
      },
    };
  }
  const fakeCtx = () => { const p = []; return { waitUntil: x => p.push(Promise.resolve(x).catch(() => {})), settle: () => Promise.all(p) }; };

  const EVENTO = {
    id: '1', slug: 'casamento-ana', title: 'Casamento Ana', accessType: 'public',
    visible: true, comingSoon: false, photos: [], thumbnailUrl: '',
    date: '2026-01-15', category: 'Casamento',
  };

  async function pede(headers = {}) {
    const env = withDurableObjects({ FOTOS: fakeKV() });
    await saveEvents(env, [structuredClone(EVENTO)]);
    const ctx = fakeCtx();
    const res = await worker.fetch(
      new Request('https://fotos.lucafchala.com/casamento-ana', { headers }),
      env,
      ctx,
    );
    await ctx.settle();
    return { res, env };
  }

  it('uma navegação normal conta e marca o cookie', async () => {
    const { res, env } = await pede();
    expect(res.status).toBe(200);
    expect(await readCounter(env, 'views:casamento-ana')).toBe(1);
    expect(res.headers.get('Set-Cookie') || '').toContain('fv_casamento-ana=1');
  });

  it('um prefetch serve a página, mas não conta nem marca o cookie', async () => {
    const { res, env } = await pede({ 'Sec-Purpose': 'prefetch' });
    expect(res.status).toBe(200);
    expect(await readCounter(env, 'views:casamento-ana')).toBe(0);
    expect(res.headers.get('Set-Cookie') || '').not.toContain('fv_casamento-ana');
  });

  it('reconhece o cabeçalho composto que o Chrome manda no prerender', async () => {
    // O valor real vem como `prefetch;prerender` — comparar por igualdade
    // deixaria passar, e a forma composta é a que o browser realmente envia.
    const { env } = await pede({ 'Sec-Purpose': 'prefetch;prerender' });
    expect(await readCounter(env, 'views:casamento-ana')).toBe(0);
  });
});
