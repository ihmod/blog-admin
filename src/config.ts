import { z } from 'zod';

const booleanFromString = z
  .string()
  .default('false')
  .transform((value) => value === 'true');

const schema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  HOST: z.string().default('127.0.0.1'),
  PORT: z.coerce.number().int().positive().default(8080),
  DATABASE_PATH: z.string().default('./data/admin.db'),
  UPLOADS_DIR: z.string().default('./data/uploads'),
  SESSION_SECRET: z.string().min(32, 'SESSION_SECRET must be at least 32 characters'),
  ADMIN_USERNAME: z.string().min(1).default('admin'),
  ADMIN_PASSWORD: z.string().min(12).optional(),
  SESSION_TTL_HOURS: z.coerce.number().int().positive().default(168),
  LOGIN_RATE_LIMIT_MAX: z.coerce.number().int().positive().default(5),
  COOKIE_SECURE: booleanFromString,
});

export type Config = z.infer<typeof schema>;

export function loadConfig(
  env: NodeJS.ProcessEnv | Record<string, string | undefined> = process.env,
): Config {
  return schema.parse(env);
}
