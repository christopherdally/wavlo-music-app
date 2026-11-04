import { createContext, useCallback, useContext, useEffect, useState } from 'react';
import * as offline from '../offline';

const OfflineContext = createContext(null);

export function OfflineProvider({ children }) {
  const [downloadedIds, setDownloadedIds] = useState(new Set());
  const [pendingIds, setPendingIds] = useState(new Set());
  const [isOnline, setIsOnline] = useState(navigator.onLine);

  const refreshDownloadedIds = useCallback(() => {
    offline
      .listDownloadedIds()
      .then((ids) => setDownloadedIds(new Set(ids)))
      .catch(() => {});
  }, []);

  useEffect(() => {
    refreshDownloadedIds();
  }, [refreshDownloadedIds]);

  useEffect(() => {
    const onOnline = () => setIsOnline(true);
    const onOffline = () => setIsOnline(false);
    window.addEventListener('online', onOnline);
    window.addEventListener('offline', onOffline);
    return () => {
      window.removeEventListener('online', onOnline);
      window.removeEventListener('offline', onOffline);
    };
  }, []);

  async function downloadTrack(track) {
    setPendingIds((prev) => new Set(prev).add(track.id));
    try {
      await offline.downloadTrack(track);
      refreshDownloadedIds();
    } finally {
      setPendingIds((prev) => {
        const next = new Set(prev);
        next.delete(track.id);
        return next;
      });
    }
  }

  async function removeDownload(id) {
    await offline.removeDownload(id);
    refreshDownloadedIds();
  }

  return (
    <OfflineContext.Provider
      value={{ isOnline, downloadedIds, pendingIds, downloadTrack, removeDownload, refreshDownloadedIds }}
    >
      {children}
    </OfflineContext.Provider>
  );
}

export function useOffline() {
  return useContext(OfflineContext);
}
