# Changelog

All notable changes to Wavlo are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project follows [Semantic Versioning](https://semver.org/).

See `ai_rules.md` for how and when entries here should be added.

## [1.1.0] - 2026-11-04

### Added

- `CHANGELOG.md` and `ai_rules.md` establishing the versioning/changelog workflow for future
  changes.
- App version number displayed in the sidebar footer, sourced from `client/package.json`.
- Docker deployment: `server/Dockerfile`, `client/Dockerfile` (+ nginx config), and a root
  `docker-compose.yml` for running the full stack (and for one-click deploys on Dokploy).
- MIT `LICENSE`.
- `ROADMAP.md` listing planned enhancements and known limitations.
- Single-container deployment: root `Dockerfile` builds the React app and has the Express
  server serve it directly (static files + SPA routing) alongside the API, so the whole app
  runs from one process/port with no compose file needed. Documented as "Option A" in the
  README, alongside the existing two-container `docker-compose.yml` setup ("Option B").

### Fixed

- Server failed to start on a fresh clone because `server/db/` (gitignored, holds the SQLite
  file) didn't exist yet; `db.js` now creates it automatically, same as the uploads directory.
- The SPA-fallback route for the single-container build used Express 5's now-removed bare `'*'`
  wildcard syntax, which threw on startup; replaced with a plain catch-all middleware.

## [1.0.0] - 2026-11-03

### Added

- Initial release of Wavlo, a self-hosted Spotify-style music player.
- Account system with JWT-based auth (register/login).
- Upload audio files (mp3/flac/wav/ogg/m4a/aac) with automatic ID3 tag and cover art extraction.
- Personal library with search across title/artist/album.
- Playlists: create, rename, delete, add/remove tracks.
- Streaming playback with HTTP range-request support (seekable scrubber), play/pause/next/prev,
  volume control, and a persistent now-playing bar.
- Spotify-inspired dark UI: sidebar navigation, library/playlist views, now-playing bar.
- Optional S3 (or S3-compatible) storage backend:
  - `STORAGE_DRIVER=s3` to send new uploads directly to a bucket instead of local disk.
  - "Link from bucket" — browse an existing S3 bucket and register already-uploaded audio files
    as library tracks without re-uploading them.
