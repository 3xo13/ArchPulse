import { spawn } from "node:child_process";
import * as path from "node:path";

export interface ProcessOptions {
  cwd: string;
  signal?: AbortSignal;
  timeoutMs?: number;
  input?: string;
  env?: NodeJS.ProcessEnv;
  maxBytes?: number;
  maxLines?: number;
}
export function boundedOutput(maxBytes = 256 * 1024, maxLines = 500) {
  const notice = "[output truncated]";
  let output = "", bytes = 0, lines = 0, truncated = false;
  return {
    collect(chunk: string) {
      if (truncated) return;
      for (const char of chunk) {
        const size = Buffer.byteLength(char);
        if (bytes + size > maxBytes - Buffer.byteLength(notice) - 1 || lines >= maxLines - 1) { truncated = true; break; }
        output += char; bytes += size; if (char === "\n") lines++;
      }
    },
    value: () => truncated ? output + (output.endsWith("\n") ? "" : "\n") + notice : output,
    isTruncated: () => truncated,
  };
}
export interface ProcessResult { exitCode: number | null; stdout: string; stderr: string; output: string; stopped: boolean; truncated?: boolean; }
export function runProcess(executable: string, args: string[], options: ProcessOptions): Promise<ProcessResult> {
  return new Promise(resolve => {
    const stdout = boundedOutput(options.maxBytes, options.maxLines);
    const stderr = boundedOutput(options.maxBytes, options.maxLines);
    const combined = boundedOutput(options.maxBytes, options.maxLines);
    let settled = false, stopped = false;
    let fallback: ReturnType<typeof setTimeout> | undefined;
    const finish = (code: number | null) => {
      if (settled) return;
      settled = true; clearTimeout(timer); clearTimeout(fallback);
      options.signal?.removeEventListener("abort", abort);
      resolve({ exitCode: stopped ? 124 : code, stdout: stdout.value(), stderr: stderr.value(), output: combined.value(), stopped,
        truncated: stdout.isTruncated() || stderr.isTruncated() || combined.isTruncated() });
    };
    const child = spawn(executable, args, { cwd: options.cwd, env: options.env ?? process.env,
      shell: false, windowsHide: true, detached: process.platform !== "win32", stdio: ["pipe", "pipe", "pipe"] });
    const stop = (reason: string) => {
      if (stopped || settled) return;
      stopped = true; stderr.collect(`\n${reason}\n`); combined.collect(`\n${reason}\n`);
      if (child.pid) {
        if (process.platform === "win32") {
          const killer = spawn(path.join(process.env.SystemRoot ?? "C:\\Windows", "System32", "taskkill.exe"),
            ["/PID", String(child.pid), "/T", "/F"], { shell: false, windowsHide: true, stdio: "ignore" });
          killer.on("error", () => child.kill());
          killer.once("close", code => { if (code !== 0) child.kill("SIGKILL"); });
        } else { try { process.kill(-child.pid, "SIGKILL"); } catch { child.kill("SIGKILL"); } }
      }
      fallback = setTimeout(() => {
        child.kill("SIGKILL");
        child.stdout.destroy(); child.stderr.destroy();
        fallback = setTimeout(() => { child.unref(); finish(124); }, 1000);
      }, 3000);
    };
    const abort = () => stop("Command cancelled or verification deadline exceeded.");
    child.stdout.setEncoding("utf8"); child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk: string) => { stdout.collect(chunk); combined.collect(chunk); });
    child.stderr.on("data", (chunk: string) => { stderr.collect(chunk); combined.collect(chunk); });
    child.stdin.on("error", () => { /* Process completion reports early stdin closure. */ });
    child.once("error", error => { stderr.collect(`spawn error: ${error.message}`); combined.collect(`spawn error: ${error.message}`); finish(1); });
    child.once("close", finish);
    child.stdin.end(options.input);
    const timer = setTimeout(() => stop("Command timed out."), options.timeoutMs ?? 120_000);
    options.signal?.addEventListener("abort", abort, { once: true });
    if (options.signal?.aborted) abort();
  });
}
