/**
 * `cart` — public surface. Owns: Cart, CartItem, revalidation against price and stock.
 *
 * This file is the ONLY entry point other modules and `app/` may import;
 * `service.ts`, `repo.ts` and `domain/` are module-private.
 */
export {
  addItem,
  adoptCart,
  cartItemCount,
  ensureCart,
  moduleDescriptor,
  rebuildForStore,
  removeItem,
  setQuantity,
  viewCart,
  type AddItemInput,
  type CartRecord,
  type CartView,
} from './service';

export {
  assertQuantity,
  issuesFor,
  MAX_LINE_QUANTITY,
  totalsFor,
  type CartLine,
  type CartTotals,
  type LineIssue,
  type ModuleDescriptor,
  type RemovalReason,
  type RemovedLine,
} from './domain/index';
