# ArchPulse — Scanner + MCP Hardening Plan

**Scope:** Owner B workstream only — scanner execution, snapshot normalization, graph export,
MCP workspace handling, installer, ESLint/TypeScript tooling, README, and regression tests.
Does not touch case generation (C), verification (E), Bob workflow (D), or viewer (F).

**Branch:** `feature/scanner-mcp`

---

## Sub-Task 1 — Fix Scanner Execution and Snapshot Normalization

**Status:** `[ ] pending`

### Intent
Replace the `execFileSync`-on-a-.cmd-wrapper approach with a direct Node.js invocation of
dependency-cruiser's JS entry point via `process.execPath`. This avoids shell escaping issues,
platform binary-extension differences, and dependency on the target workspace having its own
depcruise install. Resolve all paths to absolute before passing to the scanner. Fix cycle-member
normalization and unresolved-edge counting.

### Expected Outcomes
- Scanner is invoked as: `process.execPath dependency-cruise.mjs --output-type json ...`
  with `shell: false`, resolved from ArchPulse's own `node_modules`.
- Paths passed to depcruise (config, tsconfig, scanScope) are all absolute.
- Windows-style backslash input in paths is normalized before `path.resolve`.
- A nonzero exit with valid JSON stdout is accepted; a nonzero exit with empty stdout
  or a non-JSON payload throws with a clear message.
- Cycle members in `summary.violations[].cycle` are typed as `{ name: string }` objects
  (not plain strings); normalization reads `.name` before calling `normalizePath`.
- `incompleteResolutionCount` counts dependency edges where `couldNotResolve === true`
  (not `!dep.resolved`), matching the actual depcruise JSON shape.
- `scannerWarnings` is populated from `summary.warn` items when the summary includes a
  `warnings` array; otherwise remains `[]`.
- All existing snapshot fields, exported helpers, and violation ID formats are preserved.

### Todo List
1. Read the exact shape of a real dependency-cruiser JSON result for the demo repo to confirm
   cycle member shape (`{ name: string }` vs `string`) and `couldNotResolve` field presence.
2. In `src/cli/scan.ts`:
   - Resolve `depcruiseBin` to the `.mjs` entry in ArchPulse's own `node_modules/dependency-cruiser/bin/`.
   - Change invocation to `execFileSync(process.execPath, [depcruiseBin, ...args], { shell: false })`.
   - Normalize backslashes in `repoRoot`, `configPath`, `scanScope` before `path.resolve`.
   - Resolve `configPath`, `tsconfig`, and `scanScope` to absolute paths before building the args array.
   - Keep the nonzero-exit-with-stdout = expected-violation-exit logic; distinguish from launch errors.
   - Remove the `ext`/`.cmd` workaround (no longer needed).
3. In `src/core/snapshot.ts`:
   - Update `RawDcModule.dependencies[].cycle` type from `string[]` to `Array<{ name: string }>`.
   - Update cycle path extraction: `v.cycle.map(c => normalizePath(c.name, repoRoot))`.
   - Change `incompleteResolutionCount` to count edges where `dep.couldNotResolve === true`.
   - Populate `scannerWarnings` from summary if present.
4. Confirm `tsc --noEmit` still passes.

### Relevant Context
- `src/cli/scan.ts` — `runDepcruise()` helper, lines ~153–200
- `src/core/snapshot.ts` — `RawDcModule` interface and `normalizeSnapshot()`
- `node_modules/dependency-cruiser/bin/dependency-cruise.mjs` — the JS entry point to invoke
- Actual depcruise JSON shape: run a scan once with Node 20+ and inspect `summary.violations[*].cycle`

---

## Sub-Task 2 — Produce a Real Dependency Graph

**Status:** `[ ] pending`

### Intent
Replace the second `depcruise` CLI call (which re-scans and requires system Graphviz) with a
programmatic flow:
1. Reuse the raw cruise result already obtained from the first scan.
2. Call `await format(rawResult, { outputType: "dot" })` from dependency-cruiser's JS API
   and take `.output` from the returned object to get the DOT string.
3. Render DOT → SVG using `@viz-js/viz` (bundled WASM, no system Graphviz needed).
4. Pipe the SVG through dependency-cruiser's bundled `wrap-stream-in-html.mjs` executable
   (stdin → stdout, `shell: false`, via `process.execPath`) to get the interactive HTML.

This removes the second scan, eliminates the system Graphviz requirement, and produces an
interactive HTML graph that opens offline. `wrapInHTML` is an internal module; use the
published executable instead.

### Expected Outcomes
- Only one depcruise CLI invocation per `runScan()` call (for JSON output).
- `@viz-js/viz` is added as a runtime dependency in `package.json`.
- `graph.html` contains valid SVG with `<g>` node and edge elements.
- The HTML includes dependency-cruiser's hover/click stylesheet and script (from the
  `wrap-stream-in-html.mjs` executable output).
- If Viz.js rendering fails, `runScan()` throws a descriptive error rather than writing
  empty/broken HTML.
- `graph.html` opens in a browser without any network requests (fully self-contained).

### Todo List
1. Add `@viz-js/viz` to `dependencies` in `package.json`; run `npm install`.
2. In `src/cli/scan.ts`:
   - `runDepcruise()` already returns JSON stdout. Keep it returning the raw JSON string.
     Parse it once: `const rawJson = JSON.parse(rawOutput)`.
   - After normalizing the snapshot, call:
     `const { output: dot } = await format(rawJson, { outputType: "dot" })`
     where `format` is imported from `dependency-cruiser`'s main entry
     (`node_modules/dependency-cruiser/src/main/index.mjs`).
   - Import `instance` from `@viz-js/viz`; call `const viz = await instance()` then
     `const svg = viz.renderString(dot)`.
   - Spawn `process.execPath` with the absolute path to
     `node_modules/dependency-cruiser/bin/wrap-stream-in-html.mjs` using `spawnSync`,
     `shell: false`, passing `svg` as `input`. Collect `stdout` as the HTML string.
   - Write the HTML string to `graph.html`.
   - Throw a descriptive error if `renderString` throws or if `spawnSync` returns a
     non-zero status.
3. Confirm `graph.html` is written, non-empty, and contains `<svg` after a scan.
4. Confirm `tsc --noEmit` passes.

### Relevant Context
- `node_modules/dependency-cruiser/src/main/index.mjs` — exports async `format(result, opts)`;
  returns `{ output: string, exitCode: number }` (use `.output` for the DOT string)
- `node_modules/dependency-cruiser/bin/wrap-stream-in-html.mjs` — executable: reads SVG from
  stdin, writes interactive HTML (with CSS and JS) to stdout; invoke with `process.execPath`,
  `shell: false`
- `node_modules/dependency-cruiser/src/cli/tools/wrap-stream-in-html.mjs` — the actual
  implementation that streams header/SVG/footer; use via the bin executable, not directly
- Viz.js API: `import { instance } from "@viz-js/viz"; const viz = await instance(); const svg = viz.renderString(dot);`

---

## Sub-Task 3 — Harden MCP Workspace Handling

**Status:** `[ ] pending`

### Intent
Make workspace path validation in `src/mcp/server.ts` robust against cross-drive paths,
traversal, and symlinks/junctions. Use `ARCHPULSE_ROOT` env var as the trusted root when
set. Restrict artifact output to the chosen workspace — this includes `outDir` and the
final artifact files (`snapshot.json`, `graph.html`), not just the initial `workspacePath`.
Move validation inside the error boundary. Cap MCP summaries at 10 violations. Fix stub
tools to return `isError: true`. Remove the suggestion that case IDs are ready.

### Expected Outcomes
- `ARCHPULSE_ROOT` env var, when set, is used as the trusted workspace root; otherwise `process.cwd()`.
- `ARCHPULSE_ROOT` is treated as a literal filesystem path (Bob expands `${workspaceFolder}`
  before the server process starts; the server must not attempt to expand it itself).
- Relative `workspacePath` inputs are resolved against `ARCHPULSE_ROOT`.
- Path validation uses `fs.realpathSync` on both the trusted root and the resolved path.
  Because `outDir` and artifact paths may not exist yet, validate their **nearest existing
  ancestor** with `realpathSync` rather than the full path (walk up until `existsSync` is true).
- Cross-drive paths are rejected on Windows (different drive-letter prefix after realpathSync).
- Existing symlinks or junctions whose real target falls outside the workspace are rejected
  (detected by comparing the realpathSync of the ancestor to the trusted root).
- Validation for `workspacePath`, `outDir`, and final artifact paths all happen inside the
  `try/catch` so rejected inputs return a normal MCP error response.
- Summary is capped at 10 violations; if more exist, the text says "… and N more".
- `get_case` and `verify_case` return `isError: true` with a message stating implementation is pending.
- No mention of "generated case IDs" in `scan_repository` output.

### Todo List
1. In `src/mcp/server.ts`:
   - Read `ARCHPULSE_ROOT` from `process.env`; fall back to `process.cwd()`. Do not attempt
     shell-variable expansion — Bob has already substituted `${workspaceFolder}` by the time
     the server starts.
   - Write a helper `validateWithinWorkspace(candidatePath, trustedRoot)`:
     - Walk up `candidatePath` with `path.dirname` until `fs.existsSync` returns true;
       call `fs.realpathSync` on that ancestor.
     - Call `fs.realpathSync` on `trustedRoot` (it must exist).
     - On win32, compare drive-letter prefixes (reject if different).
     - Use `path.relative(realRoot, realAncestor)` and reject if it starts with `..`.
   - Apply `validateWithinWorkspace` to: the resolved `workspacePath`, the resolved `outDir`
     (if provided), and the computed artifact paths (`snapshotPath`, `graphPath`) before
     passing them to `runScan`.
   - Move all validation inside the `try/catch` block.
   - Cap violations list at 10 entries; append "… and N more violation(s)" when truncated.
   - Change `get_case` and `verify_case` to return `isError: true`.
   - Remove the final "Call get_case with one of the case IDs" line.
2. Confirm `tsc --noEmit` passes.

### Relevant Context
- `src/mcp/server.ts` — `resolveWorkspacePath()` and all three tool handlers
- `.bob/mcp.json` — sets `ARCHPULSE_ROOT: "${workspaceFolder}"`; Bob expands this before spawning

---

## Sub-Task 4 — Installer Script and MCP Config

**Status:** `[ ] pending`

### Intent
Update `scripts/install-bob-addon.js` (create if it does not yet exist) to handle both
self-install and external install correctly, with the tsx loader resolved by absolute path
for external installs so the server launches regardless of working directory.

**Self-install** (`targetWorkspace` omitted or equals the ArchPulse directory):
- Updates the in-repo `.bob/mcp.json` to use `node --import tsx/esm` with relative
  `src/mcp/server.ts`, keeping the file portable and committable.
- Sets `ARCHPULSE_ROOT: "${workspaceFolder}"` — Bob expands this variable before spawning;
  the literal string `${workspaceFolder}` is correct in `.bob/mcp.json`.
- Safe to repeat: re-running overwrites only the archpulse entry.

**External install** (a different workspace path is given):
- Uses `node` with `--import` pointing to the **absolute path** of `tsx/esm` resolved from
  ArchPulse's `node_modules` (e.g. `/abs/path/to/archpulse/node_modules/tsx/dist/esm/index.cjs`).
  Bare `--import tsx/esm` would be resolved relative to the target workspace's working
  directory, where tsx may not be installed.
- Also points `--import` at the absolute path of `src/mcp/server.ts` (or `dist/mcp/server.js`
  if a build is preferred; the tsx-loader approach avoids a separate build step).
- Sets `ARCHPULSE_ROOT` to the target workspace's actual absolute path (not `${workspaceFolder}`
  — Bob does not expand variables in externally configured workspaces that it did not open).
- Does not write machine-specific absolute paths into the tracked `.bob/mcp.json`.

Both cases:
- Merge into the target's `.bob/mcp.json` rather than overwriting it (preserve other servers).
- Skip skill-copy when source and destination skill directories resolve to the same path.
- Validate prerequisites before writing any files.

### Expected Outcomes
- Running `node scripts/install-bob-addon.js` (self) produces a portable `.bob/mcp.json`.
- Running `node scripts/install-bob-addon.js /path/to/other/workspace` writes absolute paths
  for the tsx loader and server entry, and sets `ARCHPULSE_ROOT` to that target's real path.
  Launching the server from any working directory produces a valid MCP session.
- Other MCP server entries in the target `.bob/mcp.json` are preserved.
- If `.bob/mcp.json` does not exist in the target, it is created with just the archpulse entry.
- If source and target skill directories are the same resolved path, skill copy is skipped.
- Prerequisite checks: Node ≥ 20, target directory exists, ArchPulse `package.json` readable,
  `node_modules/tsx` present in ArchPulse installation.
- Script errors print a clear message and exit nonzero.

### Todo List
1. Create (or update) `scripts/install-bob-addon.js` as ESM.
2. Detect self-install vs external: compare `path.resolve(targetWorkspace)` to `archpulseRoot`.
3. Self-install: write `node --import tsx/esm src/mcp/server.ts` (relative paths, portable),
   `ARCHPULSE_ROOT: "${workspaceFolder}"`.
4. External install:
   - Resolve the absolute path to the tsx ESM loader from ArchPulse's node_modules:
     `path.join(archpulseRoot, "node_modules", "tsx", "dist", "esm", "index.cjs")`.
     Verify this file exists; fail with a clear message if not.
   - Resolve absolute path to `src/mcp/server.ts` within archpulseRoot.
   - Set `ARCHPULSE_ROOT` to `path.resolve(targetWorkspace)` (the actual directory path).
   - Build the entry: `{ command: "node", args: ["--import", absLoaderPath, absServerPath],
     env: { ARCHPULSE_ROOT: targetAbsPath } }`.
5. Read existing target `.bob/mcp.json`; merge archpulse key; write back.
6. Check whether source and target skill dirs are the same absolute path; skip copy if equal.
7. If copy needed: `mkdirSync` target `.bob/skills/archpulse/` and copy `SKILL.md`.
8. Add `"install": "node scripts/install-bob-addon.js"` to `package.json` scripts.
9. Confirm self-install is idempotent: run twice, confirm `.bob/mcp.json` is unchanged on
   the second run and other MCP entries are still present.

### Relevant Context
- `.bob/mcp.json` — existing config; `${workspaceFolder}` is a Bob variable, not a shell variable
- `.bob/skills/archpulse/SKILL.md` — skill to copy for external installs
- tsx ESM loader location to verify: `node_modules/tsx/dist/esm/index.cjs`

---

## Sub-Task 5 — ESLint, TypeScript Tooling, and Dependencies

**Status:** `[ ] pending`

### Intent
Configure ESLint with TypeScript-aware parsing and `@typescript-eslint` rules so unused-variable
errors are caught for TypeScript code (not just JavaScript). Declare all directly imported packages
explicitly. Update the lockfile.

### Expected Outcomes
- `eslint.config.js` uses `typescript-eslint` plugin and parser for `*.ts` files.
- `@typescript-eslint/no-unused-vars` replaces `no-unused-vars` for TypeScript files,
  with `argsIgnorePattern: "^_"` preserved.
- `@eslint/js` and `zod` are listed in `dependencies` or `devDependencies` as appropriate.
- `npm run lint` runs without the `structuredClone` crash (requires Node ≥ 20 — document this).
- `tsc --noEmit` continues to pass.
- `package-lock.json` is updated to reflect new/changed dependencies.

### Todo List
1. Add `typescript-eslint` to `devDependencies`; run `npm install`.
2. Add `zod` to `dependencies` (it is imported directly in `server.ts`).
3. Rewrite `eslint.config.js`:
   - Import `tseslint` from `typescript-eslint`.
   - Use `tseslint.config()` with `tseslint.configs.recommended` for TypeScript files.
   - Apply `@typescript-eslint/no-unused-vars` rule with `argsIgnorePattern: "^_"`.
   - Keep `no-console: off` for `src/**/*.ts`.
   - Keep ignores for `dist/**`, `node_modules/**`, `demo/**`.
4. Run `npm run lint` on Node 20+ to confirm no new errors.
5. Confirm `tsc --noEmit` still passes.

### Relevant Context
- `eslint.config.js` — current flat config using `@eslint/js` only
- `package.json` — `zod` is missing from dependencies despite being imported in `server.ts`
- typescript-eslint flat config: https://typescript-eslint.io/getting-started/

---

## Sub-Task 6 — Regression Tests

**Status:** `[ ] pending`

### Intent
Add focused unit/integration tests in `src/` covering the scanner and MCP surface area.
Update `vitest.config.ts` to include `src/**/*.test.ts`.

### Expected Outcomes
- `npm test` runs both the existing demo tests and new `src/` tests.
- New tests cover:
  - `normalizeSnapshot` with real circular-dep output (cycle members as `{ name }` objects)
    and multiple `couldNotResolve` edges.
  - `makeViolationId` producing stable IDs across two identical inputs.
  - Paths with spaces and special chars being passed literally (no shell expansion).
  - Missing config file, malformed JSON output, and empty stdout producing clear errors.
  - Cross-drive paths and `..` traversal being rejected by workspace validation.
  - `scan_repository` MCP tool returning a bounded summary (≤10 violations shown) when
    given more than 10 violations.
  - `get_case` and `verify_case` MCP stubs returning `isError: true`.
- Graph tests: graph HTML contains `<svg` and `<g` elements; rendering failure is reported as
  an error (not silently swallowed); `wrap-stream-in-html.mjs` is invoked via `process.execPath`
  with SVG on stdin.

### Todo List
1. Update `vitest.config.ts` to add `"src/**/*.test.ts"` to the `include` array (keep the
   existing `demo/packages/*/src/**/*.test.ts` entry).
2. Create `src/core/snapshot.test.ts` — tests for `normalizePath`, `makeViolationId`,
   `normalizeSnapshot` with realistic fixture inputs including:
   - cycle members as `{ name: string }` objects
   - multiple `couldNotResolve: true` edges for `incompleteResolutionCount`
   - stable IDs across repeated calls with identical input
3. Create `src/cli/scan.test.ts` — tests for:
   - paths with spaces and shell characters are passed literally (not shell-expanded)
   - missing config file throws a clear error
   - empty stdout from depcruise throws a clear error
   - malformed JSON output throws a clear error
4. Create `src/mcp/server.test.ts` — tests for:
   - workspace path validation: `..` traversal and cross-drive (win32) paths are rejected
   - `scan_repository` summary is capped at 10 violations with "N more" message
   - `get_case` returns `isError: true`
   - `verify_case` returns `isError: true`
5. Create `src/cli/graph.test.ts` — tests for:
   - graph HTML contains `<svg` and `<g` elements after a real scan
   - rendering failure from Viz.js is surfaced as a thrown error
   - `wrap-stream-in-html.mjs` invocation uses `process.execPath`, not system `dot`
6. Create `src/scripts/installer.test.ts` — tests for:
   - self-install produces portable relative paths and `${workspaceFolder}` in env
   - repeated self-install is idempotent (file content unchanged on second run)
   - self-install preserves pre-existing MCP server entries in `.bob/mcp.json`
   - external install uses absolute tsx loader path and absolute server path
   - external install sets `ARCHPULSE_ROOT` to the target workspace's real path, not `${workspaceFolder}`
   - skill copy is skipped when source and target resolve to the same directory
   - launching the server from a temporary directory (simulating a separate workspace)
     succeeds: the server starts and the MCP handshake completes
7. Add the following tests to `src/cli/scan.test.ts`:
   - scan of a directory whose path contains spaces passes the path literally to depcruise
     (verify the spawned args contain the unexpanded string)
   - scan producing a real circular dependency yields a violation with `cyclePath` populated
   - scan of a source file with an unresolved import increments `incompleteResolutionCount`
8. Confirm all tests pass with `npm test`.

### Relevant Context
- `vitest.config.ts` — currently only includes `demo/packages/*/src/**/*.test.ts`
- `artifacts/example/snapshot-before.json` — usable as a fixture for MCP summary tests
- `demo/packages/shared/src/index.ts` — has the seeded `shared → domain` violation (circular)
- `node_modules/tsx/dist/esm/index.cjs` — absolute tsx loader path for external install tests

---

## Sub-Task 7 — README and Documentation

**Status:** `[ ] pending`

### Intent
Create a `README.md` covering: what ArchPulse is, prerequisites, installation, the scan command
(corrected), graph generation explanation, and clearly labelling unfinished commands/features.

### Expected Outcomes
- `README.md` exists with sections: Overview, Prerequisites, Installation, Usage, Graph Output,
  Unfinished Features, and Development.
- Scan command shows the correct flags (`--repo`, `--out`, `--scope`, `--config`).
- No stale test count.
- Graph export section explains that `@viz-js/viz` is used (no system Graphviz needed) and
  that `graph.html` opens offline.
- `cases` and `compare` CLI commands are labelled as pending (Owner C and E respectively).
- `get_case` and `verify_case` MCP tools are labelled as pending.

### Todo List
1. Create `README.md` at repo root.
2. Write Overview section (one paragraph).
3. Write Prerequisites section (Node ≥ 20, npm ≥ 9, no system Graphviz required).
4. Write Installation section (clone, `npm install`, `node scripts/install-bob-addon.js`).
5. Write Usage section with correct `npm run scan` flags and example output.
6. Write Graph Output section.
7. Write Unfinished Features table noting C/E/D/F owners.
8. Write Development section (build, test, lint commands).

### Relevant Context
- `TEAM.md` — owner assignments and feature descriptions
- `ARCHPULSE_EXECUTION_PLAN.md` — full context for the product pitch

---

## Sub-Task 8 — Combined Validation

**Status:** `[ ] pending`

### Intent
Confirm that all sub-tasks integrate correctly: build passes, lint passes, all tests pass,
the demo still reports its two seeded violations, and the MCP server starts cleanly.

### Expected Outcomes
- `npm run build` produces no TypeScript errors.
- `npm run lint` produces no errors (on Node 20+).
- `npm test` passes all tests (demo suite + new src tests).
- `npm run scan` on the demo repo reports exactly 2 violations (`shared-no-domain`, `ui-no-db`).
- `graph.html` is written and contains `<svg` markup.
- The MCP server process starts without crashing when launched via `npm start`.
- The `feature/scanner-mcp` branch is pushed with a clean commit history.

### Todo List
1. Run `tsc --noEmit` and fix any remaining type errors.
2. Run `npm test` and confirm all suites pass.
3. Run `npm run scan` against the demo and verify both violations appear.
4. Open `graph.html` in a browser and confirm nodes and edges are visible.
5. Commit all changes with a clear message.
6. Push to `origin/feature/scanner-mcp`.

---

## Cross-Cutting Notes

- **Preserve:** snapshot `schemaVersion: "1"`, artifact filenames (`snapshot.json`, `graph.html`),
  CLI flags (`--repo`, `--out`, `--scope`, `--config`), all three MCP tool names and input fields,
  `.archpulse/latest` default output location.
- **Do not touch:** `src/core/grouping.ts` (C), `src/core/casePacket.ts` (C),
  `src/core/compare.ts` (E), `src/core/runner.ts` (E), `src/viewer/` (F),
  demo package source code (violations are intentional).
- **Demo violations must remain:** `shared-no-domain` and `ui-no-db` are seeded intentionally.
  The scanner must detect and report them; do not change demo source files.
- **MCP output containment** (artifact path validation) applies only to MCP requests;
  CLI `--out` flag retains explicit directory selection.
