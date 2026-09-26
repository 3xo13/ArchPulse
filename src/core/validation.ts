import { z } from "zod/v4";

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
