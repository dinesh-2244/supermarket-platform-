# Review runtime — independent reproduction for reviewers

A reviewer must be able to check a candidate commit against a **real** database,
with their own probes, without asking the builder or the coordinator to run
anything for them, and without touching anything shared. This is the runbook
for the environment that gives them that.

Hosted CI on the exact head remains a required acceptance leg. This runtime
is **in addition** to it, not a replacement: CI proves the candidate passes its
own suites; this proves what the reviewer chooses to test.

## What it is

One Docker container per review, built from `docker/review-runtime/Dockerfile`
and driven by `scripts/review-runtime.sh`. Inside the container:

| Piece            | What                                                            |
| ---------------- | --------------------------------------------------------------- |
| Node             | `22.20.0` — the version `.nvmrc` and CI pin                     |
| PostgreSQL       | 16, the version CI's integration job runs, on a private volume  |
| Checkout         | a fresh `git clone` from GitHub at the exact ref you asked for  |
| Tooling          | `git`, `gh` (authenticated), `psql`, `npm`, `npx tsx`           |
| Databases        | `supermarket` (migrated + seeded) and `supermarket_e2e` (empty) |
| Environment      | the same variables CI's integration job sets (`APP_ENV=ci` …)   |

What it is **not** connected to: the host's development database, any other
review's container, or anything in production. There are no production
credentials anywhere in it. The only secret it holds is a GitHub token in the
container's environment (see *Credentials*).

Removing the container removes the checkout, the database and everything you
ran — `down` is the whole teardown.

## Prerequisites

- Docker Desktop running on the host (`docker info` answers).
- `gh` logged in on the host, **or** `REVIEW_RUNTIME_GH_TOKEN` set — needed
  only for `gh` inside the container; the repository is public, so cloning
  and checkout work without it.
- **Run the script outside the command sandbox.** The Docker CLI talks to the
  daemon over a Unix socket, which the sandbox blocks — the same bypass every
  database command already needs. Nothing in the script needs it for any other
  reason. If your harness cannot grant that bypass, the runtime is unusable to
  you; say so in the review rather than working around it, and the coordinator
  falls back to the documented substitute (exact-head hosted CI plus the
  builder's logs).

## The loop

```sh
S=scripts/review-runtime.sh          # from any checkout of this repository

$S build                             # once, and again after the Dockerfile changes
$S up pr40 pr/40                     # or: up pr40 3fb6409 / up rc main / up t v0.4.1-prisma7
$S status                            # name, state, ref asked for, commit checked out

$S run pr40 npm test                 # unit
$S run pr40 npm run typecheck
$S run pr40 npm run test:integration # real PostgreSQL, the suite the candidate ships
$S run pr40 'npx vitest run --project integration tests/integration/identity-totp.test.ts -t H1'

$S psql pr40 -c 'select count(*) from "Order"'
$S psql pr40 < my-query.sql

$S cp pr40 ~/probes/totp-race.mts /work/repo/probe.mts
$S run pr40 'npx tsx probe.mts'      # a probe against the real repo functions and the real DB
$S run pr40 'rm probe.mts; git status --porcelain'   # leave the checkout as you found it

$S reset-db pr40                     # a clean, freshly seeded database on the same checkout
$S down pr40                         # container + volume gone
```

`up` prints the commit it checked out and refuses to continue if the checkout
is not clean. Quote a command to `run` when it contains shell syntax (`|`,
`&&`, redirects); the command runs with `/work/repo` as its working directory
and the container's environment.

### Refs

`<ref>` is anything git can resolve after a fetch: a full or short SHA, a
branch, a tag, or `pr/<number>` for a pull request's current head. Pass the
SHA when the review is of an exact commit — `status` shows what was actually
checked out, so the report can cite it.

### Browser runs

The image does not ship a browser (it would double its size). Playwright can
install one into the container; a full E2E leg on the second database is:

```sh
$S run pr40 'export DATABASE_URL="$E2E_DATABASE_URL" AUTH_URL=http://127.0.0.1:3100
  npx prisma migrate deploy && npm run db:seed && npm run build
  npx playwright install --with-deps chromium
  npx playwright test --project=chromium'
```

This ran to completion inside Docker Desktop's default 4 GB allowance
(`next build`, Chromium install and 95 chromium tests, ~7 minutes all told);
if it gets tight, give Docker more memory or run the browser leg in its own
`up`.

### Reaching the database from the host

Off by default — there is nothing on the host that should. If you need a host
tool against it, `REVIEW_RUNTIME_PG_PORT=55432 $S up …` publishes it on
`127.0.0.1:55432` (user/password `postgres`).

## Credentials

- `gh` inside the container authenticates with `GH_TOKEN`, taken from
  `REVIEW_RUNTIME_GH_TOKEN` or, failing that, the host's `gh auth token`. It is
  passed as a container environment variable only; it is not baked into the
  image and not written to any file. The host's token is whatever the host is
  logged in as — for a reviewer, a fine-grained token scoped to this repository
  with *Contents: read*, *Pull requests: read and write* and *Actions: read* is
  the right thing to put in `REVIEW_RUNTIME_GH_TOKEN`.
- The database is `postgres`/`postgres` with `trust` auth. It is a fixture,
  reachable only inside the container unless you publish it.
- There are no other secrets. `AUTH_SECRET` is a placeholder, as in CI.

## Housekeeping

- `status` lists every runtime; `down` each one when the review is done.
  Containers are labelled `review-runtime=1`, so `docker ps -a --filter
  label=review-runtime=1` finds strays.
- `npm ci` output is cached in a shared, content-addressed volume
  (`review-runtime-npm-cache`); `docker volume rm review-runtime-npm-cache`
  clears it.
- The image is `supermarket-review-runtime:local`; `build` replaces it. Rebuild
  when `.nvmrc`, the Dockerfile's base image, or the PostgreSQL major changes.

## Verified end-to-end

On 2026-09-12, from a clean image build: `up pr40 pr/40` cloned and checked out
`3fb6409` (PR #40), `npm ci`, migrated 9 migrations and seeded; `gh pr view 40`
answered from inside the container; `npm run test:integration` passed
**425/425** on the container's PostgreSQL 16; a copied-in `tsx` probe ran two
concurrent `claimTotpCounter` calls against the real repository code and the
real database (`{"claims":[true,false],"exactlyOne":true}`); the checkout was
clean afterwards; the browser recipe above passed **95/95** chromium Playwright
tests on `supermarket_e2e`; `down pr40` removed the container and its volume.
