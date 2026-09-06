# syntax=docker/dockerfile:1

# Base images are pinned by digest, not just by tag, so a rebuild cannot pick up
# a silently re-tagged image. Debian slim (not Alpine) because argon2 ships glibc
# prebuilds — musl would force a compile toolchain into the image.
ARG NODE_IMAGE=node:22.20.0-bookworm-slim@sha256:b21fe589dfbe5cc39365d0544b9be3f1f33f55f3c86c87a76ff65a02f8f5848e

# ---------------------------------------------------------------------------
# deps — production + build dependencies from the lockfile only
# ---------------------------------------------------------------------------
FROM ${NODE_IMAGE} AS deps
WORKDIR /app
ENV NPM_CONFIG_UPDATE_NOTIFIER=false
COPY package.json package-lock.json ./
RUN npm ci --ignore-scripts

# ---------------------------------------------------------------------------
# builder — Prisma client + Next.js standalone bundle
# ---------------------------------------------------------------------------
FROM ${NODE_IMAGE} AS builder
WORKDIR /app
ENV NEXT_TELEMETRY_DISABLED=1
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN npx prisma generate

# `next build` only needs these to exist — nothing here is baked into the image;
# the real values come from the runtime environment.
ENV APP_ENV=ci \
    DATABASE_URL=postgresql://build:build@localhost:5432/build \
    AUTH_SECRET=build-time-placeholder-not-a-real-secret \
    AUTH_URL=http://localhost:3000
RUN npm run build

# ---------------------------------------------------------------------------
# runner — non-root, minimal surface
# ---------------------------------------------------------------------------
FROM ${NODE_IMAGE} AS runner
WORKDIR /app

ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1 \
    PORT=3000 \
    HOSTNAME=0.0.0.0

# The `node` user (uid/gid 1000) ships with the base image; nothing runs as root.
RUN mkdir -p /app && chown -R node:node /app

# Next.js standalone output: server + only the modules it actually traced.
COPY --from=builder --chown=node:node /app/.next/standalone ./
COPY --from=builder --chown=node:node /app/.next/static ./.next/static
COPY --from=builder --chown=node:node /app/public ./public

# Schema, migrations and the Prisma CLI, so `prisma migrate deploy` can run as a
# gated pre-deploy step from this same image (§18/§23).
COPY --from=builder --chown=node:node /app/prisma ./prisma
COPY --from=builder --chown=node:node /app/node_modules/prisma ./node_modules/prisma
COPY --from=builder --chown=node:node /app/node_modules/@prisma ./node_modules/@prisma
# The generated client and its query engine, in case Next's tracing missed them.
COPY --from=builder --chown=node:node /app/node_modules/.prisma ./node_modules/.prisma

USER node
EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:3000/api/health').then(r=>r.json()).then(b=>process.exit(b.db==='ok'?0:1)).catch(()=>process.exit(1))"

CMD ["node", "server.js"]
