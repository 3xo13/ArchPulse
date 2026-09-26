import * as fs from "node:fs";
import * as path from "node:path";
import { randomUUID, createHash } from "node:crypto";
import { z } from "zod/v4";
import { discoverProject } from "./discovery.js";
import { profile, projectContext, type Check, validateManagedPath } from "./project.js";
import { json, publishFiles, withRepositoryLock } from "./storage.js";
import { stable } from "./provenance.js";
import { validateWithinWorkspace } from "./workspace.js";

const hash=(value:unknown)=>createHash("sha256").update(stable(value)).digest("hex");
const check=z.object({command:z.string().trim().min(1),cwd:z.string().min(1)});
const proposalSchema=z.object({version:z.literal(1),id:z.string().uuid(),root:z.string(),binding:z.string(),tests:z.array(check),typechecks:z.array(check),warnings:z.array(z.string())});
export type Proposal=z.infer<typeof proposalSchema>;
export function proposeChecks(root:string):Omit<Proposal,"id"> {
  const settings=profile(), discovery=discoverProject(root,settings);
  const tests:Check[]=[],typechecks:Check[]=[],warnings=[...discovery.warnings];
  const add=(target:Check[],pkg:typeof discovery.packages[number],names:string[])=>{
    const name=names.find(n=>pkg.scripts[n]);if(!name)return false;
    const script=pkg.scripts[name]!;
    if(/(?:--watch(?:\b|=)|\b(?:vite|next)\s+dev\b|\bvitest\s*$|\bjest\s+--watch)/.test(script)){
      warnings.push(`${pkg.directory}: ${name} appears interactive; configure a noninteractive command.`);return true;
    }
    target.push({command:`${pkg.manager} run ${name}`,cwd:pkg.directory});return true;
  };
  for(const pkg of discovery.packages){
    if(!add(tests,pkg,["test:ci","test"]))warnings.push(`${pkg.directory}: no test script discovered.`);
    if(!add(typechecks,pkg,["typecheck","check:types"])) {
      for(const project of discovery.projects.filter(p=>path.posix.dirname(p.file)===pkg.directory)) {
        const compiler=path.join(root,pkg.directory,"node_modules/typescript/bin/tsc");
        const rootCompiler=path.join(root,"node_modules/typescript/bin/tsc");
        const found=fs.existsSync(compiler)?compiler:fs.existsSync(rootCompiler)?rootCompiler:undefined;
        if(found&&!project.options.composite)typechecks.push({command:`node "${path.relative(path.join(root,pkg.directory),found).replace(/\\/g,"/")}" --noEmit --project "${path.posix.basename(project.file)}"`,cwd:pkg.directory});
        else warnings.push(`${project.file}: supply a compatible typecheck command${project.options.composite?" for this composite project":"; project TypeScript is not installed"}.`);
      }
    }
  }
  const selected=settings.checks??{tests:settings.testCommands?.map(command=>({command,cwd:"."}))??tests,typechecks:settings.typecheckCommands?.map(command=>({command,cwd:"."}))??typechecks};
  for(const command of [...selected.tests,...selected.typechecks]) {
    validateWithinWorkspace(path.resolve(root,command.cwd),root);
    if(!fs.statSync(path.resolve(root,command.cwd)).isDirectory())throw new Error(`Check working directory is not a directory: ${command.cwd}`);
  }
  if(!selected.tests.length)warnings.push("Full verification needs at least one approved test command.");
  if(!selected.typechecks.length)warnings.push("Full verification needs at least one approved typecheck command; no check is fabricated for JavaScript-only projects.");
  warnings.push("Package scripts may run shell commands and lifecycle hooks, and may write project files. Review all selected commands and working directories.");
  const manifests=discovery.packages.map(pkg=>({directory:pkg.directory,contents:fs.readFileSync(path.join(root,pkg.directory,"package.json"),"utf8")}));
  const workspaceFiles=["pnpm-workspace.yaml",".yarnrc.yml",".npmrc"].filter(file=>fs.existsSync(path.join(root,file))).map(file=>[file,fs.readFileSync(path.join(root,file),"utf8")]);
  return {version:1,root,binding:hash({settings,manifests,workspaceFiles,selected}),...selected,warnings};
}
export function approvedChecks(root:string):Proposal {
  const context=projectContext(root);if(!context)throw new Error("External project context required.");
  const file=path.join(context.storage,"approval.json");validateManagedPath(file);
  if(!fs.existsSync(file))throw new Error("Checks are not approved. Run configure, review its proposal, approve it, then capture a fresh baseline.");
  const approved=proposalSchema.parse(JSON.parse(fs.readFileSync(file,"utf8")));
  const current=proposeChecks(root);
  if(approved.root!==root||approved.binding!==current.binding||stable(approved.tests)!==stable(current.tests)||stable(approved.typechecks)!==stable(current.typechecks))throw new Error("Verification policy changed; approve a new proposal and capture a fresh baseline.");
  return approved;
}
export function externalPolicyHash(root:string):string {
  const context=projectContext(root)!;
  const file=path.join(context.storage,"approval.json");validateManagedPath(file);
  return hash({proposal:proposeChecks(root),approval:fs.existsSync(file)?JSON.parse(fs.readFileSync(file,"utf8")):null});
}
export async function configureProject(root:string,approve?:string,signal?:AbortSignal) {
  const context=projectContext(root);if(!context)throw new Error("External project context required.");
  return withRepositoryLock(root,()=>{
    const current=proposeChecks(root);
    if(approve){
      if(!z.string().uuid().safeParse(approve).success)throw new Error("Invalid proposal ID.");
      const file=path.join(context.storage,"proposals",`${approve}.json`);validateManagedPath(file);
      const proposal=proposalSchema.parse(JSON.parse(fs.readFileSync(file,"utf8")));
      if(proposal.id!==approve||stable({...proposal,id:undefined})!==stable(current))throw new Error("Proposal is stale or modified; run configure again and review the new proposal.");
      publishFiles(new Map([[path.join(context.storage,"approval.json"),json(proposal)]]),()=>signal?.throwIfAborted());
      return {approved:true,proposal,profilePath:context.profilePath};
    }
    const proposal={...current,id:randomUUID()};
    const changes=new Map([[path.join(context.storage,"proposals",`${proposal.id}.json`),json(proposal)]]);
    if(!fs.existsSync(context.profilePath))changes.set(context.profilePath,json({version:1}));
    publishFiles(changes,()=>signal?.throwIfAborted());
    return {approved:false,proposal,profilePath:context.profilePath};
  },signal);
}
