/**
 * Pure domain logic for `checkout` — no I/O, no Prisma, no framework types.
 *
 * Everything here is a rule that can be decided from numbers and dates alone, so
 * the interesting cases (a slot half an hour off the grid, a basket a rupee under
 * the minimum) are testable without a database.
 */
import { ValidationError } from '../../platform/index';

/** Static description of what this module owns and may depend on (§4). */
export interface ModuleDescriptor {
  readonly name: string;
  readonly owns: string;
  readonly dependsOn: readonly string[];
  readonly emits: readonly string[];
}

export const descriptor: ModuleDescriptor = {
  name: 'checkout',
  owns: 'serviceability check, store binding, placeOrder() (decrements stock in-tx)',
  dependsOn: ['platform', 'cart', 'orders', 'inventory', 'stores', 'customers'],
  emits: ['order.placed'],
};

export type PaymentMethod = 'COD' | 'UPI_ON_DELIVERY';

export const PAYMENT_METHODS: readonly PaymentMethod[] = ['COD', 'UPI_ON_DELIVERY'];

/** Both are collected on delivery; neither takes money now (Phase 4 boundary). */
export function assertPaymentMethod(value: string): PaymentMethod {
  if (!PAYMENT_METHODS.includes(value as PaymentMethod)) {
    throw new ValidationError('Choose how you will pay on delivery', { value });
  }
  return value as PaymentMethod;
}

const MINUTE_MS = 60_000;

/** The end of the one-hour (or whatever the store says) window a slot opens. */
export function slotEnd(start: Date, slotLengthMinutes: number): Date {
  return new Date(start.getTime() + slotLengthMinutes * MINUTE_MS);
}

/**
 * A slot start must sit **on the grid** the store's slot length defines,
 * measured from midnight UTC.
 *
 * Anchoring to midnight rather than to "now" is what makes the grid the same for
 * every shopper and every request: two people loading the page a minute apart
 * must be offered — and must be able to book — the same windows, or the capacity
 * count in `placeOrder` would be counting different things for each of them.
 */
export function isOnSlotGrid(start: Date, slotLengthMinutes: number): boolean {
  if (slotLengthMinutes <= 0) return false;
  const msIntoDay = start.getTime() % (24 * 60 * MINUTE_MS);
  return msIntoDay % (slotLengthMinutes * MINUTE_MS) === 0;
}

export interface SlotShapeInput {
  readonly start: Date;
  readonly slotLengthMinutes: number;
  readonly now: Date;
}

/**
 * The slot rules `placeOrder` can decide without touching the database.
 *
 * Capacity is deliberately *not* here: it is a fact about other orders, and the
 * only trustworthy place to establish it is under the advisory lock inside the
 * placing transaction (D3).
 */
export function assertSlotShape(input: SlotShapeInput): void {
  if (Number.isNaN(input.start.getTime())) {
    throw new ValidationError('Choose a delivery slot', {});
  }
  if (!isOnSlotGrid(input.start, input.slotLengthMinutes)) {
    throw new ValidationError('That is not one of this shop’s delivery windows', {
      slotLengthMinutes: input.slotLengthMinutes,
    });
  }
  if (input.start.getTime() <= input.now.getTime()) {
    throw new ValidationError('That delivery window has already started', {});
  }
}

export interface LineShortfall {
  readonly productId: string;
  readonly name: string;
  readonly reason: 'out-of-stock' | 'insufficient-stock' | 'unlisted';
  readonly available?: number;
}

/**
 * Turn a revalidated basket into the list of reasons it cannot be ordered.
 *
 * A cart *flags* a short line and keeps it (the shopper may still want to look
 * at it); checkout is where that stops being something to look at and becomes a
 * rejection. Removed lines count too: a delisted product silently vanishing
 * between the basket page and the confirmation is worse than being told.
 */
export function shortfallsIn(view: {
  lines: readonly {
    productId: string;
    name: string;
    issues: readonly ({ kind: string } & { available?: number })[];
  }[];
  removed: readonly { productId: string; name: string }[];
}): LineShortfall[] {
  const shortfalls: LineShortfall[] = [];

  for (const line of view.lines) {
    for (const issue of line.issues) {
      if (issue.kind === 'out-of-stock') {
        shortfalls.push({ productId: line.productId, name: line.name, reason: 'out-of-stock' });
      } else if (issue.kind === 'insufficient-stock') {
        shortfalls.push({
          productId: line.productId,
          name: line.name,
          reason: 'insufficient-stock',
          ...(issue.available === undefined ? {} : { available: issue.available }),
        });
      }
      // A price change is not a shortfall: the line already carries the current
      // price, and the shopper is quoted from that. It is shown, not refused.
    }
  }

  for (const removed of view.removed) {
    shortfalls.push({ productId: removed.productId, name: removed.name, reason: 'unlisted' });
  }

  return shortfalls;
}
