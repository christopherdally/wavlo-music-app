const Database = require('better-sqlite3');
const fs = require('fs');
const path = require('path');

const DB_DIR = path.join(__dirname, 'db');
fs.mkdirSync(DB_DIR, { recursive: true });

const db = new Database(path.join(DB_DIR, 'app.db'));
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
  file_size INTEGER,
  bitrate INTEGER,
  sample_rate INTEGER,
  channels INTEGER,
  codec TEXT,
  container TEXT,
  lossless INTEGER,
  play_count INTEGER NOT NULL DEFAULT 0,
  last_played_at TEXT,
  content_hash TEXT,
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
for (const column of ['file_size', 'bitrate', 'sample_rate', 'channels', 'lossless']) {
  if (!existingColumns.includes(column)) {
    db.exec(`ALTER TABLE tracks ADD COLUMN ${column} INTEGER`);
  }
}
for (const column of ['codec', 'container']) {
  if (!existingColumns.includes(column)) {
    db.exec(`ALTER TABLE tracks ADD COLUMN ${column} TEXT`);
  }
}
if (!existingColumns.includes('play_count')) {
  db.exec('ALTER TABLE tracks ADD COLUMN play_count INTEGER NOT NULL DEFAULT 0');
}
if (!existingColumns.includes('last_played_at')) {
  db.exec('ALTER TABLE tracks ADD COLUMN last_played_at TEXT');
}
if (!existingColumns.includes('content_hash')) {
  db.exec('ALTER TABLE tracks ADD COLUMN content_hash TEXT');
}

module.exports = db;
