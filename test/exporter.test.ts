import { describe, it, expect, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { eq } from 'drizzle-orm';
import { createDb } from '../src/db/client';
import { applyMigrations } from '../src/db/migrate';
import { posts } from '../src/db/schema';
import { createCategory } from '../src/lib/categories';
import { createPost, updatePost, unpublishPost } from '../src/lib/posts';
import { saveUpload } from '../src/services/media';
import { exportContent } from '../src/services/exporter';

const cleanups: Array<() => void> = [];
afterEach(() => {
  while (cleanups.length) cleanups.pop()!();
});

function setup() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ihmod-export-'));
  const repoDir = path.join(dir, 'repo');
  const uploadsDir = path.join(dir, 'uploads');
  const manifestPath = path.join(dir, 'publish-manifest.json');
  const { db, sqlite } = createDb(path.join(dir, 'test.db'));
  cleanups.push(() => {
    sqlite.close();
    fs.rmSync(dir, { recursive: true, force: true });
  });
  applyMigrations(sqlite, path.resolve(process.cwd(), 'migrations'));
  return { db, repoDir, uploadsDir, manifestPath };
}

const base = {
  title: '信息收集',
  categoryId: null,
  description: 'desc',
  topImg: 'false',
  contentMd: '## 域名\n\n内容\n',
  status: 'draft' as const,
  postDate: '2026-11-12 10:00:00',
  tags: ['信息收集', '谷歌'],
};

describe('exportContent', () => {
  it('writes published posts and a manifest, and omits drafts', () => {
    const { db, repoDir, uploadsDir, manifestPath } = setup();
    const category = createCategory(db, '网安');
    const published = createPost(db, { ...base, categoryId: category.id, status: 'published' });
    createPost(db, { ...base, title: '草稿', status: 'draft' });

    const report = exportContent(db, { repoDir, uploadsDir, manifestPath });
    expect(report.posts).toBe(1);
    expect(report.files).toBe(1);
    expect(report.changed).toBe(1);

    const file = path.join(repoDir, 'source/_posts/网安/信息收集.md');
    expect(fs.existsSync(file)).toBe(true);
    const content = fs.readFileSync(file, 'utf8');
    expect(content).toContain('categories: 网安');
    expect(content).toContain('abbrlink:');
    expect(content).toContain('  - 谷歌');
    expect(content).not.toContain('草稿');

    const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
    expect(manifest.version).toBe(1);
    expect(Object.keys(manifest.files)).toContain('source/_posts/网安/信息收集.md');

    const second = exportContent(db, { repoDir, uploadsDir, manifestPath });
    expect(second.changed).toBe(0);

    updatePost(db, published, { ...base, categoryId: category.id, status: 'published', contentMd: 'changed' });
    const third = exportContent(db, { repoDir, uploadsDir, manifestPath });
    expect(third.changed).toBe(1);

    unpublishPost(db, published);
    const fourth = exportContent(db, { repoDir, uploadsDir, manifestPath });
    expect(fourth.deleted).toBe(1);
    expect(fs.existsSync(file)).toBe(false);
  });

  it('copies referenced media and rejects missing media', () => {
    const { db, repoDir, uploadsDir, manifestPath } = setup();
    const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0]);
    const saved = saveUpload(db, uploadsDir, { filename: 'x.png', buffer: png });
    createPost(db, {
      ...base,
      contentMd: `![x](${saved.url})`,
      status: 'published',
    });
    exportContent(db, { repoDir, uploadsDir, manifestPath });
    expect(fs.existsSync(path.join(repoDir, 'source/img/uploads', saved.storedName))).toBe(true);

    createPost(db, {
      ...base,
      title: 'missing',
      contentMd: '![x](/img/uploads/missing.png)',
      status: 'published',
    });
    expect(() => exportContent(db, { repoDir, uploadsDir, manifestPath })).toThrow(/missing media/);
  });

  it('does not delete files outside the manifest or managed prefixes', () => {
    const { db, repoDir, uploadsDir, manifestPath } = setup();
    fs.mkdirSync(path.join(repoDir, 'themes'), { recursive: true });
    fs.writeFileSync(path.join(repoDir, '_config.yml'), 'title: test\n');
    fs.writeFileSync(path.join(repoDir, 'themes', 'keep.txt'), 'keep');
    exportContent(db, { repoDir, uploadsDir, manifestPath });
    expect(fs.existsSync(path.join(repoDir, '_config.yml'))).toBe(true);
    expect(fs.existsSync(path.join(repoDir, 'themes', 'keep.txt'))).toBe(true);
  });
});
