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
- SMB/network share support ("link existing content", same pattern as S3): browse a configured
  NAS/Windows share (SMB2/SMB3) and link audio files as library tracks without copying them in.
  Streams on demand via the standard `smbclient`/`smbget` tools (not a JS SMB library — see
  Changed below), with a local on-first-play cache (`server/smb-cache/`) so range requests
  (scrubbing) work after the initial download. Configure via `SMB_HOST`/`SMB_SHARE`/
  `SMB_USERNAME`/`SMB_PASSWORD` (+ optional `SMB_DOMAIN`/`SMB_PORT`). The "Link from bucket"
  modal was generalized into a reusable `LinkFromRemoteModal` shared by both S3 and SMB.
- SMB cache eviction: `server/smb-cache/` is now capped (`SMB_CACHE_MAX_MB`, default 10240) with
  LRU eviction — every read touches the file's access time, and whenever a new download pushes
  the cache over the cap, the least-recently-played files are deleted (possibly several at once)
  until it's back under. Runs in the background after each download, never on the read path.
  Verified against a live Samba test server: cascading multi-file eviction and touch-on-read LRU
  refresh (a re-played older track survives eviction over a never-replayed newer one) both work
  as designed.
- `ALLOW_SIGNUP` env var (default `true`) to disable new account creation, for making a
  self-hosted instance invite-only once you've created the accounts you need. New
  `GET /api/auth/config` (public, no auth) exposes this so the frontend can hide the "Sign up"
  link/page accordingly; `POST /api/auth/register` is also rejected server-side when disabled
  (not just hidden in the UI). Existing accounts can still log in as normal.
- Bulk linking in `LinkFromRemoteModal` (both S3 and SMB, since they share it): checkboxes per
  file, a "Select all in this folder" toggle, and a "Link selected" button that links everything
  chosen in one batch with progress feedback, instead of one click per track.
- A default placeholder icon (a music note, matching the app's palette) for tracks with no
  embedded cover art, replacing the previous flat gray box.
- New **Albums** page: groups tracks by album tag when present, falling back to the source
  folder for tracks linked in from S3/SMB without one (uploads with no album tag land in a
  catch-all "Other Tracks" group). Each group shows as a card (cover art from its first tagged
  track, artist, track count); clicking opens a detail view with the usual `TrackList` and "Play
  all". Backend exposes a new `folder` field per track (derived server-side from the linked
  file's path, null for uploads) to support the fallback grouping. Verified end-to-end: album-tag
  grouping, folder-fallback grouping for untagged SMB-linked tracks, and the "Other Tracks"
  catch-all all group correctly.
- "File info" dialog (from a track's `⋯` menu): real format details — container, codec,
  bitrate, sample rate, channel count, lossless/lossy, file size, storage backend, source
  (uploaded vs. linked), the file's storage location/path, and when it was added — not just
  title/artist/album. Captured once at upload/link time (DB migration adds `file_size`,
  `bitrate`, `sample_rate`, `channels`, `codec`, `container`, `lossless` columns) so viewing it
  is instant, no re-fetch from S3/SMB needed. Verified against real MP3 (lossy) and FLAC
  (lossless) files — bitrate, sample rate, channels, and the lossless/lossy distinction all read
  back exactly as encoded — and confirmed the migration preserves existing tracks untouched when
  applied to a pre-this-feature database.

### Changed

- Evaluated `@marsaud/smb2` for the SMB feature above and dropped it: it authenticates with
  legacy NTLMv1/LM hashing, which needs OpenSSL's legacy provider to even run under modern
  Node, and is flatly rejected by real NTLMv2-only NAS/Windows/Samba servers (confirmed against
  a live Samba 4.19 test server). Implemented by shelling out to `smbclient`/`smbget` instead
  (via `execFile`/`spawn` with argument arrays, not shell strings — no injection risk), which
  handle modern SMB2/3 auth correctly out of the box.

- A previously-logged-in session is no longer force-logged-out when `/api/me` fails due to a
  network error (vs. an actual 401/403) — the cached session is kept so the app still works
  offline. User info is now cached in `localStorage` for this optimistic-offline render.

### Fixed

- A failed SMB download (e.g. file removed from the share mid-fetch, connection drop) left a
  stale 0-byte `.downloading-*` temp file behind in `server/smb-cache/` forever. Now cleaned up
  on error.
- The temp filename used while downloading an SMB file wasn't unique across concurrent requests
  for the same not-yet-cached track within one server process (used only `process.pid`, constant
  for the process); two such requests could collide writing to the same temp file. Now includes a
  random suffix per download attempt.
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
