import React from "react";
import type { CasePacket, VerifyResult } from "../types";

interface Props {
  casePacket: CasePacket;
  result: VerifyResult | undefined;
  githubBase: string;
  branch: string;
}

/**
 * Constructs a GitHub blob URL.
 * `base` already includes the full path up to the branch, e.g.:
 *   https://github.com/3xo13/ArchPulse/blob/feature/viewer
 * We only append the repo-relative path — no extra /blob/<branch>/ segment.
 */
function githubBlobUrl(base: string, _branch: string, repoRelativePath: string): string {
  const clean = repoRelativePath.replace(/^\/+/, "");
  return `${base}/${clean}`;
}

function FileLink({
  path,
  badge,
  badgeStyle,
  githubBase,
  branch,
}: {
  path: string;
  badge?: string;
  badgeStyle?: React.CSSProperties;
  githubBase: string;
  branch: string;
}) {
  const href        = githubBlobUrl(githubBase, branch, path);
  const parts       = path.replace(/\\/g, "/").split("/");
  const displayName = parts.pop() ?? path;
  const dirPath     = parts.join("/");

  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: 8,
        padding: "7px 0",
        borderBottom: "1px solid var(--border, #e1e4e8)",
      }}
    >
      {badge && (
        <span
          style={{
            fontSize: 10,
            fontWeight: 700,
            padding: "2px 8px",
            borderRadius: 10,
            flexShrink: 0,
            ...badgeStyle,
          }}
        >
          {badge}
        </span>
      )}
      <div style={{ minWidth: 0, flex: 1 }}>
        <a
          href={href}
          target="_blank"
          rel="noopener noreferrer"
          title={`${path}\n\nOpens on GitHub ↗`}
          style={{
            display: "inline-flex",
            alignItems: "baseline",
            gap: 2,
            textDecoration: "none",
          }}
        >
          {dirPath && (
            <span
              style={{
                fontFamily: "monospace",
                fontSize: 11,
                color: "var(--faint, #8b949e)",
              }}
            >
              {dirPath}/
            </span>
          )}
          <span
            style={{
              fontFamily: "monospace",
              fontSize: 12,
              fontWeight: 600,
              color: "var(--accent, #2563eb)",
            }}
          >
            {displayName}
          </span>
          <span
            style={{
              fontSize: 10,
              color: "var(--faint, #8b949e)",
              marginLeft: 3,
            }}
          >
            ↗
          </span>
        </a>
      </div>
    </div>
  );
}

function CardSection({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div
      style={{
        background: "var(--surface, #fff)",
        border: "1px solid var(--border, #e1e4e8)",
        borderRadius: "var(--radius, 8px)",
        overflow: "hidden",
        marginBottom: 10,
      }}
    >
      <div
        style={{
          padding: "10px 14px",
          borderBottom: "1px solid var(--border, #e1e4e8)",
          background: "var(--bg, #f4f5f7)",
          fontSize: 11,
          fontWeight: 700,
          color: "var(--muted, #586069)",
          textTransform: "uppercase",
          letterSpacing: "0.07em",
        }}
      >
        {title}
      </div>
      <div style={{ padding: "0 14px" }}>{children}</div>
    </div>
  );
}

export default function SourceLinks({ casePacket, result, githubBase, branch }: Props) {
  const resolvedFiles = new Set(
    (result?.resolvedViolations ?? []).flatMap((v) => [v.from, v.to])
  );

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
          background: "var(--bg, #f4f5f7)",
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
          Source Links
        </h2>
      </div>

      <div style={{ padding: "14px 18px" }}>
        {/* Two-column layout for files + tests */}
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "1fr 1fr",
            gap: 10,
            marginBottom: 10,
          }}
        >
          {/* Primary files */}
          <CardSection title="Primary Files">
            {casePacket.primaryFiles.map((f) => (
              <FileLink
                key={f}
                path={f}
                badge={resolvedFiles.has(f) ? "changed" : undefined}
                badgeStyle={{ background: "#dcfce7", color: "#15803d" }}
                githubBase={githubBase}
                branch={branch}
              />
            ))}
          </CardSection>

          {/* Relevant tests */}
          {casePacket.relevantTests.length > 0 && (
            <CardSection title="Relevant Tests">
              {casePacket.relevantTests.map((f) => (
                <FileLink
                  key={f}
                  path={f}
                  badge="test"
                  badgeStyle={{ background: "#dbeafe", color: "#1d4ed8" }}
                  githubBase={githubBase}
                  branch={branch}
                />
              ))}
            </CardSection>
          )}
        </div>

        {/* Test commands */}
        {casePacket.testCommands.length > 0 && (
          <div
            style={{
              background: "#1a1d21",
              borderRadius: "var(--radius-sm, 5px)",
              padding: "10px 14px",
              marginBottom: 10,
            }}
          >
            <div
              style={{
                fontSize: 10,
                fontWeight: 700,
                color: "#8b949e",
                textTransform: "uppercase",
                letterSpacing: "0.08em",
                marginBottom: 7,
              }}
            >
              $ Test commands
            </div>
            {casePacket.testCommands.map((cmd) => (
              <div key={cmd} style={{ padding: "2px 0" }}>
                <code
                  style={{
                    fontFamily: "monospace",
                    fontSize: 12,
                    color: "#c9d1d9",
                  }}
                >
                  {cmd}
                </code>
              </div>
            ))}
          </div>
        )}

        {/* Test result */}
        {result && (
          <div
            style={{
              border: `1px solid ${result.testExitCode === 0
                ? "var(--green-border, #bbf7d0)"
                : "var(--red-border, #fecdd3)"}`,
              borderRadius: "var(--radius-sm, 5px)",
              overflow: "hidden",
            }}
          >
            {/* Result header bar */}
            <div
              style={{
                padding: "8px 14px",
                background: result.testExitCode === 0
                  ? "var(--green-bg, #f0fdf4)"
                  : "var(--red-bg, #fff1f2)",
                display: "flex",
                alignItems: "center",
                gap: 16,
                fontSize: 12,
                borderBottom: `1px solid ${result.testExitCode === 0
                  ? "var(--green-border, #bbf7d0)"
                  : "var(--red-border, #fecdd3)"}`,
              }}
            >
              <div
                style={{
                  fontSize: 11,
                  fontWeight: 700,
                  color: "var(--muted, #586069)",
                  textTransform: "uppercase",
                  letterSpacing: "0.07em",
                  marginRight: 4,
                }}
              >
                Test Result
              </div>
              <span>
                Tests:{" "}
                <strong
                  style={{
                    color: result.testExitCode === 0
                      ? "var(--green, #16a34a)"
                      : "var(--red, #dc2626)",
                  }}
                >
                  {result.testExitCode === 0 ? "✓ pass" : `✗ exit ${result.testExitCode}`}
                </strong>
              </span>
              <span>
                Typecheck:{" "}
                <strong
                  style={{
                    color: result.typecheckExitCode === 0
                      ? "var(--green, #16a34a)"
                      : "var(--red, #dc2626)",
                  }}
                >
                  {result.typecheckExitCode === 0 ? "✓ pass" : `✗ exit ${result.typecheckExitCode}`}
                </strong>
              </span>
            </div>
            {/* Output */}
            <pre
              style={{
                fontFamily: "monospace",
                fontSize: 11,
                color: "var(--text, #1a1d21)",
                background: "var(--surface, #fff)",
                padding: "10px 14px",
                margin: 0,
                whiteSpace: "pre-wrap",
                wordBreak: "break-word",
                lineHeight: 1.6,
              }}
            >
              {result.testOutput}
            </pre>
          </div>
        )}
      </div>
    </section>
  );
}
