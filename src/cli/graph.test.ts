/**
 * Tests for graph HTML generation.
 *
 * Because built-in node module exports (childProcess.spawnSync, etc.) are
 * non-configurable in ESM and cannot be spied on with vi.spyOn, we test
 * the graph generation logic via real integration runs and by verifying
 * scan.ts source-level invariants about how the wrap-stream-in-html.mjs
 * binary is invoked.
 */

import { describe, it, expect } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import { fileURLToPath } from "node:url";
import { readFileSync } from "node:fs";

const thisDir = path.dirname(fileURLToPath(import.meta.url));
const ARCHPULSE_ROOT = path.resolve(thisDir, "..", "..");

// ─── Source code invariants ───────────────────────────────────────────────────
// We verify by reading the scan.ts source that the correct invocation pattern
// is present. This is a white-box test that catches regressions in the
// invocation code without requiring actual process spawning.

describe("graph generation — spawnSync command (source invariant)", () => {
  it("scan.ts invokes wrap-stream-in-html.mjs via process.execPath (not 'dot')", () => {
    const scanSrc = readFileSync(
      path.join(ARCHPULSE_ROOT, "src", "cli", "scan.ts"),
      "utf8"
    );

    // The spawnSync call must use process.execPath as the command
    expect(scanSrc).toContain("spawnSync(");
    expect(scanSrc).toContain("process.execPath");
    expect(scanSrc).toContain("wrap-stream-in-html.mjs");

    // It must NOT invoke "dot" (system Graphviz)
    expect(scanSrc).not.toMatch(/spawnSync\s*\(\s*["']dot["']/);
    expect(scanSrc).not.toMatch(/execFileSync\s*\(\s*["']dot["']/);
  });

  it("scan.ts uses shell: false for the wrap-stream-in-html.mjs invocation", () => {
    const scanSrc = readFileSync(
      path.join(ARCHPULSE_ROOT, "src", "cli", "scan.ts"),
      "utf8"
    );
    // shell: false must appear in the spawnSync options
    expect(scanSrc).toContain("shell: false");
  });
});

// ─── Viz.js error propagation (source invariant) ─────────────────────────────

describe("graph generation — Viz.js error propagation (source invariant)", () => {
  it("scan.ts wraps viz.renderString in try/catch and throws a descriptive error", () => {
    const scanSrc = readFileSync(
      path.join(ARCHPULSE_ROOT, "src", "cli", "scan.ts"),
      "utf8"
    );

    // The try/catch around renderString must rethrow with a descriptive message
    expect(scanSrc).toContain("renderString");
    expect(scanSrc).toContain("Viz.js failed");
    expect(scanSrc).toContain("catch");
  });
});

// ─── Integration: generated HTML contains <svg and <g ─────────────────────────

describe("graph generation — HTML content (integration)", () => {
  const nodeMajor = parseInt(process.versions.node.split(".")[0]!, 10);
  const runIt = nodeMajor >= 20 ? it : it.skip;

  runIt(
    "graph HTML from a real scan contains <svg and at least one <g",
    { timeout: 90_000 },
    async () => {
      const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "archpulse-graph-test-"));
      try {
        const { runScan } = await import("./scan.js");
        const outRelDir = path.relative(
          ARCHPULSE_ROOT,
          path.join(tmpDir, "out")
        );
        const summary = await runScan({
          repoRoot: ARCHPULSE_ROOT,
          scanScope: "demo/packages",
          outDir: outRelDir,
        });

        const graphPath = path.join(ARCHPULSE_ROOT, summary.graphPath);
        expect(fs.existsSync(graphPath)).toBe(true);

        const html = fs.readFileSync(graphPath, "utf8");
        expect(html).toContain("<svg");
        expect(html).toContain("<g");
      } finally {
        fs.rmSync(tmpDir, { recursive: true, force: true });
      }
    }
  );
});
