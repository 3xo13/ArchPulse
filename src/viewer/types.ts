/**
 * TypeScript types mirroring SCHEMA.md contracts.
 * These are read-only view types — do not modify the field names without
 * updating SCHEMA.md and all other consumers.
 */

export interface Module {
  path: string;
  package: string;
  layer?: string;
}

export interface Edge {
  from: string;
  to: string;
  dependencyType: string;
}

export interface Violation {
  id: string;
  rule: string;
  from: string;
  to: string;
  severity: "error" | "warn" | "info";
  cyclePath?: string[] | null;
  evidence?: string;
  note?: string;
}

export interface Snapshot {
  schemaVersion: "1";
  root: string;
  gitMarker: string;
  scannerVersion: string;
  configHash: string;
  timestamp: string;
  modules: Module[];
  edges: Edge[];
  violations: Violation[];
  scannerWarnings: string[];
  incompleteResolutionCount: number;
}

export interface CasePacket {
  caseId: string;
  scanId: string;
  title: string;
  rule: string;
  severity: "error" | "warn";
  violations: Violation[];
  primaryFiles: string[];
  relevantTests: string[];
  testCommands: string[];
  ruleExplanation: string;
  expectedEndCondition: string;
}

export interface VerifyResult {
  caseId: string;
  baselineId: string;
  afterId: string;
  resolvedViolations: Violation[];
  persistentViolations: Violation[];
  newViolations: Violation[];
  testCommand: string;
  testExitCode: number;
  testOutput: string;
  typecheckExitCode: number;
  status: "verified" | "partial" | "failed" | "invalid";
  reason: string;
}
