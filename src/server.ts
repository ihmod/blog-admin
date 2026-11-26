import 'dotenv/config';
import path from 'node:path';
import { loadConfig } from './config';
import { createDb } from './db/client';
import { applyMigrations } from './db/migrate';
import { seedAdmin } from './auth/seed';
import { recoverPublishState } from './services/publisher';
import { buildApp } from './app';

async function main(): Promise<void> {
  const config = loadConfig();
  const { db, sqlite } = createDb(config.DATABASE_PATH);
  applyMigrations(sqlite, path.resolve(__dirname, '../migrations'));
  const seed = await seedAdmin(db, config);
  if (seed.created) console.log(`created admin user: ${config.ADMIN_USERNAME}`);
  recoverPublishState(db);

  const app = await buildApp({ db, sqlite, config });
  await app.listen({ host: config.HOST, port: config.PORT });
  console.log(`admin listening on http://${config.HOST}:${config.PORT}`);

  const shutdown = async (): Promise<void> => {
    await app.close();
    sqlite.close();
    process.exit(0);
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
