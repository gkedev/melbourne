// ============================================================================
// Court Ready — Demo Configuration & Constants
// ============================================================================
// Well-known URLs and identifiers for the three AAuth participants:
//
//   1. MCP Server (Resource Server) — this server, "Court Ready Tennis Shop"
//   2. Person Server — AAuth.dev, vouches for agent identity
//   3. Access Server — Keycard, issues Auth Tokens after human authorization
//
// In production these would come from environment variables or discovery.
// For the demo they're hardcoded constants.
// ============================================================================

export const DEMO_CONFIG = {
  mcpServer: {
    url: 'https://courtready.store/api',
    merchantId: 'court-ready-store-001',
    name: 'Court Ready Tennis Shop',
  },
  personServer: {
    url: 'https://ps.aauth.dev',
    name: 'AAuth.dev Person Server',
  },
  accessServer: {
    url: 'https://t55y1t1etlnq7ws9cgidzfxm2d.keycard.cloud',
    zoneId: 't55y1t1etlnq7ws9cgidzfxm2d',
    name: 'Keycard Access Server',
  },
  kyapay: {
    defaultCurrency: 'USD',
    maxTransactionUsd: 500,
  },
} as const;

// ---------------------------------------------------------------------------
// AAuth Scope Constants
// ---------------------------------------------------------------------------
// Scopes define what an agent is allowed to do. The MCP server checks these
// when validating an Auth Token.
// ---------------------------------------------------------------------------

/** Scopes that the Court Ready MCP server recognizes. */
export const SCOPES = {
  /** Browse catalog — read-only, low-trust. */
  CATALOG_READ: 'catalog:read',
  /** Manage cart — add/remove/view items. */
  CART_WRITE: 'cart:write',
  /** Initiate checkout — requires KYA-PAY claims. */
  CHECKOUT: 'checkout:initiate',
  /** Confirm a checkout — final purchase, requires KYA-PAY with sufficient limit. */
  CHECKOUT_CONFIRM: 'checkout:confirm',
} as const;

export type Scope = (typeof SCOPES)[keyof typeof SCOPES];

// ---------------------------------------------------------------------------
// JWT Configuration
// ---------------------------------------------------------------------------

/** How long a Resource Token is valid (seconds). */
export const RESOURCE_TOKEN_TTL_SECONDS = 300; // 5 minutes

/** How long a demo Auth Token is valid (seconds). */
export const AUTH_TOKEN_TTL_SECONDS = 3600; // 1 hour

/** Key algorithm used for demo JWT signing. */
export const KEY_ALGORITHM = 'ES256';

/** Key ID prefix for the demo server's signing key. */
export const KEY_ID_PREFIX = 'court-ready-demo';
