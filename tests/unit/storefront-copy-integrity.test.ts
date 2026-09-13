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
   * PR #46 (About/Home) went through three review rounds because each fix only
   * addressed the exact phrase reported, not the underlying pattern — an
   * absolute guarantee, or an operational claim (sourcing, stock presence, no
   * markups, no cancellations) with nothing in the codebase backing it. These
   * patterns lock in every phrase found across all three rounds so the same
   * class of claim can't silently reappear on a future storefront page.
   */
  test('no storefront file contains unbacked sourcing/provenance claims', () => {
    const patterns = [
      /vetted local produc/i,
      /daily fresh sourcing/i,
      /sourced every morning/i,
      /morning fresh sourcing/i,
      /\bfarm[- ]fresh\b/i,
      /\bpicked fresh\b/i,
      /\blocal farm\b/i,
      /\bmorning fresh harvest\b/i,
    ];
    for (const file of storefrontFiles) {
      const content = fs.readFileSync(file, 'utf-8');
      const relative = path.relative(process.cwd(), file);
      for (const pattern of patterns) {
        expect(
          pattern.test(content),
          `Found unbacked sourcing/provenance claim (${pattern.source}) in ${relative}`,
        ).toBe(false);
      }
    }
  });

  test('no storefront file claims an absolute stock/fulfillment guarantee', () => {
    const patterns = [
      /\bno missing items\b/i,
      /\bactual physical stock\b/i,
      /\bno lingering waits\b/i,
      /never take orders we cannot fulfill/i,
      /\bzero\s+unannounced substitutions\b/i,
      /ensur\w*\s+(?:stock accuracy|timely fulfillment)/i,
    ];
    for (const file of storefrontFiles) {
      const content = fs.readFileSync(file, 'utf-8');
      const relative = path.relative(process.cwd(), file);
      for (const pattern of patterns) {
        expect(
          pattern.test(content),
          `Found unbacked stock/fulfillment guarantee (${pattern.source}) in ${relative}`,
        ).toBe(false);
      }
    }
  });

  test('no storefront file claims a pricing/cancellation policy that does not exist', () => {
    const patterns = [
      /\bsurprise markups?\b/i,
      /\bcancellation penalt(?:y|ies)\b/i,
      /\bwholesale prices?\b/i,
    ];
    for (const file of storefrontFiles) {
      const content = fs.readFileSync(file, 'utf-8');
      const relative = path.relative(process.cwd(), file);
      for (const pattern of patterns) {
        expect(
          pattern.test(content),
          `Found unbacked pricing/cancellation-policy claim (${pattern.source}) in ${relative}`,
        ).toBe(false);
      }
    }
  });
});
