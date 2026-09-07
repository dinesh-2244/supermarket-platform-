# Architecture Decision Records

Format per entry: **Context · Decision · Consequences · Status**.
All accepted 2026-09-06 as part of Phase 0 (v2). Supersedes are noted inline.
Full detail: `../phase-0-architecture.md`.

---

## ADR-0001 — Modular monolith on Next.js / TS / PostgreSQL / Prisma / Tailwind

**Context.** Two stores, no expansion plan, one small team. Inventory decrement and
order state changes need atomic multi-row writes. The evaluated baseline is
Next.js + TypeScript + PostgreSQL + Prisma + Tailwind.

**Decision.** Keep the entire baseline. Build a **modular monolith**: one Next.js
(App Router) app (SSR storefront + RBAC admin), one PostgreSQL 16 database via
Prisma, one Docker image. Domain logic in `src/modules/*` behind public `index.ts`
surfaces + a synchronous in-process typed event bus. ESLint `import/no-restricted-paths`
enforces module boundaries. Additions kept minimal: Zod, Auth.js v5 (DB sessions),
argon2id, pino, Vitest, Playwright. Raw SQL only for the stock `SELECT … FOR UPDATE`.
No microservices, Redis, message broker, Kubernetes, or serverless.

**Consequences.** Local ACID transactions for the hot paths. One deploy, one log
stream, low ops burden. Boundaries + event bus preserve the option to extract a
service later. Prisma's weak spot (row locking) is handled with scoped raw SQL.

**Status.** Accepted.

---

## ADR-0002 — Guest-first customer flow; staff RBAC; phone-OTP deferred

**Context.** Hyperlocal COD / UPI-on-delivery. Phone + OTP needs an SMS vendor and
India DLT registration, which are not settled. Ordering must not be blocked on that.

**Decision.**
- Customers **browse and build a cart with no login** (cart keyed by an opaque
  `cartToken` cookie).
- **Checkout collects name + phone + delivery address**; no account is required.
- A lightweight `Customer` row is upserted by phone at checkout (no credential).
- **Optional** email + password customer accounts (Auth.js credentials, DB sessions).
- **Phone + OTP** login is implemented behind `AuthChallengeProvider` +
  `NotificationProvider` interfaces and gated by `FeatureFlag.customer_otp_login`
  (**OFF** for the pilot); enabled post-pilot once SMS + DLT are finalised.
- Guest order tracking via `/order-status/[trackingToken]` (unguessable token).
- **Staff / admin unchanged:** email + argon2id password, optional TOTP 2FA, Auth.js
  DB sessions, no public signup, RBAC roles `SUPER_ADMIN` / `STORE_MANAGER` /
  `STORE_STAFF` with store scoping on every query.

**Consequences.** No SMS dependency in Phase 1. Lower checkout friction. OTP can be
switched on later with no schema change (`OtpChallenge` already in the model).

**Status.** Accepted. (Supersedes the v1 "phone+OTP for customers" assumption.)

---

## ADR-0003 — Shared global Product master, per-store listing / price / stock

**Context.** Both stores sell many of the same physical products. A literal reading
of "separate website inventory" could mean duplicate product rows per store, which
doubles data entry, causes naming drift, and creates two SKUs for one good (bad for
future POS keying).

**Decision.** One shared global `Product` master — one row per real product, unique
`sku` (barcode where available), shared name / brand / category / images / pack
size. Per-store `StoreProduct` carries independent `isListed` and
`sellingPricePaise` / `mrpPaise`. Per-store `InventoryItem` carries independent
`websiteStock`. Store 1 and Store 2 listings, prices and stock are managed on
separate admin screens. **A product is never duplicated into two `Product` rows.**

**Consequences.** One SKU per good → POS-integration-friendly. Independent
management where it matters (listing, price, stock). Slightly more care needed so
admin screens keep the per-store scoping obvious.

**Status.** Accepted (human override R1).

---

## ADR-0004 — Store-mapped delivery zones; pincode is an attribute, not the routing key

**Context.** Real service areas do not cleanly partition by pincode; two
neighbouring localities served by different stores can share a pincode. A previous
draft assumed one globally-unique pincode → one store.

**Decision.** `DeliveryZone` belongs to exactly one `Store`. `DeliveryArea` rows
(locality / neighbourhood / sector, with an **optional non-unique** `pincode` and
match hints) belong to a zone. Pincode is a **stored attribute / validation input**,
not the routing key — two `DeliveryArea` rows may share a pincode, even across
stores. Store assignment goes through a **stable interface**
`stores.resolveServiceability(input) → { servable, storeId?, zoneId?, areaId?,
deliveryFeePaise?, minOrderPaise?, slots? }`. V1 implementation: the customer picks
a locality from a store-curated list, optionally validated against pincode. The
internal rule can later become polygon/geo-based **without changing checkout or any
caller**. No PostGIS in V1; nullable geo columns exist for a future upgrade.

**Consequences.** Correct routing for messy real-world boundaries. Checkout is
insulated from routing-rule changes. Requires curating locality lists per store at
onboarding.

**Status.** Accepted (human override R8). (Supersedes the v1 pincode-unique rule.)

---

## ADR-0005 — Decrement website stock at order placement; POS billing does not re-decrement

**Context.** V1 draft reserved stock at placement and consumed it at POS billing by
picked quantity. The business rule is simpler: there is no normal customer
cancellation, and website stock should reflect what has been committed to online
orders immediately.

**Decision.** `InventoryItem.websiteStock` is a **single quantity** ("Website Stock /
Available to Sell") with **no reservation sub-quantity**. On **successful order
placement**, `websiteStock -= qtyOrdered` per line inside one DB transaction that
also writes a `StockLedger` row (`reason = ORDER_PLACED`, `balanceAfter =
websiteStock`). The transaction takes `SELECT … FOR UPDATE` on each line's
`InventoryItem`; if the result would be negative the whole placement fails with
per-line errors, so two customers cannot both take the last unit. **POS billing does
not change website stock** — it converges the *POS's* own inventory; a
`PosBillingHandoff` row is recorded. **Short-pick / unavailable** lines restore the
difference: `websiteStock += (qtyOrdered − qtyPicked)` in-tx
(`reason = PICK_SHORT_RESTORE`, `stockRestoredQty` set on the line); only the picked
quantity goes through POS. **Admin/store correction** restores the not-yet-restored
quantity (`reason = ADMIN_CORRECTION`, audited). Other reasons: `MANUAL_ADJUST`,
`CSV_IMPORT`, `RECONCILE`, future `POS_SYNC`.

**Invariant.** `websiteStock` is never mutated outside a transaction that writes a
matching `StockLedger` row; `balanceAfter` always equals the resulting `websiteStock`.

**Consequences.** Simple mental model for staff and future integration. No
oversell. Requires disciplined transaction + ledger code in every stock-touching
path (enforced by the module service pattern and integration tests, incl. a
last-unit concurrency test). POS walk-in sales cause temporary drift — accepted for
V1 (ADR-0007 / R12).

**Status.** Accepted (human override R3, R11). (Supersedes the v1 reserve/consume
model.)

---

## ADR-0006 — No customer cancellation; audited admin/store correction only

**Context.** The business does not want customer-initiated cancellation after a
successful order.

**Decision.** No customer-facing cancellation transition exists. The order state
machine is `PLACED → ACCEPTED → PICKING → PICKED → BILLED_IN_POS → PACKED →
OUT_FOR_DELIVERY → DELIVERED → CLOSED`, plus `OUT_FOR_DELIVERY → DELIVERY_FAILED →`
retry or `CLOSED_UNDELIVERED`. A `STORE_MANAGER` / `SUPER_ADMIN` may move an order
to **`CANCELLED_BY_STORE`** (terminal) from any state **before `OUT_FOR_DELIVERY`**,
with a **mandatory reason** (duplicate, fraud/error, can't fulfil, POS failure,
operational mistake). The correction restores not-yet-restored `websiteStock` for
every line (`ADMIN_CORRECTION` ledger rows), writes `AuditLog` (before/after) and a
mandatory `OrderStatusHistory` note. After `BILLED_IN_POS` it also requires a manual
POS void recorded in `discrepancyNote`. Returns / partial returns are post-pilot.

**Consequences.** Fewer customer-facing flows to build and secure. Every reversal is
attributable and audited. Support handles genuine cancellation cases operationally.

**Status.** Accepted (human override R4).

---

## ADR-0007 — POS integration boundary (interfaces only in V1)

**Context.** The purchased POS stays completely separate in V1. A future
integration (inventory sync, SKU mapping, automatic stock import, optional billing)
must not require redesigning core modules.

The POS product has **not been chosen**, and choosing it is what decides whether an
integration is possible at all. Nothing about that vendor may be assumed in advance —
not an API, not API documentation, not webhooks, not stock endpoints, not billing
endpoints, not write access, not database access. Some POS products in this segment
expose none of them. Designing around a capability that turns out not to exist would
put the platform's core on a dependency the business cannot guarantee.

POS integration is capability-dependent. The platform will integrate only with functionality officially exposed and documented by the selected POS vendor. The website remains operational without POS integration.

**Decision.** An anti-corruption layer in `inventory/pos/` and `fulfillment/pos/`.
Core modules depend only on interfaces:
- `PosBillingGateway.recordFinalBill(orderId, { billNumber, finalTotalPaise,
  billedByUserId, discrepancyNote? })` — V1 impl `ManualPosBillingGateway` (staff
  form). Optional `createDraftBill` / `fetchFinalBill` for a future adapter.
- `PosInventoryFeed.pullStockSnapshot(storeId) → [{ posSku, qty }]` — V1 impl
  `NoopInventoryFeed`; manual CSV/Excel import in admin instead.
`PosSkuMap(storeId, productId, posSku)` table exists now, populated later.
`StoreSettings.posMode` (`MANUAL` | `ADAPTER`) selects the impl via a `platform`
factory. `src/app/api/internal/` is reserved for future POS callbacks. A future
adapter = new files under `*/pos/` + `PosSkuMap` rows + a scheduled snapshot pull
writing `POS_SYNC` ledger rows — **no core module or table changes**. Contract tests
are written against the interfaces in Phase 5.

The boundary is **vendor-neutral and stays that way**. The website must remain fully
functional with **no POS integration at all** — manual adjustment, CSV/Excel import
and reconciliation are the V1 path and remain permanently supported, not a stopgap.

When a POS is eventually chosen, integration options are taken **in this order of
preference**, using the highest one the vendor actually supports:

1. **Official documented POS API**, if available and suitable.
2. **Official webhooks / event feeds**, if available.
3. **Scheduled stock/API polling**, if supported.
4. **CSV / Excel import/export.**
5. **Officially supported read-only database / connector access.**
6. **Manual reconciliation** — the final fallback, and the one that always works.

**No vendor-specific POS adapter is built until all four of these hold:**

1. the POS software is **selected**;
2. its **official documentation is reviewed**;
3. the **supported endpoints and data fields are confirmed**;
4. **authentication and rate limits are understood**.

The core website architecture **does not change based on which POS is chosen**. What
is kept regardless: `PosSkuMap`, the POS-neutral adapter interfaces, the manual/CSV
fallback, and per-store `StoreSettings.posMode`.

**Consequences.** POS vendor choice is deferred with zero core impact, and a vendor
that turns out to expose nothing integrable costs the platform nothing but the
manual path it already has. Walk-in drift is tolerated meanwhile (ADR-0005). Slight
upfront cost: interfaces + a no-op impl + `PosSkuMap` shipped unused. The four
preconditions mean an integration cannot start from a sales claim or a screenshot —
only from documentation the vendor stands behind.

**Status.** Accepted (human R14).

---

## ADR-0008 — Deployment: containerized Postgres in dev, managed Postgres preferred in prod, vendor/budget deferred

**Context.** Avoid vendor lock-in and premature cost commitments; keep Phase 1
unblocked.

**Decision.** Dev / CI use local / containerized PostgreSQL via
`docker/docker-compose.yml` (app + postgres + caddy). Production target: Dockerized
Next.js (`output: 'standalone'`) on one small VPS behind Caddy (auto-HTTPS), single
instance, `docker compose pull && up -d` deploys, `prisma migrate deploy` gated
pre-deploy, automated daily + pre-migration backups with a restore drill before
go-live. **Managed PostgreSQL is preferred for production** (zero DB-ops, PITR) but
**no vendor and no monthly budget ceiling are chosen in Phase 1** — both are decided
at the staging/UAT phase (roadmap Phase 7). Optional S3-compatible object storage
behind a `StorageProvider` interface, only if proof photos are enabled. No
serverless, no Kubernetes. Everything is plain Docker + Postgres (+ optional S3 API)
→ portable in under a day; Vercel + managed Postgres is an allowed fallback, not the
default.

**Consequences.** Phase 1 proceeds without a hosting decision. Prod DB choice is a
small, well-contained decision made with real data at staging. Portability
preserved.

**Status.** Accepted (human override R10).

---

## ADR-0009 — Authorization: a closed action union with per-role grant tables

**Context.** Phase 1 shipped an `authorize()` stub that granted everything to the
`system` principal and to `SUPER_ADMIN`, documented as an accepted exception
until a real rule table existed (see the note under ADR-0007's acceptance section
in the Phase 1 review). Phase 2 introduces real staff, real roles and real
tenancy, so the exception has to go.

**Decision.** `platform/authz` holds the rule table; `identity` owns `User` and
staff authentication. Architecture §4 assigns `authorize()` to `platform` and
every module calls it, so the table is kernel code rather than a module's.

- `Action` is a **closed union** of every capability the platform has, not a
  `${string}:${string}` template. A verb that is not in the union is a typo, and
  a typo that silently produced a deny would be indistinguishable from a policy
  decision.
- Each role has an **explicit per-action grant table** — no wildcards, including
  for `SUPER_ADMIN`. A wildcard hands every capability added in a later phase to
  whoever holds it, silently, which is how a deny-by-default table stops being
  one. The cost is one line per action per role; the benefit is that every grant
  is visible in a diff.
- A grant is `global` or `store`-scoped. A store-scoped grant against a resource
  that names **no** store is refused: an unknown store must narrow access, never
  widen it.
- The `system` principal is a **narrow allowlist** of the actions internal code
  actually performs (boot, seed, event handlers) — not a wildcard, so a code path
  that fails to build a real principal cannot fall back to unlimited access.
- `allowedStoreIds` returns `null` for "every store" and an array otherwise.
  Phase 1 returned `[]` for both a super-admin and a user with no store, so
  "unrestricted" and "no access" were the same value; the compiler now asks.
- A store-bound role whose `storeId` is null — a data defect the identity service
  refuses to create — is granted **nothing**, not merely nothing store-scoped.

**Consequences.** Adding a capability is a deliberate, reviewable act in one
file. The tables are verbose by design. Store scoping is enforced in the module
services and in every repository query (`storeScopeFilter`), never in a template
— a list that forgets its filter is an IDOR, so the filtered query is the only
one the module owns. **The Phase 1 grant-all exception is resolved.**

**Status.** Accepted (Phase 2).
