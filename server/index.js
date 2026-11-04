// override: true so this app's own .env always wins over any ambient
// environment variables (e.g. unrelated AWS credentials already present
// on the host) rather than being silently shadowed by them.
require('dotenv').config({ override: true });
const express = require('express');
const cors = require('cors');
const multer = require('multer');
const path = require('path');
const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const { v4: uuid } = require('uuid');
const mm = require('music-metadata');

const db = require('./db');
const { signToken, requireAuth } = require('./auth');
const storage = require('./storage');

const app = express();
app.use(cors());
// Default 100kb is too small for a manually-uploaded artist photo sent as a
// base64 data URL in the JSON body.
app.use(express.json({ limit: '5mb' }));

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
    playCount: t.play_count,
    lastPlayedAt: t.last_played_at,
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
        contentHash: crypto.createHash('sha256').update(buffer).digest('hex'),
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
      contentHash: crypto.createHash('sha256').update(buffer).digest('hex'),
    }));
}

// Checks whether this user already has a track that's "the same file" by one
// of three signals, in order of certainty:
//   1. Same storage key/path (e.g. the exact same S3/SMB file linked twice).
//   2. Same content hash (byte-identical file, even under a different name).
//   3. Same title + artist (case/whitespace-insensitive) + duration within
//      2 seconds — catches "uploaded the same song twice from a different
//      source/encode" without being thrown off by trivial re-encodes.
// Returns the conflicting track row, or null.
function normalizeForDupeCheck(s) {
  return (s || '').trim().toLowerCase().replace(/\s+/g, ' ');
}

function findDuplicateTrack(userId, { storage: storageType, filename, contentHash, title, artist, duration }) {
  if (storageType && filename) {
    const byKey = db
      .prepare('SELECT * FROM tracks WHERE user_id = ? AND storage = ? AND filename = ?')
      .get(userId, storageType, filename);
    if (byKey) return byKey;
  }

  if (contentHash) {
    const byHash = db
      .prepare('SELECT * FROM tracks WHERE user_id = ? AND content_hash = ?')
      .get(userId, contentHash);
    if (byHash) return byHash;
  }

  if (title && artist) {
    const normTitle = normalizeForDupeCheck(title);
    const normArtist = normalizeForDupeCheck(artist);
    const candidates = db
      .prepare('SELECT * FROM tracks WHERE user_id = ? AND lower(title) = ? AND lower(artist) = ?')
      .all(userId, normTitle, normArtist);
    for (const candidate of candidates) {
      if (
        normalizeForDupeCheck(candidate.title) === normTitle &&
        normalizeForDupeCheck(candidate.artist) === normArtist &&
        (duration == null || candidate.duration == null || Math.abs(candidate.duration - duration) <= 2)
      ) {
        return candidate;
      }
    }
  }

  return null;
}

function describeDuplicate(track) {
  const err = new Error(`"${track.title}" by ${track.artist} is already in your library`);
  err.isDuplicate = true;
  return err;
}

app.post('/api/tracks/upload', requireAuth, upload.single('file'), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No file uploaded' });
  try {
    const fallbackTitle = path.parse(req.file.originalname).name;
    const meta = await extractMetadataFromBuffer(req.file.buffer, req.file.mimetype, fallbackTitle);

    const duplicate = findDuplicateTrack(req.user.id, {
      contentHash: meta.contentHash,
      title: meta.title,
      artist: meta.artist,
      duration: meta.duration,
    });
    if (duplicate) {
      const err = describeDuplicate(duplicate);
      err.status = 409;
      throw err;
    }

    const ext = path.extname(req.file.originalname) || '.mp3';
    const key = `uploads/${uuid()}${ext}`;
    const stored = await storage.storeBuffer(req.file.buffer, key, req.file.mimetype);

    const id = uuid();
    db.prepare(
      `INSERT INTO tracks (
         id, user_id, title, artist, album, duration, filename, storage, source, cover_data,
         file_size, bitrate, sample_rate, channels, codec, container, lossless, content_hash
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'uploaded', ?, ?, ?, ?, ?, ?, ?, ?, ?)`
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
      meta.lossless == null ? null : meta.lossless ? 1 : 0,
      meta.contentHash
    );

    const track = db.prepare('SELECT * FROM tracks WHERE id = ?').get(id);
    res.json(trackToJson(track));
  } catch (err) {
    res.status(err.status || 500).json({ error: err.message || 'Upload failed' });
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
    contentHash: null,
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

  const duplicate = findDuplicateTrack(userId, {
    storage: source,
    filename: key,
    contentHash: meta.contentHash,
    title: meta.title,
    artist: meta.artist,
    duration: meta.duration,
  });
  if (duplicate) throw describeDuplicate(duplicate);

  const id = uuid();
  db.prepare(
    `INSERT INTO tracks (
       id, user_id, title, artist, album, duration, filename, storage, source, cover_data,
       file_size, bitrate, sample_rate, channels, codec, container, lossless, content_hash
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'linked', ?, ?, ?, ?, ?, ?, ?, ?, ?)`
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
    meta.lossless == null ? null : meta.lossless ? 1 : 0,
    meta.contentHash
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
  } catch (err) {
    return res.status(err.isDuplicate ? 409 : 404).json({ error: err.isDuplicate ? err.message : 'Object not found' });
  }
  res.json(trackToJson(track));
});

// ---------- SMB folder sync (runs as a background job, polled for progress) ----------

// One job per user, in-memory — fine for a single-process server, and a
// user only ever has one meaningful sync in flight at a time anyway.
const smbSyncJobs = new Map();

function newSyncJob() {
  return {
    status: 'scanning', // 'scanning' | 'linking' | 'done' | 'error'
    scanned: 0, // total audio files found on the share (incl. already-linked)
    total: null, // new (not-yet-linked) files to process, known once scanning finishes
    processed: 0,
    linked: 0,
    duplicates: 0,
    failed: 0,
    error: null,
    startedAt: new Date().toISOString(),
    finishedAt: null,
  };
}

// Scans an SMB folder (recursively) and links every audio file not already
// in the given user's library, updating `job` in place as it goes so
// GET /api/storage/smb/sync/status can report live progress. Used by both
// the manual "Sync now" button and the optional scheduled background sync.
async function syncSmbFolderForUser(userId, job) {
  const syncPath = process.env.SMB_SYNC_PATH || '';
  const allKeys = await storage.listAllSmbAudioFiles(syncPath);
  job.scanned = allKeys.length;

  const alreadyLinked = new Set(
    db
      .prepare("SELECT filename FROM tracks WHERE user_id = ? AND storage = 'smb'")
      .all(userId)
      .map((r) => r.filename)
  );
  const toProcess = allKeys.filter((key) => !alreadyLinked.has(key));

  job.status = 'linking';
  job.total = toProcess.length;

  for (const key of toProcess) {
    try {
      await linkTrackForUser(userId, 'smb', key);
      job.linked++;
    } catch (err) {
      if (err.isDuplicate) {
        job.duplicates++;
      } else {
        console.error(`SMB sync: failed to link "${key}" — ${err.message}`);
        job.failed++;
      }
    }
    job.processed++;
  }

  job.status = 'done';
  job.finishedAt = new Date().toISOString();
}

app.post('/api/storage/smb/sync', requireAuth, (req, res) => {
  if (!storage.smbEnabled) return res.status(400).json({ error: 'SMB is not configured' });

  const existing = smbSyncJobs.get(req.user.id);
  if (existing && (existing.status === 'scanning' || existing.status === 'linking')) {
    return res.json(existing); // already running — hand back its current state
  }

  const job = newSyncJob();
  smbSyncJobs.set(req.user.id, job);
  // Not awaited: the HTTP response returns immediately, and the client polls
  // GET /api/storage/smb/sync/status for progress — a full recursive scan of
  // a large share can take well past any reasonable request timeout.
  syncSmbFolderForUser(req.user.id, job).catch((err) => {
    console.error('SMB sync failed:', err.message);
    job.status = 'error';
    job.error = err.message;
    job.finishedAt = new Date().toISOString();
  });

  res.json(job);
});

app.get('/api/storage/smb/sync/status', requireAuth, (req, res) => {
  res.json(smbSyncJobs.get(req.user.id) || { status: 'idle' });
});

// Scans the user's existing library for likely duplicates — a cleanup tool
// for tracks added before duplicate detection existed (or ones that slipped
// past it some other way). Groups by the same two signals used at
// upload/link time: exact content hash, then same title+artist+duration.
app.get('/api/tracks/duplicates', requireAuth, (req, res) => {
  const tracks = db.prepare('SELECT * FROM tracks WHERE user_id = ? ORDER BY created_at ASC').all(req.user.id);
  const assigned = new Set();
  const groups = [];

  const byHash = new Map();
  for (const t of tracks) {
    if (!t.content_hash) continue;
    if (!byHash.has(t.content_hash)) byHash.set(t.content_hash, []);
    byHash.get(t.content_hash).push(t);
  }
  for (const group of byHash.values()) {
    if (group.length < 2) continue;
    groups.push({ reason: 'Identical file', tracks: group.map(trackToJson) });
    group.forEach((t) => assigned.add(t.id));
  }

  const remaining = tracks.filter((t) => !assigned.has(t.id));
  const used = new Set();
  for (let i = 0; i < remaining.length; i++) {
    const a = remaining[i];
    if (used.has(a.id)) continue;
    const cluster = [a];
    for (let j = i + 1; j < remaining.length; j++) {
      const b = remaining[j];
      if (used.has(b.id)) continue;
      if (
        normalizeForDupeCheck(a.title) === normalizeForDupeCheck(b.title) &&
        normalizeForDupeCheck(a.artist) === normalizeForDupeCheck(b.artist) &&
        (a.duration == null || b.duration == null || Math.abs(a.duration - b.duration) <= 2)
      ) {
        cluster.push(b);
      }
    }
    if (cluster.length > 1) {
      cluster.forEach((t) => used.add(t.id));
      groups.push({ reason: 'Same title & artist', tracks: cluster.map(trackToJson) });
    }
  }

  res.json({ groups });
});

app.get('/api/tracks', requireAuth, (req, res) => {
  const tracks = db
    .prepare('SELECT * FROM tracks WHERE user_id = ? ORDER BY created_at DESC')
    .all(req.user.id);
  res.json(tracks.map(trackToJson));
});

// Fire-and-forget from the player whenever a track becomes the one playing —
// powers the Discover page's "Most played" / "Not played in a while" shelves.
app.post('/api/tracks/:id/play', requireAuth, (req, res) => {
  const result = db
    .prepare(
      `UPDATE tracks SET play_count = play_count + 1, last_played_at = datetime('now')
       WHERE id = ? AND user_id = ?`
    )
    .run(req.params.id, req.user.id);
  if (result.changes === 0) return res.status(404).json({ error: 'Track not found' });
  res.json({ ok: true });
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

// ---------- Artists (bio/photo, manual or auto-fetched from Wikipedia) ----------

// No API key needed — Wikipedia's search + REST summary endpoints are public.
// Best-effort only: an artist with no matching page, or a network hiccup,
// just means no auto bio/photo, not an error surfaced to the user.
async function fetchWikipediaArtistInfo(artistName) {
  const headers = { 'User-Agent': 'Wavlo/1.0 (self-hosted music app)' };
  const searchUrl =
    'https://en.wikipedia.org/w/api.php?action=query&list=search&format=json&srlimit=1&srsearch=' +
    encodeURIComponent(artistName);
  const searchRes = await fetch(searchUrl, { headers });
  if (!searchRes.ok) return null;
  const searchData = await searchRes.json();
  const title = searchData?.query?.search?.[0]?.title;
  if (!title) return null;

  const summaryRes = await fetch(`https://en.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(title)}`, {
    headers,
  });
  if (!summaryRes.ok) return null;
  const summary = await summaryRes.json();
  if (!summary.extract) return null;
  return { bio: summary.extract, photoUrl: summary.thumbnail?.source || null };
}

function artistInfoToJson(row) {
  return { bio: row?.bio || null, photoUrl: row?.photo_url || null, source: row?.source || null };
}

app.get('/api/artists/:name/info', requireAuth, async (req, res) => {
  const artist = req.params.name;
  const existing = db
    .prepare('SELECT * FROM artist_info WHERE user_id = ? AND artist = ?')
    .get(req.user.id, artist);
  if (existing && req.query.refresh !== 'true') {
    return res.json(artistInfoToJson(existing));
  }
  if (existing?.source === 'manual') {
    return res.json(artistInfoToJson(existing));
  }

  let fetched = null;
  try {
    fetched = await fetchWikipediaArtistInfo(artist);
  } catch (err) {
    console.error(`Wikipedia lookup failed for "${artist}": ${err.message}`);
  }

  if (fetched) {
    db.prepare(
      `INSERT INTO artist_info (user_id, artist, bio, photo_url, source, updated_at)
       VALUES (?, ?, ?, ?, 'wikipedia', datetime('now'))
       ON CONFLICT(user_id, artist) DO UPDATE SET
         bio = excluded.bio, photo_url = excluded.photo_url, source = 'wikipedia', updated_at = datetime('now')`
    ).run(req.user.id, artist, fetched.bio, fetched.photoUrl);
    return res.json({ bio: fetched.bio, photoUrl: fetched.photoUrl, source: 'wikipedia' });
  }

  res.json({ bio: null, photoUrl: null, source: null });
});

app.put('/api/artists/:name/info', requireAuth, (req, res) => {
  const artist = req.params.name;
  const { bio, photoUrl } = req.body;
  db.prepare(
    `INSERT INTO artist_info (user_id, artist, bio, photo_url, source, updated_at)
     VALUES (?, ?, ?, ?, 'manual', datetime('now'))
     ON CONFLICT(user_id, artist) DO UPDATE SET
       bio = excluded.bio, photo_url = excluded.photo_url, source = 'manual', updated_at = datetime('now')`
  ).run(req.user.id, artist, bio || null, photoUrl || null);
  res.json({ bio: bio || null, photoUrl: photoUrl || null, source: 'manual' });
});

app.delete('/api/artists/:name/info', requireAuth, (req, res) => {
  db.prepare('DELETE FROM artist_info WHERE user_id = ? AND artist = ?').run(req.user.id, req.params.name);
  res.json({ ok: true });
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
      const job = newSyncJob();
      smbSyncJobs.set(user.id, job);
      try {
        await syncSmbFolderForUser(user.id, job);
      } catch (err) {
        console.error(`Scheduled SMB sync failed for user ${user.id}:`, err.message);
        job.status = 'error';
        job.error = err.message;
        job.finishedAt = new Date().toISOString();
      }
    }
  }, smbSyncIntervalMinutes * 60 * 1000);
  console.log(`Scheduled SMB sync enabled: every ${smbSyncIntervalMinutes} minute(s)`);
}

const PORT = process.env.PORT || 4000;
app.listen(PORT, () => console.log(`Server listening on port ${PORT}`));
