import { viewCart } from '@/modules/cart';
import { currentCartToken, currentStorefrontPrincipal } from '@/storefront';

/**
 * Returns a map of productId -> quantity for the active cart.
 * Used to hydrate 1-click ADD buttons and quantity steppers on browse cards.
 */
export async function getCartQuantities(): Promise<ReadonlyMap<string, number>> {
  const token = await currentCartToken();
  if (token === null) return new Map();

  try {
    const { context, principal } = await currentStorefrontPrincipal();
    if (context === null) return new Map();

    const cart = await viewCart(principal, token);
    if (cart === null) return new Map();

    return new Map(cart.lines.map((line) => [line.productId, line.qty]));
  } catch {
    return new Map();
  }
}
