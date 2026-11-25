import { describe, it, expect, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createDb } from '../src/db/client';
import { applyMigrations } from '../src/db/migrate';
import { seedAdmin } from '../src/auth/seed';
import { loadConfig } from '../src/config';
import { buildApp } from '../src/app';

const cleanups: Array<() => void> = [];
afterEach(() => {
  while (cleanups.length) cleanups.pop()!();
});

async function makeApp(overrides: Record<string, string> = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ihmod-routes-'));
  const { db, sqlite } = createDb(path.join(dir, 'test.db'));
  applyMigrations(sqlite, path.resolve(process.cwd(), 'migrations'));
  const config = loadConfig({
    NODE_ENV: 'test',
    SESSION_SECRET: 'x'.repeat(32),
    ADMIN_USERNAME: 'admin',
    ADMIN_PASSWORD: 'test-password-123',
    DATABASE_PATH: path.join(dir, 'test.db'),
    UPLOADS_DIR: path.join(dir, 'uploads'),
    LOGIN_RATE_LIMIT_MAX: '100',
    COOKIE_SECURE: 'false',
    ...overrides,
  });
  await seedAdmin(db, config);
  const app = await buildApp({ db, sqlite, config });
  cleanups.push(async () => {
    await app.close();
    sqlite.close();
    fs.rmSync(dir, { recursive: true, force: true });
  });
  return app;
}

function setCookies(res: { headers: Record<string, unknown> }): string[] {
  const raw = res.headers['set-cookie'];
  if (!raw) return [];
  return Array.isArray(raw) ? raw : [raw as string];
}

function cookieHeader(cookies: string[]): string {
  return cookies.map((cookie) => cookie.split(';')[0]).join('; ');
}

function extractCsrf(html: string): string {
  const match = html.match(/name="_csrf" value="([^"]+)"/);
  if (!match) throw new Error('csrf token not found');
  return match[1];
}

describe('login flow', () => {
  it('renders the login form with a CSRF token', async () => {
    const app = await makeApp();
    const res = await app.inject({ method: 'GET', url: '/login' });
    expect(res.statusCode).toBe(200);
    expect(res.body).toContain('name="_csrf"');
    expect(setCookies(res).length).toBeGreaterThan(0);
  });

  it('logs in with valid credentials and reaches the dashboard', async () => {
    const app = await makeApp();
    const loginPage = await app.inject({ method: 'GET', url: '/login' });
    const cookies = setCookies(loginPage);
    const csrf = extractCsrf(loginPage.body);

    const login = await app.inject({
      method: 'POST',
      url: '/login',
      headers: {
        cookie: cookieHeader(cookies),
        'content-type': 'application/x-www-form-urlencoded',
      },
      payload: `_csrf=${encodeURIComponent(csrf)}&username=admin&password=test-password-123`,
    });
    expect(login.statusCode).toBe(302);
    expect(login.headers.location).toBe('/');

    const allCookies = [...cookies, ...setCookies(login)];
    const dashboard = await app.inject({
      method: 'GET',
      url: '/',
      headers: { cookie: cookieHeader(allCookies) },
    });
    expect(dashboard.statusCode).toBe(200);
    expect(dashboard.body).toContain('仪表盘');
  });

  it('rejects a wrong password', async () => {
    const app = await makeApp();
    const loginPage = await app.inject({ method: 'GET', url: '/login' });
    const cookies = setCookies(loginPage);
    const csrf = extractCsrf(loginPage.body);

    const login = await app.inject({
      method: 'POST',
      url: '/login',
      headers: {
        cookie: cookieHeader(cookies),
        'content-type': 'application/x-www-form-urlencoded',
      },
      payload: `_csrf=${encodeURIComponent(csrf)}&username=admin&password=wrong-password`,
    });
    expect(login.statusCode).toBe(401);
    expect(login.body).toContain('用户名或密码错误');
  });

  it('logs out and invalidates the session', async () => {
    const app = await makeApp();
    const loginPage = await app.inject({ method: 'GET', url: '/login' });
    const cookies = setCookies(loginPage);
    const csrf = extractCsrf(loginPage.body);
    const login = await app.inject({
      method: 'POST',
      url: '/login',
      headers: {
        cookie: cookieHeader(cookies),
        'content-type': 'application/x-www-form-urlencoded',
      },
      payload: `_csrf=${encodeURIComponent(csrf)}&username=admin&password=test-password-123`,
    });
    const allCookies = [...cookies, ...setCookies(login)];

    const logout = await app.inject({
      method: 'POST',
      url: '/logout',
      headers: {
        cookie: cookieHeader(allCookies),
        'content-type': 'application/x-www-form-urlencoded',
      },
      payload: `_csrf=${encodeURIComponent(csrf)}`,
    });
    expect(logout.statusCode).toBe(302);
    expect(logout.headers.location).toBe('/login');
  });

  it('rate-limits repeated failed logins', async () => {
    const app = await makeApp({ LOGIN_RATE_LIMIT_MAX: '2' });
    const loginPage = await app.inject({ method: 'GET', url: '/login' });
    const cookies = setCookies(loginPage);
    const csrf = extractCsrf(loginPage.body);

    const attempt = () =>
      app.inject({
        method: 'POST',
        url: '/login',
        headers: {
          cookie: cookieHeader(cookies),
          'content-type': 'application/x-www-form-urlencoded',
        },
        payload: `_csrf=${encodeURIComponent(csrf)}&username=admin&password=wrong`,
      });

    expect((await attempt()).statusCode).toBe(401);
    expect((await attempt()).statusCode).toBe(401);
    expect((await attempt()).statusCode).toBe(429);
  });
});
