/**
 * Deterministic development seed (Phase 1, Deliverable 3).
 *
 * Idempotent: every write is an upsert keyed on a natural key, so `npm run db:seed`
 * can be run repeatedly against the same database without error or duplication.
 *
 * Notable fixtures:
 * - two stores with independently editable settings (R7);
 * - a shared global product master with partly overlapping, differently priced
 *   per-store listings (R1/ADR-0003);
 * - two delivery areas under *different* stores that share one pincode, which is
 *   the case ADR-0004 exists for;
 * - one SUPER_ADMIN plus a STORE_MANAGER and a STORE_STAFF per store;
 * - `customer_otp_login` seeded OFF;
 * - an opening-balance `StockLedger` row for every `InventoryItem`, written in
 *   the same transaction as the item (§3/§7) and only on first creation.
 */
import { Prisma, PrismaClient } from '@prisma/client';
import argon2 from 'argon2';

const prisma = new PrismaClient();

/** Shared dev password. Never used outside a local/CI database. */
const DEV_PASSWORD = 'DevPassw0rd!';

const CATEGORIES = [
  { slug: 'staples', name: 'Staples', sortKey: 10 },
  { slug: 'fruits-vegetables', name: 'Fruits & Vegetables', sortKey: 20 },
  { slug: 'dairy-bakery', name: 'Dairy & Bakery', sortKey: 30 },
  { slug: 'snacks-beverages', name: 'Snacks & Beverages', sortKey: 40 },
  { slug: 'household', name: 'Household', sortKey: 50 },
] as const;

type CategorySlug = (typeof CATEGORIES)[number]['slug'];

interface ProductSeed {
  sku: string;
  name: string;
  slug: string;
  packSize: string;
  category: CategorySlug;
  brand?: string;
  mrpPaise: number;
  aisleSortKey: number;
}

const PRODUCTS: readonly ProductSeed[] = [
  {
    sku: '8901234500011',
    name: 'Sona Masoori Rice',
    slug: 'sona-masoori-rice-5kg',
    packSize: '5 kg',
    category: 'staples',
    brand: 'Annapurna',
    mrpPaise: 52_000,
    aisleSortKey: 101,
  },
  {
    sku: '8901234500028',
    name: 'Toor Dal',
    slug: 'toor-dal-1kg',
    packSize: '1 kg',
    category: 'staples',
    brand: 'Annapurna',
    mrpPaise: 18_500,
    aisleSortKey: 102,
  },
  {
    sku: '8901234500035',
    name: 'Whole Wheat Atta',
    slug: 'whole-wheat-atta-5kg',
    packSize: '5 kg',
    category: 'staples',
    brand: 'Chakki Fresh',
    mrpPaise: 32_000,
    aisleSortKey: 103,
  },
  {
    sku: '8901234500042',
    name: 'Sunflower Oil',
    slug: 'sunflower-oil-1l',
    packSize: '1 L',
    category: 'staples',
    brand: 'Gold Drop',
    mrpPaise: 16_500,
    aisleSortKey: 104,
  },
  {
    sku: '8901234500059',
    name: 'Iodised Salt',
    slug: 'iodised-salt-1kg',
    packSize: '1 kg',
    category: 'staples',
    brand: 'Sagar',
    mrpPaise: 2_800,
    aisleSortKey: 105,
  },
  {
    sku: '8901234500066',
    name: 'Sugar',
    slug: 'sugar-1kg',
    packSize: '1 kg',
    category: 'staples',
    mrpPaise: 5_400,
    aisleSortKey: 106,
  },
  {
    sku: '8901234500073',
    name: 'Banana Robusta',
    slug: 'banana-robusta-1kg',
    packSize: '1 kg',
    category: 'fruits-vegetables',
    mrpPaise: 6_000,
    aisleSortKey: 201,
  },
  {
    sku: '8901234500080',
    name: 'Tomato',
    slug: 'tomato-1kg',
    packSize: '1 kg',
    category: 'fruits-vegetables',
    mrpPaise: 4_500,
    aisleSortKey: 202,
  },
  {
    sku: '8901234500097',
    name: 'Onion',
    slug: 'onion-1kg',
    packSize: '1 kg',
    category: 'fruits-vegetables',
    mrpPaise: 4_000,
    aisleSortKey: 203,
  },
  {
    sku: '8901234500103',
    name: 'Potato',
    slug: 'potato-1kg',
    packSize: '1 kg',
    category: 'fruits-vegetables',
    mrpPaise: 3_800,
    aisleSortKey: 204,
  },
  {
    sku: '8901234500110',
    name: 'Toned Milk',
    slug: 'toned-milk-500ml',
    packSize: '500 ml',
    category: 'dairy-bakery',
    brand: 'Nandini',
    mrpPaise: 2_600,
    aisleSortKey: 301,
  },
  {
    sku: '8901234500127',
    name: 'Curd',
    slug: 'curd-400g',
    packSize: '400 g',
    category: 'dairy-bakery',
    brand: 'Nandini',
    mrpPaise: 4_000,
    aisleSortKey: 302,
  },
  {
    sku: '8901234500134',
    name: 'Paneer',
    slug: 'paneer-200g',
    packSize: '200 g',
    category: 'dairy-bakery',
    brand: 'Nandini',
    mrpPaise: 9_500,
    aisleSortKey: 303,
  },
  {
    sku: '8901234500141',
    name: 'Brown Bread',
    slug: 'brown-bread-400g',
    packSize: '400 g',
    category: 'dairy-bakery',
    brand: 'Daily Bake',
    mrpPaise: 5_000,
    aisleSortKey: 304,
  },
  {
    sku: '8901234500158',
    name: 'Potato Chips Classic',
    slug: 'potato-chips-classic-90g',
    packSize: '90 g',
    category: 'snacks-beverages',
    brand: 'Crispo',
    mrpPaise: 3_000,
    aisleSortKey: 401,
  },
  {
    sku: '8901234500165',
    name: 'Marie Biscuits',
    slug: 'marie-biscuits-250g',
    packSize: '250 g',
    category: 'snacks-beverages',
    brand: 'Sunfeast',
    mrpPaise: 4_500,
    aisleSortKey: 402,
  },
  {
    sku: '8901234500172',
    name: 'Filter Coffee Powder',
    slug: 'filter-coffee-powder-500g',
    packSize: '500 g',
    category: 'snacks-beverages',
    brand: 'Kumbakonam',
    mrpPaise: 31_000,
    aisleSortKey: 403,
  },
  {
    sku: '8901234500189',
    name: 'Green Tea Bags',
    slug: 'green-tea-bags-25s',
    packSize: '25 pc',
    category: 'snacks-beverages',
    brand: 'Leaf & Co',
    mrpPaise: 19_900,
    aisleSortKey: 404,
  },
  {
    sku: '8901234500196',
    name: 'Detergent Powder',
    slug: 'detergent-powder-1kg',
    packSize: '1 kg',
    category: 'household',
    brand: 'Shine',
    mrpPaise: 14_500,
    aisleSortKey: 501,
  },
  {
    sku: '8901234500202',
    name: 'Dishwash Liquid',
    slug: 'dishwash-liquid-750ml',
    packSize: '750 ml',
    category: 'household',
    brand: 'Shine',
    mrpPaise: 21_000,
    aisleSortKey: 502,
  },
] as const;

interface StoreSeed {
  code: string;
  name: string;
  address: Prisma.InputJsonValue;
  settings: { deliveryFeePaise: number; minOrderPaise: number; slotCapacity: number };
  /** Products this store does NOT list, so the two catalogues only partly overlap. */
  unlistedSkus: readonly string[];
  /** Discount applied to MRP for this store's selling price, in basis points. */
  discountBp: number;
  zones: readonly {
    name: string;
    areas: readonly { name: string; pincode: string | null }[];
  }[];
}

const STORES: readonly StoreSeed[] = [
  {
    code: 'S1',
    name: 'Munder Fresh — Jayanagar',
    address: {
      line1: '12, 4th Block',
      locality: 'Jayanagar',
      city: 'Bengaluru',
      state: 'Karnataka',
      pincode: '560011',
    },
    settings: { deliveryFeePaise: 3_000, minOrderPaise: 30_000, slotCapacity: 10 },
    unlistedSkus: ['8901234500189', '8901234500202'],
    discountBp: 500,
    zones: [
      {
        name: 'Jayanagar Core',
        areas: [
          { name: 'Jayanagar 4th Block', pincode: '560011' },
          { name: 'Jayanagar 7th Block', pincode: '560070' },
          // Shares pincode 560041 with an area under Store 2 — ADR-0004.
          { name: 'Tilak Nagar', pincode: '560041' },
        ],
      },
      {
        name: 'Jayanagar Fringe',
        areas: [
          { name: 'JP Nagar 2nd Phase', pincode: '560078' },
          { name: 'Sarakki', pincode: null },
        ],
      },
    ],
  },
  {
    code: 'S2',
    name: 'Munder Fresh — Indiranagar',
    address: {
      line1: '440, 100 Feet Road',
      locality: 'Indiranagar',
      city: 'Bengaluru',
      state: 'Karnataka',
      pincode: '560038',
    },
    settings: { deliveryFeePaise: 4_000, minOrderPaise: 25_000, slotCapacity: 14 },
    unlistedSkus: ['8901234500011', '8901234500134'],
    discountBp: 300,
    zones: [
      {
        name: 'Indiranagar Core',
        areas: [
          { name: 'Indiranagar 1st Stage', pincode: '560038' },
          { name: 'Domlur', pincode: '560071' },
          // Same pincode as Store 1's "Tilak Nagar": pincode is an attribute,
          // not the routing key (R8 / ADR-0004).
          { name: 'Wilson Garden Extension', pincode: '560041' },
        ],
      },
      {
        name: 'Indiranagar East',
        areas: [
          { name: 'CV Raman Nagar', pincode: '560093' },
          { name: 'Jeevan Bima Nagar', pincode: null },
        ],
      },
    ],
  },
];

/** Deterministic pseudo-stock so seeded quantities do not change between runs. */
/** Marks the ledger rows that explain where a seeded balance came from. */
const OPENING_BALANCE_REF = 'opening-balance';

/**
 * One SKU per store is seeded at or below the default low-stock threshold, so
 * the low-stock report and the `stock.low` path have something to show on a
 * fresh database instead of being demoable only after someone sells something.
 */
const LOW_STOCK_SKU = '8901234500042';

function stockFor(storeCode: string, sku: string): number {
  if (sku === LOW_STOCK_SKU) return storeCode === 'S1' ? 3 : 5;
  const digits = Number(sku.slice(-3));
  return storeCode === 'S1' ? 20 + (digits % 30) : 12 + (digits % 45);
}

function sellingPrice(mrpPaise: number, discountBp: number): number {
  return Math.round(mrpPaise * (1 - discountBp / 10_000));
}

async function seedCategories(): Promise<Map<CategorySlug, string>> {
  const ids = new Map<CategorySlug, string>();
  for (const category of CATEGORIES) {
    const row = await prisma.category.upsert({
      where: { slug: category.slug },
      update: { name: category.name, sortKey: category.sortKey, isActive: true },
      create: { slug: category.slug, name: category.name, sortKey: category.sortKey },
    });
    ids.set(category.slug, row.id);
  }
  return ids;
}

async function seedProducts(categoryIds: Map<CategorySlug, string>): Promise<Map<string, string>> {
  const ids = new Map<string, string>();
  for (const product of PRODUCTS) {
    const categoryId = categoryIds.get(product.category);
    if (categoryId === undefined) throw new Error(`Unknown category ${product.category}`);

    const data = {
      name: product.name,
      slug: product.slug,
      packSize: product.packSize,
      categoryId,
      aisleSortKey: product.aisleSortKey,
      isActive: true,
      ...(product.brand !== undefined ? { brand: product.brand } : {}),
    };
    const row = await prisma.product.upsert({
      where: { sku: product.sku },
      update: data,
      create: { sku: product.sku, ...data },
    });
    ids.set(product.sku, row.id);
  }
  return ids;
}

async function seedStore(store: StoreSeed, productIds: Map<string, string>): Promise<string> {
  const row = await prisma.store.upsert({
    where: { code: store.code },
    update: { name: store.name, addressJson: store.address, isActive: true },
    create: { code: store.code, name: store.name, addressJson: store.address },
  });

  await prisma.storeSettings.upsert({
    where: { storeId: row.id },
    update: store.settings,
    create: { storeId: row.id, ...store.settings },
  });

  for (const [zoneIndex, zone] of store.zones.entries()) {
    const zoneRow = await prisma.deliveryZone.upsert({
      where: { storeId_name: { storeId: row.id, name: zone.name } },
      update: { isActive: true, sortKey: zoneIndex },
      create: { storeId: row.id, name: zone.name, sortKey: zoneIndex },
    });

    for (const area of zone.areas) {
      await prisma.deliveryArea.upsert({
        where: { zoneId_name: { zoneId: zoneRow.id, name: area.name } },
        update: { pincode: area.pincode, isActive: true },
        create: { zoneId: zoneRow.id, name: area.name, pincode: area.pincode },
      });
    }
  }

  for (const product of PRODUCTS) {
    const productId = productIds.get(product.sku);
    if (productId === undefined) throw new Error(`Unknown product ${product.sku}`);
    const isListed = !store.unlistedSkus.includes(product.sku);
    const price = sellingPrice(product.mrpPaise, store.discountBp);

    await prisma.storeProduct.upsert({
      where: { storeId_productId: { storeId: row.id, productId } },
      update: { isListed, mrpPaise: product.mrpPaise, sellingPricePaise: price },
      create: {
        storeId: row.id,
        productId,
        isListed,
        mrpPaise: product.mrpPaise,
        sellingPricePaise: price,
        listedAt: isListed ? new Date('2026-01-01T00:00:00Z') : null,
      },
    });

    // Inventory exists for every product the store could stock, listed or not.
    // Architecture §3/§7: *every* stock mutation writes a StockLedger row in the
    // same transaction, opening balances included — otherwise the very first
    // number in the ledger has no explanation. `create` + `P2002` rather than
    // `upsert` because the ledger row must be written only on first creation:
    // re-running the seed must not mint a second opening balance.
    const openingStock = isListed ? stockFor(store.code, product.sku) : 0;

    await prisma
      .$transaction(async (tx) => {
        const item = await tx.inventoryItem.create({
          data: { storeId: row.id, productId, websiteStock: openingStock },
        });

        await tx.stockLedger.create({
          data: {
            storeId: item.storeId,
            productId: item.productId,
            delta: openingStock,
            reason: 'RECONCILE',
            refType: 'seed',
            refId: OPENING_BALANCE_REF,
            balanceAfter: openingStock,
            actorType: 'SYSTEM',
            note: 'Opening balance (development seed)',
          },
        });
      })
      .catch((error: unknown) => {
        // Already seeded: leave the existing balance and its ledger alone.
        if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') return;
        throw error;
      });
  }

  return row.id;
}

async function seedUsers(storeIds: Map<string, string>): Promise<void> {
  // Same parameters the identity service uses, so a seeded account behaves
  // exactly like one created through the admin screens (arch §20).
  const passwordHash = await argon2.hash(DEV_PASSWORD, {
    type: argon2.argon2id,
    memoryCost: 19_456,
    timeCost: 2,
    parallelism: 1,
  });

  const users: {
    email: string;
    name: string;
    role: 'SUPER_ADMIN' | 'STORE_MANAGER' | 'STORE_STAFF';
    storeCode: string | null;
  }[] = [
    { email: 'admin@munderfresh.local', name: 'Super Admin', role: 'SUPER_ADMIN', storeCode: null },
  ];
  for (const store of STORES) {
    users.push(
      {
        email: `manager.${store.code.toLowerCase()}@munderfresh.local`,
        name: `${store.name} Manager`,
        role: 'STORE_MANAGER',
        storeCode: store.code,
      },
      {
        email: `staff.${store.code.toLowerCase()}@munderfresh.local`,
        name: `${store.name} Staff`,
        role: 'STORE_STAFF',
        storeCode: store.code,
      },
    );
  }

  for (const user of users) {
    const storeId = user.storeCode === null ? null : (storeIds.get(user.storeCode) ?? null);
    await prisma.user.upsert({
      where: { email: user.email },
      // The hash is only set on create: re-seeding must not silently rotate an
      // existing password.
      update: { name: user.name, role: user.role, storeId, isActive: true },
      create: { email: user.email, name: user.name, role: user.role, storeId, passwordHash },
    });
  }
}

async function seedFeatureFlags(): Promise<void> {
  const flags = [
    {
      key: 'customer_otp_login',
      enabled: false,
      description: 'Phone + OTP customer login. Disabled for the pilot (R2).',
    },
    {
      key: 'customer_email_accounts',
      enabled: true,
      description: 'Optional email/password customer accounts.',
    },
    {
      key: 'delivery_proof_photo',
      enabled: false,
      description: 'Capture an optional delivery proof photo (R9).',
    },
  ];
  for (const flag of flags) {
    await prisma.featureFlag.upsert({
      where: { key: flag.key },
      update: { description: flag.description },
      // `enabled` is only set on create so a deliberate admin toggle survives a re-seed.
      create: flag,
    });
  }
}

async function main(): Promise<void> {
  const categoryIds = await seedCategories();
  const productIds = await seedProducts(categoryIds);

  const storeIds = new Map<string, string>();
  for (const store of STORES) {
    storeIds.set(store.code, await seedStore(store, productIds));
  }

  await seedUsers(storeIds);
  await seedFeatureFlags();

  const counts = {
    stores: await prisma.store.count(),
    products: await prisma.product.count(),
    storeProducts: await prisma.storeProduct.count(),
    inventoryItems: await prisma.inventoryItem.count(),
    deliveryAreas: await prisma.deliveryArea.count(),
    users: await prisma.user.count(),
    featureFlags: await prisma.featureFlag.count(),
  };
  console.log('Seed complete:', counts);
}

main()
  .catch((error: unknown) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => {
    void prisma.$disconnect();
  });
