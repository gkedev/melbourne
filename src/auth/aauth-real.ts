// ============================================================================
// Court Ready — Real AAuth SDK Integration (Agent Side)
// ============================================================================
//
// Replaces the Person Server mock with real AAuth SDK calls.
// Uses the @aauth/local-keys and @aauth/mcp-agent packages to:
//
//   1. Generate & persist an Ed25519 keypair (the agent's signing identity)
//   2. Create signed agent tokens (aa-agent+jwt) with ephemeral DPoP keys
//   3. Build a protocol-aware fetch wrapper that handles the full AAuth flow:
//      — HTTP Message Signatures on every outgoing request
//      — 401 AAuth-Requirement challenge → token exchange → retry
//      — 202 interaction polling (user consent flows)
//      — Auth token caching per {resource, auth-server}
//
// AAuth Protocol Overview (from the agent's perspective):
//
//   ┌─────────┐        ┌──────────┐        ┌─────────────┐
//   │  Agent  │──req──▶│ Resource │        │ Auth Server │
//   │         │◀─401───│  Server  │        │  (Keycard)  │
//   │         │        └──────────┘        │             │
//   │         │──resource_token──────────▶│             │
//   │         │◀─────────auth_token──────│             │
//   │         │──req + auth_token──────▶ │ Resource    │
//   │         │◀─────────200─────────── │  Server     │
//   └─────────┘                          └─────────────┘
//
// ============================================================================

import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

// ── @aauth/local-keys — key generation, JWK management ────────────
import {
  generateKey,
  generateKid,
  toPublicJwk,
} from '@aauth/local-keys';
import type {
  GeneratedKeyPair,
} from '@aauth/local-keys';

// ── @aauth/mcp-agent — signed fetch & AAuth challenge-response ────
import {
  createAAuthFetch,
  createSignedFetch,
  decodeJwtPayload,
} from '@aauth/mcp-agent';
import type {
  GetKeyMaterial,
  FetchLike,
  AAuthFetchOptions,
} from '@aauth/mcp-agent';

// ── jose — JWT signing for agent tokens ────────────────────────────
import {
  importJWK,
  exportJWK,
  SignJWT,
  generateKeyPair,
  calculateJwkThumbprint,
} from 'jose';
import type { JWK } from 'jose';

import { randomUUID } from 'node:crypto';

import { DEMO_CONFIG } from './constants.js';

// ── Colours & Logging ──────────────────────────────────────────────
const YELLOW = '\x1b[33m';
const GREEN  = '\x1b[32m';
const CYAN   = '\x1b[36m';
const RESET  = '\x1b[0m';
const BOLD   = '\x1b[1m';
const DIM    = '\x1b[2m';

function log(msg: string) {
  const ts = new Date().toISOString().slice(11, 23);
  console.log(`${DIM}${ts}${RESET} ${YELLOW}${BOLD}🛡️  [AAuth]${RESET} ${msg}`);
}

// ── Key persistence paths ──────────────────────────────────────────
// Keys are stored as JWK JSON files under a `keys/` directory relative
// to the project root. In production you'd use the OS keychain via
// @aauth/local-keys' writeKeychain/readKeychain — for the demo we
// persist to disk so keys survive restarts without requiring system
// keyring access.

const PROJECT_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const KEYS_DIR     = join(PROJECT_ROOT, 'keys');
const PRIVATE_KEY_PATH = join(KEYS_DIR, 'agent-private.jwk.json');
const PUBLIC_KEY_PATH  = join(KEYS_DIR, 'agent-public.jwk.json');
const AGENT_META_PATH  = join(KEYS_DIR, 'agent-meta.json');

// ============================================================================
// AAuthRealService
// ============================================================================

/**
 * Real AAuth integration for the Court Ready agent.
 *
 * Manages the agent's Ed25519 identity keypair and provides:
 * - `createFetch()` — a drop-in `fetch` replacement that handles the full
 *   AAuth challenge-response flow automatically
 * - `signToken()` — lower-level token creation for custom scenarios
 * - `getPublicKeyJwk()` — the agent's public key for publishing to a JWKS
 */
export class AAuthRealService {
  // The agent's long-lived root keypair (Ed25519)
  private privateJwk: JWK;
  private publicJwk: JWK;

  // Agent identifier (AAuth URI format: aauth:<local>@<domain>)
  private agentId: string;

  // The agent's well-known URL (used as `iss` in agent tokens)
  private agentUrl: string;

  // The kid assigned to this key
  private kid: string;

  // ── Private constructor — use static initialize() ──────────────

  private constructor(
    privateJwk: JWK,
    publicJwk: JWK,
    agentId: string,
    agentUrl: string,
    kid: string,
  ) {
    this.privateJwk = privateJwk;
    this.publicJwk  = publicJwk;
    this.agentId    = agentId;
    this.agentUrl   = agentUrl;
    this.kid        = kid;
  }

  // ============================================================================
  // Initialization — generate or load an Ed25519 keypair
  // ============================================================================

  /**
   * Initialize the AAuth service.
   *
   * On first call: generates a new Ed25519 keypair using @aauth/local-keys'
   * `generateKey` and persists it to `keys/` on disk.
   *
   * On subsequent calls: loads the existing keypair from disk.
   *
   * @param options.agentUrl - The agent's published URL (defaults to demo config).
   *   This URL would host `/.well-known/aauth-agent.json` in production.
   */
  static async initialize(options?: {
    agentUrl?: string;
  }): Promise<AAuthRealService> {
    const agentUrl = options?.agentUrl ?? 'https://court-ready-agent.demo';

    log(`Initializing AAuth agent identity…`);
    log(`  Agent URL: ${CYAN}${agentUrl}${RESET}`);

    // Try loading existing keys from disk
    if (existsSync(PRIVATE_KEY_PATH) && existsSync(PUBLIC_KEY_PATH) && existsSync(AGENT_META_PATH)) {
      try {
        const privateJwk = JSON.parse(readFileSync(PRIVATE_KEY_PATH, 'utf-8')) as JWK;
        const publicJwk  = JSON.parse(readFileSync(PUBLIC_KEY_PATH, 'utf-8')) as JWK;
        const meta       = JSON.parse(readFileSync(AGENT_META_PATH, 'utf-8'));

        const kid     = privateJwk.kid ?? meta.kid ?? 'unknown';
        const agentId = meta.agentId ?? `aauth:court-ready@${new URL(agentUrl).hostname}`;

        log(`  ${GREEN}✓ Loaded existing Ed25519 keypair${RESET}`);
        log(`    kid     : ${DIM}${kid}${RESET}`);
        log(`    agentId : ${DIM}${agentId}${RESET}`);
        log(`    alg     : ${privateJwk.alg ?? 'EdDSA'}`);

        return new AAuthRealService(privateJwk, publicJwk, agentId, agentUrl, kid);
      } catch (err: any) {
        log(`  ⚠ Failed to load existing keys: ${err.message}`);
        log(`  Generating fresh keypair…`);
      }
    }

    // ── Generate a new Ed25519 keypair ──────────────────────────
    // @aauth/local-keys' generateKey creates a keypair with jose,
    // assigns a date-based kid, and sets alg/use on both JWKs.
    log(`  Generating new Ed25519 keypair via @aauth/local-keys…`);

    const keyPair: GeneratedKeyPair = await generateKey('EdDSA');

    const kid = keyPair.privateJwk.kid ?? generateKid();
    const domain = new URL(agentUrl).hostname;
    const agentId = `aauth:court-ready@${domain}`;

    // Ensure kid is set on both
    keyPair.privateJwk.kid = kid;
    keyPair.publicJwk.kid  = kid;

    // ── Persist to disk ─────────────────────────────────────────
    mkdirSync(KEYS_DIR, { recursive: true });

    writeFileSync(PRIVATE_KEY_PATH, JSON.stringify(keyPair.privateJwk, null, 2));
    writeFileSync(PUBLIC_KEY_PATH, JSON.stringify(keyPair.publicJwk, null, 2));
    writeFileSync(AGENT_META_PATH, JSON.stringify({
      kid,
      agentId,
      agentUrl,
      algorithm: 'EdDSA',
      createdAt: new Date().toISOString(),
    }, null, 2));

    log(`  ${GREEN}✓ Generated & saved Ed25519 keypair${RESET}`);
    log(`    kid     : ${DIM}${kid}${RESET}`);
    log(`    agentId : ${DIM}${agentId}${RESET}`);
    log(`    curve   : Ed25519`);
    log(`    stored  : ${DIM}${KEYS_DIR}${RESET}`);

    return new AAuthRealService(
      keyPair.privateJwk,
      keyPair.publicJwk,
      agentId,
      agentUrl,
      kid,
    );
  }

  // ============================================================================
  // Public Key — for publishing to /.well-known/aauth-agent.json JWKS
  // ============================================================================

  /**
   * Get the agent's public key as JWK.
   *
   * In production, this would be published at:
   *   {agentUrl}/.well-known/aauth-agent.json → { jwks_uri: "..." }
   *   jwks_uri → { keys: [ this JWK ] }
   *
   * Resource servers and auth servers fetch this to verify agent tokens.
   */
  async getPublicKeyJwk(): Promise<object> {
    // Use @aauth/local-keys' toPublicJwk to strip private material
    // and ensure alg is derived from the curve.
    // Cast needed: @aauth/local-keys may use a different jose version
    // where JWK.kty is required vs optional in the top-level jose.
    return toPublicJwk(this.publicJwk as Parameters<typeof toPublicJwk>[0]);
  }

  // ============================================================================
  // Signed Fetch — full AAuth challenge-response
  // ============================================================================

  /**
   * Create a protocol-aware fetch wrapper that handles AAuth automatically.
   *
   * The returned function is a drop-in replacement for `fetch`. It:
   *
   * 1. **Signs every request** with an HTTP Message Signature using an
   *    ephemeral DPoP key, bound to the agent's identity via an agent token
   *    (aa-agent+jwt).
   *
   * 2. **Handles 401 challenges**: When a resource returns 401 with an
   *    `AAuth-Requirement: auth-token` header, the fetch wrapper automatically:
   *    - Extracts the resource token from the response
   *    - Exchanges it at the auth server (Keycard) for an auth token
   *    - Retries the original request with the auth token attached
   *
   * 3. **Handles 202 interactions**: For user-consent flows, polls the
   *    interaction URL until the user approves or the request times out.
   *
   * 4. **Caches auth tokens**: Subsequent requests to the same resource
   *    reuse cached auth tokens until they expire.
   *
   * Under the hood, this uses `createAAuthFetch` from @aauth/mcp-agent,
   * which wraps `createSignedFetch` (HTTP Message Signatures via
   * @hellocoop/httpsig) with the AAuth protocol state machine.
   */
  createFetch(options?: {
    authServerUrl?: string;
    onInteraction?: (url: string, code: string) => void;
    onEvent?: (event: Record<string, unknown>) => void;
  }): FetchLike {
    log(`Creating AAuth-signed fetch wrapper…`);

    // ── getKeyMaterial callback ────────────────────────────────
    // createAAuthFetch calls this on every request. It returns:
    //   - signingKey: ephemeral private JWK (for HTTP Message Signatures)
    //   - signatureKey: { type: 'jwt', jwt: '<aa-agent+jwt>' }
    //
    // The agent token (aa-agent+jwt) is signed with the root key and
    // contains an ephemeral public key in `cnf.jwk`. The HTTP signature
    // uses the ephemeral private key. This proves the request comes from
    // the holder of the root key without exposing it per-request.
    const getKeyMaterial: GetKeyMaterial = async () => {
      return this.createKeyMaterial();
    };

    // ── Auth server URL ────────────────────────────────────────
    // The auth server (Person Server / Access Server) that the agent
    // contacts when it receives a 401 challenge with a resource token.
    const authServerUrl = options?.authServerUrl ?? DEMO_CONFIG.personServer.url;

    // ── Build AAuth fetch options ──────────────────────────────
    const fetchOptions: AAuthFetchOptions = {
      getKeyMaterial,
      authServerUrl,

      // Called when the auth server requires user interaction
      // (e.g., consent prompt in a browser)
      onInteraction: options?.onInteraction ?? ((url: string, code: string) => {
        log(`🔔 User interaction required!`);
        log(`   Visit: ${CYAN}${url}${RESET}`);
        log(`   Code:  ${BOLD}${code}${RESET}`);
      }),

      // Called for each protocol step — useful for demo logging
      onEvent: (event) => {
        const step = event.step as string;
        const phase = event.phase as string;

        if (phase === 'start') {
          log(`  → ${step}…`);
        } else if (phase === 'done') {
          const status = event.status ? ` (${event.status})` : '';
          log(`  ${GREEN}✓${RESET} ${step}${status}`);
        } else if (phase === 'info') {
          log(`  ℹ ${step}: ${JSON.stringify(event).slice(0, 120)}`);
        }

        // Forward to caller's handler if provided
        options?.onEvent?.(event as Record<string, unknown>);
      },

      // Called when a fresh auth token is minted during challenge exchange
      onAuthToken: (authToken: string, expiresIn: number) => {
        log(`  ${GREEN}✓ Auth token received${RESET} (expires in ${expiresIn}s)`);
        const decoded = decodeJwtPayload(authToken);
        if (decoded) {
          log(`    iss   : ${DIM}${decoded.iss}${RESET}`);
          log(`    agent : ${DIM}${decoded.agent ?? decoded.sub}${RESET}`);
          if (decoded.scope) log(`    scope : ${DIM}${decoded.scope}${RESET}`);
        }
      },
    };

    // ── Create the protocol-aware fetch ────────────────────────
    // createAAuthFetch from @aauth/mcp-agent wraps createSignedFetch
    // with the full AAuth state machine: challenge detection, token
    // exchange, interaction polling, and auth token caching.
    const aauthFetch = createAAuthFetch(fetchOptions);

    log(`  ${GREEN}✓ AAuth fetch wrapper ready${RESET}`);
    log(`    Auth server: ${DIM}${authServerUrl}${RESET}`);
    log(`    Agent ID:    ${DIM}${this.agentId}${RESET}`);

    return aauthFetch;
  }

  // ============================================================================
  // Sign Token — create a signed JWT for presenting to resources
  // ============================================================================

  /**
   * Sign an arbitrary JWT payload as this agent.
   *
   * Creates an aa-agent+jwt signed with the agent's root Ed25519 key,
   * containing:
   *   - iss: agent URL
   *   - sub: agent ID
   *   - dwk: "aauth-agent.json" (discovery-well-known pointer)
   *   - cnf.jwk: ephemeral public key (key binding)
   *   - Custom payload claims
   *
   * This is a lower-level API — most callers should use `createFetch()`
   * which handles token creation automatically as part of the AAuth flow.
   */
  async signToken(payload: Record<string, unknown>): Promise<string> {
    log(`Signing agent token…`);

    const alg = this.privateJwk.alg ?? 'EdDSA';

    // Import the root private key for signing
    const rootKey = await importJWK(this.privateJwk, alg);

    // Generate an ephemeral keypair for key binding (cnf claim)
    // The ephemeral key matches the root key's algorithm
    const ephOpts = alg === 'ES256' ? { crv: 'P-256' as const } : { crv: 'Ed25519' as const };
    const { publicKey: ephPub } = await generateKeyPair(
      alg as 'EdDSA' | 'ES256',
      ephOpts,
    );
    const ephPubJwk = await exportJWK(ephPub);

    const now = Math.floor(Date.now() / 1000);

    // Build the agent token
    const jwt = await new SignJWT({
      iss: this.agentUrl,
      dwk: 'aauth-agent.json', // Discovery well-known path
      sub: this.agentId,
      jti: randomUUID(),
      cnf: { jwk: ephPubJwk }, // Key binding — ties HTTP sig to this token
      ...payload,
    })
      .setProtectedHeader({
        alg,
        typ: 'aa-agent+jwt',
        kid: this.kid,
      })
      .setIssuedAt(now)
      .setExpirationTime(now + 3600) // 1 hour
      .sign(rootKey);

    log(`  ${GREEN}✓ Token signed${RESET}`);
    log(`    alg : ${alg}`);
    log(`    kid : ${DIM}${this.kid}${RESET}`);
    log(`    sub : ${DIM}${this.agentId}${RESET}`);
    log(`    exp : ${new Date((now + 3600) * 1000).toISOString()}`);

    return jwt;
  }

  // ============================================================================
  // Agent Identity
  // ============================================================================

  /**
   * Get the agent's AAuth identifier.
   *
   * Format: `aauth:<local>@<domain>`
   * Example: `aauth:court-ready@court-ready-agent.demo`
   *
   * This is the `sub` claim in agent tokens and identifies the agent
   * across the AAuth ecosystem.
   */
  getAgentId(): string {
    return this.agentId;
  }

  // ============================================================================
  // Internal — Key Material for HTTP Message Signatures
  // ============================================================================

  /**
   * Create key material for a single signed request.
   *
   * AAuth uses a two-layer key architecture:
   *
   *   Root Key (Ed25519, long-lived)
   *     └─ signs → Agent Token (aa-agent+jwt)
   *                  └─ contains → cnf.jwk (ephemeral public key)
   *
   *   Ephemeral Key (Ed25519, per-request or short-lived)
   *     └─ signs → HTTP Message Signature
   *
   * The agent token binds the ephemeral key to the root identity.
   * The HTTP signature proves possession of the ephemeral key.
   * Together they prove: "this request was made by the agent that
   * controls the root key at {agentUrl}".
   *
   * Returns:
   *   - signingKey: ephemeral private JWK (for HTTP signatures)
   *   - signatureKey: { type: 'jwt', jwt: '<agent-token>' }
   */
  private async createKeyMaterial(): Promise<{
    signingKey: JsonWebKey;
    signatureKey: { type: 'jwt'; jwt: string };
  }> {
    const alg = this.privateJwk.alg ?? 'EdDSA';

    // Generate an ephemeral keypair for this batch of requests
    const ephOpts = alg === 'ES256' ? { crv: 'P-256' as const } : { crv: 'Ed25519' as const };
    const { publicKey: ephPub, privateKey: ephPriv } = await generateKeyPair(
      alg as 'EdDSA' | 'ES256',
      ephOpts,
    );

    const ephPrivJwk = await exportJWK(ephPriv);
    const ephPubJwk  = await exportJWK(ephPub);

    // Import the root key for signing the agent token
    const rootKey = await importJWK(this.privateJwk, alg);

    const now = Math.floor(Date.now() / 1000);

    // Build the agent token (aa-agent+jwt)
    // This token says: "I am {agentId}, controlled by the key at {agentUrl},
    // and I'm delegating signing authority to the ephemeral key in cnf.jwk"
    const agentToken = await new SignJWT({
      iss: this.agentUrl,               // Agent's published URL
      dwk: 'aauth-agent.json',          // Where to find the agent's JWKS
      sub: this.agentId,                 // Agent identifier
      jti: randomUUID(),                 // Unique token ID
      cnf: { jwk: ephPubJwk },           // Key binding: ephemeral public key
      ps: DEMO_CONFIG.personServer.url,  // Person server URL
    })
      .setProtectedHeader({
        alg,
        typ: 'aa-agent+jwt',
        kid: this.kid,
      })
      .setIssuedAt(now)
      .setExpirationTime(now + 300) // 5 min — short-lived for security
      .sign(rootKey);

    return {
      signingKey: ephPrivJwk,
      signatureKey: { type: 'jwt', jwt: agentToken },
    };
  }
}
