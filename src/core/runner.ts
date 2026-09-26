import { spawn } from "node:child_process";
import { existsSync, readFileSync, realpathSync, statSync } from "node:fs";
import * as path from "node:path";

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

/** Keep memory bounded while continuing to drain both child streams. */
function outputCollector() {
  const notice = "[output truncated at 500 lines or 256 KiB]";
  const byteLimit = 256 * 1024 - Buffer.byteLength(notice) - 1;
  let text = "";
  let bytes = 0;
  let lines = 0;
  let truncated = false;
  return {
    collect(chunk: string) {
      if (truncated) return;
      for (const char of chunk) {
        const size = Buffer.byteLength(char);
        if (bytes + size > byteLimit || lines >= 499) { truncated = true; break; }
        text += char; bytes += size;
        if (char === "\n") lines++;
      }
    },
    value() { return truncated ? text + (text.endsWith("\n") ? "" : "\n") + notice : text; },
  };
}

export async function runTestCommand(commandIndex: number, repoRoot?: string): Promise<RunResult> {
  const root = path.resolve(repoRoot ?? process.cwd());
  const configPath = path.join(root, "config", "architecture.json");
  let config: { testCommands?: unknown };
  try { config = JSON.parse(readFileSync(configPath, "utf8")); }
  catch (error) { throw new Error(`Cannot read test command configuration '${configPath}': ${String(error)}`); }
  if (!config || !Array.isArray(config.testCommands) || !config.testCommands.length ||
      !config.testCommands.every(command => typeof command === "string" && command.trim())) {
    throw new Error("testCommands must be a nonempty array of nonempty command strings.");
  }
  if (!Number.isInteger(commandIndex) || commandIndex < 0 || commandIndex >= config.testCommands.length) {
    throw new TypeError(`commandIndex ${commandIndex} is out of range for ${config.testCommands.length} test commands.`);
  }
  const command = config.testCommands[commandIndex] as string;
  const [binary, ...arguments_] = tokenize(command);
  const npmName = path.basename(binary!).replace(/\.cmd$/i, "").toLowerCase();
  const isNpx = npmName === "npx";
  let executable = binary!;
  let args = arguments_;
  try {
    if (npmName === "npm" || isNpx) {
      if (isNpx && args.some(arg => /^(?:-y|--yes(?:=true)?|--no-install=false|--offline=false)$/.test(arg))) {
        throw new Error("Automatic package installation is disabled for test commands. Install test dependencies first.");
      }
      args = [npmEntry(npmName as "npm" | "npx"), ...(isNpx ? ["--no-install", "--offline"] : []), ...args];
      executable = process.execPath;
    } else if (binary === "node") executable = process.execPath;
  } catch (error) { return { command, exitCode: 1, output: String(error) }; }

  return new Promise<RunResult>((resolve) => {
    const output = outputCollector();
    let settled = false;
    const finish = (exitCode: number | null) => {
      if (!settled) { settled = true; resolve({ command, exitCode, output: output.value() }); }
    };
    const child = spawn(executable, args, {
      cwd: root, shell: false, stdio: ["ignore", "pipe", "pipe"],
      env: { ...process.env, ...(isNpx ? { npm_config_yes: "false", npm_config_offline: "true" } : {}) },
    });
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", output.collect);
    child.stderr.on("data", output.collect);
    child.once("error", (error) => { output.collect(`spawn error: ${error.message}`); finish(1); });
    child.once("close", (code) => {
      if (isNpx && code !== 0) output.collect("\nCommand failed. Ensure the workspace's test dependencies are installed; automatic installation is disabled.\n");
      finish(code);
    });
  });
}
