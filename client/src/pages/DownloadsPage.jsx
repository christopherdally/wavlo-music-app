import { useEffect, useState } from 'react';
import { useOffline } from '../context/OfflineContext';
import { listDownloads } from '../offline';
import TrackList from '../components/TrackList';

export default function DownloadsPage() {
  const { downloadedIds } = useOffline();
  const [tracks, setTracks] = useState([]);

  useEffect(() => {
    let cancelled = false;
    const objectUrls = [];

    listDownloads().then((records) => {
      if (cancelled) return;
      const asTracks = records.map((r) => {
        const coverUrl = r.coverBlob ? URL.createObjectURL(r.coverBlob) : null;
        if (coverUrl) objectUrls.push(coverUrl);
        return {
          id: r.id,
          title: r.title,
          artist: r.artist,
          album: r.album,
          duration: r.duration,
          coverUrl,
          streamUrl: null,
        };
      });
      setTracks(asTracks);
    });

    return () => {
      cancelled = true;
      objectUrls.forEach((url) => URL.revokeObjectURL(url));
    };
    // Re-run whenever a download is added/removed elsewhere in the app.
  }, [downloadedIds]);

  return (
    <div className="page">
      <div className="page-header">
        <h1>Downloads</h1>
      </div>
      <p className="page-subtitle">
        Tracks you've downloaded for offline playback. They play even without a network
        connection.
      </p>
      {tracks.length === 0 ? (
        <div className="empty-state">
          Nothing downloaded yet — use the ⬇ button next to any track to save it for offline use.
        </div>
      ) : (
        <TrackList tracks={tracks} />
      )}
    </div>
  );
}
