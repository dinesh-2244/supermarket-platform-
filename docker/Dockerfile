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
# migrate — `prisma migrate deploy`, as a gated pre-deploy step (§18/§23)
# ---------------------------------------------------------------------------
#
# Its own stage with the *whole* locked dependency tree, not a hand-picked copy
# of `node_modules/prisma` and `node_modules/@prisma`. The Prisma CLI is a real
# dependency graph — @prisma/config alone pulls in `effect`, `c12`, `jiti` and
# more — and copying two directories out of it produced an image that built
# fine and then died at `Cannot find module 'effect'`, taking the whole Compose
# stack down with it because app/ depends on migrate completing.
#
# Reusing the `deps` stage verbatim is what keeps this honest: whatever
# `npm ci` resolved for the build is exactly what runs the migration.
FROM ${NODE_IMAGE} AS migrate
WORKDIR /app

ENV NODE_ENV=production \
    NPM_CONFIG_UPDATE_NOTIFIER=false \
    PRISMA_HIDE_UPDATE_MESSAGE=1

COPY --from=deps --chown=node:node /app/node_modules ./node_modules
COPY --chown=node:node package.json ./
COPY --chown=node:node prisma ./prisma

# Migrations do not need the query engine, but generating the client here keeps
# `prisma migrate status` and `migrate resolve` usable from the same image.
RUN npx prisma generate

USER node

# `migrate deploy` is idempotent and never prompts, so it is safe to re-run on
# every deploy; it applies only migrations that are not yet recorded.
CMD ["npx", "--no-install", "prisma", "migrate", "deploy"]

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

# The generated client and its query engine, in case Next's tracing missed them.
COPY --from=builder --chown=node:node /app/node_modules/.prisma ./node_modules/.prisma

USER node
EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:3000/api/health').then(r=>r.json()).then(b=>process.exit(b.db==='ok'?0:1)).catch(()=>process.exit(1))"

CMD ["node", "server.js"]
