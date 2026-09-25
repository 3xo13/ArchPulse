#!/usr/bin/env node
/**
 * scripts/install-bob-addon.js
 *
 * Installs the ArchPulse Bob add-on into a target workspace's .bob/ directory.
 *
 * What it does:
 *   1. Locates (or creates) .bob/mcp.json in the target workspace.
 *   2. MERGES the "archpulse" server entry — never overwrites other servers.
 *   3. Copies .bob/skills/archpulse/SKILL.md to the target workspace.
 *   4. Prints a confirmation with next steps.
 *
 * Usage:
 *   node scripts/install-bob-addon.js [target-workspace-path]
 *
 *   target-workspace-path defaults to the current working directory.
 *
 * Examples:
 *   node scripts/install-bob-addon.js
 *   node scripts/install-bob-addon.js /path/to/my-project
 *   node scripts/install-bob-addon.js .
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync, cpSync } from "node:fs";
import { resolve, join, relative } from "node:path";
import { fileURLToPath } from "node:url";

// ---------------------------------------------------------------------------
// Paths
// ---------------------------------------------------------------------------

const __dirname = fileURLToPath(new URL(".", import.meta.url));
const ADDON_ROOT = resolve(__dirname, ".."); // root of this archpulse repo

// Where the MCP server is launched from — always the archpulse repo root
const SERVER_ENTRY = join(ADDON_ROOT, "src", "mcp", "server.ts");

// The MCP server entry we want to inject
const ARCHPULSE_SERVER_ENTRY = {
  type: "stdio",
  command: "node",
  args: [
    "--import",
    "tsx/esm",
    SERVER_ENTRY.replace(/\\/g, "/"), // normalize for cross-platform config
  ],
  env: {
    ARCHPULSE_ROOT: "${workspaceFolder}",
  },
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Read and parse a JSON file. Returns null if the file does not exist. */
function readJson(filePath) {
  if (!existsSync(filePath)) return null;
  try {
    return JSON.parse(readFileSync(filePath, "utf8"));
  } catch (err) {
    console.error(`  ✗ Failed to parse ${filePath}: ${err.message}`);
    console.error("    Fix or remove the file and re-run the installer.");
    process.exit(1);
  }
}

/** Write a JSON file with 2-space indentation. */
function writeJson(filePath, data) {
  writeFileSync(filePath, JSON.stringify(data, null, 2) + "\n", "utf8");
}

/** Ensure a directory exists (mkdir -p). */
function ensureDir(dirPath) {
  mkdirSync(dirPath, { recursive: true });
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

const targetWorkspace = resolve(process.argv[2] ?? process.cwd());

if (!existsSync(targetWorkspace)) {
  console.error(`✗ Target workspace not found: ${targetWorkspace}`);
  process.exit(1);
}

console.log(`\nArchPulse — Bob Add-on Installer`);
console.log(`${"─".repeat(48)}`);
console.log(`  Add-on root  : ${ADDON_ROOT}`);
console.log(`  Target       : ${targetWorkspace}`);
console.log();

// ---------------------------------------------------------------------------
// Step 1: Merge .bob/mcp.json
// ---------------------------------------------------------------------------

const bobDir = join(targetWorkspace, ".bob");
const mcpJsonPath = join(bobDir, "mcp.json");

ensureDir(bobDir);

const existing = readJson(mcpJsonPath) ?? {};
const mcpServers = existing.mcpServers ?? {};

const alreadyInstalled =
  mcpServers.archpulse !== undefined &&
  JSON.stringify(mcpServers.archpulse) === JSON.stringify(ARCHPULSE_SERVER_ENTRY);

if (alreadyInstalled) {
  console.log(`  ✓ mcp.json   : archpulse entry already up to date — no changes made`);
} else {
  const wasPresent = mcpServers.archpulse !== undefined;

  const updated = {
    ...existing,
    mcpServers: {
      ...mcpServers,
      archpulse: ARCHPULSE_SERVER_ENTRY,
    },
  };

  writeJson(mcpJsonPath, updated);

  const otherServers = Object.keys(mcpServers).filter((k) => k !== "archpulse");
  if (wasPresent) {
    console.log(`  ✓ mcp.json   : archpulse entry updated (${otherServers.length} other server(s) preserved)`);
  } else {
    console.log(`  ✓ mcp.json   : archpulse entry added (${otherServers.length} other server(s) preserved)`);
  }
}

// ---------------------------------------------------------------------------
// Step 2: Copy skill file
// ---------------------------------------------------------------------------

const sourceSkillDir = join(ADDON_ROOT, ".bob", "skills", "archpulse");
const targetSkillDir = join(bobDir, "skills", "archpulse");

ensureDir(targetSkillDir);

cpSync(sourceSkillDir, targetSkillDir, { recursive: true });

const relSkillPath = relative(targetWorkspace, join(targetSkillDir, "SKILL.md"));
console.log(`  ✓ Skill      : ${relSkillPath} copied`);

// ---------------------------------------------------------------------------
// Step 3: Print next steps
// ---------------------------------------------------------------------------

console.log();
console.log(`  Installation complete.`);
console.log();
console.log(`  Next steps:`);
console.log(`    1. Reload Bob IDE (or restart the window) to pick up the new MCP server.`);
console.log(`    2. Confirm the "archpulse" server appears in Bob's MCP tool list.`);
console.log(`    3. Ask Bob: "Use the ArchPulse skill. Call scan_repository for this workspace."`);
console.log();
console.log(`  To uninstall, remove the "archpulse" key from:`);
console.log(`    ${mcpJsonPath}`);
console.log(`  and delete:`);
console.log(`    ${targetSkillDir}`);
console.log();
