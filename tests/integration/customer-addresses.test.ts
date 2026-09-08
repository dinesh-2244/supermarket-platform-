import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { getPrisma, type Principal } from '@/modules/platform';
import {
  addAddress,
  getAddress,
  listAddresses,
  removeAddress,
  signUp,
  updateAddress,
} from '@/modules/customers';
import { createStore } from '../factories/index';

/**
 * P3-7 — the address book.
 *
 * Three rules, each with a way of going quietly wrong: exactly one default
 * (or checkout has to guess), soft delete (or a past order loses where it
 * went), and every lookup scoped to the owner (or it is an IDOR).
 */
const prisma = getPrisma();
const suffix = `${Date.now() % 1000000}`;

let storeId: string;
let areaId: string;
let inactiveAreaId: string;
let mine: Principal;
let theirs: Principal;
let myId: string;
let theirId: string;

async function makeCustomer(tag: string, digit: string): Promise<string> {
  const email = `${tag}-${suffix}@example.test`;
  await signUp({
    name: `${tag} shopper`,
    email,
    phone: `${digit}${suffix.padStart(8, '0')}`,
    password: 'AddressBookPass1',
  });
  return (await prisma.customer.findUniqueOrThrow({ where: { email } })).id;
}

beforeAll(async () => {
  const store = await createStore(prisma, { code: `ADR-${suffix.slice(-5)}` });
  storeId = store.id;
  const zone = await prisma.deliveryZone.create({
    data: { storeId, name: `Address zone ${suffix}` },
  });
  areaId = (
    await prisma.deliveryArea.create({
      data: { zoneId: zone.id, name: `Address area ${suffix}`, pincode: '560001' },
    })
  ).id;
  inactiveAreaId = (
    await prisma.deliveryArea.create({
      data: { zoneId: zone.id, name: `Retired area ${suffix}`, isActive: false },
    })
  ).id;

  myId = await makeCustomer('mine', '98');
  theirId = await makeCustomer('theirs', '97');
  mine = { kind: 'customer', customerId: myId, storeId };
  theirs = { kind: 'customer', customerId: theirId, storeId };
});

afterAll(async () => {
  const customers = [myId, theirId];
  await prisma.customerAddress.deleteMany({ where: { customerId: { in: customers } } });
  await prisma.customerSession.deleteMany({ where: { customerId: { in: customers } } });
  await prisma.customer.deleteMany({ where: { id: { in: customers } } });
  await prisma.deliveryArea.deleteMany({ where: { zone: { storeId } } });
  await prisma.deliveryZone.deleteMany({ where: { storeId } });
  await prisma.store.deleteMany({ where: { id: storeId } });
  await prisma.$disconnect();
});

describe('P3-7 — exactly one default', () => {
  it('makes the first address the default whether asked to or not', async () => {
    const first = await addAddress(mine, { line1: `1 First Street ${suffix}` });
    // An address book with no default is one checkout has to guess from.
    expect(first.isDefault).toBe(true);
  });

  it('moves the default rather than having two', async () => {
    const second = await addAddress(mine, {
      line1: `2 Second Street ${suffix}`,
      isDefault: true,
    });

    const all = await listAddresses(mine);
    expect(all.filter((address) => address.isDefault)).toHaveLength(1);
    expect(all.find((address) => address.isDefault)?.id).toBe(second.id);
    // The default sorts first, so a page can just take the head.
    expect(all[0]?.id).toBe(second.id);
  });

  it('moves the default on an edit too', async () => {
    const all = await listAddresses(mine);
    const notDefault = all.find((address) => !address.isDefault);
    await updateAddress(mine, notDefault!.id, { line1: notDefault!.line1, isDefault: true });

    const after = await listAddresses(mine);
    expect(after.filter((address) => address.isDefault)).toHaveLength(1);
    expect(after.find((address) => address.isDefault)?.id).toBe(notDefault!.id);
  });
});

describe('P3-7 — removal is a soft delete', () => {
  it('keeps the row and hides it', async () => {
    const address = await addAddress(mine, { line1: `3 Doomed Lane ${suffix}` });
    await removeAddress(mine, address.id);

    expect((await listAddresses(mine)).map((row) => row.id)).not.toContain(address.id);
    // Phase 4's orders will reference where they were delivered, so the row
    // stays — a hard delete would erase a past order's destination.
    const row = await prisma.customerAddress.findUniqueOrThrow({ where: { id: address.id } });
    expect(row.isDeleted).toBe(true);

    // …and it is gone as far as every scoped read is concerned.
    await expect(getAddress(mine, address.id)).rejects.toThrow(/not found/i);
  });

  it('hands the default to another address when the default goes', async () => {
    const keeper = await addAddress(mine, { line1: `4 Keeper Road ${suffix}` });
    const doomed = await addAddress(mine, {
      line1: `5 Doomed Road ${suffix}`,
      isDefault: true,
    });

    await removeAddress(mine, doomed.id);

    const all = await listAddresses(mine);
    expect(all.filter((address) => address.isDefault)).toHaveLength(1);
    expect(all.map((address) => address.id)).toContain(keeper.id);
  });
});

describe('P3-7 — an address belongs to one shopper', () => {
  it('refuses another shopper’s address by id', async () => {
    const theirAddress = await addAddress(theirs, { line1: `9 Private Way ${suffix}` });

    // The id is real and the row exists — it is simply not this shopper's.
    await expect(getAddress(mine, theirAddress.id)).rejects.toThrow(/not found/i);
    await expect(updateAddress(mine, theirAddress.id, { line1: 'Hijacked' })).rejects.toThrow(
      /not found/i,
    );
    await expect(removeAddress(mine, theirAddress.id)).rejects.toThrow(/not found/i);

    // Untouched.
    const row = await prisma.customerAddress.findUniqueOrThrow({ where: { id: theirAddress.id } });
    expect(row.line1).toBe(`9 Private Way ${suffix}`);
    expect(row.isDeleted).toBe(false);
  });

  it('lists only the signed-in shopper’s addresses', async () => {
    const ids = (await listAddresses(mine)).map((address) => address.id);
    const theirIds = (await listAddresses(theirs)).map((address) => address.id);
    expect(ids.some((id) => theirIds.includes(id))).toBe(false);
  });

  it('refuses a guest and a member of staff alike', async () => {
    const guest: Principal = { kind: 'customer', customerId: null, storeId };
    const staff: Principal = {
      kind: 'user',
      userId: 'someone',
      role: 'SUPER_ADMIN',
      storeId: null,
    };
    await expect(listAddresses(guest)).rejects.toThrow(/signed in/i);
    await expect(listAddresses(staff)).rejects.toThrow(/signed in/i);
    await expect(addAddress(staff, { line1: 'Nope' })).rejects.toThrow(/signed in/i);
  });
});

describe('P3-7 — an address has to be somewhere we could deliver', () => {
  it('accepts a real, active delivery area', async () => {
    const address = await addAddress(mine, {
      line1: `6 Real Area Street ${suffix}`,
      areaId,
      pincode: '560001',
    });
    expect(address.areaId).toBe(areaId);
    expect(address.pincode).toBe('560001');
  });

  it('refuses an area that does not exist or is retired', async () => {
    await expect(addAddress(mine, { line1: 'Somewhere', areaId: 'not-an-area' })).rejects.toThrow(
      /delivery area/i,
    );
    // Pointing at a retired area would fail at checkout, far too late.
    await expect(addAddress(mine, { line1: 'Somewhere', areaId: inactiveAreaId })).rejects.toThrow(
      /delivery area/i,
    );
  });

  it('refuses an empty line and a malformed pincode', async () => {
    await expect(addAddress(mine, { line1: '   ' })).rejects.toThrow(/required/i);
    await expect(addAddress(mine, { line1: 'Fine', pincode: '123' })).rejects.toThrow(
      /six digits/i,
    );
  });

  it('normalises blank optional fields to null rather than empty strings', async () => {
    const address = await addAddress(mine, {
      line1: `7 Blank Fields Street ${suffix}`,
      label: '  ',
      line2: '',
      landmark: '   ',
    });
    expect(address.label).toBeNull();
    expect(address.line2).toBeNull();
    expect(address.landmark).toBeNull();
  });
});
