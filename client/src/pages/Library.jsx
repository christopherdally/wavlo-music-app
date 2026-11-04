import { useEffect, useRef, useState } from 'react';
import { useLibrary } from '../context/LibraryContext';
import { usePlayer } from '../context/PlayerContext';
import { api } from '../api';
import TrackList from '../components/TrackList';
import LinkFromRemoteModal from '../components/LinkFromRemoteModal';

const SHELF_SIZE = 10;

export default function Library() {
  const { tracks, refreshTracks } = useLibrary();
  const { playTrack } = usePlayer();
  const fileInput = useRef(null);
  const [uploading, setUploading] = useState(false);
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState('');
  const [storageStatus, setStorageStatus] = useState(null);
  const [activeLinkModal, setActiveLinkModal] = useState(null); // 's3' | 'smb' | null
  const [syncJob, setSyncJob] = useState(null);
  const syncPollRef = useRef(null);

  useEffect(() => {
    api.getStorageStatus().then(setStorageStatus).catch(() => {});
  }, []);

  // A sync may already be running — kicked off by another tab, or by the
  // server's own scheduled SMB_SYNC_INTERVAL_MINUTES timer — so pick up
  // polling for it on mount instead of only when this page starts one.
  useEffect(() => {
    api
      .getSmbSyncStatus()
      .then((job) => {
        if (job.status === 'scanning' || job.status === 'linking') {
          setSyncJob(job);
          pollSyncStatus();
        }
      })
      .catch(() => {});
    return () => clearTimeout(syncPollRef.current);
  }, []);

  function pollSyncStatus() {
    syncPollRef.current = setTimeout(async () => {
      let job;
      try {
        job = await api.getSmbSyncStatus();
      } catch {
        return;
      }
      setSyncJob(job);
      if (job.status === 'scanning' || job.status === 'linking') {
        pollSyncStatus();
      } else if (job.status === 'done') {
        refreshTracks();
      }
    }, 1000);
  }

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
    setError('');
    try {
      const job = await api.syncSmb();
      setSyncJob(job);
      pollSyncStatus();
    } catch (err) {
      setError(err.message || 'SMB sync failed.');
    }
  }

  const syncing = syncJob && (syncJob.status === 'scanning' || syncJob.status === 'linking');
  const syncProgressPct =
    syncJob && syncJob.status === 'linking' && syncJob.total
      ? Math.round((syncJob.processed / syncJob.total) * 100)
      : null;

  const recentlyAdded = [...tracks].sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt)).slice(0, SHELF_SIZE);
  const recentlyPlayed = [...tracks]
    .filter((t) => t.lastPlayedAt)
    .sort((a, b) => new Date(b.lastPlayedAt) - new Date(a.lastPlayedAt))
    .slice(0, SHELF_SIZE);

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
      {syncJob && syncJob.status !== 'idle' && (
        <div className="sync-progress">
          {syncing ? (
            <>
              <div className="sync-progress-label">
                {syncJob.status === 'scanning'
                  ? 'Scanning SMB share…'
                  : `Linking tracks… ${syncJob.processed}/${syncJob.total}`}
              </div>
              <div className="progress-bar-track">
                <div
                  className={`progress-bar-fill ${syncProgressPct == null ? 'indeterminate' : ''}`}
                  style={syncProgressPct != null ? { width: `${syncProgressPct}%` } : undefined}
                />
              </div>
            </>
          ) : (
            <div className="sync-progress-label">
              {syncJob.status === 'error' ? (
                <>SMB sync failed: {syncJob.error}</>
              ) : (
                <>
                  SMB sync complete: {syncJob.linked} new track{syncJob.linked === 1 ? '' : 's'} linked
                  {syncJob.duplicates ? `, ${syncJob.duplicates} duplicate${syncJob.duplicates === 1 ? '' : 's'} skipped` : ''}
                  {syncJob.failed ? `, ${syncJob.failed} failed` : ''} ({syncJob.scanned} file
                  {syncJob.scanned === 1 ? '' : 's'} found total).
                </>
              )}
              <button className="link-btn" onClick={() => setSyncJob(null)}>
                Dismiss
              </button>
            </div>
          )}
        </div>
      )}
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
      {recentlyAdded.length > 0 && (
        <section className="discover-shelf">
          <h2 className="discover-shelf-title">Recently added</h2>
          <TrackList tracks={recentlyAdded} onTrackDeleted={refreshTracks} />
        </section>
      )}
      {recentlyPlayed.length > 0 && (
        <section className="discover-shelf">
          <h2 className="discover-shelf-title">Recently played</h2>
          <TrackList tracks={recentlyPlayed} onTrackDeleted={refreshTracks} />
        </section>
      )}
      {tracks.length > 0 && (
        <section className="discover-shelf">
          <div className="discover-shelf-header">
            <h2 className="discover-shelf-title">All tracks</h2>
            <button className="btn-secondary play-all-btn" onClick={() => playTrack(tracks[0], tracks)}>
              ▶ Play all
            </button>
          </div>
          <TrackList tracks={tracks} onTrackDeleted={refreshTracks} />
        </section>
      )}
      {tracks.length === 0 && <TrackList tracks={tracks} onTrackDeleted={refreshTracks} />}
    </div>
  );
}
