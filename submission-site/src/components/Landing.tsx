import Brand from "./Brand";
import GraphExplorer from "./GraphExplorer";
import Install from "./Install";
import { example } from "../demo/example";
import { useState } from "react";

const workflow = [
  ["01", "Scan the structure", "See dependencies, circular paths, and configured boundary violations in one graph."],
  ["02", "Focus the repair", "Turn a violation into a bounded case with evidence, affected files, and relevant checks."],
  ["03", "Make the change", "Let Bob propose a focused repair. Review and approve edits in your own workspace."],
  ["04", "Verify with evidence", "Compare a fresh scan and run approved checks. Know what changed and what remains."],
];
export default function Landing() {
  const [after, setAfter] = useState(false);
  const snapshot = after ? example.after! : example.before;
  return <>
    <header className="site-header"><div className="container nav"><Brand /><nav aria-label="Main navigation"><a href="#how-it-works">How it works</a><a href="#/demo">Demo</a><a className="nav-install" href="#install">Install for Bob <span aria-hidden="true">↗</span></a></nav></div></header>
    <main id="main" className="container">
      <section className="hero"><div className="hero-copy"><div className="hero-label"><span className="live-dot" /> ARCHITECTURE REPAIR, WITH BOB IDE</div><h1>Understand the<br />dependency.<br /><span className="gradient-text">Repair with evidence.</span></h1><p className="hero-description">From a tangled import to a focused fix. ArchPulse connects dependency insights, repair cases, and real verification inside your workspace.</p><div className="hero-actions"><a className="button primary" href="#/demo">Explore interactive demo <span aria-hidden="true">↗</span></a><a className="button ghost" href="#install">Install for Bob <span aria-hidden="true">↓</span></a></div><p className="hero-note"><span>JS / TS</span><span>Local MCP server</span><span>Evidence you can inspect</span></p></div>
        <div className="hero-visual"><div className="preview-caption"><span className="mono">A CLOSER LOOK AT YOUR ARCHITECTURE</span><span className="pill">Recorded example</span></div><div className="preview-tabs"><span>{after ? "AFTER REPAIR" : "BEFORE REPAIR"}</span><div className="segmented"><button aria-pressed={!after} onClick={() => setAfter(false)}>Before</button><button aria-pressed={after} onClick={() => setAfter(true)}>After</button></div></div><GraphExplorer key={after ? "after" : "before"} compact repositoryView snapshot={snapshot} primaryFiles={example.packet.primaryFiles} /><div className="preview-outcome"><span className={after ? "status-good" : "status-warn"}>{after ? "Selected issue resolved" : "A boundary needs attention"}</span><span>{snapshot.violations.length} repository violations</span></div><p className="preview-footnote">{after ? "One unrelated violation remains. Verified does not mean the whole repository is clean." : "A UI-to-db import crosses a configured boundary. Explore the evidence behind the repair."}</p></div>
      </section>
      <section className="value-strip" aria-label="Product capabilities"><div><span className="strip-symbol">⌘</span><span>Understand the graph</span></div><div><span className="strip-symbol">◎</span><span>Keep repairs focused</span></div><div><span className="strip-symbol">✓</span><span>Check the outcome</span></div><div><span className="strip-symbol">↗</span><span>Stay in your workspace</span></div></section>
      <section id="how-it-works" className="page-section"><div className="section-heading"><div><span className="eyebrow">LESS GUESSWORK. MORE CONTEXT.</span><h2>A clear path<br />from issue to evidence.</h2></div><p>Architecture repair is more than removing a red line. Follow the case, understand the change, and inspect the checks that support the result.</p></div><div className="workflow-grid">{workflow.map(([number, title, description]) => <article className="workflow-card" key={number}><span className="workflow-number">{number}<span aria-hidden="true">↗</span></span><h3>{title}</h3><p>{description}</p></article>)}</div></section>
      <section className="demo-callout"><div><span className="eyebrow">OPEN THE EVIDENCE</span><h2>Don’t just read about the fix.<br />Explore it.</h2><p>Select a file. Follow its dependencies. Compare the repair.<br />No installation needed for the recorded demo.</p></div><a className="button primary" href="#/demo">Enter the demo <span aria-hidden="true">→</span></a></section>
      <Install />
      <section className="coverage-section"><div><span className="eyebrow">BUILT FOR REAL WORKSPACES</span><h3>JavaScript. TypeScript.<br />Apps, libraries, and monorepos.</h3></div><div><p>Generic scans detect cycles and report unresolved imports. Project-specific architecture boundaries need an external profile. Missing dependencies, unsupported aliases, and unsupported formats are reported as coverage limits.</p><p>Vue/Svelte/Astro formats and Yarn PnP are not supported by automatic resolution. This site displays recorded evidence; it does not scan uploaded source or execute commands. Imported reports stay in your browser.</p></div></section>
    </main><footer className="container site-footer"><Brand /><span>Understand the structure. Trust the evidence.</span><a href="#/demo">Open demo ↗</a></footer>
  </>;
}
