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

async function makeApp() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ihmod-app-'));
  const { db, sqlite } = createDb(path.join(dir, 'test.db'));
  applyMigrations(sqlite, path.resolve(process.cwd(), 'migrations'));
  const config = loadConfig({
    NODE_ENV: 'test',
    SESSION_SECRET: 'x'.repeat(32),
    ADMIN_USERNAME: 'admin',
    ADMIN_PASSWORD: 'test-password-123',
    DATABASE_PATH: path.join(dir, 'test.db'),
    LOGIN_RATE_LIMIT_MAX: '100',
    COOKIE_SECURE: 'false',
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

describe('app security', () => {
  it('serves a public health check', async () => {
    const app = await makeApp();
    const res = await app.inject({ method: 'GET', url: '/healthz' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ ok: true });
  });

  it('redirects unauthenticated page requests to /login', async () => {
    const app = await makeApp();
    const res = await app.inject({ method: 'GET', url: '/' });
    expect(res.statusCode).toBe(302);
    expect(res.headers.location).toBe('/login');
  });

  it('rejects a login POST without a CSRF token', async () => {
    const app = await makeApp();
    const res = await app.inject({
      method: 'POST',
      url: '/login',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      payload: 'username=admin&password=test-password-123',
    });
    expect(res.statusCode).toBe(403);
  });
});
