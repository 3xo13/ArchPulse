import { useId, useMemo, useState } from "react";
import type { Snapshot } from "../demo/types";
import { edgeKey, focusedGraph } from "../demo/graph";
import CopyButton from "./CopyButton";

const colors = ["#72dacd", "#b59cff", "#f5b879", "#88b8ff"];
const basename = (file: string) => file.split("/").pop() ?? file;

export default function GraphExplorer({ snapshot, primaryFiles, compact = false, repositoryView = false, linkFor }: {
  snapshot: Snapshot; primaryFiles: string[]; compact?: boolean; repositoryView?: boolean; linkFor?: (file: string) => string | undefined;
}) {
  const [selected, setSelected] = useState("");
  const [selectedEdge, setSelectedEdge] = useState("");
  const [focus, setFocus] = useState(false);
  const marker = useId().replaceAll(":", "");
  const primary = useMemo(() => new Set(primaryFiles), [primaryFiles]);
  const graph = useMemo(() => focusedGraph(snapshot, repositoryView ? new Set(snapshot.modules.map(mod => mod.path)) : primary), [snapshot, primary, repositoryView]);
  const edges = graph.edges.filter(edge => !focus || graph.highlighted.has(edgeKey(edge.from, edge.to)));
  const visible = focus ? new Set(edges.flatMap(edge => [edge.from, edge.to])) : graph.nodes;
  const nodes = [...visible].sort();
  const layerOf = (file: string) => snapshot.modules.find(mod => mod.path === file)?.layer ?? "other";
  const foundLayers = [...new Set(nodes.map(layerOf))];
  const order = ["ui", "domain", "db", "shared"];
  const layers = [...order.filter(layer => foundLayers.includes(layer)), ...foundLayers.filter(layer => !order.includes(layer)).sort()];
  const positions = new Map<string, { x: number; y: number; color: string }>();
  let rows = 1;
  layers.forEach((layer, column) => {
    const group = nodes.filter(file => layerOf(file) === layer);
    rows = Math.max(rows, group.length);
    group.forEach((file, row) => positions.set(file, { x: 28 + column * 208, y: 62 + row * 108, color: colors[column % colors.length]! }));
  });
  const width = Math.max(400, layers.length * 208 + 24);
  const height = Math.max(220, rows * 108 + 64);
  const active = positions.has(selected) ? selected : "";
  const dependencies = active ? snapshot.edges.filter(edge => edge.from === active || edge.to === active) : [];
  const violations = snapshot.violations.filter(v => v.from === active || v.to === active || v.cyclePath?.includes(active));
  const link = active ? linkFor?.(active) : undefined;
  const reset = () => { setSelected(""); setSelectedEdge(""); setFocus(false); };
  return <div className={`graph-explorer ${compact ? "compact" : ""}`}>
    <div className="graph-toolbar"><span className="mono"><span className="live-dot" /> DEPENDENCY MAP</span>
      {!compact && <div className="graph-actions"><label className="check-label"><input type="checkbox" checked={focus} onChange={event => { setFocus(event.target.checked); setSelectedEdge(""); }} />Violations only</label><button className="text-button" onClick={reset}>Reset selection</button></div>}
    </div>
    <div className="graph-scroll" tabIndex={0} role="region" aria-label="Scrollable dependency graph">
      <svg className="dependency-svg" viewBox={`0 0 ${width} ${height}`} style={{ minWidth: compact ? 560 : Math.min(width, 760) }} aria-label="Dependency graph">
        <defs><pattern id={`${marker}-grid`} width="20" height="20" patternUnits="userSpaceOnUse"><circle cx="1" cy="1" r="0.7" fill="#324253" /></pattern>
          <marker id={`${marker}-arrow`} viewBox="0 0 8 8" refX="7" refY="4" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M0 0L8 4L0 8" fill="#64788b" /></marker>
          <marker id={`${marker}-error`} viewBox="0 0 8 8" refX="7" refY="4" markerWidth="7" markerHeight="7" orient="auto"><path d="M0 0L8 4L0 8" fill="#ff8290" /></marker>
        </defs>
        <rect width={width} height={height} fill={`url(#${marker}-grid)`} opacity=".45" />
        {layers.map((layer, i) => <text key={layer} x={28 + i * 208} y={28} className="layer-label">{layer.toUpperCase()}</text>)}
        {edges.map(edge => {
          const a = positions.get(edge.from), b = positions.get(edge.to); if (!a || !b) return null;
          const key = edgeKey(edge.from, edge.to), violation = graph.highlighted.has(key), chosen = selectedEdge === key;
          const same = a.x === b.x, forward = a.x < b.x;
          const startX = same ? a.x + 166 : a.x + (forward ? 166 : 0), endX = same ? b.x + 166 : b.x + (forward ? 0 : 166);
          const bend = same ? 35 : (forward ? 34 : -34);
          const d = `M ${startX} ${a.y + 27} C ${startX + bend} ${a.y + 27}, ${same ? endX + bend : endX - bend} ${b.y + 27}, ${endX} ${b.y + 27}`;
          return <path key={key} d={d} fill="none" className={`graph-edge ${violation ? "violating" : ""} ${chosen ? "selected-edge" : ""}`} data-selected={chosen} stroke={chosen ? "#f4f9ff" : violation ? "#ff8290" : "#526b80"} strokeWidth={chosen ? 3 : 1.5} strokeDasharray={violation ? "5 4" : undefined} markerEnd={`url(#${marker}-${violation ? "error" : "arrow"})`}><title>{edge.from} → {edge.to}{violation ? " · violation" : ""}</title></path>;
        })}
        {nodes.map(file => {
          const position = positions.get(file)!;
          const choose = () => { setSelected(file); setSelectedEdge(""); };
          return <g key={file} className={`graph-node ${active === file ? "active" : ""}`} transform={`translate(${position.x},${position.y})`} role="button" tabIndex={0} aria-label={`Inspect ${file}`} aria-pressed={active === file} onClick={choose} onKeyDown={event => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); choose(); } }}>
            <rect width="166" height="54" rx="9" fill="#111f2e" stroke={active === file ? "#f4f9ff" : primary.has(file) ? position.color : "#435267"} strokeWidth={active === file ? 2 : 1} />
            <circle cx="14" cy="19" r="3" fill={position.color} /><text x="24" y="23" className="node-name">{basename(file).length > 20 ? `${basename(file).slice(0, 17)}…` : basename(file)}</text>
            <text x="14" y="41" className="node-detail">{layerOf(file)}{primary.has(file) ? " · primary" : ""}</text><title>{file}</title>
          </g>;
        })}
        {!nodes.length && <text x="24" y="110" className="node-name">No violating edges in this focused graph.</text>}
      </svg>
    </div>
    <div className="graph-legend"><span><i className="legend-line" />Dependency</span><span><i className="legend-line error" />Violation</span><span><i className="legend-node" />Primary file</span><span className="graph-count">{nodes.length} focused files · {edges.length} edges</span></div>
    {active ? <section className="file-inspector" aria-label="File inspector"><div className="section-top"><span className="eyebrow">SELECTED FILE</span><CopyButton text={active} label="Copy path" /></div><code className="file-path">{active}</code>
      {compact ? <a className="text-link" href="#/demo">Explore this case <span aria-hidden="true">↗</span></a> : <>
        <p className="muted-text">Layer: {layerOf(active)} · {violations.length} related violations</p>
        {link ? <a href={link} target="_blank" rel="noreferrer">View source on GitHub ↗</a> : <p className="subtle">Copy this path to inspect locally. Source links need a repository URL and an explicit revision or commit SHA.</p>}
        <h4>Incoming / outgoing dependencies</h4><div className="dependency-list">{dependencies.length ? dependencies.map(edge => {
          const key = edgeKey(edge.from, edge.to), shown = edges.some(e => edgeKey(e.from, e.to) === key);
          return <button key={key} aria-label={`${edge.from === active ? "OUT" : "IN"} ${edge.from === active ? edge.to : edge.from}${!shown ? " (hidden by filter)" : ""}`} className={`dependency-button ${selectedEdge === key ? "chosen" : ""}`} disabled={!shown} aria-pressed={selectedEdge === key} onClick={() => setSelectedEdge(key)}><span>{edge.from === active ? "OUT" : "IN"}</span><code>{edge.from === active ? edge.to : edge.from}</code>{!shown && <small>Hidden by filter</small>}</button>;
        }) : <p>No recorded dependencies.</p>}</div>
        {violations.map(v => <p className="inline-warning" key={v.id}><strong>{v.rule}</strong> · {v.evidence ?? `${v.from} → ${v.to}`}</p>)}
      </>}
    </section> : <p className="graph-hint">Select a node to inspect its file{compact ? "." : " and connections. Use Tab and Enter for keyboard navigation."}</p>}
  </div>;
}
