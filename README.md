# Wavlo

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)

A self-hosted Spotify-style music player. Upload your own audio files, organize them into
playlists, search your library, and stream with a Spotify-inspired dark UI (sidebar, library
grid, scrubbing now-playing bar).

## Stack

- **Backend**: Express + better-sqlite3, JWT auth, Multer uploads, `music-metadata` for ID3/tag
  extraction (title/artist/album/cover art), HTTP range-request streaming.
- **Frontend**: React (Vite) + React Router, dark theme CSS modeled on Spotify's layout
  (sidebar nav + playlists, top content area, persistent now-playing bar with scrubber/volume).

## Running locally

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
   re-uploading it. Deleting a linked track only removes it from your library — the object stays
   in your bucket, since you don't necessarily own the only copy of it.

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
- See `CHANGELOG.md` for release history, `ROADMAP.md` for planned enhancements, and
  `ai_rules.md` for how changes here get versioned.

## License

MIT — see [`LICENSE`](LICENSE).
