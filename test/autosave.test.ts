import { describe, it, expect, afterEach } from 'vitest';
import { eq } from 'drizzle-orm';
import { posts } from '../src/db/schema';
import { createPost } from '../src/lib/posts';
import { makeTestApp, login, type TestApp } from './helpers';

let current: TestApp | null = null;
afterEach(async () => {
  if (current) await current.cleanup();
  current = null;
});

async function setup() {
  current = await makeTestApp();
  const { cookie, csrf } = await login(current.app);
  const id = createPost(current.db, {
    title: 'A',
    categoryId: null,
    contentMd: 'one',
    status: 'draft',
    postDate: '2026-11-12 10:00:00',
    tags: [],
  });
  return { ...current, cookie, csrf, id };
}

function autosave(app: any, cookie: string, csrf: string, id: string, fields: Record<string, string>) {
  const body = new URLSearchParams(fields).toString();
  return app.inject({
    method: 'POST',
    url: `/api/posts/${id}/autosave`,
    headers: {
      cookie,
      'x-csrf-token': csrf,
      'content-type': 'application/x-www-form-urlencoded',
    },
    payload: body,
  });
}

describe('autosave', () => {
  it('saves changed content and no-ops on the same content', async () => {
    const { app, db, cookie, csrf, id } = await setup();
    const before = db.select().from(posts).where(eq(posts.id, id)).get()!;

    const first = await autosave(app, cookie, csrf, id, {
      title: 'A',
      content_md: 'two',
    });
    expect(first.statusCode).toBe(200);
    expect(first.json()).toMatchObject({ saved: true });
    const after = db.select().from(posts).where(eq(posts.id, id)).get()!;
    expect(after.contentMd).toBe('two');
    expect(after.contentHash).not.toBe(before.contentHash);

    const second = await autosave(app, cookie, csrf, id, {
      title: 'A',
      content_md: 'two',
    });
    expect(second.statusCode).toBe(200);
    expect(second.json()).toMatchObject({ saved: false });
    expect(db.select().from(posts).where(eq(posts.id, id)).get()!.updatedAt).toBe(after.updatedAt);
  });

  it('keeps the existing title when the title is empty', async () => {
    const { app, db, cookie, csrf, id } = await setup();
    const res = await autosave(app, cookie, csrf, id, {
      title: '',
      content_md: 'changed',
    });
    expect(res.statusCode).toBe(200);
    expect(db.select().from(posts).where(eq(posts.id, id)).get()!.title).toBe('A');
  });

  it('rejects autosave without CSRF', async () => {
    const { app, cookie, id } = await setup();
    const res = await app.inject({
      method: 'POST',
      url: `/api/posts/${id}/autosave`,
      headers: { cookie, 'content-type': 'application/x-www-form-urlencoded' },
      payload: 'content_md=two',
    });
    expect(res.statusCode).toBe(403);
  });
});
