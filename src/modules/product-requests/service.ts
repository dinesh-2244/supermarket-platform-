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
  ConflictError,
  getPrisma,
  LOCK_NAMESPACE,
  NotFoundError,
  RateLimitError,
  tryAdvisoryXactLock,
  ValidationError,
  withTransaction,
  writeAuditLog,
  type Principal,
} from '../platform/index';
import { getStore } from '../stores/index';
import {
  assertRequestTransition,
  descriptor,
  INTAKE_LIMITS,
  PRODUCT_REQUEST_STATUSES,
  productKeyOf,
  submitterKeyOf,
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
 * staff cannot file requests in a shopper's name.
 *
 * It is also a public write, so it is capped (`INTAKE_LIMITS`): a handful per
 * submitter per day, a bounded number per store per window, and the same ask
 * twice from the same person is a double-submit. The counts and the insert run
 * under the store's intake lock so two submissions cannot both count N and
 * both commit the N+1st; the lock is *tried*, not queued for, because a flood
 * that is made to wait for a lock holds database connections while it waits —
 * a submitter who finds the store busy is told to try again in a moment.
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
  const submitterKey = submitterKeyOf({
    customerId: principal.customerId,
    customerPhone: submission.customerPhone,
    clientKey: input.clientKey,
  });
  const productKey = productKeyOf(submission.productName);
  const store = await getStore(principal, principal.storeId);
  if (!store.isActive) {
    throw new ValidationError('That store is not taking requests right now', {
      storeId: store.id,
    });
  }

  return withTransaction(async (tx) => {
    if (!(await tryAdvisoryXactLock(tx, LOCK_NAMESPACE.productRequestIntake, store.id))) {
      throw new RateLimitError('The store is busy taking requests — please try again in a moment', {
        storeId: store.id,
      });
    }
    const now = Date.now();
    if (
      await repo.hasRecentDuplicate(
        tx,
        store.id,
        submitterKey,
        productKey,
        new Date(now - INTAKE_LIMITS.duplicate.windowMs),
      )
    ) {
      throw new ConflictError('You have already asked us for that — it is on the list', {
        productName: submission.productName,
      });
    }
    const mine = await repo.countRecentForSubmitter(
      tx,
      store.id,
      submitterKey,
      new Date(now - INTAKE_LIMITS.perSubmitter.windowMs),
    );
    if (mine >= INTAKE_LIMITS.perSubmitter.max) {
      throw new RateLimitError('That is plenty of requests for today — thank you, we have them', {
        limit: INTAKE_LIMITS.perSubmitter.max,
      });
    }
    const stores = await repo.countRecentForStore(
      tx,
      store.id,
      new Date(now - INTAKE_LIMITS.perStore.windowMs),
    );
    if (stores >= INTAKE_LIMITS.perStore.max) {
      throw new RateLimitError('The store is busy taking requests — please try again later', {
        limit: INTAKE_LIMITS.perStore.max,
      });
    }

    return repo.insertRequest(
      tx,
      store.id,
      submission,
      { productKey, submitterKey },
      { actorType: 'CUSTOMER', actorId: principal.customerId },
    );
  });
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
