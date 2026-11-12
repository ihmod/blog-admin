import {
  index,
  integer,
  primaryKey,
  sqliteTable,
  text,
} from 'drizzle-orm/sqlite-core';

export const users = sqliteTable('users', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  username: text('username').notNull().unique(),
  passwordHash: text('password_hash').notNull(),
  createdAt: text('created_at').notNull(),
  updatedAt: text('updated_at').notNull(),
});

export const sessions = sqliteTable(
  'sessions',
  {
    id: text('id').primaryKey(),
    userId: integer('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    expiresAt: text('expires_at').notNull(),
    createdAt: text('created_at').notNull(),
    ip: text('ip'),
    userAgent: text('user_agent'),
  },
  (table) => ({
    expiresIdx: index('idx_sessions_expires').on(table.expiresAt),
  }),
);

export const categories = sqliteTable('categories', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  name: text('name').notNull().unique(),
  createdAt: text('created_at').notNull(),
});

export const tags = sqliteTable('tags', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  name: text('name').notNull().unique(),
  createdAt: text('created_at').notNull(),
});

export const posts = sqliteTable(
  'posts',
  {
    id: text('id').primaryKey(),
    title: text('title').notNull(),
    slug: text('slug').notNull(),
    categoryId: integer('category_id').references(() => categories.id, {
      onDelete: 'set null',
    }),
    description: text('description'),
    topImg: text('top_img').notNull().default('false'),
    contentMd: text('content_md').notNull().default(''),
    status: text('status').$type<'draft' | 'published'>().notNull().default('draft'),
    abbrlink: text('abbrlink').notNull().unique(),
    sourcePath: text('source_path').notNull().unique(),
    postDate: text('post_date').notNull(),
    createdAt: text('created_at').notNull(),
    updatedAt: text('updated_at').notNull(),
    publishedAt: text('published_at'),
    deletedAt: text('deleted_at'),
    contentHash: text('content_hash').notNull().default(''),
  },
  (table) => ({
    statusIdx: index('idx_posts_status').on(table.status),
    categoryIdx: index('idx_posts_category').on(table.categoryId),
    updatedIdx: index('idx_posts_updated').on(table.updatedAt),
  }),
);

export const postTags = sqliteTable(
  'post_tags',
  {
    postId: text('post_id')
      .notNull()
      .references(() => posts.id, { onDelete: 'cascade' }),
    tagId: integer('tag_id')
      .notNull()
      .references(() => tags.id, { onDelete: 'cascade' }),
  },
  (table) => ({
    pk: primaryKey({ columns: [table.postId, table.tagId] }),
  }),
);

export const media = sqliteTable('media', {
  id: text('id').primaryKey(),
  originalName: text('original_name').notNull(),
  storedName: text('stored_name').notNull().unique(),
  mime: text('mime').notNull(),
  size: integer('size').notNull(),
  width: integer('width'),
  height: integer('height'),
  createdAt: text('created_at').notNull(),
});

export const publishState = sqliteTable('publish_state', {
  id: integer('id').primaryKey(),
  status: text('status')
    .$type<'idle' | 'running' | 'success' | 'error'>()
    .notNull()
    .default('idle'),
  message: text('message'),
  commitSha: text('commit_sha'),
  startedAt: text('started_at'),
  finishedAt: text('finished_at'),
});
