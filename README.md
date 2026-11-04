# Wavlo

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

## Notes

- No copyrighted content is bundled — this app only plays audio files you upload or link yourself.
- Data lives in `server/db/app.db` (SQLite); audio is in `server/uploads/` and/or your S3 bucket.
- Set `JWT_SECRET` in `server/.env` for production use.
