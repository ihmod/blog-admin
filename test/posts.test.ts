import { describe, it, expect, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { eq } from 'drizzle-orm';
import { createDb } from '../src/db/client';
import { applyMigrations } from '../src/db/migrate';
import { posts } from '../src/db/schema';
import { createCategory } from '../src/lib/categories';
import {
  createPost,
  getPost,
  listPosts,
  PostNotFoundError,
  publishPost,
  purgePost,
  restorePost,
  softDeletePost,
  unpublishPost,
  updatePost,
} from '../src/lib/posts';
import { listTags } from '../src/lib/tags';

const cleanups: Array<() => void> = [];
afterEach(() => {
  while (cleanups.length) cleanups.pop()!();
});

function setup() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ihmod-posts-'));
  const { db, sqlite } = createDb(path.join(dir, 'test.db'));
  cleanups.push(() => {
    sqlite.close();
    fs.rmSync(dir, { recursive: true, force: true });
  });
  applyMigrations(sqlite, path.resolve(process.cwd(), 'migrations'));
  return { db };
}

const base = {
  title: '信息收集',
  categoryId: null,
  description: 'desc',
  topImg: 'false',
  contentMd: '# hello',
  status: 'draft' as const,
  postDate: '2026-11-12 10:00:00',
  tags: ['收集', '谷歌'],
};

describe('posts service', () => {
  it('creates a post with abbrlink, path, tags, and hash', () => {
    const { db } = setup();
    const id = createPost(db, base);
    const post = getPost(db, id)!;
    expect(post.title).toBe('信息收集');
    expect(post.slug).toBe('信息收集');
    expect(post.abbrlink).toMatch(/^[0-9a-f]{8}$/);
    expect(post.sourcePath).toBe('未分类/信息收集.md');
    expect(post.tags.sort()).toEqual(['收集', '谷歌']);
    expect(post.contentHash).toMatch(/^[0-9a-f]{64}$/);
    expect(post.publishedAt).toBeNull();
  });

  it('uses the category folder and uniquifies slugs', () => {
    const { db } = setup();
    const category = createCategory(db, '网安');
    const first = createPost(db, { ...base, categoryId: category.id });
    const second = createPost(db, { ...base, categoryId: category.id });
    expect(getPost(db, first)!.sourcePath).toBe('网安/信息收集.md');
    expect(getPost(db, second)!.slug).toBe('信息收集-2');
    expect(getPost(db, second)!.sourcePath).toBe('网安/信息收集-2.md');
  });

  it('updates content while preserving abbrlink', () => {
    const { db } = setup();
    const id = createPost(db, base);
    const before = getPost(db, id)!;
    updatePost(db, id, { ...base, title: '信息收集 2', contentMd: 'changed', tags: ['新'] });
    const after = getPost(db, id)!;
    expect(after.abbrlink).toBe(before.abbrlink);
    expect(after.title).toBe('信息收集 2');
    expect(after.contentMd).toBe('changed');
    expect(after.tags).toEqual(['新']);
    expect(after.contentHash).not.toBe(before.contentHash);
    expect(listTags(db).map((tag) => tag.name)).toContain('新');
  });

  it('moves the file path when the category changes', () => {
    const { db } = setup();
    const security = createCategory(db, '网安');
    const id = createPost(db, base);
    updatePost(db, id, { ...base, categoryId: security.id });
    expect(getPost(db, id)!.sourcePath).toBe('网安/信息收集.md');
  });

  it('publishes and unpublishes', () => {
    const { db } = setup();
    const id = createPost(db, base);
    publishPost(db, id);
    expect(getPost(db, id)!.status).toBe('published');
    expect(getPost(db, id)!.publishedAt).not.toBeNull();
    unpublishPost(db, id);
    expect(getPost(db, id)!.status).toBe('draft');
    expect(getPost(db, id)!.publishedAt).not.toBeNull();
  });

  it('soft deletes, restores, and purges', () => {
    const { db } = setup();
    const id = createPost(db, base);
    softDeletePost(db, id);
    expect(getPost(db, id)!.deletedAt).not.toBeNull();
    expect(listPosts(db, { status: 'trash' }).total).toBe(1);
    restorePost(db, id);
    expect(getPost(db, id)!.deletedAt).toBeNull();
    purgePost(db, id);
    expect(getPost(db, id)).toBeNull();
    expect(() => updatePost(db, id, base)).toThrow(PostNotFoundError);
  });

  it('filters, searches, and paginates', () => {
    const { db } = setup();
    const category = createCategory(db, '网安');
    createPost(db, { ...base, title: 'A', categoryId: category.id });
    const published = createPost(db, { ...base, title: 'B', status: 'published' });
    createPost(db, { ...base, title: 'C' });
    expect(listPosts(db, { status: 'published' }).total).toBe(1);
    expect(listPosts(db, { status: 'draft' }).total).toBe(2);
    expect(listPosts(db, { status: 'all', categoryId: category.id }).total).toBe(1);
    expect(listPosts(db, { status: 'all', q: 'B' }).items[0].id).toBe(published);
    const page1 = listPosts(db, { status: 'all', page: 1, pageSize: 2 });
    expect(page1.items.length).toBe(2);
    expect(page1.totalPages).toBe(2);
  });
});
