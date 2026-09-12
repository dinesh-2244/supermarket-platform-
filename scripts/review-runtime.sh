#!/usr/bin/env bash
#
# review-runtime — a disposable, isolated reproduction environment per review.
#
#   scripts/review-runtime.sh build                  build (or rebuild) the image
#   scripts/review-runtime.sh up    <name> <ref>     new container: clone, checkout <ref>, npm ci, migrate, seed
#   scripts/review-runtime.sh run   <name> <cmd...>  run a command in the checkout (npm test, vitest, tsx probe.mts …)
#   scripts/review-runtime.sh psql  <name> [args...] psql against the container's database
#   scripts/review-runtime.sh cp    <name> <src> <dst>   copy a file/dir in (host → container) or out (name:path)
#   scripts/review-runtime.sh reset-db <name>        drop, recreate, migrate and seed the database (same checkout)
#   scripts/review-runtime.sh status [name]          what is running, and at which commit
#   scripts/review-runtime.sh down  <name>           remove the container and its database volume
#
# <ref> is anything git can resolve after fetching: a full or short commit SHA,
# a branch name, a tag, or `pr/<number>` for a pull request head.
#
# Each container has its own PostgreSQL 16 on its own volume — nothing is shared
# with the host, with the dev database, or with another review — and its own
# fresh clone from GitHub, so what is under review is what was pushed, not a
# builder's working tree. Removing the container removes all of it.
#
# The Docker CLI talks to the daemon over a Unix socket, which an agent's
# command sandbox blocks: run this script with the sandbox bypass, the same way
# any database command needs it. Nothing here touches production: the only
# credentials involved are a GitHub token (see REVIEW_RUNTIME_GH_TOKEN) and the
# throwaway `postgres`/`postgres` pair inside the container.
#
# Environment:
#   REVIEW_RUNTIME_REPO       clone URL (default: this repository on GitHub)
#   REVIEW_RUNTIME_IMAGE      image tag  (default: supermarket-review-runtime:local)
#   REVIEW_RUNTIME_GH_TOKEN   token for `gh` inside the container; defaults to the
#                             host's `gh auth token` when gh is logged in. It is
#                             passed as an environment variable to the container
#                             only — never written to the image or to disk.
#   REVIEW_RUNTIME_PG_PORT    publish the database on this host port (off by default)
set -euo pipefail

REPO="${REVIEW_RUNTIME_REPO:-https://github.com/dinesh-2244/supermarket-platform-.git}"
IMAGE="${REVIEW_RUNTIME_IMAGE:-supermarket-review-runtime:local}"
NPM_CACHE_VOLUME="review-runtime-npm-cache"
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
CONTEXT="$HERE/../docker/review-runtime"

# The environment the checkout runs with. Mirrors .github/workflows/ci.yml's
# integration job: APP_ENV=ci, a placeholder AUTH_SECRET, the container-local
# database. E2E_DATABASE_URL is the second, empty database for Playwright runs.
CONTAINER_ENV=(
  -e APP_ENV=ci
  -e DATABASE_URL=postgresql://postgres:postgres@localhost:5432/supermarket
  -e E2E_DATABASE_URL=postgresql://postgres:postgres@localhost:5432/supermarket_e2e
  -e AUTH_SECRET=review-runtime-secret-not-a-real-secret-0000
  -e AUTH_URL=http://localhost:3000
  -e DEFAULT_CURRENCY=INR
  -e LOG_LEVEL=warn
  -e CI=1
  -e PRISMA_HIDE_UPDATE_MESSAGE=1
  -e PGOPTIONS=-cclient_min_messages=warning
)

die() { echo "review-runtime: $*" >&2; exit 1; }
usage() { sed -n '3,/^set -euo/p' "${BASH_SOURCE[0]}" | sed '$d' | sed 's/^# \{0,1\}//'; exit "${1:-0}"; }

container_name() { echo "rr-$1"; }
volume_name() { echo "rr-$1-pg"; }

require_docker() {
  docker info >/dev/null 2>&1 \
    || die "cannot reach the Docker daemon. Is Docker Desktop running, and is this command running outside the sandbox?"
}

require_container() {
  local c; c="$(container_name "$1")"
  docker container inspect "$c" >/dev/null 2>&1 || die "no runtime named '$1' (try: status)"
}

# Run a command inside the checkout. Login shell so PATH has node and psql.
in_repo() {
  local name="$1"; shift
  docker exec -w /work/repo "$(container_name "$name")" bash -lc "$*"
}

wait_for_postgres() {
  local c="$1" i
  for i in $(seq 1 60); do
    if docker exec "$c" pg_isready -q -U postgres 2>/dev/null; then return 0; fi
    sleep 1
  done
  docker logs "$c" >&2 || true
  die "PostgreSQL did not come up inside $c"
}

cmd_build() {
  require_docker
  docker build -t "$IMAGE" "$CONTEXT"
  echo "review-runtime: built $IMAGE"
}

cmd_up() {
  local name="${1:-}" ref="${2:-}"
  [ -n "$name" ] && [ -n "$ref" ] || usage 1
  [[ "$name" =~ ^[a-z0-9][a-z0-9-]*$ ]] || die "name must be lowercase letters, digits and dashes"
  require_docker
  docker image inspect "$IMAGE" >/dev/null 2>&1 || cmd_build

  local c v; c="$(container_name "$name")"; v="$(volume_name "$name")"
  docker container inspect "$c" >/dev/null 2>&1 && die "'$name' already exists — down it first, or pick another name"

  local token="${REVIEW_RUNTIME_GH_TOKEN:-}"
  if [ -z "$token" ] && command -v gh >/dev/null 2>&1; then
    token="$(gh auth token 2>/dev/null || true)"
  fi
  # `${arr[@]+"${arr[@]}"}` below: macOS ships bash 3.2, where expanding an
  # empty array under `set -u` is an error.
  local token_env=()
  [ -n "$token" ] && token_env=(-e "GH_TOKEN=$token")

  local publish=()
  [ -n "${REVIEW_RUNTIME_PG_PORT:-}" ] && publish=(-p "127.0.0.1:${REVIEW_RUNTIME_PG_PORT}:5432")

  docker volume create "$v" >/dev/null
  docker volume create "$NPM_CACHE_VOLUME" >/dev/null
  docker run -d --name "$c" \
    --label review-runtime=1 --label "review-runtime.ref=$ref" \
    -v "$v:/pg" -v "$NPM_CACHE_VOLUME:/root/.npm" \
    "${CONTAINER_ENV[@]}" ${token_env[@]+"${token_env[@]}"} ${publish[@]+"${publish[@]}"} \
    "$IMAGE" >/dev/null
  wait_for_postgres "$c"

  echo "review-runtime: cloning $REPO"
  docker exec -w /work "$c" bash -lc "
    set -euo pipefail
    git clone --quiet '$REPO' repo
    cd repo
    git fetch --quiet origin '+refs/pull/*/head:refs/remotes/origin/pr/*'
    case '$ref' in
      pr/*) git checkout --quiet --detach 'origin/$ref' ;;
      *)    git checkout --quiet --detach '$ref' 2>/dev/null || git checkout --quiet --detach 'origin/$ref' ;;
    esac
    echo \"review-runtime: checked out \$(git rev-parse HEAD) (\$(git log -1 --format=%s | cut -c1-72))\"
    git status --porcelain | grep -q . && { echo 'review-runtime: checkout is not clean' >&2; exit 1; }
    echo 'review-runtime: npm ci'
    npm ci --no-audit --no-fund --loglevel=error
    npx prisma generate >/dev/null
  "
  cmd_reset_db "$name"
  echo
  cmd_status "$name"
}

cmd_reset_db() {
  local name="${1:-}"; [ -n "$name" ] || usage 1
  require_container "$name"
  local c; c="$(container_name "$name")"
  echo "review-runtime: fresh databases supermarket + supermarket_e2e"
  # One -c per statement: DROP DATABASE refuses to run inside the single
  # transaction psql wraps a multi-statement -c in.
  docker exec "$c" psql -q -U postgres -v ON_ERROR_STOP=1 \
    -c "SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname IN ('supermarket','supermarket_e2e')" \
    -c "DROP DATABASE IF EXISTS supermarket" \
    -c "DROP DATABASE IF EXISTS supermarket_e2e" \
    -c "CREATE DATABASE supermarket" \
    -c "CREATE DATABASE supermarket_e2e" >/dev/null
  echo "review-runtime: prisma migrate deploy"
  in_repo "$name" "npx prisma migrate deploy" | grep -E 'migrations found|applied|No pending' || true
  echo "review-runtime: db:seed"
  in_repo "$name" "npm run --silent db:seed" | tail -n 3
}

cmd_run() {
  local name="${1:-}"; [ -n "$name" ] || usage 1; shift
  [ $# -gt 0 ] || die "run: give a command"
  require_container "$name"
  in_repo "$name" "$@"
}

cmd_psql() {
  local name="${1:-}"; [ -n "$name" ] || usage 1; shift
  require_container "$name"
  docker exec -i "$(container_name "$name")" psql -U postgres -d supermarket "$@"
}

cmd_cp() {
  local name="${1:-}" src="${2:-}" dst="${3:-}"
  [ -n "$name" ] && [ -n "$src" ] && [ -n "$dst" ] || usage 1
  require_container "$name"
  local c; c="$(container_name "$name")"
  case "$src" in
    "$name":*) docker cp "$c:${src#"$name":}" "$dst" ;;
    *)         docker cp "$src" "$c:$dst" ;;
  esac
}

cmd_status() {
  require_docker
  local filter=(--filter label=review-runtime=1)
  [ -n "${1:-}" ] && filter+=(--filter "name=^$(container_name "$1")$")
  local ids; ids="$(docker ps -a -q "${filter[@]}")"
  if [ -z "$ids" ]; then echo "review-runtime: nothing running"; return 0; fi
  local id name state ref head
  for id in $ids; do
    name="$(docker inspect -f '{{.Name}}' "$id" | sed 's#^/rr-##')"
    state="$(docker inspect -f '{{.State.Status}}' "$id")"
    ref="$(docker inspect -f '{{index .Config.Labels "review-runtime.ref"}}' "$id")"
    head="$(docker exec -w /work/repo "$id" git rev-parse HEAD 2>/dev/null || echo '(no checkout)')"
    printf '%-20s %-8s ref=%-28s head=%s\n' "$name" "$state" "$ref" "$head"
  done
}

cmd_down() {
  local name="${1:-}"; [ -n "$name" ] || usage 1
  require_docker
  docker rm -f "$(container_name "$name")" >/dev/null 2>&1 || true
  docker volume rm "$(volume_name "$name")" >/dev/null 2>&1 || true
  echo "review-runtime: removed '$name' and its database"
}

case "${1:-}" in
  build)    shift; cmd_build "$@" ;;
  up)       shift; cmd_up "$@" ;;
  run)      shift; cmd_run "$@" ;;
  psql)     shift; cmd_psql "$@" ;;
  cp)       shift; cmd_cp "$@" ;;
  reset-db) shift; cmd_reset_db "$@" ;;
  status)   shift; cmd_status "$@" ;;
  down)     shift; cmd_down "$@" ;;
  -h|--help|help|"") usage 0 ;;
  *) die "unknown command '$1' (try --help)" ;;
esac
