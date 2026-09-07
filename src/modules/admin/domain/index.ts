/**
 * Pure domain logic for `admin` — no I/O, no Prisma, no framework types.
 *
 * `admin` holds **read-models and view shaping only**. Every business rule lives
 * in the module that owns it; this module calls those modules through their
 * `index.ts` and arranges what comes back for a screen (§4, D7).
 */

/** Static description of what this module owns and may depend on (§4). */
export interface ModuleDescriptor {
  readonly name: string;
  readonly owns: string;
  readonly dependsOn: readonly string[];
  readonly emits: readonly string[];
}

/**
 * `dependsOn` is what architecture §4 *permits* ("all of the above via
 * `index.ts`"), not the subset any one phase happens to use. Phase 2 calls
 * platform, identity, stores, catalog, pricing and inventory; the customer,
 * order and fulfillment screens arrive in Phase 4/5 and need no change here.
 */
export const descriptor: ModuleDescriptor = {
  name: 'admin',
  owns: 'Back-office read models and BFF (no domain rules)',
  dependsOn: [
    'platform',
    'stores',
    'catalog',
    'pricing',
    'inventory',
    'identity',
    'customers',
    'orders',
    'fulfillment',
  ],
  emits: [],
};

/** Rupees for display only. Money is integer paise everywhere else (§17). */
export function formatPaise(paise: number): string {
  const sign = paise < 0 ? '-' : '';
  const abs = Math.abs(paise);
  return `${sign}₹${(abs / 100).toLocaleString('en-IN', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

/** A signed movement, so a ledger reads at a glance. */
export function formatDelta(delta: number): string {
  return delta > 0 ? `+${String(delta)}` : String(delta);
}

export function formatDateTime(value: Date | null): string {
  if (value === null) return '—';
  return value.toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' });
}

/** The nav entries a principal may actually reach, so nothing dead is shown. */
export interface NavItem {
  readonly href: string;
  readonly label: string;
}

export function navigationFor(
  role: 'SUPER_ADMIN' | 'STORE_MANAGER' | 'STORE_STAFF',
): readonly NavItem[] {
  const everyone: NavItem[] = [
    { href: '/admin', label: 'Overview' },
    { href: '/admin/inventory', label: 'Inventory' },
    { href: '/admin/listings', label: 'Listings & prices' },
    { href: '/admin/products', label: 'Products' },
    { href: '/admin/zones', label: 'Delivery areas' },
    { href: '/admin/stores', label: 'Stores & settings' },
  ];
  if (role === 'STORE_STAFF') return everyone;

  const managers: NavItem[] = [
    ...everyone,
    { href: '/admin/users', label: 'Users' },
    { href: '/admin/audit', label: 'Audit log' },
  ];
  if (role === 'STORE_MANAGER') return managers;

  return [...managers, { href: '/admin/categories', label: 'Categories' }];
}
