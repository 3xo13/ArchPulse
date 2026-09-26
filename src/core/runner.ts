/**
 * src/core/runner.ts
 *
 * Execute an allowlisted test command from config/architecture.json.
 *
 * Security contract (ARCHPULSE_EXECUTION_PLAN.md §3, §6):
 *   - Only commands explicitly listed under "testCommands" in
 *     config/architecture.json may ever be executed.
 *   - The caller identifies the command by its zero-based index in that array.
 *   - No arbitrary command string is accepted at runtime.
 *   - Execution uses child_process.spawn with shell:false to prevent injection.
 *
 * Exports:
 *   runTestCommand  — run one allowlisted command, return exit code + output.
 */

import { spawn } from "node:child_process";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export interface RunResult {
  /** The exact command string that was executed (from the allowlist). */
  command: string;
  /** Process exit code; null if the process was killed by a signal. */
  exitCode: number | null;
  /** Combined stdout + stderr, truncated to at most MAX_OUTPUT_LINES lines. */
  output: string;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Maximum number of output lines retained before truncation. */
const MAX_OUTPUT_LINES = 500;

/** Path to the architecture config, relative to cwd. */
const ARCHITECTURE_CONFIG_PATH = "config/architecture.json";

// ---------------------------------------------------------------------------
// runTestCommand
// ---------------------------------------------------------------------------

/**
 * Run one allowlisted test command from config/architecture.json.
 *
 * @param commandIndex - Zero-based index into the "testCommands" array in
 *                       config/architecture.json.  Providing any value that is
 *                       not a valid index throws a TypeError immediately.
 * @param repoRoot     - Optional repository root to resolve the config path
 *                       against. Defaults to process.cwd().
 *
 * @example
 *   // Runs: npx vitest run demo/packages/ui/src
 *   const result = await runTestCommand(2);
 *   console.log(result.exitCode, result.output);
 */
export async function runTestCommand(
  commandIndex: number,
  repoRoot?: string,
): Promise<RunResult> {
  const root = repoRoot ?? process.cwd();
  const configPath = resolve(root, ARCHITECTURE_CONFIG_PATH);

  // Load the allowlist.
  const raw = readFileSync(configPath, "utf-8");
  const config = JSON.parse(raw) as { testCommands?: unknown };

  if (!Array.isArray(config.testCommands) || config.testCommands.length === 0) {
    throw new Error(
      `No testCommands found in ${ARCHITECTURE_CONFIG_PATH}. ` +
        "Add at least one command to the testCommands array.",
    );
  }

  const testCommands = config.testCommands as string[];

  if (
    !Number.isInteger(commandIndex) ||
    commandIndex < 0 ||
    commandIndex >= testCommands.length
  ) {
    throw new TypeError(
      `commandIndex ${commandIndex} is out of range. ` +
        `config/architecture.json defines ${testCommands.length} testCommand(s) ` +
        `at indices 0–${testCommands.length - 1}.`,
    );
  }

  // commandIndex is validated above; the non-null assertion is safe.
  const commandString = testCommands[commandIndex] as string;
  const parts = commandString.split(/\s+/);
  const bin = parts[0] as string;
  const args = parts.slice(1);

  return new Promise<RunResult>((resolvePromise) => {
    const chunks: string[] = [];

    const child = spawn(bin, args, {
      cwd: root,
      shell: false, // No shell expansion — prevent any injection path.
      env: process.env,
      stdio: ["ignore", "pipe", "pipe"],
    });

    const collect = (data: Buffer | string): void => {
      chunks.push(data.toString());
    };

    child.stdout.on("data", collect);
    child.stderr.on("data", collect);

    child.on("close", (code: number | null) => {
      const fullOutput = chunks.join("");
      const output = truncateLines(fullOutput, MAX_OUTPUT_LINES);

      resolvePromise({
        command: commandString,
        exitCode: code,
        output,
      });
    });

    // Propagate spawn errors (e.g. binary not found) as a failed run.
    child.on("error", (err: Error) => {
      resolvePromise({
        command: commandString,
        exitCode: 1,
        output: `spawn error: ${err.message}`,
      });
    });
  });
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Truncate output to at most `maxLines` lines.
 * When truncation occurs a notice is appended so the caller knows output
 * was cut, rather than silently dropping lines.
 */
function truncateLines(text: string, maxLines: number): string {
  const lines = text.split("\n");
  if (lines.length <= maxLines) {
    return text;
  }
  const kept = lines.slice(0, maxLines);
  const dropped = lines.length - maxLines;
  kept.push(`[... ${dropped} line(s) truncated]`);
  return kept.join("\n");
}
