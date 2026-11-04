// override: true so this app's own .env always wins over any ambient
// environment variables (e.g. unrelated AWS credentials already present
// on the host) rather than being silently shadowed by them.
require('dotenv').config({ override: true });
const express = require('express');
const cors = require('cors');
const multer = require('multer');
const path = require('path');
const bcrypt = require('bcryptjs');
const { v4: uuid } = require('uuid');
const mm = require('music-metadata');

const db = require('./db');
const { signToken, requireAuth } = require('./auth');
const storage = require('./storage');

const app = express();
app.use(cors());
app.use(express.json());

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 100 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    if (/^audio\//.test(file.mimetype) || /\.(mp3|flac|wav|ogg|m4a|aac)$/i.test(file.originalname)) {
      cb(null, true);
    } else {
      cb(new Error('Only audio files are allowed'));
    }
  },
});

// ---------- Auth ----------

app.post('/api/auth/register', async (req, res) => {
  const { email, password, displayName } = req.body || {};
  if (!email || !password || !displayName) {
    return res.status(400).json({ error: 'email, password, and displayName are required' });
  }
  const existing = db.prepare('SELECT id FROM users WHERE email = ?').get(email);
  if (existing) return res.status(409).json({ error: 'Email already registered' });

  const id = uuid();
  const passwordHash = await bcrypt.hash(password, 10);
  db.prepare('INSERT INTO users (id, email, password_hash, display_name) VALUES (?, ?, ?, ?)')
    .run(id, email, passwordHash, displayName);

  const user = { id, email, display_name: displayName };
  res.json({ token: signToken(user), user: { id, email, displayName } });
});

app.post('/api/auth/login', async (req, res) => {
  const { email, password } = req.body || {};
  const user = db.prepare('SELECT * FROM users WHERE email = ?').get(email);
  if (!user || !(await bcrypt.compare(password, user.password_hash))) {
    return res.status(401).json({ error: 'Invalid email or password' });
  }
  res.json({
    token: signToken(user),
    user: { id: user.id, email: user.email, displayName: user.display_name },
  });
});

app.get('/api/me', requireAuth, (req, res) => {
  const user = db.prepare('SELECT id, email, display_name FROM users WHERE id = ?').get(req.user.id);
  if (!user) return res.status(404).json({ error: 'User not found' });
  res.json({ id: user.id, email: user.email, displayName: user.display_name });
});

// ---------- Tracks ----------

function trackToJson(t) {
  return {
    id: t.id,
    title: t.title,
    artist: t.artist,
    album: t.album,
    duration: t.duration,
    coverUrl: t.cover_data ? `/api/tracks/${t.id}/cover` : null,
    streamUrl: `/api/tracks/${t.id}/stream`,
    storage: t.storage,
    source: t.source,
    createdAt: t.created_at,
  };
}

function extractMetadataFromBuffer(buffer, mimetype, fallbackTitle) {
  return mm
    .parseBuffer(buffer, mimetype)
    .then((meta) => {
      const pic = meta.common.picture && meta.common.picture[0];
      return {
        title: meta.common.title || fallbackTitle,
        artist: meta.common.artist || 'Unknown Artist',
        album: meta.common.album || null,
        duration: meta.format.duration || null,
        coverData: pic ? `data:${pic.format};base64,${Buffer.from(pic.data).toString('base64')}` : null,
      };
    })
    .catch(() => ({
      title: fallbackTitle,
      artist: 'Unknown Artist',
      album: null,
      duration: null,
      coverData: null,
    }));
}

app.post('/api/tracks/upload', requireAuth, upload.single('file'), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No file uploaded' });
  try {
    const fallbackTitle = path.parse(req.file.originalname).name;
    const meta = await extractMetadataFromBuffer(req.file.buffer, req.file.mimetype, fallbackTitle);

    const ext = path.extname(req.file.originalname) || '.mp3';
    const key = `uploads/${uuid()}${ext}`;
    const stored = await storage.storeBuffer(req.file.buffer, key, req.file.mimetype);

    const id = uuid();
    db.prepare(
      `INSERT INTO tracks (id, user_id, title, artist, album, duration, filename, storage, source, cover_data)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'uploaded', ?)`
    ).run(id, req.user.id, meta.title, meta.artist, meta.album, meta.duration, stored.key, stored.storage, meta.coverData);

    const track = db.prepare('SELECT * FROM tracks WHERE id = ?').get(id);
    res.json(trackToJson(track));
  } catch (err) {
    res.status(500).json({ error: err.message || 'Upload failed' });
  }
});

// ---------- Storage (S3) ----------

app.get('/api/storage/status', requireAuth, (req, res) => {
  res.json(storage.status());
});

app.get('/api/storage/browse', requireAuth, async (req, res) => {
  if (!storage.s3Enabled) return res.status(400).json({ error: 'S3 is not configured' });
  try {
    const result = await storage.browseBucket(req.query.prefix || '');
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message || 'Failed to browse bucket' });
  }
});

app.post('/api/tracks/link', requireAuth, async (req, res) => {
  if (!storage.s3Enabled) return res.status(400).json({ error: 'S3 is not configured' });
  const { key } = req.body || {};
  if (!key) return res.status(400).json({ error: 'key is required' });

  try {
    await storage.headS3Object(key);
  } catch {
    return res.status(404).json({ error: 'Object not found in bucket' });
  }

  const fallbackTitle = path.parse(key).name;
  let meta = { title: fallbackTitle, artist: 'Unknown Artist', album: null, duration: null, coverData: null };
  try {
    const buffer = await storage.fetchObjectBuffer('s3', key);
    if (buffer) {
      meta = await extractMetadataFromBuffer(buffer, undefined, fallbackTitle);
    }
  } catch {
    // Best-effort metadata; fall back to filename-derived title.
  }

  const id = uuid();
  db.prepare(
    `INSERT INTO tracks (id, user_id, title, artist, album, duration, filename, storage, source, cover_data)
     VALUES (?, ?, ?, ?, ?, ?, ?, 's3', 'linked', ?)`
  ).run(id, req.user.id, meta.title, meta.artist, meta.album, meta.duration, key, meta.coverData);

  const track = db.prepare('SELECT * FROM tracks WHERE id = ?').get(id);
  res.json(trackToJson(track));
});

app.get('/api/tracks', requireAuth, (req, res) => {
  const tracks = db
    .prepare('SELECT * FROM tracks WHERE user_id = ? ORDER BY created_at DESC')
    .all(req.user.id);
  res.json(tracks.map(trackToJson));
});

app.get('/api/tracks/search', requireAuth, (req, res) => {
  const q = `%${(req.query.q || '').toLowerCase()}%`;
  const tracks = db
    .prepare(
      `SELECT * FROM tracks WHERE user_id = ?
       AND (lower(title) LIKE ? OR lower(artist) LIKE ? OR lower(album) LIKE ?)
       ORDER BY created_at DESC`
    )
    .all(req.user.id, q, q, q);
  res.json(tracks.map(trackToJson));
});

app.delete('/api/tracks/:id', requireAuth, async (req, res) => {
  const track = db.prepare('SELECT * FROM tracks WHERE id = ? AND user_id = ?').get(req.params.id, req.user.id);
  if (!track) return res.status(404).json({ error: 'Track not found' });
  db.prepare('DELETE FROM playlist_tracks WHERE track_id = ?').run(track.id);
  db.prepare('DELETE FROM tracks WHERE id = ?').run(track.id);
  // Only delete the underlying object for files we uploaded ourselves — linked
  // objects point at content the user already owns in their bucket.
  if (track.source === 'uploaded') {
    await storage.deleteStored(track.storage, track.filename);
  }
  res.json({ ok: true });
});

app.get('/api/tracks/:id/cover', (req, res) => {
  const track = db.prepare('SELECT cover_data FROM tracks WHERE id = ?').get(req.params.id);
  if (!track || !track.cover_data) return res.status(404).end();
  const match = track.cover_data.match(/^data:(.+);base64,(.*)$/);
  if (!match) return res.status(404).end();
  res.set('Content-Type', match[1]);
  res.send(Buffer.from(match[2], 'base64'));
});

app.get('/api/tracks/:id/stream', async (req, res) => {
  const track = db.prepare('SELECT * FROM tracks WHERE id = ?').get(req.params.id);
  if (!track) return res.status(404).end();
  await storage.streamFile(track.storage, track.filename, req.headers.range, res);
});

// ---------- Playlists ----------

app.get('/api/playlists', requireAuth, (req, res) => {
  const playlists = db.prepare('SELECT * FROM playlists WHERE user_id = ? ORDER BY created_at DESC').all(req.user.id);
  const withCounts = playlists.map((p) => {
    const count = db.prepare('SELECT COUNT(*) AS c FROM playlist_tracks WHERE playlist_id = ?').get(p.id).c;
    return { id: p.id, name: p.name, trackCount: count, createdAt: p.created_at };
  });
  res.json(withCounts);
});

app.post('/api/playlists', requireAuth, (req, res) => {
  const { name } = req.body || {};
  if (!name) return res.status(400).json({ error: 'name is required' });
  const id = uuid();
  db.prepare('INSERT INTO playlists (id, user_id, name) VALUES (?, ?, ?)').run(id, req.user.id, name);
  res.json({ id, name, trackCount: 0 });
});

app.get('/api/playlists/:id', requireAuth, (req, res) => {
  const playlist = db.prepare('SELECT * FROM playlists WHERE id = ? AND user_id = ?').get(req.params.id, req.user.id);
  if (!playlist) return res.status(404).json({ error: 'Playlist not found' });
  const tracks = db
    .prepare(
      `SELECT t.* FROM playlist_tracks pt
       JOIN tracks t ON t.id = pt.track_id
       WHERE pt.playlist_id = ?
       ORDER BY pt.position ASC`
    )
    .all(playlist.id);
  res.json({ id: playlist.id, name: playlist.name, tracks: tracks.map(trackToJson) });
});

app.patch('/api/playlists/:id', requireAuth, (req, res) => {
  const { name } = req.body || {};
  const playlist = db.prepare('SELECT * FROM playlists WHERE id = ? AND user_id = ?').get(req.params.id, req.user.id);
  if (!playlist) return res.status(404).json({ error: 'Playlist not found' });
  db.prepare('UPDATE playlists SET name = ? WHERE id = ?').run(name || playlist.name, playlist.id);
  res.json({ ok: true });
});

app.delete('/api/playlists/:id', requireAuth, (req, res) => {
  const playlist = db.prepare('SELECT * FROM playlists WHERE id = ? AND user_id = ?').get(req.params.id, req.user.id);
  if (!playlist) return res.status(404).json({ error: 'Playlist not found' });
  db.prepare('DELETE FROM playlist_tracks WHERE playlist_id = ?').run(playlist.id);
  db.prepare('DELETE FROM playlists WHERE id = ?').run(playlist.id);
  res.json({ ok: true });
});

app.post('/api/playlists/:id/tracks', requireAuth, (req, res) => {
  const { trackId } = req.body || {};
  const playlist = db.prepare('SELECT * FROM playlists WHERE id = ? AND user_id = ?').get(req.params.id, req.user.id);
  if (!playlist) return res.status(404).json({ error: 'Playlist not found' });
  const track = db.prepare('SELECT * FROM tracks WHERE id = ? AND user_id = ?').get(trackId, req.user.id);
  if (!track) return res.status(404).json({ error: 'Track not found' });

  const maxPos = db.prepare('SELECT MAX(position) AS m FROM playlist_tracks WHERE playlist_id = ?').get(playlist.id).m;
  db.prepare('INSERT OR IGNORE INTO playlist_tracks (playlist_id, track_id, position) VALUES (?, ?, ?)')
    .run(playlist.id, track.id, (maxPos ?? -1) + 1);
  res.json({ ok: true });
});

app.delete('/api/playlists/:id/tracks/:trackId', requireAuth, (req, res) => {
  const playlist = db.prepare('SELECT * FROM playlists WHERE id = ? AND user_id = ?').get(req.params.id, req.user.id);
  if (!playlist) return res.status(404).json({ error: 'Playlist not found' });
  db.prepare('DELETE FROM playlist_tracks WHERE playlist_id = ? AND track_id = ?').run(playlist.id, req.params.trackId);
  res.json({ ok: true });
});

// ---------- Serve the built frontend (single-container deployments) ----------
// In local dev the client runs on its own Vite dev server, so this directory
// won't exist and these routes simply never match.
const fs = require('fs');
const CLIENT_DIST = path.join(__dirname, 'public');
if (fs.existsSync(CLIENT_DIST)) {
  app.use(express.static(CLIENT_DIST));
  app.use((req, res, next) => {
    if (req.method !== 'GET' || req.path.startsWith('/api/')) return next();
    res.sendFile(path.join(CLIENT_DIST, 'index.html'));
  });
}

const PORT = process.env.PORT || 4000;
app.listen(PORT, () => console.log(`Server listening on port ${PORT}`));
