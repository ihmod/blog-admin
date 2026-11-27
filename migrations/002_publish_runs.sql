CREATE TABLE publish_runs (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  status      TEXT NOT NULL DEFAULT 'running',
  message     TEXT,
  commit_sha  TEXT,
  posts       INTEGER NOT NULL DEFAULT 0,
  files       INTEGER NOT NULL DEFAULT 0,
  pushed      INTEGER NOT NULL DEFAULT 0,
  started_at  TEXT NOT NULL,
  finished_at TEXT,
  log         TEXT NOT NULL DEFAULT ''
);

CREATE INDEX idx_publish_runs_started ON publish_runs(started_at DESC);
