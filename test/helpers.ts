import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { FastifyInstance } from 'fastify';
import { createDb } from '../src/db/client';
import { applyMigrations } from '../src/db/migrate';
import { seedAdmin } from '../src/auth/seed';
import { loadConfig } from '../src/config';
import { buildApp } from '../src/app';

export interface TestApp {
  app: FastifyInstance;
  db: ReturnType<typeof createDb>['db'];
  sqlite: ReturnType<typeof createDb>['sqlite'];
  dir: string;
  cleanup: () => Promise<void>;
}

export function setCookies(res: { headers: Record<string, unknown> }): string[] {
  const raw = res.headers['set-cookie'];
  if (!raw) return [];
  return Array.isArray(raw) ? raw : [raw as string];
}

export function cookieHeader(cookies: string[]): string {
  return cookies.map((cookie) => cookie.split(';')[0]).join('; ');
}

export function extractCsrf(html: string): string {
  const match = html.match(/name="_csrf" value="([^"]+)"/);
  if (!match) throw new Error('csrf token not found');
  return match[1];
}

export async function makeTestApp(overrides: Record<string, string> = {}): Promise<TestApp> {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ihmod-admin-'));
  const dbPath = path.join(dir, 'test.db');
  const { db, sqlite } = createDb(dbPath);
  applyMigrations(sqlite, path.resolve(process.cwd(), 'migrations'));
  const config = loadConfig({
    NODE_ENV: 'test',
    SESSION_SECRET: 'x'.repeat(32),
    ADMIN_USERNAME: 'admin',
    ADMIN_PASSWORD: 'test-password-123',
    DATABASE_PATH: dbPath,
    LOGIN_RATE_LIMIT_MAX: '100',
    COOKIE_SECURE: 'false',
    ...overrides,
  });
  await seedAdmin(db, config);
  const app = await buildApp({ db, sqlite, config });
  return {
    app,
    db,
    sqlite,
    dir,
    cleanup: async () => {
      await app.close();
      sqlite.close();
      fs.rmSync(dir, { recursive: true, force: true });
    },
  };
}

export async function login(app: FastifyInstance): Promise<{ cookie: string; csrf: string }> {
  const page = await app.inject({ method: 'GET', url: '/login' });
  const cookies = setCookies(page);
  const csrf = extractCsrf(page.body);
  const res = await app.inject({
    method: 'POST',
    url: '/login',
    headers: {
      cookie: cookieHeader(cookies),
      'content-type': 'application/x-www-form-urlencoded',
    },
    payload: `_csrf=${encodeURIComponent(csrf)}&username=admin&password=test-password-123`,
  });
  if (res.statusCode !== 302) throw new Error(`login failed: ${res.statusCode}`);
  return { cookie: cookieHeader([...cookies, ...setCookies(res)]), csrf };
}
