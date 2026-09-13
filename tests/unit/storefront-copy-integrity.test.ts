import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, test } from 'vitest';
import {
  STOREFRONT_COPY_MANIFEST,
  formatHubCardDescription,
  formatCommunitySubtitle,
  formatActiveWelcomeTitle,
  formatActiveWelcomeTerms,
  formatShopSubtitle,
  formatContactHubDescription,
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

    // Contact surface
    expect(STOREFRONT_COPY_MANIFEST.contact.meta.title).toBeTruthy();
    expect(STOREFRONT_COPY_MANIFEST.contact.meta.description).toBeTruthy();
    expect(STOREFRONT_COPY_MANIFEST.contact.hero.badge).toBeTruthy();
    expect(STOREFRONT_COPY_MANIFEST.contact.hero.title).toBeTruthy();
    expect(STOREFRONT_COPY_MANIFEST.contact.hero.subtitle).toBeTruthy();
    expect(STOREFRONT_COPY_MANIFEST.contact.appNotice.badge).toBeTruthy();
    expect(STOREFRONT_COPY_MANIFEST.contact.appNotice.title).toBeTruthy();
    expect(STOREFRONT_COPY_MANIFEST.contact.appNotice.description).toBeTruthy();
    expect(STOREFRONT_COPY_MANIFEST.contact.communityHubs.badge).toBeTruthy();
    expect(STOREFRONT_COPY_MANIFEST.contact.communityHubs.title).toBeTruthy();
    expect(STOREFRONT_COPY_MANIFEST.contact.communityHubs.description).toBeTruthy();
    expect(formatContactHubDescription('Store 1 Hub')).toContain('Store 1 Hub');
    expect(STOREFRONT_COPY_MANIFEST.contact.channels.phoneLabel).toBeTruthy();
    expect(STOREFRONT_COPY_MANIFEST.contact.channels.phonePlaceholder).toBeTruthy();
    expect(STOREFRONT_COPY_MANIFEST.contact.channels.emailLabel).toBeTruthy();
    expect(STOREFRONT_COPY_MANIFEST.contact.channels.emailPlaceholder).toBeTruthy();
    expect(STOREFRONT_COPY_MANIFEST.contact.channels.hoursLabel).toBeTruthy();
    expect(STOREFRONT_COPY_MANIFEST.contact.channels.hoursPlaceholder).toBeTruthy();
    expect(STOREFRONT_COPY_MANIFEST.contact.channels.addressLabel).toBeTruthy();
    expect(STOREFRONT_COPY_MANIFEST.contact.channels.addressPlaceholder).toBeTruthy();
    expect(STOREFRONT_COPY_MANIFEST.contact.helpCard.title).toBeTruthy();
    expect(STOREFRONT_COPY_MANIFEST.contact.helpCard.description).toBeTruthy();
    expect(STOREFRONT_COPY_MANIFEST.contact.helpCard.viewOrdersText).toBeTruthy();
    expect(STOREFRONT_COPY_MANIFEST.contact.helpCard.aboutUsText).toBeTruthy();

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
  // 3. Manifest Consumption & Exclusivity Invariants (PR #46 Round 6 Guard)
  // ---------------------------------------------------------------------------

  test('target storefront files strictly consume STOREFRONT_COPY_MANIFEST rather than inline literals', () => {
    // 1. cart/page.tsx
    const cartSource = fs.readFileSync(path.join(storefrontDir, 'cart/page.tsx'), 'utf-8');
    expect(cartSource).toContain('title: STOREFRONT_COPY_MANIFEST.cart.meta.title');
    expect(cartSource).toContain('description: STOREFRONT_COPY_MANIFEST.cart.meta.description');
    expect(cartSource).toContain('title={STOREFRONT_COPY_MANIFEST.cart.heading.title}');
    expect(cartSource).toContain('subtitle={STOREFRONT_COPY_MANIFEST.cart.heading.subtitle}');
    expect(cartSource).toContain('{STOREFRONT_COPY_MANIFEST.cart.continueShopping}');
    expect(cartSource).toContain('{STOREFRONT_COPY_MANIFEST.cart.checkoutNotice}');
    expect(cartSource).toContain('{STOREFRONT_COPY_MANIFEST.cart.scheduledSlotBadge}');
    // Zero hardcoded subtitle strings in cart
    expect(cartSource).not.toMatch(/subtitle\s*=\s*["'][^"']+["']/);
    // Zero hardcoded checkout trust notice
    expect(cartSource).not.toContain('No account needed');

    // 2. page.tsx
    const homeSource = fs.readFileSync(path.join(storefrontDir, 'page.tsx'), 'utf-8');
    expect(homeSource).toContain('title: STOREFRONT_COPY_MANIFEST.home.meta.title');
    expect(homeSource).toContain('description: STOREFRONT_COPY_MANIFEST.home.meta.description');
    expect(homeSource).toContain('{STOREFRONT_COPY_MANIFEST.home.activeWelcome.badge}');
    expect(homeSource).toContain('formatActiveWelcomeTitle(communityName)');
    expect(homeSource).toContain('{STOREFRONT_COPY_MANIFEST.home.activeWelcome.pausedNotice}');
    expect(homeSource).toContain(
      '{STOREFRONT_COPY_MANIFEST.home.promoBanners.dailyEssentials.badge}',
    );
    expect(homeSource).toContain(
      '{STOREFRONT_COPY_MANIFEST.home.promoBanners.dailyEssentials.title}',
    );
    expect(homeSource).toContain('{STOREFRONT_COPY_MANIFEST.home.promoBanners.superSaver.badge}');
    expect(homeSource).toContain('{STOREFRONT_COPY_MANIFEST.home.promoBanners.superSaver.title}');
    // Zero hardcoded promotional or welcome strings
    expect(homeSource).not.toContain('>Delivering from your local hub<');
    expect(homeSource).not.toContain('>Fruits, Vegetables & Dairy<');
    expect(homeSource).not.toContain('>Kitchen Staples & Grains<');

    // 3. layout.tsx
    const layoutSource = fs.readFileSync(path.join(storefrontDir, 'layout.tsx'), 'utf-8');
    expect(layoutSource).toContain('{STOREFRONT_COPY_MANIFEST.footer.brandDescription}');
    expect(layoutSource).toContain('{STOREFRONT_COPY_MANIFEST.footer.communitiesHeading}');
    expect(layoutSource).toContain('{STOREFRONT_COPY_MANIFEST.footer.unserviceableLink}');
    expect(layoutSource).not.toContain(
      'Dedicated hyperlocal grocery shopping for residential communities.',
    );

    // 4. communities.ts
    const communitiesSource = fs.readFileSync(path.join(storefrontDir, 'communities.ts'), 'utf-8');
    expect(communitiesSource).toContain('formatCommunitySubtitle');
    expect(communitiesSource).not.toContain("'· Scheduled Slot Delivery'");
    expect(communitiesSource).not.toContain('"· Scheduled Slot Delivery"');

    // 5. mobile-cart-bar.tsx
    const mobileBarSource = fs.readFileSync(
      path.join(storefrontDir, 'mobile-cart-bar.tsx'),
      'utf-8',
    );
    expect(mobileBarSource).toContain('{STOREFRONT_COPY_MANIFEST.mobileCartBar.slotNotice}');
    expect(mobileBarSource).not.toMatch(/>\s*Scheduled slot delivery\s*</);

    // 6. shop/page.tsx
    const shopSource = fs.readFileSync(path.join(storefrontDir, 'shop/page.tsx'), 'utf-8');
    expect(shopSource).toContain('title: STOREFRONT_COPY_MANIFEST.shop.meta.title');
    expect(shopSource).toContain('formatShopSubtitle');
    expect(shopSource).toContain('{STOREFRONT_COPY_MANIFEST.shop.pausedNotice}');
  });

  test('Oscar bypass probe rejection: an inline string edit to PageHeading subtitle is caught and rejected', () => {
    // Oscar proved in Round 6 that a reviewer could edit cart/page.tsx directly to say
    // `subtitle="Your order arrives when promised"` and pass tests that only check manifest population.
    // This consumption guard strictly verifies that such an edit causes immediate test failure.
    function validateCartSourceConsumption(source: string): { valid: boolean; error?: string } {
      if (/subtitle\s*=\s*["'][^"']+["']/.test(source)) {
        return {
          valid: false,
          error: 'Forbidden inline string literal found on PageHeading subtitle',
        };
      }
      if (!source.includes('subtitle={STOREFRONT_COPY_MANIFEST.cart.heading.subtitle}')) {
        return {
          valid: false,
          error: 'Missing required binding to STOREFRONT_COPY_MANIFEST.cart.heading.subtitle',
        };
      }
      return { valid: true };
    }

    const actualCartSource = fs.readFileSync(path.join(storefrontDir, 'cart/page.tsx'), 'utf-8');
    expect(validateCartSourceConsumption(actualCartSource).valid).toBe(true);

    // Simulated Oscar probe: developer puts raw unbacked claim string directly into JSX
    const simulatedOscarProbe = actualCartSource.replace(
      'subtitle={STOREFRONT_COPY_MANIFEST.cart.heading.subtitle}',
      'subtitle="Your order arrives when promised"',
    );
    const probeResult = validateCartSourceConsumption(simulatedOscarProbe);
    expect(probeResult.valid).toBe(false);
    expect(probeResult.error).toContain('Forbidden inline string literal');
  });
});
