# syntax=docker/dockerfile:1
# Multi-stage build for Persona Studio Node.js 22 application

# --- Stage 1: Build Frontend Assets ---
FROM node:22-slim AS builder

WORKDIR /app

COPY package.json package-lock.json vite.config.js index.html ./
COPY public ./public
COPY src ./src

RUN npm ci && npm run build

# --- Stage 2: Production Runtime ---
FROM node:22-slim AS runner

WORKDIR /app

ENV NODE_ENV=production \
    PORT=8190 \
    HOST=0.0.0.0

# Install curl for container healthcheck, ca-certificates, python3, and modal CLI
RUN apt-get update && apt-get install -y --no-install-recommends \
    curl \
    ca-certificates \
    python3 \
    python3-pip \
    python-is-python3 \
    && npm install -g @openai/codex \
    && pip install --no-cache-dir --break-system-packages modal \
    && rm -rf /var/lib/apt/lists/*

# Install production dependencies only
COPY package.json package-lock.json ./
RUN npm ci --omit=dev

# Copy built frontend assets from builder stage
COPY --from=builder /app/dist ./dist

# Copy backend server and script files
COPY server ./server
COPY scripts ./scripts

RUN mkdir -p /tmp/codex /data

EXPOSE 8190

HEALTHCHECK --interval=10s --timeout=5s --start-period=15s --retries=6 \
    CMD curl -f http://127.0.0.1:8190/api/session || exit 1

CMD ["node", "server/index.mjs", "--production"]
