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
