# ArchPulse

> Ask Bob to scan a repository, repair one architectural violation with your approval, and prove the result with tests and a before/after architecture diff.

ArchPulse is a Bob IDE add-on built for the **IBM Bob 2.0 Hackathon**. It gives Bob three local MCP tools backed by `dependency-cruiser`, plus a skill that guides a guided repair workflow: scan → investigate → propose → approve → fix → verify.

---

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

## Install the Bob add-on

Run the installer from the ArchPulse directory, pointing it at the workspace you want to use with Bob IDE:

```bash
# Install into the current directory
npm run install:addon

# Install into a different project
node scripts/install-bob-addon.js /path/to/your-project
```

The installer:
- Adds the `archpulse` MCP server entry to `.bob/mcp.json` — **without touching any other servers**
- Copies the ArchPulse skill to `.bob/skills/archpulse/SKILL.md`

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

Runs all 26 tests across `src/` and `demo/packages/`.

### Scan the demo repository

```bash
npm run scan -- --repo demo/packages --out .archpulse/before
```

Produces:
- `.archpulse/before/snapshot.json` — normalized violation snapshot
- `.archpulse/before/graph.html` — interactive dependency graph

### Generate case packets

```bash
npm run cases -- --snapshot .archpulse/before/snapshot.json --out .archpulse/cases
```

Produces `case-001.md` and `case-001.json` — the bounded packet Bob investigates.

### Compare before and after

```bash
npm run compare -- \
  --before .archpulse/before/snapshot.json \
  --after  .archpulse/after/snapshot.json \
  --case   case-001 \
  --out    .archpulse/result
```

Produces `result.json` and `result.md` — resolved, persistent, and new violations plus test results.

### Start the MCP server manually (for debugging)

```bash
npm start
```

---

## Bob IDE workflow

Once the add-on is installed and the tools appear in Bob:

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
│   ├── cli/                   # scan / cases / compare CLI commands
│   └── viewer/                # Vite + React results viewer
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
- **`case-<id>.json`** — produced by `get_case` / `npm run cases`
- **`result.json`** — produced by `verify_case` / `npm run compare`

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
