import path from 'node:path';
import Fastify, { type FastifyError, type FastifyInstance } from 'fastify';
import cookie from '@fastify/cookie';
import formbody from '@fastify/formbody';
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
  await app.register(helmet, {
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        styleSrc: ["'self'"],
        imgSrc: ["'self'", 'data:', 'https:'],
        scriptSrc: ["'self'"],
        frameAncestors: ["'none'"],
        baseUri: ["'none'"],
        formAction: ["'self'"],
        upgradeInsecureRequests: null,
      },
    },
  });
  await app.register(rateLimit, { global: false });
  await app.register(fastifyStatic, {
    root: path.resolve(__dirname, '../public'),
    prefix: '/static/',
  });
  await app.register(view, {
    engine: { ejs },
    root: path.resolve(__dirname, '../views'),
  });

  registerSessionAuth(app, { db, config });

  app.get('/healthz', async () => {
    sqlite.prepare('SELECT 1').get();
    return { ok: true };
  });

  await registerAuthRoutes(app, { db, config });
  await registerDashboardRoutes(app, { db });

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
