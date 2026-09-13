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
      title: 'Munder Fresh | Serving Navy Quarters Communities',
      description:
        'Groceries, daily essentials, and fresh staples delivered to Navy Quarters communities as early as operationally possible.',
    },
    hero: {
      badge: 'PROUD TO SERVE THOSE WHO SERVE THE NATION',
      titlePrefix: 'Serving Those Who Serve India — ',
      titleHighlight: 'Proudly, Every Day',
      subtitle:
        'Groceries, daily staples, dairy, and household essentials for Navy Quarters families. Operating daily 10:00 AM – 8:00 PM, delivered to your doorstep as early as operationally possible.',
    },
    communitySelector: {
      title: 'Select Your Navy Quarters Community',
      subtitle:
        'Choose your residential quarters to view community-scoped inventory, store pricing, and local delivery availability.',
    },
    highlights: {
      slotsTitle: 'Daily 10 AM – 8 PM',
      slotsDescription: 'Operating every day to fulfill your home essentials',
      produceTitle: 'Everyday Essentials',
      produceDescription: 'Fresh produce, dairy & pantry staples from your local hub',
      paymentTitle: 'Pay on Delivery',
      paymentDescription: 'Cash or UPI accepted at doorstep upon handover',
      doorstepTitle: 'Direct to Quarters',
      doorstepDescription: 'Delivered as early as operationally possible',
    },
    activeWelcome: {
      badge: 'Serving your quarters community hub',
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
        title: 'Fresh Produce & Dairy',
        description: 'Vegetables, milk & daily provisions delivered fresh to your quarters.',
        buttonText: 'Shop Fresh Produce →',
      },
      superSaver: {
        badge: 'Pantry Staples',
        title: 'Kitchen Staples & Grains',
        description: 'Atta, rice, dals & cooking essentials at steady community prices.',
        buttonText: 'Shop Pantry Staples →',
      },
    },
    aboutPreview: {
      badge: 'Our Commitment to Service',
      title: 'Proud to Serve Those Who Serve the Nation',
      description:
        'Every day, the men and women of the Indian Navy serve with discipline, courage and commitment. Serving two Navy Quarters communities is a privilege for us. Our role may be simple -- groceries, everyday essentials and dependable delivery -- but we are proud to make daily life a little easier for the families of those who dedicate themselves to the country.',
      closingLine: 'Their duty is to the nation. Our privilege is to serve their everyday needs.',
    },
    promise: {
      badge: 'The Munder Fresh Promise',
      title: 'Dependable Hyperlocal Service for Quarters Families',
      description:
        'We serve your residential quarters directly from dedicated local hubs. Enjoy free doorstep delivery on orders meeting the minimum order, fulfilled daily from 10:00 AM to 8:00 PM as early as operationally possible.',
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
      title: 'About Us | Munder Fresh — Serving Navy Quarters',
      description:
        'Learn about Munder Fresh: serving Navy Quarters communities with groceries, daily essentials, and dependable delivery.',
    },
    hero: {
      badge: 'PROUD TO SERVE THOSE WHO SERVE THE NATION',
      title: 'Serving Those Who Serve India — Proudly, Every Day',
      description:
        'Every day, the men and women of the Indian Navy serve with discipline, courage and commitment. Serving two Navy Quarters communities is a privilege for us. Our role may be simple -- groceries, everyday essentials and dependable delivery -- but we are proud to make daily life a little easier for the families of those who dedicate themselves to the country.',
    },
    hubSystem: {
      badge: 'Dedicated Quarters Hubs',
      title: 'The Two-Community Hub System',
      description:
        'Munder Fresh pairs dedicated community store hubs directly with Navy Quarters residences, organizing inventory and fulfillment exclusively around local service areas.',
      hubCardTemplate:
        "Dedicated local inventory managed by {hubName}. Items in the catalogue are drawn from this community hub's store records, updating with local stock levels.",
    },
    commitments: {
      badge: 'Our Commitments',
      title: 'Real Operational Facts, No Fabrications',
      cards: {
        scheduledSlots: {
          title: 'Daily 10 AM – 8 PM',
          description:
            'Our hubs operate daily from 10:00 AM to 8:00 PM, delivering orders as early as operationally possible without artificial delays.',
        },
        oneHubOneCommunity: {
          title: 'One Hub, One Community',
          description:
            'Each quarters community is served by its dedicated store hub, ensuring stock reflects local shelf availability.',
        },
        liveInventoryPricing: {
          title: 'Live Inventory & Price',
          description:
            "What you see in your quarters catalogue reflects your hub's own recorded availability and prices, not shared estimates. If prices change, you are notified upfront.",
        },
        payAtDoorstep: {
          title: 'Pay at Doorstep',
          description:
            'Pay via Cash on Delivery or UPI once your order is handed over at your quarters — no prepayment required.',
        },
      },
    },
    quoteCallout: {
      quote: 'Their duty is to the nation. Our privilege is to serve their everyday needs.',
    },
    serviceBoundary: {
      title: 'Living Outside Our Current Quarters Communities?',
      description:
        'Because we operate dedicated store hubs serving specific residential communities, we only accept orders from addresses within our serviceable zones.',
    },
  },
  contact: {
    meta: {
      title: 'Contact Us | Munder Fresh — Community Store Hubs',
      description:
        'Community store hub directory and support channel status for Munder Fresh. Dedicated live order-support channels are not yet active.',
    },
    hero: {
      badge: 'Community Store Hub Directory',
      title: 'Contact Us',
      subtitle:
        'Community store hub directory and operating status for Navy Quarters locations. Dedicated live order-support channels are not currently active.',
    },
    appNotice: {
      badge: 'Order Support Status',
      title: 'No Live Order Support Channel',
      description:
        'A dedicated live order-support channel is not currently active. For details on how our community hubs fulfill orders and operating commitments, please visit our About page.',
      aboutLinkText: 'Learn more about our community hub delivery model on our About page',
    },
    communityHubs: {
      badge: 'Community Store Hubs',
      title: 'Our Dedicated Quarters Hubs',
      description: 'Munder Fresh operates dedicated store hubs serving Navy Quarters communities.',
      hubCardTemplate:
        'Dedicated store hub serving {hubName}. Contact channels and operating hours will be listed here once assigned.',
    },
    channels: {
      phoneLabel: 'Phone Support',
      phonePlaceholder: 'Not yet published',
      emailLabel: 'Email Support',
      emailPlaceholder: 'Not yet published',
      hoursLabel: 'Operating Hours',
      hoursPlaceholder: 'Daily, 10:00 AM – 8:00 PM',
      addressLabel: 'Hub Location',
      addressPlaceholder: 'Not yet published',
    },
    helpCard: {
      title: 'Order Status & Operational Information',
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
    scheduledSlotBadge: 'As early as operationally possible',
    trustBadges: {
      storeVerified: 'Store-verified prices and availability',
      doorstepPayment: 'Pay with Cash or UPI on delivery',
    },
  },
  communities: {
    subtitleTemplate: '{shortName} · As early as operationally possible',
    deliveryNoteBase: 'Free Delivery · Daily 10 AM – 8 PM',
    deliveryNoteWithMinOrderPrefix: 'Free Delivery · Min Order ',
    selector: {
      badge: 'Navy Quarters Delivery',
      titleDefault: 'Select Your Quarters Community',
      subtitleDefault:
        'Fresh groceries, dairy, produce & daily essentials delivered to your quarters as early as operationally possible.',
      unserviceablePrompt: 'Living outside these quarters communities? ',
      unserviceableLinkText: 'Request delivery to your locality',
    },
  },
  mobileCartBar: {
    slotNotice: 'As early as operationally possible',
  },
  footer: {
    brandDescription:
      'Dedicated grocery delivery for Navy Quarters communities. Groceries, everyday essentials, fresh produce, and dairy delivered to your quarters as early as operationally possible.',
    communitiesHeading: 'Navy Quarters Communities',
    unserviceableLink: 'Living elsewhere? Request delivery →',
    commitmentsTitle: 'Store Commitments',
    commitmentsDescription:
      "Prices and availability are verified from your community's dedicated store. Free delivery on all orders meeting the minimum order threshold. Pay via Cash or UPI on delivery.",
  },
} as const;

export function formatDeliveryFee(deliveryFeePaise: number): string {
  if (deliveryFeePaise === 0) return 'Free';
  const sign = deliveryFeePaise < 0 ? '-' : '';
  const abs = Math.abs(deliveryFeePaise);
  return `${sign}₹${String(Math.floor(abs / 100))}.${String(abs % 100).padStart(2, '0')}`;
}

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
