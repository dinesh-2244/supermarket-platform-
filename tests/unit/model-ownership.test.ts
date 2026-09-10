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
        }));
      }),
    );
}

/**
 * Violations of the same class that predate this rule, listed rather than
 * excused away.
 *
 * Two of the original three are gone (`p3-followup-model-ownership`): the
 * low-stock threshold now comes from `stores.lowStockThresholdFor` and the CSV
 * import's SKU→id resolve from `catalog.findProductIdsBySku`.
 *
 * The one that remains is not an oversight — it is **blocked by §4 itself**.
 * `StoreProduct` belongs to `pricing`, and §4 permits `inventory` to depend on
 * `platform`, `catalog` and `stores` only. Routing the import's listing-scope
 * check through `pricing` would mean `inventory` depending on a module the
 * architecture does not allow it to, which is a decision for the architecture
 * and not for a follow-up card. The read itself is narrow and safe: it selects
 * `productId` filtered by `storeId`, applies no rule `pricing` would apply
 * differently, and sits behind a back-office import screen.
 *
 * The list is asserted to be *exactly* this, so it cannot quietly grow: a second
 * entry fails the suite.
 */
const KNOWN_EXCEPTIONS: readonly string[] = [
  'src/modules/inventory/repo.ts → storeProduct (owned by pricing)',
];

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
      .map((access) => `${access.file} → ${access.model} (owned by ${OWNER[access.model] ?? '?'})`);

    expect([...new Set(trespass)].sort()).toEqual([...KNOWN_EXCEPTIONS].sort());
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
