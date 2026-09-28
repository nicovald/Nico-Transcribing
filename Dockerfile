FROM node:22-slim AS build
WORKDIR /app
# The desktop shell is not needed in the server image.
ENV ELECTRON_SKIP_BINARY_DOWNLOAD=1
COPY package*.json ./
COPY media-tools.lock.json ./
COPY scripts/install-media-tools.mjs ./scripts/
COPY scripts/download-release.mjs ./scripts/
RUN npm ci
COPY . .
RUN npm run build && npm prune --omit=dev

FROM node:22-slim
# Use the distro ffmpeg instead of the bundled static binaries.
RUN apt-get update && apt-get install -y --no-install-recommends ffmpeg && rm -rf /var/lib/apt/lists/*
WORKDIR /app
ENV NODE_ENV=production HOST=0.0.0.0 PORT=3462 DATA_DIR=/app/data FFMPEG_PATH=/usr/bin/ffmpeg FFPROBE_PATH=/usr/bin/ffprobe
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY package.json ./
COPY THIRD_PARTY_NOTICES.md LICENSE ./
COPY server ./server
EXPOSE 3462
CMD ["node", "server/index.js"]
