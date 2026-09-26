import { z } from "zod/v4";
import * as path from "node:path";

export const relativePathSchema = z.string().min(1).refine(value => {
  const normalized = value.replace(/\\/g, "/");
  return !path.posix.isAbsolute(normalized) && !path.win32.isAbsolute(normalized) &&
    !/^[A-Za-z]:/.test(normalized) && !normalized.split("/").includes("..");
}, "Expected a repository-relative path without traversal");
const commands = z.array(z.string().trim().min(1));
export const architectureSchema = z.object({
  schemaVersion: z.string().default("1"),
  layers: z.array(z.object({ name: z.string().min(1), glob: z.string().min(1) })),
  allowedDependencies: z.array(z.object({ from: z.string(), to: z.string(), reason: z.string() })).default([]),
  forbiddenDependencies: z.array(z.object({ from: z.string(), to: z.string(), reason: z.string() })),
  testCommands: commands,
  typecheckCommands: commands.optional(),
  scanScope: relativePathSchema.optional(),
  scanExcludes: z.array(z.string()).optional(),
});

const severity = z.enum(["error", "warn", "info"]);
const cycle = z.array(z.object({ name: z.string().min(1) }).passthrough());

/** Validate the fields consumed by normalization; retain reporter metadata. */
export const cruiseResultSchema = z.object({
  modules: z.array(z.object({
    source: z.string().min(1),
    dependencies: z.array(z.object({
      resolved: z.string().min(1),
      dependencyTypes: z.array(z.string()).optional(),
      couldNotResolve: z.boolean().optional(),
      cycle: cycle.optional(),
    }).passthrough()),
  }).passthrough()),
  summary: z.object({
    warnings: z.array(z.union([z.string(), z.object({ message: z.string() })])).optional(),
    violations: z.array(z.object({
      rule: z.object({ name: z.string().min(1), severity }).passthrough(),
      from: z.string().min(1),
      to: z.string().min(1),
      cycle: cycle.optional(),
    }).passthrough()),
  }).passthrough(),
}).passthrough();

export const violationSchema = z.object({
  id: z.string().min(1),
  rule: z.string().min(1),
  from: z.string().min(1),
  to: z.string().min(1),
  severity,
  cyclePath: z.array(z.string()).nullable(),
  evidence: z.string(),
});

/** Only comparison's consumed fields are required, preserving schema v1. */
export const comparisonSnapshotSchema = z.object({
  schemaVersion: z.literal("1"),
  root: z.string().min(1),
  configHash: z.string().min(1),
  gitMarker: z.string().min(1),
  incompleteResolutionCount: z.number().int().nonnegative(),
  violations: z.array(violationSchema),
});

export const caseSnapshotSchema = comparisonSnapshotSchema.extend({
  root: relativePathSchema,
  modules: z.array(z.object({ path: relativePathSchema, package: z.string(), layer: z.string().optional() })).default([]),
  violations: z.array(violationSchema.extend({ from: relativePathSchema, to: relativePathSchema,
    cyclePath: z.array(relativePathSchema).nullable().default(null) })),
});

export const casePacketSchema = z.object({
  caseId: z.string().regex(/^case-\d{3,}$/), scanId: z.string(), title: z.string(), rule: z.string(),
  severity: z.enum(["error","warn"]), violations: caseSnapshotSchema.shape.violations.min(1),
  primaryFiles: z.array(relativePathSchema).max(6), relevantTests: z.array(relativePathSchema),
  testCommands: commands, ruleExplanation: z.string(), expectedEndCondition: z.string(),
});
