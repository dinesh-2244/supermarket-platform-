# Phase 4 — Checkout + Order Lifecycle (implementation plan)

**Owner (build):** JIM Builder · **Independent review/test:** OSCAR Reviewer ·
**Integration + acceptance:** Michael
**Authorised against:** `docs/phase-0-architecture.md` (v2.1) + `docs/adr/README.md`
**Builds on:** Phase 3 (`v0.3.0-storefront`, `main @ 2087bc4`) — no-login storefront +
`pg_trgm` search, single-store `cartToken` cart with server-authoritative
`cart.revalidate`, `stores.resolveServiceability`, optional `CustomerSession`
accounts + address book.
**Status:** DRAFT — awaiting human approval before dispatch (2026-09-08)

> Phase 4 turns a revalidated cart into a **placed order**. It adds
> `checkout.placeOrder()` (the single transaction that decrements website stock,
> writes the `ORDER_PLACED` ledger, and creates the `Order`), the explicit
> **order state machine**, one-hour delivery slots with per-store capacity,
> COD / UPI-on-delivery choice, the guest `/order-status/[trackingToken]` page,
> and the audited admin `CANCELLED_BY_STORE` correction.
> **Fulfillment stops here.** Picking, POS-bill entry, packing, dispatch and
> delivery-outcome recording are **Phase 5** — the state machine is built in full
> now, but Phase 4 only drives it as far as `PLACED` (+ the admin correction and
> the variance guard, both unit-proven).

---

## Objective

A shopper with **no login** can take a revalidated cart through checkout: confirm
name + phone + delivery address (which resolves — via `resolveServiceability` — to
the cart's store), pick a one-hour delivery slot that still has capacity, choose
**COD or UPI-on-delivery**, and place the order. Placement is **one transaction**:
each line's `InventoryItem` is locked, `websiteStock` is decremented by the ordered
quantity with a `StockLedger` `ORDER_PLACED` row (`balanceAfter` correct) in that
same transaction, a lightweight `Customer` is upserted by phone, the `Order` +
`OrderLine` snapshots are written, a `trackingToken` is minted, the cart is marked
`CONVERTED`, and `order.placed` is emitted once. The shopper sees an
order-confirmation page and can follow `/order-status/[trackingToken]`. Staff see
the order in a store-scoped admin queue and can issue an audited
`CANCELLED_BY_STORE` correction that restores stock. `main` stays CI + Playwright
green. **There is no customer-facing cancellation, no picking/POS/delivery workflow,
and no real notification delivery.**

## What Phase 3 (and 1–2) already give us — consume read-only via `index.ts`, do not rebuild

- `cart` — `cart.revalidate(cartToken)` semantics (price/stock/listing), single-store binding, `CartItem.unitPriceSnapshotPaise`, `Cart.status` (`ACTIVE` → `CONVERTED`).
- `stores.resolveServiceability(input) → { servable, storeId?, areaId?, deliveryFeePaise?, minOrderPaise?, … }` — the stable routing interface. Phase 4 calls it; it does not change it.
- `stores` — `StoreSettings` (`slotLengthMinutes` default 60, `slotCapacity` default 10, `deliveryFeePaise`, `minOrderPaise`, `priceVariancePercentBp` default 500, `priceVarianceAbsCapPaise` default 5000, `isAcceptingOrders`, store `timezone`).
- `inventory` — `InventoryItem.websiteStock` + the branded-`Tx` rule that **every** `websiteStock` mutation writes a `StockLedger` row with `balanceAfter` in the **same** transaction; `SELECT … FOR UPDATE` helper.
- `customers` — `Customer` (unique `phone`, nullable `email`/`passwordHash`), `CustomerSession` principal (ADR-0010), `CustomerAddress` (default + soft-delete, resolves a `DeliveryArea`).
- `platform` kernel — `db` (`withTransaction`, branded `Tx`), `money` (integer paise), `ids` (opaque token generator), `event-bus`, `errors` + edge mapper, `authz` (`authorize()` deny-by-default, `allowedStoreIds` scoping), `audit.writeAuditLog(tx, …)`, `advisoryXactLock` + `LOCK_NAMESPACE` (added Phase 3), `observability`.
- **Schema is already complete** — `Order`, `OrderLine`, `OrderStatusHistory`, `OrderStatus` enum (all 12 states), `PaymentMethod` (`COD` | `UPI_ON_DELIVERY`), `StockLedgerReason.ORDER_PLACED` / `ADMIN_CORRECTION`, every timestamp column and the variance fields are in `prisma/schema.prisma`. Phase 4 expects **no migration** (at most one additive index — see D8).
- `notifications` — `NotificationProvider` seam, no-op provider in dev/pilot.
- `orders` and `checkout` modules exist as skeletons (`index.ts` / `service.ts` / `repo.ts`).

## Deliverables

### D1 — `orders` module + the state machine (`src/modules/orders/`)

- **`orders/state-machine.ts`** — an explicit transition table: `from → allowed[] → guard? → sideEffects`, covering the whole lifecycle
  `PLACED → ACCEPTED → PICKING → PICKED → BILLED_IN_POS → PACKED → OUT_FOR_DELIVERY → DELIVERED → CLOSED`
  plus `CANCELLED_BY_STORE` (terminal, from any state before `OUT_FOR_DELIVERY`),
  `OUT_FOR_DELIVERY → DELIVERY_FAILED → {OUT_FOR_DELIVERY | CLOSED_UNDELIVERED}`.
- **`transition(tx, orderId, to, actor, note?)` is the only code path that mutates `Order.status`.** In one transaction it: validates the edge, runs the guard, writes an `OrderStatusHistory` row (`fromStatus`/`toStatus`/`actorType`/`actorId`/`note`), sets the matching timestamp column (`acceptedAt`, `pickedAt`, …), and emits `order.<transition>`. An illegal edge throws and writes nothing.
- **Variance guard** — `PACKED → OUT_FOR_DELIVERY` is blocked while `priceVarianceFlagged && !customerConfirmedRevisedAmount`. Pure helper `computeVariance(estimatedTotalPaise, posFinalTotalPaise, percentBp, absCapPaise) → { overage, threshold, flagged }` (threshold = `min(estimated × percentBp/10000, absCapPaise)`; POS total ≤ estimate ⇒ not flagged).
- **`orders.createOrder(tx, input)`** — internal, called only by `checkout.placeOrder`. Inserts the `Order` at `status = PLACED` as the **initial state** (not a transition) and writes the opening `OrderStatusHistory` row (`fromStatus = null → PLACED`). Mints `orderNumber` (per-store zero-padded sequence — mechanism JIM's call; must be collision-safe under concurrency) and `trackingToken` (opaque, via `ids`).
- **`orders.cancelByStore(tx, orderId, actor, reason)`** — `STORE_MANAGER` / `SUPER_ADMIN` only, store-scoped. Allowed from any state **before `OUT_FOR_DELIVERY`**. Transitions to `CANCELLED_BY_STORE` (terminal); for every line restores `qtyOrdered − stockRestoredQty` to `websiteStock` with an `ADMIN_CORRECTION` `StockLedger` row and bumps `stockRestoredQty` (so a prior short-pick restore and this correction can never double-restore); `reason` is mandatory; writes `AuditLog` (before/after) + the `OrderStatusHistory` note. After `BILLED_IN_POS`, also requires a `discrepancyNote` (manual POS void).
- **No customer-cancel transition exists** anywhere in the table.
- **100 % branch coverage on `state-machine.ts`** — every legal edge, every illegal edge rejected, the variance guard both ways, the `cancelByStore` state gate. The coverage gate must genuinely bite (negative-mutation check).

### D2 — `checkout.placeOrder()` (`src/modules/checkout/`)

`placeOrder({ cartToken, contact:{name,phone}, addressInput, slotStart, paymentMethod, customerSession? }) → { orderNumber, trackingToken, slotStart, slotEnd, estimatedTotalPaise, paymentMethod }`

1. `stores.resolveServiceability(addressInput)` → store + `deliveryFeePaise` + `minOrderPaise`. Out-of-zone ⇒ reject (optionally capture `ServiceabilityRequest`), **no order written**.
2. The resolved `storeId` **must equal** the cart's `storeId`. If it differs, reject with a clear "your basket is for <other store>" message (the Phase 3 area-switch/rebuild flow is how the shopper reconciles) — checkout never silently cross-stores a cart.
3. **One transaction** (`withTransaction`, branded `Tx`):
   - `SELECT … FOR UPDATE` the `Cart` row. A non-`ACTIVE` cart (already `CONVERTED`) ⇒ reject — this is the idempotency / double-submit guard.
   - Re-run revalidation server-side (price / stock / listing). Any unlisted line, or `qty > websiteStock`, ⇒ roll back with per-line errors.
   - Enforce **min-order**: `subtotal ≥ minOrderPaise` else reject.
   - **Slot capacity gate** under `advisoryXactLock(LOCK_NAMESPACE.deliverySlot, hash(storeId, slotStart))`: count non-cancelled `Order`s in that `(storeId, slotStart)` window; `< slotCapacity` else reject "slot full". Also validate the slot is a real future slot for that store (lead time + horizon + `isAcceptingOrders`).
   - `SELECT … FOR UPDATE` each line's `InventoryItem` **in a deterministic order** (by `productId`) to avoid deadlock. For each: `websiteStock -= qtyOrdered` + a `StockLedger` `ORDER_PLACED` row with `balanceAfter` — in this tx.
   - Upsert the lightweight `Customer` by `phone` (`name` filled/updated). If `customerSession` is present, link that `customerId` (never overwrite a different one).
   - `orders.createOrder(tx, …)` → `Order` (`status = PLACED`, `subtotalPaise`, `deliveryFeePaise`, `estimatedTotalPaise = subtotal + deliveryFee`, contact + address snapshots, `deliverySlotStart/End`, `paymentMethod`) + `OrderLine` rows (name / packSize / unitPrice / qty snapshots).
   - Mark the cart `CONVERTED`.
4. After commit: emit `order.placed` **once** (payload: `orderId`, `orderNumber`, `storeId`, `trackingToken`).
5. `order.placed` ⇒ `notifications` no-op provider "sends" a confirmation (logged, not delivered).

The customer is shown **"estimated total — final amount confirmed at billing."**

### D3 — Delivery slots (`stores` read interface)

- **`stores.availableSlots(storeId, fromInstant, horizonDays) → Slot[]`** where `Slot = { start, end, capacityRemaining }`. Derived from `StoreSettings.slotLengthMinutes` / `slotCapacity` minus non-cancelled `Order`s per window, in the store's `timezone`, honouring a configurable **lead time** (no slot starting too soon) and a booking **horizon**; empty when `isAcceptingOrders = false`.
- `capacityRemaining` here is advisory (for the UI). The **authoritative** capacity gate is the advisory-locked count inside `placeOrder` (D2) — the UI number can be stale and that is fine.
- Interface stays stable like `resolveServiceability` (the derivation can later become a real booking table without touching callers).

### D4 — Checkout UI (`src/app/(storefront)/checkout/`)

- SSR checkout: **contact** (prefilled from the `CustomerSession` + default address when signed in; editable), **delivery address** (reuse the Phase 3 locality picker → `resolveServiceability`), **slot picker** (from D3), **payment method** (COD / UPI-on-delivery radio), **review + place**.
- Server action → `checkout.placeOrder()`. Success ⇒ **order-confirmation page**: `orderNumber`, estimated total, the "final amount confirmed at billing" line, slot, payment method, and the `/order-status/<trackingToken>` link.
- Empty cart / out-of-zone / wrong-store cart / min-order-not-met / slot-full / stock-shortfall ⇒ clear inline errors, **no order written**, cart untouched.
- The Phase 3 disabled "Checkout arrives in Phase 4" affordance becomes the live entry point.

### D5 — Guest order-status page (`src/app/(storefront)/order-status/[trackingToken]/`)

- **Read-only, no auth**, opaque token. Shows: order number, current status + a human timeline built from `OrderStatusHistory`, slot, payment method, line items (name + qty + unit-price snapshot), subtotal / delivery fee / estimated total, and the delivery-address locality the shopper entered.
- No mutation of any kind. Unknown or malformed token ⇒ a generic 404 with no timing or enumeration signal.

### D6 — Admin Orders screens (`src/app/(admin)/admin/orders/`)

- **Queue** — orders by status, **store-scoped** to the staff member's `allowedStoreIds`; default to actionable states; columns: order #, placed-at, slot, status, total, variance flag.
- **Order detail** — snapshots, lines, the status timeline, payment method, slot, variance flag + `customerConfirmedRevisedAmount` state.
- **Admin correction** — `CANCELLED_BY_STORE` action (`STORE_MANAGER` / `SUPER_ADMIN` only) with a **mandatory reason**, calls `orders.cancelByStore`; the UI shows the restored quantities afterwards.
- **Variance** — display the flag and a "customer confirmed revised amount" action (records `customerConfirmedRevisedAmount` + `revisedAmountConfirmedBy`); the guard it feeds is D1. *Setting `posBillNumber` / `posFinalTotalPaise` — the entry that raises the flag — is Phase 5.*
- No picking / delivery screens. `admin` stays a thin read-model over `orders` (+ `stores` for labels).

### D7 — Events + notifications wiring

- `order.placed` emitted once by `checkout`; `order.<transition>` emitted by `transition()` for every edge. Document the event names + payloads in the module `index.ts` / README.
- `notifications` no-op provider consumes `order.placed` and logs a "confirmation sent" line. `NotificationProvider` seam unchanged; **no real SMS / email**.

### D8 — Migrations, seed, docs, ADR

- Schema is already complete ⇒ **expect no migration**. If a query needs it, at most **one additive index** (e.g. `Order(deliverySlotStart)` for the capacity count). **Hand-check the `pg_trgm` GIN `migrate diff` drift** regardless (`p2-followup-gin-index-drift`) — and note this plan assumes the standalone **stabilization round** has already given that a permanent fix; if not, strip the two `DROP INDEX` lines as before and flag it.
- `seed.ts` (idempotent) — a couple of demo placed orders per store in assorted early states (`PLACED` / `ACCEPTED`) so the admin queue and the status page render with data; keep the demo customer + address.
- `README.md` — the checkout flow, slot behaviour, the `/order-status/<token>` URL, demo order numbers.
- `docs/adr/README.md` — **ADR-0011** recommended: the slot-capacity concurrency approach (advisory-locked count vs. a booking table) and the `orderNumber` scheme.

## Task breakdown (one PR each, `feat/p4-*`, stacked on `main @ 2087bc4`)

| PR | Scope | Key tests |
|---|---|---|
| **P4-1** | `orders` state machine: transition table, `transition()` as sole mutator, `computeVariance` + guard, `createOrder`, `cancelByStore`. No HTTP surface. | unit: every legal + illegal edge; variance guard both ways; `cancelByStore` state gate + `stockRestoredQty` no-double-restore; **100 % branch coverage** on `state-machine.ts` (negative-mutation check). |
| **P4-2** | `checkout.placeOrder()` — the single tx: FOR-UPDATE lines, decrement + `ORDER_PLACED` ledger, `Customer` upsert, `Order`/`OrderLine` snapshots, cart `CONVERTED`, `order.placed`. | integration: happy path writes exactly one ledger row/line with correct `balanceAfter`; insufficient stock ⇒ full rollback + per-line errors; **last-unit race** (2 concurrent ⇒ 1 order); **double-submit** (rapid 2× ⇒ 1 order); min-order + out-of-zone + wrong-store-cart ⇒ no order. |
| **P4-3** | `stores.availableSlots` + the advisory-locked capacity gate in `placeOrder`. | integration: slot list respects `slotLengthMinutes`/`slotCapacity`/timezone/lead-time/horizon/`isAcceptingOrders`; **N ≫ C concurrent placements into a capacity-C slot ⇒ exactly C succeed**. |
| **P4-4** | Checkout UI + server action + order-confirmation page. | e2e: no-login cart → address → slot → COD → placed → confirmation shows order # + tracking link; error states write no order. |
| **P4-5** | `/order-status/[trackingToken]` guest page. | integration: valid token renders timeline; garbage/unknown token ⇒ generic 404, no enumeration; page performs no writes. |
| **P4-6** | Admin Orders queue + detail + timeline + `CANCELLED_BY_STORE` correction + variance-confirm action. | integration: queue store-scoped (manager can't see/correct the other store's order); correction restores exactly `qtyOrdered − stockRestoredQty` + writes `AuditLog` + history; RBAC on the correction action. |
| **P4-7** | Events/notifications wiring + seed demo orders + README + ADR-0011. | integration: `order.placed` fires once; no-op provider logs; seed idempotent (re-run leaves counts stable). |
| **P4-8** | Playwright golden path + a11y/responsive + any additive index migration. | e2e: browse → cart → checkout (address, slot, COD) → placed → confirmation → track by token; admin sees it, corrects it, stock restored; no horizontal scroll at 390 px; variance guard unit-proven in the suite. |

Keep **P4-1** (state machine) and **P4-2** (placeOrder tx) individually reviewable.

## Definition of Done (Phase 4)

- [ ] `main` green in **hosted CI** (typecheck, lint incl. boundaries, unit, integration on real Postgres, `next build`) **and** the Playwright job, on the exact merge candidate.
- [ ] A shopper with **no login** completes checkout: address → store-bound one-hour slot with remaining capacity → COD / UPI-on-delivery → order placed, and lands on a confirmation page with the order number and tracking link.
- [ ] `checkout.placeOrder()` is **one transaction**: each line's `InventoryItem` is `SELECT … FOR UPDATE`-locked in deterministic order; insufficient stock ⇒ **full rollback** with per-line errors and **no** partial writes; otherwise `websiteStock -= qtyOrdered` **and** a `StockLedger` `ORDER_PLACED` row with correct `balanceAfter` per line, all in that tx; `order.placed` emitted **once**.
- [ ] **Concurrency:** two orders for the last unit ⇒ exactly one succeeds; N ≫ C concurrent orders into a capacity-C slot ⇒ exactly C succeed; a double-submitted checkout places exactly one order (`CONVERTED`-cart guard under row lock).
- [ ] `orders/state-machine.ts` holds the full transition table and has **100 % branch coverage** — every legal edge, every illegal edge rejected with no history row, the variance guard on `PACKED → OUT_FOR_DELIVERY`. **`transition()` is the only code path that mutates `Order.status`** (asserted).
- [ ] Every `Order.status` change writes an `OrderStatusHistory` row in the same tx; every `websiteStock` change writes a `StockLedger` row with correct `balanceAfter` in the same tx.
- [ ] **No customer cancellation** exists — no route, no transition value, no reachable service method from `(storefront)`. Admin `CANCELLED_BY_STORE` from any pre-`OUT_FOR_DELIVERY` state, `STORE_MANAGER`/`SUPER_ADMIN` only, mandatory reason, restores each line's not-yet-restored stock via `ADMIN_CORRECTION` (no double-restore vs. `stockRestoredQty`), writes `AuditLog` + `OrderStatusHistory`, store-scoped.
- [ ] Guest `/order-status/[trackingToken]` is read-only, opaque, enumeration-safe; a bad token is a generic 404.
- [ ] `estimatedTotalPaise = subtotal + deliveryFee` (integer paise throughout); min-order enforced at checkout; order snapshots are frozen (later price/catalog/address edits don't mutate a placed order); the customer sees "estimated — final confirmed at billing".
- [ ] Boundary lint green; `checkout` / `orders` reach peers only via `index.ts`; no `app/**` → `repo.ts`.
- [ ] Migrations additive + re-runnable (expected: none, or one additive index); seed idempotent; any new migration hand-checked for the GIN `migrate diff` drift; `/api/health` green.
- [ ] No secrets committed; deps pinned; `npm audit` clean of high/critical. All Phase 1–3 tests still pass; the coverage gate still bites.
- [ ] OSCAR independent review sign-off; Michael merged to `main` and tagged **`v0.4.0-checkout`**.

## Boundaries — explicitly NOT in Phase 4

- **No picking / short-pick / substitution workflow**, no `PickTask` UI or lifecycle — Phase 5. (`OrderLine.lineStatus`, `qtyPicked`, `stockRestoredQty` exist in schema; Phase 4 only reads / initialises them.)
- **No POS-bill entry** — nothing sets `posBillNumber` / `posFinalTotalPaise`, no `PosBillingHandoff` row, no variance flag raised *from a real POS total*. `computeVariance` + the guard are built and unit-tested; the data entry that triggers them is Phase 5.
- **No packing / dispatch / delivery-outcome** recording, no `DeliveryRecord` — Phase 5.
- **No real SMS / email.** `notifications` stays a no-op provider; the confirmation is logged, not delivered. Forgot-password / customer email remain deferred (no vendor).
- **No customer-facing cancellation, returns, refunds, or partial returns** (post-pilot).
- **No phone OTP** (`customer_otp_login` stays OFF; `OtpChallenge` dormant).
- **No POS adapter of any kind** — POS integration is capability-dependent (R14a / ADR-0007); only the vendor-neutral boundary is kept.
- **No PostGIS / geo serviceability**; `resolveServiceability` is unchanged.
- **No promotions / coupons / loyalty / discounts** in the order model (POS-side discounts are applied at the POS in Phase 5, not modelled here).
- **No production hosting or managed-Postgres vendor / budget decision** (Phase 7).
- **No changes to the RBAC rule table, the `StockLedger` invariant, `resolveServiceability`, or any Phase 2 / Phase 3 screen.**

## OSCAR — independent review scope for Phase 4

Review each PR and the merged result independently (own checkout/worktree, own test
run, own hosted-CI + Playwright check on the exact candidate). Findings as written
notes to Michael — **no silent fixes**.

- **Stock-decrement integrity** — across every `placeOrder` path: exactly `qtyOrdered` decremented per line, exactly one `ORDER_PLACED` ledger row per line, `balanceAfter` equals the resulting stock, all inside the one transaction; a forced mid-transaction failure leaves **zero** writes (no order without a decrement, no decrement without an order, no orphan ledger row).
- **Concurrency** — reproduce independently: last-unit race (2 shoppers, 1 unit → 1 order + 1 clean rejection); slot capacity (N ≫ C concurrent → exactly C, i.e. the advisory lock actually serialises); double-submit / `CONVERTED`-cart guard (rapid double POST → 1 order); no deadlock under interleaved line-lock acquisition (deterministic `productId` ordering).
- **State machine** — drive every legal and illegal edge directly; confirm `transition()` is the sole `Order.status` mutator (source grep + a write-path test); the variance guard blocks `PACKED → OUT_FOR_DELIVERY` until `customerConfirmedRevisedAmount`; illegal edges throw and write no history; 100 % branch coverage is genuinely exercised (negative-mutation check bites).
- **Admin correction** — `CANCELLED_BY_STORE` only pre-`OUT_FOR_DELIVERY`, only `STORE_MANAGER` / `SUPER_ADMIN`, reason mandatory; restores exactly `qtyOrdered − stockRestoredQty` per line with no double-restore (including after a simulated prior short-pick restore); `AuditLog` before/after + `OrderStatusHistory` written; a manager cannot correct the other store's order.
- **No customer cancellation** — no route, no `OrderStatus` value, no service method reachable from `(storefront)` that ends an order.
- **Guest tracking** — `/order-status/[trackingToken]` is read-only; a wrong / garbage / well-formed-but-unknown token yields a generic 404 with no timing or enumeration signal; no other order's data is reachable; the token is opaque and not guessable; the page writes nothing.
- **Serviceability + cart-binding regression** — checkout uses `resolveServiceability`; an address resolving to a different store than the cart is rejected, never silently cross-stored; min-order enforced at checkout; out-of-zone writes no order; `resolveServiceability` interface unchanged.
- **Money & snapshots** — integer paise everywhere; `estimatedTotalPaise = subtotal + deliveryFee`; contact / address / line snapshots are frozen against later catalog / price / address edits.
- **Boundaries & regressions** — boundary lint rejects a crafted cross-module import; `checkout` / `orders` use only `index.ts`; all Phase 1–3 tests pass; coverage gate still bites; migrations additive + re-runnable; seed idempotent; `/api/health` green.
- **Security** — no secrets in repo/history; deps pinned; `npm audit` clean of high/critical; `order.placed` emitted exactly once; no PII in the tracking token or logs beyond need.

Deliver: a PASS / CHANGES-REQUESTED note per PR + a Phase-4 summary verdict, and an
explicit statement that hosted CI + the Playwright job are green on the exact merge
candidate.

## Acceptance gate (before Michael merges + tags `v0.4.0-checkout`)

1. JIM delivers `feat/p4-1..p4-8` (stacked; merging the tip brings all of Phase 4).
2. OSCAR independent review → PASS, with **stock-decrement integrity**, the
   **concurrency races** (last unit, slot capacity, double-submit), the
   **100 %-branch state machine**, and the **admin-correction restore** all
   independently reproduced.
3. Green hosted CI + integration + Playwright on the exact candidate commit.
