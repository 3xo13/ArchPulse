/**
 * casePacket.ts — Owner C
 *
 * Pure case packet construction.  No I/O, no filesystem access.
 *
 * Takes a ViolationGroup (from grouping.ts) plus the loaded snapshot and
 * architecture config, and produces the CasePacket JSON and Markdown string.
 *
 * Types for Snapshot/Violation are the same minimal local aliases used in
 * grouping.ts.  Types for ArchitectureConfig mirror config/architecture.json
 * as documented in SCHEMA.md.  Both sets of types will be replaceable with
 * Owner B's shared types without changing this module's logic.
 */

import type { ViolationGroup, SnapshotInput, SnapshotViolation } from "./grouping.js";

// ---------------------------------------------------------------------------
// Architecture config types  (mirror config/architecture.json + SCHEMA.md)
// ---------------------------------------------------------------------------

export interface LayerDef {
  name: string;
  glob: string;
  description?: string;
}

export interface DependencyRule {
  from: string;
  to: string;
  reason: string;
}

export interface ArchitectureConfig {
  schemaVersion: string;
  layers: LayerDef[];
  allowedDependencies: DependencyRule[];
  forbiddenDependencies: DependencyRule[];
  testCommands: string[];
  scanScope?: string;
  scanExcludes?: string[];
}

// ---------------------------------------------------------------------------
// CasePacket type  (matches SCHEMA.md case-<id>.json contract exactly)
// ---------------------------------------------------------------------------

export interface CasePacket {
  caseId: string;
  scanId: string;
  title: string;
  rule: string;
  severity: "error" | "warn";
  violations: SnapshotViolation[];
  primaryFiles: string[];
  relevantTests: string[];
  testCommands: string[];
  ruleExplanation: string;
  expectedEndCondition: string;
}

// ---------------------------------------------------------------------------
// Size budget
// ---------------------------------------------------------------------------

/** Warn (to stderr) if the serialized JSON packet exceeds this threshold. */
const COMPACT_BUDGET_BYTES = 2048;

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/**
 * Finds the most common rule in the group (by violation count).
 * Stable tie-break: lex-first rule name.
 */
function dominantRule(violations: SnapshotViolation[]): string {
  const counts = new Map<string, number>();
  for (const v of violations) {
    counts.set(v.rule, (counts.get(v.rule) ?? 0) + 1);
  }
  let best = "";
  let bestCount = -1;
  for (const [rule, count] of counts) {
    if (count > bestCount || (count === bestCount && rule < best)) {
      best = rule;
      bestCount = count;
    }
  }
  return best;
}

/**
 * Picks the highest severity present in the group.
 * error > warn (info is not valid in a CasePacket per SCHEMA.md).
 */
function dominantSeverity(violations: SnapshotViolation[]): "error" | "warn" {
  for (const v of violations) {
    if (v.severity === "error") return "error";
  }
  return "warn";
}

/**
 * Returns the layer name for a given file path by matching against the
 * layer glob patterns in config.  Globs in architecture.json use the form
 * "demo/packages/<layer>/src/**" — we match by prefix segment rather than
 * full glob evaluation to avoid a dependency on a glob library.
 */
function layerForPath(path: string, layers: LayerDef[]): string | undefined {
  for (const layer of layers) {
    // Convert "demo/packages/ui/src/**" → prefix "demo/packages/ui/src/"
    const prefix = layer.glob.replace(/\/\*\*$/, "/");
    if (path.startsWith(prefix) || path.replace(/\\/g, "/").startsWith(prefix)) {
      return layer.name;
    }
  }
  return undefined;
}

/**
 * Generates a human-readable title for the case.
 * Pattern: "<FromLayer> layer → <ToLayer>: <rule>" or a fallback using paths.
 */
function buildTitle(
  rule: string,
  violations: SnapshotViolation[],
  layers: LayerDef[],
): string {
  // Use the first violation as the representative edge
  const v = violations[0];
  if (v === undefined) return rule;
  const fromLayer = layerForPath(v.from, layers);
  const toLayer = layerForPath(v.to, layers);

  if (fromLayer && toLayer) {
    return `${fromLayer} layer imports directly from ${toLayer} (${rule})`;
  }
  // Fallback: use the rule name and a short path fragment
  const fromShort = v.from.split("/").slice(-2).join("/");
  const toShort = v.to.split("/").slice(-2).join("/");
  return `${rule}: ${fromShort} → ${toShort}`;
}

/**
 * Looks up the explanation for a rule in the forbidden dependencies list.
 * Falls back to a generic description for circular rules or unknown rules.
 */
function buildRuleExplanation(
  rule: string,
  violations: SnapshotViolation[],
  layers: LayerDef[],
  forbidden: DependencyRule[],
): string {
  // For circular violations use a standard explanation
  if (rule === "no-circular" || violations.some((v) => v.cyclePath !== null)) {
    return (
      "A circular import cycle was detected. " +
      "Circular dependencies make modules harder to test in isolation and can cause " +
      "runtime initialisation errors. The cycle must be broken by introducing an " +
      "abstraction or moving shared code to a lower-level module."
    );
  }

  // Look up the forbidden dependency rule by matching layer names
  const v = violations[0];
  if (v === undefined) return `Rule '${rule}' has no matching violation.`;
  const fromLayer = layerForPath(v.from, layers);
  const toLayer = layerForPath(v.to, layers);

  const match = forbidden.find(
    (f) => f.from === fromLayer && f.to === toLayer,
  );
  if (match) return match.reason;

  // Generic fallback
  return `Rule '${rule}' forbids the dependency from '${v.from}' to '${v.to}'.`;
}

/**
 * Infers the nearest test files for the given primary source files.
 *
 * Strategy (no filesystem access):
 *   1. Sibling pattern: replace ".ts" with ".test.ts" for each primary file.
 *   2. Also check snapshot modules for any .test.ts / .spec.ts file whose
 *      path shares the same directory prefix as a primary file.
 *
 * Returns a deduplicated, sorted list.
 */
function inferRelevantTests(
  primaryFiles: string[],
  modules: SnapshotInput["modules"],
): string[] {
  const candidates = new Set<string>();

  // Sibling pattern
  for (const f of primaryFiles) {
    if (f.endsWith(".ts") && !f.endsWith(".test.ts") && !f.endsWith(".spec.ts")) {
      candidates.add(f.replace(/\.ts$/, ".test.ts"));
    }
  }

  // Module-list pattern (snapshot may not include test files — scanner config
  // excludes them — but include this path for future-proofing)
  const primaryDirs = new Set(primaryFiles.map((f) => f.split("/").slice(0, -1).join("/")));
  for (const mod of modules ?? []) {
    if (mod.path.endsWith(".test.ts") || mod.path.endsWith(".spec.ts")) {
      const dir = mod.path.split("/").slice(0, -1).join("/");
      if (primaryDirs.has(dir)) {
        candidates.add(mod.path);
      }
    }
  }

  return Array.from(candidates).sort();
}

// ---------------------------------------------------------------------------
// Markdown builder
// ---------------------------------------------------------------------------

function buildMarkdown(packet: CasePacket): string {
  const lines: string[] = [];

  lines.push(`# ${packet.caseId} — ${packet.title}`);
  lines.push("");
  lines.push(`**Scan ID:** ${packet.scanId}  `);
  lines.push(`**Rule:** \`${packet.rule}\`  `);
  lines.push(`**Severity:** ${packet.severity}`);
  lines.push("");

  lines.push("## Rule Explanation");
  lines.push("");
  lines.push(packet.ruleExplanation);
  lines.push("");

  lines.push("## Violations");
  lines.push("");
  for (const v of packet.violations) {
    lines.push(`- **${v.rule}**`);
    lines.push(`  - From: \`${v.from}\``);
    lines.push(`  - To: \`${v.to}\``);
    lines.push(`  - Evidence: ${v.evidence}`);
    if (v.cyclePath) {
      lines.push(`  - Cycle: \`${v.cyclePath.join(" → ")}\``);
    }
  }
  lines.push("");

  lines.push("## Primary Files");
  lines.push("");
  for (const f of packet.primaryFiles) {
    lines.push(`- \`${f}\``);
  }
  lines.push("");

  if (packet.relevantTests.length > 0) {
    lines.push("## Relevant Tests");
    lines.push("");
    for (const t of packet.relevantTests) {
      lines.push(`- \`${t}\``);
    }
    lines.push("");
  }

  lines.push("## Test Commands");
  lines.push("");
  for (const cmd of packet.testCommands) {
    lines.push(`\`\`\`\n${cmd}\n\`\`\``);
  }
  lines.push("");

  lines.push("## Expected End Condition");
  lines.push("");
  lines.push(packet.expectedEndCondition);
  lines.push("");

  if (packet.violations[0]?.cyclePath) {
    lines.push("## Cycle Path");
    lines.push("");
    lines.push(`\`${packet.violations[0].cyclePath!.join(" → ")}\``);
    lines.push("");
  }

  return lines.join("\n");
}

// ---------------------------------------------------------------------------
// Main export
// ---------------------------------------------------------------------------

export interface BuildCasePacketResult {
  json: CasePacket;
  markdown: string;
  /** Serialized byte length of the JSON packet — caller may log/warn. */
  jsonByteLength: number;
  /** True when packet exceeds the ~2 KB compact response budget. */
  exceedsBudget: boolean;
}

/**
 * Builds a CasePacket (JSON + Markdown) from a ViolationGroup.
 *
 * Pure function — no filesystem access.
 *
 * @param caseId   e.g. "case-001"
 * @param group    output from groupViolations()
 * @param snapshot the full Snapshot that produced the group
 * @param config   parsed config/architecture.json
 */
export function buildCasePacket(
  caseId: string,
  group: ViolationGroup,
  snapshot: SnapshotInput,
  config: ArchitectureConfig,
): BuildCasePacketResult {
  const rule = dominantRule(group.violations);
  const severity = dominantSeverity(group.violations);
  const title = buildTitle(rule, group.violations, config.layers);
  const ruleExplanation = buildRuleExplanation(
    rule,
    group.violations,
    config.layers,
    config.forbiddenDependencies,
  );
  const relevantTests = inferRelevantTests(group.primaryFiles, snapshot.modules);
  const expectedEndCondition =
    `The violation '${rule}' is absent from a same-config re-scan. ` +
    `All tests in the test commands still pass.`;

  const json: CasePacket = {
    caseId,
    scanId: snapshot.gitMarker,
    title,
    rule,
    severity,
    violations: group.violations,
    primaryFiles: group.primaryFiles,
    relevantTests,
    testCommands: config.testCommands,
    ruleExplanation,
    expectedEndCondition,
  };

  const serialized = JSON.stringify(json, null, 2);
  const jsonByteLength = Buffer.byteLength(serialized, "utf8");
  const exceedsBudget = jsonByteLength > COMPACT_BUDGET_BYTES;

  const markdown = buildMarkdown(json);

  return { json, markdown, jsonByteLength, exceedsBudget };
}
