import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, test } from 'vitest';
import {
  STOREFRONT_COPY_MANIFEST,
  formatHubCardDescription,
  formatCommunityDeliveryNote,
} from '../../src/app/(storefront)/copy-manifest';

/**
 * Regression guard for storefront customer copy integrity and architectural review.
 *
 * Invariant (PR #46 Round 5):
 * 1. Customer-facing claims and commitments are structurally centralized in
 *    `STOREFRONT_COPY_MANIFEST`. Any changes or additions require an explicit,
 *    reviewable diff against the approved copy snapshot rather than relying on regex guessing.
 * 2. Structural coverage tests confirm that all customer-facing surfaces (Home, About,
 *    Cart, Communities, and Footer) are defined and populated.
 * 3. Historical blacklists prevent accidental re-introduction of previously flagged
 *    unbacked speed promises, fake restock ETAs, and historical PR #46 unbacked claims.
 */
describe('Storefront copy integrity & manifest guard', () => {
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

  // ---------------------------------------------------------------------------
  // 1. Approved Copy Manifest Snapshot & Structural Surface Coverage
  // ---------------------------------------------------------------------------

  test('STOREFRONT_COPY_MANIFEST matches the approved customer-facing copy snapshot', () => {
    // Any change, addition, or deletion to customer-facing claims will fail this test,
    // creating an explicit reviewable diff in the test snapshot.
    expect(STOREFRONT_COPY_MANIFEST).toMatchSnapshot();
  });

  test('STOREFRONT_COPY_MANIFEST covers all required customer-facing surfaces', () => {
    // Home surface
    expect(STOREFRONT_COPY_MANIFEST.home.hero.badge).toBeTruthy();
    expect(STOREFRONT_COPY_MANIFEST.home.hero.titlePrefix).toBeTruthy();
    expect(STOREFRONT_COPY_MANIFEST.home.hero.titleHighlight).toBeTruthy();
    expect(STOREFRONT_COPY_MANIFEST.home.hero.subtitle).toBeTruthy();
    expect(STOREFRONT_COPY_MANIFEST.home.communitySelector.title).toBeTruthy();
    expect(STOREFRONT_COPY_MANIFEST.home.communitySelector.subtitle).toBeTruthy();
    expect(STOREFRONT_COPY_MANIFEST.home.highlights.slotsTitle).toBeTruthy();
    expect(STOREFRONT_COPY_MANIFEST.home.highlights.produceTitle).toBeTruthy();
    expect(STOREFRONT_COPY_MANIFEST.home.highlights.paymentTitle).toBeTruthy();
    expect(STOREFRONT_COPY_MANIFEST.home.highlights.doorstepTitle).toBeTruthy();
    expect(STOREFRONT_COPY_MANIFEST.home.aboutPreview.badge).toBeTruthy();
    expect(STOREFRONT_COPY_MANIFEST.home.aboutPreview.title).toBeTruthy();
    expect(STOREFRONT_COPY_MANIFEST.home.aboutPreview.description).toBeTruthy();
    expect(STOREFRONT_COPY_MANIFEST.home.promise.badge).toBeTruthy();
    expect(STOREFRONT_COPY_MANIFEST.home.promise.title).toBeTruthy();
    expect(STOREFRONT_COPY_MANIFEST.home.promise.description).toBeTruthy();

    // About surface
    expect(STOREFRONT_COPY_MANIFEST.about.meta.title).toBeTruthy();
    expect(STOREFRONT_COPY_MANIFEST.about.meta.description).toBeTruthy();
    expect(STOREFRONT_COPY_MANIFEST.about.hero.badge).toBeTruthy();
    expect(STOREFRONT_COPY_MANIFEST.about.hero.title).toBeTruthy();
    expect(STOREFRONT_COPY_MANIFEST.about.hero.description).toBeTruthy();
    expect(STOREFRONT_COPY_MANIFEST.about.hubSystem.badge).toBeTruthy();
    expect(STOREFRONT_COPY_MANIFEST.about.hubSystem.title).toBeTruthy();
    expect(STOREFRONT_COPY_MANIFEST.about.hubSystem.description).toBeTruthy();
    expect(formatHubCardDescription('Northern Hub')).toContain('Northern Hub');
    expect(STOREFRONT_COPY_MANIFEST.about.commitments.badge).toBeTruthy();
    expect(STOREFRONT_COPY_MANIFEST.about.commitments.title).toBeTruthy();
    expect(STOREFRONT_COPY_MANIFEST.about.commitments.cards.scheduledSlots.title).toBeTruthy();
    expect(STOREFRONT_COPY_MANIFEST.about.commitments.cards.oneHubOneCommunity.title).toBeTruthy();
    expect(
      STOREFRONT_COPY_MANIFEST.about.commitments.cards.liveInventoryPricing.title,
    ).toBeTruthy();
    expect(STOREFRONT_COPY_MANIFEST.about.commitments.cards.payAtDoorstep.title).toBeTruthy();
    expect(STOREFRONT_COPY_MANIFEST.about.serviceBoundary.title).toBeTruthy();
    expect(STOREFRONT_COPY_MANIFEST.about.serviceBoundary.description).toBeTruthy();

    // Cart surface
    expect(STOREFRONT_COPY_MANIFEST.cart.trustBadges.storeVerified).toBeTruthy();
    expect(STOREFRONT_COPY_MANIFEST.cart.trustBadges.doorstepPayment).toBeTruthy();

    // Communities surface
    expect(STOREFRONT_COPY_MANIFEST.communities.deliveryNoteBase).toBeTruthy();
    expect(formatCommunityDeliveryNote()).toBe(
      STOREFRONT_COPY_MANIFEST.communities.deliveryNoteBase,
    );
    expect(formatCommunityDeliveryNote('₹500.00')).toBe(
      'Scheduled Slots · Dedicated Hub · Min Order ₹500.00',
    );

    // Footer surface
    expect(STOREFRONT_COPY_MANIFEST.footer.commitmentsTitle).toBeTruthy();
    expect(STOREFRONT_COPY_MANIFEST.footer.commitmentsDescription).toBeTruthy();
  });

  // ---------------------------------------------------------------------------
  // 2. Historical Regression Blacklists (Known Defect Classes)
  // ---------------------------------------------------------------------------

  test('no storefront file promises 1-hour or minute speed delivery guarantees', () => {
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
   * Historical phrase blacklist from PR #46 review rounds 1-4.
   * Prevents accidental reintroduction of specifically identified unbacked phrases.
   */
  const HISTORICAL_FLAGGED_PHRASES = [
    // Round 1-4 specific phrases
    { phrase: 'predictable arrivals', regex: /\bpredictable\s+arrivals?\b/i },
    {
      phrase: 'actually on the shelf',
      regex: /\b(?:actually\s+|currently\s+)?on\s+the\s+shelf\b/i,
    },
    { phrase: 'not a distant dark store', regex: /\bdark\s*stores?\b/i },
    { phrase: 'Fresh daily quality guaranteed', regex: /\bfresh\s+daily(?:\s+quality)?\b/i },
    { phrase: 'Scheduled Slots · Fresh Daily', regex: /\bfresh\s+daily\b/i },
    { phrase: 'no missing items', regex: /\bno\s+missing\s+items\b/i },
    { phrase: 'actual physical stock', regex: /\bactual\s+physical\s+stock\b/i },
    { phrase: 'no lingering waits', regex: /\bno\s+lingering\s+waits\b/i },
    {
      phrase: 'never take orders we cannot fulfill',
      regex: /\bnever\s+take\s+orders\s+we\s+cannot\s+fulfill\b/i,
    },
    { phrase: 'zero unannounced substitutions', regex: /\bzero\s+unannounced\s+substitutions?\b/i },
    {
      phrase: 'ensures stock accuracy',
      regex: /\bensur\w*\s+(?:stock\s+accuracy|timely\s+fulfillment)\b/i,
    },
    { phrase: 'vetted local producers', regex: /\bvetted\s+local\s+produc/i },
    { phrase: 'daily fresh sourcing', regex: /\bdaily\s+fresh(?:\s+sourcing)?\b/i },
    { phrase: 'sourced every morning', regex: /\bsourced\s+every\s+morning\b/i },
    { phrase: 'morning fresh sourcing', regex: /\bmorning\s+fresh(?:\s+sourcing|\s+harvest)?\b/i },
    { phrase: 'farm-fresh', regex: /\bfarm[- ]fresh\b/i },
    { phrase: 'picked fresh', regex: /\bpicked\s+fresh\b/i },
    { phrase: 'local farm', regex: /\blocal\s+farm\b/i },
    { phrase: 'morning fresh harvest', regex: /\bmorning\s+fresh\b/i },
    { phrase: 'surprise markups', regex: /\bsurprise\s+markups?\b/i },
    { phrase: 'cancellation penalties', regex: /\bcancellation\s+penalt(?:y|ies)\b/i },
    { phrase: 'wholesale prices', regex: /\bwholesale\s+prices?\b/i },
    { phrase: 'physical mini-hubs', regex: /\bmini[- ]hubs?\b/i },
  ];

  test('historical blacklist patterns catch all PR #46 probe phrases', () => {
    const historicalProbes = [
      'Scheduled slots mean predictable arrivals',
      "the catalogue reflects what's actually on the shelf",
      'not a distant dark store',
      'Fresh daily quality guaranteed',
      'Scheduled Slots · Fresh Daily',
      'no missing items in your order',
      'actual physical stock at hub',
      'no lingering waits for delivery',
      'we never take orders we cannot fulfill reliably',
      'ensures zero unannounced substitutions',
      'ensuring stock accuracy always',
      'vetted local producers bring quality',
      'sourced every morning from farms',
      'farm-fresh vegetables',
      'picked fresh today',
      'local farm produce',
      'zero surprise markups at checkout',
      'no cancellation penalties apply',
      'community wholesale prices',
      'physical mini-hubs near you',
    ];

    for (const probe of historicalProbes) {
      const match = HISTORICAL_FLAGGED_PHRASES.some(({ regex }) => regex.test(probe));
      expect(match, `Expected historical blacklist to match probe: "${probe}"`).toBe(true);
    }
  });

  test('no storefront file contains any historically flagged prohibited phrases', () => {
    for (const file of storefrontFiles) {
      const content = fs.readFileSync(file, 'utf-8');
      const relative = path.relative(process.cwd(), file);
      for (const { phrase, regex } of HISTORICAL_FLAGGED_PHRASES) {
        expect(
          regex.test(content),
          `Found historically prohibited phrase "${phrase}" (${regex.source}) in ${relative}`,
        ).toBe(false);
      }
    }
  });

  test('copy manifest itself contains zero historically flagged prohibited phrases', () => {
    function extractStrings(obj: unknown): string[] {
      if (typeof obj === 'string') return [obj];
      if (typeof obj === 'object' && obj !== null) {
        return Object.values(obj).flatMap(extractStrings);
      }
      return [];
    }

    const manifestStrings = extractStrings(STOREFRONT_COPY_MANIFEST);
    expect(manifestStrings.length).toBeGreaterThan(0);

    for (const str of manifestStrings) {
      for (const { phrase, regex } of HISTORICAL_FLAGGED_PHRASES) {
        expect(
          regex.test(str),
          `Found historically prohibited phrase "${phrase}" in manifest string: "${str}"`,
        ).toBe(false);
      }
    }
  });
});
