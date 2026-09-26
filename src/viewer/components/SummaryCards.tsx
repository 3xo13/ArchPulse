import React from "react";
import type { VerifyResult } from "../types";

interface Props {
  result: VerifyResult;
}

interface CardDef {
  label: string;
  value: string;
  bg: string;
  border: string;
  valueColor: string;
  icon: string;
}

function parseTestOutput(output: string): string {
  // Extract "N passed" from lines like "Tests       14 passed (14)"
  const m = output.match(/(\d+)\s+passed/);
  return m ? `${m[1]} passed` : "—";
}

export default function SummaryCards({ result }: Props) {
  const testSummary = parseTestOutput(result.testOutput);
  const cards: CardDef[] = [
    {
      label: "Status",
      value: result.status.charAt(0).toUpperCase() + result.status.slice(1),
      bg: result.status === "verified" ? "var(--green-bg, #f0fdf4)" : "var(--red-bg, #fff1f2)",
      border: result.status === "verified" ? "var(--green-border, #bbf7d0)" : "var(--red-border, #fecdd3)",
      valueColor: result.status === "verified" ? "var(--green, #16a34a)" : "var(--red, #dc2626)",
      icon: result.status === "verified" ? "✓" : "✗",
    },
    {
      label: "Resolved",
      value: String(result.resolvedViolations.length),
      bg: "var(--green-bg, #f0fdf4)",
      border: "var(--green-border, #bbf7d0)",
      valueColor: "var(--green, #16a34a)",
      icon: "↓",
    },
    {
      label: "Persistent",
      value: String(result.persistentViolations.length),
      bg: "#fefce8",
      border: "#fde68a",
      valueColor: "#92400e",
      icon: "~",
    },
    {
      label: "New",
      value: String(result.newViolations.length),
      bg: result.newViolations.length > 0 ? "var(--red-bg, #fff1f2)" : "var(--green-bg, #f0fdf4)",
      border: result.newViolations.length > 0 ? "var(--red-border, #fecdd3)" : "var(--green-border, #bbf7d0)",
      valueColor: result.newViolations.length > 0 ? "var(--red, #dc2626)" : "var(--green, #16a34a)",
      icon: result.newViolations.length > 0 ? "↑" : "✓",
    },
    {
      label: "Tests",
      value: testSummary,
      bg: result.testExitCode === 0 ? "var(--green-bg, #f0fdf4)" : "var(--red-bg, #fff1f2)",
      border: result.testExitCode === 0 ? "var(--green-border, #bbf7d0)" : "var(--red-border, #fecdd3)",
      valueColor: result.testExitCode === 0 ? "var(--green, #16a34a)" : "var(--red, #dc2626)",
      icon: result.testExitCode === 0 ? "✓" : "✗",
    },
  ];

  return (
    <div
      style={{
        display: "grid",
        gridTemplateColumns: "repeat(5, 1fr)",
        gap: 10,
        marginBottom: 20,
      }}
    >
      {cards.map((c) => (
        <div
          key={c.label}
          style={{
            background: c.bg,
            border: `1px solid ${c.border}`,
            borderRadius: "var(--radius, 8px)",
            padding: "12px 14px",
          }}
        >
          <div
            style={{
              fontSize: 11,
              fontWeight: 600,
              color: "var(--muted, #586069)",
              textTransform: "uppercase",
              letterSpacing: "0.07em",
              marginBottom: 6,
            }}
          >
            {c.label}
          </div>
          <div
            style={{
              display: "flex",
              alignItems: "baseline",
              gap: 5,
            }}
          >
            <span
              style={{
                fontSize: 20,
                fontWeight: 800,
                color: c.valueColor,
                lineHeight: 1,
              }}
            >
              {c.value}
            </span>
            <span
              style={{
                fontSize: 13,
                fontWeight: 700,
                color: c.valueColor,
                opacity: 0.7,
              }}
            >
              {c.icon}
            </span>
          </div>
        </div>
      ))}
    </div>
  );
}
