# Single-container build: the Express server serves both the API and the
# built React app from the same process/port. Simplest option for a single
# Dokploy "Application" (Dockerfile type) with no docker-compose needed.
#
# For a two-container setup (nginx + Express) instead, see docker-compose.yml.

# ---- Build the React frontend ----
FROM node:20-alpine AS client-build
WORKDIR /app/client
COPY client/package.json client/package-lock.json ./
RUN npm ci
COPY client/ .
RUN npm run build

# ---- Install server production dependencies ----
FROM node:20-alpine AS server-deps
WORKDIR /app/server
COPY server/package.json server/package-lock.json ./
RUN npm ci --omit=dev

# ---- Final runtime image ----
FROM node:20-alpine
WORKDIR /app

COPY --from=server-deps /app/server/node_modules ./node_modules
COPY server/ .
COPY --from=client-build /app/client/dist ./public

# Persisted outside the image: SQLite DB and local-disk audio uploads.
RUN mkdir -p /app/db /app/uploads
VOLUME ["/app/db", "/app/uploads"]

EXPOSE 4000

CMD ["node", "index.js"]
