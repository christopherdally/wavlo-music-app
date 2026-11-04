function formatDuration(sec) {
  if (!sec) return '—';
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60)
    .toString()
    .padStart(2, '0');
  return `${m}:${s}`;
}

function formatBytes(bytes) {
  if (!bytes) return '—';
  const mb = bytes / (1024 * 1024);
  return mb >= 1 ? `${mb.toFixed(2)} MB` : `${Math.round(bytes / 1024)} KB`;
}

function formatChannels(n) {
  if (!n) return '—';
  if (n === 1) return 'Mono';
  if (n === 2) return 'Stereo';
  return `${n} channels`;
}

const STORAGE_LABELS = { local: 'Local disk', s3: 'S3 bucket', smb: 'SMB share' };
const SOURCE_LABELS = { uploaded: 'Uploaded', linked: 'Linked (not copied)' };

export default function TrackInfoModal({ track, onClose }) {
  const info = track.fileInfo || {};

  const rows = [
    ['Title', track.title],
    ['Artist', track.artist],
    ['Album', track.album || '—'],
    ['Duration', formatDuration(track.duration)],
    ['File size', formatBytes(info.fileSize)],
    ['Format', info.container || '—'],
    ['Codec', info.codec || '—'],
    ['Bitrate', info.bitrate ? `${Math.round(info.bitrate / 1000)} kbps` : '—'],
    ['Sample rate', info.sampleRate ? `${(info.sampleRate / 1000).toFixed(1)} kHz` : '—'],
    ['Channels', formatChannels(info.channels)],
    ['Quality', info.lossless == null ? '—' : info.lossless ? 'Lossless' : 'Lossy'],
    ['Storage', STORAGE_LABELS[track.storage] || track.storage],
    ['Source', SOURCE_LABELS[track.source] || track.source],
  ];
  if (track.location) rows.push(['Location', track.location]);
  rows.push(['Added', track.createdAt ? new Date(track.createdAt.replace(' ', 'T') + 'Z').toLocaleString() : '—']);

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h2>File info</h2>
          <button className="icon-btn" onClick={onClose}>
            ✕
          </button>
        </div>
        <div className="file-info-grid">
          {rows.map(([label, value]) => (
            <div key={label} className="file-info-row">
              <span className="file-info-label">{label}</span>
              <span className="file-info-value">{value}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
