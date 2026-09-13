import { getPrisma, withTransaction, type Principal } from '@/modules/platform';
import { applyMovement } from '@/modules/inventory';
import { createOrder, type NewOrderLine } from '@/modules/orders';
import {
  acceptOrder,
  completePicking,
  markPacked,
  recordFinalBill,
  recordLinePick,
  startPicking,
} from '@/modules/fulfillment';

/**
 * Walk a real order through the Phase 5 lifecycle with the real services —
 * the fixture the packing, dispatch and delivery suites share. Nothing here
 * writes a status directly: every step is the use-case a staff member runs.
 */
const prisma = getPrisma();
const shopper: Principal = { kind: 'customer', customerId: null, storeId: null };

export const UNIT_PAISE = 12_500;
export const FEE_PAISE = 3_000;

export async function placeOrder(
  storeId: string,
  productId: string,
  customerId: string,
  qty = 2,
): Promise<string> {
  const store = await prisma.store.findUniqueOrThrow({ where: { id: storeId } });
  const lines: NewOrderLine[] = [
    {
      productId,
      nameSnapshot: 'Test Product',
      packSizeSnapshot: '1 kg',
      unitPricePaise: UNIT_PAISE,
      qtyOrdered: qty,
    },
  ];
  return withTransaction(async (tx) => {
    await applyMovement(tx, shopper, { storeId, productId, delta: -qty, reason: 'ORDER_PLACED' });
    const created = await createOrder(tx, {
      storeCode: store.code,
      customerId,
      storeId,
      contactName: 'Asha',
      contactPhone: '9000000001',
      deliveryAddressSnapshot: { line1: '1 Test Street', pincode: '560001' },
      deliverySlotStart: new Date('2026-03-01T10:00:00Z'),
      deliverySlotEnd: new Date('2026-03-01T11:00:00Z'),
      paymentMethod: 'COD',
      subtotalPaise: UNIT_PAISE * qty,
      deliveryFeePaise: FEE_PAISE,
      lines,
    });
    return created.id;
  });
}

export type WalkTarget = 'ACCEPTED' | 'PICKING' | 'PICKED' | 'BILLED_IN_POS' | 'PACKED';

/**
 * Drive `orderId` up to `target`. The bill is the estimate unless `bill`
 * says otherwise — pass `{ finalTotalPaise }` to make the variance flag fire.
 */
export async function walkTo(
  actor: Principal,
  orderId: string,
  target: WalkTarget,
  bill: { finalTotalPaise?: number } = {},
): Promise<void> {
  const steps: WalkTarget[] = ['ACCEPTED', 'PICKING', 'PICKED', 'BILLED_IN_POS', 'PACKED'];
  const upTo = steps.indexOf(target);
  await acceptOrder(actor, orderId);
  if (upTo < 1) return;
  await startPicking(actor, orderId);
  if (upTo < 2) return;
  const lines = await prisma.orderLine.findMany({ where: { orderId } });
  for (const line of lines) {
    await recordLinePick(actor, orderId, line.id, {
      outcome: 'PICKED',
      qtyPicked: line.qtyOrdered,
    });
  }
  await completePicking(actor, orderId);
  if (upTo < 3) return;
  const order = await prisma.order.findUniqueOrThrow({ where: { id: orderId } });
  await recordFinalBill(actor, orderId, {
    billNumber: `POS-${orderId.slice(0, 8)}`,
    finalTotalPaise: bill.finalTotalPaise ?? order.estimatedTotalPaise,
  });
  if (upTo < 4) return;
  await markPacked(actor, orderId);
}
