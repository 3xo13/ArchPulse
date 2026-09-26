/**
 * Tests for scripts/install-bob-addon.js
 *
 * Because the installer is a self-contained script (no module exports),
 * we test it by spawning it as a subprocess and inspecting the resulting
 * .bob/mcp.json file contents.
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { spawnSync } from "node:child_process";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import { fileURLToPath, pathToFileURL } from "node:url";

const thisDir = path.dirname(fileURLToPath(import.meta.url));
const ARCHPULSE_ROOT = path.resolve(thisDir, "..", "..");
const INSTALLER = path.join(ARCHPULSE_ROOT, "scripts", "install-bob-addon.js");

function runInstaller(args: string[] = [], cwd = ARCHPULSE_ROOT) {
  return spawnSync(process.execPath, [INSTALLER, ...args], {
    cwd,
    encoding: "utf8",
    timeout: 15_000,
  });
}

function readMcpJson(dir: string): Record<string, unknown> {
  const p = path.join(dir, ".bob", "mcp.json");
  return JSON.parse(fs.readFileSync(p, "utf8")) as Record<string, unknown>;
}

// ─── Self-install ─────────────────────────────────────────────────────────────

describe("self-install", () => {
  // We run the self-install against a temp copy of .bob/mcp.json to avoid
  // modifying the real one. We do this by temporarily replacing .bob/mcp.json
  // and restoring it after each test.
  let originalMcpJson: string | null = null;
  const mcpPath = path.join(ARCHPULSE_ROOT, ".bob", "mcp.json");

  beforeEach(() => {
    if (fs.existsSync(mcpPath)) {
      originalMcpJson = fs.readFileSync(mcpPath, "utf8");
    } else {
      originalMcpJson = null;
    }
  });

  afterEach(() => {
    if (originalMcpJson !== null) {
      fs.writeFileSync(mcpPath, originalMcpJson, "utf8");
    } else if (fs.existsSync(mcpPath)) {
      fs.unlinkSync(mcpPath);
    }
  });

  it("self-install writes a portable .bob/mcp.json with tsx/esm, server.ts, and ${workspaceFolder}", () => {
    const result = runInstaller();
    expect(result.status, result.stderr).toBe(0);

    const mcp = readMcpJson(ARCHPULSE_ROOT);
    const servers = mcp.mcpServers as Record<string, unknown>;
    const entry = servers.archpulse as {
      args: string[];
      env: Record<string, string>;
    };

    expect(entry).toBeDefined();
    // Should contain tsx/esm (relative loader)
    expect(entry.args.join(" ")).toContain("tsx/esm");
    // Should contain server.ts (relative path)
    expect(entry.args.join(" ")).toContain("src/mcp/server.ts");
    // ARCHPULSE_ROOT env should be ${workspaceFolder}
    expect(entry.env.ARCHPULSE_ROOT).toBe("${workspaceFolder}");
  });

  it("self-install is idempotent: running twice produces identical JSON", () => {
    const r1 = runInstaller();
    expect(r1.status, r1.stderr).toBe(0);
    const content1 = fs.readFileSync(mcpPath, "utf8");

    const r2 = runInstaller();
    expect(r2.status, r2.stderr).toBe(0);
    const content2 = fs.readFileSync(mcpPath, "utf8");

    expect(content1).toBe(content2);
  });

  it("self-install preserves a pre-existing MCP server entry", () => {
    // Write a .bob/mcp.json with an existing server before running the installer
    const existing = {
      mcpServers: {
        "other-server": {
          type: "stdio",
          command: "node",
          args: ["other-server.js"],
          env: {},
        },
      },
    };
    fs.mkdirSync(path.join(ARCHPULSE_ROOT, ".bob"), { recursive: true });
    fs.writeFileSync(mcpPath, JSON.stringify(existing, null, 2) + "\n", "utf8");

    const result = runInstaller();
    expect(result.status, result.stderr).toBe(0);

    const mcp = readMcpJson(ARCHPULSE_ROOT);
    const servers = mcp.mcpServers as Record<string, unknown>;

    // Both the pre-existing server and archpulse should be present
    expect(servers["other-server"]).toBeDefined();
    expect(servers.archpulse).toBeDefined();
  });
});

// ─── External install ─────────────────────────────────────────────────────────

describe("external install", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "archpulse-ext-test-"));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("external install writes absolute tsx loader path ending in index.cjs or index.mjs", () => {
    const result = runInstaller([tmpDir]);
    expect(result.status, result.stderr).toBe(0);

    const mcp = readMcpJson(tmpDir);
    const servers = mcp.mcpServers as Record<string, unknown>;
    const entry = servers.archpulse as {
      args: string[];
      env: Record<string, string>;
    };

    expect(entry).toBeDefined();

    // Find the --import argument value (the tsx loader)
    const importIdx = entry.args.indexOf("--import");
    expect(importIdx).toBeGreaterThanOrEqual(0);
    const loaderArg = entry.args[importIdx + 1]!;

    // On Windows the installer emits a file:// URL; on other platforms an absolute path.
    // Either way it must reference the tsx loader ending in index.cjs or index.mjs.
    const normalizedLoader = loaderArg.startsWith("file:///")
      ? fileURLToPath(loaderArg)
      : loaderArg;
    expect(path.isAbsolute(normalizedLoader)).toBe(true);
    // Must end in index.cjs or index.mjs
    expect(normalizedLoader).toMatch(/index\.(cjs|mjs)$/);
  });

  it("external install sets ARCHPULSE_ROOT to the target workspace real path (not ${workspaceFolder})", () => {
    const result = runInstaller([tmpDir]);
    expect(result.status, result.stderr).toBe(0);

    const mcp = readMcpJson(tmpDir);
    const servers = mcp.mcpServers as Record<string, unknown>;
    const entry = servers.archpulse as {
      env: Record<string, string>;
    };

    const archpulseRoot = entry.env["ARCHPULSE_ROOT"]!;
    expect(archpulseRoot).not.toBe("${workspaceFolder}");
    // Should be an absolute path
    expect(path.isAbsolute(archpulseRoot)).toBe(true);
    // Should point to the target workspace (resolved real path)
    const realTmp = fs.realpathSync(tmpDir);
    expect(archpulseRoot).toBe(realTmp);
  });

  it("external install args contain an absolute path to server.ts", () => {
    const result = runInstaller([tmpDir]);
    expect(result.status, result.stderr).toBe(0);

    const mcp = readMcpJson(tmpDir);
    const servers = mcp.mcpServers as Record<string, unknown>;
    const entry = servers.archpulse as { args: string[] };

    // The last arg should be the absolute server path
    const serverArg = entry.args.find((a) => a.endsWith("server.ts"));
    expect(serverArg).toBeDefined();
    expect(path.isAbsolute(serverArg!)).toBe(true);
  });
});

// ─── Skill copy ───────────────────────────────────────────────────────────────

describe("skill copy", () => {
  it("skips skill copy when source and target skill dirs resolve to the same directory (self-install)", () => {
    // In self-install mode, source and target skill dirs are the same.
    // The installer should log that it's skipping, not fail or copy anything.
    // We verify by checking the script output mentions "skipping"
    const result = runInstaller();
    expect(result.status).toBe(0);
    expect(result.stdout).toMatch(/skip/i);
  });

  it("copies SKILL.md when installing to a different target workspace", () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "archpulse-skill-test-"));
    try {
      const result = runInstaller([tmpDir]);
      expect(result.status, result.stderr).toBe(0);

      const targetSkill = path.join(tmpDir, ".bob", "skills", "archpulse", "SKILL.md");
      expect(fs.existsSync(targetSkill)).toBe(true);
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });
});

// ─── MCP server launch test ───────────────────────────────────────────────────

describe("MCP server launch from external workspace", () => {
  const nodeMajor = parseInt(process.versions.node.split(".")[0]!, 10);
  const runIt = nodeMajor >= 20 ? it : it.skip;

  runIt(
    "server launched from a temp directory via external install args starts without error",
    { timeout: 15_000 },
    () => {
      const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "archpulse-srv-test-"));
      try {
        // Run external install to get the correct args
        const installResult = runInstaller([tmpDir]);
        expect(installResult.status, installResult.stderr).toBe(0);

        const mcp = readMcpJson(tmpDir);
        const servers = mcp.mcpServers as Record<string, unknown>;
        const entry = servers.archpulse as {
          args: string[];
          env: Record<string, string>;
        };

        // Launch the server using the installed args
        const serverResult = spawnSync(process.execPath, entry.args, {
          cwd: tmpDir,
          encoding: "utf8",
          timeout: 5_000,
          input: "", // EOF on stdin so server exits immediately
          env: { ...process.env, ...entry.env },
        });

        // The server should start (status 0 from EOF on stdin, or null from timeout)
        // It must NOT exit with code 1 (which would indicate a startup crash)
        const exitCode = serverResult.status;
        expect(exitCode, `stderr: ${serverResult.stderr}`).not.toBe(1);
      } finally {
        fs.rmSync(tmpDir, { recursive: true, force: true });
      }
    }
  );
});
