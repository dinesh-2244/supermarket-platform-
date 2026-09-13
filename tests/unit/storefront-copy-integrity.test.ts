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

    const nonManifestFiles = storefrontFiles.filter((file) => !file.endsWith('copy-manifest.ts'));
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
  function extractJsxLiterals(filePath: string, sourceOverride?: string): string[] {
    const content = sourceOverride ?? fs.readFileSync(filePath, 'utf-8');
    const sf = ts.createSourceFile(filePath, content, ts.ScriptTarget.Latest, true);
    const literals: string[] = [];

    function visit(node: ts.Node) {
      if (ts.isJsxText(node)) {
        const text = node.text.trim().replace(/\s+/g, ' ');
        if (text) literals.push(text);
      } else if (ts.isJsxAttribute(node)) {
        const propName = node.name.getText(sf);
        if (
          ['title', 'subtitle', 'badge', 'heading', 'description', 'notice'].includes(
            propName.toLowerCase(),
          )
        ) {
          if (node.initializer && ts.isStringLiteral(node.initializer)) {
            literals.push(`${propName}="${node.initializer.text}"`);
          }
        }
      }
      ts.forEachChild(node, visit);
    }

    visit(sf);
    return literals;
  }

  /**
   * Strict per-file allowlist for functional, structural, and navigation UI literals
   * in storefront components that consume STOREFRONT_COPY_MANIFEST.
   *
   * Any marketing claim, delivery promise, or business guarantee MUST be declared
   * in STOREFRONT_COPY_MANIFEST rather than inlined.
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
      'available — reduce the quantity to continue.',
      'each',
      'item(s))',
      'more to reach the minimum order for your area.',
      'out:',
      'title="Change delivery area"',
      'title="Total"',
      'title="Your basket"',
      'to',
      '·',
      '— your basket uses the new price.',
    ]),
    'community-selector.tsx': new Set([
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
      'Your Basket',
      'title="Click to switch community or store"',
      '©',
      '▼',
      '📍',
    ]),
    'mobile-cart-bar.tsx': new Set(['View Basket', 'added', '→']),
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
  };

  test('all storefront components importing STOREFRONT_COPY_MANIFEST strictly forbid unauthorized inline literals via dynamic AST scan', () => {
    // Dynamically discover every .tsx file under src/app/(storefront) that imports STOREFRONT_COPY_MANIFEST
    const manifestConsumerFiles = storefrontFiles.filter((filePath) => {
      if (!filePath.endsWith('.tsx') || filePath.endsWith('copy-manifest.ts')) return false;
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
});
