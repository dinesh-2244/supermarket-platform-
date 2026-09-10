# Infra task — Prisma 6.19.3 → 7.x, driver-adapter migration

Status: **approved, scheduled after `v0.4.0-checkout` and before any Phase 5 build**
(human directive 2026-09-09; Dependabot PR #6 opened the bump). Owner: JIM builds, OSCAR
reviews, Michael integrates. Card: `prisma-7-driver-adapter`.

## Objective

Move the platform from Prisma `6.19.3` to Prisma `7.x` (`prisma` + `@prisma/client`)
using a **`pg` driver adapter** on the client, changing **nothing else** — no schema
change, no query-behaviour change, no new features. When this lands, `main` builds and
passes every existing gate exactly as it does today, only on Prisma 7.

This is a plumbing change with a wide blast radius: `src/modules/platform/db/index.ts`
is the single connection factory and it, plus seven other repos, lean on `$queryRaw` /
`$executeRaw` for the locks and `FOR UPDATE` reads the inventory and order invariants
depend on. The point of doing it as its own reviewed task rather than a version bump is
that the driver adapter changes how parameters reach PostgreSQL, and every one of those
raw statements has to be re-proven.

## Context — what Prisma 7 + a driver adapter changes here

- **The client constructor.** Prisma 7 takes a driver adapter instead of a
  `datasources: { db: { url } }` block. `createClient()` in
  `src/modules/platform/db/index.ts` becomes roughly
  `new PrismaClient({ adapter: new PrismaPg({ connectionString, max, … }), log })`
  (JIM confirms the exact `@prisma/adapter-pg` 7.x API against the installed version and
  records it in the corrective report).
- **New production dependencies.** `@prisma/adapter-pg` and `pg` move into
  `dependencies` (not `devDependencies`) — the running app now opens its own `pg` pool.
  `@types/pg` in `devDependencies`.
- **The connection pool is now `pg`'s, not Prisma's engine pool.** `DATABASE_URL`'s
  `?connection_limit=5` — added in Phase 4 (ADR-0011) so the advisory-lock tests run
  against the same 2-vCPU pool starvation CI has — **is not read by `pg`**. Its value,
  and any `pool_timeout` / `connect_timeout`, must be translated into `pg.Pool`
  options (`max`, `idleTimeoutMillis`, `connectionTimeoutMillis`) so the Phase 4
  concurrency tests keep their exact semantics. This is the single most likely place
  for a silent regression.
- **Raw-SQL parameter binding.** The query engine and the `pg` adapter send bind
  parameters to PostgreSQL differently. Today `advisoryXactLock` casts `${namespace}::int`
  with the comment *"Prisma binds a tagged-template number as `bigint`, and
  `pg_advisory_xact_lock(bigint, int)` does not exist"*. Under the adapter that coercion
  may change in either direction. Every raw statement is re-verified (list below).
- **CLI vs client.** `prisma migrate deploy` / `prisma generate` / `prisma db execute`
  use their own connection, from `DATABASE_URL` (or a `prisma.config.ts` if Prisma 7
  requires one). CI runs `npx prisma generate` then `npx prisma migrate deploy` then
  `npm run db:seed` explicitly, and `tests/integration/schema.test.ts` now provisions a
  scratch DB the same way — all of that must still work.
- **`mysql2` transitive advisory.** Prisma 7 pulls a `mysql2` with a high advisory. We
  use PostgreSQL only; kill it with an `overrides` pin (`package.json#overrides`, same
  shape as the existing `postcss` / `deepmerge-ts` pins) so `npm audit --audit-level=high`
  (a CI gate) stays at 0.
- **Node.** `engines.node` is already `^22.13.0 || ^24.0.0 || >=26.0.0`; CI / `.nvmrc` =
  `22.20.0`. Confirm that satisfies Prisma 7.10's floor and leave it unchanged unless it
  does not.
- **`@auth/prisma-adapter` `2.11.3`** — confirm it is compatible with `@prisma/client` 7;
  bump only if required, minimally.

## Task breakdown

**T1 — dependencies.** Bump `prisma` + `@prisma/client` to the same `7.x`. Add
`@prisma/adapter-pg` + `pg` to `dependencies`, `@types/pg` to `devDependencies`. Add the
`mysql2` `overrides` pin. `npm install`, commit the lockfile. `npm audit --audit-level=high`
= 0 (with and without `--omit=dev`).

**T2 — `createClient()`.** Rewrite the factory in `src/modules/platform/db/index.ts` to
build the client on a `PrismaPg` adapter over a `pg.Pool`. Translate `DATABASE_URL`'s
`connection_limit` / `pool_timeout` / `connect_timeout` into `Pool` options — a URL with
`?connection_limit=5` must produce a pool of `max: 5`. Keep the `log` behaviour
(`['warn','error']` local, `['error']` otherwise) and the `globalThis` singleton cache.
Nothing else in the file's public surface (`Tx`, `DbExecutor`, `withTransaction`,
`LOCK_NAMESPACE`, `advisoryXactLock`, `tryAdvisoryXactLock`, `selectForUpdate`,
`selectManyForUpdate`, health helpers) changes shape.

**T3 — schema + config.** Adjust `prisma/schema.prisma` / add `prisma.config.ts` only as
Prisma 7.x strictly requires for the CLI to run `generate` + `migrate deploy` + the
scratch-DB flow. Keep the `generator client` on the **query-engine `prisma-client-js`
generator**. **If Prisma 7.x forces the new `prisma-client` generator** (ESM-only output,
custom output path, changed import specifiers, mandatory `prisma.config.ts`) — **STOP and
report to Michael before proceeding.** That is a scope change (import rewrites across the
codebase, ESM/CJS interop) that needs a fresh decision, not absorption into this task.

**T4 — raw-SQL re-verification.** For every statement below: prove it still does what it
did — the lock actually locks / the row is actually locked `FOR UPDATE` / the count comes
back the right type / booleans coerce — under the adapter, with an integration test that
would fail if it silently degraded. Where a statement needs a rewrite (a cast added or
changed) to keep working, make it minimal and document it per-statement in the report.
  - `src/modules/platform/db/index.ts`: `advisoryXactLock` (`${namespace}::int`,
    `hashtext`), `tryAdvisoryXactLock` (`pg_try_advisory_xact_lock`, boolean column),
    `selectForUpdate` / `selectManyForUpdate` (`FOR UPDATE`, `Prisma.join`),
    `readMigrationAttempts` (`… IS NOT NULL AS "finished"` boolean aliases), `SELECT 1`.
  - `src/modules/catalog/repo.ts:106` `pg_advisory_xact_lock(${CATEGORY_TREE_LOCK})`
    (single `int8` arg, **no cast today** — verify it still resolves to the right
    overload); `:341` the `pg_trgm` search `$queryRaw<SearchHit[]>`; `:366` the
    `{ count: bigint }` aggregate.
  - `src/modules/cart/repo.ts:82`, `src/modules/orders/repo.ts:58` — `FOR UPDATE` reads.
  - `src/modules/pricing/repo.ts:159` advisory lock, `:183` locked `StoreProduct` read.
  - `src/modules/identity/repo.ts:158` `$queryRaw`.
  - `tests/integration/schema.test.ts` — `information_schema` reads +
    `$executeRawUnsafe('CREATE DATABASE …')` (cannot run inside a transaction — confirm
    the adapter still allows it).

**T5 — transactions.** `withTransaction` / `$transaction((tx) => …)` still runs
interactively through the adapter; isolation levels still honoured; a `SELECT … FOR
UPDATE` inside a `withTransaction` still holds the lock for the transaction's life
(there is already a 2-connection lock test — it must still pass).

**T6 — migrate / generate / seed / drift.** `npx prisma generate`, `npx prisma migrate
deploy`, `npm run db:seed`, `npm run db:reset`, `npm run db:manifest` all still work.
`prisma migrate diff` against a freshly-migrated DB stays **empty** — the GIN `pg_trgm`
`map:` fix and `tests/integration/migration-drift.test.ts` still hold. `EXPECTED_MIGRATIONS`
/ `scripts/generate-migration-manifest.mjs` unchanged in output.

**T7 — CI / Docker / infra.** `.github/workflows/ci.yml` + `e2e.yml` still green with no
step change beyond what Prisma 7 strictly needs. Confirm `.nvmrc` / `NODE_VERSION` /
Dockerfile Node satisfies Prisma 7; change only if forced. If the app image needs `pg`
native bits, note it.

**T8 — report.** Self-contained corrective report (`agents/jim-builder-mtom7nt5/…`):
exact Prisma 7.x version pinned, the exact `@prisma/adapter-pg` API used, the pool-option
translation table (URL param → `Pool` option), the per-statement raw-SQL verification
results, and the local + hosted gate evidence.

## OSCAR — independent review scope

1. **Raw-SQL parity.** Independently confirm, statement by statement (T4 list), that the
   locks lock and the `FOR UPDATE` reads lock under the adapter — reproduce a 2-connection
   contention test for `advisoryXactLock`, `tryAdvisoryXactLock` and `selectForUpdate`,
   and a negative check that removing the lock fails it.
2. **Pool semantics.** Verify `?connection_limit=5` → `max: 5`: the Phase 4 advisory-lock
   pool-exhaustion tests (`tests/integration/checkout-place-order.test.ts`, the N≫C slot
   test) still exhibit the same behaviour, and a run with a mis-translated pool size
   fails them.
3. **Transactions.** Interactive `$transaction`, isolation levels, `FOR UPDATE` held for
   the tx — the existing 2-connection lock test plus one of your own.
4. **No behaviour / schema change.** `git diff` shows no `prisma/schema.prisma` model
   change; `prisma migrate diff` on a fresh DB is empty; `EXPECTED_MIGRATIONS` output
   identical; no new migration.
5. **Generator.** Confirm the client is still the query-engine `prisma-client-js`
   generator (or, if Prisma 7 forced the new one, that Michael signed off on the expanded
   scope).
6. **Supply-chain.** `npm audit --audit-level=high` = 0 with the `mysql2` pin; the pin is
   the minimal necessary; no other transitive high/critical introduced.
7. **Hosted gates** green on the exact candidate (Michael ties the run IDs).
   Env-constrained acceptance basis as before if OSCAR still has no local PG.

## Acceptance gate

1. JIM delivers the branch + PR + report; local gates green on the exact head —
   `typecheck` · `lint` · `prettier --check` · `npm test` (unit) · `npm run test:integration`
   · `npm run test:e2e` · `npm audit --audit-level=high` (0) · `next build`.
2. Hosted CI (`typecheck + lint + build`, `integration tests (real Postgres)`) + full
   Playwright green on the exact candidate; Michael `gh`-verifies the run IDs.
3. OSCAR PASS on the review scope above.
4. Michael merges to `main`. Tag `v0.4.1-prisma7` (annotated).

## Boundaries

- **Prisma 6.19.3 → 7.x driver-adapter migration only.** No schema model changes. No
  query-behaviour changes. No new features. No refactors beyond what the adapter requires.
- **Keep the `prisma-client-js` (query-engine) generator.** If Prisma 7.x makes that
  impossible, STOP and report — do not migrate the codebase to the new generator inside
  this task.
- No Phase 5 work. No storefront work. No Dependabot bumps beyond Prisma 7 + its adapter
  + the `mysql2` `overrides` pin + `@auth/prisma-adapter` **only if** required.
- No `engines.node` change unless Prisma 7.10 forces it.
- If the `pg` pool needs tuning beyond translating existing `DATABASE_URL` params, that's
  a note for a follow-up card, not a change here.
