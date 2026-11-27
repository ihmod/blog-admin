import fs from 'node:fs';
import path from 'node:path';
import { desc, eq } from 'drizzle-orm';
import { simpleGit, type SimpleGit } from 'simple-git';
import type { Db } from '../db/client';
import { publishRuns, publishState, type PublishRun } from '../db/schema';
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
    db.update(publishRuns)
      .set({
        status: 'error',
        message: 'publish was interrupted; check the repo and retry',
        finishedAt: nowStamp(),
      })
      .where(eq(publishRuns.status, 'running'))
      .run();
  }
}

export function listPublishRuns(db: Db, limit = 20): PublishRun[] {
  return db.select().from(publishRuns).orderBy(desc(publishRuns.id)).limit(limit).all();
}

async function openRepo(options: PublishOptions): Promise<SimpleGit> {
  const allowEnvironment = ['GIT_SSH_COMMAND'];
  if (!fs.existsSync(path.join(options.repoDir, '.git'))) {
    fs.mkdirSync(path.dirname(options.repoDir), { recursive: true });
    const clone = simpleGit({ allowEnvironment });
    if (options.keyPath) clone.env('GIT_SSH_COMMAND', sshCommand(options.keyPath));
    await clone.clone(options.repoUrl, options.repoDir, ['--branch', options.branch]);
  }

  const git = simpleGit({ baseDir: options.repoDir, allowEnvironment });
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
  const run = db
    .insert(publishRuns)
    .values({ status: 'running', startedAt: nowStamp() })
    .returning({ id: publishRuns.id })
    .get();
  const runId = run.id;
  const logLines: string[] = [];
  const log = (message: string) => {
    logLines.push(`[${new Date().toLocaleTimeString()}] ${message}`);
    db.update(publishRuns)
      .set({ log: logLines.join('\n') })
      .where(eq(publishRuns.id, runId))
      .run();
  };
  const finish = (
    status: 'success' | 'error',
    extra: { message?: string; commit?: string; posts?: number; files?: number; pushed?: boolean },
  ) => {
    db.update(publishRuns)
      .set({
        status,
        message: extra.message ?? null,
        commitSha: extra.commit ?? null,
        posts: extra.posts ?? 0,
        files: extra.files ?? 0,
        pushed: extra.pushed ? 1 : 0,
        finishedAt: nowStamp(),
        log: logLines.join('\n'),
      })
      .where(eq(publishRuns.id, runId))
      .run();
  };

  setState(db, 'running');
  log('开始发布');
  log(`仓库: ${options.repoUrl} (分支 ${options.branch})`);
  try {
    log('准备本地仓库…');
    const git = await openRepo(options);
    log('检查工作区…');
    await assertCleanOutsideManaged(git);

    const exported = exportContent(db, {
      repoDir: options.repoDir,
      uploadsDir: options.uploadsDir,
      manifestPath: options.manifestPath,
    });
    log(`导出完成: ${exported.posts} 篇文章, ${exported.files} 个文件`);

    fs.mkdirSync(path.join(options.repoDir, 'source/_posts'), { recursive: true });
    fs.mkdirSync(path.join(options.repoDir, 'source/img/uploads'), { recursive: true });
    await git.add(['-A', '--', 'source/_posts', 'source/img/uploads']);
    log('已暂存 source/_posts 和 source/img/uploads');
    const status = await git.status();
    if (status.staged.length > 0) {
      await git.commit(`chore(publish): sync ${exported.posts} posts`);
      log(`已提交 ${status.staged.length} 个文件变更`);
    } else {
      log('没有需要提交的变更');
    }

    await git.fetch('origin', options.branch);
    log(`已 fetch origin/${options.branch}`);
    const behind = Number(
      (await git.raw(['rev-list', '--count', `HEAD..origin/${options.branch}`])).trim(),
    );
    if (behind > 0) {
      log(`本地落后 ${behind} 个提交，执行 rebase…`);
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
      log('rebase 完成');
    }

    const ahead = Number(
      (await git.raw(['rev-list', '--count', `origin/${options.branch}..HEAD`])).trim(),
    );
    if (ahead > 0) {
      log(`推送 ${ahead} 个提交到 origin/${options.branch}…`);
      await git.push('origin', options.branch);
      log('推送成功');
    } else {
      log('没有新的提交需要推送');
    }

    const commit = (await git.revparse(['HEAD'])).trim();
    log(`完成: ${commit}`);
    finish('success', {
      commit,
      posts: exported.posts,
      files: exported.files,
      pushed: ahead > 0,
    });
    setState(db, 'success', null, commit);
    return {
      posts: exported.posts,
      files: exported.files,
      commit,
      pushed: ahead > 0,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    log(`失败: ${message}`);
    finish('error', { message });
    setState(db, 'error', message);
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
