import { AsyncLocalStorage } from "node:async_hooks";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import { createHash } from "node:crypto";
import { z } from "zod/v4";
import { canonicalPath, validateWithinWorkspace } from "./workspace.js";
import { architectureSchema, relativePathSchema } from "./validation.js";

const checkSchema = z.object({ command: z.string().trim().min(1), cwd: relativePathSchema.default(".") });
export const profileSchema = architectureSchema.partial().extend({
  version: z.literal(1).default(1), includes: z.array(z.string()).default([]), excludes: z.array(z.string()).default([]),
  aliases: z.record(z.string(), z.array(z.string())).default({}),
  checks: z.object({ tests: z.array(checkSchema), typechecks: z.array(checkSchema) }).optional(),
  adoptedConfig: relativePathSchema.optional(),
}).strict();
export type Profile = z.infer<typeof profileSchema>;
export type Check = z.infer<typeof checkSchema>;
export interface ProjectContext { root: string; storage: string; profilePath: string; }
const contexts = new AsyncLocalStorage<ProjectContext>();
export function projectContext(root?: string): ProjectContext | undefined {
  const current = contexts.getStore();
  if (current && root && fs.realpathSync(path.resolve(root)) !== current.root) throw new Error("Project context repository mismatch.");
  return current;
}
export function createProjectContext(root: string, storageBase = process.env.ARCHPULSE_STORAGE ?? path.join(os.homedir(), ".archpulse", "projects")): ProjectContext {
  root = fs.realpathSync(path.resolve(root));
  if (!fs.statSync(root).isDirectory()) throw new Error("Project must be a directory.");
  const identity = process.platform === "win32" ? root.toLowerCase() : root;
  const storage = path.join(canonicalPath(path.resolve(storageBase)), createHash("sha256").update(identity).digest("hex"));
  if(canonicalPath(storage)!==storage)throw new Error("Project storage directory must not be redirected by a symbolic link or junction.");
  const relative = path.relative(root, storage);
  if (!path.isAbsolute(relative) && relative !== ".." && !relative.startsWith(`..${path.sep}`)) throw new Error("External storage must be outside the target project.");
  return { root, storage, profilePath: path.join(storage, "profile.json") };
}
export function withProject<T>(context: ProjectContext, action: () => T): T { return contexts.run(context, action); }
export function withoutProject<T>(action:()=>T):T { return contexts.exit(action); }
export function profile(context = projectContext()): Profile {
  if (!context) return profileSchema.parse({});
  validateManagedPath(context.profilePath, context);
  const result=profileSchema.parse(fs.existsSync(context.profilePath) ? JSON.parse(fs.readFileSync(context.profilePath, "utf8")) : {});
  const layers=new Set((result.layers??[]).map(l=>l.name));
  if(layers.size!==(result.layers??[]).length)throw new Error("Profile layer names must be unique.");
  for(const rule of result.forbiddenDependencies??[])if(!layers.has(rule.from)||!layers.has(rule.to))throw new Error(`Profile rule refers to an unknown layer: ${rule.from} -> ${rule.to}`);
  return result;
}
export function validateManagedPath(file: string, context = projectContext()): void {
  if (!context) throw new Error("External project context is required.");
  // canonicalPath works before the directory exists; reject links escaping its assigned namespace.
  const relative = path.relative(context.storage, canonicalPath(file));
  if (path.isAbsolute(relative) || relative === ".." || relative.startsWith(`..${path.sep}`)) throw new Error(`Artifact escapes project storage: ${file}`);
}
export function validateArtifact(file: string, root: string): void {
  const context = projectContext(root);
  if (context) validateManagedPath(file, context); else validateWithinWorkspace(file, root);
}
export function artifactName(root: string, file: string): string {
  return projectContext(root) ? path.resolve(file) : path.relative(root, file).replace(/\\/g, "/");
}
export function projectArchitecture(root: string) {
  const context = projectContext(root);
  if (!context) return architectureSchema.parse(JSON.parse(fs.readFileSync(path.join(root, "config/architecture.json"), "utf8")));
  const data = profile(context);
  return architectureSchema.parse({ schemaVersion: "1", layers: [], forbiddenDependencies: [], testCommands: [], typecheckCommands: [], ...data });
}
