import React from 'react';
import {
  PRODUCT_REQUEST_STATUS_STYLES,
  PRODUCT_REQUEST_STATUS_LABELS,
  type ProductRequestStatus,
} from './status-definitions';

export { PRODUCT_REQUEST_STATUS_STYLES, PRODUCT_REQUEST_STATUS_LABELS, type ProductRequestStatus };

export function ProductRequestStatusBadge({
  status,
}: {
  status: ProductRequestStatus;
}): React.ReactElement {
  const style = PRODUCT_REQUEST_STATUS_STYLES[status];
  const label = PRODUCT_REQUEST_STATUS_LABELS[status];

  return (
    <span
      className={`inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-bold ${style}`}
    >
      {label}
    </span>
  );
}
