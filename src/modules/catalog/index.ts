/**
 * `catalog` — public surface. Owns: Category, Product, ProductImage.
 *
 * This file is the ONLY entry point other modules and `app/` may import;
 * `service.ts`, `repo.ts` and `domain/` are module-private.
 */
export {
  findProductIdsBySku,
  productIdsSetUpForStore,
  addProductImage,
  createCategory,
  countProducts,
  createProduct,
  type CreateProductInput,
  deactivateCategory,
  deactivateProduct,
  getProduct,
  getProductBySku,
  getProductBySlug,
  listCategories,
  listProductImages,
  listProducts,
  moduleDescriptor,
  removeProductImage,
  reorderProductImages,
  searchIsAvailable,
  searchProducts,
  type SearchOptions,
  updateCategory,
  updateProduct,
  type UpdateProductInput,
  type CategoryRecord,
  type ImageRecord,
  type ProductRecord,
  type SearchHit,
} from './service';

export {
  assertSku,
  assertSlug,
  categoryTrail,
  descendantCategoryIds,
  depthOf,
  likePattern,
  MAX_SEARCH_QUERY_LENGTH,
  MIN_TRIGRAM_QUERY_LENGTH,
  slugify,
  type CategoryNode,
  type ModuleDescriptor,
} from './domain/index';
