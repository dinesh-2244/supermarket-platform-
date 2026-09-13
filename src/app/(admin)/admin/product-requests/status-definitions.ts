import { PRODUCT_REQUEST_STATUSES, type ProductRequestStatus } from '@/modules/product-requests';

export const PRODUCT_REQUEST_STATUS_STYLES: Readonly<Record<ProductRequestStatus, string>> = {
  NEW: 'bg-blue-100 text-blue-900 border-blue-300',
  REVIEWED: 'bg-sky-100 text-sky-900 border-sky-300',
  PLANNED: 'bg-amber-100 text-amber-900 border-amber-300',
  DECLINED: 'bg-rose-100 text-rose-900 border-rose-300',
  FULFILLED: 'bg-emerald-100 text-emerald-900 border-emerald-300',
};

export const PRODUCT_REQUEST_STATUS_LABELS: Readonly<Record<ProductRequestStatus, string>> = {
  NEW: 'New',
  REVIEWED: 'Reviewed',
  PLANNED: 'Planned',
  DECLINED: 'Declined',
  FULFILLED: 'Fulfilled',
};

export { PRODUCT_REQUEST_STATUSES, type ProductRequestStatus };
