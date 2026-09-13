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

/**
 * Appends or preserves the `?store=` query parameter for internal admin navigation.
 *
 * If `storeId` is missing/empty, returns `href` unchanged.
 * If `href` already has an explicit `store=` parameter, preserves it.
 * Otherwise, appends `store=${storeId}`, maintaining any other query parameters or hash.
 */
export function adminHref(href: string, storeId: string | null | undefined): string {
  if (!storeId) return href;
  const [baseAndQuery, hash] = href.split('#');
  const [path, query] = (baseAndQuery ?? '').split('?');
  const params = new URLSearchParams(query ?? '');
  if (!params.has('store')) {
    params.set('store', storeId);
  }
  const queryString = params.toString();
  const fullPath = queryString ? `${path}?${queryString}` : (path ?? '');
  return hash !== undefined ? `${fullPath}#${hash}` : fullPath;
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
    // Staff see their store's queue; only a manager can correct an order or
    // confirm a revised amount, and that is enforced by the grant table rather
    // than by hiding the link.
    { href: '/admin/orders', label: 'Orders' },
    { href: '/admin/inventory', label: 'Inventory' },
    { href: '/admin/listings', label: 'Listings & prices' },
    { href: '/admin/products', label: 'Products' },
    { href: '/admin/zones', label: 'Delivery areas' },
    { href: '/admin/stores', label: 'Stores & settings' },
    { href: '/admin/two-factor', label: 'Two-factor auth' },
    { href: '/admin/fulfillment', label: 'Fulfillment' },
    { href: '/admin/pos', label: 'POS Integration' },
  ];
  if (role === 'STORE_STAFF') return everyone;

  const managers: NavItem[] = [
    ...everyone,
    { href: '/admin/users', label: 'Users' },
    { href: '/admin/audit', label: 'Audit log' },
    { href: '/admin/reports', label: 'Reports & KPIs' },
    // Triage of shopper product requests (Phase 5.5) is `product-request:manage`,
    // a manager's grant; staff can still read them through the module.
    { href: '/admin/product-requests', label: 'Product requests' },
  ];
  if (role === 'STORE_MANAGER') return managers;

  return [...managers, { href: '/admin/categories', label: 'Categories' }];
}

/**
 * Where to send someone after signing in.
 *
 * Only a same-origin `/admin` path is accepted. `?next=https://evil.example/…`
 * was followed verbatim, which turns the real sign-in page into a convincing
 * launchpad for phishing — the victim genuinely authenticated on the real site
 * first, then landed somewhere else entirely. Absolute URLs, protocol-relative
 * `//host`, backslash tricks and anything that does not normalise to a path
 * under `/admin` all fall back to `/admin`.
 *
 * Parsing against a placeholder origin rather than pattern-matching the string
 * is what makes the encoded and traversal cases fall out for free.
 */
export function safeNextPath(next: string): string {
  const fallback = '/admin';
  if (next === '' || !next.startsWith('/')) return fallback;
  // `//evil.example` and `/\evil.example` are protocol-relative, not paths.
  if (next.startsWith('//') || next.startsWith('/\\')) return fallback;

  let url: URL;
  try {
    url = new URL(next, 'http://placeholder.invalid');
  } catch {
    return fallback;
  }
  if (url.origin !== 'http://placeholder.invalid') return fallback;

  const path = url.pathname;
  if (path !== '/admin' && !path.startsWith('/admin/')) return fallback;
  return `${path}${url.search}`;
}
