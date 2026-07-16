/**
 * Mock Keycard Access Server
 *
 * The Access Server (AS) is the governance enforcement point in AAuth.
 * It receives a resource token (from the MCP server via the Person Server),
 * validates the agent's mission scope and spending limits, then mints a
 * signed aa-auth+jwt that the agent can present back to the resource.
 *
 * This mock uses the `jose` library to create real signed JWTs so the
 * demo audience can see actual tokens flying around.
 */

import * as jose from 'jose';
import type { AuthToken, KyaPayClaims, Mission, ResourceToken } from '../types.js';

// ── Colours ────────────────────────────────────────────────────────
const MAGENTA = '\x1b[35m';
const RESET   = '\x1b[0m';
const BOLD    = '\x1b[1m';
const DIM     = '\x1b[2m';

function log(msg: string) {
  const ts = new Date().toISOString().slice(11, 23);
  console.log(`${DIM}${ts}${RESET} ${MAGENTA}${BOLD}🔐 [Keycard Access Server]${RESET} ${msg}`);
}

// ── Audit trail ────────────────────────────────────────────────────
export interface AuditEntry {
  timestamp: string;
  action: string;
  agentId: string;
  details: Record<string, unknown>;
}

// ── Demo keypair (generated once at import time) ───────────────────
let signingKey: CryptoKey;
let verifyKey: CryptoKey;

async function ensureKeys() {
  if (!signingKey) {
    const kp = await jose.generateKeyPair('ES256', { extractable: true });
    signingKey = kp.privateKey as CryptoKey;
    verifyKey = kp.publicKey as CryptoKey;
  }
}

export class AccessServerMock {
  private auditLog: AuditEntry[] = [];
  private activeTokens: Map<string, { jwt: string; agentId: string; revokedAt?: string }> = new Map();

  // ── Issue Auth Token ───────────────────────────────────────────

  async issueAuthToken(
    agentId: string,
    resourceToken: ResourceToken,
    mission: Mission,
    personServerUrl: string,
  ): Promise<AuthToken> {
    await ensureKeys();

    log(`Received federation request from Person Server`);
    log(`  Person Server  : ${personServerUrl}`);
    log(`  Agent          : ${DIM}${agentId.slice(0, 16)}…${RESET}`);

    // ── Validate resource token ────────────────────────────────
    log(`Validating resource token…`);
    if (!resourceToken.token || !resourceToken.mcpServerId) {
      throw new Error('Invalid resource token');
    }
    log(`  ✓ Resource token valid (server: ${resourceToken.mcpServerId})`);

    // ── Check mission scope & governance policy ────────────────
    log(`Enforcing governance policy…`);
    log(`  Mission scope    : ${mission.scope.join(', ')}`);
    log(`  Spending limit   : $${mission.spendingLimit.toFixed(2)}`);
    log(`  Mission status   : ${mission.status}`);

    if (mission.status !== 'approved') {
      this.audit('policy_deny', agentId, { reason: 'mission not approved' });
      throw new Error('Mission not approved — token denied');
    }
    log(`  ✓ Mission approved, scope within policy`);

    // ── Build KYA-PAY claims ───────────────────────────────────
    const kyaPayClaims: KyaPayClaims = {
      maxAmountUsd: mission.spendingLimit,
      merchantId: resourceToken.mcpServerId,
      allowedScopes: mission.scope,
      missionId: mission.id,
    };

    log(`Embedding KYA-PAY claims:`);
    log(`  Max amount  : $${kyaPayClaims.maxAmountUsd.toFixed(2)}`);
    log(`  Merchant    : ${kyaPayClaims.merchantId}`);
    log(`  Scopes      : ${kyaPayClaims.allowedScopes.join(', ')}`);

    // ── Sign the aa-auth+jwt ───────────────────────────────────
    const tokenId = `aat-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
    const now = Math.floor(Date.now() / 1000);
    const expiresAt = new Date((now + 3600) * 1000).toISOString();

    const jwt = await new jose.SignJWT({
      sub: agentId,
      iss: 'keycard-access-server',
      aud: resourceToken.mcpServerId,
      jti: tokenId,
      mission_id: mission.id,
      kya_pay: kyaPayClaims,
      person_server: personServerUrl,
    })
      .setProtectedHeader({ alg: 'ES256', typ: 'aa-auth+jwt' })
      .setIssuedAt(now)
      .setExpirationTime(now + 3600)
      .sign(signingKey);

    log(`✓ Signed aa-auth+jwt (ES256)`);
    log(`  Token ID  : ${DIM}${tokenId}${RESET}`);
    log(`  Expires   : ${expiresAt}`);

    // ── Store for revocation ───────────────────────────────────
    this.activeTokens.set(tokenId, { jwt, agentId });

    this.audit('token_issued', agentId, {
      tokenId,
      missionId: mission.id,
      spendingLimit: mission.spendingLimit,
      scopes: mission.scope,
    });

    const authToken: AuthToken = {
      token: jwt,
      tokenId,
      agentId,
      missionId: mission.id,
      kyaPay: kyaPayClaims,
      issuedAt: new Date(now * 1000).toISOString(),
      expiresAt,
    };

    return authToken;
  }

  // ── Revoke Token ───────────────────────────────────────────────

  revokeToken(tokenId: string): boolean {
    const entry = this.activeTokens.get(tokenId);
    if (!entry) {
      log(`⚠ Token ${tokenId} not found — may already be revoked`);
      return false;
    }

    entry.revokedAt = new Date().toISOString();
    log(`🔒 Token ${BOLD}revoked${RESET}: ${DIM}${tokenId}${RESET}`);

    this.audit('token_revoked', entry.agentId, { tokenId });
    return true;
  }

  // ── Audit Log ──────────────────────────────────────────────────

  getAuditLog(agentId?: string): AuditEntry[] {
    if (agentId) {
      return this.auditLog.filter((e) => e.agentId === agentId);
    }
    return [...this.auditLog];
  }

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

  // ── Internal ───────────────────────────────────────────────────

  private audit(action: string, agentId: string, details: Record<string, unknown>) {
    this.auditLog.push({
      timestamp: new Date().toISOString(),
      action,
      agentId,
      details,
    });
  }
}
