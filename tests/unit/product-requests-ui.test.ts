import { describe, expect, test } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { PRODUCT_REQUEST_STATUSES, REQUEST_TRANSITIONS } from '../../src/modules/product-requests';
import { STOREFRONT_COPY_MANIFEST } from '../../src/app/(storefront)/copy-manifest';
import {
  PRODUCT_REQUEST_STATUS_LABELS,
  PRODUCT_REQUEST_STATUS_STYLES,
} from '../../src/app/(admin)/admin/product-requests/status-definitions';

describe('Product Requests UI: Storefront Copy Manifest Integrity', () => {
  test('STOREFRONT_COPY_MANIFEST.productRequest has required structure and fields', () => {
    const { productRequest } = STOREFRONT_COPY_MANIFEST;
    expect(productRequest.meta.title).toBeTruthy();
    expect(productRequest.meta.description).toBeTruthy();
    expect(productRequest.hero.title).toBe('Request a Product');
    expect(productRequest.hero.subtitle).toBeTruthy();
    expect(productRequest.form.productNameLabel).toBeTruthy();
    expect(productRequest.form.submitButton).toBeTruthy();
    expect(productRequest.form.noStoreSelectedPrompt).toBeTruthy();
    expect(productRequest.success.title).toContain("Thanks, we've received your request");
    expect(productRequest.success.description).toBeTruthy();
    expect(productRequest.searchPrompt.text).toBeTruthy();
    expect(productRequest.searchPrompt.linkText).toBeTruthy();
  });

  test('success copy contains NO commitment language or promises that product will be stocked', () => {
    const { success } = STOREFRONT_COPY_MANIFEST.productRequest;
    const combined = `${success.title} ${success.description}`.toLowerCase();

    // Must not promise that it will be stocked or available soon
    expect(combined).not.toContain('will be stocked');
    expect(combined).not.toContain('guaranteed');
    expect(combined).not.toContain('coming soon');
    expect(combined).not.toContain('in 1 hour');
    expect(combined).not.toContain('tomorrow');
  });

  test('request-product page and form strictly consume copy-manifest', () => {
    const storefrontDir = path.resolve(__dirname, '../../src/app/(storefront)');
    const pageSource = fs.readFileSync(
      path.join(storefrontDir, 'request-product/page.tsx'),
      'utf-8',
    );
    const formSource = fs.readFileSync(
      path.join(storefrontDir, 'request-product/product-request-form.tsx'),
      'utf-8',
    );

    expect(pageSource).toContain('title: STOREFRONT_COPY_MANIFEST.productRequest.meta.title');
    expect(pageSource).toContain('{hero.title}');
    expect(pageSource).toContain('{hero.subtitle}');

    expect(formSource).toContain('STOREFRONT_COPY_MANIFEST.productRequest');
    expect(formSource).toContain('{successCopy.title}');
    expect(formSource).toContain('{successCopy.description}');
    expect(formSource).toContain('{formCopy.productNameLabel}');
  });

  test('request-product form handles resetting and requesting another product', () => {
    const formSource = fs.readFileSync(
      path.resolve(
        __dirname,
        '../../src/app/(storefront)/request-product/product-request-form.tsx',
      ),
      'utf-8',
    );

    expect(formSource).toContain('lastDismissedCount');
    expect(formSource).toContain('setLastDismissedCount');
    expect(formSource).toContain('initialProductName');
    expect(formSource).not.toMatch(/^(\s*)if\s*\(\s*state\s*===\s*['"]ok['"]\s*\)/m);
  });
});

describe('Product Requests UI: Admin Status Styles and Transitions', () => {
  test('PRODUCT_REQUEST_STATUS_STYLES covers every status in PRODUCT_REQUEST_STATUSES exhaustively', () => {
    for (const status of PRODUCT_REQUEST_STATUSES) {
      expect(PRODUCT_REQUEST_STATUS_STYLES[status]).toBeTruthy();
      expect(PRODUCT_REQUEST_STATUS_LABELS[status]).toBeTruthy();
    }
  });

  test('REQUEST_TRANSITIONS correctly defines allowed triage state machine moves', () => {
    // NEW can move to any subsequent state
    expect(REQUEST_TRANSITIONS.NEW).toEqual(['REVIEWED', 'PLANNED', 'DECLINED', 'FULFILLED']);

    // REVIEWED and PLANNED can move between each other or forward/decline
    expect(REQUEST_TRANSITIONS.REVIEWED).toEqual(['PLANNED', 'DECLINED', 'FULFILLED']);
    expect(REQUEST_TRANSITIONS.PLANNED).toEqual(['REVIEWED', 'DECLINED', 'FULFILLED']);

    // DECLINED can only reopen to REVIEWED
    expect(REQUEST_TRANSITIONS.DECLINED).toEqual(['REVIEWED']);

    // FULFILLED is terminal
    expect(REQUEST_TRANSITIONS.FULFILLED).toEqual([]);
  });

  test('admin product-requests page source file exists and is dynamic', () => {
    const adminDir = path.resolve(__dirname, '../../src/app/(admin)/admin/product-requests');
    const pageSource = fs.readFileSync(path.join(adminDir, 'page.tsx'), 'utf-8');

    expect(pageSource).toContain("export const dynamic = 'force-dynamic'");
    expect(pageSource).toContain('productRequestCounts');
    expect(pageSource).toContain('listProductRequests');
    expect(pageSource).toContain('getProductRequest');
  });

  test('admin table title displays exact counts from productRequestCounts, not capped requests.length (AD9 invariant)', () => {
    const adminDir = path.resolve(__dirname, '../../src/app/(admin)/admin/product-requests');
    const pageSource = fs.readFileSync(path.join(adminDir, 'page.tsx'), 'utf-8');

    // Title must use counts.byStatus or counts.total, never requests.length
    expect(pageSource).toContain('counts.byStatus[filterStatus]');
    expect(pageSource).toContain('counts.total');
    expect(pageSource).not.toMatch(
      /title\s*=\s*\{\s*filterStatus\s*\?\s*`\$\{String\(requests\.length\)\}/,
    );
  });
});

describe('Product Requests Action: clientKey derivation for phone-less guests', () => {
  test('requestProductAction derives and passes clientKey into submitProductRequest', () => {
    const actionsSource = fs.readFileSync(
      path.resolve(__dirname, '../../src/app/(storefront)/actions.ts'),
      'utf-8',
    );

    expect(actionsSource).toContain('const clientKey = await resolveClientKey()');
    expect(actionsSource).toContain('clientKey,');
    expect(actionsSource).toContain('resolveClientKey');
    expect(actionsSource).toContain('currentCartToken()');
    expect(actionsSource).toContain("headerStore.get('x-forwarded-for')");
  });
});
