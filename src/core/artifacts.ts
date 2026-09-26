import * as fs from "node:fs";
import * as path from "node:path";

/** Publish a pair with rollback on ordinary I/O errors, not crash atomicity. */
export function publishArtifacts(outDir: string, snapshot: string, graph: string): void {
  fs.mkdirSync(outDir, { recursive: true });
  const names = ["snapshot.json", "graph.html"];
  for (const name of names) {
    try {
      if (!fs.lstatSync(path.join(outDir, name)).isFile()) {
        throw new Error(`Artifact target must be a regular file: ${name}`);
      }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
  }
  const staging = fs.mkdtempSync(path.join(outDir, ".archpulse-stage-"));
  const backedUp: string[] = [];
  const published: string[] = [];
  let cleanup = true;
  try {
    fs.writeFileSync(path.join(staging, "snapshot.json"), snapshot, "utf8");
    fs.writeFileSync(path.join(staging, "graph.html"), graph, "utf8");
    for (const name of names) {
      const target = path.join(outDir, name);
      if (fs.existsSync(target)) {
        fs.renameSync(target, path.join(staging, `${name}.bak`));
        backedUp.push(name);
      }
    }
    for (const name of names) {
      fs.renameSync(path.join(staging, name), path.join(outDir, name));
      published.push(name);
    }
  } catch (error) {
    try {
      for (const name of published) fs.unlinkSync(path.join(outDir, name));
      for (const name of backedUp) {
        fs.renameSync(path.join(staging, `${name}.bak`), path.join(outDir, name));
      }
    } catch (rollbackError) {
      cleanup = false;
      throw new AggregateError([error, rollbackError], `Artifact rollback failed; backups retained in ${staging}`);
    }
    throw error;
  } finally {
    if (cleanup) fs.rmSync(staging, { recursive: true, force: true });
  }
}
