import * as fs from "node:fs";
import * as path from "node:path";
import { randomUUID } from "node:crypto";
import { runScan } from "../cli/scan.js";
import { getCase } from "./cases.js";
import { compareSnapshots, type CompareResult } from "./compare.js";
import { runConfiguredCommand, type RunResult } from "./runner.js";
import { architectureSchema, caseSnapshotSchema } from "./validation.js";
import { boundedOutput } from "./process.js";
import { policyHash, sourceState } from "./provenance.js";
import { assertMutableOutput, internalPath, json, publishFiles, readJson, RepositoryBusyError, withRepositoryLock } from "./storage.js";
import { projectContext, validateArtifact } from "./project.js";
import { approvedChecks } from "./policy.js";

export interface VerifyResult extends CompareResult {
  caseId: string; testCommand: string; testExitCode: number; testOutput: string; typecheckExitCode: number;
}
export interface VerifyOptions { repoRoot?: string; baselineId: string; caseId: string; outDir?: string;
  signal?: AbortSignal; commandTimeoutMs?: number; timeoutMs?: number; workspaceOnly?: boolean; }
class SourceChangedError extends Error {}
const aggregate = (runs: RunResult[]) => runs.length ? (runs.find(run=>run.exitCode!==0)?.exitCode ?? (runs.some(run=>run.exitCode===null) ? -1 : 0)) : -1;

export async function verifyCase(options: VerifyOptions): Promise<{ result: VerifyResult; resultPath?: string; afterSnapshotPath?: string }> {
  const root = fs.realpathSync(path.resolve(options.repoRoot ?? process.cwd()));
  const output = path.resolve(projectContext(root)?.storage??root, options.outDir ?? internalPath(root,"verifications",randomUUID()));
  assertMutableOutput(root,output);
  if(options.workspaceOnly||projectContext(root))validateArtifact(output,root);
  const controller = new AbortController();
  const deadline = Date.now() + (options.timeoutMs ?? 600_000);
  const timeout = setTimeout(()=>controller.abort(new Error("Verification deadline exceeded")),options.timeoutMs ?? 600_000);
  const abort = () => controller.abort(options.signal?.reason);
  options.signal?.addEventListener("abort",abort,{once:true});
  if (options.signal?.aborted) abort();
  try {
    const checkActive = () => {
      if (Date.now() >= deadline) controller.abort(new Error("Verification deadline exceeded"));
      controller.signal.throwIfAborted();
    };
    const isCancellation = (error: unknown) => controller.signal.aborted &&
      (error === controller.signal.reason || (error instanceof Error && error.name === "AbortError" && error.cause === controller.signal.reason));
    const tests: RunResult[] = [], types: RunResult[] = [];
    let expectedTests=0, expectedTypes=0;
    let afterSnapshotPath: string | undefined;
    let diagnosticSnapshotPath: string | undefined;
    let checkedState: string | undefined;
    const reportFiles = ["result.json", "result.md", "execution.json"].map(name => path.join(output, name));
    const state=(ignored:string[])=>sourceState(root,ignored)+(projectContext(root)?policyHash(root):"");
    const checkState = (staged: string[] = []) => {
      const currentState = checkedState === undefined ? undefined : state([...reportFiles, ...staged]);
      checkActive(); // Hashing is synchronous: the timeout callback may not have run yet.
      if (checkedState !== currentState) {
        throw new SourceChangedError("Source or configuration changed during verification; retry with a stable workspace.");
      }
    };
    let result: VerifyResult = { caseId: options.caseId, baselineId: "", afterId: "", resolvedViolations: [],
      persistentViolations: [], newViolations: [], testCommand: "", testExitCode: -1, testOutput: "",
      typecheckExitCode: -1, status: "invalid", reason: "Verification did not run." };
    try {
      checkActive();
      const baseline = await getCase(root,options.caseId,options.baselineId,controller.signal);
      const before = caseSnapshotSchema.parse(readJson(baseline.snapshotPath));
      result.baselineId=before.gitMarker;
      if (before.incompleteResolutionCount) throw new Error("Baseline contains unresolved dependencies; rescan after fixing resolution.");
      if(baseline.manifest.coverageIncomplete)throw new Error("Baseline coverage is incomplete or unsupported; resolve discovery warnings and rescan before verification.");
      if (policyHash(root)!==baseline.manifest.policyHash) throw new Error("Verification policy changed; capture a fresh baseline.");
      const approval=projectContext(root)?approvedChecks(root):undefined;
      const config=approval?{testCommands:approval.tests.map(c=>c.command),typecheckCommands:approval.typechecks.map(c=>c.command)}:architectureSchema.parse(readJson(path.join(root,"config/architecture.json")));
      if (!config.testCommands.length || !config.typecheckCommands?.length) throw new Error("Full verification requires nonempty testCommands and typecheckCommands.");
      expectedTests=config.testCommands.length;expectedTypes=config.typecheckCommands.length;
      checkedState=state(reportFiles);
      checkActive();
      for (const [kind,commands,runs] of [["testCommands",config.testCommands,tests],["typecheckCommands",config.typecheckCommands,types]] as const) {
        for (let i=0;i<commands.length;i++) {
          checkActive();
          if (policyHash(root)!==baseline.manifest.policyHash) throw new Error("Verification policy changed during checks.");
          runs.push(await runConfiguredCommand(kind,i,root,{signal:controller.signal,timeoutMs:options.commandTimeoutMs ?? 120_000}));
        }
      }
      checkActive();
      const after=await runScan({ repoRoot:root,configPath:baseline.manifest.automatic?undefined:baseline.manifest.configPath,scanScope:baseline.manifest.scope,
        outDir:internalPath(root,"verification-work",randomUUID()),signal:controller.signal,timeoutMs:120_000,workspaceOnly:options.workspaceOnly });
      diagnosticSnapshotPath=path.resolve(root,after.baselineId);
      checkActive();
      if(after.coverageIncomplete)throw new Error("Fresh scan has incomplete or unsupported coverage; resolve discovery warnings and retry.");
      checkState();
      const comparison=compareSnapshots(baseline.snapshotPath,diagnosticSnapshotPath,baseline.packet);
      const afterSnapshot=caseSnapshotSchema.parse(readJson(diagnosticSnapshotPath));
      afterSnapshotPath=diagnosticSnapshotPath;
      diagnosticSnapshotPath=undefined;
      result={...result,...comparison,persistentViolations:afterSnapshot.violations.filter(v=>before.violations.some(old=>old.id===v.id))};
      if (comparison.status!=="invalid" && (aggregate(tests)!==0 || aggregate(types)!==0)) {
        result.status="failed"; result.reason="Required tests or typechecks failed. " + comparison.reason;
      }
      const unrelated=result.persistentViolations.filter(v=>!baseline.packet.violations.some(selected=>selected.id===v.id)).length;
      if (unrelated) result.reason+=` ${unrelated} unrelated baseline violation(s) remain outside the selected case.`;
      if (result.status==="verified") result.reason=`All ${baseline.packet.violations.length} selected violations resolved; no new violations. All configured tests and typechecks passed.${unrelated ? ` ${unrelated} unrelated baseline violation(s) remain.` : ""}`;
    } catch (error) {
      result.status=controller.signal.aborted ? "failed" : "invalid";
      result.reason=controller.signal.aborted ? "Verification cancelled or overall deadline exceeded; remaining checks were not run." : String(error);
    }
    result.testCommand=tests.map(run=>run.command).join("\n");
    result.testExitCode=aggregate(tests); result.typecheckExitCode=aggregate(types);
    if(tests.length<expectedTests && result.testExitCode===0)result.testExitCode=-1;
    if(types.length<expectedTypes && result.typecheckExitCode===0)result.typecheckExitCode=-1;
    const captured=boundedOutput();
    for (const run of [...tests,...types]) captured.collect(`$ ${run.command}\nExit: ${run.exitCode}\n${run.output}\n`);
    result.testOutput=captured.value();
    const resultPath=path.join(output,"result.json");
    if(options.workspaceOnly||projectContext(root))for(const name of ["result.json","result.md","execution.json"])validateArtifact(path.join(output,name),root);
    const discardComparison = () => {
      diagnosticSnapshotPath=afterSnapshotPath ?? diagnosticSnapshotPath; afterSnapshotPath=undefined;
      result.afterId=""; result.resolvedViolations=[]; result.persistentViolations=[]; result.newViolations=[];
    };
    const publish = (beforeCommit?: (staged: string[]) => void, beforeFinalize?: () => void) => publishFiles(new Map([
      [resultPath,json(result)], [path.join(output,"result.md"),`# Verification: ${result.status}\n\n${result.reason}\n\nTests: ${result.testExitCode}\n\nTypecheck: ${result.typecheckExitCode}\n\n\`\`\`text\n${result.testOutput}\n\`\`\`\n`],
      [path.join(output,"execution.json"),json({ tests, typechecks:types, expectedTests, expectedTypes, afterSnapshotPath, diagnosticSnapshotPath })],
    ]), beforeCommit, beforeFinalize);
    try {
      await withRepositoryLock(root, () => {
        checkActive();
        try {
          checkState();
          publish(staged => { checkActive(); checkState(staged); }, checkActive);
        } catch (error) {
          if (!(error instanceof SourceChangedError)) throw error;
          discardComparison(); result.status="invalid"; result.reason=error.message;
          publish(checkActive, checkActive);
        }
      }, controller.signal);
    } catch (error) {
      if (!isCancellation(error)) throw error;
      if (result.status === "invalid") discardComparison();
      result.status = "failed";
      result.reason = "Verification cancelled or overall deadline exceeded; success was not published.";
      try {
        await withRepositoryLock(root, () => publish(), undefined, 0);
      } catch (failure) {
        if (!(failure instanceof RepositoryBusyError)) throw failure;
        result.reason += " Report not saved: repository is busy; previous artifacts were preserved.";
        return { result, afterSnapshotPath };
      }
    }
    return { result, resultPath, afterSnapshotPath };
  } finally {
    clearTimeout(timeout); options.signal?.removeEventListener("abort",abort);
  }
}
