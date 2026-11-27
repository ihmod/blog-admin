import type { FastifyInstance } from 'fastify';
import type { Db } from '../db/client';
import {
  CategoryInUseError,
  DuplicateCategoryError,
  createCategory,
  deleteCategory,
  listCategories,
  renameCategory,
} from '../lib/categories';

export interface CategoryRouteOptions { db: Db; }

function parseId(value: string): number | null {
  const id = Number(value);
  return Number.isInteger(id) && id > 0 ? id : null;
}

export async function registerCategoryRoutes(
  app: FastifyInstance,
  { db }: CategoryRouteOptions,
): Promise<void> {
  app.get('/categories', async (request, reply) => {
    const query = request.query as Record<string, string | undefined>;
    return reply.view('categories.ejs', {
      title: '分类',
      user: request.user,
      csrfToken: request.csrfToken,
      categories: listCategories(db),
      notice: query.notice,
      error: query.error,
    });
  });

  app.post('/categories', async (request, reply) => {
    const body = request.body as { name?: string } | undefined;
    try {
      createCategory(db, body?.name ?? '');
    } catch (error) {
      if (error instanceof DuplicateCategoryError) return reply.redirect('/categories?error=duplicate');
      if (error instanceof Error) return reply.redirect('/categories?error=invalid');
      throw error;
    }
    return reply.redirect('/categories?notice=created');
  });

  app.post('/api/categories', async (request, reply) => {
    const body = request.body as { name?: string } | undefined;
    try {
      const category = createCategory(db, body?.name ?? '');
      return reply.send({ id: category.id, name: category.name });
    } catch (error) {
      if (error instanceof DuplicateCategoryError) {
        return reply.code(409).send({ error: 'duplicate', message: '分类已存在' });
      }
      if (error instanceof Error) {
        return reply.code(400).send({ error: 'invalid', message: error.message });
      }
      throw error;
    }
  });

  app.post('/categories/:id', async (request, reply) => {
    const { id } = request.params as { id: string };
    const categoryId = parseId(id);
    if (!categoryId) return reply.redirect('/categories?error=invalid');
    const body = request.body as { name?: string } | undefined;
    try {
      renameCategory(db, categoryId, body?.name ?? '');
    } catch (error) {
      if (error instanceof DuplicateCategoryError) return reply.redirect('/categories?error=duplicate');
      if (error instanceof Error) return reply.redirect('/categories?error=invalid');
      throw error;
    }
    return reply.redirect('/categories?notice=saved');
  });

  app.post('/categories/:id/delete', async (request, reply) => {
    const { id } = request.params as { id: string };
    const categoryId = parseId(id);
    if (!categoryId) return reply.redirect('/categories?error=invalid');
    try {
      deleteCategory(db, categoryId);
    } catch (error) {
      if (error instanceof CategoryInUseError) {
        return reply.redirect('/categories?error=category-in-use');
      }
      throw error;
    }
    return reply.redirect('/categories?notice=deleted');
  });
}
