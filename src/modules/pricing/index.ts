/**
 * `pricing` — public surface. Owns: StoreProduct price fields, PriceChange.
 *
 * This file is the ONLY entry point other modules and `app/` may import;
 * `service.ts`, `repo.ts` and `domain/` are module-private.
 */
export {
  discountBp,
  getListing,
  listListedProductIds,
  listListings,
  listPriceHistory,
  moduleDescriptor,
  setListed,
  setPrice,
  type SetPriceInput,
  type ListListingsOptions,
  type PriceChangeRecord,
  type StoreProductRecord,
} from './service';

export { assertPrice, priceChanged, type ModuleDescriptor, type PriceInput } from './domain/index';
