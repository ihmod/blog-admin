import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import type { Db } from '../db/client';
import { listCategories } from '../lib/categories';
import {
  PostNotFoundError,
  PostValidationError,
  createPost,
  getPost,
  listPosts,
  publishPost,
  purgePost,
  restorePost,
  softDeletePost,
  unpublishPost,
  updatePost,
  type PostInput,
  type PostListFilters,
} from '../lib/posts';
import { nowStamp } from '../lib/dates';

export interface PostRouteOptions { db: Db; }

type Query = Record<string, string | undefined>;

function parseId(value: string): string | null {
  return value && value.length > 0 ? value : null;
}

function parseForm(request: FastifyRequest): PostInput {
  const body = (request.body ?? {}) as Record<string, string | undefined>;
  const categoryRaw = body.category_id;
  const parsedCategoryId = categoryRaw ? Number(categoryRaw) : Number.NaN;
  return {
    title: (body.title ?? '').trim(),
    slug: (body.slug ?? '').trim() || null,
    categoryId: Number.isInteger(parsedCategoryId) && parsedCategoryId > 0 ? parsedCategoryId : null,
    description: (body.description ?? '').trim() || null,
    topImg: (body.top_img ?? '').trim() || 'false',
    contentMd: body.content_md ?? '',
    status: body.status === 'published' ? 'published' : 'draft',
    postDate: (body.post_date ?? '').trim() || null,
    tags: (body.tags ?? '').split(/[,，]/).map((tag) => tag.trim()).filter(Boolean),
  };
}

function parseFilters(query: Query): PostListFilters {
  const status = query.status;
  return {
    status:
      status === 'draft' || status === 'published' || status === 'trash' ? status : 'all',
    categoryId: query.category ? Number(query.category) || null : null,
    q: query.q?.trim() || undefined,
    page: Math.max(1, Number(query.page) || 1),
    pageSize: 20,
  };
}

function noticeFrom(query: Query): { notice?: string; error?: string } {
  return { notice: query.notice, error: query.error };
}

async function renderList(
  db: Db,
  request: FastifyRequest,
  reply: FastifyReply,
  extra: { error?: string; notice?: string } = {},
) {
  const query = request.query as Query;
  const filters = parseFilters(query);
  const result = listPosts(db, filters);
  const categories = listCategories(db);
  return reply.view('posts/index.ejs', {
    title: '文章',
    user: request.user,
    csrfToken: request.csrfToken,
    ...result,
    filters,
    categories,
    ...noticeFrom(query),
    ...extra,
  });
}

async function renderForm(
  db: Db,
  request: FastifyRequest,
  reply: FastifyReply,
  data: {
    post: PostInput & { id?: string; abbrlink?: string; tagsText?: string };
    isNew: boolean;
    error?: string;
  },
) {
  return reply.view('posts/form.ejs', {
    title: data.isNew ? '新建文章' : '编辑文章',
    user: request.user,
    csrfToken: request.csrfToken,
    categories: listCategories(db),
    ...data,
  });
}

export async function registerPostRoutes(
  app: FastifyInstance,
  { db }: PostRouteOptions,
): Promise<void> {
  app.get('/posts', async (request, reply) => renderList(db, request, reply));

  app.get('/posts/new', async (request, reply) =>
    renderForm(db, request, reply, {
      isNew: true,
      post: {
        title: '',
        slug: null,
        categoryId: null,
        description: null,
        topImg: 'false',
        contentMd: '',
        status: 'draft',
        postDate: nowStamp(),
        tags: [],
        tagsText: '',
      },
    }),
  );

  app.post('/posts', async (request, reply) => {
    const input = parseForm(request);
    try {
      createPost(db, input);
    } catch (error) {
      if (error instanceof PostValidationError) {
        reply.code(400);
        return renderForm(db, request, reply, {
          isNew: true,
          post: { ...input, tagsText: input.tags.join(', ') },
          error: error.message,
        });
      }
      throw error;
    }
    return reply.redirect('/posts?notice=created');
  });

  app.get('/posts/:id', async (request, reply) => {
    const { id } = request.params as { id: string };
    const post = getPost(db, parseId(id) ?? '');
    if (!post) return reply.callNotFound();
    return renderForm(db, request, reply, {
      isNew: false,
      post: {
        id: post.id,
        title: post.title,
        slug: post.slug,
        categoryId: post.categoryId,
        description: post.description,
        topImg: post.topImg,
        contentMd: post.contentMd,
        status: post.status,
        postDate: post.postDate,
        tags: post.tags,
        tagsText: post.tags.join(', '),
        abbrlink: post.abbrlink,
      },
    });
  });

  app.post('/posts/:id', async (request, reply) => {
    const { id } = request.params as { id: string };
    try {
      updatePost(db, parseId(id) ?? '', parseForm(request));
    } catch (error) {
      if (error instanceof PostNotFoundError) return reply.callNotFound();
      if (error instanceof PostValidationError) {
        const post = getPost(db, parseId(id) ?? '');
        if (!post) return reply.callNotFound();
        reply.code(400);
        return renderForm(db, request, reply, {
          isNew: false,
          post: { ...parseForm(request), id: post.id, abbrlink: post.abbrlink, tagsText: parseForm(request).tags.join(', ') },
          error: error.message,
        });
      }
      throw error;
    }
    return reply.redirect('/posts?notice=saved');
  });

  app.post('/posts/:id/delete', async (request, reply) => {
    try {
      softDeletePost(db, (request.params as { id: string }).id);
    } catch (error) {
      if (error instanceof PostNotFoundError) return reply.callNotFound();
      throw error;
    }
    return reply.redirect('/posts?notice=deleted');
  });

  app.post('/posts/:id/restore', async (request, reply) => {
    try {
      restorePost(db, (request.params as { id: string }).id);
    } catch (error) {
      if (error instanceof PostNotFoundError) return reply.callNotFound();
      throw error;
    }
    return reply.redirect('/posts?status=trash&notice=restored');
  });

  app.post('/posts/:id/purge', async (request, reply) => {
    try {
      purgePost(db, (request.params as { id: string }).id);
    } catch (error) {
      if (error instanceof PostNotFoundError) return reply.callNotFound();
      throw error;
    }
    return reply.redirect('/posts?status=trash&notice=purged');
  });

  app.post('/posts/:id/publish', async (request, reply) => {
    try {
      publishPost(db, (request.params as { id: string }).id);
    } catch (error) {
      if (error instanceof PostNotFoundError) return reply.callNotFound();
      throw error;
    }
    return reply.redirect('/posts?notice=published');
  });

  app.post('/posts/:id/unpublish', async (request, reply) => {
    try {
      unpublishPost(db, (request.params as { id: string }).id);
    } catch (error) {
      if (error instanceof PostNotFoundError) return reply.callNotFound();
      throw error;
    }
    return reply.redirect('/posts?notice=unpublished');
  });
}
