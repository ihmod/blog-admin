import { describe, it, expect, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createDb } from '../src/db/client';
import { applyMigrations } from '../src/db/migrate';

const cleanups: Array<() => void> = [];
afterEach(() => {
  while (cleanups.length) cleanups.pop()!();
});

describe('migrations', () => {
  it('creates all tables and seeds publish_state', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ihmod-db-'));
    const { sqlite } = createDb(path.join(dir, 'test.db'));
    cleanups.push(() => {
      sqlite.close();
      fs.rmSync(dir, { recursive: true, force: true });
    });

    applyMigrations(sqlite, path.resolve(process.cwd(), 'migrations'));

    const tables = sqlite
      .prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name")
      .all()
      .map((row: any) => row.name);

    expect(tables).toEqual(
      expect.arrayContaining([
        '_migrations',
        'users',
        'sessions',
        'categories',
        'tags',
        'posts',
        'post_tags',
        'media',
        'publish_state',
      ]),
    );

    const state = sqlite.prepare('SELECT status FROM publish_state WHERE id = 1').get() as any;
    expect(state.status).toBe('idle');
  });

  it('is idempotent', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ihmod-db-'));
    const { sqlite } = createDb(path.join(dir, 'test.db'));
    cleanups.push(() => {
      sqlite.close();
      fs.rmSync(dir, { recursive: true, force: true });
    });

    applyMigrations(sqlite, path.resolve(process.cwd(), 'migrations'));
    applyMigrations(sqlite, path.resolve(process.cwd(), 'migrations'));

    const count = sqlite.prepare('SELECT COUNT(*) AS n FROM _migrations').get() as any;
    expect(count.n).toBe(1);
  });
});
