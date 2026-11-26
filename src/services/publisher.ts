import fs from 'node:fs';
import path from 'node:path';
import { eq } from 'drizzle-orm';
import { simpleGit, type SimpleGit } from 'simple-git';
import type { Db } from '../db/client';
import { publishState } from '../db/schema';
import { nowStamp } from '../lib/dates';
import { isManagedPath } from '../lib/publish-format';
import { exportContent } from './exporter';

export class PublishError extends Error {}
export class PublishBusyError extends Error {}

export interface PublishOptions {
  repoDir: string;
  repoUrl: string;
  branch: string;
  keyPath?: string;
  authorName: string;
  authorEmail: string;
  uploadsDir: string;
  manifestPath: string;
}

export interface PublishReport {
  posts: number;
  files: number;
  commit: string;
  pushed: boolean;
}

export interface PublishStateRow {
  id: number;
  status: 'idle' | 'running' | 'success' | 'error';
  message: string | null;
  commitSha: string | null;
  startedAt: string | null;
  finishedAt: string | null;
}

let inFlight: Promise<PublishReport> | null = null;

function sshCommand(keyPath: string): string {
  return `ssh -i ${keyPath} -o IdentitiesOnly=yes -o StrictHostKeyChecking=accept-new`;
}

function setState(
  db: Db,
  status: PublishStateRow['status'],
  message: string | null = null,
  commitSha: string | null = null,
): void {
  const now = nowStamp();
  db.update(publishState)
    .set({
      status,
      message,
      commitSha,
      startedAt: status === 'running' ? now : undefined,
      finishedAt: status === 'running' ? null : now,
    })
    .where(eq(publishState.id, 1))
    .run();
}

export function getPublishState(db: Db): PublishStateRow {
  const row = db.select().from(publishState).where(eq(publishState.id, 1)).get();
  if (!row) throw new PublishError('publish_state row missing');
  return row as PublishStateRow;
}

export function recoverPublishState(db: Db): void {
  const state = getPublishState(db);
  if (state.status === 'running') {
    setState(db, 'error', 'publish was interrupted; check the repo and retry');
  }
}

async function openRepo(options: PublishOptions): Promise<SimpleGit> {
  if (!fs.existsSync(path.join(options.repoDir, '.git'))) {
    fs.mkdirSync(path.dirname(options.repoDir), { recursive: true });
    const clone = simpleGit();
    if (options.keyPath) clone.env('GIT_SSH_COMMAND', sshCommand(options.keyPath));
    await clone.clone(options.repoUrl, options.repoDir, ['--branch', options.branch]);
  }

  const git = simpleGit(options.repoDir);
  if (options.keyPath) git.env('GIT_SSH_COMMAND', sshCommand(options.keyPath));
  await git.addConfig('user.name', options.authorName);
  await git.addConfig('user.email', options.authorEmail);

  const current = (await git.revparse(['--abbrev-ref', 'HEAD'])).trim();
  if (current !== options.branch) await git.checkout(options.branch);
  await git.fetch('origin', options.branch);
  return git;
}

async function assertCleanOutsideManaged(git: SimpleGit): Promise<void> {
  const status = await git.status();
  const dirty = status.files
    .map((file) => file.path)
    .filter((filePath) => !isManagedPath(filePath));
  if (dirty.length > 0) {
    throw new PublishError(`uncommitted changes outside managed paths: ${dirty.join(', ')}`);
  }
}

async function runPublish(db: Db, options: PublishOptions): Promise<PublishReport> {
  setState(db, 'running');
  try {
    const git = await openRepo(options);
    await assertCleanOutsideManaged(git);

    const exported = exportContent(db, {
      repoDir: options.repoDir,
      uploadsDir: options.uploadsDir,
      manifestPath: options.manifestPath,
    });

    fs.mkdirSync(path.join(options.repoDir, 'source/_posts'), { recursive: true });
    fs.mkdirSync(path.join(options.repoDir, 'source/img/uploads'), { recursive: true });
    await git.add(['-A', '--', 'source/_posts', 'source/img/uploads']);
    const status = await git.status();
    if (status.staged.length > 0) {
      await git.commit(`chore(publish): sync ${exported.posts} posts`);
    }

    await git.fetch('origin', options.branch);
    const behind = Number(
      (await git.raw(['rev-list', '--count', `HEAD..origin/${options.branch}`])).trim(),
    );
    if (behind > 0) {
      try {
        await git.rebase([`origin/${options.branch}`]);
      } catch (error) {
        try {
          await git.rebase(['--abort']);
        } catch {
          // ignore abort failure; the original error is more useful
        }
        throw new PublishError(
          `rebase conflict: ${error instanceof Error ? error.message : String(error)}`,
        );
      }
    }

    const ahead = Number(
      (await git.raw(['rev-list', '--count', `origin/${options.branch}..HEAD`])).trim(),
    );
    if (ahead > 0) await git.push('origin', options.branch);

    const commit = (await git.revparse(['HEAD'])).trim();
    setState(db, 'success', null, commit);
    return {
      posts: exported.posts,
      files: exported.files,
      commit,
      pushed: ahead > 0,
    };
  } catch (error) {
    setState(db, 'error', error instanceof Error ? error.message : String(error));
    throw error;
  }
}

export async function publish(db: Db, options: PublishOptions): Promise<PublishReport> {
  if (inFlight) throw new PublishBusyError('publish already running');
  inFlight = runPublish(db, options).finally(() => {
    inFlight = null;
  });
  return inFlight;
}
