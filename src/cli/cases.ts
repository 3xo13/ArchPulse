import * as path from "node:path";
import { pathToFileURL } from "node:url";
import { generateCases, type CasesResult } from "../core/cases.js";

export type RunCasesResult = CasesResult;
export function parseFlags(argv: string[]): Record<string,string> {
  const flags: Record<string,string> = {};
  for (let i=0; i<argv.length; i++) {
    const key = argv[i], value = argv[++i];
    if (!key?.startsWith("--") || !value || value.startsWith("--")) throw new Error(`Expected --option <value>, received '${key}'.`);
    flags[key.slice(2)] = value;
  }
  return flags;
}
export async function runCases(argv: string[]): Promise<RunCasesResult> {
  const flags = parseFlags(argv);
  if (!flags.snapshot) throw new Error("Missing required argument: --snapshot <path>");
  const result = await generateCases({ snapshotPath: flags.snapshot, repoRoot: flags.repo, outDir: flags.out, configPath: flags.config });
  console.log(`${result.caseCount} case(s) written to: ${result.outDir}`);
  for (const entry of result.cases) console.log(`${entry.caseId}: ${entry.rule} (${entry.violationCount} violations)`);
  for (const id of result.oversizedCases) console.error(`${id}: full packet exceeds 2 KiB; MCP returns a bounded summary.`);
  return result;
}
if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) {
  runCases(process.argv.slice(2)).catch(error => { console.error(String(error)); process.exitCode=2; });
}
