import fs from 'node:fs';
import path from 'node:path';
import Fastify, { type FastifyError, type FastifyInstance } from 'fastify';
import cookie from '@fastify/cookie';
import formbody from '@fastify/formbody';
import multipart from '@fastify/multipart';
import helmet from '@fastify/helmet';
import rateLimit from '@fastify/rate-limit';
import fastifyStatic from '@fastify/static';
import view from '@fastify/view';
import ejs from 'ejs';
import type Database from 'better-sqlite3';
import type { Config } from './config';
import type { Db } from './db/client';
import { registerSessionAuth } from './plugins/session-auth';
import { registerAuthRoutes } from './routes/auth';
import { registerDashboardRoutes } from './routes/dashboard';
import { registerCategoryRoutes } from './routes/categories';
import { registerTagRoutes } from './routes/tags';
import { registerPostRoutes } from './routes/posts';
import { registerMediaRoutes } from './routes/media';

export interface AppDeps {
  db: Db;
  sqlite: Database.Database;
  config: Config;
}

export async function buildApp({ db, sqlite, config }: AppDeps): Promise<FastifyInstance> {
  const app = Fastify({
    logger: config.NODE_ENV === 'test' ? false : { level: 'info' },
  });

  await app.register(cookie, { secret: config.SESSION_SECRET });
  await app.register(formbody);
  await app.register(multipart, {
    limits: { fileSize: 10 * 1024 * 1024, files: 1 },
  });
  await app.register(helmet, {
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        styleSrc: ["'self'", "'unsafe-inline'"],
        imgSrc: ["'self'", 'data:', 'blob:', 'https:'],
        fontSrc: ["'self'", 'data:'],
        connectSrc: ["'self'"],
        workerSrc: ["'self'", 'blob:'],
        scriptSrc: ["'self'"],
        frameAncestors: ["'none'"],
        baseUri: ["'none'"],
        formAction: ["'self'"],
        upgradeInsecureRequests: null,
      },
    },
  });
  await app.register(rateLimit, { global: false });

  // Registered before the static routes so /img/uploads/ requires a session.
  registerSessionAuth(app, { db, config });

  fs.mkdirSync(config.UPLOADS_DIR, { recursive: true });
  await app.register(fastifyStatic, {
    root: path.resolve(__dirname, '../public'),
    prefix: '/static/',
  });
  await app.register(fastifyStatic, {
    root: path.resolve(__dirname, '../node_modules/vditor'),
    prefix: '/static/vditor/',
    decorateReply: false,
  });
  await app.register(fastifyStatic, {
    root: config.UPLOADS_DIR,
    prefix: '/img/uploads/',
    decorateReply: false,
  });
  await app.register(view, {
    engine: { ejs },
    root: path.resolve(__dirname, '../views'),
  });

  app.get('/healthz', async () => {
    sqlite.prepare('SELECT 1').get();
    return { ok: true };
  });

  await registerAuthRoutes(app, { db, config });
  await registerDashboardRoutes(app, { db });
  await registerCategoryRoutes(app, { db });
  await registerTagRoutes(app, { db });
  await registerPostRoutes(app, { db });
  await registerMediaRoutes(app, { db, uploadsDir: config.UPLOADS_DIR });

  app.setNotFoundHandler((request, reply) => {
    return reply.code(404).view('error.ejs', {
      message: '页面不存在',
      user: request.user ?? null,
      csrfToken: request.csrfToken ?? '',
    });
  });

  app.setErrorHandler((error: FastifyError, request, reply) => {
    request.log.error({ err: error }, 'request failed');
    if (reply.sent) return;
    const statusCode = error.statusCode ?? 500;
    const message = statusCode === 500 ? '服务器内部错误' : error.message;
    if ((request.headers.accept ?? '').includes('text/html')) {
      return reply.code(statusCode).view('error.ejs', {
        message,
        user: request.user ?? null,
        csrfToken: request.csrfToken ?? '',
      });
    }
    return reply.code(statusCode).send({ error: message });
  });

  return app;
}
