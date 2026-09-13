/**
 * Authoritative customer-facing marketing, operational, and commitment copy manifest.
 *
 * This manifest serves as the single source of truth for all brand commitments,
 * service claims, and editorial copy across the Munder Fresh storefront.
 *
 * Architectural Invariant (PR #46 Round 5):
 * 1. Customer-facing claims and promises MUST be declared in this manifest rather
 *    than scattered across JSX markup.
 * 2. An automated snapshot test verifies this manifest against the approved copy registry.
 * 3. Any change, addition, or rephrasing of a marketing claim produces an explicit,
 *    reviewable diff in code review rather than relying on guessing keyword regexes.
 */

export const STOREFRONT_COPY_MANIFEST = {
  home: {
    meta: {
      title: 'Munder Fresh | Hyperlocal Grocery Platform',
      description:
        'Groceries, daily essentials, dairy, staples, and fruits delivered to your community in scheduled slots.',
    },
    hero: {
      badge: 'Hyperlocal Residential Delivery',
      titlePrefix: 'Fresh Groceries Delivered in ',
      titleHighlight: 'Scheduled Slots',
      subtitle:
        'Doorstep delivery of fruits & vegetables, dairy, pulses, staples, and daily home essentials — stocked and delivered by your dedicated community store hub.',
    },
    communitySelector: {
      title: 'Select Your Community to Start Shopping',
      subtitle:
        'Choose your residential community to see accurate local stock, current store pricing, and booking slots.',
    },
    highlights: {
      slotsTitle: 'Scheduled Slots',
      slotsDescription: 'Pick your preferred delivery window',
      produceTitle: 'Fresh Produce',
      produceDescription: 'Vegetables & fruits, stocked at your local hub',
      paymentTitle: 'Pay on Delivery',
      paymentDescription: 'Cash or UPI accepted at doorstep',
      doorstepTitle: 'Direct to Door',
      doorstepDescription: 'Delivery straight to your flat or home',
    },
    activeWelcome: {
      badge: 'Delivering from your local hub',
      titlePrefix: 'Shopping at ',
      feeDeliveryPrefix: 'Delivery ',
      minOrderPrefix: ' · Minimum order ',
      pausedNotice:
        'This community hub has paused order taking for now. You can still browse and add to basket.',
      browseShopButton: 'Browse Full Shop →',
      changeCommunityButton: 'Change Community',
    },
    promoBanners: {
      dailyEssentials: {
        badge: 'Daily Essentials',
        title: 'Fruits, Vegetables & Dairy',
        description: 'Vegetables, milk & bakery goods for your breakfast slot.',
        buttonText: 'Shop Fresh Produce →',
      },
      superSaver: {
        badge: 'Super Saver',
        title: 'Kitchen Staples & Grains',
        description: "Rice, atta, edible oils & dals at your community's everyday prices.",
        buttonText: 'Shop Pantry Staples →',
      },
    },
    aboutPreview: {
      badge: 'About Our Model',
      title: 'Hyperlocal Grocery Built for Residential Communities',
      description:
        'We operate dedicated store hubs for partner residential societies. Learn how our two-community model delivers scheduled morning and evening slots.',
    },
    promise: {
      badge: 'The Munder Fresh Promise',
      title: 'Why Hyperlocal Residential Delivery?',
      description:
        "We partner directly with residential societies to fulfill orders from dedicated local hubs. Choose a scheduled delivery window that fits your day, with catalogue listings and prices scoped to your community's store-recorded availability.",
    },
  },
  shop: {
    meta: {
      title: 'All Products | Munder Fresh Hyperlocal Grocery',
      description:
        'Shop fresh groceries, daily staples, fruits, vegetables, dairy, and household essentials.',
    },
    pausedNotice:
      'This store has temporarily paused orders. You can still browse products and plan your basket.',
  },
  about: {
    meta: {
      title: 'About Us | Munder Fresh Hyperlocal Grocery',
      description:
        'Learn about Munder Fresh: our dedicated two-community hyperlocal grocery model and scheduled slot delivery.',
    },
    hero: {
      badge: 'Our Hyperlocal Model',
      title: 'Dedicated Grocery for Residential Communities',
      description:
        "Munder Fresh was built to serve residential communities with daily groceries delivered in scheduled time windows, with stock and pricing scoped directly to each community's dedicated store hub.",
    },
    hubSystem: {
      badge: 'How Munder Fresh Operates',
      title: 'The Two-Community Hub System',
      description:
        'Munder Fresh pairs dedicated community store hubs directly with residential societies, organizing inventory and delivery scheduling around local service areas.',
      hubCardTemplate:
        "Dedicated local inventory managed by {hubName}. Items in the catalogue are drawn from this community hub's store records, updating with local stock levels.",
    },
    commitments: {
      badge: 'Our Commitments',
      title: 'Real Operational Facts, No Fabrications',
      cards: {
        scheduledSlots: {
          title: 'Scheduled Slots',
          description:
            'We deliver in scheduled one-hour time windows so you know when your order is expected to arrive.',
        },
        oneHubOneCommunity: {
          title: 'One Hub, One Community',
          description:
            "Each community is served by a dedicated store hub, so the catalogue reflects that hub's own store-recorded availability and pricing.",
        },
        liveInventoryPricing: {
          title: 'Live Inventory & Price',
          description:
            "What you see in your community catalogue reflects your hub's own recorded availability and prices, not a shared or estimated figure. If prices change, you are notified upfront.",
        },
        payAtDoorstep: {
          title: 'Pay at Doorstep',
          description:
            'Pay via Cash on Delivery or UPI once your order is handed over — no prepayment required.',
        },
      },
    },
    serviceBoundary: {
      title: 'Living Outside Our Current Communities?',
      description:
        'Because we operate dedicated store hubs paired with specific residential partners, we only accept orders from addresses within our serviceable zones.',
    },
  },
  contact: {
    meta: {
      title: 'Contact Us | Munder Fresh Hyperlocal Grocery',
      description:
        'Get in touch with Munder Fresh community store hubs. Contact information and resident support.',
    },
    hero: {
      badge: 'Customer Support & Inquiries',
      title: 'Contact Us',
      subtitle:
        'Have a question about your order, delivery schedule, or community service? We are here to help.',
    },
    appNotice: {
      badge: 'Resident Orders & Inquiries',
      title: 'In-App Support for Active Orders',
      description:
        'For current orders, order modifications, or immediate delivery updates, please reach out directly through your resident application or order receipt page.',
      aboutLinkText: 'Learn more about our community hub delivery model on our About page',
    },
    communityHubs: {
      badge: 'Community Store Hubs',
      title: 'Our Dedicated Store Hubs',
      description:
        'Munder Fresh operates dedicated store hubs paired directly with our partner residential communities.',
      hubCardTemplate:
        'Dedicated store hub serving {hubName}. Contact channels and operating hours will be listed here once assigned.',
    },
    channels: {
      phoneLabel: 'Phone Support',
      phonePlaceholder: 'Assigned per community hub in resident app',
      emailLabel: 'Email Support',
      emailPlaceholder: 'Assigned per community hub in resident app',
      hoursLabel: 'Operating Hours',
      hoursPlaceholder: 'Aligned with active delivery slot windows',
      addressLabel: 'Hub Location',
      addressPlaceholder: 'On-premises community fulfillment facility',
    },
    helpCard: {
      title: 'Need Help with Your Order?',
      description:
        'Check your past orders and status updates in your account, or review our operational principles.',
      viewOrdersText: 'View Past Orders',
      aboutUsText: 'About Munder Fresh',
    },
  },
  productRequest: {
    meta: {
      title: 'Request a Product | Munder Fresh Hyperlocal Grocery',
      description:
        'Tell us what grocery items, brands, or daily essentials you would like to see in your community store.',
    },
    hero: {
      badge: 'Resident Catalogue Requests',
      title: 'Request a Product',
      subtitle:
        "Can't find an item in your store catalogue? Tell us what you'd like to see, and our store team will review it.",
    },
    form: {
      productNameLabel: 'Product Name',
      productNamePlaceholder: 'e.g. Sona Masoori Rice, Greek Yogurt, Basil Leaves...',
      brandLabel: 'Brand (Optional)',
      brandPlaceholder: 'e.g. Nandini, Fortune, Tata...',
      packSizeLabel: 'Pack Size or Weight (Optional)',
      packSizePlaceholder: 'e.g. 500g, 1kg, 1L, Pack of 4...',
      noteLabel: 'Additional Notes or Details (Optional)',
      notePlaceholder: 'Any specific variety, preference, or detail...',
      customerNameLabel: 'Your Name (Optional)',
      customerNamePlaceholder: 'e.g. Priya Sharma',
      customerPhoneLabel: 'Mobile Number (Optional)',
      customerPhonePlaceholder: '10-digit Indian mobile number',
      submitButton: 'Submit Request',
      noStoreSelectedPrompt: 'Choose your delivery area first so we know which store to ask.',
      chooseAreaLinkText: 'Choose Community Area →',
    },
    success: {
      title: "Thanks, we've received your request",
      description: "We've recorded your product request for your community store team to review.",
      actionText: 'Browse Store Catalogue →',
      submitAnotherText: 'Request Another Product',
    },
    searchPrompt: {
      text: "Can't find what you're looking for?",
      linkText: 'Request a product for your store →',
    },
  },
  cart: {
    meta: {
      title: 'Your basket',
      description: 'What you have chosen, priced by the shop that delivers to you.',
    },
    heading: {
      title: 'Your basket',
      subtitle: 'Prices and availability are checked against the shop every time you look.',
    },
    continueShopping: '← Continue shopping',
    changeArea: '· Change area →',
    checkoutNotice: 'No account needed. You pay when your order is delivered.',
    scheduledSlotBadge: 'Scheduled slot delivery',
    trustBadges: {
      storeVerified: 'Store-verified prices and availability',
      doorstepPayment: 'Pay with Cash or UPI on delivery',
    },
  },
  communities: {
    subtitleTemplate: '{shortName} · Scheduled Slot Delivery',
    deliveryNoteBase: 'Scheduled Slots · Dedicated Hub',
    deliveryNoteWithMinOrderPrefix: 'Scheduled Slots · Dedicated Hub · Min Order ',
    selector: {
      badge: 'Hyperlocal Community Delivery',
      titleDefault: 'Select Your Store Community',
      subtitleDefault:
        'Fresh groceries, dairy, produce & daily essentials delivered to your doorstep in convenient scheduled slots.',
      unserviceablePrompt: 'Living outside these communities? ',
      unserviceableLinkText: 'Request delivery to your locality',
    },
  },
  mobileCartBar: {
    slotNotice: 'Scheduled slot delivery',
  },
  footer: {
    brandDescription:
      'Dedicated hyperlocal grocery shopping for residential communities. Scheduled slot delivery of fresh vegetables, fruits, dairy, staples, and daily household needs.',
    communitiesHeading: 'Communities Served',
    unserviceableLink: 'Living elsewhere? Request delivery →',
    commitmentsTitle: 'Store Commitments',
    commitmentsDescription:
      "Prices and availability are verified from your community's dedicated store. Free delivery options available on meeting order thresholds. Pay via Cash or UPI on delivery.",
  },
} as const;

export function formatHubCardDescription(hubName: string): string {
  return STOREFRONT_COPY_MANIFEST.about.hubSystem.hubCardTemplate.replace('{hubName}', hubName);
}

export function formatCommunitySubtitle(shortName: string): string {
  return STOREFRONT_COPY_MANIFEST.communities.subtitleTemplate.replace('{shortName}', shortName);
}

export function formatActiveWelcomeTitle(communityName: string): string {
  return `${STOREFRONT_COPY_MANIFEST.home.activeWelcome.titlePrefix}${communityName}`;
}

export function formatActiveWelcomeTerms(
  deliveryFeeFormatted: string,
  minOrderFormatted: string,
): string {
  return `${STOREFRONT_COPY_MANIFEST.home.activeWelcome.feeDeliveryPrefix}${deliveryFeeFormatted}${STOREFRONT_COPY_MANIFEST.home.activeWelcome.minOrderPrefix}${minOrderFormatted}`;
}

export function formatShopSubtitle(
  deliveryFeeFormatted: string,
  minOrderFormatted: string,
): string {
  return `${STOREFRONT_COPY_MANIFEST.cart.scheduledSlotBadge} · Delivery ${deliveryFeeFormatted} · Min order ${minOrderFormatted}`;
}

export function formatContactHubDescription(hubName: string): string {
  return STOREFRONT_COPY_MANIFEST.contact.communityHubs.hubCardTemplate.replace(
    '{hubName}',
    hubName,
  );
}

export function formatCommunityDeliveryNote(minOrderFormatted?: string): string {
  if (minOrderFormatted) {
    return `${STOREFRONT_COPY_MANIFEST.communities.deliveryNoteWithMinOrderPrefix}${minOrderFormatted}`;
  }
  return STOREFRONT_COPY_MANIFEST.communities.deliveryNoteBase;
}
