// ============================================================================
// Court Ready — Service Orchestrator
// ============================================================================
//
// Master orchestrator that wires together the three external services for the
// AAuth 4-party checkout flow:
//
//   1. AAuth (Person Server)  — agent identity & mission governance
//   2. Keycard (Access Server) — auth token issuance & policy enforcement
//   3. KYA-PAY                — payment authorization tokens
//
// Each service can run in "real" mode (calling live APIs) or "mock" mode
// (using the in-process mock implementations). The orchestrator:
//
//   - Attempts real services when configured
//   - Falls back to mocks if real services fail to initialize
//   - Logs clearly which mode each service is running in
//   - Provides a unified executeCheckoutFlow() for the full 4-party dance
//
// ============================================================================

import { buildKyaPayToken } from '../checkout/kyapay-token-builder.js';
import { PersonServerMock } from '../mocks/person-server.js';
import { AccessServerMock } from '../mocks/access-server.js';
import { DEMO_CONFIG, SCOPES } from '../auth/constants.js';

// ── Colours ────────────────────────────────────────────────────────
const CYAN   = '\x1b[36m';
const GREEN  = '\x1b[32m';
const YELLOW = '\x1b[33m';
const RED    = '\x1b[31m';
const RESET  = '\x1b[0m';
const BOLD   = '\x1b[1m';
const DIM    = '\x1b[2m';

function log(msg: string) {
  const ts = new Date().toISOString().slice(11, 23);
  console.log(`${DIM}${ts}${RESET} ${CYAN}${BOLD}🎯 [Orchestrator]${RESET} ${msg}`);
}

// ============================================================================
// Types
// ============================================================================

/**
 * Configuration for the ServiceOrchestrator.
 *
 * Each `useReal*` flag controls whether to attempt the real service.
 * If the real service fails to initialize, the orchestrator falls back
 * to the mock automatically.
 */
export interface ServiceConfig {
  /** Attempt to use the real AAuth Person Server */
  useRealAAuth: boolean;

  /** Attempt to use the real Keycard Access Server */
  useRealKeycard: boolean;

  /**
   * Use real KYA-PAY network. Always false for now — the protocol is
   * spec-compliant but there's no live payment network yet. Tokens are
   * built locally using the spec-compliant builder.
   */
  useRealKyaPay: boolean;

  /** Keycard configuration (required when useRealKeycard is true) */
  keycard?: {
    issuerUrl: string;
    zoneId: string;
    clientId?: string;
    clientSecret?: string;
  };

  /** AAuth configuration */
  aauth?: {
    agentUrl?: string;
  };
}

/** Which mode each service is running in */
export type ServiceMode = 'real' | 'mock';

/** Status report for all services */
export interface ServiceStatus {
  aauth: ServiceMode;
  keycard: ServiceMode;
  kyapay: 'spec-compliant';
}

// ── Dynamic import types ───────────────────────────────────────────
// These interfaces describe the real service classes as they actually
// exist in the codebase. We use them for type-safe access when the
// dynamic import succeeds.
//
// AAuthRealService (../auth/aauth-real.ts):
//   - Static factory: AAuthRealService.initialize(options?)
//   - createFetch() — returns a protocol-aware fetch wrapper
//   - signToken(payload) — signs an aa-agent+jwt
//   - getAgentId() — returns the agent's AAuth identifier
//   - getPublicKeyJwk() — returns the agent's public key
//
// KeycardRealService (../auth/keycard-real.ts):
//   - Static factory: KeycardRealService.initialize(options)
//   - registerClient(metadata) — RFC 7591 dynamic client registration
//   - exchangeToken(params) — RFC 8693 token exchange
//   - verifyToken(token) — JWT verification via JWKS
//   - revokeToken(token) — RFC 7009 token revocation
//   - getZoneInfo() / isOffline() / getMetadata()

interface AAuthRealServiceLike {
  createFetch(options?: Record<string, unknown>): unknown;
  signToken(payload: Record<string, unknown>): Promise<string>;
  getAgentId(): string;
  getPublicKeyJwk(): Promise<unknown>;
}

interface KeycardRealServiceLike {
  registerClient(metadata: { clientName: string; redirectUris?: string[]; grantTypes?: string[]; tokenEndpointAuthMethod?: string }): Promise<{ clientId: string; clientSecret?: string }>;
  exchangeToken(params: { subjectToken: string; subjectTokenType: string; scope?: string; audience?: string }): Promise<{ accessToken: string; tokenType: string; expiresIn: number }>;
  verifyToken(token: string): Promise<{ valid: boolean; claims: Record<string, unknown> }>;
  revokeToken(token: string): Promise<void>;
  getZoneInfo(): { zoneId: string; issuerUrl: string };
  isOffline(): boolean;
}

// ============================================================================
// ServiceOrchestrator
// ============================================================================

export class ServiceOrchestrator {
  // ── AAuth (Person Server) — real or mock ────────────────────────
  // When real: AAuthRealService — uses createFetch() for protocol-aware
  //   HTTP with automatic challenge-response handling.
  // When mock: PersonServerMock — auto-approves missions, simulates
  //   federation with the mock AccessServer.
  private _aauth: AAuthRealServiceLike | PersonServerMock;
  private _aathMode: ServiceMode;

  // ── Keycard (Access Server) — real or mock ──────────────────────
  // When real: KeycardRealService — RFC 8693 token exchange against a
  //   live Keycard zone, JWKS verification, revocation.
  // When mock: AccessServerMock — generates signed JWTs locally with an
  //   ephemeral keypair, in-memory audit trail.
  private _keycard: KeycardRealServiceLike | AccessServerMock;
  private _keycardMode: ServiceMode;

  // ── Private constructor — use static create() ──────────────────

  private constructor(
    aauth: AAuthRealServiceLike | PersonServerMock,
    keycard: KeycardRealServiceLike | AccessServerMock,
    aathMode: ServiceMode,
    keycardMode: ServiceMode,
  ) {
    this._aauth = aauth;
    this._keycard = keycard;
    this._aathMode = aathMode;
    this._keycardMode = keycardMode;
  }

  // ── Factory ────────────────────────────────────────────────────

  /**
   * Create a new ServiceOrchestrator with the given configuration.
   * Attempts to initialize real services where configured; falls back
   * to mocks on failure.
   */
  static async create(config: ServiceConfig): Promise<ServiceOrchestrator> {
    log(`Initializing service orchestrator…`);
    log(`${'─'.repeat(50)}`);

    // ── Initialize Keycard (Access Server) ────────────────────────
    let keycard: KeycardRealServiceLike | AccessServerMock;
    let keycardMode: ServiceMode;

    if (config.useRealKeycard && config.keycard) {
      log(`Attempting real Keycard connection…`);
      log(`  Issuer URL : ${config.keycard.issuerUrl}`);
      log(`  Zone ID    : ${config.keycard.zoneId}`);

      try {
        // Dynamic import — won't crash if file doesn't exist yet
        const module = await import('../auth/keycard-real.js');
        const KeycardRealService = module.KeycardRealService;

        if (!KeycardRealService) {
          throw new Error('KeycardRealService class not found in module');
        }

        // KeycardRealService uses a static initialize() factory
        const instance = await KeycardRealService.initialize({
          issuerUrl: config.keycard.issuerUrl,
          clientId: config.keycard.clientId,
          clientSecret: config.keycard.clientSecret,
        });

        // Check if the real service fell back to offline mode
        if (instance.isOffline()) {
          log(`  ${YELLOW}⚠ Keycard connected but in offline mode${RESET}`);
          log(`  ${YELLOW}  Zone unreachable — using mock fallback within real service${RESET}`);
        }

        keycard = instance;
        keycardMode = 'real';
        log(`  ${GREEN}${BOLD}✓ Keycard: REAL${RESET} — connected to ${config.keycard.issuerUrl}`);
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : String(err);
        log(`  ${YELLOW}⚠ Keycard real service failed: ${message}${RESET}`);
        log(`  ${YELLOW}  Falling back to mock${RESET}`);
        keycard = new AccessServerMock();
        keycardMode = 'mock';
      }
    } else {
      log(`Keycard: using mock (useRealKeycard=${config.useRealKeycard})`);
      keycard = new AccessServerMock();
      keycardMode = 'mock';
    }

    // ── Initialize AAuth (Person Server) ──────────────────────────
    let aauth: AAuthRealServiceLike | PersonServerMock;
    let aathMode: ServiceMode;

    if (config.useRealAAuth) {
      log(`Attempting real AAuth connection…`);
      if (config.aauth?.agentUrl) {
        log(`  Agent URL : ${config.aauth.agentUrl}`);
      }

      try {
        // Dynamic import — won't crash if file doesn't exist yet
        const module = await import('../auth/aauth-real.js');
        const AAuthRealService = module.AAuthRealService;

        if (!AAuthRealService) {
          throw new Error('AAuthRealService class not found in module');
        }

        // AAuthRealService uses a static initialize() factory
        const instance = await AAuthRealService.initialize({
          agentUrl: config.aauth?.agentUrl,
        });

        aauth = instance;
        aathMode = 'real';
        log(`  ${GREEN}${BOLD}✓ AAuth: REAL${RESET} — agent ID: ${instance.getAgentId()}`);
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : String(err);
        log(`  ${YELLOW}⚠ AAuth real service failed: ${message}${RESET}`);
        log(`  ${YELLOW}  Falling back to mock${RESET}`);
        // PersonServerMock requires an AccessServerMock — if keycard is real,
        // create a separate mock for the person server's internal federation
        const mockAccessServer = keycardMode === 'mock'
          ? (keycard as AccessServerMock)
          : new AccessServerMock();
        aauth = new PersonServerMock(mockAccessServer);
        aathMode = 'mock';
      }
    } else {
      log(`AAuth: using mock (useRealAAuth=${config.useRealAAuth})`);
      const mockAccessServer = keycardMode === 'mock'
        ? (keycard as AccessServerMock)
        : new AccessServerMock();
      aauth = new PersonServerMock(mockAccessServer);
      aathMode = 'mock';
    }

    // ── KYA-PAY is always spec-compliant (no live network yet) ────
    log(`KYA-PAY: spec-compliant token builder (no live network)`);

    // ── Summary ───────────────────────────────────────────────────
    log(`${'─'.repeat(50)}`);
    log(`${BOLD}Service Status:${RESET}`);
    log(`  AAuth   : ${aathMode === 'real' ? `${GREEN}${BOLD}REAL${RESET}` : `${YELLOW}MOCK${RESET}`}`);
    log(`  Keycard : ${keycardMode === 'real' ? `${GREEN}${BOLD}REAL${RESET}` : `${YELLOW}MOCK${RESET}`}`);
    log(`  KYA-PAY : ${CYAN}SPEC-COMPLIANT${RESET}`);
    log(`${'─'.repeat(50)}`);
    log(`✓ Orchestrator ready\n`);

    return new ServiceOrchestrator(aauth, keycard, aathMode, keycardMode);
  }

  // ============================================================================
  // Service Accessors
  // ============================================================================

  /**
   * Get the AAuth service (real AAuthRealService or mock PersonServer).
   *
   * When real: provides createFetch(), signToken(), getAgentId().
   * When mock: provides registerAgent(), proposeMission(), federateToAccessServer().
   */
  get aauth(): AAuthRealServiceLike | PersonServerMock {
    return this._aauth;
  }

  /**
   * Get the Keycard service (real KeycardRealService or mock AccessServer).
   *
   * When real: provides exchangeToken(), verifyToken(), revokeToken().
   * When mock: provides issueAuthToken(), revokeToken(), getAuditLog().
   */
  get keycard(): KeycardRealServiceLike | AccessServerMock {
    return this._keycard;
  }

  // ============================================================================
  // KYA-PAY Token Building
  // ============================================================================

  /**
   * Build a spec-compliant KYA-PAY token for a payment.
   * Always uses the local spec-compliant builder (no live network yet).
   */
  async buildPaymentToken(params: {
    buyerAgentId: string;
    merchantId: string;
    merchantUrl: string;
    amount: number;
    currency: string;
    description: string;
  }): Promise<string> {
    log(`Building KYA-PAY token via spec-compliant builder…`);

    const token = await buildKyaPayToken({
      buyerAgentId: params.buyerAgentId,
      sellerMerchantId: params.merchantId,
      sellerServiceUrl: params.merchantUrl,
      amount: params.amount,
      currency: params.currency,
      description: params.description,
    });

    return token;
  }

  // ============================================================================
  // Full Checkout Flow Orchestration
  // ============================================================================
  //
  // This is the heart of the 4-party AAuth flow. The orchestrator adapts
  // its behaviour based on which services are real vs mock:
  //
  // MOCK MODE (Person Server + Access Server mocks):
  //   Step 1: Register agent with mock Person Server
  //   Step 2: Propose mission → auto-approved
  //   Step 3: Build resource token challenge (simulated)
  //   Step 4: Federate through mock Person Server → mock Access Server
  //   Step 5: Build KYA-PAY token
  //
  // REAL MODE (AAuth SDK + Keycard):
  //   Step 1: Agent already initialized with Ed25519 keypair
  //   Step 2: Mission proposal (mock — real mission API TBD)
  //   Step 3: Build resource token challenge (simulated)
  //   Step 4: Token exchange via Keycard RFC 8693
  //   Step 5: Build KYA-PAY token
  //
  // Either way, the method returns { authToken, kyaPayToken } — everything
  // the agent needs to call checkout_confirm on the MCP server.
  //
  // ============================================================================

  async executeCheckoutFlow(params: {
    agentId: string;
    cartTotal: number;
    merchantId: string;
    missionDescription: string;
    spendingLimit: number;
  }): Promise<{ authToken: any; kyaPayToken: string }> {
    const { agentId, cartTotal, merchantId, missionDescription, spendingLimit } = params;

    log(`\n${'═'.repeat(60)}`);
    log(`${BOLD}EXECUTING 4-PARTY CHECKOUT FLOW${RESET}`);
    log(`${'═'.repeat(60)}`);
    log(`  Agent      : ${DIM}${agentId.slice(0, 24)}${agentId.length > 24 ? '…' : ''}${RESET}`);
    log(`  Cart total : ${BOLD}$${cartTotal.toFixed(2)}${RESET}`);
    log(`  Merchant   : ${merchantId}`);
    log(`  Limit      : $${spendingLimit.toFixed(2)}`);
    log(`  Mode       : AAuth=${this._aathMode}, Keycard=${this._keycardMode}`);
    log(`${'─'.repeat(60)}`);

    let authToken: any;

    if (this._aathMode === 'mock') {
      // ════════════════════════════════════════════════════════════
      // MOCK FLOW — use PersonServerMock + AccessServerMock
      // ════════════════════════════════════════════════════════════
      const mockAAuth = this._aauth as PersonServerMock;

      // ── Step 1: Register Agent Identity ────────────────────────
      log(`\n${BOLD}Step 1/5:${RESET} Register agent identity with AAuth ${YELLOW}[MOCK]${RESET}`);
      mockAAuth.registerAgent(agentId);

      // ── Step 2: Propose Mission ────────────────────────────────
      log(`\n${BOLD}Step 2/5:${RESET} Propose mission ${YELLOW}[MOCK]${RESET}`);
      const mission = mockAAuth.proposeMission(
        agentId,
        missionDescription,
        [SCOPES.CATALOG_READ, SCOPES.CART_WRITE, SCOPES.CHECKOUT, SCOPES.CHECKOUT_CONFIRM],
        spendingLimit,
      );

      // ── Step 3: Simulate Resource Token Challenge ──────────────
      log(`\n${BOLD}Step 3/5:${RESET} Resource token challenge (from MCP server)`);
      log(`  MCP server issues aa-resource+jwt for checkout authorization`);

      const resourceToken = {
        token: `rt-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
        mcpServerId: merchantId,
        scope: [SCOPES.CHECKOUT, SCOPES.CHECKOUT_CONFIRM],
        issuedAt: new Date().toISOString(),
        expiresAt: new Date(Date.now() + 5 * 60 * 1000).toISOString(),
      };
      log(`  Resource token : ${DIM}${resourceToken.token}${RESET}`);
      log(`  Scope          : ${resourceToken.scope.join(', ')}`);

      // ── Step 4: Federate to Access Server ──────────────────────
      log(`\n${BOLD}Step 4/5:${RESET} Federate through Person Server → Access Server ${YELLOW}[MOCK]${RESET}`);
      authToken = await mockAAuth.federateToAccessServer(
        agentId,
        resourceToken,
        mission,
      );
    } else {
      // ════════════════════════════════════════════════════════════
      // REAL FLOW — use AAuthRealService + KeycardRealService
      // ════════════════════════════════════════════════════════════
      const realAAuth = this._aauth as AAuthRealServiceLike;

      // ── Step 1: Agent identity already initialized ─────────────
      log(`\n${BOLD}Step 1/5:${RESET} Agent identity ${GREEN}[REAL]${RESET}`);
      const realAgentId = realAAuth.getAgentId();
      log(`  Agent ID: ${DIM}${realAgentId}${RESET}`);

      // ── Step 2: Propose Mission (mock — real mission API TBD) ──
      log(`\n${BOLD}Step 2/5:${RESET} Propose mission ${YELLOW}[LOCAL]${RESET}`);
      log(`  Mission: "${missionDescription}"`);
      log(`  Spending limit: $${spendingLimit.toFixed(2)}`);
      log(`  ℹ Mission governance is locally managed (real mission API TBD)`);

      const missionId = `mission-${Date.now().toString(36)}`;

      // ── Step 3: Resource Token Challenge ────────────────────────
      log(`\n${BOLD}Step 3/5:${RESET} Resource token challenge (from MCP server)`);

      const resourceTokenValue = `rt-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
      log(`  Resource token : ${DIM}${resourceTokenValue}${RESET}`);

      // ── Step 4: Token Exchange via Keycard ─────────────────────
      log(`\n${BOLD}Step 4/5:${RESET} Token exchange via Keycard ${GREEN}[REAL]${RESET}`);

      if (this._keycardMode === 'real') {
        // Use KeycardRealService's RFC 8693 token exchange
        const realKeycard = this._keycard as KeycardRealServiceLike;
        const exchangeResult = await realKeycard.exchangeToken({
          subjectToken: resourceTokenValue,
          subjectTokenType: 'urn:ietf:params:oauth:token-type:access_token',
          scope: [SCOPES.CHECKOUT, SCOPES.CHECKOUT_CONFIRM].join(' '),
          audience: merchantId,
        });

        // Build an AuthToken-shaped object from the exchange result
        const now = new Date();
        authToken = {
          token: exchangeResult.accessToken,
          tokenId: `aat-${Date.now().toString(36)}`,
          agentId,
          missionId,
          kyaPay: {
            maxAmountUsd: spendingLimit,
            merchantId,
            allowedScopes: [SCOPES.CATALOG_READ, SCOPES.CART_WRITE, SCOPES.CHECKOUT, SCOPES.CHECKOUT_CONFIRM],
            missionId,
          },
          issuedAt: now.toISOString(),
          expiresAt: new Date(now.getTime() + exchangeResult.expiresIn * 1000).toISOString(),
        };
      } else {
        // Keycard is mock — use AccessServerMock directly
        const mockKeycard = this._keycard as AccessServerMock;
        const mission = {
          id: missionId,
          agentId,
          description: missionDescription,
          scope: [SCOPES.CATALOG_READ, SCOPES.CART_WRITE, SCOPES.CHECKOUT, SCOPES.CHECKOUT_CONFIRM],
          spendingLimit,
          status: 'approved' as const,
          createdAt: new Date().toISOString(),
        };

        authToken = await mockKeycard.issueAuthToken(
          agentId,
          {
            token: resourceTokenValue,
            mcpServerId: merchantId,
            scope: [SCOPES.CHECKOUT, SCOPES.CHECKOUT_CONFIRM],
            issuedAt: new Date().toISOString(),
            expiresAt: new Date(Date.now() + 5 * 60 * 1000).toISOString(),
          },
          mission,
          DEMO_CONFIG.personServer.url,
        );
      }
    }

    // ── Step 5: Build KYA-PAY Token ──────────────────────────────
    // This step is the same regardless of real/mock — we always use the
    // spec-compliant KYA-PAY token builder.
    log(`\n${BOLD}Step 5/5:${RESET} Build KYA-PAY payment authorization token`);
    const kyaPayToken = await this.buildPaymentToken({
      buyerAgentId: agentId,
      merchantId,
      merchantUrl: DEMO_CONFIG.mcpServer.url,
      amount: cartTotal,
      currency: DEMO_CONFIG.kyapay.defaultCurrency,
      description: missionDescription,
    });

    // ── Complete ──────────────────────────────────────────────────
    log(`\n${'═'.repeat(60)}`);
    log(`${GREEN}${BOLD}✓ CHECKOUT FLOW COMPLETE${RESET}`);
    log(`${'═'.repeat(60)}`);
    log(`  Auth token ready   : ${DIM}${String(authToken.token).slice(0, 32)}…${RESET}`);
    log(`  KYA-PAY token ready: ${DIM}${kyaPayToken.slice(0, 32)}…${RESET}`);
    log(`  Ready for checkout_confirm\n`);

    return { authToken, kyaPayToken };
  }

  // ============================================================================
  // Status
  // ============================================================================

  /**
   * Get the current service status — which services are real vs mock.
   */
  getStatus(): ServiceStatus {
    return {
      aauth: this._aathMode,
      keycard: this._keycardMode,
      kyapay: 'spec-compliant',
    };
  }
}
