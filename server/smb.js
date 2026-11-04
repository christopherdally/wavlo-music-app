// Connects to the configured SMB share via the standard `smbclient`/`smbget`
// CLI tools (from Samba's client package) rather than a pure-JS SMB client
// library. This is a deliberate choice: the most popular Node SMB2 client
// (@marsaud/smb2) authenticates using legacy NTLMv1/LM hashing, which (a)
// needs OpenSSL's legacy provider enabled to even run under modern Node, and
// (b) gets flatly rejected by modern Samba/Windows/NAS servers, which only
// accept NTLMv2 by default. `smbclient`/`smbget` handle real-world SMB2/3
// servers correctly out of the box.
const { spawn, execFile } = require('child_process');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const HOST = process.env.SMB_HOST;
const SHARE = process.env.SMB_SHARE;
const USERNAME = process.env.SMB_USERNAME;
const PASSWORD = process.env.SMB_PASSWORD;
const DOMAIN = process.env.SMB_DOMAIN || 'WORKGROUP';
const PORT = process.env.SMB_PORT ? Number(process.env.SMB_PORT) : 445;

const smbEnabled = Boolean(HOST && SHARE && USERNAME && PASSWORD);

const CACHE_DIR = path.join(__dirname, 'smb-cache');
if (smbEnabled) fs.mkdirSync(CACHE_DIR, { recursive: true });

// smbget has no partial/range-download mode, so each linked track is cached
// in full locally on first play (see ensureCached below). Left unbounded,
// that cache would grow forever, so it's capped with simple LRU eviction:
// every cache hit/miss touches the file's mtime, and whenever a new file is
// downloaded we prune the least-recently-used files until back under the cap.
const CACHE_MAX_BYTES = (process.env.SMB_CACHE_MAX_MB ? Number(process.env.SMB_CACHE_MAX_MB) : 10240) * 1024 * 1024;
const DOWNLOADING_SUFFIX_RE = /\.downloading-\d+-[0-9a-f]+$/;

function status() {
  return { smbConfigured: smbEnabled, host: smbEnabled ? HOST : null, share: smbEnabled ? SHARE : null };
}

// Paths come from authenticated app users (who pick what to browse/link), not
// the public internet, but they're still interpolated into smbclient's own
// mini command language via `-c`. Reject anything outside a safe character
// set so a crafted path can't inject extra smbclient commands or escape the
// current directory.
const SAFE_PATH_RE = /^[\w .()\-\/]*$/;
function assertSafePath(p) {
  if (p.includes('..') || !SAFE_PATH_RE.test(p)) {
    throw new Error('Invalid path');
  }
}

function toSmbPath(forwardSlashPath) {
  assertSafePath(forwardSlashPath);
  return forwardSlashPath.replace(/^\/+|\/+$/g, '').replace(/\//g, '\\');
}

function baseArgs() {
  return ['-p', String(PORT), '-U', `${USERNAME}%${PASSWORD}`, '-W', DOMAIN];
}

function shareUnc() {
  return `//${HOST}/${SHARE}`;
}

function runSmbclient(command) {
  return new Promise((resolve, reject) => {
    execFile(
      'smbclient',
      [shareUnc(), ...baseArgs(), '-c', command],
      { timeout: 20000, maxBuffer: 10 * 1024 * 1024 },
      (err, stdout, stderr) => {
        if (err) return reject(new Error(describeSmbError(stderr || stdout || err.message)));
        resolve(stdout);
      }
    );
  });
}

function describeSmbError(output) {
  if (/NT_STATUS_LOGON_FAILURE|STATUS_LOGON_FAILURE/.test(output)) return 'SMB login failed — check credentials';
  if (/NT_STATUS_BAD_NETWORK_NAME/.test(output)) return `SMB share "${SHARE}" not found on ${HOST}`;
  if (/NT_STATUS_OBJECT_NAME_NOT_FOUND|NT_STATUS_OBJECT_PATH_NOT_FOUND/.test(output)) return 'Path not found on share';
  if (/Connection to .* failed|NT_STATUS_IO_TIMEOUT|timed out/.test(output)) return `Couldn't reach SMB host ${HOST}`;
  return output.split('\n').find(Boolean) || 'SMB request failed';
}

// Parses smbclient's `ls` text output into entries. Each line looks like:
//   "  name.ext                            N   132344  Wed Nov  4 20:36:48 2026"
// with D for directories in place of N (plus combinations like AH, RHS, etc).
const LS_LINE_RE = /^\s{2}(.+?)\s{2,}([AHSRDN]+)\s+(\d+)\s+(.+?)\s*$/;

function parseLsOutput(stdout) {
  const entries = [];
  for (const line of stdout.split('\n')) {
    const match = line.match(LS_LINE_RE);
    if (!match) continue;
    const [, name, attrs, sizeStr, dateStr] = match;
    if (name === '.' || name === '..') continue;
    entries.push({
      name,
      isDirectory: attrs.includes('D'),
      size: Number(sizeStr),
      modified: new Date(dateStr),
    });
  }
  return entries;
}

const AUDIO_EXT_RE = /\.(mp3|flac|wav|ogg|m4a|aac|opus)$/i;

async function browseDirectory(prefix = '') {
  if (!smbEnabled) throw new Error('SMB is not configured');
  // Normalize away a leading slash so "music" and "/music" (e.g. from
  // SMB_SYNC_PATH) produce identical keys to what the "Link from SMB share"
  // browser builds (which never has one, since it always starts from the
  // root with prefix=''). Without this, the same file linked both ways would
  // get two different storage keys and show up as a duplicate track.
  prefix = prefix.replace(/^\/+/, '');
  const normalizedPrefix = prefix && !prefix.endsWith('/') ? `${prefix}/` : prefix;
  const smbDir = toSmbPath(normalizedPrefix);
  const command = smbDir ? `ls "${smbDir}\\*"` : 'ls "\\*"';
  const stdout = await runSmbclient(command);
  const entries = parseLsOutput(stdout);

  const folders = [];
  const files = [];
  for (const entry of entries) {
    const childPath = `${normalizedPrefix}${entry.name}`;
    if (entry.isDirectory) {
      folders.push(`${childPath}/`);
    } else if (AUDIO_EXT_RE.test(entry.name)) {
      files.push({ key: childPath, size: entry.size, lastModified: entry.modified });
    }
  }
  return { prefix: normalizedPrefix, folders, files };
}

const MAX_RECURSE_DEPTH = 20; // guard against a pathological/circular share layout

async function listAllAudioFiles(prefix = '', depth = 0) {
  if (depth > MAX_RECURSE_DEPTH) return [];
  const { folders, files } = await browseDirectory(prefix);
  let keys = files.map((f) => f.key);
  for (const folder of folders) {
    keys = keys.concat(await listAllAudioFiles(folder, depth + 1));
  }
  return keys;
}

async function statFile(filePath) {
  if (!smbEnabled) throw new Error('SMB is not configured');
  const smbPath = toSmbPath(filePath);
  const stdout = await runSmbclient(`ls "${smbPath}"`);
  const [entry] = parseLsOutput(stdout);
  if (!entry) throw new Error('File not found on share');
  return entry;
}

function cachePathFor(filePath) {
  const ext = path.extname(filePath) || '';
  const hash = crypto.createHash('sha256').update(filePath).digest('hex');
  return path.join(CACHE_DIR, `${hash}${ext}`);
}

function touch(filePath) {
  const now = new Date();
  fs.utimes(filePath, now, now, () => {});
}

// Prunes the least-recently-used cached files until the cache is back under
// its size cap. Runs in the background (fire-and-forget) after a new
// download — never on the hot read path.
async function evictIfNeeded() {
  let names;
  try {
    names = await fs.promises.readdir(CACHE_DIR);
  } catch {
    return;
  }

  const files = [];
  let totalBytes = 0;
  for (const name of names) {
    if (DOWNLOADING_SUFFIX_RE.test(name)) continue; // skip in-flight downloads
    const filePath = path.join(CACHE_DIR, name);
    let stat;
    try {
      stat = await fs.promises.stat(filePath);
    } catch {
      continue; // deleted/renamed concurrently — fine, skip it
    }
    files.push({ filePath, size: stat.size, mtime: stat.mtimeMs });
    totalBytes += stat.size;
  }

  if (totalBytes <= CACHE_MAX_BYTES) return;

  files.sort((a, b) => a.mtime - b.mtime); // oldest-accessed first
  for (const file of files) {
    if (totalBytes <= CACHE_MAX_BYTES) break;
    try {
      await fs.promises.unlink(file.filePath);
      totalBytes -= file.size;
    } catch {
      // Already gone, or mid-read elsewhere — leave it for the next pass.
    }
  }
}

// Downloads the whole file once via `smbget` into a local cache, then every
// read (including HTTP range requests for seeking) is served from that local
// copy. smbget has no partial/range-download mode, so true range support
// only kicks in after the first full fetch.
async function ensureCached(filePath) {
  const dest = cachePathFor(filePath);
  if (fs.existsSync(dest)) {
    touch(dest);
    return dest;
  }

  assertSafePath(filePath);
  const smbPath = filePath.replace(/^\/+/, '');
  const url = `smb://${encodeURIComponent(USERNAME)}:${encodeURIComponent(PASSWORD)}@${HOST}:${PORT}/${encodeURIComponent(
    SHARE
  )}/${smbPath
    .split('/')
    .map(encodeURIComponent)
    .join('/')}`;

  const tmpDest = `${dest}.downloading-${process.pid}-${crypto.randomBytes(4).toString('hex')}`;
  try {
    await new Promise((resolve, reject) => {
      const child = spawn('smbget', ['-q', '--stdout', url]);
      const out = fs.createWriteStream(tmpDest);
      let stderr = '';
      child.stdout.pipe(out);
      child.stderr.on('data', (d) => (stderr += d));
      child.on('error', reject);
      child.on('close', (code) => {
        out.close();
        if (code !== 0) return reject(new Error(describeSmbError(stderr) || `smbget exited with code ${code}`));
        resolve();
      });
    });
  } catch (err) {
    fs.unlink(tmpDest, () => {}); // don't leave a stale 0-byte temp file behind
    throw err;
  }
  fs.renameSync(tmpDest, dest);
  evictIfNeeded().catch(() => {});
  return dest;
}

const MAX_METADATA_FETCH_BYTES = 40 * 1024 * 1024;

async function fetchFileBuffer(filePath) {
  const stat = await statFile(filePath);
  if (stat.size > MAX_METADATA_FETCH_BYTES) return null;
  const cached = await ensureCached(filePath);
  return fs.readFileSync(cached);
}

async function streamFile(filePath, range, res) {
  try {
    const cached = await ensureCached(filePath);
    const stat = fs.statSync(cached);

    if (!range) {
      res.writeHead(200, { 'Content-Length': stat.size, 'Content-Type': 'audio/mpeg' });
      fs.createReadStream(cached).pipe(res);
      return;
    }

    const [startStr, endStr] = range.replace(/bytes=/, '').split('-');
    const start = parseInt(startStr, 10);
    const end = endStr ? parseInt(endStr, 10) : stat.size - 1;
    res.writeHead(206, {
      'Content-Range': `bytes ${start}-${end}/${stat.size}`,
      'Accept-Ranges': 'bytes',
      'Content-Length': end - start + 1,
      'Content-Type': 'audio/mpeg',
    });
    fs.createReadStream(cached, { start, end }).pipe(res);
  } catch {
    res.status(404).end();
  }
}

module.exports = {
  smbEnabled,
  status,
  browseDirectory,
  listAllAudioFiles,
  statFile,
  fetchFileBuffer,
  streamFile,
};
