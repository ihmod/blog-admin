import { describe, it, expect, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { eq } from 'drizzle-orm';
import { createDb } from '../src/db/client';
import { applyMigrations } from '../src/db/migrate';
import { publishState } from '../src/db/schema';
import { createPost, unpublishPost, updatePost } from '../src/lib/posts';
import {
  getPublishState,
  listPublishRuns,
  publish,
  recoverPublishState,
} from '../src/services/publisher';

const cleanups: Array<() => void> = [];
afterEach(() => {
  while (cleanups.length) cleanups.pop()!();
});

function git(cwd: string, ...args: string[]): string {
  return execFileSync('git', args, { cwd, encoding: 'utf8' });
}

function setupRepo() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ihmod-publish-'));
  const bare = path.join(dir, 'origin.git');
  const seed = path.join(dir, 'seed');
  git(dir, 'init', '--bare', bare);
  git(dir, 'clone', bare, seed);
  git(seed, 'config', 'user.name', 'Seed');
  git(seed, 'config', 'user.email', 'seed@example.com');
  fs.mkdirSync(path.join(seed, 'source', '_posts'), { recursive: true });
  fs.writeFileSync(path.join(seed, '_config.yml'), 'title: seed\n');
  fs.writeFileSync(path.join(seed, 'source', '_posts', 'keep.md'), '---\ntitle: keep\n---\n');
  git(seed, 'add', '-A');
  git(seed, 'commit', '-m', 'seed');
  git(seed, 'branch', '-M', 'main');
  git(seed, 'push', 'origin', 'main');

  const { db, sqlite } = createDb(path.join(dir, 'test.db'));
  applyMigrations(sqlite, path.resolve(process.cwd(), 'migrations'));
  const repoDir = path.join(dir, 'repo');
  const uploadsDir = path.join(dir, 'uploads');
  const manifestPath = path.join(dir, 'publish-manifest.json');
  cleanups.push(() => {
    sqlite.close();
    fs.rmSync(dir, { recursive: true, force: true });
  });
  return {
    db, sqlite, dir, bare, seed, repoDir, uploadsDir, manifestPath,
  };
}

const options = (s: ReturnType<typeof setupRepo>) => ({
  repoDir: s.repoDir,
  repoUrl: s.bare,
  branch: 'main',
  uploadsDir: s.uploadsDir,
  manifestPath: s.manifestPath,
  authorName: 'Admin',
  authorEmail: 'admin@example.com',
});

const base = {
  title: '信息收集',
  categoryId: null,
  description: 'desc',
  topImg: 'false',
  contentMd: 'body',
  status: 'draft' as const,
  postDate: '2026-11-12 10:00:00',
  tags: [],
};

describe('publish', () => {
  it('clones, commits, pushes, and records success', async () => {
    const s = setupRepo();
    const id = createPost(s.db, { ...base, status: 'published' });
    const report = await publish(s.db, options(s));
    expect(report.posts).toBe(1);
    expect(report.pushed).toBe(true);
    expect(report.commit).toMatch(/^[0-9a-f]{40}$/);

    const state = getPublishState(s.db);
    expect(state.status).toBe('success');
    expect(state.commitSha).toBe(report.commit);

    const log = git(s.bare, 'log', '--oneline', 'main');
    expect(log).toContain('chore(publish)');

    const second = await publish(s.db, options(s));
    expect(second.pushed).toBe(false);
    const count = Number(git(s.bare, 'rev-list', '--count', 'main').trim());
    expect(count).toBe(2); // seed + one publish

    updatePost(s.db, id, { ...base, status: 'published', contentMd: 'changed' });
    const third = await publish(s.db, options(s));
    expect(third.pushed).toBe(true);

    unpublishPost(s.db, id);
    const fourth = await publish(s.db, options(s));
    expect(fourth.pushed).toBe(true);

    const runs = listPublishRuns(s.db);
    expect(runs.length).toBe(4);
    expect(runs[0].status).toBe('success');
    expect(runs[0].commitSha).toBe(fourth.commit);
    expect(runs[0].log).toContain('导出完成');
  });

  it('aborts on uncommitted changes outside managed paths', async () => {
    const s = setupRepo();
    createPost(s.db, { ...base, status: 'published' });
    await publish(s.db, options(s));

    fs.writeFileSync(path.join(s.repoDir, '_config.yml'), 'title: dirty\n');
    await expect(publish(s.db, options(s))).rejects.toThrow(/uncommitted changes/);
    expect(getPublishState(s.db).status).toBe('error');

    const runs = listPublishRuns(s.db);
    expect(runs[0].status).toBe('error');
    expect(runs[0].log).toContain('失败');
  });

  it('recovers an interrupted running state', () => {
    const s = setupRepo();
    s.db.update(publishState).set({ status: 'running', startedAt: '2026-11-12 00:00:00' }).where(eq(publishState.id, 1)).run();
    recoverPublishState(s.db);
    expect(getPublishState(s.db).status).toBe('error');
  });
});
