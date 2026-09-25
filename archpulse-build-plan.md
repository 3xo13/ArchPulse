# ArchPulse — Build Plan

## Overview

Build the ArchPulse Bob IDE add-on from scratch on a clean workspace. The add-on consists of a local Node.js MCP server (three tools), a Bob skill, a demo JavaScript/TypeScript monorepo (npm workspaces) with a seeded architectural violation, and a Vite + React results viewer (with a static HTML fallback if it risks Gate 2). The plan follows the six-person ownership model and gate order defined in `ARCHPULSE_EXECUTION_PLAN.md`.

Sub-tasks are ordered so each can be handed off independently. All sub-tasks assume `ARCHPULSE_EXECUTION_PLAN.md` is the authoritative contract reference. Each owner works in their own feature branch and rebases into the shared demo branch frequently. Bob IDE sessions are used for relevant implementation/review work; CLI is used for debug scans to preserve BobCoin budget.

---

## Sub-Task 1 — Project Scaffolding and Dependency Installation

**Status:** `[ ] pending`

### Intent
Create the repository skeleton, install all required Node.js dependencies, and establish the build and lint configuration. Nothing runs yet, but every subsequent owner can import from a known, working module graph.

### Expected Outcomes
- `package.json` exists with all production and dev dependencies declared and locked.
- TypeScript compiles with zero errors on an empty `src/` tree.
- ESLint passes on an empty source tree.
- Directory structure matches the layout in the execution plan (section 4).
- `dependency-cruiser` is installed and its binary is reachable via `npx depcruise`.

### Todo List
1. Create root `package.json` with `name: "archpulse"`, `type: "module"`, npm workspaces pointing to `demo/packages/*`, and scripts for `build`, `lint`, `scan`, `cases`, `compare`, and `start` (MCP server).
2. Install production dependencies: `dependency-cruiser`, `@modelcontextprotocol/sdk` (MCP SDK for Node.js STDIO server).
3. Install dev dependencies: `typescript`, `@types/node`, `eslint`, `tsx` (for running TS directly during dev), `vitest` (test runner for demo packages).
4. Create `tsconfig.json` targeting ESNext modules, strict mode, output to `dist/`. Add a `tsconfig.base.json` that demo workspace packages extend.
5. Create `eslint.config.js` with recommended TypeScript rules.
6. Create the directory skeleton: `src/mcp/`, `src/cli/`, `src/core/`, `src/viewer/`, `demo/packages/`, `config/`, `artifacts/example/`, `bob_sessions/`.
7. Create a root `src/index.ts` stub and verify `tsc --noEmit` passes.
8. Add `.gitignore` excluding `node_modules/`, `dist/`, `.archpulse/`.
9. Commit as the baseline.

### Relevant Context
- Execution plan section 3 (stack table) and section 4 (repo layout).
- MCP SDK: `@modelcontextprotocol/sdk` — use the STDIO transport for local Bob IDE connection.
- `dependency-cruiser` CLI reference: https://github.com/sverweij/dependency-cruiser/blob/main/doc/cli.md
- **Owner:** All team members confirm the scaffold before branching. Owner A drives this sub-task.

---

## Sub-Task 2 — Demo Repository and Architecture Rules (Owner A)

**Status:** `[ ] pending`

### Intent
Seed a small but realistic multi-package JS/TS monorepo inside `demo/packages/` (npm workspace packages) with at least one deliberate circular dependency and one forbidden layer boundary violation. Establish the `config/architecture.json` contract and the `dependency-cruiser` configuration that enforces it. Confirm baseline tests pass before any Bob repair. This sub-task produces the frozen baseline all other owners depend on.

### Expected Outcomes
- `demo/` contains at least three packages/modules with realistic import relationships.
- At least one circular import cycle exists across two or more files.
- At least one layer boundary violation exists (e.g., `ui` importing from `db`).
- `config/architecture.json` declares layer names, path globs, and allowed dependency directions.
- `.dependency-cruiser.cjs` (or `.js`) enforces the declared rules.
- Running `npx depcruise --output-type json demo/src` produces a JSON file containing at least two rule violations.
- `demo/` has at least one test file (Jest or Vitest) that passes with `npm test` from the demo root.
- A baseline snapshot can be produced (prereq for Sub-Task 3).

### Todo List
1. Design the demo package layout as npm workspace packages: e.g., `demo/packages/ui/`, `demo/packages/domain/`, `demo/packages/db/`, `demo/packages/shared/`. Each package has its own `package.json` and is listed in the root npm workspace.
2. Write minimal source files that create a genuine circular cycle (e.g., `ui` → `domain` → `shared` → `ui`) and a forbidden boundary cross (`ui` directly imports `db`).
3. Write at least one Vitest test per violated module that passes (tests behavior, not the violation itself).
4. Create `config/architecture.json` with layer definitions, path globs for each workspace package, and allowed-direction policy.
5. Create `.dependency-cruiser.cjs` using `config/architecture.json` globs to define `forbidden` rules for the boundary and `no-circular` for cycles. Configure workspace package resolution so cross-package imports are resolved correctly.
6. Run `npx depcruise` and confirm violations appear in JSON output.
7. Record exact test command(s) in `config/architecture.json` under a `testCommands` field (e.g., `npm test --workspace demo/packages/domain`).
8. Commit demo as the frozen baseline (tag `baseline`). Owner D's repair will happen on a separate branch off this tag.

### Relevant Context
- Execution plan sections 2, 4 (config contract), 6 (CLI contract), and 11 (risk: scanner misses TS aliases).
- Keep TS path aliases minimal or absent in demo packages to avoid resolver issues with `dependency-cruiser`.
- Execution plan section 7: Owner A owns the demo baseline; Owner D's repair happens on a separate branch/worktree.
- **Owner:** A. Unblocks all other owners once the baseline tag is pushed.

---

## Sub-Task 3 — Scanner, Snapshot, and MCP Server Skeleton (Owner B)

**Status:** `[ ] pending`

### Intent
Implement the `scan_repository` MCP tool and the underlying `archpulse scan` CLI command. Produce a normalized `snapshot.json` that satisfies the snapshot contract. Expose the STDIO MCP server so Bob IDE can connect to it.

### Expected Outcomes
- `archpulse scan --repo demo --out .archpulse/before` produces `.archpulse/before/snapshot.json` and `.archpulse/before/graph.html`.
- `snapshot.json` contains `schemaVersion`, `root`, `gitMarker`, `scannerVersion`, `configHash`, `timestamp`, `modules`, `edges`, and `violations` fields.
- Violation IDs are stable across repeated scans of unchanged code.
- The MCP server starts via `node dist/mcp/server.js` (or `tsx src/mcp/server.ts`) and registers `scan_repository`, `get_case`, and `verify_case` tool names (stubs for get/verify are fine at this stage).
- Bob IDE connects to the server using the STDIO config in `.bob/mcp.json` and the `scan_repository` tool appears in the tool list.
- Tool output is compact (summary only); full JSON goes to the artifact file.

### Todo List
1. Implement `src/core/snapshot.ts`: normalize paths (repo-relative, slash-separated), compute config hash, build violation IDs.
2. Implement `src/cli/scan.ts`: invoke `dependency-cruiser --output-type json`, capture output even on nonzero exit (violations expected), parse, normalize, write `snapshot.json` and trigger graph export.
3. Implement graph export: invoke `dependency-cruiser --output-type dot-webpage` and save `graph.html` to the output directory.
4. Implement `src/mcp/server.ts`: create STDIO MCP server, register `scan_repository` tool that calls the scan core and returns a short summary JSON (case count, violation count, artifact paths).
5. Register `get_case` and `verify_case` as stub tools returning `{ status: "not_implemented" }`.
6. Create `.bob/mcp.json` with the STDIO launch command pointing to the built or tsx-run server.
7. Smoke-test: start server manually, confirm Bob IDE lists the three tools and `scan_repository` returns a real result.
8. Add `archpulse scan` to the CLI entry point in `src/cli/index.ts`.

### Relevant Context
- Execution plan sections 3 (scanner stack), 4 (snapshot contract), 6 (CLI contract).
- `dependency-cruiser` exits nonzero when violations are found — do not treat that as a fatal error.
- Bob MCP configuration: `.bob/mcp.json` local STDIO format per execution plan section 4 and Bob docs.
- Execution plan section 11 (risk: MCP connection fails — test by hour 8).
- **Owner:** B. Requires Sub-Task 1 complete and Sub-Task 2 frozen baseline tagged.

---

## Sub-Task 4 — Grouping and Case Packet Generation (Owner C)

**Status:** `[ ] pending`

### Intent
Convert normalized violations from `snapshot.json` into bounded, reviewable case groups and implement the `get_case` MCP tool and `archpulse cases` CLI command. Each case packet must give Bob exactly what it needs to investigate without loading the full repo.

### Expected Outcomes
- `archpulse cases --snapshot .archpulse/before/snapshot.json --out .archpulse/cases` writes at least one `case-001.md` and `case-001.json`.
- `case-001` covers the cycle or boundary violation seeded in the demo and lists ≤6 primary source files.
- `get_case({ caseId: "case-001" })` MCP tool returns the compact packet (not the full snapshot).
- Case IDs are stable across re-runs on the same snapshot.
- Groups are bounded: violations sharing a cycle, a common offending file, or a local connected component are merged; larger components are split with cross-links.

### Todo List
1. Implement `src/core/grouping.ts`: union violations by shared cycle membership or shared offending file; split components larger than six files; assign stable `case-<id>` identifiers.
2. Implement `src/core/casePacket.ts`: build `case-<id>.md` from the group (title, rule, from/to edges, cycle path if present, relevant source files, nearest test files, test commands from config, expected end condition).
3. Implement `src/cli/cases.ts`: load snapshot, run grouping, write all case markdown and JSON files to the output directory.
4. Wire `get_case` in the MCP server to load the named case JSON from the last scan's output directory and return it.
5. Add `archpulse cases` to the CLI entry point.
6. Validate: `get_case` response stays under ~2 KB; no megabyte JSON embedded.

### Relevant Context
- Execution plan sections 4 (case packet contract, grouping algorithm), 3 (data flow), 5 (Bob receives short packet).
- Case packet must include `scanId` (links back to baseline snapshot) and the stop condition Bob should verify.
- Sub-Task 3 must be complete and its snapshot schema confirmed before final wiring.
- **Owner:** C. Can begin implementing `grouping.ts` and `casePacket.ts` against the agreed snapshot schema (from Sub-Task 3) while B finalizes the MCP server.

---

## Sub-Task 5 — Verification and Compare (Owner E)

**Status:** `[ ] pending`

### Intent
Implement `verify_case` MCP tool and `archpulse compare` CLI command. The verifier runs the allowlisted test commands, reruns the scanner with the same config, and produces a machine-readable result distinguishing resolved, persistent, and newly introduced violations.

### Expected Outcomes
- `archpulse compare --before .archpulse/before/snapshot.json --after .archpulse/after/snapshot.json --case case-001 --out .archpulse/result` writes a `result.json` and a `result.md` summary.
- `result.json` contains: `caseId`, `baselineId`, `afterId`, `resolvedViolations`, `persistentViolations`, `newViolations`, `testCommand`, `testExitCode`, `testOutput` (truncated), `typecheckExitCode`, `status` (verified/partial/failed), `reason`.
- Comparison is rejected (status: `invalid`) when config hashes differ between snapshots.
- `verify_case({ caseId, baselineId })` MCP tool runs the test commands from the case packet, triggers a new scan, calls compare, and returns the result summary.
- Test commands are sourced only from the allowlist in `config/architecture.json` — no arbitrary shell strings accepted from the model.

### Todo List
1. Implement `src/core/compare.ts`: load two snapshots, verify config hash equality, compute resolved/persistent/new violation sets for the focused case neighborhood.
2. Implement test runner in `src/core/runner.ts`: accept only commands listed in `config/architecture.json testCommands`; execute, capture exit code and stdout/stderr (truncated to ~500 lines).
3. Implement typecheck runner: run `tsc --noEmit` in the demo root if a `tsconfig.json` is present; capture result.
4. Implement `src/cli/compare.ts` CLI command using the above.
5. Wire `verify_case` in the MCP server: call runner → scan → compare; return compact result summary.
6. Add `archpulse compare` to the CLI entry point.
7. Gate test: run baseline, corrupt one import manually, rerun — confirm `newViolations` appears; restore, rerun — confirm `resolvedViolations`.

### Relevant Context
- Execution plan sections 4 (compare contract), 6 (post-change gate, CLI contract), 11 (risk: cycle fixed by rule suppression).
- Execution plan section 3: `verify_case` must not accept arbitrary shell strings from the model.
- Config hash enforcement prevents comparing scans taken with different rule sets.
- **Owner:** E. Can implement `compare.ts` and `runner.ts` against the agreed snapshot schema before Sub-Task 3 is fully wired.

---

## Sub-Task 6 — Bob Skill and End-to-End Workflow (Owner D)

**Status:** `[ ] pending`

### Intent
Author the ArchPulse Bob skill and run the full Plan → review → Agent repair workflow on the demo repository using real Bob IDE sessions. Produce the Bob session evidence required by the submission checklist.

### Expected Outcomes
- `.bob/skills/archpulse/SKILL.md` exists with the frontmatter and instructions from execution plan section 5.
- A Plan-mode Bob session produces a specific multi-file refactor proposal for case-001 and stops for approval.
- After approval, an Agent-mode Bob session implements the approved plan (editing ≥2 files in `demo/`).
- Bob calls `verify_case`; tests pass and the target violation is absent from the result.
- Bob session screenshots are saved to `bob_sessions/`.

### Todo List
1. Create `.bob/skills/archpulse/SKILL.md` with the exact frontmatter (`name: archpulse`) and instructions from execution plan section 5.
2. Confirm Sub-Tasks 3–5 are all working (scan, get_case, verify_case return real results).
3. Run Plan-mode Bob task: "Use the ArchPulse skill. Call `scan_repository`, then `get_case` for case-001. Investigate listed files. Propose a minimal multi-file refactor. Do not edit until I approve."
4. Review Bob's proposed plan; record it in the case packet or a task note.
5. Run Agent-mode Bob task with the approved plan: "Implement the approved plan. Call `verify_case`. Report results."
6. Confirm `verify_case` returns `status: verified` and no new high-severity violations.
7. Save Bob IDE task session screenshots to `bob_sessions/plan-task.png` and `bob_sessions/agent-task.png`.
8. If tests fail, investigate within the same task and re-run verification before closing.

### Relevant Context
- Execution plan sections 5 (skill content, human checkpoint), 9 (BobCoin budget — use CLI for debug scans), 12 (exact prompts to use).
- Execution plan section 7: Owner D's repair happens on a dedicated demo branch branched from the `baseline` tag.
- The skill file location (`.bob/skills/archpulse/SKILL.md`) must be in the Bob workspace that has `.bob/mcp.json`.
- **Owner:** D. Requires Sub-Tasks 3, 4, and 5 all working. Each team member captures their own Bob session screenshots.

---

## Sub-Task 7 — Results Viewer and Demo Artifacts (Owner F)

**Status:** `[ ] pending`

### Intent
Build or assemble the results view showing the before/after focused graph, resolved/new/persistent violations, and source diff. Populate `artifacts/example/` with sanitized before/after artifacts that do not depend on ephemeral local files.

### Expected Outcomes
- Opening the results view (HTML page or simple React/Vite app) shows case-001's original violation count, after-repair count, resolved violations, and a focused before/after graph.
- `artifacts/example/` contains `snapshot-before.json`, `snapshot-after.json`, `case-001.json`, and `result.json` (small, sanitized, committed).
- The viewer reads from artifact files (not live tool calls) so it works after the demo session ends.
- Fallback: if the React viewer is not ready, `dot-webpage` graph HTML + `result.md` Markdown report suffice (per execution plan cut rule, section 8).

### Todo List
1. Copy verified snapshot and result artifacts into `artifacts/example/` and sanitize any absolute paths.
2. Decide viewer approach: static `src/viewer/index.html` reading embedded JSON, or Vite + React app in `src/viewer/`.
3. Build the before/after violation diff panel: list resolved violations in green, new in red, persistent in yellow.
4. Embed or link the focused `graph.html` from `dot-webpage` (reuse dependency-cruiser output; no custom layout engine).
5. Add a source diff section linking to the `git diff` output saved as a text artifact.
6. Add a one-line `npm run viewer` script (or document how to open the HTML file directly).
7. Verify the viewer works on a fresh clone using only the committed example artifacts.

### Relevant Context
- Execution plan sections 3 (viewer stack: Vite + React or static HTML), 4 (artifacts/example layout), 8 (cut rule: fall back to dot-webpage if viewer delays Gate 2), 10 (demo evidence requirements).
- Viewer must not require a running MCP server or live scan at demo time.
- **Owner:** F. Can begin building the viewer UI against fixture JSON from `artifacts/example/` while Sub-Tasks 5–6 finalize the exact result schema. If the React viewer is not ready before Gate 2, fall back immediately to `dot-webpage` + `result.md`.

---

## Sub-Task 8 — README, Installation Script, and Submission Checklist

**Status:** `[ ] pending`

### Intent
Write the README, provide an installation script that merges ArchPulse config into a user's `.bob/` without destroying existing settings, and verify the submission checklist from execution plan section 10 is fully satisfied.

### Expected Outcomes
- `README.md` explains one-command setup, one command per major stage (scan, cases, compare), and how to open the viewer.
- An install script (or documented manual steps) adds `.bob/mcp.json` entry and places the skill file without deleting existing Bob config.
- A trial run on a fresh clone or clean worktree completes end-to-end without extra setup steps.
- All items in the execution plan section 10 submission checklist are checked off.

### Todo List
1. Write `README.md`: prerequisites, install steps, `archpulse scan / cases / compare` commands, viewer launch, and screenshot of the before/after result.
2. Write `scripts/install-bob-addon.js` (or shell script): create/merge `.bob/mcp.json` entry and copy skill file; print instructions.
3. Verify `bob_sessions/` contains at least the plan-task and agent-task screenshots from Sub-Task 6.
4. Verify `artifacts/example/` contains the four required artifact files from Sub-Task 7.
5. Do a final trial run on a fresh clone: install, scan, cases, Bob Plan task, approve, Bob Agent task, verify, viewer — confirm no missing steps.
6. Check every item in the execution plan section 10 submission checklist; note any gap.

### Relevant Context
- Execution plan sections 4 (installation note), 10 (submission checklist), 13 (definition of done).
- The install script must create-or-merge, never overwrite, existing Bob settings.
- **Owner:** A (README, install script) + F (screenshots, viewer docs). Final trial run requires a clean clone on a supported environment with a locked Node version.
