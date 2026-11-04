import { useEffect, useState } from 'react';
import { useLibrary } from '../context/LibraryContext';
import TrackList from '../components/TrackList';

const SHELF_SIZE = 10;

function shuffle(array) {
  const copy = [...array];
  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
}

export default function DiscoverPage() {
  const { tracks } = useLibrary();
  const [randomPicks, setRandomPicks] = useState([]);

  useEffect(() => {
    setRandomPicks(shuffle(tracks).slice(0, SHELF_SIZE));
    // Re-shuffle whenever the library itself changes (new upload/link), not
    // on every render — reshuffling is otherwise manual via the button below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tracks.length]);

  if (tracks.length === 0) {
    return (
      <div className="page">
        <div className="page-header">
          <h1>Discover</h1>
        </div>
        <div className="empty-state">Upload or link some tracks to see them surfaced here.</div>
      </div>
    );
  }

  const recentlyAdded = [...tracks].sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt)).slice(0, SHELF_SIZE);

  const mostPlayed = [...tracks]
    .filter((t) => t.playCount > 0)
    .sort((a, b) => b.playCount - a.playCount)
    .slice(0, SHELF_SIZE);

  const notPlayedInAWhile = [...tracks]
    .sort((a, b) => {
      // Never-played tracks count as "longest ago" — exactly the kind of
      // thing a "rediscover" shelf should surface.
      const at = a.lastPlayedAt ? new Date(a.lastPlayedAt).getTime() : 0;
      const bt = b.lastPlayedAt ? new Date(b.lastPlayedAt).getTime() : 0;
      return at - bt;
    })
    .slice(0, SHELF_SIZE);

  return (
    <div className="page">
      <div className="page-header">
        <h1>Discover</h1>
      </div>
      <p className="page-subtitle">Different slices of your own library — no outside catalog involved.</p>

      <section className="discover-shelf">
        <h2 className="discover-shelf-title">Recently added</h2>
        <TrackList tracks={recentlyAdded} />
      </section>

      <section className="discover-shelf">
        <div className="discover-shelf-header">
          <h2 className="discover-shelf-title">Random picks</h2>
          <button className="btn-secondary" onClick={() => setRandomPicks(shuffle(tracks).slice(0, SHELF_SIZE))}>
            Shuffle again
          </button>
        </div>
        <TrackList tracks={randomPicks} />
      </section>

      <section className="discover-shelf">
        <h2 className="discover-shelf-title">Most played</h2>
        {mostPlayed.length === 0 ? (
          <div className="empty-state">Play some tracks and they'll show up here.</div>
        ) : (
          <TrackList tracks={mostPlayed} />
        )}
      </section>

      <section className="discover-shelf">
        <h2 className="discover-shelf-title">Haven't heard in a while</h2>
        <TrackList tracks={notPlayedInAWhile} />
      </section>
    </div>
  );
}
