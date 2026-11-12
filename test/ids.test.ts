import { describe, it, expect } from 'vitest';
import { contentHash, newAbbrlink, newId } from '../src/lib/ids';

describe('ids', () => {
  it('creates UUIDs', () => {
    expect(newId()).toMatch(/^[0-9a-f-]{36}$/);
    expect(newId()).not.toBe(newId());
  });

  it('creates unique 8-char hex abbrlinks', () => {
    const taken = new Set<string>();
    const values = new Set<string>();
    for (let i = 0; i < 50; i++) values.add(newAbbrlink(taken));
    expect(values.size).toBe(50);
    for (const value of values) expect(value).toMatch(/^[0-9a-f]{8}$/);
  });

  it('hashes content deterministically and ignores tag order', () => {
    const a = contentHash({
      title: 'T',
      contentMd: 'body',
      categoryId: 1,
      tags: ['a', 'b'],
      description: null,
      topImg: 'false',
      postDate: '2026-11-12 00:00:00',
    });
    const b = contentHash({
      title: 'T',
      contentMd: 'body',
      categoryId: 1,
      tags: ['b', 'a'],
      description: null,
      topImg: 'false',
      postDate: '2026-11-12 00:00:00',
    });
    expect(a).toBe(b);
    expect(a).toMatch(/^[0-9a-f]{64}$/);
    expect(contentHash({
      title: 'T2',
      contentMd: 'body',
      categoryId: 1,
      tags: ['a', 'b'],
      description: null,
      topImg: 'false',
      postDate: '2026-11-12 00:00:00',
    })).not.toBe(a);
  });
});
