import { describe, it, expect, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { eq } from 'drizzle-orm';
import { createDb } from '../src/db/client';
import { applyMigrations } from '../src/db/migrate';
import { categories, postTags, posts, tags } from '../src/db/schema';
import {
  CategoryInUseError,
  createCategory,
  deleteCategory,
  listCategories,
  renameCategory,
} from '../src/lib/categories';
import {
  TagInUseError,
  createTag,
  deleteTag,
  listTags,
  renameTag,
  setPostTags,
} from '../src/lib/tags';

const cleanups: Array<() => void> = [];
afterEach(() => {
  while (cleanups.length) cleanups.pop()!();
});

function setup() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ihmod-ct-'));
  const { db, sqlite } = createDb(path.join(dir, 'test.db'));
  cleanups.push(() => {
    sqlite.close();
    fs.rmSync(dir, { recursive: true, force: true });
  });
  applyMigrations(sqlite, path.resolve(process.cwd(), 'migrations'));
  const now = new Date().toISOString();
  const category = createCategory(db, '网安');
  db.insert(posts).values({
    id: 'p1',
    title: 'T',
    slug: 't',
    categoryId: category.id,
    topImg: 'false',
    contentMd: '',
    status: 'published',
    abbrlink: 'abc12345',
    sourcePath: '网安/t.md',
    postDate: now,
    createdAt: now,
    updatedAt: now,
  }).run();
  return { db };
}

describe('categories', () => {
  it('creates, lists, and renames', () => {
    const { db } = setup();
    expect(listCategories(db)[0]).toMatchObject({ name: '网安', postCount: 1 });
    renameCategory(db, listCategories(db)[0].id, '安全');
    expect(listCategories(db)[0].name).toBe('安全');
  });

  it('blocks deleting a category with posts', () => {
    const { db } = setup();
    const id = listCategories(db)[0].id;
    expect(() => deleteCategory(db, id)).toThrow(CategoryInUseError);
    expect(db.select().from(categories).where(eq(categories.id, id)).get()).toBeTruthy();
  });

  it('deletes an unused category', () => {
    const { db } = setup();
    const created = createCategory(db, '随笔');
    deleteCategory(db, created.id);
    expect(db.select().from(categories).where(eq(categories.id, created.id)).get()).toBeUndefined();
  });
});

describe('tags', () => {
  it('creates, lists, and replaces post tags', () => {
    const { db } = setup();
    setPostTags(db, 'p1', ['收集', '谷歌', '收集']);
    expect(listTags(db).map((tag) => tag.name).sort()).toEqual(['收集', '谷歌']);
    setPostTags(db, 'p1', ['仅一个']);
    const tagsAfter = listTags(db);
    expect(tagsAfter.find((tag) => tag.name === '仅一个')?.postCount).toBe(1);
    expect(tagsAfter.find((tag) => tag.name === '收集')?.postCount).toBe(0);
  });

  it('blocks deleting a tag used by a post', () => {
    const { db } = setup();
    setPostTags(db, 'p1', ['收集']);
    const id = listTags(db)[0].id;
    expect(() => deleteTag(db, id)).toThrow(TagInUseError);
    expect(db.select().from(tags).where(eq(tags.id, id)).get()).toBeTruthy();
  });

  it('deletes an unused tag and renames in place', () => {
    const { db } = setup();
    const tag = createTag(db, '旧名');
    renameTag(db, tag.id, '新名');
    expect(listTags(db).map((entry) => entry.name)).toContain('新名');
    deleteTag(db, tag.id);
    expect(db.select().from(tags).where(eq(tags.id, tag.id)).get()).toBeUndefined();
    expect(db.select().from(postTags).all()).toEqual([]);
  });
});
