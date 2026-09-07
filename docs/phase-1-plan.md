# Phase 1 — Foundation & Skeleton (implementation plan)

**Owner (build):** JIM Builder · **Independent review/test:** OSCAR Reviewer ·
**Integration + acceptance:** Michael
**Authorised against:** `docs/phase-0-architecture.md` (v2.1) + `docs/adr/README.md`
**Status:** dispatched 2026-09-06 · amended 2026-09-07 (POS capability dependency —
arch §16.1 / ADR-0007; see "POS boundary in Phase 1" below)

> Phase 1 stands up the skeleton so Phase 2 can build features. **No business
> features.** No storefront pages, no admin screens, no auth flows, no cart /
> checkout / order logic beyond schema + the transaction/ledger scaffold.

---

## Objective

A running, CI-green Next.js modular-monolith skeleton with the revised database
schema, the `platform` kernel, enforced module boundaries, a dev container
environment, and a test harness — nothing more.

## Deliverables

1. **Project scaffold** — Next.js 15 (App Router) + TypeScript **strict**
   (`noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`), Tailwind + a minimal
   Radix/shadcn setup, ESLint (`typescript-eslint` recommended-type-checked) +
   Prettier + **`import/no-restricted-paths` module-boundary rules**, `package.json`
   scripts (`dev`, `build`, `start`, `lint`, `typecheck`, `test`, `test:integration`,
   `test:e2e`, `db:migrate`, `db:seed`).
2. **`src/modules/platform/` kernel**
   - `config` — Zod-validated env loader; the app **refuses to boot** on missing/
     invalid env. Keys per arch §22 (`DATABASE_URL`, `AUTH_SECRET`, `AUTH_URL`,
     `APP_ENV`, `DEFAULT_CURRENCY=INR`, optional `SENTRY_DSN`, `STORAGE_*`,
     `RATE_LIMIT_*`). No SMS keys.
   - `logger` — pino JSON + request-id correlation via `AsyncLocalStorage`.
   - `db` — Prisma client singleton + a `withTransaction` helper and a
     `selectForUpdate` raw-SQL helper (used later by inventory).
   - `errors` — `AppError` hierarchy (`ValidationError`, `NotFoundError`,
     `ConflictError`, `AuthzError`, `DomainError`) + a single edge mapper to HTTP /
     UI-safe payloads (no stack traces to client in prod).
   - `event-bus` — synchronous typed in-process bus (`emit`, `on`), boot-time
     handler registration point.
   - `money` — integer-paise type + `add` / `mul` / `format` (INR).
   - `ids` — id + opaque-token generators (`cartToken`, `trackingToken`).
   - `authz` — `authorize(principal, action, resource)` stub: deny-by-default + the
     `allowedStoreIds` scoping helper signature (no real rules yet).
   - `observability` — thin wrapper around Sentry/GlitchTip, no-op unless
     `SENTRY_DSN` set.
3. **Prisma schema + initial migration + seed** — the **full revised schema** from
   arch §3 / section B. Must include:
   - `InventoryItem.websiteStock` as the single quantity — **no `reservedQty`**.
   - `StockLedger` with reasons `MANUAL_ADJUST | CSV_IMPORT | RECONCILE |
     ORDER_PLACED | PICK_SHORT_RESTORE | ADMIN_CORRECTION | POS_SYNC` and a
     `balanceAfter` column.
   - `DeliveryArea.pincode` **nullable and non-unique** (add a non-unique index).
   - `Order` with `trackingToken` (unique), `priceVarianceFlagged`,
     `customerConfirmedRevisedAmount`, `revisedAmountConfirmedBy`.
   - `OrderLine.stockRestoredQty` (default 0).
   - Order status enum with **no customer-cancel value**; include `CANCELLED_BY_STORE`,
     `DELIVERY_FAILED`, `CLOSED_UNDELIVERED`.
   - `StoreSettings` with `slotLengthMinutes` (default 60), `slotCapacity`
     (default 10), `priceVariancePercentBp` (default 500),
     `priceVarianceAbsCapPaise` (default 5000), `posMode` (`MANUAL` default).
   - `Customer` with nullable `email` + nullable `passwordHash` (guest-first).
   - `FeatureFlag` seeded with `customer_otp_login = false`.
   - `PosSkuMap` (present, unused).
   - `seed.ts` — 2 `Store`s + `StoreSettings`; ~20 `Product`s with unique SKUs;
     per-store `StoreProduct` (partly overlapping listings, different prices) +
     `InventoryItem`; ≥2 `DeliveryZone`s and several `DeliveryArea`s **including two
     areas under different stores that share one pincode** (proves ADR-0004); one
     `SUPER_ADMIN` + one `STORE_MANAGER` + one `STORE_STAFF` per store. Idempotent /
     re-runnable.
4. **`docker/`** — `Dockerfile` (Next.js standalone, **non-root user**, pinned base
   image) + `docker-compose.yml` (app + `postgres:16` + `caddy`) for local prod
   parity.
5. **CI** — GitHub Actions on every PR: `typecheck` → `lint` (incl. boundary rules)
   → `test` (Vitest unit) → `test:integration` (Vitest + a service `postgres:16`) →
   `next build`. A separate workflow runs Playwright on `main` with the one smoke
   test. Dependabot config. `npm audit` step (fail on high/critical).
6. **Module skeletons** — for every module in arch §4: `domain/`, `service.ts`,
   `repo.ts`, `index.ts`, `__tests__/` — empty but boundary-lint-clean. A
   **deliberate cross-module deep-import fixture** that CI proves the lint rejects
   (e.g. a test that runs eslint on a bad snippet and asserts it errors).
7. **`/api/health`** — returns `{ status, db: 'ok'|'down', migrations: 'current'|'pending' }`.
8. **Test infra** — `vitest.config.ts` (unit + integration projects), coverage
   config with the `src/modules/**` gate wired (threshold can start low, gate
   present), `playwright.config.ts`, integration DB setup/teardown
   (docker-compose or Testcontainers), `tests/factories/` builders for
   store / storeSettings / product / storeProduct / inventoryItem / user / customer /
   address / cart / order.
9. **Docs** — `docs/adr/README.md` committed (already drafted); `README.md` with dev
   setup, the script list, and a pointer to `docs/phase-0-architecture.md`.

## Task breakdown (one PR each, `feat/p1-*`)

| PR | Scope |
|---|---|
| **P1-1** | Scaffold: Next.js + TS strict + Tailwind + ESLint/Prettier + **boundary rules** + scripts + CI skeleton (typecheck/lint/build). |
| **P1-2** | `platform` kernel: config, logger, db (+ `withTransaction`, `selectForUpdate`), errors + edge mapper, event-bus, money, ids, authz stub, observability. Unit tests for config-fails-closed, money math, event-bus, error mapper. |
| **P1-3** | Prisma schema (full revised) + initial migration + `seed.ts` (incl. shared-pincode areas + staff users). Integration test: migrate + seed run clean, seed is idempotent. |
| **P1-4** | Module skeletons for all §4 modules + the boundary-violation rejection test. |
| **P1-5** | `docker/Dockerfile` (non-root, pinned) + `docker-compose.yml` (app+pg+caddy); `docker compose up` serves the app locally. |
| **P1-6** | `/api/health` + Vitest integration project wired to a real Postgres + `tests/factories/` + `playwright.config.ts` + one smoke e2e (app loads, `/api/health` ok). Coverage gate wired. |
| **P1-7** | `README.md` + confirm `docs/adr/README.md` committed + `.env.example` complete + Dependabot + `npm audit` CI step. |

PRs may be combined if small, but keep P1-2 and P1-3 reviewable on their own.

## Definition of Done (Phase 1)

- [ ] `main` is green: `typecheck`, `lint` (incl. boundary rules), Vitest unit,
      Vitest integration (real Postgres), `next build` all pass in CI.
- [ ] `docker compose up` brings up app + Postgres + Caddy; the app serves and
      `/api/health` returns `db: ok`, `migrations: current`.
- [ ] `prisma migrate deploy` + `npm run db:seed` run clean from empty; seed is
      re-runnable without error.
- [ ] One Playwright smoke test passes (app loads + health ok).
- [ ] A deliberate cross-module deep import **fails** lint (proven by a test).
- [ ] Prisma schema matches arch §3 / section B exactly on the points listed under
      Deliverable 3 (no `reservedQty`; single `websiteStock`; ledger reasons +
      `balanceAfter`; non-unique `DeliveryArea.pincode`; no customer-cancel status;
      variance fields; `FeatureFlag customer_otp_login=false`).
- [ ] `config` refuses to boot on a missing required env var (tested).
- [ ] No secrets committed; `.env.example` complete; Dockerfile runs as non-root;
      deps pinned; `npm audit` clean of high/critical.
- [ ] `docs/adr/README.md` and `README.md` committed.
- [ ] OSCAR review sign-off recorded; Michael has merged to `main` and tagged
      `v0.1.0-foundation` (optional).

## Boundaries — explicitly NOT in Phase 1

- No storefront or admin **pages/screens** (beyond `/api/health` and the default
  Next root).
- No **auth flows** (staff login, customer accounts, OTP) — only the `authorize()`
  stub and Auth.js dependency install.
- No **cart / checkout / order / picking / delivery / pricing / inventory** business
  logic — schema + kernel scaffolding only. The transaction + ledger *pattern* is
  provided by `platform.db`; it is exercised by Phase 2+, not implemented here.
- No **production DB vendor** choice, no hosting provider, no budget.
- No **real** SMS, Sentry, or object-storage wiring — interfaces / no-op only.
- No **POS adapter** — `PosSkuMap` table only. See "POS boundary" below.
- No performance work, no load testing.

## POS boundary in Phase 1

POS integration is capability-dependent. The platform will integrate only with functionality officially exposed and documented by the selected POS vendor. The website remains operational without POS integration.

Phase 1 builds **only** the POS-neutral seams (arch §16.1, ADR-0007):

- the **POS-neutral interfaces** — `PosBillingGateway`, `PosInventoryFeed` — and
  their V1 implementations: `ManualPosBillingGateway` (staff form),
  `NoopInventoryFeed`, and the manual **CSV/Excel** import path;
- **`PosSkuMap`**, present in the schema and deliberately unused;
- **`StoreSettings.posMode`** (`MANUAL` default), the per-store switch a future
  factory reads.

Nothing else. The POS product has not been chosen, so **assume no API, no API
documentation, no webhooks, no stock endpoints, no billing endpoints, no write
access and no database access.** The storefront, admin, inventory and order flows
must all work with no POS integration whatsoever — manual adjustment, CSV import and
reconciliation are the permanent baseline, not a placeholder.

When a POS is eventually selected, integration takes the **highest option it
actually supports**, in this order:

1. **Official documented POS API**, if available and suitable.
2. **Official webhooks / event feeds**, if available.
3. **Scheduled stock/API polling**, if supported.
4. **CSV / Excel import/export.**
5. **Officially supported read-only database / connector access.**
6. **Manual reconciliation** — the final fallback, and the one that always works.

**No vendor-specific POS adapter is in scope — in Phase 1 or any later phase —
until all four of these hold:**

1. the POS software is **selected**;
2. its **official documentation is reviewed**;
3. the **supported endpoints and data fields are confirmed**;
4. **authentication and rate limits are understood**.

The core architecture does not change with the POS choice; a future adapter is new
files under `*/pos/` plus `PosSkuMap` rows, with no core module or table changes.

## OSCAR — independent review scope for Phase 1

Review each PR and the merged result independently (own checkout/worktree, own test
run). Report findings as written notes to Michael — **no silent fixes**.

- **Schema compliance** vs arch §3 / section B and every DoD schema point above;
  flag any drift, extra `reservedQty`-style field, or a unique constraint on
  `DeliveryArea.pincode`.
- **Boundary enforcement** — independently craft a cross-module deep import and
  confirm lint rejects it; confirm `app/**` cannot import `repo.ts`.
- **Config fails closed** — remove a required env var, confirm the app refuses to
  boot with a clear error.
- **Transaction/ledger scaffold** — confirm `withTransaction` + `selectForUpdate`
  helpers exist and are shaped so a caller *must* pass the tx handle to the ledger
  write (i.e. the pattern makes the invariant easy to hold).
- **CI gates are real** — not `continue-on-error`, integration job actually starts
  Postgres, coverage gate is wired (even if threshold starts low), `npm audit`
  fails the build on high/critical.
- **Security** — no secrets in repo/history; `.env.example` complete; Dockerfile
  non-root + pinned base; dependencies pinned; no obviously abandoned deps.
- **Edge** — migration idempotency (re-run), seed re-runnability, `/api/health`
  behaviour when the DB is down (should report `db: down`, not 500-crash).
- **ADR consistency** — README/ADRs match the code that landed.

Deliver: a PASS / CHANGES-REQUESTED note per PR + a Phase-1 summary verdict.
