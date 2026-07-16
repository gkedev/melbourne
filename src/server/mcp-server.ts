// ============================================================================
// Court Ready — MCP Server
// ============================================================================
//
// Model Context Protocol server for the Court Ready Tennis Shop.
// Exposes seven tools that an AI agent can call:
//
//   Catalog (no auth required):
//     - catalog_search  — Search tennis balls by query/price/stock
//     - catalog_product — Get details for a single SKU
//
//   Cart (requires AAuth):
//     - cart_add    — Add a product to the agent's cart
//     - cart_view   — View current cart
//     - cart_remove — Remove an item from the cart
//
//   Checkout (requires AAuth + KYA-PAY):
//     - checkout_initiate — Start checkout → returns 401 AAuth challenge
//     - checkout_confirm  — Confirm purchase with signed auth token
//
// ============================================================================

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';

// Tools
import { catalog_search, catalog_product } from '../catalog/tools.js';
import { cart_add, cart_view, cart_remove } from '../cart/tools.js';
import { checkout_initiate, checkout_confirm } from '../checkout/tools.js';

// ============================================================================
// Server Setup
// ============================================================================

export function createCourtReadyServer(): McpServer {
  const server = new McpServer({
    name: 'court-ready-tennis-shop',
    version: '0.1.0',
  });

  // ── Catalog Tools (no auth required) ─────────────────────────

  server.tool(
    'catalog_search',
    'Search the tennis ball catalog. Filter by query, max price, or minimum stock.',
    {
      query: z.string().optional().describe('Search by name, brand, or description'),
      maxPrice: z.number().optional().describe('Maximum price in USD'),
      minQuantity: z.number().optional().describe('Minimum stock quantity'),
    },
    async (args) => {
      try {
        const result = catalog_search(args);
        return {
          content: [{
            type: 'text' as const,
            text: JSON.stringify(result, null, 2),
          }],
        };
      } catch (err: any) {
        return {
          content: [{ type: 'text' as const, text: `Error: ${err.message}` }],
          isError: true,
        };
      }
    },
  );

  server.tool(
    'catalog_product',
    'Get full details for a single product by SKU.',
    {
      sku: z.string().describe('Product SKU (e.g. "TB-PENN-CHAMP-3")'),
    },
    async (args) => {
      try {
        const result = catalog_product(args);
        return {
          content: [{
            type: 'text' as const,
            text: JSON.stringify(result, null, 2),
          }],
        };
      } catch (err: any) {
        return {
          content: [{ type: 'text' as const, text: `Error: ${err.message}` }],
          isError: true,
        };
      }
    },
  );

  // ── Cart Tools ───────────────────────────────────────────────

  server.tool(
    'cart_add',
    'Add a product to your shopping cart.',
    {
      sku: z.string().describe('Product SKU to add'),
      qty: z.number().optional().default(1).describe('Quantity to add'),
    },
    async (args) => {
      try {
        // In a real implementation, agentId comes from AAuth verification
        const agentId = 'demo-agent';
        const result = cart_add(args, agentId);
        return {
          content: [{
            type: 'text' as const,
            text: JSON.stringify(result, null, 2),
          }],
        };
      } catch (err: any) {
        return {
          content: [{ type: 'text' as const, text: `Error: ${err.message}` }],
          isError: true,
        };
      }
    },
  );

  server.tool(
    'cart_view',
    'View your current shopping cart.',
    {},
    async () => {
      try {
        const agentId = 'demo-agent';
        const result = cart_view(agentId);
        return {
          content: [{
            type: 'text' as const,
            text: JSON.stringify(result, null, 2),
          }],
        };
      } catch (err: any) {
        return {
          content: [{ type: 'text' as const, text: `Error: ${err.message}` }],
          isError: true,
        };
      }
    },
  );

  server.tool(
    'cart_remove',
    'Remove a product from your cart by SKU.',
    {
      sku: z.string().describe('Product SKU to remove'),
    },
    async (args) => {
      try {
        const agentId = 'demo-agent';
        const result = cart_remove(args, agentId);
        return {
          content: [{
            type: 'text' as const,
            text: JSON.stringify(result, null, 2),
          }],
        };
      } catch (err: any) {
        return {
          content: [{ type: 'text' as const, text: `Error: ${err.message}` }],
          isError: true,
        };
      }
    },
  );

  // ── Checkout Tools ───────────────────────────────────────────

  server.tool(
    'checkout_initiate',
    'Start checkout. Returns an AAuth 401 challenge with a resource token.',
    {},
    async () => {
      try {
        const agentId = 'demo-agent';
        const result = checkout_initiate(agentId);
        return {
          content: [{
            type: 'text' as const,
            text: JSON.stringify(result, null, 2),
          }],
        };
      } catch (err: any) {
        return {
          content: [{ type: 'text' as const, text: `Error: ${err.message}` }],
          isError: true,
        };
      }
    },
  );

  server.tool(
    'checkout_confirm',
    'Confirm checkout with a signed AAuth auth token containing KYA-PAY claims.',
    {
      authTokenJson: z.string().describe('JSON-serialized AuthToken with KYA-PAY claims'),
    },
    async (args) => {
      try {
        const agentId = 'demo-agent';
        const authToken = JSON.parse(args.authTokenJson);
        const result = checkout_confirm({ authToken }, agentId);
        return {
          content: [{
            type: 'text' as const,
            text: JSON.stringify(result, null, 2),
          }],
        };
      } catch (err: any) {
        return {
          content: [{ type: 'text' as const, text: `Error: ${err.message}` }],
          isError: true,
        };
      }
    },
  );

  return server;
}

// ============================================================================
// Start server on stdio transport
// ============================================================================

export async function startServer(): Promise<void> {
  const server = createCourtReadyServer();
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error('[Court Ready MCP] Server started on stdio transport');
}
