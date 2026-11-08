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

-- Module completion: read percentage per lesson page, as JSON ({"welcome":100,"states":60}).
CREATE TABLE IF NOT EXISTS module_completion (
  user_id    TEXT NOT NULL,
  module_id  TEXT NOT NULL,
  pages      TEXT NOT NULL DEFAULT '{}',
  total      INTEGER NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (user_id, module_id)
);

-- About Us gate: server-side record of the team video being played in order at normal speed.
-- coverage = one character per second of video ('1' = that second was played in order).
CREATE TABLE IF NOT EXISTS about_progress (
  user_id      TEXT PRIMARY KEY,
  coverage     TEXT NOT NULL DEFAULT '',
  page_sec     REAL NOT NULL DEFAULT 0,
  last_pos     REAL,
  last_beat    TEXT,
  last_playing INTEGER NOT NULL DEFAULT 0,
  duration     REAL,
  ended        INTEGER NOT NULL DEFAULT 0,
  violations   INTEGER NOT NULL DEFAULT 0,
  completed_at TEXT
);
-- Gate is OFF by default; an admin turns it on (Admin dashboard) once the video file is in assets/.
INSERT OR IGNORE INTO settings (key, value) VALUES ('aboutGate', '0');
INSERT OR IGNORE INTO settings (key, value) VALUES ('aboutMinSec', '300');
