import { runProcess, type ProcessOptions } from "./process.js";
import { existsSync, readFileSync, realpathSync, statSync } from "node:fs";
import * as path from "node:path";
import { projectContext } from "./project.js";
import { approvedChecks } from "./policy.js";
import { validateWithinWorkspace } from "./workspace.js";
import { parse as parseYaml } from "yaml";

export interface RunResult {
  command: string;
  exitCode: number | null;
  output: string;
}

/** Tokenize arguments only: no shell expansion, substitution, or operators. */
function tokenize(command: string): string[] {
  const result: string[] = [];
  let token = "";
  let quote = "";
  let started = false;
  for (let i = 0; i < command.length; i++) {
    const char = command[i]!;
    if (char === "\\" && command[i + 1] &&
        ((quote === '"' && command[i + 1] === '"') ||
         (!quote && /[\s'"\\]/.test(command[i + 1]!)))) {
      token += command[++i]; started = true;
    } else if (quote) {
      if (char === quote) quote = "";
      else token += char;
    } else if (char === "'" || char === '"') {
      quote = char; started = true;
    } else if (/\s/.test(char)) {
      if (started) { result.push(token); token = ""; started = false; }
    } else { token += char; started = true; }
  }
  if (quote) throw new Error("Unterminated quote in allowlisted test command.");
  if (started) result.push(token);
  if (!result[0]) throw new Error("Test command must name an executable.");
  return result;
}

function npmEntry(name: "npm" | "npx"): string {
  const candidates: string[] = [];
  const addInstallation = (executable: string) => {
    let real = executable;
    try { real = realpathSync(executable); } catch { /* Try adjacent installation paths. */ }
    for (const directory of new Set([path.dirname(executable), path.dirname(real)])) {
      candidates.push(path.join(directory, `${name}-cli.js`),
        path.join(directory, "node_modules", "npm", "bin", `${name}-cli.js`),
        path.resolve(directory, "../lib/node_modules/npm/bin", `${name}-cli.js`));
    }
  };
  if (process.env.npm_execpath) addInstallation(process.env.npm_execpath);
  addInstallation(process.execPath);
  for (const directory of (process.env.PATH ?? "").split(path.delimiter).filter(Boolean)) {
    for (const filename of ["npm", "npm.cmd", "npx", "npx.cmd"]) {
      const executable = path.join(directory, filename);
      if (existsSync(executable)) addInstallation(executable);
    }
  }
  const found = candidates.find(candidate => {
    try { return statSync(candidate).isFile(); } catch { return false; }
  });
  if (!found) throw new Error(`Cannot locate ${name}'s JavaScript entry point. Install npm alongside Node or set npm_execpath to npm-cli.js.`);
  return found;
}

export async function runTestCommand(commandIndex: number, repoRoot?: string, options: Partial<ProcessOptions> = {}): Promise<RunResult> {
  return runConfiguredCommand("testCommands", commandIndex, repoRoot, options);
}

export async function runConfiguredCommand(kind: "testCommands" | "typecheckCommands", commandIndex: number, repoRoot?: string, options: Partial<ProcessOptions> = {}): Promise<RunResult> {
  const root = path.resolve(repoRoot ?? process.cwd());
  if(projectContext(root)){
    const approved=approvedChecks(root),commands=kind==="testCommands"?approved.tests:approved.typechecks;
    if(!Number.isInteger(commandIndex)||!commands[commandIndex])throw new Error("Invalid approved command index.");
    const selected=commands[commandIndex]!;const cwd=path.resolve(root,selected.cwd);validateWithinWorkspace(cwd,root);
    return runCommand(selected.command,cwd,options);
  }
  const configPath = path.join(root, "config", "architecture.json");
  let config: Partial<Record<typeof kind, unknown>>;
  try { config = JSON.parse(readFileSync(configPath, "utf8")); }
  catch (error) { throw new Error(`Cannot read test command configuration '${configPath}': ${String(error)}`); }
  if (!config || !Array.isArray(config[kind]) || !config[kind].length ||
      !config[kind].every(command => typeof command === "string" && command.trim())) {
    throw new Error(`${kind} must be a nonempty array of nonempty command strings.`);
  }
  if (!Number.isInteger(commandIndex) || commandIndex < 0 || commandIndex >= config[kind].length) {
    throw new TypeError(`commandIndex ${commandIndex} is out of range for ${config[kind].length} test commands.`);
  }
  const command = config[kind][commandIndex] as string;
  return runCommand(command,root,options);
}

export function managerEntry(name:"pnpm"|"yarn",root:string):string {
  const candidates:string[]=[];
  if(name==="yarn"){
    const config=path.join(root,".yarnrc.yml");
    if(existsSync(config)){
      const data=parseYaml(readFileSync(config,"utf8")) as {yarnPath?:unknown}|null;
      if(data?.yarnPath!==undefined){
        if(typeof data.yarnPath!=="string")throw new Error("Invalid yarnPath in .yarnrc.yml");
        const file=path.resolve(root,data.yarnPath);validateWithinWorkspace(file,root);candidates.push(file);
      }
    }
  }
  const suffix=name==="pnpm"?"pnpm/bin/pnpm.cjs":"yarn/bin/yarn.js";
  for(const dir of [path.dirname(process.execPath),...(process.env.PATH??"").split(path.delimiter)]){
    if(!dir)continue;
    candidates.push(path.join(dir,"node_modules",suffix),path.resolve(dir,"../lib/node_modules",suffix));
    for(const binary of [name,`${name}.cmd`]){
      try{const real=realpathSync(path.join(dir,binary));if(/\.(?:c?js|mjs)$/.test(real)&&!real.includes("corepack"))candidates.push(real);}catch{/* Not installed here. */}
    }
  }
  const found=candidates.find(file=>existsSync(file)&&statSync(file).isFile());
  if(!found)throw new Error(`Cannot find installed ${name} JavaScript entry point. Install ${name} separately; ArchPulse will not download it or enable Corepack.`);
  return found;
}
async function runCommand(command:string,root:string,options:Partial<ProcessOptions>):Promise<RunResult>{
  const [binary, ...arguments_] = tokenize(command);
  const npmName = path.basename(binary!).replace(/\.cmd$/i, "").toLowerCase();
  const isNpx = npmName === "npx";
  let executable = binary!;
  let args = arguments_;
  try {
    if (npmName === "npm" || isNpx) {
      if (isNpx && args.some(arg => /^(?:-y|--yes|--install|--no-install|--offline)(?:=|$)/.test(arg))) {
        throw new Error("Automatic package installation is disabled for test commands. Install test dependencies first.");
      }
      args = [npmEntry(npmName as "npm" | "npx"), ...(isNpx ? ["--no-install", "--offline"] : []), ...args];
      executable = process.execPath;
    } else if(npmName==="pnpm"||npmName==="yarn"){
      if(!["run","exec"].includes(args[0]??""))throw new Error("Only installed package-manager run/exec commands are supported; installation and downloads are disabled.");
      args=[managerEntry(npmName,root),...args];executable=process.execPath;
    } else if (binary === "node") executable = process.execPath;
  } catch (error) { return { command, exitCode: 1, output: String(error) }; }

  const result = await runProcess(executable, args, { ...options, cwd: root,
    env: { ...process.env, COREPACK_ENABLE_NETWORK:"0",
      ...(npmName==="pnpm"?{npm_config_manage_package_manager_versions:"false"}:{}),...(npmName==="yarn"?{YARN_ENABLE_NETWORK:"0"}:{}),
      ...(isNpx ? { npm_config_yes: "false", npm_config_offline: "true" } : {}) },
  });
  const suffix = isNpx && result.exitCode !== 0 ? "\nEnsure workspace test dependencies are installed; automatic installation is disabled." : "";
  const output = result.output + (Buffer.byteLength(result.output) + Buffer.byteLength(suffix) < 256 * 1024 && result.output.split("\n").length < 499 ? suffix : "");
  return { command, exitCode: result.exitCode, output };
}
