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
- Installable PWA: web app manifest + service worker (via `vite-plugin-pwa`) precache the app
  shell, so Wavlo can be installed to the home screen/desktop and the UI itself loads even
  with no network connection.
- Offline track downloads: a per-track "download for offline" button stores the audio (and
  cover art) in IndexedDB; playback automatically uses the local copy when available, online
  or off. New **Downloads** page lists everything downloaded and works fully offline, since it
  reads from IndexedDB rather than the API.
- Sidebar shows an "Offline" badge when the browser has no network connection.

### Changed

- A previously-logged-in session is no longer force-logged-out when `/api/me` fails due to a
  network error (vs. an actual 401/403) — the cached session is kept so the app still works
  offline. User info is now cached in `localStorage` for this optimistic-offline render.

### Fixed

- Docker builds (both `server/Dockerfile` and the root single-container `Dockerfile`) failed
  on `npm ci` with a `node-gyp`/`better-sqlite3` compile error on platforms/architectures with
  no matching prebuilt binary (seen on a Dokploy build). The `node:20-alpine` base image has no
  C/C++ toolchain by default; both Dockerfiles now install `python3 make g++` in a dedicated
  build stage before `npm ci`, and copy only the resulting `node_modules` into the final image
  so the toolchain doesn't bloat the runtime image.
- Container crashed on startup with no error output (exit 139 / SIGSEGV) after the `python3
  make g++` fix above got the build itself passing (seen on a live Dokploy deploy). Root cause:
  `better-sqlite3@13.0.3` (and a few of its transitive deps) require Node.js **22+**; the
  Dockerfiles were still on `node:20-alpine`, so the native addon loaded under an incompatible
  Node ABI and segfaulted instead of failing with a catchable error. All three Dockerfiles
  (`server/Dockerfile`, root `Dockerfile`, `client/Dockerfile`) now use `node:22-alpine`, and
  `server/package.json` declares `"engines": { "node": ">=22" }` so this surfaces loudly in
  local dev too, not just in production.
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
