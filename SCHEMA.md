# ArchPulse — Shared Schema Contract

> This document is the agreed interface between all parallel workstreams.
> All owners (B, C, E, F) build against these shapes. Do not change field names
> without updating all consumers and this document.

## snapshot.json

Produced by: `archpulse scan` CLI / `scan_repository` MCP tool (Owner B)  
Consumed by: `archpulse cases` (C), `archpulse compare` (E), viewer (F)

```ts
interface Snapshot {
  schemaVersion: "1";
  root: string;              // repo-relative, slash-normalized scan root
  gitMarker: string;         // git commit SHA or "working-tree"
  scannerVersion: string;    // e.g. "dependency-cruiser@16.10.4"
  configHash: string;        // SHA-256 of .dependency-cruiser.cjs content
  timestamp: string;         // ISO 8601
  modules: Module[];
  edges: Edge[];
  violations: Violation[];
  scannerWarnings: string[];
  incompleteResolutionCount: number;
}

interface Module {
  path: string;    // repo-relative, slash-normalized
  package: string; // npm workspace package name, e.g. "@demo/ui"
  layer?: string;  // layer name from config/architecture.json
}

interface Edge {
  from: string;           // repo-relative path
  to: string;             // repo-relative path
  dependencyType: string; // "local" | "workspace" | "npm" | ...
}

interface Violation {
  id: string;      // "<rule>::<from>::<to>"  — stable across scans
  rule: string;    // rule name from .dependency-cruiser.cjs
  from: string;    // repo-relative path
  to: string;      // repo-relative path
  severity: "error" | "warn" | "info";
  cyclePath: string[] | null;  // null unless rule is no-circular
  evidence: string;            // human-readable description
}
```

**Violation ID construction:**  
`<ruleName>::<normalizedFrom>::<normalizedTo>`  
For circular violations, append `::cycle` and sort the cycle members before hashing.

**Example fixture:** `artifacts/example/snapshot-before.json`

---

## case-<id>.json

Produced by: `archpulse cases` CLI / `get_case` MCP tool (Owner C)  
Consumed by: `verify_case` MCP tool (E), viewer (F), Bob skill (D)

```ts
interface CasePacket {
  caseId: string;      // "case-001", "case-002", ...
  scanId: string;      // matches snapshot gitMarker used to generate this case
  title: string;
  rule: string;
  severity: "error" | "warn";
  violations: Violation[];        // subset from snapshot
  primaryFiles: string[];         // ≤6 repo-relative paths
  relevantTests: string[];        // nearest test files
  testCommands: string[];         // from config/architecture.json testCommands
  ruleExplanation: string;
  expectedEndCondition: string;
}
```

**Example fixture:** `artifacts/example/case-001.json`

---

## result.json

Produced by: `archpulse compare` CLI / `verify_case` MCP tool (Owner E)  
Consumed by: viewer (F), Bob skill (D)

```ts
interface VerifyResult {
  caseId: string;
  baselineId: string;            // gitMarker of before-snapshot
  afterId: string;               // gitMarker of after-snapshot
  resolvedViolations: Violation[];
  persistentViolations: Violation[];
  newViolations: Violation[];
  testCommand: string;
  testExitCode: number;
  testOutput: string;            // truncated to ~500 lines
  typecheckExitCode: number;
  status: "verified" | "partial" | "failed" | "invalid";
  reason: string;
}
```

`status: "invalid"` is returned when snapshot configuration hashes or scan scopes differ,
either snapshot has unresolved dependencies, the selected case is empty, or selected
violation IDs are missing from the baseline. Legacy absolute scan scopes require a rescan.

The implemented `compareSnapshots` helper returns architecture differences only. Any new
violation (error, warning, or info) prevents a `verified` comparison. Its status does not
assert that tests or typechecking passed; complete `VerifyResult` orchestration is pending.

**Example fixture:** `artifacts/example/result.json`

---

## config/architecture.json (excerpt relevant to scanners)

```ts
interface ArchitectureConfig {
  schemaVersion: string;
  layers: Layer[];
  allowedDependencies: DependencyRule[];
  forbiddenDependencies: DependencyRule[];
  testCommands: string[];   // allowlisted commands for verify_case
  scanScope: string;        // path passed to depcruise
  scanExcludes: string[];   // patterns to exclude
}
```

Full file: `config/architecture.json`
