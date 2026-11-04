# node:22+ required — better-sqlite3's native addon is built for Node 22's
# ABI; running it under Node 20 segfaults the process at startup (exit 139)
# instead of failing loudly at install time.
#
# ---- Install dependencies ----
# python3/make/g++ let node-gyp compile the native addon from source if no
# matching prebuilt binary is found for the build platform/arch.
FROM node:22-alpine AS deps
RUN apk add --no-cache python3 make g++
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev

# ---- Runtime image (no build toolchain, smaller) ----
FROM node:22-alpine
# smbclient/smbget — used at runtime for the optional "link from SMB share"
# feature (see smb.js). Harmless/unused if SMB_* env vars aren't set.
RUN apk add --no-cache samba-client
WORKDIR /app

COPY --from=deps /app/node_modules ./node_modules
COPY . .

# Persisted outside the image: SQLite DB, local-disk audio uploads, and the
# local cache for files streamed from an SMB share.
RUN mkdir -p /app/db /app/uploads /app/smb-cache
VOLUME ["/app/db", "/app/uploads"]

EXPOSE 4000

CMD ["node", "index.js"]
