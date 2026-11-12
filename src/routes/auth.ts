import type { FastifyInstance } from 'fastify';
import { eq } from 'drizzle-orm';
import type { Config } from '../config';
import type { Db } from '../db/client';
import { users } from '../db/schema';
import { verifyPassword } from '../auth/password';
import { createSession, deleteSession, SESSION_COOKIE } from '../auth/session';
import { cookieOptions } from '../plugins/session-auth';

export interface AuthRouteOptions {
  db: Db;
  config: Config;
}

export async function registerAuthRoutes(
  app: FastifyInstance,
  { db, config }: AuthRouteOptions,
): Promise<void> {
  app.get('/login', async (request, reply) => {
    if (request.user) return reply.redirect('/');
    return reply.view('login.ejs', {
      title: '登录',
      user: null,
      csrfToken: request.csrfToken,
      error: null,
    });
  });

  app.post(
    '/login',
    {
      config: {
        rateLimit: {
          max: config.LOGIN_RATE_LIMIT_MAX,
          timeWindow: '15 minutes',
        },
      },
    },
    async (request, reply) => {
      const body = request.body as { username?: string; password?: string } | undefined;
      const username = (body?.username ?? '').trim();
      const password = body?.password ?? '';

      const user = db.select().from(users).where(eq(users.username, username)).get();
      const valid = user ? await verifyPassword(user.passwordHash, password) : false;

      if (!user || !valid) {
        return reply.code(401).view('login.ejs', {
          title: '登录',
          user: null,
          csrfToken: request.csrfToken,
          error: '用户名或密码错误',
        });
      }

      const sessionId = createSession(db, user.id, config.SESSION_TTL_HOURS, {
        ip: request.ip ?? null,
        userAgent: request.headers['user-agent'] ?? null,
      });
      reply.setCookie(SESSION_COOKIE, sessionId, {
        ...cookieOptions(config),
        maxAge: config.SESSION_TTL_HOURS * 60 * 60,
      });
      return reply.redirect('/');
    },
  );

  app.post('/logout', async (request, reply) => {
    const raw = request.cookies[SESSION_COOKIE];
    if (raw) {
      const unsigned = request.unsignCookie(raw);
      if (unsigned.valid && unsigned.value) {
        deleteSession(db, unsigned.value);
      }
    }
    reply.clearCookie(SESSION_COOKIE, { path: '/' });
    return reply.redirect('/login');
  });
}
