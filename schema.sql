-- WordNest score store (Cloudflare D1 / SQLite)
CREATE TABLE IF NOT EXISTS scores (
  date       TEXT    NOT NULL,   -- YYYY-MM-DD (the lesson day)
  player     TEXT    NOT NULL,   -- 'shabil' | 'nefny'
  score      INTEGER NOT NULL,
  total      INTEGER NOT NULL,
  updated_at TEXT    NOT NULL,
  PRIMARY KEY (date, player)
);

-- Each player's flashcard deck (one deck per player, cards tagged by lesson day)
CREATE TABLE IF NOT EXISTS flashcards (
  player     TEXT NOT NULL,   -- 'shabil' | 'nefny'
  date       TEXT NOT NULL,   -- lesson day the word came from
  word       TEXT NOT NULL,
  pron       TEXT,
  meaning    TEXT NOT NULL,
  example    TEXT,
  created_at TEXT NOT NULL,
  PRIMARY KEY (player, date, word)
);
