import fs from 'node:fs';
import path from 'node:path';
import { desc, eq, like, sql } from 'drizzle-orm';
import type { Db } from '../db/client';
import { media, posts } from '../db/schema';
import { newId } from '../lib/ids';
import { nowStamp } from '../lib/dates';

export class MediaValidationError extends Error {}
export class MediaInUseError extends Error {}
export class MediaNotFoundError extends Error {}

interface ImageType {
  mime: string;
  ext: string;
  matches(buffer: Buffer): boolean;
}

const IMAGE_TYPES: ImageType[] = [
  {
    mime: 'image/png',
    ext: 'png',
    matches: (buffer) =>
      buffer.length >= 8 &&
      buffer.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])),
  },
  {
    mime: 'image/jpeg',
    ext: 'jpg',
    matches: (buffer) =>
      buffer.length >= 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff,
  },
  {
    mime: 'image/gif',
    ext: 'gif',
    matches: (buffer) =>
      buffer.length >= 6 &&
      ['GIF87a', 'GIF89a'].includes(buffer.subarray(0, 6).toString('ascii')),
  },
  {
    mime: 'image/webp',
    ext: 'webp',
    matches: (buffer) =>
      buffer.length >= 12 &&
      buffer.subarray(0, 4).toString('ascii') === 'RIFF' &&
      buffer.subarray(8, 12).toString('ascii') === 'WEBP',
  },
];

export function detectImage(buffer: Buffer): ImageType | null {
  return IMAGE_TYPES.find((type) => type.matches(buffer)) ?? null;
}

export function ensureUploadsDir(uploadsDir: string): void {
  fs.mkdirSync(uploadsDir, { recursive: true });
}

export interface SavedUpload {
  id: string;
  storedName: string;
  url: string;
}

export function saveUpload(
  db: Db,
  uploadsDir: string,
  file: { filename: string; buffer: Buffer },
): SavedUpload {
  if (file.buffer.length > 10 * 1024 * 1024) {
    throw new MediaValidationError('文件超过 10MB');
  }
  const type = detectImage(file.buffer);
  if (!type) throw new MediaValidationError('不支持的图片格式');

  ensureUploadsDir(uploadsDir);
  const id = newId();
  const storedName = `${id}.${type.ext}`;
  const target = path.join(uploadsDir, storedName);
  fs.writeFileSync(target, file.buffer);

  try {
    db.insert(media)
      .values({
        id,
        originalName: file.filename.slice(0, 255),
        storedName,
        mime: type.mime,
        size: file.buffer.length,
        createdAt: nowStamp(),
      })
      .run();
  } catch (error) {
    fs.rmSync(target, { force: true });
    throw error;
  }

  return { id, storedName, url: `/img/uploads/${storedName}` };
}

export function listMedia(db: Db) {
  return db.select().from(media).orderBy(desc(media.createdAt)).all();
}

export function deleteMedia(db: Db, uploadsDir: string, id: string): void {
  const row = db.select().from(media).where(eq(media.id, id)).get();
  if (!row) throw new MediaNotFoundError('媒体不存在');

  const used =
    db
      .select({ n: sql<number>`count(*)` })
      .from(posts)
      .where(like(posts.contentMd, `%/img/uploads/${row.storedName}%`))
      .get()?.n ?? 0;
  if (used > 0) throw new MediaInUseError('图片仍被文章引用');

  db.delete(media).where(eq(media.id, id)).run();
  fs.rmSync(path.join(uploadsDir, row.storedName), { force: true });
}
