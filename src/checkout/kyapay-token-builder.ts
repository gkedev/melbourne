// ============================================================================
// Court Ready — KYA-PAY Token Builder
// ============================================================================
//
// Builds spec-compliant kya-pay+jwt tokens per the KYAPay protocol
// (https://kyapay.org/).
//
// KYA-PAY is the payment authorization layer for agent commerce. A
// kya-pay+jwt token encodes:
//
//   Standard JWT claims:
//     typ   — "kya-pay+jwt" (in the protected header)
//     alg   — ES256
//     iss   — issuer (the agent platform / wallet)
//     sub   — subject (the buyer agent)
//     aud   — audience (the merchant / seller service)
//     exp   — expiration
//     iat   — issued-at
//     jti   — unique token identifier
//
//   KYAPay-specific claims:
//     bid   — buyer agent identifier
//     aid   — agent identifier (the shopping agent performing the purchase)
//     spr   — seller/provider identifier (merchant ID)
//     sps   — seller/provider service URL
//     amount — transaction amount (numeric)
//     cur   — currency code (e.g. "USD")
//     value  — human-readable value description
//
// The token is ES256-signed. If no signing key is provided, an ephemeral
// keypair is generated for the demo.
//
// ============================================================================

import * as jose from 'jose';

// ── Colours for demo output ────────────────────────────────────────
const RED   = '\x1b[31m';
const RESET = '\x1b[0m';
const BOLD  = '\x1b[1m';
const DIM   = '\x1b[2m';
const GREEN = '\x1b[32m';

function log(msg: string) {
  const ts = new Date().toISOString().slice(11, 23);
  console.log(`${DIM}${ts}${RESET} ${RED}${BOLD}💳 [KYA-PAY]${RESET} ${msg}`);
}

// ============================================================================
// Types
// ============================================================================

/**
 * The full set of KYA-PAY claims decoded from a kya-pay+jwt token.
 */
export interface KyaPayTokenClaims {
  /** Buyer agent identifier */
  bid: string;
  /** Agent identifier (the shopping agent performing the action) */
  aid: string;
  /** Seller/provider identifier (merchant ID) */
  spr: string;
  /** Seller/provider service URL */
  sps: string;
  /** Transaction amount */
  amount: number;
  /** Currency code (e.g. "USD") */
  cur: string;
  /** Human-readable value description */
  value: string;
  /** Issuer */
  iss: string;
  /** Subject */
  sub: string;
  /** Expiration (epoch seconds) */
  exp: number;
}

/**
 * Result of validating a kya-pay+jwt token.
 */
export interface KyaPayValidation {
  valid: boolean;
  claims?: KyaPayTokenClaims;
  reason?: string;
}

// ============================================================================
// Ephemeral Key Management
// ============================================================================
//
// For the demo, we lazily generate an ES256 keypair if no signing key is
// provided. This lets the demo produce real signed JWTs without requiring
// external key configuration.
// ============================================================================

let ephemeralPrivateKey: CryptoKey | null = null;
let ephemeralPublicKey: CryptoKey | null = null;

async function getEphemeralKeyPair(): Promise<{ privateKey: CryptoKey; publicKey: CryptoKey }> {
  if (!ephemeralPrivateKey || !ephemeralPublicKey) {
    log(`Generating ephemeral ES256 keypair for KYA-PAY token signing…`);
    const kp = await jose.generateKeyPair('ES256', { extractable: true });
    ephemeralPrivateKey = kp.privateKey as CryptoKey;
    ephemeralPublicKey = kp.publicKey as CryptoKey;
    log(`✓ Ephemeral keypair ready`);
  }
  return { privateKey: ephemeralPrivateKey, publicKey: ephemeralPublicKey };
}

// ============================================================================
// buildKyaPayToken
// ============================================================================
//
// Build a spec-compliant kya-pay+jwt token. The token captures a specific
// payment intent: buyer agent X wants to pay merchant Y amount Z in
// currency C for value V.
//
// Parameters:
//   buyerAgentId     — The buyer's agent ID (becomes `bid` claim)
//   sellerMerchantId — The merchant's ID (becomes `spr` claim, also `aud`)
//   sellerServiceUrl — The merchant's service URL (becomes `sps` claim)
//   amount           — The transaction amount (becomes `amount` claim)
//   currency         — The ISO 4217 currency code (becomes `cur` claim)
//   description      — Human-readable value description (becomes `value` claim)
//   signingKey       — Optional CryptoKey; if omitted, an ephemeral key is used
//
// Returns: the signed JWT string
// ============================================================================

export async function buildKyaPayToken(params: {
  buyerAgentId: string;
  sellerMerchantId: string;
  sellerServiceUrl: string;
  amount: number;
  currency: string;
  description: string;
  signingKey?: CryptoKey;
}): Promise<string> {
  const {
    buyerAgentId,
    sellerMerchantId,
    sellerServiceUrl,
    amount,
    currency,
    description,
    signingKey,
  } = params;

  log(`Building kya-pay+jwt token…`);
  log(`  Buyer agent  : ${DIM}${buyerAgentId.slice(0, 24)}${buyerAgentId.length > 24 ? '…' : ''}${RESET}`);
  log(`  Merchant     : ${BOLD}${sellerMerchantId}${RESET}`);
  log(`  Service URL  : ${DIM}${sellerServiceUrl}${RESET}`);
  log(`  Amount       : ${BOLD}${amount.toFixed(2)} ${currency}${RESET}`);
  log(`  Description  : "${description}"`);

  // Determine signing key — use provided or fall back to ephemeral
  let privateKey: CryptoKey;
  if (signingKey) {
    privateKey = signingKey;
    log(`  Signing with : provided key`);
  } else {
    const kp = await getEphemeralKeyPair();
    privateKey = kp.privateKey;
    log(`  Signing with : ephemeral demo key`);
  }

  // Generate unique token ID
  const jti = `kyp-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;

  // Agent identifier — in a full deployment this would be the agent platform's
  // canonical ID for the shopping agent instance. For the demo, we derive it
  // from the buyer agent ID.
  const agentId = `agent:${buyerAgentId}`;

  const now = Math.floor(Date.now() / 1000);
  const expSeconds = 600; // 10-minute validity window

  // ── Build and sign the JWT ──────────────────────────────────────
  const jwt = await new jose.SignJWT({
    // KYAPay-specific claims
    bid: buyerAgentId,
    aid: agentId,
    spr: sellerMerchantId,
    sps: sellerServiceUrl,
    amount,
    cur: currency,
    value: description,
  })
    .setProtectedHeader({
      alg: 'ES256',
      typ: 'kya-pay+jwt',
    })
    .setIssuer(agentId)             // iss — the agent/wallet that issues the token
    .setSubject(buyerAgentId)       // sub — the buyer
    .setAudience(sellerMerchantId)  // aud — the merchant
    .setIssuedAt(now)               // iat
    .setExpirationTime(now + expSeconds) // exp
    .setJti(jti)                    // jti — unique token ID
    .sign(privateKey);

  log(`✓ ${GREEN}${BOLD}kya-pay+jwt signed${RESET} (ES256)`);
  log(`  Token ID  : ${DIM}${jti}${RESET}`);
  log(`  Issued at : ${new Date(now * 1000).toISOString()}`);
  log(`  Expires   : ${new Date((now + expSeconds) * 1000).toISOString()}`);
  log(`  JWT size  : ${jwt.length} bytes`);

  return jwt;
}

// ============================================================================
// validateKyaPayToken
// ============================================================================
//
// Local validation of a kya-pay+jwt token. This performs structural and
// claims-level checks WITHOUT cryptographic signature verification (since
// we may not have the signer's public key in all contexts).
//
// Checks performed:
//   1. Token is a valid JWT and can be decoded
//   2. Header typ is "kya-pay+jwt"
//   3. All required KYAPay claims are present
//   4. Amount is a positive number
//   5. Token is not expired
//   6. Optional: merchant matches expectedMerchant
//   7. Optional: amount does not exceed maxAmount
//
// For full cryptographic verification in production, the verifier would
// fetch the signer's JWKS and verify the ES256 signature.
// ============================================================================

export async function validateKyaPayToken(
  token: string,
  options?: {
    expectedMerchant?: string;
    maxAmount?: number;
  },
): Promise<KyaPayValidation> {
  log(`Validating kya-pay+jwt token…`);

  try {
    // ── Step 1: Decode the JWT (without signature verification) ──
    // In production you would verify against the issuer's JWKS.
    // For local/demo validation we decode and inspect claims only.
    const decoded = jose.decodeJwt(token);
    const header = jose.decodeProtectedHeader(token);

    // ── Step 2: Check header typ ────────────────────────────────
    if (header.typ !== 'kya-pay+jwt') {
      const reason = `Invalid token type: expected "kya-pay+jwt", got "${header.typ ?? '(none)'}"`;
      log(`  ✗ ${reason}`);
      return { valid: false, reason };
    }
    log(`  ✓ Token type: kya-pay+jwt`);

    // ── Step 3: Check required KYAPay claims ────────────────────
    const requiredClaims = ['bid', 'aid', 'spr', 'sps', 'amount', 'cur', 'value'] as const;
    for (const claim of requiredClaims) {
      if (decoded[claim] === undefined || decoded[claim] === null) {
        const reason = `Missing required KYAPay claim: "${claim}"`;
        log(`  ✗ ${reason}`);
        return { valid: false, reason };
      }
    }
    log(`  ✓ All required KYAPay claims present`);

    // ── Step 4: Validate amount ─────────────────────────────────
    const amount = decoded.amount as number;
    if (typeof amount !== 'number' || amount <= 0 || !isFinite(amount)) {
      const reason = `Invalid amount: ${amount} (must be a positive finite number)`;
      log(`  ✗ ${reason}`);
      return { valid: false, reason };
    }
    log(`  ✓ Amount valid: ${amount.toFixed(2)} ${decoded.cur}`);

    // ── Step 5: Check expiration ────────────────────────────────
    const exp = decoded.exp;
    if (typeof exp === 'number') {
      const now = Math.floor(Date.now() / 1000);
      if (now > exp) {
        const reason = `Token expired at ${new Date(exp * 1000).toISOString()}`;
        log(`  ✗ ${reason}`);
        return { valid: false, reason };
      }
      log(`  ✓ Token not expired (expires ${new Date(exp * 1000).toISOString()})`);
    } else {
      log(`  ⚠ No expiration claim — treating as valid`);
    }

    // ── Step 6: Optional merchant check ─────────────────────────
    if (options?.expectedMerchant) {
      const spr = decoded.spr as string;
      if (spr !== options.expectedMerchant) {
        const reason = `Merchant mismatch: token targets "${spr}" but expected "${options.expectedMerchant}"`;
        log(`  ✗ ${reason}`);
        return { valid: false, reason };
      }
      log(`  ✓ Merchant matches: ${spr}`);
    }

    // ── Step 7: Optional max amount check ───────────────────────
    if (options?.maxAmount !== undefined) {
      if (amount > options.maxAmount) {
        const reason = `Amount ${amount.toFixed(2)} exceeds maximum allowed ${options.maxAmount.toFixed(2)}`;
        log(`  ✗ ${reason}`);
        return { valid: false, reason };
      }
      log(`  ✓ Amount within limit (max: ${options.maxAmount.toFixed(2)})`);
    }

    // ── Build the validated claims object ───────────────────────
    const claims: KyaPayTokenClaims = {
      bid: decoded.bid as string,
      aid: decoded.aid as string,
      spr: decoded.spr as string,
      sps: decoded.sps as string,
      amount: decoded.amount as number,
      cur: decoded.cur as string,
      value: decoded.value as string,
      iss: decoded.iss as string,
      sub: decoded.sub as string,
      exp: decoded.exp as number,
    };

    log(`  ${GREEN}${BOLD}✓ TOKEN VALID${RESET}`);
    log(`  Buyer    : ${DIM}${claims.bid}${RESET}`);
    log(`  Merchant : ${BOLD}${claims.spr}${RESET}`);
    log(`  Amount   : ${BOLD}${claims.amount.toFixed(2)} ${claims.cur}${RESET}`);
    log(`  Value    : "${claims.value}"`);

    return { valid: true, claims };
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    const reason = `Token decode/validation failed: ${message}`;
    log(`  ✗ ${reason}`);
    return { valid: false, reason };
  }
}
