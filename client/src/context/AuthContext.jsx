import { createContext, useContext, useEffect, useState } from 'react';
import { api } from '../api';

const AuthContext = createContext(null);

function cacheUser(user) {
  localStorage.setItem('user', JSON.stringify(user));
}

function readCachedUser() {
  try {
    const raw = localStorage.getItem('user');
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

export function AuthProvider({ children }) {
  const [user, setUser] = useState(readCachedUser);
  // Skip the blocking loading screen if we already have a cached session —
  // render optimistically and revalidate with the server in the background.
  const [loading, setLoading] = useState(() => !readCachedUser());

  useEffect(() => {
    const token = localStorage.getItem('token');
    if (!token) {
      setLoading(false);
      return;
    }
    api
      .me()
      .then((freshUser) => {
        setUser(freshUser);
        cacheUser(freshUser);
      })
      .catch((err) => {
        // Only an actual auth rejection (expired/invalid token) should log the
        // user out. A network error (offline, server unreachable) should not —
        // keep the cached session so the app shell still works offline.
        if (err.status === 401 || err.status === 403) {
          localStorage.removeItem('token');
          localStorage.removeItem('user');
          setUser(null);
        }
      })
      .finally(() => setLoading(false));
  }, []);

  async function login(email, password) {
    const { token, user } = await api.login(email, password);
    localStorage.setItem('token', token);
    cacheUser(user);
    setUser(user);
  }

  async function register(email, password, displayName) {
    const { token, user } = await api.register(email, password, displayName);
    localStorage.setItem('token', token);
    cacheUser(user);
    setUser(user);
  }

  function logout() {
    localStorage.removeItem('token');
    localStorage.removeItem('user');
    setUser(null);
  }

  return (
    <AuthContext.Provider value={{ user, loading, login, register, logout }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  return useContext(AuthContext);
}
