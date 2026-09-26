import { afterEach, expect, it, vi } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import { createHash } from "node:crypto";
import { createProjectContext, withProject } from "./project.js";
import { discoverProject, owningProject } from "./discovery.js";
import { configureProject, approvedChecks } from "./policy.js";
import { runScan } from "../cli/scan.js";
import { ensureBaselineCases } from "./cases.js";
import { verifyCase } from "./verify.js";
import { loadBaseline, sourceState } from "./provenance.js";
import { runConfiguredCommand, managerEntry } from "./runner.js";
import { execFileSync } from "node:child_process";
import { cycleComponents } from "./automatic-scan.js";
import { runProcess } from "./process.js";
import { fileURLToPath,pathToFileURL } from "node:url";
import { createRequire } from "node:module";

const temporary:string[]=[];
function fixture(){
  const base=fs.mkdtempSync(path.join(os.tmpdir(),"archpulse external "));temporary.push(base);
  const root=path.join(base,"project");fs.mkdirSync(root);
  const context=createProjectContext(root,path.join(base,"state"));
  const write=(file:string,content:string)=>{fs.mkdirSync(path.dirname(path.join(root,file)),{recursive:true});fs.writeFileSync(path.join(root,file),content);};
  return {root,context,write};
}
function inventory(root:string):Record<string,string>{
  const result:Record<string,string>={};
  const walk=(directory:string)=>{for(const entry of fs.readdirSync(directory,{withFileTypes:true})){
    const file=path.join(directory,entry.name);if(entry.isDirectory())walk(file);else result[path.relative(root,file)]=createHash("sha256").update(fs.readFileSync(file)).digest("hex");
  }};walk(root);return result;
}
afterEach(()=>{vi.unstubAllEnvs();for(const root of temporary.splice(0))fs.rmSync(root,{recursive:true,force:true});});

it("scans root-level JS, stores complete artifacts externally, and never writes target files",{timeout:60000},async()=>{
  const {root,context,write}=fixture();write("a.js","import './b.js';\n");write("b.js","import './a.js';\n");
  const before=inventory(root);
  await withProject(context,async()=>{
    const result=await runScan({repoRoot:root});
    expect(result.incompleteResolutionCount).toBe(0);expect(result.violationCount).toBeGreaterThan(0);
    expect(path.isAbsolute(result.baselineId)).toBe(true);expect(result.baselineId.startsWith(context.storage)).toBe(true);
    expect(fs.readFileSync(result.graphPath,"utf8")).toContain("<svg");
    const cases=await ensureBaselineCases(root,result.baselineId);expect(cases.cases.length).toBeGreaterThan(0);
    expect(loadBaseline(root,result.baselineId).manifest.version).toBe(3);
  });
  expect(inventory(root)).toEqual(before);
});

it("uses package-local inherited TS aliases and finds cycles across project boundaries",{timeout:60000},async()=>{
  const {root,context,write}=fixture();
  write("base.json",JSON.stringify({compilerOptions:{allowJs:true,module:"ESNext",moduleResolution:"Bundler"}}));
  for(const name of ["one","two"]){
    write(`packages/${name}/package.json`,JSON.stringify({name}));
    write(`packages/${name}/tsconfig.json`,JSON.stringify({extends:"../../base.json",compilerOptions:{baseUrl:".",paths:{"@other/*":[`../${name==="one"?"two":"one"}/*`]}},include:["*.ts"]}));
    write(`packages/${name}/index.ts`,"import '@other/index'; export const x=1;\n");
  }
  await withProject(context,async()=>{
    const discovery=discoverProject(root);expect(owningProject("packages/one/index.ts",discovery).project?.file).toBe("packages/one/tsconfig.json");
    const result=await runScan({repoRoot:root});expect(result.incompleteResolutionCount).toBe(0);expect(result.violationCount).toBeGreaterThan(0);
  });
});

it("requires unchanged explicit approval and verifies a real repair with external evidence",{timeout:90000},async()=>{
  const {root,context,write}=fixture();
  write("package.json",JSON.stringify({name:"real-project",type:"module",scripts:{test:"node --test test.mjs",typecheck:"node --check a.js"}}));
  write("test.mjs","import {test} from 'node:test'; import assert from 'node:assert/strict'; test('real',()=>assert.equal(2+2,4));");
  write("a.js","import './b.js'; export const a=1;\n");write("b.js","import './a.js';\n");
  const before=inventory(root);
  await withProject(context,async()=>{
    expect(()=>approvedChecks(root)).toThrow(/not approved/);
    const proposal=await configureProject(root);expect(inventory(root)).toEqual(before);
    await configureProject(root,proposal.proposal.id);
    expect(approvedChecks(root).tests).toHaveLength(1);
    const scan=await runScan({repoRoot:root});const cases=await ensureBaselineCases(root,scan.baselineId);
    write("b.js","export const b=1;\n");
    const result=await verifyCase({repoRoot:root,baselineId:scan.baselineId,caseId:cases.cases[0]!.caseId});
    expect(result.result.reason).toBeTruthy();expect(result.result.status,result.result.reason).toBe("verified");
    expect(result.result.testExitCode).toBe(0);expect(result.resultPath?.startsWith(context.storage)).toBe(true);
    expect(fs.existsSync(path.join(root,".archpulse"))).toBe(false);
    write("package.json",JSON.stringify({scripts:{test:"node --version",typecheck:"node --version"}}));
    expect(()=>approvedChecks(root)).toThrow(/policy changed/);
    await expect(configureProject(root,proposal.proposal.id)).rejects.toThrow(/stale/);
  });
});

it("rejects empty projects and storage inside the target",async()=>{
  const {root,context}=fixture();
  expect(()=>createProjectContext(root,path.join(root,"storage"))).toThrow(/outside/);
  await withProject(context,async()=>{await expect(runScan({repoRoot:root})).rejects.toThrow(/No supported/);});
});

it.each(["npm","pnpm","yarn"] as const)("executes approved %s scripts with real exit codes and quoted working directories",{timeout:30000},async manager=>{
  const {root,context,write}=fixture();write("package.json",JSON.stringify({name:"checks",packageManager:`${manager}@1.0.0`,scripts:{test:'node -e "process.exit(7)"',typecheck:'node -e "process.exit(0)"'}}));
  await withProject(context,async()=>{
    const proposal=await configureProject(root);expect(proposal.proposal.tests[0]!.command).toBe(`${manager} run test`);
    await configureProject(root,proposal.proposal.id);
    expect((await runConfiguredCommand("testCommands",0,root)).exitCode).toBe(7);
    expect((await runConfiguredCommand("typecheckCommands",0,root)).exitCode).toBe(0);
  });
});

it("honors git ignores and profile globs without executing discovered configuration",()=>{
  const {root,context,write}=fixture();
  write(".gitignore","ignored/\n");write("ignored/file.ts","export const x=1");write("src/view.tsx","export const View=()=> <div/>;");write("dist/bundle.js","");
  write(".dependency-cruiser.cjs","throw new Error('must not execute');");
  execFileSync("git",["init","--quiet"],{cwd:root,windowsHide:true});
  withProject(context,()=>{
    const result=discoverProject(root);expect(result.files).toContain("src/view.tsx");expect(result.files).not.toContain("ignored/file.ts");expect(result.files).not.toContain("dist/bundle.js");
    expect(result.adoptedCandidates).toEqual([".dependency-cruiser.cjs"]);
    expect(discoverProject(root,{version:1,includes:["src/**"],excludes:["**/*.tsx"],aliases:{}}).files).toEqual([]);
  });
});

it("reports PnP, unsupported formats, ambiguous configurations, and missing checks explicitly",()=>{
  const {root,context,write}=fixture();write("index.ts","export const n=1");write("view.vue","<template/>");write(".pnp.cjs","");
  write("tsconfig.json",JSON.stringify({compilerOptions:{baseUrl:".",paths:{"@/*":["src/*"]}},include:["index.ts"]}));
  write("tsconfig.alt.json",JSON.stringify({compilerOptions:{baseUrl:".",paths:{"@/*":["other/*"]}},include:["index.ts"]}));
  withProject(context,()=>{const result=discoverProject(root);expect(result.warnings.join(" ")).toContain("PnP");expect(result.unsupported).toEqual(["view.vue"]);expect(owningProject("index.ts",result).ambiguous).toBe(true);});
});

it("does not authorize watch scripts or altered proposals",async()=>{
  const {root,context,write}=fixture();write("package.json",JSON.stringify({scripts:{test:"vitest",typecheck:"tsc --watch"}}));
  await withProject(context,async()=>{
    const configured=await configureProject(root);expect(configured.proposal.tests).toEqual([]);expect(configured.proposal.typechecks).toEqual([]);
    const file=path.join(context.storage,"proposals",`${configured.proposal.id}.json`);
    const altered={...configured.proposal,tests:[{command:"node --version",cwd:"."}]};fs.writeFileSync(file,JSON.stringify(altered));
    await expect(configureProject(root,configured.proposal.id)).rejects.toThrow(/modified/);
  });
});

it("canonicalizes repository links and rejects redirected artifact storage",()=>{
  const {root,context}=fixture();const alias=path.join(path.dirname(root),"alias");fs.symlinkSync(root,alias,"junction");
  expect(createProjectContext(alias,path.dirname(context.storage)).storage).toBe(context.storage);
  fs.mkdirSync(path.dirname(context.storage),{recursive:true});const outside=path.join(path.dirname(root),"outside");fs.mkdirSync(outside);
  fs.symlinkSync(outside,context.storage,"junction");
  expect(()=>createProjectContext(root,path.dirname(context.storage))).toThrow(/redirected/);
});

it("preserves immutable external baselines across concurrent scans and rejects tampering",{timeout:60000},async()=>{
  const {root,context,write}=fixture();write("index.js","export const n=1;");
  await withProject(context,async()=>{
    const [a,b]=await Promise.all([runScan({repoRoot:root}),runScan({repoRoot:root})]);
    expect(a.baselineId).not.toBe(b.baselineId);expect(loadBaseline(root,a.baselineId).snapshotPath).toBe(a.baselineId);
    fs.appendFileSync(a.baselineId," ");expect(()=>loadBaseline(root,a.baselineId)).toThrow(/modified/);
    expect(loadBaseline(root,b.baselineId).snapshotPath).toBe(b.baselineId);expect(fs.existsSync(path.join(context.storage,"operation.lock"))).toBe(false);
  });
});

it("reports an unavailable manager without enabling Corepack or installing it",()=>{
  const {root}=fixture();vi.stubEnv("PATH","");
  expect(()=>managerEntry("pnpm",root)).toThrow(/will not download/);
});

it("scans TSX and reports missing imports without inventing cycles",{timeout:45000},async()=>{
  const {root,context,write}=fixture();write("view.tsx","import './missing'; export const View=()=> <div/>;");
  write("tsconfig.json",JSON.stringify({compilerOptions:{jsx:"preserve",module:"ESNext",moduleResolution:"Bundler"},include:["*.tsx"]}));
  await withProject(context,async()=>{const result=await runScan({repoRoot:root});expect(result.incompleteResolutionCount).toBe(1);expect(result.violationCount).toBe(0);});
});

it("keeps external baselines stable across convenience output paths and fingerprints inherited configuration",{timeout:60000},async()=>{
  const {root,context,write}=fixture();write("index.ts","export const n=1;");write("base.json",JSON.stringify({compilerOptions:{strict:true}}));
  write("tsconfig.json",JSON.stringify({extends:"./base.json",include:["index.ts"]}));
  await withProject(context,async()=>{
    const first=await runScan({repoRoot:root,outDir:"one"}),second=await runScan({repoRoot:root,outDir:"two"});expect(first.configHash).toBe(second.configHash);
    write("base.json",JSON.stringify({compilerOptions:{strict:false}}));const third=await runScan({repoRoot:root});expect(third.configHash).not.toBe(first.configHash);
    expect(fs.existsSync(first.baselineId)).toBe(true);
  });
});

it.skipIf(process.platform==="win32")("scans a read-only project with all writes outside it",{timeout:45000},async()=>{
  const {root,context,write}=fixture();write("index.js","export const n=1;");
  const before=inventory(root);fs.chmodSync(path.join(root,"index.js"),0o444);fs.chmodSync(root,0o555);
  try{await withProject(context,()=>runScan({repoRoot:root}));expect(inventory(root)).toEqual(before);}
  finally{fs.chmodSync(root,0o755);fs.chmodSync(path.join(root,"index.js"),0o644);}
});

it("handles deep acyclic graphs and identifies only cyclic components without recursive traversal",()=>{
  const edges=new Map(Array.from({length:12000},(_,i)=>[String(i),i===11999?[]:[String(i+1)]] as [string,string[]]));
  edges.set("cycle-a",["cycle-b"]);edges.set("cycle-b",["cycle-a"]);
  const components=cycleComponents(edges);expect(components.get("0")).not.toBe(components.get("11999"));expect(components.get("cycle-a")).toBe(components.get("cycle-b"));
});

it("marks nonliteral dynamic imports as incomplete coverage",{timeout:45000},async()=>{
  const {root,context,write}=fixture();write("index.js","const name='./other.js'; import(name);");write("other.js","export const n=1;");
  await withProject(context,async()=>{const result=await runScan({repoRoot:root});expect(result.coverageIncomplete).toBe(true);expect(result.scannerWarnings.join(" ")).toContain("Unsupported dynamic");});
});

it("reads workspace declarations, manager choice and scripts without executing them",()=>{
  const {root,context,write}=fixture();write("package.json",JSON.stringify({name:"mono",workspaces:["apps/*"],scripts:{test:"throw"}}));
  write("pnpm-workspace.yaml","packages:\n  - packages/*\n");write("pnpm-lock.yaml","lockfileVersion: '9.0'\n");write("packages/lib/package.json",JSON.stringify({name:"library",scripts:{test:"node --test"}}));
  withProject(context,()=>{const result=discoverProject(root);expect(result.workspacePatterns).toEqual(["packages/*","apps/*"]);expect(result.lockfiles).toContain("pnpm-lock.yaml");expect(result.packages.every(p=>p.manager==="pnpm")).toBe(true);});
});

it("ignores known TypeScript cache files but still detects source edits",()=>{
  const {root,context,write}=fixture();write("index.ts","export const x=1;");
  withProject(context,()=>{const before=sourceState(root);write("tsconfig.tsbuildinfo","generated");expect(sourceState(root)).toBe(before);write("index.ts","export const x=2;");expect(sourceState(root)).not.toBe(before);});
});

const checkout=path.resolve(path.dirname(fileURLToPath(import.meta.url)),"../..");
it.skipIf(process.platform!=="win32"||path.parse(checkout).root.toLowerCase()===path.parse(os.tmpdir()).root.toLowerCase())("dispatches verification when the baseline store is on another Windows drive",{timeout:60000},async()=>{
  const base=fs.mkdtempSync(path.join(os.tmpdir(),"archpulse drive store "));temporary.push(base);
  const staging=path.join(checkout,".archpulse");fs.mkdirSync(staging,{recursive:true});
  const root=fs.mkdtempSync(path.join(staging,"drive-project-"));temporary.push(root);
  execFileSync("git",["init","--quiet"],{cwd:root,windowsHide:true});
  fs.writeFileSync(path.join(root,"package.json"),JSON.stringify({type:"module",scripts:{test:"node --test test.mjs",typecheck:"node --check a.js"}}));
  fs.writeFileSync(path.join(root,"a.js"),"import './b.js';");fs.writeFileSync(path.join(root,"b.js"),"import './a.js';");fs.writeFileSync(path.join(root,"test.mjs"),"import {test} from 'node:test';test('real check',()=>{});");
  const context=createProjectContext(root,base);
  const baseline=await withProject(context,async()=>{const proposal=await configureProject(root);await configureProject(root,proposal.proposal.id);const scan=await runScan({repoRoot:root});await ensureBaselineCases(root,scan.baselineId);return scan.baselineId;});
  fs.writeFileSync(path.join(root,"b.js"),"export const b=1;");
  const loader=pathToFileURL(createRequire(import.meta.url).resolve("tsx/esm")).href;
  const result=await runProcess(process.execPath,["--import",loader,path.join(checkout,"src/cli/index.ts"),"verify","--repo",root,"--before",baseline,"--case","case-001"],{cwd:checkout,env:{...process.env,ARCHPULSE_STORAGE:base},timeoutMs:45000});
  expect(result.exitCode,result.output).toBe(0);expect(result.stdout).toContain("verified:");expect(fs.existsSync(path.join(root,".archpulse"))).toBe(false);
});
