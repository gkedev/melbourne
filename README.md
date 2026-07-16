# 🎾 Court Ready — 4-Party Agentic Commerce Demo

**An AI agent buys tennis balls through an MCP server with AAuth identity, Keycard governance, and KYA-PAY payment authorization.**

This demo shows how four emerging standards work together to enable secure, autonomous AI agent commerce — no checkout forms, no redirects, one agent call with cryptographic proof at every layer.

## The Four Parties

| Party | Role | What It Does |
|-------|------|--------------|
| 🤖 **Agent** | AI Shopping Bot | Browses catalog, selects products, proposes missions, completes purchase |
| 🏪 **MCP Server** | Resource (Tennis Shop) | Exposes catalog/cart/checkout as MCP tools, issues AAuth challenges |
| 🛡️ **AAuth.dev** | Person Server | Represents the user, approves missions, federates to Access Server |
| 🔐 **Keycard** | Access Server | Agent governance control plane, enforces policy, issues auth tokens |
| 💳 **KYA-PAY** | Payment Layer | Payment authorization claims embedded in auth tokens |

## The Flow

```
Step 1: Agent → MCP Server
         Agent signs catalog_search request
         MCP Server returns product results (no auth needed for browsing)

Step 2: Agent → MCP Server
         Agent calls cart_add → adds Penn Championship tennis balls

Step 3: Agent → MCP Server
         Agent calls checkout_initiate
         MCP Server returns 401 + resource token (AAuth challenge)
         "Present this to your Person Server to get authorized"

Step 4: Agent → AAuth.dev (Person Server)
         Agent proposes mission: "Purchase tennis balls for user G"
         Person Server approves mission, requests user consent
         User G approves the purchase

Step 5: AAuth.dev → Keycard (Access Server)
         Person Server federates the resource token to Keycard
         Keycard enforces governance policy (spending limits, scopes)
         Keycard embeds KYA-PAY claims and signs an aa-auth+jwt

Step 6: Agent → MCP Server (retry with auth)
         Agent presents the signed aa-auth+jwt
         MCP Server verifies signature, scopes, and KYA-PAY limits

Step 7: MCP Server confirms order
         KYA-PAY validates payment authorization
         Order placed, receipt generated

Step 8: Teardown
         Keycard revokes the ephemeral token
         Audit trail logged
```

## Architecture

```
┌──────────┐     ┌──────────────┐     ┌───────────────┐     ┌──────────┐
│   USER   │────▶│   KEYCARD    │────▶│    AGENT      │────▶│ MCP      │
│  (G)     │     │  (Access     │     │ (AAuth ident) │     │ SERVER   │
│          │     │   Server)    │     │               │     │ (store)  │
│ KYC'd    │     │ • Policy     │     │ • Browse      │     │          │
│ human    │     │ • Governance │     │ • Select      │     │ • Tools  │
│ identity │     │ • Audit      │     │ • Pay (KYA)   │     │ • Cart   │
└──────────┘     └──────────────┘     └───────┬───────┘     │ • Checkout│
                                              │             └─────┬────┘
                       ┌──────────────────────┘                   │
                       │                                          │
                  ┌────▼────┐                                     │
                  │ AAuth   │     ┌───────────────────────────────┘
                  │ Person  │     │
                  │ Server  │─────┘
                  │         │  (federates resource token
                  └─────────┘   to Access Server)
```

## Quick Start

```bash
# Install dependencies
npm install

# Run the full 4-party demo
npm run demo

# Or directly
npx tsx src/agent/index.ts

# Start the MCP server (stdio transport)
npm start
```

## Project Structure

```
court-ready/
├── src/
│   ├── types.ts                    # Shared type definitions
│   ├── agent/
│   │   ├── index.ts                # Demo entry point
│   │   └── demo-client.ts          # Full 4-party flow walkthrough
│   ├── auth/
│   │   ├── aauth-middleware.ts     # AAuth verification for MCP server
│   │   └── constants.ts            # Demo URLs, scopes, JWT config
│   ├── catalog/
│   │   ├── data.ts                 # Tennis ball catalog (12 products)
│   │   └── tools.ts                # catalog_search, catalog_product
│   ├── cart/
│   │   └── tools.ts                # cart_add, cart_view, cart_remove
│   ├── checkout/
│   │   ├── tools.ts                # checkout_initiate, checkout_confirm
│   │   └── kyapay-validator.ts     # KYA-PAY payment validation
│   ├── mocks/
│   │   ├── person-server.ts        # Mock AAuth.dev Person Server
│   │   └── access-server.ts        # Mock Keycard Access Server
│   └── server/
│       ├── index.ts                # MCP server entry point
│       └── mcp-server.ts           # MCP tool registration
├── scripts/
│   └── demo.sh                     # Demo runner script
├── package.json
├── tsconfig.json
└── README.md
```

## MCP Tools

| Tool | Auth Required | Description |
|------|--------------|-------------|
| `catalog_search` | No | Search tennis balls by query, price, stock |
| `catalog_product` | No | Get details for a single SKU |
| `cart_add` | AAuth | Add product to cart |
| `cart_view` | AAuth | View current cart |
| `cart_remove` | AAuth | Remove item from cart |
| `checkout_initiate` | AAuth | Start checkout → returns 401 challenge |
| `checkout_confirm` | AAuth + KYA-PAY | Complete purchase with payment authorization |

## Key Concepts

### AAuth Federated (4-Party) Flow
Based on the [AAuth Protocol](https://www.aauth.dev/) by Dick Hardt (author of OAuth 2.0). The MCP server issues a resource token with `aud=Access Server URL`. The agent doesn't need to know about the Access Server in advance — the Person Server handles the federation.

### Keycard Agent Governance
[Keycard](https://keycard.dev/) provides the control plane. Ephemeral, cryptographically-signed tokens bound to specific agent runtimes, scoped to tasks with time limits, and immediately revocable. Every action is attributable via tamper-resistant audit trails.

### KYA-PAY (Know Your Agent Pay)
[KYA-PAY](https://kyapay.org/) is the payment layer. Payment authorization claims ride inside the AAuth auth token — identity verification and payment authorization collapse into a single JWT handshake.

### MCP (Model Context Protocol)
The ecommerce storefront is agent-native: tools, not web pages. Any agent framework that speaks MCP can plug in.

## The Killer Slide

> Traditional ecommerce checkout: **5-7 human steps** (browse → add to cart → enter shipping → enter payment → review → confirm)
>
> This flow: **1 agent call** with cryptographic proof at every layer. Identity, consent, governance, payment — all wired.

## License

MIT
