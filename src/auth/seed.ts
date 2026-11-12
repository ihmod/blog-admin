import type { Config } from '../config';
import type { Db } from '../db/client';
import { users } from '../db/schema';
import { hashPassword } from './password';

export interface SeedResult {
  created: boolean;
}

export async function seedAdmin(db: Db, config: Config): Promise<SeedResult> {
  const existing = db.select().from(users).limit(1).all();
  if (existing.length > 0) return { created: false };

  if (!config.ADMIN_PASSWORD) {
    throw new Error('ADMIN_PASSWORD is required on first run');
  }

  const now = new Date().toISOString();
  const passwordHash = await hashPassword(config.ADMIN_PASSWORD);
  db.insert(users)
    .values({
      username: config.ADMIN_USERNAME,
      passwordHash,
      createdAt: now,
      updatedAt: now,
    })
    .run();

  return { created: true };
}
