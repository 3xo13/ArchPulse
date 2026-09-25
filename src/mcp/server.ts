#!/usr/bin/env node
/**
 * ArchPulse — STDIO MCP server (Owner B)
 *
 * Registers three tools:
 *   scan_repository  — runs dependency-cruiser, saves artifacts, returns compact summary
 *   get_case         — stub (implemented by Owner C)
 *   verify_case      — stub (implemented by Owner E)
 *
 * Transport: STDIO (spawned by Bob IDE via .bob/mcp.json)
 *
 * IMPORTANT: All logging uses console.error — stdout is the MCP protocol channel.
 */

import * as fs from "node:fs";
import * as nodePath from "node:path";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod/v4";
import { runScan } from "../cli/scan.js";

// ─── Trusted workspace root ───────────────────────────────────────────────────
// Bob expands ${workspaceFolder} before spawning the server, so ARCHPULSE_ROOT
// is already a plain filesystem path — no variable expansion needed here.
const ARCHPULSE_ROOT: string = process.env.ARCHPULSE_ROOT ?? process.cwd();

// ─── Server setup ─────────────────────────────────────────────────────────────

const server = new McpServer({
  name: "archpulse",
  version: "0.1.0",
});

// ─── Tool: scan_repository ────────────────────────────────────────────────────

server.registerTool(
  "scan_repository",
  {
    description:
      "Run dependency-cruiser on the repository, save a full snapshot.json and graph.html to " +
      "disk, and return a compact violation summary. Use the returned snapshotPath as baselineId " +
      "for verify_case. Only paths within the configured workspace root are accepted.",
    inputSchema: z.object({
      workspacePath: z
        .string()
        .optional()
        .describe(
          "Absolute path to the repository root. Defaults to the server's working directory. " +
            "Must be within the trusted workspace; paths outside are rejected."
        ),
      outDir: z
        .string()
        .optional()
        .describe(
          "Directory (relative to workspacePath) where artifacts are written. " +
            "Defaults to .archpulse/latest"
        ),
    }),
  },
  async ({ workspacePath, outDir }) => {
    console.error(`[archpulse] scan_repository called — workspacePath: ${workspacePath ?? "(default)"}`);

    try {
      // Resolve workspacePath against ARCHPULSE_ROOT (handles relative inputs)
      const repoRoot = workspacePath
        ? nodePath.resolve(ARCHPULSE_ROOT, workspacePath)
        : ARCHPULSE_ROOT;
      validateWithinWorkspace(repoRoot, ARCHPULSE_ROOT);

      // Resolve and validate outDir
      const resolvedOutDir = outDir
        ? nodePath.resolve(repoRoot, outDir)
        : nodePath.join(repoRoot, ".archpulse", "latest");
      if (outDir) {
        validateWithinWorkspace(resolvedOutDir, ARCHPULSE_ROOT);
      }

      // Validate artifact paths before writing
      const snapshotPath = nodePath.join(resolvedOutDir, "snapshot.json");
      const graphPath = nodePath.join(resolvedOutDir, "graph.html");
      validateWithinWorkspace(snapshotPath, ARCHPULSE_ROOT);
      validateWithinWorkspace(graphPath, ARCHPULSE_ROOT);

      console.error(`[archpulse] scan_repository — root: ${repoRoot}, outDir: ${resolvedOutDir}`);

      const summary = await runScan({
        repoRoot,
        outDir: resolvedOutDir,
      });

      const lines: string[] = [
        `Scan complete — ${summary.violationCount} violation(s) found (${summary.errorCount} error, ${summary.warnCount} warn).`,
        `Git marker: ${summary.gitMarker}`,
        `Config hash: ${summary.configHash.slice(0, 12)}...`,
        `Snapshot saved to: ${summary.snapshotPath}`,
        `Dependency graph saved to: ${summary.graphPath}`,
        "",
      ];

      if (summary.violations.length === 0) {
        lines.push("No rule violations detected.");
      } else {
        lines.push(`Violations:`);
        const MAX_VIOLATIONS = 10;
        const shown = summary.violations.slice(0, MAX_VIOLATIONS);
        const remaining = summary.violations.length - shown.length;
        for (const v of shown) {
          lines.push(`  [${v.severity.toUpperCase()}] ${v.rule}`);
          lines.push(`    from: ${v.from}`);
          lines.push(`    to:   ${v.to}`);
          lines.push(`    id:   ${v.id}`);
        }
        if (remaining > 0) {
          lines.push(`  … and ${remaining} more violation(s) not shown.`);
        }
      }

      return {
        content: [{ type: "text" as const, text: lines.join("\n") }],
      };
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`[archpulse] scan_repository error: ${msg}`);
      return {
        content: [{ type: "text" as const, text: `scan_repository failed: ${msg}` }],
        isError: true,
      };
    }
  }
);

// ─── Tool: get_case ───────────────────────────────────────────────────────────

server.registerTool(
  "get_case",
  {
    description:
      "Return a bounded case packet (title, rule, violations, primary files, relevant tests, " +
      "test commands, and expected end condition) for a given case ID. " +
      "Implemented by Owner C — returns a stub until that workstream is merged.",
    inputSchema: z.object({
      caseId: z.string().describe("Case ID, e.g. 'case-001'"),
    }),
  },
  async ({ caseId }) => {
    console.error(`[archpulse] get_case called — caseId: ${caseId}`);
    // Stub: Owner C wires the real handler in src/core/grouping.ts + src/core/casePacket.ts
    return {
      content: [
        {
          type: "text" as const,
          text:
            `get_case for '${caseId}' is not yet implemented.\n` +
            "Owner C (grouping) will wire this tool. " +
            "Run 'npm run cases -- --snapshot .archpulse/latest/snapshot.json' to generate case packets.",
        },
      ],
      isError: true,
    };
  }
);

// ─── Tool: verify_case ────────────────────────────────────────────────────────

server.registerTool(
  "verify_case",
  {
    description:
      "Run configured test commands and a same-config re-scan, then compare the new snapshot " +
      "against the baseline to determine resolved, persistent, and new violations. " +
      "Implemented by Owner E — returns a stub until that workstream is merged. " +
      "SECURITY: test commands come only from config/architecture.json testCommands; " +
      "arbitrary shell strings from the model are never accepted.",
    inputSchema: z.object({
      caseId: z.string().describe("Case ID, e.g. 'case-001'"),
      baselineId: z
        .string()
        .describe(
          "The gitMarker or snapshotPath of the before-scan to compare against. " +
            "Use the snapshotPath returned by scan_repository."
        ),
    }),
  },
  async ({ caseId, baselineId }) => {
    console.error(`[archpulse] verify_case called — caseId: ${caseId}, baselineId: ${baselineId}`);
    // Stub: Owner E wires the real handler in src/core/compare.ts + src/core/runner.ts
    return {
      content: [
        {
          type: "text" as const,
          text:
            `verify_case for '${caseId}' (baseline: '${baselineId}') is not yet implemented.\n` +
            "Owner E (verifier) will wire this tool. " +
            "Run 'npm run compare -- --before <before-snapshot> --after <after-snapshot>' to compare manually.",
        },
      ],
      isError: true,
    };
  }
);

// ─── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Validate that `candidatePath` is within `trustedRoot`.
 *
 * Because `candidatePath` (e.g. outDir, artifact paths) may not exist yet,
 * we walk up to the nearest existing ancestor and resolve symlinks there.
 * This prevents symlink/junction traversal while still allowing new directories.
 *
 * On win32, cross-drive paths are also rejected.
 *
 * Throws a descriptive Error if validation fails.
 */
function validateWithinWorkspace(candidatePath: string, trustedRoot: string): void {
  // trustedRoot must already exist
  const realRoot = fs.realpathSync(trustedRoot);

  // Walk up candidatePath until we find an existing ancestor
  let ancestor = candidatePath;
  while (!fs.existsSync(ancestor)) {
    const parent = nodePath.dirname(ancestor);
    if (parent === ancestor) {
      // Reached filesystem root without finding an existing directory
      throw new Error(
        `Path '${candidatePath}' has no existing ancestor on the filesystem.`
      );
    }
    ancestor = parent;
  }
  const realAncestor = fs.realpathSync(ancestor);

  // On Windows, reject cross-drive paths
  if (process.platform === "win32") {
    const rootDrive = realRoot.slice(0, 2).toUpperCase();
    const ancestorDrive = realAncestor.slice(0, 2).toUpperCase();
    if (rootDrive !== ancestorDrive) {
      throw new Error(
        `Path '${candidatePath}' is on drive '${ancestorDrive}' which differs from ` +
          `the trusted workspace drive '${rootDrive}'. Cross-drive paths are not allowed.`
      );
    }
  }

  // Reject paths that escape the trusted root via relative traversal
  const rel = nodePath.relative(realRoot, realAncestor);
  if (rel.startsWith("..")) {
    throw new Error(
      `Path '${candidatePath}' resolves outside the trusted workspace root '${trustedRoot}'. ` +
        "Only paths within the workspace are accepted."
    );
  }
}

// ─── Entry ────────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("[archpulse] MCP server running on stdio");
}

main().catch((err: unknown) => {
  console.error("[archpulse] Fatal error:", err);
  process.exit(1);
});
