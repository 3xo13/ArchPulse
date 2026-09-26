import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { spawn, spawnSync } from "node:child_process";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import { fileURLToPath } from "node:url";

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
let temp: string;
let addon: string;
let workspace: string;
beforeEach(() => {
  temp = fs.mkdtempSync(path.join(os.tmpdir(), "archpulse-install-"));
  addon = path.join(temp, "addon with spaces");
  workspace = path.join(temp, "workspace");
  fs.mkdirSync(workspace);
  fs.mkdirSync(path.join(addon, "scripts"), { recursive: true });
  fs.copyFileSync(path.join(repo, "scripts/install-bob-addon.js"), path.join(addon, "scripts/install-bob-addon.js"));
  fs.copyFileSync(path.join(repo, "scripts/global-skill.md"), path.join(addon, "scripts/global-skill.md"));
  fs.copyFileSync(path.join(repo, "package.json"), path.join(addon, "package.json"));
  fs.cpSync(path.join(repo, "src"), path.join(addon, "src"), { recursive: true });
  fs.cpSync(path.join(repo, ".bob/skills"), path.join(addon, ".bob/skills"), { recursive: true });
  fs.symlinkSync(path.join(repo, "node_modules"), path.join(addon, "node_modules"), "junction");
});
afterEach(() => fs.rmSync(temp, { recursive: true, force: true }));

function install(target?: string) {
  return spawnSync(process.execPath, [path.join(addon, "scripts/install-bob-addon.js"), ...(target ? [target] : [])], {
    cwd: workspace, encoding: "utf8", timeout: 15000,
  });
}
function config(target: string) { return JSON.parse(fs.readFileSync(path.join(target, ".bob/mcp.json"), "utf8")); }

describe("installer preflight and canonical targets", () => {
  it("self-installs portably, preserves other entries, and is idempotent", () => {
    fs.mkdirSync(path.join(addon, ".bob"), { recursive: true });
    fs.writeFileSync(path.join(addon, ".bob/mcp.json"), JSON.stringify({ custom: true, mcpServers: { other: { command: "other" } } }));
    expect(install().status).toBe(0);
    const first = fs.readFileSync(path.join(addon, ".bob/mcp.json"), "utf8");
    expect(config(addon)).toMatchObject({ custom: true, mcpServers: {
      other: { command: "other" }, archpulse: { args: ["--import", "tsx/esm", "src/mcp/server.ts"], env: { ARCHPULSE_ROOT: "${workspaceFolder}" } },
    } });
    expect(install().status).toBe(0);
    expect(fs.readFileSync(path.join(addon, ".bob/mcp.json"), "utf8")).toBe(first);
  });
  it("recognizes a junction or symlink to the add-on as self-install", () => {
    const alias = path.join(temp, "alias");
    fs.symlinkSync(addon, alias, "junction");
    const result = install(alias);
    expect(result.status, result.stderr).toBe(0);
    expect(result.stdout).toMatch(/Skipping/);
    expect(config(addon).mcpServers.archpulse.args[1]).toBe("tsx/esm");
  });
  it.each(["null", "[]", '{"mcpServers":[]}','{broken'])("rejects invalid config %s before copying a skill", content => {
    fs.mkdirSync(path.join(workspace, ".bob"));
    fs.writeFileSync(path.join(workspace, ".bob/mcp.json"), content);
    expect(install(workspace).status).toBe(1);
    expect(fs.readFileSync(path.join(workspace, ".bob/mcp.json"), "utf8")).toBe(content);
    expect(fs.existsSync(path.join(workspace, ".bob/skills"))).toBe(false);
  });
  it("checks missing source files before modifying the target", () => {
    fs.unlinkSync(path.join(addon, ".bob/skills/archpulse/SKILL.md"));
    expect(install(workspace).status).toBe(1);
    expect(fs.existsSync(path.join(workspace, ".bob"))).toBe(false);
  });
  it("rejects a file as the target", () => {
    const file = path.join(temp, "file"); fs.writeFileSync(file, "x");
    expect(install(file).status).toBe(1);
    expect(fs.readFileSync(file, "utf8")).toBe("x");
  });
  it("copies the skill and launches the externally installed server", { timeout: 60000 }, async () => {
    const result = install(workspace);
    expect(result.status, result.stderr).toBe(0);
    const entry = config(workspace).mcpServers.archpulse;
    expect(entry.env.ARCHPULSE_ROOT).toBe(fs.realpathSync(workspace));
    expect(entry.args[1]).toMatch(/^file:/);
    expect(fs.readFileSync(path.join(workspace, ".bob/skills/archpulse/SKILL.md"), "utf8"))
      .toBe(fs.readFileSync(path.join(addon, ".bob/skills/archpulse/SKILL.md"), "utf8"));
    const child=spawn(process.execPath,entry.args,{cwd:workspace,env:{...process.env,...entry.env},windowsHide:true,stdio:["pipe","pipe","pipe"]});
    let stderr="",phase="startup",expired=false;
    let timer=setTimeout(()=>{expired=true;child.kill();},45000);
    child.stdout.resume();child.stderr.on("data",chunk=>{
      stderr+=String(chunk);
      if(phase==="startup"&&stderr.includes("MCP server running")){
        phase="shutdown";clearTimeout(timer);timer=setTimeout(()=>{expired=true;child.kill();},10000);child.stdin.end();
      }
    });
    try{
      const code=await new Promise<number|null>((resolve,reject)=>{child.once("close",resolve);child.once("error",reject);});
      expect(code,`phase=${phase}; watchdog=${expired}; signal=${child.signalCode}; stderr=${stderr}`).toBe(0);
      expect(stderr).toContain("MCP server running");
    }finally{clearTimeout(timer);if(child.exitCode===null)child.kill();}
  });
  it("installs globally outside the project, preserves entries, and is repeatable",()=>{
    const home=path.join(temp,"Bob home");fs.mkdirSync(path.join(home,"settings"),{recursive:true});
    const settings=path.join(home,"settings/mcp.json");fs.writeFileSync(settings,JSON.stringify({mcpServers:{other:{command:"other"}}}));
    const run=()=>spawnSync(process.execPath,[path.join(addon,"scripts/install-bob-addon.js"),"--global","--bob-home",home],{encoding:"utf8",timeout:15000});
    expect(run().status).toBe(0);const first=fs.readFileSync(settings,"utf8");expect(run().status).toBe(0);expect(fs.readFileSync(settings,"utf8")).toBe(first);
    expect(JSON.parse(first)).toMatchObject({mcpServers:{other:{command:"other"},archpulse:{command:process.execPath,env:{ARCHPULSE_MODE:"global"},alwaysAllow:[]}}});
    expect(fs.existsSync(path.join(home,"skills/archpulse/SKILL.md"))).toBe(true);expect(fs.readdirSync(workspace)).toEqual([]);
  });
  it("rejects malformed global settings before writing a skill",()=>{
    const home=path.join(temp,"Bob home");fs.mkdirSync(path.join(home,"settings"),{recursive:true});
    const settings=path.join(home,"settings/mcp.json");fs.writeFileSync(settings,"null");
    const result=spawnSync(process.execPath,[path.join(addon,"scripts/install-bob-addon.js"),"--global","--bob-home",home],{encoding:"utf8",timeout:15000});
    expect(result.status).toBe(1);expect(fs.readFileSync(settings,"utf8")).toBe("null");expect(fs.existsSync(path.join(home,"skills"))).toBe(false);
  });
});
