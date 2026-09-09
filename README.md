# Supermarket Platform

Two-store hyperlocal supermarket platform: a customer storefront, a staff/admin
dashboard, and the inventory and order workflow behind them.

**Architecture:** [`docs/phase-0-architecture.md`](docs/phase-0-architecture.md)
(v2, approved) — read this first. Decisions are recorded in
[`docs/adr/README.md`](docs/adr/README.md).

**Shape:** a modular monolith. One Next.js 15 (App Router) application, one
PostgreSQL 16 database, one Docker image. Domain logic lives in `src/modules/*`
behind enforced boundaries; `app/` is thin — it parses input, calls a module
service, and renders.

> **Status: Phase 3 (storefront + cart).** The customer-facing shop is live at
> `/`: pick a delivery area, browse and search that store's listed products at
> that store's prices, open product pages, and fill a basket — **with no
> login**. Optional email/password accounts add a profile and an address book.
>
> **There is still no checkout.** Nothing in Phase 3 writes an `Order`, an
> `OrderLine`, `websiteStock` or a `StockLedger` row; the basket's "Proceed to
> checkout" control is visibly disabled. Ordering, delivery slots, payment
> choice and the order lifecycle are Phase 4.

## Requirements

- Node.js `^22.13.0 || ^24.0.0 || >=26.0.0` — the intersection of every
  installed dependency's own `engines.node`. `.nvmrc`, CI and the Docker image
  all pin **22.20.0**; that is the version the suite is actually run on.
- Docker + Docker Compose (for the local database, and for prod-parity runs)

## Getting started

```bash
npm install
cp .env.example .env                 # fill in AUTH_SECRET at minimum

docker compose -f docker/docker-compose.yml up -d postgres
npx prisma migrate deploy
npm run db:seed

npm run dev                          # http://localhost:3000
```

`.env` is the **host** profile: its `DATABASE_URL` points at `127.0.0.1:5432`,
the port Compose publishes, and its `AUTH_URL` at the `next dev` origin. The
prod-parity stack below deliberately does _not_ read those two — inside a
container `localhost` is that container. See
[`docker/docker-compose.yml`](docker/docker-compose.yml) for the container
profile.

`GET /api/health` reports `{ status, db, migrations }` and is the quickest check
that the app and database agree.

### Signing in to the back office

The seed creates staff accounts. **Development only — never use these anywhere
real.** There is no public signup; a `SUPER_ADMIN` creates every account.

| Email                          | Role            | Store |
| ------------------------------ | --------------- | ----- |
| `admin@munderfresh.local`      | `SUPER_ADMIN`   | —     |
| `manager.s1@munderfresh.local` | `STORE_MANAGER` | S1    |
| `manager.s2@munderfresh.local` | `STORE_MANAGER` | S2    |
| `staff.s1@munderfresh.local`   | `STORE_STAFF`   | S1    |
| `staff.s2@munderfresh.local`   | `STORE_STAFF`   | S2    |

All seeded with the password `DevPassw0rd!`. Sign in at
<http://localhost:3000/admin/sign-in>.

A `STORE_MANAGER` sees only their own store, and is refused another store's
settings, zones, prices and stock **server-side** — not merely not shown them. A
`STORE_STAFF` is read-only this phase.

### The storefront

Open <http://localhost:3000/>. A visitor with no delivery area is sent to the
**locality picker** first — there is no default store, because every price and
every availability figure on the site belongs to one specific shop.

| Route            | What it is                                                      |
| ---------------- | --------------------------------------------------------------- |
| `/locality`      | Choose a delivery area; binds the store that serves it          |
| `/`              | That store's home — aisles and products                         |
| `/c/[slug]`      | Category browse, including everything in the subtree            |
| `/p/[slug]`      | Product detail. The slug is global; the store decides the terms |
| `/search?q=`     | Trigram search, scoped to the store's listed products           |
| `/cart`          | The basket, revalidated on every view                           |
| `/account/*`     | Optional customer account — profile, addresses, order stub      |
| `/unserviceable` | "We do not deliver here yet", with demand capture               |

**Cookies.** `storeContext` holds only the `areaId` the visitor picked; the
store, delivery fee and minimum order are re-derived from
`stores.resolveServiceability` on every request, so an edited cookie can only
ever name a _different area_. `cartToken` is an opaque basket id, `HttpOnly` and
`SameSite=Lax`. `customerSession` is the shopper's session — a **different**
cookie from the staff one, naming a row in a different table (ADR-0010).

**The basket revalidates on every view and every mutation.** A price that moved
is surfaced and the current price used; a quantity above what is in stock is
flagged and never silently capped; a product the store has delisted is removed
with a notice. Changing to an area served by the _other_ store rebuilds the
basket against it — carried lines are re-priced, the rest are dropped and named.

### Signing in as a customer

The seed creates **one** demo shopper. Development only.

| Email                       | Password       |
| --------------------------- | -------------- |
| `shopper@munderfresh.local` | `ShopperPass1` |

An account is never required: browsing, searching and building a basket all work
signed out, and a guest basket is adopted on sign-in. **Password reset is not
built** — it needs an email vendor that is not wired, the same posture as
phone-OTP (`FeatureFlag.customer_otp_login` stays OFF). The sign-in page says so
rather than offering a link that goes nowhere.

### Stock import format

`/admin/inventory` takes a **CSV** (export from Excel as CSV — binary `.xlsx` is
rejected with a message saying so). A header row naming at least `sku` and
`quantity`, optionally `mode`:

```csv
sku,quantity,mode
8901234500011,42,set
8901234500028,-3,delta
```

- `set` writes an absolute quantity and is idempotent; `delta` adds a signed one
  and is **not** — re-running a delta file applies it again.
- `mode` may be omitted, in which case the mode chosen on the form applies.
- Common header spellings (`barcode`, `qty`, `stock`, `count`) are accepted, as
  are semicolon and tab separators, quoted fields, a UTF-8 BOM and CRLF endings.
- **Every row is validated before any is applied.** One bad row rejects the whole
  file with a per-row report and writes nothing — there is no partial import.
- Tick **Dry run** to see the diff without writing.

### Prod-parity stack

```bash
docker compose -f docker/docker-compose.yml up --build
curl -i http://localhost:8080/api/health
```

Brings up Postgres, a one-shot migration step, the app, and Caddy on
<http://localhost:8080>. Migrations run as a gated step _before_ the app starts —
the app never migrates on boot, and `app` will not start unless `migrate` exits 0.

The stack reads only `AUTH_SECRET`, `POSTGRES_*`, `LOG_LEVEL`, `PUBLIC_URL`,
`CADDY_*` and `DOMAIN` from `.env`. It builds the container database URL itself
(`postgres:5432`, from `POSTGRES_USER`/`POSTGRES_PASSWORD`/`POSTGRES_DB`) and
sets the app's public origin to Caddy's port. To check what a given `.env` will
actually produce:

```bash
docker compose --env-file .env -f docker/docker-compose.yml config
```

`migrate` is its own image target with the full locked dependency tree — the
Prisma CLI needs far more than `node_modules/prisma`, and a partial copy fails at
run time with `Cannot find module 'effect'` rather than at build time.

## Scripts

| Script                            | What it does                                    |
| --------------------------------- | ----------------------------------------------- |
| `npm run dev`                     | Next.js dev server                              |
| `npm run build` / `npm start`     | Production build / serve                        |
| `npm run typecheck`               | `tsc --noEmit`                                  |
| `npm run lint`                    | ESLint, including the module-boundary rules     |
| `npm run format` / `format:write` | Prettier check / write                          |
| `npm test`                        | Vitest unit tests                               |
| `npm run test:coverage`           | Unit tests + the `src/modules/**` coverage gate |
| `npm run test:integration`        | Vitest against a real PostgreSQL                |
| `npm run test:e2e`                | Playwright                                      |
| `npm run db:migrate`              | `prisma migrate dev` (create a migration)       |
| `npm run db:migrate:deploy`       | `prisma migrate deploy` (apply, for CI/deploy)  |
| `npm run db:seed`                 | Idempotent development seed                     |
| `npm run db:manifest`             | Regenerate the expected-migrations manifest     |
| `npm run db:reset`                | Drop, re-migrate and re-seed the dev database   |

## Layout

```
prisma/          schema.prisma, migrations/, seed.ts
src/app/         routing and rendering only — no business logic
src/modules/     the modular-monolith core
  platform/      shared kernel: config, logger, db, errors, event-bus,
                 money, ids, authz, observability
  stores/ catalog/ pricing/ inventory/ identity/ customers/
  cart/ checkout/ orders/ fulfillment/ notifications/ admin/
src/storefront.ts  storefront cookies + the customer principal (cf. src/auth.ts)
src/components/  ui/, storefront/, admin/
src/lib/         framework glue only — never domain logic
tests/           e2e/, integration/, factories/
docker/          Dockerfile, docker-compose.yml, Caddyfile
docs/            architecture + ADRs
```

### Module conventions

Every module is `domain/` + `service.ts` + `repo.ts` + `index.ts` + `__tests__/`.

- **`index.ts` is the only public surface.** Nothing outside a module may import
  its `service.ts`, `repo.ts` or `domain/`.
- **`repo.ts` is Prisma/SQL access** and is module-private. Only
  `platform/db` may import `@prisma/client`.
- **`domain/` is pure logic** — no I/O, no framework types.
- **`src/lib` may not import `src/modules`.**

These are enforced by `import/no-restricted-paths` in `eslint.config.mjs`, and
`tests/unit/module-boundaries.test.ts` proves the rules actually reject a
violation.

## Conventions that matter

- **Money is integer paise**, always. Use `platform/money`; floats are banned for
  currency.
- **Stock and status changes are transactional.** Any write to
  `InventoryItem.websiteStock` writes its `StockLedger` row in the same
  transaction (`withTransaction` + `selectForUpdate` from `platform/db`); any
  `Order.status` change writes its `OrderStatusHistory` row the same way.
- **Config fails closed.** `platform/config` validates the environment with Zod
  at first use; a missing or invalid variable stops the app rather than
  defaulting.
- **Zod at every trust boundary**; typed `AppError`s mapped to HTTP only at the
  edge.
- **Conventional Commits**, short-lived branches, squash-merge into a protected
  `main`.

## Testing

| Layer       | Command                    | Needs                           |
| ----------- | -------------------------- | ------------------------------- |
| Unit        | `npm test`                 | nothing                         |
| Integration | `npm run test:integration` | a running PostgreSQL            |
| E2E         | `npm run test:e2e`         | a production build + PostgreSQL |

CI runs typecheck → lint → format → unit + coverage → `npm audit` → build on
every PR, plus an integration job against a `postgres:16` service container.
Playwright runs on `main`.

## Security baseline

No card data is ever handled (COD / UPI-on-delivery only). Secrets come from the
environment; `.env` is git-ignored and `.env.example` documents every key. The
Docker image runs as a non-root user and pins its base image by digest. See
architecture §20.
