const BASE = '/api';

function authHeaders() {
  const token = localStorage.getItem('token');
  return token ? { Authorization: `Bearer ${token}` } : {};
}

async function handle(res) {
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    const err = new Error(body.error || `Request failed (${res.status})`);
    err.status = res.status;
    throw err;
  }
  return res.status === 204 ? null : res.json();
}

export const api = {
  getAuthConfig: () => fetch(`${BASE}/auth/config`).then(handle),

  register: (email, password, displayName) =>
    fetch(`${BASE}/auth/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password, displayName }),
    }).then(handle),

  login: (email, password) =>
    fetch(`${BASE}/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password }),
    }).then(handle),

  me: () => fetch(`${BASE}/me`, { headers: authHeaders() }).then(handle),

  getTracks: () => fetch(`${BASE}/tracks`, { headers: authHeaders() }).then(handle),

  searchTracks: (q) =>
    fetch(`${BASE}/tracks/search?q=${encodeURIComponent(q)}`, { headers: authHeaders() }).then(handle),

  uploadTrack: (file, onProgress) =>
    new Promise((resolve, reject) => {
      const form = new FormData();
      form.append('file', file);
      const xhr = new XMLHttpRequest();
      xhr.open('POST', `${BASE}/tracks/upload`);
      const token = localStorage.getItem('token');
      if (token) xhr.setRequestHeader('Authorization', `Bearer ${token}`);
      xhr.upload.onprogress = (e) => onProgress && onProgress(e.loaded / e.total);
      xhr.onload = () => {
        if (xhr.status >= 200 && xhr.status < 300) resolve(JSON.parse(xhr.responseText));
        else reject(new Error(JSON.parse(xhr.responseText || '{}').error || 'Upload failed'));
      };
      xhr.onerror = () => reject(new Error('Upload failed'));
      xhr.send(form);
    }),

  deleteTrack: (id) => fetch(`${BASE}/tracks/${id}`, { method: 'DELETE', headers: authHeaders() }).then(handle),

  getPlaylists: () => fetch(`${BASE}/playlists`, { headers: authHeaders() }).then(handle),

  createPlaylist: (name) =>
    fetch(`${BASE}/playlists`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...authHeaders() },
      body: JSON.stringify({ name }),
    }).then(handle),

  getPlaylist: (id) => fetch(`${BASE}/playlists/${id}`, { headers: authHeaders() }).then(handle),

  renamePlaylist: (id, name) =>
    fetch(`${BASE}/playlists/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', ...authHeaders() },
      body: JSON.stringify({ name }),
    }).then(handle),

  deletePlaylist: (id) => fetch(`${BASE}/playlists/${id}`, { method: 'DELETE', headers: authHeaders() }).then(handle),

  addTrackToPlaylist: (playlistId, trackId) =>
    fetch(`${BASE}/playlists/${playlistId}/tracks`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...authHeaders() },
      body: JSON.stringify({ trackId }),
    }).then(handle),

  removeTrackFromPlaylist: (playlistId, trackId) =>
    fetch(`${BASE}/playlists/${playlistId}/tracks/${trackId}`, {
      method: 'DELETE',
      headers: authHeaders(),
    }).then(handle),

  getStorageStatus: () => fetch(`${BASE}/storage/status`, { headers: authHeaders() }).then(handle),

  browseStorage: (prefix) =>
    fetch(`${BASE}/storage/browse?prefix=${encodeURIComponent(prefix || '')}`, { headers: authHeaders() }).then(
      handle
    ),

  browseSmb: (dirPath) =>
    fetch(`${BASE}/storage/browse?source=smb&path=${encodeURIComponent(dirPath || '')}`, {
      headers: authHeaders(),
    }).then(handle),

  linkTrack: (key) =>
    fetch(`${BASE}/tracks/link`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...authHeaders() },
      body: JSON.stringify({ source: 's3', key }),
    }).then(handle),

  linkSmbTrack: (key) =>
    fetch(`${BASE}/tracks/link`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...authHeaders() },
      body: JSON.stringify({ source: 'smb', key }),
    }).then(handle),

  syncSmb: () =>
    fetch(`${BASE}/storage/smb/sync`, { method: 'POST', headers: authHeaders() }).then(handle),
};
