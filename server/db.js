const Database = require('better-sqlite3');
const path = require('path');

const db = new Database(path.join(__dirname, 'db', 'app.db'));
db.pragma('journal_mode = WAL');

db.exec(`
CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  email TEXT UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  display_name TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS tracks (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id),
  title TEXT NOT NULL,
  artist TEXT NOT NULL,
  album TEXT,
  duration REAL,
  filename TEXT NOT NULL,
  storage TEXT NOT NULL DEFAULT 'local',
  source TEXT NOT NULL DEFAULT 'uploaded',
  cover_data TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS playlists (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id),
  name TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS playlist_tracks (
  playlist_id TEXT NOT NULL REFERENCES playlists(id),
  track_id TEXT NOT NULL REFERENCES tracks(id),
  position INTEGER NOT NULL,
  PRIMARY KEY (playlist_id, track_id)
);
`);

// Lightweight migration for columns added after the initial release.
const existingColumns = db.prepare("PRAGMA table_info(tracks)").all().map((c) => c.name);
if (!existingColumns.includes('storage')) {
  db.exec("ALTER TABLE tracks ADD COLUMN storage TEXT NOT NULL DEFAULT 'local'");
}
if (!existingColumns.includes('source')) {
  db.exec("ALTER TABLE tracks ADD COLUMN source TEXT NOT NULL DEFAULT 'uploaded'");
}

module.exports = db;
