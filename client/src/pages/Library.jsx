import { useEffect, useRef, useState } from 'react';
import { useLibrary } from '../context/LibraryContext';
import { usePlayer } from '../context/PlayerContext';
import { api } from '../api';
import TrackList from '../components/TrackList';
import LinkFromRemoteModal from '../components/LinkFromRemoteModal';

export default function Library() {
  const { tracks, refreshTracks } = useLibrary();
  const { playTrack } = usePlayer();
  const fileInput = useRef(null);
  const [uploading, setUploading] = useState(false);
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState('');
  const [storageStatus, setStorageStatus] = useState(null);
  const [activeLinkModal, setActiveLinkModal] = useState(null); // 's3' | 'smb' | null
  const [syncing, setSyncing] = useState(false);

  useEffect(() => {
    api.getStorageStatus().then(setStorageStatus).catch(() => {});
  }, []);

  async function onFilesChosen(e) {
    const files = Array.from(e.target.files || []);
    e.target.value = '';
    if (files.length === 0) return;
    setUploading(true);
    setError('');
    for (const file of files) {
      try {
        await api.uploadTrack(file, (p) => setProgress(p));
      } catch (err) {
        setError(err.message);
      }
    }
    setUploading(false);
    setProgress(0);
    refreshTracks();
  }

  async function handleSyncSmb() {
    setSyncing(true);
    setError('');
    try {
      const result = await api.syncSmb();
      refreshTracks();
      alert(
        `SMB sync complete: ${result.linked} new track${result.linked === 1 ? '' : 's'} linked` +
          (result.alreadyLinked ? `, ${result.alreadyLinked} already in your library` : '') +
          (result.failed ? `, ${result.failed} failed` : '') +
          ` (${result.scanned} file${result.scanned === 1 ? '' : 's'} found total).`
      );
    } catch (err) {
      setError(err.message || 'SMB sync failed.');
    } finally {
      setSyncing(false);
    }
  }

  return (
    <div className="page">
      <div className="page-header">
        <h1>Your Library</h1>
        <div className="page-header-actions">
          {storageStatus?.s3Configured && (
            <button className="btn-secondary" onClick={() => setActiveLinkModal('s3')}>
              Link from bucket
            </button>
          )}
          {storageStatus?.smbConfigured && (
            <>
              <button className="btn-secondary" onClick={() => setActiveLinkModal('smb')}>
                Link from SMB share
              </button>
              <button className="btn-secondary" onClick={handleSyncSmb} disabled={syncing}>
                {syncing ? 'Syncing…' : 'Sync SMB folder'}
              </button>
            </>
          )}
          <button className="btn-primary" onClick={() => fileInput.current.click()} disabled={uploading}>
            {uploading ? `Uploading… ${Math.round(progress * 100)}%` : 'Upload tracks'}
          </button>
          <input
            ref={fileInput}
            type="file"
            accept="audio/*,.mp3,.flac,.wav,.ogg,.m4a,.aac"
            multiple
            hidden
            onChange={onFilesChosen}
          />
        </div>
      </div>
      {error && <div className="auth-error">{error}</div>}
      {activeLinkModal === 's3' && (
        <LinkFromRemoteModal
          title={`Link from ${storageStatus?.bucket}`}
          rootLabel="bucket root"
          browse={api.browseStorage}
          link={api.linkTrack}
          onClose={() => setActiveLinkModal(null)}
          onLinked={refreshTracks}
        />
      )}
      {activeLinkModal === 'smb' && (
        <LinkFromRemoteModal
          title={`Link from ${storageStatus?.share || 'SMB share'}`}
          rootLabel="share root"
          browse={api.browseSmb}
          link={api.linkSmbTrack}
          onClose={() => setActiveLinkModal(null)}
          onLinked={refreshTracks}
        />
      )}
      {tracks.length > 0 && (
        <button className="btn-secondary play-all-btn" onClick={() => playTrack(tracks[0], tracks)}>
          ▶ Play all
        </button>
      )}
      <TrackList tracks={tracks} onTrackDeleted={refreshTracks} />
    </div>
  );
}
