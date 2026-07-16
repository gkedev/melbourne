#!/usr/bin/env node
// ============================================================================
// Court Ready MCP Server — Entry Point
// ============================================================================
//
// Starts the MCP server on stdio transport.
//
// Usage:
//   npx tsx src/server/index.ts          # Start the MCP server
//   npx tsx src/agent/index.ts           # Run the demo flow instead
// ============================================================================

import { startServer } from './mcp-server.js';

console.error('🎾 Court Ready Tennis Shop — MCP Server');
console.error('   AAuth + Keycard + KYA-PAY enabled');
console.error('');

startServer().catch((err) => {
  console.error('Failed to start MCP server:', err);
  process.exit(1);
});
