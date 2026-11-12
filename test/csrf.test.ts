import { describe, it, expect } from 'vitest';
import { CSRF_COOKIE, generateCsrfToken, safeEqual } from '../src/auth/csrf';

describe('csrf', () => {
  it('generates a 64-char hex token', () => {
    const token = generateCsrfToken();
    expect(token).toMatch(/^[0-9a-f]{64}$/);
    expect(generateCsrfToken()).not.toBe(token);
  });

  it('compares equal strings safely', () => {
    expect(safeEqual('abc', 'abc')).toBe(true);
    expect(safeEqual('abc', 'abd')).toBe(false);
    expect(safeEqual('abc', 'abcd')).toBe(false);
    expect(safeEqual('', '')).toBe(true);
  });

  it('exposes the cookie name', () => {
    expect(CSRF_COOKIE).toBe('ihmod_csrf');
  });
});
