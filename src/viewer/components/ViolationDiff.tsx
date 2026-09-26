import React from "react";
import type { CasePacket, Snapshot, VerifyResult, Violation } from "../../types";

interface Props {
  casePacket: CasePacket;
  before: Snapshot;
  after: Snapshot;
  result: VerifyResult | undefined;
}

function shortPath(p: string): string {
  const parts = p.replace(/\\/g, "/").split("/");
  return parts.length > 2 ? "…/" + parts.slice(-2).join("/") : p;
}

type RowState = "before" | "resolved" | "persistent" | "new";

const STATE_META: Record<RowState, {
  label: string; labelBg: string; labelColor: string;
  rowBg: string; leftBorder: string;
}> = {
  before:     { label: "Before",     labelBg: "#fef9c3", labelColor: "#92400e",  rowBg: "#fffbeb", leftBorder: "#fbbf24" },
  resolved:   { label: "Resolved",   labelBg: "#dcfce7", labelColor: "#15803d",  rowBg: "#f0fdf4", leftBorder: "#4ade80" },
  persistent: { label: "Persistent", labelBg: "#f1f5f9", labelColor: "#475569",  rowBg: "#f8fafc", leftBorder: "#94a3b8" },
  new:        { label: "New",        labelBg: "#fee2e2", labelColor: "#b91c1c",  rowBg: "#fff1f2", leftBorder: "#f87171" },
};

const SEV_PILL: Record<string, { bg: string; color: string }> = {
  error: { bg: "#fee2e2", color: "#b91c1c" },
  warn:  { bg: "#fef3c7", color: "#92400e" },
  info:  { bg: "#dbeafe", color: "#1d4ed8" },
};

function ViolationRow({ v, state, note }: { v: Violation; state: RowState; note?: string }) {
  const m = STATE_META[state];
  const pill = SEV_PILL[v.severity] ?? SEV_PILL["error"];
  return (
    <tr
      style={{
        background: m.rowBg,
        borderBottom: "1px solid var(--border, #e1e4e8)",
        borderLeft: `3px solid ${m.leftBorder}`,
      }}
    >
      {/* State chip */}
      <td style={{ padding: "8px 12px", whiteSpace: "nowrap" }}>
        <span
          style={{
            display: "inline-block",
            fontSize: 10,
            fontWeight: 700,
            padding: "2px 8px",
            borderRadius: 10,
            background: m.labelBg,
            color: m.labelColor,
            letterSpacing: "0.05em",
            textTransform: "uppercase",
          }}
        >
          {m.label}
        </span>
      </td>
      {/* Severity */}
      <td style={{ padding: "8px 10px", whiteSpace: "nowrap" }}>
        <span
          style={{
            display: "inline-block",
            fontSize: 10,
            fontWeight: 700,
            padding: "2px 8px",
            borderRadius: 10,
            background: pill.bg,
            color: pill.color,
          }}
        >
          {v.severity}
        </span>
      </td>
      {/* Rule */}
      <td style={{ padding: "8px 10px", whiteSpace: "nowrap" }}>
        <code
          style={{
            fontSize: 11,
            color: "var(--accent, #2563eb)",
            background: "var(--accent-bg, #eff6ff)",
            padding: "1px 6px",
            borderRadius: 4,
          }}
        >
          {v.rule}
        </code>
      </td>
      {/* From → To */}
      <td style={{ padding: "8px 10px", maxWidth: 320 }}>
        <span
          title={v.from}
          style={{
            fontFamily: "monospace",
            fontSize: 11,
            color: "var(--text, #1a1d21)",
          }}
        >
          {shortPath(v.from)}
        </span>
        <span
          style={{
            margin: "0 6px",
            color: "var(--faint, #8b949e)",
            fontWeight: 700,
          }}
        >
          →
        </span>
        <span
          title={v.to}
          style={{
            fontFamily: "monospace",
            fontSize: 11,
            color: "var(--text, #1a1d21)",
          }}
        >
          {shortPath(v.to)}
        </span>
      </td>
      {/* Evidence */}
      <td
        style={{
          padding: "8px 10px",
          fontSize: 11,
          color: "var(--muted, #586069)",
          maxWidth: 220,
        }}
      >
        {note ?? v.evidence ?? ""}
      </td>
    </tr>
  );
}

export default function ViolationDiff({ casePacket, before: _before, after: _after, result }: Props) {
  const beforeViolations = casePacket.violations;
  const resolved: Violation[]      = result?.resolvedViolations    ?? [];
  const persistent: Violation[]    = result?.persistentViolations  ?? [];
  const newViolations: Violation[] = result?.newViolations         ?? [];
  const resolvedIds = new Set(resolved.map((v) => v.id));

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
          padding: "14px 18px",
          borderBottom: "1px solid var(--border, #e1e4e8)",
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: 12,
          background: "var(--bg, #f4f5f7)",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <h2
            style={{
              fontSize: 13,
              fontWeight: 700,
              color: "var(--text, #1a1d21)",
              letterSpacing: "-0.01em",
            }}
          >
            Violation Diff
          </h2>
          <code
            style={{
              fontSize: 11,
              color: "var(--accent, #2563eb)",
              background: "var(--accent-bg, #eff6ff)",
              padding: "2px 8px",
              borderRadius: 6,
              fontWeight: 700,
              border: "1px solid #bfdbfe",
            }}
          >
            {casePacket.rule}
          </code>
        </div>
        {/* Summary chips */}
        <div style={{ display: "flex", gap: 6, flexShrink: 0 }}>
          {[
            { label: `${resolved.length} resolved`,   bg: "#dcfce7", color: "#15803d", show: true },
            { label: `${persistent.length} persistent`, bg: "#f1f5f9", color: "#475569", show: true },
            { label: `${newViolations.length} new`,    bg: newViolations.length > 0 ? "#fee2e2" : "#f1f5f9",
                                                         color: newViolations.length > 0 ? "#b91c1c" : "#475569", show: true },
          ].map((chip) =>
            chip.show ? (
              <span
                key={chip.label}
                style={{
                  fontSize: 10,
                  fontWeight: 700,
                  padding: "2px 8px",
                  borderRadius: 10,
                  background: chip.bg,
                  color: chip.color,
                }}
              >
                {chip.label}
              </span>
            ) : null
          )}
        </div>
      </div>

      {/* Rule explanation */}
      <div
        style={{
          padding: "10px 18px",
          borderBottom: "1px solid var(--border, #e1e4e8)",
          fontSize: 12,
          color: "var(--muted, #586069)",
          lineHeight: 1.6,
          background: "#fafbfc",
        }}
      >
        {casePacket.ruleExplanation}
      </div>

      {/* Table */}
      <div style={{ overflowX: "auto" }}>
        <table
          style={{
            borderCollapse: "collapse",
            width: "100%",
            fontSize: 13,
          }}
        >
          <thead>
            <tr style={{ background: "var(--bg, #f4f5f7)" }}>
              {["State", "Severity", "Rule", "From → To", "Evidence / Note"].map((h) => (
                <th
                  key={h}
                  style={{
                    padding: "8px 12px",
                    textAlign: "left",
                    fontWeight: 700,
                    fontSize: 10,
                    color: "var(--muted, #586069)",
                    borderBottom: "1px solid var(--border, #e1e4e8)",
                    textTransform: "uppercase",
                    letterSpacing: "0.07em",
                    whiteSpace: "nowrap",
                  }}
                >
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {beforeViolations
              .filter((v) => !resolvedIds.has(v.id))
              .map((v) => <ViolationRow key={v.id + "-b"} v={v} state="before" />)}
            {resolved.map((v) => <ViolationRow key={v.id + "-r"} v={v} state="resolved" />)}
            {persistent.map((v) => (
              <ViolationRow key={v.id + "-p"} v={v} state="persistent" note={v.note ?? v.evidence} />
            ))}
            {newViolations.map((v) => <ViolationRow key={v.id + "-n"} v={v} state="new" />)}
            {beforeViolations.length === 0 && resolved.length === 0 &&
              persistent.length === 0 && newViolations.length === 0 && (
              <tr>
                <td
                  colSpan={5}
                  style={{
                    padding: "20px",
                    textAlign: "center",
                    color: "var(--muted, #586069)",
                    fontStyle: "italic",
                    fontSize: 12,
                  }}
                >
                  No violations recorded.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {/* Expected end condition */}
      {result && (
        <div
          style={{
            padding: "10px 18px",
            borderTop: "1px solid var(--border, #e1e4e8)",
            fontSize: 11,
            color: "var(--muted, #586069)",
            background: "#fafbfc",
            display: "flex",
            gap: 6,
          }}
        >
          <span style={{ fontWeight: 700, color: "var(--text, #1a1d21)", whiteSpace: "nowrap" }}>
            Expected end condition:
          </span>
          <span>{casePacket.expectedEndCondition}</span>
        </div>
      )}
    </section>
  );
}
