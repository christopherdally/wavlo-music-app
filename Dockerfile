# Single-container build: the Express server serves both the API and the
# built React app from the same process/port. Simplest option for a single
# Dokploy "Application" (Dockerfile type) with no docker-compose needed.
#
# For a two-container setup (nginx + Express) instead, see docker-compose.yml.
#
# node:22+ required — better-sqlite3's native addon is built for Node 22's
# ABI; running it under Node 20 segfaults the process at startup (exit 139)
# instead of failing loudly at install time.

# ---- Build the React frontend ----
FROM node:22-alpine AS client-build
WORKDIR /app/client
COPY client/package.json client/package-lock.json ./
RUN npm ci
COPY client/ .
RUN npm run build

# ---- Install server production dependencies ----
# python3/make/g++ let node-gyp compile the native addon from source if no
# matching prebuilt binary is found for the build platform/arch.
FROM node:22-alpine AS server-deps
RUN apk add --no-cache python3 make g++
WORKDIR /app/server
COPY server/package.json server/package-lock.json ./
RUN npm ci --omit=dev

# ---- Final runtime image ----
FROM node:22-alpine
WORKDIR /app

COPY --from=server-deps /app/server/node_modules ./node_modules
COPY server/ .
COPY --from=client-build /app/client/dist ./public

# Persisted outside the image: SQLite DB and local-disk audio uploads.
RUN mkdir -p /app/db /app/uploads
VOLUME ["/app/db", "/app/uploads"]

EXPOSE 4000

CMD ["node", "index.js"]
