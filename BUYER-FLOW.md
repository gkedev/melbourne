# 🎾 Buyer Agent Product Chooser — Two-Step Flow

## Overview

The buyer interacts with a **Buyer Agent** through a conversational/visual UI. The flow has two distinct phases:

1. **Surface Options** — Agent browses catalog, filters, and presents curated options to the buyer
2. **Execute for Best Price** — Buyer picks a product, agent hunts for the best deal and executes the purchase

This two-step model separates **discovery** (agent-assisted browsing) from **execution** (agent-autonomous purchasing with governance).

---

## Phase 1: Surface Options

### User Intent
Buyer says something like: *"I need a case of tennis balls for practice"*

### Agent Actions
```
Buyer: "I need tennis balls for practice, something affordable"
  ↓
Buyer Agent interprets intent:
  - Category: tennis balls
  - Use case: practice (not competition)
  - Price sensitivity: budget-conscious
  ↓
Agent calls MCP: catalog_search({ query: "tennis balls", maxPrice: 80 })
  ↓
Agent filters & ranks results by:
  - Relevance to use case (practice → pressureless or recreational balls)
  - Price per ball (value metric)
  - Reviews/ratings (if available)
  - Stock availability
  ↓
Agent presents TOP 3-5 OPTIONS to buyer
```

### UI: Option Cards

Each option card shows:
```
┌─────────────────────────────────────────────┐
│  🏷️  Penn Championship (3-Pack)              │
│  Brand: Penn  |  Category: Competition       │
│                                              │
│  💰 $3.99                                    │
│  📦 In stock (500+ available)                │
│  ⭐ Best value: $1.33/ball                   │
│                                              │
│  💡 Agent note: "Great all-rounder for       │
│     practice. Most popular choice."          │
│                                              │
│  [ Select This ]                             │
└─────────────────────────────────────────────┘
```

### Agent Intelligence in Option Surfacing
- **Price per unit calculation** (not just sticker price)
- **Use-case matching** (practice balls vs competition balls)
- **Smart recommendations** ("If you buy 2 cases, you save 15%")
- **Availability warnings** ("Only 3 left at this price")
- **Seller reputation scoring** (see below)

### Seller Reputation

When multiple sellers offer the same product (or comparable products), the agent evaluates seller reputation as a first-class signal alongside price:

```
┌─────────────────────────────────────────────┐
│  🏷️  Penn Championship (3-Pack)              │
│  Seller: CourtKing Sports  ⭐ 4.8 (1,200+)  │
│  🟢 Verified seller · 99.2% fulfillment     │
│                                              │
│  💰 $3.99  ·  📦 Ships 1-2 days             │
│  🛡️ Buyer protection via KYA-PAY             │
│                                              │
│  vs. also available from:                    │
│  TennisDirect ⭐ 4.2 (340) — $3.49 (-$0.50) │
│  NetServe Pro ⭐ 4.9 (2,100) — $4.29 (+$0.30)│
│                                              │
│  [ Select Best Value ]  [ Compare Sellers ]  │
└─────────────────────────────────────────────┘
```

**Reputation signals the agent considers:**
- **Rating** — aggregate buyer satisfaction (1-5 stars)
- **Volume** — number of verified transactions (trust through scale)
- **Fulfillment rate** — % of orders shipped on time
- **Return/dispute rate** — lower is better
- **Verified seller status** — identity verified via AAuth/Keycard chain
- **KYA-PAY history** — has the seller completed KYA-PAY transactions before?

**How reputation feeds into "Execute for Best Price":**
The agent doesn't just find the cheapest option — it finds the **best risk-adjusted price**:

```
Score = (1 / price_per_unit) × reputation_weight × fulfillment_rate

Where:
  reputation_weight = rating × log(transaction_count)
  fulfillment_rate = on_time_deliveries / total_orders
```

A $3.49 ball from a 4.2-star seller with 92% fulfillment might score LOWER than a $3.99 ball from a 4.8-star seller with 99.2% fulfillment. The agent explains why:

> "I found a cheaper option at TennisDirect ($3.49), but CourtKing Sports
> has significantly better fulfillment (99.2% vs 92%) and ratings (4.8 vs 4.2).
> Recommended: CourtKing at $3.99 — the $0.50 premium buys much better reliability."

**AAuth connection:** Seller reputation is verifiable because sellers have AAuth identities.
Their transaction history is attested through KYA-PAY receipts, creating a
cryptographically-backed reputation score — not just self-reported stars.

---

## Phase 2: Execute for Best Price

### User Action
Buyer selects an option → triggers the execution phase

### Agent Actions (autonomous, governed)
```
Buyer clicks "Select This" on Penn Championship
  ↓
Buyer Agent enters EXECUTION MODE:
  ↓
Step 1: Price + Reputation Optimization
  - Check current price vs historical (if available)
  - Look for bundle deals or quantity discounts
  - Check multiple sellers (if multi-merchant MCP)
  - Score sellers: price × reputation × fulfillment rate
  - Verify seller AAuth identity + KYA-PAY transaction history
  - Present FINAL recommendation with reasoning to buyer
  ↓
Step 2: Buyer Confirms
  "Penn Championship x2 @ $3.99 each = $7.98 from CourtKing Sports
   ⭐ 4.8 (1,200 sales) · 99.2% fulfillment · Verified seller
   Cheapest was $3.49 but 92% fulfillment — this is the better deal."
  [ ✅ Buy Now ]  [ 🔄 Change Seller ]  [ 🔄 Change Qty ]  [ ❌ Cancel ]
  ↓
Step 3: AAuth 4-Party Checkout (happens automatically)
  a. Agent proposes mission to Person Server (AAuth.dev)
  b. Person Server requests consent from buyer (this IS the confirm above)
  c. Person Server federates to Access Server (Keycard)
  d. Keycard enforces governance (spending limit, merchant whitelist)
  e. Auth token with KYA-PAY claims issued
  f. Agent presents token to MCP server
  g. Order confirmed
  ↓
Step 4: Confirmation
  "🎉 Order confirmed! ORD-ABC123 — 2x Penn Championship, $7.98"
  [📄 View Receipt]  [🛒 Shop More]
```

### Key UX Insight: Consent = Phase 2 Confirmation
The AAuth Person Server consent step **IS** the buyer's "Buy Now" click. 
We don't ask twice. The UI confirmation IS the Person Server approval.

---

## UI Layout — Revised Two-Panel Design

### Left Panel: Conversation + Options
```
┌──────────────────────────────────────────┐
│  💬 Chat with Buyer Agent                │
│                                          │
│  You: "I need practice tennis balls"     │
│                                          │
│  🤖 Agent: "Here are your best options   │
│  for practice tennis balls:"             │
│                                          │
│  ┌────────────────────────────────────┐  │
│  │ Option 1: Penn Championship       │  │
│  │ $3.99 · Best value · ⭐ Pick     │  │
│  │ [ Select ]                        │  │
│  ├────────────────────────────────────┤  │
│  │ Option 2: Wilson Championship     │  │
│  │ $4.49 · Premium feel             │  │
│  │ [ Select ]                        │  │
│  ├────────────────────────────────────┤  │
│  │ Option 3: Penn Pressureless 12pk  │  │
│  │ $19.99 · Best for practice       │  │
│  │ [ Select ]                        │  │
│  └────────────────────────────────────┘  │
│                                          │
│  [Type a message...]                     │
└──────────────────────────────────────────┘
```

### Right Panel: Flow Visualization (unchanged)
Shows the AAuth 4-party flow animating when buyer confirms purchase.

---

## Interaction States

### State 1: IDLE
- Chat input active
- No options displayed
- Flow panel shows "Waiting for a purchase to visualize the AAuth flow..."

### State 2: OPTIONS_SURFACED
- Agent has presented 3-5 options
- Each option has a "Select" button
- Buyer can ask follow-up questions ("which is best for clay courts?")
- Agent can refine options based on conversation

### State 3: SELECTED — PRICE_CONFIRMATION
- One option highlighted/expanded
- Quantity selector shown
- Final price displayed with breakdown
- "Buy Now" / "Cancel" buttons
- Agent may show price comparison or savings

### State 4: EXECUTING
- Buy Now clicked → consent given
- Flow panel animates the 4-party AAuth handshake
- Each step lights up in sequence
- UI shows progress indicator

### State 5: CONFIRMED
- Order confirmation card
- Receipt link
- "Shop More" resets to IDLE

---

## Technical Implementation

### Frontend Changes (public/index.html)
1. Add chat input panel on the left
2. Replace static product grid with agent-surfaced option cards
3. Add state machine for the 5 interaction states
4. Connect "Select" buttons to Phase 2 flow
5. Map "Buy Now" click to AAuth consent + checkout

### Backend Changes (MCP tools)
1. New tool: `catalog_recommend` — takes natural language intent, returns ranked options with agent reasoning
2. New tool: `price_optimize` — takes a SKU + quantity, checks for deals/bundles across sellers
3. New tool: `seller_reputation` — returns seller score, ratings, fulfillment rate, verified status, KYA-PAY history
4. New tool: `seller_compare` — compares multiple sellers for same product, returns risk-adjusted ranking
5. Existing tools unchanged: cart_add, checkout_initiate, checkout_confirm

### Agent Integration
- The "Buyer Agent" is an MCP client that interprets user intent
- In the demo, the agent logic can be simulated (pattern matching on input)
- In production, it would be a real LLM agent calling MCP tools

---

## The Two-Step Value Proposition

**Without agent (traditional e-commerce):**
1. Browse 50+ products
2. Read reviews
3. Compare prices manually
4. Add to cart
5. Enter shipping
6. Enter payment
7. Confirm

**With buyer agent (two-step):**
1. Tell agent what you need → get 3-5 curated options
2. Pick one → agent handles everything else

**7 steps → 2 steps. That's the pitch.**
