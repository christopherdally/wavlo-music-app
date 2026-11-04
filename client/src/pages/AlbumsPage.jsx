import { useMemo, useState } from 'react';
import { useLibrary } from '../context/LibraryContext';
import { usePlayer } from '../context/PlayerContext';
import TrackList from '../components/TrackList';

// Groups tracks by album tag first, falling back to the folder they were
// linked from (S3/SMB "link existing content" only — uploads have no
// meaningful folder). Tracks with neither land in one catch-all group.
function groupTracks(tracks) {
  const groups = new Map();
  const ungrouped = [];

  for (const track of tracks) {
    let key;
    let label;
    if (track.album) {
      key = `album:${track.album}`;
      label = track.album;
    } else if (track.folder) {
      key = `folder:${track.folder}`;
      label = track.folder.split('/').filter(Boolean).pop() || track.folder;
    } else {
      ungrouped.push(track);
      continue;
    }
    if (!groups.has(key)) groups.set(key, { key, label, tracks: [] });
    groups.get(key).tracks.push(track);
  }

  const result = [...groups.values()].sort((a, b) => a.label.localeCompare(b.label));
  if (ungrouped.length > 0) {
    result.push({ key: 'ungrouped', label: 'Other Tracks', tracks: ungrouped });
  }
  return result;
}

function groupArtist(group) {
  const artists = new Set(group.tracks.map((t) => t.artist).filter(Boolean));
  if (artists.size === 1) return [...artists][0];
  return 'Various Artists';
}

function groupCoverUrl(group) {
  return group.tracks.find((t) => t.coverUrl)?.coverUrl || null;
}

export default function AlbumsPage() {
  const { tracks } = useLibrary();
  const { playTrack } = usePlayer();
  const [selectedKey, setSelectedKey] = useState(null);

  const groups = useMemo(() => groupTracks(tracks), [tracks]);
  const selected = groups.find((g) => g.key === selectedKey);

  if (selected) {
    return (
      <div className="page">
        <div className="page-header">
          <div className="album-detail-heading">
            <button className="icon-btn" onClick={() => setSelectedKey(null)} title="Back to albums">
              ← Albums
            </button>
            <h1>{selected.label}</h1>
          </div>
        </div>
        <p className="page-subtitle">
          {groupArtist(selected)} · {selected.tracks.length} track{selected.tracks.length === 1 ? '' : 's'}
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
        <h1>Albums</h1>
      </div>
      {groups.length === 0 ? (
        <div className="empty-state">
          No albums yet. Tracks group here once they share an album tag, or were linked in from the
          same S3/SMB folder.
        </div>
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
                {groupArtist(group)} · {group.tracks.length} track{group.tracks.length === 1 ? '' : 's'}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
