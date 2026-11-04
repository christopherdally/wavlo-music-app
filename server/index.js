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

// Default true so a fresh install still lets its first user sign up without
// extra config; set ALLOW_SIGNUP=false once you've created the account(s)
// you need, to turn this self-hosted instance invite-only.
const signupEnabled = (process.env.ALLOW_SIGNUP ?? 'true').toLowerCase() !== 'false';

app.get('/api/auth/config', (req, res) => {
  res.json({ signupEnabled });
});

app.post('/api/auth/register', async (req, res) => {
  if (!signupEnabled) return res.status(403).json({ error: 'Sign-up is disabled on this instance' });

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

function folderOf(track) {
  // Only linked tracks (S3/SMB) have a meaningful source path — uploaded
  // tracks' filename is just an opaque storage key (uploads/<uuid>.ext), not
  // a folder a human organized. A root-level linked file (no containing
  // folder) also yields no grouping.
  if (track.source !== 'linked') return null;
  const dir = path.dirname(track.filename);
  return dir === '.' || dir === '/' ? null : dir;
}

function trackToJson(t) {
  return {
    id: t.id,
    title: t.title,
    artist: t.artist,
    album: t.album,
    folder: folderOf(t),
    duration: t.duration,
    coverUrl: t.cover_data ? `/api/tracks/${t.id}/cover` : null,
    streamUrl: `/api/tracks/${t.id}/stream`,
    storage: t.storage,
    source: t.source,
    // The storage key/path — e.g. "Albums/2024/track.mp3" for a linked S3/SMB
    // file, or "uploads/<uuid>.mp3" for an upload. Not sensitive: for linked
    // tracks it's exactly the path the user picked while browsing to link it.
    location: t.filename,
    createdAt: t.created_at,
    fileInfo: {
      fileSize: t.file_size,
      bitrate: t.bitrate,
      sampleRate: t.sample_rate,
      channels: t.channels,
      codec: t.codec,
      container: t.container,
      lossless: t.lossless == null ? null : Boolean(t.lossless),
    },
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
        fileSize: buffer.length,
        bitrate: meta.format.bitrate ? Math.round(meta.format.bitrate) : null,
        sampleRate: meta.format.sampleRate || null,
        channels: meta.format.numberOfChannels || null,
        codec: meta.format.codec || null,
        container: meta.format.container || null,
        lossless: meta.format.lossless == null ? null : meta.format.lossless,
      };
    })
    .catch(() => ({
      title: fallbackTitle,
      artist: 'Unknown Artist',
      album: null,
      duration: null,
      coverData: null,
      fileSize: buffer.length,
      bitrate: null,
      sampleRate: null,
      channels: null,
      codec: null,
      container: null,
      lossless: null,
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
      `INSERT INTO tracks (
         id, user_id, title, artist, album, duration, filename, storage, source, cover_data,
         file_size, bitrate, sample_rate, channels, codec, container, lossless
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'uploaded', ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(
      id,
      req.user.id,
      meta.title,
      meta.artist,
      meta.album,
      meta.duration,
      stored.key,
      stored.storage,
      meta.coverData,
      meta.fileSize,
      meta.bitrate,
      meta.sampleRate,
      meta.channels,
      meta.codec,
      meta.container,
      meta.lossless == null ? null : meta.lossless ? 1 : 0
    );

    const track = db.prepare('SELECT * FROM tracks WHERE id = ?').get(id);
    res.json(trackToJson(track));
  } catch (err) {
    res.status(500).json({ error: err.message || 'Upload failed' });
  }
});

// ---------- Storage (S3 / SMB "link existing content") ----------

app.get('/api/storage/status', requireAuth, (req, res) => {
  res.json(storage.status());
});

app.get('/api/storage/browse', requireAuth, async (req, res) => {
  const source = req.query.source === 'smb' ? 'smb' : 's3';
  if (source === 'smb') {
    if (!storage.smbEnabled) return res.status(400).json({ error: 'SMB is not configured' });
    try {
      res.json(await storage.browseSmbDirectory(req.query.path || ''));
    } catch (err) {
      res.status(500).json({ error: err.message || 'Failed to browse SMB share' });
    }
    return;
  }

  if (!storage.s3Enabled) return res.status(400).json({ error: 'S3 is not configured' });
  try {
    res.json(await storage.browseBucket(req.query.prefix || ''));
  } catch (err) {
    res.status(500).json({ error: err.message || 'Failed to browse bucket' });
  }
});

// Links one remote file (S3 or SMB) as a track for the given user. Shared by
// the single-track /api/tracks/link route and the bulk SMB folder sync below.
// Throws on failure (caller decides how to translate that — an HTTP error for
// a single link, or a per-file "failed" tally for a sync pass).
async function linkTrackForUser(userId, source, key) {
  const fileSize = (await storage.headObject(source, key)).size;

  const fallbackTitle = path.parse(key).name;
  let meta = {
    title: fallbackTitle,
    artist: 'Unknown Artist',
    album: null,
    duration: null,
    coverData: null,
    fileSize,
    bitrate: null,
    sampleRate: null,
    channels: null,
    codec: null,
    container: null,
    lossless: null,
  };
  try {
    const buffer = await storage.fetchObjectBuffer(source, key);
    if (buffer) {
      meta = await extractMetadataFromBuffer(buffer, undefined, fallbackTitle);
    }
  } catch {
    // Best-effort metadata; fall back to filename-derived title and the file
    // size we already have from the head/stat check above.
  }

  const id = uuid();
  db.prepare(
    `INSERT INTO tracks (
       id, user_id, title, artist, album, duration, filename, storage, source, cover_data,
       file_size, bitrate, sample_rate, channels, codec, container, lossless
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'linked', ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    id,
    userId,
    meta.title,
    meta.artist,
    meta.album,
    meta.duration,
    key,
    source,
    meta.coverData,
    meta.fileSize,
    meta.bitrate,
    meta.sampleRate,
    meta.channels,
    meta.codec,
    meta.container,
    meta.lossless == null ? null : meta.lossless ? 1 : 0
  );

  return db.prepare('SELECT * FROM tracks WHERE id = ?').get(id);
}

app.post('/api/tracks/link', requireAuth, async (req, res) => {
  const source = req.body?.source === 'smb' ? 'smb' : 's3';
  const key = req.body?.key;
  if (!key) return res.status(400).json({ error: 'key is required' });

  if (source === 'smb' && !storage.smbEnabled) return res.status(400).json({ error: 'SMB is not configured' });
  if (source === 's3' && !storage.s3Enabled) return res.status(400).json({ error: 'S3 is not configured' });

  let track;
  try {
    track = await linkTrackForUser(req.user.id, source, key);
  } catch {
    return res.status(404).json({ error: 'Object not found' });
  }
  res.json(trackToJson(track));
});

// Scans an SMB folder (recursively) and links every audio file not already
// in the given user's library. Used by both the manual "Sync now" button and
// the optional scheduled background sync.
async function syncSmbFolderForUser(userId) {
  const syncPath = process.env.SMB_SYNC_PATH || '';
  const allKeys = await storage.listAllSmbAudioFiles(syncPath);
  const alreadyLinked = new Set(
    db
      .prepare("SELECT filename FROM tracks WHERE user_id = ? AND storage = 'smb'")
      .all(userId)
      .map((r) => r.filename)
  );

  let linked = 0;
  let failed = 0;
  for (const key of allKeys) {
    if (alreadyLinked.has(key)) continue;
    try {
      await linkTrackForUser(userId, 'smb', key);
      linked++;
    } catch {
      failed++;
    }
  }

  return { scanned: allKeys.length, linked, failed, alreadyLinked: allKeys.length - linked - failed };
}

app.post('/api/storage/smb/sync', requireAuth, async (req, res) => {
  if (!storage.smbEnabled) return res.status(400).json({ error: 'SMB is not configured' });
  try {
    res.json(await syncSmbFolderForUser(req.user.id));
  } catch (err) {
    res.status(500).json({ error: err.message || 'Sync failed' });
  }
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

// ---------- Scheduled SMB folder sync (optional) ----------
// Runs the same sync as the manual "Sync now" button, on a timer, for every
// existing account — consistent with linking already being per-user/private
// rather than shared across accounts.
const smbSyncIntervalMinutes = Number(process.env.SMB_SYNC_INTERVAL_MINUTES || 0);
if (storage.smbEnabled && smbSyncIntervalMinutes > 0) {
  setInterval(async () => {
    const users = db.prepare('SELECT id FROM users').all();
    for (const user of users) {
      try {
        await syncSmbFolderForUser(user.id);
      } catch (err) {
        console.error(`Scheduled SMB sync failed for user ${user.id}:`, err.message);
      }
    }
  }, smbSyncIntervalMinutes * 60 * 1000);
  console.log(`Scheduled SMB sync enabled: every ${smbSyncIntervalMinutes} minute(s)`);
}

const PORT = process.env.PORT || 4000;
app.listen(PORT, () => console.log(`Server listening on port ${PORT}`));
