import { afterEach, describe, expect, it } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import { createRequire } from "node:module";
import { runScan } from "../cli/scan.js";
import { generateCases, getCase } from "./cases.js";
import { groupViolations } from "./grouping.js";
import { loadBaseline } from "./provenance.js";
import { verifyCase } from "./verify.js";
import { compareSnapshots } from "./compare.js";
import { runConfiguredCommand } from "./runner.js";
import { json, readJson } from "./storage.js";

const temporary: string[]=[];
function fixture() {
  const root=fs.mkdtempSync(path.join(os.tmpdir(),"archpulse workflow & space ")); temporary.push(root);
  const write=(file:string,content:string)=>{const target=path.join(root,file);fs.mkdirSync(path.dirname(target),{recursive:true});fs.writeFileSync(target,content);};
  const config={schemaVersion:"1",layers:[],allowedDependencies:[],forbiddenDependencies:[],
    testCommands:['node "checks/test.cjs"'],typecheckCommands:['node "checks/types.cjs"'],scanScope:"src"};
  write("config/architecture.json",json(config));
  write("checks/test.cjs","console.log('tests passed');");write("checks/types.cjs","console.log('types passed');");
  write("src/a.js",'import "./b.js"; export const a=1;');write("src/b.js","export const b=1;");
  write("src/c.js",'import "./d.js";');write("src/d.js","export const d=1;");
  write(".dependency-cruiser.cjs",'module.exports=require("./rules.cjs");');
  write("rules.cjs","module.exports="+json({forbidden:[{name:"boundary",severity:"error",from:{path:"(a|c)\\.js$"},to:{path:"(b|d)\\.js$"}}]}));
  return {root,write,config,repair:()=>write("src/a.js","export const a=1;")};
}
afterEach(()=>{for(const root of temporary.splice(0))fs.rmSync(root,{recursive:true,force:true});});
async function baseline(f: ReturnType<typeof fixture>) {
  const scan=await runScan({repoRoot:f.root});
  const cases=await generateCases({repoRoot:f.root,snapshotPath:scan.baselineId});
  expect(cases.caseCount).toBe(2);
  return {scan,caseId:cases.cases[0]!.caseId};
}
describe("captured workflow",()=>{
  it("verifies a real repair, retains unrelated violations, and preserves the original baseline",{timeout:45000},async()=>{
    const f=fixture();
    const tsc=createRequire(import.meta.url).resolve("typescript/bin/tsc");
    f.config.typecheckCommands=[`node "${tsc}" --noEmit --allowJs --checkJs --skipLibCheck --target es2022 src/a.js src/b.js src/c.js src/d.js`];
    f.write("config/architecture.json",json(f.config));
    const {scan,caseId}=await baseline(f);
    const original=fs.readFileSync(path.resolve(f.root,scan.baselineId),"utf8");
    f.repair();
    const {result,resultPath}=await verifyCase({repoRoot:f.root,baselineId:scan.baselineId,caseId});
    expect(result.status,result.reason).toBe("verified");
    expect(result.testExitCode).toBe(0);expect(result.typecheckExitCode).toBe(0);
    expect(result.resolvedViolations).toHaveLength(1);expect(result.persistentViolations).toHaveLength(1);
    expect(fs.existsSync(resultPath.replace(/\.json$/,".md"))).toBe(true);
    expect(fs.readFileSync(path.resolve(f.root,scan.baselineId),"utf8")).toBe(original);
    expect(loadBaseline(f.root).manifest.id).not.toBe(loadBaseline(f.root,scan.baselineId).manifest.id);
  });
  it("detects imported-rule changes and keeps output locations out of the fingerprint",{timeout:45000},async()=>{
    const f=fixture();const first=await runScan({repoRoot:f.root,outDir:".archpulse/one"});
    const second=await runScan({repoRoot:f.root,outDir:".archpulse/two"});
    expect(first.configHash).toBe(second.configHash);
    f.write(".dependency-cruiser.cjs",'module.exports={...require("./rules.cjs"),options:{reporterOptions:{dot:{collapsePattern:"src/"}}}};');
    expect((await runScan({repoRoot:f.root})).configHash).toBe(first.configHash);
    const cases=await generateCases({repoRoot:f.root,snapshotPath:first.baselineId});
    const selected=await getCase(f.root,cases.cases[0]!.caseId,first.baselineId);
    f.write("rules.cjs","module.exports={forbidden:[]};");
    const changed=await runScan({repoRoot:f.root});expect(changed.configHash).not.toBe(first.configHash);
    expect(compareSnapshots(path.resolve(f.root,first.baselineId),path.resolve(f.root,changed.baselineId),selected.packet).status).toBe("invalid");
  });
  it("fingerprints inherited TypeScript settings",{timeout:45000},async()=>{
    const f=fixture();f.write("tsconfig.json",json({extends:"./base.json",include:["src"]}));
    f.write("base.json",json({compilerOptions:{allowJs:true,strict:false}}));
    const before=await runScan({repoRoot:f.root});
    f.write("base.json",json({compilerOptions:{allowJs:true,strict:true}}));
    expect((await runScan({repoRoot:f.root})).configHash).not.toBe(before.configHash);
  });
  it.each(["tests","types","timeout","new","unchanged","policy","missing","mutating"])("handles verification outcome %s",{timeout:45000},async mode=>{
    const f=fixture();
    if(mode==="missing") {f.config.typecheckCommands=[];f.write("config/architecture.json",json(f.config));}
    const {scan,caseId}=await baseline(f);f.repair();
    if(mode==="tests")f.write("checks/test.cjs","process.exit(7)");
    if(mode==="types")f.write("checks/types.cjs","process.exit(8)");
    if(mode==="timeout")f.write("checks/test.cjs","setInterval(()=>{},1000)");
    if(mode==="new")f.write("src/a.js",'import "./d.js";');
    if(mode==="unchanged")f.write("src/a.js",'import "./b.js";');
    if(mode==="policy"){f.config.testCommands=['node -e "process.exit(0)"'];f.write("config/architecture.json",json(f.config));}
    if(mode==="mutating")f.write("checks/test.cjs",'require("fs").appendFileSync("src/b.js","\\n// mutation");');
    const {result}=await verifyCase({repoRoot:f.root,baselineId:scan.baselineId,caseId,commandTimeoutMs:mode==="timeout"?500:120000});
    expect(result.status,result.reason).toBe(["policy","missing","mutating"].includes(mode)?"invalid":"failed");
    if(mode==="tests")expect(result.testExitCode).toBe(7);
    if(mode==="types")expect(result.typecheckExitCode).toBe(8);
    if(mode==="timeout")expect(result.testExitCode).toBe(124);
  });
  it("rejects legacy baselines and tampered immutable artifacts",{timeout:30000},async()=>{
    const f=fixture();f.write("legacy/snapshot.json","{}");
    expect(()=>loadBaseline(f.root,"legacy/snapshot.json")).toThrow(/provenance/);
    const scan=await runScan({repoRoot:f.root});
    fs.appendFileSync(path.resolve(f.root,scan.baselineId)," ");
    expect(()=>loadBaseline(f.root,scan.baselineId)).toThrow(/modified/);
    expect(()=>loadBaseline(f.root,"working-tree")).toThrow(/ambiguous/);
  });
  it("reports partial resolution and scanner failures without false success",{timeout:45000},async()=>{
    const f=fixture();f.write("src/c.js",'import "./b.js";');
    const scan=await runScan({repoRoot:f.root});
    const cases=await generateCases({repoRoot:f.root,snapshotPath:scan.baselineId});
    expect(cases.caseCount).toBe(1);f.repair();
    const partial=await verifyCase({repoRoot:f.root,baselineId:scan.baselineId,caseId:cases.cases[0]!.caseId});
    expect(partial.result.status,partial.result.reason).toBe("partial");
    fs.unlinkSync(path.join(f.root,".dependency-cruiser.cjs"));
    const failed=await verifyCase({repoRoot:f.root,baselineId:scan.baselineId,caseId:cases.cases[0]!.caseId});
    expect(failed.result.status).toBe("invalid");expect(failed.result.reason).toContain("config not found");
  });
  it("prevents archive overwrite and detects packet tampering",{timeout:30000},async()=>{
    const f=fixture();const {scan,caseId}=await baseline(f);
    const selected=await getCase(f.root,caseId,scan.baselineId);
    await expect(runScan({repoRoot:f.root,outDir:selected.directory})).rejects.toThrow(/immutable/);
    fs.appendFileSync(selected.packetPath," ");
    await expect(getCase(f.root,caseId,scan.baselineId)).rejects.toThrow(/modified/);
  });
  it("rejects scan scopes that escape through a directory link",async()=>{
    const f=fixture(), outside=fixture();
    fs.symlinkSync(outside.root,path.join(f.root,"linked"),process.platform==="win32"?"junction":"dir");
    await expect(runScan({repoRoot:f.root,scanScope:"linked"})).rejects.toThrow(/outside/);
  });
  it("serializes concurrent scans without losing immutable records",{timeout:45000},async()=>{
    const f=fixture();const scans=await Promise.all([runScan({repoRoot:f.root}),runScan({repoRoot:f.root})]);
    expect(scans[0]!.baselineId).not.toBe(scans[1]!.baselineId);
    for(const scan of scans)expect(loadBaseline(f.root,scan.baselineId).manifest.configHash).toBe(scan.configHash);
  });
  it("cancels a hanging child and stops remaining verification checks",{timeout:15000},async()=>{
    const f=fixture();f.write("checks/test.cjs","setInterval(()=>{},1000)");
    const controller=new AbortController();const timer=setTimeout(()=>controller.abort(),300);
    try {expect((await runConfiguredCommand("testCommands",0,f.root,{signal:controller.signal})).exitCode).toBe(124);}
    finally{clearTimeout(timer);}
    const cancelled=new AbortController();cancelled.abort();
    const {result}=await verifyCase({repoRoot:f.root,baselineId:"missing",caseId:"case-001",signal:cancelled.signal});
    expect(result.status).toBe("failed");expect(result.testExitCode).toBe(-1);
  });
});

describe("case generation",()=>{
  it("keeps IDs stable, deletes retired files, and discovers only existing tests",{timeout:30000},async()=>{
    const f=fixture();f.write("src/a.test.js","// actual test");
    const {scan}=await baseline(f);const out=path.join(f.root,".archpulse/cases");
    const first=await generateCases({repoRoot:f.root,snapshotPath:scan.baselineId,outDir:out});
    fs.writeFileSync(path.join(out,"unrelated.txt"),"keep");
    const packet=readJson(path.join(out,`${first.cases[0]!.caseId}.json`)) as {relevantTests:string[]};
    expect(packet.relevantTests).toContain("src/a.test.js");expect(packet.relevantTests.every(file=>fs.existsSync(path.join(f.root,file)))).toBe(true);
    const snapshot=readJson(path.resolve(f.root,scan.baselineId)) as {violations:unknown[]};
    snapshot.violations=snapshot.violations.slice(1);f.write("snapshot.json",json(snapshot));
    const second=await generateCases({repoRoot:f.root,snapshotPath:"snapshot.json",outDir:out});
    expect(second.cases[0]!.caseId).toBe(first.cases[1]!.caseId);
    expect(fs.existsSync(path.join(out,`${first.cases[0]!.caseId}.json`))).toBe(false);
    snapshot.violations=[];f.write("snapshot.json",json(snapshot));
    await generateCases({repoRoot:f.root,snapshotPath:"snapshot.json",outDir:out});
    expect(fs.readdirSync(out).sort()).toEqual(["index.json","metadata.json","unrelated.txt"]);
  });
  it("includes intermediate cycle members and splits a long single cycle into linked chunks",()=>{
    const violation={id:"cycle",rule:"no-circular",from:"a.ts",to:"b.ts",severity:"error" as const,evidence:"cycle",cyclePath:["a.ts","b.ts","c.ts"]};
    const snapshot={schemaVersion:"1",gitMarker:"test",violations:[violation,{...violation,id:"edge",from:"c.ts",to:"d.ts",cyclePath:null}]};
    const merged=groupViolations(snapshot);expect(merged).toHaveLength(1);expect(merged[0]!.primaryFiles).toEqual(["a.ts","b.ts","c.ts","d.ts"]);
    const long={...violation,cyclePath:Array.from({length:9},(_,i)=>`${i}.ts`)};
    const chunks=groupViolations({...snapshot,violations:[long]});
    expect(chunks.length).toBeGreaterThan(1);
    for(const chunk of chunks){expect(chunk.primaryFiles.length).toBeLessThanOrEqual(6);expect(chunk.relatedGroups?.length).toBe(chunks.length-1);expect(chunk.violations[0]!.cyclePath).toEqual(long.cyclePath);}
  });
  it.each([null,{}, {schemaVersion:"1",violations:[null]}])("rejects malformed case input %j",async input=>{
    const f=fixture();f.write("snapshot.json",json(input));
    await expect(generateCases({repoRoot:f.root,snapshotPath:"snapshot.json"})).rejects.toThrow();
  });
});
