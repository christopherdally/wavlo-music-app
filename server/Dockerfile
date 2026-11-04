FROM node:20-alpine

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci --omit=dev

COPY . .

# Persisted outside the image: SQLite DB and local-disk audio uploads.
RUN mkdir -p /app/db /app/uploads
VOLUME ["/app/db", "/app/uploads"]

EXPOSE 4000

CMD ["node", "index.js"]
