# Wavlo

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)

A self-hosted Spotify-style music player. Upload your own audio files, organize them into
playlists, search your library, and stream with a Spotify-inspired dark UI (sidebar, library
grid, scrubbing now-playing bar). An **Albums** page automatically groups tracks that share an
album tag — or, for tracks linked in from S3/SMB, that came from the same source folder — without
any manual organizing, plus an **Artists** page grouping the same way by artist. Each track's
"File info" (from its `⋯` menu) shows real format details — codec, bitrate, sample rate,
channels, lossless/lossy, file size — not just title/artist/album. A **Discover** page surfaces
different slices of your own library — recently added, random picks, most played, and tracks you
haven't heard in a while — no external catalog involved, since this is a personal library, not a
streaming service.

## Stack

- **Backend**: Express + better-sqlite3, JWT auth, Multer uploads, `music-metadata` for ID3/tag
  extraction (title/artist/album/cover art), HTTP range-request streaming.
- **Frontend**: React (Vite) + React Router, dark theme CSS modeled on Spotify's layout
  (sidebar nav + playlists, top content area, persistent now-playing bar with scrubber/volume).

## Running locally

Requires **Node.js 22+** (the backend's dependencies, including `better-sqlite3`'s native
addon, require it — running on Node 20 or older will fail at runtime, not just with a warning).

```bash
# Terminal 1 — backend (port 4000)
cd server
npm install
node index.js

# Terminal 2 — frontend (port 5173, proxies /api to the backend)
cd client
npm install
npm run dev
```

Open http://localhost:5173, sign up, and upload some audio files (mp3/flac/wav/ogg/m4a/aac) to
get started.

## S3 storage (optional)

By default, uploads are stored on local disk at `server/uploads/`. You can plug in an S3
(or S3-compatible, e.g. MinIO/R2) bucket for two independent things:

1. **Where new uploads go.** Set `STORAGE_DRIVER=s3` to send new uploads straight to the bucket
   instead of local disk. Leave it unset (or `local`) to keep using local disk — this works out
   of the box with no AWS setup.
2. **Linking existing content.** Whenever S3 credentials are configured (regardless of
   `STORAGE_DRIVER`), a "Link from bucket" button appears in the library. It browses your bucket
   like a file manager and lets you register an existing audio file as a track without
   re-uploading it — one at a time, or select several (or an entire folder via "Select all") and
   link them in one batch. Deleting a linked track only removes it from your library — the object
   stays in your bucket, since you don't necessarily own the only copy of it.

Configure via `server/.env`:

```bash
AWS_S3_BUCKET=your-bucket-name
AWS_REGION=us-east-1
AWS_ACCESS_KEY_ID=...
AWS_SECRET_ACCESS_KEY=...
# Optional: point at an S3-compatible endpoint (MinIO, Cloudflare R2, etc.)
# AWS_S3_ENDPOINT=https://<account-id>.r2.cloudflarestorage.com

# Optional: send new uploads to S3 instead of local disk (default: local)
STORAGE_DRIVER=s3
```

If `AWS_ACCESS_KEY_ID`/`AWS_SECRET_ACCESS_KEY` are omitted, the AWS SDK falls back to its default
credential chain (instance role, shared credentials file, etc.) — useful when running on EC2/ECS.

## SMB / network share (optional)

Like the S3 integration, this is "link existing content" only — tracks are streamed on demand
straight from the share, never copied onto the server. Works with a modern NAS (Synology, QNAP,
TrueNAS, etc.) or a Windows file share (SMB2/SMB3). Older SMB1-only devices aren't supported.

Once configured, a "Link from SMB share" button appears in the library, letting you browse the
share's folders and link audio files the same way as the S3 bucket browser — including bulk
selection (an entire folder at once via "Select all").

Under the hood this shells out to the standard `smbclient`/`smbget` tools (from Samba's client
package), not a JS SMB library — those turned out to be unreliable against real NTLMv2-only
servers in testing. The Dockerfiles already install this via `apk add samba-client`; for local
(non-Docker) dev, install it yourself: `apt install smbclient` (Debian/Ubuntu),
`brew install samba` (macOS), etc. The feature is simply unavailable (not a crash) if these
binaries aren't found and `SMB_*` is unset.

The first play of an SMB-linked track downloads the whole file once into a local cache
(`server/smb-cache/`) — SMB doesn't support true partial-byte downloads the way HTTP does.
Seeking/scrubbing works normally from then on, including on that same play, since playback reads
from the cache. The cache is capped (`SMB_CACHE_MAX_MB`, default 10240 = 10 GB) with LRU
eviction — every play refreshes that file's position in the queue, and whenever a new download
pushes the cache over the cap, the least-recently-played files are deleted first until it's back
under. Raise this if the server and your NAS are on the same local network (SMB reads are fast
and free there — the default assumes that); keep it low if SMB traffic has to cross the internet
to reach the share, where repeated re-downloads are more costly.
It's disposable — losing it just means the next play of that track re-downloads it, no data
loss — `docker-compose.yml` persists it in a volume anyway purely so a redeploy doesn't cold-start
every track again, but you can safely wipe `server/smb-cache/` any time.

Configure via `server/.env`:

```bash
SMB_HOST=192.168.1.50          # NAS/share IP or hostname
SMB_SHARE=Music                # the share name (not a sub-path within it)
SMB_USERNAME=myuser
SMB_PASSWORD=mypassword
# Optional, default WORKGROUP — only needed for domain-joined Windows shares
SMB_DOMAIN=WORKGROUP
# Optional, default 445
SMB_PORT=445
```

This is one shared connection configured server-side (same pattern as S3), not a per-user
credential — everyone using this Wavlo instance browses/links from the same share.

### Auto-linking a whole folder

Instead of linking files one at a time (or in a manually-selected batch), "Sync SMB folder" in
the library scans a folder recursively and links every audio file in it you don't already have —
safe to click repeatedly, since already-linked files are skipped. By default it scans the whole
share; set `SMB_SYNC_PATH` to scope it to a subfolder:

```bash
SMB_SYNC_PATH=Music/Library   # optional, default is the whole share
```

Leading/trailing slashes don't matter — `Music/Library`, `/Music/Library`, and `/Music/Library/`
all resolve to the same folder.

For hands-off syncing instead of clicking the button, set `SMB_SYNC_INTERVAL_MINUTES` to run the
same scan automatically on a timer, for every existing account (sync is per-user, same as manual
linking — each account gets its own copy of newly-found tracks in its own library):

```bash
SMB_SYNC_INTERVAL_MINUTES=60   # optional, default 0 = disabled (manual button only)
```

## Deployment (Docker / Dokploy)

Two deployment options ship in this repo — pick whichever fits.

### Option A: single container (simplest)

The root `Dockerfile` builds the React app and has the Express server serve it directly
(static files + SPA routing) alongside the API, all from one process on one port. No compose
file needed.

```bash
docker build -t wavlo .
docker run -d -p 4000:4000 \
  -e JWT_SECRET=change-me \
  -v wavlo_db:/app/db -v wavlo_uploads:/app/uploads \
  wavlo
```

The app is then available at `http://localhost:4000`.

**On Dokploy:** create a new **Application** (Dockerfile type), point it at this repo — it
picks up the root `Dockerfile` automatically. Set `JWT_SECRET` (required) and, if you want S3
support, the `AWS_*`/`STORAGE_DRIVER` vars from `.env.example` under the app's **Environment**
tab. Mount `/app/db` and `/app/uploads` as persistent volumes so your library survives
redeploys.

### Option B: two containers (nginx + Express)

`docker-compose.yml` builds two services instead: `server` (the Express API, from
`server/Dockerfile`) and `client` (the React app built and served by nginx, from
`client/Dockerfile` + `client/nginx.conf`, which reverse-proxies `/api/*` to `server`). Useful
if you want nginx fronting the static assets specifically, or want to scale/update the two
independently.

```bash
cp .env.example .env   # fill in JWT_SECRET, and S3 vars if you want them
docker compose up -d --build
```

The app is then available at `http://localhost:8080` (or whatever `HTTP_PORT` you set).

**On Dokploy:** create a new **Compose** application instead, point it at this repo (it picks
up `docker-compose.yml` automatically), set the same env vars under **Environment**. Dokploy
keeps the `wavlo_db` / `wavlo_uploads` volumes across redeploys either way.

## Notes

- No copyrighted content is bundled — this app only plays audio files you upload or link yourself.
- Data lives in `server/db/app.db` (SQLite); audio is in `server/uploads/` and/or your S3 bucket.
- Set `JWT_SECRET` in `server/.env` (or the Docker/Dokploy environment) for production use.
- Sign-up is open by default. Set `ALLOW_SIGNUP=false` once you've created the account(s) you
  need to make the instance invite-only — the register page and "Sign up" link disappear, and
  `POST /api/auth/register` is rejected server-side too (not just hidden in the UI). Existing
  accounts can still log in as normal.
- See `CHANGELOG.md` for release history, `ROADMAP.md` for planned enhancements, and
  `ai_rules.md` for how changes here get versioned.

## License

MIT — see [`LICENSE`](LICENSE).
