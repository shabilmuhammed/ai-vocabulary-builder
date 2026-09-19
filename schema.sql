-- WordNest score store (Cloudflare D1 / SQLite)
CREATE TABLE IF NOT EXISTS scores (
  date       TEXT    NOT NULL,   -- YYYY-MM-DD (the lesson day)
  player     TEXT    NOT NULL,   -- 'shabil' | 'nefny'
  score      INTEGER NOT NULL,
  total      INTEGER NOT NULL,
  updated_at TEXT    NOT NULL,
  PRIMARY KEY (date, player)
);
