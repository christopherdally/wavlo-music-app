const DB_NAME = 'wavlo-offline';
const DB_VERSION = 1;
const STORE = 'tracks';

function openDb() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      req.result.createObjectStore(STORE, { keyPath: 'id' });
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function requestToPromise(request) {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function fetchBlob(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Failed to fetch ${url} (${res.status})`);
  return res.blob();
}

export async function downloadTrack(track) {
  const [audioBlob, coverBlob] = await Promise.all([
    fetchBlob(track.streamUrl),
    track.coverUrl ? fetchBlob(track.coverUrl).catch(() => null) : Promise.resolve(null),
  ]);
  const record = {
    id: track.id,
    title: track.title,
    artist: track.artist,
    album: track.album,
    duration: track.duration,
    audioBlob,
    coverBlob,
    downloadedAt: new Date().toISOString(),
  };
  const db = await openDb();
  await requestToPromise(db.transaction(STORE, 'readwrite').objectStore(STORE).put(record));
  return record;
}

export async function removeDownload(id) {
  const db = await openDb();
  await requestToPromise(db.transaction(STORE, 'readwrite').objectStore(STORE).delete(id));
}

export async function getDownload(id) {
  const db = await openDb();
  const result = await requestToPromise(db.transaction(STORE, 'readonly').objectStore(STORE).get(id));
  return result || null;
}

export async function listDownloads() {
  const db = await openDb();
  return requestToPromise(db.transaction(STORE, 'readonly').objectStore(STORE).getAll());
}

export async function listDownloadedIds() {
  const db = await openDb();
  return requestToPromise(db.transaction(STORE, 'readonly').objectStore(STORE).getAllKeys());
}
