# Court Ready — Integration Spec

Wiring the demo's mock services to real SDK integrations for AAuth.dev, Keycard, and KYA-PAY.

---

## 1. AAuth.dev (Person Server)

### NPM Packages

| Package | Purpose | Status |
|---|---|---|
| `@aauth/bootstrap` | CLI: keypair generation, person-server registration, hosting | Published, working |
| `@aauth/fetch` | CLI: make AAuth-authenticated HTTP requests | Published, working |
| `@aauth/mcp-agent` | Agent-side: `createAAuthFetch()` — signed fetch, challenge-response, token exchange | Published, working |
| `@aauth/mcp-server` | Server-side: `verifyToken()`, `buildAAuthHeader()`, `createResourceToken()` | Published, working |
| `@aauth/local-keys` | Library: manage agent signing keys across hardware/software backends | Published, working |
| `@aauth/hardware-keys` | Native bindings: YubiKey PIV, macOS Secure Enclave | Published, working |
| `@aauth/mcp-stdio` | stdio-to-HTTP proxy with AAuth signatures | Published, working |
| `@aauth/mcp-openclaw` | OpenClaw plugin for AAuth-authenticated MCP connections | Published, working |

Source: [github.com/aauth-dev/packages-js](https://github.com/aauth-dev/packages-js)

**Key capabilities we need:**
- Keypair generation → `@aauth/local-keys` or `@aauth/bootstrap create`
- Public key publication → `@aauth/bootstrap create` registers with Person Server
- Signed requests (RFC 9421) → `@aauth/mcp-agent` → `createAAuthFetch()`

**Readiness: ✅ BUILDABLE TODAY.** All packages are on npm with documented APIs. The README shows working code examples.

**Unsupported (per README):**
- Call chaining (multi-hop delegation) — not needed for demo
- AS federation (four-party mode) — we use the 3-party flow for the demo; the 4-party federated flow is spec'd at `explorer.aauth.dev/access/federated` but not yet in the SDK

### What Replaces What

| Mock Code | Real Replacement |
|---|---|
| `PersonServerMock.registerAgent()` | `@aauth/bootstrap create` — registers agent with real Person Server |
| `PersonServerMock.proposeMission()` | Stay as demo orchestration — AAuth missions are PS-side concepts; we'd call the real PS API if available, but the SDK doesn't expose a mission proposal client yet |
| `PersonServerMock.federateToAccessServer()` | `@aauth/mcp-agent` → `createAAuthFetch()` handles 401 challenge → token exchange automatically |
| `PersonServerMock.requestConsent()` | Stay as demo UI — consent is interactive and PS-specific |

**Strategy:** Use `@aauth/mcp-agent` for the agent-side signed fetch (replaces manual signing logic). Use `@aauth/bootstrap` for initial key setup. Keep `PersonServerMock` as a **fallback** when no real PS is configured.

---

## 2. Keycard (Access Server / Agent Governance)

### NPM Packages

| Package | Purpose | Status |
|---|---|---|
| `@keycardai/oauth` | OAuth 2.0 primitives — JWKS key management, JWT signing/verification, AS discovery | Published, Preview |
| `@keycardai/mcp` | MCP OAuth integration — Express middleware, token verification, client providers | Published, Preview |
| `@keycardai/sdk` | Aggregate re-export of oauth + mcp | Published, Preview |

Source: [github.com/keycardai/typescript-sdk](https://github.com/keycardai/typescript-sdk)

**Key capabilities we need:**
- Bearer token verification → `@keycardai/mcp` → `requireBearerAuth()`
- Auth token issuance (as AS) → `@keycardai/oauth` → `JWTSigner`, `JWKSOAuthKeyring`
- Token exchange (RFC 8693) → `@keycardai/mcp` → `AuthProvider.exchangeTokens()`
- Governance policy enforcement → Keycard console (console.keycard.ai) for zone policies

**Readiness: ✅ BUILDABLE TODAY (Preview).** SDK is functional but APIs may change. The Keycard MCP servers (keycard-linear, keycard-github) are already configured in this OpenClaw instance, proving the platform works.

**Existing Keycard integrations in OpenClaw config:**
- `keycard-linear` — Linear MCP server via Keycard
- `keycard-github` — GitHub MCP server via Keycard

### What Replaces What

| Mock Code | Real Replacement |
|---|---|
| `AccessServerMock.issueAuthToken()` | `@keycardai/oauth` → `JWTSigner` for signing `aa-auth+jwt` tokens; or delegate to Keycard STS for real token exchange |
| `AccessServerMock.revokeToken()` | Keycard STS supports revocation natively — use their API |
| `AccessServerMock.getAuditLog()` | Keycard provides centralized telemetry/audit — use their event stream |
| Mock ES256 keypair generation | `@keycardai/oauth` → `JWKSOAuthKeyring` manages keys properly |

**Strategy:** Replace the mock AS with `@keycardai/oauth` signing/verification. For full governance, point to a real Keycard zone (console.keycard.ai). Keep mock as fallback for offline demo.

---

## 3. KYA-PAY (Payment Authorization)

### NPM Packages

**None found.** No `kyapay` or `@kyapay` packages on npm. The search returned zero results.

### Protocol Status

Source: [github.com/skyfire-xyz/kyapay](https://github.com/skyfire-xyz/kyapay)

- The repo contains **only the protocol specification** — JWT data model and example APIs
- No SDK, no client library, no server implementation
- Three token types defined: `kya+jwt` (identity), `pay+jwt` (payment), `kya-pay+jwt` (combined)
- Uses ES256 signing, standard JWT claims + Skyfire-defined claims (`bid`, `aid`, `spr`, `sps`, `amount`, `cur`, `value`)
- **v1.0 spec "aimed to be released soon"** — working group still forming

**Readiness: ❌ PROTOCOL-ONLY — NO SDK.** There is no npm package, no client library, and no hosted service to call. KYA-PAY is a JWT specification, not a runnable service.

### What Replaces What

| Mock Code | Real Replacement |
|---|---|
| `validateKyaPayClaims()` | **Stays as-is** — this is local JWT claim validation which matches the spec exactly |
| `createKyaPayReceipt()` | **Stays as-is** — receipt generation is application logic, not protocol |
| KYA-PAY token structure (`kya_pay` claims in `aa-auth+jwt`) | We could emit spec-compliant `kya-pay+jwt` tokens instead of embedding in `aa-auth+jwt`, but there's no validator to receive them |

**Strategy:** Keep the current mock validation logic. It already implements the correct KYA-PAY claim checks per the spec data model. Add a `kya-pay+jwt` token builder using `jose` that follows the spec's JWT structure for demo fidelity, but don't try to call a service that doesn't exist.

---

## 4. Auth Setup for G (gkedev@gmail.com)

### AAuth.dev
1. Run `npx @aauth/bootstrap create <agent-provider-url>` — generates Ed25519 keypair, registers with Person Server (person.hello.coop is the default)
2. This creates agent identity bound to G's email
3. Keys stored locally (managed by `@aauth/local-keys`)

### Keycard
1. G already has Keycard configured (keycard-linear, keycard-github in OpenClaw)
2. Get zone ID from [console.keycard.ai](https://console.keycard.ai)
3. Create application credential (ClientSecret or WebIdentity) for the Court Ready server
4. Set env vars: `KEYCARD_ZONE_URL`, `KEYCARD_CLIENT_ID`, `KEYCARD_CLIENT_SECRET`

### KYA-PAY
- No account needed — protocol-only. The demo validates claims locally.

### Environment Variables Needed

```env
# AAuth
AAUTH_AGENT_KEY_PATH=./keys/agent-private.jwk
AAUTH_PERSON_SERVER=https://person.hello.coop

# Keycard
KEYCARD_ZONE_ID=t55y1t1etlnq7ws9cgidzfxm2d
KEYCARD_ZONE_URL=https://t55y1t1etlnq7ws9cgidzfxm2d.keycard.cloud
KEYCARD_CLIENT_ID=<from console>
KEYCARD_CLIENT_SECRET=<from console>

# Demo toggle
USE_REAL_SERVICES=true  # false = fall back to mocks
```

---

## 5. Implementation Plan

### Priority 1: AAuth Agent-Side Integration (Day 1)
**Why first:** This is the most complete SDK and the foundation of the demo flow.

1. `npm install @aauth/mcp-agent @aauth/local-keys @aauth/bootstrap`
2. Add bootstrap script: `scripts/setup-aauth.ts` — runs `bootstrap create`, stores keys
3. Replace agent-side fetch in `src/agent/demo-client.ts` with `createAAuthFetch()`
4. Replace `aauth-middleware.ts` token verification with `@aauth/mcp-server` → `verifyToken()`
5. Add `USE_REAL_SERVICES` toggle — when false, use existing mocks

**Files changed:** `src/agent/demo-client.ts`, `src/auth/aauth-middleware.ts`, new `scripts/setup-aauth.ts`

### Priority 2: Keycard Access Server Integration (Day 2)
**Why second:** SDK is functional (preview), replaces the most mock code.

1. `npm install @keycardai/oauth @keycardai/mcp`
2. Replace `AccessServerMock` with real Keycard zone integration
3. Use `JWTSigner` + `JWKSOAuthKeyring` for token issuance
4. Wire `requireBearerAuth()` middleware into Express server
5. Add `AuthProvider.grant()` for delegated access scenarios

**Files changed:** `src/mocks/access-server.ts` → refactor to thin wrapper around Keycard SDK, `src/server/index.ts`

### Priority 3: KYA-PAY Spec-Compliant Tokens (Day 3)
**Why third:** No real service exists, but we can make the demo more spec-faithful.

1. Create `src/checkout/kyapay-token-builder.ts` — builds `kya-pay+jwt` tokens per spec
2. Use `jose` (already a dependency) with ES256, proper `typ: "kya-pay+jwt"` header
3. Include spec-defined claims: `bid`, `aid`, `spr`, `sps`, `amount`, `cur`, `ssi`
4. Update `validateKyaPayClaims()` to also accept standalone `kya-pay+jwt` tokens
5. Keep existing embedded-claims path as fallback

**Files changed:** `src/checkout/kyapay-validator.ts`, new `src/checkout/kyapay-token-builder.ts`

### Priority 4: Polish & Fallback Architecture (Day 4)
1. Implement clean `USE_REAL_SERVICES` toggle across all three services
2. Each service module exports a factory: `createPersonServer(real: boolean)`
3. Ensure demo runs fully offline with mocks (for presentations without network)
4. Add setup script: `scripts/setup-real-services.ts` that validates all credentials
5. Update README with setup instructions

---

## 6. Blockers & Manual Setup Required

| Blocker | Severity | Resolution |
|---|---|---|
| Keycard SDK is "Preview" — APIs may change | Low | Pin versions, watch changelog |
| AAuth 4-party federation not in SDK | None | Demo uses 3-party flow, which is supported |
| No KYA-PAY npm package or hosted service | High | Keep mock; build spec-compliant tokens locally |
| Need Keycard zone + credentials for G | Manual | G must create zone at console.keycard.ai and provide credentials |
| AAuth `@aauth/bootstrap create` requires agent-provider URL | Manual | G needs to decide on a provider URL (can be localhost for dev) |
| No `@aauth/mcp-server` mission proposal API | Low | Keep mission logic in demo orchestration layer |

### Things That Stay Mock (by Design)
- **Mission proposal/approval flow** — This is demo UI, not a service call
- **Consent prompts** — Interactive, user-facing, demo-specific
- **Cart/catalog data** — Demo data, not a real service
- **KYA-PAY receipt generation** — Application logic, not protocol
