# iHMOD Blog Admin

Self-hosted admin for the iHMOD Hexo blog. SQLite is the source of truth;
Markdown is generated and pushed to GitHub (later plans).

## Requirements

- Node.js 22
- npm 9+

## Setup

```bash
npm install
cp .env.example .env
# set SESSION_SECRET (`openssl rand -hex 32`) and ADMIN_PASSWORD in .env
```

## Develop

```bash
npm run dev
```

Open http://127.0.0.1:8080 and log in with the credentials from `.env`.
The first run creates the admin user, applies migrations, and writes `data/admin.db`.

## Test

```bash
npm test
```

## Build and run

```bash
npm run build
npm start
```

## Content management

- `/posts` — list, filter, search; create/edit with the Vditor Markdown editor.
- `/categories` — create, rename, delete (blocked while posts reference it).
- `/tags` — create, rename, delete (blocked while posts reference it).
- Post states: draft, published, trash (soft delete with restore/purge).
- Slugs and `abbrlink` values are generated automatically; existing values are preserved.
- Posts store a stable `source_path` under the post's category; changing category/slug moves it.

## Editor and media

- Posts use Vditor (served locally from `/static/vditor/`) with Markdown split preview.
- Images are uploaded to `POST /api/media`, stored in `UPLOADS_DIR`
  (default `./data/uploads`), and referenced as `/img/uploads/<uuid>.<ext>`.
- The admin serves `/img/uploads/` only to authenticated sessions; the blog
  publisher will copy these files into `source/img/uploads/` on publish.
- Existing posts autosave title/content 2 seconds after typing and every 30
  seconds; unchanged content is a no-op on the server.
- `/media` lists uploaded images, shows their URLs, and blocks deletion while a
  post still references the file.

## Import existing Hexo posts

The importer reads Markdown files recursively and matches existing posts by
`source_path`. It never deletes posts. Hidden directories such as `.obsidian/`
are skipped.

Dry run (writes are rolled back):

```bash
DATABASE_PATH=./data/admin.db npm run import -- /path/to/source/_posts --dry-run
```

Real import:

```bash
DATABASE_PATH=./data/admin.db npm run import -- /path/to/source/_posts
```

Re-import and overwrite managed fields (title, body, date, category, tags,
description, top_img) while preserving IDs, `abbrlink`, slug, `source_path`,
status, and `published_at`:

```bash
DATABASE_PATH=./data/admin.db npm run import -- /path/to/source/_posts --update
```

Date handling: `frontmatter.date` wins; `YYMMDD.md` diary filenames are parsed;
otherwise the file mtime is used and reported as an issue. Review the reported
issues in the admin before publishing.

## Publish and deploy

- `/publish` shows the publish state and pushes the current database to
  `ihmod/ihmod.github.io` `main`.
- The exporter writes `source/_posts/**` and referenced `source/img/uploads/**`,
  maintains `data/publish-manifest.json`, and never touches the theme/config.
- The publisher refuses to run with uncommitted changes outside the managed
  paths, commits only managed paths, rebases, and never force-pushes.
- GitHub Actions builds and deploys Pages from `main`.
- Deployment is native systemd (no Docker): see `deploy/DEPLOY.md`.
- Emergency CLI publish: `npm run publish`.

## Layout

- `src/` TypeScript source
- `migrations/` plain SQL migrations
- `views/` EJS templates
- `public/` static assets
- `data/` runtime SQLite + uploads (gitignored)
