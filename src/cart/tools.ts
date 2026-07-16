// ============================================================================
// Court Ready — Cart Tool Handlers
// ============================================================================
//
// Shopping cart management for the MCP demo. These tools require auth:
// the agent must have a valid aa-auth+jwt with cart-related scopes.
//
// Flow position:  Catalog → [CART] → Checkout → Order
//
// Tools:
//   cart_add    — Add a product to the agent's cart
//   cart_view   — View current cart contents and total
//   cart_remove — Remove an item from the cart
// ============================================================================

import type { Cart, CartItem, Product } from '../types.js';
import { TENNIS_BALL_CATALOG } from '../catalog/data.js';

// ---------------------------------------------------------------------------
// In-memory cart storage (per-agent)
// ---------------------------------------------------------------------------

const carts = new Map<string, Cart>();

let cartCounter = 0;

function getOrCreateCart(agentId: string): Cart {
  let cart = carts.get(agentId);
  if (!cart) {
    cartCounter++;
    cart = {
      id: `cart-${cartCounter}-${Date.now().toString(36)}`,
      agentId,
      items: [],
      totalUsd: 0,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    carts.set(agentId, cart);
  }
  return cart;
}

function recalcTotal(cart: Cart): void {
  cart.totalUsd = cart.items.reduce(
    (sum, item) => sum + item.product.priceUsd * item.quantity,
    0,
  );
  // Round to avoid float weirdness
  cart.totalUsd = Math.round(cart.totalUsd * 100) / 100;
  cart.updatedAt = new Date().toISOString();
}

// ---------------------------------------------------------------------------
// cart_add
// ---------------------------------------------------------------------------

interface CartAddInput {
  sku: string;
  qty?: number;
}

interface CartAddResult {
  success: boolean;
  cart: Cart;
  addedItem: CartItem;
  message: string;
}

export function cart_add(args: CartAddInput, agentId: string): CartAddResult {
  const qty = args.qty ?? 1;
  if (qty < 1) {
    throw new Error('Quantity must be at least 1.');
  }

  // Find the product in catalog
  const product = TENNIS_BALL_CATALOG.find(
    (p) => p.sku.toUpperCase() === args.sku.toUpperCase(),
  );
  if (!product) {
    throw new Error(
      `Product not found: "${args.sku}". Use catalog_search to find valid SKUs.`,
    );
  }

  if (product.quantityInStock < qty) {
    throw new Error(
      `Insufficient stock for ${product.name}. Available: ${product.quantityInStock}, requested: ${qty}.`,
    );
  }

  const cart = getOrCreateCart(agentId);

  // Check if item already in cart — update quantity
  const existing = cart.items.find(
    (item) => item.product.sku === product.sku,
  );
  if (existing) {
    existing.quantity += qty;
  } else {
    cart.items.push({ product, quantity: qty });
  }

  recalcTotal(cart);

  const addedItem = cart.items.find((i) => i.product.sku === product.sku)!;

  return {
    success: true,
    cart,
    addedItem,
    message: `Added ${qty}x ${product.name} to cart. Total: $${cart.totalUsd.toFixed(2)}`,
  };
}

// ---------------------------------------------------------------------------
// cart_view
// ---------------------------------------------------------------------------

interface CartViewResult {
  cart: Cart | null;
  itemCount: number;
  message: string;
}

export function cart_view(agentId: string): CartViewResult {
  const cart = carts.get(agentId);

  if (!cart || cart.items.length === 0) {
    return {
      cart: null,
      itemCount: 0,
      message: 'Your cart is empty. Use catalog_search to find products!',
    };
  }

  return {
    cart,
    itemCount: cart.items.reduce((sum, item) => sum + item.quantity, 0),
    message: `Cart has ${cart.items.length} product(s), ${cart.items.reduce((s, i) => s + i.quantity, 0)} total items. Total: $${cart.totalUsd.toFixed(2)}`,
  };
}

// ---------------------------------------------------------------------------
// cart_remove
// ---------------------------------------------------------------------------

interface CartRemoveInput {
  sku: string;
}

interface CartRemoveResult {
  success: boolean;
  cart: Cart;
  removedProduct: string;
  message: string;
}

export function cart_remove(args: CartRemoveInput, agentId: string): CartRemoveResult {
  const cart = carts.get(agentId);
  if (!cart || cart.items.length === 0) {
    throw new Error('Cart is empty — nothing to remove.');
  }

  const idx = cart.items.findIndex(
    (item) => item.product.sku.toUpperCase() === args.sku.toUpperCase(),
  );
  if (idx === -1) {
    throw new Error(
      `Product "${args.sku}" not found in your cart. Current items: ${cart.items.map((i) => i.product.sku).join(', ')}`,
    );
  }

  const removed = cart.items.splice(idx, 1)[0];
  recalcTotal(cart);

  return {
    success: true,
    cart,
    removedProduct: removed.product.name,
    message: `Removed ${removed.product.name} from cart. New total: $${cart.totalUsd.toFixed(2)}`,
  };
}

// ---------------------------------------------------------------------------
// Exported helper — get a cart for checkout
// ---------------------------------------------------------------------------

export function getCart(agentId: string): Cart | undefined {
  return carts.get(agentId);
}

export function clearCart(agentId: string): void {
  carts.delete(agentId);
}
