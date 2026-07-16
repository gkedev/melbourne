// ============================================================================
// court-ready MCP Demo — Tennis Ball Catalog Data
// ============================================================================
// A curated catalog of tennis balls for the demo. Each product has a unique
// SKU, realistic pricing, and stock quantities. This is the "inventory" that
// the catalog tools search and return.
// ============================================================================

import type { Product } from '../types.js';

export const TENNIS_BALL_CATALOG: Product[] = [
  {
    sku: 'TB-WILSON-US-3',
    name: 'US Open Extra Duty Tennis Balls (3-Pack)',
    brand: 'Wilson',
    description:
      'Official ball of the US Open. Premium Tex Tech felt for hard court durability. USTA and ITF approved.',
    priceUsd: 5.99,
    currency: 'USD',
    quantityInStock: 500,
    category: 'competition',
    tags: ['hard-court', 'extra-duty', 'tournament', 'usta-approved'],
  },
  {
    sku: 'TB-WILSON-CHAMP-4',
    name: 'Championship Tennis Balls (4-Pack)',
    brand: 'Wilson',
    description:
      'Best-selling recreational tennis ball. Dura-Weave felt for all court surfaces. Great value for regular play.',
    priceUsd: 4.49,
    currency: 'USD',
    quantityInStock: 1200,
    category: 'recreational',
    tags: ['all-court', 'regular-duty', 'value', 'beginner-friendly'],
  },
  {
    sku: 'TB-PENN-CHAMP-3',
    name: 'Championship Tennis Balls (3-Pack)',
    brand: 'Penn',
    description:
      'Consistent performance with controlled fiber release felt. Natural rubber for reliable bounce.',
    priceUsd: 3.99,
    currency: 'USD',
    quantityInStock: 800,
    category: 'recreational',
    tags: ['all-court', 'regular-duty', 'natural-rubber'],
  },
  {
    sku: 'TB-PENN-TOUR-3',
    name: 'Tour Extra Duty Tennis Balls (3-Pack)',
    brand: 'Penn',
    description:
      'Tournament-grade ball with LongPlay felt. Designed for hard court play with extended durability.',
    priceUsd: 6.49,
    currency: 'USD',
    quantityInStock: 300,
    category: 'competition',
    tags: ['hard-court', 'extra-duty', 'tournament', 'longplay'],
  },
  {
    sku: 'TB-DUNLOP-AO-3',
    name: 'Australian Open Tennis Balls (3-Pack)',
    brand: 'Dunlop',
    description:
      'Official ball of the Australian Open. HD Pro Cloth for superior visibility and performance on hard courts.',
    priceUsd: 7.99,
    currency: 'USD',
    quantityInStock: 200,
    category: 'competition',
    tags: ['hard-court', 'extra-duty', 'tournament', 'grand-slam'],
  },
  {
    sku: 'TB-DUNLOP-FORT-4',
    name: 'Fort All Court Tennis Balls (4-Pack)',
    brand: 'Dunlop',
    description:
      'Premium all-court ball trusted by clubs worldwide. Pressurized core for consistent bounce.',
    priceUsd: 8.99,
    currency: 'USD',
    quantityInStock: 150,
    category: 'premium',
    tags: ['all-court', 'club', 'pressurized', 'premium'],
  },
  {
    sku: 'TB-BABOLAT-GOLD-3',
    name: 'Gold All Court Tennis Balls (3-Pack)',
    brand: 'Babolat',
    description:
      'High-quality all court ball with excellent durability and feel. Core-Tex technology for consistent play.',
    priceUsd: 5.49,
    currency: 'USD',
    quantityInStock: 400,
    category: 'recreational',
    tags: ['all-court', 'core-tex', 'durable'],
  },
  {
    sku: 'TB-BABOLAT-RG-3',
    name: 'French Open Clay Court Tennis Balls (3-Pack)',
    brand: 'Babolat',
    description:
      'Official ball of Roland Garros. Engineered for clay court play with regular-duty felt.',
    priceUsd: 7.49,
    currency: 'USD',
    quantityInStock: 250,
    category: 'competition',
    tags: ['clay-court', 'regular-duty', 'tournament', 'grand-slam'],
  },
  {
    sku: 'TB-HEAD-TOUR-3',
    name: 'Tour Tennis Balls (3-Pack)',
    brand: 'Head',
    description:
      'Tournament-level ball with Encore technology for 2x longer match life. SmartOptik felt for visibility.',
    priceUsd: 6.99,
    currency: 'USD',
    quantityInStock: 350,
    category: 'competition',
    tags: ['all-court', 'tournament', 'smart-optik', 'long-life'],
  },
  {
    sku: 'TB-HEAD-PADEL-3',
    name: 'Padel Pro Tennis Balls (3-Pack)',
    brand: 'Head',
    description:
      'Designed specifically for padel. Lower pressure core for optimal bounce on padel courts.',
    priceUsd: 5.99,
    currency: 'USD',
    quantityInStock: 100,
    category: 'specialty',
    tags: ['padel', 'low-pressure', 'specialty'],
  },
  {
    sku: 'TB-WILSON-TRINITI-3',
    name: 'Triniti Tennis Balls (3-Pack)',
    brand: 'Wilson',
    description:
      'Sustainable performance ball. Plastomer core stays fresh 4x longer. 100% recyclable packaging.',
    priceUsd: 9.99,
    currency: 'USD',
    quantityInStock: 180,
    category: 'premium',
    tags: ['sustainable', 'long-lasting', 'eco-friendly', 'premium'],
  },
  {
    sku: 'TB-PENN-PRESSURELESS-12',
    name: 'Pressureless Tennis Balls (12-Pack)',
    brand: 'Penn',
    description:
      'Never go flat — ideal for ball machines and practice. Consistent bounce that lasts forever.',
    priceUsd: 19.99,
    currency: 'USD',
    quantityInStock: 90,
    category: 'practice',
    tags: ['pressureless', 'practice', 'ball-machine', 'bulk'],
  },
];
