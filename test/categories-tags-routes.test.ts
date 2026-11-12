import { describe, it, expect, afterEach } from 'vitest';
import { eq } from 'drizzle-orm';
import { categories, posts, postTags, tags } from '../src/db/schema';
import { makeTestApp, login, type TestApp } from './helpers';

let current: TestApp | null = null;
afterEach(async () => {
  if (current) await current.cleanup();
  current = null;
});

async function setup() {
  current = await makeTestApp();
  const { cookie, csrf } = await login(current.app);
  return { ...current, cookie, csrf };
}

describe('category and tag routes', () => {
  it('requires auth', async () => {
    current = await makeTestApp();
    const res = await current.app.inject({ method: 'GET', url: '/categories' });
    expect(res.statusCode).toBe(302);
    expect(res.headers.location).toBe('/login');
  });

  it('creates, renames, and blocks deletion of a used category', async () => {
    const { app, db, cookie, csrf } = await setup();
    const create = await app.inject({
      method: 'POST', url: '/categories',
      headers: { cookie, 'content-type': 'application/x-www-form-urlencoded' },
      payload: `_csrf=${encodeURIComponent(csrf)}&name=${encodeURIComponent('网安')}`,
    });
    expect(create.statusCode).toBe(302);

    const category = db.select().from(categories).where(eq(categories.name, '网安')).get()!;
    const now = new Date().toISOString();
    db.insert(posts).values({
      id: 'p1', title: 'T', slug: 't', categoryId: category.id, topImg: 'false',
      contentMd: '', status: 'published', abbrlink: 'abc12345', sourcePath: '网安/t.md',
      postDate: now, createdAt: now, updatedAt: now,
    }).run();

    const del = await app.inject({
      method: 'POST', url: `/categories/${category.id}/delete`,
      headers: { cookie, 'content-type': 'application/x-www-form-urlencoded' },
      payload: `_csrf=${encodeURIComponent(csrf)}`,
    });
    expect(del.statusCode).toBe(302);
    expect(del.headers.location).toContain('error=category-in-use');
    expect(db.select().from(categories).where(eq(categories.id, category.id)).get()).toBeTruthy();

    const rename = await app.inject({
      method: 'POST', url: `/categories/${category.id}`,
      headers: { cookie, 'content-type': 'application/x-www-form-urlencoded' },
      payload: `_csrf=${encodeURIComponent(csrf)}&name=${encodeURIComponent('安全')}`,
    });
    expect(rename.statusCode).toBe(302);
    expect(db.select().from(categories).where(eq(categories.id, category.id)).get()!.name).toBe('安全');
  });

  it('creates a tag and blocks deleting it when used', async () => {
    const { app, db, cookie, csrf } = await setup();
    await app.inject({
      method: 'POST', url: '/tags',
      headers: { cookie, 'content-type': 'application/x-www-form-urlencoded' },
      payload: `_csrf=${encodeURIComponent(csrf)}&name=${encodeURIComponent('收集')}`,
    });
    const tag = db.select().from(tags).where(eq(tags.name, '收集')).get()!;
    const now = new Date().toISOString();
    db.insert(posts).values({
      id: 'p1', title: 'T', slug: 't', topImg: 'false', contentMd: '',
      status: 'published', abbrlink: 'abc12345', sourcePath: 't.md',
      postDate: now, createdAt: now, updatedAt: now,
    }).run();
    db.insert(postTags).values({ postId: 'p1', tagId: tag.id }).run();

    const del = await app.inject({
      method: 'POST', url: `/tags/${tag.id}/delete`,
      headers: { cookie, 'content-type': 'application/x-www-form-urlencoded' },
      payload: `_csrf=${encodeURIComponent(csrf)}`,
    });
    expect(del.statusCode).toBe(302);
    expect(del.headers.location).toContain('error=tag-in-use');
    expect(db.select().from(tags).where(eq(tags.id, tag.id)).get()).toBeTruthy();
  });

  it('rejects mutations without CSRF', async () => {
    const { app, cookie } = await setup();
    const res = await app.inject({
      method: 'POST', url: '/categories',
      headers: { cookie, 'content-type': 'application/x-www-form-urlencoded' },
      payload: 'name=test',
    });
    expect(res.statusCode).toBe(403);
  });
});
