import * as fs from "node:fs";
import * as path from "node:path";
import { execFileSync } from "node:child_process";
import ts from "typescript";
import { minimatch } from "minimatch";
import { parse as parseYaml } from "yaml";
import { profile, type Profile } from "./project.js";
import { validateWithinWorkspace } from "./workspace.js";

export const slash = (file: string) => file.replace(/\\/g, "/");
export const generatedDirectories = new Set([".git", ".archpulse", "node_modules", "dist", "build", "coverage", ".next", ".nuxt", ".cache", ".turbo", ".yarn", ".pnpm-store"]);
export interface PackageInfo { directory: string; name: string; scripts: Record<string,string>; manager: "npm" | "pnpm" | "yarn"; }
export interface TsProject { file: string; options: ts.CompilerOptions; files: string[]; }
export interface Discovery { files: string[]; packages: PackageInfo[]; projects: TsProject[]; warnings: string[]; unsupported: string[]; adoptedCandidates: string[]; workspacePatterns:string[];lockfiles:string[]; }
export function discoverProject(root: string, settings: Profile = profile()): Discovery {
  const files: string[] = [], all: string[] = [], warnings: string[] = [], unsupported: string[] = [];
  const visit = (directory: string) => {
    for (const entry of fs.readdirSync(directory, {withFileTypes:true}).sort((a,b)=>a.name.localeCompare(b.name))) {
      if (generatedDirectories.has(entry.name)) continue;
      const file = path.join(directory, entry.name), relative = slash(path.relative(root,file));
      if (entry.isSymbolicLink()) { warnings.push(`Skipped symbolic link: ${relative}`); continue; }
      if (settings.excludes.some(glob=>minimatch(relative,glob,{dot:true}) || minimatch(relative+"/",glob,{dot:true}))) continue;
      if (entry.isDirectory()) visit(file); else if (entry.isFile()) all.push(relative);
    }
  };
  visit(root);
  let ignored = new Set<string>();
  try {
    execFileSync("git",["rev-parse","--show-toplevel"],{cwd:root,stdio:["ignore","pipe","ignore"],windowsHide:true});
    try {
      const output=execFileSync("git",["check-ignore","-z","--stdin"],{cwd:root,input:all.join("\0")+"\0",encoding:"utf8",maxBuffer:20*1024*1024,windowsHide:true,stdio:["pipe","pipe","ignore"]});
      ignored=new Set(output.split("\0").filter(Boolean).map(slash));
    } catch(error) { if((error as {status?:number}).status!==1)throw error; }
  } catch { warnings.push("Git ignore information unavailable; standard generated-directory exclusions applied."); }
  const included=all.filter(file=>!ignored.has(file));
  for(const file of included) {
    if (/\.(?:[cm]?[jt]s|[jt]sx)$/.test(file) && !/\.d\.[cm]?ts$/.test(file) &&
      (!settings.includes.length || settings.includes.some(glob=>minimatch(file,glob,{dot:true}))))files.push(file);
    else if(/\.(?:vue|svelte|astro|py|java|go|rs|cs|rb|php)$/.test(file))unsupported.push(file);
  }
  if(unsupported.length)warnings.push(`${unsupported.length} unsupported source file(s) excluded; see discovery metadata for paths.`);
  if(fs.existsSync(path.join(root,".pnp.cjs"))||fs.existsSync(path.join(root,".pnp.js")))warnings.push("Yarn PnP resolution is not supported by automatic scans; use a node_modules installation or an explicitly adopted scanner configuration.");
  const packages: PackageInfo[]=[];
  const workspacePatterns:string[]=[];
  if(included.includes("pnpm-workspace.yaml")){
    const workspace=parseYaml(fs.readFileSync(path.join(root,"pnpm-workspace.yaml"),"utf8")) as {packages?:unknown}|null;
    if(workspace?.packages!==undefined){
      if(!Array.isArray(workspace.packages)||workspace.packages.some(p=>typeof p!=="string"))throw new Error("Invalid packages in pnpm-workspace.yaml");
      workspacePatterns.push(...workspace.packages as string[]);
    }
  }
  const lockfiles=included.filter(file=>["package-lock.json","npm-shrinkwrap.json","pnpm-lock.yaml","yarn.lock"].includes(path.basename(file)));
  let rootManager: PackageInfo["manager"] = included.includes("pnpm-lock.yaml")||included.includes("pnpm-workspace.yaml") ? "pnpm" : included.includes("yarn.lock") ? "yarn" : "npm";
  for(const file of included.filter(file=>path.basename(file)==="package.json").sort((a,b)=>a.length-b.length||a.localeCompare(b))) {
    const data:unknown=JSON.parse(fs.readFileSync(path.join(root,file),"utf8"));
    if(!data||typeof data!=="object"||Array.isArray(data))throw new Error(`Invalid package manifest: ${file}`);
    const manifest=data as {name?:unknown;scripts?:unknown;packageManager?:unknown;workspaces?:unknown};
    if(file==="package.json"&&manifest.workspaces!==undefined){
      const workspace=Array.isArray(manifest.workspaces)?manifest.workspaces:(manifest.workspaces as {packages?:unknown})?.packages;
      if(!Array.isArray(workspace)||workspace.some(p=>typeof p!=="string"))throw new Error("Invalid workspaces in package.json");
      workspacePatterns.push(...workspace as string[]);
    }
    if(manifest.scripts!==undefined && (!manifest.scripts||typeof manifest.scripts!=="object"||Array.isArray(manifest.scripts)||Object.values(manifest.scripts).some(s=>typeof s!=="string")))throw new Error(`Invalid scripts in ${file}`);
    const declared=typeof manifest.packageManager==="string" ? manifest.packageManager.split("@")[0] : undefined;
    const manager=declared==="npm"||declared==="pnpm"||declared==="yarn"?declared:rootManager;
    if(file==="package.json")rootManager=manager;
    packages.push({directory:slash(path.dirname(file)),name:typeof manifest.name==="string"?manifest.name:path.dirname(file),scripts:(manifest.scripts??{}) as Record<string,string>,manager});
  }
  const projects:TsProject[]=[];
  const visited=new Set<string>();
  const parse=(file:string)=>{
    const absolute=path.resolve(root,file);validateWithinWorkspace(absolute,root);
    file=slash(path.relative(root,absolute));if(visited.has(file))return;visited.add(file);
    const parsed=ts.getParsedCommandLineOfConfigFile(absolute,{}, {...ts.sys,onUnRecoverableConfigFileDiagnostic:d=>{throw new Error(`${file}: ${ts.flattenDiagnosticMessageText(d.messageText," ")}`);}});
    const errors=parsed?.errors.filter(e=>e.code!==18003)??[];
    if(!parsed||errors.length)throw new Error(`Invalid ${file}: ${errors.map(e=>ts.flattenDiagnosticMessageText(e.messageText," ")).join("; ")}`);
    projects.push({file,options:parsed.options,files:parsed.fileNames.map(f=>slash(path.relative(root,f)))});
    for(const ref of parsed.projectReferences??[])parse(path.join(ref.path,fs.statSync(ref.path).isDirectory()?"tsconfig.json":""));
  };
  for(const file of included.filter(file=>/^(?:tsconfig(?:\.[^.]+)*|jsconfig)\.json$/.test(path.basename(file))))parse(file);
  return {files,packages,projects,warnings,unsupported,adoptedCandidates:included.filter(f=>/^\.dependency-cruiser\.(?:cjs|js|mjs|json)$/.test(f)),workspacePatterns,lockfiles};
}
export function owningProject(file:string,discovery:Discovery): {project?:TsProject; ambiguous:boolean} {
  const candidates=discovery.projects.filter(project=>project.files.includes(file));
  candidates.sort((a,b)=>path.dirname(b.file).length-path.dirname(a.file).length||a.file.localeCompare(b.file));
  const first=candidates[0];
  const peers=candidates.filter(p=>first&&path.dirname(p.file)===path.dirname(first.file));
  const resolution=(p:TsProject)=>JSON.stringify({baseUrl:p.options.baseUrl,paths:p.options.paths,moduleResolution:p.options.moduleResolution,rootDirs:p.options.rootDirs,customConditions:p.options.customConditions});
  return {project:first,ambiguous:peers.some(p=>resolution(p)!==resolution(first!))};
}
