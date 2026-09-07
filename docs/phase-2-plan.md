# Phase 2 — Identity + Catalog + Inventory core (implementation plan)

**Owner (build):** JIM Builder · **Independent review/test:** OSCAR Reviewer ·
**Integration + acceptance:** Michael
**Authorised against:** `docs/phase-0-architecture.md` (v2.1) + `docs/adr/README.md`
**Builds on:** Phase 1 (`v0.1.0-foundation`, `main @ 651985c`) — the `platform`
kernel, the revised Prisma schema, module skeletons, boundary lint, CI, `/api/health`.
**Status:** draft 2026-09-07

> Phase 2 makes the **back office** real: staff can sign in, and an authorised
> user can manage stores, delivery zones/areas, the catalogue, per-store listings
> and prices, and per-store website stock — **every sensitive mutation audited**.
> **No customer-facing surface.** No storefront, no cart, no checkout, no orders,
> no picking/delivery. Those are Phase 3+.

---

## Objective

Turn the Phase 1 skeleton modules `identity`, `stores`, `catalog`, `pricing`,
`inventory` and `admin` into working features with real RBAC, a real audit trail,
and the inventory ledger invariant genuinely enforced — plus the admin screens to
drive them. `main` stays CI + E2E green.

## What Phase 1 already gives us (do not rebuild)

- `platform` kernel: `config`, `logger`, `db` (`getPrisma`, `withTransaction`, the
  **branded `Tx` handle**, `selectForUpdate`), `errors` + edge mapper, `event-bus`,
  `money` (integer paise, exact rounding), `ids`, `authz` **stub**, `observability`.
- Full revised Prisma schema (arch §3) already migrated + seeded: `User`,
  `Session`, `AuditLog`, `Store`, `StoreSettings`, `DeliveryZone`, `DeliveryArea`,
  `Category`, `Product`, `ProductImage`, `StoreProduct`, `PriceChange`,
  `InventoryItem`, `StockLedger`, `PosSkuMap`, `FeatureFlag`, plus the
  customer/cart/order/fulfillment tables (**left dormant this phase**).
- `StockLedger` reasons + `balanceAfter`; `DeliveryArea.pincode` nullable/non-unique.
- Module boundary lint (`import/no-restricted-paths`); `admin` may import the other
  modules only via their `index.ts`; `app/**` may not import any `repo.ts`.
- CI (`ci.yml` on PR + push-to-main) and `e2e.yml` (Playwright on main).

## Deliverables

### D1 — `identity`: staff auth + real RBAC

- **Auth.js v5** (credentials provider + Prisma adapter, **DB sessions**).
  `argon2id` password hashing (arch §5 / §20). Session rotation on login, absolute
  timeout, secure `SameSite` cookies, origin check on server actions. **No public
  signup** — a `SUPER_ADMIN` creates users.
- `User` management service: create / disable / re-enable / change role / reset
  password / assign `storeId`. `SUPER_ADMIN` has `storeId = null`; `STORE_MANAGER`
  and `STORE_STAFF` **must** have a `storeId`. Emits `user.created`,
  `user.disabled`. Every mutation writes an `AuditLog` row (before/after JSON).
- **Replace the `authz` stub with a real deny-by-default rule table.** Remove the
  `AUTHZ_ACCEPTED_EXCEPTIONS` grant-all for `system` / `SUPER_ADMIN`; keep the
  `system` actor as an explicit, tested internal principal only for boot/seed/event
  handlers, not a wildcard. Rules by role:
  - `SUPER_ADMIN` — every action, all stores.
  - `STORE_MANAGER` — read + write only for resources whose `storeId ∈
    principal.allowedStoreIds`: their store's `StoreSettings`, `DeliveryZone` /
    `DeliveryArea`, `StoreProduct` (listing + price), `InventoryItem` + adjustments,
    their store's `STORE_STAFF` users. **No** catalogue master writes, **no** other
    store, **no** `SUPER_ADMIN`/user-role changes outside their staff.
  - `STORE_STAFF` — read-only in Phase 2 (picking/POS/delivery write paths arrive
    in Phase 4/5).
- `allowedStoreIds` helper: derived from the session principal; **every**
  store-bound repo query filters by it — no IDOR, no cross-store read or write.
- Middleware gates `/admin/*`; **every** server action / route handler
  **re-checks** `authorize(...)` server-side (middleware is not the boundary).
- TOTP 2FA: schema field already exists; wire an **optional** enrol/verify path,
  not enforced this phase (recommended-on for `SUPER_ADMIN`, documented).

### D2 — `stores`: stores, settings, zones/areas, serviceability

- CRUD for `Store` + `StoreSettings` (`SUPER_ADMIN`; `STORE_MANAGER` may edit only
  their own `StoreSettings` fields — fees, min order, slot length/capacity,
  variance thresholds, `isAcceptingOrders`, `substitutionPolicy`; **not** `posMode`
  — that stays `SUPER_ADMIN`). Money fields are integer paise. `AuditLog` on every
  settings change.
- CRUD for `DeliveryZone` (belongs to exactly one store) and `DeliveryArea`
  (locality/neighbourhood/sector; optional non-unique `pincode`; `matchHints` JSON;
  nullable `geo`). `STORE_MANAGER` scoped to their store's zones.
- **`resolveServiceability(input) → { servable, storeId?, zoneId?, areaId?,
  deliveryFeePaise?, minOrderPaise?, slots? }`** — the real V1 implementation
  behind the stable interface (arch §15): match `input` (chosen `DeliveryArea` id,
  or a locality string + optional pincode) against store-curated areas; return that
  area's store. **Two areas under different stores that share a pincode must
  resolve to their own store** — pincode is a hint, not the key. Out-of-zone →
  `servable:false` (+ optional `ServiceabilityRequest` capture). No PostGIS.
- No storefront consumes this yet; it must be unit-testable in isolation.

### D3 — `catalog`: shared global master

- `Category` tree CRUD (`parentId`, `sortKey`, slug unique, `isActive`); guard
  against cycles.
- `Product` CRUD — **one shared global row per real product**, `sku` **unique**
  (barcode where available), `slug` **unique**, `packSize`, `categoryId`,
  `attributesJson`, `aisleSortKey`, `isActive`. **Never** duplicated per store.
  `SUPER_ADMIN` only (catalogue master is global). Emits `product.updated`.
- `ProductImage` add/reorder/remove (`url`, `sortKey`, `alt`); store the URL only —
  object-storage upload wiring is **not** in this phase (accept a URL / stub).
- **Search scaffold**: Postgres `pg_trgm` / `ILIKE` on `name` + `brand`, exposed as
  a `catalog` service function for later storefront use. Add the `pg_trgm` extension
  + index via migration. No external search service.
- `AuditLog` on product create / update / deactivate.

### D4 — `pricing`: per-store listing + price

- `StoreProduct` per `(storeId, productId)`: `isListed` toggle, `mrpPaise`,
  `sellingPricePaise` (integer paise; `sellingPricePaise ≤ mrpPaise` enforced;
  both `> 0`). Independent per store.
- **Every** price change writes a `PriceChange` row (append-only:
  old/new selling + mrp, `actorUserId`, optional `reason`, `createdAt`) **in the
  same transaction** as the `StoreProduct` update. Emits `price.changed`.
- `AuditLog` in addition to `PriceChange` (PriceChange is the domain history;
  AuditLog is the generic sensitive-mutation trail).
- `STORE_MANAGER` scoped to their store; `SUPER_ADMIN` any store. Listing a product
  not in the catalogue master is impossible (FK + service check).

### D5 — `inventory` core: `websiteStock` + ledger + manual adjust + reconcile

- **Invariant (arch §7):** `InventoryItem.websiteStock` is **never** mutated outside
  a `withTransaction` block that also writes exactly one `StockLedger` row whose
  `balanceAfter` equals the resulting `websiteStock`. Enforce via the branded `Tx`
  handle — the ledger-write + stock-write API **must** require the `Tx` (no
  `getPrisma()` fallback path).
- Operations this phase:
  - **Manual adjust** — `+= delta` (signed), reason `MANUAL_ADJUST`, actor + note;
    reject if result `< 0`.
  - **Reconcile** — `= counted`, logs the delta, reason `RECONCILE`, sets
    `lastCountedAt`.
  - **Low-stock query** — items at/below a per-store or per-item threshold
    (threshold source: `StoreSettings` or a constant — document the choice).
  - **Per-product ledger view** — filter by reason / date range / actor, newest
    first, with running `balanceAfter`.
- Emits `stock.changed` (every mutation) and `stock.low` (when a mutation crosses
  the threshold downward).
- `SELECT … FOR UPDATE` on the `InventoryItem` row for every mutation (the raw-SQL
  helper already exists) so concurrent adjust/import/reconcile serialise.
- `ORDER_PLACED` / `PICK_SHORT_RESTORE` / `ADMIN_CORRECTION` / `POS_SYNC` reasons
  are **not** exercised this phase (Phase 4/5) but the ledger-write API must already
  accept them.

### D6 — `inventory` CSV/Excel import + import history

- Upload a CSV/Excel file → parse → **validate every row before applying any**
  (`sku` resolves to a `Product` **and** a `StoreProduct` for the target store;
  quantity is a non-negative integer; mode is `set` or `delta`) → apply **all rows
  in one transaction**, one `StockLedger` row per changed item, reason
  `CSV_IMPORT`, `balanceAfter` correct.
- **Dry-run mode** — validate + report the diff without writing.
- Malformed / unknown-SKU / out-of-scope-store rows → the whole import is rejected
  with a per-row error report; **no partial application**.
- **Import history** — who / when / filename / row counts / outcome; downloadable
  error report. Re-running the same file is safe (it's just another set/delta;
  document that `set` is idempotent, `delta` is not).
- File-size / row-count guard; reject binary junk.

### D7 — `admin`: BFF + operational screens

- Route group `src/app/(admin)/admin/*`, gated by middleware **and** per-action
  server checks. `admin` holds **read-models / BFF only — no domain rules**; it
  calls the other modules via their `index.ts`.
- Screens (server-rendered, mobile-friendly, minimal Radix/shadcn):
  1. **Sign in / sign out** (Auth.js) + "change my password".
  2. **Users** (`SUPER_ADMIN`; `STORE_MANAGER` sees only their store's staff) —
     list, create, disable, role, store assignment, reset password.
  3. **Stores & settings** — list stores; edit `StoreSettings` (scoped).
  4. **Delivery zones & areas** — per store; add/edit zones and areas; a
     "test serviceability" box that calls `resolveServiceability`.
  5. **Categories** — tree editor.
  6. **Products** (catalogue master) — list + search, create/edit, images.
  7. **Store listings & prices** — per store: list products, toggle `isListed`,
     edit `mrpPaise` / `sellingPricePaise`; show the `PriceChange` history.
  8. **Inventory** — per store: current `websiteStock` + `updatedAt` /
     `lastCountedAt`; manual adjust; reconcile; **CSV/Excel import** (with
     dry-run); per-product **ledger view**; **low-stock report**; import history.
  9. **Audit log viewer** — filter by entity type / actor / date (read-only list;
     rich dashboards are Phase 6).
- Every list that shows store-bound data is filtered by `allowedStoreIds`.

### D8 — migrations, seed, docs

- All schema changes as **additive** Prisma migrations (new extension `pg_trgm`,
  new indexes, any nullable columns). No destructive change to Phase 1 tables.
- Extend `seed.ts` so the back office is demoable: keep it idempotent; add a couple
  more products/categories and a low-stock item; leave the shared-pincode areas.
- `README.md` — admin sign-in instructions + the seeded credentials (dev only) +
  the CSV import format.
- `docs/adr/README.md` — a short **ADR-0009** if the authz rule-table design needs
  recording (recommended); update the Phase 1 authz "documented exception" note to
  "resolved in Phase 2".

## Task breakdown (one PR each, `feat/p2-*`, stacked on `main @ 651985c`)

| PR | Scope | Key tests |
|---|---|---|
| **P2-1** | `identity`: Auth.js v5 credentials + Prisma adapter + DB sessions; argon2id; `User` service (create/disable/role/store/reset); **real `authz` rule table** replacing the stub; `allowedStoreIds`; middleware + server-action re-checks; TOTP optional scaffold; `AuditLog` on user mutations. | unit: authz decision matrix (every role × action × same/other store); integration: login issues a DB session, rotation, logout invalidates, disabled user can't log in; cross-store denial. |
| **P2-2** | `stores`: `Store` + `StoreSettings` CRUD (scoped); `DeliveryZone` / `DeliveryArea` CRUD (scoped); **`resolveServiceability` real impl**; `AuditLog` on settings. | unit: `resolveServiceability` incl. shared-pincode → correct store, out-of-zone; integration: `STORE_MANAGER` cannot edit another store's settings/zones. |
| **P2-3** | `catalog`: `Category` tree (cycle-guard) + `Product` (unique sku/slug) + `ProductImage`; `pg_trgm` extension + search function; `AuditLog`; emits `product.updated`. | unit: slug/sku uniqueness, cycle rejection, search ranking basics; integration: product is one shared row, listed by both stores without duplication. |
| **P2-4** | `pricing`: `StoreProduct` listing + price; `PriceChange` append-only **in-tx**; `sellingPricePaise ≤ mrpPaise`; emits `price.changed`; `AuditLog`; scoping. | unit: price validation; integration: every price edit writes exactly one `PriceChange` in the same tx; `STORE_MANAGER` scoped. |
| **P2-5** | `inventory` core: manual adjust + reconcile + low-stock + ledger view; **`Tx`-enforced** stock+ledger write; `FOR UPDATE`; emits `stock.changed` / `stock.low`. | integration: `balanceAfter` invariant on every path; negative-result rejected; concurrent adjust vs reconcile serialise; `stock.low` fires on downward threshold cross. |
| **P2-6** | `inventory` CSV/Excel import: validate-all-then-apply-in-one-tx; dry-run; per-row error report; import history; size/row guard. | integration: malformed row → whole import rejected, zero writes; dry-run writes nothing; N valid rows → N `CSV_IMPORT` ledger rows with correct `balanceAfter`; kill mid-import → full rollback. |
| **P2-7** | `admin`: route group + middleware + per-action checks; all 9 screens as BFF over `index.ts`; `allowedStoreIds` filtering everywhere; audit-log viewer. | e2e (Playwright): `SUPER_ADMIN` logs in → creates a `STORE_MANAGER` → manager logs in → lists a product + sets a price + adjusts stock + runs a CSV import + sees the ledger; **negative:** manager gets 403 on the other store's inventory. |

PRs may be combined if small; keep P2-1 (auth/authz) and P2-5/P2-6 (ledger
invariant) individually reviewable.

## Definition of Done (Phase 2)

- [ ] `main` green in **hosted CI** (typecheck, lint incl. boundaries, unit,
      integration on real Postgres, `next build`) **and** the Playwright job, on the
      exact merge candidate.
- [ ] A `SUPER_ADMIN` can manage stores, settings, zones/areas, categories,
      products, images, per-store listings + prices, and per-store inventory
      (adjust / reconcile / CSV import / ledger / low-stock) end to end from the
      admin UI.
- [ ] Auth: staff sign in with email + argon2id password, DB session, rotation on
      login, logout invalidates, disabled user is refused, no public signup.
- [ ] **RBAC is deny-by-default and real** — the Phase 1 grant-all exception is
      gone. A `STORE_MANAGER` can act only within their store and is refused
      (server-side, not just hidden) on every other store's data and on catalogue
      master writes. Proven by integration tests.
- [ ] **Ledger invariant holds on every path** — manual adjust, reconcile, CSV
      import each write exactly one `StockLedger` row with correct `delta` and
      `balanceAfter` **in the same transaction**; a mid-operation failure leaves no
      partial write; concurrent mutations serialise (`FOR UPDATE`).
- [ ] **CSV/Excel import**: validate-all-before-apply, atomic, dry-run works, bad
      rows produce a clear per-row report with **zero** partial application; import
      history recorded.
- [ ] Every price change writes an append-only `PriceChange`; every sensitive
      mutation (user, settings, price, stock, catalogue) writes an `AuditLog`
      before/after row.
- [ ] `resolveServiceability` returns the correct store for two areas that share a
      pincode under different stores, and `servable:false` out of zone. Unit-tested.
- [ ] `Product` `sku` + `slug` unique at the DB level; a product is a single shared
      row used by both stores' `StoreProduct`.
- [ ] Boundary lint still green; `admin` imports only via `index.ts`; no `app/**` →
      `repo.ts`. `/api/health` still green. Seed still idempotent.
- [ ] No secrets committed; deps pinned; `npm audit` clean of high/critical.
- [ ] OSCAR independent review sign-off recorded; Michael merged to `main` and
      tagged `v0.2.0-backoffice`.

## Boundaries — explicitly NOT in Phase 2

- **No customer-facing surface at all** — no storefront pages, no product pages for
  shoppers, no locality picker UI, no cart, no checkout, no order placement, no
  guest order-status page. `resolveServiceability` is built but only the admin
  "test" box calls it.
- **No `customers` feature work** — the tables stay dormant; no customer accounts,
  no phone OTP (`FeatureFlag.customer_otp_login` stays OFF), no SMS/email sending
  (`notifications` remains a no-op / outbound-log; `user.created` etc. are logged,
  not delivered).
- **No orders / picking / POS billing / delivery / fulfillment logic** — those
  tables stay dormant; the `ORDER_PLACED` / `PICK_SHORT_RESTORE` / `ADMIN_CORRECTION`
  ledger reasons are accepted by the API but never triggered.
- **No POS adapter** — `PosSkuMap` stays unused; `NoopInventoryFeed` stays; CSV
  import + reconcile are the real (permanent) inventory-sync baseline
  (arch §16.1 / ADR-0007). Assume no POS API/docs/webhooks/endpoints/DB access.
- **No object-storage upload wiring** — `ProductImage` takes a URL / stub.
- **No dashboards, reports, analytics, or the stuck-order digest** — Phase 6.
- **No promotions / coupons / discounts, no product variants, no substitutions.**
- **No polygon/geo serviceability** — `geo` columns stay nullable, no PostGIS.
- **No production hosting or managed-Postgres vendor/budget decision** — Phase 7.
- **No rate-limit / security hardening pass or load testing** — Phase 6 (keep
  whatever `RATE_LIMIT_*` config the kernel already reads; don't build the limiter).
- **No 2FA enforcement** — optional enrol path only.

## OSCAR — independent review scope for Phase 2

Review each PR and the merged result independently (own checkout/worktree, own test
run, own hosted-CI check on the exact candidate). Findings as written notes to
Michael — **no silent fixes**.

- **RBAC / tenancy isolation** — construct a `STORE_MANAGER` principal for store A
  and confirm, server-side (not just UI-hidden), that it is refused: store B's
  `StoreSettings`, `DeliveryZone`/`Area`, `StoreProduct` price/listing,
  `InventoryItem` adjust, store B staff, catalogue-master writes, and any
  `SUPER_ADMIN`-only action. Confirm middleware is **not** the only gate — hit a
  server action / route handler directly. Confirm every store-bound list filters by
  `allowedStoreIds` (try to page/scroll to another store's rows). Confirm the
  `authz` stub's grant-all is gone and `system` is a scoped, tested principal.
- **Auth** — argon2id (not bcrypt/plaintext/fast hash); DB session really in the
  DB; session rotates on login; logout + disable invalidate live sessions; no
  public signup route; origin/CSRF checks on server actions; password reset can't
  be used for enumeration.
- **Ledger invariant** — for manual adjust, reconcile, and CSV import: exactly one
  `StockLedger` row per changed item, `delta` and `balanceAfter` correct, written
  in the **same transaction** as the `websiteStock` change; force a failure
  mid-operation (kill / raise) and confirm **no** partial write; run two mutations
  concurrently and confirm they serialise via `FOR UPDATE` and neither corrupts
  `balanceAfter`; confirm the write API cannot be called with a plain client (the
  branded `Tx` still holds).
- **CSV/Excel import** — malformed row, unknown SKU, wrong-store SKU, negative qty,
  non-integer qty, empty file, huge file, binary file: each rejected with a clear
  per-row/whole-file error and **zero** rows written; dry-run writes nothing and
  reports the true diff; a successful import's history entry matches what changed.
- **Pricing** — every price edit produces one append-only `PriceChange` in-tx;
  `sellingPricePaise ≤ mrpPaise` and `> 0` enforced; money is integer paise
  end-to-end (no float, no rupee strings in the DB or API).
- **Catalog** — `sku` + `slug` unique at the DB level (not just app check); a
  product listed by both stores is one `Product` row; category cycle rejected;
  `pg_trgm` extension + index actually created by a migration.
- **Serviceability** — `resolveServiceability` returns each store for two
  same-pincode areas under different stores; out-of-zone → `servable:false`;
  interface shape matches arch §15 so a future geo rule needs no caller change.
- **Audit** — `AuditLog` before/after JSON on user / settings / price / stock /
  catalogue mutations; append-only tables (`PriceChange`, `StockLedger`,
  `AuditLog`, `OrderStatusHistory`) are never updated or deleted by any Phase 2
  path.
- **Boundaries & regressions** — boundary lint still rejects a crafted cross-module
  deep import; `admin` touches other modules only via `index.ts`; `app/**` can't
  import `repo.ts`; migrations are additive and re-runnable; seed still idempotent;
  `/api/health` still reports correctly; Phase 1 tests still pass.
- **Security** — no secrets in repo/history; deps pinned; `npm audit` clean of
  high/critical; no new abandoned deps; file-upload path can't be used for path
  traversal or zip-bomb-style resource exhaustion.

Deliver: a PASS / CHANGES-REQUESTED note per PR + a Phase-2 summary verdict, and an
explicit statement that hosted CI + the Playwright job are green on the exact merge
candidate.

## Acceptance gate (before Michael merges + tags `v0.2.0-backoffice`)

1. JIM delivers `feat/p2-1..p2-7` (stacked; merging the tip brings all of Phase 2).
2. OSCAR independent review → PASS, with the tenancy-isolation and ledger-invariant
   checks reproduced.
3. Green hosted CI + integration + Playwright on the exact candidate commit.
