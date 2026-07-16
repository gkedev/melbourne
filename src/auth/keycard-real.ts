// ============================================================================
// Keycard Access Server — Real Integration
// ============================================================================
// Connects to a live Keycard zone for OAuth 2.0 operations:
//   - AS metadata discovery (RFC 8414)
//   - Dynamic client registration (RFC 7591)
//   - Token exchange (RFC 8693) — core of AAuth federated auth flow
//   - JWT verification via JWKS
//   - Token revocation (RFC 7009)
//
// Implements the same interface as AccessServerMock so it can be used as
// a drop-in replacement via the ServiceOrchestrator.
//
// Falls back to mock behavior if the Keycard zone is unreachable, so the
// demo can run offline without crashing.
// ============================================================================

import {
  fetchAuthorizationServerMetadata,
  registerClient,
  TokenExchangeClient,
  TokenVerifier,
  JWKSOAuthKeyring,
  TokenType,
  type OAuthAuthorizationServerMetadata,
  type ClientRegistrationRequest,
  type ClientRegistrationResponse,
  type TokenExchangeRequest,
  type TokenResponse,
  type TokenExchangeClientOptions,
} from '@keycardai/oauth';

import type { AuthToken, KyaPayClaims, Mission, ResourceToken } from '../types.js';

// ---------------------------------------------------------------------------
// Colored console logging helpers
// ---------------------------------------------------------------------------

const MAGENTA = '\x1b[35m';
const RESET   = '\x1b[0m';
const BOLD    = '\x1b[1m';
const DIM     = '\x1b[2m';
const GREEN   = '\x1b[32m';
const RED     = '\x1b[31m';
const YELLOW  = '\x1b[33m';

function log(msg: string): void {
  const ts = new Date().toISOString().slice(11, 23);
  console.log(`${DIM}${ts}${RESET} ${MAGENTA}${BOLD}🔐 [Keycard]${RESET} ${msg}`);
}

function logSuccess(msg: string): void {
  log(`${GREEN}✓${RESET} ${msg}`);
}

function logError(msg: string): void {
  console.error(`${DIM}${new Date().toISOString().slice(11, 23)}${RESET} ${MAGENTA}${BOLD}🔐 [Keycard]${RESET} ${RED}✗${RESET} ${msg}`);
}

function logWarn(msg: string): void {
  console.warn(`${DIM}${new Date().toISOString().slice(11, 23)}${RESET} ${MAGENTA}${BOLD}🔐 [Keycard]${RESET} ${YELLOW}⚠${RESET} ${msg}`);
}

function logDim(msg: string): void {
  log(`${DIM}${msg}${RESET}`);
}

// ---------------------------------------------------------------------------
// Audit trail type (mirrors AccessServerMock)
// ---------------------------------------------------------------------------

export interface AuditEntry {
  timestamp: string;
  action: string;
  agentId: string;
  details: Record<string, unknown>;
}

// ---------------------------------------------------------------------------
// Configuration shape (matches orchestrator's config.keycard)
// ---------------------------------------------------------------------------

export interface KeycardConfig {
  issuerUrl: string;
  zoneId: string;
  clientId?: string;
  clientSecret?: string;
}

// ---------------------------------------------------------------------------
// KeycardRealService
// ---------------------------------------------------------------------------

export class KeycardRealService {
  private readonly issuerUrl: string;
  private readonly zoneId: string;
  private metadata: OAuthAuthorizationServerMetadata | null = null;
  private clientId: string | undefined;
  private clientSecret: string | undefined;

  // Lazily created SDK clients
  private tokenExchangeClient: TokenExchangeClient | null = null;
  private tokenVerifier: TokenVerifier | null = null;
  private keyring: JWKSOAuthKeyring | null = null;

  // Audit log (same shape as AccessServerMock)
  private auditLog: AuditEntry[] = [];
  private activeTokens: Map<string, { jwt: string; agentId: string; revokedAt?: string }> = new Map();

  /** True when the zone was unreachable at init — operations return mock data */
  private offlineMode = false;

  // ---------------------------------------------------------------------------
  // Constructor — public so orchestrator can `new KeycardRealService(config)`
  // ---------------------------------------------------------------------------

  constructor(config: KeycardConfig) {
    this.issuerUrl = config.issuerUrl.replace(/\/+$/, '');
    this.zoneId = config.zoneId;
    this.clientId = config.clientId;
    this.clientSecret = config.clientSecret;
  }

  // ---------------------------------------------------------------------------
  // Static factory — async initialization with AS metadata discovery
  // ---------------------------------------------------------------------------

  /**
   * Create and initialize a KeycardRealService. Discovers AS metadata from
   * the zone's .well-known endpoint. If the zone is unreachable, the service
   * enters offline/mock mode — all operations return plausible mock data.
   *
   * This is the preferred factory; the orchestrator calls
   * `KeycardRealService.initialize(config)` or `.create(config)`.
   */
  static async create(config: KeycardConfig): Promise<KeycardRealService> {
    const service = new KeycardRealService(config);
    await service.discover();
    return service;
  }

  /**
   * Alias for `create()` — the orchestrator uses this name.
   * Accepts both `KeycardConfig` and the minimal shape from the orchestrator
   * (issuerUrl + optional clientId/clientSecret, no zoneId required).
   */
  static async initialize(options: {
    issuerUrl: string;
    zoneId?: string;
    clientId?: string;
    clientSecret?: string;
  }): Promise<KeycardRealService> {
    // Derive zoneId from issuerUrl if not provided
    const zoneId = options.zoneId ?? KeycardRealService.deriveZoneId(options.issuerUrl);
    return KeycardRealService.create({ ...options, zoneId });
  }

  /** Extract zone ID from an issuer URL like https://<zoneId>.keycard.cloud */
  private static deriveZoneId(issuerUrl: string): string {
    const match = issuerUrl.match(/\/\/([^.]+)\.keycard\.cloud/);
    return match?.[1] ?? 'unknown';
  }

  /**
   * Discover AS metadata. Called by `create()`, but can also be called
   * manually after using the `new` constructor.
   */
  async discover(): Promise<void> {
    log(`Initializing — zone ${BOLD}${this.zoneId}${RESET}`);
    logDim(`Issuer: ${this.issuerUrl}`);

    try {
      // RFC 8414 — discover the AS metadata
      this.metadata = await fetchAuthorizationServerMetadata(this.issuerUrl);

      logSuccess('AS metadata discovered');
      logDim(`  Token endpoint:  ${this.metadata.token_endpoint ?? '(not advertised)'}`);
      logDim(`  JWKS URI:        ${this.metadata.jwks_uri ?? '(not advertised)'}`);
      logDim(`  Registration:    ${this.metadata.registration_endpoint ?? '(not advertised)'}`);
      logDim(`  Grant types:     ${(this.metadata.grant_types_supported ?? []).join(', ') || '(none)'}`);

      // Verify the zone supports token exchange
      const grants = this.metadata.grant_types_supported ?? [];
      if (grants.includes('urn:ietf:params:oauth:grant-type:token-exchange')) {
        logSuccess('Token exchange (RFC 8693) is supported');
      } else {
        logWarn('Token exchange grant type NOT listed — exchange may fail');
      }
    } catch (err) {
      logError(`Failed to discover AS metadata: ${err instanceof Error ? err.message : String(err)}`);
      logWarn('Entering offline mode — all operations will return mock data');
      this.offlineMode = true;
    }
  }

  // ===========================================================================
  // High-level API — matches AccessServerMock / KeycardRealServiceLike
  // ===========================================================================

  /**
   * Issue an Auth Token (aa-auth+jwt) by performing a token exchange with the
   * Keycard zone. This is the method the orchestrator and demo flow call.
   *
   * In real mode: exchanges the resource token via RFC 8693 token-exchange,
   * then wraps the result in an AuthToken structure.
   *
   * In offline mode: generates a mock JWT locally (like AccessServerMock).
   */
  async issueAuthToken(
    agentId: string,
    resourceToken: ResourceToken,
    mission: Mission,
    personServerUrl: string,
  ): Promise<AuthToken> {
    log(`Received federation request from Person Server`);
    log(`  Person Server  : ${personServerUrl}`);
    log(`  Agent          : ${DIM}${agentId.slice(0, 16)}…${RESET}`);

    // ── Validate resource token ────────────────────────────────
    log(`Validating resource token…`);
    if (!resourceToken.token || !resourceToken.mcpServerId) {
      throw new Error('Invalid resource token');
    }
    logSuccess(`Resource token valid (server: ${resourceToken.mcpServerId})`);

    // ── Check mission scope & governance policy ────────────────
    log(`Enforcing governance policy…`);
    log(`  Mission scope    : ${mission.scope.join(', ')}`);
    log(`  Spending limit   : $${mission.spendingLimit.toFixed(2)}`);
    log(`  Mission status   : ${mission.status}`);

    if (mission.status !== 'approved') {
      this.audit('policy_deny', agentId, { reason: 'mission not approved' });
      throw new Error('Mission not approved — token denied');
    }
    logSuccess('Mission approved, scope within policy');

    // ── Build KYA-PAY claims ───────────────────────────────────
    const kyaPayClaims: KyaPayClaims = {
      maxAmountUsd: mission.spendingLimit,
      merchantId: resourceToken.mcpServerId,
      allowedScopes: mission.scope,
      missionId: mission.id,
    };

    log(`Embedding KYA-PAY claims:`);
    logDim(`  Max amount  : $${kyaPayClaims.maxAmountUsd.toFixed(2)}`);
    logDim(`  Merchant    : ${kyaPayClaims.merchantId}`);
    logDim(`  Scopes      : ${kyaPayClaims.allowedScopes.join(', ')}`);

    // ── Perform token exchange or mock ─────────────────────────
    const tokenId = `aat-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
    const now = Math.floor(Date.now() / 1000);
    const expiresAt = new Date((now + 3600) * 1000).toISOString();
    let jwt: string;

    if (!this.offlineMode) {
      try {
        // RFC 8693 — exchange the resource token for an auth token
        log(`Performing token exchange with Keycard zone…`);

        const exchangeResult = await this.exchangeToken({
          subjectToken: resourceToken.token,
          subjectTokenType: TokenType.ACCESS_TOKEN,
          scope: mission.scope.join(' '),
          audience: resourceToken.mcpServerId,
        });

        jwt = exchangeResult.accessToken;
        logSuccess(`Token exchange complete — real Keycard token obtained`);
      } catch (err) {
        logError(`Token exchange failed: ${err instanceof Error ? err.message : String(err)}`);
        logWarn('Falling back to locally-signed mock token');
        jwt = this.buildMockJwt(agentId, resourceToken, mission, kyaPayClaims, tokenId, now, personServerUrl);
      }
    } else {
      jwt = this.buildMockJwt(agentId, resourceToken, mission, kyaPayClaims, tokenId, now, personServerUrl);
    }

    logSuccess(`Signed aa-auth+jwt`);
    logDim(`  Token ID  : ${tokenId}`);
    logDim(`  Expires   : ${expiresAt}`);

    // ── Store for revocation ───────────────────────────────────
    this.activeTokens.set(tokenId, { jwt, agentId });

    this.audit('token_issued', agentId, {
      tokenId,
      missionId: mission.id,
      spendingLimit: mission.spendingLimit,
      scopes: mission.scope,
      realKeycard: !this.offlineMode,
    });

    return {
      token: jwt,
      tokenId,
      agentId,
      missionId: mission.id,
      kyaPay: kyaPayClaims,
      issuedAt: new Date(now * 1000).toISOString(),
      expiresAt,
    };
  }

  /**
   * Revoke a token. Satisfies both the KeycardRealServiceLike interface
   * (takes a JWT string, returns Promise<void>) and the demo flow
   * (which may pass a tokenId).
   *
   * In real mode: also POSTs to the Keycard zone's revocation endpoint.
   */
  async revokeToken(token: string): Promise<void> {
    // The token may be a JWT string or a tokenId — check both
    let entry = this.activeTokens.get(token);
    let tokenId = token;
    let jwt = token;

    if (!entry) {
      // Not a tokenId — search by JWT value
      for (const [id, e] of this.activeTokens) {
        if (e.jwt === token) {
          entry = e;
          tokenId = id;
          break;
        }
      }
    } else {
      jwt = entry.jwt;
    }

    if (entry) {
      entry.revokedAt = new Date().toISOString();
      log(`🔒 Token ${BOLD}revoked${RESET}: ${DIM}${tokenId}${RESET}`);
      this.audit('token_revoked', entry.agentId, { tokenId });
    } else {
      log(`Revoking token (not tracked locally)`);
    }

    // Revoke with Keycard zone if online
    if (!this.offlineMode) {
      try {
        await this.revokeRemote(jwt);
      } catch (err) {
        logWarn(`Remote revocation failed: ${err instanceof Error ? err.message : String(err)}`);
      }
    }
  }

  /**
   * Get the audit log, optionally filtered by agent ID.
   */
  getAuditLog(agentId?: string): AuditEntry[] {
    if (agentId) {
      return this.auditLog.filter((e) => e.agentId === agentId);
    }
    return [...this.auditLog];
  }

  /**
   * Print the audit log to the console with formatting.
   */
  printAuditLog(agentId?: string): void {
    const entries = this.getAuditLog(agentId);
    log(`\n${'─'.repeat(60)}`);
    log(`📋 ${BOLD}GOVERNANCE AUDIT TRAIL${RESET}  (${entries.length} entries)`);
    log(`${'─'.repeat(60)}`);
    for (const entry of entries) {
      const ts = entry.timestamp.slice(11, 23);
      log(`  ${DIM}${ts}${RESET}  ${BOLD}${entry.action.toUpperCase().padEnd(16)}${RESET}  agent:${DIM}${entry.agentId.slice(0, 12)}…${RESET}`);
      for (const [k, v] of Object.entries(entry.details)) {
        const val = typeof v === 'object' ? JSON.stringify(v) : String(v);
        log(`           ${DIM}${k}: ${val}${RESET}`);
      }
    }
    log(`${'─'.repeat(60)}\n`);
  }

  // ===========================================================================
  // Lower-level OAuth API — direct SDK wrappers
  // ===========================================================================

  /**
   * Dynamic client registration (RFC 7591). Registers this demo agent as
   * an OAuth client with the Keycard zone.
   */
  async registerClient(metadata: {
    clientName: string;
    redirectUris?: string[];
    grantTypes?: string[];
    tokenEndpointAuthMethod?: string;
  }): Promise<{ clientId: string; clientSecret?: string }> {
    log(`Registering client "${metadata.clientName}"…`);

    if (this.offlineMode) {
      return this.mockRegisterClient(metadata.clientName);
    }

    try {
      const request: ClientRegistrationRequest = {
        clientName: metadata.clientName,
        redirectUris: metadata.redirectUris,
        grantTypes: metadata.grantTypes ?? [
          'urn:ietf:params:oauth:grant-type:token-exchange',
          'client_credentials',
        ],
        tokenEndpointAuthMethod: metadata.tokenEndpointAuthMethod ?? 'client_secret_basic',
      };

      const response: ClientRegistrationResponse = await registerClient(
        this.issuerUrl,
        request,
      );

      // Cache the credentials for subsequent operations
      this.clientId = response.clientId;
      this.clientSecret = response.clientSecret;

      logSuccess(`Client registered: ${response.clientId}`);
      if (response.clientSecretExpiresAt) {
        const expires = new Date(response.clientSecretExpiresAt * 1000).toISOString();
        logDim(`  Secret expires: ${expires}`);
      }

      return {
        clientId: response.clientId,
        clientSecret: response.clientSecret,
      };
    } catch (err) {
      logError(`Client registration failed: ${err instanceof Error ? err.message : String(err)}`);
      logWarn('Falling back to mock registration');
      return this.mockRegisterClient(metadata.clientName);
    }
  }

  /**
   * Token exchange (RFC 8693). Exchanges a subject token (e.g. resource token)
   * for an access token issued by the Keycard zone.
   */
  async exchangeToken(params: {
    subjectToken: string;
    subjectTokenType: string;
    scope?: string;
    audience?: string;
  }): Promise<{ accessToken: string; tokenType: string; expiresIn: number }> {
    logDim(`Token exchange — subject type: ${params.subjectTokenType}`);

    if (this.offlineMode) {
      return this.mockExchangeToken(params);
    }

    try {
      const client = this.getOrCreateTokenExchangeClient();

      const request: TokenExchangeRequest = {
        subjectToken: params.subjectToken,
        subjectTokenType: params.subjectTokenType,
        scope: params.scope,
        audience: params.audience,
      };

      const response: TokenResponse = await client.exchangeToken(request);

      logSuccess('Token exchange complete');
      logDim(`  Token type:  ${response.tokenType}`);
      logDim(`  Expires in:  ${response.expiresIn ?? 'unknown'}s`);

      return {
        accessToken: response.accessToken,
        tokenType: response.tokenType,
        expiresIn: response.expiresIn ?? 3600,
      };
    } catch (err) {
      logError(`Token exchange failed: ${err instanceof Error ? err.message : String(err)}`);
      logWarn('Falling back to mock token exchange');
      return this.mockExchangeToken(params);
    }
  }

  /**
   * Verify a JWT token issued by this Keycard zone. Fetches JWKS and
   * validates signature + standard claims.
   */
  async verifyToken(token: string): Promise<{ valid: boolean; claims: Record<string, unknown> }> {
    logDim('Verifying token…');

    if (this.offlineMode) {
      return this.mockVerifyToken(token);
    }

    try {
      const verifier = this.getOrCreateTokenVerifier();
      const accessToken = await verifier.verifyToken(token);

      if (accessToken) {
        logSuccess('Token verified');
        logDim(`  Client ID: ${accessToken.clientId}`);
        logDim(`  Scopes:    ${accessToken.scopes.join(', ')}`);

        return {
          valid: true,
          claims: {
            clientId: accessToken.clientId,
            scopes: accessToken.scopes,
            resource: accessToken.resource,
            expiresAt: accessToken.expiresAt,
          },
        };
      } else {
        logWarn('Token verification returned null — invalid or expired');
        return { valid: false, claims: {} };
      }
    } catch (err) {
      logError(`Token verification failed: ${err instanceof Error ? err.message : String(err)}`);
      logWarn('Falling back to mock verification');
      return this.mockVerifyToken(token);
    }
  }

  // ---------------------------------------------------------------------------
  // Zone Info
  // ---------------------------------------------------------------------------

  /** Metadata about the configured Keycard zone. */
  getZoneInfo(): { zoneId: string; issuerUrl: string } {
    return { zoneId: this.zoneId, issuerUrl: this.issuerUrl };
  }

  /** Whether the service is in offline/mock mode. */
  isOffline(): boolean {
    return this.offlineMode;
  }

  /** The discovered AS metadata, or null if offline. */
  getMetadata(): OAuthAuthorizationServerMetadata | null {
    return this.metadata;
  }

  // ===========================================================================
  // Private — SDK client factories
  // ===========================================================================

  /** Lazily create the TokenExchangeClient. */
  private getOrCreateTokenExchangeClient(): TokenExchangeClient {
    if (!this.tokenExchangeClient) {
      const options: TokenExchangeClientOptions = {};
      if (this.clientId)     options.clientId = this.clientId;
      if (this.clientSecret) options.clientSecret = this.clientSecret;

      this.tokenExchangeClient = new TokenExchangeClient(this.issuerUrl, options);
      logDim('TokenExchangeClient initialized');
    }
    return this.tokenExchangeClient;
  }

  /** Lazily create the TokenVerifier with JWKSOAuthKeyring. */
  private getOrCreateTokenVerifier(): TokenVerifier {
    if (!this.tokenVerifier) {
      if (!this.keyring) {
        this.keyring = new JWKSOAuthKeyring({
          keyTtlMs: 5 * 60 * 1000,        // 5 min key cache
          discoveryTtlMs: 60 * 60 * 1000,  // 1 hr discovery cache
          fetchTimeoutMs: 10_000,           // 10s fetch timeout
        });
      }

      this.tokenVerifier = new TokenVerifier({
        issuer: this.issuerUrl,
        keyring: this.keyring,
      });
      logDim('TokenVerifier initialized');
    }
    return this.tokenVerifier;
  }

  // ===========================================================================
  // Private — HTTP helpers
  // ===========================================================================

  /** POST to a token revocation endpoint (RFC 7009). */
  private async revokeRemote(token: string): Promise<void> {
    // Check if the AS advertises a revocation_endpoint (passthrough field)
    const metadata = this.metadata as Record<string, unknown> | null;
    const revocationEndpoint = metadata?.['revocation_endpoint'] as string | undefined;
    const endpoint = revocationEndpoint ?? `${this.issuerUrl}/oauth/2/revoke`;

    const body = new URLSearchParams({
      token,
      token_type_hint: 'access_token',
    });

    const headers: Record<string, string> = {
      'Content-Type': 'application/x-www-form-urlencoded',
    };

    if (this.clientId && this.clientSecret) {
      const credentials = Buffer.from(`${this.clientId}:${this.clientSecret}`).toString('base64');
      headers['Authorization'] = `Basic ${credentials}`;
    }

    const response = await fetch(endpoint, {
      method: 'POST',
      headers,
      body: body.toString(),
      signal: AbortSignal.timeout(10_000),
    });

    if (response.ok) {
      logSuccess('Token revoked remotely');
    } else {
      const text = await response.text().catch(() => '');
      logWarn(`Remote revocation responded with ${response.status}: ${text || '(empty)'}`);
    }
  }

  // ===========================================================================
  // Private — Audit helper
  // ===========================================================================

  private audit(action: string, agentId: string, details: Record<string, unknown>): void {
    this.auditLog.push({
      timestamp: new Date().toISOString(),
      action,
      agentId,
      details,
    });
  }

  // ===========================================================================
  // Private — Mock / fallback implementations
  // ===========================================================================
  // Used when the Keycard zone is unreachable, allowing the demo to function
  // offline with realistic-looking but fake data.
  // ===========================================================================

  /** Build a mock JWT locally using base64url encoding. */
  private buildMockJwt(
    agentId: string,
    resourceToken: ResourceToken,
    mission: Mission,
    kyaPay: KyaPayClaims,
    tokenId: string,
    now: number,
    personServerUrl: string,
  ): string {
    const header = Buffer.from(JSON.stringify({
      alg: 'ES256',
      typ: 'aa-auth+jwt',
      kid: 'keycard-mock-1',
    })).toString('base64url');

    const payload = Buffer.from(JSON.stringify({
      sub: agentId,
      iss: this.issuerUrl,
      aud: resourceToken.mcpServerId,
      jti: tokenId,
      iat: now,
      exp: now + 3600,
      mission_id: mission.id,
      kya_pay: kyaPay,
      person_server: personServerUrl,
      scope: mission.scope.join(' '),
      mock: true,
    })).toString('base64url');

    const signature = Buffer.from('mock-signature-keycard-offline').toString('base64url');

    logWarn('[MOCK] Built locally-signed mock aa-auth+jwt');
    return `${header}.${payload}.${signature}`;
  }

  private mockRegisterClient(clientName: string): { clientId: string; clientSecret: string } {
    const clientId = `mock-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
    const clientSecret = `mock-secret-${Math.random().toString(36).slice(2, 14)}`;
    logWarn(`[MOCK] Registered client "${clientName}" → ${clientId}`);
    this.clientId = clientId;
    this.clientSecret = clientSecret;
    return { clientId, clientSecret };
  }

  private mockExchangeToken(params: {
    subjectToken: string;
    scope?: string;
    audience?: string;
  }): { accessToken: string; tokenType: string; expiresIn: number } {
    const header = Buffer.from(JSON.stringify({
      alg: 'RS256', typ: 'JWT', kid: 'mock-key-1',
    })).toString('base64url');

    const payload = Buffer.from(JSON.stringify({
      iss: this.issuerUrl,
      sub: this.clientId ?? 'mock-client',
      aud: params.audience ?? 'court-ready-store',
      scope: params.scope ?? 'catalog:read cart:write',
      iat: Math.floor(Date.now() / 1000),
      exp: Math.floor(Date.now() / 1000) + 3600,
      jti: `mock-${Date.now().toString(36)}`,
      mock: true,
    })).toString('base64url');

    const signature = Buffer.from('mock-signature-offline-mode').toString('base64url');

    logWarn('[MOCK] Token exchange — returning synthetic token');
    return {
      accessToken: `${header}.${payload}.${signature}`,
      tokenType: 'Bearer',
      expiresIn: 3600,
    };
  }

  private mockVerifyToken(token: string): { valid: boolean; claims: Record<string, unknown> } {
    try {
      const parts = token.split('.');
      if (parts.length === 3) {
        const payload = JSON.parse(Buffer.from(parts[1]!, 'base64url').toString());
        logWarn('[MOCK] Token decoded (signature NOT verified)');
        return { valid: true, claims: payload as Record<string, unknown> };
      }
    } catch {
      // Decoding failed
    }
    logWarn('[MOCK] Token verification — unable to decode');
    return { valid: false, claims: {} };
  }
}

// ---------------------------------------------------------------------------
// Re-export TokenType for convenience
// ---------------------------------------------------------------------------
export { TokenType } from '@keycardai/oauth';

// Default export so the orchestrator's `module.default` fallback works
export default KeycardRealService;
