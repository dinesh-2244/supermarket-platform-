/**
 * Use-cases for `product-requests` (Phase 5.5): a shopper asks the store they
 * are browsing for a product it does not carry; a manager triages it.
 *
 * Intake and triage only. Nothing here reads or writes stock, orders, prices
 * or the POS, and a request never turns into anything else by itself — if the
 * shop decides to stock it, that is a catalogue change made through `catalog`
 * and `pricing` as usual, after which the request is marked `FULFILLED`.
 */
import {
  assertAuthorized,
  AuthzError,
  getPrisma,
  NotFoundError,
  ValidationError,
  withTransaction,
  writeAuditLog,
  type Principal,
} from '../platform/index';
import { getStore } from '../stores/index';
import {
  assertRequestTransition,
  descriptor,
  PRODUCT_REQUEST_STATUSES,
  validateSubmission,
  type ModuleDescriptor,
  type ProductRequestStatus,
  type SubmissionInput,
} from './domain/index';
import * as repo from './repo';

/** What this module owns and is allowed to depend on (§4). */
export function moduleDescriptor(): ModuleDescriptor {
  return descriptor;
}

export type { ProductRequestRow, ProductRequestHistoryRow } from './repo';

/** One request with its full triage trail, for the detail drawer. */
export interface ProductRequestDetail extends repo.ProductRequestRow {
  readonly history: readonly repo.ProductRequestHistoryRow[];
}

export interface ProductRequestCounts {
  readonly storeId: string;
  readonly total: number;
  /** Every status is present, zero where the store has none. */
  readonly byStatus: Readonly<Record<ProductRequestStatus, number>>;
}

/**
 * A shopper asks for a product.
 *
 * No account needed — the same trust level as checkout's contact capture — but
 * it must be a *shopper*: the store comes off the principal, which is the store
 * their delivery area resolved to, so a form cannot address another shop, and
 * staff cannot file requests in a shopper's name. The request and its opening
 * history row land in one transaction.
 */
export async function submitProductRequest(
  principal: Principal,
  input: SubmissionInput,
): Promise<repo.ProductRequestRow> {
  if (principal.kind !== 'customer') {
    throw new AuthzError('Only a shopper can request a product', {});
  }
  if (principal.storeId === null) {
    throw new ValidationError('Choose your delivery area first, so we know which store to ask', {});
  }
  const submission = validateSubmission(input);
  const store = await getStore(principal, principal.storeId);
  if (!store.isActive) {
    throw new ValidationError('That store is not taking requests right now', {
      storeId: store.id,
    });
  }

  return withTransaction((tx) =>
    repo.insertRequest(tx, store.id, submission, {
      actorType: 'CUSTOMER',
      actorId: principal.customerId,
    }),
  );
}

/**
 * The store's requests, newest first — for the admin triage screen.
 *
 * `product-request:read` is checked against the store asked for, and the
 * repository applies the store scope on top, for the same belt-and-braces
 * reason `orders.queueForStore` does.
 */
export async function listProductRequests(
  principal: Principal,
  storeId: string,
  filter: { statuses?: readonly ProductRequestStatus[]; limit?: number } = {},
): Promise<repo.ProductRequestRow[]> {
  assertAuthorized(principal, 'product-request:read', { type: 'ProductRequest', storeId });
  return repo.listForPrincipal(getPrisma(), principal, storeId, filter);
}

/**
 * One request in full. A wrong-store id reads as **not found** rather than
 * forbidden: telling somebody a request exists but is not theirs is itself a
 * disclosure.
 */
export async function getProductRequest(
  principal: Principal,
  requestId: string,
): Promise<ProductRequestDetail | null> {
  const request = await repo.findForPrincipal(getPrisma(), principal, requestId);
  if (request === null) return null;
  assertAuthorized(principal, 'product-request:read', {
    type: 'ProductRequest',
    id: requestId,
    storeId: request.storeId,
  });
  return request;
}

/** Exact per-status counts for the store — a `COUNT`, not a counted list (AD9). */
export async function productRequestCounts(
  principal: Principal,
  storeId: string,
): Promise<ProductRequestCounts> {
  assertAuthorized(principal, 'product-request:read', { type: 'ProductRequest', storeId });
  const cells = await repo.countByStatus(getPrisma(), principal, storeId);
  const byStatus = Object.fromEntries(
    PRODUCT_REQUEST_STATUSES.map((status) => [status, 0]),
  ) as Record<ProductRequestStatus, number>;
  let total = 0;
  for (const cell of cells) {
    byStatus[cell.status] += cell.count;
    total += cell.count;
  }
  return { storeId, total, byStatus };
}

/**
 * Triage: move a request to its next state.
 *
 * Manager-or-above in the request's own store (`product-request:manage`). The
 * row is locked for the transaction, the step is checked against the triage
 * table, and the status change, its history row and its audit row are written
 * together — a refusal rolls all of it back. Same shape as `orders.cancelByStore`.
 */
export async function updateProductRequestStatus(
  principal: Principal,
  requestId: string,
  toStatus: ProductRequestStatus,
  note?: string | null,
): Promise<repo.ProductRequestRow> {
  const trimmed = (note ?? '').trim();
  const recorded = trimmed.length === 0 ? null : trimmed;

  return withTransaction(async (tx) => {
    const request = await repo.lockRequest(tx, requestId);
    // Not found, not forbidden, for a request outside the principal's stores.
    if (request === null || !(await repo.findForPrincipal(tx, principal, requestId))) {
      throw new NotFoundError('Product request not found', { requestId });
    }
    assertAuthorized(principal, 'product-request:manage', {
      type: 'ProductRequest',
      id: requestId,
      storeId: request.storeId,
    });
    assertRequestTransition(request.status, toStatus, recorded);

    const updated = await repo.setStatus(tx, requestId, toStatus);
    await repo.insertHistory(tx, {
      requestId,
      fromStatus: request.status,
      toStatus,
      actorType:
        principal.kind === 'user' ? 'USER' : principal.kind === 'customer' ? 'CUSTOMER' : 'SYSTEM',
      actorId:
        principal.kind === 'user'
          ? principal.userId
          : principal.kind === 'customer'
            ? principal.customerId
            : null,
      note: recorded,
    });
    await writeAuditLog(tx, {
      principal,
      action: 'update',
      entityType: 'ProductRequest',
      entityId: requestId,
      storeId: request.storeId,
      before: { status: request.status },
      after: { status: toStatus, note: recorded },
    });
    return updated;
  });
}
