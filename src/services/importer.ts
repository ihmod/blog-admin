import fs from 'node:fs';
import path from 'node:path';
import matter from 'gray-matter';
import { eq } from 'drizzle-orm';
import type Database from 'better-sqlite3';
import type { Db } from '../db/client';
import { categories, posts } from '../db/schema';
import { contentHash, newAbbrlink, newId } from '../lib/ids';
import { slugify, uniqueSlug } from '../lib/slug';
import { formatStamp, nowStamp, parseDiaryDate } from '../lib/dates';
import { setPostTags } from '../lib/tags';

export interface ImportOptions {
  dryRun?: boolean;
  update?: boolean;
}

export interface ImportReport {
  imported: number;
  updated: number;
  skipped: number;
  issues: string[];
}

class DryRunRollback extends Error {
  constructor(public report: ImportReport) {
    super('dry-run');
  }
}

function walk(dir: string): string[] {
  const files: string[] = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name.startsWith('.')) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) files.push(...walk(full));
    else if (entry.name.endsWith('.md')) files.push(full);
  }
  return files;
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function categoryFrom(data: Record<string, unknown>, relativePath: string): string {
  const raw = data.categories;
  if (Array.isArray(raw) && raw.length > 0) {
    const value = String(raw[0]).trim();
    if (value) return value;
  }
  if (typeof raw === 'string' && raw.trim()) return raw.trim();
  const parent = path.posix.dirname(relativePath);
  if (parent && parent !== '.') return parent.split('/')[0];
  return '未分类';
}

function tagsFrom(data: Record<string, unknown>): string[] {
  const raw = data.tags;
  const values = Array.isArray(raw)
    ? raw
    : typeof raw === 'string'
      ? raw.split(/[,，]/)
      : [];
  return [...new Set(values.map((value) => String(value).trim()).filter(Boolean))];
}

function topImgFrom(data: Record<string, unknown>): string {
  if (data.top_img === false) return 'false';
  if (typeof data.top_img === 'string' && data.top_img.trim()) return data.top_img.trim();
  return 'false';
}

function ensureCategory(db: Db, name: string): number {
  const existing = db
    .select({ id: categories.id })
    .from(categories)
    .where(eq(categories.name, name))
    .get();
  if (existing) return existing.id;
  db.insert(categories).values({ name, createdAt: nowStamp() }).run();
  return db
    .select({ id: categories.id })
    .from(categories)
    .where(eq(categories.name, name))
    .get()!.id;
}

export function importPosts(
  db: Db,
  sqlite: Database.Database,
  postsDir: string,
  options: ImportOptions = {},
): ImportReport {
  const files = walk(postsDir);
  const abbrlinks = new Set(
    db.select({ value: posts.abbrlink }).from(posts).all().map((row) => row.value),
  );
  let report: ImportReport | undefined;

  const run = (): ImportReport => {
    const result: ImportReport = { imported: 0, updated: 0, skipped: 0, issues: [] };

    for (const file of files) {
      const relativePath = path.relative(postsDir, file).split(path.sep).join('/');
      const parsed = matter(fs.readFileSync(file, 'utf8'));
      const data = asRecord(parsed.data);
      const body = parsed.content.trimStart();
      const title =
        typeof data.title === 'string' && data.title.trim()
          ? data.title.trim()
          : path.basename(file, '.md');
      const categoryName = categoryFrom(data, relativePath);
      const tags = tagsFrom(data);
      const topImg = topImgFrom(data);
      const description =
        typeof data.description === 'string' && data.description.trim()
          ? data.description.trim()
          : null;

      let postDate = formatStamp(data.date);
      if (!postDate) postDate = parseDiaryDate(path.basename(file));
      if (!postDate) {
        postDate = formatStamp(fs.statSync(file).mtime);
        result.issues.push(`date fallback to file mtime: ${relativePath}`);
      }
      if (!postDate) {
        postDate = nowStamp();
        result.issues.push(`date fallback to now: ${relativePath}`);
      }

      const existing = db
        .select()
        .from(posts)
        .where(eq(posts.sourcePath, relativePath))
        .get();

      if (existing && !options.update) {
        result.skipped += 1;
        continue;
      }

      const categoryId = ensureCategory(db, categoryName);
      const hash = contentHash({
        title,
        contentMd: body,
        categoryId,
        tags,
        description,
        topImg,
        postDate,
      });

      if (existing) {
        db.update(posts)
          .set({
            title,
            categoryId,
            description,
            topImg,
            contentMd: body,
            postDate,
            updatedAt: postDate,
            contentHash: hash,
          })
          .where(eq(posts.id, existing.id))
          .run();
        setPostTags(db, existing.id, tags);
        result.updated += 1;
        continue;
      }

      const rawAbbrlink = typeof data.abbrlink === 'string' ? data.abbrlink.trim() : '';
      let abbrlink: string;
      if (rawAbbrlink && !abbrlinks.has(rawAbbrlink)) {
        abbrlink = rawAbbrlink;
        abbrlinks.add(abbrlink);
      } else {
        if (rawAbbrlink) result.issues.push(`duplicate abbrlink ${rawAbbrlink}: ${relativePath}`);
        else result.issues.push(`missing abbrlink: ${relativePath}`);
        abbrlink = newAbbrlink(abbrlinks);
      }

      const takenSlugs = new Set(
        db
          .select({ slug: posts.slug })
          .from(posts)
          .where(eq(posts.categoryId, categoryId))
          .all()
          .map((row) => row.slug),
      );
      const slug = uniqueSlug(slugify(title), takenSlugs);

      db.insert(posts)
        .values({
          id: newId(),
          title,
          slug,
          categoryId,
          description,
          topImg,
          contentMd: body,
          status: 'published',
          abbrlink,
          sourcePath: relativePath,
          postDate,
          createdAt: postDate,
          updatedAt: postDate,
          publishedAt: postDate,
          contentHash: hash,
        })
        .run();

      const inserted = db
        .select({ id: posts.id })
        .from(posts)
        .where(eq(posts.sourcePath, relativePath))
        .get()!;
      setPostTags(db, inserted.id, tags);
      result.imported += 1;
    }

    return result;
  };

  try {
    const execute = sqlite.transaction(() => {
      report = run();
      if (options.dryRun) throw new DryRunRollback(report);
    });
    execute();
  } catch (error) {
    if (error instanceof DryRunRollback) return error.report;
    throw error;
  }

  return report!;
}
