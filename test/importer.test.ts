import { describe, it, expect, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { eq } from 'drizzle-orm';
import { createDb } from '../src/db/client';
import { applyMigrations } from '../src/db/migrate';
import { categories, posts } from '../src/db/schema';
import { importPosts } from '../src/services/importer';

const cleanups: Array<() => void> = [];
afterEach(() => {
  while (cleanups.length) cleanups.pop()!();
});

const fixtures = path.resolve(process.cwd(), 'test/fixtures/posts');

function setup() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ihmod-import-'));
  const { db, sqlite } = createDb(path.join(dir, 'test.db'));
  cleanups.push(() => {
    sqlite.close();
    fs.rmSync(dir, { recursive: true, force: true });
  });
  applyMigrations(sqlite, path.resolve(process.cwd(), 'migrations'));
  return { db, sqlite };
}

describe('importPosts', () => {
  it('imports all fixtures and skips hidden directories', () => {
    const { db, sqlite } = setup();
    const report = importPosts(db, sqlite, fixtures);

    expect(report.imported).toBe(4);
    expect(report.updated).toBe(0);
    expect(report.skipped).toBe(0);

    const rows = db.select().from(posts).all();
    expect(rows.length).toBe(4);
    expect(rows.every((row) => row.status === 'published')).toBe(true);

    const info = rows.find((row) => row.sourcePath === '网安/信息收集.md')!;
    expect(info.abbrlink).toBe('312e3d12');
    expect(info.postDate).toBe('2026-11-12 00:00:00');

    const diary = rows.find((row) => row.sourcePath === '日记/261112.md')!;
    expect(diary.postDate).toBe('2026-11-12 00:00:00');
    expect(diary.abbrlink).toMatch(/^[0-9a-f]{8}$/);

    const mybatis = rows.find((row) => row.sourcePath === '编程/MyBatis-Plus.md')!;
    const base = db.select().from(categories).where(eq(categories.name, '基础')).get()!;
    expect(mybatis.categoryId).toBe(base.id);

    const noFrontmatter = rows.find(
      (row) => row.sourcePath === '无分类/no-frontmatter.md',
    )!;
    expect(noFrontmatter.title).toBe('no-frontmatter');
    expect(noFrontmatter.postDate).toMatch(/^\d{4}-\d{2}-\d{2} /);

    expect(report.issues.some((issue) => issue.includes('missing abbrlink'))).toBe(true);
    expect(report.issues.some((issue) => issue.includes('date fallback'))).toBe(true);
  });

  it('is idempotent by default and updates with the update flag', () => {
    const { db, sqlite } = setup();
    importPosts(db, sqlite, fixtures);

    const second = importPosts(db, sqlite, fixtures);
    expect(second.imported).toBe(0);
    expect(second.updated).toBe(0);
    expect(second.skipped).toBe(4);
    expect(db.select().from(posts).all().length).toBe(4);

    const third = importPosts(db, sqlite, fixtures, { update: true });
    expect(third.imported).toBe(0);
    expect(third.updated).toBe(4);
    expect(third.skipped).toBe(0);
    expect(db.select().from(posts).all().length).toBe(4);
  });

  it('rolls back in dry-run mode', () => {
    const { db, sqlite } = setup();
    const report = importPosts(db, sqlite, fixtures, { dryRun: true });
    expect(report.imported).toBe(4);
    expect(db.select().from(posts).all().length).toBe(0);
    expect(db.select().from(categories).all().length).toBe(0);
  });
});
