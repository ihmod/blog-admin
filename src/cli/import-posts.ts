import 'dotenv/config';
import path from 'node:path';
import { createDb } from '../db/client';
import { applyMigrations } from '../db/migrate';
import { importPosts } from '../services/importer';

const args = process.argv.slice(2);
const flags = new Set(args.filter((arg) => arg.startsWith('--')));
const dirArg = args.find((arg) => !arg.startsWith('--'));

if (!dirArg) {
  console.error('usage: npm run import -- <posts-dir> [--dry-run] [--update]');
  process.exit(1);
}

const databasePath = process.env.DATABASE_PATH ?? './data/admin.db';
const resolvedDir = path.resolve(dirArg);
const { db, sqlite } = createDb(databasePath);
applyMigrations(sqlite, path.resolve(__dirname, '../../migrations'));

try {
  const report = importPosts(db, sqlite, resolvedDir, {
    dryRun: flags.has('--dry-run'),
    update: flags.has('--update'),
  });
  console.log(
    JSON.stringify(
      {
        database: databasePath,
        dir: resolvedDir,
        dryRun: flags.has('--dry-run'),
        update: flags.has('--update'),
        ...report,
      },
      null,
      2,
    ),
  );
} finally {
  sqlite.close();
}
