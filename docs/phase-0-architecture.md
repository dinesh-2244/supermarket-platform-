# Phase 0 — Architecture (v2, approved with overrides)

**Project:** Two-store hyperlocal supermarket platform
**Author:** Michael (lead coordinator / architect)
**Status:** **APPROVED 2026-09-06** with the overrides in the Revision Log below.
Amended **2026-09-07** (v2.1, POS capability dependency — §16.1).
Phase 1 may begin against **this** document — not the v1 reservation-at-POS model.
**Repo:** `/Users/dineshkanisetti/Documents/supermarket-platform`

---

## Revision Log

### v2.1 — 2026-09-07 — POS integration is capability-dependent

| # | Change from v2 | Section(s) |
|---|---|---|
| R14a | **POS integration is capability-dependent** on the not-yet-chosen vendor. Nothing about it may be assumed — no API, API documentation, webhooks, stock endpoints, billing endpoints, write access or database access. The website must be **fully functional with no POS integration**; only a **vendor-neutral** boundary is kept. Integration options are ranked in strict order of preference (official API → official webhooks/events → scheduled polling → CSV/Excel → officially supported read-only DB/connector → manual reconciliation). **No vendor-specific adapter** until the POS is selected, its official documentation reviewed, its supported endpoints/fields confirmed, and its authentication and rate limits understood. Core architecture does not change with the POS choice; `PosSkuMap`, the POS-neutral interfaces, the manual/CSV fallback and `StoreSettings.posMode` are kept regardless. | §16.1, R12, R14, ADR-0007 |

### v2 — 2026-09-06 — human approval + overrides

| # | Change from v1 | Section(s) |
|---|---|---|
| R1 | **Product model approved** — one shared global `Product` master (one SKU/barcode per real product), per-store `StoreProduct` (listing + price) and per-store `InventoryItem` (stock). Never duplicate a `Product` row across stores. | §6, §8, ADR-0003 |
| R2 | **Customer auth: guest-first.** Browse without login; add to cart without login; checkout collects name + phone + delivery address; account creation never blocks ordering. Optional email/password customer accounts. Phone+OTP stays behind a provider interface, disabled for the pilot. Staff/admin = email + password + RBAC (unchanged). | §5, §9, §10, §14, ADR-0002 |
| R3 | **Inventory model reversed.** Website stock decrements **immediately on successful order placement**, by ordered quantity. POS billing does **not** decrement website stock again. Short-pick restores the unpicked quantity. Every website-stock change writes an append-only `StockLedger` row in the same DB transaction. Row-level locking prevents two customers taking the last unit. | §6, §7, §10, §11, ADR-0005 |
| R4 | **No customer cancellation.** No customer-facing cancellation flow. Only an **audited admin/store correction** capability (duplicate, fraud/error, store-can't-fulfil, POS failure, operational mistake). | §11, §13, ADR-0006 |
| R5 | **Inventory display simplified.** The primary admin quantity is **"Website Stock / Available to Sell"** — a single number. No `reservedQty` concept is exposed (none exists in this model). | §3, §7, §13 |
| R6 | **Price variance policy set.** Configurable upward tolerance = **5% or ₹50, whichever is lower**. If POS final total exceeds the website estimate by more than the threshold → flag the order and require staff to contact the customer and confirm before delivery. POS total lower than estimate → no approval needed. Threshold is configurable, not hard-coded. | §12, §22, §11 |
| R7 | **Delivery slots:** configurable **one-hour** slots; pilot default **10 orders per store per slot**; Store 1 and Store 2 have independently editable capacity. | §15, §22 |
| R8 | **Delivery zones:** do **not** assume one-globally-unique-pincode → one store. Use explicit **store-mapped delivery zones / localities**. Pincode is a stored attribute / validation input, **not** the routing key; the model must allow two delivery areas to share a pincode. The `resolveServiceability` interface stays stable so the routing rule can improve later without touching checkout. | §15, ADR-0004 |
| R9 | **Delivery proof photo is optional** and must not be a Phase 1 dependency. `DeliveryRecord` = delivery-person name (optional), Cash/UPI, amount collected, optional UPI reference, delivered timestamp, optional proof photo. | §12 |
| R10 | **Postgres hosting not decided in Phase 1.** Dev = local/containerized Postgres. Prod = managed preferred, but no vendor lock and no budget ceiling chosen now; decided near staging. Not a Phase 1 blocker. | §23, ADR-0008 |
| R11 | **Short-pick handling explicit** — if the website deducted more than staff can physically pick, restore the difference to website stock with a `StockLedger` correction; only the actually picked quantity is billed in POS. | §7, §12 |
| R12 | **Walk-in drift accepted for V1.** Website stock goes temporarily stale after POS walk-in sales until POS integration exists. V1 must ship manual adjustment, bulk CSV/Excel import, reconciliation, last-updated timestamps, and audit history — and these stay the permanent baseline, because POS integration is capability-dependent and may never be possible (§16.1). No live POS adapter in Phase 1; keep the `PosInventoryFeed` boundary for later. | §7, §16 |
| R13 | UPI is **UPI on delivery only**, no gateway; manual daily reconciliation acceptable for the pilot. | §12, §20 |
| R14 | POS stays fully separate in V1; keep only a **vendor-neutral** boundary/interface for future POS inventory sync, SKU mapping, automatic stock import, optional billing integration. **POS integration is capability-dependent** on the not-yet-chosen vendor — assume no API, docs, webhooks, stock/billing endpoints, write access or DB access — and the website must be fully functional without it. Integration options are ranked (API → webhooks → polling → CSV/Excel → read-only connector → manual reconciliation); no vendor adapter until the POS is selected, its docs reviewed, its endpoints/fields confirmed and its auth/rate limits understood. No vendor-specific POS code yet. | §16.1, ADR-0007 |

Resolved risks (see §D): D-1, D-3, D-7, D-8, D-9, D-10, D-11. Still-open/accepted: D-2, D-5, D-6.

---

## 1. Final system architecture

**Shape:** a **modular monolith** — one Next.js (App Router) application, one
PostgreSQL database, one Docker image. Domain logic lives in `src/modules/*` with
enforced boundaries; `app/` is thin (routing, rendering, input parsing) and calls
module services. Cross-module reactions go through a synchronous in-process typed
**event bus**.

**Why modular monolith, not microservices:** two stores, one small team, no
expansion plan. Inventory decrement and order state changes want **local ACID
transactions** — a monolith gives them for free. Module boundaries + the event bus
keep the option to extract a service later without rewriting callers.

**Runtime pieces (V1):** Next.js standalone in Docker · PostgreSQL 16 (single
instance) · Caddy (auto-HTTPS reverse proxy) · S3-compatible object storage
(optional proof photos only) · Sentry/GlitchTip behind a wrapper (optional in
pilot). **No** Redis, message broker, Kubernetes, serverless, or payment gateway.

**Stack evaluation vs the given baseline:**

| Baseline | Verdict | Reasoning |
|---|---|---|
| Next.js + TypeScript | **Keep** | One deployable for SSR storefront + admin; RSC/server actions suit a small team. A split SPA + API adds ops cost not justified for two stores. |
| PostgreSQL | **Keep** | Transactional stock decrement, constraints, JSONB snapshots. Stock Postgres only — **no PostGIS** (zones are store-mapped localities, §15). |
| Prisma | **Keep, one carve-out** | Migrations + typed client fit the team. Row-locking on the stock decrement uses raw `SELECT … FOR UPDATE` inside a Prisma transaction. |
| Tailwind CSS | **Keep** | + Radix/shadcn primitives (copied-in code, no lock-in) for admin. |

**Minimal additions, each justified:** Zod (validation, shared client/server) ·
Auth.js v5 + Prisma adapter, DB sessions (staff/admin; optional customer accounts) ·
argon2id (password hashing) · pino (structured logs) · Vitest + Playwright (tests).
**Deferred, named:** pg-boss (Postgres-backed jobs — no Redis) if async work appears.

---

## 2. Repository and folder structure

Single repo, single Next.js app, `src/` layout.

```
supermarket-platform/
  prisma/
    schema.prisma
    migrations/
    seed.ts
  src/
    app/
      (storefront)/                # customer-facing, SSR, no-login browse/cart
        page.tsx  catalog/  product/[slug]/  cart/  checkout/
        order-status/[token]/      # guest order tracking by opaque token
        account/                   # optional: only if a customer creates an account
      admin/                       # staff/admin dashboard (User principals)
        orders/  picking/  delivery/  inventory/  catalog/  pricing/
        stores/  users/  reports/
      api/
        health/route.ts            # DB ping + migration state
        internal/                  # reserved for future POS callbacks — not built in V1
      layout.tsx
    modules/                       # the modular-monolith core
      platform/                    # shared kernel: config, logger, db, errors,
                                   #   event-bus, money, ids, authz, observability
      stores/      { domain/ service.ts repo.ts index.ts __tests__/ }   # stores, settings, zones
      catalog/     { … }
      pricing/     { … }
      inventory/   { …  pos/ }     # website stock, StockLedger, CSV import, POS feed boundary
      identity/    { … }           # staff/admin users, RBAC
      customers/   { … }           # lightweight customer records, optional accounts, OTP (disabled)
      cart/        { … }           # no-login cart keyed by cart token
      checkout/    { … }           # serviceability, store binding, placeOrder (decrements stock)
      orders/      { …  state-machine.ts }
      fulfillment/ { picking/  pos/  delivery/ }
      notifications/ { providers/ }   # SMS/email/no-op behind an interface
      admin/                       # thin read-model / BFF for the admin UI
    components/ { ui/  storefront/  admin/ }
    lib/                           # framework glue only — never domain logic
    styles/
  tests/ { e2e/  integration/  factories/ }
  docs/ { adr/  phase-0-architecture.md  phase-1-plan.md }
  docker/ { Dockerfile  docker-compose.yml }        # app + postgres + caddy
  .env.example
  .eslintrc.cjs                    # includes module-boundary rules
  package.json
```

**Module internal convention:** `index.ts` is the only public surface (service
functions + domain types); `service.ts` holds use-cases and opens transactions;
`repo.ts` is Prisma/SQL access and is never imported outside the module; `domain/`
is pure logic. **ESLint `import/no-restricted-paths`** forbids: importing another
module except via its `index.ts`; `app/**` importing `repo.ts` or Prisma models;
`lib/**` importing `modules/**` domain logic. A deliberate violation test proves the
rule bites.

---

## 3. Database architecture and preliminary schema

One PostgreSQL 16 database, Prisma-only access (raw SQL only for the stock
`FOR UPDATE`).

**Principles**
- Money is **integer paise** (`Int`/`BigInt`), never float. Currency fixed INR.
- Orders carry **snapshots** (contact, address, line name, unit label, unit price) —
  later catalog/price/address edits never mutate a placed order.
- **Every** mutation of `InventoryItem.websiteStock` and **every** `Order.status`
  change happens in the same transaction as its audit row (`StockLedger` /
  `OrderStatusHistory`), and `StockLedger.balanceAfter` always equals the resulting
  `websiteStock`.
- Append-only tables are never updated or deleted.

### Preliminary schema (entities + key fields)

**Stores & delivery zones**
- `Store` — id, code, name, timezone, addressJson, geo?, isActive
- `StoreSettings` — storeId (1:1), deliveryFeePaise, minOrderPaise, slotLengthMinutes
  (default 60), slotCapacity (default 10), substitutionPolicy, posMode
  (`MANUAL` | `ADAPTER`), priceVariancePercentBp (default 500 = 5.00%),
  priceVarianceAbsCapPaise (default 5000 = ₹50), isAcceptingOrders
- `DeliveryZone` — id, storeId, name, isActive, sortKey
  *(a zone belongs to exactly one store)*
- `DeliveryArea` — id, zoneId, name (locality / neighbourhood / sector), pincode?
  *(pincode is an attribute, **not** unique; two areas — even under different stores —
  may share a pincode)*, matchHints (aliases/landmarks, JSON), isActive
- `ServiceabilityRequest` — id, rawInput, pincode?, createdAt *(out-of-zone demand signal, optional)*

**Catalog & pricing**
- `Category` — id, name, slug, parentId?, sortKey, isActive
- `Product` — id, **sku (unique, = barcode where available)**, name, slug (unique),
  description, brand?, packSize (e.g. "5 kg", "500 g", "1 pc"), categoryId,
  attributesJson, aisleSortKey, isActive *(shared global master — one row per real product)*
- `ProductImage` — id, productId, url, sortKey, alt
- `StoreProduct` — id, storeId, productId, isListed, mrpPaise, sellingPricePaise,
  listedAt *(unique(storeId, productId))* — per-store listing + current price
- `PriceChange` — id, storeProductId, oldSellingPricePaise, newSellingPricePaise,
  oldMrpPaise, newMrpPaise, actorUserId, reason?, createdAt *(append-only)*

**Inventory & audit**
- `InventoryItem` — id, storeId, productId, **websiteStock** (Int, "Available to
  Sell"), lastCountedAt?, updatedAt *(unique(storeId, productId))*
- `StockLedger` — id, storeId, productId, delta, reason
  (`MANUAL_ADJUST` | `CSV_IMPORT` | `RECONCILE` | `ORDER_PLACED` |
  `PICK_SHORT_RESTORE` | `ADMIN_CORRECTION` | `POS_SYNC`),
  refType, refId, balanceAfter, actorType, actorId, note, createdAt *(append-only)*
- `PosSkuMap` — id, storeId, productId, posSku *(reserved for future POS sync; unused in V1)*

**Identity (staff / admin)**
- `User` — id, email (unique), passwordHash, name, role
  (`SUPER_ADMIN` | `STORE_MANAGER` | `STORE_STAFF`), storeId? (null for SUPER_ADMIN),
  isActive, twoFactorSecret?, lastLoginAt
- `Session` — Auth.js managed (DB sessions)
- `AuditLog` — id, actorType, actorId, action, entityType, entityId, beforeJson,
  afterJson, ip, createdAt *(generic sensitive-mutation audit: price, stock adjust,
  users, admin order corrections)*

**Customers (guest-first)**
- `Customer` — id, phone (unique), name, email? (unique, nullable),
  passwordHash? (nullable — set only if they create an account), isBlocked, createdAt
  *(a lightweight row is upserted from checkout by phone; no credential required)*
- `CustomerAddress` — id, customerId, label?, line1, line2?, landmark?, areaId?
  (resolved `DeliveryArea`), pincode?, geo?, isDefault, isDeleted
- `OtpChallenge` — id, phone, codeHash, purpose, expiresAt, attempts, consumedAt,
  createdAt *(schema present; feature-flagged OFF for the pilot)*

**Cart (no login required)**
- `Cart` — id, cartToken (opaque, cookie), customerId? (nullable), storeId,
  status (`ACTIVE` | `CONVERTED` | `ABANDONED`), updatedAt
- `CartItem` — id, cartId, productId, qty, unitPriceSnapshotPaise, addedAt

**Orders**
- `Order` — id, orderNumber (human), trackingToken (opaque, for guest status page),
  customerId, storeId, contactNameSnapshot, contactPhoneSnapshot,
  deliveryAddressSnapshotJson, deliverySlotStart, deliverySlotEnd,
  paymentMethod (`COD` | `UPI_ON_DELIVERY`), status (see §11),
  subtotalPaise, deliveryFeePaise, estimatedTotalPaise,
  posBillNumber?, posFinalTotalPaise?, priceVarianceFlagged (bool, default false),
  customerConfirmedRevisedAmount (bool, default false), revisedAmountConfirmedBy?,
  placedAt, acceptedAt?, pickingStartedAt?, pickedAt?, billedAt?, packedAt?,
  dispatchedAt?, deliveredAt?, closedAt?, correctedAt?, correctionReason?
- `OrderLine` — id, orderId, productId, nameSnapshot, packSizeSnapshot,
  unitPricePaise, qtyOrdered, qtyPicked?, lineStatus
  (`PENDING` | `PICKED` | `SHORT` | `SUBSTITUTED` | `UNAVAILABLE`),
  substituteProductId?, stockRestoredQty (Int, default 0)
- `OrderStatusHistory` — id, orderId, fromStatus, toStatus, actorType, actorId,
  note, createdAt *(append-only)*

**Fulfillment**
- `PickTask` — id, orderId (1:1), assignedUserId?, status (`OPEN` | `IN_PROGRESS` | `DONE`),
  startedAt?, completedAt?
- `PosBillingHandoff` — id, orderId (1:1), posBillNumber, posFinalTotalPaise,
  billedByUserId, billedAt, discrepancyNote?
- `DeliveryRecord` — id, orderId (1:1), assigneeName?, status
  (`PENDING` | `OUT` | `DELIVERED` | `FAILED`), outAt?, deliveredAt?,
  paymentMethodUsed (`CASH` | `UPI`)?, amountCollectedPaise?, upiRef?,
  proofPhotoUrl? *(optional, not a V1 dependency)*, failureReason?

**Config**
- `FeatureFlag` — key, enabled, description *(DB-backed; e.g. `customer_otp_login` = OFF)*

**Indexes of note:** `Order(storeId, status, placedAt)`,
`InventoryItem(storeId, productId)` unique, `StockLedger(storeId, productId, createdAt)`,
`DeliveryArea(pincode)` **non-unique**, `Customer(phone)` unique,
`StoreProduct(storeId, isListed)`, `Order(trackingToken)` unique.

---

## 4. Core module boundaries

| Module | Owns | Depends on (via `index.ts`) | Emits |
|---|---|---|---|
| `platform` | config, logger, db, errors, event-bus, money, ids, `authorize()`, observability | — | — |
| `stores` | Store, StoreSettings, DeliveryZone, DeliveryArea; `resolveServiceability(input)` | platform | — |
| `catalog` | Category, Product, ProductImage | platform | `product.updated` |
| `pricing` | StoreProduct price fields, PriceChange | platform, catalog, stores | `price.changed` |
| `inventory` | InventoryItem (`websiteStock`), StockLedger, CSV import, reconcile, POS-feed boundary | platform, catalog, stores | `stock.low`, `stock.changed` |
| `identity` | User, RBAC, staff auth | platform | `user.created`, `user.disabled` |
| `customers` | Customer, CustomerAddress, OtpChallenge (disabled), optional accounts | platform, notifications | `customer.registered` |
| `cart` | Cart, CartItem, revalidation against price/stock | platform, catalog, pricing, inventory, stores | — |
| `checkout` | serviceability check, store binding, **`placeOrder()`** (decrements stock in-tx) | platform, cart, orders, inventory, stores, customers | `order.placed` |
| `orders` | Order, OrderLine, OrderStatusHistory, **state machine**, admin correction | platform, inventory | `order.<transition>` |
| `fulfillment` | PickTask, PosBillingHandoff (+ variance calc), DeliveryRecord | platform, orders, inventory, notifications | `order.picked`, `order.billed`, `order.delivered` |
| `notifications` | provider interface + SMS/email/no-op impls, outbound log | platform | — |
| `admin` | read-models / BFF for the admin UI (no domain rules) | all of the above via `index.ts` | — |

Sync calls go through `index.ts`; reactive side effects through the event bus
(handlers wired at boot in `platform/event-bus`). No module touches another's
`repo.ts`, Prisma models, or `domain/` internals.

---

## 5. Authentication and authorization strategy

**Customers — guest-first (pilot):**
- Browse the storefront **without login**.
- Add to cart **without login** (cart keyed by an opaque `cartToken` cookie).
- **Checkout collects name + phone + delivery address** — no account required.
- A lightweight `Customer` row is upserted by phone at checkout (no credential) so
  order history can be looked up later and an account can be claimed.
- **Optional** email + password accounts (Auth.js credentials + Prisma adapter, DB
  sessions) if a customer wants a persistent login — never a prerequisite to order.
- **Phone + OTP** login is implemented behind an `AuthChallengeProvider` +
  `NotificationProvider` interface and gated by `FeatureFlag.customer_otp_login`
  (**OFF** for the pilot). It is enabled after an SMS vendor + India DLT
  requirements are finalised — **no SMS dependency in Phase 1**.
- Guest order tracking: `/order-status/[trackingToken]` — opaque unguessable token,
  no login.

**Staff / admin (`User`) — unchanged:**
- Email + argon2id password; optional TOTP 2FA (mandatory-recommended for `SUPER_ADMIN`).
- Auth.js DB sessions, rotation on login, absolute timeout.
- No public signup — `SUPER_ADMIN` creates users.
- **RBAC:** `SUPER_ADMIN` (all stores, config, users, pricing, catalog) ·
  `STORE_MANAGER` (one store: its orders, inventory, prices, staff) ·
  `STORE_STAFF` (one store: picking, POS-bill entry, delivery status).

**Enforcement:** central deny-by-default `authorize(principal, action, resource)`;
**every** store-bound query filters by `principal.allowedStoreIds` (no IDOR / no
cross-store leakage); middleware gates `/admin/*` and `/account/*` but every server
action / route handler re-checks server-side. CSRF via Auth.js tokens + `SameSite`
cookies + origin checks on server actions.

---

## 6. Store 1 / Store 2 inventory design

- **One shared global `Product` master** — one row per real product, keyed by a
  unique `sku` (barcode where available); shared name, brand, category, images,
  pack size. A product sold by both stores is **never** duplicated into two
  `Product` rows.
- **Per-store `StoreProduct`** — independent `isListed` flag and independent
  `sellingPricePaise` / `mrpPaise` per store.
- **Per-store `InventoryItem`** — independent `websiteStock` per store.
- Store 1 and Store 2 listings, prices and stock are edited on **separate admin
  screens** and are fully independent.
- No cross-store pool, no transfer, no "other store has it" fallback.
- Website inventory is **separate from POS inventory** in V1. `PosSkuMap` +
  `POS_SYNC` ledger reason are reserved for the future feed.

---

## 7. Inventory update and audit model

**The number:** `InventoryItem.websiteStock` — a single quantity, shown to admin as
**"Website Stock / Available to Sell"**. There is no reservation sub-quantity.

**Invariant:** `websiteStock` is never mutated outside a DB transaction that also
writes a `StockLedger` row whose `balanceAfter` equals the new `websiteStock`.

| Trigger | Effect on `websiteStock` | Ledger reason |
|---|---|---|
| Order placed successfully | `−= qtyOrdered` (per line) | `ORDER_PLACED` |
| Pick short / unavailable | `+= (qtyOrdered − qtyPicked)` for that line | `PICK_SHORT_RESTORE` |
| **POS billing** | **no change** — POS converges its own inventory; `PosBillingHandoff` recorded | *(none)* |
| Admin/store correction (duplicate, fraud/error, can't fulfil, POS failure, mistake) | `+= not-yet-restored qty` of the order | `ADMIN_CORRECTION` |
| Admin manual adjust | `+= delta` | `MANUAL_ADJUST` |
| Bulk CSV/Excel import | set / `+=` per row | `CSV_IMPORT` |
| Reconciliation (physical count, failed-delivery restock) | `= counted` (delta logged), sets `lastCountedAt` | `RECONCILE` |
| Future POS feed | adjust toward POS snapshot | `POS_SYNC` |

**Worked example (R3):** website 20, POS 20 → online order for 3 → **website 17**,
POS 20 → staff picks & bills 3 in POS → website 17, **POS 17**. Website did **not**
change at billing.

**Short-pick example (R11):** ordered 3, website already −3, staff can pick only 2
→ restore 1 (`PICK_SHORT_RESTORE`, `stockRestoredQty = 1` on the line) → only 2 go
through POS.

**Walk-in drift (R12):** POS-only walk-in sales make website stock temporarily stale
until POS integration exists. **Accepted for V1.** Mitigated by manual adjust, bulk
CSV/Excel import, reconciliation, `updatedAt` / `lastCountedAt` timestamps, and the
full `StockLedger` history — all in scope for V1. No live POS adapter in Phase 1.

**Concurrency:** `placeOrder()` takes `SELECT … FOR UPDATE` on each line's
`InventoryItem` row (raw SQL inside the Prisma transaction). If the resulting
`websiteStock` would be negative, the whole placement fails with a per-line message.
Two customers racing the last unit serialise — exactly one succeeds. Integration
test required.

**Admin audit surface:** per-product ledger view (filter by reason / date / actor),
low-stock report, last-updated timestamps, CSV import history.

---

## 8. Product catalogue architecture

- Shared global `Product` master (one row per real product, unique `sku`/barcode),
  `Category` tree, `ProductImage`, `aisleSortKey` for picklist ordering.
- **No variant table in V1** — supermarket packs are naturally one-row-per-pack;
  variants are a documented future extension.
- Per-store listing + price via `StoreProduct`; a product not listed for a store is
  invisible in that store's storefront.
- Global stable slugs (SEO); storefront resolves a slug against the current store
  context (from the chosen delivery area).
- Search V1: Postgres `pg_trgm` / `ILIKE` on name + brand, scoped to the store's
  listed products. No external search service.

---

## 9. Customer storefront architecture

- Next.js App Router, **SSR** for catalog/product pages (SEO, fast first paint on
  low-end phones). Route group `src/app/(storefront)/`.
- **No login to browse or build a cart.** Store context comes from the delivery
  area the visitor selects (locality picker → resolves a `DeliveryArea` → store).
  Visitors with no area chosen see a store-selection / area prompt first.
- Pages: home, category browse, search, product detail, cart, checkout (name +
  phone + address + slot + COD/UPI-on-delivery), guest order-status page by token,
  optional account area (only if an account exists).
- No price/stock is trusted from the client — cart and checkout re-read
  authoritative values server-side.
- Mobile-first Tailwind; `img{max-width:100%}`; no horizontal body scroll.

---

## 10. Cart and checkout architecture

**Cart (no login):**
- One `ACTIVE` cart per `cartToken` cookie, **bound to exactly one store**
  (`customerId` filled in later if the customer has/creates an account).
- `CartItem` stores `unitPriceSnapshotPaise` at add time; every cart view and
  checkout **revalidates**: price changes surfaced, insufficient `websiteStock`
  flagged, unlisted items removed.
- Switching the delivery area to one served by the **other store** rebuilds the cart
  against that store's catalog/stock/price with a clear warning.

**Checkout — `checkout.placeOrder()`:**
1. `stores.resolveServiceability(addressInput)` → store, delivery fee, min-order,
   available one-hour slots. Reject if out-of-zone (optionally capture the input).
2. Revalidate cart (price, stock, listing, min-order).
3. Collect **name + phone + delivery address**; pick a slot with remaining capacity
   (`StoreSettings.slotCapacity`, default 10/store/hour).
4. Choose **COD or UPI-on-delivery** — no gateway, no redirect, no card capture
   (permanently out of PCI scope).
5. **One transaction:** `SELECT … FOR UPDATE` each line's `InventoryItem`; if any
   line lacks stock → roll back with per-line errors; else decrement
   `websiteStock -= qtyOrdered` per line + write `StockLedger` (`ORDER_PLACED`,
   `balanceAfter`); upsert lightweight `Customer` by phone; create `Order` +
   `OrderLine`s with snapshots; `estimatedTotalPaise = subtotal + deliveryFee`;
   mint `trackingToken`; mark cart `CONVERTED`; emit `order.placed`.
6. `order.placed` → `notifications` sends confirmation (no-op provider in dev/pilot
   until an SMS/email vendor is wired).

The customer sees **"estimated total — final amount confirmed at billing"** (§12).

---

## 11. Order lifecycle and state machine

**States:**
`PLACED → ACCEPTED → PICKING → PICKED → BILLED_IN_POS → PACKED → OUT_FOR_DELIVERY → DELIVERED → CLOSED`

**Branches / exceptions:**
- **No customer cancellation.** There is no customer-facing cancel transition.
- **Admin/store correction:** from any state **before `OUT_FOR_DELIVERY`**, a
  `STORE_MANAGER` / `SUPER_ADMIN` may move the order to `CANCELLED_BY_STORE`
  (terminal) with a **mandatory reason** (duplicate, fraud/error, can't fulfil, POS
  failure, operational mistake). This restores the not-yet-restored `websiteStock`
  for every line (`ADMIN_CORRECTION` ledger rows) and writes `AuditLog` + a
  mandatory `OrderStatusHistory` note. After `BILLED_IN_POS`, correction also
  requires a manual POS void recorded in `discrepancyNote`.
- `OUT_FOR_DELIVERY → DELIVERY_FAILED` → retry (`OUT_FOR_DELIVERY`) or
  `CLOSED_UNDELIVERED` with a restock decision (`RECONCILE` ledger entry if goods
  return to the shelf).
- Returns / partial returns are **post-pilot**, not built in V1.

**Price-variance gate (R6):** at `BILLED_IN_POS`, `fulfillment` computes
`overage = posFinalTotalPaise − estimatedTotalPaise`. Threshold =
`min(estimatedTotalPaise × priceVariancePercentBp/10000, priceVarianceAbsCapPaise)`
(default: lower of 5% or ₹50). If `overage > threshold` → set
`priceVarianceFlagged = true`. The `PACKED → OUT_FOR_DELIVERY` transition is
**guarded**: a flagged order cannot dispatch until staff record
`customerConfirmedRevisedAmount = true` (with `revisedAmountConfirmedBy`). POS total
**at or below** estimate → no flag, no approval.

**Implementation:** an explicit transition table
(`from → allowed[] → guard → sideEffects`) in `orders/state-machine.ts`.
`transition(orderId, to, actor, note)` is the **only** way status changes; it
validates the edge, runs the guard, writes `OrderStatusHistory`, sets the matching
timestamp column, and emits `order.<transition>` — all in one transaction. No
scattered status mutations anywhere. **100% branch coverage** on this file,
including every illegal edge and the variance guard.

---

## 12. Picking → POS billing → packing → delivery workflow

1. **Queue** — `STORE_STAFF` see only their store's `ACCEPTED` orders.
2. **Start pick** → `PICKING`; `PickTask` created/assigned. Picklist sorted by
   `aisleSortKey`.
3. **Per line** — `PICKED` / `SHORT` (enter `qtyPicked`) / `SUBSTITUTED` (choose
   `substituteProductId`) / `UNAVAILABLE`. Short/unavailable lines **restore**
   `websiteStock += (qtyOrdered − qtyPicked)` in-tx (`PICK_SHORT_RESTORE`), setting
   `stockRestoredQty`. Substitution/short customer notification follows
   `StoreSettings.substitutionPolicy` (pilot default: proceed, notify).
4. All lines resolved → `PICKED`.
5. **POS billing (the boundary)** — staff take the physical basket to the **separate
   purchased POS**, ring up the **picked** quantities there, apply any POS-side
   discounts/loyalty, print the **final bill**. In admin they enter `posBillNumber`
   + `posFinalTotalPaise` (+ optional `discrepancyNote`) → `BILLED_IN_POS`; this
   writes `PosBillingHandoff` and runs the **variance calc** (§11). **Website stock
   is not touched here.**
6. **Pack** → `PACKED` (record bag count).
7. **Dispatch** → `OUT_FOR_DELIVERY`. **Blocked** if `priceVarianceFlagged` and not
   yet customer-confirmed. Delivery person is a plain `assigneeName` string — **no
   rider dashboard, no app, no live tracking**.
8. **Delivery outcome** — record `DELIVERED` with: `paymentMethodUsed`
   (`CASH` / `UPI`), `amountCollectedPaise` (= POS final total), optional `upiRef`,
   `deliveredAt`, **optional** `proofPhotoUrl` (not a V1 dependency) → then
   `CLOSED`. Or `DELIVERY_FAILED` with `failureReason` → retry or
   `CLOSED_UNDELIVERED` (+ restock reconcile).

**UPI-on-delivery** has no gateway: `upiRef` is captured for **manual daily bank
reconciliation** by finance — accepted for the pilot (R13).

---

## 13. Admin dashboard architecture

- Route group `src/app/admin/`, `User`-guarded, RBAC + store scope on **every**
  screen and query.
- `admin` module is a **thin read-model / BFF** — composes `orders`, `inventory`,
  `catalog`, `pricing`, `stores`, `identity`; holds no domain rules.
- Screens:
  - **Orders** — queue by status, order detail, status timeline, **admin correction**
    (`CANCELLED_BY_STORE` with mandatory reason), price-variance flag + "customer
    confirmed" action.
  - **Picking** — active pick tasks, per-line pick UI (picked/short/substitute/
    unavailable), POS-bill entry form.
  - **Delivery** — out-for-delivery list, record outcome + payment + optional proof.
  - **Inventory** — per-store **Website Stock / Available to Sell** grid, manual
    adjust (with reason), **bulk CSV/Excel import**, reconciliation, ledger view,
    low-stock report, last-updated timestamps.
  - **Catalog** — products (shared master), categories, images.
  - **Pricing** — per-store `StoreProduct` price edit + `PriceChange` history.
  - **Stores** — `StoreSettings` (delivery fee, min order, **slot length + per-store
    slot capacity**, variance threshold, substitution policy, POS mode), delivery
    zones + areas.
  - **Users** — `SUPER_ADMIN` only: create/disable staff, assign store + role.
  - **Reports** — orders today, stuck-order digest, estimate-vs-POS variance,
    sales estimate, `AuditLog` viewer.
- All sensitive mutations (price, stock adjust, user changes, order corrections)
  write `AuditLog` with before/after JSON.

---

## 14. Customer / account / address architecture

- `Customer` keyed by unique **phone**; lightweight row upserted from checkout, no
  credential. `email` + `passwordHash` set **only** if the customer opts into an
  account.
- `CustomerAddress` — multiple per customer, one `isDefault`, **soft-delete** so
  placed orders keep a valid reference; resolves to a `DeliveryArea`. `pincode` is
  stored as an attribute.
- Order placement copies contact + address into snapshots — later edits never mutate
  a placed order.
- Guest tracking: `/order-status/[trackingToken]` shows a read-only status timeline.
- Optional account area (profile, address book, order history) appears only when an
  account exists.
- Minimal PII (name, phone, address). Export/delete flow is a documented post-pilot
  item.

---

## 15. Delivery-zone and store-assignment logic

- **Store-mapped zones, not pincode-keyed routing (R8).** `DeliveryZone` belongs to
  one `Store`; `DeliveryArea` rows (locality / neighbourhood / sector, with optional
  `pincode` and match hints) belong to a zone.
- `pincode` is a **stored attribute / validation input**, **not** unique — two
  `DeliveryArea` rows (even under different stores) may carry the same pincode. The
  actual service-area boundaries drive the mapping.
- **`stores.resolveServiceability(input) → { servable, storeId?, zoneId?, areaId?,
  deliveryFeePaise?, minOrderPaise?, slots? }`** — a **stable interface**. V1
  implementation: the customer picks a locality (`DeliveryArea`) from a
  store-curated list, optionally validated against pincode; the resolver returns
  that area's store. The internal rule can later become polygon/geo-based **without
  changing checkout or any caller**.
- Out-of-zone → "we don't deliver here yet", optional `ServiceabilityRequest`
  capture.
- Cart + checkout are bound to the resolved store; area change re-resolves and may
  rebuild the cart (§10).
- No PostGIS in V1; geo columns exist (nullable) for a future upgrade.

---

## 16. Future POS integration interface and boundary

**Built now:** the seams. **Not built now:** any vendor adapter.

### 16.1 Capability dependency (R14)

POS integration is capability-dependent. The platform will integrate only with functionality officially exposed and documented by the selected POS vendor. The website remains operational without POS integration.

The POS product has not been chosen, and that choice — not this design — decides
what an integration can do. **Assume none of the following exists:** an API, API
documentation, webhooks, stock endpoints, billing endpoints, write access, database
access. Several POS products sold into this segment expose none of them, and a
design that presumed otherwise would make the storefront hostage to a purchase
decision the business has not made.

Consequently: **the website must remain fully functional with no POS integration.**
Manual stock adjustment, bulk CSV/Excel import and reconciliation (§7, §13) are not
a stopgap awaiting an adapter — they are the permanent baseline, and they stay
supported however capable the eventual POS turns out to be.

Only a **vendor-neutral** boundary is kept. When a POS is chosen, integration takes
the **highest option in this order that the vendor actually supports**:

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

**The core website architecture does not change based on which POS is chosen.** What
survives every outcome, including "no integration is possible": `PosSkuMap`, the
POS-neutral adapter interfaces below, the manual/CSV fallback, and per-store
`StoreSettings.posMode`.

### 16.2 The boundary

- **Anti-corruption layer** in `inventory/pos/` and `fulfillment/pos/`. Core modules
  depend only on these interfaces:

  ```ts
  // fulfillment/pos/pos-billing-gateway.ts
  interface PosBillingGateway {
    recordFinalBill(orderId: string, input: {
      billNumber: string; finalTotalPaise: number;
      billedByUserId: string; discrepancyNote?: string;
    }): Promise<PosBillingHandoff>;                 // V1: ManualPosBillingGateway (staff form)
    createDraftBill?(order: OrderForPos): Promise<{ posBillRef: string }>;   // future adapter
    fetchFinalBill?(posBillRef: string): Promise<PosFinalBill>;             // future adapter
  }

  // inventory/pos/pos-inventory-feed.ts
  interface PosInventoryFeed {
    pullStockSnapshot(storeId: string): Promise<Array<{ posSku: string; qty: number }>>;
  }                                                 // V1: NoopInventoryFeed (+ manual CSV import in admin)
  ```

- `PosSkuMap(storeId, productId, posSku)` table exists now, populated later.
- `StoreSettings.posMode` (`MANUAL` | `ADAPTER`) per store selects the impl via a
  factory in `platform`.
- Future adapter work = new files under `*/pos/` + `PosSkuMap` rows + a scheduled
  `pullStockSnapshot` that writes `POS_SYNC` ledger rows in reconcile mode. **No core
  module or table changes.**
- Contract tests are written against the interfaces in Phase 5 so any future adapter
  must pass the same suite.
- `src/app/api/internal/` is reserved for future POS callbacks/webhooks.
- Scope kept for later: POS inventory synchronization, POS SKU mapping, automatic
  stock import, optional billing integration. **No vendor-specific POS code in V1.**

---

## 17. Coding standards

- **TypeScript strict** + `noUncheckedIndexedAccess` + `exactOptionalPropertyTypes`;
  `any` is a lint error.
- **ESLint** (`typescript-eslint` recommended-type-checked) + **Prettier** +
  module-boundary rules (§2).
- **Zod at every trust boundary** (route handler, server action, external input);
  domain types inferred from schemas.
- **Money** = integer paise + a `Money` helper (`add`, `mul`, `format`); floats
  banned for currency.
- **No business logic in `app/**` or React components** — parse input, call a module
  service, render.
- **Transactions**: any write to `websiteStock` or `Order.status` goes through a
  service that opens a transaction and writes its audit row (`StockLedger` /
  `OrderStatusHistory`) in the same tx.
- **Errors**: typed `AppError` hierarchy (`ValidationError`, `NotFoundError`,
  `ConflictError`, `AuthzError`, `DomainError`); mapped to HTTP/UI only at the edge.
- **Naming**: use-cases `verbNoun` (`placeOrder`, `restorePickShortage`); types
  `Noun`; files kebab-case; env keys `SCREAMING_SNAKE`.
- **Comments** explain *why*, match surrounding density.
- **Conventional Commits**; every PR updates docs/ADR when a decision changes.

---

## 18. Git / branch / worktree strategy

- **`main`** is always deployable — protected, PR-only, green CI required.
- Short-lived branches: `feat/<module>-<slug>`, `fix/<slug>`, `chore/<slug>`;
  **squash-merge**.
- **One PR per roadmap task**, with tests and any ADR change included.
- **Worktrees:** JIM (Builder) works in a dedicated git worktree per task branch
  (`../wt/<branch>`); OSCAR (Reviewer) reviews from a separate checkout/worktree —
  Builder and Reviewer never share a working tree. **Michael** integrates to `main`
  and runs final QA.
- **CI per PR:** typecheck → lint (incl. boundary rules) → unit → integration
  (Dockerized Postgres) → `next build`. **E2E (Playwright)** on `main` + release
  branches.
- Tags `v0.x.y`; pilot tag `v0.1.0-pilot`. CHANGELOG from commits.
- Every schema change is a committed Prisma migration; `prisma migrate deploy` is a
  gated pre-deploy step.

---

## 19. Testing strategy

| Layer | Tool | What |
|---|---|---|
| **Unit** | Vitest | Pure logic — state-machine transitions (every illegal edge + the variance guard), `resolveServiceability`, money math, authz decisions, cart revalidation, price-variance threshold calc. No DB. |
| **Integration** | Vitest + real Postgres (docker-compose / Testcontainers) | `placeOrder` decrements `websiteStock` + writes `ORDER_PLACED` ledger + emits event in one tx; short-pick restore; admin correction restores stock; **concurrency — two orders race the last unit, exactly one wins**; CSV import; reconcile; migrations apply. |
| **Contract** | Vitest | `PosBillingGateway`, `PosInventoryFeed`, `NotificationProvider` — manual/no-op impls + a fake, so a future adapter passes the same suite. |
| **E2E** | Playwright | Golden path: no-login browse store-1 → cart → checkout (name/phone/address, COD) → order in admin → staff pick (with a short-pick) → POS-bill entry → dispatch → delivered + payment. Plus: out-of-zone rejection; area switch rebuilds cart; oversell prevention; price-variance flag blocks dispatch until confirmed. |

- **Coverage gates on `src/modules/**`** (~80% lines; **100% branch on
  `orders/state-machine.ts`**). No gate on `app/**`.
- Deterministic **factories** in `tests/factories/` (2 stores + settings, partly
  overlapping catalog, distinct localities that share a pincode for the R8 case,
  seeded staff users).
- **OSCAR** runs an **independent** test + security + edge-case pass each phase;
  findings return as written notes to Michael — never silent fixes.

---

## 20. Security baseline

- **No card data, ever** (COD / UPI-on-delivery only) → **no PCI DSS scope**
  (documented so it stays true).
- **Transport:** HTTPS only (Caddy auto-TLS) + HSTS; `Secure` / `HttpOnly` /
  `SameSite` cookies (incl. `cartToken`, `trackingToken` never guessable).
- **Staff AuthN:** argon2id; optional TOTP 2FA (mandatory-recommended for
  `SUPER_ADMIN`); generic auth errors; session rotation on login; absolute admin
  timeout. Customer OTP (when later enabled): hashed, TTL, attempt cap, lockout,
  rate-limited.
- **AuthZ:** deny-by-default central `authorize()`; store-scoping on every
  store-bound query; server-side re-check on every mutation; never trust IDs from
  the client — filter by owner/store (no IDOR).
- **Input:** Zod everywhere; Prisma parametrized queries only; React output
  encoding; strict **CSP**, no inline scripts.
- **CSV/Excel import:** size + row caps, header allowlist, per-row validation,
  dry-run preview, import logged to `AuditLog`.
- **Optional proof-photo upload:** MIME + size checks, randomized names, object
  storage outside the webroot, signed URLs.
- **Rate limiting:** checkout, area lookup, staff login, (future) OTP — in-memory
  token bucket in V1 (single instance), pg-backed when scaling.
- **Secrets:** never in repo; `.env` local only; prod via injected env / secrets
  manager; `.env.example` documents keys; rotate on staff offboarding.
- **Dependencies:** Dependabot + `npm audit` in CI; pinned versions; minimal deps.
- **Data:** PII limited to name / phone / address; DB + backups encrypted at rest;
  logs never contain passwords, tokens, OTPs, or full addresses at info level.
- **Audit:** `AuditLog` + domain audit tables for all sensitive actions incl. admin
  order corrections.
- **Threat model:** STRIDE-lite (ADR-0009-to-be or `docs/adr` threat note); OSCAR
  security review each phase + a full pass in Phase 6.
- **UPI-on-delivery:** manual daily bank reconciliation is the accepted pilot
  control; `upiRef` captured per delivery.

---

## 21. Logging, audit trail and error-handling strategy

- **Structured logging:** `pino`, JSON, level-based, **request-id correlation** via
  `AsyncLocalStorage`. `error` = needs attention; `warn` = recoverable/anomaly;
  `info` = state transitions + auth events; `debug` = dev.
- **Domain audit (immutable, admin-queryable):** `OrderStatusHistory`, `StockLedger`,
  `PriceChange`, `PosBillingHandoff`, generic `AuditLog` (before/after JSON).
- **Error handling:** typed `AppError` hierarchy → one central mapper → safe HTTP
  status + user-safe message; unexpected errors → 500, full stack + correlation id
  logged, generic message to the user, **never** a stack trace to the client in
  prod. React error boundaries per major UI area.
- **Error tracking:** Sentry (or self-hosted GlitchTip) behind
  `platform/observability.ts` — swappable, optional to enable in the pilot.
- **Health:** `/api/health` checks DB connectivity + migration state.
- **Ops alerting (pilot):** Sentry email + a daily **stuck-orders digest** (orders
  in one state past a threshold) + a **price-variance-flagged awaiting-confirmation**
  list.

---

## 22. Environment / secrets / configuration strategy

- `NODE_ENV` + explicit `APP_ENV` (`local` | `ci` | `staging` | `production`).
- Config loaded **once** via a **Zod-validated `platform/config` module** — the app
  refuses to boot on missing/invalid env.
- **Env = infra + secrets only:** `DATABASE_URL`, `AUTH_SECRET`, `AUTH_URL`,
  `STORAGE_*` (optional proof photos), `SENTRY_DSN` (optional), `RATE_LIMIT_*`,
  `DEFAULT_CURRENCY=INR`. SMS provider creds are **not** required for the pilot.
- **Per-store business settings** live in the DB (`StoreSettings`), edited by admin,
  **not** env: delivery fee, min order, **slot length (default 60 min) + slot
  capacity (default 10, per store)**, **price-variance threshold
  (`priceVariancePercentBp = 500`, `priceVarianceAbsCapPaise = 5000`, effective =
  the lower)**, substitution policy, POS mode.
- `.env.example` committed and kept current. Real secrets via host env / secrets
  manager (SOPS / Doppler optional, not required for V1).
- **Feature flags:** DB-backed `FeatureFlag` — e.g. `customer_otp_login = OFF`,
  `customer_email_accounts` = as desired. No third-party flag service.

---

## 23. Deployment architecture

- **Development:** local / containerized PostgreSQL via `docker/docker-compose.yml`
  (app + postgres + caddy) for prod parity.
- **Production:** Dockerized Next.js (`output: 'standalone'`) on one small VPS
  (≈2 vCPU / 4 GB) behind **Caddy** (auto-HTTPS). **Managed PostgreSQL is
  preferred** for zero DB-ops + PITR — but **no vendor is chosen and no monthly
  budget ceiling is set in Phase 1**; both are decided near staging/production.
  Not a Phase 1 blocker.
- Optional S3-compatible object storage (R2 / B2 / MinIO) behind a `StorageProvider`
  interface — only if proof photos are turned on.
- Single app instance in V1 (in-memory rate-limit is fine). Vertical scale first.
- **CI/CD:** build image → push to GHCR → deploy via `docker compose pull && up -d`.
  Off-hours deploy blip is acceptable for the pilot (documented).
- **Migrations:** `prisma migrate deploy` as a gated pre-deploy step.
- **Backups:** automated daily + pre-migration snapshot; a **restore drill** is a
  go-live acceptance item.
- **Environments:** `local` → `staging` → `production`. No serverless, no
  Kubernetes.
- **Anti-lock-in:** plain Docker + Postgres + optional S3 API — movable hosts in
  under a day. Vercel + managed Postgres is an allowed fallback, not the default.

---

## 24. Phase 1 → production-pilot roadmap

| Phase | Goal | Done when |
|---|---|---|
| **1 Foundation** | Repo scaffold; `platform` kernel (config, logger, db, errors, event-bus, money, ids); **revised** Prisma schema + initial migration + seed (2 stores, sample catalog, staff, zones/areas incl. a shared-pincode case); CI; docker-compose dev; boundary lint; module skeletons; `/api/health`; test harness + factories; ADRs committed. | `main` green (typecheck, lint incl. boundaries, unit, integration, build); `docker compose up` serves the app; `/api/health` OK; `migrate deploy` + `seed` run clean; one Playwright smoke passes; a deliberate cross-module import fails lint. |
| **2 Identity + catalog + inventory core** | Staff auth + RBAC; stores + settings + **store-mapped zones/areas**; catalog (shared master); pricing; inventory (`websiteStock`, `StockLedger`, manual adjust, **CSV/Excel import**, reconcile, low-stock, timestamps); admin screens for all. | Admin manages all with full audit; integration tests prove the ledger invariant + `balanceAfter` consistency + CSV import + reconcile. |
| **3 Storefront + cart** | No-login browse/search per store; product pages; locality picker → `resolveServiceability`; single-store cart (`cartToken`) with price/stock revalidation; optional email/password accounts. | E2E no-login browse→cart both stores; area switch rebuilds cart; out-of-zone handling; shared-pincode areas resolve to the correct store. |
| **4 Checkout + order lifecycle** | Checkout (name/phone/address, slot w/ capacity, COD/UPI-on-delivery); **`placeOrder` decrements `websiteStock` in-tx + `ORDER_PLACED` ledger + event**; state machine + guarded transitions + history; guest order-status page; admin order queue + **admin correction** (`CANCELLED_BY_STORE`, audited, restores stock). | Full state-machine suite (100% branch); decrement/restore invariants; **concurrency test (last unit)**; no customer-cancel path exists. |
| **5 Fulfillment** | Picking (pick/short/substitute/unavailable) with **`PICK_SHORT_RESTORE`**; `PICKED`; manual POS billing handoff (`ManualPosBillingGateway`) + **variance calc & flag**; `PACKED`; **variance-guarded dispatch**; delivery outcome + payment + optional proof; failed-delivery path; POS interfaces + contract tests (adapter unbuilt). | End-to-end golden-path e2e incl. a short-pick and a variance-flagged order that blocks dispatch until confirmed; POS boundary + contract tests in place. |
| **6 Admin reporting + ops hardening** | Dashboards (orders today, stuck-order digest, variance-awaiting-confirmation, estimate-vs-POS variance, low-stock, sales estimate); `AuditLog` viewer; security + rate-limit pass; backup/restore drill; Sentry wired; ops runbook. | OSCAR full security + edge-case review sign-off. |
| **7 Staging UAT** | Deploy to staging (managed PG vendor + budget decided here); real store staff walk the full flow with realistic data; fix list; load sanity (few hundred products, dozens of concurrent orders). | UAT sign-off; no open P1/P2; managed-PG decision recorded. |
| **8 Production pilot** | One store live (or both, limited hours); real COD / UPI-on-delivery; manual UPI reconciliation; close monitoring; daily incident standup. | N successful deliveries; no P1 for X consecutive days; inventory drift vs POS within tolerance. |

**Post-pilot backlog (unscheduled):** POS adapter (inventory sync + SKU map +
optional billing); enable customer phone-OTP after SMS vendor + DLT; substitutions
UX; returns/refunds; product variants; polygon/geo zones; promotions/coupons;
richer notifications; multi-instance scaling (pg-backed rate-limit/sessions,
pg-boss); 2FA rollout; customer data export/delete.

---

## 25. Acceptance criteria for Phase 0

**Phase 0 is ACCEPTED (2026-09-06).** The checklist below is satisfied by this v2
document + the human's overrides; it is retained as the record.

1. ☑ Document approved by the human (with overrides — see Revision Log).
2. ☑ Stack (Next.js / TS / PostgreSQL / Prisma / Tailwind + listed additions) accepted.
3. ☑ Modular monolith + 13-module list accepted.
4. ☑ Repo/folder structure + boundary rules accepted.
5. ☑ Preliminary schema + invariants (audit-row-in-same-tx, money-as-paise,
   single `websiteStock`) accepted.
6. ☑ Auth model accepted: **guest-first customers**, optional accounts, phone-OTP
   deferred behind an interface; staff email+password + RBAC.
7. ☑ **Shared global `Product` master + per-store `StoreProduct` / `InventoryItem`**
   signed off (R1).
8. ☑ **Decrement website stock at successful placement; no re-decrement at POS
   billing; short-pick restores** (R3, R11).
9. ☑ Order state machine accepted: 9 states, **no customer cancellation**, audited
   admin correction, variance-guarded dispatch (R4, R6).
10. ☑ Picking → POS → packing → delivery workflow accepted; optional proof photo (R9).
11. ☑ POS integration boundary accepted as sufficient for a future no-rebuild
    integration (R14).
12. ☑ **Store-mapped delivery zones/areas; pincode is an attribute, not the routing
    key; shared-pincode allowed; stable `resolveServiceability` interface** (R8).
13. ☑ Testing strategy + coverage gates accepted.
14. ☑ Security baseline (incl. no PCI scope, manual UPI reconciliation) accepted (R13).
15. ☑ Deployment: containerized PG in dev, managed PG preferred in prod, **vendor +
    budget deferred to staging** (R10).
16. ☑ Risks reviewed — D-1/D-3/D-7/D-8/D-9/D-10/D-11 resolved; D-2/D-5/D-6 accepted
    (§D).
17. ☑ Roadmap phases + per-phase DoD accepted.
18. ☑ Agent responsibilities confirmed: Michael plans/architects/accepts, JIM builds,
    OSCAR independently reviews/tests/security.
19. ☑ ADRs authored — `docs/adr/README.md` (ADR-0001…0008).
20. ☑ **Go for Phase 1** against this v2 document.

---

## A. Recommended architecture (summary)

A **modular monolith**: one Next.js (App Router) + TypeScript app serving a
**guest-first, no-login-to-browse-or-cart** SSR storefront and an RBAC admin
dashboard, backed by a single PostgreSQL 16 database via Prisma (raw SQL only for
the stock `FOR UPDATE`), Tailwind + Radix. Bounded `src/modules/*` packages talk via
public `index.ts` functions + a synchronous in-process event bus; ESLint enforces
the boundaries. **Website stock (`websiteStock`, a single "Available to Sell"
number) decrements atomically at successful order placement**, with a `StockLedger`
row in the same transaction; POS billing never re-decrements it; short-picks restore
the difference. **No customer cancellation** — only an audited admin/store
correction. Delivery routing uses **store-mapped zones/areas** behind a stable
`resolveServiceability` interface (pincode is an attribute, shared pincodes allowed).
Price variance over **the lower of 5% or ₹50** flags the order and blocks dispatch
until staff confirm with the customer. Deployed as one Docker image on a small VPS
behind Caddy; containerized Postgres in dev, managed Postgres preferred in prod with
vendor/budget deferred to staging. A **POS anti-corruption layer** (interfaces +
`PosSkuMap` + `posMode`) is defined now so a vendor adapter drops in later with no
core or schema changes. No microservices, Redis, broker, payment gateway, rider app,
or SMS dependency in V1.

## B. Preliminary database / module design (summary)

- **Schema** (§3): `Store`, `StoreSettings`, `DeliveryZone`, `DeliveryArea`;
  `Category`, `Product` (unique sku), `ProductImage`, `StoreProduct`, `PriceChange`;
  `InventoryItem` (`websiteStock`), `StockLedger`, `PosSkuMap`; `User`, `Session`,
  `AuditLog`; `Customer` (guest-first), `CustomerAddress`, `OtpChallenge` (disabled);
  `Cart` (`cartToken`), `CartItem`; `Order` (+ `trackingToken`, variance fields),
  `OrderLine` (+ `stockRestoredQty`), `OrderStatusHistory`; `PickTask`,
  `PosBillingHandoff`, `DeliveryRecord`; `FeatureFlag`.
- **Invariants:** money as integer paise; every `websiteStock` mutation and every
  `Order.status` change writes its audit row in the same transaction, with
  `StockLedger.balanceAfter == websiteStock`; orders carry contact/address/price/name
  snapshots.
- **Inventory lifecycle:** `ORDER_PLACED` (−qtyOrdered, `FOR UPDATE`, fails if would
  go negative) → `PICK_SHORT_RESTORE` (+unpicked) → POS billing = no change →
  `ADMIN_CORRECTION` (+remaining) on audited correction. Plus `MANUAL_ADJUST`,
  `CSV_IMPORT`, `RECONCILE`, future `POS_SYNC`.
- **Modules** (§4): each is `domain/ + service.ts + repo.ts + index.ts + __tests__/`;
  only `index.ts` is public; cross-module reactions via the event bus
  (`order.placed`, `order.billed`, `stock.changed`, …).
- **POS boundary** (§16): `PosBillingGateway` (V1 `ManualPosBillingGateway`),
  `PosInventoryFeed` (V1 `NoopInventoryFeed` + CSV import), selected per store by
  `posMode`.

## C. Development roadmap (summary)

Phase 1 Foundation → 2 Identity + catalog + inventory core → 3 Storefront + cart →
4 Checkout + order lifecycle → 5 Fulfillment (+ manual POS handoff + variance gate +
POS interfaces) → 6 Admin reporting + ops/security hardening → 7 Staging UAT (managed
PG vendor + budget decided here) → 8 Production pilot (one store, real COD/UPI). Each
phase has a concrete DoD (§24). OSCAR signs off each phase; Michael integrates and
accepts. ADRs: `docs/adr/README.md` (ADR-0001…0008).

## D. Risks and unresolved decisions

| # | Item | Status after v2 |
|---|---|---|
| **D-1** | Estimate vs POS-final price → dispute risk | **Resolved (R6):** threshold = lower of 5% / ₹50, configurable; over → flag + staff confirm with customer before dispatch; under → no approval. |
| **D-2** | Inventory drift — POS walk-in sales vs website stock, no live sync | **Accepted for V1 (R12).** Mitigated by manual adjust, CSV/Excel import, reconciliation, timestamps, ledger history. Real fix = POS feed, post-pilot. |
| **D-3** | Customer auth channel / SMS vendor / India DLT | **Resolved (R2):** guest-first checkout; phone-OTP behind an interface, `FeatureFlag` OFF; **no SMS dependency in Phase 1**; enable post-pilot. |
| **D-4** | UPI-on-delivery reconciliation is manual | **Accepted (R13):** manual daily bank reconciliation for the pilot; `upiRef` captured per delivery. |
| **D-5** | Single instance — in-memory rate-limit breaks at 2+ containers | **Accepted for the pilot.** Switch to pg-backed when scaling. |
| **D-6** | No rider dashboard / no live tracking | **Accepted (R9, R12/§12):** delivery status is staff-updated; matches the stated constraint. |
| **D-7** | Managed vs self-hosted Postgres + budget | **Resolved (R10):** containerized in dev; managed preferred in prod; **vendor + budget ceiling deferred to staging**; not a Phase 1 blocker. |
| **D-8** | Delivery slot capacity | **Resolved (R7):** configurable one-hour slots, pilot default 10 orders/store/slot, independently editable per store. |
| **D-9** | Cancellation after POS billing | **Resolved (R4):** no customer cancellation at all; audited admin/store correction only; after `BILLED_IN_POS` also needs a recorded manual POS void. |
| **D-10** | Guest checkout vs forced account | **Resolved (R2):** guest-first; account never required to order. |
| **D-11** | Shared product master vs per-store duplication | **Resolved (R1):** shared global `Product` master approved; per-store `StoreProduct` / `InventoryItem`. |

Remaining genuinely open (tracked, not Phase 1 blockers): managed-PG vendor + monthly
budget (decide at staging, D-7); whether to enable optional customer email/password
accounts in the pilot (default: implement, keep low-friction); substitution customer-
notification wording (pilot default: proceed + notify).

## E. Phase 0 acceptance checklist

See §25 — all 20 items satisfied by this v2 document plus the human's overrides.
**Phase 0 is accepted; Phase 1 is authorised against this document.**

---

*End of Phase 0 (v2). Phase 1 implementation proceeds against this document only.*
