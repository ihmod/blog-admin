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

## Layout

- `src/` TypeScript source
- `migrations/` plain SQL migrations
- `views/` EJS templates
- `public/` static assets
- `data/` runtime SQLite + uploads (gitignored)
