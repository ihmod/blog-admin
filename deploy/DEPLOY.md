# Deploy iHMOD Blog Admin (native, no Docker)

Target: Debian/Ubuntu VPS with Node.js 22, git, sqlite3, and systemd.

## 1. System user and directories

```bash
sudo useradd --system --create-home --shell /usr/sbin/nologin ihmod
sudo mkdir -p /opt/ihmod-admin /var/backups/ihmod-admin
sudo chown -R ihmod:ihmod /opt/ihmod-admin /var/backups/ihmod-admin
```

## 2. Code and build

```bash
sudo -u ihmod -H bash
cd /opt/ihmod-admin
# copy or git clone the private ihmod/blog-admin repo here
npm ci
npm run build
```

## 3. Secrets

```bash
mkdir -p /opt/ihmod-admin/secrets
chmod 700 /opt/ihmod-admin/secrets
# copy the deploy key generated in Plan 1 to the VPS:
#   ~/ihmod-secrets/ihmod_blog_admin -> /opt/ihmod-admin/secrets/deploy_key
chmod 600 /opt/ihmod-admin/secrets/deploy_key
```

Create `/etc/ihmod-admin.env` (mode 600, owned by root):

```dotenv
NODE_ENV=production
HOST=0.0.0.0
PORT=8080
DATABASE_PATH=/opt/ihmod-admin/data/admin.db
UPLOADS_DIR=/opt/ihmod-admin/data/uploads
SESSION_SECRET=<openssl rand -hex 32>
ADMIN_USERNAME=admin
ADMIN_PASSWORD=<first-run strong password>
SESSION_TTL_HOURS=168
LOGIN_RATE_LIMIT_MAX=5
COOKIE_SECURE=false
REPO_DIR=/opt/ihmod-admin/data/repo
REPO_URL=git@github.com:ihmod/ihmod.github.io.git
REPO_BRANCH=main
GIT_SSH_KEY_PATH=/opt/ihmod-admin/secrets/deploy_key
PUBLISH_MANIFEST_PATH=/opt/ihmod-admin/data/publish-manifest.json
GIT_AUTHOR_NAME=iHMOD Admin
GIT_AUTHOR_EMAIL=admin@ihmod.local
TZ=Asia/Shanghai
```

## 4. Import existing posts

Clone the blog repo (the publisher also clones if missing) and import:

```bash
GIT_SSH_COMMAND="ssh -i /opt/ihmod-admin/secrets/deploy_key -o IdentitiesOnly=yes" \
  git clone -b main git@github.com:ihmod/ihmod.github.io.git /opt/ihmod-admin/data/repo
DATABASE_PATH=/opt/ihmod-admin/data/admin.db \
  npm run import -- /opt/ihmod-admin/data/repo/source/_posts
```

## 5. systemd

```bash
sudo cp deploy/ihmod-admin.service /etc/systemd/system/ihmod-admin.service
sudo systemctl daemon-reload
sudo systemctl enable --now ihmod-admin
sudo systemctl status ihmod-admin
curl -s http://127.0.0.1:8080/healthz
```

## 6. Firewall

Follow `deploy/ufw-setup.md`.

## 7. Backups

```bash
sudo crontab -e
# add: 0 3 * * * /opt/ihmod-admin/deploy/backup.sh
```

## 8. First publish

Log in at `http://<VPS_IP>:8080`, open 发布, click 发布到 GitHub.
Then check https://github.com/ihmod/ihmod.github.io/actions and the live site.

## Rollback

If a publish breaks the site, switch GitHub Pages back to
"Deploy from a branch: master /docs" (see the blog repo `docs/deploy.md`).
The admin's SQLite data is unaffected.
