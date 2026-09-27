---
name: archpulse
description: Scan any JS/TS workspace without adding project files, review architecture cases, and verify approved repairs with real checks.
---

Call scan_repository with the absolute workspacePath of the project the user selected.
Save its immutable baselineId. ArchPulse stores its own files outside the project.
After every scan, show the returned Graph path prominently as a clickable local
file link AND a copyable full path. Tell the user to open graph.html in a browser;
it works offline. Do not replace the path with just a reference to the store or latest/.
When the tool returns "Open dependency graph" / "Browser preview", put that exact
HTTP link FIRST in your response. Use it for the IDE's browser/preview capability
if that capability is available and the user asked to display the graph. Otherwise
provide the link for the user's browser. Do not claim it is displayed unless the
preview actually opened. The link is local to the machine running ArchPulse and
lasts only while its MCP server runs (older previews may expire). Keep the HTML
file path as the permanent fallback. Never copy the graph HTML into chat, create
a substitute graph, start another web server, or install a preview extension.
Show the exact full Baseline value returned by the tool, including snapshot.json
when it is a path. A scan UUID or git marker is not a substitute for that value.
Retain the snapshot and case-index paths so the user can find the full evidence.
Generic scans detect import cycles and resolution problems, not unstated architectural rules.
Report incomplete coverage and unsupported source formats honestly.
Do not invent causes for warnings. "Git ignore information unavailable" can mean
the folder is not a Git repository; it does not prove .gitignore is absent or unreadable.
Describe incomplete scans as "no violations detected in captured dependencies",
never as unconditionally clean.
Call get_case using the same workspacePath and baselineId for a returned case.
Investigate the source and actual tests, then propose a minimal repair and wait for approval.
Unless the user requested only a scan, retrieve the first returned case when they
have not selected one and provide its concrete repair proposal in the same turn.
End with one explicit next step, not a vague offer to continue. For a case with a
proposal, say which case will be repaired and ask the user to approve that repair.
Explain that after the approved repair you will call verify_case with the preserved
baseline and report real check results. Do not recapture the before baseline after
repair. If there are zero cases, explain that no repair case is available rather
than implying the user must create one. Mention missing check approval only when
full verification is wanted; scanning and the graph are already available.

Do not require command approval for scanning, viewing graphs, or retrieving cases.
Only when the user wants full repair verification, ask them to run `archpulse setup`
in their project terminal if they registered the launcher with `npm link --ignore-scripts`.
Otherwise provide this installed launcher (no proposal ID needs copying):
{{ARCHPULSE_CLI}} setup --repo "<absolute-project-path>"
Setup displays exact commands, script definitions, working directories, and warnings,
then asks the user to approve interactively. Missing tests or typechecks block full
verification, not scanning. Approval does not mean checks have run or passed.
Do not approve commands on the user's behalf. Package scripts can run shell commands,
lifecycle hooks, and generate project files. ArchPulse does not install dependencies.
After approval, capture a fresh baseline and select its case before making the approved repair.
Call verify_case with that baselineId, caseId, and workspacePath.
Only report verified when returned evidence says so; missing tests/typechecks are not success.
Do not edit package manifests or source just to make initial scanning work.

For a requested end-to-end guided run, use this concise sequence:
1. Scan once. Show the graph preview link, coverage, violation/case counts, and
   exact baseline. Preserve workspacePath spelling for all following calls.
2. Retrieve the selected case (default first). Read only relevant source/tests.
   Show a numbered plan naming files to change, behavior to preserve, required
   checks, and unrelated cases that will remain. End: "Approve this plan to repair
   <caseId> and run verification?" Do not make the user ask separately for a plan.
3. After approval, implement only that plan. Call verify_case with the original
   baseline and same workspacePath; its checks already run tests/typechecks, so
   do not spend another turn rerunning them independently unless diagnosing failure.
4. Show status, recorded test/typecheck outcomes, resolved and remaining violations,
   result path, and the tool's after-graph link when available. Never show an after
   graph for an interrupted comparison. State the next case to consider and ask
   before repairing it, unless the user's approval already covered that case.
No speculative debugging, broad repository exploration, or repeated scans are
needed for a healthy run. State actual blockers plainly without declaring success.
