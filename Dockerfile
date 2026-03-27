# ── Stage 1: Build ────────────────────────────────────────────
FROM node:20-alpine AS builder

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci

COPY . .
RUN npm run build

# ── Stage 2: Production ──────────────────────────────────────
FROM node:20-alpine

RUN apk add --no-cache curl

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci --omit=dev

# Build output (server bundle + client assets + SQL scripts)
COPY --from=builder /app/dist ./dist

# Runtime helper script used by npm start
COPY script/with-node-env.cjs ./script/with-node-env.cjs

# Migration files
COPY migrations ./migrations

ENV NODE_ENV=production
ENV PORT=5000

EXPOSE 5000

HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
  CMD curl -f http://localhost:5000/api/health || exit 1

CMD ["node", "script/with-node-env.cjs", "production", "node", "dist/index.cjs"]
