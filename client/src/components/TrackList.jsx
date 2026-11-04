import { useState } from 'react';
import { usePlayer } from '../context/PlayerContext';
import { useLibrary } from '../context/LibraryContext';
import { api } from '../api';

function formatDuration(sec) {
  if (!sec) return '--:--';
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60)
    .toString()
    .padStart(2, '0');
  return `${m}:${s}`;
}

export default function TrackList({ tracks, onTrackDeleted, playlistId, onRemoveFromPlaylist }) {
  const { playTrack, current, isPlaying } = usePlayer();
  const { playlists, deleteTrack } = useLibrary();
  const [menuTrackId, setMenuTrackId] = useState(null);

  async function handleAddToPlaylist(playlistId, trackId) {
    await api.addTrackToPlaylist(playlistId, trackId);
    setMenuTrackId(null);
  }

  async function handleDelete(trackId) {
    await deleteTrack(trackId);
    onTrackDeleted && onTrackDeleted(trackId);
  }

  if (tracks.length === 0) {
    return <div className="empty-state">No tracks yet.</div>;
  }

  return (
    <div className="track-list">
      {tracks.map((track, i) => {
        const isCurrent = current?.id === track.id;
        return (
          <div key={track.id} className={`track-row ${isCurrent ? 'active' : ''}`}>
            <div className="track-index" onClick={() => playTrack(track, tracks)}>
              {isCurrent && isPlaying ? '♪' : i + 1}
            </div>
            <div className="track-cover" onClick={() => playTrack(track, tracks)}>
              {track.coverUrl ? <img src={track.coverUrl} alt="" /> : <div className="cover-placeholder" />}
            </div>
            <div className="track-meta" onClick={() => playTrack(track, tracks)}>
              <div className="track-title">
                {track.title}
                {track.source === 'linked' && <span className="track-source-badge">S3</span>}
              </div>
              <div className="track-artist">
                {track.artist}
                {track.album ? ` · ${track.album}` : ''}
              </div>
            </div>
            <div className="track-duration">{formatDuration(track.duration)}</div>
            <div className="track-actions">
              <button className="icon-btn" onClick={() => setMenuTrackId(menuTrackId === track.id ? null : track.id)}>
                ⋯
              </button>
              {menuTrackId === track.id && (
                <div className="track-menu">
                  <div className="track-menu-label">Add to playlist</div>
                  {playlists.map((p) => (
                    <button key={p.id} onClick={() => handleAddToPlaylist(p.id, track.id)}>
                      {p.name}
                    </button>
                  ))}
                  {playlistId && (
                    <button
                      className="danger"
                      onClick={() => {
                        onRemoveFromPlaylist && onRemoveFromPlaylist(track.id);
                        setMenuTrackId(null);
                      }}
                    >
                      Remove from this playlist
                    </button>
                  )}
                  <button className="danger" onClick={() => handleDelete(track.id)}>
                    Delete from library
                  </button>
                </div>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}
