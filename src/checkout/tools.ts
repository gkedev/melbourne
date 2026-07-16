// ============================================================================
// Court Ready — Checkout Tool Handlers
// ============================================================================
//
// Checkout is where the AAuth 4-party flow really comes alive.
//
// Flow position:  Catalog → Cart → [CHECKOUT] → Order
//
// Tools:
//   checkout_initiate — Start checkout → returns AAuth 401 challenge
//   checkout_confirm  — Complete purchase with signed auth token + KYA-PAY
//
// This is the critical handoff:
//   1. Agent calls checkout_initiate
//   2. MCP server returns a 401 + resource token (the AAuth challenge)
//   3. Agent takes the resource token to its Person Server (AAuth.dev)
//   4. Person Server federates to Access Server (Keycard)
//   5. Agent gets back an auth token with KYA-PAY claims
//   6. Agent calls checkout_confirm with the auth token
//   7. MCP server validates everything → order placed
// ============================================================================

import crypto from 'node:crypto';
import type {
  Cart,
  CheckoutChallenge,
  ResourceToken,
  AuthToken,
  Order,
  KyaPayClaims,
} from '../types.js';
import { getCart, clearCart } from '../cart/tools.js';
import { DEMO_CONFIG } from '../auth/constants.js';
import { validateKyaPayClaims, createKyaPayReceipt } from './kyapay-validator.js';

// ---------------------------------------------------------------------------
// In-memory state
// ---------------------------------------------------------------------------

/** Active checkout challenges, keyed by challenge ID. */
const challenges = new Map<string, CheckoutChallenge>();

/** Completed orders. */
const orders: Order[] = [];

// ---------------------------------------------------------------------------
// checkout_initiate
// ---------------------------------------------------------------------------
// Creates the AAuth challenge. This is the "401 handshake" — the MCP server
// says "you need authorization" and gives the agent a resource token to
// take to the Access Server.
// ---------------------------------------------------------------------------

interface CheckoutInitiateResult {
  challenge: CheckoutChallenge;
  instructions: string;
}

export function checkout_initiate(agentId: string): CheckoutInitiateResult {
  const cart = getCart(agentId);

  if (!cart || cart.items.length === 0) {
    throw new Error(
      'Cannot checkout — your cart is empty. Add items with cart_add first.',
    );
  }

  // Build the resource token (aa-resource+jwt)
  // In production this would be a signed JWT; for the demo it's a structured token
  const resourceToken: ResourceToken = {
    token: `rt-${crypto.randomBytes(16).toString('hex')}`,
    mcpServerId: DEMO_CONFIG.mcpServer.merchantId,
    scope: ['checkout:complete', 'payment:process'],
    issuedAt: new Date().toISOString(),
    expiresAt: new Date(Date.now() + 10 * 60 * 1000).toISOString(), // 10 min
  };

  // Build the checkout challenge
  const challenge: CheckoutChallenge = {
    status: 401,
    type: 'aa-auth-required',
    resourceToken,
    message:
      'Authentication required. Present this resource token to your Person Server ' +
      'to obtain an auth token from the Access Server.',
    requiredScopes: ['checkout:complete', 'payment:process'],
  };

  // Store the challenge for later verification
  challenges.set(resourceToken.token, challenge);

  return {
    challenge,
    instructions: [
      '1. Take the resourceToken to your Person Server (AAuth.dev)',
      '2. Person Server will federate to Access Server (Keycard)',
      '3. You will receive an aa-auth+jwt with KYA-PAY claims',
      '4. Call checkout_confirm with the auth token to complete your purchase',
      `Cart total: $${cart.totalUsd.toFixed(2)}`,
    ].join('\n'),
  };
}

// ---------------------------------------------------------------------------
// checkout_confirm
// ---------------------------------------------------------------------------
// Completes the purchase. The agent must present a valid auth token with
// KYA-PAY claims that cover the cart total.
// ---------------------------------------------------------------------------

interface CheckoutConfirmInput {
  authToken: AuthToken;
}

interface CheckoutConfirmResult {
  success: boolean;
  order: Order;
  receipt: ReturnType<typeof createKyaPayReceipt>;
  message: string;
}

export function checkout_confirm(
  args: CheckoutConfirmInput,
  agentId: string,
): CheckoutConfirmResult {
  const { authToken } = args;

  // Verify the agent matches
  if (authToken.agentId !== agentId) {
    throw new Error('Auth token agent ID does not match the requesting agent.');
  }

  // Get the cart
  const cart = getCart(agentId);
  if (!cart || cart.items.length === 0) {
    throw new Error('Cart is empty — nothing to checkout.');
  }

  // Validate KYA-PAY claims
  const validation = validateKyaPayClaims(
    authToken.kyaPay,
    cart.totalUsd,
    DEMO_CONFIG.mcpServer.merchantId,
  );

  if (!validation.valid) {
    throw new Error(`Payment denied: ${validation.reason}`);
  }

  // Create the order
  const order: Order = {
    orderId: `ORD-${Date.now().toString(36).toUpperCase()}`,
    agentId,
    items: [...cart.items],
    totalUsd: cart.totalUsd,
    currency: 'USD',
    missionId: authToken.missionId,
    kyaPayAuthorized: true,
    createdAt: new Date().toISOString(),
    status: 'confirmed',
  };

  orders.push(order);

  // Generate KYA-PAY receipt
  const receipt = createKyaPayReceipt(order, authToken.kyaPay);

  // Clear the cart
  clearCart(agentId);

  return {
    success: true,
    order,
    receipt,
    message: `🎉 Order ${order.orderId} confirmed! ${cart.items.length} item(s), $${order.totalUsd.toFixed(2)} paid via KYA-PAY.`,
  };
}

// ---------------------------------------------------------------------------
// Exported helpers
// ---------------------------------------------------------------------------

export function getOrders(agentId?: string): Order[] {
  if (agentId) {
    return orders.filter((o) => o.agentId === agentId);
  }
  return [...orders];
}
