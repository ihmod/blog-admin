import { describe, it, expect, afterEach } from 'vitest';
import { eq } from 'drizzle-orm';
import { posts } from '../src/db/schema';
import { createCategory } from '../src/lib/categories';
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

function form(csrf: string, fields: Record<string, string>): string {
  const params = new URLSearchParams({ _csrf: csrf, ...fields });
  return params.toString();
}

describe('post routes', () => {
  it('requires auth for the list', async () => {
    current = await makeTestApp();
    const res = await current.app.inject({ method: 'GET', url: '/posts' });
    expect(res.statusCode).toBe(302);
    expect(res.headers.location).toBe('/login');
  });

  it('creates a post and shows it in the list', async () => {
    const { app, db, cookie, csrf } = await setup();
    const category = createCategory(db, '网安');
    const res = await app.inject({
      method: 'POST', url: '/posts',
      headers: { cookie, 'content-type': 'application/x-www-form-urlencoded' },
      payload: form(csrf, {
        title: '信息收集',
        category_id: String(category.id),
        tags: '收集, 谷歌',
        content_md: '# hello',
        status: 'draft',
        post_date: '2026-11-12 10:00:00',
      }),
    });
    expect(res.statusCode).toBe(302);
    const post = db.select().from(posts).where(eq(posts.title, '信息收集')).get()!;
    expect(post.sourcePath).toBe('网安/信息收集.md');

    const list = await app.inject({ method: 'GET', url: '/posts', headers: { cookie } });
    expect(list.statusCode).toBe(200);
    expect(list.body).toContain('信息收集');
  });

  it('edits a post and changes its status', async () => {
    const { app, db, cookie, csrf } = await setup();
    const create = await app.inject({
      method: 'POST', url: '/posts',
      headers: { cookie, 'content-type': 'application/x-www-form-urlencoded' },
      payload: form(csrf, { title: 'A', content_md: 'one', status: 'draft', post_date: '2026-11-12 10:00:00' }),
    });
    expect(create.statusCode).toBe(302);
    const post = db.select().from(posts).where(eq(posts.title, 'A')).get()!;

    const edit = await app.inject({
      method: 'POST', url: `/posts/${post.id}`,
      headers: { cookie, 'content-type': 'application/x-www-form-urlencoded' },
      payload: form(csrf, { title: 'B', content_md: 'two', status: 'published', post_date: '2026-11-12 10:00:00' }),
    });
    expect(edit.statusCode).toBe(302);
    const updated = db.select().from(posts).where(eq(posts.id, post.id)).get()!;
    expect(updated.title).toBe('B');
    expect(updated.contentMd).toBe('two');
    expect(updated.status).toBe('published');
    expect(updated.publishedAt).not.toBeNull();
  });

  it('soft deletes, restores, and purges', async () => {
    const { app, db, cookie, csrf } = await setup();
    await app.inject({
      method: 'POST', url: '/posts',
      headers: { cookie, 'content-type': 'application/x-www-form-urlencoded' },
      payload: form(csrf, { title: 'A', content_md: '', status: 'draft', post_date: '2026-11-12 10:00:00' }),
    });
    const post = db.select().from(posts).where(eq(posts.title, 'A')).get()!;

    const del = await app.inject({
      method: 'POST', url: `/posts/${post.id}/delete`,
      headers: { cookie, 'content-type': 'application/x-www-form-urlencoded' },
      payload: `_csrf=${encodeURIComponent(csrf)}`,
    });
    expect(del.statusCode).toBe(302);
    expect(db.select().from(posts).where(eq(posts.id, post.id)).get()!.deletedAt).not.toBeNull();

    const restore = await app.inject({
      method: 'POST', url: `/posts/${post.id}/restore`,
      headers: { cookie, 'content-type': 'application/x-www-form-urlencoded' },
      payload: `_csrf=${encodeURIComponent(csrf)}`,
    });
    expect(restore.statusCode).toBe(302);
    expect(db.select().from(posts).where(eq(posts.id, post.id)).get()!.deletedAt).toBeNull();

    const purge = await app.inject({
      method: 'POST', url: `/posts/${post.id}/purge`,
      headers: { cookie, 'content-type': 'application/x-www-form-urlencoded' },
      payload: `_csrf=${encodeURIComponent(csrf)}`,
    });
    expect(purge.statusCode).toBe(302);
    expect(db.select().from(posts).where(eq(posts.id, post.id)).get()).toBeUndefined();
  });

  it('rejects a post without a title', async () => {
    const { app, cookie, csrf } = await setup();
    const res = await app.inject({
      method: 'POST', url: '/posts',
      headers: { cookie, 'content-type': 'application/x-www-form-urlencoded' },
      payload: form(csrf, { title: '   ', content_md: '', status: 'draft', post_date: '2026-11-12 10:00:00' }),
    });
    expect(res.statusCode).toBe(400);
    expect(res.body).toContain('标题不能为空');
  });
});
