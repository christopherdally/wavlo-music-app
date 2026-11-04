import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { api } from '../api';
import { useLibrary } from '../context/LibraryContext';
import { usePlayer } from '../context/PlayerContext';
import TrackList from '../components/TrackList';

export default function PlaylistPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { deletePlaylist } = useLibrary();
  const { playTrack } = usePlayer();
  const [playlist, setPlaylist] = useState(null);

  function load() {
    api.getPlaylist(id).then(setPlaylist).catch(() => setPlaylist(null));
  }

  useEffect(load, [id]);

  async function handleRemove(trackId) {
    try {
      await api.removeTrackFromPlaylist(id, trackId);
      load();
    } catch (err) {
      alert(err.message || 'Failed to update playlist.');
    }
  }

  async function handleDeletePlaylist() {
    await deletePlaylist(id);
    navigate('/');
  }

  if (!playlist) return <div className="page">Loading…</div>;

  return (
    <div className="page">
      <div className="page-header">
        <h1>{playlist.name}</h1>
        <button className="btn-secondary" onClick={handleDeletePlaylist}>
          Delete playlist
        </button>
      </div>
      {playlist.tracks.length > 0 && (
        <button className="btn-secondary play-all-btn" onClick={() => playTrack(playlist.tracks[0], playlist.tracks)}>
          ▶ Play all
        </button>
      )}
      <TrackList tracks={playlist.tracks} playlistId={id} onRemoveFromPlaylist={handleRemove} />
    </div>
  );
}
