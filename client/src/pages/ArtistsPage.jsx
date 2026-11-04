import { useEffect, useMemo, useState } from 'react';
import { useLibrary } from '../context/LibraryContext';
import { usePlayer } from '../context/PlayerContext';
import { api } from '../api';
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

function readFileAsDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

function ArtistDetail({ group, onBack, onPlayAll }) {
  const [info, setInfo] = useState(null);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState(false);
  const [bioDraft, setBioDraft] = useState('');
  const [photoDraft, setPhotoDraft] = useState(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    setLoading(true);
    api
      .getArtistInfo(group.key)
      .then((result) => {
        setInfo(result);
        setBioDraft(result.bio || '');
        setPhotoDraft(result.photoUrl || null);
      })
      .catch(() => setInfo({ bio: null, photoUrl: null, source: null }))
      .finally(() => setLoading(false));
  }, [group.key]);

  async function handlePhotoChosen(e) {
    const file = e.target.files?.[0];
    if (!file) return;
    setPhotoDraft(await readFileAsDataUrl(file));
  }

  async function handleSave() {
    setSaving(true);
    try {
      const result = await api.updateArtistInfo(group.key, { bio: bioDraft.trim(), photoUrl: photoDraft });
      setInfo(result);
      setEditing(false);
    } catch (err) {
      alert(err.message || 'Failed to save artist info.');
    } finally {
      setSaving(false);
    }
  }

  async function handleResetToAuto() {
    setSaving(true);
    try {
      await api.resetArtistInfo(group.key);
      const result = await api.getArtistInfo(group.key, { refresh: true });
      setInfo(result);
      setBioDraft(result.bio || '');
      setPhotoDraft(result.photoUrl || null);
      setEditing(false);
    } catch (err) {
      alert(err.message || 'Failed to reset artist info.');
    } finally {
      setSaving(false);
    }
  }

  const photoUrl = info?.photoUrl || groupCoverUrl(group);

  return (
    <div className="page">
      <div className="page-header">
        <div className="album-detail-heading">
          <button className="icon-btn" onClick={onBack} title="Back to artists">
            ← Artists
          </button>
          <h1>{group.label}</h1>
        </div>
      </div>

      <div className="artist-profile">
        <div className="artist-photo">
          {photoUrl ? <img src={photoUrl} alt="" /> : <div className="cover-placeholder" />}
        </div>
        <div className="artist-bio-block">
          {editing ? (
            <>
              <textarea
                className="artist-bio-input"
                rows={5}
                placeholder="Write something about this artist…"
                value={bioDraft}
                onChange={(e) => setBioDraft(e.target.value)}
              />
              <label className="btn-secondary artist-photo-upload">
                Choose photo
                <input type="file" accept="image/*" hidden onChange={handlePhotoChosen} />
              </label>
              <div className="artist-edit-actions">
                <button className="btn-primary" onClick={handleSave} disabled={saving}>
                  {saving ? 'Saving…' : 'Save'}
                </button>
                <button className="btn-secondary" onClick={() => setEditing(false)} disabled={saving}>
                  Cancel
                </button>
                {info?.source === 'manual' && (
                  <button className="link-btn" onClick={handleResetToAuto} disabled={saving}>
                    Reset to Wikipedia
                  </button>
                )}
              </div>
            </>
          ) : (
            <>
              {loading ? (
                <p className="page-subtitle">Looking up artist info…</p>
              ) : info?.bio ? (
                <p className="artist-bio-text">{info.bio}</p>
              ) : (
                <p className="page-subtitle">No bio found for this artist yet.</p>
              )}
              <div className="artist-edit-actions">
                <button className="btn-secondary" onClick={() => setEditing(true)}>
                  Edit info
                </button>
                {info?.source && <span className="artist-info-source">via {info.source}</span>}
              </div>
            </>
          )}
        </div>
      </div>

      <p className="page-subtitle">
        {group.tracks.length} track{group.tracks.length === 1 ? '' : 's'}
      </p>
      <button className="btn-secondary play-all-btn" onClick={onPlayAll}>
        ▶ Play all
      </button>
      <TrackList tracks={group.tracks} />
    </div>
  );
}

export default function ArtistsPage() {
  const { tracks } = useLibrary();
  const { playTrack } = usePlayer();
  const [selectedKey, setSelectedKey] = useState(null);

  const groups = useMemo(() => groupByArtist(tracks), [tracks]);
  const selected = groups.find((g) => g.key === selectedKey);

  if (selected) {
    return (
      <ArtistDetail
        group={selected}
        onBack={() => setSelectedKey(null)}
        onPlayAll={() => playTrack(selected.tracks[0], selected.tracks)}
      />
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
