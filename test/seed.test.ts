import { describe, it, expect, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createDb } from '../src/db/client';
import { applyMigrations } from '../src/db/migrate';
import { users } from '../src/db/schema';
import { seedAdmin } from '../src/auth/seed';
import { loadConfig } from '../src/config';

const cleanups: Array<() => void> = [];
afterEach(() => {
  while (cleanups.length) cleanups.pop()!();
});

function setup() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ihmod-seed-'));
  const { db, sqlite } = createDb(path.join(dir, 'test.db'));
  cleanups.push(() => {
    sqlite.close();
    fs.rmSync(dir, { recursive: true, force: true });
  });
  applyMigrations(sqlite, path.resolve(process.cwd(), 'migrations'));
  return db;
}

const base = {
  NODE_ENV: 'test',
  SESSION_SECRET: 'x'.repeat(32),
  ADMIN_USERNAME: 'admin',
};

describe('seedAdmin', () => {
  it('requires ADMIN_PASSWORD on first run', async () => {
    const db = setup();
    await expect(seedAdmin(db, loadConfig(base))).rejects.toThrow(/ADMIN_PASSWORD/);
  });

  it('creates the first admin and is idempotent', async () => {
    const db = setup();
    const config = loadConfig({ ...base, ADMIN_PASSWORD: 'test-password-123' });
    expect(await seedAdmin(db, config)).toEqual({ created: true });
    expect((db.select().from(users).all()).length).toBe(1);
    expect(await seedAdmin(db, config)).toEqual({ created: false });
    expect((db.select().from(users).all()).length).toBe(1);
  });
});
