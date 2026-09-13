import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, test } from 'vitest';

/**
 * Regression guard for storefront customer copy integrity (M1).
 *
 * Ensures that unapproved speed promises (such as "1-hour delivery" or "1-hr delivery"),
 * unbacked restock ETAs (such as "expected tomorrow"), and unapproved placeholder names
 * never silently reappear in customer-facing storefront files.
 */
describe('Storefront copy integrity (M1 regression guard)', () => {
  const storefrontDir = path.resolve(__dirname, '../../src/app/(storefront)');

  function getFiles(dir: string): string[] {
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    const files: string[] = [];
    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        files.push(...getFiles(fullPath));
      } else if (/\.(tsx?|jsx?)$/.test(entry.name)) {
        files.push(fullPath);
      }
    }
    return files;
  }

  const storefrontFiles = getFiles(storefrontDir);

  test('no storefront file promises 1-hour or minute speed delivery guarantees', () => {
    // Rejects "1-hour delivery", "1-hr delivery", "45-min delivery", etc.
    const speedPromiseRegex =
      /\b\d+\s*-(?:hour|hr|minute|min)\s+(?:delivery|slot\s+delivery\s+guarantee)/i;
    const direct1HrRegex = /\b1-hr\s+delivery\b/i;
    const direct1HourRegex = /\b1-hour\s+delivery\b/i;

    for (const file of storefrontFiles) {
      const content = fs.readFileSync(file, 'utf-8');
      const relative = path.relative(process.cwd(), file);

      expect(
        speedPromiseRegex.test(content),
        `Found speed delivery promise matching regex in ${relative}`,
      ).toBe(false);

      expect(direct1HrRegex.test(content), `Found "1-hr delivery" in ${relative}`).toBe(false);

      expect(direct1HourRegex.test(content), `Found "1-hour delivery" in ${relative}`).toBe(false);
    }
  });

  test('no storefront file contains fabricated restock ETAs', () => {
    const etaRegex = /\bexpected\s+(?:tomorrow|today|next\s+week)\b/i;
    for (const file of storefrontFiles) {
      const content = fs.readFileSync(file, 'utf-8');
      const relative = path.relative(process.cwd(), file);
      expect(etaRegex.test(content), `Found unbacked restock ETA in ${relative}`).toBe(false);
    }
  });

  test('no storefront file hardcodes unapproved quarters names', () => {
    const unapprovedNames = [
      'Officers & Sailors Enclave',
      'Officers Enclave',
      'Lower Hill Complex',
    ];
    for (const file of storefrontFiles) {
      const content = fs.readFileSync(file, 'utf-8');
      const relative = path.relative(process.cwd(), file);
      for (const name of unapprovedNames) {
        expect(
          content.includes(name),
          `Found unapproved community name "${name}" in ${relative}`,
        ).toBe(false);
      }
    }
  });

  test('no storefront file contains unbacked "Verified Shopper" claims', () => {
    for (const file of storefrontFiles) {
      const content = fs.readFileSync(file, 'utf-8');
      const relative = path.relative(process.cwd(), file);
      expect(
        content.includes('Verified Shopper'),
        `Found unbacked "Verified Shopper" claim in ${relative}`,
      ).toBe(false);
    }
  });

  test('no storefront file contains false "Ordering arrives in the next release" claims', () => {
    for (const file of storefrontFiles) {
      const content = fs.readFileSync(file, 'utf-8');
      const relative = path.relative(process.cwd(), file);
      expect(
        content.includes('Ordering arrives in the next release'),
        `Found false release timing claim in ${relative}`,
      ).toBe(false);
    }
  });

  /**
   * PR #46 (About/Home) went through four review rounds because early fixes only
   * addressed specific reported phrases rather than their underlying semantic families:
   * 1. Predictable delivery outcomes & timing guarantees
   * 2. Physical shelf / on-shelf stock & absolute fulfillment guarantees
   * 3. Sourcing, provenance, & daily freshness / quality guarantees
   * 4. Dark-store & regional warehouse topology claims
   * 5. Unbacked pricing & cancellation policies
   *
   * These patterns lock in every semantic family so variations, singular/plural forms,
   * or wording changes cannot bypass the regression suite.
   */
  const SPEED_AND_PREDICTABLE_DELIVERY_PATTERNS = [
    /\b\d+\s*-(?:hour|hr|minute|min)\s+(?:delivery|slot\s+delivery\s+guarantee)/i,
    /\b1-hr\s+delivery\b/i,
    /\b1-hour\s+delivery\b/i,
    /\bpredictable(?:\s+\w+)?\s*(?:arrival|delivery|time|window|schedule|outcome)s?\b/i,
    /\bpredictable\s+arrivals?\b/i,
    /\bpredictable\s+time\s+windows?\b/i,
    /\bno\s+lingering\s+waits\b/i,
  ];

  const PHYSICAL_ON_SHELF_STOCK_PATTERNS = [
    /\b(?:actually\s+|currently\s+)?on\s+the\s+shelf\b/i,
    /\bactual\s+physical\s+stock\b/i,
    /\bphysical\s+(?:stock|shelf|shelves)\b/i,
    /\bshelf\s+stock\b/i,
    /\bstocked\s+directly\b/i,
    /\bno\s+missing\s+items\b/i,
    /\bnever\s+take\s+orders\s+we\s+cannot\s+fulfill\b/i,
    /\bzero\s+unannounced\s+substitutions?\b/i,
    /\bensur\w*\s+(?:stock\s+accuracy|timely\s+fulfillment)\b/i,
  ];

  const SOURCING_AND_DAILY_QUALITY_PATTERNS = [
    /\bfresh\s+daily\b/i,
    /\bdaily\s+fresh\b/i,
    /\bquality\s+guarantee(?:d)?\b/i,
    /\bguarantee(?:d)?\s+fresh\b/i,
    /\bvetted\s+local\s+produc/i,
    /\bdaily\s+fresh\s+sourcing/i,
    /\bsourced\s+every\s+morning\b/i,
    /\bmorning\s+fresh(?:\s+sourcing|\s+harvest)?\b/i,
    /\bfarm[- ]fresh\b/i,
    /\bpicked\s+fresh\b/i,
    /\blocal\s+farm\b/i,
  ];

  const DARK_STORE_AND_WAREHOUSE_TOPOLOGY_PATTERNS = [
    /\bdark\s*stores?\b/i,
    /\b(?:sprawling\s+|shared\s+|distant\s+|regional\s+)?warehouses?\b/i,
    /\bmini[- ]hubs?\b/i,
  ];

  const PRICING_AND_CANCELLATION_POLICY_PATTERNS = [
    /\bsurprise\s+markups?\b/i,
    /\bzero\s+markups?\b/i,
    /\bcancellation\s+penalt(?:y|ies)\b/i,
    /\bwholesale\s+prices?\b/i,
  ];

  const ALL_SEMANTIC_PATTERNS = [
    ...SPEED_AND_PREDICTABLE_DELIVERY_PATTERNS,
    ...PHYSICAL_ON_SHELF_STOCK_PATTERNS,
    ...SOURCING_AND_DAILY_QUALITY_PATTERNS,
    ...DARK_STORE_AND_WAREHOUSE_TOPOLOGY_PATTERNS,
    ...PRICING_AND_CANCELLATION_POLICY_PATTERNS,
  ];

  test('semantic family patterns catch Oscar probe strings from pr46-c2-copy-guard-probe.log', () => {
    const probeStrings = [
      {
        text: 'Scheduled slots mean predictable arrivals',
        pattern: /\bpredictable\s+arrivals?\b/i,
      },
      {
        text: "the catalogue reflects what's actually on the shelf",
        pattern: /\b(?:actually\s+|currently\s+)?on\s+the\s+shelf\b/i,
      },
      { text: 'not a distant dark store', pattern: /\bdark\s*stores?\b/i },
      { text: 'Fresh daily quality guaranteed', pattern: /\bfresh\s+daily\b/i },
      { text: 'Scheduled Slots · Fresh Daily', pattern: /\bfresh\s+daily\b/i },
    ];

    for (const { text, pattern } of probeStrings) {
      expect(
        pattern.test(text),
        `Expected specific pattern (${pattern.source}) to match Oscar probe: "${text}"`,
      ).toBe(true);

      expect(
        ALL_SEMANTIC_PATTERNS.some((p) => p.test(text)),
        `Expected semantic family patterns to catch Oscar probe: "${text}"`,
      ).toBe(true);
    }
  });

  test('semantic family patterns catch representative variants across singular/plural and wording changes', () => {
    const variants = [
      // Predictable delivery
      'predictable arrival',
      'predictable arrivals',
      'predictable time window',
      'predictable time windows',
      'predictable delivery slot',
      'no lingering waits',
      // Physical on-shelf stock
      'on the shelf',
      'actually on the shelf',
      "what's actually on the shelf",
      'items on the shelf',
      'actual physical stock',
      'physical shelf',
      'physical shelves',
      'physical stock',
      'shelf stock',
      'stocked directly',
      'no missing items',
      'never take orders we cannot fulfill',
      'zero unannounced substitutions',
      'zero unannounced substitution',
      'ensures stock accuracy',
      'ensuring timely fulfillment',
      // Sourcing and daily quality
      'Fresh daily',
      'fresh daily',
      'Fresh Daily',
      'Daily fresh',
      'daily fresh',
      'Fresh daily quality guaranteed',
      'quality guaranteed',
      'quality guarantee',
      'guaranteed fresh',
      'farm-fresh',
      'farm fresh',
      'picked fresh',
      'local farm',
      'vetted local produce',
      'sourced every morning',
      'morning fresh harvest',
      // Dark store / warehouse topology
      'dark store',
      'dark stores',
      'not a distant dark store',
      'no dark stores',
      'regional warehouse',
      'regional warehouses',
      'sprawling regional warehouses',
      'distant warehouse',
      'shared regional warehouse',
      'warehouse',
      'warehouses',
      'physical mini-hubs',
      'mini-hub',
      'mini-hubs',
      // Pricing / cancellation
      'surprise markup',
      'surprise markups',
      'zero markup',
      'zero markups',
      'cancellation penalty',
      'cancellation penalties',
      'wholesale price',
      'wholesale prices',
    ];

    for (const variant of variants) {
      expect(
        ALL_SEMANTIC_PATTERNS.some((p) => p.test(variant)),
        `Expected semantic patterns to catch variant: "${variant}"`,
      ).toBe(true);
    }
  });

  test('no storefront file contains speed or predictable delivery outcome promises', () => {
    for (const file of storefrontFiles) {
      const content = fs.readFileSync(file, 'utf-8');
      const relative = path.relative(process.cwd(), file);
      for (const pattern of SPEED_AND_PREDICTABLE_DELIVERY_PATTERNS) {
        expect(
          pattern.test(content),
          `Found predictable delivery / speed promise (${pattern.source}) in ${relative}`,
        ).toBe(false);
      }
    }
  });

  test('no storefront file claims physical on-shelf stock or absolute fulfillment guarantees', () => {
    for (const file of storefrontFiles) {
      const content = fs.readFileSync(file, 'utf-8');
      const relative = path.relative(process.cwd(), file);
      for (const pattern of PHYSICAL_ON_SHELF_STOCK_PATTERNS) {
        expect(
          pattern.test(content),
          `Found physical stock / fulfillment guarantee (${pattern.source}) in ${relative}`,
        ).toBe(false);
      }
    }
  });

  test('no storefront file contains unbacked sourcing, provenance, or daily quality guarantees', () => {
    for (const file of storefrontFiles) {
      const content = fs.readFileSync(file, 'utf-8');
      const relative = path.relative(process.cwd(), file);
      for (const pattern of SOURCING_AND_DAILY_QUALITY_PATTERNS) {
        expect(
          pattern.test(content),
          `Found unbacked sourcing/quality claim (${pattern.source}) in ${relative}`,
        ).toBe(false);
      }
    }
  });

  test('no storefront file claims dark-store, regional warehouse, or mini-hub topology', () => {
    for (const file of storefrontFiles) {
      const content = fs.readFileSync(file, 'utf-8');
      const relative = path.relative(process.cwd(), file);
      for (const pattern of DARK_STORE_AND_WAREHOUSE_TOPOLOGY_PATTERNS) {
        expect(
          pattern.test(content),
          `Found dark-store / warehouse topology claim (${pattern.source}) in ${relative}`,
        ).toBe(false);
      }
    }
  });

  test('no storefront file claims a pricing or cancellation policy that does not exist', () => {
    for (const file of storefrontFiles) {
      const content = fs.readFileSync(file, 'utf-8');
      const relative = path.relative(process.cwd(), file);
      for (const pattern of PRICING_AND_CANCELLATION_POLICY_PATTERNS) {
        expect(
          pattern.test(content),
          `Found unbacked pricing/cancellation-policy claim (${pattern.source}) in ${relative}`,
        ).toBe(false);
      }
    }
  });
});
