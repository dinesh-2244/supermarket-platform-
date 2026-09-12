# syntax=docker/dockerfile:1
#
# Review runtime — one disposable container per review, holding everything a
# reviewer needs to reproduce a candidate independently: Node (the version the
# project pins), a private PostgreSQL 16 (the version CI runs), git, the GitHub
# CLI and psql. Nothing in here is shared with the host or with other reviews;
# `scripts/review-runtime.sh down` throws the whole thing away.
#
# Same base image as the production Dockerfile, for the same reasons given there.
ARG NODE_IMAGE=node:22.20.0-bookworm-slim@sha256:b21fe589dfbe5cc39365d0544b9be3f1f33f55f3c86c87a76ff65a02f8f5848e
FROM ${NODE_IMAGE}

ENV DEBIAN_FRONTEND=noninteractive \
    NPM_CONFIG_UPDATE_NOTIFIER=false \
    NEXT_TELEMETRY_DISABLED=1 \
    PG_MAJOR=16 \
    PATH=/usr/lib/postgresql/16/bin:$PATH

# PostgreSQL from the PGDG repository (bookworm ships 15; CI runs 16) and the
# GitHub CLI from GitHub's own repository. Both keys are fetched over TLS from
# the vendors' canonical locations.
RUN apt-get update \
 && apt-get install -y --no-install-recommends \
      ca-certificates curl gnupg git openssh-client procps \
 && install -d -m 0755 /etc/apt/keyrings \
 && curl -fsSL https://www.postgresql.org/media/keys/ACCC4CF8.asc \
      | gpg --dearmor -o /etc/apt/keyrings/postgresql.gpg \
 && echo "deb [signed-by=/etc/apt/keyrings/postgresql.gpg] https://apt.postgresql.org/pub/repos/apt bookworm-pgdg main" \
      > /etc/apt/sources.list.d/pgdg.list \
 && curl -fsSL https://cli.github.com/packages/githubcli-archive-keyring.gpg \
      -o /etc/apt/keyrings/githubcli-archive-keyring.gpg \
 && echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/githubcli-archive-keyring.gpg] https://cli.github.com/packages stable main" \
      > /etc/apt/sources.list.d/github-cli.list \
 && apt-get update \
 && apt-get install -y --no-install-recommends "postgresql-${PG_MAJOR}" gh \
 && rm -rf /var/lib/apt/lists/*

# The database lives under /pg (a volume the wrapper creates per review) and is
# owned by the `postgres` user the package created. The repo checkout lives
# under /work and is owned by root — the reviewer runs as root inside the
# container, which is fine: the container *is* the isolation boundary.
RUN install -d -o postgres -g postgres /pg /run/postgresql \
 && install -d /work

COPY entrypoint.sh /usr/local/bin/review-runtime-entrypoint
RUN chmod 0755 /usr/local/bin/review-runtime-entrypoint

WORKDIR /work
ENTRYPOINT ["/usr/local/bin/review-runtime-entrypoint"]
