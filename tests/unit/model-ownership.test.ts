import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * R7 — the boundary violation `import/no-restricted-paths` cannot see.
 *
 * The path lint reads *imports*, and a module reaching into another module's
 * data does not need one: `customers/repo.ts` called
 * `executor(db).deliveryArea.findFirst`, and DeliveryArea belongs to `stores`
 * (§4). The import graph was clean, the lint was green, and the query went
 * straight past the stores public interface — along with the routing rules that
 * interface applies, so an address in a retired zone was accepted.
 *
 * A Prisma delegate name is the model name, so the violation is visible in the
 * source. This walks every module and asserts that each Prisma delegate call
 * names a model that module owns. `platform` owns none of them and is exempt
 * because it *is* the database layer.
 */
const MODULES_DIR = join(process.cwd(), 'src', 'modules');

/**
 * §4's ownership table, as the schema spells the models.
 *
 * A model missing from here is a failure rather than a pass: a new table with no
 * owner is exactly the moment to decide whose it is.
 */
const OWNER: Readonly<Record<string, string>> = {
  store: 'stores',
  storeSettings: 'stores',
  deliveryZone: 'stores',
  deliveryArea: 'stores',
  serviceabilityRequest: 'stores',

  category: 'catalog',
  product: 'catalog',
  productImage: 'catalog',

  storeProduct: 'pricing',
  priceChange: 'pricing',

  inventoryItem: 'inventory',
  stockLedger: 'inventory',
  inventoryImport: 'inventory',
  posSkuMap: 'inventory',

  user: 'identity',
  session: 'identity',
  account: 'identity',
  verificationToken: 'identity',

  customer: 'customers',
  customerSession: 'customers',
  customerAddress: 'customers',
  otpChallenge: 'customers',

  cart: 'cart',
  cartItem: 'cart',

  order: 'orders',
  orderLine: 'orders',
  orderStatusHistory: 'orders',

  pickTask: 'fulfillment',
  posBillingHandoff: 'fulfillment',
  deliveryRecord: 'fulfillment',

  productRequest: 'product-requests',
  productRequestStatusHistory: 'product-requests',

  auditLog: 'platform',
  featureFlag: 'platform',
};

/**
 * A Prisma delegate call, and only that.
 *
 * The receiver has to be named so a *relation* in a `select`/`include` — which
 * is the module's own query asking for a joined row, not a query against another
 * module's table — does not read as a violation.
 */
const DELEGATE_CALL =
  /\b(?:executor\([^)]*\)|\w*[Ee]xecutor\(tx\)|getPrisma\(\)|prisma|tx|db)\.([a-z]\w*)\.(?:findMany|findFirst|findUnique|findUniqueOrThrow|findFirstOrThrow|create|createMany|update|updateMany|upsert|delete|deleteMany|count|aggregate|groupBy)\b/g;

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) {
      return entry === '__tests__' ? [] : sourceFiles(path);
    }
    return path.endsWith('.ts') && !path.endsWith('.test.ts') ? [path] : [];
  });
}

interface Access {
  readonly module: string;
  readonly file: string;
  readonly model: string;
  /** The call's argument list, so a *column-level* rule can be expressed. */
  readonly args: string;
}

/** The balanced `( … )` that follows a delegate call, however many lines it spans. */
function argumentsAt(source: string, from: number): string {
  let depth = 0;
  for (let i = from; i < source.length; i += 1) {
    if (source[i] === '(') depth += 1;
    else if (source[i] === ')') {
      depth -= 1;
      if (depth === 0) return source.slice(from, i + 1);
    }
  }
  return source.slice(from);
}

function everyModelAccess(): readonly Access[] {
  return readdirSync(MODULES_DIR)
    .filter((module) => statSync(join(MODULES_DIR, module)).isDirectory())
    .flatMap((module) =>
      sourceFiles(join(MODULES_DIR, module)).flatMap((file) => {
        const source = readFileSync(file, 'utf8');
        return [...source.matchAll(DELEGATE_CALL)].map((match) => ({
          module,
          file: file.slice(process.cwd().length + 1),
          model: match[1] ?? '',
          args: argumentsAt(source, (match.index ?? 0) + match[0].length),
        }));
      }),
    );
}

/**
 * `StoreProduct` has two owners, by column.
 *
 * §4 scopes `pricing` to "StoreProduct **price fields**, PriceChange" — not the
 * whole table. Which products a store carries, and whether it lists them, is a
 * per-store cataloguing concern and belongs to `catalog`. That reading is now a
 * decision rather than an observation, and this is where it is expressed.
 *
 * So `catalog` may query `storeProduct`, but only for the cataloguing columns
 * below. A `catalog` query that reached for `sellingPricePaise` would fail here,
 * which is the point: a per-table allow-list would have let it through.
 *
 * This replaces the last `KNOWN_EXCEPTIONS` entry. The list is gone: an
 * exception that has become a rule should not keep being called an exception.
 */
const CATALOGUING_COLUMNS: readonly string[] = [
  'id',
  'storeId',
  'productId',
  'isListed',
  'listedAt',
  'delistedAt',
];

const SPLIT_OWNERSHIP: Readonly<Record<string, Readonly<Record<string, readonly string[]>>>> = {
  storeProduct: { catalog: CATALOGUING_COLUMNS },
};

/** The object keys a call names, which is near enough "the columns it touches". */
function columnsTouched(args: string): readonly string[] {
  return [...args.matchAll(/(?:^|[{,\s])([a-zA-Z_]\w*)\s*:/g)].map((match) => match[1] ?? '');
}

/**
 * Is this cross-module access covered by a column-level carve-out?
 *
 * Only when *every* column it names is one the carve-out grants. Prisma
 * operators (`in`, `not`, `select`, …) are not columns and are ignored.
 */
function withinSplitOwnership(access: Access): boolean {
  const granted = SPLIT_OWNERSHIP[access.model]?.[access.module];
  if (granted === undefined) return false;

  const operators = new Set(['where', 'select', 'data', 'orderBy', 'in', 'not', 'take', 'include']);
  return columnsTouched(access.args)
    .filter((column) => !operators.has(column))
    .every((column) => granted.includes(column));
}

describe('§4 — a module queries only the models it owns', () => {
  it('finds the Prisma calls it is supposed to be checking', () => {
    // A regex that silently matched nothing would make every case below pass.
    const accesses = everyModelAccess();
    expect(accesses.length).toBeGreaterThan(50);
    expect(accesses.map((access) => access.model)).toContain('cart');
  });

  it('knows who owns every model it finds', () => {
    const unowned = [
      ...new Set(
        everyModelAccess()
          .filter((a) => !(a.model in OWNER))
          .map((a) => a.model),
      ),
    ];
    expect(unowned, 'models with no owner in §4 — decide whose they are').toEqual([]);
  });

  it('never reaches another module’s table', () => {
    const trespass = everyModelAccess()
      // `platform` is the database layer itself; the audit trail and feature
      // flags are its own, and every module writes them through its helpers.
      .filter((access) => access.module !== 'platform')
      .filter((access) => {
        const owner = OWNER[access.model];
        return owner !== undefined && owner !== access.module && owner !== 'platform';
      })
      // A column-level carve-out is a rule, not an exception — see SPLIT_OWNERSHIP.
      .filter((access) => !withinSplitOwnership(access))
      .map((access) => `${access.file} → ${access.model} (owned by ${OWNER[access.model] ?? '?'})`);

    expect([...new Set(trespass)].sort()).toEqual([]);
  });

  it('lets catalog read StoreProduct’s cataloguing columns, and only those', () => {
    // The split is a rule, so it is asserted from both sides.
    const catalogReads = everyModelAccess().filter(
      (access) => access.module === 'catalog' && access.model === 'storeProduct',
    );
    expect(catalogReads.length).toBeGreaterThan(0);
    for (const access of catalogReads) {
      expect(
        withinSplitOwnership(access),
        `${access.file} reaches beyond the cataloguing columns`,
      ).toBe(true);
    }
  });

  it('would refuse a catalog query that reached for a price column', () => {
    // The carve-out has to bite, or it is just a per-table allow-list wearing a
    // column-level costume.
    const priceQuery: Access = {
      module: 'catalog',
      file: 'src/modules/catalog/repo.ts',
      model: 'storeProduct',
      args: '({ where: { storeId }, select: { productId: true, sellingPricePaise: true } })',
    };
    expect(withinSplitOwnership(priceQuery)).toBe(false);

    const cataloguingQuery: Access = { ...priceQuery, args: '({ select: { productId: true } })' };
    expect(withinSplitOwnership(cataloguingQuery)).toBe(true);
  });

  it('no longer lets customers read a delivery area for itself (R7)', () => {
    // Named separately from the list above because this is the one the review
    // found, and it is the one that must stay fixed: the customers module now
    // asks `stores` whether an area is deliverable, which applies the zone and
    // store rules its own `isActive` check silently skipped.
    const reachingStores = everyModelAccess().filter(
      (access) => access.module === 'customers' && OWNER[access.model] === 'stores',
    );
    expect(reachingStores).toEqual([]);
  });
});
