import * as fs from "node:fs";
import * as path from "node:path";
import ts from "typescript";
import type { ICruiseResult } from "dependency-cruiser";
import { z } from "zod/v4";
import { digest, internalPath, readJson } from "./storage.js";
import { validateWithinWorkspace } from "./workspace.js";

const slash = (value: string) => value.replace(/\\/g, "/");
export function stable(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stable).join(",")}]`;
  if (value && typeof value === "object") return `{${Object.entries(value).filter(([, v]) => v !== undefined).sort(([a], [b]) => a.localeCompare(b)).map(([k, v]) => `${JSON.stringify(k)}:${stable(v)}`).join(",")}}`;
  return JSON.stringify(value) ?? "null";
}
export function policyHash(root: string): string {
  const file = path.join(root, "config/architecture.json");
  return digest(stable(fs.existsSync(file) ? readJson(file) : null));
}

export function configurationFingerprint(raw: ICruiseResult, root: string, scope: string, version: string): string {
  const normalize = (value: unknown): unknown => {
    if (typeof value === "string") return slash(value).split(slash(root)).join("<repo>");
    if (Array.isArray(value)) return value.map(normalize);
    if (value && typeof value === "object") return Object.fromEntries(Object.entries(value).map(([k,v]) => [k, normalize(v)]));
    return value;
  };
  const options = { ...raw.summary.optionsUsed } as Record<string, unknown>;
  for (const key of ["args", "outputTo", "outputType", "reporterOptions", "rulesFile", "cache", "metrics", "experimentalStats"]) delete options[key];
  const selectedTsconfig = options.tsConfig as { fileName?: string } | undefined;
  const tsconfig = path.resolve(root, selectedTsconfig?.fileName ?? "tsconfig.json");
  let typescript: unknown = null;
  if (fs.existsSync(tsconfig)) {
    const parsed = ts.getParsedCommandLineOfConfigFile(tsconfig, { noEmit: true }, {
      ...ts.sys, onUnRecoverableConfigFileDiagnostic: diagnostic => { throw new Error(ts.flattenDiagnosticMessageText(diagnostic.messageText, "\n")); },
    });
    const errors = parsed?.errors.filter(error => error.code !== 18003) ?? [];
    if (errors.length) throw new Error(`Invalid TypeScript configuration: ${errors.map(e => ts.flattenDiagnosticMessageText(e.messageText, "\n")).join("; ")}`);
    typescript = parsed?.options;
  }
  const manifests = new Map<string, string>();
  const addAncestors = (file: string) => {
    let directory = path.dirname(file);
    while (directory === root || directory.startsWith(root + path.sep)) {
      for (const name of ["package.json", "package-lock.json", "npm-shrinkwrap.json", "yarn.lock", "pnpm-lock.yaml"]) {
        const target = path.join(directory, name);
        if (fs.existsSync(target)) manifests.set(slash(path.relative(root, target)), digest(fs.readFileSync(target)));
      }
      if (directory === root) break;
      directory = path.dirname(directory);
    }
  };
  addAncestors(path.join(root, "placeholder"));
  // Project manifests must not depend on which imports survived the repair.
  const collectProjectManifests = (directory: string) => {
    if(fs.existsSync(path.join(directory,"package.json")))addAncestors(path.join(directory,"placeholder"));
    for(const entry of fs.readdirSync(directory,{withFileTypes:true})) {
      if(entry.isDirectory() && !["node_modules",".git",".archpulse","dist","coverage"].includes(entry.name)) {
        collectProjectManifests(path.join(directory,entry.name));
      }
    }
  };
  collectProjectManifests(root);
  return digest(stable(normalize({ fingerprintVersion: 2, version, scope,
    rules: raw.summary.ruleSetUsed, options, typescript,
    manifests: Object.fromEntries([...manifests].sort(([a],[b]) => a.localeCompare(b))),
  })));
}

export const manifestSchema = z.object({
  version: z.literal(2), id: z.string().uuid(), repoRoot: z.string(), configPath: z.string(), scope: z.string(),
  fingerprintVersion: z.literal(2), configHash: z.string(), policyHash: z.string(),
  snapshotHash: z.string(), graphHash: z.string(),
});
export type Manifest = z.infer<typeof manifestSchema>;

export function loadBaseline(root: string, identifier?: string) {
  root = fs.realpathSync(root);
  if (!identifier) {
    const latest = z.object({ baselineId: z.string() }).parse(readJson(internalPath(root, "latest-baseline.json")));
    identifier = latest.baselineId;
  }
  // Identifiers are paths, never ambiguous commit labels.
  if (path.basename(identifier) !== "snapshot.json") throw new Error("Use the immutable baselineId/snapshot path returned by scan; git markers are ambiguous.");
  const requested = path.resolve(root, identifier);
  const record = path.join(path.dirname(requested), "manifest.json");
  const requestedRelative=path.relative(root,requested);
  if(!path.isAbsolute(requestedRelative) && requestedRelative!==".." && !requestedRelative.startsWith(`..${path.sep}`)) {
    validateWithinWorkspace(requested,root);validateWithinWorkspace(record,root);
  }
  if (!fs.existsSync(record)) throw new Error("Baseline has no provenance. Rescan with this ArchPulse version.");
  const manifest = manifestSchema.parse(readJson(record));
  if (fs.realpathSync(manifest.repoRoot) !== root) throw new Error("Baseline repository mismatch; rescan this repository.");
  const archive = internalPath(root, "scans", manifest.id);
  const snapshotPath = path.join(archive, "snapshot.json");
  for (const file of [snapshotPath, path.join(archive, "graph.html"), path.join(archive, "manifest.json")]) validateWithinWorkspace(file, root);
  const archivedManifest = manifestSchema.parse(readJson(path.join(archive, "manifest.json")));
  if (stable(manifest) !== stable(archivedManifest) || digest(fs.readFileSync(requested)) !== manifest.snapshotHash ||
      digest(fs.readFileSync(snapshotPath)) !== manifest.snapshotHash || digest(fs.readFileSync(path.join(archive, "graph.html"))) !== manifest.graphHash) {
    throw new Error("Baseline artifacts have been modified; capture a fresh baseline.");
  }
  validateWithinWorkspace(manifest.configPath, root);
  validateWithinWorkspace(path.resolve(root, manifest.scope), root);
  return { manifest, snapshotPath, directory: archive, baselineId: slash(path.relative(root, snapshotPath)) };
}

/** Detect edits while checks run, excluding generated/cache/VCS directories. */
export function sourceState(root: string): string {
  const entries: Array<[string,string]> = [];
  const visit = (directory: string) => {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true }).sort((a,b) => a.name.localeCompare(b.name))) {
      if ([".git", ".archpulse", "node_modules", "dist", "coverage"].includes(entry.name)) continue;
      const file = path.join(directory, entry.name);
      if (entry.isSymbolicLink()) { entries.push([slash(path.relative(root,file)), fs.readlinkSync(file)]); continue; }
      if (entry.isDirectory()) visit(file);
      else if (entry.isFile()) entries.push([slash(path.relative(root,file)), digest(fs.readFileSync(file))]);
    }
  };
  visit(root); return digest(stable(entries));
}
