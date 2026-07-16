// ============================================================================
// court-ready MCP Demo — Catalog Tool Handlers
// ============================================================================
//
// These tools let an AI agent browse the tennis ball catalog. They're the
// "storefront window" of the commerce flow — no auth required for browsing.
//
// Flow position:  [CATALOG] → Cart → Checkout → Order
//
// Tool summary:
//   catalog_search  — fuzzy search by name/brand, filter by price & stock
//   catalog_product — get full details for a single SKU
//
// ============================================================================

import type { Product, AuthToken } from '../types.js';
import { TENNIS_BALL_CATALOG } from './data.js';

// ---------------------------------------------------------------------------
// Agent context type (passed by the MCP server framework on each tool call)
// ---------------------------------------------------------------------------

interface AgentContext {
  auth?: AuthToken;
}

// ---------------------------------------------------------------------------
// catalog_search
// ---------------------------------------------------------------------------
// Searches the catalog with optional filters. All filters are additive (AND).
//
// Input:
//   query?       — fuzzy match against product name, brand, description, tags
//   maxPrice?    — only return products at or below this USD price
//   minQuantity? — only return products with at least this much stock
//
// Returns: { results: Product[], count: number }
// ---------------------------------------------------------------------------

interface CatalogSearchInput {
  query?: string;
  maxPrice?: number;
  minQuantity?: number;
}

interface CatalogSearchResult {
  results: Product[];
  count: number;
  totalCatalogSize: number;
}

export function catalog_search(
  args: CatalogSearchInput,
  _agentContext?: AgentContext,
): CatalogSearchResult {
  let results = [...TENNIS_BALL_CATALOG];

  // --- Fuzzy text search across name, brand, description, and tags ----------
  if (args.query) {
    const terms = args.query.toLowerCase().split(/\s+/).filter(Boolean);
    results = results.filter((product) => {
      const haystack = [
        product.name,
        product.brand,
        product.description,
        product.category,
        ...product.tags,
      ]
        .join(' ')
        .toLowerCase();

      // Every search term must appear somewhere in the haystack (AND logic).
      return terms.every((term) => haystack.includes(term));
    });
  }

  // --- Price ceiling --------------------------------------------------------
  if (args.maxPrice !== undefined) {
    results = results.filter((p) => p.priceUsd <= args.maxPrice!);
  }

  // --- Minimum stock --------------------------------------------------------
  if (args.minQuantity !== undefined) {
    results = results.filter((p) => p.quantityInStock >= args.minQuantity!);
  }

  // Sort by relevance-ish: in-stock items first, then by price ascending.
  results.sort((a, b) => {
    if (a.quantityInStock > 0 && b.quantityInStock === 0) return -1;
    if (a.quantityInStock === 0 && b.quantityInStock > 0) return 1;
    return a.priceUsd - b.priceUsd;
  });

  return {
    results,
    count: results.length,
    totalCatalogSize: TENNIS_BALL_CATALOG.length,
  };
}

// ---------------------------------------------------------------------------
// catalog_product
// ---------------------------------------------------------------------------
// Returns the full product details for a single SKU.
//
// Input:
//   sku — the product SKU to look up (case-insensitive)
//
// Returns: { product: Product } or throws an error if not found.
// ---------------------------------------------------------------------------

interface CatalogProductInput {
  sku: string;
}

interface CatalogProductResult {
  product: Product;
  inStock: boolean;
}

export function catalog_product(
  args: CatalogProductInput,
  _agentContext?: AgentContext,
): CatalogProductResult {
  if (!args.sku) {
    throw new Error('catalog_product requires a "sku" parameter.');
  }

  const skuUpper = args.sku.toUpperCase();
  const product = TENNIS_BALL_CATALOG.find(
    (p) => p.sku.toUpperCase() === skuUpper,
  );

  if (!product) {
    throw new Error(
      `Product not found: "${args.sku}". Use catalog_search to browse available products.`,
    );
  }

  return {
    product,
    inStock: product.quantityInStock > 0,
  };
}
