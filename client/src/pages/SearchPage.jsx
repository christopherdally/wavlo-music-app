import { useEffect, useState } from 'react';
import { api } from '../api';
import TrackList from '../components/TrackList';

export default function SearchPage() {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState([]);

  useEffect(() => {
    if (!query.trim()) {
      setResults([]);
      return;
    }
    const handle = setTimeout(() => {
      api.searchTracks(query).then(setResults).catch(() => setResults([]));
    }, 250);
    return () => clearTimeout(handle);
  }, [query]);

  return (
    <div className="page">
      <div className="page-header">
        <h1>Search</h1>
      </div>
      <input
        className="search-input"
        placeholder="Search your library by title, artist, or album"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        autoFocus
      />
      {query.trim() && <TrackList tracks={results} />}
    </div>
  );
}
