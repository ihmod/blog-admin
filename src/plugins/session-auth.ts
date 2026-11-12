import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import type { Config } from '../config';
import type { Db } from '../db/client';
import type { SessionUser } from '../auth/session';
import { getSessionUser, SESSION_COOKIE } from '../auth/session';
import { CSRF_COOKIE, generateCsrfToken, safeEqual } from '../auth/csrf';

declare module 'fastify' {
  interface FastifyRequest {
    user: SessionUser | null;
    csrfToken: string;
  }
}

interface Options {
  db: Db;
  config: Config;
}

const PUBLIC_PATHS = new Set(['/login', '/healthz']);

function cookieOptions(config: Config) {
  return {
    signed: true,
    httpOnly: true,
    sameSite: 'lax' as const,
    path: '/',
    secure: config.COOKIE_SECURE,
  };
}

export function registerSessionAuth(app: FastifyInstance, options: Options): void {
  const { db, config } = options;

  app.decorateRequest('user', null);
  app.decorateRequest('csrfToken', '');

  app.addHook('preHandler', async (request: FastifyRequest, reply: FastifyReply) => {
    const path = request.url.split('?')[0];

    if (path.startsWith('/static/') || path === '/favicon.ico' || path === '/healthz') {
      return;
    }

    // Establish or validate the CSRF token before checking auth.
    const rawCsrf = request.cookies[CSRF_COOKIE];
    let csrfToken: string | null = null;
    if (rawCsrf) {
      const unsigned = request.unsignCookie(rawCsrf);
      if (unsigned.valid && unsigned.value) csrfToken = unsigned.value;
    }
    if (!csrfToken) {
      csrfToken = generateCsrfToken();
      reply.setCookie(CSRF_COOKIE, csrfToken, cookieOptions(config));
    }
    request.csrfToken = csrfToken;

    if (request.method !== 'GET' && request.method !== 'HEAD' && request.method !== 'OPTIONS') {
      const submitted =
        (request.body as Record<string, unknown> | undefined)?._csrf ??
        request.headers['x-csrf-token'];
      if (!submitted || !safeEqual(csrfToken, String(submitted))) {
        return reply.code(403).send('Invalid CSRF token');
      }
      const origin = request.headers.origin;
      if (origin) {
        try {
          if (new URL(origin).host !== request.headers.host) {
            return reply.code(403).send('Invalid origin');
          }
        } catch {
          return reply.code(403).send('Invalid origin');
        }
      }
    }

    const rawSession = request.cookies[SESSION_COOKIE];
    if (rawSession) {
      const unsigned = request.unsignCookie(rawSession);
      if (unsigned.valid && unsigned.value) {
        request.user = getSessionUser(db, unsigned.value);
      }
    }

    if (!PUBLIC_PATHS.has(path) && !request.user) {
      if (request.method === 'GET') {
        return reply.redirect('/login');
      }
      return reply.code(401).send({ error: 'Unauthorized' });
    }
  });
}

export { cookieOptions };
