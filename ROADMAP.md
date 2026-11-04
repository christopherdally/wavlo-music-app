# Roadmap

Ideas and planned enhancements for Wavlo, roughly ordered by how soon they're worth tackling.
Nothing here is a commitment — it's a working list. Pull requests welcome.

See `CHANGELOG.md` for what's already shipped and `ai_rules.md` for how changes get recorded.

## Near-term

- [ ] **Queue view** — see and reorder the full upcoming queue, not just next/prev.
- [ ] **"Liked songs"** — a one-click favorite, separate from manually-built playlists.
- [ ] **Recently played / play counts** — basic listening history per user.
- [ ] **Drag-and-drop upload** — drop files onto the library instead of only the file picker.
- [ ] **Folder/batch upload** — upload a whole directory (e.g. an album folder) at once.
- [ ] **Keyboard shortcuts** — space to play/pause, arrow keys to seek/skip, `/` to search.
- [ ] **Mobile-responsive layout** — the current layout assumes a desktop-width viewport.
- [ ] **Bulk tag editing** — fix mis-tagged title/artist/album for multiple tracks at once.
- [ ] **Rate limiting on auth endpoints** — basic brute-force protection on login/register.

## Mid-term

- [ ] **Fallback cover art** — fetch artwork from Cover Art Archive/MusicBrainz for tracks with
      no embedded art, instead of a blank placeholder.
- [ ] **Smart/auto playlists** — rule-based playlists (e.g. "all tracks by Artist X", "added in
      the last 30 days") instead of only manually curated ones.
- [ ] **Shareable playlist links** — read-only public link to a playlist, for sharing outside
      the app.
- [ ] **Multi-user libraries/households** — optional shared library a group of accounts can all
      see and stream from, alongside each user's private uploads.
- [ ] **Light theme** — the UI is dark-only today; add a toggle.
- [ ] **Download whole playlists/albums at once** — a single action to queue up every track in
      a playlist for offline download, instead of one at a time. Builds on the per-track
      downloads shipped in 1.1.0.
- [ ] **Offline storage usage indicator** — show how much space downloaded tracks are using
      (IndexedDB) and let users clear them, individually or all at once.
- [ ] **Background sync for downloads** — use the Background Sync API so a download started
      with a flaky connection finishes automatically once connectivity returns, instead of
      failing outright.
- [ ] **S3 migration tool** — move existing local-disk tracks to S3 (or back) from the UI instead
      of only choosing a backend at upload time.
- [ ] **SMB cache eviction** — `server/smb-cache/` (the local copy of each SMB-linked track,
      downloaded on first play) currently grows unbounded. Add an LRU eviction policy or a size
      cap/TTL.
- [ ] **Automated tests + CI** — unit tests for the API, a basic e2e smoke test, and a GitHub
      Actions workflow that runs them on PRs.

## Long-term / exploratory

- [ ] **Podcast/audiobook support** — chapters, playback-position resume, separate from music.
- [ ] **Gapless playback & crossfade**.
- [ ] **Lyrics display** — synced or static, from embedded tags or an external source.
- [ ] **Scrobbling** — Last.fm/ListenBrainz integration.
- [ ] **Audio transcoding on the fly** — serve a lower-bitrate stream to save bandwidth on
      mobile/cellular, keep the original for download.
- [ ] **OAuth login** — sign in with Google/GitHub in addition to email/password.
- [ ] **Audio visualizer** on the now-playing bar.
- [ ] **Admin/usage dashboard** — storage used (local vs. S3), per-user library size.
- [ ] **Native desktop app (Electron)** — a separate packaged .exe/.dmg/.AppImage build, for
      users who want a dedicated app over the installable PWA shipped in 1.1.0.

## Known limitations (not yet roadmapped)

- No automated test suite yet (see CI item above).
- `/api/tracks/:id/stream` and `/api/tracks/:id/cover` are unauthenticated by design (so
  `<audio>`/`<img>` tags can hit them directly without custom headers) — track IDs are UUIDs,
  but this means anyone with a track's stream URL can play it without logging in. Worth
  revisiting with signed, expiring URLs if the app is ever exposed beyond trusted users.
