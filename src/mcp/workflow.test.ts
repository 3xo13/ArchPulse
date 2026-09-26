import { it, expect, afterEach } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import { createRequire } from "node:module";
import { fileURLToPath, pathToFileURL } from "node:url";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { runProcess } from "../core/process.js";
import { json } from "../core/storage.js";

const repo=path.resolve(path.dirname(fileURLToPath(import.meta.url)),"../..");
const loader=pathToFileURL(createRequire(import.meta.url).resolve("tsx/esm")).href;
const temporary:string[]=[];
function fixture() {
  const root=fs.mkdtempSync(path.join(os.tmpdir(),"archpulse external protocol "));temporary.push(root);
  const write=(name:string,value:string)=>{const file=path.join(root,name);fs.mkdirSync(path.dirname(file),{recursive:true});fs.writeFileSync(file,value);};
  write("package.json",json({type:"module",name:"external-demo"}));
  write(".dependency-cruiser.cjs",'module.exports={forbidden:[{name:"boundary",severity:"error",from:{path:"a.js$"},to:{path:"b.js$"}}]};');
  write("src/a.js",'import "./b.js"; export const a=1;');write("src/b.js","export const b=1;");
  write("checks/test.cjs",'const {test}=require("node:test");const assert=require("node:assert/strict");test("a",async()=>assert.equal((await import("../src/a.js")).a,1));');
  write("config/architecture.json",json({schemaVersion:"1",layers:[],allowedDependencies:[],forbiddenDependencies:[],scanScope:"src",
    testCommands:["node --test checks/test.cjs"],typecheckCommands:[`node "${createRequire(import.meta.url).resolve("typescript/bin/tsc")}" --noEmit --allowJs --checkJs --skipLibCheck --target es2022 src/a.js src/b.js`]}));
  return {root,write};
}
afterEach(()=>{for(const root of temporary.splice(0))fs.rmSync(root,{recursive:true,force:true});});
const text=(response:unknown):string=>(response as {content:Array<{text:string}>}).content.map(c=>c.text).join("\n");
it("runs the real MCP protocol in an external workspace without polluting stdout",{timeout:60000},async()=>{
  const f=fixture();
  const transport=new StdioClientTransport({command:process.execPath,args:["--import",loader,path.join(repo,"src/mcp/server.ts")],cwd:f.root,
    env:{...Object.fromEntries(Object.entries(process.env).filter((entry):entry is [string,string]=>entry[1]!==undefined)),ARCHPULSE_ROOT:f.root},stderr:"pipe"});
  const client=new Client({name:"workflow-test",version:"1"});
  try {
    await client.connect(transport);
    expect((await client.listTools()).tools.map(tool=>tool.name).sort()).toEqual(["get_case","scan_repository","verify_case"]);
    const scanned=await client.callTool({name:"scan_repository",arguments:{}});
    expect(scanned.isError,text(scanned)).not.toBe(true);
    const baseline=text(scanned).match(/^Baseline: (.+)$/m)![1]!;
    expect(text(scanned)).toContain("case-001");
    const packet=await client.callTool({name:"get_case",arguments:{caseId:"case-001",baselineId:baseline}});
    expect(packet.isError,text(packet)).not.toBe(true);expect(Buffer.byteLength(text(packet))).toBeLessThanOrEqual(2048);
    f.write("src/a.js","export const a=1;");
    const verified=await client.callTool({name:"verify_case",arguments:{caseId:"case-001",baselineId:baseline}});
    expect(verified.isError,text(verified)).not.toBe(true);expect(text(verified)).toContain("verified:");
    expect(text(verified)).toContain("Tests: 0; typechecks: 0");
    const escape=await client.callTool({name:"scan_repository",arguments:{outDir:"../escape"}});
    expect(escape.isError).toBe(true);
    const malformed=await client.callTool({name:"get_case",arguments:{caseId:"../../other"}});
    expect(malformed.isError).toBe(true);
  } finally {await client.close();}
});
it("dispatches real scan, cases, compare, and verify CLI commands",{timeout:60000},async()=>{
  const f=fixture();
  const cli=async(...args:string[])=>runProcess(process.execPath,["--import",loader,path.join(repo,"src/cli/index.ts"),...args,"--repo",f.root],{cwd:repo,timeoutMs:25000});
  const scanned=await cli("scan");expect(scanned.exitCode,scanned.output).toBe(0);
  const before=scanned.stdout.match(/^Baseline: (.+)$/m)![1]!;
  const cases=await cli("cases","--snapshot",before);expect(cases.exitCode,cases.output).toBe(0);
  f.write("src/a.js","export const a=1;");
  const after=await cli("scan");expect(after.exitCode,after.output).toBe(0);
  const afterPath=after.stdout.match(/^Baseline: (.+)$/m)![1]!;
  const comparison=await cli("compare","--before",before,"--after",afterPath,"--case","case-001");
  expect(comparison.exitCode,comparison.output).toBe(0);expect(comparison.stdout).toContain("Architecture only");
  expect(fs.existsSync(path.join(f.root,".archpulse/comparison/comparison.json"))).toBe(true);
  expect(fs.existsSync(path.join(f.root,".archpulse/comparison/result.json"))).toBe(false);
  const verified=await cli("verify","--before",before,"--case","case-001","--out",".archpulse/result");
  expect(verified.exitCode,verified.output).toBe(0);
  const result=JSON.parse(fs.readFileSync(path.join(f.root,".archpulse/result/result.json"),"utf8"));
  const fixtureResult=JSON.parse(fs.readFileSync(path.join(repo,"artifacts/example/result.json"),"utf8"));
  expect(Object.keys(result).sort()).toEqual(Object.keys(fixtureResult).sort());
  expect(result.status).toBe("verified");
});
