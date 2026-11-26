import { describe, it, expect, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { createPost } from '../src/lib/posts';
import { makeTestApp, login, type TestApp } from './helpers';

let current: TestApp | null = null;
let repoRoot: string | null = null;
afterEach(async () => {
  if (current) await current.cleanup();
  if (repoRoot) fs.rmSync(repoRoot, { recursive: true, force: true });
  current = null;
  repoRoot = null;
});

function git(cwd: string, ...args: string[]): string {
  return execFileSync('git', args, { cwd, encoding: 'utf8' });
}

function seedBareRepo(): { bare: string; root: string } {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ihmod-pubroutes-'));
  const bare = path.join(root, 'origin.git');
  const seed = path.join(root, 'seed');
  git(root, 'init', '--bare', bare);
  git(root, 'clone', bare, seed);
  git(seed, 'config', 'user.name', 'Seed');
  git(seed, 'config', 'user.email', 'seed@example.com');
  fs.writeFileSync(path.join(seed, '_config.yml'), 'title: seed\n');
  git(seed, 'add', '-A');
  git(seed, 'commit', '-m', 'seed');
  git(seed, 'branch', '-M', 'main');
  git(seed, 'push', 'origin', 'main');
  return { bare, root };
}

async function setup() {
  const seeded = seedBareRepo();
  repoRoot = seeded.root;
  current = await makeTestApp({
    REPO_DIR: path.join(seeded.root, 'repo'),
    REPO_URL: seeded.bare,
    REPO_BRANCH: 'main',
    PUBLISH_MANIFEST_PATH: path.join(seeded.root, 'manifest.json'),
  });
  const { cookie, csrf } = await login(current.app);
  return { ...current, cookie, csrf, bare: seeded.bare };
}

describe('publish routes', () => {
  it('requires auth', async () => {
    current = await makeTestApp();
    const res = await current.app.inject({ method: 'GET', url: '/publish' });
    expect(res.statusCode).toBe(302);
  });

  it('renders the publish page and triggers a publish', async () => {
    const { app, db, cookie, csrf, bare } = await setup();
    createPost(db, {
      title: 'P',
      categoryId: null,
      contentMd: 'body',
      status: 'published',
      postDate: '2026-11-12 10:00:00',
      tags: [],
    });

    const page = await app.inject({ method: 'GET', url: '/publish', headers: { cookie } });
    expect(page.statusCode).toBe(200);
    expect(page.body).toContain('发布');

    const post = await app.inject({
      method: 'POST',
      url: '/publish',
      headers: { cookie, 'content-type': 'application/x-www-form-urlencoded' },
      payload: `_csrf=${encodeURIComponent(csrf)}`,
    });
    expect(post.statusCode).toBe(302);
    expect(post.headers.location).toContain('notice=pushed');

    const state = await app.inject({
      method: 'GET',
      url: '/api/publish/state',
      headers: { cookie },
    });
    expect(state.statusCode).toBe(200);
    expect(state.json()).toMatchObject({ status: 'success' });
    expect(git(bare, 'log', '--oneline', 'main')).toContain('chore(publish)');
  });

  it('rejects publish without CSRF', async () => {
    const { app, cookie } = await setup();
    const res = await app.inject({
      method: 'POST',
      url: '/publish',
      headers: { cookie, 'content-type': 'application/x-www-form-urlencoded' },
      payload: '',
    });
    expect(res.statusCode).toBe(403);
  });
});
