import { useEffect, useState } from 'react';

function formatSize(bytes) {
  if (!bytes) return '';
  const mb = bytes / (1024 * 1024);
  return mb >= 1 ? `${mb.toFixed(1)} MB` : `${Math.round(bytes / 1024)} KB`;
}

// Reusable "browse a remote source and link files as tracks" modal. Works for
// any backend whose browse/link calls return the shared shape
// { prefix, folders: ['a/b/'], files: [{ key, size, lastModified }] }.
export default function LinkFromRemoteModal({ title, rootLabel, browse, link, onClose, onLinked }) {
  const [prefix, setPrefix] = useState('');
  const [data, setData] = useState({ folders: [], files: [] });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [linkingKey, setLinkingKey] = useState(null);
  const [selected, setSelected] = useState(new Set());
  const [bulkProgress, setBulkProgress] = useState(null); // { done, total } | null

  function load(p) {
    setLoading(true);
    setError('');
    setSelected(new Set());
    browse(p)
      .then(setData)
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false));
  }

  useEffect(() => load(prefix), [prefix]);

  const crumbs = prefix.split('/').filter(Boolean);
  const allSelected = data.files.length > 0 && selected.size === data.files.length;

  function toggleSelected(key) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  function toggleSelectAll() {
    setSelected(allSelected ? new Set() : new Set(data.files.map((f) => f.key)));
  }

  async function handleLink(key) {
    setLinkingKey(key);
    setError('');
    try {
      await link(key);
      onLinked && onLinked();
    } catch (err) {
      setError(err.message);
    } finally {
      setLinkingKey(null);
    }
  }

  async function handleLinkSelected() {
    const keys = [...selected];
    if (keys.length === 0) return;
    setError('');
    setBulkProgress({ done: 0, total: keys.length });
    const failures = [];
    for (const key of keys) {
      try {
        await link(key);
        onLinked && onLinked();
      } catch (err) {
        failures.push(`${key}: ${err.message}`);
      }
      setBulkProgress((prev) => ({ done: prev.done + 1, total: prev.total }));
    }
    setBulkProgress(null);
    setSelected(new Set());
    if (failures.length > 0) {
      setError(
        failures.length === keys.length
          ? `Failed to link all ${failures.length} tracks.`
          : `Linked ${keys.length - failures.length} of ${keys.length} — ${failures.length} failed.`
      );
    }
  }

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h2>{title}</h2>
          <button className="icon-btn" onClick={onClose}>
            ✕
          </button>
        </div>

        <div className="breadcrumbs">
          <button className="crumb" onClick={() => setPrefix('')}>
            {rootLabel}
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

        {!loading && data.files.length > 0 && (
          <div className="bulk-link-bar">
            <label className="bulk-select-all">
              <input type="checkbox" checked={allSelected} onChange={toggleSelectAll} />
              Select all in this folder ({data.files.length})
            </label>
            <button
              className="btn-primary"
              disabled={selected.size === 0 || bulkProgress !== null}
              onClick={handleLinkSelected}
            >
              {bulkProgress
                ? `Linking ${bulkProgress.done}/${bulkProgress.total}…`
                : `Link selected${selected.size > 0 ? ` (${selected.size})` : ''}`}
            </button>
          </div>
        )}

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
                <input
                  type="checkbox"
                  checked={selected.has(file.key)}
                  onChange={() => toggleSelected(file.key)}
                  onClick={(e) => e.stopPropagation()}
                />
                <span className="bucket-icon">🎵</span>
                <span className="bucket-name">{file.key.replace(prefix, '')}</span>
                <span className="bucket-size">{formatSize(file.size)}</span>
                <button
                  className="btn-secondary"
                  disabled={linkingKey === file.key || bulkProgress !== null}
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
