import { describe, expect, it, vi } from 'vitest';
import { editProductAction, setPriceAction } from '@/app/(admin)/admin/actions';
import { parseRupeesToPaise } from '@/app/(admin)/admin/price-parser';
import * as catalog from '@/modules/catalog';
import * as pricing from '@/modules/pricing';

vi.mock('@/auth', () => ({
  requirePrincipal: vi.fn().mockResolvedValue({
    kind: 'user',
    userId: 'user-admin',
    role: 'SUPER_ADMIN',
  }),
  signIn: vi.fn(),
  signOut: vi.fn(),
}));

vi.mock('next/cache', () => ({
  revalidatePath: vi.fn(),
}));

vi.mock('@/modules/pricing', () => ({
  setPrice: vi.fn().mockResolvedValue({}),
  setListed: vi.fn().mockResolvedValue({}),
}));

vi.mock('@/modules/catalog', () => ({
  updateProduct: vi.fn().mockResolvedValue({ id: 'p1', name: 'Test Product', isActive: true }),
  deactivateProduct: vi.fn().mockResolvedValue({ id: 'p1', name: 'Test Product', isActive: false }),
  addProductImage: vi.fn(),
  removeProductImage: vi.fn(),
  reorderProductImages: vi.fn(),
  listProductImages: vi.fn(),
  createProduct: vi.fn(),
  createCategory: vi.fn(),
  updateCategory: vi.fn(),
}));

describe('M1: Strict money parsing for pricing actions', () => {
  const OSCAR_PROBES = [
    { input: '10.999', reason: 'rejected (3 decimals)' },
    { input: '0.005', reason: 'rejected (3 decimals, no silent rounding)' },
    { input: '1e2', reason: 'rejected (scientific notation)' },
    { input: '0x10', reason: 'rejected (hex notation)' },
    { input: '90071992547409.91', reason: 'rejected (out of safe integer range)' },
  ];

  describe('parseRupeesToPaise helper', () => {
    it.each(OSCAR_PROBES)('rejects Oscar probe: $input ($reason)', ({ input }) => {
      expect(() => parseRupeesToPaise(input, 'mrp', 'MRP')).toThrow();
    });

    it('rejects negative rupee values', () => {
      expect(() => parseRupeesToPaise('-10', 'mrp', 'MRP')).toThrow();
      expect(() => parseRupeesToPaise('-0.01', 'mrp', 'MRP')).toThrow();
    });

    it('rejects non-numeric garbage', () => {
      expect(() => parseRupeesToPaise('abc', 'mrp', 'MRP')).toThrow();
      expect(() => parseRupeesToPaise('10.5.5', 'mrp', 'MRP')).toThrow();
    });

    it('correctly converts valid rupee amounts to integer paise without precision loss', () => {
      expect(parseRupeesToPaise('10', 'mrp')).toBe(1000);
      expect(parseRupeesToPaise('10.5', 'mrp')).toBe(1050);
      expect(parseRupeesToPaise('10.50', 'mrp')).toBe(1050);
      expect(parseRupeesToPaise('0.05', 'mrp')).toBe(5);
      expect(parseRupeesToPaise('0.99', 'mrp')).toBe(99);
      expect(parseRupeesToPaise('1500.25', 'mrp')).toBe(150025);
    });
  });

  describe('setPriceAction action-level tests', () => {
    it.each(OSCAR_PROBES)(
      'rejects MRP probe at action boundary: $input ($reason)',
      async ({ input }) => {
        const form = new FormData();
        form.set('storeId', 'store-1');
        form.set('productId', 'prod-1');
        form.set('mrp', input);
        form.set('sellingPrice', '10.00');

        const result = await setPriceAction(undefined, form);
        expect(result.startsWith('!')).toBe(true);
        expect(result).toMatch(/(valid non-negative rupee amount|out of range)/i);
      },
    );

    it.each(OSCAR_PROBES)(
      'rejects Selling Price probe at action boundary: $input ($reason)',
      async ({ input }) => {
        const form = new FormData();
        form.set('storeId', 'store-1');
        form.set('productId', 'prod-1');
        form.set('mrp', '100.00');
        form.set('sellingPrice', input);

        const result = await setPriceAction(undefined, form);
        expect(result.startsWith('!')).toBe(true);
        expect(result).toMatch(/(valid non-negative rupee amount|out of range)/i);
      },
    );

    it('successfully accepts valid 2-decimal rupee prices and converts to paise for setPrice', async () => {
      const form = new FormData();
      form.set('storeId', 'store-1');
      form.set('productId', 'prod-1');
      form.set('mrp', '150.50');
      form.set('sellingPrice', '140.25');

      const result = await setPriceAction(undefined, form);
      expect(result).toBe('Price saved.');
      expect(pricing.setPrice).toHaveBeenCalledWith(
        expect.anything(),
        'store-1',
        'prod-1',
        expect.objectContaining({
          mrpPaise: 15050,
          sellingPricePaise: 14025,
        }),
      );
    });
  });
});

describe('M2: Product edit drawer uncheck-to-deactivate', () => {
  it('calls deactivateProduct when isActive checkbox is absent (unchecked HTML form)', async () => {
    vi.clearAllMocks();
    const form = new FormData();
    form.set('productId', 'prod-1');
    form.set('name', 'Updated Name');
    form.set('brand', 'Updated Brand');
    form.set('packSize', '500 g');
    form.set('categoryId', 'cat-1');
    // Note: in HTML, an unchecked checkbox sends no field at all.

    const result = await editProductAction(undefined, form);
    expect(result).toContain('saved');
    expect(catalog.updateProduct).toHaveBeenCalledWith(
      expect.anything(),
      'prod-1',
      expect.objectContaining({
        name: 'Updated Name',
        brand: 'Updated Brand',
        packSize: '500 g',
        categoryId: 'cat-1',
      }),
    );
    expect(catalog.deactivateProduct).toHaveBeenCalledWith(expect.anything(), 'prod-1');
  });

  it('preserves active status when isActive checkbox is present (checked HTML form)', async () => {
    vi.clearAllMocks();
    const form = new FormData();
    form.set('productId', 'prod-1');
    form.set('name', 'Updated Name');
    form.set('brand', 'Updated Brand');
    form.set('packSize', '500 g');
    form.set('categoryId', 'cat-1');
    form.set('isActive', 'on');

    const result = await editProductAction(undefined, form);
    expect(result).toContain('saved');
    expect(catalog.updateProduct).toHaveBeenCalledWith(
      expect.anything(),
      'prod-1',
      expect.objectContaining({
        name: 'Updated Name',
        isActive: true,
      }),
    );
    expect(catalog.deactivateProduct).not.toHaveBeenCalled();
  });
});
