import { it,expect } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import { fileURLToPath,pathToFileURL } from "node:url";
import { createRequire } from "node:module";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { ListRootsRequestSchema } from "@modelcontextprotocol/sdk/types.js";
import { runProcess } from "../core/process.js";
import { validateReport } from "../viewer/report.js";

const repo=path.resolve(path.dirname(fileURLToPath(import.meta.url)),"../..");
const loader=pathToFileURL(createRequire(import.meta.url).resolve("tsx/esm")).href;
const text=(response:unknown)=>(response as {content:Array<{text:string}>}).content.map(c=>c.text).join("\n");
it("runs global MCP discovery, approved CLI setup, repair verification and viewer import without project metadata",{timeout:120000},async()=>{
  const temp=fs.mkdtempSync(path.join(os.tmpdir(),"archpulse global ")),root=path.join(temp,"project"),storage=path.join(temp,"storage");
  fs.mkdirSync(root);fs.writeFileSync(path.join(root,"a.js"),"import './b.js'; export const a=1;");fs.writeFileSync(path.join(root,"b.js"),"import './a.js';");
  fs.writeFileSync(path.join(root,"package.json"),JSON.stringify({name:"global-test",type:"module",scripts:{test:"node --test test.mjs",typecheck:"node --check a.js"}}));
  fs.writeFileSync(path.join(root,"test.mjs"),"import {test} from 'node:test'; import assert from 'node:assert/strict'; test('value',async()=>assert.equal((await import('./a.js')).a,1));");
  const originalFiles=fs.readdirSync(root).sort();
  const transport=new StdioClientTransport({command:process.execPath,args:["--import",loader,path.join(repo,"src/mcp/server.ts")],cwd:repo,stderr:"pipe",
    env:{...Object.fromEntries(Object.entries(process.env).filter((e):e is [string,string]=>e[1]!==undefined)),ARCHPULSE_MODE:"global",ARCHPULSE_STORAGE:storage}});
  const client=new Client({name:"global-test",version:"1"},{capabilities:{roots:{listChanged:true}}});
  let roots=[{uri:pathToFileURL(root).href,name:"project"}];
  client.setRequestHandler(ListRootsRequestSchema,async()=>({roots}));
  const cli=(...args:string[])=>runProcess(process.execPath,["--import",loader,path.join(repo,"src/cli/index.ts"),...args,"--repo",root,"--storage-base",storage],{cwd:repo,timeoutMs:45000});
  try{
    await client.connect(transport);
    const first=await client.callTool({name:"scan_repository",arguments:{}});expect(first.isError,text(first)).not.toBe(true);expect(text(first)).toContain("configure");
    expect(fs.readdirSync(root).sort()).toEqual(originalFiles);
    const proposal=await cli("configure");expect(proposal.exitCode,proposal.output).toBe(0);
    const id=proposal.stdout.match(/"id": "([^"]+)"/)![1]!;
    expect((await cli("configure","--approve",id)).exitCode).toBe(0);
    const scanned=await client.callTool({name:"scan_repository",arguments:{workspacePath:root}});expect(scanned.isError,text(scanned)).not.toBe(true);
    const baseline=text(scanned).match(/^Baseline: (.+)$/m)![1]!;
    const selected=await client.callTool({name:"get_case",arguments:{caseId:"case-001",baselineId:baseline}});expect(selected.isError,text(selected)).not.toBe(true);
    const packetPath=text(selected).match(/^Packet: (.+)$/m)![1]!;
    fs.writeFileSync(path.join(root,"b.js"),"export const b=1;");
    const verified=await client.callTool({name:"verify_case",arguments:{caseId:"case-001",baselineId:baseline}});
    expect(text(verified)).toContain("verified:");
    const resultPath=text(verified).match(/^Result: (.+)$/m)![1]!;
    const execution=JSON.parse(fs.readFileSync(path.join(path.dirname(resultPath),"execution.json"),"utf8"));
    const read=(file:string)=>JSON.parse(fs.readFileSync(file,"utf8"));
    expect(()=>validateReport({before:read(baseline),packet:read(packetPath),result:read(resultPath),after:read(execution.afterSnapshotPath),execution})).not.toThrow();
    const escaped=await client.callTool({name:"scan_repository",arguments:{outDir:root}});expect(escaped.isError).toBe(true);
    roots=[...roots,{uri:pathToFileURL(repo).href,name:"other"}];
    const ambiguous=await client.callTool({name:"scan_repository",arguments:{}});expect(ambiguous.isError).toBe(true);
    const outside=await client.callTool({name:"scan_repository",arguments:{workspacePath:temp}});expect(outside.isError).toBe(true);
    roots=[];
    const missing=await client.callTool({name:"scan_repository",arguments:{}});expect(missing.isError).toBe(true);
    const explicit=await client.callTool({name:"get_case",arguments:{workspacePath:root,caseId:"case-001",baselineId:baseline}});expect(explicit.isError,text(explicit)).not.toBe(true);
    expect(fs.readdirSync(root).sort()).toEqual(originalFiles);
  }finally{await client.close();fs.rmSync(temp,{recursive:true,force:true});}
});
