import { useEffect, useState } from 'react';
import { api } from '../api';

function formatSize(bytes) {
  if (!bytes) return '';
  const mb = bytes / (1024 * 1024);
  return mb >= 1 ? `${mb.toFixed(1)} MB` : `${Math.round(bytes / 1024)} KB`;
}

export default function LinkFromBucketModal({ bucket, onClose, onLinked }) {
  const [prefix, setPrefix] = useState('');
  const [data, setData] = useState({ folders: [], files: [] });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [linkingKey, setLinkingKey] = useState(null);

  function load(p) {
    setLoading(true);
    setError('');
    api
      .browseStorage(p)
      .then(setData)
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false));
  }

  useEffect(() => load(prefix), [prefix]);

  const crumbs = prefix.split('/').filter(Boolean);

  async function handleLink(key) {
    setLinkingKey(key);
    setError('');
    try {
      await api.linkTrack(key);
      onLinked && onLinked();
    } catch (err) {
      setError(err.message);
    } finally {
      setLinkingKey(null);
    }
  }

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h2>Link from {bucket}</h2>
          <button className="icon-btn" onClick={onClose}>
            ✕
          </button>
        </div>

        <div className="breadcrumbs">
          <button className="crumb" onClick={() => setPrefix('')}>
            bucket root
          </button>
          {crumbs.map((c, i) => (
            <span key={i}>
              {' / '}
              <button className="crumb" onClick={() => setPrefix(crumbs.slice(0, i + 1).join('/') + '/')}>
                {c}
              </button>
            </span>
          ))}
        </div>

        {error && <div className="auth-error">{error}</div>}
        {loading && <div className="empty-state">Loading…</div>}

        {!loading && (
          <div className="bucket-browser">
            {data.folders.length === 0 && data.files.length === 0 && (
              <div className="empty-state">No folders or audio files here.</div>
            )}
            {data.folders.map((folder) => (
              <div key={folder} className="bucket-row" onClick={() => setPrefix(folder)}>
                <span className="bucket-icon">📁</span>
                <span className="bucket-name">{folder.replace(prefix, '').replace(/\/$/, '')}</span>
              </div>
            ))}
            {data.files.map((file) => (
              <div key={file.key} className="bucket-row">
                <span className="bucket-icon">🎵</span>
                <span className="bucket-name">{file.key.replace(prefix, '')}</span>
                <span className="bucket-size">{formatSize(file.size)}</span>
                <button
                  className="btn-secondary"
                  disabled={linkingKey === file.key}
                  onClick={() => handleLink(file.key)}
                >
                  {linkingKey === file.key ? 'Linking…' : 'Link'}
                </button>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
