import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { getPrisma, type Principal } from '@/modules/platform';
import {
  addProductImage,
  createCategory,
  createProduct,
  deactivateProduct,
  listProductImages,
  listProducts,
  removeProductImage,
  reorderProductImages,
  searchIsAvailable,
  searchProducts,
  updateCategory,
  updateProduct,
} from '@/modules/catalog';
import { createStore, createStoreProduct } from '../factories/index';

/**
 * P2-3 — the shared global master (R1 / ADR-0003) and the trigram search.
 *
 * The unit suite proves slugs, SKUs and cycle detection; this proves the
 * database enforces uniqueness itself, that a product listed by both stores is
 * genuinely one row, and that `pg_trgm` is really installed and really used.
 */
const prisma = getPrisma();

const admin: Principal = { kind: 'user', userId: 'cat-admin', role: 'SUPER_ADMIN', storeId: null };
let managerA: Principal;
let storeA: string;
let storeB: string;
let categoryId: string;
const suffix = `${Date.now() % 1000000}`;
const productIds: string[] = [];

beforeAll(async () => {
  const a = await createStore(prisma, { code: `CTA-${suffix.slice(-5)}` });
  const b = await createStore(prisma, { code: `CTB-${suffix.slice(-5)}` });
  storeA = a.id;
  storeB = b.id;
  managerA = { kind: 'user', userId: 'cat-mgr', role: 'STORE_MANAGER', storeId: storeA };

  categoryId = (await createCategory(admin, { name: `Staples ${suffix}` })).id;
});

afterAll(async () => {
  await prisma.auditLog.deleteMany({ where: { actorId: { in: ['cat-admin', 'cat-mgr'] } } });
  await prisma.storeProduct.deleteMany({ where: { productId: { in: productIds } } });
  await prisma.productImage.deleteMany({ where: { productId: { in: productIds } } });
  await prisma.product.deleteMany({ where: { id: { in: productIds } } });
  await prisma.category.deleteMany({ where: { name: { contains: suffix } } });
  await prisma.store.deleteMany({ where: { id: { in: [storeA, storeB] } } });
  await prisma.$disconnect();
});

async function makeProduct(name: string, brand?: string) {
  const product = await createProduct(admin, {
    sku: `SKU-${suffix}-${productIds.length}`,
    name,
    packSize: '1 kg',
    categoryId,
    ...(brand !== undefined ? { brand } : {}),
  });
  productIds.push(product.id);
  return product;
}

describe('catalog — one shared master row per product (R1 / ADR-0003)', () => {
  it('is listed by both stores without being duplicated', async () => {
    const product = await makeProduct(`Basmati Rice ${suffix}`, 'Daawat');

    await createStoreProduct(prisma, storeA, product.id, { sellingPricePaise: 12_000 });
    await createStoreProduct(prisma, storeB, product.id, { sellingPricePaise: 13_500 });

    const listings = await prisma.storeProduct.findMany({ where: { productId: product.id } });
    expect(listings).toHaveLength(2);
    expect(new Set(listings.map((l) => l.storeId))).toEqual(new Set([storeA, storeB]));
    // Two listings, two prices — but exactly one Product row behind them.
    expect(new Set(listings.map((l) => l.productId))).toEqual(new Set([product.id]));
    expect(await prisma.product.count({ where: { sku: product.sku } })).toBe(1);
  });

  // Enforced by the database, not merely by the service.
  it('refuses a duplicate SKU and a duplicate slug at the database level', async () => {
    const product = await makeProduct(`Toor Dal ${suffix}`);

    await expect(
      prisma.product.create({
        data: {
          sku: product.sku,
          name: 'Impostor',
          slug: `impostor-${suffix}`,
          packSize: '1 kg',
          categoryId,
        },
      }),
    ).rejects.toThrow(/unique/i);

    await expect(
      prisma.product.create({
        data: {
          sku: `OTHER-${suffix}`,
          name: 'Impostor',
          slug: product.slug,
          packSize: '1 kg',
          categoryId,
        },
      }),
    ).rejects.toThrow(/unique/i);

    // …and through the service it is a conflict, not a crash.
    await expect(
      createProduct(admin, {
        sku: product.sku,
        name: 'Impostor',
        packSize: '1 kg',
        categoryId,
      }),
    ).rejects.toThrow(/already exists/i);
  });

  it('treats a lower-case SKU as the same identity', async () => {
    const product = await makeProduct(`Sugar ${suffix}`);
    await expect(
      createProduct(admin, {
        sku: product.sku.toLowerCase(),
        name: 'Impostor',
        packSize: '1 kg',
        categoryId,
      }),
    ).rejects.toThrow(/already exists/i);
  });
});

describe('catalog — the master is global, so only a SUPER_ADMIN may write it', () => {
  it('lets a store manager read but never write', async () => {
    await expect(listProducts(managerA)).resolves.toBeInstanceOf(Array);

    await expect(
      createProduct(managerA, {
        sku: `MGR-${suffix}`,
        name: 'Manager Product',
        packSize: '1 kg',
        categoryId,
      }),
    ).rejects.toThrow(/permission/i);

    const product = await makeProduct(`Ghee ${suffix}`);
    await expect(updateProduct(managerA, product.id, { name: 'Renamed' })).rejects.toThrow(
      /permission/i,
    );
    await expect(createCategory(managerA, { name: 'Sneaky' })).rejects.toThrow(/permission/i);
    await expect(
      addProductImage(managerA, product.id, { url: 'https://cdn.example/a.jpg' }),
    ).rejects.toThrow(/permission/i);
  });
});

describe('catalog — category tree', () => {
  it('refuses a parent change that would close a loop', async () => {
    const parent = await createCategory(admin, { name: `Parent ${suffix}` });
    const child = await createCategory(admin, {
      name: `Child ${suffix}`,
      parentId: parent.id,
    });

    await expect(updateCategory(admin, parent.id, { parentId: child.id })).rejects.toThrow(
      /below this category/i,
    );
    // The legal direction still works.
    await expect(updateCategory(admin, child.id, { parentId: null })).resolves.toMatchObject({
      parentId: null,
    });
  });

  it('rejects a duplicate slug', async () => {
    await createCategory(admin, { name: `Unique ${suffix}`, slug: `unique-${suffix}` });
    await expect(
      createCategory(admin, { name: 'Other', slug: `unique-${suffix}` }),
    ).rejects.toThrow(/already exists/i);
  });
});

describe('catalog — search', () => {
  it('has the pg_trgm extension the migration installs', async () => {
    await expect(searchIsAvailable()).resolves.toBe(true);
  });

  it('finds a product by an exact substring', async () => {
    await makeProduct(`Aashirvaad Atta ${suffix}`, 'Aashirvaad');
    const hits = await searchProducts(admin, `Atta ${suffix}`);
    expect(hits.map((h) => h.name)).toContain(`Aashirvaad Atta ${suffix}`);
  });

  it('finds a product by brand', async () => {
    await makeProduct(`Chakki Fresh ${suffix}`, `Pillsbury${suffix}`);
    const hits = await searchProducts(admin, `Pillsbury${suffix}`);
    expect(hits.map((h) => h.name)).toContain(`Chakki Fresh ${suffix}`);
  });

  // The reason pg_trgm is here at all: a typo still finds the product.
  it('tolerates a misspelling via trigram similarity', async () => {
    await makeProduct('Kaapi Filter Coffee Powder');
    const hits = await searchProducts(admin, 'Kappi Filter Coffe');
    expect(hits.some((h) => h.name === 'Kaapi Filter Coffee Powder')).toBe(true);
  });

  it('ranks a closer match higher', async () => {
    await makeProduct(`Zeta Exactmatch ${suffix}`);
    await makeProduct(`Zeta Something Else Entirely ${suffix}`);

    const hits = await searchProducts(admin, `Zeta Exactmatch ${suffix}`);
    expect(hits[0]?.name).toBe(`Zeta Exactmatch ${suffix}`);
    expect(hits[0]?.score).toBeGreaterThan(0);
  });

  it('hides deactivated products unless asked', async () => {
    const product = await makeProduct(`Discontinued ${suffix}`);
    await deactivateProduct(admin, product.id);

    expect((await searchProducts(admin, `Discontinued ${suffix}`)).length).toBe(0);
    expect(
      (await searchProducts(admin, `Discontinued ${suffix}`, { includeInactive: true })).length,
    ).toBeGreaterThan(0);
  });

  it('returns nothing for an empty query rather than everything', async () => {
    expect(await searchProducts(admin, '   ')).toEqual([]);
  });
});

describe('catalog — images', () => {
  it('adds, reorders and removes in a single transaction', async () => {
    const product = await makeProduct(`Photogenic ${suffix}`);

    const first = await addProductImage(admin, product.id, { url: 'https://cdn.example/1.jpg' });
    const second = await addProductImage(admin, product.id, { url: 'https://cdn.example/2.jpg' });
    expect((await listProductImages(admin, product.id)).map((i) => i.id)).toEqual([
      first.id,
      second.id,
    ]);

    const reordered = await reorderProductImages(admin, product.id, [second.id, first.id]);
    expect(reordered.map((i) => i.id)).toEqual([second.id, first.id]);

    await removeProductImage(admin, first.id);
    expect((await listProductImages(admin, product.id)).map((i) => i.id)).toEqual([second.id]);
  });

  it('refuses a partial reorder rather than half-applying one', async () => {
    const product = await makeProduct(`Gallery ${suffix}`);
    const a = await addProductImage(admin, product.id, { url: 'https://cdn.example/a.jpg' });
    await addProductImage(admin, product.id, { url: 'https://cdn.example/b.jpg' });

    await expect(reorderProductImages(admin, product.id, [a.id])).rejects.toThrow(/exactly/i);
  });

  it('refuses an image URL that would be XSS on the storefront', async () => {
    const product = await makeProduct(`Safe ${suffix}`);
    await expect(
      addProductImage(admin, product.id, { url: 'javascript:alert(1)' }),
    ).rejects.toThrow(/http/i);
  });
});

describe('catalog — audit', () => {
  it('records create and update with before/after', async () => {
    const product = await makeProduct(`Audited ${suffix}`);
    await updateProduct(admin, product.id, { name: `Audited Renamed ${suffix}` });

    const entries = await prisma.auditLog.findMany({
      where: { entityType: 'Product', entityId: product.id },
      orderBy: { createdAt: 'asc' },
    });

    expect(entries.map((e) => e.action)).toEqual(['create', 'update']);
    expect(entries[1]?.beforeJson).toMatchObject({ name: `Audited ${suffix}` });
    expect(entries[1]?.afterJson).toMatchObject({ name: `Audited Renamed ${suffix}` });
  });
});
