import fs from 'node:fs';
import path from 'node:path';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { updateSettingsAction } from '@/app/(admin)/admin/actions';
import * as stores from '@/modules/stores';

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

vi.mock('@/modules/stores', () => ({
  updateSettings: vi.fn().mockResolvedValue({}),
  createStore: vi.fn(),
  updateStore: vi.fn(),
  createZone: vi.fn(),
  updateZone: vi.fn(),
  createArea: vi.fn(),
  updateArea: vi.fn(),
}));

describe('Admin store settings rupee UX (updateSettingsAction)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  const baseFormData = (): FormData => {
    const form = new FormData();
    form.set('storeId', 'store-1');
    form.set('deliveryFee', '200');
    form.set('minOrder', '500');
    form.set('slotLengthMinutes', '60');
    form.set('slotCapacity', '10');
    form.set('priceVariancePercentBp', '500');
    form.set('priceVarianceAbsCap', '50');
    form.set('lowStockThreshold', '5');
    form.set('substitutionPolicy', 'NONE');
    return form;
  };

  const OSCAR_PROBES = [
    { input: '10.999', reason: 'rejected (3 decimals)' },
    { input: '0.005', reason: 'rejected (3 decimals, no silent rounding)' },
    { input: '1e2', reason: 'rejected (scientific notation)' },
    { input: '0x10', reason: 'rejected (hex notation)' },
    { input: '90071992547409.91', reason: 'rejected (out of safe integer range)' },
    { input: '-10', reason: 'rejected (negative amount)' },
    { input: 'abc', reason: 'rejected (non-numeric string)' },
  ];

  describe('Rupee input conversion to integer paise', () => {
    it('converts valid rupee amounts (whole and 2-decimal) to integer paise', async () => {
      const form = baseFormData();
      form.set('deliveryFee', '200.50');
      form.set('minOrder', '150');
      form.set('priceVarianceAbsCap', '25.75');

      const result = await updateSettingsAction(undefined, form);
      expect(result).toBe('Settings saved.');
      expect(stores.updateSettings).toHaveBeenCalledWith(
        expect.anything(),
        'store-1',
        expect.objectContaining({
          deliveryFeePaise: 20050,
          minOrderPaise: 15000,
          priceVarianceAbsCapPaise: 2575,
          slotLengthMinutes: 60,
          slotCapacity: 10,
          priceVariancePercentBp: 500,
          lowStockThreshold: 5,
        }),
      );
    });

    it('handles zero rupee amounts correctly', async () => {
      const form = baseFormData();
      form.set('deliveryFee', '0.00');
      form.set('minOrder', '0');
      form.set('priceVarianceAbsCap', '0');

      const result = await updateSettingsAction(undefined, form);
      expect(result).toBe('Settings saved.');
      expect(stores.updateSettings).toHaveBeenCalledWith(
        expect.anything(),
        'store-1',
        expect.objectContaining({
          deliveryFeePaise: 0,
          minOrderPaise: 0,
          priceVarianceAbsCapPaise: 0,
        }),
      );
    });

    it('maintains backwards compatibility when raw paise keys are supplied', async () => {
      const form = new FormData();
      form.set('storeId', 'store-1');
      form.set('deliveryFeePaise', '25000');
      form.set('minOrderPaise', '30000');
      form.set('priceVarianceAbsCapPaise', '4000');
      form.set('slotLengthMinutes', '30');
      form.set('slotCapacity', '5');
      form.set('priceVariancePercentBp', '200');
      form.set('lowStockThreshold', '2');
      form.set('substitutionPolicy', 'ASK_CUSTOMER');

      const result = await updateSettingsAction(undefined, form);
      expect(result).toBe('Settings saved.');
      expect(stores.updateSettings).toHaveBeenCalledWith(
        expect.anything(),
        'store-1',
        expect.objectContaining({
          deliveryFeePaise: 25000,
          minOrderPaise: 30000,
          priceVarianceAbsCapPaise: 4000,
          slotLengthMinutes: 30,
          slotCapacity: 5,
          priceVariancePercentBp: 200,
          lowStockThreshold: 2,
        }),
      );
    });
  });

  describe('Validation rejection for invalid rupee values', () => {
    it.each(OSCAR_PROBES)('rejects invalid deliveryFee: $input ($reason)', async ({ input }) => {
      const form = baseFormData();
      form.set('deliveryFee', input);

      const result = await updateSettingsAction(undefined, form);
      expect(result.startsWith('!')).toBe(true);
      expect(result).toMatch(/Delivery fee/i);
      expect(stores.updateSettings).not.toHaveBeenCalled();
    });

    it.each(OSCAR_PROBES)('rejects invalid minOrder: $input ($reason)', async ({ input }) => {
      const form = baseFormData();
      form.set('minOrder', input);

      const result = await updateSettingsAction(undefined, form);
      expect(result.startsWith('!')).toBe(true);
      expect(result).toMatch(/Minimum order/i);
      expect(stores.updateSettings).not.toHaveBeenCalled();
    });

    it.each(OSCAR_PROBES)(
      'rejects invalid priceVarianceAbsCap: $input ($reason)',
      async ({ input }) => {
        const form = baseFormData();
        form.set('priceVarianceAbsCap', input);

        const result = await updateSettingsAction(undefined, form);
        expect(result.startsWith('!')).toBe(true);
        expect(result).toMatch(/Variance cap/i);
        expect(stores.updateSettings).not.toHaveBeenCalled();
      },
    );

    it('rejects empty delivery fee with required message', async () => {
      const form = baseFormData();
      form.set('deliveryFee', '');

      const result = await updateSettingsAction(undefined, form);
      expect(result).toBe('!Delivery fee is required');
      expect(stores.updateSettings).not.toHaveBeenCalled();
    });
  });

  describe('M1: Admin stores page copy guidance regression guard', () => {
    it('verifies page guidance states values are entered in rupees and stored in paise, rejecting old "fields are paise too" instruction', () => {
      const pagePath = path.resolve(__dirname, '../../src/app/(admin)/admin/stores/page.tsx');
      const content = fs.readFileSync(pagePath, 'utf-8');

      expect(content).not.toContain('these fields are paise too');
      expect(content).toContain('Values are entered in rupees and stored internally in paise.');
    });
  });

  describe('M2: Ambiguous dual-field submission rejection', () => {
    it('rejects submission when BOTH valid rupee and valid paise keys are supplied for deliveryFee', async () => {
      const form = baseFormData();
      form.set('deliveryFee', '200.00');
      form.set('deliveryFeePaise', '20000');

      const result = await updateSettingsAction(undefined, form);
      expect(result.startsWith('!')).toBe(true);
      expect(result).toMatch(/Cannot specify both deliveryFee .* and deliveryFeePaise/i);
      expect(stores.updateSettings).not.toHaveBeenCalled();
    });

    it('rejects conflicting values (Oscar probe: deliveryFee=2.00 and deliveryFeePaise=999999) without silently saving raw paise', async () => {
      const form = baseFormData();
      form.set('deliveryFee', '2.00');
      form.set('deliveryFeePaise', '999999');

      const result = await updateSettingsAction(undefined, form);
      expect(result.startsWith('!')).toBe(true);
      expect(result).toMatch(/Cannot specify both deliveryFee .* and deliveryFeePaise/i);
      expect(stores.updateSettings).not.toHaveBeenCalled();
    });

    it('rejects submission when BOTH valid rupee and valid paise keys are supplied for minOrder', async () => {
      const form = baseFormData();
      form.set('minOrder', '500.00');
      form.set('minOrderPaise', '50000');

      const result = await updateSettingsAction(undefined, form);
      expect(result.startsWith('!')).toBe(true);
      expect(result).toMatch(/Cannot specify both minOrder .* and minOrderPaise/i);
      expect(stores.updateSettings).not.toHaveBeenCalled();
    });

    it('rejects submission when BOTH valid rupee and valid paise keys are supplied for priceVarianceAbsCap', async () => {
      const form = baseFormData();
      form.set('priceVarianceAbsCap', '50.00');
      form.set('priceVarianceAbsCapPaise', '5000');

      const result = await updateSettingsAction(undefined, form);
      expect(result.startsWith('!')).toBe(true);
      expect(result).toMatch(
        /Cannot specify both priceVarianceAbsCap .* and priceVarianceAbsCapPaise/i,
      );
      expect(stores.updateSettings).not.toHaveBeenCalled();
    });

    it('rejects invalid rupee key when valid paise key is also present (does NOT silently fall back to old key) for deliveryFee', async () => {
      const form = baseFormData();
      form.set('deliveryFee', 'not-money');
      form.set('deliveryFeePaise', '20000');

      const result = await updateSettingsAction(undefined, form);
      expect(result.startsWith('!')).toBe(true);
      expect(result).toMatch(/Cannot specify both deliveryFee .* and deliveryFeePaise/i);
      expect(stores.updateSettings).not.toHaveBeenCalled();
    });

    it('rejects invalid rupee key when valid paise key is also present (does NOT silently fall back to old key) for minOrder', async () => {
      const form = baseFormData();
      form.set('minOrder', 'not-money');
      form.set('minOrderPaise', '50000');

      const result = await updateSettingsAction(undefined, form);
      expect(result.startsWith('!')).toBe(true);
      expect(result).toMatch(/Cannot specify both minOrder .* and minOrderPaise/i);
      expect(stores.updateSettings).not.toHaveBeenCalled();
    });

    it('rejects invalid rupee key when valid paise key is also present (does NOT silently fall back to old key) for priceVarianceAbsCap', async () => {
      const form = baseFormData();
      form.set('priceVarianceAbsCap', 'not-money');
      form.set('priceVarianceAbsCapPaise', '5000');

      const result = await updateSettingsAction(undefined, form);
      expect(result.startsWith('!')).toBe(true);
      expect(result).toMatch(
        /Cannot specify both priceVarianceAbsCap .* and priceVarianceAbsCapPaise/i,
      );
      expect(stores.updateSettings).not.toHaveBeenCalled();
    });
  });
});
