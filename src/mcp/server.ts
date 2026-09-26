#!/usr/bin/env node
import * as fs from "node:fs";
import * as path from "node:path";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod/v4";
import { runScan } from "../cli/scan.js";
import { ensureBaselineCases, getCase } from "../core/cases.js";
import { verifyCase } from "../core/verify.js";
import { trustedWorkspaceRoot, validateWithinWorkspace } from "../core/workspace.js";
import { internalPath } from "../core/storage.js";
export { validateWithinWorkspace } from "../core/workspace.js";

const server = new McpServer({ name: "archpulse", version: "0.1.0" });
function workspace(candidate?: string): string {
  const trusted = trustedWorkspaceRoot();
  const root=path.resolve(trusted,candidate ?? ".");
  validateWithinWorkspace(root,trusted);
  if (!fs.statSync(root).isDirectory()) throw new Error("workspacePath must be a directory.");
  return fs.realpathSync(root);
}
function output(root: string, directory: string | undefined, names: string[]): string {
  const out=path.resolve(root,directory ?? ".archpulse/latest");
  validateWithinWorkspace(out,root);
  for (const name of names) validateWithinWorkspace(path.join(out,name),root);
  return out;
}
/** Text is UTF-8 bounded; complete machine-readable data always remains on disk. */
function reply(text: string, isError = false) {
  const notice="\n[truncated; see the complete artifacts at the paths above]";
  if (Buffer.byteLength(text)>2048) {
    let bounded="";
    for (const char of text) { if (Buffer.byteLength(bounded+char+notice)>2048) break; bounded+=char; }
    text=bounded+notice;
  }
  return { content:[{type:"text" as const,text}], ...(isError ? {isError:true} : {}) };
}
const relative=(root:string,file:string)=>path.relative(root,file).replace(/\\/g,"/");
server.registerTool("scan_repository", {
  description:"Scan the repository and return an immutable baseline ID, artifact paths, and a bounded case index. Unresolved dependencies make coverage incomplete.",
  inputSchema:z.object({ workspacePath:z.string().optional(),outDir:z.string().optional() }),
},async ({workspacePath,outDir},extra)=>{
  try {
    const root=workspace(workspacePath);
    const out=output(root,outDir,["snapshot.json","graph.html","manifest.json"]);
    const scan=await runScan({repoRoot:root,outDir:out,signal:extra?.signal,workspaceOnly:true});
    const lines=[`Baseline: ${scan.baselineId}`,`Snapshot: ${scan.snapshotPath}`,`Graph: ${scan.graphPath}`,
      `Scan ${scan.incompleteResolutionCount ? "incomplete" : "complete"}: ${scan.violationCount} violation(s).`,
      `Unresolved dependency edges: ${scan.incompleteResolutionCount}`];
    if (fs.existsSync(path.join(root,"config/architecture.json"))) {
      try {
        const cases=await ensureBaselineCases(root,scan.baselineId,extra?.signal);
        lines.push(`Case index: ${relative(root,path.join(cases.caseDirectory,"index.json"))}`,`${cases.cases.length} case(s)`);
        for (const item of cases.cases.slice(0,10)) lines.push(`${item.caseId}: ${item.title ?? ""}`);
      } catch(error) {lines.push(`Case generation unavailable: ${String(error)}`);}
    } else lines.push("Case generation requires config/architecture.json.");
    for (const warning of scan.scannerWarnings.slice(0,10)) lines.push(`Warning: ${warning}`);
    if (!scan.violationCount) lines.push(scan.incompleteResolutionCount ? "No violations detected among resolved dependencies; coverage is incomplete." : "No rule violations detected.");
    for (const v of scan.violations.slice(0,10)) lines.push(`[${v.severity}] ${v.rule}: ${v.from} -> ${v.to}`);
    if (scan.violations.length>10) lines.push(`${scan.violations.length-10} more violation(s) in the snapshot.`);
    return reply(lines.join("\n"));
  } catch(error) { return reply(`scan_repository failed: ${String(error)}`,true); }
});
server.registerTool("get_case", {
  description:"Get a case from a captured baseline. Defaults to the latest successful baseline for this repository; full JSON and Markdown remain on disk.",
  inputSchema:z.object({caseId:z.string(),workspacePath:z.string().optional(),baselineId:z.string().optional()}),
},async ({caseId,workspacePath,baselineId},extra)=>{
  try {
    const root=workspace(workspacePath);
    if(baselineId)validateWithinWorkspace(path.resolve(root,baselineId),root);
    const selected=await getCase(root,caseId,baselineId,extra?.signal);
    const p=selected.packet;
    return reply([`Baseline: ${selected.baselineId}`,`Packet: ${relative(root,selected.packetPath)}`,
      `Markdown: ${relative(root,selected.packetPath.replace(/\.json$/,".md"))}`,`${p.caseId}: ${p.title}`,
      `${p.violations.length} selected violation(s)`, `Files: ${p.primaryFiles.join(", ")}`,`Tests: ${p.relevantTests.join(", ")}`,
      p.ruleExplanation,p.expectedEndCondition].join("\n"));
  } catch(error) {return reply(`get_case failed: ${String(error)}`,true);}
});
server.registerTool("verify_case", {
  description:"Run every configured test and typecheck, rescan with baseline settings, and write result.json/result.md. Only repository-configured commands execute.",
  inputSchema:z.object({caseId:z.string(),baselineId:z.string(),workspacePath:z.string().optional(),outDir:z.string().optional()}),
},async ({caseId,baselineId,workspacePath,outDir},extra)=>{
  try {
    const root=workspace(workspacePath);
    validateWithinWorkspace(path.resolve(root,baselineId),root);
    const out=outDir ? output(root,outDir,["result.json","result.md","execution.json"]) : undefined;
    // Validate the default storage root before verification starts.
    internalPath(root,"verifications");
    const {result,resultPath}=await verifyCase({repoRoot:root,caseId,baselineId,outDir:out,signal:extra?.signal,workspaceOnly:true});
    return reply(`${resultPath ? `Result: ${relative(root,resultPath)}` : "Report not saved."}\n${result.status}: ${result.reason}\nTests: ${result.testExitCode}; typechecks: ${result.typecheckExitCode}`,result.status==="invalid");
  } catch(error) {return reply(`verify_case failed: ${String(error)}`,true);}
});
server.connect(new StdioServerTransport()).then(()=>console.error("[archpulse] MCP server running on stdio")).catch(error=>{
  console.error("[archpulse] Fatal error:",error); process.exitCode=1;
});
