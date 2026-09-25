# ArchPulse — build and demo plan

**Team:** six developers · **Event:** IBM Bob 2.0 Hackathon, September 25–27, 2026 · **Timebox:** 48 hours  
**Status:** proposed implementation plan for the team and as an instruction reference for Bob IDE  
**Product form:** an installable Bob add-on comprising a local MCP server, a Bob skill, and a small results viewer.  
**One-line pitch:** Ask Bob to scan a repository, repair one architectural violation with your approval, and prove the result with tests and a before/after architecture diff.

## 1. Decision and scope

Build **one end-to-end Bob add-on** for JavaScript/TypeScript repositories, demonstrated on a small multi-package monorepo with working tests. The add-on gives Bob local MCP tools backed by an existing dependency scanner, plus a skill that guides its repair workflow. From Bob IDE, a developer asks ArchPulse to scan the current project. The MCP tool scans the whole relevant codebase, groups related violations, and returns a short case list. Bob investigates one case, writes a plan, pauses for a human decision, changes the code, then uses the add-on to rerun tests and the scanner. Show exactly which violations disappeared and whether any new ones appeared.

**MVP behaviors:**

1. User installs the ArchPulse add-on in Bob IDE (project-local configuration for the demo; document global installation for reuse across projects) and asks Bob to scan the active project.
2. Bob calls the add-on's `scan_repository` MCP tool. The tool saves a full dependency snapshot and returns a **small summary** of concrete violations, initially circular imports and one explicitly configured layer/package boundary rule.
3. Bob calls `get_case` for a selected related group. The tool returns a compact case packet with file paths, violating dependency edges, rule explanations, and bounded neighborhood links.
4. Bob inspects relevant code, explains the cause, proposes a specific multi-file refactor, and waits for approval before editing.
5. After approval Bob edits code, then calls `verify_case` to run configured tests/typecheck, rerun the scanner, and compare snapshots.
6. The results view shows original and current violation counts, resolved/new/persistent violations, a focused before/after graph, and the source diff.

**Must demonstrate:** the add-on is callable as tools from Bob IDE, one meaningful repair involving at least two files, one review/approval checkpoint, passing relevant tests, and a genuine resolved dependency violation. **Nice to have:** a second case, CI command, richer interactive graph, custom Bob mode, or a one-step installer. Build these only after the full MVP works.

**Explicit exclusions for the 48-hour build:** all-language parsing, arbitrary repository upload, automated claims that every architectural decision is correct, custom dependency parser, homegrown graph layout engine, generic 0–100 architecture-health scores, and three sequential steps disguised as parallel agents. No Python/FastAPI backend or separate VS Code extension for the MVP.

### Why this fits the hackathon

The official guide calls for a working prototype that improves a specific developer workflow; Bob IDE must be central, while other tools are allowed. Scan and verification use deterministic tools; Bob provides the architectural judgment and multi-file implementation. Keep Bob IDE session-summary screenshots from relevant tasks in `bob_sessions/` of the submitted code repository. IBM lists Bob Shell as optional. See [the participant guide](https://lablab-ibm-bob-2-hackathon-guide.s3.us.cloud-object-storage.appdomain.cloud/index.html).

## 2. Product experience and demo story

**User journey inside Bob IDE:** “ArchPulse, scan this project” → Bob calls `scan_repository` and shows grouped violations → “Investigate case 1” → Bob calls `get_case` → Bob proposes a specific plan → developer approves → Bob refactors → Bob calls `verify_case` → developer sees the exact edge/cycle removed without introducing a new rule violation.

The compelling part is **guided, verifiable repair**, not displaying a dependency graph by itself. For a 2–3 minute demo use one real architecture smell that requires understanding how code in several files relates. A cycle caused by a shared type or utility being imported from a high-level package is a good example: Bob can move the shared contract to a lower-level location, update its importers, and preserve behavior. The plan must be specific to the real code, not a hard-coded demo solution.

For the architecture diff show the focused group only. Before: red offending edge and the cycle or forbidden boundary. After: edge removed or correctly redirected; note any new edge. Add the actual passing test/typecheck result. A smaller graph alone does not prove better architecture.

## 3. Architecture and chosen stack

| Concern | Chosen MVP implementation | Deliverable |
| --- | --- | --- |
| Static scanning | `dependency-cruiser` for JS/TS imports, circular rules, and configurable boundary rules | JSON snapshot and violations |
| Bob tool integration | Local Node.js MCP server wrapping scan, case lookup, and verification | Bob calls `scan_repository`, `get_case`, `verify_case` |
| Dependency graph | Reuse dependency-cruiser JSON and `dot-webpage`/Graphviz output | Graph HTML; no custom layout |
| Case grouping | Small TypeScript script over the scan JSON | Grouped case packets and stable IDs |
| Bob workflow | Project-local `.bob/skills/archpulse/SKILL.md`, invoked in **Bob IDE** | Investigate → plan → approval → edit workflow |
| Verification | Existing repository tests, TS typecheck if present, re-scan with the same config | Machine-readable pass/fail and diff |
| Results UI | Simple Vite + React + TypeScript page reading artifacts, or a static HTML view if faster | Case list, focused before/after, diff links |
| Team delivery | GitHub repository, README, recorded demo, `bob_sessions/` screenshots | Reproducible submission |

`dependency-cruiser` already supports circular rules, JSON output, and Graphviz-backed `dot-webpage` HTML with hover/click interaction. Use its existing reporters before adopting Cytoscape.js. If the selected repo already uses Nx, its project graph and module-boundary tooling are alternatives; choose **one** scanner on day one and standardize its output. [Dependency-cruiser CLI](https://github.com/sverweij/dependency-cruiser/blob/main/doc/cli.md), [rule reference](https://github.com/sverweij/dependency-cruiser/blob/main/doc/rules-reference.md).

**Integration boundary:** Bob IDE connects to the ArchPulse local MCP server and loads the ArchPulse skill. The scanner runs locally in the developer's active workspace; no direct programmatic API to the Bob chat session is assumed. Install the server and skill project-locally for the demo and document the global configuration for use across projects. IBM documents project-level and global MCP configuration, project-level and global skills, and local STDIO MCP servers. This is a **Bob add-on**, though it is not a VS Code marketplace extension or a promised one-click install. If the team later confirms Bob Shell in the hackathon environment, `bob run` can be a stretch entry point; the demo still uses required Bob IDE. [Bob MCP configuration](https://bob.ibm.com/docs/ide/configuration/mcp/mcp-in-bob), [Bob skill format](https://bob.ibm.com/docs/ide/features/skills), [local MCP transport](https://bob.ibm.com/docs/ide/configuration/mcp/server-transports).

**Three MCP tools, no more for the MVP:**

- `scan_repository({ workspacePath? })` runs the bounded scanner, saves JSON/graph artifacts, and returns a short summary with case IDs and artifact paths. Default to the trusted open workspace; reject paths outside the configured root.
- `get_case({ caseId })` returns only the bounded case packet and paths to relevant source/tests; Bob reads selected files itself to make the architectural decision.
- `verify_case({ caseId, baselineId })` runs **configured allowlisted** test/typecheck commands, a same-config re-scan, and comparison; returns statuses, resolved/new violations, and graph/diff artifact paths. Do not accept arbitrary shell strings from the model as test commands.

MCP tool outputs should stay compact. Save the full graph and logs to files so Bob's context contains a useful summary rather than the entire repo. The scanner's core functions remain callable from a CLI for debugging and CI; Bob uses the MCP tools in the actual demo.

### Data flow

```text
Bob IDE (skill) → local MCP add-on
               ↓
Sample repository + architecture rules
               ↓
  dependency-cruiser via scan_repository
               ↓
       JSON snapshot + case IDs
               ↓
      get_case → bounded packet
               ↓
     Bob investigation and plan
               ↓
       Human approval checkpoint
               ↓
          Bob edits source
               ↓
verify_case: tests + same-config re-scan
               ↓
    Graph diff + verified case result
```

The phases depend on each other. Multiple independent cases may later be investigated concurrently, but a particular case cannot be verified until its change exists.

## 4. Repo layout and data contracts

Suggested build repository layout (adapt to the demo repo):

```text
archpulse/
├── README.md
├── ARCHPULSE_EXECUTION_PLAN.md
├── package.json                # scanner + local MCP server + CLI
├── .bob/skills/archpulse/SKILL.md
├── src/
│   ├── mcp/                   # Bob-callable scan/get_case/verify tools
│   ├── cli/                   # shared commands for debugging and CI
│   ├── core/                  # normalize paths, case IDs, grouping, diff
│   └── viewer/                # optional React view
├── demo/                      # owned or permitted sample repository
├── config/architecture.json   # declared layers, commands, and scan scope
├── artifacts/example/         # small sanitized before/after artifacts
└── bob_sessions/              # required Bob IDE task summaries
```

Keep generated full-repo artifacts in a local `.archpulse/` directory ignored by git. Commit a small representative example in `artifacts/example/` for reviewers. No client or private code.

For the demo, configure `.bob/mcp.json` in the Bob workspace to start the built local ArchPulse MCP server with STDIO; place the skill in that workspace's `.bob/skills/archpulse/` (or use their documented global locations for multi-project reuse). If the demo repository and add-on have separate roots, provide a short installation script that creates **or merges** the required configuration without deleting the user's existing Bob settings. Verify the installed `scan_repository` tool appears and returns a real result inside Bob IDE before building the viewer. Once stable, validate installing the same add-on in a second tiny workspace; this proves the add-on is reusable rather than coupled to the demo repository.

### Snapshot contract

Produce one normalized `snapshot.json` per scan with:

- `schemaVersion`, repository-relative root, Git commit/working-tree marker, scanner version, timestamp, and **hash of the scanner configuration**;
- modules `{ path, package, layer? }` and edges `{ from, to, dependencyType? }` for the scanned source;
- violations `{ id, rule, from, to, severity, cyclePath?, evidence? }`;
- scanner warnings and incomplete-resolution counts.

Use repository-relative, slash-normalized paths. Make a violation ID from rule + normalized offending edge (for a cycle, also save the whole reported cycle). A cycle may be represented by several edges; preserve raw scanner evidence and avoid claiming an exact one-to-one match if the tool reports it differently across scans. Do not rely on source line numbers when the scanner cannot provide them. Build a concise user-facing reference to the files and rules instead.

### Config contract

Create a short `config/architecture.json` describing path-to-layer mapping and **allowed dependency directions** for the chosen sample repo. Enforce the rules in dependency-cruiser configuration; this JSON can drive UI labels. Example policies: UI cannot import `db`; `domain` cannot import `infrastructure`. The sample repo’s actual structure decides the real globs. Keep architecture rules under version control and do not weaken them merely to make the demo pass.

### Case packet contract

`case-<id>.md` should contain: title, exact rule and offending source/target, why the configured rule forbids it, any reported cycle path, 2–6 most relevant files, nearest relevant tests, current scan identifier, test commands, and the expected end condition. A generated packet may link to other files; avoid embedding the full repo or megabytes of JSON. Include a small `case.json` for the viewer if useful.

### Grouping algorithm

Start deterministically: union violation records that share a cycle, share an offending file, or form one connected local problem around the same boundary. Keep groups small: cap a generated packet at roughly six primary source files and split larger connected components into reviewable subgroups with cross-links. Prioritize a group with clear causality, existing tests, and a plausible two-to-five-file repair. Allow manual selection or regrouping. Grouping does **not** mean asking Bob to repair the entire repo at once.

### Compare contract

`compare(before, after)` requires the **same config hash and scan scope**; otherwise mark the comparison invalid. Return resolved, persistent, and newly introduced rule violations plus added/removed dependencies in the focused neighborhood. Record test command, exit code, and captured output separately. Verification succeeds only if targeted tests and typecheck pass, the selected violation is absent, and no new high-severity rule violation appears. Surface any failure plainly rather than hiding it behind an aggregate score.

## 5. Bob workflow and the human checkpoint

**Suggested project skill** at `.bob/skills/archpulse/SKILL.md`:

```md
---
name: archpulse
description: Investigate a grouped architecture violation, propose a reviewable multi-file refactor, implement only after approval, and report verification.
---

Call the ArchPulse scan_repository MCP tool for this workspace and get_case
for one selected group. Read only its listed source and relevant tests.
Investigate actual imports and call sites; explain the underlying cause.
Propose the smallest safe multi-file refactor, affected files, behavioral
risks, and tests. Stop and request approval for the plan. After approval,
implement the approved plan. Call verify_case with the saved baseline ID;
report actual test/typecheck outcomes and resolved, remaining, or new
violations. Do not claim success without the returned results.
```

**Implementation note:** The human checkpoint is approval of the **case plan**, not an extra approval for every file or individual scanner finding. Bob IDE may separately request action/tool approvals depending on its settings; those are distinct UI controls.

**First Bob task (Plan mode):**

> Use the ArchPulse skill. Call `scan_repository` for this workspace, then `get_case` for case-001. Inspect only the listed source files and any direct callers needed to understand the problem. Explain the cause and propose a minimal refactor that removes the selected violation while preserving behavior. List files to edit and tests to run. Do not edit source until I approve the plan.

**After the human approves the specific plan (Agent mode):**

> Implement the approved plan for case-001. Keep changes focused. Call `verify_case` with the case ID and baseline ID; it will run the configured tests/typecheck and same-config scan. Summarize changed files, test results, resolved/persistent/new violations, and remaining risks. If tests fail, investigate and fix within this case, then re-run verification.

If Bob’s plan exposes a better architectural direction, the reviewer may revise and approve it. Save the approved plan in the case packet or task notes so it survives a fresh Bob task. For a new case start a fresh task with a new packet to limit repeated context. IBM documents that the 270k-token window also contains system instructions, tools, rules, loaded skills, and conversation output; loading a full repository would consume that window and raise costs. [Context-window documentation](https://bob.ibm.com/docs/ide/core-concepts/context-window-management).

**Subagent rule:** optional specialized subagents may independently inspect separate bounded parts of one case, if useful and affordable. Detection → implementation → verification stays sequential. The deterministic scanner and test runner do not need AI subagents to perform their jobs.

## 6. CLI contract and verification steps

Implement the following shared commands for local debugging and CI. The Bob MCP tools call the same underlying functions; Bob users interact through the IDE:

```text
archpulse scan --repo demo --out .archpulse/before
archpulse cases --snapshot .archpulse/before/snapshot.json --out .archpulse/cases
archpulse scan --repo demo --out .archpulse/after
archpulse compare --before .archpulse/before/snapshot.json --after .archpulse/after/snapshot.json --case case-001 --out .archpulse/result
```

The actual scanner invocation can use `dependency-cruiser --output-type json` for machine-readable output and `--output-type dot-webpage` for graph HTML. Use the same resolution settings and exclusions every time. A scan may exit nonzero **because a rule violation was detected**; keep its valid JSON, distinguish expected findings from execution errors, and fail clearly on invalid/no output. Confirm TS aliases and workspace package resolution in the chosen repo before promising complete coverage.

**Baseline gate before any Bob refactor:** tests/typecheck already pass or their known failures are recorded; scanner output is reproducible; intended rule violation is present. Otherwise a post-change green claim is ambiguous.

**Post-change gate:**

1. Run targeted test command and typecheck. Record full exit status and concise log.
2. Re-scan the same source scope with unchanged architecture rules.
3. Compare target case and list all new violations, even if the original violation disappeared.
4. Review `git diff` to make sure the refactor did not remove behavior, disable tests, or weaken rules.
5. Mark result `verified`, `partial`, or `failed` with reason. For `verified`, retain both snapshots and proof output.

Keep an easy rollback path with a Git branch and a baseline commit before Bob edits. Do not automatically rewrite another team member’s changes when testing a repair.

## 7. Six-person ownership and handoffs

Assign actual names at kickoff. Work in short feature branches; integration owner reviews merges into a single demo branch. Everyone uses Bob IDE for relevant implementation/review work and captures their own relevant task summaries.

| Owner | Mission | First handoff | Done when |
| --- | --- | --- | --- |
| A — integration lead | Select/seed demo repo, decide rules, define contracts, maintain add-on installation and build | Frozen sample layout + base test commands + first IDE MCP smoke test | Bob IDE connects to the add-on and one reproducible workflow runs |
| B — scanner + MCP | Configure dependency-cruiser, JSON normalization, graph export, and minimal STDIO MCP server | Bob IDE calls `scan_repository` and gets a real bounded result | Same-scope scans are comparable; Bob tool output remains short |
| C — grouping/cases | Convert normalized findings into bounded groups; expose `get_case` through B's MCP server | `get_case` returns case-001 from B's snapshot | Packet includes evidence, files, relevant tests, and stop condition |
| D — Bob workflow | Author add-on skill, test Plan → review → Agent refactor on chosen case | Recorded approved plan + real code diff | Bob changes multiple files while preserving expected behavior |
| E — verifier | Baseline test gate, post-edit tests/typecheck, re-scan comparison | `compare` result contract + regression test | Result reports resolved/persistent/new and test exit status accurately |
| F — results/demo | Build case/results screen from artifacts, assemble video/README/screenshots | Screen displaying sample before case + post result | Judges can understand the verified change within 60 seconds |

**Avoid branch collisions:** A owns demo baseline, installation docs, and integration; B owns `src/mcp/` and scanning; C owns grouping; E owns comparison/verification; D owns `.bob/skills/`; F owns `src/viewer/` and presentation. B exposes three registered MCP tool names immediately and delegates each tool's core handler to its owner. D’s refactor of the demo repo happens on a dedicated demo branch or worktree after A freezes the baseline. Rebase/merge frequently; F can use frozen fixture JSON while B/E finalize the exact schema.

**Handoff order:** A defines demo repo and acceptance case → B produces snapshot → C produces case → D runs Bob plan/repair → E verifies and compares → F shows results. B, C, E, and F can implement against an agreed example schema before upstream code is complete.

## 8. Forty-eight-hour schedule and gates

Hours are measured from the team’s kickoff, not local midnight. Leave the final eight hours for proof and submission, not core coding.

| Hours | Outcome | Owners and gate |
| --- | --- | --- |
| 0–2 | Agree on one JS/TS demo repo, one cycle, one boundary policy, package manager, test commands, and JSON contract | A leads; all confirm source/tests are usable |
| 2–8 | Scanner JSON + graph, minimal local MCP server, baseline tests, case grouping, Bob skill skeleton, viewer fixture | B/C/D/E/F work in parallel on separate files |
| 8–12 | **Gate 1:** Bob IDE calls `scan_repository` and `get_case`; real case-001 and graph show violation | A integrates installation; B/C register tools; D performs bounded Bob investigation |
| 12–20 | Bob proposes plan, reviewer approves, Bob edits; E implements compare; F renders before view | D+reviewer handle repair; A ensures baseline remains reproducible |
| 20–28 | **Gate 2:** Bob IDE calls `verify_case`; tests/typecheck pass and same-config re-scan proves selected violation gone without a new serious violation | E+D fix concrete regressions; A merges working MVP |
| 28–36 | Polish focused diff and output, optionally run second case; capture clean demo artifacts and task summaries | F demo; B/C/E robustness; D optional second case |
| 36–40 | Freeze working code and record end-to-end demo rehearsal; prepare README and screenshots | A/F lead; all verify their Bob screenshots |
| 40–48 | Record video, commit evidence, check submission fields, submit with buffer | A submits; F owns pitch; other owners handle last verified fixes |

**Cut rule:** If Gate 1 slips beyond hour 12, drop the custom viewer and use `dot-webpage` + a concise results Markdown page. Keep the three minimal Bob-callable tools, because they define the add-on. If Gate 2 slips beyond hour 28, stop adding features, focus on one verified case, and present any remaining limitation honestly. A polished and truthful repair beats multiple unfinished cases.

## 9. BobCoin and context budget

The official guide allocates **40 BobCoins to each hackathon-provisioned account** and says no additional hackathon BobCoins are supplied when the allocation is exhausted; monitor actual account consumption. This is an allocation per participant account, not one shared pooled wallet. Keep planning numbers as caps to manage risk, not promised cost estimates. [Participant guide, Bobcoins](https://lablab-ibm-bob-2-hackathon-guide.s3.us.cloud-object-storage.appdomain.cloud/index.html).

- Limit Bob tasks to meaningful work: designing a bounded case, implementing a reviewed refactor, or analyzing one failed verification. Bob's MCP call runs the scanner locally, but its tool output and subsequent reasoning still use context; repeated scans needed for debugging can run through the CLI without a Bob conversation.
- Put graph JSON on disk; give Bob a short case packet and named source files. Keep the project skill short and avoid enabling irrelevant MCP servers.
- Check balance after the first complete Bob case to estimate subsequent cost; reserve enough in D’s account for a clean demo task and last-minute repair.
- Do not enforce an imagined “single prompt per agent” requirement. One approved plan and a small number of targeted follow-ups are more realistic than one giant prompt.
- Never assume Bob’s 270k-token **capacity** means the entire repo should be read or that the scan can fit inside a single task.

## 10. Evidence, pitch, and submission

Record a reproducible demo with timestamps/logs from the **same baseline**:

1. Show the ArchPulse MCP tools connected in Bob IDE; ask Bob to scan and show the original graph and selected violation.
2. Show Bob calling `get_case`, investigating, and proposing a specific plan.
3. Show the approval decision, real multi-file edits, and the code diff.
4. Show Bob calling `verify_case`, passing targeted tests/typecheck, and a deterministic re-scan.
5. Show before/after graph focused on the changed area; list resolved and newly introduced violations.

Quantify only measurements actually obtained: number of real rule violations before and after, number of files touched, tests passing, and elapsed time if recorded consistently. Do not invent productivity percentages, “zero broken code,” or external-auditor savings.

Submission checklist:

- [ ] Working Bob add-on with local MCP server and skill, sample code, architecture rules, and repeatable installation/run steps.
- [ ] Clear README with screenshots and one command per major stage.
- [ ] Actual Bob IDE in demo, visibly responsible for investigation, plan, and code changes.
- [ ] `bob_sessions/` containing relevant Bob IDE task session consumption summary screenshots, as required by the guide.
- [ ] `artifacts/example/` with small before/after snapshots and compare report; demo no longer depends on ephemeral files.
- [ ] Demo video and submission description match observable behavior.
- [ ] Final trial run on a fresh clone or clean worktree before freeze.

## 11. Primary risks and responses

| Risk | Early signal | Response |
| --- | --- | --- |
| Scanner misses TS aliases or workspace imports | Known edge absent from first snapshot | Configure TS resolution; choose repo with supported imports; validate against a hand-checked edge list |
| MCP connection fails on demo machine | Bob IDE never lists ArchPulse tools | Test STDIO handshake inside Bob by hour 8; keep a locked Node/runtime version; fix integration before UI work |
| Cycle “fixed” by rule suppression or removed behavior | Scanner clean, but code/test diff suspicious | Human reviews plan and Git diff; unchanged rules, baseline tests, new targeted assertion if needed |
| Bob spends context on irrelevant files | Task starts consuming many tokens before plan | Feed short case; name files; start fresh task after case; remove unneeded MCP tools |
| Viewer delays core repair | No functioning end-to-end result by hour 20 | Fall back to dependency-cruiser `dot-webpage` HTML and a Markdown compare report |
| Demo project is too trivial | Refactor is just deleting an import | Seed a realistic multi-file cycle with real tests and behavior preserved; keep the selected case solvable |
| Demo script fails on machine/OS differences | Setup command diverges across team machines | Pick one supported environment, lock Node/runtime versions and lockfile, capture exact test commands |
| Requirements are overstated | Team starts building invented 25% category weights or claims mandatory subagents | Refer only to official guide; show meaningful Bob IDE use and a tested result |

## 12. Instructions to give Bob when building ArchPulse itself

Paste this into a **new Bob IDE task** in the ArchPulse repository. Assign a bounded workstream to each team member’s Bob session instead of asking one Bob task to build everything:

> We are building ArchPulse as an add-on to IBM Bob IDE for the IBM Bob 2.0 Hackathon. Read `@ARCHPULSE_EXECUTION_PLAN.md`, then implement only the workstream I specify. The add-on consists of a local Node.js MCP server with `scan_repository`, `get_case`, and `verify_case`, plus a Bob skill. It uses dependency-cruiser to scan a JavaScript/TypeScript demo repository and return compact findings; it saves the full graph to local artifacts. IBM Bob IDE investigates a selected case, proposes a plan for approval, then edits code after approval. The verifier runs configured tests and a same-config re-scan. Preserve the JSON contracts and do not replace the scanner with repo-wide LLM reading. Avoid unsupported IBM APIs, invented architecture scores, and speculative UI features. Tell me which files you will change and how you will check your work.

Suggested bounded next prompts: “Implement scanner and normalized snapshot contract (Owner B)”; “Implement grouping and case packet generation (Owner C)”; “Implement compare and verification contract (Owner E)”; “Build a viewer for the sample artifacts (Owner F).” One owner handles integration. Bob’s **feature implementation tasks** and Bob’s **demo refactor task** are both worth recording as evidence.

## 13. Definition of done

ArchPulse is ready to submit when a teammate can install the local ArchPulse MCP tool and skill in Bob IDE on the chosen supported environment, ask Bob to scan and retrieve a real case, approve Bob's meaningful multi-file refactor, ask Bob to verify with tests and a same-config re-scan, see the exact violation resolved without new serious violations, and find the required Bob IDE task screenshots in `bob_sessions/`. If any of these are missing, the team should state what worked and what did not in the submission.
