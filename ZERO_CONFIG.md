# Use ArchPulse across JS/TS projects

Install ArchPulse's dependencies once in its own checkout (`npm ci --ignore-scripts`), then run:

```powershell
node scripts/install-bob-addon.js --global
```

Reload Bob IDE. Global installation merges `~/.bob/settings/mcp.json` and installs a global ArchPulse skill under `~/.bob/skills/archpulse/`. It does not create files in your application. Keep the ArchPulse checkout and its dependencies installed. Existing project-level `archpulse` MCP entries override the global entry; remove or disable the project entry if you want global mode there. `--bob-home <directory>` supports alternate Bob homes and isolated installer testing.

Ask Bob: “Use ArchPulse to scan this JS/TS workspace and show me one repair case. Do not change application files.” Bob uses its advertised workspace root, or supplies an absolute `workspacePath` if its MCP client does not advertise roots. Multiple roots require an explicit selection. The same three tools remain available: `scan_repository`, `get_case`, and `verify_case`.

## What works without setup

Automatic scans discover JS, JSX, TS, TSX, MJS, CJS, MTS and CTS files, package boundaries, inherited TypeScript settings, and package-local aliases. Root-level scripts do not need a package manifest. Generic rules detect cycles across packages and report unresolved imports. Generic scans do not know unstated architecture boundaries such as “UI must not import db.”

Git ignores and standard generated directories are excluded. Files excluded deliberately by your profile are outside scan coverage. Vue/Svelte/Astro source and other languages are reported as unsupported. Missing dependencies, ambiguous TypeScript resolution settings, and Yarn PnP limitations are reported; incomplete evidence cannot authorize full verification. Dependencies must already be installed. Automatic scans never install them, execute package scripts, or load discovered JavaScript architecture configuration.

## Approve real checks once per project

For a short command available from any project folder, run this once inside the
permanent ArchPulse installation folder after installing its dependencies:

```powershell
npm link --ignore-scripts
```

Restart your terminal if needed. In the project you want to inspect, run:

```powershell
archpulse setup
```

On Windows, use `archpulse.cmd setup` if PowerShell blocks npm's `.ps1` shim.
Setup discovers checks, shows commands, working directories and package script
definitions, then asks `Approve these commands for future verification? [y/N]`.
It never runs the checks. You do not need to copy a proposal ID. Approval is saved
outside the project and is revalidated against the displayed proposal. Declining
or closing input saves no new approval. Missing tests or typechecks are reported
as unavailable verification, not a successful setup. Scanning and graphs still work.
After approval, ask Bob for a fresh baseline before repairing the selected case.

The link requires this installation folder and its dependencies to remain available.
Without global launcher registration, run this from the ArchPulse installation folder:

```powershell
node scripts/archpulse.js setup --repo "<absolute-project-path>"
```

Re-run the Bob
installer and reload Bob to update an existing global skill with the new guidance.
Existing explicit proposal commands below remain supported.

From the ArchPulse checkout:

```powershell
npm.cmd run inspect -- --repo "D:\work\your-project"
npm.cmd run configure -- --repo "D:\work\your-project"
npm.cmd run configure -- --repo "D:\work\your-project" --approve <proposal-id>
```

Review the exact commands, working directories, and warnings before approving. The global skill also provides an absolute launcher usable from other directories. Root and package scripts are proposed separately; root-script coverage is not assumed. Existing `test:ci`/`test` and `typecheck`/`check:types` scripts are preferred. Watch commands are not automatically proposed. Compatible installed TypeScript checks are proposed when possible; JavaScript projects without a checking strategy need an explicit check, not a fabricated success.

npm, pnpm, and Yarn must be installed. ArchPulse launches their JavaScript entrypoints without an outer shell; it does not enable Corepack or download managers. Package scripts themselves may invoke shells, lifecycle hooks, network operations, or write project files. Approval authorizes those configured checks. Changing the selected commands or relevant package manifests invalidates approval. After approval, capture a **fresh scan baseline**, select its case, make the approved repair, and call `verify_case` using that baseline.

Full verification requires approved tests and typechecks, complete resolution, all selected violations resolved, and no new violations. Otherwise it returns `invalid`, `failed`, or `partial` as appropriate. Projects without checks can still use scans, cases, and architecture-only comparison.

## External profiles and reports

State lives at `~/.archpulse/projects/<canonical-project-hash>/`. `inspect` prints the storage path and `configure` prints `profilePath`. Set `ARCHPULSE_STORAGE` or pass `--storage-base <directory>` to use another base; the base must place the project store outside the target repository. Use the same base for Bob and CLI. Profiles, proposals, approvals, locks, registries, baselines, cases, and reports live there. Symlink/junction aliases for the same repository share an identity; separate checkouts do not.

Edit the external `profile.json`, then generate and approve a new proposal. Example:

```json
{
  "version": 1,
  "scanScope": ".",
  "includes": ["apps/**/*.{ts,tsx}", "packages/**/*.ts"],
  "excludes": ["**/generated/**"],
  "aliases": { "@shared/*": ["packages/shared/src/*"] },
  "layers": [
    { "name": "ui", "glob": "apps/web/**" },
    { "name": "db", "glob": "packages/db/**" }
  ],
  "forbiddenDependencies": [
    { "from": "ui", "to": "db", "reason": "Route persistence through services." }
  ],
  "checks": {
    "tests": [{ "command": "npm run test:ci", "cwd": "." }],
    "typechecks": [{ "command": "npm run typecheck", "cwd": "." }]
  }
}
```

Explicitly setting `adoptedConfig` to a repository-relative dependency-cruiser configuration opts into loading that configuration, which may execute JavaScript. An adopted configuration controls scanner rules/resolution; the profile supplies grouping/check policy. Discovery lists candidates but never adopts them automatically. Do not copy the demo architecture rules into an unrelated application.

Artifact paths and baseline IDs in external mode are absolute. Import the before snapshot, recorded case, `result.json`, and the `afterSnapshotPath` from `execution.json` into the viewer. Interrupted reports may have no comparison snapshot. Legacy repository-local baselines and fixtures remain usable through their original workflow; recorded legacy cases can be read in global mode, but external verification requires a fresh approved external baseline. Public snapshot/case/result JSON fields and git-marker semantics are unchanged.

## Guided graph and repair workflow in Bob

After reloading Bob, ask: "Use ArchPulse for a guided scan and repair. Show the
dependency graph in the IDE browser if available, otherwise give me its browser
link. Retrieve the first case, propose the exact repair, and wait for my approval.
After approval, repair that case and verify it with real checks."

Successful MCP scans provide a clickable `http://127.0.0.1:<port>/graph/<token>`
preview and the saved HTML path. The preview needs no terminal server command,
serves only generated graphs, and stops when the MCP server disconnects. It runs
on the same machine as ArchPulse; it is not a public sharing URL. Preview memory
is capped at 32 MiB, so old links may expire. Reopen the saved `graph.html` offline
if the server has restarted, a link has expired, or preview startup is unavailable.
An embedded IDE browser depends on the capabilities enabled in your Bob version;
ArchPulse does not itself install an IDE webview or guarantee inline chat rendering.

Bob's installed skill directs it to show the link first, present a concrete case
repair plan in the same turn, wait for approval, and then report actual verification
outcomes and the after graph. Verification links an after graph only for completed
comparisons. Keep the exact baseline path, not just the UUID, for verification.

The existing project installer still works. CLI `scan` uses legacy mode for a project with `.dependency-cruiser.cjs`; pass `--storage external` to opt into automatic external mode. Unconfigured CLI scan targets select external mode automatically. Global MCP always uses external mode. No command changes tracked application files merely to prepare a scan.

## Validation and Bob demonstration

Run `npm test`, `npm run build`, `npm run lint -- --max-warnings 0`, and `npm run test:viewer` in ArchPulse. Windows process tests distinguish startup allowance from cancellation/shutdown deadlines. On constrained machines, `npm test -- --no-file-parallelism` is also available.

For Gate 1, demonstrate Bob calling scan and get_case on an isolated project with a real cycle. For Gate 2, approve real checks, capture a fresh baseline, approve a repair, and demonstrate Bob calling verify_case successfully. Automated protocol tests support these demonstrations but do not replace them.
