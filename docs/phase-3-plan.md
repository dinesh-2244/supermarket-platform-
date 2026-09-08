# Phase 3 — Storefront + Cart (implementation plan)

**Owner (build):** JIM Builder · **Independent review/test:** OSCAR Reviewer ·
**Integration + acceptance:** Michael
**Authorised against:** `docs/phase-0-architecture.md` (v2.1) + `docs/adr/README.md`
**Builds on:** Phase 2 (`v0.2.0-backoffice`, `main @ 316f51b`) — staff auth + RBAC,
stores/settings/zones/areas + `resolveServiceability`, shared-master catalog +
`pg_trgm` search, per-store pricing, inventory `websiteStock` + `StockLedger`.
**Status:** draft 2026-09-08

> Phase 3 puts the **customer-facing storefront** in front of the Phase 2 catalogue:
> no-login browse and search per store, product pages, a locality picker that binds
> a store, and a single-store cart that always revalidates price and stock
> server-side. Optional email/password customer accounts.
> **No checkout.** `placeOrder`, delivery slots, COD/UPI choice, order creation,
> the order-status page and everything downstream are **Phase 4**. Phase 3 stops at
> a fully revalidated cart with a disabled/"coming soon" checkout affordance.

---

## Objective

A shopper can, with **no login**, pick their locality, browse and search that
store's listed products at that store's prices, open product pages, and build a cart
that is bound to one store and revalidates against live price/stock/listing on every
view. A shopper may **optionally** create an email/password account (a principal
entirely separate from staff `User`s) with a profile and address book; their guest
cart follows them in. `main` stays CI + Playwright green. **Nothing in Phase 3
writes an `Order`, an `OrderLine`, `websiteStock` or a `StockLedger` row.**

## What Phase 2 already gives us (consume read-only via `index.ts`, do not rebuild)

- `stores.resolveServiceability(input) → { servable, storeId?, zoneId?, areaId?, deliveryFeePaise?, minOrderPaise?, slots? }` — the stable routing interface. Phase 3 calls it; it does not change it.
- `catalog` — `Category` tree, `Product` master, `ProductImage`, and the `pg_trgm`/`ILIKE` search function (scope it to the store's listed products).
- `pricing` — per-store `StoreProduct` (`isListed`, `mrpPaise`, `sellingPricePaise`).
- `inventory` — per-store `InventoryItem.websiteStock` (read for availability display only — **no writes**).
- `platform` kernel — `config`, `logger`, `db` (`withTransaction`, branded `Tx`), `errors` + edge mapper, `event-bus`, `money` (integer paise), `ids` (`cartToken` generator already exists), `authz`, `observability`, `audit`.
- Schema tables already present from Phase 1: `Cart`, `CartItem`, `Customer` (nullable `email` + `passwordHash`), `CustomerAddress`, `OtpChallenge` (stays dormant), `FeatureFlag` (`customer_otp_login` = OFF).
- `Session` + the Phase 2 revocable-session mechanism (opaque id + DB row, principal re-read per request). Phase 3 adds a **customer** principal alongside the staff one — same mechanism, separate identity.

## Deliverables

### D1 — Storefront shell + store context (`src/app/(storefront)/`)

- SSR route group `(storefront)`, mobile-first Tailwind, `img{max-width:100%}`, **no horizontal body scroll**. Header shows the chosen area, a store label, and a live cart-item count.
- **Locality picker** — the visitor selects a `DeliveryArea` from a store-curated list (optionally typing a pincode to filter). The choice calls `stores.resolveServiceability` and stores the result (`areaId` + resolved `storeId`) in a signed/opaque cookie (`storeContext`). A visitor with no context set sees the picker first (interstitial), not a catalogue.
- **Out-of-zone** — `servable:false` → a "we don't deliver here yet" page with an optional email/pincode capture that writes a `ServiceabilityRequest` row. No catalogue shown.
- **Shared-pincode correctness** — two areas under different stores that share a pincode must each resolve to their own store (regression guard on the Phase 2 behaviour).
- Changing the area is always possible from the header (feeds D5).

### D2 — Catalogue browse + product detail (SSR)

- Pages: **home** (featured/recent categories + products for the store), **category browse** (a `Category` and its subtree, paginated, sorted by `aisleSortKey` then name), **product detail** (`/p/[slug]`).
- Everything is scoped to the **resolved store**: only `StoreProduct.isListed = true` for that store; price is that store's `sellingPricePaise`/`mrpPaise`; availability comes from that store's `InventoryItem.websiteStock` (`In stock` / `Only N left` / `Out of stock`, thresholds documented).
- A product not listed for the store, or with an unresolvable slug, → 404. A slug is global; the store context decides listing/price/stock.
- Product detail shows images (URLs from Phase 2), pack size, brand, category breadcrumb, and an **Add to cart** control disabled when `websiteStock <= 0`.
- No price or stock value is ever taken from the client.

### D3 — Search (SSR)

- `/search?q=…` — calls the Phase 2 `catalog` search (`pg_trgm` / `ILIKE` on name + brand) **scoped to the store's listed products**, paginated, same product-card component as browse.
- Empty query → prompt; no results → a clear empty state; whitespace/1-char handled; input length-capped; the query is never interpolated into raw SQL (parameterised through the existing service).

### D4 — `cart` module + cart page

- One `ACTIVE` `Cart` per `cartToken` cookie (`ids.cartToken`, opaque, **HttpOnly**, `SameSite=Lax`, long-lived), **bound to exactly one `storeId`**, `customerId` nullable (filled by D6 on auth).
- Operations: add item, change quantity, remove item, view cart. `CartItem.unitPriceSnapshotPaise` is captured at add time.
- **Revalidation runs on every cart view and every mutation** (`cart.revalidate(cartToken)`):
  - unlisted item (`isListed=false` now) → removed, with a notice;
  - `sellingPricePaise` changed since the snapshot → line shows old→new, cart uses the **current** price, snapshot updated;
  - requested qty > current `websiteStock` → line flagged "only N available" (do **not** silently cap; the shopper adjusts);
  - `websiteStock <= 0` → line flagged out of stock.
- Cart totals (subtotal, and the store's `deliveryFeePaise` / `minOrderPaise` shown for information) use authoritative server values. Min-order is **displayed, not enforced** (enforcement is checkout / Phase 4).
- A **"Proceed to checkout"** control that is visibly disabled with a "Checkout arrives in Phase 4" note — no route, no order write.
- Adding a product from a different store than the cart's `storeId` is rejected at the service layer (the UI shouldn't offer it, but the service must not trust that).

### D5 — Area switch → cart rebuild

- Changing the delivery area re-runs `resolveServiceability`.
- **Same store** → just update the context; cart is untouched (a later revalidation still applies).
- **Different store** → rebuild the cart against the new store: for each line, if the product is listed and in stock there, re-add it at that store's current price; otherwise drop it. Show a clear summary of what carried over and what was dropped, and update `Cart.storeId`. This is one transaction; the old cart lines are replaced, not merged.
- Out-of-zone after a switch → context cleared back to the picker; the cart is kept but inert until a serviceable area is chosen again (document the exact behaviour and test it).

### D6 — Optional customer accounts (`customers` module + `(auth)` customer routes)

- Email + **argon2id** password on `Customer` (`email` unique where set, `passwordHash` nullable). Auth.js credentials provider for the **customer** principal, DB sessions via the Phase 2 mechanism — **a customer session is a distinct principal type from a staff `User` session**.
- Flows: **sign up** (email + password + name + phone), **sign in**, **sign out**, **change password while signed in**. No email enumeration on sign-up or sign-in (uniform responses/timing). Rate-limit-friendly shape but no limiter built.
- **Forgot-password / reset is deferred** — it needs an email vendor that is not wired (same posture as phone-OTP). Document the gap; the interface seam (`NotificationProvider`) already exists.
- **Guest cart adoption** — on sign-in/sign-up, the current `cartToken` cart gets `customerId` set (if the customer already had an `ACTIVE` cart for a *different* store, keep the just-authenticated device's cart and mark the other `ABANDONED`; document the rule).
- **Isolation:** a customer session must not grant any access to `/admin/*` or any staff action; a staff `User` session must not be treated as a customer principal on `(storefront)` account pages. Middleware + per-action server checks, same rigour as Phase 2.
- `FeatureFlag.customer_otp_login` stays **OFF**; `OtpChallenge` stays dormant.

### D7 — Account area (`src/app/(storefront)/account/`)

- Visible only when a customer session exists.
- **Profile** — view/edit name, phone; email shown, change-email deferred with password reset.
- **Address book** — `CustomerAddress` CRUD: multiple addresses, exactly one `isDefault`, **soft-delete** (`isDeleted`), each resolves against a `DeliveryArea` (reuse the D1 locality picker). `pincode` stored as an attribute.
- **Order history** — a stub list with an empty state ("no orders yet"); real once Phase 4 creates orders.
- All account data is scoped to the session's `customerId` — no IDOR (try to read another customer's address by id → refused).

### D8 — Migrations, seed, docs

- Any schema change is an **additive** Prisma migration; no destructive change to Phase 1/2 tables. Expected additions are small or none (e.g. an index on `Cart(cartToken)` / `CartItem(cartId)` if not already present, `Cart.storeId` FK/index). **Watch the pg_trgm GIN `migrate diff` drift** (`p2-followup-gin-index-drift`) — hand-check any new migration.
- Extend `seed.ts` (idempotent): a few more listed products per store with images, and **one demo customer account** (email + argon2id password, one default address).
- `README.md` — storefront routes, the `storeContext` cookie, the demo customer credentials (dev only).
- `docs/adr/README.md` — a short **ADR-0010** if the customer-principal / session-sharing design or the area-switch cart-rebuild rule warrants recording (recommended for the principal split).

## Task breakdown (one PR each, `feat/p3-*`, stacked on `main @ 316f51b`)

| PR | Scope | Key tests |
|---|---|---|
| **P3-1** | Storefront shell + `storeContext` cookie + locality picker + `resolveServiceability` wiring + out-of-zone page & `ServiceabilityRequest` capture. | unit: context cookie round-trip; integration: shared-pincode → correct store, out-of-zone → capture; e2e: first-visit interstitial. |
| **P3-2** | SSR home / category browse / product detail, store-scoped listing+price+availability; 404s. | integration: unlisted/other-store product 404s; availability bands from `websiteStock`; price is the store's. |
| **P3-3** | Search page over the Phase 2 `pg_trgm` service, store-scoped, paginated. | unit: query sanitisation/length cap; integration: results limited to listed products; empty/no-result states. |
| **P3-4** | `cart` module + cart page: token cookie, single-store binding, add/update/remove, `cart.revalidate` on every view/mutation. | integration: price-change surfaced + authoritative price used; qty > stock flagged not capped; unlisted removed; cross-store add rejected; **assert zero `Order`/`websiteStock`/`StockLedger` writes**. |
| **P3-5** | Area switch → same-store no-op / different-store cart rebuild (one tx) with a carried/dropped summary; out-of-zone-after-switch behaviour. | integration: rebuild keeps in-stock listed lines at the new store's price, drops the rest, sets `Cart.storeId`; e2e: switch store 1→2 shows the warning. |
| **P3-6** | Customer accounts: Auth.js credentials for `Customer` (argon2id, DB sessions), sign up/in/out + change-password, no enumeration, **principal isolation from staff**, guest-cart adoption on auth. | unit: customer-vs-staff principal separation matrix; integration: customer session refused on `/admin` + staff actions; guest cart gets `customerId` on sign-in. |
| **P3-7** | Account area: profile, address-book CRUD (default + soft-delete, resolves a `DeliveryArea`), order-history stub. IDOR-scoped to the session customer. | integration: reading another customer's address by id → refused; exactly one `isDefault`; soft-delete keeps the row. |
| **P3-8** | Playwright golden path + responsive/a11y checks + seed extension + README/ADR. | e2e: no-login pick area → browse → search → product → add to cart → revalidation case → switch store → rebuild warning; out-of-zone; create account → cart adopted → add address. No horizontal scroll at 390px. |

PRs may be combined if small; keep P3-4 (cart + revalidation) and P3-6 (customer auth) individually reviewable.

## Definition of Done (Phase 3)

- [ ] `main` green in **hosted CI** (typecheck, lint incl. boundaries, unit, integration on real Postgres, `next build`) **and** the Playwright job, on the exact merge candidate.
- [ ] With **no login**: pick a locality → the store is bound; browse home/category/product and search, all showing that store's listed products, prices and availability; add to a cart.
- [ ] The cart is bound to exactly one store and **revalidates on every view and mutation** — price changes surfaced and the authoritative price used, stock shortfalls flagged (not silently capped), unlisted items removed. No price/stock value is trusted from the client.
- [ ] Switching to an area served by the **other store rebuilds the cart** against that store with a clear carried-over/dropped summary; same-store area change leaves the cart intact.
- [ ] `resolveServiceability` drives store binding; two same-pincode areas under different stores each resolve to their own store; out-of-zone shows the "we don't deliver here" page with optional capture.
- [ ] **Optional** customer accounts: email + argon2id password, DB session, a **principal fully separate from staff `User`** — a customer session gets no `/admin` or staff-action access and vice-versa. Browsing and carting never require login. A guest cart adopts `customerId` on sign-in/sign-up. Account area has profile + address book (one default, soft-delete); order history is a stub.
- [ ] **No `Order` / `OrderLine` / `websiteStock` / `StockLedger` write occurs anywhere in Phase 3** — asserted by tests. No checkout route exists; the cart's checkout control is visibly disabled.
- [ ] Boundary lint green; `(storefront)`, `cart`, `customers` reach other modules only via `index.ts`; no `app/**` → `repo.ts`.
- [ ] Migrations additive and re-runnable; seed idempotent (incl. the demo customer); `/api/health` green. Any new migration hand-checked for the GIN `migrate diff` drift.
- [ ] No secrets committed; deps pinned; `npm audit` clean of high/critical.
- [ ] OSCAR independent review sign-off; Michael merged to `main` and tagged `v0.3.0-storefront`.

## Boundaries — explicitly NOT in Phase 3

- **No checkout of any kind** — no `checkout.placeOrder`, no delivery-slot selection or capacity, no COD/UPI-on-delivery choice, no `Order`/`OrderLine` creation, no `ORDER_PLACED` ledger, no `websiteStock` decrement, no `order.placed` event. The `checkout` module stays a skeleton.
- **No order-status / tracking page** (`/order-status/[trackingToken]`) — needs orders; Phase 4.
- **No picking, POS billing, delivery, fulfillment, admin order queue** — Phase 4/5.
- **No phone OTP** (`customer_otp_login` stays OFF; `OtpChallenge` dormant). **No real SMS/email** — customer forgot-password/reset is deferred until an email vendor exists (documented gap); no notification is actually delivered.
- **No promotions / coupons / discounts, no product reviews or ratings, no wishlists/favourites, no recommendations or "related products" beyond same-category listing.**
- **No PostGIS / geo serviceability** — `geo` columns stay nullable; the locality-list resolver is unchanged.
- **No image upload / CDN pipeline** — product images remain URLs entered in Phase 2.
- **No SEO work beyond basic per-page `<title>`/meta and the SSR that already exists**; no sitemap, no structured data.
- **No rate limiting / anti-abuse hardening pass** (Phase 6) beyond writing enumeration-safe auth flows.
- **No production hosting or managed-Postgres vendor/budget decision** (Phase 7).
- **No changes to `resolveServiceability`, the RBAC rule table, the ledger invariant, or any Phase 2 admin screen.**

## OSCAR — independent review scope for Phase 3

Review each PR and the merged result independently (own checkout/worktree, own test
run, own hosted-CI + Playwright check on the exact candidate). Findings as written
notes to Michael — **no silent fixes**.

- **No side effects on inventory/orders** — exercise every storefront and cart path (add, update, remove, revalidate, area switch, account adoption) and prove **zero** writes to `Order`, `OrderLine`, `websiteStock`, `StockLedger`, `OrderStatusHistory`. This is the headline invariant of the phase.
- **Server-authoritative price/stock** — put a stale `unitPriceSnapshotPaise` in a cart, change the price and the listing and the stock via the Phase 2 admin services, then load the cart: the change must be surfaced and the **current** value used; an over-stock quantity must be flagged, never silently reduced; an unlisted item must be removed.
- **Cart / store-binding integrity** — a cart is bound to one `storeId`; adding another store's product is refused at the service layer even with a crafted request; the `cartToken` cookie is opaque + HttpOnly and one token cannot read or mutate another's cart; area switch to the other store rebuilds (not merges) and the carried/dropped set is correct; out-of-zone-after-switch behaves as documented.
- **Serviceability regression** — two same-pincode areas under different stores resolve to their own store; out-of-zone path captures a `ServiceabilityRequest` and shows no catalogue; the `resolveServiceability` interface is unchanged.
- **Customer principal isolation** — a customer session presented to `/admin/*` or any staff server action is refused; a staff session is not accepted as a customer on account pages; customer `authorize`/scoping is separate from the staff rule table; argon2id (not a fast hash) for customer passwords; sign-up/sign-in give no email-enumeration signal (response + timing); IDOR on `CustomerAddress` by id is refused; guest-cart adoption sets `customerId` and the multi-cart rule is followed.
- **SSR / client trust / injection** — catalogue and search pages render server-side; the search query is parameterised (no raw SQL interpolation), length-capped, and safe for `%`/`_`/quote characters; no secret or internal id leaks into HTML/JSON beyond what the page needs.
- **Boundaries & regressions** — boundary lint still rejects a crafted cross-module deep import; `(storefront)`/`cart`/`customers` use only `index.ts`; `app/**` can't import `repo.ts`; migrations additive and re-runnable; seed idempotent; `/api/health` green; **all Phase 1 + Phase 2 tests still pass**; the coverage gate still runs and bites.
- **Security** — no secrets in repo/history; deps pinned; `npm audit` clean of high/critical; cart/account cookies have correct flags; no new abandoned deps.

Deliver: a PASS / CHANGES-REQUESTED note per PR + a Phase-3 summary verdict, and an
explicit statement that hosted CI + the Playwright job are green on the exact merge
candidate.

## Acceptance gate (before Michael merges + tags `v0.3.0-storefront`)

1. JIM delivers `feat/p3-1..p3-8` (stacked; merging the tip brings all of Phase 3).
2. OSCAR independent review → PASS, with the **no-inventory/order-side-effects**
   invariant, the server-authoritative revalidation, and the customer-principal
   isolation all reproduced.
3. Green hosted CI + integration + Playwright on the exact candidate commit.
