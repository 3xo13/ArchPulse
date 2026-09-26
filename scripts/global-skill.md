---
name: archpulse
description: Scan any JS/TS workspace without adding project files, review architecture cases, and verify approved repairs with real checks.
---

Call scan_repository with the absolute workspacePath of the project the user selected.
Save its immutable baselineId. ArchPulse stores its own files outside the project.
Generic scans detect import cycles and resolution problems, not unstated architectural rules.
Report incomplete coverage and unsupported source formats honestly.
Call get_case using the same workspacePath and baselineId for a returned case.
Investigate the source and actual tests, then propose a minimal repair and wait for approval.

If verification checks are not approved, show the user this installed CLI launcher:
{{ARCHPULSE_CLI}} configure --repo "<absolute-project-path>"
Explain the proposed commands and working directories. Ask the user to run:
{{ARCHPULSE_CLI}} configure --repo "<path>" --approve <proposal-id>
after reviewing them.
Do not approve commands on the user's behalf. Package scripts can run shell commands,
lifecycle hooks, and generate project files. ArchPulse does not install dependencies.
After approval, capture a fresh baseline and select its case before making the approved repair.
Call verify_case with that baselineId, caseId, and workspacePath.
Only report verified when returned evidence says so; missing tests/typechecks are not success.
Do not edit package manifests or source just to make initial scanning work.
