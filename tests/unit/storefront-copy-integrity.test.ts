import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, test } from 'vitest';
import ts from 'typescript';
import {
  STOREFRONT_COPY_MANIFEST,
  formatHubCardDescription,
  formatCommunitySubtitle,
  formatActiveWelcomeTitle,
  formatActiveWelcomeTerms,
  formatShopSubtitle,
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
  const canonicalManifestPath = path.resolve(storefrontDir, 'copy-manifest.ts');
  const canonicalManifestPathNoExt = path.resolve(storefrontDir, 'copy-manifest');

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
    expect(STOREFRONT_COPY_MANIFEST.home.meta.title).toBeTruthy();
    expect(STOREFRONT_COPY_MANIFEST.home.meta.description).toBeTruthy();
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
    expect(STOREFRONT_COPY_MANIFEST.home.activeWelcome.badge).toBeTruthy();
    expect(formatActiveWelcomeTitle('Store 1')).toContain('Store 1');
    expect(formatActiveWelcomeTerms('₹40.00', '₹500.00')).toContain('₹40.00');
    expect(STOREFRONT_COPY_MANIFEST.home.activeWelcome.pausedNotice).toBeTruthy();
    expect(STOREFRONT_COPY_MANIFEST.home.promoBanners.dailyEssentials.badge).toBeTruthy();
    expect(STOREFRONT_COPY_MANIFEST.home.promoBanners.dailyEssentials.title).toBeTruthy();
    expect(STOREFRONT_COPY_MANIFEST.home.promoBanners.superSaver.badge).toBeTruthy();
    expect(STOREFRONT_COPY_MANIFEST.home.promoBanners.superSaver.title).toBeTruthy();
    expect(STOREFRONT_COPY_MANIFEST.home.aboutPreview.badge).toBeTruthy();
    expect(STOREFRONT_COPY_MANIFEST.home.aboutPreview.title).toBeTruthy();
    expect(STOREFRONT_COPY_MANIFEST.home.aboutPreview.description).toBeTruthy();
    expect(STOREFRONT_COPY_MANIFEST.home.promise.badge).toBeTruthy();
    expect(STOREFRONT_COPY_MANIFEST.home.promise.title).toBeTruthy();
    expect(STOREFRONT_COPY_MANIFEST.home.promise.description).toBeTruthy();

    // Shop surface
    expect(STOREFRONT_COPY_MANIFEST.shop.meta.title).toBeTruthy();
    expect(STOREFRONT_COPY_MANIFEST.shop.meta.description).toBeTruthy();
    expect(formatShopSubtitle('₹40.00', '₹500.00')).toContain('₹40.00');
    expect(STOREFRONT_COPY_MANIFEST.shop.pausedNotice).toBeTruthy();

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
    expect(STOREFRONT_COPY_MANIFEST.cart.meta.title).toBeTruthy();
    expect(STOREFRONT_COPY_MANIFEST.cart.meta.description).toBeTruthy();
    expect(STOREFRONT_COPY_MANIFEST.cart.heading.title).toBeTruthy();
    expect(STOREFRONT_COPY_MANIFEST.cart.heading.subtitle).toBeTruthy();
    expect(STOREFRONT_COPY_MANIFEST.cart.checkoutNotice).toBeTruthy();
    expect(STOREFRONT_COPY_MANIFEST.cart.scheduledSlotBadge).toBeTruthy();
    expect(STOREFRONT_COPY_MANIFEST.cart.trustBadges.storeVerified).toBeTruthy();
    expect(STOREFRONT_COPY_MANIFEST.cart.trustBadges.doorstepPayment).toBeTruthy();

    // Communities surface
    expect(STOREFRONT_COPY_MANIFEST.communities.subtitleTemplate).toBeTruthy();
    expect(formatCommunitySubtitle('Store 1')).toBe('Store 1 · Scheduled Slot Delivery');
    expect(STOREFRONT_COPY_MANIFEST.communities.deliveryNoteBase).toBeTruthy();
    expect(formatCommunityDeliveryNote()).toBe(
      STOREFRONT_COPY_MANIFEST.communities.deliveryNoteBase,
    );
    expect(formatCommunityDeliveryNote('₹500.00')).toBe(
      'Scheduled Slots · Dedicated Hub · Min Order ₹500.00',
    );
    expect(STOREFRONT_COPY_MANIFEST.communities.selector.badge).toBeTruthy();
    expect(STOREFRONT_COPY_MANIFEST.communities.selector.titleDefault).toBeTruthy();
    expect(STOREFRONT_COPY_MANIFEST.communities.selector.subtitleDefault).toBeTruthy();

    // Mobile bar surface
    expect(STOREFRONT_COPY_MANIFEST.mobileCartBar.slotNotice).toBeTruthy();

    // Footer surface
    expect(STOREFRONT_COPY_MANIFEST.footer.brandDescription).toBeTruthy();
    expect(STOREFRONT_COPY_MANIFEST.footer.communitiesHeading).toBeTruthy();
    expect(STOREFRONT_COPY_MANIFEST.footer.unserviceableLink).toBeTruthy();
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

  // ---------------------------------------------------------------------------
  // 3. Exhaustive Manifest Consumption & Exclusivity Invariants (PR #46 Round 7 Guard)
  // ---------------------------------------------------------------------------

  /**
   * Programmatically extracts every dot-separated leaf string expression path from
   * STOREFRONT_COPY_MANIFEST (e.g. 'STOREFRONT_COPY_MANIFEST.home.promoBanners.dailyEssentials.description').
   *
   * This ensures that ANY leaf added or modified in the manifest is automatically
   * guarded without requiring hand-written per-component probe tests.
   */
  function getManifestLeafPaths(obj: unknown, prefix = 'STOREFRONT_COPY_MANIFEST'): string[] {
    if (typeof obj === 'string') {
      return [prefix];
    }
    if (typeof obj === 'object' && obj !== null) {
      return Object.entries(obj).flatMap(([key, val]) =>
        getManifestLeafPaths(val, `${prefix}.${key}`),
      );
    }
    return [];
  }

  test('every single leaf string in STOREFRONT_COPY_MANIFEST programmatically appears as a consumed reference in storefront source files', () => {
    const leafPaths = getManifestLeafPaths(STOREFRONT_COPY_MANIFEST);
    // Sanity check that manifest contains substantial copy (>80 leaves)
    expect(leafPaths.length).toBeGreaterThanOrEqual(80);

    const combinedSource = storefrontFiles.map((file) => fs.readFileSync(file, 'utf-8')).join('\n');

    const unconsumedLeaves: string[] = [];
    for (const leafPath of leafPaths) {
      if (!combinedSource.includes(leafPath)) {
        unconsumedLeaves.push(leafPath);
      }
    }

    expect(
      unconsumedLeaves,
      `The following manifest leaf properties are defined in STOREFRONT_COPY_MANIFEST but never referenced in storefront source code:\n${unconsumedLeaves.join('\n')}`,
    ).toEqual([]);
  });

  test('all copy manifest helper functions are actively consumed across storefront components', () => {
    const helperFunctions = [
      'formatHubCardDescription',
      'formatCommunitySubtitle',
      'formatActiveWelcomeTitle',
      'formatActiveWelcomeTerms',
      'formatShopSubtitle',
      'formatCommunityDeliveryNote',
    ];

    const nonManifestFiles = storefrontFiles.filter(
      (file) => path.resolve(file) !== canonicalManifestPath,
    );
    const nonManifestCombinedSource = nonManifestFiles
      .map((file) => fs.readFileSync(file, 'utf-8'))
      .join('\n');

    for (const helper of helperFunctions) {
      expect(
        nonManifestCombinedSource.includes(helper),
        `Exported copy helper function "${helper}" is defined in copy-manifest.ts but never called in any storefront component`,
      ).toBe(true);
    }
  });

  test('designated storefront components strictly forbid raw hardcoded marketing literals', () => {
    // 1. cart/page.tsx: subtitle and checkout notice
    const cartSource = fs.readFileSync(path.join(storefrontDir, 'cart/page.tsx'), 'utf-8');
    expect(cartSource).not.toMatch(/subtitle\s*=\s*["'][^"']+["']/);
    expect(cartSource).not.toContain('No account needed');

    // 2. page.tsx: promotional banners & welcome strings
    const homeSource = fs.readFileSync(path.join(storefrontDir, 'page.tsx'), 'utf-8');
    expect(homeSource).not.toContain('>Delivering from your local hub<');
    expect(homeSource).not.toContain('>Fruits, Vegetables & Dairy<');
    expect(homeSource).not.toContain('>Kitchen Staples & Grains<');

    // 3. layout.tsx: footer brand description
    const layoutSource = fs.readFileSync(path.join(storefrontDir, 'layout.tsx'), 'utf-8');
    expect(layoutSource).not.toContain(
      'Dedicated hyperlocal grocery shopping for residential communities.',
    );

    // 4. communities.ts: delivery suffix
    const communitiesSource = fs.readFileSync(path.join(storefrontDir, 'communities.ts'), 'utf-8');
    expect(communitiesSource).not.toContain("'· Scheduled Slot Delivery'");
    expect(communitiesSource).not.toContain('"· Scheduled Slot Delivery"');

    // 5. mobile-cart-bar.tsx: slot notice
    const mobileBarSource = fs.readFileSync(
      path.join(storefrontDir, 'mobile-cart-bar.tsx'),
      'utf-8',
    );
    expect(mobileBarSource).not.toMatch(/>\s*Scheduled slot delivery\s*</);
  });

  test('Oscar bypass probe rejection: non-heading leaf replacement fails programmatic leaf consumption guard', () => {
    // Oscar Round 7 probe (finding M4):
    // In src/app/(storefront)/page.tsx, replacing STOREFRONT_COPY_MANIFEST.home.promoBanners.dailyEssentials.description
    // with inline claim 'Vegetables harvested at dawn from nearby farms.'
    const pageSource = fs.readFileSync(path.join(storefrontDir, 'page.tsx'), 'utf-8');
    const leafTarget = 'STOREFRONT_COPY_MANIFEST.home.promoBanners.dailyEssentials.description';
    expect(pageSource).toContain(leafTarget);

    const simulatedOscarPage = pageSource.replace(
      leafTarget,
      "'Vegetables harvested at dawn from nearby farms.'",
    );

    const combinedSourceWithMutation = storefrontFiles
      .map((file) =>
        file.endsWith('page.tsx') ? simulatedOscarPage : fs.readFileSync(file, 'utf-8'),
      )
      .join('\n');

    const leafPaths = getManifestLeafPaths(STOREFRONT_COPY_MANIFEST);
    const unconsumed = leafPaths.filter((lp) => !combinedSourceWithMutation.includes(lp));

    expect(unconsumed).toContain(leafTarget);
  });

  test('Oscar bypass probe rejection: cart subtitle heading replacement fails programmatic leaf consumption guard', () => {
    // Oscar Round 6 probe:
    // In src/app/(storefront)/cart/page.tsx, replacing STOREFRONT_COPY_MANIFEST.cart.heading.subtitle
    // with inline claim 'Your order arrives when promised'
    const cartSource = fs.readFileSync(path.join(storefrontDir, 'cart/page.tsx'), 'utf-8');
    const leafTarget = 'STOREFRONT_COPY_MANIFEST.cart.heading.subtitle';
    expect(cartSource).toContain(leafTarget);

    const simulatedOscarCart = cartSource.replace(
      `subtitle={${leafTarget}}`,
      `subtitle="Your order arrives when promised"`,
    );

    const combinedSourceWithMutation = storefrontFiles
      .map((file) =>
        file.endsWith('cart/page.tsx') ? simulatedOscarCart : fs.readFileSync(file, 'utf-8'),
      )
      .join('\n');

    const leafPaths = getManifestLeafPaths(STOREFRONT_COPY_MANIFEST);
    const unconsumed = leafPaths.filter((lp) => !combinedSourceWithMutation.includes(lp));

    expect(unconsumed).toContain(leafTarget);
  });

  test('Oscar bypass probe rejection: about commitment description replacement fails programmatic leaf consumption guard', () => {
    // About surface non-heading probe:
    const aboutSource = fs.readFileSync(path.join(storefrontDir, 'about/page.tsx'), 'utf-8');
    const leafTarget =
      'STOREFRONT_COPY_MANIFEST.about.commitments.cards.scheduledSlots.description';
    expect(aboutSource).toContain(leafTarget);

    const simulatedOscarAbout = aboutSource.replace(
      `{${leafTarget}}`,
      `{"We deliver faster than anyone else"}`,
    );

    const combinedSourceWithMutation = storefrontFiles
      .map((file) =>
        file.endsWith('about/page.tsx') ? simulatedOscarAbout : fs.readFileSync(file, 'utf-8'),
      )
      .join('\n');

    const leafPaths = getManifestLeafPaths(STOREFRONT_COPY_MANIFEST);
    const unconsumed = leafPaths.filter((lp) => !combinedSourceWithMutation.includes(lp));

    expect(unconsumed).toContain(leafTarget);
  });

  // ---------------------------------------------------------------------------
  // 4. Reverse-Direction AST Literal Guard & Dynamic Discovery (PR #46 Round 8 & 9 Guard)
  // ---------------------------------------------------------------------------

  /**
   * Scans a TSX file via TypeScript AST and extracts:
   * 1. All non-empty JSX text literals
   * 2. All string-valued JSX attributes on claim-bearing props
   *    (e.g., 'title', 'subtitle', 'badge', 'heading', 'description', 'notice')
   *
   * Completes the two-way architectural guarantee:
   * - Forward: every manifest leaf is consumed (Section 3)
   * - Reverse: every customer-facing literal in any storefront TSX file consuming
   *   STOREFRONT_COPY_MANIFEST is either in STOREFRONT_COPY_MANIFEST or on an explicit,
   *   reviewed allowlist of functional/structural UI labels.
   */
  const STOREFRONT_ALLOWED_LITERALS: Record<string, Set<string>> = {
    'about/page.tsx': new Set([
      '🌱',
      'Dedicated Store Hub',
      'Shop',
      'Store →',
      '⚡',
      '🥦',
      '🏷️',
      '🛡️',
      'Request Delivery to Your Society →',
      'Browse Product Catalogue →',
    ]),
    'cart/page.tsx': new Set([
      ', and is now priced there.',
      '.',
      'Add',
      'Came with you:',
      'Delivery',
      'Estimated total',
      'Explore fresh fruits, vegetables, dairy & daily staples from your community store.',
      'Items in Basket',
      'Minimum order',
      'Not sold or not in stock there, so removed:',
      'Only',
      'Out of stock at your shop right now.',
      'Price changed from',
      'Proceed to checkout',
      'Start shopping',
      'Subtotal (',
      'We had to take',
      'Your basket is empty.',
      'Your basket moved to',
      'an item',
      'available — reduce the quantity to continue.',
      'each',
      'item',
      'item(s))',
      'items',
      'more to reach the minimum order for your area.',
      'out:',
      'some items',
      'title="Change delivery area"',
      'title="Total"',
      'title="Your basket"',
      'to',
      '·',
      '— your basket uses the new price.',
    ]),
    'community-selector.tsx': new Set([
      'Local Store Hub',
      'Open',
      'Paused',
      'Primary Hub:',
      'View all',
      'serviceable sectors / blocks',
      '⚡',
      '🏪',
      '📍',
    ]),
    'layout.tsx': new Set([
      'About',
      'About Munder Fresh',
      'Account',
      'Account & Past Orders',
      'Basket',
      'Browse All Products',
      'Choose ▼',
      'Delivering to:',
      'Fresh',
      'M',
      'Munder',
      'Munder Fresh Supermarket Platform. All rights reserved.',
      'Search',
      'Select Community',
      'Shop',
      'Shopping & Orders',
      'Sign in',
      'Your Basket',
      'title="Click to switch community or store"',
      '©',
      '▼',
      '📍',
    ]),
    'mobile-cart-bar.tsx': new Set(['View Basket', 'added', 'item', 'items', '→']),
    'page.tsx': new Set([
      'Browse all',
      'Explore the Full Catalogue',
      'Learn More About Us →',
      'Open Full Shop Catalogue →',
      'Select Community →',
      'This shop has nothing listed yet.',
      'products across categories with search, filters, and complete listings in our Shop.',
      '⚡',
      '🏠',
      '🛡️',
      '🥦',
    ]),
    'shop/page.tsx': new Set(['This store has no items listed currently.']),
    'copy-manifest.ts': new Set([
      '',
      ' ',
      ' · ',
      ' · Delivery ',
      ' · Min order ',
      '{hubName}',
      '{shortName}',
      '{communityName}',
      'Free',
    ]),
  };

  const APPROVED_FORMATTERS = new Set([
    'formatActiveWelcomeTitle',
    'formatActiveWelcomeTerms',
    'formatShopSubtitle',
    'formatHubCardDescription',
    'formatCommunityDeliveryNote',
    'formatCommunitySubtitle',
    'formatContactHubDescription',
    'formatDeliveryFee',
  ]);

  function unwrapStaticExpression(expr: ts.Expression): ts.Expression {
    let curr = expr;
    while (true) {
      if (ts.isParenthesizedExpression(curr)) {
        curr = curr.expression;
      } else if (ts.isAsExpression(curr)) {
        curr = curr.expression;
      } else if (ts.isTypeAssertionExpression(curr)) {
        curr = curr.expression;
      } else if (ts.isSatisfiesExpression(curr)) {
        curr = curr.expression;
      } else if (ts.isNonNullExpression(curr)) {
        curr = curr.expression;
      } else {
        break;
      }
    }
    return curr;
  }

  function resolveStaticString(expr: ts.Expression): string | null {
    const unwrapped = unwrapStaticExpression(expr);
    if (ts.isStringLiteral(unwrapped) || ts.isNoSubstitutionTemplateLiteral(unwrapped)) {
      return unwrapped.text;
    }
    if (
      ts.isBinaryExpression(unwrapped) &&
      unwrapped.operatorToken.kind === ts.SyntaxKind.PlusToken
    ) {
      const left = resolveStaticString(unwrapped.left);
      const right = resolveStaticString(unwrapped.right);
      if (left !== null && right !== null) {
        return left + right;
      }
    }
    return null;
  }

  function checkFormatterDefinitions(
    sourceOverride?: string,
  ): { formatter: string; violations: string[] }[] {
    const manifestPath = canonicalManifestPath;
    const content = sourceOverride ?? fs.readFileSync(manifestPath, 'utf-8');
    const sf = ts.createSourceFile(manifestPath, content, ts.ScriptTarget.Latest, true);
    const allowed = STOREFRONT_ALLOWED_LITERALS['copy-manifest.ts'] ?? new Set<string>();
    const results: { formatter: string; violations: string[] }[] = [];

    function collectParams(
      node: ts.FunctionDeclaration | ts.ArrowFunction | ts.FunctionExpression,
    ): Set<string> {
      const params = new Set<string>();
      for (const param of node.parameters) {
        if (ts.isIdentifier(param.name)) {
          params.add(param.name.text);
        } else {
          function walkPattern(pat: ts.Node) {
            if (ts.isBindingElement(pat) && ts.isIdentifier(pat.name)) {
              params.add(pat.name.text);
            }
            ts.forEachChild(pat, walkPattern);
          }
          walkPattern(param.name);
        }
      }
      return params;
    }

    function getReturnExpressions(
      fnNode: ts.FunctionDeclaration | ts.ArrowFunction | ts.FunctionExpression,
    ): ts.Expression[] {
      const returns: ts.Expression[] = [];
      if (!fnNode.body) return returns;

      if (!ts.isBlock(fnNode.body)) {
        returns.push(fnNode.body);
        return returns;
      }

      function visit(n: ts.Node) {
        if (
          n !== fnNode &&
          (ts.isFunctionDeclaration(n) || ts.isArrowFunction(n) || ts.isFunctionExpression(n))
        ) {
          return;
        }
        if (ts.isReturnStatement(n) && n.expression) {
          returns.push(n.expression);
        }
        ts.forEachChild(n, visit);
      }

      visit(fnNode.body);
      return returns;
    }

    function isManifestPropAccess(expr: ts.Expression): boolean {
      let curr: ts.Expression = expr;
      while (ts.isPropertyAccessExpression(curr)) {
        curr = curr.expression;
      }
      return ts.isIdentifier(curr) && curr.text === 'STOREFRONT_COPY_MANIFEST';
    }

    function inspectFormatterNode(
      name: string,
      fnNode: ts.FunctionDeclaration | ts.ArrowFunction | ts.FunctionExpression,
    ) {
      const params = collectParams(fnNode);
      const violations: string[] = [];

      function checkText(text: string) {
        if (text === '') return;
        if (!allowed.has(text)) {
          violations.push(text);
        }
      }

      // 1. Scan literal texts anywhere in the formatter body
      if (fnNode.body) {
        function scanLiterals(n: ts.Node) {
          if (ts.isStringLiteral(n) || ts.isNoSubstitutionTemplateLiteral(n)) {
            checkText(n.text);
          } else if (ts.isTemplateExpression(n)) {
            checkText(n.head.text);
            for (const span of n.templateSpans) {
              checkText(span.literal.text);
            }
          }
          ts.forEachChild(n, scanLiterals);
        }
        scanLiterals(fnNode.body);
      }

      // 2. Validate return expressions: must be built ONLY from parameters, manifest refs, and allowed static pieces
      const returnExprs = getReturnExpressions(fnNode);
      if (returnExprs.length === 0) {
        violations.push(`${name} has no return expression`);
      }

      function validateExpr(expr: ts.Expression) {
        const unwrapped = unwrapStaticExpression(expr);

        if (isManifestPropAccess(unwrapped)) {
          return;
        }

        if (ts.isIdentifier(unwrapped) && params.has(unwrapped.text)) {
          return;
        }

        if (ts.isStringLiteral(unwrapped) || ts.isNoSubstitutionTemplateLiteral(unwrapped)) {
          if (!allowed.has(unwrapped.text) && unwrapped.text !== '') {
            violations.push(unwrapped.text);
          }
          return;
        }

        if (ts.isTemplateExpression(unwrapped)) {
          checkText(unwrapped.head.text);
          for (const span of unwrapped.templateSpans) {
            checkText(span.literal.text);
            validateExpr(span.expression);
          }
          return;
        }

        if (
          ts.isBinaryExpression(unwrapped) &&
          unwrapped.operatorToken.kind === ts.SyntaxKind.PlusToken
        ) {
          validateExpr(unwrapped.left);
          validateExpr(unwrapped.right);
          return;
        }

        if (ts.isConditionalExpression(unwrapped)) {
          validateExpr(unwrapped.whenTrue);
          validateExpr(unwrapped.whenFalse);
          return;
        }

        if (ts.isCallExpression(unwrapped)) {
          const callee = unwrapped.expression;
          if (
            ts.isPropertyAccessExpression(callee) &&
            (callee.name.text === 'replace' || callee.name.text === 'replaceAll')
          ) {
            validateExpr(callee.expression);
            for (const arg of unwrapped.arguments) {
              validateExpr(arg);
            }
            return;
          }
          if (
            ts.isIdentifier(callee) &&
            (APPROVED_FORMATTERS.has(callee.text) || callee.text === 'rupees')
          ) {
            for (const arg of unwrapped.arguments) {
              validateExpr(arg);
            }
            return;
          }
        }

        violations.push(unwrapped.getText());
      }

      for (const ret of returnExprs) {
        validateExpr(ret);
      }

      if (violations.length > 0) {
        results.push({ formatter: name, violations: Array.from(new Set(violations)) });
      }
    }

    function visit(node: ts.Node) {
      if (ts.isFunctionDeclaration(node) && node.name && APPROVED_FORMATTERS.has(node.name.text)) {
        inspectFormatterNode(node.name.text, node);
      } else if (ts.isVariableStatement(node)) {
        for (const decl of node.declarationList.declarations) {
          if (
            ts.isIdentifier(decl.name) &&
            APPROVED_FORMATTERS.has(decl.name.text) &&
            decl.initializer &&
            (ts.isArrowFunction(decl.initializer) || ts.isFunctionExpression(decl.initializer))
          ) {
            inspectFormatterNode(decl.name.text, decl.initializer);
          }
        }
      }
      ts.forEachChild(node, visit);
    }

    visit(sf);
    return results;
  }

  function extractJsxLiterals(filePath: string, sourceOverride?: string): string[] {
    const content = sourceOverride ?? fs.readFileSync(filePath, 'utf-8');
    const sf = ts.createSourceFile(filePath, content, ts.ScriptTarget.Latest, true);
    const literals: string[] = [];

    const isCopyManifestFile = path.resolve(filePath) === canonicalManifestPath;

    function isCopyManifestModule(specText: string, importingFilePath: string = filePath): boolean {
      try {
        let resolved: string;
        if (specText.startsWith('@/')) {
          const projectRoot = path.resolve(storefrontDir, '../../..');
          resolved = path.resolve(projectRoot, 'src', specText.slice(2));
        } else if (specText.startsWith('.')) {
          const importingDir = path.dirname(
            path.isAbsolute(importingFilePath)
              ? importingFilePath
              : path.resolve(storefrontDir, importingFilePath),
          );
          resolved = path.resolve(importingDir, specText);
        } else {
          return false;
        }

        return resolved === canonicalManifestPath || resolved === canonicalManifestPathNoExt;
      } catch {
        return false;
      }
    }

    interface LexicalBinding {
      kind:
        | 'parameter'
        | 'destructured-parameter'
        | 'variable'
        | 'destructured-variable'
        | 'function'
        | 'class';
      node: ts.Node;
      name: string;
      initializer?: ts.Expression | undefined;
      scope: ts.Node;
    }

    // Resolve local lexical binding (parameter, destructured binding, variable declaration, function, or class)
    function resolveLexicalBinding(ident: ts.Identifier): LexicalBinding | null {
      const name = ident.text;
      let curr: ts.Node | undefined = ident.parent;

      function checkBindingElement(
        elem: ts.BindingElement,
        kind: 'destructured-parameter' | 'destructured-variable',
        parentInit?: ts.Expression,
      ): LexicalBinding | null {
        if (ts.isIdentifier(elem.name) && elem.name.text === name) {
          return {
            kind,
            node: elem,
            name,
            initializer: elem.initializer ?? parentInit,
            scope: curr!,
          };
        }
        if (ts.isObjectBindingPattern(elem.name) || ts.isArrayBindingPattern(elem.name)) {
          for (const nested of elem.name.elements) {
            if (ts.isBindingElement(nested)) {
              const res = checkBindingElement(nested, kind, elem.initializer ?? parentInit);
              if (res) return res;
            }
          }
        }
        return null;
      }

      while (curr) {
        if (
          ts.isFunctionDeclaration(curr) ||
          ts.isFunctionExpression(curr) ||
          ts.isArrowFunction(curr) ||
          ts.isMethodDeclaration(curr) ||
          ts.isConstructorDeclaration(curr)
        ) {
          for (const param of curr.parameters) {
            if (ts.isIdentifier(param.name) && param.name.text === name) {
              return {
                kind: 'parameter',
                node: param,
                name,
                initializer: param.initializer,
                scope: curr,
              };
            }
            if (ts.isObjectBindingPattern(param.name) || ts.isArrayBindingPattern(param.name)) {
              for (const elem of param.name.elements) {
                if (ts.isBindingElement(elem)) {
                  const res = checkBindingElement(
                    elem,
                    'destructured-parameter',
                    param.initializer,
                  );
                  if (res) return res;
                }
              }
            }
          }
        }

        if (
          ts.isBlock(curr) ||
          ts.isSourceFile(curr) ||
          ts.isCaseClause(curr) ||
          ts.isDefaultClause(curr)
        ) {
          for (const stmt of curr.statements) {
            if (ts.isVariableStatement(stmt)) {
              for (const decl of stmt.declarationList.declarations) {
                if (ts.isIdentifier(decl.name) && decl.name.text === name) {
                  return {
                    kind: 'variable',
                    node: decl,
                    name,
                    initializer: decl.initializer,
                    scope: curr,
                  };
                }
                if (ts.isObjectBindingPattern(decl.name) || ts.isArrayBindingPattern(decl.name)) {
                  for (const elem of decl.name.elements) {
                    if (ts.isBindingElement(elem)) {
                      const res = checkBindingElement(
                        elem,
                        'destructured-variable',
                        decl.initializer,
                      );
                      if (res) return res;
                    }
                  }
                }
              }
            }
            if (ts.isFunctionDeclaration(stmt) && stmt.name?.text === name) {
              return {
                kind: 'function',
                node: stmt,
                name,
                initializer: undefined,
                scope: curr,
              };
            }
            if (ts.isClassDeclaration(stmt) && stmt.name?.text === name) {
              return {
                kind: 'class',
                node: stmt,
                name,
                initializer: undefined,
                scope: curr,
              };
            }
          }
        }

        curr = curr.parent;
      }
      return null;
    }

    // Verify whether an identifier actually traces to an unaliased import from copy-manifest.ts (PR #46 Round 19)
    function isImportedApprovedFormatter(ident: ts.Identifier, sourceFile: ts.SourceFile): boolean {
      const name = ident.text;
      if (!APPROVED_FORMATTERS.has(name)) {
        return false;
      }
      // If there is ANY local lexical binding (parameter, variable, function, etc.),
      // then ident refers to that local declaration, NOT the import.
      if (resolveLexicalBinding(ident) !== null) {
        return false;
      }
      // Must trace to an unaliased named import from copy-manifest
      for (const stmt of sourceFile.statements) {
        if (!ts.isImportDeclaration(stmt)) continue;
        const moduleSpec = stmt.moduleSpecifier;
        if (!ts.isStringLiteral(moduleSpec)) continue;
        if (!isCopyManifestModule(moduleSpec.text, filePath)) continue;

        const bindings = stmt.importClause?.namedBindings;
        if (!bindings || !ts.isNamedImports(bindings)) continue;

        for (const spec of bindings.elements) {
          const importedName = (spec.propertyName ?? spec.name).text;
          const localName = spec.name.text;
          if (importedName === name && localName === name && spec.propertyName === undefined) {
            return true;
          }
        }
      }
      return false;
    }

    function getDeclaredNames(node: ts.Node): string[] {
      const names: string[] = [];
      if (ts.isVariableDeclaration(node) || ts.isParameter(node) || ts.isBindingElement(node)) {
        if (ts.isIdentifier(node.name)) {
          names.push(node.name.text);
        } else if (ts.isObjectBindingPattern(node.name) || ts.isArrayBindingPattern(node.name)) {
          for (const element of node.name.elements) {
            if (ts.isBindingElement(element)) {
              names.push(...getDeclaredNames(element));
            }
          }
        }
      } else if (
        (ts.isFunctionDeclaration(node) ||
          ts.isFunctionExpression(node) ||
          ts.isClassDeclaration(node) ||
          ts.isTypeAliasDeclaration(node) ||
          ts.isInterfaceDeclaration(node) ||
          ts.isEnumDeclaration(node)) &&
        node.name &&
        ts.isIdentifier(node.name)
      ) {
        names.push(node.name.text);
      }
      return names;
    }

    function collectSubtreeStrings(node: ts.Node): string[] {
      const found: string[] = [];
      function scan(n: ts.Node) {
        if (ts.isStringLiteral(n) || ts.isNoSubstitutionTemplateLiteral(n)) {
          found.push(n.text);
        }
        ts.forEachChild(n, scan);
      }
      scan(node);
      return found;
    }

    function isManifestReference(expr: ts.Expression): boolean {
      const unwrapped = unwrapStaticExpression(expr);
      if (ts.isPropertyAccessExpression(unwrapped)) {
        let curr: ts.Expression = unwrapped;
        while (ts.isPropertyAccessExpression(curr)) {
          curr = curr.expression;
        }
        if (ts.isIdentifier(curr) && curr.text === 'STOREFRONT_COPY_MANIFEST') {
          return true;
        }
      }
      if (ts.isCallExpression(unwrapped)) {
        const fn = unwrapped.expression;
        if (ts.isIdentifier(fn) && isImportedApprovedFormatter(fn, sf)) {
          const name = fn.text;
          if (name !== 'formatCommunityDeliveryNote' && unwrapped.arguments.length === 0) {
            return false;
          }
          const formatterViolations = checkFormatterDefinitions();
          if (formatterViolations.some((res) => res.formatter === name)) {
            return false;
          }
          const relPath = (
            path.isAbsolute(filePath) ? path.relative(storefrontDir, filePath) : filePath
          ).replace(/\\/g, '/');
          const allowed = STOREFRONT_ALLOWED_LITERALS[relPath] ?? new Set<string>();

          for (const arg of unwrapped.arguments) {
            if (!arg) return false;
            const unwrappedArg = unwrapStaticExpression(arg);

            // 1. Recursive manifest reference or approved formatter call
            if (isManifestReference(unwrappedArg)) {
              continue;
            }

            // 2. Static literal: must be on the file allowlist
            const staticStr = resolveStaticString(unwrappedArg);
            if (staticStr !== null) {
              if (allowed.has(staticStr)) {
                continue;
              }
              return false;
            }

            // 3. Dynamic expression: recursively validate via inspectExpression
            const res = inspectExpression(unwrappedArg, false);
            if (!res.sanctioned) {
              return false;
            }
            if (res.extractedStrings.length > 0) {
              const allAllowed = res.extractedStrings.every((s) => allowed.has(s));
              if (!allAllowed) {
                return false;
              }
            }
          }
          return true;
        }
      }
      return false;
    }

    function inspectExpression(
      expr: ts.Expression,
      isClaimAttribute: boolean,
      propName?: string,
    ): { sanctioned: boolean; extractedStrings: string[] } {
      const unwrapped = unwrapStaticExpression(expr);

      // 1. Manifest reference: sanctioned
      if (isManifestReference(unwrapped)) {
        return { sanctioned: true, extractedStrings: [] };
      }

      // 2. Direct string / static concatenation: sanctioned shape, collect string to verify against allowed list
      const staticStr = resolveStaticString(unwrapped);
      if (staticStr !== null) {
        return {
          sanctioned: true,
          extractedStrings: [
            isClaimAttribute && propName ? `${propName}="${staticStr}"` : staticStr,
          ],
        };
      }

      if (isClaimAttribute && propName) {
        // Allowed dynamic claim-bearing attribute initializers (e.g. notice={moved}, notice={cart.notice}, title={`...`})
        if (
          (propName.toLowerCase() === 'notice' &&
            (ts.isIdentifier(unwrapped) || ts.isPropertyAccessExpression(unwrapped))) ||
          ts.isTemplateExpression(unwrapped)
        ) {
          return { sanctioned: true, extractedStrings: [] };
        }
        // Unsanctioned claim-bearing attribute!
        const subtree = collectSubtreeStrings(unwrapped);
        const strings = subtree.map((s) => `${propName}="${s}"`);
        strings.push(`${propName}={${unwrapped.getText(sf).trim().replace(/\s+/g, ' ')}}`);
        return { sanctioned: false, extractedStrings: strings };
      }

      // JSX Child Expressions:
      // 3. JSX Element, Self-Closing Element, Fragment (inner nodes visited by visitor)
      if (
        ts.isJsxElement(unwrapped) ||
        ts.isJsxSelfClosingElement(unwrapped) ||
        ts.isJsxFragment(unwrapped)
      ) {
        return { sanctioned: true, extractedStrings: [] };
      }

      // 4. Approved mapper returning JSX elements (e.g. list.map(...))
      if (
        ts.isCallExpression(unwrapped) &&
        ts.isPropertyAccessExpression(unwrapped.expression) &&
        unwrapped.expression.name.text === 'map'
      ) {
        return { sanctioned: true, extractedStrings: [] };
      }

      // 5. Conditional expression (ternary): collect static strings from branches
      if (ts.isConditionalExpression(unwrapped)) {
        const strings: string[] = [];
        for (const branch of [unwrapped.whenTrue, unwrapped.whenFalse]) {
          const b = unwrapStaticExpression(branch);
          const str = resolveStaticString(b);
          if (str !== null) {
            strings.push(str);
          }
        }
        return { sanctioned: true, extractedStrings: strings };
      }

      // 6. Dynamic identifiers: require proof of origin from manifest or approved domain bindings
      if (ts.isIdentifier(unwrapped)) {
        const name = unwrapped.text;
        const binding = resolveLexicalBinding(unwrapped);

        if (binding?.initializer) {
          if (isManifestReference(binding.initializer)) {
            return { sanctioned: true, extractedStrings: [] };
          }
          const initStrings = collectSubtreeStrings(binding.initializer);
          if (initStrings.length > 0) {
            return { sanctioned: false, extractedStrings: initStrings };
          }
        }

        if (name === 'title' || name === 'subtitle') {
          if (binding?.initializer && isManifestReference(binding.initializer)) {
            return { sanctioned: true, extractedStrings: [] };
          }
          return { sanctioned: false, extractedStrings: [unwrapped.getText(sf)] };
        }

        if (name === 'sentence') {
          if (
            binding?.kind === 'parameter' &&
            ts.isArrowFunction(binding.scope) &&
            binding.scope.parent &&
            ts.isCallExpression(binding.scope.parent) &&
            ts.isPropertyAccessExpression(binding.scope.parent.expression) &&
            binding.scope.parent.expression.name.text === 'map'
          ) {
            return { sanctioned: true, extractedStrings: [] };
          }
          return { sanctioned: false, extractedStrings: [unwrapped.getText(sf)] };
        }

        if (name === 'children') {
          if (
            (binding?.kind === 'parameter' || binding?.kind === 'destructured-parameter') &&
            !binding?.initializer
          ) {
            return { sanctioned: true, extractedStrings: [] };
          }
          return { sanctioned: false, extractedStrings: [unwrapped.getText(sf)] };
        }

        if (name === 'basketCount') {
          return { sanctioned: true, extractedStrings: [] };
        }

        if (name === 'communityName') {
          if (binding?.initializer && ts.isCallExpression(binding.initializer)) {
            const fn = binding.initializer.expression;
            if (ts.isIdentifier(fn) && fn.text === 'communityNameForStore') {
              return { sanctioned: true, extractedStrings: [] };
            }
          }
          return { sanctioned: false, extractedStrings: [unwrapped.getText(sf)] };
        }

        return { sanctioned: false, extractedStrings: [unwrapped.getText(sf)] };
      }

      // 7. Dynamic formatting calls: inspect arguments for string literals (reject trust-by-name String('...'))
      if (ts.isCallExpression(unwrapped)) {
        const fn = unwrapped.expression;
        const argStrings: string[] = [];
        if (ts.isPropertyAccessExpression(fn) && fn.name.text === 'join') {
          // Inspect receiver elements/expression and delimiter argument
          const elemStrings: string[] = [];
          let allSanctioned = true;

          // Inspect receiver
          const receiver = unwrapStaticExpression(fn.expression);
          if (ts.isArrayLiteralExpression(receiver)) {
            for (const elem of receiver.elements) {
              if (ts.isSpreadElement(elem)) {
                allSanctioned = false;
                elemStrings.push(...collectSubtreeStrings(elem));
                continue;
              }
              const unwrappedElem = unwrapStaticExpression(elem);
              if (isManifestReference(unwrappedElem)) {
                continue;
              }
              const staticStr = resolveStaticString(unwrappedElem);
              if (staticStr !== null) {
                elemStrings.push(staticStr);
                continue;
              }
              const res = inspectExpression(unwrappedElem, false);
              if (!res.sanctioned) {
                allSanctioned = false;
              }
              elemStrings.push(...res.extractedStrings);
            }
          } else {
            const receiverRes = inspectExpression(receiver, false);
            if (!receiverRes.sanctioned) {
              allSanctioned = false;
            }
            elemStrings.push(...receiverRes.extractedStrings);
          }

          // Inspect delimiter argument(s)
          const SANCTIONED_JOIN_DELIMITERS = new Set([
            '',
            ' ',
            ', ',
            ',',
            ' · ',
            '; ',
            ' - ',
            '-',
            '\n',
          ]);

          if (unwrapped.arguments.length > 0) {
            const firstArg = unwrapped.arguments[0];
            if (firstArg) {
              const delimArg = unwrapStaticExpression(firstArg);
              if (!isManifestReference(delimArg)) {
                const delimStr = resolveStaticString(delimArg);
                if (delimStr !== null) {
                  if (!SANCTIONED_JOIN_DELIMITERS.has(delimStr)) {
                    allSanctioned = false;
                    elemStrings.push(delimStr);
                  }
                } else {
                  const delimRes = inspectExpression(delimArg, false);
                  if (!delimRes.sanctioned) {
                    allSanctioned = false;
                  }
                  for (const s of delimRes.extractedStrings) {
                    if (!SANCTIONED_JOIN_DELIMITERS.has(s)) {
                      allSanctioned = false;
                      elemStrings.push(s);
                    }
                  }
                  if (!delimRes.sanctioned && delimRes.extractedStrings.length === 0) {
                    elemStrings.push(delimArg.getText(sf));
                  }
                }
              }
            }
            // Any unexpected extra arguments to .join() are treated as unsanctioned
            for (let i = 1; i < unwrapped.arguments.length; i++) {
              const extraArg = unwrapped.arguments[i];
              if (!extraArg) continue;
              allSanctioned = false;
              const extra = collectSubtreeStrings(extraArg);
              if (extra.length > 0) {
                elemStrings.push(...extra);
              } else {
                elemStrings.push(extraArg.getText(sf));
              }
            }
          }

          if (!allSanctioned || elemStrings.length > 0) {
            if (elemStrings.length === 0) {
              elemStrings.push(unwrapped.getText(sf));
            }
            return { sanctioned: false, extractedStrings: elemStrings };
          }
          return { sanctioned: true, extractedStrings: [] };
        } else {
          for (const arg of unwrapped.arguments) {
            argStrings.push(...collectSubtreeStrings(arg));
          }
        }
        if (argStrings.length > 0) {
          return { sanctioned: false, extractedStrings: argStrings };
        }

        if (ts.isIdentifier(fn) && ['rupees', 'String'].includes(fn.text)) {
          return { sanctioned: true, extractedStrings: [] };
        }
        if (ts.isPropertyAccessExpression(fn) && fn.name.text === 'getFullYear') {
          return { sanctioned: true, extractedStrings: [] };
        }
      }

      // 8. Model property access: check root identifier declaration provenance (reject shadowed model roots)
      if (ts.isPropertyAccessExpression(unwrapped)) {
        let curr: ts.Expression = unwrapped;
        while (ts.isPropertyAccessExpression(curr)) {
          curr = curr.expression;
        }
        if (ts.isIdentifier(curr)) {
          const rootName = curr.text;
          const binding = resolveLexicalBinding(curr);
          if (binding?.initializer) {
            if (isManifestReference(binding.initializer)) {
              return { sanctioned: true, extractedStrings: [] };
            }
            const initStrings = collectSubtreeStrings(binding.initializer);
            if (initStrings.length > 0) {
              return { sanctioned: false, extractedStrings: initStrings };
            }
          }

          if (
            ['community', 'line', 'area', 'notice', 'totals', 'issue', 'shop', 'settings'].includes(
              rootName,
            )
          ) {
            return { sanctioned: true, extractedStrings: [] };
          }
        }
      }

      // 9. Nullish coalescing: extract fallback string if static
      if (
        ts.isBinaryExpression(unwrapped) &&
        unwrapped.operatorToken.kind === ts.SyntaxKind.QuestionQuestionToken
      ) {
        const right = unwrapStaticExpression(unwrapped.right);
        const str = resolveStaticString(right);
        const strings = str !== null ? [str] : [];
        return { sanctioned: true, extractedStrings: strings };
      }

      // Unsanctioned shape! Treat as violation outright.
      const subtree = collectSubtreeStrings(unwrapped);
      const exprText = unwrapped.getText(sf).trim().replace(/\s+/g, ' ');
      return {
        sanctioned: false,
        extractedStrings: subtree.length > 0 ? [...subtree, exprText] : [exprText],
      };
    }

    function visit(node: ts.Node) {
      if (!isCopyManifestFile) {
        // Detect local declarations shadowing approved formatters (PR #46 Round 19)
        if (
          ts.isVariableDeclaration(node) ||
          ts.isParameter(node) ||
          ts.isFunctionDeclaration(node) ||
          ts.isFunctionExpression(node) ||
          ts.isClassDeclaration(node)
        ) {
          const names = getDeclaredNames(node);
          for (const declName of names) {
            if (APPROVED_FORMATTERS.has(declName)) {
              literals.push(`shadowed-formatter:${declName}`);
              const subtree = collectSubtreeStrings(node);
              literals.push(...subtree);
              literals.push(node.getText(sf).trim().replace(/\s+/g, ' '));
            }
          }
        } else if (ts.isImportSpecifier(node)) {
          const importedName = (node.propertyName ?? node.name).text;
          const localName = node.name.text;
          if (APPROVED_FORMATTERS.has(importedName) || APPROVED_FORMATTERS.has(localName)) {
            if (node.propertyName !== undefined && node.propertyName.text !== node.name.text) {
              literals.push(`aliased-formatter-import:${node.getText(sf)}`);
            }
            let importDecl: ts.Node | undefined = node.parent;
            while (importDecl && !ts.isImportDeclaration(importDecl)) {
              importDecl = importDecl.parent;
            }
            if (
              importDecl &&
              ts.isImportDeclaration(importDecl) &&
              ts.isStringLiteral(importDecl.moduleSpecifier)
            ) {
              const specText = importDecl.moduleSpecifier.text;
              if (!isCopyManifestModule(specText, filePath)) {
                literals.push(`unapproved-formatter-import:${node.getText(sf)} from ${specText}`);
              }
            }
          }
        } else if (ts.isExportSpecifier(node)) {
          const exportedName = (node.propertyName ?? node.name).text;
          const localName = node.name.text;
          if (APPROVED_FORMATTERS.has(exportedName) || APPROVED_FORMATTERS.has(localName)) {
            if (node.propertyName !== undefined && node.propertyName.text !== node.name.text) {
              literals.push(`aliased-formatter-export:${node.getText(sf)}`);
            }
          }
        }
      }

      if (ts.isJsxText(node)) {
        const text = node.text.trim().replace(/\s+/g, ' ');
        if (text) literals.push(text);
      } else if (ts.isJsxExpression(node)) {
        if (!node.parent || !ts.isJsxAttribute(node.parent)) {
          if (node.expression) {
            const res = inspectExpression(node.expression, false);
            for (const s of res.extractedStrings) {
              const text = s.trim().replace(/\s+/g, ' ');
              if (text) literals.push(text);
            }
          }
        }
      } else if (ts.isJsxAttribute(node)) {
        const propName = node.name.getText(sf);
        if (
          ['title', 'subtitle', 'badge', 'heading', 'description', 'notice'].includes(
            propName.toLowerCase(),
          )
        ) {
          if (node.initializer) {
            if (ts.isStringLiteral(node.initializer)) {
              literals.push(`${propName}="${node.initializer.text}"`);
            } else if (ts.isJsxExpression(node.initializer) && node.initializer.expression) {
              const res = inspectExpression(node.initializer.expression, true, propName);
              for (const s of res.extractedStrings) {
                const text = s.trim().replace(/\s+/g, ' ');
                if (text) literals.push(text);
              }
            }
          }
        }
      }
      ts.forEachChild(node, visit);
    }

    visit(sf);
    return literals;
  }

  test('all storefront components importing STOREFRONT_COPY_MANIFEST strictly forbid unauthorized inline literals via dynamic AST scan', () => {
    // Dynamically discover every .tsx file under src/app/(storefront) that imports STOREFRONT_COPY_MANIFEST
    const manifestConsumerFiles = storefrontFiles.filter((filePath) => {
      if (!filePath.endsWith('.tsx') || path.resolve(filePath) === canonicalManifestPath)
        return false;
      const content = fs.readFileSync(filePath, 'utf-8');
      return (
        /import\s+.*STOREFRONT_COPY_MANIFEST.*from/s.test(content) ||
        content.includes('STOREFRONT_COPY_MANIFEST')
      );
    });

    // Ensure comprehensive coverage across the storefront surface (at least 7 TSX files)
    expect(manifestConsumerFiles.length).toBeGreaterThanOrEqual(7);

    for (const filePath of manifestConsumerFiles) {
      const relPath = path.relative(storefrontDir, filePath).replace(/\\/g, '/');
      const allowed = STOREFRONT_ALLOWED_LITERALS[relPath] ?? new Set<string>();
      const literals = extractJsxLiterals(filePath);
      const unauthorized = literals.filter((lit) => !allowed.has(lit));

      expect(
        unauthorized,
        `Unauthorized inline literals found in ${relPath}:\n${unauthorized.join('\n')}\nMarketing, claims, and operational commitments MUST be defined in STOREFRONT_COPY_MANIFEST.`,
      ).toEqual([]);
    }
  });

  test('God bypass probe rejection: an unauthorized inline guarantee in about/page.tsx fails the AST scanner', () => {
    // God Round 8 probe: adding a brand-new unmodeled claim:
    // 'Every order is backed by our 100% satisfaction guarantee.' to about/page.tsx
    // without touching or removing any existing manifest leaf.
    const aboutPath = path.join(storefrontDir, 'about/page.tsx');
    const aboutSource = fs.readFileSync(aboutPath, 'utf-8');

    const simulatedGodAbout = aboutSource.replace(
      '</section>',
      '<p>Every order is backed by our 100% satisfaction guarantee.</p></section>',
    );

    const literals = extractJsxLiterals(aboutPath, simulatedGodAbout);
    const allowed = STOREFRONT_ALLOWED_LITERALS['about/page.tsx'] ?? new Set<string>();
    const unauthorized = literals.filter((lit) => !allowed.has(lit));
    expect(unauthorized).toContain('Every order is backed by our 100% satisfaction guarantee.');
  });

  test('God bypass probe rejection: an unauthorized inline guarantee in cart/page.tsx fails the AST scanner', () => {
    // God Round 9 probe: adding a brand-new unmodeled claim:
    // 'Free same-day delivery guaranteed on every order.' to cart/page.tsx
    // without touching or removing any existing manifest leaf.
    const cartPath = path.join(storefrontDir, 'cart/page.tsx');
    const cartSource = fs.readFileSync(cartPath, 'utf-8');

    const simulatedGodCart = cartSource.replace(
      '</Card>',
      '<p>Free same-day delivery guaranteed on every order.</p></Card>',
    );

    const literals = extractJsxLiterals(cartPath, simulatedGodCart);
    const allowed = STOREFRONT_ALLOWED_LITERALS['cart/page.tsx'] ?? new Set<string>();
    const unauthorized = literals.filter((lit) => !allowed.has(lit));
    expect(unauthorized).toContain('Free same-day delivery guaranteed on every order.');
  });

  test('God bypass probe rejection: an unauthorized JSX-expression-wrapped claim in shop/page.tsx fails the AST scanner', () => {
    // God Round 10 probe: injecting an unauthorized claim wrapped in a JSX expression:
    // <p>{'All orders include a complimentary gift.'}</p> into shop/page.tsx
    const shopPath = path.join(storefrontDir, 'shop/page.tsx');
    const shopSource = fs.readFileSync(shopPath, 'utf-8');

    const simulatedGodShop = shopSource.replace(
      '</Card>',
      "<p>{'All orders include a complimentary gift.'}</p>\n<p>{`Every item is handpicked with care.`}</p></Card>",
    );

    const literals = extractJsxLiterals(shopPath, simulatedGodShop);
    const allowed = STOREFRONT_ALLOWED_LITERALS['shop/page.tsx'] ?? new Set<string>();
    const unauthorized = literals.filter((lit) => !allowed.has(lit));
    expect(unauthorized).toContain('All orders include a complimentary gift.');
    expect(unauthorized).toContain('Every item is handpicked with care.');
  });

  test('Oscar bypass probe rejection: an unauthorized parenthesized JSX expression string in shop/page.tsx fails the AST scanner (Round 11)', () => {
    // Oscar Round 10 / Round 11 probe: injecting an unauthorized claim wrapped in parens and type assertions:
    // <p>{('Every order includes a complimentary gift.')}</p> into shop/page.tsx
    const shopPath = path.join(storefrontDir, 'shop/page.tsx');
    const shopSource = fs.readFileSync(shopPath, 'utf-8');

    const simulatedOscarShop = shopSource.replace(
      '</Card>',
      "<p>{('Every order includes a complimentary gift.')}</p>\n<p>{((('Freshly harvested daily.') as string))}</p>\n<p>{('No hidden fees ' + 'ever.') satisfies string}</p></Card>",
    );

    const literals = extractJsxLiterals(shopPath, simulatedOscarShop);
    const allowed = STOREFRONT_ALLOWED_LITERALS['shop/page.tsx'] ?? new Set<string>();
    const unauthorized = literals.filter((lit) => !allowed.has(lit));
    expect(unauthorized).toContain('Every order includes a complimentary gift.');
    expect(unauthorized).toContain('Freshly harvested daily.');
    expect(unauthorized).toContain('No hidden fees ever.');
  });

  test('Oscar bypass probe rejection: logical &&, function call, and property access expressions are rejected by allowlist-by-default guard (Round 12)', () => {
    // Oscar Round 12 probe: logical AND conditional rendering:
    // <p>{true && 'Every order includes a complimentary gift.'}</p>
    // plus function call producing a string and unapproved property access
    const shopPath = path.join(storefrontDir, 'shop/page.tsx');
    const shopSource = fs.readFileSync(shopPath, 'utf-8');

    const simulatedOscarShop = shopSource.replace(
      '</Card>',
      `<p>{true && 'Every order includes a complimentary gift.'}</p>
<p>{getPromotionalGuarantee()}</p>
<p>{promotions.orderGuarantee}</p></Card>`,
    );

    const literals = extractJsxLiterals(shopPath, simulatedOscarShop);
    const allowed = STOREFRONT_ALLOWED_LITERALS['shop/page.tsx'] ?? new Set<string>();
    const unauthorized = literals.filter((lit) => !allowed.has(lit));

    expect(unauthorized).toContain('Every order includes a complimentary gift.');
    expect(unauthorized).toContain('getPromotionalGuarantee()');
    expect(unauthorized).toContain('promotions.orderGuarantee');
  });

  test('Oscar bypass probe rejection: trust-by-name smuggling via String(...), local arbitrary variables, and shadowed model roots are rejected (Round 13)', () => {
    // Oscar Round 13 probes:
    // 1. Wrapping unauthorized copy in String(...)
    // 2. Assigning unauthorized copy to an identifier sharing a safe name (const sentence = '...')
    // 3. Shadowing a safe model root with arbitrary copy (const community = { name: '...' })
    const shopPath = path.join(storefrontDir, 'shop/page.tsx');
    const shopSource = fs.readFileSync(shopPath, 'utf-8');

    // Probe 1: String('...')
    const probe1Source = shopSource.replace(
      '</Card>',
      `<p>{String('Every order includes a complimentary gift.')}</p></Card>`,
    );
    const literals1 = extractJsxLiterals(shopPath, probe1Source);
    const allowed = STOREFRONT_ALLOWED_LITERALS['shop/page.tsx'] ?? new Set<string>();
    const unauthorized1 = literals1.filter((lit) => !allowed.has(lit));
    expect(unauthorized1).toContain('Every order includes a complimentary gift.');

    // Probe 2: local arbitrary variable named 'sentence'
    const probe2Source = shopSource
      .replace(
        'export default async function ShopPage',
        "const sentence = 'Every order includes a complimentary gift.';\nexport default async function ShopPage",
      )
      .replace('</Card>', '<p>{sentence}</p></Card>');
    const literals2 = extractJsxLiterals(shopPath, probe2Source);
    const unauthorized2 = literals2.filter((lit) => !allowed.has(lit));
    expect(unauthorized2).toContain('Every order includes a complimentary gift.');

    // Probe 3: shadowed safe model root (community.name)
    const probe3Source = shopSource
      .replace(
        'export default async function ShopPage',
        "const community = { name: 'Every order includes a complimentary gift.' };\nexport default async function ShopPage",
      )
      .replace('</Card>', '<p>{community.name}</p></Card>');
    const literals3 = extractJsxLiterals(shopPath, probe3Source);
    const unauthorized3 = literals3.filter((lit) => !allowed.has(lit));
    expect(unauthorized3).toContain('Every order includes a complimentary gift.');
  });

  test('Oscar bypass probe rejection: parameter defaults bypass declaration provenance (Round 14)', () => {
    // Oscar Round 14 probe (finding M9):
    // A component parameter default `sentence = 'Every order includes a complimentary gift.'`
    // rendered as `<p>{sentence}</p>` inside Card.
    const shopPath = path.join(storefrontDir, 'shop/page.tsx');
    const shopSource = fs.readFileSync(shopPath, 'utf-8');

    const probeSource = shopSource
      .replace(
        'export default async function ShopPage',
        `function Promotion({
  sentence = 'Every order includes a complimentary gift.',
}: {
  sentence?: string;
}) {
  return <p>{sentence}</p>;
}

export default async function ShopPage`,
      )
      .replace('</Card>', '<Promotion /></Card>');

    const literals = extractJsxLiterals(shopPath, probeSource);
    const allowed = STOREFRONT_ALLOWED_LITERALS['shop/page.tsx'] ?? new Set<string>();
    const unauthorized = literals.filter((lit) => !allowed.has(lit));
    expect(unauthorized).toContain('Every order includes a complimentary gift.');
  });

  test('Oscar bypass probe rejection: .join() trusts receiver array by method name alone (Round 15)', () => {
    // Oscar Round 15 probe:
    // Receiver array `['Every order includes a complimentary gift.'].join('')`
    // rendered directly in JSX.
    const shopPath = path.join(storefrontDir, 'shop/page.tsx');
    const shopSource = fs.readFileSync(shopPath, 'utf-8');

    const probeSource = shopSource.replace(
      '</Card>',
      `<p>{['Every order includes a complimentary gift.'].join('')}</p></Card>`,
    );

    const literals = extractJsxLiterals(shopPath, probeSource);
    const allowed = STOREFRONT_ALLOWED_LITERALS['shop/page.tsx'] ?? new Set<string>();
    const unauthorized = literals.filter((lit) => !allowed.has(lit));
    expect(unauthorized).toContain('Every order includes a complimentary gift.');
  });

  test('Oscar bypass probe rejection: .join() delimiter trusts arbitrary string content (Round 16)', () => {
    // Oscar Round 16 probe:
    // Two sanctioned manifest references joined with an unauthorized delimiter string.
    const shopPath = path.join(storefrontDir, 'shop/page.tsx');
    const shopSource = fs.readFileSync(shopPath, 'utf-8');

    const probeSource = shopSource.replace(
      '</Card>',
      `<p>
        {[STOREFRONT_COPY_MANIFEST.shop.pausedNotice, STOREFRONT_COPY_MANIFEST.shop.pausedNotice].join(
          ' Every order includes a complimentary gift. ',
        )}
      </p></Card>`,
    );

    const literals = extractJsxLiterals(shopPath, probeSource);
    const allowed = STOREFRONT_ALLOWED_LITERALS['shop/page.tsx'] ?? new Set<string>();
    const unauthorized = literals.filter((lit) => !allowed.has(lit));
    expect(unauthorized).toContain('Every order includes a complimentary gift.');
  });

  test('Oscar bypass probe rejection: isManifestReference trusts formatter callee name without argument inspection (.join delimiter) (Round 17)', () => {
    // Oscar Round 17 probe:
    // Approved formatter formatShopSubtitle('Every order includes a complimentary gift.', '')
    // passed as .join() delimiter to sanctioned manifest references.
    const shopPath = path.join(storefrontDir, 'shop/page.tsx');
    const shopSource = fs.readFileSync(shopPath, 'utf-8');

    const probeSource = shopSource.replace(
      '</Card>',
      `<p>
        {[STOREFRONT_COPY_MANIFEST.shop.pausedNotice, STOREFRONT_COPY_MANIFEST.shop.pausedNotice].join(
          formatShopSubtitle('Every order includes a complimentary gift.', ''),
        )}
      </p></Card>`,
    );

    const literals = extractJsxLiterals(shopPath, probeSource);
    const allowed = STOREFRONT_ALLOWED_LITERALS['shop/page.tsx'] ?? new Set<string>();
    const unauthorized = literals.filter((lit) => !allowed.has(lit));
    expect(unauthorized).toContain('Every order includes a complimentary gift.');
  });

  test('Oscar bypass probe rejection: isManifestReference rejects uninspected formatter arguments in direct JSX rendering (Round 17)', () => {
    // Direct JSX child rendering of approved formatter with unauthorized copy argument.
    const shopPath = path.join(storefrontDir, 'shop/page.tsx');
    const shopSource = fs.readFileSync(shopPath, 'utf-8');

    const probeSource = shopSource.replace(
      '</Card>',
      `<p>{formatShopSubtitle('Every order includes a complimentary gift.', '')}</p></Card>`,
    );

    const literals = extractJsxLiterals(shopPath, probeSource);
    const allowed = STOREFRONT_ALLOWED_LITERALS['shop/page.tsx'] ?? new Set<string>();
    const unauthorized = literals.filter((lit) => !allowed.has(lit));
    expect(unauthorized).toContain('Every order includes a complimentary gift.');
  });

  test('Oscar bypass probe rejection: isManifestReference rejects uninspected formatter arguments in .join() receiver elements (Round 17)', () => {
    // Approved formatter with unauthorized copy argument inside .join() receiver array.
    const shopPath = path.join(storefrontDir, 'shop/page.tsx');
    const shopSource = fs.readFileSync(shopPath, 'utf-8');

    const probeSource = shopSource.replace(
      '</Card>',
      `<p>{[formatShopSubtitle('Every order includes a complimentary gift.', '')].join('')}</p></Card>`,
    );

    const literals = extractJsxLiterals(shopPath, probeSource);
    const allowed = STOREFRONT_ALLOWED_LITERALS['shop/page.tsx'] ?? new Set<string>();
    const unauthorized = literals.filter((lit) => !allowed.has(lit));
    expect(unauthorized).toContain('Every order includes a complimentary gift.');
  });

  test('Oscar bypass probe rejection: isManifestReference rejects uninspected formatter arguments in claim attributes (Round 17)', () => {
    // Approved formatter with unauthorized copy argument passed to claim-bearing JSX attribute.
    const shopPath = path.join(storefrontDir, 'shop/page.tsx');
    const shopSource = fs.readFileSync(shopPath, 'utf-8');

    const probeSource = shopSource.replace(
      'title={`All Products (${String(shop.total)} available)`}',
      `title="All Products" subtitle={formatShopSubtitle('Every order includes a complimentary gift.', '')}`,
    );

    const literals = extractJsxLiterals(shopPath, probeSource);
    const allowed = STOREFRONT_ALLOWED_LITERALS['shop/page.tsx'] ?? new Set<string>();
    const unauthorized = literals.filter((lit) => !allowed.has(lit));
    expect(unauthorized.some((u) => u.includes('Every order includes a complimentary gift.'))).toBe(
      true,
    );
  });

  test('approved formatter definitions in copy-manifest.ts are strictly built only from parameters, manifest references, and allowed static pieces', () => {
    const results = checkFormatterDefinitions();
    expect(
      results,
      `Approved formatters in copy-manifest.ts contain unauthorized expressions or unapproved string literals:\n${results
        .map((r) => `${r.formatter}: ${r.violations.join(', ')}`)
        .join('\n')}`,
    ).toEqual([]);
  });

  test('Oscar bypass probe rejection: unauthorized hardcoded string added inside formatter body fails definition AST scanner (Round 18)', () => {
    // Oscar Round 17 evidence mutant:
    // agents/oscar-reviewer-mtolwvnc/evidence/pr46-round17-formatter-body-bypass.txt
    // Prepending 'Every order includes a complimentary gift. ' inside formatShopSubtitle body in copy-manifest.ts
    const manifestPath = canonicalManifestPath;
    const originalSource = fs.readFileSync(manifestPath, 'utf-8');

    const probeSource = originalSource.replace(
      '`${STOREFRONT_COPY_MANIFEST.cart.scheduledSlotBadge} · Delivery ${deliveryFeeFormatted} · Min order ${minOrderFormatted}`',
      '`Every order includes a complimentary gift. ${STOREFRONT_COPY_MANIFEST.cart.scheduledSlotBadge} · Delivery ${deliveryFeeFormatted} · Min order ${minOrderFormatted}`',
    );

    expect(probeSource).not.toEqual(originalSource);

    const results = checkFormatterDefinitions(probeSource);
    const shopSubtitleViolations = results.find((r) => r.formatter === 'formatShopSubtitle');
    expect(shopSubtitleViolations).toBeDefined();
    expect(
      shopSubtitleViolations?.violations.some((v) =>
        v.includes('Every order includes a complimentary gift.'),
      ),
    ).toBe(true);
  });

  test('Oscar bypass probe rejection: unauthorized hardcoded suffix string inside formatter body fails definition AST scanner (Round 18)', () => {
    const manifestPath = canonicalManifestPath;
    const originalSource = fs.readFileSync(manifestPath, 'utf-8');

    const probeSource = originalSource.replace(
      '`${STOREFRONT_COPY_MANIFEST.cart.scheduledSlotBadge} · Delivery ${deliveryFeeFormatted} · Min order ${minOrderFormatted}`',
      '`${STOREFRONT_COPY_MANIFEST.cart.scheduledSlotBadge} · Delivery ${deliveryFeeFormatted} · Min order ${minOrderFormatted} — guaranteed fresh!`',
    );

    expect(probeSource).not.toEqual(originalSource);

    const results = checkFormatterDefinitions(probeSource);
    const shopSubtitleViolations = results.find((r) => r.formatter === 'formatShopSubtitle');
    expect(shopSubtitleViolations).toBeDefined();
    expect(shopSubtitleViolations?.violations.some((v) => v.includes('guaranteed fresh!'))).toBe(
      true,
    );
  });

  test('Oscar bypass probe rejection: unauthorized internal variable inside formatter body fails definition AST scanner (Round 18)', () => {
    const manifestPath = canonicalManifestPath;
    const originalSource = fs.readFileSync(manifestPath, 'utf-8');

    const probeSource = originalSource.replace(
      'return `${STOREFRONT_COPY_MANIFEST.cart.scheduledSlotBadge} · Delivery ${deliveryFeeFormatted} · Min order ${minOrderFormatted}`;',
      `const extraPerk = 'Complimentary gift with purchase.';\n  return \`\${extraPerk} \${STOREFRONT_COPY_MANIFEST.cart.scheduledSlotBadge} · Delivery \${deliveryFeeFormatted} · Min order \${minOrderFormatted}\`;`,
    );

    expect(probeSource).not.toEqual(originalSource);

    const results = checkFormatterDefinitions(probeSource);
    const shopSubtitleViolations = results.find((r) => r.formatter === 'formatShopSubtitle');
    expect(shopSubtitleViolations).toBeDefined();
    expect(
      shopSubtitleViolations?.violations.some((v) =>
        v.includes('Complimentary gift with purchase.'),
      ),
    ).toBe(true);
  });

  test('Oscar bypass probe rejection: corrupted formatter definition in copy-manifest causes call site in shop/page.tsx to reject the reference (Round 18)', () => {
    const manifestPath = canonicalManifestPath;
    const originalManifest = fs.readFileSync(manifestPath, 'utf-8');

    const corruptedManifest = originalManifest.replace(
      '`${STOREFRONT_COPY_MANIFEST.cart.scheduledSlotBadge} · Delivery ${deliveryFeeFormatted} · Min order ${minOrderFormatted}`',
      '`Every order includes a complimentary gift. ${STOREFRONT_COPY_MANIFEST.cart.scheduledSlotBadge} · Delivery ${deliveryFeeFormatted} · Min order ${minOrderFormatted}`',
    );

    // Write the corrupted manifest temporarily to test end-to-end call site rejection
    fs.writeFileSync(manifestPath, corruptedManifest, 'utf-8');
    try {
      const shopPath = path.join(storefrontDir, 'shop/page.tsx');
      const literals = extractJsxLiterals(shopPath);
      const allowed = STOREFRONT_ALLOWED_LITERALS['shop/page.tsx'] ?? new Set<string>();
      const unauthorized = literals.filter((lit) => !allowed.has(lit));

      // With formatShopSubtitle corrupted in copy-manifest.ts, isManifestReference returns false,
      // flagging formatShopSubtitle at the call site!
      expect(unauthorized.length).toBeGreaterThan(0);
    } finally {
      // Restore original manifest immediately
      fs.writeFileSync(manifestPath, originalManifest, 'utf-8');
    }
  });

  test('Oscar bypass probe rejection: shadowed approved formatter returning unauthorized copy fails import-binding resolution (Round 19)', () => {
    // Oscar Round 18 evidence mutant:
    // agents/oscar-reviewer-mtolwvnc/evidence/pr46-round18-shadowed-formatter-bypass.txt
    // Local arrow function formatShopSubtitle shadowing the real import from copy-manifest.ts
    // and returning unauthorized copy, called with a legitimate manifest argument.
    const shopPath = path.join(storefrontDir, 'shop/page.tsx');
    const originalSource = fs.readFileSync(shopPath, 'utf-8');

    const probeSource = originalSource
      .replace(
        'export const metadata: Metadata = {',
        `function Promotion(): React.ReactElement {\n  const formatShopSubtitle = (_approved: string): string =>\n    'Every order includes a complimentary gift.';\n  return <p>{formatShopSubtitle(STOREFRONT_COPY_MANIFEST.shop.pausedNotice)}</p>;\n}\n\nexport const metadata: Metadata = {`,
      )
      .replace('</Card>', '  <Promotion />\n      </Card>');

    expect(probeSource).not.toEqual(originalSource);

    const literals = extractJsxLiterals(shopPath, probeSource);
    const allowed = STOREFRONT_ALLOWED_LITERALS['shop/page.tsx'] ?? new Set<string>();
    const unauthorized = literals.filter((lit) => !allowed.has(lit));

    expect(unauthorized.length).toBeGreaterThan(0);
    expect(
      unauthorized.some((lit) => lit.includes('Every order includes a complimentary gift.')),
    ).toBe(true);
    expect(unauthorized.some((lit) => lit.includes('shadowed-formatter:formatShopSubtitle'))).toBe(
      true,
    );
  });

  test('Oscar bypass probe rejection: local function declaration shadowing approved formatter is rejected (Round 19)', () => {
    const shopPath = path.join(storefrontDir, 'shop/page.tsx');
    const originalSource = fs.readFileSync(shopPath, 'utf-8');

    const probeSource = originalSource
      .replace(
        'export const metadata: Metadata = {',
        `function Promotion(): React.ReactElement {\n  function formatShopSubtitle(_approved: string): string {\n    return 'Every order includes a complimentary gift.';\n  }\n  return <p>{formatShopSubtitle(STOREFRONT_COPY_MANIFEST.shop.pausedNotice)}</p>;\n}\n\nexport const metadata: Metadata = {`,
      )
      .replace('</Card>', '  <Promotion />\n      </Card>');

    expect(probeSource).not.toEqual(originalSource);

    const literals = extractJsxLiterals(shopPath, probeSource);
    const allowed = STOREFRONT_ALLOWED_LITERALS['shop/page.tsx'] ?? new Set<string>();
    const unauthorized = literals.filter((lit) => !allowed.has(lit));

    expect(unauthorized.length).toBeGreaterThan(0);
    expect(
      unauthorized.some((lit) => lit.includes('Every order includes a complimentary gift.')),
    ).toBe(true);
    expect(unauthorized.some((lit) => lit.includes('shadowed-formatter:formatShopSubtitle'))).toBe(
      true,
    );
  });

  test('Oscar bypass probe rejection: parameter declaration shadowing approved formatter is rejected (Round 19)', () => {
    const shopPath = path.join(storefrontDir, 'shop/page.tsx');
    const originalSource = fs.readFileSync(shopPath, 'utf-8');

    const probeSource = originalSource
      .replace(
        'export const metadata: Metadata = {',
        `function Promotion({ formatShopSubtitle }: { formatShopSubtitle: (_approved: string) => string }): React.ReactElement {\n  return <p>{formatShopSubtitle(STOREFRONT_COPY_MANIFEST.shop.pausedNotice)}</p>;\n}\n\nexport const metadata: Metadata = {`,
      )
      .replace(
        '</Card>',
        '  <Promotion formatShopSubtitle={() => "Complimentary gift."} />\n      </Card>',
      );

    expect(probeSource).not.toEqual(originalSource);

    const literals = extractJsxLiterals(shopPath, probeSource);
    const allowed = STOREFRONT_ALLOWED_LITERALS['shop/page.tsx'] ?? new Set<string>();
    const unauthorized = literals.filter((lit) => !allowed.has(lit));

    expect(unauthorized.length).toBeGreaterThan(0);
    expect(unauthorized.some((lit) => lit.includes('shadowed-formatter:formatShopSubtitle'))).toBe(
      true,
    );
  });

  test('Oscar bypass probe rejection: dead local shadow function declared without JSX invocation is rejected (Round 19)', () => {
    const shopPath = path.join(storefrontDir, 'shop/page.tsx');
    const originalSource = fs.readFileSync(shopPath, 'utf-8');

    const probeSource = originalSource.replace(
      'export const metadata: Metadata = {',
      `function UncalledPromotion(): React.ReactElement {\n  const formatShopSubtitle = (_approved: string): string =>\n    'Every order includes a complimentary gift.';\n  return <p>Safe text</p>;\n}\n\nexport const metadata: Metadata = {`,
    );

    expect(probeSource).not.toEqual(originalSource);

    const literals = extractJsxLiterals(shopPath, probeSource);
    const allowed = STOREFRONT_ALLOWED_LITERALS['shop/page.tsx'] ?? new Set<string>();
    const unauthorized = literals.filter((lit) => !allowed.has(lit));

    expect(unauthorized.length).toBeGreaterThan(0);
    expect(unauthorized.some((lit) => lit.includes('shadowed-formatter:formatShopSubtitle'))).toBe(
      true,
    );
    expect(
      unauthorized.some((lit) => lit.includes('Every order includes a complimentary gift.')),
    ).toBe(true);
  });

  test('Oscar bypass probe rejection: aliased import of approved formatter is rejected (Round 19)', () => {
    const shopPath = path.join(storefrontDir, 'shop/page.tsx');
    const originalSource = fs.readFileSync(shopPath, 'utf-8');

    const probeSource = originalSource.replace(
      "import { STOREFRONT_COPY_MANIFEST, formatShopSubtitle } from '../copy-manifest';",
      "import { STOREFRONT_COPY_MANIFEST, formatShopSubtitle as aliasedSubtitle } from '../copy-manifest';",
    );

    expect(probeSource).not.toEqual(originalSource);

    const literals = extractJsxLiterals(shopPath, probeSource);
    const allowed = STOREFRONT_ALLOWED_LITERALS['shop/page.tsx'] ?? new Set<string>();
    const unauthorized = literals.filter((lit) => !allowed.has(lit));

    expect(unauthorized.length).toBeGreaterThan(0);
    expect(unauthorized.some((lit) => lit.includes('aliased-formatter-import:'))).toBe(true);
  });

  test('Oscar bypass probe rejection: import of approved formatter from unapproved module is rejected (Round 19)', () => {
    const shopPath = path.join(storefrontDir, 'shop/page.tsx');
    const originalSource = fs.readFileSync(shopPath, 'utf-8');

    const probeSource = originalSource.replace(
      "import { STOREFRONT_COPY_MANIFEST, formatShopSubtitle } from '../copy-manifest';",
      "import { STOREFRONT_COPY_MANIFEST } from '../copy-manifest';\nimport { formatShopSubtitle } from './unapproved-module';",
    );

    expect(probeSource).not.toEqual(originalSource);

    const literals = extractJsxLiterals(shopPath, probeSource);
    const allowed = STOREFRONT_ALLOWED_LITERALS['shop/page.tsx'] ?? new Set<string>();
    const unauthorized = literals.filter((lit) => !allowed.has(lit));

    expect(unauthorized.length).toBeGreaterThan(0);
    expect(unauthorized.some((lit) => lit.includes('unapproved-formatter-import:'))).toBe(true);
  });

  test('only the single canonical copy-manifest.ts exists in the storefront hierarchy (Round 20)', () => {
    const manifestNamedFiles = storefrontFiles.filter((file) =>
      path.basename(file).startsWith('copy-manifest.'),
    );
    expect(manifestNamedFiles).toEqual([canonicalManifestPath]);
  });

  test('Oscar bypass probe rejection: sibling/nested file named copy-manifest.ts imported for formatters fails exact canonical path resolution (Round 20)', () => {
    // Oscar Round 19 evidence mutant:
    // agents/oscar-reviewer-mtolwvnc/evidence/pr46-round19-copy-manifest-suffix-import-bypass.txt
    // An unrelated file at ./evil/copy-manifest.ts (or sibling/nested path ending in copy-manifest)
    // exporting an unaliased formatShopSubtitle with unauthorized copy, imported by shop/page.tsx
    // and called with legitimate manifest arguments.
    const shopPath = path.join(storefrontDir, 'shop/page.tsx');
    const originalSource = fs.readFileSync(shopPath, 'utf-8');

    // Mutant 1: importing from nested ./evil/copy-manifest
    const probeSourceNested = originalSource.replace(
      "import { STOREFRONT_COPY_MANIFEST, formatShopSubtitle } from '../copy-manifest';",
      "import { STOREFRONT_COPY_MANIFEST } from '../copy-manifest';\nimport { formatShopSubtitle } from './evil/copy-manifest';",
    );

    expect(probeSourceNested).not.toEqual(originalSource);

    const literalsNested = extractJsxLiterals(shopPath, probeSourceNested);
    const allowed = STOREFRONT_ALLOWED_LITERALS['shop/page.tsx'] ?? new Set<string>();
    const unauthorizedNested = literalsNested.filter((lit) => !allowed.has(lit));

    expect(unauthorizedNested.length).toBeGreaterThan(0);
    expect(
      unauthorizedNested.some((lit) =>
        lit.includes('unapproved-formatter-import:formatShopSubtitle from ./evil/copy-manifest'),
      ),
    ).toBe(true);

    // Mutant 2: importing from sibling ./copy-manifest (relative to shop/page.tsx)
    const probeSourceSibling = originalSource.replace(
      "import { STOREFRONT_COPY_MANIFEST, formatShopSubtitle } from '../copy-manifest';",
      "import { STOREFRONT_COPY_MANIFEST } from '../copy-manifest';\nimport { formatShopSubtitle } from './copy-manifest';",
    );

    expect(probeSourceSibling).not.toEqual(originalSource);

    const literalsSibling = extractJsxLiterals(shopPath, probeSourceSibling);
    const unauthorizedSibling = literalsSibling.filter((lit) => !allowed.has(lit));

    expect(unauthorizedSibling.length).toBeGreaterThan(0);
    expect(
      unauthorizedSibling.some((lit) =>
        lit.includes('unapproved-formatter-import:formatShopSubtitle from ./copy-manifest'),
      ),
    ).toBe(true);

    // Mutant 3: importing via aliased path pointing to an evil nested copy-manifest
    const probeSourceAliased = originalSource.replace(
      "import { STOREFRONT_COPY_MANIFEST, formatShopSubtitle } from '../copy-manifest';",
      "import { STOREFRONT_COPY_MANIFEST } from '../copy-manifest';\nimport { formatShopSubtitle } from '@/app/(storefront)/shop/evil/copy-manifest';",
    );

    expect(probeSourceAliased).not.toEqual(originalSource);

    const literalsAliased = extractJsxLiterals(shopPath, probeSourceAliased);
    const unauthorizedAliased = literalsAliased.filter((lit) => !allowed.has(lit));

    expect(unauthorizedAliased.length).toBeGreaterThan(0);
    expect(
      unauthorizedAliased.some((lit) =>
        lit.includes(
          'unapproved-formatter-import:formatShopSubtitle from @/app/(storefront)/shop/evil/copy-manifest',
        ),
      ),
    ).toBe(true);
  });

  test('Oscar bypass probe rejection: actual rogue copy-manifest.ts on disk is rejected by import-binding resolution and structural uniqueness (Round 20)', () => {
    const evilDir = path.join(storefrontDir, 'shop', 'evil');
    const evilFile = path.join(evilDir, 'copy-manifest.ts');
    const shopPath = path.join(storefrontDir, 'shop', 'page.tsx');
    const originalShopSource = fs.readFileSync(shopPath, 'utf-8');

    fs.mkdirSync(evilDir, { recursive: true });
    fs.writeFileSync(
      evilFile,
      `export function formatShopSubtitle(_approved: string): string {\n  return 'Every order includes a complimentary gift.';\n}\n`,
      'utf-8',
    );

    try {
      // 1. Structural check: only the one canonical copy-manifest.ts is allowed
      const filesNow = getFiles(storefrontDir);
      const manifestNamedFiles = filesNow.filter((file) =>
        path.basename(file).startsWith('copy-manifest.'),
      );
      expect(manifestNamedFiles.length).toBeGreaterThan(1);

      // 2. Importing from the rogue copy-manifest in shop/page.tsx
      const probeSource = originalShopSource.replace(
        "import { STOREFRONT_COPY_MANIFEST, formatShopSubtitle } from '../copy-manifest';",
        "import { STOREFRONT_COPY_MANIFEST } from '../copy-manifest';\nimport { formatShopSubtitle } from './evil/copy-manifest';",
      );
      const literals = extractJsxLiterals(shopPath, probeSource);
      const allowed = STOREFRONT_ALLOWED_LITERALS['shop/page.tsx'] ?? new Set<string>();
      const unauthorized = literals.filter((lit) => !allowed.has(lit));

      expect(unauthorized.length).toBeGreaterThan(0);
      expect(
        unauthorized.some((lit) =>
          lit.includes('unapproved-formatter-import:formatShopSubtitle from ./evil/copy-manifest'),
        ),
      ).toBe(true);

      // 3. Scanning the rogue copy-manifest.ts itself as a non-canonical file
      const evilLiterals = extractJsxLiterals(evilFile);
      expect(
        evilLiterals.some((lit) => lit.includes('shadowed-formatter:formatShopSubtitle')),
      ).toBe(true);
      expect(
        evilLiterals.some((lit) => lit.includes('Every order includes a complimentary gift.')),
      ).toBe(true);
    } finally {
      fs.rmSync(evilDir, { recursive: true, force: true });
    }
  });
});
