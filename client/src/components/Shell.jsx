import { useState } from 'react';
import { NavLink, useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { useLibrary } from '../context/LibraryContext';
import { useOffline } from '../context/OfflineContext';
import NowPlayingBar from './NowPlayingBar';
import { version as appVersion } from '../../package.json';

export default function Shell({ children }) {
  const { user, logout } = useAuth();
  const { playlists, createPlaylist } = useLibrary();
  const { isOnline } = useOffline();
  const navigate = useNavigate();
  const [creating, setCreating] = useState(false);
  const [newName, setNewName] = useState('');

  async function onCreatePlaylist(e) {
    e.preventDefault();
    if (!newName.trim()) return;
    const playlist = await createPlaylist(newName.trim());
    setNewName('');
    setCreating(false);
    navigate(`/playlist/${playlist.id}`);
  }

  return (
    <div className="shell">
      <aside className="sidebar">
        <div className="brand-row">
          <div className="brand">Wavlo</div>
          {!isOnline && <span className="offline-badge">Offline</span>}
        </div>
        <nav className="nav-links">
          <NavLink to="/" end>
            Home
          </NavLink>
          <NavLink to="/albums">Albums</NavLink>
          <NavLink to="/search">Search</NavLink>
          <NavLink to="/downloads">Downloads</NavLink>
        </nav>
        <div className="sidebar-playlists-header">
          <span>Playlists</span>
          <button className="icon-btn" title="New playlist" onClick={() => setCreating((c) => !c)}>
            +
          </button>
        </div>
        {creating && (
          <form className="new-playlist-form" onSubmit={onCreatePlaylist}>
            <input
              autoFocus
              placeholder="Playlist name"
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
            />
          </form>
        )}
        <div className="sidebar-playlists">
          {playlists.map((p) => (
            <NavLink key={p.id} to={`/playlist/${p.id}`} className="sidebar-playlist-link">
              {p.name}
            </NavLink>
          ))}
        </div>
        <div className="sidebar-footer">
          <div className="user-chip">{user?.displayName}</div>
          <button className="link-btn" onClick={logout}>
            Log out
          </button>
          <div className="app-version">Wavlo v{appVersion}</div>
        </div>
      </aside>
      <main className="main-view">{children}</main>
      <NowPlayingBar />
    </div>
  );
}
