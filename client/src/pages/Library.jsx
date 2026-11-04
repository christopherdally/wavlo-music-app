import { useEffect, useRef, useState } from 'react';
import { useLibrary } from '../context/LibraryContext';
import { usePlayer } from '../context/PlayerContext';
import { api } from '../api';
import TrackList from '../components/TrackList';
import LinkFromBucketModal from '../components/LinkFromBucketModal';

export default function Library() {
  const { tracks, refreshTracks } = useLibrary();
  const { playTrack } = usePlayer();
  const fileInput = useRef(null);
  const [uploading, setUploading] = useState(false);
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState('');
  const [storageStatus, setStorageStatus] = useState(null);
  const [showLinkModal, setShowLinkModal] = useState(false);

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

  return (
    <div className="page">
      <div className="page-header">
        <h1>Your Library</h1>
        <div className="page-header-actions">
          {storageStatus?.s3Configured && (
            <button className="btn-secondary" onClick={() => setShowLinkModal(true)}>
              Link from bucket
            </button>
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
      {showLinkModal && (
        <LinkFromBucketModal
          bucket={storageStatus?.bucket}
          onClose={() => setShowLinkModal(false)}
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
