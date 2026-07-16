#!/usr/bin/env node
// ============================================================================
// Court Ready — Demo Agent Entry Point
// ============================================================================
//
// Runs the full 4-party AAuth commerce flow end-to-end:
//
//   Agent → MCP Server → AAuth.dev (PS) → Keycard (AS) → back to MCP Server
//
// Usage:
//   npx tsx src/agent/index.ts
//   npm run demo
// ============================================================================

import { runDemo } from './demo-client.js';

runDemo().catch((err) => {
  console.error('\n❌ Demo failed:', err);
  process.exit(1);
});
