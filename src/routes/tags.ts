import type { FastifyInstance } from 'fastify';
import type { Db } from '../db/client';
import {
  DuplicateTagError,
  TagInUseError,
  createTag,
  deleteTag,
  listTags,
  renameTag,
} from '../lib/tags';

export interface TagRouteOptions { db: Db; }

function parseId(value: string): number | null {
  const id = Number(value);
  return Number.isInteger(id) && id > 0 ? id : null;
}

export async function registerTagRoutes(
  app: FastifyInstance,
  { db }: TagRouteOptions,
): Promise<void> {
  app.get('/tags', async (request, reply) => {
    const query = request.query as Record<string, string | undefined>;
    return reply.view('tags.ejs', {
      title: '标签',
      user: request.user,
      csrfToken: request.csrfToken,
      tags: listTags(db),
      notice: query.notice,
      error: query.error,
    });
  });

  app.post('/tags', async (request, reply) => {
    const body = request.body as { name?: string } | undefined;
    try {
      createTag(db, body?.name ?? '');
    } catch (error) {
      if (error instanceof DuplicateTagError) return reply.redirect('/tags?error=duplicate');
      if (error instanceof Error) return reply.redirect('/tags?error=invalid');
      throw error;
    }
    return reply.redirect('/tags?notice=created');
  });

  app.post('/tags/:id', async (request, reply) => {
    const { id } = request.params as { id: string };
    const tagId = parseId(id);
    if (!tagId) return reply.redirect('/tags?error=invalid');
    const body = request.body as { name?: string } | undefined;
    try {
      renameTag(db, tagId, body?.name ?? '');
    } catch (error) {
      if (error instanceof DuplicateTagError) return reply.redirect('/tags?error=duplicate');
      if (error instanceof Error) return reply.redirect('/tags?error=invalid');
      throw error;
    }
    return reply.redirect('/tags?notice=saved');
  });

  app.post('/tags/:id/delete', async (request, reply) => {
    const { id } = request.params as { id: string };
    const tagId = parseId(id);
    if (!tagId) return reply.redirect('/tags?error=invalid');
    try {
      deleteTag(db, tagId);
    } catch (error) {
      if (error instanceof TagInUseError) return reply.redirect('/tags?error=tag-in-use');
      throw error;
    }
    return reply.redirect('/tags?notice=deleted');
  });
}
