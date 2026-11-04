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
WORKDIR /app

COPY --from=deps /app/node_modules ./node_modules
COPY . .

# Persisted outside the image: SQLite DB and local-disk audio uploads.
RUN mkdir -p /app/db /app/uploads
VOLUME ["/app/db", "/app/uploads"]

EXPOSE 4000

CMD ["node", "index.js"]
