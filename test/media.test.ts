import { describe, it, expect, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { eq } from 'drizzle-orm';
import { createDb } from '../src/db/client';
import { applyMigrations } from '../src/db/migrate';
import { media } from '../src/db/schema';
import { createPost } from '../src/lib/posts';
import {
  MediaInUseError,
  MediaValidationError,
  deleteMedia,
  detectImage,
  listMedia,
  saveUpload,
} from '../src/services/media';

const cleanups: Array<() => void> = [];
afterEach(() => {
  while (cleanups.length) cleanups.pop()!();
});

function setup() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ihmod-media-'));
  const uploadsDir = path.join(dir, 'uploads');
  const { db, sqlite } = createDb(path.join(dir, 'test.db'));
  cleanups.push(() => {
    sqlite.close();
    fs.rmSync(dir, { recursive: true, force: true });
  });
  applyMigrations(sqlite, path.resolve(process.cwd(), 'migrations'));
  return { db, uploadsDir };
}

const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0]);
const jpeg = Buffer.from([0xff, 0xd8, 0xff, 0x00]);
const gif = Buffer.from('GIF89a');
const webp = Buffer.from('RIFF0000WEBP');

describe('detectImage', () => {
  it('detects supported formats', () => {
    expect(detectImage(png)?.mime).toBe('image/png');
    expect(detectImage(jpeg)?.mime).toBe('image/jpeg');
    expect(detectImage(gif)?.mime).toBe('image/gif');
    expect(detectImage(webp)?.mime).toBe('image/webp');
  });

  it('rejects unknown formats', () => {
    expect(detectImage(Buffer.from('not an image'))).toBeNull();
  });
});

describe('media service', () => {
  it('writes the file and records it', () => {
    const { db, uploadsDir } = setup();
    const saved = saveUpload(db, uploadsDir, { filename: 'x.png', buffer: png });
    expect(saved.storedName).toMatch(/\.png$/);
    expect(saved.url).toBe(`/img/uploads/${saved.storedName}`);
    expect(fs.existsSync(path.join(uploadsDir, saved.storedName))).toBe(true);

    const row = db.select().from(media).where(eq(media.id, saved.id)).get()!;
    expect(row.mime).toBe('image/png');
    expect(row.size).toBe(png.length);
    expect(listMedia(db).map((item) => item.id)).toContain(saved.id);
  });

  it('rejects unsupported data', () => {
    const { db, uploadsDir } = setup();
    expect(() =>
      saveUpload(db, uploadsDir, { filename: 'x.txt', buffer: Buffer.from('nope') }),
    ).toThrow(MediaValidationError);
  });

  it('deletes unused media and its file', () => {
    const { db, uploadsDir } = setup();
    const saved = saveUpload(db, uploadsDir, { filename: 'x.png', buffer: png });
    deleteMedia(db, uploadsDir, saved.id);
    expect(db.select().from(media).where(eq(media.id, saved.id)).get()).toBeUndefined();
    expect(fs.existsSync(path.join(uploadsDir, saved.storedName))).toBe(false);
  });

  it('blocks deletion while a post references the image', () => {
    const { db, uploadsDir } = setup();
    const saved = saveUpload(db, uploadsDir, { filename: 'x.png', buffer: png });
    createPost(db, {
      title: 'uses image',
      categoryId: null,
      contentMd: `![x](${saved.url})`,
      status: 'draft',
      postDate: '2026-11-12 10:00:00',
      tags: [],
    });
    expect(() => deleteMedia(db, uploadsDir, saved.id)).toThrow(MediaInUseError);
    expect(fs.existsSync(path.join(uploadsDir, saved.storedName))).toBe(true);
  });
});
