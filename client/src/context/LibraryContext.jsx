import { createContext, useCallback, useContext, useEffect, useState } from 'react';
import { api } from '../api';

const LibraryContext = createContext(null);

export function LibraryProvider({ children }) {
  const [tracks, setTracks] = useState([]);
  const [playlists, setPlaylists] = useState([]);

  const refreshTracks = useCallback(() => {
    api.getTracks().then(setTracks).catch(() => {});
  }, []);

  const refreshPlaylists = useCallback(() => {
    api.getPlaylists().then(setPlaylists).catch(() => {});
  }, []);

  useEffect(() => {
    refreshTracks();
    refreshPlaylists();
  }, [refreshTracks, refreshPlaylists]);

  async function createPlaylist(name) {
    const playlist = await api.createPlaylist(name);
    refreshPlaylists();
    return playlist;
  }

  async function deletePlaylist(id) {
    await api.deletePlaylist(id);
    refreshPlaylists();
  }

  async function deleteTrack(id) {
    await api.deleteTrack(id);
    refreshTracks();
  }

  return (
    <LibraryContext.Provider
      value={{ tracks, playlists, refreshTracks, refreshPlaylists, createPlaylist, deletePlaylist, deleteTrack }}
    >
      {children}
    </LibraryContext.Provider>
  );
}

export function useLibrary() {
  return useContext(LibraryContext);
}
