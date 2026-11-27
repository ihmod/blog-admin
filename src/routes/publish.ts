import type { FastifyInstance } from 'fastify';
import type { Config } from '../config';
import type { Db } from '../db/client';
import {
  PublishBusyError,
  getLatestPublishRun,
  getPublishState,
  listPublishRuns,
  publish,
  type PublishOptions,
} from '../services/publisher';

export interface PublishRouteOptions {
  db: Db;
  config: Config;
}

export function publishOptionsFromConfig(config: Config): PublishOptions {
  return {
    repoDir: config.REPO_DIR,
    repoUrl: config.REPO_URL,
    branch: config.REPO_BRANCH,
    keyPath: config.GIT_SSH_KEY_PATH,
    authorName: config.GIT_AUTHOR_NAME,
    authorEmail: config.GIT_AUTHOR_EMAIL,
    uploadsDir: config.UPLOADS_DIR,
    manifestPath: config.PUBLISH_MANIFEST_PATH,
  };
}

export async function registerPublishRoutes(
  app: FastifyInstance,
  { db, config }: PublishRouteOptions,
): Promise<void> {
  app.get('/publish', async (request, reply) => {
    const query = request.query as Record<string, string | undefined>;
    return reply.view('publish.ejs', {
      title: '发布',
      user: request.user,
      csrfToken: request.csrfToken,
      state: getPublishState(db),
      runs: listPublishRuns(db),
      notice: query.notice,
      error: query.error,
    });
  });

  app.post('/publish', async (request, reply) => {
    const wantsJson =
      request.headers['x-requested-with'] === 'fetch' ||
      (request.headers.accept ?? '').includes('application/json');
    if (wantsJson) {
      try {
        void publish(db, publishOptionsFromConfig(config)).catch(() => {});
      } catch (error) {
        if (error instanceof PublishBusyError) return reply.code(409).send({ error: 'busy' });
        throw error;
      }
      return reply.send({ started: true });
    }
    try {
      await publish(db, publishOptionsFromConfig(config));
    } catch (error) {
      if (error instanceof PublishBusyError) return reply.redirect('/publish?error=busy');
      return reply.redirect('/publish?error=failed');
    }
    return reply.redirect('/publish?notice=pushed');
  });

  app.get('/api/publish/state', async (request, reply) => {
    return reply.send(getPublishState(db));
  });

  app.get('/api/publish/runs/latest', async (request, reply) => {
    return reply.send(getLatestPublishRun(db) ?? null);
  });
}
