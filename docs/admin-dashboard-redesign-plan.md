# Admin dashboard redesign — UI/UX + information architecture (plan, not yet approved)

Status: **DRAFT — for human approval. No implementation until approved.**
Owner: PAM (UI/UX + frontend specialist), after her storefront workstream (`v0.5.0-storefront`) lands.
Backend integration (if any is genuinely needed): JIM, only on a scoped request routed through god.

## Objective

The back office (`src/app/(admin)/admin/*`) works — every screen in the table below ships and is
under a passing OSCAR review from Phases 1–4 — but it was built as a functional utility shell, not
designed. Nav is a flat list of text links; the "Overview" page is four stat tiles and a low-stock
table; there is no dedicated reporting/KPI surface; nothing has been checked at tablet width, which is
the realistic device for in-store staff. This plan redesigns the **presentation layer only**: layout,
navigation, information hierarchy, data density, and mobile/tablet usability for the two-store
back office. It changes nothing about what data exists, who can see or do what, or how any write path
behaves.

## What already exists — consume read-only, do not rebuild

Everything below is real, reviewed, shipped code as of `v0.4.1-prisma7` (`main @ 9c2e331`). The redesign
re-presents it; it does not re-derive it.

| Area | Current route(s) | Backing module | Notes |
|---|---|---|---|
| Shell + nav | `admin/layout.tsx` | `modules/admin` (`navigationFor`) | Role-gated flat link list, top bar only |
| Overview | `admin/page.tsx` | `modules/admin` (`overview()`) | 4 stat tiles, low-stock table, 2FA card, password-change card |
| Store switching | `ui.tsx` (`StoreSwitcher`) | `modules/admin` (`resolveStoreId`) | Already exists — a `?store=` query param + dropdown, server-resolved per role |
| Orders | `admin/orders/page.tsx`, `admin/orders/[orderId]/page.tsx` | `modules/orders` | Store-scoped queue + detail/timeline, audited `CANCELLED_BY_STORE` correction (Phase 4) |
| Inventory | `admin/inventory/page.tsx` + `/import/[importId]` | `modules/inventory` | Stock levels, CSV import job status |
| Listings & prices | `admin/listings/page.tsx` | `modules/pricing` / `modules/catalog` | Per-store listing + price editing |
| Products (master) | `admin/products/page.tsx` | `modules/catalog` | Shared product master, store-independent |
| Categories | `admin/categories/page.tsx` | `modules/catalog` | SUPER_ADMIN only |
| Delivery areas | `admin/zones/page.tsx` | `modules/stores` | `DeliveryZone`/`DeliveryArea` management |
| Stores & settings | `admin/stores/page.tsx` | `modules/stores` | Per-store config, slot capacity, etc. |
| Users | `admin/users/page.tsx` | `modules/identity` | SUPER_ADMIN/STORE_MANAGER, role-scoped |
| Audit log | `admin/audit/page.tsx` | `modules/platform` (audit) | Append-only, already exists |
| 2FA | `admin/two-factor/page.tsx` | `modules/identity` | TOTP enrollment (Phase 2) |
| RBAC | `auth` + `modules/identity` | — | `SUPER_ADMIN` / `STORE_MANAGER` / `STORE_STAFF`, server-enforced grant table, not UI-hidden |

No "Reports/KPIs" surface exists today beyond the 4 tiles on Overview. No fulfillment screens
(picking / POS handoff / packing / dispatch / delivery) exist — those are Phase 5 backend work, not yet
built; this plan reserves their information-architecture slot but does not design them blind.

## Deliverables

### AD1 — Dashboard home / overview redesign

Replace the 4-tile-plus-table layout with a real KPI-first home: today's orders by status, revenue/order
count trend (store-scoped), low-stock and out-of-stock counts as actionable cards (link straight to the
filtered inventory view), pending fulfillment counts once Phase 5 exists, and the 2FA/account cards
demoted to a settings area rather than sharing the main canvas. All numbers come from `overview()` and
existing per-module list/count functions — no new aggregation logic invented in the UI layer; if a KPI
needs a query that doesn't exist yet, it's a reported backend need, not something PAM computes client-side
from raw rows.

### AD2 — Navigation + information architecture

Replace the flat top-link nav with a structured sidebar (collapsible on tablet): grouped sections
(Overview · Orders · Catalog: Products/Categories/Listings & prices · Inventory · Delivery: Zones/Stores
· People: Users/Audit · Reports). Role-gating stays exactly as `navigationFor()` already computes it —
the redesign changes presentation of that same list, not its contents or the role logic that produces it.

### AD3 — Store 1 / Store 2 context

`StoreSwitcher` already exists and is the correct mechanism — a `STORE_MANAGER`/`STORE_STAFF` is
server-restricted to their own store regardless of UI. The redesign makes the active store an
always-visible, sticky part of the shell (not a page-level dropdown that resets on navigation), and
gives `SUPER_ADMIN` a clear "both stores" vs "Store 1" vs "Store 2" switch that persists across the
whole session, not just the current page's query param.

**Guardrail (human, 2026-09-11):** a `SUPER_ADMIN` "both stores" view is allowed **only** where an
existing, authorized backend read path already returns the combined-store result. PAM must not fetch
per-store data and sum/merge/aggregate it client-side to fabricate a cross-store view — that would be a
UI-layer computation standing in for a backend guarantee, exactly the kind of silent scope-widening this
plan's boundary exists to prevent. If a screen wants a combined view and no such read path exists today,
that is a backend requirement reported to god (routed to JIM), not something PAM works around in React.

### AD4 — Orders screens

Redesign the queue (status filters, search, at-a-glance SLA/age indicators) and the detail/timeline view
(the 12-state machine already renders as a timeline — improve its legibility, not its logic). The
audited `CANCELLED_BY_STORE` correction flow keeps its existing confirmation/audit-trail UX pattern;
this is a visual and layout pass on an already-correct flow.

### AD5 — Inventory

Redesign stock-level browsing (sortable/filterable table → responsive card list on tablet), the CSV
import flow (`admin/inventory/import/[importId]`) gets clearer progress/error states, and low-stock /
out-of-stock get first-class filtered views linked from AD1's KPI cards.

### AD6 — Catalog: Products, Categories, Listings & prices

Redesign the product master browser, the category tree (SUPER_ADMIN only), and the per-store
listing+price editor (MRP, selling price, discount, listed/unlisted toggle) for scannability — this is
the highest-friction daily-use screen for store staff and gets the most information-density attention.

### AD7 — Delivery areas & store settings

Redesign `zones` (DeliveryZone/DeliveryArea) and `stores` (per-store settings, slot capacity) as related
but distinct screens — currently two separate flat pages, unified under one "Delivery & store config"
section with clearer relationships between a store and its zones.

### AD8 — Users, RBAC presentation, audit log

Redesign user management (role assignment, store assignment) and the audit log (currently a raw table)
into a filterable, readable activity feed. Presentation only — the grant table and every authorization
check stay exactly as implemented; the UI never becomes the source of truth for what's allowed.

### AD9 — Reports / KPIs

A new surface, additive to what exists: order volume/status breakdown, top products, low-stock trend,
per-store comparison for `SUPER_ADMIN`. Built entirely from existing read paths (`modules/orders`,
`modules/inventory`, `modules/catalog` list/count functions) — if a report needs data no current query
provides, that's flagged to god as a backend need, not computed ad hoc in a React component.

**Guardrail (human, 2026-09-11):** every number on every report/KPI screen must trace to an existing,
authoritative read path. A missing aggregate (a sum, a trend, a cross-store rollup, anything a current
query doesn't already return) is a backend requirement PAM reports to god for JIM/Michael to scope and
build — never a frontend calculation over raw rows fetched for the purpose. This is the same rule as
AD3's "both stores" guardrail, generalized to the whole reports surface: PAM presents what the backend
already proves, she doesn't compute new truths in the UI layer.

### AD10 — Phase 5 fulfillment screens (reserved, not designed yet)

Picking, POS bill-entry handoff, packing, dispatch, delivery-record screens don't exist because Phase 5
hasn't been planned or built. This plan reserves their place in the redesigned information architecture
(a "Fulfillment" nav section) so AD1–AD9 don't have to be redone when Phase 5 ships, but does not design
screens against a backend that doesn't exist. Revisit once `docs/phase-5-plan.md` is authored.

### AD11 — Mobile/tablet usability for staff

Store staff use this day-to-day, often on a tablet at a counter. Every screen in AD1–AD9 must be usable
at tablet width (landscape and portrait) without horizontal scroll, with tap targets sized for a
finger not a cursor. Phone-width support is a should-have (a manager checking orders from home), not a
hard requirement the way it was for the customer storefront — this is staff software, not a consumer
funnel. Playwright E2E projects should cover at least one tablet viewport per redesigned screen, same
device-emulation pattern PAM already used for the storefront (`v0.5.0-storefront` PR #32).

## Hard boundary (reviewable invariant) — same class as the storefront redesign

Presentation layer only. Zero change to:

- `RBAC` / `authorize()` grant table semantics — what a role can see or do
- Store isolation — a `STORE_MANAGER`/`STORE_STAFF` server-side restriction to their own store
- Inventory invariants, `websiteStock`, `StockLedger` — read-only consumption, no new write paths
- Order state machine (`orders/state-machine.ts`) — the timeline UI renders it, never drives it
- POS boundaries — no admin screen reaches into POS-owned state
- Database behavior — no schema, migration, or query-shape change without a reported backend need routed
  through god to JIM

Any UI change that seems to require a new query, a new aggregate, or a data shape that doesn't exist
today is a backend need PAM reports to god first — same rule as the storefront redesign, no exception
for "it's just a report."

## Sequencing

1. This doc gets human approval before any implementation.
2. PAM builds after `v0.5.0-storefront` lands (not in parallel — one redesign workstream at a time keeps
   review load sane and avoids two agents in the same `src/app` tree).
3. AD1–AD9 are a stacked PR series, same pattern as the storefront redesign (PR #32): one branch,
   reviewable increments, OSCAR reviews for regressions/behaviour before each merges (or one review pass
   over the full series — god decides based on size once PAM scopes the PR breakdown).
4. AD10 (fulfillment) waits on `docs/phase-5-plan.md`.
5. Tag `v0.6.0-admin-dashboard` (or similar) on acceptance.

## OSCAR — independent review scope

Same invariant-verification pattern as the storefront review: confirm zero writes/reads bypass RBAC,
store isolation, inventory/`StockLedger`, order-state, or POS boundaries (whole-row snapshot technique
where useful); confirm every displayed number traces to an existing, unmodified query — no client-side
recomputation of something a backend query should own; confirm role-gated nav/screens still match
`navigationFor()`'s existing role logic exactly; confirm tablet-viewport E2E projects are real and green
in hosted CI, not filtered/skipped.

## Acceptance gate

Hosted CI + full Playwright (incl. tablet-viewport projects) green on the candidate head; OSCAR PASS on
the review scope above; Michael merges + tags. Same gate shape as `v0.4.1-prisma7` and
`v0.5.0-storefront`.
