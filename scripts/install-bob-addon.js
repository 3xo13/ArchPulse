#!/usr/bin/env node
/**
 * install-bob-addon.js — ESM installer for the ArchPulse Bob add-on.
 *
 * Usage:
 *   node scripts/install-bob-addon.js              # self-install (portable)
 *   node scripts/install-bob-addon.js /path/to/ws  # external install (absolute paths)
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function fail(msg) {
  console.error(`\nERROR: ${msg}`);
  process.exit(1);
}

function readMcpJson(mcpPath) {
  if (!fs.existsSync(mcpPath)) return {};
  try {
    return JSON.parse(fs.readFileSync(mcpPath, "utf8"));
  } catch {
    fail(`Could not parse existing ${mcpPath} — fix or remove it before retrying.`);
  }
}

function writeMcpJson(mcpPath, data) {
  fs.mkdirSync(path.dirname(mcpPath), { recursive: true });
  fs.writeFileSync(mcpPath, JSON.stringify(data, null, 2) + "\n", "utf8");
}

// ---------------------------------------------------------------------------
// Prerequisite checks
// ---------------------------------------------------------------------------

const [nodeMajor] = process.versions.node.split(".").map(Number);
if (nodeMajor < 20) {
  fail(`Node ≥ 20 is required (found ${process.versions.node}).`);
}

// Determine ArchPulse root (this file lives at <root>/scripts/install-bob-addon.js)
const archpulseRoot = path.dirname(path.dirname(fileURLToPath(import.meta.url)));

// Verify ArchPulse package.json is readable
const archpulsePkgPath = path.join(archpulseRoot, "package.json");
if (!fs.existsSync(archpulsePkgPath)) {
  fail(`Cannot read ${archpulsePkgPath} — is the ArchPulse installation intact?`);
}

// ---------------------------------------------------------------------------
// Determine target workspace
// ---------------------------------------------------------------------------

const targetArg = process.argv[2];
const targetWorkspace = targetArg ? path.resolve(targetArg) : archpulseRoot;

if (!fs.existsSync(targetWorkspace)) {
  fail(`Target directory does not exist: ${targetWorkspace}`);
}

const isSelfInstall = targetWorkspace === archpulseRoot;

// ---------------------------------------------------------------------------
// Build the MCP entry
// ---------------------------------------------------------------------------

let mcpEntry;

if (isSelfInstall) {
  // Portable entry — uses relative/short paths and Bob's ${workspaceFolder} variable.
  // Bob expands ${workspaceFolder} before spawning the server process.
  console.log("Mode: self-install (portable, committable entry)");
  mcpEntry = {
    type: "stdio",
    command: "node",
    args: ["--import", "tsx/esm", "src/mcp/server.ts"],
    env: { ARCHPULSE_ROOT: "${workspaceFolder}" },
  };
} else {
  // External install — use absolute paths so the server launches correctly
  // regardless of the target workspace's working directory or installed packages.
  console.log(`Mode: external install → ${targetWorkspace}`);

  // Resolve tsx ESM loader by requiring it from within ArchPulse's node_modules.
  // The bare specifier "tsx/esm" resolves to the .mjs loader; we prefer that.
  let absLoaderPath;
  const candidates = [
    path.join(archpulseRoot, "node_modules", "tsx", "dist", "esm", "index.mjs"),
    path.join(archpulseRoot, "node_modules", "tsx", "dist", "esm", "index.cjs"),
  ];
  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) {
      absLoaderPath = candidate;
      break;
    }
  }
  if (!absLoaderPath) {
    fail(
      `tsx ESM loader not found in ArchPulse node_modules.\n` +
        `Expected one of:\n  ${candidates.join("\n  ")}\n` +
        `Run \`npm install\` in ${archpulseRoot} and retry.`
    );
  }

  const absServerPath = path.join(archpulseRoot, "src", "mcp", "server.ts");
  if (!fs.existsSync(absServerPath)) {
    fail(`Server entry not found: ${absServerPath}`);
  }

  mcpEntry = {
    type: "stdio",
    command: "node",
    args: ["--import", absLoaderPath, absServerPath],
    env: { ARCHPULSE_ROOT: targetWorkspace },
  };
}

// ---------------------------------------------------------------------------
// Merge archpulse key into target .bob/mcp.json
// ---------------------------------------------------------------------------

const targetBobDir = path.join(targetWorkspace, ".bob");
const targetMcpPath = path.join(targetBobDir, "mcp.json");

const existing = readMcpJson(targetMcpPath);
const merged = {
  ...existing,
  mcpServers: {
    ...(existing.mcpServers ?? {}),
    archpulse: mcpEntry,
  },
};

writeMcpJson(targetMcpPath, merged);
console.log(`✓ Wrote MCP entry to ${targetMcpPath}`);

// ---------------------------------------------------------------------------
// Copy skill file (skip when source and target resolve to the same path)
// ---------------------------------------------------------------------------

const sourceSkillDir = path.resolve(path.join(archpulseRoot, ".bob", "skills", "archpulse"));
const targetSkillDir = path.resolve(path.join(targetWorkspace, ".bob", "skills", "archpulse"));

if (sourceSkillDir === targetSkillDir) {
  console.log("✓ Skill directory is the same as source — skipping copy.");
} else {
  const sourceSkillFile = path.join(sourceSkillDir, "SKILL.md");
  if (!fs.existsSync(sourceSkillFile)) {
    fail(`Source skill file not found: ${sourceSkillFile}`);
  }
  fs.mkdirSync(targetSkillDir, { recursive: true });
  const targetSkillFile = path.join(targetSkillDir, "SKILL.md");
  fs.copyFileSync(sourceSkillFile, targetSkillFile);
  console.log(`✓ Copied SKILL.md to ${targetSkillFile}`);
}

console.log("\nArchPulse Bob add-on installed successfully.");
