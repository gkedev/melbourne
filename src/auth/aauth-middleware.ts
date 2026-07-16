// ============================================================================
// Court Ready — AAuth Verification Middleware
// ============================================================================
//
// MCP server's side of the AAuth protocol:
//
//   1. Agent sends request with HTTP Message Signature
//   2. Server returns 401 + Resource Token (aa-resource+jwt) — the "challenge"
//   3. Agent obtains Auth Token from Access Server, resends with Auth Token
//   4. Server verifies Auth Token, processes request
//
// For the demo, we:
//   - Accept any well-formed signature (no cryptographic verification)
//   - Generate an ephemeral EC keypair on startup for signing Resource Tokens
//   - Simulate Auth Token verification with relaxed checks
//
// ============================================================================

import * as jose from 'jose';
import { randomUUID } from 'node:crypto';

import type {
  AgentIdentity,
  ResourceToken,
  AuthToken,
  KyaPayClaims,
  CheckoutChallenge,
} from '../types.js';

import {
  DEMO_CONFIG,
  SCOPES,
  RESOURCE_TOKEN_TTL_SECONDS,
  KEY_ALGORITHM,
  KEY_ID_PREFIX,
} from './constants.js';

// ============================================================================
// Server Key Management
// ============================================================================

let serverPrivateKey: CryptoKey;
let serverPublicKey: CryptoKey;
let serverKeyId: string;

/**
 * Generate an ephemeral EC keypair for the demo server.
 * In production, keys would come from a KMS or config.
 */
export async function initializeServerKeys(): Promise<void> {
  serverKeyId = `${KEY_ID_PREFIX}-${Date.now().toString(36)}`;

  const kp = await jose.generateKeyPair(KEY_ALGORITHM as 'ES256', {
    extractable: true,
  });
  serverPrivateKey = kp.privateKey as CryptoKey;
  serverPublicKey = kp.publicKey as CryptoKey;
}

export function getServerIdentity() {
  return {
    url: DEMO_CONFIG.mcpServer.url,
    merchantId: DEMO_CONFIG.mcpServer.merchantId,
    name: DEMO_CONFIG.mcpServer.name,
    keyId: serverKeyId,
  };
}

export async function getServerPublicKeyJwk(): Promise<jose.JWK> {
  return jose.exportJWK(serverPublicKey);
}

// ============================================================================
// Agent Signature Verification
// ============================================================================

export interface RequestHeaders {
  'signature'?: string;
  'signature-key'?: string;
  'authorization'?: string;
  [key: string]: string | undefined;
}

/**
 * Verify the agent's HTTP Message Signature.
 * For the demo, we accept any well-formed signature header and extract
 * the agent identity from the Signature-Key header.
 */
export function verifyAgentSignature(headers: RequestHeaders): AgentIdentity | null {
  const sigKeyHeader = headers['signature-key'];
  if (!sigKeyHeader) return null;

  // In production: verify the signature using the agent's published JWKS
  // For demo: parse the Signature-Key header to extract agent info
  try {
    const parsed = JSON.parse(sigKeyHeader);
    return {
      id: parsed.kid || parsed.agentId || `anonymous-${randomUUID().slice(0, 8)}`,
      publicKey: parsed.jwk || '',
      name: parsed.name || 'Unknown Agent',
      capabilities: parsed.capabilities || [],
    };
  } catch {
    // Fallback: treat the header value as a plain agent ID
    return {
      id: sigKeyHeader,
      publicKey: '',
      name: sigKeyHeader,
      capabilities: [],
    };
  }
}

// ============================================================================
// Resource Token Creation
// ============================================================================

/**
 * Create a Resource Token (aa-resource+jwt).
 * This is the "challenge" token included in a 401 response. The agent
 * takes it to the Access Server (via Person Server) to get an Auth Token.
 */
export async function createResourceToken(
  agentId: string,
  scope: string[],
  accessServerUrl: string = DEMO_CONFIG.accessServer.url,
): Promise<string> {
  await ensureKeys();

  const now = Math.floor(Date.now() / 1000);

  const jwt = await new jose.SignJWT({
    sub: agentId,
    scope: scope.join(' '),
    merchant_id: DEMO_CONFIG.mcpServer.merchantId,
  })
    .setProtectedHeader({
      alg: KEY_ALGORITHM,
      typ: 'aa-resource+jwt',
      kid: serverKeyId,
    })
    .setIssuer(DEMO_CONFIG.mcpServer.url)
    .setAudience(accessServerUrl)
    .setIssuedAt(now)
    .setExpirationTime(now + RESOURCE_TOKEN_TTL_SECONDS)
    .setJti(randomUUID())
    .sign(serverPrivateKey);

  return jwt;
}

/**
 * Build a full AAuth challenge response (401 + resource token).
 */
export async function buildChallenge(
  agentId: string,
  requiredScopes: string[],
): Promise<CheckoutChallenge> {
  const token = await createResourceToken(agentId, requiredScopes);

  return {
    status: 401,
    type: 'aa-auth-required',
    resourceToken: {
      token,
      mcpServerId: DEMO_CONFIG.mcpServer.merchantId,
      scope: requiredScopes,
      issuedAt: new Date().toISOString(),
      expiresAt: new Date(Date.now() + RESOURCE_TOKEN_TTL_SECONDS * 1000).toISOString(),
    },
    message: 'Authentication required. Present this resource token to your Person Server.',
    requiredScopes,
  };
}

// ============================================================================
// Auth Token Verification
// ============================================================================

export interface AuthTokenVerification {
  valid: boolean;
  agentId?: string;
  scopes?: string[];
  kyaPay?: KyaPayClaims;
  reason?: string;
}

/**
 * Verify an Auth Token (aa-auth+jwt) presented by the agent.
 * In production: verify signature against the Access Server's published keys.
 * For demo: decode and check basic structure.
 */
export async function verifyAuthToken(
  authToken: AuthToken,
  _expectedAudience?: string,
): Promise<AuthTokenVerification> {
  try {
    // Basic structural checks
    if (!authToken.token || !authToken.agentId) {
      return { valid: false, reason: 'Missing token or agentId' };
    }

    if (!authToken.tokenId) {
      return { valid: false, reason: 'Missing tokenId' };
    }

    // Check expiry
    if (authToken.expiresAt) {
      const expiry = new Date(authToken.expiresAt).getTime();
      if (Date.now() > expiry) {
        return { valid: false, reason: 'Auth token expired' };
      }
    }

    return {
      valid: true,
      agentId: authToken.agentId,
      scopes: authToken.kyaPay?.allowedScopes,
      kyaPay: authToken.kyaPay,
    };
  } catch (err: any) {
    return { valid: false, reason: `Verification failed: ${err.message}` };
  }
}

/**
 * Extract KYA-PAY claims from an Auth Token.
 */
export function extractKyaPayClaims(authToken: AuthToken): KyaPayClaims | null {
  return authToken.kyaPay ?? null;
}

// ============================================================================
// Demo Helpers
// ============================================================================

/**
 * Create a demo auth token for testing tool logic without the full AAuth flow.
 * Used when the MCP server is started with --demo flag.
 */
export async function createDemoAuthToken(agentId: string): Promise<AuthToken> {
  await ensureKeys();

  const tokenId = `demo-${randomUUID().slice(0, 8)}`;

  const kyaPay: KyaPayClaims = {
    maxAmountUsd: 200,
    merchantId: DEMO_CONFIG.mcpServer.merchantId,
    allowedScopes: Object.values(SCOPES),
    missionId: 'demo-mission',
  };

  const now = Math.floor(Date.now() / 1000);

  const jwt = await new jose.SignJWT({
    sub: agentId,
    kya_pay: kyaPay,
    mission_id: 'demo-mission',
  })
    .setProtectedHeader({ alg: KEY_ALGORITHM, typ: 'aa-auth+jwt' })
    .setIssuer(DEMO_CONFIG.accessServer.url)
    .setAudience(DEMO_CONFIG.mcpServer.url)
    .setIssuedAt(now)
    .setExpirationTime(now + 3600)
    .setJti(tokenId)
    .sign(serverPrivateKey);

  return {
    token: jwt,
    tokenId,
    agentId,
    missionId: 'demo-mission',
    kyaPay,
    issuedAt: new Date(now * 1000).toISOString(),
    expiresAt: new Date((now + 3600) * 1000).toISOString(),
  };
}

// ── Internal ───────────────────────────────────────────────────────

async function ensureKeys() {
  if (!serverPrivateKey) {
    await initializeServerKeys();
  }
}
