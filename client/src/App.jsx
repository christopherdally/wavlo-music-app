import { Navigate, Route, Routes } from 'react-router-dom';
import { AuthProvider, useAuth } from './context/AuthContext';
import { PlayerProvider } from './context/PlayerContext';
import { LibraryProvider } from './context/LibraryContext';
import Login from './pages/Login';
import Register from './pages/Register';
import Shell from './components/Shell';
import Library from './pages/Library';
import SearchPage from './pages/SearchPage';
import PlaylistPage from './pages/PlaylistPage';

function PrivateArea() {
  const { user, loading } = useAuth();
  if (loading) return <div className="full-center">Loading…</div>;
  if (!user) return <Navigate to="/login" replace />;

  return (
    <LibraryProvider>
      <PlayerProvider>
        <Shell>
          <Routes>
            <Route path="/" element={<Library />} />
            <Route path="/search" element={<SearchPage />} />
            <Route path="/playlist/:id" element={<PlaylistPage />} />
            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
        </Shell>
      </PlayerProvider>
    </LibraryProvider>
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
