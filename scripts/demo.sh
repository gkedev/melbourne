#!/usr/bin/env bash
# ============================================================================
# Court Ready — Run the 4-Party AAuth Demo
# ============================================================================
#
# This script runs the full demo flow showing how an AI agent purchases
# tennis balls through an MCP server with AAuth + Keycard + KYA-PAY.
#
# Usage:
#   ./scripts/demo.sh
#   npm run demo
# ============================================================================

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"

cd "$PROJECT_DIR"

echo ""
echo "  🎾 Court Ready — 4-Party Agentic Commerce Demo"
echo "  ================================================"
echo ""
echo "  Parties:"
echo "    🤖 Agent          — AI shopping bot"
echo "    🏪 MCP Server     — Court Ready Tennis Shop (Resource)"
echo "    🛡️  AAuth.dev      — Person Server (represents the user)"
echo "    🔐 Keycard        — Access Server (agent governance)"
echo "    💳 KYA-PAY        — Payment authorization"
echo ""
echo "  Starting demo..."
echo ""

npx tsx src/agent/index.ts
