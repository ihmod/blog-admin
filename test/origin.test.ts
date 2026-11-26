import { describe, it, expect, afterEach } from 'vitest';
import {
  cookieHeader,
  extractCsrf,
  makeTestApp,
  setCookies,
  type TestApp,
} from './helpers';

let current: TestApp | null = null;
afterEach(async () => {
  if (current) await current.cleanup();
  current = null;
});

async function loginWithOrigin(app: TestApp['app'], origin: string) {
  const page = await app.inject({ method: 'GET', url: '/login' });
  const cookies = setCookies(page);
  const csrf = extractCsrf(page.body);
  return app.inject({
    method: 'POST',
    url: '/login',
    headers: {
      cookie: cookieHeader(cookies),
      'content-type': 'application/x-www-form-urlencoded',
      origin,
    },
    payload: `_csrf=${encodeURIComponent(csrf)}&username=admin&password=test-password-123`,
  });
}

describe('CSRF origin check', () => {
  it('allows a proxied origin in development/test', async () => {
    current = await makeTestApp();
    const res = await loginWithOrigin(current.app, 'http://localhost:9999');
    expect(res.statusCode).toBe(302);
  });

  it('rejects a mismatched origin in production', async () => {
    current = await makeTestApp({ NODE_ENV: 'production' });
    const res = await loginWithOrigin(current.app, 'http://evil.example');
    expect(res.statusCode).toBe(403);
  });

  it('allows an explicitly allowlisted origin in production', async () => {
    current = await makeTestApp({
      NODE_ENV: 'production',
      ALLOWED_ORIGINS: 'http://admin.example',
    });
    const res = await loginWithOrigin(current.app, 'http://admin.example');
    expect(res.statusCode).toBe(302);
  });
});
