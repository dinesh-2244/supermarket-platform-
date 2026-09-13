import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { getPrisma, RateLimitError, type Principal } from '@/modules/platform';
import {
  getProductRequest,
  INTAKE_LIMITS,
  listProductRequests,
  productRequestCounts,
  submitProductRequest,
  updateProductRequestStatus,
} from '@/modules/product-requests';
import { listForPrincipal } from '@/modules/product-requests/repo';
import { createStore, createStoreSettings, createUser } from '../factories/index';

/**
 * Phase 5.5 — "Request a product", against a real database.
 *
 * A shopper (signed in or not) asks the store they are browsing for something
 * the catalogue does not carry; staff triage it. On trial: the request lands
 * in the browsing store and nowhere else, the triage is store-scoped and
 * manager-only, and every status change leaves both its history row and its
 * audit row in the same transaction — or neither.
 */
const prisma = getPrisma();

const userIds: string[] = [];
let storeA: string;
let storeB: string;
let guestA: Principal;
let accountA: Principal;
let guestB: Principal;
let managerA: Principal;
let managerB: Principal;
let staffA: Principal;
let superAdmin: Principal;

beforeAll(async () => {
  storeA = (await createStore(prisma)).id;
  await createStoreSettings(prisma, storeA);
  storeB = (await createStore(prisma)).id;
  await createStoreSettings(prisma, storeB);

  guestA = { kind: 'customer', customerId: null, storeId: storeA };
  accountA = { kind: 'customer', customerId: 'cust-asha', storeId: storeA };
  guestB = { kind: 'customer', customerId: null, storeId: storeB };

  const mA = await createUser(prisma, { role: 'STORE_MANAGER', storeId: storeA });
  const mB = await createUser(prisma, { role: 'STORE_MANAGER', storeId: storeB });
  const sA = await createUser(prisma, { role: 'STORE_STAFF', storeId: storeA });
  const sup = await createUser(prisma, { role: 'SUPER_ADMIN', storeId: null });
  userIds.push(mA.id, mB.id, sA.id, sup.id);
  managerA = { kind: 'user', userId: mA.id, role: 'STORE_MANAGER', storeId: storeA };
  managerB = { kind: 'user', userId: mB.id, role: 'STORE_MANAGER', storeId: storeB };
  staffA = { kind: 'user', userId: sA.id, role: 'STORE_STAFF', storeId: storeA };
  superAdmin = { kind: 'user', userId: sup.id, role: 'SUPER_ADMIN', storeId: null };
});

afterAll(async () => {
  const stores = [storeA, storeB];
  await prisma.auditLog.deleteMany({ where: { entityType: 'ProductRequest' } });
  await prisma.productRequest.deleteMany({ where: { storeId: { in: stores } } });
  await prisma.storeSettings.deleteMany({ where: { storeId: { in: stores } } });
  await prisma.store.deleteMany({ where: { id: { in: stores } } });
  await prisma.user.deleteMany({ where: { id: { in: userIds } } });
  await prisma.$disconnect();
});

describe('submitting a request', () => {
  it('lands in the store the shopper is browsing, at NEW, with its opening history row', async () => {
    const created = await submitProductRequest(guestA, {
      clientKey: 'guest-asha',
      productName: ' Ragi flour ',
      brand: '24 Mantra',
      packSize: '1 kg',
      customerName: 'Asha',
      customerPhone: '+91 98765 43210',
    });
    expect(created).toMatchObject({
      storeId: storeA,
      productName: 'Ragi flour',
      brand: '24 Mantra',
      packSize: '1 kg',
      note: null,
      customerName: 'Asha',
      customerPhone: '9876543210',
      status: 'NEW',
    });

    const history = await prisma.productRequestStatusHistory.findMany({
      where: { requestId: created.id },
    });
    expect(history).toHaveLength(1);
    expect(history[0]).toMatchObject({
      fromStatus: null,
      toStatus: 'NEW',
      actorType: 'CUSTOMER',
      actorId: null,
    });
  });

  it('records the account when the shopper is signed in', async () => {
    const created = await submitProductRequest(accountA, { productName: 'Cold-pressed oil' });
    const [row] = await prisma.productRequestStatusHistory.findMany({
      where: { requestId: created.id },
    });
    expect(row).toMatchObject({ actorType: 'CUSTOMER', actorId: 'cust-asha' });
  });

  it('refuses a blank product name and writes nothing', async () => {
    const before = await prisma.productRequest.count({ where: { storeId: storeA } });
    await expect(
      submitProductRequest(guestA, { clientKey: 'guest-blank', productName: '  ' }),
    ).rejects.toThrow(/product name/i);
    expect(await prisma.productRequest.count({ where: { storeId: storeA } })).toBe(before);
  });

  it('refuses a shopper who has not picked a store yet', async () => {
    await expect(
      submitProductRequest(
        { kind: 'customer', customerId: null, storeId: null },
        {
          productName: 'Anything',
        },
      ),
    ).rejects.toThrow(/delivery area|store/i);
  });

  it('refuses staff and the system — a request is a shopper’s voice', async () => {
    await expect(submitProductRequest(managerA, { productName: 'x' })).rejects.toThrow(/shopper/i);
    await expect(submitProductRequest({ kind: 'system' }, { productName: 'x' })).rejects.toThrow(
      /shopper/i,
    );
  });
});

describe('the triage list', () => {
  let inB: string;

  beforeAll(async () => {
    inB = (await submitProductRequest(guestB, { clientKey: 'guest-b', productName: 'Only in B' }))
      .id;
  });

  it('shows staff their own store’s requests, newest first, and not the other store’s', async () => {
    const rows = await listProductRequests(staffA, storeA);
    expect(rows.length).toBeGreaterThanOrEqual(2);
    expect(rows.every((r) => r.storeId === storeA)).toBe(true);
    expect(rows.map((r) => r.id)).not.toContain(inB);
    for (let i = 1; i < rows.length; i += 1) {
      expect(rows[i - 1]!.createdAt.getTime()).toBeGreaterThanOrEqual(rows[i]!.createdAt.getTime());
    }
  });

  it('refuses a manager who asks for the other store', async () => {
    await expect(listProductRequests(managerA, storeB)).rejects.toThrow(/permission/i);
  });

  it('lets a super-admin read either store', async () => {
    expect((await listProductRequests(superAdmin, storeB)).map((r) => r.id)).toContain(inB);
  });

  it('is scoped in the query itself, not only by the service’s check', async () => {
    // The second line: even a caller that skipped authorization and asked the
    // repository for the other store gets nothing back.
    expect(await listForPrincipal(prisma, managerA, storeB, {})).toEqual([]);
    expect((await listForPrincipal(prisma, managerB, storeB, {})).map((r) => r.id)).toContain(inB);
  });

  it('filters by status', async () => {
    const rows = await listProductRequests(managerA, storeA, { statuses: ['FULFILLED'] });
    expect(rows).toEqual([]);
  });

  it('counts by status from a real aggregate, zero-filled', async () => {
    const counts = await productRequestCounts(managerA, storeA);
    const rows = await listProductRequests(managerA, storeA);
    expect(counts.byStatus.NEW).toBe(rows.filter((r) => r.status === 'NEW').length);
    expect(counts.byStatus.FULFILLED).toBe(0);
    expect(counts.total).toBe(rows.length);
    await expect(productRequestCounts(managerB, storeA)).rejects.toThrow(/permission/i);
  });

  it('opens one request with its history — and the other store’s reads as not found', async () => {
    const detail = await getProductRequest(managerB, inB);
    expect(detail?.history).toHaveLength(1);
    expect(await getProductRequest(managerA, inB)).toBeNull();
    expect(await getProductRequest(managerA, 'no-such-id')).toBeNull();
  });
});

describe('triage', () => {
  let n = 0;
  async function fresh(): Promise<string> {
    n += 1;
    return (
      await submitProductRequest(guestA, {
        clientKey: `triage-${n}`,
        productName: `Triage ${n}`,
      })
    ).id;
  }

  it('moves the status and writes the history row and the audit row together', async () => {
    const id = await fresh();
    const audits = await prisma.auditLog.count({ where: { entityType: 'ProductRequest' } });

    const updated = await updateProductRequestStatus(managerA, id, 'REVIEWED', 'Looks popular');
    expect(updated.status).toBe('REVIEWED');

    const history = await prisma.productRequestStatusHistory.findMany({
      where: { requestId: id },
      orderBy: { createdAt: 'asc' },
    });
    expect(history.map((h) => [h.fromStatus, h.toStatus])).toEqual([
      [null, 'NEW'],
      ['NEW', 'REVIEWED'],
    ]);
    expect(history[1]).toMatchObject({
      actorType: 'USER',
      actorId: managerA.kind === 'user' ? managerA.userId : null,
      note: 'Looks popular',
    });

    const audit = await prisma.auditLog.findFirst({
      where: { entityType: 'ProductRequest', entityId: id },
      orderBy: { createdAt: 'desc' },
    });
    expect(await prisma.auditLog.count({ where: { entityType: 'ProductRequest' } })).toBe(
      audits + 1,
    );
    expect(audit).toMatchObject({
      action: 'update',
      storeId: storeA,
      beforeJson: { status: 'NEW' },
      afterJson: { status: 'REVIEWED', note: 'Looks popular' },
    });
  });

  it('refuses a transition the table does not allow, and leaves no trace', async () => {
    const id = await fresh();
    await updateProductRequestStatus(managerA, id, 'FULFILLED');
    const before = await prisma.productRequestStatusHistory.count({ where: { requestId: id } });
    await expect(updateProductRequestStatus(managerA, id, 'PLANNED')).rejects.toThrow(/cannot/i);
    expect(await prisma.productRequestStatusHistory.count({ where: { requestId: id } })).toBe(
      before,
    );
  });

  it('needs a reason to decline', async () => {
    const id = await fresh();
    await expect(updateProductRequestStatus(managerA, id, 'DECLINED')).rejects.toThrow(/reason/i);
    await updateProductRequestStatus(managerA, id, 'DECLINED', 'Not stocked by our suppliers');
    expect((await getProductRequest(managerA, id))?.status).toBe('DECLINED');
  });

  it('refuses staff, and refuses the other store’s manager — as not found', async () => {
    const id = await fresh();
    await expect(updateProductRequestStatus(staffA, id, 'REVIEWED')).rejects.toThrow(/permission/i);
    await expect(updateProductRequestStatus(managerB, id, 'REVIEWED')).rejects.toThrow(
      /not found/i,
    );
    expect((await getProductRequest(managerA, id))?.status).toBe('NEW');
  });

  it('is not found for an id that does not exist', async () => {
    await expect(updateProductRequestStatus(superAdmin, 'no-such-id', 'REVIEWED')).rejects.toThrow(
      /not found/i,
    );
  });
});

describe('intake abuse control', () => {
  // A store of its own, so the caps below are measured from zero.
  let storeC: string;
  let guestC: Principal;

  beforeAll(async () => {
    storeC = (await createStore(prisma)).id;
    await createStoreSettings(prisma, storeC);
    guestC = { kind: 'customer', customerId: null, storeId: storeC };
  });

  afterAll(async () => {
    await prisma.productRequest.deleteMany({ where: { storeId: storeC } });
    await prisma.storeSettings.deleteMany({ where: { storeId: storeC } });
    await prisma.store.deleteMany({ where: { id: storeC } });
  });

  it('bounds one client hammering the form — OSCAR’s 121-in-1.7s probe', async () => {
    // Same client, 121 rapid submissions of distinct product names.
    const outcomes: string[] = [];
    for (let i = 0; i < 121; i += 1) {
      try {
        await submitProductRequest(guestC, { clientKey: 'flood-one', productName: `Flood ${i}` });
        outcomes.push('accepted');
      } catch (error) {
        outcomes.push(error instanceof Error ? error.constructor.name : 'unknown');
      }
    }
    const accepted = outcomes.filter((o) => o === 'accepted').length;
    expect(accepted).toBe(INTAKE_LIMITS.perSubmitter.max);
    expect(new Set(outcomes.filter((o) => o !== 'accepted'))).toEqual(new Set(['RateLimitError']));
    expect(await prisma.productRequest.count({ where: { storeId: storeC } })).toBe(accepted);
  });

  it('bounds a store even when every submission comes from a different client', async () => {
    const before = await prisma.productRequest.count({ where: { storeId: storeC } });
    let accepted = 0;
    for (let i = 0; i < 121; i += 1) {
      try {
        await submitProductRequest(guestC, { clientKey: `many-${i}`, productName: `Many ${i}` });
        accepted += 1;
      } catch (error) {
        expect(error).toBeInstanceOf(RateLimitError);
      }
    }
    expect(before + accepted).toBe(INTAKE_LIMITS.perStore.max);
    expect(await prisma.productRequest.count({ where: { storeId: storeC } })).toBe(
      INTAKE_LIMITS.perStore.max,
    );
  });

  it('holds the store cap under concurrent submissions, without any other kind of failure', async () => {
    const storeD = (await createStore(prisma)).id;
    await createStoreSettings(prisma, storeD);
    const guestD: Principal = { kind: 'customer', customerId: null, storeId: storeD };
    try {
      const results = await Promise.allSettled(
        Array.from({ length: 60 }, (_, i) =>
          submitProductRequest(guestD, { clientKey: `conc-${i}`, productName: `Conc ${i}` }),
        ),
      );
      for (const r of results) {
        if (r.status === 'rejected') expect(r.reason).toBeInstanceOf(RateLimitError);
      }
      expect(await prisma.productRequest.count({ where: { storeId: storeD } })).toBeLessThanOrEqual(
        INTAKE_LIMITS.perStore.max,
      );
    } finally {
      await prisma.productRequest.deleteMany({ where: { storeId: storeD } });
      await prisma.storeSettings.deleteMany({ where: { storeId: storeD } });
      await prisma.store.deleteMany({ where: { id: storeD } });
    }
  });

  it('treats the same ask from the same client as a double-submit, not a new row', async () => {
    const storeE = (await createStore(prisma)).id;
    await createStoreSettings(prisma, storeE);
    const guestE: Principal = { kind: 'customer', customerId: null, storeId: storeE };
    try {
      await submitProductRequest(guestE, { clientKey: 'dup', productName: 'Ragi flour' });
      await expect(
        submitProductRequest(guestE, { clientKey: 'dup', productName: '  ragi  FLOUR ' }),
      ).rejects.toThrow(/already/i);
      // A different product from the same client, and the same product from a
      // different client, are both new asks.
      await submitProductRequest(guestE, { clientKey: 'dup', productName: 'Rice flour' });
      await submitProductRequest(guestE, { clientKey: 'other', productName: 'Ragi flour' });
      expect(await prisma.productRequest.count({ where: { storeId: storeE } })).toBe(3);
    } finally {
      await prisma.productRequest.deleteMany({ where: { storeId: storeE } });
      await prisma.storeSettings.deleteMany({ where: { storeId: storeE } });
      await prisma.store.deleteMany({ where: { id: storeE } });
    }
  });

  it('identifies a signed-in shopper by account and a guest by phone before the client key', async () => {
    const acc = await submitProductRequest(
      { kind: 'customer', customerId: 'cust-key', storeId: storeA },
      { productName: 'By account' },
    );
    const byPhone = await submitProductRequest(guestA, {
      productName: 'By phone',
      customerPhone: '9123456789',
    });
    const rows = await prisma.productRequest.findMany({
      where: { id: { in: [acc.id, byPhone.id] } },
      select: { id: true, submitterKey: true },
    });
    expect(rows.find((r) => r.id === acc.id)?.submitterKey).toBe('customer:cust-key');
    expect(rows.find((r) => r.id === byPhone.id)?.submitterKey).toBe('phone:9123456789');
  });

  it('refuses a guest with neither phone nor client key — nothing to bound them by', async () => {
    await expect(submitProductRequest(guestA, { productName: 'Anonymous' })).rejects.toThrow(
      /client key/i,
    );
  });
});
