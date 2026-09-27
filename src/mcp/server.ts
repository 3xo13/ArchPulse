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
import { createLifecycle } from "./lifecycle.js";
import { internalPath } from "../core/storage.js";
import { fileURLToPath } from "node:url";
import { createProjectContext, withProject, projectContext, validateArtifact, artifactName } from "../core/project.js";
import { approvedChecks } from "../core/policy.js";
import { createGraphPreview } from "./graph-preview.js";
export { validateWithinWorkspace } from "../core/workspace.js";

const server = new McpServer({ name: "archpulse", version: "0.1.0" });
const graphPreview = createGraphPreview();
const lifecycle = createLifecycle(async () => { try { await server.close(); } finally { await graphPreview.close(); } });
async function previewGraph(root: string, snapshot: string): Promise<string> {
  const graph = path.join(path.dirname(path.resolve(root, snapshot)), "graph.html");
  validateArtifact(graph, root);
  return graphPreview.add(fs.readFileSync(graph, "utf8"));
}
async function workspace(candidate?: string): Promise<string> {
  if(process.env.ARCHPULSE_MODE==="global"){
    let roots:string[]=[];
    if(server.server.getClientCapabilities()?.roots){
      roots=(await server.server.listRoots()).roots.filter(r=>r.uri.startsWith("file:")).map(r=>fs.realpathSync(fileURLToPath(r.uri)));
    }
    if(!candidate){if(roots.length!==1)throw new Error("Specify an absolute workspacePath; no single client workspace is available.");candidate=roots[0]!;}
    if(!path.isAbsolute(candidate))throw new Error("Global mode requires an absolute workspacePath.");
    const selected=fs.realpathSync(candidate);
    if(!fs.statSync(selected).isDirectory())throw new Error("workspacePath must be a directory.");
    if(roots.length&&!roots.some(root=>{try{validateWithinWorkspace(selected,root);return true;}catch{return false;}}))throw new Error("workspacePath is outside the client workspace roots.");
    return selected;
  }
  const trusted = trustedWorkspaceRoot();
  const root=path.resolve(trusted,candidate ?? ".");
  validateWithinWorkspace(root,trusted);
  if (!fs.statSync(root).isDirectory()) throw new Error("workspacePath must be a directory.");
  return fs.realpathSync(root);
}
function operation(candidate:string|undefined,action:(root:string)=>Promise<ReturnType<typeof reply>>):Promise<ReturnType<typeof reply>>{
  return lifecycle.run(async()=>{
    const root=await workspace(candidate);
    return process.env.ARCHPULSE_MODE==="global"?withProject(createProjectContext(root),()=>action(root)):action(root);
  }).catch(error=>reply(`Workspace selection failed: ${String(error)}`,true));
}
function output(root: string, directory: string | undefined, names: string[]): string {
  const out=path.resolve(projectContext(root)?.storage??root,directory ?? (projectContext(root)?"latest":".archpulse/latest"));
  validateArtifact(out,root);
  for (const name of names) validateArtifact(path.join(out,name),root);
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
const relative=artifactName;
server.registerTool("scan_repository", {
  description:"Scan and return a browser graph link, exact immutable baseline path, cases, and next step. Show the graph link to the user, then retrieve a case and propose a repair for approval. Never shorten the baseline path to a UUID. Incomplete coverage blocks verification.",
  inputSchema:z.object({ workspacePath:z.string().optional(),outDir:z.string().optional() }),
},async ({workspacePath,outDir},extra)=>operation(workspacePath,async(root)=>{
  try {
    const out=output(root,outDir,["snapshot.json","graph.html","manifest.json"]);
    const scan=await runScan({repoRoot:root,outDir:out,signal:extra?.signal,workspaceOnly:true});
    let preview: string | undefined;
    try { preview = await previewGraph(root, scan.baselineId); }
    catch(error) { console.error("[archpulse] Graph preview unavailable:", String(error)); }
    const lines=[...(preview ? [`[Open dependency graph](${preview})`, `Browser preview: ${preview}`] : []),
      `Baseline: ${scan.baselineId}`,`Snapshot: ${scan.snapshotPath}`,`Graph: ${scan.graphPath}`,
      `Scan ${scan.incompleteResolutionCount||scan.coverageIncomplete ? "incomplete" : "complete"}: ${scan.violationCount} violation(s).`,
      `Unresolved dependency edges: ${scan.incompleteResolutionCount}`];
    let next = "Next: inspect the graph and reported coverage; no repair case is available.";
    if (projectContext(root)||fs.existsSync(path.join(root,"config/architecture.json"))) {
      try {
        const cases=await ensureBaselineCases(root,scan.baselineId,extra?.signal);
        if (cases.cases.length) next = `Next: call get_case for ${cases.cases[0]!.caseId} with the exact Baseline path above, inspect its files, then present a concrete repair plan for approval. Do not edit yet.`;
        lines.push(`Case index: ${relative(root,path.join(cases.caseDirectory,"index.json"))}`,`${cases.cases.length} case(s)`);
        for (const item of cases.cases.slice(0,10)) lines.push(`${item.caseId}: ${item.title ?? ""}`);
      } catch(error) {lines.push(`Case generation unavailable: ${String(error)}`);}
    } else lines.push("Case generation requires config/architecture.json.");
    if(projectContext(root)){
      lines.push("Generic rules do not establish project-specific architecture compliance.");
      try{const checks=approvedChecks(root);lines.push(checks.tests.length&&checks.typechecks.length?"Checks approved (not run).":"Full verification unavailable: approved policy needs both tests and typechecks.");}catch{lines.push("Scanning needs no command approval. For full verification, run archpulse setup in the project terminal after registering the launcher; see the installed skill for the fallback command. Then capture a fresh baseline.");}
    }
    for (const warning of scan.scannerWarnings.slice(0,10)) lines.push(`Warning: ${warning}`);
    if (!scan.violationCount) lines.push(scan.incompleteResolutionCount||scan.coverageIncomplete ? "No violations detected among resolved dependencies; coverage is incomplete." : "No rule violations detected.");
    for (const v of scan.violations.slice(0,10)) lines.push(`[${v.severity}] ${v.rule}: ${v.from} -> ${v.to}`);
    if (scan.violations.length>10) lines.push(`${scan.violations.length-10} more violation(s) in the snapshot.`);
    // Keep the graph and next action ahead of verbose diagnostics under the 2 KiB cap.
    lines.splice(preview ? 2 : 0, 0, next);
    return reply(lines.join("\n"));
  } catch(error) { return reply(`scan_repository failed: ${String(error)}`,true); }
}));
server.registerTool("get_case", {
  description:"Get a case from a captured baseline. Defaults to the latest successful baseline for this repository; full JSON and Markdown remain on disk.",
  inputSchema:z.object({caseId:z.string(),workspacePath:z.string().optional(),baselineId:z.string().optional()}),
},async ({caseId,workspacePath,baselineId},extra)=>operation(workspacePath,async(root)=>{
  try {
    if(baselineId){
      const file=path.resolve(root,baselineId),legacy=path.relative(path.join(root,".archpulse/scans"),file);
      if(projectContext(root)&&!path.isAbsolute(legacy)&&legacy!==".."&&!legacy.startsWith(`..${path.sep}`))validateWithinWorkspace(file,root);
      else validateArtifact(file,root);
    }
    const selected=await getCase(root,caseId,baselineId,extra?.signal);
    const p=selected.packet;
    return reply([`Baseline: ${selected.baselineId}`,`Packet: ${relative(root,selected.packetPath)}`,
      `Markdown: ${relative(root,selected.packetPath.replace(/\.json$/,".md"))}`,`${p.caseId}: ${p.title}`,
      `${p.violations.length} selected violation(s)`, `Files: ${p.primaryFiles.join(", ")}`,`Tests: ${p.relevantTests.join(", ")}`,
      p.ruleExplanation,p.expectedEndCondition].join("\n"));
  } catch(error) {return reply(`get_case failed: ${String(error)}`,true);}
}));
server.registerTool("verify_case", {
  description:"Run every configured test and typecheck, rescan with baseline settings, and write result.json/result.md. Only repository-configured commands execute.",
  inputSchema:z.object({caseId:z.string(),baselineId:z.string(),workspacePath:z.string().optional(),outDir:z.string().optional()}),
},async ({caseId,baselineId,workspacePath,outDir},extra)=>operation(workspacePath,async(root)=>{
  try {
    validateArtifact(path.resolve(root,baselineId),root);
    const out=outDir ? output(root,outDir,["result.json","result.md","execution.json"]) : undefined;
    // Validate the default storage root before verification starts.
    internalPath(root,"verifications");
    const {result,resultPath,afterSnapshotPath}=await verifyCase({repoRoot:root,caseId,baselineId,outDir:out,signal:extra?.signal,workspaceOnly:true});
    const lines=[`${resultPath ? `Result: ${relative(root,resultPath)}` : "Report not saved."}`,`${result.status}: ${result.reason}`,`Tests: ${result.testExitCode}; typechecks: ${result.typecheckExitCode}`];
    if (afterSnapshotPath && result.afterId) {
      try { lines.push(`[Open after graph](${await previewGraph(root,afterSnapshotPath)})`); }
      catch(error) { console.error("[archpulse] After graph preview unavailable:", String(error)); }
      lines.push(`After snapshot: ${relative(root,afterSnapshotPath)}`,`After graph: ${relative(root,path.join(path.dirname(afterSnapshotPath),"graph.html"))}`);
    }
    lines.push(result.status==="verified" ? "Next: review the result and remaining violations. Ask before repairing another case." : "Next: explain the blockers or failed checks and propose the next action; do not claim success.");
    return reply(lines.join("\n"),result.status==="invalid");
  } catch(error) {return reply(`verify_case failed: ${String(error)}`,true);}
}));
lifecycle.listen();
server.connect(new StdioServerTransport()).then(()=>console.error("[archpulse] MCP server running on stdio")).catch(error=>{
  console.error("[archpulse] Fatal error:",error); process.exitCode=1; void lifecycle.stop();
});
