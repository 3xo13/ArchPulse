import { afterEach, expect, it } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { spawn, type ChildProcess } from "node:child_process";
import { createRequire } from "node:module";
import { fileURLToPath, pathToFileURL } from "node:url";
import { setTimeout as delay } from "node:timers/promises";
import { runScan } from "../cli/scan.js";
import { generateCases } from "../core/cases.js";
import { digest, json } from "../core/storage.js";

const repo=path.resolve(path.dirname(fileURLToPath(import.meta.url)),"../..");
const loader=pathToFileURL(createRequire(import.meta.url).resolve("tsx/esm")).href;
const roots:string[]=[];
const children:ChildProcess[]=[];
afterEach(()=>{
  for(const child of children.splice(0)) if(child.exitCode===null)child.kill();
  for(const root of roots.splice(0))fs.rmSync(root,{recursive:true,force:true});
});
async function until(condition:()=>boolean, timeout=45000, diagnostics:()=>string=()=>"") {
  const end=Date.now()+timeout;
  while(!condition()) { if(Date.now()>end)throw new Error(`Timed out waiting for child state: ${diagnostics()}`); await delay(25); }
}
function fixture() {
  const root=fs.mkdtempSync(path.join(os.tmpdir(),"archpulse shutdown "));roots.push(root);
  const write=(name:string,value:string)=>{const file=path.join(root,name);fs.mkdirSync(path.dirname(file),{recursive:true});fs.writeFileSync(file,value);};
  write("package.json",json({type:"module"}));
  write("src/a.js",'import "./b.js";');write("src/b.js","export const b=1;");
  write("config/architecture.json",json({layers:[],forbiddenDependencies:[],scanScope:"src",
    testCommands:["node checks/test.cjs"],typecheckCommands:['node -e "process.exit(0)"']}));
  write("checks/test.cjs",'if(require("fs").existsSync(".archpulse/block-test")){const child=require("child_process").spawn(process.execPath,["-e","setInterval(()=>{},1000)"]);require("fs").writeFileSync(".archpulse/command-pids.json",JSON.stringify([process.pid,child.pid]));setInterval(()=>{},1000);}');
  write(".dependency-cruiser.cjs",'const fs=require("fs");if(fs.existsSync(".archpulse/block-scan")){fs.writeFileSync(".archpulse/scanner-pid",String(process.pid));Atomics.wait(new Int32Array(new SharedArrayBuffer(4)),0,0);}module.exports={forbidden:[{name:"boundary",severity:"error",from:{path:"a.js$"},to:{path:"b.js$"}}]};');
  write("publication-hook.mjs",`import fs from "node:fs";import {syncBuiltinESMExports} from "node:module";
    const unlink=fs.unlinkSync;let injected=false;
    fs.unlinkSync=function(file){const result=unlink(file);
      if(!injected&&String(file).endsWith("operation.lock")&&fs.existsSync(".archpulse/block-publication")){
        injected=true;fs.writeFileSync(file,${JSON.stringify(String(process.pid))});fs.writeFileSync(".archpulse/publication-held","ready");
      }return result;};syncBuiltinESMExports();`);
  return {root,write};
}
function server(root:string) {
  const child=spawn(process.execPath,["--import",loader,"--import",pathToFileURL(path.join(root,"publication-hook.mjs")).href,path.join(repo,"src/mcp/server.ts")],
    {cwd:root,env:{...process.env,ARCHPULSE_ROOT:root},windowsHide:true,stdio:["pipe","pipe","pipe"]});children.push(child);
  let stdout="",stderr="";
  child.stdout.on("data",chunk=>{stdout+=String(chunk);});child.stderr.on("data",chunk=>{stderr+=String(chunk);});
  const exited=new Promise<number|null>((resolve,reject)=>{child.once("close",resolve);child.once("error",reject);});
  const send=(value:unknown)=>child.stdin.write(JSON.stringify(value)+"\n");
  return {child,exited,send,stdout:()=>stdout,stderr:()=>stderr};
}

it.each(["command","scan","publication"])("drains MCP work on EOF during %s",{timeout:120000},async mode=>{
  const f=fixture();
  const scan=await runScan({repoRoot:f.root});
  const cases=await generateCases({repoRoot:f.root,snapshotPath:scan.baselineId});
  const latest=fs.readFileSync(path.resolve(f.root,scan.snapshotPath));
  if(mode!=="scan")f.write("src/a.js","export const a=1;");
  f.write(`.archpulse/block-${mode==="command"?"test":mode}`,"yes");
  for(const name of ["result.json","result.md","execution.json"])f.write(`.archpulse/report/${name}`,`previous ${name}`);
  const app=server(f.root);
  try {
    app.send({jsonrpc:"2.0",id:1,method:"initialize",params:{protocolVersion:"2024-11-05",capabilities:{},clientInfo:{name:"shutdown-test",version:"1"}}});
    await until(()=>app.stdout().includes('"id":1'),45000,()=>`startup; code=${app.child.exitCode}; signal=${app.child.signalCode}; ${app.stderr()}`);
    app.send({jsonrpc:"2.0",method:"notifications/initialized"});
    app.send({jsonrpc:"2.0",id:2,method:"tools/call",params:{name:mode==="scan"?"scan_repository":"verify_case",arguments:mode==="scan"?{}:{baselineId:scan.baselineId,caseId:cases.cases[0]!.caseId,outDir:".archpulse/report"}}});
    const marker=path.join(f.root,".archpulse",mode==="command"?"command-pids.json":mode==="scan"?"scanner-pid":"publication-held");
    await until(()=>fs.existsSync(marker),45000,()=>`${mode} readiness; code=${app.child.exitCode}; signal=${app.child.signalCode}; ${app.stderr()}`);
    const pids:number[]=mode==="command"?JSON.parse(fs.readFileSync(marker,"utf8")):mode==="scan"?[Number(fs.readFileSync(marker,"utf8"))]:[];
    const started=Date.now();app.child.stdin.end();
    await until(()=>app.child.exitCode!==null,11000);
    expect(await app.exited,app.stderr()).toBe(0);
    expect(Date.now()-started).toBeLessThan(10000);
    for(const pid of pids)expect(()=>process.kill(pid,0)).toThrow();
    for(const line of app.stdout().trim().split("\n"))expect(()=>JSON.parse(line)).not.toThrow();
    if(mode==="publication") {
      for(const name of ["result.json","result.md","execution.json"])expect(fs.readFileSync(path.join(f.root,".archpulse/report",name),"utf8")).toBe(`previous ${name}`);
      expect(fs.readFileSync(path.join(f.root,".archpulse/operation.lock"),"utf8")).toBe(String(process.pid));
      fs.unlinkSync(path.join(f.root,".archpulse/operation.lock"));
    } else {
      expect(fs.existsSync(path.join(f.root,".archpulse/operation.lock"))).toBe(false);
      if(mode==="scan")expect(digest(fs.readFileSync(path.resolve(f.root,scan.snapshotPath)))).toBe(digest(latest));
      else expect(JSON.parse(fs.readFileSync(path.join(f.root,".archpulse/report/result.json"),"utf8")).status).toBe("failed");
    }
  } finally { if(app.child.exitCode===null){app.child.kill();await app.exited;} }
});
