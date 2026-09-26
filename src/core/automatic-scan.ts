import * as path from "node:path";
import * as fs from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";
import { createRequire } from "node:module";
import { cruise, type ICruiseResult } from "dependency-cruiser";
import ts from "typescript";
import { minimatch } from "minimatch";
import { discoverProject, owningProject, slash, type Discovery } from "./discovery.js";
import { profile, type Profile } from "./project.js";
import { runProcess, type ProcessOptions } from "./process.js";
import { stable } from "./provenance.js";
import { cruiseResultSchema } from "./validation.js";

export async function automaticScan(root:string,options:Partial<ProcessOptions>,scope="."):Promise<{raw:ICruiseResult;discovery:Discovery}> {
  const settings=profile(), discovery=discoverProject(root,settings);
  if(scope!==".")discovery.files=discovery.files.filter(file=>file===scope||file.startsWith(scope+"/"));
  if(!discovery.files.length)throw new Error("No supported JavaScript/TypeScript source files found. Check the selected root, ignore rules, and external profile.");
  const worker=fileURLToPath(import.meta.url);
  const args=worker.endsWith(".ts")?["--import",pathToFileURL(createRequire(import.meta.url).resolve("tsx/esm")).href,worker,"--worker"]:[worker,"--worker"];
  const result=await runProcess(process.execPath,args,{...options,cwd:root,input:JSON.stringify({root,settings,discovery}),maxBytes:20*1024*1024,maxLines:Infinity});
  if(result.exitCode!==0||result.truncated||result.stopped)throw new Error(`Automatic scanner failed: ${result.stderr}`);
  const raw=cruiseResultSchema.parse(JSON.parse(result.stdout)) as unknown as ICruiseResult;
  return {raw,discovery};
}

async function extract(root:string,settings:Profile,discovery:Discovery):Promise<ICruiseResult> {
  const groups=new Map<string,string[]>(),warnings=[...discovery.warnings];
  for(const file of discovery.files){
    const syntax=ts.createSourceFile(file,fs.readFileSync(path.join(root,file),"utf8"),ts.ScriptTarget.Latest,true);
    const inspect=(node:ts.Node):void=>{
      if(ts.isCallExpression(node)&&(node.expression.kind===ts.SyntaxKind.ImportKeyword||(ts.isIdentifier(node.expression)&&node.expression.text==="require"))&&
        (!node.arguments[0]||!ts.isStringLiteralLike(node.arguments[0])))warnings.push(`Unsupported dynamic dependency in ${file}; static coverage is incomplete.`);
      ts.forEachChild(node,inspect);
    };inspect(syntax);
    const owner=owningProject(file,discovery);
    if(owner.ambiguous)warnings.push(`Ambiguous TypeScript resolution settings for ${file}; select a narrower scope/configuration before verification.`);
    const key=owner.project?.file??"";groups.set(key,[...(groups.get(key)??[]),file]);
  }
  const modules:ICruiseResult["modules"]=[];
  let template:ICruiseResult|undefined;
  for(const [config,files] of groups){
    const project=discovery.projects.find(p=>p.file===config);
    const ruleSet={forbidden:[],options:config?{tsConfig:{fileName:path.join(root,config)}}:{}};
    const result=await cruise(files,{outputType:"json",doNotFollow:{path:"node_modules"},ruleSet},
      {extensions:[".ts",".tsx",".js",".jsx",".mts",".cts",".mjs",".cjs",".json"],conditionNames:["import","require","node","default"],exportsFields:["exports"]},
      project?{tsConfig:{options:project.options}}:undefined);
    const raw=(typeof result.output==="string"?JSON.parse(result.output):result.output) as ICruiseResult;
    template=raw;
    for(const module of raw.modules.filter(m=>files.includes(slash(m.source)))) {
      // Profile aliases are data, never executable project configuration.
      if(project||Object.keys(settings.aliases).length)for(const dep of module.dependencies){
        const resolution=ts.resolveModuleName(dep.module,path.join(root,module.source),{
          ...project?.options,allowJs:true,moduleResolution:project?.options.moduleResolution??ts.ModuleResolutionKind.Bundler,
          baseUrl:Object.keys(settings.aliases).length?root:project?.options.baseUrl,paths:{...project?.options.paths,...settings.aliases},
        },ts.sys).resolvedModule;
        if(resolution&&!resolution.isExternalLibraryImport){dep.resolved=slash(path.relative(root,resolution.resolvedFileName));dep.couldNotResolve=false;}
      }
      module.valid=true;module.rules=[];module.dependents=[];
      for(const dep of module.dependencies){dep.valid=true;dep.rules=[];delete dep.cycle;dep.circular=false;}
      for(const dep of module.dependencies){
        const relative=path.relative(root,path.resolve(root,dep.resolved));
        if(path.isAbsolute(relative)||relative===".."||relative.startsWith(`..${path.sep}`)){
          if(dep.dependencyTypes.some(t=>t.startsWith("npm")))dep.resolved=`node_modules/${dep.module.replace(/[^a-zA-Z0-9@/_.-]/g,"_")}`;
          else{dep.couldNotResolve=true;dep.resolved=module.source;warnings.push(`Dependency leaves selected repository: ${module.source} -> ${dep.module}`);}
        }
      }
      modules.push(module);
    }
  }
  const names=new Set(modules.map(m=>m.source));
  for(const file of discovery.files)if(!names.has(file))warnings.push(`Unanalyzed source: ${file}; static coverage is incomplete.`);
  const edges=new Map(modules.map(m=>[m.source,m.dependencies.filter(d=>names.has(d.resolved)&&!d.couldNotResolve).map(d=>d.resolved).sort()]));
  const components=cycleComponents(edges);
  const route=(start:string,end:string):string[]|undefined=>{
    const queue=[[start]],seen=new Set<string>();
    for(let i=0;i<queue.length;i++){const current=queue[i]!,last=current.at(-1)!;if(last===end)return current;if(seen.has(last))continue;seen.add(last);for(const next of edges.get(last)??[])if(!seen.has(next))queue.push([...current,next]);}
    return undefined;
  };
  const violations:ICruiseResult["summary"]["violations"]=[];
  for(const module of modules)for(const dep of module.dependencies){
    const back=!dep.couldNotResolve&&components.get(dep.resolved)===components.get(module.source)?route(dep.resolved,module.source):undefined;
    if(back){
      const cycle=[module.source,...back.slice(0,-1)].map(name=>({name,dependencyTypes:[] }));
      const rule={name:"no-circular",severity:"error" as const};
      dep.circular=true;dep.cycle=cycle;dep.valid=false;dep.rules=[rule];module.valid=false;
      violations.push({type:"cycle",from:module.source,to:dep.resolved,rule,cycle});
    }
    for(const forbidden of settings.forbiddenDependencies??[]){
      const layer=(name:string)=>settings.layers?.find(l=>l.name===name)?.glob;
      const from=layer(forbidden.from),to=layer(forbidden.to);
      if(from&&to&&minimatch(module.source,from,{dot:true})&&minimatch(dep.resolved,to,{dot:true})){
        const rule={name:`${forbidden.from}-no-${forbidden.to}`,severity:"error" as const};
        violations.push({type:"dependency",from:module.source,to:dep.resolved,rule});dep.rules?.push(rule);dep.valid=false;module.valid=false;
      }
    }
  }
  const raw=template!;raw.modules=modules;
  raw.summary.violations=[...new Map(violations.map(v=>[stable(v),v])).values()];raw.summary.error=raw.summary.violations.length;raw.summary.warn=0;raw.summary.info=0;
  raw.summary.totalCruised=modules.length;raw.summary.totalDependenciesCruised=modules.reduce((sum,m)=>sum+m.dependencies.length,0);
  raw.summary.optionsUsed={...raw.summary.optionsUsed,tsConfig:undefined};
  raw.summary.ruleSetUsed={forbidden:[{name:"no-circular",severity:"error",from:{},to:{circular:true}}]};
  // These internal inputs are included in the fingerprint, not the public snapshot shape.
  Object.assign(raw.summary.optionsUsed,{automaticProfile:settings,automaticVersion:1,typescriptProjects:discovery.projects.map(p=>({file:p.file,options:p.options}))});
  Object.assign(raw.summary,{warnings});
  return raw;
}
if(process.argv[2]==="--worker" && process.argv[1] && path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  let input="";for await(const chunk of process.stdin)input+=String(chunk);
  try {
    const {root,settings,discovery}=JSON.parse(input) as {root:string;settings:Profile;discovery:Discovery};
    process.stdout.write(JSON.stringify(await extract(root,settings,discovery)));
  }catch(error){console.error(String(error));process.exitCode=2;}
}

export function automaticEvidence(discovery:Discovery):string {
  return stable({packages:discovery.packages,projects:discovery.projects.map(p=>({file:p.file,options:p.options})),warnings:discovery.warnings});
}

/** Iterative SCC traversal avoids recursion limits and repeated walks through acyclic graphs. */
export function cycleComponents(edges:Map<string,string[]>):Map<string,number>{
  const visited=new Set<string>(),order:string[]=[],reverse=new Map<string,string[]>();
  for(const name of edges.keys())reverse.set(name,[]);
  for(const [from,targets] of edges)for(const to of targets)reverse.get(to)?.push(from);
  for(const name of edges.keys()){
    if(visited.has(name))continue;
    const stack:Array<[string,number]>=[[name,0]];visited.add(name);
    while(stack.length){
      const frame=stack.at(-1)!,targets=edges.get(frame[0])??[];
      if(frame[1]>=targets.length){order.push(frame[0]);stack.pop();continue;}
      const next=targets[frame[1]++]!;
      if(!visited.has(next)){visited.add(next);stack.push([next,0]);}
    }
  }
  const result=new Map<string,number>();let id=0;
  for(const name of order.reverse()){
    if(result.has(name))continue;id++;const stack=[name];result.set(name,id);
    while(stack.length)for(const next of reverse.get(stack.pop()!)??[])if(!result.has(next)){result.set(next,id);stack.push(next);}
  }
  return result;
}
