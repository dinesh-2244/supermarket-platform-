import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { getPrisma, type Principal } from '@/modules/platform';
import { auditEntries } from '@/modules/admin';
import { createUser, updateUser } from '@/modules/identity';
import { createCategory, createProduct, updateProduct } from '@/modules/catalog';
import { setPrice } from '@/modules/pricing';
import { updateSettings } from '@/modules/stores';
import { reconcileStock } from '@/modules/inventory';
import { createStore, createStoreSettings } from '../factories/index';

/**
 * R3 — audit visibility must follow the store a change *belonged to*, not the
 * store its actor happens to be in today.
 */
const prisma = getPrisma();
const suffix = `${Date.now() % 1000000}`;

let admin: Principal;
let managerA: Principal;
let storeA: string;
let storeB: string;
let transferredId: string;
let productId: string;
let categoryId: string;
const userIds: string[] = [];

beforeAll(async () => {
  const a = await createStore(prisma, { code: `AUA-${suffix.slice(-5)}` });
  const b = await createStore(prisma, { code: `AUB-${suffix.slice(-5)}` });
  storeA = a.id;
  storeB = b.id;
  await createStoreSettings(prisma, storeA);
  await createStoreSettings(prisma, storeB);

  const bootstrap: Principal = {
    kind: 'user',
    userId: 'aud-bootstrap',
    role: 'SUPER_ADMIN',
    storeId: null,
  };
  const password = 'AuditScopePass123';
  const adminRow = await createUser(bootstrap, {
    email: `aud-admin-${suffix}@example.test`,
    name: 'Audit Admin',
    password,
    role: 'SUPER_ADMIN',
    storeId: null,
  });
  admin = { kind: 'user', userId: adminRow.id, role: 'SUPER_ADMIN', storeId: null };

  const mgrA = await createUser(admin, {
    email: `aud-mgr-a-${suffix}@example.test`,
    name: 'Audit Manager A',
    password,
    role: 'STORE_MANAGER',
    storeId: storeA,
  });
  const transferred = await createUser(admin, {
    email: `aud-transfer-${suffix}@example.test`,
    name: 'Transferred Manager',
    password,
    role: 'STORE_MANAGER',
    storeId: storeB,
  });
  userIds.push(adminRow.id, mgrA.id, transferred.id);
  managerA = { kind: 'user', userId: mgrA.id, role: 'STORE_MANAGER', storeId: storeA };
  transferredId = transferred.id;

  categoryId = (await createCategory(admin, { name: `Audit ${suffix}` })).id;
  productId = (
    await createProduct(admin, {
      sku: `AUD-${suffix}`,
      name: `Audited ${suffix}`,
      packSize: '1 kg',
      categoryId,
    })
  ).id;
});

afterAll(async () => {
  const stores = [storeA, storeB];
  await prisma.auditLog.deleteMany({ where: { storeId: { in: stores } } });
  await prisma.auditLog.deleteMany({
    where: { actorId: { in: [...userIds, 'aud-bootstrap'] } },
  });
  await prisma.stockLedger.deleteMany({ where: { storeId: { in: stores } } });
  await prisma.inventoryItem.deleteMany({ where: { storeId: { in: stores } } });
  await prisma.priceChange.deleteMany({ where: { storeProduct: { storeId: { in: stores } } } });
  await prisma.storeProduct.deleteMany({ where: { storeId: { in: stores } } });
  await prisma.product.deleteMany({ where: { id: productId } });
  await prisma.category.deleteMany({ where: { id: categoryId } });
  await prisma.session.deleteMany({ where: { userId: { in: userIds } } });
  await prisma.user.deleteMany({ where: { id: { in: userIds } } });
  await prisma.storeSettings.deleteMany({ where: { storeId: { in: stores } } });
  await prisma.store.deleteMany({ where: { id: { in: stores } } });
  await prisma.$disconnect();
});

describe('R3 — audit scope is stamped, not inferred', () => {
  /**
   * OSCAR's exact reproduction: a manager makes a change in store B, is then
   * transferred to store A, and store A's existing manager could read the store
   * B change — because visibility was derived from the actor's *current* store.
   */
  it('does not expose another store’s history when an actor is transferred', async () => {
    const transferredPrincipal: Principal = {
      kind: 'user',
      userId: transferredId,
      role: 'STORE_MANAGER',
      storeId: storeB,
    };

    // A price change that belongs to store B.
    await setPrice(transferredPrincipal, storeB, productId, {
      mrpPaise: 10_000,
      sellingPricePaise: 7_777,
      reason: `store-b-secret-${suffix}`,
    });

    const stamped = await prisma.auditLog.findFirstOrThrow({
      where: { entityType: 'StoreProduct', actorId: transferredId },
      orderBy: { createdAt: 'desc' },
    });
    expect(stamped.storeId).toBe(storeB);

    // Now transfer them into store A.
    await updateUser(admin, transferredId, { storeId: storeA });

    // Store A's manager must still not see the store B change.
    const visible = await auditEntries(managerA, { actorId: transferredId, limit: 100 });
    expect(visible.map((entry) => entry.id)).not.toContain(stamped.id);
    expect(visible.every((entry) => entry.storeId === storeA)).toBe(true);

    // The row itself is untouched — history is not rewritten by a transfer.
    const after = await prisma.auditLog.findUniqueOrThrow({ where: { id: stamped.id } });
    expect(after.storeId).toBe(storeB);
  });

  /**
   * The second half of R3: filtering *after* the query dropped legitimate rows
   * whenever the newest page happened to belong to another store.
   */
  it('does not lose a visible row behind a page of other-store activity', async () => {
    // One entry for store A, then a lot of noise from store B.
    await updateSettings(managerA, storeA, { deliveryFeePaise: 4_321 });
    const mine = await prisma.auditLog.findFirstOrThrow({
      where: { storeId: storeA, entityType: 'StoreSettings' },
      orderBy: { createdAt: 'desc' },
    });

    for (let i = 0; i < 40; i += 1) {
      await updateSettings(admin, storeB, { deliveryFeePaise: 1_000 + i });
    }

    // A small page: under post-query filtering the store B noise would fill it
    // and the store A row would vanish.
    const visible = await auditEntries(managerA, { limit: 10 });
    expect(visible.map((entry) => entry.id)).toContain(mine.id);
    expect(visible.every((entry) => entry.storeId === storeA)).toBe(true);
  }, 60_000);

  it('keeps global catalogue changes out of a scoped principal’s view', async () => {
    await updateProduct(admin, productId, { brand: `Brand ${suffix}` });

    const global = await prisma.auditLog.findFirstOrThrow({
      where: { entityType: 'Product', entityId: productId },
      orderBy: { createdAt: 'desc' },
    });
    // The master belongs to no store — "global", not "unassigned".
    expect(global.storeId).toBeNull();

    const managerView = await auditEntries(managerA, { limit: 200 });
    expect(managerView.map((entry) => entry.id)).not.toContain(global.id);

    // …and a super-admin does see it.
    const adminView = await auditEntries(admin, { entityType: 'Product', limit: 50 });
    expect(adminView.map((entry) => entry.id)).toContain(global.id);
  });

  it('shows a super-admin every store’s entries', async () => {
    const all = await auditEntries(admin, { limit: 200 });
    const stores = new Set(all.map((entry) => entry.storeId));
    expect(stores.has(storeA)).toBe(true);
    expect(stores.has(storeB)).toBe(true);
  });

  /**
   * N4: the reconcile branch that finds the count already correct still writes
   * an audit entry (it records *when* the shelf was counted), and it omitted
   * `storeId` — so under the SQL scope filter the manager who did the count
   * could not see their own entry.
   */
  it('stamps the store on both reconcile branches', async () => {
    // Non-zero: the count disagrees and stock moves.
    await reconcileStock(managerA, { storeId: storeA, productId, counted: 7 });
    // Zero: the count agrees, only countedAt moves.
    await reconcileStock(managerA, { storeId: storeA, productId, counted: 7 });

    const entries = await prisma.auditLog.findMany({
      where: { entityType: 'InventoryItem', entityId: `${storeA}:${productId}` },
      orderBy: { createdAt: 'asc' },
    });
    expect(entries).toHaveLength(2);
    expect(entries.map((entry) => entry.storeId)).toEqual([storeA, storeA]);
    expect(entries[1]?.afterJson).toMatchObject({ counted: 7, delta: 0 });

    // Both are visible to the manager who made them — the point of the stamp.
    const visible = await auditEntries(managerA, { entityType: 'InventoryItem', limit: 50 });
    const ids = visible.map((entry) => entry.id);
    for (const entry of entries) expect(ids).toContain(entry.id);
  });

  it('refuses a principal with no audit grant', async () => {
    const staff: Principal = {
      kind: 'user',
      userId: 'aud-staff',
      role: 'STORE_STAFF',
      storeId: storeA,
    };
    await expect(auditEntries(staff)).rejects.toThrow(/permission/i);
  });
});
