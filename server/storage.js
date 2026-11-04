const fs = require('fs');
const path = require('path');
const {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  DeleteObjectCommand,
  ListObjectsV2Command,
} = require('@aws-sdk/client-s3');
const smb = require('./smb');

const UPLOAD_DIR = path.join(__dirname, 'uploads');
fs.mkdirSync(UPLOAD_DIR, { recursive: true });

const BUCKET = process.env.AWS_S3_BUCKET;
const REGION = process.env.AWS_REGION;
const s3Enabled = Boolean(BUCKET && REGION);

let s3Client = null;
if (s3Enabled) {
  s3Client = new S3Client({
    region: REGION,
    ...(process.env.AWS_S3_ENDPOINT
      ? {
          endpoint: process.env.AWS_S3_ENDPOINT,
          forcePathStyle: true,
          // S3-compatible servers (MinIO, R2, s3rver, etc.) often don't support the
          // request/response checksum headers the SDK sends by default, which can
          // break request signing against them.
          requestChecksumCalculation: 'WHEN_REQUIRED',
          responseChecksumValidation: 'WHEN_REQUIRED',
        }
      : {}),
    ...(process.env.AWS_ACCESS_KEY_ID && process.env.AWS_SECRET_ACCESS_KEY
      ? {
          credentials: {
            accessKeyId: process.env.AWS_ACCESS_KEY_ID,
            secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
          },
        }
      : {}),
  });
}

function uploadDriver() {
  const driver = (process.env.STORAGE_DRIVER || 'local').toLowerCase();
  if (driver === 's3' && !s3Enabled) {
    throw new Error('STORAGE_DRIVER=s3 but AWS_S3_BUCKET/AWS_REGION are not configured');
  }
  return driver;
}

function status() {
  return {
    s3Configured: s3Enabled,
    bucket: s3Enabled ? BUCKET : null,
    uploadDriver: s3Enabled ? uploadDriver() : 'local',
    ...smb.status(),
  };
}

async function streamToBuffer(stream) {
  const chunks = [];
  for await (const chunk of stream) chunks.push(chunk);
  return Buffer.concat(chunks);
}

// ---------- Writing / storing new uploads ----------

async function storeBuffer(buffer, key, contentType) {
  const driver = uploadDriver();
  if (driver === 's3') {
    await s3Client.send(
      new PutObjectCommand({
        Bucket: BUCKET,
        Key: key,
        Body: buffer,
        ContentType: contentType,
      })
    );
    return { storage: 's3', key };
  }
  const destPath = path.join(UPLOAD_DIR, key);
  fs.mkdirSync(path.dirname(destPath), { recursive: true });
  fs.writeFileSync(destPath, buffer);
  return { storage: 'local', key };
}

async function deleteStored(storage, key) {
  if (storage === 's3') {
    if (!s3Enabled) return;
    await s3Client.send(new DeleteObjectCommand({ Bucket: BUCKET, Key: key })).catch(() => {});
  } else {
    fs.unlink(path.join(UPLOAD_DIR, key), () => {});
  }
}

// ---------- Reading / streaming ----------

function streamLocal(key, range, res) {
  const filePath = path.join(UPLOAD_DIR, key);
  if (!fs.existsSync(filePath)) return res.status(404).end();
  const stat = fs.statSync(filePath);

  if (!range) {
    res.writeHead(200, { 'Content-Length': stat.size, 'Content-Type': 'audio/mpeg' });
    fs.createReadStream(filePath).pipe(res);
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
  fs.createReadStream(filePath, { start, end }).pipe(res);
}

async function streamS3(key, range, res) {
  try {
    const result = await s3Client.send(
      new GetObjectCommand({ Bucket: BUCKET, Key: key, ...(range ? { Range: range } : {}) })
    );
    const headers = {
      'Content-Type': result.ContentType || 'audio/mpeg',
      'Accept-Ranges': 'bytes',
    };
    if (result.ContentLength != null) headers['Content-Length'] = result.ContentLength;
    if (result.ContentRange) headers['Content-Range'] = result.ContentRange;
    res.writeHead(result.ContentRange ? 206 : 200, headers);
    result.Body.pipe(res);
  } catch (err) {
    if (err.name === 'NoSuchKey' || err.$metadata?.httpStatusCode === 404) return res.status(404).end();
    res.status(500).end();
  }
}

async function streamFile(storage, key, range, res) {
  if (storage === 's3') return streamS3(key, range, res);
  if (storage === 'smb') return smb.streamFile(key, range, res);
  return streamLocal(key, range, res);
}

// ---------- Fetching a whole object (for metadata parsing on link) ----------

const MAX_METADATA_FETCH_BYTES = 40 * 1024 * 1024;

async function headS3Object(key) {
  const result = await s3Client.send(new HeadObjectCommand({ Bucket: BUCKET, Key: key }));
  return { size: result.ContentLength, contentType: result.ContentType };
}

async function headObject(storageType, key) {
  if (storageType === 's3') return headS3Object(key);
  if (storageType === 'smb') {
    const stat = await smb.statFile(key);
    return { size: stat.size };
  }
  const stat = fs.statSync(path.join(UPLOAD_DIR, key));
  return { size: stat.size };
}

async function fetchObjectBuffer(storage, key) {
  if (storage === 's3') {
    const head = await headS3Object(key);
    if (head.size > MAX_METADATA_FETCH_BYTES) return null;
    const result = await s3Client.send(new GetObjectCommand({ Bucket: BUCKET, Key: key }));
    return streamToBuffer(result.Body);
  }
  if (storage === 'smb') {
    return smb.fetchFileBuffer(key);
  }
  const filePath = path.join(UPLOAD_DIR, key);
  const stat = fs.statSync(filePath);
  if (stat.size > MAX_METADATA_FETCH_BYTES) return null;
  return fs.readFileSync(filePath);
}

// ---------- Browsing bucket contents for "link existing content" ----------

const AUDIO_EXT_RE = /\.(mp3|flac|wav|ogg|m4a|aac|opus)$/i;

async function browseBucket(prefix = '') {
  if (!s3Enabled) throw new Error('S3 is not configured');
  const normalizedPrefix = prefix && !prefix.endsWith('/') ? `${prefix}/` : prefix;
  const result = await s3Client.send(
    new ListObjectsV2Command({
      Bucket: BUCKET,
      Prefix: normalizedPrefix,
      Delimiter: '/',
      MaxKeys: 500,
    })
  );
  const folders = (result.CommonPrefixes || []).map((p) => p.Prefix);
  const files = (result.Contents || [])
    .filter((obj) => obj.Key !== normalizedPrefix && AUDIO_EXT_RE.test(obj.Key))
    .map((obj) => ({ key: obj.Key, size: obj.Size, lastModified: obj.LastModified }));
  return { prefix: normalizedPrefix, folders, files };
}

module.exports = {
  s3Enabled,
  status,
  uploadDriver,
  storeBuffer,
  deleteStored,
  streamFile,
  fetchObjectBuffer,
  headObject,
  headS3Object,
  browseBucket,
  smbEnabled: smb.smbEnabled,
  browseSmbDirectory: smb.browseDirectory,
};
