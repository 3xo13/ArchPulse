import { expect, it } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

const launcher = fileURLToPath(new URL("../../scripts/archpulse.js", import.meta.url));
it.each(["yes", "no", "eof", "missing", "changed"])("real setup launcher: %s", { timeout: 60000 }, async mode => {
  const temporary = fs.mkdtempSync(path.join(os.tmpdir(), "archpulse setup "));
  const root = path.join(temporary, "project with spaces"), storage = path.join(temporary, "external");
  fs.mkdirSync(root);
  const manifest = path.join(root, "package.json");
  const data = { name: "setup-fixture", scripts: mode === "missing" ? {} : { test: "node NEVER-RUN.js", typecheck: "node ALSO-NEVER-RUN.js" } };
  fs.writeFileSync(manifest, JSON.stringify(data));
  fs.writeFileSync(path.join(root, "index.js"), "export const value = 1;\n");
  const initial = fs.readFileSync(manifest, "utf8");
  const child = spawn(process.execPath, [launcher, "setup", "--storage-base", storage], { cwd: root, windowsHide: true, stdio: ["pipe", "pipe", "pipe"] });
  let output = "", stderr = "", answered = false;
  child.stdout.on("data", chunk => {
    output += String(chunk);
    if (!answered && output.includes("[y/N]")) {
      answered = true;
      if (mode === "changed") fs.writeFileSync(manifest, JSON.stringify({ ...data, scripts: { test: "node CHANGED.js", typecheck: "node ALSO-NEVER-RUN.js" } }));
      child.stdin.end(mode === "eof" ? "" : mode === "no" ? "n\n" : "yes\n");
    }
  });
  child.stderr.on("data", chunk => { stderr += String(chunk); });
  const watchdog = setTimeout(() => child.kill(), 45000);
  try {
    const code = await new Promise<number | null>((resolve, reject) => { child.once("close", resolve); child.once("error", reject); });
    expect(code, stderr + output).toBe(mode === "changed" || mode === "missing" ? 2 : 0);
    const projectStore = path.join(storage, fs.readdirSync(storage)[0]!);
    expect(fs.existsSync(path.join(projectStore, "approval.json"))).toBe(mode === "yes");
    expect(fs.readdirSync(root).sort()).toEqual(["index.js", "package.json"]);
    if (mode !== "changed") expect(fs.readFileSync(manifest, "utf8")).toBe(initial);
    if (mode === "changed") expect(stderr).toContain("stale or modified");
    if (mode === "missing") expect(output).toContain("Full verification is not ready");
    if (mode === "yes") {
      expect(output).toContain("Working directory:");
      expect(output).toContain("node NEVER-RUN.js");
      expect(output).toContain("Checks approved.");
    }
  } finally {
    clearTimeout(watchdog);
    if (child.exitCode === null && child.signalCode === null) child.kill();
    fs.rmSync(temporary, { recursive: true, force: true });
  }
});
