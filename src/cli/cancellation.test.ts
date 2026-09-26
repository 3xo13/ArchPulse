import { expect, it } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { spawn } from "node:child_process";
import { createRequire } from "node:module";
import { fileURLToPath, pathToFileURL } from "node:url";

const repo=path.resolve(path.dirname(fileURLToPath(import.meta.url)),"../..");
const loader=pathToFileURL(createRequire(import.meta.url).resolve("tsx/esm")).href;
it.each(["cases","compare"])("cancels real CLI %s while waiting for publication",{timeout:60000},async command=>{
  const root=fs.mkdtempSync(path.join(os.tmpdir(),"archpulse cli cancel "));
  fs.mkdirSync(path.join(root,".archpulse/report"),{recursive:true});
  const lock=path.join(root,".archpulse/operation.lock");fs.writeFileSync(lock,String(process.pid));
  for(const name of ["snapshot-before.json","snapshot-after.json","case-001.json"])fs.copyFileSync(path.join(repo,"artifacts/example",name),path.join(root,name));
  const report=path.join(root,".archpulse/report","comparison.json");fs.writeFileSync(report,"previous report");
  // Deliver the same JS signal event on both platforms, after observing the real lock attempt.
  const preload=path.join(root,"cancel-hook.mjs");
  fs.writeFileSync(preload,`import fs from "node:fs";import {syncBuiltinESMExports} from "node:module";
    const open=fs.openSync;let ready=false;
    fs.openSync=function(file,...args){try{return open(file,...args);}catch(error){
      if(!ready&&String(file).endsWith("operation.lock")&&error.code==="EEXIST"){
        ready=true;process.send("waiting");}throw error;}};syncBuiltinESMExports();
    process.on("message",()=>{process.emit("SIGINT");process.disconnect();});`);
  const args=command==="cases"?["--snapshot","snapshot-before.json"]:["--before","snapshot-before.json","--after","snapshot-after.json","--case","case-001"];
  const child=spawn(process.execPath,["--import",loader,"--import",pathToFileURL(preload).href,path.join(repo,"src/cli/index.ts"),command,...args,"--repo",root,"--out",".archpulse/report"],
    {cwd:root,windowsHide:true,stdio:["ignore","pipe","pipe","ipc"]});
  let stderr="";child.stderr!.on("data",chunk=>{stderr+=String(chunk);});child.stdout!.resume();
  let phase="startup",expired=false;
  let timer=setTimeout(()=>{expired=true;child.kill();},45000);
  child.once("message",()=>{phase="cancellation";clearTimeout(timer);timer=setTimeout(()=>{expired=true;child.kill();},10000);child.send("cancel");});
  const done=new Promise<number|null>((resolve,reject)=>{child.once("close",resolve);child.once("error",reject);});
  try {
    const code=await done;
    expect(code,`phase=${phase}; watchdog=${expired}; signal=${child.signalCode}; stderr=${stderr}`).toBe(1);
    expect(fs.readFileSync(report,"utf8")).toBe("previous report");
    expect(fs.readdirSync(path.dirname(report))).toEqual(["comparison.json"]);
    expect(fs.readFileSync(lock,"utf8")).toBe(String(process.pid));
  } finally {clearTimeout(timer);if(child.exitCode===null)child.kill();fs.rmSync(root,{recursive:true,force:true});}
});
