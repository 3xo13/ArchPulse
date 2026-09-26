🌀 ArchPulse — AI-Driven Architecture Guardrail & Refactoring Engine for IBM Bob 2.0

Automated architectural inspection, deterministic issue grouping, and zero-regression refactoring for IBM Bob IDE.

IBM Bob 2.0 Model Context Protocol TypeScript License: MIT

📌 Executive Overview

ArchPulse is a specialized extension and Model Context Protocol (MCP) server for IBM Bob 2.0 IDE. It bridges static codebase analysis with agentic AI to detect, group, and autonomously repair architectural violations—such as circular dependencies and layer boundary breaches—in JavaScript and TypeScript codebases.

Traditional AI assistants struggle with large-scale architectural refactoring because feeding raw repository dumps exhausts context windows with irrelevant token noise. ArchPulse solves this by generating ultra-compact case packets (< 2 KB) that provide IBM Bob 2.0 with exact, focused context without context window bloat.

🎯 Key Capabilities
🔬 Local Static Analysis Engine: Powered by dependency-cruiser, enforcing strict layer rules and cyclic dependency detection.
🔌 Native IBM Bob 2.0 MCP Integration: Exposes custom tools (scan_repository, get_case, verify_case) over STDIO transport.
📦 Bounded Case Packet Generation: Groups complex dependency graphs into isolated, reviewable case files (< 2 KB each) covering up to 6 primary source files.
🛡️ Human-in-the-Loop Safeguards: Operates strictly via a two-phase workflow (Plan Mode for proposal & approval → Agent Mode for autonomous execution).
✅ Automated Verification Gate: Runs allowlisted unit tests and compares pre/post-refactor snapshots to guarantee zero introduced regressions.
📊 Results Viewer: Provides a visual before-and-after graph and delta report comparing resolved vs. persistent violations.
🏗️ System Architecture
text
 ┌────────────────────────────────────────────────────────────────────────────────────────┐
 │                                   IBM BOB 2.0 IDE                                      │
 │                                                                                        │
 │  ┌────────────────────────┐    ┌───────────────────────────────────┐    ┌───────────┐  │
 │  │ .bob/skills/archpulse/ │    │            .bob/mcp.json          │    │ AGENTS.md │  │
 │  │        SKILL.md        │    │    (STDIO Launch Configuration)   │    │ (Context) │  │
 │  └───────────┬────────────┘    └─────────────────┬─────────────────┘    └───────────┘  │
 └──────────────┼───────────────────────────────────┼─────────────────────────────────────┘
                │ Prompt Instructions               │ MCP Connection (STDIO)
                ▼                                   ▼
 ┌────────────────────────────────────────────────────────────────────────────────────────┐
 │                       LOCAL MCP SERVER (Node.js/TypeScript)                            │
 │                                    src/mcp/server.ts                                   │
 │                                                                                        │
 │     ┌───────────────────────┬───────────────────────┬───────────────────────┐          │
 │     │   scan_repository()   │      get_case()       │     verify_case()     │          │
 │     └───────────┬───────────┴───────────┬───────────┴───────────┬───────────┘          │
 └─────────────────┼───────────────────────┼───────────────────────┼──────────────────────┘
                   │                       │                       │
                   ▼                       ▼                       ▼
 ┌────────────────────────────────────────────────────────────────────────────────────────┐
 │                                CORE ENGINE (src/core/)                                 │
 │                                                                                        │
 │  ┌────────────────────────┐   ┌─────────────────────────┐   ┌───────────────────────┐  │
 │  │      snapshot.ts       │   │  grouping / casePacket  │   │   compare / runner    │  │
 │  │ (Scan & Normalization) │   │   (Packets < 2 KB)      │   │ (Verification & Tests)│  │
 │  └───────────┬────────────┘   └────────────┬────────────┘   └───────────┬───────────┘  │
 └──────────────┼─────────────────────────────┼────────────────────────────┼──────────────┘
                │                             │                            │
                ▼                             ▼                            ▼
 ┌───────────────────────────┐   ┌─────────────────────────┐   ┌──────────────────────────┐
 │     Static Analysis       │   │     Case Artifacts      │   │   Contracts & Targets    │
 │   dependency-cruiser CLI  │   │   .archpulse/cases/     │   │  config/architecture.json│
 │   .dependency-cruiser.cjs │   │   case-001.md / json    │   │  demo/packages/ (Target) │
 └───────────────────────────┘   └─────────────────────────┘   └──────────────────────────┘
📂 Repository Layout
text
ArchPulse/
├── .bob/                           # IBM Bob 2.0 configuration & skill manifests
│   ├── mcp.json                    # STDIO server launch configuration
│   └── skills/archpulse/
│       └── SKILL.md                # ArchPulse guided workflow definition
├── .dependency-cruiser.cjs         # Static analysis rules configuration
├── ARCHPULSE_EXECUTION_PLAN.md     # Authoritative execution contract
├── SCHEMA.md                       # Data contracts & JSON schema specifications
├── TEAM.md                         # Parallel workstream owner assignments
├── artifacts/example/              # Sample JSON/MD artifacts for demo viewer
│   ├── snapshot-before.json
│   ├── snapshot-after.json
│   ├── case-001.json
│   └── result.json
├── bob_sessions/                   # IBM Bob 2.0 task session screenshots
│   ├── plan-task.png
│   └── agent-task.png
├── config/                         # Layer boundary contracts & test allowlists
│   └── architecture.json
├── demo/packages/                  # Sample JS/TS monorepo with intentional violations
├── src/                            # Core source tree
│   ├── cli/                        # CLI commands (scan, cases, compare)
│   ├── core/                       # Snapshot, grouping, compare, and runner modules
│   ├── mcp/                        # STDIO MCP Server implementation
│   └── viewer/                     # Visual results dashboard
├── package.json
└── tsconfig.json
🚀 Quick Start & Installation
Prerequisites
Node.js: v18.x or v20.x+
npm: v9.x+
IBM Bob IDE: v2.0.2 or later (configured with the hackathon workspace)
1. Installation

Clone the repository and install dependencies:

bash
git clone https://github.com/3xo13/ArchPulse.git
cd ArchPulse
npm install
npm run build
2. Configure IBM Bob IDE Integration

Add ArchPulse to your .bob/mcp.json configuration file:

json
{
  "mcpServers": {
    "archpulse": {
      "command": "node",
      "args": ["dist/mcp/server.js"],
      "env": {}
    }
  }
}

Place the skill definition file in your workspace at .bob/skills/archpulse/SKILL.md.

💻 Command Line Interface (CLI) Usage

You can also run ArchPulse directly from the terminal:

bash
# 1. Scan the repository and generate baseline snapshot
npm run scan -- --repo demo/packages --out .archpulse/before

# 2. Group violations into compact case packets (< 2 KB)
npm run cases -- --snapshot .archpulse/before/snapshot.json --out .archpulse/cases

# 3. Compare snapshots after refactoring and verify tests pass
npm run compare -- --before .archpulse/before/snapshot.json --after .archpulse/after/snapshot.json --case case-001 --out .archpulse/result

# 4. Launch the visual results viewer
npm run viewer
🤖 IBM Bob 2.0 Guided Workflow

When working inside IBM Bob IDE, invoke ArchPulse by prompting:

@bob use the archpulse skill to inspect architectural health

Step-by-Step Process:
Scan & Case Retrieval: Bob calls scan_repository() and get_case({ caseId: "case-001" }) to inspect the target violation in demo/packages/.
Plan Mode (Proposal): Bob analyzes the compact case packet (< 2 KB) and presents a structured refactoring proposal—for example, extracting shared interfaces to eliminate a cycle between AuthService and UserProfile. Bob pauses for human approval.
Human Approval: The developer reviews and approves the refactoring plan.
Agent Mode (Execution): Bob switches to Agent Mode and applies code modifications autonomously across affected files.
Verification: Bob calls verify_case({ caseId: "case-001" }). The verifier executes allowlisted unit tests, re-scans the repository, and confirms zero remaining violations and zero introduced regressions.
📸 Hackathon Evidence & Compliance

In accordance with the IBM Bob 2.0 Hackathon Guide, task session consumption summary screenshots are recorded and saved in PNG format in the bob_sessions/ directory:

bob_sessions/plan-task.png — Task consumption summary for the Plan Mode architectural analysis and proposal session.
bob_sessions/agent-task.png — Task consumption summary for the Agent Mode autonomous refactoring and verification session.
👥 Team & Acknowledgments
Project Name: ArchPulse
GitHub Repository: 3xo13/ArchPulse
Event: Official IBM Bob 2.0 Hackathon (hosted by lablab.ai & IBM)
Built With: IBM Bob 2.0, Model Context Protocol (MCP), dependency-cruiser, TypeScript, and IBM Carbon Design System guidelines.
📄 License

This project is open-source and available under the MIT License.
