import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Prisma } from '@prisma/client';
import { getPrisma, type Principal } from '@/modules/platform';
import {
  addAddress,
  listAddresses,
  removeAddress,
  signUp,
  updateAddress,
} from '@/modules/customers';
import { adoptCart, ensureCart } from '@/modules/cart';
import { createStore } from '../factories/index';

/**
 * R2, R3, R4 — invariants that span rows, under concurrency.
 *
 * "Exactly one default address" and "at most one active cart" are rules about a
 * *set* of rows belonging to one shopper. A row lock protects a row and says
 * nothing about the set: two transactions each inserting a new default lock
 * different rows, each reads the other's uncommitted work as absent, and both
 * commit. There is no row whose lock they would contend for.
 *
 * ## How the race is made deterministic
 *
 * A third transaction holds a row **both** the old and the fixed code must reach
 * — the customer's existing default address for R2, the `Customer` row itself
 * for R3, which every `Cart.customerId` write takes a key-share lock on. Both
 * contenders are started, given time to park on it, and then released together.
 * Against the unfixed code that produces two live defaults and two active carts
 * every run rather than one in ten.
 */
const prisma = getPrisma();
const suffix = `${Date.now() % 1000000}`;

let storeA: string;
let storeB: string;
let customerId: string;
let racerId: string;
let cartCustomerId: string;
let residualId: string;
const cartTokens: string[] = [];

async function makeCustomer(tag: string, digit: string): Promise<string> {
  const email = `${tag}-${suffix}@example.test`;
  await signUp({
    name: `${tag} shopper`,
    email,
    phone: `${digit}${suffix.padStart(8, '0')}`,
    password: 'RaceShopperPass1',
  });
  return (await prisma.customer.findUniqueOrThrow({ where: { email } })).id;
}

async function newCart(storeId: string, owner: string | null = null): Promise<string> {
  const { cart } = await ensureCart(storeId, null, owner);
  cartTokens.push(cart.cartToken);
  return cart.cartToken;
}

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Hold one row's lock while `body` starts its contenders, then let go.
 *
 * `body` must **not** await the work it starts — the whole point is that the
 * work is parked on this lock when the release happens.
 */
async function whileHolding(sql: Prisma.Sql, body: () => Promise<void>): Promise<void> {
  let held!: () => void;
  let release!: () => void;
  const holding = new Promise<void>((resolve) => (held = resolve));
  const released = new Promise<void>((resolve) => (release = resolve));

  const holder = prisma.$transaction(
    async (tx) => {
      await tx.$queryRaw(sql);
      held();
      await released;
    },
    { timeout: 20_000 },
  );

  await holding;
  try {
    await body();
  } finally {
    release();
    await holder;
  }
}

beforeAll(async () => {
  const a = await createStore(prisma, { code: `RCA-${suffix.slice(-5)}` });
  const b = await createStore(prisma, { code: `RCB-${suffix.slice(-5)}` });
  storeA = a.id;
  storeB = b.id;

  customerId = await makeCustomer('race-addr', '91');
  racerId = await makeCustomer('race-cart', '92');
  cartCustomerId = await makeCustomer('race-bind', '93');
  residualId = await makeCustomer('race-default', '94');
});

afterAll(async () => {
  const customers = [customerId, racerId, cartCustomerId, residualId];
  await prisma.cartItem.deleteMany({ where: { cart: { cartToken: { in: cartTokens } } } });
  await prisma.cart.deleteMany({ where: { cartToken: { in: cartTokens } } });
  await prisma.customerAddress.deleteMany({ where: { customerId: { in: customers } } });
  await prisma.customerSession.deleteMany({ where: { customerId: { in: customers } } });
  await prisma.customer.deleteMany({ where: { id: { in: customers } } });
  await prisma.store.deleteMany({ where: { id: { in: [storeA, storeB] } } });
  await prisma.$disconnect();
});

describe('R2 — two addresses claiming the default at once', () => {
  it('leaves exactly one live default', async () => {
    const shopper: Principal = { kind: 'customer', customerId, storeId: storeA };
    const first = await addAddress(shopper, { line1: `1 Original Street ${suffix}` });
    expect(first.isDefault).toBe(true);

    let both: Promise<unknown> = Promise.resolve();
    await whileHolding(
      Prisma.sql`SELECT "id" FROM "CustomerAddress" WHERE "id" = ${first.id} FOR UPDATE`,
      async () => {
        both = Promise.allSettled([
          addAddress(shopper, { line1: `2 Contender Street ${suffix}`, isDefault: true }),
          addAddress(shopper, { line1: `3 Contender Street ${suffix}`, isDefault: true }),
        ]);
        // Long enough for both to reach the lock they must queue on.
        await sleep(400);
      },
    );
    await both;

    const live = await prisma.customerAddress.findMany({
      where: { customerId, isDeleted: false, isDefault: true },
    });
    expect(live).toHaveLength(1);

    // …and the one that survived is a real, visible address, not an orphan.
    const listed = await listAddresses(shopper);
    expect(listed.filter((row) => row.isDefault)).toHaveLength(1);
    expect(listed[0]?.isDefault).toBe(true);
  });
});

describe('R2 residual — promoting an address while it is being removed', () => {
  it('never leaves live addresses with no default', async () => {
    const shopper: Principal = { kind: 'customer', customerId: residualId, storeId: storeA };
    const keeper = await addAddress(shopper, { line1: `10 Keeper Street ${suffix}` });
    const contested = await addAddress(shopper, { line1: `11 Contested Street ${suffix}` });
    expect(keeper.isDefault).toBe(true);
    expect(contested.isDefault).toBe(false);

    // The two requests must decide the *same* question — "is this address the
    // default?" — from the same state. Taking the lock is not enough on its own:
    // the removal read `isDefault: false` before it queued, and acted on that
    // answer after the promotion had already made it wrong.
    let both: Promise<unknown> = Promise.resolve();
    await whileHolding(
      Prisma.sql`SELECT "id" FROM "CustomerAddress" WHERE "id" = ${contested.id} FOR UPDATE`,
      async () => {
        both = Promise.allSettled([
          updateAddress(shopper, contested.id, {
            line1: `11 Contested Street ${suffix}`,
            isDefault: true,
          }),
          removeAddress(shopper, contested.id),
        ]);
        await sleep(400);
      },
    );
    await both;

    const live = await prisma.customerAddress.findMany({
      where: { customerId: residualId, isDeleted: false },
    });
    // Whichever order they land in, the book is coherent: something is live and
    // exactly one thing is the default. An address book with addresses and no
    // default is one checkout has to guess from.
    expect(live.length).toBeGreaterThan(0);
    expect(live.filter((row) => row.isDefault)).toHaveLength(1);
  });

  it('refuses to update an address a concurrent request has already removed', async () => {
    const shopper: Principal = { kind: 'customer', customerId: residualId, storeId: storeA };
    const doomed = await addAddress(shopper, { line1: `12 Doomed Street ${suffix}` });

    await removeAddress(shopper, doomed.id);
    // Sequentially this already held — it is pinned here because moving the
    // existence read inside the lock is exactly the kind of change that could
    // quietly lose it, and an update that revives a deleted row is the other
    // half of what a stale pre-lock read makes possible.
    await expect(
      updateAddress(shopper, doomed.id, { line1: 'Back from the dead' }),
    ).rejects.toThrow(/not found/i);

    const row = await prisma.customerAddress.findUniqueOrThrow({ where: { id: doomed.id } });
    expect(row.isDeleted).toBe(true);
    expect(row.line1).toBe(`12 Doomed Street ${suffix}`);
  });
});

describe('R3 — two devices adopting a basket at once', () => {
  it('leaves exactly one active cart for the customer', async () => {
    const tokenA = await newCart(storeA);
    const tokenB = await newCart(storeB);

    let both: Promise<unknown> = Promise.resolve();
    await whileHolding(
      Prisma.sql`SELECT "id" FROM "Customer" WHERE "id" = ${racerId} FOR UPDATE`,
      async () => {
        both = Promise.allSettled([adoptCart(tokenA, racerId), adoptCart(tokenB, racerId)]);
        await sleep(400);
      },
    );
    await both;

    const active = await prisma.cart.findMany({ where: { customerId: racerId, status: 'ACTIVE' } });
    expect(active).toHaveLength(1);

    // Both carts belong to the shopper; exactly one of them is live.
    const owned = await prisma.cart.findMany({
      where: { cartToken: { in: [tokenA, tokenB] } },
      select: { cartToken: true, customerId: true, status: true },
    });
    expect(owned.filter((row) => row.status === 'ABANDONED')).toHaveLength(1);
  });

  it('can be repaired by adopting again on the device that should win', async () => {
    const winner = await newCart(storeA);
    const loser = await newCart(storeB);
    // The broken state a lost race leaves behind, written directly so the repair
    // is tested rather than the race: two active carts, one customer.
    await prisma.cart.updateMany({
      where: { cartToken: { in: [winner, loser] } },
      data: { customerId: racerId, status: 'ACTIVE' },
    });

    // Signing in again on the device whose basket should win. This used to
    // return early because the cart was already the customer's, so the state
    // could never be repaired by the one action a shopper would naturally take.
    await adoptCart(winner, racerId);

    const active = await prisma.cart.findMany({
      where: { customerId: racerId, status: 'ACTIVE' },
      select: { cartToken: true },
    });
    expect(active.map((row) => row.cartToken)).toEqual([winner]);
  });
});

describe('R4 — a basket started after signing in', () => {
  it('belongs to the account from its first row', async () => {
    const token = await newCart(storeA, cartCustomerId);
    const cart = await prisma.cart.findUniqueOrThrow({ where: { cartToken: token } });
    // A guest cart here means the shopper stays outside the one-active-cart
    // rule until they happen to sign in again — which they have no reason to do.
    expect(cart.customerId).toBe(cartCustomerId);
  });

  it('applies the one-active-cart rule as it is created, not at the next sign-in', async () => {
    const older = await newCart(storeA, cartCustomerId);
    const newer = await newCart(storeB, cartCustomerId);

    const rows = await prisma.cart.findMany({
      where: { cartToken: { in: [older, newer] } },
      select: { cartToken: true, status: true },
    });
    expect(rows.find((row) => row.cartToken === newer)?.status).toBe('ACTIVE');
    expect(rows.find((row) => row.cartToken === older)?.status).toBe('ABANDONED');
  });

  it('adopts an existing guest basket on this device rather than starting a new one', async () => {
    const guest = await newCart(storeA);
    const { cart, created } = await ensureCart(storeA, guest, cartCustomerId);

    expect(created).toBe(false);
    expect(cart.cartToken).toBe(guest);
    expect(cart.customerId).toBe(cartCustomerId);
  });

  it('leaves a guest basket a guest basket', async () => {
    const guest = await newCart(storeA);
    const { cart } = await ensureCart(storeA, guest, null);
    expect(cart.customerId).toBeNull();
    expect(cart.cartToken).toBe(guest);
  });
});
