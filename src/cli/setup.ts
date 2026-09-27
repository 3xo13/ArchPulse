import * as fs from "node:fs";
import * as path from "node:path";
import { createInterface } from "node:readline/promises";
import { configureProject } from "../core/policy.js";

/** Human approval stays in the terminal; setup never executes project checks. */
export async function runSetup(root: string, signal: AbortSignal): Promise<void> {
  const { proposal, profilePath } = await configureProject(root, undefined, signal);
  console.log(`Project: ${root}\nExternal profile: ${profilePath}`);
  for (const [label, checks] of [["Tests", proposal.tests], ["Typechecks", proposal.typechecks]] as const) {
    console.log(`\n${label}:`);
    if (!checks.length) console.log("  None discovered.");
    for (const check of checks) console.log(`  ${check.command}\n    Working directory: ${path.resolve(root, check.cwd)}`);
  }
  for (const cwd of new Set([...proposal.tests, ...proposal.typechecks].map(check => check.cwd))) {
    const manifest = path.join(root, cwd, "package.json");
    if (fs.existsSync(manifest)) {
      const data = JSON.parse(fs.readFileSync(manifest, "utf8")) as { scripts?: Record<string, string> };
      console.log(`\nPackage script definitions (${cwd}):\n${JSON.stringify(data.scripts ?? {}, null, 2)}`);
    }
  }
  for (const warning of proposal.warnings) console.log(`Warning: ${warning}`);
  console.log("\nScanning and graph viewing do not require approval. Setup does not run these checks.");
  if (!proposal.tests.length || !proposal.typechecks.length) {
    console.log("Full verification is not ready: both test and typecheck commands are required. No new approval saved.\nIf checks already exist, select them in the external profile and run setup again.");
    process.exitCode = 2;
    return;
  }
  const terminal = createInterface({ input: process.stdin, output: process.stdout });
  let answer: string;
  try {
    answer = await Promise.race([
      terminal.question("Approve these commands for future verification? [y/N] ", { signal }),
      new Promise<string>(resolve => terminal.once("close", () => resolve(""))),
    ]);
  } finally {
    terminal.close();
  }
  signal.throwIfAborted();
  if (!/^(y|yes)$/i.test(answer.trim())) {
    console.log("No new approval saved. Scanning is still available.");
    return;
  }
  // Revalidates the entire proposal after the user has reviewed it.
  await configureProject(root, proposal.id, signal);
  console.log("Checks approved. Ask Bob to capture a fresh baseline before making repairs.");
}
