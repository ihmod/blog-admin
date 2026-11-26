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

function isOriginAllowed(request: FastifyRequest, config: Config): boolean {
  const origin = request.headers.origin;
  if (!origin) return true;

  let parsed: URL;
  try {
    parsed = new URL(origin);
  } catch {
    return false;
  }

  const allowlist = (config.ALLOWED_ORIGINS ?? '')
    .split(',')
    .map((value) => value.trim())
    .filter(Boolean);
  if (allowlist.includes(origin)) return true;
  if (parsed.host === request.headers.host) return true;

  // Dev/test can sit behind IDE port forwarding where Origin != Host.
  // CSRF token validation still applies; production stays strict.
  return config.NODE_ENV !== 'production';
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
      if (!isOriginAllowed(request, config)) {
        return reply.code(403).send('Invalid origin');
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
