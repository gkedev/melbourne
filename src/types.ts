// ============================================================================
// Court Ready Tennis Shop — Type Definitions
// ============================================================================
// Unified types for the AAuth 4-party MCP demo.
//
// Parties:
//   Agent          — AI shopping agent (signs requests, proposes missions)
//   Resource       — MCP ecommerce server (this server)
//   Person Server  — AAuth.dev (represents user G, manages missions)
//   Access Server  — Keycard (issues auth tokens, enforces governance)
//   KYA-PAY        — Payment claims embedded in auth tokens
// ============================================================================

// ---------------------------------------------------------------------------
// Product & Catalog
// ---------------------------------------------------------------------------

export interface Product {
  sku: string;
  name: string;
  brand: string;
  description: string;
  category: 'competition' | 'recreational' | 'premium' | 'practice' | 'specialty';
  priceUsd: number;
  currency: string;
  quantityInStock: number;
  imageUrl?: string;
  tags: string[];
}

// ---------------------------------------------------------------------------
// Cart
// ---------------------------------------------------------------------------

export interface CartItem {
  product: Product;
  quantity: number;
}

export interface Cart {
  id: string;
  agentId: string;
  items: CartItem[];
  totalUsd: number;
  createdAt: string;
  updatedAt: string;
}

// ---------------------------------------------------------------------------
// Agent Identity (AAuth)
// ---------------------------------------------------------------------------

export interface AgentIdentity {
  id: string;
  publicKey: string;
  name: string;
  capabilities: string[];
}

// ---------------------------------------------------------------------------
// Resource Token (aa-resource+jwt)
// Issued by MCP server when agent hasn't authenticated.
// The agent presents this to their Person Server → Access Server chain.
// ---------------------------------------------------------------------------

export interface ResourceToken {
  token: string;
  mcpServerId: string;
  scope: string[];
  issuedAt: string;
  expiresAt: string;
}

// ---------------------------------------------------------------------------
// Auth Token (aa-auth+jwt)
// Issued by Access Server (Keycard) after the Person Server federates.
// Agent presents this back to the MCP server to prove authorization.
// ---------------------------------------------------------------------------

export interface AuthToken {
  token: string;          // the signed JWT
  tokenId: string;        // unique token identifier for revocation
  agentId: string;
  missionId: string;
  kyaPay: KyaPayClaims;   // embedded payment authorization
  issuedAt: string;
  expiresAt: string;
}

// ---------------------------------------------------------------------------
// KYA-PAY Claims
// Payment authorization embedded in the auth token by the Access Server.
// ---------------------------------------------------------------------------

export interface KyaPayClaims {
  maxAmountUsd: number;
  merchantId: string;
  allowedScopes: string[];
  missionId: string;
}

// ---------------------------------------------------------------------------
// Mission (AAuth concept)
// Agent proposes, Person Server approves, Access Server enforces.
// ---------------------------------------------------------------------------

export interface Mission {
  id: string;
  agentId: string;
  description: string;
  scope: string[];
  spendingLimit: number;
  status: 'proposed' | 'approved' | 'denied' | 'completed';
  createdAt: string;
}

// ---------------------------------------------------------------------------
// Checkout Challenge
// Returned by MCP server when the agent needs AAuth authorization.
// ---------------------------------------------------------------------------

export interface CheckoutChallenge {
  status: number;                   // 401
  type: 'aa-auth-required';
  resourceToken: ResourceToken;
  message: string;
  requiredScopes: string[];
}

// ---------------------------------------------------------------------------
// Order
// ---------------------------------------------------------------------------

export interface Order {
  orderId: string;
  agentId: string;
  items: CartItem[];
  totalUsd: number;
  currency: string;
  missionId: string;
  kyaPayAuthorized: boolean;
  createdAt: string;
  status: 'confirmed' | 'processing' | 'shipped' | 'delivered' | 'cancelled';
}
