// MUST NOT COMPILE. See tests/unit/transaction-handle.test.ts (R3).
//
// `Prisma.TransactionClient` is a structural `Omit<PrismaClient, …>`, so before
// the brand every one of these typechecked — and every one of them takes a row
// lock inside an implicit single-statement transaction that ends before the
// caller can act on it.
import { getPrisma, selectForUpdate, selectManyForUpdate } from '../../src/modules/platform/index';
import { auditedExecutor } from '../../src/modules/inventory/repo';

export const lockWithRootClient = () => selectForUpdate(getPrisma(), 'store', 'product');

export const lockManyWithRootClient = () => selectManyForUpdate(getPrisma(), 'store', ['product']);

export const auditedWriteWithRootClient = () => auditedExecutor(getPrisma());
