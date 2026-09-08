import type { Metadata } from 'next';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { currentCustomer } from '@/storefront';
import { Card, Empty, PageHeading } from '../../ui';

export const metadata: Metadata = { title: 'Your orders' };

/**
 * Order history — a stub, and honestly labelled as one (D7).
 *
 * There are no orders to list because nothing in Phase 3 creates one: there is
 * no checkout, and `Order` is Phase 4's to write. The page exists now so the
 * account area has the shape it will keep, and so the empty state is a real
 * empty state rather than a missing route.
 */
export default async function OrderHistoryPage(): Promise<React.ReactElement> {
  if ((await currentCustomer()) === null) redirect('/account/sign-in');

  return (
    <>
      <PageHeading title="Your orders" />
      <Card>
        <Empty>No orders yet.</Empty>
        <p className="text-center text-sm text-slate-600">
          Ordering arrives in the next release. Until then you can{' '}
          <Link href="/" className="text-emerald-800 underline">
            fill a basket
          </Link>{' '}
          and it will be waiting.
        </p>
      </Card>
    </>
  );
}
