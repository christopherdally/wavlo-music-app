import { useMemo, useState } from 'react';
import { useLibrary } from '../context/LibraryContext';
import { usePlayer } from '../context/PlayerContext';
import TrackList from '../components/TrackList';

function groupByArtist(tracks) {
  const groups = new Map();
  for (const track of tracks) {
    const key = track.artist || 'Unknown Artist';
    if (!groups.has(key)) groups.set(key, { key, label: key, tracks: [] });
    groups.get(key).tracks.push(track);
  }
  return [...groups.values()].sort((a, b) => a.label.localeCompare(b.label));
}

function groupCoverUrl(group) {
  return group.tracks.find((t) => t.coverUrl)?.coverUrl || null;
}

export default function ArtistsPage() {
  const { tracks } = useLibrary();
  const { playTrack } = usePlayer();
  const [selectedKey, setSelectedKey] = useState(null);

  const groups = useMemo(() => groupByArtist(tracks), [tracks]);
  const selected = groups.find((g) => g.key === selectedKey);

  if (selected) {
    return (
      <div className="page">
        <div className="page-header">
          <div className="album-detail-heading">
            <button className="icon-btn" onClick={() => setSelectedKey(null)} title="Back to artists">
              ← Artists
            </button>
            <h1>{selected.label}</h1>
          </div>
        </div>
        <p className="page-subtitle">
          {selected.tracks.length} track{selected.tracks.length === 1 ? '' : 's'}
        </p>
        <button className="btn-secondary play-all-btn" onClick={() => playTrack(selected.tracks[0], selected.tracks)}>
          ▶ Play all
        </button>
        <TrackList tracks={selected.tracks} />
      </div>
    );
  }

  return (
    <div className="page">
      <div className="page-header">
        <h1>Artists</h1>
      </div>
      {groups.length === 0 ? (
        <div className="empty-state">No artists yet — upload or link some tracks first.</div>
      ) : (
        <div className="album-grid">
          {groups.map((group) => (
            <div key={group.key} className="album-card" onClick={() => setSelectedKey(group.key)}>
              <div className="album-card-cover">
                {groupCoverUrl(group) ? (
                  <img src={groupCoverUrl(group)} alt="" />
                ) : (
                  <div className="cover-placeholder" />
                )}
              </div>
              <div className="album-card-label">{group.label}</div>
              <div className="album-card-subtitle">
                {group.tracks.length} track{group.tracks.length === 1 ? '' : 's'}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
