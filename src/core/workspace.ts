import * as fs from "node:fs";
import * as path from "node:path";

/** Resolve existing ancestors without following a dangling link as a missing path. */
export function canonicalPath(candidate: string): string {
  const absolute = path.resolve(candidate);
  const missing: string[] = [];
  let ancestor = absolute;
  for (;;) {
    try {
      fs.lstatSync(ancestor);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      const parent = path.dirname(ancestor);
      if (parent === ancestor) throw new Error(`Path has no existing ancestor: ${absolute}`);
      missing.unshift(path.basename(ancestor));
      ancestor = parent;
      continue;
    }
    // realpath throws for dangling links instead of skipping them.
    let real: string;
    try { real = fs.realpathSync(ancestor); }
    catch { throw new Error(`Cannot resolve path (possibly a dangling link): ${ancestor}`); }
    return path.resolve(real, ...missing);
  }
}

export function validateWithinWorkspace(candidate: string, trustedRoot: string): void {
  const root = fs.realpathSync(trustedRoot);
  const real = canonicalPath(candidate);
  const relative = path.relative(root, real);
  if (path.isAbsolute(relative) || relative === ".." || relative.startsWith(`..${path.sep}`)) {
    throw new Error(`Path '${candidate}' resolves outside the trusted workspace '${trustedRoot}'.`);
  }
}

export function trustedWorkspaceRoot(): string {
  const configured = process.env.ARCHPULSE_ROOT ?? process.cwd();
  if (configured.includes("${workspaceFolder}")) {
    throw new Error("ARCHPULSE_ROOT contains unexpanded ${workspaceFolder}; configure an absolute workspace path or install the add-on for this workspace.");
  }
  const root = fs.realpathSync(path.resolve(configured));
  if (!fs.statSync(root).isDirectory()) throw new Error("ARCHPULSE_ROOT must be a directory.");
  return root;
}
