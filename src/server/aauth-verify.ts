// ============================================================================
// Court Ready — Server-Side AAuth Token Verification
// ============================================================================
//
// MCP server's real AAuth token verification using the @aauth/mcp-server SDK.
//
// In the AAuth protocol, the resource server (this MCP server) needs to:
//
//   1. Issue Resource Tokens (aa-resource+jwt) — the 401 "challenge" that
//      tells the agent: "authenticate via your auth server to access this
//      resource". The resource token is signed by *this server's* key and
//      includes the auth server URL, required scope, and agent binding.
//
//   2. Verify Auth Tokens (aa-auth+jwt) — when the agent retries with an
//      auth token obtained from the auth server (Keycard), this server
//      verifies the token's signature, key binding (cnf.jwk vs HTTP sig),
//      expiry, and claims.
//
// Token Flow:
//
//   Agent → request → MCP Server
//                       ↓ (no auth token)
//   Agent ← 401 + resource_token ← MCP Server
//     ↓
//   Agent → resource_token → Auth Server (Keycard)
//     ↓
//   Agent ← auth_token ← Auth Server
//     ↓
//   Agent → request + auth_token → MCP Server
//                                    ↓ (verify auth token)
//                                    ↓ ✓
//   Agent ← 200 response ← MCP Server
//
// ============================================================================

import { randomUUID } from 'node:crypto';

// ── @aauth/mcp-server — token verification & resource token creation ──
import {
  verifyToken,
  createResourceToken as sdkCreateResourceToken,
  buildAAuthHeader,
  AAuthTokenError,
  clearMetadataCache,
} from '@aauth/mcp-server';
import type {
  VerifyTokenOptions,
  VerifiedAgentToken,
  VerifiedAuthToken,
  VerifiedToken,
  ResourceTokenOptions,
  SignFn,
} from '@aauth/mcp-server';

// ── jose — server key management for signing resource tokens ──────
import {
  generateKeyPair,
  exportJWK,
  importJWK,
  SignJWT,
  calculateJwkThumbprint,
} from 'jose';
import type { JWK } from 'jose';

import { DEMO_CONFIG } from '../auth/constants.js';

// ── Colours & Logging ──────────────────────────────────────────────
const YELLOW = '\x1b[33m';
const GREEN  = '\x1b[32m';
const RED    = '\x1b[31m';
const CYAN   = '\x1b[36m';
const RESET  = '\x1b[0m';
const BOLD   = '\x1b[1m';
const DIM    = '\x1b[2m';

function log(msg: string) {
  const ts = new Date().toISOString().slice(11, 23);
  console.log(`${DIM}${ts}${RESET} ${YELLOW}${BOLD}🛡️  [AAuth]${RESET} ${msg}`);
}

// ============================================================================
// Verified Agent Result
// ============================================================================

/**
 * Result of verifying an incoming AAuth token.
 *
 * Contains the agent's identity, capabilities, mission context, and
 * whether the token was cryptographically verified.
 */
export interface VerifiedAgent {
  /** The agent's AAuth identifier (sub claim from agent token, or agent claim from auth token) */
  agentId: string;

  /** The agent's published URL (iss claim — where /.well-known/aauth-agent.json lives) */
  agentUrl: string;

  /** Capabilities the agent declared (from AAuth-Capabilities header) */
  capabilities: string[];

  /** Mission context if the agent declared one (from AAuth-Mission header) */
  mission?: { id: string; description: string };

  /** Whether the token was cryptographically verified (true = SDK verification passed) */
  verified: boolean;
}

// ============================================================================
// Server Key Management
// ============================================================================
//
// The MCP server needs its own signing key to create resource tokens.
// In production, this would come from a KMS, vault, or config file.
// For the demo, we generate an ephemeral Ed25519 keypair on startup.
//
// The resource token is signed by this server's key, so the auth server
// can verify it came from a legitimate resource. The auth server fetches
// this server's JWKS from /.well-known/aauth-resource.json to verify.

let serverPrivateJwk: JWK | null = null;
let serverPublicJwk: JWK | null = null;
let serverKid: string | null = null;

/**
 * Ensure the server has a signing keypair.
 * Generates one on first call (lazy initialization).
 */
async function ensureServerKeys(): Promise<void> {
  if (serverPrivateJwk && serverPublicJwk && serverKid) return;

  log(`Generating server Ed25519 signing key…`);

  // Generate an Ed25519 keypair for signing resource tokens
  const { publicKey, privateKey } = await generateKeyPair('EdDSA', { crv: 'Ed25519' });

  serverPrivateJwk = await exportJWK(privateKey);
  serverPublicJwk  = await exportJWK(publicKey);
  serverKid        = `court-ready-${Date.now().toString(36)}`;

  // Tag both with kid and alg
  serverPrivateJwk.kid = serverKid;
  serverPrivateJwk.alg = 'EdDSA';
  serverPublicJwk.kid  = serverKid;
  serverPublicJwk.alg  = 'EdDSA';

  log(`  ${GREEN}✓ Server signing key ready${RESET}`);
  log(`    kid   : ${DIM}${serverKid}${RESET}`);
  log(`    alg   : EdDSA (Ed25519)`);
}

/**
 * Get the server's public key JWK for publishing in the JWKS endpoint.
 * Resource servers publish their public keys at:
 *   {resource}/.well-known/aauth-resource.json → { jwks_uri: "..." }
 */
export async function getServerPublicJwk(): Promise<JWK> {
  await ensureServerKeys();
  return { ...serverPublicJwk! };
}

// ============================================================================
// Token Verification
// ============================================================================

/**
 * Verify an incoming AAuth token from an agent.
 *
 * Supports both token types:
 *
 *   - **Agent Token (aa-agent+jwt)**: Self-issued by the agent. Proves the
 *     agent controls the key published at their agent URL. Used for initial
 *     identification before the challenge-response flow.
 *
 *   - **Auth Token (aa-auth+jwt)**: Issued by the auth server (Keycard)
 *     after the agent exchanges a resource token. Proves the agent has
 *     authorization from their person/auth server to access this resource.
 *
 * Verification steps (handled by @aauth/mcp-server's verifyToken):
 *   1. Decode JWT header — check `typ` is aa-agent+jwt or aa-auth+jwt
 *   2. Validate required claims (iss, sub/agent, cnf.jwk, exp, dwk)
 *   3. Check expiry with clock skew tolerance (60s)
 *   4. Key binding — verify cnf.jwk thumbprint matches httpSignatureThumbprint
 *   5. Resolve issuer JWKS via /.well-known/{dwk} → jwks_uri
 *   6. Verify JWT signature against issuer's published JWKS
 *
 * @param token - The raw JWT string (from Signature-Key header or Authorization)
 * @param options.audience - Expected audience for auth tokens (this server's URL)
 * @param options.httpSignatureThumbprint - JWK thumbprint of the HTTP signature key
 *   (required for key binding verification — proves the same key signed both
 *   the HTTP request and is bound in the token's cnf claim)
 */
export async function verifyAAuthToken(
  token: string,
  options?: {
    audience?: string;
    httpSignatureThumbprint?: string;
  },
): Promise<VerifiedAgent> {
  log(`Verifying AAuth token…`);
  log(`  Token (abbrev): ${DIM}${token.slice(0, 40)}…${RESET}`);

  try {
    // ── Build verification options ────────────────────────────
    // The SDK's verifyToken requires the HTTP signature thumbprint
    // to enforce key binding (cnf.jwk must match the signing key
    // used in the HTTP Message Signature).
    const verifyOptions: VerifyTokenOptions = {
      jwt: token,
      httpSignatureThumbprint: options?.httpSignatureThumbprint ?? '',
    };

    // ── Call the real SDK verification ────────────────────────
    // This performs full cryptographic verification:
    //   - Fetches issuer metadata from /.well-known/{dwk}
    //   - Fetches JWKS from the metadata's jwks_uri
    //   - Verifies JWT signature against JWKS
    //   - Validates claims (exp, iss, sub/agent, cnf)
    //   - Checks key binding (cnf.jwk thumbprint)
    const verified: VerifiedToken = await verifyToken(verifyOptions);

    if (verified.type === 'agent') {
      // ── Agent Token (aa-agent+jwt) ──────────────────────────
      // Self-issued by the agent. Proves identity but not authorization.
      const agentToken = verified as VerifiedAgentToken;

      log(`  ${GREEN}✓ Agent token verified${RESET}`);
      log(`    type    : aa-agent+jwt`);
      log(`    iss     : ${DIM}${agentToken.iss}${RESET}`);
      log(`    sub     : ${DIM}${agentToken.sub}${RESET}`);
      log(`    expires : ${new Date(agentToken.exp * 1000).toISOString()}`);

      return {
        agentId: agentToken.sub,
        agentUrl: agentToken.iss,
        capabilities: [],
        verified: true,
      };

    } else {
      // ── Auth Token (aa-auth+jwt) ────────────────────────────
      // Issued by the auth server. Proves the agent is authorized
      // to access this resource with specific scope/permissions.
      const authToken = verified as VerifiedAuthToken;

      log(`  ${GREEN}✓ Auth token verified${RESET}`);
      log(`    type    : aa-auth+jwt`);
      log(`    iss     : ${DIM}${authToken.iss}${RESET}`);
      log(`    agent   : ${DIM}${authToken.agent}${RESET}`);
      log(`    aud     : ${DIM}${JSON.stringify(authToken.aud)}${RESET}`);
      if (authToken.scope) {
        log(`    scope   : ${DIM}${authToken.scope}${RESET}`);
      }
      log(`    expires : ${new Date(authToken.exp * 1000).toISOString()}`);

      return {
        agentId: authToken.agent,
        agentUrl: authToken.iss,
        capabilities: authToken.scope ? authToken.scope.split(' ') : [],
        verified: true,
      };
    }

  } catch (err: any) {
    // ── Handle verification failures gracefully ──────────────
    if (err instanceof AAuthTokenError) {
      log(`  ${RED}✗ Token verification failed${RESET}`);
      log(`    code    : ${err.code}`);
      log(`    message : ${err.message}`);

      // Return an unverified result — the caller decides whether to
      // reject or proceed with reduced trust (e.g., for catalog browsing).
      return {
        agentId: 'unknown',
        agentUrl: 'unknown',
        capabilities: [],
        verified: false,
      };
    }

    // Unexpected errors (network failures, malformed JWTs, etc.)
    log(`  ${RED}✗ Unexpected verification error: ${err.message}${RESET}`);

    return {
      agentId: 'unknown',
      agentUrl: 'unknown',
      capabilities: [],
      verified: false,
    };
  }
}

// ============================================================================
// Resource Token Issuance (401 Challenge)
// ============================================================================

/**
 * Create a resource token (aa-resource+jwt) — the 401 challenge.
 *
 * When an agent makes an unauthenticated request, the MCP server returns:
 *
 *   HTTP/1.1 401 Unauthorized
 *   AAuth-Requirement: auth-token resource_token="<this token>"
 *
 * The agent then takes this resource token to the auth server to exchange
 * it for an auth token (aa-auth+jwt) that grants access.
 *
 * Resource token claims:
 *   - iss: this resource server's URL
 *   - dwk: "aauth-resource.json" (where to find this server's JWKS)
 *   - aud: the auth server URL (who should receive this token)
 *   - agent: the requesting agent's identifier
 *   - agent_jkt: JWK thumbprint of the agent's key (key binding)
 *   - scope: what permissions the agent needs
 *   - mission: optional mission context
 *
 * @param agentId - The requesting agent's AAuth identifier
 * @param scope - Required permission scopes (e.g., ["checkout:initiate"])
 * @param accessServerUrl - The auth server URL for the resource token's audience
 */
export async function issueResourceToken(
  agentId: string,
  scope: string[],
  accessServerUrl: string = DEMO_CONFIG.accessServer.url,
): Promise<string> {
  await ensureServerKeys();

  log(`Issuing resource token (401 challenge)…`);
  log(`  agent         : ${DIM}${agentId}${RESET}`);
  log(`  scope         : ${scope.join(', ')}`);
  log(`  auth server   : ${DIM}${accessServerUrl}${RESET}`);

  // ── Build the sign function ───────────────────────────────
  // @aauth/mcp-server's createResourceToken is decoupled from key
  // management — it takes a sign function so the caller can use any
  // key source (KMS, vault, HSM, ephemeral).
  //
  // The sign function receives the JWT payload and header, and returns
  // the signed JWT string.
  const sign: SignFn = async (
    payload: Record<string, unknown>,
    header: Record<string, unknown>,
  ): Promise<string> => {
    const alg = (header.alg as string) ?? 'EdDSA';
    const rootKey = await importJWK(serverPrivateJwk!, alg);

    return new SignJWT(payload)
      .setProtectedHeader({
        ...header,
        kid: serverKid!,
      } as any)
      .sign(rootKey);
  };

  // ── Compute agent JWK thumbprint ──────────────────────────
  // The resource token includes agent_jkt — the JWK thumbprint of the
  // agent's key. This binds the resource token to a specific agent,
  // preventing token theft. The auth server checks that the agent
  // presenting the resource token has the matching key.
  //
  // For the demo, we use a placeholder since we may not have the
  // agent's full JWK at challenge time. In a production system,
  // the agent's cnf.jwk from the Signature-Key header would be used.
  const agentJkt = 'demo-agent-jkt';

  // ── Build resource token options ──────────────────────────
  const resourceTokenOptions: ResourceTokenOptions = {
    resource: DEMO_CONFIG.mcpServer.url,  // This server (iss claim)
    authServer: accessServerUrl,           // Auth server (aud claim)
    agent: agentId,                        // Requesting agent
    agentJkt,                              // Agent key thumbprint
    scope: scope.join(' '),                // Required permissions
  };

  // ── Create the resource token using the SDK ───────────────
  const resourceToken = await sdkCreateResourceToken(resourceTokenOptions, sign);

  log(`  ${GREEN}✓ Resource token created${RESET}`);
  log(`    token (abbrev): ${DIM}${resourceToken.slice(0, 40)}…${RESET}`);

  return resourceToken;
}

// ============================================================================
// Helpers — AAuth Response Headers
// ============================================================================

/**
 * Build the AAuth-Requirement response header for a 401 challenge.
 *
 * Returns the header value string to set on the 401 response:
 *   AAuth-Requirement: auth-token resource_token="<jwt>"
 *
 * The agent's AAuth-aware fetch wrapper (createAAuthFetch) parses this
 * header, extracts the resource token, and initiates the token exchange.
 */
export function buildChallengeHeader(resourceToken: string): string {
  return buildAAuthHeader('auth-token', { resourceToken });
}

/**
 * Clear the server-side metadata cache.
 *
 * The SDK caches issuer metadata (/.well-known/{dwk} → jwks_uri) for
 * 10 minutes. Call this if you need to force re-fetching, e.g., after
 * a key rotation.
 */
export function clearVerificationCache(): void {
  clearMetadataCache();
  log(`  ${CYAN}ℹ Metadata cache cleared${RESET}`);
}

/**
 * Get the server's kid for resource tokens.
 * Useful for building /.well-known/aauth-resource.json metadata.
 */
export async function getServerKid(): Promise<string> {
  await ensureServerKeys();
  return serverKid!;
}
