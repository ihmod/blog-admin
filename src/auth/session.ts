import crypto from 'node:crypto';
import { eq, lte } from 'drizzle-orm';
import type { Db } from '../db/client';
import { sessions, users } from '../db/schema';

export const SESSION_COOKIE = 'ihmod_sid';

export interface SessionUser {
  id: number;
  username: string;
}

export interface SessionMeta {
  ip: string | null;
  userAgent: string | null;
}

export function newSessionId(): string {
  return crypto.randomBytes(32).toString('hex');
}

export function createSession(
  db: Db,
  userId: number,
  ttlHours: number,
  meta: SessionMeta,
): string {
  const id = newSessionId();
  const now = new Date();
  const expiresAt = new Date(now.getTime() + ttlHours * 60 * 60 * 1000);
  db.insert(sessions)
    .values({
      id,
      userId,
      expiresAt: expiresAt.toISOString(),
      createdAt: now.toISOString(),
      ip: meta.ip,
      userAgent: meta.userAgent,
    })
    .run();
  return id;
}

export function getSessionUser(db: Db, sessionId: string): SessionUser | null {
  const row = db
    .select({
      id: users.id,
      username: users.username,
      expiresAt: sessions.expiresAt,
    })
    .from(sessions)
    .innerJoin(users, eq(sessions.userId, users.id))
    .where(eq(sessions.id, sessionId))
    .get();

  if (!row) return null;
  if (row.expiresAt <= new Date().toISOString()) {
    deleteSession(db, sessionId);
    return null;
  }
  return { id: row.id, username: row.username };
}

export function deleteSession(db: Db, sessionId: string): void {
  db.delete(sessions).where(eq(sessions.id, sessionId)).run();
}

export function deleteExpiredSessions(db: Db): void {
  db.delete(sessions).where(lte(sessions.expiresAt, new Date().toISOString())).run();
}
