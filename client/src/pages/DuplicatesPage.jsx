import { useEffect, useState } from 'react';
import { api } from '../api';
import { useLibrary } from '../context/LibraryContext';
import TrackList from '../components/TrackList';

export default function DuplicatesPage() {
  const { refreshTracks } = useLibrary();
  const [groups, setGroups] = useState(null);
  const [error, setError] = useState('');
  const [scanning, setScanning] = useState(false);

  function scan() {
    setScanning(true);
    setError('');
    api
      .getDuplicates()
      .then((result) => setGroups(result.groups))
      .catch((err) => setError(err.message || 'Scan failed.'))
      .finally(() => setScanning(false));
  }

  useEffect(scan, []);

  function handleTrackDeleted() {
    refreshTracks();
    scan();
  }

  return (
    <div className="page">
      <div className="page-header">
        <h1>Duplicates</h1>
        <div className="page-header-actions">
          <button className="btn-secondary" onClick={scan} disabled={scanning}>
            {scanning ? 'Scanning…' : 'Rescan'}
          </button>
        </div>
      </div>
      {error && <div className="auth-error">{error}</div>}
      {groups && groups.length === 0 && (
        <div className="empty-state">No duplicates found — your library is clean.</div>
      )}
      {groups &&
        groups.map((group, i) => (
          <div key={i} className="duplicate-group">
            <h2 className="album-detail-heading">{group.reason}</h2>
            <TrackList tracks={group.tracks} onTrackDeleted={handleTrackDeleted} />
          </div>
        ))}
    </div>
  );
}
