import { and, eq, isNull, sql } from 'drizzle-orm';
import type { Db } from '../db/client';
import { categories, posts } from '../db/schema';
import { nowStamp } from './dates';

export class CategoryInUseError extends Error {}
export class DuplicateCategoryError extends Error {}

export interface CategoryRow {
  id: number;
  name: string;
  postCount: number;
}

export function listCategories(db: Db): CategoryRow[] {
  return db
    .select({
      id: categories.id,
      name: categories.name,
      postCount: sql<number>`count(${posts.id})`,
    })
    .from(categories)
    .leftJoin(posts, and(eq(posts.categoryId, categories.id), isNull(posts.deletedAt)))
    .groupBy(categories.id, categories.name)
    .orderBy(categories.name)
    .all();
}

export function createCategory(db: Db, name: string) {
  const clean = name.trim();
  if (!clean) throw new Error('分类名不能为空');
  if (db.select().from(categories).where(eq(categories.name, clean)).get()) {
    throw new DuplicateCategoryError('分类已存在');
  }
  db.insert(categories).values({ name: clean, createdAt: nowStamp() }).run();
  return db.select().from(categories).where(eq(categories.name, clean)).get()!;
}

export function renameCategory(db: Db, id: number, name: string): void {
  const clean = name.trim();
  if (!clean) throw new Error('分类名不能为空');
  const existing = db.select().from(categories).where(eq(categories.name, clean)).get();
  if (existing && existing.id !== id) throw new DuplicateCategoryError('分类已存在');
  db.update(categories).set({ name: clean }).where(eq(categories.id, id)).run();
}

export function deleteCategory(db: Db, id: number): void {
  const used =
    db.select({ n: sql<number>`count(*)` }).from(posts).where(eq(posts.categoryId, id)).get()?.n ?? 0;
  if (used > 0) throw new CategoryInUseError('分类下还有文章');
  db.delete(categories).where(eq(categories.id, id)).run();
}
