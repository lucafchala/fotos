import { describe, it, expect } from 'vitest';
import { mergeRestore, buildBackup, trimRequests } from '../src/index.js';

describe('mergeRestore', () => {
  it('adds events absent from the current set', () => {
    const current = [{ id: 'a', title: 'A' }];
    const { events, added, updated } = mergeRestore(current, [{ id: 'b', title: 'B' }]);
    expect(added).toBe(1);
    expect(updated).toBe(0);
    expect(events.map(e => e.id).sort()).toEqual(['a', 'b']);
  });
  it('replaces an existing event only when the backup is newer', () => {
    const current = [{ id: 'a', title: 'old', updatedAt: '2025-01-01T00:00:00Z' }];
    const newer = mergeRestore(current, [{ id: 'a', title: 'new', updatedAt: '2026-01-01T00:00:00Z' }]);
    expect(newer.updated).toBe(1);
    expect(newer.events.find(e => e.id === 'a').title).toBe('new');

    const older = mergeRestore(current, [{ id: 'a', title: 'older', updatedAt: '2024-01-01T00:00:00Z' }]);
    expect(older.updated).toBe(0);
    expect(older.events.find(e => e.id === 'a').title).toBe('old');
  });
  it('does not mutate the current array', () => {
    const current = [{ id: 'a' }];
    mergeRestore(current, [{ id: 'b' }]);
    expect(current).toEqual([{ id: 'a' }]);
  });
});

describe('buildBackup', () => {
  it('produces a v2 envelope with counts and all sections', () => {
    const out = JSON.parse(buildBackup({
      events: [{ id: 'a' }, { id: 'b' }],
      categories: ['Casamento'],
      reviews: [{ id: 'r1' }],
      removalRequests: [{ id: 'q1' }],
    }));
    expect(out.version).toBe(2);
    expect(out.eventCount).toBe(2);
    expect(out.categories).toEqual(['Casamento']);
    expect(out.reviews).toHaveLength(1);
    expect(out.removalRequests).toHaveLength(1);
    expect(typeof out.backupAt).toBe('string');
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
