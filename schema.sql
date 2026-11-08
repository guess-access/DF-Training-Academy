-- DealerFocus Training Academy — Cloudflare D1 schema
-- Apply once:  npx wrangler d1 execute df-training-academy --remote --file=schema.sql
-- (or paste into the D1 database Console in the Cloudflare dashboard)

CREATE TABLE IF NOT EXISTS users (
  id          TEXT PRIMARY KEY,
  name        TEXT NOT NULL,
  email       TEXT NOT NULL UNIQUE,
  pass_hash   TEXT NOT NULL,
  pass_salt   TEXT NOT NULL,
  role        TEXT NOT NULL DEFAULT 'user' CHECK (role IN ('admin','user')),
  created_at  TEXT NOT NULL,
  logins      INTEGER NOT NULL DEFAULT 0,
  last_active TEXT
);

CREATE TABLE IF NOT EXISTS sessions (
  token_hash TEXT PRIMARY KEY,
  user_id    TEXT NOT NULL,
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id);

CREATE TABLE IF NOT EXISTS progress (
  user_id   TEXT NOT NULL,
  module_id TEXT NOT NULL,
  at        TEXT NOT NULL,
  PRIMARY KEY (user_id, module_id)
);

CREATE TABLE IF NOT EXISTS quizzes (
  user_id         TEXT NOT NULL,
  quiz_id         TEXT NOT NULL,
  score           INTEGER NOT NULL,
  passed          INTEGER NOT NULL,
  at              TEXT NOT NULL,
  edited_by_admin INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (user_id, quiz_id)
);

CREATE TABLE IF NOT EXISTS attempts (
  id      TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  quiz_id TEXT NOT NULL,
  score   INTEGER NOT NULL,
  raw     INTEGER,
  total   INTEGER,
  passed  INTEGER NOT NULL,
  at      TEXT NOT NULL,
  source  TEXT,
  extra   TEXT
);
CREATE INDEX IF NOT EXISTS idx_attempts_user ON attempts(user_id, at);

CREATE TABLE IF NOT EXISTS usage_events (
  id      INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id TEXT NOT NULL,
  kind    TEXT NOT NULL CHECK (kind IN ('login','view','dwell')),
  page    TEXT,
  sec     INTEGER,
  ua      TEXT,
  at      TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_usage_user ON usage_events(user_id, kind, at);

CREATE TABLE IF NOT EXISTS settings (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
INSERT OR IGNORE INTO settings (key, value) VALUES ('passPct', '80');

CREATE TABLE IF NOT EXISTS login_failures (
  email        TEXT PRIMARY KEY,
  count        INTEGER NOT NULL,
  locked_until TEXT
);
