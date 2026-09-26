# ArchPulse

> Ask Bob to scan a repository, repair one architectural violation with your approval, and prove the result with tests and a before/after architecture diff.

ArchPulse is a Bob IDE add-on built for the **IBM Bob 2.0 Hackathon**. It gives Bob three local MCP tools backed by `dependency-cruiser`, plus a skill for the repair workflow: scan → investigate → propose → approve → fix → verify.

---

## Current implementation

Scanning, immutable baselines, case generation, architecture comparison, and full verification are implemented through the CLI and MCP. Verification runs every configured test and typecheck before reporting success. The results viewer and recorded demo workflow remain separate workstreams.

## Prerequisites

| Requirement | Version |
|---|---|
| Node.js | ≥ 20 |
| npm | ≥ 10 |
| Bob IDE | latest |

Clone the repository and install dependencies:

```bash
git clone https://github.com/3xo13/ArchPulse.git
cd ArchPulse
npm install
```

---

Dependency installation does not write Bob configuration. Graph rendering uses bundled WASM and needs no system Graphviz or network connection. On Windows PowerShell, use `npm.cmd` if execution policy blocks `npm.ps1`.

## Install the Bob add-on

Run the installer from the ArchPulse directory, pointing it at the workspace you want to use with Bob IDE:

```bash
# Install into the ArchPulse directory
npm run install:addon

# Install into a different project
node scripts/install-bob-addon.js /path/to/your-project
```

The installer:
- Adds the `archpulse` MCP server entry to `.bob/mcp.json` — **without touching any other servers**
- Copies the ArchPulse skill to `.bob/skills/archpulse/SKILL.md`

For another workspace, provide its own `.dependency-cruiser.cjs` and optional `config/architecture.json`; the installer does not create architecture rules. ArchPulse dependencies, including `tsx`, must remain installed. Self-install assumes Bob launches from the project root and expands `${workspaceFolder}`; an unexpanded root produces a configuration error.

After running, **reload Bob IDE** (or restart the window). Confirm the three ArchPulse tools appear in Bob's MCP tool list before continuing.

---

## Demo repository

The `demo/` directory contains a small npm-workspace monorepo (`shared`, `domain`, `db`, `ui`) with two seeded architectural violations:

| Violation | Rule | Description |
|---|---|---|
| `shared` → `domain` | `shared-no-domain` | A foundational package must not depend on a higher-level layer |
| `ui` → `db` | `ui-no-db` | The UI layer must not import the data-access layer directly |

Architecture rules are declared in [`config/architecture.json`](config/architecture.json) and enforced by [`.dependency-cruiser.cjs`](.dependency-cruiser.cjs).

---

## Commands

### Run tests

```bash
npm test
```

Runs regression and demo tests across `src/` and `demo/packages/`.

### Scan the demo repository

```bash
npm run scan -- --repo . --scope demo/packages --out .archpulse/before
```

Prints an immutable `Baseline: .archpulse/scans/<id>/snapshot.json` path to retain for later verification. Also produces:
- `.archpulse/before/snapshot.json` — normalized violation snapshot
- `.archpulse/before/graph.html` — interactive dependency graph

`--repo` is the repository root; `--scope` selects files within it. Unresolved imports are reported as incomplete coverage in both CLI and MCP summaries. Open `graph.html` locally for hover highlighting, right-click pinning, and Escape to clear.

### Comparison and runner helpers

`compareSnapshots(beforePath, afterPath, casePacket)` compares architecture only. It rejects incompatible scopes/configurations, incomplete resolution, empty cases, and missing baseline IDs. Any new violation blocks success, including warnings and info. A `verified` comparison does not assert tests or typechecking passed. Rescan older snapshots with absolute `root` fields before comparing.

`runTestCommand(index, repoRoot?)` executes only commands indexed in the workspace allowlist. Quoted arguments are preserved without shell expansion. npm/npx are launched through Node; npx runs offline with automatic package installation disabled; allowlisted npx commands must not override installation/offline flags. Install workspace test dependencies first. Captured output is bounded to 500 lines or 256 KiB.

### Generate cases and verify a repair

Use the immutable baseline path printed by the scan, and choose a case from the returned index:

```bash
npm run cases -- --snapshot .archpulse/scans/<id>/snapshot.json
npm run verify -- --before .archpulse/scans/<id>/snapshot.json --case case-001 --out .archpulse/result
```

`verify` runs **all** `testCommands` and `typecheckCommands` from `config/architecture.json`, then rescans with the baseline's config and scope. Both allowlists must be nonempty. This repository checks all four demo packages, including shared, and typechecks the application and every demo package. External projects must configure their own checks; the installer does not invent them.

Inspect `.archpulse/result/result.json` and `result.md`. A `verified` result requires passing checks, every selected violation resolved, and no newly introduced violations of any severity. Unrelated baseline violations remain visible in the report. Missing configuration or unusable scan evidence produces `invalid`; failures, timeouts, and cancellation never produce success. Numeric check code `-1` means checks could not run or were incomplete.

For architecture-only comparison of two saved snapshots:

```bash
npm run compare -- --before .archpulse/scans/<before-id>/snapshot.json --after .archpulse/scans/<after-id>/snapshot.json --case case-001 --out .archpulse/comparison
```

This writes `comparison.json`, not `result.json`, and does not run tests or typechecking. Legacy fixture pairs remain usable when their case packet is beside the baseline (or in its `cases/` directory). Full verification requires a newly captured baseline with provenance.

Case IDs remain stable for unchanged groups within a repository. Do not assume the example fixture's case numbering matches a fresh repository. Immutable scan generations keep their own case packets; the latest-scan pointer does not change an earlier baseline. Regenerating a mutable case directory removes obsolete owned packets while preserving unrelated files.

Commands default to a 120-second timeout; verification has a ten-minute execution deadline. Ctrl+C cancels CLI work. CLI exit codes are 0 for success, 1 for failed/partial outcomes, and 2 for invalid input or infrastructure failures. MCP summaries are limited to 2 KiB and link to complete artifacts.

### Start the MCP server manually (for debugging)

```bash
npm start
```

---

## Bob IDE workflow

Call `scan_repository` and save its immutable baseline ID. `get_case` accepts that baseline ID (or defaults to the latest scan); `verify_case` requires it. All three tools accept an optional `workspacePath` within the trusted workspace. MCP artifacts stay within the selected repository. Only the CLI accepts explicit external output directories.

**Step 1 — Plan mode** (investigation, no edits yet):
> Use the ArchPulse skill. Call `scan_repository` for this workspace, then `get_case` for a case from the returned index, using the saved baseline ID. Inspect only the listed source files. Explain the cause and propose a minimal multi-file refactor. Do not edit source until I approve the plan.

**Step 2 — Review and approve** the proposed plan.

**Step 3 — Agent mode** (implementation):
> Implement the approved plan for case-001. Call `verify_case` with the case ID and baseline ID. Summarize changed files, test results, and resolved violations.

---

## Project structure

```
archpulse/
├── src/
│   ├── mcp/server.ts          # STDIO MCP server — 3 Bob-callable tools
│   ├── core/snapshot.ts       # Path normalization, config hash, violation IDs
│   ├── cli/                   # Scan, cases, compare, and verify commands
│   └── core/                  # Comparison, runner, validation, artifact utilities
├── demo/packages/             # npm workspace demo repo with seeded violations
│   ├── shared/                # Value objects — no layer deps
│   ├── domain/                # Business logic → shared only
│   ├── db/                    # Data access → shared + domain types
│   └── ui/                    # Presentation → domain + shared only (violation: imports db)
├── config/architecture.json   # Layer definitions and allowed dependency directions
├── .dependency-cruiser.cjs    # Scanner rules
├── artifacts/example/         # Committed before/after fixtures for the viewer
├── bob_sessions/              # Bob IDE task session screenshots (required for submission)
├── scripts/
│   └── install-bob-addon.js   # Merge-safe Bob add-on installer
├── SCHEMA.md                  # Agreed snapshot / case / result data contracts
└── TEAM.md                    # Team roles and branch strategy
```

---

## Shared data contracts

All tool outputs follow the schemas in [`SCHEMA.md`](SCHEMA.md):

- **`snapshot.json`** — produced by `scan_repository` / `npm run scan`
- **`case-<id>.json`** — generated case packets
- **`result.json`** — full verification output

Example fixtures committed in [`artifacts/example/`](artifacts/example/).

---

## Team

| Owner | Name | Workstream |
|---|---|---|
| A | Kareem | Integration lead, demo baseline, install, README |
| B | Sandra | Scanner + MCP server (`scan_repository`) |
| C | Zainn | Grouping + case packets (`get_case`) |
| D | Mrenika | Bob skill + repair workflow |
| E | Rishabh | Verifier + compare (`verify_case`) |
| F | Sumair | Results viewer + demo video |

See [`TEAM.md`](TEAM.md) for branch names, handoff gates, and BobCoin budget notes.

---

## Submission checklist

- [ ] Working Bob add-on: local MCP server, skill, sample code, architecture rules, repeatable install
- [ ] This README with screenshots and one command per major stage
- [ ] Bob IDE visibly responsible for investigation, plan, and code changes in the demo
- [ ] `bob_sessions/` — Bob IDE task session screenshots
- [ ] `artifacts/example/` — before/after snapshots and compare report
- [ ] Demo video and submission description match observable behaviour
- [ ] Final trial run on a fresh clone before freeze

---

## License

MIT
