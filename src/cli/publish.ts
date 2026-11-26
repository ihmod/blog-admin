import 'dotenv/config';
import path from 'node:path';
import { loadConfig } from '../config';
import { createDb } from '../db/client';
import { applyMigrations } from '../db/migrate';
import { publishOptionsFromConfig } from '../routes/publish';
import { publish } from '../services/publisher';

async function main(): Promise<void> {
  const config = loadConfig();
  const { db, sqlite } = createDb(config.DATABASE_PATH);
  applyMigrations(sqlite, path.resolve(__dirname, '../../migrations'));
  try {
    const report = await publish(db, publishOptionsFromConfig(config));
    console.log(JSON.stringify(report, null, 2));
  } finally {
    sqlite.close();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
