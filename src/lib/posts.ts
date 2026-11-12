import path from 'node:path';
import { and, desc, eq, inArray, isNotNull, isNull, like, sql, type SQL } from 'drizzle-orm';
import type { Db } from '../db/client';
import { categories, postTags, posts, tags } from '../db/schema';
import { contentHash, newAbbrlink, newId } from './ids';
import { slugify, uniqueSlug } from './slug';
import { formatStamp, nowStamp } from './dates';
import { setPostTags } from './tags';

export type PostStatus = 'draft' | 'published';

export interface PostInput {
  title: string;
  slug?: string | null;
  categoryId: number | null;
  description?: string | null;
  topImg?: string;
  contentMd: string;
  status: PostStatus;
  postDate?: string | null;
  tags: string[];
}

export interface PostListFilters {
  status: 'all' | 'draft' | 'published' | 'trash';
  categoryId?: number | null;
  q?: string;
  page?: number;
  pageSize?: number;
}

export class PostNotFoundError extends Error {}
export class PostValidationError extends Error {}

function categoryName(db: Db, categoryId: number | null): string {
  if (categoryId == null) return '未分类';
  return (
    db.select({ name: categories.name }).from(categories).where(eq(categories.id, categoryId)).get()
      ?.name ?? '未分类'
  );
}

function safeFolder(name: string): string {
  return name.replace(/[\\/]/g, '-').trim() || '未分类';
}

function slugsInCategory(db: Db, categoryId: number | null, excludeId?: string): Set<string> {
  const rows = categoryId == null
    ? db.select({ slug: posts.slug }).from(posts).where(
        excludeId ? and(isNull(posts.categoryId), sql`${posts.id} <> ${excludeId}`) : isNull(posts.categoryId),
      ).all()
    : db.select({ slug: posts.slug }).from(posts).where(
        excludeId
          ? and(eq(posts.categoryId, categoryId), sql`${posts.id} <> ${excludeId}`)
          : eq(posts.categoryId, categoryId),
      ).all();
  return new Set(rows.map((row) => row.slug));
}

function allSourcePaths(db: Db, excludeId?: string): Set<string> {
  const rows = excludeId
    ? db.select({ sourcePath: posts.sourcePath }).from(posts).where(sql`${posts.id} <> ${excludeId}`).all()
    : db.select({ sourcePath: posts.sourcePath }).from(posts).all();
  return new Set(rows.map((row) => row.sourcePath));
}

function uniquePath(base: string, taken: Set<string>): string {
  const ext = path.posix.extname(base);
  const stem = base.slice(0, -ext.length);
  let candidate = base;
  let index = 2;
  while (taken.has(candidate)) {
    candidate = `${stem}-${index}${ext}`;
    index += 1;
  }
  taken.add(candidate);
  return candidate;
}

function abbrlinkSet(db: Db): Set<string> {
  return new Set(db.select({ abbrlink: posts.abbrlink }).from(posts).all().map((row) => row.abbrlink));
}

function normalize(raw: PostInput): PostInput {
  if (!raw.title.trim()) throw new PostValidationError('标题不能为空');
  return {
    ...raw,
    title: raw.title.trim(),
    slug: raw.slug?.trim() || null,
    description: raw.description?.trim() || null,
    topImg: raw.topImg?.trim() || 'false',
    status: raw.status === 'published' ? 'published' : 'draft',
    tags: [...new Set(raw.tags.map((tag) => tag.trim()).filter(Boolean))],
  };
}

function hashFor(input: PostInput, categoryId: number | null, postDate: string): string {
  return contentHash({
    title: input.title,
    contentMd: input.contentMd,
    categoryId,
    tags: input.tags,
    description: input.description ?? null,
    topImg: input.topImg ?? 'false',
    postDate,
  });
}

export function createPost(db: Db, raw: PostInput): string {
  const input = normalize(raw);
  const categoryId = input.categoryId ?? null;
  const slug = uniqueSlug(slugify(input.slug ?? input.title), slugsInCategory(db, categoryId));
  const folder = safeFolder(categoryName(db, categoryId));
  const sourcePath = uniquePath(`${folder}/${slug}.md`, allSourcePaths(db));
  const abbrlink = newAbbrlink(abbrlinkSet(db));
  const now = nowStamp();
  const postDate = formatStamp(input.postDate) ?? now;
  const publishedAt = input.status === 'published' ? now : null;
  const id = newId();

  db.insert(posts)
    .values({
      id,
      title: input.title,
      slug,
      categoryId,
      description: input.description ?? null,
      topImg: input.topImg ?? 'false',
      contentMd: input.contentMd,
      status: input.status,
      abbrlink,
      sourcePath,
      postDate,
      createdAt: now,
      updatedAt: now,
      publishedAt,
      contentHash: hashFor(input, categoryId, postDate),
    })
    .run();
  setPostTags(db, id, input.tags);
  return id;
}

export function updatePost(db: Db, id: string, raw: PostInput): void {
  const existing = db.select().from(posts).where(eq(posts.id, id)).get();
  if (!existing) throw new PostNotFoundError('文章不存在');

  const input = normalize(raw);
  const categoryId = input.categoryId ?? null;
  const categoryChanged = existing.categoryId !== categoryId;
  const requestedSlug = slugify(input.slug ?? existing.slug);
  const slug = uniqueSlug(requestedSlug, slugsInCategory(db, categoryId, id));

  let sourcePath = existing.sourcePath;
  if (categoryChanged || slug !== existing.slug) {
    const folder = safeFolder(categoryName(db, categoryId));
    sourcePath = uniquePath(`${folder}/${slug}.md`, allSourcePaths(db, id));
  }

  const now = nowStamp();
  const postDate = formatStamp(input.postDate) ?? existing.postDate;
  const publishedAt =
    existing.publishedAt ?? (input.status === 'published' ? now : null);

  db.update(posts)
    .set({
      title: input.title,
      slug,
      categoryId,
      description: input.description ?? null,
      topImg: input.topImg ?? 'false',
      contentMd: input.contentMd,
      status: input.status,
      sourcePath,
      postDate,
      updatedAt: now,
      publishedAt,
      contentHash: hashFor(input, categoryId, postDate),
    })
    .where(eq(posts.id, id))
    .run();
  setPostTags(db, id, input.tags);
}

export function getPost(db: Db, id: string) {
  const row = db
    .select({
      id: posts.id,
      title: posts.title,
      slug: posts.slug,
      categoryId: posts.categoryId,
      categoryName: categories.name,
      description: posts.description,
      topImg: posts.topImg,
      contentMd: posts.contentMd,
      status: posts.status,
      abbrlink: posts.abbrlink,
      sourcePath: posts.sourcePath,
      postDate: posts.postDate,
      createdAt: posts.createdAt,
      updatedAt: posts.updatedAt,
      publishedAt: posts.publishedAt,
      deletedAt: posts.deletedAt,
      contentHash: posts.contentHash,
    })
    .from(posts)
    .leftJoin(categories, eq(posts.categoryId, categories.id))
    .where(eq(posts.id, id))
    .get();

  if (!row) return null;
  const tagRows = db
    .select({ name: tags.name })
    .from(postTags)
    .innerJoin(tags, eq(postTags.tagId, tags.id))
    .where(eq(postTags.postId, id))
    .orderBy(tags.name)
    .all();
  return { ...row, categoryName: row.categoryName ?? '未分类', tags: tagRows.map((tag) => tag.name) };
}

export function listPosts(db: Db, filters: PostListFilters) {
  const page = Math.max(1, filters.page ?? 1);
  const pageSize = Math.min(100, Math.max(1, filters.pageSize ?? 20));
  const conditions: SQL[] = [];

  if (filters.status === 'trash') {
    conditions.push(isNotNull(posts.deletedAt));
  } else if (filters.status === 'all') {
    conditions.push(isNull(posts.deletedAt));
  } else {
    conditions.push(isNull(posts.deletedAt), eq(posts.status, filters.status));
  }
  if (filters.categoryId != null) conditions.push(eq(posts.categoryId, filters.categoryId));
  if (filters.q?.trim()) conditions.push(like(posts.title, `%${filters.q.trim()}%`));

  const where = and(...conditions);
  const total =
    db.select({ n: sql<number>`count(*)` }).from(posts).where(where).get()?.n ?? 0;

  const rows = db
    .select({
      id: posts.id,
      title: posts.title,
      slug: posts.slug,
      categoryName: categories.name,
      status: posts.status,
      sourcePath: posts.sourcePath,
      abbrlink: posts.abbrlink,
      updatedAt: posts.updatedAt,
      deletedAt: posts.deletedAt,
    })
    .from(posts)
    .leftJoin(categories, eq(posts.categoryId, categories.id))
    .where(where)
    .orderBy(desc(posts.updatedAt))
    .limit(pageSize)
    .offset((page - 1) * pageSize)
    .all();

  const tagMap = new Map<string, string[]>();
  if (rows.length > 0) {
    const tagRows = db
      .select({ postId: postTags.postId, name: tags.name })
      .from(postTags)
      .innerJoin(tags, eq(postTags.tagId, tags.id))
      .where(inArray(postTags.postId, rows.map((row) => row.id)))
      .orderBy(tags.name)
      .all();
    for (const row of tagRows) {
      const list = tagMap.get(row.postId) ?? [];
      list.push(row.name);
      tagMap.set(row.postId, list);
    }
  }

  return {
    items: rows.map((row) => ({
      ...row,
      categoryName: row.categoryName ?? '未分类',
      tags: tagMap.get(row.id) ?? [],
    })),
    total,
    page,
    pageSize,
    totalPages: Math.max(1, Math.ceil(total / pageSize)),
  };
}

export function softDeletePost(db: Db, id: string): void {
  const now = nowStamp();
  const result = db
    .update(posts)
    .set({ deletedAt: now, updatedAt: now })
    .where(eq(posts.id, id))
    .run();
  if (result.changes === 0) throw new PostNotFoundError('文章不存在');
}

export function restorePost(db: Db, id: string): void {
  const result = db
    .update(posts)
    .set({ deletedAt: null, updatedAt: nowStamp() })
    .where(eq(posts.id, id))
    .run();
  if (result.changes === 0) throw new PostNotFoundError('文章不存在');
}

export function purgePost(db: Db, id: string): void {
  const result = db.delete(posts).where(eq(posts.id, id)).run();
  if (result.changes === 0) throw new PostNotFoundError('文章不存在');
}

export function publishPost(db: Db, id: string): void {
  const post = db.select().from(posts).where(eq(posts.id, id)).get();
  if (!post) throw new PostNotFoundError('文章不存在');
  db.update(posts)
    .set({
      status: 'published',
      publishedAt: post.publishedAt ?? nowStamp(),
      updatedAt: nowStamp(),
    })
    .where(eq(posts.id, id))
    .run();
}

export function unpublishPost(db: Db, id: string): void {
  const result = db
    .update(posts)
    .set({ status: 'draft', updatedAt: nowStamp() })
    .where(eq(posts.id, id))
    .run();
  if (result.changes === 0) throw new PostNotFoundError('文章不存在');
}
