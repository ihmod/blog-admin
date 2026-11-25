import { describe, it, expect, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { eq } from 'drizzle-orm';
import { media } from '../src/db/schema';
import { createPost } from '../src/lib/posts';
import { makeTestApp, login, type TestApp } from './helpers';

let current: TestApp | null = null;
afterEach(async () => {
  if (current) await current.cleanup();
  current = null;
});

const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0]);

function multipartBody(boundary: string, buffer: Buffer): Buffer {
  return Buffer.concat([
    Buffer.from(
      `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="x.png"\r\nContent-Type: image/png\r\n\r\n`,
    ),
    buffer,
    Buffer.from(`\r\n--${boundary}--\r\n`),
  ]);
}

async function setup() {
  current = await makeTestApp();
  const { cookie, csrf } = await login(current.app);
  return { ...current, cookie, csrf };
}

describe('media routes', () => {
  it('requires auth for the media page', async () => {
    current = await makeTestApp();
    const res = await current.app.inject({ method: 'GET', url: '/media' });
    expect(res.statusCode).toBe(302);
    expect(res.headers.location).toBe('/login');
  });

  it('serves the media upload script from /static', async () => {
    current = await makeTestApp();
    const res = await current.app.inject({ method: 'GET', url: '/static/media.js' });
    expect(res.statusCode).toBe(200);
  });

  it('uploads, serves, and deletes an image', async () => {
    const { app, db, uploadsDir, cookie, csrf } = await setup();
    const boundary = '----ihmodtest';
    const upload = await app.inject({
      method: 'POST',
      url: '/api/media',
      headers: {
        cookie,
        'x-csrf-token': csrf,
        'content-type': `multipart/form-data; boundary=${boundary}`,
      },
      payload: multipartBody(boundary, png),
    });
    expect(upload.statusCode).toBe(200);
    const body = upload.json() as { name: string; url: string };
    expect(body.url).toBe(`/img/uploads/${body.name}`);
    expect(fs.existsSync(path.join(uploadsDir, body.name))).toBe(true);

    const served = await app.inject({
      method: 'GET',
      url: `/img/uploads/${body.name}`,
      headers: { cookie },
    });
    expect(served.statusCode).toBe(200);
    expect(served.headers['content-type']).toContain('image/png');

    const anonymous = await app.inject({
      method: 'GET',
      url: `/img/uploads/${body.name}`,
    });
    expect(anonymous.statusCode).toBe(302);

    const row = db.select().from(media).where(eq(media.storedName, body.name)).get()!;
    const del = await app.inject({
      method: 'POST',
      url: `/media/${row.id}/delete`,
      headers: { cookie, 'content-type': 'application/x-www-form-urlencoded' },
      payload: `_csrf=${encodeURIComponent(csrf)}`,
    });
    expect(del.statusCode).toBe(302);
    expect(fs.existsSync(path.join(uploadsDir, body.name))).toBe(false);
  });

  it('blocks deletion when a post references the image', async () => {
    const { app, db, uploadsDir, cookie, csrf } = await setup();
    const boundary = '----ihmodtest';
    const upload = await app.inject({
      method: 'POST',
      url: '/api/media',
      headers: {
        cookie,
        'x-csrf-token': csrf,
        'content-type': `multipart/form-data; boundary=${boundary}`,
      },
      payload: multipartBody(boundary, png),
    });
    const body = upload.json() as { name: string; url: string };
    createPost(db, {
      title: 'uses image',
      categoryId: null,
      contentMd: `![x](${body.url})`,
      status: 'draft',
      postDate: '2026-11-12 10:00:00',
      tags: [],
    });
    const row = db.select().from(media).where(eq(media.storedName, body.name)).get()!;
    const del = await app.inject({
      method: 'POST',
      url: `/media/${row.id}/delete`,
      headers: { cookie, 'content-type': 'application/x-www-form-urlencoded' },
      payload: `_csrf=${encodeURIComponent(csrf)}`,
    });
    expect(del.statusCode).toBe(302);
    expect(del.headers.location).toContain('error=media-in-use');
    expect(fs.existsSync(path.join(uploadsDir, body.name))).toBe(true);
  });

  it('rejects an upload without CSRF', async () => {
    const { app, cookie } = await setup();
    const boundary = '----ihmodtest';
    const res = await app.inject({
      method: 'POST',
      url: '/api/media',
      headers: {
        cookie,
        'content-type': `multipart/form-data; boundary=${boundary}`,
      },
      payload: multipartBody(boundary, png),
    });
    expect(res.statusCode).toBe(403);
  });
});
