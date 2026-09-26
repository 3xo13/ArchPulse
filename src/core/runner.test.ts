import { it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import { runTestCommand } from "./runner.js";

let temp: string;
beforeEach(() => {
  temp = fs.mkdtempSync(path.join(os.tmpdir(), "archpulse runner "));
  fs.mkdirSync(path.join(temp, "config"));
});
afterEach(() => fs.rmSync(temp, { recursive: true, force: true }));
function configure(commands: unknown) {
  fs.writeFileSync(path.join(temp, "config/architecture.json"), JSON.stringify({ testCommands: commands }));
}
function script(code: string, args = "") {
  fs.writeFileSync(path.join(temp, "test script.cjs"), code);
  configure([`node "test script.cjs" ${args}`]);
}
it("preserves spaces, empty quoted arguments, Windows separators, and literal shell characters", async () => {
  script("console.log(JSON.stringify(process.argv.slice(2)))", '"two words" \'single quoted\' "" "C:\\some path\\file" "$HOME" "a&b"');
  const result = await runTestCommand(0, temp);
  expect(result.exitCode).toBe(0);
  expect(JSON.parse(result.output)).toEqual(["two words", "single quoted", "", "C:\\some path\\file", "$HOME", "a&b"]);
});
it("retains actual failing exit codes", async () => {
  script("console.error('failed assertion'); process.exitCode=7;");
  const result = await runTestCommand(0, temp);
  expect(result.exitCode).toBe(7); expect(result.output).toContain("failed assertion");
});
it.each([[], [""], ["   "], [null], "node test"])("rejects invalid allowlist %j", async commands => {
  configure(commands); await expect(runTestCommand(0, temp)).rejects.toThrow(/testCommands/);
});
it("rejects invalid indexes and unmatched quotes", async () => {
  configure(['node "unclosed']);
  await expect(runTestCommand(0, temp)).rejects.toThrow(/quote/);
  await expect(runTestCommand(-1, temp)).rejects.toThrow(/out of range/);
  await expect(runTestCommand(0.5, temp)).rejects.toThrow(/out of range/);
});
it("reports launch failure", async () => {
  configure(["archpulse-nonexistent-executable"]);
  expect(await runTestCommand(0, temp)).toMatchObject({ exitCode: 1, output: expect.stringContaining("spawn error") });
});
it.each(["console.log('line\\n'.repeat(10000));", "process.stdout.write('x'.repeat(1024*1024));"])("bounds captured output while draining the process", async code => {
  script(code);
  const result = await runTestCommand(0, temp);
  expect(result.exitCode).toBe(0);
  expect(Buffer.byteLength(result.output)).toBeLessThanOrEqual(256 * 1024);
  expect(result.output.split("\n").length).toBeLessThanOrEqual(500);
  expect(result.output).toContain("output truncated");
});
it.each([0, 1, 2, 3])("runs actual configured npx command %s", { timeout: 30000 }, async index => {
  const result = await runTestCommand(index, process.cwd());
  expect(result.exitCode, result.output).toBe(0);
  expect(result.output).toContain("passed");
});
it("runs the npm JavaScript entry point", { timeout: 15000 }, async () => {
  configure(["npm --version"]);
  const result = await runTestCommand(0, temp);
  expect(result.exitCode, result.output).toBe(0);
  expect(result.output.trim()).toMatch(/^\d+\.\d+\.\d+/);
});
it("fails missing npx dependencies offline without installing anything", { timeout: 15000 }, async () => {
  configure(["npx archpulse-missing-test-package-51a3"]);
  const result = await runTestCommand(0, temp);
  expect(result.exitCode).not.toBe(0);
  expect(result.output).toContain("automatic installation is disabled");
  expect(fs.existsSync(path.join(temp, "node_modules"))).toBe(false);
});
