import { describe, it, expect, afterEach } from 'vitest';
import { createPost } from '../src/lib/posts';
import { makeTestApp, login, type TestApp } from './helpers';

let current: TestApp | null = null;
afterEach(async () => {
  if (current) await current.cleanup();
  current = null;
});

describe('editor rendering', () => {
  it('renders the Vditor container, hidden content field, and assets', async () => {
    current = await makeTestApp();
    const { app, db } = current;
    const { cookie } = await login(app);
    const id = createPost(db, {
      title: 'editor post',
      categoryId: null,
      contentMd: '# hello',
      status: 'draft',
      postDate: '2026-11-12 10:00:00',
      tags: [],
    });

    const res = await app.inject({
      method: 'GET',
      url: `/posts/${id}`,
      headers: { cookie },
    });
    expect(res.statusCode).toBe(200);
    expect(res.body).toContain('id="vditor"');
    expect(res.body).toContain('name="content_md"');
    expect(res.body).toContain('/static/editor.js');
    expect(res.body).toContain('/static/vditor/dist/index.min.js');
    expect(res.body).toContain('/static/vditor/dist/index.css');
  });

  it('serves the Vditor assets', async () => {
    current = await makeTestApp();
    const res = await current.app.inject({
      method: 'GET',
      url: '/static/vditor/dist/index.min.js',
    });
    expect(res.statusCode).toBe(200);
  });

  it('serves the editor script', async () => {
    current = await makeTestApp();
    const res = await current.app.inject({
      method: 'GET',
      url: '/static/editor.js',
    });
    expect(res.statusCode).toBe(200);
  });
});
