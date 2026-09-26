#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

function object(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function install() {
  if (Number(process.versions.node.split(".")[0]) < 20) throw new Error("Node >= 20 is required.");
  const addon = fs.realpathSync(path.resolve(path.dirname(fileURLToPath(import.meta.url)), ".."));
  const target = fs.realpathSync(path.resolve(process.argv[2] ?? addon));
  if (!fs.statSync(target).isDirectory()) throw new Error("Target workspace must be a directory.");
  const self = target === addon;
  const server = path.join(addon, "src/mcp/server.ts");
  const loader = fileURLToPath(import.meta.resolve("tsx/esm"));
  const sourceSkill = path.join(addon, ".bob/skills/archpulse/SKILL.md");
  for (const file of [path.join(addon, "package.json"), server, loader, sourceSkill]) {
    if (!fs.statSync(file).isFile()) throw new Error(`Required installation file is missing: ${file}`);
  }
  // Read and validate everything before modifying the target.
  const skill = fs.readFileSync(sourceSkill);
  const mcpPath = path.join(target, ".bob/mcp.json");
  const existing = fs.existsSync(mcpPath) ? JSON.parse(fs.readFileSync(mcpPath, "utf8")) : {};
  if (!object(existing) || (existing.mcpServers !== undefined && !object(existing.mcpServers))) {
    throw new Error("Existing MCP configuration and mcpServers must be JSON objects.");
  }
  const entry = {
    type: "stdio", command: "node",
    args: self ? ["--import", "tsx/esm", "src/mcp/server.ts"] : ["--import", pathToFileURL(loader).href, server],
    env: { ARCHPULSE_ROOT: self ? "${workspaceFolder}" : target },
  };
  const targetSkill = path.join(target, ".bob/skills/archpulse/SKILL.md");
  let copySkill = !self;
  if (fs.existsSync(targetSkill) && fs.realpathSync(targetSkill) === fs.realpathSync(sourceSkill)) copySkill = false;
  if (copySkill) {
    fs.mkdirSync(path.dirname(targetSkill), { recursive: true });
    fs.writeFileSync(targetSkill, skill);
  }
  const content = JSON.stringify({ ...existing, mcpServers: { ...existing.mcpServers, archpulse: entry } }, null, 2) + "\n";
  fs.mkdirSync(path.dirname(mcpPath), { recursive: true });
  if (!fs.existsSync(mcpPath) || fs.readFileSync(mcpPath, "utf8") !== content) fs.writeFileSync(mcpPath, content);
  console.log(`ArchPulse installed in ${target}. ${copySkill ? "Skill copied." : "Skipping skill copy: same source."}`);
  console.log("Reload Bob IDE to load the MCP server.");
}

try { install(); }
catch (error) { console.error(`Installation failed: ${error.message}`); process.exitCode = 1; }
