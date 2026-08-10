import { describe, it, expect } from 'vitest';
import { checkRateLimit, getEvents, saveEvents, getCategories, DEFAULT_CATEGORIES } from '../src/utils.js';

// Minimal in-memory stand-in for a Workers KV namespace. Ignores expirationTtl
// (the tests run inside a single rate-limit window, so TTL is irrelevant).
function fakeKV(initial = {}) {
  const store = new Map(Object.entries(initial));
  return {
    async get(k) { return store.has(k) ? store.get(k) : null; },
    async put(k, v) { store.set(k, v); },
    async delete(k) { store.delete(k); },
    async list({ prefix = '' } = {}) {
      const keys = [...store.keys()].filter(k => k.startsWith(prefix)).map(name => ({ name }));
      return { keys, list_complete: true, cursor: null };
    },
    _store: store,
  };
}

describe('checkRateLimit', () => {
  it('allows up to the limit then blocks within the same window', async () => {
    const env = { FOTOS: fakeKV() };
    const results = [];
    for (let i = 0; i < 5; i++) results.push(await checkRateLimit(env, '1.2.3.4', 'login', 3, 600));
    expect(results).toEqual([true, true, true, false, false]);
  });
  it('tracks each IP independently', async () => {
    const env = { FOTOS: fakeKV() };
    expect(await checkRateLimit(env, 'a', 'k', 1, 600)).toBe(true);
    expect(await checkRateLimit(env, 'a', 'k', 1, 600)).toBe(false);
    expect(await checkRateLimit(env, 'b', 'k', 1, 600)).toBe(true);
  });
});

describe('getEvents / saveEvents', () => {
  it('round-trips events through KV (fresh read bypasses the cache)', async () => {
    const env = { FOTOS: fakeKV() };
    const events = [{ id: 'a', slug: 'x' }, { id: 'b', slug: 'y' }];
    await saveEvents(env, events);
    expect(await getEvents(env, true)).toEqual(events);
  });
  it('returns an empty array when the key is missing or corrupt', async () => {
    expect(await getEvents({ FOTOS: fakeKV() }, true)).toEqual([]);
    expect(await getEvents({ FOTOS: fakeKV({ events: 'not json' }) }, true)).toEqual([]);
  });
});

describe('getCategories', () => {
  it('returns the defaults when nothing is stored', async () => {
    expect(await getCategories({ FOTOS: fakeKV() })).toEqual(DEFAULT_CATEGORIES);
  });
  it('parses a stored array and filters non-strings', async () => {
    const env = { FOTOS: fakeKV({ categories: JSON.stringify(['Casamento', 42, 'Ensaio']) }) };
    expect(await getCategories(env)).toEqual(['Casamento', 'Ensaio']);
  });
  it('falls back to defaults on non-array or invalid JSON', async () => {
    expect(await getCategories({ FOTOS: fakeKV({ categories: '{}' }) })).toEqual(DEFAULT_CATEGORIES);
    expect(await getCategories({ FOTOS: fakeKV({ categories: 'broken' }) })).toEqual(DEFAULT_CATEGORIES);
  });
});

// ---------------------------------------------------------------------------
// Corrupted KV values must degrade safely, never take the public site down or
// silently switch protections off.
// ---------------------------------------------------------------------------
describe('resilience to corrupted KV values', () => {
  it('getEvents drops junk entries instead of throwing on e.visible', async () => {
    const env = { FOTOS: fakeKV({ events: JSON.stringify([null, 'nope', 7, { id: 'ok', slug: 'ok' }]) }) };
    const events = await getEvents(env, true);
    expect(events).toHaveLength(1);
    expect(events[0].id).toBe('ok');
    // This is the exact expression galleryHTML/handleEventPage run.
    expect(() => events.filter(e => e.visible !== false)).not.toThrow();
    expect(() => events.find(e => e.slug === 'ok')).not.toThrow();
  });

  it('getEvents returns [] when the stored value is not an array', async () => {
    const env = { FOTOS: fakeKV({ events: JSON.stringify({ oops: true }) }) };
    expect(await getEvents(env, true)).toEqual([]);
  });

  it('getEvents returns [] on malformed JSON', async () => {
    const env = { FOTOS: fakeKV({ events: '{not json' }) };
    expect(await getEvents(env, true)).toEqual([]);
  });

  it('checkRateLimit still counts when the stored counter is unparseable (fails closed)', async () => {
    // A poisoned counter used to make parseInt return NaN; NaN >= limit is
    // false, so the limit stopped applying entirely for that key.
    const env = { FOTOS: fakeKV() };
    const window = Math.floor(Date.now() / (600 * 1000));
    env.FOTOS._store.set(`ratelimit:login:1.2.3.4:${window}`, 'NaN');
    const results = [];
    for (let i = 0; i < 4; i++) results.push(await checkRateLimit(env, '1.2.3.4', 'login', 2, 600));
    expect(results).toEqual([true, true, false, false]);
  });
});
