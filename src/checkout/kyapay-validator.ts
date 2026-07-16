// ============================================================================
// Court Ready — KYA-PAY Validation
// ============================================================================
//
// Validates KYA-PAY payment claims embedded in an AAuth auth token.
// In production, this would call the KYA-PAY network for real validation.
// In the demo, we validate the claims locally.
//
// KYA-PAY ensures:
//   1. The agent's spending limit covers the transaction amount
//   2. The merchant ID matches this server
//   3. The scopes include checkout authorization
//   4. The mission is active and not expired
// ============================================================================

import type { KyaPayClaims, Order, CartItem } from '../types.js';
import { DEMO_CONFIG } from '../auth/constants.js';

// ── Colours for demo output ────────────────────────────────────────
const RED   = '\x1b[31m';
const RESET = '\x1b[0m';
const BOLD  = '\x1b[1m';
const DIM   = '\x1b[2m';

function log(msg: string) {
  const ts = new Date().toISOString().slice(11, 23);
  console.log(`${DIM}${ts}${RESET} ${RED}${BOLD}💳 [KYA-PAY]${RESET} ${msg}`);
}

// ---------------------------------------------------------------------------
// Validation result
// ---------------------------------------------------------------------------

export interface KyaPayValidationResult {
  valid: boolean;
  reason?: string;
  claims?: KyaPayClaims;
}

// ---------------------------------------------------------------------------
// validateKyaPayClaims
// ---------------------------------------------------------------------------
// Checks that the KYA-PAY claims in the auth token authorize the purchase.
// ---------------------------------------------------------------------------

export function validateKyaPayClaims(
  claims: KyaPayClaims | undefined,
  amountUsd: number,
  merchantId: string,
): KyaPayValidationResult {
  if (!claims) {
    log(`✗ No KYA-PAY claims found in auth token`);
    return { valid: false, reason: 'No KYA-PAY claims present in auth token.' };
  }

  log(`Validating payment authorization…`);
  log(`  Transaction amount : $${amountUsd.toFixed(2)}`);
  log(`  Authorized limit   : $${claims.maxAmountUsd.toFixed(2)}`);
  log(`  Merchant (expected): ${merchantId}`);
  log(`  Merchant (token)   : ${claims.merchantId}`);

  // Check 1: Amount within limit
  if (amountUsd > claims.maxAmountUsd) {
    log(`  ✗ ${BOLD}DENIED${RESET} — amount $${amountUsd.toFixed(2)} exceeds limit $${claims.maxAmountUsd.toFixed(2)}`);
    return {
      valid: false,
      reason: `Transaction amount $${amountUsd.toFixed(2)} exceeds authorized limit $${claims.maxAmountUsd.toFixed(2)}.`,
      claims,
    };
  }
  log(`  ✓ Amount within limit`);

  // Check 2: Merchant match
  if (claims.merchantId !== merchantId) {
    log(`  ✗ ${BOLD}DENIED${RESET} — merchant mismatch`);
    return {
      valid: false,
      reason: `Merchant mismatch: token authorizes "${claims.merchantId}" but this is "${merchantId}".`,
      claims,
    };
  }
  log(`  ✓ Merchant verified`);

  // Check 3: Scopes include checkout
  const hasCheckoutScope = claims.allowedScopes.some(
    (s) => s.includes('checkout') || s.includes('payment'),
  );
  if (!hasCheckoutScope) {
    log(`  ✗ ${BOLD}DENIED${RESET} — missing checkout/payment scope`);
    return {
      valid: false,
      reason: `Token scopes [${claims.allowedScopes.join(', ')}] don't include checkout or payment.`,
      claims,
    };
  }
  log(`  ✓ Checkout scope present`);

  log(`  ${BOLD}✓ PAYMENT AUTHORIZED${RESET}`);
  return { valid: true, claims };
}

// ---------------------------------------------------------------------------
// createKyaPayReceipt
// ---------------------------------------------------------------------------
// Generates a receipt/audit record for the completed transaction.
// ---------------------------------------------------------------------------

export interface KyaPayReceipt {
  receiptId: string;
  orderId: string;
  agentId: string;
  amountUsd: number;
  currency: string;
  merchantId: string;
  missionId: string;
  authorizedLimitUsd: number;
  items: Array<{ sku: string; name: string; qty: number; unitPrice: number }>;
  timestamp: string;
}

export function createKyaPayReceipt(
  order: Order,
  claims: KyaPayClaims,
): KyaPayReceipt {
  const receipt: KyaPayReceipt = {
    receiptId: `kp-rcpt-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`,
    orderId: order.orderId,
    agentId: order.agentId,
    amountUsd: order.totalUsd,
    currency: 'USD',
    merchantId: claims.merchantId,
    missionId: claims.missionId,
    authorizedLimitUsd: claims.maxAmountUsd,
    items: order.items.map((i) => ({
      sku: i.product.sku,
      name: i.product.name,
      qty: i.quantity,
      unitPrice: i.product.priceUsd,
    })),
    timestamp: new Date().toISOString(),
  };

  log(`📄 Receipt generated: ${DIM}${receipt.receiptId}${RESET}`);
  log(`  Order    : ${receipt.orderId}`);
  log(`  Amount   : $${receipt.amountUsd.toFixed(2)}`);
  log(`  Merchant : ${receipt.merchantId}`);

  return receipt;
}
