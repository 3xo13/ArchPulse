import React, { useMemo, useState } from "react";
import type { Snapshot } from "../../types";

interface Props {
  before: Snapshot;
  after: Snapshot;
  primaryFiles: string[];
}

// Layer colour palette — consistent with ArchPulse layer names
const LAYER_COLORS: Record<string, { fill: string; stroke: string; text: string }> = {
  ui:     { fill: "#dbeafe", stroke: "#2563eb", text: "#1d4ed8" },
  domain: { fill: "#f3e8ff", stroke: "#7c3aed", text: "#5b21b6" },
  db:     { fill: "#fef3c7", stroke: "#d97706", text: "#92400e" },
  shared: { fill: "#dcfce7", stroke: "#16a34a", text: "#15803d" },
};
const DEFAULT_NODE = { fill: "#f8fafc", stroke: "#94a3b8", text: "#475569" };

const VIOLATION_EDGE = "#dc2626";
const NORMAL_EDGE    = "#94a3b8";

// Compute a simple layered layout
function layoutNodes(
  nodes: string[],
  snapshot: Snapshot,
  _primaryFiles: Set<string>
): Map<string, { x: number; y: number; layer: string }> {
  const layerOrder = ["shared", "domain", "db", "ui"];
  const byLayer: Record<string, string[]> = {};
  for (const n of nodes) {
    const mod = snapshot.modules.find((m) => m.path === n);
    const layer = mod?.layer ?? "other";
    (byLayer[layer] = byLayer[layer] ?? []).push(n);
  }
  const layersPresent = layerOrder.filter((l) => byLayer[l]?.length);
  const otherLayers   = Object.keys(byLayer).filter((l) => !layerOrder.includes(l));
  const allLayers     = [...layersPresent, ...otherLayers];

  const NODE_W = 164;
  const NODE_H = 40;
  const H_GAP  = 36;
  const V_GAP  = 22;

  const positions = new Map<string, { x: number; y: number; layer: string }>();
  let yOffset = 20;
  for (const layer of allLayers) {
    const layerNodes = byLayer[layer] ?? [];
    let x = 20;
    for (const n of layerNodes) {
      positions.set(n, { x, y: yOffset, layer });
      x += NODE_W + H_GAP;
    }
    yOffset += NODE_H + V_GAP;
  }
  return positions;
}

function getLabel(path: string): string {
  const parts = path.replace(/\\/g, "/").split("/");
  return parts[parts.length - 1] ?? path;
}

function GraphCanvas({
  snapshot,
  primaryFiles,
  violationEdges,
  canvasId,
}: {
  snapshot: Snapshot;
  primaryFiles: Set<string>;
  violationEdges: Set<string>;
  canvasId: string;
}) {
  const relevantEdges = snapshot.edges.filter(
    (e) => primaryFiles.has(e.from) || primaryFiles.has(e.to)
  );
  const nodeSet = new Set<string>();
  for (const e of relevantEdges) { nodeSet.add(e.from); nodeSet.add(e.to); }
  for (const f of primaryFiles)  { nodeSet.add(f); }

  const nodeArray = Array.from(nodeSet);
  const positions = layoutNodes(nodeArray, snapshot, primaryFiles);

  const NODE_W = 164;
  const NODE_H = 40;
  const maxX   = Math.max(0, ...nodeArray.map((n) => (positions.get(n)?.x ?? 0) + NODE_W));
  const maxY   = Math.max(0, ...nodeArray.map((n) => (positions.get(n)?.y ?? 0) + NODE_H));
  const svgW   = maxX + 20;
  const svgH   = maxY + 20;

  return (
    <svg
      width="100%"
      height={svgH}
      viewBox={`0 0 ${svgW} ${svgH}`}
      style={{ display: "block", background: "#fff" }}
    >
      <defs>
        <marker
          id={`arrow-n-${canvasId}`}
          markerWidth="7" markerHeight="7" refX="6" refY="3.5" orient="auto"
        >
          <path d="M0,0 L7,3.5 L0,7 Z" fill={NORMAL_EDGE} />
        </marker>
        <marker
          id={`arrow-v-${canvasId}`}
          markerWidth="7" markerHeight="7" refX="6" refY="3.5" orient="auto"
        >
          <path d="M0,0 L7,3.5 L0,7 Z" fill={VIOLATION_EDGE} />
        </marker>
      </defs>

      {/* Edges */}
      {relevantEdges.map((e, i) => {
        const fp = positions.get(e.from);
        const tp = positions.get(e.to);
        if (!fp || !tp) return null;
        const isViol = violationEdges.has(`${e.from}::${e.to}`);
        const x1 = fp.x + NODE_W / 2;
        const y1 = fp.y + NODE_H;
        const x2 = tp.x + NODE_W / 2;
        const y2 = tp.y - 4;
        return (
          <line
            key={i}
            x1={x1} y1={y1} x2={x2} y2={y2}
            stroke={isViol ? VIOLATION_EDGE : NORMAL_EDGE}
            strokeWidth={isViol ? 2.5 : 1.5}
            strokeDasharray={isViol ? "6,3" : undefined}
            markerEnd={isViol ? `url(#arrow-v-${canvasId})` : `url(#arrow-n-${canvasId})`}
          />
        );
      })}

      {/* Nodes */}
      {nodeArray.map((n) => {
        const pos    = positions.get(n)!;
        const mod    = snapshot.modules.find((m) => m.path === n);
        const layer  = mod?.layer ?? "other";
        const colors = LAYER_COLORS[layer] ?? DEFAULT_NODE;
        const isPrimary = primaryFiles.has(n);
        return (
          <g key={n} transform={`translate(${pos.x},${pos.y})`}>
            <rect
              width={NODE_W} height={NODE_H} rx={6}
              fill={colors.fill}
              stroke={isPrimary ? colors.stroke : colors.stroke}
              strokeWidth={isPrimary ? 2.5 : 1.5}
              opacity={isPrimary ? 1 : 0.75}
            />
            <text
              x={NODE_W / 2} y={NODE_H / 2 - 4}
              textAnchor="middle" dominantBaseline="middle"
              fontSize={10} fontFamily="monospace"
              fill={colors.text} fontWeight={isPrimary ? "700" : "500"}
            >
              {getLabel(n)}
            </text>
            {layer !== "other" && (
              <text
                x={NODE_W / 2} y={NODE_H - 7}
                textAnchor="middle"
                fontSize={8} fontFamily="sans-serif"
                fill={colors.stroke} opacity={0.75}
              >
                {layer}
              </text>
            )}
          </g>
        );
      })}
    </svg>
  );
}

export default function GraphView({ before, after, primaryFiles }: Props) {
  const [view, setView] = useState<"before" | "after">("before");
  const primarySet = useMemo(() => new Set(primaryFiles), [primaryFiles]);

  const buildViolationEdges = (snapshot: Snapshot) =>
    new Set(snapshot.violations.map((v) => `${v.from}::${v.to}`));

  const beforeViolEdges = useMemo(() => buildViolationEdges(before), [before]);
  const afterViolEdges  = useMemo(() => buildViolationEdges(after),  [after]);

  const snapshot   = view === "before" ? before : after;
  const violEdges  = view === "before" ? beforeViolEdges : afterViolEdges;
  const violCount  = view === "before" ? before.violations.length : after.violations.length;
  const gitMarker  = view === "before" ? before.gitMarker : after.gitMarker;

  return (
    <section
      style={{
        background: "var(--surface, #fff)",
        border: "1px solid var(--border, #e1e4e8)",
        borderRadius: "var(--radius, 8px)",
        boxShadow: "var(--shadow)",
        marginBottom: 16,
        overflow: "hidden",
      }}
    >
      {/* Card header */}
      <div
        style={{
          padding: "12px 18px",
          borderBottom: "1px solid var(--border, #e1e4e8)",
          background: "var(--bg, #f4f5f7)",
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: 12,
          flexWrap: "wrap",
        }}
      >
        <h2
          style={{
            fontSize: 13,
            fontWeight: 700,
            color: "var(--text, #1a1d21)",
            letterSpacing: "-0.01em",
          }}
        >
          Focused Graph
        </h2>

        {/* Segmented toggle */}
        <div
          style={{
            display: "inline-flex",
            borderRadius: 8,
            border: "1px solid var(--border-strong, #c8ccd0)",
            overflow: "hidden",
            background: "var(--surface, #fff)",
          }}
        >
          {(["before", "after"] as const).map((v, idx) => {
            const active = view === v;
            const count  = v === "before" ? before.violations.length : after.violations.length;
            const noViol = count === 0;
            return (
              <button
                key={v}
                onClick={() => setView(v)}
                style={{
                  padding: "6px 16px",
                  border: "none",
                  borderRight: idx === 0 ? "1px solid var(--border-strong, #c8ccd0)" : "none",
                  background: active ? "#1a1d21" : "transparent",
                  color: active ? "#fff" : "var(--muted, #586069)",
                  fontSize: 12,
                  fontWeight: 700,
                  cursor: "pointer",
                  display: "flex",
                  alignItems: "center",
                  gap: 6,
                  transition: "background 0.1s",
                }}
              >
                {v === "before" ? "Before" : "After"}
                <span
                  style={{
                    fontSize: 10,
                    fontWeight: 700,
                    padding: "1px 6px",
                    borderRadius: 8,
                    background: noViol
                      ? (active ? "#22c55e" : "#dcfce7")
                      : (active ? VIOLATION_EDGE : "#fee2e2"),
                    color: noViol
                      ? (active ? "#fff" : "#15803d")
                      : (active ? "#fff" : "#b91c1c"),
                  }}
                >
                  {count}
                </span>
              </button>
            );
          })}
        </div>

        {/* Legend */}
        <div style={{ display: "flex", alignItems: "center", gap: 14, fontSize: 11, color: "var(--muted, #586069)" }}>
          <span style={{ display: "flex", alignItems: "center", gap: 4 }}>
            <svg width="22" height="8" style={{ display: "inline-block" }}>
              <line x1="0" y1="4" x2="22" y2="4" stroke={VIOLATION_EDGE} strokeWidth="2" strokeDasharray="5,3" />
            </svg>
            violation
          </span>
          <span style={{ display: "flex", alignItems: "center", gap: 4 }}>
            <svg width="22" height="8" style={{ display: "inline-block" }}>
              <line x1="0" y1="4" x2="22" y2="4" stroke={NORMAL_EDGE} strokeWidth="1.5" />
            </svg>
            dependency
          </span>
          <span style={{ display: "flex", alignItems: "center", gap: 4 }}>
            <svg width="12" height="12" style={{ display: "inline-block" }}>
              <rect width="12" height="12" rx="2" fill="#dbeafe" stroke="#2563eb" strokeWidth="2" />
            </svg>
            primary file
          </span>
        </div>
      </div>

      {/* Status bar */}
      <div
        style={{
          padding: "6px 18px",
          borderBottom: "1px solid var(--border, #e1e4e8)",
          background: "#fafbfc",
          display: "flex",
          alignItems: "center",
          gap: 10,
          fontSize: 11,
        }}
      >
        <span style={{ color: "var(--muted, #586069)" }}>
          Viewing:{" "}
          <code style={{ fontWeight: 600, color: "var(--text, #1a1d21)" }}>
            {gitMarker}
          </code>
        </span>
        <span
          style={{
            fontWeight: 700,
            color: violCount === 0 ? "var(--green, #16a34a)" : "var(--red, #dc2626)",
          }}
        >
          {violCount === 0
            ? "✓ No violations"
            : `${violCount} violation${violCount > 1 ? "s" : ""} present`}
        </span>
      </div>

      {/* Graph canvas */}
      <div style={{ padding: "16px 18px", overflowX: "auto" }}>
        <GraphCanvas
          snapshot={snapshot}
          primaryFiles={primarySet}
          violationEdges={violEdges}
          canvasId={view}
        />
      </div>
    </section>
  );
}
