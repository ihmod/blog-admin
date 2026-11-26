import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { and, eq, isNull } from 'drizzle-orm';
import type { Db } from '../db/client';
import { categories, media, postTags, posts, tags } from '../db/schema';
import { isManagedPath, isSafeRelativePath, renderPostMarkdown } from '../lib/publish-format';

export class ExportError extends Error {}

export interface ExportOptions {
  repoDir: string;
  uploadsDir: string;
  manifestPath: string;
}

export interface ExportReport {
  posts: number;
  files: number;
  changed: number;
  deleted: number;
}

export interface PublishManifest {
  version: 1;
  files: Record<string, string>;
}

function sha256(data: Buffer | string): string {
  return crypto.createHash('sha256').update(data).digest('hex');
}

function loadManifest(manifestPath: string): PublishManifest {
  if (!fs.existsSync(manifestPath)) return { version: 1, files: {} };
  const parsed = JSON.parse(fs.readFileSync(manifestPath, 'utf8')) as PublishManifest;
  if (parsed.version !== 1 || typeof parsed.files !== 'object' || parsed.files === null) {
    throw new ExportError('invalid publish manifest');
  }
  return parsed;
}

function saveManifest(manifestPath: string, manifest: PublishManifest): void {
  fs.mkdirSync(path.dirname(manifestPath), { recursive: true });
  const temp = `${manifestPath}.tmp`;
  fs.writeFileSync(temp, `${JSON.stringify(manifest, null, 2)}\n`);
  fs.renameSync(temp, manifestPath);
}

function writeAtomic(target: string, data: Buffer): void {
  fs.mkdirSync(path.dirname(target), { recursive: true });
  const temp = `${target}.tmp`;
  fs.writeFileSync(temp, data);
  fs.renameSync(temp, target);
}

interface DesiredFile {
  hash: string;
  data: Buffer;
}

export function exportContent(db: Db, options: ExportOptions): ExportReport {
  const postRows = db
    .select({
      id: posts.id,
      title: posts.title,
      contentMd: posts.contentMd,
      topImg: posts.topImg,
      description: posts.description,
      abbrlink: posts.abbrlink,
      sourcePath: posts.sourcePath,
      postDate: posts.postDate,
      updatedAt: posts.updatedAt,
      categoryName: categories.name,
    })
    .from(posts)
    .leftJoin(categories, eq(posts.categoryId, categories.id))
    .where(and(eq(posts.status, 'published'), isNull(posts.deletedAt)))
    .all();

  const tagRows = db
    .select({ postId: postTags.postId, name: tags.name })
    .from(postTags)
    .innerJoin(tags, eq(postTags.tagId, tags.id))
    .orderBy(tags.name)
    .all();
  const tagMap = new Map<string, string[]>();
  for (const row of tagRows) {
    const list = tagMap.get(row.postId) ?? [];
    list.push(row.name);
    tagMap.set(row.postId, list);
  }

  const desired = new Map<string, DesiredFile>();
  const mediaNames = new Set<string>();

  for (const post of postRows) {
    if (!isSafeRelativePath(post.sourcePath)) {
      throw new ExportError(`unsafe source path: ${post.sourcePath}`);
    }
    const markdown = renderPostMarkdown(
      post,
      post.categoryName ?? '未分类',
      tagMap.get(post.id) ?? [],
    );
    const data = Buffer.from(markdown, 'utf8');
    desired.set(`source/_posts/${post.sourcePath}`, { hash: sha256(data), data });

    for (const match of post.contentMd.matchAll(/\/img\/uploads\/([A-Za-z0-9._-]+)/g)) {
      const name = match[1];
      if (!isSafeRelativePath(name)) throw new ExportError(`unsafe media name: ${name}`);
      const row = db.select().from(media).where(eq(media.storedName, name)).get();
      if (!row) throw new ExportError(`missing media record: ${name}`);
      const file = path.join(options.uploadsDir, name);
      if (!fs.existsSync(file)) throw new ExportError(`missing media file: ${name}`);
      mediaNames.add(name);
    }
  }

  for (const name of mediaNames) {
    const data = fs.readFileSync(path.join(options.uploadsDir, name));
    desired.set(`source/img/uploads/${name}`, { hash: sha256(data), data });
  }

  const previous = loadManifest(options.manifestPath);
  let changed = 0;
  let deleted = 0;

  for (const [relative, file] of desired) {
    const target = path.join(options.repoDir, relative);
    if (!fs.existsSync(target) || sha256(fs.readFileSync(target)) !== file.hash) {
      writeAtomic(target, file.data);
      changed += 1;
    }
  }

  for (const relative of Object.keys(previous.files)) {
    if (desired.has(relative) || !isManagedPath(relative)) continue;
    const target = path.join(options.repoDir, relative);
    if (fs.existsSync(target)) {
      fs.rmSync(target, { force: true });
      deleted += 1;
    }
  }

  const files: Record<string, string> = {};
  for (const [relative, file] of desired) files[relative] = file.hash;
  saveManifest(options.manifestPath, { version: 1, files });

  return { posts: postRows.length, files: desired.size, changed, deleted };
}
