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
/** Dev-only demo shopper. Never a real credential — see the README. */
const DEV_CUSTOMER_EMAIL = 'shopper@munderfresh.local';
const DEV_CUSTOMER_PHONE = '9800000001';
const DEV_CUSTOMER_PASSWORD = 'ShopperPass1';

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
  /**
   * Photos, served from `public/` rather than fetched.
   *
   * A seed that points at somebody else's CDN gives a demo database that looks
   * broken offline and an e2e suite whose image assertions depend on the
   * internet. These are checked-in SVGs with a real intrinsic size (1600×1200),
   * which is what makes "the layout keeps an oversized photo inside its column"
   * something a browser can actually be asked.
   */
  images?: readonly { url: string; alt: string }[];
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
  {
    sku: '8901234500219',
    name: 'Ragi Flour',
    slug: 'ragi-flour-1kg',
    packSize: '1 kg',
    category: 'staples',
    brand: 'Annapurna',
    mrpPaise: 9_500,
    aisleSortKey: 107,
    images: [{ url: '/seed/products/ragi-flour.svg', alt: 'A pack of ragi flour' }],
  },
  {
    sku: '8901234500226',
    name: 'Alphonso Mango',
    slug: 'alphonso-mango-1kg',
    packSize: '1 kg',
    category: 'fruits-vegetables',
    mrpPaise: 32_000,
    aisleSortKey: 205,
    images: [{ url: '/seed/products/alphonso-mango.svg', alt: 'Alphonso mangoes' }],
  },
  {
    sku: '8901234500233',
    name: 'Salted Butter',
    slug: 'salted-butter-500g',
    packSize: '500 g',
    category: 'dairy-bakery',
    brand: 'Nandini',
    mrpPaise: 26_500,
    aisleSortKey: 305,
    images: [{ url: '/seed/products/salted-butter.svg', alt: 'A block of salted butter' }],
  },
  {
    sku: '8901234500240',
    name: 'Masala Peanuts',
    slug: 'masala-peanuts-200g',
    packSize: '200 g',
    category: 'snacks-beverages',
    brand: 'Kurkure',
    mrpPaise: 6_000,
    aisleSortKey: 405,
    images: [{ url: '/seed/products/masala-peanuts.svg', alt: 'A packet of masala peanuts' }],
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
    await seedProductImages(row.id, product.images ?? []);
  }
  return ids;
}

/**
 * A product's photos, idempotently.
 *
 * `ProductImage` has no natural key — a product may legitimately have two photos
 * from the same source — so `upsert` is not available and re-running the seed
 * would otherwise mint a duplicate set every time. Matching on `(productId, url)`
 * makes the seed's own rows identifiable without inventing a constraint the
 * application does not need.
 */
async function seedProductImages(
  productId: string,
  images: readonly { url: string; alt: string }[],
): Promise<void> {
  if (images.length === 0) return;

  for (const [index, image] of images.entries()) {
    const existing = await prisma.productImage.findFirst({
      where: { productId, url: image.url },
      select: { id: true },
    });
    if (existing === null) {
      await prisma.productImage.create({
        data: { productId, url: image.url, alt: image.alt, sortKey: index },
      });
    } else {
      await prisma.productImage.update({
        where: { id: existing.id },
        data: { alt: image.alt, sortKey: index },
      });
    }
  }
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

/**
 * One demo shopper, so the storefront can be opened signed-in without anybody
 * having to sign up first (D8).
 *
 * Deliberately **one**: the storefront's whole point is that an account is
 * optional, and a seed full of customers would suggest otherwise. The default
 * address points at a real seeded area so the account area has something
 * truthful to show.
 *
 * Idempotent like the rest of the seed — re-running it leaves exactly this.
 */
async function seedCustomer(): Promise<void> {
  const passwordHash = await argon2.hash(DEV_CUSTOMER_PASSWORD, {
    type: argon2.argon2id,
    memoryCost: 19_456,
    timeCost: 2,
    parallelism: 1,
  });

  const customer = await prisma.customer.upsert({
    where: { email: DEV_CUSTOMER_EMAIL },
    update: { passwordHash, isBlocked: false },
    create: {
      email: DEV_CUSTOMER_EMAIL,
      name: 'Demo Shopper',
      phone: DEV_CUSTOMER_PHONE,
      passwordHash,
    },
  });

  // Their default address, in an area store 1 really serves.
  const area = await prisma.deliveryArea.findFirst({
    where: { name: 'Jayanagar 4th Block' },
    select: { id: true, pincode: true },
  });

  const existing = await prisma.customerAddress.findFirst({
    where: { customerId: customer.id, label: 'Home', isDeleted: false },
    select: { id: true },
  });
  if (existing !== null) return;

  await prisma.customerAddress.create({
    data: {
      customerId: customer.id,
      label: 'Home',
      line1: '221, 9th Main',
      line2: 'Jayanagar 4th Block',
      landmark: 'Opposite the park',
      areaId: area?.id ?? null,
      pincode: area?.pincode ?? null,
      isDefault: true,
    },
  });
}

/**
 * A couple of demo orders per store, so the admin queue and the tracking page
 * have something to render on a fresh database.
 *
 * **Idempotent by order number, not by count.** The number is derived from the
 * store code and an index rather than minted randomly, so a re-run finds the
 * same rows and does nothing. Seeding "two orders" by counting would double them
 * every time, which is exactly the bug an idempotence test is for.
 *
 * They decrement stock and write their `ORDER_PLACED` ledger rows, in the same
 * transaction as the order, exactly as `checkout.placeOrder` would.
 *
 * The first version deliberately did not, on the reasoning that the opening
 * balances already had their own ledger rows and a demo order need not disturb
 * them. That was wrong, and OSCAR found the consequence (R4): cancelling
 * `S1-DEMO-01` through the ordinary admin correction restored a quantity that
 * had never been deducted, so a demo database grew stock out of nothing. An
 * order that is not a faithful example is worse than no example — the whole
 * point of demo data is that every screen it feeds behaves as it will in
 * anger, and the correction screen is one of those screens.
 */
/**
 * A demo order that cannot be filled from the shelf.
 *
 * Thrown from *inside* the seeding transaction and handled outside it, so every
 * write that order had already made is rolled back before it is skipped. The
 * skip therefore happens outside the committing callback, which is the whole
 * point: nothing partial can commit.
 */
class DemoOrderUnfillable extends Error {
  constructor(readonly orderNumber: string) {
    super(`Demo order ${orderNumber} cannot be filled`);
    this.name = 'DemoOrderUnfillable';
  }
}

async function seedDemoOrders(storeIds: Map<string, string>): Promise<void> {
  const customer = await prisma.customer.findUnique({
    where: { email: DEV_CUSTOMER_EMAIL },
    select: { id: true, name: true, phone: true },
  });
  if (customer === null) return;

  // A fixed instant, so re-running the seed does not walk the slot forward and
  // produce a different-looking database each time.
  const slotStart = new Date('2026-12-01T10:30:00.000Z');
  const slotEnd = new Date('2026-12-01T11:30:00.000Z');

  for (const [code, storeId] of storeIds) {
    const listed = await prisma.storeProduct.findMany({
      where: { storeId, isListed: true },
      select: {
        productId: true,
        sellingPricePaise: true,
        product: { select: { name: true, packSize: true } },
      },
      orderBy: { productId: 'asc' },
      take: 2,
    });
    if (listed.length === 0) continue;

    for (const [index, status] of (['PLACED', 'ACCEPTED'] as const).entries()) {
      const orderNumber = `${code}-DEMO-${String(index + 1).padStart(2, '0')}`;
      const existing = await prisma.order.findUnique({
        where: { orderNumber },
        select: { id: true },
      });
      if (existing !== null) continue;

      const lines = listed.slice(0, index + 1);
      const subtotalPaise = lines.reduce(
        (sum, line) => sum + line.sellingPricePaise * (index + 1),
        0,
      );
      const settings = await prisma.storeSettings.findUnique({
        where: { storeId },
        select: { deliveryFeePaise: true },
      });
      const deliveryFeePaise = settings?.deliveryFeePaise ?? 0;

      await prisma
        .$transaction(async (tx) => {
          // **Plan every line before writing a single one.**
          //
          // This loop used to `return` when a line could not be filled — and a
          // `return` from a transaction callback *commits*. A demo order whose
          // second line was short therefore left the first line's decrement
          // committed with no order, no history and no ledger row: stock gone with
          // no movement to explain it, which is exactly what the sum-of-movements
          // invariant in `schema.test.ts` forbids. Repeating a partial seed drained
          // more each time, and row-count idempotence could not see any of it.
          //
          // So: resolve and check every line first, then write. A line that cannot
          // be filled throws, and the throw is what guarantees the rollback —
          // `return` never could.
          const planned: {
            itemId: string;
            productId: string;
            qty: number;
            balanceAfter: number;
          }[] = [];

          for (const line of lines) {
            const item = await tx.inventoryItem.findFirst({
              where: { storeId, productId: line.productId },
              select: { id: true, websiteStock: true },
            });
            if (item === null || item.websiteStock < index + 1) {
              throw new DemoOrderUnfillable(orderNumber);
            }
            planned.push({
              itemId: item.id,
              productId: line.productId,
              qty: index + 1,
              balanceAfter: item.websiteStock - (index + 1),
            });
          }

          const movements: { productId: string; qty: number; balanceAfter: number }[] = [];
          for (const step of planned) {
            await tx.inventoryItem.update({
              where: { id: step.itemId },
              data: { websiteStock: step.balanceAfter },
            });
            movements.push({
              productId: step.productId,
              qty: step.qty,
              balanceAfter: step.balanceAfter,
            });
          }

          const order = await tx.order.create({
            data: {
              orderNumber,
              trackingToken: `t_DEMO${code}${String(index + 1).padStart(2, '0')}`.padEnd(22, '0'),
              customerId: customer.id,
              storeId,
              contactNameSnapshot: customer.name ?? 'Demo Shopper',
              contactPhoneSnapshot: customer.phone,
              deliveryAddressSnapshotJson: {
                line1: '221, 9th Main',
                locality: 'Jayanagar 4th Block',
                pincode: '560041',
              },
              deliverySlotStart: slotStart,
              deliverySlotEnd: slotEnd,
              paymentMethod: index === 0 ? 'COD' : 'UPI_ON_DELIVERY',
              status,
              subtotalPaise,
              deliveryFeePaise,
              estimatedTotalPaise: subtotalPaise + deliveryFeePaise,
              ...(status === 'ACCEPTED' ? { acceptedAt: slotStart } : {}),
              lines: {
                create: lines.map((line) => ({
                  productId: line.productId,
                  nameSnapshot: line.product.name,
                  packSizeSnapshot: line.product.packSize,
                  unitPricePaise: line.sellingPricePaise,
                  qtyOrdered: index + 1,
                })),
              },
            },
            select: { id: true },
          });

          // One ledger row per line, with the resulting balance, in this same
          // transaction — the invariant §3 exists for, and the reason a later
          // cancellation gives back exactly what was taken.
          for (const movement of movements) {
            await tx.stockLedger.create({
              data: {
                storeId,
                productId: movement.productId,
                delta: -movement.qty,
                reason: 'ORDER_PLACED',
                refType: 'Order',
                refId: order.id,
                balanceAfter: movement.balanceAfter,
                actorType: 'SYSTEM',
                note: 'Seeded demo order (development seed)',
              },
            });
          }

          // Every status an order has ever held gets a history row, including the
          // one it was created at (§11) — the same shape `orders.createOrder`
          // writes, so the tracking page's timeline renders for these too.
          await tx.orderStatusHistory.create({
            data: { orderId: order.id, fromStatus: null, toStatus: 'PLACED', actorType: 'SYSTEM' },
          });
          if (status === 'ACCEPTED') {
            await tx.orderStatusHistory.create({
              data: {
                orderId: order.id,
                fromStatus: 'PLACED',
                toStatus: 'ACCEPTED',
                actorType: 'SYSTEM',
                note: 'Seeded demo order',
              },
            });
          }
        })
        .catch((error: unknown) => {
          // The one case we skip, and only *after* its transaction has rolled
          // back. Anything else is a real failure and is re-thrown: a seed that
          // swallows errors is a seed nobody can trust.
          if (!(error instanceof DemoOrderUnfillable)) throw error;
          console.warn(
            `Seed: skipped demo order ${error.orderNumber} — not enough stock to fill it.`,
          );
        });
    }
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
  await seedCustomer();
  await seedDemoOrders(storeIds);
  await seedFeatureFlags();

  const counts = {
    stores: await prisma.store.count(),
    products: await prisma.product.count(),
    productImages: await prisma.productImage.count(),
    storeProducts: await prisma.storeProduct.count(),
    inventoryItems: await prisma.inventoryItem.count(),
    deliveryAreas: await prisma.deliveryArea.count(),
    users: await prisma.user.count(),
    customers: await prisma.customer.count(),
    orders: await prisma.order.count(),
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
