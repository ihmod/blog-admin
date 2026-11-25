import type { FastifyInstance } from 'fastify';
import type { Db } from '../db/client';
import {
  MediaInUseError,
  MediaNotFoundError,
  MediaValidationError,
  deleteMedia,
  listMedia,
  saveUpload,
} from '../services/media';

export interface MediaRouteOptions {
  db: Db;
  uploadsDir: string;
}

export async function registerMediaRoutes(
  app: FastifyInstance,
  { db, uploadsDir }: MediaRouteOptions,
): Promise<void> {
  app.post('/api/media', async (request, reply) => {
    let file;
    try {
      file = await request.file();
    } catch {
      return reply.code(400).send({ error: 'invalid-upload' });
    }
    if (!file) return reply.code(400).send({ error: 'no-file' });

    try {
      const buffer = await file.toBuffer();
      const saved = saveUpload(db, uploadsDir, { filename: file.filename, buffer });
      return reply.send({
        name: saved.storedName,
        originalName: file.filename,
        url: saved.url,
      });
    } catch (error) {
      if (error instanceof MediaValidationError) {
        return reply.code(400).send({ error: error.message });
      }
      throw error;
    }
  });

  app.get('/media', async (request, reply) => {
    const query = request.query as Record<string, string | undefined>;
    return reply.view('media.ejs', {
      title: '媒体',
      user: request.user,
      csrfToken: request.csrfToken,
      items: listMedia(db),
      notice: query.notice,
      error: query.error,
    });
  });

  app.post('/media/:id/delete', async (request, reply) => {
    const { id } = request.params as { id: string };
    try {
      deleteMedia(db, uploadsDir, id);
    } catch (error) {
      if (error instanceof MediaInUseError) {
        return reply.redirect('/media?error=media-in-use');
      }
      if (error instanceof MediaNotFoundError) {
        return reply.redirect('/media?error=invalid');
      }
      throw error;
    }
    return reply.redirect('/media?notice=deleted');
  });
}
