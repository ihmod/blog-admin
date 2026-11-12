import { describe, it, expect } from 'vitest';
import { loadConfig } from '../src/config';

const base = { SESSION_SECRET: 'x'.repeat(32) };

describe('loadConfig', () => {
  it('applies defaults', () => {
    const config = loadConfig({ ...base });
    expect(config.NODE_ENV).toBe('development');
    expect(config.HOST).toBe('127.0.0.1');
    expect(config.PORT).toBe(8080);
    expect(config.SESSION_TTL_HOURS).toBe(168);
    expect(config.LOGIN_RATE_LIMIT_MAX).toBe(5);
    expect(config.COOKIE_SECURE).toBe(false);
  });

  it('rejects a short session secret', () => {
    expect(() => loadConfig({ SESSION_SECRET: 'short' })).toThrow();
  });

  it('coerces numeric values', () => {
    const config = loadConfig({ ...base, PORT: '9000', SESSION_TTL_HOURS: '24' });
    expect(config.PORT).toBe(9000);
    expect(config.SESSION_TTL_HOURS).toBe(24);
  });

  it('parses COOKIE_SECURE as a boolean', () => {
    expect(loadConfig({ ...base, COOKIE_SECURE: 'true' }).COOKIE_SECURE).toBe(true);
    expect(loadConfig({ ...base, COOKIE_SECURE: 'false' }).COOKIE_SECURE).toBe(false);
  });

  it('rejects a bad NODE_ENV', () => {
    expect(() => loadConfig({ ...base, NODE_ENV: 'staging' })).toThrow();
  });

  it('rejects a short ADMIN_PASSWORD when provided', () => {
    expect(() => loadConfig({ ...base, ADMIN_PASSWORD: 'short' })).toThrow();
  });
});
