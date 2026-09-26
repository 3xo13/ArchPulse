import React from "react";
import type { CasePacket, VerifyResult } from "../../types";
import StatusBadge from "./StatusBadge";

interface Props {
  cases: CasePacket[];
  results: Record<string, VerifyResult>;
  selectedId: string;
  onSelect: (id: string) => void;
}

const SEV_COLOR: Record<string, { dot: string; pill: string; text: string }> = {
  error: { dot: "#dc2626", pill: "#fee2e2", text: "#b91c1c" },
  warn:  { dot: "#d97706", pill: "#fef3c7", text: "#92400e" },
  info:  { dot: "#2563eb", pill: "#eff6ff", text: "#1d4ed8" },
};

export default function CaseList({ cases, results, selectedId, onSelect }: Props) {
  return (
    <aside
      style={{
        width: "var(--sidebar-w, 240px)",
        flexShrink: 0,
        borderRight: "1px solid var(--border, #e1e4e8)",
        background: "var(--surface, #fff)",
        display: "flex",
        flexDirection: "column",
        overflowY: "auto",
      }}
    >
      {/* Sidebar header */}
      <div
        style={{
          padding: "14px 16px 10px",
          borderBottom: "1px solid var(--border, #e1e4e8)",
          display: "flex",
          alignItems: "center",
          gap: 6,
        }}
      >
        <span
          style={{
            fontSize: 11,
            fontWeight: 700,
            letterSpacing: "0.08em",
            textTransform: "uppercase",
            color: "var(--muted, #586069)",
          }}
        >
          Cases
        </span>
        <span
          style={{
            fontSize: 10,
            fontWeight: 700,
            background: "var(--border, #e1e4e8)",
            color: "var(--muted, #586069)",
            borderRadius: 10,
            padding: "0 6px",
            minWidth: 18,
            textAlign: "center",
          }}
        >
          {cases.length}
        </span>
      </div>

      {/* Case list */}
      <div style={{ flex: 1, padding: "6px 8px" }}>
        {cases.map((c) => {
          const res = results[c.caseId];
          const isSelected = c.caseId === selectedId;
          const sev = SEV_COLOR[c.severity] ?? SEV_COLOR["error"];

          return (
            <button
              key={c.caseId}
              onClick={() => onSelect(c.caseId)}
              style={{
                display: "block",
                width: "100%",
                textAlign: "left",
                border: isSelected
                  ? "1px solid var(--accent, #2563eb)"
                  : "1px solid transparent",
                borderRadius: "var(--radius-sm, 5px)",
                background: isSelected ? "var(--accent-bg, #eff6ff)" : "transparent",
                padding: "10px 12px",
                cursor: "pointer",
                color: "var(--text, #1a1d21)",
                marginBottom: 2,
              }}
            >
              {/* Row 1: case ID + status badge */}
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "space-between",
                  gap: 6,
                  marginBottom: 4,
                }}
              >
                <code
                  style={{
                    fontSize: 11,
                    color: isSelected
                      ? "var(--accent, #2563eb)"
                      : "var(--muted, #586069)",
                    fontWeight: 700,
                  }}
                >
                  {c.caseId}
                </code>
                {res && <StatusBadge result={res} size="sm" />}
              </div>

              {/* Row 2: title */}
              <div
                style={{
                  fontSize: 12,
                  lineHeight: 1.4,
                  color: isSelected ? "var(--text, #1a1d21)" : "var(--muted, #586069)",
                  fontWeight: isSelected ? 600 : 400,
                  marginBottom: 5,
                }}
              >
                {c.title}
              </div>

              {/* Row 3: severity + rule */}
              <div style={{ display: "flex", alignItems: "center", gap: 5 }}>
                <span
                  style={{
                    width: 6,
                    height: 6,
                    borderRadius: "50%",
                    background: sev.dot,
                    display: "inline-block",
                    flexShrink: 0,
                  }}
                />
                <span
                  style={{
                    fontSize: 10,
                    padding: "1px 6px",
                    borderRadius: 8,
                    background: sev.pill,
                    color: sev.text,
                    fontWeight: 600,
                  }}
                >
                  {c.severity}
                </span>
                <code
                  style={{
                    fontSize: 10,
                    color: "var(--faint, #8b949e)",
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                    whiteSpace: "nowrap",
                    maxWidth: 130,
                  }}
                >
                  {c.rule}
                </code>
              </div>
            </button>
          );
        })}
      </div>
    </aside>
  );
}
