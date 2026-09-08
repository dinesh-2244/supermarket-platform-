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

/**
 * What one mutation's revalidation found, kept until the next one runs.
 *
 * Structured, not prose: product ids, names and the old/new prices, with the
 * wording built in the app layer where the rest of the copy lives. Storing the
 * sentence would put UI language in a database column and, worse, would make the
 * record only as complete as whatever rendered it.
 */
export interface CartNotice {
  /** When the mutation ran, so a stale notice cannot follow a shopper around. */
  readonly at: string;
  readonly removed: readonly RemovedLine[];
  readonly changed: readonly NoticedLine[];
}

export interface NoticedLine {
  readonly productId: string;
  readonly name: string;
  readonly issues: readonly LineIssue[];
}

/** How long a notice is worth showing. Past this it is history, not news. */
export const CART_NOTICE_TTL_MS = 60_000;

/**
 * Read back a notice written by an earlier request.
 *
 * The column is `Json`, which is `unknown` as far as the type system is
 * concerned, and a row that predates a change to this shape is a real
 * possibility — so every field is checked rather than asserted. Anything that
 * does not parse is simply no notice, which is the safe direction: a shopper
 * sees one message fewer, never a wrong one.
 */
export function parseCartNotice(value: unknown, now: number = Date.now()): CartNotice | null {
  if (typeof value !== 'object' || value === null) return null;
  const raw = value as Record<string, unknown>;

  const at = typeof raw.at === 'string' ? raw.at : '';
  const stamped = Date.parse(at);
  if (Number.isNaN(stamped) || now - stamped > CART_NOTICE_TTL_MS) return null;

  const removed = asArray(raw.removed).flatMap(toRemovedLine);
  const changed = asArray(raw.changed).flatMap(toNoticedLine);
  if (removed.length === 0 && changed.length === 0) return null;

  return { at, removed, changed };
}

/** The notice a revalidation produced, or `null` when it found nothing to say. */
export function noticeFrom(
  input: { removed: readonly RemovedLine[]; lines: readonly CartLine[] },
  at: Date = new Date(),
): CartNotice | null {
  const changed = input.lines
    .filter((line) => line.issues.length > 0)
    .map((line) => ({ productId: line.productId, name: line.name, issues: line.issues }));

  if (input.removed.length === 0 && changed.length === 0) return null;
  return { at: at.toISOString(), removed: [...input.removed], changed };
}

function asArray(value: unknown): readonly unknown[] {
  return Array.isArray(value) ? value : [];
}

function toRemovedLine(value: unknown): RemovedLine[] {
  if (typeof value !== 'object' || value === null) return [];
  const raw = value as Record<string, unknown>;
  if (typeof raw.productId !== 'string' || typeof raw.name !== 'string') return [];
  if (raw.reason !== 'unlisted' && raw.reason !== 'discontinued') return [];
  return [{ productId: raw.productId, name: raw.name, reason: raw.reason }];
}

function toNoticedLine(value: unknown): NoticedLine[] {
  if (typeof value !== 'object' || value === null) return [];
  const raw = value as Record<string, unknown>;
  if (typeof raw.productId !== 'string' || typeof raw.name !== 'string') return [];
  const issues = asArray(raw.issues).flatMap(toIssue);
  if (issues.length === 0) return [];
  return [{ productId: raw.productId, name: raw.name, issues }];
}

function toIssue(value: unknown): LineIssue[] {
  if (typeof value !== 'object' || value === null) return [];
  const raw = value as Record<string, unknown>;
  if (
    raw.kind === 'price-changed' &&
    typeof raw.oldPricePaise === 'number' &&
    typeof raw.newPricePaise === 'number'
  ) {
    return [
      {
        kind: 'price-changed',
        oldPricePaise: raw.oldPricePaise,
        newPricePaise: raw.newPricePaise,
      },
    ];
  }
  if (raw.kind === 'insufficient-stock' && typeof raw.available === 'number') {
    return [{ kind: 'insufficient-stock', available: raw.available }];
  }
  if (raw.kind === 'out-of-stock') return [{ kind: 'out-of-stock' }];
  return [];
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
