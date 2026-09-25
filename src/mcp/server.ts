#!/usr/bin/env node
/**
 * src/mcp/server.ts
 *
 * ArchPulse local STDIO MCP server.
 * Registers the three Bob-callable tools:
 *   - scan_repository  (implemented by Owner B in feature/scanner-mcp)
 *   - get_case         (implemented by Owner C in feature/grouping-cases)
 *   - verify_case      (implemented by Owner E in feature/verifier)
 *
 * Each tool handler delegates to a core function imported from src/core/.
 * The stubs below return { status: "not_implemented" } until the real
 * handlers are wired in by their respective owners.
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";

// ---------------------------------------------------------------------------
// Tool handler imports
// Each owner replaces the matching stub import with their real implementation.
// ---------------------------------------------------------------------------

// Owner B — replace with: import { scanRepository } from "../core/scanner.js"
async function scanRepository(args: { workspacePath?: string }): Promise<unknown> {
  return {
    status: "not_implemented",
    message: "scan_repository not yet wired — Owner B implements this in feature/scanner-mcp",
    args,
  };
}

// Owner C — replace with: import { getCase } from "../core/grouping.js"
async function getCase(args: { caseId: string }): Promise<unknown> {
  return {
    status: "not_implemented",
    message: "get_case not yet wired — Owner C implements this in feature/grouping-cases",
    args,
  };
}

// Owner E — replace with: import { verifyCase } from "../core/compare.js"
async function verifyCase(args: { caseId: string; baselineId: string }): Promise<unknown> {
  return {
    status: "not_implemented",
    message: "verify_case not yet wired — Owner E implements this in feature/verifier",
    args,
  };
}

// ---------------------------------------------------------------------------
// Server setup
// ---------------------------------------------------------------------------

const server = new McpServer({
  name: "archpulse",
  version: "0.1.0",
});

// ------------------------------------------------------------------
// scan_repository
// Runs the dependency-cruiser scan on the workspace, saves artifacts,
// and returns a short summary with violation count and case IDs.
// ------------------------------------------------------------------
server.tool(
  "scan_repository",
  "Scan the current workspace for architectural violations using dependency-cruiser. " +
    "Saves a full snapshot and graph to .archpulse/. " +
    "Returns a compact summary: violation count, case IDs, and artifact paths.",
  {
    workspacePath: z
      .string()
      .optional()
      .describe(
        "Absolute path to the workspace root. Defaults to the configured ARCHPULSE_ROOT " +
          "environment variable or the current working directory.",
      ),
  },
  async ({ workspacePath }) => {
    const result = await scanRepository({ workspacePath });
    return {
      content: [
        {
          type: "text" as const,
          text: JSON.stringify(result, null, 2),
        },
      ],
    };
  },
);

// ------------------------------------------------------------------
// get_case
// Returns a bounded case packet for one violation group.
// The packet contains the rule, offending edges, primary source files,
// relevant tests, and the expected end condition for the repair.
// ------------------------------------------------------------------
server.tool(
  "get_case",
  "Retrieve a bounded case packet for a specific violation group ID. " +
    "Returns rule details, offending file paths, relevant tests, and the repair stop condition. " +
    "Does not return the full snapshot — only the information needed to investigate this case.",
  {
    caseId: z
      .string()
      .describe('The case identifier, e.g. "case-001". Obtain from a prior scan_repository call.'),
  },
  async ({ caseId }) => {
    const result = await getCase({ caseId });
    return {
      content: [
        {
          type: "text" as const,
          text: JSON.stringify(result, null, 2),
        },
      ],
    };
  },
);

// ------------------------------------------------------------------
// verify_case
// Runs allowlisted tests + typecheck, re-scans with the same config,
// and compares the before/after snapshots for the targeted case.
// Returns resolved, persistent, and new violations plus test results.
// ------------------------------------------------------------------
server.tool(
  "verify_case",
  "Verify a repaired case by running allowlisted tests, TypeScript typecheck, and a same-config re-scan. " +
    "Compares the new snapshot against the saved baseline. " +
    "Returns test exit status, resolved violations, persistent violations, and any new violations introduced. " +
    "Do not report success without calling this tool.",
  {
    caseId: z
      .string()
      .describe("The case identifier to verify, e.g. \"case-001\"."),
    baselineId: z
      .string()
      .describe(
        "The git marker or snapshot ID of the pre-repair baseline to compare against. " +
          'Obtain from the scan_repository result, e.g. "baseline".',
      ),
  },
  async ({ caseId, baselineId }) => {
    const result = await verifyCase({ caseId, baselineId });
    return {
      content: [
        {
          type: "text" as const,
          text: JSON.stringify(result, null, 2),
        },
      ],
    };
  },
);

// ---------------------------------------------------------------------------
// Start — connect to Bob IDE via STDIO
// ---------------------------------------------------------------------------

const transport = new StdioServerTransport();
await server.connect(transport);
