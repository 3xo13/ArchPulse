import type { VerifyResult } from "./types";
import type { Execution } from "./report";

export const checkOutcome = (code: number) => code === 0 ? "Passed" : code === -1 ? "Not run" : "Failed";
export function vitestCounts(output: string): { passed: number; failed: number; skipped: number } | undefined {
  if (output.includes("[output truncated]")) return;
  const clean = output.replace(new RegExp(String.fromCharCode(27) + "\\[[0-9;]*m", "g"), "");
  const lines = clean.split(/\r?\n/).filter(line => /^\s*Tests\s+/.test(line));
  if (lines.length !== 1) return;
  const match = lines[0]!.match(/^\s*Tests\s+((?:\d+ (?:passed|failed|skipped|todo)(?:\s*\|\s*)?\s*)+)\((\d+)\)\s*$/);
  if (!match) return;
  const counts = { passed: 0, failed: 0, skipped: 0 };
  const seen = new Set<string>();
  for (const item of match[1]!.matchAll(/(\d+) (passed|failed|skipped|todo)/g)) {
    if (seen.has(item[2]!)) return;
    seen.add(item[2]!);
    counts[item[2] === "todo" ? "skipped" : item[2] as keyof typeof counts] += Number(item[1]);
  }
  if (counts.passed + counts.failed + counts.skipped !== Number(match[2])) return;
  return counts;
}
export function testSummary(result: VerifyResult, execution?: Execution): string {
  const outcome = checkOutcome(result.testExitCode);
  if (result.testExitCode === -1) return outcome;
  const runs = execution ? execution.tests : [{ command: result.testCommand, exitCode: result.testExitCode, output: result.testOutput }];
  if (execution ? runs.length !== execution.expectedTests || !runs.length : result.testCommand.split("\n").length !== 1 || !result.testCommand.trim()) return outcome;
  const totals = { passed: 0, failed: 0, skipped: 0 };
  for (const run of runs) {
    if (run.exitCode !== 0 && run.exitCode !== 1) return outcome;
    const counts = vitestCounts(run.output);
    if (!counts || (run.exitCode === 0 && counts.failed > 0)) return outcome;
    totals.passed += counts.passed; totals.failed += counts.failed; totals.skipped += counts.skipped;
  }
  return `${outcome} · ${totals.passed} passed${totals.failed ? `, ${totals.failed} failed` : ""}${totals.skipped ? `, ${totals.skipped} skipped` : ""}`;
}
