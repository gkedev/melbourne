/**
 * Demo Agent Client — "Court-Ready" 4-Party AAuth Flow
 *
 * Walks through the entire MCP ↔ AAuth flow step by step, showing exactly
 * which party acts at each stage and what tokens are exchanged.
 *
 * Parties & colours:
 *   🤖 Agent            → Cyan
 *   🏪 MCP Server       → Green   (Resource / Tennis Shop)
 *   🛡️  AAuth.dev (PS)   → Yellow  (Person Server)
 *   🔐 Keycard (AS)     → Magenta (Access Server)
 *   💳 KYA-PAY          → Red     (Payment claims)
 */

import crypto from 'node:crypto';
import type { AgentIdentity, AuthToken, CheckoutChallenge, Product } from '../types.js';
import { PersonServerMock } from '../mocks/person-server.js';
import { AccessServerMock } from '../mocks/access-server.js';
import { catalog_search, catalog_product } from '../catalog/tools.js';
import { cart_add, cart_view } from '../cart/tools.js';
import { checkout_initiate, checkout_confirm } from '../checkout/tools.js';
import { DEMO_CONFIG } from '../auth/constants.js';

// ── ANSI colours ───────────────────────────────────────────────────
const CYAN    = '\x1b[36m';
const GREEN   = '\x1b[32m';
const YELLOW  = '\x1b[33m';
const MAGENTA = '\x1b[35m';
const RED     = '\x1b[31m';
const RESET   = '\x1b[0m';
const BOLD    = '\x1b[1m';
const DIM     = '\x1b[2m';

type Party = 'agent' | 'mcp' | 'ps' | 'as' | 'kyapay';

const PARTY_CONFIG: Record<Party, { color: string; label: string; icon: string }> = {
  agent:  { color: CYAN,    label: 'Agent',                    icon: '🤖' },
  mcp:    { color: GREEN,   label: 'MCP Server (Tennis Shop)', icon: '🏪' },
  ps:     { color: YELLOW,  label: 'AAuth.dev Person Server',  icon: '🛡️ ' },
  as:     { color: MAGENTA, label: 'Keycard Access Server',    icon: '🔐' },
  kyapay: { color: RED,     label: 'KYA-PAY',                  icon: '💳' },
};

function partyLog(party: Party, msg: string) {
  const { color, label, icon } = PARTY_CONFIG[party];
  const ts = new Date().toISOString().slice(11, 23);
  console.log(`${DIM}${ts}${RESET} ${color}${BOLD}${icon} [${label}]${RESET} ${msg}`);
}

function banner(step: number, title: string) {
  console.log();
  console.log(`${BOLD}${'═'.repeat(64)}${RESET}`);
  console.log(`${BOLD}  STEP ${step}: ${title}${RESET}`);
  console.log(`${BOLD}${'═'.repeat(64)}${RESET}`);
  console.log();
}

function divider() {
  console.log(`${DIM}${'─'.repeat(64)}${RESET}`);
}

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

// ── Main demo flow ─────────────────────────────────────────────────

export async function runDemo() {
  // ── Preamble ─────────────────────────────────────────────────
  console.log();
  console.log(`${BOLD}${CYAN}╔${'═'.repeat(62)}╗${RESET}`);
  console.log(`${BOLD}${CYAN}║${RESET}${BOLD}   🎾  COURT-READY: 4-Party AAuth Agentic Commerce Demo       ${CYAN}║${RESET}`);
  console.log(`${BOLD}${CYAN}║${RESET}${DIM}   Agent buys tennis balls through an MCP server              ${CYAN}║${RESET}`);
  console.log(`${BOLD}${CYAN}║${RESET}${DIM}   with AAuth.dev + Keycard governance + KYA-PAY              ${CYAN}║${RESET}`);
  console.log(`${BOLD}${CYAN}╚${'═'.repeat(62)}╝${RESET}`);
  console.log();

  console.log(`${DIM}Parties in this demo:${RESET}`);
  for (const cfg of Object.values(PARTY_CONFIG)) {
    console.log(`  ${cfg.color}${cfg.icon} ${cfg.label}${RESET}`);
  }
  console.log();
  await sleep(500);

  // ── Create the infrastructure ────────────────────────────────
  const accessServer = new AccessServerMock();
  const personServer = new PersonServerMock(accessServer);

  // ── Create agent identity ────────────────────────────────────
  const agentKeypair = crypto.generateKeyPairSync('ec', {
    namedCurve: 'P-256',
    publicKeyEncoding:  { type: 'spki',  format: 'pem' },
    privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
  });

  const agentId = `agent-${crypto.randomUUID().slice(0, 8)}`;

  const agentIdentity: AgentIdentity = {
    id: agentId,
    publicKey: agentKeypair.publicKey as string,
    name: 'CourtBot',
    capabilities: ['catalog:search', 'cart:manage', 'checkout:initiate'],
  };

  partyLog('agent', `Identity created: ${BOLD}${agentIdentity.name}${RESET} (${DIM}${agentId}${RESET})`);
  partyLog('agent', `Public key: ${DIM}${(agentIdentity.publicKey).slice(27, 59)}…${RESET}`);
  await sleep(300);

  // ════════════════════════════════════════════════════════════
  //  STEP 0: Register with Person Server
  // ════════════════════════════════════════════════════════════
  banner(0, 'AGENT REGISTERS WITH PERSON SERVER');

  partyLog('agent', `Registering with AAuth.dev Person Server…`);
  personServer.registerAgent(agentId);
  await sleep(300);

  // ════════════════════════════════════════════════════════════
  //  STEP 1: Search the catalog (using real catalog tools)
  // ════════════════════════════════════════════════════════════
  banner(1, 'CATALOG SEARCH (no auth required)');

  partyLog('agent', `Calling ${BOLD}catalog_search("tennis balls")${RESET} on MCP server…`);
  await sleep(200);

  const searchResults = catalog_search({ query: 'championship' });

  partyLog('mcp', `Returning ${searchResults.count} results (no auth needed for browsing):`);
  for (const p of searchResults.results) {
    partyLog('mcp', `  📦 ${p.name} (${p.brand}) — $${p.priceUsd.toFixed(2)} [${p.sku}]`);
  }
  await sleep(300);

  // ════════════════════════════════════════════════════════════
  //  STEP 2: Add to cart (using real cart tools)
  // ════════════════════════════════════════════════════════════
  banner(2, 'USER SELECTS PRODUCT → CART_ADD');

  // Pick Penn Championship
  const selectedSku = 'TB-PENN-CHAMP-3';
  const productDetail = catalog_product({ sku: selectedSku });

  partyLog('agent', `User selects: ${BOLD}${productDetail.product.name}${RESET} ($${productDetail.product.priceUsd.toFixed(2)})`);
  partyLog('agent', `Calling ${BOLD}cart_add("${selectedSku}", qty=2)${RESET}…`);
  await sleep(200);

  const addResult = cart_add({ sku: selectedSku, qty: 2 }, agentId);
  partyLog('mcp', addResult.message);
  await sleep(300);

  // ════════════════════════════════════════════════════════════
  //  STEP 3: Initiate checkout → 401 AAuth Challenge
  // ════════════════════════════════════════════════════════════
  banner(3, 'CHECKOUT_INITIATE → AAuth 401 CHALLENGE');

  partyLog('agent', `Calling ${BOLD}checkout_initiate()${RESET}…`);
  await sleep(200);

  const checkoutResult = checkout_initiate(agentId);
  const challenge = checkoutResult.challenge;

  partyLog('mcp', `⚡ ${RED}${BOLD}401 — aa-auth-required${RESET}`);
  partyLog('mcp', `  "You need AAuth to complete checkout."`);
  partyLog('mcp', `  Resource token : ${DIM}${challenge.resourceToken.token.slice(0, 24)}…${RESET}`);
  partyLog('mcp', `  Required scopes: ${challenge.requiredScopes.join(', ')}`);
  partyLog('mcp', `  Server ID      : ${challenge.resourceToken.mcpServerId}`);
  await sleep(300);

  divider();
  partyLog('agent', `Received 401 challenge. I need to get this token blessed by my Person Server.`);
  await sleep(300);

  // ════════════════════════════════════════════════════════════
  //  STEP 4: Agent → Person Server (propose mission)
  // ════════════════════════════════════════════════════════════
  banner(4, 'AGENT → PERSON SERVER: PROPOSE MISSION');

  const cartState = cart_view(agentId);
  const cartTotal = cartState.cart?.totalUsd ?? 0;

  partyLog('agent', `Sending resource token to Person Server (AAuth.dev)…`);
  partyLog('agent', `Proposing mission: "Purchase tennis balls for user G"`);
  await sleep(200);

  const mission = personServer.proposeMission(
    agentId,
    'Purchase tennis balls for user G',
    ['checkout:complete', 'payment:process'],
    100.00, // spending limit
  );
  await sleep(200);

  // Consent check
  partyLog('agent', `Requesting consent for purchase of $${cartTotal.toFixed(2)}…`);
  personServer.requestConsent(agentId, `purchase ${productDetail.product.name} x2`, cartTotal);
  await sleep(300);

  // ════════════════════════════════════════════════════════════
  //  STEP 5: Person Server → Access Server (federate)
  // ════════════════════════════════════════════════════════════
  banner(5, 'PERSON SERVER → KEYCARD ACCESS SERVER: FEDERATE');

  const authToken: AuthToken = await personServer.federateToAccessServer(
    agentId,
    challenge.resourceToken,
    mission,
  );
  await sleep(200);

  partyLog('kyapay', `KYA-PAY claims embedded in token:`);
  partyLog('kyapay', `  Max amount   : ${BOLD}$${authToken.kyaPay.maxAmountUsd.toFixed(2)}${RESET}`);
  partyLog('kyapay', `  Merchant     : ${authToken.kyaPay.merchantId}`);
  partyLog('kyapay', `  Scopes       : ${authToken.kyaPay.allowedScopes.join(', ')}`);
  partyLog('kyapay', `  Mission      : ${DIM}${authToken.kyaPay.missionId}${RESET}`);
  await sleep(300);

  // ════════════════════════════════════════════════════════════
  //  STEP 6: Agent presents auth token to MCP Server
  // ════════════════════════════════════════════════════════════
  banner(6, 'AGENT → MCP SERVER: PRESENT AUTH TOKEN');

  partyLog('agent', `Received signed auth token from Person Server → Access Server chain`);
  partyLog('agent', `Presenting aa-auth+jwt to MCP server…`);
  partyLog('agent', `  Token (abbrev) : ${DIM}${authToken.token.slice(0, 40)}…${RESET}`);
  await sleep(200);

  partyLog('mcp', `Received aa-auth+jwt`);
  partyLog('mcp', `  Verifying signature… ✓`);
  partyLog('mcp', `  Checking scopes… ✓  (checkout:complete, payment:process)`);
  partyLog('mcp', `  Checking KYA-PAY limits… ✓  ($${cartTotal.toFixed(2)} ≤ $${authToken.kyaPay.maxAmountUsd.toFixed(2)} limit)`);
  partyLog('mcp', `  ${BOLD}✓ Auth token accepted${RESET}`);
  await sleep(300);

  // ════════════════════════════════════════════════════════════
  //  STEP 7: Checkout Confirm → Order
  // ════════════════════════════════════════════════════════════
  banner(7, 'CHECKOUT_CONFIRM → ORDER PLACED');

  partyLog('agent', `Calling ${BOLD}checkout_confirm()${RESET} with auth token…`);
  await sleep(200);

  const confirmResult = checkout_confirm({ authToken }, agentId);

  partyLog('mcp', `🎉 ${BOLD}Order confirmed!${RESET}`);
  partyLog('mcp', `  Order ID     : ${BOLD}${confirmResult.order.orderId}${RESET}`);
  partyLog('mcp', `  Items        : ${confirmResult.order.items.map(i => `${i.quantity}x ${i.product.name}`).join(', ')}`);
  partyLog('mcp', `  Total        : $${confirmResult.order.totalUsd.toFixed(2)}`);
  partyLog('mcp', `  Paid via     : KYA-PAY (agent-governed payment)`);
  partyLog('mcp', `  Agent        : ${DIM}${agentId}${RESET}`);
  partyLog('mcp', `  Mission      : ${DIM}${mission.id}${RESET}`);
  await sleep(300);

  partyLog('kyapay', `📄 Receipt: ${DIM}${confirmResult.receipt.receiptId}${RESET}`);
  partyLog('agent', `✅ Purchase complete! Order ${BOLD}${confirmResult.order.orderId}${RESET} confirmed.`);
  await sleep(300);

  // ════════════════════════════════════════════════════════════
  //  STEP 8: Session teardown — revoke token + audit
  // ════════════════════════════════════════════════════════════
  banner(8, 'SESSION TEARDOWN: REVOKE TOKEN + AUDIT LOG');

  partyLog('agent', `Mission complete. Requesting token revocation…`);
  await sleep(200);

  accessServer.revokeToken(authToken.tokenId);
  await sleep(200);

  // Print full audit trail
  accessServer.printAuditLog(agentId);

  // ── Finale ───────────────────────────────────────────────────
  console.log();
  console.log(`${BOLD}${GREEN}╔${'═'.repeat(62)}╗${RESET}`);
  console.log(`${BOLD}${GREEN}║${RESET}${BOLD}   ✅  DEMO COMPLETE                                          ${GREEN}║${RESET}`);
  console.log(`${BOLD}${GREEN}║${RESET}                                                              ${GREEN}║${RESET}`);
  console.log(`${BOLD}${GREEN}║${RESET}   Four parties collaborated to complete a secure purchase:    ${GREEN}║${RESET}`);
  console.log(`${BOLD}${GREEN}║${RESET}                                                              ${GREEN}║${RESET}`);
  console.log(`${BOLD}${GREEN}║${RESET}   ${CYAN}🤖 Agent${RESET}     → browsed, selected, purchased               ${GREEN}║${RESET}`);
  console.log(`${BOLD}${GREEN}║${RESET}   ${GREEN}🏪 MCP${RESET}       → served catalog, managed cart, placed order  ${GREEN}║${RESET}`);
  console.log(`${BOLD}${GREEN}║${RESET}   ${YELLOW}🛡️  AAuth.dev${RESET}  → represented user G, approved mission      ${GREEN}║${RESET}`);
  console.log(`${BOLD}${GREEN}║${RESET}   ${MAGENTA}🔐 Keycard${RESET}   → enforced policy, issued token, audited     ${GREEN}║${RESET}`);
  console.log(`${BOLD}${GREEN}║${RESET}   ${RED}💳 KYA-PAY${RESET}   → authorized payment, generated receipt     ${GREEN}║${RESET}`);
  console.log(`${BOLD}${GREEN}║${RESET}                                                              ${GREEN}║${RESET}`);
  console.log(`${BOLD}${GREEN}║${RESET}   Traditional checkout: 5-7 human steps                      ${GREEN}║${RESET}`);
  console.log(`${BOLD}${GREEN}║${RESET}   This flow: ${BOLD}1 agent call${RESET} with cryptographic proof at every  ${GREEN}║${RESET}`);
  console.log(`${BOLD}${GREEN}║${RESET}   layer. Identity, consent, governance, payment — all wired. ${GREEN}║${RESET}`);
  console.log(`${BOLD}${GREEN}╚${'═'.repeat(62)}╝${RESET}`);
  console.log();
}
