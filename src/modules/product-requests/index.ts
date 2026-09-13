/**
 * `product-requests` — public surface. Owns: ProductRequest, ProductRequestStatusHistory.
 *
 * This file is the ONLY entry point other modules and `app/` may import;
 * `service.ts`, `repo.ts` and `domain/` are module-private.
 */
export {
  getProductRequest,
  listProductRequests,
  moduleDescriptor,
  productRequestCounts,
  submitProductRequest,
  updateProductRequestStatus,
  type ProductRequestCounts,
  type ProductRequestDetail,
  type ProductRequestHistoryRow,
  type ProductRequestRow,
} from './service';

export {
  PRODUCT_REQUEST_STATUSES,
  REQUEST_TRANSITIONS,
  type ModuleDescriptor,
  type ProductRequestStatus,
  type Submission,
  type SubmissionInput,
} from './domain/index';
