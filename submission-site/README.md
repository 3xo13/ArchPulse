# ArchPulse submission site

A standalone React/Vite website: a dark landing page, guided interactive evidence
demo, local report import, and a manually supplied ArchPulse download. No backend,
accounts, command execution, or source-code uploads.

## Move and run it

Copy or move **this entire folder** anywhere, keeping its own package.json and
package-lock.json. It is not an ArchPulse workspace and needs no parent files,
configuration, packages, or Git metadata. Use Node.js **24.x** with npm.

```powershell
cd path\to\submission-site
npm ci --include=dev --ignore-scripts
npm run dev
```

The landing page is `/`; the interactive demo is `/#/demo`. Hash navigation needs
no server rewrites. The default page uses recorded evidence, never a live scan.

```powershell
npm run typecheck
npm run lint
npm test
npm run build
npx playwright install chromium
npm run test:browser
```

`npm run preview` serves the production build locally. Browser tests create
screenshots in test-results, which is ignored. They need installed Chromium.
The download test builds a synthetic ZIP into a temporary directory; it does
not generate a usable ArchPulse package or alter your real archive.

## Add the ArchPulse package

Manually place your archive at **public/downloads/ArchPulse.rar** (the supplied
package) or **public/downloads/archpulse.zip**. A nonempty RAR takes precedence
when both exist. The Download for Bob button uses the exact filename and casing
at build time. Until an archive is present the page says Download coming soon.
Rebuild/restart the dev server after adding or replacing it.

The archive should extract to a permanent ArchPulse folder with package.json at its
root. Include source, scripts, required config, the unchanged package.json and
package-lock.json, documentation, `.bob/skills/archpulse/SKILL.md`, and demo
workspace directories (the locked package graph references them).

Exclude **submission-site/** completely from the ArchPulse ZIP. Also exclude
.git, node_modules, dist, .archpulse, temporary reports, recordings/screenshots,
secrets, and machine-specific Bob settings. Keep the global skill template in
scripts/global-skill.md. Do not remove demo workspaces or edit the package manifest
independently of its lockfile. This is a source distribution requiring dependency
installation, not a standalone executable or an offline bundle.

The current page documents the short launcher, interactive setup, and local graph
preview. Before deploying these instructions, replace any older download archive
with the matching implementation: include `scripts/archpulse.js`, the package's
`bin` entry, `src/cli/setup.ts`, `src/mcp/graph-preview.ts`, and the updated global
skill and MCP server. Updating this website does not rebuild the supplied archive.

ZIP and RAR archives are ignored by Git by default. For a Git-based Vercel deployment, the
archive must be deliberately included in the deployment source (for example, explicitly
stage this single file), or deploy the local folder through Vercel CLI. An ignored
archive on your computer will not appear in a deployment built from Git.

Before submission, extract the actual archive to a fresh folder with spaces, install
dependencies, test the installer with `--global --bob-home <temporary-bob-home>`,
and confirm its MCP server can scan a separate JS/TS project. Then test the normal
installation in Bob. Synthetic download tests are not evidence that your package
installs successfully.

## Install the downloaded add-on in Bob

In the extracted **ArchPulse package**, not this website folder:

The archive intentionally omits node_modules. The first command below downloads
the locked dependencies and recreates it; internet access is required. RAR files
need a RAR-capable extractor such as 7-Zip or WinRAR.

```powershell
npm ci --include=dev --ignore-scripts
npm link --ignore-scripts
node scripts/install-bob-addon.js --global
```

Keep that folder installed. Restart Bob, open the project to inspect, enable Use
MCP Servers in Bob's MCP settings, and find archpulse with scan_repository,
get_case, and verify_case. Project-level archpulse settings override the global
server. Ask Bob to scan without editing files; provide an absolute workspacePath
if Bob cannot discover the root. Dependencies must already be installed in the
target project for complete resolution. Missing coverage is reported explicitly.

The link command registers `archpulse` for use from any project folder. Open a
terminal in the target application and run `archpulse setup` to review commands
and approve with `y`; no proposal ID is needed. On Windows, `archpulse.cmd setup`
avoids PowerShell script-shim restrictions. Without registration, run
`node scripts/archpulse.js setup --repo "<ABSOLUTE_PROJECT_PATH>"` from the installed
ArchPulse folder, replacing the placeholder with the application's actual path.

Setup saves approval externally and does not execute checks. Both tests and
typechecks are required for full verification. Capture a fresh baseline after
approving checks and before repairing. Package commands may modify project files.
Scanning and graph viewing do not require command approval.

The copyable Bob prompt requests graph → repair plan → user approval → repair →
verification. Graph previews use session-local HTTP links on the machine running
ArchPulse; keep the saved HTML path for offline access after shutdown. Embedded
IDE display depends on Bob's available browser tools and is not guaranteed.

## Deploy to Vercel

1. Import this folder's repository or deploy this folder with Vercel CLI.
2. Root Directory: `submission-site` while nested here; repository root after moving it.
3. Framework: Vite. Node: 24.x (also declared by engines).
4. Install: `npm ci --include=dev --ignore-scripts`.
5. Build: `npm run build`. Output: `dist`.
6. Use a production URL accessible without Vercel authentication. Verify the page,
   direct demo link, and download from a signed-out/private browser.

vercel.json contains the build settings. No environment variables or backend
functions are required. Only dist is served, including any supplied ZIP. The MCP
server runs locally after users install it; it is not hosted on Vercel.

## Evidence and compatibility

Browser logic, schemas, and example JSON were copied from ArchPulse commit
**db2547f0ac3a39309d61e8338107231edacae571**. `src/demo` contains standalone
copies of the report validator, types, cycle-aware graph logic, source URL
validation, and test-summary parser. `src/fixtures` contains byte-for-byte copies
of the four committed example artifacts. No live imports or synchronization with
the parent repository occur. Future updates must be explicitly copied and tested.

The example resolves one selected case while one unrelated violation remains.
The committed examples are illustrative recorded artifacts and do not establish
the current repository status or a new Bob demonstration. No source diff is
invented; edge changes are derived from the snapshots.

Report imports stay in memory and are discarded on reload. Each file is limited
to 20 MiB. Incomplete reports have no after graph. Test counts are shown only for
complete supported summaries. Explicit repository/revision settings enable
source links; labels such as baseline are not treated as commit SHAs.

The website uses its own dependencies and checks. It does not change ArchPulse's
verification policy, mandatory checks, installation, fixtures, or original viewer.
Bob Gate 1/Gate 2 demonstrations remain separate acceptance evidence.
