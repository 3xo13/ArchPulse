# ArchPulse

> Ask Bob to scan a repository, repair one architectural violation with your approval, and prove the result with tests and a before/after architecture diff.

ArchPulse is a Bob IDE add-on built for the **IBM Bob 2.0 Hackathon**. It gives Bob three local MCP tools backed by `dependency-cruiser`, plus a skill for the planned repair workflow: scan → investigate → propose → approve → fix → verify.

---

## Current implementation

Scanning, offline graph generation, comparison helpers, and the allowlisted test runner are implemented. `get_case`, `verify_case`, and the `cases`/`compare` CLI commands remain explicit stubs on this branch. Case generation, verification orchestration, and the results viewer are pending integration.

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

Produces:
- `.archpulse/before/snapshot.json` — normalized violation snapshot
- `.archpulse/before/graph.html` — interactive dependency graph

`--repo` is the repository root; `--scope` selects files within it. Unresolved imports are reported as incomplete coverage in both CLI and MCP summaries. Open `graph.html` locally for hover highlighting, right-click pinning, and Escape to clear.

### Comparison and runner helpers

`compareSnapshots(beforePath, afterPath, casePacket)` compares architecture only. It rejects incompatible scopes/configurations, incomplete resolution, empty cases, and missing baseline IDs. Any new violation blocks success, including warnings and info. A `verified` comparison does not assert tests or typechecking passed. Rescan older snapshots with absolute `root` fields before comparing.

`runTestCommand(index, repoRoot?)` executes only commands indexed in the workspace allowlist. Quoted arguments are preserved without shell expansion. npm/npx are launched through Node; npx runs offline with automatic package installation disabled. Install workspace test dependencies first. Captured output is bounded to 500 lines or 256 KiB.

The `cases` and `compare` CLI commands remain unimplemented; they do not currently produce case packets or result reports.

### Start the MCP server manually (for debugging)

```bash
npm start
```

---

## Bob IDE workflow

The following workflow is planned and requires case generation and verification integration. Currently Bob can call `scan_repository`; `get_case` and `verify_case` return explicit errors.

**Step 1 — Plan mode** (investigation, no edits yet):
> Use the ArchPulse skill. Call `scan_repository` for this workspace, then `get_case` for case-001. Inspect only the listed source files. Explain the cause and propose a minimal multi-file refactor. Do not edit source until I approve the plan.

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
│   ├── cli/                   # Working scan; cases/compare stubs
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
- **`case-<id>.json`** — planned case-generation output
- **`result.json`** — planned verification output

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
