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
  cart: {
    trustBadges: {
      storeVerified: 'Store-verified prices and availability',
      doorstepPayment: 'Pay with Cash or UPI on delivery',
    },
  },
  communities: {
    deliveryNoteBase: 'Scheduled Slots · Dedicated Hub',
    deliveryNoteWithMinOrderPrefix: 'Scheduled Slots · Dedicated Hub · Min Order ',
  },
  footer: {
    commitmentsTitle: 'Store Commitments',
    commitmentsDescription:
      "Prices and availability are verified from your community's dedicated store. Free delivery options available on meeting order thresholds. Pay via Cash or UPI on delivery.",
  },
} as const;

export function formatHubCardDescription(hubName: string): string {
  return STOREFRONT_COPY_MANIFEST.about.hubSystem.hubCardTemplate.replace('{hubName}', hubName);
}

export function formatCommunityDeliveryNote(minOrderFormatted?: string): string {
  if (minOrderFormatted) {
    return `${STOREFRONT_COPY_MANIFEST.communities.deliveryNoteWithMinOrderPrefix}${minOrderFormatted}`;
  }
  return STOREFRONT_COPY_MANIFEST.communities.deliveryNoteBase;
}
