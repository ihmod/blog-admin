import { describe, it, expect, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createDb } from '../src/db/client';
import { applyMigrations } from '../src/db/migrate';
import { users } from '../src/db/schema';
import { hashPassword, verifyPassword } from '../src/auth/password';
import {
  createSession,
  deleteExpiredSessions,
  deleteSession,
  getSessionUser,
} from '../src/auth/session';

const cleanups: Array<() => void> = [];
afterEach(() => {
  while (cleanups.length) cleanups.pop()!();
});

function setup() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ihmod-auth-'));
  const { db, sqlite } = createDb(path.join(dir, 'test.db'));
  cleanups.push(() => {
    sqlite.close();
    fs.rmSync(dir, { recursive: true, force: true });
  });
  applyMigrations(sqlite, path.resolve(process.cwd(), 'migrations'));
  const now = new Date().toISOString();
  db.insert(users)
    .values({ username: 'admin', passwordHash: 'hash', createdAt: now, updatedAt: now })
    .run();
  const user = db.select().from(users).get()!;
  return { db, user };
}

describe('password hashing', () => {
  it('hashes and verifies a password', async () => {
    const hash = await hashPassword('correct horse battery staple');
    expect(hash).not.toBe('correct horse battery staple');
    expect(await verifyPassword(hash, 'correct horse battery staple')).toBe(true);
    expect(await verifyPassword(hash, 'wrong')).toBe(false);
  });
});

describe('sessions', () => {
  it('creates and loads a session', () => {
    const { db, user } = setup();
    const id = createSession(db, user.id, 1, { ip: '127.0.0.1', userAgent: 'test' });
    expect(id).toMatch(/^[0-9a-f]{64}$/);
    const loaded = getSessionUser(db, id);
    expect(loaded).toEqual({ id: user.id, username: 'admin' });
  });

  it('rejects an unknown session', () => {
    const { db } = setup();
    expect(getSessionUser(db, '0'.repeat(64))).toBeNull();
  });

  it('deletes a session', () => {
    const { db, user } = setup();
    const id = createSession(db, user.id, 1, { ip: null, userAgent: null });
    deleteSession(db, id);
    expect(getSessionUser(db, id)).toBeNull();
  });

  it('expires sessions and cleans them up', () => {
    const { db, user } = setup();
    const id = createSession(db, user.id, -1, { ip: null, userAgent: null });
    expect(getSessionUser(db, id)).toBeNull();
    deleteExpiredSessions(db);
  });
});
