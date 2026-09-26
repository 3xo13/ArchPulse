#!/usr/bin/env node
import * as fs from "node:fs";
import * as path from "node:path";
import { runScan } from "./scan.js";
import { runCases, parseFlags } from "./cases.js";
import { getComparisonCase } from "../core/cases.js";
import { compareSnapshots } from "../core/compare.js";
import { verifyCase } from "../core/verify.js";
import { assertMutableOutput, json, publishFiles, withRepositoryLock } from "../core/storage.js";
import { createProjectContext, withProject, projectContext } from "../core/project.js";
import { discoverProject } from "../core/discovery.js";
import { configureProject, proposeChecks, approvedChecks } from "../core/policy.js";
import { ensureBaselineCases } from "../core/cases.js";

const command=process.argv[2] ?? "help";
const args=process.argv.slice(3);
const controller=new AbortController();
process.once("SIGINT",()=>controller.abort());
process.once("SIGTERM",()=>controller.abort());
async function dispatch() {
  if (command==="help" || command==="--help") {
    console.log(`ArchPulse CLI
scan [--repo <path>] [--out <dir>] [--config <file>] [--scope <path>]
cases --snapshot <path> [--repo <path>] [--out <dir>]
compare --before <snapshot> --after <snapshot> --case <id> [--repo <path>] [--out <dir>]
verify --before <baseline> --case <id> [--repo <path>] [--out <dir>]
inspect --repo <path> [--storage-base <dir>]
configure --repo <path> [--approve <proposal-id>] [--storage-base <dir>]
Use --storage external for setup-free scanning; unconfigured scan targets select it automatically.
compare checks architecture only; verify runs tests, typechecks, and a fresh scan.`);
  } else if (command==="cases") {
    await runCases(args,controller.signal);
  } else {
    const flags=parseFlags(args);
    const root=fs.realpathSync(path.resolve(flags.repo ?? process.cwd()));
    if(command==="inspect"){
      let readiness="Checks not approved";try{approvedChecks(root);readiness="Approved; capture a fresh baseline before repair";}catch(error){readiness=String(error);}
      console.log(json({discovery:discoverProject(root),checks:proposeChecks(root),readiness,storage:projectContext(root)?.storage}));
    }else if(command==="configure"){
      const configured=await configureProject(root,flags.approve,controller.signal);
      console.log(json(configured));
      console.log(configured.approved?"Checks approved. Capture a fresh baseline before repair.":`Review this proposal, then run configure --repo "${root}" --approve ${configured.proposal.id}.`);
    }else if (command==="scan") {
      const summary=await runScan({repoRoot:root,outDir:flags.out,configPath:flags.config,scanScope:flags.scope,signal:controller.signal});
      console.log(`Scan ${summary.incompleteResolutionCount||summary.coverageIncomplete ? "incomplete" : "complete"}: ${summary.violationCount} violation(s).`);
      console.log(`Baseline: ${summary.baselineId}\nSnapshot: ${summary.snapshotPath}\nGraph: ${summary.graphPath}`);
      console.log(`Unresolved dependency edges: ${summary.incompleteResolutionCount}`);
      for (const warning of summary.scannerWarnings) console.log(`Warning: ${warning}`);
      for (const v of summary.violations) console.log(`[${v.severity}] ${v.rule}: ${v.from} -> ${v.to}`);
      if(projectContext(root)){
        const cases=await ensureBaselineCases(root,summary.baselineId,controller.signal);
        console.log(`Cases: ${cases.caseDirectory} (${cases.cases.length})\nGeneric scans check import cycles; configure project-specific architecture rules externally.`);
      }
    } else if (command==="compare" || command==="verify") {
      if (!flags.before || !flags.case) throw new Error("--before and --case are required.");
      if (command==="verify") {
        const {result,resultPath}=await verifyCase({repoRoot:root,baselineId:flags.before,caseId:flags.case,outDir:flags.out,signal:controller.signal});
        console.log(`${result.status}: ${result.reason}\n${resultPath ? `Result: ${resultPath}` : "Report not saved."}`);
        process.exitCode=result.status==="verified" ? 0 : result.status==="invalid" ? 2 : 1;
      } else {
        if (!flags.after) throw new Error("--after is required for architecture-only comparison.");
        const before=path.resolve(root,flags.before);
        const selected=await getComparisonCase(root,flags.before,flags.case,controller.signal);
        const result=compareSnapshots(before,path.resolve(root,flags.after),selected);
        const out=path.resolve(projectContext(root)?.storage??root,flags.out ?? (projectContext(root)?"comparison":".archpulse/comparison"));
        assertMutableOutput(root,out);
        await withRepositoryLock(root,()=>publishFiles(new Map([[path.join(out,"comparison.json"),json(result)]]),
          () => controller.signal.throwIfAborted()),controller.signal);
        console.log(`${result.status}: ${result.reason}\nArchitecture only; tests and typechecks were not run.`);
        process.exitCode=result.status==="verified" ? 0 : result.status==="invalid" ? 2 : 1;
      }
    } else throw new Error(`Unknown command: ${command}`);
  }
}
try {
  const flags=command==="help"||command==="--help"?{}:parseFlags(args);
  const root=path.resolve(flags.repo??process.cwd());
  const baseline=flags.before??flags.snapshot;
  const baselineRelative=baseline?path.relative(root,path.resolve(root,baseline)):"";
  const external=["inspect","configure"].includes(command)||flags.storage==="external"||Boolean(flags["storage-base"])||
    (command==="scan"&&!fs.existsSync(path.join(root,".dependency-cruiser.cjs")))||
    Boolean(baseline&&path.isAbsolute(baseline)&&(path.isAbsolute(baselineRelative)||baselineRelative===".."||baselineRelative.startsWith(`..${path.sep}`)));
  if(external)await withProject(createProjectContext(root,flags["storage-base"]),dispatch);else await dispatch();
} catch (error) { console.error(String(error)); process.exitCode=controller.signal.aborted ? 1 : 2; }
