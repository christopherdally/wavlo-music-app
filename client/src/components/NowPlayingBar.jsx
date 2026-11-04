import { usePlayer } from '../context/PlayerContext';

function formatTime(sec) {
  if (!sec || Number.isNaN(sec)) return '0:00';
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60)
    .toString()
    .padStart(2, '0');
  return `${m}:${s}`;
}

export default function NowPlayingBar() {
  const { current, isPlaying, togglePlay, next, prev, progress, duration, seek, volume, setVolume } = usePlayer();

  return (
    <footer className="now-playing-bar">
      <div className="np-track-info">
        {current ? (
          <>
            <div className="np-cover">
              {current.coverUrl ? <img src={current.coverUrl} alt="" /> : <div className="cover-placeholder" />}
            </div>
            <div>
              <div className="np-title">{current.title}</div>
              <div className="np-artist">{current.artist}</div>
            </div>
          </>
        ) : (
          <div className="np-artist">Nothing playing</div>
        )}
      </div>

      <div className="np-controls">
        <div className="np-buttons">
          <button className="icon-btn" onClick={prev} title="Previous">
            ⏮
          </button>
          <button className="play-btn" onClick={togglePlay} title={isPlaying ? 'Pause' : 'Play'}>
            {isPlaying ? '⏸' : '▶'}
          </button>
          <button className="icon-btn" onClick={next} title="Next">
            ⏭
          </button>
        </div>
        <div className="np-scrubber">
          <span>{formatTime(progress)}</span>
          <input
            type="range"
            min={0}
            max={duration || 0}
            value={Math.min(progress, duration || 0)}
            onChange={(e) => seek(Number(e.target.value))}
          />
          <span>{formatTime(duration)}</span>
        </div>
      </div>

      <div className="np-volume">
        <span>🔊</span>
        <input
          type="range"
          min={0}
          max={1}
          step={0.01}
          value={volume}
          onChange={(e) => setVolume(Number(e.target.value))}
        />
      </div>
    </footer>
  );
}
