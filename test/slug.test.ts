import { describe, it, expect } from 'vitest';
import { slugify, uniqueSlug } from '../src/lib/slug';

describe('slugify', () => {
  it('keeps Chinese and normalizes spaces', () => {
    expect(slugify('信息 收集')).toBe('信息-收集');
    expect(slugify('  Hello   World  ')).toBe('hello-world');
  });

  it('removes path separators and unsafe characters', () => {
    expect(slugify('网安/信息:收集')).toBe('网安-信息-收集');
    expect(slugify('../../etc/passwd')).toBe('etc-passwd');
  });

  it('falls back to post for empty input', () => {
    expect(slugify('   ')).toBe('post');
    expect(slugify('###')).toBe('post');
  });

  it('limits length', () => {
    expect(slugify('a'.repeat(200)).length).toBeLessThanOrEqual(80);
  });
});

describe('uniqueSlug', () => {
  it('adds -2, -3 suffixes', () => {
    const taken = new Set<string>();
    expect(uniqueSlug('post', taken)).toBe('post');
    expect(uniqueSlug('post', taken)).toBe('post-2');
    expect(uniqueSlug('post', taken)).toBe('post-3');
  });
});
