import { createContext, useContext, useEffect, useRef, useState } from 'react';
import { getDownload } from '../offline';
import { api } from '../api';
import { useLibrary } from './LibraryContext';

const PlayerContext = createContext(null);

export function PlayerProvider({ children }) {
  const { refreshTracks } = useLibrary();
  const audioRef = useRef(new Audio());
  const [queue, setQueue] = useState([]);
  const [index, setIndex] = useState(-1);
  const [isPlaying, setIsPlaying] = useState(false);
  const [progress, setProgress] = useState(0);
  const [duration, setDuration] = useState(0);
  const [volume, setVolume] = useState(0.8);

  const current = index >= 0 && index < queue.length ? queue[index] : null;

  useEffect(() => {
    const audio = audioRef.current;
    const onTime = () => setProgress(audio.currentTime);
    const onDuration = () => setDuration(audio.duration || 0);
    const onEnded = () => next();
    audio.addEventListener('timeupdate', onTime);
    audio.addEventListener('loadedmetadata', onDuration);
    audio.addEventListener('ended', onEnded);
    return () => {
      audio.removeEventListener('timeupdate', onTime);
      audio.removeEventListener('loadedmetadata', onDuration);
      audio.removeEventListener('ended', onEnded);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [queue, index]);

  useEffect(() => {
    audioRef.current.volume = volume;
  }, [volume]);

  useEffect(() => {
    if (!current) return;
    const audio = audioRef.current;
    let cancelled = false;
    let objectUrl = null;

    (async () => {
      // Play from the locally-downloaded copy when we have one — works
      // offline, and skips re-streaming a track we already have.
      let src = current.streamUrl;
      try {
        const offlineTrack = await getDownload(current.id);
        if (offlineTrack?.audioBlob) {
          objectUrl = URL.createObjectURL(offlineTrack.audioBlob);
          src = objectUrl;
        }
      } catch {
        // IndexedDB unavailable or lookup failed — fall back to streaming.
      }
      if (cancelled) return;
      audio.src = src;
      audio.play().then(() => setIsPlaying(true)).catch(() => setIsPlaying(false));
      // Fire-and-forget: powers the Discover page's play-count/recency
      // shelves. Refresh the shared track list afterward so the updated
      // playCount/lastPlayedAt are visible without a page reload. Fine if
      // this fails (offline, etc.) — just means this particular play isn't
      // counted.
      api.recordPlay(current.id).then(refreshTracks).catch(() => {});
    })();

    return () => {
      cancelled = true;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [current?.id]);

  function playTrack(track, trackList) {
    const list = trackList || [track];
    const i = list.findIndex((t) => t.id === track.id);
    setQueue(list);
    setIndex(i >= 0 ? i : 0);
  }

  function togglePlay() {
    const audio = audioRef.current;
    if (!current) return;
    if (audio.paused) {
      audio.play();
      setIsPlaying(true);
    } else {
      audio.pause();
      setIsPlaying(false);
    }
  }

  function next() {
    if (queue.length === 0) return;
    setIndex((i) => (i + 1) % queue.length);
  }

  function prev() {
    if (queue.length === 0) return;
    if (audioRef.current.currentTime > 3) {
      audioRef.current.currentTime = 0;
      return;
    }
    setIndex((i) => (i - 1 + queue.length) % queue.length);
  }

  function seek(time) {
    audioRef.current.currentTime = time;
    setProgress(time);
  }

  return (
    <PlayerContext.Provider
      value={{
        current,
        queue,
        isPlaying,
        progress,
        duration,
        volume,
        setVolume,
        playTrack,
        togglePlay,
        next,
        prev,
        seek,
      }}
    >
      {children}
    </PlayerContext.Provider>
  );
}

export function usePlayer() {
  return useContext(PlayerContext);
}
