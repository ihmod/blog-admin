import { and, eq, isNull, sql } from 'drizzle-orm';
import type { Db } from '../db/client';
import { postTags, posts, tags } from '../db/schema';
import { nowStamp } from './dates';

export class TagInUseError extends Error {}
export class DuplicateTagError extends Error {}

export interface TagRow {
  id: number;
  name: string;
  postCount: number;
}

export function listTags(db: Db): TagRow[] {
  return db
    .select({
      id: tags.id,
      name: tags.name,
      postCount: sql<number>`count(${posts.id})`,
    })
    .from(tags)
    .leftJoin(postTags, eq(postTags.tagId, tags.id))
    .leftJoin(posts, and(eq(posts.id, postTags.postId), isNull(posts.deletedAt)))
    .groupBy(tags.id, tags.name)
    .orderBy(tags.name)
    .all();
}

export function createTag(db: Db, name: string) {
  const clean = name.trim();
  if (!clean) throw new Error('标签名不能为空');
  if (db.select().from(tags).where(eq(tags.name, clean)).get()) {
    throw new DuplicateTagError('标签已存在');
  }
  db.insert(tags).values({ name: clean, createdAt: nowStamp() }).run();
  return db.select().from(tags).where(eq(tags.name, clean)).get()!;
}

export function renameTag(db: Db, id: number, name: string): void {
  const clean = name.trim();
  if (!clean) throw new Error('标签名不能为空');
  const existing = db.select().from(tags).where(eq(tags.name, clean)).get();
  if (existing && existing.id !== id) throw new DuplicateTagError('标签已存在');
  db.update(tags).set({ name: clean }).where(eq(tags.id, id)).run();
}

export function deleteTag(db: Db, id: number): void {
  const used =
    db.select({ n: sql<number>`count(*)` }).from(postTags).where(eq(postTags.tagId, id)).get()?.n ?? 0;
  if (used > 0) throw new TagInUseError('标签仍被文章使用');
  db.delete(tags).where(eq(tags.id, id)).run();
}

export function setPostTags(db: Db, postId: string, names: string[]): void {
  const clean = [...new Set(names.map((name) => name.trim()).filter(Boolean))];
  db.delete(postTags).where(eq(postTags.postId, postId)).run();
  for (const name of clean) {
    let tag = db.select({ id: tags.id }).from(tags).where(eq(tags.name, name)).get();
    if (!tag) {
      db.insert(tags).values({ name, createdAt: nowStamp() }).run();
      tag = db.select({ id: tags.id }).from(tags).where(eq(tags.name, name)).get()!;
    }
    db.insert(postTags).values({ postId, tagId: tag.id }).run();
  }
}
