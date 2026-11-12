import type { FastifyInstance } from 'fastify';
import { and, eq, isNull, sql } from 'drizzle-orm';
import type { Db } from '../db/client';
import { categories, posts, tags } from '../db/schema';

export interface DashboardRouteOptions {
  db: Db;
}

export async function registerDashboardRoutes(
  app: FastifyInstance,
  { db }: DashboardRouteOptions,
): Promise<void> {
  app.get('/', async (request, reply) => {
    const total =
      db
        .select({ n: sql<number>`count(*)` })
        .from(posts)
        .where(isNull(posts.deletedAt))
        .get()?.n ?? 0;
    const published =
      db
        .select({ n: sql<number>`count(*)` })
        .from(posts)
        .where(and(eq(posts.status, 'published'), isNull(posts.deletedAt)))
        .get()?.n ?? 0;
    const drafts =
      db
        .select({ n: sql<number>`count(*)` })
        .from(posts)
        .where(and(eq(posts.status, 'draft'), isNull(posts.deletedAt)))
        .get()?.n ?? 0;
    const categoryCount = db.select({ n: sql<number>`count(*)` }).from(categories).get()?.n ?? 0;
    const tagCount = db.select({ n: sql<number>`count(*)` }).from(tags).get()?.n ?? 0;

    return reply.view('dashboard.ejs', {
      title: '仪表盘',
      user: request.user,
      csrfToken: request.csrfToken,
      counts: { total, published, drafts, categories: categoryCount, tags: tagCount },
    });
  });
}
