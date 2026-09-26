#!/usr/bin/env node
import * as fs from "node:fs";
import * as path from "node:path";
import { runScan } from "./scan.js";
import { runCases, parseFlags } from "./cases.js";
import { getComparisonCase } from "../core/cases.js";
import { compareSnapshots } from "../core/compare.js";
import { verifyCase } from "../core/verify.js";
import { assertMutableOutput, json, publishFiles, withRepositoryLock } from "../core/storage.js";

const command=process.argv[2] ?? "help";
const args=process.argv.slice(3);
const controller=new AbortController();
process.once("SIGINT",()=>controller.abort());
try {
  if (command==="help" || command==="--help") {
    console.log(`ArchPulse CLI
scan [--repo <path>] [--out <dir>] [--config <file>] [--scope <path>]
cases --snapshot <path> [--repo <path>] [--out <dir>]
compare --before <snapshot> --after <snapshot> --case <id> [--repo <path>] [--out <dir>]
verify --before <baseline> --case <id> [--repo <path>] [--out <dir>]
compare checks architecture only; verify runs tests, typechecks, and a fresh scan.`);
  } else if (command==="cases") {
    await runCases(args);
  } else {
    const flags=parseFlags(args);
    const root=fs.realpathSync(path.resolve(flags.repo ?? process.cwd()));
    if (command==="scan") {
      const summary=await runScan({repoRoot:root,outDir:flags.out,configPath:flags.config,scanScope:flags.scope,signal:controller.signal});
      console.log(`Scan ${summary.incompleteResolutionCount ? "incomplete" : "complete"}: ${summary.violationCount} violation(s).`);
      console.log(`Baseline: ${summary.baselineId}\nSnapshot: ${summary.snapshotPath}\nGraph: ${summary.graphPath}`);
      console.log(`Unresolved dependency edges: ${summary.incompleteResolutionCount}`);
      for (const warning of summary.scannerWarnings) console.log(`Warning: ${warning}`);
      for (const v of summary.violations) console.log(`[${v.severity}] ${v.rule}: ${v.from} -> ${v.to}`);
    } else if (command==="compare" || command==="verify") {
      if (!flags.before || !flags.case) throw new Error("--before and --case are required.");
      if (command==="verify") {
        const {result,resultPath}=await verifyCase({repoRoot:root,baselineId:flags.before,caseId:flags.case,outDir:flags.out,signal:controller.signal});
        console.log(`${result.status}: ${result.reason}\nResult: ${resultPath}`);
        process.exitCode=result.status==="verified" ? 0 : result.status==="invalid" ? 2 : 1;
      } else {
        if (!flags.after) throw new Error("--after is required for architecture-only comparison.");
        const before=path.resolve(root,flags.before);
        const selected=await getComparisonCase(root,flags.before,flags.case);
        const result=compareSnapshots(before,path.resolve(root,flags.after),selected);
        const out=path.resolve(root,flags.out ?? ".archpulse/comparison");
        assertMutableOutput(root,out);
        await withRepositoryLock(root,()=>publishFiles(new Map([[path.join(out,"comparison.json"),json(result)]])));
        console.log(`${result.status}: ${result.reason}\nArchitecture only; tests and typechecks were not run.`);
        process.exitCode=result.status==="verified" ? 0 : result.status==="invalid" ? 2 : 1;
      }
    } else throw new Error(`Unknown command: ${command}`);
  }
} catch (error) { console.error(String(error)); process.exitCode=2; }
