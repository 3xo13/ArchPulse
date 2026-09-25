# ArchPulse — Team Roles

**Event:** IBM Bob 2.0 Hackathon · **Timebox:** 48 hours  
**Baseline tag:** `baseline` · **Integration branch:** `main`

Each owner works on their own feature branch and rebases into `main` frequently.  
Use the CLI (`npm run scan`, `npm run cases`, `npm run compare`) for debug work to preserve BobCoin budget.  
Capture Bob IDE task session screenshots in `bob_sessions/` — every owner is responsible for their own evidence.

---

## Owner A — Integration Lead

**Team member:** Kareem

**Mission:** Select and maintain the demo repo baseline, define and freeze contracts, own add-on installation, drive integration, and ensure one reproducible end-to-end workflow runs in Bob IDE.

**Branch:** `main` (integration owner — reviews and merges all feature branches)

**Owns:**
- `demo/` baseline (frozen at `baseline` tag)
- `config/architecture.json` and `.dependency-cruiser.cjs`
- `SCHEMA.md` shared contract
- `.bob/mcp.json` and add-on installation script (`scripts/install-bob-addon.js`)
- `README.md`
- Final trial run on a clean clone before submission

**First handoff:** Frozen demo layout + base test commands + first Bob IDE MCP smoke test  
**Done when:** Bob IDE connects to the add-on and one reproducible workflow completes end-to-end

---

## Owner B — Scanner + MCP Server

**Team member:** Sandra

**Mission:** Configure `dependency-cruiser`, implement JSON normalization and graph export, and build the minimal STDIO MCP server that exposes all three tools to Bob IDE.

**Branch:** `feature/scanner-mcp`

**Owns:**
- `src/core/snapshot.ts` — path normalization, config hash, violation IDs
- `src/cli/scan.ts` — invokes `depcruise`, captures output, writes `snapshot.json` + `graph.html`
- `src/cli/index.ts` — CLI entry point (`scan` command)
- `src/mcp/server.ts` — STDIO MCP server; registers `scan_repository`, `get_case` stub, `verify_case` stub

**First handoff:** Bob IDE calls `scan_repository` and receives a real bounded result  
**Done when:** Same-scope scans are comparable (stable violation IDs); tool output stays compact

**Key constraint:** `dependency-cruiser` exits nonzero on violations — treat that as expected, not fatal. Full graph goes to artifacts; Bob only receives a short summary.

---

## Owner C — Grouping + Case Packets

**Team member:** Zainn

**Mission:** Convert normalized violations from `snapshot.json` into bounded, reviewable case groups and implement `get_case`.

**Branch:** `feature/grouping-cases`

**Owns:**
- `src/core/grouping.ts` — union violations by shared cycle/file; split components > 6 files; stable `case-<id>` IDs
- `src/core/casePacket.ts` — builds `case-<id>.md` and `case-<id>.json` from a group
- `src/cli/cases.ts` — CLI entry point (`cases` command)
- Wires `get_case` in the MCP server (coordinate with B)

**Can start:** Immediately against `artifacts/example/snapshot-before.json` and `SCHEMA.md` — no need to wait for B's scanner to be fully wired.

**First handoff:** `get_case` returns `case-001` from B's snapshot  
**Done when:** Packet includes evidence, files, relevant tests, and stop condition; response stays under ~2 KB

---

## Owner D — Bob Workflow + Repair

**Team member:** Mrenika

**Mission:** Author the ArchPulse Bob skill and run the full Plan → review → Agent repair workflow on the demo repo using real Bob IDE sessions.

**Branch:** `feature/repair` (branched off `baseline` tag — do **not** merge back into `main` until verified)

**Owns:**
- `.bob/skills/archpulse/SKILL.md` (already created — review and refine)
- Plan-mode Bob session: investigate case-001, produce a specific multi-file refactor plan
- Agent-mode Bob session: implement the approved plan, call `verify_case`, record results
- `bob_sessions/plan-task.png` and `bob_sessions/agent-task.png`

**Requires:** Sub-Tasks 3 (B), 4 (C), and 5 (E) all returning real results before running the repair.

**First handoff:** Recorded approved plan + real code diff  
**Done when:** Bob changes ≥2 files while preserving all expected test behavior

**Key note:** Use `npm run scan` / `npm run cases` via CLI for debug work. Save BobCoins for the actual Plan and Agent demo tasks.

---

## Owner E — Verifier + Compare

**Team member:** Rishabh

**Mission:** Implement `verify_case` MCP tool and `archpulse compare` CLI. The verifier runs allowlisted tests, reruns the scanner with identical config, and produces a machine-readable resolved/persistent/new violation diff.

**Branch:** `feature/verifier`

**Owns:**
- `src/core/compare.ts` — loads two snapshots, checks config hash equality, computes violation diff
- `src/core/runner.ts` — executes only commands from `config/architecture.json testCommands`; captures exit code + truncated output
- `src/cli/compare.ts` — CLI entry point (`compare` command)
- Wires `verify_case` in the MCP server (coordinate with B)

**Can start:** Immediately against `artifacts/example/snapshot-before.json`, `artifacts/example/snapshot-after.json`, and `SCHEMA.md`.

**First handoff:** `compare` result contract + regression test (corrupt import → new violation appears; restore → resolved violation appears)  
**Done when:** Result accurately reports resolved/persistent/new violations and real test exit status

**Key constraint:** `verify_case` must never accept arbitrary shell strings from the model. All commands come from the allowlist in `config/architecture.json`.

---

## Owner F — Results Viewer + Demo

**Team member:** Sumair

**Mission:** Build the Vite + React results viewer (or static HTML fallback), populate `artifacts/example/` with final sanitized artifacts, and assemble the video, README screenshots, and submission materials.

**Branch:** `feature/viewer`

**Owns:**
- `src/viewer/` — Vite + React app showing case list, before/after violation diff, focused graph, source diff link
- `artifacts/example/` — final committed fixture files (sanitized, no absolute paths)
- Demo video recording
- Submission description

**Can start:** Immediately against `artifacts/example/` fixture files — no live MCP server needed.

**Fallback rule (hard):** If the React viewer is not ready before Gate 2 (hour 28), drop it immediately and switch to `dependency-cruiser dot-webpage` HTML + `result.md` Markdown report. The core add-on takes priority over the viewer.

**First handoff:** Screen displaying sample before-case + post-result  
**Done when:** Judges can understand the verified change within 60 seconds from the viewer alone

---

## Integration Gates

| Gate | Hour | Condition | Owner |
|---|---|---|---|
| Gate 1 | 8–12 | Bob IDE calls `scan_repository` + `get_case`; real `case-001` and graph show violation | A integrates; B + C register tools |
| Gate 2 | 20–28 | Bob IDE calls `verify_case`; tests pass and same-config re-scan proves selected violation gone without a new serious violation | E + D fix regressions; A merges working MVP |
| Freeze | 36–40 | Working code frozen; demo rehearsal recorded; README and screenshots complete | A + F lead |
| Submit | 40–48 | Video, evidence, submission fields complete | A submits; F owns pitch |

**Cut rule:** If Gate 2 slips past hour 28, stop adding features. Focus on one verified case and present any limitation honestly.

---

## Branch Strategy

```
main                  ← integration (Kareem owns merges)
  └─ feature/scanner-mcp      (Sandra — B)
  └─ feature/grouping-cases   (Zainn — C)
  └─ feature/verifier         (Rishabh — E)
  └─ feature/viewer           (Sumair — F)

baseline tag ──────── feature/repair   (Mrenika — D, repair branch, no merge to main until verified)
```

Rebase frequently. B exposes the three MCP tool names immediately so C and E can wire their handlers independently.
