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

> **Status: Phase 1 (foundation).** The skeleton, schema, kernel and test harness
> are in place. There are no storefront or admin features yet.

## Requirements

- Node.js 20.11+ (CI runs 22.20)
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

`GET /api/health` reports `{ status, db, migrations }` and is the quickest check
that the app and database agree.

### Prod-parity stack

```bash
docker compose -f docker/docker-compose.yml up --build
```

Brings up Postgres, a one-shot migration step, the app, and Caddy on
<http://localhost:8080>. Migrations run as a gated step _before_ the app starts —
the app never migrates on boot.

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
