// MUST COMPILE. The legal path: a handle minted by `withTransaction`.
import {
  selectForUpdate,
  selectManyForUpdate,
  withTransaction,
} from '../../src/modules/platform/index';
import { auditedExecutor } from '../../src/modules/inventory/repo';

export const lockInsideTransaction = () =>
  withTransaction(async (tx) => {
    const many = await selectManyForUpdate(tx, 'store', ['product']);
    void auditedExecutor(tx);
    return [await selectForUpdate(tx, 'store', 'product'), many] as const;
  });
