import { Navigate, Route, Routes } from 'react-router-dom';
import { AuthProvider, useAuth } from './context/AuthContext';
import { PlayerProvider } from './context/PlayerContext';
import { LibraryProvider } from './context/LibraryContext';
import { OfflineProvider } from './context/OfflineContext';
import Login from './pages/Login';
import Register from './pages/Register';
import Shell from './components/Shell';
import Library from './pages/Library';
import SearchPage from './pages/SearchPage';
import PlaylistPage from './pages/PlaylistPage';
import DownloadsPage from './pages/DownloadsPage';
import AlbumsPage from './pages/AlbumsPage';

function PrivateArea() {
  const { user, loading } = useAuth();
  if (loading) return <div className="full-center">Loading…</div>;
  if (!user) return <Navigate to="/login" replace />;

  return (
    <OfflineProvider>
      <LibraryProvider>
        <PlayerProvider>
          <Shell>
            <Routes>
              <Route path="/" element={<Library />} />
              <Route path="/albums" element={<AlbumsPage />} />
              <Route path="/search" element={<SearchPage />} />
              <Route path="/downloads" element={<DownloadsPage />} />
              <Route path="/playlist/:id" element={<PlaylistPage />} />
              <Route path="*" element={<Navigate to="/" replace />} />
            </Routes>
          </Shell>
        </PlayerProvider>
      </LibraryProvider>
    </OfflineProvider>
  );
}

export default function App() {
  return (
    <AuthProvider>
      <Routes>
        <Route path="/login" element={<Login />} />
        <Route path="/register" element={<Register />} />
        <Route path="/*" element={<PrivateArea />} />
      </Routes>
    </AuthProvider>
  );
}
