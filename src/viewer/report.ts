import { z } from "zod/v4";
import type { CasePacket, Snapshot, VerifyResult } from "./types";

export const repositoryPath = z.string().min(1).refine(value => {
  const path = value.replace(/\\/g, "/");
  return !path.startsWith("/") && !/^[A-Za-z]:/.test(path) && !path.split("/").includes("..") && !/[\u0000-\u001f]/.test(path);
}, "Expected a repository-relative path without traversal");
const violation = z.object({ id: z.string().min(1), rule: z.string().min(1), from: repositoryPath, to: repositoryPath,
  severity: z.enum(["error", "warn", "info"]), cyclePath: z.array(repositoryPath).nullable().optional(),
  evidence: z.string().optional(), note: z.string().optional() });
const violations = z.array(violation).refine(items => new Set(items.map(item => item.id)).size === items.length, "Duplicate violation IDs");
const snapshotSchema = z.object({ schemaVersion: z.literal("1"), root: repositoryPath, gitMarker: z.string().min(1),
  scannerVersion: z.string(), configHash: z.string().min(1), timestamp: z.string(),
  modules: z.array(z.object({ path: repositoryPath, package: z.string(), layer: z.string().optional() })),
  edges: z.array(z.object({ from: repositoryPath, to: repositoryPath, dependencyType: z.string() })),
  violations, scannerWarnings: z.array(z.string()), incompleteResolutionCount: z.number().int().nonnegative() });
const caseSchema = z.object({ caseId: z.string().regex(/^case-\d{3,}$/), scanId: z.string(), title: z.string(), rule: z.string(),
  severity: z.enum(["error", "warn"]), violations: violations.refine(items => items.length > 0, "Empty case"),
  primaryFiles: z.array(repositoryPath).max(6), relevantTests: z.array(repositoryPath), testCommands: z.array(z.string().min(1)),
  ruleExplanation: z.string(), expectedEndCondition: z.string() });
const resultSchema = z.object({ caseId: z.string(), baselineId: z.string(), afterId: z.string(),
  resolvedViolations: violations, persistentViolations: violations, newViolations: violations,
  testCommand: z.string(), testExitCode: z.number().int(), testOutput: z.string(), typecheckExitCode: z.number().int(),
  status: z.enum(["verified", "partial", "failed", "invalid"]), reason: z.string() });
const runSchema = z.object({ command: z.string(), exitCode: z.number().int().nullable(), output: z.string() });
const executionSchema = z.object({ tests: z.array(runSchema), typechecks: z.array(runSchema),
  expectedTests: z.number().int().nonnegative(), expectedTypes: z.number().int().nonnegative(), afterSnapshotPath: z.string().optional() });
export type Execution = z.infer<typeof executionSchema>;
export interface Report { before: Snapshot; after?: Snapshot; packet: CasePacket; result: VerifyResult; execution?: Execution; }
export type ArtifactRole = "before" | "after" | "packet" | "result" | "execution";
export const artifactLabels: Record<ArtifactRole, string> = {
  before: "Before snapshot", after: "After snapshot", packet: "Case packet", result: "Verification result", execution: "Execution details (optional)",
};
function parse<T>(schema: z.ZodType<T>, value: unknown, label: string): T {
  const parsed = schema.safeParse(value);
  if (!parsed.success) throw new Error(`${label}: ${parsed.error.issues.map(issue => `${issue.path.join(".") || "document"}: ${issue.message}`).join("; ")}`);
  return parsed.data;
}
const ids = (items: Array<{ id: string }>) => items.map(item => item.id).sort().join("\n");
const scope = (value: string) => value.replace(/\\/g, "/").split("/").filter(part => part && part !== ".").join("/");
function sameViolation(a: z.infer<typeof violation>, b: z.infer<typeof violation>) {
  return a.id === b.id && a.rule === b.rule && a.from === b.from && a.to === b.to && a.severity === b.severity &&
    JSON.stringify(a.cyclePath ?? null) === JSON.stringify(b.cyclePath ?? null);
}
export function validateReport(input: Partial<Record<ArtifactRole, unknown>>): Report {
  const before = parse(snapshotSchema, input.before, artifactLabels.before);
  const packet = parse(caseSchema, input.packet, artifactLabels.packet);
  const result = parse(resultSchema, input.result, artifactLabels.result);
  const after = input.after === undefined ? undefined : parse(snapshotSchema, input.after, artifactLabels.after);
  const execution = input.execution === undefined ? undefined : parse(executionSchema, input.execution, artifactLabels.execution);
  const reject = (message: string): never => { throw new Error(`Verification result: ${message}`); };
  if (packet.scanId !== before.gitMarker) throw new Error("Case packet: scanId does not match the before snapshot gitMarker.");
  if (result.caseId !== packet.caseId) reject("caseId does not match the case packet.");
  if (result.baselineId && result.baselineId !== before.gitMarker) reject("baselineId does not match the before snapshot gitMarker (it is not an immutable baseline path).");
  if (packet.violations.some(v => !before.violations.some(original => sameViolation(v, original)))) throw new Error("Case packet: selected violations do not match the before snapshot.");
  if (result.afterId && (!after || result.afterId !== after.gitMarker)) reject("afterId requires a matching after snapshot.");
  if (result.afterId && !result.baselineId) reject("baselineId is required for a completed comparison.");
  if (!result.afterId && after) reject("afterId is empty; no completed comparison is recorded for this after snapshot.");
  if (!after && !["invalid", "failed"].includes(result.status)) reject("this status requires an after snapshot.");
  if (!after && (result.resolvedViolations.length || result.persistentViolations.length || result.newViolations.length)) reject("comparison arrays require an after snapshot.");
  if (after && result.status === "invalid") {
    for (const [name, actual, expected] of [
      ["resolvedViolations", result.resolvedViolations, packet.violations.filter(v => !after.violations.some(item => item.id === v.id))],
      ["persistentViolations", result.persistentViolations, after.violations.filter(v => before.violations.some(item => item.id === v.id))],
      ["newViolations", result.newViolations, after.violations.filter(v => !before.violations.some(item => item.id === v.id))],
    ] as const) {
      if (actual.some(v => !expected.some(item => sameViolation(v, item)))) reject(`${name} contains evidence absent from the supplied snapshots.`);
    }
  }
  if (after && result.status !== "invalid") {
    if (before.configHash !== after.configHash || scope(before.root) !== scope(after.root) || before.incompleteResolutionCount || after.incompleteResolutionCount) reject("incompatible configuration, scope, or incomplete resolution requires invalid status.");
    const resolved = packet.violations.filter(v => !after.violations.some(item => item.id === v.id));
    const persistent = after.violations.filter(v => before.violations.some(item => item.id === v.id));
    const introduced = after.violations.filter(v => !before.violations.some(item => item.id === v.id));
    for (const [name, actual, expected] of [["resolvedViolations", result.resolvedViolations, resolved],
      ["persistentViolations", result.persistentViolations, persistent], ["newViolations", result.newViolations, introduced]] as const) {
      if (ids(actual) !== ids(expected) || actual.some(v => !expected.some(item => sameViolation(v, item)))) reject(`${name} does not match the supplied snapshots and case.`);
    }
    if (result.status === "verified" && (result.testExitCode !== 0 || result.typecheckExitCode !== 0 || !result.testCommand.trim() ||
      !result.baselineId || resolved.length !== packet.violations.length || introduced.length)) reject("verified requires passing checks, complete case resolution, and no new violations.");
    if (result.status === "partial" && (resolved.length === 0 || resolved.length === packet.violations.length || introduced.length || result.testExitCode !== 0 || result.typecheckExitCode !== 0)) reject("partial is inconsistent with the selected case or checks.");
  }
  if (execution) {
    if (execution.tests.map(run => run.command).join("\n") !== result.testCommand) reject("execution test commands do not match this report.");
    if (execution.tests.length > execution.expectedTests || execution.typechecks.length > execution.expectedTypes) reject("execution command counts exceed expected checks.");
    const aggregate = (runs: Execution["tests"], expected: number) => {
      const failed = runs.find(run => run.exitCode !== 0);
      return failed ? failed.exitCode ?? -1 : !runs.length || runs.length < expected ? -1 : 0;
    };
    if (aggregate(execution.tests, execution.expectedTests) !== result.testExitCode || aggregate(execution.typechecks, execution.expectedTypes) !== result.typecheckExitCode) reject("execution exit codes do not match this report.");
  }
  return { before, after, packet, result, execution };
}
export async function readArtifact(file: File, role: ArtifactRole): Promise<unknown> {
  if (file.size > 20 * 1024 * 1024) throw new Error(`${artifactLabels[role]}: maximum file size is 20 MiB.`);
  try { return JSON.parse(await file.text()); }
  catch { throw new Error(`${artifactLabels[role]}: cannot read a valid JSON document.`); }
}
