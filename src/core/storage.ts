import * as fs from "node:fs";
import * as path from "node:path";
import { randomUUID, createHash } from "node:crypto";
import { setTimeout as delay } from "node:timers/promises";
import { canonicalPath, validateWithinWorkspace } from "./workspace.js";

export const digest = (value: string | Buffer): string => createHash("sha256").update(value).digest("hex");
export const json = (value: unknown): string => JSON.stringify(value, null, 2) + "\n";
export function readJson(file: string): unknown {
  try { return JSON.parse(fs.readFileSync(file, "utf8")); }
  catch (error) { throw new Error(`Cannot read JSON '${file}': ${String(error)}`); }
}
export function internalPath(root: string, ...parts: string[]): string {
  const target = path.join(root, ".archpulse", ...parts);
  validateWithinWorkspace(target, root);
  return target;
}
export function isScanArchive(root: string, target: string): boolean {
  const relative = path.relative(canonicalPath(internalPath(root,"scans")),canonicalPath(target));
  return !path.isAbsolute(relative) && relative !== ".." && !relative.startsWith(`..${path.sep}`);
}
export function assertMutableOutput(root: string, target: string): void {
  if (isScanArchive(root,target)) throw new Error("Scan archives are immutable; choose a different output directory.");
}

export class RepositoryBusyError extends Error {}

/** One repository writer, including across separate CLI/server processes. */
export async function withRepositoryLock<T>(root: string, action: () => Promise<T> | T, signal?: AbortSignal, waitMs = 120_000): Promise<T> {
  const directory = internalPath(root);
  fs.mkdirSync(directory, { recursive: true });
  const lock = internalPath(root, "operation.lock");
  const deadline = Date.now() + waitMs;
  let fd: number;
  for (;;) {
    signal?.throwIfAborted();
    try { fd = fs.openSync(lock, "wx"); break; }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
      if (Date.now() >= deadline) throw new RepositoryBusyError(`Repository is busy. If no ArchPulse process is running, remove stale lock: ${lock}`);
      await delay(50, undefined, { signal });
    }
  }
  try { fs.writeFileSync(fd, String(process.pid)); signal?.throwIfAborted(); return await action(); }
  finally { fs.closeSync(fd); fs.unlinkSync(lock); }
}

/** Stage and install owned files. Final validation commits; cleanup cannot undo success. */
export function publishFiles(changes: Map<string, string | null>, beforeCommit?: (stagedFiles: string[]) => void,
  beforeFinalize?: () => void): void {
  const staged = new Map<string, string>();
  const backups = new Map<string, string>();
  const published: string[] = [];
  const token = randomUUID();
  let committed = false;
  try {
    for (const [file, content] of changes) {
      fs.mkdirSync(path.dirname(file), { recursive: true });
      try {
        if (!fs.lstatSync(file).isFile()) throw new Error(`Target must be a regular file: ${file}`);
      } catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
      if (content !== null) {
        const temporary = `${file}.${token}.tmp`;
        staged.set(file, temporary);
        fs.writeFileSync(temporary, content, { encoding: "utf8", flag: "wx" });
      }
    }
    beforeCommit?.([...staged.values()]);
    for (const file of changes.keys()) {
      if (fs.existsSync(file)) {
        const backup = `${file}.${token}.bak`;
        fs.renameSync(file, backup); backups.set(file, backup);
      }
    }
    for (const [file, temporary] of staged) {
      fs.renameSync(temporary, file); published.push(file);
    }
    // Backups remain available until every replacement and validation succeeds.
    beforeFinalize?.();
    committed = true;
  } catch (error) {
    const errors: unknown[] = [error];
    for (const file of published) { try { fs.unlinkSync(file); } catch (failure) { errors.push(failure); } }
    for (const [file, backup] of backups) { try { fs.renameSync(backup, file); } catch (failure) { errors.push(failure); } }
    if (errors.length > 1) throw new AggregateError(errors, `Publication rollback failed; backups have suffix ${token}.bak`);
    throw error;
  } finally {
    const retained: string[] = [];
    // Only successful publication owns disposable backups. Failed rollback needs them.
    const disposable = [...staged.values(), ...(committed ? backups.values() : [])];
    for (const file of disposable) {
      try { fs.unlinkSync(file); }
      catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "ENOENT") retained.push(file);
      }
    }
    if (retained.length) console.error(`[archpulse] Artifact cleanup warning: ${retained.length} file(s) retained:\n${retained.join("\n")}`);
  }
}
