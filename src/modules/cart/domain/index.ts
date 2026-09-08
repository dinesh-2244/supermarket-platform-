/**
 * Pure domain logic for `cart` — no I/O, no Prisma, no framework types.
 *
 * The rule this module exists to hold: **nothing about a cart line is trusted
 * from the client.** Quantity is the only thing a shopper supplies; price,
 * listing and availability are read from the store on every view and every
 * mutation, and what the client last saw is only ever compared against, never
 * used (arch §10).
 */

/** Static description of what this module owns and may depend on (§4). */
export interface ModuleDescriptor {
  readonly name: string;
  readonly owns: string;
  readonly dependsOn: readonly string[];
  readonly emits: readonly string[];
}

export const descriptor: ModuleDescriptor = {
  name: 'cart',
  owns: 'Cart, CartItem, revalidation against price and stock',
  dependsOn: ['platform', 'catalog', 'pricing', 'inventory', 'stores'],
  emits: [],
};

/**
 * The most of one product a shopper may put in a basket.
 *
 * Not a stock check — that is per store and changes minute to minute. This is
 * the "fat finger or script" bound: nobody orders 500 bags of rice for home
 * delivery, and an unbounded integer in a quantity field is how a cart page
 * ends up rendering a total nobody can read.
 */
export const MAX_LINE_QUANTITY = 99;

/** Quantity is the one number the client supplies, so it is the one we vet. */
export function assertQuantity(qty: number): void {
  if (!Number.isInteger(qty)) {
    throw new RangeError('Quantity must be a whole number');
  }
  if (qty < 1) {
    throw new RangeError('Quantity must be at least 1 — use remove to take an item out');
  }
  if (qty > MAX_LINE_QUANTITY) {
    throw new RangeError(`Quantity may not be more than ${String(MAX_LINE_QUANTITY)}`);
  }
}

/**
 * Why a line is not simply fine.
 *
 * These are *notices*, not corrections. The cart deliberately does not silently
 * cap a quantity to what is in stock: a shopper who asked for 12 and can have 8
 * must decide whether 8 is worth having, and a basket that quietly edited itself
 * is one nobody can trust at checkout.
 */
export type LineIssue =
  | {
      readonly kind: 'price-changed';
      readonly oldPricePaise: number;
      readonly newPricePaise: number;
    }
  | { readonly kind: 'insufficient-stock'; readonly available: number }
  | { readonly kind: 'out-of-stock' };

/** Why a line is gone. Removal is the one correction the cart makes itself. */
export type RemovalReason = 'unlisted' | 'discontinued';

export interface RemovedLine {
  readonly productId: string;
  readonly name: string;
  readonly reason: RemovalReason;
}

export interface CartLine {
  readonly productId: string;
  readonly name: string;
  readonly slug: string;
  readonly brand: string | null;
  readonly packSize: string;
  readonly qty: number;
  /** The store's price **now**, never the snapshot the client last saw. */
  readonly unitPricePaise: number;
  readonly mrpPaise: number;
  readonly lineTotalPaise: number;
  readonly issues: readonly LineIssue[];
}

export interface CartTotals {
  readonly subtotalPaise: number;
  readonly itemCount: number;
  readonly deliveryFeePaise: number;
  readonly minOrderPaise: number;
  /** Displayed, never enforced — enforcement is checkout, which is Phase 4. */
  readonly meetsMinimum: boolean;
}

/**
 * Add up what is actually in the basket.
 *
 * A line flagged out of stock still counts towards the subtotal: it is still in
 * the basket, and pretending otherwise would show a total that changes the
 * moment the shopper fixes the line. Checkout is where an unfillable line stops
 * being someone's problem to look at and starts being a rejection.
 */
export function totalsFor(
  lines: readonly CartLine[],
  settings: { deliveryFeePaise: number; minOrderPaise: number },
): CartTotals {
  const subtotalPaise = lines.reduce((sum, line) => sum + line.lineTotalPaise, 0);
  return {
    subtotalPaise,
    itemCount: lines.reduce((sum, line) => sum + line.qty, 0),
    deliveryFeePaise: settings.deliveryFeePaise,
    minOrderPaise: settings.minOrderPaise,
    meetsMinimum: subtotalPaise >= settings.minOrderPaise,
  };
}

/**
 * What has to be said about one line, given what the store says now.
 *
 * Written as a pure function of (snapshot, current price, available stock) so
 * the interesting cases — a price that moved *and* stock that ran short on the
 * same line — are testable without a database.
 */
export function issuesFor(input: {
  snapshotPricePaise: number;
  currentPricePaise: number;
  qty: number;
  available: number;
}): readonly LineIssue[] {
  const issues: LineIssue[] = [];

  if (input.snapshotPricePaise !== input.currentPricePaise) {
    issues.push({
      kind: 'price-changed',
      oldPricePaise: input.snapshotPricePaise,
      newPricePaise: input.currentPricePaise,
    });
  }

  if (input.available <= 0) {
    issues.push({ kind: 'out-of-stock' });
  } else if (input.available < input.qty) {
    issues.push({ kind: 'insufficient-stock', available: input.available });
  }

  return issues;
}
