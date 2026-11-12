import { describe, it, expect, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { eq } from 'drizzle-orm';
import { createDb } from '../src/db/client';
import { applyMigrations } from '../src/db/migrate';
import { categories, posts, users } from '../src/db/schema';

const cleanups: Array<() => void> = [];
afterEach(() => {
  while (cleanups.length) cleanups.pop()!();
});

describe('drizzle schema', () => {
  it('inserts and reads a post', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ihmod-schema-'));
    const { db, sqlite } = createDb(path.join(dir, 'test.db'));
    cleanups.push(() => {
      sqlite.close();
      fs.rmSync(dir, { recursive: true, force: true });
    });
    applyMigrations(sqlite, path.resolve(process.cwd(), 'migrations'));

    const now = new Date().toISOString();
    db.insert(users)
      .values({ username: 'admin', passwordHash: 'hash', createdAt: now, updatedAt: now })
      .run();
    db.insert(categories).values({ name: '网安', createdAt: now }).run();
    db.insert(posts)
      .values({
        id: 'post-1',
        title: '信息收集',
        slug: 'info-gathering',
        categoryId: 1,
        description: 'test',
        topImg: 'false',
        contentMd: '# hello',
        status: 'draft',
        abbrlink: '312e3d12',
        sourcePath: '网安/信息收集.md',
        postDate: now,
        createdAt: now,
        updatedAt: now,
      })
      .run();

    const row = db.select().from(posts).where(eq(posts.id, 'post-1')).get();
    expect(row?.title).toBe('信息收集');
    expect(row?.status).toBe('draft');
    expect(row?.topImg).toBe('false');
  });
});
