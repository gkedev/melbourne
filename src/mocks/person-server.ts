/**
 * Mock AAuth.dev Person Server
 *
 * In the real AAuth protocol the Person Server is the user's personal
 * governance proxy. It:
 *   - Holds the user's identity
 *   - Approves/scopes agent missions
 *   - Federates resource tokens to the Access Server (Keycard)
 *   - Gates high-value actions behind consent prompts
 *
 * This mock auto-approves everything (it's a demo!) but logs every step
 * with clear role labels so the audience can follow the flow.
 */

import type { AuthToken, Mission, ResourceToken } from '../types.js';
import { AccessServerMock } from './access-server.js';
import { DEMO_CONFIG } from '../auth/constants.js';

// ── Colours ────────────────────────────────────────────────────────
const YELLOW = '\x1b[33m';
const RESET  = '\x1b[0m';
const BOLD   = '\x1b[1m';
const DIM    = '\x1b[2m';

function log(msg: string) {
  const ts = new Date().toISOString().slice(11, 23);
  console.log(`${DIM}${ts}${RESET} ${YELLOW}${BOLD}🛡️  [AAuth.dev Person Server]${RESET} ${msg}`);
}

// ── Mock state ─────────────────────────────────────────────────────
interface RegisteredAgent {
  agentId: string;
  representingUser: string;
  registeredAt: Date;
}

let missionCounter = 0;

export class PersonServerMock {
  private agents: Map<string, RegisteredAgent> = new Map();
  private accessServer: AccessServerMock;

  constructor(accessServer: AccessServerMock) {
    this.accessServer = accessServer;
  }

  // ── 1. Register Agent ──────────────────────────────────────────

  registerAgent(agentId: string): RegisteredAgent {
    log(`Registering agent ${DIM}${agentId.slice(0, 16)}…${RESET} as representative of user ${BOLD}"G"${RESET}`);

    const entry: RegisteredAgent = {
      agentId,
      representingUser: 'G',
      registeredAt: new Date(),
    };
    this.agents.set(agentId, entry);

    log(`✓ Agent registered — authorised to act on behalf of user G`);
    return entry;
  }

  // ── 2. Propose Mission ─────────────────────────────────────────

  proposeMission(
    agentId: string,
    description: string,
    scope: string[],
    spendingLimit: number,
  ): Mission {
    const agent = this.agents.get(agentId);
    if (!agent) throw new Error(`Agent ${agentId} not registered`);

    missionCounter++;
    const missionId = `mission-${missionCounter}-${Date.now().toString(36)}`;

    log(`Agent proposes mission: "${description}"`);
    log(`  Scope requested : ${scope.join(', ')}`);
    log(`  Spending limit  : $${spendingLimit.toFixed(2)}`);

    // In production this would require user approval — auto-approve for demo
    log(`✓ Mission ${BOLD}approved${RESET} by user G  (id: ${DIM}${missionId}${RESET})`);

    const mission: Mission = {
      id: missionId,
      agentId,
      description,
      scope,
      spendingLimit,
      status: 'approved',
      createdAt: new Date().toISOString(),
    };
    return mission;
  }

  // ── 3. Federate to Access Server ───────────────────────────────

  async federateToAccessServer(
    agentId: string,
    resourceToken: ResourceToken,
    mission: Mission,
  ): Promise<AuthToken> {
    const agent = this.agents.get(agentId);
    if (!agent) throw new Error(`Agent ${agentId} not registered`);

    log(`Federating resource token to ${BOLD}Keycard Access Server${RESET}`);
    log(`  Resource token : ${DIM}${resourceToken.token.slice(0, 24)}…${RESET}`);
    log(`  Mission        : ${mission.description}`);
    log(`  Target AS      : ${DEMO_CONFIG.accessServer.url}`);

    const authToken = await this.accessServer.issueAuthToken(
      agentId,
      resourceToken,
      mission,
      DEMO_CONFIG.personServer.url,
    );

    log(`✓ Received auth token from Access Server`);
    log(`  Token (abbrev)  : ${DIM}${authToken.token.slice(0, 32)}…${RESET}`);
    log(`  Expires         : ${authToken.expiresAt}`);

    return authToken;
  }

  // ── 4. Request Consent ─────────────────────────────────────────

  requestConsent(agentId: string, action: string, amount?: number): boolean {
    const agent = this.agents.get(agentId);
    if (!agent) throw new Error(`Agent ${agentId} not registered`);

    const amountStr = amount != null ? ` for $${amount.toFixed(2)}` : '';
    log(`🔔 Consent request from agent:`);
    log(`  Action : ${action}${amountStr}`);

    // Auto-approve for demo
    log(`✓ ${BOLD}User G approved${RESET}: ${action}${amountStr}`);
    return true;
  }
}
