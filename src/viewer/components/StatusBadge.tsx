import React from "react";
import type { VerifyResult } from "../../types";

interface Props {
  result: VerifyResult | undefined;
  size?: "sm" | "md" | "lg";
}

const STATUS_STYLES: Record<string, { bg: string; color: string; border: string; label: string }> = {
  verified: { bg: "#dcfce7", color: "#15803d", border: "#86efac", label: "✓ Verified" },
  partial:  { bg: "#fef9c3", color: "#a16207", border: "#fde047", label: "⚠ Partial"  },
  failed:   { bg: "#fee2e2", color: "#b91c1c", border: "#fca5a5", label: "✗ Failed"   },
  invalid:  { bg: "#f1f5f9", color: "#64748b", border: "#cbd5e1", label: "— Invalid"  },
};

const SIZE: Record<string, { fontSize: number; padding: string; borderRadius: number }> = {
  sm: { fontSize: 11, padding: "2px 8px",  borderRadius: 10 },
  md: { fontSize: 12, padding: "3px 10px", borderRadius: 12 },
  lg: { fontSize: 13, padding: "4px 14px", borderRadius: 14 },
};

export default function StatusBadge({ result, size = "md" }: Props) {
  if (!result) return null;
  const s = STATUS_STYLES[result.status] ?? STATUS_STYLES["invalid"];
  const z = SIZE[size];
  return (
    <span
      style={{
        display: "inline-flex",
        alignItems: "center",
        padding: z.padding,
        borderRadius: z.borderRadius,
        fontSize: z.fontSize,
        fontWeight: 700,
        letterSpacing: "0.01em",
        background: s.bg,
        color: s.color,
        border: `1px solid ${s.border}`,
        whiteSpace: "nowrap",
      }}
    >
      {s.label}
    </span>
  );
}
